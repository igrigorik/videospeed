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

export const chromeMock = {
  storage: {
    sync: {
      get: (keys, callback) => {
        // Simulate async behavior
        setTimeout(() => {
          const result =
            typeof keys === 'object' && keys !== null
              ? Object.keys(keys).reduce((acc, key) => {
                  acc[key] = mockStorage[key] || keys[key];
                  return acc;
                }, {})
              : { ...mockStorage };
          callback(result);
        }, 10);
      },
      set: (items, callback) => {
        Object.assign(mockStorage, items);
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
      addListener: (_callback) => {
        // Mock storage change listener
      },
    },
  },
  runtime: {
    getURL: (path) => `chrome-extension://test-extension/${path}`,
    id: 'test-extension-id',
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
}
