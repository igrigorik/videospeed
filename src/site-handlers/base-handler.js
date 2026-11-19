/**
 * Base class for site-specific handlers
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
  getControllerPosition(parent, _video) {
    return {
      insertionPoint: parent,
      insertionMethod: 'firstChild', // 'firstChild', 'beforeParent', 'afterParent'
      targetParent: parent,
    };
  }

  /**
   * Declare site-specific intent-classifier rule activations.
   *
   * The classifier owns what each flag MEANS (signature rates, binding,
   * terminal handling); handlers only declare WHICH flags their site
   * activates, keeping hostname knowledge in one registry (matches()).
   * Return a frozen partial override of IntentClassifier.TARGET_RULES, or
   * null for the generic rules. Every activation must cite the issue that
   * motivated it (see CONTRIBUTING's classifier-heuristic rule).
   * @returns {Object|null} Partial rule flags, or null for generic rules
   */
  getClassifierRules() {
    return null;
  }

  /**
   * Handle site-specific speed change.
   * Called whenever the extension sets playback speed (user action, fight-back, etc.).
   * Override to sync with a site's custom player API.
   * @param {HTMLMediaElement} video - Video element
   * @param {number} speed - Target speed
   */
  handleSpeedChange(video, speed) {
    video.playbackRate = speed;
  }

  /**
   * Whether the native ratechange echo of a VSC write of `rate` must be hidden
   * from page listeners.
   *
   * Echoes are observable by default so player UIs and integrations stay in
   * sync. Override only for a player that clamps any rate it observes to a
   * product ceiling and writes the clamp back asynchronously: the reactive
   * echo guard cannot causally attribute such a rewrite, so every VSC write is
   * vetoed until the fight budget runs out. Cite the motivating issue.
   * @param {HTMLMediaElement} _video - Video element
   * @param {number} _rate - Rate VSC is about to write
   * @returns {boolean} True to stop the echo at VSC's document-capture listener
   */
  hidesRateEcho(_video, _rate) {
    return false;
  }

  /**
   * Handle site-specific seeking functionality
   * @param {HTMLMediaElement} video - Video element
   * @param {number} seekSeconds - Seconds to seek
   * @returns {boolean} True if handled, false for default behavior
   */
  handleSeek(video, seekSeconds) {
    // Default implementation - use standard seeking with bounds checking (original logic)
    if (video.currentTime !== undefined && video.duration) {
      const newTime = Math.max(0, Math.min(video.duration, video.currentTime + seekSeconds));
      video.currentTime = newTime;
    } else {
      // Fallback for videos without duration
      video.currentTime += seekSeconds;
    }
    return true;
  }

  /**
   * Handle site-specific initialization
   * @param {Document} document - Document object
   */
  initialize(_document) {
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
  shouldIgnoreVideo(_video) {
    return false;
  }

  /**
   * Resolve a page gesture to exactly one controlled media element.
   *
   * Return null unless a site-specific player relationship is unambiguous.
   * EventManager retains unresolved gestures as document-level fallback
   * evidence, while a resolved gesture must never bless another player.
   * @param {Event} _event
   * @param {HTMLMediaElement[]} _mediaElements
   * @returns {HTMLMediaElement|null}
   */
  resolveGestureMedia(_event, _mediaElements) {
    return null;
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
  detectSpecialVideos(_document) {
    return [];
  }
}

// Create singleton instance
window.VSC.BaseSiteHandler = BaseSiteHandler;
