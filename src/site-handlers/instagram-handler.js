/**
 * Instagram-specific handler
 *
 * Instagram wraps each <video> in a chain of `position: relative; z-index: 0`
 * divs, and renders its native click layer (the `role="group"` player
 * overlay that owns tap-to-pause and mute) in a *sibling* subtree of that
 * chain. Every z-index:0 ancestor is its own stacking context, so the
 * controller's z-index is trapped inside the video branch and the overlay,
 * later in DOM order, paints and hit-tests above it: the speed indicator is
 * visible but no button receives a click (#1657).
 *
 * Fix: promote insertion to the nearest ancestor that also holds the overlay
 * subtree, so the controller competes in the same stacking context as the
 * overlay and its z-index wins there. Same shape as DailymotionHandler, but
 * the depth varies by surface (Reels, feed, post modal), so we search for
 * the overlay instead of hard-coding a hop count.
 */

window.VSC = window.VSC || {};

// The overlay is located structurally by role, not by aria-label: Instagram
// localizes the label ("Video player", "Player de vídeo", ...) per UI language.
const INSTAGRAM_OVERLAY_SELECTOR = '[role="group"]';

// Bounds the walk so an unexpected layout degrades to default placement
// instead of hoisting the controller toward <body>. Observed depth is ~8.
const INSTAGRAM_MAX_PROMOTION_DEPTH = 12;

class InstagramHandler extends window.VSC.BaseSiteHandler {
  static matches() {
    return location.hostname === 'www.instagram.com';
  }

  getControllerPosition(parent, video) {
    const targetParent = this.findOverlayContainer(parent, video) || parent;

    return {
      insertionPoint: targetParent,
      insertionMethod: 'firstChild',
      targetParent: targetParent,
    };
  }

  /**
   * Walk up from the video's parent to the first ancestor with a child
   * subtree that holds the native overlay but not this video.
   * @param {HTMLElement} parent - Video's parent element
   * @param {HTMLElement} video - Video element
   * @returns {HTMLElement|null} Shared container, or null when not found
   * @private
   */
  findOverlayContainer(parent, video) {
    let branch = parent;

    for (let depth = 0; depth < INSTAGRAM_MAX_PROMOTION_DEPTH; depth += 1) {
      const ancestor = branch.parentElement;
      if (!ancestor || ancestor === document.body) {
        return null;
      }

      for (const sibling of ancestor.children) {
        if (sibling === branch || sibling.contains(video)) {
          continue;
        }
        if (
          sibling.matches(INSTAGRAM_OVERLAY_SELECTOR) ||
          sibling.querySelector(INSTAGRAM_OVERLAY_SELECTOR)
        ) {
          return ancestor;
        }
      }

      branch = ancestor;
    }

    return null;
  }
}

window.VSC.InstagramHandler = InstagramHandler;
