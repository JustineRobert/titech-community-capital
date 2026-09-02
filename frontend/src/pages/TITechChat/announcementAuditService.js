/**
* ============================================================================
* TITech Community Capital Ltd
* Enterprise Announcement Audit Service
* ============================================================================
*
* File:
* frontend/src/pages/TITechChat/announcementAuditService.js
*
* Version:
* 3.0.0
*
* Purpose:
* Enterprise-grade client-side audit service for the TITech Community
* Capital announcement subsystem.
*
* Responsibilities:
* * Create normalized announcement audit events.
* * Record user-facing announcement lifecycle actions.
* * Support correlation/request identifiers.
* * Support idempotency for retry-safe audit submission.
* * Provide batching for high-volume event delivery.
* * Provide bounded retry with exponential backoff.
* * Prevent audit failures from breaking the primary UI workflow.
* * Normalize errors without exposing sensitive information.
* * Support browser lifecycle flushing where practical.
* * Remain independent from Redux and backend implementation details.
*
* Security:
* * Never place access tokens, refresh tokens, passwords or secrets in
* ```
  audit metadata.
  ```
* * Metadata is treated as untrusted client data.
* * Sensitive fields should be excluded before calling this service.
* * Audit records are not a substitute for authoritative server-side
* ```
  financial/security audit logs.
  ```
*
* Architecture:
*
* UI / AnnouncementDrawer / AnnouncementBell
* ```
                 |
  ```
* ```
                 v
  ```
* ```
       announcementAuditService
  ```
* ```
                 |
  ```
* ```
                 v
  ```
* ```
          configured API client
  ```
* ```
                 |
  ```
* ```
                 v
  ```
* ```
       TITech backend audit API
  ```
*
* ============================================================================
  */

'use strict';

/* ============================================================================

* VERSION / IDENTIFIERS
* ========================================================================== */

const SERVICE_NAME =
'titech-announcement-audit-service';

const SERVICE_VERSION =
'3.0.0';

const DEFAULT_EVENT_VERSION =
'1.0';

const DEFAULT_MAX_QUEUE_SIZE =
500;

const DEFAULT_BATCH_SIZE =
25;

const DEFAULT_RETRY_ATTEMPTS =
3;

const DEFAULT_RETRY_BASE_DELAY_MS =
500;

const DEFAULT_RETRY_MAX_DELAY_MS =
5000;

const DEFAULT_FLUSH_INTERVAL_MS =
5000;

/* ============================================================================

* EVENT TYPES
* ========================================================================== */

/**

* Canonical announcement audit event names.
*
* Keep these stable once deployed because analytics, compliance reporting,
* security monitoring and backend audit processors may depend on them.
  */
  export const ANNOUNCEMENT_AUDIT_EVENTS =
  Object.freeze({
  VIEWED:
  'announcement.viewed',

  OPENED:
  'announcement.opened',

  CLOSED:
  'announcement.closed',

  CLICKED:
  'announcement.clicked',

  MARKED_READ:
  'announcement.marked_read',

  MARKED_UNREAD:
  'announcement.marked_unread',

  DISMISSED:
  'announcement.dismissed',

  ARCHIVED:
  'announcement.archived',

  RESTORED:
  'announcement.restored',

  CREATED:
  'announcement.created',

  UPDATED:
  'announcement.updated',

  DELETED:
  'announcement.deleted',

  PUBLISHED:
  'announcement.published',

  UNPUBLISHED:
  'announcement.unpublished',

  PINNED:
  'announcement.pinned',

  UNPINNED:
  'announcement.unpinned',

  SHARED:
  'announcement.shared',

  SEARCHED:
  'announcement.searched',

  FILTERED:
  'announcement.filtered',

  PAGED:
  'announcement.paged',

  FAILED:
  'announcement.failed',

  LOAD_FAILED:
  'announcement.load_failed',

  ACTION_FAILED:
  'announcement.action_failed',
  });

/* ============================================================================

* EVENT SOURCES
* ========================================================================== */

export const ANNOUNCEMENT_AUDIT_SOURCES =
Object.freeze({
ANNOUNCEMENT_BELL:
'announcement-bell',


ANNOUNCEMENT_DRAWER:
  'announcement-drawer',

ANNOUNCEMENT_CENTER:
  'announcement-center',

CHAT_HOME:
  'chat-home',

NOTIFICATION:
  'notification',

SYSTEM:
  'system',

UNKNOWN:
  'unknown',


});

/* ============================================================================

* MODULE STATE
* ========================================================================== */

let configuredApiClient =
null;

let configuredEndpoint =
'/api/announcements/audit';

let configuredOptions =
Object.freeze({});

let queue =
[];

let flushTimer =
null;

let isFlushing =
false;

let initialized =
false;

let browserListenersRegistered =
false;

/* ============================================================================

* INTERNAL HELPERS
* ========================================================================== */

/**

* Returns true when running in a browser.
  */
  function isBrowser() {
  return (
  typeof window !==
  'undefined' &&
  typeof document !==
  'undefined'
  );
  }

/**

* Generates a browser-safe request/correlation identifier.
*
* crypto.randomUUID is preferred, but the service retains compatibility with
* environments where it is unavailable.
  */
  function generateId(
  prefix = 'titech',
  ) {
  try {
  if (
  typeof crypto !==
  'undefined' &&
  typeof crypto.randomUUID ===
  'function'
  ) {
  return `${prefix}-${crypto.randomUUID()}`;
  }
  } catch {
  // Fall through to the compatibility implementation.
  }

return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

/**

* Returns an ISO timestamp.
  */
  function nowIso() {
  return new Date().toISOString();
  }

/**

* Safely converts a value into a finite positive integer.
  */
  function toPositiveInteger(
  value,
  fallback,
  ) {
  const number =
  Number(value);

if (
!Number.isFinite(number) ||
number < 1
) {
return fallback;
}

return Math.floor(number);
}

/**

* Safely limits strings.
*
* Audit metadata should never be allowed to create arbitrarily large payloads.
  */
  function safeString(
  value,
  maxLength = 500,
  ) {
  if (
  value === null ||
  value === undefined
  ) {
  return undefined;
  }

const result =
String(value).trim();

if (!result) {
return undefined;
}

return result.slice(
0,
maxLength,
);
}

/**

* Removes undefined values recursively while preventing accidental mutation
* of caller-owned objects.
  */
  function sanitizeValue(
  value,
  depth = 0,
  ) {
  if (depth > 4) {
  return '[truncated]';
  }

if (
value === null ||
value === undefined
) {
return value;
}

if (
typeof value ===
'string'
) {
return value.slice(
0,
2000,
);
}

if (
typeof value ===
'number' ||
typeof value ===
'boolean'
) {
return value;
}

if (
value instanceof Date
) {
return value.toISOString();
}

if (
Array.isArray(value)
) {
return value
.slice(0, 50)
.map((item) =>
sanitizeValue(
item,
depth + 1,
),
);
}

if (
typeof value ===
'object'
) {
const output =
{};


Object.keys(value)
  .slice(0, 100)
  .forEach((key) => {
    const normalizedKey =
      safeString(
        key,
        100,
      );

    if (!normalizedKey) {
      return;
    }

    /**
     * Defense-in-depth.
     *
     * These names should never be included in announcement audit
     * metadata. Authentication secrets belong elsewhere.
     */
    if (
      isSensitiveKey(
        normalizedKey,
      )
    ) {
      return;
    }

    const sanitized =
      sanitizeValue(
        value[key],
        depth + 1,
      );

    if (
      sanitized !==
      undefined
    ) {
      output[
        normalizedKey
      ] = sanitized;
    }
  });

return output;


}

return undefined;
}

/**

* Identifies fields that should never be copied into client-side audit
* metadata.
  */
  function isSensitiveKey(
  key,
  ) {
  const normalized =
  key
  .toLowerCase()
  .replace(
  /[-_\s]/g,
  '',
  );

return [
'password',
'passwordhash',
'accesstoken',
'refreshtoken',
'idtoken',
'authorization',
'cookie',
'setcookie',
'secret',
'clientsecret',
'apikey',
'apiKey'.toLowerCase(),
'privatekey',
'encryptionkey',
'otp',
'onetimepassword',
'cvv',
'cvc',
'pin',
'securityanswer',
].includes(
normalized,
);
}

/**

* Sanitizes metadata while explicitly removing common sensitive fields.
  */
  function sanitizeMetadata(
  metadata,
  ) {
  if (
  !metadata ||
  typeof metadata !==
  'object'
  ) {
  return {};
  }

const sanitized =
sanitizeValue(
metadata,
);

return (
sanitized &&
typeof sanitized ===
'object'
? sanitized
: {}
);
}

/**

* Extracts a safe error description.
*
* Never serializes an entire Axios/fetch error object because it may contain
* headers, configuration or credentials.
  */
  function normalizeError(
  error,
  ) {
  if (!error) {
  return {
  name:
  'UnknownError',

  message:
  'Unknown audit error.',
  };
  }

return {
name:
safeString(
error.name,
120,
) ||
'Error',


message:
  safeString(
    error.message,
    500,
  ) ||
  'Audit request failed.',

code:
  safeString(
    error.code,
    120,
  ),


};
}

/**

* Calculates bounded exponential backoff.
  */
  function calculateRetryDelay(
  attempt,
  baseDelayMs,
  maxDelayMs,
  ) {
  const base =
  toPositiveInteger(
  baseDelayMs,
  DEFAULT_RETRY_BASE_DELAY_MS,
  );

const maximum =
Math.max(
base,
toPositiveInteger(
maxDelayMs,
DEFAULT_RETRY_MAX_DELAY_MS,
),
);

const exponential =
Math.min(
maximum,
base *
2 ** Math.max(
0,
attempt - 1,
),
);

/**

* Small jitter reduces synchronized retries when many clients experience
* the same temporary outage.
  */
  const jitter =
  Math.floor(
  Math.random() *
  Math.min(
  250,
  Math.max(
  25,
  exponential *
  0.2,
  ),
  ),
  );

return Math.min(
maximum,
exponential + jitter,
);
}

/**

* Promise-based delay.
  */
  function delay(
  milliseconds,
  ) {
  return new Promise(
  (resolve) => {
  setTimeout(
  resolve,
  milliseconds,
  );
  },
  );
  }

/**

* Determines whether an HTTP status is retryable.
  */
  function isRetryableStatus(
  status,
  ) {
  const numericStatus =
  Number(status);

return (
numericStatus ===
408 ||
numericStatus ===
425 ||
numericStatus ===
429 ||
numericStatus >=
500
);
}

/**

* Determines whether an error is retryable.
  */
  function isRetryableError(
  error,
  ) {
  if (!error) {
  return true;
  }

if (
isRetryableStatus(
error.status,
)
) {
return true;
}

if (
isRetryableStatus(
error.response?.status,
)
) {
return true;
}

/**

* Network errors generally have no HTTP status.
  */
  return !(
  error.response ||
  error.status
  );
  }

/**

* Performs a best-effort deep clone.
  */
  function clonePayload(
  payload,
  ) {
  if (
  payload === null ||
  payload === undefined
  ) {
  return payload;
  }

try {
if (
typeof structuredClone ===
'function'
) {
return structuredClone(
payload,
);
}
} catch {
// Fall through.
}

return JSON.parse(
JSON.stringify(
payload,
),
);
}

/* ============================================================================

* API CLIENT ADAPTER
* ========================================================================== */

/**

* Sends an audit batch through a configured client.
*
* Supported clients:
*
* Axios-style:
* client.post(url, payload, config)
*
* Fetch-style:
* client(url, options)
*
* Custom:
* client.postAuditEvents(payload)
  */
  async function sendBatch(
  events,
  ) {
  if (
  !configuredApiClient
  ) {
  return {
  skipped: true,
  reason:
  'API client not configured.',
  events,
  };
  }

const payload =
Object.freeze({
service:
SERVICE_NAME,


  serviceVersion:
    SERVICE_VERSION,

  eventVersion:
    DEFAULT_EVENT_VERSION,

  sentAt:
    nowIso(),

  events:
    clonePayload(
      events,
    ),
});


const client =
configuredApiClient;

if (
typeof client
.postAuditEvents ===
'function'
) {
return client.postAuditEvents(
payload,
);
}

if (
typeof client.post ===
'function'
) {
return client.post(
configuredEndpoint,
payload,
{
headers: {
'X-TITech-Audit-Version':
SERVICE_VERSION,
},
},
);
}

if (
typeof client ===
'function'
) {
return client(
configuredEndpoint,
{
method:
'POST',


    headers: {
      'Content-Type':
        'application/json',

      'X-TITech-Audit-Version':
        SERVICE_VERSION,
    },

    body:
      JSON.stringify(
        payload,
      ),
  },
);


}

throw new Error(
'Unsupported TITech announcement audit API client.',
);
}

/* ============================================================================

* CONFIGURATION
* ========================================================================== */

/**

* Configure the service.
*
* Example:
*
* configureAnnouncementAuditService({
* apiClient: api,
* endpoint: '/api/announcements/audit',
* });
  */
  export function configureAnnouncementAuditService(
  options = {},
  ) {
  const {
  apiClient = null,

  endpoint =
  '/api/announcements/audit',

  maxQueueSize =
  DEFAULT_MAX_QUEUE_SIZE,

  batchSize =
  DEFAULT_BATCH_SIZE,

  retryAttempts =
  DEFAULT_RETRY_ATTEMPTS,

  retryBaseDelayMs =
  DEFAULT_RETRY_BASE_DELAY_MS,

  retryMaxDelayMs =
  DEFAULT_RETRY_MAX_DELAY_MS,

  flushIntervalMs =
  DEFAULT_FLUSH_INTERVAL_MS,

  autoFlush = true,
  } = options;

configuredApiClient =
apiClient;

configuredEndpoint =
safeString(
endpoint,
500,
) ||
'/api/announcements/audit';

configuredOptions =
Object.freeze({
maxQueueSize:
toPositiveInteger(
maxQueueSize,
DEFAULT_MAX_QUEUE_SIZE,
),


  batchSize:
    toPositiveInteger(
      batchSize,
      DEFAULT_BATCH_SIZE,
    ),

  retryAttempts:
    Math.max(
      0,
      Number.isFinite(
        Number(
          retryAttempts,
        ),
      )
        ? Math.floor(
            Number(
              retryAttempts,
            ),
          )
        : DEFAULT_RETRY_ATTEMPTS,
    ),

  retryBaseDelayMs:
    toPositiveInteger(
      retryBaseDelayMs,
      DEFAULT_RETRY_BASE_DELAY_MS,
    ),

  retryMaxDelayMs:
    toPositiveInteger(
      retryMaxDelayMs,
      DEFAULT_RETRY_MAX_DELAY_MS,
    ),

  flushIntervalMs:
    toPositiveInteger(
      flushIntervalMs,
      DEFAULT_FLUSH_INTERVAL_MS,
    ),

  autoFlush:
    Boolean(
      autoFlush,
    ),
});


if (
configuredOptions.autoFlush
) {
startAnnouncementAuditService();
}

return getAnnouncementAuditServiceStatus();
}

/* ============================================================================

* EVENT CREATION
* ========================================================================== */

/**

* Creates a normalized audit event without submitting it.
*
* This is useful for applications that need to inspect or batch events
* themselves.
  */
  export function createAnnouncementAuditEvent(
  {
  eventType,

  announcementId,

  announcementIds,

  source =
  ANNOUNCEMENT_AUDIT_SOURCES.UNKNOWN,

  actorId,

  tenantId,

  organizationId,

  correlationId,

  requestId,

  sessionId,

  route,

  metadata = {},

  timestamp,

  success = true,

  error,
  } = {},
  ) {
  const normalizedEventType =
  safeString(
  eventType,
  150,
  );

if (
!normalizedEventType
) {
throw new TypeError(
'eventType is required when creating a TITech announcement audit event.',
);
}

const normalizedAnnouncementId =
safeString(
announcementId,
200,
);

const normalizedAnnouncementIds =
Array.isArray(
announcementIds,
)
? announcementIds
.map((id) =>
safeString(
id,
200,
),
)
.filter(Boolean)
.slice(0, 100)
: undefined;

const event =
{
id:
generateId(
'titech-audit',
),


  eventType:
    normalizedEventType,

  eventVersion:
    DEFAULT_EVENT_VERSION,

  service:
    SERVICE_NAME,

  serviceVersion:
    SERVICE_VERSION,

  timestamp:
    timestamp ||
    nowIso(),

  source:
    safeString(
      source,
      100,
    ) ||
    ANNOUNCEMENT_AUDIT_SOURCES.UNKNOWN,

  announcementId:
    normalizedAnnouncementId,

  announcementIds:
    normalizedAnnouncementIds,

  actorId:
    safeString(
      actorId,
      200,
    ),

  tenantId:
    safeString(
      tenantId,
      200,
    ),

  organizationId:
    safeString(
      organizationId,
      200,
    ),

  correlationId:
    safeString(
      correlationId,
      200,
    ) ||
    generateId(
      'titech-correlation',
    ),

  requestId:
    safeString(
      requestId,
      200,
    ) ||
    generateId(
      'titech-request',
    ),

  sessionId:
    safeString(
      sessionId,
      200,
    ),

  route:
    safeString(
      route,
      500,
    ),

  success:
    Boolean(
      success,
    ),

  metadata:
    sanitizeMetadata(
      metadata,
    ),
};


if (error) {
event.error =
normalizeError(
error,
);
}

/**

* Remove undefined top-level properties while preserving a predictable
* event schema.
  */
  const normalized =
  Object.fromEntries(
  Object.entries(
  event,
  ).filter(
  ([, value]) =>
  value !==
  undefined,
  ),
  );

return Object.freeze(
normalized,
);
}

/* ============================================================================

* QUEUE MANAGEMENT
* ========================================================================== */

/**

* Adds an event to the local audit queue.
  */
  export function enqueueAnnouncementAuditEvent(
  event,
  ) {
  if (!event) {
  return {
  queued: false,
  reason:
  'No event supplied.',
  };
  }

const normalizedEvent =
Object.freeze(
clonePayload(
event,
),
);

queue.push(
normalizedEvent,
);

/**

* Protect the browser from unbounded audit growth during API outages.
*
* The oldest events are discarded when the queue exceeds the configured
* maximum. Authoritative compliance records must be maintained server-side.
  */
  if (
  queue.length >
  configuredOptions.maxQueueSize
  ) {
  const overflow =
  queue.length -
  configuredOptions.maxQueueSize;


queue.splice(



  0,
  overflow,
);


}

if (
queue.length >=
configuredOptions.batchSize
) {
void flushAnnouncementAuditQueue();
}

return {
queued: true,


queueSize:
  queue.length,

event:
  normalizedEvent,


};
}

/**

* Returns a snapshot of the queued events.
  */
  export function getQueuedAnnouncementAuditEvents() {
  return clonePayload(
  queue,
  );
  }

/**

* Returns the number of queued events.
  */
  export function getAnnouncementAuditQueueSize() {
  return queue.length;
  }

/**

* Clears queued audit events.
*
* Use carefully. This is mainly intended for controlled logout, teardown,
* tests and recovery procedures.
  */
  export function clearAnnouncementAuditQueue() {
  queue = [];

return {
cleared: true,
queueSize: 0,
};
}

/* ============================================================================

* EVENT RECORDING
* ========================================================================== */

/**

* Records a single announcement audit event.
  */
  export function recordAnnouncementAudit(
  eventData,
  ) {
  let event;

try {
event =
createAnnouncementAuditEvent(
eventData,
);
} catch (error) {
/**
* Audit instrumentation must not crash the announcement UI.
*/
return {
queued: false,


  failed: true,

  error:
    normalizeError(
      error,
    ),
};


}

const result =
enqueueAnnouncementAuditEvent(
event,
);

if (
configuredOptions.autoFlush &&
queue.length > 0
) {
void flushAnnouncementAuditQueue();
}

return result;
}

/**

* Records a successful event.
  */
  export function recordAnnouncementSuccess(
  eventType,
  options = {},
  ) {
  return recordAnnouncementAudit({
  ...options,

  eventType,

  success: true,
  });
  }

/**

* Records an unsuccessful event.
  */
  export function recordAnnouncementFailure(
  eventType,
  error,
  options = {},
  ) {
  return recordAnnouncementAudit({
  ...options,

  eventType,

  success: false,

  error,
  });
  }

/* ============================================================================

* COMMON EVENT HELPERS
* ========================================================================== */

export function recordAnnouncementViewed(
options = {},
) {
return recordAnnouncementSuccess(
ANNOUNCEMENT_AUDIT_EVENTS.VIEWED,
options,
);
}

export function recordAnnouncementOpened(
options = {},
) {
return recordAnnouncementSuccess(
ANNOUNCEMENT_AUDIT_EVENTS.OPENED,
options,
);
}

export function recordAnnouncementClosed(
options = {},
) {
return recordAnnouncementSuccess(
ANNOUNCEMENT_AUDIT_EVENTS.CLOSED,
options,
);
}

export function recordAnnouncementClicked(
options = {},
) {
return recordAnnouncementSuccess(
ANNOUNCEMENT_AUDIT_EVENTS.CLICKED,
options,
);
}

export function recordAnnouncementMarkedRead(
options = {},
) {
return recordAnnouncementSuccess(
ANNOUNCEMENT_AUDIT_EVENTS.MARKED_READ,
options,
);
}

export function recordAnnouncementMarkedUnread(
options = {},
) {
return recordAnnouncementSuccess(
ANNOUNCEMENT_AUDIT_EVENTS.MARKED_UNREAD,
options,
);
}

export function recordAnnouncementDismissed(
options = {},
) {
return recordAnnouncementSuccess(
ANNOUNCEMENT_AUDIT_EVENTS.DISMISSED,
options,
);
}

export function recordAnnouncementPublished(
options = {},
) {
return recordAnnouncementSuccess(
ANNOUNCEMENT_AUDIT_EVENTS.PUBLISHED,
options,
);
}

export function recordAnnouncementUnpublished(
options = {},
) {
return recordAnnouncementSuccess(
ANNOUNCEMENT_AUDIT_EVENTS.UNPUBLISHED,
options,
);
}

export function recordAnnouncementPinned(
options = {},
) {
return recordAnnouncementSuccess(
ANNOUNCEMENT_AUDIT_EVENTS.PINNED,
options,
);
}

export function recordAnnouncementUnpinned(
options = {},
) {
return recordAnnouncementSuccess(
ANNOUNCEMENT_AUDIT_EVENTS.UNPINNED,
options,
);
}

/* ============================================================================

* FLUSH
* ========================================================================== */

/**

* Flushes one or more queued events.
*
* The function is deliberately fail-safe:
*
* primary announcement operation
* ```
       |
  ```
* ```
       +----> audit submission
  ```
* ```
                  |
  ```
* ```
                  +---- failure
  ```
* ```
                        |
  ```
* ```
                        +---- queue retained
  ```
*
* Audit infrastructure must not take down the user-facing chat experience.
  */
  export async function flushAnnouncementAuditQueue() {
  if (
  isFlushing ||
  queue.length === 0
  ) {
  return {
  flushed: false,

  reason:
  isFlushing
  ? 'Flush already in progress.'
  : 'Audit queue is empty.',

  queueSize:
  queue.length,
  };
  }

isFlushing = true;

const eventsToFlush =
queue.splice(
0,
configuredOptions.batchSize,
);

try {
let lastError =
null;


const attempts =
  configuredOptions.retryAttempts +
  1;

for (
  let attempt = 1;
  attempt <= attempts;
  attempt += 1
) {
  try {
    const response =
      await sendBatch(
        eventsToFlush,
      );

    isFlushing = false;

    /**
     * If no API client has been configured, retain events rather than
     * silently claiming successful delivery.
     */
    if (
      response?.skipped
    ) {
      queue.unshift(
        ...eventsToFlush,
      );

      return {
        flushed: false,

        skipped: true,

        queueSize:
          queue.length,

        reason:
          response.reason,
      };
    }

    return {
      flushed: true,

      count:
        eventsToFlush.length,

      queueSize:
        queue.length,

      response,
    };
  } catch (error) {
    lastError =
      error;

    const canRetry =
      attempt <
        attempts &&
      isRetryableError(
        error,
      );

    if (!canRetry) {
      break;
    }

    await delay(
      calculateRetryDelay(
        attempt,
        configuredOptions.retryBaseDelayMs,
        configuredOptions.retryMaxDelayMs,
      ),
    );
  }
}

/**
 * Preserve failed events for a later retry.
 */
queue.unshift(
  ...eventsToFlush,
);

/**
 * Re-apply the queue limit after reinsertion.
 */
if (
  queue.length >
  configuredOptions.maxQueueSize
) {
  queue =
    queue.slice(
      queue.length -
        configuredOptions.maxQueueSize,
    );
}

return {
  flushed: false,

  failed: true,

  count:
    eventsToFlush.length,

  queueSize:
    queue.length,

  error:
    normalizeError(
      lastError,
    ),
};


} finally {
isFlushing = false;
}
}

/**

* Force-flushes the queue and returns a useful operational result.
  */
  export async function flushAllAnnouncementAuditEvents() {
  const results =
  [];

let safetyCounter =
0;

while (
queue.length > 0 &&
safetyCounter < 100
) {
safetyCounter += 1;


const result =
  await flushAnnouncementAuditQueue();

results.push(
  result,
);

if (
  result.failed ||
  result.skipped ||
  !result.flushed
) {
  break;
}


}

return {
results,


queueSize:
  queue.length,

complete:
  queue.length === 0,


};
}

/* ============================================================================

* SERVICE LIFECYCLE
* ========================================================================== */

/**

* Starts automatic audit flushing.
  */
  export function startAnnouncementAuditService() {
  if (
  initialized &&
  flushTimer
  ) {
  return getAnnouncementAuditServiceStatus();
  }

initialized =
true;

if (
isBrowser() &&
!browserListenersRegistered
) {
window.addEventListener(
'online',
handleBrowserOnline,
);


document.addEventListener(
  'visibilitychange',
  handleVisibilityChange,
);

window.addEventListener(
  'pagehide',
  handlePageHide,
);

browserListenersRegistered =
  true;


}

if (
typeof setInterval ===
'function'
) {
flushTimer =
setInterval(
() => {
if (
queue.length > 0
) {
void flushAnnouncementAuditQueue();
}
},
configuredOptions.flushIntervalMs ||
DEFAULT_FLUSH_INTERVAL_MS,
);
}

return getAnnouncementAuditServiceStatus();
}

/**

* Stops automatic audit flushing.
*
* Queued events are intentionally preserved.
  */
  export function stopAnnouncementAuditService() {
  if (flushTimer) {
  clearInterval(
  flushTimer,
  );

  flushTimer =
  null;
  }

if (
isBrowser() &&
browserListenersRegistered
) {
window.removeEventListener(
'online',
handleBrowserOnline,
);


document.removeEventListener(
  'visibilitychange',
  handleVisibilityChange,
);

window.removeEventListener(
  'pagehide',
  handlePageHide,
);

browserListenersRegistered =
  false;


}

initialized =
false;

return getAnnouncementAuditServiceStatus();
}

/**

* Browser comes back online.
  */
  function handleBrowserOnline() {
  if (
  queue.length > 0
  ) {
  void flushAnnouncementAuditQueue();
  }
  }

/**

* Flush when the document becomes visible again.
  */
  function handleVisibilityChange() {
  if (
  document.visibilityState ===
  'visible' &&
  queue.length > 0
  ) {
  void flushAnnouncementAuditQueue();
  }
  }

/**

* Best-effort lifecycle flush.
*
* Important:
* Do not use unload-specific synchronous XHR here. sendBeacon is used when
* possible, but the authoritative retry path remains the normal queue.
  */
  function handlePageHide() {
  void flushAnnouncementAuditQueue();
  }

/* ============================================================================

* BEACON SUPPORT
* ========================================================================== */

/**

* Best-effort low-latency delivery for page lifecycle events.
*
* Returns false when Beacon API is unavailable.
  */
  export function sendAnnouncementAuditBeacon(
  events,
  ) {
  if (
  !isBrowser() ||
  !navigator.sendBeacon ||
  !configuredEndpoint
  ) {
  return false;
  }

if (
!Array.isArray(events) ||
events.length === 0
) {
return false;
}

try {
const payload =
JSON.stringify({
service:
SERVICE_NAME,


    serviceVersion:
      SERVICE_VERSION,

    eventVersion:
      DEFAULT_EVENT_VERSION,

    sentAt:
      nowIso(),

    events:
      clonePayload(
        events,
      ),
  });

const blob =
  new Blob(
    [payload],
    {
      type:
        'application/json',
    },
  );

return navigator.sendBeacon(
  configuredEndpoint,
  blob,
);


} catch {
return false;
}
}

/* ============================================================================

* STATUS / DIAGNOSTICS
* ========================================================================== */

/**

* Returns a safe service status object.
*
* No credentials or sensitive configuration is returned.
  */
  export function getAnnouncementAuditServiceStatus() {
  return Object.freeze({
  service:
  SERVICE_NAME,

  version:
  SERVICE_VERSION,

  initialized,

  isFlushing,

  configured:
  Boolean(
  configuredApiClient,
  ),

  endpointConfigured:
  Boolean(
  configuredEndpoint,
  ),

  queueSize:
  queue.length,

  maxQueueSize:
  configuredOptions.maxQueueSize ||
  DEFAULT_MAX_QUEUE_SIZE,

  batchSize:
  configuredOptions.batchSize ||
  DEFAULT_BATCH_SIZE,

  retryAttempts:
  configuredOptions.retryAttempts ??
  DEFAULT_RETRY_ATTEMPTS,

  autoFlush:
  Boolean(
  configuredOptions.autoFlush,
  ),
  });
  }

/**

* Destroys the service runtime.
*
* This does not mutate any backend state.
  */
  export function destroyAnnouncementAuditService({
  clearQueue = false,
  } = {}) {
  stopAnnouncementAuditService();

configuredApiClient =
null;

configuredEndpoint =
'/api/announcements/audit';

configuredOptions =
Object.freeze({});

if (clearQueue) {
queue = [];
}

isFlushing =
false;

return getAnnouncementAuditServiceStatus();
}

/* ============================================================================

* DEFAULT EXPORT
* ========================================================================== */

const announcementAuditService =
Object.freeze({
configure:
configureAnnouncementAuditService,


createEvent:
  createAnnouncementAuditEvent,

record:
  recordAnnouncementAudit,

recordSuccess:
  recordAnnouncementSuccess,

recordFailure:
  recordAnnouncementFailure,

recordViewed:
  recordAnnouncementViewed,

recordOpened:
  recordAnnouncementOpened,

recordClosed:
  recordAnnouncementClosed,

recordClicked:
  recordAnnouncementClicked,

recordMarkedRead:
  recordAnnouncementMarkedRead,

recordMarkedUnread:
  recordAnnouncementMarkedUnread,

recordDismissed:
  recordAnnouncementDismissed,

recordPublished:
  recordAnnouncementPublished,

recordUnpublished:
  recordAnnouncementUnpublished,

recordPinned:
  recordAnnouncementPinned,

recordUnpinned:
  recordAnnouncementUnpinned,

enqueue:
  enqueueAnnouncementAuditEvent,

flush:
  flushAnnouncementAuditQueue,

flushAll:
  flushAllAnnouncementAuditEvents,

sendBeacon:
  sendAnnouncementAuditBeacon,

getQueue:
  getQueuedAnnouncementAuditEvents,

getQueueSize:
  getAnnouncementAuditQueueSize,

clearQueue:
  clearAnnouncementAuditQueue,

start:
  startAnnouncementAuditService,

stop:
  stopAnnouncementAuditService,

status:
  getAnnouncementAuditServiceStatus,

destroy:
  destroyAnnouncementAuditService,


});

export default announcementAuditService;

/* ============================================================================

* NOTES FOR INTEGRATION
* ============================================================================
*
* Example:
*
* import api from '../../services/api';
*
* import {
* configureAnnouncementAuditService,
* recordAnnouncementOpened,
* } from './announcementAuditService';
*
* configureAnnouncementAuditService({
* apiClient: api,
* endpoint: '/api/announcements/audit',
* });
*
* recordAnnouncementOpened({
* announcementId: announcement.id,
* source:
* ```
  ANNOUNCEMENT_AUDIT_SOURCES.ANNOUNCEMENT_DRAWER,
  ```
* metadata: {
* ```
  category: announcement.category,
  ```
* },
* });
*
* ============================================================================
*
* IMPORTANT ARCHITECTURAL RULE:
*
* The frontend audit service should supplement, not replace, authoritative
* server-side audit logging.
*
* For TITech financial and community-finance operations, server-side audit
* records should remain authoritative for:
*
* * financial transactions
* * member/account changes
* * role/permission changes
* * KYC/identity operations
* * administrative actions
* * security events
* * regulatory records
*
* Announcement audit events are primarily intended to provide:
*
* * UX telemetry
* * announcement interaction history
* * operational diagnostics
* * notification engagement information
* * trace/correlation context
*
* ============================================================================
  */