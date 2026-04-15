/**
 * Crunchyroll-specific handler
 *
 * Crunchyroll uses the Bitmovin player which:
 * 1. Has overflow:hidden on its container, clipping the controller overlay
 * 2. Explicitly resets playbackRate on every play/resume via its
 *    setPlaybackSpeed chain — once synchronously and once via a Promise.
 *    The synchronous reset overwrites lastSpeed before the extension's
 *    play event handler runs. We save the speed on pause (before any
 *    reset can happen) and restore on the playing event, which re-arms
 *    lastSpeed so the normal fight-back handles the async reset.
 */

window.VSC = window.VSC || {};

class CrunchyrollHandler extends window.VSC.BaseSiteHandler {
  constructor() {
    super();
    this.videoListeners = new Map();
    this.savedSpeed = null;
  }

  /**
   * Check if this handler applies to Crunchyroll
   * @returns {boolean} True if on Crunchyroll
   */
  static matches() {
    return location.hostname.includes('crunchyroll.com');
  }

  /**
   * Get Crunchyroll-specific controller positioning.
   * Insert before the Bitmovin container to escape overflow:hidden clipping.
   * @param {HTMLElement} parent - Parent element
   * @param {HTMLElement} _video - Video element
   * @returns {Object} Positioning information
   */
  getControllerPosition(parent, _video) {
    return {
      insertionPoint: parent,
      insertionMethod: 'beforeParent',
      targetParent: parent.parentElement,
    };
  }

  /**
   * Set playback rate and register event listeners for speed restoration.
   * We save the speed on the pause event (before Bitmovin can reset it)
   * and restore on the playing event (after Bitmovin's reset finishes).
   * @param {HTMLMediaElement} video - Video element
   * @param {number} speed - Target speed
   */
  handleSpeedChange(video, speed) {
    video.playbackRate = speed;

    if (video.paused || this.savedSpeed === null) {
      this.savedSpeed = speed;
    }

    if (!this.videoListeners.has(video)) {
      const saveSpeed = () => {
        this.savedSpeed = video.playbackRate;
      };

      const restoreSpeed = () => {
        if (this.savedSpeed && this.savedSpeed !== video.playbackRate) {
          const speed = this.savedSpeed;
          if (video.vsc) {
            window.VSC_controller.actionHandler.adjustSpeed(video, speed);
          }
        }
      };

      video.addEventListener('pause', saveSpeed);
      video.addEventListener('seeking', saveSpeed);
      video.addEventListener('playing', restoreSpeed);
      video.addEventListener('seeked', restoreSpeed);
      this.videoListeners.set(video, { saveSpeed, restoreSpeed });
    }
  }

  /**
   * Get Crunchyroll-specific video container selectors
   * @returns {Array<string>} CSS selectors
   */
  getVideoContainerSelectors() {
    return ['.bitmovinplayer-container'];
  }

  cleanup() {
    super.cleanup();
    this.videoListeners.forEach(({ saveSpeed, restoreSpeed }, video) => {
      video.removeEventListener('pause', saveSpeed);
      video.removeEventListener('seeking', saveSpeed);
      video.removeEventListener('playing', restoreSpeed);
      video.removeEventListener('seeked', restoreSpeed);
    });
    this.videoListeners.clear();
  }
}

window.VSC.CrunchyrollHandler = CrunchyrollHandler;
