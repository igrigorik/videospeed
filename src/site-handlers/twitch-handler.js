/**
 * Twitch-specific handler (#1651)
 *
 * Twitch's player core listens for `ratechange` on its <video>, forwards the
 * observed rate to its worker, and the worker answers with a setPlaybackRate
 * RPC clamped to the player's 2x ceiling. Because that answer arrives
 * asynchronously (after a worker round trip), the reactive-echo guard in
 * SpeedArbitration cannot attribute it to VSC's write: each VSC write above
 * 2x is followed by an "autonomous" reset to 2x, VSC fights until its budget
 * is spent, then stands down at 2x.
 *
 * The player core never re-asserts its rate on its own (seek, pause/play
 * and buffering all leave the register alone); it only reacts to rates it
 * observes. So the fix is to keep it from observing VSC writes it would
 * clamp: those echoes are stopped at VSC's document-capture listener, before
 * the player's target-phase listener. Writes at or below the ceiling stay
 * visible so Twitch's own speed menu keeps tracking them.
 */

window.VSC = window.VSC || {};

class TwitchHandler extends window.VSC.BaseSiteHandler {
  static matches(hostname = location.hostname) {
    // Covers www., m. and the player.twitch.tv embed frame, which runs the
    // same player core.
    return hostname === 'twitch.tv' || hostname.endsWith('.twitch.tv');
  }

  hidesRateEcho(_video, rate) {
    return rate > TwitchHandler.NATIVE_MAX_RATE;
  }
}

// Highest rate Twitch's player accepts without clamping.
TwitchHandler.NATIVE_MAX_RATE = 2;

window.VSC.TwitchHandler = TwitchHandler;
