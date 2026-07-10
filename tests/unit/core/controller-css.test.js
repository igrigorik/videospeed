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
    window.VSC.StorageManager.contextUrl = window.location.href;
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

  it('preprocesses domain CSS using an inherited frame context hostname', () => {
    window.VSC.StorageManager.contextUrl = 'https://www.netflix.com/watch/123';
    const processed = window.VSC_controller.preprocessDomainCSS(
      window.VSC.Constants.DEFAULT_CONTROLLER_CSS
    );

    expect(processed).toContain('vsc-controller {\n  position: relative;\n  top: 85px;');
    expect(processed).not.toContain('--vsc-domain: "netflix.com"');
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
