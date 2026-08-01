/**
 * Unit tests for FacebookHandler.getControllerPosition.
 * Covers both the deeply nested feed and shallower plugin player layouts.
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

function buildPlayer(ancestorCount) {
  const parent = document.createElement('div');
  const video = document.createElement('video');
  parent.appendChild(video);

  const ancestors = [];
  let outermost = parent;
  for (let index = 0; index < ancestorCount; index += 1) {
    const ancestor = document.createElement('div');
    ancestor.appendChild(outermost);
    ancestors.push(ancestor);
    outermost = ancestor;
  }
  document.body.appendChild(outermost);

  return { parent, video, ancestors };
}

describe('FacebookHandler', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    vi.stubGlobal('location', { hostname: 'www.facebook.com' });
  });

  afterEach(() => {
    cleanupChromeMock();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('preserves the seven-level promotion for deeply nested feed videos', () => {
    const { parent, video, ancestors } = buildPlayer(7);
    const handler = new window.VSC.FacebookHandler();

    const result = handler.getControllerPosition(parent, video);

    expect(result.insertionPoint).toBe(ancestors[6]);
    expect(result.targetParent).toBe(ancestors[6]);
    expect(result.insertionMethod).toBe('firstChild');
  });

  it('uses a connected nearby fallback for shallow plugin players', () => {
    // Four wrapper divs plus body and html reproduce the six ancestors above
    // the supplied plugin video's parent. The former seventh access returned
    // null without throwing, so VideoController failed during DOM insertion.
    const { parent, video, ancestors } = buildPlayer(4);
    const handler = new window.VSC.FacebookHandler();

    const result = handler.getControllerPosition(parent, video);

    expect(result.insertionPoint).toBe(ancestors[0]);
    expect(result.targetParent).toBe(ancestors[0]);
    expect(result.insertionPoint.isConnected).toBe(true);
    expect(() => {
      result.insertionPoint.insertBefore(
        document.createElement('vsc-controller'),
        result.insertionPoint.firstChild
      );
    }).not.toThrow();
  });
});
