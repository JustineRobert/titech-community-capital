// utils/circuitBreaker.js
'use strict';

const CircuitBreaker = require('opossum');
const logger = require('./logger'); // your structured logger (adjust path as needed)
const { httpErrorsTotal } = require('./metrics'); // optional Prometheus metric

// Default options with environment overrides
const DEFAULT_OPTIONS = {
  timeout: parseInt(process.env.CB_TIMEOUT_MS || '5000', 10), // ms
  errorThresholdPercentage: parseInt(process.env.CB_ERROR_THRESHOLD || '50', 10),
  resetTimeout: parseInt(process.env.CB_RESET_TIMEOUT_MS || '30000', 10), // ms
  rollingCountTimeout: parseInt(process.env.CB_ROLLING_COUNT_TIMEOUT_MS || '10000', 10),
  rollingCountBuckets: parseInt(process.env.CB_ROLLING_COUNT_BUCKETS || '10', 10),
};

/**
 * Create a circuit breaker for the provided function.
 *
 * @param {Function} fn - The function to protect. Can be async and should return a Promise.
 * @param {Object} [opts] - Optional opossum options to override defaults.
 * @param {Function} [fallback] - Optional fallback function invoked when breaker is open or call fails.
 * @returns {{ fire: Function, breaker: CircuitBreaker }} - fire executes the protected function; breaker is the opossum instance.
 */
module.exports = (fn, opts = {}, fallback = null) => {
  if (typeof fn !== 'function') {
    throw new TypeError('First argument to circuitBreaker must be a function');
  }

  const options = { ...DEFAULT_OPTIONS, ...opts };
  const breaker = new CircuitBreaker(fn, options);

  // Attach fallback if provided
  if (typeof fallback === 'function') {
    breaker.fallback(fallback);
  }

  // Event listeners for observability
  breaker.on('open', () => {
    logger.warn('Circuit breaker opened', { name: fn.name || 'anonymous', options });
  });

  breaker.on('halfOpen', () => {
    logger.info('Circuit breaker half-open', { name: fn.name || 'anonymous' });
  });

  breaker.on('close', () => {
    logger.info('Circuit breaker closed', { name: fn.name || 'anonymous' });
  });

  breaker.on('reject', () => {
    logger.warn('Circuit breaker rejected execution (open)', { name: fn.name || 'anonymous' });
    if (httpErrorsTotal) httpErrorsTotal.inc({ method: 'CB', route: fn.name || 'anonymous', status: 'rejected' });
  });

  breaker.on('timeout', (result) => {
    logger.warn('Circuit breaker timeout', { name: fn.name || 'anonymous', result });
    if (httpErrorsTotal) httpErrorsTotal.inc({ method: 'CB', route: fn.name || 'anonymous', status: 'timeout' });
  });

  breaker.on('failure', (err) => {
    logger.error('Circuit breaker failure', { name: fn.name || 'anonymous', error: err?.message });
    if (httpErrorsTotal) httpErrorsTotal.inc({ method: 'CB', route: fn.name || 'anonymous', status: 'failure' });
  });

  breaker.on('success', (result) => {
    logger.debug('Circuit breaker success', { name: fn.name || 'anonymous' });
  });

  /**
   * Fire the protected function through the breaker.
   * Accepts the same arguments as the original function.
   */
  const fire = async (...args) => {
    try {
      return await breaker.fire(...args);
    } catch (err) {
      // Let caller handle errors; fallback will run if configured
      throw err;
    }
  };

  return { fire, breaker };
};
