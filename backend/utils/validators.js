// utils/validators.js
// ============================================================================
// Centralized express-validator rules and middleware for Community Savings App.
// - Provides reusable validation chains for common entities.
// - Forwards errors to the global error handler via next({ status, errors }).
// - Avoids circular dependencies and keeps controllers clean.
// ============================================================================

const { body, query, validationResult } = require('express-validator');

const MAX_NAME_LEN = 100;
const MAX_GROUP_NAME_LEN = 100;
const MAX_GROUP_DESC_LEN = 500;
const MIN_PASSWORD_LEN = 8;
const MAX_REASON_LEN = 300;

/**
 * Cross-field validator to ensure `from` <= `to` when both provided.
 * Adds `.toDate()` for normalized Date objects downstream.
 */
const validateFromTo = [
  query('from').optional().isISO8601().toDate(),
  query('to').optional().isISO8601().toDate(),
  query('to').custom((to, { req }) => {
    const from = req.query.from;
    if (from && to && new Date(from) > new Date(to)) {
      throw new Error('`from` must be earlier than or equal to `to`');
    }
    return true;
  }),
];

/**
 * Validation Rules
 * Keep chains small and explicit for maintainability.
 */
const validationRules = {
  // ------------------------
  // Auth
  // ------------------------
  register: [
    body('name')
      .optional()
      .trim()
      .escape()
      .isLength({ min: 2 })
      .withMessage('Name must be at least 2 characters')
      .isLength({ max: MAX_NAME_LEN })
      .withMessage(`Name must not exceed ${MAX_NAME_LEN} characters`)
      .matches(/^[a-zA-Z\s'-]+$/)
      .withMessage('Name can only contain letters, spaces, hyphens, and apostrophes'),

    body('fullName')
      .optional()
      .trim()
      .escape()
      .isLength({ min: 2 })
      .withMessage('Full name must be at least 2 characters')
      .isLength({ max: MAX_NAME_LEN })
      .withMessage(`Full name must not exceed ${MAX_NAME_LEN} characters`),

    body('firstName')
      .optional()
      .trim()
      .escape()
      .isLength({ min: 2 })
      .withMessage('First name must be at least 2 characters')
      .isLength({ max: MAX_NAME_LEN })
      .withMessage(`First name must not exceed ${MAX_NAME_LEN} characters`),

    body('lastName')
      .optional()
      .trim()
      .escape()
      .isLength({ min: 2 })
      .withMessage('Last name must be at least 2 characters')
      .isLength({ max: MAX_NAME_LEN })
      .withMessage(`Last name must not exceed ${MAX_NAME_LEN} characters`),

    body('name').custom((value, { req }) => {
      const fullName = req.body.fullName;
      const firstName = req.body.firstName;
      const lastName = req.body.lastName;
      if (!value && !fullName && !(firstName && lastName)) {
        throw new Error('Name, fullName, or firstName and lastName are required');
      }
      return true;
    }),

    body('email')
      .trim()
      .toLowerCase()
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail(),

    body('password')
      .isLength({ min: MIN_PASSWORD_LEN })
      .withMessage(`Password must be at least ${MIN_PASSWORD_LEN} characters`)
      .isLength({ max: 128 })
      .withMessage('Password must not exceed 128 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage(
        'Password must contain at least one uppercase letter, one lowercase letter, and one number'
      )
      .matches(/^(?!.*[\s])/)
      .withMessage('Password must not contain spaces'),
    body('phoneNumber')
      .optional()
      .trim()
      .isMobilePhone()
      .withMessage('Please provide a valid phone number'),
  ],

  login: [
    body('email').trim().toLowerCase().isEmail().withMessage('Please provide a valid email'),

    body('password').notEmpty().withMessage('Password is required'),
  ],

  // ------------------------
  // Group
  // ------------------------
  createGroup: [
    body('name')
      .trim()
      .notEmpty()
      .withMessage('Group name is required')
      .isLength({ min: 3 })
      .withMessage('Group name must be at least 3 characters')
      .isLength({ max: MAX_GROUP_NAME_LEN })
      .withMessage(`Group name must not exceed ${MAX_GROUP_NAME_LEN} characters`),

    body('description')
      .optional()
      .trim()
      .isLength({ max: MAX_GROUP_DESC_LEN })
      .withMessage(`Description must not exceed ${MAX_GROUP_DESC_LEN} characters`),
  ],

  // ------------------------
  // Contribution
  // ------------------------
  addContribution: [
    body('groupId')
      .notEmpty()
      .withMessage('Group ID is required')
      .isMongoId()
      .withMessage('Invalid group ID'),

    body('amount')
      .notEmpty()
      .withMessage('Amount is required')
      .isFloat({ gt: 0 })
      .withMessage('Amount must be greater than 0')
      .toFloat(),

    body('note')
      .optional()
      .isString()
      .withMessage('Note must be a string')
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Note must not exceed 1000 characters'),

    body('date').optional().isISO8601().withMessage('Invalid date format').toDate(),
  ],

  // ------------------------
  // Loan
  // ------------------------
  createLoan: [
    body('groupId')
      .notEmpty()
      .withMessage('Group ID is required')
      .isMongoId()
      .withMessage('Invalid group ID'),

    body('amount')
      .notEmpty()
      .withMessage('Amount is required')
      .isFloat({ gt: 0 })
      .withMessage('Amount must be greater than 0')
      .toFloat(),

    body('dueDate')
      .notEmpty()
      .withMessage('Due date is required')
      .isISO8601()
      .withMessage('Invalid date format')
      .toDate(),

    body('reason')
      .trim()
      .notEmpty()
      .withMessage('Loan reason is required')
      .isLength({ max: MAX_REASON_LEN })
      .withMessage(`Reason must not exceed ${MAX_REASON_LEN} characters`),
  ],

  // ------------------------
  // Settings
  // ------------------------
  updateProfile: [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2 })
      .withMessage('Name must be at least 2 characters')
      .isLength({ max: MAX_NAME_LEN })
      .withMessage(`Name must not exceed ${MAX_NAME_LEN} characters`),

    body('phone')
      .optional()
      .trim()
      .isMobilePhone()
      .withMessage('Please provide a valid phone number'),

    body('profile.occupation')
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Occupation must not exceed 100 characters'),

    body('profile.city')
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage('City must not exceed 100 characters'),
  ],
};

/**
 * Validation Middleware
 * Forwards validation errors to the global error handler.
 * Consistent shape: next({ status: 400, errors: [...] })
 *
 * Use in routes like:
 *   router.post('/endpoint', rules, handleValidation, controller)
 */
const handleValidationErrors = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    // forward to errorHandler.js (which formats the response)
    return next({
      status: 400,
      errors: result.array(),
    });
  }
  next();
};

/**
 * Backwards-compatible export alias.
 * Your routes import `handleValidation`, so keep the name.
 */
const handleValidation = handleValidationErrors;

/**
 * Custom Validators (utility helpers)
 */
const isValidMongoId = (id) => /^[0-9a-fA-F]{24}$/.test(String(id));

const isValidEmail = (email) => {
  const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,})+$/;
  return emailRegex.test(String(email));
};

const isStrongPassword = (password) =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(String(password));

module.exports = {
  validationRules,
  validateFromTo,
  handleValidationErrors,
  handleValidation, // alias for compatibility
  isValidMongoId,
  isValidEmail,
  isStrongPassword,
};
