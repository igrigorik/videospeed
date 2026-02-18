/**
 * Event management system for Video Speed Controller
 */

window.VSC = window.VSC || {};

class EventManager {
  constructor(config, actionHandler) {
    this.config = config;
    this.actionHandler = actionHandler;
    this.listeners = new Map();
    this.coolDown = false;
    this.timer = null;

    // Event deduplication to prevent duplicate key processing
    this.lastKeyEventSignature = null;
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

    window.VSC.logger.verbose(`Processing keydown event: key=${event.key}, keyCode=${keyCode}`);

    // Event deduplication - prevent same key event from being processed multiple times
    const eventSignature = `${keyCode}_${event.timeStamp}_${event.type}`;

    if (this.lastKeyEventSignature === eventSignature) {
      return;
    }

    this.lastKeyEventSignature = eventSignature;

    // Ignore keydown event if typing in an input box
    if (this.isTypingContext(event.target)) {
      return false;
    }

    // Ignore keydown event if no media elements are present
    const mediaElements = window.VSC.stateManager ?
      window.VSC.stateManager.getControlledElements() : [];
    if (!mediaElements.length) {
      return false;
    }

    // Find matching key binding
    const keyBinding = this.findMatchingKeyBinding(event, keyCode);

    if (keyBinding) {
      this.actionHandler.runAction(keyBinding.action, keyBinding.value, event);

      if (keyBinding.force === true || keyBinding.force === 'true') {
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
   * Find first matching key binding for event
   * @param {KeyboardEvent} event - Keyboard event
   * @param {number} keyCode - Event keyCode
   * @returns {Object|undefined} Matching key binding
   * @private
   */
  findMatchingKeyBinding(event, keyCode) {
    return this.config.settings.keyBindings.find((item) => this.matchesKeyBinding(item, event, keyCode));
  }

  /**
   * Check if key binding matches keyboard event
   * Backward compatibility:
   * - Legacy bindings without modifiers ignore Shift and only block Alt/Ctrl/Meta
   * - New bindings with modifiers require exact modifier match
   * @param {Object} binding - Key binding
   * @param {KeyboardEvent} event - Keyboard event
   * @param {number} keyCode - Event keyCode
   * @returns {boolean} True if binding matches event
   * @private
   */
  matchesKeyBinding(binding, event, keyCode) {
    if (!binding || binding.key !== keyCode) {
      return false;
    }

    const modifiers = this.getEventModifiers(event);

    if (!binding.modifiers) {
      return !modifiers.alt && !modifiers.ctrl && !modifiers.meta;
    }

    return (
      modifiers.shift === Boolean(binding.modifiers.shift) &&
      modifiers.ctrl === Boolean(binding.modifiers.ctrl) &&
      modifiers.alt === Boolean(binding.modifiers.alt) &&
      modifiers.meta === Boolean(binding.modifiers.meta)
    );
  }

  /**
   * Get normalized modifier state for event
   * @param {KeyboardEvent} event - Keyboard event
   * @returns {{shift: boolean, ctrl: boolean, alt: boolean, meta: boolean}} Event modifiers
   * @private
   */
  getEventModifiers(event) {
    if (!event) {
      return {
        shift: false,
        ctrl: false,
        alt: false,
        meta: false,
      };
    }

    if (event.getModifierState) {
      return {
        shift: event.getModifierState('Shift'),
        ctrl: event.getModifierState('Control'),
        alt: event.getModifierState('Alt'),
        meta: event.getModifierState('Meta') || event.getModifierState('OS'),
      };
    }

    return {
      shift: Boolean(event.shiftKey),
      ctrl: Boolean(event.ctrlKey),
      alt: Boolean(event.altKey),
      meta: Boolean(event.metaKey),
    };
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
      window.VSC.logger.debug('Rate change event blocked by cooldown');

      // Get the video element to restore authoritative speed
      const video = event.composedPath ? event.composedPath()[0] : event.target;

      // RESTORE our authoritative value since external change already happened
      if (video.vsc && this.config.settings.lastSpeed !== undefined) {
        const authoritativeSpeed = this.config.settings.lastSpeed;
        if (Math.abs(video.playbackRate - authoritativeSpeed) > 0.01) {
          window.VSC.logger.info(`Restoring speed during cooldown from external ${video.playbackRate} to authoritative ${authoritativeSpeed}`);
          video.playbackRate = authoritativeSpeed;
        }
      }

      event.stopImmediatePropagation();
      return;
    }

    // Get the actual video element (handle shadow DOM)
    const video = event.composedPath ? event.composedPath()[0] : event.target;

    // Skip if no VSC controller attached
    if (!video.vsc) {
      window.VSC.logger.debug('Skipping ratechange - no VSC controller attached');
      return;
    }

    // Check if this is our own event
    if (event.detail && event.detail.origin === 'videoSpeed') {
      // This is our change, don't process it again
      window.VSC.logger.debug('Ignoring extension-originated rate change');
      return;
    }

    // Force last saved speed mode - restore authoritative speed for ANY external change
    if (this.config.settings.forceLastSavedSpeed) {
      if (event.detail && event.detail.origin === 'videoSpeed') {
        video.playbackRate = Number(event.detail.speed);
      } else {
        const authoritativeSpeed = this.config.settings.lastSpeed || 1.0;
        window.VSC.logger.info(`Force mode: restoring external ${video.playbackRate} to authoritative ${authoritativeSpeed}`);
        video.playbackRate = authoritativeSpeed;
      }
      event.stopImmediatePropagation();
      return;
    }

    // Ignore external ratechanges during video initialization
    if (video.readyState < 1) {
      window.VSC.logger.debug('Ignoring external ratechange during video initialization (readyState < 1)');
      event.stopImmediatePropagation();
      return;
    }

    // External change - use adjustSpeed with external source
    const rawExternalRate = typeof video.playbackRate === 'number' ? video.playbackRate : NaN;

    // Ignore spurious external ratechanges below our supported MIN to avoid persisting clamped 0.07
    const min = window.VSC.Constants.SPEED_LIMITS.MIN;
    // Use <= to also catch values that Chrome already clamped to MIN (e.g., site set 0)
    if (!isNaN(rawExternalRate) && rawExternalRate <= min) {
      window.VSC.logger.debug(
        `Ignoring external ratechange below MIN: raw=${rawExternalRate}, MIN=${min}`
      );
      event.stopImmediatePropagation();
      return;
    }

    if (this.actionHandler) {
      this.actionHandler.adjustSpeed(video, video.playbackRate, {
        source: 'external',
      });
    }

    // Always stop propagation to prevent loops
    event.stopImmediatePropagation();
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
    }, EventManager.COOLDOWN_MS);

    window.VSC.logger.debug('End refreshCoolDown');
  }

  /**
   * Show controller temporarily during speed changes or other automatic actions
   * @param {Element} controller - Controller element
   */
  showController(controller) {
    // When startHidden is enabled, only show temporary feedback if the user has
    // previously interacted with this controller manually (vsc-manual class)
    // This prevents unwanted controller appearances on pages where user wants them hidden
    if (this.config.settings.startHidden && !controller.classList.contains('vsc-manual')) {
      window.VSC.logger.info(
        `Controller respecting startHidden setting - no temporary display (startHidden: ${this.config.settings.startHidden}, manual: ${controller.classList.contains('vsc-manual')})`
      );
      return;
    }

    window.VSC.logger.info(
      `Showing controller temporarily (startHidden: ${this.config.settings.startHidden}, manual: ${controller.classList.contains('vsc-manual')})`
    );
    controller.classList.add('vsc-show');

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      controller.classList.remove('vsc-show');
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

// Cooldown duration (ms) for ratechange handling
EventManager.COOLDOWN_MS = 200;

// Create singleton instance
window.VSC.EventManager = EventManager;
