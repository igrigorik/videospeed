/**
 * Integration coverage for shared document authority with per-media conflict
 * state. These scenarios exercise the real EventManager/ActionHandler adapter
 * boundary rather than only the pure local state machine.
 */

import { vi } from 'vitest';
import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../helpers/chrome-mock.js';
import { createMockVideo } from '../helpers/test-utils.js';

function controlledVideo(rate = 2.0) {
  const video = createMockVideo({ playbackRate: rate, readyState: 4 });
  video.vsc = {
    div: document.createElement('div'),
    speedIndicator: { textContent: rate.toFixed(2) },
  };
  return video;
}

function siteReset(eventManager, video, timeStamp, rate = 1.0) {
  video.playbackRate = rate;
  eventManager.handleRateChange({
    composedPath: () => [video],
    target: video,
    detail: null,
    timeStamp,
    stopImmediatePropagation() {},
  });
}

describe('multi-video speed arbitration', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installChromeMock();
    resetMockStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupChromeMock();
  });

  async function createWorld() {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    eventManager.actionHandler = actionHandler;
    return { config, eventManager, actionHandler };
  }

  it('keeps alternating resets from separate videos in separate fight budgets', async () => {
    const { config, eventManager } = await createWorld();
    const videoA = controlledVideo();
    const videoB = controlledVideo();
    config.settings.lastSpeed = 2.0;

    expect(config.settings.lastSpeed).toBe(2.0);
    siteReset(eventManager, videoA, 100);
    expect(config.settings.lastSpeed).toBe(2.0);
    siteReset(eventManager, videoB, 200);
    siteReset(eventManager, videoA, 300);
    siteReset(eventManager, videoB, 400);

    const conflictA = eventManager.arbitration.conflicts.get(videoA);
    expect(conflictA?.fightCount).toBe(2);
    expect(eventManager.arbitration.conflicts.get(videoB).fightCount).toBe(2);
    expect(config.settings.lastSpeed).toBe(2.0);
  });

  it('locally surrenders A without suppressing B or letting B consume A re-arm', async () => {
    const { config, eventManager } = await createWorld();
    const videoA = controlledVideo();
    const videoB = controlledVideo();
    const maxFight = window.VSC.SpeedArbiter.DEFAULT_MAX_FIGHT;
    config.settings.lastSpeed = 2.0;

    for (let i = 0; i <= maxFight; i += 1) {
      siteReset(eventManager, videoA, 100 + i * 10);
    }
    siteReset(eventManager, videoB, 200);

    expect(config.settings.lastSpeed).toBe(2.0);
    const conflictA = eventManager.arbitration.conflicts.get(videoA);
    expect(conflictA).toMatchObject({
      mode: window.VSC.SpeedArbiter.MODES.REARMABLE,
    });
    expect(eventManager.arbitration.timedConflicts.has(conflictA)).toBe(false);
    expect(eventManager.arbitration.conflicts.get(videoB)).toMatchObject({
      mode: window.VSC.SpeedArbiter.MODES.HOLDING,
      fightCount: 1,
    });

    expect(eventManager.arbitration.lifecycleTarget(videoB)).toBe(2.0);
    expect(eventManager.arbitration.conflicts.get(videoA).mode).toBe(
      window.VSC.SpeedArbiter.MODES.REARMABLE
    );

    expect(eventManager.arbitration.lifecycleTarget(videoA)).toBe(2.0);
    expect(eventManager.arbitration.conflicts.get(videoA).mode).toBe(
      window.VSC.SpeedArbiter.MODES.HOLDING
    );
  });

  it('advances authority once when a bulk VSC action updates multiple videos', async () => {
    const { config, eventManager, actionHandler } = await createWorld();
    const videoA = controlledVideo(1.0);
    const videoB = controlledVideo(1.25);
    const controlled = vi
      .spyOn(window.VSC.stateManager, 'getControlledElements')
      .mockReturnValue([videoA, videoB]);

    actionHandler.runAction('SET_SPEED', 1.75);

    expect(eventManager.arbitration.authorityEpoch).toBe(1);
    expect(config.settings.lastSpeed).toBe(1.75);
    expect(videoA.playbackRate).toBe(1.75);
    expect(videoB.playbackRate).toBe(1.75);
    controlled.mockRestore();
  });

  it('uses a same-speed user choice as a fresh authority epoch', async () => {
    const { config, eventManager, actionHandler } = await createWorld();
    const videoA = controlledVideo();
    const videoB = controlledVideo();
    const maxFight = window.VSC.SpeedArbiter.DEFAULT_MAX_FIGHT;
    config.settings.lastSpeed = 2.0;

    // Mark A's whole war activity-adjacent so its surrender is terminally
    // suppressed for the current epoch.
    eventManager.arbitration.classifier.observeInput({ timeStamp: 100 });
    for (let i = 0; i <= maxFight; i += 1) {
      siteReset(eventManager, videoA, 150 + i * 10);
    }
    expect(eventManager.arbitration.conflicts.get(videoA).mode).toBe(
      window.VSC.SpeedArbiter.MODES.SUPPRESSED
    );

    const previousEpoch = eventManager.arbitration.authorityEpoch;
    actionHandler.adjustSpeed(videoB, 2.0);

    expect(eventManager.arbitration.authorityEpoch).toBe(previousEpoch + 1);
    expect(eventManager.arbitration.lifecycleTarget(videoA)).toBe(2.0);
    expect(eventManager.arbitration.conflicts.get(videoA).mode).toBe(
      window.VSC.SpeedArbiter.MODES.HOLDING
    );
  });

  it('keeps a YouTube temporary hold on A out of B and shared authority', async () => {
    const { config, eventManager } = await createWorld();
    const videoA = controlledVideo(1.5);
    const videoB = controlledVideo(1.5);
    config.settings.lastSpeed = 1.5;
    eventManager.arbitration.classifier.rules = {
      ...window.VSC.IntentClassifier.TARGET_RULES,
      ...new window.VSC.YouTubeHandler().getClassifierRules(),
    };

    // Give B independent live conflict state that A's temporary hold must not
    // reset, mutate, or consume.
    siteReset(eventManager, videoB, 100);
    const conflictB = eventManager.arbitration.conflicts.get(videoB);
    const bSnapshot = {
      mode: conflictB.mode,
      fightCount: conflictB.fightCount,
      warQuiet: conflictB.warQuiet,
      rearmBudget: conflictB.rearmBudget,
    };

    const classifier = eventManager.arbitration.classifier;
    classifier.observePointerDown({ pointerId: 7, timeStamp: 200 }, videoA);
    siteReset(eventManager, videoA, 620, 2.0);
    expect(eventManager.arbitration.conflicts.get(videoA)).toMatchObject({
      temporaryOverride: true,
      fightCount: 0,
    });
    expect(config.settings.lastSpeed).toBe(1.5);

    classifier.observePointerEnd({ pointerId: 7, timeStamp: 830 });
    siteReset(eventManager, videoA, 840, 1.0);

    expect(videoA.playbackRate).toBe(1.5);
    expect(config.settings.lastSpeed).toBe(1.5);
    expect(eventManager.arbitration.authorityEpoch).toBe(0);
    expect(eventManager.arbitration.conflicts.get(videoA)).toMatchObject({
      temporaryOverride: false,
      fightCount: 0,
    });
    expect(eventManager.arbitration.conflicts.get(videoB)).toBe(conflictB);
    expect(conflictB).toMatchObject(bSnapshot);
    expect(videoB.playbackRate).toBe(1.5);
  });

  it('restores the newest shared target when B changes speed during A temporary hold', async () => {
    const { config, eventManager, actionHandler } = await createWorld();
    const videoA = controlledVideo(1.5);
    const videoB = controlledVideo(1.5);
    config.settings.lastSpeed = 1.5;
    eventManager.arbitration.classifier.rules = {
      ...window.VSC.IntentClassifier.TARGET_RULES,
      ...new window.VSC.YouTubeHandler().getClassifierRules(),
    };

    const classifier = eventManager.arbitration.classifier;
    classifier.observePointerDown({ pointerId: 7, timeStamp: 100 }, videoA);
    siteReset(eventManager, videoA, 620, 2.0);
    expect(eventManager.arbitration.conflicts.get(videoA)?.temporaryOverride).toBe(true);

    // A's local native hold cannot block B's explicit durable user choice.
    actionHandler.adjustSpeed(videoB, 1.75);
    expect(config.settings.lastSpeed).toBe(1.75);
    expect(eventManager.arbitration.authorityEpoch).toBe(1);

    classifier.observePointerEnd({ pointerId: 7, timeStamp: 700 });
    siteReset(eventManager, videoA, 710, 1.0);

    expect(videoA.playbackRate).toBe(1.75);
    expect(config.settings.lastSpeed).toBe(1.75);
    expect(eventManager.arbitration.conflicts.get(videoA)).toMatchObject({
      mode: window.VSC.SpeedArbiter.MODES.HOLDING,
      temporaryOverride: false,
      fightCount: 0,
    });
  });

  it('keeps A held when B adopts native authority, then restores B target on A release', async () => {
    const { config, eventManager } = await createWorld();
    const videoA = controlledVideo(1.5);
    const videoB = controlledVideo(1.5);
    config.settings.lastSpeed = 1.5;
    const classifier = eventManager.arbitration.classifier;
    classifier.rules = {
      ...window.VSC.IntentClassifier.TARGET_RULES,
      ...new window.VSC.YouTubeHandler().getClassifierRules(),
    };

    classifier.observePointerDown({ pointerId: 7, timeStamp: 100 }, videoA);
    siteReset(eventManager, videoA, 620, 2.0);
    expect(eventManager.arbitration.conflicts.get(videoA)?.temporaryOverride).toBe(true);

    // A native speed shortcut on B is a durable choice, but it must neither
    // erase A's pointer evidence nor cancel A's active temporary overlay.
    classifier.observeUnhandledKey({ key: '>', timeStamp: 700 });
    siteReset(eventManager, videoB, 710, 1.75);
    expect(config.settings.lastSpeed).toBe(1.75);
    expect(eventManager.arbitration.authorityEpoch).toBe(1);

    siteReset(eventManager, videoA, 720, 2.0);
    expect(eventManager.arbitration.conflicts.get(videoA)?.temporaryOverride).toBe(true);
    expect(videoA.playbackRate).toBe(2.0);

    classifier.observePointerEnd({ pointerId: 7, timeStamp: 800 });
    siteReset(eventManager, videoA, 810, 1.0);

    expect(videoA.playbackRate).toBe(1.75);
    expect(config.settings.lastSpeed).toBe(1.75);
    expect(eventManager.arbitration.conflicts.get(videoA)).toMatchObject({
      mode: window.VSC.SpeedArbiter.MODES.HOLDING,
      temporaryOverride: false,
      fightCount: 0,
    });
  });

  it('releases a removed video timer without touching another video state', async () => {
    const { config, eventManager } = await createWorld();
    const videoA = controlledVideo();
    const videoB = controlledVideo();
    config.settings.lastSpeed = 2.0;

    siteReset(eventManager, videoA, 100);
    siteReset(eventManager, videoB, 200);
    const conflictB = eventManager.arbitration.conflicts.get(videoB);

    eventManager.arbitration.release(videoA);

    expect(eventManager.arbitration.conflicts.get(videoA)).toBeUndefined();
    expect(eventManager.arbitration.pendingWrites.get(videoA)).toBeUndefined();
    expect(eventManager.arbitration.conflicts.get(videoB)).toBe(conflictB);
    expect(conflictB.fightCount).toBe(1);
  });
});
