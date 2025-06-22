/**
 * Chrome storage management utilities
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

class StorageManager {
  // Cache for user settings injected from content script
  static _injectedSettings = null;

  // Listen for injected settings from content script
  static _setupSettingsListener() {
    if (typeof window !== 'undefined' && !this._listenerSetup) {
      window.addEventListener('VSC_USER_SETTINGS', (event) => {
        window.VSC.logger.debug('Received user settings from content script');
        this._injectedSettings = event.detail;
      });
      this._listenerSetup = true;
    }
  }
  /**
   * Get settings from Chrome storage
   * @param {Object} defaults - Default values
   * @returns {Promise<Object>} Storage data
   */
  static async get(defaults = {}) {
    // Set up listener for injected settings
    this._setupSettingsListener();

    // Check if Chrome APIs are available (content script context)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      return new Promise((resolve) => {
        chrome.storage.sync.get(defaults, (storage) => {
          window.VSC.logger.debug('Retrieved settings from storage');
          resolve(storage);
        });
      });
    } else {
      // Fallback for injected page context - use injected settings if available
      if (this._injectedSettings) {
        window.VSC.logger.debug('Using injected user settings');
        window.VSC.logger.debug('Using injected user settings from content script');
        // Merge injected settings with defaults
        return Promise.resolve({ ...defaults, ...this._injectedSettings });
      } else {
        window.VSC.logger.debug('Chrome storage not available, using default settings');
        return Promise.resolve(defaults);
      }
    }
  }

  /**
   * Wait for injected settings to become available
   * @param {Object} defaults - Default values
   * @returns {Promise<Object>} Settings when available
   */
  static async waitForInjectedSettings(defaults = {}) {
    this._setupSettingsListener();

    if (this._injectedSettings) {
      const merged = { ...defaults, ...this._injectedSettings };
      window.VSC.logger.debug('Using available injected settings');
      return Promise.resolve(merged);
    }

    return new Promise((resolve) => {
      const checkSettings = () => {
        if (this._injectedSettings) {
          const merged = { ...defaults, ...this._injectedSettings };
          window.VSC.logger.debug('Injected settings now available');
          resolve(merged);
        } else {
          // Check again in next tick
          setTimeout(checkSettings, 10);
        }
      };
      checkSettings();
    });
  }

  /**
   * Set settings in Chrome storage
   * @param {Object} data - Data to store
   * @returns {Promise<void>}
   */
  static async set(data) {
    // Check if Chrome APIs are available (content script context)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      return new Promise((resolve) => {
        chrome.storage.sync.set(data, () => {
          window.VSC.logger.debug('Settings saved to storage');
          resolve();
        });
      });
    } else {
      // Fallback for injected page context - send save request to content script
      window.VSC.logger.debug('Sending save request to content script');
      window.VSC.logger.debug('Sending settings save request to content script');

      // Send data to content script via custom event
      window.dispatchEvent(
        new CustomEvent('VSC_SAVE_SETTINGS', {
          detail: data,
        })
      );

      // Update injected settings cache
      this._injectedSettings = { ...this._injectedSettings, ...data };

      return Promise.resolve();
    }
  }

  /**
   * Remove keys from Chrome storage
   * @param {Array<string>} keys - Keys to remove
   * @returns {Promise<void>}
   */
  static async remove(keys) {
    return new Promise((resolve) => {
      chrome.storage.sync.remove(keys, () => {
        window.VSC.logger.debug('Keys removed from storage');
        resolve();
      });
    });
  }

  /**
   * Clear all Chrome storage
   * @returns {Promise<void>}
   */
  static async clear() {
    return new Promise((resolve) => {
      chrome.storage.sync.clear(() => {
        window.VSC.logger.debug('Storage cleared');
        resolve();
      });
    });
  }

  /**
   * Listen for storage changes
   * @param {Function} callback - Callback function for changes
   */
  static onChanged(callback) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync') {
        callback(changes);
      }
    });
  }
}

// Create singleton instance
window.VSC.StorageManager = StorageManager;
