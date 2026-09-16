/**
 * backend/models/Permission.js
 * TITech Community Capital — Permission Definition Model
 *
 * Architectural role:
 * - Defines atomic authorization capabilities used by roles and policies.
 * - Represents the stable resource/action/scope vocabulary consumed by
 *   authorization middleware and services.
 * - Supports platform/system permissions and tenant-defined permissions.
 *
 * Authorization model:
 *
 * User
 *   ↓
 * Role
 *   ↓
 * Permission
 *   ↓
 * Authorization Policy
 *
 * Examples:
 *   users.read
 *   users.create
 *   payments.read
 *   payments.refund
 *   ledger.read
 *   ledger.post
 *   tenant.users.manage
 *
 * Important boundaries:
 * - Permission defines WHAT capability exists; it does not grant the
 *   capability to a user by itself.
 * - Role/RolePermission assignment determines WHO receives the capability.
 * - Authorization middleware/service determines whether the requested
 *   operation is actually permitted in context.
 * - Resource ownership, tenant membership, group membership, and business
 *   constraints remain service/policy responsibilities.
 * - Permission records are configuration metadata, not audit records.
 * - Permission changes must be auditable through AuditLog.
 *
 * Security principles:
 * - Native ESM only.
 * - Stable permission identity.
 * - Explicit tenant/platform scope.
 * - System permissions cannot be tenant-owned.
 * - Tenant permissions must have tenantId.
 * - Generic destructive mutation is restricted.
 * - Deprecation is preferred over deletion.
 * - Authorization identifiers are normalized and constrained.
 * - Platform permissions can be safely resolved independently of tenant data.
 * - Optimistic concurrency is enabled.
 *
 * Module format:
 * - Native ECMAScript Modules (ESM)
 *
 * Collection:
 * - permissions
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

/* ==========================================================================
 * Constants
 * ========================================================================== */

export const PERMISSION_ACTIONS = Object.freeze([
  'create',
  'read',
  'update',
  'delete',
  'list',
  'view',
  'manage',
  'approve',
  'reject',
  'publish',
  'archive',
  'cancel',
  'refund',
  'execute',
  'post',
  'export',
  'import',
  'assign',
  'revoke',
]);

export const PERMISSION_SCOPES = Object.freeze([
  'platform',
  'tenant',
  'group',
  'self',
  'system',
]);

export const PERMISSION_STATUSES = Object.freeze([
  'active',
  'inactive',
  'deprecated',
]);

const MAX_NAME_LENGTH = 200;
const MAX_CODE_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 1_000;
const MAX_DISPLAY_NAME_LENGTH = 256;
const MAX_RESOURCE_LENGTH = 128;
const MAX_ACTION_LENGTH = 64;
const MAX_DEPRECATION_REASON_LENGTH = 1_000;
const MAX_DELETE_REASON_LENGTH = 500;

/* ==========================================================================
 * Helpers
 * ========================================================================== */

function normalizeRequiredString(
  value,
  fieldName,
  maxLength,
) {
  if (
    value === undefined ||
    value === null
  ) {
    throw new TypeError(
      `${fieldName} is required.`,
    );
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    throw new TypeError(
      `${fieldName} is required.`,
    );
  }

  if (
    normalized.length > maxLength
  ) {
    throw new RangeError(
      `${fieldName} exceeds the maximum length of ${maxLength}.`,
    );
  }

  return normalized;
}

function normalizeOptionalString(
  value,
  maxLength,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(
    0,
    maxLength,
  );
}

function normalizePermissionName(
  value,
) {
  const normalized =
    normalizeRequiredString(
      value,
      'name',
      MAX_NAME_LENGTH,
    ).toLowerCase();

  if (
    !/^[a-z0-9][a-z0-9._:-]*$/.test(
      normalized,
    )
  ) {
    throw new TypeError(
      'Permission name contains invalid characters.',
    );
  }

  return normalized;
}

function normalizeResource(value) {
  return normalizeRequiredString(
    value,
    'resource',
    MAX_RESOURCE_LENGTH,
  ).toLowerCase();
}

function normalizeAction(value) {
  const normalized =
    normalizeRequiredString(
      value,
      'action',
      MAX_ACTION_LENGTH,
    ).toLowerCase();

  if (
    !PERMISSION_ACTIONS.includes(
      normalized,
    )
  ) {
    throw new TypeError(
      `Unsupported permission action: ${normalized}.`,
    );
  }

  return normalized;
}

function normalizeScope(value) {
  const normalized =
    normalizeRequiredString(
      value,
      'scope',
      32,
    ).toLowerCase();

  if (
    !PERMISSION_SCOPES.includes(
      normalized,
    )
  ) {
    throw new TypeError(
      `Unsupported permission scope: ${normalized}.`,
    );
  }

  return normalized;
}

function normalizeObjectId(
  value,
  fieldName,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  if (
    !mongoose.isValidObjectId(
      value,
    )
  ) {
    throw new TypeError(
      `${fieldName} must be a valid ObjectId.`,
    );
  }

  return new mongoose.Types.ObjectId(
    value,
  );
}

/* ==========================================================================
 * Schema
 * ========================================================================== */

const PermissionSchema =
  new Schema(
    {
      /*
       * ----------------------------------------------------------------------
       * Stable permission identifier
       * ----------------------------------------------------------------------
       *
       * Examples:
       *   users.read
       *   payments.refund
       *   ledger.post
       */

      name: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        lowercase: true,
        minlength: 3,
        maxlength: MAX_NAME_LENGTH,
      },

      /**
       * Optional machine-readable alias.
       *
       * Kept separate from name so display/registry migrations do not need
       * to change the canonical authorization identifier.
       */
      code: {
        type: String,
        default: null,
        immutable: true,
        trim: true,
        lowercase: true,
        maxlength: MAX_CODE_LENGTH,
      },

      /*
       * ----------------------------------------------------------------------
       * Resource
       * ----------------------------------------------------------------------
       */

      resource: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        lowercase: true,
        maxlength: MAX_RESOURCE_LENGTH,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Action
       * ----------------------------------------------------------------------
       */

      action: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        lowercase: true,
        maxlength: MAX_ACTION_LENGTH,
        enum: PERMISSION_ACTIONS,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Scope
       * ----------------------------------------------------------------------
       */

      scope: {
        type: String,
        required: true,
        immutable: true,
        enum: PERMISSION_SCOPES,
        default: 'tenant',
        lowercase: true,
        trim: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Human-readable information
       * ----------------------------------------------------------------------
       */

      description: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_DESCRIPTION_LENGTH,
      },

      displayName: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_DISPLAY_NAME_LENGTH,
      },

      /*
       * ----------------------------------------------------------------------
       * Lifecycle
       * ----------------------------------------------------------------------
       */

      status: {
        type: String,
        required: true,
        enum: PERMISSION_STATUSES,
        default: 'active',
        trim: true,
        lowercase: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Ownership
       * ----------------------------------------------------------------------
       *
       * systemDefined=true:
       *   platform/system permission; tenantId must be null.
       *
       * systemDefined=false:
       *   tenant-defined custom permission; tenantId is required.
       */

      systemDefined: {
        type: Boolean,
        required: true,
        default: true,
        immutable: true,
        index: true,
      },

      tenantId: {
        type: String,
        default: null,
        trim: true,
        maxlength: 128,
        immutable: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Version
       * ----------------------------------------------------------------------
       *
       * A permission's stable identity does not change when this version
       * changes. Versioning is for policy-definition evolution.
       */

      version: {
        type: Number,
        min: 1,
        default: 1,
      },

      /*
       * ----------------------------------------------------------------------
       * Deprecation
       * ----------------------------------------------------------------------
       */

      deprecatedAt: {
        type: Date,
        default: null,
      },

      deprecationReason: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_DEPRECATION_REASON_LENGTH,
      },

      replacedBy: {
        type: Schema.Types.ObjectId,
        ref: 'Permission',
        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * Administrative provenance
       * ----------------------------------------------------------------------
       */

      createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        immutable: true,
      },

      updatedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * Administrative lifecycle
       * ----------------------------------------------------------------------
       *
       * Prefer inactive/deprecated over deletion.
       */

      isDeleted: {
        type: Boolean,
        required: true,
        default: false,
        index: true,
      },

      deletedAt: {
        type: Date,
        default: null,
      },

      deleteReason: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_DELETE_REASON_LENGTH,
      },
    },
    {
      timestamps: true,

      optimisticConcurrency: true,

      versionKey: '__v',

      collection: 'permissions',

      minimize: true,

      strict: 'throw',

      toJSON: {
        virtuals: true,
        versionKey: false,

        transform(doc, ret) {
          ret.id =
            ret._id.toString();

          delete ret._id;
          delete ret.__v;

          return ret;
        },
      },

      toObject: {
        virtuals: true,
        versionKey: false,
      },
    },
  );

/* ==========================================================================
 * Indexes
 * ========================================================================== */

/**
 * Canonical identity.
 *
 * Platform permissions and tenant permissions are allowed to share the same
 * logical name because tenant scope is part of authorization identity.
 */
PermissionSchema.index(
  {
    tenantId: 1,
    name: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      isDeleted: false,
    },
    name:
      'uniq_permission_tenant_name',
  },
);

/**
 * System/platform permission identity.
 */
PermissionSchema.index(
  {
    resource: 1,
    action: 1,
    scope: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      systemDefined: true,
      tenantId: null,
      isDeleted: false,
    },
    name:
      'uniq_system_permission_definition',
  },
);

/**
 * Tenant-specific resource/action/scope identity.
 */
PermissionSchema.index(
  {
    tenantId: 1,
    resource: 1,
    action: 1,
    scope: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      systemDefined: false,
      tenantId: {
        $type: 'string',
      },
      isDeleted: false,
    },
    name:
      'uniq_tenant_permission_definition',
  },
);

/**
 * Effective active-permission lookup.
 */
PermissionSchema.index({
  tenantId: 1,
  status: 1,
  resource: 1,
  action: 1,
  scope: 1,
});

/**
 * Resource/action discovery.
 */
PermissionSchema.index({
  resource: 1,
  action: 1,
  status: 1,
});

/**
 * System permission discovery.
 */
PermissionSchema.index({
  systemDefined: 1,
  status: 1,
  resource: 1,
});

/**
 * Deprecation/replacement discovery.
 */
PermissionSchema.index({
  status: 1,
  deprecatedAt: -1,
});

/* ==========================================================================
 * Virtuals
 * ========================================================================== */

PermissionSchema.virtual(
  'isActive',
).get(function getIsActive() {
  return (
    this.status === 'active' &&
    this.isDeleted === false
  );
});

PermissionSchema.virtual(
  'isDeprecated',
).get(function getIsDeprecated() {
  return (
    this.status === 'deprecated'
  );
});

PermissionSchema.virtual(
  'isPlatformPermission',
).get(function getIsPlatformPermission() {
  return (
    this.systemDefined === true &&
    this.tenantId === null
  );
});

/* ==========================================================================
 * Query helpers
 * ========================================================================== */

PermissionSchema.query.active =
  function active() {
    return this.where({
      status: 'active',
      isDeleted: false,
    });
  };

PermissionSchema.query.system =
  function system() {
    return this.where({
      systemDefined: true,
      tenantId: null,
      isDeleted: false,
    });
  };

PermissionSchema.query.forTenant =
  function forTenant(
    tenantId,
  ) {
    if (!tenantId) {
      throw new TypeError(
        'tenantId is required.',
      );
    }

    return this.where({
      tenantId:
        String(tenantId).trim(),
      isDeleted: false,
    });
  };

PermissionSchema.query.byResource =
  function byResource(
    resource,
  ) {
    return this.where({
      resource:
        normalizeResource(
          resource,
        ),
      isDeleted: false,
    });
  };

PermissionSchema.query.byAction =
  function byAction(
    action,
  ) {
    return this.where({
      action:
        normalizeAction(
          action,
        ),
      isDeleted: false,
    });
  };

/* ==========================================================================
 * Instance methods
 * ========================================================================== */

PermissionSchema.methods.isGrantable =
  function isGrantable() {
    return (
      this.status === 'active' &&
      this.isDeleted === false
    );
  };

PermissionSchema.methods.deactivate =
  async function deactivate(
    updatedBy = null,
  ) {
    if (
      this.status ===
      'deprecated'
    ) {
      throw new Error(
        'Deprecated permissions cannot be reactivated by deactivate().',
      );
    }

    this.status = 'inactive';

    if (updatedBy) {
      this.updatedBy =
        normalizeObjectId(
          updatedBy,
          'updatedBy',
        );
    }

    await this.save();

    return this;
  };

PermissionSchema.methods.activate =
  async function activate(
    updatedBy = null,
  ) {
    if (
      this.status ===
      'deprecated'
    ) {
      throw new Error(
        'Deprecated permissions require an explicit restoration/change process.',
      );
    }

    if (
      this.isDeleted
    ) {
      throw new Error(
        'Deleted permissions cannot be activated.',
      );
    }

    this.status = 'active';

    if (updatedBy) {
      this.updatedBy =
        normalizeObjectId(
          updatedBy,
          'updatedBy',
        );
    }

    await this.save();

    return this;
  };

PermissionSchema.methods.deprecate =
  async function deprecate({
    reason = null,
    replacedBy = null,
    updatedBy = null,
  } = {}) {
    const normalizedReplacement =
      normalizeObjectId(
        replacedBy,
        'replacedBy',
      );

    if (
      normalizedReplacement &&
      normalizedReplacement.equals(
        this._id,
      )
    ) {
      throw new Error(
        'A permission cannot replace itself.',
      );
    }

    this.status = 'deprecated';
    this.deprecatedAt =
      new Date();

    this.deprecationReason =
      normalizeOptionalString(
        reason,
        MAX_DEPRECATION_REASON_LENGTH,
      );

    this.replacedBy =
      normalizedReplacement;

    if (updatedBy) {
      this.updatedBy =
        normalizeObjectId(
          updatedBy,
          'updatedBy',
        );
    }

    await this.save();

    return this;
  };

/**
 * Soft deletion is intentionally administrative and should normally not be
 * used for deployed/system permissions.
 */
PermissionSchema.methods.softDelete =
  async function softDelete({
    reason = null,
    updatedBy = null,
  } = {}) {
    if (
      this.systemDefined
    ) {
      throw new Error(
        'System-defined permissions should be deprecated or inactivated rather than deleted.',
      );
    }

    this.isDeleted = true;
    this.deletedAt =
      new Date();

    this.deleteReason =
      normalizeOptionalString(
        reason,
        MAX_DELETE_REASON_LENGTH,
      );

    if (updatedBy) {
      this.updatedBy =
        normalizeObjectId(
          updatedBy,
          'updatedBy',
        );
    }

    await this.save();

    return this;
  };

/* ==========================================================================
 * Static methods
 * ========================================================================== */

/**
 * Find by permission name.
 *
 * Platform and tenant contexts are deliberately explicit.
 */
PermissionSchema.statics.findByName =
  function findByName(
    name,
    {
      tenantId = null,
    } = {},
  ) {
    const normalizedName =
      normalizePermissionName(
        name,
      );

    return this.findOne({
      name: normalizedName,
      tenantId:
        tenantId === null
          ? null
          : String(
              tenantId,
            ).trim(),
      isDeleted: false,
    });
  };

/**
 * Find an active permission by name.
 */
PermissionSchema.statics.findActiveByName =
  function findActiveByName(
    name,
    {
      tenantId = null,
    } = {},
  ) {
    const normalizedName =
      normalizePermissionName(
        name,
      );

    return this.findOne({
      name: normalizedName,
      tenantId:
        tenantId === null
          ? null
          : String(
              tenantId,
            ).trim(),
      status: 'active',
      isDeleted: false,
    });
  };

/**
 * Find a resource/action/scope definition.
 */
PermissionSchema.statics.findByResourceAction =
  function findByResourceAction({
    resource,
    action,
    scope = 'tenant',
    tenantId = null,
  } = {}) {
    const normalizedScope =
      normalizeScope(
        scope,
      );

    const filter = {
      resource:
        normalizeResource(
          resource,
        ),

      action:
        normalizeAction(
          action,
        ),

      scope: normalizedScope,

      status: 'active',

      isDeleted: false,
    };

    if (
      normalizedScope ===
      'tenant'
    ) {
      if (!tenantId) {
        throw new TypeError(
          'tenantId is required for tenant-scoped permission lookup.',
        );
      }

      filter.tenantId =
        String(
          tenantId,
        ).trim();
    } else if (
      normalizedScope ===
      'platform' ||
      normalizedScope ===
      'system'
    ) {
      filter.tenantId = null;
    } else if (
      tenantId !== null &&
      tenantId !== undefined
    ) {
      filter.tenantId =
        String(
          tenantId,
        ).trim();
    }

    return this.findOne(
      filter,
    );
  };

/**
 * Resolve the permissions effective within a tenant.
 *
 * Includes:
 * - platform/system permissions;
 * - tenant-specific permissions.
 */
PermissionSchema.statics.findEffectiveForTenant =
  function findEffectiveForTenant(
    tenantId,
  ) {
    if (!tenantId) {
      throw new TypeError(
        'tenantId is required.',
      );
    }

    return this.find({
      status: 'active',
      isDeleted: false,

      $or: [
        {
          systemDefined: true,
          tenantId: null,
        },
        {
          systemDefined: false,
          tenantId:
            String(
              tenantId,
            ).trim(),
        },
      ],
    }).sort({
      resource: 1,
      action: 1,
      scope: 1,
      name: 1,
    });
  };

/**
 * Ensure an application permission exists.
 *
 * The database unique index is the final protection against concurrent
 * creation by multiple processes.
 */
PermissionSchema.statics.ensurePermission =
  async function ensurePermission({
    name,
    resource,
    action,
    scope = 'tenant',
    description = null,
    displayName = null,
    tenantId = null,
    systemDefined = true,
    createdBy = null,
  } = {}) {
    const normalizedName =
      normalizePermissionName(
        name,
      );

    const normalizedResource =
      normalizeResource(
        resource,
      );

    const normalizedAction =
      normalizeAction(
        action,
      );

    const normalizedScope =
      normalizeScope(
        scope,
      );

    const normalizedSystemDefined =
      Boolean(
        systemDefined,
      );

    const normalizedTenantId =
      tenantId === null ||
      tenantId === undefined ||
      tenantId === ''
        ? null
        : String(
            tenantId,
          ).trim();

    if (
      normalizedSystemDefined &&
      normalizedTenantId
    ) {
      throw new TypeError(
        'System-defined permissions cannot have tenantId.',
      );
    }

    if (
      !normalizedSystemDefined &&
      !normalizedTenantId
    ) {
      throw new TypeError(
        'Tenant-defined permissions require tenantId.',
      );
    }

    const filter = {
      name: normalizedName,
      tenantId:
        normalizedTenantId,
      isDeleted: false,
    };

    const existing =
      await this.findOne(
        filter,
      );

    if (existing) {
      return existing;
    }

    try {
      return await this.create({
        name: normalizedName,
        resource:
          normalizedResource,
        action:
          normalizedAction,
        scope:
          normalizedScope,
        description:
          normalizeOptionalString(
            description,
            MAX_DESCRIPTION_LENGTH,
          ),
        displayName:
          normalizeOptionalString(
            displayName,
            MAX_DISPLAY_NAME_LENGTH,
          ),
        tenantId:
          normalizedTenantId,
        systemDefined:
          normalizedSystemDefined,
        createdBy:
          normalizeObjectId(
            createdBy,
            'createdBy',
          ),
      });
    } catch (error) {
      if (
        error?.code === 11000
      ) {
        return this.findOne(
          filter,
        );
      }

      throw error;
    }
  };

/* ==========================================================================
 * Validation middleware
 * ========================================================================== */

PermissionSchema.pre(
  'validate',
  function validatePermission(
    next,
  ) {
    try {
      if (this.name) {
        this.name =
          normalizePermissionName(
            this.name,
          );
      }

      if (this.resource) {
        this.resource =
          normalizeResource(
            this.resource,
          );
      }

      if (this.action) {
        this.action =
          normalizeAction(
            this.action,
          );
      }

      if (this.scope) {
        this.scope =
          normalizeScope(
            this.scope,
          );
      }

      /*
       * System-defined permissions are platform-owned.
       */
      if (
        this.systemDefined &&
        this.tenantId
      ) {
        this.invalidate(
          'tenantId',
          'System-defined permissions cannot belong to a tenant.',
        );
      }

      /*
       * Tenant-defined permissions must have a tenant boundary.
       */
      if (
        !this.systemDefined &&
        !this.tenantId
      ) {
        this.invalidate(
          'tenantId',
          'Tenant-defined permissions require tenantId.',
        );
      }

      /*
       * Scope/ownership consistency.
       */
      if (
        this.scope ===
          'platform' &&
        this.tenantId
      ) {
        this.invalidate(
          'tenantId',
          'Platform permissions cannot be tenant-owned.',
        );
      }

      if (
        this.scope ===
          'system' &&
        !this.systemDefined
      ) {
        this.invalidate(
          'systemDefined',
          'System-scoped permissions must be system-defined.',
        );
      }

      /*
       * Deprecation invariants.
       */
      if (
        this.status ===
          'deprecated' &&
        !this.deprecatedAt
      ) {
        this.deprecatedAt =
          new Date();
      }

      if (
        this.status !==
          'deprecated' &&
        (
          this.deprecatedAt ||
          this.deprecationReason
        )
      ) {
        /**
         * Clear stale deprecation metadata when a controlled administrative
         * operation explicitly reactivates the permission.
         */
        if (
          this.isModified(
            'status',
          )
        ) {
          this.deprecatedAt =
            null;

          this.deprecationReason =
            null;
        }
      }

      /*
       * Version must remain positive.
       */
      if (
        !Number.isInteger(
          this.version,
        ) ||
        this.version < 1
      ) {
        this.invalidate(
          'version',
          'Permission version must be a positive integer.',
        );
      }

      /*
       * A permission cannot replace itself.
       */
      if (
        this.replacedBy &&
        this._id &&
        this.replacedBy.equals(
          this._id,
        )
      ) {
        this.invalidate(
          'replacedBy',
          'A permission cannot replace itself.',
        );
      }

      /*
       * Deleted records must have deletion metadata.
       */
      if (
        this.isDeleted &&
        !this.deletedAt
      ) {
        this.deletedAt =
          new Date();
      }

      next();
    } catch (error) {
      next(error);
    }
  });

/* ==========================================================================
 * Mutation protection
 * ========================================================================== */

/**
 * Permission definitions are configuration metadata.
 *
 * Hard deletion is deliberately unavailable to ordinary application code.
 */
PermissionSchema.pre(
  [
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'findByIdAndDelete',
  ],
  function preventHardDelete(
    next,
  ) {
    next(
      new mongoose.Error.MongooseError(
        'Permission hard deletion is disabled. Use controlled lifecycle methods.',
      ),
    );
  },
);

/**
 * Generic updates can change authorization semantics without going through
 * an auditable policy operation, so they are blocked.
 */
PermissionSchema.pre(
  [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'findByIdAndUpdate',
    'replaceOne',
  ],
  function preventGenericMutation(
    next,
  ) {
    const options =
      this.getOptions();

    if (
      options.allowPermissionMutation ===
      true
    ) {
      return next();
    }

    next(
      new mongoose.Error.MongooseError(
        'Generic Permission updates are disabled. Use controlled permission lifecycle methods.',
      ),
    );
  },
);

PermissionSchema.pre(
  'bulkWrite',
  function preventBulkWrite(
    next,
  ) {
    next(
      new mongoose.Error.MongooseError(
        'bulkWrite is disabled for Permission.',
      ),
    );
  },
);

/* ==========================================================================
 * Soft-delete query protection
 * ========================================================================== */

PermissionSchema.pre(
  /^find/,
  function hideDeletedPermissions(
    next,
  ) {
    const options =
      this.getOptions();

    if (
      !options.includeDeleted
    ) {
      this.where({
        isDeleted: false,
      });
    }

    next();
  },
);

/* ==========================================================================
 * Model export
 * ========================================================================== */

const Permission =
  mongoose.models.Permission ||
  mongoose.model(
    'Permission',
    PermissionSchema,
  );

export default Permission;

export {
  PermissionSchema,
};