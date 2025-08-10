/**
 * E2E test utilities for Chrome extension testing
 */

import puppeteer from 'puppeteer';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Sleep/wait utility to replace deprecated page.waitForTimeout
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Launch Chrome with extension loaded
 * @returns {Promise<{browser: Browser, page: Page}>}
 */
export async function launchChromeWithExtension() {
  const extensionPath = join(__dirname, '../../');

  console.log(`   📁 Loading extension from: ${extensionPath}`);

  try {
    const browser = await puppeteer.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: false, // Extensions require non-headless mode
      devtools: false,
      args: [
        `--load-extension=${extensionPath}`,
        `--disable-extensions-except=${extensionPath}`,
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--window-size=1280,720',
        '--allow-file-access-from-files',
      ],
      ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
    });

    console.log('   🌐 Chrome browser launched successfully');

    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());

    // Set viewport
    await page.setViewport({ width: 1280, height: 720 });

    // Listen for console errors
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
        console.log(`   🔴 Console Error: ${msg.text()}`);
      }
    });

    // Listen for page errors
    page.on('pageerror', (error) => {
      console.log(`   💥 Page Error: ${error.message}`);
    });

    // Add some debug info
    const userAgent = await page.evaluate(() => navigator.userAgent);
    console.log(`   🔍 User Agent: ${userAgent}`);

    // Check if extension is loaded by navigating to chrome://extensions/
    try {
      await page.goto('chrome://extensions/', { waitUntil: 'domcontentloaded', timeout: 10000 });
      await sleep(2000);

      const extensionInfo = await page.evaluate(() => {
        const extensions = document.querySelectorAll('extensions-item');
        const extensionNames = Array.from(extensions).map((ext) => {
          const nameEl = ext.shadowRoot?.querySelector('#name');
          return nameEl ? nameEl.textContent : 'Unknown';
        });
        return {
          count: extensions.length,
          names: extensionNames,
        };
      });

      console.log(`   📦 Extensions loaded: ${extensionInfo.count}`);
      if (extensionInfo.names.length > 0) {
        console.log(`   📦 Extension names: ${extensionInfo.names.join(', ')}`);
      }
    } catch (error) {
      console.log(`   ⚠️  Could not check extensions page: ${error.message}`);
    }

    // Store console errors on the page object for access
    page.getConsoleErrors = () => consoleErrors;

    return { browser, page };
  } catch (error) {
    console.log(`   ❌ Failed to launch Chrome: ${error.message}`);
    throw error;
  }
}

/**
 * Wait for extension to be loaded and content script to be injected
 * @param {Page} page - Puppeteer page object
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
export async function waitForExtension(page, timeout = 15000) {
  try {
    console.log('   🔍 Checking for extension injection...');

    // First check if content script is injected
    const hasContentScript = await page.evaluate(() => {
      return !!(
        window.VSC_controller ||
        window.VSC ||
        document.querySelector('.vsc-controller') ||
        document.querySelector('video')?.vsc
      );
    });

    if (hasContentScript) {
      console.log('   ✅ Extension already detected');
      return true;
    }

    // Wait for either the extension class or controller to appear
    await page.waitForFunction(
      () => {
        // Check multiple indicators that extension is loaded
        const hasVSC = !!window.VSC;
        const hasVSCController = !!window.VSC_controller;
        const hasController = !!document.querySelector('.vsc-controller');
        const hasVideoController = !!document.querySelector('video')?.vsc;

        // Debug logging in browser
        if (
          hasVSC ||
          hasVSCController ||
          hasController ||
          hasVideoController
        ) {
          console.log('Extension detected:', {
            hasVSC,
            hasVSCController,
            hasController,
            hasVideoController,
          });
        }

        return (
          hasVSC ||
          hasVSCController ||
          hasController ||
          hasVideoController
        );
      },
      { timeout, polling: 1000 }
    );

    console.log('   ✅ Extension detected after waiting');
    return true;
  } catch (error) {
    console.log(`   ⚠️  Extension not detected within ${timeout}ms`);

    // Debug what's actually on the page
    const debugInfo = await page.evaluate(() => {
      return {
        hasVideoSpeedExtension: !!window.VideoSpeedExtension,
        hasVideoSpeedExtensionInstance: !!window.VSC_controller,
        hasController: !!document.querySelector('.vsc-controller'),
        hasVideoElement: !!document.querySelector('video'),
        videoHasVsc: !!document.querySelector('video')?.vsc,
        scriptsCount: document.scripts.length,
        extensionId: window.chrome?.runtime?.id,
      };
    });

    console.log('   🔍 Debug info:', JSON.stringify(debugInfo, null, 2));

    // Check for console errors
    const consoleErrors = await page.evaluate(() => {
      // Get any errors that were logged
      return window.console._errors || [];
    });

    if (consoleErrors.length > 0) {
      console.log('   ❌ Console errors found:', consoleErrors);
    }
    return false;
  }
}

/**
 * Wait for video element to be present and ready
 * @param {Page} page - Puppeteer page object
 * @param {string} selector - Video element selector
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
export async function waitForVideo(page, selector = 'video', timeout = 15000) {
  try {
    await page.waitForSelector(selector, { timeout });

    // Wait for video to be ready with duration
    await page.waitForFunction(
      (sel) => {
        const video = document.querySelector(sel);
        return video && video.readyState >= 2 && video.duration > 0;
      },
      { timeout },
      selector
    );

    console.log('   📹 Video element found and ready');
    return true;
  } catch (error) {
    console.log(`   ⚠️  Video not ready within ${timeout}ms`);
    return false;
  }
}

/**
 * Wait for video speed controller to appear
 * @param {Page} page - Puppeteer page object
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
export async function waitForController(page, timeout = 10000) {
  try {
    // Wait for the controller wrapper
    await page.waitForSelector('.vsc-controller', { timeout });

    // Also check if the shadow DOM content is available
    const hasController = await page.evaluate(() => {
      const controller = document.querySelector('.vsc-controller');
      return (
        controller && controller.shadowRoot && controller.shadowRoot.querySelector('#controller')
      );
    });

    if (hasController) {
      console.log('   🎛️  Video speed controller found');
      return true;
    } else {
      console.log('   ⚠️  Controller found but shadow DOM not ready');
      return false;
    }
  } catch (error) {
    console.log(`   ⚠️  Video speed controller not found within ${timeout}ms`);
    return false;
  }
}

/**
 * Get video playback rate
 * @param {Page} page - Puppeteer page object
 * @param {string} selector - Video element selector
 * @returns {Promise<number>}
 */
export async function getVideoSpeed(page, selector = 'video') {
  return await page.evaluate((sel) => {
    const video = document.querySelector(sel);
    return video ? video.playbackRate : null;
  }, selector);
}

/**
 * Set video playback rate via controller
 * @param {Page} page - Puppeteer page object
 * @param {string} action - Action to perform (faster, slower, reset)
 * @returns {Promise<boolean>}
 */
export async function controlVideo(page, action) {
  try {
    // Access shadow DOM to click the button
    const success = await page.evaluate((action) => {
      const controller = document.querySelector('.vsc-controller');
      if (!controller || !controller.shadowRoot) {
        console.log('Controller or shadow DOM not found');
        return false;
      }

      const button = controller.shadowRoot.querySelector(`button[data-action="${action}"]`);
      if (button) {
        button.click();
        return true;
      } else {
        // Debug: list all available buttons
        const allButtons = controller.shadowRoot.querySelectorAll('button');
        console.log(
          'Available buttons:',
          Array.from(allButtons).map((b) => b.getAttribute('data-action'))
        );
        return false;
      }
    }, action);

    if (success) {
      // Wait a bit for the action to take effect
      await sleep(500);
      console.log(`   🔄 Performed action: ${action}`);
      return true;
    } else {
      console.log(`   ❌ Button not found for action: ${action}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Failed to perform action: ${action}`);
    return false;
  }
}

/**
 * Test keyboard shortcuts
 * @param {Page} page - Puppeteer page object
 * @param {string} key - Key to press
 * @returns {Promise<boolean>}
 */
export async function testKeyboardShortcut(page, key) {
  try {
    await page.keyboard.press(key);

    // Wait a bit for the action to take effect
    await sleep(500);

    console.log(`   ⌨️  Pressed key: ${key}`);
    return true;
  } catch (error) {
    console.log(`   ❌ Failed to press key: ${key}`);
    return false;
  }
}

/**
 * Get controller speed display text
 * @param {Page} page - Puppeteer page object
 * @returns {Promise<string>}
 */
export async function getControllerSpeedDisplay(page) {
  try {
    const speedText = await page.evaluate(() => {
      const controller = document.querySelector('.vsc-controller');
      if (!controller || !controller.shadowRoot) {
        return null;
      }
      const speedElement = controller.shadowRoot.querySelector('.draggable');
      return speedElement ? speedElement.textContent : null;
    });

    return speedText;
  } catch (error) {
    console.log(`   ⚠️  Could not get controller speed display: ${error.message}`);
    return null;
  }
}

/**
 * Take screenshot for debugging
 * @param {Page} page - Puppeteer page object
 * @param {string} filename - Screenshot filename
 */
export async function takeScreenshot(page, filename) {
  try {
    const screenshotPath = join(__dirname, `screenshots/${filename}`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`   📸 Screenshot saved: ${screenshotPath}`);
  } catch (error) {
    console.log(`   ⚠️  Could not save screenshot: ${error.message}`);
  }
}

/**
 * Simple assertion helpers for E2E tests
 */
export const assert = {
  equal: (actual, expected, message) => {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  },

  true: (value, message) => {
    if (value !== true) {
      throw new Error(message || `Expected true, got ${value}`);
    }
  },

  false: (value, message) => {
    if (value !== false) {
      throw new Error(message || `Expected false, got ${value}`);
    }
  },

  exists: (value, message) => {
    if (value === null || value === undefined) {
      throw new Error(message || `Expected value to exist, got ${value}`);
    }
  },

  approximately: (actual, expected, tolerance = 0.1, message) => {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(message || `Expected ${expected} ± ${tolerance}, got ${actual}`);
    }
  },
};
