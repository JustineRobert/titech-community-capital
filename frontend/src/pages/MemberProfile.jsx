import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, BriefcaseBusiness, CalendarDays, CreditCard, Mail, MapPin, Phone, RefreshCw, ShieldCheck, UserRound, Wallet } from 'lucide-react';
import api from '../services/api';
import './enterprise-detail.css';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

function getErrorState(error) {
  const status = Number(error?.response?.status ?? error?.status ?? 0);
  if (status === 401) return { title: 'Sign-in required', message: 'Your session is no longer valid. Sign in to view this member profile.' };
  if (status === 403) return { title: 'Access denied', message: 'Your account does not have permission to view this member profile.' };
  if (status === 404) return { title: 'Member not found', message: 'No member record with this identifier is available in your authorized institution.' };
  if (status === 400) return { title: 'Invalid member ID', message: 'The member identifier is not valid.' };
  return { title: 'Member service unavailable', message: 'The member profile could not be loaded. Check the connection and try again.' };
}

function display(value, fallback = 'Not provided') {
  return value === null || value === undefined || String(value).trim() === '' ? fallback : String(value);
}

function formatDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium' }).format(date);
}

function statusClass(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

function Section({ title, icon: Icon, children }) {
  return (
    <section className="titech-detail-card">
      <div className="titech-detail-card-heading">
        {Icon ? <Icon size={18} aria-hidden="true" /> : null}
        <h2>{title}</h2>
      </div>
      <div className="titech-detail-fields">{children}</div>
    </section>
  );
}

function Field({ label, value }) {
  return (
    <div className="titech-detail-field">
      <span>{label}</span>
      <strong>{display(value)}</strong>
    </div>
  );
}

export default function MemberProfile() {
  const { memberId = '' } = useParams();
  const navigate = useNavigate();
  const validId = OBJECT_ID_PATTERN.test(memberId);
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const loadMember = useCallback(async (signal) => {
    if (!validId) {
      setLoading(false);
      setError({ title: 'Invalid member ID', message: 'The member identifier must be a valid 24-character record ID.' });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(`/api/v1/members/${encodeURIComponent(memberId)}`, signal ? { signal } : undefined);
      const payload = response?.data ?? response;
      const record = payload?.data?.member ?? payload?.member ?? null;
      if (!record || typeof record !== 'object') {
        const malformed = new Error('Member response did not contain a member record.');
        malformed.response = { status: 502 };
        throw malformed;
      }
      setMember(record);
    } catch (requestError) {
      if (requestError?.name === 'AbortError' || requestError?.code === 'ERR_CANCELED' || requestError?.name === 'CanceledError') return;
      setMember(null);
      setError(getErrorState(requestError));
    } finally {
      setLoading(false);
    }
  }, [memberId, validId]);

  useEffect(() => {
    const controller = new AbortController();
    loadMember(controller.signal);
    return () => controller.abort();
  }, [loadMember, attempt]);

  const fullName = useMemo(() => {
    if (!member) return 'Member profile';
    return member.fullName || [member.firstName, member.otherNames, member.lastName].filter(Boolean).join(' ') || 'Unnamed member';
  }, [member]);

  const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'M';

  if (loading) {
    return <main className="titech-detail-page" aria-busy="true"><div className="titech-detail-loading"><span className="titech-detail-spinner" />Loading the authorized member record…</div></main>;
  }

  if (error || !member) {
    const state = error || { title: 'Member not found', message: 'The requested member record is unavailable.' };
    return (
      <main className="titech-detail-page">
        <button className="titech-detail-back" type="button" onClick={() => navigate('/members')}><ArrowLeft size={17} /> Back to Members</button>
        <section className="titech-detail-state" role="alert">
          <AlertCircle size={28} aria-hidden="true" />
          <h1>{state.title}</h1>
          <p>{state.message}</p>
          <div className="titech-detail-actions">
            <button className="titech-button titech-button-primary" type="button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} /> Try again</button>
            <Link className="titech-button" to="/members">Members directory</Link>
          </div>
        </section>
      </main>
    );
  }

  const memberStatus = member.memberStatus || member.status || 'UNKNOWN';
  const kycStatus = member.kycStatus || (member.kycVerified ? 'VERIFIED' : 'PENDING');

  return (
    <main className="titech-detail-page" aria-labelledby="member-profile-title">
      <div className="titech-detail-breadcrumb"><Link to="/members">Members</Link><span aria-hidden="true">/</span><span>Member profile</span></div>
      <header className="titech-detail-hero">
        <div className="titech-detail-identity">
          <div className="titech-avatar" aria-hidden="true">{initials}</div>
          <div>
            <p className="titech-detail-eyebrow">TITech Community Capital · Community Finance. Stronger Together.</p>
            <h1 id="member-profile-title">{fullName}</h1>
            <p className="titech-detail-reference">Member reference: {display(member.memberNumber, member._id || member.id)}</p>
            <div className="titech-detail-badges">
              <span className={`titech-status titech-status-${statusClass(memberStatus)}`}>{String(memberStatus).replace(/_/g, ' ')}</span>
              <span className={`titech-status titech-status-${statusClass(kycStatus)}`}>KYC: {String(kycStatus).replace(/_/g, ' ')}</span>
            </div>
          </div>
        </div>
        <button className="titech-detail-back" type="button" onClick={() => navigate('/members')}><ArrowLeft size={17} /> Back to Members</button>
      </header>

      <div className="titech-detail-grid">
        <Section title="Personal information" icon={UserRound}>
          <Field label="First name" value={member.firstName} />
          <Field label="Other names" value={member.otherNames} />
          <Field label="Last name" value={member.lastName} />
          <Field label="Gender" value={member.gender} />
          <Field label="Date of birth" value={formatDate(member.dateOfBirth)} />
          <Field label="Occupation" value={member.occupation} />
          <Field label="Employer" value={member.employer} />
        </Section>

        <Section title="Contact and location" icon={Phone}>
          <Field label="Phone" value={member.phoneNumber} />
          <Field label="Alternate phone" value={member.alternatePhoneNumber} />
          <Field label="Email" value={member.email} />
          <Field label="Address" value={member.address} />
          <Field label="District" value={member.district} />
          <Field label="Sub-county" value={member.subCounty} />
          <Field label="Village" value={member.village} />
        </Section>

        <Section title="Membership information" icon={CalendarDays}>
          <Field label="Member reference" value={member.memberNumber} />
          <Field label="Membership status" value={memberStatus} />
          <Field label="Joined" value={formatDate(member.joinedAt)} />
          <Field label="Registered" value={formatDate(member.createdAt)} />
          <Field label="Last updated" value={formatDate(member.updatedAt)} />
        </Section>

        <Section title="Identity and verification" icon={ShieldCheck}>
          <Field label="KYC status" value={kycStatus} />
          <Field label="KYC verified" value={member.kycVerified ? 'Yes' : 'Not verified'} />
          <p className="titech-detail-note">Identity document numbers and protected KYC files are intentionally not exposed in this general member profile.</p>
        </Section>
      </div>

      <section className="titech-detail-card titech-detail-finance-card">
        <div className="titech-detail-card-heading"><Wallet size={18} aria-hidden="true" /><h2>Financial information</h2></div>
        <p>Member-specific savings and loan information is available through the institution-scoped workspaces. This profile does not calculate or infer financial balances.</p>
        <div className="titech-detail-actions">
          <button className="titech-button titech-button-primary" type="button" onClick={() => navigate(`/savings/accounts?memberId=${encodeURIComponent(member._id || member.id)}`)}><Wallet size={16} /> Open member savings</button>
          <button className="titech-button" type="button" onClick={() => navigate(`/loans?memberId=${encodeURIComponent(member._id || member.id)}`)}><CreditCard size={16} /> Open member loans</button>
        </div>
        <p className="titech-detail-note">Balances shown in those modules remain read models; ledger and reconciliation evidence remain authoritative.</p>
      </section>
    </main>
  );
}
