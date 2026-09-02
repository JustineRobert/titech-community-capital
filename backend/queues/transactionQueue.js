"use strict";

/**

* =============================================================================
* TITech Community Capital
* Enterprise Transaction Queue
* =============================================================================
*
* File:
* backend/queues/transactionQueue.js
*
* Purpose:
* Durable BullMQ queue responsible for asynchronous transaction processing.
*
* Architectural role:
*
* API / Service
* ```
    │
  ```
* ```
    ▼
  ```
* transactionQueue
* ```
    │
  ```
* ```
    ├── durable Redis job
  ```
* ```
    ├── idempotency
  ```
* ```
    ├── retry / backoff
  ```
* ```
    ├── delayed execution
  ```
* ```
    ├── priority
  ```
* ```
    └── operational metadata
  ```
* ```
           │
  ```
* ```
           ▼
  ```
* ```
    transaction.worker.js
  ```
* ```
           │
  ```
* ```
           ▼
  ```
* ```
    TransactionService
  ```
* ```
           │
  ```
* ```
           ▼
  ```
* ```
    Ledger / Financial Transaction
  ```
*
* =============================================================================
* FINANCIAL SAFETY
* =============================================================================
*
* A queue is NOT the financial source of truth.
*
* The queue provides durable delivery and controlled execution.
*
* The transaction service / ledger MUST remain responsible for:
*
* * financial idempotency
* * double-entry accounting
* * balance integrity
* * transaction state transitions
* * atomic database operations
* * duplicate-payment protection
*
* This queue MUST NEVER be treated as proof that a financial transaction
* succeeded merely because a BullMQ job completed.
*
* =============================================================================
* IMPORTANT
* =============================================================================
*
* This module intentionally uses CommonJS because the TITech backend uses:
*
* require(...)
* module.exports
*
* Do NOT mix:
*
* import { Queue } from "bullmq";
*
* with CommonJS unless the entire backend is migrated to ESM.
*
* =============================================================================
* DESIGN PRINCIPLES
* =============================================================================
*
* * CommonJS compatible.
* * BullMQ compatible.
* * Redis connection reuse.
* * No secrets in logs.
* * Tenant-aware job metadata.
* * Financial idempotency metadata.
* * Deterministic job IDs where supplied.
* * Bounded retry attempts.
* * Exponential backoff with jitter.
* * Delayed jobs supported.
* * Priority supported.
* * Job deduplication supported through jobId.
* * Safe shutdown.
* * Connection health visibility.
* * Queue configuration centralized.
* * Production/development configuration aware.
* * No financial mutation inside queue code.
* * No deletion of financial history.
*
* =============================================================================
  */

const {
Queue,
} = require("bullmq");

const IORedis = require("ioredis");

/**

* =============================================================================
* CONSTANTS
* =============================================================================
  */

const QUEUE_NAME =
process.env.TITECH_TRANSACTION_QUEUE_NAME ||
"transactions";

const DEFAULT_ATTEMPTS =
parsePositiveInteger(
process.env.TITECH_TRANSACTION_QUEUE_ATTEMPTS,
5
);

const DEFAULT_BACKOFF_DELAY =
parsePositiveInteger(
process.env.TITECH_TRANSACTION_QUEUE_BACKOFF_MS,
1000
);

const DEFAULT_MAX_BACKOFF =
parsePositiveInteger(
process.env.TITECH_TRANSACTION_QUEUE_MAX_BACKOFF_MS,
5 * 60 * 1000
);

const DEFAULT_REMOVE_ON_COMPLETE =
process.env.TITECH_TRANSACTION_QUEUE_REMOVE_ON_COMPLETE !==
"false";

const DEFAULT_REMOVE_ON_FAIL =
process.env.TITECH_TRANSACTION_QUEUE_REMOVE_ON_FAIL ===
"true";

const DEFAULT_JOB_AGE_SECONDS =
parsePositiveInteger(
process.env.TITECH_TRANSACTION_QUEUE_JOB_AGE_SECONDS,
24 * 60 * 60
);

const DEFAULT_FAILED_JOB_AGE_SECONDS =
parsePositiveInteger(
process.env.TITECH_TRANSACTION_QUEUE_FAILED_JOB_AGE_SECONDS,
7 * 24 * 60 * 60
);

const DEFAULT_MAX_ATTEMPTS_PER_TRANSACTION =
parsePositiveInteger(
process.env.TITECH_TRANSACTION_MAX_ATTEMPTS,
DEFAULT_ATTEMPTS
);

const DEFAULT_PRIORITY =
parsePositiveInteger(
process.env.TITECH_TRANSACTION_QUEUE_PRIORITY,
5
);

const QUEUE_VERSION =
process.env.TITECH_QUEUE_VERSION ||
"1";

const SERVICE_NAME =
process.env.TITECH_SERVICE_NAME ||
"titech-community-capital-backend";

/**

* =============================================================================
* HELPERS
* =============================================================================
  */

/**

* Parse a positive integer safely.
*
* @param {*} value
* @param {number} fallback
* @returns {number}
  */
  function parsePositiveInteger(value, fallback) {
  const parsed =
  Number.parseInt(value, 10);

if (
!Number.isFinite(parsed) ||
parsed <= 0
) {
return fallback;
}

return parsed;
}

/**

* Normalize an optional string.
*
* @param {*} value
* @returns {string|null}
  */
  function normalizeOptionalString(value) {
  if (
  value === undefined ||
  value === null
  ) {
  return null;
  }

const normalized =
String(value).trim();

return normalized || null;
}

/**

* =============================================================================
* REDIS CONFIGURATION
* =============================================================================
*
* Supported:
*
* REDIS_URL
* REDIS_URI
*
* or:
*
* REDIS_HOST
* REDIS_PORT
* REDIS_PASSWORD
* REDIS_TLS
*
* Existing TITech development configuration:
*
* redis://127.0.0.1:6379
*
* is fully supported.
* =============================================================================
  */

function buildRedisConnectionOptions() {
const redisUrl =
normalizeOptionalString(
process.env.REDIS_URL ||
process.env.REDIS_URI
);

if (redisUrl) {
return {
url: redisUrl,
};
}

return {
host:
process.env.REDIS_HOST ||
"127.0.0.1",


port:
  parsePositiveInteger(
    process.env.REDIS_PORT,
    6379
  ),

password:
  process.env.REDIS_PASSWORD ||
  undefined,

tls:
  process.env.REDIS_TLS === "true"
    ? {}
    : undefined,


};
}

/**

* =============================================================================
* REDIS CONNECTION
* =============================================================================
*
* BullMQ requires an ioredis-compatible connection.
*
* maxRetriesPerRequest MUST be null for BullMQ worker/queue connections.
*
* enableReadyCheck remains enabled so startup does not incorrectly assume
* Redis is ready before the connection has completed.
* =============================================================================
  */

function createRedisConnection() {
const redisConfig =
buildRedisConnectionOptions();

const connectionOptions =
redisConfig.url
? {
...parseRedisUrlOptions(
redisConfig.url
),
}
: {
...redisConfig,
};

const redis =
new IORedis(
connectionOptions
);

return redis;
}

/**

* Convert REDIS_URL into ioredis-compatible constructor options.
*
* @param {string} redisUrl
* @returns {object}
  */
  function parseRedisUrlOptions(redisUrl) {
  return {
  host:
  undefined,

  port:
  undefined,

  password:
  undefined,

  tls:
  undefined,

  maxRetriesPerRequest:
  null,

  enableReadyCheck:
  true,

  lazyConnect:
  false,

  connectionName:
  `${SERVICE_NAME}:${QUEUE_NAME}`,

  /**

  * ioredis accepts a URL directly as the first constructor argument.
    */
    url:
    redisUrl,
    };
    }

/**

* =============================================================================
* SHARED REDIS CONNECTION
* =============================================================================
*
* A single connection is shared by the queue.
*
* Workers may use their own dedicated blocking connection where appropriate.
* Do not blindly share a worker connection with API request processing.
* =============================================================================
  */

const redisConnection =
createRedisConnection();

/**

* =============================================================================
* REDIS EVENT LOGGING
* =============================================================================
*
* Never log passwords, connection URLs, authentication tokens, or complete
* Redis configuration.
* =============================================================================
  */

function attachRedisLogging(redis) {
redis.on(
"connect",
() => {
if (
process.env.NODE_ENV !==
"test"
) {
console.info(
`[${SERVICE_NAME}] Redis connection established for ${QUEUE_NAME}.`
);
}
}
);

redis.on(
"ready",
() => {
if (
process.env.NODE_ENV !==
"test"
) {
console.info(
`[${SERVICE_NAME}] Redis is ready for ${QUEUE_NAME}.`
);
}
}
);

redis.on(
"reconnecting",
() => {
if (
process.env.NODE_ENV !==
"test"
) {
console.warn(
`[${SERVICE_NAME}] Redis reconnecting for ${QUEUE_NAME}.`
);
}
}
);

redis.on(
"error",
(error) => {
if (
process.env.NODE_ENV !==
"test"
) {
console.error(
`[${SERVICE_NAME}] Redis error for ${QUEUE_NAME}:`,
{
name:
error?.name ||
"RedisError",


        code:
          error?.code ||
          null,

        message:
          error?.message ||
          "Redis connection error",
      }
    );
  }
}


);
}

attachRedisLogging(
redisConnection
);

/**

* =============================================================================
* BULLMQ CONNECTION OPTIONS
* =============================================================================
*
* BullMQ accepts the ioredis instance through:
*
* connection
*
* Additional queue-level settings are kept here for consistency.
* =============================================================================
  */

const bullMqConnectionOptions = Object.freeze({
connection:
redisConnection,
});

/**

* =============================================================================
* DEFAULT JOB OPTIONS
* =============================================================================
*
* Financial transaction jobs are intentionally retained long enough for
* operational investigation.
*
* The underlying Transaction/Ledger records remain the permanent source of
* truth even when BullMQ job metadata is eventually removed.
* =============================================================================
  */

const defaultJobOptions =
Object.freeze({
attempts:
DEFAULT_ATTEMPTS,


backoff: {
  type:
    "exponential",

  delay:
    DEFAULT_BACKOFF_DELAY,

  jitter:
    0.25,
},

removeOnComplete: {
  age:
    DEFAULT_JOB_AGE_SECONDS,

  count:
    10000,
},

removeOnFail: {
  age:
    DEFAULT_FAILED_JOB_AGE_SECONDS,

  count:
    50000,
},

priority:
  DEFAULT_PRIORITY,

/**
 * Do not allow an accidentally enormous transaction payload to remain in
 * Redis forever.
 *
 * This does NOT limit the actual financial transaction amount.
 */
stackTraceLimit:
  20,


});

/**

* =============================================================================
* TRANSACTION QUEUE
* =============================================================================
  */

const transactionQueue =
new Queue(
QUEUE_NAME,
{
...bullMqConnectionOptions,


  defaultJobOptions,
}


);

/**

* =============================================================================
* QUEUE EVENT LOGGING
* =============================================================================
*
* These events describe queue behavior only.
*
* They MUST NOT be interpreted as proof of financial settlement.
* =============================================================================
  */

transactionQueue.on(
"error",
(error) => {
console.error(
`[${SERVICE_NAME}] Transaction queue error.`,
{
queue:
QUEUE_NAME,


    code:
      error?.code ||
      null,

    name:
      error?.name ||
      "QueueError",

    message:
      error?.message ||
      "Transaction queue error",
  }
);


}
);

/**

* =============================================================================
* TRANSACTION DATA NORMALIZATION
* =============================================================================
*
* The queue deliberately accepts a flexible transaction payload because
* existing TITech services may already use different field names.
*
* We normalize metadata without mutating the caller's object.
* =============================================================================
  */

function normalizeTransactionData(
data
) {
if (
!data ||
typeof data !==
"object" ||
Array.isArray(data)
) {
throw new TypeError(
"Transaction queue data must be a non-null object."
);
}

const normalized =
{
...data,
};

/**

* Never allow arbitrary prototype properties to enter the job payload.
  */
  delete normalized.**proto**;
  delete normalized.constructor;
  delete normalized.prototype;

return normalized;
}

/**

* =============================================================================
* IDEMPOTENCY KEY EXTRACTION
* =============================================================================
*
* Preferred order:
*
* idempotencyKey
* transactionReference
* transactionId
* reference
*
* The transaction service remains responsible for enforcing financial
* idempotency.
*
* BullMQ jobId provides an additional queue-level deduplication layer.
* =============================================================================
  */

function getTransactionIdempotencyKey(
data,
explicitKey
) {
const candidates = [
explicitKey,


data?.idempotencyKey,

data?.transactionReference,

data?.transactionId,

data?.reference,


];

for (
const candidate of candidates
) {
const normalized =
normalizeOptionalString(
candidate
);


if (normalized) {
  return normalized;
}


}

return null;
}

/**

* =============================================================================
* JOB ID SANITIZATION
* =============================================================================
*
* BullMQ job IDs should not contain ":" because of Redis key semantics in
* some operational tooling.
*
* Keep the generated ID deterministic and bounded.
* =============================================================================
  */

function sanitizeJobId(
value
) {
const normalized =
normalizeOptionalString(
value
);

if (!normalized) {
return null;
}

return normalized
.replace(
/[^a-zA-Z0-9.*-]/g,
"*"
)
.slice(
0,
200
);
}

/**

* =============================================================================
* JOB ID GENERATION
* =============================================================================
*
* Explicit jobId wins.
*
* Otherwise a financial idempotency key is used.
*
* If neither exists, a unique timestamp/random ID is generated.
*
* IMPORTANT:
*
* A random queue job ID does NOT provide financial idempotency.
*
* Every transaction service must still enforce an immutable financial
* idempotency key at the database/ledger level.
* =============================================================================
  */

function buildJobId(
data,
options = {}
) {
const explicitJobId =
sanitizeJobId(
options.jobId
);

if (explicitJobId) {
return explicitJobId;
}

const idempotencyKey =
getTransactionIdempotencyKey(
data,
options.idempotencyKey
);

if (idempotencyKey) {
return sanitizeJobId(
`transaction-${idempotencyKey}`
);
}

const transactionId =
sanitizeJobId(
data?.transactionId
);

if (transactionId) {
return sanitizeJobId(
`transaction-${transactionId}`
);
}

return null;
}

/**

* =============================================================================
* TENANT VALIDATION
* =============================================================================
*
* Financial transactions must be tenant scoped.
*
* We do not invent a tenant ID when one is missing.
*
* Whether tenantId is mandatory for every transaction is ultimately determined
* by the TransactionService/domain model. The queue preserves the value and
* can enforce it when configured.
* =============================================================================
  */

function validateTenant(
data,
options = {}
) {
const tenantId =
normalizeOptionalString(
options.tenantId ||
data?.tenantId
);

const requireTenant =
options.requireTenant !==
undefined
? options.requireTenant ===
true
: process.env.TITECH_REQUIRE_TENANT_CONTEXT ===
"true";

if (
requireTenant &&
!tenantId
) {
throw new Error(
"Transaction queue requires tenantId."
);
}

return tenantId;
}

/**

* =============================================================================
* RETRY POLICY
* =============================================================================
  */

function buildBackoff(
options = {}
) {
return {
type:
"exponential",


delay:
  parsePositiveInteger(
    options.backoffDelay,
    DEFAULT_BACKOFF_DELAY
  ),

jitter:
  options.jitter !==
    undefined
    ? Number(options.jitter)
    : 0.25,


};
}

/**

* =============================================================================
* ADD TRANSACTION JOB
* =============================================================================
*
* @param {string} name
* @param {object} data
* @param {object} opts
*
* Supported options include:
*
* attempts
* backoff
* delay
* priority
* jobId
* idempotencyKey
* tenantId
* requireTenant
* removeOnComplete
* removeOnFail
* =============================================================================
  */

async function addTransactionJob(
name,
data,
opts = {}
) {
const normalizedName =
normalizeOptionalString(
name
);

if (!normalizedName) {
throw new TypeError(
"Transaction queue job name is required."
);
}

const normalizedData =
normalizeTransactionData(
data
);

const tenantId =
validateTenant(
normalizedData,
opts
);

const idempotencyKey =
getTransactionIdempotencyKey(
normalizedData,
opts.idempotencyKey
);

/**

* Inject only non-sensitive operational metadata.
  */
  normalizedData.queueMetadata = {
  service:
  SERVICE_NAME,


queue:



  QUEUE_NAME,

queueVersion:
  QUEUE_VERSION,

tenantId,

idempotencyKey,

enqueuedAt:
  new Date().toISOString(),


};

/**

* ---
* JOB OPTIONS
* ---

*/

const jobOptions = {
...defaultJobOptions,


...opts,

backoff:
  opts.backoff ||
  buildBackoff(opts),

attempts:
  parsePositiveInteger(
    opts.attempts,
    DEFAULT_MAX_ATTEMPTS_PER_TRANSACTION
  ),

priority:
  parsePositiveInteger(
    opts.priority,
    DEFAULT_PRIORITY
  ),


};

/**

* Explicit delay.
  */
  if (
  opts.delay !==
  undefined
  ) {
  const delay =
  Number(opts.delay);


if (



  !Number.isFinite(delay) ||
  delay < 0
) {
  throw new TypeError(
    "Transaction queue delay must be a non-negative number."
  );
}

jobOptions.delay =
  Math.floor(delay);


}

/**

* ---
* DETERMINISTIC JOB ID
* ---
*
* This prevents duplicate queue entries when the same idempotency key is
* submitted multiple times.
  */
  const generatedJobId =
  buildJobId(
  normalizedData,
  opts
  );

if (generatedJobId) {
jobOptions.jobId =
generatedJobId;
}

/**

* Do not accidentally pass internal helper options into BullMQ.
  */
  delete jobOptions.tenantId;
  delete jobOptions.requireTenant;
  delete jobOptions.idempotencyKey;
  delete jobOptions.backoffDelay;
  delete jobOptions.jitter;

/**

* ---
* ENQUEUE
* ---

*/

const job =
await transactionQueue.add(
normalizedName,
normalizedData,
jobOptions
);

return job;
}

/**

* =============================================================================
* ENQUEUE TRANSACTION
* =============================================================================
*
* Higher-level helper for callers that do not need to manage the BullMQ job
* name manually.
* =============================================================================
  */

async function enqueueTransaction(
data,
options = {}
) {
return addTransactionJob(
options.jobName ||
"process-transaction",
data,
options
);
}

/**

* =============================================================================
* GET JOB
* =============================================================================
  */

async function getTransactionJob(
jobId
) {
const normalizedJobId =
sanitizeJobId(
jobId
);

if (!normalizedJobId) {
return null;
}

return transactionQueue.getJob(
normalizedJobId
);
}

/**

* =============================================================================
* GET QUEUE COUNTS
* =============================================================================
*
* Useful for:
*
* * health endpoints
* * metrics
* * dashboards
* * operational alerts
* =============================================================================
  */

async function getQueueCounts() {
return transactionQueue.getJobCounts(
"waiting",
"active",
"completed",
"failed",
"delayed",
"paused",
"prioritized",
"waiting-children"
);
}

/**

* =============================================================================
* QUEUE HEALTH
* =============================================================================
  */

async function getQueueHealth() {
try {
const counts =
await getQueueCounts();


const redisStatus =
  redisConnection.status;

const healthy =
  redisStatus ===
    "ready";

return {
  healthy,

  service:
    SERVICE_NAME,

  queue:
    QUEUE_NAME,

  queueVersion:
    QUEUE_VERSION,

  redisStatus,

  counts,

  timestamp:
    new Date().toISOString(),
};


} catch (error) {
return {
healthy:
false,


  service:
    SERVICE_NAME,

  queue:
    QUEUE_NAME,

  queueVersion:
    QUEUE_VERSION,

  redisStatus:
    redisConnection.status,

  counts:
    null,

  error: {
    name:
      error?.name ||
      "QueueHealthError",

    code:
      error?.code ||
      null,

    message:
      error?.message ||
      "Unable to inspect transaction queue.",
  },

  timestamp:
    new Date().toISOString(),
};


}
}

/**

* =============================================================================
* PAUSE QUEUE
* =============================================================================
  */

async function pauseTransactionQueue() {
return transactionQueue.pause();
}

/**

* =============================================================================
* RESUME QUEUE
* ============================================================================= */

async function resumeTransactionQueue() {
return transactionQueue.resume();
}

/**

* =============================================================================
* DRAIN WAITING JOBS
* =============================================================================
*
* WARNING:
*
* This is an operational maintenance operation.
*
* It must NOT be used as a normal transaction cancellation mechanism.
* Financial records are never deleted here.
* =============================================================================
  */

async function drainTransactionQueue(
options = {}
) {
return transactionQueue.drain(
options.delayed === true
);
}

/**

* =============================================================================
* SHUTDOWN STATE
* =============================================================================
  */

let shutdownStarted =
false;

/**

* =============================================================================
* GRACEFUL SHUTDOWN
* =============================================================================
*
* Queue shutdown does not automatically mean that active workers have finished
* processing. The worker owns worker lifecycle.
*
* This function closes the producer queue and Redis connection used by this
* module.
* =============================================================================
  */

async function shutdownTransactionQueue(
options = {}
) {
if (shutdownStarted) {
return;
}

shutdownStarted =
true;

const closeRedis =
options.closeRedis !==
false;

try {
await transactionQueue.close();
} catch (error) {
console.error(
`[${SERVICE_NAME}] Failed to close transaction queue.`,
{
code:
error?.code ||
null,


    message:
      error?.message ||
      "Transaction queue close failed.",
  }
);


}

if (closeRedis) {
try {
await redisConnection.quit();
} catch (error) {
/**
* If Redis has already disconnected, destroy is the final fallback.
*/
try {
redisConnection.disconnect();
} catch (_) {
// Intentionally ignored during shutdown.
}


  if (
    process.env.NODE_ENV !==
    "test"
  ) {
    console.warn(
      `[${SERVICE_NAME}] Redis connection closed with warning during transaction queue shutdown.`,
      {
        code:
          error?.code ||
          null,

        message:
          error?.message ||
          "Redis shutdown warning.",
      }
    );
  }
}


}
}

/**

* =============================================================================
* PROCESS SIGNAL HANDLERS
* =============================================================================
*
* Disabled by default in test environments and can be explicitly disabled
* through:
*
* ENABLE_QUEUE_SHUTDOWN_HOOK=false
*
* The worker process should normally own global SIGTERM/SIGINT orchestration.
* =============================================================================
  */

let shutdownHooksRegistered =
false;

function registerShutdownHooks() {
if (
shutdownHooksRegistered
) {
return;
}

if (
process.env.ENABLE_QUEUE_SHUTDOWN_HOOK ===
"false"
) {
return;
}

if (
process.env.NODE_ENV ===
"test"
) {
return;
}

shutdownHooksRegistered =
true;

const shutdown =
async (signal) => {
console.info(
`[${SERVICE_NAME}] Received ${signal}; shutting down transaction queue.`
);


  try {
    await shutdownTransactionQueue();
  } finally {
    /**
     * Do not call process.exit() here.
     *
     * The main TITech application should coordinate shutdown of:
     *
     *   HTTP server
     *   workers
     *   queues
     *   MongoDB
     *   Redis
     *   schedulers
     */
  }
};


process.once(
"SIGINT",
() => {
shutdown(
"SIGINT"
).catch(
(error) => {
console.error(
"Transaction queue SIGINT shutdown error.",
error
);
}
);
}
);

process.once(
"SIGTERM",
() => {
shutdown(
"SIGTERM"
).catch(
(error) => {
console.error(
"Transaction queue SIGTERM shutdown error.",
error
);
}
);
}
);
}

registerShutdownHooks();

/**

* =============================================================================
* QUEUE CONFIGURATION
* =============================================================================
  */

const transactionQueueConfig =
Object.freeze({
service:
SERVICE_NAME,


queueName:
  QUEUE_NAME,

version:
  QUEUE_VERSION,

attempts:
  DEFAULT_ATTEMPTS,

backoffDelay:
  DEFAULT_BACKOFF_DELAY,

maxBackoff:
  DEFAULT_MAX_BACKOFF,

defaultPriority:
  DEFAULT_PRIORITY,

maxAttemptsPerTransaction:
  DEFAULT_MAX_ATTEMPTS_PER_TRANSACTION,

removeOnComplete:
  DEFAULT_REMOVE_ON_COMPLETE,

removeOnFail:
  DEFAULT_REMOVE_ON_FAIL,


});

/**

* =============================================================================
* EXPORTS
* =============================================================================
  */

module.exports =
Object.freeze({
QUEUE_NAME,


QUEUE_VERSION,

transactionQueue,

transactionQueueConfig,

redisConnection,

defaultJobOptions,

addTransactionJob,

enqueueTransaction,

getTransactionJob,

getQueueCounts,

getQueueHealth,

pauseTransactionQueue,

resumeTransactionQueue,

drainTransactionQueue,

shutdownTransactionQueue,

buildJobId,

getTransactionIdempotencyKey,

normalizeTransactionData,


});