/**
 * E2E tests for settings injection from content script to injected page context
 * Tests that user settings are properly loaded and applied in injected context
 */

import { launchChromeWithExtension, sleep } from './e2e-utils.js';

export default async function runSettingsInjectionE2ETests() {
  console.log('🧪 Running Settings Injection E2E Tests...');

  let browser;
  let passed = 0;
  let failed = 0;

  const runTest = async (testName, testFn) => {
    try {
      console.log(`   🧪 ${testName}`);
      await testFn();
      console.log(`   ✅ ${testName}`);
      passed++;
    } catch (error) {
      console.log(`   ❌ ${testName}: ${error.message}`);
      failed++;
    }
  };

  try {
    // Launch Chrome with extension
    const { browser: chromeBrowser, page } = await launchChromeWithExtension();
    browser = chromeBrowser;

    // Navigate to YouTube
    await page.goto('https://www.youtube.com/watch?v=gGCJOTvECVQ', { waitUntil: 'networkidle2' });

    // Wait for extension to load and set up listeners
    await sleep(3000);

    // Wait for the extension to be fully initialized and listening for settings
    await page.waitForFunction(
      () => {
        return !!(window.VSC?.StorageManager && window.VSC_controller?.initialized);
      },
      { timeout: 10000 }
    );

    await runTest('Settings injection should work with user preferences', async () => {
      // Inject mock user settings to simulate saved preferences
      await page.evaluate(() => {
        const mockSettings = {
          keyBindings: [
            { action: 'slower', key: 83, value: 0.2, force: false, predefined: true }, // S - 0.2 increment
            { action: 'faster', key: 68, value: 0.2, force: false, predefined: true }, // D - 0.2 increment
            { action: 'rewind', key: 90, value: 10, force: false, predefined: true },
            { action: 'advance', key: 88, value: 10, force: false, predefined: true },
            { action: 'reset', key: 82, value: 1.9, force: false, predefined: true }, // R - 1.9 preferred speed
            { action: 'fast', key: 71, value: 1.8, force: false, predefined: true },
            { action: 'display', key: 86, value: 0, force: false, predefined: true },
          ],
          enabled: true,
          lastSpeed: 1.9,
        };

        // Update the global settings cache that StorageManager uses
        window.VSC_settings = mockSettings;
      });

      // Force reload the config to apply injected settings
      await page.evaluate(() => {
        if (window.VSC_controller?.config) {
          return window.VSC_controller.config.load();
        }
      });

      await sleep(500);

      // Verify settings were applied correctly
      const settingsState = await page.evaluate(() => {
        const config = window.VSC?.videoSpeedConfig;
        const fasterBinding = config?.settings?.keyBindings?.find((kb) => kb.action === 'faster');
        const resetBinding = config?.settings?.keyBindings?.find((kb) => kb.action === 'reset');

        return {
          hasConfig: !!config,
          keyBindingsCount: config?.settings?.keyBindings?.length || 0,
          fasterIncrement: fasterBinding?.value,
          resetPreferredSpeed: resetBinding?.value,
          injectedSettingsAvailable: !!window.VSC_settings,
        };
      });

      if (!settingsState.hasConfig) {
        throw new Error('Extension config not found');
      }

      if (settingsState.fasterIncrement !== 0.2) {
        throw new Error(`Expected faster increment 0.2, got ${settingsState.fasterIncrement}`);
      }

      if (settingsState.resetPreferredSpeed !== 1.9) {
        throw new Error(`Expected reset speed 1.9, got ${settingsState.resetPreferredSpeed}`);
      }
    });

    await runTest('Keyboard shortcuts should use injected settings', async () => {
      // Focus video and test keyboard shortcuts with custom increments
      await page.focus('video');

      // Get initial speed
      const initialSpeed = await page.evaluate(() => {
        const video = document.querySelector('video');
        return video ? video.playbackRate : null;
      });

      // Press D key to increase speed
      await page.keyboard.press('KeyD');
      await sleep(100);

      const newSpeed = await page.evaluate(() => {
        const video = document.querySelector('video');
        return video ? video.playbackRate : null;
      });

      const speedDifference = Math.round((newSpeed - initialSpeed) * 10) / 10;

      if (speedDifference !== 0.2) {
        throw new Error(`Expected speed increment of 0.2, got ${speedDifference}`);
      }
    });

    await runTest('Reset key should use preferred speed', async () => {
      // Reset functionality is a toggle - test that it changes the speed
      const speedBeforeReset = await page.evaluate(() => {
        const video = document.querySelector('video');
        return video ? video.playbackRate : null;
      });

      // Press R key to reset
      await page.keyboard.press('KeyR');
      await sleep(100);

      const resetSpeed = await page.evaluate(() => {
        const video = document.querySelector('video');
        return video ? video.playbackRate : null;
      });

      // The reset should change the speed (toggle behavior)
      if (resetSpeed === speedBeforeReset) {
        throw new Error(
          `Reset key should change speed from ${speedBeforeReset}, but it stayed the same`
        );
      }
    });

    await runTest('Settings should persist through extension reload', async () => {
      // Test that settings remain available after reloading extension config
      await page.evaluate(() => {
        if (window.VSC_controller) {
          return window.VSC_controller.config.load();
        }
      });

      const reloadedSettings = await page.evaluate(() => {
        const config = window.VSC?.videoSpeedConfig;
        const fasterBinding = config?.settings?.keyBindings?.find((kb) => kb.action === 'faster');
        return fasterBinding?.value;
      });

      if (reloadedSettings !== 0.2) {
        throw new Error(
          `Settings not persistent after reload: expected 0.2, got ${reloadedSettings}`
        );
      }
    });
  } catch (error) {
    console.log(`   💥 Test setup failed: ${error.message}`);
    failed++;
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`\n   📊 Settings Injection E2E Results: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
