import express from 'express';
import authModule from '../middleware/auth.js';
import User from '../models/User.js';
import Group from '../models/Group.js';

const router = express.Router({ strict: false, caseSensitive: false });
const { authenticate, requireRole } = authModule;
const platformAdmin = requireRole('platform_admin');

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function countModel(model, filter = {}) {
  if (!model || typeof model.countDocuments !== 'function') {
    throw new TypeError('Dashboard count source is unavailable');
  }
  return model.countDocuments(filter);
}

router.use(authenticate, platformAdmin);

router.get('/stats', asyncHandler(async (_req, res) => {
  const [users, groups, activeUsers] = await Promise.all([
    countModel(User),
    countModel(Group),
    countModel(User, { $or: [{ status: 'active' }, { isActive: true }] }),
  ]);

  return res.json({
    success: true,
    stats: {
      totalUsers: users,
      totalMembers: users,
      activeUsers,
      activeMembers: activeUsers,
      totalGroups: groups,
      totalTransactions: null,
      totalSavings: null,
      pendingApprovals: null,
      dataAvailability: {
        financialMetrics: 'unavailable',
        approvalMetrics: 'unavailable',
      },
    },
  });
}));

router.get(['/', '/members'], asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
  const skip = (page - 1) * limit;

  const filter = req.query.search
    ? { $or: [
        { name: { $regex: String(req.query.search), $options: 'i' } },
        { email: { $regex: String(req.query.search), $options: 'i' } },
      ] }
    : {};

  const [members, total] = await Promise.all([
    User.find(filter)
      .select('_id name email role status isActive isVerified createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    countModel(User, filter),
  ]);

  return res.json({ success: true, members, items: members, data: members, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.get(['/dashboard', '/reports/dashboard'], asyncHandler(async (_req, res) => {
  const [users, groups, activeUsers] = await Promise.all([
    countModel(User),
    countModel(Group),
    countModel(User, { $or: [{ status: 'active' }, { isActive: true }] }),
  ]);

  return res.json({
    success: true,
    report: {
      users,
      groups,
      activeUsers,
      transactions: null,
      summary: {
        users,
        groups,
        activeUsers,
        totalTransactions: null,
        totalSavings: null,
      },
    },
    data: {
      users,
      groups,
      activeUsers,
      transactions: null,
      summary: {
        users,
        groups,
        activeUsers,
        totalTransactions: null,
        totalSavings: null,
      },
    },
  });
}));

export default router;
