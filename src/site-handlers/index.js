/**
 * Site handler factory and manager
 */

window.VSC = window.VSC || {};

class SiteHandlerManager {
  constructor() {
    this.currentHandler = null;
    this.availableHandlers = [
      window.VSC.NetflixHandler,
      window.VSC.YouTubeHandler,
      window.VSC.FacebookHandler,
      window.VSC.AmazonHandler,
      window.VSC.AppleHandler,
    ];
  }

  /**
   * Get the appropriate handler for the current site
   * @returns {BaseSiteHandler} Site handler instance
   */
  getCurrentHandler() {
    if (!this.currentHandler) {
      this.currentHandler = this.detectHandler();
    }
    return this.currentHandler;
  }

  /**
   * Detect which handler to use for the current site
   * @returns {BaseSiteHandler} Site handler instance
   * @private
   */
  detectHandler() {
    for (const HandlerClass of this.availableHandlers) {
      if (HandlerClass.matches()) {
        window.VSC.logger.info(`Using ${HandlerClass.name} for ${location.hostname}`);
        return new HandlerClass();
      }
    }

    window.VSC.logger.debug(`Using BaseSiteHandler for ${location.hostname}`);
    return new window.VSC.BaseSiteHandler();
  }

  /**
   * Initialize the current site handler
   * @param {Document} document - Document object
   */
  initialize(document) {
    const handler = this.getCurrentHandler();
    handler.initialize(document);
  }

  /**
   * Get controller positioning for current site
   * @param {HTMLElement} parent - Parent element
   * @param {HTMLElement} video - Video element
   * @returns {Object} Positioning information
   */
  getControllerPosition(parent, video) {
    const handler = this.getCurrentHandler();
    return handler.getControllerPosition(parent, video);
  }

  /**
   * Handle speed change for current site
   * @param {HTMLMediaElement} video - Video element
   * @param {number} speed - Target speed
   */
  handleSpeedChange(video, speed) {
    const handler = this.getCurrentHandler();
    handler.handleSpeedChange(video, speed);
  }

  /**
   * Handle seeking for current site
   * @param {HTMLMediaElement} video - Video element
   * @param {number} seekSeconds - Seconds to seek
   * @returns {boolean} True if handled
   */
  handleSeek(video, seekSeconds) {
    const handler = this.getCurrentHandler();
    return handler.handleSeek(video, seekSeconds);
  }

  /**
   * Check if a video should be ignored
   * @param {HTMLMediaElement} video - Video element
   * @returns {boolean} True if video should be ignored
   */
  shouldIgnoreVideo(video) {
    const handler = this.getCurrentHandler();
    if (handler.shouldIgnoreVideo(video)) {
      return true;
    }

    // Detect gif-like videos: muted looping videos with no native controls.
    // Sites like Telegram, X, Imgur serve animated stickers/GIFs as <video
    // autoplay loop muted> elements. Showing a speed overlay on these is
    // visually noisy and not useful.
    if (video.tagName === 'VIDEO' && video.loop && video.muted && !video.controls) {
      window.VSC.logger.debug('Video ignored: gif-video pattern (loop + muted + no controls)');
      return true;
    }

    return false;
  }

  /**
   * Get video container selectors for current site
   * @returns {Array<string>} CSS selectors
   */
  getVideoContainerSelectors() {
    const handler = this.getCurrentHandler();
    return handler.getVideoContainerSelectors();
  }

  /**
   * Detect special videos for current site
   * @param {Document} document - Document object
   * @returns {Array<HTMLMediaElement>} Additional videos found
   */
  detectSpecialVideos(document) {
    const handler = this.getCurrentHandler();
    return handler.detectSpecialVideos(document);
  }

  /**
   * Cleanup current handler
   */
  cleanup() {
    if (this.currentHandler) {
      this.currentHandler.cleanup();
      this.currentHandler = null;
    }
  }

  /**
   * Force refresh of current handler (useful for SPA navigation)
   */
  refresh() {
    this.cleanup();
    this.currentHandler = null;
  }
}

// Create singleton instance
window.VSC.siteHandlerManager = new SiteHandlerManager();
