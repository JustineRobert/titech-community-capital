import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { generateIdempotencyKey } from '../../services/api';
import './InstitutionalPublicPages.css';

const LEAD_ENDPOINT = '/api/v1/public/institutional-leads';

const INTEREST_OPTIONS = [
  ['RECONCILIATION_REPORTING', 'Reconciliation and reporting'],
  ['INSTITUTIONAL_INTEGRATIONS', 'Institutional integrations'],
  ['INSTITUTIONAL_PILOT', 'Institutional pilot'],
  ['INCLUSIVE_ONBOARDING', 'Inclusive onboarding for refugee and host communities'],
  ['AUTHORIZED_INSURANCE_ACCESS', 'Access through authorized insurance partners'],
  ['RETIREMENT_SUPPORT', 'Retirement and pension-support orchestration'],
  ['EDUCATION_FUNDRAISING', 'Education fundraising'],
  ['PARTNERSHIP', 'Partnership opportunities'],
  ['OTHER', 'Other'],
];

const ORGANIZATION_OPTIONS = [
  ['SACCO', 'SACCO or cooperative'],
  ['COOPERATIVE', 'Cooperative federation or community network'],
  ['MFI', 'Microfinance institution or licensed lender'],
  ['NGO_PROGRAMME', 'NGO or programme operator'],
  ['FINANCIAL_SOFTWARE_PROVIDER', 'Financial software provider'],
  ['PAYMENT_PROVIDER', 'Payment provider'],
  ['OTHER', 'Other institution'],
];

const CONTACT_OPTIONS = [
  ['INSTITUTIONAL_SALES', 'Institutional sales'],
  ['RECONCILIATION_REPORTING', 'Reconciliation and reporting'],
  ['TECHNICAL_INTEGRATION', 'Technical integration'],
  ['PARTNERSHIP', 'Partnership opportunities'],
  ['CUSTOMER_SUPPORT', 'Existing customer support'],
  ['PRIVACY_SECURITY', 'Privacy or security concern'],
  ['OTHER', 'Other business enquiry'],
];

const VOLUME_OPTIONS = [
  ['UNDER_1000', 'Under 1,000 records/month'],
  ['1000_10000', '1,000–10,000 records/month'],
  ['10000_100000', '10,000–100,000 records/month'],
  ['OVER_100000', 'Over 100,000 records/month'],
  ['UNSURE', 'Not sure'],
  ['PREFER_NOT_TO_SAY', 'Prefer not to say'],
];

function PageShell({ eyebrow, title, description, children }) {
  return (
    <div className="titech-public-page">
      <section className="titech-public-page__intro" aria-labelledby="public-page-title">
        <p className="titech-public-page__eyebrow">{eyebrow}</p>
        <h1 id="public-page-title">{title}</h1>
        <p className="titech-public-page__lead">{description}</p>
      </section>
      {children}
    </div>
  );
}

function Field({ label, name, children, required = false, hint }) {
  const id = `institutional-lead-${name}`;
  return (
    <div className="titech-public-form__field">
      <label htmlFor={id}>
        {label}{required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children({ id, name, required })}
      {hint ? <p className="titech-public-form__hint">{hint}</p> : null}
    </div>
  );
}

function SelectOptions({ options, placeholder = 'Select an option' }) {
  return (
    <>
      <option value="">{placeholder}</option>
      {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </>
  );
}

function PublicLeadForm({ type }) {
  const isDemo = type === 'DEMO';
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [confirmation, setConfirmation] = useState(null);
  const submissionKey = useRef(null);
  const submissionFingerprint = useRef(null);

  const title = isDemo ? 'Request an institutional demo' : 'Send an enquiry';

  const errorSummary = useMemo(() => Object.entries(fieldErrors)
    .flatMap(([field, messages]) => (Array.isArray(messages) ? messages.map((message) => `${field}: ${message}`) : [])), [fieldErrors]);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setErrorMessage('');
    setFieldErrors({});
    setConfirmation(null);

    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = {
      type,
      name: String(values.get('name') || ''),
      email: String(values.get('email') || ''),
      organization: String(values.get('organization') || ''),
      role: String(values.get('role') || ''),
      organizationType: String(values.get('organizationType') || ''),
      country: String(values.get('country') || ''),
      primaryInterest: String(values.get('primaryInterest') || ''),
      monthlyVolume: String(values.get('monthlyVolume') || ''),
      preferredDate: String(values.get('preferredDate') || ''),
      timezone: String(values.get('timezone') || 'Africa/Kampala'),
      category: String(values.get('category') || ''),
      subject: String(values.get('subject') || ''),
      message: String(values.get('message') || ''),
      consentToContact: values.get('consentToContact') === 'on',
      website: String(values.get('website') || ''),
    };

    const stableSubmission = JSON.stringify(payload);
    if (!submissionKey.current || submissionFingerprint.current !== stableSubmission) {
      submissionKey.current = generateIdempotencyKey();
      submissionFingerprint.current = stableSubmission;
    }

    try {
      const response = await api.post(LEAD_ENDPOINT, payload, {
        headers: { 'Idempotency-Key': submissionKey.current },
      });
      const result = response?.data?.data;
      setConfirmation({
        referenceNumber: result?.referenceNumber || null,
        auditStatus: result?.auditStatus || 'PENDING',
        message: response?.data?.message || 'Request received and awaiting review.',
      });
      submissionKey.current = null;
      submissionFingerprint.current = null;
      form.reset();
    } catch (error) {
      const responseData = error?.response?.data;
      setFieldErrors(responseData?.error?.fields || {});
      setErrorMessage(responseData?.error?.message || responseData?.message || 'We could not verify receipt of this request. Please retry; the same submission key will be reused safely.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="titech-public-form" onSubmit={handleSubmit} noValidate={false}>
      <div className="titech-public-form__grid">
        <Field label="Full name" name="name" required>
          {(props) => <input {...props} type="text" autoComplete="name" maxLength={120} required />}
        </Field>
        <Field label="Work email" name="email" required>
          {(props) => <input {...props} type="email" autoComplete="email" maxLength={254} required />}
        </Field>
        <Field label="Organization" name="organization" required={isDemo}>
          {(props) => <input {...props} type="text" autoComplete="organization" maxLength={180} required={isDemo} />}
        </Field>
        <Field label="Role or job title" name="role">
          {(props) => <input {...props} type="text" autoComplete="organization-title" maxLength={120} />}
        </Field>
        {isDemo ? (
          <>
            <Field label="Organization type" name="organizationType" required>
              {(props) => <select {...props} required><SelectOptions options={ORGANIZATION_OPTIONS} /></select>}
            </Field>
            <Field label="Country" name="country" required>
              {(props) => <input {...props} type="text" autoComplete="country-name" maxLength={80} required />}
            </Field>
            <Field label="Primary interest" name="primaryInterest" required>
              {(props) => <select {...props} required><SelectOptions options={INTEREST_OPTIONS} /></select>}
            </Field>
            <Field label="Approximate monthly records (optional)" name="monthlyVolume">
              {(props) => <select {...props}><SelectOptions options={VOLUME_OPTIONS} placeholder="Optional" /></select>}
            </Field>
            <Field label="Preferred date (request only)" name="preferredDate" hint="A preference only. This does not reserve a meeting. The team must confirm availability.">
              {(props) => <input {...props} type="date" />}
            </Field>
            <Field label="Time zone" name="timezone" required>
              {(props) => (
                <select {...props} required defaultValue="Africa/Kampala">
                  <option value="Africa/Kampala">East Africa Time (Kampala)</option>
                  <option value="Africa/Nairobi">East Africa Time (Nairobi)</option>
                  <option value="Africa/Dar_es_Salaam">East Africa Time (Dar es Salaam)</option>
                  <option value="UTC">UTC</option>
                  <option value="Europe/London">London</option>
                </select>
              )}
            </Field>
            <Field label="Additional context (optional)" name="message">
              {(props) => <textarea {...props} rows={4} maxLength={2500} placeholder="Describe the records, workflows, or integration constraints you would like to discuss." />}
            </Field>
          </>
        ) : (
          <>
            <Field label="Country (optional)" name="country">
              {(props) => <input {...props} type="text" autoComplete="country-name" maxLength={80} />}
            </Field>
            <Field label="Enquiry category" name="category" required>
              {(props) => <select {...props} required><SelectOptions options={CONTACT_OPTIONS} /></select>}
            </Field>
            <Field label="Subject" name="subject" required>
              {(props) => <input {...props} type="text" maxLength={180} required />}
            </Field>
            <Field label="Message" name="message" required>
              {(props) => <textarea {...props} rows={6} maxLength={2500} required />}
            </Field>
          </>
        )}
      </div>

      <div className="titech-public-form__honeypot" aria-hidden="true">
        <label htmlFor="institutional-lead-website">Website</label>
        <input id="institutional-lead-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <label className="titech-public-form__consent">
        <input name="consentToContact" type="checkbox" required />
        <span>I agree that TITech Capital LTD may use the details above to respond to this request. I have not included passwords, PINs, payment secrets, or member-level financial records.</span>
      </label>

      {errorSummary.length > 0 ? (
        <div className="titech-public-form__field-errors" role="alert">
          <strong>Please check these fields:</strong>
          <ul>{errorSummary.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul>
        </div>
      ) : null}
      {errorMessage ? <p className="titech-public-form__error" role="alert">{errorMessage}</p> : null}
      {confirmation ? (
        <div className="titech-public-form__success" role="status" aria-live="polite">
          <strong>{confirmation.message}</strong>
          {confirmation.referenceNumber ? <p>Reference: <span>{confirmation.referenceNumber}</span></p> : null}
          <p>{isDemo ? 'This is a demo request awaiting confirmation, not a confirmed booking.' : 'Keep this reference for follow-up. No email or calendar invitation is claimed unless separately confirmed.'}</p>
          {confirmation.auditStatus !== 'RECORDED' ? <p>Operational note: the request is saved, but its separate audit-log write is still pending review.</p> : null}
        </div>
      ) : null}

      <button className="titech-public-button titech-public-button--primary" type="submit" disabled={busy}>
        {busy ? 'Submitting…' : isDemo ? 'Submit demo request' : 'Submit enquiry'}
      </button>
      <p className="titech-public-form__privacy-note">Do not submit identification documents, account credentials, passwords, PINs, or real member transaction data through this public form.</p>
    </form>
  );
}

export function HomePage() {
  return (
    <div className="titech-public-page titech-public-home">
      <section className="titech-public-hero" aria-labelledby="titech-home-title">
        <div className="titech-public-hero__copy">
          <p className="titech-public-page__eyebrow">Community Finance Infrastructure + Payment/Reconciliation Control Plane</p>
          <h1 id="titech-home-title">Reconcile community finance with confidence.</h1>
          <p className="titech-public-page__lead">Bring authorized institutional records, payment events, settlement evidence, and reconciliation exceptions into a traceable workflow—without requiring you to replace your existing core system.</p>
          <div className="titech-public-hero__actions">
            <Link className="titech-public-button titech-public-button--primary" to="/book-a-demo">Book a Demo</Link>
            <Link className="titech-public-button titech-public-button--secondary" to="/contact-us">Contact Us</Link>
            <Link className="titech-public-button titech-public-button--text" to="/chat-with-titech">Chat with TITech</Link>
          </div>
          <p className="titech-public-home__disclaimer">TITech is an independent software/control-plane proposition. Product availability, provider integrations, regulatory authority, and production approval depend on separately verified evidence and authorization.</p>
        </div>
        <div className="titech-public-hero__panel" aria-label="Reconciliation workflow overview">
          <p className="titech-public-hero__panel-label">Evidence-led workflow</p>
          {['Authorized source records', 'Deterministic matching', 'Explained exceptions', 'Reviewer decisions', 'Traceable report and export'].map((item, index) => (
            <div className="titech-public-hero__step" key={item}>
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <strong>{item}</strong>
            </div>
          ))}
          <p className="titech-public-hero__panel-footnote">A workflow outline, not a claim of completed integration or measured customer results.</p>
        </div>
      </section>

      <section className="titech-public-section" aria-labelledby="titech-who-title">
        <p className="titech-public-page__eyebrow">Designed for institutional operators</p>
        <h2 id="titech-who-title">Make reconciliation the first measurable win.</h2>
        <div className="titech-public-card-grid">
          <article className="titech-public-card"><h3>SACCOs and cooperatives</h3><p>Compare internal records and authorized statements, track mismatches, and prepare reviewable evidence.</p></article>
          <article className="titech-public-card"><h3>MFIs and financial software providers</h3><p>Connect established systems through defined interfaces and keep source provenance visible.</p></article>
          <article className="titech-public-card"><h3>NGOs and community programmes</h3><p>Support accountable disbursement reconciliation and reporting through properly authorized partners.</p></article>
        </div>
      </section>

      <section className="titech-public-section titech-public-section--tinted" aria-labelledby="titech-inclusion-title">
        <p className="titech-public-page__eyebrow">Inclusive institutional access</p>
        <h2 id="titech-inclusion-title">One platform boundary. Different community needs.</h2>
        <p>TITech is intended to support refugee and host-community participants through legitimate institutional partners and assisted workflows. Insurance access, retirement-support coordination, education fundraising, and other regulated or sensitive services remain dependent on authorized partners, consent, privacy controls, and applicable approvals.</p>
      </section>

      <section className="titech-public-bottom-cta" aria-labelledby="titech-next-step-title">
        <div><h2 id="titech-next-step-title">Start with one institutional workflow.</h2><p>Bring a reconciliation problem, not member secrets or production payment credentials.</p></div>
        <Link className="titech-public-button titech-public-button--inverse" to="/book-a-demo">Request a demo</Link>
      </section>
    </div>
  );
}

export function BookDemoPage() {
  return (
    <PageShell eyebrow="Institutional conversations" title="Book a Demo" description="Tell us about your institution and the reconciliation or evidence workflow you want to explore. A submitted preference is not a booked appointment; the team must confirm a suitable time.">
      <div className="titech-public-form-panel"><PublicLeadForm type="DEMO" /></div>
    </PageShell>
  );
}

export function ContactUsPage() {
  return (
    <PageShell eyebrow="Contact TITech" title="Contact Us" description="Use this form for institutional sales, reconciliation, integration, partnership, customer-support, privacy, or security enquiries. Do not include secrets or member-level financial records.">
      <div className="titech-public-form-panel"><PublicLeadForm type="CONTACT" /></div>
    </PageShell>
  );
}

const CHAT_TOPICS = Object.freeze([
  {
    id: 'product',
    question: 'What is TITech Community Capital?',
    answer: 'TITech Community Capital is positioned as community finance infrastructure and a payment/reconciliation control plane. The initial product focus is traceable imports, deterministic matching, exception review, and evidence exports that complement existing institution systems.',
  },
  {
    id: 'reconciliation',
    question: 'How does reconciliation work?',
    answer: 'The intended workflow brings together authorized source records and internal transactions, validates provenance and formats, applies documented matching rules, then presents unmatched or inconsistent items for authorized human review. The final report must distinguish matched, unmatched, and unresolved amounts.',
  },
  {
    id: 'integrations',
    question: 'Which payment integrations are available?',
    answer: 'MTN MoMo is the initial integration candidate in the engineering plan. Current production availability, live provider authorization, certification, and settlement proof must be confirmed separately; the existence of adapter code or a sandbox test is not production approval.',
  },
  {
    id: 'inclusion',
    question: 'Can TITech support refugee and host communities?',
    answer: 'The platform is intended to support participants through legitimate institutional partners, inclusive onboarding, appropriate consent, and privacy-aware workflows. Eligibility, identity acceptance, and financial services remain subject to the participating institution and applicable law.',
  },
  {
    id: 'regulated',
    question: 'Does TITech itself provide regulated financial or insurance products?',
    answer: 'TITech is not to represent infrastructure implementation as a license. Deposit-taking, lending, insurance, pension, investment, custody, or payment activities must remain within a verified authorized partner and applicable legal scope. Ask the team for the current, evidence-backed capability status.',
  },
  {
    id: 'security',
    question: 'Is the platform production approved?',
    answer: 'The current engineering evidence baseline keeps productionApproved=false until the required runtime, operational, financial, tenant-isolation, security, legal/partner, and institutional evidence gates are satisfied and reviewed.',
  },
]);

export function GuidedChatPage() {
  const [selectedTopic, setSelectedTopic] = useState(null);
  const answer = CHAT_TOPICS.find((topic) => topic.id === selectedTopic);
  return (
    <PageShell eyebrow="Guided automated information" title="Chat with TITech" description="Choose a topic to read approved introductory information. This is a bounded guided assistant, not a live human support channel or an unrestricted AI service.">
      <div className="titech-guided-chat">
        <div className="titech-guided-chat__topics" role="group" aria-label="Choose a question">
          {CHAT_TOPICS.map((topic) => (
            <button key={topic.id} type="button" className={selectedTopic === topic.id ? 'titech-guided-chat__topic is-active' : 'titech-guided-chat__topic'} onClick={() => setSelectedTopic(topic.id)} aria-pressed={selectedTopic === topic.id}>
              {topic.question}
            </button>
          ))}
        </div>
        <section className="titech-guided-chat__answer" aria-live="polite" aria-atomic="true" aria-labelledby="titech-guided-chat-answer-title">
          <p className="titech-public-page__eyebrow">Approved knowledge</p>
          <h2 id="titech-guided-chat-answer-title">{answer ? answer.question : 'Choose a question to begin'}</h2>
          <p>{answer ? answer.answer : 'This guide does not accept free-form messages or sensitive personal data. For a question outside these topics, contact TITech or request a demonstration.'}</p>
          <div className="titech-public-hero__actions">
            <Link className="titech-public-button titech-public-button--primary" to="/contact-us">Contact Us</Link>
            <Link className="titech-public-button titech-public-button--secondary" to="/book-a-demo">Book a Demo</Link>
          </div>
        </section>
      </div>
      <p className="titech-public-form__privacy-note">Please do not enter passwords, PINs, authorization codes, payment credentials, identity documents, or member transaction data here. No message is transmitted to a chat provider.</p>
    </PageShell>
  );
}
