/**
 * Intent classifier — the heuristic half of the speed arbitration split
 * (docs/speed-arbitration.md, "Architecture: classifier vs. arbiter").
 *
 * Consumes gesture observations (clicks, unhandled keys, pointer state) and
 * classifies each external ratechange as USER_INTENT / TEMPORARY_OVERRIDE /
 * AUTONOMOUS / INIT_NOISE / SELF. Every heuristic cites the evidence that motivated it;
 * ALL such heuristics live here and only here. The arbiter guarantees that
 * classifier mistakes are recoverable, never correct — see the contract doc.
 *
 * Evidence tiers (TARGET_RULES):
 *   STRONG — native speed key, site signature (YT hold/space), or a click
 *     SEQUENCE (two clicks within CLICK_SEQUENCE_WINDOW_MS, the last
 *     within the gesture window). Real speed menus are always >= 2 clicks
 *     deep, so menu choices — including "Normal" — reach this tier
 *     naturally. Sequence-based adoption of exactly 1.0 is additionally
 *     vetoed by side-effect evidence — a recent seek or media (re)init on
 *     the same element (#1600): those contexts produce the same two-click
 *     shape as menu traversal while the reset is the site's own. Speed-key
 *     evidence is exempt from the veto.
 *   WEAK — a single click within the gesture window. Sufficient to adopt
 *     any NON-1.0 value (sites have no reason to autonomously set 1.7x),
 *     but NOT a transition to 1.0: every documented false positive
 *     (#1581, #1562-class) is a click-side-effect reset to exactly 1.0.
 *   Otherwise AUTONOMOUS.
 *
 * Privacy: the evidence ledger is deliberately coarse — four in-memory
 * timestamps, short-lived active pointer IDs, a transient Space-held flag,
 * and weak per-media click timestamps when a player association is unambiguous.
 * No positions, stable media identity, or event payloads are retained;
 * nothing is persisted or leaves the page context, and every value is
 * semantically dead after a few seconds or when its pointer ends.
 *
 * Per-site signature activation: the generic temporal heuristic is the
 * scalable default; site handlers declare documented exceptions through
 * BaseSiteHandler.getClassifierRules() (currently additions only —
 * YouTube's press-and-hold 2x boost, #1554/#1568: the only web player with
 * this interaction in the evidence base, so pointer/space hold is scoped
 * there rather than trusted globally; held-pointer rate changes have
 * innocent causes elsewhere, e.g. scrub-preview). The once-planned
 * click-arming suppressions became unnecessary when the tiered rules fixed
 * #1581 generically. Every activation must cite its issue. This split IS
 * the scaling strategy: this module owns what each flag MEANS; handlers own
 * WHICH host activates it, exactly as they already do for positioning —
 * hostname knowledge lives in one registry (matches()).
 */

window.VSC = window.VSC || {};

const CLASSIFIER_VERDICTS = Object.freeze({
  SELF: 'SELF', // our own write echoing back — filtered before the arbiter
  USER_INTENT: 'USER_INTENT',
  // Site-specific temporary interaction: allows a native hold without
  // claiming shared desired speed or persistent authority.
  TEMPORARY_OVERRIDE: 'TEMPORARY_OVERRIDE',
  AUTONOMOUS: 'AUTONOMOUS',
  INIT_NOISE: 'INIT_NOISE',
});

const TARGET_RULES = Object.freeze({
  // Only native speed shortcuts arm strong key intent (PR #1563); clicks
  // always feed the sequence detector. Site handlers declare per-site
  // activations through getClassifierRules() (e.g. YouTube's hold-for-2x,
  // #1554); this module owns what each flag means, never which host gets it.
  pointerHoldArms: false,
});

const USER_GESTURE_WINDOW_MS = 300; // ms after a gesture in which a ratechange reads as intent
// Two clicks this close together read as UI traversal (menu -> item), the
// signature of every real speed menu. Generous: users browse menus slowly.
const CLICK_SEQUENCE_WINDOW_MS = 5000;
// Autonomous resets land on exactly 1.0; tolerance for float noise.
const NORMAL_RATE_EPSILON = 0.005;
// A 1.0 reset landing this soon after a seek on the same media reads as the
// seek's side effect, not a menu choice (#1600: play-then-skip forms a click
// sequence indistinguishable from menu traversal, and the site's post-seek
// reset arrives inside the gesture window). Menu speed selection never
// seeks, so this only demotes what a menu could not have produced.
const SEEK_RESET_WINDOW_MS = 1000;
// Players routinely write playbackRate = 1.0 while (re)initializing — after
// readyState leaves 0 (past the INIT_NOISE guard) but before a user could
// plausibly traverse a speed menu (#1600: the misadoption fired within a
// second of controller attach). Lifecycle restores and loadstart re-arm it.
const MEDIA_INIT_GRACE_MS = 2000;
// YouTube's documented long-press boost is specifically 2x. Keeping this
// narrow means a native menu choice or shortcut remains durable USER_INTENT.
const TEMPORARY_HOLD_RATE = 2.0;
const TEMPORARY_HOLD_RATE_EPSILON = 0.01;
// No input for this long before a ratechange = quiet context: the change
// cannot be a misclassified user action (all intent evidence IS input).
// NOTE: quiet means not-interacting, NOT user-absent — passive viewing is
// quiet. Quiet may therefore only ever LOOSEN safety assumptions about
// misclassification, never justify weaker fighting for the viewer.
const QUIET_CONTEXT_MS = 5000;
// A press held at least this long reads as a hold gesture, not a click.
// YouTube's own speedmaster engagement delay is 500ms, so every real 2x hold
// release exceeds this threshold while ordinary UI clicks stay well below it.
const LONG_PRESS_CLICK_MS = 400;
// The synthetic click that follows pointerup arrives within the same input
// turn; anything later is a genuinely separate interaction.
const LONG_PRESS_CLICK_GRACE_MS = 150;
// An unresolved press may claim a 2x boost only while plausibly causal:
// YouTube engages its boost 500ms after the press, so a press older than
// this cannot be the trigger. A pointer whose pointerup was lost outside
// the window (no terminal ever delivered) therefore ages out instead of
// blessing spurious rate changes or pinning hold-end detection forever.
const UNRESOLVED_BIND_MAX_AGE_MS = 5000;

/**
 * Native speed shortcut detection (PR #1563): YouTube's < / > keys.
 */
function isNativeSpeedShortcutKey(event) {
  return (
    event.key === '<' ||
    event.key === '>' ||
    ((event.code === 'Comma' || event.keyCode === 188) && event.shiftKey) ||
    ((event.code === 'Period' || event.keyCode === 190) && event.shiftKey)
  );
}

class IntentClassifier {
  constructor(options = {}) {
    this.rules = options.rules || TARGET_RULES;
    this.minRate = options.minRate ?? 0.07; // SPEED_LIMITS.MIN
    // The entire evidence ledger — coarse by design (see header):
    this.lastGestureAt = 0; // strong key intent (speed keys, site keys)
    // Unresolved page clicks retain the historical document-level fallback.
    this.lastClickAt = 0;
    this.prevClickAt = 0;
    // A resolved click belongs only to its media key; WeakMap keeps this
    // short-lived evidence from extending the media element's lifetime.
    this.clicksByMedia = new WeakMap();
    this.lastInputAt = 0; // ANY user input (presence/quiet axis)
    // Unresolved holds preserve the historical document fallback. Resolved
    // holds are isolated per media, exactly like resolved click evidence: a
    // YouTube hold on A must never bless B's ratechange.
    this.activePointerIds = new Set();
    this.activePointersByMedia = new WeakMap();
    // A short-lived strong map lets terminal events retire the ledger chosen
    // at pointerdown even when pointer capture retargets pointerup elsewhere.
    // Values are { media, downAt } so a terminal event can also distinguish a
    // completed long press from an ordinary click.
    this.pointerOwners = new Map();
    // Space has no media target until its native 2x ratechange arrives. Once
    // identified, bind it to that media so release remains negative-only.
    this.spaceHoldActive = false;
    this.spaceHoldMedia = null;
    // Timestamp of the most recent long-press terminal. The click event that
    // immediately follows a completed hold is gesture bookkeeping, not menu
    // intent; recording it would let two hold attempts manufacture a strong
    // click sequence that adopts YouTube's structural 1.0 release reset.
    this.longPressEndAt = 0;
    // Negative evidence for 1.0 adoption (#1600): what the media itself just
    // did. Same lifetime discipline as clicksByMedia — coarse timestamps in
    // WeakMaps, nothing persisted.
    this.seeksByMedia = new WeakMap();
    this.mediaInitByMedia = new WeakMap();
  }

  /** Any user input at all — presence evidence only, never intent. */
  observeInput(event) {
    this.lastInputAt = event.timeStamp;
  }

  /** A keydown no VSC binding handled. */
  observeUnhandledKey(event) {
    this.lastInputAt = event.timeStamp;
    const isSpace = event.code === 'Space' || event.keyCode === 32;
    if (isNativeSpeedShortcutKey(event)) {
      this.lastGestureAt = event.timeStamp;
    }
    if (this.rules.spacebarArms && isSpace) {
      // Repeated keydown events refresh presence but deliberately retain one
      // hold identity until keyup. If one resolved pointer is already down,
      // bind Space to that same media now so either terminal can be the last
      // source that retires the eventual native overlay.
      this.spaceHoldActive = true;
      this.spaceHoldMedia ||= this.soleActivePointerMedia();
    }
  }

  /**
   * Retire the temporary Space-hold signature and return the media it had
   * already been bound to by a 2x ratechange, if any.
   * @param {KeyboardEvent} event
   * @returns {HTMLMediaElement|null}
   */
  observeKeyEnd(event) {
    this.lastInputAt = event.timeStamp;
    const isSpace = event.code === 'Space' || event.keyCode === 32;
    if (!this.rules.spacebarArms || !isSpace || !this.spaceHoldActive) {
      return null;
    }
    const media = this.spaceHoldMedia;
    this.spaceHoldActive = false;
    this.spaceHoldMedia = null;
    return media && !this.hasActiveTemporaryHoldFor(media, event.timeStamp) ? media : null;
  }

  /**
   * Record a page click. A resolved media key is negative-only attribution:
   * it can bless that media but is intentionally absent from every other
   * media's evidence. Unresolved clicks retain the legacy fallback scope.
   * @param {Event} event
   * @param {HTMLMediaElement|null} media
   */
  observeClick(event, media = null) {
    this.lastInputAt = event.timeStamp;
    const sinceLongPress = event.timeStamp - this.longPressEndAt;
    if (
      this.longPressEndAt > 0 &&
      sinceLongPress >= 0 &&
      sinceLongPress < LONG_PRESS_CLICK_GRACE_MS
    ) {
      return;
    }
    const ledger = media ? this.getClickLedger(media) : this;
    ledger.prevClickAt = ledger.lastClickAt;
    ledger.lastClickAt = event.timeStamp;
  }

  /**
   * A seek began or completed on this media. Negative evidence only: it can
   * demote a following 1.0 adoption to AUTONOMOUS, never bless anything.
   * Recorded at `seeking` because reactive sites reset the rate before the
   * seek completes; refreshed at `seeked` so slow network seeks stay covered.
   * @param {HTMLMediaElement} media
   * @param {number} timeStamp
   */
  observeSeek(media, timeStamp) {
    if (media) {
      this.seeksByMedia.set(media, timeStamp);
    }
  }

  /**
   * This media entered a (re)initialization moment: attach-time restore,
   * deferred loadedmetadata restore, or a new resource load (loadstart —
   * quality switches and ad transitions swap sources without reattaching the
   * controller). Negative evidence only, same shape as observeSeek.
   * @param {HTMLMediaElement} media
   * @param {number} timeStamp
   */
  observeMediaInit(media, timeStamp) {
    if (media) {
      this.mediaInitByMedia.set(media, timeStamp);
    }
  }

  /**
   * @param {HTMLMediaElement} media
   * @returns {{lastClickAt: number, prevClickAt: number}}
   * @private
   */
  getClickLedger(media) {
    let ledger = this.clicksByMedia.get(media);
    if (!ledger) {
      ledger = { lastClickAt: 0, prevClickAt: 0 };
      this.clicksByMedia.set(media, ledger);
    }
    return ledger;
  }

  /**
   * Pointer pressed outside the VSC controller (PR #1555).
   * @param {PointerEvent} event
   * @param {HTMLMediaElement|null} media
   */
  observePointerDown(event, media = null) {
    this.lastInputAt = event.timeStamp;
    if (!this.rules.pointerHoldArms || !Number.isInteger(event.pointerId)) {
      return;
    }

    // A browser can reuse a pointer ID. Retire the old owner first so one ID
    // cannot be simultaneously attributed to a stale media element.
    this.removePointer(event.pointerId);
    // If Space already owns one resolved hold, an otherwise unresolved
    // pointer is conservatively tied to it for terminal bookkeeping. This
    // prevents either source from stranding the overlay; a resolved pointer
    // still always wins and can belong to another media.
    const owner = media || (this.spaceHoldActive ? this.spaceHoldMedia : null);
    if (owner) {
      this.getPointerLedger(owner).add(event.pointerId);
    } else {
      this.activePointerIds.add(event.pointerId);
    }
    this.pointerOwners.set(event.pointerId, { media: owner, downAt: event.timeStamp });
  }

  /**
   * Retire a pointer hold on a physical terminal event and return its media
   * owner when the earlier 2x observation resolved one. A `click` cannot do
   * this safely: it carries no pointer ID and could clear a concurrent hold.
   * @param {PointerEvent} event
   * @returns {HTMLMediaElement[]}
   */
  observePointerEnd(event) {
    this.lastInputAt = event.timeStamp;
    if (!this.rules.pointerHoldArms) {
      return [];
    }
    if (!Number.isInteger(event.pointerId)) {
      return this.clearPointerHolds();
    }

    const entry = this.pointerOwners.get(event.pointerId) || null;
    if (entry && event.timeStamp - entry.downAt >= LONG_PRESS_CLICK_MS) {
      this.longPressEndAt = event.timeStamp;
    }
    this.removePointer(event.pointerId);
    const media = entry?.media || null;
    return media && !this.hasActiveTemporaryHoldFor(media, event.timeStamp) ? [media] : [];
  }

  /** @param {HTMLMediaElement} media @returns {Set<number>} @private */
  getPointerLedger(media) {
    let ledger = this.activePointersByMedia.get(media);
    if (!ledger) {
      ledger = new Set();
      this.activePointersByMedia.set(media, ledger);
    }
    return ledger;
  }

  /** @param {number} pointerId @private */
  removePointer(pointerId) {
    const entry = this.pointerOwners.get(pointerId);
    if (!entry) {
      this.activePointerIds.delete(pointerId);
      return;
    }
    if (entry.media) {
      this.activePointersByMedia.get(entry.media)?.delete(pointerId);
    } else {
      this.activePointerIds.delete(pointerId);
    }
    this.pointerOwners.delete(pointerId);
  }

  /**
   * Clear active pointer evidence without treating focus loss as input.
   * @returns {HTMLMediaElement[]} media that may have a temporary override
   */
  clearPointerHolds() {
    const media = new Set();
    this.activePointerIds.clear();
    for (const entry of this.pointerOwners.values()) {
      if (entry.media) {
        media.add(entry.media);
        this.activePointersByMedia.get(entry.media)?.clear();
      }
    }
    this.pointerOwners.clear();
    return [...media];
  }

  /**
   * Clear pointer and Space hold evidence for browser lifecycle loss.
   * @returns {HTMLMediaElement[]} media that may have a temporary override
   */
  clearTemporaryHolds() {
    const media = new Set(this.clearPointerHolds());
    if (this.spaceHoldMedia) {
      media.add(this.spaceHoldMedia);
    }
    this.spaceHoldActive = false;
    this.spaceHoldMedia = null;
    return [...media];
  }

  /**
   * Return a pointer media owner only when every active pointer belongs to
   * that one resolved media. This is safe to use for temporary-source
   * bookkeeping; ambiguous pointers remain unresolved.
   * @returns {HTMLMediaElement|null}
   * @private
   */
  soleActivePointerMedia() {
    let media = null;
    for (const entry of this.pointerOwners.values()) {
      if (!entry.media || (media && entry.media !== media)) {
        return null;
      }
      media = entry.media;
    }
    return media;
  }

  /**
   * Resolve one active pointer for a ratechange target. An unresolved
   * pointer becomes media-scoped when that media actually receives the
   * recognized 2x change. When several unresolved pointers exist (for
   * example a stale ID whose pointerup was released outside the window),
   * bind the most recent press: it is the one that plausibly triggered the
   * hold, and requiring exactly one unresolved ID silently disabled
   * recognition for the entire session.
   * @param {HTMLMediaElement|null|undefined} media
   * @returns {number|null}
   * @private
   */
  activePointerFor(media, timeStamp) {
    if (!media) {
      return null;
    }
    const scoped = this.activePointersByMedia.get(media);
    if (scoped?.size) {
      return scoped.values().next().value;
    }
    let pointerId = null;
    let newest = -Infinity;
    for (const id of this.activePointerIds) {
      const downAt = this.pointerOwners.get(id)?.downAt ?? 0;
      if (this.isStaleUnresolvedPress(downAt, timeStamp)) {
        continue;
      }
      if (downAt >= newest) {
        newest = downAt;
        pointerId = id;
      }
    }
    if (pointerId === null) {
      return null;
    }
    this.activePointerIds.delete(pointerId);
    this.getPointerLedger(media).add(pointerId);
    const entry = this.pointerOwners.get(pointerId);
    if (entry) {
      entry.media = media;
    } else {
      this.pointerOwners.set(pointerId, { media, downAt: 0 });
    }
    return pointerId;
  }

  /**
   * @param {number} downAt
   * @param {number|undefined} timeStamp
   * @returns {boolean}
   * @private
   */
  isStaleUnresolvedPress(downAt, timeStamp) {
    const age = timeStamp - downAt;
    return Number.isFinite(age) && age > UNRESOLVED_BIND_MAX_AGE_MS;
  }

  /**
   * Whether a resolved media still has a physically active temporary-hold
   * source. An unresolved pointer/Space hold is treated conservatively: it
   * might belong to this media, so another pointer's terminal event must not
   * cancel a visible native hold before its own release arrives.
   * @param {HTMLMediaElement|null} media
   * @returns {boolean}
   */
  hasActiveTemporaryHoldFor(media, timeStamp) {
    if (!media) {
      return false;
    }
    if (
      (this.activePointersByMedia.get(media)?.size ?? 0) > 0 ||
      (this.spaceHoldActive && (!this.spaceHoldMedia || this.spaceHoldMedia === media))
    ) {
      return true;
    }
    for (const id of this.activePointerIds) {
      if (!this.isStaleUnresolvedPress(this.pointerOwners.get(id)?.downAt ?? 0, timeStamp)) {
        return true;
      }
    }
    return false;
  }

  /**
   * The only temporary native signature currently supported is YouTube's
   * documented held-pointer/Space 2x boost. It is deliberately narrower than
   * generic user intent so native menu choices and speed shortcuts stay durable.
   * @param {Object} ctx
   * @returns {boolean}
   * @private
   */
  isTemporaryOverride(ctx) {
    if (
      typeof ctx.rate !== 'number' ||
      Math.abs(ctx.rate - TEMPORARY_HOLD_RATE) > TEMPORARY_HOLD_RATE_EPSILON
    ) {
      return false;
    }
    if (this.rules.pointerHoldArms && this.activePointerFor(ctx.media, ctx.timeStamp) !== null) {
      // When pointer evidence wins a simultaneous Space signature, bind the
      // otherwise unscoped Space hold to the proven ratechange owner so its
      // later keyup can retire the same overlay.
      if (this.spaceHoldActive && !this.spaceHoldMedia) {
        this.spaceHoldMedia = ctx.media || null;
      }
      return true;
    }
    if (
      this.rules.spacebarArms &&
      this.spaceHoldActive &&
      (!this.spaceHoldMedia || this.spaceHoldMedia === ctx.media)
    ) {
      this.spaceHoldMedia = ctx.media || null;
      return true;
    }
    if (this.rules.pointerHoldArms || this.rules.spacebarArms) {
      // The signature rate arrived on a hold-armed host but no hold evidence
      // matched. Field traces need the evidence state to diagnose why.
      window.VSC.logger?.debug(
        `Hold-rate ${ctx.rate} without hold evidence: ` +
          `scoped=${ctx.media ? (this.activePointersByMedia.get(ctx.media)?.size ?? 0) : 'n/a'} ` +
          `unresolved=${this.activePointerIds.size} owners=${this.pointerOwners.size} ` +
          `space=${this.spaceHoldActive}`
      );
    }
    return false;
  }

  /**
   * Compute durable user-intent evidence without consuming temporary-hold
   * state. A strong native choice must outrank a concurrent hold signature:
   * users can deliberately select 2x while a pointer remains down.
   * @param {Object} ctx - { media?, timeStamp }
   * @returns {{clickInWindow: boolean, strong: boolean}}
   * @private
   */
  intentEvidence(ctx) {
    const withinWindow = (ts) =>
      ts > 0 && ctx.timeStamp - ts >= 0 && ctx.timeStamp - ts < USER_GESTURE_WINDOW_MS;

    // Do not combine an unresolved click with a resolved-media click into a
    // synthetic sequence: that would re-open cross-player attribution through
    // two unrelated evidence streams.
    const ledgers = [this];
    const mediaLedger = ctx.media ? this.clicksByMedia.get(ctx.media) : null;
    if (mediaLedger) {
      ledgers.push(mediaLedger);
    }
    const clickInWindow = ledgers.some((ledger) => withinWindow(ledger.lastClickAt));
    const clickSequence = ledgers.some(
      (ledger) =>
        withinWindow(ledger.lastClickAt) &&
        ledger.prevClickAt > 0 &&
        ledger.lastClickAt - ledger.prevClickAt <= CLICK_SEQUENCE_WINDOW_MS
    );
    // keyIntent is surfaced separately because it is the one evidence kind
    // exempt from side-effect demotion: a native speed shortcut is
    // unambiguous, while a click sequence merely correlates (#1600).
    const keyIntent = withinWindow(this.lastGestureAt);
    return {
      clickInWindow,
      keyIntent,
      strong: keyIntent || clickSequence,
    };
  }

  /**
   * Whether a reset to exactly 1.0 is explained by the media's own recent
   * behavior. Two chrome clicks plus a 1.0 ratechange inside the gesture
   * window is the exact shape of BOTH a native menu "Normal" choice and a
   * click-side-effect reset (skip/seek controls, player init) — the click
   * evidence cannot tell them apart, but menu selection neither seeks nor
   * re-initializes. Demotion is the recoverable direction under the arbiter
   * contract: a wrongly demoted menu choice costs one fight/re-click, while
   * a wrong adoption persists 1.0 over the remembered speed (#1600).
   * @param {Object} ctx - { media?, timeStamp }
   * @returns {boolean}
   * @private
   */
  isSideEffectNormalReset(ctx) {
    if (!ctx.media) {
      return false;
    }
    const within = (ts, windowMs) =>
      typeof ts === 'number' && ctx.timeStamp - ts >= 0 && ctx.timeStamp - ts < windowMs;
    return (
      within(this.seeksByMedia.get(ctx.media), SEEK_RESET_WINDOW_MS) ||
      within(this.mediaInitByMedia.get(ctx.media), MEDIA_INIT_GRACE_MS)
    );
  }

  /**
   * Whether a ratechange has durable, strong evidence that can supersede an
   * active local temporary override. Weak click evidence stays deliberately
   * below the hold signature so a native release cannot persist a reset.
   * @param {Object} ctx - { media?, timeStamp }
   * @returns {boolean}
   */
  hasStrongIntent(ctx) {
    return this.intentEvidence(ctx).strong;
  }

  /**
   * Classify an external ratechange. Mirrors the guard order of the legacy
   * handleRateChange so differential replay is faithful.
   *
   * @param {Object} ctx - { media?, rate, timeStamp, readyState, detail }
   * @returns {string} one of CLASSIFIER_VERDICTS
   */
  classify(ctx) {
    if (ctx.detail && ctx.detail.origin === 'videoSpeed') {
      return CLASSIFIER_VERDICTS.SELF;
    }
    if (ctx.readyState < 1) {
      return CLASSIFIER_VERDICTS.INIT_NOISE;
    }
    if (typeof ctx.rate === 'number' && !isNaN(ctx.rate) && ctx.rate <= this.minRate) {
      return CLASSIFIER_VERDICTS.INIT_NOISE;
    }

    const { clickInWindow, keyIntent, strong } = this.intentEvidence(ctx);
    const isNormalReset = Math.abs(ctx.rate - 1.0) < NORMAL_RATE_EPSILON;
    // Strong speed-key/menu evidence is an explicit durable choice. Check it
    // before the YouTube hold signature so held-pointer 2x does not swallow
    // an intentional native 2x selection.
    if (strong) {
      // Click-sequence strength adopts 1.0 only when the media's own recent
      // behavior doesn't explain the reset; a native speed key remains
      // sufficient on its own (see isSideEffectNormalReset).
      if (isNormalReset && !keyIntent && this.isSideEffectNormalReset(ctx)) {
        return CLASSIFIER_VERDICTS.AUTONOMOUS;
      }
      return CLASSIFIER_VERDICTS.USER_INTENT;
    }
    if (this.isTemporaryOverride(ctx)) {
      return CLASSIFIER_VERDICTS.TEMPORARY_OVERRIDE;
    }

    if (clickInWindow && !isNormalReset) {
      return CLASSIFIER_VERDICTS.USER_INTENT;
    }
    return CLASSIFIER_VERDICTS.AUTONOMOUS;
  }

  /**
   * Quiet context: no user input observed for QUIET_CONTEXT_MS before the
   * given moment (or ever). Used by the adapter as the war-context signal
   * for the cell 9/9b quiet-war re-arm split.
   * @param {number} timeStamp - the ratechange's timeStamp
   * @returns {boolean}
   */
  isQuietContext(timeStamp) {
    return this.lastInputAt === 0 || timeStamp - this.lastInputAt >= QUIET_CONTEXT_MS;
  }

  /**
   * Clear temporary-hold evidence owned by one resolved media element. Do not
   * clear unresolved or other-media evidence: a durable choice on B cannot
   * erase an active temporary hold on A.
   * @param {HTMLMediaElement} media
   */
  clearTemporaryHoldsForMedia(media) {
    const ownedPointers = [];
    for (const [pointerId, owner] of this.pointerOwners) {
      if (owner === media) {
        ownedPointers.push(pointerId);
      }
    }
    for (const pointerId of ownedPointers) {
      this.removePointer(pointerId);
    }
    this.activePointersByMedia.delete(media);
    if (this.spaceHoldMedia === media) {
      this.spaceHoldActive = false;
      this.spaceHoldMedia = null;
    }
  }

  /**
   * One-shot semantics: called by the adapter when a USER_INTENT verdict was
   * actually adopted, mirroring legacy's lastUserInteractionAt = 0 reset in
   * the accept branch.
   */
  consumeGesture(media = null) {
    this.lastGestureAt = 0;
    this.lastClickAt = 0;
    this.prevClickAt = 0;
    if (media) {
      this.clicksByMedia.delete(media);
      this.clearTemporaryHoldsForMedia(media);
    } else {
      this.clearTemporaryHolds();
    }
  }

  /** Release short-lived evidence attached to a removed media element. */
  releaseMedia(media) {
    this.clicksByMedia.delete(media);
    this.seeksByMedia.delete(media);
    this.mediaInitByMedia.delete(media);
    for (const [pointerId, entry] of this.pointerOwners) {
      if (entry.media === media) {
        this.removePointer(pointerId);
      }
    }
    this.activePointersByMedia.delete(media);
    if (this.spaceHoldMedia === media) {
      this.spaceHoldActive = false;
      this.spaceHoldMedia = null;
    }
  }

  /** Reset all document-scoped evidence during extension teardown. */
  reset() {
    this.lastGestureAt = 0;
    this.lastClickAt = 0;
    this.prevClickAt = 0;
    this.lastInputAt = 0;
    this.longPressEndAt = 0;
    this.clearTemporaryHolds();
    this.clicksByMedia = new WeakMap();
    this.activePointersByMedia = new WeakMap();
    this.seeksByMedia = new WeakMap();
    this.mediaInitByMedia = new WeakMap();
  }
}

window.VSC.IntentClassifier = IntentClassifier;
window.VSC.IntentClassifier.VERDICTS = CLASSIFIER_VERDICTS;
window.VSC.IntentClassifier.TARGET_RULES = TARGET_RULES;
window.VSC.IntentClassifier.USER_GESTURE_WINDOW_MS = USER_GESTURE_WINDOW_MS;
window.VSC.IntentClassifier.CLICK_SEQUENCE_WINDOW_MS = CLICK_SEQUENCE_WINDOW_MS;
window.VSC.IntentClassifier.SEEK_RESET_WINDOW_MS = SEEK_RESET_WINDOW_MS;
window.VSC.IntentClassifier.MEDIA_INIT_GRACE_MS = MEDIA_INIT_GRACE_MS;
window.VSC.IntentClassifier.QUIET_CONTEXT_MS = QUIET_CONTEXT_MS;
window.VSC.IntentClassifier.TEMPORARY_HOLD_RATE = TEMPORARY_HOLD_RATE;
window.VSC.IntentClassifier.LONG_PRESS_CLICK_MS = LONG_PRESS_CLICK_MS;
window.VSC.IntentClassifier.LONG_PRESS_CLICK_GRACE_MS = LONG_PRESS_CLICK_GRACE_MS;
window.VSC.IntentClassifier.UNRESOLVED_BIND_MAX_AGE_MS = UNRESOLVED_BIND_MAX_AGE_MS;
window.VSC.IntentClassifier.isNativeSpeedShortcutKey = isNativeSpeedShortcutKey;
