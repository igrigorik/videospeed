/**
 * Background Service Worker for Video Speed Controller
 * Manages extension badge to indicate active controllers
 */

// Track active controllers per tab
const tabControllers = new Map();

/**
 * Update extension icon for a specific tab
 * @param {number} tabId - Tab ID
 * @param {boolean} hasActiveControllers - Whether tab has active controllers
 */
async function updateIcon(tabId, hasActiveControllers) {
  try {
    // Use regular (red) icons for active state, disabled (gray) for inactive
    // This makes red icon indicate "activity" which is intuitive
    const suffix = hasActiveControllers ? '' : '_disabled';

    await chrome.action.setIcon({
      tabId: tabId,
      path: {
        "19": chrome.runtime.getURL(`src/assets/icons/icon19${suffix}.png`),
        "38": chrome.runtime.getURL(`src/assets/icons/icon38${suffix}.png`),
        "48": chrome.runtime.getURL(`src/assets/icons/icon48${suffix}.png`)
      }
    });

    console.log(`Icon updated for tab ${tabId}: ${hasActiveControllers ? 'active (red)' : 'inactive (gray)'}`);
  } catch (error) {
    console.error('Failed to update icon:', error);
  }
}

/**
 * Update visual indicators for a specific tab (icon state)
 * @param {number} tabId - Tab ID
 * @param {boolean} hasActiveControllers - Whether tab has active controllers
 */
async function updateTabIndicators(tabId, hasActiveControllers) {
  // Only update icon since badge is disabled
  await updateIcon(tabId, hasActiveControllers);
}

/**
 * Handle controller lifecycle messages from content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return;

  const tabId = sender.tab.id;

  switch (message.type) {
    case 'VSC_CONTROLLER_CREATED':
      // Track controller creation
      if (!tabControllers.has(tabId)) {
        tabControllers.set(tabId, new Set());
      }

      tabControllers.get(tabId).add(message.controllerId || 'default');
      updateTabIndicators(tabId, true);

      console.log(`Controller created in tab ${tabId}. Total: ${tabControllers.get(tabId).size}`);
      break;

    case 'VSC_CONTROLLER_REMOVED':
      // Track controller removal
      if (tabControllers.has(tabId)) {
        tabControllers.get(tabId).delete(message.controllerId || 'default');

        const hasControllers = tabControllers.get(tabId).size > 0;
        updateTabIndicators(tabId, hasControllers);

        // Clean up empty sets
        if (!hasControllers) {
          tabControllers.delete(tabId);
        }

        console.log(`Controller removed from tab ${tabId}. Remaining: ${tabControllers.get(tabId)?.size || 0}`);
      }
      break;

    case 'VSC_QUERY_ACTIVE_CONTROLLERS':
      // Respond with current controller count for this tab
      const controllerCount = tabControllers.get(tabId)?.size || 0;
      sendResponse({
        hasActiveControllers: controllerCount > 0,
        controllerCount: controllerCount
      });
      return true; // Keep message channel open for async response
  }
});

/**
 * Handle tab updates (navigation, refresh, etc.)
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Clear controller tracking when page is refreshed/navigated
  if (changeInfo.status === 'loading' && tab.url) {
    if (tabControllers.has(tabId)) {
      tabControllers.delete(tabId);
      updateTabIndicators(tabId, false);
      console.log(`Tab ${tabId} navigated, cleared controller tracking`);
    }
  }
});

/**
 * Handle tab removal
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabControllers.has(tabId)) {
    tabControllers.delete(tabId);
    console.log(`Tab ${tabId} closed, removed from tracking`);
  }
});

/**
 * Handle tab activation (switching between tabs)
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Explicitly update badge when switching tabs
  try {
    const hasControllers = tabControllers.has(activeInfo.tabId) &&
      tabControllers.get(activeInfo.tabId).size > 0;

    // Update the badge for the newly active tab
    await updateTabIndicators(activeInfo.tabId, hasControllers);

    console.log(`Switched to tab ${activeInfo.tabId}, has controllers: ${hasControllers}`);
  } catch (error) {
    console.error('Error handling tab activation:', error);
  }
});

/**
 * Set default icon state (gray/disabled) for all tabs
 */
async function setDefaultIconState() {
  try {
    await chrome.action.setIcon({
      path: {
        "19": chrome.runtime.getURL("src/assets/icons/icon19_disabled.png"),
        "38": chrome.runtime.getURL("src/assets/icons/icon38_disabled.png"),
        "48": chrome.runtime.getURL("src/assets/icons/icon48_disabled.png")
      }
    });
    console.log('Default icon state set to inactive (gray)');
  } catch (error) {
    console.error('Failed to set default icon state:', error);
  }
}

/**
 * Initialize on startup
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('Video Speed Controller background script started');

  // Clear controller tracking on startup
  tabControllers.clear();

  // Set default icon state
  await setDefaultIconState();
});

/**
 * Initialize on install/update
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Video Speed Controller installed/updated');

  // Clear controller tracking on install
  tabControllers.clear();

  // Set default icon state
  await setDefaultIconState();
});

console.log('Video Speed Controller background script loaded'); 