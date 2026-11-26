/**
 * Unit tests for InstagramHandler.getControllerPosition (#1657).
 * The fixture mirrors the live Reels tree: the video sits under a chain of
 * z-index:0 wrappers, and the native role="group" overlay lives in a sibling
 * subtree of the outermost wrapper.
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

function buildReel({ wrapperCount = 6, withOverlay = true } = {}) {
  const parent = document.createElement('div');
  const video = document.createElement('video');
  parent.appendChild(video);

  let branch = parent;
  for (let index = 0; index < wrapperCount; index += 1) {
    const wrapper = document.createElement('div');
    wrapper.appendChild(branch);
    branch = wrapper;
  }

  const container = document.createElement('div');
  container.appendChild(branch);

  if (withOverlay) {
    const overlayHost = document.createElement('div');
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'group');
    overlay.setAttribute('aria-label', 'Player de vídeo');
    overlayHost.appendChild(overlay);
    container.appendChild(overlayHost);
  }

  const outer = document.createElement('div');
  outer.appendChild(container);
  document.body.appendChild(outer);

  return { parent, video, container };
}

describe('InstagramHandler', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    vi.stubGlobal('location', { hostname: 'www.instagram.com' });
  });

  afterEach(() => {
    cleanupChromeMock();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('matches only www.instagram.com', () => {
    expect(window.VSC.InstagramHandler.matches()).toBe(true);
    vi.stubGlobal('location', { hostname: 'www.facebook.com' });
    expect(window.VSC.InstagramHandler.matches()).toBe(false);
  });

  it('promotes insertion to the container shared with the native overlay', () => {
    const { parent, video, container } = buildReel();
    const handler = new window.VSC.InstagramHandler();

    const result = handler.getControllerPosition(parent, video);

    expect(result.insertionPoint).toBe(container);
    expect(result.targetParent).toBe(container);
    expect(result.insertionMethod).toBe('firstChild');
  });

  it('stops at the nearest container that holds an overlay sibling', () => {
    const { parent, video, container } = buildReel();
    const innerGroup = document.createElement('div');
    innerGroup.setAttribute('role', 'group');
    parent.parentElement.appendChild(innerGroup);
    const handler = new window.VSC.InstagramHandler();

    // Nearest shared container wins: deeper hoisting only adds risk.
    const result = handler.getControllerPosition(parent, video);

    expect(result.insertionPoint).toBe(parent.parentElement);
    expect(result.insertionPoint).not.toBe(container);
  });

  it('falls back to the video parent when no overlay is found', () => {
    const { parent, video } = buildReel({ withOverlay: false });
    const handler = new window.VSC.InstagramHandler();

    const result = handler.getControllerPosition(parent, video);

    expect(result.insertionPoint).toBe(parent);
  });

  it('does not hoist past the depth bound on unexpectedly deep layouts', () => {
    const { parent, video } = buildReel({ wrapperCount: 20 });
    const handler = new window.VSC.InstagramHandler();

    const result = handler.getControllerPosition(parent, video);

    expect(result.insertionPoint).toBe(parent);
  });
});
