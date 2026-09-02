const mongoose = require('mongoose');
const Loan = require('../../community-savings-app-backend/models/Loan');
const LoanRepaymentSchedule = require('../../community-savings-app-backend/models/LoanRepaymentSchedule');
const LoanAudit = require('../../community-savings-app-backend/models/LoanAudit');
const LoanWorkflowService = require('../../community-savings-app-backend/services/loanWorkflowService');
const User = require('../../community-savings-app-backend/models/User');
const Group = require('../../community-savings-app-backend/models/Group');

describe('Loan Workflow Integration Tests', () => {
  let user, admin, group, loan;

  beforeAll(async () => {
    // Setup test DB
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    admin = await User.create({
      name: 'Admin',
      email: 'admin@test.com',
      password: 'pw',
      role: 'admin',
    });
    user = await User.create({ name: 'User', email: 'user@test.com', password: 'pw' });
    group = await Group.create({
      name: 'Test Group',
      admin: admin._id,
      members: [user._id, admin._id],
    });
    loan = await Loan.create({
      user: user._id,
      group: group._id,
      amountRequested: 5000,
      status: 'requested',
    });
  });

  describe('Status Transitions', () => {
    test('Loan requested', async () => {
      expect(loan.status).toBe('requested');
    });

    test('Loan approved', async () => {
      const updated = await LoanWorkflowService.changeLoanStatus(
        loan._id,
        'approved',
        admin._id,
        'Approved by admin'
      );
      expect(updated.status).toBe('approved');
    });

    test('Audit trail recorded', async () => {
      await LoanWorkflowService.changeLoanStatus(loan._id, 'approved', admin._id, 'Test approval');
      const audit = await LoanAudit.findOne({ loan: loan._id });
      expect(audit).toBeDefined();
      expect(audit.action).toBe('status:approved');
    });

    test('Loan disbursed', async () => {
      await LoanWorkflowService.changeLoanStatus(loan._id, 'approved', admin._id);
      const updated = await LoanWorkflowService.changeLoanStatus(loan._id, 'disbursed', admin._id);
      expect(updated.status).toBe('disbursed');
    });

    test('Loan active after disbursement', async () => {
      await LoanWorkflowService.changeLoanStatus(loan._id, 'approved', admin._id);
      await LoanWorkflowService.changeLoanStatus(loan._id, 'disbursed', admin._id);
      const updated = await LoanWorkflowService.changeLoanStatus(loan._id, 'active', admin._id);
      expect(updated.status).toBe('active');
    });
  });

  describe('Repayment Schedule', () => {
    test('Schedule generated on disbursement', async () => {
      const schedule = await LoanWorkflowService.generateRepaymentSchedule(loan);
      expect(schedule).toBeDefined();
      expect(schedule.loan).toEqual(loan._id);
    });

    test('Schedule has installments', async () => {
      const schedule = await LoanWorkflowService.generateRepaymentSchedule(loan);
      // Placeholder: populate installments based on loan terms
      // In full implementation, uses amortization schedule
    });

    test('Outstanding balance tracked', async () => {
      const schedule = await LoanWorkflowService.generateRepaymentSchedule(loan);
      // Track balance as payments made
    });
  });

  describe('Overdue Detection', () => {
    test('Loan marked overdue', async () => {
      await LoanWorkflowService.changeLoanStatus(loan._id, 'active', admin._id);
      const updated = await LoanWorkflowService.changeLoanStatus(
        loan._id,
        'overdue',
        admin._id,
        'More than 7 days late'
      );
      expect(updated.status).toBe('overdue');
    });

    test('Penalty applied to overdue loan', async () => {
      await LoanWorkflowService.changeLoanStatus(loan._id, 'overdue', admin._id);
      // Placeholder: apply penalty in full implementation
    });

    test('Default after extended overdue', async () => {
      await LoanWorkflowService.changeLoanStatus(loan._id, 'overdue', admin._id);
      const updated = await LoanWorkflowService.changeLoanStatus(
        loan._id,
        'defaulted',
        admin._id,
        'Over 30 days late'
      );
      expect(updated.status).toBe('defaulted');
    });
  });

  describe('Loan Closure', () => {
    test('Loan closed when fully repaid', async () => {
      const updated = await LoanWorkflowService.changeLoanStatus(
        loan._id,
        'closed',
        admin._id,
        'Fully repaid'
      );
      expect(updated.status).toBe('closed');
    });
  });

  describe('Rejection', () => {
    test('Loan rejected before approval', async () => {
      const updated = await LoanWorkflowService.changeLoanStatus(
        loan._id,
        'rejected',
        admin._id,
        'Does not meet eligibility'
      );
      expect(updated.status).toBe('rejected');
    });

    test('Rejection reason logged', async () => {
      await LoanWorkflowService.changeLoanStatus(
        loan._id,
        'rejected',
        admin._id,
        'Insufficient eligibility score'
      );
      const audit = await LoanAudit.findOne({ loan: loan._id, action: 'status:rejected' });
      expect(audit.reason).toBe('Insufficient eligibility score');
    });
  });
});
