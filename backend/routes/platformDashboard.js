import express from 'express';
import authModule from '../middleware/auth.js';
import User from '../models/User.js';
import Group from '../models/Group.js';
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
