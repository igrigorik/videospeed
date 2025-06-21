/**
 * Unit tests for ActionHandler class
 * Using global variables to match browser extension architecture
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert, createMockVideo, createMockDOM } from '../../helpers/test-utils.js';

// Load modules by executing them to populate global variables
import '../../../src/utils/constants.js';
import '../../../src/utils/logger.js';
import '../../../src/utils/dom-utils.js';
import '../../../src/utils/event-manager.js';
import '../../../src/core/storage-manager.js';
import '../../../src/core/settings.js';
import '../../../src/site-handlers/base-handler.js';
import '../../../src/site-handlers/netflix-handler.js';
import '../../../src/site-handlers/youtube-handler.js';
import '../../../src/site-handlers/facebook-handler.js';
import '../../../src/site-handlers/amazon-handler.js';
import '../../../src/site-handlers/apple-handler.js';
import '../../../src/site-handlers/index.js';
import '../../../src/core/action-handler.js';

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

runner.test('ActionHandler should set video speed', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  
  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);
  
  const mockVideo = createMockVideo();
  mockVideo.vsc = { speedIndicator: { textContent: '1.00' } };
  config.addMediaElement(mockVideo);
  
  actionHandler.setSpeed(mockVideo, 2.0);
  
  assert.equal(mockVideo.playbackRate, 2.0);
  assert.equal(mockVideo.vsc.speedIndicator.textContent, '2.00');
  assert.equal(config.settings.lastSpeed, 2.0);
});

runner.test('ActionHandler should handle faster action', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  
  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);
  
  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  mockVideo.vsc = { 
    div: mockDOM.container,
    speedIndicator: { textContent: '1.00' }
  };
  config.addMediaElement(mockVideo);
  
  actionHandler.runAction('faster', 0.1);
  
  assert.equal(mockVideo.playbackRate, 1.1);
});

runner.test('ActionHandler should handle slower action', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  
  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);
  
  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  mockVideo.vsc = { 
    div: mockDOM.container,
    speedIndicator: { textContent: '1.00' }
  };
  config.addMediaElement(mockVideo);
  
  actionHandler.runAction('slower', 0.1);
  
  assert.equal(mockVideo.playbackRate, 0.9);
});

runner.test('ActionHandler should respect speed limits', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  
  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);
  
  const mockVideo = createMockVideo({ playbackRate: 16.0 });
  mockVideo.vsc = { 
    div: mockDOM.container,
    speedIndicator: { textContent: '16.00' }
  };
  config.addMediaElement(mockVideo);
  
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
  
  const mockVideo = createMockVideo({ paused: false });
  mockVideo.vsc = { div: mockDOM.container };
  config.addMediaElement(mockVideo);
  
  actionHandler.runAction('pause');
  
  assert.true(mockVideo.paused);
});

runner.test('ActionHandler should handle mute action', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  
  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);
  
  const mockVideo = createMockVideo({ muted: false });
  mockVideo.vsc = { div: mockDOM.container };
  config.addMediaElement(mockVideo);
  
  actionHandler.runAction('muted');
  
  assert.true(mockVideo.muted);
});

runner.test('ActionHandler should handle volume actions', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  
  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);
  
  const mockVideo = createMockVideo({ volume: 0.5 });
  mockVideo.vsc = { div: mockDOM.container };
  config.addMediaElement(mockVideo);
  
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
  
  const mockVideo = createMockVideo({ currentTime: 50 });
  mockVideo.vsc = { div: mockDOM.container };
  config.addMediaElement(mockVideo);
  
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
  
  const mockVideo = createMockVideo({ currentTime: 30 });
  mockVideo.vsc = { div: mockDOM.container };
  config.addMediaElement(mockVideo);
  
  // Set mark
  actionHandler.runAction('mark');
  assert.equal(mockVideo.vsc.mark, 30);
  
  // Change time
  mockVideo.currentTime = 50;
  
  // Jump to mark
  actionHandler.runAction('jump');
  assert.equal(mockVideo.currentTime, 30);
});

// Run tests if this file is loaded directly
if (typeof window !== 'undefined' && window.location) {
  runner.run().then(results => {
    console.log('ActionHandler tests completed:', results);
  });
}

export { runner as actionHandlerTestRunner };