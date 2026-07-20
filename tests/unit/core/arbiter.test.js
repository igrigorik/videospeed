/**
 * Conformance tests for the speed arbitration core (src/core/arbiter.js).
 *
 * Structure mirrors docs/speed-arbitration.md:
 *  1. one test per transition-table cell (target contract)
 *  2. legacy-compat flags reproduce the documented current-master deviations
 *  3. a mini model checker: exhaustive BFS over the reachable state space,
 *     asserting the contract invariants I1-I6 on every edge — the in-repo,
 *     no-Java mirror of what TLC checks over specs/SpeedArbiter.tla
 */

import '../../../src/core/arbiter.js';

const A = window.VSC.SpeedArbiter;
const { MODES, EVENTS, RATE_CLASSES, EFFECTS } = A;

const noOpinion = () => A.loadState({});
const holding = (v) => A.loadState({ rememberEnabled: true, rememberedSpeed: v });
const surrendered = () => {
  // Reach SURRENDERED honestly: exhaust the fight budget.
  let s = holding(1.5);
  for (let i = 0; i <= A.DEFAULT_MAX_FIGHT; i++) {
    s = A.step(s, { type: EVENTS.EXT_RATE, speed: 1.0, rateClass: RATE_CLASSES.AUTONOMOUS }).state;
  }
  expect(s.mode).toBe(MODES.SURRENDERED);
  return s;
};

const types = (effects) => effects.map((e) => e.type);

describe('SpeedArbiter transition table (target contract)', () => {
  it('cell 1: NO_OPINION + LIFECYCLE => no effects (was #1537)', () => {
    const { state, effects } = A.step(noOpinion(), { type: EVENTS.LIFECYCLE });
    expect(effects).toEqual([]);
    expect(state.mode).toBe(MODES.NO_OPINION);
  });

  it('cell 2: NO_OPINION + EXT_RATE(USER_INTENT) => adopt as authority', () => {
    const { state, effects } = A.step(noOpinion(), {
      type: EVENTS.EXT_RATE,
      speed: 1.5,
      rateClass: RATE_CLASSES.USER_INTENT,
    });
    expect(state.mode).toBe(MODES.HOLDING);
    expect(state.desired).toBe(1.5);
    expect(types(effects)).toEqual([EFFECTS.PERSIST, EFFECTS.SYNC_UI]);
  });

  it('cell 3: NO_OPINION + EXT_RATE(AUTONOMOUS) => observe only', () => {
    const { state, effects } = A.step(noOpinion(), {
      type: EVENTS.EXT_RATE,
      speed: 2.0,
      rateClass: RATE_CLASSES.AUTONOMOUS,
    });
    expect(state.mode).toBe(MODES.NO_OPINION);
    expect(types(effects)).toEqual([EFFECTS.SYNC_UI]);
  });

  it('cell 4: NO_OPINION + EXT_RATE(INIT_NOISE) => ignored', () => {
    const { state, effects } = A.step(noOpinion(), {
      type: EVENTS.EXT_RATE,
      speed: 0.06,
      rateClass: RATE_CLASSES.INIT_NOISE,
    });
    expect(effects).toEqual([]);
    expect(state.mode).toBe(MODES.NO_OPINION);
  });

  it('cell 5: NO_OPINION + USER_SET => claim authority, write + persist', () => {
    const { state, effects } = A.step(noOpinion(), { type: EVENTS.USER_SET, speed: 1.75 });
    expect(state).toMatchObject({ mode: MODES.HOLDING, desired: 1.75, fightCount: 0 });
    expect(types(effects)).toEqual([EFFECTS.WRITE, EFFECTS.PERSIST, EFFECTS.SYNC_UI]);
    expect(effects[0].speed).toBe(1.75);
  });

  it('cell 6: HOLDING + LIFECYCLE => re-assert desired, never persist (#1494)', () => {
    const { state, effects } = A.step(holding(1.5), { type: EVENTS.LIFECYCLE });
    expect(state.desired).toBe(1.5);
    expect(effects).toEqual([{ type: EFFECTS.WRITE, speed: 1.5 }]);
  });

  it('cell 7: HOLDING + EXT_RATE(USER_INTENT) => accept new authority', () => {
    const { state, effects } = A.step(holding(1.5), {
      type: EVENTS.EXT_RATE,
      speed: 2.0,
      rateClass: RATE_CLASSES.USER_INTENT,
    });
    expect(state).toMatchObject({ mode: MODES.HOLDING, desired: 2.0, fightCount: 0 });
    expect(types(effects)).toEqual([EFFECTS.PERSIST, EFFECTS.SYNC_UI]);
  });

  it('cell 8: HOLDING + diverging AUTONOMOUS under budget => fight back', () => {
    const { state, effects } = A.step(holding(1.5), {
      type: EVENTS.EXT_RATE,
      speed: 1.0,
      rateClass: RATE_CLASSES.AUTONOMOUS,
    });
    expect(state).toMatchObject({ mode: MODES.HOLDING, desired: 1.5, fightCount: 1 });
    expect(effects).toEqual([{ type: EFFECTS.WRITE, speed: 1.5 }]);
  });

  it('cell 9: fight budget exhausted => surrender AND stand down (F2 fix)', () => {
    let s = holding(1.5);
    for (let i = 0; i < A.DEFAULT_MAX_FIGHT; i++) {
      s = A.step(s, {
        type: EVENTS.EXT_RATE,
        speed: 1.0,
        rateClass: RATE_CLASSES.AUTONOMOUS,
      }).state;
      expect(s.fightCount).toBe(i + 1);
    }
    const { state, effects } = A.step(s, {
      type: EVENTS.EXT_RATE,
      speed: 1.0,
      rateClass: RATE_CLASSES.AUTONOMOUS,
    });
    expect(state).toMatchObject({ mode: MODES.SURRENDERED, desired: null, fightCount: 0 });
    expect(types(effects)).toEqual([EFFECTS.SYNC_UI]);
  });

  it('cell 10: HOLDING + AUTONOMOUS confirming our value => no fight', () => {
    const { state, effects } = A.step(holding(1.5), {
      type: EVENTS.EXT_RATE,
      speed: 1.5,
      rateClass: RATE_CLASSES.AUTONOMOUS,
    });
    expect(state.fightCount).toBe(0);
    expect(types(effects)).toEqual([EFFECTS.SYNC_UI]);
  });

  it('cell 11: HOLDING + EXT_RATE(INIT_NOISE) => ignored', () => {
    const { state, effects } = A.step(holding(1.5), {
      type: EVENTS.EXT_RATE,
      speed: 0.06,
      rateClass: RATE_CLASSES.INIT_NOISE,
    });
    expect(effects).toEqual([]);
    expect(state.desired).toBe(1.5);
  });

  it('cell 12: HOLDING + USER_SET => replace authority', () => {
    const { state, effects } = A.step(holding(1.5), { type: EVENTS.USER_SET, speed: 2.5 });
    expect(state).toMatchObject({ mode: MODES.HOLDING, desired: 2.5, fightCount: 0 });
    expect(types(effects)).toEqual([EFFECTS.WRITE, EFFECTS.PERSIST, EFFECTS.SYNC_UI]);
  });

  it('cell 13: FIGHT_WINDOW_EXPIRE => forgive, keep authority', () => {
    const fought = A.step(holding(1.5), {
      type: EVENTS.EXT_RATE,
      speed: 1.0,
      rateClass: RATE_CLASSES.AUTONOMOUS,
    }).state;
    const { state, effects } = A.step(fought, { type: EVENTS.FIGHT_WINDOW_EXPIRE });
    expect(state).toMatchObject({ mode: MODES.HOLDING, desired: 1.5, fightCount: 0 });
    expect(effects).toEqual([]);
  });

  it('cell 14: SURRENDERED + LIFECYCLE => stay down', () => {
    const { state, effects } = A.step(surrendered(), { type: EVENTS.LIFECYCLE });
    expect(state.mode).toBe(MODES.SURRENDERED);
    expect(effects).toEqual([]);
  });

  it('cell 15: SURRENDERED + EXT_RATE => observe only', () => {
    const { state, effects } = A.step(surrendered(), {
      type: EVENTS.EXT_RATE,
      speed: 2.0,
      rateClass: RATE_CLASSES.AUTONOMOUS,
    });
    expect(state.mode).toBe(MODES.SURRENDERED);
    expect(types(effects)).toEqual([EFFECTS.SYNC_UI]);
  });

  it('cell 16: SURRENDERED + USER_SET => only the user restarts the war', () => {
    const { state, effects } = A.step(surrendered(), { type: EVENTS.USER_SET, speed: 1.5 });
    expect(state).toMatchObject({ mode: MODES.HOLDING, desired: 1.5, fightCount: 0 });
    expect(types(effects)).toEqual([EFFECTS.WRITE, EFFECTS.PERSIST, EFFECTS.SYNC_UI]);
  });
});

describe('SpeedArbiter LOAD rules', () => {
  it('site rule becomes initial authority (F5 unification)', () => {
    const s = A.loadState({ siteRuleSpeed: 1.25, rememberEnabled: true, rememberedSpeed: 1.8 });
    expect(s).toMatchObject({ mode: MODES.HOLDING, desired: 1.25 });
  });

  it('remembered speed becomes authority when no rule', () => {
    const s = A.loadState({ rememberEnabled: true, rememberedSpeed: 1.8 });
    expect(s).toMatchObject({ mode: MODES.HOLDING, desired: 1.8 });
  });

  it('no rule, rememberSpeed off => NO_OPINION', () => {
    expect(A.loadState({ rememberedSpeed: 1.8 }).mode).toBe(MODES.NO_OPINION);
  });
});

describe('SpeedArbiter legacy-compat flags reproduce current-master deviations', () => {
  const legacy = { compat: A.LEGACY_COMPAT };

  it('legacy cell 1 (#1537): NO_OPINION + LIFECYCLE writes the baseline', () => {
    const { effects } = A.step(noOpinion(), { type: EVENTS.LIFECYCLE }, legacy);
    expect(effects).toEqual([{ type: EFFECTS.WRITE, speed: 1.0 }]);
  });

  it('legacy F5 + F1: site-rule lifecycle enforces rule as baseline and leaks to storage', () => {
    const s = A.loadState({ siteRuleSpeed: 1.25 }, A.LEGACY_COMPAT);
    expect(s.mode).toBe(MODES.NO_OPINION); // rule is NOT fightable authority
    const { effects } = A.step(s, { type: EVENTS.LIFECYCLE }, legacy);
    expect(effects).toEqual([{ type: EFFECTS.WRITE, speed: 1.25 }]);
  });

  it('legacy F1: HOLDING lifecycle restore leaks desired to storage', () => {
    const { effects } = A.step(holding(1.5), { type: EVENTS.LIFECYCLE }, legacy);
    expect(types(effects)).toEqual([EFFECTS.WRITE, EFFECTS.LEGACY_PERSIST_STORAGE_ONLY]);
  });

  it('legacy F3: user-intent without prior authority is displayed, not adopted', () => {
    const { state, effects } = A.step(
      noOpinion(),
      { type: EVENTS.EXT_RATE, speed: 1.5, rateClass: RATE_CLASSES.USER_INTENT },
      legacy
    );
    expect(state.mode).toBe(MODES.NO_OPINION);
    expect(types(effects)).toEqual([EFFECTS.SYNC_UI]);
  });

  it('legacy F2: surrender keeps authority — the war can restart', () => {
    let s = holding(1.5);
    for (let i = 0; i < A.DEFAULT_MAX_FIGHT; i++) {
      s = A.step(
        s,
        { type: EVENTS.EXT_RATE, speed: 1.0, rateClass: RATE_CLASSES.AUTONOMOUS },
        legacy
      ).state;
    }
    const { state } = A.step(
      s,
      { type: EVENTS.EXT_RATE, speed: 1.0, rateClass: RATE_CLASSES.AUTONOMOUS },
      legacy
    );
    expect(state).toMatchObject({ mode: MODES.HOLDING, desired: 1.5, fightCount: 0 });
    // ...and after "surrendering", the next diverging reset is fought again:
    const again = A.step(
      state,
      { type: EVENTS.EXT_RATE, speed: 1.0, rateClass: RATE_CLASSES.AUTONOMOUS },
      legacy
    );
    expect(again.effects[0].type).toBe(EFFECTS.WRITE);
  });
});

/**
 * Mini model checker: BFS over the full reachable (arbiter state, register)
 * graph for a small symbolic speed domain, asserting the contract invariants
 * on every visited edge. Mirrors TLC over specs/SpeedArbiter.tla in-repo.
 */
describe('SpeedArbiter model checking (exhaustive over small domain)', () => {
  const SPEEDS = [1.0, 1.5, 2.0];
  const MAX_FIGHT = 2; // small budget => surrender states are reachable fast

  const allEvents = () => {
    const events = [{ type: EVENTS.LIFECYCLE }, { type: EVENTS.FIGHT_WINDOW_EXPIRE }];
    for (const v of SPEEDS) {
      events.push({ type: EVENTS.USER_SET, speed: v });
      for (const rateClass of Object.values(RATE_CLASSES)) {
        events.push({ type: EVENTS.EXT_RATE, speed: v, rateClass });
      }
    }
    return events;
  };

  const initialWorlds = () => {
    const worlds = [];
    for (const rate of SPEEDS) {
      worlds.push({ arb: A.loadState({}), rate });
    }
    for (const v of SPEEDS) {
      // LOAD postcondition: in HOLDING the register reflects desired
      worlds.push({ arb: A.loadState({ rememberEnabled: true, rememberedSpeed: v }), rate: v });
      worlds.push({ arb: A.loadState({ siteRuleSpeed: v }), rate: v });
    }
    return worlds;
  };

  it('invariants I1-I6 hold on every reachable edge (target contract)', () => {
    const seen = new Set();
    const queue = initialWorlds();
    const key = (w) => JSON.stringify([w.arb.mode, w.arb.desired, w.arb.fightCount, w.rate]);
    queue.forEach((w) => seen.add(key(w)));

    let edges = 0;
    while (queue.length > 0) {
      const world = queue.pop();

      for (const event of allEvents()) {
        // The register moves BEFORE we observe an external ratechange —
        // model the site's write, then arbitrate.
        const rateBefore = event.type === EVENTS.EXT_RATE ? event.speed : world.rate;

        const frozen = JSON.stringify(world.arb);
        const { state: next, effects } = A.step(world.arb, event, { maxFight: MAX_FIGHT });
        edges++;

        // Purity: input state never mutated.
        expect(JSON.stringify(world.arb)).toBe(frozen);

        // Apply effects to the register.
        let rate = rateBefore;
        for (const e of effects) {
          if (e.type === EFFECTS.WRITE) {
            rate = e.speed;
          }
        }

        // I5: authority exists exactly in HOLDING.
        expect(next.desired !== null).toBe(next.mode === MODES.HOLDING);

        // I3: fight budget bounded; at most one WRITE per event.
        expect(next.fightCount).toBeLessThanOrEqual(MAX_FIGHT);
        expect(effects.filter((e) => e.type === EFFECTS.WRITE).length).toBeLessThanOrEqual(1);

        // I1: no writes without opinion.
        if (world.arb.mode !== MODES.HOLDING && event.type !== EVENTS.USER_SET) {
          expect(effects.some((e) => e.type === EFFECTS.WRITE)).toBe(false);
        }

        // I2: persistence purity — PERSIST only on user action or adoption.
        if (effects.some((e) => e.type === EFFECTS.PERSIST)) {
          expect(
            event.type === EVENTS.USER_SET ||
              (event.type === EVENTS.EXT_RATE && event.rateClass === RATE_CLASSES.USER_INTENT)
          ).toBe(true);
        }
        expect(effects.some((e) => e.type === EFFECTS.LEGACY_PERSIST_STORAGE_ONLY)).toBe(false);

        // I4 (convergence): after arbitrating any event that engages the
        // register (USER_SET, LIFECYCLE, non-noise EXT_RATE), a held
        // authority is reflected in it. The two exceptions carry prior
        // divergence untouched: INIT_NOISE (cell 11 deliberately tolerates
        // it — we don't fight player setup) and FIGHT_WINDOW_EXPIRE (a pure
        // timer that never writes).
        const isInitNoise =
          event.type === EVENTS.EXT_RATE && event.rateClass === RATE_CLASSES.INIT_NOISE;
        const engagesRegister = !isInitNoise && event.type !== EVENTS.FIGHT_WINDOW_EXPIRE;
        if (next.mode === MODES.HOLDING && engagesRegister) {
          expect(rate).toBe(next.desired);
        }
        if (next.mode === MODES.HOLDING && isInitNoise && rate !== next.desired) {
          // ...and the tolerated divergence is healed by the next lifecycle
          // event: eventual convergence, driven by re-assertion.
          const healed = A.step(next, { type: EVENTS.LIFECYCLE }, { maxFight: MAX_FIGHT });
          expect(healed.effects).toContainEqual({ type: EFFECTS.WRITE, speed: next.desired });
        }

        // I6: recoverability — from ANY reachable state one USER_SET wins.
        const recovery = A.step(
          next,
          { type: EVENTS.USER_SET, speed: 2.0 },
          { maxFight: MAX_FIGHT }
        );
        expect(recovery.state).toMatchObject({ mode: MODES.HOLDING, desired: 2.0 });
        expect(recovery.effects[0]).toEqual({ type: EFFECTS.WRITE, speed: 2.0 });

        const nextWorld = { arb: next, rate };
        const k = key(nextWorld);
        if (!seen.has(k)) {
          seen.add(k);
          queue.push(nextWorld);
        }
      }
    }

    // Sanity: the exploration actually covered a real state space.
    expect(seen.size).toBeGreaterThan(20);
    expect(edges).toBeGreaterThan(200);
  });

  it('totality: step() throws loudly on alphabet violations, never silently', () => {
    expect(() => A.step(noOpinion(), { type: 'BOGUS' })).toThrow(TypeError);
    expect(() =>
      A.step(noOpinion(), { type: EVENTS.EXT_RATE, speed: 1.5, rateClass: 'BOGUS' })
    ).toThrow(TypeError);
  });
});
