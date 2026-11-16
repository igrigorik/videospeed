/**
 * Content Bridge — ISOLATED world thin bridge for chrome.* API access.
 *
 * Runs at document_start and talks to inject.js (MAIN world) through
 * CustomEvents on document.documentElement. The page can read every one of
 * those events, so nothing is forwarded as stored: the bridge sends the
 * projections built by runtime-settings.js and keeps the rest to itself.
 * See docs/settings-trust-boundary.md.
 *
 * Settings handshake:
 *   1. Bridge starts the storage read and registers VSC_REQUEST_SETTINGS
 *   2. MAIN world fires VSC_REQUEST_SETTINGS at document_idle
 *   3. Bridge answers VSC_SETTINGS_READY with this document's runtime
 *      settings, or { abort: true } when VSC is off here
 */

import { MESSAGE_TYPES, readCommand } from '../utils/messages.js';
import {
  normalizeRememberedSpeed,
  preferenceChanges,
  readPreference,
  resolveRuntimeSettings,
} from '../utils/runtime-settings.js';

const docEl = document.documentElement;
let bridgeInitialized = false;

function dispatch(type, detail) {
  docEl.dispatchEvent(new CustomEvent(type, { detail }));
}

function dispatchAbort() {
  dispatch('VSC_SETTINGS_READY', { abort: true });
}

/** Sync storage as it stands after `changes`, given the state before them. */
function applyChanges(stored, changes) {
  const next = { ...stored };
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (newValue === undefined) {
      delete next[key];
    } else {
      next[key] = newValue;
    }
  }
  return next;
}

function init() {
  try {
    // Double-injection guard (module-level flag resets on page navigation)
    if (bridgeInitialized) {
      return;
    }
    bridgeInitialized = true;

    // Inherited about: documents have no trustworthy site URL available
    // without crossing into page context. Fail closed instead: supporting media
    // in these rare frames is less important than honoring disabled-site rules.
    if (location.protocol === 'about:') {
      docEl.addEventListener('VSC_REQUEST_SETTINGS', dispatchAbort, { once: true });
      return;
    }

    // Sync storage as of the latest change; null until the startup read lands,
    // and for good if it fails. Changes that outrun the read wait in
    // `earlyChanges`, which is dropped once the read has settled.
    let stored = null;
    let earlyChanges = [];
    let disabledForDocument = false;
    let bridgeActive = false;

    // Start the read without awaiting it. The request listener is installed in
    // this same task, so MAIN cannot fire into a listener-free window.
    const storageRead = chrome.storage.sync
      .get(null)
      .then(
        (snapshot) => {
          stored = earlyChanges.reduce(applyChanges, snapshot);
        },
        (error) => {
          console.error('[VSC] Initial settings load failed:', error);
        }
      )
      .finally(() => {
        earlyChanges = null;
      });

    docEl.addEventListener(
      'VSC_REQUEST_SETTINGS',
      async () => {
        await storageRead;

        // Resolved once, from the latest state. Site-rule edits after this
        // point take effect on the next load.
        const settings =
          stored && !disabledForDocument ? resolveRuntimeSettings(stored, location.href) : null;
        if (!settings) {
          dispatchAbort();
          return;
        }

        bridgeActive = true;
        dispatch('VSC_SETTINGS_READY', { settings });
      },
      { once: true }
    );

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') {
        return;
      }

      const before = stored;
      if (stored) {
        stored = applyChanges(stored, changes);
      } else {
        earlyChanges?.push(changes);
      }

      const enabledChange = changes.enabled;
      if (enabledChange?.oldValue === false || enabledChange?.newValue === false) {
        // Any disabled state makes this document reload-only from here on.
        disabledForDocument = true;
      }
      if (enabledChange?.newValue === false) {
        bridgeActive = false;
        dispatch('VSC_MESSAGE', { type: MESSAGE_TYPES.TEARDOWN });
        return;
      }
      if (!bridgeActive) {
        return;
      }

      // The page hears about a change only if it alters a runtime preference.
      const visibleChanges = preferenceChanges(before, stored);
      if (visibleChanges) {
        dispatch('VSC_STORAGE_CHANGED', visibleChanges);
      }
    });

    // Popup commands are rebuilt from their known fields, never forwarded.
    chrome.runtime.onMessage.addListener((request) => {
      const command = bridgeActive ? readCommand(request) : null;
      if (command) {
        dispatch('VSC_MESSAGE', command);
      }
    });

    // The one thing a page may ask storage to do: remember a speed. The page
    // cannot grant itself that; the user's own setting, as stored, decides.
    const handleWriteStorage = (event) => {
      try {
        if (!bridgeActive || !readPreference(stored, 'rememberSpeed')) {
          return;
        }

        const lastSpeed = normalizeRememberedSpeed(event.detail?.lastSpeed);
        if (lastSpeed === null) {
          return;
        }

        chrome.storage.sync.set({ lastSpeed }).catch((error) => {
          console.warn('[VSC] Could not remember speed:', error);
        });
      } catch (err) {
        if (err.message?.includes('Extension context invalidated')) {
          docEl.removeEventListener('VSC_WRITE_STORAGE', handleWriteStorage);
        }
      }
    };
    docEl.addEventListener('VSC_WRITE_STORAGE', handleWriteStorage);
  } catch (error) {
    console.error('[VSC] Bridge init failed:', error);
  }
}

init();
