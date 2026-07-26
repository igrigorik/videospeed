/**
 * Unit tests for VideoController class
 * Using global variables to match browser extension architecture
 */

import { vi } from 'vitest';
import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';

// Load all required modules

let mockDOM;

describe('VideoController', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    mockDOM = createMockDOM();

    // Clear state manager for tests
    if (window.VSC && window.VSC.stateManager) {
      window.VSC.stateManager.controllers.clear();
    }

    // Initialize site handler manager for tests
    if (window.VSC && window.VSC.siteHandlerManager) {
      window.VSC.siteHandlerManager.initialize(document);
    }
  });

  afterEach(() => {
    cleanupChromeMock();

    // Clear state manager after each test to prevent state leakage
    if (window.VSC && window.VSC.stateManager) {
      window.VSC.stateManager.controllers.clear();
    }

    // Remove any lingering video elements
    document.querySelectorAll('video, audio').forEach((el) => el.remove());

    if (mockDOM) {
      mockDOM.cleanup();
    }
  });

  it('VideoController should initialize with video element', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    expect(controller).toBeDefined();
    expect(controller.video).toBe(mockVideo);
    expect(controller.div).toBeDefined();
    expect(mockVideo.vsc).toBeDefined();
    expect(mockVideo.vsc).toBe(controller);
  });

  it('VideoController should return existing controller if already attached', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    const controller1 = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    const controller2 = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    expect(controller1).toBe(controller2);
  });

  it('VideoController should initialize speed based on settings', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;
    config.settings.lastSpeed = 2.0;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    expect(mockVideo.playbackRate).toBe(2.0);
  });

  it('does not restore a deferred lifecycle speed after controller removal', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 1.75;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const mockVideo = createMockVideo({ playbackRate: 1.0, readyState: 0 });
    mockDOM.container.appendChild(mockVideo);
    const writeRate = vi.spyOn(actionHandler, 'writeRate');

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    const conflict = eventManager.arbitration.conflictFor(mockVideo);
    expect(controller.handleLoadedMetadata).toBeTypeOf('function');

    controller.remove();
    mockVideo.dispatchEvent({ type: 'loadedmetadata' });

    expect(writeRate).not.toHaveBeenCalled();
    expect(controller.handleLoadedMetadata).toBeNull();
    expect(eventManager.arbitration.conflicts.get(mockVideo)).toBeUndefined();
    expect(eventManager.arbitration.timedConflicts.has(conflict)).toBe(false);
  });

  it('VideoController should create controller UI', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    expect(controller.div).toBeDefined();
    expect(controller.div.classList.contains('vsc-controller')).toBe(true);
    expect(controller.speedIndicator).toBeDefined();
  });

  it('tracks automatic media visibility beneath an explicit override', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(
      mockVideo,
      mockDOM.container,
      config,
      actionHandler
    );
    const isVideoVisible = vi.spyOn(controller, 'isVideoVisible');
    controller.div.dataset.vscVisibility = 'show';

    isVideoVisible.mockReturnValue(false);
    controller.updateVisibility();
    expect(controller.div.classList.contains('vsc-hidden')).toBe(true);
    expect(controller.div.dataset.vscVisibility).toBe('show');

    isVideoVisible.mockReturnValue(true);
    controller.updateVisibility();
    expect(controller.div.classList.contains('vsc-hidden')).toBe(false);
    expect(controller.div.dataset.vscVisibility).toBe('show');
  });

  it('VideoController should handle video without source', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ currentSrc: '' });
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    expect(controller.div.classList.contains('vsc-nosource')).toBe(true);
  });

  it('VideoController should start hidden when configured', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.startHidden = true;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    expect(controller.div.classList.contains('vsc-hidden')).toBe(true);
  });

  it('VideoController should clean up properly when removed', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Verify setup
    expect(mockVideo.vsc).toBeDefined();
    expect(window.VSC.stateManager.controllers.size).toBe(1);

    // Remove controller
    controller.remove();

    // Verify cleanup
    expect(mockVideo.vsc).toBe(undefined);
    expect(window.VSC.stateManager.controllers.size).toBe(0);
  });

  it('clears a pending controller flash timer during removal', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    vi.useFakeTimers();
    try {
      actionHandler.flashController(controller.div, 100);
      expect(controller.div.flashTimer).toBeDefined();

      controller.remove();
      expect(controller.div.flashTimer).toBeUndefined();

      await vi.advanceTimersByTimeAsync(100);
      expect(controller.div.classList.contains('vsc-show')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('VideoController should register with state manager', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo1 = createMockVideo();
    const mockVideo2 = createMockVideo();
    mockDOM.container.appendChild(mockVideo1);
    mockDOM.container.appendChild(mockVideo2);

    // State manager should be clean from beforeEach
    expect(window.VSC.stateManager.controllers.size).toBe(0);

    const controller1 = new window.VSC.VideoController(
      mockVideo1,
      mockDOM.container,
      config,
      actionHandler
    );
    expect(window.VSC.stateManager.controllers.size).toBe(1);

    const controller2 = new window.VSC.VideoController(
      mockVideo2,
      mockDOM.container,
      config,
      actionHandler
    );
    expect(window.VSC.stateManager.controllers.size).toBe(2);

    // Clean up
    controller1.remove();
    controller2.remove();
    expect(window.VSC.stateManager.controllers.size).toBe(0);
  });

  it('VideoController should initialize speed using the writeRate primitive', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true; // Enable global persistence
    config.settings.lastSpeed = 1.75;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({
      currentSrc: 'https://example.com/test.mp4',
      playbackRate: 1.0,
    });
    mockDOM.container.appendChild(mockVideo);

    // Track writeRate calls (lifecycle writes use the bare WRITE primitive)
    let writeRateCalled = false;
    let writeRateParams = null;
    const originalWriteRate = actionHandler.writeRate;
    actionHandler.writeRate = function (video, rate) {
      writeRateCalled = true;
      writeRateParams = { video, rate };
      return originalWriteRate.call(this, video, rate);
    };

    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Should have called writeRate with the stored speed
    expect(writeRateCalled).toBe(true);
    expect(writeRateParams.rate).toBe(1.75);
    expect(writeRateParams.video).toBe(mockVideo);
    expect(mockVideo.playbackRate).toBe(1.75);
  });

  it('VideoController should handle initialization with no stored speed', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = false;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({
      currentSrc: 'https://example.com/new-video.mp4',
      playbackRate: 1.0,
    });
    mockDOM.container.appendChild(mockVideo);

    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Should remain at default speed when no stored speed exists
    expect(mockVideo.playbackRate).toBe(1.0);
  });

  it('VideoController should initialize in global speed mode correctly', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true; // Global mode
    config.settings.lastSpeed = 2.25;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockDOM.container.appendChild(mockVideo);

    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Should use global lastSpeed
    expect(mockVideo.playbackRate).toBe(2.25);
  });

  it('VideoController should properly setup event handlers', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    // Track event listeners added
    const addedListeners = [];
    const originalAddEventListener = mockVideo.addEventListener;
    mockVideo.addEventListener = function (type, listener, options) {
      addedListeners.push({ type, listener, options });
      return originalAddEventListener.call(this, type, listener, options);
    };

    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Should have added media event listeners
    expect(addedListeners.length > 0).toBe(true); // Should have added some listeners

    // Should have proper vsc structure with speedIndicator
    expect(mockVideo.vsc).toBeDefined();
    expect(mockVideo.vsc.speedIndicator).toBeDefined();
    // Speed indicator should show current playback rate
    expect(mockVideo.vsc.speedIndicator.textContent).toBeDefined();
  });

  it('VideoController should handle media events correctly', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true; // Enable global persistence
    config.settings.lastSpeed = 1.5;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({
      currentSrc: 'https://example.com/video.mp4',
      playbackRate: 1.0,
    });
    mockDOM.container.appendChild(mockVideo);

    // Track writeRate calls during events
    const writeRateCalls = [];
    const originalWriteRate = actionHandler.writeRate;
    actionHandler.writeRate = function (video, rate) {
      writeRateCalls.push({ video, rate });
      return originalWriteRate.call(this, video, rate);
    };

    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Should have called writeRate during initialization
    expect(writeRateCalls.length > 0).toBe(true);
    const initCall = writeRateCalls.find((call) => call.rate === 1.5);
    expect(initCall).toBeDefined();
  });

  it('play event restore does not overwrite lastSpeed (#1494)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;
    config.settings.lastSpeed = 1.8;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({
      currentSrc: 'https://example.com/video.mp4',
      playbackRate: 1.8,
    });
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    expect(controller).toBeDefined();

    // Simulate browser resetting playbackRate during background, then play resumes
    mockVideo.playbackRate = 1.0;
    controller.handlePlay({ type: 'play', target: mockVideo });

    // Lifecycle restore should re-apply speed but NOT corrupt lastSpeed
    expect(mockVideo.playbackRate).toBe(1.8);
    expect(config.settings.lastSpeed).toBe(1.8);
  });
});
