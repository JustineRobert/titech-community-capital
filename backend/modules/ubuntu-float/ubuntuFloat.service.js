import mongoose from 'mongoose';
import UbuntuFloatAgentProfile from './models/UbuntuFloatAgentProfile.js';
import UbuntuFloatPositionObservation from './models/UbuntuFloatPositionObservation.js';
import SecureDocument from '../secure-documents/secureDocument.model.js';
import { createAuditLog } from '../audit/audit.service.js';
import {
  assertAgentTransition,
  assertValidAgentParent,
  normalizeAgentCode,
  normalizeAgentRole,
  normalizeManualFloatAttestation,
} from './ubuntuFloat.policy.js';

function domainError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
function required(value, name, max = 200) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw domainError(`${name} is required.`, `UBUNTFLOAT_${name.toUpperCase()}_REQUIRED`);
  if (normalized.length > max) throw domainError(`${name} exceeds the permitted length.`, `UBUNTFLOAT_${name.toUpperCase()}_TOO_LONG`);
  return normalized;
}
function contextOf(context = {}) {
  return {
    tenantId: required(context.tenantId, 'tenantId', 100).toLowerCase(),
    actorId: required(context.actorId, 'actorId', 128),
    requestId: context.requestId || null,
    correlationId: context.correlationId || context.requestId || null,
  };
}
async function audit(ctx, action, data) {
  await createAuditLog({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action,
    data,
    requestId: ctx.requestId,
    correlationId: ctx.correlationId,
  });
}
function translateDatabaseError(error) {
  if (error?.code === 11000) return domainError('A record with this tenant-scoped identifier already exists.', 'UBUNTFLOAT_DUPLICATE_RECORD', 409);
  return error;
}

export async function listUbuntuFloatAgents(inputContext = {}, options = {}) {
  const ctx = contextOf(inputContext);
  const requested = Number.parseInt(options.limit, 10);
  const limit = Number.isSafeInteger(requested) ? Math.max(1, Math.min(100, requested)) : 50;
  const query = { tenantId: ctx.tenantId };
  if (options.status) query.status = String(options.status).trim().toUpperCase();
  if (options.hierarchyRole) query.hierarchyRole = normalizeAgentRole(options.hierarchyRole);
  return UbuntuFloatAgentProfile.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
}

export async function createUbuntuFloatAgent(payload = {}, inputContext = {}) {
  const ctx = contextOf(inputContext);
  const hierarchyRole = normalizeAgentRole(payload.hierarchyRole);
  const agentCode = normalizeAgentCode(payload.agentCode);
  const displayName = required(payload.displayName, 'displayName', 200);
  const parentIdText = String(payload.parentAgentId ?? '').trim();
  let parent = null;
  if (parentIdText) {
    if (!mongoose.Types.ObjectId.isValid(parentIdText)) throw domainError('Parent agent reference is invalid.', 'UBUNTFLOAT_PARENT_REFERENCE_INVALID');
    parent = await UbuntuFloatAgentProfile.findOne({ _id: parentIdText, tenantId: ctx.tenantId, status: 'ACTIVE' }).select('_id hierarchyRole status').lean();
    if (!parent) throw domainError('Parent agent must exist, be active and belong to the authenticated tenant.', 'UBUNTFLOAT_PARENT_NOT_ACTIVE', 422);
  }
  assertValidAgentParent(hierarchyRole, parent?.hierarchyRole ?? null);
  try {
    const profile = await UbuntuFloatAgentProfile.create({
      tenantId: ctx.tenantId,
      agentCode,
      displayName,
      hierarchyRole,
      parentAgentId: parent?._id ?? null,
      status: 'PENDING_REVIEW',
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
      history: [{ fromStatus: 'NOT_CREATED', toStatus: 'PENDING_REVIEW', actorId: ctx.actorId, reason: 'AGENT_REGISTERED_PENDING_REVIEW', at: new Date() }],
    });
    await audit(ctx, 'UBUNTFLOAT.AGENT_REGISTERED', { agentId: String(profile._id), agentCode, hierarchyRole, status: profile.status });
    return profile.toJSON();
  } catch (error) {
    throw translateDatabaseError(error);
  }
}

export async function reviewUbuntuFloatAgent(agentId, payload = {}, inputContext = {}) {
  const ctx = contextOf(inputContext);
  if (!mongoose.Types.ObjectId.isValid(String(agentId ?? ''))) throw domainError('Agent reference is invalid.', 'UBUNTFLOAT_AGENT_REFERENCE_INVALID');
  const profile = await UbuntuFloatAgentProfile.findOne({ _id: agentId, tenantId: ctx.tenantId }).select('+verificationReference');
  if (!profile) throw domainError('UbuntuFloat agent was not found in the authenticated tenant.', 'UBUNTFLOAT_AGENT_NOT_FOUND', 404);
  if (String(profile.createdBy) === ctx.actorId) throw domainError('The submitting actor cannot review their own agent registration.', 'UBUNTFLOAT_AGENT_SELF_REVIEW_FORBIDDEN', 403);
  const decision = required(payload.decision, 'decision', 40).toUpperCase();
  assertAgentTransition(profile.status, decision);
  const reason = String(payload.reason ?? '').trim().slice(0, 1000);
  const verificationReference = String(payload.verificationReference ?? '').trim().slice(0, 160);
  if (decision === 'ACTIVE' && !verificationReference) throw domainError('Independent verification evidence is required before activating an agent.', 'UBUNTFLOAT_VERIFICATION_EVIDENCE_REQUIRED', 422);
  if (decision === 'ACTIVE') {
    const evidence = await SecureDocument.findOne({
      tenantId: ctx.tenantId,
      documentReference: verificationReference,
      subjectId: String(profile._id),
      purpose: 'OTHER_COMPLIANCE_EVIDENCE',
      deletedAt: null,
    }).select('documentReference').lean();
    if (!evidence) throw domainError('Agent verification must reference evidence already stored in this tenant’s private document store.', 'UBUNTFLOAT_VERIFICATION_EVIDENCE_NOT_FOUND', 422);
  }
  if (['NEEDS_MORE_INFORMATION', 'REJECTED', 'SUSPENDED'].includes(decision) && !reason) throw domainError('A reason is required for this review decision.', 'UBUNTFLOAT_REVIEW_REASON_REQUIRED', 422);
  const previousStatus = profile.status;
  profile.status = decision;
  profile.reviewedBy = ctx.actorId;
  profile.reviewedAt = new Date();
  profile.verificationReference = decision === 'ACTIVE' ? verificationReference : null;
  profile.reviewReason = reason || null;
  profile.updatedBy = ctx.actorId;
  profile.history.push({ fromStatus: previousStatus, toStatus: decision, actorId: ctx.actorId, reason: reason || `REVIEW_${decision}`, evidenceReference: verificationReference || null, at: new Date() });
  try {
    await profile.save();
    await audit(ctx, 'UBUNTFLOAT.AGENT_REVIEWED', { agentId: String(profile._id), previousStatus, decision, verificationReference: verificationReference || null, reason: reason || null });
    return profile.toJSON();
  } catch (error) {
    throw translateDatabaseError(error);
  }
}

export async function listUbuntuFloatPositionObservations(inputContext = {}, filters = {}) {
  const ctx = contextOf(inputContext);
  const query = { tenantId: ctx.tenantId };
  if (filters.agentId) {
    if (!mongoose.Types.ObjectId.isValid(String(filters.agentId))) throw domainError('Agent reference is invalid.', 'UBUNTFLOAT_AGENT_REFERENCE_INVALID');
    query.agentId = filters.agentId;
  }
  if (filters.provider) query.provider = String(filters.provider).trim().toUpperCase();
  const requested = Number.parseInt(filters.limit, 10);
  const limit = Number.isSafeInteger(requested) ? Math.max(1, Math.min(100, requested)) : 50;
  return UbuntuFloatPositionObservation.find(query).sort({ observedAt: -1, _id: -1 }).limit(limit).lean();
}

/**
 * Stores a manual observation only. Client payloads cannot mark positions as
 * provider-verified and this operation never changes ledger balances or moves funds.
 */
export async function recordUbuntuFloatManualAttestation(payload = {}, inputContext = {}) {
  const ctx = contextOf(inputContext);
  const agentId = String(payload.agentId ?? '').trim();
  if (!mongoose.Types.ObjectId.isValid(agentId)) throw domainError('Agent reference is invalid.', 'UBUNTFLOAT_AGENT_REFERENCE_INVALID');
  const agent = await UbuntuFloatAgentProfile.findOne({ _id: agentId, tenantId: ctx.tenantId, status: 'ACTIVE' }).select('_id status').lean();
  if (!agent) throw domainError('Only an active agent in the authenticated tenant can receive a recorded observation.', 'UBUNTFLOAT_AGENT_NOT_ACTIVE', 422);
  const attestation = normalizeManualFloatAttestation(payload);
  try {
    const observation = await UbuntuFloatPositionObservation.create({
      tenantId: ctx.tenantId,
      agentId: agent._id,
      ...attestation,
      recordedBy: ctx.actorId,
    });
    await audit(ctx, 'UBUNTFLOAT.POSITION_MANUAL_ATTESTATION_RECORDED', {
      observationId: String(observation._id),
      agentId: String(agent._id),
      provider: observation.provider,
      currency: observation.currency,
      verificationStatus: observation.verificationStatus,
    });
    return observation.toJSON();
  } catch (error) {
    throw translateDatabaseError(error);
  }
}
