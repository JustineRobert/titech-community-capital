import mongoose from "mongoose";
import { User } from "../models/User.js";
import Group from "../models/Group.js";
import logger from "../utils/logger.js";

const GROUP_TYPES = new Set([
  "savings",
  "investment",
  "community",
  "welfare",
]);
const MEMBER_ROLES = new Set(["member", "treasurer", "secretary"]);

function getIdentity(req) {
  const userId = req.user?._id || req.user?.id || req.auth?.userId;
  const tenantId =
    req.authenticatedTenantId ||
    req.auth?.tenantId ||
    req.user?.tenantId;

  if (
    !mongoose.Types.ObjectId.isValid(userId) ||
    !mongoose.Types.ObjectId.isValid(tenantId)
  ) {
    return null;
  }

  return {
    userId: new mongoose.Types.ObjectId(userId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  };
}

function sendError(res, statusCode, code, message) {
  return res.status(statusCode).json({
    success: false,
    code,
    message,
  });
}

export async function createGroup(req, res) {
  const identity = getIdentity(req);
  if (!identity) {
    return sendError(
      res,
      403,
      "GROUP_TENANT_CONTEXT_REQUIRED",
      "Join an existing tenant before creating a group."
    );
  }

  const { name, type = "savings", description = "", members = [] } =
    req.body || {};

  if (
    typeof name !== "string" ||
    name.trim().length < 3 ||
    name.trim().length > 100 ||
    typeof description !== "string" ||
    description.length > 500 ||
    !GROUP_TYPES.has(type) ||
    !Array.isArray(members) ||
    members.length > 10000
  ) {
    return sendError(
      res,
      400,
      "GROUP_INPUT_INVALID",
      "Provide a valid group name, type, description, and member list."
    );
  }

  const inviteEntries = members.map((entry) => {
    const email =
      typeof entry === "string"
        ? entry.trim().toLowerCase()
        : entry?.email?.trim().toLowerCase();
    const role =
      typeof entry === "string" ? "member" : entry?.role || "member";
    return { email, role };
  });

  if (
    inviteEntries.some(
      ({ email, role }) =>
        typeof email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !MEMBER_ROLES.has(role)
    )
  ) {
    return sendError(
      res,
      400,
      "GROUP_MEMBER_INPUT_INVALID",
      "Each invited member must have a valid email address and role."
    );
  }

  const uniqueEmails = [...new Set(inviteEntries.map(({ email }) => email))];
  const inviteUsers = uniqueEmails.length
    ? await User.find({
        email: { $in: uniqueEmails },
        tenantId: identity.tenantId,
        status: "active",
        deletedAt: null,
      }).select("_id email")
    : [];

  const usersByEmail = new Map(
    inviteUsers.map((user) => [user.email.toLowerCase(), user])
  );
  const unavailableEmails = uniqueEmails.filter(
    (email) => !usersByEmail.has(email)
  );
  if (unavailableEmails.length) {
    return sendError(
      res,
      400,
      "GROUP_INVITE_MEMBER_UNAVAILABLE",
      "Invitees must have active accounts in this tenant."
    );
  }

  const group = new Group({
    tenantId: identity.tenantId,
    name: name.trim(),
    type,
    description: description.trim(),
    createdBy: identity.userId,
    managedBy: identity.userId,
  });

  group.addMember(identity.userId, {
    role: "member",
    invitationStatus: "accepted",
  });
  group.appendAudit({
    action: "created",
    userId: identity.userId,
  });

  for (const invite of inviteEntries) {
    const invitee = usersByEmail.get(invite.email);
    if (String(invitee._id) === String(identity.userId)) {
      continue;
    }

    if (!group.getMembership(invitee._id)) {
      group.addMember(invitee._id, {
        role: invite.role,
        invitationStatus: "pending",
      });
      group.appendAudit({
        action: "invitation_sent",
        userId: identity.userId,
      });
    }
  }

  await group.save();

  logger.info("GROUP_CREATED", {
    tenantId: identity.tenantId,
    groupId: group._id,
    userId: identity.userId,
    invitedCount: group.memberRoles.filter(
      (member) => member.invitationStatus === "pending"
    ).length,
  });

  return res.status(201).json({
    success: true,
    message: "Group created successfully",
    groupId: group._id,
    invitedCount: group.memberRoles.filter(
      (member) => member.invitationStatus === "pending"
    ).length,
    data: group,
  });
}

export async function joinGroup(req, res) {
  const identity = getIdentity(req);
  if (!identity) {
    return sendError(
      res,
      403,
      "GROUP_TENANT_CONTEXT_REQUIRED",
      "Join an existing tenant before joining a group."
    );
  }

  const group = await Group.findTenantGroup(
    identity.tenantId,
    req.params.id
  );
  if (!group || group.status !== "active") {
    return sendError(res, 404, "GROUP_NOT_FOUND", "Group not found.");
  }

  const membership = group.getMembership(identity.userId);
  if (
    membership &&
    !membership.removedAt &&
    membership.invitationStatus === "accepted"
  ) {
    return sendError(
      res,
      409,
      "GROUP_ALREADY_MEMBER",
      "You are already a member of this group."
    );
  }

  if (
    membership &&
    membership.invitationStatus === "pending" &&
    !membership.removedAt
  ) {
    group.acceptInvitation(identity.userId);
  } else {
    group.addMember(identity.userId, {
      role: "member",
      invitationStatus: "accepted",
    });
  }

  group.appendAudit({
    action: "member_added",
    userId: identity.userId,
  });
  await group.save();

  logger.info("GROUP_MEMBER_JOINED", {
    tenantId: identity.tenantId,
    groupId: group._id,
    userId: identity.userId,
  });

  return res.status(200).json({
    success: true,
    message: "Successfully joined group",
    data: group,
  });
}

export async function getGroups(req, res) {
  const identity = getIdentity(req);
  if (!identity) {
    return sendError(
      res,
      403,
      "GROUP_TENANT_CONTEXT_REQUIRED",
      "Join an existing tenant to browse groups."
    );
  }

  const groups = await Group.findTenantGroups(identity.tenantId, {
    status: "active",
    limit: req.query.limit || 100,
    skip: req.query.skip || 0,
  });

  return res.status(200).json({
    success: true,
    data: groups,
    pagination: {
      limit: Math.min(100, Math.max(1, Number(req.query.limit) || 100)),
      skip: Math.max(0, Number(req.query.skip) || 0),
    },
  });
}

export async function getGroupById(req, res) {
  const identity = getIdentity(req);
  if (!identity) {
    return sendError(
      res,
      403,
      "GROUP_TENANT_CONTEXT_REQUIRED",
      "Join an existing tenant to view group details."
    );
  }

  const group = await Group.findTenantGroup(identity.tenantId, req.params.id);
  if (!group) {
    return sendError(res, 404, "GROUP_NOT_FOUND", "Group not found.");
  }
  if (!group.hasMember(identity.userId)) {
    return sendError(
      res,
      403,
      "GROUP_MEMBERSHIP_REQUIRED",
      "You must join this group to view its details."
    );
  }

  return res.status(200).json({ success: true, data: group });
}

export async function leaveGroup(req, res) {
  const identity = getIdentity(req);
  if (!identity) {
    return sendError(
      res,
      403,
      "GROUP_TENANT_CONTEXT_REQUIRED",
      "Join an existing tenant before leaving a group."
    );
  }

  const group = await Group.findTenantGroup(identity.tenantId, req.params.id);
  if (!group || !group.hasMember(identity.userId)) {
    return sendError(res, 404, "GROUP_NOT_FOUND", "Group not found.");
  }
  if (String(group.createdBy) === String(identity.userId)) {
    return sendError(
      res,
      409,
      "GROUP_CREATOR_CANNOT_LEAVE",
      "The group creator cannot leave the group."
    );
  }

  group.removeMember(identity.userId, identity.userId);
  group.appendAudit({
    action: "member_removed",
    userId: identity.userId,
  });
  await group.save();

  return res.status(200).json({
    success: true,
    message: "Successfully left the group",
  });
}

export async function sendBatchInvitations(req, res) {
  const identity = getIdentity(req);
  if (!identity) {
    return sendError(
      res,
      403,
      "GROUP_TENANT_CONTEXT_REQUIRED",
      "Join an existing tenant before inviting group members."
    );
  }

  const group = await Group.findTenantGroup(
    identity.tenantId,
    req.params.groupId
  );
  if (!group) {
    return sendError(res, 404, "GROUP_NOT_FOUND", "Group not found.");
  }
  if (
    String(group.createdBy) !== String(identity.userId) &&
    req.user?.role !== "admin"
  ) {
    return sendError(
      res,
      403,
      "GROUP_INVITATION_FORBIDDEN",
      "Only a group manager or tenant administrator can invite members."
    );
  }

  const { members } = req.body || {};
  if (!Array.isArray(members) || members.length === 0 || members.length > 1000) {
    return sendError(
      res,
      400,
      "GROUP_INVITATION_INPUT_INVALID",
      "Provide between 1 and 1000 invitees."
    );
  }

  const normalized = members.map((entry) => ({
    email:
      typeof entry === "string"
        ? entry.trim().toLowerCase()
        : entry?.email?.trim().toLowerCase(),
    role: typeof entry === "string" ? "member" : entry?.role || "member",
  }));
  if (
    normalized.some(
      ({ email, role }) =>
        typeof email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !MEMBER_ROLES.has(role)
    )
  ) {
    return sendError(
      res,
      400,
      "GROUP_INVITATION_INPUT_INVALID",
      "Each invitee must have a valid email address and role."
    );
  }

  const users = await User.find({
    email: { $in: [...new Set(normalized.map(({ email }) => email))] },
    tenantId: identity.tenantId,
    status: "active",
    deletedAt: null,
  }).select("_id email");
  const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));
  const unknown = normalized.filter(({ email }) => !byEmail.has(email));
  if (unknown.length) {
    return sendError(
      res,
      400,
      "GROUP_INVITE_MEMBER_UNAVAILABLE",
      "Invitees must have active accounts in this tenant."
    );
  }

  let invitedCount = 0;
  for (const entry of normalized) {
    const user = byEmail.get(entry.email);
    if (!group.getMembership(user._id)) {
      group.addMember(user._id, {
        role: entry.role,
        invitationStatus: "pending",
      });
      group.appendAudit({
        action: "invitation_sent",
        userId: identity.userId,
      });
      invitedCount += 1;
    }
  }
  await group.save();

  return res.status(200).json({
    success: true,
    invitedCount,
    message: "Group invitations were recorded.",
  });
}

const groupController = Object.freeze({
  createGroup,
  joinGroup,
  getGroups,
  getGroupById,
  leaveGroup,
  sendBatchInvitations,
});

export default groupController;
