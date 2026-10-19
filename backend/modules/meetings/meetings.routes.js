/** Authenticated route contract for TITech meeting management. */
import express from 'express';
import { requirePermission } from '../../middleware/platformPermissions.js';
import {
  addActionItem,
  addAgendaItem,
  createMeeting,
  getMeeting,
  inviteParticipant,
  joinVideo,
  listMeetings,
  provisionVideoRoom,
  publishMinutes,
  recordAttendance,
  recordDecision,
  saveMinutes,
  transitionMeeting,
  updateActionItem,
  updateMeeting,
  videoProviderStatus,
} from './meeting.controller.js';

const router = express.Router();

router.get('/provider/status', requirePermission('meetings:read'), videoProviderStatus);
router.get('/', requirePermission('meetings:read'), listMeetings);
router.post('/', requirePermission('meetings:create'), createMeeting);
router.get('/:meetingId', requirePermission('meetings:read'), getMeeting);
router.patch('/:meetingId', requirePermission('meetings:write'), updateMeeting);
router.post('/:meetingId/transition', requirePermission('meetings:write'), transitionMeeting);
router.post('/:meetingId/participants', requirePermission('meetings:write'), inviteParticipant);
router.post('/:meetingId/agenda', requirePermission('meetings:write'), addAgendaItem);
router.post('/:meetingId/attendance', requirePermission('meetings:attendance:record'), recordAttendance);
router.put('/:meetingId/minutes', requirePermission('meetings:minutes:write'), saveMinutes);
router.post('/:meetingId/minutes/publish', requirePermission('meetings:minutes:publish'), publishMinutes);
router.post('/:meetingId/decisions', requirePermission('meetings:decision:record'), recordDecision);
router.post('/:meetingId/action-items', requirePermission('meetings:action-item:write'), addActionItem);
router.patch('/:meetingId/action-items/:actionItemId', requirePermission('meetings:action-item:write'), updateActionItem);
router.post('/:meetingId/video-room', requirePermission('meetings:video:manage'), provisionVideoRoom);
router.post('/:meetingId/video-join', requirePermission('meetings:video:join'), joinVideo);

export default router;
