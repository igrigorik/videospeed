// Import necessary modules
import { installChromeMock, cleanupChromeMock } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert } from '../../helpers/test-utils.js';
import { loadObserverModules } from '../../helpers/module-loader.js';

// Load all required modules
await loadObserverModules();

const runner = new SimpleTestRunner();

runner.beforeEach(() => {
  installChromeMock();
});

runner.afterEach(() => {
  cleanupChromeMock();
});

runner.test('VideoMutationObserver should process element nodes', () => {
  const mockConfig = { settings: {} };
  const mockOnVideoFound = [];
  const mockOnVideoRemoved = [];

  const onVideoFound = (video, parent) => {
    mockOnVideoFound.push({ video, parent });
  };

  const onVideoRemoved = (video) => {
    mockOnVideoRemoved.push(video);
  };

  const observer = new window.VSC.VideoMutationObserver(
    mockConfig,
    onVideoFound,
    onVideoRemoved
  );

  const videoElement = document.createElement('video');
  const divElement = document.createElement('div');

  const mutation = {
    type: 'childList',
    addedNodes: [videoElement, divElement],
    removedNodes: [],
    target: document.body
  };

  observer.processChildListMutation(mutation);

  // Video element should trigger callback
  assert.equal(mockOnVideoFound.length, 1);
  assert.equal(mockOnVideoFound[0].video, videoElement);
  assert.equal(mockOnVideoFound[0].parent, document.body);
});

runner.test('VideoMutationObserver should skip non-element nodes', () => {
  const mockConfig = { settings: {} };
  const mockOnVideoFound = [];
  const mockOnVideoRemoved = [];

  const onVideoFound = (video, parent) => {
    mockOnVideoFound.push({ video, parent });
  };

  const onVideoRemoved = (video) => {
    mockOnVideoRemoved.push(video);
  };

  const observer = new window.VSC.VideoMutationObserver(
    mockConfig,
    onVideoFound,
    onVideoRemoved
  );

  const textNode = document.createTextNode('text');
  const commentNode = document.createComment('comment');
  const videoElement = document.createElement('video');

  const mutation = {
    type: 'childList',
    addedNodes: [textNode, commentNode, videoElement],
    removedNodes: [],
    target: document.body
  };

  observer.processChildListMutation(mutation);

  // Only video element should be processed
  assert.equal(mockOnVideoFound.length, 1);
  assert.equal(mockOnVideoFound[0].video, videoElement);
  assert.equal(mockOnVideoFound[0].parent, document.body);
});

runner.test('VideoMutationObserver should handle removed video elements', () => {
  const mockConfig = { settings: {} };
  const mockOnVideoFound = [];
  const mockOnVideoRemoved = [];

  const onVideoFound = (video, parent) => {
    mockOnVideoFound.push({ video, parent });
  };

  const onVideoRemoved = (video) => {
    mockOnVideoRemoved.push(video);
  };

  const observer = new window.VSC.VideoMutationObserver(
    mockConfig,
    onVideoFound,
    onVideoRemoved
  );

  const videoElement = document.createElement('video');
  videoElement.vsc = { remove: () => { } };

  const mutation = {
    type: 'childList',
    addedNodes: [],
    removedNodes: [videoElement],
    target: document.body
  };

  observer.processChildListMutation(mutation);

  assert.equal(mockOnVideoRemoved.length, 1);
  assert.equal(mockOnVideoRemoved[0], videoElement);
});

runner.test('VideoMutationObserver should handle null and undefined nodes gracefully', () => {
  const mockConfig = { settings: {} };
  const mockOnVideoFound = [];
  const mockOnVideoRemoved = [];

  const onVideoFound = (video, parent) => {
    mockOnVideoFound.push({ video, parent });
  };

  const onVideoRemoved = (video) => {
    mockOnVideoRemoved.push(video);
  };

  const observer = new window.VSC.VideoMutationObserver(
    mockConfig,
    onVideoFound,
    onVideoRemoved
  );

  const mutation = {
    type: 'childList',
    addedNodes: [null, undefined, document.createElement('video')],
    removedNodes: [null, undefined],
    target: document.body
  };

  // Should not throw
  observer.processChildListMutation(mutation);

  // Only the video element should be processed
  assert.equal(mockOnVideoFound.length, 1);
  assert.equal(mockOnVideoRemoved.length, 0);
});

runner.test('VideoMutationObserver should detect video elements in shadow DOM', () => {
  const mockConfig = { settings: {} };
  const mockOnVideoFound = [];
  const mockOnVideoRemoved = [];

  const onVideoFound = (video, parent) => {
    mockOnVideoFound.push({ video, parent });
  };

  const onVideoRemoved = (video) => {
    mockOnVideoRemoved.push(video);
  };

  const observer = new window.VSC.VideoMutationObserver(
    mockConfig,
    onVideoFound,
    onVideoRemoved
  );

  const host = document.createElement('div');
  const shadowRoot = host.attachShadow({ mode: 'open' });
  const videoElement = document.createElement('video');
  shadowRoot.appendChild(videoElement);

  observer.checkForVideoAndShadowRoot(host, document.body, true);

  assert.equal(mockOnVideoFound.length, 1);
  assert.equal(mockOnVideoFound[0].video, videoElement);
  assert.equal(mockOnVideoFound[0].parent, videoElement.parentNode);
});

runner.test('VideoMutationObserver should handle HTMLCollection children properly', () => {
  const mockConfig = { settings: {} };
  const mockOnVideoFound = [];
  const mockOnVideoRemoved = [];

  const onVideoFound = (video, parent) => {
    mockOnVideoFound.push({ video, parent });
  };

  const onVideoRemoved = (video) => {
    mockOnVideoRemoved.push(video);
  };

  const observer = new window.VSC.VideoMutationObserver(
    mockConfig,
    onVideoFound,
    onVideoRemoved
  );

  // Create a container with multiple child elements including a video
  const container = document.createElement('div');
  const videoElement = document.createElement('video');
  const spanElement = document.createElement('span');
  const pElement = document.createElement('p');

  container.appendChild(spanElement);
  container.appendChild(videoElement);
  container.appendChild(pElement);

  // Simulate the processNodeChildren call directly
  observer.processNodeChildren(container, document.body, true);

  // Should find the video element in the children
  assert.equal(mockOnVideoFound.length, 1);
  assert.equal(mockOnVideoFound[0].video, videoElement);
});

runner.test('VideoMutationObserver should detect nested video elements', () => {
  const mockConfig = { settings: {} };
  const mockOnVideoFound = [];
  const mockOnVideoRemoved = [];

  const onVideoFound = (video, parent) => {
    mockOnVideoFound.push({ video, parent });
  };

  const onVideoRemoved = (video) => {
    mockOnVideoRemoved.push(video);
  };

  const observer = new window.VSC.VideoMutationObserver(
    mockConfig,
    onVideoFound,
    onVideoRemoved
  );

  const container = document.createElement('div');
  const innerDiv = document.createElement('div');
  const videoElement = document.createElement('video');
  innerDiv.appendChild(videoElement);
  container.appendChild(innerDiv);

  observer.checkForVideoAndShadowRoot(container, document.body, true);

  assert.equal(mockOnVideoFound.length, 1);
  assert.equal(mockOnVideoFound[0].video, videoElement);
  assert.equal(mockOnVideoFound[0].parent, videoElement.parentNode);
});

export { runner as mutationObserverTestRunner }; 