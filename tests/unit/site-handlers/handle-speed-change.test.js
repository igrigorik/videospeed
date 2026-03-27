/**
 * Unit tests for handleSpeedChange site handler hook
 * Verifies that speed changes route through the handler system
 */

import { vi } from 'vitest';
import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';

let mockDOM;

describe('handleSpeedChange', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    mockDOM = createMockDOM();

    if (window.VSC && window.VSC.stateManager) {
      window.VSC.stateManager.controllers.clear();
    }

    if (window.VSC && window.VSC.siteHandlerManager) {
      window.VSC.siteHandlerManager.initialize(document);
    }
  });

  afterEach(() => {
    cleanupChromeMock();
    if (mockDOM) {
      mockDOM.cleanup();
    }
  });

  function createTestVideoWithController(config, actionHandler, videoOptions = {}) {
    const mockVideo = createMockVideo(videoOptions);

    if (!mockVideo.parentElement) {
      const parentDiv = document.createElement('div');
      document.body.appendChild(parentDiv);
      parentDiv.appendChild(mockVideo);
    }

    const initialPlaybackRate = mockVideo.playbackRate;
    new window.VSC.VideoController(mockVideo, mockVideo.parentElement, config, actionHandler);
    mockVideo.playbackRate = initialPlaybackRate;

    return mockVideo;
  }

  // --- BaseSiteHandler default ---

  it('BaseSiteHandler.handleSpeedChange sets video.playbackRate', () => {
    const handler = new window.VSC.BaseSiteHandler();
    const video = createMockVideo({ playbackRate: 1.0 });

    handler.handleSpeedChange(video, 3.0);

    expect(video.playbackRate).toBe(3.0);
  });

  // --- SiteHandlerManager delegation ---

  it('SiteHandlerManager delegates handleSpeedChange to current handler', () => {
    const manager = window.VSC.siteHandlerManager;
    const handler = manager.getCurrentHandler();
    const spy = vi.spyOn(handler, 'handleSpeedChange');

    const video = createMockVideo({ playbackRate: 1.0 });
    manager.handleSpeedChange(video, 2.5);

    expect(spy).toHaveBeenCalledWith(video, 2.5);
    expect(video.playbackRate).toBe(2.5);
    spy.mockRestore();
  });

  // --- ActionHandler.setSpeed routes through handler ---

  it('ActionHandler.setSpeed uses handleSpeedChange instead of direct assignment', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const mockVideo = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

    const manager = window.VSC.siteHandlerManager;
    const spy = vi.spyOn(manager, 'handleSpeedChange');

    actionHandler.setSpeed(mockVideo, 2.0, 'internal');

    expect(spy).toHaveBeenCalledWith(mockVideo, 2.0);
    expect(mockVideo.playbackRate).toBe(2.0);
    spy.mockRestore();
  });

  it('adjustSpeed routes through handleSpeedChange', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const mockVideo = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

    const manager = window.VSC.siteHandlerManager;
    const spy = vi.spyOn(manager, 'handleSpeedChange');

    actionHandler.adjustSpeed(mockVideo, 3.0);

    expect(spy).toHaveBeenCalled();
    expect(mockVideo.playbackRate).toBe(3.0);
    spy.mockRestore();
  });

  // --- Fight-back routes through handler ---

  it('fight-back restores speed through handleSpeedChange', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 2.0;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '2.00' } };
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    const manager = window.VSC.siteHandlerManager;
    const spy = vi.spyOn(manager, 'handleSpeedChange');

    const mockEvent = {
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      stopImmediatePropagation: () => {},
    };

    eventManager.handleRateChange(mockEvent);

    expect(spy).toHaveBeenCalledWith(mockVideo, 2.0);
    expect(mockVideo.playbackRate).toBe(2.0);
    spy.mockRestore();
  });

  it('cooldown restore routes through handleSpeedChange', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.lastSpeed = 2.0;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockVideo.vsc = { speedIndicator: { textContent: '2.00' } };

    const manager = window.VSC.siteHandlerManager;
    const spy = vi.spyOn(manager, 'handleSpeedChange');

    // Activate cooldown first
    eventManager.refreshCoolDown();

    const mockEvent = {
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null,
      stopImmediatePropagation: () => {},
    };

    eventManager.handleRateChange(mockEvent);

    expect(spy).toHaveBeenCalledWith(mockVideo, 2.0);
    expect(mockVideo.playbackRate).toBe(2.0);
    spy.mockRestore();
  });

  // --- Custom handler override ---

  it('custom handler override is called during speed change', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const mockVideo = createTestVideoWithController(config, actionHandler, { playbackRate: 1.0 });

    // Simulate a custom handler that records calls
    const calls = [];
    const handler = window.VSC.siteHandlerManager.getCurrentHandler();
    handler.handleSpeedChange = (video, speed) => {
      calls.push(speed);
      video.playbackRate = speed;
    };

    actionHandler.adjustSpeed(mockVideo, 4.0);

    expect(calls).toEqual([4.0]);
    expect(mockVideo.playbackRate).toBe(4.0);
  });
});
