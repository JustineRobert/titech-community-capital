import crypto from "node:crypto";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import Group, { GROUP_MODEL_METADATA, GROUP_TYPES as SUPPORTED_GROUP_TYPES } from "../models/Group.js";
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
import { evaluateGroupContributionCapability } from "../services/groupContributionCapability.js";
import { classifyExistingGroupMembership } from "../security/groupInvitationPolicy.js";

const GROUP_TYPES = new Set(SUPPORTED_GROUP_TYPES);
const INVITABLE_MEMBER_ROLES = new Set(["member", "treasurer", "secretary"]);
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function getIdentity(req) {
  // authMiddleware.authenticate loads req.user from the authoritative user
  // record. Never fall back to a request/header/JWT-context tenant value.
  const userId = req.user?._id || req.user?.id;
  const tenantId = req.user?.tenantId;
  if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(tenantId)) return null;
  return { userId: new mongoose.Types.ObjectId(userId), tenantId: new mongoose.Types.ObjectId(tenantId) };
}

function actor(req) {
  return {
    id: req.user?._id || req.user?.id,
    _id: req.user?._id || req.user?.id,
    tenantId: req.user?.tenantId || null,
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
  const seen = new Set();
  return members.every((entry) => {
    const rawEmail = typeof entry === "string" ? entry : entry?.email;
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    const role = typeof entry === "string" ? "member" : entry?.role || "member";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !INVITABLE_MEMBER_ROLES.has(role) || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

function activeTenantUserQuery(tenantId, emails) {
  return User.find({
    email: { $in: emails },
    tenantId,
    status: "active",
    isActive: { $ne: false },
    deletedAt: null,
  }).select("_id email status isActive");
}

function normalizeCreationRequestId(req) {
  const supplied = req.get?.("Idempotency-Key") || req.get?.("X-Request-ID") ||
    req.headers?.["idempotency-key"] || req.headers?.["x-request-id"];
  if (supplied === undefined || supplied === null || String(supplied).trim() === "") return null;
  const value = String(supplied).trim();
  return IDEMPOTENCY_KEY_PATTERN.test(value) ? value : false;
}

function creationPayloadHash({ name, type, description, members }) {
  const canonical = {
    name,
    type,
    description,
    members: [...members].map((member) => ({ email: member.email, role: member.role }))
      .sort((left, right) => left.email.localeCompare(right.email)),
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function groupCreationResponse(group, invitedCount, { replay = false, status = 201 } = {}) {
  const data = group.toObject ? group.toObject() : group;
  if (data && Object.prototype.hasOwnProperty.call(data, "creationPayloadHash")) delete data.creationPayloadHash;
  return {
    status,
    body: {
      success: true,
      message: replay ? "The previously created group was recovered for this request." : "Group created successfully.",
      groupId: String(group._id),
      invitedCount,
      invitationSummary: {
        requested: invitedCount,
        created: invitedCount,
        pending: invitedCount,
        accepted: 0,
        externalNotificationsSent: 0,
      },
      idempotentReplay: replay,
      data,
    },
  };
}

async function resolveGroupForContribution(req, res) {
  const identity = getIdentity(req);
  if (!identity) {
    return { response: sendError(res, 403, "GROUP_TENANT_CONTEXT_REQUIRED", "An authenticated tenant account is required.") };
  }
  const group = await Group.findTenantGroup(identity.tenantId, req.params.groupId);
  if (!group || group.status !== "active") {
    return { response: sendError(res, 404, "GROUP_NOT_FOUND", "Group not found.") };
  }
  if (!canViewGroup(actor(req), group)) {
    return { response: sendError(res, 403, "GROUP_ACCESS_DENIED", "You are not authorized to access this group's contribution capability.") };
  }
  return { identity, group };
}

export async function createGroup(req, res) {
  const identity = getIdentity(req);
  if (!identity) return sendError(res, 403, "GROUP_TENANT_CONTEXT_REQUIRED", "Join an existing tenant with an invitation code before creating a group.");

  const currentActor = actor(req);
  if (!canManageGroup(currentActor, { tenantId: identity.tenantId, createdBy: identity.userId, memberRoles: [{ userId: identity.userId, role: currentActor.role, membershipStatus: "active" }] })) {
    return sendError(res, 403, "GROUP_CREATE_FORBIDDEN", "You are not authorized to create a group in this tenant.");
  }
  if (!new Set(["tenant_admin", "platform_admin"]).has(normalizeRole(currentActor.role))) {
    return sendError(res, 403, "GROUP_CREATE_FORBIDDEN", "Only an authorized tenant or platform administrator may create a group.");
  }

  const { name, type = "savings", description = "", members = [] } = req.body || {};
  if (typeof name !== "string" || name.trim().length < 3 || name.trim().length > 100 || typeof description !== "string" || !description.trim() || description.trim().length > 500 || !GROUP_TYPES.has(type) || !Array.isArray(members) || members.length > GROUP_MODEL_METADATA.maxMembers - 1) {
    return sendError(res, 400, "GROUP_INPUT_INVALID", "Provide a valid group name, supported group type, description, and member list.");
  }
  if (!validateMemberEntries(members)) return sendError(res, 400, "GROUP_MEMBER_INPUT_INVALID", "Each invitee must have a unique valid email address and an assignable group role (Member, Treasurer, or Secretary).");

  const normalizedName = name.trim();
  const normalizedType = String(type).trim().toLowerCase();
  const normalizedDescription = description.trim();
  const inviteEntries = members.map((entry) => ({
    email: typeof entry === "string" ? entry.trim().toLowerCase() : entry.email.trim().toLowerCase(),
    role: typeof entry === "string" ? "member" : entry.role || "member",
  }));
  const key = normalizeCreationRequestId(req);
  if (key === false) return sendError(res, 400, "GROUP_IDEMPOTENCY_KEY_INVALID", "The idempotency key must contain 8 to 128 safe characters.");
  const payloadHash = creationPayloadHash({ name: normalizedName, type: normalizedType, description: normalizedDescription, members: inviteEntries });

  // A retry with the same key and exact payload recovers the authoritative
  // saved group. Reusing a key for different input is rejected, never replayed.
  if (key) {
    const existing = await Group.findOne({ tenantId: identity.tenantId, createdBy: identity.userId, creationRequestId: key })
      .select("+creationPayloadHash")
      .exec();
    if (existing) {
      if (existing.creationPayloadHash !== payloadHash) {
        return sendError(res, 409, "GROUP_IDEMPOTENCY_CONFLICT", "This idempotency key was already used with different group details. Review Group Management before starting a new request.");
      }
      const invitedCount = (existing.memberRoles || []).filter((entry) => entry.membershipOrigin === "invited" && entry.invitationStatus === "pending").length;
      const replay = groupCreationResponse(existing, invitedCount, { replay: true, status: 200 });
      return res.status(replay.status).json(replay.body);
    }
  }

  const uniqueEmails = inviteEntries.map(({ email }) => email);
  const creatorRecord = await User.findById(identity.userId).select('email').lean().exec();
  if (creatorRecord?.email && uniqueEmails.includes(String(creatorRecord.email).trim().toLowerCase())) {
    return sendError(res, 400, "GROUP_CREATOR_ALREADY_MEMBER", "The group creator is added automatically and must not also appear in the proposed invitation list.");
  }
  const inviteUsers = uniqueEmails.length
    ? await activeTenantUserQuery(identity.tenantId, uniqueEmails)
    : [];
  const usersByEmail = new Map(inviteUsers.map((user) => [user.email.toLowerCase(), user]));
  if (uniqueEmails.some((email) => !usersByEmail.has(email))) {
    return sendError(res, 400, "GROUP_INVITE_MEMBER_UNAVAILABLE", "Every invitee must already have an active account in this tenant. Complete institution onboarding before issuing a group invitation. No user accounts are created by this workflow.");
  }

  const group = new Group({
    tenantId: identity.tenantId,
    name: normalizedName,
    type: normalizedType,
    description: normalizedDescription,
    createdBy: identity.userId,
    managedBy: identity.userId,
    ...(key ? { creationRequestId: key, creationPayloadHash: payloadHash } : {}),
  });
  group.addMember(identity.userId, { role: "group_admin", invitationStatus: "accepted", membershipOrigin: "owner" });
  group.appendAudit({ action: "created", userId: identity.userId });
  let invitedCount = 0;
  for (const invite of inviteEntries) {
    const invitee = usersByEmail.get(invite.email);
    if (String(invitee._id) === String(identity.userId) || group.getMembership(invitee._id)) continue;
    group.addMember(invitee._id, { role: invite.role, invitationStatus: "pending", membershipOrigin: "invited" });
    group.appendAudit({ action: "invitation_created", userId: identity.userId, details: { inviteeUserId: String(invitee._id), channel: "in_app" } });
    invitedCount += 1;
  }

  try {
    await group.save();
  } catch (error) {
    if (error?.code === 11000) {
      if (key) {
        const concurrent = await Group.findOne({ tenantId: identity.tenantId, createdBy: identity.userId, creationRequestId: key })
          .select("+creationPayloadHash")
          .exec();
        if (concurrent) {
          if (concurrent.creationPayloadHash !== payloadHash) {
            return sendError(res, 409, "GROUP_IDEMPOTENCY_CONFLICT", "This idempotency key was already used with different group details.");
          }
          const count = (concurrent.memberRoles || []).filter((entry) => entry.membershipOrigin === "invited" && entry.invitationStatus === "pending").length;
          const replay = groupCreationResponse(concurrent, count, { replay: true, status: 200 });
          return res.status(replay.status).json(replay.body);
        }
      }
      return sendError(res, 409, "GROUP_NAME_ALREADY_EXISTS", "A group with this name already exists in your organization.");
    }
    throw error;
  }

  logger.info("GROUP_CREATED", { tenantId: identity.tenantId, groupId: group._id, userId: identity.userId, invitationCount: invitedCount });
  const result = groupCreationResponse(group, invitedCount, { status: 201 });
  return res.status(result.status).json(result.body);
}

export async function requestJoinGroup(req, res) {
  const identity = getIdentity(req);
  if (!identity) return sendError(res, 403, "GROUP_TENANT_CONTEXT_REQUIRED", "Join an existing tenant before requesting group membership.");
  const group = await Group.findTenantGroup(identity.tenantId, req.params.id);
  if (!group || group.status !== "active") return sendError(res, 404, "GROUP_NOT_FOUND", "Group not found.");
  if (group.hasMember(identity.userId)) return sendError(res, 409, "GROUP_ALREADY_MEMBER", "You are already a member of this group.");
  const existing = group.getMembership(identity.userId);
  const invitationNow = new Date();
  if (existing?.membershipOrigin === "invited" && (existing.invitationStatus === "revoked" || existing.invitationRevokedAt)) {
    return sendError(res, 409, "GROUP_INVITATION_REVOKED", "This group invitation has been revoked.");
  }
  if (existing?.membershipOrigin === "invited" && (existing.invitationStatus === "expired" || existing.membershipStatus === "expired" || (existing.invitationStatus === "pending" && existing.invitationExpiresAt && existing.invitationExpiresAt <= invitationNow))) {
    if (existing.invitationStatus === "pending") {
      existing.invitationStatus = "expired";
      existing.membershipStatus = "expired";
      group.appendAudit({ action: "invitation_expired", userId: identity.userId });
      await group.save();
    }
    return sendError(res, 410, "GROUP_INVITATION_EXPIRED", "This group invitation has expired. Ask a group administrator to issue a new invitation.");
  }
  if (existing && existing.membershipStatus === "pending" && existing.membershipOrigin === "invited") {
    const institutionUser = await User.findOne({
      _id: identity.userId,
      tenantId: identity.tenantId,
      status: "active",
      isActive: true,
      deletedAt: null,
    }).select("_id").lean();
    if (!institutionUser) return sendError(res, 403, "GROUP_INVITATION_INSTITUTION_MEMBERSHIP_REQUIRED", "An active institution account is required before accepting this group invitation.");
    group.acceptInvitation(identity.userId, invitationNow);
    group.appendAudit({ action: "invitation_accepted", userId: identity.userId });
    group.appendAudit({ action: "member_added", userId: identity.userId });
    await group.save();
    return res.status(200).json({
      success: true,
      message: "Group invitation accepted.",
      status: "active",
      membershipStatus: "active",
      data: { id: group._id, membershipStatus: "active" },
    });
  }
  if (existing && existing.membershipStatus === "pending") return sendError(res, 409, "GROUP_JOIN_ALREADY_PENDING", "Your membership request is already pending.");
  if (existing && existing.membershipStatus === "suspended") return sendError(res, 409, "GROUP_MEMBERSHIP_SUSPENDED", "Your membership is currently suspended.");
  if (existing && !existing.removedAt && existing.membershipStatus === "rejected") return sendError(res, 409, "GROUP_JOIN_REJECTED", "A rejected membership must be explicitly reinstated by a group administrator.");
  if (!existing && (group.memberRoles || []).length >= GROUP_MODEL_METADATA.maxMembers) {
    return sendError(res, 409, "GROUP_MEMBER_LIMIT_REACHED", "This group has reached its membership-record limit.");
  }
  if (existing && existing.removedAt) {
    existing.removedAt = null; existing.removedBy = null; existing.invitationStatus = "pending"; existing.membershipStatus = "pending"; existing.membershipOrigin = "requested"; existing.rejectedAt = null;
  } else {
    group.addMember(identity.userId, { role: "member", invitationStatus: "pending", membershipOrigin: "requested" });
  }
  group.appendAudit({ action: "member_join_requested", userId: identity.userId });
  try {
    // Group has optimistic concurrency enabled. A concurrent join must fail
    // deterministically rather than creating duplicate membership records or
    // surfacing as an unhandled server error.
    await group.save();
  } catch (error) {
    if (error?.name === "VersionError") {
      return sendError(res, 409, "GROUP_MEMBERSHIP_CONFLICT", "The group changed while your request was being processed. Refresh the group and check your membership status.");
    }
    if (error?.name === "ValidationError" && error?.errors?.memberRoles) {
      return sendError(res, 409, "GROUP_MEMBER_LIMIT_REACHED", "This group cannot accept another membership record.");
    }
    throw error;
  }
  return res.status(202).json({
    success: true,
    message: "Group membership request submitted for approval.",
    status: "pending",
    membershipStatus: "pending",
    data: { id: group._id, membershipStatus: "pending" },
  });
}

export async function acceptInvitation(req, res) {
  const identity = getIdentity(req);
  if (!identity) return sendError(res, 403, "GROUP_TENANT_CONTEXT_REQUIRED", "An authenticated tenant account is required.");
  const group = await Group.findTenantGroup(identity.tenantId, req.params.id);
  if (!group || group.status !== "active") return sendError(res, 404, "GROUP_NOT_FOUND", "Group not found.");
  const membership = group.getMembership(identity.userId);
  if (membership?.invitationStatus === "revoked" || membership?.invitationRevokedAt) {
    return sendError(res, 409, "GROUP_INVITATION_REVOKED", "This group invitation has been revoked.");
  }
  if (membership?.invitationStatus === "expired" || membership?.membershipStatus === "expired") {
    return sendError(res, 410, "GROUP_INVITATION_EXPIRED", "This group invitation has expired. Ask a group administrator to issue a new invitation.");
  }
  if (!membership || membership.membershipStatus !== "pending" || membership.membershipOrigin !== "invited") {
    return sendError(res, 409, "GROUP_INVITATION_NOT_FOUND", "No pending invitation is available for this account.");
  }
  const institutionUser = await User.findOne({
    _id: identity.userId,
    tenantId: identity.tenantId,
    status: "active",
    isActive: true,
    deletedAt: null,
  }).select("_id").lean();
  if (!institutionUser) return sendError(res, 403, "GROUP_INVITATION_INSTITUTION_MEMBERSHIP_REQUIRED", "An active institution account is required before accepting this group invitation.");
  const invitationNow = new Date();
  if (membership.invitationStatus === "revoked" || membership.invitationRevokedAt) {
    return sendError(res, 409, "GROUP_INVITATION_REVOKED", "This group invitation has been revoked.");
  }
  if (membership.invitationExpiresAt && membership.invitationExpiresAt <= invitationNow) {
    membership.invitationStatus = "expired";
    membership.membershipStatus = "expired";
    group.appendAudit({ action: "invitation_expired", userId: identity.userId });
    await group.save();
    return sendError(res, 410, "GROUP_INVITATION_EXPIRED", "This group invitation has expired. Ask a group administrator to issue a new invitation.");
  }
  group.acceptInvitation(identity.userId, invitationNow);
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
      const membership = group.getMembership(identity.userId);
      const membershipStatus = membership?.membershipStatus ||
        (membership?.invitationStatus === "accepted" ? "active" : null);
      return {
        _id: group._id,
        tenantId: group.tenantId,
        name: group.name,
        type: group.type,
        description: group.description,
        status: group.status,
        capabilities: group.capabilities,
        memberCount: Array.isArray(group.memberRoles) ? group.memberRoles.filter((entry) => ["active", "reinstated"].includes(entry.membershipStatus)).length : 0,
        isMember: ["active", "reinstated"].includes(membershipStatus),
        membershipStatus,
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
  if (group.status !== "active") return sendError(res, 409, "GROUP_NOT_ACCEPTING_INVITATIONS", "Invitations cannot be added to a suspended or archived group.");
  const { members } = req.body || {};
  if (!Array.isArray(members) || members.length === 0 || members.length > 1000 || !validateMemberEntries(members)) return sendError(res, 400, "GROUP_INVITATION_INPUT_INVALID", "Provide between 1 and 1000 valid invitees.");
  const normalized = members.map((entry, index) => ({
    index,
    email: (typeof entry === "string" ? entry : entry.email).trim().toLowerCase(),
    role: typeof entry === "string" ? "member" : entry.role || "member",
  }));
  const uniqueEmails = [...new Set(normalized.map(({ email }) => email))];
  const users = await activeTenantUserQuery(identity.tenantId, uniqueEmails);
  const byEmail = new Map(users.map((user) => [String(user.email).trim().toLowerCase(), user]));
  const seen = new Set();
  const results = [];
  let invitedCount = 0;
  let alreadyInvitedCount = 0;
  let alreadyMemberCount = 0;
  let onboardingRequiredCount = 0;
  let changed = false;

  for (const entry of normalized) {
    if (seen.has(entry.email)) {
      results.push({
        index: entry.index,
        email: entry.email,
        success: false,
        status: "DUPLICATE_IN_BATCH",
        code: "GROUP_INVITATION_DUPLICATE_INPUT",
        retryable: false,
        message: "This email address appears more than once in the submitted batch.",
      });
      continue;
    }
    seen.add(entry.email);

    const user = byEmail.get(entry.email);
    if (!user) {
      onboardingRequiredCount += 1;
      results.push({
        index: entry.index,
        email: entry.email,
        success: false,
        status: "ONBOARDING_REQUIRED",
        code: "GROUP_INVITEE_ONBOARDING_REQUIRED",
        retryable: false,
        nextAction: "complete_institution_onboarding",
        message: "No active account was found in this institution. Complete institution onboarding before issuing a group invitation.",
      });
      continue;
    }

    if (user.status !== "active" || user.isActive === false) {
      results.push({
        index: entry.index,
        email: entry.email,
        success: false,
        status: "INSTITUTION_MEMBERSHIP_INACTIVE",
        code: "GROUP_INVITEE_INSTITUTION_MEMBERSHIP_INACTIVE",
        retryable: false,
        nextAction: "institution_administrator_review",
        message: "The institution account is inactive or suspended. An institution administrator must review it first.",
      });
      continue;
    }

    if (String(user._id) === String(identity.userId)) {
      alreadyMemberCount += 1;
      results.push({ index: entry.index, email: entry.email, userId: String(user._id), success: true, status: "ALREADY_MEMBER", code: "GROUP_ALREADY_MEMBER", retryable: false, message: "The group administrator is already a member of this group." });
      continue;
    }

    const existing = group.getMembership(user._id);
    const existingResult = classifyExistingGroupMembership(existing);
    if (existingResult) {
      if (existingResult.status === "ALREADY_INVITED") alreadyInvitedCount += 1;
      if (existingResult.status === "ALREADY_MEMBER") alreadyMemberCount += 1;
      results.push({ index: entry.index, email: entry.email, userId: String(user._id), ...existingResult });
      continue;
    }

    if ((group.memberRoles || []).length >= GROUP_MODEL_METADATA.maxMembers) {
      results.push({
        index: entry.index,
        email: entry.email,
        userId: String(user._id),
        success: false,
        status: "GROUP_MEMBER_LIMIT_REACHED",
        code: "GROUP_MEMBER_LIMIT_REACHED",
        retryable: false,
        message: "The group has reached its configured membership-record limit.",
      });
      continue;
    }

    try {
      group.addMember(user._id, { role: entry.role, invitationStatus: "pending", membershipOrigin: "invited" });
      group.appendAudit({
        action: "invitation_sent",
        userId: identity.userId,
        details: { inviteeUserId: String(user._id), origin: "in_app_batch" },
      });
      changed = true;
      invitedCount += 1;
      results.push({ index: entry.index, email: entry.email, userId: String(user._id), success: true, status: "CREATED", code: "GROUP_INVITATION_CREATED", retryable: false, message: "An in-app group invitation was recorded. No external email was sent." });
    } catch (error) {
      results.push({
        index: entry.index,
        email: entry.email,
        userId: String(user._id),
        success: false,
        status: "INVITATION_REQUIRES_REVIEW",
        code: "GROUP_INVITATION_STATE_CONFLICT",
        retryable: false,
        message: "The existing membership state prevented this invitation. Review the member record before retrying.",
      });
    }
  }

  if (changed) {
    try {
      await group.save();
    } catch (error) {
      if (error?.name === "VersionError") {
        return sendError(res, 409, "GROUP_INVITATION_CONFLICT", "The group changed while invitations were being recorded. Refresh the group and retry only members that do not already have an invitation.", { retryable: true, requestId: req.requestId });
      }
      throw error;
    }
  }

  const unsuccessful = results.filter((result) => !result.success);
  return res.status(200).json({
    success: true,
    groupId: String(group._id),
    invitedCount,
    summary: {
      requested: normalized.length,
      created: invitedCount,
      alreadyInvited: alreadyInvitedCount,
      alreadyMember: alreadyMemberCount,
      onboardingRequired: onboardingRequiredCount,
      rejected: unsuccessful.length,
    },
    results,
    message: unsuccessful.length
      ? "Invitation processing completed with individual outcomes. Successful in-app invitations were preserved."
      : "Group invitations were recorded or already existed.",
    requestId: req.requestId,
    correlationId: req.correlationId,
  });
}

export async function getGroupContributionCapabilities(req, res) {
  const resolved = await resolveGroupForContribution(req, res);
  if (resolved.response) return resolved.response;
  const capability = evaluateGroupContributionCapability({ group: resolved.group });
  return res.status(200).json({
    success: true,
    groupId: String(resolved.group._id),
    available: capability.available,
    canInitiate: capability.canInitiate,
    status: capability.status,
    reasonCode: capability.reasonCode,
    blockers: capability.blockers,
    provider: capability.provider,
    productionInitiationEnabled: capability.productionInitiationEnabled,
    settlementVerificationAvailable: capability.settlementVerificationAvailable,
    nextAction: capability.nextAction,
  });
}

export async function createGroupContributionInstruction(req, res) {
  const resolved = await resolveGroupForContribution(req, res);
  if (resolved.response) return resolved.response;
  const capability = evaluateGroupContributionCapability({ group: resolved.group });
  if (!capability.available || !capability.productionInitiationEnabled) {
    return sendError(
      res,
      503,
      "GROUP_CONTRIBUTION_NOT_CONFIGURED",
      "Contribution initiation is unavailable because the group's financial account mapping and provider authorization have not been verified.",
      {
        groupId: String(resolved.group._id),
        status: capability.status,
        reasonCode: capability.reasonCode,
        noInstructionCreated: true,
        nextAction: capability.nextAction,
      },
    );
  }

  // Fail closed until the canonical payment-instruction, provider verification,
  // settlement and ledger integration is actually mounted and authorized.
  return sendError(res, 503, "GROUP_CONTRIBUTION_NOT_CONFIGURED", "No authorized group contribution instruction service is available.", { noInstructionCreated: true });
}


export async function getMembershipRequests(req, res) {
  const identity = getIdentity(req);
  if (!identity) return sendError(res, 403, "GROUP_TENANT_CONTEXT_REQUIRED", "Join an existing tenant before reviewing membership requests.");
  const group = await Group.findTenantGroup(identity.tenantId, req.params.groupId);
  if (!group) return sendError(res, 404, "GROUP_NOT_FOUND", "Group not found.");
  if (!canManageGroup(actor(req), group)) return sendError(res, 403, "GROUP_MEMBERSHIP_ADMIN_FORBIDDEN", "Only this group's authorized administrator may review membership requests.");

  const pendingIds = (group.memberRoles || [])
    .filter((membership) =>
      membership &&
      !membership.removedAt &&
      membership.membershipOrigin === "requested" &&
      membership.membershipStatus === "pending"
    )
    .map((membership) => membership.userId);

  const users = pendingIds.length
    ? await User.find({
        _id: { $in: pendingIds },
        tenantId: identity.tenantId,
        status: "active",
        deletedAt: null,
      }).select("_id name fullName email").lean()
    : [];
  const byId = new Map(users.map((user) => [String(user._id), user]));
  const data = pendingIds.map((userId) => {
    const user = byId.get(String(userId));
    return user ? {
      userId: String(user._id),
      name: user.name || user.fullName || "Community Member",
      email: user.email,
      status: "pending",
    } : null;
  }).filter(Boolean);

  return res.status(200).json({ success: true, data, count: data.length });
}

export async function moderateMembership(req, res) {
  const currentActor = actor(req);
  const groupId = req.params.groupId;
  const memberUserId = req.params.memberUserId;
  const action = req.body?.action || req.body?.status;
  const result = await transitionMembership({ actor: currentActor, groupId, memberUserId, action, role: req.body?.role, req });
  return res.status(200).json({ success: true, message: `Membership ${action} completed.`, data: result });
}

const groupController = Object.freeze({ createGroup, requestJoinGroup, acceptInvitation, joinGroup, getGroups, getGroupById, getMembershipRequests, leaveGroup, sendBatchInvitations, moderateMembership, groupManagement, getGroupContributionCapabilities, createGroupContributionInstruction });
export default groupController;
