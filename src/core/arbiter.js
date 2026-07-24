/**
 * Speed arbitration state machine — the pure per-media conflict core.
 *
 * A document owns one desired speed, while each controlled media element owns
 * a conflict state. The adapter supplies the current shared desired speed
 * when it materializes this state and executes the returned effects. This
 * module deliberately knows nothing about DOM, storage, timers, or media
 * identity; specs/SpeedArbiter.tla is its machine-checked twin.
 */

window.VSC = window.VSC || {};

const MODES = Object.freeze({
  NO_OPINION: 'NO_OPINION', // no document-wide authority exists
  HOLDING: 'HOLDING', // enforce the shared authority for this media element
  REARMABLE: 'REARMABLE', // one quiet-war lifecycle restoration remains
  SUPPRESSED: 'SUPPRESSED', // this media surrendered; other media still hold
});

const ARBITER_EVENTS = Object.freeze({
  USER_SET: 'USER_SET', // user acted through VSC UI/shortcuts/popup
  TEMPORARY_OVERRIDE_START: 'TEMPORARY_OVERRIDE_START', // site-specific native hold began
  TEMPORARY_OVERRIDE_END: 'TEMPORARY_OVERRIDE_END', // native hold released
  EXT_RATE: 'EXT_RATE', // external ratechange, already classified
  LIFECYCLE: 'LIFECYCLE', // play / seeked / deferred loadedmetadata
  FIGHT_WINDOW_EXPIRE: 'FIGHT_WINDOW_EXPIRE', // quiet period elapsed
});

const RATE_CLASSES = Object.freeze({
  USER_INTENT: 'USER_INTENT', // native site controls driven by the user
  AUTONOMOUS: 'AUTONOMOUS', // site acted on its own
  INIT_NOISE: 'INIT_NOISE', // player initialization churn
});

const ARBITER_EFFECTS = Object.freeze({
  WRITE: 'WRITE', // set one video.playbackRate
  PERSIST: 'PERSIST', // claim shared session authority
  SYNC_UI: 'SYNC_UI', // update one controller's speed indicator only
});

// Legacy MAX_FIGHT_COUNT was 5 but incremented before checking, so it fought
// back four times and surrendered on the fifth reset.
const DEFAULT_MAX_FIGHT = 4;

// A quiet machine-vs-machine war gets one local lifecycle re-arm per authority
// epoch. A fresh user/native authority claim starts a new epoch and resets it.
const DEFAULT_REARM_BUDGET = 1;

/**
 * Build a fresh local conflict state from load-time shared authority.
 *
 * @param {Object} init
 * @param {number|null} init.siteRuleSpeed
 * @param {number|null} init.rememberedSpeed
 * @param {boolean} init.rememberEnabled
 * @returns {Object}
 */
function loadState(init) {
  const { siteRuleSpeed = null, rememberedSpeed = null, rememberEnabled = false } = init || {};

  if (siteRuleSpeed !== null && siteRuleSpeed !== undefined) {
    return makeState(MODES.HOLDING, siteRuleSpeed, 0);
  }
  if (rememberEnabled && rememberedSpeed !== null && rememberedSpeed !== undefined) {
    return makeState(MODES.HOLDING, rememberedSpeed, 0);
  }
  return makeState(MODES.NO_OPINION, null, 0);
}

/**
 * @param {string} mode
 * @param {number|null} desired - shared authority, null only in NO_OPINION
 * @param {number} fightCount
 * @param {boolean} [warQuiet]
 * @param {number} [rearmBudget]
 * @param {boolean} [temporaryOverride]
 * @returns {Object}
 */
function makeState(mode, desired, fightCount, warQuiet, rearmBudget, temporaryOverride = false) {
  return Object.freeze({
    mode,
    desired,
    fightCount,
    warQuiet: warQuiet ?? true,
    rearmBudget: rearmBudget ?? DEFAULT_REARM_BUDGET,
    // A native temporary override is orthogonal to the underlying conflict
    // phase: ending it must not silently re-arm or unsuppress a local war.
    temporaryOverride,
  });
}

function effect(type, speed) {
  return Object.freeze({ type, speed });
}

/**
 * Advance one media element's conflict state.
 *
 * USER_SET and USER_INTENT start a fresh shared-authority epoch in the
 * adapter, so this local projection resets its re-arm budget as well. A
 * surrender transitions only this local state to SUPPRESSED/REARMABLE; it
 * never removes the shared desired speed held by other media elements.
 *
 * @param {Object} state
 * @param {Object} event - { type, speed?, rateClass?, quiet? }
 * @param {Object} [options]
 * @param {number} [options.maxFight]
 * @returns {{state: Object, effects: Array}}
 */
function step(state, event, options = {}) {
  const maxFight = options.maxFight ?? DEFAULT_MAX_FIGHT;

  switch (event.type) {
    case ARBITER_EVENTS.USER_SET:
      return {
        state: makeState(MODES.HOLDING, event.speed, 0, true, DEFAULT_REARM_BUDGET),
        effects: [
          effect(ARBITER_EFFECTS.WRITE, event.speed),
          effect(ARBITER_EFFECTS.PERSIST, event.speed),
          effect(ARBITER_EFFECTS.SYNC_UI, event.speed),
        ],
      };

    case ARBITER_EVENTS.TEMPORARY_OVERRIDE_START:
      // Without shared VSC authority there is nothing to restore after the
      // native hold. Keep the core aligned with the adapter, which does not
      // materialize a media-local conflict record in NO_OPINION.
      if (state.mode === MODES.NO_OPINION || state.desired === null) {
        return { state, effects: [effect(ARBITER_EFFECTS.SYNC_UI, event.speed)] };
      }
      return {
        state: makeState(
          state.mode,
          state.desired,
          state.fightCount,
          state.warQuiet,
          state.rearmBudget,
          true
        ),
        effects: [effect(ARBITER_EFFECTS.SYNC_UI, event.speed)],
      };

    case ARBITER_EVENTS.TEMPORARY_OVERRIDE_END: {
      const next = makeState(
        state.mode,
        state.desired,
        state.fightCount,
        state.warQuiet,
        state.rearmBudget
      );
      if (next.mode === MODES.HOLDING && next.desired !== null) {
        const effects = [];
        if (event.speed !== next.desired) {
          effects.push(effect(ARBITER_EFFECTS.WRITE, next.desired));
        }
        effects.push(effect(ARBITER_EFFECTS.SYNC_UI, next.desired));
        return { state: next, effects };
      }
      return { state: next, effects: [effect(ARBITER_EFFECTS.SYNC_UI, event.speed)] };
    }

    case ARBITER_EVENTS.LIFECYCLE:
      // A temporary native boost deliberately owns the register until its
      // release event. Lifecycle healing must not cancel that user-visible hold.
      if (state.temporaryOverride) {
        return { state, effects: [] };
      }
      if (state.mode === MODES.HOLDING) {
        return { state, effects: [effect(ARBITER_EFFECTS.WRITE, state.desired)] };
      }
      if (state.mode === MODES.REARMABLE) {
        return {
          state: makeState(MODES.HOLDING, state.desired, 0, true, state.rearmBudget),
          effects: [effect(ARBITER_EFFECTS.WRITE, state.desired)],
        };
      }
      return { state, effects: [] };

    case ARBITER_EVENTS.EXT_RATE: {
      const rate = event.speed;
      // Any ordinary external observation ends a temporary override. The
      // adapter maps the known native release to TEMPORARY_OVERRIDE_END first;
      // this fallback prevents a stale hold from masking later site behavior.
      const activeState = state.temporaryOverride
        ? makeState(state.mode, state.desired, state.fightCount, state.warQuiet, state.rearmBudget)
        : state;

      switch (event.rateClass) {
        case RATE_CLASSES.INIT_NOISE:
          return { state: activeState, effects: [] };

        case RATE_CLASSES.USER_INTENT:
          return {
            state: makeState(MODES.HOLDING, rate, 0, true, DEFAULT_REARM_BUDGET),
            effects: [effect(ARBITER_EFFECTS.PERSIST, rate), effect(ARBITER_EFFECTS.SYNC_UI, rate)],
          };

        case RATE_CLASSES.AUTONOMOUS:
          if (activeState.mode === MODES.HOLDING && rate !== activeState.desired) {
            if (activeState.fightCount < maxFight) {
              const warQuiet =
                activeState.fightCount === 0
                  ? !!event.quiet
                  : activeState.warQuiet && !!event.quiet;
              return {
                state: makeState(
                  MODES.HOLDING,
                  activeState.desired,
                  activeState.fightCount + 1,
                  warQuiet,
                  activeState.rearmBudget
                ),
                effects: [effect(ARBITER_EFFECTS.WRITE, activeState.desired)],
              };
            }

            const fullyQuiet = activeState.warQuiet && !!event.quiet;
            const nextMode =
              fullyQuiet && activeState.rearmBudget > 0 ? MODES.REARMABLE : MODES.SUPPRESSED;
            const nextBudget =
              nextMode === MODES.REARMABLE ? activeState.rearmBudget - 1 : activeState.rearmBudget;
            return {
              state: makeState(nextMode, activeState.desired, 0, true, nextBudget),
              effects: [effect(ARBITER_EFFECTS.SYNC_UI, rate)],
            };
          }
          return { state: activeState, effects: [effect(ARBITER_EFFECTS.SYNC_UI, rate)] };

        default:
          throw new TypeError(`SpeedArbiter: unknown rate class ${event.rateClass}`);
      }
    }

    case ARBITER_EVENTS.FIGHT_WINDOW_EXPIRE:
      if (state.fightCount === 0) {
        return { state, effects: [] };
      }
      return {
        state: makeState(
          state.mode,
          state.desired,
          0,
          true,
          state.rearmBudget,
          state.temporaryOverride
        ),
        effects: [],
      };

    default:
      throw new TypeError(`SpeedArbiter: unknown event type ${event.type}`);
  }
}

window.VSC.SpeedArbiter = {
  MODES,
  EVENTS: ARBITER_EVENTS,
  RATE_CLASSES,
  EFFECTS: ARBITER_EFFECTS,
  DEFAULT_MAX_FIGHT,
  DEFAULT_REARM_BUDGET,
  loadState,
  step,
};
