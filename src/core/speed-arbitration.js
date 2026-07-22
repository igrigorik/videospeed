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
 * - Effects execute through ActionHandler.adjustSpeed with the source
 *   taxonomy ('internal'/'external'/'init') — a transitional shape slated
 *   for replacement by explicit executor primitives (see the deferred-work
 *   register in the contract doc). The differential suite
 *   (tests/integration/arbiter-differential.test.js) pins the pipeline to
 *   the model either way.
 *
 * - Fight-back mechanics (exponential cooldown backoff, fight-window timer,
 *   stopImmediatePropagation) are execution details of the WRITE effect in
 *   fight context, preserved verbatim from the legacy handleRateChange.
 */

window.VSC = window.VSC || {};

class SpeedArbitration {
  /**
   * @param {Object} config - VideoSpeedConfig (settings must be loaded
   *   before decisions are requested)
   * @param {Object|null} eventManager - owning EventManager; null for
   *   lifecycle-only use (VideoController fallback), where cooldown and
   *   fight mechanics are not needed
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
    const EM = window.VSC.EventManager;
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
    if (effects.some((e) => e.type === A.EFFECTS.PERSIST)) {
      window.VSC.logger.info(
        `Accepting site speed change as user-intentional: ${rawRate} (input ${inputAge}ms ago)`
      );
      if (this.fightTimer) {
        clearTimeout(this.fightTimer);
        this.fightTimer = null;
      }
      this.classifier.consumeGesture();
      if (this.eventManager && this.eventManager.actionHandler) {
        this.eventManager.actionHandler.adjustSpeed(video, rawRate);
      }
      return;
    }

    // Cell 8 — fight back, with the legacy backoff mechanics.
    if (next.fightCount > prevFight) {
      if (this.fightTimer) {
        clearTimeout(this.fightTimer);
      }
      this.fightTimer = setTimeout(() => {
        this.fightCount = 0;
        this.fightTimer = null;
      }, SpeedArbitration.FIGHT_WINDOW_MS);

      const cooldown = Math.min(
        EM.BASE_COOLDOWN_MS * Math.pow(2, this.fightCount - 1),
        EM.MAX_COOLDOWN_MS
      );
      window.VSC.logger.info(
        `Fight detection: attempt ${this.fightCount}, re-applying ${state.desired} (cooldown ${cooldown}ms, input ${inputAge}ms ago)`
      );
      window.VSC.siteHandlerManager.handleSpeedChange(video, state.desired);
      if (this.eventManager) {
        this.eventManager.refreshCoolDown(cooldown);
      }
      event.stopImmediatePropagation();
      return;
    }

    // Cell 9 — budget exhausted: stand down. CLEAR_AUTHORITY nulls the
    // session authority projection so derivation, the cooldown-restore
    // branch, and cross-tab semantics all see "no opinion" uniformly.
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

    // Cells 3/10 + surrender fallthrough: observe/accept without persist.
    if (this.eventManager && this.eventManager.actionHandler) {
      this.eventManager.actionHandler.adjustSpeed(video, rawRate, { source: 'external' });
    }
  }

  /**
   * A user action through VSC claimed authority (cells 5/12). The effect
   * execution is setSpeed's job (the caller); this resets the fight state
   * per the contract — a fresh user choice starts with a clean budget.
   * Called by ActionHandler for source:'internal' speed changes.
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

// Fight detection: forgive the fight count after this quiet period (ms).
// Max cooldown (2000ms, EventManager.MAX_COOLDOWN_MS) plus one second, so a
// fight-back's own cooldown can never outlive the window that forgives it.
SpeedArbitration.FIGHT_WINDOW_MS = 3000;

/**
 * The migration-era POLICY object (per-flag compat switches + rule-set
 * selection) was retired when every flag reached target position; behavior
 * is now the contract itself. Flip history and rationale live in the git
 * log and at tag `arbitration-executable-history`.
 */

window.VSC.SpeedArbitration = SpeedArbitration;
