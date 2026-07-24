/**
 * Speed arbitration adapter — maps DOM observations onto per-media conflict
 * states while preserving one document/session-wide desired speed.
 *
 * The pure arbiter decides a single media element's next local phase. This
 * adapter owns media-keyed fight timers and echo tokens; config.lastSpeed is
 * the sole shared authority. A new user/native choice advances an in-memory
 * authority epoch, lazily resetting every media's old suppression state.
 */

window.VSC = window.VSC || {};

class SpeedArbitration {
  /**
   * @param {Object} config
   * @param {Object|null} eventManager
   */
  constructor(config, eventManager) {
    this.config = config;
    this.eventManager = eventManager;
    this.classifier = new window.VSC.IntentClassifier({
      // Site handlers declare evidence-rule activations (getClassifierRules);
      // the classifier owns what each flag means. Late-bound through the
      // namespace like resolveGestureMedia: handler detection is lazy and
      // static (matches() on location.hostname), so construction order is
      // irrelevant and non-handler contexts fall back to generic rules.
      rules: Object.freeze({
        ...window.VSC.IntentClassifier.TARGET_RULES,
        ...(window.VSC.siteHandlerManager?.getClassifierRules?.() || {}),
      }),
      minRate: window.VSC.Constants.SPEED_LIMITS.MIN,
    });

    // A desired speed is shared, but a player may independently fight,
    // surrender, or consume its quiet-war re-arm budget.
    this.authorityEpoch = 0;
    this.conflicts = new WeakMap();
    this.timedConflicts = new Set();

    // Native write echoes are also media-local: a token for A must never
    // absorb B's ratechange.
    this.pendingWrites = new WeakMap();

    // A document-capture terminal event runs before some player handlers.
    // Keep a short, cancellable fallback only for a player that never emits
    // its expected normal release ratechange; ordinary releases clear it.
    this.temporaryReleaseTimers = new WeakMap();
    this.pendingTemporaryReleaseTimers = new Set();
  }

  /**
   * Record an extension-issued register write for the media-local echo filter.
   * @param {HTMLMediaElement} video
   * @param {number} rate
   */
  noteWrite(video, rate) {
    let queue = this.pendingWrites.get(video);
    if (!queue) {
      queue = [];
      this.pendingWrites.set(video, queue);
    }
    queue.push({ rate, at: performance.now(), epoch: this.authorityEpoch });
    if (queue.length > SpeedArbitration.ECHO_MAX_PENDING) {
      queue.shift();
    }
  }

  /**
   * @param {HTMLMediaElement} video
   * @param {number} rate
   * @returns {boolean}
   */
  consumeEcho(video, rate) {
    let queue = this.pendingWrites.get(video);
    if (!queue || queue.length === 0) {
      return false;
    }
    const now = performance.now();
    // A fresh user/native choice starts a new authority epoch. An echo from
    // an older epoch must not mask a real site reset that happens to reuse
    // the old rate, even during the short token TTL.
    queue = queue.filter(
      (write) =>
        write.epoch === this.authorityEpoch && now - write.at <= SpeedArbitration.ECHO_TTL_MS
    );
    if (queue.length === 0) {
      this.pendingWrites.delete(video);
      return false;
    }
    this.pendingWrites.set(video, queue);
    const idx = queue.findIndex(
      (write) => Math.abs(write.rate - rate) <= SpeedArbitration.ECHO_TOLERANCE
    );
    if (idx === -1) {
      return false;
    }
    queue.splice(0, idx + 1);
    return true;
  }

  /**
   * Materialize the pure state for one media element from global authority
   * plus that element's local conflict record.
   * @param {HTMLMediaElement} video
   * @returns {{state: Object, conflict: Object|null}}
   * @private
   */
  stateFor(video) {
    const desired = this.config.settings.lastSpeed;
    if (desired === null || desired === undefined) {
      return { state: window.VSC.SpeedArbiter.loadState({}), conflict: null };
    }

    const conflict = this.conflictFor(video);
    return {
      conflict,
      state: {
        mode: conflict.mode,
        desired,
        fightCount: conflict.fightCount,
        warQuiet: conflict.warQuiet,
        rearmBudget: conflict.rearmBudget,
        temporaryOverride: conflict.temporaryOverride,
      },
    };
  }

  /**
   * Get a current-epoch local conflict record, lazily invalidating stale
   * records after another media element claims fresh global authority.
   * @param {HTMLMediaElement} video
   * @returns {Object}
   * @private
   */
  conflictFor(video) {
    let conflict = this.conflicts.get(video);
    if (!conflict || conflict.epoch !== this.authorityEpoch) {
      if (conflict) {
        this.clearFightTimer(conflict);
      }
      conflict = {
        epoch: this.authorityEpoch,
        mode: window.VSC.SpeedArbiter.MODES.HOLDING,
        fightCount: 0,
        warQuiet: true,
        rearmBudget: window.VSC.SpeedArbiter.DEFAULT_REARM_BUDGET,
        // A native hold belongs to this media, not the shared authority
        // generation. Preserve it if another video claims fresh authority
        // while this one is still held, so release restores the latest target.
        temporaryOverride: conflict?.temporaryOverride ?? false,
        fightTimer: null,
      };
      this.conflicts.set(video, conflict);
    }
    return conflict;
  }

  /**
   * @param {Object|null} conflict
   * @param {Object} state
   * @private
   */
  applyState(conflict, state) {
    if (!conflict) {
      return;
    }
    conflict.mode = state.mode;
    conflict.fightCount = state.fightCount;
    conflict.warQuiet = state.warQuiet;
    conflict.rearmBudget = state.rearmBudget;
    conflict.temporaryOverride = state.temporaryOverride;
  }

  /**
   * Commit shared authority and invalidate all local conflict records lazily.
   * A same-value VSC set still advances the epoch: it is an explicit request
   * to retry locally surrendered players.
   * @param {number} speed
   * @private
   */
  claimAuthority(speed) {
    this.config.persistAuthority(speed);
    this.authorityEpoch += 1;

    // Old timers should not keep running after their entire authority epoch
    // has been superseded. WeakMap records remain lazy and need no traversal.
    for (const conflict of this.timedConflicts) {
      clearTimeout(conflict.fightTimer);
      conflict.fightTimer = null;
    }
    this.timedConflicts.clear();
  }

  /**
   * USER_SET from VSC UI, shortcuts, wheel, or popup.
   *
   * Bulk commands may touch several controlled media elements. They share one
   * authority generation so a single keyboard/popup gesture cannot repeatedly
   * invalidate records while ActionHandler iterates its targets. Each target
   * still receives USER_SET locally, and the final target remains the shared
   * desired speed under the extension's existing global-speed semantics.
   * @param {HTMLMediaElement} video
   * @param {number} speed
   * @param {{startsAuthorityEpoch?: boolean}} [options]
   */
  noteUserSet(video, speed, { startsAuthorityEpoch = true } = {}) {
    const A = window.VSC.SpeedArbiter;
    if (startsAuthorityEpoch) {
      this.claimAuthority(speed);
    } else {
      this.config.persistAuthority(speed);
    }
    const { state } = this.stateFor(video);
    const result = A.step(state, { type: A.EVENTS.USER_SET, speed });
    this.applyState(this.conflictFor(video), result.state);
  }

  /**
   * Schedule a fallback for a physical terminal event. The usual YouTube
   * release emits a normal ratechange first; the fallback only prevents an
   * abandoned hold from suppressing lifecycle healing forever.
   * @param {HTMLMediaElement} video
   */
  noteTemporaryOverrideEnd(video) {
    const conflict = this.conflicts.get(video);
    if (!conflict?.temporaryOverride || this.temporaryReleaseTimers.get(video)) {
      return;
    }

    const entry = { video, timer: null };
    entry.timer = setTimeout(() => {
      this.pendingTemporaryReleaseTimers.delete(entry);
      if (this.temporaryReleaseTimers.get(video) !== entry) {
        return;
      }
      this.temporaryReleaseTimers.delete(video);
      if (this.stateFor(video).state.temporaryOverride) {
        window.VSC.logger.info(
          'Restoring shared speed after native hold release without ratechange'
        );
        this.completeTemporaryOverride(video, video.playbackRate);
      }
    }, SpeedArbitration.TEMPORARY_RELEASE_FALLBACK_MS);
    this.temporaryReleaseTimers.set(video, entry);
    this.pendingTemporaryReleaseTimers.add(entry);
  }

  /**
   * Complete a local temporary override from its normal external release or
   * the guarded terminal fallback. This never claims shared authority.
   * @param {HTMLMediaElement} video
   * @param {number} observedRate
   * @param {Event|null} [event]
   * @returns {boolean} whether a temporary override was completed
   * @private
   */
  completeTemporaryOverride(video, observedRate, event = null) {
    const A = window.VSC.SpeedArbiter;
    this.clearTemporaryReleaseTimer(video);
    const { state, conflict } = this.stateFor(video);
    if (!state.temporaryOverride) {
      return false;
    }
    const { state: next, effects } = A.step(state, {
      type: A.EVENTS.TEMPORARY_OVERRIDE_END,
      speed: observedRate,
    });
    this.applyState(conflict, next);
    const write = effects.find((entry) => entry.type === A.EFFECTS.WRITE);
    const sync = effects.find((entry) => entry.type === A.EFFECTS.SYNC_UI);
    if (write) {
      window.VSC.logger.info(
        `Restoring shared speed ${write.speed} after temporary native override`
      );
      this.eventManager?.actionHandler?.writeRate(video, write.speed);
      event?.stopImmediatePropagation();
    }
    if (sync) {
      this.eventManager?.actionHandler?.syncIndicator(video, sync.speed);
    }
    return true;
  }

  /**
   * @param {HTMLMediaElement} video
   * @private
   */
  clearTemporaryReleaseTimer(video) {
    const entry = this.temporaryReleaseTimers.get(video);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    this.temporaryReleaseTimers.delete(video);
    this.pendingTemporaryReleaseTimers.delete(entry);
  }

  /**
   * Decide and execute for a genuine external ratechange.
   * @param {HTMLMediaElement} video
   * @param {Event} event
   * @param {string} verdict
   */
  onExternalRate(video, event, verdict) {
    const A = window.VSC.SpeedArbiter;
    const IC = window.VSC.IntentClassifier;
    const rawRate = video.playbackRate;
    const { state, conflict } = this.stateFor(video);

    // A known temporary hold owns only this media register. Its first normal
    // ratechange is the native release even when weak release click/Space
    // evidence is present. Explicit strong speed-key/menu intent still wins,
    // so a deliberate native choice can supersede the hold.
    const strongUserIntent =
      verdict === IC.VERDICTS.USER_INTENT &&
      this.classifier.hasStrongIntent({ media: video, timeStamp: event.timeStamp });
    // Once a physical terminal event scheduled its fallback, the next normal
    // ratechange belongs to that release—even if its click joins a prior menu
    // click into a strong sequence. Before a terminal, explicit strong speed
    // intent still supersedes the hold.
    const releasePending = !!this.temporaryReleaseTimers.get(video);
    if (
      state.temporaryOverride &&
      verdict !== IC.VERDICTS.TEMPORARY_OVERRIDE &&
      (!strongUserIntent || releasePending)
    ) {
      this.completeTemporaryOverride(video, rawRate, event);
      return;
    }

    if (verdict === IC.VERDICTS.TEMPORARY_OVERRIDE) {
      this.clearTemporaryReleaseTimer(video);
      const { state: next, effects } = A.step(state, {
        type: A.EVENTS.TEMPORARY_OVERRIDE_START,
        speed: rawRate,
      });
      this.applyState(conflict, next);
      const sync = effects.find((entry) => entry.type === A.EFFECTS.SYNC_UI);
      if (sync) {
        window.VSC.logger.info(
          `Allowing temporary native override at ${rawRate} without claiming shared authority`
        );
        this.eventManager?.actionHandler?.syncIndicator(video, sync.speed);
      }
      return;
    }

    let rateClass = verdict;
    let speedForDecision = rawRate;
    if (state.mode === A.MODES.HOLDING && Math.abs(rawRate - state.desired) <= 0.01) {
      speedForDecision = state.desired;
      if (rateClass === IC.VERDICTS.USER_INTENT) {
        rateClass = IC.VERDICTS.AUTONOMOUS;
      }
    }

    const previousFightCount = state.fightCount;
    const { state: next, effects } = A.step(state, {
      type: A.EVENTS.EXT_RATE,
      speed: speedForDecision,
      rateClass,
      quiet: this.classifier.isQuietContext(event.timeStamp),
    });

    const inputAge =
      this.classifier.lastInputAt > 0
        ? Math.round(event.timeStamp - this.classifier.lastInputAt)
        : -1;

    if (effects.some((entry) => entry.type === A.EFFECTS.PERSIST)) {
      const adopted = Number(rawRate.toFixed(2));
      window.VSC.logger.info(
        `Accepting site speed change as user-intentional: ${rawRate} (input ${inputAge}ms ago)`
      );
      if (conflict) {
        this.clearFightTimer(conflict);
      }
      this.clearTemporaryReleaseTimer(video);
      this.classifier.consumeGesture(video);
      this.claimAuthority(adopted);
      this.applyState(this.conflictFor(video), next);
      this.eventManager?.actionHandler?.syncIndicator(video, adopted);
      return;
    }

    this.applyState(conflict, next);

    if (next.fightCount > previousFightCount) {
      this.armFightTimer(conflict);
      window.VSC.logger.info(
        `Fight detection: attempt ${next.fightCount}, site rate ${rawRate} -> re-applying ${state.desired} (input ${inputAge}ms ago)`
      );
      this.eventManager?.actionHandler?.writeRate(video, state.desired);
      event.stopImmediatePropagation();
      return;
    }

    if (
      (next.mode === A.MODES.SUPPRESSED || next.mode === A.MODES.REARMABLE) &&
      next.mode !== state.mode
    ) {
      // The prior fight timer belongs to the completed exchange. Leaving it
      // alive would retain this media record until expiry and could mutate its
      // count after a local stand-down/re-arm decision.
      this.clearFightTimer(conflict);
      window.VSC.logger.info(
        `Fight detection: ${next.mode.toLowerCase()} locally at site speed ${rawRate}`
      );
    }
    this.eventManager?.actionHandler?.syncIndicator(video, rawRate);
  }

  /**
   * Return the lifecycle write target for one media element, if it remains
   * locally enforcing shared authority.
   * @param {HTMLMediaElement} video
   * @returns {number|null}
   */
  lifecycleTarget(video) {
    const A = window.VSC.SpeedArbiter;
    const { state, conflict } = this.stateFor(video);
    const { state: next, effects } = A.step(state, { type: A.EVENTS.LIFECYCLE });
    this.applyState(conflict, next);
    const write = effects.find((entry) => entry.type === A.EFFECTS.WRITE);
    return write ? write.speed : null;
  }

  /**
   * Release state associated with a removed controller.
   * @param {HTMLMediaElement} video
   */
  release(video) {
    const conflict = this.conflicts.get(video);
    if (conflict) {
      this.clearFightTimer(conflict);
      this.conflicts.delete(video);
    }
    this.pendingWrites.delete(video);
    this.clearTemporaryReleaseTimer(video);
    this.classifier.releaseMedia(video);
  }

  /**
   * @param {Object|null} conflict
   * @private
   */
  armFightTimer(conflict) {
    if (!conflict) {
      return;
    }
    this.clearFightTimer(conflict);
    const epoch = conflict.epoch;
    conflict.fightTimer = setTimeout(() => {
      this.timedConflicts.delete(conflict);
      conflict.fightTimer = null;
      if (conflict.epoch === epoch && epoch === this.authorityEpoch) {
        const A = window.VSC.SpeedArbiter;
        const { state } = A.step(
          {
            mode: conflict.mode,
            desired: this.config.settings.lastSpeed,
            fightCount: conflict.fightCount,
            warQuiet: conflict.warQuiet,
            rearmBudget: conflict.rearmBudget,
            temporaryOverride: conflict.temporaryOverride,
          },
          { type: A.EVENTS.FIGHT_WINDOW_EXPIRE }
        );
        this.applyState(conflict, state);
      }
    }, SpeedArbitration.FIGHT_WINDOW_MS);
    this.timedConflicts.add(conflict);
  }

  /**
   * @param {Object|null} conflict
   * @private
   */
  clearFightTimer(conflict) {
    if (!conflict || conflict.fightTimer === null) {
      return;
    }
    clearTimeout(conflict.fightTimer);
    conflict.fightTimer = null;
    this.timedConflicts.delete(conflict);
  }

  cleanup() {
    for (const conflict of this.timedConflicts) {
      clearTimeout(conflict.fightTimer);
      conflict.fightTimer = null;
    }
    this.timedConflicts.clear();
    for (const entry of this.pendingTemporaryReleaseTimers) {
      clearTimeout(entry.timer);
    }
    this.pendingTemporaryReleaseTimers.clear();
    this.temporaryReleaseTimers = new WeakMap();
    this.conflicts = new WeakMap();
    this.pendingWrites = new WeakMap();
    this.classifier.reset();
  }
}

SpeedArbitration.FIGHT_WINDOW_MS = 3000;
SpeedArbitration.ECHO_TOLERANCE = 0.011;
SpeedArbitration.ECHO_TTL_MS = 500;
SpeedArbitration.ECHO_MAX_PENDING = 8;
SpeedArbitration.TEMPORARY_RELEASE_FALLBACK_MS = 250;

window.VSC.SpeedArbitration = SpeedArbitration;
