/**
 * Unit tests for settings management
 * Using global variables to match browser extension architecture
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert, wait } from '../../helpers/test-utils.js';
import { loadCoreModules } from '../../helpers/module-loader.js';

// Load all required modules
await loadCoreModules();

const runner = new SimpleTestRunner();

runner.beforeEach(() => {
  installChromeMock();
  resetMockStorage();

  // Clear any injected settings for clean tests
  if (window.VSC && window.VSC.StorageManager) {
    window.VSC.StorageManager._injectedSettings = null;
  }
});

runner.afterEach(() => {
  cleanupChromeMock();
});

runner.test('VideoSpeedConfig should initialize with default settings', () => {
  // Access VideoSpeedConfig from global scope
  const config = window.VSC.videoSpeedConfig;
  assert.exists(config.settings);
  assert.equal(config.settings.enabled, true);
  assert.equal(config.settings.lastSpeed, 1.0);
  assert.equal(config.settings.logLevel, 3);
});

runner.test('VideoSpeedConfig should load settings from storage', async () => {
  const config = window.VSC.videoSpeedConfig;
  const settings = await config.load();

  assert.exists(settings);
  assert.equal(settings.enabled, true);
  assert.equal(settings.lastSpeed, 1.0);
});

runner.test('VideoSpeedConfig should save settings to storage', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  await config.save({ lastSpeed: 2.0, enabled: false });

  assert.equal(config.settings.lastSpeed, 2.0);
  assert.equal(config.settings.enabled, false);
});

runner.test('VideoSpeedConfig should handle key bindings', async () => {
  // Create fresh config instance
  const config = new window.VSC.VideoSpeedConfig();

  // Load settings with defaults
  await config.load();

  const fasterValue = config.getKeyBinding('faster');
  assert.equal(fasterValue, 0.1);

  config.setKeyBinding('faster', 0.2);
  const updatedValue = config.getKeyBinding('faster');
  assert.equal(updatedValue, 0.2);
});

runner.test('VideoSpeedConfig should have state manager available', () => {
  const config = window.VSC.videoSpeedConfig;

  // Verify state manager is available (media tracking moved there)
  assert.exists(window.VSC.stateManager, 'State manager should be available');
  assert.equal(typeof window.VSC.stateManager.getAllMediaElements, 'function', 'State manager should have getAllMediaElements method');
  assert.equal(typeof window.VSC.stateManager.registerController, 'function', 'State manager should have registerController method');
  assert.equal(typeof window.VSC.stateManager.removeController, 'function', 'State manager should have removeController method');
});

runner.test('VideoSpeedConfig should handle invalid key binding requests gracefully', () => {
  const config = window.VSC.videoSpeedConfig;

  const result = config.getKeyBinding('nonexistent');
  assert.equal(result, false);

  // Should not throw
  config.setKeyBinding('nonexistent', 123);
});

export { runner as settingsTestRunner };