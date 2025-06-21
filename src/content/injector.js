/**
 * Content script that injects the main extension code into the page context
 * This solves the Manifest V3 isolated world issue
 */

console.log('🚀 VSC Injector loading...');

// Function to inject script into page context
function injectScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(src);
    script.onload = () => {
      console.log(`✅ Injected: ${src}`);
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
  link.href = chrome.runtime.getURL('inject.css');
  document.head.appendChild(link);
  console.log('✅ CSS injected');
}

// Inject all our modules in order
async function injectModules() {
  try {
    console.log('📦 Starting module injection...');
    
    // Inject CSS first
    injectCSS();
    
    const modules = [
      'src/utils/constants.js',
      'src/utils/logger.js',
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
      'src/content/inject.js'
    ];
    
    // Inject modules sequentially to maintain order
    for (const module of modules) {
      await injectScript(module);
    }
    
    console.log('✅ All modules injected successfully');
    
    // Set up message bridge between popup and injected scripts
    setupMessageBridge();
    
  } catch (error) {
    console.error('💥 Module injection failed:', error);
  }
}

// Set up message bridge between extension popup and injected page
function setupMessageBridge() {
  console.log('🌉 Setting up message bridge...');
  
  // Fetch and inject user settings into page context
  injectUserSettings();
  
  // Listen for messages from popup (in content script context)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('🌉 Message received from popup:', message);
    
    // Forward message to injected page context
    if (message && message.type && message.type.startsWith('VSC_')) {
      // Dispatch custom event to page context
      window.dispatchEvent(new CustomEvent('VSC_MESSAGE', {
        detail: message
      }));
      
      sendResponse({ success: true });
      return true;
    }
  });
  
  console.log('✅ Message bridge set up');
}

// Fetch user settings from Chrome storage and inject into page context
async function injectUserSettings() {
  try {
    console.log('⚙️ Fetching user settings from Chrome storage...');
    
    // Get user settings from Chrome storage (available in content script context)
    const userSettings = await new Promise((resolve) => {
      chrome.storage.sync.get(null, (settings) => {
        resolve(settings);
      });
    });
    
    console.log('⚙️ User settings retrieved:', userSettings);
    
    // Inject settings into page context via custom event
    window.dispatchEvent(new CustomEvent('VSC_USER_SETTINGS', {
      detail: userSettings
    }));
    
    console.log('✅ User settings injected into page context');
    
  } catch (error) {
    console.error('❌ Failed to inject user settings:', error);
  }
}

// Start injection when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectModules);
} else {
  injectModules();
}