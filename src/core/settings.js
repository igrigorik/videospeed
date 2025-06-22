/**
 * Settings management for Video Speed Controller
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

class VideoSpeedConfig {
  constructor() {
    this.settings = { ...window.VSC.Constants.DEFAULT_SETTINGS };
    this.mediaElements = [];
  }

  /**
   * Load settings from Chrome storage
   * @returns {Promise<Object>} Loaded settings
   */
  async load() {
    try {
      // In injected context, wait for user settings to be available
      const isInjectedContext = typeof chrome === 'undefined' || !chrome.storage;
      const storage = isInjectedContext
        ? await window.VSC.StorageManager.waitForInjectedSettings(
            window.VSC.Constants.DEFAULT_SETTINGS
          )
        : await window.VSC.StorageManager.get(window.VSC.Constants.DEFAULT_SETTINGS);

      // Handle key bindings migration/initialization
      this.settings.keyBindings = storage.keyBindings || [];

      if (!storage.keyBindings || storage.keyBindings.length === 0) {
        window.VSC.logger.info('First initialization - setting up default key bindings');
        await this.initializeDefaultKeyBindings(storage);
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
   * Set a key binding value
   * @param {string} action - Action name
   * @param {*} value - Value to set
   */
  setKeyBinding(action, value) {
    try {
      const binding = this.settings.keyBindings.find((item) => item.action === action);
      if (binding) {
        binding.value = value;
      }
    } catch (e) {
      window.VSC.logger.error(`Failed to set key binding for ${action}: ${e.message}`);
    }
  }

  /**
   * Initialize default key bindings for first-time setup
   * @param {Object} storage - Storage object with legacy values
   * @private
   */
  async initializeDefaultKeyBindings(storage) {
    const keyBindings = [];

    // Migrate from legacy settings if they exist
    keyBindings.push({
      action: 'slower',
      key: Number(storage.slowerKeyCode) || 83,
      value: Number(storage.speedStep) || 0.1,
      force: false,
      predefined: true,
    });

    keyBindings.push({
      action: 'faster',
      key: Number(storage.fasterKeyCode) || 68,
      value: Number(storage.speedStep) || 0.1,
      force: false,
      predefined: true,
    });

    keyBindings.push({
      action: 'rewind',
      key: Number(storage.rewindKeyCode) || 90,
      value: Number(storage.rewindTime) || 10,
      force: false,
      predefined: true,
    });

    keyBindings.push({
      action: 'advance',
      key: Number(storage.advanceKeyCode) || 88,
      value: Number(storage.advanceTime) || 10,
      force: false,
      predefined: true,
    });

    keyBindings.push({
      action: 'reset',
      key: Number(storage.resetKeyCode) || 82,
      value: 1.0,
      force: false,
      predefined: true,
    });

    keyBindings.push({
      action: 'fast',
      key: Number(storage.fastKeyCode) || 71,
      value: Number(storage.fastSpeed) || 1.8,
      force: false,
      predefined: true,
    });

    keyBindings.push({
      action: 'mark',
      key: 77, // M key
      value: 0,
      force: false,
      predefined: true,
    });

    keyBindings.push({
      action: 'jump',
      key: 74, // J key
      value: 0,
      force: false,
      predefined: true,
    });

    this.settings.keyBindings = keyBindings;
    this.settings.version = '0.5.3';

    // Save the migrated settings
    await window.VSC.StorageManager.set({
      keyBindings: this.settings.keyBindings,
      version: this.settings.version,
      displayKeyCode: this.settings.displayKeyCode,
      rememberSpeed: this.settings.rememberSpeed,
      forceLastSavedSpeed: this.settings.forceLastSavedSpeed,
      audioBoolean: this.settings.audioBoolean,
      startHidden: this.settings.startHidden,
      enabled: this.settings.enabled,
      controllerOpacity: this.settings.controllerOpacity,
      controllerButtonSize: this.settings.controllerButtonSize,
      blacklist: this.settings.blacklist,
    });
  }

  /**
   * Ensure display binding exists (for version upgrades)
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

  /**
   * Add a media element to tracking
   * @param {HTMLMediaElement} element - Media element to track
   */
  addMediaElement(element) {
    if (!this.mediaElements.includes(element)) {
      this.mediaElements.push(element);
    }
  }

  /**
   * Remove a media element from tracking
   * @param {HTMLMediaElement} element - Media element to remove
   */
  removeMediaElement(element) {
    const index = this.mediaElements.indexOf(element);
    if (index !== -1) {
      this.mediaElements.splice(index, 1);
    }
  }

  /**
   * Get all tracked media elements
   * @returns {Array<HTMLMediaElement>} Array of media elements
   */
  getMediaElements() {
    return this.mediaElements;
  }
}

// Create singleton instance
window.VSC.videoSpeedConfig = new VideoSpeedConfig();

// Also export the constructor for testing
window.VSC.VideoSpeedConfig = VideoSpeedConfig;

// Global variables available for both browser and testing
