/**
 * The proof for the speed-arbitration refactor. Two parts:
 *
 * 1. DIFFERENTIAL EQUIVALENCE — the same scenario streams drive (a) the real
 *    production pipeline (EventManager + VideoController + ActionHandler +
 *    settings) and (b) the pure arbiter model under the same composed
 *    classifier rules. Observables (register, in-memory lastSpeed,
 *    persisted lastSpeed) must match at every step. This permanently pins
 *    the pipeline to the verified model: any adapter-wiring drift or
 *    policy/model mismatch fails here with a step-by-step trace.
 *
 * 2. BUG LEDGER — deterministic regressions pin the live pipeline and the
 *    pure model to the fixed behavior. Historical compatibility models were
 *    deliberately retired rather than kept as unverified test machinery.
 *
 * Pacing model (mirrors production timing constants):
 *   quick =   50ms — inside the 300ms gesture window
 *   med   = 2500ms — outside the gesture window but inside the fight
 *                    window (3000ms): fights accumulate
 *   slow  = 3500ms — clears the fight window: fight count forgiven
 *
 * The 'echo' op simulates the browser's queued ratechange for our own
 * preceding write. It exists ONLY in the pipeline world — the pure model
 * has no echo concept, our writes simply don't produce events there — so
 * differential equivalence proves the write-token filter absorbs echoes
 * completely. Place it only right after write-producing ops (userVsc,
 * fought siteRate): an unmatched echo elsewhere is a genuine external
 * event by definition and would rightly diverge.
 */

import { vi } from 'vitest';
import { resetMockStorage, getMockStorage } from '../helpers/chrome-mock.js';
import { createMockVideo, createMockKeyboardEvent } from '../helpers/test-utils.js';
import '../../src/core/arbiter.js';
import '../../src/core/intent-classifier.js';

const A = window.VSC.SpeedArbiter;
const IC = window.VSC.IntentClassifier;

const PACE_MS = { quick: 50, med: 2500, slow: 3500 };
const FIGHT_WINDOW_MS = 3000; // SpeedArbitration.FIGHT_WINDOW_MS
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
  // Replicate load()'s site-rule branch without depending on URL pattern
  // matching in the jsdom environment. A rule seeds lastSpeed as initial
  // authority (F5 fix — mirrors settings.js load()).
  if (init.siteRuleSpeed !== null && init.siteRuleSpeed !== undefined) {
    config.settings.siteDefaultSpeed = init.siteRuleSpeed;
    config.settings.lastSpeed = init.siteRuleSpeed;
  } else {
    config.settings.siteDefaultSpeed = null;
  }

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);
  eventManager.actionHandler = actionHandler;

  // Test seam: production composed classifier rules for jsdom's hostname
  // (localhost); re-compose for the scenario's simulated host so per-site
  // signatures (e.g. YouTube hold-for-2x) are exercised.
  eventManager.arbitration.classifier.rules = rulesForScenarioHost(init.hostname);

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
      // Exactly what EventManager's document click handler does now.
      world.eventManager.arbitration.classifier.observeClick({ timeStamp: world.now });
      break;
    case 'pointerDown':
      // Exactly what EventManager's pointerdown listener does now (a
      // held pointer is intent only under YouTube's site signature).
      world.eventManager.arbitration.classifier.observePointerDown({
        timeStamp: world.now,
        pointerId: op.pointerId ?? 1,
      });
      break;
    case 'pointerEnd':
      world.eventManager.arbitration.classifier.observePointerEnd({
        timeStamp: world.now,
        pointerId: op.pointerId ?? 1,
      });
      break;
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
    case 'echo':
      // The queued native ratechange for our own last write: same video,
      // current register value, no origin marker — indistinguishable from
      // a site event except by the in-flight write token.
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

/**
 * Compose classifier rules the way production does: handler declares
 * activations for its matches() hosts; everything else is generic.
 * @param {string} [hostname]
 * @returns {Object}
 */
function rulesForScenarioHost(hostname) {
  const handlerRules = window.VSC.YouTubeHandler.matches(hostname || 'localhost')
    ? new window.VSC.YouTubeHandler().getClassifierRules()
    : null;
  return { ...IC.TARGET_RULES, ...(handlerRules || {}) };
}

function createArbiterWorld(init) {
  const rules = rulesForScenarioHost(init.hostname);
  return {
    state: A.loadState(init),
    register: initialRegister(init),
    // chrome.storage ships lastSpeed: 1.0 as the install default
    stored: init.rememberedSpeed ?? 1.0,
    rememberEnabled: !!init.rememberEnabled,
    classifier: new IC({ rules }),
    media: {},
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

  switch (op.op) {
    case 'userVsc': {
      const r = A.step(world.state, { type: A.EVENTS.USER_SET, speed: op.speed });
      world.state = r.state;
      world.sinceFight = 0;
      arbApply(world, r.effects);
      break;
    }
    case 'gestureClick':
      world.classifier.observeClick({ timeStamp: world.now });
      break;
    case 'pointerDown':
      world.classifier.observePointerDown({ timeStamp: world.now, pointerId: op.pointerId ?? 1 });
      break;
    case 'pointerEnd':
      world.classifier.observePointerEnd({ timeStamp: world.now, pointerId: op.pointerId ?? 1 });
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
        media: world.media,
        rate: op.rate,
        timeStamp: world.now,
        readyState: 4,
        detail: null,
      });
      if (verdict === IC.VERDICTS.SELF) {
        break;
      }

      let r;
      if (world.state.temporaryOverride && verdict !== IC.VERDICTS.TEMPORARY_OVERRIDE) {
        r = A.step(world.state, {
          type: A.EVENTS.TEMPORARY_OVERRIDE_END,
          speed: op.rate,
        });
      } else if (verdict === IC.VERDICTS.TEMPORARY_OVERRIDE) {
        r = A.step(world.state, {
          type: A.EVENTS.TEMPORARY_OVERRIDE_START,
          speed: op.rate,
        });
      } else {
        // Tolerance parity (cell 10): a same-value change is no divergence
        // and must not consume the gesture — mirror the adapter's demotion.
        if (
          verdict === IC.VERDICTS.USER_INTENT &&
          world.state.mode === A.MODES.HOLDING &&
          Math.abs(round2(op.rate) - world.state.desired) <= 0.01
        ) {
          verdict = IC.VERDICTS.AUTONOMOUS;
        }
        r = A.step(world.state, {
          type: A.EVENTS.EXT_RATE,
          speed: op.rate,
          rateClass: verdict,
          quiet: world.classifier.isQuietContext(world.now),
        });
      }
      const prevFight = world.state.fightCount;
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
      const r = A.step(world.state, { type: A.EVENTS.LIFECYCLE });
      world.state = r.state;
      arbApply(world, r.effects);
      break;
    }
    case 'echo':
      break; // our own writes produce no events in the model
    default:
      throw new Error(`unknown op ${op.op}`);
  }
}

function arbObservables(world) {
  return {
    rate: round2(world.register),
    // A local surrender preserves document-wide desired authority for other
    // media elements, so every phase except NO_OPINION carries the same mem.
    mem: world.state.desired,
  };
}

/* ------------------------------------------------------------------ */
/* Runners                                                             */
/* ------------------------------------------------------------------ */

async function runDifferential(init, ops) {
  const legacy = await createLegacyWorld(init);
  const arb = createArbiterWorld(init);
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

function runArbiter(init, ops) {
  const world = createArbiterWorld(init);
  for (const op of ops) {
    arbStep(world, op);
  }
  arbAdvance(world, 6000);
  return { ...arbObservables(world), stored: world.stored ?? null, mode: world.state.mode };
}

/* ------------------------------------------------------------------ */
/* Part 1: differential equivalence                                    */
/* ------------------------------------------------------------------ */

describe('Differential: production pipeline ≡ pure arbiter model', () => {
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
      { op: 'play' }, // cell 1 fixed: no stomp — both sides must agree
      { op: 'gestureClick' },
      { op: 'siteRate', rate: 1.75, pace: 'quick' }, // F3 fixed: adopted as authority
      { op: 'play' },
    ]);
  });

  it('site-rule journey: rule as initial authority (F5 fixed), no F1 leak', async () => {
    await runDifferential({ siteRuleSpeed: 1.25, rememberEnabled: true, rememberedSpeed: 1.8 }, [
      { op: 'play' }, // F1: rule speed leaks to storage
      { op: 'siteRate', rate: 2.0 }, // F5: no fight-back under a rule
      { op: 'play' }, // snaps back to the rule
      { op: 'gestureClick' },
      { op: 'siteRate', rate: 2.0, pace: 'quick' }, // F5: adoption blocked too
      { op: 'play' },
    ]);
  });

  it('fight sequence to quiet-war surrender and single re-arm on play', async () => {
    const resets = Array.from({ length: 7 }, () => ({ op: 'siteRate', rate: 1.0 }));
    await runDifferential({ rememberEnabled: true, rememberedSpeed: 1.5 }, [
      ...resets,
      { op: 'play' },
    ]);
  });

  it('user action mid-fight resets the budget (cells 5/12)', async () => {
    await runDifferential({ rememberEnabled: true, rememberedSpeed: 1.5 }, [
      { op: 'siteRate', rate: 1.0 }, // fight 1
      { op: 'siteRate', rate: 1.0 }, // fight 2
      { op: 'userVsc', speed: 2.0 }, // fresh authority, clean budget
      { op: 'siteRate', rate: 1.0 }, // fight 1 again — not 3
      { op: 'siteRate', rate: 1.0 },
      { op: 'siteRate', rate: 1.0 },
      { op: 'siteRate', rate: 1.0 },
      { op: 'siteRate', rate: 1.0 }, // 5th after reset: surrender here, not earlier
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

  it('write echoes are fully absorbed by tokens (user set, fight-back, lifecycle)', async () => {
    await runDifferential({ rememberEnabled: true, rememberedSpeed: 1.5 }, [
      { op: 'userVsc', speed: 2.0 },
      { op: 'echo', pace: 'quick' }, // echo of our write: must be a perfect no-op
      { op: 'siteRate', rate: 1.0 }, // autonomous -> fight-back writes 2.0
      { op: 'echo', pace: 'quick' }, // echo of the fight-back write
      { op: 'siteRate', rate: 1.0 }, // the war continues: budget still accounts
      { op: 'echo', pace: 'quick' },
      { op: 'play' },
    ]);
  });

  it('dense user sequence with a coalesced echo (impossible under the old cooldown)', async () => {
    await runDifferential({ rememberEnabled: true, rememberedSpeed: 1.0 }, [
      // Held-key style burst: three writes inside 150ms. The player fires
      // one ratechange for the final value; FIFO retirement must absorb it.
      { op: 'userVsc', speed: 1.5 },
      { op: 'userVsc', speed: 2.0, pace: 'quick' },
      { op: 'userVsc', speed: 2.5, pace: 'quick' },
      { op: 'echo', pace: 'quick' },
      { op: 'siteRate', rate: 1.0 }, // and a genuine reset is still fought
      { op: 'play' },
    ]);
  });

  it('keyboard evidence: speed keys arm, arrow keys do not (TARGET_RULES)', async () => {
    await runDifferential({ rememberEnabled: true, rememberedSpeed: 2.0 }, [
      { op: 'gestureKey', key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      { op: 'siteRate', rate: 1.0, pace: 'quick' }, // arrows no longer bless: fought (#1562 fixed)
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
          if (rand() < 0.5) {
            // After a user write we are HOLDING with register == desired,
            // so an echo is safe here whether or not a token was taken
            // (same-value writes take none and demote to observe).
            ops.push({ op: 'echo', pace: 'quick' });
          }
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

describe('Bug ledger: deterministic regression pins for every known bug', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetMockStorage();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('#1537 (cell 1): FIXED — lifecycle no longer stomps native speed', async () => {
    const init = { rememberEnabled: false };
    const ops = [
      { op: 'siteRate', rate: 1.5 }, // user picked 1.5 in the native menu
      { op: 'play' },
    ];
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline.rate).toBe(1.5); // production: fixed (release N)
    expect(runArbiter(init, ops).rate).toBe(1.5);
  });

  it('#1494 (cell 6, resolved): lifecycle restore never overwrites lastSpeed', async () => {
    const init = { rememberEnabled: true, rememberedSpeed: 1.8 };
    const ops = [
      { op: 'siteRate', rate: 1.0 }, // background-tab style reset -> fought
      { op: 'play' },
    ];
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline).toMatchObject({ rate: 1.8, mem: 1.8 }); // stays fixed

    expect(runArbiter(init, ops)).toMatchObject({ rate: 1.8, mem: 1.8 });
  });

  it('#1554/#1568: YouTube click-and-hold permits 2x without claiming shared authority', async () => {
    // Pointer holds are scoped to YouTube because held pointers elsewhere can
    // be scrub previews. The boost is temporary, so desired/storage remain 1x.
    const init = { rememberEnabled: true, rememberedSpeed: 1.0, hostname: 'www.youtube.com' };
    const ops = [
      { op: 'pointerDown' }, // user holds the mouse button on YouTube
      { op: 'siteRate', rate: 2.0, pace: 'quick' }, // site applies the 2x boost
    ];
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline).toMatchObject({ rate: 2.0, mem: 1.0 });
    expect(runArbiter(init, ops)).toMatchObject({ rate: 2.0, mem: 1.0 });
  });

  it('#1554 spacebar variant: YouTube Space-hold boost is temporary', async () => {
    const init = { rememberEnabled: true, rememberedSpeed: 1.0, hostname: 'www.youtube.com' };
    const ops = [
      { op: 'gestureKey', key: ' ', code: 'Space', keyCode: 32 },
      { op: 'siteRate', rate: 2.0, pace: 'quick' },
    ];
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline).toMatchObject({ rate: 2.0, mem: 1.0 });
    expect(runArbiter(init, ops)).toMatchObject({ rate: 2.0, mem: 1.0 });
  });

  it('#1554/#1568: YouTube hold release restores the pre-boost shared speed', async () => {
    const init = { rememberEnabled: true, rememberedSpeed: 1.5, hostname: 'www.youtube.com' };
    const ops = [
      { op: 'pointerDown', pointerId: 7 },
      { op: 'siteRate', rate: 2.0, pace: 'slow' }, // real YT threshold is ~500ms
      { op: 'pointerEnd', pointerId: 7, pace: 'quick' },
      { op: 'siteRate', rate: 1.0, pace: 'quick' }, // native release reset
    ];
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline).toMatchObject({ rate: 1.5, mem: 1.5, stored: 1.5 });
    expect(runArbiter(init, ops)).toMatchObject({ rate: 1.5, mem: 1.5, stored: 1.5 });
  });

  it('space on a generic site does NOT bless a rate change', async () => {
    const init = { rememberEnabled: true, rememberedSpeed: 1.0 };
    const ops = [
      { op: 'gestureKey', key: ' ', code: 'Space', keyCode: 32 },
      { op: 'siteRate', rate: 2.0, pace: 'quick' },
    ];
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline).toMatchObject({ rate: 1.0, mem: 1.0 }); // fought
    expect(runArbiter(init, ops)).toMatchObject({ rate: 1.0, mem: 1.0 });
  });

  it('held pointer on a generic site does NOT bless a rate change', async () => {
    // The YT signature must not leak: elsewhere, a rate change during a
    // held pointer (e.g. scrub-preview) is autonomous and gets fought.
    const init = { rememberEnabled: true, rememberedSpeed: 1.0 };
    const ops = [{ op: 'pointerDown' }, { op: 'siteRate', rate: 2.0, pace: 'quick' }];
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline).toMatchObject({ rate: 1.0, mem: 1.0 }); // fought back
    expect(runArbiter(init, ops)).toMatchObject({ rate: 1.0, mem: 1.0 });
  });

  it('completed YouTube pointer hold does not bless a later autonomous rate change', async () => {
    const init = { rememberEnabled: true, rememberedSpeed: 1.0, hostname: 'www.youtube.com' };
    const ops = [
      { op: 'pointerDown', pointerId: 9 },
      { op: 'pointerEnd', pointerId: 9, pace: 'quick' },
      { op: 'siteRate', rate: 2.0, pace: 'slow' },
    ];
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline).toMatchObject({ rate: 1.0, mem: 1.0 }); // fought back
    expect(runArbiter(init, ops)).toMatchObject({ rate: 1.0, mem: 1.0 });
  });

  it('#1562/#1546 (classifier): FIXED — arrow-key seek reset is fought, not adopted', async () => {
    const init = { rememberEnabled: true, rememberedSpeed: 2.0 };
    const ops = [
      { op: 'gestureKey', key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      { op: 'siteRate', rate: 1.0, pace: 'quick' }, // YouTube's seek reset
    ];
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline).toMatchObject({ rate: 2.0, mem: 2.0 }); // production: fixed (TARGET_RULES)
    expect(runArbiter(init, ops)).toMatchObject({ rate: 2.0, mem: 2.0 });
  });

  it('F1 (cell 6): FIXED — site-rule lifecycle restore no longer clobbers stored lastSpeed', async () => {
    const init = { siteRuleSpeed: 1.25, rememberEnabled: true, rememberedSpeed: 1.8 };
    const ops = [{ op: 'play' }]; // ZERO user actions
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline.stored).toBe(1.8); // production: persistence purity (setSpeed init fix)
    expect(runArbiter(init, ops).stored).toBe(1.8);
  });

  it('F2 (cells 9/9b): FIXED — surrender stands down; no automatic war restart', async () => {
    const init = { rememberEnabled: true, rememberedSpeed: 1.5 };
    const surrenderOps = Array.from({ length: 6 }, () => ({ op: 'siteRate', rate: 1.0 }));
    const restartOps = [...surrenderOps, { op: 'siteRate', rate: 1.0 }]; // one more after surrender

    // Production: this war is input-quiet (no gestures in the scenario), so
    // the local stand-down is REARMABLE. The extra reset is only OBSERVED
    // (no fight): the war did not restart, while shared authority remains
    // available to other media elements and for this player's one re-arm.
    const pipeline = await runLegacyModules(init, restartOps);
    expect(pipeline).toMatchObject({ rate: 1.0, mem: 1.5, stored: 1.5 });
    const target = runArbiter(init, restartOps);
    expect(target).toMatchObject({ rate: 1.0, mem: 1.5, mode: A.MODES.REARMABLE, stored: 1.5 });
  });

  it('quiet-war re-arm (cells 9b/14): speed returns on next play, once per session', async () => {
    const init = { rememberEnabled: true, rememberedSpeed: 1.5 };
    const war = Array.from({ length: 5 }, () => ({ op: 'siteRate', rate: 1.0 }));

    // Machine war (input-quiet) -> surrender -> play restores the speed.
    const rearmOps = [...war, { op: 'play' }];
    const pipeline = await runLegacyModules(init, rearmOps);
    expect(pipeline).toMatchObject({ rate: 1.5, mem: 1.5, stored: 1.5 });
    expect(runArbiter(init, rearmOps)).toMatchObject({ rate: 1.5, mem: 1.5 });

    // A second quiet war exhausts this media's re-arm budget: lifecycle stays
    // silent locally, but shared authority remains intact for other media.
    const secondWar = [...rearmOps, ...war, { op: 'play' }];
    const pipeline2 = await runLegacyModules(init, secondWar);
    expect(pipeline2).toMatchObject({ rate: 1.0, mem: 1.5, stored: 1.5 });
    expect(runArbiter(init, secondWar)).toMatchObject({
      rate: 1.0,
      mem: 1.5,
      mode: A.MODES.SUPPRESSED,
    });
  });

  it('activity-war surrender stays terminal: no re-arm after user-adjacent fights', async () => {
    const init = { rememberEnabled: true, rememberedSpeed: 1.5 };
    // A gesture shortly before the first reset marks the war activity-context
    // (the reset COULD have been a misclassified user action).
    const ops = [
      { op: 'gestureClick' },
      { op: 'siteRate', rate: 1.0, pace: 'quick' }, // weak evidence + 1.0 -> fought, activity war
      ...Array.from({ length: 4 }, () => ({ op: 'siteRate', rate: 1.0 })),
      { op: 'play' }, // must NOT restore
    ];
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline).toMatchObject({ rate: 1.0, mem: 1.5 });
    expect(runArbiter(init, ops)).toMatchObject({
      rate: 1.0,
      mem: 1.5,
      mode: A.MODES.SUPPRESSED,
    });
  });

  it('F3 (cell 2): FIXED — native choice becomes authority without prior opinion', async () => {
    const init = { rememberEnabled: false };
    const ops = [
      { op: 'gestureClick' }, // user clicks the native speed menu
      { op: 'siteRate', rate: 1.75, pace: 'quick' },
      { op: 'play' },
    ];
    // Production: adopted as session authority — re-asserted on play, and a
    // later autonomous reset would be fought.
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline).toMatchObject({ rate: 1.75, mem: 1.75 });
    expect(runArbiter(init, ops)).toMatchObject({ rate: 1.75, mem: 1.75 });
  });

  it('F5 (LOAD): FIXED — under a site rule, user native changes now stick', async () => {
    const init = { siteRuleSpeed: 1.25, rememberEnabled: false };
    const ops = [
      { op: 'gestureClick' },
      { op: 'siteRate', rate: 2.0, pace: 'quick' }, // user picks 2x natively
      { op: 'play' },
    ];
    const pipeline = await runLegacyModules(init, ops);
    // Production: rule is initial authority, so adoption works (HOLDING mode)
    // and lifecycle re-asserts the user's 2x instead of snapping back.
    expect(pipeline).toMatchObject({ rate: 2.0, mem: 2.0 });
    expect(runArbiter(init, ops)).toMatchObject({ rate: 2.0, mem: 2.0 });
  });

  it('#1581 (classifier): FIXED — single-click seek reset to 1.0 is fought, not adopted', async () => {
    // Tiered evidence + value asymmetry: a transition to exactly 1.0 on a
    // lone click (the signature of every documented false positive) needs
    // STRONG evidence, which an isolated seek click cannot provide.
    const init = { rememberEnabled: true, rememberedSpeed: 2.0 };
    const ops = [
      { op: 'gestureClick' }, // click on the Facebook progress bar
      { op: 'siteRate', rate: 1.0, pace: 'quick' }, // player resets on seek
    ];
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline).toMatchObject({ rate: 2.0, mem: 2.0 }); // production: fought
    expect(runArbiter(init, ops)).toMatchObject({ rate: 2.0, mem: 2.0 });
  });

  it('menu "Normal" (click sequence -> 1.0) is still adopted', async () => {
    // Real speed menus are >= 2 clicks deep, so choosing 1.0 through one
    // reaches the STRONG tier naturally — the value asymmetry costs
    // legitimate menu users nothing.
    const init = { rememberEnabled: true, rememberedSpeed: 2.0 };
    const ops = [
      { op: 'gestureClick' }, // open the menu
      { op: 'gestureClick', pace: 'quick' }, // choose "Normal"
      { op: 'siteRate', rate: 1.0, pace: 'quick' },
    ];
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline).toMatchObject({ rate: 1.0, mem: 1.0 }); // adopted
    expect(runArbiter(init, ops)).toMatchObject({ rate: 1.0, mem: 1.0 });
  });

  it('single click still adopts non-1.0 values (weak tier suffices)', async () => {
    const init = { rememberEnabled: true, rememberedSpeed: 2.0 };
    const ops = [
      { op: 'gestureClick' },
      { op: 'siteRate', rate: 1.5, pace: 'quick' }, // non-1.0: weak evidence ok
    ];
    const pipeline = await runLegacyModules(init, ops);
    expect(pipeline).toMatchObject({ rate: 1.5, mem: 1.5 });
    expect(runArbiter(init, ops)).toMatchObject({ rate: 1.5, mem: 1.5 });
  });
});
