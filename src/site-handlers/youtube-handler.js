/**
 * YouTube-specific handler
 */

window.VSC = window.VSC || {};

class YouTubeHandler extends window.VSC.BaseSiteHandler {
  /**
   * Check if this handler applies to YouTube
   * @param {string} [hostname] - Injectable for tests; defaults to live location
   * @returns {boolean} True if on YouTube
   */
  static matches(hostname = location.hostname) {
    // youtube-nocookie.com is the privacy-enhanced embed host: identical
    // player build, DOM, and control layers. music.youtube.com stays
    // excluded — different player shell.
    return hostname === 'www.youtube.com' || hostname === 'www.youtube-nocookie.com';
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

    // 2026 embed layout: YouTube moved the #player-controls overlay out of
    // #player to a position:fixed <body> child (ytm-* control host). Nothing
    // inserted inside #player can stack above it — #movie_player is a
    // z-index:0 stacking context painted before that fixed sibling — so the
    // controller must anchor at body level, where its own z-index competes in
    // the root stacking context. This also removes #movie_player from the
    // host's ancestry, so the :host-context(.ytp-autohide) coupling (a class
    // the ytm UI sets once and never toggles) stops force-hiding the badge.
    // Trade-off: while the player element itself is fullscreened, a
    // body-level controller does not render; keyboard shortcuts still work.
    // Scoped to /embed/ so a desktop page's global #player-controls can never
    // re-trigger the historical Polymer-crash insertion.
    if (
      location.pathname.startsWith('/embed/') &&
      document.body?.querySelector(':scope > #player-controls')
    ) {
      return {
        insertionPoint: document.body,
        insertionMethod: 'firstChild',
        targetParent: document.body,
      };
    }

    // Older embed layout: #player-controls overlay sits as a sibling of
    // .html5-video-player inside #player and creates a separate stacking
    // context, intercepting all pointer events. Our controller inside
    // .html5-video-player can't z-index above it. Fix: insert into #player
    // (the common parent) so our controller participates in the same stacking
    // context as the overlay.
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
   * Press-and-hold 2x boost (#1554/#1568): the pointer variant fires a
   * ratechange while the pointer is still down, before any click event
   * exists (PR #1555). The SPACEBAR variant of the same boost armed via
   * legacy any-key-arming — narrowed away by TARGET_RULES — so Space must
   * arm here explicitly (held Space auto-repeats keydown, keeping the
   * gesture window fresh through the hold and across the release reset).
   * Scoped to this handler's matches() hosts: www.youtube.com and the
   * privacy-enhanced embed host, which serve the identical player.
   * (#1581 needs no entry: click-seek resets go to 1.0, and a 1.0 adoption
   * requires STRONG evidence under the classifier's tiered rules.)
   * @returns {Object} Classifier rule activations for YouTube
   */
  getClassifierRules() {
    return YouTubeHandler.CLASSIFIER_RULES;
  }

  /**
   * Associate a gesture in YouTube player chrome with exactly one controlled
   * video. Player controls are overlays/siblings rather than video children,
   * so EventManager's direct composed-path resolution cannot see them.
   *
   * This deliberately recognizes the whole player chrome, including seek
   * controls: it only prevents a click for player A from blessing player B;
   * it does not claim to distinguish a seek from a native speed-menu action.
   * @param {Event} event
   * @param {HTMLMediaElement[]} mediaElements
   * @returns {HTMLMediaElement|null}
   */
  resolveGestureMedia(event, mediaElements) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    const matches = mediaElements.filter((video) => this.gestureBelongsToVideo(path, video));
    return matches.length === 1 ? matches[0] : null;
  }

  /**
   * @param {EventTarget[]} path
   * @param {HTMLMediaElement} video
   * @returns {boolean}
   * @private
   */
  gestureBelongsToVideo(path, video) {
    const player =
      video.closest?.('.html5-video-player') ||
      video.closest?.('#movie_player') ||
      video.closest?.('.ytp-player-content');
    if (!player) {
      return false;
    }

    const includes = (container) =>
      !!container &&
      path.some((node) => node === container || (node?.nodeType && container.contains(node)));
    if (includes(player)) {
      return true;
    }

    // Embedded players place #player-controls alongside the player in the
    // common parent stacking context. Scope it to that parent so a desktop
    // page's unrelated global ID cannot claim this video.
    const embeddedControls = Array.from(player.parentElement?.children || []).find(
      (child) => child.id === 'player-controls'
    );
    return includes(embeddedControls);
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

YouTubeHandler.CLASSIFIER_RULES = Object.freeze({ pointerHoldArms: true, spacebarArms: true });

// Create singleton instance
window.VSC.YouTubeHandler = YouTubeHandler;
