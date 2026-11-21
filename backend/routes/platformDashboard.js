import express from 'express';
import authModule from '../middleware/auth.js';
import User from '../models/User.js';
import Group from '../models/Group.js';
import Loan from '../models/Loan.js';
import AuditLog from '../models/AuditLog.js';
import { buildAdminActivityItem } from '../utils/adminDashboardPresentation.js';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const router = express.Router({ strict: false, caseSensitive: false });
const { authenticate, requireRole } = authModule;
const platformAdmin = requireRole('platform_admin');

function escapeCsvValue(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

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
  const [totalUsers, activeUsers, totalGroups, activeGroups, activeLoans] = await Promise.all([
    countModel(User),
    countModel(User, { status: 'active' }),
    countModel(Group),
    countModel(Group, { status: 'active' }),
    countModel(Loan, { status: { $in: ['disbursed', 'active', 'restructured'] } }),
  ]);

  // Savings totals must come from the canonical ledger/account mapping, not
  // from denormalized group or member fields. Approval counts also remain
  // unavailable until a single governed queue contract is defined.
  const data = {
    totalUsers,
    activeUsers,
    totalGroups,
    activeGroups,
    activeLoans,
    pendingApprovals: null,
    totalSavings: null,
    generatedAt: new Date().toISOString(),
    dataAvailability: {
      pendingApprovals: {
        status: 'unavailable',
        reason: 'Approval work is distributed across governed domain workflows; no single authoritative platform-wide queue is configured.',
      },
      totalSavings: {
        status: 'unavailable',
        reason: 'A verified platform-wide ledger account aggregation is not configured for this dashboard.',
      },
    },
  };

  // `stats` is retained as a compatibility alias for older admin clients.
  return res.json({ success: true, data, stats: data });
}));

router.get('/activity', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;
  const filter = {};

  const [events, total] = await Promise.all([
    AuditLog.find(filter)
      .select('_id action userId tenantId entityType entityId createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  const actorIds = [...new Set(events.map((event) => event.userId).filter(Boolean).map(String))];
  const groupIds = [...new Set(events
    .filter((event) => ['group', 'groups'].includes(String(event.entityType || '').toLowerCase()) && event.entityId)
    .map((event) => String(event.entityId)))];

  const [actors, groups] = await Promise.all([
    actorIds.length
      ? User.find({ _id: { $in: actorIds } }).select('_id name').lean()
      : Promise.resolve([]),
    groupIds.length
      ? Group.find({ _id: { $in: groupIds } }).select('_id name').lean()
      : Promise.resolve([]),
  ]);

  const actorNames = new Map(actors.map((actor) => [String(actor._id), actor.name]));
  const groupNames = new Map(groups.map((group) => [String(group._id), group.name]));
  const items = events.map((event) => buildAdminActivityItem(
    event,
    event.userId ? actorNames.get(String(event.userId)) || 'Former or unavailable user' : 'System',
    ['group', 'groups'].includes(String(event.entityType || '').toLowerCase())
      ? groupNames.get(String(event.entityId)) || null
      : null,
  ));

  return res.json({
    success: true,
    data: { items, total, page, limit, pages: Math.ceil(total / limit) },
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

router.get('/export/:format', asyncHandler(async (req, res) => {
  const format = String(req.params.format || '').trim().toLowerCase();
  if (!['csv', 'excel', 'pdf'].includes(format)) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_REPORT_FORMAT',
      message: 'Supported report formats are csv, excel and pdf.',
    });
  }

  const [users, groups, activeUsers] = await Promise.all([
    countModel(User),
    countModel(Group),
    countModel(User, { $or: [{ status: 'active' }, { isActive: true }] }),
  ]);
  const reportTypeValue = String(req.query.reportType || 'portfolio').trim().toLowerCase();
  const supportedReportTypes = new Set(['portfolio', 'financial', 'members', 'transactions', 'loans', 'savings', 'compliance', 'audit']);
  const reportType = supportedReportTypes.has(reportTypeValue) ? reportTypeValue : 'portfolio';
  const rows = [
    ['Metric', 'Value'],
    ['Report type', reportType],
    ['Users', users],
    ['Groups', groups],
    ['Active users', activeUsers],
  ];
  const filename = `titech-${reportType}-report`;

  if (format === 'csv') {
    const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.status(200).send(`\uFEFF${csv}`);
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TITech Community Capital';
    const sheet = workbook.addWorksheet('Report');
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = 24;
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    return res.status(200).send(Buffer.from(await workbook.xlsx.writeBuffer()));
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  const document = new PDFDocument({ margin: 50 });
  document.pipe(res);
  document.fontSize(18).text('TITech Community Capital Report');
  document.moveDown();
  document.fontSize(12);
  rows.forEach((row) => document.text(`${row[0]}: ${row[1]}`));
  document.end();
  return undefined;
}));

export default router;
