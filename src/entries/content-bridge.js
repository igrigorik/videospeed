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

async function init() {
  try {
    // Skip about:blank frames — they share the parent window
    if (location.href === 'about:blank') {
      return;
    }

    // Double-injection guard (module-level flag resets on page navigation)
    if (bridgeInitialized) {
      return;
    }
    bridgeInitialized = true;

    const settings = await chrome.storage.sync.get(null);

    const disabled = settings.enabled === false;
    const blacklisted = isBlacklisted(settings.blacklist, location.href);
    const siteRuleMatch = matchSiteRule(settings.siteRules, location.href);
    const siteDisabled = siteRuleMatch && siteRuleMatch.enabled === false;
    const shouldAbort = disabled || blacklisted || siteDisabled;

    // Always respond — inject.js runs unconditionally and needs the abort
    // signal to skip init. { once: true } limits event forgery exposure.
    if (shouldAbort) {
      docEl.addEventListener(
        'VSC_REQUEST_SETTINGS',
        () => {
          docEl.dispatchEvent(new CustomEvent('VSC_SETTINGS_READY', { detail: { abort: true } }));
        },
        { once: true }
      );
      return;
    }

    const hostname = location.hostname.replace(/^www\./, '');

    // Strip keys the MAIN world shouldn't see
    delete settings.blacklist;
    delete settings.enabled;

    const settingsPayload = { settings, hostname };

    docEl.addEventListener(
      'VSC_REQUEST_SETTINGS',
      () => {
        docEl.dispatchEvent(new CustomEvent('VSC_SETTINGS_READY', { detail: settingsPayload }));
      },
      { once: true }
    );

    // --- Ongoing: storage change relay + lifecycle ---
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'sync') {
        return;
      }

      // Lifecycle checks FIRST — teardown/reinit before relaying changes
      const disabled = 'enabled' in changes && changes.enabled.newValue === false;
      const blacklisted =
        'blacklist' in changes && isBlacklisted(changes.blacklist.newValue, location.href);
      const siteRuleDisabled =
        'siteRules' in changes &&
        (() => {
          const rule = matchSiteRule(changes.siteRules.newValue, location.href);
          return rule && rule.enabled === false;
        })();

      if (disabled || blacklisted || siteRuleDisabled) {
        docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: { type: 'VSC_TEARDOWN' } }));
        return;
      }

      const reEnabled = 'enabled' in changes && changes.enabled.newValue === true;
      const unblacklisted = 'blacklist' in changes && !blacklisted;
      const siteRuleReEnabled = 'siteRules' in changes && !siteRuleDisabled;
      if (reEnabled || unblacklisted || siteRuleReEnabled) {
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
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request?.type === 'VSC_GET_VOLUME_STATE') {
        const requestId = `vsc-volume-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let settled = false;

        const cleanup = () => {
          docEl.removeEventListener('VSC_MESSAGE_RESPONSE', handleResponse);
          clearTimeout(timeoutId);
        };

        const handleResponse = (event) => {
          if (settled || event.detail?.requestId !== requestId) {
            return;
          }

          settled = true;
          cleanup();
          sendResponse(
            event.detail.payload || {
              hasMedia: false,
              level: 1,
              percent: 100,
              maxLevel: 4,
            }
          );
        };

        const timeoutId = setTimeout(() => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          sendResponse({
            hasMedia: false,
            level: 1,
            percent: 100,
            maxLevel: 4,
          });
        }, 500);

        docEl.addEventListener('VSC_MESSAGE_RESPONSE', handleResponse);
        docEl.dispatchEvent(
          new CustomEvent('VSC_MESSAGE', {
            detail: {
              ...request,
              requestId,
            },
          })
        );
        return true;
      }

      docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: request }));
    });

    // --- Ongoing: speed write-back from MAIN world ---
    const handleWriteStorage = (e) => {
      try {
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
