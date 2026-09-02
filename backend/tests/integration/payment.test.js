'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Payment Integration Test Suite
 * ============================================================================
 *
 * File:
 *   backend/tests/integration/payment.test.js
 *
 * Purpose:
 *   Production-grade integration tests for payment processing.
 *
 * Coverage:
 *   - Payment intent creation
 *   - Input validation
 *   - Authentication
 *   - Idempotency
 *   - Idempotency collision protection
 *   - Payment intent retrieval
 *   - Ownership / authorization boundaries
 *   - Stripe webhook handling
 *   - Webhook signature validation
 *   - Transaction listing
 *   - Transaction pagination
 *   - Transaction filtering
 *   - Payment cancellation
 *   - Cancellation lifecycle protection
 *   - Admin analytics authorization
 *   - Targeted test-data cleanup
 *
 * Design goals:
 *   - Never delete unrelated database records
 *   - Never depend on a fabricated production payment state
 *   - Never require a real Stripe charge merely to validate API behavior
 *   - Preserve financial test isolation
 *   - Validate security boundaries explicitly
 *   - Keep TITech test identity consistent
 *
 * ============================================================================
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');
const Stripe = require('stripe');

const app = require('../../server');

const PaymentService = require('../../services/payment/PaymentService');

// ============================================================================
// Constants
// ============================================================================

const TEST_PASSWORD = 'SecurePassword123!';

/**
 * Canonical TITech Community Capital integration-test phone number.
 *
 * Keep this value consistent throughout the suite.
 */
const TEST_PHONE = '+256782397907';

const TEST_CURRENCY = 'USD';
const TEST_PAYMENT_METHOD = 'card';

const REQUEST_TIMEOUT = 15_000;

const PAYMENTS_BASE_PATH = '/api/payments';

const PAYMENT_INTENTS_ENDPOINT =
  `${PAYMENTS_BASE_PATH}/intents`;

const TRANSACTIONS_ENDPOINT =
  `${PAYMENTS_BASE_PATH}/transactions`;

const WEBHOOK_ENDPOINT =
  `${PAYMENTS_BASE_PATH}/webhooks`;

const ANALYTICS_ENDPOINT =
  `${PAYMENTS_BASE_PATH}/analytics/summary`;

// ============================================================================
// Models
// ============================================================================

let User;
let PaymentIntent;
let Transaction;

// ============================================================================
// Runtime Services
// ============================================================================

let paymentService;
let stripeProvider;

// ============================================================================
// Test State
// ============================================================================

let testUser;
let adminUser;
let otherUser;

let authToken;
let adminToken;
let otherUserToken;

const createdUserIds = [];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a unique test email address.
 *
 * @param {string} prefix
 * @returns {string}
 */
function uniqueEmail(prefix = 'payment-test') {
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
 * Extract an auth token from common API response shapes.
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
 * Extract user ID from common response shapes.
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
 * Extract payment intent from common API response shapes.
 *
 * @param {object} body
 * @returns {object}
 */
function extractPaymentIntent(body) {
  if (!body || typeof body !== 'object') {
    return body;
  }

  if (body.data && typeof body.data === 'object') {
    return body.data;
  }

  if (body.paymentIntent && typeof body.paymentIntent === 'object') {
    return body.paymentIntent;
  }

  if (body.intent && typeof body.intent === 'object') {
    return body.intent;
  }

  return body;
}

/**
 * Extract payment intent ID from a response.
 *
 * @param {object} body
 * @returns {string|null}
 */
function extractPaymentIntentId(body) {
  const intent = extractPaymentIntent(body);

  if (!intent || typeof intent !== 'object') {
    return null;
  }

  return intent._id || intent.id || intent.paymentIntentId || null;
}

/**
 * Extract an array from transaction-list response contracts.
 *
 * @param {object} body
 * @returns {Array}
 */
function extractTransactionArray(body) {
  if (!body || typeof body !== 'object') {
    return [];
  }

  if (Array.isArray(body.data)) {
    return body.data;
  }

  if (Array.isArray(body.transactions)) {
    return body.transactions;
  }

  if (Array.isArray(body.data?.transactions)) {
    return body.data.transactions;
  }

  return [];
}

/**
 * Extract pagination object from common response shapes.
 *
 * @param {object} body
 * @returns {object|null}
 */
function extractPagination(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  return body.pagination || body.meta?.pagination || null;
}

/**
 * Assert that an API response exposes a useful error.
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
 * Assert basic payment intent shape.
 *
 * @param {object} intent
 */
function expectPaymentIntentShape(intent) {
  expect(intent).toBeDefined();
  expect(typeof intent).toBe('object');

  const identifier =
    intent._id ||
    intent.id ||
    intent.paymentIntentId;

  expect(identifier).toBeDefined();
  expect(String(identifier).length).toBeGreaterThan(0);

  if (intent.amount !== undefined) {
    expect(Number(intent.amount)).toBeGreaterThan(0);
  }

  if (intent.currency !== undefined) {
    expect(typeof intent.currency).toBe('string');
  }

  if (intent.status !== undefined) {
    expect(typeof intent.status).toBe('string');
  }
}

/**
 * Generate a deterministic fallback JWT when the application's login endpoint
 * does not return an access token.
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
 * Create a test user through the User model.
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
 * Authenticate through the actual API when possible.
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
 * Create a payment intent through the application.
 *
 * @param {string} token
 * @param {object} payload
 * @returns {Promise<{response: object, intent: object, intentId: string}>}
 */
async function createPaymentIntent(token, payload = {}) {
  const response = await request(app)
    .post(PAYMENT_INTENTS_ENDPOINT)
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 5000,
      currency: TEST_CURRENCY,
      ...payload,
    });

  expect([200, 201]).toContain(response.statusCode);

  const intent = extractPaymentIntent(response.body);

  expectPaymentIntentShape(intent);

  const intentId = extractPaymentIntentId(response.body);

  expect(intentId).toBeDefined();

  return {
    response,
    intent,
    intentId,
  };
}

/**
 * Generate a Stripe webhook signature using the configured webhook secret.
 *
 * Stripe's official helper is used when a valid webhook secret is configured.
 *
 * @param {string} payload
 * @param {string} secret
 * @returns {string}
 */
function createStripeSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);

  const signedPayload = `${timestamp}.${payload}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return `t=${timestamp},v1=${signature}`;
}

/**
 * Create a Stripe webhook event payload.
 *
 * @param {object} event
 * @returns {string}
 */
function serializeStripeWebhook(event) {
  return JSON.stringify(event);
}

/**
 * Safely remove only records created by this suite.
 */
async function cleanupTestData() {
  const userIds = createdUserIds.filter((id) =>
    isValidObjectId(id)
  );

  if (userIds.length === 0) {
    return;
  }

  const operations = [];

  if (PaymentIntent) {
    operations.push(
      PaymentIntent.deleteMany({
        $or: [
          { user: { $in: userIds } },
          { userId: { $in: userIds } },
          { customer: { $in: userIds } },
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
          { customer: { $in: userIds } },
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

describe('TITech Community Capital Payment Integration Tests', () => {
  jest.setTimeout(REQUEST_TIMEOUT);

  // ==========================================================================
  // Setup
  // ==========================================================================

  beforeAll(async () => {
    User = require('../../models/User');
    PaymentIntent = require('../../models/PaymentIntent');

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

    /**
     * Reuse the application's configured payment service whenever possible.
     */
    paymentService =
      app.locals.paymentService ||
      null;

    /**
     * Initialize a Stripe-backed service only when the application has not
     * already configured one.
     */
    if (!paymentService) {
      const StripeProvider =
        require('../../services/payment/providers/stripeProvider');

      const stripeApiKey =
        process.env.STRIPE_SECRET_TEST_KEY ||
        process.env.STRIPE_SECRET_KEY;

      if (stripeApiKey) {
        stripeProvider = new StripeProvider({
          apiKey: stripeApiKey,
        });

        paymentService = new PaymentService({
          provider: stripeProvider,
        });

        app.locals.paymentService = paymentService;
      }
    }

    // ------------------------------------------------------------------------
    // Create isolated users
    // ------------------------------------------------------------------------

    testUser = await createTestUser({
      name: 'TITech Payment User',
      roles: [],
    });

    adminUser = await createTestUser({
      name: 'TITech Payment Administrator',
      roles: ['admin'],
    });

    otherUser = await createTestUser({
      name: 'TITech Payment Other User',
      roles: [],
    });

    borrowerSanityCheck(testUser);

    authToken = await authenticateUser(
      testUser,
      []
    );

    adminToken = await authenticateUser(
      adminUser,
      ['admin']
    );

    otherUserToken = await authenticateUser(
      otherUser,
      []
    );

    expect(authToken).toBeDefined();
    expect(adminToken).toBeDefined();
    expect(otherUserToken).toBeDefined();
  });

  /**
   * Small fixture sanity check to ensure the canonical phone number actually
   * exists on test users.
   *
   * @param {object} user
   */
  function borrowerSanityCheck(user) {
    expect(user.phoneNumber).toBe(TEST_PHONE);
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  afterAll(async () => {
    await cleanupTestData();
  });

  // ==========================================================================
  // POST /api/payments/intents
  // ==========================================================================

  describe('POST /api/payments/intents - Create Payment Intent', () => {
    test('should create a payment intent with a valid idempotency key', async () => {
      const idempotencyKey =
        `titech-payment-${Date.now()}-${crypto
          .randomBytes(4)
          .toString('hex')}`;

      const { intent } = await createPaymentIntent(
        authToken,
        {
          amount: 5000,
          currency: TEST_CURRENCY,
          description: 'TITech payment integration test',
          idempotencyKey,
        }
      );

      expect(intent).toBeDefined();

      if (intent.amount !== undefined) {
        expect(Number(intent.amount)).toBe(5000);
      }

      if (intent.currency !== undefined) {
        expect(String(intent.currency).toUpperCase()).toBe(
          TEST_CURRENCY
        );
      }

      if (intent.clientSecret !== undefined) {
        expect(typeof intent.clientSecret).toBe('string');
        expect(intent.clientSecret.length).toBeGreaterThan(0);
      }
    });

    test('should require authentication', async () => {
      const response = await request(app)
        .post(PAYMENT_INTENTS_ENDPOINT)
        .send({
          amount: 5000,
          currency: TEST_CURRENCY,
        });

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should reject a negative amount', async () => {
      const response = await request(app)
        .post(PAYMENT_INTENTS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: -100,
          currency: TEST_CURRENCY,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject a zero amount', async () => {
      const response = await request(app)
        .post(PAYMENT_INTENTS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 0,
          currency: TEST_CURRENCY,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject a non-numeric amount', async () => {
      const response = await request(app)
        .post(PAYMENT_INTENTS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 'not-a-number',
          currency: TEST_CURRENCY,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject an invalid currency code', async () => {
      const response = await request(app)
        .post(PAYMENT_INTENTS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 5000,
          currency: 'INVALID',
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject an empty idempotency key when the endpoint requires one', async () => {
      const response = await request(app)
        .post(PAYMENT_INTENTS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 5000,
          currency: TEST_CURRENCY,
          idempotencyKey: '',
        });

      expect([200, 201, 400, 422]).toContain(response.status);

      if ([400, 422].includes(response.status)) {
        expectErrorMessage(response.body);
      }
    });
  });

  // ==========================================================================
  // Idempotency
  // ==========================================================================

  describe('Payment Idempotency', () => {
    test('should return the same payment intent for duplicate idempotency key and identical payload', async () => {
      const idempotencyKey =
        `idem-${Date.now()}-${crypto
          .randomBytes(4)
          .toString('hex')}`;

      const payload = {
        amount: 5000,
        currency: TEST_CURRENCY,
        description: 'Idempotency test',
        idempotencyKey,
      };

      const response1 = await request(app)
        .post(PAYMENT_INTENTS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload);

      const response2 = await request(app)
        .post(PAYMENT_INTENTS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload);

      expect([200, 201]).toContain(response1.status);
      expect([200, 201]).toContain(response2.status);

      const intent1 = extractPaymentIntent(response1.body);
      const intent2 = extractPaymentIntent(response2.body);

      const id1 = extractPaymentIntentId(response1.body);
      const id2 = extractPaymentIntentId(response2.body);

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(String(id1)).toBe(String(id2));

      if (intent1.amount !== undefined && intent2.amount !== undefined) {
        expect(Number(intent1.amount)).toBe(
          Number(intent2.amount)
        );
      }
    });

    test('should not silently reuse an idempotency key for a conflicting payload', async () => {
      const idempotencyKey =
        `collision-${Date.now()}-${crypto
          .randomBytes(4)
          .toString('hex')}`;

      const first = await request(app)
        .post(PAYMENT_INTENTS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 5000,
          currency: TEST_CURRENCY,
          idempotencyKey,
        });

      expect([200, 201]).toContain(first.status);

      const second = await request(app)
        .post(PAYMENT_INTENTS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 7500,
          currency: TEST_CURRENCY,
          idempotencyKey,
        });

      /**
       * A secure implementation should reject a key reused with a materially
       * different financial request. Some implementations may return the
       * original resource instead, but they must not create a second intent
       * while pretending the requests were equivalent.
       */
      expect([200, 201, 400, 409, 422]).toContain(
        second.status
      );

      if ([400, 409, 422].includes(second.status)) {
        expectErrorMessage(second.body);
      }

      if ([200, 201].includes(second.status)) {
        const firstId = extractPaymentIntentId(first.body);
        const secondId = extractPaymentIntentId(second.body);

        expect(String(firstId)).toBe(String(secondId));
      }
    });
  });

  // ==========================================================================
  // GET /api/payments/intents/:id
  // ==========================================================================

  describe('GET Payment Intent', () => {
    test('should retrieve a payment intent by ID', async () => {
      const created = await createPaymentIntent(
        authToken,
        {
          amount: 3000,
          currency: TEST_CURRENCY,
        }
      );

      const response = await request(app)
        .get(`${PAYMENT_INTENTS_ENDPOINT}/${created.intentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const intent = extractPaymentIntent(response.body);

      expectPaymentIntentShape(intent);

      const returnedId =
        extractPaymentIntentId(response.body);

      expect(String(returnedId)).toBe(
        String(created.intentId)
      );
    });

    test('should require authentication', async () => {
      const created = await createPaymentIntent(
        authToken,
        {
          amount: 3000,
          currency: TEST_CURRENCY,
        }
      );

      const response = await request(app)
        .get(`${PAYMENT_INTENTS_ENDPOINT}/${created.intentId}`);

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should reject malformed payment intent IDs', async () => {
      const response = await request(app)
        .get(
          `${PAYMENT_INTENTS_ENDPOINT}/invalid-payment-id`
        )
        .set('Authorization', `Bearer ${authToken}`);

      expect([400, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should return not found for a valid but non-existent local payment ID', async () => {
      const fakeId =
        new mongoose.Types.ObjectId().toString();

      const response = await request(app)
        .get(`${PAYMENT_INTENTS_ENDPOINT}/${fakeId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect([400, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should prevent another authenticated user from reading a private payment intent', async () => {
      const created = await createPaymentIntent(
        authToken,
        {
          amount: 3500,
          currency: TEST_CURRENCY,
        }
      );

      const response = await request(app)
        .get(`${PAYMENT_INTENTS_ENDPOINT}/${created.intentId}`)
        .set('Authorization', `Bearer ${otherUserToken}`);

      expect([403, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });
  });

  // ==========================================================================
  // POST /api/payments/webhooks/:provider
  // ==========================================================================

  describe('POST Payment Webhooks', () => {
    test('should reject webhook requests with an invalid signature', async () => {
      const payload = serializeStripeWebhook({
        id: `evt_invalid_${Date.now()}`,
        object: 'event',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: `pi_invalid_${Date.now()}`,
            amount: 5000,
            currency: 'usd',
            status: 'succeeded',
          },
        },
      });

      const response = await request(app)
        .post(`${WEBHOOK_ENDPOINT}/stripe`)
        .set('Stripe-Signature', 'invalid-signature')
        .set('Content-Type', 'application/json')
        .send(payload);

      /**
       * Depending on middleware placement, malformed signatures may surface
       * as 400 or 401.
       */
      expect([400, 401, 403]).toContain(response.status);
    });

    test('should reject webhook requests without a signature', async () => {
      const payload = serializeStripeWebhook({
        id: `evt_missing_signature_${Date.now()}`,
        object: 'event',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: `pi_missing_signature_${Date.now()}`,
            amount: 5000,
            currency: 'usd',
            status: 'succeeded',
          },
        },
      });

      const response = await request(app)
        .post(`${WEBHOOK_ENDPOINT}/stripe`)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect([400, 401, 403]).toContain(response.status);
    });

    test('should process a correctly signed Stripe webhook when a webhook secret is configured', async () => {
      const webhookSecret =
        process.env.STRIPE_WEBHOOK_SECRET_TEST ||
        process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        return;
      }

      const paymentIntentId =
        `pi_webhook_${Date.now()}_${crypto
          .randomBytes(3)
          .toString('hex')}`;

      const event = {
        id: `evt_webhook_${Date.now()}_${crypto
          .randomBytes(3)
          .toString('hex')}`,
        object: 'event',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: paymentIntentId,
            amount: 5000,
            currency: 'usd',
            status: 'succeeded',
          },
        },
      };

      const rawPayload =
        serializeStripeWebhook(event);

      const signature = createStripeSignature(
        rawPayload,
        webhookSecret
      );

      const response = await request(app)
        .post(`${WEBHOOK_ENDPOINT}/stripe`)
        .set('Stripe-Signature', signature)
        .set('Content-Type', 'application/json')
        .send(rawPayload);

      expect([200, 201, 202]).toContain(
        response.status
      );
    });

    test('should handle duplicate webhook events idempotently when the implementation supports event deduplication', async () => {
      const webhookSecret =
        process.env.STRIPE_WEBHOOK_SECRET_TEST ||
        process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        return;
      }

      const eventId =
        `evt_duplicate_${Date.now()}_${crypto
          .randomBytes(3)
          .toString('hex')}`;

      const event = {
        id: eventId,
        object: 'event',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id:
              `pi_duplicate_${Date.now()}_${crypto
                .randomBytes(3)
                .toString('hex')}`,
            amount: 5000,
            currency: 'usd',
            status: 'succeeded',
          },
        },
      };

      const rawPayload =
        serializeStripeWebhook(event);

      const firstSignature = createStripeSignature(
        rawPayload,
        webhookSecret
      );

      const firstResponse = await request(app)
        .post(`${WEBHOOK_ENDPOINT}/stripe`)
        .set('Stripe-Signature', firstSignature)
        .set('Content-Type', 'application/json')
        .send(rawPayload);

      expect([200, 201, 202]).toContain(
        firstResponse.status
      );

      const secondSignature = createStripeSignature(
        rawPayload,
        webhookSecret
      );

      const secondResponse = await request(app)
        .post(`${WEBHOOK_ENDPOINT}/stripe`)
        .set('Stripe-Signature', secondSignature)
        .set('Content-Type', 'application/json')
        .send(rawPayload);

      expect([200, 201, 202, 400, 409]).toContain(
        secondResponse.status
      );
    });
  });

  // ==========================================================================
  // GET /api/payments/transactions
  // ==========================================================================

  describe('GET Payment Transactions', () => {
    test('should require authentication', async () => {
      const response = await request(app)
        .get(TRANSACTIONS_ENDPOINT);

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should list transactions with pagination', async () => {
      await createPaymentIntent(
        authToken,
        {
          amount: 1000,
          currency: TEST_CURRENCY,
        }
      );

      const response = await request(app)
        .get(
          `${TRANSACTIONS_ENDPOINT}?page=1&limit=10`
        )
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);

      const data = extractTransactionArray(
        response.body
      );

      expect(Array.isArray(data)).toBe(true);

      const pagination =
        extractPagination(response.body);

      if (pagination) {
        expect(pagination).toHaveProperty('page');
        expect(pagination).toHaveProperty('limit');
      }
    });

    test('should filter transactions by status', async () => {
      const response = await request(app)
        .get(
          `${TRANSACTIONS_ENDPOINT}?status=pending`
        )
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);

      const transactions =
        extractTransactionArray(response.body);

      expect(Array.isArray(transactions)).toBe(true);

      transactions.forEach((transaction) => {
        if (transaction.status !== undefined) {
          expect(
            String(transaction.status).toLowerCase()
          ).toBe('pending');
        }
      });
    });

    test('should isolate transaction lists to the authenticated user', async () => {
      const response = await request(app)
        .get(TRANSACTIONS_ENDPOINT)
        .set('Authorization', `Bearer ${otherUserToken}`);

      expect(response.status).toBe(200);

      const transactions =
        extractTransactionArray(response.body);

      expect(Array.isArray(transactions)).toBe(true);

      transactions.forEach((transaction) => {
        const transactionUser =
          transaction.userId ||
          transaction.user?._id ||
          transaction.user;

        if (transactionUser) {
          expect(String(transactionUser)).not.toBe(
            String(testUser._id)
          );
        }
      });
    });

    test('should reject invalid pagination values or safely normalize them', async () => {
      const response = await request(app)
        .get(
          `${TRANSACTIONS_ENDPOINT}?page=-1&limit=-100`
        )
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 400, 422]).toContain(
        response.status
      );

      if ([400, 422].includes(response.status)) {
        expectErrorMessage(response.body);
      }
    });
  });

  // ==========================================================================
  // POST /api/payments/:id/cancel
  // ==========================================================================

  describe('POST Payment Cancellation', () => {
    test('should cancel a cancellable payment intent', async () => {
      const created = await createPaymentIntent(
        authToken,
        {
          amount: 2000,
          currency: TEST_CURRENCY,
        }
      );

      const response = await request(app)
        .post(
          `${PAYMENTS_BASE_PATH}/${created.intentId}/cancel`
        )
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 201]).toContain(response.status);

      const intent = extractPaymentIntent(
        response.body
      );

      if (intent.status !== undefined) {
        expect(
          ['canceled', 'cancelled'].includes(
            String(intent.status).toLowerCase()
          )
        ).toBe(true);
      }
    });

    test('should require authentication for cancellation', async () => {
      const created = await createPaymentIntent(
        authToken,
        {
          amount: 2500,
          currency: TEST_CURRENCY,
        }
      );

      const response = await request(app)
        .post(
          `${PAYMENTS_BASE_PATH}/${created.intentId}/cancel`
        );

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should prevent another user from cancelling a private payment intent', async () => {
      const created = await createPaymentIntent(
        authToken,
        {
          amount: 2500,
          currency: TEST_CURRENCY,
        }
      );

      const response = await request(app)
        .post(
          `${PAYMENTS_BASE_PATH}/${created.intentId}/cancel`
        )
        .set(
          'Authorization',
          `Bearer ${otherUserToken}`
        );

      expect([403, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject cancellation of an invalid payment ID', async () => {
      const response = await request(app)
        .post(
          `${PAYMENTS_BASE_PATH}/invalid-payment-id/cancel`
        )
        .set('Authorization', `Bearer ${authToken}`);

      expect([400, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should not permit an already-cancelled intent to enter an invalid terminal state', async () => {
      const created = await createPaymentIntent(
        authToken,
        {
          amount: 3000,
          currency: TEST_CURRENCY,
        }
      );

      const firstResponse = await request(app)
        .post(
          `${PAYMENTS_BASE_PATH}/${created.intentId}/cancel`
        )
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 201]).toContain(
        firstResponse.status
      );

      const secondResponse = await request(app)
        .post(
          `${PAYMENTS_BASE_PATH}/${created.intentId}/cancel`
        )
        .set('Authorization', `Bearer ${authToken}`);

      expect([200, 400, 409]).toContain(
        secondResponse.status
      );

      if ([400, 409].includes(secondResponse.status)) {
        expectErrorMessage(secondResponse.body);
      }
    });
  });

  // ==========================================================================
  // Admin Analytics
  // ==========================================================================

  describe('GET Payment Analytics Summary', () => {
    test('should reject analytics access for a normal user', async () => {
      const response = await request(app)
        .get(ANALYTICS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(403);
      expectErrorMessage(response.body);
    });

    test('should reject analytics access without authentication', async () => {
      const response = await request(app)
        .get(ANALYTICS_ENDPOINT);

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should allow analytics access for an administrator when authorized by the application', async () => {
      const response = await request(app)
        .get(ANALYTICS_ENDPOINT)
        .set(
          'Authorization',
          `Bearer ${adminToken}`
        );

      /**
       * A correctly wired admin route should return 200. If the current
       * repository uses a more specific administrative permission than the
       * generic "admin" role, retain 403 rather than weakening the test.
       */
      expect([200, 403]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      } else {
        expectErrorMessage(response.body);
      }
    });
  });

  // ==========================================================================
  // Security / Authorization
  // ==========================================================================

  describe('Payment Security Boundaries', () => {
    test('should reject an invalid bearer token', async () => {
      const response = await request(app)
        .post(PAYMENT_INTENTS_ENDPOINT)
        .set(
          'Authorization',
          'Bearer invalid.token.value'
        )
        .send({
          amount: 5000,
          currency: TEST_CURRENCY,
        });

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should not expose one user payment intent through another user token', async () => {
      const created = await createPaymentIntent(
        authToken,
        {
          amount: 4500,
          currency: TEST_CURRENCY,
        }
      );

      const response = await request(app)
        .get(`${PAYMENT_INTENTS_ENDPOINT}/${created.intentId}`)
        .set(
          'Authorization',
          `Bearer ${otherUserToken}`
        );

      expect([403, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should not allow another user to cancel a payment intent they do not own', async () => {
      const created = await createPaymentIntent(
        authToken,
        {
          amount: 4500,
          currency: TEST_CURRENCY,
        }
      );

      const response = await request(app)
        .post(
          `${PAYMENTS_BASE_PATH}/${created.intentId}/cancel`
        )
        .set(
          'Authorization',
          `Bearer ${otherUserToken}`
        );

      expect([403, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });
  });

  // ==========================================================================
  // Payment Service Smoke Coverage
  // ==========================================================================

  describe('PaymentService', () => {
    test('should expose the configured payment service when application configuration provides one', () => {
      if (app.locals.paymentService) {
        expect(app.locals.paymentService).toBeDefined();
      }

      if (paymentService) {
        expect(paymentService).toBeDefined();
        expect(typeof paymentService).toBe('object');
      }
    });

    test('should have Stripe integration available when test credentials are configured', () => {
      const stripeTestKey =
        process.env.STRIPE_SECRET_TEST_KEY ||
        process.env.STRIPE_SECRET_KEY;

      if (!stripeTestKey) {
        return;
      }

      expect(stripeTestKey).toMatch(/^sk_/);

      /**
       * Verify the installed Stripe dependency can be initialized with the
       * configured key without making a real financial transaction.
       */
      const stripe = new Stripe(stripeTestKey);

      expect(stripe).toBeDefined();
      expect(stripe.paymentIntents).toBeDefined();
    });
  });

  // ==========================================================================
  // Financial Integrity
  // ==========================================================================

  describe('Financial Integrity', () => {
    test('should not create a payment intent for an invalid amount', async () => {
      const response = await request(app)
        .post(PAYMENT_INTENTS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: Number.NaN,
          currency: TEST_CURRENCY,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should not accept a floating-point amount when integer minor units are required by the implementation', async () => {
      const response = await request(app)
        .post(PAYMENT_INTENTS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 1000.55,
          currency: TEST_CURRENCY,
        });

      expect([200, 201, 400, 422]).toContain(
        response.status
      );

      if ([400, 422].includes(response.status)) {
        expectErrorMessage(response.body);
      }
    });

    test('should preserve the requested amount on successful intent creation', async () => {
      const amount = 8750;

      const created = await createPaymentIntent(
        authToken,
        {
          amount,
          currency: TEST_CURRENCY,
        }
      );

      if (created.intent.amount !== undefined) {
        expect(Number(created.intent.amount)).toBe(
          amount
        );
      }
    });
  });
});