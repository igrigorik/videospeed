/**
 * Settings management for Video Speed Controller
 */

window.VSC = window.VSC || {};

if (!window.VSC.VideoSpeedConfig) {
  class VideoSpeedConfig {
    constructor() {
      this.settings = { ...window.VSC.Constants.DEFAULT_SETTINGS };
      this.pendingSave = null;
      this.saveTimer = null;
      this.SAVE_DELAY = 1000; // 1 second

      // Keep in-memory settings fresh when other contexts write to storage.
      // This prevents the stale-read problem where e.g. the options page holds
      // an old lastSpeed while the content script has already updated it.
      this._setupStorageListener();
    }

    /**
     * Listen for storage changes from other contexts and update in-memory state.
     * @private
     */
    _setupStorageListener() {
      try {
        window.VSC.StorageManager.onChanged((changes) => {
          for (const [key, change] of Object.entries(changes)) {
            if (key in this.settings && change.newValue !== undefined) {
              this.settings[key] = change.newValue;
              window.VSC.logger.debug(`Settings refreshed from external change: ${key}`);
            }
          }
        });
      } catch (e) {
        // StorageManager may not be fully available yet (e.g. during tests)
        // This is non-fatal — the listener just won't be active
        window.VSC.logger.debug(`Could not set up storage change listener: ${e.message}`);
      }
    }

    /**
     * Load settings from Chrome storage or pre-injected settings
     * @returns {Promise<Object>} Loaded settings
     */
    async load() {
      try {
        // Use StorageManager which handles both contexts automatically
        const storage = await window.VSC.StorageManager.get(window.VSC.Constants.DEFAULT_SETTINGS);

        // Handle key bindings migration/initialization
        this.settings.keyBindings =
          storage.keyBindings || window.VSC.Constants.DEFAULT_SETTINGS.keyBindings;

        if (!storage.keyBindings || storage.keyBindings.length === 0) {
          window.VSC.logger.info('First initialization - setting up default key bindings');
          this.settings.keyBindings = [...window.VSC.Constants.DEFAULT_SETTINGS.keyBindings];
          await this.save({ keyBindings: this.settings.keyBindings });
        }

        // Apply loaded settings
        this.settings.lastSpeed = Number(storage.lastSpeed);
        this.settings.rememberSpeed = Boolean(storage.rememberSpeed);
        this.settings.forceLastSavedSpeed = Boolean(storage.forceLastSavedSpeed);
        this.settings.audioBoolean = Boolean(storage.audioBoolean);
        this.settings.startHidden = Boolean(storage.startHidden);
        this.settings.controllerOpacity = Number(storage.controllerOpacity);
        this.settings.controllerButtonSize = Number(storage.controllerButtonSize);
        this.settings.logLevel = Number(
          storage.logLevel || window.VSC.Constants.DEFAULT_SETTINGS.logLevel
        );

        // Ensure display binding exists (for upgrades)
        this.ensureDisplayBinding();

        // Update logger verbosity
        window.VSC.logger.setVerbosity(this.settings.logLevel);

        window.VSC.logger.info('Settings loaded successfully');
        return this.settings;
      } catch (error) {
        window.VSC.logger.error(`Failed to load settings: ${error.message}`);
        return window.VSC.Constants.DEFAULT_SETTINGS;
      }
    }

    /**
     * Save settings to Chrome storage
     *
     * IMPORTANT: Only the keys present in newSettings are written to storage.
     * This avoids the "stale full-blob write" race condition where two contexts
     * (e.g. options page + content script) each hold their own in-memory copy
     * and overwrite each other's changes.  chrome.storage.sync.set({key: val})
     * atomically merges — it updates only the supplied keys and leaves the
     * rest untouched.
     *
     * @param {Object} newSettings - Settings to save (only these keys are written)
     * @returns {Promise<void>}
     */
    async save(newSettings = {}) {
      try {
        // Update in-memory settings immediately
        this.settings = { ...this.settings, ...newSettings };

        // Check if this is a speed-only update that should be debounced
        const keys = Object.keys(newSettings);
        if (keys.length === 1 && keys[0] === 'lastSpeed') {
          // Debounce speed saves
          this.pendingSave = newSettings.lastSpeed;

          if (this.saveTimer) {
            clearTimeout(this.saveTimer);
          }

          this.saveTimer = setTimeout(async () => {
            const speedToSave = this.pendingSave;
            this.pendingSave = null;
            this.saveTimer = null;

            // Write ONLY lastSpeed — not the full settings blob
            await window.VSC.StorageManager.set({ lastSpeed: speedToSave });
            window.VSC.logger.info('Debounced speed setting saved successfully');
          }, this.SAVE_DELAY);

          return;
        }

        // Write ONLY the changed keys, not the full settings blob
        await window.VSC.StorageManager.set(newSettings);

        // Update logger verbosity if logLevel was changed
        if (newSettings.logLevel !== undefined) {
          window.VSC.logger.setVerbosity(this.settings.logLevel);
        }

        window.VSC.logger.info('Settings saved successfully');
      } catch (error) {
        window.VSC.logger.error(`Failed to save settings: ${error.message}`);
      }
    }

    /**
     * Get a specific key binding
     * @param {string} action - Action name
     * @param {string} property - Property to get (default: 'value')
     * @returns {*} Key binding property value
     */
    getKeyBinding(action, property = 'value') {
      try {
        const binding = this.settings.keyBindings.find((item) => item.action === action);
        return binding ? binding[property] : false;
      } catch (e) {
        window.VSC.logger.error(`Failed to get key binding for ${action}: ${e.message}`);
        return false;
      }
    }

    /**
     * Set a key binding value with validation
     * @param {string} action - Action name
     * @param {*} value - Value to set
     */
    setKeyBinding(action, value) {
      try {
        const binding = this.settings.keyBindings.find((item) => item.action === action);
        if (!binding) {
          window.VSC.logger.warn(`No key binding found for action: ${action}`);
          return;
        }

        // Validate speed-related values to prevent corruption
        if (['reset', 'fast', 'slower', 'faster'].includes(action)) {
          if (typeof value !== 'number' || isNaN(value)) {
            window.VSC.logger.warn(`Invalid numeric value for ${action}: ${value}`);
            return;
          }
        }

        binding.value = value;
        window.VSC.logger.debug(`Updated key binding ${action} to ${value}`);
      } catch (e) {
        window.VSC.logger.error(`Failed to set key binding for ${action}: ${e.message}`);
      }
    }

    /**
     * Ensure display binding exists in key bindings
     * @private
     */
    ensureDisplayBinding() {
      if (this.settings.keyBindings.filter((x) => x.action === 'display').length === 0) {
        this.settings.keyBindings.push({
          action: 'display',
          key: 86, // V
          value: 0,
          force: false,
          predefined: true,
        });
      }
    }
  }

  // Create singleton instance
  window.VSC.videoSpeedConfig = new VideoSpeedConfig();

  // Export constructor for testing
  window.VSC.VideoSpeedConfig = VideoSpeedConfig;
}
