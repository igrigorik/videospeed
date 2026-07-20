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

      // Defer DOM work so page frameworks finish init before we mutate.
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
   * Matching domains: selector stripped (rule applies unconditionally).
   * Non-matching: entire rule removed. Stripping (vs neutering with a dead
   * selector) ensures perf-sensitive selectors like [style*=...] inside
   * non-matching rules never reach the browser's style invalidation engine.
   */
  preprocessDomainCSS(css) {
    const hostname = location.hostname.replace(/^www\./, '');
    return css.replace(
      /:root\[style\*='--vsc-domain:\s*"([^"]+)"'\]([^{]*)\{([^}]*)\}/g,
      (match, domain, selector, body) => (domain === hostname ? `${selector.trim()} {${body}}` : '')
    );
  }

  /**
   * Inject controller CSS via adoptedStyleSheets — pure CSSOM, zero DOM
   * mutations. <style> elements trigger page-level MutationObservers on
   * sites with complex frameworks, breaking their internal state.
   *
   * Two separate sheets: _controllerSheet (built-in defaults, domain-
   * preprocessed, never changes at runtime) and _customSheet (user
   * additions, injected raw, live-updatable). Keeps them separate so
   * user CSS edits don't re-preprocess the defaults.
   */
  injectControllerCSS() {
    try {
      if (this._controllerSheet) {
        return;
      }
      this._controllerSheet = new CSSStyleSheet();
      this._controllerSheet.replaceSync(
        this.preprocessDomainCSS(window.VSC.Constants.DEFAULT_CONTROLLER_CSS)
      );
      const toAdopt = [this._controllerSheet];

      const customCSS = this.config.settings.customCSS || '';
      if (customCSS) {
        this._customSheet = new CSSStyleSheet();
        this._customSheet.replaceSync(customCSS);
        toAdopt.push(this._customSheet);
      }

      document.adoptedStyleSheets = [...document.adoptedStyleSheets, ...toAdopt];
    } catch (error) {
      this.logger.error(`Failed to inject controller CSS: ${error.message}`);
    }
  }

  /** Live-update the user's custom CSS when options are saved. */
  setupCSSLiveUpdates() {
    document.documentElement.addEventListener('VSC_STORAGE_CHANGED', (e) => {
      if (e.detail?.customCSS?.newValue === undefined || !this._controllerSheet) {
        return;
      }
      const customCSS = e.detail.customCSS.newValue || '';
      if (customCSS) {
        if (!this._customSheet) {
          this._customSheet = new CSSStyleSheet();
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, this._customSheet];
        }
        this._customSheet.replaceSync(customCSS);
      } else if (this._customSheet) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
          (s) => s !== this._customSheet
        );
        this._customSheet = null;
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
      if (video.readyState < 2) {
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

    // Remove adopted controller CSS (both default and custom sheets)
    if (document.adoptedStyleSheets) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (s) => s !== this._controllerSheet && s !== this._customSheet
      );
    }
    this._controllerSheet = null;
    this._customSheet = null;

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

  // Lifecycle commands from bridge (popup, background, storage changes)
  document.documentElement.addEventListener('VSC_MESSAGE', (event) => {
    const message = event.detail;

    // Handle namespaced VSC message types
    if (typeof message === 'object' && message.type && message.type.startsWith('VSC_')) {
      // Use state manager for complete media element discovery (includes shadow DOM)
      const videos = window.VSC.stateManager ? window.VSC.stateManager.getAllMediaElements() : [];

      switch (message.type) {
        case window.VSC.Constants.MESSAGE_TYPES.SET_SPEED:
          if (message.payload && typeof message.payload.speed === 'number') {
            const { MIN, MAX } = window.VSC.Constants.SPEED_LIMITS;
            const targetSpeed = Math.min(Math.max(message.payload.speed, MIN), MAX);
            videos.forEach((video) => {
              if (video.vsc) {
                extension.actionHandler.adjustSpeed(video, targetSpeed);
              } else {
                // Uncontrolled video (no vsc controller): outside the
                // arbitration domain, direct write is the only channel.
                // eslint-disable-next-line no-restricted-syntax
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
                // eslint-disable-next-line no-restricted-syntax -- uncontrolled video, outside arbitration domain
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
              // eslint-disable-next-line no-restricted-syntax -- uncontrolled video, outside arbitration domain
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
