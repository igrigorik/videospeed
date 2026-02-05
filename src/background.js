/**
 * Update extension icon based on enabled state
 * @param {boolean} enabled - Whether extension is enabled
 * @param {number} [tabId] - Optional tab ID to update icon for specific tab
 */
async function updateIcon(enabled, tabId) {
  try {
    const suffix = enabled ? '' : '_disabled';
    const iconOptions = {
      path: {
        19: `assets/icons/icon19${suffix}.png`,
        38: `assets/icons/icon38${suffix}.png`,
        48: `assets/icons/icon48${suffix}.png`,
      },
    };
    if (tabId) {
      iconOptions.tabId = tabId;
    }
    await chrome.action.setIcon(iconOptions);
    console.log(`Icon updated: ${enabled ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.error('Failed to update icon:', error);
  }
}

/**
 * Update the extension badge to show current playback speed
 * @param {number} speed - Current playback speed
 * @param {number} tabId - Tab ID to update badge for
 */
async function updateSpeedBadge(speed, tabId) {
  try {
    // Format speed compactly: "2" for 2.0x, "1.5" for 1.5x, empty for 1.0x
    let badgeText = '';
    if (speed !== 1.0) {
      badgeText = speed % 1 === 0 ? speed.toFixed(0) : speed.toFixed(1);
    }

    await chrome.action.setBadgeText({
      text: badgeText,
      tabId: tabId,
    });

    await chrome.action.setBadgeBackgroundColor({
      color: '#43464c',
      tabId: tabId,
    });
  } catch (error) {
    console.error('Failed to update speed badge:', error);
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
    await updateIcon(true);
  }
}

/**
 * Migrate storage to current config version
 * Removes deprecated keys from older versions
 */
async function migrateConfig() {
  const DEPRECATED_KEYS = [
    // Removed in v0.9.x
    'speeds',
    'version',

    // Migrated to keyBindings array in v0.6.x
    'resetSpeed',
    'speedStep',
    'fastSpeed',
    'rewindTime',
    'advanceTime',
    'resetKeyCode',
    'slowerKeyCode',
    'fasterKeyCode',
    'rewindKeyCode',
    'advanceKeyCode',
    'fastKeyCode',
    'displayKeyCode',
  ];

  try {
    await chrome.storage.sync.remove(DEPRECATED_KEYS);
    console.log('[VSC] Config migrated to current version');
  } catch (error) {
    console.error('[VSC] Config migration failed:', error);
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
 * Handle messages from popup and content scripts
 */
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'EXTENSION_TOGGLE') {
    // Update icon when extension is toggled via popup
    updateIcon(message.enabled);
  } else if (message.type === 'SPEED_CHANGE' && sender.tab) {
    // Update badge when playback speed changes
    updateSpeedBadge(message.speed, sender.tab.id);
  }
});

/**
 * Initialize on install/update
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Video Speed Controller installed/updated');
  await migrateConfig();
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
