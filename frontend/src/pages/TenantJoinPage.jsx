import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import TITECH_BRAND from '../branding/brand';
import './TenantJoinPage.css';

const CODE_MIN_LENGTH = 16;
const CODE_MAX_LENGTH = 256;

function responseMessage(error) {
  const body = error?.response?.data;
  if (body?.code === 'TENANT_INVITATION_INVALID_OR_UNAVAILABLE') {
    return 'The invitation code is invalid, expired, revoked, or has reached its usage limit. Ask the issuing institution administrator for a valid code.';
  }
  if (body?.code === 'TENANT_MEMBERSHIP_ALREADY_EXISTS') {
    return 'This account is already connected to a tenant. Contact an administrator if you believe that is incorrect.';
  }
  if (body?.code === 'TENANT_JOIN_TRANSACTION_UNAVAILABLE') {
    return 'Secure membership activation is temporarily unavailable because the database transaction service is not ready. No membership was activated.';
  }
  return body?.message || error?.message || 'Tenant membership could not be activated.';
}

export default function TenantJoinPage() {
  const { user, refreshToken } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;

    const normalizedCode = code.trim();
    if (normalizedCode.length < CODE_MIN_LENGTH || normalizedCode.length > CODE_MAX_LENGTH || /[\s\u0000-\u001f]/.test(normalizedCode)) {
      setError('Enter the valid invitation code provided by your institution administrator.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const response = await api.post('/auth/tenant-invitations/redeem', { code: normalizedCode });
      const result = response?.data?.data;
      if (response?.data?.success !== true || result?.membershipStatus !== 'active') {
        throw new Error('The server did not confirm tenant membership activation.');
      }

      setSuccess(true);
      toast.success('Your tenant membership is active.');

      // Refresh the cookie-backed session, then reload the protected application
      // so AuthContext hydrates the persisted tenant identity from /me.
      await refreshToken({ reason: 'tenant-invitation-redemption' });
      window.location.replace('/create-group');
    } catch (caught) {
      const message = responseMessage(caught);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="tenant-join-page" aria-labelledby="tenant-join-title">
      <section className="tenant-join-card">
        <div className="tenant-join-brand">
          <span className="tenant-join-icon" aria-hidden="true"><KeyRound size={22} /></span>
          <div>
            <p className="tenant-join-eyebrow">{TITECH_BRAND.fullName}</p>
            <p className="tenant-join-tagline">{TITECH_BRAND.tagline}</p>
          </div>
        </div>

        <h1 id="tenant-join-title">Join your institution</h1>
        <p className="tenant-join-intro">
          Tenant membership connects your account to an institution. A valid invitation code is required before you can create or join community groups.
        </p>

        <div className="tenant-join-security" role="note">
          <ShieldCheck size={19} aria-hidden="true" />
          <span>The code is validated by TITech's server. The tenant is resolved from the invitation record; you cannot choose or submit a tenant ID.</span>
        </div>

        <form onSubmit={submit} noValidate>
          <label htmlFor="tenant-invitation-code">Institution invitation code</label>
          <input
            id="tenant-invitation-code"
            name="code"
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck="false"
            maxLength={CODE_MAX_LENGTH}
            placeholder="Paste the code supplied by your administrator"
            disabled={busy || success}
            required
          />

          {error && <p className="tenant-join-error" role="alert">{error}</p>}

          <button type="submit" disabled={busy || success || code.trim().length < CODE_MIN_LENGTH}>
            {busy ? 'Validating invitation…' : 'Verify and join institution'}
            {!busy && <ArrowRight size={17} aria-hidden="true" />}
          </button>
        </form>

        {success && <p className="tenant-join-success" role="status">Membership has been activated. Refreshing your authenticated workspace…</p>}

        <p className="tenant-join-account">
          Signed in as <strong>{user?.email || 'your TITech account'}</strong>. <Link to="/dashboard">Return to dashboard</Link>
        </p>
      </section>
    </main>
  );
}
