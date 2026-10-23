/** UbuntuFloat orchestration boundaries. Never posts journals or moves funds. */
import crypto from 'node:crypto';
import { createAuditLog } from '../../audit/audit.service.js';
import mongoose from 'mongoose';
import Agent from '../models/UbuntuFloatAgent.js';
import PositionObservation from '../models/UbuntuFloatPositionObservation.js';
import AdvanceApplication from '../models/UbuntuFloatAdvanceApplication.js';
import {
  assertNoticeAcknowledgement,
  normalizeCurrency,
  normalizeRequiredText,
  validateAgentHierarchy,
  validateAmountMinorUnits,
  validateNonNegativeAmountMinorUnits,
} from '../domain/ubuntuFloatRules.js';

export { getUbuntuFloatCapabilities } from '../domain/capabilities.js';

function requireTrustedContext(context = {}) {
  const tenantId = context.tenantId ? String(context.tenantId).trim() : '';
  const actorId = context.actorId ? String(context.actorId).trim() : '';
  if (!tenantId || !actorId) {
    throw Object.assign(new Error('Trusted tenant and authenticated actor context are required.'), {
      code: 'TRUSTED_CONTEXT_REQUIRED', statusCode: 401,
    });
  }
  return { tenantId, actorId, requestId: context.requestId || null, correlationId: context.correlationId || context.requestId || null };
}

function ensureObjectId(value, label = 'id') {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
    throw Object.assign(new Error(`Valid ${label} is required.`), { code: 'UBUNTFLOAT_ID_INVALID', statusCode: 400 });
  }
  return String(value);
}

async function withAuditTransaction(trusted, { action, requestId = null, correlationId = null, auditData }, operation) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const result = await operation(session);
      const resolvedAuditData = typeof auditData === 'function' ? auditData(result) : auditData;
      await createAuditLog({
        tenantId: trusted.tenantId,
        actorId: trusted.actorId,
        action,
        data: resolvedAuditData,
        requestId,
        correlationId,
        session,
      });
      return result;
    });
  } finally {
    await session.endSession();
  }
}

export async function createAgent(payload = {}, context = {}) {
  const trusted = requireTrustedContext(context);
  const externalAgentRef = normalizeRequiredText(payload.externalAgentRef, 'externalAgentRef', { maxLength: 100 });
  const displayName = normalizeRequiredText(payload.displayName, 'displayName', { maxLength: 160 });
  const level = String(payload.level || '').trim().toUpperCase();
  let parentAgent = null;
  let parentAgentId = null;

  if (payload.parentAgentId) {
    parentAgentId = ensureObjectId(payload.parentAgentId, 'parentAgentId');
    parentAgent = await Agent.findOne({ _id: parentAgentId, tenantId: trusted.tenantId }).select('_id level status').lean();
    if (!parentAgent) throw Object.assign(new Error('Parent agent was not found in this tenant.'), { code: 'UBUNTFLOAT_PARENT_NOT_FOUND', statusCode: 404 });
    if (parentAgent.status !== 'ACTIVE') throw Object.assign(new Error('A parent agent must be verified and active before it can own a child.'), { code: 'UBUNTFLOAT_PARENT_NOT_ACTIVE', statusCode: 409 });
  }
  const hierarchy = validateAgentHierarchy({ level, parentLevel: parentAgent?.level ?? null });
  if (level === 'HEAD_OFFICE' && parentAgentId) throw Object.assign(new Error('A Head Office cannot have a parent.'), { code: 'UBUNTFLOAT_HIERARCHY_INVALID', statusCode: 400 });

  try {
    return await withAuditTransaction(trusted, {
      action: 'UBUNTFLOAT_AGENT_CREATED',
      requestId: trusted.requestId, correlationId: trusted.correlationId,
      auditData: (agent) => ({ agentId: String(agent._id), externalAgentRef, level: hierarchy.level, parentAgentId: parentAgentId ? String(parentAgentId) : null, status: 'PENDING_VERIFICATION' }),
    }, async (session) => {
      const [agent] = await Agent.create([{
        tenantId: trusted.tenantId,
        externalAgentRef,
        displayName,
        level: hierarchy.level,
        parentAgentId,
        countryCode: 'UG',
        status: 'PENDING_VERIFICATION',
        providerEnrollments: [],
        createdBy: trusted.actorId,
      }], { session });
      return agent;
    });
  } catch (error) {
    if (error?.code === 11000) throw Object.assign(new Error('Agent reference already exists in this tenant.'), { code: 'UBUNTFLOAT_AGENT_REFERENCE_CONFLICT', statusCode: 409 });
    throw error;
  }
}

export async function listAgents(context = {}, { limit = 50 } = {}) {
  const { tenantId } = requireTrustedContext(context);
  const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
  return Agent.find({ tenantId }).select('-verificationReference').sort({ createdAt: -1 }).limit(boundedLimit).lean();
}

export async function recordManualPositionObservation(agentId, payload = {}, context = {}) {
  const trusted = requireTrustedContext(context);
  const safeAgentId = ensureObjectId(agentId, 'agentId');
  const agent = await Agent.findOne({ _id: safeAgentId, tenantId: trusted.tenantId }).select('_id status').lean();
  if (!agent) throw Object.assign(new Error('Agent was not found in this tenant.'), { code: 'UBUNTFLOAT_AGENT_NOT_FOUND', statusCode: 404 });
  if (agent.status !== 'ACTIVE') throw Object.assign(new Error('Float observations can be recorded only for verified active agents.'), { code: 'UBUNTFLOAT_AGENT_NOT_ACTIVE', statusCode: 409 });

  const providerCode = String(payload.providerCode || '').trim().toUpperCase();
  if (!['MTN_UG', 'AIRTEL_UG', 'OTHER'].includes(providerCode)) {
    throw Object.assign(new Error('Unsupported provider code.'), { code: 'UBUNTFLOAT_PROVIDER_INVALID', statusCode: 400 });
  }
  const accountType = String(payload.accountType || '').trim().toUpperCase();
  if (!['AGENT_E_FLOAT', 'CASH', 'OTHER'].includes(accountType)) {
    throw Object.assign(new Error('Unsupported position account type.'), { code: 'UBUNTFLOAT_ACCOUNT_TYPE_INVALID', statusCode: 400 });
  }
  const observedAt = payload.observedAt ? new Date(payload.observedAt) : new Date();
  if (Number.isNaN(observedAt.getTime()) || observedAt.getTime() > Date.now() + 60_000) {
    throw Object.assign(new Error('Observation timestamp is invalid or in the future.'), { code: 'UBUNTFLOAT_OBSERVED_AT_INVALID', statusCode: 400 });
  }

  const positionPayload = {
    tenantId: trusted.tenantId,
    agentId: safeAgentId,
    providerCode,
    accountType,
    amountMinorUnits: validateNonNegativeAmountMinorUnits(payload.amountMinorUnits),
    currency: normalizeCurrency(payload.currency),
    source: payload.source === 'IMPORT_PENDING' ? 'IMPORT_PENDING' : 'MANUAL_DECLARATION',
    verificationStatus: 'UNVERIFIED',
    observedAt,
    recordedBy: trusted.actorId,
    note: payload.note == null || String(payload.note).trim() === '' ? null : normalizeRequiredText(payload.note, 'note', { maxLength: 500 }),
  };
  return withAuditTransaction(trusted, {
    action: 'UBUNTFLOAT_POSITION_OBSERVATION_RECORDED',
    requestId: trusted.requestId, correlationId: trusted.correlationId,
    auditData: (position) => ({ positionObservationId: String(position._id), agentId: safeAgentId, providerCode, accountType, amountMinorUnits: positionPayload.amountMinorUnits, currency: positionPayload.currency, verificationStatus: 'UNVERIFIED', source: positionPayload.source }),
  }, async (session) => {
    const [position] = await PositionObservation.create([positionPayload], { session });
    return position;
  });
}

export async function listPositionObservations(agentId, context = {}, { limit = 50 } = {}) {
  const { tenantId } = requireTrustedContext(context);
  const safeAgentId = ensureObjectId(agentId, 'agentId');
  const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
  const rows = await PositionObservation.find({ tenantId, agentId: safeAgentId }).sort({ observedAt: -1 }).limit(boundedLimit).lean();
  const staleBefore = Date.now() - 15 * 60 * 1000;
  return rows.map((row) => ({
    ...row,
    freshness: new Date(row.observedAt).getTime() < staleBefore ? 'STALE' : 'RECENT',
    availabilityStatus: 'UNVERIFIED_NOT_AVAILABLE_FOR_SETTLEMENT',
  }));
}

export async function createAdvanceApplication(payload = {}, context = {}, { noticeVersion: configuredNoticeVersion = '' } = {}) {
  const trusted = requireTrustedContext(context);
  const agentId = ensureObjectId(payload.agentId, 'agentId');
  const agent = await Agent.findOne({ _id: agentId, tenantId: trusted.tenantId }).select('_id status').lean();
  if (!agent) throw Object.assign(new Error('Agent was not found in this tenant.'), { code: 'UBUNTFLOAT_AGENT_NOT_FOUND', statusCode: 404 });
  if (agent.status !== 'ACTIVE') throw Object.assign(new Error('Only a verified active agent may submit an advance application.'), { code: 'UBUNTFLOAT_AGENT_NOT_ACTIVE', statusCode: 409 });

  const noticeVersion = assertNoticeAcknowledgement({
    acknowledged: payload.noticeAcknowledged,
    noticeVersion: payload.noticeVersion,
  });
  if (!configuredNoticeVersion || noticeVersion !== configuredNoticeVersion) {
    throw Object.assign(new Error('The configured, current data-use notice is unavailable or does not match.'), {
      code: 'UBUNTFLOAT_NOTICE_VERSION_MISMATCH', statusCode: 503,
    });
  }

  const purpose = normalizeRequiredText(payload.purpose, 'purpose', { maxLength: 500 });
  const currency = normalizeCurrency(payload.currency || 'UGX');
  const requestedAmountMinorUnits = validateAmountMinorUnits(payload.requestedAmountMinorUnits);
  const applicationReference = `UFA-${crypto.randomUUID()}`;

  const applicationPayload = {
    tenantId: trusted.tenantId,
    applicationReference,
    applicantActorId: trusted.actorId,
    agentId,
    requestedAmountMinorUnits,
    currency,
    purpose,
    noticeVersion,
    noticeAcknowledgedAt: new Date(),
    status: 'SUBMITTED',
    decision: null,
    decisionReasonCodes: [],
    fundingPartnerId: null,
  };
  return withAuditTransaction(trusted, {
    action: 'UBUNTFLOAT_ADVANCE_APPLICATION_SUBMITTED',
    requestId: trusted.requestId, correlationId: trusted.correlationId,
    auditData: (application) => ({ applicationId: String(application._id), applicationReference, agentId, requestedAmountMinorUnits, currency, status: 'SUBMITTED', noticeVersion }),
  }, async (session) => {
    const [application] = await AdvanceApplication.create([applicationPayload], { session });
    return application;
  });
}

export async function listOwnAdvanceApplications(context = {}, { limit = 50 } = {}) {
  const { tenantId, actorId } = requireTrustedContext(context);
  const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
  return AdvanceApplication.find({ tenantId, applicantActorId: actorId }).sort({ createdAt: -1 }).limit(boundedLimit).lean();
}
