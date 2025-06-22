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
    // Check if element is in DOM
    if (!document.body.contains(media)) {
      console.log('🚫 Video not in DOM');
      return false;
    }

    // Check if element is visible
    const style = window.getComputedStyle(media);
    if (style.display === 'none' || style.visibility === 'hidden') {
      console.log('🚫 Video not visible:', {
        display: style.display,
        visibility: style.visibility,
      });
      return false;
    }

    // For videos that are still loading, skip size checks
    // readyState: 0 = HAVE_NOTHING, 1 = HAVE_METADATA
    if (media.readyState < 2) {
      console.log('⏳ Video still loading, skipping size checks', {
        readyState: media.readyState,
        src: media.src || media.currentSrc,
      });

      // Still do site-specific checks
      if (this.siteHandler.shouldIgnoreVideo(media)) {
        console.log('🚫 Video ignored by site handler (during loading)');
        return false;
      }

      console.log('✅ Video accepted (still loading)');
      return true;
    }

    // Check if element has minimum size (only after loaded)
    const rect = media.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 50) {
      console.log('🚫 Video too small:', { width: rect.width, height: rect.height });
      return false;
    }

    // Site-specific checks
    if (this.siteHandler.shouldIgnoreVideo(media)) {
      console.log('🚫 Video ignored by site handler');
      return false;
    }

    console.log('✅ Video passed all validation checks');
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
