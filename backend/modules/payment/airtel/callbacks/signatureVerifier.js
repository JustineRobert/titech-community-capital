/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Signature Verifier
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/callbacks/signatureVerifier.js
 *
 * Architectural role
 * ------------------
 * Canonical cryptographic authentication boundary for inbound Airtel callback
 * traffic. This module proves message integrity/authenticity; it does not
 * decide whether a payment is financially settled.
 *
 * Processing boundary
 * -------------------
 * HTTP transport -> raw-body capture -> THIS VERIFIER -> callback validator /
 * normalizer -> correlation -> dispatcher / processor -> Financial Core.
 *
 * Responsibilities
 * ----------------
 * - Extract and normalize callback signatures and signing timestamps.
 * - Resolve tenant-scoped signing secrets and support controlled secret rotation.
 * - Construct a deterministic signing input according to explicit deployment
 *   configuration.
 * - Generate HMAC-SHA256/HMAC-SHA512 signatures.
 * - Compare signatures in constant time.
 * - Enforce timestamp freshness and optional replay-cache protection.
 * - Return an explicit machine-readable verification result.
 * - Produce sanitized security audit/events and operational metrics.
 * - Expose verify(), validate(), verifySignature(), verifyWithRotation() and
 *   diagnostic/lifecycle contracts expected by callbackController.
 *
 * Explicitly NOT responsible for
 * -------------------------------
 * - Airtel OAuth/API calls.
 * - HTTP response handling.
 * - Callback schema validation.
 * - Tenant inference from untrusted payload data.
 * - Callback correlation.
 * - Duplicate/payment idempotency decisions.
 * - Fraud, KYC, AML or sanctions adjudication.
 * - Ledger posting, balance mutation or wallet mutation.
 * - Settlement/reconciliation finality.
 *
 * Security principles
 * -------------------
 * 1. Signing configuration is application-owned; callback fields cannot select
 *    the algorithm, secret or canonicalization mode.
 * 2. Raw request bytes are preferred for cryptographic verification whenever the
 *    configured Airtel contract requires them.
 * 3. Missing or malformed signature material never becomes a successful result.
 * 4. Indeterminate verification returns valid=false/verified=false and is never
 *    represented as an authenticated callback.
 * 5. Timestamp freshness is enforced independently of callback business state.
 * 6. Secret rotation accepts only explicitly configured tenant-scoped secrets.
 * 7. Audit/log/event projections hash or redact signature/secret material.
 * 8. Replay-cache state is security coordination, not financial truth.
 *
 * Provider-contract note
 * ----------------------
 * Airtel Africa exposes payment APIs through its developer platform, but the
 * public material does not establish one universal callback signature format
 * for every product/market. Therefore the exact canonicalization mode and
 * header names must be configured from the Airtel product contract for the
 * deployed integration; this verifier does not invent a provider-specific
 * signing format.
 *
 * Module format
 * -------------
 * Native ESM. No external dependencies.
 * =============================================================================
 */

import crypto from 'node:crypto';

export const PROVIDER = 'AIRTEL';
export const OPERATION = 'CALLBACK';
export const COMPONENT = 'titech.airtel.callbacks.signature-verifier';
export const ENGINE_NAME = 'airtel-callback-signature-verifier';
export const ENGINE_VERSION = '5.0.0';
export const SCHEMA_VERSION = 5;
export const HASH_ALGORITHM = 'sha256';

export const ALGORITHMS = Object.freeze({
  HMAC_SHA256: 'sha256',
  HMAC_SHA512: 'sha512',
});

export const SIGNATURE_STATUS = Object.freeze({
  VALID: 'VALID',
  INVALID: 'INVALID',
  MISSING: 'MISSING',
  EXPIRED: 'EXPIRED',
  UNAVAILABLE: 'UNAVAILABLE',
  MALFORMED: 'MALFORMED',
  REPLAY: 'REPLAY',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
});

export const CANONICALIZATION_MODES = Object.freeze({
  RAW_BODY: 'RAW_BODY',
  TIMESTAMP_RAW_BODY: 'TIMESTAMP_RAW_BODY',
  TIMESTAMP_DOT_RAW_BODY: 'TIMESTAMP_DOT_RAW_BODY',
  TIMESTAMP_NEWLINE_RAW_BODY: 'TIMESTAMP_NEWLINE_RAW_BODY',
  TIMESTAMP_JSON_PAYLOAD: 'TIMESTAMP_JSON_PAYLOAD',
  PAYLOAD_JSON: 'PAYLOAD_JSON',
});

export const SIGNATURE_ENCODINGS = Object.freeze({
  HEX: 'hex',
  BASE64: 'base64',
  BASE64URL: 'base64url',
});

export const DEFAULTS = Object.freeze({
  algorithm: ALGORITHMS.HMAC_SHA256,
  canonicalizationMode:
    CANONICALIZATION_MODES.TIMESTAMP_JSON_PAYLOAD,
  signatureEncoding:
    SIGNATURE_ENCODINGS.HEX,
  signaturePrefix: '',
  timestampToleranceSeconds: 300,
  requireTimestamp: true,
  requireRawBody: false,
  requireTenantId: true,
  requireSignature: true,
  allowEnvironmentSecretFallback: false,
  environmentSecretVariable:
    'AIRTEL_SIGNATURE_SECRET',
  requireReplayProtection: false,
  replayWindowSeconds: 600,
  replayKeyIncludeTenant: true,
  maxRawBodyBytes: 1024 * 1024,
  maxHeaderValueLength: 4096,
  caseInsensitiveHex: true,
  allowRotatedSecrets: true,
  maxRotatedSecrets: 3,
  auditEnabled: true,
  eventEnabled: true,
  failClosedOnAuditError: false,
  failClosedOnEventError: false,
  signatureHeaders: Object.freeze([
    'x-airtel-signature',
    'x-signature',
    'signature',
  ]),
  timestampHeaders: Object.freeze([
    'x-airtel-timestamp',
    'x-signature-timestamp',
    'x-timestamp',
  ]),
});

const SENSITIVE_KEY =
  /authorization|proxy.?authorization|cookie|secret|password|token|signature|private.?key|api.?key|credential|otp|pin|cvv|cvc|pan|refresh/i;

const BLOCKED_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object'
  );
}

function isFunction(value) {
  return typeof value === 'function';
}

function normalizeString(
  value,
  maxLength = 4096,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const output =
    String(value).trim();

  return output
    ? output.slice(
        0,
        maxLength,
      )
    : null;
}

function normalizeUpper(
  value,
  maxLength = 128,
) {
  const valueString =
    normalizeString(
      value,
      maxLength,
    );

  return valueString
    ? valueString.toUpperCase()
    : null;
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

  const output = {};

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
      SENSITIVE_KEY.test(
        key,
      )
    ) {
      output[key] =
        '[REDACTED]';
      continue;
    }

    output[key] =
      safeClone(
        child,
        depth + 1,
      );
  }

  return output;
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
    return `[BUFFER:${sha256(
      value,
    )}]`;
  }

  if (typeof value !== 'object') {
    return typeof value === 'bigint'
      ? String(value)
      : value;
  }

  if (Array.isArray(value)) {
    return value.map(
      (item) =>
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
        output,
        key,
      ) => {
        if (
          BLOCKED_KEYS.has(
            key,
          )
        ) {
          return output;
        }

        output[key] =
          canonicalize(
            value[key],
            depth + 1,
          );

        return output;
      },
      {},
    );
}

function sha256(value) {
  const source =
    Buffer.isBuffer(value)
      ? value
      : typeof value === 'string'
        ? value
        : JSON.stringify(
            canonicalize(value),
          );

  return crypto
    .createHash(
      HASH_ALGORITHM,
    )
    .update(source)
    .digest('hex');
}

function safeMetricLabel(
  value,
) {
  return (
    normalizeString(
      value,
      128,
    ) ||
    'unknown'
  );
}

function byteLength(
  value,
) {
  if (
    value === null ||
    value === undefined
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

  return Buffer.byteLength(
    JSON.stringify(value),
    'utf8',
  );
}

function normalizeHeaders(
  headers = {},
  maxLength =
    DEFAULTS.maxHeaderValueLength,
) {
  const output = {};

  for (
    const [key, value] of
      Object.entries(
        headers || {},
      )
  ) {
    const normalizedKey =
      String(key)
        .toLowerCase()
        .trim();

    if (!normalizedKey) {
      continue;
    }

    if (Array.isArray(value)) {
      output[normalizedKey] =
        value
          .slice(0, 4)
          .map((item) =>
            normalizeString(
              item,
              maxLength,
            ),
          )
          .filter(Boolean)
          .join(', ');

      continue;
    }

    output[normalizedKey] =
      normalizeString(
        value,
        maxLength,
      );
  }

  return output;
}

function extractPath(
  source,
  paths = [],
) {
  for (const path of paths) {
    let cursor =
      source;

    for (
      const segment of
        path.split('.')
    ) {
      if (
        !isObject(cursor) &&
        !Array.isArray(cursor)
      ) {
        cursor =
          undefined;
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

function parseJsonPayload(
  payload,
) {
  if (Buffer.isBuffer(payload)) {
    return JSON.parse(
      payload.toString(
        'utf8',
      ),
    );
  }

  if (typeof payload === 'string') {
    return JSON.parse(
      payload,
    );
  }

  return payload;
}

function normalizeTimestampValue(
  value,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const raw =
    String(value).trim();

  if (!raw) {
    return null;
  }

  if (
    /^\d+(?:\.\d+)?$/.test(
      raw,
    )
  ) {
    const number =
      Number(raw);

    if (!Number.isFinite(number)) {
      return null;
    }

    const milliseconds =
      number < 1e12
        ? number * 1000
        : number;

    const date =
      new Date(
        milliseconds,
      );

    return Number.isNaN(
      date.getTime(),
    )
      ? null
      : date;
  }

  const date =
    new Date(raw);

  return Number.isNaN(
    date.getTime(),
  )
    ? null
    : date;
}

function normalizeSignatureEncoding(
  value,
) {
  const normalized =
    normalizeString(
      value,
      32,
    )?.toLowerCase();

  return Object.values(
    SIGNATURE_ENCODINGS,
  ).includes(
    normalized,
  )
    ? normalized
    : null;
}

function stripSignaturePrefix(
  signature,
) {
  const value =
    normalizeString(
      signature,
      4096,
    );

  if (!value) {
    return null;
  }

  return value
    .replace(
      /^sha256=/i,
      '',
    )
    .replace(
      /^sha512=/i,
      '',
    )
    .trim();
}

function validateSignatureCharacters(
  signature,
  encoding,
) {
  if (!signature) {
    return false;
  }

  if (
    encoding ===
    SIGNATURE_ENCODINGS.HEX
  ) {
    return (
      /^[0-9a-f]+$/i.test(
        signature,
      ) &&
      signature.length % 2 === 0
    );
  }

  if (
    encoding ===
    SIGNATURE_ENCODINGS.BASE64
  ) {
    return /^[a-z0-9+/]+={0,2}$/i.test(
      signature,
    );
  }

  if (
    encoding ===
    SIGNATURE_ENCODINGS.BASE64URL
  ) {
    return /^[a-z0-9_-]+$/i.test(
      signature,
    );
  }

  return false;
}

function decodeSignature(
  signature,
  encoding,
) {
  if (
    !validateSignatureCharacters(
      signature,
      encoding,
    )
  ) {
    return null;
  }

  try {
    if (
      encoding ===
      SIGNATURE_ENCODINGS.HEX
    ) {
      return Buffer.from(
        signature,
        'hex',
      );
    }

    if (
      encoding ===
      SIGNATURE_ENCODINGS.BASE64
    ) {
      return Buffer.from(
        signature,
        'base64',
      );
    }

    return Buffer.from(
      signature,
      'base64url',
    );
  } catch {
    return null;
  }
}

function constantTimeBufferEqual(
  expected,
  received,
) {
  if (
    !Buffer.isBuffer(expected) ||
    !Buffer.isBuffer(received)
  ) {
    return false;
  }

  if (
    expected.length !==
    received.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    expected,
    received,
  );
}

function normalizeSecretCandidate(
  candidate,
) {
  if (
    candidate === null ||
    candidate === undefined
  ) {
    return null;
  }

  if (
    typeof candidate ===
    'string'
  ) {
    return {
      secret:
        candidate,

      version:
        null,

      active:
        true,
    };
  }

  if (isObject(candidate)) {
    const secret =
      candidate.secret ??
      candidate.value ??
      candidate.signingSecret ??
      candidate.key;

    if (!secret) {
      return null;
    }

    return {
      secret: String(secret),

      version:
        normalizeString(
          candidate.version ??
            candidate.keyId ??
            candidate.id,
          256,
        ),

      active:
        candidate.active !==
        false,

      validFrom:
        candidate.validFrom ??
        null,

      validTo:
        candidate.validTo ??
        null,
    };
  }

  return null;
}

function normalizeSecrets(
  value,
  maxSecrets,
) {
  const source =
    Array.isArray(value)
      ? value
      : [value];

  return source
    .map(
      normalizeSecretCandidate,
    )
    .filter(Boolean)
    .filter(
      (item) =>
        item.secret.length >
        0,
    )
    .slice(
      0,
      maxSecrets,
    );
}

function validateSecret(
  secret,
) {
  if (
    !secret ||
    typeof secret !==
      'string'
  ) {
    throw createVerifierError(
      'AIRTEL_CALLBACK_SIGNATURE_SECRET_INVALID',
      'Airtel callback signing secret is invalid.',
      503,
      true,
    );
  }
}

function createVerifierError(
  code,
  message,
  statusCode = 500,
  retryable = false,
  details = {},
) {
  const error =
    new Error(
      message,
    );

  error.name =
    'AirtelCallbackSignatureVerifierError';

  error.code =
    code;

  error.statusCode =
    statusCode;

  error.retryable =
    retryable;

  error.details =
    safeClone(
      details,
    );

  return error;
}

function isSecurityRejectionStatus(
  status,
) {
  return [
    SIGNATURE_STATUS.INVALID,
    SIGNATURE_STATUS.MISSING,
    SIGNATURE_STATUS.EXPIRED,
    SIGNATURE_STATUS.MALFORMED,
    SIGNATURE_STATUS.REPLAY,
  ].includes(
    status,
  );
}

export class AirtelCallbackSignatureVerifier {
  constructor({
    secretProvider = null,
    replayStore = null,
    configuration = {},
    auditService = null,
    eventBus = null,
    outboxService = null,
    metrics = null,
    tracer = null,
    logger = null,
    clock = Date,
  } = {}) {
    this.secretProvider =
      secretProvider;

    this.replayStore =
      replayStore;

    this.configuration =
      configuration || {};

    this.auditService =
      auditService;

    this.eventBus =
      eventBus;

    this.outboxService =
      outboxService;

    this.metrics =
      metrics;

    this.tracer =
      tracer;

    this.logger =
      logger || console;

    this.clock =
      clock || Date;

    this.options =
      this.buildConfiguration(
        this.configuration,
      );

    this.statistics = {
      verified: 0,
      invalid: 0,
      missing: 0,
      expired: 0,
      malformed: 0,
      replayed: 0,
      unavailable: 0,
      secretFailures: 0,
      rotationSuccesses: 0,
      rotationAttempts: 0,
      replayStoreFailures: 0,
      auditFailures: 0,
      eventFailures: 0,
      verificationAttempts: 0,
    };

    this.runtime = {
      initialized: false,
      startedAt:
        this.currentTime(),
      lastVerifiedAt: null,
      lastFailureAt: null,
      lastFailureCode: null,
    };
  }

  buildConfiguration(
    configuration,
  ) {
    const result = {
      ...DEFAULTS,
      ...(configuration || {}),
    };

    result.algorithm =
      normalizeString(
        configuration?.algorithm ??
          DEFAULTS.algorithm,
        32,
      )?.toLowerCase();

    if (
      !Object.values(
        ALGORITHMS,
      ).includes(
        result.algorithm,
      )
    ) {
      throw createVerifierError(
        'AIRTEL_CALLBACK_SIGNATURE_ALGORITHM_INVALID',
        `Unsupported Airtel callback signature algorithm: ${result.algorithm}`,
        500,
      );
    }

    result.canonicalizationMode =
      normalizeString(
        configuration?.canonicalizationMode ??
          DEFAULTS.canonicalizationMode,
        64,
      )?.toUpperCase();

    if (
      !Object.values(
        CANONICALIZATION_MODES,
      ).includes(
        result.canonicalizationMode,
      )
    ) {
      throw createVerifierError(
        'AIRTEL_CALLBACK_CANONICALIZATION_MODE_INVALID',
        `Unsupported Airtel callback canonicalization mode: ${result.canonicalizationMode}`,
        500,
      );
    }

    result.signatureEncoding =
      normalizeSignatureEncoding(
        configuration?.signatureEncoding ??
          DEFAULTS.signatureEncoding,
      );

    if (
      !result.signatureEncoding
    ) {
      throw createVerifierError(
        'AIRTEL_CALLBACK_SIGNATURE_ENCODING_INVALID',
        'Unsupported Airtel callback signature encoding.',
        500,
      );
    }

    result.timestampToleranceSeconds =
      this.normalizePositiveNumber(
        configuration?.timestampToleranceSeconds ??
          DEFAULTS.timestampToleranceSeconds,
        'timestampToleranceSeconds',
      );

    result.replayWindowSeconds =
      this.normalizePositiveNumber(
        configuration?.replayWindowSeconds ??
          DEFAULTS.replayWindowSeconds,
        'replayWindowSeconds',
      );

    result.maxRawBodyBytes =
      this.normalizePositiveNumber(
        configuration?.maxRawBodyBytes ??
          DEFAULTS.maxRawBodyBytes,
        'maxRawBodyBytes',
      );

    result.maxHeaderValueLength =
      this.normalizePositiveNumber(
        configuration?.maxHeaderValueLength ??
          DEFAULTS.maxHeaderValueLength,
        'maxHeaderValueLength',
      );

    result.maxRotatedSecrets =
      this.normalizePositiveNumber(
        configuration?.maxRotatedSecrets ??
          DEFAULTS.maxRotatedSecrets,
        'maxRotatedSecrets',
      );

    result.signatureHeaders =
      Array.isArray(
        configuration?.signatureHeaders,
      )
        ? configuration.signatureHeaders.map(
            (item) =>
              String(item).toLowerCase(),
          )
        : [
            ...DEFAULTS.signatureHeaders,
          ];

    result.timestampHeaders =
      Array.isArray(
        configuration?.timestampHeaders,
      )
        ? configuration.timestampHeaders.map(
            (item) =>
              String(item).toLowerCase(),
          )
        : [
            ...DEFAULTS.timestampHeaders,
          ];

    result.signaturePrefix =
      normalizeString(
        configuration?.signaturePrefix ??
          DEFAULTS.signaturePrefix,
        64,
      ) || '';

    return result;
  }

  normalizePositiveNumber(
    value,
    field,
  ) {
    const number =
      Number(value);

    if (
      !Number.isFinite(
        number,
      ) ||
      number <= 0
    ) {
      throw createVerifierError(
        'AIRTEL_CALLBACK_SIGNATURE_CONFIGURATION_INVALID',
        `${field} must be a positive number.`,
        500,
      );
    }

    return number;
  }

  async initialize() {
    this.runtime.initialized =
      true;

    return this.health();
  }

  async shutdown() {
    this.runtime.initialized =
      false;

    return this.health();
  }

  /**
   * Primary controller contract.
   *
   * Returns an explicit structured result. This is intentionally NOT a bare
   * boolean because callbackController requires valid=true AND verified=true.
   */
  async verify({
    tenantId,
    payload,
    rawBody = undefined,
    headers = {},
    signature = null,
    signatureTimestamp = null,
    correlationId =
      crypto.randomUUID(),
    operationId =
      crypto.randomUUID(),
    context = {},
  } = {}) {
    await this.ensureReady();

    this.statistics.verificationAttempts +=
      1;

    const span =
      this.startSpan(
        'airtel.signature.verify',
        {
          tenantId,
          correlationId,
          operationId,
        },
      );

    const normalizedHeaders =
      normalizeHeaders(
        headers,
        this.options
          .maxHeaderValueLength,
      );

    const startedAt =
      Date.now();

    try {
      const trustedTenantId =
        this.resolveTrustedTenant({
          tenantId,
          context,
        });

      const extractedSignature =
        normalizeString(
          signature,
          this.options
            .maxHeaderValueLength,
        ) ||
        this.extractSignature(
          normalizedHeaders,
        );

      const extractedTimestamp =
        normalizeString(
          signatureTimestamp,
          this.options
            .maxHeaderValueLength,
        ) ||
        this.extractTimestamp({
          payload,
          headers:
            normalizedHeaders,
        });

      const signatureResult =
        this.validateSignaturePresence(
          extractedSignature,
        );

      if (signatureResult) {
        return this.finishResult(
          {
            ...signatureResult,

            tenantId:
              trustedTenantId,

            correlationId,

            operationId,

            durationMs:
              Date.now() -
              startedAt,
          },
          span,
        );
      }

      const timestampResult =
        this.validateTimestamp(
          extractedTimestamp,
        );

      if (!timestampResult.valid) {
        return this.finishResult(
          {
            ...timestampResult,

            tenantId:
              trustedTenantId,

            correlationId,

            operationId,

            durationMs:
              Date.now() -
              startedAt,
          },
          span,
        );
      }

      const canonical =
        this.buildCanonicalPayload({
          payload,
          rawBody,
          timestamp:
            extractedTimestamp,
          headers:
            normalizedHeaders,
          context,
        });

      const secrets =
        await this.resolveSecrets({
          tenantId:
            trustedTenantId,
        });

      const preparedSignature =
        this.prepareReceivedSignature(
          extractedSignature,
        );

      if (!preparedSignature) {
        const result = {
          valid: false,
          verified: false,
          status:
            SIGNATURE_STATUS.MALFORMED,
          code:
            'AIRTEL_CALLBACK_SIGNATURE_MALFORMED',
          tenantId:
            trustedTenantId,
          correlationId,
          operationId,
        };

        return this.finishResult(
          result,
          span,
        );
      }

      const replayResult =
        await this.checkReplay({
          tenantId:
            trustedTenantId,
          signature:
            preparedSignature,
          timestamp:
            extractedTimestamp,
          callbackId:
            context?.callbackId,
          correlationId,
        });

      if (
        !replayResult.allowed
      ) {
        return this.finishResult(
          {
            valid: false,
            verified: false,
            status:
              SIGNATURE_STATUS.REPLAY,
            code:
              'AIRTEL_CALLBACK_SIGNATURE_REPLAY_DETECTED',
            tenantId:
              trustedTenantId,
            correlationId,
            operationId,
            timestamp:
              timestampResult.timestamp.toISOString(),
            ageMs:
              timestampResult.ageMs,
          },
          span,
        );
      }

      const verification =
        this.verifyAgainstSecrets({
          canonical,
          receivedSignature:
            preparedSignature,
          secrets,
        });

      if (!verification.valid) {
        const result = {
          valid: false,
          verified: false,
          status:
            SIGNATURE_STATUS.INVALID,
          code:
            'AIRTEL_CALLBACK_SIGNATURE_INVALID',
          tenantId:
            trustedTenantId,
          correlationId,
          operationId,
          algorithm:
            this.options.algorithm,
          signatureEncoding:
            this.options.signatureEncoding,
          canonicalizationMode:
            this.options
              .canonicalizationMode,
          timestamp:
            timestampResult.timestamp.toISOString(),
          ageMs:
            timestampResult.ageMs,
          signatureHash:
            sha256(
              preparedSignature,
            ),
        };

        return this.finishResult(
          result,
          span,
        );
      }

      if (
        verification.rotationIndex >
        0
      ) {
        this.statistics.rotationSuccesses +=
          1;
      }

      const result = {
        valid: true,
        verified: true,
        status:
          SIGNATURE_STATUS.VALID,
        code:
          'AIRTEL_CALLBACK_SIGNATURE_VERIFIED',
        tenantId:
          trustedTenantId,
        correlationId,
        operationId,
        algorithm:
          this.options.algorithm,
        signatureEncoding:
          this.options.signatureEncoding,
        canonicalizationMode:
          this.options
            .canonicalizationMode,
        timestamp:
          timestampResult.timestamp.toISOString(),
        ageMs:
          timestampResult.ageMs,
        secretVersion:
          verification.secretVersion,
        secretRotationIndex:
          verification.rotationIndex,
        signatureHash:
          sha256(
            preparedSignature,
          ),
      };

      await this.markReplay({
        tenantId:
          trustedTenantId,
        signature:
          preparedSignature,
        timestamp:
          extractedTimestamp,
        callbackId:
          context?.callbackId,
        correlationId,
      });

      return this.finishResult(
        result,
        span,
      );
    } catch (error) {
      this.statistics.unavailable +=
        1;

      this.runtime.lastFailureAt =
        this.currentTime();

      this.runtime.lastFailureCode =
        error?.code ||
        'AIRTEL_CALLBACK_SIGNATURE_VERIFICATION_FAILED';

      await this.safeAudit(
        'AIRTEL_SIGNATURE_VERIFICATION_ERROR',
        {
          tenantId,
          correlationId,
          operationId,
          metadata: {
            code:
              error?.code ||
              'UNKNOWN',

            retryable:
              Boolean(
                error?.retryable,
              ),
          },
        },
      );

      throw error;
    } finally {
      this.incrementMetric(
        'airtel_callback_signature_verification_duration_ms',
        Date.now() -
          startedAt,
      );

      span?.end?.();
    }
  }

  async validate(
    args = {},
  ) {
    return this.verify(
      args,
    );
  }

  async verifySignature(
    args = {},
  ) {
    return this.verify(
      args,
    );
  }

  async verifyWithRotation(
    args = {},
  ) {
    return this.verify({
      ...args,
    });
  }

  validateSignaturePresence(
    signature,
  ) {
    if (signature) {
      return null;
    }

    if (
      !this.options
        .requireSignature
    ) {
      return {
        valid: false,
        verified: false,
        status:
          SIGNATURE_STATUS.UNAVAILABLE,
        code:
          'AIRTEL_CALLBACK_SIGNATURE_NOT_REQUIRED',
      };
    }

    this.statistics.missing +=
      1;

    return {
      valid: false,
      verified: false,
      status:
        SIGNATURE_STATUS.MISSING,
      code:
        'AIRTEL_CALLBACK_SIGNATURE_MISSING',
    };
  }

  prepareReceivedSignature(
    signature,
  ) {
    const stripped =
      stripSignaturePrefix(
        signature,
      );

    if (!stripped) {
      return null;
    }

    if (
      this.options.signaturePrefix
    ) {
      const prefix =
        this.options
          .signaturePrefix;

      if (
        !stripped.startsWith(
          prefix,
        )
      ) {
        return null;
      }

      return stripped.slice(
        prefix.length,
      );
    }

    if (
      this.options
        .caseInsensitiveHex &&
      this.options
        .signatureEncoding ===
        SIGNATURE_ENCODINGS.HEX
    ) {
      return stripped.toLowerCase();
    }

    return stripped;
  }

  generateSignature({
    payload,
    rawBody = undefined,
    timestamp = undefined,
    headers = {},
    secret,
    tenantId = null,
    context = {},
  } = {}) {
    validateSecret(
      secret,
    );

    const canonical =
      this.buildCanonicalPayload({
        payload,
        rawBody,
        timestamp,
        headers:
          normalizeHeaders(
            headers,
            this.options
              .maxHeaderValueLength,
          ),
        context,
      });

    const digest =
      crypto
        .createHmac(
          this.options.algorithm,
          secret,
        )
        .update(
          canonical,
        )
        .digest();

    const encoded =
      this.encodeSignature(
        digest,
      );

    return this.options
      .signaturePrefix
      ? `${this.options.signaturePrefix}${encoded}`
      : encoded;
  }

  buildCanonicalPayload({
    payload,
    rawBody,
    timestamp,
  } = {}) {
    const mode =
      this.options
        .canonicalizationMode;

    const normalizedTimestamp =
      normalizeString(
        timestamp,
        this.options
          .maxHeaderValueLength,
      ) || '';

    switch (mode) {
      case CANONICALIZATION_MODES.RAW_BODY: {
        return this.requireRawBody(
          rawBody,
        );
      }

      case CANONICALIZATION_MODES.TIMESTAMP_RAW_BODY: {
        return `${normalizedTimestamp}${this.requireRawBody(
          rawBody,
        )}`;
      }

      case CANONICALIZATION_MODES.TIMESTAMP_DOT_RAW_BODY: {
        return `${normalizedTimestamp}.${this.requireRawBody(
          rawBody,
        )}`;
      }

      case CANONICALIZATION_MODES.TIMESTAMP_NEWLINE_RAW_BODY: {
        return `${normalizedTimestamp}\n${this.requireRawBody(
          rawBody,
        )}`;
      }

      case CANONICALIZATION_MODES.PAYLOAD_JSON: {
        return JSON.stringify(
          canonicalize(
            payload,
          ),
        );
      }

      case CANONICALIZATION_MODES.TIMESTAMP_JSON_PAYLOAD:
      default: {
        let safePayload =
          payload;

        if (
          Buffer.isBuffer(
            safePayload,
          ) ||
          typeof safePayload ===
            'string'
        ) {
          safePayload =
            parseJsonPayload(
              safePayload,
            );
        }

        return JSON.stringify({
          timestamp:
            normalizedTimestamp,

          payload:
            safePayload,
        });
      }
    }
  }

  requireRawBody(
    rawBody,
  ) {
    if (
      rawBody === undefined ||
      rawBody === null
    ) {
      throw createVerifierError(
        'AIRTEL_CALLBACK_SIGNATURE_RAW_BODY_REQUIRED',
        'The configured Airtel signature scheme requires the original raw request body.',
        400,
      );
    }

    if (
      byteLength(
        rawBody,
      ) >
      this.options
        .maxRawBodyBytes
    ) {
      throw createVerifierError(
        'AIRTEL_CALLBACK_SIGNATURE_RAW_BODY_TOO_LARGE',
        'The Airtel callback raw body exceeds the configured cryptographic verification limit.',
        413,
      );
    }

    return Buffer.isBuffer(
      rawBody,
    )
      ? rawBody.toString(
          'utf8',
        )
      : String(rawBody);
  }

  encodeSignature(
    digest,
  ) {
    switch (
      this.options
        .signatureEncoding
    ) {
      case SIGNATURE_ENCODINGS.HEX:
        return digest.toString(
          'hex',
        );

      case SIGNATURE_ENCODINGS.BASE64:
        return digest.toString(
          'base64',
        );

      case SIGNATURE_ENCODINGS.BASE64URL:
        return digest.toString(
          'base64url',
        );

      default:
        throw createVerifierError(
          'AIRTEL_CALLBACK_SIGNATURE_ENCODING_INVALID',
          'Unsupported signature encoding.',
          500,
        );
    }
  }

  safeCompare(
    expected,
    received,
  ) {
    const expectedBuffer =
      decodeSignature(
        this.normalizeComparableSignature(
          expected,
        ),
        this.options
          .signatureEncoding,
      );

    const receivedBuffer =
      decodeSignature(
        this.normalizeComparableSignature(
          received,
        ),
        this.options
          .signatureEncoding,
      );

    return constantTimeBufferEqual(
      expectedBuffer,
      receivedBuffer,
    );
  }

  normalizeComparableSignature(
    value,
  ) {
    const normalized =
      stripSignaturePrefix(
        value,
      );

    if (!normalized) {
      return '';
    }

    if (
      this.options
        .signatureEncoding ===
        SIGNATURE_ENCODINGS.HEX &&
      this.options
        .caseInsensitiveHex
    ) {
      return normalized.toLowerCase();
    }

    return normalized;
  }

  verifyAgainstSecrets({
    canonical,
    receivedSignature,
    secrets,
  }) {
    const received =
      decodeSignature(
        this.normalizeComparableSignature(
          receivedSignature,
        ),
        this.options
          .signatureEncoding,
      );

    if (!received) {
      this.statistics.malformed +=
        1;

      return {
        valid: false,
        rotationIndex: -1,
        secretVersion: null,
      };
    }

    this.statistics
      .rotationAttempts +=
      Math.max(
        0,
        secrets.length - 1,
      );

    for (
      let index = 0;
      index < secrets.length;
      index += 1
    ) {
      const candidate =
        secrets[index];

      if (
        candidate.active ===
        false
      ) {
        continue;
      }

      validateSecret(
        candidate.secret,
      );

      const expected =
        crypto
          .createHmac(
            this.options.algorithm,
            candidate.secret,
          )
          .update(
            canonical,
          )
          .digest();

      if (
        constantTimeBufferEqual(
          expected,
          received,
        )
      ) {
        return {
          valid: true,
          rotationIndex:
            index,
          secretVersion:
            candidate.version,
        };
      }
    }

    return {
      valid: false,
      rotationIndex: -1,
      secretVersion: null,
    };
  }

  async resolveSecrets({
    tenantId,
  }) {
    let secrets = [];

    try {
      if (
        this.secretProvider
      ) {
        const method = [
          'getSigningSecrets',
          'getSecrets',
          'resolveSecrets',
        ].find(
          (name) =>
            isFunction(
              this.secretProvider?.[
                name
              ],
            ),
        );

        if (method) {
          secrets =
            await this
              .secretProvider[
                method
              ]({
                provider:
                  PROVIDER,

                tenantId,

                purpose:
                  'CALLBACK_SIGNATURE',
              });
        }

        if (!secrets?.length) {
          const singleMethod = [
            'getSigningSecret',
            'getSecret',
            'resolveSecret',
          ].find(
            (name) =>
              isFunction(
                this.secretProvider?.[
                  name
                ],
              ),
          );

          if (singleMethod) {
            const single =
              await this
                .secretProvider[
                  singleMethod
                ]({
                  provider:
                    PROVIDER,

                  tenantId,

                  purpose:
                    'CALLBACK_SIGNATURE',
                });

            secrets =
              single;
          }
        }
      }

      if (!secrets?.length) {
        const configured =
          this.configuration
            ?.airtelSignatureSecrets ??
          this.configuration
            ?.airtelSigningSecrets ??
          this.configuration
            ?.airtelSignatureSecret ??
          this.configuration
            ?.airtelSigningSecret;

        if (configured) {
          secrets =
            configured;
        }
      }

      if (
        !secrets?.length &&
        this.options
          .allowEnvironmentSecretFallback
      ) {
        const envSecret =
          process.env[
            this.options
              .environmentSecretVariable
          ];

        if (envSecret) {
          secrets =
            envSecret;
        }
      }

      const normalized =
        normalizeSecrets(
          secrets,
          this.options
            .maxRotatedSecrets,
        );

      if (
        !normalized.length
      ) {
        this.statistics
          .secretFailures +=
          1;

        throw createVerifierError(
          'AIRTEL_CALLBACK_SIGNATURE_SECRET_UNAVAILABLE',
          'No Airtel callback signing secret is configured for the trusted tenant.',
          503,
          true,
        );
      }

      return normalized;
    } catch (error) {
      if (
        error?.code ===
        'AIRTEL_CALLBACK_SIGNATURE_SECRET_UNAVAILABLE'
      ) {
        throw error;
      }

      this.statistics
        .secretFailures +=
        1;

      throw createVerifierError(
        'AIRTEL_CALLBACK_SIGNATURE_SECRET_RESOLUTION_FAILED',
        'Airtel callback signing secret resolution failed.',
        503,
        true,
        {
          causeCode:
            error?.code,
        },
      );
    }
  }

  resolveTrustedTenant({
    tenantId,
    context = {},
  }) {
    const resolved =
      normalizeString(
        tenantId ||
          context?.trustedTenantId ||
          context?.tenantId ||
          context?.tenant?.id,
        256,
      );

    if (
      !resolved &&
      this.options
        .requireTenantId
    ) {
      throw createVerifierError(
        'AIRTEL_CALLBACK_SIGNATURE_TENANT_REQUIRED',
        'Trusted tenant context is required for Airtel callback signature verification.',
        403,
      );
    }

    return resolved;
  }

  extractSignature(
    headers = {},
  ) {
    const normalized =
      normalizeHeaders(
        headers,
        this.options
          .maxHeaderValueLength,
      );

    for (
      const header of
        this.options
          .signatureHeaders
    ) {
      const value =
        normalized[
          String(
            header,
          ).toLowerCase()
        ];

      if (value) {
        return value;
      }
    }

    return null;
  }

  extractTimestamp({
    payload,
    headers = {},
  } = {}) {
    const normalized =
      normalizeHeaders(
        headers,
        this.options
          .maxHeaderValueLength,
      );

    for (
      const header of
        this.options
          .timestampHeaders
    ) {
      const value =
        normalized[
          String(
            header,
          ).toLowerCase()
        ];

      if (value) {
        return value;
      }
    }

    if (
      isObject(payload)
    ) {
      return extractPath(
        payload,
        [
          'timestamp',
          'signatureTimestamp',
          'event.timestamp',
          'transaction.timestamp',
          'createdAt',
        ],
      );
    }

    return null;
  }

  validateTimestamp(
    timestamp,
  ) {
    if (!timestamp) {
      if (
        this.options
          .requireTimestamp
      ) {
        return {
          valid: false,
          verified: false,
          status:
            SIGNATURE_STATUS.MISSING,
          code:
            'AIRTEL_CALLBACK_SIGNATURE_TIMESTAMP_MISSING',
        };
      }

      return {
        valid: true,
        verified: false,
        status:
          SIGNATURE_STATUS.UNAVAILABLE,
        code:
          'AIRTEL_CALLBACK_SIGNATURE_TIMESTAMP_NOT_REQUIRED',
        timestamp: null,
        ageMs: null,
      };
    }

    const date =
      normalizeTimestampValue(
        timestamp,
      );

    if (!date) {
      this.statistics
        .malformed +=
        1;

      return {
        valid: false,
        verified: false,
        status:
          SIGNATURE_STATUS.MALFORMED,
        code:
          'AIRTEL_CALLBACK_SIGNATURE_TIMESTAMP_INVALID',
      };
    }

    const ageMs =
      Math.abs(
        this.currentTime().getTime() -
          date.getTime(),
      );

    if (
      ageMs >
      this.options
        .timestampToleranceSeconds *
        1000
    ) {
      this.statistics
        .expired +=
        1;

      return {
        valid: false,
        verified: false,
        status:
          SIGNATURE_STATUS.EXPIRED,
        code:
          'AIRTEL_CALLBACK_SIGNATURE_TIMESTAMP_EXPIRED',
        timestamp: date,
        ageMs,
      };
    }

    return {
      valid: true,
      timestamp: date,
      ageMs,
    };
  }

  buildReplayKey({
    tenantId,
    signature,
    timestamp,
    callbackId,
  }) {
    const parts = [
      PROVIDER,
      OPERATION,
      this.options
        .replayKeyIncludeTenant
        ? tenantId
        : null,
      normalizeString(
        callbackId,
        256,
      ),
      normalizeString(
        timestamp,
        256,
      ),
      sha256(
        signature,
      ),
    ].filter(
      (value) =>
        value !== null &&
        value !== undefined,
    );

    return sha256(
      parts.join('|'),
    );
  }

  async checkReplay({
    tenantId,
    signature,
    timestamp,
    callbackId,
    correlationId,
  }) {
    if (
      !this.options
        .requireReplayProtection
    ) {
      return {
        allowed: true,
      };
    }

    if (
      !this.replayStore
    ) {
      this.statistics
        .replayStoreFailures +=
        1;

      throw createVerifierError(
        'AIRTEL_CALLBACK_SIGNATURE_REPLAY_STORE_UNAVAILABLE',
        'Replay protection is required but no replay store is configured.',
        503,
        true,
      );
    }

    const key =
      this.buildReplayKey({
        tenantId,
        signature,
        timestamp,
        callbackId,
      });

    try {
      const existsMethod = [
        'has',
        'exists',
        'contains',
        'get',
      ].find(
        (name) =>
          isFunction(
            this.replayStore?.[
              name
            ],
          ),
      );

      if (existsMethod) {
        const existing =
          await this
            .replayStore[
              existsMethod
            ](
              key,
              {
                tenantId,
                provider:
                  PROVIDER,
                operation:
                  OPERATION,
                correlationId,
              },
            );

        if (existing) {
          this.statistics
            .replayed +=
            1;

          return {
            allowed: false,
            key,
          };
        }
      }

      return {
        allowed: true,
        key,
      };
    } catch (error) {
      this.statistics
        .replayStoreFailures +=
        1;

      throw createVerifierError(
        'AIRTEL_CALLBACK_SIGNATURE_REPLAY_CHECK_FAILED',
        'Airtel callback replay protection check failed.',
        503,
        true,
        {
          causeCode:
            error?.code,
        },
      );
    }
  }

  async markReplay({
    tenantId,
    signature,
    timestamp,
    callbackId,
    correlationId,
  }) {
    if (
      !this.options
        .requireReplayProtection ||
      !this.replayStore
    ) {
      return;
    }

    const key =
      this.buildReplayKey({
        tenantId,
        signature,
        timestamp,
        callbackId,
      });

    try {
      const method = [
        'set',
        'put',
        'add',
        'store',
      ].find(
        (name) =>
          isFunction(
            this.replayStore?.[
              name
            ],
          ),
      );

      if (!method) {
        throw new Error(
          'Replay store exposes no write method',
        );
      }

      await this.replayStore[
        method
      ](
        key,
        {
          provider:
            PROVIDER,

          operation:
            OPERATION,

          tenantId,

          expiresAt:
            new Date(
              this.currentTime().getTime() +
                this.options
                  .replayWindowSeconds *
                  1000,
            ),

          correlationId,
        },
        this.options
          .replayWindowSeconds,
      );
    } catch (error) {
      this.statistics
        .replayStoreFailures +=
        1;

      throw createVerifierError(
        'AIRTEL_CALLBACK_SIGNATURE_REPLAY_RECORD_FAILED',
        'Airtel callback replay protection could not record the verified callback.',
        503,
        true,
        {
          causeCode:
            error?.code,
        },
      );
    }
  }

  finishResult(
    result,
    span = null,
  ) {
    const status =
      result?.status;

    if (
      status ===
      SIGNATURE_STATUS.VALID
    ) {
      this.statistics
        .verified +=
        1;

      this.runtime.lastVerifiedAt =
        this.currentTime();

      this.incrementMetric(
        'airtel_callback_signature_success_total',
      );
    } else if (
      status ===
        SIGNATURE_STATUS.INVALID ||
      status ===
        SIGNATURE_STATUS.MALFORMED
    ) {
      this.statistics
        .invalid +=
        1;

      this.incrementMetric(
        'airtel_callback_signature_failure_total',
      );
    } else if (
      status ===
      SIGNATURE_STATUS.MISSING
    ) {
      this.incrementMetric(
        'airtel_callback_signature_missing_total',
      );
    } else if (
      status ===
      SIGNATURE_STATUS.EXPIRED
    ) {
      this.incrementMetric(
        'airtel_callback_signature_expired_total',
      );
    } else if (
      status ===
      SIGNATURE_STATUS.REPLAY
    ) {
      this.incrementMetric(
        'airtel_callback_signature_replay_total',
      );
    }

    const safeResult = {
      ...result,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      verifiedAt:
        result?.verified
          ? this.currentTime().toISOString()
          : undefined,
    };

    const auditPromise =
      this.safeAudit(
        result?.verified
          ? 'AIRTEL_SIGNATURE_VERIFICATION'
          : 'AIRTEL_SIGNATURE_VERIFICATION_FAILURE',
        {
          tenantId:
            result?.tenantId,

          correlationId:
            result?.correlationId,

          operationId:
            result?.operationId,

          metadata: {
            status:
              result?.status,

            code:
              result?.code,

            verified:
              Boolean(
                result?.verified,
              ),

            algorithm:
              result?.algorithm,

            canonicalizationMode:
              result
                ?.canonicalizationMode,

            signatureEncoding:
              result
                ?.signatureEncoding,

            secretVersion:
              result?.secretVersion,

            ageMs:
              result?.ageMs,

            signatureHash:
              result?.signatureHash,
          },
        },
      );

    void auditPromise.catch(
      () => {},
    );

    if (result?.verified) {
      const eventPromise =
        this.publishEvent(
          'AIRTEL_SIGNATURE_VERIFIED',
          result,
        );

      void eventPromise.catch(
        () => {},
      );
    } else if (
      isSecurityRejectionStatus(
        result?.status,
      )
    ) {
      const eventPromise =
        this.publishEvent(
          'AIRTEL_SIGNATURE_REJECTED',
          result,
        );

      void eventPromise.catch(
        () => {},
      );
    }

    if (
      result?.status ===
      SIGNATURE_STATUS.INVALID
    ) {
      this.runtime
        .lastFailureAt =
        this.currentTime();

      this.runtime
        .lastFailureCode =
        result.code;
    }

    span?.setAttribute?.(
      'titech.signature.verified',
      Boolean(
        result?.verified,
      ),
    );

    span?.setAttribute?.(
      'titech.signature.status',
      safeMetricLabel(
        result?.status,
      ),
    );

    return safeResult;
  }

  async safeAudit(
    action,
    {
      tenantId,
      correlationId,
      operationId,
      metadata = {},
    } = {},
  ) {
    if (
      !this.options
        .auditEnabled ||
      !this.auditService
    ) {
      return;
    }

    const method = [
      'record',
      'audit',
      'write',
    ].find(
      (name) =>
        isFunction(
          this.auditService?.[
            name
          ],
        ),
    );

    if (!method) {
      return;
    }

    try {
      await this.auditService[
        method
      ]({
        action,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId:
          tenantId || null,

        correlationId:
          correlationId || null,

        operationId:
          operationId || null,

        metadata:
          safeClone(
            metadata,
          ),

        at:
          this.currentTime().toISOString(),
      });
    } catch (error) {
      this.statistics
        .auditFailures +=
        1;

      this.log(
        'error',
        'Airtel signature verification audit failed',
        {
          action,
          tenantId,
          correlationId,

          error: {
            code:
              error?.code,

            message:
              error?.message,
          },
        },
      );

      if (
        this.options
          .failClosedOnAuditError
      ) {
        throw error;
      }
    }
  }

  async publishEvent(
    type,
    result = {},
  ) {
    if (
      !this.options
        .eventEnabled
    ) {
      return;
    }

    const payload = {
      type,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId:
        result.tenantId ||
        null,

      correlationId:
        result.correlationId ||
        null,

      operationId:
        result.operationId ||
        null,

      status:
        result.status,

      code:
        result.code,

      verified:
        Boolean(
          result.verified,
        ),

      secretVersion:
        result.secretVersion ||
        null,

      signatureHash:
        result.signatureHash ||
        null,

      timestamp:
        result.timestamp ||
        null,
    };

    try {
      if (
        this.outboxService
      ) {
        const method = [
          'publish',
          'enqueue',
          'append',
        ].find(
          (name) =>
            isFunction(
              this.outboxService?.[
                name
              ],
            ),
        );

        if (method) {
          await this
            .outboxService[
              method
            ](
              safeClone(
                payload,
              ),
            );

          return;
        }
      }

      if (
        this.eventBus
      ) {
        const method = [
          'publish',
          'emit',
          'send',
        ].find(
          (name) =>
            isFunction(
              this.eventBus?.[
                name
              ],
            ),
        );

        if (method) {
          await this
            .eventBus[
              method
            ](
              safeClone(
                payload,
              ),
            );
        }
      }
    } catch (error) {
      this.statistics
        .eventFailures +=
        1;

      this.log(
        'error',
        'Airtel signature verification event publication failed',
        {
          type,
          tenantId:
            result.tenantId,
          correlationId:
            result.correlationId,

          error: {
            code:
              error?.code,

            message:
              error?.message,
          },
        },
      );

      if (
        this.options
          .failClosedOnEventError
      ) {
        throw error;
      }
    }
  }

  startSpan(
    name,
    context = {},
  ) {
    try {
      if (
        !isFunction(
          this.tracer?.startSpan,
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
              context.tenantId ||
              'unknown',

            'titech.correlation_id':
              context.correlationId ||
              'unknown',

            'titech.operation_id':
              context.operationId ||
              'unknown',
          },
        },
      );
    } catch {
      return null;
    }
  }

  incrementMetric(
    name,
    value = 1,
    labels = undefined,
  ) {
    try {
      const method = [
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
      // Observability must never alter cryptographic correctness.
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
      // Logging must never affect authentication behavior.
    }
  }

  currentTime() {
    return isFunction(
      this.clock?.now,
    )
      ? new Date(
          this.clock.now(),
        )
      : new Date();
  }

  async ensureReady() {
    if (
      !this.runtime.initialized
    ) {
      await this.initialize();
    }
  }

  health() {
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

      status:
        'UP',

      initialized:
        this.runtime
          .initialized,

      algorithm:
        this.options
          .algorithm,

      canonicalizationMode:
        this.options
          .canonicalizationMode,

      signatureEncoding:
        this.options
          .signatureEncoding,

      timestampToleranceSeconds:
        this.options
          .timestampToleranceSeconds,

      replayProtectionRequired:
        this.options
          .requireReplayProtection,

      secretProviderConfigured:
        Boolean(
          this.secretProvider,
        ),

      replayStoreConfigured:
        Boolean(
          this.replayStore,
        ),

      uptimeMs:
        Date.now() -
        this.runtime
          .startedAt
          .getTime(),
    };
  }

  async readiness() {
    const healthy =
      this.health();

    const ready =
      Boolean(
        (
          healthy.initialized &&
          healthy
            .secretProviderConfigured
        ) ||
        this.configuration
          ?.airtelSignatureSecret ||
        this.configuration
          ?.airtelSignatureSecrets ||
        (
          this.options
            .allowEnvironmentSecretFallback &&
          process.env[
            this.options
              .environmentSecretVariable
          ]
        ),
      );

    if (
      this.options
        .requireReplayProtection &&
      !healthy
        .replayStoreConfigured
    ) {
      return {
        ready: false,

        ...healthy,

        reason:
          'REPLAY_STORE_REQUIRED',
      };
    }

    return {
      ready:
        Boolean(
          ready,
        ),

      ...healthy,
    };
  }

  liveness() {
    return {
      alive: true,

      provider:
        PROVIDER,

      component:
        COMPONENT,

      timestamp:
        this.currentTime().toISOString(),
    };
  }

  isReady() {
    return (
      this.runtime
        .initialized
    );
  }

  capabilities() {
    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      signatureVerification:
        true,

      hmacSha256:
        true,

      hmacSha512:
        true,

      secretRotation:
        this.options
          .allowRotatedSecrets,

      timestampFreshness:
        true,

      replayProtection:
        this.options
          .requireReplayProtection,

      tenantScopedSecrets:
        true,

      constantTimeComparison:
        true,

      rawBodySupport:
        true,

      configurableCanonicalization:
        true,

      audit:
        Boolean(
          this.auditService,
        ),

      events:
        Boolean(
          this.eventBus ||
          this.outboxService,
        ),

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
    };
  }

  statisticsSnapshot() {
    return safeClone(
      this.statistics,
    );
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

      configuration: {
        algorithm:
          this.options
            .algorithm,

        canonicalizationMode:
          this.options
            .canonicalizationMode,

        signatureEncoding:
          this.options
            .signatureEncoding,

        timestampToleranceSeconds:
          this.options
            .timestampToleranceSeconds,

        requireTimestamp:
          this.options
            .requireTimestamp,

        requireRawBody:
          this.options
            .requireRawBody,

        requireTenantId:
          this.options
            .requireTenantId,

        requireReplayProtection:
          this.options
            .requireReplayProtection,

        maxRawBodyBytes:
          this.options
            .maxRawBodyBytes,

        maxRotatedSecrets:
          this.options
            .maxRotatedSecrets,
      },

      dependencies: {
        secretProvider:
          Boolean(
            this.secretProvider,
          ),

        replayStore:
          Boolean(
            this.replayStore,
          ),

        auditService:
          Boolean(
            this.auditService,
          ),

        eventBus:
          Boolean(
            this.eventBus,
          ),

        outboxService:
          Boolean(
            this.outboxService,
          ),
      },

      financialBoundary: {
        providerHttp:
          false,

        ledgerWrites:
          false,

        balanceMutation:
          false,

        walletMutation:
          false,

        settlementFinality:
          false,
      },

      runtime: {
        initialized:
          this.runtime
            .initialized,

        startedAt:
          this.runtime
            .startedAt
            .toISOString(),

        lastVerifiedAt:
          this.runtime
            .lastVerifiedAt
            ?.toISOString?.() ||
          null,

        lastFailureAt:
          this.runtime
            .lastFailureAt
            ?.toISOString?.() ||
          null,

        lastFailureCode:
          this.runtime
            .lastFailureCode ||
          null,
      },

      statistics:
        this.statisticsSnapshot(),
    };
  }

  snapshot() {
    return this.diagnostics();
  }
}

export function createAirtelCallbackSignatureVerifier(
  options = {},
) {
  return new AirtelCallbackSignatureVerifier(
    options,
  );
}

export function createSignatureVerifier(
  options = {},
) {
  return new AirtelCallbackSignatureVerifier(
    options,
  );
}

export const DEFAULT_CONFIGURATION =
  DEFAULTS;

export const CONSTANTS =
  Object.freeze({
    PROVIDER,

    OPERATION,

    COMPONENT,

    ENGINE_NAME,

    ENGINE_VERSION,

    SCHEMA_VERSION,

    HASH_ALGORITHM,

    ALGORITHMS,

    SIGNATURE_STATUS,

    CANONICALIZATION_MODES,

    SIGNATURE_ENCODINGS,

    DEFAULTS,
  });

export {
  safeClone,
  canonicalize,
  sha256,
  normalizeHeaders,
};

export default AirtelCallbackSignatureVerifier;