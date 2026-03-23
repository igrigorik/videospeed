/**
 * Unit tests for injection-bridge.js
 * Focused on the context invalidation fix and core message forwarding
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert, wait } from '../../helpers/test-utils.js';
import { setupMessageBridge } from '../../../src/content/injection-bridge.js';

const runner = new SimpleTestRunner();
let bridge;

runner.beforeEach(() => {
  installChromeMock();
  resetMockStorage();
  chrome.runtime.sendMessage = () => {};
});

runner.afterEach(() => {
  if (bridge) bridge.cleanup();
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

// --- Core forwarding ---

runner.test('storage-update forwards to chrome.storage.sync.set', async () => {
  let setData = null;
  chrome.storage.sync.set = (data) => { setData = data; };

  bridge = setupMessageBridge();
  postPageMessage('storage-update', { lastSpeed: 2.5 });
  await wait(20);

  assert.exists(setData, 'chrome.storage.sync.set should have been called');
  assert.equal(setData.lastSpeed, 2.5, 'should forward the correct data');
});

runner.test('runtime-message filters out VSC_STATE_UPDATE', async () => {
  let sendCalled = false;
  chrome.runtime.sendMessage = () => { sendCalled = true; };

  bridge = setupMessageBridge();
  postPageMessage('runtime-message', { type: 'VSC_STATE_UPDATE' });
  await wait(20);

  assert.false(sendCalled, 'VSC_STATE_UPDATE should not be forwarded');
});

// --- Context invalidation (the actual fix) ---

runner.test('Extension context invalidated removes the message listener', async () => {
  chrome.storage.sync.set = () => {
    throw new Error('Extension context invalidated');
  };

  bridge = setupMessageBridge();

  // First message triggers invalidation — listener should self-remove
  postPageMessage('storage-update', { lastSpeed: 2.0 });
  await wait(20);

  // Replace with a tracking mock — if listener was removed, this won't fire
  let calledAfter = false;
  chrome.storage.sync.set = () => { calledAfter = true; };

  postPageMessage('storage-update', { lastSpeed: 3.0 });
  await wait(20);

  assert.false(calledAfter, 'listener should be gone after context invalidation');
});

runner.test('non-invalidation errors keep the listener alive', async () => {
  let callCount = 0;
  chrome.storage.sync.set = () => {
    callCount++;
    if (callCount === 1) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
  };

  bridge = setupMessageBridge();

  // First message throws quota error — listener should survive
  postPageMessage('storage-update', { lastSpeed: 2.0 });
  await wait(20);

  // Second message should still be handled
  postPageMessage('storage-update', { lastSpeed: 3.0 });
  await wait(20);

  assert.equal(callCount, 2, 'listener should still be active after non-invalidation error');
});

// --- sendCommand API ---

runner.test('sendCommand dispatches VSC_MESSAGE CustomEvent to page context', async () => {
  bridge = setupMessageBridge();

  let received = null;
  window.addEventListener('VSC_MESSAGE', (event) => {
    received = event.detail;
  }, { once: true });

  bridge.sendCommand('VSC_TEARDOWN');
  await wait(20);

  assert.exists(received, 'VSC_MESSAGE event should have been dispatched');
  assert.equal(received.type, 'VSC_TEARDOWN', 'type should match');
});

runner.test('sendCommand includes payload when provided', async () => {
  bridge = setupMessageBridge();

  let received = null;
  window.addEventListener('VSC_MESSAGE', (event) => {
    received = event.detail;
  }, { once: true });

  bridge.sendCommand('VSC_SET_SPEED', { speed: 2.0 });
  await wait(20);

  assert.exists(received, 'VSC_MESSAGE event should have been dispatched');
  assert.equal(received.payload.speed, 2.0, 'payload should be forwarded');
});

export { runner as injectionBridgeTestRunner };
