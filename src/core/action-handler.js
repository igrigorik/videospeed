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

      this.eventManager.showController(controller);

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
        this.resetSpeed(video, value);
        break;

      case 'display': {
        window.VSC.logger.debug('Display action triggered');
        const controller = video.vsc.div;

        if (!controller) {
          window.VSC.logger.error('No controller found for video');
          return;
        }

        controller.classList.add('vsc-manual');
        controller.classList.toggle('vsc-hidden');

        // Clear any pending timers that might interfere with manual toggle
        // This prevents delays when manually hiding/showing the controller
        if (controller.blinkTimeOut !== undefined) {
          clearTimeout(controller.blinkTimeOut);
          controller.blinkTimeOut = undefined;
        }

        // Also clear EventManager timer if it exists
        if (this.eventManager && this.eventManager.timer) {
          clearTimeout(this.eventManager.timer);
          this.eventManager.timer = null;
        }

        // Remove vsc-show class immediately when manually hiding
        if (controller.classList.contains('vsc-hidden')) {
          controller.classList.remove('vsc-show');
          window.VSC.logger.debug('Removed vsc-show class for immediate manual hide');
        }
        break;
      }

      case 'blink':
        window.VSC.logger.debug('Showing controller momentarily');
        this.blinkController(video.vsc.div, value);
        break;

      case 'drag':
        window.VSC.DragHandler.handleDrag(video, e);
        break;

      case 'fast':
        this.resetSpeed(video, value);
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
   * Reset speed with memory toggle functionality
   * @param {HTMLMediaElement} video - Video element
   * @param {number} target - Target speed (usually 1.0)
   */
  resetSpeed(video, target) {
    // Show controller for visual feedback (will be shown by adjustSpeed but we can show it early)
    if (video.vsc?.div && this.eventManager) {
      this.eventManager.showController(video.vsc.div);
    }

    if (!video.vsc) {
      window.VSC.logger.warn('resetSpeed called on video without controller');
      return;
    }

    const currentSpeed = video.playbackRate;

    if (currentSpeed === target) {
      // At target speed - restore remembered speed if we have one, otherwise reset to target
      if (video.vsc.speedBeforeReset !== null) {
        window.VSC.logger.info(`Restoring remembered speed: ${video.vsc.speedBeforeReset}`);
        const rememberedSpeed = video.vsc.speedBeforeReset;
        video.vsc.speedBeforeReset = null; // Clear memory after use
        this.adjustSpeed(video, rememberedSpeed);
      } else {
        window.VSC.logger.info(`Already at reset speed ${target}, no change`);
        // Already at target and nothing remembered - no action needed
      }
    } else {
      // Not at target speed - remember current and reset to target
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
   * Jump to time marker
   * @param {HTMLMediaElement} video - Video element
   */
  jumpToMark(video) {
    window.VSC.logger.debug('Recalling marker');
    if (video.vsc.mark && typeof video.vsc.mark === 'number') {
      video.currentTime = video.vsc.mark;
    }
  }

  /**
   * Show controller briefly
   * @param {HTMLElement} controller - Controller element
   * @param {number} duration - Duration in ms (default 1000)
   */
  blinkController(controller, duration) {
    // Don't hide audio controllers after blinking - audio elements are often invisible by design
    // but should maintain visible controllers for user interaction
    const isAudioController = this.isAudioController(controller);

    // Always clear any existing timeout first
    if (controller.blinkTimeOut !== undefined) {
      clearTimeout(controller.blinkTimeOut);
      controller.blinkTimeOut = undefined;
    }

    // Add vsc-show class to temporarily show controller
    // This overrides vsc-hidden via CSS specificity
    controller.classList.add('vsc-show');
    window.VSC.logger.debug('Showing controller temporarily with vsc-show class');

    // For audio controllers, don't set timeout to hide again
    if (!isAudioController) {
      controller.blinkTimeOut = setTimeout(
        () => {
          controller.classList.remove('vsc-show');
          controller.blinkTimeOut = undefined;
          window.VSC.logger.debug('Removing vsc-show class after timeout');
        },
        duration ? duration : 2500
      );
    } else {
      window.VSC.logger.debug('Audio controller blink - keeping vsc-show class');
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
      const { relative = false, source = 'internal' } = options;

      // DEBUG: Log all adjustSpeed calls to trace the mystery
      window.VSC.logger.debug(
        `adjustSpeed called: value=${value}, relative=${relative}, source=${source}`
      );
      const stack = new Error().stack;
      const stackLines = stack.split('\n').slice(1, 8); // First 7 stack frames
      window.VSC.logger.debug(`adjustSpeed call stack: ${stackLines.join(' -> ')}`);

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

    // Show controller for visual feedback when speed is changed
    if (video.vsc?.div && this.eventManager) {
      this.eventManager.showController(video.vsc.div);
    }

    // Calculate target speed
    let targetSpeed;
    if (relative) {
      // For relative changes, add to current speed
      const currentSpeed = video.playbackRate < 0.1 ? 0.0 : video.playbackRate;
      targetSpeed = currentSpeed + value;
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

    // Handle force mode for external changes - restore user preference
    if (source === 'external' && this.config.settings.forceLastSavedSpeed) {
      // In force mode, use lastSpeed instead of allowing external change
      targetSpeed = this.config.settings.lastSpeed || 1.0;
      window.VSC.logger.debug(`Force mode: blocking external change, restoring to ${targetSpeed}`);
    }

    // Use the proven setSpeed implementation with source tracking
    this.setSpeed(video, targetSpeed, source);
  }

  /**
   * Get user's preferred speed (always global lastSpeed)
   * Public method for tests - matches VideoController.getTargetSpeed() logic
   * @param {HTMLMediaElement} video - Video element (for API compatibility)
   * @returns {number} Current preferred speed (always lastSpeed regardless of rememberSpeed setting)
   */
  getPreferredSpeed(video) {
    return this.config.settings.lastSpeed || 1.0;
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

    // 1. Set the actual playback rate
    video.playbackRate = numericSpeed;

    // 2. Always dispatch synthetic event with source tracking
    // This allows EventManager to distinguish our changes from external ones
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

    // 3. Update UI indicator
    const speedIndicator = video.vsc?.speedIndicator;
    if (!speedIndicator) {
      window.VSC.logger.warn(
        'Cannot update speed indicator: video controller UI not fully initialized'
      );
      return;
    }
    speedIndicator.textContent = numericSpeed.toFixed(2);

    // 4. Always update page-scoped speed preference
    window.VSC.logger.debug(
      `Updating config.settings.lastSpeed from ${this.config.settings.lastSpeed} to ${numericSpeed}`
    );
    this.config.settings.lastSpeed = numericSpeed;

    // 5. Save to storage ONLY if rememberSpeed is enabled for cross-session persistence
    if (this.config.settings.rememberSpeed) {
      window.VSC.logger.debug(`Saving lastSpeed ${numericSpeed} to Chrome storage`);
      this.config.save({
        lastSpeed: this.config.settings.lastSpeed,
      });
    } else {
      window.VSC.logger.debug('NOT saving to storage - rememberSpeed is false');
    }

    // 6. Show controller briefly for visual feedback
    if (video.vsc?.div) {
      this.blinkController(video.vsc.div);
    }

    // 7. Refresh cooldown to prevent rapid changes
    if (this.eventManager) {
      this.eventManager.refreshCoolDown();
    }

    // 8. Notify background script to update extension badge
    this.notifySpeedChange(numericSpeed);
  }

  /**
   * Notify background script of speed change to update extension badge
   * Uses window.postMessage to communicate through the content script bridge
   * @param {number} speed - Current playback speed
   * @private
   */
  notifySpeedChange(speed) {
    try {
      window.postMessage(
        {
          source: 'vsc-page',
          action: 'runtime-message',
          data: {
            type: 'SPEED_CHANGE',
            speed: speed,
          },
        },
        '*'
      );
    } catch (error) {
      console.error('Failed to notify speed change:', error);
    }
  }
}

// Create singleton instance
window.VSC.ActionHandler = ActionHandler;
