/**
 * DOM utility functions for Video Speed Controller
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};
window.VSC.DomUtils = {};

/**
 * Escape string for use in regular expressions
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
window.VSC.DomUtils.escapeStringRegExp = function (str) {
  const matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;
  return str.replace(matchOperatorsRe, '\\$&');
};

/**
 * Check if current page is blacklisted
 * @param {string} blacklist - Blacklist string from settings
 * @returns {boolean} True if page is blacklisted
 */
window.VSC.DomUtils.isBlacklisted = function (blacklist) {
  let blacklisted = false;

  blacklist.split('\n').forEach((match) => {
    match = match.replace(window.VSC.Constants.regStrip, '');
    if (match.length === 0) {
      return;
    }

    let regexp;
    if (match.startsWith('/')) {
      try {
        const parts = match.split('/');

        if (window.VSC.Constants.regEndsWithFlags.test(match)) {
          const flags = parts.pop();
          const regex = parts.slice(1).join('/');
          regexp = new RegExp(regex, flags);
        } else {
          const flags = '';
          const regex = match;
          regexp = new RegExp(regex, flags);
        }
      } catch (err) {
        return;
      }
    } else {
      regexp = new RegExp(window.VSC.DomUtils.escapeStringRegExp(match));
    }

    if (regexp.test(location.href)) {
      blacklisted = true;
    }
  });

  return blacklisted;
};

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
 * @returns {Array<Element>} Flattened array of all elements
 */
window.VSC.DomUtils.getShadow = function (parent) {
  const result = [];

  function getChild(parent) {
    if (parent.firstElementChild) {
      let child = parent.firstElementChild;
      do {
        result.push(child);
        getChild(child);
        if (child.shadowRoot) {
          result.push(window.VSC.DomUtils.getShadow(child.shadowRoot));
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

  window.onload = () => {
    callback(window.document);
  };

  if (document) {
    if (document.readyState === 'complete') {
      callback(document);
    } else {
      document.onreadystatechange = () => {
        if (document.readyState === 'complete') {
          callback(document);
        }
      };
    }
  }

  window.VSC.logger.debug('End initializeWhenReady');
};

/**
 * Check if element or its children are video/audio elements
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

  // Check shadow roots
  if (node.shadowRoot) {
    mediaElements.push(...Array.from(node.shadowRoot.querySelectorAll(selector)));
  }

  return mediaElements;
};

// Global variables available for both browser and testing
