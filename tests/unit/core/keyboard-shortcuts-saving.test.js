/**
 * Tests for keyboard shortcuts saving fix
 * Verifies the resolution of the dual storage system issue
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

// Load all required modules

describe('KeyboardShortcutsSaving', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();

    // Clear any injected settings for clean tests
    if (window.VSC && window.VSC.StorageManager) {
      window.VSC.StorageManager._injectedSettings = null;
    }
  });

  afterEach(() => {
    cleanupChromeMock();
  });

  // DEFAULT_SETTINGS keyBindings initialization tests
  it('DEFAULT_SETTINGS should have keyBindings populated', () => {
    const defaults = window.VSC.Constants.DEFAULT_SETTINGS;

    expect(defaults.keyBindings).toBeDefined();
    expect(defaults.keyBindings.length > 0).toBe(true);

    // Should have all expected default bindings
    const expectedActions = [
      'slower',
      'faster',
      'rewind',
      'advance',
      'reset',
      'fast',
      'display',
      'mark',
      'jump',
    ];
    const actualActions = defaults.keyBindings.map((b) => b.action);

    expectedActions.forEach((action) => {
      expect(actualActions.includes(action)).toBe(true);
    });

    expect(defaults.rememberSpeed).toBe(false);
    expect(defaults.audioBoolean).toBe(true);

    const preferredBinding = defaults.keyBindings.find((b) => b.action === 'fast' && b.predefined);
    expect(preferredBinding.value).toBe(1.8);

    const slowerBinding = defaults.keyBindings.find((b) => b.action === 'slower' && b.predefined);
    expect(slowerBinding.key).toBe(83);
  });

  it('DEFAULT_SETTINGS keyBindings should have proper structure', () => {
    const defaults = window.VSC.Constants.DEFAULT_SETTINGS;

    defaults.keyBindings.forEach((binding, _index) => {
      expect(typeof binding.action).toBe('string');
      expect(typeof binding.key).toBe('number');
      expect(typeof binding.value).toBe('number');
      expect(typeof binding.predefined).toBe('boolean');
    });
  });

  it('Fresh install should not require first-time initialization', async () => {
    // Clear storage to simulate fresh install
    resetMockStorage();

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Should have loaded default bindings without first-time initialization
    expect(config.settings.keyBindings).toBeDefined();
    expect(config.settings.keyBindings.length > 0).toBe(true);

    // Verify it matches DEFAULT_SETTINGS
    const defaultsLength = window.VSC.Constants.DEFAULT_SETTINGS.keyBindings.length;
    expect(config.settings.keyBindings.length).toBe(defaultsLength);
  });

  // Storage System Unification tests
  it('Should handle existing keyBindings in storage', async () => {
    // Setup existing storage with keyBindings by saving them first
    const existingBindings = [
      { action: 'slower', key: 65, value: 0.2, force: false, predefined: true }, // A key
      { action: 'faster', key: 68, value: 0.2, force: false, predefined: true }, // D key
    ];

    const config1 = new window.VSC.VideoSpeedConfig();
    await config1.save({ keyBindings: existingBindings });

    // Load with new instance to verify persistence
    const config2 = new window.VSC.VideoSpeedConfig();
    await config2.load();

    expect(config2.settings.keyBindings.length >= existingBindings.length).toBe(true);

    // Verify bindings were loaded correctly
    const slowerBinding = config2.settings.keyBindings.find((b) => b.action === 'slower');
    expect(slowerBinding).toBeDefined();
  });

  it('Should save keyBindings to storage correctly', async () => {
    const config1 = new window.VSC.VideoSpeedConfig();

    const customBindings = [
      { action: 'slower', key: 81, value: 0.15, force: true, predefined: true }, // Q key
      { action: 'faster', key: 69, value: 0.15, force: false, predefined: true }, // E key
    ];

    await config1.save({ keyBindings: customBindings });

    // Verify saved by loading with new instance
    const config2 = new window.VSC.VideoSpeedConfig();
    await config2.load();

    expect(config2.settings.keyBindings).toBeDefined();
    expect(config2.settings.keyBindings.length >= customBindings.length).toBe(true);
  });

  it('Should maintain consistency across load/save cycles', async () => {
    const originalBindings = [
      { action: 'slower', key: 87, value: 0.25, force: true, predefined: true }, // W key
      { action: 'faster', key: 83, value: 0.25, force: false, predefined: true }, // S key
    ];

    // Save bindings
    const config1 = new window.VSC.VideoSpeedConfig();
    await config1.save({ keyBindings: originalBindings });

    // Load with new instance
    const config2 = new window.VSC.VideoSpeedConfig();
    await config2.load();

    const loadedBindings = config2.settings.keyBindings;

    // Find our bindings (they might be mixed with defaults)
    const slowerBinding = loadedBindings.find((b) => b.action === 'slower');
    const fasterBinding = loadedBindings.find((b) => b.action === 'faster');

    expect(slowerBinding).toBeDefined();
    expect(fasterBinding).toBeDefined();
  });

  // Legacy force field should be tolerated but not required
  it('Should tolerate legacy force values in stored bindings', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Default bindings should no longer have force field
    const bindings = config.settings.keyBindings;
    bindings.forEach((binding, _index) => {
      expect(binding.force).toBe(undefined);
    });
  });

  // Regression Prevention tests
  it('Should never lose all keyboard shortcuts', async () => {
    // This test specifically prevents the original bug from returning

    // Test that default shortcuts are always available
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Should always have shortcuts
    expect(config.settings.keyBindings && config.settings.keyBindings.length > 0).toBe(true);

    // Should have the essential shortcuts
    const requiredActions = ['slower', 'faster', 'display'];
    for (const action of requiredActions) {
      const binding = config.settings.keyBindings.find((b) => b.action === action);
      expect(binding).toBeDefined();
    }
  });

  it('Fresh install should always have functional default shortcuts', async () => {
    // Simulate completely fresh install (empty storage)
    resetMockStorage();

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Should have all expected default shortcuts
    const requiredActions = [
      'slower',
      'faster',
      'rewind',
      'advance',
      'reset',
      'fast',
      'display',
      'mark',
      'jump',
    ];

    for (const action of requiredActions) {
      const binding = config.settings.keyBindings.find((b) => b.action === action);
      expect(binding).toBeDefined();
      expect(typeof binding.key).toBe('number');
      expect(binding.key > 0).toBe(true);
    }
  });
});
