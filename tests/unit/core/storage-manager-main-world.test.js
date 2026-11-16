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

  it('reports that storage is reached through the bridge', () => {
    expect(StorageManager.isBridged).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // REQUEST RUNTIME SETTINGS
  // ---------------------------------------------------------------------------
  describe('requestRuntimeSettings()', () => {
    /** Play the bridge: answer the next settings request with `detail`. */
    function answerWith(detail) {
      const responder = () => {
        docEl.dispatchEvent(new CustomEvent('VSC_SETTINGS_READY', { detail }));
      };
      docEl.addEventListener('VSC_REQUEST_SETTINGS', responder, { once: true });
    }

    it('fires VSC_REQUEST_SETTINGS and resolves with what the bridge sends', async () => {
      const settings = { initialSpeed: 1.5, rememberSpeed: true };
      answerWith({ settings });

      // As received: the bridge already resolved defaults, so none are added.
      await expect(StorageManager.requestRuntimeSettings()).resolves.toEqual(settings);
    });

    it('fails closed on 2s timeout', async () => {
      vi.useFakeTimers();

      // No responder installed — settings authorization is unknown.
      const promise = StorageManager.requestRuntimeSettings();

      await vi.advanceTimersByTimeAsync(2100);

      await expect(promise).resolves.toBeNull();
    });

    it.each([
      ['an abort', { abort: true }],
      ['no detail', undefined],
      ['no settings object', {}],
      ['array settings', { settings: [] }],
    ])('fails closed when the bridge response has %s', async (_label, detail) => {
      answerWith(detail);

      await expect(StorageManager.requestRuntimeSettings()).resolves.toBeNull();
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

    it('handles non-number lastSpeed gracefully (no dispatch)', async () => {
      const dispatched = vi.fn();
      docEl.addEventListener('VSC_WRITE_STORAGE', dispatched);

      const warnSpy = vi.fn();
      window.VSC.logger = { warn: warnSpy };

      // String value — not a valid speed
      await StorageManager.set({ lastSpeed: 'fast' });

      expect(dispatched).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid lastSpeed'));

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
        startHidden: { newValue: true },
      };
      docEl.dispatchEvent(new CustomEvent('VSC_STORAGE_CHANGED', { detail: changes }));

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(changes);
    });
  });
});
