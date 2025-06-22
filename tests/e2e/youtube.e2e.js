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
  assert 
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
      await page.waitForTimeout(1000);
      
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
      
      console.log(`   ⌨️  Keyboard shortcuts working: ${initialSpeed} → ${fasterSpeed} → ${slowerSpeed}`);
    });
    
    await runTest('Extension should handle YouTube player interactions', async () => {
      // Try pausing and playing video
      await page.click('video.html5-main-video');
      await page.waitForTimeout(1000);
      
      // Speed should be maintained across play/pause
      const speedBeforePause = await getVideoSpeed(page, 'video.html5-main-video');
      
      await page.click('video.html5-main-video'); // Play again
      await page.waitForTimeout(1000);
      
      const speedAfterPlay = await getVideoSpeed(page, 'video.html5-main-video');
      assert.equal(speedBeforePause, speedAfterPlay, 'Speed should be maintained across play/pause');
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
      
      await page.waitForTimeout(2000);
      
      // Speed should be maintained after seeking
      const speedAfterSeek = await getVideoSpeed(page, 'video.html5-main-video');
      assert.equal(currentSpeed, speedAfterSeek, 'Speed should be maintained after seeking');
    });
    
    await runTest('Multiple speed changes should work correctly', async () => {
      // Ensure we start from 1.0 baseline by setting it directly
      await page.evaluate(() => {
        const video = document.querySelector('video.html5-main-video');
        if (video) {video.playbackRate = 1.0;}
      });
      await page.waitForTimeout(200);
      
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
      
      assert.true(finalSpeed > 1.25, `Multiple speed increases should accumulate (expected > 1.25, got ${finalSpeed})`);
      assert.true(finalSpeed < 1.35, `Speed should not increase too much (expected < 1.35, got ${finalSpeed})`);
      
      console.log(`   🔄 Final speed after multiple changes: ${finalSpeed}`);
    });
    
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
        await page.waitForTimeout(1000);
        
        const newTime = await page.evaluate(() => {
          const video = document.querySelector('video.html5-main-video');
          return video ? video.currentTime : null;
        });
        
        assert.true(newTime < currentTime, 'Rewind should move video backward');
        
        // Test advance
        await controlVideo(page, 'advance');
        await page.waitForTimeout(1000);
        
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