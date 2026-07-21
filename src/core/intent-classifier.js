/**
 * Intent classifier — the heuristic half of the speed arbitration split
 * (docs/speed-arbitration.md, "Architecture: classifier vs. arbiter").
 *
 * Consumes gesture observations (clicks, unhandled keys, pointer state) and
 * classifies each external ratechange as USER_INTENT / AUTONOMOUS /
 * INIT_NOISE / SELF. Every heuristic cites the evidence that motivated it;
 * ALL such heuristics live here and only here. The arbiter guarantees that
 * classifier mistakes are recoverable, never correct — see the contract doc.
 *
 * Two rule sets:
 *   LEGACY_RULES — current master behavior, for differential verification:
 *     any unhandled key and any click arm the gesture window. Known false
 *     positives: arrow-key seek (#1562/#1546), progress-bar clicks (#1581).
 *   TARGET_RULES — tiered evidence (see below). Only native speed
 *     shortcut keys arm strong key intent (PR #1563); clicks feed a
 *     sequence detector; adoption of a reset-to-1.0 requires STRONG
 *     evidence (#1581, fixed generically).
 *
 * Evidence tiers (TARGET_RULES):
 *   STRONG — native speed key, site signature (YT hold/space), or a click
 *     SEQUENCE (two clicks within CLICK_SEQUENCE_WINDOW_MS, the last
 *     within the gesture window). Real speed menus are always >= 2 clicks
 *     deep, so menu choices — including "Normal" — reach this tier
 *     naturally.
 *   WEAK — a single click within the gesture window. Sufficient to adopt
 *     any NON-1.0 value (sites have no reason to autonomously set 1.7x),
 *     but NOT a transition to 1.0: every documented false positive
 *     (#1581, #1562-class) is a click-side-effect reset to exactly 1.0.
 *   Otherwise AUTONOMOUS.
 *
 * Privacy: the evidence ledger is deliberately coarse — five in-memory
 * timestamps and one boolean (last generic input, last two clicks, last
 * speed-intent key, pointer-held). No positions, no key identities, no
 * element info, no event payloads; nothing persisted, nothing leaves the
 * page context, and every value is semantically dead after a few seconds.
 *
 * Per-site signature overrides (SITE_RULE_OVERRIDES): the generic temporal
 * heuristic is the scalable default; overrides exist only for documented
 * exceptions, in either direction:
 *   - additions: YouTube's press-and-hold 2x boost (#1554/#1568) — the only
 *     web player with this interaction in the evidence base, so
 *     pointerHoldArms is scoped to YouTube rather than trusted globally
 *     (rate changes during a held pointer have innocent causes elsewhere,
 *     e.g. scrub-preview).
 *   - suppressions: sites whose players reset playbackRate as a side
 *     effect of click-triggered seeks (#1581, Facebook) can turn click
 *     arming off — pending verification that the site has no native speed
 *     menu that would become collateral.
 * Every entry must cite its issue. This table IS the scaling strategy:
 * generic signal + evidence-driven exception list, mirroring how site
 * handlers already work for positioning.
 */

window.VSC = window.VSC || {};

const CLASSIFIER_VERDICTS = Object.freeze({
  SELF: 'SELF', // our own write echoing back — filtered before the arbiter
  USER_INTENT: 'USER_INTENT',
  AUTONOMOUS: 'AUTONOMOUS',
  INIT_NOISE: 'INIT_NOISE',
});

const LEGACY_RULES = Object.freeze({
  tiered: false, // flat 300ms window, any evidence adopts any value
  anyUnhandledKeyArms: true, // any key blesses the next ratechange
  clickArms: true,
  pointerHoldArms: false, // click-and-hold invisible until mouseup (#1554)
});

const TARGET_RULES = Object.freeze({
  tiered: true, // evidence tiers + value asymmetry (see header)
  anyUnhandledKeyArms: false, // only native speed shortcuts (PR #1563)
  clickArms: true, // clicks feed the sequence detector
  pointerHoldArms: false, // YouTube-only addition via SITE_RULE_OVERRIDES (#1554)
});

/**
 * Evidence-driven per-site exceptions to the generic rules. Keys are
 * hostname suffixes ('youtube.com' matches youtube.com and *.youtube.com).
 */
const SITE_RULE_OVERRIDES = Object.freeze({
  // Press-and-hold 2x boost (#1554/#1568): the pointer variant fires a
  // ratechange while the pointer is still down, before any click event
  // exists (PR #1555). The SPACEBAR variant of the same boost armed via
  // legacy any-key-arming — narrowed away by TARGET_RULES — so Space must
  // arm here explicitly (held Space auto-repeats keydown, keeping the
  // gesture window fresh through the hold and across the release reset).
  'youtube.com': Object.freeze({ pointerHoldArms: true, spacebarArms: true }),
  // (#1581 needs no entry: click-seek resets go to 1.0, and a 1.0 adoption
  // requires STRONG evidence under the tiered rules — fixed generically.)
});

/**
 * Compose the effective rule set for a host: base rules plus any per-site
 * override whose key suffix-matches the hostname.
 *
 * @param {Object} base - TARGET_RULES / LEGACY_RULES / POLICY rules
 * @param {string} hostname - e.g. window.location.hostname
 * @returns {Object} effective rules
 */
function rulesForHost(base, hostname) {
  const host = (hostname || '').toLowerCase();
  for (const [suffix, override] of Object.entries(SITE_RULE_OVERRIDES)) {
    if (host === suffix || host.endsWith(`.${suffix}`)) {
      return Object.freeze({ ...base, ...override });
    }
  }
  return base;
}

const USER_GESTURE_WINDOW_MS = 300; // ms after a gesture in which a ratechange reads as intent
// Two clicks this close together read as UI traversal (menu -> item), the
// signature of every real speed menu. Generous: users browse menus slowly.
const CLICK_SEQUENCE_WINDOW_MS = 5000;
// Autonomous resets land on exactly 1.0; tolerance for float noise.
const NORMAL_RATE_EPSILON = 0.005;

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
    this.lastClickAt = 0; // most recent click
    this.prevClickAt = 0; // click before that (sequence detection)
    this.lastInputAt = 0; // ANY user input (presence/quiet axis)
    this.pointerHeld = false; // site-scoped hold signature
  }

  /** Any user input at all — presence evidence only, never intent. */
  observeInput(event) {
    this.lastInputAt = event.timeStamp;
  }

  /** A keydown no VSC binding handled. */
  observeUnhandledKey(event) {
    this.lastInputAt = event.timeStamp;
    const isSpace = event.code === 'Space' || event.keyCode === 32;
    if (
      this.rules.anyUnhandledKeyArms ||
      isNativeSpeedShortcutKey(event) ||
      (this.rules.spacebarArms && isSpace)
    ) {
      this.lastGestureAt = event.timeStamp;
    }
  }

  /** A click that did not target the VSC controller. */
  observeClick(event) {
    this.lastInputAt = event.timeStamp;
    if (this.rules.tiered) {
      this.prevClickAt = this.lastClickAt;
      this.lastClickAt = event.timeStamp;
    } else if (this.rules.clickArms) {
      this.lastGestureAt = event.timeStamp;
    }
    if (this.rules.pointerHoldArms) {
      this.pointerHeld = false; // click fires on release
    }
  }

  /** Pointer pressed outside the VSC controller (PR #1555). */
  observePointerDown(event) {
    this.lastInputAt = event.timeStamp;
    if (this.rules.pointerHoldArms) {
      this.pointerHeld = true;
      this.lastGestureAt = event.timeStamp;
    }
  }

  /**
   * Classify an external ratechange. Mirrors the guard order of the legacy
   * handleRateChange so differential replay is faithful.
   *
   * @param {Object} ctx - { rate, timeStamp, readyState, detail }
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

    const withinWindow = (ts) =>
      ts > 0 && ctx.timeStamp - ts >= 0 && ctx.timeStamp - ts < USER_GESTURE_WINDOW_MS;

    if (!this.rules.tiered) {
      // Legacy flat window: any armed evidence adopts any value.
      if (withinWindow(this.lastGestureAt) || (this.rules.pointerHoldArms && this.pointerHeld)) {
        return CLASSIFIER_VERDICTS.USER_INTENT;
      }
      return CLASSIFIER_VERDICTS.AUTONOMOUS;
    }

    // Tiered evidence (see header).
    const clickInWindow = withinWindow(this.lastClickAt);
    const clickSequence =
      clickInWindow &&
      this.prevClickAt > 0 &&
      this.lastClickAt - this.prevClickAt <= CLICK_SEQUENCE_WINDOW_MS;
    const strong =
      withinWindow(this.lastGestureAt) ||
      (this.rules.pointerHoldArms && this.pointerHeld) ||
      clickSequence;
    const isNormalReset = Math.abs(ctx.rate - 1.0) < NORMAL_RATE_EPSILON;

    if (strong || (clickInWindow && !isNormalReset)) {
      return CLASSIFIER_VERDICTS.USER_INTENT;
    }
    return CLASSIFIER_VERDICTS.AUTONOMOUS;
  }

  /**
   * One-shot semantics: called by the adapter when a USER_INTENT verdict was
   * actually adopted, mirroring legacy's lastUserInteractionAt = 0 reset in
   * the accept branch.
   */
  consumeGesture() {
    this.lastGestureAt = 0;
    this.lastClickAt = 0;
    this.prevClickAt = 0;
  }
}

window.VSC.IntentClassifier = IntentClassifier;
window.VSC.IntentClassifier.VERDICTS = CLASSIFIER_VERDICTS;
window.VSC.IntentClassifier.LEGACY_RULES = LEGACY_RULES;
window.VSC.IntentClassifier.TARGET_RULES = TARGET_RULES;
window.VSC.IntentClassifier.USER_GESTURE_WINDOW_MS = USER_GESTURE_WINDOW_MS;
window.VSC.IntentClassifier.CLICK_SEQUENCE_WINDOW_MS = CLICK_SEQUENCE_WINDOW_MS;
window.VSC.IntentClassifier.isNativeSpeedShortcutKey = isNativeSpeedShortcutKey;
window.VSC.IntentClassifier.SITE_RULE_OVERRIDES = SITE_RULE_OVERRIDES;
window.VSC.IntentClassifier.rulesForHost = rulesForHost;
