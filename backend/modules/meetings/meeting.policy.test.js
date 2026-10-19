import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTransition,
  canManageMeeting,
  canReadMeeting,
  expectedRevision,
  normalizeRequiredText,
  parseDate,
} from './meeting.policy.js';

test('meeting lifecycle rejects illegal transitions and requires scheduling fields', () => {
  assert.throws(() => assertTransition('DRAFT', 'IN_PROGRESS'), { code: 'MEETING_INVALID_STATE_TRANSITION' });
  assert.throws(() => assertTransition('DRAFT', 'SCHEDULED'), { code: 'MEETING_SCHEDULE_TIME_REQUIRED' });
  assert.throws(() => assertTransition('DRAFT', 'SCHEDULED', {
    scheduledStart: '2026-10-20T10:00:00Z', scheduledEnd: '2026-10-20T09:00:00Z', format: 'REMOTE',
  }), { code: 'MEETING_INVALID_TIME_RANGE' });
  assert.throws(() => assertTransition('DRAFT', 'SCHEDULED', {
    scheduledStart: '2026-10-20T10:00:00Z', scheduledEnd: '2026-10-20T11:00:00Z', format: 'HYBRID', venue: '',
  }), { code: 'MEETING_VENUE_REQUIRED' });
  assert.equal(assertTransition('DRAFT', 'SCHEDULED', {
    scheduledStart: '2026-10-20T10:00:00Z', scheduledEnd: '2026-10-20T11:00:00Z', format: 'REMOTE',
  }), true);
});

test('cancellation requires a reason and terminal state cannot reopen', () => {
  assert.throws(() => assertTransition('SCHEDULED', 'CANCELLED'), { code: 'MEETING_CANCELLATION_REASON_REQUIRED' });
  assert.throws(() => assertTransition('COMPLETED', 'SCHEDULED'), { code: 'MEETING_INVALID_STATE_TRANSITION' });
});

test('access policy scopes records to organizer or invited participants', () => {
  const meeting = { organizerId: 'organizer-1', participants: [{ identityRef: 'member-1', invitationStatus: 'INVITED' }] };
  assert.equal(canReadMeeting(meeting, 'organizer-1'), true);
  assert.equal(canReadMeeting(meeting, 'member-1'), true);
  assert.equal(canReadMeeting(meeting, 'stranger'), false);
  assert.equal(canReadMeeting(meeting, 'stranger', true), true);
  assert.equal(canManageMeeting(meeting, 'organizer-1'), true);
  assert.equal(canManageMeeting(meeting, 'member-1'), false);
  assert.equal(canManageMeeting(meeting, 'member-1', true), true);
});

test('validation helpers reject malformed dates and unbounded text', () => {
  assert.throws(() => normalizeRequiredText('  ', 'title'), { code: 'MEETING_VALIDATION_ERROR' });
  assert.throws(() => normalizeRequiredText('x'.repeat(201), 'title', 200), { code: 'MEETING_VALIDATION_ERROR' });
  assert.throws(() => parseDate('not-a-date', 'startsAt'), { code: 'MEETING_VALIDATION_ERROR' });
  assert.equal(parseDate('', 'startsAt', { optional: true }), null);
  assert.equal(expectedRevision('4'), 4);
  assert.throws(() => expectedRevision(0), { code: 'MEETING_REVISION_REQUIRED' });
});
