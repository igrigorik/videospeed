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
 * - Effects execute through ActionHandler.adjustSpeed with the legacy
 *   source taxonomy ('internal'/'external'/'init'), so persistence behavior
 *   (including the F1 save-merge quirk) stays bit-for-bit until the
 *   corresponding flags flip. The differential suite
 *   (tests/integration/arbiter-differential.test.js) is the proof.
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
    this.compat = SpeedArbitration.POLICY.compat;
    this.classifier = new window.VSC.IntentClassifier({
      rules: SpeedArbitration.POLICY.rules,
      minRate: window.VSC.Constants.SPEED_LIMITS.MIN,
    });
    this.fightCount = 0;
    this.fightTimer = null;
  }

  /**
   * Derive the arbiter state from settings (see the Wave-2 note above).
   * Mirrors the legacy authority tests: lastSpeed !== null <=> HOLDING;
   * siteDefaultSpeed (or 1.0) is the F5 baseline.
   * @private
   */
  deriveState() {
    const A = window.VSC.SpeedArbiter;
    const s = this.config.settings;
    const baseline = s.siteDefaultSpeed ?? 1.0;
    const rememberEnabled = !!s.rememberSpeed;

    if (s.lastSpeed !== null && s.lastSpeed !== undefined) {
      return {
        mode: A.MODES.HOLDING,
        desired: s.lastSpeed,
        fightCount: this.fightCount,
        baseline,
        rememberEnabled,
      };
    }
    return {
      mode: A.MODES.NO_OPINION,
      desired: null,
      fightCount: this.fightCount,
      baseline,
      rememberEnabled,
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
    const { state: next, effects } = A.step(
      state,
      { type: A.EVENTS.EXT_RATE, speed: speedForDecision, rateClass: cls },
      { compat: this.compat }
    );
    this.fightCount = next.fightCount;

    // Cells 2/7 — adoption: the user drove the site's native controls.
    if (effects.some((e) => e.type === A.EFFECTS.PERSIST)) {
      window.VSC.logger.info(`Accepting site speed change as user-intentional: ${rawRate}`);
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
        `Fight detection: attempt ${this.fightCount}, re-applying ${state.desired} (cooldown ${cooldown}ms)`
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
    if (this.fightTimer) {
      clearTimeout(this.fightTimer);
      this.fightTimer = null;
    }
  }

  /**
   * Lifecycle decision (cells 1/6): what, if anything, should the
   * register be set to on play/seeked/deferred-init?
   *
   * @returns {number|null} target speed, or null for "no write" (cell 1;
   *   never null under full legacy compat)
   */
  lifecycleTarget() {
    const A = window.VSC.SpeedArbiter;
    const { effects } = A.step(
      this.deriveState(),
      { type: A.EVENTS.LIFECYCLE },
      { compat: this.compat }
    );
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
 * Production arbitration policy — the single place behavior flips happen.
 * Every line cites its bug-ledger entry in
 * tests/integration/arbiter-differential.test.js; flipping a line is a
 * complete, individually revertable behavior change.
 *
 * NOTE the cell-1 / F5 coupling: with legacyNoOpinionLifecycle=false,
 * lifecycle events no longer write a baseline, so site rules MUST be
 * initial authority (legacySiteRuleLoad=false + settings.load() seeding
 * lastSpeed from the rule) or rules would never be enforced at all. These
 * two flags flip together or not at all.
 */
SpeedArbitration.POLICY = {
  compat: Object.freeze({
    legacyNoOpinionLifecycle: false, // cell 1 fixed (#1537) — release N
    legacyLifecyclePersist: false, // F1 fixed (with setSpeed init-persist fix) — release N
    legacySiteRuleLoad: false, // F5 fixed (rule = initial authority) — release N, coupled to cell 1
    legacyShallowSurrender: false, // F2 fixed (real surrender = stand down to NO_OPINION)
    legacyNoAdoption: false, // F3 fixed (native speed choices become authority)
  }),
  rules: null, // assigned below; IntentClassifier must be loaded first
};
SpeedArbitration.POLICY.rules = window.VSC.IntentClassifier.TARGET_RULES; // #1562/#1546/#1554/#1568 fixed — release N
Object.freeze(SpeedArbitration.POLICY);

window.VSC.SpeedArbitration = SpeedArbitration;
