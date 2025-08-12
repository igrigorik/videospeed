/**
 * Chrome storage management utilities
 * Handles storage access in both content script and page contexts
 */

window.VSC = window.VSC || {};

if (!window.VSC.StorageManager) {
  class StorageManager {
    static errorCallback = null;

    /**
     * Register error callback for monitoring storage failures
     * @param {Function} callback - Callback function for errors
     */
    static onError(callback) {
      this.errorCallback = callback;
    }

    /**
     * Get settings from Chrome storage or pre-injected settings
     * @param {Object} defaults - Default values
     * @returns {Promise<Object>} Storage data
     */
    static async get(defaults = {}) {
      // Check if Chrome APIs are available (content script context)
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        return new Promise((resolve) => {
          chrome.storage.sync.get(defaults, (storage) => {
            window.VSC.logger.debug('Retrieved settings from chrome.storage');
            resolve(storage);
          });
        });
      } else {
        // Page context - read settings from DOM bridge (content script can't share JS objects directly)
        if (!window.VSC_settings) {
          const settingsElement = document.getElementById('vsc-settings-data');
          if (settingsElement && settingsElement.textContent) {
            try {
              window.VSC_settings = JSON.parse(settingsElement.textContent);
              window.VSC.logger.debug('Loaded settings from script element');
              // Clean up the element after reading
              settingsElement.remove();
            } catch (e) {
              window.VSC.logger.error('Failed to parse settings from script element:', e);
            }
          }
        }

        if (window.VSC_settings) {
          // Use the loaded settings
          window.VSC.logger.debug('Using VSC_settings');
          return Promise.resolve({ ...defaults, ...window.VSC_settings });
        } else {
          // Fallback to defaults if no settings available
          window.VSC.logger.debug('No settings available, using defaults');
          return Promise.resolve(defaults);
        }
      }
    }

    /**
     * Set settings in Chrome storage
     * @param {Object} data - Data to store
     * @returns {Promise<void>}
     */
    static async set(data) {
      // Check if Chrome APIs are available (content script context)
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        return new Promise((resolve, reject) => {
          chrome.storage.sync.set(data, () => {
            if (chrome.runtime.lastError) {
              const error = new Error(`Storage failed: ${chrome.runtime.lastError.message}`);
              console.error('Chrome storage save failed:', chrome.runtime.lastError);

              // Call error callback if registered (for monitoring/telemetry)
              if (this.errorCallback) {
                this.errorCallback(error, data);
              }

              reject(error);
              return;
            }
            window.VSC.logger.debug('Settings saved to chrome.storage');
            resolve();
          });
        });
      } else {
        // Page context - send save request to content script via message bridge
        window.VSC.logger.debug('Sending storage update to content script');

        // Post message to content script
        window.postMessage({
          source: 'vsc-page',
          action: 'storage-update',
          data: data
        }, '*');

        // Update local settings cache
        window.VSC_settings = { ...window.VSC_settings, ...data };

        return Promise.resolve();
      }
    }

    /**
     * Remove keys from Chrome storage
     * @param {Array<string>} keys - Keys to remove
     * @returns {Promise<void>}
     */
    static async remove(keys) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        return new Promise((resolve, reject) => {
          chrome.storage.sync.remove(keys, () => {
            if (chrome.runtime.lastError) {
              const error = new Error(`Storage remove failed: ${chrome.runtime.lastError.message}`);
              console.error('Chrome storage remove failed:', chrome.runtime.lastError);

              // Call error callback if registered (for monitoring/telemetry)
              if (this.errorCallback) {
                this.errorCallback(error, { removedKeys: keys });
              }

              reject(error);
              return;
            }
            window.VSC.logger.debug('Keys removed from storage');
            resolve();
          });
        });
      } else {
        // Page context - update local cache
        if (window.VSC_settings) {
          keys.forEach(key => delete window.VSC_settings[key]);
        }
        return Promise.resolve();
      }
    }

    /**
     * Clear all Chrome storage
     * @returns {Promise<void>}
     */
    static async clear() {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        return new Promise((resolve, reject) => {
          chrome.storage.sync.clear(() => {
            if (chrome.runtime.lastError) {
              const error = new Error(`Storage clear failed: ${chrome.runtime.lastError.message}`);
              console.error('Chrome storage clear failed:', chrome.runtime.lastError);

              // Call error callback if registered (for monitoring/telemetry)
              if (this.errorCallback) {
                this.errorCallback(error, { operation: 'clear' });
              }

              reject(error);
              return;
            }
            window.VSC.logger.debug('Storage cleared');
            resolve();
          });
        });
      } else {
        // Page context - clear local cache
        window.VSC_settings = {};
        return Promise.resolve();
      }
    }

    /**
     * Listen for storage changes
     * @param {Function} callback - Callback function for changes
     */
    static onChanged(callback) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName === 'sync') {
            callback(changes);
          }
        });
      } else {
        // Page context - listen for storage changes from content script
        window.addEventListener('message', (event) => {
          if (event.data?.source === 'vsc-content' && event.data?.action === 'storage-changed') {
            // Convert to chrome.storage.onChanged format
            const changes = {};
            for (const [key, value] of Object.entries(event.data.data)) {
              changes[key] = { newValue: value, oldValue: window.VSC_settings?.[key] };
            }
            // Update local cache
            window.VSC_settings = { ...window.VSC_settings, ...event.data.data };
            callback(changes);
          }
        });
      }
    }
  }

  window.VSC.StorageManager = StorageManager;
}
