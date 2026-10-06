import React, { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const BASE_ROLES = ['guest', 'member'];
export default function AccessGovernance() {
  const { user } = useAuth(); const [users, setUsers] = useState([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(null);
  const canGovern = useMemo(() => ['platform_admin', 'tenant_admin'].includes(String(user?.role || '').toLowerCase()), [user]);
  const roles = useMemo(() => user?.role === 'platform_admin' ? [...BASE_ROLES, 'tenant_admin'] : BASE_ROLES, [user]);
  useEffect(() => { let alive = true; api.get('/api/rbac/users').then((r) => { if (alive) setUsers(r?.data?.data || []) }).catch((e) => { if (alive) setError(e?.response?.data?.message || 'Unable to load users.') }); return () => { alive = false } }, []);
  async function setRole(target, role) { setBusy(target.id); setError(''); try { await api.patch(`/api/rbac/users/${target.id}/role`, { role }); setUsers((current) => current.map((item) => item.id === target.id ? { ...item, role } : item)); } catch (e) { setError(e?.response?.data?.message || 'Role update failed.') } finally { setBusy(null) } }
  if (!canGovern) return <section className="titech-brand-card"><h1>Access Governance</h1><p>You are not authorized to manage roles.</p></section>;
  return <section className="titech-brand-card" style={{ padding: '1.5rem' }}><h1>Access Governance</h1><p>Authoritative role administration for the current tenant scope.</p>{error && <p role="alert">{error}</p>}<div style={{ overflowX: 'auto' }}><table><thead><tr><th>User</th><th>Tenant</th><th>Role</th><th>Action</th></tr></thead><tbody>{users.map((item) => <tr key={item.id}><td>{item.name || item.email}<br /><small>{item.email}</small></td><td>{item.tenantId || '—'}</td><td><strong>{item.role}</strong></td><td><select value={item.role} onChange={(e) => setRole(item, e.target.value)} disabled={busy === item.id}><option value={item.role}>{item.role}</option>{roles.filter((r) => r !== item.role).map((r) => <option value={r} key={r}>{r}</option>)}</select></td></tr>)}</tbody></table></div></section>;
}