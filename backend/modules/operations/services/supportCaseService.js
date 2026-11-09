import SupportCase, { CASE_STATUS } from '../models/SupportCase.js';
import { computeSlaDueAt, resolveSlaPolicy } from '../sla/slaPolicy.js';

function trusted(context = {}) {
  const tenantId = context.tenantId ? String(context.tenantId).trim() : '';
  const actorId = context.actorId ? String(context.actorId).trim() : '';
  if (!tenantId || !actorId) throw Object.assign(new Error('Trusted tenant and actor context are required.'), { code: 'TRUSTED_CONTEXT_REQUIRED', statusCode: 401 });
  return { tenantId, actorId };
}

export async function createSupportCase(payload, context = {}) {
  const t = trusted(context);
  const policy = resolveSlaPolicy({ type: payload.type, priority: payload.priority });
  return SupportCase.create({
    tenantId: t.tenantId,
    type: payload.type,
    priority: payload.priority || policy.priority,
    status: CASE_STATUS.OPEN,
    subject: payload.subject,
    description: payload.description,
    assignedTo: payload.assignedTo || null,
    createdBy: t.actorId,
    requestId: payload.requestId || null,
    correlationId: payload.correlationId || null,
    linked: payload.linked || {},
    sla: { policy: `${String(payload.type).toUpperCase()}_${String(payload.priority || policy.priority).toUpperCase()}`, dueAt: computeSlaDueAt({ type: payload.type, priority: payload.priority }) },
    events: [{ type: 'CASE_CREATED', actorId: t.actorId, note: 'Operational case created.' }],
  });
}

export async function transitionSupportCase(id, nextStatus, note, evidenceRefs = [], context = {}) {
  const t = trusted(context);
  const current = await SupportCase.findOne({ tenantId: t.tenantId, _id: id });
  if (!current) throw Object.assign(new Error('Support case not found.'), { code: 'CASE_NOT_FOUND', statusCode: 404 });
  const allowed = {
    OPEN: ['IN_PROGRESS', 'PENDING_EXTERNAL', 'RESOLVED', 'CLOSED'],
    IN_PROGRESS: ['PENDING_EXTERNAL', 'RESOLVED', 'CLOSED'],
    PENDING_EXTERNAL: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
    RESOLVED: ['CLOSED', 'IN_PROGRESS'],
    CLOSED: [],
  };
  if (current.status !== nextStatus && !allowed[current.status]?.includes(nextStatus)) {
    throw Object.assign(new Error(`Invalid case transition: ${current.status} -> ${nextStatus}`), { code: 'CASE_STATE_TRANSITION_INVALID', statusCode: 409 });
  }
  current.status = nextStatus;
  current.events.push({ type: `STATUS_${nextStatus}`, actorId: t.actorId, note: note || null, evidenceRefs: evidenceRefs || [] });
  if (nextStatus === CASE_STATUS.RESOLVED || nextStatus === CASE_STATUS.CLOSED) current.resolution = note || current.resolution;
  await current.save();
  return current;
}

export async function listSupportCases(filters = {}, context = {}) {
  const t = trusted(context);
  return SupportCase.find({ tenantId: t.tenantId, ...(filters.status ? { status: filters.status } : {}), ...(filters.priority ? { priority: filters.priority } : {}) })
    .sort({ createdAt: -1 }).limit(Math.min(Number(filters.limit) || 100, 250));
}
