/**
 * Unit tests for YouTubeHandler.getControllerPosition
 * Verifies #player-controls scoping to prevent DOM promotion on main site.
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo } from '../../helpers/test-utils.js';

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

  it('returns zero live latency when YouTube reports playback is at live head', () => {
    const handler = new window.VSC.YouTubeHandler();
    const video = createMockVideo({
      currentTime: 11355,
      duration: 14610,
      seekable: {
        length: 1,
        start: () => 0,
        end: () => 14610,
      },
    });
    const player = document.createElement('div');
    player.id = 'movie_player';
    player.getVideoData = () => ({ isLive: true });
    player.getProgressState = () => ({
      current: 11355,
      seekableEnd: 11355,
      isAtLiveHead: true,
    });
    document.body.appendChild(player);

    expect(handler.getLiveLatency(video)).toBe(0);

    player.remove();
  });

  it('uses YouTube progress state instead of native seekable end for live latency', () => {
    const handler = new window.VSC.YouTubeHandler();
    const video = createMockVideo({
      currentTime: 11355,
      duration: 14610,
      seekable: {
        length: 1,
        start: () => 0,
        end: () => 14610,
      },
    });
    const player = document.createElement('div');
    player.id = 'movie_player';
    player.getVideoData = () => ({ isLive: true });
    player.getProgressState = () => ({
      current: 11355,
      seekableEnd: 11435,
      isAtLiveHead: false,
    });
    document.body.appendChild(player);

    expect(handler.getLiveLatency(video)).toBe(80);

    player.remove();
  });
});
