/**
 * Logging utility for Video Speed Controller
 */

window.VSC = window.VSC || {};

if (!window.VSC.logger) {
  class Logger {
    constructor() {
      this.verbosity = 3; // Default warning level
      this.defaultLevel = 4; // Default info level
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
     * Log a message with specified level
     * @param {string} message - Message to log
     * @param {number} level - Log level (optional, uses default if not specified)
     */
    log(message, level) {
      const logLevel = typeof level === 'undefined' ? this.defaultLevel : level;
      const LOG_LEVELS = window.VSC.Constants.LOG_LEVELS;

      if (this.verbosity >= logLevel) {
        switch (logLevel) {
          case LOG_LEVELS.ERROR:
            console.log(`ERROR:${message}`);
            break;
          case LOG_LEVELS.WARNING:
            console.log(`WARNING:${message}`);
            break;
          case LOG_LEVELS.INFO:
            console.log(`INFO:${message}`);
            break;
          case LOG_LEVELS.DEBUG:
            console.log(`DEBUG:${message}`);
            break;
          case LOG_LEVELS.VERBOSE:
            console.log(`DEBUG (VERBOSE):${message}`);
            console.trace();
            break;
          default:
            console.log(message);
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
