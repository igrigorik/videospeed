/**
 * Chrome storage management utilities
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

// Skip loading if already loaded to prevent redeclaration errors
if (!window.VSC.StorageManager) {
  class StorageManager {
    // Cache for user settings injected from content script
    static _injectedSettings = null;

    // Listen for injected settings from content script
    static _setupSettingsListener() {
      if (typeof window !== 'undefined' && !this._listenerSetup) {
        try {
          window.addEventListener('VSC_USER_SETTINGS', (event) => {
            try {
              window.VSC.logger.debug('Received user settings from content script:', event.detail);
              window.VSC.logger.debug('Previous injected settings:', this._injectedSettings);
              this._injectedSettings = event.detail || {};
              window.VSC.logger.debug('Updated injected settings to:', this._injectedSettings);
              if (this._injectedSettings.controllerPosition) {
                window.VSC.logger.debug('controllerPosition in updated settings:', this._injectedSettings.controllerPosition);
              }
            } catch (eventError) {
              console.error('Error processing VSC_USER_SETTINGS event:', eventError);
            }
          });
          this._listenerSetup = true;
        } catch (setupError) {
          console.error('Error setting up settings listener:', setupError);
        }
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
          chrome.storage.sync.get(defaults, (result) => {
            window.VSC.logger.debug('Settings loaded from Chrome storage:', result);
            resolve(result);
          });
        });
      } else {
        // Fallback for injected page context - wait for settings from content script
        window.VSC.logger.debug(
          'Chrome storage not available, waiting for injected settings...'
        );
        const settings = await this.waitForInjectedSettings(defaults);
        window.VSC.logger.debug('Settings received from content script:', settings);
        return settings;
      }
    }    /**
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
} // End conditional loading check
