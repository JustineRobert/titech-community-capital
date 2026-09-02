'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (TITech)
 * =============================================================================
 *
 * File:
 *   backend/modules/offline/services/offlineDeviceService.js
 *
 * Purpose:
 *   Enterprise-grade domain service for TITech offline device lifecycle,
 *   identity, trust, security, synchronization state and device authorization.
 *
 * Responsibilities:
 *
 *   - Register offline devices
 *   - Resolve devices within a tenant boundary
 *   - Validate device identity
 *   - Validate device fingerprints
 *   - Manage device lifecycle
 *   - Manage device trust
 *   - Revoke compromised devices
 *   - Suspend / reactivate devices
 *   - Maintain device synchronization state
 *   - Enforce device sequence rules
 *   - Validate event ownership
 *   - Record security/audit events
 *   - Support offline synchronization
 *
 * Explicitly NOT responsible for:
 *
 *   - Authoritative financial ledger mutation
 *   - Wallet balance mutation
 *   - Loan balance mutation
 *   - Savings balance mutation
 *   - Financial transaction commits
 *   - Final financial reconciliation
 *
 * Financial operations must pass through the TITech financial transaction
 * boundary and authoritative ledger services.
 *
 * Architecture:
 *
 *   Authentication
 *        |
 *        v
 *   Tenant Context
 *        |
 *        v
 *   Offline Device Service
 *        |
 *        +--------------------+
 *        |                    |
 *        v                    v
 *   OfflineDevice        OfflineEvent
 *        |                    |
 *        |                    v
 *        |             Sync / Integrity
 *        |                    |
 *        +---------+----------+
 *                  |
 *                  v
 *        Financial Transaction
 *             Boundary
 *
 * =============================================================================
 */

const crypto = require('crypto');

const OfflineDevice = require(
  '../models/OfflineDevice',
);

const OfflineEvent = require(
  '../models/OfflineEvent',
);

// =============================================================================
// Constants
// =============================================================================

const SERVICE_NAME =
  'TITech.offlineDeviceService';

const DEFAULT_SEQUENCE =
  0;

const MAX_BATCH_SIZE =
  500;

const DEVICE_ID_BYTES =
  16;

const TOKEN_BYTES =
  32;

const DEVICE_SECRET_BYTES =
  32;

const DEFAULT_HEARTBEAT_INTERVAL_MS =
  5 * 60 * 1000;

const DEFAULT_MAX_CLOCK_SKEW_MS =
  10 * 60 * 1000;

const DEVICE_STATES = Object.freeze([
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
  'DECOMMISSIONED',
]);

const TRUST_STATES = Object.freeze([
  'UNTRUSTED',
  'PENDING',
  'TRUSTED',
  'REVOKED',
]);

const SECURITY_EVENT_TYPES = Object.freeze([
  'DEVICE_REGISTERED',
  'DEVICE_TRUSTED',
  'DEVICE_SUSPENDED',
  'DEVICE_REACTIVATED',
  'DEVICE_REVOKED',
  'DEVICE_DECOMMISSIONED',
  'DEVICE_AUTHENTICATION_FAILED',
  'DEVICE_FINGERPRINT_MISMATCH',
  'DEVICE_SEQUENCE_VIOLATION',
  'DEVICE_REPLAY_DETECTED',
  'DEVICE_CLOCK_SKEW_DETECTED',
]);

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
    'OfflineDeviceServiceError';

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
// Utility Functions
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
      'INVALID_OFFLINE_DEVICE_INPUT',
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
) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    return null;
  }

  return value.trim();
}

function normalizeTenantId(
  tenantId,
) {
  return requireString(
    tenantId,
    'tenantId',
  );
}

function normalizeDeviceId(
  deviceId,
) {
  return requireString(
    deviceId,
    'deviceId',
  );
}

function normalizeFingerprint(
  fingerprint,
) {
  return requireString(
    fingerprint,
    'deviceFingerprint',
  ).toLowerCase();
}

function normalizeActorId(
  actorId,
) {
  return optionalString(
    actorId,
  );
}

function generateIdentifier(
  prefix,
  bytes = DEVICE_ID_BYTES,
) {
  return `${prefix}_${crypto
    .randomBytes(bytes)
    .toString('hex')}`;
}

function generateSecret(
  bytes = DEVICE_SECRET_BYTES,
) {
  return crypto
    .randomBytes(bytes)
    .toString('base64url');
}

function hashSecret(
  secret,
) {
  return crypto
    .createHash('sha256')
    .update(secret, 'utf8')
    .digest('hex');
}

function timingSafeEqualStrings(
  left,
  right,
) {
  if (
    typeof left !== 'string' ||
    typeof right !== 'string'
  ) {
    return false;
  }

  const leftBuffer =
    Buffer.from(left);

  const rightBuffer =
    Buffer.from(right);

  if (
    leftBuffer.length !==
    rightBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    leftBuffer,
    rightBuffer,
  );
}

function clampBatchSize(
  value,
) {
  const parsed =
    Number(value);

  if (!Number.isFinite(parsed)) {
    return 100;
  }

  return Math.min(
    Math.max(
      Math.floor(parsed),
      1,
    ),
    MAX_BATCH_SIZE,
  );
}

function isValidObjectId(
  value,
) {
  return (
    typeof value === 'string' &&
    /^[a-f\d]{24}$/i.test(value)
  );
}

function now() {
  return new Date();
}

// =============================================================================
// Model Compatibility Helpers
// =============================================================================

/**
 * The OfflineDevice model is intentionally treated as the source of truth.
 *
 * These helpers allow the service to work with the production model while
 * keeping all device-domain decisions centralized here.
 */

function getDeviceState(
  device,
) {
  return (
    device.status ||
    device.state ||
    device.deviceStatus ||
    'PENDING'
  );
}

function getTrustState(
  device,
) {
  return (
    device.trustStatus ||
    device.trustState ||
    'UNTRUSTED'
  );
}

function isRevoked(
  device,
) {
  return (
    getDeviceState(device) ===
      'REVOKED' ||
    getTrustState(device) ===
      'REVOKED'
  );
}

function isActive(
  device,
) {
  return (
    getDeviceState(device) ===
    'ACTIVE'
  );
}

function isTrusted(
  device,
) {
  return (
    getTrustState(device) ===
    'TRUSTED'
  );
}

// =============================================================================
// Service
// =============================================================================

class OfflineDeviceService {
  // ===========================================================================
  // Constructor
  // ===========================================================================

  constructor({
    offlineDeviceModel = OfflineDevice,
    offlineEventModel = OfflineEvent,
    logger = null,
    auditService = null,
    eventBus = null,
    config = {},
  } = {}) {
    this.OfflineDevice =
      offlineDeviceModel;

    this.OfflineEvent =
      offlineEventModel;

    this.logger =
      logger;

    this.auditService =
      auditService;

    this.eventBus =
      eventBus;

    this.config = {
      heartbeatIntervalMs:
        Number(
          config.heartbeatIntervalMs ||
          DEFAULT_HEARTBEAT_INTERVAL_MS,
        ),

      maxClockSkewMs:
        Number(
          config.maxClockSkewMs ||
          DEFAULT_MAX_CLOCK_SKEW_MS,
        ),
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
    {
      tenantId,
      deviceId = null,
      actorId = null,
      metadata = {},
    } = {},
  ) {
    const payload = {
      type,
      service: SERVICE_NAME,
      tenantId,
      deviceId,
      actorId,
      metadata,
      occurredAt: now(),
    };

    try {
      if (
        this.auditService &&
        typeof this.auditService.record ===
          'function'
      ) {
        await this.auditService.record(
          payload,
        );
      }

      if (
        this.eventBus &&
        typeof this.eventBus.publish ===
          'function'
      ) {
        await this.eventBus.publish(
          `offline.device.${type.toLowerCase()}`,
          payload,
        );
      }
    } catch (error) {
      /*
       * Audit failures must be visible but should not silently transform a
       * successful device operation into an unknown state.
       */
      this._log(
        'error',
        'Unable to record offline device audit event.',
        {
          type,
          tenantId,
          deviceId,
          error:
            error.message,
        },
      );

      throw createServiceError(
        'Offline device audit operation failed.',
        'OFFLINE_DEVICE_AUDIT_FAILURE',
        500,
        {
          cause:
            error.message,
        },
      );
    }
  }

  // ===========================================================================
  // Device Lookup
  // ===========================================================================

  async findById(
    tenantId,
    deviceId,
    {
      session = null,
      includeRevoked = true,
    } = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedDeviceId =
      normalizeDeviceId(
        deviceId,
      );

    const query = {
      tenantId:
        normalizedTenantId,

      deviceId:
        normalizedDeviceId,
    };

    if (!includeRevoked) {
      query.status = {
        $ne: 'REVOKED',
      };
    }

    let request =
      this.OfflineDevice.findOne(
        query,
      );

    if (session) {
      request =
        request.session(
          session,
        );
    }

    return request.exec();
  }

  async requireDevice(
    tenantId,
    deviceId,
    options = {},
  ) {
    const device =
      await this.findById(
        tenantId,
        deviceId,
        options,
      );

    if (!device) {
      throw createServiceError(
        'Offline device was not found.',
        'OFFLINE_DEVICE_NOT_FOUND',
        404,
      );
    }

    return device;
  }

  // ===========================================================================
  // Registration
  // ===========================================================================

  async registerDevice({
    tenantId,
    deviceId = null,
    deviceFingerprint,
    deviceName = null,
    deviceContext = {},
    actorId = null,
    metadata = {},
    session = null,
  }) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedFingerprint =
      normalizeFingerprint(
        deviceFingerprint,
      );

    const normalizedActorId =
      normalizeActorId(
        actorId,
      );

    const generatedDeviceId =
      deviceId
        ? normalizeDeviceId(
            deviceId,
          )
        : generateIdentifier(
            'dev',
          );

    const existing =
      await this.findById(
        normalizedTenantId,
        generatedDeviceId,
        {
          session,
          includeRevoked: true,
        },
      );

    if (existing) {
      throw createServiceError(
        'Offline device already exists.',
        'OFFLINE_DEVICE_ALREADY_EXISTS',
        409,
        {
          deviceId:
            generatedDeviceId,
        },
      );
    }

    /*
     * Prevent a second active device from being registered with the same
     * fingerprint under the same tenant.
     */
    const fingerprintQuery = {
      tenantId:
        normalizedTenantId,

      deviceFingerprint:
        normalizedFingerprint,

      status: {
        $ne: 'DECOMMISSIONED',
      },
    };

    let fingerprintRequest =
      this.OfflineDevice.findOne(
        fingerprintQuery,
      );

    if (session) {
      fingerprintRequest =
        fingerprintRequest.session(
          session,
        );
    }

    const fingerprintConflict =
      await fingerprintRequest.exec();

    if (fingerprintConflict) {
      throw createServiceError(
        'An offline device with this fingerprint is already registered.',
        'OFFLINE_DEVICE_FINGERPRINT_ALREADY_REGISTERED',
        409,
      );
    }

    const deviceSecret =
      generateSecret();

    const authenticationSecretHash =
      hashSecret(
        deviceSecret,
      );

    const keyId =
      generateIdentifier(
        'key',
        12,
      );

    const data = {
      tenantId:
        normalizedTenantId,

      deviceId:
        generatedDeviceId,

      deviceFingerprint:
        normalizedFingerprint,

      deviceName:
        optionalString(
          deviceName,
        ),

      status:
        'PENDING',

      trustStatus:
        'PENDING',

      keyId,

      authenticationSecretHash,

      sequenceNumber:
        DEFAULT_SEQUENCE,

      lastAcceptedSequence:
        DEFAULT_SEQUENCE,

      lastEventHash:
        null,

      lastSeenAt:
        null,

      lastSyncAt:
        null,

      deviceContext: {
        clientVersion:
          optionalString(
            deviceContext.clientVersion,
          ),

        platform:
          optionalString(
            deviceContext.platform,
          ),

        platformVersion:
          optionalString(
            deviceContext.platformVersion,
          ),

        localDatabaseVersion:
          Number(
            deviceContext.localDatabaseVersion ||
            0,
          ),
      },

      registeredBy:
        normalizedActorId,

      metadata:
        metadata || {},
    };

    const options = {
      new: true,

      upsert: false,

      runValidators: true,
    };

    if (session) {
      options.session =
        session;
    }

    let device;

    try {
      device =
        await this.OfflineDevice.create(
          [data],
          session
            ? { session }
            : undefined,
        );

      device =
        Array.isArray(device)
          ? device[0]
          : device;
    } catch (error) {
      if (
        error?.code === 11000
      ) {
        throw createServiceError(
          'Offline device registration conflicts with an existing device.',
          'OFFLINE_DEVICE_REGISTRATION_CONFLICT',
          409,
        );
      }

      throw error;
    }

    await this._audit(
      'DEVICE_REGISTERED',
      {
        tenantId:
          normalizedTenantId,

        deviceId:
          generatedDeviceId,

        actorId:
          normalizedActorId,

        metadata,
      },
    );

    /*
     * The plaintext secret is returned exactly once.
     *
     * It must never be persisted in plaintext.
     */
    return {
      device,
      credentials: {
        deviceId:
          generatedDeviceId,

        keyId,

        deviceSecret,
      },
    };
  }

  // ===========================================================================
  // Device Authentication
  // ===========================================================================

  async authenticateDevice({
    tenantId,
    deviceId,
    deviceFingerprint,
    deviceSecret,
    keyId = null,
    requireTrusted = true,
    requireActive = true,
    session = null,
  }) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedDeviceId =
      normalizeDeviceId(
        deviceId,
      );

    const normalizedFingerprint =
      normalizeFingerprint(
        deviceFingerprint,
      );

    const normalizedSecret =
      requireString(
        deviceSecret,
        'deviceSecret',
      );

    const device =
      await this.requireDevice(
        normalizedTenantId,
        normalizedDeviceId,
        {
          session,
        },
      );

    if (
      isRevoked(device)
    ) {
      await this._audit(
        'DEVICE_AUTHENTICATION_FAILED',
        {
          tenantId:
            normalizedTenantId,

          deviceId:
            normalizedDeviceId,

          metadata: {
            reason:
              'DEVICE_REVOKED',
          },
        },
      );

      throw createServiceError(
        'Offline device has been revoked.',
        'OFFLINE_DEVICE_REVOKED',
        403,
      );
    }

    if (
      getDeviceState(device) ===
      'DECOMMISSIONED'
    ) {
      throw createServiceError(
        'Offline device has been decommissioned.',
        'OFFLINE_DEVICE_DECOMMISSIONED',
        403,
      );
    }

    if (
      normalizedFingerprint !==
      String(
        device.deviceFingerprint || '',
      ).toLowerCase()
    ) {
      await this._audit(
        'DEVICE_FINGERPRINT_MISMATCH',
        {
          tenantId:
            normalizedTenantId,

          deviceId:
            normalizedDeviceId,

          metadata: {
            expected:
              device.deviceFingerprint,

            received:
              normalizedFingerprint,
          },
        },
      );

      throw createServiceError(
        'Offline device fingerprint mismatch.',
        'OFFLINE_DEVICE_FINGERPRINT_MISMATCH',
        403,
      );
    }

    if (
      keyId &&
      device.keyId &&
      keyId !== device.keyId
    ) {
      throw createServiceError(
        'Offline device key identity mismatch.',
        'OFFLINE_DEVICE_KEY_MISMATCH',
        403,
      );
    }

    const expectedHash =
      device.authenticationSecretHash;

    const receivedHash =
      hashSecret(
        normalizedSecret,
      );

    if (
      !timingSafeEqualStrings(
        expectedHash,
        receivedHash,
      )
    ) {
      await this._audit(
        'DEVICE_AUTHENTICATION_FAILED',
        {
          tenantId:
            normalizedTenantId,

          deviceId:
            normalizedDeviceId,

          metadata: {
            reason:
              'INVALID_CREDENTIALS',
          },
        },
      );

      throw createServiceError(
        'Offline device authentication failed.',
        'OFFLINE_DEVICE_AUTHENTICATION_FAILED',
        401,
      );
    }

    if (
      requireTrusted &&
      !isTrusted(device)
    ) {
      throw createServiceError(
        'Offline device is not trusted.',
        'OFFLINE_DEVICE_NOT_TRUSTED',
        403,
      );
    }

    if (
      requireActive &&
      !isActive(device)
    ) {
      throw createServiceError(
        'Offline device is not active.',
        'OFFLINE_DEVICE_NOT_ACTIVE',
        403,
      );
    }

    return {
      authenticated: true,

      device,

      deviceId:
        normalizedDeviceId,

      tenantId:
        normalizedTenantId,
    };
  }

  // ===========================================================================
  // Trust Management
  // ===========================================================================

  async trustDevice({
    tenantId,
    deviceId,
    actorId = null,
    reason = null,
    session = null,
  }) {
    const device =
      await this.requireDevice(
        tenantId,
        deviceId,
        {
          session,
        },
      );

    if (
      isRevoked(device)
    ) {
      throw createServiceError(
        'A revoked device cannot be trusted.',
        'OFFLINE_DEVICE_REVOKED',
        409,
      );
    }

    if (
      getDeviceState(device) ===
      'DECOMMISSIONED'
    ) {
      throw createServiceError(
        'A decommissioned device cannot be trusted.',
        'OFFLINE_DEVICE_DECOMMISSIONED',
        409,
      );
    }

    device.trustStatus =
      'TRUSTED';

    device.status =
      'ACTIVE';

    device.trustedAt =
      now();

    device.trustedBy =
      normalizeActorId(
        actorId,
      );

    device.trustReason =
      optionalString(
        reason,
      );

    await device.save(
      session
        ? { session }
        : undefined,
    );

    await this._audit(
      'DEVICE_TRUSTED',
      {
        tenantId,
        deviceId,
        actorId,
        metadata: {
          reason,
        },
      },
    );

    return device;
  }

  async suspendDevice({
    tenantId,
    deviceId,
    actorId = null,
    reason = 'Device suspended.',
    session = null,
  }) {
    const device =
      await this.requireDevice(
        tenantId,
        deviceId,
        {
          session,
        },
      );

    if (
      getDeviceState(device) ===
      'REVOKED'
    ) {
      throw createServiceError(
        'A revoked device cannot be suspended.',
        'OFFLINE_DEVICE_REVOKED',
        409,
      );
    }

    device.status =
      'SUSPENDED';

    device.suspendedAt =
      now();

    device.suspendedBy =
      normalizeActorId(
        actorId,
      );

    device.suspensionReason =
      optionalString(
        reason,
      );

    await device.save(
      session
        ? { session }
        : undefined,
    );

    await this._audit(
      'DEVICE_SUSPENDED',
      {
        tenantId,
        deviceId,
        actorId,
        metadata: {
          reason,
        },
      },
    );

    return device;
  }

  async reactivateDevice({
    tenantId,
    deviceId,
    actorId = null,
    reason = null,
    session = null,
  }) {
    const device =
      await this.requireDevice(
        tenantId,
        deviceId,
        {
          session,
        },
      );

    if (
      getDeviceState(device) ===
      'REVOKED'
    ) {
      throw createServiceError(
        'A revoked device cannot be reactivated.',
        'OFFLINE_DEVICE_REVOKED',
        409,
      );
    }

    if (
      getDeviceState(device) ===
      'DECOMMISSIONED'
    ) {
      throw createServiceError(
        'A decommissioned device cannot be reactivated.',
        'OFFLINE_DEVICE_DECOMMISSIONED',
        409,
      );
    }

    if (
      !isTrusted(device)
    ) {
      throw createServiceError(
        'Device must be trusted before it can be reactivated.',
        'OFFLINE_DEVICE_NOT_TRUSTED',
        409,
      );
    }

    device.status =
      'ACTIVE';

    device.reactivatedAt =
      now();

    device.reactivatedBy =
      normalizeActorId(
        actorId,
      );

    device.reactivationReason =
      optionalString(
        reason,
      );

    await device.save(
      session
        ? { session }
        : undefined,
    );

    await this._audit(
      'DEVICE_REACTIVATED',
      {
        tenantId,
        deviceId,
        actorId,
        metadata: {
          reason,
        },
      },
    );

    return device;
  }

  async revokeDevice({
    tenantId,
    deviceId,
    actorId = null,
    reason = 'Device revoked.',
    session = null,
  }) {
    const device =
      await this.requireDevice(
        tenantId,
        deviceId,
        {
          session,
        },
      );

    if (
      getDeviceState(device) ===
      'DECOMMISSIONED'
    ) {
      throw createServiceError(
        'A decommissioned device cannot be revoked.',
        'OFFLINE_DEVICE_DECOMMISSIONED',
        409,
      );
    }

    device.status =
      'REVOKED';

    device.trustStatus =
      'REVOKED';

    device.revokedAt =
      now();

    device.revokedBy =
      normalizeActorId(
        actorId,
      );

    device.revocationReason =
      optionalString(
        reason,
      );

    /*
     * Once revoked, all future synchronization attempts must fail.
     */
    device.syncEnabled =
      false;

    await device.save(
      session
        ? { session }
        : undefined,
    );

    await this._audit(
      'DEVICE_REVOKED',
      {
        tenantId,
        deviceId,
        actorId,
        metadata: {
          reason,
        },
      },
    );

    return device;
  }

  async decommissionDevice({
    tenantId,
    deviceId,
    actorId = null,
    reason = 'Device decommissioned.',
    session = null,
  }) {
    const device =
      await this.requireDevice(
        tenantId,
        deviceId,
        {
          session,
        },
      );

    device.status =
      'DECOMMISSIONED';

    device.trustStatus =
      'REVOKED';

    device.syncEnabled =
      false;

    device.decommissionedAt =
      now();

    device.decommissionedBy =
      normalizeActorId(
        actorId,
      );

    device.decommissionReason =
      optionalString(
        reason,
      );

    await device.save(
      session
        ? { session }
        : undefined,
    );

    await this._audit(
      'DEVICE_DECOMMISSIONED',
      {
        tenantId,
        deviceId,
        actorId,
        metadata: {
          reason,
        },
      },
    );

    return device;
  }

  // ===========================================================================
  // Device Authorization
  // ===========================================================================

  async assertDeviceCanSync({
    tenantId,
    deviceId,
    deviceFingerprint,
    deviceSecret = null,
    keyId = null,
    requireCredentials = false,
  }) {
    const device =
      await this.requireDevice(
        tenantId,
        deviceId,
      );

    if (
      isRevoked(device)
    ) {
      throw createServiceError(
        'Device is revoked and cannot synchronize.',
        'OFFLINE_DEVICE_REVOKED',
        403,
      );
    }

    if (
      getDeviceState(device) ===
      'DECOMMISSIONED'
    ) {
      throw createServiceError(
        'Device is decommissioned and cannot synchronize.',
        'OFFLINE_DEVICE_DECOMMISSIONED',
        403,
      );
    }

    if (
      getDeviceState(device) ===
      'SUSPENDED'
    ) {
      throw createServiceError(
        'Device is suspended and cannot synchronize.',
        'OFFLINE_DEVICE_SUSPENDED',
        403,
      );
    }

    if (
      getDeviceState(device) !==
      'ACTIVE'
    ) {
      throw createServiceError(
        'Device is not active.',
        'OFFLINE_DEVICE_NOT_ACTIVE',
        403,
      );
    }

    if (
      getTrustState(device) !==
      'TRUSTED'
    ) {
      throw createServiceError(
        'Device is not trusted.',
        'OFFLINE_DEVICE_NOT_TRUSTED',
        403,
      );
    }

    if (
      device.syncEnabled === false
    ) {
      throw createServiceError(
        'Synchronization is disabled for this device.',
        'OFFLINE_DEVICE_SYNC_DISABLED',
        403,
      );
    }

    if (
      deviceFingerprint
    ) {
      const received =
        normalizeFingerprint(
          deviceFingerprint,
        );

      if (
        received !==
        String(
          device.deviceFingerprint ||
          '',
        ).toLowerCase()
      ) {
        throw createServiceError(
          'Device fingerprint mismatch.',
          'OFFLINE_DEVICE_FINGERPRINT_MISMATCH',
          403,
        );
      }
    }

    if (
      keyId &&
      device.keyId &&
      keyId !== device.keyId
    ) {
      throw createServiceError(
        'Device key identity mismatch.',
        'OFFLINE_DEVICE_KEY_MISMATCH',
        403,
      );
    }

    if (
      requireCredentials
    ) {
      if (
        !deviceSecret
      ) {
        throw createServiceError(
          'Device credentials are required.',
          'OFFLINE_DEVICE_CREDENTIALS_REQUIRED',
          401,
        );
      }

      await this.authenticateDevice({
        tenantId,
        deviceId,
        deviceFingerprint,
        deviceSecret,
        keyId,
        requireTrusted: true,
        requireActive: true,
      });
    }

    return device;
  }

  // ===========================================================================
  // Heartbeat
  // ===========================================================================

  async heartbeat({
    tenantId,
    deviceId,
    deviceFingerprint = null,
    clientVersion = null,
    platform = null,
    platformVersion = null,
    lastLocalSequence = null,
    session = null,
  }) {
    const device =
      await this.requireDevice(
        tenantId,
        deviceId,
        {
          session,
        },
      );

    if (
      isRevoked(device)
    ) {
      throw createServiceError(
        'Revoked device cannot send heartbeat.',
        'OFFLINE_DEVICE_REVOKED',
        403,
      );
    }

    if (
      deviceFingerprint &&
      normalizeFingerprint(
        deviceFingerprint,
      ) !==
        String(
          device.deviceFingerprint ||
          '',
        ).toLowerCase()
    ) {
      throw createServiceError(
        'Device fingerprint mismatch.',
        'OFFLINE_DEVICE_FINGERPRINT_MISMATCH',
        403,
      );
    }

    const timestamp =
      now();

    device.lastSeenAt =
      timestamp;

    if (
      clientVersion
    ) {
      device.clientVersion =
        optionalString(
          clientVersion,
        );
    }

    if (
      platform
    ) {
      device.platform =
        optionalString(
          platform,
        );
    }

    if (
      platformVersion
    ) {
      device.platformVersion =
        optionalString(
          platformVersion,
        );
    }

    if (
      Number.isInteger(
        Number(
          lastLocalSequence,
        ),
      ) &&
      Number(
        lastLocalSequence,
      ) >= 0
    ) {
      device.lastLocalSequence =
        Number(
          lastLocalSequence,
        );
    }

    await device.save(
      session
        ? { session }
        : undefined,
    );

    return {
      deviceId:
        device.deviceId,

      status:
        getDeviceState(device),

      trustStatus:
        getTrustState(device),

      syncEnabled:
        device.syncEnabled !== false,

      lastAcceptedSequence:
        Number(
          device.lastAcceptedSequence ||
          DEFAULT_SEQUENCE,
        ),

      lastEventHash:
        device.lastEventHash || null,

      serverTime:
        timestamp,

      heartbeatIntervalMs:
        this.config
          .heartbeatIntervalMs,
    };
  }

  // ===========================================================================
  // Sequence Management
  // ===========================================================================

  async getSequenceState({
    tenantId,
    deviceId,
    session = null,
  }) {
    const device =
      await this.requireDevice(
        tenantId,
        deviceId,
        {
          session,
        },
      );

    return {
      tenantId:
        device.tenantId,

      deviceId:
        device.deviceId,

      lastAcceptedSequence:
        Number(
          device.lastAcceptedSequence ||
          DEFAULT_SEQUENCE,
        ),

      nextExpectedSequence:
        Number(
          device.lastAcceptedSequence ||
          DEFAULT_SEQUENCE,
        ) + 1,

      lastEventHash:
        device.lastEventHash || null,

      lastSyncAt:
        device.lastSyncAt || null,
    };
  }

  /**
   * Validate an incoming event's device sequence.
   *
   * This method does not mutate the device.
   *
   * It intentionally distinguishes:
   *
   *   - replay
   *   - expected event
   *   - sequence gap
   */
  async validateSequence({
    tenantId,
    deviceId,
    sequenceNumber,
    previousEventHash = null,
    session = null,
  }) {
    const device =
      await this.requireDevice(
        tenantId,
        deviceId,
        {
          session,
        },
      );

    const lastAccepted =
      Number(
        device.lastAcceptedSequence ||
        DEFAULT_SEQUENCE,
      );

    const expected =
      lastAccepted + 1;

    const incoming =
      Number(
        sequenceNumber,
      );

    if (
      !Number.isInteger(incoming) ||
      incoming < 1
    ) {
      throw createServiceError(
        'Invalid offline event sequence number.',
        'OFFLINE_DEVICE_INVALID_SEQUENCE',
        400,
      );
    }

    if (
      incoming <=
      lastAccepted
    ) {
      await this._audit(
        'DEVICE_REPLAY_DETECTED',
        {
          tenantId,
          deviceId,
          metadata: {
            incomingSequence:
              incoming,

            lastAcceptedSequence:
              lastAccepted,
          },
        },
      );

      throw createServiceError(
        'Offline event sequence has already been processed.',
        'OFFLINE_DEVICE_SEQUENCE_REPLAY',
        409,
        {
          incomingSequence:
            incoming,

          lastAcceptedSequence:
            lastAccepted,
        },
      );
    }

    if (
      incoming >
      expected
    ) {
      await this._audit(
        'DEVICE_SEQUENCE_VIOLATION',
        {
          tenantId,
          deviceId,
          metadata: {
            incomingSequence:
              incoming,

            expectedSequence:
              expected,
          },
        },
      );

      return {
        valid: false,

        type:
          'SEQUENCE_GAP',

        expectedSequence:
          expected,

        receivedSequence:
          incoming,

        lastAcceptedSequence:
          lastAccepted,
      };
    }

    if (
      previousEventHash &&
      device.lastEventHash &&
      previousEventHash !==
        device.lastEventHash
    ) {
      await this._audit(
        'DEVICE_SEQUENCE_VIOLATION',
        {
          tenantId,
          deviceId,
          metadata: {
            reason:
              'HASH_CHAIN_MISMATCH',

            expectedHash:
              device.lastEventHash,

            receivedHash:
              previousEventHash,
          },
        },
      );

      return {
        valid: false,

        type:
          'HASH_CHAIN_CONFLICT',

        expectedSequence:
          expected,

        expectedPreviousEventHash:
          device.lastEventHash,

        receivedPreviousEventHash:
          previousEventHash,
      };
    }

    return {
      valid: true,

      type:
        'EXPECTED',

      expectedSequence:
        expected,

      receivedSequence:
        incoming,

      lastAcceptedSequence:
        lastAccepted,
    };
  }

  /**
   * Atomically advance device sequence state after an event has been
   * authoritatively accepted.
   *
   * This method should be invoked inside the same MongoDB transaction as the
   * corresponding domain operation whenever the event affects authoritative
   * state.
   */
  async commitSequence({
    tenantId,
    deviceId,
    sequenceNumber,
    eventHash,
    session = null,
  }) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedDeviceId =
      normalizeDeviceId(
        deviceId,
      );

    const normalizedSequence =
      Number(
        sequenceNumber,
      );

    const normalizedEventHash =
      requireString(
        eventHash,
        'eventHash',
      ).toLowerCase();

    if (
      !Number.isInteger(
        normalizedSequence,
      ) ||
      normalizedSequence < 1
    ) {
      throw createServiceError(
        'Invalid sequence number.',
        'OFFLINE_DEVICE_INVALID_SEQUENCE',
        400,
      );
    }

    const query = {
      tenantId:
        normalizedTenantId,

      deviceId:
        normalizedDeviceId,

      lastAcceptedSequence:
        normalizedSequence - 1,
    };

    const update = {
      $set: {
        lastAcceptedSequence:
          normalizedSequence,

        lastEventHash:
          normalizedEventHash,

        lastSyncAt:
          now(),

        lastSeenAt:
          now(),
      },

      $inc: {
        sequenceVersion: 1,
      },
    };

    const options = {
      new: true,

      runValidators: true,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.OfflineDevice.findOneAndUpdate(
        query,
        update,
        options,
      );

    if (!updated) {
      throw createServiceError(
        'Device sequence could not be advanced atomically.',
        'OFFLINE_DEVICE_SEQUENCE_COMMIT_CONFLICT',
        409,
        {
          deviceId:
            normalizedDeviceId,

          sequenceNumber:
            normalizedSequence,
        },
      );
    }

    return updated;
  }

  // ===========================================================================
  // Synchronization State
  // ===========================================================================

  async markSynchronized({
    tenantId,
    deviceId,
    syncCursor = null,
    lastAcceptedSequence = null,
    lastEventHash = null,
    session = null,
  }) {
    const device =
      await this.requireDevice(
        tenantId,
        deviceId,
        {
          session,
        },
      );

    if (
      syncCursor !== null
    ) {
      device.syncCursor =
        optionalString(
          syncCursor,
        );
    }

    if (
      Number.isInteger(
        Number(
          lastAcceptedSequence,
        ),
      )
    ) {
      device.lastAcceptedSequence =
        Number(
          lastAcceptedSequence,
        );
    }

    if (
      lastEventHash
    ) {
      device.lastEventHash =
        optionalString(
          lastEventHash,
        );
    }

    device.lastSyncAt =
      now();

    device.lastSeenAt =
      now();

    await device.save(
      session
        ? { session }
        : undefined,
    );

    return device;
  }

  async getSyncState({
    tenantId,
    deviceId,
    session = null,
  }) {
    const device =
      await this.requireDevice(
        tenantId,
        deviceId,
        {
          session,
        },
      );

    return {
      tenantId:
        device.tenantId,

      deviceId:
        device.deviceId,

      status:
        getDeviceState(device),

      trustStatus:
        getTrustState(device),

      syncEnabled:
        device.syncEnabled !== false,

      syncCursor:
        device.syncCursor || null,

      lastAcceptedSequence:
        Number(
          device.lastAcceptedSequence ||
          DEFAULT_SEQUENCE,
        ),

      nextExpectedSequence:
        Number(
          device.lastAcceptedSequence ||
          DEFAULT_SEQUENCE,
        ) + 1,

      lastEventHash:
        device.lastEventHash || null,

      lastSyncAt:
        device.lastSyncAt || null,

      lastSeenAt:
        device.lastSeenAt || null,
    };
  }

  // ===========================================================================
  // Event Ownership / Validation
  // ===========================================================================

  async assertEventBelongsToDevice({
    tenantId,
    deviceId,
    event,
  }) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedDeviceId =
      normalizeDeviceId(
        deviceId,
      );

    if (!event) {
      throw createServiceError(
        'Offline event is required.',
        'OFFLINE_EVENT_REQUIRED',
        400,
      );
    }

    if (
      String(event.tenantId) !==
      normalizedTenantId
    ) {
      throw createServiceError(
        'Offline event tenant boundary violation.',
        'OFFLINE_EVENT_TENANT_MISMATCH',
        403,
      );
    }

    if (
      String(event.deviceId) !==
      normalizedDeviceId
    ) {
      throw createServiceError(
        'Offline event device ownership violation.',
        'OFFLINE_EVENT_DEVICE_MISMATCH',
        403,
      );
    }

    if (
      event.deviceContext?.deviceId &&
      String(
        event.deviceContext.deviceId,
      ) !== normalizedDeviceId
    ) {
      throw createServiceError(
        'Offline event device context mismatch.',
        'OFFLINE_EVENT_DEVICE_CONTEXT_MISMATCH',
        403,
      );
    }

    if (
      event.deviceFingerprint &&
      event.deviceContext?.deviceFingerprint &&
      String(
        event.deviceFingerprint,
      ).toLowerCase() !==
        String(
          event.deviceContext.deviceFingerprint,
        ).toLowerCase()
    ) {
      throw createServiceError(
        'Offline event contains inconsistent device fingerprints.',
        'OFFLINE_EVENT_FINGERPRINT_CONFLICT',
        409,
      );
    }

    return true;
  }

  // ===========================================================================
  // Event Integrity
  // ===========================================================================

  async validateEventIntegrity(
    event,
  ) {
    if (!event) {
      throw createServiceError(
        'Offline event is required.',
        'OFFLINE_EVENT_REQUIRED',
        400,
      );
    }

    if (
      typeof event.verifyIntegrity ===
      'function'
    ) {
      const valid =
        event.verifyIntegrity();

      if (!valid) {
        throw createServiceError(
          'Offline event integrity verification failed.',
          'OFFLINE_EVENT_INTEGRITY_FAILURE',
          409,
        );
      }

      return {
        valid: true,
      };
    }

    /*
     * Defensive fallback for plain event objects.
     */
    if (
      typeof event.verifyPayloadHash ===
      'function' &&
      !event.verifyPayloadHash()
    ) {
      throw createServiceError(
        'Offline event payload integrity verification failed.',
        'OFFLINE_EVENT_PAYLOAD_INTEGRITY_FAILURE',
        409,
      );
    }

    if (
      typeof event.verifyEventHash ===
      'function' &&
      !event.verifyEventHash()
    ) {
      throw createServiceError(
        'Offline event hash verification failed.',
        'OFFLINE_EVENT_HASH_INTEGRITY_FAILURE',
        409,
      );
    }

    return {
      valid: true,
    };
  }

  // ===========================================================================
  // Batch Validation
  // ===========================================================================

  async validateEventBatch({
    tenantId,
    deviceId,
    events,
    session = null,
  }) {
    if (!Array.isArray(events)) {
      throw createServiceError(
        'Offline events must be provided as an array.',
        'OFFLINE_EVENT_BATCH_INVALID',
        400,
      );
    }

    const safeEvents =
      events.slice(
        0,
        MAX_BATCH_SIZE,
      );

    if (
      safeEvents.length === 0
    ) {
      return {
        valid: true,
        count: 0,
        results: [],
      };
    }

    if (
      events.length >
      MAX_BATCH_SIZE
    ) {
      throw createServiceError(
        `Offline event batch exceeds maximum size of ${MAX_BATCH_SIZE}.`,
        'OFFLINE_EVENT_BATCH_TOO_LARGE',
        413,
      );
    }

    const results = [];

    let expectedSequence =
      (
        await this.getSequenceState({
          tenantId,
          deviceId,
          session,
        })
      ).nextExpectedSequence;

    let expectedPreviousHash =
      (
        await this.getSequenceState({
          tenantId,
          deviceId,
          session,
        })
      ).lastEventHash;

    for (
      const event of safeEvents
    ) {
      await this.assertEventBelongsToDevice({
        tenantId,
        deviceId,
        event,
      });

      await this.validateEventIntegrity(
        event,
      );

      const sequence =
        Number(
          event.sequenceNumber,
        );

      if (
        sequence !==
        expectedSequence
      ) {
        return {
          valid: false,

          count:
            safeEvents.length,

          results,

          conflict: {
            type:
              sequence <
              expectedSequence
                ? 'SEQUENCE_REPLAY'
                : 'SEQUENCE_GAP',

            expectedSequence,

            receivedSequence:
              sequence,
          },
        };
      }

      if (
        expectedPreviousHash &&
        event.previousEventHash &&
        event.previousEventHash !==
          expectedPreviousHash
      ) {
        return {
          valid: false,

          count:
            safeEvents.length,

          results,

          conflict: {
            type:
              'HASH_CHAIN_CONFLICT',

            expectedPreviousEventHash:
              expectedPreviousHash,

            receivedPreviousEventHash:
              event.previousEventHash,
          },
        };
      }

      results.push({
        eventId:
          event.eventId,

        sequenceNumber:
          sequence,

        eventHash:
          event.eventHash,

        valid:
          true,
      });

      expectedSequence += 1;

      expectedPreviousHash =
        event.eventHash;
    }

    return {
      valid: true,

      count:
        safeEvents.length,

      results,
    };
  }

  // ===========================================================================
  // Device Event History
  // ===========================================================================

  async getEventHistory({
    tenantId,
    deviceId,
    limit = 100,
    beforeSequence = null,
  }) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const normalizedDeviceId =
      normalizeDeviceId(
        deviceId,
      );

    const safeLimit =
      clampBatchSize(
        limit,
      );

    const query = {
      tenantId:
        normalizedTenantId,

      deviceId:
        normalizedDeviceId,
    };

    if (
      Number.isInteger(
        Number(
          beforeSequence,
        ),
      )
    ) {
      query.sequenceNumber = {
        $lt:
          Number(
            beforeSequence,
          ),
      };
    }

    return this.OfflineEvent
      .find(query)
      .sort({
        sequenceNumber: -1,
      })
      .limit(safeLimit)
      .lean()
      .exec();
  }

  // ===========================================================================
  // Device Health
  // ===========================================================================

  async getDeviceHealth({
    tenantId,
    deviceId,
  }) {
    const device =
      await this.requireDevice(
        tenantId,
        deviceId,
      );

    const timestamp =
      now();

    const lastSeenAt =
      device.lastSeenAt
        ? new Date(
            device.lastSeenAt,
          )
        : null;

    const ageMs =
      lastSeenAt
        ? timestamp.getTime() -
          lastSeenAt.getTime()
        : null;

    const stale =
      ageMs !== null &&
      ageMs >
        this.config
          .heartbeatIntervalMs *
          3;

    return {
      healthy:
        !isRevoked(device) &&
        getDeviceState(device) ===
          'ACTIVE' &&
        getTrustState(device) ===
          'TRUSTED' &&
        device.syncEnabled !== false &&
        !stale,

      deviceId:
        device.deviceId,

      tenantId:
        device.tenantId,

      status:
        getDeviceState(device),

      trustStatus:
        getTrustState(device),

      syncEnabled:
        device.syncEnabled !== false,

      stale,

      lastSeenAt,

      lastSyncAt:
        device.lastSyncAt || null,

      lastAcceptedSequence:
        Number(
          device.lastAcceptedSequence ||
          DEFAULT_SEQUENCE,
        ),

      nextExpectedSequence:
        Number(
          device.lastAcceptedSequence ||
          DEFAULT_SEQUENCE,
        ) + 1,

      lastEventHash:
        device.lastEventHash || null,
    };
  }

  // ===========================================================================
  // Clock Validation
  // ===========================================================================

  validateClientTimestamp(
    occurredAt,
    {
      maxClockSkewMs =
        this.config.maxClockSkewMs,
    } = {},
  ) {
    if (!occurredAt) {
      throw createServiceError(
        'Client event timestamp is required.',
        'OFFLINE_DEVICE_TIMESTAMP_REQUIRED',
        400,
      );
    }

    const timestamp =
      new Date(
        occurredAt,
      );

    if (
      Number.isNaN(
        timestamp.getTime(),
      )
    ) {
      throw createServiceError(
        'Invalid client event timestamp.',
        'OFFLINE_DEVICE_INVALID_TIMESTAMP',
        400,
      );
    }

    const difference =
      Math.abs(
        now().getTime() -
          timestamp.getTime(),
      );

    if (
      difference >
      Number(maxClockSkewMs)
    ) {
      return {
        valid: false,

        reason:
          'CLOCK_SKEW',

        differenceMs:
          difference,

        maxClockSkewMs:
          Number(maxClockSkewMs),
      };
    }

    return {
      valid: true,

      differenceMs:
        difference,
    };
  }

  // ===========================================================================
  // Device Listing
  // ===========================================================================

  async listDevices({
    tenantId,
    status = null,
    trustStatus = null,
    limit = 100,
    skip = 0,
  }) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    const safeLimit =
      Math.min(
        Math.max(
          Number(limit) || 100,
          1,
        ),
        MAX_BATCH_SIZE,
      );

    const safeSkip =
      Math.max(
        Number(skip) || 0,
        0,
      );

    const query = {
      tenantId:
        normalizedTenantId,
    };

    if (
      status &&
      DEVICE_STATES.includes(
        status,
      )
    ) {
      query.status =
        status;
    }

    if (
      trustStatus &&
      TRUST_STATES.includes(
        trustStatus,
      )
    ) {
      query.trustStatus =
        trustStatus;
    }

    const [
      devices,
      total,
    ] = await Promise.all([
      this.OfflineDevice
        .find(query)
        .sort({
          createdAt: -1,
        })
        .skip(safeSkip)
        .limit(safeLimit)
        .lean()
        .exec(),

      this.OfflineDevice.countDocuments(
        query,
      ),
    ]);

    return {
      devices,

      pagination: {
        total,

        limit:
          safeLimit,

        skip:
          safeSkip,

        hasMore:
          safeSkip +
            devices.length <
          total,
      },
    };
  }

  // ===========================================================================
  // Security Event Helpers
  // ===========================================================================

  async recordSecurityEvent({
    tenantId,
    deviceId,
    type,
    actorId = null,
    metadata = {},
  }) {
    if (
      !SECURITY_EVENT_TYPES.includes(
        type,
      )
    ) {
      throw createServiceError(
        `Unsupported offline device security event: ${type}`,
        'OFFLINE_DEVICE_SECURITY_EVENT_INVALID',
        400,
      );
    }

    await this._audit(
      type,
      {
        tenantId,
        deviceId,
        actorId,
        metadata,
      },
    );

    return {
      recorded: true,

      type,

      tenantId,

      deviceId,

      occurredAt:
        now(),
    };
  }

  // ===========================================================================
  // Safe Device Representation
  // ===========================================================================

  toSafeDevice(
    device,
  ) {
    if (!device) {
      return null;
    }

    const source =
      typeof device.toObject ===
      'function'
        ? device.toObject()
        : device;

    /*
     * Never expose authenticationSecretHash or other credential material.
     */
    const safe = {
      ...source,
    };

    delete safe.authenticationSecretHash;

    delete safe.deviceSecret;

    delete safe.secret;

    delete safe.privateKey;

    delete safe.encryptionKey;

    return safe;
  }
}

// =============================================================================
// Singleton
// =============================================================================

const offlineDeviceService =
  new OfflineDeviceService();

// =============================================================================
// Exports
// =============================================================================

module.exports =
  offlineDeviceService;

module.exports.OfflineDeviceService =
  OfflineDeviceService;

module.exports.SERVICE_NAME =
  SERVICE_NAME;

module.exports.DEVICE_STATES =
  DEVICE_STATES;

module.exports.TRUST_STATES =
  TRUST_STATES;

module.exports.SECURITY_EVENT_TYPES =
  SECURITY_EVENT_TYPES;