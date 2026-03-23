/**
 * Content script injection helpers for bundled architecture
 * Handles script injection and message bridging between contexts
 */

/**
 * Inject a bundled script file into the page context
 * @param {string} scriptPath - Path to the bundled script file
 * @returns {Promise<void>}
 */
export async function injectScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(scriptPath);
    script.onload = () => {
      script.remove();
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`Failed to load script: ${scriptPath}`));
    };
    (document.head || document.documentElement).appendChild(script);
  });
}

/**
 * Set up message bridge between content script and page context.
 * Handles bi-directional communication for popup and settings updates.
 * @returns {{ sendCommand: (type: string, payload?: any) => void, cleanup: () => void }}
 */
export function setupMessageBridge() {
  // Named function so we can remove it on context invalidation
  function handlePageMessage(event) {
    if (event.source !== window || !event.data?.source?.startsWith('vsc-')) {
      return;
    }

    const { source, action, data } = event.data;

    if (source === 'vsc-page') {
      try {
        if (action === 'storage-update') {
          chrome.storage.sync.set(data);
        } else if (action === 'runtime-message') {
          if (data.type !== 'VSC_STATE_UPDATE') {
            chrome.runtime.sendMessage(data);
          }
        } else if (action === 'get-storage') {
          chrome.storage.sync.get(null, (items) => {
            window.postMessage({
              source: 'vsc-content',
              action: 'storage-data',
              data: items
            }, '*');
          });
        }
      } catch (e) {
        if (e.message?.includes('Extension context invalidated')) {
          window.removeEventListener('message', handlePageMessage);
        } else {
          console.warn('[VSC] Bridge error:', e.message);
        }
      }
    }
  }
  window.addEventListener('message', handlePageMessage);

  // Listen for messages from popup/background
  function handleRuntimeMessage(request, sender, sendResponse) {
    window.dispatchEvent(
      new CustomEvent('VSC_MESSAGE', {
        detail: request
      })
    );

    if (request.action === 'get-status') {
      const responseHandler = (event) => {
        if (event.data?.source === 'vsc-page' && event.data?.action === 'status-response') {
          window.removeEventListener('message', responseHandler);
          sendResponse(event.data.data);
        }
      };
      window.addEventListener('message', responseHandler);
      return true;
    }
  }
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);

  // Listen for storage changes from other extension contexts
  function handleStorageChanged(changes, namespace) {
    if (namespace === 'sync') {
      const changedData = {};
      for (const [key, { newValue }] of Object.entries(changes)) {
        changedData[key] = newValue;
      }
      window.postMessage({
        source: 'vsc-content',
        action: 'storage-changed',
        data: changedData
      }, '*');
    }
  }
  chrome.storage.onChanged.addListener(handleStorageChanged);

  return {
    /** Send a command to the page context via the same channel popup messages use. */
    sendCommand(type, payload) {
      window.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: { type, payload } }));
    },

    /** Remove all listeners (tests, extension unload). */
    cleanup() {
      window.removeEventListener('message', handlePageMessage);
      chrome.runtime.onMessage.removeListener?.(handleRuntimeMessage);
      chrome.storage.onChanged.removeListener?.(handleStorageChanged);
    },
  };
}
