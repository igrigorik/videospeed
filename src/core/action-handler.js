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

      case 'faster': {
        window.VSC.logger.debug('Increase speed');
        const fasterSpeed = Math.min(
          (video.playbackRate < 0.1 ? 0.0 : video.playbackRate) + value,
          window.VSC.Constants.SPEED_LIMITS.MAX
        );
        this.setSpeed(video, fasterSpeed);
        break;
      }

      case 'slower': {
        window.VSC.logger.debug('Decrease speed');
        const slowerSpeed = Math.max(
          video.playbackRate - value,
          window.VSC.Constants.SPEED_LIMITS.MIN
        );
        this.setSpeed(video, slowerSpeed);
        break;
      }

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

      case 'SET_SPEED': {
        const speed = value;
        if (
          typeof speed === 'number' &&
          speed > 0 &&
          speed <= window.VSC.Constants.SPEED_LIMITS.MAX
        ) {
          window.VSC.logger.log('Setting speed to:', speed);
          this.setSpeed(video, speed);
        } else {
          window.VSC.logger.warn('Invalid speed value:', speed);
        }
        break;
      }

      case 'ADJUST_SPEED': {
        const delta = value;
        if (typeof delta === 'number') {
          window.VSC.logger.log('Adjusting speed by:', delta);
          this.adjustSpeed(delta);
        } else {
          window.VSC.logger.warn('Invalid delta value:', delta);
        }
        break;
      }

      case 'RESET_SPEED': {
        window.VSC.logger.log('Resetting speed');
        const preferredSpeed = this.config.getSpeedStep('fast');
        this.setSpeed(video, preferredSpeed);
        break;
      }

      default:
        window.VSC.logger.warn(`Unknown action: ${action}`);
    }
  }

  /**
   * Set video playback speed
   * @param {HTMLMediaElement} video - Video element
   * @param {number} speed - Speed to set
   */
  setSpeed(video, speed) {
    window.VSC.logger.debug(`setSpeed started: ${speed}`);

    const speedValue = speed.toFixed(2);
    const numericSpeed = Number(speedValue);

    if (this.config.settings.forceLastSavedSpeed) {
      video.dispatchEvent(
        new CustomEvent('ratechange', {
          bubbles: true,
          composed: true,
          detail: { origin: 'videoSpeed', speed: speedValue },
        })
      );
    } else {
      video.playbackRate = numericSpeed;
    }

    const speedIndicator = video.vsc.speedIndicator;
    if (!speedIndicator) {
      window.VSC.logger.warn(
        'Cannot update speed indicator: video controller UI not fully initialized'
      );
      return;
    }
    speedIndicator.textContent = numericSpeed.toFixed(2);

    // Update settings
    this.config.settings.lastSpeed = numericSpeed;

    // Store per-video speed if rememberSpeed is enabled
    if (this.config.settings.rememberSpeed) {
      const videoSrc = video.currentSrc || video.src;
      if (videoSrc) {
        this.config.settings.speeds[videoSrc] = numericSpeed;
        window.VSC.logger.debug(`Stored speed ${numericSpeed} for video: ${videoSrc}`);
      }
    }

    // Save settings to storage for persistence
    this.config.save({
      lastSpeed: this.config.settings.lastSpeed,
      speeds: this.config.settings.speeds,
    });

    this.eventManager.refreshCoolDown();

    window.VSC.logger.debug(`setSpeed finished: ${speed}`);
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
          this.setSpeed(video, 1.0);
        } else {
          window.VSC.logger.info('Toggling playback speed to "fast" speed');
          this.setSpeed(video, this.config.getKeyBinding('fast'));
        }
      } else {
        window.VSC.logger.info('Toggling playback speed to "reset" speed');
        this.setSpeed(video, this.config.getKeyBinding('reset'));
      }
    } else {
      window.VSC.logger.info('Toggling playback speed to "reset" speed');
      this.config.setKeyBinding('reset', video.playbackRate);
      this.setSpeed(video, target);
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
   * Adjust speed
   * @param {number} delta - Amount to adjust
   */
  adjustSpeed(delta) {
    const video = this.config.getMediaElements()[0];
    if (video) {
      const currentSpeed = video.playbackRate;
      const newSpeed = Math.min(
        Math.max(currentSpeed + delta, window.VSC.Constants.SPEED_LIMITS.MIN),
        window.VSC.Constants.SPEED_LIMITS.MAX
      );
      this.setSpeed(video, newSpeed);
    }
  }
}

// Create singleton instance
window.VSC.ActionHandler = ActionHandler;

// Global variables available for both browser and testing
