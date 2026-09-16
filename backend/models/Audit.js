/**
 * ============================================================================
 * backend/models/Audit.js
 * TITech Community Capital LTD
 * Legacy Audit Compatibility Aggregate
 * ============================================================================
 *
 * Architectural role
 * ----------------------------------------------------------------------------
 * Audit is a legacy compatibility aggregate retained for application flows
 * that historically persisted audit records using the Audit model.
 *
 * The canonical audit aggregate for the current TITech Community Capital
 * architecture is:
 *
 *   backend/models/AuditLog.js
 *
 * New application code SHOULD use AuditLog.appendTenant() or
 * AuditLog.appendSystem() instead of creating new Audit documents.
 *
 * Audit remains available temporarily to support:
 *
 *   - legacy imports
 *   - historical audit records
 *   - controlled migration workflows
 *   - compatibility with older services/tests
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * Audit is NOT:
 *   - the canonical audit source of truth for new events;
 *   - a financial ledger;
 *   - a balance or transaction store;
 *   - an authorization mechanism;
 *   - an authentication/session store;
 *   - a notification queue;
 *   - an application/infrastructure log replacement;
 *   - a compliance WORM store;
 *   - a replacement for AuditLog integrity-chain verification.
 *
 * Security principles
 * ----------------------------------------------------------------------------
 *   - Tenant isolation is mandatory for new records.
 *   - tenantId uses the canonical Tenant ObjectId representation.
 *   - Audit records are append-oriented.
 *   - Existing records cannot be modified through ordinary update APIs.
 *   - Hard deletion is disabled.
 *   - Audit identity fields are immutable.
 *   - Sensitive metadata must be filtered by the service layer before
 *     persistence.
 *   - Arbitrary update pipelines are disabled.
 *   - Bulk mutation is disabled.
 *   - Optimistic concurrency is enabled.
 *   - New audit events SHOULD be written through AuditLog.
 *
 * Compatibility principles
 * ----------------------------------------------------------------------------
 *   - The existing Audit model name is preserved.
 *   - The existing "audits" collection is preserved.
 *   - Legacy field names remain available.
 *   - The legacy hash field is preserved for historical compatibility.
 *   - This model does not attempt to create a second cryptographic chain.
 *
 * Migration principles
 * ----------------------------------------------------------------------------
 *   Audit -> historical/legacy compatibility
 *   AuditLog -> canonical audit implementation
 *
 * A migration service may translate historical Audit records into the
 * canonical AuditLog representation where required. That migration should
 * be explicit and idempotent.
 *
 * Module format
 * ----------------------------------------------------------------------------
 * Native ESM.
 *
 * ============================================================================
 */

'use strict';

import mongoose from 'mongoose';

const { Schema } = mongoose;

/*
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

export const MAX_ACTION_LENGTH = 128;
export const MAX_ROLE_LENGTH = 64;
export const MAX_DATA_KEYS = 50;
export const MAX_STRING_VALUE_LENGTH = 4096;

/*
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function assertObjectId(value, name) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    throw new TypeError(
      `${name} is required`
    );
  }

  if (
    !mongoose.isObjectIdOrHexString(value)
  ) {
    throw new mongoose.Error.CastError(
      'ObjectId',
      value,
      name
    );
  }
}

/**
 * Validate legacy audit data.
 *
 * This is intentionally bounded. Audit.data is historical compatibility
 * storage, not an unrestricted application-state container.
 */
function validateData(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return;
  }

  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value instanceof Date
  ) {
    throw new TypeError(
      'Audit data must be a plain object'
    );
  }

  const keys = Object.keys(value);

  if (
    keys.length >
    MAX_DATA_KEYS
  ) {
    throw new RangeError(
      `Audit data cannot contain more than ${MAX_DATA_KEYS} keys`
    );
  }

  const validateStrings =
    (current) => {
      if (
        current === null ||
        current === undefined
      ) {
        return;
      }

      if (
        typeof current === 'string'
      ) {
        if (
          current.length >
          MAX_STRING_VALUE_LENGTH
        ) {
          throw new RangeError(
            `Audit string values cannot exceed ` +
              `${MAX_STRING_VALUE_LENGTH} characters`
          );
        }

        return;
      }

      if (
        Array.isArray(current)
      ) {
        for (
          const item of current
        ) {
          validateStrings(item);
        }

        return;
      }

      if (
        typeof current === 'object' &&
        !(current instanceof Date)
      ) {
        for (
          const child of Object.values(current)
        ) {
          validateStrings(child);
        }
      }
    };

  validateStrings(value);
}

/*
 * ============================================================================
 * SCHEMA
 * ============================================================================
 */

const AuditSchema = new Schema(
  {
    /*
     * Canonical tenant reference.
     *
     * The legacy model previously stored tenantId as String. New records use
     * ObjectId so the model aligns with the canonical tenancy architecture.
     *
     * Historical strings already present in MongoDB are not automatically
     * rewritten by this model; those should be handled by a migration.
     */
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      immutable: true,
      index: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },

    role: {
      type: String,
      default: 'user',
      trim: true,
      lowercase: true,
      maxlength: MAX_ROLE_LENGTH,
      immutable: true,
    },

    action: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: MAX_ACTION_LENGTH,
      immutable: true,
      index: true,
    },

    /*
     * Legacy event payload.
     */
    data: {
      type: Schema.Types.Mixed,
      default: undefined,
      immutable: true,
      validate: {
        validator(value) {
          try {
            validateData(value);
            return true;
          } catch {
            return false;
          }
        },
        message:
          `Audit data must contain no more than ` +
          `${MAX_DATA_KEYS} top-level keys and bounded string values`,
      },
    },

    /*
     * Legacy timestamp field.
     *
     * Do not confuse this with Mongoose createdAt/updatedAt.
     */
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
      index: true,
    },

    /*
     * Historical integrity value.
     *
     * AuditLog is responsible for the canonical SHA-256 chain.
     */
    hash: {
      type: String,
      required: true,
      trim: true,
      maxlength: 256,
      immutable: true,
      index: true,
    },
  },
  {
    collection: 'audits',

    strict: true,

    timestamps: false,

    optimisticConcurrency: true,

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

AuditSchema.index({
  tenantId: 1,
  timestamp: -1,
  _id: -1,
});

AuditSchema.index({
  tenantId: 1,
  action: 1,
  timestamp: -1,
});

AuditSchema.index({
  tenantId: 1,
  userId: 1,
  timestamp: -1,
});

AuditSchema.index({
  tenantId: 1,
  hash: 1,
});

/*
 * ============================================================================
 * VALIDATION
 * ============================================================================
 */

AuditSchema.pre(
  'validate',
  function validateAudit(next) {
    if (
      this.tenantId
    ) {
      assertObjectId(
        this.tenantId,
        'tenantId'
      );
    }

    if (
      this.userId
    ) {
      assertObjectId(
        this.userId,
        'userId'
      );
    }

    validateData(
      this.data
    );

    next();
  }
);

/*
 * ============================================================================
 * IMMUTABILITY PROTECTION
 * ============================================================================
 *
 * Audit records are historical evidence. They should not be modified after
 * insertion.
 *
 * New records should be created through AuditLog rather than this model.
 * ============================================================================
 */

function rejectMutation(next) {
  next(
    new Error(
      `Audit records are immutable; ${this.op} is disabled`
    )
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
  AuditSchema.pre(
    method,
    rejectMutation
  );
}

AuditSchema.pre(
  'bulkWrite',
  function rejectBulkWrite() {
    throw new Error(
      'Audit.bulkWrite() is disabled; use the controlled AuditLog append path'
    );
  }
);

AuditSchema.pre(
  'deleteOne',
  {
    document: true,
    query: false,
  },
  function rejectDocumentDelete(
    next
  ) {
    next(
      new Error(
        'Audit records are immutable and cannot be hard-deleted'
      )
    );
  }
);

/*
 * ============================================================================
 * QUERY SAFETY
 * ============================================================================
 */

AuditSchema.pre(
  'updateOne',
  function rejectUpdatePipeline(
    next
  ) {
    if (
      Array.isArray(
        this.getUpdate()
      )
    ) {
      return next(
        new Error(
          'Audit update pipelines are disabled'
        )
      );
    }

    return next();
  }
);

AuditSchema.pre(
  'updateMany',
  function rejectUpdateManyPipeline(
    next
  ) {
    if (
      Array.isArray(
        this.getUpdate()
      )
    ) {
      return next(
        new Error(
          'Audit update pipelines are disabled'
        )
      );
    }

    return next();
  }
);

AuditSchema.pre(
  'findOneAndUpdate',
  function rejectFindOneAndUpdatePipeline(
    next
  ) {
    if (
      Array.isArray(
        this.getUpdate()
      )
    ) {
      return next(
        new Error(
          'Audit update pipelines are disabled'
        )
      );
    }

    return next();
  }
);

/*
 * ============================================================================
 * INSTANCE METHODS
 * ============================================================================
 */

/**
 * Verify that the legacy hash field is present.
 *
 * This is intentionally not presented as a full cryptographic verification
 * routine because the original model does not define the canonical hashing
 * payload or algorithm.
 */
AuditSchema.methods.hasIntegrityHash =
  function hasIntegrityHash() {
    return (
      typeof this.hash ===
        'string' &&
      this.hash.length > 0
    );
  };

/*
 * ============================================================================
 * STATIC OPERATIONS
 * ============================================================================
 */

/**
 * Find a legacy audit record inside one tenant.
 */
AuditSchema.statics.findTenantAudit =
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

    const query = this.findOne({
      _id: auditId,
      tenantId,
    });

    if (
      options.session
    ) {
      query.session(
        options.session
      );
    }

    return query.exec();
  };

/**
 * Read tenant-scoped historical audit records.
 */
AuditSchema.statics.findTenantHistory =
  function findTenantHistory(
    tenantId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
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

    const filter = {
      tenantId,
    };

    if (
      options.action
    ) {
      filter.action =
        String(
          options.action
        )
          .trim()
          .toUpperCase();
    }

    if (
      options.userId
    ) {
      assertObjectId(
        options.userId,
        'userId'
      );

      filter.userId =
        options.userId;
    }

    if (
      options.before
    ) {
      const before =
        options.before instanceof Date
          ? options.before
          : new Date(
              options.before
            );

      if (
        Number.isNaN(
          before.getTime()
        )
      ) {
        throw new TypeError(
          'before must be a valid date'
        );
      }

      filter.timestamp = {
        $lt: before,
      };
    }

    const query =
      this.find(filter)
        .sort({
          timestamp: -1,
          _id: -1,
        })
        .limit(safeLimit)
        .lean();

    if (
      options.session
    ) {
      query.session(
        options.session
      );
    }

    return query.exec();
  };

/*
 * ============================================================================
 * MODEL
 * ============================================================================
 */

const Audit =
  mongoose.models.Audit ||
  mongoose.model(
    'Audit',
    AuditSchema
  );

export {
  AuditSchema,
};

export default Audit;