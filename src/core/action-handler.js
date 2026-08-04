/**
 * Action handling system for Video Speed Controller
 *
 */

window.VSC = window.VSC || {};

class ActionHandler {
  constructor(config, eventManager) {
    this.config = config;
    this.eventManager = eventManager;
  }

  /**
   * Create the short-lived context shared by every controlled media target of
   * one user command. A bulk keyboard/popup action starts one authority epoch,
   * not one epoch per target, while each target still receives its local
   * USER_SET transition.
   * @returns {{hasClaimedAuthority: boolean}}
   */
  createAuthorityBatch() {
    return { hasClaimedAuthority: false };
  }

  /**
   * Execute an action on media elements
   * @param {string} action - Action to perform
   * @param {*} value - Action value
   * @param {Event} e - Event object (optional)
   */
  runAction(action, value, e) {
    // Use state manager for complete media discovery (includes shadow DOM)
    const mediaTags = window.VSC.stateManager
      ? window.VSC.stateManager.getControlledElements()
      : []; // No fallback - state manager should always be available

    // Get the controller that was used if called from a button press event
    let targetController = null;
    if (e) {
      targetController = e.target.getRootNode().host;
    }

    const authorityBatch = this.createAuthorityBatch();
    mediaTags.forEach((v) => {
      const controller = v.vsc?.div;

      if (!controller) {
        return;
      }

      // Don't change video speed if the video has a different controller
      // Only apply this check for button clicks (when targetController is set)
      if (e && targetController && !(targetController === controller)) {
        return;
      }

      if (!v.classList.contains('vsc-cancelled')) {
        this.executeAction(action, value, v, e, { authorityBatch });
      }
    });
  }

  /**
   * Execute specific action on a video element
   * @param {string} action - Action to perform
   * @param {*} value - Action value
   * @param {HTMLMediaElement} video - Video element
   * @param {Event} e - Event object (optional)
   * @param {{authorityBatch?: {hasClaimedAuthority: boolean}}} [options]
   * @private
   */
  executeAction(action, value, video, e, options = {}) {
    switch (action) {
      case 'rewind':
        window.VSC.logger.debug('Rewind');
        this.seek(video, -value);
        break;

      case 'advance':
        window.VSC.logger.debug('Fast forward');
        this.seek(video, value);
        break;

      case 'faster': {
        window.VSC.logger.debug('Increase speed');
        this.adjustSpeed(video, value, { relative: true, authorityBatch: options.authorityBatch });
        break;
      }

      case 'slower': {
        window.VSC.logger.debug('Decrease speed');
        this.adjustSpeed(video, -value, { relative: true, authorityBatch: options.authorityBatch });
        break;
      }

      case 'reset':
        window.VSC.logger.debug('Reset speed');
        this.resetSpeed(video, value, this.config.getKeyBinding('fast'), options);
        break;

      case 'display':
        window.VSC.logger.debug('Display action triggered');
        this.toggleControllerVisibility(video);
        break;

      case 'fullscreen':
        window.VSC.logger.debug('Fullscreen action triggered');
        this.toggleFullscreen(video);
        break;

      case 'blink':
        window.VSC.logger.debug('Showing controller momentarily');
        this.flashController(video.vsc.div, value);
        break;

      case 'drag':
        window.VSC.DragHandler.handleDrag(video, e);
        break;

      case 'fast':
        window.VSC.logger.debug('Preferred speed');
        this.resetSpeed(video, value, this.config.getKeyBinding('reset'), options);
        break;

      case 'pause':
        this.pause(video);
        break;

      case 'muted':
        this.muted(video);
        break;

      case 'louder':
        this.volumeUp(video, value);
        break;

      case 'softer':
        this.volumeDown(video, value);
        break;

      case 'mark':
        this.setMark(video);
        break;

      case 'jump':
        this.jumpToMark(video);
        break;

      case 'SET_SPEED':
        window.VSC.logger.info('Setting speed to:', value);
        this.adjustSpeed(video, value, { authorityBatch: options.authorityBatch });
        break;

      case 'ADJUST_SPEED':
        window.VSC.logger.info('Adjusting speed by:', value);
        this.adjustSpeed(video, value, { relative: true, authorityBatch: options.authorityBatch });
        break;

      case 'RESET_SPEED': {
        window.VSC.logger.info('Resetting speed');
        const preferredSpeed = this.config.getKeyBinding('fast') || 1.0;
        this.adjustSpeed(video, preferredSpeed, { authorityBatch: options.authorityBatch });
        break;
      }

      default:
        window.VSC.logger.warn(`Unknown action: ${action}`);
    }
  }

  /**
   * Toggle fullscreen for the closest player container, falling back to the media element.
   * @param {HTMLMediaElement} video - Media element whose player is toggled
   */
  toggleFullscreen(video) {
    const target = video.closest?.('.html5-video-player') || video.parentElement || video;

    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }

    if (target.requestFullscreen) {
      target.requestFullscreen();
    } else {
      video.requestFullscreen?.();
    }
  }

  /**
   * Toggle an explicit visibility override without mutating the automatic
   * state maintained by startHidden, media visibility, and site autohide.
   * The first toggle opposes rendered AUTO; later toggles alternate persistent
   * SHOW/HIDE intent so player autohide cannot silently retake control.
   * @param {HTMLMediaElement} video - Media element whose controller is toggled
   */
  toggleControllerVisibility(video) {
    const controller = video.vsc?.div;
    if (!controller) {
      window.VSC.logger.error('No controller found for video');
      return;
    }

    const visibility = window.VSC.ControllerVisibility;
    const currentOverride = visibility.normalizeOverride(controller.dataset.vscVisibility);
    // Sample before cancelling a flash: the first V press must flip what the
    // user currently sees, including temporary speed feedback.
    const isVisible =
      currentOverride === visibility.OVERRIDES.AUTO
        ? this.isControllerVisible(controller)
        : undefined;
    const nextOverride =
      currentOverride === visibility.OVERRIDES.AUTO && isVisible === null
        ? null
        : visibility.nextOverride(currentOverride, isVisible);

    if (controller.flashTimer !== undefined) {
      clearTimeout(controller.flashTimer);
      controller.flashTimer = undefined;
    }
    controller.classList.remove('vsc-show');

    if (nextOverride !== null) {
      controller.dataset.vscVisibility = nextOverride;
    }
  }

  /**
   * Read rendered shadow-controller visibility. This intentionally consults
   * computed style so site CSS remains the single source of autohide truth.
   * Opacity is excluded because site fade transitions pass through zero while
   * visibility provides the discrete state needed by the toggle contract.
   * @param {HTMLElement} controller - The vsc-controller host
   * @returns {boolean|null} Whether it is rendered, or null when unavailable
   */
  isControllerVisible(controller) {
    const innerController = controller.shadowRoot
      ? window.VSC.ShadowDOMManager.getController(controller.shadowRoot)
      : null;
    if (!innerController) {
      window.VSC.logger.error('Controller shadow content not found');
      return null;
    }

    const hostStyle = window.getComputedStyle(controller);
    const innerStyle = window.getComputedStyle(innerController);
    return (
      hostStyle.display !== 'none' &&
      hostStyle.visibility !== 'hidden' &&
      innerStyle.display !== 'none' &&
      innerStyle.visibility !== 'hidden'
    );
  }

  /**
   * Seek video by specified seconds
   * @param {HTMLMediaElement} video - Video element
   * @param {number} seekSeconds - Seconds to seek
   */
  seek(video, seekSeconds) {
    // Use site-specific seeking (handlers return true if they handle it)
    window.VSC.siteHandlerManager.handleSeek(video, seekSeconds);
  }

  /**
   * Toggle pause/play
   * @param {HTMLMediaElement} video - Video element
   */
  pause(video) {
    if (video.paused) {
      window.VSC.logger.debug('Resuming video');
      video.play();
    } else {
      window.VSC.logger.debug('Pausing video');
      video.pause();
    }
  }

  /**
   * Reset speed with memory toggle functionality.
   *
   * Behavior:
   *   - Not at target → remember current speed, jump to target.
   *   - At target with memory → restore remembered speed, clear memory.
   *   - At target without memory → cross-toggle to the other action's speed
   *     (e.g. reset at 1.0x jumps to preferred speed, preferred at 1.8x jumps to reset speed).
   *
   * @param {HTMLMediaElement} video - Video element
   * @param {number} target - Target speed for this action
   * @param {number} [crossTarget] - Target speed of the paired action (for cross-toggle)
   * @param {{authorityBatch?: {hasClaimedAuthority: boolean}}} [options]
   */
  resetSpeed(video, target, crossTarget, options = {}) {
    if (!video.vsc) {
      window.VSC.logger.warn('resetSpeed called on video without controller');
      return;
    }

    const currentSpeed = video.playbackRate;

    if (currentSpeed === target) {
      if (video.vsc.speedBeforeReset !== null) {
        // Restore remembered speed
        window.VSC.logger.info(`Restoring remembered speed: ${video.vsc.speedBeforeReset}`);
        const rememberedSpeed = video.vsc.speedBeforeReset;
        video.vsc.speedBeforeReset = null;
        this.adjustSpeed(video, rememberedSpeed, options);
      } else if (crossTarget && crossTarget !== target) {
        // Cross-toggle: jump to the paired action's target
        window.VSC.logger.info(`Cross-toggle from ${target} to ${crossTarget}`);
        video.vsc.speedBeforeReset = currentSpeed;
        this.adjustSpeed(video, crossTarget, options);
      } else {
        // Even an already-normal reset is an explicit VSC choice. Route it
        // through USER_SET so a same-value action starts a fresh authority
        // epoch and retries any locally suppressed media on the next lifecycle.
        this.adjustSpeed(video, target, options);
      }
    } else {
      // Remember current speed and jump to target
      window.VSC.logger.info(`Remembering speed ${currentSpeed} and resetting to ${target}`);
      video.vsc.speedBeforeReset = currentSpeed;
      this.adjustSpeed(video, target, options);
    }
  }

  /**
   * Toggle mute
   * @param {HTMLMediaElement} video - Video element
   */
  muted(video) {
    video.muted = video.muted !== true;
  }

  /**
   * Increase volume
   * @param {HTMLMediaElement} video - Video element
   * @param {number} value - Amount to increase
   */
  volumeUp(video, value) {
    video.volume = Math.min(1, (video.volume + value).toFixed(2));
  }

  /**
   * Decrease volume
   * @param {HTMLMediaElement} video - Video element
   * @param {number} value - Amount to decrease
   */
  volumeDown(video, value) {
    video.volume = Math.max(0, (video.volume - value).toFixed(2));
  }

  /**
   * Set time marker
   * @param {HTMLMediaElement} video - Video element
   */
  setMark(video) {
    window.VSC.logger.debug('Adding marker');
    video.vsc.mark = video.currentTime;
  }

  /**
   * Jump to time marker, or jump back to previous position if already at marker
   * @param {HTMLMediaElement} video - Video element
   */
  jumpToMark(video) {
    if (
      video.vsc.mark === null ||
      video.vsc.mark === undefined ||
      typeof video.vsc.mark !== 'number'
    ) {
      return;
    }

    const currentTime = video.currentTime;

    if (video.vsc.positionBeforeJump !== null && Math.abs(currentTime - video.vsc.mark) < 0.05) {
      // At the marker — toggle back to where we came from
      window.VSC.logger.debug('Jumping back to pre-marker position');
      video.currentTime = video.vsc.positionBeforeJump;
      video.vsc.positionBeforeJump = null;
    } else {
      // Jump to marker, remembering current position
      window.VSC.logger.debug('Jumping to marker');
      video.vsc.positionBeforeJump = currentTime;
      video.currentTime = video.vsc.mark;
    }
  }

  /**
   * Flash controller briefly for visual feedback.
   * Single entry point for all temporary visibility — replaces both
   * blinkController and EventManager.showController.
   * @param {HTMLElement} controller - Controller element
   * @param {number} duration - Duration in ms (default 2000)
   */
  flashController(controller, duration) {
    const visibility = window.VSC.ControllerVisibility;
    const override = visibility.normalizeOverride(controller.dataset.vscVisibility);
    if (
      !visibility.allowsFlash({
        attached: true,
        startHidden: this.config.settings.startHidden,
        override,
      })
    ) {
      const reason = this.config.settings.startHidden ? 'startHidden preference' : 'user hide';
      window.VSC.logger.debug(`flashController skipped: ${reason}`);
      return;
    }

    const isAudioController = this.isAudioController(controller);

    // Always clear any existing timer first (timer invariant: one per controller)
    if (controller.flashTimer !== undefined) {
      clearTimeout(controller.flashTimer);
      controller.flashTimer = undefined;
    }

    // Add vsc-show class to temporarily show the automatic controller state.
    // An explicit hide override still wins via the final shadow CSS rule.
    controller.classList.add('vsc-show');
    window.VSC.logger.debug('Showing controller temporarily with vsc-show class');

    // For audio controllers, don't set timeout to hide again
    if (!isAudioController) {
      controller.flashTimer = setTimeout(() => {
        controller.classList.remove('vsc-show');
        controller.flashTimer = undefined;
        window.VSC.logger.debug('Removing vsc-show class after flash timeout');
      }, duration || 2000);
    } else {
      window.VSC.logger.debug('Audio controller flash - keeping vsc-show class');
    }
  }

  /**
   * Check if controller is associated with an audio element
   * @param {HTMLElement} controller - Controller element
   * @returns {boolean} True if associated with audio element
   * @private
   */
  isAudioController(controller) {
    // Find associated media element using state manager
    const mediaElements = window.VSC.stateManager
      ? window.VSC.stateManager.getControlledElements()
      : [];
    for (const media of mediaElements) {
      if (media.vsc && media.vsc.div === controller) {
        return media.tagName === 'AUDIO';
      }
    }
    return false;
  }

  /**
   * Adjust video playback speed (absolute or relative).
   *
   * This IS the USER_SET event (contract cells 5/12): every caller is a
   * user acting through VSC — shortcuts, controller UI, popup, wheel. The
   * arbiter's USER_SET row is unconditional, so no classification happens
   * here; the effect row (PERSIST, WRITE, SYNC_UI) executes in
   * _adjustSpeedInternal. Non-user speed changes never come through this
   * method: lifecycle restores call writeRate/syncIndicator directly, and
   * external rates are decided by SpeedArbitration.onExternalRate.
   *
   * @param {HTMLMediaElement} video - Target video element
   * @param {number} value - Speed value (absolute) or delta (relative)
   * @param {Object} options - Configuration options
   * @param {boolean} options.relative - If true, value is a delta; if false, absolute speed
   * @param {{hasClaimedAuthority: boolean}} [options.authorityBatch] - Shared batch context for a bulk user command
   */
  adjustSpeed(video, value, options = {}) {
    return window.VSC.logger.withContext(video, () => {
      // Validate input
      if (!video || !video.vsc) {
        window.VSC.logger.warn('adjustSpeed called on video without controller');
        return;
      }

      if (typeof value !== 'number' || isNaN(value)) {
        window.VSC.logger.warn('adjustSpeed called with invalid value:', value);
        return;
      }

      return this._adjustSpeedInternal(video, value, options);
    });
  }

  /**
   * Internal adjustSpeed implementation (context already set)
   * @private
   */
  _adjustSpeedInternal(video, value, options) {
    const { relative = false, authorityBatch } = options;

    // Calculate target speed
    let targetSpeed;
    if (relative) {
      // For relative changes, add to current speed
      const currentSpeed = video.playbackRate < 0.1 ? 0.0 : video.playbackRate;
      targetSpeed = currentSpeed + value;

      // Snap to 1.0x when crossing the 1.0 boundary
      if ((currentSpeed > 1.0 && targetSpeed < 1.0) || (currentSpeed < 1.0 && targetSpeed > 1.0)) {
        targetSpeed = 1.0;
      }

      window.VSC.logger.debug(
        `Relative speed calculation: currentSpeed=${currentSpeed} + ${value} = ${targetSpeed}`
      );
    } else {
      // For absolute changes, use value directly
      targetSpeed = value;
      window.VSC.logger.debug(`Absolute speed set: ${targetSpeed}`);
    }

    // Clamp to valid range
    targetSpeed = Math.min(
      Math.max(targetSpeed, window.VSC.Constants.SPEED_LIMITS.MIN),
      window.VSC.Constants.SPEED_LIMITS.MAX
    );

    // Round to 2 decimal places to avoid floating point issues
    targetSpeed = Number(targetSpeed.toFixed(2));

    // USER_SET effect row, in order. A user action claims authority with a
    // clean fight budget (cells 5/12); authority must be current BEFORE the
    // register write, so any handler observing the resulting ratechange
    // reads fresh state.
    if (this.eventManager?.arbitration) {
      this.eventManager.arbitration.noteUserSet(video, targetSpeed, {
        startsAuthorityEpoch: !authorityBatch || !authorityBatch.hasClaimedAuthority,
      });
      if (authorityBatch) {
        authorityBatch.hasClaimedAuthority = true;
      }
    } else {
      // Standalone construction has no document coordinator; preserve the
      // existing persistence behavior for unit-level/controller-only use.
      this.config.persistAuthority(targetSpeed);
    }
    this.writeRate(video, targetSpeed);
    this.syncIndicator(video, targetSpeed);
  }

  /**
   * Get user's preferred speed, respecting rememberSpeed setting.
   * @returns {number} Preferred speed (lastSpeed when remembering, 1.0 otherwise)
   */
  getPreferredSpeed() {
    if (this.config.settings.rememberSpeed) {
      return this.config.settings.lastSpeed || 1.0;
    }
    return 1.0;
  }

  /**
   * WRITE effect primitive: set the register (video.playbackRate) through
   * the per-site strategy, first registering the value with the in-flight
   * write registry so the native ratechange echo is filtered
   * (SpeedArbitration.noteWrite/consumeEcho) instead of being classified
   * as an external change.
   *
   * A same-value assignment fires no ratechange (per spec), so no token is
   * taken for it — lifecycle re-asserts on every play/seeked would
   * otherwise accumulate stale tokens.
   *
   * Never touches authority (lastSpeed) or the UI: callers compose this
   * with persistAuthority/syncIndicator per the contract's effect rows.
   *
   * @param {HTMLMediaElement} video - Video element
   * @param {number} rate - Target speed
   */
  writeRate(video, rate) {
    const numericSpeed = Number(rate.toFixed(2));
    if (video.playbackRate !== numericSpeed && this.eventManager?.arbitration) {
      this.eventManager.arbitration.noteWrite(video, numericSpeed);
    }
    window.VSC.siteHandlerManager.handleSpeedChange(video, numericSpeed);
  }

  /**
   * SYNC_UI effect primitive: reflect a speed in the controller badge and
   * flash for visual feedback. Never touches the register or authority.
   *
   * @param {HTMLMediaElement} video - Video element
   * @param {number} rate - Speed to display
   */
  syncIndicator(video, rate) {
    const numericSpeed = Number(rate.toFixed(2));
    const speedIndicator = video.vsc?.speedIndicator;
    if (!speedIndicator) {
      window.VSC.logger.warn(
        'Cannot update speed indicator: video controller UI not fully initialized'
      );
      return;
    }
    speedIndicator.textContent = numericSpeed.toFixed(2);

    if (video.vsc?.div) {
      this.flashController(video.vsc.div);
    }
  }
}

// Create singleton instance
window.VSC.ActionHandler = ActionHandler;
