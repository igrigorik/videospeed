/**
 * Executable bounded model for the controller-visibility contract.
 * The matching TLA+ model is specs/ControllerVisibility.tla.
 */

const V = () => window.VSC.ControllerVisibility;
const BOOLS = [false, true];

function expectedVisible(state) {
  if (
    !state.attached ||
    state.hostHidden ||
    state.noSource ||
    state.override === V().OVERRIDES.HIDE
  ) {
    return false;
  }
  return (
    state.override === V().OVERRIDES.SHOW ||
    state.flash !== V().FLASH.NONE ||
    (!state.automaticHidden && !state.siteAutohide)
  );
}

function allValidStates() {
  const states = [];
  for (const mediaType of Object.values(V().MEDIA_TYPES)) {
    const flashModes =
      mediaType === V().MEDIA_TYPES.AUDIO
        ? [V().FLASH.NONE, V().FLASH.PERSISTENT]
        : [V().FLASH.NONE, V().FLASH.TIMED_ARMED, V().FLASH.TIMED_DUE];

    for (const attached of BOOLS) {
      for (const startHidden of BOOLS) {
        for (const automaticHidden of BOOLS) {
          for (const noSource of BOOLS) {
            for (const siteAutohide of BOOLS) {
              for (const hostHidden of BOOLS) {
                for (const override of Object.values(V().OVERRIDES)) {
                  for (const flash of flashModes) {
                    if (
                      !attached &&
                      (override !== V().OVERRIDES.AUTO || flash !== V().FLASH.NONE)
                    ) {
                      continue;
                    }
                    if (override === V().OVERRIDES.HIDE && flash !== V().FLASH.NONE) {
                      continue;
                    }
                    states.push(
                      V().createState({
                        attached,
                        override,
                        automaticHidden,
                        noSource,
                        siteAutohide,
                        hostHidden,
                        flash,
                        startHidden,
                        mediaType,
                      })
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return states;
}

function allEvents() {
  const E = V().EVENTS;
  return [
    { type: E.TOGGLE },
    { type: E.FLASH_REQUEST },
    { type: E.TIMER_TICK },
    { type: E.FLASH_EXPIRE },
    { type: E.AUTOMATIC_HIDE },
    { type: E.AUTOMATIC_SHOW },
    { type: E.SET_SITE_AUTOHIDE, value: false },
    { type: E.SET_SITE_AUTOHIDE, value: true },
    { type: E.SET_SOURCE_AVAILABLE, value: false },
    { type: E.SET_SOURCE_AVAILABLE, value: true },
    { type: E.SET_HOST_HIDDEN, value: false },
    { type: E.SET_HOST_HIDDEN, value: true },
    { type: E.SET_START_HIDDEN, value: false },
    { type: E.SET_START_HIDDEN, value: true },
    { type: E.RELEASE },
  ];
}

function assertSafetyInvariants(state) {
  expect(V().isVisible(state)).toBe(expectedVisible(state));
  if (!state.attached) {
    expect(state.override).toBe(V().OVERRIDES.AUTO);
    expect(state.flash).toBe(V().FLASH.NONE);
    expect(V().isVisible(state)).toBe(false);
  }
  if (state.override === V().OVERRIDES.HIDE) {
    expect(state.flash).toBe(V().FLASH.NONE);
    expect(V().isVisible(state)).toBe(false);
  }
  if (state.noSource || state.hostHidden) {
    expect(V().isVisible(state)).toBe(false);
  }
  if (
    state.attached &&
    !state.noSource &&
    !state.hostHidden &&
    state.override === V().OVERRIDES.SHOW
  ) {
    expect(V().isVisible(state)).toBe(true);
  }
}

describe('ControllerVisibility pure policy', () => {
  it('normalizes only the three declared override values', () => {
    expect(V().normalizeOverride(undefined)).toBe(V().OVERRIDES.AUTO);
    expect(V().normalizeOverride('forged')).toBe(V().OVERRIDES.AUTO);
    expect(V().normalizeOverride(V().OVERRIDES.SHOW)).toBe(V().OVERRIDES.SHOW);
    expect(V().normalizeOverride(V().OVERRIDES.HIDE)).toBe(V().OVERRIDES.HIDE);
  });

  it('implements the complete render precedence relation', () => {
    const states = allValidStates();
    expect(states).toHaveLength(448);
    for (const state of states) {
      assertSafetyInvariants(state);
    }
  });

  it.each([
    ['auto', true, 'hide'],
    ['auto', false, 'show'],
    ['show', true, 'auto'],
    ['show', false, 'auto'],
    ['hide', true, 'auto'],
    ['hide', false, 'auto'],
  ])('maps toggle %s with rendered=%s to %s', (override, rendered, expected) => {
    expect(V().nextOverride(override, rendered)).toBe(expected);
  });

  it('samples flash visibility before TOGGLE clears it', () => {
    const state = V().createState({
      automaticHidden: true,
      siteAutohide: true,
      flash: V().FLASH.TIMED_ARMED,
    });
    expect(V().isVisible(state)).toBe(true);

    const next = V().step(state, { type: V().EVENTS.TOGGLE });
    expect(next.override).toBe(V().OVERRIDES.HIDE);
    expect(next.flash).toBe(V().FLASH.NONE);
    expect(V().isVisible(next)).toBe(false);
  });

  it('models timed video flash and persistent audio flash', () => {
    let video = V().createState();
    video = V().step(video, { type: V().EVENTS.FLASH_REQUEST });
    expect(video.flash).toBe(V().FLASH.TIMED_ARMED);
    video = V().step(video, { type: V().EVENTS.TIMER_TICK });
    expect(video.flash).toBe(V().FLASH.TIMED_DUE);
    video = V().step(video, { type: V().EVENTS.FLASH_EXPIRE });
    expect(video.flash).toBe(V().FLASH.NONE);

    let audio = V().createState({ mediaType: V().MEDIA_TYPES.AUDIO });
    audio = V().step(audio, { type: V().EVENTS.FLASH_REQUEST });
    expect(audio.flash).toBe(V().FLASH.PERSISTENT);
    audio = V().step(audio, { type: V().EVENTS.TIMER_TICK });
    audio = V().step(audio, { type: V().EVENTS.FLASH_EXPIRE });
    expect(audio.flash).toBe(V().FLASH.PERSISTENT);
  });

  it('blocks new flash under startHidden or explicit HIDE without retroactive cancellation', () => {
    const startHidden = V().createState({ startHidden: true, automaticHidden: true });
    expect(V().step(startHidden, { type: V().EVENTS.FLASH_REQUEST })).toEqual(startHidden);

    const hidden = V().createState({ override: V().OVERRIDES.HIDE });
    expect(V().step(hidden, { type: V().EVENTS.FLASH_REQUEST })).toEqual(hidden);

    let active = V().createState({ flash: V().FLASH.TIMED_ARMED });
    active = V().step(active, { type: V().EVENTS.SET_START_HIDDEN, value: true });
    expect(active.startHidden).toBe(true);
    expect(active.flash).toBe(V().FLASH.TIMED_ARMED);
  });

  it('keeps automatic and environment changes below explicit intent', () => {
    let state = V().createState({ override: V().OVERRIDES.SHOW });
    const events = [
      { type: V().EVENTS.AUTOMATIC_HIDE },
      { type: V().EVENTS.SET_SITE_AUTOHIDE, value: true },
      { type: V().EVENTS.SET_SOURCE_AVAILABLE, value: false },
      { type: V().EVENTS.SET_HOST_HIDDEN, value: true },
    ];
    for (const event of events) {
      state = V().step(state, event);
      expect(state.override).toBe(V().OVERRIDES.SHOW);
    }
    expect(V().isVisible(state)).toBe(false);

    state = V().step(state, { type: V().EVENTS.SET_HOST_HIDDEN, value: false });
    state = V().step(state, { type: V().EVENTS.SET_SOURCE_AVAILABLE, value: true });
    expect(V().isVisible(state)).toBe(true);
  });

  it('treats startHidden changes as non-retroactive but blocks automatic show', () => {
    let state = V().createState({ automaticHidden: false });
    state = V().step(state, { type: V().EVENTS.SET_START_HIDDEN, value: true });
    expect(state.automaticHidden).toBe(false);

    state = V().step(state, { type: V().EVENTS.AUTOMATIC_HIDE });
    state = V().step(state, { type: V().EVENTS.AUTOMATIC_SHOW });
    expect(state.automaticHidden).toBe(true);

    state = V().step(state, { type: V().EVENTS.SET_START_HIDDEN, value: false });
    state = V().step(state, { type: V().EVENTS.AUTOMATIC_SHOW });
    expect(state.automaticHidden).toBe(false);
  });

  it('releases override and timer state', () => {
    const active = V().createState({
      override: V().OVERRIDES.SHOW,
      flash: V().FLASH.TIMED_ARMED,
    });
    const released = V().step(active, { type: V().EVENTS.RELEASE });
    expect(released).toMatchObject({
      attached: false,
      override: V().OVERRIDES.AUTO,
      flash: V().FLASH.NONE,
    });
    expect(V().isVisible(released)).toBe(false);
  });
});

describe('ControllerVisibility exhaustive bounded transition model', () => {
  it('preserves every safety invariant across every event from every valid state', () => {
    const states = allValidStates();
    const events = allEvents();
    let transitions = 0;

    for (const state of states) {
      for (const event of events) {
        const next = V().step(state, event);
        assertSafetyInvariants(next);
        transitions += 1;
      }
    }

    expect(transitions).toBe(6720);
  });
});
