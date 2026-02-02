/**
 * Content script entry point - handles Chrome API access and page injection
 * This runs in the content script context with access to chrome.* APIs
 */

import { injectScript, setupMessageBridge } from '../content/injection-bridge.js';
import { isBlacklisted } from '../utils/blacklist.js';

async function init() {
  try {
    const settings = await chrome.storage.sync.get(null);

    // Early exit if extension is disabled
    if (settings.enabled === false) {
      console.debug('[VSC] Extension disabled');
      return;
    }

    // Early exit if site is blacklisted
    if (isBlacklisted(settings.blacklist, location.href)) {
      console.debug('[VSC] Site blacklisted');
      return;
    }

    delete settings.blacklist;
    delete settings.enabled;

    // Bridge settings to page context via DOM (only synchronous path between Chrome's isolated worlds)
    // Script elements with type="application/json" are inert, avoiding site interference and CSP issues
    const settingsElement = document.createElement('script');
    settingsElement.id = 'vsc-settings-data';
    settingsElement.type = 'application/json';
    settingsElement.textContent = JSON.stringify(settings);
    (document.head || document.documentElement).appendChild(settingsElement);

    // Inject the bundled page script containing all VSC modules
    await injectScript('inject.js');

    // Set up bi-directional message bridge for popup ↔ page communication
    setupMessageBridge();

    console.debug('[VSC] Content script initialized');
  } catch (error) {
    console.error('[VSC] Failed to initialize:', error);
  }
}

// Initialize on DOM ready or immediately if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
