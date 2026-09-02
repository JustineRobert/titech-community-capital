// backend/modules/disasterRecoveryService.js
'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Disaster Recovery Service
 * ============================================================================
 *
 * File:
 *   backend/modules/disasterRecoveryService.js
 *
 * Responsibilities:
 *   - Full / tenant-scoped backups
 *   - Snapshot creation
 *   - Compression
 *   - Encryption orchestration
 *   - Backup integrity verification
 *   - Backup restoration
 *   - Point-in-time recovery orchestration
 *   - Failover / failback lifecycle management
 *   - Recovery drills
 *   - Backup scheduling
 *   - Retention management
 *   - RPO / RTO monitoring
 *   - Audit integration
 *   - Metrics integration
 *
 * Design principles:
 *   - Multi-tenant isolation
 *   - Fail-safe recovery
 *   - Explicit destructive-operation controls
 *   - Immutable backup evidence
 *   - Integrity verification before restore
 *   - Atomic local backup writes
 *   - Dependency injection
 *   - Backward-compatible service API
 *
 * IMPORTANT:
 * This service orchestrates disaster recovery. It does not pretend that
 * "failover completed" merely because a database record was written.
 * Actual infrastructure failover should be implemented by the configured
 * infrastructure/provider adapter.
 * ============================================================================
 */

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const EventEmitter = require('events');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const BACKUP_STATUS = Object.freeze({
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  VERIFIED: 'verified',
  RESTORING: 'restoring',
  RESTORED: 'restored',
  CORRUPTED: 'corrupted',
});

const BACKUP_TYPES = Object.freeze({
  FULL: 'full',
  SNAPSHOT: 'snapshot',
  INCREMENTAL: 'incremental',
});

const RECOVERY_STATUS = Object.freeze({
  REQUESTED: 'requested',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

const DEFAULT_COLLECTIONS = Object.freeze([
  'customers',
  'accounts',
  'transactions',
  'loans',
  'savingsAccounts',
  'subscriptions',
  'invoices',
  'kycProfiles',
  'fraudAlerts',
  'amlAlerts',
]);

const DEFAULTS = Object.freeze({
  backupDirectory: path.join(
    process.cwd(),
    'storage',
    'backups'
  ),

  retentionDays: 30,

  compression: true,

  encryption: true,

  defaultRPOMinutes: 15,

  defaultRTOMinutes: 60,

  /*
   * Local backup writes use a temporary file followed by rename.
   */
  atomicWrites: true,

  /*
   * Verify the generated backup before marking it completed.
   */
  verifyAfterCreate: true,

  /*
   * Prevent destructive restore operations unless explicitly enabled.
   */
  allowDestructiveRestore: false,

  /*
   * Do not restore more records than this in a single service invocation
   * unless explicitly overridden.
   */
  maxRestoreRecords: 1_000_000,

  /*
   * Maximum size of an individual backup file that this service will process.
   * 0 disables the guard.
   */
  maxBackupBytes: 0,

  /*
   * Default collection set.
   */
  collections: DEFAULT_COLLECTIONS,

  /*
   * Require tenantId for tenant-scoped restore operations.
   */
  requireTenantIsolation: true,

  /*
   * Critical audit failures can optionally fail recovery operations.
   */
  failClosedOnCriticalAuditError: false,

  /*
   * A backup can only be restored if its integrity hash is valid.
   */
  requireIntegrityVerification: true,

  /*
   * Retention cleanup should not delete the most recent backup for a tenant.
   */
  preserveLatestBackup: true,

  /*
   * Point-in-time recovery searches within this time window.
   */
  pointInTimeSearchLimit: 100,

  /*
   * Failover operations require an infrastructure adapter.
   */
  requireFailoverAdapter: false,

  /*
   * Service version recorded in manifests.
   */
  serviceVersion: '1.0.0',
});

/**
 * ============================================================================
 * Domain Error
 * ============================================================================
 */

class DisasterRecoveryError extends Error {
  constructor(
    message,
    code = 'DISASTER_RECOVERY_ERROR',
    details = {}
  ) {
    super(message);

    this.name =
      'DisasterRecoveryError';

    this.code = code;

    this.details = details;

    Error.captureStackTrace?.(
      this,
      DisasterRecoveryError
    );
  }
}

/**
 * ============================================================================
 * Disaster Recovery Service
 * ============================================================================
 */

class DisasterRecoveryService extends EventEmitter {
  constructor({
    db,
    cache,
    logger,
    queueService,
    auditService,
    notificationService,
    metricsService,
    objectStorageService,
    encryptionService,
    failoverService,
    config = {},
  } = {}) {
    super();

    if (!db) {
      throw new DisasterRecoveryError(
        'DisasterRecoveryService requires a database dependency.',
        'DR_DB_REQUIRED'
      );
    }

    this.db = db;

    this.cache = cache;

    this.logger = logger;

    this.queueService =
      queueService;

    this.auditService =
      auditService;

    this.notificationService =
      notificationService;

    this.metricsService =
      metricsService;

    this.objectStorageService =
      objectStorageService;

    this.encryptionService =
      encryptionService;

    /*
     * Optional infrastructure failover adapter.
     */
    this.failoverService =
      failoverService;

    this.config = {
      ...DEFAULTS,
      ...config,

      collections:
        config.collections ||
        DEFAULT_COLLECTIONS,
    };
  }

  /**
   * ==========================================================================
   * Create Backup
   * ==========================================================================
   */

  async createBackup({
    tenantId = null,
    type = BACKUP_TYPES.FULL,
    createdBy = 'system',
    metadata = {},
    correlationId = null,
  } = {}) {
    const startedAt =
      Date.now();

    const backupId =
      crypto.randomUUID();

    const effectiveCorrelationId =
      correlationId ||
      this._createCorrelationId();

    this._validateBackupType(
      type
    );

    /*
     * Tenant isolation:
     *
     * A full platform backup may intentionally use tenantId = null.
     * Tenant-scoped backups must always have a tenantId.
     */
    if (
      this.config
        .requireTenantIsolation &&
      type !== BACKUP_TYPES.FULL &&
      !tenantId
    ) {
      throw new DisasterRecoveryError(
        'Tenant-scoped backup requires tenantId.',
        'DR_TENANT_REQUIRED'
      );
    }

    await fs.mkdir(
      this.config.backupDirectory,
      {
        recursive: true,
      }
    );

    const timestamp =
      new Date();

    const backup = {
      id: backupId,

      tenantId,

      type,

      status:
        BACKUP_STATUS.RUNNING,

      createdBy,

      createdAt:
        timestamp,

      startedAt:
        timestamp,

      correlationId:
        effectiveCorrelationId,

      serviceVersion:
        this.config.serviceVersion,

      metadata: {
        ...metadata,
      },
    };

    await this.db.backups.create(
      backup
    );

    try {
      await this._incrementMetric(
        'dr.backup.started'
      );

      const payload =
        await this.buildBackupPayload(
          tenantId,
          type,
          {
            correlationId:
              effectiveCorrelationId,
          }
        );

      /*
       * Serialize using a stable-enough JSON representation for integrity
       * hashing. The manifest records the resulting SHA-256 hash.
       */
      let content =
        Buffer.from(
          JSON.stringify(
            payload
          ),
          'utf8'
        );

      const originalSize =
        content.length;

      const originalHash =
        this._sha256(
          content
        );

      let compressionMetadata = {
        enabled: false,
        algorithm: null,
      };

      if (
        this.config.compression
      ) {
        content =
          await gzip(
            content
          );

        compressionMetadata = {
          enabled: true,
          algorithm: 'gzip',
        };
      }

      let encryptionMetadata = {
        enabled: false,
        algorithm: null,
      };

      if (
        this.config.encryption &&
        this.encryptionService
      ) {
        content =
          await this.encryptionService.encrypt(
            content
          );

        encryptionMetadata = {
          enabled: true,

          algorithm:
            this.config
              .encryptionAlgorithm ||
            'provider-managed',
        };
      }

      const finalHash =
        this._sha256(
          content
        );

      const fileName =
        `${backupId}.backup`;

      const filePath =
        path.join(
          this.config
            .backupDirectory,
          fileName
        );

      const manifest = {
        backupId,

        tenantId,

        type,

        createdBy,

        createdAt:
          timestamp,

        correlationId:
          effectiveCorrelationId,

        serviceVersion:
          this.config.serviceVersion,

        formatVersion:
          '1.0',

        collections:
          payload.metadata
            .collections,

        recordCount:
          payload.metadata
            .recordCount,

        originalSize,

        compressedSize:
          content.length,

        originalHash,

        contentHash:
          finalHash,

        compression:
          compressionMetadata,

        encryption:
          encryptionMetadata,

        integrityAlgorithm:
          'sha256',

        metadata: {
          ...metadata,
        },
      };

      /*
       * Embed the manifest in the payload before final serialization is not
       * possible without changing the hash chain. Instead, persist it with
       * the backup database record. The content hash protects the artifact.
       */
      const temporaryPath =
        `${filePath}.tmp-${process.pid}-${Date.now()}`;

      if (
        this.config.atomicWrites
      ) {
        await fs.writeFile(
          temporaryPath,
          content
        );

        await fs.rename(
          temporaryPath,
          filePath
        );
      } else {
        await fs.writeFile(
          filePath,
          content
        );
      }

      /*
       * Optional verification immediately after creation.
       */
      let verification = null;

      if (
        this.config
          .verifyAfterCreate
      ) {
        verification =
          await this._verifyBackupArtifact(
            {
              ...backup,
              filePath,
              contentHash:
                finalHash,
              size:
                content.length,
            },
            {
              verifyPayload:
                false,
            }
          );

        if (!verification.valid) {
          throw new DisasterRecoveryError(
            'Generated backup failed integrity verification.',
            'DR_BACKUP_INTEGRITY_FAILURE',
            {
              backupId,
              verification,
            }
          );
        }
      }

      const completedAt =
        new Date();

      const completedBackup = {
        ...backup,

        status:
          BACKUP_STATUS.COMPLETED,

        filePath,

        fileName,

        size:
          content.length,

        originalSize,

        compression:
          compressionMetadata,

        encryption:
          encryptionMetadata,

        contentHash:
          finalHash,

        originalHash,

        integrityAlgorithm:
          'sha256',

        manifest,

        verification,

        completedAt,

        durationMs:
          Date.now() -
          startedAt,

        updatedAt:
          completedAt,
      };

      await this.db.backups.update(
        backupId,
        completedBackup
      );

      /*
       * Optional durable object storage copy.
       *
       * Local storage remains the immediate artifact, while object storage
       * becomes the preferred production durability layer when configured.
       */
      if (
        this.objectStorageService
      ) {
        try {
          const objectKey =
            this._buildObjectKey(
              completedBackup
            );

          const storageResult =
            await this._uploadBackupArtifact(
              objectKey,
              content,
              completedBackup
            );

          completedBackup.objectStorage =
            storageResult;

          await this.db.backups.update(
            backupId,
            completedBackup
          );
        } catch (error) {
          /*
           * Do not silently claim durable off-site backup.
           */
          completedBackup.objectStorageError =
            {
              message:
                error.message,
            };

          await this.db.backups.update(
            backupId,
            completedBackup
          );

          this._logError(
            'Off-site backup upload failed',
            error,
            {
              backupId,
              tenantId,
              correlationId:
                effectiveCorrelationId,
            }
          );

          await this._incrementMetric(
            'dr.backup.object_storage_failed'
          );
        }
      }

      await this.audit(
        tenantId,
        'BACKUP_CREATED',
        {
          backupId,
          type,
          status:
            completedBackup.status,
          size:
            completedBackup.size,
          contentHash:
            completedBackup.contentHash,
          correlationId:
            effectiveCorrelationId,
        },
        {
          critical: true,
        }
      );

      await this._incrementMetric(
        'dr.backup.completed'
      );

      this.emit(
        'backup.completed',
        completedBackup
      );

      return completedBackup;
    } catch (error) {
      const failedAt =
        new Date();

      const failedBackup = {
        ...backup,

        status:
          BACKUP_STATUS.FAILED,

        failedAt,

        durationMs:
          Date.now() -
          startedAt,

        error: {
          code:
            error.code ||
            'DR_BACKUP_FAILED',

          message:
            error.message,
        },

        updatedAt:
          failedAt,
      };

      try {
        await this.db.backups.update(
          backupId,
          failedBackup
        );
      } catch (updateError) {
        this._logError(
          'Failed to persist backup failure state',
          updateError,
          {
            backupId,
            tenantId,
          }
        );
      }

      await this._incrementMetric(
        'dr.backup.failed'
      );

      await this.audit(
        tenantId,
        'BACKUP_FAILED',
        {
          backupId,
          type,
          error: {
            code:
              error.code ||
              'DR_BACKUP_FAILED',
            message:
              error.message,
          },
          correlationId:
            effectiveCorrelationId,
        }
      );

      this._logError(
        'Backup creation failed',
        error,
        {
          backupId,
          tenantId,
          type,
          correlationId:
            effectiveCorrelationId,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Build Backup Payload
   * ==========================================================================
   */

  async buildBackupPayload(
    tenantId,
    type,
    options = {}
  ) {
    if (
      this.config
        .requireTenantIsolation &&
      type !== BACKUP_TYPES.FULL &&
      !tenantId
    ) {
      throw new DisasterRecoveryError(
        'Tenant-scoped backup requires tenantId.',
        'DR_TENANT_REQUIRED'
      );
    }

    const payload = {
      metadata: {
        tenantId,

        type,

        timestamp:
          new Date(),

        correlationId:
          options.correlationId ||
          this._createCorrelationId(),

        serviceVersion:
          this.config.serviceVersion,

        formatVersion:
          '1.0',

        collections: [],

        recordCount: 0,
      },

      collections: {},
    };

    for (
      const name of this.config.collections
    ) {
      if (!this.db[name]) {
        continue;
      }

      if (
        typeof this.db[name].find !==
        'function'
      ) {
        continue;
      }

      /*
       * CRITICAL:
       *
       * Tenant-scoped backup always queries by tenantId.
       * A tenant backup must never accidentally include another tenant's
       * records.
       */
      const query =
        tenantId
          ? {
              tenantId,
            }
          : {};

      const records =
        await this.db[name].find(
          query
        );

      const safeRecords =
        Array.isArray(records)
          ? records
          : [];

      payload.collections[
        name
      ] = safeRecords;

      payload.metadata
        .collections.push(
          name
        );

      payload.metadata
        .recordCount +=
        safeRecords.length;
    }

    return payload;
  }

  /**
   * ==========================================================================
   * Restore Backup
   * ==========================================================================
   */

  async restoreBackup(
    backupId,
    options = {}
  ) {
    const startedAt =
      Date.now();

    if (!backupId) {
      throw new DisasterRecoveryError(
        'Backup ID is required.',
        'DR_BACKUP_ID_REQUIRED'
      );
    }

    const backup =
      await this.db.backups.findById(
        backupId
      );

    if (!backup) {
      throw new DisasterRecoveryError(
        'Backup not found.',
        'DR_BACKUP_NOT_FOUND',
        {
          backupId,
        }
      );
    }

    /*
     * Tenant access enforcement.
     */
    this._assertBackupTenantAccess(
      backup,
      options.tenantId
    );

    /*
     * Destructive restoration must be explicit.
     */
    if (
      options.clearExisting &&
      !this.config
        .allowDestructiveRestore &&
      !options.allowDestructiveRestore
    ) {
      throw new DisasterRecoveryError(
        'Destructive restore is disabled. Explicitly enable destructive restore.',
        'DR_DESTRUCTIVE_RESTORE_DISABLED'
      );
    }

    if (
      backup.status ===
      BACKUP_STATUS.FAILED
    ) {
      throw new DisasterRecoveryError(
        'Failed backups cannot be restored.',
        'DR_BACKUP_FAILED'
      );
    }

    if (
      backup.status ===
      BACKUP_STATUS.CORRUPTED
    ) {
      throw new DisasterRecoveryError(
        'Corrupted backups cannot be restored.',
        'DR_BACKUP_CORRUPTED'
      );
    }

    const correlationId =
      options.correlationId ||
      this._createCorrelationId();

    const restoringAt =
      new Date();

    try {
      await this.db.backups.update(
        backupId,
        {
          ...backup,
          status:
            BACKUP_STATUS.RESTORING,
          restoreStartedAt:
            restoringAt,
          restoreCorrelationId:
            correlationId,
        }
      );

      await this._incrementMetric(
        'dr.restore.started'
      );

      /*
       * Fetch artifact either from local storage or configured object storage.
       */
      let content =
        await this._readBackupArtifact(
          backup
        );

      /*
       * Verify raw artifact before decrypting/decompressing.
       */
      if (
        this.config
          .requireIntegrityVerification &&
        backup.contentHash
      ) {
        const actualHash =
          this._sha256(
            content
          );

        if (
          actualHash !==
          backup.contentHash
        ) {
          await this._markBackupCorrupted(
            backup,
            {
              expected:
                backup.contentHash,
              actual:
                actualHash,
            }
          );

          throw new DisasterRecoveryError(
            'Backup integrity verification failed.',
            'DR_BACKUP_INTEGRITY_FAILURE',
            {
              backupId,
            }
          );
        }
      }

      /*
       * Decrypt first because encryption occurs after compression during
       * backup creation.
       */
      if (
        backup.encryption?.enabled ||
        (
          this.config.encryption &&
          this.encryptionService
        )
      ) {
        if (
          !this.encryptionService
        ) {
          throw new DisasterRecoveryError(
            'Backup is encrypted but encryption service is unavailable.',
            'DR_ENCRYPTION_SERVICE_UNAVAILABLE'
          );
        }

        content =
          await this.encryptionService.decrypt(
            content
          );
      }

      /*
       * Decompress after decryption.
       */
      if (
        backup.compression?.enabled ||
        this.config.compression
      ) {
        content =
          await gunzip(
            content
          );
      }

      const payload =
        JSON.parse(
          content.toString(
            'utf8'
          )
        );

      this._validateBackupPayload(
        payload,
        backup
      );

      const restoreResult =
        await this._restoreCollections(
          payload,
          {
            ...options,
            tenantId:
              options.tenantId ||
              backup.tenantId,

            correlationId,
          }
        );

      const completedAt =
        new Date();

      const result = {
        success: true,

        backupId,

        tenantId:
          backup.tenantId,

        restoredCollections:
          restoreResult.restoredCollections,

        restoredRecords:
          restoreResult.restoredRecords,

        skippedCollections:
          restoreResult.skippedCollections,

        completedAt,

        durationMs:
          Date.now() -
          startedAt,

        correlationId,
      };

      await this.db.backups.update(
        backupId,
        {
          ...backup,
          status:
            BACKUP_STATUS.RESTORED,
          restoredAt:
            completedAt,
          restoreResult:
            result,
          restoreCorrelationId:
            correlationId,
          updatedAt:
            completedAt,
        }
      );

      await this.audit(
        backup.tenantId,
        'BACKUP_RESTORED',
        {
          backupId,

          clearExisting:
            Boolean(
              options.clearExisting
            ),

          restoredRecords:
            result.restoredRecords,

          correlationId,
        },
        {
          critical: true,
        }
      );

      await this._incrementMetric(
        'dr.restore.completed'
      );

      this.emit(
        'backup.restored',
        {
          backup,
          result,
        }
      );

      return result;
    } catch (error) {
      await this._incrementMetric(
        'dr.restore.failed'
      );

      try {
        await this.db.backups.update(
          backupId,
          {
            ...backup,
            status:
              BACKUP_STATUS.FAILED,
            restoreFailedAt:
              new Date(),
            restoreError: {
              code:
                error.code ||
                'DR_RESTORE_FAILED',

              message:
                error.message,
            },
            updatedAt:
              new Date(),
          }
        );
      } catch (updateError) {
        this._logError(
          'Failed to persist restore failure state',
          updateError,
          {
            backupId,
          }
        );
      }

      this._logError(
        'Backup restore failed',
        error,
        {
          backupId,
          tenantId:
            backup.tenantId,
          correlationId,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Restore Collections
   * ==========================================================================
   */

  async _restoreCollections(
    payload,
    options = {}
  ) {
    const tenantId =
      options.tenantId ||
      payload.metadata.tenantId ||
      null;

    const restoredCollections = [];

    const skippedCollections = [];

    let restoredRecords = 0;

    const maxRecords =
      Number(
        options.maxRestoreRecords ||
          this.config.maxRestoreRecords
      );

    /*
     * Destructive restore:
     *
     * NEVER use deleteMany({}) for a tenant-scoped restore.
     */
    if (
      options.clearExisting
    ) {
      if (!tenantId) {
        throw new DisasterRecoveryError(
          'Destructive restore requires tenant isolation.',
          'DR_DESTRUCTIVE_RESTORE_TENANT_REQUIRED'
        );
      }

      for (
        const collectionName of Object.keys(
          payload.collections
        )
      ) {
        const collection =
          this.db[
            collectionName
          ];

        if (
          !collection ||
          typeof collection.deleteMany !==
            'function'
        ) {
          continue;
        }

        await collection.deleteMany(
          {
            tenantId,
          }
        );
      }
    }

    for (
      const [
        collectionName,
        records,
      ] of Object.entries(
        payload.collections
      )
    ) {
      const collection =
        this.db[
          collectionName
        ];

      if (
        !collection
      ) {
        skippedCollections.push(
          collectionName
        );

        continue;
      }

      if (
        !Array.isArray(records)
      ) {
        throw new DisasterRecoveryError(
          `Invalid records for collection "${collectionName}".`,
          'DR_INVALID_BACKUP_COLLECTION'
        );
      }

      if (
        restoredRecords +
          records.length >
        maxRecords
      ) {
        throw new DisasterRecoveryError(
          'Restore exceeds maximum record limit.',
          'DR_RESTORE_RECORD_LIMIT_EXCEEDED',
          {
            maxRecords,
            collection:
              collectionName,
          }
        );
      }

      for (
        const record of records
      ) {
        /*
         * Tenant safety:
         *
         * For tenant-scoped restores, reject records belonging to another
         * tenant rather than silently changing them.
         */
        if (
          tenantId &&
          record.tenantId &&
          String(
            record.tenantId
          ) !==
            String(tenantId)
        ) {
          throw new DisasterRecoveryError(
            `Tenant isolation violation detected in collection "${collectionName}".`,
            'DR_TENANT_DATA_MISMATCH',
            {
              collection:
                collectionName,
            }
          );
        }

        /*
         * If the backup is tenant-scoped, records must carry the expected
         * tenantId where the domain model supports tenant isolation.
         */
        if (
          tenantId &&
          collectionName !==
            'system'
        ) {
          record.tenantId =
            record.tenantId ||
            tenantId;
        }

        if (
          typeof collection.upsert !==
          'function'
        ) {
          throw new DisasterRecoveryError(
            `Collection "${collectionName}" does not support upsert.`,
            'DR_COLLECTION_UPSERT_UNAVAILABLE'
          );
        }

        await collection.upsert(
          record
        );

        restoredRecords += 1;
      }

      restoredCollections.push(
        collectionName
      );
    }

    return {
      restoredCollections,

      skippedCollections,

      restoredRecords,
    };
  }

  /**
   * ==========================================================================
   * Point In Time Recovery
   * ==========================================================================
   *
   * IMPORTANT:
   * A backup selected at or before a timestamp is NOT itself a complete PITR
   * implementation. True PITR requires database WAL/oplog/event-log replay.
   *
   * This method therefore:
   *   1. selects the correct base backup
   *   2. restores that base backup
   *   3. optionally invokes an injected point-in-time replay adapter
   *
   * Without a replay adapter, the result explicitly reports that the recovery
   * point is the backup timestamp rather than pretending exact PITR occurred.
   */

  async restoreToPointInTime(
    timestamp,
    options = {}
  ) {
    const target =
      this._normalizeTimestamp(
        timestamp
      );

    if (!target) {
      throw new DisasterRecoveryError(
        'A valid point-in-time timestamp is required.',
        'DR_INVALID_RECOVERY_TIMESTAMP'
      );
    }

    const query = {
      status:
        BACKUP_STATUS.COMPLETED,

      completedAt: {
        $lte: target,
      },
    };

    if (
      options.tenantId
    ) {
      query.tenantId =
        options.tenantId;
    }

    const backups =
      await this.db.backups.find(
        query,
        {
          sort: {
            completedAt:
              -1,
          },

          limit:
            this.config
              .pointInTimeSearchLimit,
        }
      );

    const backup =
      Array.isArray(backups)
        ? backups[0]
        : null;

    if (!backup) {
      throw new DisasterRecoveryError(
        'No suitable backup found for requested recovery point.',
        'DR_NO_SUITABLE_BACKUP'
      );
    }

    const restoreResult =
      await this.restoreBackup(
        backup.id ||
          backup._id,
        {
          ...options,

          tenantId:
            options.tenantId ||
            backup.tenantId,
        }
      );

    let replayResult = {
      supported: false,

      exactPointInTime:
        false,

      message:
        'No point-in-time event/WAL replay adapter is configured.',
    };

    /*
     * Optional exact PITR adapter.
     */
    if (
      this.config
        .pointInTimeRecoveryService &&
      typeof this.config
        .pointInTimeRecoveryService
        .replayTo ===
        'function'
    ) {
      replayResult =
        await this.config
          .pointInTimeRecoveryService
          .replayTo(
            target,
            {
              tenantId:
                options.tenantId ||
                backup.tenantId,

              baseBackupId:
                backup.id ||
                backup._id,
            }
          );
    }

    const result = {
      success: true,

      backupId:
        backup.id ||
        backup._id,

      requestedTimestamp:
        target,

      baseBackupTimestamp:
        backup.completedAt,

      exactPointInTime:
        Boolean(
          replayResult
            .exactPointInTime
        ),

      replay:
        replayResult,

      restore:
        restoreResult,

      completedAt:
        new Date(),
    };

    await this.audit(
      backup.tenantId,
      'POINT_IN_TIME_RECOVERY',
      {
        backupId:
          result.backupId,

        requestedTimestamp:
          target,

        exactPointInTime:
          result.exactPointInTime,
      },
      {
        critical: true,
      }
    );

    this.emit(
      'backup.point_in_time_restored',
      result
    );

    return result;
  }

  /**
   * ==========================================================================
   * Backup Verification
   * ==========================================================================
   */

  async verifyBackup(
    backupId,
    options = {}
  ) {
    const backup =
      await this.db.backups.findById(
        backupId
      );

    if (!backup) {
      throw new DisasterRecoveryError(
        'Backup not found.',
        'DR_BACKUP_NOT_FOUND'
      );
    }

    this._assertBackupTenantAccess(
      backup,
      options.tenantId
    );

    try {
      const verification =
        await this._verifyBackupArtifact(
          backup,
          {
            verifyPayload:
              options.verifyPayload !==
              false,
          }
        );

      if (
        verification.valid
      ) {
        await this._incrementMetric(
          'dr.backup.verification_success'
        );

        try {
          await this.db.backups.update(
            backupId,
            {
              ...backup,

              status:
                BACKUP_STATUS.VERIFIED,

              lastVerifiedAt:
                new Date(),

              verification,
            }
          );
        } catch (error) {
          this._logError(
            'Failed to persist backup verification state',
            error,
            {
              backupId,
            }
          );
        }
      } else {
        await this._incrementMetric(
          'dr.backup.verification_failed'
        );
      }

      return {
        backupId,

        valid:
          verification.valid,

        ...verification,
      };
    } catch (error) {
      await this._incrementMetric(
        'dr.backup.verification_failed'
      );

      this._logError(
        'Backup verification failed',
        error,
        {
          backupId,
        }
      );

      return {
        backupId,

        valid: false,

        error: {
          code:
            error.code ||
            'DR_VERIFICATION_FAILED',

          message:
            error.message,
        },
      };
    }
  }

  /**
   * ==========================================================================
   * Verify Backup Artifact
   * ==========================================================================
   */

  async _verifyBackupArtifact(
    backup,
    options = {}
  ) {
    const content =
      await this._readBackupArtifact(
        backup
      );

    if (
      this.config
        .maxBackupBytes > 0 &&
      content.length >
        this.config.maxBackupBytes
    ) {
      return {
        valid: false,

        reason:
          'BACKUP_SIZE_LIMIT_EXCEEDED',

        size:
          content.length,
      };
    }

    if (
      backup.size &&
      Number(backup.size) !==
        content.length
    ) {
      return {
        valid: false,

        reason:
          'SIZE_MISMATCH',

        expected:
          backup.size,

        actual:
          content.length,
      };
    }

    if (
      backup.contentHash
    ) {
      const actualHash =
        this._sha256(
          content
        );

      if (
        actualHash !==
        backup.contentHash
      ) {
        return {
          valid: false,

          reason:
            'HASH_MISMATCH',

          expected:
            backup.contentHash,

          actual:
            actualHash,
        };
      }
    }

    if (
      options.verifyPayload
    ) {
      let payloadBuffer =
        content;

      if (
        backup.encryption?.enabled
      ) {
        if (
          !this.encryptionService
        ) {
          return {
            valid: false,

            reason:
              'ENCRYPTION_SERVICE_UNAVAILABLE',
          };
        }

        payloadBuffer =
          await this.encryptionService.decrypt(
            payloadBuffer
          );
      }

      if (
        backup.compression?.enabled
      ) {
        payloadBuffer =
          await gunzip(
            payloadBuffer
          );
      }

      const payload =
        JSON.parse(
          payloadBuffer.toString(
            'utf8'
          )
        );

      this._validateBackupPayload(
        payload,
        backup
      );
    }

    return {
      valid: true,

      size:
        content.length,

      hash:
        backup.contentHash ||
        this._sha256(
          content
        ),

      verifiedAt:
        new Date(),
    };
  }

  /**
   * ==========================================================================
   * Read Backup Artifact
   * ==========================================================================
   */

  async _readBackupArtifact(
    backup
  ) {
    /*
     * Prefer object storage when explicitly configured and the backup contains
     * an object storage reference.
     */
    if (
      this.objectStorageService &&
      backup.objectStorage
    ) {
      const object =
        await this._downloadBackupArtifact(
          backup.objectStorage
        );

      if (
        Buffer.isBuffer(object)
      ) {
        return object;
      }
    }

    if (
      !backup.filePath
    ) {
      throw new DisasterRecoveryError(
        'Backup artifact location is missing.',
        'DR_BACKUP_ARTIFACT_MISSING'
      );
    }

    /*
     * Prevent path traversal when backup.filePath is relative.
     */
    const resolved =
      path.resolve(
        backup.filePath
      );

    const backupRoot =
      path.resolve(
        this.config
          .backupDirectory
      );

    if (
      !resolved.startsWith(
        `${backupRoot}${path.sep}`
      ) &&
      resolved !== backupRoot
    ) {
      throw new DisasterRecoveryError(
        'Backup file path is outside the configured backup directory.',
        'DR_INVALID_BACKUP_PATH'
      );
    }

    const content =
      await fs.readFile(
        resolved
      );

    if (
      this.config
        .maxBackupBytes > 0 &&
      content.length >
        this.config.maxBackupBytes
    ) {
      throw new DisasterRecoveryError(
        'Backup exceeds configured maximum size.',
        'DR_BACKUP_SIZE_LIMIT_EXCEEDED'
      );
    }

    return content;
  }

  /**
   * ==========================================================================
   * Object Storage Upload
   * ==========================================================================
   */

  async _uploadBackupArtifact(
    objectKey,
    content,
    backup
  ) {
    if (
      !this.objectStorageService
    ) {
      return null;
    }

    if (
      typeof this.objectStorageService.upload ===
      'function'
    ) {
      return this.objectStorageService.upload(
        {
          key:
            objectKey,

          body:
            content,

          contentType:
            'application/octet-stream',

          metadata: {
            backupId:
              backup.id,

            tenantId:
              backup.tenantId ||
              'platform',

            contentHash:
              backup.contentHash,
          },
        }
      );
    }

    if (
      typeof this.objectStorageService.putObject ===
      'function'
    ) {
      return this.objectStorageService.putObject(
        objectKey,
        content,
        {
          metadata: {
            backupId:
              backup.id,

            tenantId:
              backup.tenantId ||
              'platform',

            contentHash:
              backup.contentHash,
          },
        }
      );
    }

    throw new DisasterRecoveryError(
      'Object storage service does not support backup upload.',
      'DR_OBJECT_STORAGE_UPLOAD_UNAVAILABLE'
    );
  }

  /**
   * ==========================================================================
   * Object Storage Download
   * ==========================================================================
   */

  async _downloadBackupArtifact(
    reference
  ) {
    if (
      !this.objectStorageService
    ) {
      return null;
    }

    if (
      typeof this.objectStorageService.download ===
      'function'
    ) {
      return this.objectStorageService.download(
        reference
      );
    }

    if (
      typeof this.objectStorageService.getObject ===
      'function'
    ) {
      return this.objectStorageService.getObject(
        reference
      );
    }

    return null;
  }

  /**
   * ==========================================================================
   * Build Object Storage Key
   * ==========================================================================
   */

  _buildObjectKey(
    backup
  ) {
    const tenantSegment =
      backup.tenantId ||
      'platform';

    const date =
      new Date(
        backup.createdAt
      );

    const year =
      date.getUTCFullYear();

    const month = String(
      date.getUTCMonth() + 1
    ).padStart(
      2,
      '0'
    );

    const day = String(
      date.getUTCDate()
    ).padStart(
      2,
      '0'
    );

    return [
      'backups',
      tenantSegment,
      year,
      month,
      day,
      `${backup.id}.backup`,
    ].join('/');
  }

  /**
   * ==========================================================================
   * Backup Payload Validation
   * ==========================================================================
   */

  _validateBackupPayload(
    payload,
    backup
  ) {
    if (
      !payload ||
      typeof payload !==
        'object'
    ) {
      throw new DisasterRecoveryError(
        'Backup payload is invalid.',
        'DR_INVALID_BACKUP_PAYLOAD'
      );
    }

    if (
      !payload.metadata ||
      typeof payload.metadata !==
        'object'
    ) {
      throw new DisasterRecoveryError(
        'Backup metadata is missing.',
        'DR_BACKUP_METADATA_MISSING'
      );
    }

    if (
      !payload.collections ||
      typeof payload.collections !==
        'object'
    ) {
      throw new DisasterRecoveryError(
        'Backup collections are missing.',
        'DR_BACKUP_COLLECTIONS_MISSING'
      );
    }

    /*
     * Tenant mismatch protection.
     */
    if (
      backup.tenantId &&
      payload.metadata.tenantId &&
      String(
        backup.tenantId
      ) !==
        String(
          payload.metadata.tenantId
        )
    ) {
      throw new DisasterRecoveryError(
        'Backup tenant metadata mismatch.',
        'DR_BACKUP_TENANT_MISMATCH'
      );
    }

    return true;
  }

  /**
   * ==========================================================================
   * Mark Corrupted
   * ==========================================================================
   */

  async _markBackupCorrupted(
    backup,
    details = {}
  ) {
    try {
      await this.db.backups.update(
        backup.id ||
          backup._id,
        {
          ...backup,

          status:
            BACKUP_STATUS.CORRUPTED,

          corruptedAt:
            new Date(),

          corruptionDetails:
            details,

          updatedAt:
            new Date(),
        }
      );
    } catch (error) {
      this._logError(
        'Failed to mark backup corrupted',
        error,
        {
          backupId:
            backup.id ||
            backup._id,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * Failover
   * ==========================================================================
   */

  async initiateFailover(
    region,
    options = {}
  ) {
    if (!region) {
      throw new DisasterRecoveryError(
        'Failover region is required.',
        'DR_FAILOVER_REGION_REQUIRED'
      );
    }

    const correlationId =
      options.correlationId ||
      this._createCorrelationId();

    const event = {
      id:
        crypto.randomUUID(),

      region,

      previousRegion:
        options.previousRegion ||
        null,

      startedAt:
        new Date(),

      status:
        RECOVERY_STATUS.REQUESTED,

      initiatedBy:
        options.initiatedBy ||
        'system',

      correlationId,
    };

    await this.db.failovers.create(
      event
    );

    await this._incrementMetric(
      'dr.failover.requested'
    );

    try {
      await this.db.failovers.update(
        event.id,
        {
          ...event,

          status:
            RECOVERY_STATUS.RUNNING,

          updatedAt:
            new Date(),
        }
      );

      let providerResult = null;

      if (
        this.failoverService &&
        typeof this.failoverService.failover ===
          'function'
      ) {
        providerResult =
          await this.failoverService.failover(
            {
              region,

              previousRegion:
                event.previousRegion,

              correlationId,
            }
          );
      } else if (
        this.config
          .requireFailoverAdapter
      ) {
        throw new DisasterRecoveryError(
          'Failover infrastructure adapter is unavailable.',
          'DR_FAILOVER_ADAPTER_UNAVAILABLE'
        );
      } else {
        /*
         * Explicitly report orchestration-only mode.
         */
        providerResult = {
          executed: false,

          mode:
            'orchestration-only',

          message:
            'No failover infrastructure adapter configured.',
        };
      }

      const completedAt =
        new Date();

      const completedEvent = {
        ...event,

        status:
          RECOVERY_STATUS.COMPLETED,

        completedAt,

        durationMs:
          completedAt.getTime() -
          event.startedAt.getTime(),

        providerResult,

        updatedAt:
          completedAt,
      };

      await this.db.failovers.update(
        event.id,
        completedEvent
      );

      try {
        if (
          this.notificationService &&
          typeof this.notificationService.send ===
            'function'
        ) {
          await this.notificationService.send(
            {
              type:
                'system_failover',

              channel:
                'in_app',

              subject:
                'Disaster Recovery Failover',

              message:
                `Failover orchestration completed for ${region}.`,

              data:
                completedEvent,
            }
          );
        }
      } catch (error) {
        this._logError(
          'Failover notification failed',
          error,
          {
            region,
            correlationId,
          }
        );
      }

      await this.audit(
        null,
        'SYSTEM_FAILOVER_COMPLETED',
        {
          ...completedEvent,
        },
        {
          critical: true,
        }
      );

      await this._incrementMetric(
        'dr.failover.completed'
      );

      this.emit(
        'failover.completed',
        completedEvent
      );

      return completedEvent;
    } catch (error) {
      const failedEvent = {
        ...event,

        status:
          RECOVERY_STATUS.FAILED,

        failedAt:
          new Date(),

        error: {
          code:
            error.code ||
            'DR_FAILOVER_FAILED',

          message:
            error.message,
        },

        updatedAt:
          new Date(),
      };

      try {
        await this.db.failovers.update(
          event.id,
          failedEvent
        );
      } catch (updateError) {
        this._logError(
          'Failed to persist failover failure',
          updateError,
          {
            failoverId:
              event.id,
          }
        );
      }

      await this._incrementMetric(
        'dr.failover.failed'
      );

      this._logError(
        'Disaster recovery failover failed',
        error,
        {
          region,
          correlationId,
        }
      );

      this.emit(
        'failover.failed',
        failedEvent
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Failback
   * ==========================================================================
   */

  async initiateFailback(
    region,
    options = {}
  ) {
    if (!region) {
      throw new DisasterRecoveryError(
        'Failback region is required.',
        'DR_FAILBACK_REGION_REQUIRED'
      );
    }

    const correlationId =
      options.correlationId ||
      this._createCorrelationId();

    const event = {
      id:
        crypto.randomUUID(),

      region,

      startedAt:
        new Date(),

      status:
        RECOVERY_STATUS.REQUESTED,

      initiatedBy:
        options.initiatedBy ||
        'system',

      correlationId,
    };

    await this.db.failbacks.create(
      event
    );

    try {
      await this.db.failbacks.update(
        event.id,
        {
          ...event,

          status:
            RECOVERY_STATUS.RUNNING,

          updatedAt:
            new Date(),
        }
      );

      let providerResult = null;

      if (
        this.failoverService &&
        typeof this.failoverService.failback ===
          'function'
      ) {
        providerResult =
          await this.failoverService.failback(
            {
              region,
              correlationId,
            }
          );
      } else {
        providerResult = {
          executed: false,

          mode:
            'orchestration-only',

          message:
            'No failback infrastructure adapter configured.',
        };
      }

      const completedAt =
        new Date();

      const completedEvent = {
        ...event,

        status:
          RECOVERY_STATUS.COMPLETED,

        completedAt,

        durationMs:
          completedAt.getTime() -
          event.startedAt.getTime(),

        providerResult,

        updatedAt:
          completedAt,
      };

      await this.db.failbacks.update(
        event.id,
        completedEvent
      );

      await this.audit(
        null,
        'SYSTEM_FAILBACK_COMPLETED',
        completedEvent,
        {
          critical: true,
        }
      );

      await this._incrementMetric(
        'dr.failback.completed'
      );

      this.emit(
        'failback.completed',
        completedEvent
      );

      return completedEvent;
    } catch (error) {
      const failedEvent = {
        ...event,

        status:
          RECOVERY_STATUS.FAILED,

        failedAt:
          new Date(),

        error: {
          code:
            error.code ||
            'DR_FAILBACK_FAILED',

          message:
            error.message,
        },

        updatedAt:
          new Date(),
      };

      try {
        await this.db.failbacks.update(
          event.id,
          failedEvent
        );
      } catch (updateError) {
        this._logError(
          'Failed to persist failback failure',
          updateError,
          {
            failbackId:
              event.id,
          }
        );
      }

      await this._incrementMetric(
        'dr.failback.failed'
      );

      this._logError(
        'Disaster recovery failback failed',
        error,
        {
          region,
          correlationId,
        }
      );

      this.emit(
        'failback.failed',
        failedEvent
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Recovery Drill
   * ==========================================================================
   */

  async executeRecoveryDrill(
    options = {}
  ) {
    const startedAt =
      Date.now();

    const correlationId =
      options.correlationId ||
      this._createCorrelationId();

    const query =
      options.tenantId
        ? {
            tenantId:
              options.tenantId,

            status: {
              $in: [
                BACKUP_STATUS.COMPLETED,
                BACKUP_STATUS.VERIFIED,
                BACKUP_STATUS.RESTORED,
              ],
            },
          }
        : {
            status: {
              $in: [
                BACKUP_STATUS.COMPLETED,
                BACKUP_STATUS.VERIFIED,
                BACKUP_STATUS.RESTORED,
              ],
            },
          };

    const latest =
      await this.db.backups.findOne(
        query,
        {
          sort: {
            completedAt:
              -1,
          },
        }
      );

    if (!latest) {
      throw new DisasterRecoveryError(
        'No backups available for recovery drill.',
        'DR_NO_BACKUPS_AVAILABLE'
      );
    }

    const verification =
      await this.verifyBackup(
        latest.id ||
          latest._id,
        {
          tenantId:
            options.tenantId ||
            latest.tenantId,

          verifyPayload:
            options.verifyPayload !==
            false,
        }
      );

    const duration =
      Date.now() -
      startedAt;

    const drill = {
      id:
        crypto.randomUUID(),

      backupId:
        latest.id ||
        latest._id,

      tenantId:
        latest.tenantId,

      success:
        verification.valid,

      verification,

      duration,

      targetRtoMinutes:
        this.config
          .defaultRTOMinutes,

      rtoMet:
        duration <=
        this.config
          .defaultRTOMinutes *
          60 *
          1000,

      correlationId,

      createdAt:
        new Date(),
    };

    await this.db.recoveryDrills.create(
      drill
    );

    await this.audit(
      latest.tenantId,
      'RECOVERY_DRILL_EXECUTED',
      {
        drillId:
          drill.id,

        backupId:
          drill.backupId,

        success:
          drill.success,

        duration,

        rtoMet:
          drill.rtoMet,

        correlationId,
      }
    );

    await this._incrementMetric(
      drill.success
        ? 'dr.recovery_drill.success'
        : 'dr.recovery_drill.failed'
    );

    this.emit(
      'recovery.drill.completed',
      drill
    );

    return drill;
  }

  /**
   * ==========================================================================
   * Snapshot Management
   * ==========================================================================
   */

  async createSnapshot(
    tenantId,
    options = {}
  ) {
    if (!tenantId) {
      throw new DisasterRecoveryError(
        'Snapshot requires tenantId.',
        'DR_TENANT_REQUIRED'
      );
    }

    return this.createBackup({
      tenantId,

      type:
        BACKUP_TYPES.SNAPSHOT,

      createdBy:
        options.createdBy ||
        'system',

      metadata:
        options.metadata ||
        {},

      correlationId:
        options.correlationId ||
        null,
    });
  }

  /**
   * ==========================================================================
   * Scheduled Backup
   * ==========================================================================
   */

  async scheduleBackup(
    payload = {},
    runAt
  ) {
    if (
      !this.queueService ||
      typeof this.queueService.enqueue !==
        'function'
    ) {
      throw new DisasterRecoveryError(
        'Queue service is unavailable.',
        'DR_QUEUE_UNAVAILABLE'
      );
    }

    const scheduledTime =
      this._normalizeTimestamp(
        runAt
      );

    if (!scheduledTime) {
      throw new DisasterRecoveryError(
        'A valid backup schedule time is required.',
        'DR_INVALID_SCHEDULE_TIME'
      );
    }

    const delay =
      Math.max(
        0,
        scheduledTime.getTime() -
          Date.now()
      );

    const tenantId =
      payload.tenantId ||
      'platform';

    const idempotencyKey =
      payload.idempotencyKey ||
      crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            tenantId,
            type:
              payload.type ||
              BACKUP_TYPES.FULL,
            runAt:
              scheduledTime.toISOString(),
          })
        )
        .digest('hex');

    const jobPayload = {
      ...payload,

      requestedAt:
        new Date(),

      idempotencyKey,
    };

    const jobOptions = {
      delay,

      jobId:
        `dr-backup:${idempotencyKey}`,
    };

    await this._incrementMetric(
      'dr.backup.scheduled'
    );

    return this.queueService.enqueue(
      'disaster-recovery-backup',
      jobPayload,
      jobOptions
    );
  }

  /**
   * ==========================================================================
   * Cleanup
   * ==========================================================================
   */

  async cleanupExpiredBackups(
    options = {}
  ) {
    const cutoff =
      new Date(
        Date.now() -
          this.config
            .retentionDays *
          24 *
          60 *
          60 *
          1000
      );

    const query = {
      completedAt: {
        $lt:
          cutoff,
      },

      status: {
        $in: [
          BACKUP_STATUS.COMPLETED,
          BACKUP_STATUS.VERIFIED,
          BACKUP_STATUS.RESTORED,
        ],
      },
    };

    if (
      options.tenantId
    ) {
      query.tenantId =
        options.tenantId;
    }

    const backups =
      await this.db.backups.find(
        query
      );

    if (
      !Array.isArray(backups)
    ) {
      return 0;
    }

    let deleted = 0;

    for (
      const backup of backups
    ) {
      try {
        /*
         * Never delete the latest backup for a tenant.
         */
        if (
          this.config
            .preserveLatestBackup &&
          await this._isLatestBackup(
            backup
          )
        ) {
          continue;
        }

        if (
          backup.filePath
        ) {
          try {
            const resolved =
              path.resolve(
                backup.filePath
              );

            const root =
              path.resolve(
                this.config
                  .backupDirectory
              );

            if (
              resolved.startsWith(
                `${root}${path.sep}`
              )
            ) {
              await fs.unlink(
                resolved
              );
            }
          } catch (error) {
            /*
             * ENOENT means the local file is already gone. Database metadata
             * can still be removed if object storage is authoritative.
             */
            if (
              error.code !==
              'ENOENT'
            ) {
              throw error;
            }
          }
        }

        /*
         * Object-storage cleanup when supported.
         */
        if (
          backup.objectStorage &&
          this.objectStorageService
        ) {
          try {
            await this._deleteObjectStorageBackup(
              backup.objectStorage
            );
          } catch (error) {
            this._logError(
              'Object storage backup cleanup failed',
              error,
              {
                backupId:
                  backup.id ||
                  backup._id,
              }
            );
          }
        }

        await this.db.backups.delete(
          backup.id ||
            backup._id
        );

        deleted += 1;

        await this._incrementMetric(
          'dr.backup.deleted'
        );
      } catch (error) {
        await this._incrementMetric(
          'dr.backup.cleanup_failed'
        );

        this._logError(
          'Backup cleanup failed',
          error,
          {
            backupId:
              backup.id ||
              backup._id,

            tenantId:
              backup.tenantId,
          }
        );
      }
    }

    return deleted;
  }

  /**
   * ==========================================================================
   * Object Storage Delete
   * ==========================================================================
   */

  async _deleteObjectStorageBackup(
    reference
  ) {
    if (
      typeof this.objectStorageService
        .delete ===
      'function'
    ) {
      return this.objectStorageService.delete(
        reference
      );
    }

    if (
      typeof this.objectStorageService
        .deleteObject ===
      'function'
    ) {
      return this.objectStorageService.deleteObject(
        reference
      );
    }

    return null;
  }

  /**
   * ==========================================================================
   * Latest Backup Protection
   * ==========================================================================
   */

  async _isLatestBackup(
    backup
  ) {
    const query =
      backup.tenantId
        ? {
            tenantId:
              backup.tenantId,

            status: {
              $in: [
                BACKUP_STATUS.COMPLETED,
                BACKUP_STATUS.VERIFIED,
                BACKUP_STATUS.RESTORED,
              ],
            },
          }
        : {
            status: {
              $in: [
                BACKUP_STATUS.COMPLETED,
                BACKUP_STATUS.VERIFIED,
                BACKUP_STATUS.RESTORED,
              ],
            },
          };

    const latest =
      await this.db.backups.findOne(
        query,
        {
          sort: {
            completedAt:
              -1,
          },
        }
      );

    if (!latest) {
      return false;
    }

    return String(
      latest.id ||
        latest._id
    ) ===
      String(
        backup.id ||
          backup._id
      );
  }

  /**
   * ==========================================================================
   * Metrics
   * ==========================================================================
   */

  async getMetrics(
    options = {}
  ) {
    const query =
      options.tenantId
        ? {
            tenantId:
              options.tenantId,
          }
        : {};

    const [
      backups,
      completedBackups,
      failedBackups,
      drills,
      failovers,
      failbacks,
    ] = await Promise.all([
      this.db.backups.count(
        query
      ),

      this.db.backups.count({
        ...query,

        status: {
          $in: [
            BACKUP_STATUS.COMPLETED,
            BACKUP_STATUS.VERIFIED,
            BACKUP_STATUS.RESTORED,
          ],
        },
      }),

      this.db.backups.count({
        ...query,

        status:
          BACKUP_STATUS.FAILED,
      }),

      this.db.recoveryDrills.count(
        query
      ),

      this.db.failovers.count(
        query
      ),

      this.db.failbacks?.count
        ? this.db.failbacks.count(
            query
          )
        : 0,
    ]);

    /*
     * Calculate actual backup age where possible.
     */
    let latestBackup = null;

    if (
      typeof this.db.backups.findOne ===
      'function'
    ) {
      latestBackup =
        await this.db.backups.findOne(
          {
            ...query,

            status: {
              $in: [
                BACKUP_STATUS.COMPLETED,
                BACKUP_STATUS.VERIFIED,
                BACKUP_STATUS.RESTORED,
              ],
            },
          },
          {
            sort: {
              completedAt:
                -1,
            },
          }
        );
    }

    const now =
      Date.now();

    const actualRPOMinutes =
      latestBackup?.completedAt
        ? Math.max(
            0,
            (
              now -
              new Date(
                latestBackup.completedAt
              ).getTime()
            ) /
              60_000
          )
        : null;

    return {
      backups,

      completedBackups,

      failedBackups,

      drills,

      failovers,

      failbacks,

      targetRpoMinutes:
        this.config
          .defaultRPOMinutes,

      targetRtoMinutes:
        this.config
          .defaultRTOMinutes,

      actualRpoMinutes,

      rpoMet:
        actualRPOMinutes !== null
          ? actualRPOMinutes <=
            this.config
              .defaultRPOMinutes
          : false,

      latestBackupId:
        latestBackup
          ? latestBackup.id ||
            latestBackup._id
          : null,

      generatedAt:
        new Date(),

      tenantId:
        options.tenantId ||
        null,
    };
  }

  /**
   * ==========================================================================
   * Audit
   * ==========================================================================
   */

  async audit(
    tenantId,
    action,
    payload = {},
    options = {}
  ) {
    if (
      !this.auditService
    ) {
      if (
        options.critical &&
        this.config
          .failClosedOnCriticalAuditError
      ) {
        throw new DisasterRecoveryError(
          'Critical disaster recovery audit service is unavailable.',
          'DR_AUDIT_UNAVAILABLE'
        );
      }

      return;
    }

    const auditPayload = {
      tenantId,

      action,

      payload,

      timestamp:
        new Date(),

      source:
        'DisasterRecoveryService',

      category:
        'DISASTER_RECOVERY',

      correlationId:
        payload.correlationId ||
        this._createCorrelationId(),
    };

    try {
      await this.auditService.log(
        auditPayload
      );

      await this._incrementMetric(
        'dr.audit.success'
      );
    } catch (error) {
      await this._incrementMetric(
        'dr.audit.failed'
      );

      this._logError(
        'Disaster recovery audit failed',
        error,
        {
          tenantId,
          action,
          critical:
            Boolean(
              options.critical
            ),
        }
      );

      if (
        options.critical &&
        this.config
          .failClosedOnCriticalAuditError
      ) {
        throw new DisasterRecoveryError(
          'Critical disaster recovery audit operation failed.',
          'DR_AUDIT_FAILURE',
          {
            action,
            cause:
              error.message,
          }
        );
      }
    }
  }

  /**
   * ==========================================================================
   * Tenant Access
   * ==========================================================================
   */

  _assertBackupTenantAccess(
    backup,
    requestedTenantId
  ) {
    if (
      !requestedTenantId
    ) {
      return;
    }

    if (
      backup.tenantId &&
      String(
        backup.tenantId
      ) !==
        String(
          requestedTenantId
        )
    ) {
      throw new DisasterRecoveryError(
        'Backup does not belong to the requested tenant.',
        'DR_TENANT_ACCESS_DENIED',
        {
          backupId:
            backup.id ||
            backup._id,

          tenantId:
            requestedTenantId,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * Validation Helpers
   * ==========================================================================
   */

  _validateBackupType(
    type
  ) {
    if (
      !Object.values(
        BACKUP_TYPES
      ).includes(type)
    ) {
      throw new DisasterRecoveryError(
        `Unsupported backup type "${type}".`,
        'DR_INVALID_BACKUP_TYPE'
      );
    }
  }

  _normalizeTimestamp(
    timestamp
  ) {
    if (
      timestamp instanceof Date
    ) {
      return Number.isNaN(
        timestamp.getTime()
      )
        ? null
        : timestamp;
    }

    if (
      timestamp === null ||
      timestamp === undefined
    ) {
      return null;
    }

    const date =
      new Date(
        timestamp
      );

    return Number.isNaN(
      date.getTime()
    )
      ? null
      : date;
  }

  /**
   * ==========================================================================
   * Cryptographic Integrity
   * ==========================================================================
   */

  _sha256(
    content
  ) {
    return crypto
      .createHash('sha256')
      .update(content)
      .digest('hex');
  }

  /**
   * ==========================================================================
   * Correlation IDs
   * ==========================================================================
   */

  _createCorrelationId() {
    return crypto.randomUUID();
  }

  /**
   * ==========================================================================
   * Metrics Adapter
   * ==========================================================================
   */

  async _incrementMetric(
    name,
    value = 1,
    labels = {}
  ) {
    if (
      !this.metricsService
    ) {
      return;
    }

    try {
      if (
        typeof this.metricsService
          .increment ===
        'function'
      ) {
        await this.metricsService.increment(
          name,
          value,
          labels
        );

        return;
      }

      if (
        typeof this.metricsService
          .inc ===
        'function'
      ) {
        await this.metricsService.inc(
          name,
          value,
          labels
        );

        return;
      }

      if (
        typeof this.metricsService
          .counter ===
        'function'
      ) {
        await this.metricsService.counter(
          name,
          value,
          labels
        );
      }
    } catch (error) {
      /*
       * Metrics must never become a DR failure source.
       */
      this._logError(
        'Disaster recovery metrics operation failed',
        error,
        {
          metric:
            name,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * Logging Adapter
   * ==========================================================================
   */

  _logError(
    message,
    error,
    context = {}
  ) {
    if (
      !this.logger
    ) {
      return;
    }

    try {
      const payload = {
        ...context,

        error: {
          name:
            error?.name,

          code:
            error?.code,

          message:
            error?.message,

          stack:
            error?.stack,
        },
      };

      if (
        typeof this.logger.error ===
        'function'
      ) {
        this.logger.error(
          message,
          payload
        );
      }
    } catch {
      /*
       * Logging must never break disaster recovery.
       */
    }
  }
}

/**
 * ============================================================================
 * Static Exports
 * ============================================================================
 */

DisasterRecoveryService
  .DisasterRecoveryError =
  DisasterRecoveryError;

DisasterRecoveryService
  .BACKUP_STATUS =
  BACKUP_STATUS;

DisasterRecoveryService
  .BACKUP_TYPES =
  BACKUP_TYPES;

DisasterRecoveryService
  .RECOVERY_STATUS =
  RECOVERY_STATUS;

module.exports =
  DisasterRecoveryService;