/**
 * DOM mutation observer for detecting video elements
 * Modular architecture using global variables
 */

window.VSC = window.VSC || {};

class VideoMutationObserver {
  constructor(config, onVideoFound, onVideoRemoved) {
    this.config = config;
    this.onVideoFound = onVideoFound;
    this.onVideoRemoved = onVideoRemoved;
    this.observer = null;
    this.shadowObservers = new Set();
  }

  /**
   * Start observing DOM mutations
   * @param {Document} document - Document to observe
   */
  start(document) {
    this.observer = new MutationObserver((mutations) => {
      // Process DOM nodes with reasonable delay
      requestIdleCallback(
        () => {
          this.processMutations(mutations);
        },
        { timeout: 500 }
      );
    });

    const observerOptions = {
      attributeFilter: ['aria-hidden', 'data-focus-method'],
      childList: true,
      subtree: true,
    };

    this.observer.observe(document, observerOptions);
    window.VSC.logger.debug('Video mutation observer started');
  }

  /**
   * Process mutation events
   * @param {Array<MutationRecord>} mutations - Mutation records
   * @private
   */
  processMutations(mutations) {
    mutations.forEach((mutation) => {
      switch (mutation.type) {
        case 'childList':
          this.processChildListMutation(mutation);
          break;
        case 'attributes':
          this.processAttributeMutation(mutation);
          break;
      }
    });
  }

  /**
   * Process child list mutations (added/removed nodes)
   * @param {MutationRecord} mutation - Mutation record
   * @private
   */
  processChildListMutation(mutation) {
    // Handle added nodes
    mutation.addedNodes.forEach((node) => {
      // Only process element nodes (nodeType 1)
      if (!node || node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      if (node === document.documentElement) {
        // Document was replaced (e.g., watch.sling.com uses document.write)
        window.VSC.logger.debug('Document was replaced, reinitializing');
        this.onDocumentReplaced();
        return;
      }

      this.checkForVideoAndShadowRoot(node, node.parentNode || mutation.target, true);
    });

    // Handle removed nodes
    mutation.removedNodes.forEach((node) => {
      // Only process element nodes (nodeType 1)
      if (!node || node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }
      this.checkForVideoAndShadowRoot(node, node.parentNode || mutation.target, false);
    });
  }

  /**
   * Process attribute mutations
   * @param {MutationRecord} mutation - Mutation record
   * @private
   */
  processAttributeMutation(mutation) {
    // Handle special cases like Apple TV+ player
    if (
      (mutation.target.attributes['aria-hidden'] &&
        mutation.target.attributes['aria-hidden'].value === 'false') ||
      mutation.target.nodeName === 'APPLE-TV-PLUS-PLAYER'
    ) {
      const flattenedNodes = window.VSC.DomUtils.getShadow(document.body);
      const videoNodes = flattenedNodes.filter((x) => x.tagName === 'VIDEO');

      for (const node of videoNodes) {
        // Only add vsc the first time for the apple-tv case
        if (node.vsc && mutation.target.nodeName === 'APPLE-TV-PLUS-PLAYER') {
          continue;
        }

        if (node.vsc) {
          node.vsc.remove();
        }

        this.checkForVideoAndShadowRoot(node, node.parentNode || mutation.target, true);
      }
    }
  }

  /**
   * Check if node is or contains video elements
   * @param {Node} node - Node to check
   * @param {Node} parent - Parent node
   * @param {boolean} added - True if node was added, false if removed
   * @private
   */
  checkForVideoAndShadowRoot(node, parent, added) {
    // Only proceed with removal if node is missing from DOM
    if (!added && document.body?.contains(node)) {
      return;
    }

    if (
      node.nodeName === 'VIDEO' ||
      (node.nodeName === 'AUDIO' && this.config.settings.audioBoolean)
    ) {
      if (added) {
        this.onVideoFound(node, parent);
      } else {
        if (node.vsc) {
          this.onVideoRemoved(node);
        }
      }
    } else {
      this.processNodeChildren(node, parent, added);
    }
  }

  /**
   * Process children of a node recursively
   * @param {Node} node - Node to process
   * @param {Node} parent - Parent node
   * @param {boolean} added - True if node was added
   * @private
   */
  processNodeChildren(node, parent, added) {
    let children = [];

    // Handle shadow DOM
    if (node.shadowRoot) {
      this.observeShadowRoot(node.shadowRoot);
      children = Array.from(node.shadowRoot.children);
    }

    // Handle regular children
    if (node.children) {
      children = [...children, ...node.children];
    }

    // Process all children
    for (const child of children) {
      this.checkForVideoAndShadowRoot(child, child.parentNode || parent, added);
    }
  }

  /**
   * Set up observer for shadow root
   * @param {ShadowRoot} shadowRoot - Shadow root to observe
   * @private
   */
  observeShadowRoot(shadowRoot) {
    if (this.shadowObservers.has(shadowRoot)) {
      return; // Already observing
    }

    const shadowObserver = new MutationObserver((mutations) => {
      requestIdleCallback(
        () => {
          this.processMutations(mutations);
        },
        { timeout: 500 }
      );
    });

    const observerOptions = {
      attributeFilter: ['aria-hidden', 'data-focus-method'],
      childList: true,
      subtree: true,
    };

    shadowObserver.observe(shadowRoot, observerOptions);
    this.shadowObservers.add(shadowRoot);

    window.VSC.logger.debug('Shadow root observer added');
  }

  /**
   * Handle document replacement
   * @private
   */
  onDocumentReplaced() {
    // This callback should trigger reinitialization
    window.VSC.logger.warn('Document replacement detected - full reinitialization needed');
  }

  /**
   * Stop observing and clean up
   */
  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Clean up shadow observers
    this.shadowObservers.forEach((_shadowRoot) => {
      // Note: We can't access the observer directly, but disconnecting the main
      // observer should handle most cases. Shadow observers will be garbage collected.
    });
    this.shadowObservers.clear();

    window.VSC.logger.debug('Video mutation observer stopped');
  }
}

// Create singleton instance
window.VSC.VideoMutationObserver = VideoMutationObserver;
