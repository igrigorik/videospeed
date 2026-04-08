/**
 * Unit tests for VideoController class
 * Using global variables to match browser extension architecture
 */

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

  it('VideoController should initialize speed using adjustSpeed method', async () => {
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

    // Track adjustSpeed calls
    let adjustSpeedCalled = false;
    let adjustSpeedParams = null;
    const originalAdjustSpeed = actionHandler.adjustSpeed;
    actionHandler.adjustSpeed = function (video, value, options) {
      adjustSpeedCalled = true;
      adjustSpeedParams = { video, value, options };
      return originalAdjustSpeed.call(this, video, value, options);
    };

    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Should have called adjustSpeed with the stored speed
    expect(adjustSpeedCalled).toBe(true);
    expect(adjustSpeedParams.value).toBe(1.75);
    expect(adjustSpeedParams.video).toBe(mockVideo);
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

    // Track adjustSpeed calls during events
    const adjustSpeedCalls = [];
    const originalAdjustSpeed = actionHandler.adjustSpeed;
    actionHandler.adjustSpeed = function (video, value, options) {
      adjustSpeedCalls.push({ video, value, options });
      return originalAdjustSpeed.call(this, video, value, options);
    };

    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Should have called adjustSpeed during initialization
    expect(adjustSpeedCalls.length > 0).toBe(true);
    const initCall = adjustSpeedCalls.find((call) => call.value === 1.5);
    expect(initCall).toBeDefined();
  });

  it('play event restoration should not overwrite lastSpeed', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;
    config.settings.lastSpeed = 1.5;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({
      currentSrc: 'https://example.com/video.mp4',
      playbackRate: 1.5,
    });
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    expect(controller).toBeDefined();

    // Simulate player reset during idle/resume, then a play lifecycle event.
    mockVideo.playbackRate = 1.0;
    controller.handlePlay({ type: 'play', target: mockVideo });

    // Lifecycle restoration should not replace user-authoritative lastSpeed.
    expect(config.settings.lastSpeed).toBe(1.5);
    expect(mockVideo.playbackRate).toBe(1.5);
  });
});
