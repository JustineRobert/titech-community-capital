import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CalendarDays, CreditCard, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import api from '../services/api';
import { formatExactIntegerCurrency } from '../utils/moneyDisplay';
import './enterprise-detail.css';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const money = (value, currency = 'UGX') => {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  return formatExactIntegerCurrency(value, currency, 'en-UG');
};
const date = (value) => {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium' }).format(parsed);
};
const text = (value) => value === null || value === undefined || value === '' ? 'Not recorded' : String(value);

function Field({ label, value }) { return <div className="titech-detail-field"><span>{label}</span><strong>{value}</strong></div>; }

export default function LoanDetails() {
  const { loanId = '' } = useParams();
  const navigate = useNavigate();
  const [loan, setLoan] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(async (signal) => {
    if (!OBJECT_ID_PATTERN.test(loanId)) { setError({ title: 'Invalid loan ID', message: 'The loan identifier is not valid.' }); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const response = await api.get(`/api/v1/loans/${encodeURIComponent(loanId)}`, signal ? { signal } : undefined);
      const payload = response?.data ?? response;
      const record = payload?.data?.loan ?? payload?.loan ?? null;
      if (!record) { const missing = new Error('Loan record unavailable'); missing.response = { status: 502 }; throw missing; }
      setLoan(record);
    } catch (requestError) {
      if (requestError?.name === 'AbortError' || requestError?.code === 'ERR_CANCELED' || requestError?.name === 'CanceledError') return;
      const status = Number(requestError?.response?.status ?? 0);
      setLoan(null);
      setError(status === 400 ? { title: 'Invalid loan ID', message: 'The loan identifier is not valid.' } : status === 401 ? { title: 'Sign-in required', message: 'Sign in to view this loan.' } : status === 403 ? { title: 'Access denied', message: 'You do not have permission to view this loan.' } : status === 404 ? { title: 'Loan not found', message: 'The loan does not exist in your authorized institution.' } : { title: 'Loan service unavailable', message: 'The loan record could not be loaded. Please retry.' });
    } finally { setLoading(false); }
  }, [loanId]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load, attempt]);

  if (loading) return <main className="titech-detail-page"><div className="titech-detail-loading"><span className="titech-detail-spinner" />Loading loan record…</div></main>;
  if (error || !loan) return <main className="titech-detail-page"><button className="titech-detail-back" onClick={() => navigate('/loans')} type="button"><ArrowLeft size={17} /> Back to Loans</button><section className="titech-detail-state" role="alert"><AlertCircle size={28} /><h1>{error?.title || 'Loan unavailable'}</h1><p>{error?.message || 'The loan record is unavailable.'}</p><div className="titech-detail-actions"><button className="titech-button titech-button-primary" type="button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} /> Try again</button><Link className="titech-button" to="/loans">Loans portfolio</Link></div></section></main>;

  const member = loan.member || {};
  const borrowerName = member.fullName || [member.firstName, member.otherNames, member.lastName].filter(Boolean).join(' ') || loan.memberName;
  return (
    <main className="titech-detail-page" aria-labelledby="loan-detail-title">
      <div className="titech-detail-breadcrumb"><Link to="/loans">Loans</Link><span aria-hidden="true">/</span><span>Loan details</span></div>
      <header className="titech-detail-hero">
        <div className="titech-detail-identity"><div className="titech-avatar"><CreditCard size={26} /></div><div><p className="titech-detail-eyebrow">TITech Community Capital · Community Finance. Stronger Together.</p><h1 id="loan-detail-title">Loan {text(loan.loanNumber || loan.id)}</h1><p className="titech-detail-reference">Borrower: {text(borrowerName)}</p><div className="titech-detail-badges"><span className={`titech-status titech-status-${String(loan.status || 'unknown').toLowerCase()}`}>{text(loan.status)}</span></div></div></div>
        <button className="titech-detail-back" onClick={() => navigate('/loans')} type="button"><ArrowLeft size={17} /> Back to Loans</button>
      </header>
      <div className="titech-detail-grid">
        <section className="titech-detail-card"><div className="titech-detail-card-heading"><UserRound size={18} /><h2>Borrower and account</h2></div><div className="titech-detail-fields"><Field label="Member" value={text(borrowerName)} /><Field label="Member reference" value={text(member.memberNumber)} /><Field label="Group reference" value={text(loan.groupId)} /><Field label="Loan record ID" value={text(loan.id || loan._id)} /></div></section>
        <section className="titech-detail-card"><div className="titech-detail-card-heading"><CreditCard size={18} /><h2>Loan terms and status</h2></div><div className="titech-detail-fields"><Field label="Purpose" value={text(loan.purpose)} /><Field label="Requested principal" value={money(loan.amount, loan.currency || 'UGX')} /><Field label="Interest rate" value={loan.interestRate == null ? 'Not recorded' : `${loan.interestRate}%`} /><Field label="Repayment period" value={loan.repaymentPeriodMonths == null ? 'Not recorded' : `${loan.repaymentPeriodMonths} months`} /><Field label="Workflow status" value={text(loan.status)} /><Field label="Credit decision" value={text(loan.creditDecision)} /></div></section>
        <section className="titech-detail-card"><div className="titech-detail-card-heading"><CalendarDays size={18} /><h2>Repayment record</h2></div><div className="titech-detail-fields"><Field label="Amount repaid (loan record)" value={money(loan.amountRepaid, loan.currency || 'UGX')} /><Field label="Outstanding aggregate (loan record)" value={money(loan.outstandingBalance, loan.currency || 'UGX')} /><Field label="Amount due (loan record)" value={money(loan.amountDue, loan.currency || 'UGX')} /><Field label="Days past due" value={loan.daysPastDue == null ? 'Not recorded' : loan.daysPastDue} /><Field label="Created" value={date(loan.createdAt)} /><Field label="Last updated" value={date(loan.updatedAt)} /></div></section>
        <section className="titech-detail-card"><div className="titech-detail-card-heading"><ShieldCheck size={18} /><h2>Disbursement evidence</h2></div><div className="titech-detail-fields"><Field label="Disbursement method" value={text(loan.disbursementMethod)} /><Field label="Disbursement reference" value={text(loan.disbursementReference)} /><Field label="Recorded disbursed amount" value={money(loan.disbursedAmount, loan.currency || 'UGX')} /></div><p className="titech-detail-note">Loan workflow fields and portfolio aggregates are not proof of a posted disbursement. Confirm the related transaction, ledger posting and settlement evidence in the authoritative financial services.</p></section>
      </div>
      <section className="titech-detail-card"><div className="titech-detail-card-heading"><CalendarDays size={18} /><h2>Repayment schedule</h2></div>{Array.isArray(loan.installments) && loan.installments.length ? <div className="titech-detail-table-wrap"><table className="titech-detail-table"><thead><tr><th>Installment</th><th>Due date</th><th>Amount</th><th>Status</th></tr></thead><tbody>{loan.installments.map((item, index) => <tr key={item._id || index}><td>{index + 1}</td><td>{date(item.dueDate)}</td><td>{money(item.amount, loan.currency || 'UGX')}</td><td>{text(item.status)}</td></tr>)}</tbody></table></div> : <p className="titech-detail-note">No repayment schedule is recorded on this loan record.</p>}</section>
    </main>
  );
}
