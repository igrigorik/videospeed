/**
 * Vitest setup file — global test environment for all test files.
 *
 * Provides: chrome mock, shadow DOM polyfill, requestIdleCallback stub,
 * and pre-loads all extension modules once for the entire test run.
 */

import { beforeAll, beforeEach } from 'vitest';
import { installChromeMock, resetMockStorage } from './chrome-mock.js';
import { loadInjectModules } from './module-loader.js';

// Install Chrome extension API mock
installChromeMock();

// Silence console output during tests — production code logs (INFO, WARNING,
// console.warn for bridge errors) create noise. Tests that need to verify
// console output should spy on it explicitly.
const noop = () => {};
const originalConsole = { ...console };
globalThis.console = {
  ...originalConsole,
  log: noop,
  info: noop,
  warn: noop,
  debug: noop,
  // Keep console.error visible — test failures should be loud
  error: originalConsole.error,
};

// Stub APIs missing from jsdom
if (typeof globalThis.requestIdleCallback === 'undefined') {
  globalThis.requestIdleCallback = (fn) => setTimeout(fn, 0);
}

// Enhanced shadow DOM support for jsdom
// jsdom doesn't support attachShadow — we mock it with a div-based approach
if (!HTMLElement.prototype._originalAttachShadow) {
  const orig = HTMLElement.prototype.attachShadow;
  const needsPolyfill = (() => {
    try {
      const el = document.createElement('div');
      const sr = orig?.call(el, { mode: 'open' });
      return !sr;
    } catch {
      return true;
    }
  })();

  if (needsPolyfill) {
    HTMLElement.prototype.attachShadow = function (options) {
      const shadowRoot = document.createElement('div');
      shadowRoot.mode = options.mode || 'open';
      shadowRoot.host = this;

      let shadowHTML = '';
      Object.defineProperty(shadowRoot, 'innerHTML', {
        get: () => shadowHTML,
        set: (value) => {
          shadowHTML = value;
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = value.replace(/@import[^;]+;/g, '');
          while (tempDiv.firstChild) {
            shadowRoot.appendChild(tempDiv.firstChild);
          }
        },
      });

      this.shadowRoot = shadowRoot;
      return shadowRoot;
    };
  }
}

// Load ALL extension modules once for the entire test run.
// This includes loadCoreModules + inject.js — the superset.
// Individual test files no longer need to call loadCoreModules/loadInjectModules.
beforeAll(async () => {
  await loadInjectModules();
});

// Reset mock storage between tests for isolation
beforeEach(() => {
  resetMockStorage();
});
