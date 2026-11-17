/**
 * Tenant-scoped savings read models. These endpoints expose existing Savings
 * account aggregates and Transaction records; they do not mutate balances or
 * create contributions/withdrawals.
 */
import express from 'express';
import mongoose from 'mongoose';
import Savings from '../models/Savings.js';
import Member from '../models/Member.js';
import Transaction, { TRANSACTION_TYPE } from '../models/Transaction.js';
import authModule from '../middleware/auth.js';

const router = express.Router();
const requirePermission = authModule.requirePermission;
const SAVINGS_PERMISSION = 'SAVINGS_VIEW';
const SAVINGS_TRANSACTION_TYPES = new Set(TRANSACTION_TYPE);

function getTenantObjectId(req) {
  // The canonical tenant middleware attaches the Tenant document as req.tenant
  // and its public/string tenant key as req.tenantId. Member and Savings
  // schemas reference Tenant._id (ObjectId), so prefer the trusted document ID.
  const candidates = [
    req.tenant?._id,
    req.tenantObjectId,
    req.tenantContext?._id,
    req.titechTenant?._id,
    req.tenantId,
  ];
  const value = candidates.find((candidate) => mongoose.isValidObjectId(candidate));
  if (!value) return null;
  return new mongoose.Types.ObjectId(String(value));
}

function savingsAccountDto(account) {
  const member = account.member && typeof account.member === 'object' ? account.member : null;
  const fullName = member
    ? [member.firstName, member.otherNames, member.lastName].filter(Boolean).join(' ').trim()
    : null;
  const snapshot = typeof account.getFinancialSnapshot === 'function'
    ? account.getFinancialSnapshot()
    : {};

  return {
    id: String(account._id),
    _id: String(account._id),
    savingsId: String(account._id),
    savingsNumber: account.savingsNumber,
    savingsName: account.savingsName,
    savingsType: account.savingsType,
    currency: account.currency,
    status: account.status,
    blocked: account.blocked === true,
    member: member ? {
      id: String(member._id),
      _id: String(member._id),
      memberNumber: member.memberNumber ?? null,
      firstName: member.firstName ?? null,
      otherNames: member.otherNames ?? null,
      lastName: member.lastName ?? null,
      fullName: fullName || null,
    } : (account.member ? { id: String(account.member) } : null),
    memberId: member?._id ? String(member._id) : (account.member ? String(account.member) : null),
    memberName: fullName || 'Member record not linked',
    balance: snapshot.balance ?? null,
    availableBalance: snapshot.availableBalance ?? null,
    blockedBalance: snapshot.blockedBalance ?? null,
    totalDeposits: snapshot.totalDeposits ?? null,
    totalWithdrawals: snapshot.totalWithdrawals ?? null,
    financialSnapshotSource: 'SAVINGS_ACCOUNT_AGGREGATE',
    ledgerAuthority: false,
    reconciliationStatus: account.reconciliationStatus ?? null,
    openedAt: account.openedAt ?? account.createdAt ?? null,
    createdAt: account.createdAt ?? null,
    updatedAt: account.updatedAt ?? null,
  };
}

function savingsTransactionDto(transaction) {
  const account = transaction.savingsId && typeof transaction.savingsId === 'object'
    ? transaction.savingsId
    : null;
  const member = account?.member && typeof account.member === 'object' ? account.member : null;
  const memberName = member
    ? [member.firstName, member.otherNames, member.lastName].filter(Boolean).join(' ').trim()
    : null;

  return {
    id: String(transaction._id),
    _id: String(transaction._id),
    transactionId: String(transaction._id),
    reference: transaction.transactionReference || transaction.providerReferenceId || String(transaction._id),
    transactionReference: transaction.transactionReference ?? null,
    type: String(transaction.transactionType || 'UNKNOWN').toLowerCase(),
    transactionType: transaction.transactionType,
    amount: transaction.amount,
    currency: transaction.currency,
    status: transaction.status,
    memberId: member?._id ? String(member._id) : null,
    memberName: memberName || 'Member record not linked',
    savingsId: account?._id ? String(account._id) : (transaction.savingsId ? String(transaction.savingsId) : null),
    savingsNumber: account?.savingsNumber ?? null,
    channel: transaction.provider || transaction.source || '—',
    createdAt: transaction.createdAt ?? null,
    updatedAt: transaction.updatedAt ?? null,
    balance: null,
    ledgerAuthority: false,
  };
}

function getMemberFilter(value, res, requestId) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    res.status(400).json({ success: false, error: { code: 'MEMBER_ID_INVALID', message: 'The member filter is not a valid record identifier.' }, requestId });
    return null;
  }
  return new mongoose.Types.ObjectId(String(value));
}

function getAccountFilter(value, res, requestId) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    res.status(400).json({ success: false, error: { code: 'SAVINGS_ACCOUNT_ID_INVALID', message: 'The savings account filter is not a valid record identifier.' }, requestId });
    return null;
  }
  return new mongoose.Types.ObjectId(String(value));
}

function escapeRegex(value) {
  return new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function buildAccountFilter(tenantId, memberId, status, search) {
  const filter = { tenantId };
  if (memberId) filter.member = memberId;
  if (status && status !== 'all') filter.status = status.toUpperCase();
  if (search) {
    const regex = escapeRegex(search);
    filter.$or = ['savingsNumber', 'savingsName', 'savingsType'].map((field) => ({ [field]: regex }));
  }
  return filter;
}

function findTenantAccounts(filter, page, limit) {
  return Savings.find(filter)
    .select('_id tenantId member savingsNumber savingsName savingsType currency status blocked balance availableBalance blockedBalance totalDeposits totalWithdrawals reconciliationStatus createdAt updatedAt openedAt')
    .populate({ path: 'member', select: 'memberNumber firstName otherNames lastName', match: { tenantId, deletedAt: null } })
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
}

router.get('/accounts', requirePermission(SAVINGS_PERMISSION), async (req, res) => {
  const tenantId = getTenantObjectId(req);
  if (!tenantId) return res.status(403).json({ success: false, error: { code: 'TENANT_CONTEXT_INVALID', message: 'A valid tenant context is required.' }, requestId: req.requestId });
  const memberId = getMemberFilter(req.query.memberId, res, req.requestId);
  if (memberId === null) return undefined;
  const requestedPage = Number.parseInt(req.query.page, 10) || 1;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, 100000)
    : 1;
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
  const status = String(req.query.status ?? '').trim().toLowerCase();
  if (status && status !== 'all' && !['active', 'dormant', 'blocked', 'closed', 'pending'].includes(status)) {
    return res.status(400).json({ success: false, error: { code: 'SAVINGS_STATUS_INVALID', message: 'The requested savings account status is not supported.' }, requestId: req.requestId });
  }
  const search = String(req.query.search ?? '').trim().slice(0, 100);
  const filter = buildAccountFilter(tenantId, memberId, status, search);
  try {
    const [accounts, total] = await Promise.all([
      findTenantAccounts(filter, page, limit),
      Savings.countDocuments(filter),
    ]);
    return res.status(200).json({ success: true, data: { accounts: accounts.map(savingsAccountDto), total, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }, requestId: req.requestId });
  } catch (error) {
    req.log?.error?.('Savings account directory read failed.', { code: error?.code || 'SAVINGS_ACCOUNT_READ_FAILED', requestId: req.requestId, correlationId: req.correlationId });
    return res.status(503).json({ success: false, error: { code: 'SAVINGS_ACCOUNT_DIRECTORY_UNAVAILABLE', message: 'Savings accounts are temporarily unavailable.' }, requestId: req.requestId });
  }
});

router.get('/accounts/:accountId', requirePermission(SAVINGS_PERMISSION), async (req, res) => {
  const tenantId = getTenantObjectId(req);
  const { accountId } = req.params;
  if (typeof accountId !== 'string' || !/^[a-f\d]{24}$/i.test(accountId)) return res.status(400).json({ success: false, error: { code: 'SAVINGS_ACCOUNT_ID_INVALID', message: 'The savings account identifier is not valid.' }, requestId: req.requestId });
  if (!tenantId) return res.status(403).json({ success: false, error: { code: 'TENANT_CONTEXT_INVALID', message: 'A valid tenant context is required.' }, requestId: req.requestId });
  try {
    const account = await Savings.findOne({ _id: new mongoose.Types.ObjectId(accountId), tenantId })
      .select('_id tenantId member savingsNumber savingsName savingsType currency status blocked balance availableBalance blockedBalance totalDeposits totalWithdrawals reconciliationStatus createdAt updatedAt openedAt')
      .populate({ path: 'member', select: 'memberNumber firstName otherNames lastName email phoneNumber memberStatus kycStatus', match: { tenantId, deletedAt: null } });
    if (!account) return res.status(404).json({ success: false, error: { code: 'SAVINGS_ACCOUNT_NOT_FOUND', message: 'The requested savings account was not found.' }, requestId: req.requestId });
    return res.status(200).json({ success: true, data: { account: savingsAccountDto(account) }, requestId: req.requestId });
  } catch (error) {
    req.log?.error?.('Savings account detail read failed.', { code: error?.code || 'SAVINGS_ACCOUNT_DETAIL_FAILED', requestId: req.requestId, correlationId: req.correlationId });
    return res.status(503).json({ success: false, error: { code: 'SAVINGS_ACCOUNT_UNAVAILABLE', message: 'The savings account service is temporarily unavailable.' }, requestId: req.requestId });
  }
});

router.get('/transactions/:transactionId', requirePermission(SAVINGS_PERMISSION), async (req, res) => {
  const tenantId = getTenantObjectId(req);
  const { transactionId } = req.params;
  if (typeof transactionId !== 'string' || !/^[a-f\d]{24}$/i.test(transactionId)) return res.status(400).json({ success: false, error: { code: 'TRANSACTION_ID_INVALID', message: 'The transaction identifier is not valid.' }, requestId: req.requestId });
  if (!tenantId) return res.status(403).json({ success: false, error: { code: 'TENANT_CONTEXT_INVALID', message: 'A valid tenant context is required.' }, requestId: req.requestId });
  try {
    const transaction = await Transaction.findOne({
      _id: new mongoose.Types.ObjectId(transactionId),
      tenantId,
      savingsId: { $exists: true, $ne: null },
    })
      .select('_id tenantId savingsId transactionReference providerReferenceId transactionType amount currency status provider source createdAt updatedAt')
      .lean();
    if (!transaction) return res.status(404).json({ success: false, error: { code: 'SAVINGS_TRANSACTION_NOT_FOUND', message: 'The requested savings transaction was not found.' }, requestId: req.requestId });

    // Verify the referenced account belongs to the same trusted tenant before
    // exposing any account/member relationship. This also fails closed for
    // legacy or corrupted cross-tenant references.
    const account = await Savings.findOne({ _id: transaction.savingsId, tenantId })
      .select('_id savingsNumber member')
      .populate({ path: 'member', select: 'memberNumber firstName otherNames lastName', match: { tenantId, deletedAt: null } })
      .lean();
    if (!account) return res.status(404).json({ success: false, error: { code: 'SAVINGS_TRANSACTION_NOT_FOUND', message: 'The requested savings transaction was not found.' }, requestId: req.requestId });

    return res.status(200).json({ success: true, data: { transaction: savingsTransactionDto({ ...transaction, savingsId: account }) }, requestId: req.requestId });
  } catch (error) {
    req.log?.error?.('Savings transaction detail read failed.', { code: error?.code || 'SAVINGS_TRANSACTION_DETAIL_FAILED', requestId: req.requestId, correlationId: req.correlationId });
    return res.status(503).json({ success: false, error: { code: 'SAVINGS_TRANSACTION_UNAVAILABLE', message: 'The savings transaction service is temporarily unavailable.' }, requestId: req.requestId });
  }
});

async function listSavingsTransactions(req, res) {
  const tenantId = getTenantObjectId(req);
  if (!tenantId) return res.status(403).json({ success: false, error: { code: 'TENANT_CONTEXT_INVALID', message: 'A valid tenant context is required.' }, requestId: req.requestId });
  const memberId = getMemberFilter(req.query.memberId, res, req.requestId);
  if (memberId === null) return undefined;
  const accountId = getAccountFilter(req.query.accountId, res, req.requestId);
  if (accountId === null) return undefined;
  const requestedPage = Number.parseInt(req.query.page, 10) || 1;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100000) : 1;
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
  const requestedType = String(req.query.type ?? '').trim().toUpperCase();
  if (requestedType && requestedType !== 'ALL' && !SAVINGS_TRANSACTION_TYPES.has(requestedType)) {
    return res.status(400).json({ success: false, error: { code: 'SAVINGS_TRANSACTION_TYPE_INVALID', message: 'The requested transaction type is not supported.' }, requestId: req.requestId });
  }
  const search = String(req.query.search ?? '').trim().slice(0, 100);

  try {
    const accountConstraints = {
      tenantId,
      ...(memberId ? { member: memberId } : {}),
      ...(accountId ? { _id: accountId } : {}),
    };
    const hasAccountScope = Boolean(memberId || accountId);
    let scopedAccountIds = null;

    if (hasAccountScope) {
      const scopedAccounts = await Savings.find(accountConstraints).select('_id').lean();
      scopedAccountIds = scopedAccounts.map((account) => account._id);
      if (scopedAccountIds.length === 0) {
        return res.status(200).json({ success: true, data: { transactions: [], pagination: { page, limit, total: 0, pages: 0 }, total: 0 }, requestId: req.requestId });
      }
    }

    const filter = {
      tenantId,
      savingsId: scopedAccountIds
        ? { $in: scopedAccountIds }
        : { $exists: true, $ne: null },
    };
    if (requestedType && requestedType !== 'ALL') filter.transactionType = requestedType;
    if (search) {
      const regex = escapeRegex(search);
      const [matchingMembers, matchingAccounts] = await Promise.all([
        Member.find({
          tenantId,
          deletedAt: null,
          ...(memberId ? { _id: memberId } : {}),
          $or: ['memberNumber', 'firstName', 'otherNames', 'lastName']
            .map((field) => ({ [field]: regex })),
        }).select('_id').lean(),
        Savings.find({
          ...accountConstraints,
          $or: [{ savingsNumber: regex }, { savingsName: regex }],
        }).select('_id').lean(),
      ]);
      const matchedMemberIds = matchingMembers.map((member) => member._id);
      const memberAccountMatches = matchedMemberIds.length
        ? await Savings.find({
            ...accountConstraints,
            ...(memberId ? { member: memberId } : { member: { $in: matchedMemberIds } }),
          }).select('_id').lean()
        : [];
      const matchedAccountIds = [
        ...matchingAccounts.map((account) => account._id),
        ...memberAccountMatches.map((account) => account._id),
      ];
      const searchConditions = ['transactionReference', 'providerReferenceId', 'provider', 'source', 'status']
        .map((field) => ({ [field]: regex }));
      if (matchedAccountIds.length) searchConditions.push({ savingsId: { $in: matchedAccountIds } });
      filter.$or = searchConditions;
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .select('_id tenantId savingsId transactionReference providerReferenceId transactionType amount currency status provider source createdAt updatedAt')
        .populate({ path: 'savingsId', select: 'savingsNumber member', populate: { path: 'member', select: 'memberNumber firstName otherNames lastName', match: { tenantId, deletedAt: null } } })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Transaction.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        transactions: transactions.map(savingsTransactionDto),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        total,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    req.log?.error?.('Savings transaction list read failed.', { code: error?.code || 'SAVINGS_TRANSACTION_LIST_FAILED', requestId: req.requestId, correlationId: req.correlationId });
    return res.status(503).json({ success: false, error: { code: 'SAVINGS_DATA_UNAVAILABLE', message: 'Savings activity is temporarily unavailable.' }, requestId: req.requestId });
  }
}

router.get('/', requirePermission(SAVINGS_PERMISSION), listSavingsTransactions);
router.get('/transactions', requirePermission(SAVINGS_PERMISSION), listSavingsTransactions);

export default router;
