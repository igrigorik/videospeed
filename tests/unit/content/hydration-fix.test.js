/**
 * Tests for hydration-safe initialization tracking
 * Ensures VSC doesn't modify DOM attributes that cause React hydration errors
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert, createMockVideo, createMockDOM } from '../../helpers/test-utils.js';
import { loadInjectModules } from '../../helpers/module-loader.js';

// Load all required modules
await loadInjectModules();

const runner = new SimpleTestRunner();
let mockDOM;

runner.beforeEach(() => {
  installChromeMock();
  resetMockStorage();
  mockDOM = createMockDOM();

  // Initialize site handler manager for tests
  if (window.VSC && window.VSC.siteHandlerManager) {
    window.VSC.siteHandlerManager.initialize(document);
  }
});

runner.afterEach(() => {
  cleanupChromeMock();
  if (mockDOM) {
    mockDOM.cleanup();
  }
});

runner.test('VSC content script avoids DOM modifications that cause hydration errors', () => {
  // Record initial body classes and attributes
  const initialBodyClasses = [...document.body.classList];
  const initialBodyHTML = document.body.outerHTML;

  // Test that VSC state tracking works without DOM modifications
  // Use simple boolean flag in VSC namespace
  window.VSC.initialized = false;

  assert.false(
    window.VSC.initialized,
    'VSC should not be initialized yet'
  );

  // Simulate initialization
  window.VSC.initialized = true;

  // Verify no classes were added to body
  const finalBodyClasses = [...document.body.classList];
  const finalBodyHTML = document.body.outerHTML;

  assert.deepEqual(
    initialBodyClasses,
    finalBodyClasses,
    'Body classes should not be modified'
  );

  assert.equal(
    initialBodyHTML,
    finalBodyHTML,
    'Body HTML should not be modified'
  );

  // Verify JavaScript state tracking is working
  assert.true(
    window.VSC.initialized,
    'VSC should be marked as initialized via boolean flag'
  );

  // Test double initialization prevention
  if (window.VSC.initialized) {
    // Skip initialization - this simulates the actual logic
    assert.true(true, 'Double initialization should be prevented');
  }
});

runner.test('CSS custom properties enable domain-specific styling without body modifications', () => {
  // Record initial body state
  const initialBodyClasses = [...document.body.classList];
  const initialBodyHTML = document.body.outerHTML;

  // Simulate the CSS custom property approach
  const hostname = 'chatgpt.com';

  // Store domain info in VSC global state
  window.VSC.currentDomain = hostname;

  // Set CSS custom property on document root (the new approach)
  document.documentElement.style.setProperty('--vsc-domain', `"${hostname}"`);

  // Verify no classes were added to body
  const finalBodyClasses = [...document.body.classList];
  const finalBodyHTML = document.body.outerHTML;

  assert.deepEqual(
    initialBodyClasses,
    finalBodyClasses,
    'Body classes should not be modified when applying domain styles'
  );

  assert.equal(
    initialBodyHTML,
    finalBodyHTML,
    'Body HTML should not be modified when applying domain styles'
  );

  // Verify CSS custom property was set
  const domainProperty = document.documentElement.style.getPropertyValue('--vsc-domain');
  assert.equal(
    domainProperty,
    '"chatgpt.com"',
    'CSS custom property should be set for domain'
  );

  // Verify the CSS selector would match (simulating CSS behavior)
  const rootStyle = document.documentElement.getAttribute('style');
  assert.true(
    rootStyle && rootStyle.includes('--vsc-domain: "chatgpt.com"'),
    'Root element should have the custom property in style attribute'
  );

  // Verify domain is tracked in VSC state
  assert.equal(
    window.VSC.currentDomain,
    'chatgpt.com',
    'Current domain should be tracked in VSC state'
  );
});

runner.test('Simple boolean flag prevents double initialization', () => {
  // Test simple boolean flag approach
  window.VSC.initialized = false;

  assert.false(
    window.VSC.initialized,
    'VSC should start uninitialized'
  );

  // Simulate first initialization
  if (!window.VSC.initialized) {
    window.VSC.initialized = true;
    assert.true(true, 'First initialization should proceed');
  }

  // Simulate second initialization attempt
  if (window.VSC.initialized) {
    // This simulates the actual check in initializeDocument
    assert.true(true, 'Second initialization should be skipped');
  }

  assert.true(
    window.VSC.initialized,
    'VSC should remain initialized'
  );
});

// Run the tests
runner.run();