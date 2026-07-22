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

  it('handleRateChange should consume a matching write token and stop the event', async () => {
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

    // Consumed as our own echo: no fight, no adoption, event stopped.
    expect(eventStopped).toBe(true);
    expect(eventManager.arbitration.fightCount).toBe(0);
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

    // Swallowed as our own echo: no fight, authority untouched.
    expect(eventStopped).toBe(true);
    expect(eventManager.arbitration.fightCount).toBe(0);
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

    // Surrender: authority cleared, site speed merely observed (SYNC_UI).
    expect(config.settings.lastSpeed).toBe(null);
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

    expect(eventManager.arbitration.fightCount).toBe(2);

    const fightWindowMs = window.VSC.SpeedArbitration.FIGHT_WINDOW_MS;
    await vi.advanceTimersByTimeAsync(fightWindowMs + 50);

    expect(eventManager.arbitration.fightCount).toBe(0);
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

    // Should accept: speed stays at 2.0, lastSpeed updated, fightCount reset
    expect(mockVideo.playbackRate).toBe(2.0);
    expect(config.settings.lastSpeed).toBe(2.0);
    expect(eventManager.arbitration.fightCount).toBe(0);
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

    // Should fight: speed restored to 1.5
    expect(mockVideo.playbackRate).toBe(1.5);
    expect(eventManager.arbitration.fightCount).toBe(1);
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
    expect(eventManager.arbitration.fightCount).toBe(1);
  });

  it('cleanup should clear fight detection state', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    eventManager.arbitration.fightCount = 5;
    eventManager.arbitration.fightTimer = setTimeout(() => {}, 10000);

    eventManager.cleanup();

    expect(eventManager.arbitration.fightCount).toBe(0);
    expect(eventManager.arbitration.fightTimer).toBe(null);
  });
});
