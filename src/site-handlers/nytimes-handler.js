/**
 * New York Times-specific handler
 *
 * NYT's "betamax" player renders every <video> inside the open shadow root of
 * a <nyt-betamax> element as `<video muted loop playsinline>` with no native
 * `controls` attribute (it draws its own overlay). That matches the generic
 * gif-video filter in SiteHandlerManager, so without this handler every NYT
 * video is discarded at scan time and never gets a controller.
 */

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
    return !!host && host.localName === 'nyt-betamax';
  }
}

window.VSC.NYTimesHandler = NYTimesHandler;
