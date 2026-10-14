'use strict';

/**
 * tests/unit/loan.controller.test.cjs
 *
 * TITech Community Capital — Loan Controller Tests
 *
 * Coverage:
 * - Loan creation and input validation
 * - Group membership and available balance checks
 * - Loan approval and rejection
 * - Borrower authorization for repayment
 * - Repayment amount and outstanding balance calculations
 * - Loan status retrieval
 * - Error handling and model interaction assertions
 *
 * IMPORTANT:
 * - These are isolated controller unit tests.
 * - Model dependencies are mocked explicitly to avoid connecting to a real DB.
 * - Controller methods are invoked directly; Express middleware and routing
 *   are not exercised by this suite.
 * - Keep the module paths aligned with the real repository structure.
 */

jest.mock('../../models/Loan.js', () => {
  const model = {
    create: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    countDocuments: jest.fn(),
  };

  return {
    ...model,
    default: model,
    __esModule: true,
  };
});

jest.mock('../../models/User.js', () => {
  const model = {
    create: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
  };

  return {
    ...model,
    default: model,
    __esModule: true,
  };
});

jest.mock('../../models/Group.js', () => {
  const model = {
    findById: jest.fn(),
    findOne: jest.fn(),
  };

  return {
    ...model,
    default: model,
    __esModule: true,
  };
});

const Loan = require('../../models/Loan.js');
const User = require('../../models/User.js');
const Group = require('../../models/Group.js');

// Keep this path consistent with the actual location of this test file.
const loanController = require('../controllers/loanController');

const TEST_USER_ID = 'user-123';
const TEST_ADMIN_ID = 'user-456';
const TEST_GROUP_ID = 'group-123';
const TEST_LOAN_ID = 'loan-123';

function createRequest({
  userId = TEST_USER_ID,
  role = 'Member',
  params = {},
  body = {},
  userOverrides = {},
} = {}) {
  return {
    user: {
      id: userId,
      _id: userId,
      role,
      ...userOverrides,
    },
    params,
    body,
  };
}

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

function lastJsonBody(res) {
  const calls = res.json.mock.calls;

  return calls.length > 0
    ? calls[calls.length - 1][0]
    : undefined;
}

function expectErrorStatus(res, expectedStatus) {
  expect(res.status).toHaveBeenCalledWith(expectedStatus);
  expect(res.json).toHaveBeenCalled();
}

function expectSuccessfulResponse(res) {
  expect(res.json).toHaveBeenCalled();

  const statusCalls = res.status.mock.calls;

  // A response without an explicit status defaults to HTTP 200 in Express.
  if (statusCalls.length > 0) {
    const status = statusCalls[statusCalls.length - 1][0];

    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
  }
}

function createMockLoan(overrides = {}) {
  const loan = {
    _id: TEST_LOAN_ID,
    borrower: TEST_USER_ID,
    group: TEST_GROUP_ID,
    amount: 500000,
    interestRate: 10,
    duration: 12,
    totalAmountWithInterest: 550000,
    repaidAmount: 0,
    remainingBalance: 550000,
    status: 'active',
    rejectionReason: undefined,
    save: jest.fn(),
    ...overrides,
  };

  // Return the same mutable document after save so tests can inspect the
  // controller's in-memory mutations.
  loan.save.mockImplementation(async () => loan);

  return loan;
}

function createMockGroup(overrides = {}) {
  return {
    _id: TEST_GROUP_ID,
    members: [TEST_USER_ID, TEST_ADMIN_ID],
    savingsBalance: 1000000,
    admins: [TEST_ADMIN_ID],
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('loanController', () => {
  // ==========================================================================
  // CREATE LOAN
  // ==========================================================================

  describe('createLoan', () => {
    test('creates a valid loan request for a group member', async () => {
      const req = createRequest({
        body: {
          groupId: TEST_GROUP_ID,
          amount: 500000,
          interestRate: 10,
          duration: 12,
          purpose: 'Business expansion',
        },
      });

      const res = createResponse();

      const group = createMockGroup();

      Group.findById.mockResolvedValue(group);

      Loan.create.mockResolvedValue({
        _id: TEST_LOAN_ID,
        borrower: TEST_USER_ID,
        group: TEST_GROUP_ID,
        amount: 500000,
        interestRate: 10,
        duration: 12,
        status: 'pending',
      });

      await loanController.createLoan(req, res);

      expect(Group.findById).toHaveBeenCalledWith(TEST_GROUP_ID);

      expect(Loan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          borrower: TEST_USER_ID,
          group: TEST_GROUP_ID,
          amount: 500000,
          interestRate: 10,
          duration: 12,
        })
      );

      expectSuccessfulResponse(res);
    });

    test('rejects a loan amount exceeding the available group balance', async () => {
      const req = createRequest({
        body: {
          groupId: TEST_GROUP_ID,
          amount: 5000000,
          interestRate: 10,
          duration: 12,
          purpose: 'Business expansion',
        },
      });

      const res = createResponse();

      Group.findById.mockResolvedValue(
        createMockGroup({
          savingsBalance: 100000,
        })
      );

      await loanController.createLoan(req, res);

      expectErrorStatus(res, 400);
      expect(Loan.create).not.toHaveBeenCalled();
    });

    test('rejects a borrower who is not a member of the group', async () => {
      const req = createRequest({
        userId: 'user-999',
        body: {
          groupId: TEST_GROUP_ID,
          amount: 500000,
          interestRate: 10,
          duration: 12,
        },
      });

      const res = createResponse();

      Group.findById.mockResolvedValue(
        createMockGroup({
          members: [TEST_USER_ID, TEST_ADMIN_ID],
        })
      );

      await loanController.createLoan(req, res);

      expectErrorStatus(res, 403);
      expect(Loan.create).not.toHaveBeenCalled();
    });

    test('rejects a negative interest rate', async () => {
      const req = createRequest({
        body: {
          groupId: TEST_GROUP_ID,
          amount: 500000,
          interestRate: -5,
          duration: 12,
        },
      });

      const res = createResponse();

      await loanController.createLoan(req, res);

      expectErrorStatus(res, 400);
      expect(Loan.create).not.toHaveBeenCalled();
    });

    test.each([
      ['zero amount', { amount: 0 }],
      ['negative amount', { amount: -100 }],
      ['missing amount', { amount: undefined }],
      ['zero duration', { duration: 0 }],
      ['negative duration', { duration: -12 }],
      ['missing group', { groupId: undefined }],
    ])('rejects invalid loan input: %s', async (_label, overrides) => {
      const req = createRequest({
        body: {
          groupId: TEST_GROUP_ID,
          amount: 500000,
          interestRate: 10,
          duration: 12,
          ...overrides,
        },
      });

      const res = createResponse();

      await loanController.createLoan(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(Loan.create).not.toHaveBeenCalled();
    });

    test('returns not found when the requested group does not exist', async () => {
      const req = createRequest({
        body: {
          groupId: TEST_GROUP_ID,
          amount: 100000,
          interestRate: 10,
          duration: 12,
        },
      });

      const res = createResponse();

      Group.findById.mockResolvedValue(null);

      await loanController.createLoan(req, res);

      expect(Group.findById).toHaveBeenCalledWith(TEST_GROUP_ID);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(Loan.create).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // APPROVE LOAN
  // ==========================================================================

  describe('approveLoan', () => {
    test('approves a pending loan when the authorized group administrator requests it', async () => {
      const req = createRequest({
        userId: TEST_ADMIN_ID,
        role: 'GroupAdmin',
        params: {
          loanId: TEST_LOAN_ID,
        },
        body: {
          approvedAmount: 500000,
        },
      });

      const res = createResponse();

      const loan = createMockLoan({
        status: 'pending',
        amount: 500000,
        borrower: TEST_USER_ID,
        group: TEST_GROUP_ID,
      });

      Loan.findById.mockResolvedValue(loan);

      await loanController.approveLoan(req, res);

      expect(Loan.findById).toHaveBeenCalledWith(TEST_LOAN_ID);
      expect(loan.save).toHaveBeenCalled();

      expect(loan.status.toLowerCase()).toBe('approved');

      expectSuccessfulResponse(res);
    });

    test('rejects approval attempts from a non-administrator', async () => {
      const req = createRequest({
        userId: TEST_USER_ID,
        role: 'Member',
        params: {
          loanId: TEST_LOAN_ID,
        },
        body: {
          approvedAmount: 500000,
        },
      });

      const res = createResponse();

      const loan = createMockLoan({
        status: 'pending',
        group: TEST_GROUP_ID,
      });

      Loan.findById.mockResolvedValue(loan);

      await loanController.approveLoan(req, res);

      expect(Loan.findById).toHaveBeenCalledWith(TEST_LOAN_ID);
      expectErrorStatus(res, 403);
      expect(loan.save).not.toHaveBeenCalled();
      expect(loan.status).toBe('pending');
    });

    test('rejects approval when the loan does not exist', async () => {
      const req = createRequest({
        userId: TEST_ADMIN_ID,
        role: 'GroupAdmin',
        params: {
          loanId: TEST_LOAN_ID,
        },
        body: {
          approvedAmount: 500000,
        },
      });

      const res = createResponse();

      Loan.findById.mockResolvedValue(null);

      await loanController.approveLoan(req, res);

      expectErrorStatus(res, 404);
    });
  });

  // ==========================================================================
  // REJECT LOAN
  // ==========================================================================

  describe('rejectLoan', () => {
    test('rejects a pending loan and records the rejection reason', async () => {
      const reason = 'Insufficient credit history';

      const req = createRequest({
        userId: TEST_ADMIN_ID,
        role: 'GroupAdmin',
        params: {
          loanId: TEST_LOAN_ID,
        },
        body: {
          reason,
        },
      });

      const res = createResponse();

      const loan = createMockLoan({
        status: 'pending',
      });

      Loan.findById.mockResolvedValue(loan);

      await loanController.rejectLoan(req, res);

      expect(Loan.findById).toHaveBeenCalledWith(TEST_LOAN_ID);
      expect(loan.save).toHaveBeenCalled();

      expect(loan.status.toLowerCase()).toBe('rejected');
      expect(loan.rejectionReason).toBe(reason);

      expectSuccessfulResponse(res);
    });

    test('rejects rejection requests for a loan that does not exist', async () => {
      const req = createRequest({
        userId: TEST_ADMIN_ID,
        role: 'GroupAdmin',
        params: {
          loanId: TEST_LOAN_ID,
        },
        body: {
          reason: 'Insufficient credit history',
        },
      });

      const res = createResponse();

      Loan.findById.mockResolvedValue(null);

      await loanController.rejectLoan(req, res);

      expectErrorStatus(res, 404);
    });
  });

  // ==========================================================================
  // RECORD REPAYMENT
  // ==========================================================================

  describe('recordRepayment', () => {
    test('records a valid repayment for the actual borrower', async () => {
      const req = createRequest({
        userId: TEST_USER_ID,
        params: {
          loanId: TEST_LOAN_ID,
        },
        body: {
          amount: 50000,
          repaymentDate: new Date().toISOString(),
        },
      });

      const res = createResponse();

      const loan = createMockLoan({
        borrower: TEST_USER_ID,
        status: 'active',
        totalAmountWithInterest: 550000,
        repaidAmount: 0,
        remainingBalance: 550000,
      });

      Loan.findById.mockResolvedValue(loan);

      await loanController.recordRepayment(req, res);

      expect(Loan.findById).toHaveBeenCalledWith(TEST_LOAN_ID);
      expect(loan.save).toHaveBeenCalled();

      expectSuccessfulResponse(res);
    });

    test('prevents repayment by a user who is not the borrower', async () => {
      const req = createRequest({
        userId: 'user-999',
        params: {
          loanId: TEST_LOAN_ID,
        },
        body: {
          amount: 50000,
        },
      });

      const res = createResponse();

      const loan = createMockLoan({
        borrower: TEST_USER_ID,
        status: 'active',
      });

      Loan.findById.mockResolvedValue(loan);

      await loanController.recordRepayment(req, res);

      expect(Loan.findById).toHaveBeenCalledWith(TEST_LOAN_ID);
      expectErrorStatus(res, 403);
      expect(loan.save).not.toHaveBeenCalled();
    });

    test.each([
      ['zero repayment', 0],
      ['negative repayment', -500],
    ])('rejects a %s', async (_label, amount) => {
      const req = createRequest({
        userId: TEST_USER_ID,
        params: {
          loanId: TEST_LOAN_ID,
        },
        body: {
          amount,
        },
      });

      const res = createResponse();

      const loan = createMockLoan({
        borrower: TEST_USER_ID,
        status: 'active',
      });

      Loan.findById.mockResolvedValue(loan);

      await loanController.recordRepayment(req, res);

      expectErrorStatus(res, 400);
      expect(loan.save).not.toHaveBeenCalled();
    });

    test('calculates the remaining loan balance correctly', async () => {
      const req = createRequest({
        userId: TEST_USER_ID,
        params: {
          loanId: TEST_LOAN_ID,
        },
        body: {
          amount: 100000,
        },
      });

      const res = createResponse();

      const loan = createMockLoan({
        borrower: TEST_USER_ID,
        status: 'active',
        totalAmountWithInterest: 550000,
        repaidAmount: 150000,
        remainingBalance: 400000,
      });

      Loan.findById.mockResolvedValue(loan);

      await loanController.recordRepayment(req, res);

      expect(Loan.findById).toHaveBeenCalledWith(TEST_LOAN_ID);
      expect(loan.save).toHaveBeenCalled();

      // 550,000 total - (150,000 already repaid + 100,000 new repayment)
      // = 300,000 remaining.
      expect(loan.repaidAmount).toBe(250000);
      expect(loan.remainingBalance).toBe(300000);
    });

    test('rejects repayment exceeding the outstanding balance', async () => {
      const req = createRequest({
        userId: TEST_USER_ID,
        params: {
          loanId: TEST_LOAN_ID,
        },
        body: {
          amount: 600000,
        },
      });

      const res = createResponse();

      const loan = createMockLoan({
        borrower: TEST_USER_ID,
        status: 'active',
        totalAmountWithInterest: 550000,
        repaidAmount: 100000,
        remainingBalance: 450000,
      });

      Loan.findById.mockResolvedValue(loan);

      await loanController.recordRepayment(req, res);

      expectErrorStatus(res, 400);
      expect(loan.save).not.toHaveBeenCalled();
      expect(loan.repaidAmount).toBe(100000);
      expect(loan.remainingBalance).toBe(450000);
    });

    test('does not record a repayment against a non-active loan', async () => {
      const req = createRequest({
        userId: TEST_USER_ID,
        params: {
          loanId: TEST_LOAN_ID,
        },
        body: {
          amount: 50000,
        },
      });

      const res = createResponse();

      const loan = createMockLoan({
        borrower: TEST_USER_ID,
        status: 'rejected',
      });

      Loan.findById.mockResolvedValue(loan);

      await loanController.recordRepayment(req, res);

      expectErrorStatus(res, 400);
      expect(loan.save).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // GET LOAN STATUS
  // ==========================================================================

  describe('getLoanStatus', () => {
    test('retrieves loan status and outstanding balance', async () => {
      const req = createRequest({
        userId: TEST_USER_ID,
        params: {
          loanId: TEST_LOAN_ID,
        },
      });

      const res = createResponse();

      const loan = createMockLoan({
        borrower: TEST_USER_ID,
        status: 'active',
        amount: 500000,
        totalAmountWithInterest: 550000,
        repaidAmount: 100000,
        remainingBalance: 450000,
      });

      Loan.findById.mockResolvedValue(loan);

      await loanController.getLoanStatus(req, res);

      expect(Loan.findById).toHaveBeenCalledWith(TEST_LOAN_ID);
      expectSuccessfulResponse(res);

      const body = lastJsonBody(res);

      expect(body).toBeDefined();

      // Avoid assuming a response wrapper such as `loan`, `data`, or `result`.
      // Require the returned representation to include the expected status
      // and outstanding amount.
      const serializedBody = JSON.stringify(body);

      expect(serializedBody.toLowerCase()).toContain('active');
      expect(serializedBody).toContain('450000');
    });

    test('returns not found when the requested loan does not exist', async () => {
      const req = createRequest({
        userId: TEST_USER_ID,
        params: {
          loanId: TEST_LOAN_ID,
        },
      });

      const res = createResponse();

      Loan.findById.mockResolvedValue(null);

      await loanController.getLoanStatus(req, res);

      expect(Loan.findById).toHaveBeenCalledWith(TEST_LOAN_ID);
      expectErrorStatus(res, 404);
    });
  });
});