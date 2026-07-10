/**
 * Dailymotion-specific handler
 *
 * Dailymotion's player nests the <video> inside .video_view, but the native
 * controls (.vod_mouse_keyboard) are a sibling of .video_view under .player.
 * This creates a stacking-context trap: no z-index on the controller inside
 * .video_view can beat the sibling overlay.  Fix: insert the controller into
 * the grandparent (.player) so it participates in the same stacking context.
 */

window.VSC = window.VSC || {};

class DailymotionHandler extends window.VSC.BaseSiteHandler {
  static matches(hostname = location.hostname) {
    return hostname.includes('dailymotion.com');
  }

  getControllerPosition(parent, _video) {
    // parent = .video_view; go up to .player so the controller is a sibling
    // of .vod_mouse_keyboard and can z-index above it.
    const playerContainer = parent.parentElement;
    return {
      insertionPoint: playerContainer || parent,
      insertionMethod: 'firstChild',
      targetParent: playerContainer || parent,
    };
  }
}

window.VSC.DailymotionHandler = DailymotionHandler;
