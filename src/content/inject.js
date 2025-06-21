/**
 * Video Speed Controller - Main Content Script
 * Modular architecture using global variables loaded via script array
 */

console.log('🚀 Video Speed Controller starting...');
console.log('🔧 Constants loaded:', !!window.VSC?.Constants);
console.log('🔧 Logger loaded:', !!window.VSC?.logger);
console.log('🔧 VideoController loaded:', !!window.VSC?.VideoController);

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
      console.log('🔧 Initializing Video Speed Controller...');
      console.log('✅ All modules loaded via script array!');

      // Access global modules
      this.VideoController = window.VSC.VideoController;
      this.ActionHandler = window.VSC.ActionHandler;
      this.EventManager = window.VSC.EventManager;
      this.logger = window.VSC.logger;
      this.isBlacklisted = window.VSC.DomUtils.isBlacklisted;
      this.initializeWhenReady = window.VSC.DomUtils.initializeWhenReady;
      this.siteHandlerManager = window.VSC.siteHandlerManager;
      this.VideoMutationObserver = window.VSC.VideoMutationObserver;
      this.MediaElementObserver = window.VSC.MediaElementObserver;
      this.MESSAGE_TYPES = window.VSC.Constants.MESSAGE_TYPES;

      this.logger.info('Video Speed Controller starting...');

      // Load configuration
      this.config = window.VSC.videoSpeedConfig;
      await this.config.load();

      // Check if extension is enabled
      if (!this.config.settings.enabled) {
        this.logger.info('Extension is disabled');
        return;
      }

      // Check if site is blacklisted
      if (this.isBlacklisted(this.config.settings.blacklist)) {
        this.logger.info('Site is blacklisted');
        return;
      }

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
      // Prevent double initialization
      if (document.body && document.body.classList.contains('vsc-initialized')) {
        return;
      }

      if (document.body) {
        document.body.classList.add('vsc-initialized');
        this.logger.debug('vsc-initialized added to document body');
      }

      // Set up event listeners
      this.eventManager.setupEventListeners(document);

      // Inject site-specific scripts
      this.injectSiteScript();

      // Set up CSS for non-main documents
      if (document !== window.document) {
        this.setupDocumentCSS(document);
      }

      // Start mutation observer
      if (this.mutationObserver) {
        this.mutationObserver.start(document);
      }

      // Scan for existing media elements
      this.scanExistingMedia(document);

      this.logger.debug('Document initialization completed');

    } catch (error) {
      this.logger.error(`Failed to initialize document: ${  error.message}`);
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
      (video) => this.onVideoRemoved(video)
    );
  }

  /**
   * Handle newly found video element
   * @param {HTMLMediaElement} video - Video element
   * @param {HTMLElement} parent - Parent element
   */
  onVideoFound(video, parent) {
    try {
      console.log('🎯 Checking video for controller attachment:', {
        src: video.src || video.currentSrc || 'no-src',
        className: video.className,
        readyState: video.readyState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight
      });

      if (!this.mediaObserver.isValidMediaElement(video)) {
        console.log('❌ Video element is not valid for controller attachment');
        this.logger.debug('Video element is not valid for controller attachment');
        return;
      }

      if (video.vsc) {
        console.log('⚠️ Video already has controller attached');
        this.logger.debug('Video already has controller attached');
        return;
      }

      console.log('✅ Creating VideoController for video element');
      this.logger.debug('Attaching controller to new video element');
      video.vsc = new this.VideoController(video, parent, this.config, this.actionHandler);
      console.log('🎮 VideoController created successfully');

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
   * Scan for existing media elements in document
   * @param {Document} document - Document to scan
   */
  scanExistingMedia(document) {
    try {
      const mediaElements = this.mediaObserver.scanAll(document);
      
      console.log(`🔍 Found ${mediaElements.length} media elements`);
      mediaElements.forEach((media, index) => {
        console.log(`🎥 Media ${index + 1}:`, {
          tagName: media.tagName,
          src: media.src || media.currentSrc || 'no-src',
          className: media.className,
          parentClassName: media.parentElement?.className,
          hasVsc: !!media.vsc
        });
        this.onVideoFound(media, media.parentElement);
      });

      this.logger.info(`Attached controllers to ${mediaElements.length} existing media elements`);

    } catch (error) {
      this.logger.error(`Failed to scan existing media: ${error.message}`);
    }
  }

  /**
   * Inject site-specific script if needed
   */
  injectSiteScript() {
    const scriptUrl = this.siteHandlerManager.getInjectionScript();
    if (scriptUrl) {
      const script = document.createElement('script');
      script.src = scriptUrl;
      document.head.appendChild(script);
      this.logger.debug(`Site-specific script injected: ${scriptUrl}`);
    }
  }

  /**
   * Set up CSS for iframe documents
   * @param {Document} document - Document to set up CSS for
   */
  setupDocumentCSS(document) {
    const link = document.createElement('link');
    link.href = typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.getURL('inject.css') : '/inject.css';
    link.type = 'text/css';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    this.logger.debug('CSS injected into iframe document');
  }

  /**
   * Clean up resources
   */
  cleanup() {
    try {
      if (this.mutationObserver) {
        this.mutationObserver.stop();
      }

      if (this.eventManager) {
        this.eventManager.cleanup();
      }

      this.siteHandlerManager.cleanup();

      // Clean up all video controllers
      this.config.getMediaElements().forEach((video) => {
        if (video.vsc) {
          video.vsc.remove();
        }
      });

      this.initialized = false;
      this.logger.info('Video Speed Controller cleaned up');

    } catch (error) {
      this.logger.error(`Failed to cleanup: ${error.message}`);
    }
  }
}

// Message handler for popup communication via bridge
console.log('🌉 Setting up message listener for popup communication...');

// Listen for messages from content script bridge
window.addEventListener('VSC_MESSAGE', (event) => {
  const message = event.detail;
  console.log('🌉 Message received from bridge:', message);
  
  // Handle namespaced VSC message types
  if (typeof message === 'object' && message.type && message.type.startsWith('VSC_')) {
    const videos = document.querySelectorAll('video');

    switch (message.type) {
      case window.VSC.Constants.MESSAGE_TYPES.SET_SPEED:
        if (message.payload && typeof message.payload.speed === 'number') {
          const targetSpeed = message.payload.speed;
          videos.forEach(video => {
            if (video.vsc) {
              extension.actionHandler.setSpeed(video, targetSpeed);
            } else {
              video.playbackRate = targetSpeed;
            }
          });
        }
        break;

      case window.VSC.Constants.MESSAGE_TYPES.ADJUST_SPEED:
        if (message.payload && typeof message.payload.delta === 'number') {
          const delta = message.payload.delta;
          videos.forEach(video => {
            const newSpeed = Math.min(Math.max(video.playbackRate + delta, 0.07), 16);
            if (video.vsc) {
              extension.actionHandler.setSpeed(video, newSpeed);
            } else {
              video.playbackRate = newSpeed;
            }
          });
        }
        break;

      case window.VSC.Constants.MESSAGE_TYPES.RESET_SPEED:
        videos.forEach(video => {
          if (video.vsc) {
            extension.actionHandler.resetSpeed(video, 1.0);
          } else {
            video.playbackRate = 1.0;
          }
        });
        break;

      case window.VSC.Constants.MESSAGE_TYPES.TOGGLE_DISPLAY:
        if (extension.actionHandler) {
          extension.actionHandler.runAction('display', null, null);
        }
        break;
    }
  }
});

console.log('✅ Message listener set up for popup communication');

// Create and initialize extension instance
const extension = new VideoSpeedExtension();

// Handle page unload
window.addEventListener('beforeunload', () => {
  extension.cleanup();
});

// Auto-initialize - settings loading will wait for injected settings if needed
extension.initialize().catch((error) => {
  console.error(`Extension initialization failed: ${error.message}`);
  window.VSC.logger.error(`Extension initialization failed: ${error.message}`);
});

// Export for testing
window.VideoSpeedExtension = VideoSpeedExtension;
window.videoSpeedExtension = extension;

// Add test indicator for E2E tests
const testIndicator = document.createElement('div');
testIndicator.id = 'vsc-test-indicator';
testIndicator.style.display = 'none';
document.head.appendChild(testIndicator);
console.log('🧪 Test indicator added for E2E detection');