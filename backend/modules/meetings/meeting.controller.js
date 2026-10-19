import * as service from './meeting.service.js';

function contextFromRequest(req) {
  return {
    tenantId: req.tenantContext?.tenantId || req.tenant?.tenantId || req.tenantId || req.user?.tenantId || req.user?.tenant?.tenantId,
    actorId: req.user?.id || req.user?._id || req.user?.userId || req.auth?.userId,
    user: req.user || req.auth?.user || null,
    requestId: req.requestId || req.id || null,
    correlationId: req.correlationId || req.requestId || req.id || null,
  };
}

function sendError(res, req, error) {
  const statusCode = Number(error?.statusCode) || 500;
  return res.status(statusCode).json({
    success: false,
    error: {
      code: error?.code || 'MEETING_OPERATION_FAILED',
      message: statusCode < 500 ? error.message : 'Meeting service is temporarily unavailable.',
    },
    requestId: req.requestId || req.id || null,
    correlationId: req.correlationId || req.requestId || req.id || null,
  });
}

function handler(operation, statusCode = 200, argumentBuilder = (req) => [req.params.meetingId, req.body || {}, contextFromRequest(req)]) {
  return async (req, res) => {
    try {
      const result = await service[operation](...argumentBuilder(req));
      return res.status(statusCode).json({ success: true, data: result, requestId: req.requestId || req.id || null, correlationId: req.correlationId || req.requestId || req.id || null });
    } catch (error) {
      return sendError(res, req, error);
    }
  };
}

export const listMeetings = handler('listMeetings', 200, (req) => [req.query || {}, contextFromRequest(req)]);
export const createMeeting = handler('createMeeting', 201, (req) => [req.body || {}, contextFromRequest(req)]);
export const getMeeting = handler('getMeeting');
export const updateMeeting = handler('updateMeeting');
export const transitionMeeting = handler('transitionMeeting');
export const inviteParticipant = handler('inviteParticipant');
export const addAgendaItem = handler('addAgendaItem');
export const recordAttendance = handler('recordAttendance');
export const saveMinutes = handler('saveMinutes', 200);
export const publishMinutes = handler('publishMinutes');
export const recordDecision = handler('recordDecision');
export const addActionItem = handler('addActionItem');
export const updateActionItem = handler('updateActionItem', 200, (req) => [req.params.meetingId, req.params.actionItemId, req.body || {}, contextFromRequest(req)]);
export const provisionVideoRoom = handler('provisionVideoRoom');
export const joinVideo = handler('getVideoJoinGrant', 200, (req) => [req.params.meetingId, contextFromRequest(req)]);

export async function videoProviderStatus(req, res) {
  try {
    const result = service.getVideoProviderStatus();
    return res.status(200).json({ success: true, data: result, requestId: req.requestId || req.id || null });
  } catch (error) { return sendError(res, req, error); }
}
