/**
 * Unified Video Speed Controller State Manager
 * 
 * Handles both media element tracking and background script communication.
 * Provides a single source of truth for all media elements in the page,
 * including those in shadow DOM, and maintains resilient sync with the
 * background script for toolbar icon updates.
 * 
 * Key responsibilities:
 * - Track all media elements with VSC controllers
 * - Communicate controller state to background script for icon updates
 * - Provide fast access to media elements for popup and keyboard commands
 * - Handle cleanup of disconnected elements
 * - Maintain resilient sync with periodic fallback
 */

window.VSC = window.VSC || {};

class VSCStateManager {
  constructor() {
    // Map of controllerId → controller metadata
    this.controllers = new Map();

    // Communication state
    this.syncTimer = null;
    this.lastNotification = 0;
    this.SYNC_INTERVAL = 3000; // Fallback sync every 3 seconds
    this.THROTTLE_MS = 100; // Max one notification per 100ms

    // Setup communication bridge
    this.setupCommunication();

    window.VSC.logger?.debug('VSCStateManager initialized');
  }

  /**
   * Register a new controller with the state manager
   * @param {VideoController} controller - Controller instance to register
   */
  registerController(controller) {
    if (!controller || !controller.controllerId || !controller.video) {
      window.VSC.logger?.error('Invalid controller registration attempt');
      return;
    }

    const controllerInfo = {
      id: controller.controllerId,
      element: controller.video,
      videoSrc: controller.video.currentSrc || controller.video.src || 'unknown',
      tagName: controller.video.tagName,
      created: Date.now(),
      isActive: true
    };

    this.controllers.set(controller.controllerId, controllerInfo);

    window.VSC.logger?.debug(
      `Registered controller ${controller.controllerId} for ${controllerInfo.tagName} (total: ${this.controllers.size})`
    );

    // Immediate notification to background script
    this.notifyBackground();

    // Start periodic sync if this is the first controller
    if (this.controllers.size === 1) {
      this.startPeriodicSync();
    }
  }

  /**
   * Remove a controller from the state manager
   * @param {string} controllerId - ID of controller to remove
   */
  removeController(controllerId) {
    if (!controllerId) return;

    const removed = this.controllers.delete(controllerId);

    if (removed) {
      window.VSC.logger?.debug(
        `Removed controller ${controllerId} (remaining: ${this.controllers.size})`
      );

      // Immediate notification to background script
      this.notifyBackground();

      // Stop periodic sync if no controllers left
      if (this.controllers.size === 0) {
        this.stopPeriodicSync();
      }
    }
  }

  /**
   * Get all tracked media elements, with automatic cleanup of stale references
   * This replaces document.querySelectorAll('video, audio') throughout the codebase
   * @returns {HTMLMediaElement[]} Array of active media elements
   */
  getAllMediaElements() {
    const activeElements = [];
    const staleControllers = [];

    // Check each tracked controller
    for (const [id, info] of this.controllers) {
      if (info.element && info.element.isConnected) {
        activeElements.push(info.element);
      } else {
        // Mark for cleanup
        staleControllers.push(id);
      }
    }

    // Clean up stale references
    if (staleControllers.length > 0) {
      staleControllers.forEach(id => this.controllers.delete(id));
      window.VSC.logger?.debug(`Cleaned up ${staleControllers.length} stale controller references`);

      // Notify if state changed
      this.notifyBackground();
    }

    return activeElements;
  }

  /**
   * Get only media elements that have active VSC controllers
   * @returns {HTMLMediaElement[]} Array of controlled media elements
   */
  getControlledElements() {
    return this.getAllMediaElements().filter(element => element.vsc);
  }

  /**
   * Get current state summary
   * @returns {Object} Current state information
   */
  getState() {
    return {
      controllerCount: this.controllers.size,
      hasActiveControllers: this.controllers.size > 0,
      controllers: Array.from(this.controllers.values()).map(info => ({
        id: info.id,
        tagName: info.tagName,
        videoSrc: info.videoSrc,
        created: info.created
      }))
    };
  }

  /**
   * Notify background script of current state
   * Uses throttling to prevent excessive messages
   * @private
   */
  notifyBackground() {
    const now = Date.now();

    // Throttle notifications to prevent spam
    if (now - this.lastNotification < this.THROTTLE_MS) {
      return;
    }
    this.lastNotification = now;

    const state = this.getState();

    // Send unified state update via existing bridge mechanism
    window.postMessage({
      source: 'vsc-page',
      action: 'runtime-message',
      data: {
        type: 'VSC_STATE_UPDATE',
        hasActiveControllers: state.hasActiveControllers,
        controllerCount: state.controllerCount,
        timestamp: now
      }
    }, '*');

    window.VSC.logger?.debug(
      `Background notified: ${state.hasActiveControllers ? 'active' : 'inactive'} (${state.controllerCount} controllers)`
    );
  }

  /**
   * Start periodic sync as fallback mechanism
   * Ensures state stays in sync even if events are missed
   * @private
   */
  startPeriodicSync() {
    if (this.syncTimer) return;

    window.VSC.logger?.debug('Starting periodic state sync');

    this.syncTimer = setInterval(() => {
      // Trigger cleanup and notification
      this.getAllMediaElements(); // This triggers automatic cleanup
      this.notifyBackground();
    }, this.SYNC_INTERVAL);
  }

  /**
   * Stop periodic sync
   * @private
   */
  stopPeriodicSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      window.VSC.logger?.debug('Stopped periodic state sync');
    }
  }

  /**
   * Setup communication with content script bridge
   * @private
   */
  setupCommunication() {
    // Listen for state queries from popup/background
    window.addEventListener('VSC_MESSAGE', (event) => {
      const message = event.detail;

      if (message && message.type === 'VSC_QUERY_STATE') {
        window.VSC.logger?.debug('Received state query, responding with current state');
        this.notifyBackground();
      }
    });

    // Handle page unload
    window.addEventListener('beforeunload', () => {
      this.destroy();
    });
  }

  /**
   * Clean up state manager resources
   */
  destroy() {
    window.VSC.logger?.debug('VSCStateManager destroying');

    this.stopPeriodicSync();
    this.controllers.clear();

    // Final notification that we have no controllers
    this.notifyBackground();
  }

  /**
   * Debug helper - get detailed state information
   * @returns {Object} Detailed state for debugging
   */
  _getDebugInfo() {
    return {
      controllerCount: this.controllers.size,
      controllers: Array.from(this.controllers.entries()).map(([id, info]) => ({
        id,
        tagName: info.tagName,
        videoSrc: info.videoSrc,
        isConnected: info.element ? info.element.isConnected : false,
        hasVSC: info.element ? !!info.element.vsc : false,
        created: new Date(info.created).toISOString()
      })),
      syncActive: !!this.syncTimer,
      lastNotification: new Date(this.lastNotification).toISOString()
    };
  }
}

// Create singleton instance and expose globally
window.VSC.StateManager = VSCStateManager;

// Initialize as soon as the module loads
window.VSC.stateManager = new VSCStateManager();

window.VSC.logger?.info('State Manager module loaded');
