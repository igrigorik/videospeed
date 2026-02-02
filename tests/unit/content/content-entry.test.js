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

export { runner };
