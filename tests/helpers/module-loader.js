/**
 * Test module loader - loads all common dependencies for unit tests
 * This avoids the need for long import lists in individual test files
 */

/**
 * Load all core modules required for most tests
 * This mimics the global module loading pattern used in the extension
 */
export async function loadCoreModules() {
  // Core utilities (order matters due to dependencies)
  await import('../../src/utils/constants.js');
  await import('../../src/utils/logger.js');
  await import('../../src/utils/dom-utils.js');
  await import('../../src/utils/event-manager.js');

  // Storage and settings
  await import('../../src/core/storage-manager.js');
  await import('../../src/core/settings.js');

  // State management
  await import('../../src/core/state-manager.js');

  // Site handlers
  await import('../../src/site-handlers/base-handler.js');
  await import('../../src/site-handlers/netflix-handler.js');
  await import('../../src/site-handlers/youtube-handler.js');
  await import('../../src/site-handlers/facebook-handler.js');
  await import('../../src/site-handlers/amazon-handler.js');
  await import('../../src/site-handlers/apple-handler.js');
  await import('../../src/site-handlers/index.js');

  // Core controllers
  await import('../../src/core/action-handler.js');
  await import('../../src/core/video-controller.js');

  // UI components
  await import('../../src/ui/controls.js');
  await import('../../src/ui/drag-handler.js');
  await import('../../src/ui/shadow-dom.js');

  // Observers
  await import('../../src/observers/mutation-observer.js');
  await import('../../src/observers/media-observer.js');
}

/**
 * Load injection script modules (includes core modules + inject.js)
 */
export async function loadInjectModules() {
  await loadCoreModules();
  await import('../../src/content/inject.js');
}

/**
 * Load minimal modules for lightweight tests
 */
export async function loadMinimalModules() {
  await import('../../src/utils/constants.js');
  await import('../../src/utils/logger.js');
  await import('../../src/core/storage-manager.js');
  await import('../../src/core/settings.js');
}

/**
 * Load observer modules for observer tests
 */
export async function loadObserverModules() {
  await import('../../src/utils/logger.js');
  await import('../../src/utils/dom-utils.js');
  await import('../../src/observers/mutation-observer.js');
}
