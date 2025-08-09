/**
 * Action handling system for Video Speed Controller
 * Modular architecture using global variables
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
    window.VSC.logger.debug(`runAction Begin: ${action}`);

    const mediaTags = this.config.getMediaElements();

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

    window.VSC.logger.debug('runAction End');
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

      case 'faster':
        window.VSC.logger.debug('Increase speed');
        this.adjustSpeed(video, value, { relative: true });
        break;

      case 'slower':
        window.VSC.logger.debug('Decrease speed');
        this.adjustSpeed(video, -value, { relative: true });
        break;

      case 'reset':
        window.VSC.logger.debug('Reset speed');
        this.resetSpeed(video, 1.0);
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

        // Clear inline fallback styles to prevent conflicts with CSS classes
        if (controller.classList.contains('vsc-manual')) {
          controller.style.removeProperty('display');
          controller.style.removeProperty('visibility');
          controller.style.removeProperty('opacity');
          window.VSC.logger.debug('Cleared inline fallback styles for manual toggle');
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
        this.adjustSpeed(video, value);
        break;

      case 'ADJUST_SPEED':
        window.VSC.logger.info('Adjusting speed by:', value);
        this.adjustSpeed(video, value, { relative: true });
        break;

      case 'RESET_SPEED': {
        window.VSC.logger.info('Resetting speed');
        const preferredSpeed = this.config.getSpeedStep('fast');
        this.adjustSpeed(video, preferredSpeed);
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
   * Reset speed with toggle functionality
   * @param {HTMLMediaElement} video - Video element
   * @param {number} target - Target speed
   */
  resetSpeed(video, target) {
    if (video.playbackRate === target) {
      if (video.playbackRate === this.config.getKeyBinding('reset')) {
        if (target !== 1.0) {
          window.VSC.logger.info('Resetting playback speed to 1.0');
          this.adjustSpeed(video, 1.0);
        } else {
          window.VSC.logger.info('Toggling playback speed to "fast" speed');
          this.adjustSpeed(video, this.config.getKeyBinding('fast'));
        }
      } else {
        window.VSC.logger.info('Toggling playback speed to "reset" speed');
        this.adjustSpeed(video, this.config.getKeyBinding('reset'));
      }
    } else {
      window.VSC.logger.info('Toggling playback speed to "reset" speed');
      this.config.setKeyBinding('reset', video.playbackRate);
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

    if (controller.classList.contains('vsc-hidden') || controller.blinkTimeOut !== undefined) {
      clearTimeout(controller.blinkTimeOut);
      controller.classList.remove('vsc-hidden');

      // For audio controllers, don't set timeout to hide again
      if (!isAudioController) {
        controller.blinkTimeOut = setTimeout(
          () => {
            controller.classList.add('vsc-hidden');
            controller.blinkTimeOut = undefined;
          },
          duration ? duration : 1000
        );
      } else {
        window.VSC.logger.debug('Audio controller blink - keeping visible');
      }
    }
  }

  /**
   * Check if controller is associated with an audio element
   * @param {HTMLElement} controller - Controller element
   * @returns {boolean} True if associated with audio element
   * @private
   */
  isAudioController(controller) {
    // Find associated media element
    const mediaElements = this.config.getMediaElements();
    for (const media of mediaElements) {
      if (media.vsc && media.vsc.div === controller) {
        return media.tagName === 'AUDIO';
      }
    }
    return false;
  }

  /**
   * Adjust video playback speed (absolute or relative)
   *
   * @param {HTMLMediaElement} video - Target video element
   * @param {number} value - Speed value (absolute) or delta (relative)
   * @param {Object} options - Configuration options
   * @param {boolean} options.relative - If true, value is a delta; if false, absolute speed
   * @param {string} options.source - 'internal' (user action) or 'external' (site/other)
   */
  adjustSpeed(video, value, options = {}) {
    const { relative = false, source = 'internal' } = options;

    // Validate input
    if (!video || !video.vsc) {
      window.VSC.logger.warn('adjustSpeed called on video without controller');
      return;
    }

    if (typeof value !== 'number' || isNaN(value)) {
      window.VSC.logger.warn('adjustSpeed called with invalid value:', value);
      return;
    }

    // Calculate target speed
    let targetSpeed;
    if (relative) {
      // For relative changes, add to current speed
      const currentSpeed = video.playbackRate < 0.1 ? 0.0 : video.playbackRate;
      targetSpeed = currentSpeed + value;
    } else {
      // For absolute changes, use value directly
      targetSpeed = value;
    }

    // Clamp to valid range
    targetSpeed = Math.min(
      Math.max(targetSpeed, window.VSC.Constants.SPEED_LIMITS.MIN),
      window.VSC.Constants.SPEED_LIMITS.MAX
    );

    // Round to 2 decimal places to avoid floating point issues
    targetSpeed = Number(targetSpeed.toFixed(2));

    // Handle force mode for external changes
    if (source === 'external' && this.config.settings.forceLastSavedSpeed) {
      // In force mode, reject external changes by restoring user preference
      targetSpeed = this._getUserPreferredSpeed(video);
      window.VSC.logger.debug(`Force mode: blocking external change, restoring to ${targetSpeed}`);
    }

    // Apply the speed change
    this._commitSpeedChange(video, targetSpeed, source);
  }

  /**
   * Get user's preferred speed for a video based on settings
   * @param {HTMLMediaElement} video - Video element
   * @returns {number} Preferred speed
   * @private
   */
  _getUserPreferredSpeed(video) {
    if (this.config.settings.rememberSpeed) {
      // Global mode - use lastSpeed for all videos
      return this.config.settings.lastSpeed || 1.0;
    } else {
      // Per-video mode - use stored speed for this specific video
      const videoSrc = video.currentSrc || video.src;
      return this.config.settings.speeds[videoSrc] || 1.0;
    }
  }

  /**
   * Apply speed change and update all state
   * @param {HTMLMediaElement} video - Video element
   * @param {number} speed - Target speed
   * @param {string} source - Change source ('internal' or 'external')
   * @private
   */
  _commitSpeedChange(video, speed, source) {
    window.VSC.logger.debug(`Committing speed change: ${speed} (source: ${source})`);

    // 1. Set the actual playback rate
    video.playbackRate = speed;

    // 2. Dispatch synthetic event with origin marker
    video.dispatchEvent(
      new CustomEvent('ratechange', {
        bubbles: true,
        composed: true,
        detail: {
          origin: 'videoSpeed',
          speed: window.VSC.Constants.formatSpeed(speed),
          source: source,
        },
      })
    );

    // 3. Update UI
    const speedIndicator = video.vsc?.speedIndicator;
    if (speedIndicator) {
      speedIndicator.textContent = window.VSC.Constants.formatSpeed(speed);
    }

  // 4. Update settings based on rememberSpeed
  const videoSrc = video.currentSrc || video.src || '';
    if (this.config.settings.rememberSpeed) {
      // Global mode - update lastSpeed
      this.config.settings.lastSpeed = speed;
    } else {
      // Per-video mode - store in memory only (not persisted)
      if (videoSrc) {
        this.config.settings.speeds[videoSrc] = speed;
      }
    }

    // Always update lastSpeed for UI consistency
    this.config.settings.lastSpeed = speed;

    // 5. Save to storage (only global lastSpeed)
    this.config.save({
      lastSpeed: this.config.settings.lastSpeed,
    });

    // 6. Show controller briefly if hidden
    if (video.vsc?.div) {
      this.blinkController(video.vsc.div);
    }

    // 7. Refresh cooldown to prevent rapid changes
    if (this.eventManager) {
      this.eventManager.refreshCoolDown();
    }
  }
}

// Create singleton instance
window.VSC.ActionHandler = ActionHandler;
