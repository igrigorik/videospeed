/**
 * Tests for unified pointer-based drag and double-click-to-reset
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';
let mockDOM;

describe('DragAndReset', () => {
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
    if (window.VSC && window.VSC.stateManager) {
      window.VSC.stateManager.controllers.clear();
    }
    document.querySelectorAll('video, audio').forEach((el) => el.remove());
    if (mockDOM) {
      mockDOM.cleanup();
    }
  });

  // --- DragHandler tests ---

  it('DragHandler.handleDrag uses pointer capture when pointerId is present', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    const shadowController = controller.div.shadowRoot.querySelector('#controller');
    const draggable = controller.div.shadowRoot.querySelector('.draggable');

    let captured = false;
    draggable.setPointerCapture = () => {
      captured = true;
    };
    draggable.releasePointerCapture = () => {};

    // Simulate pointerdown with pointerId
    const pointerEvent = new Event('pointerdown', { bubbles: true });
    pointerEvent.clientX = 100;
    pointerEvent.clientY = 100;
    pointerEvent.pointerId = 1;
    Object.defineProperty(pointerEvent, 'target', { value: draggable, writable: true });

    window.VSC.DragHandler.handleDrag(mockVideo, pointerEvent);

    expect(captured).toBe(true);
    expect(shadowController.classList.contains('dragging')).toBe(true);
  });

  it('DragHandler.handleDrag falls back to mouse events without pointerId', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    const shadowController = controller.div.shadowRoot.querySelector('#controller');
    const draggable = controller.div.shadowRoot.querySelector('.draggable');

    // Simulate mousedown without pointerId
    const mouseEvent = new Event('mousedown', { bubbles: true });
    mouseEvent.clientX = 50;
    mouseEvent.clientY = 50;
    Object.defineProperty(mouseEvent, 'target', { value: draggable, writable: true });

    window.VSC.DragHandler.handleDrag(mockVideo, mouseEvent);

    expect(shadowController.classList.contains('dragging')).toBe(true);
  });

  // --- Double-click-to-reset tests ---

  it('ControlsManager sets up dblclick handler on draggable', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Change speed away from 1.0
    mockVideo.playbackRate = 2.0;
    if (mockVideo.vsc.speedIndicator) {
      mockVideo.vsc.speedIndicator.textContent = '2.00';
    }

    // Track if reset was called
    let resetCalled = false;
    const origRunAction = actionHandler.runAction.bind(actionHandler);
    actionHandler.runAction = (action, value, e) => {
      if (action === 'reset') {
        resetCalled = true;
      }
      return origRunAction(action, value, e);
    };

    // Dispatch dblclick on the draggable
    const draggable = controller.div.shadowRoot.querySelector('.draggable');
    const dblClickEvent = new Event('dblclick', { bubbles: true, cancelable: true });
    Object.defineProperty(dblClickEvent, 'target', { value: draggable, writable: true });
    draggable.dispatchEvent(dblClickEvent);

    expect(resetCalled).toBe(true);
  });

  it('Draggable element has touch-action: none in style', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Check that the shadow DOM style contains touch-action: none for .draggable
    const style = controller.div.shadowRoot.querySelector('style');
    expect(style.textContent.includes('touch-action: none')).toBe(true);
  });

  it('controller renders a 1x button between slower and faster', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.25 });
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    const buttons = controller.div.shadowRoot.querySelectorAll('#controls button');
    const quickSpeedButton = controller.div.shadowRoot.querySelector('button[data-speed="1"]');

    expect(quickSpeedButton).toBeTruthy();
    expect(buttons).toHaveLength(5);
    expect(buttons[1].dataset.action).toBe('slower');
    expect(buttons[2].textContent).toBe('1x');
    expect(buttons[3].dataset.action).toBe('faster');
  });

  it('quick 1x button restores normal playback speed', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 2.0 });
    mockDOM.container.appendChild(mockVideo);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    const quickSpeedButton = controller.div.shadowRoot.querySelector('button[data-speed="1"]');
    quickSpeedButton.dispatchEvent(new Event('click', { bubbles: true }));

    expect(mockVideo.playbackRate).toBe(1.0);
    expect(controller.speedIndicator.textContent).toBe('1.00');
  });
});
