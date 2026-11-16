/**
 * Unit tests for runtime-settings.js — the projection of stored settings that
 * the content bridge sends to the page script.
 *
 * The property that matters most is noninterference: a setting the page may
 * not see must not change what the page is told. Several tests therefore vary
 * private settings and assert that the projection stays the same.
 */

import { defaultKeyBindings } from '../../../src/utils/key-maps.js';
import {
  DEFAULT_LAST_SPEED,
  LOG_LEVELS,
  PREFERENCE_DEFAULTS,
  normalizeRememberedSpeed,
  normalizeRuntimeSettings,
  normalizeSpeed,
  preferenceChanges,
  projectPreferences,
  resolveRuntimeSettings,
} from '../../../src/utils/runtime-settings.js';

const PAGE = 'https://video.example/watch?v=1';

const PREFERENCE_KEYS = [
  'rememberSpeed',
  'exclusiveKeys',
  'audioBoolean',
  'startHidden',
  'controllerOpacity',
  'controllerButtonSize',
  'customCSS',
  'keyBindings',
  'logLevel',
];

/**
 * Settings with a stored default that never cross the bridge as stored (see
 * the classification test). Any other stored key is private by construction:
 * the projection only reads the runtime preferences.
 */
const PRIVATE_KEYS = [
  'schemaVersion',
  'lastSpeed',
  'enabled',
  'siteRules',
  'blacklist',
  'defaultLogLevel',
];

const rule = (pattern, overrides = {}) => ({ pattern, enabled: true, speed: null, ...overrides });

const defaultRuntimeBindings = () =>
  defaultKeyBindings().map(({ action, value, code, keyCode, key }) => ({
    action,
    value,
    code,
    keyCode,
    key,
  }));

describe('normalizeSpeed', () => {
  it.each([
    [1.5, 1.5],
    ['1.5', 1.5],
    [1.23456789, 1.23456789],
    [0.01, 0.07],
    [99, 16],
    [0, null],
    [-2, null],
    [NaN, null],
    [Infinity, null],
    ['', null],
    ['  ', null],
    ['fast', null],
    [true, null],
    [null, null],
    [undefined, null],
    [{}, null],
  ])('%o → %o', (value, expected) => {
    expect(normalizeSpeed(value)).toBe(expected);
  });
});

describe('normalizeRememberedSpeed', () => {
  it.each([
    [2.5, 2.5],
    [1.234567891234567, 1.23],
    [0.074, 0.07],
    [99, 16],
    ['fast', null],
    [undefined, null],
  ])('%o → %o', (value, expected) => {
    expect(normalizeRememberedSpeed(value)).toBe(expected);
  });
});

describe('projectPreferences', () => {
  it('fills every preference with its default when nothing is stored', () => {
    expect(projectPreferences({})).toEqual({
      rememberSpeed: false,
      exclusiveKeys: false,
      audioBoolean: true,
      startHidden: false,
      controllerOpacity: 0.3,
      controllerButtonSize: 14,
      customCSS: '',
      keyBindings: defaultRuntimeBindings(),
      logLevel: LOG_LEVELS.WARNING,
    });
  });

  it('contains the runtime preferences and nothing else', () => {
    const projected = projectPreferences({
      siteRules: [rule('private.example')],
      blacklist: 'private.example',
      lastSpeed: 2,
      enabled: true,
      schemaVersion: 2,
      somethingNew: 'unclassified',
    });

    expect(Object.keys(projected)).toEqual(PREFERENCE_KEYS);
  });

  it('keeps saved values that happen to be falsy', () => {
    const projected = projectPreferences({
      audioBoolean: false,
      controllerOpacity: 0,
      customCSS: '',
    });

    expect(projected.audioBoolean).toBe(false);
    expect(projected.controllerOpacity).toBe(0);
    expect(projected.customCSS).toBe('');
  });

  it('reads numeric strings as numbers', () => {
    const projected = projectPreferences({ controllerOpacity: '0.5', logLevel: '5' });

    expect(projected.controllerOpacity).toBe(0.5);
    expect(projected.logLevel).toBe(LOG_LEVELS.DEBUG);
  });

  it.each([
    ['controllerOpacity', 'opaque'],
    ['controllerOpacity', null],
    ['controllerButtonSize', {}],
    ['customCSS', 42],
    ['logLevel', 9],
    ['logLevel', 2.5],
    ['keyBindings', 'KeyD'],
    ['keyBindings', []],
  ])('falls back to the default when %s is %o', (key, value) => {
    expect(projectPreferences({ [key]: value })[key]).toEqual(projectPreferences({})[key]);
  });

  it('is idempotent', () => {
    const once = projectPreferences({
      rememberSpeed: 1,
      controllerOpacity: '0.5',
      logLevel: 'verbose',
      keyBindings: [
        { action: 'faster', code: 'KeyD', value: 0.25, displayKey: 'd', modifiers: { shift: 1 } },
      ],
    });

    expect(projectPreferences(once)).toEqual(once);
  });

  describe('key bindings', () => {
    const project = (keyBindings) => projectPreferences({ keyBindings }).keyBindings;

    it('keeps the fields the page script reads, in stored order', () => {
      const bindings = project([
        {
          action: 'faster',
          code: 'KeyD',
          key: 68,
          keyCode: 68,
          value: 0.25,
          displayKey: 'd',
          predefined: true,
          force: false,
          note: 'private',
        },
        { action: 'pause', code: 'KeyP', key: 80, keyCode: 80, value: 0, displayKey: 'p' },
      ]);

      expect(bindings).toEqual([
        { action: 'faster', value: 0.25, code: 'KeyD', keyCode: 68, key: 68 },
        { action: 'pause', value: 0, code: 'KeyP', keyCode: 80, key: 80 },
      ]);
    });

    it('omits modifiers when none is set, so the binding stays a plain key', () => {
      const [binding] = project([
        {
          action: 'faster',
          code: 'KeyD',
          value: 0.1,
          modifiers: { shift: false, ctrl: 0, alt: null },
        },
      ]);

      expect(binding).not.toHaveProperty('modifiers');
    });

    it('reports modifiers as four strict booleans', () => {
      const [binding] = project([
        { action: 'faster', code: 'KeyD', value: 0.1, modifiers: { shift: 1, extra: true } },
      ]);

      expect(binding.modifiers).toEqual({ shift: true, ctrl: false, alt: false, meta: false });
    });

    it('keeps a null code and the legacy key of an unmigrated binding', () => {
      const bindings = project([
        { action: 'pause', code: null, key: 80, value: 0 },
        { action: 'muted', key: 77, value: 0 },
      ]);

      expect(bindings).toEqual([
        { action: 'pause', value: 0, code: null, key: 80 },
        { action: 'muted', value: 0, key: 77 },
      ]);
    });

    it('drops entries that are not bindings and values that are not primitives', () => {
      const bindings = project([
        null,
        'faster',
        { code: 'KeyD', value: 0.1 },
        { action: 'faster', code: 'KeyD', value: { nested: 'private' } },
      ]);

      expect(bindings).toEqual([{ action: 'faster', code: 'KeyD' }]);
    });

    it('uses the default bindings when no usable binding remains', () => {
      expect(project([null, { value: 1 }])).toEqual(defaultRuntimeBindings());
    });
  });
});

describe('resolveRuntimeSettings', () => {
  it('answers with one initial speed and the runtime preferences, nothing else', () => {
    const settings = resolveRuntimeSettings({ siteRules: [rule('private.example')] }, PAGE);

    expect(Object.keys(settings)).toEqual(['initialSpeed', ...PREFERENCE_KEYS]);
  });

  describe('whether VSC runs on the document', () => {
    it('is off when the extension is disabled', () => {
      expect(resolveRuntimeSettings({ enabled: false }, PAGE)).toBeNull();
    });

    it('is off when the first matching rule is disabled', () => {
      const siteRules = [rule('video.example', { enabled: false }), rule('video.example')];

      expect(resolveRuntimeSettings({ siteRules }, PAGE)).toBeNull();
    });

    it('is on when an enabled rule matches before a disabled one', () => {
      const siteRules = [rule('video.example'), rule('video.example', { enabled: false })];

      expect(resolveRuntimeSettings({ siteRules }, PAGE)).not.toBeNull();
    });

    it.each([
      ['a path', 'video.example/watch'],
      ['a regex with flags', '/WATCH\\?v=\\d+$/i'],
    ])('matches %s against the whole document URL', (_label, pattern) => {
      const siteRules = [rule(pattern, { enabled: false })];

      expect(resolveRuntimeSettings({ siteRules }, PAGE)).toBeNull();
      expect(resolveRuntimeSettings({ siteRules }, 'https://video.example/')).not.toBeNull();
    });

    it('honors a legacy blacklist when no site rules are saved', () => {
      expect(
        resolveRuntimeSettings({ blacklist: 'other.example\nvideo.example' }, PAGE)
      ).toBeNull();
    });

    it('ignores the legacy blacklist once site rules are saved, even an empty list', () => {
      const stored = { siteRules: [], blacklist: 'video.example' };

      expect(resolveRuntimeSettings(stored, PAGE)).not.toBeNull();
    });
  });

  describe('the initial speed', () => {
    const initialSpeed = (stored) => resolveRuntimeSettings(stored, PAGE).initialSpeed;

    it('is null, not 1, when VSC has no opinion', () => {
      expect(initialSpeed({})).toBeNull();
    });

    it('is the matching rule speed, whether or not speed is remembered', () => {
      const siteRules = [rule('video.example', { speed: 2 })];

      expect(initialSpeed({ siteRules, rememberSpeed: false, lastSpeed: 1.5 })).toBe(2);
      expect(initialSpeed({ siteRules, rememberSpeed: true, lastSpeed: 1.5 })).toBe(2);
    });

    it('is the remembered speed only when the user asked to remember it', () => {
      expect(initialSpeed({ rememberSpeed: true, lastSpeed: 1.5 })).toBe(1.5);
      expect(initialSpeed({ rememberSpeed: false, lastSpeed: 1.5 })).toBeNull();
    });

    it('is the default speed when remembering is on and no speed was saved yet', () => {
      expect(initialSpeed({ rememberSpeed: true })).toBe(DEFAULT_LAST_SPEED);
    });

    it('is null when the saved speed is unusable', () => {
      expect(initialSpeed({ rememberSpeed: true, lastSpeed: 'fast' })).toBeNull();
      expect(initialSpeed({ rememberSpeed: true, lastSpeed: null })).toBeNull();
    });

    it.each([[null], ['fast'], [0]])(
      'falls back to the remembered speed when the rule speed is %o',
      (speed) => {
        const siteRules = [rule('video.example', { speed }), rule('video.example', { speed: 3 })];

        expect(initialSpeed({ siteRules, rememberSpeed: true, lastSpeed: 1.5 })).toBe(1.5);
        expect(initialSpeed({ siteRules, rememberSpeed: false, lastSpeed: 1.5 })).toBeNull();
      }
    );

    it('clamps a rule speed and leaves its precision alone', () => {
      expect(initialSpeed({ siteRules: [rule('video.example', { speed: 20 })] })).toBe(16);
      expect(initialSpeed({ siteRules: [rule('video.example', { speed: '1.125' })] })).toBe(1.125);
    });

    it('rounds a remembered speed to the two decimals VSC stores', () => {
      expect(initialSpeed({ rememberSpeed: true, lastSpeed: 1.234567891234567 })).toBe(1.23);
    });
  });

  describe('noninterference', () => {
    // Compared as JSON: what a page reads is the serialized payload, where key
    // order and undefined-valued properties show, and toEqual ignores both.
    const bindings = [
      {
        action: 'faster',
        code: 'KeyD',
        value: 0.25,
        displayKey: 'd',
        modifiers: { shift: true, ctrl: false, alt: false, meta: false },
      },
    ];

    it('is unchanged by settings the page may not see', () => {
      const shared = { rememberSpeed: true, customCSS: 'vsc-controller { top: 4px; }' };
      const one = resolveRuntimeSettings(
        {
          ...shared,
          keyBindings: bindings,
          lastSpeed: 1.5,
          siteRules: [
            rule('private-health.example', { enabled: false }),
            rule('video.example', { speed: 2 }),
          ],
        },
        PAGE
      );
      const other = resolveRuntimeSettings(
        {
          ...shared,
          keyBindings: [
            {
              predefined: true,
              note: { nested: 'private' },
              modifiers: { meta: 0, shift: 1 },
              displayKey: 'D',
              value: 0.25,
              code: 'KeyD',
              action: 'faster',
            },
          ],
          lastSpeed: 9.87654321,
          siteRules: [
            rule('/private-bank\\.example/i', { speed: 3, note: 'private' }),
            rule('video.example', { speed: 2 }),
          ],
          blacklist: 'private-legacy.example',
          schemaVersion: 7,
          somethingNew: 'private',
        },
        PAGE
      );

      expect(JSON.stringify(other)).toBe(JSON.stringify(one));
      expect(JSON.stringify(other)).not.toContain('private');
    });

    it('does not reveal whether the speed came from a rule or was remembered', () => {
      const fromRule = resolveRuntimeSettings(
        { rememberSpeed: true, lastSpeed: 1.5, siteRules: [rule('video.example', { speed: 2 })] },
        PAGE
      );
      const remembered = resolveRuntimeSettings({ rememberSpeed: true, lastSpeed: 2 }, PAGE);

      expect(JSON.stringify(remembered)).toBe(JSON.stringify(fromRule));
    });

    it('does not reveal a remembered speed that is not in use', () => {
      const one = resolveRuntimeSettings({ rememberSpeed: false, lastSpeed: 1.5 }, PAGE);
      const other = resolveRuntimeSettings({ rememberSpeed: false, lastSpeed: 3.14159 }, PAGE);

      expect(JSON.stringify(other)).toBe(JSON.stringify(one));
    });
  });
});

describe('preferenceChanges', () => {
  it('is null when only private settings change', () => {
    const before = { siteRules: [rule('one.example')], lastSpeed: 1.5, blacklist: 'a.example' };
    const after = {
      siteRules: [rule('two.example', { enabled: false })],
      lastSpeed: 3,
      blacklist: 'b.example',
      schemaVersion: 2,
      somethingNew: 'private',
    };

    expect(preferenceChanges(before, after)).toBeNull();
  });

  it('is null when only binding metadata changes', () => {
    const binding = { action: 'faster', code: 'KeyD', value: 0.1, displayKey: 'd' };
    const before = { keyBindings: [binding] };
    const after = { keyBindings: [{ ...binding, displayKey: 'D', predefined: true }] };

    expect(preferenceChanges(before, after)).toBeNull();
  });

  it('is null when a value changes form but not meaning', () => {
    const binding = { action: 'faster', code: 'KeyD', value: 0.1 };
    const before = { controllerOpacity: 0.5, keyBindings: [binding] };
    const after = {
      controllerOpacity: '0.5',
      keyBindings: [{ ...binding, modifiers: { shift: false } }],
    };

    expect(preferenceChanges(before, after)).toBeNull();
  });

  it('reports each changed preference with its new value only', () => {
    const before = { customCSS: 'vsc-controller { top: 4px; }', startHidden: false, logLevel: 3 };
    const after = { customCSS: '', startHidden: true, logLevel: 3 };

    expect(preferenceChanges(before, after)).toEqual({
      customCSS: { newValue: '' },
      startHidden: { newValue: true },
    });
  });

  it('reports the default when a saved preference is removed', () => {
    expect(preferenceChanges({ audioBoolean: false }, {})).toEqual({
      audioBoolean: { newValue: true },
    });
    expect(preferenceChanges({}, {})).toBeNull();
  });
});

describe('normalizeRuntimeSettings', () => {
  it("passes the bridge's answer through unchanged", () => {
    const answer = resolveRuntimeSettings(
      {
        rememberSpeed: true,
        lastSpeed: 1.75,
        startHidden: true,
        keyBindings: [
          { action: 'faster', code: 'KeyD', value: 0.25, modifiers: { shift: true } },
          { action: 'pause', code: null, key: 80, value: 0 },
        ],
      },
      PAGE
    );

    expect(normalizeRuntimeSettings(answer)).toEqual(answer);
  });

  it('reduces anything else to the same shape', () => {
    const settings = normalizeRuntimeSettings({
      initialSpeed: 'fast',
      startHidden: 'yes',
      controllerOpacity: {},
      siteRules: [rule('private.example')],
    });

    expect(Object.keys(settings)).toEqual(['initialSpeed', ...PREFERENCE_KEYS]);
    expect(settings.initialSpeed).toBeNull();
    expect(settings.startHidden).toBe(true);
    expect(settings.controllerOpacity).toBe(PREFERENCE_DEFAULTS.controllerOpacity);
  });

  it('has no speed opinion when none was sent', () => {
    expect(normalizeRuntimeSettings({}).initialSpeed).toBeNull();
  });
});

describe('stored settings and the runtime projection', () => {
  const storedDefaults = () => window.VSC.Constants.DEFAULT_SETTINGS;

  // A new setting must be classified before it ships. If the page script needs
  // it, add it to PREFERENCES in runtime-settings.js; if it must stay out of
  // the page, add it to PRIVATE_KEYS above. Until then this test fails.
  it('classifies every stored setting as a runtime preference or private', () => {
    expect(Object.keys(storedDefaults()).sort()).toEqual(
      [...PREFERENCE_KEYS, ...PRIVATE_KEYS].sort()
    );
  });

  it('lists exactly the runtime preferences', () => {
    expect(Object.keys(PREFERENCE_DEFAULTS)).toEqual(PREFERENCE_KEYS);
  });

  it('gives the page the same defaults the options page shows', () => {
    expect(projectPreferences(storedDefaults())).toEqual(projectPreferences({}));
  });
});
