"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * Enterprise Referral Validation Layer
 * =============================================================================
 *
 * File:
 *   backend/validators/referralValidator.js
 *
 * Purpose:
 *   Enterprise-grade validation and normalization for referral operations.
 *
 * Architectural Position:
 *
 *   HTTP Request
 *        ↓
 *   referralValidator
 *        ↓
 *   ReferralController
 *        ↓
 *   ReferralService
 *        ↓
 *   ReferralRepository / Transaction Engine
 *        ↓
 *   ReferralReward / Reward Outbox
 *
 * SECURITY PRINCIPLES
 * -----------------------------------------------------------------------------
 * - Never trust tenantId supplied by the client.
 * - tenantId must come from authenticated server-side context.
 * - Never trust referrerId supplied by the client when it can be derived
 *   from req.user.
 * - Never accept reward amounts from untrusted clients for issuance.
 * - Never accept referral status transitions from public clients.
 * - Never accept arbitrary MongoDB operators.
 * - Never allow prototype pollution keys.
 * - Never silently coerce malformed identifiers.
 * - Normalize user-controlled strings before business processing.
 * - Keep financial/reward authorization in the service layer.
 *
 * IMPORTANT:
 * -----------------------------------------------------------------------------
 * Validation is NOT authorization.
 *
 * This validator verifies request shape and basic semantic correctness.
 * Referral ownership, tenant isolation, reward eligibility, fraud controls,
 * status transitions, ledger posting, idempotency and authorization MUST be
 * enforced by the service/domain layer.
 *
 * TITech multi-tenant rule:
 * -----------------------------------------------------------------------------
 * req.tenantId is authoritative.
 *
 * A client-provided tenantId must NEVER override req.tenantId.
 *
 * =============================================================================
 */

const mongoose = require("mongoose");

const { Types } = mongoose;

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const MAX_CODE_LENGTH = 64;
const MIN_CODE_LENGTH = 4;

const MAX_NOTE_LENGTH = 1000;
const MAX_SOURCE_LENGTH = 100;

const MAX_PAGE_LIMIT = 100;
const DEFAULT_PAGE_LIMIT = 20;

const MAX_SEARCH_LENGTH = 100;

const MAX_REWARD_AMOUNT = 1000000000000; // Final business limits belong to service layer.

const REFERRAL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{3,63}$/;

const ALLOWED_REWARD_TYPES = Object.freeze([
  "cashback",
  "savings_bonus",
  "loan_discount",
]);

const ALLOWED_REWARD_CURRENCIES = Object.freeze([
  "UGX",
  "KES",
  "TZS",
  "RWF",
  "ETB",
  "NGN",
  "USD",
]);

const ALLOWED_SORT_FIELDS = Object.freeze([
  "createdAt",
  "updatedAt",
  "status",
  "completedAt",
  "rewardAmount",
]);

const ALLOWED_SORT_DIRECTIONS = Object.freeze([
  "asc",
  "desc",
]);

const ALLOWED_STATUSES = Object.freeze([
  "pending",
  "qualified",
  "completed",
  "reward_pending",
  "rewarded",
  "cancelled",
  "rejected",
  "fraud_review",
]);

/**
 * =============================================================================
 * GENERIC HELPERS
 * =============================================================================
 */

/**
 * Create a consistent validation error.
 *
 * Express applications frequently expect either:
 *
 *   next(error)
 *
 * or:
 *
 *   req.validationErrors
 *
 * This helper returns a normal Error with structured metadata while remaining
 * compatible with standard Express error middleware.
 */
function createValidationError(message, details = []) {
  const error = new Error(message);

  error.name = "ValidationError";
  error.statusCode = 400;
  error.code = "VALIDATION_ERROR";
  error.details = details;

  return error;
}

/**
 * Attach validation errors to the request.
 */
function fail(req, next, message, details = []) {
  return next(createValidationError(message, details));
}

/**
 * Determine whether a value is a plain object.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Reject MongoDB/operator-style keys.
 *
 * This protects against payloads such as:
 *
 * {
 *   "$where": "...",
 *   "status": { "$ne": "cancelled" }
 * }
 *
 * Validation alone is not a substitute for safe query construction, but
 * rejecting operator-shaped request fields adds an important defense layer.
 */
function containsUnsafeKeys(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(containsUnsafeKeys);
  }

  return Object.entries(value).some(([key, nestedValue]) => {
    if (
      key.startsWith("$") ||
      key.includes(".") ||
      key === "__proto__" ||
      key === "prototype" ||
      key === "constructor"
    ) {
      return true;
    }

    return containsUnsafeKeys(nestedValue);
  });
}

/**
 * Trim a string without converting arbitrary values.
 */
function normalizeString(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}

/**
 * Normalize an email address.
 */
function normalizeEmail(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim().toLowerCase();
}

/**
 * Normalize referral codes.
 *
 * Referral codes are treated as case-insensitive at the API boundary and
 * stored/processed in canonical uppercase form.
 */
function normalizeReferralCode(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim().toUpperCase();
}

/**
 * Validate a MongoDB ObjectId.
 */
function isValidObjectId(value) {
  return (
    typeof value === "string" &&
    Types.ObjectId.isValid(value) &&
    String(new Types.ObjectId(value)) === value.toLowerCase()
  );
}

/**
 * Validate a positive numeric amount.
 *
 * Financial amounts must ultimately be validated against currency-specific
 * precision and business rules in the service/ledger layer.
 */
function isPositiveAmount(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 && value <= MAX_REWARD_AMOUNT;
  }

  if (typeof value === "string") {
    if (!/^\d+(\.\d{1,8})?$/.test(value.trim())) {
      return false;
    }

    const numeric = Number(value);

    return (
      Number.isFinite(numeric) &&
      numeric > 0 &&
      numeric <= MAX_REWARD_AMOUNT
    );
  }

  return false;
}

/**
 * Validate pagination.
 */
function normalizePagination(req) {
  const rawPage = req.query?.page;
  const rawLimit = req.query?.limit;

  let page = Number.parseInt(rawPage, 10);
  let limit = Number.parseInt(rawLimit, 10);

  if (!Number.isInteger(page) || page < 1) {
    page = 1;
  }

  if (!Number.isInteger(limit) || limit < 1) {
    limit = DEFAULT_PAGE_LIMIT;
  }

  if (limit > MAX_PAGE_LIMIT) {
    limit = MAX_PAGE_LIMIT;
  }

  req.query.page = page;
  req.query.limit = limit;

  return {
    page,
    limit,
  };
}

/**
 * Validate optional date values.
 */
function isValidDateInput(value) {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }

  if (typeof value !== "string") {
    return false;
  }

  const date = new Date(value);

  return !Number.isNaN(date.getTime());
}

/**
 * Reject unknown fields.
 */
function validateAllowedFields(req, next, allowedFields) {
  const body = req.body || {};

  if (!isPlainObject(body)) {
    return fail(req, next, "Request body must be a valid JSON object.");
  }

  const unknownFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field)
  );

  if (unknownFields.length > 0) {
    return fail(
      req,
      next,
      "Request contains unsupported fields.",
      unknownFields.map((field) => ({
        field,
        code: "UNKNOWN_FIELD",
      }))
    );
  }

  return true;
}

/**
 * =============================================================================
 * GLOBAL REQUEST GUARD
 * =============================================================================
 */

/**
 * Protect referral endpoints from malformed/operator payloads.
 *
 * Recommended middleware order:
 *
 *   authenticate
 *      ↓
 *   tenant
 *      ↓
 *   referralValidator.validateRequest
 *      ↓
 *   controller
 */
function validateRequest(req, res, next) {
  if (containsUnsafeKeys(req.body)) {
    return fail(req, next, "Request contains unsafe fields.");
  }

  if (containsUnsafeKeys(req.query)) {
    return fail(req, next, "Query contains unsafe fields.");
  }

  if (containsUnsafeKeys(req.params)) {
    return fail(req, next, "Route parameters contain unsafe fields.");
  }

  return next();
}

/**
 * =============================================================================
 * TENANT CONTEXT VALIDATION
 * =============================================================================
 */

/**
 * Verify that the request has server-derived tenant context.
 *
 * IMPORTANT:
 * This does NOT trust req.body.tenantId.
 *
 * Tenant middleware/authentication must establish req.tenantId before this
 * validator executes.
 */
function validateTenantContext(req, res, next) {
  if (!req.tenantId) {
    return fail(
      req,
      next,
      "Tenant context is required.",
      [
        {
          field: "tenantId",
          code: "TENANT_CONTEXT_REQUIRED",
        },
      ]
    );
  }

  if (!isValidObjectId(String(req.tenantId))) {
    return fail(
      req,
      next,
      "Invalid tenant context.",
      [
        {
          field: "tenantId",
          code: "INVALID_TENANT_ID",
        },
      ]
    );
  }

  return next();
}

/**
 * =============================================================================
 * AUTHENTICATED USER CONTEXT
 * =============================================================================
 */

function validateAuthenticatedUser(req, res, next) {
  if (!req.user) {
    return fail(
      req,
      next,
      "Authenticated user context is required.",
      [
        {
          field: "user",
          code: "AUTHENTICATION_REQUIRED",
        },
      ]
    );
  }

  const userId =
    req.user._id ||
    req.user.id ||
    req.user.userId;

  if (!userId || !isValidObjectId(String(userId))) {
    return fail(
      req,
      next,
      "Authenticated user identity is invalid.",
      [
        {
          field: "user",
          code: "INVALID_AUTHENTICATED_USER",
        },
      ]
    );
  }

  return next();
}

/**
 * =============================================================================
 * CREATE REFERRAL
 * =============================================================================
 *
 * Typical request:
 *
 * POST /api/referrals
 *
 * {
 *   "referralCode": "TITECH123",
 *   "source": "mobile_app"
 * }
 *
 * The referrer must normally be derived from req.user.
 * A client must not be able to impersonate another referrer.
 */
function validateCreateReferral(req, res, next) {
  const allowedFields = [
    "referralCode",
    "source",
    "notes",
  ];

  const validFields = validateAllowedFields(req, next, allowedFields);

  if (validFields !== true) {
    return validFields;
  }

  const body = req.body || {};

  if (body.referralCode === undefined) {
    return fail(
      req,
      next,
      "Referral code is required.",
      [
        {
          field: "referralCode",
          code: "REQUIRED",
        },
      ]
    );
  }

  if (typeof body.referralCode !== "string") {
    return fail(
      req,
      next,
      "Referral code must be a string.",
      [
        {
          field: "referralCode",
          code: "INVALID_TYPE",
        },
      ]
    );
  }

  body.referralCode = normalizeReferralCode(body.referralCode);

  if (
    body.referralCode.length < MIN_CODE_LENGTH ||
    body.referralCode.length > MAX_CODE_LENGTH
  ) {
    return fail(
      req,
      next,
      `Referral code must be between ${MIN_CODE_LENGTH} and ${MAX_CODE_LENGTH} characters.`,
      [
        {
          field: "referralCode",
          code: "INVALID_LENGTH",
        },
      ]
    );
  }

  if (!REFERRAL_CODE_PATTERN.test(body.referralCode)) {
    return fail(
      req,
      next,
      "Referral code contains invalid characters.",
      [
        {
          field: "referralCode",
          code: "INVALID_FORMAT",
        },
      ]
    );
  }

  if (body.source !== undefined) {
    if (typeof body.source !== "string") {
      return fail(req, next, "Referral source must be a string.");
    }

    body.source = normalizeString(body.source);

    if (
      body.source.length === 0 ||
      body.source.length > MAX_SOURCE_LENGTH
    ) {
      return fail(
        req,
        next,
        `Referral source must not exceed ${MAX_SOURCE_LENGTH} characters.`
      );
    }
  }

  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") {
      return fail(req, next, "Referral notes must be a string.");
    }

    body.notes = normalizeString(body.notes);

    if (body.notes.length > MAX_NOTE_LENGTH) {
      return fail(
        req,
        next,
        `Referral notes must not exceed ${MAX_NOTE_LENGTH} characters.`
      );
    }
  }

  /**
   * Explicitly remove client-controlled identity/tenant fields if they were
   * somehow injected before validation.
   *
   * The allowed-field validation already rejects them, but this defensive
   * deletion protects against middleware that mutates req.body later.
   */
  delete body.tenantId;
  delete body.referrerId;
  delete body.referredUserId;
  delete body.rewardAmount;
  delete body.rewardType;
  delete body.rewardCurrency;
  delete body.status;

  return next();
}

/**
 * =============================================================================
 * APPLY / REDEEM REFERRAL CODE
 * =============================================================================
 *
 * Typical request:
 *
 * POST /api/referrals/apply
 *
 * {
 *   "referralCode": "TITECH123"
 * }
 */
function validateApplyReferral(req, res, next) {
  const allowedFields = [
    "referralCode",
  ];

  const validFields = validateAllowedFields(req, next, allowedFields);

  if (validFields !== true) {
    return validFields;
  }

  const body = req.body || {};

  if (typeof body.referralCode !== "string") {
    return fail(req, next, "Referral code is required.");
  }

  body.referralCode = normalizeReferralCode(body.referralCode);

  if (
    body.referralCode.length < MIN_CODE_LENGTH ||
    body.referralCode.length > MAX_CODE_LENGTH
  ) {
    return fail(req, next, "Invalid referral code length.");
  }

  if (!REFERRAL_CODE_PATTERN.test(body.referralCode)) {
    return fail(req, next, "Invalid referral code format.");
  }

  return next();
}

/**
 * =============================================================================
 * REFERRAL CODE VALIDATION
 * =============================================================================
 */

function validateReferralCode(req, res, next) {
  const code =
    req.params?.code ||
    req.query?.code ||
    req.body?.referralCode;

  if (typeof code !== "string") {
    return fail(req, next, "Referral code is required.");
  }

  const normalized = normalizeReferralCode(code);

  if (!REFERRAL_CODE_PATTERN.test(normalized)) {
    return fail(req, next, "Invalid referral code format.");
  }

  if (req.params?.code !== undefined) {
    req.params.code = normalized;
  }

  if (req.query?.code !== undefined) {
    req.query.code = normalized;
  }

  if (req.body?.referralCode !== undefined) {
    req.body.referralCode = normalized;
  }

  return next();
}

/**
 * =============================================================================
 * OBJECT ID PARAMETER VALIDATION
 * =============================================================================
 */

function validateReferralId(req, res, next) {
  const referralId = req.params?.referralId || req.params?.id;

  if (!referralId) {
    return fail(req, next, "Referral ID is required.");
  }

  if (!isValidObjectId(String(referralId))) {
    return fail(
      req,
      next,
      "Invalid referral ID.",
      [
        {
          field: "referralId",
          code: "INVALID_OBJECT_ID",
        },
      ]
    );
  }

  return next();
}

/**
 * =============================================================================
 * REFERRAL QUERY VALIDATION
 * =============================================================================
 */

function validateReferralQuery(req, res, next) {
  const allowedQueryFields = [
    "page",
    "limit",
    "status",
    "rewardType",
    "rewardCurrency",
    "referrerId",
    "referredUserId",
    "search",
    "sortBy",
    "sortOrder",
    "from",
    "to",
  ];

  const queryKeys = Object.keys(req.query || {});

  const unknownFields = queryKeys.filter(
    (field) => !allowedQueryFields.includes(field)
  );

  if (unknownFields.length > 0) {
    return fail(
      req,
      next,
      "Query contains unsupported fields.",
      unknownFields.map((field) => ({
        field,
        code: "UNKNOWN_QUERY_FIELD",
      }))
    );
  }

  normalizePagination(req);

  if (req.query.status !== undefined) {
    const status = normalizeString(req.query.status);

    if (!ALLOWED_STATUSES.includes(status)) {
      return fail(
        req,
        next,
        "Invalid referral status.",
        [
          {
            field: "status",
            code: "INVALID_STATUS",
          },
        ]
      );
    }

    req.query.status = status;
  }

  if (req.query.rewardType !== undefined) {
    const rewardType = normalizeString(req.query.rewardType);

    if (!ALLOWED_REWARD_TYPES.includes(rewardType)) {
      return fail(req, next, "Invalid reward type.");
    }

    req.query.rewardType = rewardType;
  }

  if (req.query.rewardCurrency !== undefined) {
    const rewardCurrency = normalizeString(
      req.query.rewardCurrency
    ).toUpperCase();

    if (!ALLOWED_REWARD_CURRENCIES.includes(rewardCurrency)) {
      return fail(req, next, "Invalid reward currency.");
    }

    req.query.rewardCurrency = rewardCurrency;
  }

  if (req.query.referrerId !== undefined) {
    if (!isValidObjectId(String(req.query.referrerId))) {
      return fail(req, next, "Invalid referrer ID.");
    }
  }

  if (req.query.referredUserId !== undefined) {
    if (!isValidObjectId(String(req.query.referredUserId))) {
      return fail(req, next, "Invalid referred user ID.");
    }
  }

  if (req.query.search !== undefined) {
    if (typeof req.query.search !== "string") {
      return fail(req, next, "Search must be a string.");
    }

    req.query.search = normalizeString(req.query.search);

    if (
      req.query.search.length === 0 ||
      req.query.search.length > MAX_SEARCH_LENGTH
    ) {
      return fail(
        req,
        next,
        `Search must be between 1 and ${MAX_SEARCH_LENGTH} characters.`
      );
    }
  }

  if (req.query.sortBy !== undefined) {
    if (!ALLOWED_SORT_FIELDS.includes(req.query.sortBy)) {
      return fail(req, next, "Invalid referral sort field.");
    }
  }

  if (req.query.sortOrder !== undefined) {
    const sortOrder = normalizeString(req.query.sortOrder).toLowerCase();

    if (!ALLOWED_SORT_DIRECTIONS.includes(sortOrder)) {
      return fail(req, next, "Invalid sort order.");
    }

    req.query.sortOrder = sortOrder;
  }

  if (req.query.from !== undefined) {
    if (!isValidDateInput(req.query.from)) {
      return fail(req, next, "Invalid start date.");
    }
  }

  if (req.query.to !== undefined) {
    if (!isValidDateInput(req.query.to)) {
      return fail(req, next, "Invalid end date.");
    }
  }

  if (req.query.from && req.query.to) {
    const from = new Date(req.query.from);
    const to = new Date(req.query.to);

    if (from > to) {
      return fail(
        req,
        next,
        "Start date cannot be later than end date."
      );
    }
  }

  return next();
}

/**
 * =============================================================================
 * REWARD REQUEST VALIDATION
 * =============================================================================
 *
 * IMPORTANT:
 *
 * Public clients should generally NOT be allowed to determine reward values.
 *
 * This validator exists for controlled internal/admin/service endpoints where
 * rewardType/currency may legitimately be supplied.
 *
 * The actual amount must still be calculated by the reward policy engine.
 */
function validateRewardRequest(req, res, next) {
  const allowedFields = [
    "rewardType",
    "rewardCurrency",
    "rewardAmount",
    "reason",
  ];

  const validFields = validateAllowedFields(req, next, allowedFields);

  if (validFields !== true) {
    return validFields;
  }

  const body = req.body || {};

  if (body.rewardType !== undefined) {
    if (!ALLOWED_REWARD_TYPES.includes(body.rewardType)) {
      return fail(req, next, "Invalid reward type.");
    }
  }

  if (body.rewardCurrency !== undefined) {
    if (typeof body.rewardCurrency !== "string") {
      return fail(req, next, "Reward currency must be a string.");
    }

    body.rewardCurrency = body.rewardCurrency.trim().toUpperCase();

    if (!ALLOWED_REWARD_CURRENCIES.includes(body.rewardCurrency)) {
      return fail(req, next, "Invalid reward currency.");
    }
  }

  if (body.rewardAmount !== undefined) {
    if (!isPositiveAmount(body.rewardAmount)) {
      return fail(
        req,
        next,
        "Reward amount must be a valid positive monetary amount."
      );
    }

    /**
     * Preserve decimal precision supplied by the client.
     *
     * The financial/ledger layer must convert the final value into the
     * platform's canonical minor-unit representation.
     */
    if (typeof body.rewardAmount === "string") {
      body.rewardAmount = body.rewardAmount.trim();
    }
  }

  if (body.reason !== undefined) {
    if (typeof body.reason !== "string") {
      return fail(req, next, "Reward reason must be a string.");
    }

    body.reason = normalizeString(body.reason);

    if (body.reason.length > MAX_NOTE_LENGTH) {
      return fail(
        req,
        next,
        `Reward reason must not exceed ${MAX_NOTE_LENGTH} characters.`
      );
    }
  }

  return next();
}

/**
 * =============================================================================
 * INTERNAL REFERRAL STATUS VALIDATION
 * =============================================================================
 *
 * Status changes should only be exposed to trusted internal/admin endpoints.
 *
 * Never expose arbitrary status transitions directly to public clients.
 */
function validateStatusUpdate(req, res, next) {
  const allowedFields = [
    "status",
    "reason",
  ];

  const validFields = validateAllowedFields(req, next, allowedFields);

  if (validFields !== true) {
    return validFields;
  }

  const body = req.body || {};

  if (!ALLOWED_STATUSES.includes(body.status)) {
    return fail(req, next, "Invalid referral status.");
  }

  if (body.reason !== undefined) {
    if (typeof body.reason !== "string") {
      return fail(req, next, "Status reason must be a string.");
    }

    body.reason = normalizeString(body.reason);

    if (body.reason.length > MAX_NOTE_LENGTH) {
      return fail(
        req,
        next,
        `Status reason must not exceed ${MAX_NOTE_LENGTH} characters.`
      );
    }
  }

  return next();
}

/**
 * =============================================================================
 * REFERRER LOOKUP VALIDATION
 * ============================================================================= */

function validateReferrerId(req, res, next) {
  const referrerId =
    req.params?.referrerId ||
    req.query?.referrerId ||
    req.body?.referrerId;

  if (!referrerId) {
    return fail(req, next, "Referrer ID is required.");
  }

  if (!isValidObjectId(String(referrerId))) {
    return fail(req, next, "Invalid referrer ID.");
  }

  return next();
}

/**
 * =============================================================================
 * REFERRED USER VALIDATION
 * ============================================================================= */

function validateReferredUserId(req, res, next) {
  const referredUserId =
    req.params?.referredUserId ||
    req.query?.referredUserId ||
    req.body?.referredUserId;

  if (!referredUserId) {
    return fail(req, next, "Referred user ID is required.");
  }

  if (!isValidObjectId(String(referredUserId))) {
    return fail(req, next, "Invalid referred user ID.");
  }

  return next();
}

/**
 * =============================================================================
 * SELF-REFERRAL PROTECTION
 * =============================================================================
 *
 * This is an early validation guard only.
 *
 * The definitive check must also occur transactionally inside the service layer
 * because identities may be represented differently depending on the endpoint.
 */
function validateNoSelfReferral(req, res, next) {
  const authenticatedUserId =
    req.user?._id ||
    req.user?.id ||
    req.user?.userId;

  const referrerId =
    req.body?.referrerId ||
    req.params?.referrerId ||
    req.query?.referrerId;

  const referredUserId =
    req.body?.referredUserId ||
    req.params?.referredUserId ||
    req.query?.referredUserId;

  if (
    authenticatedUserId &&
    referredUserId &&
    String(authenticatedUserId) === String(referredUserId)
  ) {
    return fail(
      req,
      next,
      "A user cannot refer themselves."
    );
  }

  if (
    referrerId &&
    referredUserId &&
    String(referrerId) === String(referredUserId)
  ) {
    return fail(
      req,
      next,
      "Referrer and referred user must be different."
    );
  }

  return next();
}

/**
 * =============================================================================
 * PAGINATION VALIDATION
 * =============================================================================
 */

function validatePagination(req, res, next) {
  normalizePagination(req);

  return next();
}

/**
 * =============================================================================
 * DATE RANGE VALIDATION
 * ============================================================================= */

function validateDateRange(req, res, next) {
  const from = req.query?.from;
  const to = req.query?.to;

  if (from !== undefined && !isValidDateInput(from)) {
    return fail(req, next, "Invalid start date.");
  }

  if (to !== undefined && !isValidDateInput(to)) {
    return fail(req, next, "Invalid end date.");
  }

  if (from && to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (fromDate > toDate) {
      return fail(
        req,
        next,
        "Start date cannot be later than end date."
      );
    }
  }

  return next();
}

/**
 * =============================================================================
 * EMAIL VALIDATION
 * =============================================================================
 *
 * Useful for referral endpoints that optionally identify a referred party
 * by email during invitation flows.
 */
function validateReferralEmail(req, res, next) {
  const email =
    req.body?.email ||
    req.body?.referredEmail ||
    req.query?.email;

  if (email === undefined) {
    return fail(req, next, "Email address is required.");
  }

  if (typeof email !== "string") {
    return fail(req, next, "Email address must be a string.");
  }

  const normalized = normalizeEmail(email);

  /**
   * Deliberately conservative email validation.
   *
   * Full deliverability verification belongs to the email/identity layer.
   */
  const emailPattern =
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  if (!emailPattern.test(normalized)) {
    return fail(req, next, "Invalid email address.");
  }

  if (normalized.length > 254) {
    return fail(req, next, "Email address is too long.");
  }

  if (req.body?.email !== undefined) {
    req.body.email = normalized;
  }

  if (req.body?.referredEmail !== undefined) {
    req.body.referredEmail = normalized;
  }

  if (req.query?.email !== undefined) {
    req.query.email = normalized;
  }

  return next();
}

/**
 * =============================================================================
 * REFERRAL INVITATION VALIDATION
 * =============================================================================
 */

function validateInvitation(req, res, next) {
  const allowedFields = [
    "email",
    "referralCode",
    "message",
  ];

  const validFields = validateAllowedFields(req, next, allowedFields);

  if (validFields !== true) {
    return validFields;
  }

  const body = req.body || {};

  if (!body.email || typeof body.email !== "string") {
    return fail(req, next, "Recipient email is required.");
  }

  body.email = normalizeEmail(body.email);

  const emailPattern =
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  if (
    body.email.length > 254 ||
    !emailPattern.test(body.email)
  ) {
    return fail(req, next, "Invalid recipient email.");
  }

  if (body.referralCode !== undefined) {
    if (typeof body.referralCode !== "string") {
      return fail(req, next, "Referral code must be a string.");
    }

    body.referralCode = normalizeReferralCode(body.referralCode);

    if (!REFERRAL_CODE_PATTERN.test(body.referralCode)) {
      return fail(req, next, "Invalid referral code.");
    }
  }

  if (body.message !== undefined) {
    if (typeof body.message !== "string") {
      return fail(req, next, "Invitation message must be a string.");
    }

    body.message = normalizeString(body.message);

    if (body.message.length > MAX_NOTE_LENGTH) {
      return fail(
        req,
        next,
        `Invitation message must not exceed ${MAX_NOTE_LENGTH} characters.`
      );
    }
  }

  return next();
}

/**
 * =============================================================================
 * ADMIN REFERRAL SEARCH VALIDATION
 * =============================================================================
 */

function validateAdminReferralQuery(req, res, next) {
  return validateReferralQuery(req, res, next);
}

/**
 * =============================================================================
 * EXPORTS
 * =============================================================================
 *
 * Both named middleware exports and a default-style object are provided for
 * compatibility with different route/controller conventions.
 * =============================================================================
 */

module.exports = Object.freeze({
  // Global/security guards
  validateRequest,
  validateTenantContext,
  validateAuthenticatedUser,

  // Creation/application
  validateCreateReferral,
  validateApplyReferral,
  validateInvitation,

  // Referral identification
  validateReferralCode,
  validateReferralId,
  validateReferrerId,
  validateReferredUserId,

  // Queries and filtering
  validateReferralQuery,
  validateAdminReferralQuery,
  validatePagination,
  validateDateRange,

  // Referral integrity
  validateNoSelfReferral,

  // Internal/admin reward operations
  validateRewardRequest,
  validateStatusUpdate,

  // Optional invitation identity
  validateReferralEmail,

  // Exposed constants for service/test layers
  ALLOWED_REWARD_TYPES,
  ALLOWED_REWARD_CURRENCIES,
  ALLOWED_STATUSES,
  ALLOWED_SORT_FIELDS,
  ALLOWED_SORT_DIRECTIONS,
});