/**
 * Shared keyboard identity maps used by both:
 * - background.js (service worker context — migration)
 * - constants.js (page context — runtime matching + options page)
 *
 * Pure ES module exports — no window/DOM dependencies.
 */

/**
 * Hardcoded mapping for the 9 predefined bindings. Zero ambiguity —
 * these are the exact physical keys the extension has always used.
 */
export const PREDEFINED_CODE_MAP = Object.freeze({
  83: { code: 'KeyS', displayKey: 's' }, // slower
  68: { code: 'KeyD', displayKey: 'd' }, // faster
  90: { code: 'KeyZ', displayKey: 'z' }, // rewind
  88: { code: 'KeyX', displayKey: 'x' }, // advance
  82: { code: 'KeyR', displayKey: 'r' }, // reset
  71: { code: 'KeyG', displayKey: 'g' }, // fast
  86: { code: 'KeyV', displayKey: 'v' }, // display
  77: { code: 'KeyM', displayKey: 'm' }, // mark
  74: { code: 'KeyJ', displayKey: 'j' }, // jump
});

/**
 * Static lookup table mapping legacy keyCode integers to event.code strings.
 * Based on US QWERTY layout — the same assumption the old keyCode-based system
 * and keyCodeAliases/String.fromCharCode already made.
 *
 * Used by the v1→v2 migration for custom (non-predefined) bindings.
 * Where a keyCode maps to multiple physical keys (e.g., 13→Enter vs NumpadEnter),
 * the primary (non-numpad) key is chosen.
 */
export const KEYCODE_TO_CODE = Object.freeze({
  // Control keys
  8: 'Backspace',
  13: 'Enter', // NumpadEnter also produces 13 — we pick main Enter
  27: 'Escape',
  32: 'Space',
  46: 'Delete',

  // Arrow keys
  37: 'ArrowLeft',
  38: 'ArrowUp',
  39: 'ArrowRight',
  40: 'ArrowDown',

  // Digit row (top)
  48: 'Digit0',
  49: 'Digit1',
  50: 'Digit2',
  51: 'Digit3',
  52: 'Digit4',
  53: 'Digit5',
  54: 'Digit6',
  55: 'Digit7',
  56: 'Digit8',
  57: 'Digit9',

  // Letter keys
  65: 'KeyA',
  66: 'KeyB',
  67: 'KeyC',
  68: 'KeyD',
  69: 'KeyE',
  70: 'KeyF',
  71: 'KeyG',
  72: 'KeyH',
  73: 'KeyI',
  74: 'KeyJ',
  75: 'KeyK',
  76: 'KeyL',
  77: 'KeyM',
  78: 'KeyN',
  79: 'KeyO',
  80: 'KeyP',
  81: 'KeyQ',
  82: 'KeyR',
  83: 'KeyS',
  84: 'KeyT',
  85: 'KeyU',
  86: 'KeyV',
  87: 'KeyW',
  88: 'KeyX',
  89: 'KeyY',
  90: 'KeyZ',

  // Numpad
  96: 'Numpad0',
  97: 'Numpad1',
  98: 'Numpad2',
  99: 'Numpad3',
  100: 'Numpad4',
  101: 'Numpad5',
  102: 'Numpad6',
  103: 'Numpad7',
  104: 'Numpad8',
  105: 'Numpad9',
  106: 'NumpadMultiply',
  107: 'NumpadAdd',
  109: 'NumpadSubtract',
  110: 'NumpadDecimal',
  111: 'NumpadDivide',

  // Function keys
  112: 'F1',
  113: 'F2',
  114: 'F3',
  115: 'F4',
  116: 'F5',
  117: 'F6',
  118: 'F7',
  119: 'F8',
  120: 'F9',
  121: 'F10',
  122: 'F11',
  123: 'F12',
  124: 'F13',
  125: 'F14',
  126: 'F15',
  127: 'F16',
  128: 'F17',
  129: 'F18',
  130: 'F19',
  131: 'F20',
  132: 'F21',
  133: 'F22',
  134: 'F23',
  135: 'F24',

  // Lock keys
  144: 'NumLock',
  145: 'ScrollLock',

  // Punctuation / symbols (US QWERTY positions)
  186: 'Semicolon',
  187: 'Equal',
  188: 'Comma',
  189: 'Minus',
  190: 'Period',
  191: 'Slash',
  192: 'Backquote',
  219: 'BracketLeft',
  220: 'Backslash',
  221: 'BracketRight',
  222: 'Quote',
});

/**
 * Derive a human-readable display label from an event.code string.
 * Used during migration to populate the displayKey field.
 * @param {string} code - event.code value (e.g., "KeyS", "Digit5", "F10")
 * @returns {string} Display-friendly label (e.g., "s", "5", "F10")
 */
export function displayKeyFromCode(code) {
  if (!code) {
    return '';
  }
  // Letter keys: "KeyA" → "a"
  if (code.startsWith('Key') && code.length === 4) {
    return code.charAt(3).toLowerCase();
  }
  // Digit row: "Digit5" → "5"
  if (code.startsWith('Digit') && code.length === 6) {
    return code.charAt(5);
  }
  // Numpad digits: "Numpad3" → "Num 3"
  if (/^Numpad\d$/.test(code)) {
    return `Num ${code.charAt(6)}`;
  }
  // Numpad operators
  const numpadOps = {
    NumpadEnter: 'Num Enter',
    NumpadMultiply: 'Num *',
    NumpadAdd: 'Num +',
    NumpadSubtract: 'Num -',
    NumpadDecimal: 'Num .',
    NumpadDivide: 'Num /',
  };
  if (numpadOps[code]) {
    return numpadOps[code];
  }
  // Punctuation: map code name to the actual character
  const punctuation = {
    Semicolon: ';',
    Equal: '=',
    Comma: ',',
    Minus: '-',
    Period: '.',
    Slash: '/',
    Backquote: '`',
    BracketLeft: '[',
    Backslash: '\\',
    BracketRight: ']',
    Quote: "'",
  };
  if (punctuation[code]) {
    return punctuation[code];
  }
  // Everything else (Space, Backspace, Enter, Escape, Arrow*, F1-F24, Delete, etc.)
  // is already human-readable as-is
  return code;
}

/** All predefined action names, in display order. */
export const PREDEFINED_ACTIONS = [
  'slower',
  'faster',
  'rewind',
  'advance',
  'reset',
  'fast',
  'display',
  'mark',
  'jump',
];

/**
 * Complete default bindings for all predefined actions (v2 schema).
 * Single source of truth — used by DEFAULT_SETTINGS (constants.js),
 * migration Phase 4 (background.js), and restore_defaults (options.js).
 */
export const DEFAULT_BINDINGS = Object.freeze({
  slower: { code: 'KeyS', key: 83, keyCode: 83, displayKey: 's', value: 0.1 },
  faster: { code: 'KeyD', key: 68, keyCode: 68, displayKey: 'd', value: 0.1 },
  rewind: { code: 'KeyZ', key: 90, keyCode: 90, displayKey: 'z', value: 10 },
  advance: { code: 'KeyX', key: 88, keyCode: 88, displayKey: 'x', value: 10 },
  reset: { code: 'KeyR', key: 82, keyCode: 82, displayKey: 'r', value: 1.0 },
  fast: { code: 'KeyG', key: 71, keyCode: 71, displayKey: 'g', value: 1.8 },
  display: { code: 'KeyV', key: 86, keyCode: 86, displayKey: 'v', value: 0 },
  mark: { code: 'KeyM', key: 77, keyCode: 77, displayKey: 'm', value: 0 },
  jump: { code: 'KeyJ', key: 74, keyCode: 74, displayKey: 'j', value: 0 },
});

/**
 * A fresh list of the default bindings, one per predefined action.
 * Callers own the result and may edit it in place.
 */
export function defaultKeyBindings() {
  return PREDEFINED_ACTIONS.map((action) => ({
    action,
    ...DEFAULT_BINDINGS[action],
    predefined: true,
  }));
}

/** event.code values that must not be recorded as shortcuts. */
export const BLACKLISTED_CODES = new Set([
  'Tab',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'ContextMenu',
  'CapsLock',
  'NumLock',
  'ScrollLock',
]);
