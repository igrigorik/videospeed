/**
 * Crunchyroll-specific handler
 */

window.VSC = window.VSC || {};

class CrunchyrollHandler extends window.VSC.BaseSiteHandler {
  /**
   * Check if this handler applies to Crunchyroll
   * @returns {boolean} True if on Crunchyroll
   */
  static matches() {
    return location.hostname.includes('crunchyroll.com');
  }

  /**
   * Get Crunchyroll-specific controller positioning.
   * Crunchyroll uses the Bitmovin player whose container has overflow:hidden
   * and a > * rule that collapses children to 0x0. Insert before the container
   * to escape clipping.
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
   * Get Crunchyroll-specific video container selectors
   * @returns {Array<string>} CSS selectors
   */
  getVideoContainerSelectors() {
    return ['.bitmovinplayer-container'];
  }
}

window.VSC.CrunchyrollHandler = CrunchyrollHandler;
