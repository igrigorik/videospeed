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
  assert 
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
      // Navigate to a simple HTML page with video
      const testHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Video Speed Test</title>
        </head>
        <body>
          <h1>Video Speed Controller Test</h1>
          <video controls width="640" height="480" src="data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAGltZGF0AAACrwYF//+l3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2MSByMzAyNyAwZmY4MzE5IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMCAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEwIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAE2WIhAAK//73//+BLUOmYNfeDl7iQA==">
            Your browser does not support the video tag.
          </video>
        </body>
        </html>
      `;
      
      await page.setContent(testHTML);
      await page.waitForTimeout(3000); // Give extension time to inject
      
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
      await page.waitForTimeout(500);
      
      const speed = await getVideoSpeed(page);
      assert.approximately(speed, 1.0, 0.1, 'Speed should be approximately 1.0 after reset');
    });
    
    await runTest('Keyboard shortcuts should work', async () => {
      // Test 'D' key for faster
      const initialSpeed = await getVideoSpeed(page);
      await testKeyboardShortcut(page, 'KeyD');
      
      const newSpeed = await getVideoSpeed(page);
      assert.true(newSpeed > initialSpeed, 'D key should increase speed');
      
      // Test 'S' key for slower
      await testKeyboardShortcut(page, 'KeyS');
      const slowerSpeed = await getVideoSpeed(page);
      assert.true(slowerSpeed < newSpeed, 'S key should decrease speed');
      
      // Test 'R' key for reset
      await testKeyboardShortcut(page, 'KeyR');
      const resetSpeed = await getVideoSpeed(page);
      assert.approximately(resetSpeed, 1.0, 0.1, 'R key should reset speed');
    });
    
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