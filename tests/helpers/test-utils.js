/**
 * Test utilities and helpers
 */

/**
 * Create a mock video element for testing
 * @param {Object} options - Video options
 * @returns {HTMLVideoElement} Mock video element
 */
export function createMockVideo(options = {}) {
  const video = document.createElement('video');

  // Set up properties directly on the video element
  Object.defineProperties(video, {
    playbackRate: {
      value: options.playbackRate || 1.0,
      writable: true,
      configurable: true,
    },
    currentTime: {
      value: options.currentTime || 0,
      writable: true,
      configurable: true,
    },
    duration: {
      value: options.duration || 100,
      writable: true,
      configurable: true,
    },
    currentSrc: {
      value:
        options.currentSrc !== undefined ? options.currentSrc : 'https://example.com/video.mp4',
      writable: true,
      configurable: true,
    },
    readyState: {
      value: options.readyState ?? 1,
      writable: true,
      configurable: true,
    },
    paused: {
      value: options.paused || false,
      writable: true,
      configurable: true,
    },
    muted: {
      value: options.muted || false,
      writable: true,
      configurable: true,
    },
    volume: {
      value: options.volume || 1.0,
      writable: true,
      configurable: true,
    },
    seekable: {
      value: options.seekable || {
        length: 0,
        start: () => 0,
        end: () => 0,
      },
      writable: true,
      configurable: true,
    },
    ownerDocument: {
      value: document,
      writable: true,
      configurable: true,
    },
  });

  // Mock methods
  video.play = () => {
    video.paused = false;
    return Promise.resolve();
  };

  video.pause = () => {
    video.paused = true;
  };

  video.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    width: 640,
    height: 480,
  });

  // Enhanced event handling
  const eventListeners = new Map();
  video.addEventListener = (type, listener) => {
    if (!eventListeners.has(type)) {
      eventListeners.set(type, []);
    }
    eventListeners.get(type).push(listener);
  };

  video.removeEventListener = (type, listener) => {
    if (eventListeners.has(type)) {
      const listeners = eventListeners.get(type);
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  };

  video.dispatchEvent = (event) => {
    if (eventListeners.has(event.type)) {
      eventListeners.get(event.type).forEach((listener) => {
        event.target = video;
        listener(event);
      });
    }
  };

  video.matches = () => false;
  video.querySelector = () => null;
  video.querySelectorAll = () => [];

  return video;
}

/**
 * Create a mock audio element for testing
 * @param {Object} options - Audio options
 * @returns {HTMLAudioElement} Mock audio element
 */
export function createMockAudio(options = {}) {
  const audio = document.createElement('audio');

  // Set default properties
  audio.playbackRate = options.playbackRate || 1.0;
  audio.currentTime = options.currentTime || 0;
  audio.duration = options.duration || 100;
  audio.currentSrc = options.currentSrc || 'https://example.com/audio.mp3';
  audio.paused = options.paused || false;
  audio.muted = options.muted || false;
  audio.volume = options.volume || 1.0;

  // Mock methods
  audio.play = () => {
    audio.paused = false;
    return Promise.resolve();
  };

  audio.pause = () => {
    audio.paused = true;
  };

  return audio;
}

/**
 * Create a mock DOM environment
 * @returns {Object} Mock DOM elements
 */
export function createMockDOM() {
  const container = document.createElement('div');
  container.id = 'test-container';
  document.body.appendChild(container);

  return {
    container,
    cleanup: () => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
}

/**
 * Wait for a specified amount of time
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise} Promise that resolves after the delay
 */
export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock event
 * @param {string} type - Event type
 * @param {Object} properties - Event properties
 * @returns {Event} Mock event
 */
export function createMockEvent(type, properties = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, properties);
  return event;
}

/**
 * Create a mock keyboard event with v2 identity fields.
 * @param {string} type - Event type (keydown, keyup, keypress)
 * @param {number} keyCode - Key code
 * @param {Object} options - Additional event options (code, key, ctrlKey, altKey, shiftKey, metaKey, isComposing, etc.)
 * @returns {KeyboardEvent} Mock keyboard event
 */
export function createMockKeyboardEvent(type, keyCode, options = {}) {
  const event = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    keyCode,
    code: options.code || '',
    key: options.key || '',
    ctrlKey: options.ctrlKey || false,
    altKey: options.altKey || false,
    shiftKey: options.shiftKey || false,
    metaKey: options.metaKey || false,
    ...options,
  });

  // Override read-only properties for testing
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  if (options.code !== undefined) {
    Object.defineProperty(event, 'code', { value: options.code });
  }
  if (options.key !== undefined) {
    Object.defineProperty(event, 'key', { value: options.key });
  }
  if (options.isComposing !== undefined) {
    Object.defineProperty(event, 'isComposing', { value: options.isComposing });
  }

  return event;
}
