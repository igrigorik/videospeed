/**
 * Unit tests for StorageManager's MAIN world (CustomEvent) code paths.
 *
 * StorageManager detects context at module eval time via:
 *   const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync
 *
 * The global vitest-setup.js installs chrome mock before modules load, so the
 * shared StorageManager instance uses chrome.storage paths. To test the MAIN
 * world paths, we:
 *   1. Remove globalThis.chrome (so hasChrome = false)
 *   2. Delete window.VSC.StorageManager (bypass singleton guard)
 *   3. vi.resetModules() + dynamic import to force fresh module evaluation
 *
 * This gives us a StorageManager that uses CustomEvent protocol exclusively.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installChromeMock } from '../../helpers/chrome-mock.js';

const docEl = document.documentElement;

/** @type {typeof import('../../../src/core/storage-manager.js')} */
let StorageManager;

// Stash the original StorageManager so we can restore it for other test files.
let originalStorageManager;

describe('StorageManager — MAIN world (CustomEvent paths)', () => {
  beforeEach(async () => {
    // Stash and remove the chrome-backed StorageManager
    originalStorageManager = window.VSC?.StorageManager;
    delete window.VSC.StorageManager;

    // Remove chrome mock so hasChrome evaluates false on re-import
    delete globalThis.chrome;

    // Clear local caches the module may inspect/write
    delete window.VSC_settings;
    delete window.VSC_settingsLatch;

    // Force vitest to re-evaluate the module file
    vi.resetModules();
    await import('../../../src/core/storage-manager.js');

    StorageManager = window.VSC.StorageManager;
  });

  afterEach(() => {
    // Restore the original chrome-backed StorageManager for other test files
    installChromeMock();
    if (originalStorageManager) {
      window.VSC.StorageManager = originalStorageManager;
    }

    // Clean up any lingering listeners (safety net — each test should clean its own)
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // GET
  // ---------------------------------------------------------------------------
  describe('get()', () => {
    it('fires VSC_REQUEST_SETTINGS and resolves on VSC_SETTINGS_READY', async () => {
      const bridgedSettings = { lastSpeed: 1.5, rememberSpeed: true };

      // Simulate bridge: respond to request with settings
      const responder = () => {
        docEl.dispatchEvent(
          new CustomEvent('VSC_SETTINGS_READY', {
            detail: { settings: bridgedSettings },
          })
        );
      };
      docEl.addEventListener('VSC_REQUEST_SETTINGS', responder);

      const result = await StorageManager.get({ lastSpeed: 1.0 });

      expect(result.lastSpeed).toBe(1.5);
      expect(result.rememberSpeed).toBe(true);

      docEl.removeEventListener('VSC_REQUEST_SETTINGS', responder);
    });

    it('falls back to defaults on 2s timeout', async () => {
      vi.useFakeTimers();

      const defaults = { lastSpeed: 1.0, enabled: true };

      // No responder installed — settings will never arrive
      const promise = StorageManager.get(defaults);

      // Advance past the 2000ms timeout
      await vi.advanceTimersByTimeAsync(2100);

      const result = await promise;
      expect(result).toEqual(defaults);
    });

    it('merges defaults with received settings', async () => {
      const responder = () => {
        docEl.dispatchEvent(
          new CustomEvent('VSC_SETTINGS_READY', {
            detail: { settings: { lastSpeed: 2.0 } },
          })
        );
      };
      docEl.addEventListener('VSC_REQUEST_SETTINGS', responder);

      // Pass defaults that include keys NOT in bridged settings
      const result = await StorageManager.get({
        lastSpeed: 1.0,
        enabled: true,
        controllerOpacity: 0.3,
      });

      // Bridged value overrides default
      expect(result.lastSpeed).toBe(2.0);
      // Defaults fill in missing keys
      expect(result.enabled).toBe(true);
      expect(result.controllerOpacity).toBe(0.3);

      docEl.removeEventListener('VSC_REQUEST_SETTINGS', responder);
    });

    it('retains contextUrl from successful and aborted bridge responses', async () => {
      const contextUrls = ['https://parent.example/video', 'https://blocked.example/video'];
      let requestCount = 0;
      const responder = () => {
        const contextUrl = contextUrls[requestCount++];
        docEl.dispatchEvent(
          new CustomEvent('VSC_SETTINGS_READY', {
            detail:
              requestCount === 1
                ? { settings: { lastSpeed: 2.0 }, contextUrl }
                : { abort: true, contextUrl },
          })
        );
      };
      docEl.addEventListener('VSC_REQUEST_SETTINGS', responder);

      const settings = await StorageManager.get({ lastSpeed: 1.0 });
      expect(settings.lastSpeed).toBe(2.0);
      expect(StorageManager.contextUrl).toBe(contextUrls[0]);
      expect(StorageManager.getContextHostname()).toBe('parent.example');

      const aborted = await StorageManager.get({ lastSpeed: 1.0 });
      expect(aborted).toBeNull();
      expect(StorageManager.contextUrl).toBe(contextUrls[1]);

      docEl.removeEventListener('VSC_REQUEST_SETTINGS', responder);
    });
  });

  // ---------------------------------------------------------------------------
  // SET
  // ---------------------------------------------------------------------------
  describe('set()', () => {
    it('dispatches VSC_WRITE_STORAGE for lastSpeed', async () => {
      const dispatched = vi.fn();
      const handler = (e) => dispatched(e.detail);
      docEl.addEventListener('VSC_WRITE_STORAGE', handler);

      await StorageManager.set({ lastSpeed: 2.5 });

      expect(dispatched).toHaveBeenCalledOnce();
      expect(dispatched).toHaveBeenCalledWith({ lastSpeed: 2.5 });

      docEl.removeEventListener('VSC_WRITE_STORAGE', handler);
    });

    it('warns and skips dispatch for non-lastSpeed keys', async () => {
      const dispatched = vi.fn();
      docEl.addEventListener('VSC_WRITE_STORAGE', dispatched);

      // Set up a logger spy to verify the warning path
      const warnSpy = vi.fn();
      window.VSC.logger = { warn: warnSpy };

      await StorageManager.set({ enabled: false, controllerOpacity: 0.5 });

      // Should NOT dispatch a CustomEvent — only lastSpeed is bridgeable
      expect(dispatched).not.toHaveBeenCalled();
      // Logger should have warned
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('only lastSpeed bridgeable'));

      docEl.removeEventListener('VSC_WRITE_STORAGE', dispatched);
      delete window.VSC.logger;
    });

    it('updates window.VSC_settings cache regardless of key', async () => {
      window.VSC_settings = { lastSpeed: 1.0 };

      // Non-bridgeable key should still update the in-memory cache
      await StorageManager.set({ enabled: false });

      expect(window.VSC_settings.enabled).toBe(false);
      // Original key preserved
      expect(window.VSC_settings.lastSpeed).toBe(1.0);
    });

    it('handles non-number lastSpeed gracefully (no dispatch)', async () => {
      const dispatched = vi.fn();
      docEl.addEventListener('VSC_WRITE_STORAGE', dispatched);

      const warnSpy = vi.fn();
      window.VSC.logger = { warn: warnSpy };

      // String value — not a valid speed
      await StorageManager.set({ lastSpeed: 'fast' });

      expect(dispatched).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid lastSpeed'));

      // Cache should still update (keeps in-memory state consistent)
      expect(window.VSC_settings.lastSpeed).toBe('fast');

      docEl.removeEventListener('VSC_WRITE_STORAGE', dispatched);
      delete window.VSC.logger;
    });
  });

  // ---------------------------------------------------------------------------
  // ONCHANGED
  // ---------------------------------------------------------------------------
  describe('onChanged()', () => {
    it('listens for VSC_STORAGE_CHANGED CustomEvent', () => {
      const callback = vi.fn();
      StorageManager.onChanged(callback);

      const changes = {
        lastSpeed: { oldValue: 1.0, newValue: 2.0 },
      };
      docEl.dispatchEvent(new CustomEvent('VSC_STORAGE_CHANGED', { detail: changes }));

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(changes);
    });

    it('updates window.VSC_settings cache from changes', () => {
      const callback = vi.fn();
      StorageManager.onChanged(callback);

      window.VSC_settings = { lastSpeed: 1.0 };

      const changes = {
        lastSpeed: { oldValue: 1.0, newValue: 3.0 },
        rememberSpeed: { oldValue: false, newValue: true },
      };
      docEl.dispatchEvent(new CustomEvent('VSC_STORAGE_CHANGED', { detail: changes }));

      expect(window.VSC_settings.lastSpeed).toBe(3.0);
      expect(window.VSC_settings.rememberSpeed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // REMOVE / CLEAR
  // ---------------------------------------------------------------------------
  describe('remove() / clear()', () => {
    it('remove() clears keys from local cache', async () => {
      window.VSC_settings = { lastSpeed: 2.0, enabled: true, rememberSpeed: false };

      await StorageManager.remove(['lastSpeed', 'rememberSpeed']);

      expect(window.VSC_settings.lastSpeed).toBeUndefined();
      expect(window.VSC_settings.rememberSpeed).toBeUndefined();
      // Untouched key remains
      expect(window.VSC_settings.enabled).toBe(true);
    });

    it('clear() empties local cache', async () => {
      window.VSC_settings = { lastSpeed: 2.0, enabled: true, rememberSpeed: false };

      await StorageManager.clear();

      expect(window.VSC_settings).toEqual({});
    });
  });
});
