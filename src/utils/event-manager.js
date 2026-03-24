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

    // Event deduplication to prevent duplicate key processing
    this.lastKeyEventSignature = null;

    // Fight detection: track how many times a site resets our speed
    this.fightCount = 0;
    this.fightTimer = null;
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
    window.VSC.logger.verbose(`Processing keydown event: code=${event.code}, key=${event.key}, keyCode=${event.keyCode}`);

    // IME composition guard — prevent shortcuts during CJK input
    if (event.isComposing || event.keyCode === 229 || event.key === 'Process') {
      return;
    }

    // Event deduplication — include code+key to handle empty-code cases
    const eventSignature = `${event.code}_${event.key}_${event.timeStamp}_${event.type}`;
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

    // Find matching key binding using the three-tier algorithm
    const keyBinding = this.findMatchingBinding(event);

    if (keyBinding) {
      this.actionHandler.runAction(keyBinding.action, keyBinding.value, event);

      if (keyBinding.force) {
        event.preventDefault();
        event.stopPropagation();
      }
    } else {
      window.VSC.logger.verbose(`No key binding found for code=${event.code}, keyCode=${event.keyCode}`);
    }

    return false;
  }

  /**
   * Three-tier binding match: chord → simple → legacy fallback.
   *
   * When event.code is empty/Unidentified (virtual keyboards, remote desktop,
   * accessibility devices), falls back to keyCode matching for all bindings.
   *
   * @param {KeyboardEvent} event
   * @returns {Object|undefined} Matching binding, or undefined
   * @private
   */
  findMatchingBinding(event) {
    const bindings = this.config.settings.keyBindings;
    const code = event.code;
    const keyCode = event.keyCode;
    const ctrl = !!event.ctrlKey;
    const alt = !!event.altKey;
    const meta = !!event.metaKey;
    const shift = !!event.shiftKey;
    const hasModifier = ctrl || alt || meta;

    // Runtime fallback: if event.code is empty or unidentified, match on keyCode
    if (!code || code === 'Unidentified') {
      return bindings.find(b => {
        const bKey = b.keyCode ?? b.key;
        if (bKey !== keyCode) return false;
        return b.modifiers
          ? EventManager.modifiersMatch(b.modifiers, ctrl, alt, meta, shift)
          : !hasModifier;
      });
    }

    // Tier 1: Chord match — bindings WITH modifiers, all must match exactly
    const chordMatch = bindings.find(b =>
      b.modifiers && b.code === code &&
      EventManager.modifiersMatch(b.modifiers, ctrl, alt, meta, shift)
    );
    if (chordMatch) return chordMatch;

    // Tier 2: Simple match — bindings WITHOUT modifiers, no Ctrl/Alt/Meta active
    if (!hasModifier) {
      const simpleMatch = bindings.find(b => !b.modifiers && b.code === code);
      if (simpleMatch) return simpleMatch;
    }

    // Tier 3: Legacy fallback — bindings missing code field, match on keyCode
    if (!hasModifier) {
      const legacyMatch = bindings.find(b => {
        if (b.code !== null && b.code !== undefined) return false;
        return (b.keyCode ?? b.key) === keyCode;
      });
      if (legacyMatch) return legacyMatch;
    }

    return undefined;
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

    // Ignore external ratechanges during video initialization
    if (video.readyState < 1) {
      window.VSC.logger.debug('Ignoring external ratechange during video initialization (readyState < 1)');
      event.stopImmediatePropagation();
      return;
    }

    // Ignore spurious external ratechanges below our supported MIN
    const rawExternalRate = typeof video.playbackRate === 'number' ? video.playbackRate : NaN;
    const min = window.VSC.Constants.SPEED_LIMITS.MIN;
    if (!isNaN(rawExternalRate) && rawExternalRate <= min) {
      window.VSC.logger.debug(
        `Ignoring external ratechange below MIN: raw=${rawExternalRate}, MIN=${min}`
      );
      event.stopImmediatePropagation();
      return;
    }

    // Fight detection: if site changed speed away from what we set, fight back.
    // forceLastSavedSpeed = fight forever (Infinity retries); otherwise surrender after MAX_FIGHT_COUNT.
    const authoritativeSpeed = this.config.settings.lastSpeed;
    const maxRetries = this.config.settings.forceLastSavedSpeed
      ? Infinity
      : EventManager.MAX_FIGHT_COUNT;

    if (authoritativeSpeed && Math.abs(video.playbackRate - authoritativeSpeed) > 0.01) {
      this.fightCount++;

      // Reset fight count after a quiet period
      if (this.fightTimer) clearTimeout(this.fightTimer);
      this.fightTimer = setTimeout(() => {
        this.fightCount = 0;
        this.fightTimer = null;
      }, EventManager.FIGHT_WINDOW_MS);

      if (this.fightCount > maxRetries) {
        // Surrender — accept the site's speed
        window.VSC.logger.info(
          `Fight detection: surrendering after ${this.fightCount} resets. Accepting site speed ${video.playbackRate}`
        );
        this.fightCount = 0;
        // Fall through to accept the external change below
      } else {
        // Fight back — restore our speed
        window.VSC.logger.info(
          `Fight detection: attempt ${this.fightCount}/${maxRetries}, re-applying ${authoritativeSpeed}`
        );
        video.playbackRate = authoritativeSpeed;
        this.refreshCoolDown();
        event.stopImmediatePropagation();
        return;
      }
    }

    if (this.actionHandler) {
      this.actionHandler.adjustSpeed(video, video.playbackRate, {
        source: 'external',
      });
    }

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

    if (this.fightTimer) {
      clearTimeout(this.fightTimer);
      this.fightTimer = null;
    }
    this.fightCount = 0;
  }
}

/**
 * Compare binding modifiers against event modifier state.
 * @returns {boolean} True if all four modifiers match exactly.
 */
EventManager.modifiersMatch = function(mods, ctrl, alt, meta, shift) {
  return mods.ctrl === ctrl && mods.alt === alt &&
         mods.meta === meta && mods.shift === shift;
};

// Cooldown duration (ms) for ratechange handling
EventManager.COOLDOWN_MS = 200;

// Fight detection: surrender after this many rapid site-initiated resets
EventManager.MAX_FIGHT_COUNT = 3;

// Fight detection: reset fight count after this quiet period (ms)
EventManager.FIGHT_WINDOW_MS = 3000;

// Create singleton instance
window.VSC.EventManager = EventManager;
