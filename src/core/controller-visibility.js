/**
 * Pure controller-visibility policy.
 *
 * The DOM adapter stores these fields as host classes/attributes and lets the
 * shadow CSS render them. Keeping the transition relation pure gives unit,
 * differential, browser, and TLA+ checks one shared vocabulary.
 */

window.VSC = window.VSC || {};

class ControllerVisibility {
  static OVERRIDES = Object.freeze({
    AUTO: 'auto',
    SHOW: 'show',
    HIDE: 'hide',
  });

  static FLASH = Object.freeze({
    NONE: 'none',
    TIMED_ARMED: 'timed-armed',
    TIMED_DUE: 'timed-due',
    PERSISTENT: 'persistent',
  });

  static MEDIA_TYPES = Object.freeze({
    VIDEO: 'video',
    AUDIO: 'audio',
  });

  static EVENTS = Object.freeze({
    TOGGLE: 'TOGGLE',
    FLASH_REQUEST: 'FLASH_REQUEST',
    TIMER_TICK: 'TIMER_TICK',
    FLASH_EXPIRE: 'FLASH_EXPIRE',
    AUTOMATIC_HIDE: 'AUTOMATIC_HIDE',
    AUTOMATIC_SHOW: 'AUTOMATIC_SHOW',
    SET_SITE_AUTOHIDE: 'SET_SITE_AUTOHIDE',
    SET_SOURCE_AVAILABLE: 'SET_SOURCE_AVAILABLE',
    SET_HOST_HIDDEN: 'SET_HOST_HIDDEN',
    SET_START_HIDDEN: 'SET_START_HIDDEN',
    RELEASE: 'RELEASE',
  });

  /**
   * Create one controller's bounded model state.
   * @param {Object} [values]
   * @returns {Object}
   */
  static createState(values = {}) {
    const state = {
      attached: true,
      override: this.OVERRIDES.AUTO,
      automaticHidden: false,
      noSource: false,
      siteAutohide: false,
      hostHidden: false,
      flash: this.FLASH.NONE,
      startHidden: false,
      mediaType: this.MEDIA_TYPES.VIDEO,
      ...values,
    };
    this.assertState(state);
    return state;
  }

  /**
   * Treat absent or page-forged values as AUTO rather than creating a fourth
   * state that neither the CSS nor the formal model understands.
   * @param {*} value
   * @returns {'auto'|'show'|'hide'}
   */
  static normalizeOverride(value) {
    return Object.values(this.OVERRIDES).includes(value) ? value : this.OVERRIDES.AUTO;
  }

  /**
   * Abstract the actual CSS precedence relation.
   * @param {Object} state
   * @returns {boolean}
   */
  static isVisible(state) {
    this.assertState(state);
    if (
      !state.attached ||
      state.hostHidden ||
      state.noSource ||
      state.override === this.OVERRIDES.HIDE
    ) {
      return false;
    }
    if (state.override === this.OVERRIDES.SHOW || state.flash !== this.FLASH.NONE) {
      return true;
    }
    return !state.automaticHidden && !state.siteAutohide;
  }

  /**
   * The first toggle opposes pre-action rendering; later toggles alternate
   * persistent SHOW/HIDE intent. AUTO is re-entered only by controller release.
   * The adapter must sample rendering before cancelling flash.
   * @param {*} override
   * @param {boolean} [renderedVisible] - Required only when toggling from AUTO
   * @returns {'show'|'hide'}
   */
  static nextOverride(override, renderedVisible) {
    const current = this.normalizeOverride(override);
    if (current === this.OVERRIDES.SHOW) {
      return this.OVERRIDES.HIDE;
    }
    if (current === this.OVERRIDES.HIDE) {
      return this.OVERRIDES.SHOW;
    }
    if (typeof renderedVisible !== 'boolean') {
      throw new TypeError('renderedVisible must be boolean when toggling from AUTO');
    }
    return renderedVisible ? this.OVERRIDES.HIDE : this.OVERRIDES.SHOW;
  }

  /**
   * startHidden and explicit HIDE are the only policy-level flash blockers.
   * Source/automatic/site hiding remains render-layer state so a flash can
   * provide feedback without corrupting AUTO.
   * @param {Object} input
   * @returns {boolean}
   */
  static allowsFlash(input) {
    return (
      input?.attached !== false &&
      !input?.startHidden &&
      this.normalizeOverride(input?.override) !== this.OVERRIDES.HIDE
    );
  }

  /**
   * Apply one pure visibility event.
   * @param {Object} state
   * @param {{type: string, value?: boolean, renderedVisible?: boolean}} event
   * @returns {Object}
   */
  static step(state, event) {
    this.assertState(state);
    if (!event || typeof event.type !== 'string') {
      throw new TypeError('visibility event requires a type');
    }

    const next = { ...state };
    switch (event.type) {
      case this.EVENTS.TOGGLE:
        if (state.attached) {
          const renderedVisible =
            event.renderedVisible === undefined
              ? this.isVisible(state)
              : this.requireBoolean(event.renderedVisible, 'renderedVisible');
          next.override = this.nextOverride(state.override, renderedVisible);
          next.flash = this.FLASH.NONE;
        }
        break;

      case this.EVENTS.FLASH_REQUEST:
        if (this.allowsFlash(state)) {
          next.flash =
            state.mediaType === this.MEDIA_TYPES.AUDIO
              ? this.FLASH.PERSISTENT
              : this.FLASH.TIMED_ARMED;
        }
        break;

      case this.EVENTS.TIMER_TICK:
        if (state.attached && state.flash === this.FLASH.TIMED_ARMED) {
          next.flash = this.FLASH.TIMED_DUE;
        }
        break;

      case this.EVENTS.FLASH_EXPIRE:
        if (state.attached && state.flash === this.FLASH.TIMED_DUE) {
          next.flash = this.FLASH.NONE;
        }
        break;

      case this.EVENTS.AUTOMATIC_HIDE:
        if (state.attached) {
          next.automaticHidden = true;
        }
        break;

      case this.EVENTS.AUTOMATIC_SHOW:
        if (state.attached && !state.startHidden) {
          next.automaticHidden = false;
        }
        break;

      case this.EVENTS.SET_SITE_AUTOHIDE:
        if (state.attached) {
          next.siteAutohide = this.requireBoolean(event.value, 'value');
        }
        break;

      case this.EVENTS.SET_SOURCE_AVAILABLE:
        if (state.attached) {
          next.noSource = !this.requireBoolean(event.value, 'value');
        }
        break;

      case this.EVENTS.SET_HOST_HIDDEN:
        if (state.attached) {
          next.hostHidden = this.requireBoolean(event.value, 'value');
        }
        break;

      case this.EVENTS.SET_START_HIDDEN:
        next.startHidden = this.requireBoolean(event.value, 'value');
        break;

      case this.EVENTS.RELEASE:
        next.attached = false;
        next.override = this.OVERRIDES.AUTO;
        next.flash = this.FLASH.NONE;
        break;

      default:
        throw new TypeError(`Unknown visibility event ${event.type}`);
    }

    this.assertState(next);
    return next;
  }

  static requireBoolean(value, name) {
    if (typeof value !== 'boolean') {
      throw new TypeError(`${name} must be boolean`);
    }
    return value;
  }

  static assertState(state) {
    if (!state || typeof state !== 'object') {
      throw new TypeError('visibility state must be an object');
    }
    for (const key of [
      'attached',
      'automaticHidden',
      'noSource',
      'siteAutohide',
      'hostHidden',
      'startHidden',
    ]) {
      this.requireBoolean(state[key], key);
    }
    if (!Object.values(this.OVERRIDES).includes(state.override)) {
      throw new TypeError(`invalid visibility override ${state.override}`);
    }
    if (!Object.values(this.FLASH).includes(state.flash)) {
      throw new TypeError(`invalid flash state ${state.flash}`);
    }
    if (!Object.values(this.MEDIA_TYPES).includes(state.mediaType)) {
      throw new TypeError(`invalid media type ${state.mediaType}`);
    }
    if (
      !state.attached &&
      (state.override !== this.OVERRIDES.AUTO || state.flash !== this.FLASH.NONE)
    ) {
      throw new TypeError('detached visibility state must be AUTO with no flash');
    }
    if (
      state.mediaType === this.MEDIA_TYPES.AUDIO &&
      (state.flash === this.FLASH.TIMED_ARMED || state.flash === this.FLASH.TIMED_DUE)
    ) {
      throw new TypeError('audio visibility state cannot carry a timed flash');
    }
    if (state.mediaType === this.MEDIA_TYPES.VIDEO && state.flash === this.FLASH.PERSISTENT) {
      throw new TypeError('video visibility state cannot carry a persistent flash');
    }
    if (state.override === this.OVERRIDES.HIDE && state.flash !== this.FLASH.NONE) {
      throw new TypeError('explicit HIDE cannot coexist with flash');
    }
  }
}

window.VSC.ControllerVisibility = ControllerVisibility;
