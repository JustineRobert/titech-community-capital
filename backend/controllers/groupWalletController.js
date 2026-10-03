import { Types } from 'mongoose';
import LedgerEntry from '../models/LedgerEntry.js';
import { add, subtract } from '../services/financial/money.js';

function requireTenantId(req) {
  const tenantId = req.tenantId || req.tenant?.tenantId;
  if (!tenantId) {
    const error = new Error('Trusted tenant context is required.');
    error.code = 'TENANT_REQUIRED';
    error.statusCode = 400;
    throw error;
  }
  return String(tenantId).trim().toLowerCase();
}

function validateGroupId(id) {
  if (!Types.ObjectId.isValid(id)) {
    const error = new Error('Invalid group identifier.');
    error.code = 'INVALID_GROUP_ID';
    error.statusCode = 400;
    throw error;
  }
  return id;
}

function applyLine(balance, entry) {
  const amount = entry?.amount?.toString?.() ?? String(entry?.amount ?? '0');
  if (entry.entryType === 'CREDIT') return add(balance, amount);
  if (entry.entryType === 'DEBIT') return subtract(balance, amount);
  return balance;
}

export async function getBalance(req, res, next) {
  try {
    const tenantId = requireTenantId(req);
    const groupId = validateGroupId(req.params.id);
    const entries = await LedgerEntry.find({ tenantId, groupId }).sort({ createdAt: 1, lineNumber: 1, _id: 1 }).lean().exec();
    const balance = entries.reduce(applyLine, '0');
    return res.json({
      success: true,
      tenantId,
      groupId: String(groupId),
      currency: entries[0]?.currency || process.env.DEFAULT_CURRENCY || 'UGX',
      balance,
      source: 'authoritative-ledger',
      entryCount: entries.length,
    });
  } catch (error) {
    return next(error);
  }
}

export async function getLedger(req, res, next) {
  try {
    const tenantId = requireTenantId(req);
    const groupId = validateGroupId(req.params.id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const entries = await LedgerEntry.find({ tenantId, groupId })
      .sort({ createdAt: -1, lineNumber: -1, _id: -1 })
      .limit(limit)
      .lean()
      .exec();
    return res.json({
      success: true,
      tenantId,
      groupId: String(groupId),
      source: 'authoritative-ledger',
      count: entries.length,
      entries,
    });
  } catch (error) {
    return next(error);
  }
}

export default Object.freeze({ getBalance, getLedger });
