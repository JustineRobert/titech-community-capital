import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, ArrowDownToLine, CheckCircle2, FileSpreadsheet, Landmark, RefreshCw, ShieldCheck, UploadCloud, WalletCards } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import './BankConnectPage.css';

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'institutions', label: 'Banking institutions', icon: Landmark },
  { id: 'accounts', label: 'Bank accounts', icon: WalletCards },
  { id: 'statements', label: 'Statement imports', icon: FileSpreadsheet },
  { id: 'transactions', label: 'Bank transactions', icon: ArrowDownToLine },
  { id: 'reconciliation', label: 'Reconciliation', icon: CheckCircle2 },
  { id: 'health', label: 'Integration health', icon: ShieldCheck },
];

function payload(response) {
  return response?.data?.data ?? response?.data ?? {};
}

function messageFrom(error) {
  return error?.response?.data?.error?.message || error?.message || 'BankConnect data could not be loaded.';
}

function formatNumber(value) {
  return value === null || value === undefined || value === '' ? '—' : (Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-UG').format(Number(value)) : '—');
}

function dateLabel(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function moneyLabel(minor, currency) {
  if (minor === null || minor === undefined || !currency) return 'Not available';
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  return new Intl.NumberFormat('en-UG', { style: 'currency', currency, maximumFractionDigits: digits }).format(Number(minor) / (10 ** digits));
}

function StatusPill({ children, tone = 'neutral' }) {
  return <span className={`bankconnect-status bankconnect-status--${tone}`}>{children}</span>;
}

function Metric({ label, value, description }) {
  return <article className="bankconnect-metric"><span className="bankconnect-metric__label">{label}</span><strong>{value}</strong>{description ? <small>{description}</small> : null}</article>;
}

export default function BankConnectPage() {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [institutions, setInstitutions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [statements, setStatements] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [integrationHealth, setIntegrationHealth] = useState(null);
  const [consents, setConsents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [form, setForm] = useState({ institutionId: 'CENTENARY_UG', accountReference: '', accountName: '', maskedAccountNumber: '', accountType: 'SAVINGS', currency: 'UGX', ownershipEvidenceReference: '' });
  const [uploadAccountId, setUploadAccountId] = useState('');
  const [statementFile, setStatementFile] = useState(null);

  const canReview = useMemo(() => {
    const role = String(user?.role || '').toLowerCase();
    return role === 'platform_admin' || role === 'super_admin' || role === 'tenant_admin' || (Array.isArray(user?.permissions) && user.permissions.includes('BANKCONNECT_AUTHORIZATION_REVIEW'));
  }, [user]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setForbidden(false);
    const requests = await Promise.allSettled([
      api.get('/api/v1/bankconnect/overview'),
      api.get('/api/v1/bankconnect/institutions'),
      api.get('/api/v1/bankconnect/accounts'),
      api.get('/api/v1/bankconnect/statements'),
      api.get('/api/v1/bankconnect/transactions'),
      api.get('/api/v1/bankconnect/reconciliation'),
      api.get('/api/v1/bankconnect/integration-health'),
      api.get('/api/v1/bankconnect/consents'),
    ]);
    const firstFailure = requests.find((result) => result.status === 'rejected');
    if (firstFailure?.reason?.response?.status === 403) {
      setForbidden(true);
      setLoadError('Your institution role does not include BankConnect access. Ask an authorised institution administrator to grant the required permission.');
      setLoading(false);
      return;
    }
    const [overviewResult, institutionsResult, accountsResult, statementsResult, transactionsResult, exceptionsResult, healthResult, consentsResult] = requests;
    const apply = (result, setter, key = 'items') => {
      if (result.status === 'fulfilled') {
        const data = payload(result.value);
        setter(key === 'root' ? data : (Array.isArray(data) ? data : data[key] || []));
      }
    };
    apply(overviewResult, setOverview, 'root');
    apply(institutionsResult, setInstitutions, 'root');
    apply(accountsResult, setAccounts);
    apply(statementsResult, setStatements);
    apply(transactionsResult, setTransactions);
    apply(exceptionsResult, setExceptions);
    apply(healthResult, setIntegrationHealth, 'root');
    apply(consentsResult, setConsents);
    if (firstFailure) setLoadError(messageFrom(firstFailure.reason));
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const submitAccount = async (event) => {
    event.preventDefault();
    setSavingAccount(true);
    setFeedback('');
    try {
      const created = payload(await api.post('/api/v1/bankconnect/accounts', form));
      const accountId = created.id || created._id;
      await api.post(`/api/v1/bankconnect/accounts/${accountId}/consents`, {
        scopes: ['STATEMENTS', 'TRANSACTIONS'],
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        authorizationEvidenceReference: form.ownershipEvidenceReference,
      });
      setFeedback('Bank account registered and statement-data consent submitted for independent review. Statement imports stay blocked until consent is approved.');
      setForm({ institutionId: 'CENTENARY_UG', accountReference: '', accountName: '', maskedAccountNumber: '', accountType: 'SAVINGS', currency: 'UGX', ownershipEvidenceReference: '' });
      await reload();
    } catch (error) { setFeedback(messageFrom(error)); }
    finally { setSavingAccount(false); }
  };

  const approveConsent = async (consentId) => {
    setFeedback('');
    try {
      await api.patch(`/api/v1/bankconnect/consents/${consentId}/approve`);
      setFeedback('Consent approval recorded. Account statement import is now available within the approved scope.');
      await reload();
    } catch (error) { setFeedback(messageFrom(error)); }
  };

  const revokeConsent = async (consentId) => {
    setFeedback('');
    try {
      await api.patch(`/api/v1/bankconnect/consents/${consentId}/revoke`, { reason: 'Revoked by authorised institution representative' });
      setFeedback('Consent revoked. Further statement imports are blocked; historical evidence is retained.');
      await reload();
    } catch (error) { setFeedback(messageFrom(error)); }
  };

  const uploadStatement = async (event) => {
    event.preventDefault();
    if (!statementFile || !uploadAccountId) return;
    setUploading(true);
    setFeedback('');
    try {
      await api.post(`/api/v1/bankconnect/statements/import/${uploadAccountId}`, statementFile, {
        headers: {
          'Content-Type': statementFile.name.toLowerCase().endsWith('.csv') ? 'text/csv' : statementFile.name.toLowerCase().endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : statementFile.name.toLowerCase().endsWith('.xml') ? 'application/xml' : 'text/plain',
          'X-Statement-Filename': statementFile.name,
        },
        timeout: 60000,
      });
      setFeedback('Statement evidence imported. Imported rows remain unmatched until investigated and approved through the governed reconciliation workflow.');
      setStatementFile(null);
      await reload();
    } catch (error) { setFeedback(messageFrom(error)); }
    finally { setUploading(false); }
  };

  const selectedSection = NAV_ITEMS.find((item) => item.id === activeSection)?.label || 'Overview';
  const authorizedAccounts = accounts.filter((item) => item.status === 'ACTIVE' && item.authorizationStatus === 'EVIDENCE_REVIEWED' && item.consentStatus === 'APPROVED');

  if (forbidden) return <main className="bankconnect-page"><section className="bankconnect-alert bankconnect-alert--warning"><AlertCircle size={22} /><div><strong>BankConnect access restricted</strong><p>{loadError}</p></div></section></main>;

  return (
    <main className="bankconnect-page" data-testid="bankconnect-page">
      <header className="bankconnect-header">
        <div className="bankconnect-header__brand"><span className="bankconnect-header__icon"><Landmark size={23} /></span><div><p className="bankconnect-eyebrow">TITech Community Capital · BankConnect</p><h1>Bank connectivity & reconciliation</h1><p>Institution-owned bank evidence, secure statement imports and governed reconciliation.</p></div></div>
        <button type="button" className="bankconnect-refresh" onClick={reload} disabled={loading}><RefreshCw size={16} className={loading ? 'is-spinning' : ''} /> Refresh</button>
      </header>

      <div className="bankconnect-assurance"><ShieldCheck size={18} /><span><strong>FINANCIAL CORRECTNESS BEFORE CONVENIENCE.</strong> TITech is financial information and reconciliation infrastructure, not a bank. Bank API access and payment execution are not approved or enabled.</span></div>
      {feedback ? <div className="bankconnect-feedback" role="status">{feedback}</div> : null}
      {loadError && !forbidden ? <div className="bankconnect-alert bankconnect-alert--warning" role="alert"><AlertCircle size={18} /><span>{loadError}</span></div> : null}

      <div className="bankconnect-layout">
        <nav className="bankconnect-nav" aria-label="BankConnect sections">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={activeSection === id ? 'is-active' : ''} onClick={() => setActiveSection(id)}><Icon size={17} />{label}</button>)}
        </nav>

        <section className="bankconnect-content" aria-label={selectedSection}>
          {loading ? <div className="bankconnect-loading" role="status">Loading authorised BankConnect records…</div> : null}

          {activeSection === 'overview' && !loading ? <>
            <div className="bankconnect-section-heading"><div><h2>Institution overview</h2><p>Live figures are derived from records inside your authorised institution scope.</p></div><StatusPill tone="warning">API connectors not connected</StatusPill></div>
            <div className="bankconnect-metrics">
              <Metric label="Registered banks" value={formatNumber(overview?.registeredInstitutions)} description="Institution directory" />
              <Metric label="Bank accounts" value={formatNumber(overview?.registeredAccounts)} description="Institution-scoped records" />
              <Metric label="Authorised accounts" value={formatNumber(overview?.authorizedAccounts)} description="Evidence reviewed + active consent" />
              <Metric label="Pending authorisations" value={formatNumber(overview?.pendingAuthorizations)} description="Awaiting independent review" />
              <Metric label="Statements imported" value={formatNumber(overview?.statementsImported)} description="Encrypted source evidence" />
              <Metric label="Transactions imported" value={formatNumber(overview?.transactionsImported)} description="Bank evidence records" />
              <Metric label="Unmatched transactions" value={formatNumber(overview?.unmatchedTransactions)} description="Awaiting reconciliation review" />
              <Metric label="Potential duplicates" value={formatNumber(overview?.duplicateTransactions)} description="Flagged for investigation, not discarded" />
            </div>
            <div className="bankconnect-note-grid"><article><h3>Bank-reported balances</h3><strong>Not available</strong><p>Balance extraction is not yet implemented for imported statement formats, and no authorised bank balance feed is configured.</p></article><article><h3>Ledger comparison</h3><strong>Not connected</strong><p>Imported statement evidence does not post to member balances or the canonical ledger.</p></article><article><h3>Last statement import</h3><strong>{dateLabel(overview?.lastSynchronizationAt)}</strong><p>Manual statement ingestion time; not a bank synchronisation timestamp.</p></article></div>
          </> : null}

          {activeSection === 'institutions' ? <><div className="bankconnect-section-heading"><div><h2>Banking institutions</h2><p>Provider-neutral registry. Registration is not a bank relationship or API connection.</p></div></div><div className="bankconnect-table-wrap"><table><thead><tr><th>Institution</th><th>Country</th><th>Local parser formats</th><th>Bank-confirmed formats</th><th>Connector</th><th>External approval</th></tr></thead><tbody>{institutions.map((bank) => <tr key={bank.id}><td><strong>{bank.name}</strong>{bank.integrationPriority === 1 ? <small className="bankconnect-priority">Initial integration pathway</small> : null}</td><td>{bank.country}</td><td>{bank.statementFormats?.join(', ')}</td><td>{bank.bankPublishedStatementFormats?.length ? bank.bankPublishedStatementFormats.join(', ') : 'Not independently confirmed'}</td><td><StatusPill tone="warning">{bank.connectorStatus}</StatusPill></td><td><StatusPill>Not approved</StatusPill></td></tr>)}</tbody></table></div></> : null}

          {activeSection === 'accounts' ? <>
            <div className="bankconnect-section-heading"><div><h2>Bank accounts</h2><p>Only masked account identifiers are collected. Never enter passwords, PINs or OTPs.</p></div></div>
            <form className="bankconnect-form" onSubmit={submitAccount}>
              <label>Bank<select value={form.institutionId} onChange={(event) => setForm((old) => ({ ...old, institutionId: event.target.value }))}>{institutions.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>
              <label>Institution reference<input required maxLength="80" value={form.accountReference} onChange={(event) => setForm((old) => ({ ...old, accountReference: event.target.value }))} placeholder="Institution's internal account reference" /></label>
              <label>Account name<input required maxLength="160" value={form.accountName} onChange={(event) => setForm((old) => ({ ...old, accountName: event.target.value }))} /></label>
              <label>Masked account number<input required maxLength="32" value={form.maskedAccountNumber} onChange={(event) => setForm((old) => ({ ...old, maskedAccountNumber: event.target.value }))} placeholder="••••1234" /></label>
              <label>Account type<select value={form.accountType} onChange={(event) => setForm((old) => ({ ...old, accountType: event.target.value }))}><option value="SAVINGS">Savings</option><option value="CURRENT">Current</option><option value="BUSINESS">Business</option><option value="OTHER">Other</option></select></label>
              <label>Currency<select value={form.currency} onChange={(event) => setForm((old) => ({ ...old, currency: event.target.value }))}><option value="UGX">UGX</option><option value="USD">USD</option></select></label>
              <label className="bankconnect-form__wide">Ownership / signatory evidence reference<input required minLength="4" maxLength="256" value={form.ownershipEvidenceReference} onChange={(event) => setForm((old) => ({ ...old, ownershipEvidenceReference: event.target.value }))} placeholder="Reference to institution authorisation evidence" /></label>
              <button type="submit" disabled={savingAccount}>{savingAccount ? 'Submitting…' : 'Register account & request consent'}</button>
            </form>
            <div className="bankconnect-table-wrap"><table><thead><tr><th>Bank account</th><th>Authorisation</th><th>Consent</th><th>Connection</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}><td><strong>{account.accountName}</strong><small>{account.institutionName} · {account.maskedAccountNumber} · {account.currency}</small></td><td>{account.authorizationStatus}</td><td>{account.consentStatus}</td><td><StatusPill tone="warning">{account.connectionStatus}</StatusPill></td></tr>)}</tbody></table></div>
            <div className="bankconnect-consents"><h3>Authorization & consent review</h3>{consents.length ? consents.map((consent) => <article key={consent.id}><div><strong>{consent.scopes.join(', ')}</strong><small>{consent.status} · valid until {dateLabel(consent.validUntil)}</small></div><div className="bankconnect-inline-actions">{consent.status === 'REQUESTED' && canReview ? <button type="button" onClick={() => approveConsent(consent.id)}>Approve</button> : null}{consent.status === 'APPROVED' ? <button type="button" className="bankconnect-button--danger" onClick={() => revokeConsent(consent.id)}>Revoke</button> : null}</div></article>) : <p>No consent records have been submitted.</p>}</div>
          </> : null}

          {activeSection === 'statements' ? <>
            <div className="bankconnect-section-heading"><div><h2>Statement imports</h2><p>Supported local parsers: CSV, XLSX, MT940 and ISO 20022 CAMT.052/.053/.054. Legacy XLS is rejected.</p></div></div>
            <form className="bankconnect-upload" onSubmit={uploadStatement}><label>Authorised bank account<select required value={uploadAccountId} onChange={(event) => setUploadAccountId(event.target.value)}><option value="">Select an approved account</option>{authorizedAccounts.map((account) => <option key={account.id} value={account.id}>{account.institutionName} · {account.accountName} · {account.maskedAccountNumber}</option>)}</select></label><label>Statement file<input type="file" required accept=".csv,.xlsx,.mt940,.sta,.xml" onChange={(event) => setStatementFile(event.target.files?.[0] || null)} /></label><p>Maximum size 5 MiB. Uploads require an available ClamAV scanner and server-side AES-256-GCM evidence key. Imports do not create ledger postings.</p><button type="submit" disabled={uploading || !statementFile || !uploadAccountId}><UploadCloud size={16} />{uploading ? 'Importing…' : 'Import statement'}</button></form>
            <div className="bankconnect-table-wrap"><table><thead><tr><th>File</th><th>Format</th><th>Transactions</th><th>Duplicates</th><th>Imported</th><th>Status</th></tr></thead><tbody>{statements.map((item) => <tr key={item.id}><td><strong>{item.filename}</strong><small>{item.sourceHash?.slice(0, 12)}…</small></td><td>{item.format}</td><td>{formatNumber(item.transactionCount)}</td><td>{formatNumber(item.duplicateCount)} / {formatNumber(item.potentialDuplicateCount)} potential</td><td>{dateLabel(item.importedAt)}</td><td><StatusPill tone="success">{item.status}</StatusPill></td></tr>)}</tbody></table>{!statements.length ? <p className="bankconnect-empty">No statements imported for this institution.</p> : null}</div>
          </> : null}

          {activeSection === 'transactions' ? <><div className="bankconnect-section-heading"><div><h2>Bank transactions</h2><p>Source evidence is not the same as a posted TITech financial transaction.</p></div></div><div className="bankconnect-table-wrap"><table><thead><tr><th>Booking date</th><th>Bank narrative</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Reconciliation</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td>{dateLabel(item.bookingDate)}</td><td>{item.description}</td><td>{item.transactionReference || item.externalTransactionId || '—'}</td><td>{item.debitMinor ? moneyLabel(item.debitMinor, item.currency) : '—'}</td><td>{item.creditMinor ? moneyLabel(item.creditMinor, item.currency) : '—'}</td><td><StatusPill tone={item.potentialDuplicate ? 'warning' : 'neutral'}>{item.reconciliationStatus}</StatusPill></td></tr>)}</tbody></table>{!transactions.length ? <p className="bankconnect-empty">No bank transactions imported.</p> : null}</div></> : null}

          {activeSection === 'reconciliation' ? <><div className="bankconnect-section-heading"><div><h2>Exceptions & reconciliation</h2><p>Potential duplicates and unmatched items require human review. No automatic ledger posting is performed.</p></div></div><div className="bankconnect-callout"><AlertCircle size={19} /><div><strong>Evidence queue only</strong><p>Matching approval and canonical ledger posting are not yet wired to the existing reconciliation engine. Keep transactions in the review queue; do not adjust member balances from this evidence.</p></div></div><div className="bankconnect-table-wrap"><table><thead><tr><th>Booking date</th><th>Description</th><th>Reference</th><th>Amount</th><th>Exception state</th></tr></thead><tbody>{exceptions.map((item) => <tr key={item.id}><td>{dateLabel(item.bookingDate)}</td><td>{item.description}</td><td>{item.transactionReference || '—'}</td><td>{moneyLabel(item.creditMinor || item.debitMinor, item.currency)}</td><td><StatusPill tone="warning">{item.reconciliationStatus}</StatusPill></td></tr>)}</tbody></table>{!exceptions.length ? <p className="bankconnect-empty">No unmatched or potential-duplicate bank transactions.</p> : null}</div></> : null}

          {activeSection === 'health' ? <><div className="bankconnect-section-heading"><div><h2>Integration health</h2><p>Provider capability and approval state are explicit and evidence-based.</p></div><StatusPill tone="warning">Not production connected</StatusPill></div><div className="bankconnect-health-cards"><article><strong>Manual statement import</strong><StatusPill tone={integrationHealth?.evidenceEncryptionConfigured ? 'success' : 'warning'}>{integrationHealth?.evidenceEncryptionConfigured ? 'Encryption key configured' : 'Evidence encryption not configured'}</StatusPill><p>Local CSV/XLSX/MT940/CAMT import requires an encryption key, a configured malware scanner and an approved account consent.</p><small>Malware scanner: {integrationHealth?.malwareScannerConfigured ? 'configured' : 'not configured'}</small></article><article><strong>Bank API connectivity</strong><StatusPill>Not connected</StatusPill><p>No API endpoint, bank credential, sandbox or live connection has been represented as available.</p></article><article><strong>Payment execution</strong><StatusPill tone="danger">Disabled</StatusPill><p>Payment submission and transfer execution remain blocked pending bank authorisation, legal/regulatory assessment and formal approval.</p></article><article><strong>Canonical ledger posting</strong><StatusPill>Not integrated</StatusPill><p>Bank transaction evidence remains separate from ledger events until a verified reconciliation workflow is approved and integrated.</p></article></div><p className="bankconnect-health-summary">{integrationHealth?.status || 'Checking status…'} · Production approved: {String(Boolean(integrationHealth?.productionApproved))}</p></> : null}
        </section>
      </div>
      <footer className="bankconnect-footer"><span>TITECH CAPITAL - SMC LTD.</span><span>Community Finance. Stronger Together.</span><span>FINANCIAL CORRECTNESS BEFORE CONVENIENCE.</span></footer>
    </main>
  );
}
