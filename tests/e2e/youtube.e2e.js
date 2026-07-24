/**
 * YouTube E2E tests for Video Speed Controller extension
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

const YOUTUBE_TEST_URL = 'https://www.youtube.com/watch?v=gGCJOTvECVQ';

export default async function runYouTubeE2ETests() {
  console.log('🎭 Running YouTube E2E Tests...\n');

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

    await runTest('Extension should load on YouTube', async () => {
      console.log(`   🌐 Navigating to: ${YOUTUBE_TEST_URL}`);
      await page.goto(YOUTUBE_TEST_URL, { waitUntil: 'networkidle2' });

      const extensionLoaded = await waitForExtension(page, 5000);
      assert.true(extensionLoaded, 'Extension should be loaded on YouTube');
    });

    await runTest('YouTube video should be detected', async () => {
      // YouTube uses a specific video selector
      const videoReady = await waitForVideo(page, 'video.html5-main-video', 15000);
      assert.true(videoReady, 'YouTube video should be ready');
    });

    await runTest('Speed controller should appear on YouTube video', async () => {
      const controllerFound = await waitForController(page, 15000);
      assert.true(controllerFound, 'Speed controller should appear on YouTube');
    });

    await runTest('YouTube video should start at normal speed', async () => {
      const speed = await getVideoSpeed(page, 'video.html5-main-video');
      assert.equal(speed, 1, 'YouTube video should start at 1.0x speed');
    });

    await runTest('Extension controller should work on YouTube', async () => {
      // Test faster button
      const initialSpeed = await getVideoSpeed(page, 'video.html5-main-video');
      const success = await controlVideo(page, 'faster');
      assert.true(success, 'Faster button should work on YouTube');

      const newSpeed = await getVideoSpeed(page, 'video.html5-main-video');
      assert.true(newSpeed > initialSpeed, 'Speed should increase on YouTube');

      console.log(`   📊 Speed changed from ${initialSpeed} to ${newSpeed}`);
    });

    await runTest('YouTube native speed controls should be overridden', async () => {
      // Set speed using our extension
      await controlVideo(page, 'faster');
      await controlVideo(page, 'faster');
      const extensionSpeed = await getVideoSpeed(page, 'video.html5-main-video');

      // Our extension should control the video speed
      assert.true(extensionSpeed > 1.0, 'Extension should control YouTube video speed');

      // Check that speed display reflects the change
      const speedDisplay = await getControllerSpeedDisplay(page);
      assert.exists(speedDisplay, 'Speed display should show current speed');
    });

    await runTest('Keyboard shortcuts should work on YouTube', async () => {
      // Reset first using keyboard (R key)
      await testKeyboardShortcut(page, 'KeyR');
      await sleep(1000);

      // Test keyboard shortcuts
      const initialSpeed = await getVideoSpeed(page, 'video.html5-main-video');

      // Test 'D' key for faster
      await testKeyboardShortcut(page, 'KeyD');
      const fasterSpeed = await getVideoSpeed(page, 'video.html5-main-video');
      assert.true(fasterSpeed > initialSpeed, 'D key should work on YouTube');

      // Test 'S' key for slower
      await testKeyboardShortcut(page, 'KeyS');
      const slowerSpeed = await getVideoSpeed(page, 'video.html5-main-video');
      assert.true(slowerSpeed < fasterSpeed, 'S key should work on YouTube');

      console.log(
        `   ⌨️  Keyboard shortcuts working: ${initialSpeed} → ${fasterSpeed} → ${slowerSpeed}`
      );
    });

    await runTest('Extension should handle YouTube player interactions', async () => {
      // Try pausing and playing video
      await page.click('video.html5-main-video');
      await sleep(1000);

      // Speed should be maintained across play/pause
      const speedBeforePause = await getVideoSpeed(page, 'video.html5-main-video');

      await page.click('video.html5-main-video'); // Play again
      await sleep(1000);

      const speedAfterPlay = await getVideoSpeed(page, 'video.html5-main-video');
      assert.equal(
        speedBeforePause,
        speedAfterPlay,
        'Speed should be maintained across play/pause'
      );
    });

    await runTest('Extension should handle YouTube page navigation', async () => {
      // Get current speed
      const currentSpeed = await getVideoSpeed(page, 'video.html5-main-video');

      // Seek in the video (which might trigger YouTube player events)
      await page.evaluate(() => {
        const video = document.querySelector('video.html5-main-video');
        if (video && video.duration > 30) {
          video.currentTime = 30;
        }
      });

      await sleep(2000);

      // Speed should be maintained after seeking
      const speedAfterSeek = await getVideoSpeed(page, 'video.html5-main-video');
      assert.equal(currentSpeed, speedAfterSeek, 'Speed should be maintained after seeking');
    });

    await runTest('Multiple speed changes should work correctly', async () => {
      // Ensure we start from 1.0 baseline by setting it directly
      await page.evaluate(() => {
        const video = document.querySelector('video.html5-main-video');
        if (video) {
          video.playbackRate = 1.0;
        }
      });
      await sleep(200);

      const baseSpeed = await getVideoSpeed(page, 'video.html5-main-video');
      console.log(`   🔍 Speed after baseline reset: ${baseSpeed}`);

      // Make multiple speed changes
      await controlVideo(page, 'faster'); // Should be ~1.1
      const speed1 = await getVideoSpeed(page, 'video.html5-main-video');
      console.log(`   🔍 Speed after 1st faster: ${speed1}`);

      await controlVideo(page, 'faster'); // Should be ~1.2
      const speed2 = await getVideoSpeed(page, 'video.html5-main-video');
      console.log(`   🔍 Speed after 2nd faster: ${speed2}`);

      await controlVideo(page, 'faster'); // Should be ~1.3
      const finalSpeed = await getVideoSpeed(page, 'video.html5-main-video');
      console.log(`   🔍 Final speed after 3rd faster: ${finalSpeed}`);

      assert.true(
        finalSpeed > 1.25,
        `Multiple speed increases should accumulate (expected > 1.25, got ${finalSpeed})`
      );
      assert.true(
        finalSpeed < 1.35,
        `Speed should not increase too much (expected < 1.35, got ${finalSpeed})`
      );

      console.log(`   🔄 Final speed after multiple changes: ${finalSpeed}`);
    });

    await runTest('YouTube temporary 2x hold restores the VSC speed on release', async () => {
      const state = await page.evaluate(async () => {
        const video = document.querySelector('video.html5-main-video');
        const controller = window.VSC_controller;
        if (!video?.vsc || !controller?.eventManager) {
          throw new Error('VSC video/controller wiring is unavailable');
        }

        // Keep this browser regression deterministic: synthetic site writes
        // exercise the real document ratechange listener without asking the
        // live YouTube player to react to untrusted pointer events. Timing
        // mirrors production: the boost fires 500ms into a real-length hold.
        let rate = video.playbackRate;
        Object.defineProperty(video, 'playbackRate', {
          configurable: true,
          get: () => rate,
          set: (value) => {
            rate = Number(value);
          },
        });

        video.vsc.actionHandler.adjustSpeed(video, 1.5);
        controller.eventManager.arbitration.classifier.reset();
        const authorityEpochBeforeHold = controller.eventManager.arbitration.authorityEpoch;
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const pointer = (type, buttons) => {
          video.dispatchEvent(
            new PointerEvent(type, { bubbles: true, composed: true, pointerId: 77, buttons })
          );
        };
        const siteRate = (value) => {
          video.playbackRate = value;
          video.dispatchEvent(new Event('ratechange', { bubbles: true }));
        };
        const click = () => {
          video.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        };
        const snapshot = () => ({
          rate: video.playbackRate,
          desired: controller.config.settings.lastSpeed,
          epoch: controller.eventManager.arbitration.authorityEpoch,
          temporary: controller.eventManager.arbitration.conflicts.get(video)?.temporaryOverride,
          fights: controller.eventManager.arbitration.conflicts.get(video)?.fightCount,
        });
        const holdAttempt = async (observe) => {
          pointer('pointerdown', 1);
          await wait(520);
          // YouTube can shed pointer capture mid-hold, and Chrome builds
          // disagree about `buttons` on capture events; worst case is 0.
          pointer('lostpointercapture', 0);
          siteRate(2.0);
          const held = observe ? snapshot() : null;
          await wait(120);
          pointer('pointerup', 0);
          click();
          siteRate(1.0);
          return held;
        };

        const held = await holdAttempt(true);
        const released = snapshot();
        // The reported field failure: a second quick attempt whose release
        // click completes a click sequence and once adopted/persisted 1.0.
        await wait(300);
        await holdAttempt(false);
        const releasedAgain = snapshot();
        return { authorityEpochBeforeHold, held, released, releasedAgain };
      });

      assert.equal(state.held.rate, 2.0, 'The native 2x hold should remain visible');
      assert.equal(state.held.desired, 1.5, 'The hold must not replace shared desired speed');
      assert.equal(
        state.held.epoch,
        state.authorityEpochBeforeHold,
        'The hold must not claim another authority generation'
      );
      assert.true(state.held.temporary, 'The local temporary overlay should be active while held');
      assert.equal(state.held.fights, 0, 'The recognized hold must not spend fight budget');
      assert.equal(
        state.released.rate,
        1.5,
        'Release should restore VSC speed instead of native 1x'
      );
      assert.equal(state.released.desired, 1.5, 'Release must not persist native 1x');
      assert.false(
        state.released.temporary,
        'The local temporary overlay should retire on release'
      );
      assert.equal(
        state.releasedAgain.rate,
        1.5,
        'A repeated hold attempt must also restore VSC speed'
      );
      assert.equal(
        state.releasedAgain.desired,
        1.5,
        'Repeated hold releases must never adopt or persist native 1x'
      );
      assert.equal(
        state.releasedAgain.epoch,
        state.authorityEpochBeforeHold,
        'Repeated holds must not claim authority generations'
      );
    });

    await runTest(
      'YouTube temporary hold fallback restores VSC speed without a release ratechange',
      async () => {
        const held = await page.evaluate(() => {
          const video = document.querySelector('video.html5-main-video');
          const controller = window.VSC_controller;
          video.vsc.actionHandler.adjustSpeed(video, 1.5);
          controller.eventManager.arbitration.classifier.reset();

          let rate = video.playbackRate;
          Object.defineProperty(video, 'playbackRate', {
            configurable: true,
            get: () => rate,
            set: (value) => {
              rate = Number(value);
            },
          });
          const pointer = (type, buttons) => {
            video.dispatchEvent(
              new PointerEvent(type, { bubbles: true, composed: true, pointerId: 78, buttons })
            );
          };

          pointer('pointerdown', 1);
          pointer('lostpointercapture', 0);
          video.playbackRate = 2.0;
          video.dispatchEvent(new Event('ratechange', { bubbles: true }));
          pointer('pointerup', 0);
          return {
            desired: controller.config.settings.lastSpeed,
            temporary: controller.eventManager.arbitration.conflicts.get(video)?.temporaryOverride,
          };
        });

        assert.equal(held.desired, 1.5);
        assert.true(held.temporary, 'The temporary overlay should wait for the guarded fallback');
        await page.waitForFunction(
          () => {
            const video = document.querySelector('video.html5-main-video');
            const arbitration = window.VSC_controller?.eventManager?.arbitration;
            return (
              video?.playbackRate === 1.5 &&
              arbitration?.conflicts.get(video)?.temporaryOverride === false
            );
          },
          { timeout: 2000 }
        );

        const released = await page.evaluate(() => ({
          rate: document.querySelector('video.html5-main-video').playbackRate,
          desired: window.VSC_controller.config.settings.lastSpeed,
        }));
        assert.equal(released.rate, 1.5);
        assert.equal(released.desired, 1.5);
      }
    );

    // Take screenshots for verification
    await takeScreenshot(page, 'youtube-test-controller.png');

    // Test rewind/advance if available
    await runTest('Rewind and advance controls should work', async () => {
      const currentTime = await page.evaluate(() => {
        const video = document.querySelector('video.html5-main-video');
        return video ? video.currentTime : null;
      });

      if (currentTime !== null && currentTime > 15) {
        // Test rewind
        await controlVideo(page, 'rewind');
        await sleep(1000);

        const newTime = await page.evaluate(() => {
          const video = document.querySelector('video.html5-main-video');
          return video ? video.currentTime : null;
        });

        assert.true(newTime < currentTime, 'Rewind should move video backward');

        // Test advance
        await controlVideo(page, 'advance');
        await sleep(1000);

        const advancedTime = await page.evaluate(() => {
          const video = document.querySelector('video.html5-main-video');
          return video ? video.currentTime : null;
        });

        assert.true(advancedTime > newTime, 'Advance should move video forward');
      }
    });

    await takeScreenshot(page, 'youtube-test-final.png');
  } catch (error) {
    console.log(`   💥 Test setup failed: ${error.message}`);
    failed++;
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`\n   📊 YouTube E2E Results: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
