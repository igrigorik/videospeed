/**
 * New York Times-specific handler
 *
 * NYT's "betamax" player renders every <video> inside the open shadow root of
 * a <nyt-betamax> element as `<video muted loop playsinline>` with no native
 * `controls` attribute (it draws its own overlay). That matches the generic
 * gif-video filter in SiteHandlerManager, so without this handler every NYT
 * video is discarded at scan time and never gets a controller.
 *
 * The player also lives in shadow DOM, which the initial light scan skips; the
 * shadow-DOM scan only runs when the light scan finds nothing. Article pages
 * with a light-DOM <audio> (e.g. podcast episodes) therefore never reach the
 * video, so detectSpecialVideos() surfaces betamax videos directly.
 */

const NYT_PLAYER_HOST = 'nyt-betamax';
// Custom elements known to wrap betamax players in their own shadow root
// (e.g. the vertical feed on /video/ pages).
const NYT_PLAYER_WRAPPERS = 'nyt-video-feed, nyt-betamax-pool';

window.VSC = window.VSC || {};

class NYTimesHandler extends window.VSC.BaseSiteHandler {
  static matches() {
    return /(^|\.)nytimes\.com$/.test(location.hostname);
  }

  /**
   * Real NYT player videos look gif-like but are full videos.
   * @param {HTMLMediaElement} video
   * @returns {boolean}
   */
  allowsGifLikeVideo(video) {
    const root = video.getRootNode && video.getRootNode();
    const host = root && root.host;
    return !!host && host.localName === NYT_PLAYER_HOST;
  }

  /**
   * Find videos inside betamax players, including players nested in known
   * wrapper elements' shadow roots.
   * @param {Document|ShadowRoot} root
   * @returns {Array<HTMLMediaElement>}
   */
  detectSpecialVideos(root, depth = 0) {
    if (!root || depth > 3) {
      return [];
    }
    const videos = [];
    root.querySelectorAll(NYT_PLAYER_HOST).forEach((host) => {
      if (host.shadowRoot) {
        videos.push(...host.shadowRoot.querySelectorAll('video'));
      }
    });
    root.querySelectorAll(NYT_PLAYER_WRAPPERS).forEach((wrapper) => {
      videos.push(...this.detectSpecialVideos(wrapper.shadowRoot, depth + 1));
    });
    return videos;
  }
}

window.VSC.NYTimesHandler = NYTimesHandler;
