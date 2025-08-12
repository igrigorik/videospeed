/**
 * Integration tests for VSCStateManager
 * Tests the complete flow: Controller creation → State tracking → Background sync
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../helpers/chrome-mock.js';
import { SimpleTestRunner, assert, createMockVideo } from '../helpers/test-utils.js';
import { loadCoreModules } from '../helpers/module-loader.js';

// Load all required modules
await loadCoreModules();

const runner = new SimpleTestRunner();

// Setup test environment
runner.beforeEach(() => {
  installChromeMock();
  resetMockStorage();
});

runner.afterEach(() => {
  cleanupChromeMock();
});

/**
 * Mock postMessage to capture state manager communications
 */
function setupPostMessageMock() {
  const messages = [];
  const originalPostMessage = window.postMessage;

  window.postMessage = function (message, origin) {
    if (message && message.source === 'vsc-page' && message.action === 'runtime-message') {
      messages.push(message.data);
    }
    // Don't call original to avoid errors in test environment
  };

  return {
    messages,
    restore: () => { window.postMessage = originalPostMessage; }
  };
}

runner.test('StateManager registers and tracks controllers correctly', async () => {
  // Setup
  const mockMessage = setupPostMessageMock();
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  // Clear any existing state
  window.VSC.stateManager.controllers.clear();

  const actionHandler = new window.VSC.ActionHandler(config);
  const mockVideo1 = createMockVideo();
  mockVideo1.src = 'https://example.com/video1.mp4';
  mockVideo1.currentSrc = mockVideo1.src;

  const mockVideo2 = createMockVideo();
  mockVideo2.src = 'https://example.com/video2.mp4';
  mockVideo2.currentSrc = mockVideo2.src;

  // Create parent elements for DOM operations
  const parent1 = document.createElement('div');
  const parent2 = document.createElement('div');
  document.body.appendChild(parent1);
  document.body.appendChild(parent2);
  parent1.appendChild(mockVideo1);
  parent2.appendChild(mockVideo2);

  // Test: Creating first controller should trigger state update
  const controller1 = new window.VSC.VideoController(mockVideo1, parent1, config, actionHandler);

  // Verify controller is registered
  assert.equal(window.VSC.stateManager.controllers.size, 1, 'First controller should be registered');

  // Verify background notification was sent
  assert.true(mockMessage.messages.length > 0, 'Should send notification to background');
  const firstMessage = mockMessage.messages[mockMessage.messages.length - 1];
  assert.equal(firstMessage.type, 'VSC_STATE_UPDATE', 'Should send VSC_STATE_UPDATE message');
  assert.true(firstMessage.hasActiveControllers, 'Should indicate active controllers');
  assert.equal(firstMessage.controllerCount, 1, 'Should report correct controller count');

  // Test: Creating second controller
  const controller2 = new window.VSC.VideoController(mockVideo2, parent2, config, actionHandler);

  // Verify both controllers are tracked
  assert.equal(window.VSC.stateManager.controllers.size, 2, 'Both controllers should be registered');

  // Test: Removing first controller
  controller1.remove();

  // Verify controller was removed from state manager
  assert.equal(window.VSC.stateManager.controllers.size, 1, 'Controller should be removed from state manager');

  // Verify background was notified of change
  const removeMessage = mockMessage.messages[mockMessage.messages.length - 1];
  assert.equal(removeMessage.controllerCount, 1, 'Should report updated controller count');

  // Test: Removing last controller
  controller2.remove();

  // Verify all controllers removed
  assert.equal(window.VSC.stateManager.controllers.size, 0, 'All controllers should be removed');

  // Verify final notification
  const finalMessage = mockMessage.messages[mockMessage.messages.length - 1];
  assert.false(finalMessage.hasActiveControllers, 'Should indicate no active controllers');
  assert.equal(finalMessage.controllerCount, 0, 'Should report zero controllers');

  // Cleanup
  document.body.removeChild(mockVideo1);
  document.body.removeChild(mockVideo2);
  mockMessage.restore();
});

runner.test('StateManager getAllMediaElements includes all tracked videos', async () => {
  // Setup
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  // Clear any existing state
  window.VSC.stateManager.controllers.clear();

  const actionHandler = new window.VSC.ActionHandler(config);
  const mockVideo1 = createMockVideo();
  const mockVideo2 = createMockVideo();

  // Create parent elements for DOM operations
  const parent1 = document.createElement('div');
  const parent2 = document.createElement('div');
  document.body.appendChild(parent1);
  document.body.appendChild(parent2);
  parent1.appendChild(mockVideo1);
  parent2.appendChild(mockVideo2);

  // Create controllers
  const controller1 = new window.VSC.VideoController(mockVideo1, parent1, config, actionHandler);
  const controller2 = new window.VSC.VideoController(mockVideo2, parent2, config, actionHandler);

  // Test: getAllMediaElements returns all tracked videos
  const allMedia = window.VSC.stateManager.getAllMediaElements();
  assert.equal(allMedia.length, 2, 'Should return all tracked media elements');
  assert.true(allMedia.includes(mockVideo1), 'Should include first video');
  assert.true(allMedia.includes(mockVideo2), 'Should include second video');

  // Test: getControlledElements returns only videos with controllers
  const controlledMedia = window.VSC.stateManager.getControlledElements();
  assert.equal(controlledMedia.length, 2, 'Should return all controlled elements');
  assert.true(controlledMedia.every(v => v.vsc), 'All returned elements should have vsc property');

  // Cleanup
  controller1.remove();
  controller2.remove();
  document.body.removeChild(mockVideo1);
  document.body.removeChild(mockVideo2);
});

runner.test('StateManager handles disconnected elements gracefully', async () => {
  // Setup
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  // Clear any existing state
  window.VSC.stateManager.controllers.clear();

  const actionHandler = new window.VSC.ActionHandler(config);
  const mockVideo = createMockVideo();

  // Create parent element for DOM operations
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  parent.appendChild(mockVideo);

  // Create controller
  const controller = new window.VSC.VideoController(mockVideo, parent, config, actionHandler);

  // Verify controller is tracked
  assert.equal(window.VSC.stateManager.controllers.size, 1, 'Controller should be registered');

  // Test: Remove video from DOM without calling controller.remove()
  document.body.removeChild(mockVideo);

  // Call getAllMediaElements which should trigger cleanup
  const allMedia = window.VSC.stateManager.getAllMediaElements();

  // Verify stale reference was cleaned up
  assert.equal(allMedia.length, 0, 'Should return no media elements after cleanup');
  assert.equal(window.VSC.stateManager.controllers.size, 0, 'Should cleanup stale controller references');

  // No explicit cleanup needed since video is already removed from DOM
});

runner.test('StateManager throttles background notifications', async () => {
  // Setup
  const mockMessage = setupPostMessageMock();
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  // Clear any existing state
  window.VSC.stateManager.controllers.clear();

  const actionHandler = new window.VSC.ActionHandler(config);

  // Create multiple controllers rapidly
  const videos = [];
  for (let i = 0; i < 5; i++) {
    const video = createMockVideo();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    parent.appendChild(video);
    videos.push(video);
    new window.VSC.VideoController(video, parent, config, actionHandler);
  }

  // Verify throttling worked (should have fewer messages than controllers created)
  assert.true(mockMessage.messages.length < 5, 'Should throttle rapid notifications');
  assert.true(mockMessage.messages.length > 0, 'Should still send some notifications');

  // Verify final state is correct
  const finalMessage = mockMessage.messages[mockMessage.messages.length - 1];
  assert.equal(finalMessage.controllerCount, 5, 'Final message should reflect all controllers');

  // Cleanup
  videos.forEach(video => {
    video.vsc?.remove();
    document.body.removeChild(video);
  });
  mockMessage.restore();
});

console.log('State Manager integration tests loaded');

export { runner as stateManagerIntegrationTestRunner };
