/**
 * Basic E2E tests for Video Speed Controller extension
 */

import {
  launchChromeWithExtension,
  waitForExtension,
  waitForVideo,
  waitForController,
  getVideoSpeed,
  controlVideo,
  testKeyboardShortcut,
  getControllerSpeedDisplay,
  takeScreenshot,
  assert,
  sleep,
} from './e2e-utils.js';

export default async function runBasicE2ETests() {
  console.log('🎭 Running Basic E2E Tests...\n');

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

    await runTest('Extension should load in Chrome', async () => {
      // Navigate to our test HTML file with video
      const testPagePath = `file://${process.cwd()}/tests/e2e/test-video.html`;
      await page.goto(testPagePath, { waitUntil: 'domcontentloaded' });
      await sleep(3000); // Give extension time to inject

      const extensionLoaded = await waitForExtension(page, 8000);
      assert.true(extensionLoaded, 'Extension should be loaded');
    });

    await runTest('Video element should be detected', async () => {
      const videoReady = await waitForVideo(page, 'video', 10000);
      assert.true(videoReady, 'Video should be ready');
    });

    await runTest('Speed controller should appear on video', async () => {
      const controllerFound = await waitForController(page, 10000);
      assert.true(controllerFound, 'Speed controller should appear');
    });

    await runTest('Initial video speed should be 1.0x', async () => {
      const speed = await getVideoSpeed(page);
      assert.equal(speed, 1, 'Initial speed should be 1.0x');
    });

    await runTest('Controller should display initial speed', async () => {
      const speedDisplay = await getControllerSpeedDisplay(page);
      assert.exists(speedDisplay, 'Speed display should exist');
      // Speed display should show something like "1.00"
      assert.true(speedDisplay.includes('1.'), 'Speed display should show 1.x');
    });

    await runTest('Faster button should increase speed', async () => {
      const initialSpeed = await getVideoSpeed(page);
      const success = await controlVideo(page, 'faster');
      assert.true(success, 'Faster button should work');

      const newSpeed = await getVideoSpeed(page);
      assert.true(newSpeed > initialSpeed, 'Speed should increase');
    });

    await runTest('Slower button should decrease speed', async () => {
      const initialSpeed = await getVideoSpeed(page);
      const success = await controlVideo(page, 'slower');
      assert.true(success, 'Slower button should work');

      const newSpeed = await getVideoSpeed(page);
      assert.true(newSpeed < initialSpeed, 'Speed should decrease');
    });

    await runTest('Reset key should restore normal speed', async () => {
      // First change speed
      await controlVideo(page, 'faster');
      await controlVideo(page, 'faster');

      // Then reset using R key
      await testKeyboardShortcut(page, 'KeyR');
      await sleep(500);

      const speed = await getVideoSpeed(page);
      assert.approximately(speed, 1.0, 0.1, 'Speed should be approximately 1.0 after reset');
    });

    await runTest('Keyboard shortcuts should work', async () => {
      // Reset extension state to clear any stored preferences
      await page.evaluate(() => {
        const video = document.querySelector('video');
        if (video) {
          video.playbackRate = 1.0;
        }

        // Reset the extension's stored reset key binding to default
        if (window.VSC_controller && window.VSC_controller.config) {
          window.VSC_controller.config.setKeyBinding('reset', 1.0);
        }
      });
      await sleep(200);

      // Test 'D' key for faster
      const initialSpeed = await getVideoSpeed(page);
      console.log(`   🔍 Initial speed: ${initialSpeed}`);
      await testKeyboardShortcut(page, 'KeyD');

      const newSpeed = await getVideoSpeed(page);
      console.log(`   🔍 Speed after D key: ${newSpeed}`);
      assert.true(newSpeed > initialSpeed, 'D key should increase speed');

      // Test 'S' key for slower
      await testKeyboardShortcut(page, 'KeyS');
      const slowerSpeed = await getVideoSpeed(page);
      console.log(`   🔍 Speed after S key: ${slowerSpeed}`);
      assert.true(slowerSpeed < newSpeed, 'S key should decrease speed');

      // Test 'R' key for reset (should change speed from current)
      const speedBeforeReset = await getVideoSpeed(page);
      await testKeyboardShortcut(page, 'KeyR');
      await sleep(200); // Give time for reset to process
      const resetSpeed = await getVideoSpeed(page);
      console.log(`   🔍 Speed before R key: ${speedBeforeReset}, after R key: ${resetSpeed}`);
      assert.true(
        resetSpeed !== speedBeforeReset,
        `R key should change speed from ${speedBeforeReset}, got ${resetSpeed}`
      );
    });

    await runTest(
      'Page legacy mousewheel handlers should receive trusted wheel input',
      async () => {
        const point = await page.evaluate(() => {
          const video = document.querySelector('video');
          video.muted = false;
          video.volume = 0.5;
          window.__legacyMousewheelCount = 0;
          document.addEventListener('mousewheel', (event) => {
            if (!event.isTrusted) {
              return;
            }
            window.__legacyMousewheelCount++;
            video.volume = Math.min(1, video.volume + (event.wheelDelta > 0 ? 0.03 : -0.03));
          });
          const rect = video.getBoundingClientRect();
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
          };
        });

        // CDP-backed mouse input is trusted browser input. Synthetic dispatchEvent()
        // bypasses Chromium's wheel/mousewheel compatibility selection and would
        // not catch the document-level listener regression from #1598.
        await page.mouse.move(point.x, point.y);
        await page.mouse.wheel({ deltaY: -120 });
        await sleep(200);

        const result = await page.evaluate(() => ({
          count: window.__legacyMousewheelCount,
          volume: document.querySelector('video').volume,
        }));
        assert.true(result.count > 0, 'Page should receive trusted legacy mousewheel input');
        assert.true(result.volume > 0.5, 'Page mousewheel handler should be able to change volume');
      }
    );

    // Take a screenshot for verification
    await takeScreenshot(page, 'basic-test-final.png');
  } catch (error) {
    console.log(`   💥 Test setup failed: ${error.message}`);
    failed++;
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`\n   📊 Basic E2E Results: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
