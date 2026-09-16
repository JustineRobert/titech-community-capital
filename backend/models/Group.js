/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Group Model
 * ============================================================================
 *
 * File:
 *   backend/models/Group.js
 *
 * Purpose:
 *   Enterprise multi-tenant community group aggregate for:
 *
 *   - SACCOs
 *   - VSLAs
 *   - ROSCAs
 *   - savings groups
 *   - investment groups
 *   - welfare/community groups
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * Group is a DOMAIN aggregate.
 *
 * It is NOT:
 *   - a wallet
 *   - a savings ledger
 *   - a loan ledger
 *   - a transaction ledger
 *   - a financial balance store
 *
 * Financial authority remains with canonical financial services/models.
 *
 * Membership authority
 * ----------------------------------------------------------------------------
 * `memberRoles` is the authoritative rich membership state.
 *
 * `members` is a compatibility/lookup projection and must not be treated as
 * the authoritative source for invitation, role, acceptance, or removal state.
 *
 * Important
 * ----------------------------------------------------------------------------
 *   - Every production Group is tenant-scoped.
 *   - Group names are unique within a tenant among non-deleted groups.
 *   - Historical membership state is preserved.
 *   - Embedded audit history is bounded.
 *   - Optimistic concurrency is enabled.
 *   - Financial balances are intentionally absent.
 *
 * Module format
 *   ESM.
 *
 * ============================================================================
 */

import mongoose from "mongoose";

const { Schema } = mongoose;

// =============================================================================
// CONFIGURATION
// =============================================================================

const MAX_GROUP_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;

const MAX_METADATA_AUDIT_ENTRIES = 200;
const MAX_AUDIT_DETAILS_KEYS = 30;
const MAX_AUDIT_DETAILS_BYTES = 16 * 1024;

const MAX_MEMBER_COUNT = 10000;

const GROUP_TYPES = Object.freeze([
  "savings",
  "investment",
  "community",
  "welfare",
]);

const MEMBER_ROLES = Object.freeze([
  "member",
  "treasurer",
  "secretary",
]);

const INVITATION_STATUSES = Object.freeze([
  "pending",
  "accepted",
  "rejected",
]);

const GROUP_STATUSES = Object.freeze([
  "active",
  "suspended",
  "archived",
]);

const AUDIT_ACTIONS = Object.freeze([
  "created",
  "updated",
  "member_added",
  "member_removed",
  "member_role_changed",
  "invitation_sent",
  "invitation_accepted",
  "invitation_rejected",
  "suspended",
  "reinstated",
  "archived",
]);

const ACTIVE_INVITATION_STATUSES = Object.freeze([
  "pending",
  "accepted",
]);

// =============================================================================
// NORMALIZATION / VALIDATION HELPERS
// =============================================================================

function normalizeGroupName(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeDescription(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .trim()
    .replace(/\s+/g, " ");
}

function toObjectId(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (!mongoose.isValidObjectId(value)) {
    return null;
  }

  return new mongoose.Types.ObjectId(value);
}

function requireObjectId(value, fieldName) {
  const objectId = toObjectId(value);

  if (!objectId) {
    throw new TypeError(
      `${fieldName} must be a valid ObjectId.`
    );
  }

  return objectId;
}

function deduplicateObjectIds(values = []) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const objectId = toObjectId(value);

    if (!objectId) {
      continue;
    }

    const key = objectId.toString();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(objectId);
  }

  return result;
}

function trimAuditLog(entries = []) {
  if (!Array.isArray(entries)) {
    return [];
  }

  if (entries.length <= MAX_METADATA_AUDIT_ENTRIES) {
    return entries;
  }

  return entries.slice(
    -MAX_METADATA_AUDIT_ENTRIES
  );
}

function estimateBytes(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  try {
    return Buffer.byteLength(
      JSON.stringify(value),
      "utf8"
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function ensureAuditDetailsSafe(details) {
  if (
    details === null ||
    details === undefined
  ) {
    return null;
  }

  if (
    typeof details !== "object" ||
    Array.isArray(details)
  ) {
    throw new TypeError(
      "Audit details must be a JSON object."
    );
  }

  if (
    Object.keys(details).length >
    MAX_AUDIT_DETAILS_KEYS
  ) {
    throw new RangeError(
      `Audit details cannot contain more than ${MAX_AUDIT_DETAILS_KEYS} keys.`
    );
  }

  if (
    estimateBytes(details) >
    MAX_AUDIT_DETAILS_BYTES
  ) {
    throw new RangeError(
      "Audit details exceed the maximum permitted size."
    );
  }

  return details;
}

// =============================================================================
// MEMBER ROLE SUBDOCUMENT
// =============================================================================

const memberRoleSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    role: {
      type: String,
      enum: MEMBER_ROLES,
      required: true,
      default: "member",
      lowercase: true,
      trim: true,
    },

    joinedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    invitationStatus: {
      type: String,
      enum: INVITATION_STATUSES,
      required: true,
      default: "pending",
      lowercase: true,
      trim: true,
    },

    acceptedAt: {
      type: Date,
      default: null,
    },

    rejectedAt: {
      type: Date,
      default: null,
    },

    removedAt: {
      type: Date,
      default: null,
    },

    removedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    _id: false,
    id: false,
    strict: true,
    minimize: false,
  }
);

// =============================================================================
// GROUP AUDIT ENTRY
// =============================================================================

const auditEntrySchema = new Schema(
  {
    action: {
      type: String,
      enum: AUDIT_ACTIONS,
      required: true,
      lowercase: true,
      trim: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },

    details: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    _id: false,
    id: false,
    strict: true,
    minimize: false,
  }
);

// =============================================================================
// GROUP METADATA
// =============================================================================

const metadataSchema = new Schema(
  {
    totalInvited: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "totalInvited must be an integer.",
      },
    },

    invitationsSent: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "invitationsSent must be an integer.",
      },
    },

    lastInvitationBatch: {
      type: Date,
      default: null,
    },

    auditLog: {
      type: [auditEntrySchema],
      default: [],
      validate: {
        validator: (entries) =>
          Array.isArray(entries) &&
          entries.length <= MAX_METADATA_AUDIT_ENTRIES,
        message:
          `auditLog cannot contain more than ${MAX_METADATA_AUDIT_ENTRIES} entries.`,
      },
    },
  },
  {
    _id: false,
    id: false,
    strict: true,
    minimize: false,
  }
);

// =============================================================================
// GROUP SCHEMA
// =============================================================================

const groupSchema = new Schema(
  {
    // -------------------------------------------------------------------------
    // TENANT
    // -------------------------------------------------------------------------

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // CORE GROUP INFORMATION
    // -------------------------------------------------------------------------

    name: {
      type: String,
      required: [
        true,
        "Group name is required",
      ],
      minlength: 3,
      maxlength: MAX_GROUP_NAME_LENGTH,
      set: normalizeGroupName,
      validate: {
        validator(value) {
          return (
            typeof value === "string" &&
            value.trim().length >= 3
          );
        },
        message:
          "Group name must contain at least 3 characters.",
      },
    },

    type: {
      type: String,
      enum: GROUP_TYPES,
      required: true,
      default: "savings",
      lowercase: true,
      trim: true,
      index: true,
      immutable: true,
    },

    description: {
      type: String,
      maxlength: MAX_DESCRIPTION_LENGTH,
      default: "",
      set: normalizeDescription,
    },

    status: {
      type: String,
      enum: GROUP_STATUSES,
      required: true,
      default: "active",
      lowercase: true,
      trim: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // MEMBERSHIP PROJECTION
    // -------------------------------------------------------------------------

    /**
     * Compatibility / query projection.
     *
     * Authoritative membership state lives in memberRoles.
     */
    members: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      default: [],
      validate: {
        validator(values) {
          return (
            Array.isArray(values) &&
            values.length <= MAX_MEMBER_COUNT
          );
        },
        message:
          `A group cannot contain more than ${MAX_MEMBER_COUNT} members.`,
      },
    },

    /**
     * Authoritative membership state.
     */
    memberRoles: {
      type: [memberRoleSchema],
      default: [],
      validate: {
        validator(values) {
          if (
            !Array.isArray(values) ||
            values.length > MAX_MEMBER_COUNT
          ) {
            return false;
          }

          const seen = new Set();

          for (const membership of values) {
            if (!membership?.userId) {
              return false;
            }

            const userId =
              String(membership.userId);

            if (seen.has(userId)) {
              return false;
            }

            seen.add(userId);
          }

          return true;
        },
        message:
          "memberRoles must contain unique users and remain within the maximum membership limit.",
      },
    },

    // -------------------------------------------------------------------------
    // CREATION / MANAGEMENT
    // -------------------------------------------------------------------------

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },

    managedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // -------------------------------------------------------------------------
    // GOVERNANCE / METADATA
    // -------------------------------------------------------------------------

    metadata: {
      type: metadataSchema,
      default: () => ({}),
    },

    // -------------------------------------------------------------------------
    // SOFT DELETE
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // SCHEMA VERSION
    // -------------------------------------------------------------------------

    schemaVersion: {
      type: Number,
      required: true,
      default: 3,
      min: 1,
    },
  },
  {
    timestamps: true,

    versionKey: "__v",

    optimisticConcurrency: true,

    strict: true,

    strictQuery: true,

    minimize: false,

    toJSON: {
      virtuals: true,

      transform(doc, ret) {
        ret.id = ret._id
          ? ret._id.toString()
          : undefined;

        delete ret._id;
        delete ret.__v;

        return ret;
      },
    },

    toObject: {
      virtuals: true,

      transform(doc, ret) {
        ret.id = ret._id
          ? ret._id.toString()
          : undefined;

        delete ret._id;
        delete ret.__v;

        return ret;
      },
    },
  }
);

// =============================================================================
// VIRTUALS
// =============================================================================

groupSchema.virtual("isDeleted").get(
  function isDeleted() {
    return Boolean(this.deletedAt);
  }
);

groupSchema.virtual("memberCount").get(
  function memberCount() {
    return Array.isArray(this.members)
      ? this.members.length
      : 0;
  }
);

groupSchema.virtual("activeMemberCount").get(
  function activeMemberCount() {
    if (
      !Array.isArray(this.memberRoles)
    ) {
      return 0;
    }

    const activeUsers = new Set();

    for (const membership of this.memberRoles) {
      if (
        membership?.userId &&
        membership.invitationStatus ===
          "accepted" &&
        !membership.removedAt
      ) {
        activeUsers.add(
          String(membership.userId)
        );
      }
    }

    return activeUsers.size;
  }
);

// =============================================================================
// DOCUMENT VALIDATION
// =============================================================================

groupSchema.pre(
  "validate",
  function validateGroup(next) {
    try {
      // -----------------------------------------------------------------------
      // Normalization
      // -----------------------------------------------------------------------

      this.name =
        normalizeGroupName(this.name);

      if (
        this.description !== undefined &&
        this.description !== null
      ) {
        this.description =
          normalizeDescription(
            this.description
          );
      }

      // -----------------------------------------------------------------------
      // Tenant / ownership
      // -----------------------------------------------------------------------

      if (!this.tenantId) {
        throw new Error(
          "tenantId is required."
        );
      }

      if (!this.createdBy) {
        throw new Error(
          "createdBy is required."
        );
      }

      // -----------------------------------------------------------------------
      // Membership limits
      // -----------------------------------------------------------------------

      if (
        this.members?.length >
        MAX_MEMBER_COUNT
      ) {
        throw new Error(
          `Group cannot exceed ${MAX_MEMBER_COUNT} membership entries.`
        );
      }

      if (
        this.memberRoles?.length >
        MAX_MEMBER_COUNT
      ) {
        throw new Error(
          `Group cannot exceed ${MAX_MEMBER_COUNT} memberRoles entries.`
        );
      }

      // -----------------------------------------------------------------------
      // Membership integrity
      // -----------------------------------------------------------------------

      const roleUsers =
        deduplicateObjectIds(
          (this.memberRoles || []).map(
            (membership) =>
              membership.userId
          )
        );

      const activeRoleUsers =
        deduplicateObjectIds(
          (this.memberRoles || [])
            .filter(
              (membership) =>
                membership &&
                membership.invitationStatus ===
                  "accepted" &&
                !membership.removedAt
            )
            .map(
              (membership) =>
                membership.userId
            )
        );

      /**
       * A managedBy user must either be null or an active member.
       *
       * We only enforce this when memberRoles are present; the service layer
       * should ensure it during partial membership workflows.
       */
      if (
        this.managedBy &&
        activeRoleUsers.length > 0 &&
        !activeRoleUsers.some(
          (userId) =>
            String(userId) ===
            String(this.managedBy)
        )
      ) {
        throw new Error(
          "managedBy must reference an active group member."
        );
      }

      // If memberRoles were explicitly provided/loaded, construct the
      // compatibility members projection from active accepted memberships.
      //
      // Avoid doing this blindly during partial saves where memberRoles may
      // not represent the complete membership collection.
      if (
        this.isNew ||
        this.isModified("memberRoles")
      ) {
        this.members =
          activeRoleUsers;
      } else {
        this.members =
          deduplicateObjectIds(
            this.members || []
          );
      }

      // Prevent roleUsers from being silently unused except as a consistency
      // calculation/debugging aid.
      void roleUsers;

      // -----------------------------------------------------------------------
      // Lifecycle integrity
      // -----------------------------------------------------------------------

      if (
        this.deletedAt &&
        this.status !== "archived"
      ) {
        throw new Error(
          "A deleted group must have archived status."
        );
      }

      if (
        this.deletedAt &&
        !this.deletedBy
      ) {
        throw new Error(
          "deletedBy is required when deletedAt is set."
        );
      }

      if (
        this.status === "active" &&
        this.deletedAt
      ) {
        throw new Error(
          "A deleted group cannot be active."
        );
      }

      // -----------------------------------------------------------------------
      // Metadata normalization
      // -----------------------------------------------------------------------

      if (
        this.metadata?.auditLog
      ) {
        this.metadata.auditLog =
          trimAuditLog(
            this.metadata.auditLog
          );
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

// =============================================================================
// STATE TRANSITION VALIDATION
// =============================================================================

groupSchema.pre(
  "save",
  function validateStateTransition(next) {
    try {
      if (!this.isNew) {
        const previousStatus =
          this.$__.priorDoc?.status ??
          this.get("status");

        void previousStatus;
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

// =============================================================================
// GROUP METHODS
// =============================================================================

groupSchema.methods.belongsToTenant =
  function belongsToTenant(
    tenantId
  ) {
    if (
      !this.tenantId ||
      !tenantId
    ) {
      return false;
    }

    return (
      String(this.tenantId) ===
      String(tenantId)
    );
  };

groupSchema.methods.hasMember =
  function hasMember(userId) {
    if (!userId) {
      return false;
    }

    const normalizedUserId =
      String(userId);

    return (
      Array.isArray(this.memberRoles) &&
      this.memberRoles.some(
        (membership) =>
          membership &&
          membership.invitationStatus ===
            "accepted" &&
          !membership.removedAt &&
          String(
            membership.userId
          ) === normalizedUserId
      )
    );
  };

groupSchema.methods.getMemberRole =
  function getMemberRole(userId) {
    if (!userId) {
      return null;
    }

    const membership =
      this.memberRoles.find(
        (entry) =>
          entry &&
          entry.invitationStatus ===
            "accepted" &&
          !entry.removedAt &&
          String(entry.userId) ===
            String(userId)
      );

    return membership?.role || null;
  };

groupSchema.methods.getMembership =
  function getMembership(userId) {
    if (!userId) {
      return null;
    }

    return (
      this.memberRoles.find(
        (entry) =>
          entry &&
          String(entry.userId) ===
            String(userId)
      ) || null
    );
  };

groupSchema.methods.addMember =
  function addMember(
    userId,
    {
      role = "member",
      invitationStatus = "accepted",
      joinedAt = new Date(),
      acceptedAt = null,
    } = {}
  ) {
    const normalizedUserId =
      requireObjectId(
        userId,
        "userId"
      );

    if (
      !MEMBER_ROLES.includes(role)
    ) {
      throw new Error(
        `Invalid member role: ${role}`
      );
    }

    if (
      !INVITATION_STATUSES.includes(
        invitationStatus
      )
    ) {
      throw new Error(
        `Invalid invitation status: ${invitationStatus}`
      );
    }

    if (
      this.status === "archived" ||
      this.deletedAt
    ) {
      throw new Error(
        "Members cannot be added to an archived group."
      );
    }

    const existing =
      this.getMembership(
        normalizedUserId
      );

    if (existing) {
      if (
        existing.removedAt &&
        invitationStatus ===
          "accepted"
      ) {
        existing.removedAt = null;
        existing.removedBy = null;
        existing.role = role;
        existing.invitationStatus =
          invitationStatus;
        existing.joinedAt =
          joinedAt;
        existing.acceptedAt =
          acceptedAt || joinedAt;
        existing.rejectedAt = null;

        return this;
      }

      throw new Error(
        "A membership record already exists for this user."
      );
    }

    const membership =
      {
        userId:
          normalizedUserId,

        role,

        joinedAt,

        invitationStatus,

        acceptedAt:
          invitationStatus ===
          "accepted"
            ? acceptedAt || joinedAt
            : null,

        rejectedAt:
          invitationStatus ===
          "rejected"
            ? new Date()
            : null,

        removedAt: null,
        removedBy: null,
      };

    this.memberRoles.push(
      membership
    );

    return this;
  };

groupSchema.methods.acceptInvitation =
  function acceptInvitation(
    userId,
    acceptedAt = new Date()
  ) {
    const membership =
      this.getMembership(userId);

    if (!membership) {
      throw new Error(
        "Invitation/membership record not found."
      );
    }

    if (
      membership.removedAt
    ) {
      throw new Error(
        "Removed membership cannot accept an invitation."
      );
    }

    if (
      membership.invitationStatus ===
      "accepted"
    ) {
      return this;
    }

    if (
      membership.invitationStatus !==
      "pending"
    ) {
      throw new Error(
        "Only pending invitations can be accepted."
      );
    }

    membership.invitationStatus =
      "accepted";

    membership.acceptedAt =
      acceptedAt;

    membership.rejectedAt = null;

    return this;
  };

groupSchema.methods.rejectInvitation =
  function rejectInvitation(
    userId,
    rejectedAt = new Date()
  ) {
    const membership =
      this.getMembership(userId);

    if (!membership) {
      throw new Error(
        "Invitation/membership record not found."
      );
    }

    if (
      membership.invitationStatus ===
      "accepted"
    ) {
      throw new Error(
        "An accepted membership cannot be rejected as an invitation."
      );
    }

    membership.invitationStatus =
      "rejected";

    membership.rejectedAt =
      rejectedAt;

    return this;
  };

groupSchema.methods.removeMember =
  function removeMember(
    userId,
    removedBy = null,
    removedAt = new Date()
  ) {
    const normalizedUserId =
      requireObjectId(
        userId,
        "userId"
      );

    const membership =
      this.getMembership(
        normalizedUserId
      );

    if (!membership) {
      throw new Error(
        "Membership record not found."
      );
    }

    if (
      membership.removedAt
    ) {
      return this;
    }

    membership.removedAt =
      removedAt;

    membership.removedBy =
      toObjectId(removedBy);

    /**
     * Preserve invitation/member history rather than deleting the record.
     */
    if (
      membership.invitationStatus ===
      "accepted"
    ) {
      membership.invitationStatus =
        "rejected";
    }

    if (
      this.managedBy &&
      String(this.managedBy) ===
        String(normalizedUserId)
    ) {
      this.managedBy = null;
    }

    return this;
  };

groupSchema.methods.changeMemberRole =
  function changeMemberRole(
    userId,
    role
  ) {
    const normalizedUserId =
      requireObjectId(
        userId,
        "userId"
      );

    if (
      !MEMBER_ROLES.includes(role)
    ) {
      throw new Error(
        `Invalid member role: ${role}`
      );
    }

    const membership =
      this.getMembership(
        normalizedUserId
      );

    if (
      !membership ||
      membership.invitationStatus !==
        "accepted" ||
      membership.removedAt
    ) {
      throw new Error(
        "Active group membership not found."
      );
    }

    membership.role = role;

    return this;
  };

groupSchema.methods.setManager =
  function setManager(
    userId
  ) {
    const normalizedUserId =
      requireObjectId(
        userId,
        "userId"
      );

    if (
      !this.hasMember(
        normalizedUserId
      )
    ) {
      throw new Error(
        "Manager must be an active group member."
      );
    }

    this.managedBy =
      normalizedUserId;

    return this;
  };

groupSchema.methods.appendAudit =
  function appendAudit({
    action,
    userId = null,
    details = null,
    timestamp = new Date(),
  } = {}) {
    if (
      !AUDIT_ACTIONS.includes(action)
    ) {
      throw new Error(
        `Unsupported group audit action: ${action}`
      );
    }

    const safeDetails =
      ensureAuditDetailsSafe(
        details
      );

    if (!this.metadata) {
      this.metadata = {};
    }

    if (
      !Array.isArray(
        this.metadata.auditLog
      )
    ) {
      this.metadata.auditLog = [];
    }

    this.metadata.auditLog.push({
      action,
      userId:
        toObjectId(userId),
      timestamp,
      details: safeDetails,
    });

    this.metadata.auditLog =
      trimAuditLog(
        this.metadata.auditLog
      );

    return this;
  };

groupSchema.methods.suspend =
  function suspend(
    userId = null,
    reason = null
  ) {
    if (
      this.status === "archived" ||
      this.deletedAt
    ) {
      throw new Error(
        "An archived/deleted group cannot be suspended."
      );
    }

    if (
      this.status === "suspended"
    ) {
      return this;
    }

    this.status =
      "suspended";

    this.appendAudit({
      action:
        "suspended",
      userId,
      details:
        reason
          ? { reason: String(reason).trim() }
          : null,
    });

    return this;
  };

groupSchema.methods.reinstate =
  function reinstate(
    userId = null,
    reason = null
  ) {
    if (
      this.deletedAt ||
      this.status === "archived"
    ) {
      throw new Error(
        "An archived/deleted group cannot be reinstated."
      );
    }

    if (
      this.status === "active"
    ) {
      return this;
    }

    this.status =
      "active";

    this.appendAudit({
      action:
        "reinstated",
      userId,
      details:
        reason
          ? { reason: String(reason).trim() }
          : null,
    });

    return this;
  };

groupSchema.methods.archive =
  function archive(
    userId = null,
    reason = null
  ) {
    if (
      this.status === "archived"
    ) {
      return this;
    }

    this.status =
      "archived";

    this.appendAudit({
      action:
        "archived",
      userId,
      details:
        reason
          ? { reason: String(reason).trim() }
          : null,
    });

    return this;
  };

groupSchema.methods.softDelete =
  function softDelete(
    userId = null
  ) {
    if (!userId) {
      throw new Error(
        "deletedBy is required for soft deletion."
      );
    }

    this.deletedAt =
      new Date();

    this.deletedBy =
      requireObjectId(
        userId,
        "deletedBy"
      );

    this.status =
      "archived";

    this.appendAudit({
      action:
        "archived",
      userId,
      details: {
        softDeleted: true,
      },
    });

    return this;
  };

// =============================================================================
// STATIC HELPERS
// =============================================================================

groupSchema.statics.findTenantGroup =
  function findTenantGroup(
    tenantId,
    groupId
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    const groupObjectId =
      toObjectId(groupId);

    if (
      !tenantObjectId ||
      !groupObjectId
    ) {
      return this.findOne({
        _id: null,
      });
    }

    return this.findOne({
      _id:
        groupObjectId,

      tenantId:
        tenantObjectId,

      deletedAt:
        null,
    });
  };

groupSchema.statics.findTenantGroups =
  function findTenantGroups(
    tenantId,
    {
      status = "active",
      type = null,
      limit = 100,
      skip = 0,
    } = {}
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    if (!tenantObjectId) {
      return this.findOne({
        _id: null,
      });
    }

    const normalizedLimit =
      Math.min(
        100,
        Math.max(
          1,
          Number.parseInt(
            limit,
            10
          ) || 100
        )
      );

    const normalizedSkip =
      Math.max(
        0,
        Number.parseInt(
          skip,
          10
        ) || 0
      );

    const query = {
      tenantId:
        tenantObjectId,

      deletedAt:
        null,
    };

    if (
      status !== null &&
      status !== undefined
    ) {
      if (
        !GROUP_STATUSES.includes(
          status
        )
      ) {
        throw new Error(
          `Unsupported group status: ${status}`
        );
      }

      query.status =
        status;
    }

    if (type) {
      if (
        !GROUP_TYPES.includes(
          type
        )
      ) {
        throw new Error(
          `Unsupported group type: ${type}`
        );
      }

      query.type =
        type;
    }

    return this.find(query)
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .skip(
        normalizedSkip
      )
      .limit(
        normalizedLimit
      );
  };

groupSchema.statics.findByName =
  function findByName(
    tenantId,
    name
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    if (
      !tenantObjectId ||
      typeof name !== "string"
    ) {
      return this.findOne({
        _id: null,
      });
    }

    return this.findOne({
      tenantId:
        tenantObjectId,

      name:
        normalizeGroupName(name),

      deletedAt:
        null,
    });
  };

groupSchema.statics.findMemberGroups =
  function findMemberGroups(
    tenantId,
    userId
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    const userObjectId =
      toObjectId(userId);

    if (
      !tenantObjectId ||
      !userObjectId
    ) {
      return this.findOne({
        _id: null,
      });
    }

    return this.find({
      tenantId:
        tenantObjectId,

      "memberRoles": {
        $elemMatch: {
          userId:
            userObjectId,

          invitationStatus:
            "accepted",

          removedAt:
            null,
        },
      },

      deletedAt:
        null,

      status:
        "active",
    });
  };

groupSchema.statics.countByTenant =
  async function countByTenant(
    tenantId
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    if (!tenantObjectId) {
      return 0;
    }

    return this.countDocuments({
      tenantId:
        tenantObjectId,

      deletedAt:
        null,
    });
  };

groupSchema.statics.countActiveMembers =
  async function countActiveMembers(
    tenantId,
    groupId
  ) {
    const group =
      await this.findOne({
        _id:
          toObjectId(groupId),

        tenantId:
          toObjectId(tenantId),

        deletedAt:
          null,
      }).select(
        "memberRoles"
      );

    return group
      ? group.activeMemberCount
      : 0;
  };

// =============================================================================
// INDEXES
// =============================================================================
//
// Soft-deleted group names are excluded from the uniqueness constraint, so a
// replacement group may reuse the previous name within the same tenant.
//
// =============================================================================

groupSchema.index(
  {
    tenantId: 1,
    name: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      deletedAt: null,
    },
    name: "uq_group_tenant_active_name",
  }
);

groupSchema.index(
  {
    tenantId: 1,
    status: 1,
    createdAt: -1,
  },
  {
    name: "idx_group_tenant_status_created",
  }
);

groupSchema.index(
  {
    tenantId: 1,
    type: 1,
    status: 1,
  },
  {
    name: "idx_group_tenant_type_status",
  }
);

groupSchema.index(
  {
    tenantId: 1,
    createdBy: 1,
    createdAt: -1,
  },
  {
    name: "idx_group_tenant_creator_created",
  }
);

groupSchema.index(
  {
    tenantId: 1,
    managedBy: 1,
    status: 1,
  },
  {
    sparse: true,
    name: "idx_group_tenant_manager_status",
  }
);

groupSchema.index(
  {
    tenantId: 1,
    members: 1,
    status: 1,
  },
  {
    name: "idx_group_tenant_members_status",
  }
);

groupSchema.index(
  {
    tenantId: 1,
    "memberRoles.userId": 1,
    "memberRoles.invitationStatus": 1,
  },
  {
    name: "idx_group_tenant_membership_status",
  }
);

groupSchema.index(
  {
    tenantId: 1,
    deletedAt: 1,
  },
  {
    name: "idx_group_tenant_deleted",
  }
);

// =============================================================================
// MODEL EXPORT
// =============================================================================

const Group =
  mongoose.models.Group ||
  mongoose.model(
    "Group",
    groupSchema
  );

export default Group;

export {
  GROUP_TYPES,
  MEMBER_ROLES,
  INVITATION_STATUSES,
  GROUP_STATUSES,
  AUDIT_ACTIONS,
  ACTIVE_INVITATION_STATUSES,
};

export const GROUP_MODEL_METADATA =
  Object.freeze({
    modelName:
      "Group",

    schemaVersion:
      3,

    tenantField:
      "tenantId",

    tenantFieldType:
      "ObjectId",

    financialAuthority:
      false,

    membershipSource:
      "memberRoles",

    membershipIndex:
      "members",

    groupNameUniqueness:
      "tenant-scoped-active",

    softDeletion:
      true,

    optimisticConcurrency:
      true,

    maxAuditEntries:
      MAX_METADATA_AUDIT_ENTRIES,

    maxMembers:
      MAX_MEMBER_COUNT,
  });