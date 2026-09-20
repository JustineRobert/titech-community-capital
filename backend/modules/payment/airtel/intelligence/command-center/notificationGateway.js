/**
 * TITech Community Capital
 * File: backend/modules/payment/airtel/intelligence/command-center/notificationGateway.js
 *
 * Architectural role
 * ------------------
 * Enterprise outbound-notification boundary for the Airtel payment-intelligence
 * command center. Converts authorized operational events into bounded notification
 * envelopes and delegates delivery to explicitly injected transport adapters.
 *
 * Important boundaries / non-responsibilities
 * --------------------------------------------
 * - NOT the financial source of truth, ledger, balance service, or settlement service.
 * - NOT an Airtel payment/provider execution adapter.
 * - NOT a notification policy engine and never decides that a business event must
 *   be notified without an explicit caller request.
 * - NOT an approval/maker-checker engine and never grants approval or authorization.
 * - NOT a compliance, AML, KYC, sanctions, fraud, risk, prediction or governance engine.
 * - NOT a template execution engine and never evaluates arbitrary code or expressions.
 * - NOT a queue worker. Queue/scheduler ownership belongs to application infrastructure.
 * - NOT responsible for financial state mutation, balance mutation, ledger mutation,
 *   settlement, payment execution, provider calls, or customer-record mutation.
 * - Transport credentials are owned by the injected transport adapters, never by this file.
 * - Delivery success means the selected transport accepted the message; it is not proof
 *   of final recipient delivery unless the transport contract explicitly says so.
 *
 * Production principles
 * ---------------------
 * - Airtel provider scope is fail-closed.
 * - Tenant scope is explicit and tenant identifiers are never returned raw.
 * - Recipient addresses/identifiers are treated as sensitive delivery data and are never
 *   written to logs, metrics, history, or error payloads in raw form.
 * - Secret/authentication material and raw provider payloads are never emitted.
 * - Notification bodies are not persisted by default; a content fingerprint is used instead.
 * - Channels and transports are allow-listed. No arbitrary method invocation exists.
 * - Payload size, recipient count, batch size, transport count, retries and timeouts are bounded.
 * - Idempotency is tenant scoped and conflicts fail closed.
 * - Duplicate suppression may be enabled through a durable injected repository.
 * - Retry behavior is bounded and transport adapters remain responsible for their own
 *   protocol-specific semantics.
 * - Dry-run mode never calls a transport.
 * - Returned records are normalized, redacted and deeply frozen.
 * - Persistence is injected; no database dependency is hard-coded here.
 * - No internal scheduler is created.
 *
 * Module format
 * -------------
 * - Native ECMAScript module (ESM).
 * - Node.js built-ins only.
 */

import { createHash } from 'node:crypto';

export const ENGINE_NAME = 'airtel-command-center-notification-gateway';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const SCHEMA_VERSION = 1;
export const HASH_ALGORITHM = 'sha256';

export const NOTIFICATION_CHANNELS = Object.freeze({
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  PUSH: 'PUSH',
  WEBHOOK: 'WEBHOOK',
  IN_APP: 'IN_APP',
});

export const NOTIFICATION_STATUS = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
  SKIPPED: 'SKIPPED',
  DRY_RUN: 'DRY_RUN',
  DUPLICATE: 'DUPLICATE',
  INDETERMINATE: 'INDETERMINATE',
});

export const NOTIFICATION_PRIORITIES = Object.freeze({
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const NOTIFICATION_MODES = Object.freeze({
  LIVE: 'LIVE',
  DRY_RUN: 'DRY_RUN',
});

export const TRANSPORT_STATES = Object.freeze({
  READY: 'READY',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
  UNKNOWN: 'UNKNOWN',
});

export const DELIVERY_SEMANTICS = Object.freeze({
  ACCEPTED_BY_TRANSPORT: 'ACCEPTED_BY_TRANSPORT',
  FINAL_DELIVERY_CONFIRMED: 'FINAL_DELIVERY_CONFIRMED',
  DELIVERY_UNKNOWN: 'DELIVERY_UNKNOWN',
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'NOTIFICATION_GATEWAY_INVALID_INPUT',
  TENANT_REQUIRED: 'NOTIFICATION_GATEWAY_TENANT_REQUIRED',
  SYSTEM_SCOPE_FORBIDDEN: 'NOTIFICATION_GATEWAY_SYSTEM_SCOPE_FORBIDDEN',
  PROVIDER_SCOPE_VIOLATION: 'NOTIFICATION_GATEWAY_PROVIDER_SCOPE_VIOLATION',
  CHANNEL_UNSUPPORTED: 'NOTIFICATION_GATEWAY_CHANNEL_UNSUPPORTED',
  TRANSPORT_NOT_CONFIGURED: 'NOTIFICATION_GATEWAY_TRANSPORT_NOT_CONFIGURED',
  TRANSPORT_UNAVAILABLE: 'NOTIFICATION_GATEWAY_TRANSPORT_UNAVAILABLE',
  TRANSPORT_PROTOCOL_ERROR: 'NOTIFICATION_GATEWAY_TRANSPORT_PROTOCOL_ERROR',
  TRANSPORT_UNSAFE: 'NOTIFICATION_GATEWAY_TRANSPORT_UNSAFE',
  TIMEOUT: 'NOTIFICATION_GATEWAY_TIMEOUT',
  RECIPIENT_REQUIRED: 'NOTIFICATION_GATEWAY_RECIPIENT_REQUIRED',
  TOO_MANY_RECIPIENTS: 'NOTIFICATION_GATEWAY_TOO_MANY_RECIPIENTS',
  TOO_MANY_NOTIFICATIONS: 'NOTIFICATION_GATEWAY_TOO_MANY_NOTIFICATIONS',
  PAYLOAD_TOO_LARGE: 'NOTIFICATION_GATEWAY_PAYLOAD_TOO_LARGE',
  EXPORT_TOO_LARGE: 'NOTIFICATION_GATEWAY_EXPORT_TOO_LARGE',
  IDEMPOTENCY_CONFLICT: 'NOTIFICATION_GATEWAY_IDEMPOTENCY_CONFLICT',
  DUPLICATE: 'NOTIFICATION_GATEWAY_DUPLICATE',
  RATE_LIMITED: 'NOTIFICATION_GATEWAY_RATE_LIMITED',
  CONTENT_BLOCKED: 'NOTIFICATION_GATEWAY_CONTENT_BLOCKED',
  RETRY_EXHAUSTED: 'NOTIFICATION_GATEWAY_RETRY_EXHAUSTED',
  REPOSITORY_REQUIRED: 'NOTIFICATION_GATEWAY_REPOSITORY_REQUIRED',
  PERSISTENCE_FAILED: 'NOTIFICATION_GATEWAY_PERSISTENCE_FAILED',
});

export const NOTIFICATION_SAFETY_FLAGS = Object.freeze({
  financialMutationPerformed: 'financialMutationPerformed',
  ledgerMutationPerformed: 'ledgerMutationPerformed',
  balanceMutationPerformed: 'balanceMutationPerformed',
  providerCallPerformed: 'providerCallPerformed',
  paymentExecutionPerformed: 'paymentExecutionPerformed',
  settlementPerformed: 'settlementPerformed',
  approvalGranted: 'approvalGranted',
  executionAuthorized: 'executionAuthorized',
  arbitraryCodeExecutionPerformed: 'arbitraryCodeExecutionPerformed',
});

const DEFAULT_CONFIG = Object.freeze({
  provider: PROVIDER,
  tenantRequired: true,
  allowSystemScope: true,
  maxTenantIdLength: 160,
  maxSubjectLength: 240,
  maxBodyLength: 120_000,
  maxTemplateDataBytes: 256 * 1024,
  maxEnvelopeBytes: 512 * 1024,
  maxRecipientsPerNotification: 50,
  maxNotificationsPerBatch: 100,
  maxTransports: 25,
  maxRetries: 2,
  defaultTimeoutMs: 5_000,
  maxTimeoutMs: 30_000,
  maxConcurrency: 8,
  maxHistoryLimit: 100,
  defaultHistoryLimit: 20,
  maxExportBytes: 4 * 1024 * 1024,
  persistNotifications: true,
  persistBody: false,
  requireRepository: false,
  failClosedOnTransportUnsafe: true,
  failClosedOnRequiredTransportFailure: true,
  suppressDuplicates: true,
  deduplicationWindowMs: 10 * 60 * 1000,
  retryBackoffMs: 250,
  maxRetryBackoffMs: 5_000,
  allowContentTypes: [
    'text/plain',
    'text/html',
    'application/json',
  ],
  channels: Object.freeze([
    ...Object.values(NOTIFICATION_CHANNELS),
  ]),
});

const SENSITIVE_KEY_PATTERNS = Object.freeze([
  /password/i,
  /passphrase/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /session/i,
  /otp/i,
  /pin/i,
  /cvv/i,
  /cvc/i,
  /pan/i,
  /private.?key/i,
  /api.?key/i,
  /access.?key/i,
  /credential/i,
  /signature/i,
  /raw.?payload/i,
  /raw.?request/i,
  /raw.?response/i,
]);

const IDENTIFIER_KEY_PATTERNS = Object.freeze([
  /^phone$/i,
  /phone(number)?/i,
  /msisdn/i,
  /email/i,
  /national.?id/i,
  /^nin$/i,
  /account(number)?/i,
  /bank.?account/i,
  /wallet(number|id)?/i,
  /customer(number|id)?/i,
  /device.?id/i,
  /tenant.?id/i,
  /user.?id/i,
  /actor.?id/i,
  /recipient/i,
]);

const FORBIDDEN_TRANSPORT_CAPABILITIES = Object.freeze([
  'financialMutation',
  'ledgerMutation',
  'balanceMutation',
  'paymentExecution',
  'settlement',
  'approvalGrant',
  'executionAuthorization',
  'arbitraryCodeExecution',
  'providerCall',
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;

  const prototype = Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function assertPlainObject(
  value,
  label = 'value',
) {
  if (!isPlainObject(value)) {
    throw new NotificationGatewayError(
      ERROR_CODES.INVALID_INPUT,
      `${label} must be a plain object.`,
    );
  }
}

function normalizeString(
  value,
  maxLength = 200,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return undefined;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function upper(
  value,
  maxLength = 80,
) {
  const normalized =
    normalizeString(
      value,
      maxLength,
    );

  return normalized
    ? normalized.toUpperCase()
    : undefined;
}

function integer(
  value,
  fallback,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(
      min,
      Math.trunc(number),
    ),
  );
}

function iso(
  value,
  fallback = undefined,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return fallback;
  }

  const date =
    value instanceof Date
      ? new Date(
          value.getTime(),
        )
      : new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? fallback
    : date.toISOString();
}

function nowFrom(
  clock,
) {
  return iso(
    typeof clock === 'function'
      ? clock()
      : new Date(),
    new Date().toISOString(),
  );
}

function digest(
  value,
) {
  return `sha256:${createHash('sha256')
    .update(
      String(
        value ?? '',
      ),
      'utf8',
    )
    .digest('hex')}`;
}

function stableNormalize(
  value,
  seen = new WeakSet(),
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value ===
    'number'
  ) {
    if (
      Number.isNaN(
        value,
      )
    ) {
      return '[NaN]';
    }

    if (
      !Number.isFinite(
        value,
      )
    ) {
      return value > 0
        ? '[Infinity]'
        : '[-Infinity]';
    }

    return Object.is(
      value,
      -0,
    )
      ? 0
      : value;
  }

  if (
    typeof value ===
    'bigint'
  ) {
    return `${value}n`;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (
    value instanceof Date
  ) {
    return iso(
      value,
      null,
    );
  }

  if (
    Buffer.isBuffer(
      value,
    )
  ) {
    return `buffer:${digest(
      value.toString(
        'base64',
      ),
    )}`;
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return value.map(
      (item) =>
        stableNormalize(
          item,
          seen,
        ),
    );
  }

  if (
    typeof value !==
    'object'
  ) {
    return String(value);
  }

  if (
    seen.has(
      value,
    )
  ) {
    return '[Circular]';
  }

  seen.add(
    value,
  );

  const output = {};

  for (
    const key of
    Object.keys(
      value,
    ).sort()
  ) {
    output[key] =
      stableNormalize(
        value[key],
        seen,
      );
  }

  seen.delete(
    value,
  );

  return output;
}

function stableStringify(
  value,
) {
  return JSON.stringify(
    stableNormalize(
      value,
    ),
  );
}

function sha256(
  value,
) {
  return createHash(
    HASH_ALGORITHM,
  )
    .update(
      stableStringify(
        value,
      ),
      'utf8',
    )
    .digest('hex');
}

function safeBytes(
  value,
) {
  return Buffer.byteLength(
    JSON.stringify(
      value,
    ),
    'utf8',
  );
}

function deepFreeze(
  value,
  seen = new WeakSet(),
) {
  if (
    value === null ||
    typeof value !==
      'object' ||
    seen.has(value)
  ) {
    return value;
  }

  seen.add(
    value,
  );

  for (
    const key of
    Reflect.ownKeys(
      value,
    )
  ) {
    deepFreeze(
      value[key],
      seen,
    );
  }

  return Object.freeze(
    value,
  );
}

function redact(
  value,
  options = {},
  seen = new WeakMap(),
) {
  const maxArrayItems =
    options.maxArrayItems ??
    100;

  const maxObjectKeys =
    options.maxObjectKeys ??
    100;

  const maxStringLength =
    options.maxStringLength ??
    4_000;

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
    return value.length > maxStringLength
      ? value.slice(
          0,
          maxStringLength,
        )
      : value;
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
    typeof value ===
    'bigint'
  ) {
    return `${value}n`;
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    Buffer.isBuffer(
      value,
    )
  ) {
    return `[REDACTED_BUFFER:${digest(
      value.toString(
        'base64',
      ),
    ).slice(-16)}]`;
  }

  if (
    typeof value !==
    'object'
  ) {
    return String(value);
  }

  if (
    seen.has(value)
  ) {
    return '[Circular]';
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    seen.set(
      value,
      true,
    );

    const output =
      value
        .slice(
          0,
          maxArrayItems,
        )
        .map(
          (item) =>
            redact(
              item,
              options,
              seen,
            ),
        );

    if (
      value.length >
      maxArrayItems
    ) {
      output.push(
        `[TRUNCATED:${value.length - maxArrayItems}]`,
      );
    }

    seen.delete(
      value,
    );

    return output;
  }

  seen.set(
    value,
    true,
  );

  const output = {};

  const keys =
    Object.keys(
      value,
    )
      .sort()
      .slice(
        0,
        maxObjectKeys,
      );

  for (
    const key of
    keys
  ) {
    if (
      SENSITIVE_KEY_PATTERNS.some(
        (pattern) =>
          pattern.test(
            key,
          ),
      )
    ) {
      output[key] =
        '[REDACTED]';

      continue;
    }

    if (
      IDENTIFIER_KEY_PATTERNS.some(
        (pattern) =>
          pattern.test(
            key,
          ),
      )
    ) {
      const identifier =
        normalizeString(
          value[key],
          800,
        );

      output[key] =
        identifier
          ? digest(
              identifier,
            )
          : undefined;

      continue;
    }

    output[key] =
      redact(
        value[key],
        options,
        seen,
      );
  }

  if (
    Object.keys(
      value,
    ).length >
    keys.length
  ) {
    output.__truncatedKeys =
      Object.keys(
        value,
      ).length -
      keys.length;
  }

  seen.delete(
    value,
  );

  return output;
}

function safeError(
  error,
) {
  if (!error) return null;

  return redact({
    name:
      normalizeString(
        error.name,
        120,
      ) ??
      'Error',

    code:
      normalizeString(
        error.code,
        160,
      ) ??
      null,

    message:
      normalizeString(
        error.message,
        500,
      ) ??
      'Unknown error',
  });
}

function validateProviderScope(
  provider,
) {
  return (
    upper(
      provider,
      80,
    ) ===
    PROVIDER
  );
}

function timeoutPromise(
  promiseOrValue,
  timeoutMs,
) {
  const value =
    promiseOrValue &&
    typeof promiseOrValue.then ===
      'function'
      ? promiseOrValue
      : Promise.resolve(
          promiseOrValue,
        );

  let timer;

  return new Promise(
    (
      resolve,
      reject,
    ) => {
      timer =
        setTimeout(
          () => {
            reject(
              new NotificationGatewayError(
                ERROR_CODES.TIMEOUT,
                `Notification transport operation timed out after ${timeoutMs} ms.`,
              ),
            );
          },
          timeoutMs,
        );

      if (
        typeof timer.unref ===
        'function'
      ) {
        timer.unref();
      }

      value.then(
        (
          result,
        ) => {
          clearTimeout(
            timer,
          );

          resolve(
            result,
          );
        },

        (
          error,
        ) => {
          clearTimeout(
            timer,
          );

          reject(
            error,
          );
        },
      );
    },
  );
}

function mergeConfig(
  base,
  override,
) {
  return Object.freeze({
    ...base,

    ...(isPlainObject(
      override,
    )
      ? override
      : {}),
  });
}

function normalizeScope(
  input,
  config,
) {
  const scope =
    upper(
      input.scope ??
        'TENANT',
      40,
    ) ??
    'TENANT';

  if (
    scope ===
    'SYSTEM'
  ) {
    if (
      !config.allowSystemScope
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.SYSTEM_SCOPE_FORBIDDEN,
        'System notification scope is disabled.',
      );
    }

    return {
      scope:
        'SYSTEM',

      tenantId:
        null,

      tenantScope:
        'SYSTEM',
    };
  }

  const tenantId =
    normalizeString(
      input.tenantId,
      config.maxTenantIdLength,
    );

  if (
    config.tenantRequired &&
    !tenantId
  ) {
    throw new NotificationGatewayError(
      ERROR_CODES.TENANT_REQUIRED,
      'tenantId is required for tenant-scoped notification delivery.',
      {},
      {
        httpStatus:
          400,
      },
    );
  }

  return {
    scope:
      'TENANT',

    tenantId:
      tenantId ??
      null,

    tenantScope:
      tenantId
        ? digest(
            tenantId,
          )
        : 'TENANT:UNSPECIFIED',
  };
}

function normalizeChannel(
  value,
  config,
) {
  const channel =
    upper(
      value,
      40,
    );

  if (
    !channel ||
    !config.channels.includes(
      channel,
    )
  ) {
    throw new NotificationGatewayError(
      ERROR_CODES.CHANNEL_UNSUPPORTED,
      `Unsupported notification channel ${channel ?? '[missing]'}.`,
    );
  }

  return channel;
}

function normalizePriority(
  value,
) {
  const priority =
    upper(
      value ??
        NOTIFICATION_PRIORITIES.NORMAL,
      30,
    );

  return Object.values(
    NOTIFICATION_PRIORITIES,
  ).includes(
    priority,
  )
    ? priority
    : NOTIFICATION_PRIORITIES.NORMAL;
}

function normalizeContentType(
  value,
  config,
) {
  const contentType =
    normalizeString(
      value ??
        'text/plain',
      120,
    )?.toLowerCase();

  if (
    !config.allowContentTypes.includes(
      contentType,
    )
  ) {
    throw new NotificationGatewayError(
      ERROR_CODES.CONTENT_BLOCKED,
      `Content type ${contentType} is not permitted.`,
    );
  }

  return contentType;
}

function normalizeRecipients(
  value,
  maxRecipients,
) {
  const raw =
    Array.isArray(value)
      ? value
      : [value];

  const recipients =
    raw
      .map(
        (item) =>
          normalizeString(
            item,
            800,
          ),
      )
      .filter(Boolean);

  if (
    recipients.length ===
    0
  ) {
    throw new NotificationGatewayError(
      ERROR_CODES.RECIPIENT_REQUIRED,
      'At least one notification recipient is required.',
    );
  }

  if (
    recipients.length >
    maxRecipients
  ) {
    throw new NotificationGatewayError(
      ERROR_CODES.TOO_MANY_RECIPIENTS,
      `A notification may target at most ${maxRecipients} recipients.`,
    );
  }

  return recipients;
}

function normalizeBody(
  value,
  maxLength,
) {
  if (
    value === null ||
    value === undefined
  ) {
    throw new NotificationGatewayError(
      ERROR_CODES.INVALID_INPUT,
      'Notification body is required.',
    );
  }

  const body =
    typeof value ===
    'string'
      ? value
      : JSON.stringify(value);

  if (
    !body ||
    !body.trim()
  ) {
    throw new NotificationGatewayError(
      ERROR_CODES.INVALID_INPUT,
      'Notification body must not be empty.',
    );
  }

  if (
    body.length >
    maxLength
  ) {
    throw new NotificationGatewayError(
      ERROR_CODES.PAYLOAD_TOO_LARGE,
      `Notification body exceeds ${maxLength} characters.`,
    );
  }

  return body;
}

function normalizeTransportResult(
  value,
) {
  if (
    !isPlainObject(
      value,
    )
  ) {
    return {
      accepted:
        false,

      delivered:
        false,

      deliverySemantics:
        DELIVERY_SEMANTICS.DELIVERY_UNKNOWN,

      providerMessageId:
        null,

      metadata:
        {},

      safety:
        {},
    };
  }

  const safety =
    value.safety ??
    value;

  const unsafeFlags =
    Object.values(
      NOTIFICATION_SAFETY_FLAGS,
    ).filter(
      (key) =>
        safety?.[
          key
        ] === true,
    );

  return {
    accepted:
      value.accepted ===
        true ||
      value.status ===
        'SENT' ||
      value.status ===
        'ACCEPTED',

    delivered:
      value.delivered ===
      true,

    deliverySemantics:
      value.delivered ===
      true
        ? DELIVERY_SEMANTICS.FINAL_DELIVERY_CONFIRMED
        : value.accepted ===
              true ||
            value.status ===
              'SENT' ||
            value.status ===
              'ACCEPTED'
          ? DELIVERY_SEMANTICS.ACCEPTED_BY_TRANSPORT
          : DELIVERY_SEMANTICS.DELIVERY_UNKNOWN,

    providerMessageId:
      normalizeString(
        value.providerMessageId ??
          value.messageId,
        240,
      ) ??
      null,

    metadata:
      redact(
        value.metadata ??
          {},
      ),

    safety: {
      unsafeFlags,
      readOnly:
        unsafeFlags.length ===
        0,
    },

    status:
      upper(
        value.status,
        40,
      ) ??
      null,
  };
}

function buildSemanticFingerprint(
  value,
) {
  const strip =
    (
      current,
      key = null,
    ) => {
      if (
        [
          'createdAt',
          'generatedAt',
          'startedAt',
          'completedAt',
          'runId',
          'notificationId',
          'providerMessageId',
          'transportAttempt',
          'retryCount',
          'durationMs',
          'replay',
          'persistence',
          'deliveryAt',
          'notificationFingerprint',
        ].includes(
          key,
        )
      ) {
        return undefined;
      }

      if (
        Array.isArray(
          current,
        )
      ) {
        return current
          .map(
            (item) =>
              strip(
                item,
              ),
          )
          .filter(
            (item) =>
              item !==
              undefined,
          );
      }

      if (
        isPlainObject(
          current,
        )
      ) {
        const output =
          {};

        for (
          const childKey of
          Object.keys(
            current,
          ).sort()
        ) {
          const child =
            strip(
              current[
                childKey
              ],
              childKey,
            );

          if (
            child !==
            undefined
          ) {
            output[
              childKey
            ] =
              child;
          }
        }

        return output;
      }

      return current;
    };

  return `sha256:${sha256(
    strip(
      value,
    ),
  )}`;
}

async function runWithConcurrency(
  items,
  worker,
  concurrency,
) {
  const results =
    new Array(
      items.length,
    );

  let nextIndex =
    0;

  async function consume() {
    while (true) {
      const index =
        nextIndex++;

      if (
        index >=
        items.length
      ) {
        return;
      }

      try {
        results[index] =
          await worker(
            items[index],
            index,
          );
      } catch (
        error
      ) {
        results[index] = {
          error,
        };
      }
    }
  }

  const workerCount =
    Math.min(
      Math.max(
        1,
        concurrency,
      ),
      items.length ||
        1,
    );

  await Promise.all(
    Array.from(
      {
        length:
          workerCount,
      },
      () =>
        consume(),
    ),
  );

  return results;
}

function sleep(
  ms,
) {
  return new Promise(
    (resolve) => {
      const timer =
        setTimeout(
          resolve,
          ms,
        );

      if (
        typeof timer.unref ===
        'function'
      ) {
        timer.unref();
      }
    },
  );
}

function backoffMs(
  base,
  max,
  attempt,
) {
  return Math.min(
    max,
    base *
      2 ** Math.max(
        0,
        attempt - 1,
      ),
  );
}

export class NotificationGatewayError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message);

    this.name =
      'NotificationGatewayError';

    this.code =
      code;

    this.details =
      redact(
        details,
      );

    this.cause =
      options.cause;

    this.statusCode =
      options.httpStatus ??
      500;
  }
}

export class InMemoryNotificationRepository {
  constructor(
    seed = {},
  ) {
    this.notifications =
      Array.isArray(
        seed.notifications,
      )
        ? seed.notifications.map(
            (item) =>
              redact(
                item,
              ),
          )
        : [];

    this.closed =
      false;
  }

  _assertOpen() {
    if (
      this.closed
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.PERSISTENCE_FAILED,
        'Notification repository is closed.',
      );
    }
  }

  async findByIdempotencyKey({
    tenantScope,
    idempotencyKey,
  } = {}) {
    this._assertOpen();

    return (
      this.notifications.find(
        (
          item,
        ) =>
          item.tenantScope ===
            tenantScope &&
          item.idempotencyKey ===
            idempotencyKey,
      ) ??
      null
    );
  }

  async findDuplicate({
    tenantScope,
    deduplicationFingerprint,
    cutoffAt,
  } = {}) {
    this._assertOpen();

    const cutoff =
      cutoffAt
        ? new Date(
            cutoffAt,
          ).getTime()
        : null;

    return (
      this.notifications.find(
        (
          item,
        ) => {
          if (
            item.tenantScope !==
            tenantScope
          ) {
            return false;
          }

          if (
            item.notificationFingerprint !==
            deduplicationFingerprint
          ) {
            return false;
          }

          if (
            !cutoff
          ) {
            return true;
          }

          const created =
            new Date(
              item.createdAt ??
                0,
            ).getTime();

          return (
            Number.isFinite(
              created,
            ) &&
            created >=
              cutoff
          );
        },
      ) ??
      null
    );
  }

  async saveNotification(
    record,
  ) {
    this._assertOpen();

    const normalized =
      redact(
        record,
      );

    const existing =
      normalized.idempotencyKey
        ? await this.findByIdempotencyKey(
            {
              tenantScope:
                normalized.tenantScope,

              idempotencyKey:
                normalized.idempotencyKey,
            },
          )
        : null;

    if (
      existing
    ) {
      if (
        existing.requestFingerprint !==
        normalized.requestFingerprint
      ) {
        throw new NotificationGatewayError(
          ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'Notification idempotency key maps to a different request.',
          {},
          {
            httpStatus:
              409,
          },
        );
      }

      return {
        record:
          existing,

        replay:
          true,
      };
    }

    this.notifications.push(
      normalized,
    );

    return {
      record:
        normalized,

      replay:
        false,
    };
  }

  async getNotification({
    tenantScope,
    notificationId,
  } = {}) {
    this._assertOpen();

    return (
      this.notifications.find(
        (
          item,
        ) =>
          item.tenantScope ===
            tenantScope &&
          item.notificationId ===
            notificationId,
      ) ??
      null
    );
  }

  async listNotifications({
    tenantScope,
    limit = 20,
    offset = 0,
  } = {}) {
    this._assertOpen();

    return this.notifications
      .filter(
        (
          item,
        ) =>
          item.tenantScope ===
          tenantScope,
      )
      .sort(
        (
          a,
          b,
        ) =>
          String(
            b.createdAt ??
              '',
          ).localeCompare(
            String(
              a.createdAt ??
                '',
            ),
          ),
      )
      .slice(
        offset,
        offset +
          limit,
      );
  }

  async healthCheck() {
    return {
      ok:
        !this.closed,

      state:
        this.closed
          ? TRANSPORT_STATES.UNAVAILABLE
          : TRANSPORT_STATES.READY,

      count:
        this.notifications.length,
    };
  }

  async close() {
    this.closed =
      true;
  }
}

export class InMemoryNotificationRateLimiter {
  constructor() {
    this.windows =
      new Map();
  }

  async consume(
    key,
    limit,
    windowMs,
    amount = 1,
    now = Date.now(),
  ) {
    const normalizedKey =
      String(
        key,
      );

    const current =
      this.windows.get(
        normalizedKey,
      );

    if (
      !current ||
      now -
        current.startedAt >=
        windowMs
    ) {
      this.windows.set(
        normalizedKey,
        {
          startedAt:
            now,

          count:
            amount,
        },
      );

      return {
        allowed:
          amount <=
          limit,

        remaining:
          Math.max(
            0,
            limit -
              amount,
          ),

        resetAt:
          now +
          windowMs,
      };
    }

    const next =
      current.count +
      amount;

    current.count =
      next;

    return {
      allowed:
        next <=
        limit,

      remaining:
        Math.max(
          0,
          limit -
            next,
        ),

      resetAt:
        current.startedAt +
        windowMs,
    };
  }

  async healthCheck() {
    return {
      ok:
        true,

      state:
        TRANSPORT_STATES.READY,

      keys:
        this.windows.size,
    };
  }

  async close() {
    this.windows.clear();
  }
}

export class NotificationGateway {
  constructor(
    options = {},
  ) {
    assertPlainObject(
      options,
      'options',
    );

    this.config =
      mergeConfig(
        DEFAULT_CONFIG,
        options.config,
      );

    if (
      !validateProviderScope(
        this.config.provider,
      )
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        `Notification gateway supports provider ${PROVIDER} only.`,
        {
          provider:
            this.config.provider,
        },
        {
          httpStatus:
            400,
        },
      );
    }

    this.repository =
      options.repository ??
      options.notificationRepository ??
      null;

    if (
      !this.repository &&
      this.config.requireRepository
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.REPOSITORY_REQUIRED,
        'A durable notification repository must be injected in production.',
      );
    }

    this.rateLimiter =
      options.rateLimiter ??
      null;

    this.logger =
      options.logger ??
      null;

    this.metrics =
      options.metrics ??
      null;

    this.clock =
      typeof options.clock ===
      'function'
        ? options.clock
        : () =>
            new Date();

    this.notificationIdFactory =
      typeof options.notificationIdFactory ===
      'function'
        ? options.notificationIdFactory
        : () =>
            `notification-${Date.now()}-${sha256(
              `${Date.now()}-${Math.random()}`,
            ).slice(
              0,
              20,
            )}`;

    this.transports =
      new Map();

    const configuredTransports =
      isPlainObject(
        options.transports,
      )
        ? options.transports
        : {};

    for (
      const [
        name,
        transport,
      ] of Object.entries(
        configuredTransports,
      )
    ) {
      this.registerTransport(
        name,
        transport,
      );
    }

    if (
      Array.isArray(
        options.transportDefinitions,
      )
    ) {
      for (
        const definition of
        options.transportDefinitions
      ) {
        this.registerTransport(
          definition.name,
          definition.transport,
          definition,
        );
      }
    }
  }

  _log(
    level,
    message,
    error = null,
    context = {},
  ) {
    if (
      !this.logger
    ) {
      return;
    }

    const payload =
      redact({
        component:
          COMPONENT,

        provider:
          PROVIDER,

        ...context,

        ...(error
          ? {
              error:
                safeError(
                  error,
                ),
            }
          : {}),
      });

    const fn =
      typeof this.logger[
        level
      ] ===
      'function'
        ? this.logger[
            level
          ]
        : typeof this.logger.info ===
          'function'
          ? this.logger.info
          : null;

    if (
      fn
    ) {
      try {
        fn.call(
          this.logger,
          payload,
          message,
        );
      } catch {
        /*
         * Logging must never alter notification behavior.
         */
      }
    }
  }

  _metric(
    name,
    labels = {},
    value = 1,
  ) {
    try {
      if (
        typeof this.metrics
          ?.increment ===
        'function'
      ) {
        this.metrics.increment(
          name,
          labels,
          value,
        );
      } else if (
        typeof this.metrics?.inc ===
        'function'
      ) {
        this.metrics.inc(
          name,
          labels,
          value,
        );
      }
    } catch (
      error
    ) {
      this._log(
        'warn',
        'Notification metric emission failed.',
        error,
        {
          metricName:
            name,
        },
      );
    }
  }

  registerTransport(
    name,
    transport,
    definition = {},
  ) {
    const normalizedName =
      normalizeString(
        name,
        120,
      );

    if (
      !normalizedName
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.INVALID_INPUT,
        'Transport name is required.',
      );
    }

    if (
      !transport ||
      typeof transport !==
        'object'
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.TRANSPORT_PROTOCOL_ERROR,
        `Transport ${normalizedName} must be an object.`,
      );
    }

    const channel =
      normalizeChannel(
        definition.channel ??
          transport.channel,
        this.config,
      );

    const sendMethod =
      typeof transport.send ===
      'function'
        ? 'send'
        : typeof transport.dispatch ===
          'function'
          ? 'dispatch'
          : typeof transport.deliver ===
            'function'
            ? 'deliver'
            : null;

    if (
      !sendMethod
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.TRANSPORT_PROTOCOL_ERROR,
        `Transport ${normalizedName} must implement send(), dispatch(), or deliver().`,
      );
    }

    const transportConfig =
      {
        name:
          normalizedName,

        channel,

        required:
          definition.required ===
          true,

        enabled:
          definition.enabled !==
          false,

        timeoutMs:
          integer(
            definition.timeoutMs,
            this.config
              .defaultTimeoutMs,
            1,
            this.config
              .maxTimeoutMs,
          ),

        maxRetries:
          integer(
            definition.maxRetries,
            this.config
              .maxRetries,
            0,
            this.config
              .maxRetries,
          ),

        capabilityInfo:
          isPlainObject(
            transport.capabilities,
          )
            ? redact(
                transport.capabilities,
              )
            : {},

        transport,

        sendMethod,
      };

    const unsafeCapabilities =
      FORBIDDEN_TRANSPORT_CAPABILITIES.filter(
        (
          capability,
        ) =>
          transportConfig
            .capabilityInfo[
              capability
            ] === true,
      );

    if (
      unsafeCapabilities.length >
        0 &&
      this.config
        .failClosedOnTransportUnsafe
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.TRANSPORT_UNSAFE,
        `Transport ${normalizedName} advertises forbidden financial/provider capabilities.`,
        {
          transport:
            normalizedName,

          unsafeCapabilities,
        },
      );
    }

    if (
      this.transports.has(
        normalizedName,
      )
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.INVALID_INPUT,
        `Transport ${normalizedName} is already registered.`,
      );
    }

    this.transports.set(
      normalizedName,
      transportConfig,
    );

    if (
      this.transports.size >
      this.config.maxTransports
    ) {
      this.transports.delete(
        normalizedName,
      );

      throw new NotificationGatewayError(
        ERROR_CODES.TOO_MANY_NOTIFICATIONS,
        `At most ${this.config.maxTransports} transports are allowed.`,
      );
    }

    return deepFreeze({
      name:
        normalizedName,

      channel,

      required:
        transportConfig.required,

      enabled:
        transportConfig.enabled,

      timeoutMs:
        transportConfig.timeoutMs,

      maxRetries:
        transportConfig.maxRetries,

      sendMethod,
    });
  }

  unregisterTransport(
    name,
  ) {
    return this.transports.delete(
      normalizeString(
        name,
        120,
      ),
    );
  }

  listTransports() {
    return deepFreeze(
      [
        ...this.transports.values(),
      ].map(
        (
          item,
        ) => ({
          name:
            item.name,

          channel:
            item.channel,

          required:
            item.required,

          enabled:
            item.enabled,

          timeoutMs:
            item.timeoutMs,

          maxRetries:
            item.maxRetries,

          capabilities:
            item.capabilityInfo,
        }),
      ),
    );
  }

  _findTransport(
    channel,
    requestedTransport,
  ) {
    if (
      requestedTransport
    ) {
      const name =
        normalizeString(
          requestedTransport,
          120,
        );

      const configured =
        this.transports.get(
          name,
        );

      if (
        !configured
      ) {
        throw new NotificationGatewayError(
          ERROR_CODES.TRANSPORT_NOT_CONFIGURED,
          `Transport ${name} is not configured.`,
        );
      }

      if (
        configured.channel !==
        channel
      ) {
        throw new NotificationGatewayError(
          ERROR_CODES.CHANNEL_UNSUPPORTED,
          `Transport ${name} does not support channel ${channel}.`,
        );
      }

      if (
        !configured.enabled
      ) {
        throw new NotificationGatewayError(
          ERROR_CODES.TRANSPORT_UNAVAILABLE,
          `Transport ${name} is disabled.`,
        );
      }

      return configured;
    }

    const candidate =
      [
        ...this.transports.values(),
      ].find(
        (
          item,
        ) =>
          item.enabled &&
          item.channel ===
            channel,
      );

    if (
      !candidate
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.TRANSPORT_NOT_CONFIGURED,
        `No enabled transport is configured for channel ${channel}.`,
      );
    }

    return candidate;
  }

  _normalizeRequest(
    input,
  ) {
    assertPlainObject(
      input,
      'notification request',
    );

    const scope =
      normalizeScope(
        input,
        this.config,
      );

    const channel =
      normalizeChannel(
        input.channel,
        this.config,
      );

    const recipients =
      normalizeRecipients(
        input.recipients ??
          input.recipient,
        this.config
          .maxRecipientsPerNotification,
      );

    const subject =
      normalizeString(
        input.subject ??
          input.title,
        this.config
          .maxSubjectLength,
      ) ??
      null;

    const body =
      normalizeBody(
        input.body ??
          input.message,
        this.config
          .maxBodyLength,
      );

    const contentType =
      normalizeContentType(
        input.contentType,
        this.config,
      );

    const priority =
      normalizePriority(
        input.priority,
      );

    const mode =
      upper(
        input.mode ??
          NOTIFICATION_MODES.LIVE,
        30,
      );

    if (
      !Object.values(
        NOTIFICATION_MODES,
      ).includes(
        mode,
      )
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.INVALID_INPUT,
        `Unsupported notification mode ${mode}.`,
      );
    }

    const timeoutMs =
      integer(
        input.timeoutMs,
        this.config
          .defaultTimeoutMs,
        1,
        this.config
          .maxTimeoutMs,
      );

    const requestedTransport =
      normalizeString(
        input.transport,
        120,
      ) ??
      null;

    const category =
      normalizeString(
        input.category ??
          input.eventType,
        160,
      ) ??
      'COMMAND_CENTER';

    const correlationId =
      normalizeString(
        input.correlationId,
        240,
      ) ??
      null;

    const idempotencyKey =
      normalizeString(
        input.idempotencyKey,
        240,
      ) ??
      null;

    const metadata =
      redact(
        input.metadata ??
          {},
      );

    const templateData =
      redact(
        input.templateData ??
          {},
      );

    if (
      safeBytes(
        templateData,
      ) >
      this.config
        .maxTemplateDataBytes
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        `Template data exceeds ${this.config.maxTemplateDataBytes} bytes.`,
      );
    }

    const range = {
      startAt:
        iso(
          input.startAt,
          null,
        ),

      endAt:
        iso(
          input.endAt,
          null,
        ),
    };

    return {
      ...scope,

      provider:
        PROVIDER,

      channel,

      recipients,

      subject,

      body,

      contentType,

      priority,

      mode,

      timeoutMs,

      requestedTransport,

      category,

      correlationId,

      idempotencyKey,

      metadata,

      templateData,

      range,

      dryRun:
        mode ===
        NOTIFICATION_MODES.DRY_RUN,

      allowContentPersistence:
        input.allowContentPersistence ===
          true &&
        this.config.persistBody ===
          true,
    };
  }

  _buildRequestFingerprint(
    input,
    transportName,
  ) {
    return `sha256:${sha256({
      provider:
        PROVIDER,

      scope:
        input.scope,

      tenantScope:
        input.tenantScope,

      channel:
        input.channel,

      recipients:
        input.recipients,

      subject:
        input.subject,

      bodyFingerprint:
        digest(
          input.body,
        ),

      contentType:
        input.contentType,

      priority:
        input.priority,

      mode:
        input.mode,

      requestedTransport:
        transportName,

      category:
        input.category,

      correlationId:
        input.correlationId,

      range:
        input.range,

      metadata:
        input.metadata,

      templateData:
        input.templateData,
    })}`;
  }

  _buildDeduplicationFingerprint(
    input,
    transportName,
  ) {
    return buildSemanticFingerprint({
      provider:
        PROVIDER,

      tenantScope:
        input.tenantScope,

      channel:
        input.channel,

      recipients:
        input.recipients,

      subject:
        input.subject,

      bodyFingerprint:
        digest(
          input.body,
        ),

      contentType:
        input.contentType,

      priority:
        input.priority,

      transport:
        transportName,

      category:
        input.category,
    });
  }

  async _checkIdempotency(
    input,
    requestFingerprint,
  ) {
    if (
      !input.idempotencyKey ||
      typeof this.repository
        ?.findByIdempotencyKey !==
        'function'
    ) {
      return null;
    }

    const existing =
      await this.repository.findByIdempotencyKey(
        {
          tenantScope:
            input.tenantScope,

          idempotencyKey:
            input.idempotencyKey,
        },
      );

    if (
      !existing
    ) {
      return null;
    }

    if (
      existing.requestFingerprint !==
      requestFingerprint
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        'Notification idempotency key maps to a different request.',
        {},
        {
          httpStatus:
            409,
        },
      );
    }

    return existing;
  }

  async _checkDuplicate(
    input,
    deduplicationFingerprint,
  ) {
    if (
      !this.config
        .suppressDuplicates ||
      typeof this.repository
        ?.findDuplicate !==
        'function'
    ) {
      return null;
    }

    const now =
      new Date(
        nowFrom(
          this.clock,
        ),
      ).getTime();

    const cutoff =
      new Date(
        now -
          this.config
            .deduplicationWindowMs,
      ).toISOString();

    return this.repository.findDuplicate(
      {
        tenantScope:
          input.tenantScope,

        deduplicationFingerprint,

        cutoffAt:
          cutoff,
      },
    );
  }

  async _consumeRateLimit(
    input,
    recipientCount,
  ) {
    if (
      !this.rateLimiter
    ) {
      return {
        allowed:
          true,

        remaining:
          null,

        resetAt:
          null,
      };
    }

    const method =
      typeof this.rateLimiter.consume ===
      'function'
        ? 'consume'
        : typeof this.rateLimiter.check ===
          'function'
          ? 'check'
          : null;

    if (
      !method
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.TRANSPORT_PROTOCOL_ERROR,
        'Configured rate limiter does not expose consume() or check().',
      );
    }

    const key =
      `${PROVIDER}:${input.tenantScope}:${input.channel}`;

    const result =
      await this.rateLimiter[
        method
      ](
        key,
        this.config
          .maxNotificationsPerBatch,
        60_000,
        recipientCount,
      );

    return {
      allowed:
        result?.allowed !==
        false,

      remaining:
        Number.isFinite(
          Number(
            result?.remaining,
          ),
        )
          ? Number(
              result.remaining,
            )
          : null,

      resetAt:
        iso(
          result?.resetAt,
          null,
        ),
    };
  }

  _buildTransportEnvelope(
    input,
    transport,
    notificationId,
    requestFingerprint,
  ) {
    const envelope =
      {
        notificationId,

        provider:
          PROVIDER,

        scope:
          input.scope,

        tenantId:
          input.tenantId,

        channel:
          input.channel,

        recipients:
          [
            ...input.recipients,
          ],

        subject:
          input.subject,

        body:
          input.body,

        contentType:
          input.contentType,

        priority:
          input.priority,

        category:
          input.category,

        correlationId:
          input.correlationId,

        metadata:
          input.metadata,

        templateData:
          input.templateData,

        requestFingerprint,

        timeoutMs:
          transport.timeoutMs,

        dryRun:
          input.dryRun,

        safety: {
          readOnly:
            true,

          financialMutationPerformed:
            false,

          ledgerMutationPerformed:
            false,

          balanceMutationPerformed:
            false,

          providerCallPerformed:
            false,

          paymentExecutionPerformed:
            false,

          settlementPerformed:
            false,

          approvalGranted:
            false,

          executionAuthorized:
            false,

          arbitraryCodeExecutionPerformed:
            false,
        },
      };

    return Object.freeze(
      envelope,
    );
  }

  async _dispatchOnce(
    transport,
    envelope,
  ) {
    const raw =
      await timeoutPromise(
        transport.transport[
          transport.sendMethod
        ](
          envelope,
        ),
        envelope.timeoutMs,
      );

    const normalized =
      normalizeTransportResult(
        raw,
      );

    if (
      normalized.safety
        .unsafeFlags.length >
        0 &&
      this.config
        .failClosedOnTransportUnsafe
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.TRANSPORT_UNSAFE,
        `Transport ${transport.name} returned forbidden side-effect indicators.`,
        {
          transport:
            transport.name,

          unsafeFlags:
            normalized
              .safety
              .unsafeFlags,
        },
      );
    }

    return normalized;
  }

  async _dispatch(
    transport,
    envelope,
  ) {
    let lastError =
      null;

    for (
      let attempt = 1;
      attempt <=
        transport.maxRetries +
          1;
      attempt +=
        1
    ) {
      try {
        const result =
          await this._dispatchOnce(
            transport,
            envelope,
          );

        return {
          ...result,

          attempt,

          retries:
            attempt -
            1,
        };
      } catch (
        error
      ) {
        lastError =
          error;

        if (
          attempt >
          transport.maxRetries
        ) {
          break;
        }

        const delay =
          backoffMs(
            this.config
              .retryBackoffMs,
            this.config
              .maxRetryBackoffMs,
            attempt,
          );

        await sleep(
          delay,
        );
      }
    }

    throw new NotificationGatewayError(
      ERROR_CODES.RETRY_EXHAUSTED,
      `Notification transport ${transport.name} failed after bounded retries.`,
      {
        transport:
          transport.name,

        maxRetries:
          transport.maxRetries,
      },
      {
        cause:
          lastError,
      },
    );
  }

  async send(
    input = {},
  ) {
    const normalized =
      this._normalizeRequest(
        input,
      );

    const transport =
      this._findTransport(
        normalized.channel,
        normalized.requestedTransport,
      );

    const requestFingerprint =
      this._buildRequestFingerprint(
        normalized,
        transport.name,
      );

    const existing =
      await this._checkIdempotency(
        normalized,
        requestFingerprint,
      );

    if (
      existing
    ) {
      return deepFreeze({
        ...redact(
          existing,
        ),

        replay:
          true,
      });
    }

    const notificationFingerprint =
      this._buildDeduplicationFingerprint(
        normalized,
        transport.name,
      );

    const duplicate =
      await this._checkDuplicate(
        normalized,
        notificationFingerprint,
      );

    if (
      duplicate
    ) {
      return deepFreeze({
        component:
          COMPONENT,

        provider:
          PROVIDER,

        notificationId:
          duplicate.notificationId,

        tenantScope:
          normalized.tenantScope,

        scope:
          normalized.scope,

        channel:
          normalized.channel,

        transport:
          transport.name,

        recipientCount:
          normalized
            .recipients.length,

        recipientDigests:
          normalized
            .recipients.map(
              (
                item,
              ) =>
                digest(
                  item,
                ),
            ),

        priority:
          normalized.priority,

        category:
          normalized.category,

        status:
          NOTIFICATION_STATUS.DUPLICATE,

        deliverySemantics:
          DELIVERY_SEMANTICS.DELIVERY_UNKNOWN,

        notificationFingerprint,

        requestFingerprint,

        bodyFingerprint:
          digest(
            normalized.body,
          ),

        idempotencyKey:
          normalized.idempotencyKey,

        correlationId:
          normalized.correlationId,

        replay:
          false,

        duplicateOfNotificationId:
          duplicate.notificationId,

        safety: {
          readOnly:
            true,

          financialMutationPerformed:
            false,

          ledgerMutationPerformed:
            false,

          balanceMutationPerformed:
            false,

          providerCallPerformed:
            false,

          paymentExecutionPerformed:
            false,

          settlementPerformed:
            false,

          approvalGranted:
            false,

          executionAuthorized:
            false,

          arbitraryCodeExecutionPerformed:
            false,
        },
      });
    }

    const rate =
      await this._consumeRateLimit(
        normalized,
        normalized
          .recipients.length,
      );

    if (
      !rate.allowed
    ) {
      this._metric(
        'titech.airtel.notifications.rate_limited',
        {
          channel:
            normalized.channel,

          provider:
            PROVIDER,
        },
      );

      throw new NotificationGatewayError(
        ERROR_CODES.RATE_LIMITED,
        'Notification rate limit exceeded.',
      );
    }

    const notificationId =
      this.notificationIdFactory();

    const baseResult =
      {
        component:
          COMPONENT,

        engine:
          ENGINE_NAME,

        version:
          ENGINE_VERSION,

        schemaVersion:
          SCHEMA_VERSION,

        provider:
          PROVIDER,

        notificationId,

        replay:
          false,

        scope:
          normalized.scope,

        tenantScope:
          normalized.tenantScope,

        channel:
          normalized.channel,

        transport:
          transport.name,

        recipientCount:
          normalized
            .recipients.length,

        recipientDigests:
          normalized
            .recipients.map(
              (
                item,
              ) =>
                digest(
                  item,
                ),
            ),

        subjectFingerprint:
          normalized.subject
            ? digest(
                normalized.subject,
              )
            : null,

        bodyFingerprint:
          digest(
            normalized.body,
          ),

        contentPersisted:
          false,

        priority:
          normalized.priority,

        category:
          normalized.category,

        correlationId:
          normalized.correlationId,

        idempotencyKey:
          normalized.idempotencyKey,

        requestFingerprint,

        notificationFingerprint,

        createdAt:
          nowFrom(
            this.clock,
          ),

        mode:
          normalized.mode,

        dryRun:
          normalized.dryRun,

        rateLimit:
          rate,

        safety: {
          readOnly:
            true,

          financialMutationPerformed:
            false,

          ledgerMutationPerformed:
            false,

          balanceMutationPerformed:
            false,

          providerCallPerformed:
            false,

          paymentExecutionPerformed:
            false,

          settlementPerformed:
            false,

          approvalGranted:
            false,

          executionAuthorized:
            false,

          arbitraryCodeExecutionPerformed:
            false,
        },
      };

    if (
      normalized.dryRun
    ) {
      const result =
        {
          ...baseResult,

          status:
            NOTIFICATION_STATUS.DRY_RUN,

          deliverySemantics:
            DELIVERY_SEMANTICS.DELIVERY_UNKNOWN,

          transportAttempt:
            0,

          retryCount:
            0,

          completedAt:
            nowFrom(
              this.clock,
            ),

          error:
            null,
        };

      result.notificationFingerprint =
        buildSemanticFingerprint(
          result,
        );

      if (
        this.config
          .persistNotifications &&
        typeof this.repository
          ?.saveNotification ===
          'function'
      ) {
        try {
          await this.repository.saveNotification(
            {
              ...result,

              idempotencyKey:
                normalized
                  .idempotencyKey,

              body:
                normalized
                  .allowContentPersistence
                  ? normalized.body
                  : undefined,
            },
          );
        } catch (
          error
        ) {
          this._log(
            'warn',
            'Dry-run notification persistence failed.',
            error,
            {
              notificationId,
            },
          );
        }
      }

      this._metric(
        'titech.airtel.notifications.dry_run',
        {
          channel:
            normalized.channel,

          provider:
            PROVIDER,
        },
      );

      return deepFreeze(
        redact(
          result,
        ),
      );
    }

    let dispatchResult;

    try {
      const envelope =
        this._buildTransportEnvelope(
          normalized,
          transport,
          notificationId,
          requestFingerprint,
        );

      dispatchResult =
        await this._dispatch(
          transport,
          envelope,
        );
    } catch (
      error
    ) {
      const failed =
        {
          ...baseResult,

          status:
            NOTIFICATION_STATUS.FAILED,

          deliverySemantics:
            DELIVERY_SEMANTICS.DELIVERY_UNKNOWN,

          transportAttempt:
            transport.maxRetries +
            1,

          retryCount:
            transport.maxRetries,

          completedAt:
            nowFrom(
              this.clock,
            ),

          error:
            safeError(
              error,
            ),
        };

      failed.notificationFingerprint =
        buildSemanticFingerprint(
          failed,
        );

      this._metric(
        'titech.airtel.notifications.failed',
        {
          channel:
            normalized.channel,

          transport:
            transport.name,

          provider:
            PROVIDER,
        },
      );

      if (
        this.config
          .persistNotifications &&
        typeof this.repository
          ?.saveNotification ===
          'function'
      ) {
        try {
          await this.repository.saveNotification(
            {
              ...failed,

              idempotencyKey:
                normalized
                  .idempotencyKey,

              body:
                normalized
                  .allowContentPersistence
                  ? normalized.body
                  : undefined,
            },
          );
        } catch (
          persistenceError
        ) {
          this._log(
            'error',
            'Failed notification persistence failed.',
            persistenceError,
            {
              notificationId,
            },
          );

          if (
            this.config
              .failClosedOnRequiredTransportFailure
          ) {
            throw new NotificationGatewayError(
              ERROR_CODES.PERSISTENCE_FAILED,
              'Notification failed and its audit record could not be persisted.',
              {
                notificationId,
              },
              {
                cause:
                  persistenceError,
              },
            );
          }
        }
      }

      throw error;
    }

    const status =
      dispatchResult.delivered
        ? NOTIFICATION_STATUS.DELIVERED
        : dispatchResult.accepted
          ? NOTIFICATION_STATUS.SENT
          : NOTIFICATION_STATUS.INDETERMINATE;

    const result =
      {
        ...baseResult,

        status,

        deliverySemantics:
          dispatchResult.deliverySemantics,

        transportAttempt:
          dispatchResult.attempt,

        retryCount:
          dispatchResult.retries,

        providerMessageId:
          dispatchResult
            .providerMessageId,

        transportMetadata:
          dispatchResult.metadata,

        completedAt:
          nowFrom(
            this.clock,
          ),

        error:
          null,
      };

    result.notificationFingerprint =
      buildSemanticFingerprint(
        result,
      );

    if (
      this.config
        .persistNotifications &&
      typeof this.repository
        ?.saveNotification ===
        'function'
    ) {
      try {
        await this.repository.saveNotification(
          {
            ...result,

            idempotencyKey:
              normalized
                .idempotencyKey,

            body:
              normalized
                .allowContentPersistence
                ? normalized.body
                : undefined,
          },
        );
      } catch (
        error
      ) {
        this._log(
          'error',
          'Notification persistence failed.',
          error,
          {
            notificationId,
          },
        );

        throw new NotificationGatewayError(
          ERROR_CODES.PERSISTENCE_FAILED,
          'Notification was sent but its audit record could not be persisted.',
          {
            notificationId,
          },
          {
            cause:
              error,
          },
        );
      }
    }

    this._metric(
      'titech.airtel.notifications.sent',
      {
        channel:
          normalized.channel,

        transport:
          transport.name,

        provider:
          PROVIDER,

        status,
      },
    );

    return deepFreeze(
      redact(
        result,
      ),
    );
  }

  async notify(
    input = {},
  ) {
    return this.send(
      input,
    );
  }

  async dispatch(
    input = {},
  ) {
    return this.send(
      input,
    );
  }

  async sendBatch(
    input = {},
  ) {
    assertPlainObject(
      input,
      'batch notification request',
    );

    if (
      !Array.isArray(
        input.notifications,
      )
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.INVALID_INPUT,
        'notifications must be an array.',
      );
    }

    if (
      input.notifications.length ===
      0
    ) {
      return deepFreeze({
        component:
          COMPONENT,

        provider:
          PROVIDER,

        total:
          0,

        accepted:
          0,

        sent:
          0,

        delivered:
          0,

        failed:
          0,

        duplicate:
          0,

        dryRun:
          0,

        results:
          [],
      });
    }

    if (
      input.notifications.length >
      this.config
        .maxNotificationsPerBatch
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.TOO_MANY_NOTIFICATIONS,
        `A notification batch may contain at most ${this.config.maxNotificationsPerBatch} items.`,
      );
    }

    const results =
      await runWithConcurrency(
        input.notifications,
        (
          item,
        ) =>
          this.send(
            item,
          ),
        integer(
          input.concurrency,
          this.config
            .maxConcurrency,
          1,
          this.config
            .maxConcurrency,
        ),
      );

    const normalizedResults =
      results.map(
        (
          item,
        ) =>
          item?.error
            ? {
                status:
                  NOTIFICATION_STATUS.FAILED,

                error:
                  safeError(
                    item.error,
                  ),
              }
            : item,
      );

    const summary =
      {
        total:
          normalizedResults.length,

        accepted:
          normalizedResults.filter(
            (
              item,
            ) =>
              [
                NOTIFICATION_STATUS.ACCEPTED,
                NOTIFICATION_STATUS.SENT,
                NOTIFICATION_STATUS.DELIVERED,
              ].includes(
                item.status,
              ),
          ).length,

        sent:
          normalizedResults.filter(
            (
              item,
            ) =>
              item.status ===
              NOTIFICATION_STATUS.SENT,
          ).length,

        delivered:
          normalizedResults.filter(
            (
              item,
            ) =>
              item.status ===
              NOTIFICATION_STATUS.DELIVERED,
          ).length,

        failed:
          normalizedResults.filter(
            (
              item,
            ) =>
              item.status ===
              NOTIFICATION_STATUS.FAILED,
          ).length,

        duplicate:
          normalizedResults.filter(
            (
              item,
            ) =>
              item.status ===
              NOTIFICATION_STATUS.DUPLICATE,
          ).length,

        dryRun:
          normalizedResults.filter(
            (
              item,
            ) =>
              item.status ===
              NOTIFICATION_STATUS.DRY_RUN,
          ).length,

        indeterminate:
          normalizedResults.filter(
            (
              item,
            ) =>
              item.status ===
              NOTIFICATION_STATUS.INDETERMINATE,
          ).length,
      };

    return deepFreeze(
      redact({
        component:
          COMPONENT,

        provider:
          PROVIDER,

        summary,

        results:
          normalizedResults,
      }),
    );
  }

  async getNotification({
    tenantId,
    scope =
      'TENANT',
    notificationId,
  } = {}) {
    const scopeInfo =
      normalizeScope(
        {
          tenantId,
          scope,
        },
        this.config,
      );

    const id =
      normalizeString(
        notificationId,
        240,
      );

    if (!id) {
      throw new NotificationGatewayError(
        ERROR_CODES.INVALID_INPUT,
        'notificationId is required.',
      );
    }

    if (
      typeof this.repository
        ?.getNotification !==
      'function'
    ) {
      return null;
    }

    const record =
      await this.repository.getNotification(
        {
          tenantScope:
            scopeInfo.tenantScope,

          notificationId:
            id,
        },
      );

    return record
      ? deepFreeze(
          redact(
            record,
          ),
        )
      : null;
  }

  async listNotifications({
    tenantId,
    scope =
      'TENANT',
    limit =
      this.config
        .defaultHistoryLimit,
    offset = 0,
  } = {}) {
    const scopeInfo =
      normalizeScope(
        {
          tenantId,
          scope,
        },
        this.config,
      );

    const boundedLimit =
      integer(
        limit,
        this.config
          .defaultHistoryLimit,
        1,
        this.config
          .maxHistoryLimit,
      );

    const boundedOffset =
      integer(
        offset,
        0,
        0,
        Number.MAX_SAFE_INTEGER,
      );

    if (
      typeof this.repository
        ?.listNotifications !==
      'function'
    ) {
      return deepFreeze({
        scope:
          scopeInfo.scope,

        tenantScope:
          scopeInfo.tenantScope,

        dataState:
          'UNAVAILABLE',

        records:
          [],

        limit:
          boundedLimit,

        offset:
          boundedOffset,
      });
    }

    const records =
      await this.repository.listNotifications(
        {
          tenantScope:
            scopeInfo.tenantScope,

          limit:
            boundedLimit,

          offset:
            boundedOffset,
        },
      );

    return deepFreeze({
      scope:
        scopeInfo.scope,

      tenantScope:
        scopeInfo.tenantScope,

      dataState:
        records.length
          ? 'AVAILABLE'
          : 'EMPTY',

      records:
        records.map(
          (
            record,
          ) =>
            redact(
              record,
            ),
        ),

      limit:
        boundedLimit,

      offset:
        boundedOffset,
    });
  }

  async exportHistory({
    tenantId,
    scope =
      'TENANT',
    limit =
      this.config
        .defaultHistoryLimit,
  } = {}) {
    const data =
      await this.listNotifications(
        {
          tenantId,
          scope,
          limit,
        },
      );

    const content =
      JSON.stringify(
        data,
        null,
        2,
      );

    const bytes =
      Buffer.byteLength(
        content,
        'utf8',
      );

    if (
      bytes >
      this.config
        .maxExportBytes
    ) {
      throw new NotificationGatewayError(
        ERROR_CODES.EXPORT_TOO_LARGE,
        `Notification history export exceeds ${this.config.maxExportBytes} bytes.`,
        {
          bytes,

          maxExportBytes:
            this.config
              .maxExportBytes,
        },
        {
          httpStatus:
            413,
        },
      );
    }

    return deepFreeze({
      contentType:
        'application/json',

      filename:
        `airtel-notification-history-${data.scope.toLowerCase()}.json`,

      bytes,

      fingerprint:
        `sha256:${sha256(
          content,
        )}`,

      content,
    });
  }

  async health() {
    const transportEntries =
      [
        ...this.transports.values(),
      ];

    const transportStates =
      {};

    for (
      const transport of
      transportEntries
    ) {
      if (
        !transport.enabled
      ) {
        transportStates[
          transport.name
        ] = {
          state:
            TRANSPORT_STATES.UNAVAILABLE,

          enabled:
            false,

          channel:
            transport.channel,
        };

        continue;
      }

      const source =
        transport.transport;

      const method =
        typeof source.healthCheck ===
        'function'
          ? 'healthCheck'
          : typeof source.health ===
            'function'
            ? 'health'
            : typeof source.readiness ===
              'function'
              ? 'readiness'
              : null;

      if (
        !method
      ) {
        transportStates[
          transport.name
        ] = {
          state:
            TRANSPORT_STATES.UNKNOWN,

          enabled:
            true,

          channel:
            transport.channel,

          method:
            null,
        };

        continue;
      }

      try {
        const raw =
          await timeoutPromise(
            source[
              method
            ](),
            transport.timeoutMs,
          );

        const state =
          upper(
            raw?.state,
            40,
          ) ??
          (
            raw?.ok ===
            false
              ? TRANSPORT_STATES.UNAVAILABLE
              : TRANSPORT_STATES.READY
          );

        transportStates[
          transport.name
        ] = {
          state:
            Object.values(
              TRANSPORT_STATES,
            ).includes(
              state,
            )
              ? state
              : TRANSPORT_STATES.UNKNOWN,

          enabled:
            true,

          channel:
            transport.channel,

          method,
        };
      } catch (
        error
      ) {
        transportStates[
          transport.name
        ] = {
          state:
            TRANSPORT_STATES.UNAVAILABLE,

          enabled:
            true,

          channel:
            transport.channel,

          method,

          error:
            safeError(
              error,
            ),
        };
      }
    }

    const configured =
      transportEntries.filter(
        (
          item,
        ) =>
          item.enabled,
      ).length;

    const available =
      Object.values(
        transportStates,
      ).filter(
        (
          item,
        ) =>
          item.state ===
          TRANSPORT_STATES.READY,
      ).length;

    const unavailable =
      Object.values(
        transportStates,
      ).filter(
        (
          item,
        ) =>
          item.state ===
          TRANSPORT_STATES.UNAVAILABLE,
      ).length;

    const requiredUnavailable =
      transportEntries.filter(
        (
          item,
        ) =>
          item.required &&
          item.enabled &&
          transportStates[
            item.name
          ]?.state ===
            TRANSPORT_STATES.UNAVAILABLE,
      ).length;

    const state =
      requiredUnavailable >
      0
        ? TRANSPORT_STATES.UNAVAILABLE
        : unavailable >
            0
          ? TRANSPORT_STATES.DEGRADED
          : configured ===
              0
            ? TRANSPORT_STATES.UNAVAILABLE
            : available ===
                configured
              ? TRANSPORT_STATES.READY
              : TRANSPORT_STATES.DEGRADED;

    return deepFreeze(
      redact({
        component:
          COMPONENT,

        provider:
          PROVIDER,

        version:
          ENGINE_VERSION,

        schemaVersion:
          SCHEMA_VERSION,

        state,

        healthy:
          state ===
          TRANSPORT_STATES.READY,

        degraded:
          state ===
          TRANSPORT_STATES.DEGRADED,

        unavailable:
          state ===
          TRANSPORT_STATES.UNAVAILABLE,

        transportCount:
          transportEntries.length,

        configuredTransportCount:
          configured,

        availableTransportCount:
          available,

        unavailableTransportCount:
          unavailable,

        requiredUnavailable,

        transports:
          transportStates,

        repositoryConfigured:
          Boolean(
            this.repository,
          ),

        rateLimiterConfigured:
          Boolean(
            this.rateLimiter,
          ),

        readOnly:
          true,
      }),
    );
  }

  async readiness() {
    return this.health();
  }

  getComponentInfo() {
    return Object.freeze({
      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      provider:
        PROVIDER,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      tenantIsolation:
        true,

      outboundOnly:
        true,

      allowListedTransports:
        true,

      boundedRecipients:
        true,

      boundedBatchSize:
        true,

      boundedRetries:
        true,

      boundedTimeouts:
        true,

      idempotencySupported:
        true,

      duplicateSuppressionSupported:
        true,

      bodyPersistenceDefault:
        false,

      dryRunSupported:
        true,

      readOnlyFinancialBoundary:
        true,

      financialMutation:
        false,

      ledgerMutation:
        false,

      balanceMutation:
        false,

      providerCall:
        false,

      paymentExecution:
        false,

      settlement:
        false,

      approvalGrant:
        false,

      executionAuthorization:
        false,

      arbitraryCodeExecution:
        false,

      policyMutation:
        false,

      complianceMutation:
        false,

      alertMutation:
        false,

      modelMutation:
        false,

      internalScheduler:
        false,
    });
  }

  async close() {
    if (
      typeof this.repository
        ?.close ===
      'function'
    ) {
      await this.repository.close();
    }

    if (
      typeof this.rateLimiter
        ?.close ===
      'function'
    ) {
      await this.rateLimiter.close();
    }

    for (
      const item of
      this.transports.values()
    ) {
      const close =
        item.transport.shutdown ??
        item.transport.close ??
        item.transport.stop;

      if (
        typeof close ===
        'function'
      ) {
        await close.call(
          item.transport,
        );
      }
    }
  }
}

export function createNotificationGateway(
  options = {},
) {
  return new NotificationGateway(
    options,
  );
}

export const createAirtelNotificationGateway =
  createNotificationGateway;

export const AirtelNotificationGateway =
  NotificationGateway;

export const constants =
  Object.freeze({
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    PROVIDER,
    SCHEMA_VERSION,
    HASH_ALGORITHM,
    NOTIFICATION_CHANNELS,
    NOTIFICATION_STATUS,
    NOTIFICATION_PRIORITIES,
    NOTIFICATION_MODES,
    TRANSPORT_STATES,
    DELIVERY_SEMANTICS,
    ERROR_CODES,
    NOTIFICATION_SAFETY_FLAGS,
  });

export function buildNotificationFingerprint(
  value,
) {
  return buildSemanticFingerprint(
    value,
  );
}

export default NotificationGateway;