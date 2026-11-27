import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  CalendarClock,
  CreditCard,
  FileText,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import BrandLogo from '../../components/BrandLogo';
import TITECH_BRAND from '../../branding/brand';
import { get } from '../../services/api';
import './BillingDashboardPage.css';

const PAGE_SIZE = 8;

function unwrap(response) {
  return response?.data?.data ?? null;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-UG', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function amountLabel(currency, value) {
  if (value === null || value === undefined || value === '') return 'Not available';
  return `${String(currency || 'UNSPECIFIED').toUpperCase()} ${String(value)}`;
}

function statusClass(value) {
  const status = String(value || 'UNKNOWN').toLowerCase();
  if (['active', 'paid', 'success', 'settled', 'succeeded'].includes(status)) return 'is-positive';
  if (['past_due', 'overdue', 'failed', 'reversed', 'suspended'].includes(status)) return 'is-risk';
  if (['pending', 'processing', 'trialing', 'draft'].includes(status)) return 'is-pending';
  return 'is-neutral';
}

function MetricCard({ icon: Icon, label, value, detail, tone = 'blue' }) {
  return (
    <article className={`billing-metric billing-metric--${tone}`}>
      <div className="billing-metric__icon"><Icon size={18} aria-hidden="true" /></div>
      <div className="billing-metric__label">{label}</div>
      <div className="billing-metric__value">{value}</div>
      {detail ? <div className="billing-metric__detail">{detail}</div> : null}
    </article>
  );
}

function Section({ title, description, action, children }) {
  return (
    <section className="billing-section">
      <div className="billing-section__heading">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action || null}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ children }) {
  return <div className="billing-empty" role="status">{children}</div>;
}

function StatusPill({ value }) {
  return <span className={`billing-status ${statusClass(value)}`}>{String(value || 'Unknown').replaceAll('_', ' ')}</span>;
}

function DataTable({ columns, rows, emptyMessage, renderRow, footer }) {
  return (
    <div className="billing-table-wrap">
      <table className="billing-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows?.length ? rows.map(renderRow) : (
            <tr><td colSpan={columns.length}><EmptyState>{emptyMessage}</EmptyState></td></tr>
          )}
        </tbody>
      </table>
      {footer || null}
    </div>
  );
}

function CurrencyBreakdown({ rows = [], label = 'Recorded invoice totals' }) {
  if (!rows.length) return <EmptyState>No invoice totals have been recorded for this scope.</EmptyState>;
  return (
    <div className="billing-currency-list" aria-label={label}>
      {rows.map((row) => (
        <div className="billing-currency-row" key={row.currency}>
          <div><strong>{row.currency}</strong><span>{row.invoiceCount} invoices</span></div>
          <div className="billing-currency-row__amount">{amountLabel(row.currency, row.invoiced)}</div>
          <div className="billing-currency-row__muted">Outstanding: {amountLabel(row.currency, row.outstanding)}</div>
        </div>
      ))}
    </div>
  );
}

function DistributionBars({ title, values = [] }) {
  const rows = values
    .filter(([label]) => label && label !== 'undefined')
    .map(([label, count]) => ({ label: String(label).replaceAll('_', ' '), count: Number(count || 0) }));
  if (!rows.length) return <EmptyState>No status records are available for this scope.</EmptyState>;
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="billing-distribution" role="group" aria-label={`${title} counts by status`}>
      {rows.map((row, index) => (
        <div className="billing-distribution-row" key={row.label}>
          <div className="billing-distribution-row__heading"><span>{row.label}</span><strong>{row.count}</strong></div>
          <div className="billing-distribution-track"><div className={`billing-distribution-fill billing-distribution-fill--${index % 5}`} style={{ width: `${(row.count / maximum) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function Pagination({ page, pages, onChange }) {
  if (!pages || pages <= 1) return null;
  return (
    <div className="billing-pagination">
      <span>Page {page} of {pages}</span>
      <div>
        <button type="button" onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1}>Previous</button>
        <button type="button" onClick={() => onChange(Math.min(pages, page + 1))} disabled={page >= pages}>Next</button>
      </div>
    </div>
  );
}

function BillingDashboardPage() {
  const location = useLocation();
  const path = location.pathname;
  const mode = path.startsWith('/settings/billing')
    ? 'institution'
    : path.startsWith('/finance/billing-operations')
      ? 'finance'
      : 'platform';

  const [overview, setOverview] = useState(null);
  const [collections, setCollections] = useState(null);
  const [subscriptions, setSubscriptions] = useState({ items: [], page: 1, pages: 0, total: 0 });
  const [invoices, setInvoices] = useState({ items: [], page: 1, pages: 0, total: 0 });
  const [payments, setPayments] = useState({ items: [], page: 1, pages: 0, total: 0 });
  const [pages, setPages] = useState({ subscriptions: 1, invoices: 1, payments: 1 });
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const title = mode === 'institution'
    ? 'My Billing'
    : mode === 'finance'
      ? 'Finance & Collections'
      : 'Billing Control Centre';
  const subtitle = mode === 'institution'
    ? 'Review your institution’s subscription, invoices and recorded payment status.'
    : mode === 'finance'
      ? 'Review receivables ageing and payment exceptions using recorded billing data.'
      : 'Monitor SaaS billing accounts, subscription records and invoice position.';

  const loadData = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      if (mode === 'platform') {
        const [summaryResponse, subscriptionResponse, invoiceResponse] = await Promise.all([
          get('/api/v1/billing/platform/overview'),
          get('/api/v1/billing/platform/subscriptions', { params: { page: pages.subscriptions, pageSize: PAGE_SIZE } }),
          get('/api/v1/billing/platform/invoices', { params: { page: pages.invoices, pageSize: PAGE_SIZE } }),
        ]);
        setOverview(unwrap(summaryResponse));
        setSubscriptions(unwrap(subscriptionResponse) || { items: [], page: pages.subscriptions, pages: 0, total: 0 });
        setInvoices(unwrap(invoiceResponse) || { items: [], page: pages.invoices, pages: 0, total: 0 });
        setCollections(null);
      } else if (mode === 'institution') {
        const [summaryResponse, subscriptionResponse, invoiceResponse, paymentResponse] = await Promise.all([
          get('/api/v1/billing/me/overview'),
          get('/api/v1/billing/me/subscriptions', { params: { page: pages.subscriptions, pageSize: PAGE_SIZE } }),
          get('/api/v1/billing/me/invoices', { params: { page: pages.invoices, pageSize: PAGE_SIZE } }),
          get('/api/v1/billing/me/payments', { params: { page: pages.payments, pageSize: PAGE_SIZE } }),
        ]);
        setOverview(unwrap(summaryResponse));
        setSubscriptions(unwrap(subscriptionResponse) || { items: [], page: pages.subscriptions, pages: 0, total: 0 });
        setInvoices(unwrap(invoiceResponse) || { items: [], page: pages.invoices, pages: 0, total: 0 });
        setPayments(unwrap(paymentResponse) || { items: [], page: pages.payments, pages: 0, total: 0 });
        setCollections(null);
      } else {
        const response = await get('/api/v1/billing/platform/collections');
        const data = unwrap(response);
        setCollections(data);
        setOverview(data);
      }
    } catch (requestError) {
      const status = requestError?.response?.status;
      setError(status === 403
        ? 'Your account does not have permission to view this billing workspace. Contact your institution administrator or TITech support.'
        : status === 503
          ? 'Billing data is currently unavailable because the established database service is not ready.'
          : 'Billing data could not be loaded. Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode, pages]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const visibleSubscriptions = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return subscriptions.items || [];
    return (subscriptions.items || []).filter((row) => [row.planId, row.status, row.billingInterval, row.currency]
      .some((value) => String(value || '').toLowerCase().includes(query)));
  }, [subscriptions.items, filter]);

  const visibleInvoices = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return invoices.items || [];
    return (invoices.items || []).filter((row) => [row.invoiceNumber, row.status, row.currency, row.subscriptionId]
      .some((value) => String(value || '').toLowerCase().includes(query)));
  }, [invoices.items, filter]);

  const paymentExceptions = collections?.collections?.paymentExceptions || [];
  const overdueInvoices = collections?.collections?.overdueInvoices || [];
  const invoiceTotals = overview?.invoices?.byCurrency || [];
  const aging = overview?.invoices?.overdueAging || [];

  return (
    <main className="titech-billing-page">
      <header className="billing-page-header">
        <div className="billing-page-brand">
          <BrandLogo variant="icon" size="md" />
          <div>
            <div className="billing-brand-name">{TITECH_BRAND.fullName}</div>
            <div className="billing-brand-org">{TITECH_BRAND.organizationName}</div>
          </div>
        </div>
        <button className="billing-refresh" type="button" onClick={() => loadData({ quiet: true })} disabled={loading || refreshing}>
          <RefreshCw size={16} className={refreshing ? 'is-spinning' : ''} />
          Refresh data
        </button>
      </header>

      <div className="billing-title-row">
        <div>
          <p className="billing-eyebrow">COMMERCIAL BILLING / {mode.toUpperCase()}</p>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="billing-readonly-chip"><ShieldCheck size={15} /> Read-only source records</div>
      </div>

      <div className="billing-safety-note" role="note">
        <AlertCircle size={18} />
        <div><strong>Financial controls remain in force.</strong> This workspace displays records from TITech’s existing billing collections. It does not initiate payments, issue invoices, post ledger entries or approve settlements.</div>
      </div>

      {error ? <div className="billing-error" role="alert"><AlertCircle size={18} />{error}</div> : null}

      {loading ? (
        <div className="billing-loading" role="status" aria-live="polite"><span className="billing-loader" />Loading authoritative billing records…</div>
      ) : error ? (
        <EmptyState>Billing data is not available in this session.</EmptyState>
      ) : mode === 'finance' ? (
        <>
          <div className="billing-metrics-grid">
            <MetricCard icon={FileText} label="Recorded invoices" value={overview?.invoices?.total ?? '—'} detail="Across the platform" />
            <MetricCard icon={CalendarClock} label="Overdue invoices" value={overview?.invoices?.overdueCount ?? '—'} detail="Open balance and past due date" tone="gold" />
            <MetricCard icon={AlertCircle} label="Payment exceptions" value={paymentExceptions.length} detail="Returned payment exception records (maximum 50)" tone="risk" />
            <MetricCard icon={BadgeCheck} label="Subscription records" value={overview?.subscriptions?.total ?? '—'} detail="Recorded billing subscriptions" tone="green" />
          </div>

          <Section title="Receivables ageing" description="Count of overdue invoices grouped by days past due. Amounts are not combined across currencies.">
            <div className="billing-aging-grid">
              {aging.map((item) => {
                const maximum = Math.max(1, ...aging.map((entry) => Number(entry.invoices || 0)));
                return <div className="billing-aging-item" key={item.band}><span>{item.band}</span><strong>{item.invoices}</strong><div className="billing-aging-track"><div style={{ width: `${(Number(item.invoices || 0) / maximum) * 100}%` }} /></div></div>;
              })}
            </div>
          </Section>

          <Section title="Overdue invoice work queue" description="The first 50 overdue records from the billing invoice collection.">
            <DataTable columns={['Invoice', 'Due date', 'Currency', 'Outstanding', 'Status']} rows={overdueInvoices}
              emptyMessage="No overdue invoice records were returned."
              renderRow={(row) => <tr key={String(row._id || row.invoiceNumber)}><td><strong>{row.invoiceNumber || 'Invoice reference unavailable'}</strong></td><td>{formatDate(row.dueDate)}</td><td>{row.currency || '—'}</td><td>{amountLabel(row.currency, row.amountDue)}</td><td><StatusPill value={row.status} /></td></tr>} />
          </Section>

          <Section title="Payment exceptions" description="Investigation queue only. Provider references are evidence references, not proof of settlement.">
            <DataTable columns={['Payment reference', 'Provider', 'Recorded date', 'Amount', 'State']} rows={paymentExceptions}
              emptyMessage="No payment exception records were returned."
              renderRow={(row) => <tr key={String(row._id || row.internalPaymentReference)}><td><strong>{row.internalPaymentReference || row.providerPaymentId || 'Reference unavailable'}</strong></td><td>{row.provider || '—'}</td><td>{formatDate(row.createdAt)}</td><td>{amountLabel(row.currency, row.amount)}</td><td><StatusPill value={row.status} /></td></tr>} />
          </Section>
        </>
      ) : (
        <>
          <div className="billing-metrics-grid">
            <MetricCard icon={Building2} label={mode === 'institution' ? 'Your subscriptions' : 'Subscription records'} value={overview?.subscriptions?.total ?? '—'} detail="Recorded subscription documents" />
            <MetricCard icon={FileText} label={mode === 'institution' ? 'Your invoices' : 'Invoices recorded'} value={overview?.invoices?.total ?? '—'} detail="Canonical billing invoice collection" tone="cyan" />
            <MetricCard icon={CreditCard} label={mode === 'institution' ? 'Your payment records' : 'Payment records'} value={overview?.payments?.total ?? '—'} detail="Not equivalent to settled cash" tone="green" />
            <MetricCard icon={CalendarClock} label="Overdue invoices" value={overview?.invoices?.overdueCount ?? '—'} detail="Open invoices past their due date" tone="gold" />
          </div>

          <Section title="Invoice position by currency" description="Source-record totals grouped by their original currency; no currency conversion is applied.">
            <CurrencyBreakdown rows={invoiceTotals} />
          </Section>

          <Section title="Billing record status" description="Counts are sourced from the corresponding billing collections; they are not a revenue-recognition report.">
            <div className="billing-distribution-grid">
              <div><h3>Subscription status</h3><DistributionBars title="Subscription status" values={Object.entries(overview?.subscriptions?.byStatus || {})} /></div>
              <div><h3>Invoice status</h3><DistributionBars title="Invoice status" values={Object.entries(overview?.invoices?.byStatus || {})} /></div>
            </div>
          </Section>

          <Section title={mode === 'institution' ? 'Your subscription' : 'Subscription overview'} description="Plan identifiers and dates are shown as stored. A plan identifier is not a human-approved price quote.">
            <DataTable columns={['Plan reference', 'Billing cycle', 'Currency', 'Status', 'Current period']} rows={visibleSubscriptions}
              emptyMessage="No subscription records are available for this billing scope."
              renderRow={(row) => <tr key={String(row._id)}><td><strong>{row.planId ? String(row.planId) : 'Plan not recorded'}</strong></td><td>{row.billingInterval || '—'}</td><td>{row.currency || '—'}</td><td><StatusPill value={row.status} /></td><td>{formatDate(row.currentPeriodStart)} – {formatDate(row.currentPeriodEnd)}</td></tr>}
              footer={<Pagination page={subscriptions.page || pages.subscriptions} pages={subscriptions.pages || 0} onChange={(page) => setPages((current) => ({ ...current, subscriptions: page }))} />} />
          </Section>

          <Section title={mode === 'institution' ? 'Your invoices' : 'Recent invoices'} description="Issued invoice snapshots from the existing billing collection.">
            <div className="billing-table-toolbar"><label htmlFor="billing-search">Search current page</label><input id="billing-search" type="search" placeholder="Invoice, status, currency…" value={filter} onChange={(event) => setFilter(event.target.value)} /></div>
            <DataTable columns={['Invoice number', 'Issue date', 'Due date', 'Currency', 'Total', 'Outstanding', 'Status']} rows={visibleInvoices}
              emptyMessage="No invoice records match this search."
              renderRow={(row) => <tr key={String(row._id)}><td><strong>{row.invoiceNumber || '—'}</strong></td><td>{formatDate(row.issuedAt)}</td><td>{formatDate(row.dueDate)}</td><td>{row.currency || '—'}</td><td>{amountLabel(row.currency, row.total)}</td><td>{amountLabel(row.currency, row.amountDue)}</td><td><StatusPill value={row.status} /></td></tr>}
              footer={<Pagination page={invoices.page || pages.invoices} pages={invoices.pages || 0} onChange={(page) => setPages((current) => ({ ...current, invoices: page }))} />} />
          </Section>

          {mode === 'institution' ? (
            <Section title="Your payment history" description="Payment status is shown as recorded; an initiated or provider-accepted payment is not necessarily settled.">
              <DataTable columns={['Payment reference', 'Provider', 'Date', 'Currency', 'Amount', 'Status']} rows={payments.items}
                emptyMessage="No payment records are available for this institution."
                renderRow={(row) => <tr key={String(row._id)}><td><strong>{row.internalPaymentReference || '—'}</strong></td><td>{row.provider || '—'}</td><td>{formatDate(row.createdAt)}</td><td>{row.currency || '—'}</td><td>{amountLabel(row.currency, row.amount)}</td><td><StatusPill value={row.status} /></td></tr>}
                footer={<Pagination page={payments.page || pages.payments} pages={payments.pages || 0} onChange={(page) => setPages((current) => ({ ...current, payments: page }))} />} />
            </Section>
          ) : null}

          <Section title="Financial reporting availability" description="These reporting measures are intentionally withheld until the underlying billing and accounting lifecycle is verified.">
            <div className="billing-unavailable-grid">
              {['MRR', 'ARR', 'Recognized revenue', 'Settled cash'].map((label) => <div className="billing-unavailable-item" key={label}><span>{label}</span><strong>Not available</strong></div>)}
            </div>
            <p className="billing-footnote">{overview?.financialReporting?.reason || 'Financial reporting requires an approved pricing, journal and settlement evidence chain.'}</p>
          </Section>
        </>
      )}

      <footer className="billing-page-footer">
        <div><BrandLogo variant="icon" size="xs" decorative /> <span>{TITECH_BRAND.fullName} · {TITECH_BRAND.organizationName}</span></div>
        <strong>{TITECH_BRAND.tagline}</strong>
        <span>ERN 80049233029029 · P.O. Box 601200 · Uganda</span>
        <span><a href="mailto:titechcapital@gmail.com">titechcapital@gmail.com</a> · +256782397907 · WhatsApp +256772123546</span>
      </footer>
    </main>
  );
}

export default BillingDashboardPage;
