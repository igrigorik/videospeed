/**
 * Tests for audio element size handling
 */

import { installChromeMock, cleanupChromeMock } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert } from '../../helpers/test-utils.js';
import { loadObserverModules } from '../../helpers/module-loader.js';

// Load all required modules
await loadObserverModules();

const runner = new SimpleTestRunner();

// Test constants - values guaranteed to be below the minimum controller size limits
const SMALL_AUDIO_SIZE = {
  WIDTH: 20, // Below AUDIO_MIN_WIDTH (25)
  HEIGHT: 15, // Below AUDIO_MIN_HEIGHT (25)
};

const SMALL_VIDEO_SIZE = {
  WIDTH: 40, // Below VIDEO_MIN_WIDTH (50)  
  HEIGHT: 30, // Below VIDEO_MIN_HEIGHT (50)
};

runner.beforeEach(() => {
  installChromeMock();
});

runner.afterEach(() => {
  cleanupChromeMock();
});

function createMockAudio(options = {}) {
  const audio = document.createElement('audio');

  // Set up properties
  Object.defineProperties(audio, {
    readyState: {
      value: options.readyState || 2, // HAVE_CURRENT_DATA
      writable: true,
      configurable: true,
    },
    currentSrc: {
      value: options.currentSrc || 'https://example.com/audio.mp3',
      writable: true,
      configurable: true,
    },
    ownerDocument: {
      value: document,
      writable: true,
      configurable: true,
    },
  });

  // Mock getBoundingClientRect to return small size by default
  audio.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    width: options.width || SMALL_AUDIO_SIZE.WIDTH,
    height: options.height || SMALL_AUDIO_SIZE.HEIGHT,
  });

  // Mock isConnected
  Object.defineProperty(audio, 'isConnected', {
    value: true,
    configurable: true,
  });

  return audio;
}

runner.test('MediaElementObserver should allow small audio when audioBoolean enabled', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  // Enable audio support
  config.settings.audioBoolean = true;

  const siteHandler = new window.VSC.BaseSiteHandler();
  const observer = new window.VSC.MediaElementObserver(config, siteHandler);

  const smallAudio = createMockAudio({ width: SMALL_AUDIO_SIZE.WIDTH, height: SMALL_AUDIO_SIZE.HEIGHT });
  document.body.appendChild(smallAudio);

  const isValid = observer.isValidMediaElement(smallAudio);
  assert.true(isValid, 'Small audio element should be valid when audioBoolean is enabled');

  // Cleanup
  document.body.removeChild(smallAudio);
});

runner.test('MediaElementObserver should reject small audio when audioBoolean disabled', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  // Disable audio support
  config.settings.audioBoolean = false;

  const siteHandler = new window.VSC.BaseSiteHandler();
  const observer = new window.VSC.MediaElementObserver(config, siteHandler);

  const smallAudio = createMockAudio({ width: SMALL_AUDIO_SIZE.WIDTH, height: SMALL_AUDIO_SIZE.HEIGHT });
  document.body.appendChild(smallAudio);

  const isValid = observer.isValidMediaElement(smallAudio);
  assert.false(isValid, 'Small audio element should be rejected when audioBoolean is disabled');

  // Cleanup
  document.body.removeChild(smallAudio);
});

runner.test('VideoController should start visible for small audio elements', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  // Enable audio support
  config.settings.audioBoolean = true;
  config.settings.startHidden = false; // Ensure global startHidden is false

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const smallAudio = createMockAudio({ width: SMALL_AUDIO_SIZE.WIDTH, height: SMALL_AUDIO_SIZE.HEIGHT });
  document.body.appendChild(smallAudio);

  // Use MediaElementObserver to determine if controller should start hidden
  const siteHandler = new window.VSC.BaseSiteHandler();
  const observer = new window.VSC.MediaElementObserver(config, siteHandler);
  const shouldStartHidden = observer.shouldStartHidden(smallAudio);

  const controller = new window.VSC.VideoController(smallAudio, null, config, actionHandler, shouldStartHidden);

  // Check that controller was created
  assert.exists(controller.div, 'Controller should be created for small audio');

  // Check that it starts visible (size no longer matters)
  assert.false(
    controller.div.classList.contains('vsc-hidden'),
    'Small audio controller should start visible'
  );

  // Verify it's not hidden (uses natural visibility)
  assert.false(
    controller.div.classList.contains('vsc-hidden'),
    'Small audio controller should not be hidden'
  );

  // Cleanup
  controller.remove();
  document.body.removeChild(smallAudio);
});

runner.test('VideoController should accept all video sizes', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const siteHandler = new window.VSC.BaseSiteHandler();
  const observer = new window.VSC.MediaElementObserver(config, siteHandler);

  // Create small video element
  const smallVideo = document.createElement('video');
  smallVideo.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    width: SMALL_VIDEO_SIZE.WIDTH, // Small but should still get visible controller
    height: SMALL_VIDEO_SIZE.HEIGHT, // Small but should still get visible controller
  });

  Object.defineProperty(smallVideo, 'isConnected', {
    value: true,
    configurable: true,
  });

  Object.defineProperty(smallVideo, 'readyState', {
    value: 2,
    configurable: true,
  });

  document.body.appendChild(smallVideo);

  const isValid = observer.isValidMediaElement(smallVideo);
  assert.true(isValid, 'Small video element should be allowed');

  // Check if it would start hidden (should not due to size)
  const shouldStartHidden = observer.shouldStartHidden(smallVideo);
  assert.false(shouldStartHidden, 'Small video should start visible (size checks removed)');

  // Cleanup
  document.body.removeChild(smallVideo);
});

runner.test('Display toggle should work with audio controllers', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  // Enable audio support
  config.settings.audioBoolean = true;

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const smallAudio = createMockAudio({ width: SMALL_AUDIO_SIZE.WIDTH, height: SMALL_AUDIO_SIZE.HEIGHT });
  document.body.appendChild(smallAudio);

  // Use MediaElementObserver to determine if controller should start hidden
  const siteHandler = new window.VSC.BaseSiteHandler();
  const observer = new window.VSC.MediaElementObserver(config, siteHandler);
  const shouldStartHidden = observer.shouldStartHidden(smallAudio);

  const controller = new window.VSC.VideoController(smallAudio, null, config, actionHandler, shouldStartHidden);

  // Verify starts visible (size checks removed)
  assert.false(controller.div.classList.contains('vsc-hidden'), 'Should start visible');

  // Toggle display using action handler
  actionHandler.runAction('display', 0, null);

  // Should now be hidden after first toggle
  assert.true(controller.div.classList.contains('vsc-hidden'), 'Should be hidden after first toggle');
  assert.true(controller.div.classList.contains('vsc-manual'), 'Should have manual class');

  // Toggle again
  actionHandler.runAction('display', 0, null);

  // Should be visible again after second toggle
  assert.false(controller.div.classList.contains('vsc-hidden'), 'Should be visible after second toggle');

  // Cleanup
  controller.remove();
  document.body.removeChild(smallAudio);
});

export default runner; 