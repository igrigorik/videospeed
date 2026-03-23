/**
 * Tests for unified pointer-based drag and double-click-to-reset
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert, createMockVideo, createMockDOM } from '../../helpers/test-utils.js';
import { loadCoreModules } from '../../helpers/module-loader.js';

await loadCoreModules();

const runner = new SimpleTestRunner();
let mockDOM;

runner.beforeEach(() => {
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

runner.afterEach(() => {
  cleanupChromeMock();
  if (window.VSC && window.VSC.stateManager) {
    window.VSC.stateManager.controllers.clear();
  }
  document.querySelectorAll('video, audio').forEach(el => el.remove());
  if (mockDOM) {
    mockDOM.cleanup();
  }
});

// --- DragHandler tests ---

runner.test('DragHandler.handleDrag uses pointer capture when pointerId is present', async () => {
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
  draggable.setPointerCapture = () => { captured = true; };
  draggable.releasePointerCapture = () => {};

  // Simulate pointerdown with pointerId
  const pointerEvent = new Event('pointerdown', { bubbles: true });
  pointerEvent.clientX = 100;
  pointerEvent.clientY = 100;
  pointerEvent.pointerId = 1;
  Object.defineProperty(pointerEvent, 'target', { value: draggable, writable: true });

  window.VSC.DragHandler.handleDrag(mockVideo, pointerEvent);

  assert.true(captured, 'setPointerCapture should have been called');
  assert.true(
    shadowController.classList.contains('dragging'),
    'Should add dragging class'
  );
});

runner.test('DragHandler.handleDrag falls back to mouse events without pointerId', async () => {
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

  assert.true(
    shadowController.classList.contains('dragging'),
    'Should add dragging class on mouse fallback'
  );
});

// --- Double-click-to-reset tests ---

runner.test('ControlsManager sets up dblclick handler on draggable', async () => {
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

  assert.true(resetCalled, 'Double-click on speed indicator should trigger reset action');
});

runner.test('Draggable element has touch-action: none in style', async () => {
  const config = window.VSC.videoSpeedConfig;
  await config.load();
  const eventManager = new window.VSC.EventManager(config, null);
  const actionHandler = new window.VSC.ActionHandler(config, eventManager);

  const mockVideo = createMockVideo();
  mockDOM.container.appendChild(mockVideo);
  const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

  // Check that the shadow DOM style contains touch-action: none for .draggable
  const style = controller.div.shadowRoot.querySelector('style');
  assert.true(
    style.textContent.includes('touch-action: none'),
    'Shadow DOM styles should include touch-action: none for draggable'
  );
});

export { runner };
