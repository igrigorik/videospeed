/**
 * Unit tests for settings management
 * Using global variables to match browser extension architecture
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { vi } from 'vitest';

// These tests run with chrome.storage mock (extension context).
// StorageManager detects chrome.storage and uses it directly.

describe('Settings', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installChromeMock();
    resetMockStorage();
    window.VSC.StorageManager.contextUrl = window.location.href;
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

  // --- Site rules + speed initialization ---

  it('siteDefaultSpeed is set when siteRule matches with speed', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    // Mock matchSiteRule to return a rule with speed
    const original = window.VSC.matchSiteRule;
    window.VSC.matchSiteRule = () => ({ pattern: 'test.com', enabled: true, speed: 2.3 });

    await config.load();
    expect(config.settings.siteDefaultSpeed).toBe(2.3);

    window.VSC.matchSiteRule = original;
  });

  it('matches site speed against StorageManager contextUrl', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    const original = window.VSC.matchSiteRule;
    const inheritedUrl = 'https://parent.example/video';
    const matchSiteRule = vi.fn(() => ({
      pattern: 'parent.example',
      enabled: true,
      speed: 2.3,
    }));
    window.VSC.StorageManager.contextUrl = inheritedUrl;
    window.VSC.matchSiteRule = matchSiteRule;

    await config.load();

    expect(matchSiteRule).toHaveBeenCalledWith(config.settings.siteRules, inheritedUrl);
    expect(config.settings.siteDefaultSpeed).toBe(2.3);

    window.VSC.matchSiteRule = original;
  });

  it('clears an initial abort and loads current custom settings after re-enable', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    const defaults = {
      ...window.VSC.Constants.DEFAULT_SETTINGS,
      controllerCSS: null,
    };
    const keyBindings = defaults.keyBindings.map((binding) =>
      binding.action === 'faster' ? { ...binding, value: 0.25 } : binding
    );
    const getSpy = vi
      .spyOn(window.VSC.StorageManager, 'get')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...defaults,
        customCSS: 'vsc-controller { top: 42px; }',
        keyBindings,
      });

    await config.load();
    expect(config.settings._abort).toBe(true);

    await config.load();
    expect(config.settings._abort).toBeUndefined();
    expect(config.settings.customCSS).toContain('top: 42px');
    expect(config.getKeyBinding('faster')).toBe(0.25);

    getSpy.mockRestore();
  });

  it('siteDefaultSpeed is not set when siteRule matches with speed=null', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    const original = window.VSC.matchSiteRule;
    window.VSC.matchSiteRule = () => ({ pattern: 'test.com', enabled: false, speed: null });

    await config.load();
    expect(config.settings.siteDefaultSpeed).toBeUndefined();

    window.VSC.matchSiteRule = original;
  });

  it('siteDefaultSpeed is not set when no rule matches', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    const original = window.VSC.matchSiteRule;
    window.VSC.matchSiteRule = () => null;

    await config.load();
    expect(config.settings.siteDefaultSpeed).toBeUndefined();

    window.VSC.matchSiteRule = original;
  });

  it('lastSpeed reset to null when rememberSpeed is false', async () => {
    // Inject lastSpeed=1.5 into mock storage
    globalThis.chrome.storage.sync.get = (keys, callback) => {
      setTimeout(() => {
        const defaults = typeof keys === 'object' ? keys : {};
        callback({ ...defaults, lastSpeed: 1.5, rememberSpeed: false });
      }, 10);
    };

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();
    expect(config.settings.lastSpeed).toBeNull();
  });

  it('lastSpeed preserved when rememberSpeed is true', async () => {
    globalThis.chrome.storage.sync.get = (keys, callback) => {
      setTimeout(() => {
        const defaults = typeof keys === 'object' ? keys : {};
        callback({ ...defaults, lastSpeed: 1.5, rememberSpeed: true });
      }, 10);
    };

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();
    expect(config.settings.lastSpeed).toBe(1.5);
  });

  it('site rule speed wins over stored lastSpeed when rememberSpeed is off', async () => {
    // Storage has lastSpeed=1.5 from a previous session, rememberSpeed=false
    globalThis.chrome.storage.sync.get = (keys, callback) => {
      setTimeout(() => {
        const defaults = typeof keys === 'object' ? keys : {};
        callback({ ...defaults, lastSpeed: 1.5, rememberSpeed: false });
      }, 10);
    };

    const config = new window.VSC.VideoSpeedConfig();
    const original = window.VSC.matchSiteRule;
    window.VSC.matchSiteRule = () => ({ pattern: 'test.com', enabled: true, speed: 2.3 });

    await config.load();

    // lastSpeed null (site rule wins), siteDefaultSpeed should be 2.3
    expect(config.settings.lastSpeed).toBeNull();
    expect(config.settings.siteDefaultSpeed).toBe(2.3);

    window.VSC.matchSiteRule = original;
  });
});
