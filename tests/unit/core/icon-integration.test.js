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

runner.test('VideoController should dispatch CONTROLLER_CREATED event', async () => {
  let eventReceived = false;
  let eventDetail = null;

  // Listen for the controller created event
  const eventListener = (event) => {
    if (event.type === 'VSC_CONTROLLER_CREATED') {
      eventReceived = true;
      eventDetail = event.detail;
    }
  };

  window.addEventListener('VSC_CONTROLLER_CREATED', eventListener);

  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config);
  const mockVideo = createMockVideo();
  document.body.appendChild(mockVideo);

  // Create controller - should dispatch event
  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  // Verify event was dispatched
  assert.true(eventReceived, 'VSC_CONTROLLER_CREATED event should be dispatched');
  assert.exists(eventDetail, 'Event should have detail data');
  assert.exists(eventDetail.controllerId, 'Event should include controllerId');
  assert.equal(eventDetail.videoSrc, 'https://example.com/video.mp4', 'Event should include video source');
  assert.equal(eventDetail.tagName, 'VIDEO', 'Event should include tag name');

  // Verify controller has ID
  assert.exists(controller.controllerId, 'Controller should have an ID');
  assert.equal(eventDetail.controllerId, controller.controllerId, 'Event controllerId should match controller ID');

  // Cleanup
  window.removeEventListener('VSC_CONTROLLER_CREATED', eventListener);
  document.body.removeChild(mockVideo);
});

runner.test('VideoController should dispatch CONTROLLER_REMOVED event', async () => {
  let createdEventReceived = false;
  let removedEventReceived = false;
  let removedEventDetail = null;

  // Listen for both events
  const createdListener = () => { createdEventReceived = true; };
  const removedListener = (event) => {
    if (event.type === 'VSC_CONTROLLER_REMOVED') {
      removedEventReceived = true;
      removedEventDetail = event.detail;
    }
  };

  window.addEventListener('VSC_CONTROLLER_CREATED', createdListener);
  window.addEventListener('VSC_CONTROLLER_REMOVED', removedListener);

  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config);
  const mockVideo = createMockVideo();
  document.body.appendChild(mockVideo);

  // Create controller
  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
  const controllerId = controller.controllerId;

  assert.true(createdEventReceived, 'Controller should be created first');

  // Remove controller - should dispatch removed event
  controller.remove();

  // Verify removal event was dispatched
  assert.true(removedEventReceived, 'VSC_CONTROLLER_REMOVED event should be dispatched');
  assert.exists(removedEventDetail, 'Removed event should have detail data');
  assert.equal(removedEventDetail.controllerId, controllerId, 'Removed event should include correct controllerId');
  assert.equal(removedEventDetail.videoSrc, 'https://example.com/video.mp4', 'Removed event should include video source');
  assert.equal(removedEventDetail.tagName, 'VIDEO', 'Removed event should include tag name');

  // Verify controller is properly cleaned up
  assert.equal(mockVideo.vsc, undefined, 'Video should no longer have vsc reference');

  // Cleanup
  window.removeEventListener('VSC_CONTROLLER_CREATED', createdListener);
  window.removeEventListener('VSC_CONTROLLER_REMOVED', removedListener);
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

runner.test('Audio controllers should dispatch events too', async () => {
  let eventReceived = false;
  let eventDetail = null;

  const eventListener = (event) => {
    if (event.type === 'VSC_CONTROLLER_CREATED') {
      eventReceived = true;
      eventDetail = event.detail;
    }
  };

  window.addEventListener('VSC_CONTROLLER_CREATED', eventListener);

  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.audioBoolean = true; // Enable audio support

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

  // Create audio controller - should dispatch event even if small
  const controller = new window.VSC.VideoController(mockAudio, null, config, actionHandler);

  // Verify event was dispatched
  assert.true(eventReceived, 'VSC_CONTROLLER_CREATED event should be dispatched for audio');
  assert.equal(eventDetail.tagName, 'AUDIO', 'Event should indicate AUDIO tag');
  assert.exists(controller.controllerId, 'Audio controller should have an ID');

  // Cleanup
  window.removeEventListener('VSC_CONTROLLER_CREATED', eventListener);
  controller.remove();
  document.body.removeChild(mockAudio);
});

// Run tests if this file is loaded directly
if (typeof window !== 'undefined' && window.location) {
  runner.run().then(results => {
    console.log('Icon integration tests completed:', results);
  });
}

export { runner as iconIntegrationTestRunner }; 