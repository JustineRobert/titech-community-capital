/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/utils/validators.js
 *
 * Purpose:
 *   Centralized, enterprise-grade request validation for the TITech Community
 *   Capital backend.
 *
 * Design principles:
 *   - ESM-compatible
 *   - express-validator based
 *   - Small, composable validation chains
 *   - Strict type/format validation
 *   - Safe normalization without corrupting persisted data
 *   - Consistent validation-error shape
 *   - Backwards-compatible validationRules exports
 *   - Backwards-compatible handleValidation alias
 *   - No controller/business-logic dependencies
 *   - No database access
 *   - No circular dependencies
 *
 * IMPORTANT:
 *   Validation is NOT authorization.
 *   Validation is NOT business-rule enforcement.
 *   Validation is NOT financial integrity enforcement.
 *
 *   Controllers/services must still enforce:
 *     - authentication
 *     - authorization
 *     - tenant isolation
 *     - membership
 *     - account ownership
 *     - financial limits
 *     - loan eligibility
 *     - ledger invariants
 *     - idempotency
 *     - transaction boundaries
 *
 * TITech Community Capital financial mutations must remain inside the
 * canonical FinancialTransactionService / domain service boundary.
 *
 * =============================================================================
 */

import {
  body,
  param,
  query,
  validationResult,
} from 'express-validator';

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const MAX_NAME_LEN = 100;
const MAX_GROUP_NAME_LEN = 100;
const MAX_GROUP_DESC_LEN = 500;
const MAX_NOTE_LEN = 1000;
const MAX_REASON_LEN = 300;
const MAX_OCCUPATION_LEN = 100;
const MAX_CITY_LEN = 100;

const MIN_PASSWORD_LEN = 12;
const MAX_PASSWORD_LEN = 128;

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

const MAX_MONEY_AMOUNT = 999_999_999_999.99;

const ISO_DATE_OPTIONS = {
  strict: true,
};

/**
 * =============================================================================
 * Internal helpers
 * =============================================================================
 */

/**
 * Normalize a string without HTML escaping.
 *
 * IMPORTANT:
 *   express-validator's `.escape()` is intentionally NOT used for persisted
 *   values. HTML escaping is an output/rendering concern and applying it during
 *   request validation can corrupt legitimate user data.
 */
const normalizeOptionalString = (value) => {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().replace(/\s+/g, ' ');
};

/**
 * Strictly determine whether a value is blank.
 */
const isBlank = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim().length === 0);

/**
 * Validate a positive monetary amount.
 *
 * NOTE:
 *   This performs request-level validation only.
 *   Financial services must use Decimal128 / exact decimal arithmetic or the
 *   project's canonical money abstraction for actual financial calculations.
 */
const isValidMoneyAmount = (value) => {
  if (value === undefined || value === null || value === '') {
    return false;
  }

  const numericValue = Number(value);

  return (
    Number.isFinite(numericValue) &&
    numericValue > 0 &&
    numericValue <= MAX_MONEY_AMOUNT
  );
};

/**
 * Validate an ISO-8601 date.
 */
const isValidDateValue = (value) => {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }

  if (typeof value !== 'string') {
    return false;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp);
};

/**
 * Ensure a date is not in the past.
 */
const isTodayOrFuture = (value) => {
  if (!isValidDateValue(value)) {
    return false;
  }

  const date = new Date(value);
  const now = new Date();

  date.setHours(23, 59, 59, 999);

  return date >= now;
};

/**
 * =============================================================================
 * Reusable primitive validators
 * =============================================================================
 */

/**
 * MongoDB ObjectId.
 */
export const isValidMongoId = (id) =>
  /^[0-9a-fA-F]{24}$/.test(String(id ?? ''));

/**
 * Strict email validator.
 *
 * express-validator's isEmail() remains the primary request validator.
 * This helper exists for service/domain-level reuse.
 */
export const isValidEmail = (email) => {
  if (typeof email !== 'string') {
    return false;
  }

  const value = email.trim();

  if (value.length === 0 || value.length > 254) {
    return false;
  }

  /**
   * Deliberately conservative application-level email check.
   * Full RFC email parsing is outside the responsibility of this utility.
   */
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value);
};

/**
 * Strong password helper.
 *
 * Requirements:
 *   - minimum 12 characters
 *   - maximum 128 characters
 *   - lowercase
 *   - uppercase
 *   - number
 *   - no whitespace
 */
export const isStrongPassword = (password) => {
  if (typeof password !== 'string') {
    return false;
  }

  return (
    password.length >= MIN_PASSWORD_LEN &&
    password.length <= MAX_PASSWORD_LEN &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    !/\s/.test(password)
  );
};

/**
 * =============================================================================
 * Reusable field validators
 * =============================================================================
 */

/**
 * MongoDB ObjectId body field.
 */
const mongoIdBody = (field, message = `${field} must be a valid ID`) =>
  body(field)
    .notEmpty()
    .withMessage(`${field} is required`)
    .bail()
    .isMongoId()
    .withMessage(message);

/**
 * MongoDB ObjectId route parameter.
 */
const mongoIdParam = (field, message = `${field} must be a valid ID`) =>
  param(field)
    .notEmpty()
    .withMessage(`${field} is required`)
    .bail()
    .isMongoId()
    .withMessage(message);

/**
 * Positive money body field.
 */
const positiveMoney = (
  field,
  requiredMessage = `${field} is required`,
  invalidMessage = `${field} must be greater than 0`,
) =>
  body(field)
    .notEmpty()
    .withMessage(requiredMessage)
    .bail()
    .isNumeric()
    .withMessage(`${field} must be a valid number`)
    .bail()
    .custom(isValidMoneyAmount)
    .withMessage(invalidMessage)
    .bail()
    .custom((value) => {
      const stringValue = String(value);

      /**
       * Reject excessive decimal precision at the API boundary.
       * Financial calculations must still use the canonical money service.
       */
      const [, decimals] = stringValue.split('.');

      return !decimals || decimals.length <= 2;
    })
    .withMessage(`${field} must have at most 2 decimal places`)
    .toFloat();

/**
 * Optional normalized string.
 */
const optionalString = (field, maxLength, message) =>
  body(field)
    .optional({ nullable: true })
    .isString()
    .withMessage(`${field} must be a string`)
    .bail()
    .customSanitizer(normalizeOptionalString)
    .isLength({ max: maxLength })
    .withMessage(
      message ?? `${field} must not exceed ${maxLength} characters`,
    );

/**
 * Required normalized string.
 */
const requiredString = (
  field,
  {
    min = 1,
    max,
    requiredMessage = `${field} is required`,
    minMessage,
    maxMessage,
  } = {},
) => {
  let chain = body(field)
    .notEmpty()
    .withMessage(requiredMessage)
    .bail()
    .isString()
    .withMessage(`${field} must be a string`)
    .bail()
    .customSanitizer(normalizeOptionalString)
    .isLength({ min })
    .withMessage(
      minMessage ?? `${field} must be at least ${min} characters`,
    );

  if (max !== undefined) {
    chain = chain
      .isLength({ max })
      .withMessage(
        maxMessage ?? `${field} must not exceed ${max} characters`,
      );
  }

  return chain;
};

/**
 * =============================================================================
 * Date-range validation
 * =============================================================================
 *
 * Ensures:
 *
 *   from <= to
 *
 * The parsed Date objects are stored back into req.query by express-validator.
 */
export const validateFromTo = [
  query('from')
    .optional({ nullable: true })
    .isISO8601(ISO_DATE_OPTIONS)
    .withMessage('from must be a valid ISO-8601 date')
    .bail()
    .toDate(),

  query('to')
    .optional({ nullable: true })
    .isISO8601(ISO_DATE_OPTIONS)
    .withMessage('to must be a valid ISO-8601 date')
    .bail()
    .toDate(),

  query('to').custom((to, { req }) => {
    const from = req.query.from;

    if (!from || !to) {
      return true;
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (
      Number.isNaN(fromDate.getTime()) ||
      Number.isNaN(toDate.getTime())
    ) {
      return true;
    }

    if (fromDate > toDate) {
      throw new Error(
        '`from` must be earlier than or equal to `to`',
      );
    }

    return true;
  }),
];

/**
 * =============================================================================
 * Pagination validation
 * =============================================================================
 */

export const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1, max: Number.MAX_SAFE_INTEGER })
    .withMessage('page must be a positive integer')
    .toInt(),

  query('limit')
    .optional()
    .isInt({ min: 1, max: MAX_PAGE_SIZE })
    .withMessage(`limit must be between 1 and ${MAX_PAGE_SIZE}`)
    .toInt(),

  query('limit').customSanitizer(
    (value) => value ?? DEFAULT_PAGE_SIZE,
  ),
];

/**
 * =============================================================================
 * Validation Rules
 * =============================================================================
 */

export const validationRules = {
  // ===========================================================================
  // Authentication
  // ===========================================================================

  register: [
    /**
     * Name compatibility:
     *
     * Supported:
     *   name
     *   fullName
     *   firstName + lastName
     *
     * Existing clients are therefore not unnecessarily broken.
     */
    body('name')
      .optional({ nullable: true })
      .isString()
      .withMessage('Name must be a string')
      .bail()
      .customSanitizer(normalizeOptionalString)
      .isLength({ min: 2 })
      .withMessage('Name must be at least 2 characters')
      .isLength({ max: MAX_NAME_LEN })
      .withMessage(
        `Name must not exceed ${MAX_NAME_LEN} characters`,
      )
      .matches(/^[\p{L}\s'-]+$/u)
      .withMessage(
        'Name can only contain letters, spaces, hyphens, and apostrophes',
      ),

    body('fullName')
      .optional({ nullable: true })
      .isString()
      .withMessage('Full name must be a string')
      .bail()
      .customSanitizer(normalizeOptionalString)
      .isLength({ min: 2 })
      .withMessage('Full name must be at least 2 characters')
      .isLength({ max: MAX_NAME_LEN })
      .withMessage(
        `Full name must not exceed ${MAX_NAME_LEN} characters`,
      ),

    body('firstName')
      .optional({ nullable: true })
      .isString()
      .withMessage('First name must be a string')
      .bail()
      .customSanitizer(normalizeOptionalString)
      .isLength({ min: 2 })
      .withMessage('First name must be at least 2 characters')
      .isLength({ max: MAX_NAME_LEN })
      .withMessage(
        `First name must not exceed ${MAX_NAME_LEN} characters`,
      ),

    body('lastName')
      .optional({ nullable: true })
      .isString()
      .withMessage('Last name must be a string')
      .bail()
      .customSanitizer(normalizeOptionalString)
      .isLength({ min: 2 })
      .withMessage('Last name must be at least 2 characters')
      .isLength({ max: MAX_NAME_LEN })
      .withMessage(
        `Last name must not exceed ${MAX_NAME_LEN} characters`,
      ),

    body('name').custom((value, { req }) => {
      const name = normalizeOptionalString(value);
      const fullName = normalizeOptionalString(req.body.fullName);
      const firstName = normalizeOptionalString(req.body.firstName);
      const lastName = normalizeOptionalString(req.body.lastName);

      if (
        isBlank(name) &&
        isBlank(fullName) &&
        (isBlank(firstName) || isBlank(lastName))
      ) {
        throw new Error(
          'Name, fullName, or firstName and lastName are required',
        );
      }

      return true;
    }),

    body('email')
      .trim()
      .toLowerCase()
      .isEmail({
        allow_display_name: false,
        require_tld: true,
      })
      .withMessage('Please provide a valid email')
      .bail()
      .isLength({ max: 254 })
      .withMessage('Email must not exceed 254 characters')
      .normalizeEmail(),

    body('password')
      .isString()
      .withMessage('Password must be a string')
      .bail()
      .isLength({ min: MIN_PASSWORD_LEN })
      .withMessage(
        `Password must be at least ${MIN_PASSWORD_LEN} characters`,
      )
      .isLength({ max: MAX_PASSWORD_LEN })
      .withMessage(
        `Password must not exceed ${MAX_PASSWORD_LEN} characters`,
      )
      .custom(isStrongPassword)
      .withMessage(
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and no spaces',
      ),

    body('phoneNumber')
      .optional({ nullable: true })
      .trim()
      .isMobilePhone('any')
      .withMessage('Please provide a valid phone number'),
  ],

  login: [
    body('email')
      .trim()
      .toLowerCase()
      .isEmail({
        allow_display_name: false,
        require_tld: true,
      })
      .withMessage('Please provide a valid email')
      .normalizeEmail(),

    body('password')
      .isString()
      .withMessage('Password is required')
      .bail()
      .notEmpty()
      .withMessage('Password is required'),
  ],

  // ===========================================================================
  // Group
  // ===========================================================================

  createGroup: [
    requiredString('name', {
      min: 3,
      max: MAX_GROUP_NAME_LEN,
      requiredMessage: 'Group name is required',
      minMessage: 'Group name must be at least 3 characters',
      maxMessage:
        `Group name must not exceed ${MAX_GROUP_NAME_LEN} characters`,
    }),

    body('description')
      .optional({ nullable: true })
      .isString()
      .withMessage('Description must be a string')
      .bail()
      .customSanitizer(normalizeOptionalString)
      .isLength({ max: MAX_GROUP_DESC_LEN })
      .withMessage(
        `Description must not exceed ${MAX_GROUP_DESC_LEN} characters`,
      ),
  ],

  // ===========================================================================
  // Contribution
  // ===========================================================================

  addContribution: [
    mongoIdBody('groupId', 'Invalid group ID'),

    positiveMoney(
      'amount',
      'Amount is required',
      'Amount must be greater than 0',
    ),

    optionalString('note', MAX_NOTE_LEN),

    body('date')
      .optional({ nullable: true })
      .isISO8601(ISO_DATE_OPTIONS)
      .withMessage('Invalid date format')
      .bail()
      .toDate(),
  ],

  // ===========================================================================
  // Loan
  // ===========================================================================

  createLoan: [
    mongoIdBody('groupId', 'Invalid group ID'),

    positiveMoney(
      'amount',
      'Amount is required',
      'Amount must be greater than 0',
    ),

    body('dueDate')
      .notEmpty()
      .withMessage('Due date is required')
      .bail()
      .isISO8601(ISO_DATE_OPTIONS)
      .withMessage('Invalid due date format')
      .bail()
      .toDate()
      .custom((value) => {
        if (!isTodayOrFuture(value)) {
          throw new Error('Due date must be today or a future date');
        }

        return true;
      }),

    requiredString('reason', {
      min: 1,
      max: MAX_REASON_LEN,
      requiredMessage: 'Loan reason is required',
      maxMessage:
        `Reason must not exceed ${MAX_REASON_LEN} characters`,
    }),
  ],

  // ===========================================================================
  // Profile / Settings
  // ===========================================================================

  updateProfile: [
    body('name')
      .optional({ nullable: true })
      .isString()
      .withMessage('Name must be a string')
      .bail()
      .customSanitizer(normalizeOptionalString)
      .isLength({ min: 2 })
      .withMessage('Name must be at least 2 characters')
      .isLength({ max: MAX_NAME_LEN })
      .withMessage(
        `Name must not exceed ${MAX_NAME_LEN} characters`,
      ),

    body('phone')
      .optional({ nullable: true })
      .trim()
      .isMobilePhone('any')
      .withMessage('Please provide a valid phone number'),

    body('profile.occupation')
      .optional({ nullable: true })
      .isString()
      .withMessage('Occupation must be a string')
      .bail()
      .customSanitizer(normalizeOptionalString)
      .isLength({ max: MAX_OCCUPATION_LEN })
      .withMessage(
        `Occupation must not exceed ${MAX_OCCUPATION_LEN} characters`,
      ),

    body('profile.city')
      .optional({ nullable: true })
      .isString()
      .withMessage('City must be a string')
      .bail()
      .customSanitizer(normalizeOptionalString)
      .isLength({ max: MAX_CITY_LEN })
      .withMessage(
        `City must not exceed ${MAX_CITY_LEN} characters`,
      ),
  ],

  // ===========================================================================
  // Reusable route parameter validators
  // ===========================================================================

  mongoIdParam: [
    mongoIdParam('id', 'Invalid resource ID'),
  ],

  groupIdParam: [
    mongoIdParam('groupId', 'Invalid group ID'),
  ],

  memberIdParam: [
    mongoIdParam('memberId', 'Invalid member ID'),
  ],

  loanIdParam: [
    mongoIdParam('loanId', 'Invalid loan ID'),
  ],

  contributionIdParam: [
    mongoIdParam(
      'contributionId',
      'Invalid contribution ID',
    ),
  ],

  // ===========================================================================
  // Common query validators
  // ===========================================================================

  dateRange: [
    ...validateFromTo,
    ...validatePagination,
  ],
};

/**
 * =============================================================================
 * Validation error middleware
 * =============================================================================
 *
 * Produces a stable error object for the global error handler.
 *
 * The global error handler remains responsible for:
 *   - HTTP response formatting
 *   - correlation/request IDs
 *   - logging
 *   - production-vs-development exposure
 *   - API envelope consistency
 */
export const handleValidationErrors = (req, res, next) => {
  const result = validationResult(req);

  if (result.isEmpty()) {
    return next();
  }

  const errors = result.array({
    onlyFirstError: false,
  }).map((error) => ({
    type: error.type,
    path: error.path,
    location: error.location,
    msg: error.msg,
    value: undefined,
  }));

  /**
   * Do not forward raw submitted values.
   *
   * This is especially important for:
   *   - passwords
   *   - tokens
   *   - financial values
   *   - personal information
   */
  return next({
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'Request validation failed',
    errors,
  });
};

/**
 * =============================================================================
 * Backwards compatibility
 * =============================================================================
 *
 * Existing routes currently use:
 *
 *   handleValidation
 *
 * Keep this alias so the validator refactor does not require an unnecessary
 * repository-wide route migration.
 */
export const handleValidation = handleValidationErrors;

/**
 * =============================================================================
 * Additional reusable validators
 * =============================================================================
 */

/**
 * Validate a boolean request field.
 */
export const booleanBody = (field) =>
  body(field)
    .optional()
    .isBoolean()
    .withMessage(`${field} must be a boolean`)
    .toBoolean();

/**
 * Validate a positive integer request field.
 */
export const positiveIntegerBody = (
  field,
  {
    required = true,
    min = 1,
    max = Number.MAX_SAFE_INTEGER,
  } = {},
) => {
  let chain = body(field);

  if (!required) {
    chain = chain.optional({ nullable: true });
  } else {
    chain = chain.notEmpty().withMessage(`${field} is required`);
  }

  return chain
    .isInt({ min, max })
    .withMessage(
      `${field} must be an integer between ${min} and ${max}`,
    )
    .toInt();
};

/**
 * Validate a UUID.
 *
 * Useful for:
 *   - idempotency identifiers
 *   - correlation identifiers
 *   - external references
 */
export const uuidBody = (
  field,
  {
    required = false,
  } = {},
) => {
  let chain = body(field);

  if (!required) {
    chain = chain.optional({ nullable: true });
  } else {
    chain = chain.notEmpty().withMessage(`${field} is required`);
  }

  return chain
    .isUUID()
    .withMessage(`${field} must be a valid UUID`);
};

/**
 * Validate a safe sort direction.
 */
export const sortDirectionQuery = (
  field = 'sortOrder',
) =>
  query(field)
    .optional()
    .isIn(['asc', 'desc', 'ASC', 'DESC'])
    .withMessage(
      `${field} must be either asc or desc`,
    )
    .customSanitizer((value) =>
      typeof value === 'string'
        ? value.toLowerCase()
        : value,
    );

/**
 * Validate a bounded search query.
 */
export const searchQuery = (
  field = 'search',
  maxLength = 100,
) =>
  query(field)
    .optional()
    .isString()
    .withMessage(`${field} must be a string`)
    .bail()
    .customSanitizer(normalizeOptionalString)
    .isLength({ max: maxLength })
    .withMessage(
      `${field} must not exceed ${maxLength} characters`,
    );

/**
 * =============================================================================
 * Default export
 * =============================================================================
 *
 * Named exports are preferred in the TITech ESM architecture.
 *
 * The default export is retained for convenience in modules that prefer:
 *
 *   import validators from './utils/validators.js';
 */
const validators = {
  validationRules,
  validateFromTo,
  validatePagination,
  handleValidationErrors,
  handleValidation,
  isValidMongoId,
  isValidEmail,
  isStrongPassword,
  booleanBody,
  positiveIntegerBody,
  uuidBody,
  sortDirectionQuery,
  searchQuery,
};

export default validators;