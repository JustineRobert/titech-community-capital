import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { normalizeRole, CANONICAL_ROLES, getPermissionsForRole, buildAuthorizationContext, getRoleRank } from '../security/rbacPolicy.js';
import { assignUserRole, getAuthoritativeUser, transitionMembership } from '../services/rbacService.js';
import { createTenant } from '../services/tenantService.js';
import RefreshToken from '../models/RefreshToken.js';
import AuditLog from '../models/AuditLog.js';

function actor(req) {
  return { id: req.user?._id || req.user?.id, role: normalizeRole(req.user?.role), roles: req.user?.roles || [], tenantId: req.user?.tenantId || req.authenticatedTenantId || null };
}
function errorResponse(res, error) {
  const status = Number(error?.statusCode) >= 400 && Number(error?.statusCode) < 600 ? Number(error.statusCode) : 500;
  return res.status(status).json({ success: false, code: error?.code || 'RBAC_REQUEST_FAILED', message: status < 500 ? error.message : 'The authorization operation could not be completed.' });
}

export async function policy(_req, res) {
  return res.json({ success: true, roles: CANONICAL_ROLES, rolePermissions: Object.fromEntries(CANONICAL_ROLES.map((role) => [role, getPermissionsForRole(role)])) });
}

export async function me(req, res) {
  const user = await getAuthoritativeUser(req.user?.id || req.user?._id);
  if (!user) return res.status(404).json({ success: false, code: 'RBAC_USER_NOT_FOUND', message: 'User not found.' });
  const context = buildAuthorizationContext({ user });
  return res.json({ success: true, data: context });
}

export async function listUsers(req, res) {
  const actorUser = actor(req);
  const query = actorUser.role === 'platform_admin' ? {} : { tenantId: actorUser.tenantId };
  const users = await User.find(query).select('_id name email role tenantId status isActive isVerified').sort({ name: 1, email: 1 }).limit(1000).lean();
  return res.json({ success: true, data: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email, role: normalizeRole(u.role) || 'member', tenantId: u.tenantId ? String(u.tenantId) : null, status: u.status, isActive: u.isActive !== false, isVerified: u.isVerified !== false })) });
}

export async function assignRole(req, res) {
  try {
    const result = await assignUserRole({ actor: actor(req), targetUserId: req.params.userId, role: req.body?.role, groupId: req.body?.groupId || null, req });
    return res.json({ success: true, message: 'Role updated successfully. Existing sessions were revoked.', data: result });
  } catch (error) { return errorResponse(res, error); }
}

export async function transitionGroupMembership(req, res) {
  try {
    const result = await transitionMembership({ actor: actor(req), groupId: req.params.groupId, memberUserId: req.params.memberUserId, action: req.body?.action, role: req.body?.role, req });
    return res.json({ success: true, message: 'Membership updated successfully.', data: result });
  } catch (error) { return errorResponse(res, error); }
}

export async function createTenantResource(req, res) {
  try {
    const actorUser = actor(req);
    if (actorUser.role !== 'platform_admin') return res.status(403).json({ success: false, code: 'RBAC_TENANT_CREATE_FORBIDDEN', message: 'Only a platform administrator may create a tenant.' });
    const { tenantId, slug, name, institutionId = null, countryCode = 'UG', defaultCurrency = 'UGX', ownerUserId = null } = req.body || {};
    const tenant = await createTenant({ tenantId, slug, name, institutionId, countryCode, defaultCurrency, createdBy: String(actorUser.id || '') });
    let owner = null;
    if (ownerUserId) {
      const target = await User.findById(ownerUserId).select('_id tenantId role security sessionMetrics status isActive isVerified');
      if (!target) return res.status(404).json({ success: false, code: 'RBAC_OWNER_NOT_FOUND', message: 'Tenant owner was not found.' });
      target.tenantId = tenant._id;
      target.role = 'tenant_admin';
      target.security.securityVersion = Number(target.security.securityVersion || 1) + 1;
      target.sessionMetrics.sessionVersion = Number(target.sessionMetrics.sessionVersion || 1) + 1;
      await target.save({ validateBeforeSave: false });
      await RefreshToken.updateMany(
        { userId: target._id, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: 'tenant_owner_assignment' } },
      );
      owner = { id: String(target._id), role: target.role, tenantId: String(tenant._id) };
      try { await AuditLog.appendTenant({ tenantId: tenant._id, userId: actorUser.id, action: 'TENANT_OWNER_ASSIGNED', entityType: 'USER', entityId: target._id, outcome: 'SUCCESS', requestId: req.requestId || null, correlationId: req.correlationId || null }); } catch { /* audit subsystem remains separately monitored */ }
    }
    return res.status(201).json({ success: true, message: 'Tenant created successfully.', data: { id: String(tenant._id), tenantId: tenant.tenantId, slug: tenant.slug, name: tenant.name, owner } });
  } catch (error) { return errorResponse(res, error); }
}

export async function disableUser(req, res) {
  try {
    const id = new mongoose.Types.ObjectId(req.params.userId);
    const target = await User.findById(id).select('_id tenantId role security sessionMetrics status');
    if (!target) return res.status(404).json({ success: false, code: 'RBAC_USER_NOT_FOUND', message: 'User not found.' });
    const actorUser = actor(req);
    if (actorUser.role !== 'platform_admin' && String(target.tenantId) !== String(actorUser.tenantId)) return res.status(403).json({ success: false, code: 'RBAC_TENANT_DENIED', message: 'User is outside the authorized tenant.' });
    if (actorUser.role !== 'platform_admin' && getRoleRank(target.role) >= getRoleRank(actorUser.role)) return res.status(403).json({ success: false, code: 'RBAC_TARGET_ROLE_TOO_POWERFUL', message: 'You cannot disable an equal or higher-privileged administrator.' });
    if (String(target._id) === String(actorUser.id)) return res.status(403).json({ success: false, code: 'RBAC_SELF_DISABLE_FORBIDDEN', message: 'Self-disable is not permitted.' });
    target.status = 'disabled'; target.isActive = false;
    target.security.securityVersion = Number(target.security.securityVersion || 1) + 1;
    target.sessionMetrics.sessionVersion = Number(target.sessionMetrics.sessionVersion || 1) + 1;
    await target.save({ validateBeforeSave: false });
    await RefreshToken.updateMany({ userId: target._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'account_disabled' } });
    if (target.tenantId) {
      await AuditLog.appendTenant({ tenantId: target.tenantId, userId: actorUser.id, action: 'USER_DISABLED', entityType: 'USER', entityId: target._id, outcome: 'SUCCESS', requestId: req.requestId || null, correlationId: req.correlationId || null });
    }
    return res.json({ success: true, message: 'User disabled.' });
  } catch (error) { return errorResponse(res, error); }
}
