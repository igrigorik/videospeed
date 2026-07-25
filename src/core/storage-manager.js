/**
 * Chrome storage management utilities.
 *
 * Context-aware: uses chrome.storage.sync when available (extension contexts),
 * falls back to CustomEvent bridge with content-bridge.js (MAIN world).
 */

window.VSC = window.VSC || {};

if (!window.VSC.StorageManager) {
  const docEl = document.documentElement;

  /** True when chrome.storage.sync is available (extension contexts). */
  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;

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
     * @param {Object} defaults - Default values
     * @returns {Promise<Object>} Storage data
     */
    static async get(defaults = {}) {
      if (hasChrome) {
        return new Promise((resolve) => {
          chrome.storage.sync.get(defaults, (storage) => {
            window.VSC.logger?.debug?.('StorageManager: settings from chrome.storage');
            resolve(storage);
          });
        });
      }

      // No chrome.storage — request settings from bridge via CustomEvent
      return new Promise((resolve) => {
        const onReady = (e) => {
          docEl.removeEventListener('VSC_SETTINGS_READY', onReady);
          clearTimeout(timeout);
          const detail = e.detail;

          // Missing bridge data means settings authorization is unknown. Fail
          // closed rather than initializing with defaults on a disabled site.
          if (!detail) {
            window.VSC.logger?.error?.('StorageManager: bridge response is null (clone failed?)');
            resolve(null);
            return;
          }

          // Bridge signals abort for blacklisted/disabled sites.
          if (detail.abort) {
            window.VSC.logger?.debug?.('StorageManager: site disabled by bridge');
            resolve(null);
            return;
          }

          // CustomEvents are page-visible and therefore not an authentication
          // boundary. Reject malformed payloads instead of letting `{}` or an
          // unrelated page event silently activate MAIN with defaults.
          if (
            !detail.settings ||
            typeof detail.settings !== 'object' ||
            Array.isArray(detail.settings)
          ) {
            window.VSC.logger?.error?.('StorageManager: invalid settings response from bridge');
            resolve(null);
            return;
          }

          window.VSC.logger?.debug?.('StorageManager: settings from bridge');
          resolve({ ...defaults, ...detail.settings });
        };

        const timeout = setTimeout(() => {
          docEl.removeEventListener('VSC_SETTINGS_READY', onReady);
          window.VSC.logger?.warn?.('StorageManager: settings timeout, aborting initialization');
          resolve(null);
        }, 2000);

        docEl.addEventListener('VSC_SETTINGS_READY', onReady);

        docEl.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));
      });
    }

    /**
     * @param {Object} data - Data to store
     * @returns {Promise<void>}
     */
    static async set(data) {
      if (hasChrome) {
        return new Promise((resolve, reject) => {
          chrome.storage.sync.set(data, () => {
            if (chrome.runtime.lastError) {
              const error = new Error(`Storage failed: ${chrome.runtime.lastError.message}`);
              window.VSC.logger?.error?.(
                `Chrome storage save failed: ${chrome.runtime.lastError.message}`
              );
              if (this.errorCallback) {
                this.errorCallback(error, data);
              }
              reject(error);
              return;
            }
            window.VSC.logger?.debug?.('StorageManager: saved to chrome.storage');
            resolve();
          });
        });
      }

      // Only lastSpeed can cross the trust boundary to chrome.storage
      const keys = Object.keys(data);
      if (keys.length === 1 && keys[0] === 'lastSpeed') {
        const speed = data.lastSpeed;
        if (typeof speed === 'number' && Number.isFinite(speed)) {
          docEl.dispatchEvent(
            new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: speed } })
          );
        } else {
          window.VSC.logger?.warn?.('StorageManager.set: invalid lastSpeed value');
        }
      } else {
        window.VSC.logger?.warn?.(
          `StorageManager.set: only lastSpeed bridgeable from MAIN. Keys: ${keys.join(', ')}`
        );
      }

      // Update local cache regardless (keeps in-memory state current)
      window.VSC_settings = { ...window.VSC_settings, ...data };
      return Promise.resolve();
    }

    /**
     * Remove keys from storage.
     * @param {Array<string>} keys - Keys to remove
     * @returns {Promise<void>}
     */
    static async remove(keys) {
      if (hasChrome) {
        return new Promise((resolve, reject) => {
          chrome.storage.sync.remove(keys, () => {
            if (chrome.runtime.lastError) {
              const error = new Error(`Storage remove failed: ${chrome.runtime.lastError.message}`);
              window.VSC.logger?.error?.(
                `Chrome storage remove failed: ${chrome.runtime.lastError.message}`
              );
              if (this.errorCallback) {
                this.errorCallback(error, { removedKeys: keys });
              }
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
      // No chrome.storage — update local cache only
      if (window.VSC_settings) {
        keys.forEach((key) => delete window.VSC_settings[key]);
      }
      return Promise.resolve();
    }

    /**
     * Clear all storage.
     * @returns {Promise<void>}
     */
    static async clear() {
      if (hasChrome) {
        return new Promise((resolve, reject) => {
          chrome.storage.sync.clear(() => {
            if (chrome.runtime.lastError) {
              const error = new Error(`Storage clear failed: ${chrome.runtime.lastError.message}`);
              window.VSC.logger?.error?.(
                `Chrome storage clear failed: ${chrome.runtime.lastError.message}`
              );
              if (this.errorCallback) {
                this.errorCallback(error, { operation: 'clear' });
              }
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
      window.VSC_settings = {};
      return Promise.resolve();
    }

    /**
     * @param {Function} callback - Callback with changes in chrome.storage.onChanged format
     */
    static onChanged(callback) {
      if (hasChrome) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName === 'sync') {
            callback(changes);
          }
        });
      } else {
        docEl.addEventListener('VSC_STORAGE_CHANGED', (e) => {
          const changes = e.detail;
          for (const [key, change] of Object.entries(changes)) {
            if (change.newValue !== undefined) {
              window.VSC_settings = window.VSC_settings || {};
              window.VSC_settings[key] = change.newValue;
            }
          }
          callback(changes);
        });
      }
    }
  }

  window.VSC.StorageManager = StorageManager;
}
