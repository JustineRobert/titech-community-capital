import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Clock3, LifeBuoy, LockKeyhole, Plus, RefreshCw, Send, ShieldAlert, Ticket, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../routes/PermissionRoute';
import { createPartnerCase, listPartnerCases, transitionPartnerCase } from '../services/partnerPortalApi';
import { getGuideChapter, PARTNER_GUIDE_CHAPTERS, PARTNER_HELP_DOTS } from '../help/partnerGuide';
import './PartnerPortal.css';

const STATUS_LABELS = Object.freeze({ OPEN: 'Open', IN_PROGRESS: 'In progress', PENDING_EXTERNAL: 'Pending external', RESOLVED: 'Resolved', CLOSED: 'Closed' });
const NEXT_STATUSES = Object.freeze({ OPEN: ['IN_PROGRESS', 'PENDING_EXTERNAL', 'RESOLVED'], IN_PROGRESS: ['PENDING_EXTERNAL', 'RESOLVED'], PENDING_EXTERNAL: ['IN_PROGRESS', 'RESOLVED'], RESOLVED: ['IN_PROGRESS', 'CLOSED'], CLOSED: [] });
const CASE_TYPES = Object.freeze([
  ['SUPPORT_REQUEST', 'General support'],
  ['TECHNICAL_ERROR', 'Technical error'],
  ['MESSAGING_ISSUE', 'Messaging issue'],
  ['OFFLINE_SYNC_ISSUE', 'Offline synchronization'],
  ['MEETING_ISSUE', 'Meetings issue'],
  ['ACCESS_ISSUE', 'Access or permissions'],
]);

function safeStorageGet(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function safeStorageSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* preferences are non-critical */ }
}
function humanDate(value) {
  if (!value) return 'Time not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time not recorded' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function errorText(error, fallback) {
  const apiError = error?.response?.data?.error;
  if (apiError?.code === 'SUPPORT_CASE_AUDIT_PENDING' && apiError?.committed) {
    const reference = apiError.resourceId ? ` Reference: ${apiError.resourceId}.` : '';
    return `The case was saved, but the audit record is pending.${reference} Do not resubmit; verify the case after audit service recovery.`;
  }
  return apiError?.message || error?.response?.data?.message || error?.message || fallback;
}

function HelpDot({ id, active, onToggle }) {
  const help = PARTNER_HELP_DOTS.find((item) => item.id === id);
  if (!help) return null;
  return (
    <span className="partner-help-dot-wrap">
      <button className="partner-help-dot" type="button" aria-label={`Help: ${help.title}`} aria-expanded={active} onClick={() => onToggle(active ? null : id)}>?</button>
      {active && <span className="partner-help-popover" role="status"><strong>{help.title}</strong><span>{help.text}</span></span>}
    </span>
  );
}

function UserGuide({ chapterNumber, setChapterNumber, onClose, helpDots, setHelpDots }) {
  const chapter = getGuideChapter(chapterNumber) || PARTNER_GUIDE_CHAPTERS[0];
  const dialogRef = useRef(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);
  const goTo = (next) => setChapterNumber(Math.min(7, Math.max(1, next)));
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key === 'Tab') {
      const focusable = [...(dialogRef.current?.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') || [])];
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); goTo(chapterNumber + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(chapterNumber - 1); }
  };
  return (
    <div className="partner-guide-backdrop" role="presentation">
      <section ref={dialogRef} tabIndex={-1} className="partner-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="partner-guide-title" onKeyDown={onKeyDown}>
        <header className="partner-guide-header">
          <div><span className="partner-eyebrow">User Guide Presentation</span><h2 id="partner-guide-title">Interactive slides to help you navigate and master your workspace dashboard.</h2><p>Help Dots {helpDots ? 'On' : 'Off'}</p></div>
          <button className="partner-icon-button" type="button" onClick={onClose} aria-label="Close user guide"><X size={20} /></button>
        </header>
        <div className="partner-guide-toolbar">
          <label htmlFor="partner-guide-chapter">Select Guide Chapter</label>
          <select id="partner-guide-chapter" value={chapterNumber} onChange={(event) => goTo(Number(event.target.value))}>
            {PARTNER_GUIDE_CHAPTERS.map((item) => <option key={item.id} value={item.number}>Chapter {item.number} — {item.title}</option>)}
          </select>
          <span className="partner-guide-progress" aria-live="polite">{chapter.number} / 7</span>
        </div>
        <div className="partner-guide-progress-track" role="progressbar" aria-label="Guide progress" aria-valuemin={1} aria-valuemax={7} aria-valuenow={chapter.number}><span style={{ width: `${(chapter.number / 7) * 100}%` }} /></div>
        <article className="partner-guide-content" aria-live="polite">
          <span className="partner-guide-chapter-label">Chapter {chapter.number}</span>
          <h3>{chapter.title}</h3><h4>{chapter.subtitle}</h4><p>{chapter.intro}</p>
          <div className="partner-guide-tips">
            {chapter.tips.map(([title, description]) => <section key={title}><strong>{title}</strong><p>{description}</p></section>)}
          </div>
          <p className="partner-guide-note"><ShieldAlert size={17} />{chapter.note}</p>
        </article>
        <footer className="partner-guide-footer">
          <label className="partner-switch"><input type="checkbox" checked={helpDots} onChange={(event) => setHelpDots(event.target.checked)} /><span>Help Dots On</span></label>
          <div className="partner-guide-actions">
            <button className="partner-button partner-button--secondary" type="button" onClick={() => goTo(chapterNumber - 1)} disabled={chapterNumber === 1}><ChevronLeft size={16} /> Previous</button>
            {chapterNumber < 7 ? <button className="partner-button" type="button" onClick={() => goTo(chapterNumber + 1)}>Next <ChevronRight size={16} /></button> : <button className="partner-button" type="button" onClick={onClose}><CheckCircle2 size={16} /> Return to dashboard</button>}
          </div>
        </footer>
      </section>
    </div>
  );
}

export default function PartnerPortal() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const userId = String(user?.id || user?._id || user?.userId || '');
  const preferencePrefix = userId ? `titech:partner-portal:${userId}` : null;
  const canReadCases = can('support:case:read');
  const canCreateCases = can('support:case:create');
  const canTransitionCases = can('support:case:transition');

  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(canReadCases);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeHelp, setActiveHelp] = useState(null);
  const [helpDots, setHelpDotsState] = useState(() => !preferencePrefix || safeStorageGet(`${preferencePrefix}:help-dots`) !== 'false');
  const [guideOpen, setGuideOpen] = useState(false);
  const [chapterNumber, setChapterNumber] = useState(1);
  const [caseStatusFilter, setCaseStatusFilter] = useState('');
  const [form, setForm] = useState({ type: 'SUPPORT_REQUEST', priority: 'MEDIUM', subject: '', description: '', memberId: '' });
  const [submitting, setSubmitting] = useState(false);
  const [transitioningId, setTransitioningId] = useState('');

  const setHelpDots = (enabled) => {
    setHelpDotsState(Boolean(enabled));
    if (preferencePrefix) safeStorageSet(`${preferencePrefix}:help-dots`, String(Boolean(enabled)));
  };

  const loadCases = useCallback(async ({ quiet = false } = {}) => {
    if (!canReadCases) { setLoading(false); return; }
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const result = await listPartnerCases({ limit: 75, status: caseStatusFilter || undefined });
      setCases(result);
    } catch (requestError) {
      setError(errorText(requestError, 'Support cases could not be loaded. Verify your permissions and connection.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canReadCases, caseStatusFilter]);

  useEffect(() => { void loadCases(); }, [loadCases]);

  useEffect(() => {
    if (!preferencePrefix || safeStorageGet(`${preferencePrefix}:guide-dismissed`) !== 'true') setGuideOpen(true);
  }, [preferencePrefix]);

  const dismissGuide = () => {
    setGuideOpen(false);
    if (preferencePrefix) safeStorageSet(`${preferencePrefix}:guide-dismissed`, 'true');
  };

  const counts = useMemo(() => cases.reduce((summary, item) => {
    const status = String(item.status || 'UNKNOWN').toUpperCase();
    summary.total += 1;
    if (status === 'OPEN' || status === 'IN_PROGRESS' || status === 'PENDING_EXTERNAL') summary.active += 1;
    if (status === 'RESOLVED' || status === 'CLOSED') summary.resolved += 1;
    return summary;
  }, { total: 0, active: 0, resolved: 0 }), [cases]);

  const createCase = async (event) => {
    event.preventDefault();
    if (!canCreateCases) return;
    setSubmitting(true); setError(''); setSuccess('');
    const diagnostics = form.type === 'TECHNICAL_ERROR' ? {
      applicationVersion: String(window.__TITECH_APP_INFO__?.version || ''),
      module: 'Partner Portal',
      route: window.location.pathname,
      timestamp: new Date().toISOString(),
    } : undefined;
    const linked = form.memberId.trim() ? { memberId: form.memberId.trim() } : {};
    try {
      const created = await createPartnerCase({ type: form.type, priority: form.priority, subject: form.subject, description: form.description, linked, diagnostics });
      const reference = created?._id || created?.id || created?.caseId || 'created';
      setSuccess(`Support case submitted. Reference: ${reference}`);
      setForm({ type: 'SUPPORT_REQUEST', priority: 'MEDIUM', subject: '', description: '', memberId: '' });
      await loadCases({ quiet: true });
    } catch (submitError) {
      setError(errorText(submitError, 'The support case was not confirmed by the server. Your form content remains available for retry.'));
    } finally { setSubmitting(false); }
  };

  const transitionCase = async (item, nextStatus) => {
    const id = String(item?._id || item?.id || '');
    if (!id || !canTransitionCases) return;
    setTransitioningId(id); setError(''); setSuccess('');
    try {
      await transitionPartnerCase(id, { status: nextStatus, note: `Updated by authorized support workflow to ${nextStatus}.` });
      setSuccess(`Case ${id} updated to ${STATUS_LABELS[nextStatus] || nextStatus}.`);
      await loadCases({ quiet: true });
    } catch (updateError) {
      setError(errorText(updateError, 'The case status was not confirmed by the server.'));
    } finally { setTransitioningId(''); }
  };

  return (
    <main className="partner-portal page-container" dir="auto" aria-labelledby="partner-portal-title">
      <header className="partner-portal-header">
        <div><span className="partner-eyebrow">TITech Community Capital · TITECH CAPITAL - SMC LTD</span><h1 id="partner-portal-title"><LifeBuoy size={28} /> Partner Support Workspace</h1><p>Authorized support cases, technical issue reporting and contextual onboarding.</p></div>
        <div className="partner-header-actions" id="partner-guide-launcher">
          <button className="partner-button partner-button--secondary" type="button" onClick={() => setGuideOpen(true)}><BookOpen size={17} /> User Guide</button>
          <label className="partner-switch partner-switch--header"><input type="checkbox" checked={helpDots} onChange={(event) => setHelpDots(event.target.checked)} /><span>Help Dots</span></label>
          {helpDots && <HelpDot id="guide-controls" active={activeHelp === 'guide-controls'} onToggle={setActiveHelp} />}
        </div>
      </header>

      {error && <div className="partner-alert partner-alert--error" role="alert"><AlertCircle size={18} />{error}</div>}
      {success && <div className="partner-alert partner-alert--success" role="status"><CheckCircle2 size={18} />{success}</div>}

      <section className="partner-metrics" aria-label="Support case summary">
        <article><span>Loaded cases</span><strong>{canReadCases ? counts.total : '—'}</strong><small>{canReadCases ? 'Returned by the tenant-scoped API' : 'Read permission required'}</small></article>
        <article><span>Active cases</span><strong>{canReadCases ? counts.active : '—'}</strong><small>Open, in progress or pending external</small></article>
        <article><span>Resolved / closed</span><strong>{canReadCases ? counts.resolved : '—'}</strong><small>Based on the loaded case page</small></article>
      </section>

      <section className="partner-panel" id="partner-capability-boundaries" aria-labelledby="partner-capabilities-title">
        <div className="partner-panel-heading"><div><h2 id="partner-capabilities-title">Support capabilities and integration status</h2><p>Only connected functionality is presented as available.</p></div>{helpDots && <HelpDot id="capability-boundaries" active={activeHelp === 'capability-boundaries'} onToggle={setActiveHelp} />}</div>
        <div className="partner-capability-grid">
          <article className="partner-capability partner-capability--available"><CheckCircle2 size={20} /><div><strong>Tenant-scoped support cases</strong><span>Connected to /api/v1/operations/cases; server permission and tenant checks apply.</span></div><b>CONNECTED</b></article>
          <article className="partner-capability"><LockKeyhole size={20} /><div><strong>Customer lookup and message history</strong><span>Partner-safe tenant/member/message history endpoints are not mounted in this archive. The platform-admin member directory is intentionally not reused.</span></div><b>NOT CONNECTED</b></article>
          <article className="partner-capability"><LockKeyhole size={20} /><div><strong>Customer account settings</strong><span>No partner-scoped settings inspection API was verified. Sensitive account fields remain unavailable.</span></div><b>NOT CONNECTED</b></article>
          <article className="partner-capability"><LockKeyhole size={20} /><div><strong>Messaging provider pathway status</strong><span>No provider-specific partner monitoring endpoint was verified. Application health is not treated as delivery evidence.</span></div><b>UNKNOWN</b></article>
        </div>
      </section>

      <div className="partner-workspace-grid">
        <section className="partner-panel" id="partner-case-list" aria-labelledby="partner-case-list-title">
          <div className="partner-panel-heading"><div><h2 id="partner-case-list-title"><Ticket size={20} /> Support cases</h2><p>Cases returned for your authenticated tenant context.</p></div><div className="partner-panel-actions">{helpDots && <HelpDot id="case-list" active={activeHelp === 'case-list'} onToggle={setActiveHelp} />}<button className="partner-icon-button" type="button" onClick={() => loadCases({ quiet: true })} disabled={refreshing || loading} aria-label="Refresh support cases"><RefreshCw size={17} className={refreshing ? 'partner-spin' : ''} /></button></div></div>
          <div className="partner-filter-row"><label htmlFor="partner-case-status">Filter status</label><select id="partner-case-status" value={caseStatusFilter} onChange={(event) => setCaseStatusFilter(event.target.value)}><option value="">All statuses</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          {!canReadCases ? <p className="partner-empty"><LockKeyhole size={20} /> Your account does not have support:case:read. Request the least-privilege permission from your administrator.</p> : loading ? <p className="partner-empty" role="status">Loading support cases…</p> : cases.length === 0 ? <p className="partner-empty">No cases were returned for this filter. This is not a platform-wide ticket count.</p> : <div className="partner-case-list">{cases.map((item) => {
            const id = String(item._id || item.id || '');
            const status = String(item.status || 'UNKNOWN').toUpperCase();
            return <article className="partner-case" key={id || `${item.subject}-${item.createdAt}`}>
              <div className="partner-case-top"><strong>{item.subject || 'Untitled support case'}</strong><span className={`partner-status partner-status--${status.toLowerCase()}`}>{STATUS_LABELS[status] || status}</span></div>
              <p>{item.description || 'No description recorded.'}</p>
              <div className="partner-case-meta"><span>{item.type || 'SUPPORT_REQUEST'}</span><span>{item.priority || 'Priority unavailable'}</span><span><Clock3 size={13} /> {humanDate(item.createdAt)}</span></div>
              {Array.isArray(item.events) && item.events.length > 0 && <details className="partner-case-events"><summary>Case history ({item.events.length} events)</summary><ol>{item.events.slice(-8).reverse().map((event, index) => <li key={`${event.type}-${event.occurredAt}-${index}`}><strong>{event.type}</strong><span>{humanDate(event.occurredAt)}</span>{event.note && <p>{event.note}</p>}</li>)}</ol></details>}
              {canTransitionCases && (NEXT_STATUSES[status] || []).length > 0 && <div className="partner-case-actions">{NEXT_STATUSES[status].map((nextStatus) => <button key={nextStatus} className="partner-button partner-button--small partner-button--secondary" type="button" disabled={transitioningId === id} onClick={() => transitionCase(item, nextStatus)}>{nextStatus === 'IN_PROGRESS' ? 'Start work' : nextStatus === 'PENDING_EXTERNAL' ? 'Request external support' : nextStatus === 'RESOLVED' ? 'Resolve' : 'Close'}</button>)}</div>}
            </article>;
          })}</div>}
        </section>

        <section className="partner-panel" id="partner-case-create" aria-labelledby="partner-case-create-title">
          <div className="partner-panel-heading"><div><h2 id="partner-case-create-title"><Plus size={20} /> Create a support case</h2><p>Submit a request or a sanitized technical error report.</p></div>{helpDots && <HelpDot id="case-create" active={activeHelp === 'case-create'} onToggle={setActiveHelp} />}</div>
          {!canCreateCases ? <p className="partner-empty"><LockKeyhole size={20} /> Your account does not have support:case:create.</p> : <form className="partner-case-form" onSubmit={createCase}>
            <label>Issue category<select value={form.type} onChange={(event) => setForm((old) => ({ ...old, type: event.target.value }))}>{CASE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Priority<select value={form.priority} onChange={(event) => setForm((old) => ({ ...old, priority: event.target.value }))}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></label>
            <label>Subject<input required minLength={5} maxLength={300} value={form.subject} onChange={(event) => setForm((old) => ({ ...old, subject: event.target.value }))} placeholder="Briefly describe the issue" /></label>
            <label>Related member reference (optional)<input maxLength={128} value={form.memberId} onChange={(event) => setForm((old) => ({ ...old, memberId: event.target.value }))} placeholder="Use an approved reference only" /></label>
            <label className="partner-field--wide">Description<textarea required minLength={10} maxLength={9000} rows={6} value={form.description} onChange={(event) => setForm((old) => ({ ...old, description: event.target.value }))} placeholder="What happened? Include the affected module and steps to reproduce." /></label>
            {form.type === 'TECHNICAL_ERROR' && <p className="partner-diagnostic-note"><ShieldAlert size={16} /> A small allowlisted diagnostic context (app version, module, route path and timestamp) will be added. No tokens, cookies, passwords, OTPs, PINs, request bodies or browser fingerprint are collected.</p>}
            <button className="partner-button partner-submit" type="submit" disabled={submitting}><Send size={16} /> {submitting ? 'Submitting…' : 'Submit support case'}</button>
          </form>}
        </section>
      </div>

      <footer className="partner-portal-footer"><span><ShieldAlert size={16} /> Support communications are not financial instructions and cannot authorize ledger or payment changes.</span><span>BUILD LESS. PROVE MORE.</span></footer>
      {guideOpen && <UserGuide chapterNumber={chapterNumber} setChapterNumber={setChapterNumber} onClose={dismissGuide} helpDots={helpDots} setHelpDots={setHelpDots} />}
    </main>
  );
}
