/**
 * Unit tests for recursive shadow DOM media element detection
 * Tests the findShadowMedia functionality in dom-utils.js and MediaElementObserver
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

  // Clean up any existing elements in document.body
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

runner.afterEach(() => {
  cleanupChromeMock();
  if (mockDOM) {
    mockDOM.cleanup();
  }

  // Clean up any remaining elements in document.body
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

/**
 * Helper function to create nested shadow DOM structure
 * @param {number} depth - Depth of nesting
 * @param {boolean} includeVideo - Whether to include video in the deepest level
 * @returns {Object} {host, deepestShadow, video}
 */
function createNestedShadowDOM(depth, includeVideo = true) {
  const host = document.createElement('div');
  host.className = 'shadow-host-root';

  let currentHost = host;
  let currentShadow = null;

  // Create nested shadow roots
  for (let i = 0; i < depth; i++) {
    currentShadow = currentHost.attachShadow({ mode: 'open' });

    if (i < depth - 1) {
      // Create another host for the next level
      const nextHost = document.createElement('div');
      nextHost.className = `shadow-host-level-${i + 1}`;
      currentShadow.appendChild(nextHost);
      currentHost = nextHost;
    }
  }

  let video = null;
  if (includeVideo && currentShadow) {
    video = createMockVideo();
    video.className = 'nested-shadow-video';
    currentShadow.appendChild(video);
  }

  return { host, deepestShadow: currentShadow, video };
}

/**
 * Helper function to create complex nested player structure
 * Simulates real-world custom elements with nested shadow roots
 * @returns {Object} {player, video}
 */
function createComplexPlayerStructure() {
  // Create custom player element
  const player = document.createElement('custom-player');
  const playerShadow = player.attachShadow({ mode: 'open' });

  // Create nested playback element inside player shadow
  const playback = document.createElement('video-playback');
  const playbackShadow = playback.attachShadow({ mode: 'open' });
  playerShadow.appendChild(playback);

  // Create video element inside nested shadow
  const video = createMockVideo();
  playbackShadow.appendChild(video);

  return { player, video };
}

runner.test('DomUtils.findShadowMedia should recursively find media in single shadow root', () => {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const video = createMockVideo();
  shadow.appendChild(video);

  const results = window.VSC.DomUtils.findShadowMedia(shadow, 'video');

  assert.equal(results.length, 1);
  assert.equal(results[0], video);
});

runner.test('DomUtils.findShadowMedia should recursively find media in nested shadow roots', () => {
  const { host, video } = createNestedShadowDOM(3);

  // Search from the host element instead of the whole document
  const results = window.VSC.DomUtils.findShadowMedia(host, 'video');

  assert.equal(results.length, 1);
  assert.equal(results[0], video);
  assert.equal(results[0].className, 'nested-shadow-video');
});

runner.test('DomUtils.findShadowMedia should find multiple videos across different shadow roots', () => {
  // Create container for this test
  const container = document.createElement('div');

  // Create first nested structure
  const { host: host1, video: video1 } = createNestedShadowDOM(2);
  video1.id = 'video-1';

  // Create second nested structure
  const { host: host2, video: video2 } = createNestedShadowDOM(3);
  video2.id = 'video-2';

  // Create a regular video for comparison
  const regularVideo = createMockVideo();
  regularVideo.id = 'regular-video';

  container.appendChild(host1);
  container.appendChild(host2);
  container.appendChild(regularVideo);

  const results = window.VSC.DomUtils.findShadowMedia(container, 'video');

  assert.equal(results.length, 3);

  const videoIds = results.map(v => v.id).sort();
  assert.deepEqual(videoIds, ['regular-video', 'video-1', 'video-2']);
});

runner.test('DomUtils.findShadowMedia should handle deeply nested shadow roots (5 levels)', () => {
  const { host, video } = createNestedShadowDOM(5);

  const results = window.VSC.DomUtils.findShadowMedia(host, 'video');

  assert.equal(results.length, 1);
  assert.equal(results[0], video);
});

runner.test('DomUtils.findShadowMedia should work with audio elements when enabled', () => {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });

  const video = createMockVideo();
  const audio = document.createElement('audio');
  audio.className = 'test-audio';

  shadow.appendChild(video);
  shadow.appendChild(audio);

  const videoResults = window.VSC.DomUtils.findShadowMedia(shadow, 'video');
  const audioVideoResults = window.VSC.DomUtils.findShadowMedia(shadow, 'video,audio');

  assert.equal(videoResults.length, 1);
  assert.equal(audioVideoResults.length, 2);
  assert.equal(audioVideoResults[1].className, 'test-audio');
});

runner.test('DomUtils.findMediaElements should use recursive shadow search', () => {
  const { host, video } = createNestedShadowDOM(3);

  const results = window.VSC.DomUtils.findMediaElements(host, false);

  assert.equal(results.length, 1);
  assert.equal(results[0], video);
});

runner.test('MediaElementObserver should find media in nested shadow roots', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const siteHandler = new window.VSC.BaseSiteHandler();
  const observer = new window.VSC.MediaElementObserver(config, siteHandler);

  // Create an isolated document for this test
  const testContainer = document.createElement('div');
  const { host, video } = createNestedShadowDOM(3);
  testContainer.appendChild(host);
  document.body.appendChild(testContainer);

  const results = observer.scanForMedia(testContainer);

  assert.equal(results.length, 1);
  assert.equal(results[0], video);
});

runner.test('Should handle complex nested player structure', () => {
  const { player, video } = createComplexPlayerStructure();

  const results = window.VSC.DomUtils.findShadowMedia(player, 'video');

  assert.equal(results.length, 1);
  assert.equal(results[0], video);
});

runner.test('Should handle complex player structure with MediaElementObserver', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const siteHandler = new window.VSC.BaseSiteHandler();
  const observer = new window.VSC.MediaElementObserver(config, siteHandler);

  const testContainer = document.createElement('div');
  const { player, video } = createComplexPlayerStructure();
  testContainer.appendChild(player);
  document.body.appendChild(testContainer);

  const results = observer.scanForMedia(testContainer);

  assert.equal(results.length, 1);
  assert.equal(results[0], video);
});

runner.test('Should handle empty shadow roots gracefully', () => {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  // Empty shadow root

  const results = window.VSC.DomUtils.findShadowMedia(shadow, 'video');

  assert.equal(results.length, 0);
});

runner.test('Should handle shadow roots with no video elements', () => {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });

  // Add non-video elements
  const div = document.createElement('div');
  const span = document.createElement('span');
  shadow.appendChild(div);
  shadow.appendChild(span);

  const results = window.VSC.DomUtils.findShadowMedia(shadow, 'video');

  assert.equal(results.length, 0);
});

runner.test('Should handle mixed regular and shadow DOM content', () => {
  const container = document.createElement('div');

  // Regular video
  const regularVideo = createMockVideo();
  regularVideo.id = 'regular';
  container.appendChild(regularVideo);

  // Shadow video
  const { host, video: shadowVideo } = createNestedShadowDOM(2);
  shadowVideo.id = 'shadow';
  container.appendChild(host);

  const results = window.VSC.DomUtils.findShadowMedia(container, 'video');

  assert.equal(results.length, 2);
  const ids = results.map(v => v.id).sort();
  assert.deepEqual(ids, ['regular', 'shadow']);
});

runner.test('Should handle complex nested structure with multiple videos per level', () => {
  const host = document.createElement('div');
  const level1Shadow = host.attachShadow({ mode: 'open' });

  // Video at level 1
  const video1 = createMockVideo();
  video1.id = 'level-1';
  level1Shadow.appendChild(video1);

  // Nested host for level 2
  const level2Host = document.createElement('div');
  level1Shadow.appendChild(level2Host);
  const level2Shadow = level2Host.attachShadow({ mode: 'open' });

  // Multiple videos at level 2
  const video2a = createMockVideo();
  video2a.id = 'level-2a';
  const video2b = createMockVideo();
  video2b.id = 'level-2b';
  level2Shadow.appendChild(video2a);
  level2Shadow.appendChild(video2b);

  const results = window.VSC.DomUtils.findShadowMedia(host, 'video');

  assert.equal(results.length, 3);
  const ids = results.map(v => v.id).sort();
  assert.deepEqual(ids, ['level-1', 'level-2a', 'level-2b']);
});

runner.test('Performance test - should handle many nested shadow roots efficiently', () => {
  const container = document.createElement('div');
  const startTime = performance.now();

  // Create 10 different nested structures
  for (let i = 0; i < 10; i++) {
    const { host } = createNestedShadowDOM(4);
    container.appendChild(host);
  }

  const results = window.VSC.DomUtils.findShadowMedia(container, 'video');

  const endTime = performance.now();
  const duration = endTime - startTime;

  assert.equal(results.length, 10);
  assert.true(duration < 100, `Search took ${duration}ms, should be under 100ms`);
});

// Run tests if this file is loaded directly
if (typeof window !== 'undefined' && window.location) {
  runner.run().then(results => {
    console.log('Recursive shadow DOM tests completed:', results);
  });
}

export { runner as recursiveShadowDOMTestRunner }; 