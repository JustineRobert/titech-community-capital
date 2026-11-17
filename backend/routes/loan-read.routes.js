/** Tenant-scoped, read-only loan portfolio API. Financial mutations remain in
 * the canonical loan workflow and transaction/ledger services. */
import express from 'express';
import mongoose from 'mongoose';
import Loan, { LOAN_STATUS } from '../models/Loan.js';
import Member from '../models/Member.js';
import authModule from '../middleware/auth.js';

const router = express.Router();
const requirePermission = authModule.requirePermission;
const LOAN_PERMISSION = 'LOAN_VIEW';
const LOAN_STATUSES = new Set(LOAN_STATUS);

function getTenantId(req) {
  const value = req.tenant?.tenantId ?? req.tenantId ?? req.tenant?.slug;
  return value == null || String(value).trim() === '' ? null : String(value).trim();
}

function getMemberTenantObjectId(req) {
  const candidates = [req.tenant?._id, req.tenantObjectId, req.tenantContext?._id, req.titechTenant?._id];
  const value = candidates.find((candidate) => mongoose.isValidObjectId(candidate));
  return value ? new mongoose.Types.ObjectId(String(value)) : null;
}

function memberPopulateOptions(req) {
  const tenantObjectId = getMemberTenantObjectId(req);
  return {
    path: 'member',
    select: 'memberNumber firstName otherNames lastName',
    // If trusted Tenant._id is not available, suppress the relationship rather
    // than risk populating a Member from another tenant.
    match: tenantObjectId ? { tenantId: tenantObjectId, deletedAt: null } : { _id: null },
  };
}

function groupPopulateOptions(req) {
  const tenantObjectId = getMemberTenantObjectId(req);
  return {
    path: 'group',
    select: 'name groupName',
    // Group.tenantId is a Tenant ObjectId. Suppress the relationship if the
    // trusted tenant document is unavailable; do not reveal foreign group data.
    match: tenantObjectId ? { tenantId: tenantObjectId } : { _id: null },
  };
}

function loanDto(loan) {
  const member = loan.member && typeof loan.member === 'object' ? loan.member : null;
  const group = loan.group && typeof loan.group === 'object' ? loan.group : null;
  const memberName = member
    ? [member.firstName, member.otherNames, member.lastName].filter(Boolean).join(' ').trim()
    : null;

  return {
    id: String(loan._id),
    _id: String(loan._id),
    loanId: String(loan._id),
    loanNumber: String(loan.loanNumber || loan.loanReference || loan._id),
    member: member ? {
      id: String(member._id),
      _id: String(member._id),
      memberNumber: member.memberNumber ?? null,
      firstName: member.firstName ?? null,
      otherNames: member.otherNames ?? null,
      lastName: member.lastName ?? null,
      fullName: memberName || null,
    } : (loan.member ? { id: String(loan.member) } : null),
    memberId: member?._id ? String(member._id) : (loan.member ? String(loan.member) : null),
    memberName: memberName || 'Member record not linked',
    groupId: group?._id ? String(group._id) : (loan.group ? String(loan.group) : null),
    groupName: group?.name ?? group?.groupName ?? null,
    purpose: loan.purpose ?? null,
    description: loan.description ?? null,
    reason: loan.reason ?? null,
    amount: loan.amount,
    currency: 'UGX',
    interestRate: loan.interestRate ?? null,
    repaymentPeriodMonths: loan.repaymentPeriodMonths ?? null,
    status: loan.status,
    creditDecision: loan.creditDecision ?? null,
    outstandingBalance: loan.outstandingBalance ?? null,
    amountDue: loan.amountDue ?? null,
    amountRepaid: loan.amountRepaid ?? null,
    daysPastDue: loan.daysPastDue ?? null,
    installments: Array.isArray(loan.installments) ? loan.installments : [],
    disbursementMethod: loan.disbursementMethod ?? null,
    disbursementReference: loan.disbursementReference ?? null,
    disbursedAmount: loan.disbursedAmount ?? null,
    createdAt: loan.createdAt ?? null,
    updatedAt: loan.updatedAt ?? null,
  };
}

function parseMemberFilter(value, res, requestId) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    res.status(400).json({
      success: false,
      error: { code: 'MEMBER_ID_INVALID', message: 'The member filter is not a valid record identifier.' },
      requestId,
    });
    return null;
  }
  return new mongoose.Types.ObjectId(String(value));
}

router.get('/', requirePermission(LOAN_PERMISSION), async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    return res.status(403).json({ success: false, error: { code: 'TENANT_CONTEXT_INVALID', message: 'A valid tenant context is required.' }, requestId: req.requestId });
  }

  const memberId = parseMemberFilter(req.query.memberId, res, req.requestId);
  if (memberId === null) return undefined;

  const status = String(req.query.status ?? '').trim().toLowerCase();
  if (status && status !== 'all' && !LOAN_STATUSES.has(status)) {
    return res.status(400).json({ success: false, error: { code: 'LOAN_STATUS_INVALID', message: 'The requested loan status is not supported.' }, requestId: req.requestId });
  }

  const requestedPage = Number.parseInt(req.query.page, 10) || 1;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, 100000)
    : 1;
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
  const filter = { tenantId, deletedAt: null };
  if (memberId) filter.member = memberId;
  if (status && status !== 'all') filter.status = status;

  try {
    const search = String(req.query.search ?? '').trim().slice(0, 100);
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const searchConditions = [
        { purpose: regex },
        { description: regex },
        { reason: regex },
      ];
      if (/^[a-f\d]{24}$/i.test(search)) {
        searchConditions.push({ _id: new mongoose.Types.ObjectId(search) });
      }

      const memberTenantObjectId = getMemberTenantObjectId(req);
      if (memberTenantObjectId) {
        const matchingMembers = await Member.find({
          tenantId: memberTenantObjectId,
          deletedAt: null,
          $or: [
            { memberNumber: regex },
            { firstName: regex },
            { otherNames: regex },
            { lastName: regex },
          ],
        }).select('_id').lean();
        const matchingMemberIds = matchingMembers.map((member) => member._id);
        if (matchingMemberIds.length) searchConditions.push({ member: { $in: matchingMemberIds } });
      }

      filter.$and = [
        ...(filter.$and || []),
        { $or: searchConditions },
      ];
    }

    const [documents, total, aggregate] = await Promise.all([
      Loan.find(filter)
        .select('_id member group purpose description reason amount interestRate repaymentPeriodMonths status creditDecision outstandingBalance amountDue amountRepaid daysPastDue installments disbursementMethod disbursementReference disbursedAmount createdAt updatedAt')
        .populate(memberPopulateOptions(req))
        .populate(groupPopulateOptions(req))
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Loan.countDocuments(filter),
      Loan.aggregate([
        { $match: { tenantId, deletedAt: null, ...(memberId ? { member: memberId } : {}) } },
        { $group: {
          _id: null,
          total: { $sum: 1 },
          recordedPrincipal: { $sum: { $ifNull: ['$amount', 0] } },
          active: { $sum: { $cond: [{ $in: ['$status', ['active', 'disbursed']] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $in: ['$status', ['pending', 'credit_review', 'manual_review']] }, 1, 0] } },
          defaulted: { $sum: { $cond: [{ $in: ['$status', ['defaulted', 'written_off']] }, 1, 0] } },
        } },
      ]),
    ]);

    const summary = aggregate[0] || { total: 0, recordedPrincipal: 0, active: 0, pending: 0, defaulted: 0 };
    return res.status(200).json({
      success: true,
      data: {
        loans: documents.map(loanDto),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        summary: { total: summary.total, recordedPrincipal: summary.recordedPrincipal, active: summary.active, pending: summary.pending, defaulted: summary.defaulted },
      },
      requestId: req.requestId,
    });
  } catch (error) {
    req.log?.error?.('Loan portfolio read failed.', { code: error?.code || 'LOAN_PORTFOLIO_READ_FAILED', requestId: req.requestId, correlationId: req.correlationId });
    return res.status(503).json({ success: false, error: { code: 'LOAN_PORTFOLIO_UNAVAILABLE', message: 'The loan portfolio is temporarily unavailable.' }, requestId: req.requestId });
  }
});

router.get('/:loanId', requirePermission(LOAN_PERMISSION), async (req, res) => {
  const tenantId = getTenantId(req);
  const { loanId } = req.params;
  if (typeof loanId !== 'string' || !/^[a-f\d]{24}$/i.test(loanId)) {
    return res.status(400).json({ success: false, error: { code: 'LOAN_ID_INVALID', message: 'The loan identifier is not valid.' }, requestId: req.requestId });
  }
  if (!tenantId) {
    return res.status(403).json({ success: false, error: { code: 'TENANT_CONTEXT_INVALID', message: 'A valid tenant context is required.' }, requestId: req.requestId });
  }

  try {
    const loan = await Loan.findOne({ _id: new mongoose.Types.ObjectId(loanId), tenantId, deletedAt: null })
      .select('_id member group purpose description reason amount interestRate repaymentPeriodMonths status creditDecision creditDecisionReason outstandingBalance amountDue amountRepaid daysPastDue installments disbursementMethod disbursementReference disbursedAmount createdAt updatedAt')
      .populate(memberPopulateOptions(req))
      .populate(groupPopulateOptions(req))
      .lean();

    if (!loan) {
      return res.status(404).json({ success: false, error: { code: 'LOAN_NOT_FOUND', message: 'The requested loan record was not found.' }, requestId: req.requestId });
    }
    return res.status(200).json({ success: true, data: { loan: loanDto(loan) }, requestId: req.requestId });
  } catch (error) {
    req.log?.error?.('Loan detail read failed.', { code: error?.code || 'LOAN_DETAIL_READ_FAILED', requestId: req.requestId, correlationId: req.correlationId });
    return res.status(503).json({ success: false, error: { code: 'LOAN_DETAIL_UNAVAILABLE', message: 'The loan detail service is temporarily unavailable.' }, requestId: req.requestId });
  }
});

export default router;
