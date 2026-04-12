/**
 * Unit tests for the speed resolution state machine (getTargetSpeed).
 *
 * Covers all rows of the truth table from plan.md:
 *   baseline = siteDefaultSpeed ?? 1.0
 *   lastSpeed wins if user has changed it (in-memory, !== 1.0)
 *   rememberSpeed controls cross-session storage persistence only
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';

let mockDOM;

describe('SpeedResolution', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    mockDOM = createMockDOM();
    if (window.VSC?.stateManager) {
      window.VSC.stateManager.controllers.clear();
    }
    if (window.VSC?.siteHandlerManager) {
      window.VSC.siteHandlerManager.initialize(document);
    }
  });

  afterEach(() => {
    cleanupChromeMock();
    if (window.VSC?.stateManager) {
      window.VSC.stateManager.controllers.clear();
    }
    document.querySelectorAll('video, audio').forEach((el) => el.remove());
    if (mockDOM) {
      mockDOM.cleanup();
    }
  });

  function makeController(config) {
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const video = createMockVideo();
    mockDOM.container.appendChild(video);
    return new window.VSC.VideoController(video, null, config, actionHandler);
  }

  // --- Truth table row 1: rememberSpeed=OFF, no site rule, lastSpeed=1.0 → 1.0 ---
  it('no site rule, rememberSpeed OFF → baseline 1.0', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = false;
    config.settings.lastSpeed = 1.0;
    config.settings.siteDefaultSpeed = undefined;

    const ctrl = makeController(config);
    expect(ctrl.getTargetSpeed()).toBe(1.0);
  });

  // --- Truth table row 2: rememberSpeed=OFF, site rule speed=2.0, lastSpeed=1.0 → 2.0 ---
  it('site rule speed=2.0, rememberSpeed OFF, lastSpeed default → site baseline 2.0', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = false;
    config.settings.lastSpeed = 1.0;
    config.settings.siteDefaultSpeed = 2.0;

    const ctrl = makeController(config);
    expect(ctrl.getTargetSpeed()).toBe(2.0);
  });

  // --- Truth table row 3: rememberSpeed=ON, no site rule, lastSpeed=1.5 → 1.5 ---
  it('rememberSpeed ON, lastSpeed=1.5, no site rule → 1.5 (global carry)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;
    config.settings.lastSpeed = 1.5;
    config.settings.siteDefaultSpeed = undefined;

    const ctrl = makeController(config);
    expect(ctrl.getTargetSpeed()).toBe(1.5);
  });

  // --- Truth table row 4: rememberSpeed=ON, no site rule, lastSpeed=1.0 → 1.0 ---
  it('rememberSpeed ON, lastSpeed=1.0 (default), no site rule → 1.0', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;
    config.settings.lastSpeed = 1.0;
    config.settings.siteDefaultSpeed = undefined;

    const ctrl = makeController(config);
    expect(ctrl.getTargetSpeed()).toBe(1.0);
  });

  // --- Truth table row 5: rememberSpeed=ON, site=2.0, lastSpeed=1.5 → 1.5 (global carry wins) ---
  it('rememberSpeed ON, site=2.0, lastSpeed=1.5 → 1.5 (global carry wins)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;
    config.settings.lastSpeed = 1.5;
    config.settings.siteDefaultSpeed = 2.0;

    const ctrl = makeController(config);
    expect(ctrl.getTargetSpeed()).toBe(1.5);
  });

  // --- Truth table row 6: rememberSpeed=ON, site=2.0, lastSpeed=1.0 → 2.0 (baseline fills in) ---
  it('rememberSpeed ON, site=2.0, lastSpeed=1.0 (default) → 2.0 (baseline fills in)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;
    config.settings.lastSpeed = 1.0;
    config.settings.siteDefaultSpeed = 2.0;

    const ctrl = makeController(config);
    expect(ctrl.getTargetSpeed()).toBe(2.0);
  });

  // --- Session persistence: user changes speed mid-session, getTargetSpeed reflects it ---
  it('session: user changes speed to 1.4, getTargetSpeed returns 1.4', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = false;
    config.settings.lastSpeed = 1.0;
    config.settings.siteDefaultSpeed = 2.0;

    const ctrl = makeController(config);
    expect(ctrl.getTargetSpeed()).toBe(2.0);

    // Simulate user changing speed (setSpeed updates lastSpeed in-memory)
    config.settings.lastSpeed = 1.4;
    expect(ctrl.getTargetSpeed()).toBe(1.4);
  });

  // --- Edge: siteDefaultSpeed=null treated same as undefined ---
  it('siteDefaultSpeed=null falls back to 1.0 baseline', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = false;
    config.settings.lastSpeed = 1.0;
    config.settings.siteDefaultSpeed = null;

    const ctrl = makeController(config);
    expect(ctrl.getTargetSpeed()).toBe(1.0);
  });

  // --- Bug fix: user reset to 1.0 should stick on sites with per-site default ---
  it('user reset to 1.0 on site with siteDefaultSpeed=2.0 → 1.0 (not overridden)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = false;
    config.settings.lastSpeed = 1.0;
    config.settings.siteDefaultSpeed = 2.0;
    config.settings.userSpeedOverride = true; // user explicitly chose 1.0

    const ctrl = makeController(config);
    expect(ctrl.getTargetSpeed()).toBe(1.0);
  });

  // --- userSpeedOverride=false on fresh load still uses site baseline ---
  it('fresh load (no user action) with siteDefaultSpeed=2.0 → 2.0', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = false;
    config.settings.lastSpeed = 1.0;
    config.settings.siteDefaultSpeed = 2.0;
    config.settings.userSpeedOverride = false;

    const ctrl = makeController(config);
    expect(ctrl.getTargetSpeed()).toBe(2.0);
  });
});
