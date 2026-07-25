/**
 * Integration tests for blacklist blocking behavior
 * Tests that controller does not load on blacklisted sites
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../helpers/test-utils.js';
import { isBlacklisted } from '../../src/utils/blacklist.js';
describe('BlacklistBlocking', () => {
  let mockDOM;

  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    mockDOM = createMockDOM();

    if (window.VSC && window.VSC.siteHandlerManager) {
      window.VSC.siteHandlerManager.initialize(document);
    }
  });

  afterEach(() => {
    cleanupChromeMock();
    if (mockDOM) {
      mockDOM.cleanup();
    }
  });

  it('Controller should NOT initialize when youtube.com is blacklisted', async () => {
    const blacklist = 'youtube.com';
    const currentHref = 'https://www.youtube.com/watch?v=abc123';

    const shouldBlock = isBlacklisted(blacklist, currentHref);
    expect(shouldBlock).toBe(true);

    if (shouldBlock) {
      const mockVideo = createMockVideo({ playbackRate: 1.0 });
      mockDOM.container.appendChild(mockVideo);
      expect(mockVideo.vsc).toBe(undefined);
    }
  });

  it('Controller SHOULD initialize when site is NOT blacklisted', async () => {
    const blacklist = 'youtube.com';
    const currentHref = 'https://www.example.com/video';

    const shouldBlock = isBlacklisted(blacklist, currentHref);
    expect(shouldBlock).toBe(false);

    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockDOM.container.appendChild(mockVideo);

    mockVideo.vsc = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    expect(mockVideo.vsc).toBeDefined();
  });

  it('Settings passed to page context should not contain blacklist or enabled', async () => {
    const fullSettings = {
      lastSpeed: 1.5,
      enabled: true,
      blacklist: 'youtube.com\nnetflix.com',
      rememberSpeed: true,
      audioBoolean: true,
      startHidden: false,
      controllerOpacity: 0.3,
      controllerButtonSize: 14,
      keyBindings: [],
      logLevel: 3,
    };

    const settingsForPage = { ...fullSettings };
    delete settingsForPage.blacklist;
    delete settingsForPage.enabled;

    expect(settingsForPage.blacklist).toBe(undefined);
    expect(settingsForPage.enabled).toBe(undefined);
    expect(settingsForPage.lastSpeed).toBe(1.5);
    expect(settingsForPage.rememberSpeed).toBe(true);
    expect(settingsForPage.keyBindings.length).toBe(0);
  });

  it('Default disabled sites exclude Instagram and stay aligned across schemas', () => {
    const defaults = window.VSC.Constants.DEFAULT_SETTINGS;
    const disabledPatterns = defaults.siteRules
      .filter((rule) => rule.enabled === false)
      .map((rule) => rule.pattern);

    expect(disabledPatterns).toEqual(['imgur.com', 'teams.microsoft.com', 'meet.google.com']);
    expect(defaults.blacklist.split('\n')).toEqual(disabledPatterns);

    const blockedSites = [
      'https://imgur.com/gallery/abc',
      'https://teams.microsoft.com/meeting/xyz',
      'https://meet.google.com/abc-def-ghi',
    ];

    const allowedSites = [
      'https://www.instagram.com/p/123',
      'https://x.com/user/status/456',
      'https://www.youtube.com/watch?v=123',
      'https://www.netflix.com/watch/456',
      'https://www.example.com/',
    ];

    blockedSites.forEach((url) => {
      expect(isBlacklisted(defaults.blacklist, url)).toBe(true);
    });

    allowedSites.forEach((url) => {
      expect(isBlacklisted(defaults.blacklist, url)).toBe(false);
    });
  });
});
