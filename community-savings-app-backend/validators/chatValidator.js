"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/validators/chatValidator.js
 *
 * Purpose:
 *   Enterprise production-grade validation and normalization utilities for
 *   TITech Community Capital chat operations.
 *
 * Responsibilities:
 *   - Validate chat request payloads.
 *   - Normalize user-controlled input.
 *   - Enforce message length and structural constraints.
 *   - Validate conversation identifiers.
 *   - Validate pagination parameters.
 *   - Validate message metadata where supplied.
 *   - Prevent malformed/null-prototype payloads from reaching services.
 *   - Return deterministic, API-friendly validation errors.
 *
 * Architectural Principles:
 *   - Validation is deterministic and side-effect free.
 *   - No database access.
 *   - No Redis access.
 *   - No network I/O.
 *   - No authentication or authorization decisions.
 *   - No tenant lookup.
 *   - No persistence.
 *   - No Express application mutation.
 *   - No secrets are logged or retained.
 *   - Validation does not trust client-provided identity fields.
 *
 * IMPORTANT:
 *   Authentication, authorization, tenant membership, conversation ownership,
 *   moderation, rate limiting, and persistence MUST be handled by the relevant
 *   middleware/service layers.
 *
 * =============================================================================
 */

/* =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const CHAT_LIMITS = Object.freeze({
  MIN_MESSAGE_LENGTH: 1,

  MAX_MESSAGE_LENGTH: 10000,

  MAX_TITLE_LENGTH: 200,

  MAX_CONVERSATION_ID_LENGTH: 128,

  MAX_MESSAGE_ID_LENGTH: 128,

  MAX_CLIENT_MESSAGE_ID_LENGTH: 128,

  MAX_MODEL_LENGTH: 100,

  MAX_ROLE_LENGTH: 32,

  MAX_METADATA_KEYS: 50,

  MAX_METADATA_KEY_LENGTH: 100,

  MAX_METADATA_VALUE_LENGTH: 2000,

  MAX_ATTACHMENTS: 10,

  MAX_ATTACHMENT_ID_LENGTH: 128,

  MAX_PAGE: 1000000,

  DEFAULT_PAGE: 1,

  DEFAULT_LIMIT: 50,

  MAX_LIMIT: 100,

  MIN_LIMIT: 1,

  DEFAULT_CURSOR_LENGTH: 200,

  MAX_CURSOR_LENGTH: 500,

  MAX_SEARCH_LENGTH: 200,

  MAX_SYSTEM_PROMPT_LENGTH: 10000,
});

/* =============================================================================
 * ENUMS
 * =============================================================================
 */

const CHAT_ROLES = Object.freeze([
  "user",
  "assistant",
  "system",
]);

const CHAT_MESSAGE_TYPES = Object.freeze([
  "text",
  "system",
]);

const PAGINATION_SORT_DIRECTIONS =
  Object.freeze([
    "asc",
    "desc",
  ]);

/* =============================================================================
 * VALIDATION RESULT FACTORIES
 * =============================================================================
 */

function createValidationError(
  field,
  message,
  code = "VALIDATION_ERROR",
) {
  return {
    field,
    message,
    code,
  };
}

function createSuccess(
  value,
) {
  return {
    valid: true,
    value,
    errors: [],
  };
}

function createFailure(
  errors,
) {
  return {
    valid: false,
    value: null,
    errors: Array.isArray(errors)
      ? errors
      : [errors],
  };
}

/* =============================================================================
 * TYPE HELPERS
 * =============================================================================
 */

function isPlainObject(
  value,
) {
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
    typeof value === "string" &&
    value.trim().length > 0
  );
}

/* =============================================================================
 * STRING NORMALIZATION
 * =============================================================================
 */

/**
 * Normalize Unicode whitespace and remove control characters that are not
 * appropriate for ordinary chat text.
 *
 * Newlines, tabs and carriage returns are intentionally preserved because
 * multiline chat messages are valid.
 */
function normalizeText(
  value,
) {
  if (
    typeof value !== "string"
  ) {
    return value;
  }

  return value
    .replace(/\u0000/g, "")
    .replace(
      /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
      "",
    )
    .replace(
      /\r\n/g,
      "\n",
    )
    .replace(
      /\r/g,
      "\n",
    )
    .trim();
}

function normalizeIdentifier(
  value,
) {
  if (
    typeof value !== "string"
  ) {
    return value;
  }

  return value.trim();
}

/* =============================================================================
 * IDENTIFIER VALIDATION
 * =============================================================================
 */

function validateIdentifier(
  value,
  {
    field = "id",
    required = false,
    maxLength = CHAT_LIMITS.MAX_MESSAGE_ID_LENGTH,
  } = {},
) {
  if (
    value === undefined ||
    value === null
  ) {
    if (required) {
      return createValidationError(
        field,
        `${field} is required.`,
        "REQUIRED",
      );
    }

    return null;
  }

  if (
    typeof value !== "string"
  ) {
    return createValidationError(
      field,
      `${field} must be a string.`,
      "INVALID_TYPE",
    );
  }

  const normalized =
    normalizeIdentifier(value);

  if (
    normalized.length === 0
  ) {
    return createValidationError(
      field,
      `${field} cannot be empty.`,
      "EMPTY_VALUE",
    );
  }

  if (
    normalized.length >
    maxLength
  ) {
    return createValidationError(
      field,
      `${field} must not exceed ${maxLength} characters.`,
      "MAX_LENGTH",
    );
  }

  /**
   * Accept UUIDs, Mongo-style ObjectIds, application-generated identifiers,
   * ULIDs and opaque identifiers.
   *
   * The validator deliberately does not require MongoDB ObjectId syntax
   * because TITech may use multiple identifier strategies across services.
   */
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(
      normalized,
    )
  ) {
    return createValidationError(
      field,
      `${field} contains invalid characters.`,
      "INVALID_FORMAT",
    );
  }

  return null;
}

/* =============================================================================
 * MESSAGE VALIDATION
 * =============================================================================
 */

function validateMessageText(
  value,
  {
    field = "message",
    required = true,
    maxLength =
      CHAT_LIMITS.MAX_MESSAGE_LENGTH,
  } = {},
) {
  if (
    value === undefined ||
    value === null
  ) {
    if (required) {
      return createValidationError(
        field,
        `${field} is required.`,
        "REQUIRED",
      );
    }

    return null;
  }

  if (
    typeof value !== "string"
  ) {
    return createValidationError(
      field,
      `${field} must be a string.`,
      "INVALID_TYPE",
    );
  }

  const normalized =
    normalizeText(value);

  if (
    required &&
    normalized.length <
      CHAT_LIMITS.MIN_MESSAGE_LENGTH
  ) {
    return createValidationError(
      field,
      `${field} cannot be empty.`,
      "EMPTY_VALUE",
    );
  }

  if (
    normalized.length >
    maxLength
  ) {
    return createValidationError(
      field,
      `${field} must not exceed ${maxLength} characters.`,
      "MAX_LENGTH",
    );
  }

  return null;
}

/* =============================================================================
 * ROLE VALIDATION
 * =============================================================================
 */

function validateRole(
  value,
  {
    field = "role",
    required = false,
  } = {},
) {
  if (
    value === undefined ||
    value === null
  ) {
    if (required) {
      return createValidationError(
        field,
        `${field} is required.`,
        "REQUIRED",
      );
    }

    return null;
  }

  if (
    typeof value !== "string"
  ) {
    return createValidationError(
      field,
      `${field} must be a string.`,
      "INVALID_TYPE",
    );
  }

  const normalized =
    value.trim().toLowerCase();

  if (
    !CHAT_ROLES.includes(
      normalized,
    )
  ) {
    return createValidationError(
      field,
      `${field} must be one of: ${CHAT_ROLES.join(", ")}.`,
      "INVALID_ENUM",
    );
  }

  return null;
}

/* =============================================================================
 * MESSAGE TYPE VALIDATION
 * =============================================================================
 */

function validateMessageType(
  value,
  {
    field = "type",
    required = false,
  } = {},
) {
  if (
    value === undefined ||
    value === null
  ) {
    if (required) {
      return createValidationError(
        field,
        `${field} is required.`,
        "REQUIRED",
      );
    }

    return null;
  }

  if (
    typeof value !== "string"
  ) {
    return createValidationError(
      field,
      `${field} must be a string.`,
      "INVALID_TYPE",
    );
  }

  const normalized =
    value.trim().toLowerCase();

  if (
    !CHAT_MESSAGE_TYPES.includes(
      normalized,
    )
  ) {
    return createValidationError(
      field,
      `${field} must be one of: ${CHAT_MESSAGE_TYPES.join(", ")}.`,
      "INVALID_ENUM",
    );
  }

  return null;
}

/* =============================================================================
 * TITLE VALIDATION
 * =============================================================================
 */

function validateTitle(
  value,
  {
    field = "title",
    required = false,
  } = {},
) {
  if (
    value === undefined ||
    value === null
  ) {
    if (required) {
      return createValidationError(
        field,
        `${field} is required.`,
        "REQUIRED",
      );
    }

    return null;
  }

  if (
    typeof value !== "string"
  ) {
    return createValidationError(
      field,
      `${field} must be a string.`,
      "INVALID_TYPE",
    );
  }

  const normalized =
    normalizeText(value);

  if (
    required &&
    normalized.length === 0
  ) {
    return createValidationError(
      field,
      `${field} cannot be empty.`,
      "EMPTY_VALUE",
    );
  }

  if (
    normalized.length >
    CHAT_LIMITS.MAX_TITLE_LENGTH
  ) {
    return createValidationError(
      field,
      `${field} must not exceed ${CHAT_LIMITS.MAX_TITLE_LENGTH} characters.`,
      "MAX_LENGTH",
    );
  }

  return null;
}

/* =============================================================================
 * PAGINATION VALIDATION
 * =============================================================================
 */

function validatePositiveInteger(
  value,
  {
    field,
    defaultValue,
    min,
    max,
  },
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return {
      error: null,
      value: defaultValue,
    };
  }

  const numericValue =
    typeof value === "number"
      ? value
      : Number(value);

  if (
    !Number.isInteger(
      numericValue,
    )
  ) {
    return {
      error: createValidationError(
        field,
        `${field} must be an integer.`,
        "INVALID_INTEGER",
      ),
      value: defaultValue,
    };
  }

  if (
    numericValue < min
  ) {
    return {
      error: createValidationError(
        field,
        `${field} must be at least ${min}.`,
        "MIN_VALUE",
      ),
      value: defaultValue,
    };
  }

  if (
    numericValue > max
  ) {
    return {
      error: createValidationError(
        field,
        `${field} must not exceed ${max}.`,
        "MAX_VALUE",
      ),
      value: defaultValue,
    };
  }

  return {
    error: null,
    value: numericValue,
  };
}

function validatePagination(
  input = {},
) {
  if (
    !isPlainObject(input)
  ) {
    return createFailure(
      createValidationError(
        "pagination",
        "Pagination parameters must be an object.",
        "INVALID_TYPE",
      ),
    );
  }

  const errors = [];

  const page =
    validatePositiveInteger(
      input.page,
      {
        field: "page",
        defaultValue:
          CHAT_LIMITS.DEFAULT_PAGE,
        min: 1,
        max: CHAT_LIMITS.MAX_PAGE,
      },
    );

  if (page.error) {
    errors.push(page.error);
  }

  const limit =
    validatePositiveInteger(
      input.limit,
      {
        field: "limit",
        defaultValue:
          CHAT_LIMITS.DEFAULT_LIMIT,
        min: CHAT_LIMITS.MIN_LIMIT,
        max: CHAT_LIMITS.MAX_LIMIT,
      },
    );

  if (limit.error) {
    errors.push(limit.error);
  }

  let cursor =
    input.cursor;

  if (
    cursor !== undefined &&
    cursor !== null
  ) {
    if (
      typeof cursor !== "string"
    ) {
      errors.push(
        createValidationError(
          "cursor",
          "cursor must be a string.",
          "INVALID_TYPE",
        ),
      );
    } else {
      cursor =
        cursor.trim();

      if (
        cursor.length >
        CHAT_LIMITS.MAX_CURSOR_LENGTH
      ) {
        errors.push(
          createValidationError(
            "cursor",
            `cursor must not exceed ${CHAT_LIMITS.MAX_CURSOR_LENGTH} characters.`,
            "MAX_LENGTH",
          ),
        );
      }

      if (
        cursor.length === 0
      ) {
        cursor = undefined;
      }
    }
  }

  let sortDirection =
    input.sortDirection ??
    "desc";

  if (
    typeof sortDirection !==
    "string"
  ) {
    errors.push(
      createValidationError(
        "sortDirection",
        "sortDirection must be a string.",
        "INVALID_TYPE",
      ),
    );
  } else {
    sortDirection =
      sortDirection
        .trim()
        .toLowerCase();

    if (
      !PAGINATION_SORT_DIRECTIONS.includes(
        sortDirection,
      )
    ) {
      errors.push(
        createValidationError(
          "sortDirection",
          `sortDirection must be one of: ${PAGINATION_SORT_DIRECTIONS.join(", ")}.`,
          "INVALID_ENUM",
        ),
      );
    }
  }

  if (
    errors.length > 0
  ) {
    return createFailure(
      errors,
    );
  }

  return createSuccess({
    page:
      page.value,

    limit:
      limit.value,

    cursor:
      cursor || null,

    sortDirection,
  });
}

/* =============================================================================
 * SEARCH VALIDATION
 * =============================================================================
 */

function validateSearch(
  value,
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return createSuccess(
      null,
    );
  }

  if (
    typeof value !== "string"
  ) {
    return createFailure(
      createValidationError(
        "search",
        "search must be a string.",
        "INVALID_TYPE",
      ),
    );
  }

  const normalized =
    normalizeText(value);

  if (
    normalized.length === 0
  ) {
    return createSuccess(
      null,
    );
  }

  if (
    normalized.length >
    CHAT_LIMITS.MAX_SEARCH_LENGTH
  ) {
    return createFailure(
      createValidationError(
        "search",
        `search must not exceed ${CHAT_LIMITS.MAX_SEARCH_LENGTH} characters.`,
        "MAX_LENGTH",
      ),
    );
  }

  return createSuccess(
    normalized,
  );
}

/* =============================================================================
 * METADATA VALIDATION
 * =============================================================================
 */

function validateMetadata(
  value,
  {
    field = "metadata",
  } = {},
) {
  if (
    value === undefined ||
    value === null
  ) {
    return createSuccess({});
  }

  if (
    !isPlainObject(value)
  ) {
    return createFailure(
      createValidationError(
        field,
        `${field} must be a plain object.`,
        "INVALID_TYPE",
      ),
    );
  }

  const keys =
    Object.keys(value);

  if (
    keys.length >
    CHAT_LIMITS.MAX_METADATA_KEYS
  ) {
    return createFailure(
      createValidationError(
        field,
        `${field} must not contain more than ${CHAT_LIMITS.MAX_METADATA_KEYS} keys.`,
        "MAX_KEYS",
      ),
    );
  }

  const normalized = {};
  const errors = [];

  for (
    const key of keys
  ) {
    if (
      typeof key !==
      "string"
    ) {
      continue;
    }

    const normalizedKey =
      key.trim();

    if (
      normalizedKey.length ===
      0
    ) {
      errors.push(
        createValidationError(
          `${field}.${key}`,
          "Metadata keys cannot be empty.",
          "EMPTY_KEY",
        ),
      );

      continue;
    }

    if (
      normalizedKey.length >
      CHAT_LIMITS.MAX_METADATA_KEY_LENGTH
    ) {
      errors.push(
        createValidationError(
          `${field}.${key}`,
          `Metadata keys must not exceed ${CHAT_LIMITS.MAX_METADATA_KEY_LENGTH} characters.`,
          "MAX_KEY_LENGTH",
        ),
      );

      continue;
    }

    /**
     * Protect against prototype-pollution keys.
     */
    if (
      normalizedKey ===
        "__proto__" ||
      normalizedKey ===
        "prototype" ||
      normalizedKey ===
        "constructor"
    ) {
      errors.push(
        createValidationError(
          `${field}.${key}`,
          "This metadata key is not permitted.",
          "FORBIDDEN_KEY",
        ),
      );

      continue;
    }

    const metadataValue =
      value[key];

    if (
      metadataValue === null ||
      typeof metadataValue ===
        "boolean" ||
      typeof metadataValue ===
        "number"
    ) {
      normalized[
        normalizedKey
      ] = metadataValue;

      continue;
    }

    if (
      typeof metadataValue ===
      "string"
    ) {
      const normalizedValue =
        normalizeText(
          metadataValue,
        );

      if (
        normalizedValue.length >
        CHAT_LIMITS.MAX_METADATA_VALUE_LENGTH
      ) {
        errors.push(
          createValidationError(
            `${field}.${key}`,
            `Metadata values must not exceed ${CHAT_LIMITS.MAX_METADATA_VALUE_LENGTH} characters.`,
            "MAX_VALUE_LENGTH",
          ),
        );

        continue;
      }

      normalized[
        normalizedKey
      ] = normalizedValue;

      continue;
    }

    /**
     * Nested objects and arrays are intentionally rejected here.
     * Complex metadata should use an explicit schema rather than accepting
     * arbitrary recursive client-controlled structures.
     */
    errors.push(
      createValidationError(
        `${field}.${key}`,
        "Metadata values must be strings, numbers, booleans, or null.",
        "INVALID_VALUE_TYPE",
      ),
    );
  }

  if (
    errors.length > 0
  ) {
    return createFailure(
      errors,
    );
  }

  return createSuccess(
    normalized,
  );
}

/* =============================================================================
 * ATTACHMENT VALIDATION
 * =============================================================================
 */

function validateAttachments(
  value,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return createSuccess([]);
  }

  if (
    !Array.isArray(value)
  ) {
    return createFailure(
      createValidationError(
        "attachments",
        "attachments must be an array.",
        "INVALID_TYPE",
      ),
    );
  }

  if (
    value.length >
    CHAT_LIMITS.MAX_ATTACHMENTS
  ) {
    return createFailure(
      createValidationError(
        "attachments",
        `A maximum of ${CHAT_LIMITS.MAX_ATTACHMENTS} attachments is allowed.`,
        "MAX_ITEMS",
      ),
    );
  }

  const errors = [];
  const normalized = [];

  value.forEach(
    (attachment, index) => {
      const field =
        `attachments[${index}]`;

      if (
        typeof attachment ===
        "string"
      ) {
        const id =
          normalizeIdentifier(
            attachment,
          );

        if (
          id.length === 0
        ) {
          errors.push(
            createValidationError(
              field,
              "Attachment identifier cannot be empty.",
              "EMPTY_VALUE",
            ),
          );

          return;
        }

        if (
          id.length >
          CHAT_LIMITS.MAX_ATTACHMENT_ID_LENGTH
        ) {
          errors.push(
            createValidationError(
              field,
              `Attachment identifier must not exceed ${CHAT_LIMITS.MAX_ATTACHMENT_ID_LENGTH} characters.`,
              "MAX_LENGTH",
            ),
          );

          return;
        }

        if (
          !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(
            id,
          )
        ) {
          errors.push(
            createValidationError(
              field,
              "Attachment identifier contains invalid characters.",
              "INVALID_FORMAT",
            ),
          );

          return;
        }

        normalized.push(id);

        return;
      }

      if (
        !isPlainObject(
          attachment,
        )
      ) {
        errors.push(
          createValidationError(
            field,
            "Attachment must be an identifier or object.",
            "INVALID_TYPE",
          ),
        );

        return;
      }

      const id =
        attachment.id;

      const idError =
        validateIdentifier(
          id,
          {
            field:
              `${field}.id`,

            required:
              true,

            maxLength:
              CHAT_LIMITS.MAX_ATTACHMENT_ID_LENGTH,
          },
        );

      if (idError) {
        errors.push(idError);
        return;
      }

      normalized.push({
        id:
          normalizeIdentifier(
            id,
          ),
      });
    },
  );

  if (
    errors.length > 0
  ) {
    return createFailure(
      errors,
    );
  }

  return createSuccess(
    normalized,
  );
}

/* =============================================================================
 * SEND MESSAGE REQUEST
 * =============================================================================
 */

function validateSendMessage(
  input,
) {
  if (
    !isPlainObject(input)
  ) {
    return createFailure(
      createValidationError(
        "body",
        "Chat request body must be a plain object.",
        "INVALID_TYPE",
      ),
    );
  }

  const errors = [];

  const conversationIdError =
    validateIdentifier(
      input.conversationId,
      {
        field:
          "conversationId",

        required:
          false,

        maxLength:
          CHAT_LIMITS.MAX_CONVERSATION_ID_LENGTH,
      },
    );

  if (
    conversationIdError
  ) {
    errors.push(
      conversationIdError,
    );
  }

  const messageError =
    validateMessageText(
      input.message,
      {
        field:
          "message",

        required:
          true,
      },
    );

  if (
    messageError
  ) {
    errors.push(
      messageError,
    );
  }

  const clientMessageIdError =
    validateIdentifier(
      input.clientMessageId,
      {
        field:
          "clientMessageId",

        required:
          false,

        maxLength:
          CHAT_LIMITS.MAX_CLIENT_MESSAGE_ID_LENGTH,
      },
    );

  if (
    clientMessageIdError
  ) {
    errors.push(
      clientMessageIdError,
    );
  }

  const metadata =
    validateMetadata(
      input.metadata,
    );

  if (
    !metadata.valid
  ) {
    errors.push(
      ...metadata.errors,
    );
  }

  const attachments =
    validateAttachments(
      input.attachments,
    );

  if (
    !attachments.valid
  ) {
    errors.push(
      ...attachments.errors,
    );
  }

  const model =
    input.model;

  let normalizedModel =
    null;

  if (
    model !== undefined &&
    model !== null
  ) {
    if (
      typeof model !== "string"
    ) {
      errors.push(
        createValidationError(
          "model",
          "model must be a string.",
          "INVALID_TYPE",
        ),
      );
    } else {
      normalizedModel =
        model.trim();

      if (
        normalizedModel.length >
        CHAT_LIMITS.MAX_MODEL_LENGTH
      ) {
        errors.push(
          createValidationError(
            "model",
            `model must not exceed ${CHAT_LIMITS.MAX_MODEL_LENGTH} characters.`,
            "MAX_LENGTH",
          ),
        );
      }
    }
  }

  if (
    errors.length > 0
  ) {
    return createFailure(
      errors,
    );
  }

  return createSuccess({
    conversationId:
      input.conversationId
        ? normalizeIdentifier(
            input.conversationId,
          )
        : null,

    message:
      normalizeText(
        input.message,
      ),

    clientMessageId:
      input.clientMessageId
        ? normalizeIdentifier(
            input.clientMessageId,
          )
        : null,

    metadata:
      metadata.value,

    attachments:
      attachments.value,

    model:
      normalizedModel,
  });
}

/* =============================================================================
 * CREATE CONVERSATION REQUEST
 * =============================================================================
 */

function validateCreateConversation(
  input,
) {
  if (
    input === undefined ||
    input === null
  ) {
    input = {};
  }

  if (
    !isPlainObject(input)
  ) {
    return createFailure(
      createValidationError(
        "body",
        "Conversation request body must be a plain object.",
        "INVALID_TYPE",
      ),
    );
  }

  const errors = [];

  const titleError =
    validateTitle(
      input.title,
      {
        field:
          "title",

        required:
          false,
      },
    );

  if (
    titleError
  ) {
    errors.push(
      titleError,
    );
  }

  const metadata =
    validateMetadata(
      input.metadata,
    );

  if (
    !metadata.valid
  ) {
    errors.push(
      ...metadata.errors,
    );
  }

  if (
    errors.length > 0
  ) {
    return createFailure(
      errors,
    );
  }

  return createSuccess({
    title:
      input.title
        ? normalizeText(
            input.title,
          )
        : null,

    metadata:
      metadata.value,
  });
}

/* =============================================================================
 * UPDATE CONVERSATION REQUEST
 * =============================================================================
 */

function validateUpdateConversation(
  input,
) {
  if (
    !isPlainObject(input)
  ) {
    return createFailure(
      createValidationError(
        "body",
        "Conversation update body must be a plain object.",
        "INVALID_TYPE",
      ),
    );
  }

  const errors = [];

  const allowedFields =
    new Set([
      "title",
      "metadata",
    ]);

  Object.keys(input).forEach(
    (field) => {
      if (
        !allowedFields.has(
          field,
        )
      ) {
        errors.push(
          createValidationError(
            field,
            `Unknown conversation field "${field}".`,
            "UNKNOWN_FIELD",
          ),
        );
      }
    },
  );

  const titleError =
    validateTitle(
      input.title,
      {
        field:
          "title",

        required:
          false,
      },
    );

  if (
    titleError
  ) {
    errors.push(
      titleError,
    );
  }

  const metadata =
    validateMetadata(
      input.metadata,
    );

  if (
    !metadata.valid
  ) {
    errors.push(
      ...metadata.errors,
    );
  }

  if (
    errors.length > 0
  ) {
    return createFailure(
      errors,
    );
  }

  const normalized = {};

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "title",
    )
  ) {
    normalized.title =
      normalizeText(
        input.title,
      );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "metadata",
    )
  ) {
    normalized.metadata =
      metadata.value;
  }

  if (
    Object.keys(normalized)
      .length === 0
  ) {
    return createFailure(
      createValidationError(
        "body",
        "At least one supported field must be provided.",
        "EMPTY_UPDATE",
      ),
    );
  }

  return createSuccess(
    normalized,
  );
}

/* =============================================================================
 * MESSAGE QUERY VALIDATION
 * =============================================================================
 */

function validateMessageQuery(
  input = {},
) {
  if (
    !isPlainObject(input)
  ) {
    return createFailure(
      createValidationError(
        "query",
        "Chat query parameters must be a plain object.",
        "INVALID_TYPE",
      ),
    );
  }

  const errors = [];

  const conversationIdError =
    validateIdentifier(
      input.conversationId,
      {
        field:
          "conversationId",

        required:
          true,

        maxLength:
          CHAT_LIMITS.MAX_CONVERSATION_ID_LENGTH,
      },
    );

  if (
    conversationIdError
  ) {
    errors.push(
      conversationIdError,
    );
  }

  const pagination =
    validatePagination(
      input,
    );

  if (
    !pagination.valid
  ) {
    errors.push(
      ...pagination.errors,
    );
  }

  const search =
    validateSearch(
      input.search,
    );

  if (
    !search.valid
  ) {
    errors.push(
      ...search.errors,
    );
  }

  if (
    errors.length > 0
  ) {
    return createFailure(
      errors,
    );
  }

  return createSuccess({
    conversationId:
      normalizeIdentifier(
        input.conversationId,
      ),

    ...pagination.value,

    search:
      search.value,
  });
}

/* =============================================================================
 * SINGLE MESSAGE QUERY VALIDATION
 * =============================================================================
 */

function validateMessageLookup(
  input,
) {
  if (
    !isPlainObject(input)
  ) {
    return createFailure(
      createValidationError(
        "params",
        "Message parameters must be a plain object.",
        "INVALID_TYPE",
      ),
    );
  }

  const errors = [];

  const conversationIdError =
    validateIdentifier(
      input.conversationId,
      {
        field:
          "conversationId",

        required:
          true,

        maxLength:
          CHAT_LIMITS.MAX_CONVERSATION_ID_LENGTH,
      },
    );

  if (
    conversationIdError
  ) {
    errors.push(
      conversationIdError,
    );
  }

  const messageIdError =
    validateIdentifier(
      input.messageId,
      {
        field:
          "messageId",

        required:
          true,

        maxLength:
          CHAT_LIMITS.MAX_MESSAGE_ID_LENGTH,
      },
    );

  if (
    messageIdError
  ) {
    errors.push(
      messageIdError,
    );
  }

  if (
    errors.length > 0
  ) {
    return createFailure(
      errors,
    );
  }

  return createSuccess({
    conversationId:
      normalizeIdentifier(
        input.conversationId,
      ),

    messageId:
      normalizeIdentifier(
        input.messageId,
      ),
  });
}

/* =============================================================================
 * MESSAGE ROLE / INTERNAL MESSAGE VALIDATION
 * =============================================================================
 *
 * This validator is intended for trusted internal service-to-service use.
 *
 * Public API routes should NOT accept arbitrary "system" or "assistant" roles
 * from clients without authorization checks.
 * =============================================================================
 */

function validateChatMessage(
  input,
) {
  if (
    !isPlainObject(input)
  ) {
    return createFailure(
      createValidationError(
        "message",
        "Chat message must be a plain object.",
        "INVALID_TYPE",
      ),
    );
  }

  const errors = [];

  const messageIdError =
    validateIdentifier(
      input.messageId,
      {
        field:
          "messageId",

        required:
          false,

        maxLength:
          CHAT_LIMITS.MAX_MESSAGE_ID_LENGTH,
      },
    );

  if (
    messageIdError
  ) {
    errors.push(
      messageIdError,
    );
  }

  const conversationIdError =
    validateIdentifier(
      input.conversationId,
      {
        field:
          "conversationId",

        required:
          true,

        maxLength:
          CHAT_LIMITS.MAX_CONVERSATION_ID_LENGTH,
      },
    );

  if (
    conversationIdError
  ) {
    errors.push(
      conversationIdError,
    );
  }

  const roleError =
    validateRole(
      input.role,
      {
        field:
          "role",

        required:
          true,
      },
    );

  if (
    roleError
  ) {
    errors.push(
      roleError,
    );
  }

  const typeError =
    validateMessageType(
      input.type,
      {
        field:
          "type",

        required:
          false,
      },
    );

  if (
    typeError
  ) {
    errors.push(
      typeError,
    );
  }

  const messageError =
    validateMessageText(
      input.content ??
        input.message,
      {
        field:
          "content",

        required:
          true,
      },
    );

  if (
    messageError
  ) {
    errors.push(
      messageError,
    );
  }

  const metadata =
    validateMetadata(
      input.metadata,
    );

  if (
    !metadata.valid
  ) {
    errors.push(
      ...metadata.errors,
    );
  }

  if (
    errors.length > 0
  ) {
    return createFailure(
      errors,
    );
  }

  return createSuccess({
    messageId:
      input.messageId
        ? normalizeIdentifier(
            input.messageId,
          )
        : null,

    conversationId:
      normalizeIdentifier(
        input.conversationId,
      ),

    role:
      input.role
        .trim()
        .toLowerCase(),

    type:
      input.type
        ? input.type
            .trim()
            .toLowerCase()
        : "text",

    content:
      normalizeText(
        input.content ??
          input.message,
      ),

    metadata:
      metadata.value,
  });
}

/* =============================================================================
 * EXPRESS-FRIENDLY VALIDATION MIDDLEWARE FACTORY
 * =============================================================================
 */

function createValidator(
  validator,
  source = "body",
) {
  return function chatValidationMiddleware(
    req,
    res,
    next,
  ) {
    try {
      const input =
        req?.[source];

      const result =
        validator(
          input,
        );

      if (
        result.valid
      ) {
        /**
         * Replace the request source with the normalized immutable-ish
         * validation result.
         *
         * The service layer should still treat request data as untrusted.
         */
        req[source] =
          result.value;

        return next();
      }

      return res
        .status(400)
        .json({
          success:
            false,

          error: {
            code:
              "VALIDATION_ERROR",

            message:
              "The request contains invalid chat data.",

            details:
              result.errors,
          },
        });
    } catch (error) {
      /**
       * Validation itself should not expose internal implementation details.
       */
      return res
        .status(400)
        .json({
          success:
            false,

          error: {
            code:
              "VALIDATION_ERROR",

            message:
              "The request could not be validated.",
          },
        });
    }
  };
}

/* =============================================================================
 * EXPRESS VALIDATOR EXPORTS
 * =============================================================================
 */

const validateSendMessageMiddleware =
  createValidator(
    validateSendMessage,
    "body",
  );

const validateCreateConversationMiddleware =
  createValidator(
    validateCreateConversation,
    "body",
  );

const validateUpdateConversationMiddleware =
  createValidator(
    validateUpdateConversation,
    "body",
  );

const validateMessageQueryMiddleware =
  createValidator(
    validateMessageQuery,
    "query",
  );

const validateMessageLookupMiddleware =
  createValidator(
    validateMessageLookup,
    "params",
  );

/* =============================================================================
 * PUBLIC API
 * =============================================================================
 */

module.exports = {
  /* Constants */
  CHAT_LIMITS,

  CHAT_ROLES,

  CHAT_MESSAGE_TYPES,

  PAGINATION_SORT_DIRECTIONS,

  /* Primitive validators */
  validateIdentifier,

  validateMessageText,

  validateRole,

  validateMessageType,

  validateTitle,

  validatePositiveInteger,

  validatePagination,

  validateSearch,

  validateMetadata,

  validateAttachments,

  /* Request validators */
  validateSendMessage,

  validateCreateConversation,

  validateUpdateConversation,

  validateMessageQuery,

  validateMessageLookup,

  validateChatMessage,

  /* Express middleware */
  validateSendMessageMiddleware,

  validateCreateConversationMiddleware,

  validateUpdateConversationMiddleware,

  validateMessageQueryMiddleware,

  validateMessageLookupMiddleware,

  /* Factory */
  createValidator,
};