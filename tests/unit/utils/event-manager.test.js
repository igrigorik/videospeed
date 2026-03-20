/**
 * Unit tests for EventManager class
 * Tests cooldown behavior to prevent rapid changes
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert, createMockVideo } from '../../helpers/test-utils.js';
import { loadCoreModules } from '../../helpers/module-loader.js';

// Load all required modules
await loadCoreModules();

const runner = new SimpleTestRunner();

runner.beforeEach(() => {
  installChromeMock();
  resetMockStorage();
});

runner.afterEach(() => {
  cleanupChromeMock();
});

runner.test('EventManager should initialize with cooldown disabled', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);

  assert.equal(eventManager.coolDown, false);
});

runner.test('refreshCoolDown should activate cooldown period', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);

  // Cooldown should start as false
  assert.equal(eventManager.coolDown, false);

  // Activate cooldown
  eventManager.refreshCoolDown();

  // Cooldown should now be active (a timeout object)
  assert.true(eventManager.coolDown !== false);
});

runner.test('handleRateChange should block events during cooldown', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);

  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  mockVideo.vsc = { speedIndicator: { textContent: '1.00' } };

  // Create mock event that looks like our synthetic ratechange event
  let eventStopped = false;
  const mockEvent = {
    composedPath: () => [mockVideo],
    target: mockVideo,
    detail: { origin: 'external' }, // Not our own event
    stopImmediatePropagation: () => {
      eventStopped = true;
    }
  };

  // Activate cooldown first
  eventManager.refreshCoolDown();

  // Event should be blocked by cooldown
  eventManager.handleRateChange(mockEvent);
  assert.true(eventStopped);
});

runner.test('cooldown should expire after timeout', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);

  // Activate cooldown
  eventManager.refreshCoolDown();
  assert.true(eventManager.coolDown !== false);

  // Wait for cooldown to expire (COOLDOWN_MS + buffer)
  const waitMs = (window.VSC.EventManager?.COOLDOWN_MS || 50) + 50;
  await new Promise(resolve => setTimeout(resolve, waitMs));

  // Cooldown should be expired
  assert.equal(eventManager.coolDown, false);
});

runner.test('multiple refreshCoolDown calls should reset timer', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);

  // First cooldown activation
  eventManager.refreshCoolDown();
  const firstTimeout = eventManager.coolDown;
  assert.true(firstTimeout !== false);

  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 100));

  // Second cooldown activation should replace the first
  eventManager.refreshCoolDown();
  const secondTimeout = eventManager.coolDown;

  // Should be a different timeout object
  assert.true(secondTimeout !== firstTimeout);
  assert.true(secondTimeout !== false);
});

runner.test('cleanup should clear cooldown', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);

  // Activate cooldown
  eventManager.refreshCoolDown();
  assert.true(eventManager.coolDown !== false);

  // Cleanup should clear the cooldown
  eventManager.cleanup();
  assert.equal(eventManager.coolDown, false);
});

// =============================================================================
// COOLDOWN TIMING RACE TESTS
// =============================================================================

runner.test('cooldown should be active BEFORE playbackRate assignment in setSpeed', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  mockVideo.vsc = {
    div: document.createElement('div'),
    speedIndicator: { textContent: '1.00' }
  };

  // Track whether cooldown was active when playbackRate was set
  let cooldownActiveDuringAssignment = false;
  const originalPlaybackRate = Object.getOwnPropertyDescriptor(mockVideo, 'playbackRate') ||
    { value: mockVideo.playbackRate, writable: true, configurable: true };

  let currentRate = 1.0;
  Object.defineProperty(mockVideo, 'playbackRate', {
    get() { return currentRate; },
    set(v) {
      // Check cooldown state at the moment of assignment
      cooldownActiveDuringAssignment = eventManager.coolDown !== false;
      currentRate = v;
    },
    configurable: true
  });

  actionHandler.setSpeed(mockVideo, 2.0, 'internal');

  assert.true(cooldownActiveDuringAssignment,
    'Cooldown must be active when video.playbackRate is assigned to block native ratechange');
});

runner.test('setSpeed should not cause handleRateChange to process event as external', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  mockVideo.vsc = {
    div: document.createElement('div'),
    speedIndicator: { textContent: '1.00' }
  };

  // Track if adjustSpeed is ever called with source='external' during setSpeed
  let externalAdjustCalled = false;
  const originalAdjust = actionHandler.adjustSpeed.bind(actionHandler);
  actionHandler.adjustSpeed = function(video, value, options = {}) {
    if (options.source === 'external') {
      externalAdjustCalled = true;
    }
    return originalAdjust(video, value, options);
  };

  actionHandler.setSpeed(mockVideo, 2.0, 'internal');

  assert.false(externalAdjustCalled,
    'setSpeed must not trigger external speed handling via ratechange');
});

// =============================================================================
// FORCE MODE / DEAD CODE TESTS
// =============================================================================

runner.test('forceLastSavedSpeed should restore authoritative speed on external ratechange', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.forceLastSavedSpeed = true;
  config.settings.lastSpeed = 1.5;

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);

  const mockVideo = createMockVideo({ playbackRate: 2.0 });
  mockVideo.vsc = { speedIndicator: { textContent: '2.00' } };
  // readyState must be >= 1 to not be filtered out
  Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

  let eventStopped = false;
  const mockEvent = {
    composedPath: () => [mockVideo],
    target: mockVideo,
    detail: null, // External event — no origin marker
    stopImmediatePropagation: () => { eventStopped = true; }
  };

  eventManager.handleRateChange(mockEvent);

  assert.equal(mockVideo.playbackRate, 1.5,
    'Force mode should restore authoritative speed');
  assert.true(eventStopped,
    'Force mode should stop event propagation');
});

runner.test('extension-originated events should be ignored before force mode check', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.forceLastSavedSpeed = true;
  config.settings.lastSpeed = 1.5;

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);

  const mockVideo = createMockVideo({ playbackRate: 2.0 });
  mockVideo.vsc = { speedIndicator: { textContent: '2.00' } };

  let eventStopped = false;
  const mockEvent = {
    composedPath: () => [mockVideo],
    target: mockVideo,
    detail: { origin: 'videoSpeed', speed: '2.00', source: 'internal' },
    stopImmediatePropagation: () => { eventStopped = true; }
  };

  eventManager.handleRateChange(mockEvent);

  // Should return early at the origin check, NOT enter force mode
  assert.equal(mockVideo.playbackRate, 2.0,
    'Extension events should be ignored, not processed by force mode');
  assert.false(eventStopped,
    'Extension events should return without stopping propagation');
});

// =============================================================================
// FIGHT DETECTION TESTS
// =============================================================================

runner.test('should re-apply speed when site resets it (fight back)', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.lastSpeed = 2.0;
  config.settings.forceLastSavedSpeed = false;

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);

  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  mockVideo.vsc = { speedIndicator: { textContent: '1.00' } };
  Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

  let eventStopped = false;
  const mockEvent = {
    composedPath: () => [mockVideo],
    target: mockVideo,
    detail: null,
    stopImmediatePropagation: () => { eventStopped = true; }
  };

  eventManager.handleRateChange(mockEvent);

  assert.equal(mockVideo.playbackRate, 2.0,
    'Should fight back and restore authoritative speed on first reset');
  assert.true(eventStopped,
    'Should stop propagation when fighting back');
});

runner.test('should surrender after MAX_FIGHT_COUNT rapid resets', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.lastSpeed = 2.0;
  config.settings.forceLastSavedSpeed = false;

  let externalAdjustCalled = false;
  const actionHandler = new window.VSC.ActionHandler(config, null);
  actionHandler.adjustSpeed = function(video, value, options = {}) {
    if (options.source === 'external') {
      externalAdjustCalled = true;
    }
  };

  const eventManager = new window.VSC.EventManager(config, actionHandler);

  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  mockVideo.vsc = { speedIndicator: { textContent: '1.00' } };
  Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

  const maxFights = window.VSC.EventManager.MAX_FIGHT_COUNT;

  // Simulate resets — each fight-back restores speed AND starts cooldown.
  // Clear cooldown between fights to simulate site resetting after cooldown expires.
  for (let i = 0; i < maxFights; i++) {
    eventManager.coolDown = false; // Simulate cooldown expiry
    mockVideo.playbackRate = 1.0;  // Site resets to 1.0
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      stopImmediatePropagation: () => {}
    });
  }

  // The next reset should trigger surrender
  eventManager.coolDown = false;
  mockVideo.playbackRate = 1.0;
  externalAdjustCalled = false;
  eventManager.handleRateChange({
    composedPath: () => [mockVideo],
    target: mockVideo,
    detail: null,
    stopImmediatePropagation: () => {}
  });

  assert.true(externalAdjustCalled,
    'Should surrender and accept external speed after exceeding MAX_FIGHT_COUNT');
});

runner.test('fight count should reset after quiet period', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  config.settings.lastSpeed = 2.0;
  config.settings.forceLastSavedSpeed = false;

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);

  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  mockVideo.vsc = { speedIndicator: { textContent: '1.00' } };
  Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

  // Trigger 2 fights (clear cooldown between to simulate cooldown expiry)
  for (let i = 0; i < 2; i++) {
    eventManager.coolDown = false;
    mockVideo.playbackRate = 1.0;
    eventManager.handleRateChange({
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      stopImmediatePropagation: () => {}
    });
  }

  assert.equal(eventManager.fightCount, 2, 'Should have 2 fights recorded');

  // Wait for fight window to expire
  const fightWindowMs = window.VSC.EventManager.FIGHT_WINDOW_MS;
  await new Promise(resolve => setTimeout(resolve, fightWindowMs + 50));

  assert.equal(eventManager.fightCount, 0,
    'Fight count should reset after quiet period');
});

runner.test('cleanup should clear fight detection state', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);

  // Set some fight state
  eventManager.fightCount = 5;
  eventManager.fightTimer = setTimeout(() => {}, 10000);

  eventManager.cleanup();

  assert.equal(eventManager.fightCount, 0, 'Fight count should be cleared');
  assert.equal(eventManager.fightTimer, null, 'Fight timer should be cleared');
});

export { runner as eventManagerTestRunner };