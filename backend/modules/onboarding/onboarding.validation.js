"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise SACCO Onboarding Validation
 * ============================================================================
 *
 * File:
 * backend/modules/onboarding/onboarding.validation.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Enterprise request validation and normalization boundary for the SACCO
 * onboarding lifecycle.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 * - Strict request-body validation
 * - Unknown-field rejection
 * - Input normalization
 * - Primitive type validation
 * - Enum validation
 * - Email / phone / currency / country validation
 * - Date validation
 * - Mutation-specific validation
 * - Tenant-safe request handling
 * - Consistent HTTP validation errors
 *
 * Design Principles:
 * ----------------------------------------------------------------------------
 * - Do not trust client input.
 * - Do not trust client tenant identifiers.
 * - Do not allow silent field dropping.
 * - Normalize before business logic.
 * - Keep lifecycle rules in onboarding.service.js.
 * - Keep persistence rules in repositories/models.
 * - Keep authentication/authorization in security middleware.
 * - Never expose implementation details in validation errors.
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * This module does NOT:
 * - query the database
 * - perform KYC decisions
 * - approve subscriptions
 * - transition SACCO lifecycle state
 * - perform financial postings
 * - configure payment providers
 *
 * ============================================================================
 */

const crypto = require("crypto");

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const MAX_NAME_LENGTH = 200;
const MAX_TEXT_LENGTH = 2000;
const MAX_REASON_LENGTH = 2000;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_ADDRESS_LENGTH = 500;
const MAX_METADATA_KEYS = 25;

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PHONE_PATTERN =
  /^\+?[1-9]\d{7,14}$/;

const CURRENCY_PATTERN =
  /^[A-Z]{3}$/;

const COUNTRY_PATTERN =
  /^[A-Z]{2,3}$/;

const REGISTRATION_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9./_-]{2,99}$/;

const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}$/;

const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const ALLOWED_SACCO_TYPES = new Set([
  "SACCO",
  "VSLA",
  "COOPERATIVE",
  "COMMUNITY_SAVINGS_GROUP",
  "MICROFINANCE",
  "OTHER",
]);

const ALLOWED_KYC_STATUSES = new Set([
  "APPROVED",
  "REJECTED",
  "PENDING",
]);

const ALLOWED_BILLING_CYCLES = new Set([
  "MONTHLY",
  "QUARTERLY",
  "SEMI_ANNUAL",
  "ANNUAL",
]);

const ALLOWED_REJECTION_CODES = new Set([
  "KYC_FAILED",
  "DOCUMENTATION_INCOMPLETE",
  "DUPLICATE_APPLICATION",
  "COMPLIANCE_FAILURE",
  "SUBSCRIPTION_FAILURE",
  "FRAUD_SUSPECTED",
  "INELIGIBLE",
  "OTHER",
]);

const MUTATION_METHODS = new Set([
  "POST",
  "PUT",
  "PATCH",
]);

/**
 * ============================================================================
 * VALIDATION ERROR
 * ============================================================================
 */

class ValidationError extends Error {
  constructor(
    message,
    {
      code = "VALIDATION_ERROR",
      field = null,
      details = [],
      status = 400,
    } = {}
  ) {
    super(message);

    this.name = "ValidationError";
    this.code = code;
    this.field = field;
    this.details = Array.isArray(details)
      ? details
      : [];
    this.status = status;
    this.isOperational = true;
  }
}

/**
 * ============================================================================
 * GENERIC HELPERS
 * ============================================================================
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
    prototype === Object.prototype ||
    prototype === null
  );
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(
    object,
    key
  );
}

function isEmptyValue(value) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" &&
      value.trim() === "")
  );
}

function normalizeString(
  value,
  {
    trim = true,
    lowercase = false,
    uppercase = false,
    maxLength = null,
  } = {}
) {
  if (typeof value !== "string") {
    return value;
  }

  let output = value;

  if (trim) {
    output = output.trim();
  }

  if (lowercase) {
    output = output.toLowerCase();
  }

  if (uppercase) {
    output = output.toUpperCase();
  }

  if (
    maxLength !== null &&
    output.length > maxLength
  ) {
    return output.slice(0, maxLength);
  }

  return output;
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) {
    return value;
  }

  return {
    ...value,
  };
}

function pushError(
  errors,
  field,
  message,
  code = "INVALID_FIELD"
) {
  errors.push({
    field,
    message,
    code,
  });
}

function failIfErrors(errors) {
  if (errors.length === 0) {
    return;
  }

  throw new ValidationError(
    "Request validation failed.",
    {
      code: "REQUEST_VALIDATION_FAILED",
      details: errors,
    }
  );
}

function assertObjectBody(req) {
  if (!isPlainObject(req.body)) {
    throw new ValidationError(
      "Request body must be a JSON object.",
      {
        code: "INVALID_REQUEST_BODY",
      }
    );
  }
}

/**
 * ============================================================================
 * UNKNOWN FIELD PROTECTION
 * ============================================================================
 */

function rejectUnknownFields(
  body,
  allowedFields,
  errors
) {
  const allowed = new Set(allowedFields);

  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      pushError(
        errors,
        key,
        `Field "${key}" is not permitted.`,
        "UNKNOWN_FIELD"
      );
    }
  }
}

/**
 * ============================================================================
 * TENANT SAFETY
 * ============================================================================
 *
 * Client requests must never be allowed to select or override the effective
 * tenant context used by the server.
 *
 * The authenticated tenant should originate from tenant middleware /
 * authenticated principal / server-side tenant context.
 *
 * We therefore reject tenant override fields rather than silently deleting
 * them.
 * ============================================================================
 */

function rejectTenantOverride(
  body,
  errors
) {
  const forbiddenFields = [
    "tenantId",
    "tenant",
    "tenantKey",
    "tenantCode",
    "tenantSlug",
  ];

  for (const field of forbiddenFields) {
    if (hasOwn(body, field)) {
      pushError(
        errors,
        field,
        "Tenant context cannot be supplied or overridden by the client.",
        "TENANT_OVERRIDE_FORBIDDEN"
      );
    }
  }
}

/**
 * ============================================================================
 * PRIMITIVE VALIDATORS
 * ============================================================================
 */

function requiredString(
  body,
  field,
  errors,
  {
    minLength = 1,
    maxLength = MAX_TEXT_LENGTH,
    normalize = {},
  } = {}
) {
  const value = body[field];

  if (
    typeof value !== "string" ||
    value.trim().length < minLength
  ) {
    pushError(
      errors,
      field,
      `${field} is required.`,
      "REQUIRED_STRING"
    );

    return null;
  }

  const normalized =
    normalizeString(value, {
      trim: true,
      ...normalize,
    });

  if (normalized.length > maxLength) {
    pushError(
      errors,
      field,
      `${field} exceeds the maximum allowed length.`,
      "MAX_LENGTH_EXCEEDED"
    );

    return null;
  }

  body[field] = normalized;

  return normalized;
}

function optionalString(
  body,
  field,
  errors,
  {
    minLength = 0,
    maxLength = MAX_TEXT_LENGTH,
    normalize = {},
  } = {}
) {
  if (body[field] === undefined) {
    return null;
  }

  if (
    body[field] === null ||
    typeof body[field] !== "string"
  ) {
    pushError(
      errors,
      field,
      `${field} must be a string.`,
      "INVALID_STRING"
    );

    return null;
  }

  const normalized =
    normalizeString(body[field], {
      trim: true,
      ...normalize,
    });

  if (normalized.length < minLength) {
    pushError(
      errors,
      field,
      `${field} is too short.`,
      "MIN_LENGTH_NOT_MET"
    );
  }

  if (normalized.length > maxLength) {
    pushError(
      errors,
      field,
      `${field} exceeds the maximum allowed length.`,
      "MAX_LENGTH_EXCEEDED"
    );
  }

  body[field] = normalized;

  return normalized;
}

function requiredEmail(
  body,
  field,
  errors
) {
  const value = requiredString(
    body,
    field,
    errors,
    {
      minLength: 5,
      maxLength: 254,
      normalize: {
        lowercase: true,
      },
    }
  );

  if (
    value &&
    !EMAIL_PATTERN.test(value)
  ) {
    pushError(
      errors,
      field,
      `${field} must be a valid email address.`,
      "INVALID_EMAIL"
    );
  }

  return value;
}

function optionalEmail(
  body,
  field,
  errors
) {
  if (body[field] === undefined) {
    return null;
  }

  const value = optionalString(
    body,
    field,
    errors,
    {
      minLength: 5,
      maxLength: 254,
      normalize: {
        lowercase: true,
      },
    }
  );

  if (
    value &&
    !EMAIL_PATTERN.test(value)
  ) {
    pushError(
      errors,
      field,
      `${field} must be a valid email address.`,
      "INVALID_EMAIL"
    );
  }

  return value;
}

function requiredPhone(
  body,
  field,
  errors
) {
  const value = requiredString(
    body,
    field,
    errors,
    {
      minLength: 8,
      maxLength: 16,
    }
  );

  if (
    value &&
    !PHONE_PATTERN.test(value)
  ) {
    pushError(
      errors,
      field,
      `${field} must be a valid international phone number.`,
      "INVALID_PHONE"
    );
  }

  return value;
}

function optionalPhone(
  body,
  field,
  errors
) {
  if (body[field] === undefined) {
    return null;
  }

  const value = optionalString(
    body,
    field,
    errors,
    {
      minLength: 8,
      maxLength: 16,
    }
  );

  if (
    value &&
    !PHONE_PATTERN.test(value)
  ) {
    pushError(
      errors,
      field,
      `${field} must be a valid international phone number.`,
      "INVALID_PHONE"
    );
  }

  return value;
}

function optionalBoolean(
  body,
  field,
  errors
) {
  if (body[field] === undefined) {
    return null;
  }

  if (
    typeof body[field] !== "boolean"
  ) {
    pushError(
      errors,
      field,
      `${field} must be a boolean.`,
      "INVALID_BOOLEAN"
    );

    return null;
  }

  return body[field];
}

function requiredEnum(
  body,
  field,
  allowedValues,
  errors
) {
  const value = requiredString(
    body,
    field,
    errors,
    {
      maxLength: 100,
      normalize: {
        uppercase: true,
      },
    }
  );

  if (
    value &&
    !allowedValues.has(value)
  ) {
    pushError(
      errors,
      field,
      `${field} contains an unsupported value.`,
      "INVALID_ENUM"
    );
  }

  return value;
}

function optionalEnum(
  body,
  field,
  allowedValues,
  errors
) {
  if (body[field] === undefined) {
    return null;
  }

  const value = optionalString(
    body,
    field,
    errors,
    {
      maxLength: 100,
      normalize: {
        uppercase: true,
      },
    }
  );

  if (
    value &&
    !allowedValues.has(value)
  ) {
    pushError(
      errors,
      field,
      `${field} contains an unsupported value.`,
      "INVALID_ENUM"
    );
  }

  return value;
}

function requiredPositiveInteger(
  body,
  field,
  errors,
  {
    min = 1,
    max = 1000000000,
  } = {}
) {
  const value = body[field];

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isFinite(value)
  ) {
    pushError(
      errors,
      field,
      `${field} must be an integer.`,
      "INVALID_INTEGER"
    );

    return null;
  }

  if (value < min || value > max) {
    pushError(
      errors,
      field,
      `${field} is outside the permitted range.`,
      "INTEGER_OUT_OF_RANGE"
    );
  }

  return value;
}

function optionalPositiveInteger(
  body,
  field,
  errors,
  options = {}
) {
  if (body[field] === undefined) {
    return null;
  }

  return requiredPositiveInteger(
    body,
    field,
    errors,
    options
  );
}

function validateIsoDate(
  body,
  field,
  errors,
  {
    required = false,
  } = {}
) {
  if (
    body[field] === undefined ||
    body[field] === null
  ) {
    if (required) {
      pushError(
        errors,
        field,
        `${field} is required.`,
        "REQUIRED_DATE"
      );
    }

    return null;
  }

  if (
    typeof body[field] !== "string" ||
    !ISO_DATE_PATTERN.test(
      body[field]
    )
  ) {
    pushError(
      errors,
      field,
      `${field} must use YYYY-MM-DD format.`,
      "INVALID_DATE"
    );

    return null;
  }

  const date =
    new Date(`${body[field]}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    pushError(
      errors,
      field,
      `${field} is not a valid calendar date.`,
      "INVALID_DATE"
    );
  }

  return body[field];
}

function validateIsoDateTime(
  body,
  field,
  errors,
  {
    required = false,
  } = {}
) {
  if (
    body[field] === undefined ||
    body[field] === null
  ) {
    if (required) {
      pushError(
        errors,
        field,
        `${field} is required.`,
        "REQUIRED_DATETIME"
      );
    }

    return null;
  }

  if (
    typeof body[field] !== "string" ||
    !ISO_DATETIME_PATTERN.test(
      body[field]
    )
  ) {
    pushError(
      errors,
      field,
      `${field} must be a valid ISO-8601 datetime.`,
      "INVALID_DATETIME"
    );

    return null;
  }

  const timestamp =
    Date.parse(body[field]);

  if (Number.isNaN(timestamp)) {
    pushError(
      errors,
      field,
      `${field} is not a valid datetime.`,
      "INVALID_DATETIME"
    );
  }

  return body[field];
}

/**
 * ============================================================================
 * METADATA VALIDATION
 * ============================================================================
 *
 * Metadata is allowed only for controlled extension points.
 *
 * Prototype-pollution-sensitive keys are explicitly rejected.
 * ============================================================================
 */

function validateMetadata(
  body,
  field,
  errors
) {
  if (body[field] === undefined) {
    return;
  }

  if (!isPlainObject(body[field])) {
    pushError(
      errors,
      field,
      `${field} must be an object.`,
      "INVALID_METADATA"
    );

    return;
  }

  const keys = Object.keys(
    body[field]
  );

  if (keys.length > MAX_METADATA_KEYS) {
    pushError(
      errors,
      field,
      `${field} contains too many keys.`,
      "METADATA_TOO_LARGE"
    );

    return;
  }

  const forbiddenKeys = new Set([
    "__proto__",
    "prototype",
    "constructor",
    "tenantId",
    "password",
    "passwordHash",
    "secret",
    "token",
    "accessToken",
    "refreshToken",
    "apiKey",
    "clientSecret",
  ]);

  for (const key of keys) {
    if (forbiddenKeys.has(key)) {
      pushError(
        errors,
        `${field}.${key}`,
        "This metadata field is not permitted.",
        "FORBIDDEN_METADATA_FIELD"
      );
    }

    if (
      key.length > 100 ||
      typeof key !== "string"
    ) {
      pushError(
        errors,
        `${field}.${key}`,
        "Invalid metadata key.",
        "INVALID_METADATA_KEY"
      );
    }
  }
}

/**
 * ============================================================================
 * COMMON SACCO VALIDATION
 * ============================================================================
 */

const SACCO_ALLOWED_FIELDS = [
  "name",
  "legalName",
  "registrationNumber",
  "registrationDate",
  "type",
  "description",
  "email",
  "contactEmail",
  "phone",
  "alternatePhone",
  "address",
  "city",
  "district",
  "region",
  "country",
  "currency",
  "website",
  "memberCount",
  "adminName",
  "adminEmail",
  "adminPhone",
  "metadata",
];

function validateSaccoBody(
  req
) {
  assertObjectBody(req);

  const body = clonePlainObject(
    req.body
  );

  const errors = [];

  rejectUnknownFields(
    body,
    SACCO_ALLOWED_FIELDS,
    errors
  );

  rejectTenantOverride(
    body,
    errors
  );

  requiredString(
    body,
    "name",
    errors,
    {
      minLength: 2,
      maxLength: MAX_NAME_LENGTH,
    }
  );

  optionalString(
    body,
    "legalName",
    errors,
    {
      minLength: 2,
      maxLength: MAX_NAME_LENGTH,
    }
  );

  const registrationNumber =
    requiredString(
      body,
      "registrationNumber",
      errors,
      {
        minLength: 3,
        maxLength: 100,
      }
    );

  if (
    registrationNumber &&
    !REGISTRATION_PATTERN.test(
      registrationNumber
    )
  ) {
    pushError(
      errors,
      "registrationNumber",
      "registrationNumber contains unsupported characters.",
      "INVALID_REGISTRATION_NUMBER"
    );
  }

  validateIsoDate(
    body,
    "registrationDate",
    errors
  );

  if (body.type !== undefined) {
    optionalEnum(
      body,
      "type",
      ALLOWED_SACCO_TYPES,
      errors
    );
  }

  optionalString(
    body,
    "description",
    errors,
    {
      maxLength:
        MAX_DESCRIPTION_LENGTH,
    }
  );

  const emailField =
    hasOwn(body, "contactEmail")
      ? "contactEmail"
      : "email";

  if (
    hasOwn(body, "email") &&
    hasOwn(body, "contactEmail")
  ) {
    pushError(
      errors,
      "contactEmail",
      "Provide either email or contactEmail, not both.",
      "DUPLICATE_CONTACT_FIELD"
    );
  }

  if (hasOwn(body, emailField)) {
    optionalEmail(
      body,
      emailField,
      errors
    );
  }

  if (hasOwn(body, "phone")) {
    requiredPhone(
      body,
      "phone",
      errors
    );
  }

  optionalPhone(
    body,
    "alternatePhone",
    errors
  );

  optionalString(
    body,
    "address",
    errors,
    {
      maxLength: MAX_ADDRESS_LENGTH,
    }
  );

  optionalString(
    body,
    "city",
    errors,
    {
      maxLength: 150,
    }
  );

  optionalString(
    body,
    "district",
    errors,
    {
      maxLength: 150,
    }
  );

  optionalString(
    body,
    "region",
    errors,
    {
      maxLength: 150,
    }
  );

  if (body.country !== undefined) {
    optionalString(
      body,
      "country",
      errors,
      {
        minLength: 2,
        maxLength: 3,
        normalize: {
          uppercase: true,
        },
      }
    );

    if (
      typeof body.country === "string" &&
      !COUNTRY_PATTERN.test(
        body.country
      )
    ) {
      pushError(
        errors,
        "country",
        "country must be a valid ISO-style country code.",
        "INVALID_COUNTRY"
      );
    }
  }

  if (body.currency !== undefined) {
    optionalString(
      body,
      "currency",
      errors,
      {
        minLength: 3,
        maxLength: 3,
        normalize: {
          uppercase: true,
        },
      }
    );

    if (
      typeof body.currency === "string" &&
      !CURRENCY_PATTERN.test(
        body.currency
      )
    ) {
      pushError(
        errors,
        "currency",
        "currency must be a three-letter ISO currency code.",
        "INVALID_CURRENCY"
      );
    }
  }

  optionalString(
    body,
    "website",
    errors,
    {
      maxLength: 500,
    }
  );

  if (
    body.website !== undefined &&
    typeof body.website === "string" &&
    body.website !== ""
  ) {
    let parsedUrl;

    try {
      parsedUrl = new URL(
        body.website
      );
    } catch {
      parsedUrl = null;
    }

    if (
      !parsedUrl ||
      !["http:", "https:"].includes(
        parsedUrl.protocol
      )
    ) {
      pushError(
        errors,
        "website",
        "website must be a valid HTTP or HTTPS URL.",
        "INVALID_WEBSITE"
      );
    }
  }

  if (
    body.memberCount !== undefined
  ) {
    optionalPositiveInteger(
      body,
      "memberCount",
      errors,
      {
        min: 1,
        max: 100000000,
      }
    );
  }

  optionalString(
    body,
    "adminName",
    errors,
    {
      minLength: 2,
      maxLength: MAX_NAME_LENGTH,
    }
  );

  optionalEmail(
    body,
    "adminEmail",
    errors
  );

  optionalPhone(
    body,
    "adminPhone",
    errors
  );

  validateMetadata(
    body,
    "metadata",
    errors
  );

  /**
   * ------------------------------------------------------------------------
   * Cross-field consistency
   * ------------------------------------------------------------------------
   */

  if (
    body.adminEmail &&
    !body.adminName
  ) {
    pushError(
      errors,
      "adminName",
      "adminName is required when adminEmail is supplied.",
      "ADMIN_NAME_REQUIRED"
    );
  }

  if (
    body.adminPhone &&
    !body.adminName
  ) {
    pushError(
      errors,
      "adminName",
      "adminName is required when adminPhone is supplied.",
      "ADMIN_NAME_REQUIRED"
    );
  }

  failIfErrors(errors);

  /**
   * ------------------------------------------------------------------------
   * Preserve normalized request body.
   * ------------------------------------------------------------------------
   */

  req.body = body;

  return nextOrReturn();
}

/**
 * ============================================================================
 * KYC VALIDATION
 * ============================================================================
 */

const KYC_ALLOWED_FIELDS = [
  "status",
  "notes",
  "reason",
  "reviewerComment",
  "reviewedAt",
  "reference",
  "metadata",
];

function validateKYCBody(
  req
) {
  assertObjectBody(req);

  const body = clonePlainObject(
    req.body
  );

  const errors = [];

  rejectUnknownFields(
    body,
    KYC_ALLOWED_FIELDS,
    errors
  );

  rejectTenantOverride(
    body,
    errors
  );

  requiredEnum(
    body,
    "status",
    ALLOWED_KYC_STATUSES,
    errors
  );

  optionalString(
    body,
    "notes",
    errors,
    {
      maxLength: MAX_REASON_LENGTH,
    }
  );

  optionalString(
    body,
    "reason",
    errors,
    {
      maxLength: MAX_REASON_LENGTH,
    }
  );

  optionalString(
    body,
    "reviewerComment",
    errors,
    {
      maxLength: MAX_REASON_LENGTH,
    }
  );

  validateIsoDateTime(
    body,
    "reviewedAt",
    errors
  );

  optionalString(
    body,
    "reference",
    errors,
    {
      minLength: 2,
      maxLength: 150,
    }
  );

  validateMetadata(
    body,
    "metadata",
    errors
  );

  /**
   * Rejection requires an explanatory reason.
   */
  if (
    body.status === "REJECTED" &&
    isEmptyValue(body.reason) &&
    isEmptyValue(body.notes) &&
    isEmptyValue(
      body.reviewerComment
    )
  ) {
    pushError(
      errors,
      "reason",
      "A reason or review comment is required when KYC is rejected.",
      "KYC_REJECTION_REASON_REQUIRED"
    );
  }

  failIfErrors(errors);

  req.body = body;

  return nextOrReturn();
}

/**
 * ============================================================================
 * SUBSCRIPTION VALIDATION
 * ============================================================================
 */

const SUBSCRIPTION_ALLOWED_FIELDS = [
  "planId",
  "plan",
  "billingCycle",
  "currency",
  "memberLimit",
  "seatLimit",
  "startsAt",
  "endsAt",
  "metadata",
];

function validateSubscriptionBody(
  req
) {
  assertObjectBody(req);

  const body = clonePlainObject(
    req.body
  );

  const errors = [];

  rejectUnknownFields(
    body,
    SUBSCRIPTION_ALLOWED_FIELDS,
    errors
  );

  rejectTenantOverride(
    body,
    errors
  );

  const hasPlanId =
    !isEmptyValue(body.planId);

  const hasPlan =
    !isEmptyValue(body.plan);

  if (!hasPlanId && !hasPlan) {
    pushError(
      errors,
      "planId",
      "Either planId or plan is required.",
      "SUBSCRIPTION_PLAN_REQUIRED"
    );
  }

  if (
    hasPlanId &&
    hasPlan
  ) {
    pushError(
      errors,
      "planId",
      "Provide either planId or plan, not both.",
      "DUPLICATE_SUBSCRIPTION_PLAN"
    );
  }

  if (body.planId !== undefined) {
    requiredString(
      body,
      "planId",
      errors,
      {
        minLength: 2,
        maxLength: 150,
      }
    );
  }

  if (body.plan !== undefined) {
    requiredString(
      body,
      "plan",
      errors,
      {
        minLength: 2,
        maxLength: 150,
      }
    );
  }

  requiredEnum(
    body,
    "billingCycle",
    ALLOWED_BILLING_CYCLES,
    errors
  );

  optionalString(
    body,
    "currency",
    errors,
    {
      minLength: 3,
      maxLength: 3,
      normalize: {
        uppercase: true,
      },
    }
  );

  if (
    body.currency !== undefined &&
    !CURRENCY_PATTERN.test(
      body.currency
    )
  ) {
    pushError(
      errors,
      "currency",
      "currency must be a three-letter ISO currency code.",
      "INVALID_CURRENCY"
    );
  }

  optionalPositiveInteger(
    body,
    "memberLimit",
    errors,
    {
      min: 1,
      max: 100000000,
    }
  );

  optionalPositiveInteger(
    body,
    "seatLimit",
    errors,
    {
      min: 1,
      max: 100000000,
    }
  );

  validateIsoDateTime(
    body,
    "startsAt",
    errors
  );

  validateIsoDateTime(
    body,
    "endsAt",
    errors
  );

  if (
    body.startsAt &&
    body.endsAt
  ) {
    const starts =
      Date.parse(body.startsAt);

    const ends =
      Date.parse(body.endsAt);

    if (
      Number.isFinite(starts) &&
      Number.isFinite(ends) &&
      ends <= starts
    ) {
      pushError(
        errors,
        "endsAt",
        "endsAt must be later than startsAt.",
        "INVALID_SUBSCRIPTION_PERIOD"
      );
    }
  }

  validateMetadata(
    body,
    "metadata",
    errors
  );

  failIfErrors(errors);

  req.body = body;

  return nextOrReturn();
}

/**
 * ============================================================================
 * REJECTION VALIDATION
 * ============================================================================
 */

const REJECTION_ALLOWED_FIELDS = [
  "code",
  "reason",
  "details",
  "notes",
  "metadata",
];

function validateRejectionBody(
  req
) {
  assertObjectBody(req);

  const body = clonePlainObject(
    req.body
  );

  const errors = [];

  rejectUnknownFields(
    body,
    REJECTION_ALLOWED_FIELDS,
    errors
  );

  rejectTenantOverride(
    body,
    errors
  );

  requiredEnum(
    body,
    "code",
    ALLOWED_REJECTION_CODES,
    errors
  );

  requiredString(
    body,
    "reason",
    errors,
    {
      minLength: 3,
      maxLength: MAX_REASON_LENGTH,
    }
  );

  optionalString(
    body,
    "details",
    errors,
    {
      maxLength: MAX_REASON_LENGTH,
    }
  );

  optionalString(
    body,
    "notes",
    errors,
    {
      maxLength: MAX_REASON_LENGTH,
    }
  );

  validateMetadata(
    body,
    "metadata",
    errors
  );

  failIfErrors(errors);

  req.body = body;

  return nextOrReturn();
}

/**
 * ============================================================================
 * VALIDATION MIDDLEWARE EXECUTION
 * ============================================================================
 *
 * These wrappers keep the actual validators synchronous and deterministic.
 * ============================================================================
 */

function runValidator(
  validator,
  req,
  res,
  next
) {
  try {
    validator(req);

    return next();
  } catch (error) {
    if (
      error instanceof ValidationError
    ) {
      return res.status(
        error.status || 400
      ).json({
        success: false,
        code:
          error.code ||
          "REQUEST_VALIDATION_FAILED",
        message: error.message,
        details:
          error.details?.length
            ? error.details
            : undefined,
        requestId:
          req.id ||
          req.requestId ||
          undefined,
      });
    }

    return next(error);
  }
}

function middlewareFrom(
  validator
) {
  return (req, res, next) =>
    runValidator(
      validator,
      req,
      res,
      next
    );
}

/**
 * ============================================================================
 * ASYNC-SAFE NORMALIZER
 * ============================================================================
 *
 * Some codebases import validators directly in tests/services instead of
 * executing them as Express middleware.
 *
 * nextOrReturn() keeps the internal validators simple while middlewareFrom()
 * handles Express execution.
 * ============================================================================
 */

function nextOrReturn() {
  return undefined;
}

/**
 * ============================================================================
 * REQUEST-SPECIFIC SECURITY VALIDATORS
 * ============================================================================
 */

/**
 * Reject body payloads for mutation endpoints where no body is expected.
 *
 * This prevents accidental client-controlled fields from being silently
 * accepted by state-transition endpoints.
 */
function validateEmptyMutationBody(
  req,
  res,
  next
) {
  if (
    MUTATION_METHODS.has(
      String(req.method || "").toUpperCase()
    ) &&
    isPlainObject(req.body) &&
    Object.keys(req.body).length > 0
  ) {
    return res.status(400).json({
      success: false,
      code: "UNEXPECTED_REQUEST_BODY",
      message:
        "This operation does not accept request body fields.",
      requestId:
        req.id ||
        req.requestId ||
        undefined,
    });
  }

  return next();
}

/**
 * ============================================================================
 * ROUTE EXPORTS
 * ============================================================================
 *
 * Existing onboarding.routes.js expects:
 *
 *   validateSacco
 *   validateKYC
 *   validateSubscription
 *   validateRejection
 *
 * Those exports are intentionally preserved.
 * ============================================================================
 */

const validateSacco =
  middlewareFrom(validateSaccoBody);

const validateKYC =
  middlewareFrom(validateKYCBody);

const validateSubscription =
  middlewareFrom(
    validateSubscriptionBody
  );

const validateRejection =
  middlewareFrom(
    validateRejectionBody
  );

/**
 * ============================================================================
 * OPTIONAL VALIDATORS EXPORTED FOR FUTURE ROUTES
 * ============================================================================
 */

const validateEmptyBody =
  validateEmptyMutationBody;

/**
 * ============================================================================
 * PURE VALIDATION API
 * ============================================================================
 *
 * Useful for:
 * - unit tests
 * - service-level input normalization
 * - command handlers
 * - background workflows
 *
 * These return normalized payloads or throw ValidationError.
 * ============================================================================
 */

function validateSaccoPayload(
  payload
) {
  const req = {
    body: payload,
  };

  validateSaccoBody(req);

  return req.body;
}

function validateKYCPayload(
  payload
) {
  const req = {
    body: payload,
  };

  validateKYCBody(req);

  return req.body;
}

function validateSubscriptionPayload(
  payload
) {
  const req = {
    body: payload,
  };

  validateSubscriptionBody(req);

  return req.body;
}

function validateRejectionPayload(
  payload
) {
  const req = {
    body: payload,
  };

  validateRejectionBody(req);

  return req.body;
}

/**
 * ============================================================================
 * VALIDATION ERROR SERIALIZER
 * ============================================================================
 *
 * Lets the global error handler recognize this class without relying on the
 * module instance alone.
 * ============================================================================
 */

function isValidationError(error) {
  return Boolean(
    error &&
      (
        error instanceof ValidationError ||
        error.name ===
          "ValidationError"
      )
  );
}

/**
 * ============================================================================
 * SANITIZATION FINGERPRINT
 * ============================================================================
 *
 * Creates a deterministic fingerprint of normalized request content.
 *
 * This is NOT an idempotency key.
 *
 * It can be useful for:
 * - request tracing
 * - audit correlation
 * - duplicate payload detection
 * - support diagnostics
 *
 * Never use it as the sole authorization mechanism.
 * ============================================================================
 */

function createPayloadFingerprint(
  payload
) {
  const normalized =
    stableSerialize(payload);

  return crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex");
}

function stableSerialize(
  value
) {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value
      .map(stableSerialize)
      .join(",")}]`;
  }

  const keys = Object.keys(value)
    .sort();

  return `{${keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableSerialize(
          value[key]
        )}`
    )
    .join(",")}}`;
}

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports = {
  /**
   * Existing route-compatible middleware.
   */
  validateSacco,
  validateKYC,
  validateSubscription,
  validateRejection,

  /**
   * Additional enterprise utilities.
   */
  validateEmptyBody,
  ValidationError,
  isValidationError,

  /**
   * Pure validation APIs.
   */
  validateSaccoPayload,
  validateKYCPayload,
  validateSubscriptionPayload,
  validateRejectionPayload,

  /**
   * Deterministic payload fingerprinting.
   */
  createPayloadFingerprint,
};