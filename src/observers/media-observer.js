/**
 * Media element observer for finding and tracking video/audio elements
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

class MediaElementObserver {
  constructor(config, siteHandler) {
    this.config = config;
    this.siteHandler = siteHandler;
  }

  /**
   * Scan document for existing media elements
   * @param {Document} document - Document to scan
   * @returns {Array<HTMLMediaElement>} Found media elements
   */
  scanForMedia(document) {
    const mediaElements = [];
    const audioEnabled = this.config.settings.audioBoolean;
    const mediaTagSelector = audioEnabled ? 'video,audio' : 'video';

    // Find regular media elements
    const regularMedia = Array.from(document.querySelectorAll(mediaTagSelector));
    mediaElements.push(...regularMedia);

    // Find media elements in shadow DOMs
    document.querySelectorAll('*').forEach((element) => {
      if (element.shadowRoot) {
        const shadowMedia = element.shadowRoot.querySelectorAll(mediaTagSelector);
        mediaElements.push(...shadowMedia);
      }
    });

    // Find site-specific media elements
    const siteSpecificMedia = this.siteHandler.detectSpecialVideos(document);
    mediaElements.push(...siteSpecificMedia);

    // Filter out ignored videos
    const filteredMedia = mediaElements.filter((media) => {
      return !this.siteHandler.shouldIgnoreVideo(media);
    });

    window.VSC.logger.info(
      `Found ${filteredMedia.length} media elements (${mediaElements.length} total, ${mediaElements.length - filteredMedia.length} filtered out)`
    );
    return filteredMedia;
  }

  /**
   * Scan iframes for media elements
   * @param {Document} document - Document to scan
   * @returns {Array<HTMLMediaElement>} Found media elements in iframes
   */
  scanIframes(document) {
    const mediaElements = [];
    const frameTags = document.getElementsByTagName('iframe');

    Array.prototype.forEach.call(frameTags, (frame) => {
      // Ignore frames we don't have permission to access (different origin)
      try {
        const childDocument = frame.contentDocument;
        if (childDocument) {
          const iframeMedia = this.scanForMedia(childDocument);
          mediaElements.push(...iframeMedia);
          window.VSC.logger.debug(`Found ${iframeMedia.length} media elements in iframe`);
        }
      } catch (e) {
        window.VSC.logger.debug(`Cannot access iframe content (cross-origin): ${e.message}`);
      }
    });

    return mediaElements;
  }

  /**
   * Get media elements using site-specific container selectors
   * @param {Document} document - Document to scan
   * @returns {Array<HTMLMediaElement>} Found media elements
   */
  scanSiteSpecificContainers(document) {
    const mediaElements = [];
    const containerSelectors = this.siteHandler.getVideoContainerSelectors();
    const audioEnabled = this.config.settings.audioBoolean;

    containerSelectors.forEach((selector) => {
      try {
        const containers = document.querySelectorAll(selector);
        containers.forEach((container) => {
          const containerMedia = window.VSC.DomUtils.findMediaElements(container, audioEnabled);
          mediaElements.push(...containerMedia);
        });
      } catch (e) {
        window.VSC.logger.warn(`Invalid selector "${selector}": ${e.message}`);
      }
    });

    return mediaElements;
  }

  /**
   * Comprehensive scan for all media elements
   * @param {Document} document - Document to scan
   * @returns {Array<HTMLMediaElement>} All found media elements
   */
  scanAll(document) {
    const allMedia = [];

    // Regular scan
    const regularMedia = this.scanForMedia(document);
    allMedia.push(...regularMedia);

    // Site-specific container scan
    const containerMedia = this.scanSiteSpecificContainers(document);
    allMedia.push(...containerMedia);

    // Iframe scan
    const iframeMedia = this.scanIframes(document);
    allMedia.push(...iframeMedia);

    // Remove duplicates
    const uniqueMedia = [...new Set(allMedia)];

    window.VSC.logger.info(`Total unique media elements found: ${uniqueMedia.length}`);
    return uniqueMedia;
  }

  /**
   * Check if media element is valid for controller attachment
   * @param {HTMLMediaElement} media - Media element to check
   * @returns {boolean} True if valid
   */
  isValidMediaElement(media) {
    // Skip videos that are not in the DOM
    if (!media.isConnected) {
      window.VSC.logger.debug('Video not in DOM');
      return false;
    }

    // Check visibility
    const style = window.getComputedStyle(media);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      window.VSC.logger.debug('Video not visible');
      return false;
    }

    // If video hasn't loaded yet, skip size checks but continue with other validation
    if (media.readyState < 2) {
      window.VSC.logger.debug('Video still loading, skipping size checks');

      // Let site handler decide for loading videos
      if (this.siteHandler.shouldIgnoreVideo(media)) {
        window.VSC.logger.debug('Video ignored by site handler (during loading)');
        return false;
      }

      return true;
    }

    // Check if the video is reasonably sized
    const rect = media.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 50) {
      window.VSC.logger.debug(`Video too small: ${rect.width}x${rect.height}`);
      return false;
    }

    // Let site handler have final say
    if (this.siteHandler.shouldIgnoreVideo(media)) {
      window.VSC.logger.debug('Video ignored by site handler');
      return false;
    }

    return true;
  }

  /**
   * Find the best parent element for controller positioning
   * @param {HTMLMediaElement} media - Media element
   * @returns {HTMLElement} Parent element for positioning
   */
  findControllerParent(media) {
    const positioning = this.siteHandler.getControllerPosition(media.parentElement, media);
    return positioning.targetParent || media.parentElement;
  }
}

// Create singleton instance
window.VSC.MediaElementObserver = MediaElementObserver;
