/** Pure policy helpers for TITech meeting workflows. */
export const MEETING_STATUSES = Object.freeze(['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const MEETING_FORMATS = Object.freeze(['IN_PERSON', 'REMOTE', 'HYBRID']);
export const MEETING_TYPES = Object.freeze(['COMMUNITY', 'SAVINGS_GROUP', 'SACCO', 'COOPERATIVE', 'ASSOCIATION', 'EMPLOYER', 'PENSIONER_GROUP', 'INSURANCE_ORGANIZATION', 'CORPORATE', 'OTHER']);
export const ALLOWED_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['SCHEDULED', 'CANCELLED']),
  SCHEDULED: Object.freeze(['IN_PROGRESS', 'CANCELLED']),
  IN_PROGRESS: Object.freeze(['COMPLETED', 'CANCELLED']),
  COMPLETED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});

export function normalizeRequiredText(value, field, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`${field} is required.`), { code: 'MEETING_VALIDATION_ERROR', statusCode: 400 });
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw Object.assign(new Error(`${field} exceeds the permitted length.`), { code: 'MEETING_VALIDATION_ERROR', statusCode: 400 });
  }
  return normalized;
}

export function parseDate(value, field, { optional = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (optional) return null;
    throw Object.assign(new Error(`${field} is required.`), { code: 'MEETING_VALIDATION_ERROR', statusCode: 400 });
  }
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) {
    throw Object.assign(new Error(`${field} must be a valid date/time.`), { code: 'MEETING_VALIDATION_ERROR', statusCode: 400 });
  }
  return result;
}

export function assertTransition(currentStatus, nextStatus, details = {}) {
  if (!MEETING_STATUSES.includes(nextStatus) || !ALLOWED_TRANSITIONS[currentStatus]?.includes(nextStatus)) {
    throw Object.assign(new Error(`Meeting cannot transition from ${currentStatus} to ${nextStatus}.`), { code: 'MEETING_INVALID_STATE_TRANSITION', statusCode: 409 });
  }
  if (nextStatus === 'SCHEDULED') {
    if (!details.scheduledStart || !details.scheduledEnd) {
      throw Object.assign(new Error('A start and end time are required before scheduling.'), { code: 'MEETING_SCHEDULE_TIME_REQUIRED', statusCode: 422 });
    }
    if (new Date(details.scheduledEnd) <= new Date(details.scheduledStart)) {
      throw Object.assign(new Error('Meeting end must be later than meeting start.'), { code: 'MEETING_INVALID_TIME_RANGE', statusCode: 422 });
    }
    if (['IN_PERSON', 'HYBRID'].includes(details.format) && !String(details.venue || '').trim()) {
      throw Object.assign(new Error('A venue is required for in-person or hybrid meetings.'), { code: 'MEETING_VENUE_REQUIRED', statusCode: 422 });
    }
  }
  if (nextStatus === 'CANCELLED' && !String(details.cancellationReason || '').trim()) {
    throw Object.assign(new Error('A cancellation reason is required.'), { code: 'MEETING_CANCELLATION_REASON_REQUIRED', statusCode: 422 });
  }
  return true;
}

export function canReadMeeting(meeting, actorId, hasReadAny = false) {
  if (!meeting || !actorId) return false;
  if (hasReadAny || meeting.organizerId === actorId) return true;
  return (meeting.participants || []).some((participant) => participant.identityRef === actorId && participant.invitationStatus !== 'REMOVED');
}

export function canManageMeeting(meeting, actorId, hasManageAny = false) {
  return Boolean(meeting && actorId && (hasManageAny || meeting.organizerId === actorId));
}

export function expectedRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw Object.assign(new Error('expectedRevision is required and must be a positive integer.'), { code: 'MEETING_REVISION_REQUIRED', statusCode: 428 });
  }
  return revision;
}
