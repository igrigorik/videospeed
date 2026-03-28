/**
 * Unit tests for injection-bridge.js
 * Validates bridge message handling, input validation, and context lifecycle
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { setupMessageBridge } from '../../../src/content/injection-bridge.js';

let bridge;

describe('InjectionBridge', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    chrome.runtime.sendMessage = () => {};
  });

  afterEach(() => {
    if (bridge) {
      bridge.cleanup();
    }
    bridge = null;
    cleanupChromeMock();
  });

  /**
   * Dispatch a MessageEvent as if from the page context (injected script).
   * JSDOM doesn't support `source` in MessageEvent constructor, so we set it manually.
   */
  function postPageMessage(action, data) {
    const event = new MessageEvent('message', {
      data: { source: 'vsc-page', action, data },
    });
    Object.defineProperty(event, 'source', { value: window });
    window.dispatchEvent(event);
  }

  // --- set-speed verb ---

  it('set-speed writes clamped lastSpeed to chrome.storage', () => {
    let setData = null;
    chrome.storage.sync.set = (data) => {
      setData = data;
    };

    bridge = setupMessageBridge();
    postPageMessage('set-speed', { speed: 2.5 });

    expect(setData).toEqual({ lastSpeed: 2.5 });
  });

  it('set-speed clamps speed to minimum (0.07)', () => {
    let setData = null;
    chrome.storage.sync.set = (data) => {
      setData = data;
    };

    bridge = setupMessageBridge();
    postPageMessage('set-speed', { speed: 0.01 });

    expect(setData).toEqual({ lastSpeed: 0.07 });
  });

  it('set-speed clamps speed to maximum (16)', () => {
    let setData = null;
    chrome.storage.sync.set = (data) => {
      setData = data;
    };

    bridge = setupMessageBridge();
    postPageMessage('set-speed', { speed: 100 });

    expect(setData).toEqual({ lastSpeed: 16 });
  });

  it('set-speed requires a numeric value', () => {
    let setCalled = false;
    chrome.storage.sync.set = () => {
      setCalled = true;
    };

    bridge = setupMessageBridge();
    postPageMessage('set-speed', { speed: 'fast' });

    expect(setCalled).toBe(false);
  });

  it('set-speed requires a finite value', () => {
    let setCalled = false;
    chrome.storage.sync.set = () => {
      setCalled = true;
    };

    bridge = setupMessageBridge();
    postPageMessage('set-speed', { speed: NaN });
    expect(setCalled).toBe(false);

    postPageMessage('set-speed', { speed: Infinity });
    expect(setCalled).toBe(false);
  });

  it('set-speed requires data to be present', () => {
    let setCalled = false;
    chrome.storage.sync.set = () => {
      setCalled = true;
    };

    bridge = setupMessageBridge();
    postPageMessage('set-speed', null);

    expect(setCalled).toBe(false);
  });

  // --- Only set-speed is accepted from page context ---

  it('only accepts the set-speed action', () => {
    let setCalled = false;
    let sendCalled = false;
    let getCalled = false;
    chrome.storage.sync.set = () => { setCalled = true; };
    chrome.storage.sync.get = () => { getCalled = true; };
    chrome.runtime.sendMessage = () => { sendCalled = true; };

    bridge = setupMessageBridge();

    postPageMessage('storage-update', { lastSpeed: 2.5 });
    postPageMessage('runtime-message', { type: 'EXTENSION_TOGGLE', enabled: false });
    postPageMessage('get-storage', {});
    postPageMessage('something-else', { payload: 'data' });

    expect(setCalled).toBe(false);
    expect(sendCalled).toBe(false);
    expect(getCalled).toBe(false);
  });

  // --- Context invalidation ---

  it('Extension context invalidated removes the message listener', () => {
    chrome.storage.sync.set = () => {
      throw new Error('Extension context invalidated');
    };

    bridge = setupMessageBridge();

    // First message triggers invalidation — listener should self-remove
    postPageMessage('set-speed', { speed: 2.0 });

    // Replace with a tracking mock — if listener was removed, this won't fire
    let calledAfter = false;
    chrome.storage.sync.set = () => {
      calledAfter = true;
    };

    postPageMessage('set-speed', { speed: 3.0 });

    expect(calledAfter).toBe(false);
  });

  it('non-invalidation errors keep the listener alive', () => {
    let callCount = 0;
    chrome.storage.sync.set = () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
      }
    };

    bridge = setupMessageBridge();

    postPageMessage('set-speed', { speed: 2.0 });
    postPageMessage('set-speed', { speed: 3.0 });

    expect(callCount).toBe(2);
  });

  // --- Message source filtering ---

  it('requires vsc-page source prefix', () => {
    let setCalled = false;
    chrome.storage.sync.set = () => {
      setCalled = true;
    };

    bridge = setupMessageBridge();

    const event = new MessageEvent('message', {
      data: { source: 'other', action: 'set-speed', data: { speed: 2.0 } },
    });
    Object.defineProperty(event, 'source', { value: window });
    window.dispatchEvent(event);

    expect(setCalled).toBe(false);
  });

  it('only processes messages from vsc-page, not vsc-content', () => {
    let setCalled = false;
    chrome.storage.sync.set = () => {
      setCalled = true;
    };

    bridge = setupMessageBridge();

    const event = new MessageEvent('message', {
      data: { source: 'vsc-content', action: 'set-speed', data: { speed: 2.0 } },
    });
    Object.defineProperty(event, 'source', { value: window });
    window.dispatchEvent(event);

    expect(setCalled).toBe(false);
  });

  // --- sendCommand API ---

  it('sendCommand dispatches VSC_MESSAGE CustomEvent to page context', () => {
    bridge = setupMessageBridge();

    let received = null;
    window.addEventListener(
      'VSC_MESSAGE',
      (event) => {
        received = event.detail;
      },
      { once: true }
    );

    bridge.sendCommand('VSC_TEARDOWN');

    expect(received).toBeDefined();
    expect(received.type).toBe('VSC_TEARDOWN');
  });

  it('sendCommand includes payload when provided', () => {
    bridge = setupMessageBridge();

    let received = null;
    window.addEventListener(
      'VSC_MESSAGE',
      (event) => {
        received = event.detail;
      },
      { once: true }
    );

    bridge.sendCommand('VSC_SET_SPEED', { speed: 2.0 });

    expect(received).toBeDefined();
    expect(received.payload.speed).toBe(2.0);
  });
});
