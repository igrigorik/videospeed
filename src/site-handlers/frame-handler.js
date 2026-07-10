/**
 * Frame.io-specific handler
 *
 * Frame's review player renders the visible <video> from a zero-size,
 * transformed layer whose origin is the center of the player viewport. The
 * default controller parent is that layer, so even a (0,0) controller appears
 * in the middle of the video. Promote insertion to the nearest substantial
 * clipping viewport so (0,0) means the visible player's top-left corner.
 */

window.VSC = window.VSC || {};

class FrameHandler extends window.VSC.BaseSiteHandler {
  static matches(hostname = location.hostname) {
    return hostname === 'next.frame.io';
  }

  getControllerPosition(parent, video) {
    const targetParent = this.findPlayerViewport(parent, video) || parent;

    return {
      insertionPoint: targetParent,
      insertionMethod: 'firstChild',
      targetParent: targetParent,
    };
  }

  /**
   * Find Frame's visible player viewport without depending on generated class
   * names. We deliberately require both a substantial rendered size and a
   * clipping overflow ancestor; the zero-size transformed video layer fails the
   * size check, while the player viewport passes both.
   * @param {HTMLElement} parent - Initial controller parent
   * @param {HTMLMediaElement} video - Media element being controlled
   * @returns {HTMLElement|null} Viewport element, or null when structure is unknown
   * @private
   */
  findPlayerViewport(parent, video) {
    const videoRect = video.getBoundingClientRect();
    if (!videoRect.width || !videoRect.height) {
      return null;
    }

    const minWidth = Math.min(videoRect.width * 0.5, 300);
    const minHeight = Math.min(videoRect.height * 0.5, 150);
    let candidate = parent;

    for (let depth = 0; candidate && depth < 8; depth += 1) {
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      const clipsContent =
        style.overflow === 'hidden' ||
        style.overflow === 'clip' ||
        style.overflowX === 'hidden' ||
        style.overflowX === 'clip' ||
        style.overflowY === 'hidden' ||
        style.overflowY === 'clip';

      if (clipsContent && rect.width >= minWidth && rect.height >= minHeight) {
        return candidate;
      }

      candidate = candidate.parentElement;
    }

    return null;
  }
}

window.VSC.FrameHandler = FrameHandler;
