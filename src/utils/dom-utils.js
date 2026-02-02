/**
 * DOM utility functions for Video Speed Controller
 */

window.VSC = window.VSC || {};
window.VSC.DomUtils = {};

/**
 * Check if we're running in an iframe
 * @returns {boolean} True if in iframe
 */
window.VSC.DomUtils.inIframe = function () {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
};

/**
 * Get all elements in shadow DOMs recursively
 * @param {Element} parent - Parent element to search
 * @param {number} maxDepth - Maximum recursion depth to prevent infinite loops
 * @returns {Array<Element>} Flattened array of all elements
 */
window.VSC.DomUtils.getShadow = function (parent, maxDepth = 10) {
  const result = [];
  const visited = new WeakSet(); // Prevent infinite loops

  function getChild(element, depth = 0) {
    // Prevent infinite recursion and excessive depth
    if (depth > maxDepth || visited.has(element)) {
      return;
    }

    visited.add(element);

    if (element.firstElementChild) {
      let child = element.firstElementChild;
      do {
        result.push(child);
        getChild(child, depth + 1);

        // Only traverse shadow roots if we haven't exceeded depth limit
        if (child.shadowRoot && depth < maxDepth - 2) {
          // Always handle shadow roots synchronously to maintain function contract
          result.push(...window.VSC.DomUtils.getShadow(child.shadowRoot, maxDepth - depth));
        }

        child = child.nextElementSibling;
      } while (child);
    }
  }

  getChild(parent);
  return result.flat(Infinity);
};

/**
 * Find nearest parent of same size as video parent
 * @param {Element} element - Starting element
 * @returns {Element} Parent element
 */
window.VSC.DomUtils.findVideoParent = function (element) {
  let parentElement = element.parentElement;

  while (
    parentElement.parentNode &&
    parentElement.parentNode.offsetHeight === parentElement.offsetHeight &&
    parentElement.parentNode.offsetWidth === parentElement.offsetWidth
  ) {
    parentElement = parentElement.parentNode;
  }

  return parentElement;
};

/**
 * Initialize document when ready
 * @param {Document} document - Document to initialize
 * @param {Function} callback - Callback to run when ready
 */
window.VSC.DomUtils.initializeWhenReady = function (document, callback) {
  window.VSC.logger.debug('Begin initializeWhenReady');

  const handleWindowLoad = () => {
    callback(window.document);
  };

  window.addEventListener('load', handleWindowLoad, { once: true });

  if (document) {
    if (document.readyState === 'complete') {
      callback(document);
    } else {
      const handleReadyStateChange = () => {
        if (document.readyState === 'complete') {
          document.removeEventListener('readystatechange', handleReadyStateChange);
          callback(document);
        }
      };
      document.addEventListener('readystatechange', handleReadyStateChange);
    }
  }

  window.VSC.logger.debug('End initializeWhenReady');
};

/**
 * Check if element or its children are video/audio elements
 * Recursively searches through nested shadow DOM structures
 * @param {Element} node - Node to check
 * @param {boolean} audioEnabled - Whether to check for audio elements
 * @returns {Array<Element>} Array of media elements found
 */
window.VSC.DomUtils.findMediaElements = function (node, audioEnabled = false) {
  if (!node) {
    return [];
  }

  const mediaElements = [];
  const selector = audioEnabled ? 'video,audio' : 'video';

  // Check the node itself
  if (node && node.matches && node.matches(selector)) {
    mediaElements.push(node);
  }

  // Check children
  if (node.querySelectorAll) {
    mediaElements.push(...Array.from(node.querySelectorAll(selector)));
  }

  // Recursively check shadow roots
  if (node.shadowRoot) {
    mediaElements.push(...window.VSC.DomUtils.findShadowMedia(node.shadowRoot, selector));
  }

  return mediaElements;
};

/**
 * Recursively find media elements in shadow DOM trees
 * @param {ShadowRoot|Document|Element} root - Root to search from
 * @param {string} selector - CSS selector for media elements
 * @returns {Array<Element>} Array of media elements found
 */
window.VSC.DomUtils.findShadowMedia = function (root, selector) {
  const results = [];

  // If root is an element with shadowRoot, search in its shadow first
  if (root.shadowRoot) {
    results.push(...window.VSC.DomUtils.findShadowMedia(root.shadowRoot, selector));
  }

  // Add any matching elements in current root (if it's a shadowRoot/document)
  if (root.querySelectorAll) {
    results.push(...Array.from(root.querySelectorAll(selector)));
  }

  // Recursively check all elements with shadow roots
  if (root.querySelectorAll) {
    const allElements = Array.from(root.querySelectorAll('*'));
    allElements.forEach((element) => {
      if (element.shadowRoot) {
        results.push(...window.VSC.DomUtils.findShadowMedia(element.shadowRoot, selector));
      }
    });
  }

  return results;
};

// Global variables available for both browser and testing
