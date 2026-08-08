/**
 * IntentClassifier evidence-attribution tests.
 *
 * The classifier remains heuristic, but resolved click evidence must never
 * cross from one controlled media element to another.
 */

function verdicts() {
  return window.VSC.IntentClassifier.VERDICTS;
}

function context(media, rate = 1.0, timeStamp = 250) {
  return { media, rate, timeStamp, readyState: 4, detail: null };
}

function pointerHoldClassifier() {
  return new window.VSC.IntentClassifier({ rules: { pointerHoldArms: true } });
}

describe('IntentClassifier click attribution', () => {
  it('activates the hold signature only through a site handler declaration', () => {
    // Generic default: no site trust without a handler declaration.
    expect(window.VSC.IntentClassifier.TARGET_RULES.pointerHoldArms).toBe(false);
    expect(new window.VSC.BaseSiteHandler().getClassifierRules()).toBe(null);

    // YouTube declares the hold flags for its matches() hosts; hostname
    // gating itself is owned by the handler registry (see
    // youtube-handler.test.js for www/nocookie/music coverage).
    const declared = new window.VSC.YouTubeHandler().getClassifierRules();
    expect(declared).toEqual({ pointerHoldArms: true, spacebarArms: true });
    expect(Object.isFrozen(declared)).toBe(true);
  });

  it('keeps a resolved click sequence scoped to its media element', () => {
    const classifier = new window.VSC.IntentClassifier();
    const videoA = document.createElement('video');
    const videoB = document.createElement('video');

    classifier.observeClick({ timeStamp: 100 }, videoA);
    classifier.observeClick({ timeStamp: 200 }, videoA);

    expect(classifier.classify(context(videoA))).toBe(verdicts().USER_INTENT);
    expect(classifier.classify(context(videoB))).toBe(verdicts().AUTONOMOUS);
  });

  it('retains unresolved click evidence as the backward-compatible fallback', () => {
    const classifier = new window.VSC.IntentClassifier();
    const videoA = document.createElement('video');
    const videoB = document.createElement('video');

    classifier.observeClick({ timeStamp: 100 });
    classifier.observeClick({ timeStamp: 200 });

    expect(classifier.classify(context(videoA))).toBe(verdicts().USER_INTENT);
    expect(classifier.classify(context(videoB))).toBe(verdicts().USER_INTENT);
  });

  it('does not synthesize a strong sequence from scoped and unresolved clicks', () => {
    const classifier = new window.VSC.IntentClassifier();
    const video = document.createElement('video');

    classifier.observeClick({ timeStamp: 100 }, video);
    classifier.observeClick({ timeStamp: 200 });

    // Each ledger has only weak evidence, so a 1x reset remains autonomous.
    expect(classifier.classify(context(video))).toBe(verdicts().AUTONOMOUS);
  });

  it('keeps a resolved pointer temporary override scoped to its media element', () => {
    const classifier = pointerHoldClassifier();
    const videoA = document.createElement('video');
    const videoB = document.createElement('video');

    classifier.observePointerDown({ pointerId: 7, timeStamp: 100 }, videoA);

    expect(classifier.classify(context(videoA, 2.0))).toBe(verdicts().TEMPORARY_OVERRIDE);
    expect(classifier.classify(context(videoB, 2.0))).toBe(verdicts().AUTONOMOUS);

    classifier.observePointerEnd({ pointerId: 7, timeStamp: 200 });
    expect(classifier.classify(context(videoA, 2.0))).toBe(verdicts().AUTONOMOUS);
  });

  it('prioritizes a strong native speed choice over a concurrent pointer hold', () => {
    const classifier = pointerHoldClassifier();
    const video = document.createElement('video');

    classifier.observePointerDown({ pointerId: 7, timeStamp: 100 }, video);
    classifier.observeUnhandledKey({ key: '>', timeStamp: 150 });

    expect(classifier.classify(context(video, 2.0, 200))).toBe(verdicts().USER_INTENT);
    expect(classifier.hasStrongIntent({ media: video, timeStamp: 200 })).toBe(true);
  });

  it('keeps A temporary-hold evidence when B adopts a durable native choice', () => {
    const classifier = pointerHoldClassifier();
    const videoA = document.createElement('video');
    const videoB = document.createElement('video');

    classifier.observePointerDown({ pointerId: 7, timeStamp: 100 }, videoA);
    expect(classifier.classify(context(videoA, 2.0, 150))).toBe(verdicts().TEMPORARY_OVERRIDE);

    classifier.consumeGesture(videoB);

    expect(classifier.classify(context(videoA, 2.0, 200))).toBe(verdicts().TEMPORARY_OVERRIDE);
  });

  it('binds an unresolved pointer temporary override to its first ratechange target', () => {
    const classifier = pointerHoldClassifier();
    const videoA = document.createElement('video');
    const videoB = document.createElement('video');

    classifier.observePointerDown({ pointerId: 7, timeStamp: 100 });

    expect(classifier.classify(context(videoA, 2.0))).toBe(verdicts().TEMPORARY_OVERRIDE);
    // Once the actual boost identifies A, the unresolved hold must not bless B.
    expect(classifier.classify(context(videoB, 2.0))).toBe(verdicts().AUTONOMOUS);
  });

  it('binds the newest unresolved pointer even when a stale pointer id lingers', () => {
    const classifier = pointerHoldClassifier();
    const video = document.createElement('video');

    // Pointer 3 was released outside the window: no pointerup ever arrived.
    classifier.observePointerDown({ pointerId: 3, timeStamp: 100 });
    classifier.observePointerDown({ pointerId: 7, timeStamp: 5000 });

    expect(classifier.classify(context(video, 2.0, 5520))).toBe(verdicts().TEMPORARY_OVERRIDE);
    expect(classifier.pointerOwners.get(7)?.media).toBe(video);
    expect(classifier.pointerOwners.get(3)?.media).toBe(null);

    classifier.observePointerEnd({ pointerId: 7, timeStamp: 5600 });
    expect(classifier.classify(context(video, 2.0, 5620))).toBe(verdicts().AUTONOMOUS);
  });

  it('ignores the release click of a completed long press', () => {
    const classifier = pointerHoldClassifier();
    const video = document.createElement('video');

    classifier.observePointerDown({ pointerId: 7, timeStamp: 100 }, video);
    classifier.observePointerEnd({ pointerId: 7, timeStamp: 700 });
    classifier.observeClick({ timeStamp: 702 }, video);

    // The suppressed click must not arm the gesture window for a durable
    // adoption of the site's release-time rate write.
    expect(classifier.classify(context(video, 1.75, 710))).toBe(verdicts().AUTONOMOUS);
  });

  it('keeps counting ordinary short clicks as intent evidence', () => {
    const classifier = pointerHoldClassifier();
    const video = document.createElement('video');

    classifier.observePointerDown({ pointerId: 7, timeStamp: 100 }, video);
    classifier.observePointerEnd({ pointerId: 7, timeStamp: 220 });
    classifier.observeClick({ timeStamp: 222 }, video);

    expect(classifier.classify(context(video, 1.75, 240))).toBe(verdicts().USER_INTENT);
  });

  it('waits for a remaining pointer after Space releases on the same media', () => {
    const classifier = new window.VSC.IntentClassifier({
      rules: { pointerHoldArms: true, spacebarArms: true },
    });
    const video = document.createElement('video');

    classifier.observeUnhandledKey({ code: 'Space', keyCode: 32, timeStamp: 100 });
    expect(classifier.classify(context(video, 2.0, 150))).toBe(verdicts().TEMPORARY_OVERRIDE);
    classifier.observePointerDown({ pointerId: 7, timeStamp: 160 }, video);

    expect(classifier.observeKeyEnd({ code: 'Space', keyCode: 32, timeStamp: 200 })).toBe(null);
    expect(classifier.classify(context(video, 2.0, 220))).toBe(verdicts().TEMPORARY_OVERRIDE);
    expect(classifier.observePointerEnd({ pointerId: 7, timeStamp: 230 })).toEqual([video]);
  });

  it('binds Space to an existing pointer hold so the final keyup can release it', () => {
    const classifier = new window.VSC.IntentClassifier({
      rules: { pointerHoldArms: true, spacebarArms: true },
    });
    const video = document.createElement('video');

    classifier.observePointerDown({ pointerId: 7, timeStamp: 100 }, video);
    expect(classifier.classify(context(video, 2.0, 150))).toBe(verdicts().TEMPORARY_OVERRIDE);
    classifier.observeUnhandledKey({ code: 'Space', keyCode: 32, timeStamp: 160 });
    expect(classifier.spaceHoldMedia).toBe(video);

    expect(classifier.observePointerEnd({ pointerId: 7, timeStamp: 200 })).toEqual([]);
    expect(classifier.observeKeyEnd({ code: 'Space', keyCode: 32, timeStamp: 210 })).toBe(video);
  });

  it('treats a held YouTube Space boost as temporary until keyup', () => {
    const classifier = new window.VSC.IntentClassifier({ rules: { spacebarArms: true } });
    const video = document.createElement('video');

    classifier.observeUnhandledKey({ code: 'Space', keyCode: 32, timeStamp: 100 });
    expect(classifier.classify(context(video, 2.0, 620))).toBe(verdicts().TEMPORARY_OVERRIDE);
    expect(classifier.observeKeyEnd({ code: 'Space', keyCode: 32, timeStamp: 700 })).toBe(video);
    expect(classifier.classify(context(video, 2.0, 720))).toBe(verdicts().AUTONOMOUS);
  });

  it('clears resolved pointer evidence when its media is released', () => {
    const classifier = pointerHoldClassifier();
    const video = document.createElement('video');

    classifier.observePointerDown({ pointerId: 7, timeStamp: 100 }, video);
    classifier.releaseMedia(video);

    expect(classifier.classify(context(video, 2.0))).toBe(verdicts().AUTONOMOUS);
    expect(classifier.pointerOwners.size).toBe(0);
  });

  it('consumes both the adopted media ledger and the fallback ledger', () => {
    const classifier = new window.VSC.IntentClassifier();
    const videoA = document.createElement('video');
    const videoB = document.createElement('video');

    classifier.observeClick({ timeStamp: 100 }, videoA);
    classifier.observeClick({ timeStamp: 200 }, videoA);
    classifier.observeClick({ timeStamp: 200 });

    classifier.consumeGesture(videoA);

    expect(classifier.classify(context(videoA))).toBe(verdicts().AUTONOMOUS);
    expect(classifier.classify(context(videoB))).toBe(verdicts().AUTONOMOUS);
  });
});

describe('IntentClassifier side-effect 1.0 demotion (#1600)', () => {
  // The false-positive shape: two chrome clicks (play, then skip/seek) form
  // a strong sequence, and the site's post-seek reset to 1.0 lands inside
  // the gesture window. Without side-effect evidence this was adopted and
  // persisted over the remembered speed.
  function clickSequence(classifier, media = null) {
    classifier.observeClick({ timeStamp: 100 }, media);
    classifier.observeClick({ timeStamp: 200 }, media);
  }

  it('demotes a click-sequence 1.0 adoption that follows a seek', () => {
    const classifier = new window.VSC.IntentClassifier();
    const video = document.createElement('video');

    clickSequence(classifier);
    classifier.observeSeek(video, 210);

    expect(classifier.classify(context(video, 1.0, 250))).toBe(verdicts().AUTONOMOUS);
  });

  it('still adopts a menu "Normal" choice when nothing explains the reset', () => {
    const classifier = new window.VSC.IntentClassifier();
    const video = document.createElement('video');

    clickSequence(classifier);

    expect(classifier.classify(context(video, 1.0, 250))).toBe(verdicts().USER_INTENT);
  });

  it('leaves non-1.0 sequence adoption unaffected by a recent seek', () => {
    const classifier = new window.VSC.IntentClassifier();
    const video = document.createElement('video');

    clickSequence(classifier);
    classifier.observeSeek(video, 210);

    // Sites have no reason to autonomously pick 1.7x; the veto is scoped to
    // the documented false-positive value.
    expect(classifier.classify(context(video, 1.7, 250))).toBe(verdicts().USER_INTENT);
  });

  it('lets a native speed key adopt 1.0 even right after a seek', () => {
    const classifier = new window.VSC.IntentClassifier();
    const video = document.createElement('video');

    classifier.observeSeek(video, 210);
    classifier.observeUnhandledKey({ key: '<', timeStamp: 230 });

    expect(classifier.classify(context(video, 1.0, 250))).toBe(verdicts().USER_INTENT);
  });

  it('demotes a click-sequence 1.0 adoption during the media init grace', () => {
    const classifier = new window.VSC.IntentClassifier();
    const video = document.createElement('video');

    classifier.observeMediaInit(video, 50);
    clickSequence(classifier);

    expect(classifier.classify(context(video, 1.0, 250))).toBe(verdicts().AUTONOMOUS);
  });

  it('expires seek and init evidence after their windows', () => {
    const classifier = new window.VSC.IntentClassifier();
    const video = document.createElement('video');

    classifier.observeSeek(video, 100);
    classifier.observeMediaInit(video, 100);
    classifier.observeClick({ timeStamp: 4000 });
    classifier.observeClick({ timeStamp: 4100 });

    const ts = 100 + window.VSC.IntentClassifier.MEDIA_INIT_GRACE_MS + 2050;
    expect(classifier.classify(context(video, 1.0, ts))).toBe(verdicts().USER_INTENT);
  });

  it('scopes seek evidence to its media element', () => {
    const classifier = new window.VSC.IntentClassifier();
    const videoA = document.createElement('video');
    const videoB = document.createElement('video');

    clickSequence(classifier);
    classifier.observeSeek(videoA, 210);

    expect(classifier.classify(context(videoA, 1.0, 250))).toBe(verdicts().AUTONOMOUS);
    expect(classifier.classify(context(videoB, 1.0, 250))).toBe(verdicts().USER_INTENT);
  });

  it('clears side-effect evidence when its media is released', () => {
    const classifier = new window.VSC.IntentClassifier();
    const video = document.createElement('video');

    classifier.observeSeek(video, 210);
    classifier.releaseMedia(video);
    clickSequence(classifier);

    expect(classifier.classify(context(video, 1.0, 250))).toBe(verdicts().USER_INTENT);
  });
});
