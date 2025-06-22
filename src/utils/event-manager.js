/**
 * Event management system for Video Speed Controller
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

class EventManager {
  constructor(config, actionHandler) {
    this.config = config;
    this.actionHandler = actionHandler;
    this.listeners = new Map();
    this.coolDown = false;
    this.timer = null;
  }

  /**
   * Set up all event listeners
   * @param {Document} document - Document to attach events to
   */
  setupEventListeners(document) {
    this.setupKeyboardShortcuts(document);
    this.setupRateChangeListener(document);
  }

  /**
   * Set up keyboard shortcuts
   * @param {Document} document - Document to attach events to
   */
  setupKeyboardShortcuts(document) {
    const docs = [document];

    try {
      if (window.VSC.inIframe()) {
        docs.push(window.top.document);
      }
    } catch (e) {
      // Cross-origin iframe - ignore
    }

    docs.forEach((doc) => {
      const keydownHandler = (event) => this.handleKeydown(event);
      doc.addEventListener('keydown', keydownHandler, true);

      // Store reference for cleanup
      if (!this.listeners.has(doc)) {
        this.listeners.set(doc, []);
      }
      this.listeners.get(doc).push({
        type: 'keydown',
        handler: keydownHandler,
        useCapture: true,
      });
    });
  }

  /**
   * Handle keydown events
   * @param {KeyboardEvent} event - Keyboard event
   * @private
   */
  handleKeydown(event) {
    const keyCode = event.keyCode;

    window.VSC.logger.verbose(`Processing keydown event: ${keyCode}`);

    // Ignore if following modifier is active
    if (this.hasActiveModifier(event)) {
      window.VSC.logger.debug(`Keydown event ignored due to active modifier: ${keyCode}`);
      return;
    }

    // Ignore keydown event if typing in an input box
    if (this.isTypingContext(event.target)) {
      return false;
    }

    // Ignore keydown event if no media elements are present
    if (!this.config.getMediaElements().length) {
      return false;
    }

    // Find matching key binding
    const keyBinding = this.config.settings.keyBindings.find((item) => item.key === keyCode);

    if (keyBinding) {
      this.actionHandler.runAction(keyBinding.action, keyBinding.value);

      if (keyBinding.force === 'true') {
        // Disable website's key bindings
        event.preventDefault();
        event.stopPropagation();
      }
    } else {
      window.VSC.logger.verbose(`No key binding found for keyCode: ${keyCode}`);
    }

    return false;
  }

  /**
   * Check if any modifier keys are active
   * @param {KeyboardEvent} event - Keyboard event
   * @returns {boolean} True if modifiers are active
   * @private
   */
  hasActiveModifier(event) {
    return (
      !event.getModifierState ||
      event.getModifierState('Alt') ||
      event.getModifierState('Control') ||
      event.getModifierState('Fn') ||
      event.getModifierState('Meta') ||
      event.getModifierState('Hyper') ||
      event.getModifierState('OS')
    );
  }

  /**
   * Check if user is typing in an input context
   * @param {Element} target - Event target
   * @returns {boolean} True if typing context
   * @private
   */
  isTypingContext(target) {
    return (
      target.nodeName === 'INPUT' || target.nodeName === 'TEXTAREA' || target.isContentEditable
    );
  }

  /**
   * Set up rate change event listener
   * @param {Document} document - Document to attach events to
   */
  setupRateChangeListener(document) {
    const rateChangeHandler = (event) => this.handleRateChange(event);
    document.addEventListener('ratechange', rateChangeHandler, true);

    // Store reference for cleanup
    if (!this.listeners.has(document)) {
      this.listeners.set(document, []);
    }
    this.listeners.get(document).push({
      type: 'ratechange',
      handler: rateChangeHandler,
      useCapture: true,
    });
  }

  /**
   * Handle rate change events
   * @param {Event} event - Rate change event
   * @private
   */
  handleRateChange(event) {
    if (this.coolDown) {
      window.VSC.logger.info('Speed event propagation blocked');
      event.stopImmediatePropagation();
    }

    // Get the actual video element (handle shadow DOM)
    const video = event.composedPath()[0];

    // Handle forced last saved speed
    if (this.config.settings.forceLastSavedSpeed) {
      if (event.detail && event.detail.origin === 'videoSpeed') {
        video.playbackRate = event.detail.speed;
        this.updateSpeedFromEvent(video);
      } else {
        video.playbackRate = this.config.settings.lastSpeed;
      }
      event.stopImmediatePropagation();
    } else {
      this.updateSpeedFromEvent(video);
    }
  }

  /**
   * Update speed indicators and storage when rate changes
   * @param {HTMLMediaElement} video - Video element
   * @private
   */
  updateSpeedFromEvent(video) {
    // Check if video has a controller attached
    if (!video.vsc) {
      return;
    }

    const speedIndicator = video.vsc.speedIndicator;
    const src = video.currentSrc;
    const speed = Number(video.playbackRate.toFixed(2));

    window.VSC.logger.info(`Playback rate changed to ${speed}`);

    // Update controller display
    window.VSC.logger.debug('Updating controller with new speed');
    speedIndicator.textContent = speed.toFixed(2);

    // Store speed for this source
    this.config.settings.speeds[src] = speed;

    // Store as last speed for remember feature
    window.VSC.logger.debug('Storing lastSpeed in settings for the rememberSpeed feature');
    this.config.settings.lastSpeed = speed;

    // Save to Chrome storage if available
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      window.VSC.logger.debug('Syncing chrome settings for lastSpeed');
      chrome.storage.sync.set({ lastSpeed: speed }, () => {
        window.VSC.logger.debug(`Speed setting saved: ${speed}`);
      });
    } else {
      window.VSC.logger.debug('Chrome storage not available, skipping speed sync');
    }

    // Show controller briefly if hidden
    this.actionHandler.runAction('blink', null, null);
  }

  /**
   * Start cooldown period to prevent event spam
   */
  refreshCoolDown() {
    window.VSC.logger.debug('Begin refreshCoolDown');

    if (this.coolDown) {
      clearTimeout(this.coolDown);
    }

    this.coolDown = setTimeout(() => {
      this.coolDown = false;
    }, 1000);

    window.VSC.logger.debug('End refreshCoolDown');
  }

  /**
   * Show controller temporarily
   * @param {Element} controller - Controller element
   */
  showController(controller) {
    window.VSC.logger.info('Showing controller');
    controller.classList.add('vcs-show');

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      controller.classList.remove('vcs-show');
      this.timer = null;
      window.VSC.logger.debug('Hiding controller');
    }, 2000);
  }

  /**
   * Clean up all event listeners
   */
  cleanup() {
    this.listeners.forEach((eventList, doc) => {
      eventList.forEach(({ type, handler, useCapture }) => {
        try {
          doc.removeEventListener(type, handler, useCapture);
        } catch (e) {
          window.VSC.logger.warn(`Failed to remove event listener: ${e.message}`);
        }
      });
    });

    this.listeners.clear();

    if (this.coolDown) {
      clearTimeout(this.coolDown);
      this.coolDown = false;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

// Create singleton instance
window.VSC.EventManager = EventManager;
