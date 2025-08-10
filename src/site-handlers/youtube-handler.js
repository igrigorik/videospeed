/**
 * YouTube-specific handler
 */

window.VSC = window.VSC || {};

class YouTubeHandler extends window.VSC.BaseSiteHandler {
  /**
   * Check if this handler applies to YouTube
   * @returns {boolean} True if on YouTube
   */
  static matches() {
    return location.hostname === 'www.youtube.com';
  }

  /**
   * Get YouTube-specific controller positioning
   * @param {HTMLElement} parent - Parent element
   * @param {HTMLElement} video - Video element
   * @returns {Object} Positioning information
   */
  getControllerPosition(parent, _video) {
    // YouTube requires special positioning to ensure controller is on top
    const targetParent = parent.parentElement;

    return {
      insertionPoint: targetParent,
      insertionMethod: 'firstChild',
      targetParent: targetParent,
    };
  }

  /**
   * Initialize YouTube-specific functionality
   * @param {Document} document - Document object
   */
  initialize(document) {
    super.initialize(document);

    // Set up YouTube-specific CSS handling
    this.setupYouTubeCSS();
  }

  /**
   * Set up YouTube-specific CSS classes and positioning
   * @private
   */
  setupYouTubeCSS() {
    // YouTube has complex CSS that can hide our controller
    // The inject.css already handles this, but we could add dynamic adjustments here
    window.VSC.logger.debug('YouTube CSS setup completed');
  }

  /**
   * Check if video should be ignored on YouTube
   * @param {HTMLMediaElement} video - Video element
   * @returns {boolean} True if video should be ignored
   */
  shouldIgnoreVideo(video) {
    // Ignore thumbnail videos and ads
    return (
      video.classList.contains('video-thumbnail') ||
      video.parentElement?.classList.contains('ytp-ad-player-overlay')
    );
  }

  /**
   * Get YouTube-specific video container selectors
   * @returns {Array<string>} CSS selectors
   */
  getVideoContainerSelectors() {
    return ['.html5-video-player', '#movie_player', '.ytp-player-content'];
  }

  /**
   * Handle special video detection for YouTube
   * @param {Document} document - Document object
   * @returns {Array<HTMLMediaElement>} Additional videos found
   */
  detectSpecialVideos(document) {
    const videos = [];

    // Look for videos in iframes (embedded players)
    try {
      const iframes = document.querySelectorAll('iframe[src*="youtube.com"]');
      iframes.forEach((iframe) => {
        try {
          const iframeDoc = iframe.contentDocument;
          if (iframeDoc) {
            const iframeVideos = iframeDoc.querySelectorAll('video');
            videos.push(...Array.from(iframeVideos));
          }
        } catch (e) {
          // Cross-origin iframe, ignore
        }
      });
    } catch (e) {
      window.VSC.logger.debug(`Could not access YouTube iframe videos: ${e.message}`);
    }

    return videos;
  }

  /**
   * Handle YouTube-specific player state changes
   * @param {HTMLMediaElement} video - Video element
   */
  onPlayerStateChange(_video) {
    // YouTube fires custom events we could listen to
    // This could be used for better integration with YouTube's player
    window.VSC.logger.debug('YouTube player state changed');
  }
}

// Create singleton instance
window.VSC.YouTubeHandler = YouTubeHandler;
