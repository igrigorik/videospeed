/**
 * Unit tests for EventManager class
 * Tests cooldown behavior to prevent rapid changes
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

  it('EventManager should initialize with cooldown disabled', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    expect(eventManager.coolDown).toBe(false);
  });

  it('refreshCoolDown should activate cooldown period', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    expect(eventManager.coolDown).toBe(false);

    eventManager.refreshCoolDown();

    expect(eventManager.coolDown).not.toBe(false);
  });

  it('handleRateChange should block events during cooldown', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '1.00' } };

    let eventStopped = false;
    const mockEvent = {
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: { origin: 'external' },
      stopImmediatePropagation: () => {
        eventStopped = true;
      },
    };

    eventManager.refreshCoolDown();

    eventManager.handleRateChange(mockEvent);
    expect(eventStopped).toBe(true);
  });

  it('cooldown should expire after timeout', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    eventManager.refreshCoolDown();
    expect(eventManager.coolDown).not.toBe(false);

    const waitMs = (window.VSC.EventManager?.BASE_COOLDOWN_MS || 50) + 50;
    await vi.advanceTimersByTimeAsync(waitMs);

    expect(eventManager.coolDown).toBe(false);
  });

  it('multiple refreshCoolDown calls should reset timer', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    eventManager.refreshCoolDown();
    const firstTimeout = eventManager.coolDown;
    expect(firstTimeout).not.toBe(false);

    await vi.advanceTimersByTimeAsync(100);

    eventManager.refreshCoolDown();
    const secondTimeout = eventManager.coolDown;

    expect(secondTimeout).not.toBe(firstTimeout);
    expect(secondTimeout).not.toBe(false);
  });

  it('cleanup should clear cooldown', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    eventManager.refreshCoolDown();
    expect(eventManager.coolDown).not.toBe(false);

    eventManager.cleanup();
    expect(eventManager.coolDown).toBe(false);
  });

  // Cooldown timing race tests

  it('cooldown should be active BEFORE playbackRate assignment in setSpeed', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = {
      div: document.createElement('div'),
      speedIndicator: { textContent: '1.00' },
    };

    let cooldownActiveDuringAssignment = false;

    let currentRate = 1.0;
    Object.defineProperty(mockVideo, 'playbackRate', {
      get() {
        return currentRate;
      },
      set(v) {
        cooldownActiveDuringAssignment = eventManager.coolDown !== false;
        currentRate = v;
      },
      configurable: true,
    });

    actionHandler.setSpeed(mockVideo, 2.0, 'internal');

    expect(cooldownActiveDuringAssignment).toBe(true);
  });

  it('setSpeed should not cause handleRateChange to process event as external', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = {
      div: document.createElement('div'),
      speedIndicator: { textContent: '1.00' },
    };

    let externalAdjustCalled = false;
    const originalAdjust = actionHandler.adjustSpeed.bind(actionHandler);
    actionHandler.adjustSpeed = function (video, value, options = {}) {
      if (options.source === 'external') {
        externalAdjustCalled = true;
      }
      return originalAdjust(video, value, options);
    };

    actionHandler.setSpeed(mockVideo, 2.0, 'internal');

    expect(externalAdjustCalled).toBe(false);
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

    const externalAdjustSpy = vi.fn();
    const actionHandler = new window.VSC.ActionHandler(config, null);
    actionHandler.adjustSpeed = function (_video, _value, options = {}) {
      if (options.source === 'external') {
        externalAdjustSpy();
      }
    };

    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '1.00' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    const maxFights = window.VSC.SpeedArbiter.DEFAULT_MAX_FIGHT + 1;

    for (let i = 0; i < maxFights - 1; i++) {
      eventManager.coolDown = false;
      mockVideo.playbackRate = 1.0;
      eventManager.handleRateChange({
        composedPath: () => [mockVideo],
        target: mockVideo,
        detail: null,
        stopImmediatePropagation: () => {},
      });
    }

    eventManager.coolDown = false;
    mockVideo.playbackRate = 1.0;
    externalAdjustSpy.mockClear();
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      stopImmediatePropagation: () => {},
    });

    expect(externalAdjustSpy).toHaveBeenCalled();
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
      eventManager.coolDown = false;
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
