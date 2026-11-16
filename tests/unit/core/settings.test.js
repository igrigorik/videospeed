/**
 * Unit tests for settings management
 * Using global variables to match browser extension architecture
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
  getMockStorage,
} from '../../helpers/chrome-mock.js';
import { vi } from 'vitest';

// These tests run with chrome.storage mock (extension context).
// StorageManager detects chrome.storage and uses it directly.

describe('Settings', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installChromeMock();
    resetMockStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupChromeMock();
  });

  it('VideoSpeedConfig should initialize with default settings', () => {
    // Access VideoSpeedConfig from global scope
    const config = window.VSC.videoSpeedConfig;
    expect(config.settings).toBeDefined();
    expect(config.settings.enabled).toBe(true);
    expect(config.settings.lastSpeed).toBe(1.0);
    expect(config.settings.logLevel).toBe(3);
  });

  it('VideoSpeedConfig should load settings from storage', async () => {
    const config = window.VSC.videoSpeedConfig;
    const settings = await config.load();

    expect(settings).toBeDefined();
    expect(settings.enabled).toBe(true);
    expect(settings.lastSpeed).toBeNull(); // no user choice yet
  });

  it('VideoSpeedConfig should save settings to storage', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    await config.save({ lastSpeed: 2.0, enabled: false });

    expect(config.settings.lastSpeed).toBe(2.0);
    expect(config.settings.enabled).toBe(false);
  });

  it('VideoSpeedConfig should handle key bindings', async () => {
    // Create fresh config instance
    const config = new window.VSC.VideoSpeedConfig();

    // Load settings with defaults
    await config.load();

    const fasterValue = config.getKeyBinding('faster');
    expect(fasterValue).toBe(0.1);

    config.setKeyBinding('faster', 0.2);
    const updatedValue = config.getKeyBinding('faster');
    expect(updatedValue).toBe(0.2);
  });

  it('VideoSpeedConfig should have state manager available', () => {
    // Verify state manager is available (media tracking moved there)
    expect(window.VSC.stateManager).toBeDefined();
    expect(typeof window.VSC.stateManager.getAllMediaElements).toBe('function');
    expect(typeof window.VSC.stateManager.registerController).toBe('function');
    expect(typeof window.VSC.stateManager.removeController).toBe('function');
  });

  it('VideoSpeedConfig should handle invalid key binding requests gracefully', () => {
    const config = window.VSC.videoSpeedConfig;

    const result = config.getKeyBinding('nonexistent');
    expect(result).toBe(false);

    // Should not throw
    config.setKeyBinding('nonexistent', 123);
  });

  it('VideoSpeedConfig should debounce lastSpeed saves', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const mockSet = vi.fn();
    const originalSet = window.VSC.StorageManager.set;

    window.VSC.StorageManager.set = mockSet;

    // Multiple rapid speed updates
    await config.save({ lastSpeed: 1.5 });
    await config.save({ lastSpeed: 1.8 });
    await config.save({ lastSpeed: 2.0 });

    // Should not have saved yet
    expect(mockSet).not.toHaveBeenCalled();
    expect(config.settings.lastSpeed).toBe(2.0); // In-memory should update immediately

    // Wait for debounce delay
    await vi.advanceTimersByTimeAsync(1100);

    // Should have saved only once
    expect(mockSet).toHaveBeenCalledOnce();

    window.VSC.StorageManager.set = originalSet;
  });

  it('VideoSpeedConfig should save non-speed settings immediately', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const mockSet = vi.fn();
    const originalSet = window.VSC.StorageManager.set;

    window.VSC.StorageManager.set = mockSet;

    await config.save({ enabled: false });

    // Should save immediately
    expect(mockSet).toHaveBeenCalledOnce();

    window.VSC.StorageManager.set = originalSet;
  });

  it('VideoSpeedConfig should reset debounce timer on new speed updates', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const mockSet = vi.fn();
    const originalSet = window.VSC.StorageManager.set;

    window.VSC.StorageManager.set = mockSet;

    // First speed update
    await config.save({ lastSpeed: 1.5 });

    // Wait 500ms, then another update (should reset timer)
    await vi.advanceTimersByTimeAsync(500);
    await config.save({ lastSpeed: 2.0 });

    // Wait another 500ms (total 1000ms from first, but only 500ms from second)
    await vi.advanceTimersByTimeAsync(500);
    expect(mockSet).not.toHaveBeenCalled(); // Should not have saved yet

    // Wait remaining 600ms (total 1100ms from second update)
    await vi.advanceTimersByTimeAsync(600);
    expect(mockSet).toHaveBeenCalledOnce(); // Should have saved now
    expect(config.settings.lastSpeed).toBe(2.0); // Final value

    window.VSC.StorageManager.set = originalSet;
  });

  it('VideoSpeedConfig should persist only final speed value', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const mockSet = vi.fn();
    const originalSet = window.VSC.StorageManager.set;

    window.VSC.StorageManager.set = mockSet;

    // Multiple rapid speed updates
    await config.save({ lastSpeed: 1.2 });
    await config.save({ lastSpeed: 1.7 });
    await config.save({ lastSpeed: 2.3 });

    // Wait for debounce
    await vi.advanceTimersByTimeAsync(1100);

    // Should have saved only the final value
    expect(mockSet).toHaveBeenCalledOnce();
    expect(mockSet.mock.calls[0][0].lastSpeed).toBe(2.3);

    window.VSC.StorageManager.set = originalSet;
  });

  it('VideoSpeedConfig should update in-memory settings immediately during debounce', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const mockSet = vi.fn();
    const originalSet = window.VSC.StorageManager.set;

    window.VSC.StorageManager.set = mockSet;

    // Speed update
    await config.save({ lastSpeed: 1.75 });

    // In-memory should update immediately, before storage save
    expect(config.settings.lastSpeed).toBe(1.75);
    expect(mockSet).not.toHaveBeenCalled(); // Storage not saved yet

    // Wait for debounce
    await vi.advanceTimersByTimeAsync(1100);
    expect(mockSet).toHaveBeenCalledOnce(); // Now saved to storage

    window.VSC.StorageManager.set = originalSet;
  });

  // --- Speed authority on extension pages ---
  // A site rule's speed is resolved by the content bridge for the document it
  // runs in (see runtime-settings.test.js). An extension page has no such
  // document, so its authority is the remembered speed or nothing.

  it('lastSpeed reset to null when rememberSpeed is false', async () => {
    Object.assign(getMockStorage(), { lastSpeed: 1.5, rememberSpeed: false });

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();
    expect(config.settings.lastSpeed).toBeNull();
  });

  it('lastSpeed preserved when rememberSpeed is true', async () => {
    Object.assign(getMockStorage(), { lastSpeed: 1.5, rememberSpeed: true });

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();
    expect(config.settings.lastSpeed).toBe(1.5);
  });

  it('lastSpeed is read back with the two decimals VSC stores', async () => {
    Object.assign(getMockStorage(), { lastSpeed: 1.234567891234567, rememberSpeed: true });

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();
    expect(config.settings.lastSpeed).toBe(1.23);
  });

  it('reads preferences the way the page script will see them', async () => {
    Object.assign(getMockStorage(), { controllerOpacity: 'opaque', logLevel: 9, startHidden: 1 });

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    expect(config.settings).toMatchObject({
      controllerOpacity: 0.3,
      logLevel: 3,
      startHidden: true,
    });
  });

  // --- Site rules on extension pages ---
  // The options page shows the rules the content bridge enforces: what the
  // user saved, under either key, else the defaults.

  describe('site rules', () => {
    const loadRules = async (stored) => {
      const storage = getMockStorage();
      delete storage.blacklist;
      Object.assign(storage, stored);

      const config = new window.VSC.VideoSpeedConfig();
      await config.load();
      return config.settings.siteRules;
    };

    it('are the defaults when nothing was ever saved', async () => {
      expect(await loadRules({})).toEqual(window.VSC.Constants.DEFAULT_SETTINGS.siteRules);
    });

    it('are the saved rules, even an empty list', async () => {
      const siteRules = [{ pattern: 'youtube.com', enabled: true, speed: 2 }];

      expect(await loadRules({ siteRules, blacklist: 'netflix.com' })).toEqual(siteRules);
      expect(await loadRules({ siteRules: [], blacklist: 'netflix.com' })).toEqual([]);
    });

    it('are a legacy blacklist, read as disabled rules, when no rules are saved', async () => {
      expect(await loadRules({ blacklist: 'youtube.com\nnetflix.com' })).toEqual([
        { pattern: 'youtube.com', enabled: false, speed: null },
        { pattern: 'netflix.com', enabled: false, speed: null },
      ]);
    });

    it('are not written back to storage on load', async () => {
      const set = vi.spyOn(window.VSC.StorageManager, 'set');
      const { keyBindings } = window.VSC.Constants.DEFAULT_SETTINGS;

      await loadRules({ blacklist: 'youtube.com', keyBindings });

      expect(set).not.toHaveBeenCalled();
      set.mockRestore();
    });
  });
});
