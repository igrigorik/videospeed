/**
 * Update extension icon based on enabled state
 * @param {boolean} enabled - Whether extension is enabled
 */
async function updateIcon(enabled) {
  try {
    const suffix = enabled ? '' : '_disabled';
    await chrome.action.setIcon({
      path: {
        "19": `assets/icons/icon19${suffix}.png`,
        "38": `assets/icons/icon38${suffix}.png`,
        "48": `assets/icons/icon48${suffix}.png`
      }
    });
    console.log(`Icon updated: ${enabled ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.error('Failed to update icon:', error);
  }
}

/**
 * Initialize icon state from storage
 */
async function initializeIcon() {
  try {
    const storage = await chrome.storage.sync.get({ enabled: true });
    await updateIcon(storage.enabled);
  } catch (error) {
    console.error('Failed to initialize icon:', error);
    // Default to enabled if storage read fails
    await updateIcon(true);
  }
}

/**
 * Listen for storage changes (extension enabled/disabled)
 */
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.enabled) {
    updateIcon(changes.enabled.newValue !== false);
  }
});

/**
 * Handle messages from popup
 */
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'EXTENSION_TOGGLE') {
    // Update icon when extension is toggled via popup
    updateIcon(message.enabled);
  }
});

/**
 * Initialize on install/update
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Video Speed Controller installed/updated');
  await initializeIcon();
});

/**
 * Initialize on startup
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('Video Speed Controller started');
  await initializeIcon();
});

// Initialize immediately when service worker loads
initializeIcon();

console.log('Video Speed Controller background script loaded');