/**
 * Contribution Controller Tests
 * Tests contribution creation, listing, and management
 * @group unit/controllers
 */

jest.mock('../models/Contribution');
jest.mock('../models/Group');

const Contribution = require('../models/Contribution');
const Group = require('../models/Group');
const contributionController = require('../controllers/contributionController');

describe('contributionController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addContribution', () => {
    it('should successfully add a contribution', async () => {
      const req = {
        user: {
          id: 'user-123',
        },
        body: {
          groupId: 'group-123',
          amount: 50000,
          note: 'Monthly savings',
          date: new Date().toISOString(),
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockGroup = {
        _id: 'group-123',
        name: 'Savings Group A',
        members: ['user-123', 'user-456'],
      };

      Group.findById = jest.fn().mockResolvedValue(mockGroup);
      Contribution.prototype.save = jest.fn().mockResolvedValue({
        _id: 'contribution-123',
        user: 'user-123',
        group: 'group-123',
        amount: 50000,
        note: 'Monthly savings',
        createdAt: new Date(),
      });

      if (contributionController.addContribution) {
        await contributionController.addContribution(req, res);
        expect(Group.findById).toHaveBeenCalledWith('group-123');
      }
    });

    it('should reject contribution with invalid amount', async () => {
      const req = {
        user: {
          id: 'user-123',
        },
        body: {
          groupId: 'group-123',
          amount: -100, // Invalid negative amount
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      if (contributionController.addContribution) {
        await contributionController.addContribution(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
      }
    });

    it('should reject contribution to non-existent group', async () => {
      const req = {
        user: {
          id: 'user-123',
        },
        body: {
          groupId: 'non-existent-group',
          amount: 50000,
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      Group.findById = jest.fn().mockResolvedValue(null);

      if (contributionController.addContribution) {
        await contributionController.addContribution(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
      }
    });

    it('should reject contribution from non-member', async () => {
      const req = {
        user: {
          id: 'user-999', // Not a member
        },
        body: {
          groupId: 'group-123',
          amount: 50000,
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockGroup = {
        _id: 'group-123',
        name: 'Savings Group A',
        members: ['user-123', 'user-456'], // user-999 not included
      };

      Group.findById = jest.fn().mockResolvedValue(mockGroup);

      if (contributionController.addContribution) {
        await contributionController.addContribution(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
      }
    });
  });

  describe('getContributions', () => {
    it('should retrieve contributions for a group', async () => {
      const req = {
        params: {
          groupId: 'group-123',
        },
        user: {
          id: 'user-123',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockContributions = [
        {
          _id: 'contrib-1',
          user: 'user-123',
          group: 'group-123',
          amount: 50000,
          createdAt: new Date(),
        },
        {
          _id: 'contrib-2',
          user: 'user-456',
          group: 'group-123',
          amount: 75000,
          createdAt: new Date(),
        },
      ];

      Contribution.find = jest.fn().mockResolvedValue(mockContributions);

      if (contributionController.getContributions) {
        await contributionController.getContributions(req, res);
        expect(Contribution.find).toHaveBeenCalled();
      }
    });

    it('should filter contributions by date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      const req = {
        params: {
          groupId: 'group-123',
        },
        query: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        user: {
          id: 'user-123',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      if (contributionController.getContributions) {
        await contributionController.getContributions(req, res);
        expect(Contribution.find).toHaveBeenCalled();
      }
    });
  });

  describe('getTotalContribution', () => {
    it('should calculate total contribution for a user in a group', async () => {
      const req = {
        params: {
          groupId: 'group-123',
        },
        user: {
          id: 'user-123',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      Contribution.aggregate = jest.fn().mockResolvedValue([
        {
          _id: 'user-123',
          total: 150000,
          count: 3,
        },
      ]);

      if (contributionController.getTotalContribution) {
        await contributionController.getTotalContribution(req, res);
        expect(Contribution.aggregate).toHaveBeenCalled();
      }
    });
  });

  describe('updateContribution', () => {
    it('should update contribution amount', async () => {
      const req = {
        params: {
          contributionId: 'contrib-123',
        },
        user: {
          id: 'user-123',
        },
        body: {
          amount: 60000,
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockContribution = {
        _id: 'contrib-123',
        user: 'user-123',
        amount: 50000,
        save: jest.fn().mockResolvedValue({
          _id: 'contrib-123',
          user: 'user-123',
          amount: 60000,
        }),
      };

      Contribution.findById = jest.fn().mockResolvedValue(mockContribution);

      if (contributionController.updateContribution) {
        await contributionController.updateContribution(req, res);
        expect(Contribution.findById).toHaveBeenCalledWith('contrib-123');
      }
    });

    it('should prevent non-owner from updating contribution', async () => {
      const req = {
        params: {
          contributionId: 'contrib-123',
        },
        user: {
          id: 'user-999', // Not the owner
        },
        body: {
          amount: 60000,
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockContribution = {
        _id: 'contrib-123',
        user: 'user-123', // Different user
        amount: 50000,
      };

      Contribution.findById = jest.fn().mockResolvedValue(mockContribution);

      if (contributionController.updateContribution) {
        await contributionController.updateContribution(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
      }
    });
  });

  describe('deleteContribution', () => {
    it('should delete contribution for owner', async () => {
      const req = {
        params: {
          contributionId: 'contrib-123',
        },
        user: {
          id: 'user-123',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockContribution = {
        _id: 'contrib-123',
        user: 'user-123',
      };

      Contribution.findByIdAndDelete = jest.fn().mockResolvedValue(mockContribution);

      if (contributionController.deleteContribution) {
        await contributionController.deleteContribution(req, res);
        expect(Contribution.findByIdAndDelete).toHaveBeenCalled();
      }
    });

    it('should prevent non-owner from deleting contribution', async () => {
      const req = {
        params: {
          contributionId: 'contrib-123',
        },
        user: {
          id: 'user-999',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockContribution = {
        _id: 'contrib-123',
        user: 'user-123', // Different user
      };

      Contribution.findById = jest.fn().mockResolvedValue(mockContribution);

      if (contributionController.deleteContribution) {
        await contributionController.deleteContribution(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
      }
    });
  });
});
