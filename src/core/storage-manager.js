/**
 * Storage access for both sides of the content-script boundary.
 *
 * Extension pages reach chrome.storage.sync directly. The page script (MAIN
 * world) has no chrome.* APIs and goes through content-bridge.js. Of storage,
 * the bridge carries exactly three things: this document's runtime settings
 * at startup, later changes to runtime preferences, and a request to remember
 * a speed.
 */

window.VSC = window.VSC || {};

if (!window.VSC.StorageManager) {
  const docEl = document.documentElement;

  /** True when chrome.storage.sync is available (extension contexts). */
  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;

  class StorageManager {
    static errorCallback = null;

    /** True in MAIN world, where the content bridge is the only way to storage. */
    static isBridged = !hasChrome;

    /**
     * Register error callback for monitoring storage failures
     * @param {Function} callback - Callback function for errors
     */
    static onError(callback) {
      this.errorCallback = callback;
    }

    /**
     * Ask the bridge for this document's runtime settings. MAIN world only.
     *
     * The answer arrives over a page-visible event, so it is returned as
     * received; the caller normalizes it. That check guards against a
     * malformed answer, not a forged one — a page can forge either.
     *
     * @returns {Promise<Object|null>} The settings, or null when VSC is off
     *   for this document or the bridge gave no usable answer
     */
    static requestRuntimeSettings() {
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

          // Bridge signals abort for disabled sites.
          if (detail.abort) {
            window.VSC.logger?.debug?.('StorageManager: site disabled by bridge');
            resolve(null);
            return;
          }

          // Reject malformed payloads instead of letting `{}` or an unrelated
          // page event silently activate MAIN with defaults.
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
          resolve(detail.settings);
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
     * Read stored settings. Extension pages only.
     * @param {Object} defaults - Values for keys that are not stored
     * @returns {Promise<Object>} Storage data
     */
    static async get(defaults = {}) {
      return new Promise((resolve) => {
        chrome.storage.sync.get(defaults, (storage) => {
          window.VSC.logger?.debug?.('StorageManager: settings from chrome.storage');
          resolve(storage);
        });
      });
    }

    /**
     * Write settings. From MAIN world only `lastSpeed` can be written, and
     * only as a request the bridge may decline.
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
    }

    /**
     * Remove keys from storage. Extension pages only.
     * @param {Array<string>} keys - Keys to remove
     * @returns {Promise<void>}
     */
    static async remove(keys) {
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

    /**
     * Clear all storage. Extension pages only.
     * @returns {Promise<void>}
     */
    static async clear() {
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

    /**
     * Listen for settings changes. MAIN world hears only what the bridge
     * relays: runtime preferences that actually changed.
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
        docEl.addEventListener('VSC_STORAGE_CHANGED', (e) => callback(e.detail));
      }
    }
  }

  window.VSC.StorageManager = StorageManager;
}
