import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import api from '../services/api';
import { formatExactIntegerCurrency } from '../utils/moneyDisplay';
import './enterprise-detail.css';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const display = (value) => value === null || value === undefined || value === '' ? 'Not recorded' : String(value);
const money = (value, currency = 'UGX') => formatExactIntegerCurrency(value, currency, 'en-UG');

export default function SavingsTransactionDetails() {
  const { transactionId = '' } = useParams();
  const navigate = useNavigate();
  const [transaction, setTransaction] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(async (signal) => {
    if (!OBJECT_ID_PATTERN.test(transactionId)) { setError({ title: 'Invalid transaction ID', message: 'The transaction identifier is not valid.' }); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const response = await api.get(`/api/v1/savings/transactions/${encodeURIComponent(transactionId)}`, signal ? { signal } : undefined);
      const payload = response?.data ?? response;
      const record = payload?.data?.transaction ?? payload?.transaction ?? null;
      if (!record) { const malformed = new Error('Missing transaction payload'); malformed.response = { status: 502 }; throw malformed; }
      setTransaction(record);
    } catch (requestError) {
      if (requestError?.name === 'AbortError' || requestError?.code === 'ERR_CANCELED' || requestError?.name === 'CanceledError') return;
      const status = Number(requestError?.response?.status ?? 0);
      setTransaction(null);
      setError(status === 400 ? { title: 'Invalid transaction ID', message: 'The transaction identifier is not valid.' } : status === 401 ? { title: 'Sign-in required', message: 'Sign in to view this transaction.' } : status === 403 ? { title: 'Access denied', message: 'You do not have permission to view this transaction.' } : status === 404 ? { title: 'Transaction not found', message: 'The transaction is not available in your authorized institution.' } : { title: 'Savings service unavailable', message: 'The transaction record could not be loaded.' });
    } finally { setLoading(false); }
  }, [transactionId]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load, attempt]);
  if (loading) return <main className="titech-detail-page"><div className="titech-detail-loading"><span className="titech-detail-spinner" />Loading savings transaction…</div></main>;
  if (error || !transaction) return <main className="titech-detail-page"><button className="titech-detail-back" type="button" onClick={() => navigate('/savings')}><ArrowLeft size={17} /> Back to Savings</button><section className="titech-detail-state" role="alert"><AlertCircle size={28} /><h1>{error?.title || 'Transaction unavailable'}</h1><p>{error?.message || 'The requested transaction could not be loaded.'}</p><div className="titech-detail-actions"><button className="titech-button titech-button-primary" type="button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} /> Try again</button><Link className="titech-button" to="/savings">Savings portfolio</Link></div></section></main>;
  return <main className="titech-detail-page" aria-labelledby="savings-transaction-title"><div className="titech-detail-breadcrumb"><Link to="/savings">Savings</Link><span aria-hidden="true">/</span><span>Transaction details</span></div><header className="titech-detail-hero"><div className="titech-detail-identity"><div className="titech-avatar"><Wallet size={26} /></div><div><p className="titech-detail-eyebrow">TITech Community Capital · Community Finance. Stronger Together.</p><h1 id="savings-transaction-title">{display(transaction.type).replace(/_/g, ' ')} transaction</h1><p className="titech-detail-reference">Reference: {display(transaction.reference)}</p><div className="titech-detail-badges"><span className={`titech-status titech-status-${String(transaction.status || 'unknown').toLowerCase()}`}>{display(transaction.status)}</span></div></div></div><button className="titech-detail-back" type="button" onClick={() => navigate('/savings')}><ArrowLeft size={17} /> Back to Savings</button></header><section className="titech-detail-card"><div className="titech-detail-card-heading"><ShieldCheck size={18} /><h2>Recorded transaction details</h2></div><div className="titech-detail-fields"><div className="titech-detail-field"><span>Transaction reference</span><strong>{display(transaction.reference)}</strong></div><div className="titech-detail-field"><span>Type</span><strong>{display(transaction.transactionType)}</strong></div><div className="titech-detail-field"><span>Amount</span><strong>{money(transaction.amount, transaction.currency)}</strong></div><div className="titech-detail-field"><span>Currency</span><strong>{display(transaction.currency)}</strong></div><div className="titech-detail-field"><span>Provider / channel</span><strong>{display(transaction.channel)}</strong></div><div className="titech-detail-field"><span>Status</span><strong>{display(transaction.status)}</strong></div><div className="titech-detail-field"><span>Member</span><strong>{display(transaction.memberName)}</strong></div><div className="titech-detail-field"><span>Savings account</span><strong>{display(transaction.savingsNumber)}</strong></div><div className="titech-detail-field"><span>Created</span><strong>{display(transaction.createdAt)}</strong></div></div><p className="titech-detail-note">This page displays a persisted Transaction record only. It does not infer settlement, ledger posting or a current savings balance from the transaction status. Verify the linked financial transaction, ledger and reconciliation evidence before treating funds as settled.</p></section></main>;
}
