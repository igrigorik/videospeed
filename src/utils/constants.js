/**
 * Constants and default values for Video Speed Controller
 */

// Keyboard identity maps — shared with background.js (service worker context).
// esbuild inlines these into each bundle at build time.
import {
  PREDEFINED_CODE_MAP,
  KEYCODE_TO_CODE,
  displayKeyFromCode,
  PREDEFINED_ACTIONS,
  BLACKLISTED_CODES,
  defaultKeyBindings,
} from './key-maps.js';
import { MESSAGE_TYPES } from './messages.js';
import {
  DEFAULT_LAST_SPEED,
  LOG_LEVELS,
  PREFERENCE_DEFAULTS,
  SPEED_LIMITS,
} from './runtime-settings.js';
import { DEFAULT_SITE_RULES } from './site-pattern.js';
import { DEFAULT_CONTROLLER_CSS } from '../styles/controller-css-defaults.js';

window.VSC = window.VSC || {};

window.VSC.Constants = {};

if (!window.VSC.Constants.DEFAULT_SETTINGS) {
  // Define constants directly first for ES6 exports
  const regEndsWithFlags = /\/(?!.*(.).*\1)[gimsuy]*$/;

  // Assign to global namespace
  window.VSC.Constants.regEndsWithFlags = regEndsWithFlags;

  window.VSC.Constants.DEFAULT_CONTROLLER_CSS = DEFAULT_CONTROLLER_CSS;

  const DEFAULT_SETTINGS = {
    schemaVersion: 1,
    lastSpeed: DEFAULT_LAST_SPEED,
    enabled: true, // default enabled
    // The preferences the page script runs on (see runtime-settings.js).
    ...PREFERENCE_DEFAULTS,
    // In stored form, with options-page metadata. A mutable list of its own:
    // the runtime default is frozen, and settings code edits bindings in place.
    keyBindings: defaultKeyBindings(),
    siteRules: DEFAULT_SITE_RULES,
    // The default site rules in the legacy form older synced versions read.
    blacklist: DEFAULT_SITE_RULES.map((rule) => rule.pattern).join('\n'),
    defaultLogLevel: 4,
  };

  window.VSC.Constants.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

  /**
   * Format speed value to 2 decimal places
   * @param {number} speed - Speed value
   * @returns {string} Formatted speed
   */
  const formatSpeed = (speed) => speed.toFixed(2);

  window.VSC.Constants.formatSpeed = formatSpeed;

  const CONTROLLER_SIZE_LIMITS = {
    // Video elements: minimum size before rejecting controller entirely
    VIDEO_MIN_WIDTH: 40,
    VIDEO_MIN_HEIGHT: 40,

    // Audio elements: minimum size before starting controller hidden
    AUDIO_MIN_WIDTH: 20,
    AUDIO_MIN_HEIGHT: 20,
  };

  const CUSTOM_ACTIONS_NO_VALUES = ['pause', 'muted', 'mark', 'jump', 'display'];

  // Assign to global namespace
  window.VSC.Constants.LOG_LEVELS = LOG_LEVELS;
  window.VSC.Constants.MESSAGE_TYPES = MESSAGE_TYPES;
  window.VSC.Constants.SPEED_LIMITS = SPEED_LIMITS;
  window.VSC.Constants.CONTROLLER_SIZE_LIMITS = CONTROLLER_SIZE_LIMITS;
  window.VSC.Constants.CUSTOM_ACTIONS_NO_VALUES = CUSTOM_ACTIONS_NO_VALUES;
  window.VSC.Constants.PREDEFINED_CODE_MAP = PREDEFINED_CODE_MAP;
  window.VSC.Constants.KEYCODE_TO_CODE = KEYCODE_TO_CODE;
  window.VSC.Constants.displayKeyFromCode = displayKeyFromCode;
  window.VSC.Constants.BLACKLISTED_CODES = BLACKLISTED_CODES;
  window.VSC.Constants.PREDEFINED_ACTIONS = PREDEFINED_ACTIONS;
}
