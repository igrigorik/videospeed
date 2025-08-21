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

runner.test('VideoSpeedConfig should debounce lastSpeed saves', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();
  
  let saveCount = 0;
  const originalSet = window.VSC.StorageManager.set;
  
  window.VSC.StorageManager.set = async () => { 
    saveCount++; 
  };
  
  // Multiple rapid speed updates
  await config.save({ lastSpeed: 1.5 });
  await config.save({ lastSpeed: 1.8 });
  await config.save({ lastSpeed: 2.0 });
  
  // Should not have saved yet
  assert.equal(saveCount, 0);
  assert.equal(config.settings.lastSpeed, 2.0); // In-memory should update immediately
  
  // Wait for debounce delay
  await wait(1100);
  
  // Should have saved only once
  assert.equal(saveCount, 1);
  
  window.VSC.StorageManager.set = originalSet;
});

runner.test('VideoSpeedConfig should save non-speed settings immediately', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();
  
  let saveCount = 0;
  const originalSet = window.VSC.StorageManager.set;
  
  window.VSC.StorageManager.set = async () => { 
    saveCount++; 
  };
  
  await config.save({ enabled: false });
  
  // Should save immediately
  assert.equal(saveCount, 1);
  
  window.VSC.StorageManager.set = originalSet;
});

runner.test('VideoSpeedConfig should reset debounce timer on new speed updates', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();
  
  let saveCount = 0;
  const originalSet = window.VSC.StorageManager.set;
  
  window.VSC.StorageManager.set = async () => { 
    saveCount++; 
  };
  
  // First speed update
  await config.save({ lastSpeed: 1.5 });
  
  // Wait 500ms, then another update (should reset timer)
  await wait(500);
  await config.save({ lastSpeed: 2.0 });
  
  // Wait another 500ms (total 1000ms from first, but only 500ms from second)
  await wait(500);
  assert.equal(saveCount, 0); // Should not have saved yet
  
  // Wait remaining 600ms (total 1100ms from second update)
  await wait(600);
  assert.equal(saveCount, 1); // Should have saved now
  assert.equal(config.settings.lastSpeed, 2.0); // Final value
  
  window.VSC.StorageManager.set = originalSet;
});

runner.test('VideoSpeedConfig should persist only final speed value', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();
  
  let savedValue = null;
  const originalSet = window.VSC.StorageManager.set;
  
  window.VSC.StorageManager.set = async (settings) => { 
    savedValue = settings.lastSpeed; 
  };
  
  // Multiple rapid speed updates
  await config.save({ lastSpeed: 1.2 });
  await config.save({ lastSpeed: 1.7 });
  await config.save({ lastSpeed: 2.3 });
  
  // Wait for debounce
  await wait(1100);
  
  // Should have saved only the final value
  assert.equal(savedValue, 2.3);
  
  window.VSC.StorageManager.set = originalSet;
});

runner.test('VideoSpeedConfig should update in-memory settings immediately during debounce', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();
  
  let saveCount = 0;
  const originalSet = window.VSC.StorageManager.set;
  
  window.VSC.StorageManager.set = async () => { 
    saveCount++; 
  };
  
  // Speed update
  await config.save({ lastSpeed: 1.75 });
  
  // In-memory should update immediately, before storage save
  assert.equal(config.settings.lastSpeed, 1.75);
  assert.equal(saveCount, 0); // Storage not saved yet
  
  // Wait for debounce
  await wait(1100);
  assert.equal(saveCount, 1); // Now saved to storage
  
  window.VSC.StorageManager.set = originalSet;
});

export { runner as settingsTestRunner };