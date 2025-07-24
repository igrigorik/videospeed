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
  assert.equal(config.getMediaElements().length, 1);

  // Remove controller
  controller.remove();

  // Verify cleanup
  assert.equal(mockVideo.vsc, undefined);
  assert.equal(config.getMediaElements().length, 0);
});

runner.test('VideoController should track media elements in config', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo1 = createMockVideo();
  const mockVideo2 = createMockVideo();
  mockDOM.container.appendChild(mockVideo1);
  mockDOM.container.appendChild(mockVideo2);

  assert.equal(config.getMediaElements().length, 0);

  new window.VSC.VideoController(mockVideo1, null, config, actionHandler);
  assert.equal(config.getMediaElements().length, 1);

  new window.VSC.VideoController(mockVideo2, null, config, actionHandler);
  assert.equal(config.getMediaElements().length, 2);
});

export { runner as videoControllerTestRunner };