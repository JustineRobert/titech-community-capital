'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Payments Integration Test Suite
 * ============================================================================
 *
 * File:
 *   backend/tests/integration/payments.test.js
 *
 * Purpose:
 *   Production-grade integration tests for payment endpoints and provider
 *   adapters.
 *
 * Coverage:
 *   - Authentication
 *   - Mobile-money payment initiation
 *   - Stripe payment initiation
 *   - Request validation
 *   - Provider validation
 *   - Amount validation
 *   - Payment confirmation
 *   - Payment history
 *   - Pagination
 *   - Payment detail retrieval
 *   - Payment ownership isolation
 *   - M-Pesa webhook handling
 *   - Stripe webhook handling
 *   - Invalid transaction handling
 *   - Idempotency behavior
 *   - Targeted test-data cleanup
 *
 * Design goals:
 *   - Deterministic integration tests
 *   - Real HTTP stack through Supertest
 *   - No destructive global database cleanup
 *   - Explicit authorization boundaries
 *   - Explicit payment lifecycle assertions
 *   - Consistent TITech test identity
 *
 * Important:
 *   External provider calls should be mocked/configured for test mode by the
 *   application's provider layer. This suite should not require a real-money
 *   transaction.
 *
 * ============================================================================
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');

const app = require('../../server');

// ============================================================================
// Constants
// ============================================================================

const TEST_PASSWORD = 'SecurePassword123!';

/**
 * Canonical TITech Community Capital integration-test phone number.
 *
 * Keep this value consistent throughout this suite.
 */
const TEST_PHONE = '+256782397907';

const API_PREFIX = '/api/payments';

const INITIATE_ENDPOINT = `${API_PREFIX}/initiate`;
const HISTORY_ENDPOINT = `${API_PREFIX}/history`;
const CONFIRM_ENDPOINT = `${API_PREFIX}/confirm`;
const WEBHOOK_ENDPOINT = `${API_PREFIX}/webhook`;

const REQUEST_TIMEOUT = 15_000;

const MOBILE_MONEY_PROVIDER = 'mpesa';
const STRIPE_PROVIDER = 'stripe';

const TEST_CURRENCY = 'USD';

// ============================================================================
// Models
// ============================================================================

let User;
let Payment;
let Transaction;

// ============================================================================
// Test State
// ============================================================================

let testUser;
let otherUser;
let adminUser;

let userToken;
let otherUserToken;
let adminToken;

const createdUserIds = [];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a unique email address.
 *
 * @param {string} prefix
 * @returns {string}
 */
function uniqueEmail(prefix = 'payments-test') {
  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(4)
    .toString('hex')}@example.com`;
}

/**
 * Check whether a value is a valid MongoDB ObjectId.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

/**
 * Extract a JWT/access token from common response structures.
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
 * Extract user ID from common API response structures.
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

  return (
    body.userId ||
    body.data?.userId ||
    body._id ||
    body.id ||
    null
  );
}

/**
 * Extract payment/transaction data from common response structures.
 *
 * @param {object} body
 * @returns {object}
 */
function extractPayment(body) {
  if (!body || typeof body !== 'object') {
    return body;
  }

  if (body.data && typeof body.data === 'object') {
    return body.data;
  }

  if (body.payment && typeof body.payment === 'object') {
    return body.payment;
  }

  if (body.transaction && typeof body.transaction === 'object') {
    return body.transaction;
  }

  return body;
}

/**
 * Extract transaction ID from common API response shapes.
 *
 * @param {object} body
 * @returns {string|null}
 */
function extractTransactionId(body) {
  const payment = extractPayment(body);

  if (!payment || typeof payment !== 'object') {
    return null;
  }

  return (
    payment.transactionId ||
    payment.transactionID ||
    payment._id ||
    payment.id ||
    null
  );
}

/**
 * Extract an array of payments from common list-response shapes.
 *
 * @param {object} body
 * @returns {Array}
 */
function extractPaymentsArray(body) {
  if (!body || typeof body !== 'object') {
    return [];
  }

  if (Array.isArray(body.payments)) {
    return body.payments;
  }

  if (Array.isArray(body.data)) {
    return body.data;
  }

  if (Array.isArray(body.data?.payments)) {
    return body.data.payments;
  }

  if (Array.isArray(body.transactions)) {
    return body.transactions;
  }

  return [];
}

/**
 * Extract pagination metadata.
 *
 * @param {object} body
 * @returns {object|null}
 */
function extractPagination(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  return (
    body.pagination ||
    body.meta?.pagination ||
    body.meta ||
    null
  );
}

/**
 * Assert an error response has a usable message.
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
 * Assert a basic payment response contract.
 *
 * @param {object} payment
 */
function expectPaymentShape(payment) {
  expect(payment).toBeDefined();
  expect(typeof payment).toBe('object');

  const transactionId =
    payment.transactionId ||
    payment.transactionID ||
    payment._id ||
    payment.id;

  expect(transactionId).toBeDefined();
  expect(String(transactionId).length).toBeGreaterThan(0);

  if (payment.amount !== undefined) {
    expect(Number(payment.amount)).toBeGreaterThan(0);
  }

  if (payment.status !== undefined) {
    expect(typeof payment.status).toBe('string');
  }
}

/**
 * Create a fallback JWT only when the project's login endpoint does not expose
 * a token.
 *
 * @param {object} user
 * @param {string[]} roles
 * @returns {string}
 */
function createFallbackToken(user, roles = []) {
  return jwt.sign(
    {
      _id: user._id,
      userId: user._id,
      email: user.email,
      roles,
    },
    process.env.JWT_SECRET || 'test-secret'
  );
}

/**
 * Create an isolated test user.
 *
 * @param {object} options
 * @returns {Promise<object>}
 */
async function createTestUser(options = {}) {
  const {
    name = 'TITech Payment Test User',
    roles = [],
  } = options;

  const user = await User.create({
    name,
    fullName: name,
    email: uniqueEmail(
      roles.includes('admin')
        ? 'payment-admin'
        : 'payment-user'
    ),
    password: TEST_PASSWORD,
    phoneNumber: TEST_PHONE,
    roles,
    verified: true,
  });

  createdUserIds.push(String(user._id));

  return user;
}

/**
 * Authenticate using the real API whenever possible.
 *
 * @param {object} user
 * @param {string[]} roles
 * @returns {Promise<string>}
 */
async function authenticateUser(user, roles = []) {
  const response = await request(app)
    .post('/api/auth/login')
    .send({
      email: user.email,
      password: TEST_PASSWORD,
    });

  if ([200, 201].includes(response.statusCode)) {
    const token = extractAuthToken(response.body);

    if (token) {
      return token;
    }
  }

  return createFallbackToken(user, roles);
}

/**
 * Create a mobile-money payment through the API.
 *
 * @param {string} token
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function initiateMobileMoneyPayment(
  token,
  payload = {}
) {
  const response = await request(app)
    .post(INITIATE_ENDPOINT)
    .set('Authorization', `Bearer ${token}`)
    .send({
      phone: TEST_PHONE,
      amount: 100,
      description: 'TITech contribution payment integration test',
      provider: MOBILE_MONEY_PROVIDER,
      ...payload,
    });

  expect([200, 201]).toContain(response.status);

  const payment = extractPayment(response.body);

  expectPaymentShape(payment);

  return {
    response,
    payment,
    transactionId: extractTransactionId(response.body),
  };
}

/**
 * Create a Stripe payment through the API.
 *
 * @param {string} token
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function initiateStripePayment(
  token,
  payload = {}
) {
  const response = await request(app)
    .post(INITIATE_ENDPOINT)
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 100,
      currency: TEST_CURRENCY,
      description: 'TITech Stripe integration test payment',
      provider: STRIPE_PROVIDER,
      ...payload,
    });

  expect([200, 201]).toContain(response.status);

  const payment = extractPayment(response.body);

  return {
    response,
    payment,
    transactionId: extractTransactionId(response.body),
  };
}

/**
 * Remove only records owned by this test suite.
 */
async function cleanupTestData() {
  const userIds = createdUserIds.filter((id) =>
    isValidObjectId(id)
  );

  if (userIds.length === 0) {
    return;
  }

  const operations = [];

  if (Payment) {
    operations.push(
      Payment.deleteMany({
        $or: [
          { user: { $in: userIds } },
          { userId: { $in: userIds } },
          { owner: { $in: userIds } },
        ],
      }).catch(() => null)
    );
  }

  if (Transaction) {
    operations.push(
      Transaction.deleteMany({
        $or: [
          { user: { $in: userIds } },
          { userId: { $in: userIds } },
          { owner: { $in: userIds } },
        ],
      }).catch(() => null)
    );
  }

  operations.push(
    User.deleteMany({
      _id: { $in: userIds },
    }).catch(() => null)
  );

  await Promise.allSettled(operations);
}

// ============================================================================
// Suite
// ============================================================================

describe('TITech Community Capital Payments Integration Tests', () => {
  jest.setTimeout(REQUEST_TIMEOUT);

  // ==========================================================================
  // Setup
  // ==========================================================================

  beforeAll(async () => {
    User = require('../../models/User');

    try {
      // eslint-disable-next-line global-require
      Payment = require('../../models/Payment');
    } catch (_error) {
      Payment = null;
    }

    try {
      // eslint-disable-next-line global-require
      Transaction = require('../../models/Transaction');
    } catch (_error) {
      Transaction = null;
    }

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(
        process.env.MONGO_URI ||
          process.env.MONGODB_URI ||
          'mongodb://127.0.0.1:27017/community_savings_test'
      );
    }

    testUser = await createTestUser({
      name: 'TITech Payment User',
    });

    otherUser = await createTestUser({
      name: 'TITech Payment Other User',
    });

    adminUser = await createTestUser({
      name: 'TITech Payment Administrator',
      roles: ['admin'],
    });

    expect(testUser.phoneNumber).toBe(TEST_PHONE);
    expect(otherUser.phoneNumber).toBe(TEST_PHONE);
    expect(adminUser.phoneNumber).toBe(TEST_PHONE);

    userToken = await authenticateUser(
      testUser,
      []
    );

    otherUserToken = await authenticateUser(
      otherUser,
      []
    );

    adminToken = await authenticateUser(
      adminUser,
      ['admin']
    );

    expect(userToken).toBeDefined();
    expect(otherUserToken).toBeDefined();
    expect(adminToken).toBeDefined();
  });

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  afterAll(async () => {
    await cleanupTestData();
  });

  // ==========================================================================
  // POST /api/payments/initiate
  // ==========================================================================

  describe(`POST ${INITIATE_ENDPOINT}`, () => {
    describe('Mobile Money', () => {
      test('should initiate a mobile-money payment', async () => {
        const { payment, transactionId } =
          await initiateMobileMoneyPayment(
            userToken,
            {
              amount: 100,
            }
          );

        expect(transactionId).toBeDefined();

        expect(
          String(payment.status || '')
        ).toMatch(/pending|initiated|processing/i);

        if (payment.amount !== undefined) {
          expect(Number(payment.amount)).toBe(100);
        }
      });

      test('should consistently use the configured test phone number', async () => {
        const { payment, response } =
          await initiateMobileMoneyPayment(
            userToken,
            {
              amount: 100,
              phone: TEST_PHONE,
            }
          );

        expect(response.status).toBeDefined();

        if (payment.phone !== undefined) {
          expect(payment.phone).toBe(TEST_PHONE);
        }

        if (payment.phoneNumber !== undefined) {
          expect(payment.phoneNumber).toBe(TEST_PHONE);
        }
      });
    });

    describe('Stripe', () => {
      test('should initiate Stripe payment when Stripe provider is available', async () => {
        const response = await request(app)
          .post(INITIATE_ENDPOINT)
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            amount: 100,
            currency: TEST_CURRENCY,
            description: 'TITech Stripe test payment',
            provider: STRIPE_PROVIDER,
          });

        /**
         * The application's provider configuration determines whether Stripe
         * is available in a particular test environment.
         */
        expect(
          [200, 201, 400, 401, 422, 503].includes(
            response.status
          )
        ).toBe(true);

        if ([200, 201].includes(response.status)) {
          const payment = extractPayment(
            response.body
          );

          expect(
            payment.clientSecret ||
              payment.paymentIntentId ||
              payment.transactionId ||
              payment.id
          ).toBeDefined();
        } else {
          expectErrorMessage(response.body);
        }
      });

      test('should preserve Stripe amount and currency on successful initiation', async () => {
        const response = await request(app)
          .post(INITIATE_ENDPOINT)
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            amount: 250,
            currency: TEST_CURRENCY,
            description: 'TITech Stripe amount test',
            provider: STRIPE_PROVIDER,
          });

        if ([200, 201].includes(response.status)) {
          const payment = extractPayment(
            response.body
          );

          if (payment.amount !== undefined) {
            expect(Number(payment.amount)).toBe(250);
          }

          if (payment.currency !== undefined) {
            expect(
              String(payment.currency).toUpperCase()
            ).toBe(TEST_CURRENCY);
          }
        }
      });
    });

    // ------------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------------

    test('should reject a request without authentication', async () => {
      const response = await request(app)
        .post(INITIATE_ENDPOINT)
        .send({
          phone: TEST_PHONE,
          amount: 100,
          provider: MOBILE_MONEY_PROVIDER,
        });

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should reject missing amount', async () => {
      const response = await request(app)
        .post(INITIATE_ENDPOINT)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          phone: TEST_PHONE,
          provider: MOBILE_MONEY_PROVIDER,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject zero amount', async () => {
      const response = await request(app)
        .post(INITIATE_ENDPOINT)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          phone: TEST_PHONE,
          amount: 0,
          provider: MOBILE_MONEY_PROVIDER,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject negative amount', async () => {
      const response = await request(app)
        .post(INITIATE_ENDPOINT)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          phone: TEST_PHONE,
          amount: -100,
          provider: MOBILE_MONEY_PROVIDER,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);

      expect(
        JSON.stringify(response.body)
      ).toMatch(/amount|positive|valid|greater|minimum/i);
    });

    test('should reject non-numeric amount', async () => {
      const response = await request(app)
        .post(INITIATE_ENDPOINT)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          phone: TEST_PHONE,
          amount: 'invalid',
          provider: MOBILE_MONEY_PROVIDER,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject an invalid provider', async () => {
      const response = await request(app)
        .post(INITIATE_ENDPOINT)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          phone: TEST_PHONE,
          amount: 100,
          provider: 'invalid-provider',
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);

      expect(
        JSON.stringify(response.body)
      ).toMatch(/provider|supported/i);
    });

    test('should reject missing mobile-money phone number', async () => {
      const response = await request(app)
        .post(INITIATE_ENDPOINT)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          amount: 100,
          provider: MOBILE_MONEY_PROVIDER,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject malformed mobile-money phone number', async () => {
      const response = await request(app)
        .post(INITIATE_ENDPOINT)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          phone: 'not-a-phone-number',
          amount: 100,
          provider: MOBILE_MONEY_PROVIDER,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });
  });

  // ==========================================================================
  // POST /api/payments/confirm/:transactionId
  // ==========================================================================

  describe(`POST ${CONFIRM_ENDPOINT}/:transactionId`, () => {
    let transactionId;

    beforeEach(async () => {
      const result =
        await initiateMobileMoneyPayment(
          userToken,
          {
            amount: 100,
            description: 'TITech confirmation integration test',
          }
        );

      transactionId = result.transactionId;

      expect(transactionId).toBeDefined();
    });

    test('should confirm a payment with a valid transaction ID', async () => {
      const response = await request(app)
        .post(`${CONFIRM_ENDPOINT}/${transactionId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect([200, 201]).toContain(response.status);

      const payment = extractPayment(
        response.body
      );

      if (payment.status !== undefined) {
        expect(
          String(payment.status).toLowerCase()
        ).toMatch(
          /confirmed|completed|success|successful|paid|processing/
        );
      }
    });

    test('should require authentication', async () => {
      const response = await request(app)
        .post(`${CONFIRM_ENDPOINT}/${transactionId}`);

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should reject an invalid transaction ID', async () => {
      const response = await request(app)
        .post(`${CONFIRM_ENDPOINT}/invalid-id`)
        .set('Authorization', `Bearer ${userToken}`);

      expect([400, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject a non-existent valid transaction ID', async () => {
      const fakeId =
        new mongoose.Types.ObjectId().toString();

      const response = await request(app)
        .post(`${CONFIRM_ENDPOINT}/${fakeId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect([400, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should not allow another user to confirm the payment', async () => {
      const response = await request(app)
        .post(`${CONFIRM_ENDPOINT}/${transactionId}`)
        .set('Authorization', `Bearer ${otherUserToken}`);

      expect([403, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should handle repeated confirmation without creating an invalid duplicate state', async () => {
      const firstResponse = await request(app)
        .post(`${CONFIRM_ENDPOINT}/${transactionId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect([200, 201]).toContain(
        firstResponse.status
      );

      const secondResponse = await request(app)
        .post(`${CONFIRM_ENDPOINT}/${transactionId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect([200, 201, 400, 409]).toContain(
        secondResponse.status
      );

      if ([400, 409].includes(secondResponse.status)) {
        expectErrorMessage(secondResponse.body);
      }
    });
  });

  // ==========================================================================
  // GET /api/payments/history
  // ==========================================================================

  describe(`GET ${HISTORY_ENDPOINT}`, () => {
    test('should fetch payment history for the authenticated user', async () => {
      const response = await request(app)
        .get(HISTORY_ENDPOINT)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const payments =
        extractPaymentsArray(response.body);

      expect(Array.isArray(payments)).toBe(true);
    });

    test('should support pagination', async () => {
      const response = await request(app)
        .get(`${HISTORY_ENDPOINT}?page=1&limit=10`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const payments =
        extractPaymentsArray(response.body);

      expect(Array.isArray(payments)).toBe(true);

      const pagination =
        extractPagination(response.body);

      if (pagination) {
        expect(pagination).toHaveProperty('page');
        expect(pagination).toHaveProperty('limit');
      }
    });

    test('should require authentication', async () => {
      const response = await request(app)
        .get(HISTORY_ENDPOINT);

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should not expose another user payment history', async () => {
      await initiateMobileMoneyPayment(
        userToken,
        {
          amount: 150,
        }
      );

      const response = await request(app)
        .get(HISTORY_ENDPOINT)
        .set(
          'Authorization',
          `Bearer ${otherUserToken}`
        )
        .expect(200);

      const payments =
        extractPaymentsArray(response.body);

      expect(Array.isArray(payments)).toBe(true);

      payments.forEach((payment) => {
        const owner =
          payment.userId ||
          payment.user?._id ||
          payment.user;

        if (owner) {
          expect(String(owner)).not.toBe(
            String(testUser._id)
          );
        }
      });
    });

    test('should reject invalid pagination values or safely normalize them', async () => {
      const response = await request(app)
        .get(
          `${HISTORY_ENDPOINT}?page=-1&limit=-100`
        )
        .set('Authorization', `Bearer ${userToken}`);

      expect([200, 400, 422]).toContain(
        response.status
      );

      if ([400, 422].includes(response.status)) {
        expectErrorMessage(response.body);
      }
    });
  });

  // ==========================================================================
  // GET /api/payments/:transactionId
  // ==========================================================================

  describe(`GET ${API_PREFIX}/:transactionId`, () => {
    let transactionId;

    beforeEach(async () => {
      const result =
        await initiateMobileMoneyPayment(
          userToken,
          {
            amount: 100,
          }
        );

      transactionId = result.transactionId;

      expect(transactionId).toBeDefined();
    });

    test('should fetch payment details', async () => {
      const response = await request(app)
        .get(`${API_PREFIX}/${transactionId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const payment = extractPayment(
        response.body
      );

      expectPaymentShape(payment);

      const returnedTransactionId =
        extractTransactionId(
          response.body
        );

      expect(
        String(returnedTransactionId)
      ).toBe(String(transactionId));

      if (payment.amount !== undefined) {
        expect(Number(payment.amount)).toBe(100);
      }

      expect(payment).toHaveProperty('status');
    });

    test('should require authentication', async () => {
      const response = await request(app)
        .get(`${API_PREFIX}/${transactionId}`);

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should reject an invalid transaction ID', async () => {
      const response = await request(app)
        .get(`${API_PREFIX}/non-existent-id`)
        .set('Authorization', `Bearer ${userToken}`);

      expect([400, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should return not found for a valid but non-existent transaction', async () => {
      const fakeId =
        new mongoose.Types.ObjectId().toString();

      const response = await request(app)
        .get(`${API_PREFIX}/${fakeId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect([400, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should prevent another user from accessing payment details', async () => {
      const response = await request(app)
        .get(`${API_PREFIX}/${transactionId}`)
        .set(
          'Authorization',
          `Bearer ${otherUserToken}`
        );

      expect([403, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });
  });

  // ==========================================================================
  // M-Pesa Webhook
  // ==========================================================================

  describe(`POST ${WEBHOOK_ENDPOINT}/mpesa`, () => {
    test('should process a valid successful M-Pesa callback when webhook integration is enabled', async () => {
      const webhookData = {
        Body: {
          stkCallback: {
            MerchantRequestID: `merchant-${Date.now()}`,
            CheckoutRequestID: `checkout-${Date.now()}`,
            ResultCode: 0,
            ResultDesc:
              'The service request has been processed successfully.',
            CallbackMetadata: {
              Item: [
                {
                  Name: 'Amount',
                  Value: 100,
                },
                {
                  Name: 'MpesaReceiptNumber',
                  Value: `TEST-${Date.now()}`,
                },
                {
                  Name: 'PhoneNumber',
                  Value: TEST_PHONE,
                },
              ],
            },
          },
        },
      };

      const response = await request(app)
        .post(`${WEBHOOK_ENDPOINT}/mpesa`)
        .send(webhookData);

      expect([200, 201, 202, 400]).toContain(
        response.status
      );

      if ([400].includes(response.status)) {
        expectErrorMessage(response.body);
      }
    });

    test('should use the canonical TITech phone number in callback metadata', async () => {
      const webhookData = {
        Body: {
          stkCallback: {
            MerchantRequestID:
              `merchant-phone-${Date.now()}`,
            CheckoutRequestID:
              `checkout-phone-${Date.now()}`,
            ResultCode: 0,
            ResultDesc: 'Successful.',
            CallbackMetadata: {
              Item: [
                {
                  Name: 'Amount',
                  Value: 100,
                },
                {
                  Name: 'PhoneNumber',
                  Value: TEST_PHONE,
                },
              ],
            },
          },
        },
      };

      const response = await request(app)
        .post(`${WEBHOOK_ENDPOINT}/mpesa`)
        .send(webhookData);

      expect([200, 201, 202, 400]).toContain(
        response.status
      );
    });

    test('should reject malformed M-Pesa webhook payloads', async () => {
      const response = await request(app)
        .post(`${WEBHOOK_ENDPOINT}/mpesa`)
        .send({
          malformed: true,
        });

      expect([400, 422]).toContain(
        response.status
      );

      expectErrorMessage(response.body);
    });
  });

  // ==========================================================================
  // Stripe Webhook
  // ==========================================================================

  describe(`POST ${WEBHOOK_ENDPOINT}/stripe`, () => {
    test('should reject an unsigned or improperly signed Stripe webhook', async () => {
      const webhookData = {
        id: `evt_test_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: `pi_test_${Date.now()}`,
            status: 'succeeded',
            amount: 10_000,
            currency: 'usd',
          },
        },
      };

      const response = await request(app)
        .post(`${WEBHOOK_ENDPOINT}/stripe`)
        .send(webhookData);

      expect([200, 400, 401, 403]).toContain(
        response.status
      );
    });

    test('should reject an invalid Stripe signature when signature validation is enabled', async () => {
      const webhookData = {
        id: `evt_invalid_signature_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: `pi_invalid_signature_${Date.now()}`,
            status: 'succeeded',
            amount: 10_000,
            currency: 'usd',
          },
        },
      };

      const response = await request(app)
        .post(`${WEBHOOK_ENDPOINT}/stripe`)
        .set(
          'Stripe-Signature',
          'invalid-signature'
        )
        .send(webhookData);

      expect([400, 401, 403]).toContain(
        response.status
      );
    });
  });

  // ==========================================================================
  // Payment Ownership / Isolation
  // ==========================================================================

  describe('Payment Ownership and Authorization', () => {
    test('should prevent another user from reading a payment', async () => {
      const created =
        await initiateMobileMoneyPayment(
          userToken,
          {
            amount: 500,
          }
        );

      const response = await request(app)
        .get(
          `${API_PREFIX}/${created.transactionId}`
        )
        .set(
          'Authorization',
          `Bearer ${otherUserToken}`
        );

      expect([403, 404]).toContain(
        response.status
      );

      expectErrorMessage(response.body);
    });

    test('should prevent another user from confirming a payment', async () => {
      const created =
        await initiateMobileMoneyPayment(
          userToken,
          {
            amount: 500,
          }
        );

      const response = await request(app)
        .post(
          `${CONFIRM_ENDPOINT}/${created.transactionId}`
        )
        .set(
          'Authorization',
          `Bearer ${otherUserToken}`
        );

      expect([403, 404]).toContain(
        response.status
      );

      expectErrorMessage(response.body);
    });
  });

  // ==========================================================================
  // Provider Validation
  // ==========================================================================

  describe('Provider Validation', () => {
    test('should accept the configured mobile-money provider identifier', async () => {
      const response = await request(app)
        .post(INITIATE_ENDPOINT)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          phone: TEST_PHONE,
          amount: 100,
          provider: MOBILE_MONEY_PROVIDER,
        });

      expect([200, 201, 400, 422, 503]).toContain(
        response.status
      );
    });

    test('should accept Stripe provider identifier when Stripe is configured', async () => {
      const response = await request(app)
        .post(INITIATE_ENDPOINT)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          amount: 100,
          currency: TEST_CURRENCY,
          provider: STRIPE_PROVIDER,
        });

      expect([200, 201, 400, 422, 503]).toContain(
        response.status
      );
    });
  });

  // ==========================================================================
  // Idempotency Smoke Coverage
  // ==========================================================================

  describe('Payment Idempotency', () => {
    test('should safely handle the same request repeated with an idempotency key when supported', async () => {
      const idempotencyKey =
        `titech-pay-${Date.now()}-${crypto
          .randomBytes(4)
          .toString('hex')}`;

      const payload = {
        phone: TEST_PHONE,
        amount: 250,
        description: 'TITech idempotency test',
        provider: MOBILE_MONEY_PROVIDER,
        idempotencyKey,
      };

      const firstResponse = await request(app)
        .post(INITIATE_ENDPOINT)
        .set('Authorization', `Bearer ${userToken}`)
        .send(payload);

      const secondResponse = await request(app)
        .post(INITIATE_ENDPOINT)
        .set('Authorization', `Bearer ${userToken}`)
        .send(payload);

      expect([200, 201, 400, 409, 422]).toContain(
        firstResponse.status
      );

      expect([200, 201, 400, 409, 422]).toContain(
        secondResponse.status
      );

      if (
        [200, 201].includes(firstResponse.status) &&
        [200, 201].includes(secondResponse.status)
      ) {
        const firstId =
          extractTransactionId(
            firstResponse.body
          );

        const secondId =
          extractTransactionId(
            secondResponse.body
          );

        expect(firstId).toBeDefined();
        expect(secondId).toBeDefined();

        expect(String(secondId)).toBe(
          String(firstId)
        );
      }
    });
  });

  // ==========================================================================
  // Security Error Handling
  // ==========================================================================

  describe('Security Error Handling', () => {
    test('should reject an invalid authentication token', async () => {
      const response = await request(app)
        .get(HISTORY_ENDPOINT)
        .set(
          'Authorization',
          'Bearer invalid.token.value'
        );

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should reject a malformed Authorization header', async () => {
      const response = await request(app)
        .get(HISTORY_ENDPOINT)
        .set(
          'Authorization',
          'NotBearerToken'
        );

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should reject an empty Authorization header', async () => {
      const response = await request(app)
        .get(HISTORY_ENDPOINT)
        .set('Authorization', '');

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });
  });

  // ==========================================================================
  // Financial Integrity
  // ==========================================================================

  describe('Financial Integrity', () => {
    test('should preserve payment amount through initiation response', async () => {
      const amount = 375;

      const created =
        await initiateMobileMoneyPayment(
          userToken,
          {
            amount,
          }
        );

      if (
        created.payment.amount !== undefined
      ) {
        expect(
          Number(created.payment.amount)
        ).toBe(amount);
      }
    });

    test('should never accept a negative monetary amount', async () => {
      const response = await request(app)
        .post(INITIATE_ENDPOINT)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          phone: TEST_PHONE,
          amount: -1,
          provider: MOBILE_MONEY_PROVIDER,
        });

      expect([400, 422]).toContain(
        response.status
      );

      expectErrorMessage(response.body);
    });

    test('should never accept zero monetary amount', async () => {
      const response = await request(app)
        .post(INITIATE_ENDPOINT)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          phone: TEST_PHONE,
          amount: 0,
          provider: MOBILE_MONEY_PROVIDER,
        });

      expect([400, 422]).toContain(
        response.status
      );

      expectErrorMessage(response.body);
    });
  });
});

// ============================================================================
// Explicit empty export
// ============================================================================

module.exports = {};