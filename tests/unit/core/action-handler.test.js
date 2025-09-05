/**
 * Unit tests for ActionHandler class
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

/**
 * Helper function to create a test video with a controller
 * This replaces the old pattern of config.addMediaElement()
 */
function createTestVideoWithController(config, actionHandler, videoOptions = {}) {
  const mockVideo = createMockVideo(videoOptions);

  // Ensure the video has a proper parent element for DOM operations
  if (!mockVideo.parentElement) {
    const parentDiv = document.createElement('div');
    document.body.appendChild(parentDiv);
    parentDiv.appendChild(mockVideo);
  }

  // Store initial playback rate to preserve test expectations
  const initialPlaybackRate = mockVideo.playbackRate;

  // Create a proper VideoController for this video
  const controller = new window.VSC.VideoController(mockVideo, mockVideo.parentElement, config, actionHandler);

  // Restore initial playback rate for test consistency
  mockVideo.playbackRate = initialPlaybackRate;

  return mockVideo;
}

runner.afterEach(() => {
  cleanupChromeMock();
  if (mockDOM) {
    mockDOM.cleanup();
  }
});

runner.test('ActionHandler should set video speed', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.rememberSpeed = true; // Enable persistence for this test

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createTestVideoWithController(config, actionHandler);

  actionHandler.adjustSpeed(mockVideo, 2.0);

  assert.equal(mockVideo.playbackRate, 2.0);
  assert.equal(mockVideo.vsc.speedIndicator.textContent, '2.00');
  assert.equal(config.settings.lastSpeed, 2.0);
});

runner.test('ActionHandler should handle faster action', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

  actionHandler.runAction('faster', 0.1);

  assert.equal(mockVideo.playbackRate, 1.1);
});

runner.test('ActionHandler should handle slower action', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

  actionHandler.runAction('slower', 0.1);
  assert.equal(mockVideo.playbackRate, 0.9);
});

runner.test('ActionHandler should respect speed limits', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createTestVideoWithController(config, actionHandler, { playbackRate: 16.0 });

  // Should not exceed maximum speed
  actionHandler.runAction('faster', 1.0);
  assert.equal(mockVideo.playbackRate, 16.0);

  // Test minimum speed
  mockVideo.playbackRate = 0.07;
  actionHandler.runAction('slower', 0.1);
  assert.equal(mockVideo.playbackRate, 0.07);
});

runner.test('ActionHandler should handle pause action', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createTestVideoWithController(config, actionHandler, { paused: false });

  actionHandler.runAction('pause');
  assert.true(mockVideo.paused);
});

runner.test('ActionHandler should handle mute action', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createTestVideoWithController(config, actionHandler, { muted: false });
  actionHandler.runAction('muted');

  assert.true(mockVideo.muted);
});

runner.test('ActionHandler should handle volume actions', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createTestVideoWithController(config, actionHandler, { volume: 0.5 });
  actionHandler.runAction('louder', 0.1);
  assert.equal(mockVideo.volume, 0.6);

  actionHandler.runAction('softer', 0.2);
  assert.equal(mockVideo.volume, 0.4);
});

runner.test('ActionHandler should handle seek actions', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createTestVideoWithController(config, actionHandler, { currentTime: 50 });

  actionHandler.runAction('advance', 10);
  assert.equal(mockVideo.currentTime, 60);

  actionHandler.runAction('rewind', 5);
  assert.equal(mockVideo.currentTime, 55);
});

runner.test('ActionHandler should handle mark and jump actions', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createTestVideoWithController(config, actionHandler, { currentTime: 30 });

  // Set mark
  actionHandler.runAction('mark');
  assert.equal(mockVideo.vsc.mark, 30);

  // Change time
  mockVideo.currentTime = 50;

  // Jump to mark
  actionHandler.runAction('jump');
  assert.equal(mockVideo.currentTime, 30);
});

runner.test('ActionHandler should work with mark/jump key bindings', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);
  actionHandler.eventManager = eventManager;

  const mockVideo = createTestVideoWithController(config, actionHandler, { currentTime: 25 });
  // Set initial mark to undefined for test
  mockVideo.vsc.mark = undefined;

  // Verify mark key binding exists (M = 77)
  const markBinding = config.settings.keyBindings.find(kb => kb.action === 'mark');
  assert.exists(markBinding, 'Mark key binding should exist');
  assert.equal(markBinding.key, 77, 'Mark should be bound to M key (77)');

  // Verify jump key binding exists (J = 74)
  const jumpBinding = config.settings.keyBindings.find(kb => kb.action === 'jump');
  assert.exists(jumpBinding, 'Jump key binding should exist');
  assert.equal(jumpBinding.key, 74, 'Jump should be bound to J key (74)');

  // Simulate pressing M key to set mark
  eventManager.handleKeydown({
    keyCode: 77,
    target: document.body,
    getModifierState: () => false,
    preventDefault: () => { },
    stopPropagation: () => { }
  });
  assert.equal(mockVideo.vsc.mark, 25, 'Mark should be set at current time');

  // Change video time
  mockVideo.currentTime = 60;

  // Simulate pressing J key to jump to mark
  eventManager.handleKeydown({
    keyCode: 74,
    target: document.body,
    getModifierState: () => false,
    preventDefault: () => { },
    stopPropagation: () => { }
  });
  assert.equal(mockVideo.currentTime, 25, 'Should jump back to marked time');
});

runner.test('ActionHandler should toggle display visibility', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const video = createTestVideoWithController(config, actionHandler);
  const controller = video.vsc.div;

  // Initially controller should not be hidden
  assert.false(controller.classList.contains('vsc-hidden'));
  assert.false(controller.classList.contains('vsc-manual'));

  // First toggle - should hide
  actionHandler.runAction('display', null, null);
  assert.true(controller.classList.contains('vsc-hidden'));
  assert.true(controller.classList.contains('vsc-manual'));

  // Second toggle - should show
  actionHandler.runAction('display', null, null);
  assert.false(controller.classList.contains('vsc-hidden'));
  assert.true(controller.classList.contains('vsc-manual'));

  // Third toggle - should hide again
  actionHandler.runAction('display', null, null);
  assert.true(controller.classList.contains('vsc-hidden'));
  assert.true(controller.classList.contains('vsc-manual'));
});

runner.test('ActionHandler should work with videos in nested shadow DOM', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  // Create nested shadow DOM structure
  const host = document.createElement('div');
  const level1Shadow = host.attachShadow({ mode: 'open' });

  const nestedHost = document.createElement('div');
  level1Shadow.appendChild(nestedHost);
  const level2Shadow = nestedHost.attachShadow({ mode: 'open' });

  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  level2Shadow.appendChild(mockVideo);

  document.body.appendChild(host);

  // Create a proper mock speedIndicator that behaves like a real DOM element
  const mockSpeedIndicator = {
    textContent: '1.00',
    // Add other properties that might be needed
    nodeType: 1,
    tagName: 'SPAN'
  };

  // Mock video controller structure for shadow DOM video
  mockVideo.vsc = {
    div: mockDOM.container,
    speedIndicator: mockSpeedIndicator,
    // Add remove method to prevent errors during cleanup
    remove: () => { }
  };

  // Register with state manager for runAction to find it
  window.VSC.stateManager.controllers.set('shadow-dom-test', {
    id: 'shadow-dom-test',
    element: mockVideo,
    videoSrc: mockVideo.currentSrc || 'test-video',
    tagName: 'VIDEO',
    created: Date.now(),
    isActive: true
  });

  // Test speed change on shadow DOM video
  actionHandler.runAction('faster', 0.2);
  assert.equal(mockVideo.playbackRate, 1.2);

  // Test slower action
  actionHandler.runAction('slower', 0.1);
  assert.equal(mockVideo.playbackRate, 1.1);

  // Test direct speed setting
  actionHandler.adjustSpeed(mockVideo, 2.5);
  assert.equal(mockVideo.playbackRate, 2.5);
  assert.equal(mockVideo.vsc.speedIndicator.textContent, '2.50');
});

runner.test('adjustSpeed should handle absolute speed changes', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.rememberSpeed = true; // Enable persistence for this test

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  mockVideo.vsc = {
    div: mockDOM.container,
    speedIndicator: { textContent: '1.00' }
  };

  // Test absolute speed change
  actionHandler.adjustSpeed(mockVideo, 1.5);
  assert.equal(mockVideo.playbackRate, 1.5);
  assert.equal(mockVideo.vsc.speedIndicator.textContent, '1.50');
  assert.equal(config.settings.lastSpeed, 1.5);

  // Test speed limits
  actionHandler.adjustSpeed(mockVideo, 20); // Above max
  assert.equal(mockVideo.playbackRate, 16); // Clamped to max

  actionHandler.adjustSpeed(mockVideo, 0.01); // Below min
  assert.equal(mockVideo.playbackRate, 0.07); // Clamped to min
});

runner.test('adjustSpeed should handle relative speed changes', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  mockVideo.vsc = {
    div: mockDOM.container,
    speedIndicator: { textContent: '1.00' }
  };

  // Test relative speed increase
  actionHandler.adjustSpeed(mockVideo, 0.5, { relative: true });
  assert.equal(mockVideo.playbackRate, 1.5);

  // Test relative speed decrease
  actionHandler.adjustSpeed(mockVideo, -0.3, { relative: true });
  assert.equal(mockVideo.playbackRate, 1.2);

  // Test relative with limits
  mockVideo.playbackRate = 15.9;
  actionHandler.adjustSpeed(mockVideo, 0.5, { relative: true });
  assert.equal(mockVideo.playbackRate, 16); // Clamped to max
});

runner.test('adjustSpeed should handle external changes with force mode', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  // Reset config state for clean test
  config.settings.rememberSpeed = false;

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  mockVideo.vsc = {
    div: mockDOM.container,
    speedIndicator: { textContent: '1.00' }
  };

  // Set initial user preference
  config.settings.lastSpeed = 1.5;
  config.settings.forceLastSavedSpeed = true;
  config.settings.rememberSpeed = true; // Global mode for force test

  // External change should be rejected in force mode
  actionHandler.adjustSpeed(mockVideo, 2.0, { source: 'external' });
  assert.equal(mockVideo.playbackRate, 1.5); // Restored to user preference

  // Internal change should be allowed
  actionHandler.adjustSpeed(mockVideo, 2.0, { source: 'internal' });
  assert.equal(mockVideo.playbackRate, 2.0);
});

runner.test('getPreferredSpeed should return global lastSpeed', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo({
    playbackRate: 1.0,
    currentSrc: 'https://example.com/video1.mp4'
  });

  // Test with set lastSpeed
  config.settings.lastSpeed = 1.75;
  assert.equal(actionHandler.getPreferredSpeed(mockVideo), 1.75);

  // Test fallback when no lastSpeed
  config.settings.lastSpeed = null;
  assert.equal(actionHandler.getPreferredSpeed(mockVideo), 1.0);

  // Different video should return same global speed
  const mockVideo2 = createMockVideo({
    currentSrc: 'https://example.com/video2.mp4'
  });
  config.settings.lastSpeed = 2.5;
  assert.equal(actionHandler.getPreferredSpeed(mockVideo2), 2.5);
});

runner.test('adjustSpeed should validate input properly', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  // Test with null video
  actionHandler.adjustSpeed(null, 1.5);
  // Should not throw, just log warning

  // Test with video without controller
  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  delete mockVideo.vsc;
  const initialSpeed = mockVideo.playbackRate;
  actionHandler.adjustSpeed(mockVideo, 1.5);
  assert.equal(mockVideo.playbackRate, initialSpeed); // Should not change

  // Test with invalid value types
  const validVideo = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

  // String value
  actionHandler.adjustSpeed(validVideo, "1.5");
  assert.equal(validVideo.playbackRate, 1.0); // Should not change

  // null value
  actionHandler.adjustSpeed(validVideo, null);
  assert.equal(validVideo.playbackRate, 1.0); // Should not change

  // undefined value
  actionHandler.adjustSpeed(validVideo, undefined);
  assert.equal(validVideo.playbackRate, 1.0); // Should not change

  // NaN value
  actionHandler.adjustSpeed(validVideo, NaN);
  assert.equal(validVideo.playbackRate, 1.0); // Should not change
});

runner.test('setSpeed should save global speed to storage', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.rememberSpeed = true; // Enable persistence for this test

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo({
    playbackRate: 1.0,
    currentSrc: 'https://example.com/video.mp4'
  });
  mockVideo.vsc = {
    div: mockDOM.container,
    speedIndicator: { textContent: '1.00' }
  };

  // Track what gets saved
  let savedData = null;
  config.save = (data) => {
    savedData = data;
  };

  // Test that only lastSpeed is saved
  actionHandler.setSpeed(mockVideo, 1.5, 'internal');

  assert.equal(savedData.lastSpeed, 1.5);
  assert.equal(config.settings.lastSpeed, 1.5); // Global speed updated
});

runner.test('do not persist video speed to storage', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.rememberSpeed = false;
  config.settings.forceLastSavedSpeed = false;

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  // Create two different videos with controllers
  const video1 = createTestVideoWithController(config, actionHandler, { currentSrc: 'https://example.com/video1.mp4' });
  const video2 = createTestVideoWithController(config, actionHandler, { currentSrc: 'https://example.com/video2.mp4' });

  // Track saves to verify behavior
  const savedCalls = [];
  const originalSave = config.save;
  config.save = (data) => {
    savedCalls.push({ ...data });
    return originalSave.call(config, data);
  };

  // Change speeds on different videos
  await actionHandler.adjustSpeed(video1, 1.5);
  await actionHandler.adjustSpeed(video2, 2.0);

  // With rememberSpeed = false, no speeds should be persisted to storage
  assert.equal(savedCalls.length, 0, 'No saves should occur when rememberSpeed is false');
  
  // Videos should still have their playback rates set
  assert.equal(video1.playbackRate, 1.5);
  assert.equal(video2.playbackRate, 2.0);
});

runner.test('rememberSpeed: true should only store global speed', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.rememberSpeed = true;
  config.settings.forceLastSavedSpeed = false;

  // Clear any existing speeds from previous tests

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const video1 = createTestVideoWithController(config, actionHandler, { currentSrc: 'https://example.com/video1.mp4' });
  const video2 = createTestVideoWithController(config, actionHandler, { currentSrc: 'https://example.com/video2.mp4' });

  // Change speeds on different videos
  await actionHandler.adjustSpeed(video1, 1.5);
  await actionHandler.adjustSpeed(video2, 2.0);


  // Global lastSpeed should be updated
  assert.equal(config.settings.lastSpeed, 2.0);
});

runner.test('speed limits should be enforced correctly', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

  // Test minimum speed limit
  await actionHandler.adjustSpeed(video, 0.01); // Below minimum
  assert.equal(video.playbackRate, 0.07); // Should clamp to minimum

  // Test maximum speed limit
  await actionHandler.adjustSpeed(video, 20.0); // Above maximum
  assert.equal(video.playbackRate, 16.0); // Should clamp to maximum

  // Test negative speed (should clamp to minimum)
  await actionHandler.adjustSpeed(video, -1.0);
  assert.equal(video.playbackRate, 0.07);
});

// COMPREHENSIVE PHASE 6 TESTS
runner.test('adjustSpeed should handle complex relative mode scenarios', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const video = createTestVideoWithController(config, actionHandler, { playbackRate: 2.0 });

  // Test relative from various starting points
  actionHandler.adjustSpeed(video, 0.25, { relative: true });
  assert.equal(video.playbackRate, 2.25);

  // Test relative with float precision
  actionHandler.adjustSpeed(video, 0.33, { relative: true });
  assert.equal(video.playbackRate, 2.58); // Should be rounded to 2 decimals

  // Test relative from very low speed
  video.playbackRate = 0.05; // Below 0.1 threshold
  actionHandler.adjustSpeed(video, 0.1, { relative: true });
  assert.equal(video.playbackRate, 0.10); // Should use 0.0 as base for very low speeds

  // Test large relative changes
  video.playbackRate = 1.0;
  actionHandler.adjustSpeed(video, 5.0, { relative: true });
  assert.equal(video.playbackRate, 6.0);
});

runner.test('adjustSpeed should handle multiple source types comprehensively', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.rememberSpeed = true;
  config.settings.lastSpeed = 1.25;

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

  // Test default source (should be 'internal')
  actionHandler.adjustSpeed(video, 1.5);
  assert.equal(video.playbackRate, 1.5);

  // Test explicit internal source
  actionHandler.adjustSpeed(video, 1.8, { source: 'internal' });
  assert.equal(video.playbackRate, 1.8);

  // Test external source without force mode
  config.settings.forceLastSavedSpeed = false;
  actionHandler.adjustSpeed(video, 2.5, { source: 'external' });
  assert.equal(video.playbackRate, 2.5);

  // Test external source with force mode enabled
  config.settings.forceLastSavedSpeed = true;
  actionHandler.adjustSpeed(video, 3.0, { source: 'external' });
  assert.equal(video.playbackRate, 2.5); // Should be blocked and restored to last internal change
});

runner.test('adjustSpeed should work correctly with multiple videos', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.rememberSpeed = true; // Enable persistence for this test

  const actionHandler = new window.VSC.ActionHandler(config, null);

  // Create multiple videos with different sources
  const video1 = createTestVideoWithController(config, actionHandler, { currentSrc: 'https://site1.com/video1.mp4' });
  const video2 = createTestVideoWithController(config, actionHandler, { currentSrc: 'https://site2.com/video2.mp4' });
  const video3 = createTestVideoWithController(config, actionHandler, { currentSrc: 'https://site1.com/video3.mp4' });

  // Set different speeds for each video
  actionHandler.adjustSpeed(video1, 1.5);
  actionHandler.adjustSpeed(video2, 2.0);
  actionHandler.adjustSpeed(video3, 1.25);

  // Verify each video has correct speed
  assert.equal(video1.playbackRate, 1.5);
  assert.equal(video2.playbackRate, 2.0);
  assert.equal(video3.playbackRate, 1.25);


  // Verify global speed behavior - all videos share same preferred speed
  assert.equal(actionHandler.getPreferredSpeed(video1), 1.25);
  assert.equal(actionHandler.getPreferredSpeed(video2), 1.25);
  assert.equal(actionHandler.getPreferredSpeed(video3), 1.25);
});

runner.test('adjustSpeed should handle global mode with multiple videos', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.rememberSpeed = true; // Global mode

  const actionHandler = new window.VSC.ActionHandler(config, null);

  const video1 = createTestVideoWithController(config, actionHandler, { currentSrc: 'https://site1.com/video1.mp4' });
  const video2 = createTestVideoWithController(config, actionHandler, { currentSrc: 'https://site2.com/video2.mp4' });

  // Change speed on first video
  actionHandler.adjustSpeed(video1, 1.8);
  assert.equal(config.settings.lastSpeed, 1.8);

  // getPreferredSpeed should return global speed for both videos
  assert.equal(actionHandler.getPreferredSpeed(video1), 1.8);
  assert.equal(actionHandler.getPreferredSpeed(video2), 1.8);

  // Change speed on second video
  actionHandler.adjustSpeed(video2, 2.2);
  assert.equal(config.settings.lastSpeed, 2.2);

  // Both videos should now prefer the new global speed
  assert.equal(actionHandler.getPreferredSpeed(video1), 2.2);
  assert.equal(actionHandler.getPreferredSpeed(video2), 2.2);
});

runner.test('adjustSpeed should handle edge cases and error conditions', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);

  // Test with video missing vsc property
  const videoNoVsc = createMockVideo({ playbackRate: 1.0 });
  actionHandler.adjustSpeed(videoNoVsc, 1.5); // Should not crash, just warn

  // Test with video missing speedIndicator
  const videoNoIndicator = createMockVideo({ playbackRate: 1.0 });
  videoNoIndicator.vsc = {}; // No speedIndicator
  // Manually register with state manager for this edge case test
  window.VSC.stateManager.controllers.set('test-no-indicator', {
    id: 'test-no-indicator',
    element: videoNoIndicator,
    videoSrc: 'test-video',
    tagName: 'VIDEO',
    created: Date.now(),
    isActive: true
  });
  actionHandler.adjustSpeed(videoNoIndicator, 1.5); // Should work but skip UI update
  assert.equal(videoNoIndicator.playbackRate, 1.5);

  // Test with very small incremental changes
  const video = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

  actionHandler.adjustSpeed(video, 0.001, { relative: true });
  assert.equal(video.playbackRate, 1.0); // Should round to 2 decimals (1.00)

  actionHandler.adjustSpeed(video, 0.01, { relative: true });
  assert.equal(video.playbackRate, 1.01); // Should round to 1.01
});

runner.test('adjustSpeed should handle complex force mode scenarios', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.forceLastSavedSpeed = true;
  config.settings.rememberSpeed = false; // Per-video mode
  config.settings.lastSpeed = 1.5;

  const actionHandler = new window.VSC.ActionHandler(config, null);

  const video = createTestVideoWithController(config, actionHandler, { currentSrc: 'https://example.com/video.mp4' });

  // External changes should be blocked and restored to global speed
  actionHandler.adjustSpeed(video, 3.0, { source: 'external' });
  assert.equal(video.playbackRate, 1.5);

  // Internal changes should work normally
  actionHandler.adjustSpeed(video, 1.8, { source: 'internal' });
  assert.equal(video.playbackRate, 1.8);
});

runner.test('reset action should use configured reset speed value', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  // Test with default reset speed (1.0)
  const mockVideo1 = createTestVideoWithController(config, actionHandler, { playbackRate: 2.0 });
  actionHandler.runAction('reset', 1.0); // Pass the value as keyboard handler would
  assert.equal(mockVideo1.playbackRate, 1.0);

  // Test with custom reset speed
  config.setKeyBinding('reset', 1.5);
  const mockVideo2 = createTestVideoWithController(config, actionHandler, { playbackRate: 2.5 });
  actionHandler.runAction('reset', 1.5); // Pass the custom value
  assert.equal(mockVideo2.playbackRate, 1.5);

  // Test reset memory toggle functionality with custom reset speed
  const mockVideo3 = createTestVideoWithController(config, actionHandler, { playbackRate: 1.5 });
  
  // First reset should remember current speed and go to reset speed
  mockVideo3.playbackRate = 2.2;
  actionHandler.runAction('reset', 1.5); // Pass custom value
  assert.equal(mockVideo3.playbackRate, 1.5); // Should reset to configured value
  assert.equal(mockVideo3.vsc.speedBeforeReset, 2.2); // Should remember previous speed

  // Second reset should restore remembered speed
  actionHandler.runAction('reset', 1.5); // Pass custom value
  assert.equal(mockVideo3.playbackRate, 2.2); // Should restore remembered speed
  assert.equal(mockVideo3.vsc.speedBeforeReset, null); // Should clear memory
});

runner.test('lastSpeed should update during session even when rememberSpeed is false', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.rememberSpeed = false; // Disable cross-session persistence
  config.settings.lastSpeed = 1.0; // Start with default speed

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  // Track storage saves
  const savedCalls = [];
  const originalSave = config.save;
  config.save = function(data) {
    savedCalls.push({ ...data });
    return originalSave.call(config, data);
  };

  const video = createTestVideoWithController(config, actionHandler, { currentSrc: 'https://example.com/video.mp4' });
  
  // Change speed to 1.4
  await actionHandler.adjustSpeed(video, 1.4);
  
  // lastSpeed should be updated in memory for session persistence
  assert.equal(config.settings.lastSpeed, 1.4, 'lastSpeed should update in memory even with rememberSpeed=false');
  
  // No storage saves should occur
  assert.equal(savedCalls.length, 0, 'No saves should occur when rememberSpeed is false');
  
  // Simulate play event (which calls getTargetSpeed)
  const targetSpeed = video.vsc.getTargetSpeed(video);
  assert.equal(targetSpeed, 1.4, 'getTargetSpeed should return updated lastSpeed for session persistence');
  
  // Restore original save method
  config.save = originalSave;
});

runner.test('reset action should work with keyboard event simulation', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);
  actionHandler.eventManager = eventManager;

  // Test with custom reset speed via keyboard simulation
  config.setKeyBinding('reset', 1.5);
  const mockVideo = createTestVideoWithController(config, actionHandler, { playbackRate: 2.0 });

  // Simulate pressing R key (82) - this will pass the configured value automatically
  eventManager.handleKeydown({
    keyCode: 82, // R key
    target: document.body,
    getModifierState: () => false,
    preventDefault: () => {},
    stopPropagation: () => {}
  });
  
  assert.equal(mockVideo.playbackRate, 1.5); // Should use configured reset speed
});

export { runner as actionHandlerTestRunner };