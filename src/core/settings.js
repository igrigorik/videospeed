/**
 * Settings management for Video Speed Controller
 */

window.VSC = window.VSC || {};

if (!window.VSC.VideoSpeedConfig) {
  class VideoSpeedConfig {
    constructor() {
      this.settings = { ...window.VSC.Constants.DEFAULT_SETTINGS };
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
        this.settings.displayKeyCode = Number(storage.displayKeyCode);
        this.settings.rememberSpeed = Boolean(storage.rememberSpeed);
        this.settings.forceLastSavedSpeed = Boolean(storage.forceLastSavedSpeed);
        this.settings.audioBoolean = Boolean(storage.audioBoolean);
        this.settings.enabled = Boolean(storage.enabled);
        this.settings.startHidden = Boolean(storage.startHidden);
        this.settings.controllerOpacity = Number(storage.controllerOpacity);
        this.settings.controllerButtonSize = Number(storage.controllerButtonSize);
        this.settings.blacklist = String(storage.blacklist);
        this.settings.logLevel = Number(
          storage.logLevel || window.VSC.Constants.DEFAULT_SETTINGS.logLevel
        );

        // Ensure display binding exists (for upgrades)
        this.ensureDisplayBinding(storage);

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
     * @param {Object} newSettings - Settings to save
     * @returns {Promise<void>}
     */
    async save(newSettings = {}) {
      try {
        this.settings = { ...this.settings, ...newSettings };
        await window.VSC.StorageManager.set(this.settings);

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
     * @param {Object} storage - Storage object  
     * @private
     */
    ensureDisplayBinding(storage) {
      if (this.settings.keyBindings.filter((x) => x.action === 'display').length === 0) {
        this.settings.keyBindings.push({
          action: 'display',
          key: Number(storage.displayKeyCode) || 86,
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
