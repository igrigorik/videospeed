/**
 * Speed arbitration adapter — wires DOM reality to the pure arbiter.
 *
 * Composition (docs/speed-arbitration.md, "Architecture"):
 *   DOM events -> IntentClassifier (evidence + verdicts, heuristic)
 *              -> SpeedArbiter.step (pure decision, verified)
 *              -> effect execution through the existing ActionHandler paths
 *
 * Design notes:
 *
 * - Arbiter state is DERIVED from config.settings on every decision rather
 *   than owned: settings.lastSpeed IS the session authority (null = no
 *   opinion), kept storage-listener-synced across tabs. This survived the
 *   F2 flip because surrender collapsed into "clear session authority and
 *   stand down to NO_OPINION" (see cell 9) — there is no separate
 *   surrendered mode to remember, so derivation stays total. Fight
 *   bookkeeping (count + window timer) is the only adapter-owned state.
 *
 * - Effects execute through named primitives, one per effect in the
 *   contract's vocabulary: WRITE -> ActionHandler.writeRate, SYNC_UI ->
 *   ActionHandler.syncIndicator, PERSIST -> config.persistAuthority,
 *   CLEAR_AUTHORITY -> config.clearSessionAuthority, RESTORE_AUTHORITY ->
 *   config.restoreSessionAuthority. The adapter chooses raw-vs-snapped
 *   values per branch (an execution detail: display follows the register's
 *   actual value, decisions use the snapped one). The differential suite
 *   (tests/integration/arbiter-differential.test.js) pins the pipeline to
 *   the model.
 *
 * - Echo filtering is a write-token registry (noteWrite/consumeEcho), not a
 *   time-based cooldown: every WRITE records the value it expects to see
 *   echo back as a native ratechange; EventManager.handleRateChange consumes
 *   a matching token and drops the event. Everything unmatched is genuinely
 *   external and reaches the arbiter — so a reactive site that rewrites the
 *   rate in response to our writes produces budget-accounted fight
 *   exchanges (surrender in MAX_FIGHT rounds) instead of an invisible
 *   cooldown-masked write war. Fight pacing is deliberately budget-only:
 *   no temporal spacing between fight-backs, because the bound that
 *   matters (attrition safety) is the count, not the rate.
 *
 * - Fight-back mechanics (fight-window timer, stopImmediatePropagation)
 *   are execution details of the WRITE effect in fight context.
 */

window.VSC = window.VSC || {};

class SpeedArbitration {
  /**
   * @param {Object} config - VideoSpeedConfig (settings must be loaded
   *   before decisions are requested)
   * @param {Object|null} eventManager - owning EventManager; null for
   *   lifecycle-only use (VideoController fallback), where echo filtering
   *   and fight mechanics are not needed
   */
  constructor(config, eventManager) {
    this.config = config;
    this.eventManager = eventManager;
    this.classifier = new window.VSC.IntentClassifier({
      // Generic policy rules composed with evidence-driven per-site
      // exceptions (e.g. YouTube's hold-for-2x) for the current host.
      rules: window.VSC.IntentClassifier.rulesForHost(
        window.VSC.IntentClassifier.TARGET_RULES,
        typeof window !== 'undefined' && window.location ? window.location.hostname : ''
      ),
      minRate: window.VSC.Constants.SPEED_LIMITS.MIN,
    });
    this.fightCount = 0;
    this.fightTimer = null;
    // Quiet-war re-arm bookkeeping (cells 9b/14): the pre-war speed pending
    // restoration, whether the whole current war has been quiet-context,
    // and the per-session re-arm budget.
    this.rearmPendingSpeed = null;
    this.warQuiet = true;
    this.rearmBudget = window.VSC.SpeedArbiter.DEFAULT_REARM_BUDGET;
    // In-flight write registry (echo filter): per-video FIFO of rates we
    // have written whose native ratechange echo has not been observed yet.
    this.pendingWrites = new WeakMap();
  }

  /**
   * Record an extension-issued register write (WRITE effect). The native
   * ratechange it produces is consumed by consumeEcho, so the classifier
   * and arbiter only ever see genuinely external events. Called by
   * ActionHandler.writeRate — the single WRITE primitive.
   *
   * @param {HTMLMediaElement} video
   * @param {number} rate - the value written (post-rounding)
   */
  noteWrite(video, rate) {
    let queue = this.pendingWrites.get(video);
    if (!queue) {
      queue = [];
      this.pendingWrites.set(video, queue);
    }
    queue.push({ rate, at: performance.now() });
    // The length cap is the primary bound (robust when clocks are faked in
    // tests); the TTL prune in consumeEcho is the temporal one. Sized for
    // held-key repeat bursts: echoes are queued tasks, so at most a
    // handful of writes are ever genuinely in flight.
    if (queue.length > SpeedArbitration.ECHO_MAX_PENDING) {
      queue.shift();
    }
  }

  /**
   * Try to match a ratechange against the in-flight write registry.
   *
   * Matching is value-tolerant (players may quantize what we wrote) and
   * FIFO: a match also retires older pending writes, whose echoes were
   * coalesced by the player (rapid successive assignments can fire a
   * single ratechange for the final value).
   *
   * A swallowed same-value site write is benign by the same argument as
   * the tolerance demotion in onExternalRate: a write that lands within
   * tolerance of what we last wrote is a non-divergence (cell 10 no-op).
   *
   * @param {HTMLMediaElement} video
   * @param {number} rate - the observed playbackRate
   * @returns {boolean} true if the event was our own write echoing back
   */
  consumeEcho(video, rate) {
    const queue = this.pendingWrites.get(video);
    if (!queue || queue.length === 0) {
      return false;
    }
    const now = performance.now();
    while (queue.length && now - queue[0].at > SpeedArbitration.ECHO_TTL_MS) {
      queue.shift();
    }
    const idx = queue.findIndex((w) => Math.abs(w.rate - rate) <= SpeedArbitration.ECHO_TOLERANCE);
    if (idx === -1) {
      return false;
    }
    queue.splice(0, idx + 1);
    return true;
  }

  /**
   * Derive the arbiter state: lastSpeed is the session authority
   * (null = no opinion), with adapter-owned rearm bookkeeping layered on.
   * @private
   */
  deriveState() {
    const A = window.VSC.SpeedArbiter;
    const s = this.config.settings;

    if (s.lastSpeed !== null && s.lastSpeed !== undefined) {
      return {
        mode: A.MODES.HOLDING,
        desired: s.lastSpeed,
        fightCount: this.fightCount,
        warQuiet: this.warQuiet,
        rearmBudget: this.rearmBudget,
      };
    }
    if (this.rearmPendingSpeed !== null) {
      return {
        mode: A.MODES.REARMABLE,
        desired: this.rearmPendingSpeed,
        fightCount: this.fightCount,
        warQuiet: this.warQuiet,
        rearmBudget: this.rearmBudget,
      };
    }
    return {
      mode: A.MODES.NO_OPINION,
      desired: null,
      fightCount: this.fightCount,
      warQuiet: this.warQuiet,
      rearmBudget: this.rearmBudget,
    };
  }

  /**
   * Decide and execute for an external (non-self, non-init) ratechange.
   * Caller has already filtered SELF echoes and INIT_NOISE.
   *
   * @param {HTMLMediaElement} video
   * @param {Event} event - the ratechange event (for timing + propagation)
   * @param {string} verdict - classifier verdict (USER_INTENT | AUTONOMOUS)
   */
  onExternalRate(video, event, verdict) {
    const A = window.VSC.SpeedArbiter;
    const IC = window.VSC.IntentClassifier;
    const rawRate = video.playbackRate;
    const state = this.deriveState();

    // Legacy tolerance: within 0.01 of authority is "no divergence" — it
    // neither triggers a fight nor reaches the accept branch (cell 10).
    // Snap the decision input so the arbiter sees non-divergence; execution
    // below still uses the actual rate, as legacy did.
    let cls = verdict;
    let speedForDecision = rawRate;
    if (state.mode === A.MODES.HOLDING && Math.abs(rawRate - state.desired) <= 0.01) {
      speedForDecision = state.desired;
      if (cls === IC.VERDICTS.USER_INTENT) {
        cls = IC.VERDICTS.AUTONOMOUS;
      }
    }

    const prevFight = this.fightCount;
    const { state: next, effects } = A.step(state, {
      type: A.EVENTS.EXT_RATE,
      speed: speedForDecision,
      rateClass: cls,
      quiet: this.classifier.isQuietContext(event.timeStamp),
    });
    this.fightCount = next.fightCount;
    this.warQuiet = next.warQuiet;
    this.rearmBudget = next.rearmBudget;
    if (next.mode === A.MODES.REARMABLE && state.mode !== A.MODES.REARMABLE) {
      this.rearmPendingSpeed = state.desired; // quiet-war stand-down (cell 9b)
    } else if (next.mode !== A.MODES.REARMABLE) {
      this.rearmPendingSpeed = null; // adoption or user action cancels a pending re-arm
    }

    const inputAge =
      this.classifier.lastInputAt > 0
        ? Math.round(event.timeStamp - this.classifier.lastInputAt)
        : -1;

    // Cells 2/7 — adoption: the user drove the site's native controls.
    // Effects PERSIST + SYNC_UI; no WRITE — the register already holds the
    // user's chosen value, we adopt it rather than re-writing it.
    if (effects.some((e) => e.type === A.EFFECTS.PERSIST)) {
      const adopted = Number(rawRate.toFixed(2));
      window.VSC.logger.info(
        `Accepting site speed change as user-intentional: ${rawRate} (input ${inputAge}ms ago)`
      );
      if (this.fightTimer) {
        clearTimeout(this.fightTimer);
        this.fightTimer = null;
      }
      this.classifier.consumeGesture();
      this.config.persistAuthority(adopted);
      this.eventManager?.actionHandler?.syncIndicator(video, adopted);
      return;
    }

    // Cell 8 — fight back: WRITE(desired). The write takes an echo token
    // (via writeRate), so only the site's next counter-write — a genuinely
    // external event — comes back around, incrementing the fight count.
    // Pacing is budget-only by design; see the header note.
    if (next.fightCount > prevFight) {
      if (this.fightTimer) {
        clearTimeout(this.fightTimer);
      }
      this.fightTimer = setTimeout(() => {
        this.fightCount = 0;
        this.fightTimer = null;
      }, SpeedArbitration.FIGHT_WINDOW_MS);

      window.VSC.logger.info(
        `Fight detection: attempt ${this.fightCount}, re-applying ${state.desired} (input ${inputAge}ms ago)`
      );
      this.eventManager?.actionHandler?.writeRate(video, state.desired);
      event.stopImmediatePropagation();
      return;
    }

    // Cell 9 — budget exhausted: stand down. CLEAR_AUTHORITY nulls the
    // session authority projection so derivation and cross-tab semantics
    // all see "no opinion" uniformly.
    if (effects.some((e) => e.type === A.EFFECTS.CLEAR_AUTHORITY)) {
      window.VSC.logger.info(
        `Fight detection: surrendering after ${prevFight} resets. Standing down at site speed ${rawRate}`
      );
      if (this.fightTimer) {
        clearTimeout(this.fightTimer);
        this.fightTimer = null;
      }
      this.config.clearSessionAuthority();
    }

    // Cells 3/10 + surrender fallthrough: observe — SYNC_UI only, never
    // persist, never write (observation must not modify the register).
    this.eventManager?.actionHandler?.syncIndicator(video, rawRate);
  }

  /**
   * A user action through VSC claimed authority (cells 5/12). Effect
   * execution is the caller's job (ActionHandler.adjustSpeed runs the
   * USER_SET effect row); this resets the fight state per the contract —
   * a fresh user choice starts with a clean budget.
   */
  noteUserSet() {
    this.fightCount = 0;
    this.warQuiet = true;
    this.rearmPendingSpeed = null; // a fresh user choice supersedes any pending re-arm
    if (this.fightTimer) {
      clearTimeout(this.fightTimer);
      this.fightTimer = null;
    }
  }

  /**
   * Lifecycle decision (cells 1/6): what, if anything, should the
   * register be set to on play/seeked/deferred-init?
   *
   * @returns {number|null} target speed, or null for "no write" (cell 1)
   */
  lifecycleTarget() {
    const A = window.VSC.SpeedArbiter;
    const state = this.deriveState();
    const { state: next, effects } = A.step(state, { type: A.EVENTS.LIFECYCLE });
    const restore = effects.find((e) => e.type === A.EFFECTS.RESTORE_AUTHORITY);
    if (restore) {
      // Cell 14: quiet-war re-arm fires — restore session authority (memory
      // only), consume the pending slot. The caller executes the WRITE.
      this.config.restoreSessionAuthority(restore.speed);
      this.rearmPendingSpeed = null;
      this.warQuiet = next.warQuiet;
      this.rearmBudget = next.rearmBudget;
    }
    const write = effects.find((e) => e.type === A.EFFECTS.WRITE);
    return write ? write.speed : null;
  }

  cleanup() {
    if (this.fightTimer) {
      clearTimeout(this.fightTimer);
      this.fightTimer = null;
    }
    this.fightCount = 0;
  }
}

// Fight detection: forgive the fight count after this quiet period (ms) —
// isolated resets spread over time never accumulate into a surrender.
SpeedArbitration.FIGHT_WINDOW_MS = 3000;

// Echo filter tuning (replaces the legacy 200ms blanket cooldown).
// Tolerance is one 2-decimal rounding step plus float headroom: a player
// that quantizes our written value still matches; anything further off is
// a genuine external change and must reach the arbiter (a fight exchange
// with a clamping player then terminates on the fight budget).
SpeedArbitration.ECHO_TOLERANCE = 0.011;
// ratechange is a queued task — echoes normally land within one macrotask.
// The TTL only exists to retire tokens whose echo never fired (e.g. the
// player swallowed the write); generous because staleness is near-benign
// (a swallowed same-value site write is a cell-10 no-op).
SpeedArbitration.ECHO_TTL_MS = 500;
// Hard bound on in-flight tokens per video (primary bound where clocks are
// faked); sized for held-key repeat bursts.
SpeedArbitration.ECHO_MAX_PENDING = 8;

/**
 * The migration-era POLICY object (per-flag compat switches + rule-set
 * selection) was retired when every flag reached target position; behavior
 * is now the contract itself. Flip history and rationale live in the git
 * log and at tag `arbitration-executable-history`.
 */

window.VSC.SpeedArbitration = SpeedArbitration;
