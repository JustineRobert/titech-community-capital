import { Types } from 'mongoose';
import Group from '../models/Group.js';
import { canViewGroupFinancials, normalizeRole } from '../security/rbacPolicy.js';
import { resolveCanonicalGroupTenantId } from '../security/groupWalletPolicy.js';

function requireTenantId(req) {
  return resolveCanonicalGroupTenantId(req);
}

function validateGroupId(id) {
  if (!Types.ObjectId.isValid(id)) {
    const error = new Error('Invalid group identifier.');
    error.code = 'INVALID_GROUP_ID';
    error.type = 'INVALID_GROUP_ID';
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
    error.type = 'GROUP_NOT_FOUND';
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
    permissions: req?.user?.permissions || req?.auth?.permissions || [],
    scopes: req?.user?.scopes || req?.auth?.scopes || [],
  };

  if (!actorId || !canViewGroupFinancials(actor, group)) {
    const error = new Error('Group financial information requires an authorized institution finance role, group administrator, treasurer, or explicit financial-view permission.');
    error.code = 'GROUP_WALLET_ACCESS_DENIED';
    error.type = 'GROUP_WALLET_ACCESS_DENIED';
    error.statusCode = 403;
    throw error;
  }

  return group;
}

function groupFinancialAccountNotConfiguredError() {
  const error = new Error(
    'A canonical financial account has not been configured for this group. Group financial records are unavailable.'
  );
  error.name = 'GroupFinancialAccountNotConfigured';
  error.code = 'GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED';
  error.type = 'GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED';
  error.statusCode = 503;
  error.isOperational = true;
  error.retryable = false;
  return error;
}

export async function getBalance(req, res, next) {
  try {
    const tenantId = requireTenantId(req);
    const groupId = validateGroupId(req.params.id);
    await requireGroupViewAccess(req, tenantId, groupId);

    // A Group currently has no canonical account/wallet reference in the
    // MongoDB domain model. Summing group-tagged journal lines would combine
    // both sides of double-entry postings and can expose counterparty lines.
    // Fail closed until a verified group-to-account mapping exists.
    throw groupFinancialAccountNotConfiguredError();
  } catch (error) {
    return next(error);
  }
}

export async function getLedger(req, res, next) {
  try {
    const tenantId = requireTenantId(req);
    const groupId = validateGroupId(req.params.id);
    await requireGroupViewAccess(req, tenantId, groupId);

    // Do not return all journal lines tagged with a group. Without a canonical
    // group-owned account mapping, this query cannot reliably distinguish the
    // group's own ledger lines from balancing/counterparty lines.
    throw groupFinancialAccountNotConfiguredError();
  } catch (error) {
    return next(error);
  }
}

export default Object.freeze({ getBalance, getLedger });
