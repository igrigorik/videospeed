/**
 * Unit tests for controller CSS feature.
 * Default CSS always comes from code (DEFAULT_CONTROLLER_CSS).
 * Only user customizations are stored in the `customCSS` setting.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
  getMockStorage,
} from '../../helpers/chrome-mock.js';
// Helper: ensure chrome mock is active and storage is clean
function setupMock() {
  installChromeMock();
  resetMockStorage();
  window.VSC_settings = null;
}

describe('ControllerCSS', () => {
  beforeEach(() => {
    setupMock();
  });

  afterEach(() => {
    cleanupChromeMock();
  });

  // --- Default CSS (code-driven) ---

  it('DEFAULT_CONTROLLER_CSS constant exists and is a non-empty string', () => {
    const css = window.VSC.Constants.DEFAULT_CONTROLLER_CSS;
    expect(css).toBeDefined();
    expect(typeof css).toBe('string');
    expect(css.length > 100).toBe(true);
  });

  it('DEFAULT_CONTROLLER_CSS contains site override rules (not base rule)', () => {
    const css = window.VSC.Constants.DEFAULT_CONTROLLER_CSS;
    // Base rule (position:absolute etc) is in inject.css for timing safety — not here
    expect(css.includes('vsc-controller')).toBe(true);
    expect(!css.startsWith('vsc-controller {')).toBe(true);
  });

  it('DEFAULT_CONTROLLER_CSS contains domain-based rules', () => {
    const css = window.VSC.Constants.DEFAULT_CONTROLLER_CSS;
    expect(css.includes('--vsc-domain: "facebook.com"')).toBe(true);
    expect(css.includes('--vsc-domain: "netflix.com"')).toBe(true);
    expect(css.includes('--vsc-domain: "chatgpt.com"')).toBe(true);
    expect(css.includes('--vsc-domain: "drive.google.com"')).toBe(true);
  });

  it('inject.css pins the absolute controller host origin', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/inject.css'), 'utf8');
    expect(css).toMatch(/vsc-controller\s*\{[^}]*position:\s*absolute;/s);
    expect(css).toMatch(/vsc-controller\s*\{[^}]*top:\s*0;/s);
    expect(css).toMatch(/vsc-controller\s*\{[^}]*left:\s*0;/s);
  });

  it('DEFAULT_CONTROLLER_CSS preserves DOM-contextual YouTube rules', () => {
    const css = window.VSC.Constants.DEFAULT_CONTROLLER_CSS;
    expect(css.includes('.ytp-hide-info-bar')).toBe(true);
    // .ytp-paid-content-overlay-link rule is injected dynamically (YouTube-only)
    // to avoid [style*=...] attribute selectors in the static stylesheet (#1501).
    expect(css.includes('#player > vsc-controller')).toBe(true);
  });

  it('implements YouTube autohide on the light-DOM host without :host-context()', () => {
    const css = window.VSC.Constants.DEFAULT_CONTROLLER_CSS;
    const shadowSource = readFileSync(join(process.cwd(), 'src/ui/shadow-dom.js'), 'utf8');
    const selector =
      '.ytp-autohide vsc-controller:not([data-vsc-visibility="show"]):not(.vsc-show)';

    expect(shadowSource).not.toContain(':host-context(');

    for (const hostname of ['www.youtube.com', 'www.youtube-nocookie.com']) {
      const resolved = window.VSC_controller.preprocessDomainCSS(css, hostname);
      const ruleStart = resolved.indexOf(selector);
      const rule = resolved.slice(ruleStart, resolved.indexOf('}', ruleStart) + 1);

      expect(ruleStart).toBeGreaterThanOrEqual(0);
      expect(rule).toContain('visibility: hidden !important');
      expect(rule).toContain('opacity: 0 !important');
    }

    expect(window.VSC_controller.preprocessDomainCSS(css, 'example.com')).not.toContain(selector);
  });

  it('positions the Shorts controller below the native top-left controls', () => {
    const css = window.VSC.Constants.DEFAULT_CONTROLLER_CSS;
    const selector = '#shorts-player > vsc-controller';
    const selectorStart = css.indexOf(selector);
    const ruleStart = css.lastIndexOf(':root', selectorStart);
    const rule = css.slice(ruleStart, css.indexOf('}', selectorStart));

    expect(selectorStart).toBeGreaterThanOrEqual(0);
    expect(rule).toContain('--vsc-domain: "youtube.com"');
    expect(rule).toContain('position: relative');
    expect(rule).toContain('top: 60px');
  });

  // --- Domain preprocessing (preprocessDomainCSS) ---

  describe('preprocessDomainCSS', () => {
    const preprocess = (css, hostname) => window.VSC_controller.preprocessDomainCSS(css, hostname);
    const wrap = (domain, selector) => `:root[style*='--vsc-domain: "${domain}"'] ${selector}`;

    it('strips the leading marker and keeps bare follower selectors on the matching domain', () => {
      // Contract: one marker on the FIRST selector scopes the whole rule.
      // jsdom hostname is localhost.
      const css = `${wrap('localhost', '.a > vsc-controller')},\n:has(> .b) > vsc-controller {\n  top: 10px;\n}`;
      const out = preprocess(css);
      expect(out.includes(':root[')).toBe(false);
      expect(out.includes('.a > vsc-controller')).toBe(true);
      expect(out.includes(':has(> .b) > vsc-controller')).toBe(true);
      expect(out.includes('top: 10px')).toBe(true);
    });

    it('drops the entire rule off-domain, including bare follower selectors', () => {
      const css = `${wrap('other.com', '.a vsc-controller')},\n.bare vsc-controller {\n  top: 1px;\n}\n${wrap('localhost', '.b vsc-controller')} {\n  top: 2px;\n}`;
      const out = preprocess(css);
      expect(out.includes('.a vsc-controller')).toBe(false);
      expect(out.includes('.bare vsc-controller')).toBe(false);
      expect(out.includes('top: 1px')).toBe(false);
      expect(out.includes('.b vsc-controller')).toBe(true);
      expect(out.includes('top: 2px')).toBe(true);
    });

    it('removes every domain marker and [style*] probe from the shipped defaults off-domain (#1501)', () => {
      const out = preprocess(window.VSC.Constants.DEFAULT_CONTROLLER_CSS);
      // Comments may mention the marker syntax; only live selector text
      // reaches the style engine, so assert on the comment-stripped sheet.
      const liveCss = out.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(liveCss.includes('--vsc-domain')).toBe(false);
      expect(liveCss.includes(':root[')).toBe(false);
      expect(liveCss.includes('[style*')).toBe(false);
      // Unwrapped DOM-contextual rules survive untouched.
      expect(liveCss.includes('.Shared-Video-player > vsc-controller')).toBe(true);
    });
  });

  // --- Custom CSS (user additions, stored separately) ---

  it('DEFAULT_SETTINGS includes customCSS field defaulting to empty string', () => {
    const defaults = window.VSC.Constants.DEFAULT_SETTINGS;
    expect('customCSS' in defaults).toBe(true);
    expect(defaults.customCSS).toBe('');
  });

  it('customCSS loads from storage into settings', async () => {
    setupMock();
    const userCSS = 'vsc-controller { top: 999px; }';
    getMockStorage().customCSS = userCSS;

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    expect(config.settings.customCSS).toBe(userCSS);
  });

  it('customCSS falls back to empty string when absent from storage', async () => {
    setupMock();

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    expect(config.settings.customCSS).toBe('');
  });

  it('customCSS round-trips through save and load', async () => {
    setupMock();

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const userCSS = 'vsc-controller { position: relative; top: 42px; }';
    await config.save({ customCSS: userCSS });

    const config2 = new window.VSC.VideoSpeedConfig();
    await config2.load();

    expect(config2.settings.customCSS).toBe(userCSS);
  });

  // --- Migration: old controllerCSS blob → customCSS ---

  it('migration: old controllerCSS matching current default clears to empty customCSS', async () => {
    setupMock();
    getMockStorage().controllerCSS = window.VSC.Constants.DEFAULT_CONTROLLER_CSS;

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    expect(config.settings.customCSS).toBe('');
  });

  it('migration: old controllerCSS with customizations resets to empty (breaking migration)', async () => {
    setupMock();
    getMockStorage().controllerCSS = `${window.VSC.Constants.DEFAULT_CONTROLLER_CSS}\n/* custom */ vsc-controller { border: 1px solid red; }`;

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    // Intentional: new model doesn't attempt to salvage old blob customizations.
    expect(config.settings.customCSS).toBe('');
  });
});
