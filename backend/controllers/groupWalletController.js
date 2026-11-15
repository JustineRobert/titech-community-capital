import { Types } from 'mongoose';
import LedgerEntry from '../models/LedgerEntry.js';
import Group from '../models/Group.js';
import { canViewGroup, normalizeRole } from '../security/rbacPolicy.js';

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

async function requireGroupViewAccess(req, tenantId, groupId) {
  const group = await Group.findTenantGroup(tenantId, groupId);
  if (!group) {
    const error = new Error('Group not found.');
    error.code = 'GROUP_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  const actorId = req?.user?._id || req?.user?.id || req?.auth?.userId || req?.principalId;
  const actor = {
    id: actorId,
    _id: actorId,
    tenantId,
    role: normalizeRole(req?.user?.role || req?.auth?.role),
    roles: req?.user?.roles || req?.auth?.roles || [],
  };

  if (!actorId || !canViewGroup(actor, group)) {
    const error = new Error('You are not authorized to view this group financial information.');
    error.code = 'GROUP_FINANCIAL_ACCESS_FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }

  return group;
}

export async function getBalance(req, res, next) {
  try {
    const tenantId = requireTenantId(req);
    const groupId = validateGroupId(req.params.id);
    await requireGroupViewAccess(req, tenantId, groupId);

    // A Group currently has no canonical account/wallet reference in the
    // MongoDB domain model. Summing every debit and credit line tagged with a
    // group would generally net a balanced journal to zero; that is not a
    // valid group wallet balance. Fail closed until an authorized, explicit
    // group-to-account mapping is implemented and verified.
    const error = new Error(
      'A canonical financial account has not been configured for this group. The ledger balance is unavailable.'
    );
    error.name = 'GroupFinancialAccountNotConfigured';
    error.code = 'GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED';
    error.statusCode = 503;
    error.isOperational = true;
    error.retryable = false;
    throw error;
  } catch (error) {
    return next(error);
  }
}

export async function getLedger(req, res, next) {
  try {
    const tenantId = requireTenantId(req);
    const groupId = validateGroupId(req.params.id);
    await requireGroupViewAccess(req, tenantId, groupId);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const entries = await LedgerEntry.find({ tenantId, groupId, journalStatus: 'POSTED', posted: true })
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
