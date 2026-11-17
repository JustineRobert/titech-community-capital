import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import api from '../services/api';
import { formatExactIntegerCurrency } from '../utils/moneyDisplay';
import './enterprise-detail.css';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const display = (value) => value === null || value === undefined || value === '' ? 'Not recorded' : String(value);
const money = (value, currency = 'UGX') => {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  return formatExactIntegerCurrency(value, currency, 'en-UG');
};

export default function SavingsAccountDetails() {
  const { accountId = '' } = useParams();
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [activity, setActivity] = useState([]);
  const [activityError, setActivityError] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(async (signal) => {
    if (!OBJECT_ID_PATTERN.test(accountId)) { setError({ title: 'Invalid savings account ID', message: 'The account identifier is not valid.' }); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const response = await api.get(`/api/v1/savings/accounts/${encodeURIComponent(accountId)}`, signal ? { signal } : undefined);
      const payload = response?.data ?? response;
      const record = payload?.data?.account ?? payload?.account ?? null;
      if (!record) { const malformed = new Error('Missing account payload'); malformed.response = { status: 502 }; throw malformed; }
      setAccount(record);
      try {
        const activityResponse = await api.get('/api/v1/savings/transactions', { params: { accountId, page: 1, limit: 25 }, ...(signal ? { signal } : {}) });
        const activityPayload = activityResponse?.data ?? activityResponse;
        const activityData = activityPayload?.data ?? activityPayload;
        setActivity(Array.isArray(activityData?.transactions) ? activityData.transactions : []);
        setActivityError('');
      } catch (activityRequestError) {
        if (activityRequestError?.code !== 'ERR_CANCELED' && activityRequestError?.name !== 'AbortError') {
          setActivity([]);
          setActivityError('Account activity is temporarily unavailable. The account details remain available.');
        }
      }
    } catch (requestError) {
      if (requestError?.name === 'AbortError' || requestError?.code === 'ERR_CANCELED' || requestError?.name === 'CanceledError') return;
      const status = Number(requestError?.response?.status ?? 0);
      setAccount(null);
      setActivity([]);
      setError(status === 400 ? { title: 'Invalid savings account ID', message: 'The account identifier is not valid.' } : status === 401 ? { title: 'Sign-in required', message: 'Sign in to view this savings account.' } : status === 403 ? { title: 'Access denied', message: 'You do not have permission to view this savings account.' } : status === 404 ? { title: 'Savings account not found', message: 'The account is not available in your authorized institution.' } : { title: 'Savings service unavailable', message: 'Savings account details could not be loaded.' });
    } finally { setLoading(false); }
  }, [accountId]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load, attempt]);
  if (loading) return <main className="titech-detail-page"><div className="titech-detail-loading"><span className="titech-detail-spinner" />Loading savings account…</div></main>;
  if (error || !account) return <main className="titech-detail-page"><button className="titech-detail-back" type="button" onClick={() => navigate('/savings')}><ArrowLeft size={17} /> Back to Savings</button><section className="titech-detail-state" role="alert"><AlertCircle size={28} /><h1>{error?.title || 'Savings account unavailable'}</h1><p>{error?.message || 'The requested account could not be loaded.'}</p><div className="titech-detail-actions"><button className="titech-button titech-button-primary" type="button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} /> Try again</button><Link className="titech-button" to="/savings">Savings portfolio</Link></div></section></main>;
  const member = account.member || {};
  const name = member.fullName || [member.firstName, member.otherNames, member.lastName].filter(Boolean).join(' ') || account.memberName;
  return <main className="titech-detail-page" aria-labelledby="savings-account-title">
    <div className="titech-detail-breadcrumb"><Link to="/savings">Savings</Link><span aria-hidden="true">/</span><span>Account details</span></div>
    <header className="titech-detail-hero"><div className="titech-detail-identity"><div className="titech-avatar"><Wallet size={26} /></div><div><p className="titech-detail-eyebrow">TITech Community Capital · Community Finance. Stronger Together.</p><h1 id="savings-account-title">{display(account.savingsName, 'Savings account')}</h1><p className="titech-detail-reference">Account: {display(account.savingsNumber)}</p><div className="titech-detail-badges"><span className={`titech-status titech-status-${String(account.status || 'unknown').toLowerCase()}`}>{display(account.status)}</span></div></div></div><button className="titech-detail-back" type="button" onClick={() => navigate('/savings')}><ArrowLeft size={17} /> Back to Savings</button></header>
    <div className="titech-detail-grid">
      <section className="titech-detail-card"><div className="titech-detail-card-heading"><Wallet size={18} /><h2>Account details</h2></div><div className="titech-detail-fields"><div className="titech-detail-field"><span>Account reference</span><strong>{display(account.savingsNumber)}</strong></div><div className="titech-detail-field"><span>Product</span><strong>{display(account.savingsType)}</strong></div><div className="titech-detail-field"><span>Currency</span><strong>{display(account.currency)}</strong></div><div className="titech-detail-field"><span>Status</span><strong>{display(account.status)}</strong></div><div className="titech-detail-field"><span>Opened</span><strong>{display(account.openedAt || account.createdAt)}</strong></div></div></section>
      <section className="titech-detail-card"><div className="titech-detail-card-heading"><ShieldCheck size={18} /><h2>Member association</h2></div><div className="titech-detail-fields"><div className="titech-detail-field"><span>Member</span><strong>{display(name)}</strong></div><div className="titech-detail-field"><span>Member reference</span><strong>{display(member.memberNumber)}</strong></div><div className="titech-detail-field"><span>Member status</span><strong>{display(member.memberStatus)}</strong></div><div className="titech-detail-field"><span>KYC status</span><strong>{display(member.kycStatus)}</strong></div></div></section>
      <section className="titech-detail-card"><div className="titech-detail-card-heading"><Wallet size={18} /><h2>Account aggregate snapshot</h2></div><div className="titech-detail-fields"><div className="titech-detail-field"><span>Account balance snapshot</span><strong>{money(account.balance, account.currency)}</strong></div><div className="titech-detail-field"><span>Available balance snapshot</span><strong>{money(account.availableBalance, account.currency)}</strong></div><div className="titech-detail-field"><span>Blocked balance snapshot</span><strong>{money(account.blockedBalance, account.currency)}</strong></div><div className="titech-detail-field"><span>Reconciliation state</span><strong>{display(account.reconciliationStatus)}</strong></div></div><p className="titech-detail-note">These values are read-only account aggregates from the Savings model. They are explicitly not the ledger authority; use the canonical ledger and reconciliation services to confirm a financial position.</p></section>
    </div>
    <section className="titech-detail-card"><div className="titech-detail-card-heading"><Wallet size={18} /><h2>Account activity</h2></div>{activityError ? <p role="status">{activityError}</p> : activity.length === 0 ? <p>No transaction records are currently available for this account.</p> : <div className="titech-detail-table-wrap"><table className="titech-detail-table"><thead><tr><th>Reference</th><th>Type</th><th>Amount</th><th>Status</th><th>Created</th><th>Details</th></tr></thead><tbody>{activity.map((item) => <tr key={item.id || item._id}><td>{display(item.reference)}</td><td>{display(item.type)}</td><td>{money(item.amount, item.currency)}</td><td>{display(item.status)}</td><td>{display(item.createdAt)}</td><td><Link to={`/savings/transactions/${encodeURIComponent(item.id || item._id)}`}>Open</Link></td></tr>)}</tbody></table></div>}<div className="titech-detail-actions"><button className="titech-button titech-button-primary" type="button" onClick={() => navigate(`/savings?memberId=${encodeURIComponent(account.memberId || member._id || '')}`)}>View member savings activity</button></div><p className="titech-detail-note">Activity entries are persisted transaction records. They do not independently prove settlement or authoritative ledger posting.</p></section>
  </main>;
}
