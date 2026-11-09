/**
 * Content Bridge — ISOLATED world thin bridge for chrome.* API access.
 *
 * Runs at document_start. Communicates with inject.js (MAIN world) via
 * CustomEvents on document.documentElement.
 *
 * Settings handshake:
 *   1. Bridge starts the settings read and registers VSC_REQUEST_SETTINGS
 *   2. MAIN world fires VSC_REQUEST_SETTINGS at document_idle
 *   3. Bridge responds with VSC_SETTINGS_READY once its storage snapshot is ready
 *
 * Security model:
 *   The MAIN world is page context: any script on the page can listen to these
 *   events and dispatch its own. CustomEvents are therefore not an
 *   authentication boundary and the bridge must not perform privileged work
 *   on their say-so. Two rules follow:
 *
 *   1. Only a functional allowlist of settings crosses into MAIN. Raw storage
 *      (site rules, blacklist, enabled, stored lastSpeed) stays in the
 *      extension's isolated world; MAIN receives the resolved initial speed
 *      instead.
 *   2. Speed persistence is scoped to the top-level site and written to
 *      chrome.storage.local, never chrome.storage.sync. A page can therefore
 *      only affect the remembered speed of the site it is running on, not a
 *      value other sites can read (which would make lastSpeed a cross-site
 *      identifier), and it cannot exhaust the sync write quota.
 */

import { isBlacklisted } from '../utils/blacklist.js';
import { matchSiteRule } from '../utils/site-pattern.js';

// Speed limits for page→bridge write validation.
// Duplicated from constants.js (ISOLATED world can't import page modules).
const SPEED_MIN = 0.07;
const SPEED_MAX = 16;

// Minimum spacing between page-originated persistence writes. MAIN debounces
// its own saves, but a page can dispatch the bridge event directly, so the
// bridge must be the enforcement point.
const MIN_WRITE_INTERVAL_MS = 1000;

// Only these settings are needed by the MAIN world. Everything else (raw site
// rules, blacklist, enabled, stored lastSpeed, schema/version keys) stays out
// of the page-visible payload.
const PUBLIC_SETTING_KEYS = Object.freeze([
  'keyBindings',
  'customCSS',
  'controllerOpacity',
  'controllerButtonSize',
  'startHidden',
  'audioBoolean',
  'exclusiveKeys',
  'logLevel',
  'rememberSpeed',
]);

const SITE_SPEED_PREFIX = 'vsc:lastSpeed:';

const docEl = document.documentElement;
let bridgeInitialized = false;

// Mutable bridge state, updated from storage changes.
let bridgeActive = false;
let rememberSpeed = false;

// Pending page-originated speed write (coalesced and throttled).
let pendingSpeed = null;
let writeTimer = null;
let lastWriteAt = 0;

function siteOrigin() {
  // Scope remembered speed to the top-level site, not the frame's origin:
  // otherwise a third-party iframe could read a value it stored while the user
  // visited its own site, turning per-site storage into a cross-site
  // identifier again. ancestorOrigins is available to cross-origin frames.
  let embedded = true;
  try {
    embedded = window.top !== window;
    const ancestors = location.ancestorOrigins;
    const topOrigin = ancestors && ancestors[ancestors.length - 1];
    if (topOrigin) {
      return String(topOrigin);
    }
  } catch {
    // Fall through to the embedded/top-level fallback.
  }

  // Never fall back to the frame's own origin when embedded: that is exactly
  // the cross-site key this function exists to avoid.
  return embedded ? 'embedded' : location.origin;
}

function speedStorageKey() {
  return `${SITE_SPEED_PREFIX}${siteOrigin()}`;
}

/**
 * Validate, clamp and round a candidate speed.
 * @param {*} value
 * @returns {number|null}
 */
function asSpeed(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(Math.max(Number(value.toFixed(2)), SPEED_MIN), SPEED_MAX);
}

function dispatchAbort() {
  docEl.dispatchEvent(new CustomEvent('VSC_SETTINGS_READY', { detail: { abort: true } }));
}

/**
 * Build the minimal settings payload consumed by the MAIN world.
 * @param {Object} settings - Raw sync storage snapshot
 * @param {number|null} initialSpeed - Resolved starting speed
 * @returns {Object}
 */
function buildPublicSettings(settings, initialSpeed) {
  const publicSettings = {
    initialSpeed,
    rememberSpeed: settings.rememberSpeed === true,
  };

  for (const key of PUBLIC_SETTING_KEYS) {
    if (key === 'rememberSpeed') {
      continue; // normalized above
    }
    if (settings[key] !== undefined) {
      publicSettings[key] = settings[key];
    }
  }

  return publicSettings;
}

/**
 * Resolve the speed a new page should start at, in the same priority order the
 * page context used before site rules moved behind the bridge: matching site
 * rule, then this site's remembered speed, then the global remembered speed.
 * @param {Object} settings - Raw sync storage snapshot
 * @param {Object|null} siteRuleMatch - Matching site rule, if any
 * @param {number|null} localSpeed - This top-level site's remembered speed
 * @returns {number|null}
 */
function resolveInitialSpeed(settings, siteRuleMatch, localSpeed) {
  if (siteRuleMatch) {
    const ruleSpeed = asSpeed(siteRuleMatch.speed);
    if (ruleSpeed !== null) {
      return ruleSpeed;
    }
  }

  if (settings.rememberSpeed !== true) {
    return null;
  }

  const originSpeed = asSpeed(localSpeed);
  if (originSpeed !== null) {
    return originSpeed;
  }

  const storedSpeed = asSpeed(settings.lastSpeed);
  if (storedSpeed !== null) {
    return storedSpeed;
  }

  // rememberSpeed is on but no valid remembered value exists yet; match the
  // old merged-defaults behavior and start at 1x.
  return 1.0;
}

function cancelPendingWrite() {
  pendingSpeed = null;
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
}

function flushSpeedWrite() {
  writeTimer = null;
  const speed = pendingSpeed;
  pendingSpeed = null;

  if (speed === null || !bridgeActive || !rememberSpeed) {
    return;
  }

  lastWriteAt = Date.now();

  try {
    chrome.storage.local.set({ [speedStorageKey()]: speed }, () => {
      if (chrome.runtime.lastError) {
        console.warn(
          '[VSC] Failed to remember speed for this site:',
          chrome.runtime.lastError.message
        );
      }
    });
  } catch (error) {
    console.warn('[VSC] Failed to remember speed for this site:', error.message);
  }
}

function queueSpeedWrite(speed) {
  pendingSpeed = speed;

  if (writeTimer !== null) {
    return;
  }

  const wait = Math.max(0, MIN_WRITE_INTERVAL_MS - (Date.now() - lastWriteAt));
  writeTimer = setTimeout(flushSpeedWrite, wait);
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

    let disabledForDocument = false;
    let settingsReady = Promise.resolve(null);

    // Start the read without awaiting it. The request listener is installed in
    // this same task, so MAIN cannot fire into the old listener-free window.
    try {
      const localKey = speedStorageKey();
      settingsReady = Promise.all([
        chrome.storage.sync.get(null),
        chrome.storage.local.get(localKey).catch((error) => {
          console.error('[VSC] Per-origin speed read failed:', error);
          return {};
        }),
      ])
        .then(([settings, local]) =>
          settings ? { settings, localSpeed: local?.[localKey] } : null
        )
        .catch((error) => {
          console.error('[VSC] Initial settings load failed:', error);
          return null;
        });
    } catch (error) {
      console.error('[VSC] Initial settings load failed:', error);
      settingsReady = Promise.resolve(null);
    }

    docEl.addEventListener(
      'VSC_REQUEST_SETTINGS',
      async () => {
        const loaded = await settingsReady;
        if (!loaded) {
          dispatchAbort();
          return;
        }

        const settings = loaded.settings;

        // Legacy blacklist is consulted only before migration creates siteRules.
        const blacklisted = !settings.siteRules && isBlacklisted(settings.blacklist, location.href);
        const siteRuleMatch = matchSiteRule(settings.siteRules, location.href);
        const siteDisabled = siteRuleMatch && siteRuleMatch.enabled === false;
        if (disabledForDocument || settings.enabled === false || blacklisted || siteDisabled) {
          dispatchAbort();
          return;
        }

        rememberSpeed = settings.rememberSpeed === true;
        const initialSpeed = resolveInitialSpeed(settings, siteRuleMatch, loaded.localSpeed);

        bridgeActive = true;
        docEl.dispatchEvent(
          new CustomEvent('VSC_SETTINGS_READY', {
            detail: { settings: buildPublicSettings(settings, initialSpeed) },
          })
        );
      },
      { once: true }
    );

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'sync') {
        return;
      }

      const enabledChange = changes.enabled;
      if (enabledChange?.oldValue === false || enabledChange?.newValue === false) {
        // Any disabled state makes this document reload-only from here on.
        disabledForDocument = true;
      }
      if (enabledChange?.newValue === false) {
        bridgeActive = false;
        cancelPendingWrite();
        docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: { type: 'VSC_TEARDOWN' } }));
        return;
      }

      if (changes.rememberSpeed) {
        rememberSpeed = changes.rememberSpeed.newValue === true;
        if (!rememberSpeed) {
          cancelPendingWrite();
        }
      }

      if (!bridgeActive) {
        return;
      }

      // Relay only settings the MAIN world consumes. lastSpeed is deliberately
      // excluded (session isolation, docs/speed-arbitration.md), and raw site
      // rules must never be exposed to page context.
      const relayChanges = {};
      for (const key of PUBLIC_SETTING_KEYS) {
        if (changes[key]) {
          relayChanges[key] = changes[key];
        }
      }
      if (Object.keys(relayChanges).length > 0) {
        docEl.dispatchEvent(new CustomEvent('VSC_STORAGE_CHANGED', { detail: relayChanges }));
      }
    });

    chrome.runtime.onMessage.addListener((request) => {
      if (bridgeActive) {
        docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: request }));
      }
    });

    const handleWriteStorage = (e) => {
      try {
        if (!bridgeActive || !rememberSpeed) {
          return;
        }

        // Page-originated persistence is a top-level convenience only.
        // Subframes (ads, embedded players) must not be able to write it.
        if (window.top !== window) {
          return;
        }

        const data = e.detail;
        if (!data || typeof data !== 'object') {
          return;
        }

        // Only lastSpeed can cross from MAIN into extension storage, and it is
        // stored per origin in chrome.storage.local.
        if ('lastSpeed' in data) {
          const speed = asSpeed(data.lastSpeed);
          if (speed !== null) {
            queueSpeedWrite(speed);
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
