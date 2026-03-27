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
        this.executeAction(action, value, v, e);
      }
    });
  }

  /**
   * Execute specific action on a video element
   * @param {string} action - Action to perform
   * @param {*} value - Action value
   * @param {HTMLMediaElement} video - Video element
   * @param {Event} e - Event object (optional)
   * @private
   */
  executeAction(action, value, video, e) {
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
        this.adjustSpeed(video, value, { relative: true });
        break;
      }

      case 'slower': {
        window.VSC.logger.debug('Decrease speed');
        this.adjustSpeed(video, -value, { relative: true });
        break;
      }

      case 'reset':
        window.VSC.logger.debug('Reset speed');
        this.resetSpeed(video, value, this.config.getKeyBinding('fast'));
        break;

      case 'display': {
        window.VSC.logger.debug('Display action triggered');
        const controller = video.vsc.div;

        if (!controller) {
          window.VSC.logger.error('No controller found for video');
          return;
        }

        // Clear any pending flash timer before toggling
        if (controller.flashTimer !== undefined) {
          clearTimeout(controller.flashTimer);
          controller.flashTimer = undefined;
        }

        controller.classList.toggle('vsc-hidden');
        // vsc-manual means "user has expressed intent about this controller's
        // visibility." Set on first toggle, never cleared for the lifetime of
        // the controller. This protects against YouTube autohide overriding
        // the user's show intent, and prevents flash from overriding hide intent.
        controller.classList.add('vsc-manual');

        if (controller.classList.contains('vsc-hidden')) {
          // User is hiding — also remove any pending flash override
          controller.classList.remove('vsc-show');
        }
        break;
      }

      case 'blink':
        window.VSC.logger.debug('Showing controller momentarily');
        this.flashController(video.vsc.div, value);
        break;

      case 'drag':
        window.VSC.DragHandler.handleDrag(video, e);
        break;

      case 'fast':
        window.VSC.logger.debug('Preferred speed');
        this.resetSpeed(video, value, this.config.getKeyBinding('reset'));
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
        this.adjustSpeed(video, value, { source: 'internal' });
        break;

      case 'ADJUST_SPEED':
        window.VSC.logger.info('Adjusting speed by:', value);
        this.adjustSpeed(video, value, { relative: true, source: 'internal' });
        break;

      case 'RESET_SPEED': {
        window.VSC.logger.info('Resetting speed');
        const preferredSpeed = this.config.getKeyBinding('fast') || 1.0;
        this.adjustSpeed(video, preferredSpeed, { source: 'internal' });
        break;
      }

      default:
        window.VSC.logger.warn(`Unknown action: ${action}`);
    }
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
   */
  resetSpeed(video, target, crossTarget) {
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
        this.adjustSpeed(video, rememberedSpeed);
      } else if (crossTarget && crossTarget !== target) {
        // Cross-toggle: jump to the paired action's target
        window.VSC.logger.info(`Cross-toggle from ${target} to ${crossTarget}`);
        video.vsc.speedBeforeReset = currentSpeed;
        this.adjustSpeed(video, crossTarget);
      }
    } else {
      // Remember current speed and jump to target
      window.VSC.logger.info(`Remembering speed ${currentSpeed} and resetting to ${target}`);
      video.vsc.speedBeforeReset = currentSpeed;
      this.adjustSpeed(video, target);
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
    // Don't flash when user has explicitly hidden this controller.
    // vsc-manual + vsc-hidden = "user pressed V to hide" — respect that.
    if (
      controller.classList.contains('vsc-manual') &&
      controller.classList.contains('vsc-hidden')
    ) {
      window.VSC.logger.debug('flashController skipped: user manually hid controller');
      return;
    }

    // startHidden without user interaction: don't flash (no user intent yet)
    if (this.config.settings.startHidden && !controller.classList.contains('vsc-manual')) {
      window.VSC.logger.debug('flashController skipped: startHidden and no user interaction');
      return;
    }

    const isAudioController = this.isAudioController(controller);

    // Always clear any existing timer first (timer invariant: one per controller)
    if (controller.flashTimer !== undefined) {
      clearTimeout(controller.flashTimer);
      controller.flashTimer = undefined;
    }

    // Add vsc-show class to temporarily show controller
    // This overrides vsc-hidden and vsc-autohide via CSS source order
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
   * Adjust video playback speed (absolute or relative)
   * Simplified to use proven working logic from setSpeed method
   *
   * @param {HTMLMediaElement} video - Target video element
   * @param {number} value - Speed value (absolute) or delta (relative)
   * @param {Object} options - Configuration options
   * @param {boolean} options.relative - If true, value is a delta; if false, absolute speed
   * @param {string} options.source - 'internal' (user action) or 'external' (site/other)
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
    const { relative = false, source = 'internal' } = options;

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

    // Fight detection is enforced upstream in event-manager.js.
    // External changes that reach here have already been approved (fight surrendered or speed matched).
    this.setSpeed(video, targetSpeed, source);
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
   * Set video playback speed with complete state management
   * Unified implementation with all functionality - no fragmented logic
   * @param {HTMLMediaElement} video - Video element
   * @param {number} speed - Target speed
   * @param {string} source - Change source: 'internal' (user/extension) or 'external' (site)
   */
  setSpeed(video, speed, source = 'internal') {
    const speedValue = speed.toFixed(2);
    const numericSpeed = Number(speedValue);

    // 1. Start cooldown FIRST — the playbackRate assignment below triggers a
    //    native ratechange event synchronously. Without cooldown active,
    //    handleRateChange would misclassify it as an external site change.
    if (this.eventManager) {
      this.eventManager.refreshCoolDown();
    }

    // 2. Set the actual playback rate via site handler (native ratechange fires here, blocked by cooldown)
    window.VSC.siteHandlerManager.handleSpeedChange(video, numericSpeed);

    // 3. Dispatch synthetic event with source tracking
    video.dispatchEvent(
      new CustomEvent('ratechange', {
        bubbles: true,
        composed: true,
        detail: {
          origin: 'videoSpeed',
          speed: speedValue,
          source: source,
        },
      })
    );

    // 4. Update UI indicator
    const speedIndicator = video.vsc?.speedIndicator;
    if (!speedIndicator) {
      window.VSC.logger.warn(
        'Cannot update speed indicator: video controller UI not fully initialized'
      );
      return;
    }
    speedIndicator.textContent = numericSpeed.toFixed(2);

    // 5. Update lastSpeed only for user-initiated changes — external/site
    //    speed overrides must not corrupt the user's intended speed.
    if (source !== 'external') {
      this.config.settings.lastSpeed = numericSpeed;

      // 6. Persist to storage only if rememberSpeed is enabled
      if (this.config.settings.rememberSpeed) {
        this.config.save({ lastSpeed: numericSpeed });
      }
    }

    // 7. Flash controller briefly for visual feedback
    if (video.vsc?.div) {
      this.flashController(video.vsc.div);
    }
  }
}

// Create singleton instance
window.VSC.ActionHandler = ActionHandler;
