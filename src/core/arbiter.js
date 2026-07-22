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
 * The legacy-compat flag machinery that powered the strangler-fig migration
 * (behavior-preserving rewire first, one-flag behavior fixes after) was
 * removed once every flag reached target position; the executable history
 * lives at git tag `arbitration-executable-history`.
 */

window.VSC = window.VSC || {};

// An explicit SURRENDERED mode existed in earlier contract drafts, but once
// cell 2 adopts user intent from any mode it was behaviorally identical to
// NO_OPINION and was eliminated. REARMABLE is different — it IS behaviorally
// distinct: after a surrender in a fully QUIET war (every reset arrived with
// no user input for >= QUIET_CONTEXT_MS — such resets cannot be misclassified
// user actions, since all intent evidence is input), the next lifecycle event
// restores the user's speed, once per session. Activity-context wars stay
// terminally surrendered: they might have been fought against a misclassified
// user, and attrition-safety (user wins after the budget) must hold.
const MODES = Object.freeze({
  NO_OPINION: 'NO_OPINION',
  HOLDING: 'HOLDING',
  REARMABLE: 'REARMABLE',
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
  // Null the SESSION authority projection (in-memory lastSpeed), leaving
  // persisted storage untouched. Emitted only by cell 9 (surrender).
  CLEAR_AUTHORITY: 'CLEAR_AUTHORITY',
  // Restore the session authority projection to a previously user-held
  // value (in-memory only, storage untouched — persistence purity I2 is
  // about storage and still holds). Emitted only by cell 14 (quiet-war
  // re-arm); the value's provenance is the pre-war user choice.
  RESTORE_AUTHORITY: 'RESTORE_AUTHORITY',
});

// Effective fight budget. The legacy handler's MAX_FIGHT_COUNT was 5, but it
// incremented THEN checked `>= MAX`, so the 5th reset surrendered after only
// 4 fight-backs — the arbiter default preserves that observable budget.
const DEFAULT_MAX_FIGHT = 4;

// Quiet-war re-arms per session. One: the user's speed gets a single second
// chance after a machine-vs-machine war; if the site fights again, the next
// surrender is terminal. Bounded => the F2 periodic-war pathology cannot
// return.
const DEFAULT_REARM_BUDGET = 1;

/**
 * Build the initial arbiter state from load-time inputs (LOAD in the table).
 *
 * Priority: site rule => HOLDING(rule) — the rule is initial authority
 * (F5); remembered speed => HOLDING(remembered); otherwise NO_OPINION.
 *
 * @param {Object} init
 * @param {number|null} init.siteRuleSpeed - per-site rule speed, if any
 * @param {number|null} init.rememberedSpeed - stored lastSpeed, if any
 * @param {boolean} init.rememberEnabled - rememberSpeed setting
 * @returns {Object} initial arbiter state
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
 * @param {number|null} desired - authoritative target (pre-war speed in
 *   REARMABLE); null iff NO_OPINION
 * @param {number} fightCount
 * @param {boolean} [warQuiet] - every fight of the current war was
 *   input-quiet (vacuously true outside a war)
 * @param {number} [rearmBudget] - quiet-war re-arms remaining this session
 */
function makeState(mode, desired, fightCount, warQuiet, rearmBudget) {
  return Object.freeze({
    mode,
    desired,
    fightCount,
    warQuiet: warQuiet ?? true,
    rearmBudget: rearmBudget ?? DEFAULT_REARM_BUDGET,
  });
}

function effect(type, speed) {
  return Object.freeze({ type, speed });
}

/**
 * The arbitration step: pure and total over the event alphabet.
 *
 * @param {Object} state - arbiter state from loadState()/previous step()
 * @param {Object} event - { type, speed?, rateClass?, quiet? }
 * @param {Object} [options]
 * @param {number} [options.maxFight] - fight budget, default DEFAULT_MAX_FIGHT
 * @returns {{state: Object, effects: Array}} next state and effects to execute
 */
function step(state, event, options = {}) {
  const maxFight = options.maxFight ?? DEFAULT_MAX_FIGHT;

  switch (event.type) {
    // Cells 5, 12: the user spoke through VSC — unconditional authority,
    // fresh fight budget, any pending re-arm superseded.
    case ARBITER_EVENTS.USER_SET: {
      return {
        state: makeState(MODES.HOLDING, event.speed, 0, true, state.rearmBudget),
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
        // Cell 6: re-assert; never persist (#1494).
        return { state, effects: [effect(ARBITER_EFFECTS.WRITE, state.desired)] };
      }
      if (state.mode === MODES.REARMABLE) {
        // Cell 14: the quiet-war re-arm — restore the pre-war user speed at
        // the next lifecycle moment (budget was decremented at surrender).
        // RESTORE_AUTHORITY is in-memory only; storage was never touched.
        return {
          state: makeState(MODES.HOLDING, state.desired, 0, true, state.rearmBudget),
          effects: [
            effect(ARBITER_EFFECTS.RESTORE_AUTHORITY, state.desired),
            effect(ARBITER_EFFECTS.WRITE, state.desired),
          ],
        };
      }
      // Cell 1: no opinion (incl. post-surrender) => no writes (#1537).
      return { state, effects: [] };
    }

    // Cells 2, 3, 4, 7, 8, 9, 9b, 10, 11: a classified external ratechange.
    case ARBITER_EVENTS.EXT_RATE: {
      const rate = event.speed;

      switch (event.rateClass) {
        // Cells 4, 11: ignore init churn.
        case RATE_CLASSES.INIT_NOISE:
          return { state, effects: [] };

        // Cells 2, 7: the user spoke through the SITE's controls — adopt as
        // authority from any mode (a pending re-arm is superseded).
        case RATE_CLASSES.USER_INTENT: {
          return {
            state: makeState(MODES.HOLDING, rate, 0, true, state.rearmBudget),
            effects: [effect(ARBITER_EFFECTS.PERSIST, rate), effect(ARBITER_EFFECTS.SYNC_UI, rate)],
          };
        }

        // Cells 3, 8, 9, 9b, 10: the site acted on its own.
        case RATE_CLASSES.AUTONOMOUS: {
          if (state.mode === MODES.HOLDING && rate !== state.desired) {
            if (state.fightCount < maxFight) {
              // Cell 8: fight back (bounded). Track whether the whole war is
              // quiet-context — a war's first fight starts the record.
              const warQuiet =
                state.fightCount === 0 ? !!event.quiet : state.warQuiet && !!event.quiet;
              return {
                state: makeState(
                  MODES.HOLDING,
                  state.desired,
                  state.fightCount + 1,
                  warQuiet,
                  state.rearmBudget
                ),
                effects: [effect(ARBITER_EFFECTS.WRITE, state.desired)],
              };
            }
            // Cells 9/9b: budget exhausted — stand down. If the ENTIRE war
            // was quiet-context (no reset could have been a misclassified
            // user action) and a re-arm remains, stand down REARMABLE: the
            // next lifecycle event restores the pre-war speed once (cell
            // 14). Otherwise — any activity-context fight, or budget spent —
            // surrender is terminal for the session (attrition safety).
            const fullyQuiet = state.warQuiet && !!event.quiet;
            if (fullyQuiet && state.rearmBudget > 0) {
              return {
                state: makeState(MODES.REARMABLE, state.desired, 0, true, state.rearmBudget - 1),
                effects: [
                  effect(ARBITER_EFFECTS.CLEAR_AUTHORITY, null),
                  effect(ARBITER_EFFECTS.SYNC_UI, rate),
                ],
              };
            }
            return {
              state: makeState(MODES.NO_OPINION, null, 0, true, state.rearmBudget),
              effects: [
                effect(ARBITER_EFFECTS.CLEAR_AUTHORITY, null),
                effect(ARBITER_EFFECTS.SYNC_UI, rate),
              ],
            };
          }
          // Cells 3, 10: no diverging authority — observe only.
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
        state: makeState(state.mode, state.desired, 0, true, state.rearmBudget),
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
  DEFAULT_MAX_FIGHT,
  loadState,
  step,
};
