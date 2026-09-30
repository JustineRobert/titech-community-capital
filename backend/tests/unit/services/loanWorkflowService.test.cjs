/**
 * Loan Workflow Service Unit Tests
 */

const loanWorkflowService = require('../../../services/loanWorkflowService');
const Loan = require('../../../models/Loan');
const LoanRepaymentSchedule = require('../../../models/LoanRepaymentSchedule');
const LoanAudit = require('../../../models/LoanAudit');
const logger = require('../../../utils/logger');

jest.mock('../../../models/Loan');
jest.mock('../../../models/LoanRepaymentSchedule');
jest.mock('../../../models/LoanAudit');
jest.mock('../../../utils/logger');

describe('Loan Workflow Service', () => {
  const mockLoan = {
    _id: 'loan_123',
    borrower: 'borrower_123',
    group: 'group_123',
    amount: 10000,
    term: 12,
    interestRate: 0.15,
    status: 'pending_application',
    toObject: jest.fn().mockReturnValue({
      _id: 'loan_123',
      borrower: 'borrower_123',
      status: 'pending_application',
    }),
    save: jest.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createLoanApplication', () => {
    it('should create loan application', async () => {
      const service = new loanWorkflowService.constructor();

      Loan.create.mockResolvedValue(mockLoan);

      const result = await service.createLoanApplication({
        borrowerId: 'borrower_123',
        groupId: 'group_123',
        amount: 10000,
        term: 12,
        description: 'Loan for business',
        purpose: 'business',
      });

      expect(result._id).toBe('loan_123');
      expect(Loan.create).toHaveBeenCalled();
    });

    it('should throw error for invalid parameters', async () => {
      const service = new loanWorkflowService.constructor();

      await expect(
        service.createLoanApplication({
          borrowerId: 'borrower_123',
          amount: -1000,
        })
      ).rejects.toThrow('Invalid loan parameters');
    });
  });

  describe('changeLoanStatus', () => {
    it('should change loan status successfully', async () => {
      const service = new loanWorkflowService.constructor();

      Loan.findById.mockResolvedValue(mockLoan);
      LoanAudit.create.mockResolvedValue({ _id: 'audit_123' });

      const result = await service.changeLoanStatus(
        'loan_123',
        'approved',
        { id: 'admin_123', role: 'admin' },
        'Application approved'
      );

      expect(result.status).toBe('approved');
      expect(mockLoan.save).toHaveBeenCalled();
      expect(LoanAudit.create).toHaveBeenCalled();
    });

    it('should validate status transitions', async () => {
      const service = new loanWorkflowService.constructor();

      Loan.findById.mockResolvedValue(mockLoan);

      await expect(
        service.changeLoanStatus(
          'loan_123',
          'closed', // Invalid transition from pending_application
          { id: 'admin_123', role: 'admin' }
        )
      ).rejects.toThrow('Invalid transition');
    });

    it('should throw error for non-existent loan', async () => {
      const service = new loanWorkflowService.constructor();

      Loan.findById.mockResolvedValue(null);

      await expect(
        service.changeLoanStatus('fake_id', 'approved', { id: 'admin_123' })
      ).rejects.toThrow('Loan not found');
    });
  });

  describe('generateRepaymentSchedule', () => {
    it('should generate repayment schedule', async () => {
      const service = new loanWorkflowService.constructor();

      LoanRepaymentSchedule.create.mockResolvedValue({
        _id: 'schedule_123',
        loan: mockLoan._id,
        installments: [],
      });

      const result = await service.generateRepaymentSchedule(mockLoan);

      expect(result).toBeDefined();
      expect(LoanRepaymentSchedule.create).toHaveBeenCalled();
    });
  });
});
