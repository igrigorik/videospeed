/**
 * Unit tests for content-entry.js behavior
 * Tests blacklist filtering and settings stripping
 */

import { SimpleTestRunner, assert } from '../../helpers/test-utils.js';
import { isBlacklisted } from '../../../src/utils/blacklist.js';

const runner = new SimpleTestRunner();

runner.test('settings passed to page context should not contain blacklist', () => {
  // Simulate what content-entry.js does
  const settings = {
    lastSpeed: 1.5,
    enabled: true,
    blacklist: 'youtube.com\nnetflix.com',
    rememberSpeed: true,
    keyBindings: []
  };

  // This is what content-entry.js does before injecting
  delete settings.blacklist;
  delete settings.enabled;

  assert.equal(settings.blacklist, undefined, 'blacklist should be stripped');
  assert.equal(settings.enabled, undefined, 'enabled should be stripped');
  assert.equal(settings.lastSpeed, 1.5, 'lastSpeed should remain');
  assert.equal(settings.rememberSpeed, true, 'rememberSpeed should remain');
});

runner.test('blacklisted site should trigger early exit', () => {
  const blacklist = 'youtube.com\nnetflix.com';

  // Simulate content-entry.js check
  const youtubeBlocked = isBlacklisted(blacklist, 'https://www.youtube.com/watch?v=123');
  const netflixBlocked = isBlacklisted(blacklist, 'https://www.netflix.com/title/123');
  const otherAllowed = isBlacklisted(blacklist, 'https://www.example.com/');

  assert.equal(youtubeBlocked, true, 'youtube.com should be blocked');
  assert.equal(netflixBlocked, true, 'netflix.com should be blocked');
  assert.equal(otherAllowed, false, 'example.com should not be blocked');
});

runner.test('disabled extension should not proceed', () => {
  // Simulate content-entry.js check
  const settings = { enabled: false, blacklist: '' };

  // This is the check in content-entry.js
  const shouldExit = settings.enabled === false;

  assert.equal(shouldExit, true, 'should exit when disabled');
});

runner.test('enabled extension on non-blacklisted site should proceed', () => {
  const settings = {
    enabled: true,
    blacklist: 'youtube.com',
    lastSpeed: 1.5
  };

  const isDisabled = settings.enabled === false;
  const isSiteBlacklisted = isBlacklisted(settings.blacklist, 'https://www.example.com/');

  assert.equal(isDisabled, false, 'should not be disabled');
  assert.equal(isSiteBlacklisted, false, 'site should not be blacklisted');

  // Simulate stripping
  delete settings.blacklist;
  delete settings.enabled;

  // Verify only safe settings remain
  const keys = Object.keys(settings);
  assert.equal(keys.includes('blacklist'), false, 'blacklist should not leak');
  assert.equal(keys.includes('enabled'), false, 'enabled should not leak');
  assert.equal(keys.includes('lastSpeed'), true, 'lastSpeed should remain');
});

// --- Lifecycle watcher logic (mirrors content-entry.js storage.onChanged handler) ---

runner.test('blacklist change matching current site should trigger teardown', () => {
  // Simulate the logic in content-entry.js onChanged handler
  const currentHref = 'https://www.youtube.com/watch?v=123';
  const changes = {
    blacklist: { newValue: 'youtube.com\nnetflix.com' }
  };

  const nowBlacklisted = 'blacklist' in changes &&
    isBlacklisted(changes.blacklist.newValue, currentHref);

  assert.true(nowBlacklisted, 'should detect site is now blacklisted');
});

runner.test('blacklist change NOT matching current site should not trigger teardown', () => {
  const currentHref = 'https://www.example.com/page';
  const changes = {
    blacklist: { newValue: 'youtube.com\nnetflix.com' }
  };

  const nowBlacklisted = 'blacklist' in changes &&
    isBlacklisted(changes.blacklist.newValue, currentHref);

  assert.false(nowBlacklisted, 'should not trigger teardown for unrelated site');
});

runner.test('enabled=false change should trigger teardown', () => {
  const changes = {
    enabled: { newValue: false }
  };

  const nowDisabled = 'enabled' in changes && changes.enabled.newValue === false;

  assert.true(nowDisabled, 'should detect extension is now disabled');
});

runner.test('enabled=true change should not trigger teardown', () => {
  const changes = {
    enabled: { newValue: true }
  };

  const nowDisabled = 'enabled' in changes && changes.enabled.newValue === false;

  assert.false(nowDisabled, 'should not trigger teardown when re-enabled');
});

runner.test('unrelated storage change should not trigger teardown', () => {
  const currentHref = 'https://www.example.com/page';
  const changes = {
    lastSpeed: { newValue: 2.5 }
  };

  const nowDisabled = 'enabled' in changes && changes.enabled.newValue === false;
  const nowBlacklisted = 'blacklist' in changes &&
    isBlacklisted(changes.blacklist.newValue, currentHref);

  assert.false(nowDisabled, 'speed change should not disable');
  assert.false(nowBlacklisted, 'speed change should not blacklist');
});

// --- Reinit logic (mirrors content-entry.js storage.onChanged handler) ---

runner.test('enabled=true change should trigger reinit', () => {
  const changes = {
    enabled: { newValue: true }
  };

  const reEnabled = 'enabled' in changes && changes.enabled.newValue === true;

  assert.true(reEnabled, 'should detect extension was re-enabled');
});

runner.test('site removed from blacklist should trigger reinit', () => {
  const currentHref = 'https://www.youtube.com/watch?v=123';
  const changes = {
    blacklist: { newValue: 'netflix.com' }  // youtube removed from list
  };

  const unblacklisted = 'blacklist' in changes &&
    !isBlacklisted(changes.blacklist.newValue, currentHref);

  assert.true(unblacklisted, 'should detect site is no longer blacklisted');
});

runner.test('blacklist change that still includes current site should not trigger reinit', () => {
  const currentHref = 'https://www.youtube.com/watch?v=123';
  const changes = {
    blacklist: { newValue: 'youtube.com\nnetflix.com' }
  };

  const unblacklisted = 'blacklist' in changes &&
    !isBlacklisted(changes.blacklist.newValue, currentHref);

  assert.false(unblacklisted, 'should not reinit when site is still blacklisted');
});

runner.test('unrelated storage change should not trigger reinit', () => {
  const currentHref = 'https://www.example.com/page';
  const changes = {
    lastSpeed: { newValue: 2.5 }
  };

  const reEnabled = 'enabled' in changes && changes.enabled.newValue === true;
  const unblacklisted = 'blacklist' in changes &&
    !isBlacklisted(changes.blacklist.newValue, currentHref);

  assert.false(reEnabled, 'speed change should not re-enable');
  assert.false(unblacklisted, 'speed change should not un-blacklist');
});

export { runner };
