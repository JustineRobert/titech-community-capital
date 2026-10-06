import mongoose from 'mongoose';
import { User } from '../models/User.js';
import Group from '../models/Group.js';
import AuditLog from '../models/AuditLog.js';
import RefreshToken from '../models/RefreshToken.js';
import {
  buildAuthorizationContext,
  canAssignUserRole,
  canChangeMembershipRole,
  canManageGroup,
  canManageMembership,
  getPermissionsForRoles,
  normalizeRole,
} from '../security/rbacPolicy.js';

function objectId(value, field) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    const error = new Error(`${field} must be a valid identifier.`);
    error.code = 'RBAC_INVALID_IDENTIFIER';
    error.statusCode = 400;
    throw error;
  }
  return new mongoose.Types.ObjectId(value);
}

function safeUser(user) {
  if (!user) return null;
  return {
    id: String(user._id || user.id),
    email: user.email || null,
    name: user.name || null,
    role: normalizeRole(user.role) || 'member',
    tenantId: user.tenantId ? String(user.tenantId) : null,
    status: user.status || null,
    isActive: user.isActive !== false,
    isVerified: Boolean(user.isVerified),
  };
}

async function appendTenantAudit({ tenantId, actorId, action, entityType, entityId, outcome = 'SUCCESS', metadata, req }) {
  if (!tenantId) return null;
  try {
    return await AuditLog.appendTenant({
      tenantId,
      userId: actorId || null,
      action,
      entityType,
      entityId: entityId || null,
      outcome,
      metadata,
      requestId: req?.requestId || null,
      correlationId: req?.correlationId || null,
    });
  } catch (error) {
    // Authorization mutations have already committed; audit failures are made
    // observable and fail closed only when explicitly required by policy.
    const auditError = new Error('Authorization audit persistence failed.');
    auditError.code = 'RBAC_AUDIT_PERSISTENCE_FAILED';
    auditError.cause = error;
    throw auditError;
  }
}

export async function getAuthoritativeUser(userId) {
  const id = objectId(userId, 'userId');
  return User.findById(id)
    .select('_id name email role tenantId status isActive isVerified deletedAt security.securityVersion sessionMetrics.sessionVersion')
    .lean()
    .exec();
}

export async function getAuthorizationContext(userId) {
  const user = await getAuthoritativeUser(userId);
  if (!user) return null;
  return buildAuthorizationContext({ user, tenantId: user.tenantId });
}

export function permissionsForUser(user) {
  return getPermissionsForRoles([user?.role, ...(user?.roles || [])]);
}

async function resolveTargetUser(userId) {
  const id = objectId(userId, 'userId');
  const user = await User.findById(id).select('_id name email role tenantId status isActive isVerified deletedAt security sessionMetrics').exec();
  if (!user) {
    const error = new Error('Target user was not found.');
    error.code = 'RBAC_TARGET_USER_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  if (user.deletedAt || user.isActive === false || user.status !== 'active') {
    const error = new Error('Target user is not active.');
    error.code = 'RBAC_TARGET_USER_INACTIVE';
    error.statusCode = 409;
    throw error;
  }
  return user;
}

export async function assignUserRole({ actor, targetUserId, role, groupId = null, req = null }) {
  const target = await resolveTargetUser(targetUserId);
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) {
    const error = new Error('Unsupported role.');
    error.code = 'RBAC_ROLE_INVALID';
    error.statusCode = 400;
    throw error;
  }

  let group = null;
  if (groupId) {
    group = await Group.findOne({
      _id: objectId(groupId, 'groupId'),
      tenantId: actor?.tenantId,
      deletedAt: null,
    });
    if (!group) {
      const error = new Error('Authorized group was not found.');
      error.code = 'RBAC_GROUP_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }
  }

  const decision = canAssignUserRole(actor, target, normalizedRole, { group });
  if (!decision.allowed) {
    const error = new Error('Role assignment is not authorized.');
    error.code = 'RBAC_ROLE_ASSIGNMENT_FORBIDDEN';
    error.statusCode = 403;
    error.reason = decision.reason;
    throw error;
  }

  const oldRole = normalizeRole(target.role) || 'member';

  target.role = normalizedRole;
  if (!target.security) target.security = {};
  if (!target.sessionMetrics) target.sessionMetrics = {};
  target.security.securityVersion = Number(target.security.securityVersion || 1) + 1;
  target.sessionMetrics.sessionVersion = Number(target.sessionMetrics.sessionVersion || 1) + 1;
  target.sessionMetrics.activeSessions = 0;
  target.sessionMetrics.lastSessionRevokedAt = new Date();
  await target.save({ validateBeforeSave: false });

  await RefreshToken.updateMany(
    { userId: target._id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'admin_revoked' } },
  );

  if (normalizedRole === 'group_admin' && group) {
    const membership = group.getMembership(target._id);
    if (membership) {
      group.changeMemberRole(target._id, 'group_admin');
      group.appendAudit({ action: 'member_role_changed', userId: actor?.id || actor?._id });
      await group.save();
    }
  }

  if (normalizedRole !== oldRole) {
    await appendTenantAudit({
      tenantId: target.tenantId,
      actorId: actor?.id || actor?._id || null,
      action: 'ROLE_CHANGED',
      entityType: 'USER',
      entityId: target._id,
      metadata: { oldRole, newRole: normalizedRole, groupId: group?._id || null },
      req,
    });
  }

  return safeUser(target);
}

async function resolveGroup(actor, groupId) {
  const group = await Group.findOne({
    _id: objectId(groupId, 'groupId'),
    tenantId: actor?.tenantId,
    deletedAt: null,
  });
  if (!group) {
    const error = new Error('Group not found.');
    error.code = 'RBAC_GROUP_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  return group;
}

export async function getAuthorizedGroup({ actor, groupId, allowMemberView = true }) {
  const group = await resolveGroup(actor, groupId);
  const allowed = allowMemberView
    ? canManageGroup(actor, group) || Boolean(
        group.getMembership(actor?.id || actor?._id) &&
        group.getMembership(actor?.id || actor?._id).membershipStatus !== 'suspended' &&
        group.getMembership(actor?.id || actor?._id).removedAt == null &&
        (group.getMembership(actor?.id || actor?._id).membershipStatus === 'active' ||
          group.getMembership(actor?.id || actor?._id).membershipStatus === 'reinstated' ||
          (!group.getMembership(actor?.id || actor?._id).membershipStatus &&
            group.getMembership(actor?.id || actor?._id).invitationStatus === 'accepted'))
      )
    : canManageGroup(actor, group);
  if (!allowed) {
    const error = new Error('Group access is not authorized.');
    error.code = 'RBAC_GROUP_ACCESS_FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }
  return group;
}

export async function roleHasPermission(role, permission) {
  const normalized = normalizeRole(role);
  if (!normalized || typeof permission !== 'string') return false;
  const canonicalPermission = String(permission).trim();
  if (getPermissionsForRoles([normalized]).includes(canonicalPermission)) return true;
  const legacy = {
    'loans:approve': normalized === 'platform_admin' || normalized === 'tenant_admin',
    'transactions:write': normalized === 'platform_admin' || normalized === 'tenant_admin' || normalized === 'group_admin',
    'bizchat.execute': normalized !== 'guest',
  };
  return Boolean(legacy[canonicalPermission]);
}

export async function transitionMembership({ actor, groupId, memberUserId, action, role = null, req = null }) {
  const group = await resolveGroup(actor, groupId);
  if (!canManageMembership(actor, group)) {
    const error = new Error('Membership administration is not authorized.');
    error.code = 'RBAC_MEMBERSHIP_FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }

  const targetId = objectId(memberUserId, 'memberUserId');
  const targetMembership = group.getMembership(targetId);
  if (!targetMembership) {
    const error = new Error('Membership record not found.');
    error.code = 'RBAC_MEMBERSHIP_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  const oldStatus = targetMembership.membershipStatus ||
    (targetMembership.removedAt ? 'removed' : targetMembership.invitationStatus === 'accepted' ? 'active' : targetMembership.invitationStatus);
  const oldRole = targetMembership.role;

  switch (action) {
    case 'approve':
      group.approveMembership(targetId);
      break;
    case 'reject':
      group.rejectInvitation(targetId);
      break;
    case 'suspend':
      group.suspendMember(targetId, actor?.id || actor?._id);
      break;
    case 'reinstate':
      group.reinstateMember(targetId);
      break;
    case 'remove':
      group.removeMember(targetId, actor?.id || actor?._id);
      break;
    case 'role': {
      const decision = canChangeMembershipRole(actor, group, targetMembership, role);
      if (!decision.allowed) {
        const error = new Error('Membership role change is not authorized.');
        error.code = 'RBAC_MEMBERSHIP_ROLE_FORBIDDEN';
        error.statusCode = 403;
        error.reason = decision.reason;
        throw error;
      }
      if (String(targetId) === String(actor?.id || actor?._id)) {
        const error = new Error('Self role change is not permitted.');
        error.code = 'RBAC_SELF_ROLE_CHANGE_FORBIDDEN';
        error.statusCode = 403;
        throw error;
      }
      group.changeMemberRole(targetId, role);
      break;
    }
    default: {
      const error = new Error('Unsupported membership action.');
      error.code = 'RBAC_MEMBERSHIP_ACTION_INVALID';
      error.statusCode = 400;
      throw error;
    }
  }

  await group.save();

  if (action === 'role') {
    await appendTenantAudit({
      tenantId: group.tenantId,
      actorId: actor?.id || actor?._id || null,
      action: 'MEMBERSHIP_ROLE_CHANGED',
      entityType: 'GROUP',
      entityId: group._id,
      metadata: {
        memberUserId: targetId,
        oldRole,
        newRole: role,
      },
      req,
    });
  } else {
    const newMembership = group.getMembership(targetId);
    const newStatus = newMembership?.membershipStatus ||
      (newMembership?.removedAt ? 'removed' : newMembership?.invitationStatus === 'accepted' ? 'active' : newMembership?.invitationStatus);
    await appendTenantAudit({
      tenantId: group.tenantId,
      actorId: actor?.id || actor?._id || null,
      action: `MEMBERSHIP_${action.toUpperCase()}`,
      entityType: 'GROUP',
      entityId: group._id,
      metadata: {
        memberUserId: targetId,
        oldStatus,
        newStatus,
        oldRole,
        newRole: newMembership?.role || oldRole,
      },
      req,
    });
  }

  // Keep the global user role aligned with the existence of group-admin
  // memberships while preserving stronger tenant/platform roles.
  const target = await User.findById(targetId).select('_id role tenantId').exec();
  if (target && normalizeRole(target.role) === 'group_admin') {
    const stillGroupAdmin = await Group.exists({
      tenantId: target.tenantId,
      memberRoles: {
        $elemMatch: {
          userId: targetId,
          role: 'group_admin',
          removedAt: null,
          invitationStatus: 'accepted',
          $or: [
            { membershipStatus: 'active' },
            { membershipStatus: 'reinstated' },
            { membershipStatus: { $exists: false } },
          ],
        },
      },
      deletedAt: null,
    });
    if (!stillGroupAdmin) {
      await User.updateOne(
        { _id: targetId, role: { $in: ['group_admin'] } },
        {
          $set: { role: 'member' },
          $inc: { 'security.securityVersion': 1, 'sessionMetrics.sessionVersion': 1 },
        },
      );
      await RefreshToken.updateMany(
        { userId: targetId, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: 'admin_revoked' } },
      );
    }
  }

  return group;
}

export default Object.freeze({
  getAuthoritativeUser,
  getAuthorizationContext,
  permissionsForUser,
  assignUserRole,
  getAuthorizedGroup,
  transitionMembership,
  roleHasPermission,
});
