/**
 * Facebook-specific handler
 */

window.VSC = window.VSC || {};

class FacebookHandler extends window.VSC.BaseSiteHandler {
  /**
   * Check if this handler applies to Facebook
   * @returns {boolean} True if on Facebook
   */
  static matches() {
    return location.hostname === 'www.facebook.com';
  }

  /**
   * Get Facebook-specific controller positioning
   * @param {HTMLElement} parent - Parent element
   * @param {HTMLElement} video - Video element
   * @returns {Object} Positioning information
   */
  getControllerPosition(parent, _video) {
    // Facebook requires deep DOM traversal due to complex nesting
    // This is a monstrosity but new FB design does not have semantic handles
    let targetParent = parent;

    try {
      targetParent =
        parent.parentElement.parentElement.parentElement.parentElement.parentElement.parentElement
          .parentElement;
    } catch (e) {
      window.VSC.logger.warn('Facebook DOM structure changed, using fallback positioning');
      targetParent = parent.parentElement;
    }

    return {
      insertionPoint: targetParent,
      insertionMethod: 'firstChild',
      targetParent: targetParent,
    };
  }

  /**
   * Initialize Facebook-specific functionality
   * @param {Document} document - Document object
   */
  initialize(document) {
    super.initialize(document);

    // Facebook's dynamic content requires special handling
    this.setupFacebookObserver(document);
  }

  /**
   * Set up observer for Facebook's dynamic content loading
   * @param {Document} document - Document object
   * @private
   */
  setupFacebookObserver(document) {
    // Facebook loads content dynamically, so we need to watch for new videos
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const videos = node.querySelectorAll && node.querySelectorAll('video');
              if (videos && videos.length > 0) {
                window.VSC.logger.debug(`Facebook: Found ${videos.length} new videos`);
                // Signal that new videos were found
                this.onNewVideosDetected(Array.from(videos));
              }
            }
          });
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    this.facebookObserver = observer;
    window.VSC.logger.debug('Facebook dynamic content observer set up');
  }

  /**
   * Handle new videos detected in Facebook's dynamic content
   * @param {Array<HTMLMediaElement>} videos - New video elements
   * @private
   */
  onNewVideosDetected(videos) {
    // This could be used to automatically attach controllers to new videos
    // For now, just log the detection
    window.VSC.logger.debug(`Facebook: ${videos.length} new videos detected`);
  }

  /**
   * Check if video should be ignored on Facebook
   * @param {HTMLMediaElement} video - Video element
   * @returns {boolean} True if video should be ignored
   */
  shouldIgnoreVideo(video) {
    // Ignore story videos and other non-main content
    return (
      video.closest('[data-story-id]') !== null ||
      video.closest('.story-bucket-container') !== null ||
      video.getAttribute('data-video-width') === '0'
    );
  }

  /**
   * Get Facebook-specific video container selectors
   * @returns {Array<string>} CSS selectors
   */
  getVideoContainerSelectors() {
    return ['[data-video-id]', '.video-container', '.fbStoryVideoContainer', '[role="main"] video'];
  }

  /**
   * Cleanup Facebook-specific resources
   */
  cleanup() {
    super.cleanup();

    if (this.facebookObserver) {
      this.facebookObserver.disconnect();
      this.facebookObserver = null;
    }
  }
}

// Create singleton instance
window.VSC.FacebookHandler = FacebookHandler;
