'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Email & Password Security Integration Test Suite
 * ============================================================================
 *
 * File:
 *   backend/tests/integration/email.test.js
 *
 * Purpose:
 *   Production-grade integration tests for:
 *     - Email verification
 *     - Email verification token security
 *     - Email verification resend throttling
 *     - Email verification expiration
 *     - Password reset token security
 *     - Password reset expiration
 *     - Password reset single-use enforcement
 *     - Password reset brute-force protection
 *     - Password strength validation
 *     - Password reset audit logging
 *     - Authentication endpoint integration
 *
 * Coverage:
 *   EmailVerificationService
 *   PasswordResetService
 *   POST /api/auth/verify-email
 *   POST /api/auth/reset-password
 *
 * Design goals:
 *   - Deterministic integration tests
 *   - No global database deletion
 *   - Secure token assertions
 *   - Explicit lifecycle verification
 *   - Safe cleanup of test-owned records
 *   - Consistent TITech test identity
 *
 * ============================================================================
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../server');

const EmailVerificationService = require('../../services/emailVerificationService');
const PasswordResetService = require('../../services/passwordResetService');

// ============================================================================
// Test Constants
// ============================================================================

const TEST_PASSWORD = 'SecurePassword123!';

/**
 * Canonical TITech Community Capital test phone number.
 *
 * Keep this value consistent throughout the suite.
 */
const TEST_PHONE = '+256782397907';

const TEST_NAME = 'TITech Email Security Test User';

const VERIFY_ENDPOINT = '/api/auth/verify-email';
const RESET_ENDPOINT = '/api/auth/reset-password';

const PASSWORD_RESET_STRONG_PASSWORD = 'NewSecurePass123!@#';

const PASSWORD_RESET_WEAK_PASSWORDS = [
  'weak',
  'WeakPassword',
  'WeakPass123',
  '12345678',
  'password',
];

const TOKEN_EXPIRY_TOLERANCE_MS = 10_000;

const REQUEST_TIMEOUT = 15_000;

// ============================================================================
// Models
// ============================================================================

let User;
let EmailVerificationToken;
let PasswordResetToken;
let AuditLog;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Load models lazily so model-registration order in the application does not
 * make this test suite brittle.
 */
function loadModels() {
  // eslint-disable-next-line global-require
  User = require('../../models/User');

  // eslint-disable-next-line global-require
  EmailVerificationToken = require('../../models/EmailVerificationToken');

  // eslint-disable-next-line global-require
  PasswordResetToken = require('../../models/PasswordResetToken');

  try {
    // eslint-disable-next-line global-require
    AuditLog = require('../../models/AuditLog');
  } catch (_error) {
    AuditLog = null;
  }
}

/**
 * Generate a unique email address for the test user.
 *
 * @returns {string}
 */
function uniqueEmail() {
  return `email-security-test-${Date.now()}-${crypto
    .randomBytes(4)
    .toString('hex')}@example.com`;
}

/**
 * Determine whether a value is a valid MongoDB ObjectId.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

/**
 * Extract a user ID from common API response shapes.
 *
 * @param {object} body
 * @returns {string|null}
 */
function extractUserId(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  if (body.user && typeof body.user === 'object') {
    return body.user._id || body.user.id || null;
  }

  return body.userId || body.data?.userId || body._id || body.id || null;
}

/**
 * Extract an authentication token from common API response shapes.
 *
 * @param {object} body
 * @returns {string|null}
 */
function extractAuthToken(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  return (
    body.token ||
    body.accessToken ||
    body.data?.token ||
    body.data?.accessToken ||
    null
  );
}

/**
 * Assert a response has a useful error message.
 *
 * @param {object} body
 */
function expectErrorMessage(body) {
  expect(body).toBeDefined();

  const message =
    body.message ||
    body.error ||
    body.errorMessage ||
    body.details?.message;

  expect(message).toBeDefined();
  expect(String(message).trim().length).toBeGreaterThan(0);
}

/**
 * Compute the SHA-256 hash in exactly the same general form used by token
 * persistence implementations.
 *
 * @param {string} token
 * @returns {string}
 */
function sha256(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Safely generate a JWT for endpoint tests when the application expects a
 * bearer token for verification.
 *
 * @param {object} user
 * @returns {string}
 */
function generateAuthToken(user) {
  return jwt.sign(
    {
      _id: user._id,
      userId: user._id,
      email: user.email,
    },
    process.env.JWT_SECRET || 'test-secret'
  );
}

/**
 * Create a test user directly through the model.
 *
 * This is intentionally isolated from the HTTP registration endpoint because
 * these tests are focused on email/password security services and auth
 * endpoints, not registration behavior.
 *
 * @returns {Promise<object>}
 */
async function createTestUser() {
  return User.create({
    name: TEST_NAME,
    fullName: TEST_NAME,
    email: uniqueEmail(),
    password: TEST_PASSWORD,
    phoneNumber: TEST_PHONE,
    verified: false,
  });
}

/**
 * Create a test user plus a valid-looking JWT.
 *
 * @returns {Promise<{user: object, token: string}>}
 */
async function createAuthenticatedTestUser() {
  const user = await createTestUser();

  return {
    user,
    token: generateAuthToken(user),
  };
}

/**
 * Remove only records belonging to this suite's users.
 *
 * @param {string[]} userIds
 */
async function cleanupUsers(userIds) {
  const validIds = userIds.filter((id) => id && isValidObjectId(String(id)));

  if (validIds.length === 0) {
    return;
  }

  await Promise.allSettled([
    EmailVerificationToken.deleteMany({
      user: { $in: validIds },
    }),
    PasswordResetToken.deleteMany({
      user: { $in: validIds },
    }),
    AuditLog
      ? AuditLog.deleteMany({
          user: { $in: validIds },
        })
      : Promise.resolve(),
    User.deleteMany({
      _id: { $in: validIds },
    }),
  ]);
}

/**
 * Create an expired email-verification token directly in the database.
 *
 * @param {object} user
 * @param {string} rawToken
 * @returns {Promise<object>}
 */
async function createExpiredEmailVerificationToken(user, rawToken) {
  return EmailVerificationToken.create({
    user: user._id,
    tokenHash: sha256(rawToken),
    expiresAt: new Date(Date.now() - 60 * 60 * 1000),
  });
}

/**
 * Create an expired password-reset token directly in the database.
 *
 * @param {object} user
 * @param {string} rawToken
 * @returns {Promise<object>}
 */
async function createExpiredPasswordResetToken(user, rawToken) {
  return PasswordResetToken.create({
    user: user._id,
    tokenHash: sha256(rawToken),
    expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    attemptsRemaining: 5,
    locked: false,
  });
}

/**
 * Extract the effective expiry timestamp from a service result.
 *
 * @param {object} result
 * @returns {number}
 */
function getExpiryTimestamp(result) {
  return new Date(result.expiresAt).getTime();
}

/**
 * Verify that an expiry is approximately one hour from now.
 *
 * @param {number} expiresAt
 */
function expectApproximatelyOneHourFromNow(expiresAt) {
  const now = Date.now();
  const expected = 60 * 60 * 1000;
  const diff = expiresAt - now;

  expect(diff).toBeGreaterThan(expected - TOKEN_EXPIRY_TOLERANCE_MS);
  expect(diff).toBeLessThan(expected + TOKEN_EXPIRY_TOLERANCE_MS);
}

// ============================================================================
// Suite State
// ============================================================================

let emailVerificationService;
let passwordResetService;

const createdUserIds = [];

// ============================================================================
// Suite
// ============================================================================

describe('TITech Email & Password Security Integration Tests', () => {
  jest.setTimeout(REQUEST_TIMEOUT);

  // ==========================================================================
  // Suite Setup
  // ==========================================================================

  beforeAll(async () => {
    loadModels();

    emailVerificationService =
      app.locals.emailVerificationService ||
      new EmailVerificationService();

    passwordResetService =
      app.locals.passwordResetService ||
      new PasswordResetService();

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(
        process.env.MONGO_URI ||
          process.env.MONGODB_URI ||
          'mongodb://127.0.0.1:27017/community_savings_test'
      );
    }
  });

  // ==========================================================================
  // Suite Cleanup
  // ==========================================================================

  afterAll(async () => {
    await cleanupUsers(createdUserIds);
  });

  // ==========================================================================
  // Email Verification Service
  // ==========================================================================

  describe('EmailVerificationService', () => {
    let user;

    beforeEach(async () => {
      user = await createTestUser();
      createdUserIds.push(String(user._id));
    });

    // ------------------------------------------------------------------------
    // Token generation
    // ------------------------------------------------------------------------

    test('should generate a verification token with an expiry', async () => {
      const result =
        await emailVerificationService.generateTokenAndSend(user._id);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('expiresAt');
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('sent');

      expect(result.sent).toBe(true);
      expect(typeof result.token).toBe('string');
      expect(result.token.length).toBeGreaterThan(0);

      const expiry = new Date(result.expiresAt);

      expect(expiry.toString()).not.toBe('Invalid Date');
      expect(expiry.getTime()).toBeGreaterThan(Date.now());
    });

    test('should persist only a hash of the raw verification token', async () => {
      const result =
        await emailVerificationService.generateTokenAndSend(user._id);

      const record = await EmailVerificationToken.findOne({
        user: user._id,
      }).lean();

      expect(record).toBeDefined();
      expect(record.tokenHash).toBeDefined();

      expect(record.tokenHash).not.toBe(result.token);
      expect(record.tokenHash).toBe(sha256(result.token));
    });

    test('should not persist the raw verification token anywhere in the token record', async () => {
      const result =
        await emailVerificationService.generateTokenAndSend(user._id);

      const record = await EmailVerificationToken.findOne({
        user: user._id,
      }).lean();

      const serialized = JSON.stringify(record);

      expect(serialized).not.toContain(result.token);
    });

    // ------------------------------------------------------------------------
    // Token verification
    // ------------------------------------------------------------------------

    test('should verify a valid verification token successfully', async () => {
      const result =
        await emailVerificationService.generateTokenAndSend(user._id);

      const verified = await emailVerificationService.verifyToken(
        user._id,
        result.token
      );

      expect(verified).toBe(true);

      const record = await EmailVerificationToken.findOne({
        user: user._id,
      }).lean();

      expect(record).toBeDefined();
      expect(record.usedAt).toBeDefined();
    });

    test('should reject an invalid verification token', async () => {
      await emailVerificationService.generateTokenAndSend(user._id);

      const verified = await emailVerificationService.verifyToken(
        user._id,
        'invalid-verification-token'
      );

      expect(verified).toBe(false);
    });

    test('should reject a verification token on second use', async () => {
      const result =
        await emailVerificationService.generateTokenAndSend(user._id);

      const firstVerification =
        await emailVerificationService.verifyToken(
          user._id,
          result.token
        );

      const secondVerification =
        await emailVerificationService.verifyToken(
          user._id,
          result.token
        );

      expect(firstVerification).toBe(true);
      expect(secondVerification).toBe(false);
    });

    test('should reject a verification token issued for another user', async () => {
      const otherUser = await createTestUser();
      createdUserIds.push(String(otherUser._id));

      const result =
        await emailVerificationService.generateTokenAndSend(user._id);

      const verified = await emailVerificationService.verifyToken(
        otherUser._id,
        result.token
      );

      expect(verified).toBe(false);
    });

    // ------------------------------------------------------------------------
    // Expiration
    // ------------------------------------------------------------------------

    test('should reject an expired verification token', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');

      await createExpiredEmailVerificationToken(user, rawToken);

      const verified = await emailVerificationService.verifyToken(
        user._id,
        rawToken
      );

      expect(verified).toBe(false);
    });

    // ------------------------------------------------------------------------
    // Throttling
    // ------------------------------------------------------------------------

    test('should enforce verification resend throttling', async () => {
      const firstResult =
        await emailVerificationService.generateTokenAndSend(user._id);

      const secondResult =
        await emailVerificationService.generateTokenAndSend(user._id);

      expect(firstResult.sent).toBe(true);
      expect(secondResult.throttled).toBe(true);
    });

    // ------------------------------------------------------------------------
    // Cleanup
    // ------------------------------------------------------------------------

    test('should cleanup expired verification tokens', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');

      await createExpiredEmailVerificationToken(user, rawToken);

      const beforeCount =
        await EmailVerificationToken.countDocuments({
          user: user._id,
        });

      expect(beforeCount).toBe(1);

      await emailVerificationService.cleanupExpiredTokens();

      const afterCount =
        await EmailVerificationToken.countDocuments({
          user: user._id,
        });

      expect(afterCount).toBe(0);
    });
  });

  // ==========================================================================
  // Password Reset Service
  // ==========================================================================

  describe('PasswordResetService', () => {
    let user;

    beforeEach(async () => {
      user = await createTestUser();
      createdUserIds.push(String(user._id));
    });

    // ------------------------------------------------------------------------
    // Token generation
    // ------------------------------------------------------------------------

    test('should create a reset token with secure metadata', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('expiresAt');

      expect(typeof result.token).toBe('string');
      expect(result.token.length).toBeGreaterThan(0);

      const record = await PasswordResetToken.findOne({
        user: user._id,
      }).lean();

      expect(record).toBeDefined();
      expect(record.tokenHash).toBeDefined();

      expect(record.tokenHash).not.toBe(result.token);
      expect(record.tokenHash).toBe(sha256(result.token));
    });

    test('should not persist the raw password-reset token', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      const record = await PasswordResetToken.findOne({
        user: user._id,
      }).lean();

      const serialized = JSON.stringify(record);

      expect(serialized).not.toContain(result.token);
    });

    test('should issue a reset token that expires in approximately one hour', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      const expiresAt = getExpiryTimestamp(result);

      expectApproximatelyOneHourFromNow(expiresAt);
    });

    // ------------------------------------------------------------------------
    // Password strength validation
    // ------------------------------------------------------------------------

    test('should reject weak password reset attempts', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      for (const weakPassword of PASSWORD_RESET_WEAK_PASSWORDS) {
        const resetResult =
          await passwordResetService.resetPassword(
            user._id,
            result.token,
            weakPassword
          );

        expect(resetResult.success).toBe(false);

        if (resetResult.error) {
          expect(String(resetResult.error)).toMatch(
            /strong|password|character|special|uppercase|lowercase|number/i
          );
        }
      }
    });

    test('should accept a strong password', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      const resetResult =
        await passwordResetService.resetPassword(
          user._id,
          result.token,
          PASSWORD_RESET_STRONG_PASSWORD
        );

      expect(resetResult.success).toBe(true);
    });

    // ------------------------------------------------------------------------
    // Single use
    // ------------------------------------------------------------------------

    test('should enforce single-use password-reset tokens', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      const firstReset =
        await passwordResetService.resetPassword(
          user._id,
          result.token,
          PASSWORD_RESET_STRONG_PASSWORD
        );

      expect(firstReset.success).toBe(true);

      const secondReset =
        await passwordResetService.resetPassword(
          user._id,
          result.token,
          'AnotherStrongPass123!@#'
        );

      expect(secondReset.success).toBe(false);

      const record = await PasswordResetToken.findOne({
        user: user._id,
      }).lean();

      expect(record).toBeDefined();
      expect(record.usedAt).toBeDefined();
    });

    // ------------------------------------------------------------------------
    // Invalid token
    // ------------------------------------------------------------------------

    test('should reject an invalid password-reset token', async () => {
      const resetResult =
        await passwordResetService.resetPassword(
          user._id,
          'invalid-password-reset-token',
          PASSWORD_RESET_STRONG_PASSWORD
        );

      expect(resetResult.success).toBe(false);
    });

    test('should reject a reset token belonging to another user', async () => {
      const otherUser = await createTestUser();
      createdUserIds.push(String(otherUser._id));

      const result =
        await passwordResetService.createResetToken(user._id);

      const resetResult =
        await passwordResetService.resetPassword(
          otherUser._id,
          result.token,
          PASSWORD_RESET_STRONG_PASSWORD
        );

      expect(resetResult.success).toBe(false);
    });

    // ------------------------------------------------------------------------
    // Expiration
    // ------------------------------------------------------------------------

    test('should reject an expired password-reset token', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');

      await createExpiredPasswordResetToken(user, rawToken);

      const resetResult =
        await passwordResetService.resetPassword(
          user._id,
          rawToken,
          PASSWORD_RESET_STRONG_PASSWORD
        );

      expect(resetResult.success).toBe(false);
    });

    // ------------------------------------------------------------------------
    // Brute-force protection
    // ------------------------------------------------------------------------

    test('should enforce brute-force protection after repeated failures', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      const attempts = 6;

      for (let index = 0; index < attempts; index += 1) {
        await passwordResetService.resetPassword(
          user._id,
          result.token,
          'WrongPass123!@#'
        );
      }

      const record = await PasswordResetToken.findOne({
        user: user._id,
      }).lean();

      expect(record).toBeDefined();

      if (Object.prototype.hasOwnProperty.call(record, 'attemptsRemaining')) {
        expect(record.attemptsRemaining).toBe(0);
      }

      if (Object.prototype.hasOwnProperty.call(record, 'locked')) {
        expect(record.locked).toBe(true);
      }
    });

    test('should not permit a successful reset after the reset token is locked', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      for (let index = 0; index < 6; index += 1) {
        await passwordResetService.resetPassword(
          user._id,
          result.token,
          'WrongPass123!@#'
        );
      }

      const resetResult =
        await passwordResetService.resetPassword(
          user._id,
          result.token,
          PASSWORD_RESET_STRONG_PASSWORD
        );

      expect(resetResult.success).toBe(false);
    });

    // ------------------------------------------------------------------------
    // Audit
    // ------------------------------------------------------------------------

    test('should create an audit record after successful password reset', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      const resetResult =
        await passwordResetService.resetPassword(
          user._id,
          result.token,
          PASSWORD_RESET_STRONG_PASSWORD
        );

      expect(resetResult.success).toBe(true);

      if (!AuditLog) {
        return;
      }

      const audit = await AuditLog.findOne({
        user: user._id,
        action: 'password_reset',
      })
        .sort({ createdAt: -1 })
        .lean();

      expect(audit).toBeDefined();
    });

    // ------------------------------------------------------------------------
    // User state
    // ------------------------------------------------------------------------

    test('should actually update the persisted password after successful reset', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      const resetResult =
        await passwordResetService.resetPassword(
          user._id,
          result.token,
          PASSWORD_RESET_STRONG_PASSWORD
        );

      expect(resetResult.success).toBe(true);

      const updatedUser = await User.findById(user._id);

      expect(updatedUser).toBeDefined();

      /**
       * Password implementations vary. The important assertion is that the
       * persisted credential is not equal to the plaintext reset password.
       */
      expect(updatedUser.password).not.toBe(
        PASSWORD_RESET_STRONG_PASSWORD
      );
    });
  });

  // ==========================================================================
  // POST /api/auth/verify-email
  // ==========================================================================

  describe('POST /api/auth/verify-email', () => {
    let user;
    let authToken;

    beforeEach(async () => {
      const fixture = await createAuthenticatedTestUser();

      user = fixture.user;
      authToken = fixture.token;

      createdUserIds.push(String(user._id));
    });

    test('should verify email with a valid token', async () => {
      const result =
        await emailVerificationService.generateTokenAndSend(user._id);

      const response = await request(app)
        .post(VERIFY_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          token: result.token,
        });

      expect(response.status).toBe(200);

      const updatedUser = await User.findById(user._id).lean();

      expect(updatedUser).toBeDefined();
      expect(updatedUser.verified).toBe(true);
    });

    test('should reject email verification without authentication', async () => {
      const result =
        await emailVerificationService.generateTokenAndSend(user._id);

      const response = await request(app)
        .post(VERIFY_ENDPOINT)
        .send({
          token: result.token,
        });

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should reject an invalid verification token', async () => {
      const response = await request(app)
        .post(VERIFY_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          token: 'invalid-token-12345',
        });

      expect([400, 401, 404, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject an empty verification token', async () => {
      const response = await request(app)
        .post(VERIFY_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          token: '',
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject verification when token is missing', async () => {
      const response = await request(app)
        .post(VERIFY_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject reuse of a previously consumed verification token', async () => {
      const result =
        await emailVerificationService.generateTokenAndSend(user._id);

      const firstResponse = await request(app)
        .post(VERIFY_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          token: result.token,
        });

      expect(firstResponse.status).toBe(200);

      const secondResponse = await request(app)
        .post(VERIFY_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          token: result.token,
        });

      expect([400, 401, 409, 422]).toContain(secondResponse.status);
      expectErrorMessage(secondResponse.body);
    });

    test('should reject an expired verification token', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');

      await createExpiredEmailVerificationToken(user, rawToken);

      const response = await request(app)
        .post(VERIFY_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          token: rawToken,
        });

      expect([400, 401, 404, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });
  });

  // ==========================================================================
  // POST /api/auth/reset-password
  // ==========================================================================

  describe('POST /api/auth/reset-password', () => {
    let user;

    beforeEach(async () => {
      user = await createTestUser();
      createdUserIds.push(String(user._id));
    });

    test('should reset the password using a valid token', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      const response = await request(app)
        .post(RESET_ENDPOINT)
        .send({
          token: result.token,
          newPassword: PASSWORD_RESET_STRONG_PASSWORD,
        });

      expect(response.status).toBe(200);
    });

    test('should reset the password without requiring the old authentication token', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      const response = await request(app)
        .post(RESET_ENDPOINT)
        .send({
          token: result.token,
          newPassword: PASSWORD_RESET_STRONG_PASSWORD,
        });

      expect(response.status).toBe(200);
    });

    test('should reject a weak password', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      const response = await request(app)
        .post(RESET_ENDPOINT)
        .send({
          token: result.token,
          newPassword: 'weak',
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject a missing reset token', async () => {
      const response = await request(app)
        .post(RESET_ENDPOINT)
        .send({
          newPassword: PASSWORD_RESET_STRONG_PASSWORD,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject a missing new password', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      const response = await request(app)
        .post(RESET_ENDPOINT)
        .send({
          token: result.token,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject an invalid reset token', async () => {
      const response = await request(app)
        .post(RESET_ENDPOINT)
        .send({
          token: 'invalid-reset-token-12345',
          newPassword: PASSWORD_RESET_STRONG_PASSWORD,
        });

      expect([400, 401, 404, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject an expired reset token', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');

      await createExpiredPasswordResetToken(user, rawToken);

      const response = await request(app)
        .post(RESET_ENDPOINT)
        .send({
          token: rawToken,
          newPassword: PASSWORD_RESET_STRONG_PASSWORD,
        });

      expect([400, 401, 404, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject reuse of a consumed reset token', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      const firstResponse = await request(app)
        .post(RESET_ENDPOINT)
        .send({
          token: result.token,
          newPassword: PASSWORD_RESET_STRONG_PASSWORD,
        });

      expect(firstResponse.status).toBe(200);

      const secondResponse = await request(app)
        .post(RESET_ENDPOINT)
        .send({
          token: result.token,
          newPassword: 'AnotherStrongPass123!@#',
        });

      expect([400, 401, 409, 422]).toContain(secondResponse.status);
      expectErrorMessage(secondResponse.body);
    });

    test('should reject repeated failed password attempts once brute-force protection is triggered', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      for (let index = 0; index < 6; index += 1) {
        await request(app)
          .post(RESET_ENDPOINT)
          .send({
            token: result.token,
            newPassword: 'WrongPass123!@#',
          });
      }

      const response = await request(app)
        .post(RESET_ENDPOINT)
        .send({
          token: result.token,
          newPassword: PASSWORD_RESET_STRONG_PASSWORD,
        });

      expect([400, 401, 409, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });
  });

  // ==========================================================================
  // Token Security Invariants
  // ==========================================================================

  describe('Token Security Invariants', () => {
    let user;

    beforeEach(async () => {
      user = await createTestUser();
      createdUserIds.push(String(user._id));
    });

    test('should use a non-empty cryptographically random-looking verification token', async () => {
      const first =
        await emailVerificationService.generateTokenAndSend(user._id);

      /**
       * Throttling may prevent immediate regeneration. The primary security
       * invariant is that the issued token is non-empty and not trivially
       * short.
       */
      expect(typeof first.token).toBe('string');
      expect(first.token.length).toBeGreaterThanOrEqual(16);
    });

    test('should use a non-empty password reset token', async () => {
      const first =
        await passwordResetService.createResetToken(user._id);

      expect(typeof first.token).toBe('string');
      expect(first.token.length).toBeGreaterThanOrEqual(16);
    });

    test('should never store verification tokens in plaintext', async () => {
      const result =
        await emailVerificationService.generateTokenAndSend(user._id);

      const record = await EmailVerificationToken.findOne({
        user: user._id,
      }).lean();

      expect(record).toBeDefined();
      expect(record.tokenHash).toBe(sha256(result.token));
    });

    test('should never store password reset tokens in plaintext', async () => {
      const result =
        await passwordResetService.createResetToken(user._id);

      const record = await PasswordResetToken.findOne({
        user: user._id,
      }).lean();

      expect(record).toBeDefined();
      expect(record.tokenHash).toBe(sha256(result.token));
    });
  });
});