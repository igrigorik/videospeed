/**
 * YouTube gesture-to-media attribution tests.
 *
 * Player controls are frequently overlays or siblings of <video>, so the
 * resolver must associate only a unique local player and otherwise abstain.
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

function buildPlayer({ embedded = false } = {}) {
  const root = document.createElement('div');
  const player = document.createElement('div');
  player.className = 'html5-video-player';
  const video = document.createElement('video');
  player.appendChild(video);

  const controls = document.createElement('div');
  controls.className = 'ytp-chrome-bottom';
  const button = document.createElement('button');
  controls.appendChild(button);

  root.appendChild(player);
  if (embedded) {
    controls.id = 'player-controls';
    root.appendChild(controls);
  } else {
    player.appendChild(controls);
  }
  document.body.appendChild(root);

  return { root, player, video, controls, button };
}

function gesturePath(target, ...ancestors) {
  return {
    target,
    composedPath: () => [target, ...ancestors, document, window],
  };
}

describe('YouTubeHandler gesture resolution', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
  });

  afterEach(() => {
    document.querySelectorAll('[data-test-youtube-player]').forEach((node) => node.remove());
    cleanupChromeMock();
  });

  it('associates regular player chrome with its unique controlled video', () => {
    const handler = new window.VSC.YouTubeHandler();
    const first = buildPlayer();
    const second = buildPlayer();
    first.root.dataset.testYoutubePlayer = '';
    second.root.dataset.testYoutubePlayer = '';

    const resolved = handler.resolveGestureMedia(
      gesturePath(first.button, first.controls, first.player, first.root),
      [first.video, second.video]
    );

    expect(resolved).toBe(first.video);
  });

  it('associates embedded sibling #player-controls with its local video only', () => {
    const handler = new window.VSC.YouTubeHandler();
    const embedded = buildPlayer({ embedded: true });
    const other = buildPlayer({ embedded: true });
    embedded.root.dataset.testYoutubePlayer = '';
    other.root.dataset.testYoutubePlayer = '';

    const resolved = handler.resolveGestureMedia(
      gesturePath(embedded.button, embedded.controls, embedded.root),
      [embedded.video, other.video]
    );

    expect(resolved).toBe(embedded.video);
  });

  it('does not let an unrelated global #player-controls claim a video', () => {
    const handler = new window.VSC.YouTubeHandler();
    const player = buildPlayer();
    player.root.dataset.testYoutubePlayer = '';
    const unrelatedControls = document.createElement('div');
    unrelatedControls.id = 'player-controls';
    const button = document.createElement('button');
    unrelatedControls.appendChild(button);
    document.body.appendChild(unrelatedControls);

    const resolved = handler.resolveGestureMedia(gesturePath(button, unrelatedControls), [
      player.video,
    ]);

    expect(resolved).toBeNull();
    unrelatedControls.remove();
  });

  it('abstains when one player container contains multiple controlled videos', () => {
    const handler = new window.VSC.YouTubeHandler();
    const player = buildPlayer();
    player.root.dataset.testYoutubePlayer = '';
    const secondVideo = document.createElement('video');
    player.player.appendChild(secondVideo);

    const resolved = handler.resolveGestureMedia(
      gesturePath(player.button, player.controls, player.player, player.root),
      [player.video, secondVideo]
    );

    expect(resolved).toBeNull();
  });
});
