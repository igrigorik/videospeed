/**
 * Unit tests for VideoSpeedConfig in MAIN world, where it holds only the
 * runtime settings the content bridge resolved for the document.
 *
 * The global vitest-setup.js loads every module with the chrome mock in place,
 * so the shared config uses the extension-page path. To reach the MAIN world
 * path these tests remove chrome and re-import storage-manager.js and
 * settings.js, the same way storage-manager-main-world.test.js does.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installChromeMock } from '../../helpers/chrome-mock.js';

const docEl = document.documentElement;

const RUNTIME_KEYS = [
  'rememberSpeed',
  'exclusiveKeys',
  'audioBoolean',
  'startHidden',
  'controllerOpacity',
  'controllerButtonSize',
  'customCSS',
  'keyBindings',
  'logLevel',
  'lastSpeed',
];

/** Play the bridge: answer the next settings request with `detail`. */
function answerWith(detail) {
  const responder = () => {
    docEl.dispatchEvent(new CustomEvent('VSC_SETTINGS_READY', { detail }));
  };
  docEl.addEventListener('VSC_REQUEST_SETTINGS', responder, { once: true });
}

describe('VideoSpeedConfig — MAIN world (runtime settings)', () => {
  const shared = {};
  let VideoSpeedConfig;

  beforeEach(async () => {
    // Stash the chrome-backed modules and force a fresh, chrome-less evaluation.
    for (const name of ['StorageManager', 'VideoSpeedConfig', 'videoSpeedConfig']) {
      shared[name] = window.VSC[name];
      delete window.VSC[name];
    }
    delete globalThis.chrome;

    vi.resetModules();
    await import('../../../src/core/storage-manager.js');
    await import('../../../src/core/settings.js');

    VideoSpeedConfig = window.VSC.VideoSpeedConfig;
  });

  afterEach(() => {
    installChromeMock();
    Object.assign(window.VSC, shared);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts with the runtime defaults and no speed opinion', () => {
    const { settings } = new VideoSpeedConfig();

    expect(Object.keys(settings).sort()).toEqual([...RUNTIME_KEYS].sort());
    expect(settings.lastSpeed).toBeNull();
    expect(settings.audioBoolean).toBe(true);
  });

  it("adopts the bridge's answer, with the initial speed as its authority", async () => {
    const config = new VideoSpeedConfig();
    answerWith({
      settings: { initialSpeed: 2, startHidden: true, customCSS: 'vsc-controller {}' },
    });

    const settings = await config.load();

    expect(settings).toBe(config.settings);
    expect(Object.keys(settings).sort()).toEqual([...RUNTIME_KEYS].sort());
    expect(settings).toMatchObject({
      lastSpeed: 2,
      startHidden: true,
      customCSS: 'vsc-controller {}',
      rememberSpeed: false,
    });
  });

  it('keeps nothing from an answer beyond the runtime settings', async () => {
    const config = new VideoSpeedConfig();
    answerWith({
      settings: {
        initialSpeed: 1.5,
        siteRules: [{ pattern: 'private.example', enabled: false, speed: null }],
        blacklist: 'private.example',
        enabled: true,
        somethingNew: 'private',
      },
    });

    await config.load();

    expect(Object.keys(config.settings).sort()).toEqual([...RUNTIME_KEYS].sort());
    expect(JSON.stringify(config.settings)).not.toContain('private');
  });

  it('falls back field by field when an answer is malformed', async () => {
    const config = new VideoSpeedConfig();
    answerWith({ settings: { initialSpeed: 'fast', controllerOpacity: {}, startHidden: true } });

    await config.load();

    expect(config.settings).toMatchObject({
      lastSpeed: null,
      controllerOpacity: 0.3,
      startHidden: true,
    });
  });

  it('aborts when the bridge says VSC is off for the document', async () => {
    const config = new VideoSpeedConfig();
    answerWith({ abort: true });

    await expect(config.load()).resolves.toBeUndefined();
    expect(config.settings._abort).toBe(true);
  });

  it('asks storage for nothing while loading', async () => {
    const writes = vi.fn();
    docEl.addEventListener('VSC_WRITE_STORAGE', writes);
    const config = new VideoSpeedConfig();
    // An empty binding list makes the extension-page loader save defaults.
    answerWith({ settings: { initialSpeed: 2, keyBindings: [] } });

    await config.load();

    expect(writes).not.toHaveBeenCalled();
    docEl.removeEventListener('VSC_WRITE_STORAGE', writes);
  });

  it('follows relayed preference changes but never a remote lastSpeed', async () => {
    const config = new VideoSpeedConfig();
    answerWith({ settings: { initialSpeed: 2 } });
    await config.load();

    docEl.dispatchEvent(
      new CustomEvent('VSC_STORAGE_CHANGED', {
        detail: { startHidden: { newValue: true }, lastSpeed: { newValue: 3 } },
      })
    );

    expect(config.settings.startHidden).toBe(true);
    expect(config.settings.lastSpeed).toBe(2);
  });

  it('asks the bridge to remember a speed the user chose', async () => {
    vi.useFakeTimers();
    const requests = [];
    const onWrite = (event) => requests.push(event.detail);
    docEl.addEventListener('VSC_WRITE_STORAGE', onWrite);
    const config = new VideoSpeedConfig();
    answerWith({ settings: { initialSpeed: null, rememberSpeed: true } });
    await config.load();

    config.persistAuthority(1.75);
    await vi.advanceTimersByTimeAsync(config.SAVE_DELAY);

    expect(config.settings.lastSpeed).toBe(1.75);
    expect(requests).toEqual([{ lastSpeed: 1.75 }]);
    docEl.removeEventListener('VSC_WRITE_STORAGE', onWrite);
  });
});
