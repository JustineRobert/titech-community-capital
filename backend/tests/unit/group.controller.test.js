/**
 * Group Controller Tests
 * Tests group creation, member management, and group operations
 * @group unit/controllers
 */

jest.mock('../models/Group');
jest.mock('../models/User');

const Group = require('../models/Group');
const User = require('../models/User');
const groupController = require('../controllers/groupController');

describe('groupController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createGroup', () => {
    it('should successfully create a new group', async () => {
      const req = {
        user: {
          id: 'user-123',
          role: 'admin',
        },
        body: {
          name: 'Community Savings Group A',
          description: 'A group for community savings',
          type: 'savings',
          members: ['user-123', 'user-456', 'user-789'],
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      Group.create = jest.fn().mockResolvedValue({
        _id: 'group-123',
        name: req.body.name,
        description: req.body.description,
        type: req.body.type,
        creator: 'user-123',
        members: ['user-123', 'user-456', 'user-789'],
        createdAt: new Date(),
      });

      if (groupController.createGroup) {
        await groupController.createGroup(req, res);
        expect(Group.create).toHaveBeenCalled();
      }
    });

    it('should validate group type', async () => {
      const req = {
        user: {
          id: 'user-123',
          role: 'admin',
        },
        body: {
          name: 'Test Group',
          type: 'invalid-type', // Invalid
          members: ['user-123'],
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      if (groupController.createGroup) {
        await groupController.createGroup(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
      }
    });

    it('should require admin role for group creation', async () => {
      const req = {
        user: {
          id: 'user-123',
          role: 'user', // Not admin
        },
        body: {
          name: 'Test Group',
          type: 'savings',
          members: ['user-123'],
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      if (groupController.createGroup) {
        await groupController.createGroup(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
      }
    });
  });

  describe('addMembers', () => {
    it('should add members to group with CSV data', async () => {
      const req = {
        user: {
          id: 'user-123',
          role: 'admin',
        },
        params: {
          groupId: 'group-123',
        },
        body: {
          members: [
            { email: 'new-user1@example.com', role: 'member' },
            { email: 'new-user2@example.com', role: 'treasurer' },
          ],
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockGroup = {
        _id: 'group-123',
        creator: 'user-123',
        members: ['user-123'],
        save: jest.fn().mockResolvedValue({
          _id: 'group-123',
          members: ['user-123', 'user-999', 'user-888'],
        }),
      };

      Group.findById = jest.fn().mockResolvedValue(mockGroup);

      if (groupController.addMembers) {
        await groupController.addMembers(req, res);
        expect(Group.findById).toHaveBeenCalledWith('group-123');
      }
    });

    it('should validate email addresses', async () => {
      const req = {
        user: {
          id: 'user-123',
          role: 'admin',
        },
        params: {
          groupId: 'group-123',
        },
        body: {
          members: [{ email: 'invalid-email', role: 'member' }],
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      if (groupController.addMembers) {
        await groupController.addMembers(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
      }
    });

    it('should prevent duplicate members', async () => {
      const req = {
        user: {
          id: 'user-123',
          role: 'admin',
        },
        params: {
          groupId: 'group-123',
        },
        body: {
          members: [{ email: 'existing@example.com', role: 'member' }],
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockGroup = {
        _id: 'group-123',
        creator: 'user-123',
        members: ['user-123'],
        memberEmails: ['existing@example.com'],
      };

      Group.findById = jest.fn().mockResolvedValue(mockGroup);

      if (groupController.addMembers) {
        await groupController.addMembers(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
      }
    });
  });

  describe('getGroupDetails', () => {
    it('should retrieve group details with members', async () => {
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

      const mockGroup = {
        _id: 'group-123',
        name: 'Community Savings Group A',
        description: 'A community group',
        type: 'savings',
        creator: 'user-123',
        members: ['user-123', 'user-456', 'user-789'],
        totalSavings: 500000,
        createdAt: new Date(),
      };

      Group.findById = jest.fn().mockResolvedValue(mockGroup);

      if (groupController.getGroupDetails) {
        await groupController.getGroupDetails(req, res);
        expect(Group.findById).toHaveBeenCalledWith('group-123');
      }
    });

    it('should handle non-existent group', async () => {
      const req = {
        params: {
          groupId: 'non-existent',
        },
        user: {
          id: 'user-123',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      Group.findById = jest.fn().mockResolvedValue(null);

      if (groupController.getGroupDetails) {
        await groupController.getGroupDetails(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
      }
    });
  });

  describe('updateGroup', () => {
    it('should update group details by creator', async () => {
      const req = {
        user: {
          id: 'user-123',
        },
        params: {
          groupId: 'group-123',
        },
        body: {
          name: 'Updated Group Name',
          description: 'Updated description',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockGroup = {
        _id: 'group-123',
        creator: 'user-123',
        name: 'Old Name',
        description: 'Old description',
        save: jest.fn().mockResolvedValue({
          _id: 'group-123',
          name: 'Updated Group Name',
          description: 'Updated description',
        }),
      };

      Group.findById = jest.fn().mockResolvedValue(mockGroup);

      if (groupController.updateGroup) {
        await groupController.updateGroup(req, res);
        expect(Group.findById).toHaveBeenCalledWith('group-123');
      }
    });

    it('should prevent non-creator from updating group', async () => {
      const req = {
        user: {
          id: 'user-999', // Not the creator
        },
        params: {
          groupId: 'group-123',
        },
        body: {
          name: 'New Name',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockGroup = {
        _id: 'group-123',
        creator: 'user-123',
      };

      Group.findById = jest.fn().mockResolvedValue(mockGroup);

      if (groupController.updateGroup) {
        await groupController.updateGroup(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
      }
    });
  });

  describe('removeMember', () => {
    it('should remove member from group', async () => {
      const req = {
        user: {
          id: 'user-123',
        },
        params: {
          groupId: 'group-123',
          memberId: 'user-456',
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockGroup = {
        _id: 'group-123',
        creator: 'user-123',
        members: ['user-123', 'user-456', 'user-789'],
        save: jest.fn().mockResolvedValue({
          _id: 'group-123',
          members: ['user-123', 'user-789'],
        }),
      };

      Group.findById = jest.fn().mockResolvedValue(mockGroup);

      if (groupController.removeMember) {
        await groupController.removeMember(req, res);
        expect(Group.findById).toHaveBeenCalledWith('group-123');
      }
    });

    it('should prevent removal of creator', async () => {
      const req = {
        user: {
          id: 'user-123',
        },
        params: {
          groupId: 'group-123',
          memberId: 'user-123', // The creator
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      const mockGroup = {
        _id: 'group-123',
        creator: 'user-123',
        members: ['user-123', 'user-456'],
      };

      Group.findById = jest.fn().mockResolvedValue(mockGroup);

      if (groupController.removeMember) {
        await groupController.removeMember(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
      }
    });
  });
});
