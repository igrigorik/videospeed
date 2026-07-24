/**
 * Unit tests for YouTubeHandler.getControllerPosition
 * Verifies #player-controls scoping to prevent DOM promotion on main site.
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

describe('YouTubeHandler', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
  });

  afterEach(() => {
    cleanupChromeMock();
  });

  function buildDOM({ playerControlsIn }) {
    // Simulates: grandparent > parent(.html5-video-player) > videoContainer > video
    const grandparent = document.createElement('div');
    const parent = document.createElement('div');
    parent.className = 'html5-video-player';
    const videoContainer = document.createElement('div');
    const video = document.createElement('video');

    grandparent.appendChild(parent);
    parent.appendChild(videoContainer);
    videoContainer.appendChild(video);

    if (playerControlsIn === 'grandparent') {
      const controls = document.createElement('div');
      controls.id = 'player-controls';
      grandparent.appendChild(controls);
    } else if (playerControlsIn === 'document') {
      const controls = document.createElement('div');
      controls.id = 'player-controls';
      document.body.appendChild(controls);
    }

    document.body.appendChild(grandparent);
    return { grandparent, parent, videoContainer, video };
  }

  it('matches www.youtube.com and the privacy-enhanced embed host only', () => {
    const Handler = window.VSC.YouTubeHandler;
    expect(Handler.matches('www.youtube.com')).toBe(true);
    expect(Handler.matches('www.youtube-nocookie.com')).toBe(true);
    expect(Handler.matches('music.youtube.com')).toBe(false);
    expect(Handler.matches('example.com')).toBe(false);
  });

  it('promotes insertion to parent when #player-controls is in scoped subtree (embed)', () => {
    const handler = new window.VSC.YouTubeHandler();
    const { grandparent, videoContainer, video } = buildDOM({ playerControlsIn: 'grandparent' });

    const result = handler.getControllerPosition(videoContainer, video);

    // Should promote: videoContainer.parentElement(.html5-video-player).parentElement = grandparent
    expect(result.insertionPoint).toBe(grandparent);

    grandparent.remove();
  });

  it('does NOT promote when #player-controls exists only elsewhere in document (main site)', () => {
    const handler = new window.VSC.YouTubeHandler();
    const { grandparent, parent, videoContainer, video } = buildDOM({
      playerControlsIn: 'document',
    });

    const result = handler.getControllerPosition(videoContainer, video);

    // Should NOT promote — #player-controls is outside the scoped subtree
    expect(result.insertionPoint).toBe(parent);

    grandparent.remove();
    document.getElementById('player-controls')?.remove();
  });

  it('does not promote when no #player-controls exists at all', () => {
    const handler = new window.VSC.YouTubeHandler();
    const { grandparent, parent, videoContainer, video } = buildDOM({});

    const result = handler.getControllerPosition(videoContainer, video);

    expect(result.insertionPoint).toBe(parent);

    grandparent.remove();
  });

  it('anchors at body level on embeds when #player-controls is a fixed body child (ytm UI)', () => {
    // 2026 embed layout: the control layer is a position:fixed <body> child.
    // Anything inside #player is stuck under it, and ytp-autohide never
    // toggles, so the controller must escape to the root stacking context.
    window.history.pushState({}, '', '/embed/abc123');
    const handler = new window.VSC.YouTubeHandler();
    const { grandparent, videoContainer, video } = buildDOM({ playerControlsIn: 'document' });

    const result = handler.getControllerPosition(videoContainer, video);

    expect(result.insertionPoint).toBe(document.body);
    expect(result.insertionMethod).toBe('firstChild');

    grandparent.remove();
    document.getElementById('player-controls')?.remove();
    window.history.replaceState({}, '', '/');
  });

  it('keeps the #player promotion on embeds with the older sibling layout', () => {
    window.history.pushState({}, '', '/embed/abc123');
    const handler = new window.VSC.YouTubeHandler();
    const { grandparent, videoContainer, video } = buildDOM({ playerControlsIn: 'grandparent' });

    const result = handler.getControllerPosition(videoContainer, video);

    // No body-level layer exists, so the pre-ytm promotion still applies.
    expect(result.insertionPoint).toBe(grandparent);

    grandparent.remove();
    window.history.replaceState({}, '', '/');
  });
});
