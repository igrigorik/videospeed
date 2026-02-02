/**
 * Video Speed Controller - Main Content Script
 * Modular architecture using global variables loaded via script array
 */

class VideoSpeedExtension {
  constructor() {
    this.config = null;
    this.actionHandler = null;
    this.eventManager = null;
    this.mutationObserver = null;
    this.mediaObserver = null;
    this.initialized = false;
  }

  /**
   * Initialize the extension
   */
  async initialize() {
    try {
      // Access global modules
      this.VideoController = window.VSC.VideoController;
      this.ActionHandler = window.VSC.ActionHandler;
      this.EventManager = window.VSC.EventManager;
      this.logger = window.VSC.logger;
      this.initializeWhenReady = window.VSC.DomUtils.initializeWhenReady;
      this.siteHandlerManager = window.VSC.siteHandlerManager;
      this.VideoMutationObserver = window.VSC.VideoMutationObserver;
      this.MediaElementObserver = window.VSC.MediaElementObserver;
      this.MESSAGE_TYPES = window.VSC.Constants.MESSAGE_TYPES;

      this.logger.info('Video Speed Controller starting...');

      this.config = window.VSC.videoSpeedConfig;
      await this.config.load();

      // Initialize site handler
      this.siteHandlerManager.initialize(document);

      // Create action handler and event manager
      this.eventManager = new this.EventManager(this.config, null);
      this.actionHandler = new this.ActionHandler(this.config, this.eventManager);
      this.eventManager.actionHandler = this.actionHandler; // Set circular reference

      // Set up observers
      this.setupObservers();

      // Initialize when document is ready
      this.initializeWhenReady(document, (doc) => {
        this.initializeDocument(doc);
      });

      this.logger.info('Video Speed Controller initialized successfully');
      this.initialized = true;
    } catch (error) {
      console.error(`❌ Failed to initialize Video Speed Controller: ${error.message}`);
      console.error('📋 Full error details:', error);
      console.error('🔍 Error stack:', error.stack);
    }
  }

  /**
 * Initialize for a specific document
 * @param {Document} document - Document to initialize
 */
  initializeDocument(document) {
    try {
      if (window.VSC.initialized) {
        return;
      }

      window.VSC.initialized = true;

      this.applyDomainStyles(document);
      this.eventManager.setupEventListeners(document);
      if (document !== window.document) {
        this.setupDocumentCSS(document);
      }

      this.deferExpensiveOperations(document);
      this.logger.debug('Document initialization completed');
    } catch (error) {
      this.logger.error(`Failed to initialize document: ${error.message}`);
    }
  }

  /**
   * Defer expensive operations to avoid blocking page load
   * @param {Document} document - Document to defer operations for
   */
  deferExpensiveOperations(document) {
    // Use requestIdleCallback with a longer timeout to avoid blocking critical page load
    const callback = () => {
      try {
        // Start mutation observer after page load is complete
        if (this.mutationObserver) {
          this.mutationObserver.start(document);
          this.logger.debug('Mutation observer started for document');
        }

        // Defer media scanning to avoid blocking page load
        this.deferredMediaScan(document);
      } catch (error) {
        this.logger.error(`Failed to complete deferred operations: ${error.message}`);
      }
    };

    // Use requestIdleCallback if available, with reasonable timeout
    if (window.requestIdleCallback) {
      requestIdleCallback(callback, { timeout: 2000 });
    } else {
      // Fallback for browsers without requestIdleCallback
      setTimeout(callback, 100);
    }
  }

  /**
   * Perform media scanning in a non-blocking way
   * @param {Document} document - Document to scan
   */
  deferredMediaScan(document) {
    // Split media scanning into smaller chunks to avoid blocking
    const performChunkedScan = () => {
      try {
        // Use a lighter initial scan - avoid expensive shadow DOM traversal initially
        const lightMedia = this.mediaObserver.scanForMediaLight(document);

        lightMedia.forEach((media) => {
          this.onVideoFound(media, media.parentElement || media.parentNode);
        });

        this.logger.info(
          `Attached controllers to ${lightMedia.length} media elements (light scan)`
        );

        // Schedule comprehensive scan for later if needed
        if (lightMedia.length === 0) {
          this.scheduleComprehensiveScan(document);
        }
      } catch (error) {
        this.logger.error(`Failed to scan media elements: ${error.message}`);
      }
    };

    // Use requestIdleCallback for the scan as well
    if (window.requestIdleCallback) {
      requestIdleCallback(performChunkedScan, { timeout: 3000 });
    } else {
      setTimeout(performChunkedScan, 200);
    }
  }

  /**
   * Schedule a comprehensive scan if the light scan didn't find anything
   * @param {Document} document - Document to scan comprehensively
   */
  scheduleComprehensiveScan(document) {
    // Only do comprehensive scan if we didn't find any media with light scan
    setTimeout(() => {
      try {
        const comprehensiveMedia = this.mediaObserver.scanAll(document);

        comprehensiveMedia.forEach((media) => {
          // Skip if already has controller
          if (!media.vsc) {
            this.onVideoFound(media, media.parentElement || media.parentNode);
          }
        });

        this.logger.info(
          `Comprehensive scan found ${comprehensiveMedia.length} additional media elements`
        );
      } catch (error) {
        this.logger.error(`Failed comprehensive media scan: ${error.message}`);
      }
    }, 1000); // Wait 1 second before comprehensive scan
  }

  /**
 * Apply domain-specific styles using CSS custom properties
 * Sets CSS custom property on :root to enable CSS-based domain targeting
 * @param {Document} document - Document to apply styles to
 */
  applyDomainStyles(document) {
    try {
      const hostname = window.location.hostname;
      if (document.documentElement) {
        document.documentElement.style.setProperty('--vsc-domain', `"${hostname}"`);
      }
    } catch (error) {
      this.logger.error(`Failed to apply domain styles: ${error.message}`);
    }
  }

  /**
   * Set up observers for DOM changes and video detection
   */
  setupObservers() {
    // Media element observer
    this.mediaObserver = new this.MediaElementObserver(this.config, this.siteHandlerManager);

    // Mutation observer for dynamic content
    this.mutationObserver = new this.VideoMutationObserver(
      this.config,
      (video, parent) => this.onVideoFound(video, parent),
      (video) => this.onVideoRemoved(video),
      this.mediaObserver
    );
  }

  /**
   * Handle newly found video element
   * @param {HTMLMediaElement} video - Video element
   * @param {HTMLElement} parent - Parent element
   */
  onVideoFound(video, parent) {
    try {
      if (this.mediaObserver && !this.mediaObserver.isValidMediaElement(video)) {
        this.logger.debug('Video element is not valid for controller attachment');
        return;
      }

      if (video.vsc) {
        this.logger.debug('Video already has controller attached');
        return;
      }

      // Check if controller should start hidden based on video visibility/size
      const shouldStartHidden = this.mediaObserver
        ? this.mediaObserver.shouldStartHidden(video)
        : false;

      this.logger.debug(
        'Attaching controller to new video element',
        shouldStartHidden ? '(starting hidden)' : ''
      );
      video.vsc = new this.VideoController(
        video,
        parent,
        this.config,
        this.actionHandler,
        shouldStartHidden
      );
    } catch (error) {
      console.error('💥 Failed to attach controller to video:', error);
      this.logger.error(`Failed to attach controller to video: ${error.message}`);
    }
  }

  /**
   * Handle removed video element
   * @param {HTMLMediaElement} video - Video element
   */
  onVideoRemoved(video) {
    try {
      if (video.vsc) {
        this.logger.debug('Removing controller from video element');
        video.vsc.remove();
      }
    } catch (error) {
      this.logger.error(`Failed to remove video controller: ${error.message}`);
    }
  }

  /**
   * Set up CSS for iframe documents
   * @param {Document} document - Document to set up CSS for
   */
  setupDocumentCSS(document) {
    const link = document.createElement('link');
    link.href =
      typeof chrome !== 'undefined' && chrome.runtime
        ? chrome.runtime.getURL('src/styles/inject.css')
        : '/src/styles/inject.css';
    link.type = 'text/css';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    this.logger.debug('CSS injected into iframe document');
  }

}

// Initialize extension and message handlers in an IIFE to avoid global scope pollution
(function () {
  // Create and initialize extension instance
  const extension = new VideoSpeedExtension();

  // Message handler for popup communication via bridge
  // Listen for messages from content script bridge
  window.addEventListener('VSC_MESSAGE', (event) => {
    const message = event.detail;

    // Handle namespaced VSC message types
    if (typeof message === 'object' && message.type && message.type.startsWith('VSC_')) {
      // Use state manager for complete media element discovery (includes shadow DOM)
      const videos = window.VSC.stateManager ? window.VSC.stateManager.getAllMediaElements() : [];

      switch (message.type) {
        case window.VSC.Constants.MESSAGE_TYPES.SET_SPEED:
          if (message.payload && typeof message.payload.speed === 'number') {
            const targetSpeed = message.payload.speed;
            videos.forEach((video) => {
              if (video.vsc) {
                extension.actionHandler.adjustSpeed(video, targetSpeed);
              } else {
                video.playbackRate = targetSpeed;
              }
            });

            // Log the successful operation
            window.VSC.logger?.debug(`Set speed to ${targetSpeed} on ${videos.length} media elements`);
          }
          break;

        case window.VSC.Constants.MESSAGE_TYPES.ADJUST_SPEED:
          if (message.payload && typeof message.payload.delta === 'number') {
            const delta = message.payload.delta;
            videos.forEach((video) => {
              if (video.vsc) {
                extension.actionHandler.adjustSpeed(video, delta, { relative: true });
              } else {
                // Fallback for videos without controller
                const newSpeed = Math.min(Math.max(video.playbackRate + delta, 0.07), 16);
                video.playbackRate = newSpeed;
              }
            });

            window.VSC.logger?.debug(`Adjusted speed by ${delta} on ${videos.length} media elements`);
          }
          break;

        case window.VSC.Constants.MESSAGE_TYPES.RESET_SPEED:
          videos.forEach((video) => {
            if (video.vsc) {
              extension.actionHandler.resetSpeed(video, 1.0);
            } else {
              video.playbackRate = 1.0;
            }
          });

          window.VSC.logger?.debug(`Reset speed on ${videos.length} media elements`);
          break;

        case window.VSC.Constants.MESSAGE_TYPES.TOGGLE_DISPLAY:
          if (extension.actionHandler) {
            extension.actionHandler.runAction('display', null, null);
          }
          break;
      }
    }
  });

  // Prevent double injection
  if (window.VSC_controller && window.VSC_controller.initialized) {
    window.VSC.logger?.info('VSC already initialized, skipping re-injection');
    return;
  }

  // Auto-initialize
  extension.initialize().catch((error) => {
    console.error(`Extension initialization failed: ${error.message}`);
    window.VSC.logger.error(`Extension initialization failed: ${error.message}`);
  });

  // Export only what's needed with consistent VSC_ prefix
  window.VSC_controller = extension;  // The initialized instance
})();
