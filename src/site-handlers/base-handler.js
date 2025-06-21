/**
 * Base class for site-specific handlers
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

class BaseSiteHandler {
  constructor() {
    this.hostname = location.hostname;
  }

  /**
   * Check if this handler applies to the current site
   * @returns {boolean} True if handler applies
   */
  static matches() {
    return false; // Override in subclasses
  }

  /**
   * Get the site-specific positioning for the controller
   * @param {HTMLElement} parent - Parent element
   * @param {HTMLElement} video - Video element
   * @returns {Object} Positioning information
   */
  getControllerPosition(parent, video) {
    return {
      insertionPoint: parent,
      insertionMethod: 'firstChild', // 'firstChild', 'beforeParent', 'afterParent'
      targetParent: parent
    };
  }

  /**
   * Handle site-specific seeking functionality
   * @param {HTMLMediaElement} video - Video element
   * @param {number} seekSeconds - Seconds to seek
   * @returns {boolean} True if handled, false for default behavior
   */
  handleSeek(video, seekSeconds) {
    // Default implementation - use standard seeking
    video.currentTime += seekSeconds;
    return true;
  }

  /**
   * Get site-specific script to inject
   * @returns {string|null} Script URL or null if none needed
   */
  getInjectionScript() {
    return null;
  }

  /**
   * Handle site-specific initialization
   * @param {Document} document - Document object
   */
  initialize(document) {
    window.VSC.logger.debug(`Initializing ${this.constructor.name} for ${this.hostname}`);
  }

  /**
   * Handle site-specific cleanup
   */
  cleanup() {
    window.VSC.logger.debug(`Cleaning up ${this.constructor.name}`);
  }

  /**
   * Check if video element should be ignored
   * @param {HTMLMediaElement} video - Video element
   * @returns {boolean} True if video should be ignored
   */
  shouldIgnoreVideo(video) {
    return false;
  }

  /**
   * Get site-specific CSS selectors for video containers
   * @returns {Array<string>} CSS selectors
   */
  getVideoContainerSelectors() {
    return [];
  }

  /**
   * Handle special video detection logic
   * @param {Document} document - Document object
   * @returns {Array<HTMLMediaElement>} Additional videos found
   */
  detectSpecialVideos(document) {
    return [];
  }
}

// Create singleton instance
window.VSC.BaseSiteHandler = BaseSiteHandler;