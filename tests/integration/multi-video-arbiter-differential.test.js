/**
 * Differential replay for the shared-authority/per-media adapter contract.
 *
 * The production EventManager/SpeedArbitration pipeline and this compact
 * adapter model consume the same two-video trace. The pure SpeedArbiter still
 * owns each local transition; the model adds only shared desired authority,
 * epochs, lazy local reset, and controller release.
 */

import { vi } from 'vitest';
import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../helpers/chrome-mock.js';
import { createMockVideo } from '../helpers/test-utils.js';
import '../../src/core/arbiter.js';

const A = window.VSC.SpeedArbiter;

function controlledVideo(rate = 2.0) {
  const video = createMockVideo({ playbackRate: rate, readyState: 4 });
  video.vsc = {
    div: document.createElement('div'),
    speedIndicator: { textContent: rate.toFixed(2) },
  };
  return video;
}

function defaultState(desired) {
  return A.loadState({ rememberEnabled: true, rememberedSpeed: desired });
}

function createModel(videos, desired) {
  return {
    desired,
    epoch: 0,
    records: new Map(),
    released: new Set(),
    rates: new Map(videos.map((video) => [video, video.playbackRate])),
  };
}

function modelStateFor(world, video) {
  if (world.released.has(video)) {
    return null;
  }
  const record = world.records.get(video);
  if (!record || record.epoch !== world.epoch) {
    return { epoch: world.epoch, state: defaultState(world.desired) };
  }
  return record;
}

function applyModelState(world, video, state) {
  world.records.set(video, { epoch: world.epoch, state });
}

function applyWrites(world, video, effects) {
  const write = effects.find((effect) => effect.type === A.EFFECTS.WRITE);
  if (write) {
    world.rates.set(video, write.speed);
  }
}

function modelClaim(world, video, speed, eventType) {
  world.desired = speed;
  world.epoch += 1;
  const result = A.step(defaultState(speed), { type: eventType, speed });
  applyModelState(world, video, result.state);
  applyWrites(world, video, result.effects);
}

function modelStep(world, op) {
  const record = modelStateFor(world, op.video);
  switch (op.type) {
    case 'siteReset': {
      world.rates.set(op.video, op.rate);
      const result = A.step(record.state, {
        type: A.EVENTS.EXT_RATE,
        speed: op.rate,
        rateClass: A.RATE_CLASSES.AUTONOMOUS,
        quiet: true,
      });
      applyModelState(world, op.video, result.state);
      applyWrites(world, op.video, result.effects);
      break;
    }
    case 'lifecycle': {
      const result = A.step(record.state, { type: A.EVENTS.LIFECYCLE });
      applyModelState(world, op.video, result.state);
      applyWrites(world, op.video, result.effects);
      break;
    }
    case 'userSet':
      modelClaim(world, op.video, op.speed, A.EVENTS.USER_SET);
      break;
    case 'nativeSet': {
      world.rates.set(op.video, op.speed);
      world.desired = op.speed;
      world.epoch += 1;
      const result = A.step(defaultState(op.speed), {
        type: A.EVENTS.EXT_RATE,
        speed: op.speed,
        rateClass: A.RATE_CLASSES.USER_INTENT,
      });
      applyModelState(world, op.video, result.state);
      applyWrites(world, op.video, result.effects);
      break;
    }
    case 'release':
      world.records.delete(op.video);
      world.released.add(op.video);
      break;
    default:
      throw new TypeError(`Unknown model operation ${op.type}`);
  }
}

function modelLocalSnapshot(world, video) {
  if (world.released.has(video)) {
    return null;
  }
  return modelStateFor(world, video).state;
}

function pipelineLocalSnapshot(world, video) {
  if (world.released.has(video)) {
    return null;
  }
  const conflict = world.eventManager.arbitration.conflicts.get(video);
  if (!conflict || conflict.epoch !== world.eventManager.arbitration.authorityEpoch) {
    return defaultState(world.config.settings.lastSpeed);
  }
  return {
    mode: conflict.mode,
    desired: world.config.settings.lastSpeed,
    fightCount: conflict.fightCount,
    warQuiet: conflict.warQuiet,
    rearmBudget: conflict.rearmBudget,
    temporaryOverride: conflict.temporaryOverride,
  };
}

function snapshot(pipeline, model, videos) {
  return {
    desired: pipeline.config.settings.lastSpeed,
    epoch: pipeline.eventManager.arbitration.authorityEpoch,
    rates: videos.map((video) => (pipeline.released.has(video) ? null : video.playbackRate)),
    local: videos.map((video) => pipelineLocalSnapshot(pipeline, video)),
    model: {
      desired: model.desired,
      epoch: model.epoch,
      rates: videos.map((video) => (model.released.has(video) ? null : model.rates.get(video))),
      local: videos.map((video) => modelLocalSnapshot(model, video)),
    },
  };
}

function assertEquivalent(pipeline, model, videos, trace) {
  const current = snapshot(pipeline, model, videos);
  expect(
    {
      desired: current.desired,
      epoch: current.epoch,
      rates: current.rates,
      local: current.local,
    },
    `two-video divergence\ntrace:\n${JSON.stringify(trace, null, 2)}`
  ).toEqual(current.model);
}

function runPipelineStep(world, op, timeStamp) {
  switch (op.type) {
    case 'siteReset':
      op.video.playbackRate = op.rate;
      world.eventManager.handleRateChange({
        composedPath: () => [op.video],
        target: op.video,
        detail: null,
        timeStamp,
        stopImmediatePropagation() {},
      });
      break;
    case 'lifecycle': {
      const target = world.eventManager.arbitration.lifecycleTarget(op.video);
      if (target !== null) {
        world.actionHandler.writeRate(op.video, target);
      }
      break;
    }
    case 'userSet':
      world.actionHandler.adjustSpeed(op.video, op.speed);
      break;
    case 'nativeSet':
      op.video.playbackRate = op.speed;
      world.eventManager.arbitration.onExternalRate(
        op.video,
        { timeStamp, stopImmediatePropagation() {} },
        window.VSC.IntentClassifier.VERDICTS.USER_INTENT
      );
      break;
    case 'release':
      world.eventManager.arbitration.release(op.video);
      world.released.add(op.video);
      break;
    default:
      throw new TypeError(`Unknown pipeline operation ${op.type}`);
  }
}

describe('two-video arbiter differential', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installChromeMock();
    resetMockStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupChromeMock();
  });

  it('matches shared authority with independent local conflicts through a mixed trace', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    eventManager.actionHandler = actionHandler;
    const videoA = controlledVideo();
    const videoB = controlledVideo();
    const videos = [videoA, videoB];
    config.settings.lastSpeed = 2.0;

    const pipeline = { config, eventManager, actionHandler, released: new Set() };
    const model = createModel(videos, 2.0);
    const trace = [];
    const ops = [
      { type: 'siteReset', video: videoA, rate: 1.0 },
      { type: 'siteReset', video: videoB, rate: 1.0 },
      ...Array.from({ length: A.DEFAULT_MAX_FIGHT }, () => ({
        type: 'siteReset',
        video: videoA,
        rate: 1.0,
      })),
      { type: 'lifecycle', video: videoB },
      { type: 'lifecycle', video: videoA },
      { type: 'nativeSet', video: videoB, speed: 1.5 },
      { type: 'lifecycle', video: videoA },
      { type: 'release', video: videoA },
      { type: 'userSet', video: videoB, speed: 1.75 },
    ];

    for (const [index, op] of ops.entries()) {
      runPipelineStep(pipeline, op, 100 + index * 10);
      modelStep(model, op);
      trace.push({
        type: op.type,
        video: op.video === videoA ? 'A' : 'B',
        speed: op.speed,
        rate: op.rate,
      });
      assertEquivalent(pipeline, model, videos, trace);
    }
  });
});
