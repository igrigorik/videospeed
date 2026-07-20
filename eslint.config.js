import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.webextensions,
        chrome: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: 'error',
      curly: 'error',
      semi: ['error', 'always'],
      quotes: ['error', 'single', { avoidEscape: true }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'arrow-spacing': 'error',
      'no-duplicate-imports': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',
      'no-unreachable': 'error',
      'no-useless-return': 'error',
    },
  },
  {
    // Single-write discipline (docs/speed-arbitration.md): playbackRate and
    // lastSpeed are the arbitrated register and its authority. Only the
    // effect-execution layer may assign them — site handlers execute WRITE
    // (per-site strategies), and settings/action-handler own lastSpeed
    // persistence. Anywhere else, route the change through
    // ActionHandler.adjustSpeed / the arbitration adapter so the arbiter
    // stays the single decision point. Exceptional sites need a visible
    // inline disable with a justification.
    files: ['src/**/*.js'],
    ignores: ['src/site-handlers/**', 'src/core/settings.js', 'src/core/action-handler.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "AssignmentExpression[left.property.name='playbackRate']",
          message:
            'Direct playbackRate writes bypass speed arbitration. Route through ActionHandler.adjustSpeed or a site handler WRITE strategy (docs/speed-arbitration.md).',
        },
        {
          selector: "AssignmentExpression[left.property.name='lastSpeed']",
          message:
            'lastSpeed is arbitration authority. Only settings.js/action-handler.js may assign it (docs/speed-arbitration.md).',
        },
      ],
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
      },
    },
    rules: {
      'no-unused-expressions': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];
