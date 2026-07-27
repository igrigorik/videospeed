/**
 * Differential replay for controller visibility.
 *
 * One event stream drives both the pure model and real DOM adapters. Chrome
 * checks the actual document-and-shadow CSS separately because jsdom does not
 * implement the complete host and shadow cascade.
 */

import { vi } from 'vitest';
import { createMockVideo } from '../helpers/test-utils.js';

const V = () => window.VSC.ControllerVisibility;
const IDS = ['A', 'B'];
const FLASH_MS = 100;

function createAudio() {
  const audio = document.createElement('audio');
  Object.defineProperties(audio, {
    playbackRate: { value: 1, writable: true, configurable: true },
    currentTime: { value: 0, writable: true, configurable: true },
    duration: { value: 100, writable: true, configurable: true },
    currentSrc: {
      value: 'https://example.com/b.mp3',
      writable: true,
      configurable: true,
    },
    readyState: { value: 4, writable: true, configurable: true },
    paused: { value: false, writable: true, configurable: true },
  });
  audio.play = () => Promise.resolve();
  audio.pause = () => {};
  return audio;
}

function createWorld() {
  const config = window.VSC.videoSpeedConfig;
  config.settings = {
    ...window.VSC.Constants.DEFAULT_SETTINGS,
    startHidden: false,
    audioBoolean: true,
  };

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);
  eventManager.actionHandler = actionHandler;

  const containers = { A: document.createElement('div'), B: document.createElement('div') };
  containers.A.dataset.testController = 'A';
  containers.B.dataset.testController = 'B';
  document.body.append(containers.A, containers.B);

  const media = {
    A: createMockVideo({ readyState: 4, currentSrc: 'https://example.com/a.mp4' }),
    B: createAudio(),
  };
  containers.A.appendChild(media.A);
  containers.B.appendChild(media.B);

  const controllers = {
    A: new window.VSC.VideoController(media.A, containers.A, config, actionHandler),
    B: new window.VSC.VideoController(media.B, containers.B, config, actionHandler),
  };
  const mediaVisible = { A: true };
  vi.spyOn(controllers.A, 'isVideoVisible').mockImplementation(() => mediaVisible.A);

  let model = {
    A: V().createState({ mediaType: V().MEDIA_TYPES.VIDEO }),
    B: V().createState({ mediaType: V().MEDIA_TYPES.AUDIO }),
  };
  const idByHost = new Map(IDS.map((id) => [controllers[id].div, id]));
  vi.spyOn(actionHandler, 'isControllerVisible').mockImplementation((host) => {
    const id = idByHost.get(host);
    if (!id || !host.isConnected || host.style.display === 'none') {
      return false;
    }
    const override = host.dataset.vscVisibility;
    if (host.classList.contains('vsc-nosource') || override === 'hide') {
      return false;
    }
    if (host.classList.contains('vsc-show') || override === 'show') {
      return true;
    }
    return (
      !host.classList.contains('vsc-hidden') && !containers[id].classList.contains('ytp-autohide')
    );
  });

  return {
    config,
    actionHandler,
    containers,
    media,
    controllers,
    mediaVisible,
    get model() {
      return model;
    },
    setModel(id, state) {
      model = { ...model, [id]: state };
    },
  };
}

function pipelineState(world, id) {
  const media = world.media[id];
  const controller = world.controllers[id];
  const attached = media.vsc === controller && controller.div.isConnected;
  const common = {
    attached,
    startHidden: world.config.settings.startHidden,
    mediaType: id === 'B' ? V().MEDIA_TYPES.AUDIO : V().MEDIA_TYPES.VIDEO,
    automaticHidden: controller.div.classList.contains('vsc-hidden'),
    noSource: controller.div.classList.contains('vsc-nosource'),
    siteAutohide: world.containers[id].classList.contains('ytp-autohide'),
    hostHidden: controller.div.style.display === 'none',
  };
  if (!attached) {
    return V().createState(common);
  }

  let flash = V().FLASH.NONE;
  if (controller.div.classList.contains('vsc-show')) {
    flash = id === 'B' ? V().FLASH.PERSISTENT : V().FLASH.TIMED_ARMED;
  }
  return V().createState({
    ...common,
    override: V().normalizeOverride(controller.div.dataset.vscVisibility),
    flash,
  });
}

function assertEquivalent(world, trace) {
  for (const id of IDS) {
    expect(
      pipelineState(world, id),
      `visibility divergence for ${id}; trace=${trace.join(' -> ')}`
    ).toEqual(world.model[id]);
  }
}

async function applyOperation(world, operation) {
  const { kind, id, value } = operation;
  const attached = id ? world.model[id].attached : false;
  const step = (target, event) => world.setModel(target, V().step(world.model[target], event));

  switch (kind) {
    case 'toggle-one':
      if (attached) {
        world.actionHandler.executeAction('display', 0, world.media[id], null);
      }
      step(id, { type: V().EVENTS.TOGGLE });
      break;
    case 'toggle-all':
      world.actionHandler.runAction('display', 0);
      IDS.forEach((target) => step(target, { type: V().EVENTS.TOGGLE }));
      break;
    case 'flash':
      if (attached) {
        world.actionHandler.flashController(world.controllers[id].div, FLASH_MS);
      }
      step(id, { type: V().EVENTS.FLASH_REQUEST });
      break;
    case 'expire':
      await vi.advanceTimersByTimeAsync(FLASH_MS);
      IDS.forEach((target) => {
        step(target, { type: V().EVENTS.TIMER_TICK });
        step(target, { type: V().EVENTS.FLASH_EXPIRE });
      });
      break;
    case 'automatic':
      if (attached) {
        if (id === 'A') {
          world.mediaVisible.A = value;
        } else {
          world.config.settings.audioBoolean = value;
        }
        world.controllers[id].updateVisibility();
      }
      step(id, {
        type: value ? V().EVENTS.AUTOMATIC_SHOW : V().EVENTS.AUTOMATIC_HIDE,
      });
      break;
    case 'site-autohide':
      if (attached) {
        world.containers[id].classList.toggle('ytp-autohide', value);
      }
      step(id, { type: V().EVENTS.SET_SITE_AUTOHIDE, value });
      break;
    case 'source':
      if (attached) {
        world.controllers[id].div.classList.toggle('vsc-nosource', !value);
      }
      step(id, { type: V().EVENTS.SET_SOURCE_AVAILABLE, value });
      break;
    case 'host-hidden':
      if (attached) {
        world.controllers[id].div.style.display = value ? 'none' : '';
      }
      step(id, { type: V().EVENTS.SET_HOST_HIDDEN, value });
      break;
    case 'start-hidden':
      world.config.settings.startHidden = value;
      IDS.forEach((target) => step(target, { type: V().EVENTS.SET_START_HIDDEN, value }));
      break;
    case 'release':
      if (attached) {
        world.controllers[id].remove();
      }
      step(id, { type: V().EVENTS.RELEASE });
      break;
    default:
      throw new Error(`Unknown visibility operation ${kind}`);
  }
}

function cleanupWorld(world) {
  for (const id of IDS) {
    if (world.model[id].attached) {
      world.controllers[id].remove();
    }
    world.containers[id].remove();
  }
}

function randomOperations(seed, count) {
  const choices = [
    { kind: 'toggle-one', id: 'A' },
    { kind: 'toggle-one', id: 'B' },
    { kind: 'toggle-all' },
    { kind: 'flash', id: 'A' },
    { kind: 'flash', id: 'B' },
    { kind: 'expire' },
    { kind: 'automatic', id: 'A', value: false },
    { kind: 'automatic', id: 'A', value: true },
    { kind: 'automatic', id: 'B', value: false },
    { kind: 'automatic', id: 'B', value: true },
    { kind: 'site-autohide', id: 'A', value: false },
    { kind: 'site-autohide', id: 'A', value: true },
    { kind: 'site-autohide', id: 'B', value: false },
    { kind: 'site-autohide', id: 'B', value: true },
    { kind: 'source', id: 'A', value: false },
    { kind: 'source', id: 'A', value: true },
    { kind: 'source', id: 'B', value: false },
    { kind: 'source', id: 'B', value: true },
    { kind: 'host-hidden', id: 'A', value: false },
    { kind: 'host-hidden', id: 'A', value: true },
    { kind: 'host-hidden', id: 'B', value: false },
    { kind: 'host-hidden', id: 'B', value: true },
    { kind: 'start-hidden', value: false },
    { kind: 'start-hidden', value: true },
    { kind: 'release', id: 'A' },
    { kind: 'release', id: 'B' },
  ];
  const operations = [];
  let value = seed >>> 0;
  for (let index = 0; index < count; index += 1) {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    operations.push(choices[value % choices.length]);
  }
  return operations;
}

describe('controller visibility production differential', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    window.VSC.stateManager.getAllMediaElements();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('matches the model through mixed local, broadcast, timer, environment, and release events', async () => {
    const world = await createWorld();
    const operations = [
      { kind: 'site-autohide', id: 'A', value: true },
      { kind: 'automatic', id: 'A', value: false },
      { kind: 'flash', id: 'A' },
      { kind: 'toggle-one', id: 'A' },
      { kind: 'toggle-one', id: 'A' },
      { kind: 'flash', id: 'B' },
      { kind: 'toggle-all' },
      { kind: 'toggle-all' },
      { kind: 'source', id: 'A', value: false },
      { kind: 'host-hidden', id: 'B', value: true },
      { kind: 'start-hidden', value: true },
      { kind: 'flash', id: 'A' },
      { kind: 'automatic', id: 'A', value: true },
      { kind: 'start-hidden', value: false },
      { kind: 'automatic', id: 'A', value: true },
      { kind: 'source', id: 'A', value: true },
      { kind: 'host-hidden', id: 'B', value: false },
      { kind: 'flash', id: 'A' },
      { kind: 'expire' },
      { kind: 'release', id: 'A' },
      { kind: 'toggle-all' },
      { kind: 'release', id: 'B' },
    ];
    const trace = [];

    try {
      assertEquivalent(world, trace);
      for (const operation of operations) {
        trace.push(JSON.stringify(operation));
        await applyOperation(world, operation);
        assertEquivalent(world, trace);
      }
    } finally {
      cleanupWorld(world);
    }
  });

  it('matches the model for deterministic generated traces', async () => {
    for (const seed of [1, 7, 19, 41, 97, 211, 997, 4099]) {
      const world = await createWorld();
      const trace = [`seed=${seed}`];
      try {
        for (const operation of randomOperations(seed, 30)) {
          trace.push(JSON.stringify(operation));
          await applyOperation(world, operation);
          assertEquivalent(world, trace);
        }
      } finally {
        cleanupWorld(world);
      }
    }
  });
});
