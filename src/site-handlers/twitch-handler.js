/**
 * Twitch-specific handler
 *
 * Twitch's player core runs in a worker and treats the <video> element as a
 * sink. A ratechange it did not request (rate !== its expectedRateChange) is
 * posted to the worker as setPlaybackRate(rate); the worker clamps to its
 * menu range [0.25, 2] and RPCs the clamped value back onto the element about
 * a millisecond later. Every VSC write above 2x is therefore vetoed
 * asynchronously (issue #1651).
 *
 * The veto arrives as a fresh ratechange after the original dispatch has
 * finished, so the generic synchronous rewrite proof cannot attribute it, and
 * a visible fight-back retry would just be clamped again. Hiding VSC's own
 * echoes keeps the write away from the sink listener entirely: the worker
 * never sees it and never answers. Twitch's own menu still works because its
 * writes reach VSC as external changes and are classified normally; Twitch's
 * menu label is left showing its own last rate.
 */

window.VSC = window.VSC || {};

class TwitchHandler extends window.VSC.BaseSiteHandler {
  static matches() {
    return /(^|\.)twitch\.tv$/.test(location.hostname);
  }

  hidesRateEchoes(_video) {
    return true;
  }
}

window.VSC.TwitchHandler = TwitchHandler;
