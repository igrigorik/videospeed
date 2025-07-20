/**
 * Constants and default values for Video Speed Controller
 * Modular architecture using global variables
 */

// Initialize global namespace for content script

window.VSC = window.VSC || {};
window.VSC.Constants = {};

// Add debug info to DOM for inspection
const debugDiv = document.createElement('div');
debugDiv.id = 'vsc-constants-loaded';
debugDiv.style.display = 'none';
debugDiv.textContent = `Constants loaded at ${new Date().toISOString()}`;
document.head.appendChild(debugDiv);

// Define constants directly first for ES6 exports
const regStrip = /^[\r\t\f\v ]+|[\r\t\f\v ]+$/gm;
const regEndsWithFlags = /\/(?!.*(.).*\1)[gimsuy]*$/;

// Assign to global namespace
window.VSC.Constants.regStrip = regStrip;
window.VSC.Constants.regEndsWithFlags = regEndsWithFlags;

const DEFAULT_SETTINGS = {
  lastSpeed: 1.0, // default 1x
  enabled: true, // default enabled
  speeds: {}, // empty object to hold speed for each source

  displayKeyCode: 86, // default: V
  rememberSpeed: false, // default: false
  forceLastSavedSpeed: false, //default: false
  audioBoolean: true, // default: true (enable audio controller support)
  startHidden: false, // default: false
  controllerOpacity: 0.3, // default: 0.3
  controllerButtonSize: 14,
  keyBindings: [],
  blacklist: `
    www.instagram.com
    x.com
    imgur.com
    teams.microsoft.com
  `.replace(regStrip, ''),
  defaultLogLevel: 4,
  logLevel: 3,
};

window.VSC.Constants.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

const DEFAULT_KEY_BINDINGS = [
  { action: 'slower', key: 83, value: 0.1, force: false, predefined: true }, // S
  { action: 'faster', key: 68, value: 0.1, force: false, predefined: true }, // D
  { action: 'rewind', key: 90, value: 10, force: false, predefined: true }, // Z
  { action: 'advance', key: 88, value: 10, force: false, predefined: true }, // X
  { action: 'reset', key: 82, value: 1.0, force: false, predefined: true }, // R
  { action: 'fast', key: 71, value: 1.8, force: false, predefined: true }, // G
  { action: 'display', key: 86, value: 0, force: false, predefined: true }, // V
  { action: 'mark', key: 77, value: 0, force: false, predefined: true }, // M
  { action: 'jump', key: 74, value: 0, force: false, predefined: true }, // J
];

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

  // Badge management messages
  CONTROLLER_CREATED: 'VSC_CONTROLLER_CREATED',
  CONTROLLER_REMOVED: 'VSC_CONTROLLER_REMOVED',
  QUERY_ACTIVE_CONTROLLERS: 'VSC_QUERY_ACTIVE_CONTROLLERS',
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
window.VSC.Constants.DEFAULT_KEY_BINDINGS = DEFAULT_KEY_BINDINGS;
window.VSC.Constants.LOG_LEVELS = LOG_LEVELS;
window.VSC.Constants.MESSAGE_TYPES = MESSAGE_TYPES;
window.VSC.Constants.SPEED_LIMITS = SPEED_LIMITS;
window.VSC.Constants.CONTROLLER_SIZE_LIMITS = CONTROLLER_SIZE_LIMITS;
window.VSC.Constants.CUSTOM_ACTIONS_NO_VALUES = CUSTOM_ACTIONS_NO_VALUES;

// Global variables available for both browser and testing
