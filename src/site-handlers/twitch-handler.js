/**
 * Twitch-specific handler
 *
 * Twitch's player (Amazon IVS player-core) mirrors every unexpected native
 * ratechange into its worker-side core, which clamps the rate to the menu
 * range [0.25, 2] and RPCs the clamped value back onto the <video>. The
 * round-trip is asynchronous, so VSC sees the clamp as an ordinary autonomous
 * site write: it fights back MAX_FIGHT times, each retry is observed and
 * clamped again, and VSC surrenders at 2x (#1651).
 *
 * The page only learns about a rate through the target-phase ratechange
 * listener on the <video>. VSC's document-capture listener runs first, so a
 * write whose echo is hidden from the page is never mirrored into the core and
 * never clamped. Only rates Twitch would clamp are hidden: in-range writes
 * stay observable so Twitch's own speed menu and core state stay in sync.
 */

window.VSC = window.VSC || {};

// player-core clamps playback rate to this range (see its
// `k(rate, .25, 2)` in the element-attribute path and the worker RPC).
const TWITCH_MIN_RATE = 0.25;
const TWITCH_MAX_RATE = 2;

class TwitchHandler extends window.VSC.BaseSiteHandler {
  static matches() {
    return /(^|\.)twitch\.tv$/.test(location.hostname);
  }

  /**
   * Hide echoes for rates the player core would clamp.
   * @param {HTMLMediaElement} _video
   * @param {number} speed
   * @returns {boolean}
   */
  hidesRateEcho(_video, speed) {
    return speed > TWITCH_MAX_RATE || speed < TWITCH_MIN_RATE;
  }
}

window.VSC.TwitchHandler = TwitchHandler;
