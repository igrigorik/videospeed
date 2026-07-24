/**
 * Timing-constant coherence tripwires.
 *
 * These constants form a geometry, not a set of independent knobs: each value
 * is valid only relative to its neighbours and to two measured external
 * anchors. The assertions encode those derivation constraints so a future
 * "just bump it" edit fails loudly here instead of silently breaking
 * classification or recovery behavior.
 *
 * External anchors (measured, not ours to tune):
 * - YouTube's speedmaster engages its temporary 2x after 500ms of hold
 *   (`new g.RE(this.tw, 500)` in player base.js; field traces show the boost
 *   ratechange ~507ms after pointerdown). If YouTube ships a different delay,
 *   revisit LONG_PRESS_CLICK_MS.
 * - Deliberate UI clicks press for roughly 80-250ms; hesitation happens
 *   before pressing, not while the button is down.
 * - The release ratechange (YouTube's Iu() restore write) and the release
 *   click both arrive within the same input turn as pointerup.
 */

const YOUTUBE_SPEEDMASTER_ENGAGE_MS = 500;
const MAX_ORDINARY_CLICK_PRESS_MS = 250;

describe('timing constant geometry', () => {
  const IC = () => window.VSC.IntentClassifier;
  const SA = () => window.VSC.SpeedArbitration;

  it('long-press threshold separates ordinary clicks from boost-producing holds', () => {
    // Every hold that engaged the boost was pressed longer than YouTube's
    // engagement delay, so any threshold below it suppresses 100% of boost
    // release clicks; staying above ordinary click presses keeps genuine
    // menu clicks usable as intent evidence.
    expect(IC().LONG_PRESS_CLICK_MS).toBeGreaterThan(MAX_ORDINARY_CLICK_PRESS_MS);
    expect(IC().LONG_PRESS_CLICK_MS).toBeLessThan(YOUTUBE_SPEEDMASTER_ENGAGE_MS);
  });

  it('long-press grace covers same-turn release clicks without eating re-clicks', () => {
    // The release click shares the pointerup input turn (zero to a few ms).
    // A human cannot complete a separate deliberate click within ~200ms of
    // releasing a long press, so the grace window must stay below that.
    expect(IC().LONG_PRESS_CLICK_GRACE_MS).toBeGreaterThan(0);
    expect(IC().LONG_PRESS_CLICK_GRACE_MS).toBeLessThanOrEqual(200);
  });

  it('stale-bind window comfortably exceeds press-to-boost latency', () => {
    // A real hold's 2x ratechange arrives one engagement delay after its
    // press; an unresolved press must never age out before that write. The
    // ceiling keeps a pointer whose terminal was lost outside the window
    // from blessing spurious rate changes indefinitely.
    expect(IC().UNRESOLVED_BIND_MAX_AGE_MS).toBeGreaterThan(YOUTUBE_SPEEDMASTER_ENGAGE_MS + 100);
    expect(IC().UNRESOLVED_BIND_MAX_AGE_MS).toBeLessThanOrEqual(10000);
  });

  it('echo tokens expire well inside one fight window', () => {
    // A stale echo surviving across a forgiveness boundary could swallow a
    // real site reset that should have counted as a fresh fight...
    expect(SA().ECHO_TTL_MS).toBeLessThan(SA().FIGHT_WINDOW_MS);
    // ...but tokens must outlive normal same-macrotask ratechange delivery.
    expect(SA().ECHO_TTL_MS).toBeGreaterThanOrEqual(100);
  });

  it('temporary-release fallback loses the race to a normal release ratechange', () => {
    // YouTube writes its restore rate in the same tick as the release, so a
    // couple of frames of headroom keeps the event-driven path primary. The
    // ceiling bounds how long a stranded 2x overlay can outlive its hold.
    expect(SA().TEMPORARY_RELEASE_FALLBACK_MS).toBeGreaterThanOrEqual(50);
    expect(SA().TEMPORARY_RELEASE_FALLBACK_MS).toBeLessThanOrEqual(500);
  });

  it('the gesture window nests inside the sequence and quiet windows', () => {
    // A click sequence means "last click inside the gesture window, previous
    // click inside the sequence window": the tiers only compose when nested.
    expect(IC().USER_GESTURE_WINDOW_MS).toBeLessThan(IC().CLICK_SEQUENCE_WINDOW_MS);
    // Quiet means "no input for a while"; it must dominate the gesture
    // window or one reset could read as both quiet and user-gestured.
    expect(IC().USER_GESTURE_WINDOW_MS).toBeLessThan(IC().QUIET_CONTEXT_MS);
  });
});
