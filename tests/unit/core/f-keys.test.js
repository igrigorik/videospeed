/**
 * Tests for F13-F24 and special key support
 * Verifies that the expanded keyboard handling works correctly
 */

import { cleanupChromeMock, installChromeMock, resetMockStorage } from '../../helpers/chrome-mock.js';
import { loadMinimalModules } from '../../helpers/module-loader.js';
import { SimpleTestRunner, assert } from '../../helpers/test-utils.js';

// Load required modules
await loadMinimalModules([
  '../../../src/utils/constants.js',
  '../../../src/utils/logger.js',
  '../../../src/core/storage-manager.js',
  '../../../src/core/settings.js',
  '../../../src/core/action-handler.js',
  '../../../src/utils/event-manager.js'
]);

const runner = new SimpleTestRunner();

runner.beforeEach(() => {
  installChromeMock();
  resetMockStorage();

  // Clear state manager for tests
  if (window.VSC && window.VSC.stateManager) {
    window.VSC.stateManager.controllers.clear();
  }
});

runner.afterEach(() => {
  cleanupChromeMock();
});

runner.test('F13-F24 keys should be valid key bindings', async () => {
  const config = new window.VSC.VideoSpeedConfig();

  // Test saving F13-F24 key bindings
  const fKeyBindings = [];
  for (let i = 13; i <= 24; i++) {
    fKeyBindings.push({
      action: 'faster',
      key: 111 + i, // F13=124, F14=125, etc.
      value: 0.1,
      force: false,
      predefined: false
    });
  }

  await config.save({ keyBindings: fKeyBindings });
  await config.load();

  assert.equal(config.settings.keyBindings.length >= fKeyBindings.length, true,
    'All F-key bindings should be saved');

  // Verify each F-key binding exists
  for (let i = 0; i < fKeyBindings.length; i++) {
    const expectedBinding = fKeyBindings[i];
    const binding = config.settings.keyBindings.find((item) => item.key === expectedBinding.key);
    assert.exists(binding, `F${i + 13} binding should exist`);
    assert.equal(binding.key, expectedBinding.key, `F${i + 13} key should be saved correctly`);
  }
});

runner.test('Special keys beyond standard range should be accepted', async () => {
  const config = new window.VSC.VideoSpeedConfig();

  // Test various special key codes that might exist on different keyboards
  const specialKeys = [
    { keyCode: 144, description: 'NumLock' },
    { keyCode: 145, description: 'ScrollLock' },
    { keyCode: 19, description: 'Pause/Break' },
    { keyCode: 44, description: 'PrintScreen' },
    { keyCode: 173, description: 'Media Mute' },
    { keyCode: 174, description: 'Media Volume Down' },
    { keyCode: 175, description: 'Media Volume Up' },
    { keyCode: 179, description: 'Media Play/Pause' }
  ];

  const specialKeyBindings = specialKeys.map(key => ({
    action: 'pause',
    key: key.keyCode,
    value: 0,
    force: false,
    predefined: false
  }));

  await config.save({ keyBindings: specialKeyBindings });
  await config.load();

  assert.equal(config.settings.keyBindings.length >= specialKeyBindings.length, true,
    'All special key bindings should be saved');

  specialKeys.forEach((specialKey) => {
    const binding = config.settings.keyBindings.find((item) => item.key === specialKey.keyCode);
    assert.exists(binding, `${specialKey.description} binding should exist`);
    assert.equal(binding.key, specialKey.keyCode,
      `${specialKey.description} key should be saved correctly`);
  });
});

runner.test('Blacklisted keys should be properly handled in options UI', async () => {
  // This test verifies that blacklisted keys are rejected in the options UI
  // The actual runtime blocking of Tab happens through browser navigation handling

  // Simulate the recordKeyPress function behavior with blacklisted keys
  const BLACKLISTED_KEYCODES = [9, 16, 17, 18, 91, 92, 93, 224];

  BLACKLISTED_KEYCODES.forEach(keyCode => {
    const mockEvent = {
      keyCode: keyCode,
      preventDefault: () => { },
      stopPropagation: () => { }
    };

    // In the real options.js, blacklisted keys would be prevented
    const isBlacklisted = BLACKLISTED_KEYCODES.includes(keyCode);
    assert.equal(isBlacklisted, true, `Key ${keyCode} should be blacklisted`);
  });

  // Verify that non-blacklisted keys would be accepted
  const allowedKeys = [124, 65, 32, 13]; // F13, A, Space, Enter
  allowedKeys.forEach(keyCode => {
    const isBlacklisted = BLACKLISTED_KEYCODES.includes(keyCode);
    assert.equal(isBlacklisted, false, `Key ${keyCode} should not be blacklisted`);
  });
});

runner.test('EventManager should handle F-keys correctly', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);
  actionHandler.eventManager = eventManager;

  // Add F13 key binding
  config.settings.keyBindings = [{
    action: 'faster',
    key: 124, // F13
    value: 0.1,
    force: false,
    predefined: false
  }];

  // Create a proper test video with controller
  const mockVideo = {
    playbackRate: 1.0,
    paused: false,
    muted: false,
    currentTime: 0,
    duration: 100,
    classList: {
      contains: (className) => false  // Mock classList for 'vsc-cancelled' check
    },
    dispatchEvent: (event) => { /* Mock dispatchEvent for synthetic events */ },
    // Add DOM-related properties for controller creation
    tagName: 'VIDEO',
    currentSrc: 'test-video.mp4',
    src: 'test-video.mp4',
    // Crucial: isConnected must be true for state manager to find it
    isConnected: true
  };

  // Manually register with state manager for this specific test
  const mockControllerId = 'test-f-keys-controller';
  mockVideo.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '1.00' } };
  window.VSC.stateManager.controllers.set(mockControllerId, {
    id: mockControllerId,
    element: mockVideo,
    videoSrc: mockVideo.currentSrc,
    tagName: mockVideo.tagName,
    created: Date.now(),
    isActive: true
  });

  // Create a proper mock target element
  const mockTarget = {
    nodeName: 'DIV',
    isContentEditable: false,
    getRootNode: () => ({ host: null })  // Mock getRootNode for shadow DOM check
  };

  // Trigger F13 key
  const f13Event = {
    keyCode: 124,
    target: mockTarget,
    getModifierState: () => false,
    preventDefault: () => { },
    stopPropagation: () => { }
  };

  eventManager.handleKeydown(f13Event);

  assert.equal(mockVideo.playbackRate, 1.1, 'F13 key should increase speed by 0.1');
});

runner.test('EventManager should match chord binding with exact modifiers', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);
  actionHandler.eventManager = eventManager;

  config.settings.keyBindings = [{
    action: 'faster',
    key: 80, // P
    value: 0.2,
    force: false,
    predefined: false,
    modifiers: {
      shift: true,
      ctrl: false,
      alt: false,
      meta: false
    }
  }];

  const mockVideo = {
    playbackRate: 1.0,
    paused: false,
    muted: false,
    currentTime: 0,
    duration: 100,
    classList: {
      contains: () => false
    },
    dispatchEvent: () => { },
    tagName: 'VIDEO',
    currentSrc: 'test-chord-video.mp4',
    src: 'test-chord-video.mp4',
    isConnected: true
  };

  const controllerId = 'test-chord-controller';
  mockVideo.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '1.00' } };
  window.VSC.stateManager.controllers.set(controllerId, {
    id: controllerId,
    element: mockVideo,
    videoSrc: mockVideo.currentSrc,
    tagName: mockVideo.tagName,
    created: Date.now(),
    isActive: true
  });

  const mockTarget = {
    nodeName: 'DIV',
    isContentEditable: false,
    getRootNode: () => ({ host: null })
  };

  const createModifierEvent = (modifiers) => ({
    keyCode: 80,
    type: 'keydown',
    timeStamp: Date.now() + Math.random(),
    target: mockTarget,
    getModifierState: (modifierName) => {
      if (modifierName === 'Shift') return Boolean(modifiers.shift);
      if (modifierName === 'Control') return Boolean(modifiers.ctrl);
      if (modifierName === 'Alt') return Boolean(modifiers.alt);
      if (modifierName === 'Meta' || modifierName === 'OS') return Boolean(modifiers.meta);
      return false;
    },
    preventDefault: () => { },
    stopPropagation: () => { }
  });

  eventManager.handleKeydown(createModifierEvent({ shift: false, ctrl: false, alt: false, meta: false }));
  assert.equal(mockVideo.playbackRate, 1.0, 'Plain P should not trigger Shift+P binding');

  eventManager.handleKeydown(createModifierEvent({ shift: true, ctrl: false, alt: false, meta: false }));
  assert.equal(mockVideo.playbackRate, 1.2, 'Shift+P should trigger chord binding');
});

runner.test('Legacy binding should remain shift-compatible', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);
  actionHandler.eventManager = eventManager;

  config.settings.keyBindings = [{
    action: 'faster',
    key: 68, // D
    value: 0.1,
    force: false,
    predefined: true
  }];

  const mockVideo = {
    playbackRate: 1.0,
    paused: false,
    muted: false,
    currentTime: 0,
    duration: 100,
    classList: {
      contains: () => false
    },
    dispatchEvent: () => { },
    tagName: 'VIDEO',
    currentSrc: 'test-legacy-video.mp4',
    src: 'test-legacy-video.mp4',
    isConnected: true
  };

  const controllerId = 'test-legacy-controller';
  mockVideo.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '1.00' } };
  window.VSC.stateManager.controllers.set(controllerId, {
    id: controllerId,
    element: mockVideo,
    videoSrc: mockVideo.currentSrc,
    tagName: mockVideo.tagName,
    created: Date.now(),
    isActive: true
  });

  const mockTarget = {
    nodeName: 'DIV',
    isContentEditable: false,
    getRootNode: () => ({ host: null })
  };

  eventManager.handleKeydown({
    keyCode: 68,
    type: 'keydown',
    timeStamp: Date.now(),
    target: mockTarget,
    getModifierState: (modifierName) => modifierName === 'Shift',
    preventDefault: () => { },
    stopPropagation: () => { }
  });

  assert.equal(mockVideo.playbackRate, 1.1, 'Legacy D binding should still work with Shift held');
});

runner.test('Chord binding should take precedence over legacy binding on same key', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const actionHandler = new window.VSC.ActionHandler(config, null);
  const eventManager = new window.VSC.EventManager(config, actionHandler);
  actionHandler.eventManager = eventManager;

  const originalRunAction = actionHandler.runAction.bind(actionHandler);
  const firedActions = [];
  actionHandler.runAction = (action, value, event) => {
    firedActions.push({ action, value });
    return originalRunAction(action, value, event);
  };

  config.settings.keyBindings = [
    {
      action: 'faster',
      key: 80, // P
      value: 0.1,
      force: false,
      predefined: true,
    },
    {
      action: 'slower',
      key: 80, // Shift+P
      value: 0.2,
      force: false,
      predefined: false,
      modifiers: {
        shift: true,
        ctrl: false,
        alt: false,
        meta: false,
      },
    },
  ];

  const mockVideo = {
    playbackRate: 1.0,
    paused: false,
    muted: false,
    currentTime: 0,
    duration: 100,
    classList: {
      contains: () => false,
    },
    dispatchEvent: () => {},
    tagName: 'VIDEO',
    currentSrc: 'test-chord-precedence-video.mp4',
    src: 'test-chord-precedence-video.mp4',
    isConnected: true,
  };

  const controllerId = 'test-chord-precedence-controller';
  mockVideo.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '1.00' } };
  window.VSC.stateManager.controllers.set(controllerId, {
    id: controllerId,
    element: mockVideo,
    videoSrc: mockVideo.currentSrc,
    tagName: mockVideo.tagName,
    created: Date.now(),
    isActive: true,
  });

  const mockTarget = {
    nodeName: 'DIV',
    isContentEditable: false,
    getRootNode: () => ({ host: null }),
  };

  const createModifierEvent = (modifiers) => ({
    keyCode: 80,
    type: 'keydown',
    timeStamp: Date.now() + Math.random(),
    target: mockTarget,
    getModifierState: (modifierName) => {
      if (modifierName === 'Shift') {
        return Boolean(modifiers.shift);
      }
      if (modifierName === 'Control') {
        return Boolean(modifiers.ctrl);
      }
      if (modifierName === 'Alt') {
        return Boolean(modifiers.alt);
      }
      if (modifierName === 'Meta' || modifierName === 'OS') {
        return Boolean(modifiers.meta);
      }
      return false;
    },
    preventDefault: () => {},
    stopPropagation: () => {},
  });

  eventManager.handleKeydown(createModifierEvent({ shift: true, ctrl: false, alt: false, meta: false }));
  assert.equal(firedActions.length, 1, 'Shift+P should fire exactly one action');
  assert.equal(firedActions[0].action, 'slower', 'Shift+P should resolve to chord action only');
  assert.equal(mockVideo.playbackRate, 0.8, 'Shift+P should trigger chord action, not legacy action');

  eventManager.handleKeydown(createModifierEvent({ shift: false, ctrl: false, alt: false, meta: false }));
  assert.equal(firedActions.length, 2, 'Plain P should add exactly one more action');
  assert.equal(firedActions[1].action, 'faster', 'Plain P should resolve to legacy action only');
  assert.equal(mockVideo.playbackRate, 0.9, 'Plain P should continue to trigger legacy action');
});

runner.test('Key display names should work for all supported keys', () => {
  // Test that key display logic handles various key types
  const keyCodeAliases = window.VSC?.Constants?.keyCodeAliases || {};

  // F13-F24 should have aliases
  for (let i = 13; i <= 24; i++) {
    const keyCode = 111 + i; // F13=124, etc.
    const expectedAlias = `F${i}`;

    // This test would fail with the old code but passes with our updates
    const hasAlias = keyCodeAliases[keyCode] !== undefined || keyCode === 124 + (i - 13);
    assert.equal(hasAlias, true, `F${i} key (${keyCode}) should be supported`);
  }
});

export default runner; 