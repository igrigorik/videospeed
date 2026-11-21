/**
 * Unit tests for TwitchHandler: Twitch's worker-backed player answers any
 * ratechange it did not request with an asynchronous clamp to [0.25, 2]
 * (issue #1651). VSC's own write echoes must therefore never reach its
 * element listener on twitch.tv, while other sites keep observable echoes.
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * A <video> whose register fires a queued native-like ratechange, plus a
 * page "sink" listener modelled on Twitch's: an unexpected rate is posted to
 * the core, which writes back the clamped value on a later task.
 */
async function createTwitchLikeWorld() {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.lastSpeed = 1.0;

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);
  eventManager.actionHandler = actionHandler;
  eventManager.setupRateChangeListener(document);

  const video = document.createElement('video');
  let rate = 1.0;
  Object.defineProperty(video, 'playbackRate', {
    configurable: true,
    get: () => rate,
    set: (value) => {
      if (Number(value) === rate) {
        return;
      }
      rate = Number(value);
      setTimeout(() => video.dispatchEvent(new Event('ratechange', { composed: true })), 0);
    },
  });
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
  video.vsc = {
    div: document.createElement('div'),
    speedIndicator: { textContent: '1.00' },
  };
  document.body.append(video);

  const sinkSaw = [];
  let expectedRateChange = null;
  video.addEventListener('ratechange', () => {
    if (video.playbackRate === expectedRateChange) {
      return;
    }
    sinkSaw.push(video.playbackRate);
    const clamped = Math.min(Math.max(video.playbackRate, 0.25), 2);
    setTimeout(() => {
      expectedRateChange = clamped;
      video.playbackRate = clamped;
    }, 1);
  });

  return {
    actionHandler,
    video,
    sinkSaw,
    cleanup() {
      eventManager.cleanup();
      video.remove();
    },
  };
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
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    manager.currentHandler = null;
  });

  it('is selected on twitch.tv and its subdomains only', () => {
    vi.stubGlobal('location', { hostname: 'www.twitch.tv' });
    expect(manager.getCurrentHandler()).toBeInstanceOf(window.VSC.TwitchHandler);

    manager.currentHandler = null;
    vi.stubGlobal('location', { hostname: 'twitch.tv.example.org' });
    expect(manager.getCurrentHandler()).not.toBeInstanceOf(window.VSC.TwitchHandler);
  });

  it('hides VSC echoes so the player sink never clamps a >2x choice', async () => {
    vi.stubGlobal('location', { hostname: 'www.twitch.tv' });
    const world = await createTwitchLikeWorld();
    try {
      world.actionHandler.adjustSpeed(world.video, 3.0);
      await settle();

      expect(world.sinkSaw).toEqual([]);
      expect(world.video.playbackRate).toBe(3.0);
    } finally {
      world.cleanup();
    }
  });

  it('keeps echoes observable on other sites (control: the sink clamps)', async () => {
    vi.stubGlobal('location', { hostname: 'example.com' });
    const world = await createTwitchLikeWorld();
    try {
      world.actionHandler.adjustSpeed(world.video, 3.0);
      await settle();

      expect(world.sinkSaw[0]).toBe(3.0);
    } finally {
      world.cleanup();
    }
  });
});
