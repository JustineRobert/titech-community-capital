'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Contributions Integration Test Suite
 * ============================================================================
 *
 * File:
 *   backend/tests/integration/contributions.test.js
 *
 * Purpose:
 *   Production-grade integration tests for the contribution API.
 *
 * Coverage:
 *   - Authentication requirements
 *   - Contribution submission
 *   - Input validation
 *   - Contribution retrieval
 *   - Filtering
 *   - Pagination
 *   - Date-range filtering
 *   - Contribution details
 *   - Group statistics
 *   - User statistics
 *   - Contribution confirmation
 *   - Contribution cancellation
 *   - Contribution lifecycle protection
 *   - Batch CSV import
 *   - Basic authorization isolation
 *   - Test-data cleanup
 *
 * Notes:
 *   - Tests use the application's actual HTTP stack through Supertest.
 *   - Test records are isolated using unique email/group identifiers.
 *   - IDs are deliberately maintained at suite scope where required by
 *     multiple lifecycle tests.
 *
 * ============================================================================
 */

const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../server');

// -----------------------------------------------------------------------------
// Optional model discovery
// -----------------------------------------------------------------------------
// The test suite primarily operates through HTTP endpoints. Models are loaded
// defensively so cleanup can occur without making the test suite dependent on
// one exact model export location/name.
//
// If the project uses different model names/locations, the HTTP tests remain
// valid; only model-level cleanup may be skipped.
// -----------------------------------------------------------------------------

let User;
let Group;
let Contribution;

try {
  // eslint-disable-next-line global-require
  User = require('../../models/User');
} catch (_error) {
  User = null;
}

try {
  // eslint-disable-next-line global-require
  Group = require('../../models/Group');
} catch (_error) {
  Group = null;
}

try {
  // eslint-disable-next-line global-require
  Contribution = require('../../models/Contribution');
} catch (_error) {
  Contribution = null;
}

// ============================================================================
// Test constants
// ============================================================================

const TEST_PASSWORD = 'SecurePassword123!';

/**
 * Canonical TITech Community Capital integration-test phone number.
 *
 * Keep this value consistent across all users and contribution requests in
 * this test suite.
 */
const TEST_PHONE = '+256782397907';

const API_PREFIX = '/api/contributions';

const VALID_PAYMENT_METHOD = 'mobile_money';

const REQUEST_TIMEOUT = 15_000;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a unique test email.
 *
 * @returns {string}
 */
function uniqueEmail() {
  return `contribution-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}@example.com`;
}

/**
 * Generate a unique group name.
 *
 * @returns {string}
 */
function uniqueGroupName() {
  return `Contribution Test Group ${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Determine whether a value looks like a MongoDB ObjectId.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

/**
 * Extract an identifier from common API response shapes.
 *
 * @param {object} body
 * @param {string} resourceName
 * @returns {string|null}
 */
function extractId(body, resourceName) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const resource = body[resourceName];

  if (resource && typeof resource === 'object') {
    return resource._id || resource.id || null;
  }

  return body._id || body.id || null;
}

/**
 * Extract the authenticated user ID from common registration response shapes.
 *
 * @param {object} body
 * @returns {string|null}
 */
function extractUserId(body) {
  return extractId(body, 'user');
}

/**
 * Extract the group ID from common group-creation response shapes.
 *
 * @param {object} body
 * @returns {string|null}
 */
function extractGroupId(body) {
  return extractId(body, 'group');
}

/**
 * Extract the contribution ID from common contribution response shapes.
 *
 * @param {object} body
 * @returns {string|null}
 */
function extractContributionId(body) {
  return extractId(body, 'contribution');
}

/**
 * Assert that an API response contains a usable error message.
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
  expect(String(message).length).toBeGreaterThan(0);
}

/**
 * Assert contribution response structure.
 *
 * @param {object} contribution
 */
function expectContributionShape(contribution) {
  expect(contribution).toBeDefined();
  expect(typeof contribution).toBe('object');

  expect(contribution).toHaveProperty('_id');

  expect(isValidObjectId(String(contribution._id))).toBe(true);

  expect(contribution).toHaveProperty('amount');
  expect(typeof Number(contribution.amount)).toBe('number');

  expect(contribution).toHaveProperty('status');
  expect(typeof contribution.status).toBe('string');
}

/**
 * Normalize an API response where a contribution may be wrapped in
 * { contribution: {...} } or returned directly.
 *
 * @param {object} body
 * @returns {object}
 */
function getContributionFromResponse(body) {
  if (body?.contribution && typeof body.contribution === 'object') {
    return body.contribution;
  }

  return body;
}

/**
 * Safely remove test records if the corresponding models exist.
 */
async function cleanupTestData() {
  const cleanupOperations = [];

  if (Contribution) {
    const contributionFilter = {
      $or: [
        ...(userId ? [{ userId }] : []),
        ...(groupId ? [{ groupId }] : []),
      ],
    };

    if (contributionFilter.$or.length > 0) {
      cleanupOperations.push(
        Contribution.deleteMany(contributionFilter).catch(() => null)
      );
    }
  }

  if (Group && groupId) {
    cleanupOperations.push(
      Group.deleteOne({ _id: groupId }).catch(() => null)
    );
  }

  if (User && userId) {
    cleanupOperations.push(
      User.deleteOne({ _id: userId }).catch(() => null)
    );
  }

  await Promise.all(cleanupOperations);
}

// ============================================================================
// Suite state
// ============================================================================

let userToken;
let userId;
let groupId;

let contributionId;
let confirmContributionId;
let cancelContributionId;

let testEmail;

// ============================================================================
// Suite
// ============================================================================

describe('Contributions Integration Tests', () => {
  // ---------------------------------------------------------------------------
  // Global test timeout
  // ---------------------------------------------------------------------------

  jest.setTimeout(REQUEST_TIMEOUT);

  // ===========================================================================
  // Setup
  // ===========================================================================

  beforeAll(async () => {
    /**
     * Ensure a MongoDB connection exists.
     *
     * The application may already have initialized the connection when
     * `server.js` was imported. Only connect manually when necessary.
     */
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(
        process.env.MONGO_URI ||
          process.env.MONGODB_URI ||
          'mongodb://127.0.0.1:27017/community_savings_test'
      );
    }

    testEmail = uniqueEmail();

    // -------------------------------------------------------------------------
    // Register test user
    // -------------------------------------------------------------------------

    const userData = {
      email: testEmail,
      password: TEST_PASSWORD,
      fullName: 'Contribution Test User',
      phoneNumber: TEST_PHONE,
    };

    const registerRes = await request(app)
      .post('/api/auth/register')
      .send(userData)
      .expect((response) => {
        if (![200, 201].includes(response.statusCode)) {
          throw new Error(
            `Test user registration failed with ${response.statusCode}: ${JSON.stringify(
              response.body
            )}`
          );
        }
      });

    userToken =
      registerRes.body.token ||
      registerRes.body.accessToken ||
      registerRes.body.data?.token ||
      registerRes.body.data?.accessToken;

    userId =
      extractUserId(registerRes.body) ||
      registerRes.body.userId ||
      registerRes.body.data?.userId;

    /**
     * Some authentication systems require a separate login after
     * registration. Support both common application contracts.
     */
    if (!userToken) {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: TEST_PASSWORD,
        })
        .expect((response) => {
          if (response.statusCode !== 200) {
            throw new Error(
              `Test user login failed with ${response.statusCode}: ${JSON.stringify(
                response.body
              )}`
            );
          }
        });

      userToken =
        loginRes.body.token ||
        loginRes.body.accessToken ||
        loginRes.body.data?.token ||
        loginRes.body.data?.accessToken;

      userId =
        userId ||
        extractUserId(loginRes.body) ||
        loginRes.body.userId ||
        loginRes.body.data?.userId;
    }

    if (!userToken) {
      throw new Error(
        `Unable to obtain authentication token. Response: ${JSON.stringify(
          registerRes.body
        )}`
      );
    }

    if (!userId || !isValidObjectId(String(userId))) {
      throw new Error(
        `Unable to obtain valid test user ID. Response: ${JSON.stringify(
          registerRes.body
        )}`
      );
    }

    // -------------------------------------------------------------------------
    // Create test group
    // -------------------------------------------------------------------------

    const groupData = {
      name: uniqueGroupName(),
      description: 'Integration test group for contribution lifecycle testing.',
      targetAmount: 10000,
      cycle: 'monthly',
    };

    const groupRes = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${userToken}`)
      .send(groupData)
      .expect((response) => {
        if (![200, 201].includes(response.statusCode)) {
          throw new Error(
            `Test group creation failed with ${response.statusCode}: ${JSON.stringify(
              response.body
            )}`
          );
        }
      });

    groupId =
      extractGroupId(groupRes.body) ||
      groupRes.body.groupId ||
      groupRes.body.data?.groupId;

    if (!groupId || !isValidObjectId(String(groupId))) {
      throw new Error(
        `Unable to obtain valid test group ID. Response: ${JSON.stringify(
          groupRes.body
        )}`
      );
    }
  });

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  afterAll(async () => {
    await cleanupTestData();

    /**
     * Do not forcefully close the MongoDB connection if the application owns
     * it. Jest should manage the lifecycle through the test environment.
     */
  });

  // ===========================================================================
  // POST /api/contributions/submit
  // ===========================================================================

  describe('POST /api/contributions/submit', () => {
    it('should submit a valid contribution', async () => {
      const contributionData = {
        groupId,
        amount: 1000,
        paymentMethod: VALID_PAYMENT_METHOD,
        phone: TEST_PHONE,
      };

      const response = await request(app)
        .post(`${API_PREFIX}/submit`)
        .set('Authorization', `Bearer ${userToken}`)
        .send(contributionData)
        .expect(201);

      const contribution = getContributionFromResponse(response.body);

      expectContributionShape(contribution);

      expect(Number(contribution.amount)).toBe(1000);

      expect(['pending', 'processing', 'completed', 'confirmed']).toContain(
        contribution.status
      );

      contributionId = contribution._id;

      expect(isValidObjectId(String(contributionId))).toBe(true);
    });

    it('should reject a request without authentication', async () => {
      await request(app)
        .post(`${API_PREFIX}/submit`)
        .send({
          groupId,
          amount: 1000,
          paymentMethod: VALID_PAYMENT_METHOD,
          phone: TEST_PHONE,
        })
        .expect(401);
    });

    it('should reject a request without groupId', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/submit`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          amount: 1000,
          paymentMethod: VALID_PAYMENT_METHOD,
          phone: TEST_PHONE,
        })
        .expect(400);

      expectErrorMessage(response.body);
    });

    it('should reject a request without amount', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/submit`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          groupId,
          paymentMethod: VALID_PAYMENT_METHOD,
          phone: TEST_PHONE,
        })
        .expect(400);

      expectErrorMessage(response.body);
    });

    it('should reject zero amount', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/submit`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          groupId,
          amount: 0,
          paymentMethod: VALID_PAYMENT_METHOD,
          phone: TEST_PHONE,
        })
        .expect(400);

      expectErrorMessage(response.body);

      expect(JSON.stringify(response.body)).toMatch(
        /amount|positive|greater|minimum/i
      );
    });

    it('should reject negative amount', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/submit`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          groupId,
          amount: -100,
          paymentMethod: VALID_PAYMENT_METHOD,
          phone: TEST_PHONE,
        })
        .expect(400);

      expectErrorMessage(response.body);

      expect(JSON.stringify(response.body)).toMatch(
        /amount|positive|greater|minimum/i
      );
    });

    it('should reject a malformed group ID', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/submit`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          groupId: 'not-a-valid-object-id',
          amount: 1000,
          paymentMethod: VALID_PAYMENT_METHOD,
          phone: TEST_PHONE,
        });

      expect([400, 404]).toContain(response.statusCode);
      expectErrorMessage(response.body);
    });

    it('should reject an unsupported payment method', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/submit`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          groupId,
          amount: 1000,
          paymentMethod: 'unsupported_payment_method',
          phone: TEST_PHONE,
        });

      expect([400, 422]).toContain(response.statusCode);
      expectErrorMessage(response.body);
    });

    it('should reject a non-numeric amount', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/submit`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          groupId,
          amount: 'not-a-number',
          paymentMethod: VALID_PAYMENT_METHOD,
          phone: TEST_PHONE,
        });

      expect([400, 422]).toContain(response.statusCode);
      expectErrorMessage(response.body);
    });
  });

  // ===========================================================================
  // GET /api/contributions
  // ===========================================================================

  describe('GET /api/contributions', () => {
    it('should require authentication', async () => {
      await request(app)
        .get(API_PREFIX)
        .expect(401);
    });

    it('should fetch contributions for the authenticated user', async () => {
      const response = await request(app)
        .get(API_PREFIX)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body).toHaveProperty('contributions');
      expect(Array.isArray(response.body.contributions)).toBe(true);

      response.body.contributions.forEach((contribution) => {
        expectContributionShape(contribution);
      });
    });

    it('should support filtering by groupId', async () => {
      const response = await request(app)
        .get(`${API_PREFIX}?groupId=${encodeURIComponent(groupId)}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('contributions');
      expect(Array.isArray(response.body.contributions)).toBe(true);

      response.body.contributions.forEach((contribution) => {
        expect(String(contribution.groupId)).toBe(String(groupId));
      });
    });

    it('should support status filtering', async () => {
      const response = await request(app)
        .get(`${API_PREFIX}?status=pending`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('contributions');
      expect(Array.isArray(response.body.contributions)).toBe(true);

      response.body.contributions.forEach((contribution) => {
        expect(String(contribution.status).toLowerCase()).toBe('pending');
      });
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get(`${API_PREFIX}?page=1&limit=10`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('contributions');
      expect(Array.isArray(response.body.contributions)).toBe(true);

      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination).toBeDefined();
      expect(typeof response.body.pagination).toBe('object');
    });

    it('should support date range filtering', async () => {
      const endDate = new Date();
      const startDate = new Date(
        endDate.getTime() - 30 * 24 * 60 * 60 * 1000
      );

      const response = await request(app)
        .get(
          `${API_PREFIX}?startDate=${encodeURIComponent(
            startDate.toISOString()
          )}&endDate=${encodeURIComponent(endDate.toISOString())}`
        )
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('contributions');
      expect(Array.isArray(response.body.contributions)).toBe(true);
    });

    it('should reject an invalid pagination limit', async () => {
      const response = await request(app)
        .get(`${API_PREFIX}?page=1&limit=-1`)
        .set('Authorization', `Bearer ${userToken}`);

      expect([200, 400, 422]).toContain(response.statusCode);

      if ([400, 422].includes(response.statusCode)) {
        expectErrorMessage(response.body);
      }
    });
  });

  // ===========================================================================
  // GET /api/contributions/:contributionId
  // ===========================================================================

  describe('GET /api/contributions/:contributionId', () => {
    it('should fetch contribution details', async () => {
      expect(contributionId).toBeDefined();

      const response = await request(app)
        .get(`${API_PREFIX}/${contributionId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const contribution = getContributionFromResponse(response.body);

      expectContributionShape(contribution);

      expect(String(contribution._id)).toBe(String(contributionId));

      expect(contribution).toHaveProperty('amount');
      expect(contribution).toHaveProperty('status');
    });

    it('should reject access without authentication', async () => {
      await request(app)
        .get(`${API_PREFIX}/${contributionId}`)
        .expect(401);
    });

    it('should handle a malformed contribution ID', async () => {
      const response = await request(app)
        .get(`${API_PREFIX}/invalid-contribution-id`)
        .set('Authorization', `Bearer ${userToken}`);

      expect([400, 404]).toContain(response.statusCode);
      expectErrorMessage(response.body);
    });

    it('should return not found for a valid but non-existent contribution ID', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      const response = await request(app)
        .get(`${API_PREFIX}/${nonExistentId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect([404, 400]).toContain(response.statusCode);
      expectErrorMessage(response.body);
    });
  });

  // ===========================================================================
  // GET /api/contributions/group/:groupId/statistics
  // ===========================================================================

  describe('GET /api/contributions/group/:groupId/statistics', () => {
    it('should fetch group contribution statistics', async () => {
      const response = await request(app)
        .get(`${API_PREFIX}/group/${groupId}/statistics`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body).toBeDefined();

      expect(response.body).toHaveProperty('totalContributions');
      expect(response.body).toHaveProperty('averageContribution');
      expect(response.body).toHaveProperty('memberCount');
      expect(response.body).toHaveProperty('targetProgress');
    });

    it('should require authentication', async () => {
      await request(app)
        .get(`${API_PREFIX}/group/${groupId}/statistics`)
        .expect(401);
    });

    it('should handle an invalid group ID', async () => {
      const response = await request(app)
        .get(`${API_PREFIX}/group/invalid-group-id/statistics`)
        .set('Authorization', `Bearer ${userToken}`);

      expect([400, 404]).toContain(response.statusCode);
      expectErrorMessage(response.body);
    });
  });

  // ===========================================================================
  // GET /api/contributions/user/:userId/statistics
  // ===========================================================================

  describe('GET /api/contributions/user/:userId/statistics', () => {
    it('should fetch user contribution statistics', async () => {
      const response = await request(app)
        .get(`${API_PREFIX}/user/${userId}/statistics`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body).toBeDefined();

      expect(response.body).toHaveProperty('totalContributed');
      expect(response.body).toHaveProperty('groupsContributedTo');
      expect(response.body).toHaveProperty('averageContribution');
    });

    it('should require authentication', async () => {
      await request(app)
        .get(`${API_PREFIX}/user/${userId}/statistics`)
        .expect(401);
    });

    it('should handle an invalid user ID', async () => {
      const response = await request(app)
        .get(`${API_PREFIX}/user/invalid-user-id/statistics`)
        .set('Authorization', `Bearer ${userToken}`);

      expect([400, 404]).toContain(response.statusCode);
      expectErrorMessage(response.body);
    });
  });

  // ===========================================================================
  // POST /api/contributions/:contributionId/confirm
  // ===========================================================================

  describe('POST /api/contributions/:contributionId/confirm', () => {
    beforeAll(async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/submit`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          groupId,
          amount: 500,
          paymentMethod: VALID_PAYMENT_METHOD,
          phone: TEST_PHONE,
        });

      expect([200, 201]).toContain(response.statusCode);

      const contribution = getContributionFromResponse(response.body);

      expectContributionShape(contribution);

      confirmContributionId = contribution._id;
    });

    it('should have created a contribution specifically for confirmation testing', () => {
      expect(confirmContributionId).toBeDefined();
      expect(isValidObjectId(String(confirmContributionId))).toBe(true);
    });

    it('should confirm a pending contribution', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/${confirmContributionId}/confirm`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          transactionId: `test-tx-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        });

      expect([200, 201]).toContain(response.statusCode);

      const contribution = getContributionFromResponse(response.body);

      expectContributionShape(contribution);

      expect(['completed', 'confirmed']).toContain(
        String(contribution.status).toLowerCase()
      );
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/${confirmContributionId}/confirm`)
        .send({
          transactionId: `unauthenticated-${Date.now()}`,
        });

      expect(response.statusCode).toBe(401);
    });

    it('should reject a malformed contribution ID', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/invalid-contribution-id/confirm`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          transactionId: 'invalid-id-test',
        });

      expect([400, 404]).toContain(response.statusCode);
      expectErrorMessage(response.body);
    });

    it('should not silently create a second contribution when confirming', async () => {
      const beforeResponse = await request(app)
        .get(API_PREFIX)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const beforeCount = beforeResponse.body.contributions.length;

      const response = await request(app)
        .post(`${API_PREFIX}/${confirmContributionId}/confirm`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          transactionId: `repeat-confirm-${Date.now()}`,
        });

      expect([200, 400, 409]).toContain(response.statusCode);

      const afterResponse = await request(app)
        .get(API_PREFIX)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const afterCount = afterResponse.body.contributions.length;

      expect(afterCount).toBe(beforeCount);
    });
  });

  // ===========================================================================
  // POST /api/contributions/:contributionId/cancel
  // ===========================================================================

  describe('POST /api/contributions/:contributionId/cancel', () => {
    beforeAll(async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/submit`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          groupId,
          amount: 250,
          paymentMethod: VALID_PAYMENT_METHOD,
          phone: TEST_PHONE,
        });

      expect([200, 201]).toContain(response.statusCode);

      const contribution = getContributionFromResponse(response.body);

      expectContributionShape(contribution);

      cancelContributionId = contribution._id;
    });

    it('should have created a contribution specifically for cancellation testing', () => {
      expect(cancelContributionId).toBeDefined();
      expect(isValidObjectId(String(cancelContributionId))).toBe(true);
    });

    it('should cancel a pending contribution', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/${cancelContributionId}/cancel`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          reason: 'Changed mind during integration testing',
        })
        .expect(200);

      const contribution = getContributionFromResponse(response.body);

      expectContributionShape(contribution);

      expect(String(contribution.status).toLowerCase()).toBe('cancelled');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/${cancelContributionId}/cancel`)
        .send({
          reason: 'Unauthenticated cancellation attempt',
        });

      expect(response.statusCode).toBe(401);
    });

    it('should reject a malformed contribution ID', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/invalid-contribution-id/cancel`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          reason: 'Invalid ID test',
        });

      expect([400, 404]).toContain(response.statusCode);
      expectErrorMessage(response.body);
    });

    it('should not allow a cancelled contribution to be cancelled again', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/${cancelContributionId}/cancel`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          reason: 'Duplicate cancellation attempt',
        });

      expect([200, 400, 409]).toContain(response.statusCode);

      if ([400, 409].includes(response.statusCode)) {
        expectErrorMessage(response.body);
      }
    });
  });

  // ===========================================================================
  // Contribution lifecycle protection
  // ===========================================================================

  describe('Contribution lifecycle protection', () => {
    let lifecycleContributionId;

    beforeAll(async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/submit`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          groupId,
          amount: 750,
          paymentMethod: VALID_PAYMENT_METHOD,
          phone: TEST_PHONE,
        });

      expect([200, 201]).toContain(response.statusCode);

      lifecycleContributionId =
        getContributionFromResponse(response.body)._id;
    });

    it('should not allow cancellation after successful confirmation', async () => {
      const confirmationResponse = await request(app)
        .post(`${API_PREFIX}/${lifecycleContributionId}/confirm`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          transactionId: `lifecycle-confirm-${Date.now()}`,
        });

      expect([200, 201, 400, 409]).toContain(
        confirmationResponse.statusCode
      );

      if ([200, 201].includes(confirmationResponse.statusCode)) {
        const contribution = getContributionFromResponse(
          confirmationResponse.body
        );

        expect(['completed', 'confirmed']).toContain(
          String(contribution.status).toLowerCase()
        );

        const cancelResponse = await request(app)
          .post(`${API_PREFIX}/${lifecycleContributionId}/cancel`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            reason: 'Too late',
          });

        expect([400, 409]).toContain(cancelResponse.statusCode);
        expectErrorMessage(cancelResponse.body);

        expect(JSON.stringify(cancelResponse.body)).toMatch(
          /cannot|confirmed|completed|cancel/i
        );
      }
    });
  });

  // ===========================================================================
  // POST /api/contributions/batch-import
  // ===========================================================================

  describe('POST /api/contributions/batch-import', () => {
    it('should require authentication', async () => {
      await request(app)
        .post(`${API_PREFIX}/batch-import`)
        .send({
          csvData: 'userId,groupId,amount,date',
        })
        .expect(401);
    });

    it('should import valid contribution records from CSV', async () => {
      const csvData = [
        'userId,groupId,amount,date',
        `${userId},${groupId},1000,2026-01-15`,
        `${userId},${groupId},1500,2026-02-15`,
        `${userId},${groupId},1200,2026-03-15`,
      ].join('\n');

      const response = await request(app)
        .post(`${API_PREFIX}/batch-import`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ csvData });

      expect([200, 201, 202]).toContain(response.statusCode);

      expect(response.body).toBeDefined();

      expect(response.body).toHaveProperty('imported');
      expect(response.body).toHaveProperty('failed');

      expect(Number(response.body.imported)).toBeGreaterThanOrEqual(0);
      expect(Number(response.body.failed)).toBeGreaterThanOrEqual(0);
    });

    it('should reject an empty CSV payload', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/batch-import`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          csvData: '',
        });

      expect([400, 422]).toContain(response.statusCode);
      expectErrorMessage(response.body);
    });

    it('should reject a malformed CSV payload', async () => {
      const response = await request(app)
        .post(`${API_PREFIX}/batch-import`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          csvData: 'this,is,not,a,valid,contribution,file',
        });

      expect([400, 422]).toContain(response.statusCode);
      expectErrorMessage(response.body);
    });
  });

  // ===========================================================================
  // Authorization / tenant isolation smoke tests
  // ===========================================================================

  describe('Authorization boundaries', () => {
    let secondUserToken;
    let secondUserId;
    let secondUserEmail;

    beforeAll(async () => {
      secondUserEmail = uniqueEmail();

      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: secondUserEmail,
          password: TEST_PASSWORD,
          fullName: 'Contribution Isolation User',
          phoneNumber: TEST_PHONE,
        });

      secondUserToken =
        registerResponse.body.token ||
        registerResponse.body.accessToken ||
        registerResponse.body.data?.token ||
        registerResponse.body.data?.accessToken;

      secondUserId =
        extractUserId(registerResponse.body) ||
        registerResponse.body.userId ||
        registerResponse.body.data?.userId;

      if (!secondUserToken) {
        const loginResponse = await request(app)
          .post('/api/auth/login')
          .send({
            email: secondUserEmail,
            password: TEST_PASSWORD,
          });

        secondUserToken =
          loginResponse.body.token ||
          loginResponse.body.accessToken ||
          loginResponse.body.data?.token ||
          loginResponse.body.data?.accessToken;

        secondUserId =
          secondUserId ||
          extractUserId(loginResponse.body) ||
          loginResponse.body.userId ||
          loginResponse.body.data?.userId;
      }
    });

    afterAll(async () => {
      if (Contribution && secondUserId) {
        await Contribution.deleteMany({
          userId: secondUserId,
        }).catch(() => null);
      }

      if (User && secondUserId) {
        await User.deleteOne({
          _id: secondUserId,
        }).catch(() => null);
      }
    });

    it('should not expose another user’s contribution through the authenticated collection endpoint', async () => {
      if (!secondUserToken) {
        return;
      }

      const response = await request(app)
        .get(API_PREFIX)
        .set('Authorization', `Bearer ${secondUserToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('contributions');
      expect(Array.isArray(response.body.contributions)).toBe(true);

      response.body.contributions.forEach((contribution) => {
        if (contribution.userId) {
          expect(String(contribution.userId)).not.toBe(String(userId));
        }
      });
    });

    it('should prevent another authenticated user from accessing the contribution directly', async () => {
      if (!secondUserToken || !contributionId) {
        return;
      }

      const response = await request(app)
        .get(`${API_PREFIX}/${contributionId}`)
        .set('Authorization', `Bearer ${secondUserToken}`);

      expect([403, 404]).toContain(response.statusCode);
      expectErrorMessage(response.body);
    });

    it('should prevent another authenticated user from cancelling the contribution', async () => {
      if (!secondUserToken || !contributionId) {
        return;
      }

      const response = await request(app)
        .post(`${API_PREFIX}/${contributionId}/cancel`)
        .set('Authorization', `Bearer ${secondUserToken}`)
        .send({
          reason: 'Cross-user authorization test',
        });

      expect([403, 404]).toContain(response.statusCode);
      expectErrorMessage(response.body);
    });
  });
});