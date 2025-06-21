/**
 * E2E tests for settings injection from content script to injected page context
 * Tests that user settings are properly loaded and applied in injected context
 */

import { 
  launchChromeWithExtension
} from './e2e-utils.js';

console.log('🧪 Running Settings Injection E2E Tests...');

let browser, page;

try {
  // Launch Chrome with extension
  console.log('📁 Loading extension...');
  const result = await launchChromeWithExtension();
  browser = result.browser;
  page = result.page;

  // Navigate to YouTube
  console.log('🌐 Navigating to YouTube...');
  await page.goto('https://www.youtube.com/watch?v=gGCJOTvECVQ', { waitUntil: 'networkidle2' });

  // Wait for extension to load
  await page.waitForTimeout(3000);

  console.log('🧪 Settings injection should work with user preferences');
  
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
        { action: 'display', key: 86, value: 0, force: false, predefined: true }
      ],
      enabled: true,
      lastSpeed: 1.9
    };
    
    // Dispatch the settings event to simulate content script injection
    window.dispatchEvent(new CustomEvent('VSC_USER_SETTINGS', {
      detail: mockSettings
    }));
  });

  // Wait for settings to be processed
  await page.waitForTimeout(1000);

  // Verify settings were applied correctly
  const settingsState = await page.evaluate(() => {
    const config = window.VSC?.videoSpeedConfig;
    const fasterBinding = config?.settings?.keyBindings?.find(kb => kb.action === 'faster');
    const resetBinding = config?.settings?.keyBindings?.find(kb => kb.action === 'reset');
    
    return {
      hasConfig: !!config,
      keyBindingsCount: config?.settings?.keyBindings?.length || 0,
      fasterIncrement: fasterBinding?.value,
      resetPreferredSpeed: resetBinding?.value,
      injectedSettingsAvailable: !!window.VSC?.StorageManager?._injectedSettings
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

  console.log('✅ Settings injection should work with user preferences');

  console.log('🧪 Keyboard shortcuts should use injected settings');
  
  // Focus video and test keyboard shortcuts with custom increments
  await page.focus('video');
  
  // Get initial speed
  const initialSpeed = await page.evaluate(() => {
    const video = document.querySelector('video');
    return video ? video.playbackRate : null;
  });

  // Press D key to increase speed
  await page.keyboard.press('KeyD');
  await page.waitForTimeout(100);

  const newSpeed = await page.evaluate(() => {
    const video = document.querySelector('video');
    return video ? video.playbackRate : null;
  });

  const speedDifference = Math.round((newSpeed - initialSpeed) * 10) / 10;
  
  if (speedDifference !== 0.2) {
    throw new Error(`Expected speed increment of 0.2, got ${speedDifference}`);
  }

  console.log(`✅ Speed changed by ${speedDifference} (custom increment)`);
  console.log('✅ Keyboard shortcuts should use injected settings');

  console.log('🧪 Reset key should use preferred speed');
  
  // Press R key to reset to preferred speed
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(100);

  const resetSpeed = await page.evaluate(() => {
    const video = document.querySelector('video');
    return video ? video.playbackRate : null;
  });

  if (resetSpeed !== 1.9) {
    throw new Error(`Expected reset speed 1.9, got ${resetSpeed}`);
  }

  console.log(`✅ Reset speed to ${resetSpeed} (preferred speed)`);
  console.log('✅ Reset key should use preferred speed');

  console.log('🧪 Settings should persist through extension reload');
  
  // Test that settings remain available after reloading extension config
  await page.evaluate(() => {
    if (window.videoSpeedExtension) {
      return window.videoSpeedExtension.config.load();
    }
  });

  const reloadedSettings = await page.evaluate(() => {
    const config = window.VSC?.videoSpeedConfig;
    const fasterBinding = config?.settings?.keyBindings?.find(kb => kb.action === 'faster');
    return fasterBinding?.value;
  });

  if (reloadedSettings !== 0.2) {
    throw new Error(`Settings not persistent after reload: expected 0.2, got ${reloadedSettings}`);
  }

  console.log('✅ Settings should persist through extension reload');

  console.log('\n📊 Settings Injection E2E Results: 4 passed, 0 failed');
  console.log('✅ 4 passed, 0 failed');

} catch (error) {
  console.error(`❌ Test failed: ${error.message}`);
  console.log('\n📊 Settings Injection E2E Results: 0 passed, 1 failed');
  console.log('❌ 0 passed, 1 failed');
  process.exit(1);
} finally {
  if (browser) {
    await browser.close();
  }
}