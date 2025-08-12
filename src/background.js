/**
 * Background Service Worker for Video Speed Controller
 * Manages extension badge to indicate active controllers
 */

// Track which tabs have active controllers (binary state)
const tabsWithControllers = new Set();

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
    if (error.message.includes('No tab with id')) {
      // This can happen if the tab is closed before the icon is updated.
      // We can safely ignore this error and clean up our tracking.
      tabsWithControllers.delete(tabId);
      console.error(`Attempted to update icon for a closed tab (${tabId}). Cleaned up tracking.`);
    } else {
      console.error(`Failed to update icon for tab ${tabId}:`, error);
    }
  }
}

/**
 * Handle controller lifecycle messages from content scripts
 */
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (!sender.tab) return;

  const tabId = sender.tab.id;

  switch (message.type) {
    case 'VSC_STATE_UPDATE':
      // Unified state update from page context
      const currentlyHasControllers = tabsWithControllers.has(tabId);
      const shouldHaveControllers = message.hasActiveControllers;

      // Only update icon if state actually changed
      if (currentlyHasControllers !== shouldHaveControllers) {
        if (shouldHaveControllers) {
          tabsWithControllers.add(tabId);
        } else {
          tabsWithControllers.delete(tabId);
        }
        await updateIcon(tabId, shouldHaveControllers);
        console.log(
          `Tab ${tabId} state updated: ${shouldHaveControllers ? 'active' : 'inactive'} ` +
          `(${message.controllerCount || 0} controllers)`
        );
      }
      break;

    case 'VSC_QUERY_STATE':
      // Unified state query
      const tabHasControllers = tabsWithControllers.has(tabId);
      sendResponse({
        hasActiveControllers: tabHasControllers,
        controllerCount: tabHasControllers ? 1 : 0
      });
      return true; // Keep message channel open for async response
  }
});

/**
 * Handle tab updates (navigation, refresh, etc.)
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Clear controller tracking when page is refreshed/navigated
  if (changeInfo.status === 'loading' && tab.url) {
    if (tabsWithControllers.has(tabId)) {
      tabsWithControllers.delete(tabId);
      await updateIcon(tabId, false);
      console.log(`Tab ${tabId} navigated, cleared controller tracking`);
    }
  }
});

/**
 * Handle tab removal
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabsWithControllers.has(tabId)) {
    tabsWithControllers.delete(tabId);
    console.log(`Tab ${tabId} closed, removed from tracking`);
  }
});

/**
 * Handle tab activation (switching between tabs)
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Update icon for the newly active tab
  try {
    const hasControllers = tabsWithControllers.has(activeInfo.tabId);
    await updateIcon(activeInfo.tabId, hasControllers);
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
  tabsWithControllers.clear();

  // Set default icon state
  await setDefaultIconState();
});

/**
 * Initialize on install/update
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Video Speed Controller installed/updated');

  // Clear controller tracking on install
  tabsWithControllers.clear();

  // Set default icon state
  await setDefaultIconState();
});

console.log('Video Speed Controller background script loaded'); 