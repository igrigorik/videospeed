/**
 * Conformance tests for the pure per-media conflict state machine.
 *
 * Shared desired authority is supplied by the adapter; this core decides only
 * whether one media element enforces, suppresses, or re-arms that authority.
 */

import '../../../src/core/arbiter.js';

const A = window.VSC.SpeedArbiter;
const { MODES, EVENTS, RATE_CLASSES, EFFECTS } = A;

const noOpinion = () => A.loadState({});
const holding = (speed = 1.5) => A.loadState({ rememberEnabled: true, rememberedSpeed: speed });
const effectTypes = (effects) => effects.map((entry) => entry.type);

function exhaustWar(state, quiet) {
  let next = state;
  for (let i = 0; i <= A.DEFAULT_MAX_FIGHT; i += 1) {
    next = A.step(next, {
      type: EVENTS.EXT_RATE,
      speed: 1.0,
      rateClass: RATE_CLASSES.AUTONOMOUS,
      quiet,
    }).state;
  }
  return next;
}

describe('SpeedArbiter local conflict transitions', () => {
  it('leaves a media element alone when no shared authority exists', () => {
    const result = A.step(noOpinion(), { type: EVENTS.LIFECYCLE });
    expect(result.state.mode).toBe(MODES.NO_OPINION);
    expect(result.effects).toEqual([]);
  });

  it('claims authority from a VSC user action and resets the local re-arm budget', () => {
    const exhausted = exhaustWar(holding(), true);
    expect(exhausted).toMatchObject({ mode: MODES.REARMABLE, rearmBudget: 0 });

    const result = A.step(exhausted, { type: EVENTS.USER_SET, speed: 2.0 });

    expect(result.state).toMatchObject({
      mode: MODES.HOLDING,
      desired: 2.0,
      fightCount: 0,
      rearmBudget: A.DEFAULT_REARM_BUDGET,
    });
    expect(effectTypes(result.effects)).toEqual([EFFECTS.WRITE, EFFECTS.PERSIST, EFFECTS.SYNC_UI]);
  });

  it('adopts a native user choice from any local phase', () => {
    const suppressed = exhaustWar(holding(), false);
    expect(suppressed.mode).toBe(MODES.SUPPRESSED);

    const result = A.step(suppressed, {
      type: EVENTS.EXT_RATE,
      speed: 1.75,
      rateClass: RATE_CLASSES.USER_INTENT,
    });

    expect(result.state).toMatchObject({
      mode: MODES.HOLDING,
      desired: 1.75,
      fightCount: 0,
      rearmBudget: A.DEFAULT_REARM_BUDGET,
    });
    expect(effectTypes(result.effects)).toEqual([EFFECTS.PERSIST, EFFECTS.SYNC_UI]);
  });

  it('fights an autonomous divergence only on the affected media element', () => {
    const result = A.step(holding(1.5), {
      type: EVENTS.EXT_RATE,
      speed: 1.0,
      rateClass: RATE_CLASSES.AUTONOMOUS,
      quiet: true,
    });

    expect(result.state).toMatchObject({ mode: MODES.HOLDING, desired: 1.5, fightCount: 1 });
    expect(result.effects).toEqual([{ type: EFFECTS.WRITE, speed: 1.5 }]);
  });

  it('locally suppresses an activity-context surrender without discarding desired authority', () => {
    const suppressed = exhaustWar(holding(1.5), false);

    expect(suppressed).toMatchObject({
      mode: MODES.SUPPRESSED,
      desired: 1.5,
      fightCount: 0,
      rearmBudget: A.DEFAULT_REARM_BUDGET,
    });
    expect(A.step(suppressed, { type: EVENTS.LIFECYCLE }).effects).toEqual([]);

    const observed = A.step(suppressed, {
      type: EVENTS.EXT_RATE,
      speed: 2.0,
      rateClass: RATE_CLASSES.AUTONOMOUS,
    });
    expect(observed.state.mode).toBe(MODES.SUPPRESSED);
    expect(effectTypes(observed.effects)).toEqual([EFFECTS.SYNC_UI]);
  });

  it('re-arms only the quiet-war media element once on lifecycle', () => {
    const rearmable = exhaustWar(holding(1.5), true);
    expect(rearmable).toMatchObject({ mode: MODES.REARMABLE, desired: 1.5, rearmBudget: 0 });

    const result = A.step(rearmable, { type: EVENTS.LIFECYCLE });
    expect(result.state).toMatchObject({ mode: MODES.HOLDING, desired: 1.5, rearmBudget: 0 });
    expect(result.effects).toEqual([{ type: EFFECTS.WRITE, speed: 1.5 }]);

    expect(exhaustWar(result.state, true)).toMatchObject({
      mode: MODES.SUPPRESSED,
      desired: 1.5,
      rearmBudget: 0,
    });
  });

  it('forgives isolated resets without changing local phase or authority', () => {
    const fought = A.step(holding(1.5), {
      type: EVENTS.EXT_RATE,
      speed: 1.0,
      rateClass: RATE_CLASSES.AUTONOMOUS,
      quiet: false,
    }).state;

    const result = A.step(fought, { type: EVENTS.FIGHT_WINDOW_EXPIRE });
    expect(result.state).toMatchObject({ mode: MODES.HOLDING, desired: 1.5, fightCount: 0 });
    expect(result.effects).toEqual([]);
  });

  it('does not materialize a temporary overlay without shared authority', () => {
    const state = A.loadState({});
    const result = A.step(state, {
      type: EVENTS.TEMPORARY_OVERRIDE_START,
      speed: 2.0,
    });

    expect(result.state).toBe(state);
    expect(result.effects).toEqual([{ type: EFFECTS.SYNC_UI, speed: 2.0 }]);
  });

  it('keeps a native temporary override out of shared authority and restores it on release', () => {
    const held = A.step(holding(1.5), {
      type: EVENTS.TEMPORARY_OVERRIDE_START,
      speed: 2.0,
    });

    expect(held.state).toMatchObject({
      mode: MODES.HOLDING,
      desired: 1.5,
      fightCount: 0,
      temporaryOverride: true,
    });
    expect(held.effects).toEqual([{ type: EFFECTS.SYNC_UI, speed: 2.0 }]);
    expect(A.step(held.state, { type: EVENTS.LIFECYCLE }).effects).toEqual([]);

    const released = A.step(held.state, {
      type: EVENTS.TEMPORARY_OVERRIDE_END,
      speed: 1.0,
    });
    expect(released.state).toMatchObject({
      mode: MODES.HOLDING,
      desired: 1.5,
      fightCount: 0,
      temporaryOverride: false,
    });
    expect(released.effects).toEqual([
      { type: EFFECTS.WRITE, speed: 1.5 },
      { type: EFFECTS.SYNC_UI, speed: 1.5 },
    ]);
  });

  it('ends a temporary override without reviving a locally suppressed media element', () => {
    const suppressed = exhaustWar(holding(1.5), false);
    const held = A.step(suppressed, { type: EVENTS.TEMPORARY_OVERRIDE_START, speed: 2.0 });
    const released = A.step(held.state, {
      type: EVENTS.TEMPORARY_OVERRIDE_END,
      speed: 1.0,
    });

    expect(released.state).toMatchObject({ mode: MODES.SUPPRESSED, temporaryOverride: false });
    expect(released.effects).toEqual([{ type: EFFECTS.SYNC_UI, speed: 1.0 }]);
  });
});

describe('SpeedArbiter model checking (exhaustive small domain)', () => {
  const SPEEDS = [1.0, 1.5, 2.0];
  const MAX_FIGHT = 2;

  function allEvents() {
    const events = [{ type: EVENTS.LIFECYCLE }, { type: EVENTS.FIGHT_WINDOW_EXPIRE }];
    for (const speed of SPEEDS) {
      events.push({ type: EVENTS.USER_SET, speed });
      events.push({ type: EVENTS.TEMPORARY_OVERRIDE_START, speed });
      events.push({ type: EVENTS.TEMPORARY_OVERRIDE_END, speed });
      for (const rateClass of Object.values(RATE_CLASSES)) {
        for (const quiet of [false, true]) {
          events.push({ type: EVENTS.EXT_RATE, speed, rateClass, quiet });
        }
      }
    }
    return events;
  }

  function initialWorlds() {
    return [
      ...SPEEDS.map((rate) => ({ arb: noOpinion(), rate })),
      ...SPEEDS.map((speed) => ({ arb: holding(speed), rate: speed })),
    ];
  }

  it('preserves local safety invariants on every reachable edge', () => {
    const seen = new Set();
    const queue = initialWorlds();
    const key = (world) =>
      JSON.stringify([
        world.arb.mode,
        world.arb.desired,
        world.arb.fightCount,
        world.arb.warQuiet,
        world.arb.rearmBudget,
        world.arb.temporaryOverride,
        world.rate,
      ]);
    queue.forEach((world) => seen.add(key(world)));

    let edges = 0;
    while (queue.length > 0) {
      const world = queue.pop();
      for (const event of allEvents()) {
        const rateBefore =
          event.type === EVENTS.EXT_RATE ||
          event.type === EVENTS.TEMPORARY_OVERRIDE_START ||
          event.type === EVENTS.TEMPORARY_OVERRIDE_END
            ? event.speed
            : world.rate;
        const frozen = JSON.stringify(world.arb);
        const { state: next, effects } = A.step(world.arb, event, { maxFight: MAX_FIGHT });
        edges += 1;

        expect(JSON.stringify(world.arb)).toBe(frozen);
        expect(next.fightCount).toBeLessThanOrEqual(MAX_FIGHT);
        expect(effects.filter((entry) => entry.type === EFFECTS.WRITE)).toHaveLength(
          effects.some((entry) => entry.type === EFFECTS.WRITE) ? 1 : 0
        );

        // A shared desired speed exists in every local phase except when the
        // document has no authority at all.
        expect(next.desired !== null).toBe(next.mode !== MODES.NO_OPINION);

        // A local user/native authority claim begins a fresh epoch; every
        // other transition may only spend or preserve the local re-arm budget.
        const startsEpoch =
          event.type === EVENTS.USER_SET ||
          (event.type === EVENTS.EXT_RATE && event.rateClass === RATE_CLASSES.USER_INTENT);
        if (startsEpoch) {
          expect(next.rearmBudget).toBe(A.DEFAULT_REARM_BUDGET);
        } else {
          expect(next.rearmBudget).toBeLessThanOrEqual(world.arb.rearmBudget);
        }

        if ([MODES.NO_OPINION, MODES.SUPPRESSED].includes(world.arb.mode)) {
          expect(effects.some((entry) => entry.type === EFFECTS.WRITE)).toBe(
            event.type === EVENTS.USER_SET
          );
        }

        if (effects.some((entry) => entry.type === EFFECTS.PERSIST)) {
          expect(startsEpoch).toBe(true);
        }

        let rate = rateBefore;
        for (const effect of effects) {
          if (effect.type === EFFECTS.WRITE) {
            rate = effect.speed;
          }
        }
        const engagesRegister =
          event.type !== EVENTS.FIGHT_WINDOW_EXPIRE &&
          !(event.type === EVENTS.EXT_RATE && event.rateClass === RATE_CLASSES.INIT_NOISE);
        if (next.mode === MODES.HOLDING && !next.temporaryOverride && engagesRegister) {
          expect(rate).toBe(next.desired);
        }

        const recovery = A.step(
          next,
          { type: EVENTS.USER_SET, speed: 2.0 },
          { maxFight: MAX_FIGHT }
        );
        expect(recovery.state).toMatchObject({ mode: MODES.HOLDING, desired: 2.0 });

        const nextWorld = { arb: next, rate };
        const nextKey = key(nextWorld);
        if (!seen.has(nextKey)) {
          seen.add(nextKey);
          queue.push(nextWorld);
        }
      }
    }

    expect(seen.size).toBeGreaterThan(20);
    expect(edges).toBeGreaterThan(200);
  });

  it('throws loudly for unsupported alphabet values', () => {
    expect(() => A.step(noOpinion(), { type: 'BOGUS' })).toThrow(TypeError);
    expect(() =>
      A.step(noOpinion(), { type: EVENTS.EXT_RATE, speed: 1.5, rateClass: 'BOGUS' })
    ).toThrow(TypeError);
  });
});

describe('SpeedArbiter shared-authority two-register mini model', () => {
  const IDS = ['A', 'B'];
  const SPEEDS = [1.0, 1.5];
  const MAX_FIGHT = 1;

  function freshLocal(desired) {
    return desired === null ? noOpinion() : holding(desired);
  }

  function writeRate(world, id, effects) {
    const write = effects.find((entry) => entry.type === EFFECTS.WRITE);
    if (write) {
      world.rates[id] = write.speed;
    }
  }

  function copyWorld(world) {
    return {
      desired: world.desired,
      rates: { ...world.rates },
      local: { ...world.local },
    };
  }

  function claim(world, id, speed) {
    const next = copyWorld(world);
    next.desired = speed;
    for (const otherId of IDS) {
      next.local[otherId] = freshLocal(speed);
    }
    const result = A.step(
      next.local[id],
      { type: EVENTS.USER_SET, speed },
      { maxFight: MAX_FIGHT }
    );
    next.local[id] = result.state;
    writeRate(next, id, result.effects);
    return next;
  }

  function localTransition(world, id, event) {
    const next = copyWorld(world);
    const result = A.step(next.local[id], event, { maxFight: MAX_FIGHT });
    next.local[id] = result.state;
    if (event.type === EVENTS.EXT_RATE) {
      next.rates[id] = event.speed;
    }
    writeRate(next, id, result.effects);
    return next;
  }

  function operations() {
    const ops = [];
    for (const id of IDS) {
      ops.push({ kind: 'lifecycle', id });
      for (const speed of SPEEDS) {
        ops.push({ kind: 'claim', id, speed });
        for (const quiet of [false, true]) {
          ops.push({
            kind: 'external',
            id,
            speed,
            event: { type: EVENTS.EXT_RATE, speed, rateClass: RATE_CLASSES.AUTONOMOUS, quiet },
          });
        }
      }
    }
    return ops;
  }

  function apply(world, op) {
    if (op.kind === 'claim') {
      return claim(world, op.id, op.speed);
    }
    if (op.kind === 'lifecycle') {
      return localTransition(world, op.id, { type: EVENTS.LIFECYCLE });
    }
    return localTransition(world, op.id, op.event);
  }

  function worldKey(world) {
    return JSON.stringify({
      desired: world.desired,
      rates: world.rates,
      local: Object.fromEntries(
        IDS.map((id) => [
          id,
          [
            world.local[id].mode,
            world.local[id].desired,
            world.local[id].fightCount,
            world.local[id].warQuiet,
            world.local[id].rearmBudget,
          ],
        ])
      ),
    });
  }

  it('exhaustively preserves local conflict isolation through six action generations', () => {
    const initial = {
      desired: 1.5,
      rates: { A: 1.5, B: 1.5 },
      local: { A: freshLocal(1.5), B: freshLocal(1.5) },
    };
    const seen = new Set([worldKey(initial)]);
    const queue = [{ world: initial, depth: 0 }];
    let queueHead = 0;
    let edges = 0;

    while (queueHead < queue.length) {
      const { world, depth } = queue[queueHead];
      queueHead += 1;
      for (const op of operations()) {
        const beforeOther =
          op.kind === 'claim' ? null : JSON.stringify(world.local[op.id === 'A' ? 'B' : 'A']);
        const beforeDesired = world.desired;
        const next = apply(world, op);
        edges += 1;

        expect(next.desired).not.toBeNull();
        for (const id of IDS) {
          expect(next.local[id].desired).toBe(next.desired);
        }

        if (op.kind === 'claim') {
          for (const id of IDS) {
            expect(next.local[id]).toMatchObject({
              mode: MODES.HOLDING,
              fightCount: 0,
              rearmBudget: A.DEFAULT_REARM_BUDGET,
            });
          }
        } else {
          const otherId = op.id === 'A' ? 'B' : 'A';
          expect(JSON.stringify(next.local[otherId])).toBe(beforeOther);
          expect(next.rates[otherId]).toBe(world.rates[otherId]);
          expect(next.desired).toBe(beforeDesired);
        }

        if (depth < 6) {
          const key = worldKey(next);
          if (!seen.has(key)) {
            seen.add(key);
            queue.push({ world: next, depth: depth + 1 });
          }
        }
      }
    }

    expect(seen.size).toBeGreaterThan(30);
    expect(edges).toBeGreaterThan(400);
  });
});
