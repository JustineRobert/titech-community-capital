// controllers/contributionController.js

const mongoose = require('mongoose');
const Contribution = require('../models/Contribution');
const Group = require('../models/Group');
const logger = require('../utils/logger');

/**
 * Safely checks if a user is a member of a group.
 * Handles ObjectId vs string id mismatches.
 * @param {import('mongoose').Document & { members: any[] }} group
 * @param {string} userId
 * @returns {boolean}
 */
function isMember(group, userId) {
  if (!group || !Array.isArray(group.members)) return false;
  return group.members.some((m) => m?.toString() === String(userId));
}

/**
 * Add a contribution to a group.
 *
 * Expects:
 *  - req.body: { groupId: string, amount: number, note?: string, date?: string(ISO8601) }
 *  - req.user.id: authenticated user id
 */
exports.addContribution = async (req, res) => {
  try {
    const { groupId, amount, note, date } = req.body;

    // Basic param sanity; detailed validation is done in the route validators
    if (!groupId || typeof amount !== 'number' || !(amount > 0)) {
      return res.status(400).json({ message: 'Invalid groupId or amount' });
    }

    // Ensure group exists
    const group = await Group.findById(groupId).select('_id name members').lean();
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Ensure membership
    if (!isMember(group, req.user?.id)) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }

    // Parse optional date (validated upstream as ISO8601 if provided)
    const createdAt = date ? new Date(date) : undefined;

    const contribution = new Contribution({
      user: req.user.id,
      group: groupId,
      amount,
      ...(note ? { note } : {}),
      ...(createdAt ? { createdAt } : {}),
    });

    await contribution.save();

    logger.info('Contribution created', {
      userId: req.user.id,
      groupId,
      amount,
      contributionId: contribution._id.toString(),
    });

    return res.status(201).json({
      message: 'Contribution added successfully',
      data: contribution, // Return as-is; consumers can decide projections
    });
  } catch (err) {
    logger.error('Error adding contribution', {
      userId: req.user?.id,
      body: { ...req.body, amount: undefined }, // avoid logging sensitive numbers verbatim
      error: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({
      message: 'Failed to add contribution',
      // Hide internal error details in production
      error: process.env.NODE_ENV === 'production' ? undefined : err?.message,
    });
  }
};

/**
 * Get all contributions for a group (paginated, optional date range).
 *
 * Query:
 *  - page?: number >= 1
 *  - limit?: number [1..200]
 *  - from?: ISO8601
 *  - to?: ISO8601
 */
exports.getGroupContributions = async (req, res) => {
  try {
    const { groupId } = req.params;
    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);

    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limitBase = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
    const limit = Math.min(Math.max(limitBase, 1), 200);
    const skip = (page - 1) * limit;

    // Ensure group exists and membership
    const group = await Group.findById(groupId).select('_id members').lean();
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }
    if (!isMember(group, req.user?.id)) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }

    // Optional date filters
    const filter = { group: groupId };
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if (from || to) {
      filter.createdAt = {};
      if (from && !Number.isNaN(from.getTime())) filter.createdAt.$gte = from;
      if (to && !Number.isNaN(to.getTime())) filter.createdAt.$lte = to;
      if (Object.keys(filter.createdAt).length === 0) delete filter.createdAt;
    }

    // Query with projection + lean for performance
    const [items, total] = await Promise.all([
      Contribution.find(filter)
        .select('user group amount note createdAt')
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Contribution.countDocuments(filter),
    ]);

    // Prevent caching of authenticated data
    res.set('Cache-Control', 'no-store');

    return res.json({
      message: 'Group contributions retrieved successfully',
      data: items,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error('Error fetching group contributions', {
      userId: req.user?.id,
      params: req.params,
      query: req.query,
      error: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({
      message: 'Failed to fetch contributions',
      error: process.env.NODE_ENV === 'production' ? undefined : err?.message,
    });
  }
};

/**
 * Get all contributions by the current user (paginated, optional date range).
 */
exports.getUserContributions = async (req, res) => {
  try {
    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);

    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limitBase = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
    const limit = Math.min(Math.max(limitBase, 1), 200);
    const skip = (page - 1) * limit;

    // Optional date filters
    const filter = { user: req.user.id };
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if (from || to) {
      filter.createdAt = {};
      if (from && !Number.isNaN(from.getTime())) filter.createdAt.$gte = from;
      if (to && !Number.isNaN(to.getTime())) filter.createdAt.$lte = to;
      if (Object.keys(filter.createdAt).length === 0) delete filter.createdAt;
    }

    const [items, total] = await Promise.all([
      Contribution.find(filter)
        .select('user group amount note createdAt')
        .populate('group', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Contribution.countDocuments(filter),
    ]);

    res.set('Cache-Control', 'no-store');

    return res.json({
      message: 'User contributions retrieved successfully',
      data: items,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error('Error fetching user contributions', {
      userId: req.user?.id,
      query: req.query,
      error: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({
      message: 'Failed to fetch contributions',
      error: process.env.NODE_ENV === 'production' ? undefined : err?.message,
    });
  }
};

/**
 * Get contribution statistics for a group (optional date range).
 * - totalAmount: total sum of contributions
 * - contributionCount: number of contributions
 * - avgContribution: average contribution amount
 * - firstContributionAt / lastContributionAt: temporal bounds
 */
exports.getGroupStats = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findById(groupId).select('_id members').lean();
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }
    if (!isMember(group, req.user?.id)) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }

    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const match = {
      group: new mongoose.Types.ObjectId(groupId),
    };
    if (from || to) {
      match.createdAt = {};
      if (from && !Number.isNaN(from.getTime())) match.createdAt.$gte = from;
      if (to && !Number.isNaN(to.getTime())) match.createdAt.$lte = to;
      if (Object.keys(match.createdAt).length === 0) delete match.createdAt;
    }

    const stats = await Contribution.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$group',
          totalAmount: { $sum: '$amount' },
          contributionCount: { $sum: 1 },
          avgContribution: { $avg: '$amount' },
          firstContributionAt: { $min: '$createdAt' },
          lastContributionAt: { $max: '$createdAt' },
        },
      },
    ]);

    return res.json({
      message: 'Group statistics retrieved successfully',
      data: stats[0] || {
        totalAmount: 0,
        contributionCount: 0,
        avgContribution: 0,
        firstContributionAt: null,
        lastContributionAt: null,
      },
    });
  } catch (err) {
    logger.error('Error fetching group stats', {
      userId: req.user?.id,
      params: req.params,
      query: req.query,
      error: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({
      message: 'Failed to fetch statistics',
      error: process.env.NODE_ENV === 'production' ? undefined : err?.message,
    });
  }
};
