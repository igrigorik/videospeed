/**
 * Runtime settings — the only view of stored settings that reaches MAIN world.
 *
 * Whatever the page script holds, the page can read. So the content bridge
 * never forwards storage. It sends this projection: whether VSC runs on the
 * document, the speed to start at, and the preferences the page script needs
 * to do its job. Site rules, the blacklist, and a remembered speed that is not
 * in use stay behind. See docs/settings-trust-boundary.md.
 *
 * Pure ES module: no DOM, no chrome.*, no window.VSC. Shared by the bridge
 * (ISOLATED world), the page script (MAIN world), and the options page.
 */

import { defaultKeyBindings } from './key-maps.js';
import { matchSiteRule, selectSiteRules } from './site-pattern.js';

export const SPEED_LIMITS = Object.freeze({
  MIN: 0.07, // Video min rate per Chromium source
  MAX: 16, // Maximum playback speed in Chrome per Chromium source
});

/** What "remember speed" holds until the user first chooses a speed. */
export const DEFAULT_LAST_SPEED = 1.0;

export const LOG_LEVELS = Object.freeze({
  NONE: 1,
  ERROR: 2,
  WARNING: 3,
  INFO: 4,
  DEBUG: 5,
  VERBOSE: 6,
});

// --- Readers ---------------------------------------------------------------
// Each returns the canonical value, or undefined when the input is absent or
// unusable so the caller falls back to the default. Absent is not falsy:
// `false`, `0`, and `''` are values a user can save.

const readBoolean = (value) => (value === undefined ? undefined : Boolean(value));

const readString = (value) => (typeof value === 'string' ? value : undefined);

/** A finite number. Numeric strings count, as they always have in the loader. */
function readNumber(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
}

function readLogLevel(value) {
  const level = readNumber(value);
  return Object.values(LOG_LEVELS).includes(level) ? level : undefined;
}

/** The binding fields the page script reads. Options-page metadata stays out. */
const BINDING_FIELDS = ['action', 'value', 'code', 'keyCode', 'key'];
const MODIFIERS = ['shift', 'ctrl', 'alt', 'meta'];

const isPrimitive = (value) => value === null || typeof value !== 'object';

/**
 * Modifier flags as strict booleans, or undefined when none is set.
 *
 * Whether the object exists is meaningful: EventManager matches a binding
 * with modifiers as an exact chord, and a binding without them as a plain key
 * that ignores Shift. An all-false object must therefore not survive.
 *
 * @param {Object} [modifiers]
 * @returns {{shift: boolean, ctrl: boolean, alt: boolean, meta: boolean}|undefined}
 */
export function normalizeModifiers(modifiers) {
  if (!modifiers) {
    return undefined;
  }
  const flags = Object.fromEntries(MODIFIERS.map((name) => [name, Boolean(modifiers[name])]));
  return Object.values(flags).some(Boolean) ? flags : undefined;
}

function projectKeyBinding(binding) {
  const projected = {};
  for (const field of BINDING_FIELDS) {
    // A null `code` is kept: it marks a legacy binding matched by keyCode.
    if (binding[field] !== undefined && isPrimitive(binding[field])) {
      projected[field] = binding[field];
    }
  }
  const modifiers = normalizeModifiers(binding.modifiers);
  if (modifiers) {
    projected.modifiers = modifiers;
  }
  return projected;
}

/** Bindings in their stored order. An empty or unusable list means defaults. */
function readKeyBindings(value) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const bindings = value
    .filter((binding) => typeof binding?.action === 'string')
    .map(projectKeyBinding);
  return bindings.length > 0 ? bindings : undefined;
}

// --- Preferences -----------------------------------------------------------

const preference = (fallback, read) => Object.freeze({ fallback, read });

const DEFAULT_KEY_BINDINGS = Object.freeze(
  readKeyBindings(defaultKeyBindings()).map(Object.freeze)
);

/**
 * Every stored setting the page script may see, with its default and reader.
 * A setting that is not listed here never crosses the bridge.
 */
const PREFERENCES = Object.freeze({
  rememberSpeed: preference(false, readBoolean),
  exclusiveKeys: preference(false, readBoolean),
  audioBoolean: preference(true, readBoolean), // show controllers on audio elements
  startHidden: preference(false, readBoolean),
  controllerOpacity: preference(0.3, readNumber),
  controllerButtonSize: preference(14, readNumber),
  customCSS: preference('', readString), // adopted alongside the built-in CSS
  keyBindings: preference(DEFAULT_KEY_BINDINGS, readKeyBindings),
  logLevel: preference(LOG_LEVELS.WARNING, readLogLevel),
});

/** The default of every runtime preference. The stored defaults build on it. */
export const PREFERENCE_DEFAULTS = Object.freeze(
  Object.fromEntries(Object.entries(PREFERENCES).map(([key, { fallback }]) => [key, fallback]))
);

/**
 * The canonical value of one runtime preference: what `source` holds if that
 * is usable, else the default. Always a fresh value.
 *
 * @param {Object} source - Stored settings, or settings already projected
 * @param {string} key - A runtime preference name
 */
export function readPreference(source, key) {
  const { fallback, read } = PREFERENCES[key];
  return read(source[key]) ?? read(fallback);
}

/**
 * Every runtime preference of `source`, in a fixed key order. Idempotent:
 * projecting a projection returns an equal value.
 *
 * @param {Object} source - Stored settings, or settings already projected
 * @returns {Object} One canonical value per runtime preference
 */
export function projectPreferences(source) {
  return Object.fromEntries(
    Object.keys(PREFERENCES).map((key) => [key, readPreference(source, key)])
  );
}

// Projected values are plain JSON with a fixed key order.
const isSameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What a storage change means to the page: the runtime preferences whose
 * canonical value differs between two stored states, shaped like
 * chrome.storage change records without `oldValue`.
 *
 * @param {Object} before - Stored settings before the change
 * @param {Object} after - Stored settings after the change
 * @returns {Object|null} `{ key: { newValue } }`, or null when nothing the
 *   page may see has changed
 */
export function preferenceChanges(before, after) {
  const previous = projectPreferences(before);
  const changes = {};
  for (const [key, newValue] of Object.entries(projectPreferences(after))) {
    if (!isSameValue(previous[key], newValue)) {
      changes[key] = { newValue };
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

// --- Speed -----------------------------------------------------------------

/**
 * A playback speed Chrome accepts, or null when `value` is not a positive
 * number. Out-of-range speeds are clamped.
 *
 * @param {*} value
 * @returns {number|null}
 */
export function normalizeSpeed(value) {
  const speed = readNumber(value);
  return speed > 0 ? Math.min(Math.max(speed, SPEED_LIMITS.MIN), SPEED_LIMITS.MAX) : null;
}

/**
 * A remembered speed as VSC itself stores it. The page script rounds every
 * speed it persists to two decimals, so finer precision was never written by
 * VSC and is dropped here, both when storing a speed and when reading one.
 *
 * @param {*} value
 * @returns {number|null}
 */
export function normalizeRememberedSpeed(value) {
  const speed = normalizeSpeed(value);
  return speed === null ? null : Number(speed.toFixed(2));
}

// --- Runtime settings ------------------------------------------------------

/**
 * Decide what one document's page script is told.
 *
 * The page gets one resolved speed, not a rule speed and a remembered speed
 * side by side: the first matching site rule's speed wins, then the
 * remembered speed when the user asked VSC to remember, else null — VSC has
 * no opinion. A remembered speed that is not in use is never sent.
 *
 * @param {Object} stored - Settings as stored, without defaults filled in
 * @param {string} href - The document's own URL
 * @returns {Object|null} `{ initialSpeed, ...preferences }`, or null when VSC
 *   is off for this document
 */
export function resolveRuntimeSettings(stored, href) {
  if (stored.enabled === false) {
    return null;
  }
  const rule = matchSiteRule(selectSiteRules(stored), href);
  if (rule?.enabled === false) {
    return null;
  }

  const preferences = projectPreferences(stored);
  // Saved value, else its default: with nothing saved yet, remembering starts at 1x.
  const { lastSpeed = DEFAULT_LAST_SPEED } = stored;
  const remembered = preferences.rememberSpeed ? normalizeRememberedSpeed(lastSpeed) : null;
  return { initialSpeed: normalizeSpeed(rule?.speed) ?? remembered, ...preferences };
}

/**
 * Canonical runtime settings from whatever the page script received. The
 * bridge's answer passes through unchanged; anything else is reduced to the
 * same shape, with defaults for unusable fields and no speed opinion.
 *
 * @param {Object} received
 * @returns {Object} `{ initialSpeed, ...preferences }`
 */
export function normalizeRuntimeSettings(received) {
  return { initialSpeed: normalizeSpeed(received.initialSpeed), ...projectPreferences(received) };
}
