'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (TITech)
 * =============================================================================
 *
 * File:
 *   backend/modules/offline/services/offlineReceiptService.js
 *
 * Purpose:
 *   Enterprise-grade receipt service for TITech offline-first operations.
 *
 * Responsibilities:
 *
 *   - Generate immutable offline receipts
 *   - Bind receipts to tenant, device and event identity
 *   - Generate deterministic receipt hashes
 *   - Generate cryptographic signatures where configured
 *   - Verify receipt integrity
 *   - Verify receipt signatures
 *   - Support idempotent receipt generation
 *   - Support receipt lookup
 *   - Support QR / verification payload generation
 *   - Produce safe receipt representations
 *   - Support local/offline receipt generation
 *   - Preserve financial references without becoming a financial ledger
 *
 * IMPORTANT:
 *
 *   This service NEVER:
 *
 *   - Creates financial transactions
 *   - Changes wallet balances
 *   - Changes savings balances
 *   - Changes loan balances
 *   - Creates ledger entries
 *   - Authorizes payments
 *   - Settles mobile-money transactions
 *
 * Financial state remains authoritative in the TITech financial transaction
 * boundary and ledger services.
 *
 * Receipt lifecycle:
 *
 *   Offline Event
 *        |
 *        v
 *   Receipt Service
 *        |
 *        +-----------------------+
 *        |                       |
 *        v                       v
 *   Canonical Payload       Cryptographic Hash
 *                                |
 *                                v
 *                           Signature
 *                                |
 *                                v
 *                         Immutable Receipt
 *                                |
 *                    +-----------+-----------+
 *                    |                       |
 *                    v                       v
 *               Local Device           Server Verification
 *
 * =============================================================================
 */

const crypto = require('crypto');

// =============================================================================
// Constants
// =============================================================================

const SERVICE_NAME =
  'TITech.offlineReceiptService';

const RECEIPT_VERSION =
  '1.0';

const RECEIPT_PREFIX =
  'TITR';

const DEFAULT_HASH_ALGORITHM =
  'sha256';

const DEFAULT_SIGNATURE_ALGORITHM =
  'RSA-SHA256';

const DEFAULT_ENCODING =
  'base64url';

const MAX_METADATA_KEYS =
  100;

const MAX_METADATA_VALUE_LENGTH =
  4096;

const MAX_REFERENCE_LENGTH =
  256;

const MAX_RECEIPT_ID_LENGTH =
  128;

// =============================================================================
// Error Factory
// =============================================================================

function createServiceError(
  message,
  code,
  statusCode = 400,
  details = null,
) {
  const error =
    new Error(message);

  error.name =
    'OfflineReceiptServiceError';

  error.code =
    code;

  error.statusCode =
    statusCode;

  if (details !== null) {
    error.details =
      details;
  }

  return error;
}

// =============================================================================
// Normalization Helpers
// =============================================================================

function requireString(
  value,
  fieldName,
) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw createServiceError(
      `${fieldName} is required.`,
      'OFFLINE_RECEIPT_INVALID_INPUT',
      400,
      {
        field: fieldName,
      },
    );
  }

  return value.trim();
}

function optionalString(
  value,
  fieldName = null,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value !== 'string'
  ) {
    if (fieldName) {
      throw createServiceError(
        `${fieldName} must be a string.`,
        'OFFLINE_RECEIPT_INVALID_INPUT',
        400,
        {
          field: fieldName,
        },
      );
    }

    return String(value);
  }

  const normalized =
    value.trim();

  return normalized.length > 0
    ? normalized
    : null;
}

function normalizeReference(
  value,
  fieldName,
) {
  const normalized =
    requireString(
      value,
      fieldName,
    );

  if (
    normalized.length >
    MAX_REFERENCE_LENGTH
  ) {
    throw createServiceError(
      `${fieldName} exceeds the maximum allowed length.`,
      'OFFLINE_RECEIPT_REFERENCE_TOO_LONG',
      400,
    );
  }

  return normalized;
}

function normalizeTenantId(
  tenantId,
) {
  return normalizeReference(
    tenantId,
    'tenantId',
  );
}

function normalizeDeviceId(
  deviceId,
) {
  return normalizeReference(
    deviceId,
    'deviceId',
  );
}

function normalizeEventId(
  eventId,
) {
  return normalizeReference(
    eventId,
    'eventId',
  );
}

function normalizeReceiptId(
  receiptId,
) {
  const value =
    normalizeReference(
      receiptId,
      'receiptId',
    );

  if (
    value.length >
    MAX_RECEIPT_ID_LENGTH
  ) {
    throw createServiceError(
      'receiptId is too long.',
      'OFFLINE_RECEIPT_ID_TOO_LONG',
      400,
    );
  }

  return value;
}

// =============================================================================
// Object / Serialization Helpers
// =============================================================================

function sortObjectKeys(
  value,
) {
  if (
    Array.isArray(value)
  ) {
    return value.map(
      sortObjectKeys,
    );
  }

  if (
    value &&
    typeof value === 'object' &&
    !(
      value instanceof Date
    ) &&
    !Buffer.isBuffer(value)
  ) {
    return Object.keys(value)
      .sort()
      .reduce(
        (
          result,
          key,
        ) => {
          result[key] =
            sortObjectKeys(
              value[key],
            );

          return result;
        },
        {},
      );
  }

  return value;
}

function canonicalize(
  value,
) {
  return JSON.stringify(
    sortObjectKeys(
      value,
    ),
  );
}

function hashCanonicalPayload(
  payload,
  algorithm =
    DEFAULT_HASH_ALGORITHM,
) {
  return crypto
    .createHash(
      algorithm,
    )
    .update(
      canonicalize(
        payload,
      ),
      'utf8',
    )
    .digest(
      DEFAULT_ENCODING,
    );
}

function generateReceiptId() {
  return `${RECEIPT_PREFIX}_${crypto
    .randomBytes(16)
    .toString('hex')}`;
}

function normalizeMetadata(
  metadata,
) {
  if (
    metadata === null ||
    metadata === undefined
  ) {
    return {};
  }

  if (
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    throw createServiceError(
      'Receipt metadata must be an object.',
      'OFFLINE_RECEIPT_METADATA_INVALID',
      400,
    );
  }

  const keys =
    Object.keys(
      metadata,
    );

  if (
    keys.length >
    MAX_METADATA_KEYS
  ) {
    throw createServiceError(
      `Receipt metadata cannot contain more than ${MAX_METADATA_KEYS} keys.`,
      'OFFLINE_RECEIPT_METADATA_TOO_LARGE',
      413,
    );
  }

  const normalized =
    {};

  for (
    const key of keys
  ) {
    const value =
      metadata[key];

    if (
      typeof value === 'string' &&
      value.length >
        MAX_METADATA_VALUE_LENGTH
    ) {
      throw createServiceError(
        `Receipt metadata value for "${key}" is too large.`,
        'OFFLINE_RECEIPT_METADATA_VALUE_TOO_LARGE',
        413,
      );
    }

    normalized[key] =
      value;
  }

  return normalized;
}

// =============================================================================
// Cryptographic Helpers
// =============================================================================

function createSignature(
  payload,
  {
    privateKey,
    algorithm =
      DEFAULT_SIGNATURE_ALGORITHM,
  } = {},
) {
  if (
    !privateKey
  ) {
    return null;
  }

  try {
    const signer =
      crypto.createSign(
        algorithm,
      );

    signer.update(
      canonicalize(
        payload,
      ),
      'utf8',
    );

    signer.end();

    return signer.sign(
      privateKey,
      DEFAULT_ENCODING,
    );
  } catch (error) {
    throw createServiceError(
      'Unable to sign offline receipt.',
      'OFFLINE_RECEIPT_SIGNATURE_FAILURE',
      500,
      {
        cause:
          error.message,
      },
    );
  }
}

function verifySignature(
  payload,
  signature,
  {
    publicKey,
    algorithm =
      DEFAULT_SIGNATURE_ALGORITHM,
  } = {},
) {
  if (
    !publicKey ||
    !signature
  ) {
    return false;
  }

  try {
    const verifier =
      crypto.createVerify(
        algorithm,
      );

    verifier.update(
      canonicalize(
        payload,
      ),
      'utf8',
    );

    verifier.end();

    return verifier.verify(
      publicKey,
      signature,
      DEFAULT_ENCODING,
    );
  } catch {
    return false;
  }
}

// =============================================================================
// Service
// =============================================================================

class OfflineReceiptService {
  /**
   * @param {Object} options
   * @param {Object} options.receiptModel
   * @param {Object} options.offlineEventModel
   * @param {Object} options.offlineDeviceService
   * @param {Object} options.logger
   * @param {Object} options.auditService
   * @param {Object} options.eventBus
   * @param {Object} options.config
   */
  constructor({
    receiptModel = null,
    offlineEventModel = null,
    offlineDeviceService = null,
    logger = null,
    auditService = null,
    eventBus = null,
    config = {},
  } = {}) {
    this.Receipt =
      receiptModel;

    this.OfflineEvent =
      offlineEventModel;

    this.offlineDeviceService =
      offlineDeviceService;

    this.logger =
      logger;

    this.auditService =
      auditService;

    this.eventBus =
      eventBus;

    this.config = {
      hashAlgorithm:
        config.hashAlgorithm ||
        DEFAULT_HASH_ALGORITHM,

      signatureAlgorithm:
        config.signatureAlgorithm ||
        DEFAULT_SIGNATURE_ALGORITHM,

      privateKey:
        config.privateKey ||
        null,

      publicKey:
        config.publicKey ||
        null,

      keyId:
        config.keyId ||
        null,

      issuer:
        config.issuer ||
        'TITech Community Capital LTD',
    };
  }

  // ===========================================================================
  // Logging
  // ===========================================================================

  _log(
    level,
    message,
    context = {},
  ) {
    if (
      !this.logger ||
      typeof this.logger[level] !==
        'function'
    ) {
      return;
    }

    this.logger[level](
      `[${SERVICE_NAME}] ${message}`,
      context,
    );
  }

  // ===========================================================================
  // Audit
  // ===========================================================================

  async _audit(
    type,
    payload,
  ) {
    const auditPayload = {
      type,

      service:
        SERVICE_NAME,

      ...payload,

      occurredAt:
        new Date(),
    };

    try {
      if (
        this.auditService &&
        typeof this.auditService.record ===
          'function'
      ) {
        await this.auditService.record(
          auditPayload,
        );
      }

      if (
        this.eventBus &&
        typeof this.eventBus.publish ===
          'function'
      ) {
        await this.eventBus.publish(
          `offline.receipt.${type.toLowerCase()}`,
          auditPayload,
        );
      }
    } catch (error) {
      this._log(
        'error',
        'Failed to record offline receipt audit event.',
        {
          type,
          error:
            error.message,
        },
      );

      throw createServiceError(
        'Offline receipt audit operation failed.',
        'OFFLINE_RECEIPT_AUDIT_FAILURE',
        500,
      );
    }
  }

  // ===========================================================================
  // Receipt Payload
  // ===========================================================================

  buildReceiptPayload({
    tenantId,
    deviceId,
    eventId,
    receiptId = null,
    operationType,
    operationStatus =
      'ACCEPTED',
    sequenceNumber = null,
    eventHash = null,
    previousEventHash = null,
    idempotencyKey = null,
    transactionId = null,
    reference = null,
    amount = null,
    currency = null,
    memberId = null,
    accountId = null,
    meetingId = null,
    issuedAt = null,
    metadata = {},
  }) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedDeviceId =
      normalizeDeviceId(
        deviceId,
      );

    const normalizedEventId =
      normalizeEventId(
        eventId,
      );

    const normalizedOperationType =
      requireString(
        operationType,
        'operationType',
      );

    const normalizedReceiptId =
      receiptId
        ? normalizeReceiptId(
            receiptId,
          )
        : generateReceiptId();

    const normalizedStatus =
      requireString(
        operationStatus,
        'operationStatus',
      ).toUpperCase();

    const timestamp =
      issuedAt
        ? new Date(
            issuedAt,
          )
        : new Date();

    if (
      Number.isNaN(
        timestamp.getTime(),
      )
    ) {
      throw createServiceError(
        'Invalid receipt issue timestamp.',
        'OFFLINE_RECEIPT_INVALID_TIMESTAMP',
        400,
      );
    }

    const payload = {
      receiptVersion:
        RECEIPT_VERSION,

      receiptId:
        normalizedReceiptId,

      issuer:
        this.config.issuer,

      tenantId:
        normalizedTenantId,

      deviceId:
        normalizedDeviceId,

      eventId:
        normalizedEventId,

      operationType:
        normalizedOperationType,

      operationStatus:
        normalizedStatus,

      sequenceNumber:
        sequenceNumber === null
          ? null
          : Number(
              sequenceNumber,
            ),

      eventHash:
        eventHash
          ? optionalString(
              eventHash,
            )
          : null,

      previousEventHash:
        previousEventHash
          ? optionalString(
              previousEventHash,
            )
          : null,

      idempotencyKey:
        idempotencyKey
          ? normalizeReference(
              idempotencyKey,
              'idempotencyKey',
            )
          : null,

      transactionId:
        transactionId
          ? normalizeReference(
              transactionId,
              'transactionId',
            )
          : null,

      reference:
        reference
          ? normalizeReference(
              reference,
              'reference',
            )
          : null,

      amount:
        amount === null ||
        amount === undefined
          ? null
          : String(amount),

      currency:
        currency
          ? optionalString(
              currency,
            )?.toUpperCase()
          : null,

      memberId:
        memberId
          ? normalizeReference(
              memberId,
              'memberId',
            )
          : null,

      accountId:
        accountId
          ? normalizeReference(
              accountId,
              'accountId',
            )
          : null,

      meetingId:
        meetingId
          ? normalizeReference(
              meetingId,
              'meetingId',
            )
          : null,

      issuedAt:
        timestamp.toISOString(),

      metadata:
        normalizeMetadata(
          metadata,
        ),
    };

    return payload;
  }

  // ===========================================================================
  // Receipt Generation
  // ===========================================================================

  async generateReceipt({
    tenantId,
    deviceId,
    eventId,
    operationType,
    operationStatus =
      'ACCEPTED',
    sequenceNumber = null,
    eventHash = null,
    previousEventHash = null,
    idempotencyKey = null,
    transactionId = null,
    reference = null,
    amount = null,
    currency = null,
    memberId = null,
    accountId = null,
    meetingId = null,
    metadata = {},
    session = null,
  }) {
    const payload =
      this.buildReceiptPayload({
        tenantId,
        deviceId,
        eventId,
        operationType,
        operationStatus,
        sequenceNumber,
        eventHash,
        previousEventHash,
        idempotencyKey,
        transactionId,
        reference,
        amount,
        currency,
        memberId,
        accountId,
        meetingId,
        metadata,
      });

    /*
     * Idempotency:
     *
     * If a receipt model is configured and an idempotency key exists, return
     * the existing receipt rather than generating a second receipt.
     */
    if (
      this.Receipt &&
      idempotencyKey
    ) {
      const existing =
        await this.findByIdempotencyKey(
          tenantId,
          idempotencyKey,
          {
            session,
          },
        );

      if (existing) {
        return {
          receipt:
            existing,

          created:
            false,

          idempotent:
            true,
        };
      }
    }

    const receiptHash =
      hashCanonicalPayload(
        payload,
        this.config.hashAlgorithm,
      );

    const signaturePayload = {
      ...payload,

      receiptHash,
    };

    const signature =
      createSignature(
        signaturePayload,
        {
          privateKey:
            this.config.privateKey,

          algorithm:
            this.config.signatureAlgorithm,
        },
      );

    const receipt = {
      ...payload,

      receiptHash,

      hashAlgorithm:
        this.config.hashAlgorithm,

      signature:
        signature || null,

      signatureAlgorithm:
        signature
          ? this.config
              .signatureAlgorithm
          : null,

      keyId:
        signature
          ? this.config.keyId
          : null,

      immutable:
        true,
    };

    let persistedReceipt =
      receipt;

    if (
      this.Receipt
    ) {
      try {
        const options = {
          runValidators:
            true,

          new:
            true,

          upsert:
            false,
        };

        if (session) {
          options.session =
            session;
        }

        persistedReceipt =
          await this.Receipt.create(
            [receipt],
            session
              ? { session }
              : undefined,
          );

        persistedReceipt =
          Array.isArray(
            persistedReceipt,
          )
            ? persistedReceipt[0]
            : persistedReceipt;
      } catch (error) {
        /*
         * A unique idempotency index may cause a race where another request
         * created the receipt first. Resolve that race by retrieving the
         * authoritative existing receipt.
         */
        if (
          error?.code === 11000 &&
          idempotencyKey
        ) {
          const existing =
            await this.findByIdempotencyKey(
              tenantId,
              idempotencyKey,
              {
                session,
              },
            );

          if (existing) {
            return {
              receipt:
                existing,

              created:
                false,

              idempotent:
                true,
            };
          }
        }

        throw error;
      }
    }

    await this._audit(
      'RECEIPT_GENERATED',
      {
        tenantId,
        deviceId,
        eventId,
        receiptId:
          receipt.receiptId,
        transactionId,
        idempotencyKey,
      },
    );

    return {
      receipt:
        persistedReceipt,

      created:
        true,

      idempotent:
        false,
    };
  }

  // ===========================================================================
  // Receipt Lookup
  // ===========================================================================

  async findById(
    tenantId,
    receiptId,
    {
      session = null,
    } = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedReceiptId =
      normalizeReceiptId(
        receiptId,
      );

    if (
      !this.Receipt
    ) {
      return null;
    }

    let query =
      this.Receipt.findOne({
        tenantId:
          normalizedTenantId,

        receiptId:
          normalizedReceiptId,
      });

    if (session) {
      query =
        query.session(
          session,
        );
    }

    return query.exec();
  }

  async findByEventId(
    tenantId,
    eventId,
    {
      session = null,
    } = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedEventId =
      normalizeEventId(
        eventId,
      );

    if (
      !this.Receipt
    ) {
      return null;
    }

    let query =
      this.Receipt.findOne({
        tenantId:
          normalizedTenantId,

        eventId:
          normalizedEventId,
      });

    if (session) {
      query =
        query.session(
          session,
        );
    }

    return query.exec();
  }

  async findByIdempotencyKey(
    tenantId,
    idempotencyKey,
    {
      session = null,
    } = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedKey =
      normalizeReference(
        idempotencyKey,
        'idempotencyKey',
      );

    if (
      !this.Receipt
    ) {
      return null;
    }

    let query =
      this.Receipt.findOne({
        tenantId:
          normalizedTenantId,

        idempotencyKey:
          normalizedKey,
      });

    if (session) {
      query =
        query.session(
          session,
        );
    }

    return query.exec();
  }

  // ===========================================================================
  // Event-Based Receipt Generation
  // ===========================================================================

  async generateFromEvent({
    event,
    operationStatus =
      'ACCEPTED',
    transactionId = null,
    reference = null,
    amount = null,
    currency = null,
    memberId = null,
    accountId = null,
    meetingId = null,
    metadata = {},
    session = null,
  }) {
    if (!event) {
      throw createServiceError(
        'Offline event is required to generate a receipt.',
        'OFFLINE_RECEIPT_EVENT_REQUIRED',
        400,
      );
    }

    const tenantId =
      event.tenantId;

    const deviceId =
      event.deviceId;

    const eventId =
      event.eventId;

    if (
      !tenantId ||
      !deviceId ||
      !eventId
    ) {
      throw createServiceError(
        'Offline event does not contain sufficient identity information.',
        'OFFLINE_RECEIPT_EVENT_IDENTITY_INVALID',
        400,
      );
    }

    const eventHash =
      event.eventHash ||
      null;

    const previousEventHash =
      event.previousEventHash ||
      null;

    const sequenceNumber =
      event.sequenceNumber ??
      null;

    const operationType =
      event.eventType ||
      event.type ||
      event.operationType ||
      'OFFLINE_OPERATION';

    const idempotencyKey =
      event.idempotencyKey ||
      null;

    return this.generateReceipt({
      tenantId,
      deviceId,
      eventId,
      operationType,
      operationStatus,
      sequenceNumber,
      eventHash,
      previousEventHash,
      idempotencyKey,
      transactionId,
      reference,
      amount,
      currency,
      memberId,
      accountId,
      meetingId,
      metadata: {
        ...(
          event.metadata ||
          {}
        ),

        ...metadata,
      },
      session,
    });
  }

  // ===========================================================================
  // Receipt Verification
  // ===========================================================================

  verifyReceiptIntegrity(
    receipt,
  ) {
    if (!receipt) {
      throw createServiceError(
        'Receipt is required.',
        'OFFLINE_RECEIPT_REQUIRED',
        400,
      );
    }

    const source =
      typeof receipt.toObject ===
      'function'
        ? receipt.toObject()
        : receipt;

    const {
      receiptHash,
      signature,
      signatureAlgorithm,
      keyId,
      immutable,
      ...payload
    } = source;

    if (
      !receiptHash
    ) {
      return {
        valid: false,

        reason:
          'RECEIPT_HASH_MISSING',
      };
    }

    const calculatedHash =
      hashCanonicalPayload(
        payload,
        source.hashAlgorithm ||
          this.config.hashAlgorithm,
      );

    const hashValid =
      calculatedHash ===
      receiptHash;

    if (!hashValid) {
      return {
        valid: false,

        hashValid: false,

        signaturePresent:
          Boolean(signature),

        reason:
          'RECEIPT_HASH_MISMATCH',

        expectedHash:
          calculatedHash,

        receivedHash:
          receiptHash,
      };
    }

    let signatureValid =
      null;

    if (
      signature &&
      this.config.publicKey
    ) {
      signatureValid =
        verifySignature(
          {
            ...payload,

            receiptHash,
          },
          signature,
          {
            publicKey:
              this.config.publicKey,

            algorithm:
              signatureAlgorithm ||
              this.config
                .signatureAlgorithm,
          },
        );
    }

    return {
      valid:
        hashValid &&
        (
          signatureValid === null ||
          signatureValid === true
        ),

      hashValid,

      signaturePresent:
        Boolean(signature),

      signatureValid,

      immutable:
        immutable !== false,

      receiptId:
        source.receiptId,

      eventId:
        source.eventId,

      tenantId:
        source.tenantId,

      deviceId:
        source.deviceId,
    };
  }

  async verifyReceipt(
    tenantId,
    receiptId,
  ) {
    const receipt =
      await this.findById(
        tenantId,
        receiptId,
      );

    if (!receipt) {
      throw createServiceError(
        'Offline receipt was not found.',
        'OFFLINE_RECEIPT_NOT_FOUND',
        404,
      );
    }

    const verification =
      this.verifyReceiptIntegrity(
        receipt,
      );

    if (
      !verification.valid
    ) {
      await this._audit(
        'RECEIPT_VERIFICATION_FAILED',
        {
          tenantId,
          deviceId:
            receipt.deviceId,
          eventId:
            receipt.eventId,
          receiptId,
        },
      );
    }

    return {
      receipt:
        this.toSafeReceipt(
          receipt,
        ),

      verification,
    };
  }

  // ===========================================================================
  // QR / Verification Payload
  // ===========================================================================

  buildVerificationPayload(
    receipt,
  ) {
    if (!receipt) {
      throw createServiceError(
        'Receipt is required.',
        'OFFLINE_RECEIPT_REQUIRED',
        400,
      );
    }

    const source =
      typeof receipt.toObject ===
      'function'
        ? receipt.toObject()
        : receipt;

    return {
      version:
        RECEIPT_VERSION,

      issuer:
        this.config.issuer,

      receiptId:
        source.receiptId,

      tenantId:
        source.tenantId,

      deviceId:
        source.deviceId,

      eventId:
        source.eventId,

      operationType:
        source.operationType,

      operationStatus:
        source.operationStatus,

      transactionId:
        source.transactionId ||
        null,

      reference:
        source.reference ||
        null,

      amount:
        source.amount ||
        null,

      currency:
        source.currency ||
        null,

      issuedAt:
        source.issuedAt,

      receiptHash:
        source.receiptHash,

      signature:
        source.signature ||
        null,

      keyId:
        source.keyId ||
        null,
    };
  }

  buildVerificationString(
    receipt,
  ) {
    const payload =
      this.buildVerificationPayload(
        receipt,
      );

    return canonicalize(
      payload,
    );
  }

  // ===========================================================================
  // Receipt Immutability
  // ===========================================================================

  assertImmutable(
    receipt,
  ) {
    if (!receipt) {
      throw createServiceError(
        'Receipt is required.',
        'OFFLINE_RECEIPT_REQUIRED',
        400,
      );
    }

    if (
      receipt.immutable === false
    ) {
      throw createServiceError(
        'Receipt is not marked immutable.',
        'OFFLINE_RECEIPT_NOT_IMMUTABLE',
        409,
      );
    }

    return true;
  }

  /**
   * Receipts should never be updated after creation.
   *
   * This method intentionally throws and exists as an explicit domain guard
   * against accidental mutation by higher-level services.
   */
  async updateReceipt() {
    throw createServiceError(
      'Offline receipts are immutable and cannot be updated.',
      'OFFLINE_RECEIPT_IMMUTABLE',
      409,
    );
  }

  async deleteReceipt() {
    throw createServiceError(
      'Offline receipts are immutable and cannot be deleted.',
      'OFFLINE_RECEIPT_IMMUTABLE',
      409,
    );
  }

  // ===========================================================================
  // Receipt Verification Against Event
  // ===========================================================================

  verifyReceiptAgainstEvent(
    receipt,
    event,
  ) {
    if (
      !receipt ||
      !event
    ) {
      throw createServiceError(
        'Both receipt and event are required.',
        'OFFLINE_RECEIPT_EVENT_REQUIRED',
        400,
      );
    }

    const checks = {
      tenant:
        String(
          receipt.tenantId,
        ) ===
        String(
          event.tenantId,
        ),

      device:
        String(
          receipt.deviceId,
        ) ===
        String(
          event.deviceId,
        ),

      event:
        String(
          receipt.eventId,
        ) ===
        String(
          event.eventId,
        ),

      sequence:
        receipt.sequenceNumber ===
          null ||
        Number(
          receipt.sequenceNumber,
        ) ===
          Number(
            event.sequenceNumber,
          ),

      eventHash:
        !receipt.eventHash ||
        !event.eventHash ||
        String(
          receipt.eventHash,
        ) ===
          String(
            event.eventHash,
          ),
    };

    const valid =
      Object.values(
        checks,
      ).every(
        Boolean,
      );

    return {
      valid,

      checks,
    };
  }

  // ===========================================================================
  // Receipt List
  // ===========================================================================

  async listReceipts({
    tenantId,
    deviceId = null,
    memberId = null,
    transactionId = null,
    operationType = null,
    limit = 100,
    skip = 0,
  }) {
    if (
      !this.Receipt
    ) {
      return {
        receipts: [],

        pagination: {
          total: 0,
          limit,
          skip,
          hasMore: false,
        },
      };
    }

    const query = {
      tenantId:
        normalizeTenantId(
          tenantId,
        ),
    };

    if (deviceId) {
      query.deviceId =
        normalizeDeviceId(
          deviceId,
        );
    }

    if (memberId) {
      query.memberId =
        normalizeReference(
          memberId,
          'memberId',
        );
    }

    if (transactionId) {
      query.transactionId =
        normalizeReference(
          transactionId,
          'transactionId',
        );
    }

    if (operationType) {
      query.operationType =
        normalizeReference(
          operationType,
          'operationType',
        );
    }

    const safeLimit =
      Math.min(
        Math.max(
          Number(limit) || 100,
          1,
        ),
        500,
      );

    const safeSkip =
      Math.max(
        Number(skip) || 0,
        0,
      );

    const [
      receipts,
      total,
    ] = await Promise.all([
      this.Receipt
        .find(query)
        .sort({
          issuedAt: -1,
        })
        .skip(safeSkip)
        .limit(safeLimit)
        .lean()
        .exec(),

      this.Receipt.countDocuments(
        query,
      ),
    ]);

    return {
      receipts:
        receipts.map(
          (receipt) =>
            this.toSafeReceipt(
              receipt,
            ),
        ),

      pagination: {
        total,

        limit:
          safeLimit,

        skip:
          safeSkip,

        hasMore:
          safeSkip +
            receipts.length <
          total,
      },
    };
  }

  // ===========================================================================
  // Safe Serialization
  // ===========================================================================

  toSafeReceipt(
    receipt,
  ) {
    if (!receipt) {
      return null;
    }

    const source =
      typeof receipt.toObject ===
      'function'
        ? receipt.toObject()
        : {
            ...receipt,
          };

    /*
     * Receipt data can be displayed to members, devices, SMS/QR channels and
     * administrators. Credential/private-key material must never be returned.
     */
    delete source.privateKey;

    delete source.secret;

    delete source.deviceSecret;

    delete source.authenticationSecretHash;

    delete source.encryptionKey;

    return source;
  }

  // ===========================================================================
  // Receipt Summary
  // ===========================================================================

  toReceiptSummary(
    receipt,
  ) {
    if (!receipt) {
      return null;
    }

    const source =
      typeof receipt.toObject ===
      'function'
        ? receipt.toObject()
        : receipt;

    return {
      receiptId:
        source.receiptId,

      eventId:
        source.eventId,

      transactionId:
        source.transactionId ||
        null,

      reference:
        source.reference ||
        null,

      tenantId:
        source.tenantId,

      deviceId:
        source.deviceId,

      operationType:
        source.operationType,

      operationStatus:
        source.operationStatus,

      amount:
        source.amount ||
        null,

      currency:
        source.currency ||
        null,

      sequenceNumber:
        source.sequenceNumber ??
        null,

      issuedAt:
        source.issuedAt,

      receiptHash:
        source.receiptHash,

      signaturePresent:
        Boolean(
          source.signature,
        ),
    };
  }
}

// =============================================================================
// Singleton
// =============================================================================

const offlineReceiptService =
  new OfflineReceiptService();

// =============================================================================
// Exports
// =============================================================================

module.exports =
  offlineReceiptService;

module.exports.OfflineReceiptService =
  OfflineReceiptService;

module.exports.SERVICE_NAME =
  SERVICE_NAME;

module.exports.RECEIPT_VERSION =
  RECEIPT_VERSION;

module.exports.RECEIPT_PREFIX =
  RECEIPT_PREFIX;