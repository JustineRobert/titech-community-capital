'use strict';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, FileUp, RefreshCw, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  getPayrollReport,
  getWebhookAuditLogs,
  listWebhookSubscriptions,
  processPayrollBatch,
  reconcilePayrollBatch,
  retryFailedPayroll,
  testWebhook,
  uploadPayroll,
} from '../features/payroll/payrollApi';
import './Payroll.css';

const EVENT_OPTIONS = ['BATCH_PROCESSED', 'RECONCILED', 'RETRY_ATTEMPTED'];

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function getErrorMessage(error) {
  return error?.response?.data?.error?.message || error?.response?.data?.message || error?.message || 'Payroll request failed.';
}

export default function Payroll() {
  const { user } = useAuth();
  const role = normalizeRole(user?.role);
  const isAdmin = ['admin', 'super_admin', 'platform_admin'].includes(role);
  const isTenantAdmin = role === 'tenant_admin';
  const isAuditor = role === 'auditor' || role === 'payroll_auditor';
  const canManage = isAdmin || role === 'employer_user' || role === 'employer' || role === 'payroll_officer';
  const canViewReport = isAdmin || isTenantAdmin || isAuditor || canManage;
  const canViewAudit = isAuditor || isTenantAdmin || canManage || isAdmin;

  const [report, setReport] = useState({ batches: [], transactions: [] });
  const [subscriptions, setSubscriptions] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [reportStatus, setReportStatus] = useState('loading');
  const [reportError, setReportError] = useState('');
  const [subscriptionStatus, setSubscriptionStatus] = useState('idle');
  const [auditStatus, setAuditStatus] = useState('loading');
  const [file, setFile] = useState(null);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [events, setEvents] = useState(EVENT_OPTIONS.slice(0, 2));
  const [busy, setBusy] = useState(false);
  const [oneTimeSecret, setOneTimeSecret] = useState('');

  const load = useCallback(async () => {
    setReportStatus('loading');
    setReportError('');
    setAuditStatus('loading');
    const requests = [
      canViewReport ? getPayrollReport({ page: 1, pageSize: 20 }) : Promise.resolve(null),
      canManage ? listWebhookSubscriptions() : Promise.resolve({ data: { subscriptions: [] } }),
      canViewAudit ? getWebhookAuditLogs({ page: 1, pageSize: 10 }) : Promise.resolve(null),
    ];
    const [reportResult, subscriptionResult, auditResult] = await Promise.allSettled(requests);

    if (!canViewReport) {
      setReportStatus('forbidden');
      setReportError('Your account does not have permission to view payroll reports.');
    } else if (reportResult.status === 'fulfilled') {
      const payload = reportResult.value?.data;
      if (payload && Array.isArray(payload.batches) && Array.isArray(payload.transactions)) {
        setReport(payload);
        setReportStatus('loaded');
      } else {
        setReportStatus('error');
        setReportError('The payroll report response is incomplete or invalid.');
      }
    } else {
      setReportStatus('error');
      setReportError(getErrorMessage(reportResult.reason));
      toast.error(getErrorMessage(reportResult.reason));
    }

    if (subscriptionResult.status === 'fulfilled') {
      setSubscriptions(subscriptionResult.value?.data?.subscriptions || []);
      setSubscriptionStatus(canManage ? 'loaded' : 'not-applicable');
    } else {
      setSubscriptionStatus('error');
      toast.error(getErrorMessage(subscriptionResult.reason));
    }

    if (!canViewAudit) {
      setAuditStatus('forbidden');
    } else if (auditResult.status === 'fulfilled') {
      setAuditLogs(auditResult.value?.data?.items || []);
      setAuditStatus('loaded');
    } else {
      setAuditStatus('error');
      toast.error(getErrorMessage(auditResult.reason));
    }
  }, [canManage, canViewAudit, canViewReport]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedBatch = report.batches?.[0] || null;
  const summary = useMemo(() => {
    const transactions = report.transactions || [];
    return {
      rows: transactions.length,
      success: transactions.filter((item) => item.status === 'SUCCESS').length,
      failed: transactions.filter((item) => item.status === 'FAILED').length,
      unknown: transactions.filter((item) => ['UNKNOWN', 'PROCESSING', 'PENDING', 'RETRYING'].includes(item.status)).length,
    };
  }, [report.transactions]);

  async function handleUpload(event) {
    event.preventDefault();
    if (!file) return toast.error('Select a CSV payroll file first.');
    setBusy(true);
    try {
      const text = await file.text();
      await uploadPayroll(text, file.name);
      toast.success('Payroll batch uploaded and validated.');
      setFile(null);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action, message) {
    if (!selectedBatch?.batchId) return toast.error('No payroll batch is available.');
    setBusy(true);
    try {
      await action(selectedBatch.batchId);
      toast.success(message);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function createSubscription(event) {
    event.preventDefault();
    if (!callbackUrl.trim()) return toast.error('Callback URL is required.');
    setBusy(true);
    try {
      const response = await createWebhookSubscription(callbackUrl.trim(), events);
      setOneTimeSecret(response.data?.secret || '');
      toast.success('Subscription created. Save the one-time signing secret now; it will not be shown again.');
      setCallbackUrl('');
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeSubscription(subscriptionId) {
    setBusy(true);
    try {
      await deleteWebhookSubscription(subscriptionId);
      toast.success('Webhook subscription deleted.');
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function simulate(subscriptionId, eventType) {
    setBusy(true);
    try {
      await testWebhook(subscriptionId, eventType);
      toast.success('Signed webhook simulation dispatched.');
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="titech-payroll" aria-labelledby="payroll-title">
      <header className="titech-payroll__hero titech-brand-card">
        <div>
          <p className="titech-payroll__eyebrow">TITech Community Capital · Employer Finance</p>
          <h1 id="payroll-title">Payroll Disbursement</h1>
          <p>Secure batch payroll processing with tenant-scoped auditability, provider reconciliation and signed employer callbacks.</p>
        </div>
        <ShieldCheck aria-hidden="true" size={34} />
      </header>

      <section className="titech-payroll__metrics" aria-label="Payroll summary">
        <div className="titech-payroll__metric"><span>Rows</span><strong>{reportStatus === 'loaded' ? summary.rows : reportStatus === 'loading' ? '—' : 'Unavailable'}</strong></div>
        <div className="titech-payroll__metric"><span>Successful</span><strong>{reportStatus === 'loaded' ? summary.success : reportStatus === 'loading' ? '—' : 'Unavailable'}</strong></div>
        <div className="titech-payroll__metric"><span>Failed</span><strong>{reportStatus === 'loaded' ? summary.failed : reportStatus === 'loading' ? '—' : 'Unavailable'}</strong></div>
        <div className="titech-payroll__metric"><span>Unconfirmed</span><strong>{reportStatus === 'loaded' ? summary.unknown : reportStatus === 'loading' ? '—' : 'Unavailable'}</strong></div>
      </section>

      {canManage && (
        <section className="titech-payroll__grid">
          <form className="titech-payroll__card titech-brand-card" onSubmit={handleUpload}>
            <div className="titech-payroll__card-heading"><FileUp size={22} /><h2>Upload payroll</h2></div>
            <p>CSV columns: employeeId, employeeName, phoneNumber, amount, currency, provider.</p>
            <input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            <button className="titech-official-primary" type="submit" disabled={busy || !file}>{busy ? 'Working…' : 'Validate & Upload'}</button>
          </form>

          <section className="titech-payroll__card titech-brand-card">
            <div className="titech-payroll__card-heading"><CheckCircle2 size={22} /><h2>Batch controls</h2></div>
            <p>{selectedBatch ? `${selectedBatch.batchId} · ${selectedBatch.status}` : 'Upload a batch to enable processing controls.'}</p>
            {isAdmin ? (
              <div className="titech-payroll__actions">
                <button onClick={() => runAction(processPayrollBatch, 'Batch processing completed.')} disabled={busy || !selectedBatch}>Process batch</button>
                <button onClick={() => runAction(reconcilePayrollBatch, 'Reconciliation completed.')} disabled={busy || !selectedBatch}>Reconcile</button>
                <button onClick={() => runAction(retryFailedPayroll, 'Failed transactions retried.')} disabled={busy || !selectedBatch}>Retry failed</button>
              </div>
            ) : <span className="titech-payroll__readonly">Payroll officer: processing and retry controls remain administrator-only.</span>}
          </section>
        </section>
      )}

      {oneTimeSecret && (
        <section className="titech-payroll__card titech-payroll__secret titech-brand-card" aria-live="polite">
          <div className="titech-payroll__card-heading"><ShieldCheck size={22} /><h2>One-time webhook secret</h2></div>
          <p>Copy this secret into the employer's secure secret store. TITech will not return it from list or replay responses.</p>
          <code>{oneTimeSecret}</code>
          <button type="button" onClick={() => setOneTimeSecret('')}>Dismiss</button>
        </section>
      )}

      <section className="titech-payroll__card titech-brand-card">
        <div className="titech-payroll__card-heading"><RefreshCw size={22} /><h2>Recent payroll batches</h2></div>
        {reportStatus === 'loading' ? (
          <p className="titech-payroll__empty">Loading payroll report…</p>
        ) : reportStatus === 'forbidden' ? (
          <p className="titech-payroll__empty" role="status">Payroll report access is not available to your account.</p>
        ) : reportStatus === 'error' ? (
          <p className="titech-payroll__empty" role="alert">Payroll data unavailable. This is not an empty payroll batch list. {reportError}</p>
        ) : report.batches?.length ? (
          <div className="titech-payroll__table-wrap">
            <table><thead><tr><th>Batch</th><th>Status</th><th>Rows</th><th>Successful</th><th>Failed</th><th>Total</th></tr></thead>
              <tbody>{report.batches.map((batch) => <tr key={batch.batchId}><td>{batch.batchId}</td><td><span data-financial-state={batch.status === 'RECONCILED' || batch.status === 'PROCESSED' ? 'positive' : batch.status === 'FAILED' ? 'negative' : 'pending'}>{batch.status}</span></td><td>{batch.rowCount}</td><td>{batch.successCount}</td><td>{batch.failedCount}</td><td>{batch.totalAmount}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="titech-payroll__empty">No payroll batches are available for this employer tenant.</p>}
      </section>

      {canManage && (
        <section className="titech-payroll__grid">
          <form className="titech-payroll__card titech-brand-card" onSubmit={createSubscription}>
            <div className="titech-payroll__card-heading"><Send size={22} /><h2>Employer webhook</h2></div>
            <label>Callback URL<input value={callbackUrl} onChange={(event) => setCallbackUrl(event.target.value)} placeholder="https://employer.example.com/titech/webhooks" /></label>
            <fieldset><legend>Events</legend>{EVENT_OPTIONS.map((event) => <label key={event} className="titech-payroll__check"><input type="checkbox" checked={events.includes(event)} onChange={(change) => setEvents((current) => change.target.checked ? [...current, event] : current.filter((item) => item !== event))} />{event}</label>)}</fieldset>
            <button className="titech-official-interactive" type="submit" disabled={busy}>Register callback</button>
          </form>

          <section className="titech-payroll__card titech-brand-card">
            <div className="titech-payroll__card-heading"><ShieldCheck size={22} /><h2>Callback subscriptions</h2></div>
            {subscriptionStatus === 'error' ? <p role="alert">Subscription data unavailable.</p> : subscriptions.length ? subscriptions.map((subscription) => (
              <div className="titech-payroll__subscription" key={subscription.subscriptionId}>
                <div><strong>{subscription.callbackUrl}</strong><span>{subscription.events.join(' · ')}</span></div>
                <div className="titech-payroll__actions">
                  <button onClick={() => simulate(subscription.subscriptionId, subscription.events[0] || 'BATCH_PROCESSED')} disabled={busy}>Test</button>
                  <button onClick={() => removeSubscription(subscription.subscriptionId)} disabled={busy} aria-label={`Delete ${subscription.callbackUrl}`}><Trash2 size={16} /></button>
                </div>
              </div>
            )) : <p className="titech-payroll__empty">No callback subscriptions registered.</p>}
          </section>
        </section>
      )}

      {canViewAudit && (
        <section className="titech-payroll__card titech-brand-card">
          <div className="titech-payroll__card-heading"><AlertCircle size={22} /><h2>Simulator audit trail</h2></div>
          {auditStatus === 'loading' ? <p className="titech-payroll__empty">Loading simulator audit history…</p> : auditStatus === 'forbidden' ? <p className="titech-payroll__empty" role="status">Audit history access is not available to your account.</p> : auditStatus === 'error' ? <p className="titech-payroll__empty" role="alert">Simulator audit history unavailable; no empty-history conclusion can be made.</p> : auditLogs.length ? <div className="titech-payroll__audit">{auditLogs.map((entry) => <div key={entry.auditLogId}><strong>{entry.eventType}</strong><span>{entry.callbackUrl || '—'} · {entry.timestamp}</span></div>)}</div> : <p className="titech-payroll__empty">No simulator audit activity recorded.</p>}
        </section>
      )}
    </main>
  );
}
