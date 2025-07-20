/**
 * Content script that injects the main extension code into the page context
 * This solves the Manifest V3 isolated world issue
 */

// Function to inject script into page context
function injectScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(src);
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      console.error(`❌ Failed to inject: ${src}`);
      reject(new Error(`Failed to inject ${src}`));
    };
    (document.head || document.documentElement).appendChild(script);
  });
}

// Inject CSS first
function injectCSS() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = chrome.runtime.getURL('src/styles/inject.css');
  document.head.appendChild(link);
}

// Inject all our modules in order
async function injectModules() {
  try {
    // Inject CSS first
    injectCSS();

    const modules = [
      'src/utils/constants.js',
      'src/utils/logger.js',
      'src/utils/debug-helper.js',
      'src/utils/dom-utils.js',
      'src/utils/event-manager.js',
      'src/core/storage-manager.js',
      'src/core/settings.js',
      'src/observers/media-observer.js',
      'src/observers/mutation-observer.js',
      'src/core/action-handler.js',
      'src/core/video-controller.js',
      'src/ui/controls.js',
      'src/ui/drag-handler.js',
      'src/ui/shadow-dom.js',
      'src/site-handlers/base-handler.js',
      'src/site-handlers/netflix-handler.js',
      'src/site-handlers/youtube-handler.js',
      'src/site-handlers/facebook-handler.js',
      'src/site-handlers/amazon-handler.js',
      'src/site-handlers/apple-handler.js',
      'src/site-handlers/index.js',
      'src/content/inject.js',
    ];

    // Inject modules with yielding to avoid blocking page load
    for (let i = 0; i < modules.length; i++) {
      const module = modules[i];
      await injectScript(module);

      // Yield control to browser every few modules to avoid blocking
      if (i > 0 && i % 5 === 0) {
        await new Promise((resolve) => {
          if (window.requestIdleCallback) {
            requestIdleCallback(resolve, { timeout: 50 });
          } else {
            setTimeout(resolve, 5);
          }
        });
      }
    }

    // Inject site-specific scripts if needed
    await injectSiteSpecificScripts();

    // Set up message bridge between popup and injected scripts
    setupMessageBridge();
  } catch (error) {
    console.error('💥 Module injection failed:', error);
  }
}

// Inject site-specific scripts based on current domain
async function injectSiteSpecificScripts() {
  try {
    // Check current domain and inject appropriate scripts
    const hostname = location.hostname;
    if (hostname === 'www.netflix.com') {
      console.log('🎬 Netflix detected, injecting Netflix script...');
      await injectScript('src/site-handlers/scripts/netflix.js');
    }

    // Add other site-specific scripts here as needed
    // if (hostname === 'www.youtube.com') {
    //   await injectScript('src/site-handlers/scripts/youtube.js');
    // }
  } catch (error) {
    console.error('❌ Failed to inject site-specific scripts:', error);
  }
}

// Set up message bridge between extension popup and injected page
function setupMessageBridge() {
  // Fetch and inject user settings into page context
  injectUserSettings();

  // Listen for messages from popup (in content script context)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Forward message to injected page context
    if (message && message.type && message.type.startsWith('VSC_')) {
      // Dispatch custom event to page context
      window.dispatchEvent(
        new CustomEvent('VSC_MESSAGE', {
          detail: message,
        })
      );

      sendResponse({ success: true });
      return true;
    }
  });

  // Listen for save settings requests from injected page context
  window.addEventListener('VSC_SAVE_SETTINGS', async (event) => {
    try {
      // Save to Chrome storage (available in content script context)
      await new Promise((resolve, reject) => {
        chrome.storage.sync.set(event.detail, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('❌ Failed to save settings to Chrome storage:', error);
    }
  });

  // Listen for controller lifecycle events from injected page context
  window.addEventListener('VSC_CONTROLLER_CREATED', (event) => {
    // Forward controller creation to background script for icon management
    try {
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'VSC_CONTROLLER_CREATED',
          controllerId: event.detail?.controllerId || 'default',
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      // Silently ignore extension context invalidation errors
      try {
        if (!error.message?.includes('Extension context invalidated')) {
          console.warn('Failed to send controller created message:', error);
        }
      } catch (innerError) {
        // Even accessing error.message can fail when context is invalidated
        // Silently ignore all errors during extension reloads
      }
    }
  });

  window.addEventListener('VSC_CONTROLLER_REMOVED', (event) => {
    // Forward controller removal to background script for icon management
    try {
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'VSC_CONTROLLER_REMOVED',
          controllerId: event.detail?.controllerId || 'default',
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      // Silently ignore extension context invalidation errors
      try {
        if (!error.message?.includes('Extension context invalidated')) {
          console.warn('Failed to send controller removed message:', error);
        }
      } catch (innerError) {
        // Even accessing error.message can fail when context is invalidated
        // Silently ignore all errors during extension reloads
      }
    }
  });
}

// Fetch user settings from Chrome storage and inject into page context
async function injectUserSettings() {
  try {
    // Get user settings from Chrome storage (available in content script context)
    const userSettings = await new Promise((resolve) => {
      chrome.storage.sync.get(null, (settings) => {
        resolve(settings);
      });
    });

    // Inject settings into page context via custom event
    window.dispatchEvent(
      new CustomEvent('VSC_USER_SETTINGS', {
        detail: userSettings,
      })
    );
  } catch (error) {
    console.error('❌ Failed to inject user settings:', error);
  }
}

// Start injection when DOM is ready
if (document.readyState === 'loading') {
  // Wait for DOMContentLoaded, then defer injection to avoid blocking page load
  document.addEventListener('DOMContentLoaded', () => {
    // Use requestIdleCallback to wait for browser to be less busy
    if (window.requestIdleCallback) {
      requestIdleCallback(injectModules, { timeout: 3000 });
    } else {
      // Fallback with short delay to let page finish initial rendering
      setTimeout(injectModules, 100);
    }
  });
} else if (document.readyState === 'interactive') {
  // Document is still loading, wait a bit more
  if (window.requestIdleCallback) {
    requestIdleCallback(injectModules, { timeout: 2000 });
  } else {
    setTimeout(injectModules, 50);
  }
} else {
  // Document is complete, but still defer to avoid interfering with other scripts
  if (window.requestIdleCallback) {
    requestIdleCallback(injectModules, { timeout: 1000 });
  } else {
    setTimeout(injectModules, 10);
  }
}
