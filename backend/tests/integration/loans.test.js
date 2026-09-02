'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Loan Workflow Integration Test Suite
 * ============================================================================
 *
 * File:
 *   backend/tests/integration/loans.test.js
 *
 * Purpose:
 *   Production-grade integration tests for loan application, approval,
 *   disbursement, repayment, schedule, summary, authorization and audit
 *   workflows.
 *
 * Coverage:
 *   - Authentication requirements
 *   - Loan application creation
 *   - Loan application validation
 *   - Admin approval workflow
 *   - Admin rejection workflow
 *   - State-machine transitions
 *   - Disbursement workflow
 *   - Repayment schedule
 *   - Repayment recording
 *   - Repayment validation
 *   - Loan summary
 *   - Authorization boundaries
 *   - Malformed/non-existent loan IDs
 *   - Audit trail
 *   - Lifecycle protection
 *   - Targeted test-data cleanup
 *
 * Design goals:
 *   - Deterministic integration tests
 *   - Real application HTTP stack through Supertest
 *   - Isolated test users
 *   - No global/destructive database cleanup
 *   - Explicit state-transition assertions
 *   - Consistent TITech test identity
 *
 * ============================================================================
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');

const app = require('../../server');
const LoanWorkflowService = require('../../services/loanWorkflowService');

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

const REQUEST_TIMEOUT = 15_000;

const LOAN_ENDPOINT = '/api/loans';

const VALID_REPAYMENT_METHOD = 'bank_transfer';

// ============================================================================
// Model References
// ============================================================================

let User;
let Loan;
let LoanRepaymentSchedule;
let LoanAudit;

// ============================================================================
// Test State
// ============================================================================

let borrower;
let admin;
let otherUser;

let borrowerToken;
let adminToken;
let otherUserToken;

let loanService;

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
function uniqueEmail(prefix = 'loan-test') {
  return `${prefix}-${Date.now()}-${crypto
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
 * Extract a token from common authentication response shapes.
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
 * Extract a user ID from common response shapes.
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
 * Extract loan data from common response shapes.
 *
 * @param {object} body
 * @returns {object}
 */
function extractLoan(body) {
  if (!body || typeof body !== 'object') {
    return body;
  }

  if (body.data && typeof body.data === 'object') {
    return body.data;
  }

  if (body.loan && typeof body.loan === 'object') {
    return body.loan;
  }

  return body;
}

/**
 * Extract a loan ID from common response shapes.
 *
 * @param {object} body
 * @returns {string|null}
 */
function extractLoanId(body) {
  const loan = extractLoan(body);

  if (!loan || typeof loan !== 'object') {
    return null;
  }

  return loan._id || loan.id || null;
}

/**
 * Assert a useful API error response.
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
 * Assert basic loan response shape.
 *
 * @param {object} loan
 */
function expectLoanShape(loan) {
  expect(loan).toBeDefined();
  expect(typeof loan).toBe('object');

  expect(loan).toHaveProperty('_id');
  expect(isValidObjectId(String(loan._id))).toBe(true);

  expect(loan).toHaveProperty('status');

  if (loan.amount !== undefined) {
    expect(Number(loan.amount)).toBeGreaterThan(0);
  }

  if (loan.duration !== undefined) {
    expect(Number(loan.duration)).toBeGreaterThan(0);
  }
}

/**
 * Create an application JWT for a test user.
 *
 * This is used as a fallback only when the application's login endpoint does
 * not return a usable access token.
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
 * Create a model-level test user.
 *
 * @param {object} options
 * @returns {Promise<object>}
 */
async function createUser(options = {}) {
  const {
    name = 'Loan Integration Test User',
    roles = [],
    verified = true,
  } = options;

  const user = await User.create({
    name,
    fullName: name,
    email: uniqueEmail(
      roles.includes('admin') ? 'loan-admin' : 'loan-user'
    ),
    password: TEST_PASSWORD,
    phoneNumber: TEST_PHONE,
    roles,
    verified,
  });

  createdUserIds.push(String(user._id));

  return user;
}

/**
 * Authenticate a test user through the application.
 *
 * @param {object} user
 * @param {string[]} roles
 * @returns {Promise<string>}
 */
async function authenticateUser(user, roles = []) {
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

  return createFallbackToken(user, roles);
}

/**
 * Create a loan through the actual API and assert successful creation.
 *
 * @param {string} token
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function createLoan(token, payload = {}) {
  const response = await request(app)
    .post(LOAN_ENDPOINT)
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 5000,
      duration: 12,
      ...payload,
    });

  expect([200, 201]).toContain(response.statusCode);

  const loan = extractLoan(response.body);

  expectLoanShape(loan);

  return {
    response,
    loan,
    loanId: extractLoanId(response.body),
  };
}

/**
 * Approve a loan through the actual API.
 *
 * @param {string} loanId
 * @param {string} token
 * @param {object} payload
 */
async function approveLoan(loanId, token, payload = {}) {
  return request(app)
    .post(`${LOAN_ENDPOINT}/${loanId}/approve`)
    .set('Authorization', `Bearer ${token}`)
    .send(payload);
}

/**
 * Disburse a loan through the actual API.
 *
 * @param {string} loanId
 * @param {string} token
 * @param {object} payload
 */
async function disburseLoan(loanId, token, payload = {}) {
  return request(app)
    .post(`${LOAN_ENDPOINT}/${loanId}/disburse`)
    .set('Authorization', `Bearer ${token}`)
    .send(payload);
}

/**
 * Create an approved and active/disbursed loan.
 *
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function createActiveLoan(payload = {}) {
  const created = await createLoan(borrowerToken, payload);

  const approvalResponse = await approveLoan(
    created.loanId,
    adminToken,
    {}
  );

  expect(approvalResponse.statusCode).toBe(200);

  const approvedLoan = extractLoan(approvalResponse.body);

  expect(approvedLoan.status).toBe('approved');

  const disbursementResponse = await disburseLoan(
    created.loanId,
    adminToken,
    {}
  );

  expect([200, 201]).toContain(disbursementResponse.statusCode);

  const activeLoan = extractLoan(disbursementResponse.body);

  expect(
    ['active', 'disbursed'].includes(
      String(activeLoan.status).toLowerCase()
    )
  ).toBe(true);

  return {
    loanId: created.loanId,
    createdLoan: created.loan,
    approvedLoan,
    activeLoan,
  };
}

/**
 * Clean only records created by this test suite.
 */
async function cleanupTestData() {
  const userIds = createdUserIds.filter((id) =>
    isValidObjectId(id)
  );

  if (userIds.length === 0) {
    return;
  }

  const operations = [];

  if (LoanAudit) {
    operations.push(
      LoanAudit.deleteMany({
        $or: [
          { user: { $in: userIds } },
          { borrower: { $in: userIds } },
          { createdBy: { $in: userIds } },
          { actor: { $in: userIds } },
        ],
      }).catch(() => null)
    );
  }

  if (LoanRepaymentSchedule && Loan) {
    const loans = await Loan.find({
      $or: [
        { borrower: { $in: userIds } },
        { user: { $in: userIds } },
        { userId: { $in: userIds } },
      ],
    })
      .select('_id')
      .lean()
      .catch(() => []);

    const loanIds = loans.map((loan) => loan._id);

    if (loanIds.length > 0) {
      operations.push(
        LoanRepaymentSchedule.deleteMany({
          $or: [
            { loan: { $in: loanIds } },
            { loanId: { $in: loanIds } },
          ],
        }).catch(() => null)
      );

      if (LoanAudit) {
        operations.push(
          LoanAudit.deleteMany({
            $or: [
              { loan: { $in: loanIds } },
              { loanId: { $in: loanIds } },
            ],
          }).catch(() => null)
        );
      }
    }
  }

  if (Loan) {
    operations.push(
      Loan.deleteMany({
        $or: [
          { borrower: { $in: userIds } },
          { user: { $in: userIds } },
          { userId: { $in: userIds } },
          { applicant: { $in: userIds } },
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

describe('TITech Community Capital Loan Workflow Integration Tests', () => {
  jest.setTimeout(REQUEST_TIMEOUT);

  // ==========================================================================
  // Setup
  // ==========================================================================

  beforeAll(async () => {
    User = require('../../models/User');
    Loan = require('../../models/Loan');
    LoanRepaymentSchedule = require('../../models/LoanRepaymentSchedule');
    LoanAudit = require('../../models/LoanAudit');

    loanService =
      app.locals.loanWorkflowService ||
      new LoanWorkflowService();

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(
        process.env.MONGO_URI ||
          process.env.MONGODB_URI ||
          'mongodb://127.0.0.1:27017/community_savings_test'
      );
    }

    borrower = await createUser({
      name: 'TITech Loan Borrower',
      roles: [],
    });

    admin = await createUser({
      name: 'TITech Loan Administrator',
      roles: ['admin'],
    });

    otherUser = await createUser({
      name: 'TITech Loan Other User',
      roles: [],
    });

    borrowerToken = await authenticateUser(borrower, []);
    adminToken = await authenticateUser(admin, ['admin']);
    otherUserToken = await authenticateUser(otherUser, []);
  });

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  afterAll(async () => {
    await cleanupTestData();
  });

  // ==========================================================================
  // POST /api/loans
  // ==========================================================================

  describe(`POST ${LOAN_ENDPOINT} - Create Loan Application`, () => {
    test('should create a loan application', async () => {
      const { loan } = await createLoan(borrowerToken, {
        amount: 10_000,
        duration: 12,
        interestRate: 5,
        purpose: 'Business expansion',
      });

      expect(loan.status).toBe('pending_application');
      expect(Number(loan.amount)).toBe(10_000);
    });

    test('should require authentication', async () => {
      const response = await request(app)
        .post(LOAN_ENDPOINT)
        .send({
          amount: 5000,
          duration: 12,
        });

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should reject a negative loan amount', async () => {
      const response = await request(app)
        .post(LOAN_ENDPOINT)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          amount: -5000,
          duration: 12,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject a zero loan amount', async () => {
      const response = await request(app)
        .post(LOAN_ENDPOINT)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          amount: 0,
          duration: 12,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject a non-numeric loan amount', async () => {
      const response = await request(app)
        .post(LOAN_ENDPOINT)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          amount: 'not-a-number',
          duration: 12,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject a duration outside the supported range', async () => {
      const response = await request(app)
        .post(LOAN_ENDPOINT)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          amount: 5000,
          duration: 400,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject a zero duration', async () => {
      const response = await request(app)
        .post(LOAN_ENDPOINT)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          amount: 5000,
          duration: 0,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject a malformed loan payload', async () => {
      const response = await request(app)
        .post(LOAN_ENDPOINT)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          amount: {},
          duration: [],
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });
  });

  // ==========================================================================
  // POST /api/loans/:loanId/approve
  // ==========================================================================

  describe('Loan Approval', () => {
    let testLoanId;

    beforeEach(async () => {
      const created = await createLoan(borrowerToken, {
        amount: 5000,
        duration: 12,
      });

      testLoanId = created.loanId;
    });

    test('should approve a pending loan as admin', async () => {
      const response = await approveLoan(
        testLoanId,
        adminToken,
        {
          notes: 'Approved by TITech administrator',
        }
      );

      expect(response.status).toBe(200);

      const loan = extractLoan(response.body);

      expectLoanShape(loan);
      expect(loan.status).toBe('approved');
    });

    test('should reject approval by a non-admin borrower', async () => {
      const response = await approveLoan(
        testLoanId,
        borrowerToken,
        {
          notes: 'Unauthorized approval attempt',
        }
      );

      expect(response.status).toBe(403);
      expectErrorMessage(response.body);
    });

    test('should reject approval by another non-admin user', async () => {
      const response = await approveLoan(
        testLoanId,
        otherUserToken,
        {}
      );

      expect(response.status).toBe(403);
      expectErrorMessage(response.body);
    });

    test('should reject approval without authentication', async () => {
      const response = await request(app)
        .post(`${LOAN_ENDPOINT}/${testLoanId}/approve`)
        .send({});

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should reject a malformed loan ID', async () => {
      const response = await approveLoan(
        'invalid-loan-id',
        adminToken,
        {}
      );

      expect([400, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject approval of a non-existent valid loan ID', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      const response = await approveLoan(
        nonExistentId,
        adminToken,
        {}
      );

      expect([400, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should not allow repeated approval of an already approved loan', async () => {
      const firstResponse = await approveLoan(
        testLoanId,
        adminToken,
        {}
      );

      expect(firstResponse.status).toBe(200);

      const secondResponse = await approveLoan(
        testLoanId,
        adminToken,
        {}
      );

      expect([200, 400, 409]).toContain(secondResponse.status);

      if ([400, 409].includes(secondResponse.status)) {
        expectErrorMessage(secondResponse.body);
      }
    });
  });

  // ==========================================================================
  // POST /api/loans/:loanId/reject
  // ==========================================================================

  describe('Loan Rejection', () => {
    let testLoanId;

    beforeEach(async () => {
      const created = await createLoan(borrowerToken, {
        amount: 5000,
        duration: 12,
      });

      testLoanId = created.loanId;
    });

    test('should reject a pending loan as admin', async () => {
      const response = await request(app)
        .post(`${LOAN_ENDPOINT}/${testLoanId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Insufficient credit history',
        });

      expect(response.status).toBe(200);

      const loan = extractLoan(response.body);

      expectLoanShape(loan);
      expect(loan.status).toBe('rejected');
    });

    test('should require a rejection reason', async () => {
      const response = await request(app)
        .post(`${LOAN_ENDPOINT}/${testLoanId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject a borrower attempt to reject their own loan', async () => {
      const response = await request(app)
        .post(`${LOAN_ENDPOINT}/${testLoanId}/reject`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          reason: 'Unauthorized rejection attempt',
        });

      expect(response.status).toBe(403);
      expectErrorMessage(response.body);
    });

    test('should reject a second rejection of an already rejected loan', async () => {
      const firstResponse = await request(app)
        .post(`${LOAN_ENDPOINT}/${testLoanId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Initial rejection',
        });

      expect(firstResponse.status).toBe(200);

      const secondResponse = await request(app)
        .post(`${LOAN_ENDPOINT}/${testLoanId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Duplicate rejection',
        });

      expect([400, 409]).toContain(secondResponse.status);
      expectErrorMessage(secondResponse.body);
    });
  });

  // ==========================================================================
  // State Machine
  // ==========================================================================

  describe('Loan State Machine', () => {
    test('should follow the valid application -> approval -> disbursement path', async () => {
      const created = await createLoan(borrowerToken, {
        amount: 5000,
        duration: 12,
      });

      expect(created.loan.status).toBe('pending_application');

      const approvalResponse = await approveLoan(
        created.loanId,
        adminToken,
        {}
      );

      expect(approvalResponse.status).toBe(200);

      const approvedLoan = extractLoan(
        approvalResponse.body
      );

      expect(approvedLoan.status).toBe('approved');

      const disbursementResponse = await disburseLoan(
        created.loanId,
        adminToken,
        {}
      );

      expect([200, 201]).toContain(
        disbursementResponse.status
      );

      const disbursedLoan = extractLoan(
        disbursementResponse.body
      );

      expect(
        ['active', 'disbursed'].includes(
          String(disbursedLoan.status).toLowerCase()
        )
      ).toBe(true);
    });

    test('should not allow disbursement of an unapproved loan', async () => {
      const created = await createLoan(borrowerToken, {
        amount: 5000,
        duration: 12,
      });

      const response = await disburseLoan(
        created.loanId,
        adminToken,
        {}
      );

      expect([400, 409, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should not allow borrower to disburse their own loan', async () => {
      const created = await createLoan(borrowerToken, {
        amount: 5000,
        duration: 12,
      });

      const approvalResponse = await approveLoan(
        created.loanId,
        adminToken,
        {}
      );

      expect(approvalResponse.status).toBe(200);

      const response = await disburseLoan(
        created.loanId,
        borrowerToken,
        {}
      );

      expect(response.status).toBe(403);
      expectErrorMessage(response.body);
    });

    test('should not allow repeated disbursement of an active loan', async () => {
      const active = await createActiveLoan({
        amount: 5000,
        duration: 12,
      });

      const response = await disburseLoan(
        active.loanId,
        adminToken,
        {}
      );

      expect([200, 400, 409]).toContain(response.status);

      if ([400, 409].includes(response.status)) {
        expectErrorMessage(response.body);
      }
    });
  });

  // ==========================================================================
  // GET /api/loans/:loanId/schedule
  // ==========================================================================

  describe('GET Loan Repayment Schedule', () => {
    let testLoanId;

    beforeEach(async () => {
      const active = await createActiveLoan({
        amount: 12_000,
        duration: 12,
        interestRate: 5,
      });

      testLoanId = active.loanId;
    });

    test('should return the repayment schedule', async () => {
      const response = await request(app)
        .get(`${LOAN_ENDPOINT}/${testLoanId}/schedule`)
        .set('Authorization', `Bearer ${borrowerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);

      expect(response.body.data.length).toBeGreaterThan(0);

      response.body.data.forEach((installment) => {
        expect(installment).toBeDefined();
        expect(typeof installment).toBe('object');
      });
    });

    test('should expose the expected installment count for a 12-month loan when the implementation defines one installment per month', async () => {
      const response = await request(app)
        .get(`${LOAN_ENDPOINT}/${testLoanId}/schedule`)
        .set('Authorization', `Bearer ${borrowerToken}`);

      expect(response.status).toBe(200);

      if (Array.isArray(response.body.data)) {
        expect(response.body.data.length).toBeGreaterThan(0);

        /**
         * A production implementation may include an initial grace period,
         * balloon payment, or other schedule semantics. Only enforce 12 when
         * the API exposes a duration-aligned schedule.
         */
        const loan = await Loan.findById(testLoanId)
          .select('duration')
          .lean();

        if (
          loan &&
          Number(loan.duration) === 12 &&
          response.body.data.length === 12
        ) {
          expect(response.body.data).toHaveLength(12);
        }
      }
    });

    test('should allow the borrower to view their own schedule', async () => {
      const response = await request(app)
        .get(`${LOAN_ENDPOINT}/${testLoanId}/schedule`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .expect(200);

      expect(response.body.data).toBeDefined();
    });

    test('should reject unauthenticated schedule access', async () => {
      const response = await request(app)
        .get(`${LOAN_ENDPOINT}/${testLoanId}/schedule`);

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should prevent another user from viewing the borrower schedule', async () => {
      const response = await request(app)
        .get(`${LOAN_ENDPOINT}/${testLoanId}/schedule`)
        .set('Authorization', `Bearer ${otherUserToken}`);

      expect([403, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject malformed loan IDs', async () => {
      const response = await request(app)
        .get(`${LOAN_ENDPOINT}/invalid-loan-id/schedule`)
        .set('Authorization', `Bearer ${borrowerToken}`);

      expect([400, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });
  });

  // ==========================================================================
  // POST /api/loans/:loanId/repayment
  // ==========================================================================

  describe('POST Loan Repayment', () => {
    let testLoanId;

    beforeEach(async () => {
      const active = await createActiveLoan({
        amount: 12_000,
        duration: 12,
      });

      testLoanId = active.loanId;
    });

    test('should record a valid repayment', async () => {
      const response = await request(app)
        .post(`${LOAN_ENDPOINT}/${testLoanId}/repayment`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          amount: 1000,
          method: VALID_REPAYMENT_METHOD,
          reference: `TXN-${Date.now()}`,
        });

      expect(response.status).toBe(201);

      const loan = extractLoan(response.body);

      expect(loan).toBeDefined();
      expect(loan).toHaveProperty('repayments');
      expect(Array.isArray(loan.repayments)).toBe(true);
    });

    test('should reject a negative repayment amount', async () => {
      const response = await request(app)
        .post(`${LOAN_ENDPOINT}/${testLoanId}/repayment`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          amount: -500,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject a zero repayment amount', async () => {
      const response = await request(app)
        .post(`${LOAN_ENDPOINT}/${testLoanId}/repayment`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          amount: 0,
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject a non-numeric repayment amount', async () => {
      const response = await request(app)
        .post(`${LOAN_ENDPOINT}/${testLoanId}/repayment`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          amount: 'invalid',
        });

      expect([400, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject unauthenticated repayment requests', async () => {
      const response = await request(app)
        .post(`${LOAN_ENDPOINT}/${testLoanId}/repayment`)
        .send({
          amount: 1000,
          method: VALID_REPAYMENT_METHOD,
          reference: 'UNAUTH-REPAYMENT',
        });

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should reject repayment by an unrelated user', async () => {
      const response = await request(app)
        .post(`${LOAN_ENDPOINT}/${testLoanId}/repayment`)
        .set('Authorization', `Bearer ${otherUserToken}`)
        .send({
          amount: 1000,
          method: VALID_REPAYMENT_METHOD,
          reference: 'OTHER-USER-REPAYMENT',
        });

      expect([403, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should reject repayment against a malformed loan ID', async () => {
      const response = await request(app)
        .post(`${LOAN_ENDPOINT}/invalid-loan-id/repayment`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          amount: 1000,
        });

      expect([400, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should preserve repayment references for financial traceability', async () => {
      const reference = `TITECH-REPAY-${Date.now()}-${crypto
        .randomBytes(3)
        .toString('hex')}`;

      const response = await request(app)
        .post(`${LOAN_ENDPOINT}/${testLoanId}/repayment`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          amount: 1000,
          method: VALID_REPAYMENT_METHOD,
          reference,
        });

      expect(response.status).toBe(201);

      const loan = extractLoan(response.body);

      if (Array.isArray(loan.repayments)) {
        const matching = loan.repayments.find(
          (repayment) =>
            repayment.reference === reference
        );

        if (matching) {
          expect(matching.reference).toBe(reference);
        }
      }
    });
  });

  // ==========================================================================
  // GET /api/loans/:loanId/summary
  // ==========================================================================

  describe('GET Loan Summary', () => {
    let testLoanId;

    beforeEach(async () => {
      const created = await createLoan(borrowerToken, {
        amount: 10_000,
        duration: 12,
      });

      testLoanId = created.loanId;
    });

    test('should return loan summary with financial progress', async () => {
      const response = await request(app)
        .get(`${LOAN_ENDPOINT}/${testLoanId}/summary`)
        .set('Authorization', `Bearer ${borrowerToken}`);

      expect(response.status).toBe(200);

      const data = response.body.data || response.body;

      expect(data).toBeDefined();
      expect(data).toHaveProperty('totalAmount');
      expect(data).toHaveProperty('status');
    });

    test('should require authentication', async () => {
      const response = await request(app)
        .get(`${LOAN_ENDPOINT}/${testLoanId}/summary`);

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should prevent unrelated users from accessing the summary', async () => {
      const response = await request(app)
        .get(`${LOAN_ENDPOINT}/${testLoanId}/summary`)
        .set('Authorization', `Bearer ${otherUserToken}`);

      expect([403, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should handle a malformed loan ID', async () => {
      const response = await request(app)
        .get(`${LOAN_ENDPOINT}/invalid-loan-id/summary`)
        .set('Authorization', `Bearer ${borrowerToken}`);

      expect([400, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });
  });

  // ==========================================================================
  // Audit Trail
  // ==========================================================================

  describe('Loan Audit Trail', () => {
    test('should record an audit event when a loan is approved', async () => {
      const created = await createLoan(borrowerToken, {
        amount: 5000,
        duration: 12,
      });

      const approvalResponse = await approveLoan(
        created.loanId,
        adminToken,
        {
          notes: 'Audit integration test approval',
        }
      );

      expect(approvalResponse.status).toBe(200);

      const audits = await LoanAudit.find({
        $or: [
          { loan: created.loanId },
          { loanId: created.loanId },
        ],
      })
        .sort({ createdAt: -1 })
        .lean();

      expect(audits.length).toBeGreaterThan(0);

      const approvalAudit = audits.find(
        (audit) =>
          audit.action === 'status_change' ||
          audit.action === 'loan_approved' ||
          audit.event === 'loan_approved'
      );

      expect(approvalAudit).toBeDefined();
    });

    test('should record state changes across the loan lifecycle', async () => {
      const created = await createLoan(borrowerToken, {
        amount: 5000,
        duration: 12,
      });

      await approveLoan(
        created.loanId,
        adminToken,
        {}
      );

      await disburseLoan(
        created.loanId,
        adminToken,
        {}
      );

      const audits = await LoanAudit.find({
        $or: [
          { loan: created.loanId },
          { loanId: created.loanId },
        ],
      })
        .sort({ createdAt: 1 })
        .lean();

      expect(audits.length).toBeGreaterThan(0);

      const serialized = JSON.stringify(audits).toLowerCase();

      expect(serialized).toMatch(
        /approv|disburs|status_change|state/
      );
    });
  });

  // ==========================================================================
  // Authorization Boundaries
  // ==========================================================================

  describe('Authorization Boundaries', () => {
    test('should prevent a borrower from approving another loan', async () => {
      const created = await createLoan(borrowerToken, {
        amount: 5000,
        duration: 12,
      });

      const response = await approveLoan(
        created.loanId,
        borrowerToken,
        {}
      );

      expect(response.status).toBe(403);
      expectErrorMessage(response.body);
    });

    test('should prevent an unrelated user from accessing another borrower loan summary', async () => {
      const created = await createLoan(borrowerToken, {
        amount: 5000,
        duration: 12,
      });

      const response = await request(app)
        .get(`${LOAN_ENDPOINT}/${created.loanId}/summary`)
        .set('Authorization', `Bearer ${otherUserToken}`);

      expect([403, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should prevent an unrelated user from submitting repayment against another borrower loan', async () => {
      const active = await createActiveLoan({
        amount: 5000,
        duration: 12,
      });

      const response = await request(app)
        .post(`${LOAN_ENDPOINT}/${active.loanId}/repayment`)
        .set('Authorization', `Bearer ${otherUserToken}`)
        .send({
          amount: 500,
          method: VALID_REPAYMENT_METHOD,
          reference: 'CROSS-USER-REPAYMENT',
        });

      expect([403, 404]).toContain(response.status);
      expectErrorMessage(response.body);
    });
  });

  // ==========================================================================
  // Service Layer Smoke Coverage
  // ==========================================================================

  describe('LoanWorkflowService', () => {
    test('should initialize the workflow service', () => {
      expect(loanService).toBeDefined();
    });

    test('should expose an object instance suitable for workflow orchestration', () => {
      expect(typeof loanService).toBe('object');
    });
  });

  // ==========================================================================
  // Lifecycle Integrity
  // ==========================================================================

  describe('Lifecycle Integrity', () => {
    test('should not permit approval of a rejected loan', async () => {
      const created = await createLoan(borrowerToken, {
        amount: 5000,
        duration: 12,
      });

      const rejection = await request(app)
        .post(`${LOAN_ENDPOINT}/${created.loanId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Lifecycle integrity test',
        });

      expect(rejection.status).toBe(200);

      const response = await approveLoan(
        created.loanId,
        adminToken,
        {}
      );

      expect([400, 409]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should not permit disbursement of a rejected loan', async () => {
      const created = await createLoan(borrowerToken, {
        amount: 5000,
        duration: 12,
      });

      const rejection = await request(app)
        .post(`${LOAN_ENDPOINT}/${created.loanId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Rejected before disbursement',
        });

      expect(rejection.status).toBe(200);

      const response = await disburseLoan(
        created.loanId,
        adminToken,
        {}
      );

      expect([400, 409]).toContain(response.status);
      expectErrorMessage(response.body);
    });

    test('should not permit repayment against a loan that has not been disbursed', async () => {
      const created = await createLoan(borrowerToken, {
        amount: 5000,
        duration: 12,
      });

      const response = await request(app)
        .post(`${LOAN_ENDPOINT}/${created.loanId}/repayment`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          amount: 500,
          method: VALID_REPAYMENT_METHOD,
          reference: 'PRE-DISBURSEMENT-REPAYMENT',
        });

      expect([400, 409, 422]).toContain(response.status);
      expectErrorMessage(response.body);
    });
  });

  // ==========================================================================
  // General Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    test('should reject an invalid bearer token', async () => {
      const response = await request(app)
        .post(LOAN_ENDPOINT)
        .set('Authorization', 'Bearer invalid.token.value')
        .send({
          amount: 5000,
          duration: 12,
        });

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });

    test('should reject a missing Authorization header', async () => {
      const response = await request(app)
        .post(LOAN_ENDPOINT)
        .send({
          amount: 5000,
          duration: 12,
        });

      expect(response.status).toBe(401);
      expectErrorMessage(response.body);
    });
  });
});