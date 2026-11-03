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
  try {
    if (!model || typeof model.countDocuments !== 'function') return 0;
    return await model.countDocuments(filter);
  } catch {
    return 0;
  }
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
      totalTransactions: 0,
      totalSavings: 0,
      pendingApprovals: 0,
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
      transactions: [],
      summary: { users, groups, activeUsers, totalTransactions: 0, totalSavings: 0 },
    },
    data: { users, groups, activeUsers, transactions: [], summary: { users, groups, activeUsers, totalTransactions: 0, totalSavings: 0 } },
  });
}));

export default router;
