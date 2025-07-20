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

    // Initialize speed
    this.initializeSpeed();

    // Create UI
    this.div = this.initializeControls();

    // Set up event handlers
    this.setupEventHandlers();

    // Set up mutation observer for src changes
    this.setupMutationObserver();

    // Attach controller to video element
    target.vsc = this;

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
    let targetSpeed = 1.0; // Default speed

    // Check if we should use per-video stored speeds
    const videoSrc = this.video.currentSrc || this.video.src;
    const storedVideoSpeed = this.config.settings.speeds[videoSrc];

    if (this.config.settings.rememberSpeed) {
      if (storedVideoSpeed) {
        window.VSC.logger.debug(`Using stored speed for video: ${storedVideoSpeed}`);
        targetSpeed = storedVideoSpeed;
      } else if (this.config.settings.lastSpeed) {
        window.VSC.logger.debug(`Using lastSpeed: ${this.config.settings.lastSpeed}`);
        targetSpeed = this.config.settings.lastSpeed;
      }

      // Reset speed isn't really a reset, it's a toggle to stored speed
      this.config.setKeyBinding('reset', targetSpeed);
    } else {
      window.VSC.logger.debug('rememberSpeed disabled - using 1.0x speed');
      targetSpeed = 1.0;
      // Reset speed toggles to fast speed when rememberSpeed is disabled
      this.config.setKeyBinding('reset', this.config.getKeyBinding('fast'));
    }

    window.VSC.logger.debug(`Setting initial playbackRate to: ${targetSpeed}`);

    // Apply the speed immediately if forceLastSavedSpeed is enabled
    if (this.config.settings.forceLastSavedSpeed && targetSpeed !== 1.0) {
      window.VSC.logger.debug('forceLastSavedSpeed enabled - dispatching ratechange event');
      this.video.dispatchEvent(
        new CustomEvent('ratechange', {
          bubbles: true,
          composed: true,
          detail: { origin: 'videoSpeed', speed: targetSpeed.toFixed(2) },
        })
      );
    } else {
      this.video.playbackRate = targetSpeed;
    }
  }

  /**
   * Initialize video controller UI
   * @returns {HTMLElement} Controller wrapper element
   * @private
   */
  initializeControls() {
    window.VSC.logger.debug('initializeControls Begin');

    const document = this.video.ownerDocument;
    const speed = this.video.playbackRate.toFixed(2);
    const position = window.VSC.ShadowDOMManager.calculatePosition(this.video);

    window.VSC.logger.debug(`Speed variable set to: ${speed}`);

    // Create wrapper element
    const wrapper = document.createElement('div');
    wrapper.classList.add('vsc-controller');

    // Set positioning styles with calculated position
    // Use inline styles without !important so CSS rules can override
    wrapper.style.cssText = `
      position: absolute !important;
      z-index: 9999999 !important;
      top: ${position.top};
      left: ${position.left};
    `;

    // Only hide controller if video has no source AND is not ready/functional
    // This prevents hiding controllers for live streams or dynamically loaded videos
    if (!this.video.currentSrc && !this.video.src && this.video.readyState < 2) {
      wrapper.classList.add('vsc-nosource');
    }

    if (this.config.settings.startHidden || this.shouldStartHidden) {
      wrapper.classList.add('vsc-hidden');
      if (this.shouldStartHidden) {
        window.VSC.logger.debug('Starting controller hidden due to video visibility/size');
      }
    } else {
      // Ensure controller is visible, especially on YouTube
      wrapper.classList.add('vcs-show');
    }

    // Create shadow DOM with relative positioning inside shadow root
    const shadow = window.VSC.ShadowDOMManager.createShadowDOM(wrapper, {
      top: '0px', // Position relative to shadow root since wrapper is already positioned
      left: '0px', // Position relative to shadow root since wrapper is already positioned
      speed: speed,
      opacity: this.config.settings.controllerOpacity,
      buttonSize: this.config.settings.controllerButtonSize,
    });

    // Set up control events
    this.controlsManager.setupControlEvents(shadow, this.video);

    // Store speed indicator reference
    this.speedIndicator = window.VSC.ShadowDOMManager.getSpeedIndicator(shadow);

    // Insert into DOM based on site-specific rules
    this.insertIntoDOM(document, wrapper);

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
  }

  /**
   * Set up event handlers for media events
   * @private
   */
  setupEventHandlers() {
    const mediaEventAction = (event) => {
      let storedSpeed = this.config.settings.speeds[event.target.currentSrc];

      if (!this.config.settings.rememberSpeed) {
        if (!storedSpeed) {
          window.VSC.logger.info('Overwriting stored speed to 1.0 (rememberSpeed not enabled)');
          storedSpeed = 1.0;
        }
        window.VSC.logger.debug('Setting reset keybinding to fast');
        this.config.setKeyBinding('reset', this.config.getKeyBinding('fast'));
      } else {
        window.VSC.logger.debug('Storing lastSpeed into settings (rememberSpeed enabled)');
        storedSpeed = this.config.settings.lastSpeed;
      }

      window.VSC.logger.info(`Explicitly setting playbackRate to: ${storedSpeed}`);
      this.actionHandler.setSpeed(event.target, storedSpeed);
    };

    this.handlePlay = mediaEventAction.bind(this);
    this.handleSeek = mediaEventAction.bind(this);

    this.video.addEventListener('play', this.handlePlay);
    this.video.addEventListener('seeked', this.handleSeek);
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

    // Disconnect mutation observer
    if (this.targetObserver) {
      this.targetObserver.disconnect();
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
    if (isVisible && isCurrentlyHidden && !this.div.classList.contains('vsc-manual')) {
      // Video became visible and controller is hidden (but not manually hidden)
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
