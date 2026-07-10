/**
 * Content Bridge — ISOLATED world thin bridge for chrome.* API access.
 *
 * Runs at document_start. Communicates with inject.js (MAIN world) via
 * CustomEvents on document.documentElement.
 *
 * Settings handshake:
 *   1. Bridge stashes settings in closure, registers VSC_REQUEST_SETTINGS listener
 *   2. MAIN world fires VSC_REQUEST_SETTINGS at document_idle
 *   3. Bridge responds with VSC_SETTINGS_READY (synchronous within same tick)
 */

import { isBlacklisted } from '../utils/blacklist.js';
import { matchSiteRule } from '../utils/site-pattern.js';

// Speed limits for page→bridge write validation.
// Duplicated from constants.js (ISOLATED world can't import page modules).
const SPEED_MIN = 0.07;
const SPEED_MAX = 16;

const docEl = document.documentElement;
let bridgeInitialized = false;

/** @returns {boolean} Whether the URL inherits its creator's origin. */
function isInheritedAboutUrl(url) {
  return /^about:(?:blank|srcdoc)(?:[?#].*)?$/.test(url);
}

/**
 * Resolve the URL whose site settings should apply to this frame.
 * Inherited about: frames prefer a non-about referrer and then the first
 * safely-readable non-about ancestor before falling back to their own URL.
 *
 * @returns {string}
 */
function resolveContextUrl() {
  const currentUrl = location.href;
  if (!isInheritedAboutUrl(currentUrl)) {
    return currentUrl;
  }

  if (document.referrer && !isInheritedAboutUrl(document.referrer)) {
    return document.referrer;
  }

  try {
    let ancestor = window.parent;
    while (ancestor && ancestor !== window) {
      const ancestorUrl = ancestor.location.href;
      if (ancestorUrl && !isInheritedAboutUrl(ancestorUrl)) {
        return ancestorUrl;
      }

      if (ancestor.parent === ancestor) {
        break;
      }
      ancestor = ancestor.parent;
    }
  } catch {
    // Cross-origin parent access is expected to fail; use the frame URL below.
  }

  return currentUrl;
}

async function init() {
  try {
    // Double-injection guard (module-level flag resets on page navigation)
    if (bridgeInitialized) {
      return;
    }
    bridgeInitialized = true;

    const settings = {};
    const pendingSettingsChanges = [];
    let initialSettingsLoaded = false;
    let hasCompletedSettingsHandshake = false;
    let bridgeActive = false;
    let pendingSettingsResponse = false;

    const applySettingsChanges = (changes) => {
      for (const [key, change] of Object.entries(changes)) {
        if (change.newValue === undefined) {
          delete settings[key];
        } else {
          settings[key] = change.newValue;
        }
      }
    };

    // Start loading immediately, but register every bridge listener before it
    // completes. MAIN can request settings as soon as document_idle fires.
    const initialSettingsReady = chrome.storage.sync
      .get(null)
      .then((storedSettings) => {
        Object.assign(settings, storedSettings);
      })
      .catch((error) => {
        console.error('[VSC] Initial settings load failed:', error);
      })
      .then(() => {
        for (const changes of pendingSettingsChanges) {
          applySettingsChanges(changes);
        }
        pendingSettingsChanges.length = 0;
        initialSettingsLoaded = true;
      });

    const shouldAbortForContext = (contextUrl) => {
      const disabled = settings.enabled === false;
      // Legacy blacklist: only checked when siteRules hasn't been initialized yet
      // (pre-migration devices). Once migration runs, siteRules is the source of
      // truth. The blacklist is preserved in storage for sync compat with older
      // extension versions but must not shadow siteRules edits.
      const blacklisted = !settings.siteRules && isBlacklisted(settings.blacklist, contextUrl);
      const siteRuleMatch = matchSiteRule(settings.siteRules, contextUrl);
      const siteDisabled = siteRuleMatch && siteRuleMatch.enabled === false;
      return disabled || blacklisted || siteDisabled;
    };

    const respondWithSettings = () => {
      const contextUrl = resolveContextUrl();
      hasCompletedSettingsHandshake = true;

      if (shouldAbortForContext(contextUrl)) {
        bridgeActive = false;
        docEl.dispatchEvent(
          new CustomEvent('VSC_SETTINGS_READY', { detail: { abort: true, contextUrl } })
        );
        return;
      }

      // Strip keys the MAIN world shouldn't see without mutating the snapshot.
      const publicSettings = { ...settings };
      delete publicSettings.blacklist;
      delete publicSettings.enabled;
      bridgeActive = true;
      docEl.dispatchEvent(
        new CustomEvent('VSC_SETTINGS_READY', {
          detail: { settings: publicSettings, contextUrl },
        })
      );
    };

    // Keep this listener reusable. Reinitialization in MAIN world performs a
    // fresh handshake, and the settings snapshot below is updated by onChanged.
    docEl.addEventListener('VSC_REQUEST_SETTINGS', () => {
      if (initialSettingsLoaded) {
        respondWithSettings();
        return;
      }

      // The event channel has no request ID, so coalesce requests while the
      // initial read is pending. One response resolves every active listener
      // and cannot leave an older response to be consumed by a later reload.
      if (!pendingSettingsResponse) {
        pendingSettingsResponse = true;
        initialSettingsReady.then(() => {
          pendingSettingsResponse = false;
          respondWithSettings();
        });
      }
    });

    // --- Ongoing: storage change relay + lifecycle ---
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'sync') {
        return;
      }

      // Preserve changes that race the initial storage read, then keep the
      // response snapshot current before dispatching lifecycle events.
      if (initialSettingsLoaded) {
        applySettingsChanges(changes);
      } else {
        pendingSettingsChanges.push(changes);
      }

      // Lifecycle: only the popup's enabled toggle triggers teardown/reinit.
      // Options page never writes `enabled`, so saving options can't trigger
      // lifecycle — it only relays settings via VSC_STORAGE_CHANGED below.
      // siteRules/blacklist changes take effect on next page load.
      if (changes.enabled?.newValue === false) {
        bridgeActive = false;
        docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: { type: 'VSC_TEARDOWN' } }));
        return;
      }
      if (
        hasCompletedSettingsHandshake &&
        changes.enabled?.oldValue === false &&
        changes.enabled?.newValue !== false
      ) {
        // Stay inactive until the reinitializing MAIN world completes a fresh
        // settings handshake (which may still abort due to a site rule).
        bridgeActive = false;
        docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: { type: 'VSC_REINIT' } }));
      }

      // Relay changes to MAIN world (filter out keys MAIN never received)
      const relayChanges = { ...changes };
      delete relayChanges.enabled;
      delete relayChanges.blacklist;
      if (Object.keys(relayChanges).length > 0) {
        docEl.dispatchEvent(new CustomEvent('VSC_STORAGE_CHANGED', { detail: relayChanges }));
      }
    });

    // --- Ongoing: popup/background message relay ---
    chrome.runtime.onMessage.addListener((request) => {
      if (!initialSettingsLoaded || !bridgeActive) {
        return;
      }
      docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: request }));
    });

    // --- Ongoing: speed write-back from MAIN world ---
    const handleWriteStorage = (e) => {
      try {
        if (!initialSettingsLoaded || !bridgeActive) {
          return;
        }

        const data = e.detail;
        if (!data || typeof data !== 'object') {
          return;
        }

        // Only lastSpeed can be written from MAIN world (trust boundary)
        if ('lastSpeed' in data) {
          const speed = data.lastSpeed;
          if (typeof speed === 'number' && Number.isFinite(speed)) {
            const clamped = Math.min(Math.max(speed, SPEED_MIN), SPEED_MAX);
            chrome.storage.sync.set({ lastSpeed: clamped });
          }
        }
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
