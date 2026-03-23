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
      return;
    }

    // Early exit if site is blacklisted
    if (isBlacklisted(settings.blacklist, location.href)) {
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
    const bridge = setupMessageBridge();

    // Lifecycle watcher: tear down or reinit when blacklist/enabled changes.
    // The content script is the lifecycle owner — it gates initialization above,
    // and it gates teardown/reinit here, using the same bridge the popup uses for commands.
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'sync') return;

      const disabled = 'enabled' in changes && changes.enabled.newValue === false;
      const blacklisted = 'blacklist' in changes &&
        isBlacklisted(changes.blacklist.newValue, location.href);

      if (disabled || blacklisted) {
        bridge.sendCommand('VSC_TEARDOWN');
        return;
      }

      const reEnabled = 'enabled' in changes && changes.enabled.newValue === true;
      const unblacklisted = 'blacklist' in changes &&
        !isBlacklisted(changes.blacklist.newValue, location.href);

      if (reEnabled || unblacklisted) {
        bridge.sendCommand('VSC_REINIT');
      }
    });

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
