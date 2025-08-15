/**
 * Page context entry point - bundles all VSC modules for injection
 * This runs in the page context with access to page APIs but not chrome.* APIs
 * All modules are loaded in dependency order to ensure proper initialization
 */

// Core utilities and constants - must load first
import '../utils/constants.js';
import '../utils/logger.js';
import '../utils/debug-helper.js';
import '../utils/dom-utils.js';
import '../utils/event-manager.js';

// Storage and settings - depends on utils
import '../core/storage-manager.js';
import '../core/settings.js';

// State management - depends on utils and logger
import '../core/state-manager.js';

// Observers - depends on utils and settings
import '../observers/media-observer.js';
import '../observers/mutation-observer.js';

// Core functionality - depends on settings and observers
import '../core/action-handler.js';
import '../core/video-controller.js';

// UI components - depends on core functionality
import '../ui/controls.js';
import '../ui/drag-handler.js';
import '../ui/shadow-dom.js';
import '../ui/vsc-controller-element.js';

// Site-specific handlers - depends on core
import '../site-handlers/base-handler.js';
import '../site-handlers/netflix-handler.js';
import '../site-handlers/youtube-handler.js';
import '../site-handlers/facebook-handler.js';
import '../site-handlers/amazon-handler.js';
import '../site-handlers/apple-handler.js';
import '../site-handlers/index.js';

// Netflix-specific script
import '../site-handlers/scripts/netflix.js';

// Main initialization - must be last
import '../content/inject.js';

// The modules above populate window.VSC namespace and window.VSC_controller
// No additional exports needed here - side effects handle initialization
