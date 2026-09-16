/**
 * ============================================================================
 * backend/models/Conversation.js
 * TITech Community Capital LTD
 * Enterprise Conversation Aggregate
 * ============================================================================
 *
 * Architectural role
 * ----------------------------------------------------------------------------
 * Conversation is the communication aggregate for:
 *
 *   - direct messaging
 *   - group discussions
 *   - loan threads
 *   - savings discussions
 *   - transaction disputes
 *   - support conversations
 *   - administration / announcements
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * Conversation is NOT:
 *   - the source of truth for messages;
 *   - the source of truth for financial transactions;
 *   - an authorization replacement;
 *   - a notification queue;
 *   - an audit-log replacement.
 *
 * Security principles
 * ----------------------------------------------------------------------------
 *   - Mandatory tenant isolation.
 *   - Participant membership is explicit.
 *   - Soft deletion has one canonical representation.
 *   - Conversation lifecycle is explicit.
 *   - Direct-message uniqueness is tenant-scoped.
 *   - Linked business entities are tenant-scoped by service validation.
 *   - Unread counters are maintained atomically.
 *   - Optimistic concurrency is enabled.
 *   - Query middleware never relies on caller-controlled flags for privileged
 *     data access.
 *
 * Module format
 * ----------------------------------------------------------------------------
 * Native ESM.
 *
 * ============================================================================
 */

import mongoose from "mongoose";

const { Schema } = mongoose;

// =============================================================================
// CONSTANTS
// =============================================================================

const CONVERSATION_TYPES = Object.freeze([
  "DM",
  "GROUP",
  "LOAN",
  "SAVINGS",
  "SUPPORT",
  "TRANSACTION",
  "ANNOUNCEMENT",
  "ADMIN",
  "LOAN-THREAD",
  "TRANSACTION-THREAD",
  "SAVINGS-THREAD",
  "ADMIN-ANNOUNCEMENT",
]);

const LINKED_ENTITY_TYPES = Object.freeze([
  "GROUP",
  "LOAN",
  "SAVINGS",
  "TRANSACTION",
  "SUPPORT",
]);

const CONVERSATION_STATUSES = Object.freeze([
  "ACTIVE",
  "ARCHIVED",
  "LOCKED",
  "CLOSED",
]);

const MAX_TITLE_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_PARTICIPANTS = 10000;
const MAX_ADMINS = 1000;
const MAX_METADATA_BYTES = 32 * 1024;
const MAX_METADATA_KEYS = 50;
const MAX_UNREAD_COUNT = Number.MAX_SAFE_INTEGER;

// =============================================================================
// HELPERS
// =============================================================================

function toObjectId(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    value instanceof mongoose.Types.ObjectId
  ) {
    return value;
  }

  return mongoose.isValidObjectId(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
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

function normalizeText(
  value,
  fieldName,
  maxLength
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (typeof value !== "string") {
    throw new TypeError(
      `${fieldName} must be a string.`
    );
  }

  const normalized =
    value
      .trim()
      .replace(/\s+/g, " ");

  if (
    normalized.length >
    maxLength
  ) {
    throw new RangeError(
      `${fieldName} exceeds ${maxLength} characters.`
    );
  }

  return normalized;
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

// =============================================================================
// METADATA
// =============================================================================

const metadataSchema =
  new Schema(
    {
      name: {
        type: String,
        trim: true,
        maxlength: 255,
      },

      description: {
        type: String,
        trim: true,
        maxlength: 1000,
      },

      /**
       * Prefer controlled object-storage references rather than public secrets.
       */
      avatarUrl: {
        type: String,
        trim: true,
        maxlength: 2048,
      },

      extra: {
        type: Schema.Types.Mixed,
        default: undefined,
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
// SCHEMA
// =============================================================================

const conversationSchema =
  new Schema(
    {
      // -----------------------------------------------------------------------
      // TENANT
      // -----------------------------------------------------------------------

      tenantId: {
        type: Schema.Types.ObjectId,
        ref: "Tenant",
        required: true,
        immutable: true,
        index: true,
      },

      // -----------------------------------------------------------------------
      // CONVERSATION TYPE
      // -----------------------------------------------------------------------

      type: {
        type: String,
        enum: CONVERSATION_TYPES,
        required: true,
        default: "DM",
        uppercase: true,
        trim: true,
        immutable: true,
        index: true,
      },

      // -----------------------------------------------------------------------
      // CONTENT / IDENTITY
      // -----------------------------------------------------------------------

      title: {
        type: String,
        trim: true,
        maxlength: MAX_TITLE_LENGTH,
        default: null,
      },

      description: {
        type: String,
        trim: true,
        maxlength:
          MAX_DESCRIPTION_LENGTH,
        default: null,
      },

      // -----------------------------------------------------------------------
      // PARTICIPANTS
      // -----------------------------------------------------------------------

      participants: {
        type: [
          {
            type: Schema.Types.ObjectId,
            ref: "User",
          },
        ],
        required: true,
        default: [],
        validate: [
          {
            validator(value) {
              return (
                Array.isArray(value) &&
                value.length >= 1
              );
            },
            message:
              "Conversation must contain at least one participant.",
          },
          {
            validator(value) {
              const unique =
                new Set(
                  value.map(String)
                );

              return (
                unique.size ===
                value.length
              );
            },
            message:
              "Conversation participants must be unique.",
          },
          {
            validator(value) {
              return (
                value.length <=
                MAX_PARTICIPANTS
              );
            },
            message:
              `Conversation cannot contain more than ${MAX_PARTICIPANTS} participants.`,
          },
        ],
        index: true,
      },

      admins: {
        type: [
          {
            type: Schema.Types.ObjectId,
            ref: "User",
          },
        ],
        default: [],
        validate: {
          validator(value) {
            if (
              !Array.isArray(value) ||
              value.length >
                MAX_ADMINS
            ) {
              return false;
            }

            return (
              new Set(
                value.map(String)
              ).size ===
              value.length
            );
          },
          message:
            "Conversation admins must be unique and within the permitted limit.",
        },
      },

      // -----------------------------------------------------------------------
      // LINKED BUSINESS ENTITY
      // -----------------------------------------------------------------------

      linkedEntityType: {
        type: String,
        enum: [
          ...LINKED_ENTITY_TYPES,
          null,
        ],
        uppercase: true,
        trim: true,
        default: null,
        immutable: true,
        index: true,
      },

      linkedEntityId: {
        type: Schema.Types.ObjectId,
        default: null,
        immutable: true,
        index: true,
      },

      // -----------------------------------------------------------------------
      // CREATOR
      // -----------------------------------------------------------------------

      createdBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
        immutable: true,
        index: true,
      },

      // -----------------------------------------------------------------------
      // LIFECYCLE
      // -----------------------------------------------------------------------

      status: {
        type: String,
        enum: CONVERSATION_STATUSES,
        default: "ACTIVE",
        required: true,
        uppercase: true,
        trim: true,
        index: true,
      },

      // -----------------------------------------------------------------------
      // MESSAGE ACTIVITY
      // -----------------------------------------------------------------------

      lastMessage: {
        type: Schema.Types.ObjectId,
        ref: "Message",
        default: null,
      },

      lastMessageAt: {
        type: Date,
        default: null,
        index: true,
      },

      lastActivityAt: {
        type: Date,
        required: true,
        default: Date.now,
        index: true,
      },

      // -----------------------------------------------------------------------
      // PINNED MESSAGES
      // -----------------------------------------------------------------------

      pinnedMessageIds: {
        type: [
          {
            type: Schema.Types.ObjectId,
            ref: "Message",
          },
        ],
        default: [],
        validate: {
          validator(value) {
            return (
              new Set(
                value.map(String)
              ).size ===
              value.length
            );
          },
          message:
            "Pinned messages must be unique.",
        },
      },

      // -----------------------------------------------------------------------
      // UNREAD COUNTS
      // -----------------------------------------------------------------------

      /**
       * Map key:
       *   userId.toString()
       *
       * Value:
       *   unread message count for that participant.
       */
      unreadCounts: {
        type: Map,
        of: {
          type: Number,
          min: 0,
          max:
            MAX_UNREAD_COUNT,
        },
        default: () => new Map(),
      },

      // -----------------------------------------------------------------------
      // CHANNEL METADATA
      // -----------------------------------------------------------------------

      metadata: {
        type: metadataSchema,
        default: () => ({}),
      },

      isAnnouncementChannel: {
        type: Boolean,
        default: false,
        index: true,
      },

      // -----------------------------------------------------------------------
      // SOFT DELETE
      // -----------------------------------------------------------------------

      /**
       * `isDeleted` is the ONLY canonical deletion flag.
       *
       * The old `softDeleted` field is intentionally removed to avoid
       * conflicting states.
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

      deletedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      // -----------------------------------------------------------------------
      // ARCHIVE
      // -----------------------------------------------------------------------

      archivedAt: {
        type: Date,
        default: null,
      },

      archivedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      // -----------------------------------------------------------------------
      // LOCK
      // -----------------------------------------------------------------------

      lockedAt: {
        type: Date,
        default: null,
      },

      lockedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      lockReason: {
        type: String,
        trim: true,
        maxlength: 1000,
        default: null,
      },
    },
    {
      timestamps: true,

      versionKey: "__v",

      optimisticConcurrency: true,

      strict: true,

      strictQuery: true,

      minimize: false,

      collection:
        "conversations",

      toJSON: {
        virtuals: true,

        transform(
          doc,
          ret
        ) {
          ret.id =
            ret._id?.toString();

          delete ret._id;
          delete ret.__v;

          return ret;
        },
      },

      toObject: {
        virtuals: true,
      },
    }
  );

// =============================================================================
// VIRTUALS
// =============================================================================

conversationSchema.virtual(
  "id"
).get(function () {
  return this._id.toString();
});

conversationSchema.virtual(
  "participantCount"
).get(function () {
  return this.participants?.length || 0;
});

conversationSchema.virtual(
  "isLocked"
).get(function () {
  return this.status === "LOCKED";
});

conversationSchema.virtual(
  "isArchived"
).get(function () {
  return this.status === "ARCHIVED";
});

// =============================================================================
// VALIDATION
// =============================================================================

conversationSchema.pre(
  "validate",
  function validateConversation(
    next
  ) {
    try {
      // -----------------------------------------------------------------------
      // Tenant
      // -----------------------------------------------------------------------

      if (!this.tenantId) {
        throw new Error(
          "tenantId is required."
        );
      }

      // -----------------------------------------------------------------------
      // Participants
      // -----------------------------------------------------------------------

      this.participants =
        deduplicateObjectIds(
          this.participants
        );

      this.admins =
        deduplicateObjectIds(
          this.admins
        );

      if (
        this.participants.length === 0
      ) {
        throw new Error(
          "Conversation must have at least one participant."
        );
      }

      /**
       * Every admin must be a participant.
       */
      const participantSet =
        new Set(
          this.participants.map(
            String
          )
        );

      for (
        const adminId
        of this.admins
      ) {
        if (
          !participantSet.has(
            String(adminId)
          )
        ) {
          throw new Error(
            "Every conversation admin must be a participant."
          );
        }
      }

      // -----------------------------------------------------------------------
      // Linked entity
      // -----------------------------------------------------------------------

      if (
        this.linkedEntityType &&
        !this.linkedEntityId
      ) {
        throw new Error(
          "linkedEntityId is required when linkedEntityType is supplied."
        );
      }

      if (
        this.linkedEntityId &&
        !this.linkedEntityType
      ) {
        throw new Error(
          "linkedEntityType is required when linkedEntityId is supplied."
        );
      }

      // -----------------------------------------------------------------------
      // Announcement consistency
      // -----------------------------------------------------------------------

      if (
        this.isAnnouncementChannel &&
        this.type !==
          "ANNOUNCEMENT" &&
        this.type !==
          "ADMIN-ANNOUNCEMENT"
      ) {
        throw new Error(
          "Announcement channels must use an announcement conversation type."
        );
      }

      // -----------------------------------------------------------------------
      // Lifecycle consistency
      // -----------------------------------------------------------------------

      if (
        this.isDeleted
      ) {
        if (!this.deletedAt) {
          this.deletedAt =
            new Date();
        }

        if (!this.deletedBy) {
          throw new Error(
            "deletedBy is required for deleted conversations."
          );
        }
      }

      if (
        !this.isDeleted &&
        (
          this.deletedAt ||
          this.deletedBy
        )
      ) {
        throw new Error(
          "Non-deleted conversations cannot contain deletion state."
        );
      }

      if (
        this.status ===
        "ARCHIVED"
      ) {
        if (!this.archivedAt) {
          this.archivedAt =
            new Date();
        }
      }

      if (
        this.status ===
        "LOCKED"
      ) {
        if (!this.lockedAt) {
          this.lockedAt =
            new Date();
        }

        if (!this.lockedBy) {
          throw new Error(
            "lockedBy is required for locked conversations."
          );
        }
      }

      if (
        this.status !==
          "LOCKED" &&
        (
          this.lockedAt ||
          this.lockedBy
        )
      ) {
        throw new Error(
          "Unlocked conversations cannot contain lock state."
        );
      }

      // -----------------------------------------------------------------------
      // Metadata limits
      // -----------------------------------------------------------------------

      if (
        this.metadata?.extra
      ) {
        if (
          Object.keys(
            this.metadata.extra
          ).length >
          MAX_METADATA_KEYS
        ) {
          throw new RangeError(
            `metadata.extra cannot contain more than ${MAX_METADATA_KEYS} keys.`
          );
        }

        if (
          estimateBytes(
            this.metadata.extra
          ) >
          MAX_METADATA_BYTES
        ) {
          throw new RangeError(
            "metadata.extra exceeds the maximum permitted size."
          );
        }
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

// =============================================================================
// STATIC METHODS
// =============================================================================

/**
 * Find or create a direct message conversation.
 *
 * IMPORTANT:
 *   The tenant is part of the uniqueness boundary.
 *
 *   Two users in Tenant A must not accidentally resolve a conversation in
 *   Tenant B.
 *
 * Concurrency is handled using the unique compound index.
 */
conversationSchema.statics.findOrCreateDM =
  async function (
    tenantId,
    userA,
    userB,
    {
      session = null,
    } = {}
  ) {
    const tenantObjectId =
      requireObjectId(
        tenantId,
        "tenantId"
      );

    const userAObjectId =
      requireObjectId(
        userA,
        "userA"
      );

    const userBObjectId =
      requireObjectId(
        userB,
        "userB"
      );

    if (
      String(userAObjectId) ===
      String(userBObjectId)
    ) {
      throw new Error(
        "A direct conversation requires two different users."
      );
    }

    const orderedParticipants =
      [
        userAObjectId,
        userBObjectId,
      ].sort(
        (a, b) =>
          a
            .toString()
            .localeCompare(
              b.toString()
            )
      );

    const filter = {
      tenantId:
        tenantObjectId,

      type:
        "DM",

      participants:
        {
          $all:
            orderedParticipants,
          $size:
            2,
        },

      isDeleted:
        false,
    };

    const options = {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    };

    if (session) {
      options.session =
        session;
    }

    try {
      return await this.findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            tenantId:
              tenantObjectId,

            type:
              "DM",

            participants:
              orderedParticipants,

            createdBy:
              userAObjectId,

            admins:
              [],

            status:
              "ACTIVE",

            lastActivityAt:
              new Date(),

            isDeleted:
              false,
          },
        },
        options
      );
    } catch (error) {
      /**
       * Another worker may have inserted the same DM concurrently.
       */
      if (
        error?.code === 11000
      ) {
        const query =
          this.findOne(
            filter
          );

        if (session) {
          query.session(
            session
          );
        }

        const existing =
          await query.exec();

        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  };

/**
 * Find conversation by linked entity.
 */
conversationSchema.statics.findByLinkedEntity =
  async function (
    tenantId,
    type,
    entityId,
    {
      session = null,
    } = {}
  ) {
    if (
      !LINKED_ENTITY_TYPES.includes(
        type
      )
    ) {
      throw new Error(
        `Unsupported linked entity type: ${type}`
      );
    }

    const normalizedEntityId =
      requireObjectId(
        entityId,
        "entityId"
      );

    const query =
      this.findOne({
        tenantId,
        linkedEntityType:
          type,
        linkedEntityId:
          normalizedEntityId,
        isDeleted:
          false,
      });

    if (session) {
      query.session(
        session
      );
    }

    return query.exec();
  };

/**
 * Find tenant-scoped conversation by ID.
 */
conversationSchema.statics.findTenantConversation =
  async function (
    tenantId,
    conversationId,
    {
      includeDeleted = false,
      session = null,
    } = {}
  ) {
    const filter = {
      _id:
        requireObjectId(
          conversationId,
          "conversationId"
        ),

      tenantId,
    };

    if (!includeDeleted) {
      filter.isDeleted =
        false;
    }

    const query =
      this.findOne(
        filter
      );

    if (session) {
      query.session(
        session
      );
    }

    return query.exec();
  };

// =============================================================================
// INSTANCE METHODS
// =============================================================================

/**
 * Touch conversation activity.
 *
 * This should normally be invoked by MessageService after successful message
 * persistence.
 */
conversationSchema.methods.touch =
  async function (
    lastMessageId = null,
    {
      session = null,
      activityAt = new Date(),
    } = {}
  ) {
    const update = {
      $set: {
        lastActivityAt:
          activityAt,

        lastMessageAt:
          activityAt,
      },
    };

    if (lastMessageId) {
      update.$set.lastMessage =
        requireObjectId(
          lastMessageId,
          "lastMessageId"
        );
    }

    const options = {
      new: true,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id:
            this._id,

          tenantId:
            this.tenantId,

          isDeleted:
            false,

          status:
            {
              $in: [
                "ACTIVE",
                "LOCKED",
              ],
            },
        },
        update,
        options
      );

    if (!updated) {
      throw new Error(
        "Conversation could not be touched."
      );
    }

    return updated;
  };

/**
 * Increment a participant's unread count atomically.
 */
conversationSchema.methods.incrementUnread =
  async function (
    userId,
    {
      session = null,
    } = {}
  ) {
    const userObjectId =
      requireObjectId(
        userId,
        "userId"
      );

    if (
      !this.hasParticipant(
        userObjectId
      )
    ) {
      throw new Error(
        "Unread count can only be updated for a conversation participant."
      );
    }

    const key =
      `unreadCounts.${userObjectId.toString()}`;

    const options = {
      new: true,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id:
            this._id,

          tenantId:
            this.tenantId,

          isDeleted:
            false,
        },
        {
          $inc: {
            [key]:
              1,
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        "Conversation does not exist or is deleted."
      );
    }

    return updated;
  };

/**
 * Clear one participant's unread count atomically.
 */
conversationSchema.methods.clearUnread =
  async function (
    userId,
    {
      session = null,
    } = {}
  ) {
    const userObjectId =
      requireObjectId(
        userId,
        "userId"
      );

    const key =
      `unreadCounts.${userObjectId.toString()}`;

    const options = {
      new: true,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id:
            this._id,

          tenantId:
            this.tenantId,

          isDeleted:
            false,
        },
        {
          $set: {
            [key]:
              0,
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        "Conversation does not exist or is deleted."
      );
    }

    return updated;
  };

conversationSchema.methods.hasParticipant =
  function (
    userId
  ) {
    const normalized =
      String(
        userId
      );

    return this.participants.some(
      (participantId) =>
        String(
          participantId
        ) === normalized
    );
  };

conversationSchema.methods.isAdmin =
  function (
    userId
  ) {
    const normalized =
      String(
        userId
      );

    return this.admins.some(
      (adminId) =>
        String(
          adminId
        ) === normalized
    );
  };

/**
 * Archive conversation.
 */
conversationSchema.methods.archive =
  async function (
    userId,
    {
      session = null,
      archivedAt = new Date(),
    } = {}
  ) {
    const actor =
      requireObjectId(
        userId,
        "userId"
      );

    const options = {
      new: true,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id:
            this._id,

          tenantId:
            this.tenantId,

          isDeleted:
            false,

          status:
            {
              $nin: [
                "ARCHIVED",
                "CLOSED",
              ],
            },
        },
        {
          $set: {
            status:
              "ARCHIVED",

            archivedAt,

            archivedBy:
              actor,
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        "Conversation cannot be archived from its current state."
      );
    }

    return updated;
  };

/**
 * Lock conversation.
 */
conversationSchema.methods.lock =
  async function (
    userId,
    {
      reason = null,
      session = null,
      lockedAt = new Date(),
    } = {}
  ) {
    const actor =
      requireObjectId(
        userId,
        "userId"
      );

    const options = {
      new: true,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id:
            this._id,

          tenantId:
            this.tenantId,

          isDeleted:
            false,

          status:
            "ACTIVE",
        },
        {
          $set: {
            status:
              "LOCKED",

            lockedAt,

            lockedBy:
              actor,

            lockReason:
              reason
                ? String(
                    reason
                  ).trim()
                : null,
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        "Only ACTIVE conversations can be locked."
      );
    }

    return updated;
  };

/**
 * Soft delete conversation.
 *
 * Physical deletion should be handled only by a controlled retention process,
 * not ordinary application code.
 */
conversationSchema.methods.softDelete =
  async function (
    userId,
    {
      session = null,
      deletedAt = new Date(),
    } = {}
  ) {
    const actor =
      requireObjectId(
        userId,
        "userId"
      );

    const options = {
      new: true,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id:
            this._id,

          tenantId:
            this.tenantId,

          isDeleted:
            false,
        },
        {
          $set: {
            isDeleted:
              true,

            deletedAt,

            deletedBy:
              actor,

            status:
              "CLOSED",
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        "Conversation is already deleted or unavailable."
      );
    }

    return updated;
  };

// =============================================================================
// IMMUTABILITY OF TENANT / IDENTITY
// =============================================================================

/**
 * Tenant and core conversation identity must not be changed after creation.
 */
const IMMUTABLE_PATHS = new Set([
  "tenantId",
  "type",
  "conversationId",
  "createdBy",
  "linkedEntityType",
  "linkedEntityId",
]);

function inspectIdentityUpdate(
  update
) {
  if (!update) {
    return;
  }

  for (
    const [key, value]
    of Object.entries(update)
  ) {
    const root =
      key.startsWith("$")
        ? null
        : key.split(".")[0];

    if (
      root &&
      IMMUTABLE_PATHS.has(
        root
      )
    ) {
      throw new Error(
        `Conversation field "${root}" is immutable.`
      );
    }

    if (
      key === "$set" ||
      key === "$unset" ||
      key === "$setOnInsert"
    ) {
      for (
        const path
        of Object.keys(
          value || {}
        )
      ) {
        const rootPath =
          path.split(".")[0];

        if (
          IMMUTABLE_PATHS.has(
            rootPath
          )
        ) {
          throw new Error(
            `Conversation field "${rootPath}" is immutable.`
          );
        }
      }
    }
  }
}

conversationSchema.pre(
  "updateOne",
  function rejectIdentityUpdate() {
    inspectIdentityUpdate(
      this.getUpdate()
    );
  }
);

conversationSchema.pre(
  "updateMany",
  function rejectIdentityUpdate() {
    inspectIdentityUpdate(
      this.getUpdate()
    );
  }
);

conversationSchema.pre(
  "findOneAndUpdate",
  function rejectIdentityUpdate() {
    inspectIdentityUpdate(
      this.getUpdate()
    );
  }
);

// =============================================================================
// INDEXES
// =============================================================================

/**
 * Tenant + participants lookup.
 */
conversationSchema.index(
  {
    tenantId: 1,
    participants: 1,
    type: 1,
  },
  {
    name:
      "idx_conversation_tenant_participants_type",
  }
);

/**
 * Unique DM identity.
 *
 * Because participant arrays are ordered before creation, this prevents two
 * identical two-user DMs from being created concurrently within one tenant.
 */
conversationSchema.index(
  {
    tenantId: 1,
    type: 1,
    participants: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      type: "DM",
      isDeleted: false,
    },
    name:
      "uq_conversation_tenant_dm_participants",
  }
);

/**
 * Business entity lookup.
 */
conversationSchema.index(
  {
    tenantId: 1,
    linkedEntityType: 1,
    linkedEntityId: 1,
  },
  {
    sparse: true,
    name:
      "idx_conversation_tenant_linked_entity",
  }
);

/**
 * Tenant activity feed.
 */
conversationSchema.index(
  {
    tenantId: 1,
    status: 1,
    isDeleted: 1,
    lastActivityAt: -1,
  },
  {
    name:
      "idx_conversation_tenant_activity",
  }
);

/**
 * Creator lookup.
 */
conversationSchema.index(
  {
    tenantId: 1,
    createdBy: 1,
    createdAt: -1,
  },
  {
    name:
      "idx_conversation_tenant_creator_created",
  }
);

/**
 * Type/status lookup.
 */
conversationSchema.index(
  {
    tenantId: 1,
    type: 1,
    status: 1,
    lastActivityAt: -1,
  },
  {
    name:
      "idx_conversation_tenant_type_status_activity",
  }
);

/**
 * Announcement channels.
 */
conversationSchema.index(
  {
    tenantId: 1,
    isAnnouncementChannel: 1,
    status: 1,
    lastActivityAt: -1,
  },
  {
    name:
      "idx_conversation_tenant_announcements",
  }
);

/**
 * Deletion/archive operations.
 */
conversationSchema.index(
  {
    tenantId: 1,
    isDeleted: 1,
    deletedAt: 1,
  },
  {
    name:
      "idx_conversation_tenant_deleted",
  }
);

conversationSchema.index(
  {
    tenantId: 1,
    status: 1,
    archivedAt: -1,
  },
  {
    sparse: true,
    name:
      "idx_conversation_tenant_archived",
  }
);

// =============================================================================
// MODEL
// =============================================================================

const Conversation =
  mongoose.models.Conversation ||
  mongoose.model(
    "Conversation",
    conversationSchema
  );

export default Conversation;

export {
  CONVERSATION_TYPES,
  LINKED_ENTITY_TYPES,
  CONVERSATION_STATUSES,
};