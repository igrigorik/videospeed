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

  // Clean up any remaining video elements
  const videos = document.querySelectorAll('video');
  videos.forEach(video => {
    if (video.vsc) {
      try {
        video.vsc.remove();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    if (video.parentNode) {
      try {
        video.parentNode.removeChild(video);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });
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

  // Mock isConnected property for validity check
  Object.defineProperty(video, 'isConnected', {
    value: true,
    writable: false,
    configurable: true
  });

  return { video, parentNode };
}

runner.test('onVideoFound should handle video elements without parentElement', async () => {
  // Create extension instance
  extension = new window.VideoSpeedExtension();

  try {
    await extension.initialize();

    // Create a video element without parentElement but with parentNode
    const { video, parentNode } = createVideoWithoutParentElement();

    // Test the onVideoFound method directly - this is the core functionality
    extension.onVideoFound(video, parentNode);

    // Verify that the video controller was attached
    assert.exists(video.vsc, 'Video controller should be attached to the video element');
    assert.true(video.vsc instanceof window.VSC.VideoController, 'Should create VideoController instance');

    // Verify that the controller was initialized with the correct parent (parentNode fallback)
    assert.equal(video.vsc.parent, parentNode, 'VideoController should use parentNode when parentElement is null');

  } catch (error) {
    console.error('Test error:', error);
    assert.true(false, `Test should not throw error: ${error.message}`);
  }
});

runner.test('onVideoFound should prefer parentElement when available', async () => {
  // Create extension instance
  extension = new window.VideoSpeedExtension();

  try {
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

    // Mock isConnected property for validity check
    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true
    });

    // Test onVideoFound with parentElement available
    extension.onVideoFound(video, parentNode);

    // Verify that the video controller was attached
    assert.exists(video.vsc, 'Video controller should be attached to the video element');

    // Verify that the controller was initialized with video.parentElement (not the passed parent)
    // VideoController constructor uses target.parentElement || parent
    assert.equal(video.vsc.parent, parentElement, 'VideoController should prefer video.parentElement when available');

  } catch (error) {
    assert.true(false, `Test should not throw error: ${error.message}`);
  }
});

runner.test('onVideoFound should handle video with neither parentElement nor parentNode', async () => {
  // Create extension instance
  extension = new window.VideoSpeedExtension();

  try {
    await extension.initialize();

    // Create a video element with no parent references
    const video = createMockVideo();
    const fallbackParent = document.createElement('div');

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

    // Mock isConnected property for validity check
    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true
    });

    // This should not throw an error even with no parent references
    extension.onVideoFound(video, fallbackParent);

    // Verify basic functionality
    assert.exists(video.vsc, 'Video controller should be attached even without parent references');
    assert.equal(video.vsc.parent, fallbackParent, 'VideoController should use provided fallback parent');

  } catch (error) {
    assert.true(false, `Test should not throw error: ${error.message}`);
  }
});

// Run tests if this file is loaded directly
if (typeof window !== 'undefined' && window.location) {
  runner.run().then(results => {
    console.log('Inject tests completed:', results);
  });
}

export { runner as injectTestRunner }; 