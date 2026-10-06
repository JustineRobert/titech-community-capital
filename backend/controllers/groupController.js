import mongoose from "mongoose";
import { User } from "../models/User.js";
import Group from "../models/Group.js";
import logger from "../utils/logger.js";
import {
  canManageGroup,
  canViewGroup,
  normalizeRole,
} from "../security/rbacPolicy.js";
import {
  getAuthorizedGroup,
  transitionMembership,
} from "../services/rbacService.js";

const GROUP_TYPES = new Set(["savings", "investment", "community", "welfare"]);
const MEMBER_ROLES = new Set(["member", "group_admin", "treasurer", "secretary"]);

function getIdentity(req) {
  const userId = req.user?._id || req.user?.id || req.auth?.userId;
  const tenantId = req.authenticatedTenantId || req.auth?.tenantId || req.user?.tenantId;
  if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(tenantId)) return null;
  return { userId: new mongoose.Types.ObjectId(userId), tenantId: new mongoose.Types.ObjectId(tenantId) };
}

function actor(req) {
  return {
    id: req.user?._id || req.user?.id,
    _id: req.user?._id || req.user?.id,
    tenantId: req.authenticatedTenantId || req.user?.tenantId || req.auth?.tenantId,
    role: normalizeRole(req.user?.role),
    roles: req.user?.roles || [],
  };
}

function sendError(res, statusCode, code, message, details = undefined) {
  return res.status(statusCode).json({
    success: false,
    code,
    message,
    ...(details ? { details } : {}),
    requestId: res.req?.requestId,
    correlationId: res.req?.correlationId,
  });
}

function validateMemberEntries(members) {
  if (!Array.isArray(members) || members.length > 1000) return false;
  return members.every((entry) => {
    const email = typeof entry === "string" ? entry.trim().toLowerCase() : entry?.email?.trim().toLowerCase();
    const role = typeof entry === "string" ? "member" : entry?.role || "member";
    return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && MEMBER_ROLES.has(role);
  });
}

export async function createGroup(req, res) {
  const identity = getIdentity(req);
  if (!identity) return sendError(res, 403, "GROUP_TENANT_CONTEXT_REQUIRED", "Join an existing tenant before creating a group.");

  const currentActor = actor(req);
  if (!canManageGroup(currentActor, { tenantId: identity.tenantId, createdBy: identity.userId, memberRoles: [{ userId: identity.userId, role: currentActor.role, membershipStatus: "active" }] })) {
    return sendError(res, 403, "GROUP_CREATE_FORBIDDEN", "Only a tenant or group administrator may create a group.");
  }
  if (!["tenant_admin", "platform_admin"].includes(normalizeRole(currentActor.role))) {
    return sendError(res, 403, "GROUP_CREATE_FORBIDDEN", "Only a tenant administrator may create a group.");
  }

  const { name, type = "savings", description = "", members = [] } = req.body || {};
  if (typeof name !== "string" || name.trim().length < 3 || name.trim().length > 100 || typeof description !== "string" || description.length > 500 || !GROUP_TYPES.has(type) || !Array.isArray(members) || members.length > 10000) {
    return sendError(res, 400, "GROUP_INPUT_INVALID", "Provide a valid group name, type, description, and member list.");
  }
  if (!validateMemberEntries(members)) return sendError(res, 400, "GROUP_MEMBER_INPUT_INVALID", "Each invited member must have a valid email address and role.");

  const inviteEntries = members.map((entry) => ({
    email: typeof entry === "string" ? entry.trim().toLowerCase() : entry.email.trim().toLowerCase(),
    role: typeof entry === "string" ? "member" : entry.role || "member",
  }));
  const uniqueEmails = [...new Set(inviteEntries.map(({ email }) => email))];
  const inviteUsers = uniqueEmails.length ? await User.find({ email: { $in: uniqueEmails }, tenantId: identity.tenantId, status: "active", deletedAt: null }).select("_id email") : [];
  const usersByEmail = new Map(inviteUsers.map((user) => [user.email.toLowerCase(), user]));
  if (uniqueEmails.some((email) => !usersByEmail.has(email))) return sendError(res, 400, "GROUP_INVITE_MEMBER_UNAVAILABLE", "Invitees must have active accounts in this tenant.");

  const group = new Group({ tenantId: identity.tenantId, name: name.trim(), type, description: description.trim(), createdBy: identity.userId, managedBy: identity.userId });
  group.addMember(identity.userId, { role: "member", invitationStatus: "accepted", membershipOrigin: "owner" });
  group.appendAudit({ action: "created", userId: identity.userId });
  for (const invite of inviteEntries) {
    const invitee = usersByEmail.get(invite.email);
    if (String(invitee._id) === String(identity.userId) || group.getMembership(invitee._id)) continue;
    group.addMember(invitee._id, { role: invite.role, invitationStatus: "pending", membershipOrigin: "invited" });
    group.appendAudit({ action: "invitation_sent", userId: identity.userId });
  }
  await group.save();
  logger.info("GROUP_CREATED", { tenantId: identity.tenantId, groupId: group._id, userId: identity.userId });
  return res.status(201).json({ success: true, message: "Group created successfully", groupId: group._id, invitedCount: group.memberRoles.filter((member) => member.membershipStatus === "pending").length, data: group });
}

export async function requestJoinGroup(req, res) {
  const identity = getIdentity(req);
  if (!identity) return sendError(res, 403, "GROUP_TENANT_CONTEXT_REQUIRED", "Join an existing tenant before requesting group membership.");
  const group = await Group.findTenantGroup(identity.tenantId, req.params.id);
  if (!group || group.status !== "active") return sendError(res, 404, "GROUP_NOT_FOUND", "Group not found.");
  if (group.hasMember(identity.userId)) return sendError(res, 409, "GROUP_ALREADY_MEMBER", "You are already a member of this group.");
  const existing = group.getMembership(identity.userId);
  if (existing && existing.membershipStatus === "pending") return sendError(res, 409, "GROUP_JOIN_ALREADY_PENDING", "Your membership request is already pending.");
  if (existing && existing.membershipStatus === "suspended") return sendError(res, 409, "GROUP_MEMBERSHIP_SUSPENDED", "Your membership is currently suspended.");
  if (existing && !existing.removedAt && existing.membershipStatus === "rejected") return sendError(res, 409, "GROUP_JOIN_REJECTED", "A rejected membership must be explicitly reinstated by a group administrator.");
  if (existing && existing.removedAt) {
    existing.removedAt = null; existing.removedBy = null; existing.invitationStatus = "pending"; existing.membershipStatus = "pending"; existing.membershipOrigin = "requested"; existing.rejectedAt = null;
  } else {
    group.addMember(identity.userId, { role: "member", invitationStatus: "pending", membershipOrigin: "requested" });
  }
  group.appendAudit({ action: "member_join_requested", userId: identity.userId });
  await group.save();
  return res.status(202).json({ success: true, message: "Group membership request submitted.", status: "pending" });
}

export async function acceptInvitation(req, res) {
  const identity = getIdentity(req);
  if (!identity) return sendError(res, 403, "GROUP_TENANT_CONTEXT_REQUIRED", "An authenticated tenant account is required.");
  const group = await Group.findTenantGroup(identity.tenantId, req.params.id);
  if (!group) return sendError(res, 404, "GROUP_NOT_FOUND", "Group not found.");
  const membership = group.getMembership(identity.userId);
  if (!membership || membership.membershipStatus !== "pending" || membership.membershipOrigin !== "invited") {
    return sendError(res, 409, "GROUP_INVITATION_NOT_FOUND", "No pending invitation is available for this account.");
  }
  group.acceptInvitation(identity.userId);
  group.appendAudit({ action: "member_added", userId: identity.userId });
  await group.save();
  return res.status(200).json({ success: true, message: "Invitation accepted.", status: "active", data: group });
}

export async function joinGroup(req, res) {
  // Preserve legacy endpoint semantics but make it a membership request unless an invitation already exists.
  return requestJoinGroup(req, res);
}

export async function getGroups(req, res) {
  const identity = getIdentity(req);
  if (!identity) return sendError(res, 403, "GROUP_TENANT_CONTEXT_REQUIRED", "Join an existing tenant to browse groups.");
  const currentActor = actor(req);
  const groups = await Group.findTenantGroups(identity.tenantId, { status: "active", limit: req.query.limit || 100, skip: req.query.skip || 0 });
  const isAdmin = ["platform_admin", "tenant_admin"].includes(normalizeRole(currentActor.role));
  const visible = groups
    .filter((group) => isAdmin || canViewGroup(currentActor, group) || !group.deletedAt)
    .map((group) => {
      if (isAdmin || canViewGroup(currentActor, group)) return group;
      return {
        _id: group._id,
        tenantId: group.tenantId,
        name: group.name,
        type: group.type,
        description: group.description,
        status: group.status,
        capabilities: group.capabilities,
        memberCount: Array.isArray(group.memberRoles) ? group.memberRoles.filter((entry) => ["active", "reinstated"].includes(entry.membershipStatus)).length : 0,
      };
    });
  return res.status(200).json({ success: true, data: visible, pagination: { limit: Math.min(100, Math.max(1, Number(req.query.limit) || 100)), skip: Math.max(0, Number(req.query.skip) || 0) } });
}

export async function getGroupById(req, res) {
  const identity = getIdentity(req);
  if (!identity) return sendError(res, 403, "GROUP_TENANT_CONTEXT_REQUIRED", "Join an existing tenant to view group details.");
  const group = await Group.findTenantGroup(identity.tenantId, req.params.id);
  if (!group) return sendError(res, 404, "GROUP_NOT_FOUND", "Group not found.");
  if (!canViewGroup(actor(req), group)) return sendError(res, 403, "GROUP_MEMBERSHIP_REQUIRED", "You must be an active member or authorized administrator to view this group.");
  return res.status(200).json({ success: true, data: group });
}

export async function leaveGroup(req, res) {
  const identity = getIdentity(req);
  if (!identity) return sendError(res, 403, "GROUP_TENANT_CONTEXT_REQUIRED", "Join an existing tenant before leaving a group.");
  const group = await Group.findTenantGroup(identity.tenantId, req.params.id);
  if (!group || !group.hasMember(identity.userId)) return sendError(res, 404, "GROUP_NOT_FOUND", "Group not found.");
  if (String(group.createdBy) === String(identity.userId)) return sendError(res, 409, "GROUP_CREATOR_CANNOT_LEAVE", "The group creator cannot leave the group.");
  group.removeMember(identity.userId, identity.userId);
  group.appendAudit({ action: "member_removed", userId: identity.userId });
  await group.save();
  return res.status(200).json({ success: true, message: "Successfully left the group" });
}

async function groupManagement(req, res, next) {
  try {
    const currentActor = actor(req);
    const group = await getAuthorizedGroup({ actor: currentActor, groupId: req.params.groupId || req.params.id, allowMemberView: false });
    req.authorizedGroup = group;
    return next();
  } catch (error) { return next(error); }
}

export async function sendBatchInvitations(req, res) {
  const identity = getIdentity(req);
  if (!identity) return sendError(res, 403, "GROUP_TENANT_CONTEXT_REQUIRED", "Join an existing tenant before inviting group members.");
  const group = req.authorizedGroup || await getAuthorizedGroup({ actor: actor(req), groupId: req.params.groupId, allowMemberView: false });
  const { members } = req.body || {};
  if (!Array.isArray(members) || members.length === 0 || members.length > 1000 || !validateMemberEntries(members)) return sendError(res, 400, "GROUP_INVITATION_INPUT_INVALID", "Provide between 1 and 1000 valid invitees.");
  const normalized = members.map((entry) => ({ email: typeof entry === "string" ? entry.trim().toLowerCase() : entry.email.trim().toLowerCase(), role: typeof entry === "string" ? "member" : entry.role || "member" }));
  const users = await User.find({ email: { $in: [...new Set(normalized.map(({ email }) => email))] }, tenantId: identity.tenantId, status: "active", deletedAt: null }).select("_id email");
  const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));
  if (normalized.some(({ email }) => !byEmail.has(email))) return sendError(res, 400, "GROUP_INVITE_MEMBER_UNAVAILABLE", "Invitees must have active accounts in this tenant.");
  let invitedCount = 0;
  for (const entry of normalized) {
    const user = byEmail.get(entry.email);
    if (!group.getMembership(user._id)) { group.addMember(user._id, { role: entry.role, invitationStatus: "pending", membershipOrigin: "invited" }); group.appendAudit({ action: "invitation_sent", userId: identity.userId }); invitedCount += 1; }
  }
  await group.save();
  return res.status(200).json({ success: true, invitedCount, message: "Group invitations were recorded." });
}

export async function moderateMembership(req, res) {
  const currentActor = actor(req);
  const groupId = req.params.groupId;
  const memberUserId = req.params.memberUserId;
  const action = req.body?.action || req.body?.status;
  const result = await transitionMembership({ actor: currentActor, groupId, memberUserId, action, role: req.body?.role, req });
  return res.status(200).json({ success: true, message: `Membership ${action} completed.`, data: result });
}

const groupController = Object.freeze({ createGroup, requestJoinGroup, acceptInvitation, joinGroup, getGroups, getGroupById, leaveGroup, sendBatchInvitations, moderateMembership, groupManagement });
export default groupController;
