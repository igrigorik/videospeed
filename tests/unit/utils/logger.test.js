/**
 * Unit tests for logger buffering behavior
 * Verifies messages are buffered until setVerbosity() configures the logger
 */

import { SimpleTestRunner, assert } from '../../helpers/test-utils.js';

const LOG_LEVELS = window.VSC.Constants.LOG_LEVELS;

/**
 * Create a fresh Logger instance for testing by resetting the singleton's state
 */
function createLogger() {
  const logger = window.VSC.logger;
  // Reset to pre-configured state
  logger.verbosity = 3;
  logger.defaultLevel = 4;
  logger.contextStack = [];
  logger._buffer = [];
  logger._ready = false;
  return logger;
}

/** Capture console.log calls */
function captureConsole() {
  const calls = [];
  const originalLog = console.log;
  const originalTrace = console.trace;
  console.log = (...args) => calls.push(args.join(' '));
  console.trace = () => {}; // suppress trace noise in tests
  return {
    calls,
    restore: () => {
      console.log = originalLog;
      console.trace = originalTrace;
    }
  };
}

const runner = new SimpleTestRunner();

runner.test('logger buffers messages before setVerbosity is called', () => {
  const logger = createLogger();
  logger.log('early message', LOG_LEVELS.INFO);
  logger.log('another early', LOG_LEVELS.ERROR);

  assert.equal(logger._buffer.length, 2, 'Should have 2 buffered messages');
  assert.equal(logger._ready, false, 'Should not be ready yet');
});

runner.test('setVerbosity flushes buffered messages that pass the filter', () => {
  const logger = createLogger();
  const capture = captureConsole();

  try {
    // Buffer: one INFO (level 4) and one ERROR (level 2)
    logger.log('info msg', LOG_LEVELS.INFO);
    logger.log('error msg', LOG_LEVELS.ERROR);

    assert.equal(capture.calls.length, 0, 'Nothing emitted before setVerbosity');

    // Set verbosity to WARNING (3) — should emit ERROR but not INFO
    logger.setVerbosity(LOG_LEVELS.WARNING);

    assert.equal(logger._ready, true, 'Should be ready after setVerbosity');
    assert.equal(logger._buffer.length, 0, 'Buffer should be drained');
    assert.equal(capture.calls.length, 1, 'Only ERROR should have been emitted');
    assert.true(capture.calls[0].includes('error msg'), 'Emitted message should be the error');
  } finally {
    capture.restore();
  }
});

runner.test('setVerbosity flushes all messages when verbosity is high', () => {
  const logger = createLogger();
  const capture = captureConsole();

  try {
    logger.log('debug msg', LOG_LEVELS.DEBUG);
    logger.log('info msg', LOG_LEVELS.INFO);
    logger.log('error msg', LOG_LEVELS.ERROR);

    logger.setVerbosity(LOG_LEVELS.DEBUG);

    assert.equal(capture.calls.length, 3, 'All 3 messages should be emitted at DEBUG verbosity');
  } finally {
    capture.restore();
  }
});

runner.test('after setVerbosity, messages emit immediately (no buffering)', () => {
  const logger = createLogger();
  const capture = captureConsole();

  try {
    logger.setVerbosity(LOG_LEVELS.INFO);

    logger.log('direct message', LOG_LEVELS.INFO);
    assert.equal(capture.calls.length, 1, 'Message should emit immediately');
    assert.equal(logger._buffer.length, 0, 'Buffer should remain empty');
  } finally {
    capture.restore();
  }
});

runner.test('subsequent setVerbosity calls do not re-flush', () => {
  const logger = createLogger();
  const capture = captureConsole();

  try {
    logger.log('buffered', LOG_LEVELS.ERROR);
    logger.setVerbosity(LOG_LEVELS.WARNING); // first call — flushes

    const countAfterFirst = capture.calls.length;
    logger.setVerbosity(LOG_LEVELS.DEBUG); // second call — should NOT re-flush

    assert.equal(capture.calls.length, countAfterFirst, 'No additional messages from second setVerbosity');
  } finally {
    capture.restore();
  }
});

runner.test('convenience methods (error, warn, info, debug) buffer correctly', () => {
  const logger = createLogger();

  logger.error('e');
  logger.warn('w');
  logger.info('i');
  logger.debug('d');

  assert.equal(logger._buffer.length, 4, 'All 4 convenience methods should buffer');
  assert.equal(logger._buffer[0].level, LOG_LEVELS.ERROR, 'error() uses ERROR level');
  assert.equal(logger._buffer[1].level, LOG_LEVELS.WARNING, 'warn() uses WARNING level');
  assert.equal(logger._buffer[2].level, LOG_LEVELS.INFO, 'info() uses INFO level');
  assert.equal(logger._buffer[3].level, LOG_LEVELS.DEBUG, 'debug() uses DEBUG level');
});

export { runner };
