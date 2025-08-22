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

export { runner as eventManagerTestRunner };