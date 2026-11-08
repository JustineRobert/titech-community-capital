import SupportCase, { CASE_PRIORITY, CASE_STATUS } from '../models/SupportCase.js';
import { computeSlaDueAt, resolveSlaPolicy } from '../sla/slaPolicy.js';
import { createAuditLog } from '../../audit/audit.service.js';
import { normalizeCaseTransition, normalizeCreateCaseInput, SUPPORT_CASE_POLICY } from '../supportCase.policy.js';

function trusted(context = {}) {
  const tenantId = context.tenantId ? String(context.tenantId).trim() : '';
  const actorId = context.actorId ? String(context.actorId).trim() : '';
  if (!tenantId || !actorId) {
    throw Object.assign(new Error('Trusted tenant and actor context are required.'), {
      code: 'TRUSTED_CONTEXT_REQUIRED',
      statusCode: 401,
    });
  }
  return {
    tenantId,
    actorId,
    requestId: typeof context.requestId === 'string' ? context.requestId.slice(0, 128) : null,
    correlationId: typeof context.correlationId === 'string' ? context.correlationId.slice(0, 128) : null,
  };
}


async function auditCase(context, action, data) {
  try {
    return await createAuditLog({
      tenantId: context.tenantId,
      actorId: context.actorId,
      action,
      data,
      requestId: context.requestId,
      correlationId: context.correlationId || context.requestId,
    });
  } catch (cause) {
    // The support-case write may already be committed. Surface the audit gap
    // explicitly instead of silently claiming the operation was fully audited.
    throw Object.assign(new Error('The case operation was persisted, but its audit record could not be confirmed. Refresh the case before retrying.'), {
      code: 'SUPPORT_CASE_AUDIT_PENDING',
      statusCode: 503,
      committed: true,
      resourceId: data?.caseId || null,
      cause,
    });
  }
}

function notFound() {
  return Object.assign(new Error('Support case not found.'), { code: 'CASE_NOT_FOUND', statusCode: 404 });
}

export async function createSupportCase(payload, context = {}) {
  const t = trusted(context);
  const input = normalizeCreateCaseInput(payload, t);
  const policy = resolveSlaPolicy({ type: input.type, priority: input.priority });
  const dueAt = computeSlaDueAt({ type: input.type, priority: input.priority });

  const created = await SupportCase.create({
    tenantId: t.tenantId,
    type: input.type,
    priority: input.priority || policy.priority || CASE_PRIORITY.MEDIUM,
    status: CASE_STATUS.OPEN,
    subject: input.subject,
    description: input.description,
    // Assignment is performed through an authorized workflow, never from a
    // partner-supplied create payload.
    assignedTo: null,
    createdBy: t.actorId,
    requestId: input.requestId,
    correlationId: input.correlationId,
    linked: input.linked,
    sla: {
      policy: `${input.type}_${input.priority || policy.priority || CASE_PRIORITY.MEDIUM}`,
      dueAt,
    },
    events: [{ type: 'CASE_CREATED', actorId: t.actorId, note: 'Operational case created.' }],
  });
  await auditCase(t, 'SUPPORT_CASE.CREATED', {
    caseId: String(created._id),
    type: created.type,
    priority: created.priority,
    status: created.status,
    linkedReferenceCount: Object.values(input.linked || {}).filter(Boolean).length,
  });
  return created;
}

export async function getSupportCase(id, context = {}) {
  const t = trusted(context);
  try {
    const record = await SupportCase.findOne({ tenantId: t.tenantId, _id: id });
    if (!record) throw notFound();
    await auditCase(t, 'SUPPORT_CASE.VIEWED', { caseId: String(record._id) });
    return record;
  } catch (error) {
    if (error?.name === 'CastError') throw notFound();
    throw error;
  }
}

export async function transitionSupportCase(id, nextStatus, note, evidenceRefs = [], context = {}) {
  const t = trusted(context);
  const input = normalizeCaseTransition(nextStatus, note, evidenceRefs);
  const current = await getSupportCase(id, t);
  const allowed = {
    OPEN: ['IN_PROGRESS', 'PENDING_EXTERNAL', 'RESOLVED', 'CLOSED'],
    IN_PROGRESS: ['PENDING_EXTERNAL', 'RESOLVED', 'CLOSED'],
    PENDING_EXTERNAL: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
    RESOLVED: ['CLOSED', 'IN_PROGRESS'],
    CLOSED: [],
  };

  // Repeated transitions to the current state are idempotent and do not
  // manufacture additional history entries.
  if (current.status === input.status) return current;
  if (!allowed[current.status]?.includes(input.status)) {
    throw Object.assign(new Error(`Invalid case transition: ${current.status} -> ${input.status}`), {
      code: 'CASE_STATE_TRANSITION_INVALID',
      statusCode: 409,
    });
  }

  current.status = input.status;
  current.events.push({
    type: `STATUS_${input.status}`,
    actorId: t.actorId,
    note: input.note,
    evidenceRefs: input.evidenceRefs,
  });
  if (input.status === CASE_STATUS.RESOLVED || input.status === CASE_STATUS.CLOSED) {
    current.resolution = input.note || current.resolution;
    current.resolutionEvidenceRefs = input.evidenceRefs;
  }
  await current.save();
  await auditCase(t, 'SUPPORT_CASE.STATUS_CHANGED', {
    caseId: String(current._id),
    status: current.status,
    evidenceReferenceCount: input.evidenceRefs.length,
  });
  return current;
}

export async function listSupportCases(filters = {}, context = {}) {
  const t = trusted(context);
  const query = { tenantId: t.tenantId };
  if (filters.status) {
    const status = String(filters.status).toUpperCase();
    if (!SUPPORT_CASE_POLICY.statuses.includes(status)) {
      throw Object.assign(new Error('status filter is invalid.'), { code: 'CASE_FILTER_INVALID', statusCode: 400 });
    }
    query.status = status;
  }
  if (filters.priority) {
    const priority = String(filters.priority).toUpperCase();
    if (!Object.values(CASE_PRIORITY).includes(priority)) {
      throw Object.assign(new Error('priority filter is invalid.'), { code: 'CASE_FILTER_INVALID', statusCode: 400 });
    }
    query.priority = priority;
  }
  const parsedLimit = Number.parseInt(filters.limit, 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;
  const records = await SupportCase.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit);
  await auditCase(t, 'SUPPORT_CASE.LIST_VIEWED', {
    statusFilter: query.status || null,
    priorityFilter: query.priority || null,
    resultCount: records.length,
    limit,
  });
  return records;
}
