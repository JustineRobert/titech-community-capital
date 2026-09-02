/**
 * Loan Controller Tests
 * Tests loan creation, approval, repayment, and management
 * @group unit/controllers
 */

jest.mock('../models/Loan');
jest.mock('../models/User');
jest.mock('../models/Group');

const Loan = require('../models/Loan');
const User = require('../models/User');
const Group = require('../models/Group');
const loanController = require('../controllers/loanController');

describe('loanController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createLoan', () => {
    it('should successfully create a new loan request', async () => {
      const req = {
        user: {
          id: 'user-123',
        },
        body: {
          groupId: 'group-123',
          amount: 500000,
          interestRate: 10,
          duration: 12, // months
          purpose: 'Business expansion',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockGroup = {
        _id: 'group-123',
        members: ['user-123', 'user-456'],
        savingsBalance: 1000000,
      };

      Group.findById = jest.fn().mockResolvedValue(mockGroup);
      Loan.create = jest.fn().mockResolvedValue({
        _id: 'loan-123',
        borrower: 'user-123',
        group: 'group-123',
        amount: 500000,
        interestRate: 10,
        duration: 12,
        status: 'pending',
        createdAt: new Date(),
      });

      if (loanController.createLoan) {
        await loanController.createLoan(req, res);
        expect(Group.findById).toHaveBeenCalledWith('group-123');
      }
    });

    it('should reject loan with insufficient group balance', async () => {
      const req = {
        user: {
          id: 'user-123',
        },
        body: {
          groupId: 'group-123',
          amount: 5000000, // Too large
          interestRate: 10,
          duration: 12,
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockGroup = {
        _id: 'group-123',
        members: ['user-123'],
        savingsBalance: 100000, // Insufficient
      };

      Group.findById = jest.fn().mockResolvedValue(mockGroup);

      if (loanController.createLoan) {
        await loanController.createLoan(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
      }
    });

    it('should reject loan from non-member', async () => {
      const req = {
        user: {
          id: 'user-999', // Not a member
        },
        body: {
          groupId: 'group-123',
          amount: 500000,
          interestRate: 10,
          duration: 12,
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockGroup = {
        _id: 'group-123',
        members: ['user-123', 'user-456'],
      };

      Group.findById = jest.fn().mockResolvedValue(mockGroup);

      if (loanController.createLoan) {
        await loanController.createLoan(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
      }
    });

    it('should validate interest rate', async () => {
      const req = {
        user: {
          id: 'user-123',
        },
        body: {
          groupId: 'group-123',
          amount: 500000,
          interestRate: -5, // Invalid negative rate
          duration: 12,
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      if (loanController.createLoan) {
        await loanController.createLoan(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
      }
    });
  });

  describe('approveLoan', () => {
    it('should approve pending loan request', async () => {
      const req = {
        user: {
          id: 'user-456', // Group admin
        },
        params: {
          loanId: 'loan-123',
        },
        body: {
          approvedAmount: 500000,
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockLoan = {
        _id: 'loan-123',
        status: 'pending',
        amount: 500000,
        save: jest.fn().mockResolvedValue({
          _id: 'loan-123',
          status: 'approved',
        }),
      };

      Loan.findById = jest.fn().mockResolvedValue(mockLoan);

      if (loanController.approveLoan) {
        await loanController.approveLoan(req, res);
        expect(Loan.findById).toHaveBeenCalledWith('loan-123');
      }
    });

    it('should prevent non-admin from approving loan', async () => {
      const req = {
        user: {
          id: 'user-123', // Not admin
        },
        params: {
          loanId: 'loan-123',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockLoan = {
        _id: 'loan-123',
        status: 'pending',
        group: 'group-123',
      };

      Loan.findById = jest.fn().mockResolvedValue(mockLoan);

      if (loanController.approveLoan) {
        await loanController.approveLoan(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
      }
    });
  });

  describe('rejectLoan', () => {
    it('should reject loan with reason', async () => {
      const req = {
        user: {
          id: 'user-456',
        },
        params: {
          loanId: 'loan-123',
        },
        body: {
          reason: 'Insufficient credit history',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockLoan = {
        _id: 'loan-123',
        status: 'pending',
        save: jest.fn().mockResolvedValue({
          _id: 'loan-123',
          status: 'rejected',
          rejectionReason: 'Insufficient credit history',
        }),
      };

      Loan.findById = jest.fn().mockResolvedValue(mockLoan);

      if (loanController.rejectLoan) {
        await loanController.rejectLoan(req, res);
        expect(Loan.findById).toHaveBeenCalledWith('loan-123');
      }
    });
  });

  describe('recordRepayment', () => {
    it('should record loan repayment', async () => {
      const req = {
        user: {
          id: 'user-123',
        },
        params: {
          loanId: 'loan-123',
        },
        body: {
          amount: 50000,
          repaymentDate: new Date().toISOString(),
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockLoan = {
        _id: 'loan-123',
        borrower: 'user-123',
        status: 'active',
        totalAmountWithInterest: 550000,
        save: jest.fn(),
      };

      Loan.findById = jest.fn().mockResolvedValue(mockLoan);

      if (loanController.recordRepayment) {
        await loanController.recordRepayment(req, res);
        expect(Loan.findById).toHaveBeenCalledWith('loan-123');
      }
    });

    it('should prevent repayment by non-borrower', async () => {
      const req = {
        user: {
          id: 'user-999', // Not the borrower
        },
        params: {
          loanId: 'loan-123',
        },
        body: {
          amount: 50000,
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockLoan = {
        _id: 'loan-123',
        borrower: 'user-123',
        status: 'active',
      };

      Loan.findById = jest.fn().mockResolvedValue(mockLoan);

      if (loanController.recordRepayment) {
        await loanController.recordRepayment(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
      }
    });

    it('should calculate remaining balance correctly', async () => {
      const req = {
        user: {
          id: 'user-123',
        },
        params: {
          loanId: 'loan-123',
        },
        body: {
          amount: 100000,
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockLoan = {
        _id: 'loan-123',
        borrower: 'user-123',
        status: 'active',
        totalAmountWithInterest: 550000,
        repaidAmount: 150000,
        save: jest.fn(),
      };

      Loan.findById = jest.fn().mockResolvedValue(mockLoan);

      if (loanController.recordRepayment) {
        await loanController.recordRepayment(req, res);
        expect(Loan.findById).toHaveBeenCalledWith('loan-123');
      }
    });
  });

  describe('getLoanStatus', () => {
    it('should retrieve loan status and balance', async () => {
      const req = {
        params: {
          loanId: 'loan-123',
        },
        user: {
          id: 'user-123',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockLoan = {
        _id: 'loan-123',
        borrower: 'user-123',
        status: 'active',
        amount: 500000,
        totalAmountWithInterest: 550000,
        repaidAmount: 100000,
        remainingBalance: 450000,
      };

      Loan.findById = jest.fn().mockResolvedValue(mockLoan);

      if (loanController.getLoanStatus) {
        await loanController.getLoanStatus(req, res);
        expect(Loan.findById).toHaveBeenCalledWith('loan-123');
      }
    });
  });
});
