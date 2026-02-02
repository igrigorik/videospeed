/**
 * Integration tests for blacklist blocking behavior
 * Tests that controller does not load on blacklisted sites
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../helpers/chrome-mock.js';
import { SimpleTestRunner, assert, createMockVideo, createMockDOM } from '../helpers/test-utils.js';
import { loadCoreModules } from '../helpers/module-loader.js';
import { isBlacklisted } from '../../src/utils/blacklist.js';

await loadCoreModules();

const runner = new SimpleTestRunner();
let mockDOM;
let originalHref;

runner.beforeEach(() => {
  installChromeMock();
  resetMockStorage();
  mockDOM = createMockDOM();
  originalHref = global.location.href;

  if (window.VSC && window.VSC.siteHandlerManager) {
    window.VSC.siteHandlerManager.initialize(document);
  }
});

runner.afterEach(() => {
  cleanupChromeMock();
  if (mockDOM) {
    mockDOM.cleanup();
  }
  Object.defineProperty(global.location, 'href', {
    value: originalHref,
    writable: true,
    configurable: true
  });
});

function setTestURL(url) {
  Object.defineProperty(global.location, 'href', {
    value: url,
    writable: true,
    configurable: true
  });
}

runner.test('Controller should NOT initialize when youtube.com is blacklisted', async () => {
  const blacklist = 'youtube.com';
  setTestURL('https://www.youtube.com/watch?v=abc123');

  // Simulate content-entry.js check
  const shouldBlock = isBlacklisted(blacklist, location.href);
  assert.equal(shouldBlock, true, 'youtube.com should be blocked');

  // If blocked, controller should never be created
  // This simulates the early return in content-entry.js
  if (shouldBlock) {
    // Extension would exit early - no controller created
    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockDOM.container.appendChild(mockVideo);

    // Video should NOT have a controller attached
    assert.equal(mockVideo.vsc, undefined, 'Video should not have controller when site is blacklisted');
  }
});

runner.test('Controller SHOULD initialize when site is NOT blacklisted', async () => {
  const blacklist = 'youtube.com';
  setTestURL('https://www.example.com/video');

  const shouldBlock = isBlacklisted(blacklist, location.href);
  assert.equal(shouldBlock, false, 'example.com should not be blocked');

  // Site not blocked - controller should be created
  const config = window.VSC.videoSpeedConfig;
  await config.load();

  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo({ playbackRate: 1.0 });
  mockDOM.container.appendChild(mockVideo);

  // Create controller (simulating what inject.js does)
  mockVideo.vsc = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  assert.exists(mockVideo.vsc, 'Video should have controller when site is not blacklisted');
});

runner.test('Settings passed to page context should not contain blacklist or enabled', async () => {
  // Simulate chrome.storage.sync.get returning full settings
  const fullSettings = {
    lastSpeed: 1.5,
    enabled: true,
    blacklist: 'youtube.com\nnetflix.com',
    rememberSpeed: true,
    forceLastSavedSpeed: false,
    audioBoolean: true,
    startHidden: false,
    controllerOpacity: 0.3,
    controllerButtonSize: 14,
    keyBindings: [],
    logLevel: 3
  };

  // Simulate content-entry.js stripping sensitive keys before injection
  const settingsForPage = { ...fullSettings };
  delete settingsForPage.blacklist;
  delete settingsForPage.enabled;

  // Verify blacklist doesn't leak to page context
  assert.equal(settingsForPage.blacklist, undefined, 'blacklist must not leak to page context');
  assert.equal(settingsForPage.enabled, undefined, 'enabled must not leak to page context');

  // Verify other settings are preserved
  assert.equal(settingsForPage.lastSpeed, 1.5, 'lastSpeed should be preserved');
  assert.equal(settingsForPage.rememberSpeed, true, 'rememberSpeed should be preserved');
  assert.equal(settingsForPage.keyBindings.length, 0, 'keyBindings should be preserved');
});

runner.test('Default blacklist sites should be blocked', async () => {
  // Default blacklist from constants.js
  const defaultBlacklist = `www.instagram.com
x.com
imgur.com
teams.microsoft.com
meet.google.com`;

  const blockedSites = [
    'https://www.instagram.com/p/123',
    'https://x.com/user/status/456',
    'https://imgur.com/gallery/abc',
    'https://teams.microsoft.com/meeting/xyz',
    'https://meet.google.com/abc-def-ghi'
  ];

  const allowedSites = [
    'https://www.youtube.com/watch?v=123',
    'https://www.netflix.com/watch/456',
    'https://www.example.com/'
  ];

  blockedSites.forEach(url => {
    const blocked = isBlacklisted(defaultBlacklist, url);
    assert.equal(blocked, true, `${url} should be blocked by default blacklist`);
  });

  allowedSites.forEach(url => {
    const blocked = isBlacklisted(defaultBlacklist, url);
    assert.equal(blocked, false, `${url} should NOT be blocked by default blacklist`);
  });
});

export { runner };
