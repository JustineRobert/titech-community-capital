/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Normalizer
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/callbacks/callbackNormalizer.js
 *
 * Architectural role
 * ------------------
 * Canonical, deterministic normalization boundary between an authenticated /
 * validated Airtel callback and the internal callback correlation/processing
 * pipeline.
 *
 * Processing boundary
 * -------------------
 * Airtel callback
 *      -> transport/signature validation
 *      -> THIS NORMALIZER
 *      -> callback correlation
 *      -> callback dispatcher/processor
 *      -> state machine / Financial Core / reconciliation
 *
 * Responsibilities
 * ----------------
 * - Parse object, JSON string and Buffer callback inputs.
 * - Normalize the provider-specific shape into one internal callback contract.
 * - Preserve provider references, payment references and callback identity.
 * - Normalize status/outcome without inventing provider settlement semantics.
 * - Normalize amounts/currency/phone identifiers deterministically.
 * - Produce deterministic payload/callback fingerprints.
 * - Sanitize party/metadata data and enforce payload size limits.
 * - Preserve tenant context supplied by trusted application context.
 * - Expose normalize()/transform() compatibility contracts.
 * - Provide validate(), health(), readiness(), diagnostics() and snapshots.
 *
 * Explicitly NOT responsible for
 * -------------------------------
 * - Signature verification.
 * - Authentication or authorization.
 * - Tenant inference from untrusted payload data.
 * - Callback correlation or payment lookup.
 * - Duplicate admission / idempotency reservation.
 * - Fraud/KYC/AML decisions.
 * - Payment execution or provider API calls.
 * - Ledger posting or balance/wallet mutation.
 * - Settlement finality.
 * - Reconciliation execution.
 *
 * Security principles
 * -------------------
 * 1. Raw callback payload is input only; this module does not persist it.
 * 2. Trusted tenant context outranks any tenantId supplied by the provider.
 * 3. Provider callback identity is deterministic and immutable for processing.
 * 4. Provider references are preserved; generic references are not silently
 *    promoted to provider transaction IDs.
 * 5. Money is normalized without floating-point arithmetic for integer minor
 *    units when an explicit minor-unit value is supplied.
 * 6. Invalid/unknown provider outcomes remain UNKNOWN rather than being mapped
 *    optimistically to SUCCESS.
 * 7. Missing security verification does not get manufactured by normalization.
 * 8. Metadata/party payloads are bounded and sensitive fields are redacted.
 * 9. Normalization never changes financial state.
 *
 * Module format
 * -------------
 * Native ESM. No external dependencies.
 * =============================================================================
 */

import crypto from 'node:crypto';

export const PROVIDER = 'AIRTEL';
export const OPERATION = 'CALLBACK';
export const COMPONENT = 'titech.airtel.callbacks.normalizer';
export const ENGINE_NAME = 'airtel-callback-normalizer';
export const ENGINE_VERSION = '5.0.0';
export const SCHEMA_VERSION = 5;
export const HASH_ALGORITHM = 'sha256';
export const FINANCIAL_BOUNDARY = 'TITECH_FINANCIAL_CORE';

export const CALLBACK_OUTCOMES = Object.freeze({
  SUCCESS: 'SUCCESS',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REVERSED: 'REVERSED',
  UNKNOWN: 'UNKNOWN',
  DUPLICATE: 'DUPLICATE',
});

export const NORMALIZATION_STATUSES = Object.freeze({
  NORMALIZED: 'NORMALIZED',
  INVALID: 'INVALID',
});

export const DEFAULTS = Object.freeze({
  maxPayloadBytes: 1024 * 1024,
  maxMetadataBytes: 64 * 1024,
  maxPartyBytes: 16 * 1024,
  maxStringLength: 1024,
  maxReferenceLength: 256,
  maxCallbackTypeLength: 128,
  requireTenantId: true,
  requireCallbackIdentity: true,
  requireProviderTransactionId: true,
  requirePaymentReference: true,
  requireCurrency: true,
  requireAmountForFinancialCallback: false,
  preserveSafeMetadata: true,
  redactSensitiveFields: true,
  failClosedOnInvalidJson: true,
  defaultCurrency: 'UGX',
  defaultCallbackType: 'PAYMENT_CALLBACK',
  countryCode: '256',
  phoneMinDigits: 9,
  phoneMaxDigits: 15,
  minorUnitDefaults: Object.freeze({
    UGX: 0,
    KES: 2,
    TZS: 2,
    RWF: 0,
    GHS: 2,
    ZMW: 2,
    NGN: 2,
    USD: 2,
    EUR: 2,
    GBP: 2,
  }),
  successStatuses: Object.freeze([
    'SUCCESS',
    'SUCCESSFUL',
    'COMPLETED',
    'COMPLETE',
    'PAID',
    'APPROVED',
    'SUCCESSFULLY_COMPLETED',
    'TRANSACTION_SUCCESS',
    'TS',
  ]),
  pendingStatuses: Object.freeze([
    'PENDING',
    'PROCESSING',
    'IN_PROGRESS',
    'QUEUED',
    'INITIATED',
    'ACCEPTED',
    'SUBMITTED',
    'REQUESTED',
  ]),
  failureStatuses: Object.freeze([
    'FAILED',
    'FAILURE',
    'ERROR',
    'DECLINED',
    'REJECTED',
    'TRANSACTION_FAILED',
    'TF',
  ]),
  cancelledStatuses: Object.freeze([
    'CANCELLED',
    'CANCELED',
  ]),
  reversedStatuses: Object.freeze([
    'REVERSED',
    'REVERSAL',
  ]),
  unknownStatuses: Object.freeze([
    'UNKNOWN',
    'UNCONFIRMED',
  ]),
});

const SENSITIVE_KEY_PATTERN =
  /authorization|proxy.?authorization|cookie|secret|password|token|signature|private.?key|api.?key|credential|otp|pin|cvv|cvc|pan|refresh/i;

const RAW_KEY_PATTERN =
  /^raw|request.?body|response.?body|webhook.?body/i;

const BLOCKED_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isPlainObject(value) {
  if (!isObject(value)) return false;

  const prototype =
    Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function isFunction(value) {
  return typeof value === 'function';
}

function now(clock) {
  const value =
    isFunction(clock?.now)
      ? clock.now()
      : Date.now();

  return new Date(value);
}

function normalizeString(
  value,
  maxLength = 1024,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const result =
    String(value).trim();

  return result
    ? result.slice(0, maxLength)
    : null;
}

function normalizeUpper(
  value,
  maxLength = 128,
) {
  const result =
    normalizeString(
      value,
      maxLength,
    );

  return result
    ? result.toUpperCase()
    : null;
}

function firstValue(
  source,
  paths = [],
) {
  for (const path of paths) {
    let cursor = source;

    for (
      const segment of
        path.split('.')
    ) {
      if (
        !isObject(cursor) &&
        !Array.isArray(cursor)
      ) {
        cursor = undefined;
        break;
      }

      cursor =
        cursor?.[
          segment
        ];
    }

    if (
      cursor !== undefined &&
      cursor !== null &&
      cursor !== ''
    ) {
      return cursor;
    }
  }

  return null;
}

function byteLength(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return 0;
  }

  if (Buffer.isBuffer(value)) {
    return value.length;
  }

  if (typeof value === 'string') {
    return Buffer.byteLength(
      value,
      'utf8',
    );
  }

  try {
    return Buffer.byteLength(
      JSON.stringify(value),
      'utf8',
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function canonicalize(
  value,
  depth = 0,
) {
  if (depth > 10) {
    return '[DEPTH_LIMIT]';
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[BUFFER:${sha256(value)}]`;
  }

  if (typeof value !== 'object') {
    return typeof value === 'bigint'
      ? String(value)
      : value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 500)
      .map((item) =>
        canonicalize(
          item,
          depth + 1,
        ),
      );
  }

  return Object.keys(value)
    .sort()
    .reduce(
      (
        result,
        key,
      ) => {
        if (
          BLOCKED_KEYS.has(
            key,
          )
        ) {
          return result;
        }

        result[key] =
          canonicalize(
            value[key],
            depth + 1,
          );

        return result;
      },
      {},
    );
}

function sha256(value) {
  const input =
    Buffer.isBuffer(value)
      ? value
      : typeof value === 'string'
        ? value
        : JSON.stringify(
            canonicalize(
              value,
            ),
          );

  return crypto
    .createHash(
      HASH_ALGORITHM,
    )
    .update(input)
    .digest('hex');
}

function safeClone(
  value,
  depth = 0,
) {
  if (depth > 8) {
    return '[DEPTH_LIMIT]';
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return '[BUFFER_REDACTED]';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== 'object') {
    return typeof value === 'bigint'
      ? String(value)
      : value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 250)
      .map((item) =>
        safeClone(
          item,
          depth + 1,
        ),
      );
  }

  const result = {};

  for (
    const [key, child] of
      Object.entries(value)
  ) {
    if (
      BLOCKED_KEYS.has(
        key,
      )
    ) {
      continue;
    }

    if (
      SENSITIVE_KEY_PATTERN.test(
        key,
      )
    ) {
      result[key] =
        '[REDACTED]';
      continue;
    }

    if (
      RAW_KEY_PATTERN.test(
        key,
      )
    ) {
      result[key] =
        '[OMITTED]';
      continue;
    }

    result[key] =
      safeClone(
        child,
        depth + 1,
      );
  }

  return result;
}

function redactedFingerprintInput(
  value,
) {
  return safeClone(
    value,
  );
}

function parsePayload(
  input,
  options = {},
) {
  if (
    input === undefined ||
    input === null
  ) {
    throw createNormalizationError(
      'AIRTEL_CALLBACK_PAYLOAD_REQUIRED',
      'Airtel callback payload is required.',
      400,
    );
  }

  if (Buffer.isBuffer(input)) {
    if (
      input.length >
      options.maxPayloadBytes
    ) {
      throw createNormalizationError(
        'AIRTEL_CALLBACK_PAYLOAD_TOO_LARGE',
        'Airtel callback payload exceeds the configured size limit.',
        413,
      );
    }

    try {
      return JSON.parse(
        input.toString(
          'utf8',
        ),
      );
    } catch (error) {
      throw createNormalizationError(
        'AIRTEL_CALLBACK_INVALID_JSON',
        'Airtel callback body is not valid JSON.',
        400,
        error,
      );
    }
  }

  if (typeof input === 'string') {
    if (
      byteLength(input) >
      options.maxPayloadBytes
    ) {
      throw createNormalizationError(
        'AIRTEL_CALLBACK_PAYLOAD_TOO_LARGE',
        'Airtel callback payload exceeds the configured size limit.',
        413,
      );
    }

    try {
      return JSON.parse(
        input,
      );
    } catch (error) {
      throw createNormalizationError(
        'AIRTEL_CALLBACK_INVALID_JSON',
        'Airtel callback payload is not valid JSON.',
        400,
        error,
      );
    }
  }

  if (
    !isObject(input) ||
    Array.isArray(input)
  ) {
    throw createNormalizationError(
      'AIRTEL_CALLBACK_INVALID_PAYLOAD',
      'Airtel callback payload must be an object or JSON object.',
      400,
    );
  }

  if (
    byteLength(input) >
    options.maxPayloadBytes
  ) {
    throw createNormalizationError(
      'AIRTEL_CALLBACK_PAYLOAD_TOO_LARGE',
      'Airtel callback payload exceeds the configured size limit.',
      413,
    );
  }

  return input;
}

function createNormalizationError(
  code,
  message,
  statusCode = 400,
  cause = undefined,
) {
  const error =
    new Error(
      message,
    );

  error.name =
    'AirtelCallbackNormalizationError';

  error.code =
    code;

  error.statusCode =
    statusCode;

  error.retryable =
    false;

  if (cause) {
    error.cause =
      cause;
  }

  return error;
}

function normalizeAmount(
  value,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  if (
    typeof value === 'number'
  ) {
    if (
      !Number.isFinite(value)
    ) {
      return null;
    }

    return String(
      value,
    );
  }

  if (
    typeof value === 'string'
  ) {
    const trimmed =
      value.trim();

    if (
      !trimmed ||
      !/^\d+(?:\.\d+)?$/.test(
        trimmed,
      )
    ) {
      return null;
    }

    return trimmed;
  }

  if (
    isObject(value) &&
    isFunction(
      value.toString,
    )
  ) {
    const result =
      String(
        value.toString(),
      ).trim();

    return /^\d+(?:\.\d+)?$/.test(
      result,
    )
      ? result
      : null;
  }

  return null;
}

function normalizeMinorAmount(
  value,
  currency,
  explicitMinor = false,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const raw =
    normalizeAmount(
      value,
    );

  if (raw === null) {
    return null;
  }

  if (explicitMinor) {
    if (
      !/^\d+$/.test(
        raw,
      )
    ) {
      return null;
    }

    const number =
      Number(raw);

    return Number.isSafeInteger(
      number,
    )
      ? String(number)
      : null;
  }

  const exponent =
    DEFAULTS
      .minorUnitDefaults[
        currency
      ] ?? 2;

  const [
    integerPart,
    fractionPart = '',
  ] =
    raw.split('.');

  const normalizedFraction =
    fractionPart
      .padEnd(
        exponent,
        '0',
      )
      .slice(
        0,
        exponent,
      );

  const minor =
    `${integerPart}${normalizedFraction}`
      .replace(
        /^0+(?=\d)/,
        '',
      );

  return Number.isSafeInteger(
    Number(minor),
  )
    ? String(
        Number(minor),
      )
    : null;
}

function normalizeCurrency(
  value,
  fallback,
) {
  return normalizeUpper(
    value,
    8,
  ) ||
    normalizeUpper(
      fallback,
      8,
    ) ||
    null;
}

function normalizePhone(
  value,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  let digits =
    String(value)
      .replace(
        /[^0-9]/g,
        '',
      );

  if (!digits) {
    return null;
  }

  if (
    digits.startsWith(
      '00',
    )
  ) {
    digits =
      digits.slice(2);
  }

  if (
    digits.startsWith(
      '256',
    ) &&
    digits.length === 12
  ) {
    return `+${digits}`;
  }

  if (
    digits.startsWith(
      '0',
    ) &&
    digits.length === 10
  ) {
    return `+256${digits.slice(1)}`;
  }

  if (
    digits.length >=
      DEFAULTS.phoneMinDigits &&
    digits.length <=
      DEFAULTS.phoneMaxDigits
  ) {
    return `+${digits}`;
  }

  return null;
}

function normalizeDate(
  value,
) {
  if (!value) {
    return null;
  }

  const date =
    new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? null
    : date.toISOString();
}

function normalizeParty(
  value,
  maxBytes,
) {
  if (
    !value ||
    !isObject(value)
  ) {
    return null;
  }

  const safe =
    safeClone(value);

  if (
    byteLength(safe) <=
    maxBytes
  ) {
    return safe;
  }

  return {
    omitted: true,
    reason:
      'PARTY_METADATA_TOO_LARGE',
    sha256:
      sha256(safe),
  };
}

function normalizeMetadata(
  value,
  maxBytes,
) {
  if (
    !value ||
    !isObject(value)
  ) {
    return {};
  }

  const safe =
    safeClone(value);

  if (
    byteLength(safe) <=
    maxBytes
  ) {
    return safe;
  }

  return {
    omitted: true,
    reason:
      'METADATA_TOO_LARGE',
    sha256:
      sha256(safe),
  };
}

function outcomeForStatus(
  value,
  transaction = {},
  response = {},
  options = DEFAULTS,
) {
  const candidates = [
    value,
    transaction?.outcome,
    transaction?.status,
    transaction?.transactionStatus,
    transaction?.resultCode,
    transaction?.responseCode,
    response?.status,
    response?.resultCode,
    response?.responseCode,
  ];

  for (
    const candidate of
      candidates
  ) {
    const status =
      normalizeUpper(
        candidate,
      );

    if (!status) {
      continue;
    }

    if (
      options.successStatuses.includes(
        status,
      )
    ) {
      return CALLBACK_OUTCOMES
        .SUCCESS;
    }

    if (
      options.pendingStatuses.includes(
        status,
      )
    ) {
      return CALLBACK_OUTCOMES
        .PENDING;
    }

    if (
      options.failureStatuses.includes(
        status,
      )
    ) {
      return CALLBACK_OUTCOMES
        .FAILED;
    }

    if (
      options.cancelledStatuses.includes(
        status,
      )
    ) {
      return CALLBACK_OUTCOMES
        .CANCELLED;
    }

    if (
      options.reversedStatuses.includes(
        status,
      )
    ) {
      return CALLBACK_OUTCOMES
        .REVERSED;
    }

    if (
      options.unknownStatuses.includes(
        status,
      )
    ) {
      return CALLBACK_OUTCOMES
        .UNKNOWN;
    }
  }

  return CALLBACK_OUTCOMES
    .UNKNOWN;
}

function callbackFingerprint(
  callback,
) {
  return sha256(
    redactedFingerprintInput({
      provider:
        PROVIDER,

      operation:
        OPERATION,

      callbackId:
        callback.callbackId,

      providerTransactionId:
        callback.providerTransactionId,

      paymentReference:
        callback.paymentReference,

      transactionReference:
        callback.transactionReference,

      status:
        callback.status,

      outcome:
        callback.outcome,

      amount:
        callback.amount,

      amountMinor:
        callback.amountMinor,

      currency:
        callback.currency,

      phoneNumber:
        callback.phoneNumber,

      occurredAt:
        callback.occurredAt,
    }),
  );
}

function payloadFingerprint(
  payload,
) {
  return sha256(
    redactedFingerprintInput(
      payload,
    ),
  );
}

function deriveCallbackId({
  payload,
  transaction,
  request,
  normalized,
}) {
  return normalizeString(
    firstValue(
      payload,
      [
        'callbackId',
        'eventId',
        'notificationId',
        'resourceId',
        'id',
      ],
    ) ||
      firstValue(
        request,
        [
          'callbackId',
          'eventId',
        ],
      ) ||
      firstValue(
        transaction,
        [
          'callbackId',
          'eventId',
        ],
      ) ||
      normalized?.callbackId,
    256,
  );
}

function deriveProviderTransactionId({
  payload,
  transaction,
  request,
  normalized,
}) {
  return normalizeString(
    firstValue(
      transaction,
      [
        'transactionId',
        'txnId',
        'transactionReference',
        'referenceId',
        'airtelTransactionId',
        'providerTransactionId',
        'externalTransactionId',
      ],
    ) ||
      firstValue(
        payload,
        [
          'providerTransactionId',
          'airtelTransactionId',
        ],
      ) ||
      firstValue(
        request,
        [
          'providerTransactionId',
        ],
      ) ||
      normalized?.providerTransactionId,
    256,
  );
}

function derivePaymentReference({
  payload,
  transaction,
  request,
  normalized,
}) {
  return normalizeString(
    firstValue(
      transaction,
      [
        'reference',
        'clientReference',
        'externalReference',
        'merchantTransactionId',
        'merchantReference',
        'requestReference',
        'paymentReference',
      ],
    ) ||
      firstValue(
        payload,
        [
          'paymentReference',
        ],
      ) ||
      firstValue(
        request,
        [
          'paymentReference',
        ],
      ) ||
      normalized?.paymentReference,
    256,
  );
}

function deriveTransactionReference({
  transaction,
  payload,
  providerTransactionId,
}) {
  return normalizeString(
    firstValue(
      transaction,
      [
        'transactionReference',
        'reference',
      ],
    ) ||
      firstValue(
        payload,
        [
          'transactionReference',
        ],
      ) ||
      providerTransactionId,
    256,
  );
}

function deriveStatus({
  payload,
  transaction,
  response,
}) {
  return normalizeUpper(
    firstValue(
      transaction,
      [
        'status',
        'transactionStatus',
        'result',
        'responseCode',
      ],
    ) ||
      firstValue(
        response,
        [
          'status',
          'resultCode',
          'responseCode',
        ],
      ) ||
      firstValue(
        payload,
        [
          'status',
        ],
      ),
    128,
  );
}

function deriveCallbackType({
  payload,
  transaction,
  options,
}) {
  return normalizeString(
    firstValue(
      payload,
      [
        'callbackType',
        'eventType',
        'type',
      ],
    ) ||
      firstValue(
        transaction,
        [
          'eventType',
        ],
      ) ||
      options.defaultCallbackType,
    options.maxCallbackTypeLength,
  );
}

function deriveAmount({
  payload,
  transaction,
}) {
  const explicitMinor =
    firstValue(
      transaction,
      [
        'amountMinor',
        'amountInMinorUnits',
        'minorAmount',
      ],
    ) ||
    firstValue(
      payload,
      [
        'amountMinor',
        'amountInMinorUnits',
      ],
    );

  const gross =
    normalizeAmount(
      firstValue(
        transaction,
        [
          'amount',
          'transactionAmount',
          'requestAmount',
          'grossAmount',
        ],
      ) ||
        firstValue(
          payload,
          [
            'amount',
            'transactionAmount',
          ],
        ),
    );

  return {
    amount:
      gross,

    amountMinorRaw:
      explicitMinor !== null &&
      explicitMinor !== undefined
        ? normalizeAmount(
            explicitMinor,
          )
        : null,
  };
}

function extractProviderReason({
  payload,
  transaction,
  response,
}) {
  return {
    code:
      normalizeString(
        firstValue(
          transaction,
          [
            'responseCode',
            'resultCode',
            'reasonCode',
          ],
        ) ||
          firstValue(
            response,
            [
              'code',
              'resultCode',
              'responseCode',
            ],
          ) ||
          firstValue(
            payload,
            [
              'reasonCode',
              'responseCode',
              'resultCode',
            ],
          ),
        128,
      ),

    message:
      normalizeString(
        firstValue(
          transaction,
          [
            'responseMessage',
            'resultMessage',
            'message',
            'description',
          ],
        ) ||
          firstValue(
            response,
            [
              'message',
              'description',
            ],
          ) ||
          firstValue(
            payload,
            [
              'message',
              'description',
            ],
          ),
        1000,
      ),
  };
}

function createImmutableCallback(
  callback,
) {
  return Object.freeze({
    ...callback,

    metadata:
      Object.freeze({
        ...(callback.metadata ||
          {}),
      }),
  });
}

export class AirtelCallbackNormalizer {
  constructor({
    configuration = {},
    logger = null,
    metrics = null,
    tracer = null,
    clock = Date,
  } = {}) {
    this.options = {
      ...DEFAULTS,
      ...(configuration || {}),

      successStatuses:
        Array.isArray(
          configuration?.successStatuses,
        )
          ? [
              ...configuration.successStatuses
                .map(
                  normalizeUpper,
                )
                .filter(Boolean),
            ]
          : [
              ...DEFAULTS.successStatuses,
            ],

      pendingStatuses:
        Array.isArray(
          configuration?.pendingStatuses,
        )
          ? [
              ...configuration.pendingStatuses
                .map(
                  normalizeUpper,
                )
                .filter(Boolean),
            ]
          : [
              ...DEFAULTS.pendingStatuses,
            ],

      failureStatuses:
        Array.isArray(
          configuration?.failureStatuses,
        )
          ? [
              ...configuration.failureStatuses
                .map(
                  normalizeUpper,
                )
                .filter(Boolean),
            ]
          : [
              ...DEFAULTS.failureStatuses,
            ],

      cancelledStatuses:
        Array.isArray(
          configuration?.cancelledStatuses,
        )
          ? [
              ...configuration.cancelledStatuses
                .map(
                  normalizeUpper,
                )
                .filter(Boolean),
            ]
          : [
              ...DEFAULTS.cancelledStatuses,
            ],

      reversedStatuses:
        Array.isArray(
          configuration?.reversedStatuses,
        )
          ? [
              ...configuration.reversedStatuses
                .map(
                  normalizeUpper,
                )
                .filter(Boolean),
            ]
          : [
              ...DEFAULTS.reversedStatuses,
            ],

      unknownStatuses:
        Array.isArray(
          configuration?.unknownStatuses,
        )
          ? [
              ...configuration.unknownStatuses
                .map(
                  normalizeUpper,
                )
                .filter(Boolean),
            ]
          : [
              ...DEFAULTS.unknownStatuses,
            ],

      minorUnitDefaults:
        {
          ...DEFAULTS.minorUnitDefaults,
          ...(configuration?.minorUnitDefaults ||
            {}),
        },
    };

    this.logger =
      logger ||
      null;

    this.metrics =
      metrics ||
      null;

    this.tracer =
      tracer ||
      null;

    this.clock =
      clock ||
      Date;

    this.runtime = {
      initialized:
        false,

      startedAt:
        now(this.clock),

      lastNormalizedAt:
        null,

      lastFailureAt:
        null,

      lastFailureCode:
        null,
    };

    this.statistics = {
      normalizeCalls:
        0,

      successfulNormalizations:
        0,

      invalidPayloads:
        0,

      invalidJson:
        0,

      payloadTooLarge:
        0,

      unknownOutcomes:
        0,

      successOutcomes:
        0,

      pendingOutcomes:
        0,

      failedOutcomes:
        0,

      cancelledOutcomes:
        0,

      reversedOutcomes:
        0,

      tenantFailures:
        0,

      callbackIdentityFailures:
        0,

      providerReferenceFailures:
        0,

      paymentReferenceFailures:
        0,

      metadataTruncations:
        0,
    };
  }

  async initialize() {
    this.runtime.initialized =
      true;

    return this;
  }

  async shutdown() {
    this.runtime.initialized =
      false;
  }

  async normalize(
    input = {},
  ) {
    const startedAt =
      Date.now();

    this.statistics.normalizeCalls +=
      1;

    const span =
      this.startSpan(
        'airtel.callback.normalization',
        {
          tenantId:
            input?.context
              ?.tenantId ||
            input?.tenantId,

          correlationId:
            input?.context
              ?.correlationId,

          operationId:
            input?.context
              ?.operationId,
        },
      );

    try {
      const {
        payload,
        request,
        context,
      } =
        this.resolveInput(
          input,
        );

      const normalizedPayload =
        parsePayload(
          payload,
          this.options,
        );

      const transaction =
        normalizedPayload
          .transaction ||
        normalizedPayload
          .data
          ?.transaction ||
        normalizedPayload.data ||
        normalizedPayload;

      const response =
        normalizedPayload.response ||
        normalizedPayload
          .data
          ?.response ||
        {};

      const trustedTenantId =
        this.resolveTrustedTenant({
          context,
          payload:
            normalizedPayload,
          request,
        });

      const provider =
        normalizeUpper(
          firstValue(
            normalizedPayload,
            [
              'provider',
              'providerName',
              'operator',
            ],
          ) ||
            PROVIDER,
        );

      if (
        provider !==
        PROVIDER
      ) {
        throw createNormalizationError(
          'AIRTEL_CALLBACK_PROVIDER_MISMATCH',
          `Expected ${PROVIDER} callback but received ${provider}.`,
          400,
        );
      }

      const callbackId =
        deriveCallbackId({
          payload:
            normalizedPayload,

          transaction,

          request,
        });

      const providerTransactionId =
        deriveProviderTransactionId({
          payload:
            normalizedPayload,

          transaction,

          request,
        });

      const paymentReference =
        derivePaymentReference({
          payload:
            normalizedPayload,

          transaction,

          request,
        });

      const transactionReference =
        deriveTransactionReference({
          transaction,

          payload:
            normalizedPayload,

          providerTransactionId,
        });

      const status =
        deriveStatus({
          payload:
            normalizedPayload,

          transaction,

          response,
        });

      const outcome =
        outcomeForStatus(
          status ||
            firstValue(
              normalizedPayload,
              [
                'outcome',
              ],
            ),
          transaction,
          response,
          this.options,
        );

      const amounts =
        deriveAmount({
          payload:
            normalizedPayload,

          transaction,
        });

      const currency =
        normalizeCurrency(
          firstValue(
            transaction,
            [
              'currency',
              'currencyCode',
            ],
          ) ||
            firstValue(
              normalizedPayload,
              [
                'currency',
                'currencyCode',
              ],
            ) ||
            firstValue(
              response,
              [
                'currency',
              ],
            ),
          this.options
            .defaultCurrency,
        );

      const amountMinor =
        amounts.amountMinorRaw
          ? normalizeMinorAmount(
              amounts.amountMinorRaw,
              currency,
              true,
            )
          : normalizeMinorAmount(
              amounts.amount,
              currency,
              false,
            );

      const phoneNumber =
        normalizePhone(
          firstValue(
            transaction,
            [
              'msisdn',
              'mobileNumber',
              'phoneNumber',
              'customerMsisdn',
            ],
          ) ||
            firstValue(
              normalizedPayload,
              [
                'msisdn',
                'phoneNumber',
              ],
            ),
        );

      const reason =
        extractProviderReason({
          payload:
            normalizedPayload,

          transaction,

          response,
        });

      const occurredAt =
        normalizeDate(
          firstValue(
            normalizedPayload,
            [
              'occurredAt',
              'timestamp',
              'event.timestamp',
            ],
          ) ||
            firstValue(
              transaction,
              [
                'timestamp',
                'createdAt',
                'updatedAt',
              ],
            ) ||
            now(this.clock),
        );

      const callbackType =
        deriveCallbackType({
          payload:
            normalizedPayload,

          transaction,

          options:
            this.options,
        });

      const payer =
        normalizeParty(
          firstValue(
            transaction,
            [
              'payer',
              'customer',
              'sender',
            ],
          ) ||
            firstValue(
              normalizedPayload,
              [
                'payer',
                'customer',
              ],
            ),
          this.options
            .maxPartyBytes,
        );

      const payee =
        normalizeParty(
          firstValue(
            transaction,
            [
              'payee',
              'recipient',
              'receiver',
            ],
          ) ||
            firstValue(
              normalizedPayload,
              [
                'payee',
                'recipient',
              ],
            ),
          this.options
            .maxPartyBytes,
        );

      const metadata =
        this.options
          .preserveSafeMetadata
          ? normalizeMetadata(
              firstValue(
                normalizedPayload,
                [
                  'metadata',
                ],
              ) ||
                firstValue(
                  transaction,
                  [
                    'metadata',
                  ],
                ) ||
                {},
              this.options
                .maxMetadataBytes,
            )
          : {};

      const normalized = {
        provider:
          PROVIDER,

        operation:
          OPERATION,

        schemaVersion:
          SCHEMA_VERSION,

        engineVersion:
          ENGINE_VERSION,

        normalizationStatus:
          NORMALIZATION_STATUSES
            .NORMALIZED,

        callbackId,

        callbackType,

        providerTransactionId,

        paymentReference,

        transactionReference,

        externalReference:
          normalizeString(
            firstValue(
              transaction,
              [
                'externalReference',
                'clientReference',
              ],
            ) ||
              firstValue(
                normalizedPayload,
                [
                  'externalReference',
                ],
              ),
            this.options
              .maxReferenceLength,
          ),

        customerReference:
          normalizeString(
            firstValue(
              transaction,
              [
                'customerReference',
                'customerId',
                'memberId',
                'subscriberId',
              ],
            ) ||
              firstValue(
                normalizedPayload,
                [
                  'customerReference',
                  'customerId',
                ],
              ),
            this.options
              .maxReferenceLength,
          ),

        status:
          status ||
          'UNKNOWN',

        outcome,

        amount:
          amounts.amount,

        amountMinor,

        currency,

        minorUnitExponent:
          this.resolveMinorUnitExponent(
            currency,
          ),

        phoneNumber,

        payer,

        payee,

        providerReasonCode:
          reason.code,

        providerReasonMessage:
          reason.message,

        fee:
          normalizeAmount(
            firstValue(
              transaction,
              [
                'fee',
                'serviceFee',
                'charges',
              ],
            ) ||
              firstValue(
                normalizedPayload,
                [
                  'fee',
                  'charges',
                ],
              ),
          ),

        rawTimestamp:
          normalizeString(
            firstValue(
              normalizedPayload,
              [
                'timestamp',
              ],
            ) ||
              firstValue(
                transaction,
                [
                  'timestamp',
                ],
              ),
            128,
          ),

        occurredAt,

        signatureVerified:
          Boolean(
            request
              ?.signatureVerified ===
              true ||
            context
              ?.signatureVerified ===
              true,
          ),

        securityVerified:
          Boolean(
            request
              ?.securityVerified ===
              true ||
            context
              ?.securityVerified ===
              true ||
            context
              ?.trustedCallback ===
              true,
          ),

        authenticated:
          Boolean(
            request
              ?.authenticated ===
              true ||
            context
              ?.authenticated ===
              true,
          ),

        tenantId:
          trustedTenantId,

        tenantSource:
          trustedTenantId
            ? this.tenantSource({
                context,
                request,
              })
            : null,

        metadata,

        payloadFingerprint:
          payloadFingerprint(
            normalizedPayload,
          ),

        callbackFingerprint:
          null,

        originalProviderPayloadHash:
          sha256(
            normalizedPayload,
          ),

        correlationId:
          normalizeString(
            context
              ?.correlationId ||
              request
                ?.correlationId,
            256,
          ),

        operationId:
          normalizeString(
            context
              ?.operationId ||
              request
                ?.operationId,
            256,
          ),

        requestId:
          normalizeString(
            context
              ?.requestId ||
              request
                ?.requestId,
            256,
          ),

        normalizedAt:
          now(
            this.clock,
          ).toISOString(),
      };

      this.validateCanonical(
        normalized,
      );

      normalized.callbackFingerprint =
        callbackFingerprint(
          normalized,
        );

      const immutable =
        createImmutableCallback(
          normalized,
        );

      this.recordOutcome(
        immutable.outcome,
      );

      this.statistics
        .successfulNormalizations +=
        1;

      this.runtime.lastNormalizedAt =
        now(this.clock);

      this.incrementMetric(
        'airtel_callback_normalizations_total',
        1,
        {
          outcome:
            immutable.outcome,
        },
      );

      this.incrementMetric(
        'airtel_callback_normalization_duration_ms',
        Date.now() -
          startedAt,
      );

      return immutable;
    } catch (error) {
      this.statistics.invalidPayloads +=
        1;

      this.runtime.lastFailureAt =
        now(this.clock);

      this.runtime.lastFailureCode =
        error?.code ||
        'AIRTEL_CALLBACK_NORMALIZATION_FAILED';

      if (
        error?.code ===
        'AIRTEL_CALLBACK_INVALID_JSON'
      ) {
        this.statistics.invalidJson +=
          1;
      }

      if (
        error?.code ===
        'AIRTEL_CALLBACK_PAYLOAD_TOO_LARGE'
      ) {
        this.statistics.payloadTooLarge +=
          1;
      }

      this.incrementMetric(
        'airtel_callback_normalization_failures_total',
        1,
        {
          code:
            error?.code ||
            'UNKNOWN',
        },
      );

      this.log(
        'warn',
        'Airtel callback normalization failed',
        {
          code:
            error?.code,

          tenantId:
            input?.context
              ?.tenantId ||
            input?.tenantId ||
            null,

          correlationId:
            input?.context
              ?.correlationId ||
            null,
        },
      );

      throw error;
    } finally {
      span?.end?.();
    }
  }

  async transform(
    input = {},
  ) {
    return this.normalize(
      input,
    );
  }

  async normalizeCallback(
    input = {},
  ) {
    return this.normalize(
      input,
    );
  }

  async process(
    input = {},
  ) {
    return this.normalize(
      input,
    );
  }

  resolveInput(
    input = {},
  ) {
    const isEnvelope =
      isPlainObject(input) &&
      (
        Object.prototype
          .hasOwnProperty
          .call(
            input,
            'payload',
          ) ||
        Object.prototype
          .hasOwnProperty
          .call(
            input,
            'rawPayload',
          ) ||
        Object.prototype
          .hasOwnProperty
          .call(
            input,
            'request',
          ) ||
        Object.prototype
          .hasOwnProperty
          .call(
            input,
            'context',
          )
      );

    if (!isEnvelope) {
      return {
        payload:
          input,

        request:
          {},

        context:
          {},
      };
    }

    return {
      payload:
        input.payload ??
        input.rawPayload ??
        input.callback ??
        input.data,

      request:
        input.request || {
          rawBody:
            input.rawBody,

          headers:
            input.headers,

          signatureVerified:
            input.signatureVerified,

          securityVerified:
            input.securityVerified,

          authenticated:
            input.authenticated,

          correlationId:
            input.correlationId,

          operationId:
            input.operationId,

          requestId:
            input.requestId,

          callbackId:
            input.callbackId,
        },

      context:
        input.context ||
        {},
    };
  }

  resolveTrustedTenant({
    context = {},
    request = {},
  }) {
    const tenantId =
      normalizeString(
        context
          ?.trustedTenantId ||
          context
            ?.tenantId ||
          request
            ?.trustedTenantId ||
          request
            ?.tenantId,
        256,
      );

    if (tenantId) {
      return tenantId;
    }

    if (
      this.options
        .requireTenantId
    ) {
      this.statistics
        .tenantFailures +=
        1;

      throw createNormalizationError(
        'AIRTEL_CALLBACK_TENANT_REQUIRED',
        'Trusted tenant context is required for Airtel callback normalization.',
        403,
      );
    }

    /*
     * Deliberately do not use payload.tenantId as tenant authority.
     * The normalizer can operate in an explicit non-tenant mode only when the
     * application has disabled tenant enforcement intentionally.
     */
    return null;
  }

  tenantSource({
    context = {},
    request = {},
  }) {
    if (
      context?.trustedTenantId
    ) {
      return 'TRUSTED_CONTEXT';
    }

    if (
      context?.tenantId
    ) {
      return 'CONTEXT';
    }

    if (
      request?.trustedTenantId
    ) {
      return 'TRUSTED_REQUEST_CONTEXT';
    }

    if (
      request?.tenantId
    ) {
      return 'REQUEST_CONTEXT';
    }

    return null;
  }

  validateCanonical(
    callback,
  ) {
    const errors = [];

    if (
      this.options
        .requireTenantId &&
      !callback.tenantId
    ) {
      errors.push({
        code:
          'AIRTEL_CALLBACK_TENANT_REQUIRED',

        field:
          'tenantId',
      });
    }

    if (
      this.options
        .requireCallbackIdentity &&
      !callback.callbackId &&
      !callback.providerTransactionId
    ) {
      errors.push({
        code:
          'AIRTEL_CALLBACK_IDENTITY_REQUIRED',

        field:
          'callbackId',
      });
    }

    if (
      this.options
        .requireProviderTransactionId &&
      !callback.providerTransactionId
    ) {
      errors.push({
        code:
          'AIRTEL_CALLBACK_PROVIDER_TRANSACTION_ID_REQUIRED',

        field:
          'providerTransactionId',
      });

      this.statistics
        .providerReferenceFailures +=
        1;
    }

    if (
      this.options
        .requirePaymentReference &&
      !callback.paymentReference
    ) {
      errors.push({
        code:
          'AIRTEL_CALLBACK_PAYMENT_REFERENCE_REQUIRED',

        field:
          'paymentReference',
      });

      this.statistics
        .paymentReferenceFailures +=
        1;
    }

    if (
      this.options.requireCurrency &&
      !callback.currency
    ) {
      errors.push({
        code:
          'AIRTEL_CALLBACK_CURRENCY_REQUIRED',

        field:
          'currency',
      });
    }

    if (
      this.options
        .requireAmountForFinancialCallback &&
      callback.amount === null &&
      callback.amountMinor === null
    ) {
      errors.push({
        code:
          'AIRTEL_CALLBACK_AMOUNT_REQUIRED',

        field:
          'amount',
      });
    }

    if (errors.length) {
      const error =
        createNormalizationError(
          errors[0].code,
          `Airtel callback canonical validation failed: ${errors
            .map(
              (item) =>
                item.field,
            )
            .join(', ')}.`,
          errors[0]
            .code
            .includes(
              'TENANT',
            )
            ? 403
            : 400,
        );

      error.details =
        errors;

      throw error;
    }

    return true;
  }

  resolveMinorUnitExponent(
    currency,
  ) {
    const exponent =
      this.options
        .minorUnitDefaults?.[
        currency
      ];

    return Number.isInteger(
      Number(exponent),
    ) &&
      Number(exponent) >= 0
      ? Number(exponent)
      : 2;
  }

  recordOutcome(
    outcome,
  ) {
    switch (outcome) {
      case CALLBACK_OUTCOMES
        .SUCCESS:
        this.statistics
          .successOutcomes +=
          1;
        break;

      case CALLBACK_OUTCOMES
        .PENDING:
        this.statistics
          .pendingOutcomes +=
          1;
        break;

      case CALLBACK_OUTCOMES
        .FAILED:
        this.statistics
          .failedOutcomes +=
          1;
        break;

      case CALLBACK_OUTCOMES
        .CANCELLED:
        this.statistics
          .cancelledOutcomes +=
          1;
        break;

      case CALLBACK_OUTCOMES
        .REVERSED:
        this.statistics
          .reversedOutcomes +=
          1;
        break;

      case CALLBACK_OUTCOMES
        .UNKNOWN:
      default:
        this.statistics
          .unknownOutcomes +=
          1;
        break;
    }
  }

  buildFingerprint(
    callback,
  ) {
    return callbackFingerprint(
      callback,
    );
  }

  buildPayloadFingerprint(
    payload,
  ) {
    return payloadFingerprint(
      payload,
    );
  }

  sanitize(
    value,
  ) {
    return safeClone(
      value,
    );
  }

  getProvider() {
    return PROVIDER;
  }

  getConfiguration() {
    return safeClone({
      ...this.options,
    });
  }

  capabilities() {
    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      normalization:
        true,

      jsonParsing:
        true,

      boundedPayloads:
        true,

      metadataSanitization:
        true,

      partySanitization:
        true,

      deterministicFingerprint:
        true,

      tenantContextEnforcement:
        Boolean(
          this.options
            .requireTenantId,
        ),

      providerOutcomeNormalization:
        true,

      directProviderHttp:
        false,

      directDatabaseMutation:
        false,

      directLedgerMutation:
        false,

      directBalanceMutation:
        false,

      directWalletMutation:
        false,

      settlementFinality:
        false,

      financialBoundary:
        FINANCIAL_BOUNDARY,
    };
  }

  statisticsSnapshot() {
    return safeClone(
      this.statistics,
    );
  }

  async health() {
    return {
      status:
        'UP',

      provider:
        PROVIDER,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      initialized:
        this.runtime
          .initialized,

      uptimeMs:
        Date.now() -
        this.runtime
          .startedAt
          .getTime(),

      checkedAt:
        now(
          this.clock,
        ).toISOString(),

      capabilities:
        this.capabilities(),

      statistics:
        this.statisticsSnapshot(),
    };
  }

  async readiness() {
    const health =
      await this.health();

    return {
      ready:
        true,

      ...health,
    };
  }

  async liveness() {
    return {
      alive:
        true,

      provider:
        PROVIDER,

      component:
        COMPONENT,

      timestamp:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  diagnostics() {
    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      configuration:
        this.getConfiguration(),

      capabilities:
        this.capabilities(),

      runtime:
        safeClone(
          this.runtime,
        ),

      statistics:
        this.statisticsSnapshot(),

      financialBoundary: {
        directProviderHttp:
          false,

        directLedgerMutation:
          false,

        directBalanceMutation:
          false,

        directWalletMutation:
          false,

        settlementFinality:
          false,

        authoritativeBoundary:
          FINANCIAL_BOUNDARY,
      },
    };
  }

  snapshot() {
    return this.diagnostics();
  }

  incrementMetric(
    name,
    value = 1,
    labels = undefined,
  ) {
    try {
      const method =
        [
          'increment',
          'inc',
          'counter',
        ].find(
          (candidate) =>
            isFunction(
              this.metrics?.[
                candidate
              ],
            ),
        );

      if (!method) {
        return;
      }

      if (
        labels !== undefined
      ) {
        this.metrics[
          method
        ](
          name,
          value,
          labels,
        );
      } else {
        this.metrics[
          method
        ](
          name,
          value,
        );
      }
    } catch {
      // Observability must not alter normalization behavior.
    }
  }

  startSpan(
    name,
    context = {},
  ) {
    try {
      if (
        !isFunction(
          this.tracer
            ?.startSpan,
        )
      ) {
        return null;
      }

      return this.tracer.startSpan(
        name,
        {
          attributes: {
            'titech.provider':
              PROVIDER,

            'titech.operation':
              OPERATION,

            'titech.tenant_id':
              context
                ?.tenantId ||
              'unknown',

            'titech.correlation_id':
              context
                ?.correlationId ||
              'unknown',

            'titech.operation_id':
              context
                ?.operationId ||
              'unknown',
          },
        },
      );
    } catch {
      return null;
    }
  }

  log(
    level,
    message,
    metadata = {},
  ) {
    try {
      const method =
        isFunction(
          this.logger?.[
            level
          ],
        )
          ? level
          : 'info';

      this.logger?.[
        method
      ]?.({
        message,

        provider:
          PROVIDER,

        component:
          COMPONENT,

        ...safeClone(
          metadata,
        ),
      });
    } catch {
      // Logging must never affect callback normalization.
    }
  }
}

export function createAirtelCallbackNormalizer(
  options = {},
) {
  return new AirtelCallbackNormalizer(
    options,
  );
}

export function createCallbackNormalizer(
  options = {},
) {
  return new AirtelCallbackNormalizer(
    options,
  );
}

export const CONSTANTS =
  Object.freeze({
    PROVIDER,
    OPERATION,
    COMPONENT,
    ENGINE_NAME,
    ENGINE_VERSION,
    SCHEMA_VERSION,
    HASH_ALGORITHM,
    FINANCIAL_BOUNDARY,
    CALLBACK_OUTCOMES,
    NORMALIZATION_STATUSES,
    DEFAULTS,
  });

export {
  callbackFingerprint,
  payloadFingerprint,
  normalizePhone,
  normalizeAmount,
  normalizeCurrency,
  normalizeDate,
  safeClone,
};

export default AirtelCallbackNormalizer;