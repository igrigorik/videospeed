/**
 * Video Speed Controller — Main Content Script
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

      if (this.config.settings._abort) {
        this.logger.debug('Extension disabled on this site — aborting init');
        return;
      }

      // Defer DOM work so the page's framework (e.g. YouTube's Polymer)
      // finishes init before we touch anything.
      this.deferDOMWork(document);
    } catch (error) {
      this.logger.error(`Failed to initialize Video Speed Controller: ${error.message}`);
      this.logger.error(`Error stack: ${error.stack}`);
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
      this.eventManager.setupEventListeners(document);

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
    const callback = () => {
      try {
        // Start mutation observer — catches dynamically added media elements
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

    if (window.requestIdleCallback) {
      requestIdleCallback(callback);
    } else {
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

    if (window.requestIdleCallback) {
      requestIdleCallback(performChunkedScan);
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
   * Defer DOM work via requestIdleCallback to yield to site frameworks
   * before injecting CSS, controllers, and observers.
   */
  deferDOMWork(document) {
    const doWork = () => {
      this.injectControllerCSS();
      this.setupCSSLiveUpdates();
      this.siteHandlerManager.initialize(document);

      this.eventManager = new this.EventManager(this.config, null);
      this.actionHandler = new this.ActionHandler(this.config, this.eventManager);
      this.eventManager.actionHandler = this.actionHandler;

      this.setupObservers();

      this.initializeWhenReady(document, (doc) => {
        this.initializeDocument(doc);
      });

      this.logger.info('Video Speed Controller initialized successfully');
      this.initialized = true;
    };

    if (window.requestIdleCallback) {
      requestIdleCallback(doWork);
    } else {
      setTimeout(doWork, 0);
    }
  }

  /**
   * Resolve domain-based CSS selectors for the current hostname.
   * Matching domains: selector stripped (rule applies). Non-matching: [data-vsc-never].
   */
  preprocessDomainCSS(css) {
    const hostname = location.hostname.replace(/^www\./, '');
    return css.replace(/\[style\*='--vsc-domain:\s*"([^"]+)"'\]/g, (_match, domain) =>
      domain === hostname ? '' : '[data-vsc-never]'
    );
  }

  /**
   * Inject controller CSS via adoptedStyleSheets — zero DOM mutations.
   * Creating <style> elements in <head> triggers Polymer's internal
   * MutationObservers on YouTube, crashing the player ~30% of loads.
   * adoptedStyleSheets is a pure CSSOM API (Chrome 73+, our min is 111).
   */
  injectControllerCSS() {
    try {
      if (this._controllerSheet) {
        return;
      }
      const css = this.config.settings.controllerCSS || window.VSC.Constants.DEFAULT_CONTROLLER_CSS;
      this._controllerSheet = new CSSStyleSheet();
      this._controllerSheet.replaceSync(this.preprocessDomainCSS(css));
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, this._controllerSheet];
    } catch (error) {
      this.logger.error(`Failed to inject controller CSS: ${error.message}`);
    }
  }

  /** Listen for live controllerCSS updates from the options page. */
  setupCSSLiveUpdates() {
    document.documentElement.addEventListener('VSC_STORAGE_CHANGED', (e) => {
      if (e.detail?.controllerCSS?.newValue !== undefined && this._controllerSheet) {
        this._controllerSheet.replaceSync(
          this.preprocessDomainCSS(e.detail.controllerCSS.newValue)
        );
      }
    });
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

      // Defer until readyState >= HAVE_CURRENT_DATA — inserting a controller
      // too early can trigger the site's internal MutationObservers.
      if (video.readyState < 2 && (video.src || video.currentSrc)) {
        this.logger.debug(
          'Deferring controller until loadeddata (readyState=%d)',
          video.readyState
        );
        video.addEventListener('loadeddata', () => this.onVideoFound(video, parent), {
          once: true,
        });
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
      this.logger.error(`Failed to attach controller to video: ${error.message}`);
    }
  }

  /**
   * Tear down the extension: remove all controllers, stop observers, clean up listeners.
   * Counterpart to initialize() — leaves the page as if VSC was never active.
   */
  teardown() {
    if (!this.initialized) {
      return;
    }

    this.logger.info('Tearing down Video Speed Controller');

    // Remove all controllers from tracked media elements
    const videos = window.VSC.stateManager ? window.VSC.stateManager.getAllMediaElements() : [];
    for (const video of videos) {
      this.actionHandler?.resetVolumeBoost(video);
      if (video.vsc) {
        video.vsc.remove();
      }
    }

    // Stop observing DOM for new videos
    if (this.mutationObserver) {
      this.mutationObserver.stop();
      this.mutationObserver = null;
    }

    // Remove keyboard/ratechange listeners
    if (this.eventManager) {
      this.eventManager.cleanup();
      this.eventManager = null;
    }

    // Clean up site-specific handlers
    if (this.siteHandlerManager) {
      this.siteHandlerManager.cleanup();
    }

    // Remove adopted controller CSS
    if (this._controllerSheet && document.adoptedStyleSheets) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (s) => s !== this._controllerSheet
      );
      this._controllerSheet = null;
    }

    this.actionHandler = null;
    this.mediaObserver = null;
    this.initialized = false;
    window.VSC.initialized = false;
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
}

(function () {
  const extension = new VideoSpeedExtension();

  function getPopupTargetMedia() {
    const trackedMedia = window.VSC.stateManager
      ? window.VSC.stateManager.getAllMediaElements()
      : [];
    const discoveredMedia = Array.from(document.querySelectorAll('video, audio'));

    if (trackedMedia.length === 0) {
      return discoveredMedia;
    }

    return Array.from(new Set([...trackedMedia, ...discoveredMedia]));
  }

  // Lifecycle commands from bridge (popup, background, storage changes)
  document.documentElement.addEventListener('VSC_MESSAGE', (event) => {
    const message = event.detail;

    // Handle namespaced VSC message types
    if (typeof message === 'object' && message.type && message.type.startsWith('VSC_')) {
      const videos = getPopupTargetMedia();

      switch (message.type) {
        case window.VSC.Constants.MESSAGE_TYPES.SET_SPEED:
          if (message.payload && typeof message.payload.speed === 'number') {
            const { MIN, MAX } = window.VSC.Constants.SPEED_LIMITS;
            const targetSpeed = Math.min(Math.max(message.payload.speed, MIN), MAX);
            videos.forEach((video) => {
              if (video.vsc) {
                extension.actionHandler.adjustSpeed(video, targetSpeed);
              } else {
                video.playbackRate = targetSpeed;
              }
            });

            // Log the successful operation
            window.VSC.logger?.debug(
              `Set speed to ${targetSpeed} on ${videos.length} media elements`
            );
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
                const { MIN: sMin, MAX: sMax } = window.VSC.Constants.SPEED_LIMITS;
                const newSpeed = Math.min(Math.max(video.playbackRate + delta, sMin), sMax);
                video.playbackRate = newSpeed;
              }
            });

            window.VSC.logger?.debug(
              `Adjusted speed by ${delta} on ${videos.length} media elements`
            );
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

        case window.VSC.Constants.MESSAGE_TYPES.SET_VOLUME:
          if (message.payload && typeof message.payload.level === 'number') {
            const { MIN, MAX } = window.VSC.Constants.VOLUME_LIMITS;
            const targetLevel = Math.min(Math.max(message.payload.level, MIN), MAX);
            videos.forEach((video) => {
              if (extension.actionHandler) {
                extension.actionHandler.setVolumeLevel(video, targetLevel);
              } else {
                video.volume = Math.min(targetLevel, 1);
              }
            });

            window.VSC.logger?.debug(
              `Set volume to ${targetLevel} on ${videos.length} media elements`
            );
          }
          break;

        case window.VSC.Constants.MESSAGE_TYPES.ADJUST_VOLUME:
          if (message.payload && typeof message.payload.delta === 'number') {
            const delta = message.payload.delta;
            videos.forEach((video) => {
              if (extension.actionHandler) {
                extension.actionHandler.setVolumeLevel(
                  video,
                  extension.actionHandler.getVolumeLevel(video) + delta
                );
              } else {
                video.volume = Math.min(Math.max(video.volume + delta, 0), 1);
              }
            });

            window.VSC.logger?.debug(
              `Adjusted volume by ${delta} on ${videos.length} media elements`
            );
          }
          break;

        case window.VSC.Constants.MESSAGE_TYPES.GET_VOLUME_STATE: {
          const primaryMedia = videos[0] || null;
          const payload = extension.actionHandler
            ? extension.actionHandler.getVolumeState(primaryMedia)
            : {
                hasMedia: false,
                level: 1,
                percent: 100,
                maxLevel: window.VSC.Constants.VOLUME_LIMITS.MAX,
              };

          document.documentElement.dispatchEvent(
            new CustomEvent('VSC_MESSAGE_RESPONSE', {
              detail: {
                requestId: message.requestId,
                payload,
              },
            })
          );
          break;
        }

        case window.VSC.Constants.MESSAGE_TYPES.TOGGLE_DISPLAY:
          if (extension.actionHandler) {
            extension.actionHandler.runAction('display', null, null);
          }
          break;

        case window.VSC.Constants.MESSAGE_TYPES.TEARDOWN:
          extension.teardown();
          break;

        case window.VSC.Constants.MESSAGE_TYPES.REINIT:
          extension.initialize();
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
    window.VSC.logger.error(`Extension initialization failed: ${error.message}`);
  });

  // Export only what's needed with consistent VSC_ prefix
  window.VSC_controller = extension; // The initialized instance
})();
