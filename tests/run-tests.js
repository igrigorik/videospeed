#!/usr/bin/env node

/**
 * CLI test runner for Video Speed Controller
 * Usage: node tests/run-tests.js [unit|integration]
 */

import { pathToFileURL } from 'url';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check if jsdom is available
let JSDOM;
try {
  const jsdomModule = await import('jsdom');
  JSDOM = jsdomModule.JSDOM;
} catch (error) {
  console.error('❌ JSDOM not found. Install it with: npm install jsdom');
  console.error('   Or run tests in browser instead: npm run test:browser');
  process.exit(1);
}

// Set up DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
  resources: 'usable'
});

// Mock Chrome APIs first (before setting up DOM globals)
global.chrome = {
  storage: {
    sync: {
      get: (keys, callback) => {
        const mockData = {
          enabled: true,
          lastSpeed: 1.0,
          keyBindings: [],
          rememberSpeed: false,
          forceLastSavedSpeed: false,
          audioBoolean: false,
          startHidden: false,
          controllerOpacity: 0.3,
          controllerButtonSize: 14,
          blacklist: "www.instagram.com\nx.com",
          logLevel: 3
        };
        setTimeout(() => callback(mockData), 10);
      },
      set: (items, callback) => setTimeout(() => callback && callback(), 10)
    }
  },
  runtime: {
    getURL: (path) => `chrome-extension://test/${path}`,
    id: 'test-extension-id'
  }
};

// Set up global DOM objects for Node.js environment
Object.assign(global, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLVideoElement: dom.window.HTMLVideoElement,
  HTMLAudioElement: dom.window.HTMLAudioElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  Event: dom.window.Event,
  KeyboardEvent: dom.window.KeyboardEvent,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  customElements: dom.window.customElements,
  requestIdleCallback: (fn) => setTimeout(fn, 0),
  location: { hostname: 'localhost', href: 'http://localhost' }
});

// Enhanced shadow DOM support for JSDOM
if (!global.HTMLElement.prototype.attachShadow) {
  global.HTMLElement.prototype.attachShadow = function (options) {
    // Create a mock shadow root
    const shadowRoot = global.document.createElement('div');
    shadowRoot.mode = options.mode || 'open';
    shadowRoot.host = this;

    // Mock shadow root methods
    shadowRoot.querySelector = function (selector) {
      return this.querySelector(selector);
    };

    shadowRoot.querySelectorAll = function (selector) {
      return this.querySelectorAll(selector);
    };

    // Override innerHTML to handle template parsing
    let shadowHTML = '';
    Object.defineProperty(shadowRoot, 'innerHTML', {
      get: () => shadowHTML,
      set: (value) => {
        shadowHTML = value;

        // Parse the shadow DOM template and create actual elements
        const tempDiv = global.document.createElement('div');
        tempDiv.innerHTML = value.replace(/@import[^;]+;/g, ''); // Remove CSS imports

        // Move children from temp div to shadow root
        while (tempDiv.firstChild) {
          shadowRoot.appendChild(tempDiv.firstChild);
        }
      }
    });

    this.shadowRoot = shadowRoot;
    return shadowRoot;
  };
}

async function runTests() {
  console.log('🧪 Video Speed Controller - CLI Test Runner\n');

  let totalPassed = 0;
  let totalFailed = 0;

  // Determine which tests to run based on command line argument
  const testType = process.argv[2];
  let testFiles = [];

  if (testType === 'unit') {
    testFiles = [
      'unit/core/settings.test.js',
      'unit/core/action-handler.test.js',
      'unit/core/video-controller.test.js',
      'unit/core/icon-integration.test.js',
      'unit/core/keyboard-shortcuts-saving.test.js',
      'unit/core/f-keys.test.js',
      'unit/observers/mutation-observer.test.js',
      'unit/observers/audio-size-handling.test.js',
      'unit/content/inject.test.js',
      'unit/content/hydration-fix.test.js',
      'unit/content/content-entry.test.js',
      'unit/utils/recursive-shadow-dom.test.js',
      'unit/utils/blacklist-regex.test.js',
      'unit/utils/event-manager.test.js'
    ];
  } else if (testType === 'integration') {
    testFiles = [
      'integration/module-integration.test.js',
      'integration/ui-to-storage-flow.test.js',
      'integration/state-manager-integration.test.js',
      'integration/blacklist-blocking.test.js'
    ];
  } else {
    // Run all tests
    testFiles = [
      'unit/core/settings.test.js',
      'unit/core/action-handler.test.js',
      'unit/core/video-controller.test.js',
      'unit/core/icon-integration.test.js',
      'unit/core/keyboard-shortcuts-saving.test.js',
      'unit/core/f-keys.test.js',
      'unit/observers/mutation-observer.test.js',
      'unit/observers/audio-size-handling.test.js',
      'unit/content/inject.test.js',
      'unit/content/hydration-fix.test.js',
      'unit/content/content-entry.test.js',
      'unit/utils/recursive-shadow-dom.test.js',
      'unit/utils/blacklist-regex.test.js',
      'unit/utils/event-manager.test.js',
      'integration/module-integration.test.js',
      'integration/ui-to-storage-flow.test.js',
      'integration/state-manager-integration.test.js',
      'integration/blacklist-blocking.test.js'
    ];
  }

  console.log(`Running ${testFiles.length} test suites...\n`);

  for (const testFile of testFiles) {
    try {
      const testPath = join(__dirname, testFile);

      if (!existsSync(testPath)) {
        console.log(`   ⚠️  Test file not found: ${testFile}\n`);
        continue;
      }

      console.log(`📝 Running ${testFile}...`);

      const testModule = await import(pathToFileURL(testPath).href);
      const runner = Object.values(testModule).find(exp => exp && typeof exp.run === 'function');

      if (runner) {
        const results = await runner.run();
        totalPassed += results.passed;
        totalFailed += results.failed;

        const status = results.failed === 0 ? '✅' : '❌';
        console.log(`   ${status} ${results.passed} passed, ${results.failed} failed\n`);
      } else {
        console.log(`   ⚠️  No test runner found in ${testFile}\n`);
      }
    } catch (error) {
      console.log(`   💥 Error running ${testFile}:`);
      console.log(`      ${error.message}\n`);
      totalFailed++;
    }
  }

  console.log('📊 Test Summary');
  console.log('================');
  console.log(`Total Tests: ${totalPassed + totalFailed}`);
  console.log(`✅ Passed: ${totalPassed}`);
  console.log(`❌ Failed: ${totalFailed}`);

  if (totalPassed + totalFailed > 0) {
    const successRate = Math.round((totalPassed / (totalPassed + totalFailed)) * 100);
    console.log(`📈 Success Rate: ${successRate}%`);
  }

  if (totalFailed === 0) {
    console.log('\n🎉 All tests passed!');
  } else {
    console.log('\n💥 Some tests failed. Check the output above for details.');
  }

  process.exit(totalFailed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('💥 Test runner failed:', error);
  process.exit(1);
});