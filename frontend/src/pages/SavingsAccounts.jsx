import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, RefreshCw, Search, Wallet } from 'lucide-react';
import api from '../services/api';
import { formatExactIntegerCurrency } from '../utils/moneyDisplay';
import './SavingsAccounts.css';

const PAGE_SIZE = 25;
const formatCurrency = (value, currency = 'UGX') => {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  return formatExactIntegerCurrency(value, currency, 'en-UG');
};
const display = (value) => value === null || value === undefined || value === '' ? 'Not recorded' : String(value);

export default function SavingsAccounts() {
  const [params] = useSearchParams();
  const memberId = params.get('memberId') || '';
  const [accounts, setAccounts] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const response = await api.get('/api/v1/savings/accounts', {
        params: { page, limit: PAGE_SIZE, search: search || undefined, status: status === 'all' ? undefined : status, memberId: memberId || undefined },
      });
      const payload = response?.data ?? response;
      const data = payload?.data ?? payload;
      setAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
      setTotal(Number(data?.pagination?.total ?? data?.total ?? 0));
      setPages(Math.max(1, Number(data?.pagination?.pages ?? 1)));
    } catch (requestError) {
      const code = Number(requestError?.response?.status ?? 0);
      setAccounts([]);
      setError(code === 401 ? 'Your session has expired. Sign in again.' : code === 403 ? 'You do not have permission to view savings accounts.' : 'Savings accounts are temporarily unavailable. Please retry.');
    } finally { setLoading(false); setRefreshing(false); }
  }, [page, search, status, memberId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status]);

  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  const isMemberScoped = Boolean(memberId);

  return (
    <main className="titech-savings-accounts" aria-labelledby="savings-accounts-title">
      <header className="titech-savings-accounts-header">
        <div>
          <p className="titech-savings-accounts-eyebrow">TITech Community Capital · Community Finance. Stronger Together.</p>
          <h1 id="savings-accounts-title">Savings accounts</h1>
          <p>{isMemberScoped ? 'Accounts linked to the selected member.' : 'Tenant-scoped savings accounts. Balance snapshots are read models, not ledger authority.'}</p>
        </div>
        <div className="titech-savings-accounts-actions">
          <Link to="/savings">Transaction activity</Link>
          <button type="button" onClick={() => load({ silent: true })} disabled={refreshing} aria-busy={refreshing}><RefreshCw size={16} /> {refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      <section className="titech-savings-accounts-filters" aria-label="Savings account filters">
        <label><Search size={17} aria-hidden="true" /><span className="sr-only">Search accounts</span><input value={search} onChange={(event) => setSearch(event.target.value.slice(0, 100))} placeholder="Search account number, name or product" /></label>
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="dormant">Dormant</option><option value="blocked">Blocked</option><option value="closed">Closed</option></select></label>
      </section>

      {error ? <section className="titech-savings-accounts-state" role="alert"><AlertCircle size={24} /><h2>Account data unavailable</h2><p>{error}</p><button type="button" onClick={() => load()}><RefreshCw size={16} /> Retry</button></section> : null}
      {loading ? <div className="titech-savings-accounts-state" role="status" aria-busy="true">Loading savings accounts…</div> : !error && accounts.length === 0 ? <div className="titech-savings-accounts-state"><Wallet size={28} /><h2>No savings accounts found</h2><p>No account records match the current tenant and filter criteria.</p></div> : null}

      {!loading && !error && accounts.length > 0 ? <section className="titech-savings-accounts-table-wrap" aria-label="Savings account directory">
        <div className="titech-savings-accounts-count" role="status">Showing {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()} accounts</div>
        <div className="titech-savings-accounts-scroll"><table><thead><tr><th>Account</th><th>Member</th><th>Product</th><th>Status</th><th>Balance snapshot</th><th>Reconciliation</th><th>Action</th></tr></thead><tbody>
          {accounts.map((account) => <tr key={account.id || account._id}><td><strong>{display(account.savingsNumber)}</strong><span>{display(account.savingsName)}</span></td><td><strong>{display(account.memberName)}</strong><span>{display(account.member?.memberNumber)}</span></td><td>{display(account.savingsType)}</td><td><span className={`titech-savings-status titech-savings-status-${String(account.status || 'unknown').toLowerCase()}`}>{display(account.status)}</span></td><td className="titech-savings-money">{formatCurrency(account.balance, account.currency)}</td><td>{display(account.reconciliationStatus)}</td><td><Link to={`/savings/accounts/${encodeURIComponent(account.id || account._id)}`}>View account</Link></td></tr>)}
        </tbody></table></div>
        <footer className="titech-savings-accounts-pagination"><span>Page {page} of {pages}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button type="button" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Next</button></div></footer>
        <p className="titech-savings-accounts-disclaimer">Account balance figures are read-model snapshots. Verify balances against the canonical ledger and reconciliation services before making financial decisions.</p>
      </section> : null}
    </main>
  );
}
