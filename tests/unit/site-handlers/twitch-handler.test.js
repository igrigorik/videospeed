/**
 * TwitchHandler (#1651): Twitch's player core observes `ratechange`, sends the
 * rate to its worker, and asynchronously writes back a value clamped to 2x.
 * VSC must keep writes above that ceiling out of the player's sight while
 * leaving writes it accepts observable.
 */

import { vi } from 'vitest';
import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

const TWITCH_CEILING = 2;

/**
 * A real, connected <video> whose register queues a ratechange on change, as
 * browsers do, so VSC's document-capture listener and a page's target-phase
 * listener see the same dispatch in their real order.
 */
function connectedVideo() {
  const video = document.createElement('video');
  let rate = 1;
  Object.defineProperty(video, 'playbackRate', {
    configurable: true,
    get: () => rate,
    set(value) {
      if (value === rate) {
        return;
      }
      rate = value;
      setTimeout(() => video.dispatchEvent(new Event('ratechange')), 0);
    },
  });
  Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
  video.vsc = {
    div: document.createElement('div'),
    speedIndicator: { textContent: '1.00' },
  };
  document.body.appendChild(video);
  return video;
}

/**
 * Model of Twitch's sink observer: report every rate it did not ask for to
 * the "worker", which answers one task later with a clamped setPlaybackRate.
 */
function attachTwitchLikePlayer(video) {
  const observed = [];
  let expected;
  video.addEventListener('ratechange', () => {
    if (video.playbackRate === expected) {
      return;
    }
    observed.push(video.playbackRate);
    const clamped = Math.min(video.playbackRate, TWITCH_CEILING);
    setTimeout(() => {
      if (video.playbackRate !== clamped) {
        expected = clamped;
        video.playbackRate = clamped;
      }
    }, 5);
  });
  return observed;
}

describe('TwitchHandler', () => {
  let eventManager;
  let actionHandler;
  let config;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installChromeMock();
    resetMockStorage();
    config = window.VSC.videoSpeedConfig;
    await config.load();
    eventManager = new window.VSC.EventManager(config, null);
    actionHandler = new window.VSC.ActionHandler(config, eventManager);
    eventManager.actionHandler = actionHandler;
    eventManager.setupRateChangeListener(document);
  });

  afterEach(() => {
    eventManager.cleanup();
    window.VSC.siteHandlerManager.refresh();
    document.body.innerHTML = '';
    vi.useRealTimers();
    cleanupChromeMock();
  });

  function useHandler(handler) {
    window.VSC.siteHandlerManager.currentHandler = handler;
  }

  it('matches twitch.tv and its subdomains, including the embed player host', () => {
    const { TwitchHandler } = window.VSC;
    expect(TwitchHandler.matches('twitch.tv')).toBe(true);
    expect(TwitchHandler.matches('www.twitch.tv')).toBe(true);
    expect(TwitchHandler.matches('m.twitch.tv')).toBe(true);
    expect(TwitchHandler.matches('player.twitch.tv')).toBe(true);
    expect(TwitchHandler.matches('nottwitch.tv')).toBe(false);
    expect(TwitchHandler.matches('twitch.tv.example.com')).toBe(false);
  });

  it('hides only echoes above the native 2x ceiling', () => {
    const handler = new window.VSC.TwitchHandler();
    const video = document.createElement('video');
    expect(handler.hidesRateEcho(video, 1.5)).toBe(false);
    expect(handler.hidesRateEcho(video, 2)).toBe(false);
    expect(handler.hidesRateEcho(video, 2.1)).toBe(true);
    expect(new window.VSC.BaseSiteHandler().hidesRateEcho(video, 16)).toBe(false);
  });

  it('holds a rate above 2x against a clamping player on Twitch', async () => {
    useHandler(new window.VSC.TwitchHandler());
    const video = connectedVideo();
    const observed = attachTwitchLikePlayer(video);

    actionHandler.adjustSpeed(video, 3);
    await vi.advanceTimersByTimeAsync(100);

    expect(video.playbackRate).toBe(3);
    expect(observed).toEqual([]);
    expect(config.settings.lastSpeed).toBe(3);
  });

  it('keeps writes at or below the ceiling visible to the player', async () => {
    useHandler(new window.VSC.TwitchHandler());
    const video = connectedVideo();
    const observed = attachTwitchLikePlayer(video);

    actionHandler.adjustSpeed(video, 1.5);
    await vi.advanceTimersByTimeAsync(100);

    expect(observed).toEqual([1.5]);
    expect(video.playbackRate).toBe(1.5);
  });

  it('hides fight-back writes too, so the first retry above 2x sticks', async () => {
    useHandler(new window.VSC.TwitchHandler());
    const video = connectedVideo();
    const observed = attachTwitchLikePlayer(video);

    actionHandler.adjustSpeed(video, 3);
    await vi.advanceTimersByTimeAsync(100);
    // A genuine site reset (e.g. a player rebuild) arrives with no input.
    video.playbackRate = 1;
    await vi.advanceTimersByTimeAsync(100);

    // The fight path already stops the reset event itself; the retry write's
    // echo is the one the handler must hide.
    expect(video.playbackRate).toBe(3);
    expect(observed).toEqual([]);
    expect(eventManager.arbitration.conflicts.get(video)?.fightCount).toBe(1);
  });

  it('without the handler, the same player pins VSC to 2x (regression shape)', async () => {
    useHandler(new window.VSC.BaseSiteHandler());
    const video = connectedVideo();
    const observed = attachTwitchLikePlayer(video);

    actionHandler.adjustSpeed(video, 3);
    await vi.advanceTimersByTimeAsync(1000);

    expect(observed[0]).toBe(3);
    expect(video.playbackRate).toBe(TWITCH_CEILING);
  });
});
