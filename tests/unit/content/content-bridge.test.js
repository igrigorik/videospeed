/**
 * Tests for content-bridge.js (ISOLATED world bridge).
 *
 * The bridge is the trust boundary between extension storage and the page, so
 * these tests assert on what actually crosses it — the CustomEvents a page can
 * read and the storage writes a page can cause:
 *   - Whether VSC runs on the document, and the bare abort when it does not
 *   - The handshake answer: one initial speed plus the runtime preferences
 *   - Remembering a speed: only when the user's own stored setting allows it
 *   - Lifecycle: disable tears down; re-enable waits for reload
 *   - Relays: preference changes and popup commands, and nothing else
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
} from '../../helpers/chrome-mock.js';

const docEl = document.documentElement;

const RUNTIME_SETTINGS_KEYS = [
  'initialSpeed',
  'rememberSpeed',
  'exclusiveKeys',
  'audioBoolean',
  'startHidden',
  'controllerOpacity',
  'controllerButtonSize',
  'customCSS',
  'keyBindings',
  'logLevel',
];

// --- Minimal test infrastructure ---

/**
 * MV3 bridge uses promise-returning chrome.storage calls — wrap the callback
 * mock. Returns a function that puts the callback versions back.
 */
function promisifyChromeMock() {
  const { sync } = globalThis.chrome.storage;
  const original = { get: sync.get, set: sync.set };
  for (const method of ['get', 'set']) {
    sync[method] = (arg, callback) =>
      typeof callback === 'function'
        ? original[method](arg, callback)
        : new Promise((resolve) => original[method](arg, resolve));
  }
  return () => Object.assign(sync, original);
}

/** Track docEl listeners so afterEach can remove bridge- and test-registered ones. */
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

/** Replace sync storage with exactly `values`. */
function store(values) {
  const storage = getMockStorage();
  Object.keys(storage).forEach((key) => delete storage[key]);
  Object.assign(storage, values);
}

/**
 * Load a fresh bridge. Returns the listeners it registered with chrome, so a
 * test can play chrome's part: `onChanged(changes, areaName)` delivers a
 * storage change and `onMessage(request)` a runtime message.
 */
async function loadBridge() {
  const listeners = {};
  const capture = (name, event) => {
    const original = event.addListener;
    event.addListener = (listener) => {
      listeners[name] = listener;
      original(listener);
    };
    return () => {
      event.addListener = original;
    };
  };
  const restore = [
    capture('onChanged', globalThis.chrome.storage.onChanged),
    capture('onMessage', globalThis.chrome.runtime.onMessage),
  ];

  vi.resetModules();
  await import('../../../src/entries/content-bridge.js');
  await vi.advanceTimersByTimeAsync(60);

  restore.forEach((undo) => undo());
  return listeners;
}

/** Load a bridge whose startup read stays pending until `resolveRead(snapshot)`. */
async function loadBridgeWithPendingRead() {
  let resolve;
  vi.spyOn(globalThis.chrome.storage.sync, 'get').mockImplementation(
    () =>
      new Promise((resolveGet) => {
        resolve = resolveGet;
      })
  );
  const listeners = await loadBridge();
  const resolveRead = async (snapshot) => {
    resolve(snapshot);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { ...listeners, resolveRead };
}

/** Record CustomEvents on docEl as `{ type, detail }`, in order. */
function collectEvents(...names) {
  const events = [];
  for (const name of names) {
    docEl.addEventListener(name, (e) => events.push({ type: name, detail: e.detail }));
  }
  return events;
}

async function requestSettings() {
  docEl.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));
  await vi.advanceTimersByTimeAsync(0);
}

/** Load a bridge and complete the handshake. Returns what the page was told. */
async function handshake() {
  const answers = collectEvents('VSC_SETTINGS_READY');
  const listeners = await loadBridge();
  await requestSettings();
  expect(answers).toHaveLength(1);
  return { ...listeners, detail: answers[0].detail };
}

/** Ask, as a page would, for a speed to be remembered. */
async function requestRemember(detail) {
  docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail }));
  await vi.advanceTimersByTimeAsync(20);
}

/** Run the bridge in a document at `href` instead of jsdom's http://localhost/. */
function visit(href) {
  vi.stubGlobal('location', new URL(href));
}

// --- Tests ---

describe('content-bridge', () => {
  let restoreChromeMock = null;
  let cleanupIntercept = null;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installChromeMock();
    resetMockStorage();
    restoreChromeMock = promisifyChromeMock();
    cleanupIntercept = interceptDocEl();
    // Every test states the profile it needs; the baseline is a fresh install.
    store({});
  });

  afterEach(() => {
    cleanupIntercept();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreChromeMock();
    vi.useRealTimers();
    cleanupChromeMock();
  });

  // =========================================================================
  // Whether VSC runs on the document. When it does not, the page learns
  // exactly that and nothing else.
  // =========================================================================

  describe('whether VSC runs on the document', () => {
    it('aborts when the extension is disabled', async () => {
      store({ enabled: false, customCSS: 'vsc-controller { top: 4px; }' });

      expect((await handshake()).detail).toEqual({ abort: true });
    });

    it('aborts on a site the user disabled', async () => {
      // jsdom's URL is http://localhost/
      store({ siteRules: [{ pattern: 'localhost', enabled: false, speed: null }] });

      expect((await handshake()).detail).toEqual({ abort: true });
    });

    it('matches site rules against the URL of its own frame', async () => {
      visit('https://player.example/embed/42');
      store({ siteRules: [{ pattern: 'player.example/embed', enabled: false, speed: null }] });

      expect((await handshake()).detail).toEqual({ abort: true });
    });

    it('aborts on a site in a legacy blacklist', async () => {
      store({ blacklist: 'other.example\nlocalhost' });

      expect((await handshake()).detail).toEqual({ abort: true });
    });

    it('ignores the legacy blacklist once site rules are saved', async () => {
      // The blacklist key stays in storage for older synced versions, but a
      // site removed from the rules must not remain blocked by it.
      store({ blacklist: 'localhost', siteRules: [] });

      expect((await handshake()).detail.abort).toBeUndefined();
    });

    it('matches blacklist entries on domain boundaries', async () => {
      // A raw RegExp('x.com') would match netflix.com.
      visit('https://netflix.com/browse');
      store({ blacklist: 'x.com' });

      expect((await handshake()).detail.abort).toBeUndefined();
    });

    it('aborts on a default-disabled site when nothing was ever saved', async () => {
      visit('https://imgur.com/gallery/abc');

      expect((await handshake()).detail).toEqual({ abort: true });
    });

    it('runs on a default-disabled site once the user saved rules without it', async () => {
      visit('https://imgur.com/gallery/abc');
      store({ siteRules: [] });

      expect((await handshake()).detail.abort).toBeUndefined();
    });

    it.each(['about:blank', 'about:BLANK', 'about:blank#child', 'about:srcdoc'])(
      'fails closed in inherited frame %s',
      async (href) => {
        visit(href);

        expect((await handshake()).detail).toEqual({ abort: true });
      }
    );

    it('fails closed when the startup read fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(globalThis.chrome.storage.sync, 'get').mockRejectedValue(
        new Error('storage unavailable')
      );

      expect((await handshake()).detail).toEqual({ abort: true });
    });
  });

  // =========================================================================
  // Settings handshake — what the page is told when VSC does run
  // =========================================================================

  describe('settings handshake', () => {
    it('answers with one initial speed and the runtime preferences', async () => {
      store({ rememberSpeed: true, lastSpeed: 2.5, startHidden: true });

      const { detail } = await handshake();

      expect(Object.keys(detail)).toEqual(['settings']);
      expect(Object.keys(detail.settings)).toEqual(RUNTIME_SETTINGS_KEYS);
      expect(detail.settings).toMatchObject({
        initialSpeed: 2.5,
        rememberSpeed: true,
        startHidden: true,
        audioBoolean: true,
        customCSS: '',
      });
    });

    it('keeps site rules, the blacklist, and unclassified keys to itself', async () => {
      store({
        siteRules: [
          { pattern: 'private-health.example', enabled: false, speed: null },
          { pattern: 'localhost', enabled: true, speed: 2, note: 'private' },
        ],
        blacklist: 'private-legacy.example',
        lastSpeed: 1.5,
        schemaVersion: 2,
        somethingNew: 'private',
      });

      const { detail } = await handshake();

      expect(detail.settings.initialSpeed).toBe(2);
      expect(JSON.stringify(detail)).not.toContain('private');
    });

    it('tells the page the same thing whatever the private settings are', async () => {
      const visible = { rememberSpeed: true, exclusiveKeys: true };
      const binding = { action: 'faster', code: 'KeyD', value: 0.25, modifiers: { shift: true } };

      store({
        ...visible,
        keyBindings: [binding],
        lastSpeed: 2,
        siteRules: [{ pattern: 'private-health.example', enabled: false, speed: null }],
      });
      const one = await handshake();

      store({
        ...visible,
        keyBindings: [
          {
            displayKey: 'D',
            note: { nested: 'private' },
            modifiers: { alt: 0, shift: 1 },
            ...binding,
          },
        ],
        lastSpeed: 1.5,
        siteRules: [
          { pattern: '/private-bank\\.example/i', enabled: true, speed: 3 },
          { pattern: 'localhost', enabled: true, speed: 2 },
        ],
        blacklist: 'private-legacy.example',
      });
      const other = await handshake();

      // Compared as JSON: that is what crosses to the page, and toEqual would
      // ignore key order and undefined-valued properties.
      expect(JSON.stringify(other.detail)).toBe(JSON.stringify(one.detail));
    });

    it('still answers when a saved rule is malformed', async () => {
      store({
        siteRules: [null, { pattern: 42 }, { pattern: 'localhost', enabled: true, speed: 2 }],
      });

      expect((await handshake()).detail.settings.initialSpeed).toBe(2);
    });

    it('does not reveal a remembered speed that is not in use', async () => {
      store({ rememberSpeed: false, lastSpeed: 2.5 });

      expect((await handshake()).detail.settings.initialSpeed).toBeNull();
    });

    it('answers a request made while the startup read is pending', async () => {
      const answers = collectEvents('VSC_SETTINGS_READY');
      const { resolveRead } = await loadBridgeWithPendingRead();

      await requestSettings();
      expect(answers).toHaveLength(0);

      await resolveRead({ rememberSpeed: true, lastSpeed: 2.5 });
      expect(answers).toHaveLength(1);
      expect(answers[0].detail.settings.initialSpeed).toBe(2.5);
    });

    it('answers from the latest state when a setting changes before the request', async () => {
      const answers = collectEvents('VSC_SETTINGS_READY');
      const { onChanged, resolveRead } = await loadBridgeWithPendingRead();

      // One change outruns the startup read, one lands after it.
      onChanged({ customCSS: { newValue: 'vsc-controller { top: 4px; }' } }, 'sync');
      await resolveRead({ startHidden: false });
      onChanged({ startHidden: { oldValue: false, newValue: true } }, 'sync');
      await requestSettings();

      expect(answers[0].detail.settings).toMatchObject({
        customCSS: 'vsc-controller { top: 4px; }',
        startHidden: true,
      });
    });

    it('honors a site rule saved before the request', async () => {
      const answers = collectEvents('VSC_SETTINGS_READY');
      const { onChanged } = await loadBridge();

      onChanged(
        { siteRules: { newValue: [{ pattern: 'localhost', enabled: false, speed: null }] } },
        'sync'
      );
      await requestSettings();

      expect(answers).toEqual([{ type: 'VSC_SETTINGS_READY', detail: { abort: true } }]);
    });

    it('answers once', async () => {
      const answers = collectEvents('VSC_SETTINGS_READY');
      await loadBridge();

      await requestSettings();
      await requestSettings();

      expect(answers).toHaveLength(1);
    });

    it('keeps a pre-handshake disable sticky across rapid re-enable', async () => {
      const events = collectEvents('VSC_SETTINGS_READY', 'VSC_MESSAGE');
      const { onChanged, resolveRead } = await loadBridgeWithPendingRead();

      await requestSettings();
      onChanged({ enabled: { oldValue: true, newValue: false } }, 'sync');
      onChanged({ enabled: { oldValue: false, newValue: true } }, 'sync');
      await resolveRead({ enabled: true });

      expect(events).toEqual([
        { type: 'VSC_MESSAGE', detail: { type: 'VSC_TEARDOWN' } },
        { type: 'VSC_SETTINGS_READY', detail: { abort: true } },
      ]);
    });
  });

  // =========================================================================
  // Remembering a speed — the one write a page can ask for. The user's own
  // stored setting decides; nothing the page says can.
  // =========================================================================

  describe('remembering a speed', () => {
    it('stores the speed when the user asked VSC to remember', async () => {
      store({ rememberSpeed: true });
      await handshake();

      await requestRemember({ lastSpeed: 2.5 });

      expect(getMockStorage().lastSpeed).toBe(2.5);
    });

    it.each([
      [0.01, 0.07],
      [99, 16],
      [1.234567891234567, 1.23],
    ])('stores %o as %o: clamped, with the two decimals VSC keeps', async (asked, stored) => {
      store({ rememberSpeed: true });
      await handshake();

      await requestRemember({ lastSpeed: asked });

      expect(getMockStorage().lastSpeed).toBe(stored);
    });

    it.each([
      ['a word', { lastSpeed: 'fast' }],
      ['NaN', { lastSpeed: NaN }],
      ['zero', { lastSpeed: 0 }],
      ['a negative number', { lastSpeed: -1 }],
      ['another setting', { startHidden: true, rememberSpeed: false }],
      ['nothing', null],
    ])('ignores a request carrying %s', async (_label, detail) => {
      store({ rememberSpeed: true });
      const set = vi.spyOn(globalThis.chrome.storage.sync, 'set');
      await handshake();

      await requestRemember(detail);

      expect(set).not.toHaveBeenCalled();
    });

    it('refuses when the user did not ask VSC to remember', async () => {
      store({ rememberSpeed: false });
      const set = vi.spyOn(globalThis.chrome.storage.sync, 'set');
      await handshake();

      // A page can claim the preference changed. The bridge reads storage.
      docEl.dispatchEvent(
        new CustomEvent('VSC_STORAGE_CHANGED', { detail: { rememberSpeed: { newValue: true } } })
      );
      await requestRemember({ lastSpeed: 2.5 });

      expect(set).not.toHaveBeenCalled();
    });

    it('follows the stored setting as the user changes it', async () => {
      const { onChanged } = await handshake();

      onChanged({ rememberSpeed: { newValue: true } }, 'sync');
      await requestRemember({ lastSpeed: 2.5 });
      expect(getMockStorage().lastSpeed).toBe(2.5);

      // Removing the key returns the preference to its default: off.
      onChanged({ rememberSpeed: { oldValue: true } }, 'sync');
      await requestRemember({ lastSpeed: 3 });
      expect(getMockStorage().lastSpeed).toBe(2.5);
    });

    it('refuses before the handshake', async () => {
      store({ rememberSpeed: true });
      const set = vi.spyOn(globalThis.chrome.storage.sync, 'set');
      await loadBridge();

      await requestRemember({ lastSpeed: 2.5 });

      expect(set).not.toHaveBeenCalled();
    });

    it('contains a storage failure', async () => {
      store({ rememberSpeed: true });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(globalThis.chrome.storage.sync, 'set').mockRejectedValue(new Error('QUOTA'));
      await handshake();

      await requestRemember({ lastSpeed: 2.5 });

      expect(warn).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // Lifecycle — disable tears down; re-enable waits for reload
  // =========================================================================

  describe('lifecycle', () => {
    // Disable tears down immediately. Re-enable, siteRules, and blacklist
    // changes take effect on reload, matching the popup's user-facing contract.
    const teardowns = (events) => events.filter((e) => e.detail?.type === 'VSC_TEARDOWN');

    it('dispatches VSC_TEARDOWN when disabled via popup toggle', async () => {
      const events = collectEvents('VSC_MESSAGE');
      const { onChanged } = await loadBridge();

      onChanged({ enabled: { oldValue: true, newValue: false } }, 'sync');

      expect(teardowns(events)).toHaveLength(1);
    });

    it('stays inactive after re-enable until the page reloads', async () => {
      store({ rememberSpeed: true });
      const events = collectEvents('VSC_MESSAGE', 'VSC_STORAGE_CHANGED');
      const set = vi.spyOn(globalThis.chrome.storage.sync, 'set');
      const { onChanged, onMessage } = await handshake();

      onChanged({ enabled: { oldValue: true, newValue: false } }, 'sync');
      onChanged({ enabled: { oldValue: false, newValue: true } }, 'sync');
      onChanged({ startHidden: { newValue: true } }, 'sync');
      onMessage({ type: 'VSC_RESET_SPEED' });
      await requestRemember({ lastSpeed: 2.5 });

      expect(events).toEqual([{ type: 'VSC_MESSAGE', detail: { type: 'VSC_TEARDOWN' } }]);
      expect(set).not.toHaveBeenCalled();
    });

    it.each([
      ['blacklist', { blacklist: { oldValue: '', newValue: 'localhost' } }],
      [
        'siteRules',
        { siteRules: { oldValue: [], newValue: [{ pattern: 'localhost', enabled: false }] } },
      ],
      ['unrelated storage', { lastSpeed: { oldValue: 1.0, newValue: 2.0 } }],
    ])('does NOT teardown on %s changes (takes effect on reload)', async (_label, changes) => {
      const events = collectEvents('VSC_MESSAGE');
      const { onChanged } = await handshake();

      onChanged(changes, 'sync');

      expect(events).toHaveLength(0);
    });

    it('ignores non-sync namespace changes', async () => {
      const events = collectEvents('VSC_MESSAGE', 'VSC_STORAGE_CHANGED');
      const { onChanged } = await handshake();

      onChanged({ enabled: { oldValue: true, newValue: false } }, 'local');
      onChanged({ startHidden: { newValue: true } }, 'local');

      expect(events).toHaveLength(0);
    });
  });

  // =========================================================================
  // Storage relay — the page hears about changed runtime preferences only
  // =========================================================================

  describe('storage relay', () => {
    const binding = { action: 'faster', code: 'KeyD', value: 0.1, displayKey: 'd' };

    it('relays a changed preference with its new value only', async () => {
      store({ customCSS: 'vsc-controller { top: 4px; }' });
      const events = collectEvents('VSC_STORAGE_CHANGED');
      const { onChanged } = await handshake();

      onChanged({ customCSS: { oldValue: 'vsc-controller { top: 4px; }', newValue: '' } }, 'sync');

      expect(events).toEqual([
        { type: 'VSC_STORAGE_CHANGED', detail: { customCSS: { newValue: '' } } },
      ]);
    });

    it('relays only the preferences out of a mixed change', async () => {
      const events = collectEvents('VSC_STORAGE_CHANGED');
      const { onChanged } = await handshake();

      onChanged(
        {
          startHidden: { oldValue: false, newValue: true },
          lastSpeed: { oldValue: 1.0, newValue: 2.0 },
          siteRules: { newValue: [{ pattern: 'private.example', enabled: false }] },
        },
        'sync'
      );

      expect(events).toEqual([
        { type: 'VSC_STORAGE_CHANGED', detail: { startHidden: { newValue: true } } },
      ]);
    });

    it('relays nothing for settings the page may not see', async () => {
      const events = collectEvents('VSC_STORAGE_CHANGED');
      const { onChanged } = await handshake();

      onChanged(
        {
          lastSpeed: { oldValue: 1.0, newValue: 2.0 },
          siteRules: { newValue: [{ pattern: 'localhost', enabled: true, speed: 3 }] },
          blacklist: { newValue: 'private.example' },
          schemaVersion: { newValue: 2 },
          somethingNew: { newValue: 'private' },
        },
        'sync'
      );

      expect(events).toHaveLength(0);
    });

    it('relays nothing when a preference keeps its meaning', async () => {
      store({ keyBindings: [binding], controllerOpacity: 0.5 });
      const events = collectEvents('VSC_STORAGE_CHANGED');
      const { onChanged } = await handshake();

      onChanged(
        {
          keyBindings: { newValue: [{ ...binding, displayKey: 'D', predefined: true }] },
          controllerOpacity: { oldValue: 0.5, newValue: '0.5' },
        },
        'sync'
      );

      expect(events).toHaveLength(0);
    });

    it('relays the default once when a saved preference is removed', async () => {
      store({ audioBoolean: false });
      const events = collectEvents('VSC_STORAGE_CHANGED');
      const { onChanged } = await handshake();

      onChanged({ audioBoolean: { oldValue: false } }, 'sync');
      onChanged({ audioBoolean: {} }, 'sync');

      expect(events).toEqual([
        { type: 'VSC_STORAGE_CHANGED', detail: { audioBoolean: { newValue: true } } },
      ]);
    });

    it('relays nothing before the handshake', async () => {
      const events = collectEvents('VSC_STORAGE_CHANGED');
      const { onChanged } = await loadBridge();

      onChanged({ startHidden: { oldValue: false, newValue: true } }, 'sync');

      expect(events).toHaveLength(0);
    });
  });

  // =========================================================================
  // Popup commands — rebuilt from their known fields, never forwarded
  // =========================================================================

  describe('popup commands', () => {
    it.each([
      [{ type: 'VSC_SET_SPEED', payload: { speed: 2 } }],
      [{ type: 'VSC_ADJUST_SPEED', payload: { delta: -0.1 } }],
      [{ type: 'VSC_RESET_SPEED' }],
      [{ type: 'VSC_TOGGLE_DISPLAY' }],
    ])('relays %o', async (command) => {
      const events = collectEvents('VSC_MESSAGE');
      const { onMessage } = await handshake();

      onMessage(command);

      expect(events).toEqual([{ type: 'VSC_MESSAGE', detail: command }]);
    });

    it('drops every field a command does not carry', async () => {
      const events = collectEvents('VSC_MESSAGE');
      const { onMessage } = await handshake();

      onMessage({
        type: 'VSC_SET_SPEED',
        payload: { speed: 2, note: 'private' },
        settings: { siteRules: ['private.example'] },
      });
      onMessage({ type: 'VSC_RESET_SPEED', payload: { note: 'private' } });

      expect(events.map((event) => event.detail)).toEqual([
        { type: 'VSC_SET_SPEED', payload: { speed: 2 } },
        { type: 'VSC_RESET_SPEED' },
      ]);
    });

    it.each([
      ['an unknown type', { type: 'VSC_EXPORT_SETTINGS' }],
      ['a teardown, which only the bridge issues', { type: 'VSC_TEARDOWN' }],
      ['a type that is not a string', { type: ['VSC_RESET_SPEED'] }],
      ['a speed that is not a number', { type: 'VSC_SET_SPEED', payload: { speed: 'fast' } }],
      ['a missing payload', { type: 'VSC_ADJUST_SPEED' }],
      ['no type', { payload: { speed: 2 } }],
      ['nothing', null],
    ])('relays nothing for %s', async (_label, request) => {
      const events = collectEvents('VSC_MESSAGE');
      const { onMessage } = await handshake();

      onMessage(request);

      expect(events).toHaveLength(0);
    });

    it('relays nothing before the handshake', async () => {
      const events = collectEvents('VSC_MESSAGE');
      const { onMessage } = await loadBridge();

      onMessage({ type: 'VSC_RESET_SPEED' });

      expect(events).toHaveLength(0);
    });
  });
});
