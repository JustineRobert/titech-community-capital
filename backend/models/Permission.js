"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/models/Permission.js
 *
 * Purpose:
 *   Enterprise-grade authorization permission definition.
 *
 * Architectural Role:
 *
 *   User
 *      ↓
 *   Role
 *      ↓
 *   Permission
 *      ↓
 *   Authorization Policy
 *
 * Permission represents an atomic capability that may be assigned to one or
 * more roles.
 *
 * Examples:
 *
 *   users.read
 *   users.create
 *   users.update
 *   users.delete
 *
 *   payments.read
 *   payments.create
 *   payments.refund
 *
 *   ledger.read
 *   ledger.post
 *
 *   tenant.users.manage
 *
 * IMPORTANT:
 *   Permission definitions should be treated as application configuration.
 *   They should generally NOT be physically deleted after deployment.
 *
 * =============================================================================
 */

const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const PERMISSION_ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
  "list",
  "view",
  "manage",
  "approve",
  "reject",
  "publish",
  "archive",
  "cancel",
  "refund",
  "execute",
  "post",
  "export",
  "import",
  "assign",
  "revoke",
];

const PERMISSION_SCOPES = [
  "platform",
  "tenant",
  "group",
  "self",
  "system",
];

const PERMISSION_STATUSES = [
  "active",
  "inactive",
  "deprecated",
];

const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_RESOURCE_LENGTH = 128;
const MAX_ACTION_LENGTH = 64;
const MAX_CODE_LENGTH = 256;

/**
 * =============================================================================
 * Permission Schema
 * =============================================================================
 */

const PermissionSchema = new Schema(
  {
    /**
     * -------------------------------------------------------------------------
     * Stable Permission Code
     * -------------------------------------------------------------------------
     *
     * Example:
     *
     *   payments.refund
     *   users.read
     *   ledger.post
     *
     * This should be the canonical authorization identifier used throughout
     * TITech services and middleware.
     */

    name: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: MAX_NAME_LENGTH,
    },

    /**
     * Explicit machine-readable code.
     *
     * This can be used if the platform eventually wants display names separate
     * from authorization identifiers.
     */
    code: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: MAX_CODE_LENGTH,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Authorization Resource
     * -------------------------------------------------------------------------
     *
     * Examples:
     *
     *   users
     *   payments
     *   loans
     *   contributions
     *   ledger
     *   announcements
     */

    resource: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: MAX_RESOURCE_LENGTH,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Authorization Action
     * -------------------------------------------------------------------------
     */

    action: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: MAX_ACTION_LENGTH,
      enum: PERMISSION_ACTIONS,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Permission Scope
     * -------------------------------------------------------------------------
     *
     * Scope determines WHERE the permission can operate.
     *
     * platform:
     *   Entire TITech platform.
     *
     * tenant:
     *   Within a tenant.
     *
     * group:
     *   Within a community/group.
     *
     * self:
     *   Only resources belonging to the authenticated principal.
     *
     * system:
     *   Internal system/service operations.
     */

    scope: {
      type: String,
      enum: PERMISSION_SCOPES,
      required: true,
      default: "tenant",
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Human-Readable Description
     * -------------------------------------------------------------------------
     */

    description: {
      type: String,
      trim: true,
      maxlength: MAX_DESCRIPTION_LENGTH,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Display Label
     * -------------------------------------------------------------------------
     */

    displayName: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Permission Lifecycle
     * -------------------------------------------------------------------------
     */

    status: {
      type: String,
      enum: PERMISSION_STATUSES,
      default: "active",
      required: true,
      index: true,
    },

    /**
     * Whether this is a system-defined permission.
     *
     * System permissions should generally not be modified or deleted through
     * ordinary tenant administration.
     */

    systemDefined: {
      type: Boolean,
      default: true,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Tenant Ownership
     * -------------------------------------------------------------------------
     *
     * Platform-wide permissions have tenantId = null.
     *
     * Tenant-specific custom permissions may carry a tenantId.
     */

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Permission Version
     * -------------------------------------------------------------------------
     *
     * Useful when authorization policy definitions evolve.
     */

    version: {
      type: Number,
      default: 1,
      min: 1,
    },

    /**
     * -------------------------------------------------------------------------
     * Lifecycle Metadata
     * -------------------------------------------------------------------------
     */

    deprecatedAt: {
      type: Date,
      default: null,
    },

    deprecationReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    replacedBy: {
      type: Schema.Types.ObjectId,
      ref: "Permission",
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Audit Metadata
     * -------------------------------------------------------------------------
     */

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Soft Delete
     * -------------------------------------------------------------------------
     *
     * Authorization records should normally be deprecated/inactivated rather
     * than deleted.
     */

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    deleteReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
  },
  {
    timestamps: true,

    versionKey: false,

    collection: "permissions",

    strict: true,

    minimize: true,
  }
);

/**
 * =============================================================================
 * Indexes
 * =============================================================================
 */

/**
 * Resource/action authorization lookup.
 */
PermissionSchema.index({
  resource: 1,
  action: 1,
  scope: 1,
});

/**
 * Tenant authorization lookup.
 */
PermissionSchema.index({
  tenantId: 1,
  status: 1,
  resource: 1,
  action: 1,
});

/**
 * Active permission discovery.
 */
PermissionSchema.index({
  status: 1,
  resource: 1,
});

/**
 * System permission discovery.
 */
PermissionSchema.index({
  systemDefined: 1,
  status: 1,
});

/**
 * Tenant custom permissions.
 *
 * A tenant may have one permission definition for a particular resource/action
 * combination.
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
      isDeleted: false,
    },
    name: "uniq_tenant_permission_definition",
  }
);

/**
 * Platform/system permissions.
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
      tenantId: null,
      systemDefined: true,
      isDeleted: false,
    },
    name: "uniq_system_permission_definition",
  }
);

/**
 * =============================================================================
 * Query Helpers
 * =============================================================================
 */

PermissionSchema.query.active = function () {
  return this.where({
    status: "active",
    isDeleted: false,
  });
};

PermissionSchema.query.system = function () {
  return this.where({
    systemDefined: true,
    isDeleted: false,
  });
};

PermissionSchema.query.forTenant = function (tenantId) {
  return this.where({
    tenantId,
    isDeleted: false,
  });
};

PermissionSchema.query.byResource = function (resource) {
  return this.where({
    resource: String(resource).toLowerCase(),
    isDeleted: false,
  });
};

/**
 * =============================================================================
 * Instance Methods
 * =============================================================================
 */

/**
 * Determine whether permission can currently be granted.
 */
PermissionSchema.methods.isGrantable = function () {
  return (
    !this.isDeleted &&
    this.status === "active"
  );
};

/**
 * Determine whether permission is deprecated.
 */
PermissionSchema.methods.isDeprecated = function () {
  return this.status === "deprecated";
};

/**
 * Deactivate permission.
 */
PermissionSchema.methods.deactivate = function () {
  this.status = "inactive";

  return this.save();
};

/**
 * Deprecate permission.
 */
PermissionSchema.methods.deprecate = function ({
  reason = null,
  replacedBy = null,
} = {}) {
  this.status = "deprecated";
  this.deprecatedAt = new Date();
  this.deprecationReason = reason;
  this.replacedBy = replacedBy;

  return this.save();
};

/**
 * Reactivate permission.
 */
PermissionSchema.methods.activate = function () {
  this.status = "active";
  this.deprecatedAt = null;
  this.deprecationReason = null;

  return this.save();
};

/**
 * Soft delete permission.
 */
PermissionSchema.methods.softDelete = function (
  reason = null
) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deleteReason = reason;

  return this.save();
};

/**
 * =============================================================================
 * Static Methods
 * =============================================================================
 */

/**
 * Find by canonical permission name.
 */
PermissionSchema.statics.findByName = function (
  name
) {
  if (!name) {
    return null;
  }

  return this.findOne({
    name: String(name).trim().toLowerCase(),
    isDeleted: false,
  });
};

/**
 * Find active permission.
 */
PermissionSchema.statics.findActiveByName = function (
  name
) {
  if (!name) {
    return null;
  }

  return this.findOne({
    name: String(name).trim().toLowerCase(),
    status: "active",
    isDeleted: false,
  });
};

/**
 * Find a resource/action permission.
 */
PermissionSchema.statics.findByResourceAction = function ({
  resource,
  action,
  scope = "tenant",
  tenantId = null,
} = {}) {
  if (!resource || !action) {
    return null;
  }

  return this.findOne({
    resource: String(resource).trim().toLowerCase(),
    action: String(action).trim().toLowerCase(),
    scope,
    tenantId,
    status: "active",
    isDeleted: false,
  });
};

/**
 * Find all effective permissions for a tenant.
 *
 * Includes:
 *   1. Platform/system permissions.
 *   2. Tenant-specific permissions.
 */
PermissionSchema.statics.findEffectiveForTenant = function (
  tenantId
) {
  return this.find({
    $or: [
      {
        tenantId: null,
        systemDefined: true,
      },
      {
        tenantId,
      },
    ],
    status: "active",
    isDeleted: false,
  }).sort({
    resource: 1,
    action: 1,
    scope: 1,
  });
};

/**
 * Create permission safely.
 */
PermissionSchema.statics.ensurePermission = async function ({
  name,
  resource,
  action,
  scope = "tenant",
  description = null,
  displayName = null,
  tenantId = null,
  systemDefined = true,
  createdBy = null,
} = {}) {
  if (!name) {
    throw new Error("Permission name is required");
  }

  if (!resource) {
    throw new Error("Permission resource is required");
  }

  if (!action) {
    throw new Error("Permission action is required");
  }

  const normalizedName = String(name)
    .trim()
    .toLowerCase();

  const existing = await this.findOne({
    name: normalizedName,
    isDeleted: false,
  });

  if (existing) {
    return existing;
  }

  try {
    return await this.create({
      name: normalizedName,
      resource,
      action,
      scope,
      description,
      displayName,
      tenantId,
      systemDefined,
      createdBy,
    });
  } catch (error) {
    /**
     * Handle a race where another process creates the permission between the
     * lookup and insert.
     */
    if (error?.code === 11000) {
      return this.findOne({
        name: normalizedName,
        isDeleted: false,
      });
    }

    throw error;
  }
};

/**
 * =============================================================================
 * Validation
 * =============================================================================
 */

PermissionSchema.pre("validate", function (next) {
  /**
   * Normalize authorization identifiers.
   */
  if (this.name) {
    this.name = this.name
      .trim()
      .toLowerCase();
  }

  if (this.resource) {
    this.resource = this.resource
      .trim()
      .toLowerCase();
  }

  if (this.action) {
    this.action = this.action
      .trim()
      .toLowerCase();
  }

  /**
   * Validate conventional permission naming.
   *
   * Examples:
   *
   *   users.read
   *   payments.refund
   *   ledger.post
   *
   * Custom hierarchical names are also permitted.
   */
  if (
    this.name &&
    !/^[a-z0-9][a-z0-9._:-]*$/.test(this.name)
  ) {
    this.invalidate(
      "name",
      "Permission name contains invalid characters"
    );
  }

  /**
   * System permissions should not belong to a tenant.
   */
  if (
    this.systemDefined &&
    this.tenantId
  ) {
    this.invalidate(
      "tenantId",
      "System-defined permissions cannot belong to a tenant"
    );
  }

  /**
   * Tenant permissions require a tenant.
   */
  if (
    !this.systemDefined &&
    !this.tenantId
  ) {
    this.invalidate(
      "tenantId",
      "Tenant-defined permissions require tenantId"
    );
  }

  /**
   * Deprecated permissions require a deprecation timestamp.
   */
  if (
    this.status === "deprecated" &&
    !this.deprecatedAt
  ) {
    this.deprecatedAt = new Date();
  }

  next();
});

/**
 * =============================================================================
 * Soft Delete Query Protection
 * ============================================================================= */

PermissionSchema.pre(/^find/, function (next) {
  const options = this.getOptions();

  if (!options.includeDeleted) {
    this.where({
      isDeleted: false,
    });
  }

  next();
});

/**
 * =============================================================================
 * JSON Serialization
 * ============================================================================= */

PermissionSchema.methods.toJSON = function () {
  return this.toObject();
};

/**
 * =============================================================================
 * Model Export
 * =============================================================================
 */

module.exports =
  mongoose.models.Permission ||
  mongoose.model(
    "Permission",
    PermissionSchema
  );