/**
 * Event management system for Video Speed Controller
 */

window.VSC = window.VSC || {};

class EventManager {
  constructor(config, actionHandler) {
    this.config = config;
    this.actionHandler = actionHandler;
    this.listeners = new Map();

    // Event deduplication to prevent duplicate key processing
    this.lastKeyEventSignature = null;

    // Decision core: classifier (gesture evidence -> verdicts) + arbiter
    // (pure transition table). See docs/speed-arbitration.md. This module
    // is an adapter: it owns DOM listeners and consumes the write-token
    // echo filter; all accept/enforce/ignore decisions live in the
    // arbiter, and fight/gesture/echo state lives on the arbitration
    // adapter.
    this.arbitration = new window.VSC.SpeedArbitration(config, this);
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
      const keyupHandler = (event) => this.handleKeyup(event);
      doc.addEventListener('keydown', keydownHandler, true);
      doc.addEventListener('keyup', keyupHandler, true);

      // Store references for cleanup. Keyup only retires the short-lived
      // YouTube Space-hold signature; it never handles VSC shortcuts.
      if (!this.listeners.has(doc)) {
        this.listeners.set(doc, []);
      }
      this.listeners
        .get(doc)
        .push(
          { type: 'keydown', handler: keydownHandler, useCapture: true },
          { type: 'keyup', handler: keyupHandler, useCapture: true }
        );
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

    // Presence evidence regardless of what the key does (quiet axis).
    this.arbitration.classifier.observeInput(event);

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
      // Unhandled key — possibly a native site shortcut. Whether it counts
      // as gesture evidence is the classifier's ruling (native speed
      // shortcuts and site signatures only, per PR #1563).
      this.arbitration.classifier.observeUnhandledKey(event);
      window.VSC.logger.verbose(
        `No key binding found for code=${event.code}, keyCode=${event.keyCode}`
      );
    }

    return false;
  }

  /**
   * Retire a native Space hold after its physical key release. The classifier
   * owns host detection and media attribution; arbitration owns restoration.
   * @param {KeyboardEvent} event
   * @private
   */
  handleKeyup(event) {
    const media = this.arbitration.classifier.observeKeyEnd(event);
    if (media) {
      this.arbitration.noteTemporaryOverrideEnd(media);
    }
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
   * Feed user interactions that originate outside the VSC controller to the
   * classifier's evidence ledger. Clicks on native speed UI land here;
   * unhandled keys land in handleKeydown; pointer lifecycle events cover
   * click-and-hold interactions (evidence only under TARGET_RULES, per
   * PR #1555).
   * The classifier — not this module — decides what counts as intent.
   * @param {Document} document
   * @private
   */
  setupUserGestureListener(document) {
    const clickHandler = (event) => {
      // Skip clicks on our own controller (shadow host retargeted at boundary)
      if (event.target?.closest?.('vsc-controller')) {
        return;
      }
      this.arbitration.classifier.observeClick(event, this.resolveGestureMedia(event));
    };
    const pointerDownHandler = (event) => {
      if (event.target?.closest?.('vsc-controller')) {
        return;
      }
      this.arbitration.classifier.observePointerDown(event, this.resolveGestureMedia(event));
    };
    // Do not filter terminal events by target: a pointer that began outside
    // VSC can end on a captured/retargeted VSC node, and its hold must still
    // be retired by pointer ID. The active local override remains until its
    // following normal ratechange, which makes browser listener ordering safe.
    // `lostpointercapture` is deliberately NOT a terminal signal: capture
    // events are synthesized bookkeeping whose `buttons` value varies across
    // browser builds, and YouTube can shed capture mid-hold. Real releases
    // always reach these document-capture pointerup/pointercancel listeners.
    const pointerEndHandler = (event) => {
      for (const video of this.arbitration.classifier.observePointerEnd(event)) {
        this.arbitration.noteTemporaryOverrideEnd(video);
      }
    };
    // Browser focus/page lifecycle can swallow a physical terminal event.
    // Do not let old hold evidence become indefinite across that boundary.
    const clearTemporaryHolds = () => {
      for (const video of this.arbitration.classifier.clearTemporaryHolds()) {
        this.arbitration.noteTemporaryOverrideEnd(video);
      }
    };
    const visibilityHandler = (event) => {
      if (document.hidden) {
        clearTemporaryHolds(event);
      }
    };
    // Presence-only evidence for the quiet/activity axis: a single
    // timestamp assignment per event, passive so scrolling never blocks.
    // Deliberately coarse — no payloads are read (see classifier privacy
    // note).
    const inputHandler = (event) => {
      this.arbitration.classifier.observeInput(event);
    };
    document.addEventListener('click', clickHandler, true);
    document.addEventListener('pointerdown', pointerDownHandler, true);
    document.addEventListener('pointerup', pointerEndHandler, true);
    document.addEventListener('pointercancel', pointerEndHandler, true);
    document.addEventListener('visibilitychange', visibilityHandler, true);
    document.addEventListener('pointermove', inputHandler, { capture: true, passive: true });
    document.addEventListener('wheel', inputHandler, { capture: true, passive: true });
    document.addEventListener('touchstart', inputHandler, { capture: true, passive: true });

    if (!this.listeners.has(document)) {
      this.listeners.set(document, []);
    }
    this.listeners
      .get(document)
      .push(
        { type: 'click', handler: clickHandler, useCapture: true },
        { type: 'pointerdown', handler: pointerDownHandler, useCapture: true },
        { type: 'pointerup', handler: pointerEndHandler, useCapture: true },
        { type: 'pointercancel', handler: pointerEndHandler, useCapture: true },
        { type: 'visibilitychange', handler: visibilityHandler, useCapture: true },
        { type: 'pointermove', handler: inputHandler, useCapture: true },
        { type: 'wheel', handler: inputHandler, useCapture: true },
        { type: 'touchstart', handler: inputHandler, useCapture: true }
      );

    const view = document.defaultView;
    if (view) {
      if (!this.listeners.has(view)) {
        this.listeners.set(view, []);
      }
      // Bubble phase is load-bearing: `blur` does not bubble but DOES capture
      // through window for every element-level focus change. A capture
      // listener here fires when a press moves page focus, wiping hold
      // evidence milliseconds after the pointerdown that armed it. Without
      // capture, only a genuine window blur (app/tab switch) reaches this.
      view.addEventListener('blur', clearTemporaryHolds);
      view.addEventListener('pagehide', clearTemporaryHolds);
      this.listeners
        .get(view)
        .push(
          { type: 'blur', handler: clearTemporaryHolds, useCapture: false },
          { type: 'pagehide', handler: clearTemporaryHolds, useCapture: false }
        );
    }
  }

  /**
   * Associate a page gesture with a controlled media element only when the
   * DOM path or current site handler identifies one unambiguous owner.
   * Unresolved gestures deliberately retain the classifier's legacy
   * document-level fallback scope.
   * @param {Event} event
   * @returns {HTMLMediaElement|null}
   */
  resolveGestureMedia(event) {
    const mediaElements = window.VSC.stateManager
      ? window.VSC.stateManager.getControlledElements()
      : [];
    if (mediaElements.length === 0) {
      return null;
    }

    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    const controlled = new Set(mediaElements);
    const directMatches = new Set(path.filter((node) => controlled.has(node)));
    if (directMatches.size === 1) {
      return directMatches.values().next().value;
    }
    if (directMatches.size > 1 || mediaElements.length === 1) {
      return null;
    }

    const resolved = window.VSC.siteHandlerManager?.resolveGestureMedia?.(event, mediaElements);
    return controlled.has(resolved) ? resolved : null;
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
    // Get the actual video element (handle shadow DOM)
    const video = event.composedPath ? event.composedPath()[0] : event.target;

    // Skip if no VSC controller attached
    if (!video.vsc) {
      window.VSC.logger.debug('Skipping ratechange - no VSC controller attached');
      return;
    }

    // Echo filter: our own write coming back through the register. A
    // consumed token identifies exactly one expected echo — unlike the
    // legacy time-based cooldown, nothing genuinely external is ever
    // masked, so reactive sites that rewrite the rate in response to our
    // writes produce budget-accounted fight exchanges instead of an
    // invisible write war.
    if (this.arbitration.consumeEcho(video, video.playbackRate)) {
      window.VSC.logger.debug('Ignoring own write echo (in-flight token consumed)');
      event.stopImmediatePropagation();
      return;
    }

    // Belt: origin-tagged synthetic events. This extension no longer
    // dispatches them (the token filter replaced that mechanism), but a
    // stale page-world script from a previous version may still emit them
    // during an extension update; the classifier's SELF verdict mirrors
    // this guard.
    if (event.detail && event.detail.origin === 'videoSpeed') {
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

    // Everything past the guards above is a genuine external change. The
    // classifier turns gesture evidence into a verdict; the arbiter decides
    // accept/enforce/ignore per docs/speed-arbitration.md; the adapter
    // executes the effects (including fight-back mechanics). No decision
    // logic lives in this module anymore.
    const verdict = this.arbitration.classifier.classify({
      media: video,
      rate: video.playbackRate,
      timeStamp: event.timeStamp,
      readyState: video.readyState,
      detail: event.detail,
    });
    this.arbitration.onExternalRate(video, event, verdict);
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

    this.arbitration.cleanup();
  }
}

/**
 * Compare binding modifiers against event modifier state.
 * @returns {boolean} True if all four modifiers match exactly.
 */
EventManager.modifiersMatch = function (mods, ctrl, alt, meta, shift) {
  return mods.ctrl === ctrl && mods.alt === alt && mods.meta === meta && mods.shift === shift;
};

// Timing constants live where the state lives: gesture-window timing on
// IntentClassifier; fight-window timing, the fight budget, and the echo
// filter (write tokens) on SpeedArbitration/SpeedArbiter.

// Create singleton instance
window.VSC.EventManager = EventManager;
