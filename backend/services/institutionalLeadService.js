import crypto from 'node:crypto';
import mongoose from 'mongoose';
import InstitutionalLead from '../models/InstitutionalLead.js';
import AuditLog from '../models/AuditLog.js';
import {
  canTransitionInstitutionalLeadStatus,
  fingerprintInstitutionalLeadPayload,
  isValidInstitutionalLeadSubmissionKey,
  validateInstitutionalLeadStatusChange,
  validateInstitutionalLeadSubmission,
} from '../utils/institutionalLeadValidation.js';

function validObjectId(value) {
  return value && mongoose.isObjectIdOrHexString(value) ? value : null;
}

function createReferenceNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `TCC-${date}-${crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

function asPublicResponse(record, duplicate = false) {
  return {
    referenceNumber: record.referenceNumber,
    status: record.status,
    requestType: record.type,
    confirmation: 'REQUEST_RECEIVED_AWAITING_REVIEW',
    auditStatus: record.auditState,
    duplicate,
  };
}

async function recordSystemAudit({ action, lead, actorUserId, requestId, correlationId, metadata = {} }) {
  try {
    await AuditLog.appendSystem({
      userId: validObjectId(actorUserId),
      action,
      entityType: 'INSTITUTIONAL_LEAD',
      entityId: lead._id,
      outcome: 'SUCCESS',
      requestId: requestId || null,
      correlationId: correlationId || null,
      metadata: {
        referenceNumber: lead.referenceNumber,
        type: lead.type,
        status: lead.status,
        ...metadata,
      },
    });
    lead.auditState = 'RECORDED';
    lead.auditLastErrorCode = undefined;
    await lead.save();
    return 'RECORDED';
  } catch (error) {
    // Do not log enquiry content, email addresses, IP addresses, or secrets.
    console.error('TITech institutional lead audit append failed', {
      requestId: requestId || null,
      code: typeof error?.code === 'string' ? error.code : 'AUDIT_APPEND_FAILED',
    });
    lead.auditState = 'PENDING';
    lead.auditLastErrorCode = typeof error?.code === 'string' ? error.code.slice(0, 80) : 'AUDIT_APPEND_FAILED';
    try { await lead.save(); } catch { /* Embedded status history remains the fallback audit record. */ }
    return 'PENDING';
  }
}

export async function createInstitutionalLead({ body, submissionKey, requestId, correlationId }) {
  const validation = validateInstitutionalLeadSubmission(body);
  if (!validation.ok) {
    const error = new Error('The submitted request did not pass validation.');
    error.code = 'INSTITUTIONAL_LEAD_VALIDATION_FAILED';
    error.statusCode = 400;
    error.fields = validation.errors;
    throw error;
  }

  if (!isValidInstitutionalLeadSubmissionKey(submissionKey)) {
    const error = new Error('A valid Idempotency-Key header is required.');
    error.code = 'INSTITUTIONAL_LEAD_IDEMPOTENCY_KEY_INVALID';
    error.statusCode = 400;
    throw error;
  }

  const data = validation.data;
  const payloadFingerprint = fingerprintInstitutionalLeadPayload(data);
  const prior = await InstitutionalLead.findOne({ submissionKey }).select('+payloadFingerprint');
  if (prior) {
    if (prior.payloadFingerprint !== payloadFingerprint) {
      const error = new Error('This submission key has already been used for a different request.');
      error.code = 'INSTITUTIONAL_LEAD_IDEMPOTENCY_CONFLICT';
      error.statusCode = 409;
      throw error;
    }
    return asPublicResponse(prior, true);
  }

  let record;
  try {
    record = new InstitutionalLead({
      ...data,
      referenceNumber: createReferenceNumber(),
      submissionKey,
      payloadFingerprint,
      status: 'NEW',
      auditState: 'PENDING',
      statusHistory: [{ status: 'NEW', changedAt: new Date(), note: 'Public request received.' }],
    });
    await record.save();
  } catch (error) {
    if (error?.code === 11000) {
      const winner = await InstitutionalLead.findOne({ submissionKey }).select('+payloadFingerprint');
      if (winner && winner.payloadFingerprint === payloadFingerprint) return asPublicResponse(winner, true);
      const conflict = new Error('This submission key has already been used for a different request.');
      conflict.code = 'INSTITUTIONAL_LEAD_IDEMPOTENCY_CONFLICT';
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }

  await recordSystemAudit({
    action: 'INSTITUTIONAL_LEAD_CREATED',
    lead: record,
    requestId,
    correlationId,
    metadata: { source: 'PUBLIC_WEBSITE' },
  });

  return asPublicResponse(record);
}

export async function listInstitutionalLeads({ status, type, page = 1, limit = 25 }) {
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  const [items, total] = await Promise.all([
    InstitutionalLead.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-submissionKey -payloadFingerprint -auditLastErrorCode')
      .lean(),
    InstitutionalLead.countDocuments(filter),
  ]);
  return { items, page, limit, total, pages: Math.ceil(total / limit) };
}

export async function transitionInstitutionalLead({ leadId, body, actorUserId, requestId, correlationId }) {
  if (!mongoose.isObjectIdOrHexString(leadId)) {
    const error = new Error('The requested lead was not found.');
    error.code = 'INSTITUTIONAL_LEAD_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  const validation = validateInstitutionalLeadStatusChange(body);
  if (!validation.ok) {
    const error = new Error('The requested status transition did not pass validation.');
    error.code = 'INSTITUTIONAL_LEAD_STATUS_VALIDATION_FAILED';
    error.statusCode = 400;
    error.fields = validation.errors;
    throw error;
  }
  const { status, expectedStatus, note } = validation.data;
  const lead = await InstitutionalLead.findById(leadId);
  if (!lead) {
    const error = new Error('The requested lead was not found.');
    error.code = 'INSTITUTIONAL_LEAD_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  if (lead.status !== expectedStatus) {
    const error = new Error('The request status has changed. Refresh the record and retry with its current status.');
    error.code = 'INSTITUTIONAL_LEAD_STATUS_CONFLICT';
    error.statusCode = 409;
    throw error;
  }
  if (status === lead.status || !canTransitionInstitutionalLeadStatus(lead.status, status)) {
    const error = new Error('This status transition is not allowed.');
    error.code = 'INSTITUTIONAL_LEAD_TRANSITION_DENIED';
    error.statusCode = 409;
    throw error;
  }

  const actor = validObjectId(actorUserId);
  lead.status = status;
  if (status === 'ASSIGNED') lead.assignedToUserId = actor;
  lead.statusHistory.push({ status, changedAt: new Date(), actorUserId: actor, note });
  lead.auditState = 'PENDING';
  try {
    await lead.save();
  } catch (error) {
    if (error?.name === 'VersionError') {
      const conflict = new Error('The request status changed concurrently. Refresh the record and retry.');
      conflict.code = 'INSTITUTIONAL_LEAD_STATUS_CONFLICT';
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }

  await recordSystemAudit({
    action: 'INSTITUTIONAL_LEAD_STATUS_CHANGED',
    lead,
    actorUserId: actor,
    requestId,
    correlationId,
    metadata: { previousStatus: expectedStatus, newStatus: status },
  });

  return {
    _id: String(lead._id),
    referenceNumber: lead.referenceNumber,
    type: lead.type,
    status: lead.status,
    assignedToUserId: lead.assignedToUserId ? String(lead.assignedToUserId) : null,
    auditState: lead.auditState,
    statusHistory: lead.statusHistory,
    updatedAt: lead.updatedAt,
  };
}
