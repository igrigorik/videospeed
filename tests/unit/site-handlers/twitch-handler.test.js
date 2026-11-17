/**
 * Unit tests for TwitchHandler (#1651): Twitch's player core mirrors every
 * observed ratechange into a worker and asynchronously writes back a value
 * clamped to [0.25, 2]. VSC hides the echo of out-of-range writes from page
 * listeners so the core never learns about (and never clamps) them, while
 * in-range writes stay observable so Twitch's own state stays in sync.
 */

import { vi } from 'vitest';
import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

async function createTwitchWorld() {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.lastSpeed = 1;

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);
  eventManager.actionHandler = actionHandler;
  // A detached root keeps the dispatch away from the extension instance the
  // test setup injects into `document`, while preserving the real ordering:
  // VSC's capture listener on an ancestor runs before page target listeners.
  const root = document.createElement('div');
  eventManager.setupRateChangeListener(root);

  const video = document.createElement('video');
  let playbackRate = 1;
  Object.defineProperty(video, 'playbackRate', {
    configurable: true,
    get: () => playbackRate,
    set: (value) => {
      playbackRate = Number(value);
    },
  });
  video.vsc = {
    div: document.createElement('div'),
    speedIndicator: { textContent: '1.00' },
  };
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
  root.append(video);

  // Stand-in for player-core's target-phase observer.
  const pageObserved = [];
  video.addEventListener('ratechange', () => pageObserved.push(video.playbackRate));

  return {
    actionHandler,
    video,
    pageObserved,
    cleanup() {
      eventManager.cleanup();
    },
  };
}

function writeAndDispatch(world, rate) {
  world.actionHandler.writeRate(world.video, rate);
  world.video.dispatchEvent(new Event('ratechange', { composed: true }));
}

describe('TwitchHandler', () => {
  let manager;

  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    manager = window.VSC.siteHandlerManager;
    manager.currentHandler = null;
  });

  afterEach(() => {
    cleanupChromeMock();
    vi.unstubAllGlobals();
    manager.currentHandler = null;
  });

  it('is selected on twitch.tv and its subdomains only', () => {
    for (const hostname of ['www.twitch.tv', 'twitch.tv', 'player.twitch.tv']) {
      vi.stubGlobal('location', { hostname });
      manager.currentHandler = null;
      expect(manager.getCurrentHandler()).toBeInstanceOf(window.VSC.TwitchHandler);
    }
    for (const hostname of ['twitch.tv.example.org', 'nottwitch.tv']) {
      vi.stubGlobal('location', { hostname });
      manager.currentHandler = null;
      expect(manager.getCurrentHandler()).not.toBeInstanceOf(window.VSC.TwitchHandler);
    }
  });

  it('hides only rates the player core would clamp', () => {
    const handler = new window.VSC.TwitchHandler();
    expect(handler.hidesRateEcho(null, 3)).toBe(true);
    expect(handler.hidesRateEcho(null, 2.1)).toBe(true);
    expect(handler.hidesRateEcho(null, 0.1)).toBe(true);
    expect(handler.hidesRateEcho(null, 2)).toBe(false);
    expect(handler.hidesRateEcho(null, 1.5)).toBe(false);
    expect(handler.hidesRateEcho(null, 0.25)).toBe(false);
  });

  it('keeps writes above 2x invisible to the page and in-range writes visible', async () => {
    vi.stubGlobal('location', { hostname: 'www.twitch.tv' });
    const world = await createTwitchWorld();
    try {
      writeAndDispatch(world, 1.5);
      writeAndDispatch(world, 3);
      writeAndDispatch(world, 1.25);

      expect(world.pageObserved).toEqual([1.5, 1.25]);
    } finally {
      world.cleanup();
    }
  });

  it('leaves echoes observable on other sites', async () => {
    vi.stubGlobal('location', { hostname: 'example.com' });
    const world = await createTwitchWorld();
    try {
      writeAndDispatch(world, 3);
      expect(world.pageObserved).toEqual([3]);
    } finally {
      world.cleanup();
    }
  });
});
