/**
 * Video Controller class for managing individual video elements
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

class VideoController {
  constructor(target, parent, config, actionHandler, shouldStartHidden = false) {
    // Return existing controller if already attached
    if (target.vsc) {
      return target.vsc;
    }

    this.video = target;
    this.parent = target.parentElement || parent;
    this.config = config;
    this.actionHandler = actionHandler;
    this.controlsManager = new window.VSC.ControlsManager(actionHandler, config);
    this.shouldStartHidden = shouldStartHidden;

    // Generate unique controller ID for badge tracking
    this.controllerId = this.generateControllerId(target);

    // Add to tracked media elements
    config.addMediaElement(target);

    // Attach controller to video element first (needed for adjustSpeed)
    target.vsc = this;

  // Internal enforcement timer for stubborn players that reset playbackRate
  this._enforceTimer = null;
  this._enforceUntil = 0;

    // Initialize speed
    this.initializeSpeed();

    // Create UI
    this.div = this.initializeControls();

    // Set up event handlers
    this.setupEventHandlers();

    // Set up mutation observer for src changes
    this.setupMutationObserver();

    window.VSC.logger.info('VideoController initialized for video element');

    // Dispatch controller created event for badge management
    this.dispatchControllerEvent('VSC_CONTROLLER_CREATED', {
      controllerId: this.controllerId,
      videoSrc: this.video.currentSrc || this.video.src,
      tagName: this.video.tagName,
    });
  }

  /**
   * Initialize video speed based on settings
   * @private
   */
  initializeSpeed() {
    const targetSpeed = this.getTargetSpeed();

    window.VSC.logger.debug(`Setting initial playbackRate to: ${targetSpeed} (current: ${this.video.playbackRate})`);

    // Always set speed if we have an action handler, regardless of current playback rate
    // This ensures the speed is properly initialized and the UI stays in sync
    if (this.actionHandler) {
      window.VSC.logger.debug('Setting initial speed via adjustSpeed');
      this.actionHandler.adjustSpeed(this.video, targetSpeed, { source: 'internal' });
    } else {
      // Fallback: set playback rate directly if no action handler
      window.VSC.logger.debug('No action handler, setting playbackRate directly');
      this.video.playbackRate = targetSpeed;
    }
  }

  /**
   * Get target speed based on rememberSpeed setting and update reset binding
   * @param {HTMLMediaElement} media - Optional media element (defaults to this.video)
   * @returns {number} Target speed
   * @private
   */
  getTargetSpeed(media = this.video) {
    let targetSpeed;

    if (this.config.settings.rememberSpeed) {
      // Global behavior - use lastSpeed for all videos
      targetSpeed = this.config.settings.lastSpeed || 1.0;
      window.VSC.logger.debug(`Global mode: using lastSpeed ${targetSpeed}`);
    } else {
      // Per-video behavior - use stored speed for this specific video
      const videoSrc = media.currentSrc || media.src;
      const storedSpeed = this.config.settings.speeds[videoSrc];
      targetSpeed = storedSpeed || 1.0;
      window.VSC.logger.debug(`Per-video mode: using speed ${targetSpeed} for ${videoSrc}`);
    }

    return targetSpeed;
  }

  /**
   * Initialize video controller UI
   * @returns {HTMLElement} Controller wrapper element
   * @private
   */
  initializeControls() {
    window.VSC.logger.debug('initializeControls Begin');

    const document = this.video.ownerDocument;
  // For the UI indicator, reflect the actual current playback rate
  // This avoids showing a target speed before it has been applied
  const speed = window.VSC.Constants.formatSpeed(this.video.playbackRate);
    
  // Get position based on user preference
  const userPosition = this.config.settings.controllerPosition || 'top-left';
  const baseRect = (this.video.offsetParent && this.video.offsetParent.getBoundingClientRect && this.video.offsetParent.getBoundingClientRect()) || null;
  const position = window.VSC.ShadowDOMManager.calculatePosition(this.video, userPosition, baseRect);

  window.VSC.logger.debug(`Speed variable set to: ${speed}`);

    // Create wrapper element
    const wrapper = document.createElement('div');

  // Apply all CSS classes at once to prevent race condition flash
  const cssClasses = ['vsc-controller', `vsc-position-${userPosition}`];

    // Only hide controller if video has no source AND is not ready/functional
    // This prevents hiding controllers for live streams or dynamically loaded videos
    if (!this.video.currentSrc && !this.video.src && this.video.readyState < 2) {
      cssClasses.push('vsc-nosource');
    }

    if (this.config.settings.startHidden || this.shouldStartHidden) {
      cssClasses.push('vsc-hidden');
      if (this.shouldStartHidden) {
        window.VSC.logger.debug('Starting controller hidden due to video visibility/size');
      } else {
        window.VSC.logger.info(
          `Controller starting hidden due to startHidden setting: ${this.config.settings.startHidden}`
        );
      }
    }
    // When startHidden=false, use natural visibility (no special class needed)

    // Apply all classes at once to prevent visible flash
    wrapper.className = cssClasses.join(' ');

    // Set positioning styles with calculated position
    // Use inline styles without !important so CSS rules can override
    let styleText = `
      position: absolute !important;
      z-index: 9999999 !important;
      top: ${position.top};
      left: ${position.left};
    `;

    // Add inline fallback styles if controller should start hidden
    // This prevents FOUC if inject.css hasn't loaded yet
    if (this.config.settings.startHidden || this.shouldStartHidden) {
      styleText += `
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
      `;
      window.VSC.logger.debug('Applied inline fallback styles for hidden controller');
    }

    wrapper.style.cssText = styleText;

    // Create shadow DOM with relative positioning inside shadow root
    const shadow = window.VSC.ShadowDOMManager.createShadowDOM(wrapper, {
      top: '0px', // Position relative to shadow root since wrapper is already positioned
      left: '0px', // Position relative to shadow root since wrapper is already positioned
      speed: speed,
      opacity: this.config.settings.controllerOpacity,
      buttonSize: this.config.settings.controllerButtonSize,
      position: userPosition, // Pass position to shadow DOM
    });

    // Set up control events
    this.controlsManager.setupControlEvents(shadow, this.video);

    // Store speed indicator reference
    this.speedIndicator = window.VSC.ShadowDOMManager.getSpeedIndicator(shadow);

    // Insert into DOM based on site-specific rules
    this.insertIntoDOM(document, wrapper);

    // Debug: Log final classes on controller
    window.VSC.logger.info(`Controller classes after creation: ${wrapper.className}`);

    window.VSC.logger.debug('initializeControls End');
    return wrapper;
  }

  /**
   * Insert controller into DOM with site-specific positioning
   * @param {Document} document - Document object
   * @param {HTMLElement} wrapper - Wrapper element to insert
   * @private
   */
  insertIntoDOM(document, wrapper) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(wrapper);

    // Get site-specific positioning information
    const positioning = window.VSC.siteHandlerManager.getControllerPosition(
      this.parent,
      this.video
    );

    switch (positioning.insertionMethod) {
      case 'beforeParent':
        positioning.insertionPoint.parentElement.insertBefore(fragment, positioning.insertionPoint);
        break;

      case 'afterParent':
        positioning.insertionPoint.parentElement.insertBefore(
          fragment,
          positioning.insertionPoint.nextSibling
        );
        break;

      case 'firstChild':
      default:
        positioning.insertionPoint.insertBefore(fragment, positioning.insertionPoint.firstChild);
        break;
    }

    window.VSC.logger.debug(`Controller inserted using ${positioning.insertionMethod} method`);

    // After insertion, re-calc position now that sizes are known (ensures bottom stacking accuracy)
    try {
      this.updateControllerPosition();
      // Also schedule a microtask + next frame to catch late style calculations
      queueMicrotask(() => {
        this.updateControllerPosition();
        const raf = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : (cb) => setTimeout(cb, 16);
        raf(() => this.updateControllerPosition());
      });
    } catch (_) {
      // non-fatal
    }
  }

  /**
   * Set up event handlers for media events
   * @private
   */
  setupEventHandlers() {
    const mediaEventAction = (event) => {
      const targetSpeed = this.getTargetSpeed(event.target);

      window.VSC.logger.info(`Media event ${event.type}: restoring speed to ${targetSpeed}`);
      this.actionHandler.adjustSpeed(event.target, targetSpeed, { source: 'internal' });

      // Some players (e.g., YouTube) keep resetting speed around src/load/playing
      // Briefly enforce preferred speed after key lifecycle events
      if (event.type === 'loadstart' || event.type === 'canplay' || event.type === 'play') {
        this.enforceSpeedFor(1500);
      }
    };

    // Bind event handlers
    this.handlePlay = mediaEventAction.bind(this);
    this.handleSeek = mediaEventAction.bind(this);
    this.handleLoadStart = mediaEventAction.bind(this);
    this.handleCanPlay = mediaEventAction.bind(this);

    // Add comprehensive event listeners for robust speed restoration
    this.video.addEventListener('play', this.handlePlay);
    this.video.addEventListener('seeked', this.handleSeek);
    this.video.addEventListener('loadstart', this.handleLoadStart);
    this.video.addEventListener('canplay', this.handleCanPlay);

    // Add resize handler to update controller position (throttled)
    this.handleResize = this.throttle(this.updateControllerPosition.bind(this), 100);
    window.addEventListener('resize', this.handleResize);

    window.VSC.logger.debug(
      'Added comprehensive media event handlers: play, seeked, loadstart, canplay, resize'
    );
  }

  /**
   * Update controller position based on current video bounds and user preference
   * @private
   */
  updateControllerPosition() {
    if (!this.div) return;

  const userPosition = this.config.settings.controllerPosition || 'top-left';
  const baseRect = (this.div?.offsetParent && this.div.offsetParent.getBoundingClientRect && this.div.offsetParent.getBoundingClientRect()) || (this.video.offsetParent && this.video.offsetParent.getBoundingClientRect && this.video.offsetParent.getBoundingClientRect()) || null;
  const position = window.VSC.ShadowDOMManager.calculatePosition(this.video, userPosition, baseRect);

    // Update the wrapper element position
    this.div.style.top = position.top;
    this.div.style.left = position.left;

    window.VSC.logger.debug(`Controller position updated to ${position.top}, ${position.left} for ${userPosition}`);
  }

  /**
   * Throttle function to limit how often a function can be called
   * @param {Function} func - Function to throttle
   * @param {number} limit - Minimum time between calls in milliseconds
   * @returns {Function} Throttled function
   * @private
   */
  throttle(func, limit) {
    let inThrottle;
    return function() {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  /**
   * Set up mutation observer for src attribute changes
   * @private
   */
  setupMutationObserver() {
    this.targetObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          (mutation.attributeName === 'src' || mutation.attributeName === 'currentSrc')
        ) {
          window.VSC.logger.debug('mutation of A/V element');
          const controller = this.div;
          if (!mutation.target.src && !mutation.target.currentSrc) {
            controller.classList.add('vsc-nosource');
          } else {
            controller.classList.remove('vsc-nosource');
            // When a reused video element gets a new source, restore the preferred speed
            try {
              const targetSpeed = this.getTargetSpeed(this.video);
              window.VSC.logger.debug(`Src changed: restoring speed to ${targetSpeed}`);
              this.actionHandler.adjustSpeed(this.video, targetSpeed, { source: 'internal' });
              // And briefly enforce it to override player resets
              this.enforceSpeedFor(1500);
            } catch (e) {
              window.VSC.logger.warn('Failed to restore speed on src change:', e.message);
            }
          }
        }
      });
    });

    this.targetObserver.observe(this.video, {
      attributeFilter: ['src', 'currentSrc'],
    });
  }

  /**
   * Remove controller and clean up
   */
  remove() {
    window.VSC.logger.debug('Removing VideoController');

    // Remove DOM element
    if (this.div && this.div.parentNode) {
      this.div.remove();
    }

    // Remove event listeners
    if (this.handlePlay) {
      this.video.removeEventListener('play', this.handlePlay);
    }
    if (this.handleSeek) {
      this.video.removeEventListener('seeked', this.handleSeek);
    }
    if (this.handleLoadStart) {
      this.video.removeEventListener('loadstart', this.handleLoadStart);
    }
    if (this.handleCanPlay) {
      this.video.removeEventListener('canplay', this.handleCanPlay);
    }
    if (this.handleResize) {
      window.removeEventListener('resize', this.handleResize);
    }

    // Disconnect mutation observer
    if (this.targetObserver) {
      this.targetObserver.disconnect();
    }

    // Clear enforcement timer
    if (this._enforceTimer) {
      clearInterval(this._enforceTimer);
      this._enforceTimer = null;
    }

    // Remove from tracking
    this.config.removeMediaElement(this.video);

    // Remove reference from video element
    delete this.video.vsc;

    window.VSC.logger.debug('VideoController removed successfully');

    // Dispatch controller removed event for badge management
    this.dispatchControllerEvent('VSC_CONTROLLER_REMOVED', {
      controllerId: this.controllerId,
      videoSrc: this.video.currentSrc || this.video.src,
      tagName: this.video.tagName,
    });
  }

  /**
   * Briefly enforce preferred speed to counter player resets
   * @param {number} durationMs - Duration to enforce in milliseconds
   * @private
   */
  enforceSpeedFor(durationMs = 1200) {
    const now = Date.now();
    this._enforceUntil = now + durationMs;

    if (this._enforceTimer) {
      // Timer already running; it will read updated _enforceUntil
      return;
    }

    this._enforceTimer = setInterval(() => {
      if (Date.now() > this._enforceUntil) {
        clearInterval(this._enforceTimer);
        this._enforceTimer = null;
        return;
      }

      try {
        const targetSpeed = this.getTargetSpeed(this.video);
        if (Math.abs((this.video.playbackRate || 0) - targetSpeed) > 0.01) {
          this.actionHandler.adjustSpeed(this.video, targetSpeed, { source: 'internal' });
        }
      } catch (e) {
        // Swallow errors during enforcement window
      }
    }, 200);
  }

  /**
   * Generate unique controller ID for badge tracking
   * @param {HTMLElement} target - Video/audio element
   * @returns {string} Unique controller ID
   * @private
   */
  generateControllerId(target) {
    const timestamp = Date.now();
    const src = target.currentSrc || target.src || 'no-src';
    const tagName = target.tagName.toLowerCase();

    // Create a simple hash from src for uniqueness
    const srcHash = src.split('').reduce((hash, char) => {
      hash = (hash << 5) - hash + char.charCodeAt(0);
      return hash & hash; // Convert to 32-bit integer
    }, 0);

    return `${tagName}-${Math.abs(srcHash)}-${timestamp}`;
  }

  /**
   * Check if the video element is currently visible
   * @returns {boolean} True if video is visible
   */
  isVideoVisible() {
    // Check if video is still connected to DOM
    if (!this.video.isConnected) {
      return false;
    }

    // Check computed style for visibility
    const style = window.getComputedStyle(this.video);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    // Check if video has reasonable dimensions
    const rect = this.video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    return true;
  }

  /**
   * Update controller visibility based on video visibility
   * Called when video visibility changes
   */
  updateVisibility() {
    const isVisible = this.isVideoVisible();
    const isCurrentlyHidden = this.div.classList.contains('vsc-hidden');

    // Special handling for audio elements - don't hide controllers for functional audio
    if (this.video.tagName === 'AUDIO') {
      // For audio, only hide if manually hidden or if audio support is disabled
      if (!this.config.settings.audioBoolean && !isCurrentlyHidden) {
        this.div.classList.add('vsc-hidden');
        window.VSC.logger.debug('Hiding audio controller - audio support disabled');
      } else if (
        this.config.settings.audioBoolean &&
        isCurrentlyHidden &&
        !this.div.classList.contains('vsc-manual')
      ) {
        // Show audio controller if audio support is enabled and not manually hidden
        this.div.classList.remove('vsc-hidden');
        window.VSC.logger.debug('Showing audio controller - audio support enabled');
      }
      return;
    }

    // Original logic for video elements
    if (
      isVisible &&
      isCurrentlyHidden &&
      !this.div.classList.contains('vsc-manual') &&
      !this.config.settings.startHidden
    ) {
      // Video became visible and controller is hidden (but not manually hidden and not set to start hidden)
      this.div.classList.remove('vsc-hidden');
      window.VSC.logger.debug('Showing controller - video became visible');
    } else if (!isVisible && !isCurrentlyHidden) {
      // Video became invisible and controller is visible
      this.div.classList.add('vsc-hidden');
      window.VSC.logger.debug('Hiding controller - video became invisible');
    }
  }

  /**
   * Dispatch controller lifecycle events for badge management
   * @param {string} eventType - Event type (VSC_CONTROLLER_CREATED or VSC_CONTROLLER_REMOVED)
   * @param {Object} detail - Event detail data
   * @private
   */
  dispatchControllerEvent(eventType, detail) {
    try {
      const event = new CustomEvent(eventType, { detail });
      window.dispatchEvent(event);
      window.VSC.logger.debug(
        `Dispatched ${eventType} event for controller ${detail.controllerId}`
      );
    } catch (error) {
      window.VSC.logger.error(`Failed to dispatch ${eventType} event:`, error);
    }
  }
}

// Create singleton instance
window.VSC.VideoController = VideoController;

// Global variables available for both browser and testing
