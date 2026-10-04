// ============================================================================
// TITech Community Capital
// Production-ready Redis client
// File: backend/services/redis.js
// ============================================================================
//
// Features
// - Robust ioredis client with exponential backoff + jitter
// - Throttled logging to avoid log spam
// - Graceful degradation to an in-memory fallback store
// - Health helpers: isReady(), getStatus(), waitForReady()
// - Rate-limit store compatible with express-rate-limit (returns Date resetTime)
// - Optional hooks for metrics/alerts
// - Safe shutdown handling
//
// Usage
// const redis = require('./services/redis');
// await redis.waitForReady(30000); // optional startup wait
// if (!redis.isReady()) { /* fallback behavior */ }
// ============================================================================

const EventEmitter = require('events');
let Redis;
try {
  // only require ioredis when not running tests or when a real URI is provided
  Redis = require('ioredis');
} catch (err) {
  Redis = null;
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const REDIS_URI = process.env.REDIS_URI || process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Retry/backoff configuration
const MIN_RECONNECT_DELAY = Number(process.env.REDIS_MIN_RECONNECT_MS) || 1000;
const MAX_RECONNECT_DELAY = Number(process.env.REDIS_MAX_RECONNECT_MS) || 30000;
const BACKOFF_MULTIPLIER = Number(process.env.REDIS_BACKOFF_MULTIPLIER) || 1.5;
const MAX_RETRY_ATTEMPTS = Number(process.env.REDIS_MAX_RETRY_ATTEMPTS) || 10;

// Logging throttle
const ERROR_LOG_THROTTLE_MS = NODE_ENV === 'production' ? 30000 : 5000;

let lastErrorLog = 0;
let reconnectAttempts = 0;
let gracefullyDegraded = false;

// Internal event emitter for external hooks (metrics/alerts)
const events = new EventEmitter();

/**
 * Exponential backoff with jitter
 * @param {number} attemptCount
 * @returns {number} delay in ms
 */
function getBackoffDelay(attemptCount) {
  const exponential = Math.min(
    MIN_RECONNECT_DELAY * Math.pow(BACKOFF_MULTIPLIER, attemptCount),
    MAX_RECONNECT_DELAY
  );
  const jitter = exponential * 0.1 * (Math.random() - 0.5);
  return Math.floor(exponential + jitter);
}

function logErrorThrottled(message, err) {
  const now = Date.now();
  if (now - lastErrorLog > ERROR_LOG_THROTTLE_MS) {
    const details = err ? ` ${err.message || String(err)}` : '';
    console.error(`${new Date().toISOString()} ${message}${details}`);
    lastErrorLog = now;
  }
}

function logInfo(message) {
  if (NODE_ENV !== 'production') {
    console.log(`${new Date().toISOString()} ${message}`);
  } else {
    // In production, only log important state changes
    if (/connected|ready|degraded|closed|error/i.test(message)) {
      console.log(`${new Date().toISOString()} ${message}`);
    }
  }
}

// ============================================================================
// In-memory fallback store (simple, TTL-capable)
// - Provides get/set/del/ttl/exists/flushAll
// - Not a full Redis replacement; intended for graceful degradation only
// ============================================================================
function createMemoryStore() {
  const store = new Map();

  function now() {
    return Date.now();
  }

  function set(key, value, ttlMs = null) {
    const expiresAt = ttlMs ? now() + ttlMs : null;
    store.set(key, { value, expiresAt });
    return Promise.resolve('OK');
  }

  function get(key) {
    const entry = store.get(key);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAt && entry.expiresAt <= now()) {
      store.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  function del(key) {
    const removed = store.delete(key);
    return Promise.resolve(removed ? 1 : 0);
  }

  function ttl(key) {
    const entry = store.get(key);
    if (!entry) return Promise.resolve(-2); // key does not exist
    if (!entry.expiresAt) return Promise.resolve(-1); // no TTL
    const remaining = Math.max(Math.ceil((entry.expiresAt - now()) / 1000), 0);
    return Promise.resolve(remaining);
  }

  function exists(key) {
    const entry = store.get(key);
    if (!entry) return Promise.resolve(0);
    if (entry.expiresAt && entry.expiresAt <= now()) {
      store.delete(key);
      return Promise.resolve(0);
    }
    return Promise.resolve(1);
  }

  function flushAll() {
    store.clear();
    return Promise.resolve('OK');
  }

  return {
    set,
    get,
    del,
    ttl,
    exists,
    flushAll,
    status: 'mock',
    isAvailable: false,
  };
}

// ============================================================================
// Create Redis client with robust options
// ============================================================================
let client;
let memoryFallback = null;

// If running tests, prefer an in-memory stub to avoid opening TCP handles.
if (NODE_ENV === 'test' || String(REDIS_URI).toLowerCase().startsWith('memory')) {
  memoryFallback = createMemoryStore();
  client = memoryFallback;
  gracefullyDegraded = true;
  logInfo('ℹ️ Redis stub (in-memory) active for test environment');
} else {
  try {
    client = new Redis(REDIS_URI, {
    retryStrategy: (times) => {
      if (times > MAX_RETRY_ATTEMPTS) {
        // stop retrying
        logErrorThrottled(
          `❌ Redis connection exhausted after ${MAX_RETRY_ATTEMPTS} attempts; falling back to memory store.`
        );
        gracefullyDegraded = true;
        events.emit('degraded', { reason: 'max_retries' });
        return null;
      }
      const delay = getBackoffDelay(times - 1);
      logInfo(`🔄 Redis reconnection attempt ${times}/${MAX_RETRY_ATTEMPTS}, backing off ${delay}ms`);
      return delay;
    },
    connectTimeout: 10000,
    commandTimeout: 5000,
    enableOfflineQueue: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    autoResubscribe: true,
  });

    logInfo('🔌 Redis client created');
  } catch (err) {
    logErrorThrottled('⚠️ Failed to create Redis client:', err);
    gracefullyDegraded = true;
    memoryFallback = createMemoryStore();
    client = memoryFallback;
  }
}

// ============================================================================
// Attach event handlers (if client is ioredis instance)
if (client && typeof client.on === 'function') {
  client.on('connect', () => {
    reconnectAttempts = 0;
    gracefullyDegraded = false;
    logInfo('✅ Redis connected');
    events.emit('connect');
  });

  client.on('ready', () => {
    logInfo('✅ Redis ready and accepting commands');
    events.emit('ready');
  });

  client.on('error', (err) => {
    logErrorThrottled('❌ Redis error:', err);
    events.emit('error', err);
  });

  client.on('reconnecting', () => {
    reconnectAttempts++;
    logInfo(`🔄 Redis reconnecting (attempt ${reconnectAttempts}/${MAX_RETRY_ATTEMPTS})`);
    events.emit('reconnecting', { attempt: reconnectAttempts });
  });

  client.on('close', () => {
    logInfo('🔌 Redis connection closed');
    events.emit('close');
  });

  client.on('end', () => {
    logInfo('🔌 Redis connection ended');
    events.emit('end');
  });

  client.on('warning', (msg) => {
    logErrorThrottled('⚠️ Redis warning:', msg);
    events.emit('warning', msg);
  });
}

// ============================================================================
// Helper utilities exported for application use
// ============================================================================

/**
 * Check if Redis is available (ready or connected)
 * @returns {boolean}
 */
function isReady() {
  try {
    if (!client) return false;
    // ioredis exposes status: 'connecting'|'connect'|'ready'|'close'|'end'
    const status = client.status || (client.isAvailable === false ? 'mock' : 'unknown');
    return status === 'ready' || status === 'connect' || status === 'connected';
  } catch {
    return false;
  }
}

/**
 * Get client status string
 * @returns {string}
 */
function getStatus() {
  try {
    return client.status || (client.isAvailable === false ? 'mock' : 'unknown');
  } catch {
    return 'unknown';
  }
}

/**
 * Wait for Redis to become ready up to timeoutMs.
 * Resolves true if ready, false if timed out.
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function waitForReady(timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (isReady()) return resolve(true);

    const start = Date.now();
    let resolved = false;

    function cleanup() {
      events.off('ready', onReady);
      events.off('connect', onReady);
      events.off('error', onError);
    }

    function onReady() {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(true);
    }

    function onError(err) {
      // keep waiting but emit metrics
      logErrorThrottled('Redis error while waiting for ready:', err);
      events.emit('wait_error', err);
    }

    events.on('ready', onReady);
    events.on('connect', onReady);
    events.on('error', onError);

    const interval = setInterval(() => {
      if (isReady()) {
        clearInterval(interval);
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(true);
        }
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        if (!resolved) {
          resolved = true;
          cleanup();
          // If not ready, create memory fallback if not already created
          if (!memoryFallback) {
            memoryFallback = createMemoryStore();
            client = memoryFallback;
            gracefullyDegraded = true;
            events.emit('degraded', { reason: 'timeout' });
            logErrorThrottled('❌ Redis not ready within timeout; using memory fallback.');
          }
          resolve(false);
        }
      }
    }, 250);
  });
}

/**
 * Create a rate-limit-redis compatible store object if Redis is available,
 * otherwise return a simple in-memory store compatible with express-rate-limit.
 *
 * Example usage with express-rate-limit:
 * const rateLimit = require('express-rate-limit');
 * const RedisStore = require('rate-limit-redis');
 * const store = redis.createRateLimitStore();
 * const limiter = rateLimit({ store, windowMs: 60000, max: 100 });
 */
function createRateLimitStore() {
  // Lazy require to avoid hard dependency if not used
  try {
    if (isReady() && client && client.constructor && client.constructor.name === 'Redis') {
      // Use rate-limit-redis store
      // eslint-disable-next-line global-require
      const RedisStore = require('rate-limit-redis');
      return new RedisStore({
        client,
        expiry: 60, // seconds default
      });
    }
  } catch (err) {
    logErrorThrottled('⚠️ Failed to create Redis rate-limit store:', err);
  }

  // Fallback: simple in-memory store compatible with express-rate-limit
  // NOTE: This is single-process only and not suitable for multi-instance production.
  const memory = new Map();

  return {
    /**
     * incr(key, cb)
     * cb signature: cb(err, current, resetTime)
     * - current: number of hits
     * - resetTime: Date object when the window resets (or null)
     */
    incr: (key, cb) => {
      try {
        const now = Date.now();
        const windowMs = 60 * 1000; // 1 minute window (match expiry used above)
        const entry = memory.get(key) || { count: 0, expiresAt: now + windowMs };

        // If expired, reset
        if (entry.expiresAt <= now) {
          entry.count = 0;
          entry.expiresAt = now + windowMs;
        }

        entry.count += 1;
        memory.set(key, entry);

        // express-rate-limit expects resetTime as a Date object (or null)
        const resetTime = entry.expiresAt ? new Date(entry.expiresAt) : null;

        // callback: (err, current, resetTime)
        return cb(null, entry.count, resetTime);
      } catch (err) {
        return cb(err);
      }
    },

    /**
     * resetKey(key)
     * Called by express-rate-limit to reset a single key
     */
    resetKey: (key) => {
      memory.delete(key);
    },

    /**
     * Optional: resetAll / resetAllKeys used by some stores
     */
    resetAll: () => {
      memory.clear();
    },
  };
}

/**
 * Expose a minimal API for other modules:
 * - client: the ioredis client or memory fallback
 * - isReady, getStatus, waitForReady
 * - createRateLimitStore
 * - events emitter for hooks
 */
module.exports = {
  client,
  isReady,
  getStatus,
  waitForReady,
  createRateLimitStore,
  events,
  // expose internal flag for diagnostics (read-only)
  get gracefullyDegraded() {
    return gracefullyDegraded;
  },
};

// ============================================================================
// Graceful shutdown
// ============================================================================
async function disconnect() {
  try {
    if (!client) return;
    if (client && client.quit && typeof client.quit === 'function' && client.status !== 'end') {
      await client.quit();
      logInfo('✅ Redis disconnected gracefully');
    }
  } catch (err) {
    console.error('❌ Error disconnecting Redis:', err);
  }
}

process.on('SIGINT', () => {
  disconnect().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  disconnect().finally(() => process.exit(0));
});
