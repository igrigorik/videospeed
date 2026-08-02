/**
 * Unit tests for EventManager class
 * Tests the write-token echo filter and the ratechange decision pipeline
 * (classifier -> arbiter -> effect execution).
 */

import { vi } from 'vitest';
import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo } from '../../helpers/test-utils.js';

function dispatchPointerEvent(type, pointerId, target = document.body, { buttons } = {}) {
  const event = new Event(type, { bubbles: true, composed: true });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  if (buttons !== undefined) {
    Object.defineProperty(event, 'buttons', { value: buttons });
  }
  target.dispatchEvent(event);
}

function fightCount(arbitration, video) {
  return arbitration.conflicts.get(video)?.fightCount ?? 0;
}

describe('EventManager', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installChromeMock();
    resetMockStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupChromeMock();
  });

  // Echo filter (write-token registry) tests

  it('handleRateChange should consume a matching write token without stopping the event', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 2.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '2.00' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    eventManager.arbitration.noteWrite(mockVideo, 2.0);

    let eventStopped = false;
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      stopImmediatePropagation: () => {
        eventStopped = true;
      },
    });

    // Consumed internally as our own echo: no local fight state is created,
    // but the native event remains observable to player listeners.
    expect(eventStopped).toBe(false);
    expect(fightCount(eventManager.arbitration, mockVideo)).toBe(0);
  });

  it('tokens are consume-once: a second identical rate is treated as external', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 1.5;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 2.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '2.00' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    eventManager.arbitration.noteWrite(mockVideo, 2.0);
    expect(eventManager.arbitration.consumeEcho(mockVideo, 2.0)).toBe(true);
    // Same value again — token is gone, this is a genuine external event.
    expect(eventManager.arbitration.consumeEcho(mockVideo, 2.0)).toBe(false);
  });

  it('echo matching is value-tolerant for player-quantized echoes', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);
    const mockVideo = createMockVideo({ playbackRate: 1.0 });

    // One 2-decimal rounding step off — a player quantized our write.
    eventManager.arbitration.noteWrite(mockVideo, 2.0);
    expect(eventManager.arbitration.consumeEcho(mockVideo, 2.01)).toBe(true);

    eventManager.arbitration.noteWrite(mockVideo, 2.0);
    expect(eventManager.arbitration.consumeEcho(mockVideo, 2.1)).toBe(false);
  });

  it('a matched echo retires older coalesced writes (FIFO)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);
    const mockVideo = createMockVideo({ playbackRate: 1.0 });

    // Rapid successive writes; the player fires one ratechange for the last.
    eventManager.arbitration.noteWrite(mockVideo, 1.1);
    eventManager.arbitration.noteWrite(mockVideo, 1.2);
    eventManager.arbitration.noteWrite(mockVideo, 1.3);

    expect(eventManager.arbitration.consumeEcho(mockVideo, 1.3)).toBe(true);
    // The earlier writes' echoes were coalesced — their tokens are retired.
    expect(eventManager.arbitration.consumeEcho(mockVideo, 1.1)).toBe(false);
    expect(eventManager.arbitration.consumeEcho(mockVideo, 1.2)).toBe(false);
  });

  it('does not let a pre-native-adoption echo token mask a later site reset', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 2.0;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    eventManager.actionHandler = actionHandler;
    const mockVideo = createMockVideo({ playbackRate: 2.0 });
    mockVideo.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '2.00' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    eventManager.arbitration.noteWrite(mockVideo, 2.0);
    mockVideo.playbackRate = 1.5;
    eventManager.arbitration.onExternalRate(
      mockVideo,
      { timeStamp: 100, stopImmediatePropagation() {} },
      window.VSC.IntentClassifier.VERDICTS.USER_INTENT
    );

    mockVideo.playbackRate = 2.0;
    let stopped = false;
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      timeStamp: 200,
      stopImmediatePropagation() {
        stopped = true;
      },
    });

    expect(config.settings.lastSpeed).toBe(1.5);
    expect(mockVideo.playbackRate).toBe(1.5);
    expect(stopped).toBe(true);
    expect(fightCount(eventManager.arbitration, mockVideo)).toBe(1);
  });

  it('does not let a pre-VSC-claim echo token mask a later site reset', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 2.0;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    eventManager.actionHandler = actionHandler;
    const mockVideo = createMockVideo({ playbackRate: 2.0 });
    mockVideo.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '2.00' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    eventManager.arbitration.noteWrite(mockVideo, 2.0);
    actionHandler.adjustSpeed(mockVideo, 1.5);

    mockVideo.playbackRate = 2.0;
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      timeStamp: 200,
      stopImmediatePropagation() {},
    });

    expect(config.settings.lastSpeed).toBe(1.5);
    expect(mockVideo.playbackRate).toBe(1.5);
    expect(fightCount(eventManager.arbitration, mockVideo)).toBe(1);
  });

  it('tokens expire after ECHO_TTL_MS', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);
    const mockVideo = createMockVideo({ playbackRate: 1.0 });

    const nowSpy = vi.spyOn(performance, 'now');
    try {
      nowSpy.mockReturnValue(10000);
      eventManager.arbitration.noteWrite(mockVideo, 2.0);

      nowSpy.mockReturnValue(10000 + window.VSC.SpeedArbitration.ECHO_TTL_MS + 1);
      expect(eventManager.arbitration.consumeEcho(mockVideo, 2.0)).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('the in-flight queue is bounded by ECHO_MAX_PENDING', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);
    const mockVideo = createMockVideo({ playbackRate: 1.0 });

    const cap = window.VSC.SpeedArbitration.ECHO_MAX_PENDING;
    for (let i = 0; i <= cap; i++) {
      eventManager.arbitration.noteWrite(mockVideo, 2 + i / 10);
    }

    expect(eventManager.arbitration.pendingWrites.get(mockVideo).length).toBe(cap);
    // The oldest write was evicted.
    expect(eventManager.arbitration.consumeEcho(mockVideo, 2.0)).toBe(false);
  });

  it('token is registered BEFORE the playbackRate assignment in writeRate', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = {
      div: document.createElement('div'),
      speedIndicator: { textContent: '1.00' },
    };

    let tokenPresentDuringAssignment = false;

    let currentRate = 1.0;
    Object.defineProperty(mockVideo, 'playbackRate', {
      get() {
        return currentRate;
      },
      set(v) {
        // The (possibly synchronous) echo must find its token already there.
        const queue = eventManager.arbitration.pendingWrites.get(mockVideo);
        tokenPresentDuringAssignment = !!queue && queue.length > 0;
        currentRate = v;
      },
      configurable: true,
    });

    actionHandler.writeRate(mockVideo, 2.0);

    expect(tokenPresentDuringAssignment).toBe(true);
  });

  it("adjustSpeed's own write echo is not processed as an external change", async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    eventManager.actionHandler = actionHandler;

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = {
      div: document.createElement('div'),
      speedIndicator: { textContent: '1.00' },
    };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    actionHandler.adjustSpeed(mockVideo, 2.0);
    expect(config.settings.lastSpeed).toBe(2.0);

    // Simulate the native echo the write produced.
    let eventStopped = false;
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      stopImmediatePropagation: () => {
        eventStopped = true;
      },
    });

    // Filtered from VSC's arbitration as its own echo, but not stopped.
    expect(eventStopped).toBe(false);
    expect(fightCount(eventManager.arbitration, mockVideo)).toBe(0);
    expect(config.settings.lastSpeed).toBe(2.0);
  });

  it('writeRate takes no token for a same-value write (no echo will fire)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 2.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '2.00' } };

    // Lifecycle re-asserts write the value already in the register.
    actionHandler.writeRate(mockVideo, 2.0);

    const queue = eventManager.arbitration.pendingWrites.get(mockVideo);
    expect(queue === undefined || queue.length === 0).toBe(true);
  });

  // Fight back / extension event tests

  it('should restore authoritative speed on external ratechange', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 1.5;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 2.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '2.00' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    let eventStopped = false;
    const mockEvent = {
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      stopImmediatePropagation: () => {
        eventStopped = true;
      },
    };

    eventManager.handleRateChange(mockEvent);

    expect(mockVideo.playbackRate).toBe(1.5);
    expect(eventStopped).toBe(true);
  });

  it('extension-originated events should be ignored before fight detection', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 1.5;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 2.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '2.00' } };

    let eventStopped = false;
    const mockEvent = {
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: { origin: 'videoSpeed', speed: '2.00', source: 'internal' },
      stopImmediatePropagation: () => {
        eventStopped = true;
      },
    };

    eventManager.handleRateChange(mockEvent);

    expect(mockVideo.playbackRate).toBe(2.0);
    expect(eventStopped).toBe(false);
  });

  // Fight detection tests

  it('should re-apply speed when site resets it (fight back)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 2.0;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '1.00' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    let eventStopped = false;
    const mockEvent = {
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      stopImmediatePropagation: () => {
        eventStopped = true;
      },
    };

    eventManager.handleRateChange(mockEvent);

    expect(mockVideo.playbackRate).toBe(2.0);
    expect(eventStopped).toBe(true);
  });

  it('should surrender after MAX_FIGHT_COUNT rapid resets', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 2.0;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);
    const observeSpy = vi.spyOn(actionHandler, 'syncIndicator');

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '1.00' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    const maxFights = window.VSC.SpeedArbiter.DEFAULT_MAX_FIGHT + 1;

    for (let i = 0; i < maxFights - 1; i++) {
      mockVideo.playbackRate = 1.0;
      eventManager.handleRateChange({
        composedPath: () => [mockVideo],
        target: mockVideo,
        detail: null,
        stopImmediatePropagation: () => {},
      });
    }

    mockVideo.playbackRate = 1.0;
    observeSpy.mockClear();
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      stopImmediatePropagation: () => {},
    });

    // Surrender is local: shared authority stays available to other media.
    expect(config.settings.lastSpeed).toBe(2.0);
    expect(eventManager.arbitration.conflicts.get(mockVideo)).toMatchObject({
      mode: window.VSC.SpeedArbiter.MODES.REARMABLE,
    });
    expect(observeSpy).toHaveBeenCalledWith(mockVideo, 1.0);
  });

  it('fight count should reset after quiet period', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 2.0;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '1.00' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    for (let i = 0; i < 2; i++) {
      mockVideo.playbackRate = 1.0;
      eventManager.handleRateChange({
        composedPath: () => [mockVideo],
        target: mockVideo,
        detail: null,
        stopImmediatePropagation: () => {},
      });
    }

    expect(fightCount(eventManager.arbitration, mockVideo)).toBe(2);

    const fightWindowMs = window.VSC.SpeedArbitration.FIGHT_WINDOW_MS;
    await vi.advanceTimersByTimeAsync(fightWindowMs + 50);

    expect(fightCount(eventManager.arbitration, mockVideo)).toBe(0);
  });

  it('fight-window expiry preserves the local phase and re-arm budget', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 2.0;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);
    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    const conflict = eventManager.arbitration.conflictFor(mockVideo);
    Object.assign(conflict, {
      mode: window.VSC.SpeedArbiter.MODES.HOLDING,
      fightCount: 2,
      warQuiet: false,
      rearmBudget: 0,
    });

    eventManager.arbitration.armFightTimer(conflict);
    await vi.advanceTimersByTimeAsync(window.VSC.SpeedArbitration.FIGHT_WINDOW_MS + 50);

    expect(conflict).toMatchObject({
      mode: window.VSC.SpeedArbiter.MODES.HOLDING,
      fightCount: 0,
      warQuiet: true,
      rearmBudget: 0,
    });
  });

  // User gesture window tests

  it('should accept external speed change when user interaction preceded it', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 1.5;
    config.settings.rememberSpeed = true;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 2.0 });
    mockVideo.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '1.50' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    // Gesture at t=1000ms, ratechange at t=1050ms → delta=50ms < USER_GESTURE_WINDOW_MS(300ms)
    eventManager.arbitration.classifier.lastGestureAt = 1000;

    let eventStopped = false;
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      timeStamp: 1050,
      stopImmediatePropagation: () => {
        eventStopped = true;
      },
    });

    // Should accept: speed stays at 2.0, lastSpeed updated, local budget reset.
    expect(mockVideo.playbackRate).toBe(2.0);
    expect(config.settings.lastSpeed).toBe(2.0);
    expect(fightCount(eventManager.arbitration, mockVideo)).toBe(0);
    expect(eventManager.arbitration.classifier.lastGestureAt).toBe(0); // consumed
    expect(eventStopped).toBe(false);
  });

  it('should fight back when external speed change has no preceding user gesture', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 1.5;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '1.50' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    // Use fixed timestamps: gesture window is 300ms, so delta of 1000ms is clearly outside
    eventManager.arbitration.classifier.lastGestureAt = 0;
    let eventStopped = false;
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      timeStamp: 1000, // 1000ms - 0ms = 1000ms >> 300ms window
      stopImmediatePropagation: () => {
        eventStopped = true;
      },
    });

    // Should fight: speed restored to 1.5 on this media element.
    expect(mockVideo.playbackRate).toBe(1.5);
    expect(fightCount(eventManager.arbitration, mockVideo)).toBe(1);
    expect(eventStopped).toBe(true);
  });

  it('should fight back when user gesture is outside the window', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 1.5;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '1.50' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    // Gesture at t=100ms, ratechange at t=700ms → delta=600ms > USER_GESTURE_WINDOW_MS(300ms)
    eventManager.arbitration.classifier.lastGestureAt = 100;
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      timeStamp: 700,
      stopImmediatePropagation: () => {},
    });

    expect(mockVideo.playbackRate).toBe(1.5); // fought back
    expect(fightCount(eventManager.arbitration, mockVideo)).toBe(1);
  });

  it('composes classifier rules from the detected site handler at construction', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    // Production wiring: SpeedArbitration asks siteHandlerManager for the
    // current handler's declared rules. Force the YouTube handler (jsdom
    // runs on localhost where matches() is false), then verify the merge.
    const manager = window.VSC.siteHandlerManager;
    const previousHandler = manager.currentHandler;
    manager.currentHandler = new window.VSC.YouTubeHandler();
    try {
      const eventManager = new window.VSC.EventManager(config, null);
      expect(eventManager.arbitration.classifier.rules.pointerHoldArms).toBe(true);
      expect(eventManager.arbitration.classifier.rules.spacebarArms).toBe(true);
      eventManager.cleanup();
    } finally {
      manager.currentHandler = previousHandler;
    }

    // Without a declaring handler, construction falls back to generic rules.
    const genericManager = new window.VSC.EventManager(config, null);
    expect(genericManager.arbitration.classifier.rules.pointerHoldArms).toBe(false);
    genericManager.cleanup();
  });

  it('resolves a direct composed-path gesture before consulting a site handler', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const videoA = createMockVideo();
    const videoB = createMockVideo();
    const getControlled = vi
      .spyOn(window.VSC.stateManager, 'getControlledElements')
      .mockReturnValue([videoA, videoB]);
    const siteResolver = vi.spyOn(window.VSC.siteHandlerManager, 'resolveGestureMedia');

    const result = eventManager.resolveGestureMedia({
      target: videoA,
      composedPath: () => [videoA, document.body, document, window],
    });

    expect(result).toBe(videoA);
    expect(siteResolver).not.toHaveBeenCalled();

    getControlled.mockRestore();
    siteResolver.mockRestore();
  });

  it('uses a site resolver only when the composed path has no controlled media', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const videoA = createMockVideo();
    const videoB = createMockVideo();
    const getControlled = vi
      .spyOn(window.VSC.stateManager, 'getControlledElements')
      .mockReturnValue([videoA, videoB]);
    const siteResolver = vi
      .spyOn(window.VSC.siteHandlerManager, 'resolveGestureMedia')
      .mockReturnValue(videoB);

    const result = eventManager.resolveGestureMedia({
      target: document.body,
      composedPath: () => [document.body, document, window],
    });

    expect(result).toBe(videoB);

    getControlled.mockRestore();
    siteResolver.mockRestore();
  });

  it('does not replace Chromium legacy mousewheel dispatch with a document wheel listener', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const addEventListener = vi.spyOn(document, 'addEventListener');
    const eventManager = new window.VSC.EventManager(config, null);
    eventManager.setupUserGestureListener(document);

    const registeredTypes = addEventListener.mock.calls.map(([type]) => type);
    expect(registeredTypes).not.toContain('wheel');
    expect(addEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function), {
      capture: true,
      passive: true,
    });
    expect(addEventListener).toHaveBeenCalledWith('touchstart', expect.any(Function), {
      capture: true,
      passive: true,
    });
    expect(eventManager.listeners.get(document).map(({ type }) => type)).not.toContain('wheel');

    eventManager.cleanup();
    addEventListener.mockRestore();
  });

  it('passes a resolved media owner into the pointer-hold ledger', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const video = createMockVideo();
    const resolve = vi.spyOn(eventManager, 'resolveGestureMedia').mockReturnValue(video);
    const observe = vi.spyOn(eventManager.arbitration.classifier, 'observePointerDown');
    eventManager.setupUserGestureListener(document);

    dispatchPointerEvent('pointerdown', 7);

    expect(observe).toHaveBeenCalledWith(expect.any(Event), video);
    resolve.mockRestore();
    eventManager.cleanup();
  });

  it.each(['pointerup', 'pointercancel'])(
    'retires a YouTube pointer hold on %s',
    async (eventType) => {
      const config = window.VSC.videoSpeedConfig;
      await config.load();

      const eventManager = new window.VSC.EventManager(config, null);
      const classifier = eventManager.arbitration.classifier;
      const video = createMockVideo({ playbackRate: 1.5 });
      classifier.rules = {
        ...window.VSC.IntentClassifier.TARGET_RULES,
        ...new window.VSC.YouTubeHandler().getClassifierRules(),
      };
      vi.spyOn(eventManager, 'resolveGestureMedia').mockReturnValue(video);
      eventManager.setupUserGestureListener(document);

      dispatchPointerEvent('pointerdown', 7);
      expect(
        classifier.classify({
          media: video,
          rate: 2.0,
          timeStamp: 1000,
          readyState: 4,
          detail: null,
        })
      ).toBe(window.VSC.IntentClassifier.VERDICTS.TEMPORARY_OVERRIDE);

      // A captured pointer can end on VSC's host. The terminal handler must
      // still retire it even though pointerdown would exclude that target.
      const controllerHost = document.createElement('vsc-controller');
      document.body.appendChild(controllerHost);
      dispatchPointerEvent(eventType, 7, controllerHost);
      expect(
        classifier.classify({
          media: video,
          rate: 2.0,
          timeStamp: 1000,
          readyState: 4,
          detail: null,
        })
      ).toBe(window.VSC.IntentClassifier.VERDICTS.AUTONOMOUS);

      controllerHost.remove();
      eventManager.cleanup();
    }
  );

  it('keeps a YouTube hold through lostpointercapture regardless of reported buttons', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const classifier = eventManager.arbitration.classifier;
    const video = createMockVideo({ playbackRate: 1.5 });
    classifier.rules = {
      ...window.VSC.IntentClassifier.TARGET_RULES,
      ...new window.VSC.YouTubeHandler().getClassifierRules(),
    };
    vi.spyOn(eventManager, 'resolveGestureMedia').mockReturnValue(video);
    eventManager.setupUserGestureListener(document);

    dispatchPointerEvent('pointerdown', 7);
    // Capture events are synthesized bookkeeping and browsers disagree about
    // their `buttons` value. Neither shape may retire a physically held press.
    dispatchPointerEvent('lostpointercapture', 7, document.body, { buttons: 1 });
    dispatchPointerEvent('lostpointercapture', 7, document.body, { buttons: 0 });
    expect(
      classifier.classify({ media: video, rate: 2.0, timeStamp: 620, readyState: 4, detail: null })
    ).toBe(window.VSC.IntentClassifier.VERDICTS.TEMPORARY_OVERRIDE);

    dispatchPointerEvent('pointerup', 7);
    eventManager.cleanup();
  });

  it('never adopts the release 1.0 write across repeated hold attempts', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 1.2;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    eventManager.actionHandler = actionHandler;
    const classifier = eventManager.arbitration.classifier;
    classifier.rules = {
      ...window.VSC.IntentClassifier.TARGET_RULES,
      ...new window.VSC.YouTubeHandler().getClassifierRules(),
    };

    const video = createMockVideo({ playbackRate: 1.2, readyState: 4 });
    video.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '1.20' } };

    const siteRate = (rate, timeStamp) => {
      video.playbackRate = rate;
      eventManager.handleRateChange({
        composedPath: () => [video],
        target: video,
        detail: null,
        timeStamp,
        stopImmediatePropagation() {},
      });
    };
    // One YouTube hold-2x attempt, mirroring the measured production order:
    // press, boost 500ms later, release, release click, app-level 1.0 write.
    const holdAttempt = (t) => {
      classifier.observePointerDown({ pointerId: 1, timeStamp: t }, video);
      siteRate(2.0, t + 507);
      for (const media of classifier.observePointerEnd({ pointerId: 1, timeStamp: t + 900 })) {
        eventManager.arbitration.noteTemporaryOverrideEnd(media);
      }
      classifier.observeClick({ timeStamp: t + 902 }, video);
      siteRate(1.0, t + 908);
    };

    holdAttempt(1000);
    expect(video.playbackRate).toBe(1.2);

    // The second quick attempt is the reported regression: its release click
    // once combined with the first attempt's click into a strong sequence
    // that adopted and persisted the structural native 1.0 reset.
    holdAttempt(3000);

    expect(video.playbackRate).toBe(1.2);
    expect(config.settings.lastSpeed).toBe(1.2);
    expect(eventManager.arbitration.authorityEpoch).toBe(0);
    expect(eventManager.arbitration.conflicts.get(video)).toMatchObject({
      mode: window.VSC.SpeedArbiter.MODES.HOLDING,
      temporaryOverride: false,
      fightCount: 0,
    });

    eventManager.cleanup();
  });

  it('does not clear a live hold when page focus moves between elements', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const classifier = eventManager.arbitration.classifier;
    classifier.rules = {
      ...window.VSC.IntentClassifier.TARGET_RULES,
      ...new window.VSC.YouTubeHandler().getClassifierRules(),
    };
    eventManager.setupUserGestureListener(document);

    const video = createMockVideo({ playbackRate: 1.5 });
    vi.spyOn(eventManager, 'resolveGestureMedia').mockReturnValue(video);
    dispatchPointerEvent('pointerdown', 7);
    expect(classifier.pointerOwners.get(7)?.media).toBe(video);

    // The press itself refocuses page UI: the previously focused element
    // fires a non-bubbling `blur` that still CAPTURES through window. That
    // must not be mistaken for the window losing focus mid-hold.
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.dispatchEvent(new Event('blur', { bubbles: false, composed: true }));

    expect(classifier.pointerOwners.get(7)?.media).toBe(video);
    expect(
      classifier.classify({
        media: video,
        rate: 2.0,
        timeStamp: 620,
        readyState: 4,
        detail: null,
      })
    ).toBe(window.VSC.IntentClassifier.VERDICTS.TEMPORARY_OVERRIDE);

    dispatchPointerEvent('pointerup', 7);
    button.remove();
    eventManager.cleanup();
  });

  it.each(['blur', 'pagehide'])(
    'clears a missed pointer terminal event on %s',
    async (eventType) => {
      const config = window.VSC.videoSpeedConfig;
      await config.load();

      const eventManager = new window.VSC.EventManager(config, null);
      const classifier = eventManager.arbitration.classifier;
      classifier.rules = {
        ...window.VSC.IntentClassifier.TARGET_RULES,
        ...new window.VSC.YouTubeHandler().getClassifierRules(),
      };
      eventManager.setupUserGestureListener(document);

      const video = createMockVideo({ playbackRate: 1.5 });
      vi.spyOn(eventManager, 'resolveGestureMedia').mockReturnValue(video);
      dispatchPointerEvent('pointerdown', 7);
      expect(classifier.activePointerIds.size).toBe(0);
      expect(classifier.pointerOwners.get(7)?.media).toBe(video);

      window.dispatchEvent(new Event(eventType));
      expect(classifier.activePointerIds.size).toBe(0);
      expect(classifier.pointerOwners.size).toBe(0);
      expect(
        classifier.classify({
          media: video,
          rate: 2.0,
          timeStamp: 1000,
          readyState: 4,
          detail: null,
        })
      ).toBe(window.VSC.IntentClassifier.VERDICTS.AUTONOMOUS);

      eventManager.cleanup();
    }
  );

  it('keeps an independent active pointer held until that pointer ends', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const classifier = eventManager.arbitration.classifier;
    classifier.rules = {
      ...window.VSC.IntentClassifier.TARGET_RULES,
      ...new window.VSC.YouTubeHandler().getClassifierRules(),
    };
    eventManager.setupUserGestureListener(document);

    const video = createMockVideo({ playbackRate: 1.5 });
    vi.spyOn(eventManager, 'resolveGestureMedia').mockReturnValue(video);
    dispatchPointerEvent('pointerdown', 1);
    dispatchPointerEvent('pointerdown', 2);
    dispatchPointerEvent('pointerup', 1);

    expect(classifier.activePointersByMedia.get(video)).toEqual(new Set([2]));
    expect(
      classifier.classify({ media: video, rate: 2.0, timeStamp: 1000, readyState: 4, detail: null })
    ).toBe(window.VSC.IntentClassifier.VERDICTS.TEMPORARY_OVERRIDE);

    dispatchPointerEvent('pointercancel', 2);
    expect(classifier.pointerOwners.size).toBe(0);
    expect(
      classifier.classify({ media: video, rate: 2.0, timeStamp: 1000, readyState: 4, detail: null })
    ).toBe(window.VSC.IntentClassifier.VERDICTS.AUTONOMOUS);

    eventManager.cleanup();
  });

  it('waits for the final active pointer before ending a temporary YouTube hold', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 1.5;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    eventManager.actionHandler = actionHandler;
    const classifier = eventManager.arbitration.classifier;
    classifier.rules = {
      ...window.VSC.IntentClassifier.TARGET_RULES,
      ...new window.VSC.YouTubeHandler().getClassifierRules(),
    };

    const video = createMockVideo({ playbackRate: 1.5, readyState: 4 });
    video.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '1.50' } };
    vi.spyOn(eventManager, 'resolveGestureMedia').mockReturnValue(video);
    eventManager.setupUserGestureListener(document);

    dispatchPointerEvent('pointerdown', 1);
    dispatchPointerEvent('pointerdown', 2);
    video.playbackRate = 2.0;
    eventManager.handleRateChange({
      composedPath: () => [video],
      target: video,
      detail: null,
      timeStamp: 620,
      stopImmediatePropagation() {},
    });
    expect(eventManager.arbitration.conflicts.get(video)?.temporaryOverride).toBe(true);

    dispatchPointerEvent('pointerup', 1);
    expect(eventManager.arbitration.pendingTemporaryReleaseTimers.size).toBe(0);
    vi.advanceTimersByTime(window.VSC.SpeedArbitration.TEMPORARY_RELEASE_FALLBACK_MS);
    expect(video.playbackRate).toBe(2.0);
    expect(eventManager.arbitration.conflicts.get(video)?.temporaryOverride).toBe(true);

    dispatchPointerEvent('pointerup', 2);
    expect(eventManager.arbitration.pendingTemporaryReleaseTimers.size).toBe(1);
    vi.advanceTimersByTime(window.VSC.SpeedArbitration.TEMPORARY_RELEASE_FALLBACK_MS);
    expect(video.playbackRate).toBe(1.5);
    expect(eventManager.arbitration.conflicts.get(video)?.temporaryOverride).toBe(false);

    eventManager.cleanup();
  });

  it('restores shared speed after a temporary YouTube pointer hold without claiming authority', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 1.5;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    eventManager.actionHandler = actionHandler;
    const classifier = eventManager.arbitration.classifier;
    classifier.rules = {
      ...window.VSC.IntentClassifier.TARGET_RULES,
      ...new window.VSC.YouTubeHandler().getClassifierRules(),
    };

    const mockVideo = createMockVideo({ playbackRate: 1.5 });
    mockVideo.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '1.50' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });
    vi.spyOn(eventManager, 'resolveGestureMedia').mockReturnValue(mockVideo);
    eventManager.setupUserGestureListener(document);

    // A prior player click plus the release click is deliberately a strong
    // menu-like sequence. Once pointerup is observed, that sequence must not
    // turn YouTube's native 1x release into durable shared authority.
    classifier.observeClick({ timeStamp: 100 }, mockVideo);
    dispatchPointerEvent('pointerdown', 7);
    dispatchPointerEvent('lostpointercapture', 7, document.body, { buttons: 0 });
    mockVideo.playbackRate = 2.0;
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      timeStamp: 620,
      stopImmediatePropagation() {},
    });

    const held = eventManager.arbitration.conflicts.get(mockVideo);
    expect(mockVideo.playbackRate).toBe(2.0);
    expect(config.settings.lastSpeed).toBe(1.5);
    expect(eventManager.arbitration.authorityEpoch).toBe(0);
    expect(held).toMatchObject({ temporaryOverride: true, fightCount: 0 });

    dispatchPointerEvent('pointerup', 7);
    classifier.observeClick({ timeStamp: 700 }, mockVideo);
    expect(
      classifier.classify({
        media: mockVideo,
        rate: 1.0,
        timeStamp: 705,
        readyState: 4,
        detail: null,
      })
    ).toBe(window.VSC.IntentClassifier.VERDICTS.USER_INTENT);
    mockVideo.playbackRate = 1.0;
    let stopped = false;
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      timeStamp: 705,
      stopImmediatePropagation() {
        stopped = true;
      },
    });

    expect(mockVideo.playbackRate).toBe(1.5);
    expect(config.settings.lastSpeed).toBe(1.5);
    expect(eventManager.arbitration.authorityEpoch).toBe(0);
    expect(eventManager.arbitration.conflicts.get(mockVideo)).toMatchObject({
      temporaryOverride: false,
      fightCount: 0,
    });
    expect(stopped).toBe(true);

    expect(eventManager.arbitration.pendingTemporaryReleaseTimers.size).toBe(0);
    eventManager.cleanup();
  });

  it.each(['pointerup', 'pagehide'])(
    'restores an active temporary hold after a missing release ratechange on %s',
    async (terminal) => {
      const config = window.VSC.videoSpeedConfig;
      await config.load();
      config.settings.lastSpeed = 1.5;

      const eventManager = new window.VSC.EventManager(config, null);
      const actionHandler = new window.VSC.ActionHandler(config, eventManager);
      eventManager.actionHandler = actionHandler;
      const classifier = eventManager.arbitration.classifier;
      classifier.rules = {
        ...window.VSC.IntentClassifier.TARGET_RULES,
        ...new window.VSC.YouTubeHandler().getClassifierRules(),
      };

      const video = createMockVideo({ playbackRate: 1.5, readyState: 4 });
      video.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '1.50' } };
      vi.spyOn(eventManager, 'resolveGestureMedia').mockReturnValue(video);
      eventManager.setupUserGestureListener(document);

      dispatchPointerEvent('pointerdown', 7);
      video.playbackRate = 2.0;
      eventManager.handleRateChange({
        composedPath: () => [video],
        target: video,
        detail: null,
        timeStamp: 620,
        stopImmediatePropagation() {},
      });
      expect(eventManager.arbitration.conflicts.get(video)?.temporaryOverride).toBe(true);

      if (terminal === 'pointerup') {
        dispatchPointerEvent('pointerup', 7);
      } else {
        window.dispatchEvent(new Event('pagehide'));
      }
      vi.advanceTimersByTime(window.VSC.SpeedArbitration.TEMPORARY_RELEASE_FALLBACK_MS);

      expect(video.playbackRate).toBe(1.5);
      expect(config.settings.lastSpeed).toBe(1.5);
      expect(eventManager.arbitration.authorityEpoch).toBe(0);
      expect(eventManager.arbitration.conflicts.get(video)).toMatchObject({
        temporaryOverride: false,
        fightCount: 0,
      });
      expect(eventManager.arbitration.pendingTemporaryReleaseTimers.size).toBe(0);

      eventManager.cleanup();
    }
  );

  it('cleanup clears every outstanding per-media fight record', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);
    const mockVideo = createMockVideo();
    const conflict = eventManager.arbitration.conflictFor(mockVideo);
    conflict.fightCount = 2;
    eventManager.arbitration.armFightTimer(conflict);

    eventManager.cleanup();

    expect(eventManager.arbitration.conflicts.get(mockVideo)).toBeUndefined();
    expect(eventManager.arbitration.timedConflicts.size).toBe(0);
  });
});
