/**
 * Tests for icon integration (controller lifecycle events)
 */

import { installChromeMock, cleanupChromeMock } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert } from '../../helpers/test-utils.js';
import { loadObserverModules } from '../../helpers/module-loader.js';

// Load all required modules
await loadObserverModules();

const runner = new SimpleTestRunner();

runner.beforeEach(() => {
  installChromeMock();
});

runner.afterEach(() => {
  cleanupChromeMock();
});

function createMockVideo(options = {}) {
  const video = document.createElement('video');

  Object.defineProperties(video, {
    readyState: {
      value: options.readyState || 2, // HAVE_CURRENT_DATA
      writable: true,
      configurable: true,
    },
    currentSrc: {
      value: options.currentSrc || 'https://example.com/video.mp4',
      writable: true,
      configurable: true,
    },
    ownerDocument: {
      value: document,
      writable: true,
      configurable: true,
    },
    getBoundingClientRect: {
      value: () => ({
        width: options.width || 640,
        height: options.height || 360,
        top: 0,
        left: 0,
        right: options.width || 640,
        bottom: options.height || 360,
      }),
      writable: true,
      configurable: true,
    },
  });

  return video;
}

runner.test('VideoController should register with state manager', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  // Clear state manager
  window.VSC.stateManager.controllers.clear();

  const actionHandler = new window.VSC.ActionHandler(config);
  const mockVideo = createMockVideo();
  document.body.appendChild(mockVideo);

  // Create controller - should register with state manager
  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  // Verify controller is registered with state manager
  assert.equal(window.VSC.stateManager.controllers.size, 1, 'Controller should be registered with state manager');
  assert.true(window.VSC.stateManager.controllers.has(controller.controllerId), 'Controller ID should be in state manager');

  // Verify controller has ID
  assert.exists(controller.controllerId, 'Controller should have an ID');

  // Verify state manager has correct info
  const controllerInfo = window.VSC.stateManager.controllers.get(controller.controllerId);
  assert.exists(controllerInfo, 'Controller info should exist in state manager');
  assert.equal(controllerInfo.element, mockVideo, 'State manager should reference correct video element');
  assert.equal(controllerInfo.tagName, 'VIDEO', 'State manager should store tag name');

  // Cleanup
  controller.remove();
  document.body.removeChild(mockVideo);
});

runner.test('VideoController should unregister from state manager on removal', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  // Clear state manager
  window.VSC.stateManager.controllers.clear();

  const actionHandler = new window.VSC.ActionHandler(config);
  const mockVideo = createMockVideo();
  document.body.appendChild(mockVideo);

  // Create controller
  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
  const controllerId = controller.controllerId;

  assert.equal(window.VSC.stateManager.controllers.size, 1, 'Controller should be registered');

  // Remove controller - should unregister from state manager
  controller.remove();

  // Verify controller was unregistered from state manager
  assert.equal(window.VSC.stateManager.controllers.size, 0, 'Controller should be unregistered from state manager');
  assert.false(window.VSC.stateManager.controllers.has(controllerId), 'Controller ID should be removed from state manager');

  // Verify controller is properly cleaned up
  assert.equal(mockVideo.vsc, undefined, 'Video should no longer have vsc reference');

  // Cleanup
  document.body.removeChild(mockVideo);
});

runner.test('Controllers should have unique IDs', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config);

  // Create multiple videos
  const video1 = createMockVideo({ currentSrc: 'https://example.com/video1.mp4' });
  const video2 = createMockVideo({ currentSrc: 'https://example.com/video2.mp4' });

  document.body.appendChild(video1);
  document.body.appendChild(video2);

  // Create controllers
  const controller1 = new window.VSC.VideoController(video1, null, config, actionHandler);
  const controller2 = new window.VSC.VideoController(video2, null, config, actionHandler);

  // Verify IDs are unique
  assert.exists(controller1.controllerId, 'Controller 1 should have an ID');
  assert.exists(controller2.controllerId, 'Controller 2 should have an ID');
  assert.true(
    controller1.controllerId !== controller2.controllerId,
    `Controller IDs should be unique, got ${controller1.controllerId} and ${controller2.controllerId}`
  );

  // Cleanup
  controller1.remove();
  controller2.remove();
  document.body.removeChild(video1);
  document.body.removeChild(video2);
});

runner.test('Audio controllers should register with state manager too', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.audioBoolean = true; // Enable audio support

  // Clear state manager
  window.VSC.stateManager.controllers.clear();

  const actionHandler = new window.VSC.ActionHandler(config);
  const mockAudio = document.createElement('audio');

  Object.defineProperties(mockAudio, {
    readyState: { value: 2, writable: true, configurable: true },
    currentSrc: { value: 'https://example.com/audio.mp3', writable: true, configurable: true },
    ownerDocument: { value: document, writable: true, configurable: true },
    getBoundingClientRect: {
      value: () => ({ width: 15, height: 15, top: 0, left: 0, right: 15, bottom: 15 }),
      writable: true,
      configurable: true,
    },
  });

  document.body.appendChild(mockAudio);

  // Create audio controller - should register with state manager even if small
  const controller = new window.VSC.VideoController(mockAudio, null, config, actionHandler);

  // Verify controller is registered with state manager
  assert.equal(window.VSC.stateManager.controllers.size, 1, 'Audio controller should be registered with state manager');
  assert.exists(controller.controllerId, 'Audio controller should have an ID');

  // Verify state manager has correct info for audio
  const controllerInfo = window.VSC.stateManager.controllers.get(controller.controllerId);
  assert.equal(controllerInfo.tagName, 'AUDIO', 'State manager should store AUDIO tag name');

  // Cleanup
  controller.remove();
  document.body.removeChild(mockAudio);
});

export { runner as iconIntegrationTestRunner }; 