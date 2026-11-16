/**
 * Settings management for Video Speed Controller
 *
 * One class, two contexts. Extension pages load and save the stored settings.
 * The page script (MAIN world) holds only the runtime settings the content
 * bridge resolved for its document: see docs/settings-trust-boundary.md.
 */

import {
  normalizeModifiers,
  normalizeRememberedSpeed,
  normalizeRuntimeSettings,
  projectPreferences,
} from '../utils/runtime-settings.js';
import { selectSiteRules } from '../utils/site-pattern.js';

window.VSC = window.VSC || {};

if (!window.VSC.VideoSpeedConfig) {
  /**
   * Settings for the page script, from what the bridge sent. The resolved
   * initial speed becomes `lastSpeed`, the session's speed authority: null
   * means VSC has no opinion, and a value is one the user can then override
   * (docs/speed-arbitration.md).
   */
  function fromRuntimeSettings(received) {
    const { initialSpeed, ...preferences } = normalizeRuntimeSettings(received);
    return { ...preferences, lastSpeed: initialSpeed };
  }

  class VideoSpeedConfig {
    constructor() {
      this.settings = window.VSC.StorageManager.isBridged
        ? fromRuntimeSettings({})
        : { ...window.VSC.Constants.DEFAULT_SETTINGS };
      this.pendingSave = null;
      this.saveTimer = null;
      this.SAVE_DELAY = 1000; // 1 second
      this._loaded = false;

      // Keep in-memory settings fresh when other contexts write to storage
      // (options-page changes — key bindings, visibility, opacity — reach
      // running content scripts live). lastSpeed is deliberately excluded:
      // see the session-isolation note in the listener.
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
            if (!(key in this.settings) || change.newValue === undefined) {
              continue;
            }

            // Session isolation (#1559, docs/speed-arbitration.md "Design
            // note: multi-tab authority"): lastSpeed is SESSION authority
            // and is never adopted from another context mid-session — each
            // tab's arbiter runs on its own authority, and storage is a
            // last-writer-wins register consulted only at load(). Adopting
            // it here would mutate `desired` through a channel outside the
            // verified event alphabet, and it is how tabs bled speeds into
            // each other. Skipping it also absorbs our own debounced write
            // echoing back (chrome fires onChanged in the writing context
            // too), which a self-echo token previously had to detect.
            if (key === 'lastSpeed') {
              continue;
            }

            this.settings[key] = change.newValue;
            window.VSC.logger.debug(`Settings updated from storage change: ${key}`);
          }
        });
      } catch (e) {
        // StorageManager may not be fully available yet (e.g. during tests).
        // Non-fatal — the listener just won't be active.
        window.VSC.logger.debug(`Could not set up storage change listener: ${e.message}`);
      }
    }

    /**
     * Load settings: the bridge's runtime settings in MAIN world, the stored
     * settings on extension pages.
     * @returns {Promise<Object>} Loaded settings
     */
    async load() {
      try {
        if (window.VSC.StorageManager.isBridged) {
          // Site rules and defaults were applied on the bridge's side.
          const received = await window.VSC.StorageManager.requestRuntimeSettings();
          if (!received) {
            // VSC is off for this document, or the bridge gave no answer.
            this.settings._abort = true;
            return;
          }
          this.settings = fromRuntimeSettings(received);
          this._loaded = true;
        } else {
          await this._loadStoredSettings();
        }

        window.VSC.logger.setVerbosity(this.settings.logLevel);
        window.VSC.logger.info('Settings loaded successfully');
        return this.settings;
      } catch (error) {
        window.VSC.logger.error(`Failed to load settings: ${error.message}`);
        return window.VSC.Constants.DEFAULT_SETTINGS;
      }
    }

    /**
     * Extension pages: read the stored settings, with the default standing in
     * for any key that was never saved.
     * @private
     */
    async _loadStoredSettings() {
      const storage = await window.VSC.StorageManager.get({
        ...window.VSC.Constants.DEFAULT_SETTINGS,
        // Rules are saved under two keys. Read both without a default, so that
        // a default cannot stand in for the one the user actually saved.
        siteRules: null,
        blacklist: null,
        // Legacy key, read only so it can be removed below.
        controllerCSS: null,
      });

      this._loaded = true;

      // Preferences, read exactly as the page script will see them. Key
      // bindings are the exception: this page needs their stored form, with
      // the metadata the projection strips.
      const { keyBindings: _runtimeBindings, ...preferences } = projectPreferences(storage);
      Object.assign(this.settings, preferences);

      // Handle key bindings migration/initialization
      this.settings.keyBindings = (
        storage.keyBindings || window.VSC.Constants.DEFAULT_SETTINGS.keyBindings
      ).map(VideoSpeedConfig.normalizeKeyBinding);

      if (!storage.keyBindings || storage.keyBindings.length === 0) {
        window.VSC.logger.info('First initialization - setting up default key bindings');
        this.settings.keyBindings = [...window.VSC.Constants.DEFAULT_SETTINGS.keyBindings];
        await this.save({ keyBindings: this.settings.keyBindings });
      }

      // The rules in force, chosen exactly as the content bridge chooses them.
      // A legacy blacklist shows up here as rules and is saved as `siteRules`
      // the next time the user saves; the blacklist key stays in storage for
      // older versions synced from other devices.
      this.settings.siteRules = selectSiteRules(storage);

      // An extension page has no document for a site rule to match, so its
      // speed authority is the remembered speed or nothing.
      this.settings.lastSpeed = preferences.rememberSpeed
        ? normalizeRememberedSpeed(storage.lastSpeed)
        : null;

      // One-time migration: drop legacy controllerCSS key, reset to new model.
      if (storage.controllerCSS !== null) {
        window.VSC.StorageManager.remove(['controllerCSS']);
      }
    }

    /**
     * Commit a speed as the SESSION authority (in-memory lastSpeed) and
     * persist it when the user asked us to remember speed. Executes the
     * arbiter's PERSIST effect (cells 2/5/7/12). Persistence purity (I2)
     * holds by construction: only user-attributed choices reach this —
     * lifecycle, fight and observe paths never call it.
     * @param {number} speed
     */
    persistAuthority(speed) {
      this.settings.lastSpeed = speed;
      if (this.settings.rememberSpeed) {
        this.save({ lastSpeed: speed });
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
     * In-memory settings are updated immediately regardless of persistence
     * outcome — the current session should always reflect the user's intent.
     * Returns false only when the storage write observably fails (options page
     * context with direct chrome.storage access). In the page script a write
     * is a request to the content bridge, so its outcome is invisible here.
     *
     * @param {Object} newSettings - Settings to save (only these keys are written)
     * @returns {Promise<boolean>} true if persisted (or debounced), false on storage failure
     */
    async save(newSettings = {}) {
      const keys = Object.keys(newSettings);
      if (keys.length === 0) {
        return true;
      }

      // Guard: refuse to write before load() has read from storage.
      // Without this, a save() during initialization writes DEFAULT_SETTINGS
      // to storage, silently clobbering the user's real persisted values.
      if (!this._loaded) {
        window.VSC.logger.error(
          'save() called before load() — refusing to overwrite user data with defaults'
        );
        return false;
      }

      // Update in-memory settings immediately
      this.settings = { ...this.settings, ...newSettings };

      // Check if this is a speed-only update that should be debounced
      if (keys.length === 1 && keys[0] === 'lastSpeed') {
        this.pendingSave = newSettings.lastSpeed;

        if (this.saveTimer) {
          clearTimeout(this.saveTimer);
        }

        this.saveTimer = setTimeout(async () => {
          const speedToSave = this.pendingSave;
          this.pendingSave = null;
          this.saveTimer = null;

          try {
            await window.VSC.StorageManager.set({ lastSpeed: speedToSave });
            window.VSC.logger.info('Debounced speed setting saved successfully');
          } catch (error) {
            window.VSC.logger.error(`Failed to persist speed: ${error.message}`);
          }
        }, this.SAVE_DELAY);

        return true; // in-memory updated, persistence is deferred
      }

      try {
        await window.VSC.StorageManager.set(newSettings);
      } catch (error) {
        window.VSC.logger.error(`Failed to save settings: ${error.message}`);
        return false;
      }

      if (newSettings.logLevel !== undefined) {
        window.VSC.logger.setVerbosity(this.settings.logLevel);
      }

      window.VSC.logger.info('Settings saved successfully');
      return true;
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
     * Normalize a key binding's modifiers to strict booleans.
     * Strips the modifiers object entirely when all values are falsy.
     * Defensive against corrupt storage data (e.g., modifiers: { shift: 1 }).
     * @param {Object} binding
     * @returns {Object} Sanitized binding (shallow copy)
     * @private
     */
    static normalizeKeyBinding(binding) {
      if (!binding || !binding.modifiers) {
        return binding;
      }
      const { modifiers, ...rest } = binding;
      const normalized = normalizeModifiers(modifiers);
      return normalized ? { ...rest, modifiers: normalized } : rest;
    }
  }

  // Create singleton instance
  window.VSC.videoSpeedConfig = new VideoSpeedConfig();

  // Export constructor for testing
  window.VSC.VideoSpeedConfig = VideoSpeedConfig;
}
