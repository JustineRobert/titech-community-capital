import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, CircleAlert, Clock3, Link2, LoaderCircle, MapPin, Plus, RefreshCw, Save, ShieldAlert, Video } from 'lucide-react';
import { toast } from 'react-toastify';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nProvider';
import api, { generateIdempotencyKey, getDeviceId, getTenant } from '../../services/api';
import { createOfflineEvent, enqueueOfflineEvent, listOfflineEvents } from '../../offline/browserOutbox';
import './Meetings.css';

const API = '/api/v1/meetings';
const STATUS_LABELS = {
  DRAFT: 'Draft', SCHEDULED: 'Scheduled', IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
const MEETING_TYPES = [
  'COMMUNITY', 'SAVINGS_GROUP', 'SACCO', 'COOPERATIVE', 'ASSOCIATION',
  'EMPLOYER', 'PENSIONER_GROUP', 'INSURANCE_ORGANIZATION', 'CORPORATE', 'OTHER',
];

function errorMessage(error, fallback) {
  return error?.response?.data?.error?.message || error?.message || fallback;
}
function unwrap(response) {
  return response?.data?.data ?? response?.data ?? {};
}
function dateLabel(value, locale) {
  if (!value) return 'Not scheduled';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Invalid date' : new Intl.DateTimeFormat(locale || 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

export default function Meetings() {
  const { user } = useAuth();
  const { t, locale, direction } = useI18n();
  const [meetings, setMeetings] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [providerStatus, setProviderStatus] = useState({ status: 'CHECKING', configured: false });
  const [localEvents, setLocalEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [offlineConsent, setOfflineConsent] = useState(false);
  const [form, setForm] = useState({ title: '', purpose: '', meetingType: 'COMMUNITY', format: 'IN_PERSON', scheduledStart: '', scheduledEnd: '', venue: '' });
  const [participantRef, setParticipantRef] = useState('');
  const [agendaTitle, setAgendaTitle] = useState('');
  const [minutes, setMinutes] = useState('');
  const [decisionTitle, setDecisionTitle] = useState('');
  const [actionTitle, setActionTitle] = useState('');
  const [actionAssignee, setActionAssignee] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [joinGrant, setJoinGrant] = useState(null);

  const selected = useMemo(() => meetings.find((meeting) => meeting.id === selectedId) || null, [meetings, selectedId]);
  const currentUserId = String(user?.id || user?._id || user?.userId || '');

  const refreshLocalEvents = useCallback(async () => {
    try {
      const events = await listOfflineEvents({ limit: 100 });
      const tenant = String(getTenant() || '');
      const actor = currentUserId;
      setLocalEvents(events.filter((event) => event.eventType === 'MEETING_UPDATED' && event.tenantId === tenant && (!event.userId || event.userId === actor)));
    } catch {
      setLocalEvents([]);
    }
  }, [currentUserId]);

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: 50 };
      if (statusFilter) params.status = statusFilter;
      const [meetingResponse, providerResponse] = await Promise.all([
        api.get(API, { params }),
        api.get(`${API}/provider/status`).catch(() => null),
      ]);
      const data = unwrap(meetingResponse);
      const items = Array.isArray(data.items) ? data.items : [];
      setMeetings(items);
      setSelectedId((prior) => items.some((item) => item.id === prior) ? prior : (items[0]?.id || ''));
      if (providerResponse) setProviderStatus(unwrap(providerResponse));
      else setProviderStatus({ status: 'UNAVAILABLE', configured: false });
    } catch (loadError) {
      setError(errorMessage(loadError, 'Meetings could not be loaded. Check your connection and access permissions.'));
    } finally {
      setLoading(false);
    }
    await refreshLocalEvents();
  }, [statusFilter, refreshLocalEvents]);

  useEffect(() => { loadMeetings(); }, [loadMeetings]);

  useEffect(() => {
    if (!selected) {
      setMinutes('');
      return;
    }
    setMinutes(selected.minutes?.content || '');
    setJoinGrant(null);
  }, [selectedId]);

  const patchForm = (name, value) => setForm((old) => ({ ...old, [name]: value }));

  async function createMeeting(event) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        scheduledStart: form.scheduledStart ? new Date(form.scheduledStart).toISOString() : null,
        scheduledEnd: form.scheduledEnd ? new Date(form.scheduledEnd).toISOString() : null,
      };
      const response = await api.post(API, payload, { headers: { 'Idempotency-Key': generateIdempotencyKey() } });
      const created = unwrap(response);
      setForm({ title: '', purpose: '', meetingType: 'COMMUNITY', format: 'IN_PERSON', scheduledStart: '', scheduledEnd: '', venue: '' });
      await loadMeetings();
      if (created.id) setSelectedId(created.id);
      toast.success('Meeting draft created in TITech.');
    } catch (createError) {
      setError(errorMessage(createError, 'Meeting could not be created.'));
    } finally { setSaving(false); }
  }

  async function changeStatus(status) {
    if (!selected) return;
    const payload = { status, expectedRevision: selected.revision };
    if (status === 'CANCELLED') payload.cancellationReason = cancelReason;
    setSaving(true); setError('');
    try {
      await api.post(`${API}/${selected.id}/transition`, payload);
      setCancelReason(''); await loadMeetings(); toast.success(`Meeting is now ${STATUS_LABELS[status]}.`);
    } catch (operationError) { setError(errorMessage(operationError, 'Meeting status was not changed. Reload and resolve any revision conflict.')); }
    finally { setSaving(false); }
  }

  async function inviteParticipant(event) {
    event.preventDefault(); if (!selected) return;
    setSaving(true); setError('');
    try {
      await api.post(`${API}/${selected.id}/participants`, { identityRef: participantRef.trim(), identityType: 'USER', participationMode: selected.format === 'IN_PERSON' ? 'IN_PERSON' : 'REMOTE', expectedRevision: selected.revision });
      setParticipantRef(''); await loadMeetings(); toast.success('Invitation recorded.');
    } catch (operationError) { setError(errorMessage(operationError, 'Invitation could not be recorded.')); }
    finally { setSaving(false); }
  }

  async function addAgenda(event) {
    event.preventDefault(); if (!selected) return;
    setSaving(true); setError('');
    try {
      await api.post(`${API}/${selected.id}/agenda`, { title: agendaTitle.trim(), expectedRevision: selected.revision });
      setAgendaTitle(''); await loadMeetings(); toast.success('Agenda item added.');
    } catch (operationError) { setError(errorMessage(operationError, 'Agenda item could not be added.')); }
    finally { setSaving(false); }
  }

  async function saveMinutesOnline() {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      await api.put(`${API}/${selected.id}/minutes`, { content: minutes, expectedRevision: selected.revision });
      await loadMeetings(); toast.success('Minutes draft saved to TITech.');
    } catch (operationError) { setError(errorMessage(operationError, 'Minutes were not confirmed by the server. Use the separate local-draft action only on a trusted device.')); }
    finally { setSaving(false); }
  }

  async function saveMinutesLocally() {
    if (!selected) return;
    if (!offlineConsent) {
      setError('Confirm the local-storage notice before saving minutes on this device.');
      return;
    }
    setSaving(true); setError('');
    try {
      const tenantId = String(getTenant() || '');
      const deviceId = String(getDeviceId() || '');
      if (!tenantId || !deviceId || !currentUserId) throw new Error('A current tenant, authenticated user and registered browser device context are required.');
      const event = await createOfflineEvent({
        eventType: 'MEETING_UPDATED',
        payload: { operation: 'MINUTES_DRAFTED', meetingId: selected.id, expectedRevision: selected.revision, minutes },
        tenantId,
        deviceId,
        userId: currentUserId,
        aggregateType: 'MEETING',
        aggregateId: selected.id,
        idempotencyKey: generateIdempotencyKey(),
      });
      await enqueueOfflineEvent(event);
      await refreshLocalEvents();
      setOfflineConsent(false);
      toast.info('Saved on this device. TITech server acceptance is still pending.');
    } catch (localError) {
      setError(errorMessage(localError, 'The browser could not durably save this draft. It has not been marked saved.'));
    } finally { setSaving(false); }
  }

  async function recordMyAttendance() {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      await api.post(`${API}/${selected.id}/attendance`, { expectedRevision: selected.revision, participationMode: selected.format === 'IN_PERSON' ? 'IN_PERSON' : 'REMOTE' });
      await loadMeetings(); toast.info('Attendance recorded as provisional; this does not independently verify identity or physical presence.');
    } catch (operationError) { setError(errorMessage(operationError, 'Attendance could not be recorded.')); }
    finally { setSaving(false); }
  }

  async function addDecision(event) {
    event.preventDefault(); if (!selected) return;
    setSaving(true); setError('');
    try {
      await api.post(`${API}/${selected.id}/decisions`, { title: decisionTitle.trim(), expectedRevision: selected.revision });
      setDecisionTitle(''); await loadMeetings(); toast.success('Decision recorded; voting/quorum validity is not inferred.');
    } catch (operationError) { setError(errorMessage(operationError, 'Decision could not be recorded.')); }
    finally { setSaving(false); }
  }

  async function addActionItem(event) {
    event.preventDefault(); if (!selected) return;
    setSaving(true); setError('');
    try {
      await api.post(`${API}/${selected.id}/action-items`, { title: actionTitle.trim(), assignedToRef: actionAssignee.trim() || null, expectedRevision: selected.revision });
      setActionTitle(''); setActionAssignee(''); await loadMeetings(); toast.success('Action item added.');
    } catch (operationError) { setError(errorMessage(operationError, 'Action item could not be added.')); }
    finally { setSaving(false); }
  }

  async function provisionVideo() {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      await api.post(`${API}/${selected.id}/video-room`, { expectedRevision: selected.revision });
      await loadMeetings(); toast.success('Video room provisioned by the configured provider.');
    } catch (operationError) { setError(errorMessage(operationError, 'Video room is not available. Provider configuration and authorization may be incomplete.')); }
    finally { setSaving(false); }
  }

  async function requestVideoJoin() {
    if (!selected) return;
    setSaving(true); setError(''); setJoinGrant(null);
    try {
      const response = await api.post(`${API}/${selected.id}/video-join`, {});
      const grant = unwrap(response);
      setJoinGrant(grant);
      // Keep the short-lived grant only in component memory. The rendered link
      // is opened by a separate user click, avoiding popup-blocker race issues.
      // The provider's prebuilt token-URL behavior still needs sandbox verification.
    } catch (operationError) { setError(errorMessage(operationError, 'A video join grant could not be issued.')); }
    finally { setSaving(false); }
  }

  const localDraftCount = localEvents.filter((event) => event.status === 'PENDING' || event.status === 'FAILED').length;
  const joinUrl = useMemo(() => {
    if (!joinGrant?.roomUrl || !joinGrant?.token) return '';
    try { const url = new URL(joinGrant.roomUrl); url.searchParams.set('t', joinGrant.token); return url.toString(); } catch { return ''; }
  }, [joinGrant]);

  return (
    <main className="titech-meetings page-container" dir={direction} aria-labelledby="meetings-title">
      <header className="meetings-header">
        <div className="meetings-heading">
          <span className="meetings-eyebrow">TITech Capital LTD · TITech Community Capital</span>
          <h1 id="meetings-title"><CalendarDays aria-hidden="true" /> {t('meetings.title')}</h1>
          <p>{t('meetings.subtitle')}</p>
        </div>
        <button className="meetings-button meetings-button--secondary" type="button" onClick={loadMeetings} disabled={loading || saving}><RefreshCw size={17} /> {t('meetings.refresh')}</button>
      </header>

      <aside className="meetings-notice" role="note">
        <ShieldAlert aria-hidden="true" />
        <div><strong>{t('meetings.safetyTitle')}</strong><p>{t('meetings.safetyBody')}</p></div>
      </aside>

      {error && <div className="meetings-alert" role="alert"><CircleAlert aria-hidden="true" /><span>{error}</span></div>}

      <section className="meetings-create-panel" aria-labelledby="create-meeting-title">
        <h2 id="create-meeting-title"><Plus size={18} /> {t('meetings.createHeading')}</h2>
        <form className="meetings-form meetings-form--create" onSubmit={createMeeting}>
          <label>{t('meetings.titleField')}<input required minLength={3} maxLength={200} value={form.title} onChange={(event) => patchForm('title', event.target.value)} /></label>
          <label>{t('meetings.type')}<select value={form.meetingType} onChange={(event) => patchForm('meetingType', event.target.value)}>{MEETING_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select></label>
          <label>{t('meetings.format')}<select value={form.format} onChange={(event) => patchForm('format', event.target.value)}><option value="IN_PERSON">{t('meetings.inPerson')}</option><option value="REMOTE">{t('meetings.remote')}</option><option value="HYBRID">{t('meetings.hybrid')}</option></select></label>
          <label>{t('meetings.startsAt')}<input type="datetime-local" value={form.scheduledStart} onChange={(event) => patchForm('scheduledStart', event.target.value)} /></label>
          <label>{t('meetings.endsAt')}<input type="datetime-local" value={form.scheduledEnd} onChange={(event) => patchForm('scheduledEnd', event.target.value)} /></label>
          {(form.format === 'IN_PERSON' || form.format === 'HYBRID') && <label>{t('meetings.venue')}<input maxLength={300} value={form.venue} onChange={(event) => patchForm('venue', event.target.value)} /></label>}
          <label className="meetings-field--wide">{t('meetings.purpose')}<textarea maxLength={4000} rows={2} value={form.purpose} onChange={(event) => patchForm('purpose', event.target.value)} /></label>
          <div className="meetings-form__actions"><button className="meetings-button" type="submit" disabled={saving}><Plus size={16} /> {saving ? t('meetings.saving') : t('meetings.createDraft')}</button></div>
        </form>
      </section>

      <div className="meetings-layout">
        <section className="meetings-list-panel" aria-labelledby="meeting-list-title">
          <div className="meetings-section-heading"><h2 id="meeting-list-title">{t('meetings.yourMeetings')}</h2><select aria-label={t('meetings.filterByStatus')} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">{t('meetings.allStatuses')}</option>{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
          {loading ? <p className="meetings-muted"><LoaderCircle className="spin" size={18} /> {t('meetings.loading')}</p> : meetings.length === 0 ? <div className="meetings-empty"><CalendarDays size={28} /><p>{t('meetings.empty')}</p></div> : <div className="meetings-list">{meetings.map((meeting) => <button key={meeting.id} type="button" onClick={() => setSelectedId(meeting.id)} className={`meeting-list-item ${selectedId === meeting.id ? 'is-selected' : ''}`} aria-pressed={selectedId === meeting.id}><span className={`meeting-status status-${meeting.status.toLowerCase()}`}>{STATUS_LABELS[meeting.status] || meeting.status}</span><strong>{meeting.title}</strong><span className="meeting-list-item__meta"><Clock3 size={14} /> {dateLabel(meeting.scheduledStart, locale)}</span><span className="meeting-list-item__meta">{meeting.meetingType.replaceAll('_', ' ')} · {meeting.format.replaceAll('_', ' ')}</span></button>)}</div>}
          <div className="meetings-offline-status" role="status"><strong>{t('meetings.localDrafts')}: {localDraftCount}</strong><span>{t('meetings.localDraftNote')}</span></div>
        </section>

        <section className="meeting-detail-panel" aria-labelledby="meeting-detail-title">
          {!selected ? <div className="meetings-empty"><CalendarDays size={28} /><p>{t('meetings.selectMeeting')}</p></div> : <>
            <div className="meeting-detail-header"><div><span className={`meeting-status status-${selected.status.toLowerCase()}`}>{STATUS_LABELS[selected.status] || selected.status}</span><h2 id="meeting-detail-title">{selected.title}</h2><p>{selected.purpose || t('meetings.noPurpose')}</p></div><span className="meeting-revision">r{selected.revision}</span></div>
            <div className="meeting-facts"><span><Clock3 size={15} /> {dateLabel(selected.scheduledStart, locale)} – {dateLabel(selected.scheduledEnd, locale)}</span>{selected.venue && <span><MapPin size={15} /> {selected.venue}</span>}<span>{selected.format.replaceAll('_', ' ')}</span><span>{selected.participants?.length || 0} {t('meetings.participants')}</span></div>
            <div className="meeting-actions">
              {selected.status === 'DRAFT' && <button className="meetings-button" disabled={saving} onClick={() => changeStatus('SCHEDULED')} type="button">{t('meetings.schedule')}</button>}
              {selected.status === 'SCHEDULED' && <button className="meetings-button" disabled={saving} onClick={() => changeStatus('IN_PROGRESS')} type="button">{t('meetings.start')}</button>}
              {selected.status === 'IN_PROGRESS' && <button className="meetings-button" disabled={saving} onClick={() => changeStatus('COMPLETED')} type="button">{t('meetings.complete')}</button>}
              {!['COMPLETED', 'CANCELLED'].includes(selected.status) && <div className="meeting-cancel-control"><input aria-label={t('meetings.cancelReason')} placeholder={t('meetings.cancelReason')} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={1000} /><button className="meetings-button meetings-button--danger" disabled={saving || !cancelReason.trim()} onClick={() => changeStatus('CANCELLED')} type="button">{t('meetings.cancel')}</button></div>}
            </div>

            <section className="meeting-detail-section"><h3>{t('meetings.participants')}</h3><ul className="meeting-detail-list">{(selected.participants || []).map((participant) => <li key={`${participant.identityRef}-${participant.participantRole}`}><span>{participant.identityRef}</span><small>{participant.invitationStatus} · {participant.participationMode}</small></li>)}</ul><form className="meeting-inline-form" onSubmit={inviteParticipant}><input required aria-label={t('meetings.participantIdentity')} placeholder={t('meetings.participantIdentity')} value={participantRef} onChange={(event) => setParticipantRef(event.target.value)} maxLength={128} /><button className="meetings-button meetings-button--secondary" disabled={saving} type="submit">{t('meetings.invite')}</button></form><button className="meetings-button meetings-button--secondary" disabled={saving || !['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'].includes(selected.status)} type="button" onClick={recordMyAttendance}><Check size={15} /> {t('meetings.recordAttendance')}</button><p className="meetings-help">{t('meetings.attendanceNotice')}</p></section>

            <section className="meeting-detail-section"><h3>{t('meetings.agenda')}</h3>{(selected.agendaItems || []).length === 0 ? <p className="meetings-muted">{t('meetings.noAgenda')}</p> : <ol className="meeting-detail-list">{selected.agendaItems.map((item) => <li key={item.id || `${item.sequence}-${item.title}`}><span>{item.title}</span><small>{item.status}</small></li>)}</ol>}<form className="meeting-inline-form" onSubmit={addAgenda}><input required maxLength={200} aria-label={t('meetings.agendaTitle')} placeholder={t('meetings.agendaTitle')} value={agendaTitle} onChange={(event) => setAgendaTitle(event.target.value)} /><button className="meetings-button meetings-button--secondary" disabled={saving} type="submit">{t('meetings.addItem')}</button></form></section>

            <section className="meeting-detail-section"><h3>{t('meetings.minutes')}</h3><textarea className="meeting-minutes-editor" rows={6} maxLength={50000} aria-label={t('meetings.minutes')} value={minutes} onChange={(event) => setMinutes(event.target.value)} placeholder={t('meetings.minutesPlaceholder')} /><div className="meeting-actions"><button className="meetings-button" disabled={saving || selected.minutes?.status === 'PUBLISHED'} type="button" onClick={saveMinutesOnline}><Save size={15} /> {t('meetings.saveServer')}</button><button className="meetings-button meetings-button--secondary" disabled={saving || selected.minutes?.status === 'PUBLISHED'} type="button" onClick={saveMinutesLocally}><Save size={15} /> {t('meetings.saveLocal')}</button></div><label className="meeting-consent"><input type="checkbox" checked={offlineConsent} onChange={(event) => setOfflineConsent(event.target.checked)} />{t('meetings.localConsent')}</label><p className="meetings-help">{t('meetings.minutesState')}: {selected.minutes?.status || 'EMPTY'}. {t('meetings.localDataWarning')}</p>{(localEvents.filter((event) => event.aggregateId === selected.id)).map((event) => <div className="meetings-local-event" key={event.eventId}><CircleAlert size={15} /><span>{t('meetings.localPending')} · {new Date(event.createdAt).toLocaleString(locale)}</span></div>)}</section>

            <section className="meeting-detail-section"><h3>{t('meetings.decisions')}</h3>{(selected.decisions || []).length === 0 ? <p className="meetings-muted">{t('meetings.noDecisions')}</p> : <ul className="meeting-detail-list">{selected.decisions.map((decision, index) => <li key={decision.id || `${index}-${decision.title}`}><span>{decision.title}</span><small>{decision.status}</small></li>)}</ul>}<form className="meeting-inline-form" onSubmit={addDecision}><input required maxLength={240} aria-label={t('meetings.decisionTitle')} placeholder={t('meetings.decisionTitle')} value={decisionTitle} onChange={(event) => setDecisionTitle(event.target.value)} /><button className="meetings-button meetings-button--secondary" disabled={saving} type="submit">{t('meetings.recordDecision')}</button></form><p className="meetings-help">{t('meetings.decisionNotice')}</p></section>

            <section className="meeting-detail-section"><h3>{t('meetings.actionItems')}</h3>{(selected.actionItems || []).length === 0 ? <p className="meetings-muted">{t('meetings.noActionItems')}</p> : <ul className="meeting-detail-list">{selected.actionItems.map((item, index) => <li key={item.id || `${index}-${item.title}`}><span>{item.title}</span><small>{item.status}{item.assignedToRef ? ` · ${item.assignedToRef}` : ''}</small></li>)}</ul>}<form className="meeting-inline-form meeting-inline-form--wrap" onSubmit={addActionItem}><input required maxLength={240} aria-label={t('meetings.actionTitle')} placeholder={t('meetings.actionTitle')} value={actionTitle} onChange={(event) => setActionTitle(event.target.value)} /><input maxLength={128} aria-label={t('meetings.assignedTo')} placeholder={t('meetings.assignedTo')} value={actionAssignee} onChange={(event) => setActionAssignee(event.target.value)} /><button className="meetings-button meetings-button--secondary" disabled={saving} type="submit">{t('meetings.addAction')}</button></form></section>

            {['REMOTE', 'HYBRID'].includes(selected.format) && <section className="meeting-detail-section"><h3><Video size={17} /> {t('meetings.video')}</h3><p className="meetings-help">{t('meetings.videoState')}: {providerStatus.configured ? providerStatus.status : t('meetings.videoUnavailable')}</p>{selected.videoRoom?.status === 'PROVISIONED' ? <button className="meetings-button" type="button" disabled={saving} onClick={requestVideoJoin}><Video size={16} /> {t('meetings.joinVideo')}</button> : <button className="meetings-button" type="button" disabled={saving || !providerStatus.configured || !['SCHEDULED', 'IN_PROGRESS'].includes(selected.status)} onClick={provisionVideo}><Video size={16} /> {t('meetings.provisionVideo')}</button>}{joinGrant && <p className="meetings-help" role="status"><Link2 size={14} /> {t('meetings.tokenIssued')} {joinGrant.expiresAt}. {joinUrl && <a href={joinUrl} target="_blank" rel="noopener noreferrer">{t('meetings.openVideo')}</a>}</p>}</section>}
          </>}
        </section>
      </div>

      <footer className="meetings-footer"><span><ShieldAlert size={15} /> {t('meetings.financialBoundary')}</span><span><CalendarDays size={15} /> {t('meetings.timezoneNote')}</span></footer>
    </main>
  );
}
