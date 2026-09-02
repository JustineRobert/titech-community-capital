// tests/unit/services/paymentService.test.js

const paymentService = require('../../../services/paymentService');
const Payment = require('../../../models/Payment');
const User = require('../../../models/User');
const Contribution = require('../../../models/Contribution');
const Group = require('../../../models/Group');

// Mock dependencies
jest.mock('../../../models/Payment');
jest.mock('../../../models/User');
jest.mock('../../../models/Contribution');
jest.mock('../../../models/Group');
jest.mock('../../../utils/logger');

describe('Payment Service', () => {
  let mockPayment;
  
  beforeEach(() => {
    mockPayment = {
      _id: 'payment123',
      status: 'pending',
      totalAmount: 1005,
      metadata: {},
      save: jest.fn().mockResolvedValue(),
    };

    jest.clearAllMocks();
  });

  describe('calculateFees', () => {
    test('should calculate mobile money fees correctly', () => {
      const amount = 1000;
      const fees = paymentService.calculateFees('mobile_money', amount);

      // M-Pesa: 0.5% fee
      expect(fees).toBe(5);
    });

    test('should calculate bank transfer fees correctly', () => {
      const amount = 5000;
      const fees = paymentService.calculateFees('bank_transfer', amount);

      // Bank transfer: 0.1% min 10
      expect(fees).toBe(10);
    });

    test('should calculate card fees correctly', () => {
      const amount = 2000;
      const fees = paymentService.calculateFees('card', amount);

      // Card: 2.5% min 50
      expect(fees).toBe(50);
    });

    test('should return 0 for cash payments', () => {
      const amount = 1000;
      const fees = paymentService.calculateFees('cash', amount);

      expect(fees).toBe(0);
    });
  });

  describe('validatePaymentAmount', () => {
    test('should validate valid amounts', () => {
      expect(() => {
        paymentService.validatePaymentAmount(1000, 'mobile_money');
      }).not.toThrow();
    });

    test('should reject invalid amounts', () => {
      expect(() => {
        paymentService.validatePaymentAmount(0, 'mobile_money');
      }).toThrow('Invalid payment amount');

      expect(() => {
        paymentService.validatePaymentAmount(-100, 'mobile_money');
      }).toThrow('Invalid payment amount');
    });

    test('should validate mobile money limits', () => {
      expect(() => {
        paymentService.validatePaymentAmount(500, 'mobile_money');
      }).not.toThrow();

      expect(() => {
        paymentService.validatePaymentAmount(200000, 'mobile_money');
      }).toThrow('Amount must be between 1 and 150000');
    });
  });

  describe('initiatePayment', () => {

    const mockUser = { _id: 'user123', totalContributions: 1000 };
    // const mockGroup = { _id: 'group123' };
    //const mockPayment = {
    //  _id: 'payment123',
    //  transactionRef: 'TXN-abc123',
    //  transactionRef: 'TXN-abc123',
    //  status: 'pending',
    //  save: jest.fn().mockResolvedValue(),
    //};

    beforeEach(() => {
      User.findById.mockResolvedValue(mockUser);
      Group.findByIdAndUpdate.mockResolvedValue();
      Payment.prototype.save.mockResolvedValue();
      Contribution.prototype.save.mockResolvedValue();
    });

    test('should initiate contribution payment successfully', async () => {
      const paymentData = {
        userId: 'user123',
        groupId: 'group123',
        amount: 1000,
        method: 'mobile_money',
        type: 'contribution',
        description: 'Monthly contribution',
      };

      const result = await paymentService.initiatePayment(paymentData);

      expect(result).toHaveProperty('paymentId');
      expect(result).toHaveProperty('transactionRef');
      expect(result.amount).toBe(1000);
      expect(result.status).toBe('pending');
    });

    test('should calculate fees and total amount correctly', async () => {
      const paymentData = {
        userId: 'user123',
        groupId: 'group123',
        amount: 1000,
        method: 'mobile_money',
        type: 'contribution',
      };

      await paymentService.initiatePayment(paymentData);

      expect(Payment).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1000,
          fees: 5, // 0.5% of 1000
          totalAmount: 1005,
        })
      );
    });

    test('should update user contribution stats for contribution payments', async () => {
      const paymentData = {
        userId: 'user123',
        groupId: 'group123',
        amount: 500,
        method: 'mobile_money',
        type: 'contribution',
      };

      await paymentService.initiatePayment(paymentData);

      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        'user123',
        { $inc: { totalContributions: 500, contributionCount: 1 } },
        expect.any(Object)
      );
    });

    test('should create contribution record for contribution payments', async () => {
      const paymentData = {
        userId: 'user123',
        groupId: 'group123',
        amount: 500,
        method: 'mobile_money',
        type: 'contribution',
      };

      await paymentService.initiatePayment(paymentData);

      expect(Contribution).toHaveBeenCalledWith(
        expect.objectContaining({
          user: 'user123',
          group: 'group123',
          amount: 500,
          type: 'regular',
          status: 'completed',
        })
      );
    });
  });

  describe('processMobileMoneyPayment', () => {

    const mockPayment = {
      _id: 'payment123',
      status: 'pending',
      totalAmount: 1005,
      metadata: {},
      save: jest.fn().mockResolvedValue(),
    };

    beforeEach(() => {
      Payment.findById.mockResolvedValue(mockPayment);
    });

    test('should process mobile money payment successfully', async () => {
      // Mock successful mobile money API response
      const mockApiResponse = {
        success: true,
        transactionId: 'MM-123456',
      };

      // Mock the simulateMobileMoneyAPI function
      paymentService.simulateMobileMoneyAPI = jest.fn().mockResolvedValue(mockApiResponse);

      const result = await paymentService.processMobileMoneyPayment({
        paymentId: 'payment123',
        phoneNumber: '+256772123546',
        provider: 'mpesa',
      });

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('MM-123456');
      expect(mockPayment.status).toBe('completed');
      expect(mockPayment.save).toHaveBeenCalled();
    });

    test('should handle mobile money payment failure', async () => {
      const mockApiResponse = {
        success: false,
        error: 'Insufficient balance',
      };

      paymentService.simulateMobileMoneyAPI = jest.fn().mockResolvedValue(mockApiResponse);

      const result = await paymentService.processMobileMoneyPayment({
        paymentId: 'payment123',
        phoneNumber: '+256772123546',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient balance');
      expect(mockPayment.status).toBe('failed');
    });

    test('should validate phone number format', async () => {
      await expect(
        paymentService.processMobileMoneyPayment({
          paymentId: 'payment123',
          phoneNumber: 'invalid',
        })
      ).rejects.toThrow();
    });
  });

  describe('verifyPayment', () => {
    const mockPayment = {
      _id: 'payment123',
      transactionRef: 'TXN-abc123',
      amount: 1000,
      status: 'completed',
      user: { _id: 'user123', name: 'John Doe' },
      group: { _id: 'group123', name: 'Test Group' },
    };

    test('should return payment details with populated user and group', async () => {
      Payment.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockPayment),
        }),
      });

      const result = await paymentService.verifyPayment('payment123');

      expect(result.paymentId).toBe('payment123');
      expect(result.amount).toBe(1000);
      expect(result.status).toBe('completed');
      expect(result.user.name).toBe('John Doe');
      expect(result.group.name).toBe('Test Group');
    });

    test('should throw error for non-existent payment', async () => {
      Payment.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(paymentService.verifyPayment('invalid')).rejects.toThrow('Payment not found');
    });
  });

  describe('processRefund', () => {
    const mockPayment = {
      _id: 'payment123',
      user: 'user123',
      group: 'group123',
      amount: 1000,
      currency: 'KES',
      status: 'completed',
      metadata: {},
      save: jest.fn().mockResolvedValue(),
    };

    // const mockRefundPayment = {
    //  _id: 'refund123',
    //  save: jest.fn().mockResolvedValue(),
    //};

    beforeEach(() => {
      Payment.findById.mockResolvedValue(mockPayment);
      Payment.prototype.save.mockResolvedValue();
    });

    test('should process refund successfully', async () => {
      const result = await paymentService.processRefund('payment123', 500, 'Customer request');

      expect(result.success).toBe(true);
      expect(result.refundId).toBeDefined();
      expect(mockPayment.metadata.refunded).toBe(true);
      expect(mockPayment.metadata.refundAmount).toBe(500);
    });

    test('should reject refund for non-completed payments', async () => {
      mockPayment.status = 'pending';

      await expect(paymentService.processRefund('payment123', 500, 'Test')).rejects.toThrow(
        'Can only refund completed payments'
      );
    });

    test('should prevent over-refund', async () => {
      // Refund amount should be capped at original payment amount
      const result = await paymentService.processRefund('payment123', 1500, 'Test');

      expect(result.success).toBe(true);
      // Should only refund up to the original amount
    });
  });

  describe('getPaymentAnalytics', () => {
    test('should return payment analytics grouped by method and type', async () => {
      const mockAnalytics = [
        {
          _id: 'mobile_money',
          types: [
            {
              type: 'contribution',
              status: 'completed',
              count: 10,
              amount: 10000,
              fees: 50,
            },
          ],
          totalCount: 10,
          totalAmount: 10000,
          totalFees: 50,
        },
      ];

      Payment.aggregate.mockResolvedValue(mockAnalytics);

      const result = await paymentService.getPaymentAnalytics(
        'user123',
        'group123',
        new Date('2024-01-01'),
        new Date('2024-01-31')
      );

      expect(result).toEqual(mockAnalytics);
      expect(Payment.aggregate).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ $match: expect.any(Object) })])
      );
    });
  });
});
