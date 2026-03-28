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
 * Speed limits for page→content bridge validation.
 * Duplicated from constants.js because the content script (isolated world)
 * cannot import page-context modules.
 */
const SPEED_MIN = 0.07;
const SPEED_MAX = 16;

/**
 * Set up message bridge between content script and page context.
 *
 * Page → Content accepts only `set-speed` (validated, clamped number).
 * Content → Page provides storage-changed broadcasts and VSC_MESSAGE commands.
 * All persistent settings writes go through trusted extension contexts.
 *
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
        if (action === 'set-speed') {
          // Validate and clamp to supported range.
          if (typeof data?.speed !== 'number' || !Number.isFinite(data.speed)) {
            console.warn('[VSC] Bridge: rejected set-speed — invalid speed value');
            return;
          }
          const clamped = Math.min(Math.max(data.speed, SPEED_MIN), SPEED_MAX);
          chrome.storage.sync.set({ lastSpeed: clamped });
        } else {
          console.warn(`[VSC] Bridge: unrecognized page action "${action}"`);
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
