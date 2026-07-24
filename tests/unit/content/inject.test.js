/**
 * Unit tests for VideoSpeedExtension (inject.js)
 * Testing the fix for video elements without parentElement
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';

// Load all required modules

let mockDOM;
let extension;

describe('Inject', () => {
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
    if (extension) {
      extension = null;
    }

    // Clean up any remaining video elements
    const videos = document.querySelectorAll('video');
    videos.forEach((video) => {
      if (video.vsc) {
        try {
          video.vsc.remove();
        } catch {
          // Ignore cleanup errors
        }
      }
      if (video.parentNode) {
        try {
          video.parentNode.removeChild(video);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  /**
   * Create a video element without parentElement but with parentNode
   * This simulates shadow DOM scenarios where parentElement is undefined
   */
  function createVideoWithoutParentElement() {
    const video = createMockVideo({ readyState: 4 });
    const parentNode = document.createElement('div');

    // Simulate shadow DOM scenario where parentElement is undefined
    Object.defineProperty(video, 'parentElement', {
      value: null,
      writable: false,
      configurable: true,
    });

    Object.defineProperty(video, 'parentNode', {
      value: parentNode,
      writable: false,
      configurable: true,
    });

    // Mock isConnected property for validity check
    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true,
    });

    return { video, parentNode };
  }

  it('onVideoFound should handle video elements without parentElement', async () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const { video, parentNode } = createVideoWithoutParentElement();

    extension.onVideoFound(video, parentNode);

    expect(video.vsc).toBeDefined();
    expect(video.vsc instanceof window.VSC.VideoController).toBe(true);
    expect(video.vsc.parent).toBe(parentNode);
  });

  it('onVideoFound should prefer parentElement when available', async () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const video = createMockVideo({ readyState: 4 });
    const parentElement = document.createElement('div');
    const parentNode = document.createElement('span');

    Object.defineProperty(video, 'parentElement', {
      value: parentElement,
      writable: false,
      configurable: true,
    });

    Object.defineProperty(video, 'parentNode', {
      value: parentNode,
      writable: false,
      configurable: true,
    });

    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true,
    });

    extension.onVideoFound(video, parentNode);

    expect(video.vsc).toBeDefined();
    // VideoController constructor uses target.parentElement || parent
    expect(video.vsc.parent).toBe(parentElement);
  });

  it('onVideoFound defers controller when readyState < 2 and video has src', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    // readyState=1 with a src → should defer, not attach immediately
    const video = createMockVideo({ readyState: 1 });
    const parent = document.createElement('div');

    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true,
    });

    extension.onVideoFound(video, parent);

    // Controller should NOT be attached yet — waiting for loadeddata
    expect(video.vsc).toBeUndefined();
  });

  it('removes a deferred listener when media disappears before loadeddata', () => {
    extension = window.VSC_controller;
    const video = createMockVideo({ readyState: 1 });
    const parent = document.createElement('div');

    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: true,
      configurable: true,
    });

    extension.onVideoFound(video, parent);
    expect(extension.deferredMediaListeners.has(video)).toBe(true);

    extension.onVideoRemoved(video);
    expect(extension.deferredMediaListeners.has(video)).toBe(false);

    video.readyState = 4;
    video.dispatchEvent(new Event('loadeddata'));
    expect(video.vsc).toBeUndefined();
  });

  it('onVideoFound attaches immediately when readyState >= 2', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const video = createMockVideo({ readyState: 4 });
    const parent = document.createElement('div');

    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true,
    });

    extension.onVideoFound(video, parent);

    // Controller should be attached immediately
    expect(video.vsc).toBeDefined();
    expect(video.vsc instanceof window.VSC.VideoController).toBe(true);
  });

  it('onVideoFound defers controller when video has no src (no-source placeholder)', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    // readyState=0, no src → MUST defer, because injecting into raw uninitialized DOM crashes Polymer
    const video = createMockVideo({ readyState: 0, currentSrc: '' });
    video.addEventListener = vi.fn();
    const parent = document.createElement('div');

    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true,
    });

    extension.onVideoFound(video, parent);

    expect(video.vsc).toBeUndefined();
    // Verify event listener was added
    expect(video.addEventListener).toHaveBeenCalledWith(
      'loadeddata',
      expect.any(Function),
      expect.objectContaining({ once: true })
    );
  });

  it('onVideoFound should handle video with neither parentElement nor parentNode', async () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const video = createMockVideo({ readyState: 4 });
    const fallbackParent = document.createElement('div');

    Object.defineProperty(video, 'parentElement', {
      value: null,
      writable: false,
      configurable: true,
    });

    Object.defineProperty(video, 'parentNode', {
      value: null,
      writable: false,
      configurable: true,
    });

    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true,
    });

    // Should not throw even with no parent references
    extension.onVideoFound(video, fallbackParent);

    expect(video.vsc).toBeDefined();
    expect(video.vsc.parent).toBe(fallbackParent);
  });

  // --- CSS injection: adoptedStyleSheets composition ---

  /** Helper: reset extension CSS state so injectControllerCSS can re-run. */
  function resetCSSState(ext) {
    document.adoptedStyleSheets = (document.adoptedStyleSheets || []).filter(
      (s) => s !== ext._controllerSheet && s !== ext._customSheet
    );
    ext._controllerSheet = null;
    ext._customSheet = null;
  }

  it('injectControllerCSS adds default sheet to adoptedStyleSheets', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = '';

    extension.injectControllerCSS();

    expect(extension._controllerSheet).not.toBeNull();
    expect(document.adoptedStyleSheets).toContain(extension._controllerSheet);
  });

  it('injectControllerCSS adds both default and custom sheets when customCSS is set', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = 'vsc-controller { top: 42px; }';

    extension.injectControllerCSS();

    expect(extension._controllerSheet).not.toBeNull();
    expect(extension._customSheet).not.toBeNull();
    expect(document.adoptedStyleSheets).toContain(extension._controllerSheet);
    expect(document.adoptedStyleSheets).toContain(extension._customSheet);
  });

  it('injectControllerCSS skips custom sheet when customCSS is empty', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = '';

    extension.injectControllerCSS();

    expect(extension._controllerSheet).not.toBeNull();
    expect(extension._customSheet).toBeNull();
  });

  it('injectControllerCSS is idempotent (no-op on second call)', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = '';

    extension.injectControllerCSS();
    const countAfterFirst = document.adoptedStyleSheets.length;
    extension.injectControllerCSS();

    expect(document.adoptedStyleSheets.length).toBe(countAfterFirst);
  });

  it('setupCSSLiveUpdates adds custom sheet on storage change', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = '';

    extension.injectControllerCSS();
    // deferDOMWork is async — register listener explicitly for unit test
    extension.setupCSSLiveUpdates();
    expect(extension._customSheet).toBeNull();

    document.documentElement.dispatchEvent(
      new CustomEvent('VSC_STORAGE_CHANGED', {
        detail: { customCSS: { newValue: 'vsc-controller { color: red; }' } },
      })
    );

    expect(extension._customSheet).not.toBeNull();
    expect(document.adoptedStyleSheets).toContain(extension._customSheet);
    expect(document.adoptedStyleSheets).toContain(extension._controllerSheet);
  });

  it('setupCSSLiveUpdates removes custom sheet when customCSS cleared', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = 'vsc-controller { color: red; }';

    extension.injectControllerCSS();
    extension.setupCSSLiveUpdates();
    expect(extension._customSheet).not.toBeNull();

    document.documentElement.dispatchEvent(
      new CustomEvent('VSC_STORAGE_CHANGED', {
        detail: { customCSS: { newValue: '' } },
      })
    );

    expect(extension._customSheet).toBeNull();
    expect(document.adoptedStyleSheets).toContain(extension._controllerSheet);
  });
});
