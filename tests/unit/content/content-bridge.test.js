/**
 * Tests for content-bridge.js (ISOLATED world bridge).
 *
 * Focused on behavioral contracts, not implementation details:
 *   - Trust boundary: only lastSpeed writable from MAIN world
 *   - Blacklist correctness: domain-boundary matching, invalid regex handling
 *   - Settings handshake: request/response protocol
 *   - Lifecycle: disable tears down; re-enable waits for reload
 *   - Early exit: disabled/blacklisted/about: frames skip initialization
 *
 * The bridge auto-inits at module load. Each test uses vi.resetModules() +
 * dynamic import for fresh state. Chrome mock must be configured BEFORE import.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
  getMockStorage,
  getMockLocalStorage,
} from '../../helpers/chrome-mock.js';

const docEl = document.documentElement;

// --- Minimal test infrastructure ---

/** MV3 bridge uses promise-based storage APIs — wrap callback mock. */
function promisifyChromeMock() {
  for (const area of ['sync', 'local']) {
    const store = globalThis.chrome.storage[area];
    const origGet = store.get;
    store.get = (keys, callback) => {
      if (typeof callback === 'function') {
        return origGet(keys, callback);
      }
      return new Promise((resolve) => origGet(keys, resolve));
    };
    const origSet = store.set;
    store.set = (items, callback) => {
      if (typeof callback === 'function') {
        return origSet(items, callback);
      }
      return new Promise((resolve) => origSet(items, resolve));
    };
  }
}

/** Track docEl listeners so afterEach can clean up bridge-registered ones. */
function interceptDocEl() {
  const registered = [];
  const origAdd = docEl.addEventListener.bind(docEl);
  const origRemove = docEl.removeEventListener.bind(docEl);
  docEl.addEventListener = (type, handler, options) => {
    registered.push({ type, handler, options });
    return origAdd(type, handler, options);
  };
  docEl.removeEventListener = (type, handler, options) => {
    const idx = registered.findIndex((r) => r.type === type && r.handler === handler);
    if (idx !== -1) {
      registered.splice(idx, 1);
    }
    return origRemove(type, handler, options);
  };
  return () => {
    for (const { type, handler, options } of registered) {
      origRemove(type, handler, options);
    }
    registered.length = 0;
    docEl.addEventListener = origAdd;
    docEl.removeEventListener = origRemove;
  };
}

/** Load bridge, capture its onChanged listener, return it for direct invocation. */
async function loadBridge() {
  const captured = [];
  const origAddListener = globalThis.chrome.storage.onChanged.addListener;
  globalThis.chrome.storage.onChanged.addListener = (cb) => {
    captured.push(cb);
    origAddListener(cb);
  };
  vi.resetModules();
  await import('../../../src/entries/content-bridge.js');
  await vi.advanceTimersByTimeAsync(50);
  await vi.advanceTimersByTimeAsync(10);
  globalThis.chrome.storage.onChanged.addListener = origAddListener;
  return captured[0] || null;
}

/** Collect CustomEvents on docEl. Returns { events, cleanup }. */
function collectEvents(...names) {
  const events = [];
  const handlers = names.map((name) => {
    const h = (e) => events.push({ type: name, detail: e.detail });
    docEl.addEventListener(name, h);
    return { name, handler: h };
  });
  return {
    events,
    cleanup: () =>
      handlers.forEach(({ name, handler }) => docEl.removeEventListener(name, handler)),
  };
}

async function requestSettings() {
  docEl.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));
  await vi.advanceTimersByTimeAsync(0);
}

// --- Tests ---

describe('content-bridge', () => {
  let cleanupIntercept = null;
  let eventCleanup = null;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installChromeMock();
    resetMockStorage();
    promisifyChromeMock();
    cleanupIntercept = interceptDocEl();
  });

  afterEach(() => {
    if (eventCleanup) {
      eventCleanup();
      eventCleanup = null;
    }
    if (cleanupIntercept) {
      cleanupIntercept();
      cleanupIntercept = null;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    cleanupChromeMock();
  });

  // =========================================================================
  // Early exit — disabled/blacklisted sites skip initialization
  // =========================================================================

  describe('early exit', () => {
    it('signals abort when extension is disabled', async () => {
      getMockStorage().enabled = false;
      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;

      await loadBridge();

      // Bridge responds with abort signal so inject.js knows not to init
      await requestSettings();
      expect(events).toHaveLength(1);
      expect(events[0].detail.abort).toBe(true);
    });

    it('signals abort when URL matches blacklist', async () => {
      // jsdom default URL is http://localhost/
      getMockStorage().blacklist = 'localhost';

      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;

      await loadBridge();
      await requestSettings();
      expect(events).toHaveLength(1);
      expect(events[0].detail.abort).toBe(true);
    });

    it('blacklist is ignored when siteRules exists (post-migration)', async () => {
      // Regression: the settings migration preserves the legacy blacklist string
      // in storage for sync compat but siteRules is the source of truth post-migration.
      // A site removed from siteRules must not remain blocked by the stale blacklist.
      getMockStorage().blacklist = 'localhost'; // matches jsdom URL
      getMockStorage().siteRules = []; // migration ran, no disable rule for localhost

      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;

      await loadBridge();
      await requestSettings();
      expect(events).toHaveLength(1);
      expect(events[0].detail.abort).toBeUndefined(); // NOT aborted
    });

    it('blacklist uses domain boundary matching (x.com does NOT match localhost)', async () => {
      // Regression test for fixed bug: raw RegExp('x.com') would match
      // any URL containing 'x.com'. isBlacklisted() uses domain boundaries.
      getMockStorage().blacklist = 'x.com';
      // jsdom URL http://localhost/ does NOT match x.com → bridge should init

      const onChanged = await loadBridge();
      expect(onChanged).not.toBeNull();
    });

    it('signals abort when siteRule disables current URL', async () => {
      // Match jsdom's default location (http://localhost/)
      getMockStorage().siteRules = [{ pattern: 'localhost', enabled: false }];

      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;

      await loadBridge();
      await requestSettings();
      expect(events).toHaveLength(1);
      expect(events[0].detail.abort).toBe(true);
    });

    it.each(['about:blank', 'about:BLANK', 'about:blank#child', 'about:srcdoc'])(
      'fails closed in inherited frame %s',
      async (href) => {
        vi.stubGlobal('location', { href, hostname: '', protocol: 'about:' });
        const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
        eventCleanup = cleanup;

        await loadBridge();
        await requestSettings();

        expect(events).toEqual([{ type: 'VSC_SETTINGS_READY', detail: { abort: true } }]);
      }
    );
  });

  // =========================================================================
  // Settings handshake — request/response protocol
  // =========================================================================

  describe('settings handshake', () => {
    it('responds to VSC_REQUEST_SETTINGS with settings payload', async () => {
      getMockStorage().lastSpeed = 2.5;
      getMockStorage().rememberSpeed = true;
      await loadBridge();

      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;

      await requestSettings();
      expect(events).toHaveLength(1);
      expect(events[0].detail.settings.initialSpeed).toBe(2.5);
      expect(events[0].detail.settings.lastSpeed).toBeUndefined();
      expect(events[0].detail.settings.rememberSpeed).toBe(true);
    });

    it('sends only the functional allowlist; raw storage keys never cross', async () => {
      getMockStorage().blacklist = 'some.site';
      getMockStorage().enabled = true;
      getMockStorage().siteRules = [{ pattern: 'localhost', enabled: true, speed: 2.3 }];
      getMockStorage().lastSpeed = 2.5;
      getMockStorage().rememberSpeed = true;
      getMockStorage().customCSS = 'vsc-controller { top: 42px; }';
      await loadBridge();

      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;

      await requestSettings();

      const { settings, hostname } = events[0].detail;
      // Raw storage and lifecycle keys are not part of the page-visible payload.
      expect(settings.blacklist).toBeUndefined();
      expect(settings.enabled).toBeUndefined();
      expect(settings.siteRules).toBeUndefined();
      expect(settings.lastSpeed).toBeUndefined();
      expect(settings.schemaVersion).toBeUndefined();
      // The resolved starting speed is sent instead.
      expect(settings.initialSpeed).toBe(2.3);
      // Functional settings still pass through.
      expect(settings.customCSS).toBe('vsc-controller { top: 42px; }');
      expect(settings.rememberSpeed).toBe(true);
      expect(hostname).toBeUndefined();
    });

    it('prefers this origin remembered speed over the global value', async () => {
      getMockStorage().rememberSpeed = true;
      getMockStorage().lastSpeed = 1.1;
      getMockLocalStorage()[`vsc:lastSpeed:${location.origin}`] = 1.8;
      await loadBridge();

      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;
      await requestSettings();

      expect(events[0].detail.settings.initialSpeed).toBe(1.8);
    });

    it('ignores another origin remembered speed', async () => {
      getMockStorage().rememberSpeed = true;
      getMockStorage().lastSpeed = 1.1;
      getMockLocalStorage()['vsc:lastSpeed:https://other.example'] = 2.9;
      await loadBridge();

      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;
      await requestSettings();

      expect(events[0].detail.settings.initialSpeed).toBe(1.1);
    });

    it('does not lose a request while the initial storage read is pending', async () => {
      let resolveSettings;
      vi.spyOn(globalThis.chrome.storage.sync, 'get').mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSettings = resolve;
          })
      );
      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;

      vi.resetModules();
      await import('../../../src/entries/content-bridge.js');
      docEl.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));
      expect(events).toHaveLength(0);

      resolveSettings({ ...getMockStorage(), lastSpeed: 2.5, rememberSpeed: true });
      await vi.advanceTimersByTimeAsync(20);

      expect(events).toHaveLength(1);
      expect(events[0].detail.settings.initialSpeed).toBe(2.5);
      expect(events[0].detail.settings.lastSpeed).toBeUndefined();
    });

    it('keeps a pre-handshake disable sticky across rapid re-enable', async () => {
      let resolveSettings;
      let onChanged;
      vi.spyOn(globalThis.chrome.storage.sync, 'get').mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSettings = resolve;
          })
      );
      vi.spyOn(globalThis.chrome.storage.onChanged, 'addListener').mockImplementation(
        (listener) => {
          onChanged = listener;
        }
      );
      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY', 'VSC_MESSAGE');
      eventCleanup = cleanup;

      vi.resetModules();
      await import('../../../src/entries/content-bridge.js');
      docEl.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));
      onChanged({ enabled: { oldValue: true, newValue: false } }, 'sync');
      onChanged({ enabled: { oldValue: false, newValue: true } }, 'sync');
      resolveSettings({ ...getMockStorage(), enabled: true });
      await vi.advanceTimersByTimeAsync(20);

      expect(events.some((event) => event.detail?.type === 'VSC_TEARDOWN')).toBe(true);
      expect(events.find((event) => event.type === 'VSC_SETTINGS_READY')?.detail).toEqual({
        abort: true,
      });
    });

    it('fails closed when the initial storage read fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(globalThis.chrome.storage.sync, 'get').mockRejectedValue(
        new Error('storage unavailable')
      );
      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;

      vi.resetModules();
      await import('../../../src/entries/content-bridge.js');
      docEl.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toEqual([{ type: 'VSC_SETTINGS_READY', detail: { abort: true } }]);
    });
  });

  // =========================================================================
  // Trust boundary — page-originated writes are per-origin and throttled
  // =========================================================================

  describe('VSC_WRITE_STORAGE trust boundary', () => {
    const rememberedSpeed = () => getMockLocalStorage()[`vsc:lastSpeed:${location.origin}`];

    it('writes valid lastSpeed to per-origin local storage and clamps to range', async () => {
      getMockStorage().rememberSpeed = true;
      await loadBridge();
      await requestSettings();

      // Valid speed
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 2.5 } }));
      await vi.advanceTimersByTimeAsync(20);
      expect(rememberedSpeed()).toBe(2.5);

      // Clamped to min (0.07)
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 0.01 } }));
      await vi.advanceTimersByTimeAsync(1100);
      expect(rememberedSpeed()).toBe(0.07);

      // Clamped to max (16)
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 99 } }));
      await vi.advanceTimersByTimeAsync(1100);
      expect(rememberedSpeed()).toBe(16);

      // Never written to sync storage (no cross-site identifier).
      expect(getMockStorage().lastSpeed).toBe(1.0);
    });

    it('rejects invalid speed values and non-speed keys', async () => {
      getMockStorage().rememberSpeed = true;
      await loadBridge();
      await requestSettings();

      // Non-number
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 'fast' } }));
      await vi.advanceTimersByTimeAsync(1100);
      expect(rememberedSpeed()).toBeUndefined();

      // NaN
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: NaN } }));
      await vi.advanceTimersByTimeAsync(1100);
      expect(rememberedSpeed()).toBeUndefined();

      // Non-lastSpeed key (trust boundary)
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { startHidden: true } }));
      await vi.advanceTimersByTimeAsync(1100);
      expect(getMockStorage().startHidden).toBe(false); // unchanged from default

      // Null detail
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: null }));
      await vi.advanceTimersByTimeAsync(1100);
      expect(rememberedSpeed()).toBeUndefined();
    });

    it('does not persist page-originated speed when rememberSpeed is off', async () => {
      getMockStorage().rememberSpeed = false;
      await loadBridge();
      await requestSettings();

      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 2.5 } }));
      await vi.advanceTimersByTimeAsync(1100);

      expect(rememberedSpeed()).toBeUndefined();
    });

    it('coalesces rapid writes instead of issuing one storage write per event', async () => {
      getMockStorage().rememberSpeed = true;
      await loadBridge();
      await requestSettings();

      for (const speed of [1.1, 1.2, 1.3, 1.4]) {
        docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: speed } }));
      }
      await vi.advanceTimersByTimeAsync(20);
      expect(rememberedSpeed()).toBe(1.4);

      // Subsequent events inside the throttle window are coalesced to the last
      // value once the window opens.
      for (const speed of [1.5, 1.6, 1.7]) {
        docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: speed } }));
      }
      await vi.advanceTimersByTimeAsync(1100);
      expect(rememberedSpeed()).toBe(1.7);
    });
  });

  // =========================================================================
  // Lifecycle — disable tears down; re-enable waits for reload
  // =========================================================================

  describe('lifecycle', () => {
    // Disable tears down immediately. Re-enable, siteRules, and blacklist
    // changes take effect on reload, matching the popup's user-facing contract.

    it('dispatches VSC_TEARDOWN when disabled via popup toggle', async () => {
      const onChanged = await loadBridge();
      const { events, cleanup } = collectEvents('VSC_MESSAGE');
      eventCleanup = cleanup;

      onChanged({ enabled: { oldValue: true, newValue: false } }, 'sync');
      const teardowns = events.filter((e) => e.detail?.type === 'VSC_TEARDOWN');
      expect(teardowns).toHaveLength(1);
    });

    it('stays inactive after re-enable until the page reloads', async () => {
      getMockStorage().rememberSpeed = true;
      const onChanged = await loadBridge();
      const { events, cleanup } = collectEvents('VSC_MESSAGE');
      eventCleanup = cleanup;

      await requestSettings();
      onChanged({ enabled: { oldValue: true, newValue: false } }, 'sync');
      onChanged({ enabled: { oldValue: false, newValue: true } }, 'sync');
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 2.5 } }));
      await vi.advanceTimersByTimeAsync(1100);

      expect(events.map((event) => event.detail?.type)).toEqual(['VSC_TEARDOWN']);
      expect(getMockLocalStorage()[`vsc:lastSpeed:${location.origin}`]).toBeUndefined();
    });

    it('does NOT teardown on blacklist changes (takes effect on reload)', async () => {
      const onChanged = await loadBridge();
      const { events, cleanup } = collectEvents('VSC_MESSAGE');
      eventCleanup = cleanup;

      onChanged({ blacklist: { oldValue: '', newValue: 'localhost' } }, 'sync');
      expect(events.filter((e) => e.detail?.type === 'VSC_TEARDOWN')).toHaveLength(0);
    });

    it('does NOT teardown on siteRules changes (takes effect on reload)', async () => {
      const onChanged = await loadBridge();
      const { events, cleanup } = collectEvents('VSC_MESSAGE');
      eventCleanup = cleanup;

      onChanged(
        { siteRules: { oldValue: [], newValue: [{ pattern: 'localhost', enabled: false }] } },
        'sync'
      );
      expect(events.filter((e) => e.detail?.type === 'VSC_TEARDOWN')).toHaveLength(0);
    });

    it('does NOT teardown on unrelated storage changes', async () => {
      const onChanged = await loadBridge();
      const { events, cleanup } = collectEvents('VSC_MESSAGE');
      eventCleanup = cleanup;

      onChanged({ lastSpeed: { oldValue: 1.0, newValue: 2.0 } }, 'sync');
      expect(events.filter((e) => e.detail?.type === 'VSC_TEARDOWN')).toHaveLength(0);
    });

    it('ignores non-sync namespace changes', async () => {
      const onChanged = await loadBridge();
      const { events, cleanup } = collectEvents('VSC_MESSAGE', 'VSC_STORAGE_CHANGED');
      eventCleanup = cleanup;

      onChanged({ enabled: { oldValue: true, newValue: false } }, 'local');
      expect(events).toHaveLength(0);
    });
  });

  // =========================================================================
  // Storage relay — changes forwarded to MAIN world with filtering
  // =========================================================================

  describe('storage relay', () => {
    it('relays only functional settings to MAIN world', async () => {
      const onChanged = await loadBridge();
      const { events, cleanup } = collectEvents('VSC_STORAGE_CHANGED');
      eventCleanup = cleanup;
      await requestSettings();

      onChanged(
        {
          lastSpeed: { oldValue: 1.0, newValue: 2.0 },
          siteRules: { oldValue: [], newValue: [{ pattern: 'localhost', enabled: false }] },
          enabled: { oldValue: true, newValue: true },
          blacklist: { oldValue: '', newValue: '' },
          customCSS: { oldValue: '', newValue: 'vsc-controller { top: 4px; }' },
        },
        'sync'
      );

      expect(events).toHaveLength(1);
      expect(events[0].detail.lastSpeed).toBeUndefined();
      expect(events[0].detail.siteRules).toBeUndefined();
      expect(events[0].detail.enabled).toBeUndefined();
      expect(events[0].detail.blacklist).toBeUndefined();
      expect(events[0].detail.customCSS.newValue).toBe('vsc-controller { top: 4px; }');
    });
  });

  // Runtime relay shares the bridgeActive gate covered by the write and
  // lifecycle tests above; end-to-end coverage verifies the full teardown.
});
