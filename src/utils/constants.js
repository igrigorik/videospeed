/**
 * Constants and default values for Video Speed Controller
 */

// Keyboard identity maps — shared with background.js (service worker context).
// esbuild inlines these into each bundle at build time.
import {
  PREDEFINED_CODE_MAP, KEYCODE_TO_CODE, displayKeyFromCode,
  PREDEFINED_ACTIONS, BLACKLISTED_CODES, DEFAULT_BINDINGS,
} from './key-maps.js';
import { DEFAULT_CONTROLLER_CSS } from '../styles/controller-css-defaults.js';

window.VSC = window.VSC || {};

window.VSC.Constants = {};

if (!window.VSC.Constants.DEFAULT_SETTINGS) {

  // Define constants directly first for ES6 exports
  const regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
  const regEndsWithFlags = /\/(?!.*(.).*\1)[gimsuy]*$/;

  // Assign to global namespace
  window.VSC.Constants.regStrip = regStrip;
  window.VSC.Constants.regEndsWithFlags = regEndsWithFlags;

  window.VSC.Constants.DEFAULT_CONTROLLER_CSS = DEFAULT_CONTROLLER_CSS;

  const DEFAULT_SETTINGS = {
    schemaVersion: 1,
    lastSpeed: 1.0, // default 1x
    enabled: true, // default enabled
    rememberSpeed: false, // default: false
    exclusiveKeys: false, // default: false
    audioBoolean: true, // default: true (enable audio controller support)
    startHidden: false, // default: false
    controllerOpacity: 0.3, // default: 0.3
    controllerButtonSize: 14,
    controllerCSS: DEFAULT_CONTROLLER_CSS,
    keyBindings: PREDEFINED_ACTIONS.map(action => ({
      action, ...DEFAULT_BINDINGS[action], predefined: true,
    })),
    siteRules: [
      { pattern: 'www.instagram.com', enabled: false, speed: null },
      { pattern: 'x.com',             enabled: false, speed: null },
      { pattern: 'imgur.com',         enabled: false, speed: null },
      { pattern: 'teams.microsoft.com', enabled: false, speed: null },
      { pattern: 'meet.google.com',   enabled: false, speed: null },
    ],
    blacklist: `www.instagram.com
x.com
imgur.com
teams.microsoft.com
meet.google.com`.replace(regStrip, ''),
    defaultLogLevel: 4,
    logLevel: 3,
  };

  window.VSC.Constants.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

  /**
   * Format speed value to 2 decimal places
   * @param {number} speed - Speed value
   * @returns {string} Formatted speed
   */
  const formatSpeed = (speed) => speed.toFixed(2);

  window.VSC.Constants.formatSpeed = formatSpeed;

  const LOG_LEVELS = {
    NONE: 1,
    ERROR: 2,
    WARNING: 3,
    INFO: 4,
    DEBUG: 5,
    VERBOSE: 6,
  };

  const MESSAGE_TYPES = {
    SET_SPEED: 'VSC_SET_SPEED',
    ADJUST_SPEED: 'VSC_ADJUST_SPEED',
    RESET_SPEED: 'VSC_RESET_SPEED',
    TOGGLE_DISPLAY: 'VSC_TOGGLE_DISPLAY',
    TEARDOWN: 'VSC_TEARDOWN',
    REINIT: 'VSC_REINIT',
  };

  const SPEED_LIMITS = {
    MIN: 0.07, // Video min rate per Chromium source
    MAX: 16, // Maximum playback speed in Chrome per Chromium source
  };

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
