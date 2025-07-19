/**
 * Unit tests for VideoSpeedExtension (inject.js)
 * Testing the fix for video elements without parentElement
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert, createMockVideo, createMockDOM } from '../../helpers/test-utils.js';
import { loadInjectModules } from '../../helpers/module-loader.js';

// Load all required modules
await loadInjectModules();

const runner = new SimpleTestRunner();
let mockDOM;
let extension;

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
  if (extension) {
    extension = null;
  }
});

/**
 * Create a video element without parentElement but with parentNode
 * This simulates shadow DOM scenarios where parentElement is undefined
 */
function createVideoWithoutParentElement() {
  const video = createMockVideo();
  const parentNode = document.createElement('div');

  // Simulate shadow DOM scenario where parentElement is undefined
  Object.defineProperty(video, 'parentElement', {
    value: null,
    writable: false,
    configurable: true
  });

  Object.defineProperty(video, 'parentNode', {
    value: parentNode,
    writable: false,
    configurable: true
  });

  return { video, parentNode };
}

runner.test('scanExistingMedia should handle video elements without parentElement', async () => {
  // Create extension instance
  extension = new window.VideoSpeedExtension();
  await extension.initialize();

  // Create a video element without parentElement but with parentNode
  const { video, parentNode } = createVideoWithoutParentElement();

  // Add video to document so mediaObserver can find it
  document.body.appendChild(video);

  // Mock the mediaObserver.scanAll to return our test video
  const originalScanAll = extension.mediaObserver.scanAll;
  extension.mediaObserver.scanAll = () => [video];

  try {
    // This should not throw an error even though parentElement is null
    extension.scanExistingMedia(document);

    // Verify that the video controller was attached
    assert.exists(video.vsc, 'Video controller should be attached to the video element');
    assert.true(video.vsc instanceof window.VSC.VideoController, 'Should create VideoController instance');

    // Verify that the controller was initialized with the correct parent (parentNode fallback)
    // The VideoController should have received parentNode as the parent parameter
    assert.equal(video.vsc.parent, parentNode, 'VideoController should use parentNode when parentElement is null');

  } catch (error) {
    assert.true(false, `scanExistingMedia should not throw error: ${error.message}`);
  } finally {
    // Restore original method
    extension.mediaObserver.scanAll = originalScanAll;
    // Clean up
    document.body.removeChild(video);
  }
});

runner.test('scanExistingMedia should prefer parentElement when available', async () => {
  // Create extension instance
  extension = new window.VideoSpeedExtension();
  await extension.initialize();

  // Create a normal video element with both parentElement and parentNode
  const video = createMockVideo();
  const parentElement = document.createElement('div');
  const parentNode = document.createElement('span'); // Different from parentElement

  Object.defineProperty(video, 'parentElement', {
    value: parentElement,
    writable: false,
    configurable: true
  });

  Object.defineProperty(video, 'parentNode', {
    value: parentNode,
    writable: false,
    configurable: true
  });

  // Add video to document
  document.body.appendChild(video);

  // Mock the mediaObserver.scanAll to return our test video
  const originalScanAll = extension.mediaObserver.scanAll;
  extension.mediaObserver.scanAll = () => [video];

  try {
    extension.scanExistingMedia(document);

    // Verify that the video controller was attached
    assert.exists(video.vsc, 'Video controller should be attached to the video element');

    // Verify that the controller was initialized with parentElement (not parentNode)
    assert.equal(video.vsc.parent, parentElement, 'VideoController should prefer parentElement when available');

  } finally {
    // Restore original method
    extension.mediaObserver.scanAll = originalScanAll;
    // Clean up
    document.body.removeChild(video);
  }
});

runner.test('scanExistingMedia should not throw error with video having neither parentElement nor parentNode', async () => {
  // Create extension instance
  extension = new window.VideoSpeedExtension();
  await extension.initialize();

  // Create a video element without either parent
  const video = createMockVideo();

  Object.defineProperty(video, 'parentElement', {
    value: null,
    writable: false,
    configurable: true
  });

  Object.defineProperty(video, 'parentNode', {
    value: null,
    writable: false,
    configurable: true
  });

  // Mock the mediaObserver.scanAll to return our test video
  const originalScanAll = extension.mediaObserver.scanAll;
  extension.mediaObserver.scanAll = () => [video];

  try {
    // This should not throw an error even though both parents are null
    // The controller may or may not be attached, but it shouldn't crash
    extension.scanExistingMedia(document);

    // Test passes if no exception is thrown
    assert.true(true, 'scanExistingMedia should not throw error when video has no parent');

  } catch (error) {
    assert.true(false, `scanExistingMedia should not throw error: ${error.message}`);
  } finally {
    // Restore original method
    extension.mediaObserver.scanAll = originalScanAll;
  }
});

// Export for test runner
export { runner }; 