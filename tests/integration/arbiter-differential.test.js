/**
 * The proof for the speed-arbitration refactor. Two parts:
 *
 * 1. DIFFERENTIAL EQUIVALENCE — the same scenario streams drive (a) the real
 *    legacy pipeline (EventManager + VideoController + ActionHandler +
 *    settings, unmodified production code) and (b) the arbiter with
 *    LEGACY_COMPAT flags + LEGACY classifier rules. Observables (register,
 *    in-memory lastSpeed, persisted lastSpeed) must match at every step.
 *    This proves the refactor is behavior-preserving by construction: the
 *    arbiter can replace the legacy decision logic with zero user-visible
 *    change, before any behavior fix ships.
 *
 * 2. BUG LEDGER — one deterministic test per known bug (open and resolved).
 *    Each entry proves the bug REPRODUCES under the legacy configuration
 *    (both in the real modules and in the legacy-flagged arbiter — double
 *    confirmation the model captures reality) and VANISHES under the target
 *    contract + target classifier. Fixing the class = flipping flags; what
 *    remains debatable is which behavior we want per cell, never whether
 *    the implementation is correct.
 *
 * Pacing model (mirrors production timing constants):
 *   quick =   50ms — inside the 300ms gesture window; only ever follows
 *                    gesture ops, so no cooldown interference
 *   med   = 2500ms — clears max cooldown (2000ms) but stays inside the
 *                    fight window (3000ms): fights accumulate
 *   slow  = 3500ms — clears the fight window: fight count forgiven
 */

import { vi } from 'vitest';
import { resetMockStorage, getMockStorage } from '../helpers/chrome-mock.js';
import { createMockVideo, createMockKeyboardEvent } from '../helpers/test-utils.js';
import '../../src/core/arbiter.js';
import '../../src/core/intent-classifier.js';

const A = window.VSC.SpeedArbiter;
const IC = window.VSC.IntentClassifier;

const PACE_MS = { quick: 50, med: 2500, slow: 3500 };
const FIGHT_WINDOW_MS = 3000; // EventManager.FIGHT_WINDOW_MS
const round2 = (v) => Number(v.toFixed(2));

function initialRegister(init) {
  if (init.siteRuleSpeed !== null && init.siteRuleSpeed !== undefined) {
    return init.siteRuleSpeed;
  }
  if (init.rememberEnabled && init.rememberedSpeed !== null && init.rememberedSpeed !== undefined) {
    return init.rememberedSpeed;
  }
  return 1.0;
}

/* ------------------------------------------------------------------ */
/* Legacy world: the real production modules                           */
/* ------------------------------------------------------------------ */

async function createLegacyWorld(init) {
  resetMockStorage();
  const storage = getMockStorage();
  storage.rememberSpeed = !!init.rememberEnabled;
  if (init.rememberedSpeed !== null && init.rememberedSpeed !== undefined) {
    storage.lastSpeed = init.rememberedSpeed;
  }

  const config = window.VSC.videoSpeedConfig;
  // siteDefaultSpeed is sticky across load() calls (load only ever SETS it on
  // a rule match, never clears it) — harmless in production where every page
  // load is a fresh process, but the test singleton leaks it between
  // scenarios and load() then nulls lastSpeed via the F5 branch.
  config.settings.siteDefaultSpeed = null;
  await config.load();
  // Replicate load()'s site-rule branch (settings.js:152) without depending
  // on URL pattern matching in the jsdom environment.
  if (init.siteRuleSpeed !== null && init.siteRuleSpeed !== undefined) {
    config.settings.siteDefaultSpeed = init.siteRuleSpeed;
    config.settings.lastSpeed = null;
  } else {
    config.settings.siteDefaultSpeed = null;
  }

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);
  eventManager.actionHandler = actionHandler;

  const video = createMockVideo({
    playbackRate: initialRegister(init),
    currentSrc: 'https://example.com/v.mp4',
  });
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
  document.body.appendChild(video);
  const controller = new window.VSC.VideoController(video, null, config, actionHandler);

  return { config, eventManager, actionHandler, video, controller, now: 100000 };
}

async function legacyStep(world, op) {
  const paceMs = PACE_MS[op.pace || 'med'];
  world.now += paceMs;
  await vi.advanceTimersByTimeAsync(paceMs);

  switch (op.op) {
    case 'userVsc':
      world.actionHandler.adjustSpeed(world.video, op.speed, { source: 'internal' });
      break;
    case 'gestureClick':
      // Mirror of EventManager's document click handler body (one line).
      world.eventManager.lastUserInteractionAt = world.now;
      break;
    case 'pointerDown':
      break; // legacy is blind to held pointers — that IS bug #1554
    case 'gestureKey': {
      const ev = createMockKeyboardEvent('keydown', op.keyCode, {
        code: op.code,
        key: op.key,
        shiftKey: !!op.shiftKey,
      });
      Object.defineProperty(ev, 'timeStamp', { value: world.now, configurable: true });
      Object.defineProperty(ev, 'target', { value: document.body, configurable: true });
      world.eventManager.handleKeydown(ev);
      break;
    }
    case 'siteRate':
      world.video.playbackRate = op.rate;
      world.eventManager.handleRateChange({
        composedPath: () => [world.video],
        target: world.video,
        detail: null,
        timeStamp: world.now,
        stopImmediatePropagation() {},
      });
      break;
    case 'play':
      world.controller.handlePlay({ type: 'play', target: world.video });
      break;
    case 'seeked':
      world.controller.handleSeek({ type: 'seeked', target: world.video });
      break;
    default:
      throw new Error(`unknown op ${op.op}`);
  }
}

function legacyObservables(world) {
  return {
    rate: round2(world.video.playbackRate),
    mem: world.config.settings.lastSpeed,
  };
}

async function destroyLegacyWorld(world) {
  await vi.advanceTimersByTimeAsync(6000); // flush debounced saves + timers
  world.controller.remove();
  world.video.remove();
}

/* ------------------------------------------------------------------ */
/* Arbiter world: pure core + classifier + effect application          */
/* ------------------------------------------------------------------ */

function createArbiterWorld(init, variant) {
  const compat = variant === 'legacy' ? A.LEGACY_COMPAT : A.TARGET_COMPAT;
  const rules = variant === 'legacy' ? IC.LEGACY_RULES : IC.TARGET_RULES;
  return {
    variant,
    compat,
    state: A.loadState(init, compat),
    register: initialRegister(init),
    // chrome.storage ships lastSpeed: 1.0 as the install default
    stored: init.rememberedSpeed ?? 1.0,
    rememberEnabled: !!init.rememberEnabled,
    classifier: new IC({ rules }),
    now: 100000,
    sinceFight: 0, // mirrors the legacy fightTimer's re-arm-on-fight behavior
  };
}

function arbApply(world, effects) {
  for (const e of effects) {
    switch (e.type) {
      case A.EFFECTS.WRITE:
        world.register = round2(e.speed);
        break;
      case A.EFFECTS.PERSIST:
      case A.EFFECTS.LEGACY_PERSIST_STORAGE_ONLY:
        if (world.rememberEnabled) {
          world.stored = round2(e.speed);
        }
        break;
      case A.EFFECTS.SYNC_UI:
        break;
      default:
        throw new Error(`unknown effect ${e.type}`);
    }
  }
}

function arbAdvance(world, paceMs) {
  world.now += paceMs;
  if (world.state.fightCount > 0) {
    world.sinceFight += paceMs;
    if (world.sinceFight >= FIGHT_WINDOW_MS) {
      world.state = A.step(
        world.state,
        { type: A.EVENTS.FIGHT_WINDOW_EXPIRE },
        {
          compat: world.compat,
        }
      ).state;
      world.sinceFight = 0;
    }
  }
}

function arbStep(world, op) {
  arbAdvance(world, PACE_MS[op.pace || 'med']);
  const opts = { compat: world.compat };

  switch (op.op) {
    case 'userVsc': {
      const r = A.step(world.state, { type: A.EVENTS.USER_SET, speed: op.speed }, opts);
      world.state = r.state;
      world.sinceFight = 0;
      arbApply(world, r.effects);
      break;
    }
    case 'gestureClick':
      world.classifier.observeClick({ timeStamp: world.now });
      break;
    case 'pointerDown':
      world.classifier.observePointerDown({ timeStamp: world.now });
      break;
    case 'gestureKey':
      world.classifier.observeUnhandledKey({
        key: op.key,
        code: op.code,
        keyCode: op.keyCode,
        shiftKey: !!op.shiftKey,
        timeStamp: world.now,
      });
      break;
    case 'siteRate': {
      world.register = round2(op.rate); // the site wrote the register
      let verdict = world.classifier.classify({
        rate: op.rate,
        timeStamp: world.now,
        readyState: 4,
        detail: null,
      });
      if (verdict === IC.VERDICTS.SELF) {
        break;
      }
      // Legacy diff-gate parity (cell 10): a same-value change never reaches
      // the legacy accept branch, so the gesture is not consumed.
      if (
        world.variant === 'legacy' &&
        verdict === IC.VERDICTS.USER_INTENT &&
        world.state.mode === A.MODES.HOLDING &&
        Math.abs(round2(op.rate) - world.state.desired) <= 0.01
      ) {
        verdict = IC.VERDICTS.AUTONOMOUS;
      }
      const prevFight = world.state.fightCount;
      const r = A.step(
        world.state,
        { type: A.EVENTS.EXT_RATE, speed: op.rate, rateClass: verdict },
        opts
      );
      world.state = r.state;
      if (world.state.fightCount > prevFight) {
        world.sinceFight = 0;
      }
      if (r.effects.some((e) => e.type === A.EFFECTS.PERSIST)) {
        world.classifier.consumeGesture(); // legacy one-shot accept semantics
      }
      arbApply(world, r.effects);
      break;
    }
    case 'play':
    case 'seeked': {
      const r = A.step(world.state, { type: A.EVENTS.LIFECYCLE }, opts);
      world.state = r.state;
      arbApply(world, r.effects);
      break;
    }
    default:
      throw new Error(`unknown op ${op.op}`);
  }
}

function arbObservables(world) {
  return {
    rate: round2(world.register),
    mem: world.state.mode === A.MODES.HOLDING ? world.state.desired : null,
  };
}

/* ------------------------------------------------------------------ */
/* Runners                                                             */
/* ------------------------------------------------------------------ */

async function runDifferential(init, ops) {
  const legacy = await createLegacyWorld(init);
  const arb = createArbiterWorld(init, 'legacy');
  const trace = [];

  for (const op of ops) {
    await legacyStep(legacy, op);
    arbStep(arb, op);
    const lo = legacyObservables(legacy);
    const ro = arbObservables(arb);
    trace.push({ op, legacy: lo, arbiter: ro });
    expect(ro, `divergence after ${JSON.stringify(op)}\ntrace:\n${JSON.stringify(trace)}`).toEqual(
      lo
    );
  }

  await destroyLegacyWorld(legacy);
  arbAdvance(arb, 6000);
  const storedLegacy = getMockStorage().lastSpeed ?? null;
  expect(
    arb.stored ?? null,
    `persisted lastSpeed divergence\ntrace:\n${JSON.stringify(trace)}`
  ).toEqual(storedLegacy);
}

async function runLegacyModules(init, ops) {
  const world = await createLegacyWorld(init);
  for (const op of ops) {
    await legacyStep(world, op);
  }
  const obs = legacyObservables(world);
  await destroyLegacyWorld(world);
  return { ...obs, stored: getMockStorage().lastSpeed ?? null };
}

function runArbiter(init, ops, variant) {
  const world = createArbiterWorld(init, variant);
  for (const op of ops) {
    arbStep(world, op);
  }
  arbAdvance(world, 6000);
  return { ...arbObservables(world), stored: world.stored ?? null, mode: world.state.mode };
}

/* ------------------------------------------------------------------ */
/* Part 1: differential equivalence                                    */
/* ------------------------------------------------------------------ */

describe('Differential: arbiter(LEGACY flags) ≡ real legacy modules', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetMockStorage();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('remember-on user journey: set, restore, fight, adopt', async () => {
    await runDifferential({ rememberEnabled: true, rememberedSpeed: 1.5 }, [
      { op: 'userVsc', speed: 2.0 },
      { op: 'play' },
      { op: 'siteRate', rate: 1.0 }, // autonomous -> fight back
      { op: 'seeked' },
      { op: 'gestureClick' },
      { op: 'siteRate', rate: 1.75, pace: 'quick' }, // gestured -> adopt
      { op: 'play' },
    ]);
  });

  it('no-opinion journey: native change, lifecycle stomp, blocked adoption', async () => {
    await runDifferential({ rememberEnabled: false }, [
      { op: 'siteRate', rate: 1.5 }, // autonomous, no authority
      { op: 'play' }, // legacy stomps to 1.0 (#1537) — both sides must agree
      { op: 'gestureClick' },
      { op: 'siteRate', rate: 1.75, pace: 'quick' }, // legacy: no adoption (F3)
      { op: 'play' },
    ]);
  });

  it('site-rule journey: rule enforcement without fight-back (F5) and F1 leak', async () => {
    await runDifferential({ siteRuleSpeed: 1.25, rememberEnabled: true, rememberedSpeed: 1.8 }, [
      { op: 'play' }, // F1: rule speed leaks to storage
      { op: 'siteRate', rate: 2.0 }, // F5: no fight-back under a rule
      { op: 'play' }, // snaps back to the rule
      { op: 'gestureClick' },
      { op: 'siteRate', rate: 2.0, pace: 'quick' }, // F5: adoption blocked too
      { op: 'play' },
    ]);
  });

  it('fight sequence to surrender and the F2 restart', async () => {
    const resets = Array.from({ length: 7 }, () => ({ op: 'siteRate', rate: 1.0 }));
    await runDifferential({ rememberEnabled: true, rememberedSpeed: 1.5 }, [
      ...resets,
      { op: 'play' },
    ]);
  });

  it('fight window forgiveness at slow pacing', async () => {
    await runDifferential({ rememberEnabled: true, rememberedSpeed: 1.5 }, [
      { op: 'siteRate', rate: 1.0 },
      { op: 'siteRate', rate: 1.0, pace: 'slow' }, // window expired between
      { op: 'siteRate', rate: 1.0, pace: 'slow' },
      { op: 'play' },
    ]);
  });

  it('keyboard evidence: arrow keys and native speed keys both arm legacy', async () => {
    await runDifferential({ rememberEnabled: true, rememberedSpeed: 2.0 }, [
      { op: 'gestureKey', key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      { op: 'siteRate', rate: 1.0, pace: 'quick' }, // legacy adopts (the #1562 bug)
      { op: 'gestureKey', key: '>', code: 'Period', keyCode: 190, shiftKey: true },
      { op: 'siteRate', rate: 1.75, pace: 'quick' },
      { op: 'play' },
    ]);
  });

  it('seeded random sweep (deterministic): 20 seeds x 12 ops', async () => {
    const speeds = [1.0, 1.5, 2.0, 2.5];
    for (let seed = 1; seed <= 20; seed++) {
      let s = seed;
      const rand = () => {
        s = (s * 1103515245 + 12345) % 2147483648;
        return s / 2147483648;
      };
      const pick = (arr) => arr[Math.floor(rand() * arr.length)];

      const inits = [
        { rememberEnabled: false },
        { rememberEnabled: true, rememberedSpeed: pick(speeds) },
        { siteRuleSpeed: pick(speeds), rememberEnabled: true, rememberedSpeed: pick(speeds) },
      ];
      const init = pick(inits);

      const ops = [];
      let lastWasGesture = false;
      for (let i = 0; i < 12; i++) {
        const roll = rand();
        if (lastWasGesture && roll < 0.5) {
          ops.push({ op: 'siteRate', rate: pick(speeds), pace: 'quick' });
          lastWasGesture = false;
        } else if (roll < 0.2) {
          ops.push({ op: 'gestureClick' });
          lastWasGesture = true;
        } else if (roll < 0.3) {
          ops.push({ op: 'gestureKey', key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 });
          lastWasGesture = true;
        } else if (roll < 0.4) {
          ops.push({ op: 'pointerDown' });
          lastWasGesture = true;
        } else if (roll < 0.6) {
          ops.push({ op: 'siteRate', rate: pick(speeds), pace: rand() < 0.3 ? 'slow' : 'med' });
          lastWasGesture = false;
        } else if (roll < 0.75) {
          ops.push({ op: 'userVsc', speed: pick(speeds) });
          lastWasGesture = false;
        } else if (roll < 0.9) {
          ops.push({ op: 'play' });
          lastWasGesture = false;
        } else {
          ops.push({ op: 'seeked' });
          lastWasGesture = false;
        }
      }

      await runDifferential(init, ops);
    }
  }, 30000);
});

/* ------------------------------------------------------------------ */
/* Part 2: the bug ledger                                              */
/* ------------------------------------------------------------------ */

describe('Bug ledger: legacy reproduces, target fixes — deterministically', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetMockStorage();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('#1537 (cell 1): lifecycle stomps native speed when VSC has no opinion', async () => {
    const init = { rememberEnabled: false };
    const ops = [
      { op: 'siteRate', rate: 1.5 }, // user picked 1.5 in the native menu
      { op: 'play' },
    ];
    const legacy = await runLegacyModules(init, ops);
    expect(legacy.rate).toBe(1.0); // BUG: native choice silently undone

    expect(runArbiter(init, ops, 'legacy').rate).toBe(1.0); // model matches reality
    expect(runArbiter(init, ops, 'target').rate).toBe(1.5); // contract fixes it
  });

  it('#1494 (cell 6, resolved): lifecycle restore never overwrites lastSpeed', async () => {
    const init = { rememberEnabled: true, rememberedSpeed: 1.8 };
    const ops = [
      { op: 'siteRate', rate: 1.0 }, // background-tab style reset -> fought
      { op: 'play' },
    ];
    const legacy = await runLegacyModules(init, ops);
    expect(legacy).toMatchObject({ rate: 1.8, mem: 1.8 }); // stays fixed

    expect(runArbiter(init, ops, 'legacy')).toMatchObject({ rate: 1.8, mem: 1.8 });
    expect(runArbiter(init, ops, 'target')).toMatchObject({ rate: 1.8, mem: 1.8 });
  });

  it('#1554/#1568 (classifier): click-and-hold 2x boost is fought as autonomous', async () => {
    const init = { rememberEnabled: true, rememberedSpeed: 1.0 };
    const ops = [
      { op: 'pointerDown' }, // user holds the mouse button on YouTube
      { op: 'siteRate', rate: 2.0, pace: 'quick' }, // site applies the 2x boost
    ];
    const legacy = await runLegacyModules(init, ops);
    expect(legacy.rate).toBe(1.0); // BUG: boost immediately undone

    expect(runArbiter(init, ops, 'legacy').rate).toBe(1.0);
    expect(runArbiter(init, ops, 'target')).toMatchObject({ rate: 2.0, mem: 2.0 }); // held pointer = intent
  });

  it('#1562/#1546 (classifier): arrow-key seek blesses a transient 1x reset', async () => {
    const init = { rememberEnabled: true, rememberedSpeed: 2.0 };
    const ops = [
      { op: 'gestureKey', key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      { op: 'siteRate', rate: 1.0, pace: 'quick' }, // YouTube's seek reset
    ];
    const legacy = await runLegacyModules(init, ops);
    expect(legacy).toMatchObject({ rate: 1.0, mem: 1.0 }); // BUG: reset adopted as intent

    expect(runArbiter(init, ops, 'legacy')).toMatchObject({ rate: 1.0, mem: 1.0 });
    expect(runArbiter(init, ops, 'target')).toMatchObject({ rate: 2.0, mem: 2.0 }); // fought back
  });

  it('F1 (cell 6): site-rule lifecycle restore clobbers stored lastSpeed', async () => {
    const init = { siteRuleSpeed: 1.25, rememberEnabled: true, rememberedSpeed: 1.8 };
    const ops = [{ op: 'play' }]; // ZERO user actions
    const legacy = await runLegacyModules(init, ops);
    expect(legacy.stored).toBe(1.25); // BUG: remembered 1.8 silently overwritten

    expect(runArbiter(init, ops, 'legacy').stored).toBe(1.25);
    expect(runArbiter(init, ops, 'target').stored).toBe(1.8); // persistence purity
  });

  it('F2 (cell 9): surrender keeps authority, so the war restarts forever', async () => {
    const init = { rememberEnabled: true, rememberedSpeed: 1.5 };
    const surrenderOps = Array.from({ length: 6 }, () => ({ op: 'siteRate', rate: 1.0 }));
    const restartOps = [...surrenderOps, { op: 'siteRate', rate: 1.0 }]; // one more after surrender

    const legacy = await runLegacyModules(init, restartOps);
    expect(legacy).toMatchObject({ rate: 1.5, mem: 1.5 }); // BUG: fighting again post-surrender

    expect(runArbiter(init, restartOps, 'legacy')).toMatchObject({ rate: 1.5, mem: 1.5 });
    const target = runArbiter(init, restartOps, 'target');
    expect(target).toMatchObject({ rate: 1.0, mem: null, mode: A.MODES.SURRENDERED }); // stood down
  });

  it('F3 (cell 2): native speed choice never adopted without prior authority', async () => {
    const init = { rememberEnabled: false };
    const ops = [
      { op: 'gestureClick' }, // user clicks the native speed menu
      { op: 'siteRate', rate: 1.75, pace: 'quick' },
      { op: 'play' },
    ];
    const legacy = await runLegacyModules(init, ops);
    expect(legacy).toMatchObject({ rate: 1.0, mem: null }); // BUG: not adopted, then stomped (#1537 compounds)

    expect(runArbiter(init, ops, 'legacy')).toMatchObject({ rate: 1.0, mem: null });
    expect(runArbiter(init, ops, 'target')).toMatchObject({ rate: 1.75, mem: 1.75 }); // adopted, re-asserted
  });

  it('F5 (LOAD): under a site rule, user native changes are accepted then reverted', async () => {
    const init = { siteRuleSpeed: 1.25, rememberEnabled: false };
    const ops = [
      { op: 'gestureClick' },
      { op: 'siteRate', rate: 2.0, pace: 'quick' }, // user picks 2x natively
      { op: 'play' }, // ...and the rule snaps it back
    ];
    const legacy = await runLegacyModules(init, ops);
    expect(legacy.rate).toBe(1.25); // BUG: user choice reverted on next play

    expect(runArbiter(init, ops, 'legacy').rate).toBe(1.25);
    expect(runArbiter(init, ops, 'target')).toMatchObject({ rate: 2.0, mem: 2.0 }); // rule is initial authority only
  });

  it('#1581 (classifier, OPEN GAP): progress-bar click still blesses a seek reset', async () => {
    // Documented honestly: click narrowing needs per-site signatures. Until
    // then BOTH rule sets misclassify a click-seek reset as user intent.
    // This test pins the gap; fixing it flips the target expectation.
    const init = { rememberEnabled: true, rememberedSpeed: 2.0 };
    const ops = [
      { op: 'gestureClick' }, // click on the Facebook progress bar
      { op: 'siteRate', rate: 1.0, pace: 'quick' }, // player resets on seek
    ];
    const legacy = await runLegacyModules(init, ops);
    expect(legacy).toMatchObject({ rate: 1.0, mem: 1.0 }); // BUG

    expect(runArbiter(init, ops, 'legacy')).toMatchObject({ rate: 1.0, mem: 1.0 });
    expect(runArbiter(init, ops, 'target')).toMatchObject({ rate: 1.0, mem: 1.0 }); // still open
  });
});
