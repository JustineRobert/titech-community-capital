// controllers/groupController.js

const Group = require('../models/Group');
const User = require('../models/User');
const logger = require('../utils/logger');
const { notificationQueue } = require('../services/queue');


/**
 * Create a new group with enhanced features:
 * - Support group type and description
 * - Support member roles (member, treasurer, secretary)
 * - Audit logging for group creation
 * - Batch member invitation
 */
exports.createGroup = async (req, res) => {
  try {
    const {
      name,
      type = 'savings',
      description = '',
      members: memberData = [],
      createdBy = req.user?.id,
    } = req.body;

    // Validation
    if (!name || !createdBy) {
      return res.status(400).json({ message: 'Group name and creator are required' });
    }

    if (name.trim().length < 3 || name.trim().length > 100) {
      return res.status(400).json({ message: 'Group name must be 3-100 characters' });
    }

    // RBAC: Only admins can create groups
    if (req.user?.role !== 'admin') {
      logger.warn('Non-admin user attempted to create group', { userId: req.user?.id });
      return res.status(403).json({ message: 'Only administrators can create groups' });
    }

    // Validate group type
    const validTypes = ['savings', 'investment', 'community', 'welfare'];
    if (!validTypes.includes(type)) {
      return res
        .status(400)
        .json({ message: `Invalid group type. Valid types: ${validTypes.join(', ')}` });
    }

    // Process member data (can be array of objects with email and role, or just emails)
    const processedMembers = [];
    const invitationEmails = [];

    if (Array.isArray(memberData) && memberData.length > 0) {
      for (const member of memberData) {
        const email = typeof member === 'string' ? member : member.email;
        const role = typeof member === 'object' ? member.role || 'member' : 'member';

        // Validate role
        const validRoles = ['member', 'treasurer', 'secretary'];
        if (!validRoles.includes(role)) {
          return res.status(400).json({ message: `Invalid member role: ${role}` });
        }

        if (email && email.includes('@')) {
          invitationEmails.push({ email: email.toLowerCase().trim(), role });
          processedMembers.push({ email: email.toLowerCase().trim(), role });
        }
      }
    }

    // Deduplicate by email
    const uniqueEmails = [...new Map(processedMembers.map((m) => [m.email, m])).values()];

    // Create group
    const group = new Group({
      name: name.trim(),
      type,
      description: description.trim(),
      members: [createdBy], // Creator is automatically first member
      createdBy,
      metadata: {
        createdAt: new Date(),
        totalInvited: uniqueEmails.length,
      },
    });

    await group.save();

    // Audit logging
    logger.info('GROUP_CREATED', {
      groupId: group._id,
      groupName: name,
      type,
      createdBy,
      memberCount: 1,
      invitedCount: uniqueEmails.length,
    });

    // Queue batch invitations
    if (uniqueEmails.length > 0) {
      try {
        // Add batch invitation job
        notificationQueue.add({
          type: 'batch-group-invitation',
          groupId: group._id,
          members: uniqueEmails,
          invitedBy: createdBy,
          batchSize: 5,
        });
      } catch (qErr) {
        logger.warn('Failed to queue batch invitations', {
          groupId: group._id,
          error: qErr.message,
        });
      }
    }

    res.status(201).json({
      message: 'Group created successfully',
      groupId: group._id,
      data: {
        _id: group._id,
        name: group.name,
        type: group.type,
        description: group.description,
        members: group.members,
        createdBy: group.createdBy,
      },
      invitedCount: uniqueEmails.length,
    });
  } catch (err) {
    logger.error('GROUP_CREATION_ERROR', {
      userId: req.user?.id,
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({
      message: 'Failed to create group',
      error: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  }
};

/**
 * Send batch invitations to group members
 * Supports retry logic and detailed logging
 */
exports.sendBatchInvitations = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { members = [], batchIndex = 1 } = req.body;

    if (!groupId || !members || members.length === 0) {
      return res.status(400).json({ message: 'Group ID and members are required' });
    }

    // RBAC: Only admins or group members can send invitations
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (req.user?.role !== 'admin' && !group.members.includes(req.user?.id)) {
      logger.warn('Unauthorized invitation attempt', {
        userId: req.user?.id,
        groupId,
      });
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Send invitations with retry
    const results = {
      successCount: 0,
      failureCount: 0,
      failures: [],
    };

    for (const memberData of members) {
      const email = typeof memberData === 'string' ? memberData : memberData.email;
      const role = typeof memberData === 'object' ? memberData.role || 'member' : 'member';

      try {
        // Queue invitation
        await notificationQueue.add(
          {
            type: 'group-invitation',
            groupId: groupId,
            email: email.toLowerCase().trim(),
            role,
            invitedBy: req.user?.id,
            retries: 0,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          }
        );

        results.successCount++;

        // Audit log
        logger.debug('INVITATION_QUEUED', {
          groupId,
          email,
          role,
          batch: batchIndex,
        });
      } catch (invErr) {
        results.failureCount++;
        results.failures.push({
          email,
          error: invErr.message,
        });

        logger.warn('INVITATION_QUEUE_FAILED', {
          groupId,
          email,
          error: invErr.message,
        });
      }
    }

    // Audit logging
    logger.info('BATCH_INVITATIONS_PROCESSED', {
      groupId,
      batch: batchIndex,
      sent: members.length,
      success: results.successCount,
      failed: results.failureCount,
      userId: req.user?.id,
    });

    res.status(200).json({
      message: 'Invitations processed',
      successCount: results.successCount,
      failureCount: results.failureCount,
      failures: results.failures,
      batch: batchIndex,
    });
  } catch (err) {
    logger.error('BATCH_INVITATION_ERROR', {
      groupId: req.params.groupId,
      userId: req.user?.id,
      error: err.message,
    });
    res.status(500).json({
      message: 'Failed to send invitations',
      error: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  }
};

/**
 * Join an existing group by ID, if not already a member.
 */
exports.joinGroup = async (req, res) => {
  try {
    const { id: groupId } = req.params;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Prevent duplicate membership
    if (group.members.includes(req.user.id)) {
      return res.status(400).json({ message: 'You are already a member of this group' });
    }

    group.members.push(req.user.id);
    await group.save();

    logger.info(`User ${req.user.id} joined group ${groupId}`);

    // enqueue a notification job for group join
    try {
      notificationQueue.add({
        type: 'group-joined',
        groupId,
        userId: req.user.id,
      });
    } catch (qErr) {
      logger.warn('Failed to enqueue notification job', { error: qErr.message });
    }

    res.json({
      message: 'Successfully joined group',
      data: group,
    });
  } catch (err) {
    logger.error('Error joining group:', { userId: req.user.id, error: err.message });
    res.status(500).json({
      message: 'Failed to join group',
      error: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  }
};

/**
 * Retrieve all groups where the current user is a member.
 */
exports.getGroups = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const groups = await Group.find({ members: req.user.id })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Group.countDocuments({ members: req.user.id });

    res.json({
      message: 'Groups retrieved successfully',
      data: groups,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error('Error fetching groups:', { userId: req.user.id, error: err.message });
    res.status(500).json({
      message: 'Failed to fetch groups',
      error: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  }
};

/**
 * Get a specific group by ID with member details
 */
exports.getGroupById = async (req, res) => {
  try {
    const { id: groupId } = req.params;

    const group = await Group.findById(groupId)
      .populate('createdBy', 'name email')
      .populate('members', 'name email');

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check if user is a member
    if (!group.members.some((member) => member._id.equals(req.user.id))) {
      return res.status(403).json({ message: 'Not authorized to view this group' });
    }

    res.json({
      message: 'Group retrieved successfully',
      data: group,
    });
  } catch (err) {
    logger.error('Error fetching group:', { userId: req.user.id, error: err.message });
    res.status(500).json({
      message: 'Failed to fetch group',
      error: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  }
};

/**
 * Leave a group (remove user from members)
 */
exports.leaveGroup = async (req, res) => {
  try {
    const { id: groupId } = req.params;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Prevent group creator from leaving
    if (group.createdBy.equals(req.user.id)) {
      return res.status(403).json({ message: 'Group creator cannot leave the group' });
    }

    group.members = group.members.filter((memberId) => !memberId.equals(req.user.id));
    await group.save();

    logger.info(`User ${req.user.id} left group ${groupId}`);

    res.json({
      message: 'Successfully left the group',
      data: group,
    });
  } catch (err) {
    logger.error('Error leaving group:', { userId: req.user.id, error: err.message });
    res.status(500).json({
      message: 'Failed to leave group',
      error: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  }
};

/**
 * Seed multiple groups for local development.
 * Only allowed when not in production to avoid accidental data creation.
 * Body: { count?: number, names?: string[] }
 */
exports.seedGroups = async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ message: 'Seeding is disabled in production' });
    }

    const { count = 3, names = [] } = req.body;
    if (!req.user || !req.user.id) {
      return res.status(400).json({ message: 'Authenticated user required for seeding' });
    }

    const groupsToCreate = [];
    for (let i = 0; i < count; i++) {
      const base = names[i] || `Sample Group ${i + 1}`;
      // ensure unique name
      const name = `${base} - ${Date.now().toString().slice(-6)}-${i}`;

      groupsToCreate.push({
        name,
        members: [req.user.id],
        createdBy: req.user.id,
      });
    }

    const created = await Group.insertMany(groupsToCreate);

    logger.info(`Seeded ${created.length} groups for user ${req.user.id}`);

    res.status(201).json({ message: 'Seeded groups successfully', data: created });
  } catch (err) {
    logger.error('Error seeding groups:', { userId: req.user && req.user.id, error: err.message });
    res.status(500).json({
      message: 'Failed to seed groups',
      error: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  }
};
