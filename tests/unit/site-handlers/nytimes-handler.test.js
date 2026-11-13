/**
 * Unit tests for NYTimesHandler: NYT's betamax player videos are
 * `muted loop` with no `controls` inside <nyt-betamax>'s shadow root, which
 * must not be discarded by the generic gif-video filter.
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

function gifLikeVideo() {
  const video = document.createElement('video');
  video.loop = true;
  video.muted = true;
  return video;
}

function betamaxVideo(hostTag = 'nyt-betamax') {
  const host = document.createElement(hostTag);
  const root = host.attachShadow({ mode: 'open' });
  const wrapper = document.createElement('div');
  const video = gifLikeVideo();
  wrapper.appendChild(video);
  root.appendChild(wrapper);
  document.body.appendChild(host);
  return video;
}

describe('NYTimesHandler', () => {
  let manager;

  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    manager = window.VSC.siteHandlerManager;
    manager.currentHandler = null;
  });

  afterEach(() => {
    cleanupChromeMock();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    manager.currentHandler = null;
  });

  it('is selected on nytimes.com', () => {
    vi.stubGlobal('location', { hostname: 'www.nytimes.com' });
    expect(manager.getCurrentHandler()).toBeInstanceOf(window.VSC.NYTimesHandler);
  });

  it('is not selected on look-alike hosts', () => {
    vi.stubGlobal('location', { hostname: 'nytimes.com.example.org' });
    expect(manager.getCurrentHandler()).not.toBeInstanceOf(window.VSC.NYTimesHandler);
  });

  it('keeps muted looping betamax player videos', () => {
    vi.stubGlobal('location', { hostname: 'www.nytimes.com' });
    expect(manager.shouldIgnoreVideo(betamaxVideo())).toBe(false);
  });

  it('still ignores gif-like videos outside the betamax player', () => {
    vi.stubGlobal('location', { hostname: 'www.nytimes.com' });
    const loose = gifLikeVideo();
    document.body.appendChild(loose);
    expect(manager.shouldIgnoreVideo(loose)).toBe(true);
    expect(manager.shouldIgnoreVideo(betamaxVideo('nyt-other-thing'))).toBe(true);
  });

  it('leaves the gif-video filter unchanged on other sites', () => {
    vi.stubGlobal('location', { hostname: 'example.com' });
    expect(manager.shouldIgnoreVideo(betamaxVideo())).toBe(true);
  });

  it('surfaces betamax videos to the light scan even when light-DOM audio exists', () => {
    vi.stubGlobal('location', { hostname: 'www.nytimes.com' });
    document.body.appendChild(document.createElement('audio'));
    const video = betamaxVideo();

    const observer = new window.VSC.MediaElementObserver(
      { settings: { audioBoolean: true } },
      manager
    );
    const found = observer.scanForMediaLight(document);

    expect(found).toContain(video);
  });

  it('finds betamax videos nested in the video feed shadow root', () => {
    vi.stubGlobal('location', { hostname: 'www.nytimes.com' });
    const feed = document.createElement('nyt-video-feed');
    const feedRoot = feed.attachShadow({ mode: 'open' });
    const host = document.createElement('nyt-betamax');
    const video = gifLikeVideo();
    host.attachShadow({ mode: 'open' }).appendChild(video);
    feedRoot.appendChild(host);
    document.body.appendChild(feed);

    expect(manager.detectSpecialVideos(document)).toEqual([video]);
  });
});
