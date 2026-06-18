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
    // YouTube requires special positioning to ensure controller is on top.
    // Default: insert into the .html5-video-player (one level up from video container).
    let targetParent = parent.parentElement;

    // Embedded YouTube has a #player-controls overlay that sits as a sibling of
    // .html5-video-player and creates a separate stacking context, intercepting
    // all pointer events. Our controller inside .html5-video-player can't z-index
    // above it. Fix: insert into #player (the common parent) so our controller
    // participates in the same stacking context as the overlay.
    // NOTE: Must scope the query to targetParent.parentElement to avoid falsely matching
    // a global #player-controls element on the desktop site, which promotes insertion
    // into the tightly-managed ytd-player > div#container and crashes Polymer.
    if (
      targetParent &&
      targetParent.parentElement &&
      targetParent.parentElement.querySelector('#player-controls')
    ) {
      targetParent = targetParent.parentElement;
    }

    return {
      insertionPoint: targetParent,
      insertionMethod: 'firstChild',
      targetParent: targetParent,
    };
  }

  // YouTube autohide is handled purely via CSS using :host-context() in
  // shadow-dom.js — no MutationObserver needed. The shadow DOM rule
  // :host-context(.ytp-autohide) matches when any ancestor of the
  // <vsc-controller> host has the ytp-autohide class.

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
   * YouTube live streams expose the reliable live edge through their player
   * progress state. The native HTMLMediaElement seekable range can point at
   * the full manifest timeline and overstate latency by hours.
   * @param {HTMLMediaElement} video - Video element
   * @returns {number|null} Seconds behind live edge
   */
  getLiveLatency(video) {
    const player = video.ownerDocument.getElementById('movie_player');
    if (!player || typeof player.getProgressState !== 'function') {
      return null;
    }

    const progressState = player.getProgressState();
    const videoData =
      typeof player.getVideoData === 'function' ? player.getVideoData() : { isLive: false };

    if (!videoData?.isLive) {
      return null;
    }

    if (progressState?.isAtLiveHead) {
      return 0;
    }

    const current = Number(progressState?.current ?? video.currentTime);
    const liveEdge = Number(progressState?.seekableEnd);
    if (!Number.isFinite(current) || !Number.isFinite(liveEdge)) {
      return null;
    }

    return Math.max(0, liveEdge - current);
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
        } catch {
          // Cross-origin iframe, ignore
        }
      });
    } catch (e) {
      window.VSC.logger.debug(`Could not access YouTube iframe videos: ${e.message}`);
    }

    return videos;
  }
}

// Create singleton instance
window.VSC.YouTubeHandler = YouTubeHandler;
