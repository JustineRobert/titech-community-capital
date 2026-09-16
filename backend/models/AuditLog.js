/**
 * ============================================================================
 * backend/models/AuditLog.js
 * TITech Community Capital LTD
 * Enterprise Audit Log Aggregate
 * ============================================================================
 *
 * Architectural role
 * ----------------------------------------------------------------------------
 * AuditLog is the immutable audit-record aggregate for security-sensitive
 * and business-significant platform events, including:
 *
 *   - authentication and authorization events
 *   - tenant administration
 *   - user and membership changes
 *   - financial operation events
 *   - payment and transaction lifecycle events
 *   - KYC / AML workflow events
 *   - loan and savings lifecycle events
 *   - moderation and support actions
 *   - configuration and privileged administrative actions
 *   - security and operational events
 *
 * Each record captures the actor, tenant context, affected entity and
 * immutable event metadata.
 *
 * A SHA-256 integrity hash is calculated for each record and linked to the
 * previous record within its tenant/system scope through prevHash.
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * AuditLog IS:
 *   - an append-oriented audit record;
 *   - a security and compliance evidence store;
 *   - tenant-scoped when tenantId is present;
 *   - integrity-linked through prevHash/currentHash;
 *   - suitable for operational audit and investigative workflows.
 *
 * AuditLog is NOT:
 *   - a financial ledger;
 *   - the source of truth for balances;
 *   - an authorization mechanism;
 *   - an authentication/session store;
 *   - a notification queue;
 *   - a replacement for application logs;
 *   - a replacement for infrastructure/security monitoring;
 *   - a guarantee of cryptographic non-repudiation;
 *   - a substitute for WORM/immutable external compliance storage.
 *
 * Security principles
 * ----------------------------------------------------------------------------
 *   - Audit records are append-only through the application model boundary.
 *   - Existing audit records cannot be modified through ordinary update APIs.
 *   - Hard deletion is blocked at the model layer.
 *   - Identity and integrity fields are immutable.
 *   - Tenant context is explicit where the event is tenant-scoped.
 *   - Sensitive request/network fields must not be written to metadata unless
 *     the audit policy explicitly permits them.
 *   - Metadata is bounded and strictly validated at the top level.
 *   - Audit events use controlled creation paths.
 *   - Integrity hashes are generated server-side.
 *   - Hash material is deterministically serialized.
 *   - Optimistic concurrency is enabled.
 *   - Query operations should be tenant-scoped by service/repository policy.
 *
 * Integrity model
 * ----------------------------------------------------------------------------
 *   record N:
 *
 *     prevHash   = hash(record N - 1)
 *     currentHash = SHA256(canonical(record N))
 *
 * The hash chain is tamper-evident but ordering of concurrent writers must
 * still be coordinated by the AuditLog service/repository when strict
 * single-chain guarantees are required.
 *
 * Module format
 * ----------------------------------------------------------------------------
 * Native ESM.
 *
 * ============================================================================
 */

'use strict';

import crypto from 'node:crypto';
import mongoose from 'mongoose';

const { Schema } = mongoose;

/*
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

export const AUDIT_HASH_ALGORITHM = 'sha256';

export const MAX_ACTION_LENGTH = 128;
export const MAX_ENTITY_TYPE_LENGTH = 128;
export const MAX_METADATA_KEYS = 50;
export const MAX_METADATA_STRING_LENGTH = 4096;
export const MAX_CORRELATION_ID_LENGTH = 128;
export const MAX_REQUEST_ID_LENGTH = 128;

export const AUDIT_SCOPES = Object.freeze([
  'TENANT',
  'SYSTEM',
]);

export const AUDIT_OUTCOMES = Object.freeze([
  'SUCCESS',
  'FAILURE',
  'DENIED',
  'REJECTED',
  'PENDING',
]);

/*
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

/**
 * Normalize scalar identifiers for deterministic hashing.
 */
function normalizeIdentifier(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return String(value);
}

/**
 * Normalize metadata recursively into a deterministic JSON-safe structure.
 *
 * Object keys are sorted so equivalent metadata produces the same canonical
 * representation.
 */
function canonicalize(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    value instanceof mongoose.Types.ObjectId
  ) {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('base64');
  }

  if (Array.isArray(value)) {
    return value.map(
      (item) => canonicalize(item)
    );
  }

  if (
    typeof value === 'object'
  ) {
    return Object.keys(value)
      .sort()
      .reduce(
        (result, key) => {
          result[key] =
            canonicalize(value[key]);

          return result;
        },
        {}
      );
  }

  if (
    typeof value === 'number' &&
    !Number.isFinite(value)
  ) {
    return String(value);
  }

  return value;
}

/**
 * Serialize the integrity-bearing portion of a record.
 *
 * currentHash itself is intentionally excluded because it is the output of
 * this canonical payload.
 */
function buildHashPayload(doc) {
  return JSON.stringify(
    canonicalize({
      _id: doc._id,
      action: doc.action,
      userId: doc.userId,
      tenantId: doc.tenantId,
      scope: doc.scope,
      entityType: doc.entityType,
      entityId: doc.entityId,
      outcome: doc.outcome,
      metadata: doc.metadata,
      requestId: doc.requestId,
      correlationId: doc.correlationId,
      prevHash: doc.prevHash,
      createdAt: doc.createdAt,
    })
  );
}

/**
 * Generate the current record hash.
 */
function calculateHash(doc) {
  return crypto
    .createHash(AUDIT_HASH_ALGORITHM)
    .update(
      buildHashPayload(doc),
      'utf8'
    )
    .digest('hex');
}

function assertObjectId(
  value,
  fieldName
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    throw new TypeError(
      `${fieldName} is required`
    );
  }

  if (
    !mongoose.isObjectIdOrHexString(
      value
    )
  ) {
    throw new mongoose.Error.CastError(
      'ObjectId',
      value,
      fieldName
    );
  }
}

function validateMetadataObject(
  metadata
) {
  if (
    metadata === null ||
    metadata === undefined
  ) {
    return;
  }

  if (
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    metadata instanceof Date
  ) {
    throw new TypeError(
      'Audit metadata must be a plain object'
    );
  }

  const keys =
    Object.keys(metadata);

  if (
    keys.length >
    MAX_METADATA_KEYS
  ) {
    throw new RangeError(
      `Audit metadata cannot contain more than ` +
        `${MAX_METADATA_KEYS} keys`
    );
  }
}

/*
 * ============================================================================
 * AUDIT METADATA
 * ============================================================================
 */

const AuditMetadataSchema =
  new Schema(
    {},
    {
      _id: false,
      id: false,
      strict: false,
      minimize: true,
    }
  );

/*
 * ============================================================================
 * AUDIT LOG SCHEMA
 * ============================================================================
 */

const AuditLogSchema =
  new Schema(
    {
      /*
       * Human/system-readable audit action.
       *
       * Examples:
       *
       *   USER_LOGIN
       *   USER_LOGIN_FAILED
       *   LOAN_APPROVED
       *   PAYMENT_INITIATED
       *   PAYMENT_COMPLETED
       *   MEMBER_REMOVED
       */
      action: {
        type: String,
        required: [
          true,
          'Audit action is required',
        ],
        trim: true,
        uppercase: true,
        maxlength:
          MAX_ACTION_LENGTH,
        immutable: true,
      },

      /*
       * Actor who caused the event.
       *
       * Null is valid for system-generated/background events.
       */
      userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        immutable: true,
        index: true,
      },

      /*
       * Tenant context.
       *
       * Null is allowed for genuinely system-wide events.
       */
      tenantId: {
        type: Schema.Types.ObjectId,
        ref: 'Tenant',
        default: null,
        immutable: true,
        index: true,
      },

      /*
       * Distinguishes tenant-chain events from system-chain events.
       */
      scope: {
        type: String,
        enum: AUDIT_SCOPES,
        default: 'TENANT',
        required: true,
        uppercase: true,
        immutable: true,
        index: true,
      },

      /*
       * Entity category affected by the event.
       */
      entityType: {
        type: String,
        required: [
          true,
          'Audit entityType is required',
        ],
        trim: true,
        maxlength:
          MAX_ENTITY_TYPE_LENGTH,
        immutable: true,
        index: true,
      },

      /*
       * Specific entity affected, when applicable.
       */
      entityId: {
        type: Schema.Types.ObjectId,
        default: null,
        immutable: true,
        index: true,
      },

      /*
       * Business/security result of the event.
       */
      outcome: {
        type: String,
        enum: AUDIT_OUTCOMES,
        default: 'SUCCESS',
        required: true,
        uppercase: true,
        immutable: true,
        index: true,
      },

      /*
       * Bounded event context.
       *
       * Never use this as a ledger or application-state store.
       */
      metadata: {
        type: AuditMetadataSchema,
        default: undefined,
        immutable: true,
      },

      /*
       * Request-level correlation values are first-class fields rather than
       * being buried inside unrestricted metadata.
       */
      requestId: {
        type: String,
        trim: true,
        maxlength:
          MAX_REQUEST_ID_LENGTH,
        default: null,
        immutable: true,
        index: true,
      },

      correlationId: {
        type: String,
        trim: true,
        maxlength:
          MAX_CORRELATION_ID_LENGTH,
        default: null,
        immutable: true,
        index: true,
      },

      /*
       * Previous hash in the chain.
       */
      prevHash: {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 64,
        default: null,
        immutable: true,
      },

      /*
       * Current hash of the canonical audit payload.
       */
      currentHash: {
        type: String,
        required: [
          true,
          'Audit currentHash is required',
        ],
        trim: true,
        lowercase: true,
        minlength: 64,
        maxlength: 64,
        immutable: true,
      },

      /*
       * Hash algorithm is persisted for explicit verification.
       */
      hashAlgorithm: {
        type: String,
        enum: [AUDIT_HASH_ALGORITHM],
        default:
          AUDIT_HASH_ALGORITHM,
        required: true,
        immutable: true,
      },
    },
    {
      timestamps: true,

      /*
       * Audit records should never be silently overwritten.
       */
      optimisticConcurrency: true,

      strict: true,

      minimize: true,

      toJSON: {
        virtuals: true,

        transform(
          _doc,
          ret
        ) {
          if (ret._id) {
            ret.id =
              String(ret._id);
          }

          delete ret._id;
          delete ret.__v;

          return ret;
        },
      },

      toObject: {
        virtuals: true,

        transform(
          _doc,
          ret
        ) {
          if (ret._id) {
            ret.id =
              String(ret._id);
          }

          delete ret._id;
          delete ret.__v;

          return ret;
        },
      },
    }
  );

/*
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

AuditLogSchema.index({
  tenantId: 1,
  createdAt: -1,
  _id: -1,
});

AuditLogSchema.index({
  tenantId: 1,
  entityType: 1,
  entityId: 1,
  createdAt: -1,
});

AuditLogSchema.index({
  tenantId: 1,
  userId: 1,
  createdAt: -1,
});

AuditLogSchema.index({
  tenantId: 1,
  action: 1,
  createdAt: -1,
});

AuditLogSchema.index({
  tenantId: 1,
  correlationId: 1,
  createdAt: -1,
});

AuditLogSchema.index({
  tenantId: 1,
  requestId: 1,
  createdAt: -1,
});

AuditLogSchema.index({
  scope: 1,
  createdAt: -1,
  _id: -1,
});

/*
 * Hash lookup for integrity verification.
 */
AuditLogSchema.index({
  currentHash: 1,
});

/*
 * ============================================================================
 * VALIDATION
 * ============================================================================
 */

AuditLogSchema.pre(
  'validate',
  function validateAuditLog() {
    /*
     * System events do not require a tenant.
     */
    if (
      this.scope === 'TENANT' &&
      !this.tenantId
    ) {
      this.invalidate(
        'tenantId',
        'Tenant-scoped audit records require tenantId'
      );
    }

    /*
     * System events should not accidentally pretend to belong to a tenant.
     */
    if (
      this.scope === 'SYSTEM' &&
      this.tenantId
    ) {
      this.invalidate(
        'tenantId',
        'System audit records must not specify tenantId'
      );
    }

    /*
     * An event without an actor is valid when generated by a system process.
     */
    if (
      this.entityType
    ) {
      this.entityType =
        String(
          this.entityType
        )
          .trim()
          .toUpperCase();
    }

    if (
      this.action
    ) {
      this.action =
        String(
          this.action
        )
          .trim()
          .toUpperCase();
    }

    validateMetadataObject(
      this.metadata
    );

    /*
     * Metadata string values are bounded recursively at write time.
     */
    const validateMetadataStrings =
      (value) => {
        if (
          value === null ||
          value === undefined
        ) {
          return;
        }

        if (
          typeof value ===
          'string'
        ) {
          if (
            value.length >
            MAX_METADATA_STRING_LENGTH
          ) {
            throw new RangeError(
              `Audit metadata string cannot exceed ` +
                `${MAX_METADATA_STRING_LENGTH} characters`
            );
          }

          return;
        }

        if (
          Array.isArray(value)
        ) {
          for (
            const item of value
          ) {
            validateMetadataStrings(
              item
            );
          }

          return;
        }

        if (
          typeof value ===
          'object'
        ) {
          for (
            const child of Object.values(
              value
            )
          ) {
            validateMetadataStrings(
              child
            );
          }
        }
      };

    validateMetadataStrings(
      this.metadata
    );
  }
);

/*
 * ============================================================================
 * HASH GENERATION
 * ============================================================================
 *
 * Mongoose executes validation before save hooks. We therefore calculate the
 * audit hash in pre-save only after the final validated fields/timestamps are
 * available.
 *
 * Mongoose 9 supports promise/async pre middleware rather than the legacy
 * callback-style next() signature.
 */

AuditLogSchema.pre(
  'save',
  async function prepareAuditIntegrity() {
    /*
     * Audit records are append-only.
     *
     * Existing records must not be re-hashed through normal save().
     */
    if (!this.isNew) {
      throw new Error(
        'Existing AuditLog records cannot be modified'
      );
    }

    /*
     * createdAt is normally assigned by timestamps before the save operation.
     * Make the fallback explicit for deterministic hashing.
     */
    if (!this.createdAt) {
      this.createdAt =
        new Date();
    }

    /*
     * Determine the previous record within the same chain scope.
     *
     * Tenant-scoped:
     *
     *   scope = TENANT
     *   tenantId = current tenant
     *
     * System-scoped:
     *
     *   scope = SYSTEM
     *   tenantId = null
     */
    const chainFilter =
      this.scope === 'TENANT'
        ? {
            scope: 'TENANT',
            tenantId:
              this.tenantId,
          }
        : {
            scope: 'SYSTEM',
            tenantId: null,
          };

    const AuditLog =
      this.constructor;

    /*
     * Sorting by createdAt + _id gives a deterministic selection among
     * existing records.
     *
     * Strict serialization of concurrent writers remains a service/repository
     * responsibility; see the file header.
     */
    const previous =
      await AuditLog.findOne(
        chainFilter
      )
        .sort({
          createdAt: -1,
          _id: -1,
        })
        .select({
          currentHash: 1,
        })
        .lean()
        .exec();

    this.prevHash =
      previous?.currentHash ??
      null;

    this.hashAlgorithm =
      AUDIT_HASH_ALGORITHM;

    /*
     * Calculate the immutable record hash.
     */
    this.currentHash =
      calculateHash(this);
  }
);

/*
 * ============================================================================
 * MUTATION PROTECTION
 * ============================================================================
 */

/*
 * Audit records are append-only.
 *
 * Ordinary query mutations are blocked even if the caller enables
 * runValidators.
 */
function rejectAuditMutation() {
  throw new Error(
    'AuditLog records are immutable; create a new audit event instead'
  );
}

for (const method of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
]) {
  AuditLogSchema.pre(
    method,
    rejectAuditMutation
  );
}

/*
 * Block both document and query deleteOne paths.
 *
 * Mongoose distinguishes query and document middleware for deleteOne().
 *
 */
AuditLogSchema.pre(
  'deleteOne',
  {
    document: true,
    query: false,
  },
  rejectAuditMutation
);

/*
 * Model-level bulkWrite protection.
 */
AuditLogSchema.pre(
  'bulkWrite',
  function rejectBulkWrite() {
    throw new Error(
      'AuditLog.bulkWrite() is disabled; use the controlled append operation'
    );
  }
);

/*
 * ============================================================================
 * INSTANCE METHODS
 * ============================================================================
 */

/**
 * Return the canonical payload that was hashed.
 *
 * This is useful to an integrity verification service without exposing
 * implementation details elsewhere in the codebase.
 */
AuditLogSchema.methods.getHashPayload =
  function getHashPayload() {
    return buildHashPayload(
      this
    );
  };

/**
 * Verify the stored currentHash against the current document representation.
 */
AuditLogSchema.methods.verifyIntegrity =
  function verifyIntegrity() {
    const expected =
      calculateHash(this);

    return (
      expected ===
      this.currentHash
    );
  };

/*
 * ============================================================================
 * STATIC OPERATIONS
 * ============================================================================
 */

/**
 * Append a tenant-scoped audit record.
 *
 * Authorization belongs to the service layer. This method validates the
 * tenant context and persists one immutable record.
 */
AuditLogSchema.statics.appendTenant =
  async function appendTenant(
    {
      tenantId,
      userId = null,
      action,
      entityType,
      entityId = null,
      outcome = 'SUCCESS',
      metadata = undefined,
      requestId = null,
      correlationId = null,
    },
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    if (userId !== null) {
      assertObjectId(
        userId,
        'userId'
      );
    }

    if (entityId !== null) {
      assertObjectId(
        entityId,
        'entityId'
      );
    }

    const audit = new this({
      action,
      userId,
      tenantId,
      scope: 'TENANT',
      entityType,
      entityId,
      outcome,
      metadata,
      requestId,
      correlationId,
    });

    return audit.save({
      session:
        options.session,
    });
  };

/**
 * Append a system-scoped audit record.
 */
AuditLogSchema.statics.appendSystem =
  async function appendSystem(
    {
      userId = null,
      action,
      entityType,
      entityId = null,
      outcome = 'SUCCESS',
      metadata = undefined,
      requestId = null,
      correlationId = null,
    },
    options = {}
  ) {
    if (userId !== null) {
      assertObjectId(
        userId,
        'userId'
      );
    }

    if (entityId !== null) {
      assertObjectId(
        entityId,
        'entityId'
      );
    }

    const audit = new this({
      action,
      userId,
      tenantId: null,
      scope: 'SYSTEM',
      entityType,
      entityId,
      outcome,
      metadata,
      requestId,
      correlationId,
    });

    return audit.save({
      session:
        options.session,
    });
  };

/**
 * Find an audit record by tenant and ID.
 *
 * The tenant filter is mandatory for tenant-scoped retrieval.
 */
AuditLogSchema.statics.findTenantAudit =
  function findTenantAudit(
    tenantId,
    auditId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      auditId,
      'auditId'
    );

    const query =
      this.findOne({
        _id: auditId,
        tenantId,
        scope: 'TENANT',
      });

    if (options.session) {
      query.session(
        options.session
      );
    }

    return query.exec();
  };

/**
 * Retrieve the audit chain for a tenant.
 */
AuditLogSchema.statics.findTenantChain =
  function findTenantChain(
    tenantId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    const {
      limit = 100,
      before = null,
      session = undefined,
    } = options;

    const safeLimit =
      Math.min(
        Math.max(
          Number(limit) ||
            100,
          1
        ),
        500
      );

    const filter = {
      tenantId,
      scope: 'TENANT',
    };

    if (
      before !== null &&
      before !== undefined
    ) {
      const beforeDate =
        before instanceof Date
          ? before
          : new Date(before);

      if (
        Number.isNaN(
          beforeDate.getTime()
        )
      ) {
        throw new TypeError(
          'before must be a valid date'
        );
      }

      filter.createdAt = {
        $lt: beforeDate,
      };
    }

    const query =
      this.find(filter)
        .sort({
          createdAt: -1,
          _id: -1,
        })
        .limit(safeLimit)
        .lean();

    if (session) {
      query.session(
        session
      );
    }

    return query.exec();
  };

/**
 * Find audit events affecting one entity within a tenant.
 */
AuditLogSchema.statics.findEntityHistory =
  function findEntityHistory(
    tenantId,
    entityType,
    entityId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      entityId,
      'entityId'
    );

    const safeLimit =
      Math.min(
        Math.max(
          Number(
            options.limit
          ) || 100,
          1
        ),
        500
      );

    const query =
      this.find({
        tenantId,
        scope: 'TENANT',
        entityType: String(
          entityType
        )
          .trim()
          .toUpperCase(),
        entityId,
      })
        .sort({
          createdAt: -1,
          _id: -1,
        })
        .limit(safeLimit)
        .lean();

    if (options.session) {
      query.session(
        options.session
      );
    }

    return query.exec();
  };

/**
 * Verify one record's own cryptographic integrity.
 *
 * This does not prove that the record occupies the correct position in the
 * chain. Chain continuity verification is intentionally handled separately.
 */
AuditLogSchema.statics.verifyRecordIntegrity =
  async function verifyRecordIntegrity(
    auditId,
    options = {}
  ) {
    assertObjectId(
      auditId,
      'auditId'
    );

    const query =
      this.findById(
        auditId
      );

    if (options.session) {
      query.session(
        options.session
      );
    }

    const audit =
      await query.exec();

    if (!audit) {
      return {
        exists: false,
        valid: false,
      };
    }

    return {
      exists: true,
      valid:
        audit.verifyIntegrity(),
      currentHash:
        audit.currentHash,
      prevHash:
        audit.prevHash,
      hashAlgorithm:
        audit.hashAlgorithm,
    };
  };

/**
 * Verify continuity between two adjacent audit records.
 */
AuditLogSchema.statics.verifyChainLink =
  async function verifyChainLink(
    previousAuditId,
    currentAuditId,
    options = {}
  ) {
    assertObjectId(
      previousAuditId,
      'previousAuditId'
    );

    assertObjectId(
      currentAuditId,
      'currentAuditId'
    );

    const query =
      this.find({
        _id: {
          $in: [
            previousAuditId,
            currentAuditId,
          ],
        },
      }).select({
        currentHash: 1,
        prevHash: 1,
        tenantId: 1,
        scope: 1,
      });

    if (options.session) {
      query.session(
        options.session
      );
    }

    const records =
      await query.exec();

    const previous =
      records.find(
        (record) =>
          String(
            record._id
          ) ===
          String(
            previousAuditId
          )
      );

    const current =
      records.find(
        (record) =>
          String(
            record._id
          ) ===
          String(
            currentAuditId
          )
      );

    if (!previous || !current) {
      return {
        valid: false,
        reason:
          'One or both audit records were not found',
      };
    }

    return {
      valid:
        previous.currentHash ===
        current.prevHash,
      previousHash:
        previous.currentHash,
      currentPrevHash:
        current.prevHash,
      scope:
        current.scope,
      tenantId:
        current.tenantId,
    };
  };

/*
 * ============================================================================
 * MODEL
 * ============================================================================
 */

const AuditLog =
  mongoose.models.AuditLog ||
  mongoose.model(
    'AuditLog',
    AuditLogSchema
  );

export {
  AuditMetadataSchema,
  AuditLogSchema,
};

export default AuditLog;