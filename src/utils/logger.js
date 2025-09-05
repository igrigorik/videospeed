/**
 * Logging utility for Video Speed Controller
 */

window.VSC = window.VSC || {};

if (!window.VSC.logger) {
  class Logger {
    constructor() {
      this.verbosity = 3; // Default warning level
      this.defaultLevel = 4; // Default info level
      this.contextStack = []; // Stack for nested contexts
    }

    /**
     * Set logging verbosity level
     * @param {number} level - Log level from LOG_LEVELS constants
     */
    setVerbosity(level) {
      this.verbosity = level;
    }

    /**
     * Set default logging level
     * @param {number} level - Default level from LOG_LEVELS constants
     */
    setDefaultLevel(level) {
      this.defaultLevel = level;
    }

    /**
     * Generate video/controller context string from context stack
     * @returns {string} Context string like "[V1]" or ""
     * @private
     */
    generateContext() {
      if (this.contextStack.length > 0) {
        return `[${this.contextStack[this.contextStack.length - 1]}] `;
      }
      return '';
    }

    /**
     * Format video element identifier using controller ID
     * @param {HTMLMediaElement} video - Video element
     * @returns {string} Formatted ID like "V1" or "A1"
     * @private
     */
    formatVideoId(video) {
      if (!video) return 'V?';
      
      const isAudio = video.tagName === 'AUDIO';
      const prefix = isAudio ? 'A' : 'V';
      
      // Use controller ID if available (this is what we want!)
      if (video.vsc?.controllerId) {
        return `${prefix}${video.vsc.controllerId}`;
      }
      
      // Fallback for videos without controllers
      return `${prefix}?`;
    }

    /**
     * Push context onto stack (for nested operations)
     * @param {string|HTMLMediaElement} context - Context string or video element
     */
    pushContext(context) {
      if (typeof context === 'string') {
        this.contextStack.push(context);
      } else if (context && (context.tagName === 'VIDEO' || context.tagName === 'AUDIO')) {
        this.contextStack.push(this.formatVideoId(context));
      }
    }

    /**
     * Pop context from stack
     */
    popContext() {
      this.contextStack.pop();
    }

    /**
     * Execute function with context
     * @param {string|HTMLMediaElement} context - Context string or video element
     * @param {Function} fn - Function to execute
     * @returns {*} Function result
     */
    withContext(context, fn) {
      this.pushContext(context);
      try {
        return fn();
      } finally {
        this.popContext();
      }
    }

    /**
     * Log a message with specified level
     * @param {string} message - Message to log
     * @param {number} level - Log level (optional, uses default if not specified)
     */
    log(message, level) {
      const logLevel = typeof level === 'undefined' ? this.defaultLevel : level;
      const LOG_LEVELS = window.VSC.Constants.LOG_LEVELS;

      if (this.verbosity >= logLevel) {
        const context = this.generateContext();
        const contextualMessage = `${context}${message}`;
        
        switch (logLevel) {
          case LOG_LEVELS.ERROR:
            console.log(`ERROR:${contextualMessage}`);
            break;
          case LOG_LEVELS.WARNING:
            console.log(`WARNING:${contextualMessage}`);
            break;
          case LOG_LEVELS.INFO:
            console.log(`INFO:${contextualMessage}`);
            break;
          case LOG_LEVELS.DEBUG:
            console.log(`DEBUG:${contextualMessage}`);
            break;
          case LOG_LEVELS.VERBOSE:
            console.log(`DEBUG (VERBOSE):${contextualMessage}`);
            console.trace();
            break;
          default:
            console.log(contextualMessage);
        }
      }
    }

    /**
     * Log error message
     * @param {string} message - Error message
     */
    error(message) {
      this.log(message, window.VSC.Constants.LOG_LEVELS.ERROR);
    }

    /**
     * Log warning message
     * @param {string} message - Warning message
     */
    warn(message) {
      this.log(message, window.VSC.Constants.LOG_LEVELS.WARNING);
    }

    /**
     * Log info message
     * @param {string} message - Info message
     */
    info(message) {
      this.log(message, window.VSC.Constants.LOG_LEVELS.INFO);
    }

    /**
     * Log debug message
     * @param {string} message - Debug message
     */
    debug(message) {
      this.log(message, window.VSC.Constants.LOG_LEVELS.DEBUG);
    }

    /**
     * Log verbose debug message with stack trace
     * @param {string} message - Verbose debug message
     */
    verbose(message) {
      this.log(message, window.VSC.Constants.LOG_LEVELS.VERBOSE);
    }
  }

  // Create singleton instance
  window.VSC.logger = new Logger();
}
