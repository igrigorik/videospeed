/**
 * E2E test for display toggle functionality
 */

import { launchChromeWithExtension, sleep } from './e2e-utils.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testDisplayToggle() {
  console.log('🧪 Testing display toggle functionality...');

  const { browser, page } = await launchChromeWithExtension();

  try {
    // Load test page with video
    const testPagePath = `file://${path.join(__dirname, 'test-video.html')}`;
    await page.goto(testPagePath, { waitUntil: 'domcontentloaded' });

    // Wait for extension to load
    await sleep(2000);

    // Verify controller is initially visible
    const controllerVisible = await page.evaluate(() => {
      const controllers = document.querySelectorAll('.vsc-controller');
      if (controllers.length === 0) {
        return { success: false, message: 'No controller found' };
      }

      const controller = controllers[0];
      const computedStyle = window.getComputedStyle(controller);
      const isVisible =
        computedStyle.display !== 'none' &&
        computedStyle.visibility !== 'hidden' &&
        !controller.classList.contains('vsc-hidden');

      return {
        success: isVisible,
        message: `Controller initial state - Classes: ${controller.className}, Display: ${computedStyle.display}, Visibility: ${computedStyle.visibility}`,
      };
    });

    if (!controllerVisible.success) {
      throw new Error(`Controller not initially visible: ${controllerVisible.message}`);
    }

    console.log('✅ Controller is initially visible');

    // Press 'V' to hide controller
    await page.keyboard.press('v');
    await sleep(500);

    // Verify controller is hidden
    const controllerHidden = await page.evaluate(() => {
      const controller = document.querySelector('.vsc-controller');
      const computedStyle = window.getComputedStyle(controller);
      const isHidden =
        computedStyle.display === 'none' ||
        computedStyle.visibility === 'hidden' ||
        controller.classList.contains('vsc-hidden');

      return {
        success: isHidden,
        message: `After first toggle - Classes: ${controller.className}, Display: ${computedStyle.display}, Visibility: ${computedStyle.visibility}`,
      };
    });

    if (!controllerHidden.success) {
      throw new Error(`Controller not hidden after first toggle: ${controllerHidden.message}`);
    }

    console.log('✅ Controller hidden after pressing V');

    // Press 'V' again to show controller
    await page.keyboard.press('v');
    await sleep(500);

    // Verify controller is visible again
    const controllerVisibleAgain = await page.evaluate(() => {
      const controller = document.querySelector('.vsc-controller');
      const computedStyle = window.getComputedStyle(controller);
      const isVisible =
        computedStyle.display !== 'none' &&
        computedStyle.visibility !== 'hidden' &&
        !controller.classList.contains('vsc-hidden');

      return {
        success: isVisible,
        message: `After second toggle - Classes: ${controller.className}, Display: ${computedStyle.display}, Visibility: ${computedStyle.visibility}`,
      };
    });

    if (!controllerVisibleAgain.success) {
      throw new Error(
        `Controller not visible after second toggle: ${controllerVisibleAgain.message}`
      );
    }

    console.log('✅ Controller visible again after pressing V');

    // Test console logging
    const consoleLogs = await page.evaluate(() => {
      // Check if display action was logged
      const logs = [];
      const originalLog = console.log;
      console.log = (...args) => {
        logs.push(args.join(' '));
        originalLog.apply(console, args);
      };

      // Trigger display action
      const event = new KeyboardEvent('keydown', { keyCode: 86 });
      document.dispatchEvent(event);

      return logs;
    });

    console.log('📋 Console logs:', consoleLogs);

    console.log('✅ Display toggle test passed!');
    return { success: true };
  } catch (error) {
    console.error('❌ Display toggle test failed:', error.message);
    return { success: false, error: error.message };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Export test runner function
export async function run() {
  const result = await testDisplayToggle();
  return {
    passed: result.success ? 1 : 0,
    failed: result.success ? 0 : 1,
  };
}

export { testDisplayToggle };
