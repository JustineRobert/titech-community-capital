// utils/resilience.js
// ============================================================================
// Resilience Patterns
// Retry logic, circuit breakers, timeouts, bulkheads, and idempotency
// Production-grade fault tolerance
// ============================================================================

const logger = require('./logger');
const crypto = require('crypto');

/**
 * Exponential backoff retry strategy
 * Implements: retry with exponential backoff + jitter
 * Handles: transient failures, network issues, temporary service unavailability
 */
class RetryPolicy {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.initialDelayMs = options.initialDelayMs || 100;
    this.maxDelayMs = options.maxDelayMs || 5000;
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.jitterFactor = options.jitterFactor || 0.1; // 10% jitter
    this.retryableErrors = options.retryableErrors || ['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH'];
    this.maxHttpStatus = options.maxHttpStatus || 500; // Retry on 5xx errors
  }

  /**
   * Check if error is retryable
   */
  isRetryable(error, attempt) {
    if (attempt >= this.maxRetries) return false;

    // Check error code
    if (error.code && this.retryableErrors.includes(error.code)) {
      return true;
    }

    // Check HTTP status (retry on 5xx, 408, 429)
    if (error.response && error.response.status) {
      const status = error.response.status;
      if (status >= 500 || status === 408 || status === 429) {
        return true;
      }
    }

    // Check for network-related errors
    if (error.message && /network|timeout|ECONNREFUSED|ETIMEDOUT/i.test(error.message)) {
      return true;
    }

    return false;
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  getDelay(attempt) {
    const exponentialDelay = this.initialDelayMs * Math.pow(this.backoffMultiplier, attempt);
    const cappedDelay = Math.min(exponentialDelay, this.maxDelayMs);
    const jitter = cappedDelay * this.jitterFactor * Math.random();
    return Math.floor(cappedDelay + jitter);
  }

  /**
   * Execute function with retry logic
   */
  async execute(fn, context = '') {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (!this.isRetryable(error, attempt)) {
          throw error;
        }

        if (attempt < this.maxRetries) {
          const delay = this.getDelay(attempt);
          logger.warn(
            `[RetryPolicy] ${context} - Attempt ${attempt + 1}/${this.maxRetries + 1} failed, retrying in ${delay}ms`,
            {
              error: error.message,
              code: error.code,
            }
          );

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }
}

/**
 * Circuit Breaker pattern
 * Prevents cascading failures by failing fast when service is unavailable
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'CircuitBreaker';
    this.failureThreshold = options.failureThreshold || 5; // failures before trip
    this.successThreshold = options.successThreshold || 2; // successes to close
    this.timeoutMs = options.timeoutMs || 60000; // time to half-open
    this.onStateChange = options.onStateChange || (() => {});

    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }

  /**
   * Check if breaker allows request
   */
  canExecute() {
    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'OPEN') {
      if (Date.now() >= this.nextAttemptTime) {
        this.setState('HALF_OPEN');
        return true;
      }
      return false;
    }

    // HALF_OPEN: allow request
    return true;
  }

  /**
   * Record success
   */
  recordSuccess() {
    this.failureCount = 0;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.setState('CLOSED');
      }
    }
  }

  /**
   * Record failure
   */
  recordFailure() {
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.setState('OPEN');
      return;
    }

    this.failureCount++;
    if (this.failureCount >= this.failureThreshold && this.state === 'CLOSED') {
      this.setState('OPEN');
    }
  }

  /**
   * Change state and emit event
   */
  setState(newState) {
    if (newState === this.state) return;

    const oldState = this.state;
    this.state = newState;
    this.successCount = 0;

    if (newState === 'OPEN') {
      this.nextAttemptTime = Date.now() + this.timeoutMs;
    }

    logger.info(`[CircuitBreaker] ${this.name} state changed: ${oldState} -> ${newState}`);
    this.onStateChange({ name: this.name, oldState, newState });
  }

  /**
   * Execute with circuit breaker protection
   */
  async execute(fn) {
    if (!this.canExecute()) {
      throw new Error(`[CircuitBreaker] ${this.name} is OPEN`);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Get breaker status
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }
}

/**
 * Idempotency Helper
 * Ensures operations are safe to retry without side effects
 */
class IdempotencyKey {
  constructor(options = {}) {
    this.storage = options.storage || new Map(); // In-memory, override with Redis
    this.ttlMs = options.ttlMs || 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Generate idempotency key from request
   */
  static fromRequest(req) {
    // Priority: custom header > from request body
    let key = req.get('Idempotency-Key') || req.get('X-Idempotency-Key');

    if (!key && req.body) {
      // Generate from request method, path, and body hash
      const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
      key = `${req.method}:${req.path}:${bodyHash}`;
    }

    return key;
  }

  /**
   * Ensure idempotent execution
   */
  async execute(key, fn, options = {}) {
    const cached = this.storage.get(key);

    if (cached && !this.isExpired(cached)) {
      logger.debug(`[Idempotency] Cache hit for key: ${key}`);
      return cached.result;
    }

    try {
      const result = await fn();

      // Cache result
      this.storage.set(key, {
        result,
        timestamp: Date.now(),
        status: 'success',
      });

      // Set expiration in storage (override for Redis, etc.)
      if (options.onCache) {
        options.onCache(key, result);
      }

      return result;
    } catch (error) {
      // Cache error too (to prevent retry storms)
      this.storage.set(key, {
        error: error.message,
        timestamp: Date.now(),
        status: 'error',
      });

      throw error;
    }
  }

  /**
   * Check if cached entry has expired
   */
  isExpired(entry) {
    return Date.now() - entry.timestamp > this.ttlMs;
  }

  /**
   * Clear specific key or all keys
   */
  clear(key = null) {
    if (key) {
      this.storage.delete(key);
    } else {
      this.storage.clear();
    }
  }

  /**
   * Get entry without executing
   */
  get(key) {
    const entry = this.storage.get(key);
    if (entry && !this.isExpired(entry)) {
      return entry;
    }
    return null;
  }
}

/**
 * Timeout helper
 * Prevent hanging requests
 */
async function withTimeout(promise, timeoutMs) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Bulkhead pattern (semaphore)
 * Limit concurrent requests to prevent resource exhaustion
 */
class Bulkhead {
  constructor(maxConcurrent = 10, name = 'Bulkhead') {
    this.maxConcurrent = maxConcurrent;
    this.name = name;
    this.active = 0;
    this.queue = [];
  }

  /**
   * Execute with concurrency limit
   */
  async execute(fn) {
    while (this.active >= this.maxConcurrent) {
      await new Promise((resolve) => this.queue.push(resolve));
    }

    this.active++;

    try {
      return await fn();
    } finally {
      this.active--;
      const resolve = this.queue.shift();
      if (resolve) resolve();
    }
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      name: this.name,
      active: this.active,
      maxConcurrent: this.maxConcurrent,
      queued: this.queue.length,
    };
  }
}

/**
 * Combine multiple resilience patterns
 */
class ResilientClient {
  constructor(options = {}) {
    this.name = options.name || 'ResilientClient';
    this.retryPolicy = new RetryPolicy(options.retry);
    this.circuitBreaker = new CircuitBreaker(options.circuitBreaker);
    this.idempotencyKey = new IdempotencyKey(options.idempotency);
    this.bulkhead = new Bulkhead(options.maxConcurrent || 10, this.name);
    this.timeoutMs = options.timeoutMs || 30000;
  }

  /**
   * Execute with all resilience patterns
   */
  async execute(fn, options = {}) {
    const idempotencyKey = options.idempotencyKey;

    const executeWithCircuitBreaker = async () => {
      return this.circuitBreaker.execute(async () => {
        return this.retryPolicy.execute(async () => {
          return withTimeout(fn(), this.timeoutMs);
        }, this.name);
      });
    };

    const executeWithBulkhead = async () => {
      return this.bulkhead.execute(executeWithCircuitBreaker);
    };

    if (idempotencyKey) {
      return this.idempotencyKey.execute(idempotencyKey, executeWithBulkhead, options);
    }

    return executeWithBulkhead();
  }

  /**
   * Get overall status
   */
  getStatus() {
    return {
      name: this.name,
      circuitBreaker: this.circuitBreaker.getStatus(),
      bulkhead: this.bulkhead.getStatus(),
    };
  }
}

module.exports = {
  RetryPolicy,
  CircuitBreaker,
  IdempotencyKey,
  Bulkhead,
  ResilientClient,
  withTimeout,
};
