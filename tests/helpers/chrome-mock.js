/**
 * Chrome API mock for testing
 */

const mockStorage = {
  enabled: true,
  lastSpeed: 1.0,
  keyBindings: [],
  rememberSpeed: false,
  forceLastSavedSpeed: false,
  audioBoolean: false,
  startHidden: false,
  controllerOpacity: 0.3,
  controllerButtonSize: 14,
  blacklist: 'www.instagram.com\nx.com',
  logLevel: 3,
};

// Track onChanged listeners so set() can fire them
const onChangedListeners = [];

export const chromeMock = {
  storage: {
    sync: {
      get: (keys, callback) => {
        // Simulate async behavior
        setTimeout(() => {
          const result =
            typeof keys === 'object' && keys !== null
              ? Object.keys(keys).reduce((acc, key) => {
                  acc[key] = mockStorage[key] !== undefined ? mockStorage[key] : keys[key];
                  return acc;
                }, {})
              : { ...mockStorage };
          callback(result);
        }, 10);
      },
      set: (items, callback) => {
        // Build changes object BEFORE mutating storage (mirrors real chrome behavior)
        const changes = {};
        for (const [key, newValue] of Object.entries(items)) {
          changes[key] = { oldValue: mockStorage[key], newValue };
        }

        Object.assign(mockStorage, items);

        // Fire onChanged listeners asynchronously (mirrors real chrome behavior)
        setTimeout(() => {
          for (const listener of onChangedListeners) {
            listener(changes, 'sync');
          }
        }, 5);

        setTimeout(() => callback && callback(), 10);
      },
      remove: (keys, callback) => {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        keysArray.forEach((key) => delete mockStorage[key]);
        setTimeout(() => callback && callback(), 10);
      },
      clear: (callback) => {
        Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
        setTimeout(() => callback && callback(), 10);
      },
    },
    onChanged: {
      addListener: (callback) => {
        onChangedListeners.push(callback);
      },
      removeListener: (callback) => {
        const idx = onChangedListeners.indexOf(callback);
        if (idx !== -1) onChangedListeners.splice(idx, 1);
      },
    },
  },
  runtime: {
    getURL: (path) => `chrome-extension://test-extension/${path}`,
    id: 'test-extension-id',
    lastError: null,
    onMessage: {
      addListener: (_callback) => {
        // Mock message listener
      },
    },
  },
  tabs: {
    query: (queryInfo, callback) => {
      callback([
        {
          id: 1,
          active: true,
          url: 'https://www.youtube.com/watch?v=test',
        },
      ]);
    },
    sendMessage: (tabId, message, callback) => {
      setTimeout(() => callback && callback({}), 10);
    },
  },
  action: {
    setIcon: (details, callback) => {
      setTimeout(() => callback && callback(), 10);
    },
  },
};

/**
 * Install Chrome API mock into global scope
 */
export function installChromeMock() {
  globalThis.chrome = chromeMock;
}

/**
 * Clean up Chrome API mock from global scope
 */
export function cleanupChromeMock() {
  delete globalThis.chrome;
}

/**
 * Reset mock storage to defaults
 */
export function resetMockStorage() {
  Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
  Object.assign(mockStorage, {
    enabled: true,
    lastSpeed: 1.0,
    keyBindings: [],
    rememberSpeed: false,
    forceLastSavedSpeed: false,
    audioBoolean: false,
    startHidden: false,
    controllerOpacity: 0.3,
    controllerButtonSize: 14,
    blacklist: 'www.instagram.com\nx.com',
    logLevel: 3,
  });
  // Clear all onChanged listeners between tests
  onChangedListeners.length = 0;
}

/**
 * Get a direct reference to mock storage for assertions
 * This lets tests inspect what was actually written without going through get()
 */
export function getMockStorage() {
  return mockStorage;
}

/**
 * Write directly to mock storage WITHOUT firing onChanged listeners.
 * Simulates an external context (e.g. another tab) writing to chrome.storage
 * and then manually fires onChanged to simulate Chrome's behavior.
 */
export function simulateExternalStorageWrite(items) {
  const changes = {};
  for (const [key, newValue] of Object.entries(items)) {
    changes[key] = { oldValue: mockStorage[key], newValue };
  }
  Object.assign(mockStorage, items);

  // Fire listeners synchronously for test determinism
  for (const listener of onChangedListeners) {
    listener(changes, 'sync');
  }
}
