/**
 * Speed arbitration state machine — the pure decision core.
 *
 * Implements the transition table in docs/speed-arbitration.md; cell numbers
 * in comments refer to that table. The machine-checked twin of this module is
 * specs/SpeedArbiter.tla — the two must change together.
 *
 * Contract: step() is pure and total over the event alphabet — no DOM, no
 * timers, no storage, inputs never mutated. Adapters translate DOM reality
 * into classified events; the effect executor is the only code allowed to
 * act on the returned effects (single-write discipline).
 *
 * Legacy-compat flags reproduce current-master behavior for the known
 * contract deviations, so the strangler-fig migration can land as a
 * behavior-preserving refactor first (all flags legacy => bit-for-bit
 * current behavior, verified by the differential harness) and each contract
 * fix ships later as an individually revertable one-flag change.
 */

window.VSC = window.VSC || {};

const MODES = Object.freeze({
  NO_OPINION: 'NO_OPINION',
  HOLDING: 'HOLDING',
  SURRENDERED: 'SURRENDERED',
});

const ARBITER_EVENTS = Object.freeze({
  USER_SET: 'USER_SET', // user acted through VSC UI/shortcuts/popup
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
  WRITE: 'WRITE', // set video.playbackRate
  PERSIST: 'PERSIST', // update lastSpeed (memory + debounced storage)
  SYNC_UI: 'SYNC_UI', // update the speed indicator only
  // Exists ONLY to mirror finding F1 (setSpeed step-6 writes storage on
  // source:'init' while skipping in-memory lastSpeed) under legacy compat,
  // so the differential harness can match current behavior exactly. The
  // target contract never emits it.
  LEGACY_PERSIST_STORAGE_ONLY: 'LEGACY_PERSIST_STORAGE_ONLY',
});

/**
 * All flags false = the target contract (the table as written).
 * All flags true  = current master behavior for the deviating cells.
 */
const TARGET_COMPAT = Object.freeze({
  legacyNoOpinionLifecycle: false, // cell 1: write baseline on lifecycle (#1537)
  legacyLifecyclePersist: false, // cell 6: persist to storage on lifecycle (F1)
  legacyShallowSurrender: false, // cell 9: keep authority after surrender (F2)
  legacyNoAdoption: false, // cell 2: ignore user-intent without prior authority (F3)
  legacySiteRuleLoad: false, // LOAD: site rule as baseline, not authority (F5)
});

const LEGACY_COMPAT = Object.freeze({
  legacyNoOpinionLifecycle: true,
  legacyLifecyclePersist: true,
  legacyShallowSurrender: true,
  legacyNoAdoption: true,
  legacySiteRuleLoad: true,
});

const DEFAULT_MAX_FIGHT = 5; // mirrors EventManager.MAX_FIGHT_COUNT

/**
 * Build the initial arbiter state from load-time inputs (LOAD in the table).
 *
 * Target priority: site rule => HOLDING(rule); remembered speed =>
 * HOLDING(remembered); otherwise NO_OPINION.
 *
 * Legacy (F5): a site rule does NOT become fightable authority — lastSpeed
 * stays null while lifecycle events enforce the rule as a baseline. Modeled
 * as NO_OPINION with `baseline` carrying the rule speed.
 *
 * @param {Object} init
 * @param {number|null} init.siteRuleSpeed - per-site rule speed, if any
 * @param {number|null} init.rememberedSpeed - stored lastSpeed, if any
 * @param {boolean} init.rememberEnabled - rememberSpeed setting
 * @param {Object} compat - compat flags (TARGET_COMPAT / LEGACY_COMPAT)
 * @returns {Object} initial arbiter state
 */
function loadState(init, compat = TARGET_COMPAT) {
  const { siteRuleSpeed = null, rememberedSpeed = null, rememberEnabled = false } = init || {};

  if (siteRuleSpeed !== null && siteRuleSpeed !== undefined) {
    if (compat.legacySiteRuleLoad) {
      return makeState(MODES.NO_OPINION, null, 0, siteRuleSpeed);
    }
    return makeState(MODES.HOLDING, siteRuleSpeed, 0, 1.0);
  }

  if (rememberEnabled && rememberedSpeed !== null && rememberedSpeed !== undefined) {
    return makeState(MODES.HOLDING, rememberedSpeed, 0, 1.0);
  }

  return makeState(MODES.NO_OPINION, null, 0, 1.0);
}

/**
 * @param {string} mode
 * @param {number|null} desired - authoritative target; null iff not HOLDING
 * @param {number} fightCount
 * @param {number} baseline - lifecycle target when legacy compat forces a
 *   write without authority (site rule under F5, else 1.0)
 */
function makeState(mode, desired, fightCount, baseline) {
  return Object.freeze({ mode, desired, fightCount, baseline });
}

function effect(type, speed) {
  return Object.freeze({ type, speed });
}

/**
 * The arbitration step: pure and total over the event alphabet.
 *
 * @param {Object} state - arbiter state from loadState()/previous step()
 * @param {Object} event - { type, speed?, rateClass? }
 * @param {Object} [options]
 * @param {Object} [options.compat] - compat flags, default TARGET_COMPAT
 * @param {number} [options.maxFight] - fight budget, default 5
 * @returns {{state: Object, effects: Array}} next state and effects to execute
 */
function step(state, event, options = {}) {
  const compat = options.compat || TARGET_COMPAT;
  const maxFight = options.maxFight ?? DEFAULT_MAX_FIGHT;

  switch (event.type) {
    // Cells 5, 12, 16: the user spoke through VSC — unconditional authority.
    case ARBITER_EVENTS.USER_SET: {
      return {
        state: makeState(MODES.HOLDING, event.speed, 0, state.baseline),
        effects: [
          effect(ARBITER_EFFECTS.WRITE, event.speed),
          effect(ARBITER_EFFECTS.PERSIST, event.speed),
          effect(ARBITER_EFFECTS.SYNC_UI, event.speed),
        ],
      };
    }

    // Cells 1, 6, 14: play / seeked / deferred loadedmetadata.
    case ARBITER_EVENTS.LIFECYCLE: {
      if (state.mode === MODES.HOLDING) {
        // Cell 6: re-assert; never persist (#1494). Legacy F1: the restore
        // leaks to storage.
        const effects = [effect(ARBITER_EFFECTS.WRITE, state.desired)];
        if (compat.legacyLifecyclePersist) {
          effects.push(effect(ARBITER_EFFECTS.LEGACY_PERSIST_STORAGE_ONLY, state.desired));
        }
        return { state, effects };
      }
      if (state.mode === MODES.NO_OPINION && compat.legacyNoOpinionLifecycle) {
        // Cell 1 pre-#1537: force the baseline, stomping native rate choices.
        return { state, effects: [effect(ARBITER_EFFECTS.WRITE, state.baseline)] };
      }
      // Cells 1 (target), 14: no opinion / stood down => no writes.
      return { state, effects: [] };
    }

    // Cells 2, 3, 4, 7, 8, 9, 10, 11, 15: a classified external ratechange.
    case ARBITER_EVENTS.EXT_RATE: {
      const rate = event.speed;

      switch (event.rateClass) {
        // Cells 4, 11 (and the SURRENDERED analog): ignore init churn.
        case RATE_CLASSES.INIT_NOISE:
          return { state, effects: [] };

        // Cells 2, 7: the user spoke through the SITE's controls — adopt.
        case RATE_CLASSES.USER_INTENT: {
          if (compat.legacyNoAdoption && state.mode !== MODES.HOLDING) {
            // F3: legacy gates adoption on truthy lastSpeed — without prior
            // authority the change is displayed but never adopted.
            return { state, effects: [effect(ARBITER_EFFECTS.SYNC_UI, rate)] };
          }
          return {
            state: makeState(MODES.HOLDING, rate, 0, state.baseline),
            effects: [effect(ARBITER_EFFECTS.PERSIST, rate), effect(ARBITER_EFFECTS.SYNC_UI, rate)],
          };
        }

        // Cells 3, 8, 9, 10, 15: the site acted on its own.
        case RATE_CLASSES.AUTONOMOUS: {
          if (state.mode === MODES.HOLDING && rate !== state.desired) {
            if (state.fightCount < maxFight) {
              // Cell 8: fight back (bounded).
              return {
                state: makeState(
                  MODES.HOLDING,
                  state.desired,
                  state.fightCount + 1,
                  state.baseline
                ),
                effects: [effect(ARBITER_EFFECTS.WRITE, state.desired)],
              };
            }
            if (compat.legacyShallowSurrender) {
              // F2: legacy resets the counter but silently KEEPS authority,
              // so the war restarts after the next quiet window.
              return {
                state: makeState(MODES.HOLDING, state.desired, 0, state.baseline),
                effects: [effect(ARBITER_EFFECTS.SYNC_UI, rate)],
              };
            }
            // Cell 9: surrender AND stand down — authority is dropped; only
            // the user can restart the war (cell 16).
            return {
              state: makeState(MODES.SURRENDERED, null, 0, state.baseline),
              effects: [effect(ARBITER_EFFECTS.SYNC_UI, rate)],
            };
          }
          // Cells 3, 10, 15: no diverging authority — observe only.
          return { state, effects: [effect(ARBITER_EFFECTS.SYNC_UI, rate)] };
        }

        default:
          throw new TypeError(`SpeedArbiter: unknown rate class ${event.rateClass}`);
      }
    }

    // Cell 13: FIGHT_WINDOW_MS elapsed — forgive isolated resets.
    case ARBITER_EVENTS.FIGHT_WINDOW_EXPIRE: {
      if (state.fightCount === 0) {
        return { state, effects: [] };
      }
      return {
        state: makeState(state.mode, state.desired, 0, state.baseline),
        effects: [],
      };
    }

    default:
      throw new TypeError(`SpeedArbiter: unknown event type ${event.type}`);
  }
}

window.VSC.SpeedArbiter = {
  MODES,
  EVENTS: ARBITER_EVENTS,
  RATE_CLASSES,
  EFFECTS: ARBITER_EFFECTS,
  TARGET_COMPAT,
  LEGACY_COMPAT,
  DEFAULT_MAX_FIGHT,
  loadState,
  step,
};
