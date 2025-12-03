/**
 * Unit tests for allowlist regex parsing
 * Tests regex patterns with and without flags
 */

import { SimpleTestRunner, assert } from '../../helpers/test-utils.js';
import { loadMinimalModules } from '../../helpers/module-loader.js';

// Load all required modules
await loadMinimalModules();

const runner = new SimpleTestRunner();

runner.beforeEach(() => {
  // Store original location
  runner.originalHref = global.location.href;
});

runner.afterEach(() => {
  // Restore original location
  Object.defineProperty(global.location, 'href', {
    value: runner.originalHref,
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

runner.test('should allow all sites when allowlist is empty', () => {
  const allowlist = '';

  const testCases = [
    { url: 'https://www.youtube.com/', shouldAllow: true },
    { url: 'https://netflix.com/', shouldAllow: true },
    { url: 'https://example.com/', shouldAllow: true }
  ];

  testCases.forEach(({ url, shouldAllow }) => {
    setTestURL(url);
    const result = window.VSC.DomUtils.isAllowed(allowlist);
    assert.equal(result, shouldAllow, `URL ${url} should ${shouldAllow ? 'be allowed' : 'not be allowed'} with empty allowlist`);
  });
});

runner.test('should parse regex patterns WITHOUT flags', () => {
  const allowlist = '/(.+)youtube\\.com(\\/*)$/';

  const testCases = [
    { url: 'https://www.youtube.com/', shouldAllow: true },
    { url: 'https://music.youtube.com/', shouldAllow: true },
    { url: 'https://m.youtube.com/', shouldAllow: true },
    { url: 'https://example.com/', shouldAllow: false }
  ];

  testCases.forEach(({ url, shouldAllow }) => {
    setTestURL(url);
    const result = window.VSC.DomUtils.isAllowed(allowlist);
    assert.equal(result, shouldAllow, `URL ${url} should ${shouldAllow ? 'be allowed' : 'not be allowed'} with pattern ${allowlist}`);
  });
});

runner.test('should parse regex patterns WITH flags', () => {
  const allowlist = '/(.+)youtube\\.com(\\/*)$/gi';

  const testCases = [
    { url: 'https://www.youtube.com/', shouldAllow: true },
    { url: 'https://YOUTUBE.COM/', shouldAllow: true }, // case insensitive with 'i' flag
    { url: 'https://music.youtube.com/', shouldAllow: true },
    { url: 'https://example.com/', shouldAllow: false }
  ];

  testCases.forEach(({ url, shouldAllow }) => {
    setTestURL(url);
    const result = window.VSC.DomUtils.isAllowed(allowlist);
    assert.equal(result, shouldAllow, `URL ${url} should ${shouldAllow ? 'be allowed' : 'not be allowed'} with pattern ${allowlist}`);
  });
});

runner.test('should handle simple string patterns', () => {
  const allowlist = 'youtube.com';

  setTestURL('https://www.youtube.com/watch?v=123');
  const result = window.VSC.DomUtils.isAllowed(allowlist);
  assert.equal(result, true);

  setTestURL('https://netflix.com/');
  const result2 = window.VSC.DomUtils.isAllowed(allowlist);
  assert.equal(result2, false);
});

runner.test('should handle multiple allowlist entries with mixed formats', () => {
  const allowlist = `youtube.com
/(.+)instagram\\.com/
/twitter\\.com/gi`;

  const testCases = [
    { url: 'https://www.youtube.com/', shouldAllow: true },
    { url: 'https://www.instagram.com/', shouldAllow: true },
    { url: 'https://twitter.com/', shouldAllow: true },
    { url: 'https://TWITTER.COM/', shouldAllow: true }, // case insensitive
    { url: 'https://example.com/', shouldAllow: false }
  ];

  testCases.forEach(({ url, shouldAllow }) => {
    setTestURL(url);
    const result = window.VSC.DomUtils.isAllowed(allowlist);
    assert.equal(result, shouldAllow, `URL ${url} should ${shouldAllow ? 'be allowed' : 'not be allowed'}`);
  });
});

runner.test('should handle malformed regex patterns gracefully', () => {
  const allowlist = `//
/[unclosed
/valid\\.com/`;

  setTestURL('https://valid.com/');

  // Should not throw and should match the valid pattern
  let result;
  let threwError = false;
  try {
    result = window.VSC.DomUtils.isAllowed(allowlist);
  } catch (e) {
    threwError = true;
  }

  assert.equal(threwError, false, 'Should not throw on malformed regex');
  assert.equal(result, true, 'Should allow valid pattern despite malformed entries');
});

runner.test('should handle empty patterns and whitespace', () => {
  const allowlist = `

youtube.com

`;

  setTestURL('https://www.youtube.com/');
  const result = window.VSC.DomUtils.isAllowed(allowlist);
  assert.equal(result, true);

  setTestURL('https://netflix.com/');
  const result2 = window.VSC.DomUtils.isAllowed(allowlist);
  assert.equal(result2, false);
});

runner.test('should not match partial domain names (x.com should not match netflix.com)', () => {
  const allowlist = 'x.com';

  const testCases = [
    { url: 'https://x.com/', shouldAllow: true },
    { url: 'https://www.x.com/', shouldAllow: true },
    { url: 'https://x.com/status/123', shouldAllow: true },
    { url: 'https://netflix.com/', shouldAllow: false }, // Should NOT match
    { url: 'https://max.com/', shouldAllow: false }, // Should NOT match
    { url: 'https://fox.com/', shouldAllow: false }, // Should NOT match
  ];

  testCases.forEach(({ url, shouldAllow }) => {
    setTestURL(url);
    const result = window.VSC.DomUtils.isAllowed(allowlist);
    assert.equal(result, shouldAllow, `URL ${url} should ${shouldAllow ? 'be allowed' : 'not be allowed'} with pattern ${allowlist}`);
  });
});

runner.test('should handle selective allowlist correctly', () => {
  // Allow only specific video streaming sites
  const allowlist = `youtube.com
netflix.com
/(.+)vimeo\\.com/`;

  const testCases = [
    // These should be allowed
    { url: 'https://www.youtube.com/', shouldAllow: true },
    { url: 'https://youtube.com/', shouldAllow: true },
    { url: 'https://netflix.com/', shouldAllow: true },
    { url: 'https://www.netflix.com/', shouldAllow: true },
    { url: 'https://player.vimeo.com/', shouldAllow: true },

    // These should NOT be allowed
    { url: 'https://www.instagram.com/', shouldAllow: false },
    { url: 'https://x.com/', shouldAllow: false },
    { url: 'https://imgur.com/', shouldAllow: false },
    { url: 'https://teams.microsoft.com/', shouldAllow: false },
    { url: 'https://meet.google.com/', shouldAllow: false },
    { url: 'https://max.com/', shouldAllow: false },
    { url: 'https://fox.com/', shouldAllow: false },
  ];

  testCases.forEach(({ url, shouldAllow }) => {
    setTestURL(url);
    const result = window.VSC.DomUtils.isAllowed(allowlist);
    assert.equal(result, shouldAllow, `URL ${url} should ${shouldAllow ? 'be allowed' : 'not be allowed'} with allowlist`);
  });
});

// Export for test runner
export { runner };
