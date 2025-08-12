/**
 * Unit tests for VideoController class
 * Using global variables to match browser extension architecture
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert, createMockVideo, createMockDOM } from '../../helpers/test-utils.js';
import { loadCoreModules } from '../../helpers/module-loader.js';

// Load all required modules
await loadCoreModules();

const runner = new SimpleTestRunner();
let mockDOM;

runner.beforeEach(() => {
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

runner.afterEach(() => {
  cleanupChromeMock();
  if (mockDOM) {
    mockDOM.cleanup();
  }
});

runner.test('VideoController should initialize with video element', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo();
  mockDOM.container.appendChild(mockVideo);

  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  assert.exists(controller);
  assert.equal(controller.video, mockVideo);
  assert.exists(controller.div);
  assert.exists(mockVideo.vsc);
  assert.equal(mockVideo.vsc, controller);
});

runner.test('VideoController should return existing controller if already attached', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo();
  mockDOM.container.appendChild(mockVideo);

  const controller1 = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
  const controller2 = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  assert.equal(controller1, controller2);
});

runner.test('VideoController should initialize speed based on settings', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.rememberSpeed = true;
  config.settings.lastSpeed = 2.0;

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo();
  mockDOM.container.appendChild(mockVideo);

  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  assert.equal(mockVideo.playbackRate, 2.0);
});

runner.test('VideoController should create controller UI', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo();
  mockDOM.container.appendChild(mockVideo);

  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  assert.exists(controller.div);
  assert.true(controller.div.classList.contains('vsc-controller'));
  assert.exists(controller.speedIndicator);
});

runner.test('VideoController should handle video without source', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo({ currentSrc: '' });
  mockDOM.container.appendChild(mockVideo);

  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  assert.true(controller.div.classList.contains('vsc-nosource'));
});

runner.test('VideoController should start hidden when configured', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();
  config.settings.startHidden = true;

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo();
  mockDOM.container.appendChild(mockVideo);

  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  assert.true(controller.div.classList.contains('vsc-hidden'));
});

runner.test('VideoController should clean up properly when removed', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo();
  mockDOM.container.appendChild(mockVideo);

  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  // Verify setup
  assert.exists(mockVideo.vsc);
  assert.equal(window.VSC.stateManager.controllers.size, 1);

  // Remove controller
  controller.remove();

  // Verify cleanup
  assert.equal(mockVideo.vsc, undefined);
  assert.equal(window.VSC.stateManager.controllers.size, 0);
});

runner.test('VideoController should register with state manager', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo1 = createMockVideo();
  const mockVideo2 = createMockVideo();
  mockDOM.container.appendChild(mockVideo1);
  mockDOM.container.appendChild(mockVideo2);

  assert.equal(window.VSC.stateManager.controllers.size, 0);

  new window.VSC.VideoController(mockVideo1, mockDOM.container, config, actionHandler);
  assert.equal(window.VSC.stateManager.controllers.size, 1);

  new window.VSC.VideoController(mockVideo2, mockDOM.container, config, actionHandler);
  assert.equal(window.VSC.stateManager.controllers.size, 2);
});

runner.test('VideoController should initialize speed using adjustSpeed method', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();
  config.settings.rememberSpeed = false; // Per-video mode
  config.settings.speeds = {
    'https://example.com/test.mp4': 1.75
  };

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo({
    currentSrc: 'https://example.com/test.mp4',
    playbackRate: 1.0
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

  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  // Should have called adjustSpeed with the stored speed
  assert.true(adjustSpeedCalled);
  assert.equal(adjustSpeedParams.value, 1.75);
  assert.equal(adjustSpeedParams.video, mockVideo);
  assert.equal(mockVideo.playbackRate, 1.75);
});

runner.test('VideoController should handle initialization with no stored speed', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();
  config.settings.rememberSpeed = false;
  config.settings.speeds = {}; // No stored speeds

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo({
    currentSrc: 'https://example.com/new-video.mp4',
    playbackRate: 1.0
  });
  mockDOM.container.appendChild(mockVideo);

  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  // Should remain at default speed when no stored speed exists
  assert.equal(mockVideo.playbackRate, 1.0);
});

runner.test('VideoController should initialize in global speed mode correctly', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();
  config.settings.rememberSpeed = true; // Global mode
  config.settings.lastSpeed = 2.25;

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  mockDOM.container.appendChild(mockVideo);

  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  // Should use global lastSpeed
  assert.equal(mockVideo.playbackRate, 2.25);
});

runner.test('VideoController should properly setup event handlers', async () => {
  const config = new window.VSC.VideoSpeedConfig();
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

  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  // Should have added media event listeners
  const listenerTypes = addedListeners.map(l => l.type);
  assert.true(addedListeners.length > 0); // Should have added some listeners

  // Should have proper vsc structure with speedIndicator
  assert.exists(mockVideo.vsc);
  assert.exists(mockVideo.vsc.speedIndicator);
  // Speed indicator should show current playback rate
  assert.exists(mockVideo.vsc.speedIndicator.textContent);
});

runner.test('VideoController should handle media events correctly', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();
  config.settings.rememberSpeed = false;
  config.settings.speeds = { 'https://example.com/video.mp4': 1.5 };

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo({
    currentSrc: 'https://example.com/video.mp4',
    playbackRate: 1.0
  });
  mockDOM.container.appendChild(mockVideo);

  // Track adjustSpeed calls during events
  const adjustSpeedCalls = [];
  const originalAdjustSpeed = actionHandler.adjustSpeed;
  actionHandler.adjustSpeed = function (video, value, options) {
    adjustSpeedCalls.push({ video, value, options });
    return originalAdjustSpeed.call(this, video, value, options);
  };

  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  // Should have called adjustSpeed during initialization
  assert.true(adjustSpeedCalls.length > 0);
  const initCall = adjustSpeedCalls.find(call => call.value === 1.5);
  assert.exists(initCall);
});

export { runner as videoControllerTestRunner };