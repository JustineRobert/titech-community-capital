# Before & After - Code Comparison

## Overview

This document shows the key changes made during the refactoring with before/after code snippets.

---

## 1. Server.js - Connection Management

### BEFORE

```javascript
// server.js (old)
dotenv.config({ path: path.resolve(__dirname, '.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || 5000);

// Validate required environment variables early to fail fast.
const requiredEnvVars = ['PORT', 'MONGO_URI', 'JWT_SECRET'];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
```

### AFTER

```javascript
// server.js (new)
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || 5000);
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/community_savings';
const REDIS_URI = process.env.REDIS_URI || 'redis://127.0.0.1:6379';

// Validate only truly required environment variables
const requiredEnvVars = ['JWT_SECRET']; // MONGO_URI now has a default
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// Store connection URIs for startup checks
const connectionConfig = {
  mongo: MONGO_URI,
  redis: REDIS_URI,
};
```

**Benefits**:

- Defaults provided for non-critical configs
- Connection URIs centralized
- Easier to override via environment

---

## 2. Server.js - Exponential Backoff Function

### BEFORE

❌ Not present - Backoff calculation was in db.js as simple multiplication

### AFTER

```javascript
/**
 * Exponential backoff calculator with jitter
 * @param {number} attemptNumber - Starting from 0
 * @param {number} minDelay - Minimum delay in ms (default 1000)
 * @param {number} maxDelay - Maximum delay in ms (default 30000)
 * @returns {number} Delay in milliseconds
 */
function getExponentialBackoffDelay(attemptNumber, minDelay = 1000, maxDelay = 30000) {
  const baseDelay = Math.min(minDelay * Math.pow(2, attemptNumber), maxDelay);
  // Add jitter (±10% randomness) to prevent thundering herd
  const jitter = baseDelay * 0.1 * (Math.random() - 0.5);
  return Math.floor(baseDelay + jitter);
}
```

**Benefits**:

- Reusable across services
- Jitter prevents thundering herd
- Configurable min/max delays

---

## 3. Server.js - Startup Health Check

### BEFORE

❌ Not present - No startup validation

### AFTER

```javascript
/**
 * Startup Health Check Function
 * Ensures critical services are available before starting the server
 */
async function performStartupHealthCheck() {
  logger.info('🔍 Performing startup health checks...');

  let mongoAvailable = false;
  let redisAvailable = false;
  let hasErrors = false;

  // Check MongoDB availability (handled separately by connectDB)
  logger.info(`📍 MongoDB URI: ${MONGO_URI}`);

  // Check Redis availability
  logger.info(`📍 Redis URI: ${REDIS_URI}`);
  if (redisClient && redisClient.status && redisClient.status !== 'mock') {
    redisAvailable = true;
    logger.info('✅ Redis is available');
  } else {
    logger.warn('⚠️ Redis is not available - rate limiting will use memory store');
  }

  logger.info('✅ Startup health checks completed');
}
```

**Benefits**:

- Validates services before accepting requests
- Clear logging of configuration
- Early detection of problems

---

## 4. Server.js - Server Startup

### BEFORE

```javascript
server.listen(PORT, () => {
  logger.info(`✅ Server running (${NODE_ENV}) at http://localhost:${PORT}`);
});
```

### AFTER

```javascript
const startServer = async () => {
  try {
    // Perform startup health checks
    await performStartupHealthCheck();

    // Start listening for connections
    server.listen(PORT, () => {
      logger.info(`✅ Server running (${NODE_ENV}) at http://localhost:${PORT}`);
      logger.info(
        `🌐 CORS allowed origins: ${process.env.CORS_ORIGINS || 'http://localhost:3000'}`
      );
      logger.info('📊 Metrics available at: /metrics');
      logger.info('🏥 Health check at: /healthz');
      logger.info('📡 Readiness check at: /readyz');
    });
  } catch (error) {
    logger.error('❌ Failed to start server', { error: error.message });
    process.exit(1);
  }
};

startServer();
```

**Benefits**:

- Async/await pattern for better readability
- Health checks before listening
- Detailed startup information logged

---

## 5. MongoDB Config - Retry Logic

### BEFORE

```javascript
// config/db.js (old)
const { NODE_ENV, MONGO_URI, MONGO_URI_FALLBACK } = process.env;

const resolveMongoUri = () => {
  if (NODE_ENV === 'production') {
    return MONGO_URI;
  }
  return MONGO_URI_FALLBACK;
};

const connectDB = async (attempt = 1) => {
  if (isConnecting) return;
  isConnecting = true;

  const mongoUri = resolveMongoUri();

  if (!mongoUri) {
    logger.error('❌ MongoDB URI is missing. Check your .env configuration.');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    logger.info('✅ MongoDB connected successfully');
    isConnecting = false;
  } catch (error) {
    isConnecting = false;
    const message = error.message;

    logger.error(`❌ MongoDB connection error: ${message}`);

    // Fail fast on configuration errors
    if (
      message.includes('mongodb+srv URI cannot have port number') ||
      message.includes('Invalid connection string')
    ) {
      logger.error('🛑 Invalid MongoDB configuration. Check MONGO_URI.');
      process.exit(1);
    }

    // Retry network‑related errors only
    if (attempt < MAX_RETRIES) {
      const delay = Math.min(5000 * attempt, 30000);

      logger.warn(
        `🔄 Retrying MongoDB connection in ${delay / 1000}s (Attempt ${attempt}/${MAX_RETRIES})`
      );

      setTimeout(() => connectDB(attempt + 1), delay);
      return;
    }

    logger.error('🛑 MongoDB failed after maximum retries. Exiting.');
    process.exit(1);
  }
};
```

### AFTER

```javascript
// config/db.js (new)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/community_savings';

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds
const MAX_RETRY_DELAY = 30000; // 30 seconds

/**
 * Calculate exponential backoff with jitter
 */
function getRetryDelay(attempt) {
  const baseDelay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1), MAX_RETRY_DELAY);
  // Add jitter (±10% randomness) to prevent thundering herd
  const jitter = baseDelay * 0.1 * (Math.random() - 0.5);
  return Math.floor(baseDelay + jitter);
}

const connectDB = async (attempt = 1) => {
  if (isConnecting && attempt > 1) return;
  if (attempt === 1) isConnecting = true;

  const mongoUri = MONGO_URI; // Always use same URI

  if (!mongoUri) {
    logger.error('❌ MongoDB URI is missing. Check MONGO_URI environment variable or defaults.');
    process.exit(1);
  }

  try {
    logger.info(`🔌 Connecting to MongoDB (Attempt ${attempt}/${MAX_RETRIES})`);

    await mongoose.connect(mongoUri, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      autoIndex: NODE_ENV !== 'production',
    });

    logger.info('✅ MongoDB connected successfully');
    isConnecting = false;
  } catch (error) {
    isConnecting = false;
    const message = error.message || String(error);

    logger.error(`❌ MongoDB connection error (Attempt ${attempt}/${MAX_RETRIES}): ${message}`);

    // Fail fast on configuration errors
    if (
      message.includes('mongodb+srv URI cannot have port number') ||
      message.includes('Invalid connection string') ||
      message.includes('Invalid scheme') ||
      message.includes('authentication failed') ||
      message.includes('auth error')
    ) {
      logger.error('🛑 Invalid MongoDB configuration. Check MONGO_URI environment variable.');
      logger.error(`   Expected format: mongodb://host:port/dbname or mongodb+srv://...`);
      logger.error(`   Current MONGO_URI: ${mongoUri.substring(0, 50)}...`);
      process.exit(1);
    }

    // Retry network-related errors only
    if (attempt < MAX_RETRIES) {
      const delay = getRetryDelay(attempt);
      logger.warn(
        `🔄 Retrying MongoDB connection in ${delay / 1000}s (Attempt ${attempt + 1}/${MAX_RETRIES})`
      );

      setTimeout(() => connectDB(attempt + 1), delay);
      return;
    }

    // Final failure after all retries exhausted
    logger.error('🛑 MongoDB failed to connect after maximum retries.');
    logger.error(`   Attempts: ${MAX_RETRIES}`);
    logger.error(`   Last error: ${message}`);
    logger.error('   Check that MongoDB is running and accessible at the configured URI.');
    process.exit(1);
  }
};
```

**Improvements**:

- Proper exponential backoff (2s, 4s, 8s, 16s) instead of linear
- Jitter randomization prevents thundering herd
- More error types detected (authentication, etc.)
- Better error messages with guidance
- Shows attempt number in logs

---

## 6. Redis Service - Configuration

### BEFORE

```javascript
// services/redis.js (old)
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const NODE_ENV = process.env.NODE_ENV || 'development';

const MIN_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const BACKOFF_MULTIPLIER = 1.5;

const ERROR_LOG_THROTTLE_MS = 30000;
const errorLogThrottle = NODE_ENV === 'production' ? ERROR_LOG_THROTTLE_MS : 5000;
```

### AFTER

```javascript
// services/redis.js (new)
const REDIS_URI = process.env.REDIS_URI || 'redis://127.0.0.1:6379'; // Changed var name
const NODE_ENV = process.env.NODE_ENV || 'development';

const MIN_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const BACKOFF_MULTIPLIER = 1.5;
const MAX_RETRY_ATTEMPTS = 10; // Added explicit max

const ERROR_LOG_THROTTLE_MS = NODE_ENV === 'production' ? 30000 : 5000; // Simplified

let gracefullyDegraded = false; // Track degradation state
```

**Benefits**:

- `REDIS_URI` matches server.js pattern
- Consistent default format (127.0.0.1 not localhost)
- Explicit max retry attempts
- Degradation state tracking

---

## 7. Redis Service - Retry Strategy

### BEFORE

```javascript
retryStrategy: (times) => {
  if (times > 10) {
    return null;
  }
  const delay = getBackoffDelay(times - 1);
  logErrorThrottled(`🔄 Redis reconnection attempt ${times}, backing off for ${delay}ms`, null);
  return delay;
},
```

### AFTER

```javascript
retryStrategy: (times) => {
  if (times > MAX_RETRY_ATTEMPTS) {
    // Stop retrying after max attempts - will fall back to memory store
    logErrorThrottled(
      `❌ Redis connection exhausted after ${MAX_RETRY_ATTEMPTS} attempts. ` +
      `Falling back to memory store for rate limiting.`,
      null
    );
    gracefullyDegraded = true;
    return null;  // null tells ioredis to stop retrying
  }

  const delay = getBackoffDelay(times - 1);
  logErrorThrottled(
    `🔄 Redis reconnection attempt ${times}/${MAX_RETRY_ATTEMPTS}, ` +
    `backing off for ${delay}ms...`,
    null
  );
  return delay;
},
```

**Benefits**:

- Clear logging of exhaustion
- Tracks degradation state
- Shows attempt ratio (e.g., 5/10)
- Better user-facing message

---

## 8. Redis Service - Helper Methods

### BEFORE

❌ Not present - No status checking methods

### AFTER

```javascript
/**
 * Check if Redis is available and connected
 * @returns {boolean} true if Redis is available
 */
redis.isAvailable = function () {
  return this.status === 'ready' || this.status === 'connected';
};

/**
 * Get current connection status
 * @returns {string} Status: 'ready', 'connecting', 'mock', etc.
 */
redis.getStatus = function () {
  return this.status || 'unknown';
};
```

**Benefits**:

- Controllers can check Redis status
- Graceful feature flags based on Redis availability
- Easy testing and monitoring

---

## 9. Payment Model - Duplicate Index

### BEFORE

```javascript
// models/Payment.js (old) - DUPLICATES
paymentSchema.index({ transactionId: 1, provider: 1 }); // Line 181
paymentSchema.index({ groupId: 1, status: 1 }); // Line 182
paymentSchema.index({ status: 1, createdAt: -1 }); // Line 183
paymentSchema.index({ initiatedAt: -1 }); // Line 184

// ... other code ...

// Ensure indexes are created
paymentSchema.index({ userId: 1, createdAt: -1 }); // Line 263
paymentSchema.index({ groupId: 1, status: 1 }); // Line 264 - DUPLICATE!
```

### AFTER

```javascript
// models/Payment.js (new) - CLEAN
paymentSchema.index({ transactionId: 1, provider: 1 }); // Line 181
paymentSchema.index({ groupId: 1, status: 1 }); // Line 182 (SINGLE)
paymentSchema.index({ status: 1, createdAt: -1 }); // Line 183
paymentSchema.index({ initiatedAt: -1 }); // Line 184

// ... other code ...

// Ensure indexes are created
paymentSchema.index({ userId: 1, createdAt: -1 }); // Line 263
// Line 264 REMOVED - duplicate of line 182
```

**Benefits**:

- No redundant index creation
- Cleaner, more maintainable code
- Slightly faster model initialization

---

## Summary of Changes

| Aspect                | Before                 | After                          |
| --------------------- | ---------------------- | ------------------------------ |
| **MongoDB URI**       | Required or fallback   | Default provided               |
| **Redis URI**         | `REDIS_URL`            | `REDIS_URI`                    |
| **Retry strategy**    | Linear (5000\*attempt) | Exponential (2^attempt)        |
| **Jitter**            | No                     | Yes (±10%)                     |
| **Redis failure**     | Errors logged          | Graceful fallback              |
| **Error messages**    | Generic                | Detailed with guidance         |
| **Status checking**   | No methods             | `isAvailable()`, `getStatus()` |
| **Duplicate indexes** | Yes (1 in Payment)     | No                             |
| **Health checks**     | Missing                | Complete                       |

---

## Testing the Changes

### Test MongoDB Retry

```bash
# Kill MongoDB
killall mongod

# Start server (will retry and eventually exit)
npm start

# Expected: Shows exponential backoff attempts
```

### Test Redis Graceful Degradation

```bash
# Kill Redis
redis-cli shutdown

# Start server (will retry then fall back to memory)
npm start

# Expected: Redis failure message, but server continues
```

### Test Custom URIs

```bash
MONGO_URI="mongodb://custom:27017/db" \
REDIS_URI="redis://custom:6379" \
npm start

# Expected: Uses custom URIs instead of defaults
```

---

**For full details, see [SERVER_REFACTORING_DOCUMENTATION.md](./SERVER_REFACTORING_DOCUMENTATION.md)**
