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
    const mediaElements = window.VSC.stateManager ?
      window.VSC.stateManager.getControlledElements() : [];
    if (!mediaElements.length) {
      return false;
    }

    // Find matching key binding
    const keyBinding = this.config.settings.keyBindings.find((item) => item.key === keyCode);

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
      window.VSC.logger.debug('Rate change event blocked by cooldown');
      event.stopImmediatePropagation();
      return;
    }

    // Get the actual video element (handle shadow DOM)
    const video = event.composedPath ? event.composedPath()[0] : event.target;

    // Skip if no VSC controller attached
    if (!video.vsc) {
      return;
    }

    // Check if this is our own event
    if (event.detail && event.detail.origin === 'videoSpeed') {
      // This is our change, don't process it again
      window.VSC.logger.debug('Ignoring extension-originated rate change');
      return;
    }

    // External change - use adjustSpeed with external source
    window.VSC.logger.debug('External rate change detected');
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
    }, 1000);

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

// Create singleton instance
window.VSC.EventManager = EventManager;
