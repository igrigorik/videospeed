/**
 * Intent classifier — the heuristic half of the speed arbitration split
 * (docs/speed-arbitration.md, "Architecture: classifier vs. arbiter").
 *
 * Consumes gesture observations (clicks, unhandled keys, pointer state) and
 * classifies each external ratechange as USER_INTENT / AUTONOMOUS /
 * INIT_NOISE / SELF. Every heuristic cites the evidence that motivated it;
 * ALL such heuristics live here and only here. The arbiter guarantees that
 * classifier mistakes are recoverable, never correct — see the contract doc.
 *
 * Two rule sets:
 *   LEGACY_RULES — current master behavior, for differential verification:
 *     any unhandled key and any click arm the gesture window. Known false
 *     positives: arrow-key seek (#1562/#1546), progress-bar clicks (#1581).
 *   TARGET_RULES — the corrected heuristics:
 *     only native speed shortcut keys arm the window (PR #1563), and a held
 *     pointer counts as an ongoing gesture (PR #1555, #1554). Clicks still
 *     arm the window — narrowing them safely needs per-site signatures and
 *     remains an open classifier gap (#1581).
 */

window.VSC = window.VSC || {};

const CLASSIFIER_VERDICTS = Object.freeze({
  SELF: 'SELF', // our own write echoing back — filtered before the arbiter
  USER_INTENT: 'USER_INTENT',
  AUTONOMOUS: 'AUTONOMOUS',
  INIT_NOISE: 'INIT_NOISE',
});

const LEGACY_RULES = Object.freeze({
  anyUnhandledKeyArms: true, // any key blesses the next ratechange
  clickArms: true,
  pointerHoldArms: false, // click-and-hold invisible until mouseup (#1554)
});

const TARGET_RULES = Object.freeze({
  anyUnhandledKeyArms: false, // only native speed shortcuts (PR #1563)
  clickArms: true, // open gap: #1581 needs per-site narrowing
  pointerHoldArms: true, // held pointer = ongoing gesture (PR #1555)
});

const USER_GESTURE_WINDOW_MS = 300; // ms after a gesture in which a ratechange reads as intent

/**
 * Native speed shortcut detection (PR #1563): YouTube's < / > keys.
 */
function isNativeSpeedShortcutKey(event) {
  return (
    event.key === '<' ||
    event.key === '>' ||
    ((event.code === 'Comma' || event.keyCode === 188) && event.shiftKey) ||
    ((event.code === 'Period' || event.keyCode === 190) && event.shiftKey)
  );
}

class IntentClassifier {
  constructor(options = {}) {
    this.rules = options.rules || TARGET_RULES;
    this.minRate = options.minRate ?? 0.07; // SPEED_LIMITS.MIN
    this.lastGestureAt = 0;
    this.pointerHeld = false;
  }

  /** A keydown no VSC binding handled. */
  observeUnhandledKey(event) {
    if (this.rules.anyUnhandledKeyArms || isNativeSpeedShortcutKey(event)) {
      this.lastGestureAt = event.timeStamp;
    }
  }

  /** A click that did not target the VSC controller. */
  observeClick(event) {
    if (this.rules.clickArms) {
      this.lastGestureAt = event.timeStamp;
    }
    if (this.rules.pointerHoldArms) {
      this.pointerHeld = false; // click fires on release
    }
  }

  /** Pointer pressed outside the VSC controller (PR #1555). */
  observePointerDown(event) {
    if (this.rules.pointerHoldArms) {
      this.pointerHeld = true;
      this.lastGestureAt = event.timeStamp;
    }
  }

  /**
   * Classify an external ratechange. Mirrors the guard order of the legacy
   * handleRateChange so differential replay is faithful.
   *
   * @param {Object} ctx - { rate, timeStamp, readyState, detail }
   * @returns {string} one of CLASSIFIER_VERDICTS
   */
  classify(ctx) {
    if (ctx.detail && ctx.detail.origin === 'videoSpeed') {
      return CLASSIFIER_VERDICTS.SELF;
    }
    if (ctx.readyState < 1) {
      return CLASSIFIER_VERDICTS.INIT_NOISE;
    }
    if (typeof ctx.rate === 'number' && !isNaN(ctx.rate) && ctx.rate <= this.minRate) {
      return CLASSIFIER_VERDICTS.INIT_NOISE;
    }

    const sinceGesture = ctx.timeStamp - this.lastGestureAt;
    const inWindow =
      this.lastGestureAt > 0 && sinceGesture >= 0 && sinceGesture < USER_GESTURE_WINDOW_MS;
    if (inWindow || (this.rules.pointerHoldArms && this.pointerHeld)) {
      return CLASSIFIER_VERDICTS.USER_INTENT;
    }
    return CLASSIFIER_VERDICTS.AUTONOMOUS;
  }

  /**
   * One-shot semantics: called by the adapter when a USER_INTENT verdict was
   * actually adopted, mirroring legacy's lastUserInteractionAt = 0 reset in
   * the accept branch.
   */
  consumeGesture() {
    this.lastGestureAt = 0;
  }
}

window.VSC.IntentClassifier = IntentClassifier;
window.VSC.IntentClassifier.VERDICTS = CLASSIFIER_VERDICTS;
window.VSC.IntentClassifier.LEGACY_RULES = LEGACY_RULES;
window.VSC.IntentClassifier.TARGET_RULES = TARGET_RULES;
window.VSC.IntentClassifier.USER_GESTURE_WINDOW_MS = USER_GESTURE_WINDOW_MS;
window.VSC.IntentClassifier.isNativeSpeedShortcutKey = isNativeSpeedShortcutKey;
