/**
 * Integration tests for modular architecture
 * Using global variables to match browser extension architecture
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../helpers/test-utils.js';

// Load all required modules

let mockDOM;

describe('ModuleIntegration', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    mockDOM = createMockDOM();
  });

  afterEach(() => {
    cleanupChromeMock();
    if (mockDOM) {
      mockDOM.cleanup();
    }
  });

  it('All core modules should load correctly', async () => {
    try {
      expect(window.VSC).toBeDefined();
      expect(window.VSC.videoSpeedConfig).toBeDefined();
      expect(window.VSC.VideoController).toBeDefined();
      expect(window.VSC.ActionHandler).toBeDefined();
      expect(window.VSC.EventManager).toBeDefined();
      expect(window.VSC.siteHandlerManager).toBeDefined();
    } catch (error) {
      throw new Error(`Module import failed: ${error.message}`, { cause: error });
    }
  });

  it('Site handlers should be configurable', async () => {
    const siteHandlerManager = window.VSC.siteHandlerManager;

    const handler = siteHandlerManager.getCurrentHandler();
    expect(handler).toBeDefined();

    // Should return positioning info
    const mockVideo = createMockVideo();
    const positioning = siteHandlerManager.getControllerPosition(mockDOM.container, mockVideo);
    expect(positioning).toBeDefined();
    expect(positioning.insertionPoint).toBeDefined();
  });

  it('Settings should integrate with ActionHandler', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    // ActionHandler is created but not used in this test - just ensuring it can be instantiated
    new window.VSC.ActionHandler(config, eventManager);

    // Should be able to get key bindings
    const fasterValue = config.getKeyBinding('faster');
    expect(typeof fasterValue).toBe('number');
  });

  it('VideoController should integrate with all dependencies', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    expect(controller).toBeDefined();
    expect(controller.div).toBeDefined();
    expect(mockVideo.vsc).toBeDefined();
  });

  it('Event system should coordinate between modules', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    eventManager.actionHandler = actionHandler;

    // Should be able to set up event listeners
    eventManager.setupEventListeners(document);

    // Should be able to clean up without throwing
    eventManager.cleanup();
  });

  it('startHidden setting should correctly control initial controller visibility', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    // Test when startHidden is false (default) - controller should be visible
    config.settings.startHidden = false;
    const visibleController = new window.VSC.VideoController(
      mockVideo,
      null,
      config,
      actionHandler
    );

    expect(visibleController.div.classList.contains('vsc-hidden')).toBe(false);
    expect(visibleController.div.classList.contains('vsc-show')).toBe(false);

    // Clean up first controller
    visibleController.remove();

    // Test when startHidden is true - controller should be hidden
    config.settings.startHidden = true;
    const mockVideo2 = createMockVideo();
    mockDOM.container.appendChild(mockVideo2);

    const hiddenController = new window.VSC.VideoController(
      mockVideo2,
      null,
      config,
      actionHandler
    );

    expect(hiddenController.div.classList.contains('vsc-hidden')).toBe(true);
    expect(hiddenController.div.classList.contains('vsc-show')).toBe(false);

    // Clean up
    hiddenController.remove();
  });
});
