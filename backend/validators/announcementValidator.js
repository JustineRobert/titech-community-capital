"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/validators/announcementValidator.js
 *
 * Purpose:
 *   Enterprise-grade validation and normalization for the TITech Community
 *   Capital announcement domain.
 *
 * Architectural Role
 * -----------------------------------------------------------------------------
 *
 * This module owns:
 *   - announcement request validation;
 *   - announcement payload normalization;
 *   - lifecycle-specific validation;
 *   - audience validation;
 *   - channel validation;
 *   - priority validation;
 *   - pagination validation;
 *   - publication/scheduling date validation;
 *   - metadata validation;
 *   - validation error formatting;
 *   - Express-compatible validation middleware.
 *
 * This module MUST NOT:
 *   - access MongoDB;
 *   - access Redis;
 *   - perform network I/O;
 *   - publish announcements;
 *   - schedule jobs;
 *   - send notifications;
 *   - mutate database records;
 *   - perform authorization;
 *   - perform tenant isolation;
 *   - perform business-side effects.
 *
 * Authorization belongs to the authorization layer.
 * Business rules belong to the announcement service.
 * Persistence belongs to repositories/models.
 *
 * =============================================================================
 * Supported Announcement Lifecycle
 * =============================================================================
 *
 *   draft
 *      ↓
 *   scheduled
 *      ↓
 *   published
 *      ↓
 *   archived
 *
 * Additional service-layer transitions may be permitted according to the
 * announcement lifecycle policy.
 *
 * =============================================================================
 * Design Principles
 * =============================================================================
 *
 * ✓ No database/network dependencies.
 * ✓ Safe for Express middleware.
 * ✓ Deterministic validation.
 * ✓ Explicit field allowlists.
 * ✓ Prototype-pollution protection.
 * ✓ Unicode-safe string handling.
 * ✓ Input normalization.
 * ✓ Strict date validation.
 * ✓ ISO-8601 timestamps.
 * ✓ Pagination limits.
 * ✓ Lifecycle-specific validation.
 * ✓ Tenant identifiers are never trusted from client payloads.
 * ✓ Authorization is intentionally outside this module.
 * ✓ Validation errors are structured and machine-readable.
 * ✓ No secrets are logged or retained.
 * ✓ No mutation of caller-owned objects.
 * ✓ Consistent TITech naming.
 *
 * =============================================================================
 */

/* =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const ANNOUNCEMENT_STATUSES = Object.freeze({
  DRAFT: "draft",
  SCHEDULED: "scheduled",
  PUBLISHED: "published",
  ARCHIVED: "archived",
});

const ANNOUNCEMENT_PRIORITIES = Object.freeze({
  LOW: "low",
  NORMAL: "normal",
  HIGH: "high",
  CRITICAL: "critical",
});

const ANNOUNCEMENT_AUDIENCES = Object.freeze({
  ALL: "all",
  TENANT: "tenant",
  MEMBERS: "members",
  ADMINS: "admins",
  MANAGERS: "managers",
  STAFF: "staff",
  CUSTOM: "custom",
});

const ANNOUNCEMENT_CHANNELS = Object.freeze({
  IN_APP: "in_app",
  EMAIL: "email",
  SMS: "sms",
  PUSH: "push",
});

const DEFAULT_PRIORITY =
  ANNOUNCEMENT_PRIORITIES.NORMAL;

const DEFAULT_PAGE =
  1;

const DEFAULT_LIMIT =
  20;

const MAX_LIMIT =
  100;

const MAX_PAGE =
  1000000;

const MAX_TITLE_LENGTH =
  200;

const MAX_BODY_LENGTH =
  10000;

const MAX_SUMMARY_LENGTH =
  500;

const MAX_AUTHOR_ID_LENGTH =
  200;

const MAX_TENANT_ID_LENGTH =
  200;

const MAX_AUDIENCE_MEMBER_IDS =
  10000;

const MAX_TAGS =
  50;

const MAX_TAG_LENGTH =
  100;

const MAX_CHANNELS =
  Object.values(
    ANNOUNCEMENT_CHANNELS,
  ).length;

const MAX_METADATA_KEYS =
  50;

const MAX_METADATA_STRING_LENGTH =
  1000;

const MAX_CURSOR_LENGTH =
  1000;

/**
 * Fields accepted by announcement write operations.
 *
 * IMPORTANT:
 *
 * tenantId, createdBy, updatedBy, publishedBy, archivedBy, etc. MUST NOT be
 * accepted as trusted client-controlled authorization attributes.
 *
 * Those values should be resolved by the authenticated request context and
 * service layer.
 */
const CREATE_FIELDS = Object.freeze([
  "title",
  "summary",
  "body",
  "priority",
  "audience",
  "audienceMemberIds",
  "channels",
  "scheduledAt",
  "expiresAt",
  "tags",
  "metadata",
]);

const UPDATE_FIELDS = Object.freeze([
  "title",
  "summary",
  "body",
  "priority",
  "audience",
  "audienceMemberIds",
  "channels",
  "scheduledAt",
  "expiresAt",
  "tags",
  "metadata",
]);

const SCHEDULE_FIELDS = Object.freeze([
  "scheduledAt",
  "expiresAt",
]);

const PUBLISH_FIELDS = Object.freeze([
  "expiresAt",
]);

const ARCHIVE_FIELDS = Object.freeze([
  "reason",
]);

const ALLOWED_METADATA_PRIMITIVES =
  new Set([
    "string",
    "number",
    "boolean",
  ]);

/**
 * Fields which are dangerous or should never be accepted from an HTTP body.
 *
 * This provides an additional defensive layer against accidental persistence
 * of security-sensitive or MongoDB/operator-style properties.
 */
const FORBIDDEN_FIELDS = new Set([
  "_id",
  "__v",
  "__proto__",
  "prototype",
  "constructor",

  "tenant",
  "tenantId",
  "organizationId",
  "organization",

  "createdBy",
  "updatedBy",
  "publishedBy",
  "archivedBy",

  "createdAt",
  "updatedAt",
  "publishedAt",
  "archivedAt",

  "status",

  "$where",
  "$expr",
  "$function",
  "$regex",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
  "$or",
  "$and",
]);

/* =============================================================================
 * ERROR CLASS
 * =============================================================================
 */

class AnnouncementValidationError extends Error {
  constructor(
    message,
    errors = [],
    options = {},
  ) {
    super(message);

    this.name =
      "AnnouncementValidationError";

    this.code =
      options.code ||
      "ANNOUNCEMENT_VALIDATION_ERROR";

    this.statusCode =
      Number.isInteger(
        options.statusCode,
      )
        ? options.statusCode
        : 400;

    this.errors =
      Array.isArray(errors)
        ? errors
        : [];

    Error.captureStackTrace?.(
      this,
      AnnouncementValidationError,
    );
  }
}

/* =============================================================================
 * BASIC HELPERS
 * =============================================================================
 */

function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(value);

  return (
    prototype ===
      Object.prototype ||
    prototype === null
  );
}

function isNonEmptyString(
  value,
) {
  return (
    typeof value ===
      "string" &&
    value.trim().length > 0
  );
}

function normalizeString(
  value,
) {
  if (
    typeof value !==
    "string"
  ) {
    return value;
  }

  return value
    .normalize("NFKC")
    .trim();
}

function normalizeNullableString(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  return normalizeString(
    value,
  );
}

function isInteger(value) {
  return (
    typeof value ===
      "number" &&
    Number.isInteger(value)
  );
}

function isFiniteNumber(
  value,
) {
  return (
    typeof value ===
      "number" &&
    Number.isFinite(value)
  );
}

function hasOwn(
  object,
  property,
) {
  return Object.prototype.hasOwnProperty.call(
    object,
    property,
  );
}

function uniqueArray(
  values,
) {
  return [
    ...new Set(values),
  ];
}

/* =============================================================================
 * ERROR HELPERS
 * =============================================================================
 */

function createValidationError(
  field,
  code,
  message,
  value,
) {
  const error = {
    field,
    code,
    message,
  };

  /**
   * Do not echo potentially sensitive or very large values into validation
   * responses.
   */
  if (
    value !== undefined &&
    value !== null &&
    typeof value !==
      "object"
  ) {
    const stringValue =
      String(value);

    if (
      stringValue.length <=
      200
    ) {
      error.value =
        stringValue;
    }
  }

  return error;
}

function addError(
  errors,
  field,
  code,
  message,
  value,
) {
  errors.push(
    createValidationError(
      field,
      code,
      message,
      value,
    ),
  );
}

/* =============================================================================
 * FORBIDDEN FIELD VALIDATION
 * =============================================================================
 */

function validateForbiddenFields(
  payload,
  errors,
) {
  Object.keys(
    payload,
  ).forEach(
    (field) => {
      if (
        FORBIDDEN_FIELDS.has(
          field,
        )
      ) {
        addError(
          errors,
          field,
          "FIELD_NOT_ALLOWED",
          `Field "${field}" is not accepted in an announcement request.`,
        );
      }

      /**
       * Reject MongoDB-style operator paths.
       */
      if (
        field.startsWith("$") ||
        field.includes(".")
      ) {
        addError(
          errors,
          field,
          "UNSAFE_FIELD",
          `Field "${field}" is not allowed.`,
        );
      }
    },
  );
}

/* =============================================================================
 * UNKNOWN FIELD VALIDATION
 * =============================================================================
 */

function validateAllowedFields(
  payload,
  allowedFields,
  errors,
) {
  const allowed =
    new Set(
      allowedFields,
    );

  Object.keys(
    payload,
  ).forEach(
    (field) => {
      if (
        !allowed.has(field)
      ) {
        addError(
          errors,
          field,
          "UNKNOWN_FIELD",
          `Unknown announcement field "${field}".`,
        );
      }
    },
  );
}

/* =============================================================================
 * TITLE VALIDATION
 * =============================================================================
 */

function validateTitle(
  value,
  errors,
  options = {},
) {
  const required =
    options.required === true;

  if (
    value === undefined ||
    value === null
  ) {
    if (required) {
      addError(
        errors,
        "title",
        "REQUIRED",
        "Announcement title is required.",
      );
    }

    return;
  }

  if (
    typeof value !==
    "string"
  ) {
    addError(
      errors,
      "title",
      "INVALID_TYPE",
      "Announcement title must be a string.",
    );

    return;
  }

  const normalized =
    normalizeString(value);

  if (
    normalized.length ===
    0
  ) {
    addError(
      errors,
      "title",
      "EMPTY",
      "Announcement title cannot be empty.",
    );

    return;
  }

  if (
    normalized.length >
    MAX_TITLE_LENGTH
  ) {
    addError(
      errors,
      "title",
      "MAX_LENGTH",
      `Announcement title must not exceed ${MAX_TITLE_LENGTH} characters.`,
    );
  }
}

/* =============================================================================
 * SUMMARY VALIDATION
 * =============================================================================
 */

function validateSummary(
  value,
  errors,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return;
  }

  if (
    typeof value !==
    "string"
  ) {
    addError(
      errors,
      "summary",
      "INVALID_TYPE",
      "Announcement summary must be a string.",
    );

    return;
  }

  const normalized =
    normalizeString(value);

  if (
    normalized.length >
    MAX_SUMMARY_LENGTH
  ) {
    addError(
      errors,
      "summary",
      "MAX_LENGTH",
      `Announcement summary must not exceed ${MAX_SUMMARY_LENGTH} characters.`,
    );
  }
}

/* =============================================================================
 * BODY VALIDATION
 * =============================================================================
 */

function validateBody(
  value,
  errors,
  options = {},
) {
  const required =
    options.required === true;

  if (
    value === undefined ||
    value === null
  ) {
    if (required) {
      addError(
        errors,
        "body",
        "REQUIRED",
        "Announcement body is required.",
      );
    }

    return;
  }

  if (
    typeof value !==
    "string"
  ) {
    addError(
      errors,
      "body",
      "INVALID_TYPE",
      "Announcement body must be a string.",
    );

    return;
  }

  const normalized =
    normalizeString(value);

  if (
    normalized.length ===
    0
  ) {
    addError(
      errors,
      "body",
      "EMPTY",
      "Announcement body cannot be empty.",
    );

    return;
  }

  if (
    normalized.length >
    MAX_BODY_LENGTH
  ) {
    addError(
      errors,
      "body",
      "MAX_LENGTH",
      `Announcement body must not exceed ${MAX_BODY_LENGTH} characters.`,
    );
  }
}

/* =============================================================================
 * PRIORITY VALIDATION
 * =============================================================================
 */

function validatePriority(
  value,
  errors,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return;
  }

  if (
    typeof value !==
    "string"
  ) {
    addError(
      errors,
      "priority",
      "INVALID_TYPE",
      "Announcement priority must be a string.",
    );

    return;
  }

  const normalized =
    normalizeString(
      value,
    ).toLowerCase();

  if (
    !Object.values(
      ANNOUNCEMENT_PRIORITIES,
    ).includes(
      normalized,
    )
  ) {
    addError(
      errors,
      "priority",
      "INVALID_VALUE",
      "Announcement priority must be one of: low, normal, high, critical.",
      value,
    );
  }
}

/* =============================================================================
 * AUDIENCE VALIDATION
 * =============================================================================
 */

function validateAudience(
  value,
  audienceMemberIds,
  errors,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return;
  }

  if (
    typeof value !==
    "string"
  ) {
    addError(
      errors,
      "audience",
      "INVALID_TYPE",
      "Announcement audience must be a string.",
    );

    return;
  }

  const normalized =
    normalizeString(
      value,
    ).toLowerCase();

  if (
    !Object.values(
      ANNOUNCEMENT_AUDIENCES,
    ).includes(
      normalized,
    )
  ) {
    addError(
      errors,
      "audience",
      "INVALID_VALUE",
      "Invalid announcement audience.",
      value,
    );

    return;
  }

  if (
    normalized ===
      ANNOUNCEMENT_AUDIENCES.CUSTOM &&
    !Array.isArray(
      audienceMemberIds,
    )
  ) {
    addError(
      errors,
      "audienceMemberIds",
      "REQUIRED_FOR_CUSTOM_AUDIENCE",
      "audienceMemberIds is required when audience is custom.",
    );
  }

  if (
    normalized !==
      ANNOUNCEMENT_AUDIENCES.CUSTOM &&
    audienceMemberIds !==
      undefined &&
    audienceMemberIds !==
      null &&
    Array.isArray(
      audienceMemberIds,
    ) &&
    audienceMemberIds.length >
      0
  ) {
    addError(
      errors,
      "audienceMemberIds",
      "NOT_ALLOWED_FOR_AUDIENCE",
      "audienceMemberIds may only be supplied when audience is custom.",
    );
  }
}

/* =============================================================================
 * AUDIENCE MEMBER IDS
 * =============================================================================
 */

function validateAudienceMemberIds(
  value,
  errors,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return;
  }

  if (
    !Array.isArray(value)
  ) {
    addError(
      errors,
      "audienceMemberIds",
      "INVALID_TYPE",
      "audienceMemberIds must be an array.",
    );

    return;
  }

  if (
    value.length >
    MAX_AUDIENCE_MEMBER_IDS
  ) {
    addError(
      errors,
      "audienceMemberIds",
      "MAX_ITEMS",
      `audienceMemberIds must not contain more than ${MAX_AUDIENCE_MEMBER_IDS} entries.`,
    );
  }

  const seen =
    new Set();

  value.forEach(
    (memberId, index) => {
      if (
        typeof memberId !==
        "string"
      ) {
        addError(
          errors,
          `audienceMemberIds[${index}]`,
          "INVALID_TYPE",
          "Audience member ID must be a string.",
        );

        return;
      }

      const normalized =
        normalizeString(
          memberId,
        );

      if (
        normalized.length ===
        0
      ) {
        addError(
          errors,
          `audienceMemberIds[${index}]`,
          "EMPTY",
          "Audience member ID cannot be empty.",
        );

        return;
      }

      if (
        normalized.length >
        MAX_AUTHOR_ID_LENGTH
      ) {
        addError(
          errors,
          `audienceMemberIds[${index}]`,
          "MAX_LENGTH",
          `Audience member ID must not exceed ${MAX_AUTHOR_ID_LENGTH} characters.`,
        );
      }

      if (
        seen.has(
          normalized,
        )
      ) {
        addError(
          errors,
          `audienceMemberIds[${index}]`,
          "DUPLICATE",
          "Duplicate audience member ID.",
        );
      }

      seen.add(
        normalized,
      );
    },
  );
}

/* =============================================================================
 * CHANNEL VALIDATION
 * =============================================================================
 */

function validateChannels(
  value,
  errors,
  options = {},
) {
  const required =
    options.required === true;

  if (
    value === undefined ||
    value === null
  ) {
    if (required) {
      addError(
        errors,
        "channels",
        "REQUIRED",
        "At least one announcement channel is required.",
      );
    }

    return;
  }

  if (
    !Array.isArray(value)
  ) {
    addError(
      errors,
      "channels",
      "INVALID_TYPE",
      "Announcement channels must be an array.",
    );

    return;
  }

  if (
    value.length ===
    0
  ) {
    addError(
      errors,
      "channels",
      "EMPTY",
      "At least one announcement channel is required.",
    );

    return;
  }

  if (
    value.length >
    MAX_CHANNELS
  ) {
    addError(
      errors,
      "channels",
      "MAX_ITEMS",
      `No more than ${MAX_CHANNELS} announcement channels may be supplied.`,
    );
  }

  const seen =
    new Set();

  value.forEach(
    (channel, index) => {
      if (
        typeof channel !==
        "string"
      ) {
        addError(
          errors,
          `channels[${index}]`,
          "INVALID_TYPE",
          "Announcement channel must be a string.",
        );

        return;
      }

      const normalized =
        normalizeString(
          channel,
        ).toLowerCase();

      if (
        !Object.values(
          ANNOUNCEMENT_CHANNELS,
        ).includes(
          normalized,
        )
      ) {
        addError(
          errors,
          `channels[${index}]`,
          "INVALID_VALUE",
          "Invalid announcement channel.",
          channel,
        );
      }

      if (
        seen.has(
          normalized,
        )
      ) {
        addError(
          errors,
          `channels[${index}]`,
          "DUPLICATE",
          "Duplicate announcement channel.",
        );
      }

      seen.add(
        normalized,
      );
    },
  );
}

/* =============================================================================
 * DATE VALIDATION
 * =============================================================================
 */

function parseDateValue(
  value,
) {
  if (
    value instanceof Date
  ) {
    if (
      Number.isNaN(
        value.getTime(),
      )
    ) {
      return null;
    }

    return value;
  }

  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  const normalized =
    value.trim();

  if (
    normalized.length ===
    0
  ) {
    return null;
  }

  /**
   * Require timezone information for timestamps.
   *
   * Accepted examples:
   *
   *   2026-08-30T10:00:00Z
   *   2026-08-30T10:00:00+03:00
   */
  const timezonePattern =
    /(Z|[+-]\d{2}:\d{2})$/i;

  if (
    !timezonePattern.test(
      normalized,
    )
  ) {
    return null;
  }

  const parsed =
    new Date(
      normalized,
    );

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    return null;
  }

  return parsed;
}

function validateDateField(
  field,
  value,
  errors,
  options = {},
) {
  const required =
    options.required === true;

  if (
    value === undefined ||
    value === null
  ) {
    if (required) {
      addError(
        errors,
        field,
        "REQUIRED",
        `${field} is required.`,
      );
    }

    return null;
  }

  if (
    typeof value !==
      "string" &&
    !(value instanceof Date)
  ) {
    addError(
      errors,
      field,
      "INVALID_TYPE",
      `${field} must be a valid ISO-8601 timestamp.`,
    );

    return null;
  }

  const parsed =
    parseDateValue(
      value,
    );

  if (!parsed) {
    addError(
      errors,
      field,
      "INVALID_DATE",
      `${field} must be a valid ISO-8601 timestamp including timezone information.`,
    );

    return null;
  }

  return parsed;
}

/* =============================================================================
 * DATE RELATIONSHIP VALIDATION
 * =============================================================================
 */

function validateDateRelationships(
  payload,
  errors,
  options = {},
) {
  const nowValue =
    options.now instanceof Date
      ? options.now
      : new Date();

  const scheduledAt =
    parseDateValue(
      payload.scheduledAt,
    );

  const expiresAt =
    parseDateValue(
      payload.expiresAt,
    );

  if (
    scheduledAt &&
    expiresAt &&
    expiresAt.getTime() <=
      scheduledAt.getTime()
  ) {
    addError(
      errors,
      "expiresAt",
      "INVALID_RANGE",
      "expiresAt must be later than scheduledAt.",
    );
  }

  if (
    options.requireFutureSchedule ===
      true &&
    scheduledAt &&
    scheduledAt.getTime() <=
      nowValue.getTime()
  ) {
    addError(
      errors,
      "scheduledAt",
      "MUST_BE_FUTURE",
      "scheduledAt must be in the future.",
    );
  }

  if (
    options.requireFutureExpiry ===
      true &&
    expiresAt &&
    expiresAt.getTime() <=
      nowValue.getTime()
  ) {
    addError(
      errors,
      "expiresAt",
      "MUST_BE_FUTURE",
      "expiresAt must be in the future.",
    );
  }
}

/* =============================================================================
 * TAG VALIDATION
 * =============================================================================
 */

function validateTags(
  value,
  errors,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return;
  }

  if (
    !Array.isArray(value)
  ) {
    addError(
      errors,
      "tags",
      "INVALID_TYPE",
      "Announcement tags must be an array.",
    );

    return;
  }

  if (
    value.length >
    MAX_TAGS
  ) {
    addError(
      errors,
      "tags",
      "MAX_ITEMS",
      `An announcement may contain at most ${MAX_TAGS} tags.`,
    );
  }

  const seen =
    new Set();

  value.forEach(
    (tag, index) => {
      if (
        typeof tag !==
        "string"
      ) {
        addError(
          errors,
          `tags[${index}]`,
          "INVALID_TYPE",
          "Announcement tag must be a string.",
        );

        return;
      }

      const normalized =
        normalizeString(
          tag,
        );

      if (
        normalized.length ===
        0
      ) {
        addError(
          errors,
          `tags[${index}]`,
          "EMPTY",
          "Announcement tag cannot be empty.",
        );

        return;
      }

      if (
        normalized.length >
        MAX_TAG_LENGTH
      ) {
        addError(
          errors,
          `tags[${index}]`,
          "MAX_LENGTH",
          `Announcement tag must not exceed ${MAX_TAG_LENGTH} characters.`,
        );
      }

      const comparisonKey =
        normalized.toLowerCase();

      if (
        seen.has(
          comparisonKey,
        )
      ) {
        addError(
          errors,
          `tags[${index}]`,
          "DUPLICATE",
          "Duplicate announcement tag.",
        );
      }

      seen.add(
        comparisonKey,
      );
    },
  );
}

/* =============================================================================
 * METADATA VALIDATION
 * =============================================================================
 */

function validateMetadata(
  value,
  errors,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return;
  }

  if (
    !isPlainObject(value)
  ) {
    addError(
      errors,
      "metadata",
      "INVALID_TYPE",
      "Announcement metadata must be a plain object.",
    );

    return;
  }

  const keys =
    Object.keys(value);

  if (
    keys.length >
    MAX_METADATA_KEYS
  ) {
    addError(
      errors,
      "metadata",
      "MAX_KEYS",
      `Announcement metadata must not contain more than ${MAX_METADATA_KEYS} keys.`,
    );
  }

  keys.forEach(
    (key) => {
      if (
        key.startsWith("$") ||
        key.includes(".") ||
        FORBIDDEN_FIELDS.has(
          key,
        )
      ) {
        addError(
          errors,
          `metadata.${key}`,
          "UNSAFE_KEY",
          `Metadata key "${key}" is not allowed.`,
        );

        return;
      }

      const metadataValue =
        value[key];

      if (
        metadataValue ===
        null
      ) {
        return;
      }

      if (
        !ALLOWED_METADATA_PRIMITIVES.has(
          typeof metadataValue,
        )
      ) {
        addError(
          errors,
          `metadata.${key}`,
          "INVALID_VALUE_TYPE",
          "Metadata values must be strings, numbers, booleans, or null.",
        );

        return;
      }

      if (
        typeof metadataValue ===
        "string" &&
        metadataValue.length >
          MAX_METADATA_STRING_LENGTH
      ) {
        addError(
          errors,
          `metadata.${key}`,
          "MAX_LENGTH",
          `Metadata string values must not exceed ${MAX_METADATA_STRING_LENGTH} characters.`,
        );
      }

      if (
        typeof metadataValue ===
          "number" &&
        !Number.isFinite(
          metadataValue,
        )
      ) {
        addError(
          errors,
          `metadata.${key}`,
          "INVALID_NUMBER",
          "Metadata numeric values must be finite.",
        );
      }
    },
  );
}

/* =============================================================================
 * REASON VALIDATION
 * =============================================================================
 */

function validateReason(
  value,
  errors,
  options = {},
) {
  const required =
    options.required === true;

  if (
    value === undefined ||
    value === null
  ) {
    if (required) {
      addError(
        errors,
        "reason",
        "REQUIRED",
        "A reason is required.",
      );
    }

    return;
  }

  if (
    typeof value !==
    "string"
  ) {
    addError(
      errors,
      "reason",
      "INVALID_TYPE",
      "Reason must be a string.",
    );

    return;
  }

  const normalized =
    normalizeString(value);

  if (
    normalized.length ===
    0
  ) {
    addError(
      errors,
      "reason",
      "EMPTY",
      "Reason cannot be empty.",
    );
  }

  if (
    normalized.length >
    MAX_SUMMARY_LENGTH
  ) {
    addError(
      errors,
      "reason",
      "MAX_LENGTH",
      `Reason must not exceed ${MAX_SUMMARY_LENGTH} characters.`,
    );
  }
}

/* =============================================================================
 * CREATE VALIDATION
 * =============================================================================
 */

function validateCreateAnnouncement(
  payload,
  options = {},
) {
  const errors = [];

  if (
    !isPlainObject(payload)
  ) {
    throw new AnnouncementValidationError(
      "Announcement request body must be a plain object.",
      [
        createValidationError(
          "body",
          "INVALID_BODY",
          "Announcement request body must be a plain object.",
        ),
      ],
    );
  }

  validateForbiddenFields(
    payload,
    errors,
  );

  validateAllowedFields(
    payload,
    CREATE_FIELDS,
    errors,
  );

  validateTitle(
    payload.title,
    errors,
    {
      required: true,
    },
  );

  validateSummary(
    payload.summary,
    errors,
  );

  validateBody(
    payload.body,
    errors,
    {
      required: true,
    },
  );

  validatePriority(
    payload.priority,
    errors,
  );

  validateAudience(
    payload.audience,
    payload.audienceMemberIds,
    errors,
  );

  validateAudienceMemberIds(
    payload.audienceMemberIds,
    errors,
  );

  validateChannels(
    payload.channels,
    errors,
    {
      required: true,
    },
  );

  validateDateField(
    "scheduledAt",
    payload.scheduledAt,
    errors,
  );

  validateDateField(
    "expiresAt",
    payload.expiresAt,
    errors,
  );

  validateDateRelationships(
    payload,
    errors,
    {
      requireFutureSchedule:
        options.requireFutureSchedule ===
        true,
      requireFutureExpiry:
        options.requireFutureExpiry ===
        true,
      now:
        options.now,
    },
  );

  validateTags(
    payload.tags,
    errors,
  );

  validateMetadata(
    payload.metadata,
    errors,
  );

  if (
    errors.length > 0
  ) {
    throw new AnnouncementValidationError(
      "Announcement request validation failed.",
      errors,
    );
  }

  return normalizeAnnouncementPayload(
    payload,
  );
}

/* =============================================================================
 * UPDATE VALIDATION
 * =============================================================================
 */

function validateUpdateAnnouncement(
  payload,
) {
  const errors = [];

  if (
    !isPlainObject(payload)
  ) {
    throw new AnnouncementValidationError(
      "Announcement update body must be a plain object.",
      [
        createValidationError(
          "body",
          "INVALID_BODY",
          "Announcement update body must be a plain object.",
        ),
      ],
    );
  }

  validateForbiddenFields(
    payload,
    errors,
  );

  validateAllowedFields(
    payload,
    UPDATE_FIELDS,
    errors,
  );

  /**
   * PATCH semantics:
   *
   * At least one mutable field must be supplied.
   */
  if (
    Object.keys(payload).length ===
    0
  ) {
    addError(
      errors,
      "body",
      "EMPTY_UPDATE",
      "At least one announcement field must be supplied for update.",
    );
  }

  if (
    hasOwn(payload, "title")
  ) {
    validateTitle(
      payload.title,
      errors,
    );
  }

  if (
    hasOwn(payload, "summary")
  ) {
    validateSummary(
      payload.summary,
      errors,
    );
  }

  if (
    hasOwn(payload, "body")
  ) {
    validateBody(
      payload.body,
      errors,
    );
  }

  if (
    hasOwn(payload, "priority")
  ) {
    validatePriority(
      payload.priority,
      errors,
    );
  }

  if (
    hasOwn(payload, "audience")
  ) {
    validateAudience(
      payload.audience,
      payload.audienceMemberIds,
      errors,
    );
  }

  if (
    hasOwn(
      payload,
      "audienceMemberIds",
    )
  ) {
    validateAudienceMemberIds(
      payload.audienceMemberIds,
      errors,
    );
  }

  if (
    hasOwn(payload, "channels")
  ) {
    validateChannels(
      payload.channels,
      errors,
      {
        required: true,
      },
    );
  }

  if (
    hasOwn(
      payload,
      "scheduledAt",
    )
  ) {
    validateDateField(
      "scheduledAt",
      payload.scheduledAt,
      errors,
    );
  }

  if (
    hasOwn(
      payload,
      "expiresAt",
    )
  ) {
    validateDateField(
      "expiresAt",
      payload.expiresAt,
      errors,
    );
  }

  if (
    hasOwn(payload, "tags")
  ) {
    validateTags(
      payload.tags,
      errors,
    );
  }

  if (
    hasOwn(
      payload,
      "metadata",
    )
  ) {
    validateMetadata(
      payload.metadata,
      errors,
    );
  }

  validateDateRelationships(
    payload,
    errors,
  );

  if (
    errors.length > 0
  ) {
    throw new AnnouncementValidationError(
      "Announcement update validation failed.",
      errors,
    );
  }

  return normalizeAnnouncementPayload(
    payload,
  );
}

/* =============================================================================
 * SCHEDULE VALIDATION
 * =============================================================================
 */

function validateScheduleAnnouncement(
  payload,
  options = {},
) {
  const errors = [];

  if (
    !isPlainObject(payload)
  ) {
    throw new AnnouncementValidationError(
      "Schedule request body must be a plain object.",
      [
        createValidationError(
          "body",
          "INVALID_BODY",
          "Schedule request body must be a plain object.",
        ),
      ],
    );
  }

  validateForbiddenFields(
    payload,
    errors,
  );

  validateAllowedFields(
    payload,
    SCHEDULE_FIELDS,
    errors,
  );

  validateDateField(
    "scheduledAt",
    payload.scheduledAt,
    errors,
    {
      required: true,
    },
  );

  validateDateField(
    "expiresAt",
    payload.expiresAt,
    errors,
  );

  validateDateRelationships(
    payload,
    errors,
    {
      requireFutureSchedule:
        true,
      requireFutureExpiry:
        false,
      now:
        options.now,
    },
  );

  if (
    errors.length > 0
  ) {
    throw new AnnouncementValidationError(
      "Announcement scheduling validation failed.",
      errors,
    );
  }

  return normalizeAnnouncementPayload(
    payload,
  );
}

/* =============================================================================
 * PUBLISH VALIDATION
 * =============================================================================
 */

function validatePublishAnnouncement(
  payload = {},
) {
  const errors = [];

  if (
    !isPlainObject(payload)
  ) {
    throw new AnnouncementValidationError(
      "Publish request body must be a plain object.",
      [
        createValidationError(
          "body",
          "INVALID_BODY",
          "Publish request body must be a plain object.",
        ),
      ],
    );
  }

  validateForbiddenFields(
    payload,
    errors,
  );

  validateAllowedFields(
    payload,
    PUBLISH_FIELDS,
    errors,
  );

  if (
    hasOwn(
      payload,
      "expiresAt",
    )
  ) {
    validateDateField(
      "expiresAt",
      payload.expiresAt,
      errors,
      {
        required: true,
      },
    );

    validateDateRelationships(
      payload,
      errors,
      {
        requireFutureExpiry:
          true,
      },
    );
  }

  if (
    errors.length > 0
  ) {
    throw new AnnouncementValidationError(
      "Announcement publication validation failed.",
      errors,
    );
  }

  return normalizeAnnouncementPayload(
    payload,
  );
}

/* =============================================================================
 * ARCHIVE VALIDATION
 * =============================================================================
 */

function validateArchiveAnnouncement(
  payload = {},
) {
  const errors = [];

  if (
    !isPlainObject(payload)
  ) {
    throw new AnnouncementValidationError(
      "Archive request body must be a plain object.",
      [
        createValidationError(
          "body",
          "INVALID_BODY",
          "Archive request body must be a plain object.",
        ),
      ],
    );
  }

  validateForbiddenFields(
    payload,
    errors,
  );

  validateAllowedFields(
    payload,
    ARCHIVE_FIELDS,
    errors,
  );

  if (
    hasOwn(
      payload,
      "reason",
    )
  ) {
    validateReason(
      payload.reason,
      errors,
    );
  }

  if (
    errors.length > 0
  ) {
    throw new AnnouncementValidationError(
      "Announcement archive validation failed.",
      errors,
    );
  }

  return normalizeAnnouncementPayload(
    payload,
  );
}

/* =============================================================================
 * PAGINATION VALIDATION
 * =============================================================================
 */

function validatePagination(
  query = {},
) {
  const errors = [];

  if (
    !isPlainObject(query)
  ) {
    throw new AnnouncementValidationError(
      "Pagination query must be a plain object.",
      [
        createValidationError(
          "query",
          "INVALID_QUERY",
          "Pagination query must be a plain object.",
        ),
      ],
    );
  }

  let page =
    DEFAULT_PAGE;

  let limit =
    DEFAULT_LIMIT;

  let cursor =
    undefined;

  if (
    query.page !==
      undefined &&
    query.page !==
      null
  ) {
    const rawPage =
      String(
        query.page,
      ).trim();

    if (
      !/^\d+$/.test(
        rawPage,
      )
    ) {
      addError(
        errors,
        "page",
        "INVALID_INTEGER",
        "page must be a positive integer.",
      );
    } else {
      page =
        Number(
          rawPage,
        );

      if (
        page < 1 ||
        page > MAX_PAGE
      ) {
        addError(
          errors,
          "page",
          "OUT_OF_RANGE",
          `page must be between 1 and ${MAX_PAGE}.`,
        );
      }
    }
  }

  if (
    query.limit !==
      undefined &&
    query.limit !==
      null
  ) {
    const rawLimit =
      String(
        query.limit,
      ).trim();

    if (
      !/^\d+$/.test(
        rawLimit,
      )
    ) {
      addError(
        errors,
        "limit",
        "INVALID_INTEGER",
        "limit must be a positive integer.",
      );
    } else {
      limit =
        Number(
          rawLimit,
        );

      if (
        limit < 1 ||
        limit > MAX_LIMIT
      ) {
        addError(
          errors,
          "limit",
          "OUT_OF_RANGE",
          `limit must be between 1 and ${MAX_LIMIT}.`,
        );
      }
    }
  }

  if (
    query.cursor !==
      undefined &&
    query.cursor !==
      null
  ) {
    if (
      typeof query.cursor !==
      "string"
    ) {
      addError(
        errors,
        "cursor",
        "INVALID_TYPE",
        "cursor must be a string.",
      );
    } else {
      cursor =
        query.cursor.trim();

      if (
        cursor.length ===
        0
      ) {
        addError(
          errors,
          "cursor",
          "EMPTY",
          "cursor cannot be empty.",
        );
      }

      if (
        cursor.length >
        MAX_CURSOR_LENGTH
      ) {
        addError(
          errors,
          "cursor",
          "MAX_LENGTH",
          `cursor must not exceed ${MAX_CURSOR_LENGTH} characters.`,
        );
      }
    }
  }

  /**
   * Cursor pagination and page pagination should not be mixed.
   */
  if (
    cursor !==
      undefined &&
    (
      query.page !==
        undefined ||
      query.limit !==
        undefined
    )
  ) {
    addError(
      errors,
      "pagination",
      "MIXED_MODES",
      "Cursor pagination cannot be combined with page pagination.",
    );
  }

  if (
    errors.length > 0
  ) {
    throw new AnnouncementValidationError(
      "Announcement pagination validation failed.",
      errors,
    );
  }

  return {
    page,
    limit,
    cursor,
  };
}

/* =============================================================================
 * FILTER VALIDATION
 * =============================================================================
 */

function validateAnnouncementFilters(
  query = {},
) {
  const errors = [];

  if (
    !isPlainObject(query)
  ) {
    throw new AnnouncementValidationError(
      "Announcement filter query must be a plain object.",
      [
        createValidationError(
          "query",
          "INVALID_QUERY",
          "Announcement filter query must be a plain object.",
        ),
      ],
    );
  }

  if (
    query.status !==
      undefined &&
    query.status !==
      null
  ) {
    const statuses =
      Array.isArray(
        query.status,
      )
        ? query.status
        : [
            query.status,
          ];

    statuses.forEach(
      (status, index) => {
        const normalized =
          normalizeString(
            String(
              status,
            ),
          ).toLowerCase();

        if (
          !Object.values(
            ANNOUNCEMENT_STATUSES,
          ).includes(
            normalized,
          )
        ) {
          addError(
            errors,
            `status[${index}]`,
            "INVALID_VALUE",
            "Invalid announcement status.",
          );
        }
      },
    );
  }

  if (
    query.priority !==
      undefined &&
    query.priority !==
      null
  ) {
    const priorities =
      Array.isArray(
        query.priority,
      )
        ? query.priority
        : [
            query.priority,
          ];

    priorities.forEach(
      (priority, index) => {
        const normalized =
          normalizeString(
            String(
              priority,
            ),
          ).toLowerCase();

        if (
          !Object.values(
            ANNOUNCEMENT_PRIORITIES,
          ).includes(
            normalized,
          )
        ) {
          addError(
            errors,
            `priority[${index}]`,
            "INVALID_VALUE",
            "Invalid announcement priority.",
          );
        }
      },
    );
  }

  if (
    query.audience !==
      undefined &&
    query.audience !==
      null
  ) {
    const audiences =
      Array.isArray(
        query.audience,
      )
        ? query.audience
        : [
            query.audience,
          ];

    audiences.forEach(
      (audience, index) => {
        const normalized =
          normalizeString(
            String(
              audience,
            ),
          ).toLowerCase();

        if (
          !Object.values(
            ANNOUNCEMENT_AUDIENCES,
          ).includes(
            normalized,
          )
        ) {
          addError(
            errors,
            `audience[${index}]`,
            "INVALID_VALUE",
            "Invalid announcement audience.",
          );
        }
      },
    );
  }

  if (
    errors.length > 0
  ) {
    throw new AnnouncementValidationError(
      "Announcement filter validation failed.",
      errors,
    );
  }

  return normalizeFilterQuery(
    query,
  );
}

/* =============================================================================
 * NORMALIZATION
 * =============================================================================
 */

function normalizeAnnouncementPayload(
  payload,
) {
  if (
    !isPlainObject(payload)
  ) {
    return payload;
  }

  const normalized = {};

  Object.keys(
    payload,
  ).forEach(
    (field) => {
      const value =
        payload[field];

      switch (field) {
        case "title":
        case "summary":
        case "body":
        case "priority":
        case "audience":
        case "scheduledAt":
        case "expiresAt":
        case "reason":
          if (
            value === null
          ) {
            normalized[field] =
              null;
          } else if (
            value instanceof Date
          ) {
            normalized[field] =
              value.toISOString();
          } else if (
            typeof value ===
            "string"
          ) {
            const stringValue =
              normalizeString(
                value,
              );

            if (
              field ===
                "priority" ||
              field ===
                "audience"
            ) {
              normalized[field] =
                stringValue.toLowerCase();
            } else {
              normalized[field] =
                stringValue;
            }
          } else {
            normalized[field] =
              value;
          }

          break;

        case "channels":
          normalized[field] =
            Array.isArray(value)
              ? uniqueArray(
                  value.map(
                    (channel) =>
                      typeof channel ===
                      "string"
                        ? normalizeString(
                            channel,
                          ).toLowerCase()
                        : channel,
                  ),
                )
              : value;

          break;

        case "audienceMemberIds":
          normalized[field] =
            Array.isArray(value)
              ? uniqueArray(
                  value.map(
                    (memberId) =>
                      typeof memberId ===
                      "string"
                        ? normalizeString(
                            memberId,
                          )
                        : memberId,
                  ),
                )
              : value;

          break;

        case "tags":
          normalized[field] =
            Array.isArray(value)
              ? uniqueArray(
                  value
                    .map(
                      (tag) =>
                        typeof tag ===
                        "string"
                          ? normalizeString(
                              tag,
                            )
                          : tag,
                    )
                    .filter(
                      Boolean,
                    ),
                )
              : value;

          break;

        case "metadata":
          normalized[field] =
            isPlainObject(
              value,
            )
              ? {
                  ...value,
                }
              : value;

          break;

        default:
          normalized[field] =
            value;
      }
    },
  );

  return normalized;
}

function normalizeFilterQuery(
  query,
) {
  const normalized = {
    ...query,
  };

  if (
    query.status !==
      undefined &&
    query.status !==
      null
  ) {
    normalized.status =
      (
        Array.isArray(
          query.status,
        )
          ? query.status
          : [
              query.status,
            ]
      ).map(
        (value) =>
          normalizeString(
            String(value),
          ).toLowerCase(),
      );
  }

  if (
    query.priority !==
      undefined &&
    query.priority !==
      null
  ) {
    normalized.priority =
      (
        Array.isArray(
          query.priority,
        )
          ? query.priority
          : [
              query.priority,
            ]
      ).map(
        (value) =>
          normalizeString(
            String(value),
          ).toLowerCase(),
      );
  }

  if (
    query.audience !==
      undefined &&
    query.audience !==
      null
  ) {
    normalized.audience =
      (
        Array.isArray(
          query.audience,
        )
          ? query.audience
          : [
              query.audience,
            ]
      ).map(
        (value) =>
          normalizeString(
            String(value),
          ).toLowerCase(),
      );
  }

  return normalized;
}

/* =============================================================================
 * GENERIC VALIDATION DISPATCHER
 * =============================================================================
 */

function validateAnnouncement(
  payload,
  options = {},
) {
  const operation =
    String(
      options.operation ||
        "create",
    )
      .trim()
      .toLowerCase();

  switch (operation) {
    case "create":
      return validateCreateAnnouncement(
        payload,
        options,
      );

    case "update":
      return validateUpdateAnnouncement(
        payload,
      );

    case "schedule":
      return validateScheduleAnnouncement(
        payload,
        options,
      );

    case "publish":
      return validatePublishAnnouncement(
        payload,
      );

    case "archive":
      return validateArchiveAnnouncement(
        payload,
      );

    default:
      throw new AnnouncementValidationError(
        `Unsupported announcement validation operation "${operation}".`,
        [
          createValidationError(
            "operation",
            "UNSUPPORTED_OPERATION",
            "Unsupported announcement validation operation.",
          ),
        ],
      );
  }
}

/* =============================================================================
 * EXPRESS MIDDLEWARE FACTORY
 * =============================================================================
 */

/**
 * Creates Express middleware which validates req.body and replaces it with
 * a normalized, validated copy.
 *
 * Example:
 *
 *   router.post(
 *     "/",
 *     validateAnnouncementBody("create"),
 *     announcementController.create,
 *   );
 */
function validateAnnouncementBody(
  operation = "create",
  options = {},
) {
  return function announcementBodyValidator(
    req,
    res,
    next,
  ) {
    try {
      req.body =
        validateAnnouncement(
          req.body || {},
          {
            ...options,
            operation,
          },
        );

      return next();
    } catch (error) {
      if (
        error instanceof
        AnnouncementValidationError
      ) {
        return res.status(
          error.statusCode,
        ).json({
          success:
            false,

          error: {
            code:
              error.code,

            message:
              error.message,

            details:
              error.errors,
          },
        });
      }

      return next(
        error,
      );
    }
  };
}

/**
 * Express middleware for announcement list pagination.
 */
function validateAnnouncementPagination(
  req,
  res,
  next,
) {
  try {
    req.pagination =
      validatePagination(
        req.query || {},
      );

    return next();
  } catch (error) {
    if (
      error instanceof
      AnnouncementValidationError
    ) {
      return res.status(
        error.statusCode,
      ).json({
        success:
          false,

        error: {
          code:
            error.code,

          message:
            error.message,

          details:
            error.errors,
        },
      });
    }

    return next(
      error,
    );
  }
}

/**
 * Express middleware for announcement filters.
 */
function validateAnnouncementQuery(
  req,
  res,
  next,
) {
  try {
    req.announcementFilters =
      validateAnnouncementFilters(
        req.query || {},
      );

    return next();
  } catch (error) {
    if (
      error instanceof
      AnnouncementValidationError
    ) {
      return res.status(
        error.statusCode,
      ).json({
        success:
          false,

        error: {
          code:
            error.code,

          message:
            error.message,

          details:
            error.errors,
        },
      });
    }

    return next(
      error,
    );
  }
}

/**
 * Combined list validation middleware.
 *
 * This keeps pagination and filters independently reusable while providing
 * a convenient production route-level middleware.
 */
function validateAnnouncementListQuery(
  req,
  res,
  next,
) {
  try {
    req.pagination =
      validatePagination(
        req.query || {},
      );

    req.announcementFilters =
      validateAnnouncementFilters(
        req.query || {},
      );

    return next();
  } catch (error) {
    if (
      error instanceof
      AnnouncementValidationError
    ) {
      return res.status(
        error.statusCode,
      ).json({
        success:
          false,

        error: {
          code:
            error.code,

          message:
            error.message,

          details:
            error.errors,
        },
      });
    }

    return next(
      error,
    );
  }
}

/* =============================================================================
 * VALIDATION RESULT HELPERS
 * =============================================================================
 */

function isValidationError(
  error,
) {
  return (
    error instanceof
    AnnouncementValidationError
  );
}

function validateSafely(
  payload,
  options = {},
) {
  try {
    const value =
      validateAnnouncement(
        payload,
        options,
      );

    return {
      valid:
        true,

      value,

      errors:
        [],
    };
  } catch (error) {
    if (
      error instanceof
      AnnouncementValidationError
    ) {
      return {
        valid:
          false,

        value:
          null,

        errors:
          error.errors,
      };
    }

    throw error;
  }
}

/* =============================================================================
 * PUBLIC API
 * =============================================================================
 */

module.exports = {
  /* Constants */
  ANNOUNCEMENT_STATUSES,

  ANNOUNCEMENT_PRIORITIES,

  ANNOUNCEMENT_AUDIENCES,

  ANNOUNCEMENT_CHANNELS,

  DEFAULT_PRIORITY,

  DEFAULT_PAGE,

  DEFAULT_LIMIT,

  MAX_LIMIT,

  MAX_PAGE,

  MAX_TITLE_LENGTH,

  MAX_BODY_LENGTH,

  MAX_SUMMARY_LENGTH,

  MAX_AUDIENCE_MEMBER_IDS,

  MAX_TAGS,

  MAX_TAG_LENGTH,

  MAX_CHANNELS,

  MAX_METADATA_KEYS,

  MAX_METADATA_STRING_LENGTH,

  MAX_CURSOR_LENGTH,

  CREATE_FIELDS,

  UPDATE_FIELDS,

  SCHEDULE_FIELDS,

  PUBLISH_FIELDS,

  ARCHIVE_FIELDS,

  FORBIDDEN_FIELDS,

  /* Error */
  AnnouncementValidationError,

  /* Core validators */
  validateAnnouncement,

  validateCreateAnnouncement,

  validateUpdateAnnouncement,

  validateScheduleAnnouncement,

  validatePublishAnnouncement,

  validateArchiveAnnouncement,

  validateAnnouncementFilters,

  validatePagination,

  /* Normalization */
  normalizeAnnouncementPayload,

  normalizeFilterQuery,

  /* Express middleware */
  validateAnnouncementBody,

  validateAnnouncementPagination,

  validateAnnouncementQuery,

  validateAnnouncementListQuery,

  /* Utility */
  isValidationError,

  validateSafely,
};