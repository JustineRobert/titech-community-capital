import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nProvider.jsx';
import { listMyEduFinanceApplications, submitEduFinanceApplication } from '../../services/eduFinanceApi';
import { buildEduFinanceApplicationPayload } from './eduFinanceFormPolicy.mjs';
import './edufinance.css';

const APPLICATIONS_ENABLED = import.meta.env.VITE_TITECH_EDUFINANCE_APPLICATIONS_ENABLED === 'true';
const EMPTY_FORM = Object.freeze({
  applicationType: 'TUITION_FEES',
  guardianRelationship: 'PARENT',
  schoolTenantId: '',
  schoolReference: '',
  studentBeneficiaryReference: '',
  academicYearReference: '',
  academicTermReference: '',
  invoiceReference: '',
  invoiceVersion: '1',
  guardianAuthorityReference: '',
  guardianConsentReference: '',
  invoiceAmountUgx: '',
  alreadyPaidAmountUgx: '0',
  requestedAmountUgx: '',
});

function formatUgx(value, locale) {
  if (!Number.isSafeInteger(Number(value))) return 'Amount unavailable';
  return new Intl.NumberFormat(locale || 'en-UG', { style: 'currency', currency: 'UGX', maximumFractionDigits: 0 }).format(Number(value));
}

function formatDate(value, locale) {
  if (!value) return 'Date not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Date not recorded' : new Intl.DateTimeFormat(locale || 'en-UG', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function errorMessage(error) {
  return error?.response?.data?.error?.message || error?.response?.data?.message || error?.message || 'The request could not be completed.';
}

export default function EduFinancePage() {
  const { t, direction, locale } = useI18n();
  const { authenticated, authReady } = useAuth();
  const text = (key) => t(`education.${key}`);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [applications, setApplications] = useState([]);
  const [loadingApplications, setLoadingApplications] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const idempotencyRef = useRef({ fingerprint: null, key: null });

  const loadApplications = useCallback(async () => {
    if (!APPLICATIONS_ENABLED || !authenticated) return;
    setLoadingApplications(true);
    setError('');
    try {
      const rows = await listMyEduFinanceApplications();
      setApplications(rows);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoadingApplications(false);
    }
  }, [authenticated]);

  useEffect(() => {
    let active = true;
    if (!APPLICATIONS_ENABLED || !authenticated) return () => { active = false; };
    setLoadingApplications(true);
    listMyEduFinanceApplications()
      .then((rows) => { if (active) setApplications(rows); })
      .catch((loadError) => { if (active) setError(errorMessage(loadError)); })
      .finally(() => { if (active) setLoadingApplications(false); });
    return () => { active = false; };
  }, [authenticated]);

  const update = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    let payload;
    try {
      payload = buildEduFinanceApplicationPayload(form);
    } catch (validationError) {
      setError(validationError.message);
      return;
    }
    if (!globalThis.crypto?.randomUUID) {
      setError('This browser cannot generate a secure request identifier. Update the browser or use a secure supported browser context.');
      return;
    }
    const fingerprint = JSON.stringify(payload);
    if (idempotencyRef.current.fingerprint !== fingerprint || !idempotencyRef.current.key) {
      idempotencyRef.current = { fingerprint, key: globalThis.crypto.randomUUID() };
    }

    setSubmitting(true);
    try {
      const created = await submitEduFinanceApplication(payload, idempotencyRef.current.key);
      idempotencyRef.current = { fingerprint: null, key: null };
      setNotice(`Request submitted. Reference: ${created.id || 'available in My requests'}. School, invoice and guardian evidence still require partner verification; no credit decision or financing has been made.`);
      setForm({ ...EMPTY_FORM });
      await loadApplications();
    } catch (submitError) {
      // Keep the same idempotency key for a safe retry of the unchanged payload.
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="titech-edufinance-page" dir={direction}>
      <header className="titech-edufinance-hero">
        <p className="titech-edufinance-eyebrow">TITech Community Capital · TITech Capital LTD</p>
        <h1>{text('eduFinanceTitle')}</h1>
        <p className="titech-edufinance-subtitle">{text('eduFinanceSubtitle')}</p>
        <p className="titech-edufinance-tagline">{text('eduFinanceTagline')}</p>
        <p>{text('eduFinanceDescription')}</p>
        <div className="titech-edufinance-actions">
          <Link className="titech-edufinance-button titech-edufinance-button--primary" to="/book-a-demo">{text('eduFinancePartnerEnquiry')}</Link>
          <Link className="titech-edufinance-button titech-edufinance-button--secondary" to="/education-support">{text('eduFinanceCommunitySupport')}</Link>
        </div>
      </header>

      <section className="titech-edufinance-grid" aria-label={text('eduFinanceControlsHeading')}>
        <article className="titech-edufinance-card"><h2>{text('eduFinanceBorrowerHeading')}</h2><p>{text('eduFinanceBorrower')}</p></article>
        <article className="titech-edufinance-card"><h2>{text('eduFinancePartnerHeading')}</h2><p>{text('eduFinancePartner')}</p></article>
        <article className="titech-edufinance-card"><h2>{text('eduFinanceControlsHeading')}</h2><p>{text('eduFinanceControls')}</p></article>
      </section>

      <aside className="titech-edufinance-notice" role="note">
        <strong>{text('eduFinanceCurrentStateHeading')}</strong>
        <p>{text('eduFinanceCurrentState')}</p>
        <p>{text('eduFinanceAvailability')}</p>
      </aside>

      {APPLICATIONS_ENABLED && authenticated && (
        <section className="titech-edufinance-intake" aria-labelledby="edufinance-intake-title">
          <div className="titech-edufinance-section-heading">
            <div><p className="titech-edufinance-eyebrow">Authenticated applicant workspace</p><h2 id="edufinance-intake-title">School-fees request intake</h2></div>
            <span className="titech-edufinance-state">Partner verification pending</span>
          </div>
          <p className="titech-edufinance-privacy">Use school-issued references only. Do not enter a student's name, national ID, date of birth, contact details or other unnecessary personal information. The references and amounts you submit are declarations, not independently verified evidence.</p>
          <form className="titech-edufinance-form" onSubmit={submit}>
            <label>Financing purpose<select name="applicationType" value={form.applicationType} onChange={update}><option value="TUITION_FEES">Tuition fees</option><option value="EXAMINATION_FEES">Examination fees</option><option value="BOARDING_FEES">Boarding fees</option><option value="VOCATIONAL_TUITION">Vocational tuition</option></select></label>
            <label>Applicant relationship<select name="guardianRelationship" value={form.guardianRelationship} onChange={update}><option value="PARENT">Parent</option><option value="LEGAL_GUARDIAN">Legal guardian</option><option value="AUTHORIZED_CAREGIVER">Authorized caregiver</option></select></label>
            <label>School tenant reference<input name="schoolTenantId" value={form.schoolTenantId} onChange={update} required maxLength={100} autoComplete="off" /></label>
            <label>School reference<input name="schoolReference" value={form.schoolReference} onChange={update} required maxLength={128} autoComplete="off" /></label>
            <label>School-issued student beneficiary reference<input name="studentBeneficiaryReference" value={form.studentBeneficiaryReference} onChange={update} required maxLength={128} autoComplete="off" /></label>
            <label>Academic year reference<input name="academicYearReference" value={form.academicYearReference} onChange={update} required maxLength={80} /></label>
            <label>Academic term reference<input name="academicTermReference" value={form.academicTermReference} onChange={update} required maxLength={80} /></label>
            <label>School invoice reference<input name="invoiceReference" value={form.invoiceReference} onChange={update} required maxLength={128} /></label>
            <label>Invoice version<input name="invoiceVersion" type="number" min="1" step="1" value={form.invoiceVersion} onChange={update} required /></label>
            <label>Guardian authority evidence reference<input name="guardianAuthorityReference" value={form.guardianAuthorityReference} onChange={update} required maxLength={128} /></label>
            <label>Guardian consent evidence reference<input name="guardianConsentReference" value={form.guardianConsentReference} onChange={update} required maxLength={128} /></label>
            <label>Invoice amount (UGX)<input name="invoiceAmountUgx" type="number" min="1" step="1" value={form.invoiceAmountUgx} onChange={update} required inputMode="numeric" /></label>
            <label>Amount already paid (UGX)<input name="alreadyPaidAmountUgx" type="number" min="0" step="1" value={form.alreadyPaidAmountUgx} onChange={update} required inputMode="numeric" /></label>
            <label>Requested amount (UGX)<input name="requestedAmountUgx" type="number" min="1" step="1" value={form.requestedAmountUgx} onChange={update} required inputMode="numeric" /></label>
            <div className="titech-edufinance-form-actions"><button className="titech-edufinance-button titech-edufinance-button--primary" type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit request for partner review'}</button><span>Submission is not a loan approval, offer or disbursement.</span></div>
          </form>
          {error && <p className="titech-edufinance-feedback titech-edufinance-feedback--error" role="alert">{error}</p>}
          {notice && <p className="titech-edufinance-feedback titech-edufinance-feedback--success" role="status">{notice}</p>}
          <div className="titech-edufinance-applications"><h3>My requests</h3>{loadingApplications ? <p>Loading your requests…</p> : applications.length === 0 ? <p>No EduFinance requests are available for this account.</p> : applications.map((item) => <article className="titech-edufinance-application" key={item.id}><div><strong>{item.invoiceReference}</strong><span>{item.applicationType?.replaceAll('_', ' ')}</span></div><div><strong>{formatUgx(item.requestedAmountMinor, locale)}</strong><span>{item.status}</span></div><small>Submitted {formatDate(item.submittedAt, locale)} · School {item.schoolVerificationStatus} · Invoice {item.invoiceVerificationStatus} · Guardian {item.guardianAuthorityVerificationStatus}</small></article>)}</div>
        </section>
      )}

      {APPLICATIONS_ENABLED && authReady && !authenticated && (
        <section className="titech-edufinance-intake titech-edufinance-signin"><h2>Sign in to submit a school-fees request</h2><p>Application access is limited to authenticated applicants. Your account and tenant permissions are checked by the TITech backend.</p><Link className="titech-edufinance-button titech-edufinance-button--primary" to="/login?redirect=%2Fedufinance">Sign in</Link></section>
      )}
    </main>
  );
}
