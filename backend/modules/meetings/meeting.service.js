/** Canonical tenant-scoped meeting service for TITech Capital LTD. */
import Meeting from './models/Meeting.js';
import User from '../../models/User.js';
import Member from '../../models/Member.js';
import Group from '../../models/Group.js';
import dailyProvider from './providers/dailyProvider.js';
import { hasPermission } from '../../middleware/platformPermissions.js';
import { createAuditLog } from '../audit/audit.service.js';
import {
  assertTransition,
  canManageMeeting,
  canReadMeeting,
  expectedRevision,
  MEETING_FORMATS,
  MEETING_TYPES,
  normalizeRequiredText,
  parseDate,
} from './meeting.policy.js';

function meetingError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function contextValues(context = {}) {
  const tenantId = String(context.tenantId || '').trim();
  const actorId = String(context.actorId || '').trim();
  if (!tenantId) throw meetingError('Trusted tenant context is required.', 'MEETING_TENANT_REQUIRED', 401);
  if (!actorId) throw meetingError('Authenticated actor context is required.', 'MEETING_ACTOR_REQUIRED', 401);
  return { ...context, tenantId, actorId };
}

function present(value) {
  const raw = value?.toObject ? value.toObject() : { ...value };
  if (!raw) return null;
  raw.id = String(raw._id || raw.id || '');
  delete raw._id;
  delete raw.__v;
  delete raw.appliedOfflineOperationIds;
  return raw;
}

function safeAuditEntry(action, context, details = {}) {
  return {
    action,
    actorId: context.actorId,
    at: new Date(),
    requestId: context.requestId || null,
    correlationId: context.correlationId || context.requestId || null,
    details,
  };
}

async function writeExternalAudit(action, context, details = {}) {
  try {
    await createAuditLog({
      tenantId: context.tenantId,
      actorId: context.actorId,
      action,
      requestId: context.requestId || null,
      correlationId: context.correlationId || context.requestId || null,
      data: details,
    });
  } catch {
    // Every meeting write stores a compact event in the same document. Keep a
    // secondary audit-store outage from returning a false failure after commit.
    // Operational readiness must still monitor the canonical audit service.
  }
}

function assertCanRead(meeting, context) {
  if (!canReadMeeting(meeting, context.actorId, hasPermission(context.user, 'meetings:read:any'))) {
    // Conceal whether an inaccessible record exists.
    throw meetingError('Meeting was not found.', 'MEETING_NOT_FOUND', 404);
  }
}

function assertCanManage(meeting, context) {
  if (!canManageMeeting(meeting, context.actorId, hasPermission(context.user, 'meetings:manage:any'))) {
    throw meetingError('You are not authorized to manage this meeting.', 'MEETING_PERMISSION_DENIED', 403);
  }
}

function assertNotTerminal(meeting) {
  if (['COMPLETED', 'CANCELLED'].includes(meeting.status)) {
    throw meetingError('This meeting is closed and cannot be modified through this operation.', 'MEETING_CLOSED', 409);
  }
}

function normalizedParticipant(input = {}, now = new Date()) {
  const identityRef = normalizeRequiredText(input.identityRef, 'identityRef', 128);
  const identityType = input.identityType || 'USER';
  const participationMode = input.participationMode || 'REMOTE';
  const participantRole = input.participantRole || 'PARTICIPANT';
  if (!['USER', 'MEMBER'].includes(identityType)) throw meetingError('Unsupported participant identity type.', 'MEETING_VALIDATION_ERROR');
  if (!['IN_PERSON', 'REMOTE', 'HYBRID'].includes(participationMode)) throw meetingError('Unsupported participation mode.', 'MEETING_VALIDATION_ERROR');
  if (!['PARTICIPANT', 'CHAIR', 'SECRETARY', 'FACILITATOR'].includes(participantRole)) throw meetingError('Unsupported participant role.', 'MEETING_VALIDATION_ERROR');
  return { identityRef, identityType, participationMode, participantRole, invitationStatus: 'INVITED', invitedAt: now };
}


async function assertTenantIdentityExists(participant, context) {
  let record = null;
  try {
    if (participant.identityType === 'MEMBER') {
      record = await Member.findOne({
        _id: participant.identityRef,
        tenantId: context.tenantId,
        memberStatus: 'ACTIVE',
      }).select('_id').lean();
    } else {
      record = await User.findOne({
        _id: participant.identityRef,
        tenantId: context.tenantId,
        status: 'active',
        isActive: true,
      }).select('_id').lean();
    }
  } catch {
    record = null;
  }
  if (!record) throw meetingError('The participant identity is not an active identity in this tenant.', 'MEETING_PARTICIPANT_IDENTITY_NOT_FOUND', 404);
}

async function loadMeeting(meetingId, context, { includeAppliedOperations = false } = {}) {
  let query = Meeting.findOne({ _id: meetingId, tenantId: context.tenantId });
  if (includeAppliedOperations) query = query.select('+appliedOfflineOperationIds');
  const meeting = await query;
  if (!meeting) throw meetingError('Meeting was not found.', 'MEETING_NOT_FOUND', 404);
  return meeting;
}

async function updateWithRevision(meeting, context, expected, action, update, details = {}) {
  const revision = expectedRevision(expected);
  if (meeting.revision !== revision) {
    throw meetingError('Meeting has changed since it was loaded. Reload and resolve the conflict before retrying.', 'MEETING_REVISION_CONFLICT', 409);
  }
  const auditTrail = safeAuditEntry(action, context, details);
  const updated = await Meeting.findOneAndUpdate(
    { _id: meeting._id, tenantId: context.tenantId, revision },
    {
      ...update,
      $set: { ...(update.$set || {}), updatedBy: context.actorId },
      $inc: { ...(update.$inc || {}), revision: 1 },
      $push: { ...(update.$push || {}), auditTrail: { $each: [auditTrail], $slice: -100 } },
    },
    { new: true, runValidators: true },
  );
  if (!updated) throw meetingError('Meeting has changed since it was loaded. Reload and resolve the conflict before retrying.', 'MEETING_REVISION_CONFLICT', 409);
  await writeExternalAudit(action, context, { meetingId: String(meeting._id), revision: updated.revision, ...details });
  return present(updated);
}

export async function listMeetings(query = {}, inputContext = {}) {
  const context = contextValues(inputContext);
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.page, 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(query.limit, 10) || 25));
  const filter = { tenantId: context.tenantId };
  if (query.status && ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(query.status)) filter.status = query.status;
  if (query.meetingType && MEETING_TYPES.includes(query.meetingType)) filter.meetingType = query.meetingType;
  if (query.from || query.to) {
    filter.scheduledStart = {};
    if (query.from) filter.scheduledStart.$gte = parseDate(query.from, 'from');
    if (query.to) filter.scheduledStart.$lte = parseDate(query.to, 'to');
  }
  if (!hasPermission(context.user, 'meetings:read:any')) {
    filter.$or = [
      { organizerId: context.actorId },
      { participants: { $elemMatch: { identityRef: context.actorId, invitationStatus: { $ne: 'REMOVED' } } } },
    ];
  }
  const [records, total] = await Promise.all([
    Meeting.find(filter).sort({ scheduledStart: 1, createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Meeting.countDocuments(filter),
  ]);
  return { items: records.map(present), page, limit, total, hasMore: page * limit < total };
}

export async function createMeeting(payload = {}, inputContext = {}) {
  const context = contextValues(inputContext);
  const title = normalizeRequiredText(payload.title, 'title', 200);
  const meetingType = payload.meetingType || 'COMMUNITY';
  const format = payload.format || 'IN_PERSON';
  if (!MEETING_TYPES.includes(meetingType)) throw meetingError('Unsupported meeting type.', 'MEETING_VALIDATION_ERROR');
  if (!MEETING_FORMATS.includes(format)) throw meetingError('Unsupported meeting format.', 'MEETING_VALIDATION_ERROR');
  const scheduledStart = parseDate(payload.scheduledStart, 'scheduledStart', { optional: true });
  const scheduledEnd = parseDate(payload.scheduledEnd, 'scheduledEnd', { optional: true });
  if (scheduledStart && scheduledEnd && scheduledEnd <= scheduledStart) throw meetingError('Meeting end must be later than meeting start.', 'MEETING_INVALID_TIME_RANGE', 422);
  const venue = payload.venue ? String(payload.venue).trim().slice(0, 300) : null;
  if (Array.isArray(payload.participants) && payload.participants.length) throw meetingError('Invite participants through the permission-checked invitation endpoint after the meeting draft is created.', 'MEETING_PARTICIPANTS_MUST_BE_INVITED_SEPARATELY', 422);
  const participants = [];
  const groupRef = payload.groupRef ? String(payload.groupRef).trim().slice(0, 128) : null;
  if (groupRef) {
    let group = null;
    try { group = await Group.findOne({ _id: groupRef, tenantId: context.tenantId }).select('_id').lean(); } catch { group = null; }
    if (!group) throw meetingError('The group is not available within this tenant.', 'MEETING_GROUP_NOT_FOUND', 404);
  }
  const firstAudit = safeAuditEntry('MEETING_CREATED', context, { meetingType, format });
  const meeting = await Meeting.create({
    tenantId: context.tenantId,
    groupRef,
    title,
    purpose: typeof payload.purpose === 'string' ? payload.purpose.trim().slice(0, 4000) : '',
    meetingType,
    format,
    venue,
    timeZone: typeof payload.timeZone === 'string' && payload.timeZone.trim() ? payload.timeZone.trim().slice(0, 100) : 'Africa/Kampala',
    scheduledStart,
    scheduledEnd,
    status: 'DRAFT',
    organizerId: context.actorId,
    chairpersonRef: payload.chairpersonRef ? String(payload.chairpersonRef).trim().slice(0, 128) : context.actorId,
    secretaryRef: payload.secretaryRef ? String(payload.secretaryRef).trim().slice(0, 128) : null,
    participants,
    createdBy: context.actorId,
    updatedBy: context.actorId,
    videoRoom: { provider: 'NONE', status: 'NOT_REQUESTED' },
    auditTrail: [firstAudit],
  });
  await writeExternalAudit('MEETING_CREATED', context, { meetingId: String(meeting._id), meetingType, format });
  return present(meeting);
}

export async function getMeeting(meetingId, inputContext = {}) {
  const context = contextValues(inputContext);
  const meeting = await loadMeeting(meetingId, context);
  assertCanRead(meeting, context);
  return present(meeting);
}

export async function updateMeeting(meetingId, payload = {}, inputContext = {}) {
  const context = contextValues(inputContext);
  const meeting = await loadMeeting(meetingId, context);
  assertCanManage(meeting, context);
  assertNotTerminal(meeting);
  const expected = expectedRevision(payload.expectedRevision);
  const allowed = ['title', 'purpose', 'meetingType', 'format', 'venue', 'timeZone', 'scheduledStart', 'scheduledEnd', 'groupRef', 'chairpersonRef', 'secretaryRef'];
  const set = {};
  for (const field of allowed) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;
    if (field === 'title') set.title = normalizeRequiredText(payload.title, 'title', 200);
    else if (field === 'meetingType') {
      if (!MEETING_TYPES.includes(payload.meetingType)) throw meetingError('Unsupported meeting type.', 'MEETING_VALIDATION_ERROR');
      set.meetingType = payload.meetingType;
    } else if (field === 'format') {
      if (!MEETING_FORMATS.includes(payload.format)) throw meetingError('Unsupported meeting format.', 'MEETING_VALIDATION_ERROR');
      set.format = payload.format;
    } else if (field === 'scheduledStart' || field === 'scheduledEnd') set[field] = parseDate(payload[field], field, { optional: true });
    else if (field === 'purpose') set.purpose = String(payload.purpose || '').trim().slice(0, 4000);
    else if (field === 'venue') set.venue = payload.venue ? String(payload.venue).trim().slice(0, 300) : null;
    else if (field === 'timeZone') set.timeZone = normalizeRequiredText(payload.timeZone, 'timeZone', 100);
    else if (field === 'groupRef') set.groupRef = payload.groupRef ? String(payload.groupRef).trim().slice(0, 128) : null;
    else set[field] = payload[field] ? String(payload[field]).trim().slice(0, 128) : null;
  }
  const finalStart = Object.hasOwn(set, 'scheduledStart') ? set.scheduledStart : meeting.scheduledStart;
  const finalEnd = Object.hasOwn(set, 'scheduledEnd') ? set.scheduledEnd : meeting.scheduledEnd;
  const finalFormat = set.format || meeting.format;
  const finalVenue = Object.hasOwn(set, 'venue') ? set.venue : meeting.venue;
  if (finalStart && finalEnd && finalEnd <= finalStart) throw meetingError('Meeting end must be later than meeting start.', 'MEETING_INVALID_TIME_RANGE', 422);
  if (meeting.status === 'SCHEDULED' && ['IN_PERSON', 'HYBRID'].includes(finalFormat) && !finalVenue) throw meetingError('A venue is required for in-person or hybrid meetings.', 'MEETING_VENUE_REQUIRED', 422);
  if (!Object.keys(set).length) throw meetingError('No editable meeting fields were supplied.', 'MEETING_NO_CHANGES', 400);
  return updateWithRevision(meeting, context, expected, 'MEETING_UPDATED', { $set: set }, { changedFields: Object.keys(set) });
}

export async function transitionMeeting(meetingId, payload = {}, inputContext = {}) {
  const context = contextValues(inputContext);
  const meeting = await loadMeeting(meetingId, context);
  assertCanManage(meeting, context);
  const nextStatus = String(payload.status || '').trim().toUpperCase();
  const reason = payload.cancellationReason ? String(payload.cancellationReason).trim().slice(0, 1000) : null;
  assertTransition(meeting.status, nextStatus, { scheduledStart: meeting.scheduledStart, scheduledEnd: meeting.scheduledEnd, format: meeting.format, venue: meeting.venue, cancellationReason: reason });
  const set = { status: nextStatus };
  if (nextStatus === 'CANCELLED') set.cancellationReason = reason;
  return updateWithRevision(meeting, context, payload.expectedRevision, 'MEETING_STATUS_CHANGED', { $set }, { from: meeting.status, to: nextStatus, reason: reason || undefined });
}

export async function inviteParticipant(meetingId, payload = {}, inputContext = {}) {
  const context = contextValues(inputContext);
  const meeting = await loadMeeting(meetingId, context);
  assertCanManage(meeting, context);
  assertNotTerminal(meeting);
  const expected = expectedRevision(payload.expectedRevision);
  const participant = normalizedParticipant(payload);
  await assertTenantIdentityExists(participant, context);
  if (meeting.participants.some((entry) => entry.identityRef === participant.identityRef && entry.invitationStatus !== 'REMOVED')) throw meetingError('This identity is already invited.', 'MEETING_PARTICIPANT_DUPLICATE', 409);
  const next = await updateWithRevision(meeting, context, expected, 'MEETING_PARTICIPANT_INVITED', { $push: { participants: participant } }, { participantRef: participant.identityRef, identityType: participant.identityType });
  return next;
}

export async function addAgendaItem(meetingId, payload = {}, inputContext = {}) {
  const context = contextValues(inputContext);
  const meeting = await loadMeeting(meetingId, context);
  assertCanManage(meeting, context);
  assertNotTerminal(meeting);
  const title = normalizeRequiredText(payload.title, 'title', 200);
  const agendaItem = {
    title,
    description: typeof payload.description === 'string' ? payload.description.trim().slice(0, 2000) : '',
    ownerRef: payload.ownerRef ? String(payload.ownerRef).trim().slice(0, 128) : null,
    durationMinutes: Number.isFinite(Number(payload.durationMinutes)) && Number(payload.durationMinutes) > 0 ? Math.min(600, Math.trunc(Number(payload.durationMinutes))) : null,
    sequence: meeting.agendaItems.length,
    status: 'PENDING',
  };
  return updateWithRevision(meeting, context, payload.expectedRevision, 'MEETING_AGENDA_ITEM_ADDED', { $push: { agendaItems: agendaItem } }, { title });
}

export async function recordAttendance(meetingId, payload = {}, inputContext = {}) {
  const context = contextValues(inputContext);
  const meeting = await loadMeeting(meetingId, context);
  if (!['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'].includes(meeting.status)) throw meetingError('Attendance can only be recorded for scheduled, active or completed meetings.', 'MEETING_ATTENDANCE_STATE_INVALID', 409);
  const identityRef = payload.identityRef ? String(payload.identityRef).trim().slice(0, 128) : context.actorId;
  const isSelf = identityRef === context.actorId;
  if (!isSelf) assertCanManage(meeting, context);
  else if (identityRef !== meeting.organizerId && !meeting.participants.some((participant) => participant.identityRef === identityRef && participant.invitationStatus !== 'REMOVED')) throw meetingError('Only an invited participant can self-record attendance.', 'MEETING_PARTICIPANT_REQUIRED', 403);
  if (meeting.attendance.some((entry) => entry.identityRef === identityRef)) throw meetingError('An attendance record already exists for this identity.', 'MEETING_ATTENDANCE_DUPLICATE', 409);
  const mode = payload.participationMode || (meeting.format === 'HYBRID' ? 'REMOTE' : meeting.format);
  if (!MEETING_FORMATS.includes(mode)) throw meetingError('Unsupported attendance mode.', 'MEETING_VALIDATION_ERROR');
  const attendance = {
    identityRef,
    identityType: payload.identityType === 'MEMBER' ? 'MEMBER' : 'USER',
    participationMode: mode,
    attendanceStatus: 'PROVISIONAL',
    source: isSelf ? 'SELF_REPORTED' : 'ORGANIZER_RECORDED',
    recordedBy: context.actorId,
    recordedAt: new Date(),
    verifiedAt: null,
    verifiedBy: null,
  };
  return updateWithRevision(meeting, context, payload.expectedRevision, 'MEETING_ATTENDANCE_RECORDED', { $push: { attendance } }, { identityRef, source: attendance.source, provisional: true });
}

export async function saveMinutes(meetingId, payload = {}, inputContext = {}) {
  const context = contextValues(inputContext);
  const meeting = await loadMeeting(meetingId, context);
  assertCanManage(meeting, context);
  if (meeting.minutes.status === 'PUBLISHED') throw meetingError('Published minutes are immutable. Use the governed correction workflow.', 'MEETING_MINUTES_ALREADY_PUBLISHED', 409);
  if (typeof payload.content !== 'string' || payload.content.length > 50000) throw meetingError('Minutes must be text with a maximum length of 50,000 characters.', 'MEETING_MINUTES_INVALID', 422);
  const nextMinutes = {
    content: payload.content,
    status: payload.content.trim() ? 'DRAFT' : 'EMPTY',
    revision: Number(meeting.minutes?.revision || 0) + 1,
    updatedBy: context.actorId,
    updatedAt: new Date(),
    publishedAt: null,
    publishedBy: null,
  };
  return updateWithRevision(meeting, context, payload.expectedRevision, 'MEETING_MINUTES_DRAFT_SAVED', { $set: { minutes: nextMinutes } }, { minutesRevision: nextMinutes.revision });
}

export async function publishMinutes(meetingId, payload = {}, inputContext = {}) {
  const context = contextValues(inputContext);
  if (!hasPermission(context.user, 'meetings:minutes:publish')) throw meetingError('You are not authorized to publish minutes.', 'MEETING_PERMISSION_DENIED', 403);
  const meeting = await loadMeeting(meetingId, context);
  assertCanManage(meeting, context);
  if (!meeting.minutes?.content?.trim()) throw meetingError('Minutes must contain content before publication.', 'MEETING_MINUTES_EMPTY', 422);
  if (meeting.minutes.status === 'PUBLISHED') throw meetingError('Minutes have already been published.', 'MEETING_MINUTES_ALREADY_PUBLISHED', 409);
  const existingMinutes = meeting.minutes?.toObject ? meeting.minutes.toObject() : { ...(meeting.minutes || {}) };
  const nextMinutes = { ...existingMinutes, status: 'PUBLISHED', publishedAt: new Date(), publishedBy: context.actorId };
  return updateWithRevision(meeting, context, payload.expectedRevision, 'MEETING_MINUTES_PUBLISHED', { $set: { minutes: nextMinutes } }, { minutesRevision: nextMinutes.revision });
}

export async function recordDecision(meetingId, payload = {}, inputContext = {}) {
  const context = contextValues(inputContext);
  const meeting = await loadMeeting(meetingId, context);
  assertCanManage(meeting, context);
  assertNotTerminal(meeting);
  const title = normalizeRequiredText(payload.title, 'title', 240);
  const decision = {
    title,
    description: typeof payload.description === 'string' ? payload.description.trim().slice(0, 4000) : '',
    status: 'RECORDED',
    recordedBy: context.actorId,
    recordedAt: new Date(),
    externalPolicyReference: payload.externalPolicyReference ? String(payload.externalPolicyReference).trim().slice(0, 200) : null,
  };
  return updateWithRevision(meeting, context, payload.expectedRevision, 'MEETING_DECISION_RECORDED', { $push: { decisions: decision } }, { title, note: 'Recorded as a meeting decision; formal voting/quorum validity is not inferred.' });
}

export async function addActionItem(meetingId, payload = {}, inputContext = {}) {
  const context = contextValues(inputContext);
  const meeting = await loadMeeting(meetingId, context);
  assertCanManage(meeting, context);
  assertNotTerminal(meeting);
  const title = normalizeRequiredText(payload.title, 'title', 240);
  const dueAt = parseDate(payload.dueAt, 'dueAt', { optional: true });
  const actionItem = {
    title,
    description: typeof payload.description === 'string' ? payload.description.trim().slice(0, 2000) : '',
    assignedToRef: payload.assignedToRef ? String(payload.assignedToRef).trim().slice(0, 128) : null,
    dueAt,
    status: 'OPEN',
    createdBy: context.actorId,
  };
  return updateWithRevision(meeting, context, payload.expectedRevision, 'MEETING_ACTION_ITEM_CREATED', { $push: { actionItems: actionItem } }, { title, assignedToRef: actionItem.assignedToRef });
}

export async function updateActionItem(meetingId, actionItemId, payload = {}, inputContext = {}) {
  const context = contextValues(inputContext);
  const meeting = await loadMeeting(meetingId, context);
  const actionItem = meeting.actionItems.id(actionItemId);
  if (!actionItem) throw meetingError('Action item was not found.', 'MEETING_ACTION_ITEM_NOT_FOUND', 404);
  const isAssignedActor = actionItem.assignedToRef === context.actorId;
  const canManage = canManageMeeting(meeting, context.actorId, hasPermission(context.user, 'meetings:manage:any'));
  if (!isAssignedActor && !canManage) throw meetingError('You are not authorized to update this action item.', 'MEETING_PERMISSION_DENIED', 403);
  const status = String(payload.status || actionItem.status).toUpperCase();
  if (!['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'].includes(status)) throw meetingError('Unsupported action-item status.', 'MEETING_ACTION_ITEM_STATUS_INVALID', 422);
  const actionIndex = meeting.actionItems.findIndex((item) => String(item._id) === String(actionItemId));
  if (actionIndex < 0) throw meetingError('Action item was not found.', 'MEETING_ACTION_ITEM_NOT_FOUND', 404);
  const set = { [`actionItems.${actionIndex}.status`]: status };
  if (status === 'DONE') {
    set[`actionItems.${actionIndex}.completedAt`] = new Date();
    set[`actionItems.${actionIndex}.completedBy`] = context.actorId;
  }
  return updateWithRevision(meeting, context, payload.expectedRevision, 'MEETING_ACTION_ITEM_UPDATED', { $set: set }, { actionItemId, status });
}

export async function provisionVideoRoom(meetingId, payload = {}, inputContext = {}) {
  const context = contextValues(inputContext);
  const meeting = await loadMeeting(meetingId, context);
  assertCanManage(meeting, context);
  if (!['REMOTE', 'HYBRID'].includes(meeting.format)) throw meetingError('Video rooms are available only for remote or hybrid meetings.', 'VIDEO_ROOM_NOT_APPLICABLE', 422);
  if (!['SCHEDULED', 'IN_PROGRESS'].includes(meeting.status)) throw meetingError('Schedule the meeting before provisioning its video room.', 'VIDEO_MEETING_NOT_SCHEDULED', 409);
  if (meeting.videoRoom?.status === 'PROVISIONED' && meeting.videoRoom?.roomUrl) return present(meeting);
  const providerStatus = dailyProvider.status();
  if (!providerStatus.configured) throw meetingError('Video conferencing is unavailable because the Daily provider is not configured.', 'VIDEO_PROVIDER_NOT_CONFIGURED', 503);
  try {
    const room = await dailyProvider.ensureRoom({ meetingId: String(meeting._id), scheduledStart: meeting.scheduledStart, scheduledEnd: meeting.scheduledEnd });
    const result = await updateWithRevision(meeting, context, payload.expectedRevision ?? meeting.revision, 'MEETING_VIDEO_ROOM_PROVISIONED', {
      $set: { videoRoom: { provider: 'DAILY', status: 'PROVISIONED', roomName: room.roomName, roomUrl: room.roomUrl, provisionedAt: new Date(), lastErrorCode: null } },
    }, { provider: 'DAILY', status: 'PROVISIONED' });
    return result;
  } catch (error) {
    if (error?.statusCode) throw error;
    throw meetingError('The video room could not be provisioned.', 'VIDEO_PROVIDER_REQUEST_FAILED', 503);
  }
}

export async function getVideoJoinGrant(meetingId, inputContext = {}) {
  const context = contextValues(inputContext);
  const meeting = await loadMeeting(meetingId, context);
  assertCanRead(meeting, context);
  const isOrganizer = meeting.organizerId === context.actorId;
  const isInvitedParticipant = meeting.participants.some((participant) => participant.identityRef === context.actorId && participant.invitationStatus !== 'REMOVED' && participant.invitationStatus !== 'DECLINED');
  if (!isOrganizer && !isInvitedParticipant) throw meetingError('Only the organizer or an invited participant can join this meeting.', 'VIDEO_PARTICIPANT_REQUIRED', 403);
  if (!['SCHEDULED', 'IN_PROGRESS'].includes(meeting.status)) throw meetingError('This meeting is not open for remote participation.', 'VIDEO_MEETING_NOT_JOINABLE', 409);
  if (meeting.scheduledStart && Date.now() < new Date(meeting.scheduledStart).getTime() - 15 * 60 * 1000) {
    throw meetingError('Video access becomes available 15 minutes before the scheduled start.', 'VIDEO_MEETING_NOT_OPEN_YET', 409);
  }
  if (meeting.videoRoom?.provider !== 'DAILY' || meeting.videoRoom?.status !== 'PROVISIONED' || !meeting.videoRoom?.roomName || !meeting.videoRoom?.roomUrl) {
    throw meetingError('A video room has not been provisioned for this meeting.', 'VIDEO_ROOM_NOT_PROVISIONED', 503);
  }
  const displayName = context.user?.displayName || context.user?.fullName || context.user?.name || context.user?.username || 'TITech participant';
  const grant = await dailyProvider.createJoinToken({ roomName: meeting.videoRoom.roomName, actorId: context.actorId, displayName, isOwner: meeting.organizerId === context.actorId });
  await writeExternalAudit('MEETING_VIDEO_JOIN_GRANT_ISSUED', context, { meetingId: String(meeting._id), provider: 'DAILY', tokenExpiry: grant.expiresAt });
  return { provider: 'DAILY', roomUrl: meeting.videoRoom.roomUrl, token: grant.token, expiresAt: grant.expiresAt, meetingId: String(meeting._id) };
}

/**
 * Apply the single offline-safe meeting operation currently allowed: a minutes
 * draft. The update is atomic on the meeting document and operation ID, so a
 * lost acknowledgement can be retried without applying the edit twice.
 */
export async function applyOfflineMeetingDraft(event, inputContext = {}) {
  const context = contextValues(inputContext);
  const payload = event?.payload || {};
  if (event?.eventType !== 'MEETING_UPDATED' || payload.operation !== 'MINUTES_DRAFTED') {
    throw meetingError('This offline meeting operation is not supported.', 'MEETING_OFFLINE_OPERATION_UNSUPPORTED', 422);
  }
  const meetingId = normalizeRequiredText(payload.meetingId, 'meetingId', 128);
  const operationId = normalizeRequiredText(event.eventId, 'eventId', 128);
  if (typeof payload.minutes !== 'string' || payload.minutes.length > 50000) throw meetingError('Offline minutes payload is invalid.', 'MEETING_MINUTES_INVALID', 422);
  const meeting = await loadMeeting(meetingId, context, { includeAppliedOperations: true });
  if ((meeting.appliedOfflineOperationIds || []).includes(operationId)) {
    return { status: 'ALREADY_APPLIED', meetingId, revision: meeting.revision, operationId };
  }
  assertCanManage(meeting, context);
  if (meeting.minutes?.status === 'PUBLISHED') throw meetingError('Published minutes cannot be overwritten by an offline draft.', 'MEETING_MINUTES_ALREADY_PUBLISHED', 409);
  const expected = expectedRevision(payload.expectedRevision);
  if (meeting.revision !== expected) throw meetingError('Meeting revision changed while this device was offline. Keep the draft and resolve the conflict online.', 'MEETING_REVISION_CONFLICT', 409);
  const nextMinutes = {
    content: payload.minutes,
    status: payload.minutes.trim() ? 'DRAFT' : 'EMPTY',
    revision: Number(meeting.minutes?.revision || 0) + 1,
    updatedBy: context.actorId,
    updatedAt: new Date(),
    publishedAt: null,
    publishedBy: null,
  };
  const updated = await Meeting.findOneAndUpdate(
    { _id: meeting._id, tenantId: context.tenantId, revision: expected, appliedOfflineOperationIds: { $ne: operationId } },
    {
      $set: { minutes: nextMinutes, updatedBy: context.actorId },
      $inc: { revision: 1 },
      $addToSet: { appliedOfflineOperationIds: operationId },
      $push: { auditTrail: { $each: [safeAuditEntry('OFFLINE_MEETING_MINUTES_DRAFT_APPLIED', context, { operationId, provisional: true })], $slice: -100 } },
    },
    { new: true, runValidators: true },
  );
  if (!updated) {
    const refreshed = await Meeting.findOne({ _id: meeting._id, tenantId: context.tenantId }).select('+appliedOfflineOperationIds');
    if (refreshed?.appliedOfflineOperationIds?.includes(operationId)) return { status: 'ALREADY_APPLIED', meetingId, revision: refreshed.revision, operationId };
    throw meetingError('Meeting changed before the offline draft could be applied.', 'MEETING_REVISION_CONFLICT', 409);
  }
  await writeExternalAudit('OFFLINE_MEETING_MINUTES_DRAFT_APPLIED', context, { meetingId, operationId, revision: updated.revision, provisional: true });
  return { status: 'APPLIED', meetingId, revision: updated.revision, operationId, minutesStatus: updated.minutes.status };
}

export function getVideoProviderStatus() {
  return dailyProvider.status();
}

export default Object.freeze({
  listMeetings,
  createMeeting,
  getMeeting,
  updateMeeting,
  transitionMeeting,
  inviteParticipant,
  addAgendaItem,
  recordAttendance,
  saveMinutes,
  publishMinutes,
  recordDecision,
  addActionItem,
  updateActionItem,
  provisionVideoRoom,
  getVideoJoinGrant,
  applyOfflineMeetingDraft,
  getVideoProviderStatus,
});
