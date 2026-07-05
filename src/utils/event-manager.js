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

    // User gesture tracking: timestamp of the last user interaction we did NOT
    // handle (click on page UI, unhandled key). A ratechange arriving within
    // USER_GESTURE_WINDOW_MS of this is treated as intentional and accepted
    // immediately rather than fought — handles native site speed controls.
    this.lastUserInteractionAt = 0;
    this.lastUserInteractionSpeedIntent = false;
  }

  /**
   * Set up all event listeners
   * @param {Document} document - Document to attach events to
   */
  setupEventListeners(document) {
    this.setupKeyboardShortcuts(document);
    this.setupRateChangeListener(document);
    this.setupUserGestureListener(document);
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
    } catch {
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
    window.VSC.logger.verbose(
      `Processing keydown event: code=${event.code}, key=${event.key}, keyCode=${event.keyCode}`
    );

    // IME composition and dead key guard
    // 'Process' / keyCode 229 = IME composition active (CJK input)
    // 'Dead' = first keypress of a dead key sequence (e.g. ^ on French keyboard)
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      event.key === 'Process' ||
      event.key === 'Dead'
    ) {
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
    const mediaElements = window.VSC.stateManager
      ? window.VSC.stateManager.getControlledElements()
      : [];
    if (!mediaElements.length) {
      return false;
    }

    // Find matching key binding using the three-tier algorithm
    const keyBinding = this.findMatchingBinding(event);

    if (keyBinding) {
      this.actionHandler.runAction(keyBinding.action, keyBinding.value, event);

      if (this.config.settings.exclusiveKeys) {
        event.preventDefault();
        event.stopPropagation();
      }
    } else {
      // Only speed-looking site shortcuts should authorize an external ratechange.
      // Space/arrow keys often pause or seek and must not reset VSC's speed.
      this.recordUserInteraction(event, this.isSpeedIntentKey(event));
      window.VSC.logger.verbose(
        `No key binding found for code=${event.code}, keyCode=${event.keyCode}`
      );
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
      return bindings.find((b) => {
        const bKey = b.keyCode ?? b.key;
        if (bKey !== keyCode) {
          return false;
        }
        return b.modifiers
          ? EventManager.modifiersMatch(b.modifiers, ctrl, alt, meta, shift)
          : !hasModifier;
      });
    }

    // Tier 1: Chord match — bindings WITH modifiers, all must match exactly
    const chordMatch = bindings.find(
      (b) =>
        b.modifiers &&
        b.code === code &&
        EventManager.modifiersMatch(b.modifiers, ctrl, alt, meta, shift)
    );
    if (chordMatch) {
      return chordMatch;
    }

    // Tier 2: Simple match — bindings WITHOUT modifiers, no Ctrl/Alt/Meta active
    if (!hasModifier) {
      const simpleMatch = bindings.find((b) => !b.modifiers && b.code === code);
      if (simpleMatch) {
        return simpleMatch;
      }
    }

    // Tier 3: Legacy fallback — bindings missing code field, match on keyCode
    if (!hasModifier) {
      const legacyMatch = bindings.find((b) => {
        if (b.code !== null && b.code !== undefined) {
          return false;
        }
        return (b.keyCode ?? b.key) === keyCode;
      });
      if (legacyMatch) {
        return legacyMatch;
      }
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
   * Track user interactions that originate outside the VSC controller.
   * Clicks on YouTube's speed menu (or any site's native speed UI) land here.
   * Unhandled keyboard events (e.g. YouTube's < > shortcuts) land in handleKeydown.
   * Both update lastUserInteractionAt so handleRateChange can distinguish
   * intentional speed changes from automatic site-initiated resets.
   * @param {Document} document
   * @private
   */
  setupUserGestureListener(document) {
    const clickHandler = (event) => {
      // Skip clicks on our own controller (shadow host retargeted at boundary)
      if (event.target?.closest?.('vsc-controller')) {
        return;
      }
      this.recordUserInteraction(event, this.isSpeedIntentTarget(event));
    };
    document.addEventListener('click', clickHandler, true);

    if (!this.listeners.has(document)) {
      this.listeners.set(document, []);
    }
    this.listeners.get(document).push({ type: 'click', handler: clickHandler, useCapture: true });
  }

  /**
   * Record the latest non-VSC interaction and whether it looks speed-related.
   * @param {Event} event
   * @param {boolean} speedIntent
   * @private
   */
  recordUserInteraction(event, speedIntent = false) {
    this.lastUserInteractionAt = event.timeStamp;
    this.lastUserInteractionSpeedIntent = Boolean(speedIntent);
  }

  /**
   * Clear consumed interaction state.
   * @private
   */
  clearUserInteraction() {
    this.lastUserInteractionAt = 0;
    this.lastUserInteractionSpeedIntent = false;
  }

  /**
   * Detect clicks on native speed menus/buttons without treating normal player
   * controls (pause, seek, next episode) as speed changes.
   * @param {Event} event
   * @returns {boolean}
   * @private
   */
  isSpeedIntentTarget(event) {
    const path = event.composedPath ? event.composedPath() : [event.target];
    const speedPattern =
      /speed|playback[-_\s]*rate|倍速|速度|播放速度|速率|再生速度|velocidad|vitesse|geschwindigkeit/i;

    return path.some((node) => {
      if (!node || node === window || node === document || node.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      const className = typeof node.className === 'string' ? node.className : '';
      const textContent = node.textContent && node.textContent.length <= 80 ? node.textContent : '';
      const textParts = [
        node.getAttribute?.('aria-label'),
        node.getAttribute?.('title'),
        node.getAttribute?.('data-title-no-tooltip'),
        node.getAttribute?.('data-tooltip-target-id'),
        node.getAttribute?.('data-testid'),
        node.id,
        className,
        textContent,
      ];

      return speedPattern.test(textParts.filter(Boolean).join(' '));
    });
  }

  /**
   * Detect common native player speed shortcuts.
   * @param {KeyboardEvent} event
   * @returns {boolean}
   * @private
   */
  isSpeedIntentKey(event) {
    return (
      event.key === '<' ||
      event.key === '>' ||
      ((event.key === ',' || event.key === '.') && event.shiftKey) ||
      ((event.code === 'Comma' || event.code === 'Period') && event.shiftKey)
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

      // Don't fight back during video initialization — the player's own setup
      // fires ratechange at readyState=0; overwriting it can break the player.
      if (video.readyState < 1) {
        window.VSC.logger.debug('Skipping cooldown fight-back during video init (readyState < 1)');
        return;
      }

      // RESTORE our authoritative value since external change already happened
      if (video.vsc && this.config.settings.lastSpeed !== null) {
        const authoritativeSpeed = this.config.settings.lastSpeed;
        if (Math.abs(video.playbackRate - authoritativeSpeed) > 0.01) {
          window.VSC.logger.info(
            `Restoring speed during cooldown from external ${video.playbackRate} to authoritative ${authoritativeSpeed}`
          );
          window.VSC.siteHandlerManager.handleSpeedChange(video, authoritativeSpeed);
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
      window.VSC.logger.debug(
        'Ignoring external ratechange during video initialization (readyState < 1)'
      );
      return;
    }

    // Ignore spurious external ratechanges below our supported MIN
    const rawExternalRate = typeof video.playbackRate === 'number' ? video.playbackRate : NaN;
    const min = window.VSC.Constants.SPEED_LIMITS.MIN;
    if (!isNaN(rawExternalRate) && rawExternalRate <= min) {
      window.VSC.logger.debug(
        `Ignoring external ratechange below MIN: raw=${rawExternalRate}, MIN=${min}`
      );
      return;
    }

    // Fight detection: if site changed speed away from what we set, decide whether
    // to fight back or accept. User-initiated changes (detected via gesture window)
    // are accepted immediately — this allows native site controls (e.g. YouTube's
    // speed menu or < > shortcuts) to coexist with our fight-back logic.
    const authoritativeSpeed = this.config.settings.lastSpeed;

    if (authoritativeSpeed && Math.abs(video.playbackRate - authoritativeSpeed) > 0.01) {
      if (
        video.paused &&
        Math.abs(video.playbackRate - 1.0) <= 0.01 &&
        Math.abs(authoritativeSpeed - 1.0) > 0.01
      ) {
        window.VSC.logger.info(
          `Ignoring paused 1x reset; restoring authoritative speed ${authoritativeSpeed}`
        );
        this.fightCount = 0;
        if (this.fightTimer) {
          clearTimeout(this.fightTimer);
          this.fightTimer = null;
        }
        this.clearUserInteraction();
        window.VSC.siteHandlerManager.handleSpeedChange(video, authoritativeSpeed);
        this.refreshCoolDown();
        event.stopImmediatePropagation();
        return;
      }

      const timeSinceGesture = event.timeStamp - this.lastUserInteractionAt;
      const isUserGesture =
        this.lastUserInteractionSpeedIntent &&
        timeSinceGesture < EventManager.USER_GESTURE_WINDOW_MS;

      if (isUserGesture) {
        // User interacted with the site's native speed controls — accept immediately.
        // Treat as internal so lastSpeed and storage are updated to match intent.
        window.VSC.logger.info(
          `Accepting site speed change as user-intentional (gesture ${timeSinceGesture}ms ago): ${video.playbackRate}`
        );
        this.fightCount = 0;
        if (this.fightTimer) {
          clearTimeout(this.fightTimer);
          this.fightTimer = null;
        }
        this.clearUserInteraction();
        if (this.actionHandler) {
          this.actionHandler.adjustSpeed(video, video.playbackRate);
        }
        return;
      }

      this.fightCount++;

      // Reset fight count after a quiet period
      if (this.fightTimer) {
        clearTimeout(this.fightTimer);
      }
      this.fightTimer = setTimeout(() => {
        this.fightCount = 0;
        this.fightTimer = null;
      }, EventManager.FIGHT_WINDOW_MS);

      if (this.fightCount >= EventManager.MAX_FIGHT_COUNT) {
        // Surrender — accept the site's speed
        window.VSC.logger.info(
          `Fight detection: surrendering after ${this.fightCount} resets. Accepting site speed ${video.playbackRate}`
        );
        this.fightCount = 0;
        // Fall through to accept the external change below
      } else {
        // Fight back — restore our speed with exponential backoff
        const cooldown = Math.min(
          EventManager.BASE_COOLDOWN_MS * Math.pow(2, this.fightCount - 1),
          EventManager.MAX_COOLDOWN_MS
        );
        window.VSC.logger.info(
          `Fight detection: attempt ${this.fightCount}/${EventManager.MAX_FIGHT_COUNT}, re-applying ${authoritativeSpeed} (cooldown ${cooldown}ms)`
        );
        window.VSC.siteHandlerManager.handleSpeedChange(video, authoritativeSpeed);
        this.refreshCoolDown(cooldown);
        event.stopImmediatePropagation();
        return;
      }
    }

    if (this.actionHandler) {
      this.actionHandler.adjustSpeed(video, video.playbackRate, {
        source: 'external',
      });
    }
  }

  /**
   * Start cooldown period to prevent event spam
   */
  refreshCoolDown(duration = EventManager.BASE_COOLDOWN_MS) {
    window.VSC.logger.debug(`Begin refreshCoolDown (${duration}ms)`);

    if (this.coolDown) {
      clearTimeout(this.coolDown);
    }

    this.coolDown = setTimeout(() => {
      this.coolDown = false;
    }, duration);

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
    this.clearUserInteraction();
  }
}

/**
 * Compare binding modifiers against event modifier state.
 * @returns {boolean} True if all four modifiers match exactly.
 */
EventManager.modifiersMatch = function (mods, ctrl, alt, meta, shift) {
  return mods.ctrl === ctrl && mods.alt === alt && mods.meta === meta && mods.shift === shift;
};

// Time window (ms) after a user interaction in which an external ratechange is
// treated as user-intentional (site native controls) rather than fought back.
EventManager.USER_GESTURE_WINDOW_MS = 300;

// Base cooldown duration (ms) for ratechange handling; doubles each fight-back retry
EventManager.BASE_COOLDOWN_MS = 200;

// Maximum cooldown duration (ms) during fight-back backoff
EventManager.MAX_COOLDOWN_MS = 2000;

// Fight detection: surrender after this many rapid site-initiated resets
EventManager.MAX_FIGHT_COUNT = 5;

// Fight detection: reset fight count after this quiet period (ms)
EventManager.FIGHT_WINDOW_MS = EventManager.MAX_COOLDOWN_MS + 1000;

// Create singleton instance
window.VSC.EventManager = EventManager;
