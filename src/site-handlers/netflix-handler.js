/**
 * Netflix-specific handler
 */

window.VSC = window.VSC || {};

class NetflixHandler extends window.VSC.BaseSiteHandler {
  /**
   * Check if this handler applies to Netflix
   * @returns {boolean} True if on Netflix
   */
  static matches() {
    return location.hostname === 'www.netflix.com';
  }

  /**
   * Get Netflix-specific controller positioning
   * @param {HTMLElement} parent - Parent element
   * @param {HTMLElement} video - Video element
   * @returns {Object} Positioning information
   */
  getControllerPosition(parent, _video) {
    // Insert before parent to bypass Netflix's overlay
    return {
      insertionPoint: parent.parentElement,
      insertionMethod: 'beforeParent',
      targetParent: parent.parentElement,
    };
  }

  /**
   * Handle Netflix-specific seeking using their API
   * @param {HTMLMediaElement} video - Video element
   * @param {number} seekSeconds - Seconds to seek
   * @returns {boolean} True if handled
   */
  handleSeek(video, seekSeconds) {
    try {
      // Use Netflix's postMessage API for seeking
      window.postMessage(
        {
          action: 'videospeed-seek',
          seekMs: seekSeconds * 1000,
        },
        'https://www.netflix.com'
      );

      window.VSC.logger.debug(`Netflix seek: ${seekSeconds} seconds`);
      return true;
    } catch (error) {
      window.VSC.logger.error(`Netflix seek failed: ${error.message}`);
      // Fallback to default seeking
      video.currentTime += seekSeconds;
      return true;
    }
  }

  /**
   * Initialize Netflix-specific functionality
   * @param {Document} document - Document object
   */
  initialize(document) {
    super.initialize(document);

    // Netflix-specific script injection is handled by content script (injector.js)
    // since Chrome APIs are not available in injected page context
    window.VSC.logger.debug(
      'Netflix handler initialized - script injection handled by content script'
    );
  }

  /**
   * Check if video should be ignored on Netflix
   * @param {HTMLMediaElement} video - Video element
   * @returns {boolean} True if video should be ignored
   */
  shouldIgnoreVideo(video) {
    // Ignore preview videos or thumbnails
    return (
      video.classList.contains('preview-video') ||
      video.parentElement?.classList.contains('billboard-row')
    );
  }

  /**
   * Get Netflix-specific video container selectors
   * @returns {Array<string>} CSS selectors
   */
  getVideoContainerSelectors() {
    return ['.watch-video', '.nfp-container', '#netflix-player'];
  }
}

// Create singleton instance
window.VSC.NetflixHandler = NetflixHandler;
