/**
 * Integration tests for full UI to storage flow
 * Tests the complete path from user interactions to storage persistence
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
  getMockStorage,
  getMockLocalStorage,
} from '../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../helpers/test-utils.js';

// Load all required modules

let mockDOM;

describe('UIToStorageFlow', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    mockDOM = createMockDOM();

    // Initialize site handler manager for tests
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

  it('Full flow: keyboard shortcut → adjustSpeed → storage → UI update', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true; // Global mode

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    // Create video with controller
    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Track storage saves
    const savedData = [];
    const originalSave = config.save;
    config.save = async function (data) {
      savedData.push({ ...data });
      return originalSave.call(this, data);
    };

    // Simulate keyboard shortcut for "faster" (D key)
    actionHandler.runAction('faster', 0.1);

    // Verify complete flow
    expect(mockVideo.playbackRate).toBe(1.1); // Video speed changed
    expect(controller.speedIndicator.textContent).toBe('1.10'); // UI updated
    expect(config.settings.lastSpeed).toBe(1.1); // Config updated
    expect(savedData.length >= 1).toBe(true); // Storage called at least once
    const lastSave = savedData[savedData.length - 1];
    expect(lastSave.lastSpeed).toBe(1.1); // Correct data saved
  });

  it('Full flow: popup button → adjustSpeed → storage (non-persistent mode)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = false; // Non-persistent mode

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    // Create video with specific source
    const mockVideo = createMockVideo({
      currentSrc: 'https://example.com/test-video.mp4',
      playbackRate: 1.0,
    });
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Track storage saves
    const savedData = [];
    const originalSave = config.save;
    config.save = async function (data) {
      savedData.push({ ...data });
      return originalSave.call(this, data);
    };

    // Simulate popup preset button (1.5x speed)
    actionHandler.runAction('SET_SPEED', 1.5);

    // Verify complete flow for non-persistent mode
    expect(mockVideo.playbackRate).toBe(1.5); // Video speed changed
    expect(controller.speedIndicator.textContent).toBe('1.50'); // UI updated
    // With rememberSpeed = false, no storage saves should occur
    expect(savedData.length).toBe(0); // No storage saves in non-persistent mode
  });

  it('Full flow: external ratechange → fight-back → restore speed', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;
    config.settings.lastSpeed = 2.0;

    const actionHandler = new window.VSC.ActionHandler(config, null);
    const eventManager = new window.VSC.EventManager(config, actionHandler);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockDOM.container.appendChild(mockVideo);
    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Video should be at 2.0 after controller init (rememberSpeed + lastSpeed)
    expect(mockVideo.playbackRate).toBe(2.0);

    // Simulate an external ratechange (site resets to 1.0)
    mockVideo.playbackRate = 1.0;
    Object.defineProperty(mockVideo, 'readyState', { value: 4, configurable: true });

    const rateChangeEvent = {
      composedPath: () => [mockVideo],
      target: mockVideo,
      detail: null, // external — no VSC origin marker
      stopImmediatePropagation: () => {},
    };

    eventManager.handleRateChange(rateChangeEvent);

    // Fight-back should restore to authoritative speed
    expect(mockVideo.playbackRate).toBe(2.0);
  });

  it('Full flow: mouse wheel → relative change → UI update', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;
    config.settings.lastSpeed = 1.5; // Controller will init to 1.5

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Controller should have initialized to 1.5 (rememberSpeed + lastSpeed)
    expect(mockVideo.playbackRate).toBe(1.5);

    // Simulate mouse wheel scroll (relative change)
    actionHandler.adjustSpeed(mockVideo, 0.1, { relative: true });

    // 1.5 + 0.1 = 1.6
    expect(mockVideo.playbackRate).toBe(1.6);
    expect(controller.speedIndicator.textContent).toBe('1.60');
    expect(config.settings.lastSpeed).toBe(1.6);
  });

  it('Full flow: multiple videos → different speeds → correct storage behavior', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = false; // Non-persistent mode

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    // Create multiple videos
    const video1 = createMockVideo({ currentSrc: 'https://site1.com/video1.mp4' });
    const video2 = createMockVideo({ currentSrc: 'https://site2.com/video2.mp4' });

    mockDOM.container.appendChild(video1);
    mockDOM.container.appendChild(video2);

    const controller1 = new window.VSC.VideoController(video1, null, config, actionHandler);
    const controller2 = new window.VSC.VideoController(video2, null, config, actionHandler);

    // Track storage saves
    const savedData = [];
    const originalSave = config.save;
    config.save = async function (data) {
      savedData.push({ ...data });
      return originalSave.call(this, data);
    };

    // Change speeds on different videos
    actionHandler.adjustSpeed(video1, 1.25);
    actionHandler.adjustSpeed(video2, 1.75);

    // Verify each video has correct state
    expect(video1.playbackRate).toBe(1.25);
    expect(video2.playbackRate).toBe(1.75);
    expect(controller1.speedIndicator.textContent).toBe('1.25');
    expect(controller2.speedIndicator.textContent).toBe('1.75');

    // With non-persistent mode, no storage saves should occur
    expect(savedData.length).toBe(0); // No saves with rememberSpeed = false
  });

  it('Full flow: speed limits enforcement → clamping', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Try to set speed above maximum (16.0)
    actionHandler.adjustSpeed(mockVideo, 25.0);

    expect(mockVideo.playbackRate).toBe(16.0);
    expect(controller.speedIndicator.textContent).toBe('16.00');
    expect(config.settings.lastSpeed).toBe(16.0);

    // Try to set speed below minimum (0.07)
    actionHandler.adjustSpeed(mockVideo, 0.01);

    expect(mockVideo.playbackRate).toBe(0.07);
    expect(controller.speedIndicator.textContent).toBe('0.07');
    expect(config.settings.lastSpeed).toBe(0.07);
  });

  it('clear removes sync settings and per-site local speeds', async () => {
    getMockStorage().lastSpeed = 2;
    getMockLocalStorage()['vsc:lastSpeed:https://example.com'] = 2;

    await window.VSC.StorageManager.clear();

    expect(getMockStorage().lastSpeed).toBeUndefined();
    expect(Object.keys(getMockLocalStorage())).toHaveLength(0);
  });
});
