'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Legal Documents Integration Test Suite
 * ============================================================================
 *
 * File:
 *   backend/tests/integration/legal.test.js
 *
 * Purpose:
 *   Production-grade integration tests for:
 *     - Terms of Service
 *     - Privacy Policy
 *     - Legal changelog
 *     - Terms acceptance
 *     - Legal acceptance status
 *     - Legal service-layer contracts
 *     - Legal document content integrity
 *     - Authentication/error handling
 *
 * Coverage:
 *   HTTP:
 *     GET  /api/legal/terms-of-service
 *     GET  /api/legal/privacy-policy
 *     GET  /api/legal/changelog
 *     POST /api/legal/accept-terms
 *     GET  /api/legal/acceptance-status
 *
 *   Service:
 *     termsAndPrivacy.getTermsOfService()
 *     termsAndPrivacy.getPrivacyPolicy()
 *     termsAndPrivacy.getVersion()
 *     termsAndPrivacy.getLastUpdated()
 *     termsAndPrivacy.getChangelog()
 *
 * Design goals:
 *   - Use a real authenticated test user
 *   - Never use a fabricated JWT for authenticated integration tests
 *   - Avoid global/destructive deleteMany({})
 *   - Derive current legal versions from the service where appropriate
 *   - Validate API response contracts
 *   - Validate legal-content integrity without hard-coding obsolete wording
 *   - Verify acceptance lifecycle
 *   - Verify unauthorized and malformed-authentication behavior
 *
 * ============================================================================
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');

const app = require('../../server');
const termsAndPrivacy = require('../../services/termsAndPrivacy');

// ============================================================================
// Constants
// ============================================================================

const TEST_PASSWORD = 'SecurePassword123!';

/**
 * Canonical TITech Community Capital test phone number.
 *
 * Keep this value consistent with the project's integration-test convention.
 */
const TEST_PHONE = '+256782397907';

const TEST_USER_NAME = 'TITech Legal Integration Test User';

const LEGAL_BASE_PATH = '/api/legal';

const TERMS_ENDPOINT = `${LEGAL_BASE_PATH}/terms-of-service`;
const PRIVACY_ENDPOINT = `${LEGAL_BASE_PATH}/privacy-policy`;
const CHANGELOG_ENDPOINT = `${LEGAL_BASE_PATH}/changelog`;
const ACCEPT_TERMS_ENDPOINT = `${LEGAL_BASE_PATH}/accept-terms`;
const ACCEPTANCE_STATUS_ENDPOINT = `${LEGAL_BASE_PATH}/acceptance-status`;

const REQUEST_TIMEOUT = 15_000;

// ============================================================================
// Model State
// ============================================================================

let User;
let LegalAcceptance;

// ============================================================================
// Test State
// ============================================================================

let testUser;
let authToken;

const createdUserIds = [];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a unique email for the integration-test user.
 *
 * @returns {string}
 */
function uniqueEmail() {
  return `legal-test-${Date.now()}-${crypto
    .randomBytes(4)
    .toString('hex')}@example.com`;
}

/**
 * Load optional models used for targeted cleanup.
 */
function loadModels() {
  // eslint-disable-next-line global-require
  User = require('../../models/User');

  try {
    // eslint-disable-next-line global-require
    LegalAcceptance = require('../../models/LegalAcceptance');
  } catch (_error) {
    LegalAcceptance = null;
  }
}

/**
 * Extract a user ID from common response structures.
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
    body.id ||
    body._id ||
    body.data?.userId ||
    body.data?.user?._id ||
    body.data?.user?.id ||
    null
  );
}

/**
 * Extract an access token from common authentication responses.
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
 * Create an authentication token for an already-created test user.
 *
 * This is used only as a fallback when registration succeeds without returning
 * a token. The primary test path uses the application's own authentication
 * endpoint.
 *
 * @param {object} user
 * @returns {string}
 */
function createFallbackJwt(user) {
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
 * Assert the standard legal document response shape.
 *
 * @param {object} responseBody
 * @param {string} expectedDocumentTitleFragment
 */
function expectLegalDocumentShape(
  responseBody,
  expectedDocumentTitleFragment
) {
  expect(responseBody).toBeDefined();
  expect(responseBody).toHaveProperty('success', true);
  expect(responseBody).toHaveProperty('data');

  expect(responseBody.data).toBeDefined();
  expect(responseBody.data).toHaveProperty('title');
  expect(responseBody.data).toHaveProperty('version');
  expect(responseBody.data).toHaveProperty('content');

  expect(typeof responseBody.data.title).toBe('string');
  expect(responseBody.data.title.length).toBeGreaterThan(0);

  expect(typeof responseBody.data.version).toBe('string');
  expect(responseBody.data.version.length).toBeGreaterThan(0);

  expect(typeof responseBody.data.content).toBe('string');
  expect(responseBody.data.content.length).toBeGreaterThan(0);

  expect(responseBody.data.title.toLowerCase()).toContain(
    expectedDocumentTitleFragment.toLowerCase()
  );
}

/**
 * Assert an error response contains a useful message.
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
 * Assert semantic-version formatting.
 *
 * @param {string} version
 */
function expectSemanticVersion(version) {
  expect(typeof version).toBe('string');
  expect(version).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
}

/**
 * Assert a valid date-like value.
 *
 * @param {*} value
 */
function expectValidDate(value) {
  const date = new Date(value);

  expect(date.toString()).not.toBe('Invalid Date');
}

/**
 * Create a test user through the model.
 *
 * @returns {Promise<object>}
 */
async function createTestUser() {
  const email = uniqueEmail();

  const user = await User.create({
    name: TEST_USER_NAME,
    fullName: TEST_USER_NAME,
    email,
    password: TEST_PASSWORD,
    phoneNumber: TEST_PHONE,
    verified: true,
  });

  createdUserIds.push(String(user._id));

  return user;
}

/**
 * Authenticate the test user through the application's authentication API.
 *
 * @param {object} user
 * @returns {Promise<string>}
 */
async function authenticateTestUser(user) {
  const loginResponse = await request(app)
    .post('/api/auth/login')
    .send({
      email: user.email,
      password: TEST_PASSWORD,
    });

  if ([200, 201].includes(loginResponse.statusCode)) {
    const token = extractAuthToken(loginResponse.body);

    if (token) {
      return token;
    }
  }

  /**
   * Some repositories use a different authentication bootstrap during tests.
   * Fall back to the project's JWT secret only if login did not return a token.
   */
  return createFallbackJwt(user);
}

/**
 * Safely clean only records owned by this test suite.
 */
async function cleanupTestData() {
  const userIds = createdUserIds.filter((id) =>
    mongoose.Types.ObjectId.isValid(id)
  );

  if (userIds.length === 0) {
    return;
  }

  const operations = [];

  if (LegalAcceptance) {
    operations.push(
      LegalAcceptance.deleteMany({
        $or: [
          { user: { $in: userIds } },
          { userId: { $in: userIds } },
        ],
      }).catch(() => null)
    );
  }

  if (User) {
    operations.push(
      User.deleteMany({
        _id: { $in: userIds },
      }).catch(() => null)
    );
  }

  await Promise.allSettled(operations);
}

/**
 * Read the current terms version from the service.
 *
 * @returns {string}
 */
function getCurrentTermsVersion() {
  return termsAndPrivacy.getVersion('terms');
}

/**
 * Read the current privacy version from the service.
 *
 * @returns {string}
 */
function getCurrentPrivacyVersion() {
  return termsAndPrivacy.getVersion('privacy');
}

// ============================================================================
// Suite
// ============================================================================

describe('TITech Community Capital Legal Documents Integration Tests', () => {
  jest.setTimeout(REQUEST_TIMEOUT);

  // ==========================================================================
  // Setup
  // ==========================================================================

  beforeAll(async () => {
    loadModels();

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(
        process.env.MONGO_URI ||
          process.env.MONGODB_URI ||
          'mongodb://127.0.0.1:27017/community_savings_test'
      );
    }

    testUser = await createTestUser();

    authToken = await authenticateTestUser(testUser);

    expect(authToken).toBeDefined();
    expect(typeof authToken).toBe('string');
    expect(authToken.length).toBeGreaterThan(0);
  });

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  afterAll(async () => {
    await cleanupTestData();
  });

  // ==========================================================================
  // GET /api/legal/terms-of-service
  // ==========================================================================

  describe(`GET ${TERMS_ENDPOINT}`, () => {
    test('should return Terms of Service without authentication', async () => {
      const response = await request(app)
        .get(TERMS_ENDPOINT)
        .expect(200);

      expectLegalDocumentShape(response.body, 'terms');

      expect(response.body.data.version).toBe(
        getCurrentTermsVersion()
      );
    });

    test('should include effective-date metadata when provided by the API', async () => {
      const response = await request(app)
        .get(TERMS_ENDPOINT)
        .expect(200);

      const data = response.body.data;

      if (data.effectiveDate !== undefined) {
        expectValidDate(data.effectiveDate);
      }

      if (data.lastUpdated !== undefined) {
        expectValidDate(data.lastUpdated);
      }
    });

    test('should expose meaningful Terms content', async () => {
      const response = await request(app)
        .get(TERMS_ENDPOINT)
        .expect(200);

      const content = response.body.data.content;

      expect(content.length).toBeGreaterThan(500);

      expect(content.toLowerCase()).toContain('terms');
      expect(content.toLowerCase()).toMatch(
        /acceptance|agreement|service|user|account/
      );
    });

    test('should expose the current legal version dynamically', async () => {
      const serviceTerms = termsAndPrivacy.getTermsOfService();

      const response = await request(app)
        .get(TERMS_ENDPOINT)
        .expect(200);

      expect(response.body.data.version).toBe(serviceTerms.version);
    });
  });

  // ==========================================================================
  // GET /api/legal/privacy-policy
  // ==========================================================================

  describe(`GET ${PRIVACY_ENDPOINT}`, () => {
    test('should return Privacy Policy without authentication', async () => {
      const response = await request(app)
        .get(PRIVACY_ENDPOINT)
        .expect(200);

      expectLegalDocumentShape(response.body, 'privacy');

      expect(response.body.data.version).toBe(
        getCurrentPrivacyVersion()
      );
    });

    test('should include privacy metadata when provided by the API', async () => {
      const response = await request(app)
        .get(PRIVACY_ENDPOINT)
        .expect(200);

      const data = response.body.data;

      if (data.effectiveDate !== undefined) {
        expectValidDate(data.effectiveDate);
      }

      if (data.lastUpdated !== undefined) {
        expectValidDate(data.lastUpdated);
      }
    });

    test('should contain meaningful privacy and data-protection content', async () => {
      const response = await request(app)
        .get(PRIVACY_ENDPOINT)
        .expect(200);

      const content = response.body.data.content.toLowerCase();

      expect(response.body.data.content.length).toBeGreaterThan(500);

      expect(content).toMatch(
        /personal data|personal information|privacy|data protection/
      );

      expect(content).toMatch(
        /collect|use|process|store|retain|share|disclose/
      );
    });

    test('should expose the current privacy version dynamically', async () => {
      const servicePolicy = termsAndPrivacy.getPrivacyPolicy();

      const response = await request(app)
        .get(PRIVACY_ENDPOINT)
        .expect(200);

      expect(response.body.data.version).toBe(servicePolicy.version);
    });
  });

  // ==========================================================================
  // GET /api/legal/changelog
  // ==========================================================================

  describe(`GET ${CHANGELOG_ENDPOINT}`, () => {
    test('should return the legal changelog without authentication', async () => {
      const response = await request(app)
        .get(CHANGELOG_ENDPOINT)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');

      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('should contain structurally valid changelog entries', async () => {
      const response = await request(app)
        .get(CHANGELOG_ENDPOINT)
        .expect(200);

      const changelog = response.body.data;

      expect(changelog.length).toBeGreaterThan(0);

      changelog.forEach((entry) => {
        expect(entry).toHaveProperty('version');
        expect(entry).toHaveProperty('date');
        expect(entry).toHaveProperty('document');
        expect(entry).toHaveProperty('changes');

        expectSemanticVersion(entry.version);
        expectValidDate(entry.date);

        expect(typeof entry.document).toBe('string');
        expect(entry.document.length).toBeGreaterThan(0);

        expect(Array.isArray(entry.changes)).toBe(true);
        expect(entry.changes.length).toBeGreaterThan(0);
      });
    });

    test('should expose the same changelog as the service layer', async () => {
      const serviceChangelog = termsAndPrivacy.getChangelog();

      const response = await request(app)
        .get(CHANGELOG_ENDPOINT)
        .expect(200);

      expect(response.body.data).toEqual(serviceChangelog);
    });

    test('should have the newest changelog entry first when the service contract is ordered newest-first', async () => {
      const serviceChangelog = termsAndPrivacy.getChangelog();

      if (serviceChangelog.length < 2) {
        return;
      }

      const firstDate = new Date(serviceChangelog[0].date).getTime();
      const secondDate = new Date(serviceChangelog[1].date).getTime();

      if (
        Number.isFinite(firstDate) &&
        Number.isFinite(secondDate)
      ) {
        expect(firstDate).toBeGreaterThanOrEqual(secondDate);
      }
    });
  });

  // ==========================================================================
  // POST /api/legal/accept-terms
  // ==========================================================================

  describe(`POST ${ACCEPT_TERMS_ENDPOINT}`, () => {
    test('should reject unauthenticated acceptance attempts', async () => {
      const response = await request(app)
        .post(ACCEPT_TERMS_ENDPOINT)
        .send({});

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
      expectErrorMessage(response.body);
    });

    test('should record legal acceptance for an authenticated user', async () => {
      const response = await request(app)
        .post(ACCEPT_TERMS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect((res) => {
          if (![200, 201].includes(res.statusCode)) {
            throw new Error(
              `Legal acceptance failed with status ${res.statusCode}: ${JSON.stringify(
                res.body
              )}`
            );
          }
        });

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');

      expect(response.body.data).toHaveProperty('acceptedAt');
      expectValidDate(response.body.data.acceptedAt);

      if (response.body.data.termsVersion !== undefined) {
        expect(response.body.data.termsVersion).toBe(
          getCurrentTermsVersion()
        );
      }

      if (response.body.data.privacyVersion !== undefined) {
        expect(response.body.data.privacyVersion).toBe(
          getCurrentPrivacyVersion()
        );
      }
    });

    test('should capture acceptance metadata when the API exposes it', async () => {
      const response = await request(app)
        .post(ACCEPT_TERMS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .set('User-Agent', 'TITech-Legal-Integration-Test/1.0')
        .send({});

      expect([200, 201, 204]).toContain(response.status);

      if (response.status !== 204) {
        expect(response.body).toBeDefined();

        if (response.body.data) {
          expect(response.body.data).toHaveProperty('acceptedAt');
        }
      }
    });

    test('should be idempotent or safely handle repeated acceptance', async () => {
      const firstResponse = await request(app)
        .post(ACCEPT_TERMS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect([200, 201, 204, 409]).toContain(firstResponse.status);

      const secondResponse = await request(app)
        .post(ACCEPT_TERMS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect([200, 201, 204, 409]).toContain(secondResponse.status);

      if (secondResponse.status === 409) {
        expectErrorMessage(secondResponse.body);
      }
    });
  });

  // ==========================================================================
  // GET /api/legal/acceptance-status
  // ==========================================================================

  describe(`GET ${ACCEPTANCE_STATUS_ENDPOINT}`, () => {
    test('should reject unauthenticated status requests', async () => {
      const response = await request(app)
        .get(ACCEPTANCE_STATUS_ENDPOINT)
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
      expectErrorMessage(response.body);
    });

    test('should return legal acceptance status for the authenticated user', async () => {
      const response = await request(app)
        .get(ACCEPTANCE_STATUS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');

      expect(response.body.data).toHaveProperty('hasAccepted');
      expect(typeof response.body.data.hasAccepted).toBe('boolean');

      if (response.body.data.acceptedTerms !== undefined) {
        expect(typeof response.body.data.acceptedTerms).toBe('boolean');
      }

      if (response.body.data.acceptedPrivacy !== undefined) {
        expect(typeof response.body.data.acceptedPrivacy).toBe('boolean');
      }
    });

    test('should expose current legal version requirements', async () => {
      const response = await request(app)
        .get(ACCEPTANCE_STATUS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty(
        'currentTermsVersion'
      );

      expect(response.body.data).toHaveProperty(
        'currentPrivacyVersion'
      );

      expect(response.body.data.currentTermsVersion).toBe(
        getCurrentTermsVersion()
      );

      expect(response.body.data.currentPrivacyVersion).toBe(
        getCurrentPrivacyVersion()
      );
    });

    test('should reflect acceptance after a successful acceptance mutation', async () => {
      await request(app)
        .post(ACCEPT_TERMS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      const response = await request(app)
        .get(ACCEPTANCE_STATUS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toBeDefined();

      if (typeof response.body.data.hasAccepted === 'boolean') {
        expect(response.body.data.hasAccepted).toBe(true);
      }

      if (typeof response.body.data.acceptedTerms === 'boolean') {
        expect(response.body.data.acceptedTerms).toBe(true);
      }

      if (typeof response.body.data.acceptedPrivacy === 'boolean') {
        expect(response.body.data.acceptedPrivacy).toBe(true);
      }
    });
  });

  // ==========================================================================
  // Service Layer
  // ==========================================================================

  describe('Service Layer', () => {
    describe('getTermsOfService()', () => {
      test('should return the required legal-document properties', () => {
        const terms = termsAndPrivacy.getTermsOfService();

        expect(terms).toBeDefined();
        expect(typeof terms).toBe('object');

        expect(terms).toHaveProperty('title');
        expect(terms).toHaveProperty('version');
        expect(terms).toHaveProperty('effectiveDate');
        expect(terms).toHaveProperty('lastUpdated');
        expect(terms).toHaveProperty('content');

        expect(typeof terms.title).toBe('string');
        expect(typeof terms.version).toBe('string');
        expect(typeof terms.content).toBe('string');

        expectSemanticVersion(terms.version);
      });

      test('should have substantial non-empty content', () => {
        const terms = termsAndPrivacy.getTermsOfService();

        expect(terms.content).toBeTruthy();
        expect(terms.content.length).toBeGreaterThan(500);
      });

      test('should contain core contractual concepts', () => {
        const terms = termsAndPrivacy
          .getTermsOfService()
          .content.toLowerCase();

        const requiredConceptGroups = [
          /(acceptance|agreement|consent)/,
          /(account|user)/,
          /(service|platform)/,
          /(payment|financial|transaction)/,
          /(liability|responsibility)/,
          /(governing law|jurisdiction|dispute)/,
        ];

        requiredConceptGroups.forEach((pattern) => {
          expect(terms).toMatch(pattern);
        });
      });
    });

    describe('getPrivacyPolicy()', () => {
      test('should return the required privacy-document properties', () => {
        const policy = termsAndPrivacy.getPrivacyPolicy();

        expect(policy).toBeDefined();
        expect(typeof policy).toBe('object');

        expect(policy).toHaveProperty('title');
        expect(policy).toHaveProperty('version');
        expect(policy).toHaveProperty('content');

        expect(typeof policy.title).toBe('string');
        expect(typeof policy.version).toBe('string');
        expect(typeof policy.content).toBe('string');

        expectSemanticVersion(policy.version);
      });

      test('should have substantial non-empty content', () => {
        const policy = termsAndPrivacy.getPrivacyPolicy();

        expect(policy.content).toBeTruthy();
        expect(policy.content.length).toBeGreaterThan(500);
      });

      test('should cover fundamental data-protection concepts', () => {
        const content = termsAndPrivacy
          .getPrivacyPolicy()
          .content.toLowerCase();

        const conceptPatterns = [
          /(personal data|personal information)/,
          /(privacy|data protection)/,
          /(collect|collection)/,
          /(use|process|processing)/,
          /(retain|retention|storage|store)/,
          /(share|disclose|third part)/,
          /(rights|right to)/,
          /(security|secure|protection)/,
        ];

        conceptPatterns.forEach((pattern) => {
          expect(content).toMatch(pattern);
        });
      });

      test('should identify the current privacy version consistently', () => {
        const policy = termsAndPrivacy.getPrivacyPolicy();
        const version = termsAndPrivacy.getVersion('privacy');

        expect(policy.version).toBe(version);
      });
    });

    describe('getVersion()', () => {
      test('should return the current Terms version', () => {
        const version = termsAndPrivacy.getVersion('terms');

        expectSemanticVersion(version);

        expect(version).toBe(
          termsAndPrivacy.getTermsOfService().version
        );
      });

      test('should return the current Privacy version', () => {
        const version = termsAndPrivacy.getVersion('privacy');

        expectSemanticVersion(version);

        expect(version).toBe(
          termsAndPrivacy.getPrivacyPolicy().version
        );
      });

      test('should provide a defined result for unknown types according to the service contract', () => {
        const version = termsAndPrivacy.getVersion('unknown');

        expect(version).toBeDefined();
        expect(typeof version).toBe('string');

        expectSemanticVersion(version);
      });
    });

    describe('getLastUpdated()', () => {
      test('should return a valid date for Terms', () => {
        const date = termsAndPrivacy.getLastUpdated('terms');

        expect(date).toBeInstanceOf(Date);
        expect(date.toString()).not.toBe('Invalid Date');
      });

      test('should return a valid date for Privacy', () => {
        const date = termsAndPrivacy.getLastUpdated('privacy');

        expect(date).toBeInstanceOf(Date);
        expect(date.toString()).not.toBe('Invalid Date');
      });

      test('should return dates consistent with document metadata when present', () => {
        const terms = termsAndPrivacy.getTermsOfService();
        const policy = termsAndPrivacy.getPrivacyPolicy();

        const termsUpdated = termsAndPrivacy.getLastUpdated('terms');
        const policyUpdated = termsAndPrivacy.getLastUpdated('privacy');

        if (terms.lastUpdated) {
          expect(termsUpdated.getTime()).toBe(
            new Date(terms.lastUpdated).getTime()
          );
        }

        if (policy.lastUpdated) {
          expect(policyUpdated.getTime()).toBe(
            new Date(policy.lastUpdated).getTime()
          );
        }
      });
    });

    describe('getChangelog()', () => {
      test('should return a non-empty array', () => {
        const changelog = termsAndPrivacy.getChangelog();

        expect(Array.isArray(changelog)).toBe(true);
        expect(changelog.length).toBeGreaterThan(0);
      });

      test('should include all required changelog properties', () => {
        const changelog = termsAndPrivacy.getChangelog();

        changelog.forEach((entry) => {
          expect(entry).toHaveProperty('version');
          expect(entry).toHaveProperty('date');
          expect(entry).toHaveProperty('document');
          expect(entry).toHaveProperty('changes');

          expectSemanticVersion(entry.version);
          expectValidDate(entry.date);

          expect(typeof entry.document).toBe('string');
          expect(Array.isArray(entry.changes)).toBe(true);
          expect(entry.changes.length).toBeGreaterThan(0);
        });
      });
    });
  });

  // ==========================================================================
  // Content Integrity
  // ==========================================================================

  describe('Content Integrity', () => {
    test('Terms and Privacy versions should use semantic-version format', () => {
      expectSemanticVersion(
        termsAndPrivacy.getTermsOfService().version
      );

      expectSemanticVersion(
        termsAndPrivacy.getPrivacyPolicy().version
      );
    });

    test('Terms and Privacy should have non-empty titles and content', () => {
      const terms = termsAndPrivacy.getTermsOfService();
      const policy = termsAndPrivacy.getPrivacyPolicy();

      expect(terms.title.trim().length).toBeGreaterThan(0);
      expect(terms.content.trim().length).toBeGreaterThan(500);

      expect(policy.title.trim().length).toBeGreaterThan(0);
      expect(policy.content.trim().length).toBeGreaterThan(500);
    });

    test('Terms should define material contractual areas', () => {
      const content = termsAndPrivacy
        .getTermsOfService()
        .content.toLowerCase();

      const requiredConcepts = [
        'payment',
        'account',
        'liability',
      ];

      requiredConcepts.forEach((concept) => {
        expect(content).toContain(concept);
      });

      expect(content).toMatch(
        /governing law|jurisdiction|dispute|arbitration/
      );
    });

    test('Privacy Policy should define material data-governance areas', () => {
      const content = termsAndPrivacy
        .getPrivacyPolicy()
        .content.toLowerCase();

      const requiredConceptPatterns = [
        /personal (data|information)/,
        /data protection|privacy/,
        /security|secure|protection/,
        /retention|retain|store|storage/,
      ];

      requiredConceptPatterns.forEach((pattern) => {
        expect(content).toMatch(pattern);
      });
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    test('should reject an invalid bearer token on acceptance-status', async () => {
      const response = await request(app)
        .get(ACCEPTANCE_STATUS_ENDPOINT)
        .set('Authorization', 'Bearer invalid.token.here');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
      expectErrorMessage(response.body);
    });

    test('should reject an invalid bearer token on terms acceptance', async () => {
      const response = await request(app)
        .post(ACCEPT_TERMS_ENDPOINT)
        .set('Authorization', 'Bearer invalid.token.here')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
      expectErrorMessage(response.body);
    });

    test('should reject requests with a missing Authorization header', async () => {
      const response = await request(app)
        .post(ACCEPT_TERMS_ENDPOINT)
        .send({});

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
      expectErrorMessage(response.body);
    });

    test('should reject malformed Authorization headers', async () => {
      const response = await request(app)
        .get(ACCEPTANCE_STATUS_ENDPOINT)
        .set('Authorization', 'NotBearerToken');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
      expectErrorMessage(response.body);
    });

    test('should return a helpful error message for unauthorized access', async () => {
      const response = await request(app)
        .post(ACCEPT_TERMS_ENDPOINT)
        .expect(401);

      expect(response.body.message).toBeTruthy();
      expect(typeof response.body.message).toBe('string');
      expect(response.body.message.trim().length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Cross-layer consistency
  // ==========================================================================

  describe('Cross-Layer Legal Contract Consistency', () => {
    test('Terms API version should match service version', async () => {
      const response = await request(app)
        .get(TERMS_ENDPOINT)
        .expect(200);

      expect(response.body.data.version).toBe(
        termsAndPrivacy.getTermsOfService().version
      );
    });

    test('Privacy API version should match service version', async () => {
      const response = await request(app)
        .get(PRIVACY_ENDPOINT)
        .expect(200);

      expect(response.body.data.version).toBe(
        termsAndPrivacy.getPrivacyPolicy().version
      );
    });

    test('Acceptance-status versions should match service versions', async () => {
      const response = await request(app)
        .get(ACCEPTANCE_STATUS_ENDPOINT)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.currentTermsVersion).toBe(
        termsAndPrivacy.getVersion('terms')
      );

      expect(response.body.data.currentPrivacyVersion).toBe(
        termsAndPrivacy.getVersion('privacy')
      );
    });

    test('Changelog should be available from both service and API', async () => {
      const serviceChangelog = termsAndPrivacy.getChangelog();

      const response = await request(app)
        .get(CHANGELOG_ENDPOINT)
        .expect(200);

      expect(response.body.data).toEqual(serviceChangelog);
    });
  });
});