"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * Enterprise Role Model
 * =============================================================================
 *
 * File:
 *   backend/models/Role.js
 *
 * Purpose:
 *   Defines the enterprise RBAC Role model for the TITech Community Capital
 *   multi-tenant financial operating system.
 *
 * Architectural responsibilities:
 *   - Role identity and normalization
 *   - Tenant isolation
 *   - Permission assignment
 *   - System/platform role support
 *   - Role lifecycle metadata
 *   - Safe database indexing
 *   - RBAC integrity
 *
 * =============================================================================
 * MULTI-TENANT SECURITY MODEL
 * =============================================================================
 *
 * Platform/system roles:
 *
 *   tenantId = null
 *
 * Tenant roles:
 *
 *   tenantId = <Tenant ObjectId>
 *
 * Role names are unique within their security scope:
 *
 *   PLATFORM:
 *     ADMIN
 *     SUPPORT
 *     COMPLIANCE
 *
 *   TENANT:
 *     ADMIN
 *     TREASURER
 *     MEMBER
 *
 * A tenant must therefore be able to have an "ADMIN" role without colliding
 * with another tenant's "ADMIN" role.
 *
 * =============================================================================
 * SECURITY PRINCIPLES
 * =============================================================================
 *
 * - Never trust role names supplied by clients.
 * - Normalize role names before persistence.
 * - Never allow duplicate roles within the same tenant.
 * - Preserve platform/tenant isolation.
 * - Prevent accidental deletion of protected system roles.
 * - Keep permissions explicit.
 * - Reject malformed permissions.
 * - Avoid arbitrary object properties.
 * - Do not store secrets in roles.
 * - Support safe serialization.
 *
 * =============================================================================
 */

const mongoose = require("mongoose");

const {
  Schema,
} = mongoose;


/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const MODEL_NAME = "Role";

const TENANT_MODEL_NAME = "Tenant";

const MAX_ROLE_NAME_LENGTH = 100;

const MAX_PERMISSION_LENGTH = 150;

const MAX_PERMISSIONS_PER_ROLE = 500;


/**
 * =============================================================================
 * ROLE NAME FORMAT
 * =============================================================================
 *
 * Examples:
 *
 *   PLATFORM_ADMIN
 *   TENANT_ADMIN
 *   TREASURER
 *   LOAN_OFFICER
 *   MEMBER
 *
 * Normalized role names are uppercase and may contain:
 *
 *   A-Z
 *   0-9
 *   _
 *   -
 *
 * =============================================================================
 */

const ROLE_NAME_PATTERN = /^[A-Z][A-Z0-9_-]*$/;


/**
 * =============================================================================
 * PERMISSION FORMAT
 * =============================================================================
 *
 * Examples:
 *
 *   users:read
 *   users:create
 *   users:update
 *   savings:read
 *   savings:create
 *   transactions:approve
 *   reports:export
 *
 * Wildcards may be used by the authorization layer if supported:
 *
 *   users:*
 *   reports:*
 *
 * =============================================================================
 */

const PERMISSION_PATTERN =
  /^[a-z][a-z0-9_-]*(?::[a-z0-9_*.-]+)+$/;


/**
 * =============================================================================
 * NORMALIZATION HELPERS
 * =============================================================================
 */

function normalizeRoleName(value) {
  if (value === null || value === undefined) {
    return value;
  }

  return String(value)
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();
}


function normalizePermission(value) {
  if (value === null || value === undefined) {
    return value;
  }

  return String(value)
    .trim()
    .toLowerCase();
}


function normalizePermissionList(permissions) {
  if (!Array.isArray(permissions)) {
    return permissions;
  }

  const normalized = permissions
    .map(normalizePermission)
    .filter(Boolean);

  return [
    ...new Set(normalized),
  ].sort();
}


/**
 * =============================================================================
 * SCHEMA
 * =============================================================================
 */

const RoleSchema = new Schema(
  {
    /**
     * -------------------------------------------------------------------------
     * ROLE NAME
     * -------------------------------------------------------------------------
     */

    name: {
      type: String,

      required: [
        true,
        "Role name is required.",
      ],

      trim: true,

      uppercase: true,

      minlength: [
        2,
        "Role name must contain at least 2 characters.",
      ],

      maxlength: [
        MAX_ROLE_NAME_LENGTH,
        `Role name cannot exceed ${MAX_ROLE_NAME_LENGTH} characters.`,
      ],

      match: [
        ROLE_NAME_PATTERN,
        "Role name may only contain uppercase letters, numbers, underscores, and hyphens.",
      ],
    },


    /**
     * -------------------------------------------------------------------------
     * PERMISSIONS
     * -------------------------------------------------------------------------
     */

    permissions: {
      type: [
        {
          type: String,

          trim: true,

          lowercase: true,

          maxlength: [
            MAX_PERMISSION_LENGTH,
            `Permission cannot exceed ${MAX_PERMISSION_LENGTH} characters.`,
          ],

          match: [
            PERMISSION_PATTERN,
            "Permission must use the namespace:action format.",
          ],
        },
      ],

      default: [],

      validate: {
        validator(value) {
          if (!Array.isArray(value)) {
            return false;
          }

          if (
            value.length >
            MAX_PERMISSIONS_PER_ROLE
          ) {
            return false;
          }

          /**
           * Prevent duplicate permissions.
           */
          return (
            new Set(value).size ===
            value.length
          );
        },

        message:
          "Role permissions must be unique and must not exceed the configured limit.",
      },
    },


    /**
     * -------------------------------------------------------------------------
     * TENANT
     * -------------------------------------------------------------------------
     *
     * null means the role belongs to the TITech platform security scope.
     *
     * A populated tenantId means the role belongs to that tenant.
     * -------------------------------------------------------------------------
     */

    tenantId: {
      type: Schema.Types.ObjectId,

      ref: TENANT_MODEL_NAME,

      default: null,

      index: true,
    },


    /**
     * -------------------------------------------------------------------------
     * SYSTEM ROLE
     * -------------------------------------------------------------------------
     *
     * System roles are managed by TITech application governance and should not
     * normally be modified or deleted by tenant administrators.
     * -------------------------------------------------------------------------
     */

    isSystemRole: {
      type: Boolean,

      default: false,

      index: true,
    },


    /**
     * -------------------------------------------------------------------------
     * PLATFORM ROLE
     * -------------------------------------------------------------------------
     *
     * Explicitly identifies roles that operate at platform scope.
     *
     * Platform roles must have tenantId === null.
     * -------------------------------------------------------------------------
     */

    isPlatformRole: {
      type: Boolean,

      default: false,

      index: true,
    },


    /**
     * -------------------------------------------------------------------------
     * ACTIVE STATE
     * -------------------------------------------------------------------------
     */

    isActive: {
      type: Boolean,

      default: true,

      index: true,
    },


    /**
     * -------------------------------------------------------------------------
     * PROTECTED ROLE
     * -------------------------------------------------------------------------
     *
     * Protected roles cannot be casually deleted or modified by ordinary
     * tenant administrators.
     * -------------------------------------------------------------------------
     */

    isProtected: {
      type: Boolean,

      default: false,

      index: true,
    },


    /**
     * -------------------------------------------------------------------------
     * DESCRIPTION
     * -------------------------------------------------------------------------
     */

    description: {
      type: String,

      trim: true,

      maxlength: [
        500,
        "Role description cannot exceed 500 characters.",
      ],

      default: "",
    },


    /**
     * -------------------------------------------------------------------------
     * CREATED BY
     * -------------------------------------------------------------------------
     *
     * References the user/account that created the role.
     *
     * This is intentionally optional because platform bootstrap operations may
     * create roles before an ordinary authenticated user exists.
     * -------------------------------------------------------------------------
     */

    createdBy: {
      type: Schema.Types.ObjectId,

      ref: "User",

      default: null,
    },


    /**
     * -------------------------------------------------------------------------
     * UPDATED BY
     * -------------------------------------------------------------------------
     */

    updatedBy: {
      type: Schema.Types.ObjectId,

      ref: "User",

      default: null,
    },


    /**
     * -------------------------------------------------------------------------
     * VERSION
     * -------------------------------------------------------------------------
     *
     * Allows application-level optimistic concurrency control when role
     * mutations are implemented using an expected version.
     * -------------------------------------------------------------------------
     */

    version: {
      type: Number,

      default: 1,

      min: 1,
    },


    /**
     * -------------------------------------------------------------------------
     * LAST PERMISSION CHANGE
     * -------------------------------------------------------------------------
     *
     * Useful for cache invalidation and authorization policy propagation.
     * -------------------------------------------------------------------------
     */

    permissionsVersion: {
      type: Number,

      default: 1,

      min: 1,
    },


    /**
     * -------------------------------------------------------------------------
     * LAST PERMISSION CHANGE DATE
     * -------------------------------------------------------------------------
     */

    permissionsUpdatedAt: {
      type: Date,

      default: null,
    },


    /**
     * -------------------------------------------------------------------------
     * DEACTIVATION METADATA
     * -------------------------------------------------------------------------
     */

    deactivatedAt: {
      type: Date,

      default: null,
    },

    deactivatedBy: {
      type: Schema.Types.ObjectId,

      ref: "User",

      default: null,
    },


    /**
     * -------------------------------------------------------------------------
     * SOFT DELETION
     * -------------------------------------------------------------------------
     *
     * Financial platforms should generally avoid physically deleting security
     * records that may be referenced by historical authorization/audit records.
     * -------------------------------------------------------------------------
     */

    deletedAt: {
      type: Date,

      default: null,

      index: true,
    },

    deletedBy: {
      type: Schema.Types.ObjectId,

      ref: "User",

      default: null,
    },
  },

  {
    timestamps: true,

    strict: true,

    strictQuery: true,

    minimize: true,

    versionKey: "__v",

    collection: "roles",

    optimisticConcurrency: false,
  }
);


/**
 * =============================================================================
 * SCHEMA INDEXES
 * =============================================================================
 *
 * CRITICAL:
 *
 * MongoDB's unique index must account for tenant scope.
 *
 * The partial index below supports:
 *
 *   tenantId = ObjectId + name
 *
 * and:
 *
 *   tenantId = null + name
 *
 * without allowing duplicate active role definitions.
 * =============================================================================
 */

RoleSchema.index(
  {
    tenantId: 1,
    name: 1,
  },
  {
    unique: true,

    partialFilterExpression: {
      deletedAt: null,
    },

    name:
      "uniq_active_role_name_per_tenant",
  }
);


/**
 * Active role lookup.
 */

RoleSchema.index(
  {
    tenantId: 1,
    isActive: 1,
    name: 1,
  },
  {
    name:
      "idx_role_tenant_active_name",
  }
);


/**
 * Permission/cache invalidation lookup.
 */

RoleSchema.index(
  {
    tenantId: 1,
    permissionsVersion: 1,
  },
  {
    name:
      "idx_role_tenant_permissions_version",
  }
);


/**
 * Platform/system role lookup.
 */

RoleSchema.index(
  {
    isPlatformRole: 1,
    isSystemRole: 1,
    isActive: 1,
  },
  {
    name:
      "idx_platform_system_roles",
  }
);


/**
 * Soft-deleted role lookup.
 */

RoleSchema.index(
  {
    tenantId: 1,
    deletedAt: 1,
  },
  {
    name:
      "idx_role_tenant_deleted_at",
  }
);


/**
 * =============================================================================
 * PRE-VALIDATION
 * =============================================================================
 */

RoleSchema.pre(
  "validate",
  function normalizeAndValidateRole(next) {
    try {
      /**
       * Normalize name.
       */
      if (this.name) {
        this.name =
          normalizeRoleName(
            this.name
          );
      }

      /**
       * Normalize permissions.
       */
      if (
        Array.isArray(
          this.permissions
        )
      ) {
        this.permissions =
          normalizePermissionList(
            this.permissions
          );
      }

      /**
       * Platform role invariants.
       */
      if (this.isPlatformRole) {
        this.tenantId = null;
      }

      /**
       * A role marked as system role is automatically protected.
       */
      if (this.isSystemRole) {
        this.isProtected = true;
      }

      /**
       * Deleted roles must not remain active.
       */
      if (this.deletedAt) {
        this.isActive = false;
      }

      /**
       * Deactivated roles must have deactivation timestamp.
       */
      if (
        this.isActive === false &&
        !this.deactivatedAt &&
        !this.deletedAt
      ) {
        this.deactivatedAt =
          new Date();
      }

      next();
    } catch (error) {
      next(error);
    }
  }
);


/**
 * =============================================================================
 * PRE-SAVE LIFECYCLE
 * =============================================================================
 */

RoleSchema.pre(
  "save",
  function roleSaveLifecycle(next) {
    try {
      /**
       * New role starts at version 1.
       */
      if (this.isNew) {
        this.version = 1;

        this.permissionsVersion = 1;

        if (
          this.permissionsUpdatedAt ===
          null
        ) {
          this.permissionsUpdatedAt =
            new Date();
        }

        return next();
      }

      /**
       * Detect permission changes.
       */
      if (
        this.isModified(
          "permissions"
        )
      ) {
        this.permissionsVersion =
          Math.max(
            1,
            Number(
              this.permissionsVersion ||
              1
            )
          ) + 1;

        this.permissionsUpdatedAt =
          new Date();
      }

      /**
       * Detect role-level changes.
       */
      if (
        this.isModified(
          "name"
        ) ||
        this.isModified(
          "permissions"
        ) ||
        this.isModified(
          "isActive"
        ) ||
        this.isModified(
          "description"
        )
      ) {
        this.version =
          Math.max(
            1,
            Number(
              this.version ||
              1
            )
          ) + 1;
      }

      next();
    } catch (error) {
      next(error);
    }
  }
);


/**
 * =============================================================================
 * QUERY HELPERS
 * =============================================================================
 */

RoleSchema.query.active = function active() {
  return this.where({
    isActive: true,

    deletedAt: null,
  });
};


RoleSchema.query.forTenant =
  function forTenant(tenantId) {
    return this.where({
      tenantId,
    });
  };


RoleSchema.query.platformRoles =
  function platformRoles() {
    return this.where({
      tenantId: null,

      isPlatformRole: true,
    });
  };


RoleSchema.query.systemRoles =
  function systemRoles() {
    return this.where({
      isSystemRole: true,
    });
  };


RoleSchema.query.notDeleted =
  function notDeleted() {
    return this.where({
      deletedAt: null,
    });
  };


/**
 * =============================================================================
 * INSTANCE METHODS
 * =============================================================================
 */

/**
 * Check whether this role contains a permission.
 */
RoleSchema.methods.hasPermission =
  function hasPermission(
    permission
  ) {
    const normalized =
      normalizePermission(
        permission
      );

    if (!normalized) {
      return false;
    }

    if (
      this.permissions.includes(
        normalized
      )
    ) {
      return true;
    }

    /**
     * Optional namespace wildcard:
     *
     * users:*
     *
     * grants:
     *
     * users:read
     * users:create
     * etc.
     */
    const namespace =
      normalized.split(":")[0];

    return this.permissions.includes(
      `${namespace}:*`
    );
  };


/**
 * Check multiple permissions.
 */
RoleSchema.methods.hasAnyPermission =
  function hasAnyPermission(
    permissions
  ) {
    if (!Array.isArray(permissions)) {
      return false;
    }

    return permissions.some(
      (permission) =>
        this.hasPermission(
          permission
        )
    );
  };


/**
 * Check that every requested permission is granted.
 */
RoleSchema.methods.hasAllPermissions =
  function hasAllPermissions(
    permissions
  ) {
    if (!Array.isArray(permissions)) {
      return false;
    }

    return permissions.every(
      (permission) =>
        this.hasPermission(
          permission
        )
    );
  };


/**
 * Determine whether the role belongs to a tenant.
 */
RoleSchema.methods.isTenantRole =
  function isTenantRole() {
    return Boolean(
      this.tenantId
    );
  };


/**
 * Determine whether the role is currently usable.
 */
RoleSchema.methods.isUsable =
  function isUsable() {
    return (
      this.isActive === true &&
      !this.deletedAt
    );
  };


/**
 * Determine whether the role may be deleted.
 *
 * Application/service authorization should still enforce the final decision.
 */
RoleSchema.methods.canBeDeleted =
  function canBeDeleted() {
    return (
      !this.isSystemRole &&
      !this.isProtected &&
      !this.deletedAt
    );
  };


/**
 * Soft-delete role.
 */
RoleSchema.methods.softDelete =
  function softDelete(
    actorId = null
  ) {
    if (
      !this.canBeDeleted()
    ) {
      const error =
        new Error(
          "Protected or system roles cannot be deleted."
        );

      error.code =
        "ROLE_DELETE_FORBIDDEN";

      throw error;
    }

    this.deletedAt =
      new Date();

    this.deletedBy =
      actorId || null;

    this.isActive = false;

    this.deactivatedAt =
      this.deactivatedAt ||
      new Date();

    this.deactivatedBy =
      this.deactivatedBy ||
      actorId ||
      null;

    return this;
  };


/**
 * =============================================================================
 * STATIC METHODS
 * =============================================================================
 */

/**
 * Find an active tenant role by normalized name.
 */
RoleSchema.statics.findActiveByName =
  function findActiveByName(
    tenantId,
    name
  ) {
    const normalizedName =
      normalizeRoleName(
        name
      );

    return this.findOne({
      tenantId:
        tenantId || null,

      name:
        normalizedName,

      isActive: true,

      deletedAt: null,
    });
  };


/**
 * Find platform role.
 */
RoleSchema.statics.findPlatformRole =
  function findPlatformRole(
    name
  ) {
    const normalizedName =
      normalizeRoleName(
        name
      );

    return this.findOne({
      tenantId: null,

      name:
        normalizedName,

      isPlatformRole: true,

      isActive: true,

      deletedAt: null,
    });
  };


/**
 * =============================================================================
 * JSON SERIALIZATION
 * =============================================================================
 *
 * Never expose internal persistence metadata unnecessarily.
 *
 * Permissions are intentionally retained because they are useful to frontend
 * authorization/session bootstrap layers, subject to API authorization.
 * =============================================================================
 */

function transformRoleDocument(
  _doc,
  ret
) {
  if (ret._id) {
    ret.id =
      String(ret._id);
  }

  delete ret._id;

  delete ret.__v;

  delete ret.deletedAt;

  delete ret.deletedBy;

  return ret;
}


RoleSchema.set(
  "toJSON",
  {
    virtuals: true,

    versionKey: false,

    transform:
      transformRoleDocument,
  }
);


RoleSchema.set(
  "toObject",
  {
    virtuals: true,

    versionKey: false,
  }
);


/**
 * =============================================================================
 * MODEL EXPORT
 * =============================================================================
 */

const Role =
  mongoose.models[MODEL_NAME] ||
  mongoose.model(
    MODEL_NAME,
    RoleSchema
  );


/**
 * =============================================================================
 * PUBLIC CONSTANTS
 * =============================================================================
 */

Role.MODEL_NAME =
  MODEL_NAME;

Role.MAX_ROLE_NAME_LENGTH =
  MAX_ROLE_NAME_LENGTH;

Role.MAX_PERMISSION_LENGTH =
  MAX_PERMISSION_LENGTH;

Role.MAX_PERMISSIONS_PER_ROLE =
  MAX_PERMISSIONS_PER_ROLE;

Role.normalizeRoleName =
  normalizeRoleName;

Role.normalizePermission =
  normalizePermission;

Role.normalizePermissionList =
  normalizePermissionList;


/**
 * =============================================================================
 * EXPORT
 * =============================================================================
 */

module.exports = Role;