import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { get, post } from '../../services/api.js';
import { useI18n } from '../../i18n/I18nProvider.jsx';
import './RetirementSupportPage.css';

const API = '/api/v1/retirement-support';
const API_ROOT = '/api/v1';
const SCHEME_OPTIONS = [
  ['UG_GOVERNMENT_PENSION', 'GovernmentPension'],
  ['NSSF_UGANDA', 'NssfUganda'],
  ['EMPLOYER_SPONSORED', 'EmployerSponsored'],
  ['OTHER_APPROVED_SCHEME', 'OtherScheme'],
];
const CASE_OPTIONS = [
  ['RETIREMENT_ONBOARDING', 'retirementOnboarding'],
  ['MEMBERSHIP_VERIFICATION', 'membershipVerification'],
  ['CONTRIBUTION_DISPUTE', 'contributionDispute'],
  ['BENEFIT_CLAIM_SUPPORT', 'benefitClaimSupport'],
  ['SURVIVOR_OR_DEPENDANT_SUPPORT', 'survivorSupport'],
  ['EMPLOYER_CONTRIBUTION_REVIEW', 'employerContributionReview'],
  ['FINANCIAL_SUPPORT_REFERRAL', 'financialSupportReferral'],
  ['EMPLOYEE_FINANCE_SUPPORT', 'employeeFinanceSupport'],
];
const SUPPORT_OPTIONS = [
  ['EMERGENCY_ASSISTANCE', 'emergencyAssistance'],
  ['REGULATED_LOAN', 'regulatedLoan'],
  ['EMPLOYER_FINANCE', 'employerFinance'],
  ['SAVINGS_REFERRAL', 'savingsReferral'],
  ['INSURANCE_REFERRAL', 'insuranceReferral'],
  ['FINANCIAL_COUNSELLING', 'financialCounselling'],
];
const REVIEW_ACTIONS = Object.freeze({
  SUBMITTED: ['DOCUMENTS_REQUIRED', 'DOCUMENTS_UNDER_REVIEW', 'IDENTITY_PENDING', 'MANUAL_REVIEW_REQUIRED', 'REFERRED_TO_AUTHORITY'],
  DOCUMENTS_REQUIRED: ['SUBMITTED', 'DOCUMENTS_UNDER_REVIEW', 'MANUAL_REVIEW_REQUIRED'],
  DOCUMENTS_UNDER_REVIEW: ['DOCUMENTS_REQUIRED', 'IDENTITY_PENDING', 'MANUAL_REVIEW_REQUIRED', 'REFERRED_TO_AUTHORITY'],
  IDENTITY_PENDING: ['DOCUMENTS_REQUIRED', 'MANUAL_REVIEW_REQUIRED'],
  IDENTITY_VERIFIED: ['SCHEME_VERIFICATION_PENDING', 'MANUAL_REVIEW_REQUIRED', 'REFERRED_TO_AUTHORITY'],
  SCHEME_VERIFICATION_PENDING: ['MANUAL_REVIEW_REQUIRED', 'REFERRED_TO_AUTHORITY', 'EXPIRED'],
  SCHEME_VERIFIED: ['DISCREPANCY_DETECTED', 'REFERRED_TO_AUTHORITY', 'EXPIRED', 'COMPLETED'],
  MANUAL_REVIEW_REQUIRED: ['DOCUMENTS_REQUIRED', 'IDENTITY_PENDING', 'SCHEME_VERIFICATION_PENDING', 'REFERRED_TO_AUTHORITY'],
  DISCREPANCY_DETECTED: ['DOCUMENTS_REQUIRED', 'SCHEME_VERIFICATION_PENDING', 'REFERRED_TO_AUTHORITY'],
  REFERRED_TO_AUTHORITY: ['DOCUMENTS_REQUIRED', 'DISCREPANCY_DETECTED', 'EXPIRED'],
  EXPIRED: ['SCHEME_VERIFICATION_PENDING', 'REFERRED_TO_AUTHORITY'],
});
const VERIFICATION_STATES = new Set(['SCHEME_VERIFICATION_PENDING', 'REFERRED_TO_AUTHORITY', 'DISCREPANCY_DETECTED', 'MANUAL_REVIEW_REQUIRED']);

function responseData(response) { return response?.data?.data ?? null; }
function getError(error, fallback) { return error?.response?.data?.error?.message || fallback; }
function localDate(value, locale) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale || 'en', { dateStyle: 'medium' }).format(date);
}
function recordId(record) { return record?.id || record?._id || ''; }
function periodDefault() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function RetirementSupportPage() {
  const { t, locale, direction } = useI18n();
  const text = useCallback((key) => t(`inclusive.retirement${key[0].toUpperCase()}${key.slice(1)}`) || key, [t]);
  const statusLabel = useCallback((status) => {
    const suffix = String(status || 'UNKNOWN').toLowerCase().split(/[_-]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    return t(`inclusive.retirementStatus${suffix}`) || String(status || 'UNKNOWN').replaceAll('_', ' ');
  }, [t]);

  const [readiness, setReadiness] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [cases, setCases] = useState([]);
  const [caseQueue, setCaseQueue] = useState([]);
  const [contributions, setContributions] = useState([]);
  const [applications, setApplications] = useState([]);
  const [supportQueue, setSupportQueue] = useState([]);
  const [schemeType, setSchemeType] = useState('NSSF_UGANDA');
  const [caseType, setCaseType] = useState('RETIREMENT_ONBOARDING');
  const [employerReference, setEmployerReference] = useState('');
  const [schemeReference, setSchemeReference] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [supportType, setSupportType] = useState('FINANCIAL_COUNSELLING');
  const [requestedAmount, setRequestedAmount] = useState('');
  const [currency, setCurrency] = useState('UGX');
  const [contributionDraft, setContributionDraft] = useState({ caseId: '', contributionPeriod: periodDefault(), employerReference: '', currency: 'UGX', expectedEmployeeAmountMinor: '', expectedEmployerAmountMinor: '' });
  const [reconcileDrafts, setReconcileDrafts] = useState({});
  const [schemeCreditDrafts, setSchemeCreditDrafts] = useState({});
  const [verificationDrafts, setVerificationDrafts] = useState({});
  const [providerOutcomeDrafts, setProviderOutcomeDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);

  const loadData = useCallback(async () => {
    setError('');
    let currentCapabilities = null;
    try {
      const result = await get(`${API}/capabilities`);
      currentCapabilities = responseData(result);
    } catch {
      // The server remains authoritative; a user without retirement access sees no staff-only controls.
    }
    setCapabilities(currentCapabilities);

    const calls = [
      ['readiness', get(`${API}/readiness`)],
      ['myCases', get(`${API}/me`)],
      ['contributions', get(`${API}/contributions`)],
      ['myApplications', get(`${API}/financial-support/me`)],
    ];
    if (currentCapabilities?.canReadCaseQueue) calls.push(['caseQueue', get(`${API}/cases`)]);
    if (currentCapabilities?.canReadSupportQueue) calls.push(['supportQueue', get(`${API}/financial-support`)]);

    const results = await Promise.allSettled(calls.map(([, request]) => request));
    let successful = 0;
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') {
        if (calls[index][0] === 'caseQueue') setCaseQueue([]);
        if (calls[index][0] === 'supportQueue') setSupportQueue([]);
        return;
      }
      successful += 1;
      const data = responseData(result.value);
      switch (calls[index][0]) {
        case 'readiness': setReadiness(data); break;
        case 'myCases': setCases(Array.isArray(data) ? data : []); break;
        case 'contributions': setContributions(Array.isArray(data) ? data : []); break;
        case 'myApplications': setApplications(Array.isArray(data) ? data : []); break;
        case 'caseQueue': setCaseQueue(Array.isArray(data) ? data : []); break;
        case 'supportQueue': setSupportQueue(Array.isArray(data) ? data : []); break;
        default: break;
      }
    });
    if (successful === 0) setError(text('loadFailed'));
    setLastRefresh(new Date());
  }, [text]);

  useEffect(() => { void loadData(); }, [loadData]);

  const withBusy = async (operation) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      await loadData();
    } catch (caught) {
      setError(getError(caught, text('operationFailed')));
    } finally {
      setBusy(false);
    }
  };

  const enabled = readiness?.enabled === true && readiness?.privacyConfigured === true;
  const noticeVersion = readiness?.privacyNoticeVersion || '';
  const queueCases = useMemo(() => caseQueue.filter((item) => item && recordId(item)), [caseQueue]);

  const submitCase = (event) => {
    event.preventDefault();
    void withBusy(async () => {
      if (!enabled || !noticeVersion) throw new Error(text('privacyPolicyNotConfigured'));
      if (!privacyAcknowledged) throw new Error(text('privacyAcknowledgementRequired'));
      if (!evidenceFile) throw new Error(text('evidenceRequired'));
      const accepted = ['application/pdf', 'image/jpeg', 'image/png'];
      if (!accepted.includes(evidenceFile.type) || evidenceFile.size < 1 || evidenceFile.size > 10 * 1024 * 1024) throw new Error(text('evidenceInvalid'));
      const documentResult = await post(`${API_ROOT}/documents/upload`, evidenceFile, {
        headers: { 'Content-Type': evidenceFile.type, 'X-TITech-Document-Purpose': 'RETIREMENT_SUPPORT_EVIDENCE' },
        transformRequest: [(value) => value],
      });
      const documentReference = responseData(documentResult)?.documentReference;
      if (!documentReference) throw new Error(text('evidenceUploadFailed'));
      const created = await post(`${API}/cases`, {
        schemeType, caseType, jurisdiction: 'UG', employerReference: employerReference.trim() || undefined,
        schemeReference: schemeReference.trim() || undefined, evidenceReferences: [documentReference], submitImmediately: true,
        noticeVersion, noticeLanguage: locale, noticeAcknowledged: privacyAcknowledged,
      });
      const result = responseData(created);
      setNotice(`${text('caseSubmitted')} ${result?.caseReference || ''}`.trim());
      setEmployerReference(''); setSchemeReference(''); setEvidenceFile(null);
      const fileInput = document.getElementById('retirement-evidence-file');
      if (fileInput) fileInput.value = '';
      setPrivacyAcknowledged(false);
    });
  };

  const submitSupportApplication = (event) => {
    event.preventDefault();
    void withBusy(async () => {
      if (!enabled || !noticeVersion) throw new Error(text('privacyPolicyNotConfigured'));
      if (!privacyAcknowledged) throw new Error(text('privacyAcknowledgementRequired'));
      const amount = requestedAmount.trim() ? Number(requestedAmount) : null;
      if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) throw new Error(text('amountInvalid'));
      const response = await post(`${API}/financial-support`, {
        supportType, requestedAmountMinor: amount, currency, disclosureVersion: 'RETIREMENT_SUPPORT_DISCLOSURE_V1',
        noticeVersion, noticeLanguage: locale, noticeAcknowledged: privacyAcknowledged,
      });
      const result = responseData(response);
      setNotice(`${text('supportSubmitted')} ${result?.applicationReference || ''}`.trim());
      setRequestedAmount('');
      setPrivacyAcknowledged(false);
    });
  };

  const updateKeyedDraft = (setter, key, field, value) => setter((current) => ({
    ...current,
    [key]: { ...(current[key] || {}), [field]: value },
  }));

  const transitionCase = (record, targetStatus) => {
    void withBusy(async () => {
      const response = await post(`${API}/cases/${encodeURIComponent(recordId(record))}/transition`, {
        targetStatus,
        reasonCode: 'AUTHORIZED_STAFF_REVIEW_ACTION',
        note: `Authorized case-review action: ${targetStatus}`,
      });
      const changed = responseData(response);
      setNotice(`${text('caseUpdated')} ${changed?.caseReference || record.caseReference || ''} · ${statusLabel(targetStatus)}`.trim());
    });
  };

  const recordVerification = (event, record) => {
    event.preventDefault();
    const id = recordId(record);
    const draft = verificationDrafts[id] || {};
    void withBusy(async () => {
      const response = await post(`${API}/cases/${encodeURIComponent(id)}/verification`, {
        decision: draft.decision || 'INCONCLUSIVE',
        sourceType: draft.sourceType || 'AUTHORIZED_INSTITUTION_REVIEW',
        sourceName: draft.sourceName || '',
        sourceReference: draft.sourceReference || '',
        note: draft.note || '',
      });
      const changed = responseData(response);
      setNotice(`${text('verificationRecorded')} ${changed?.caseReference || record.caseReference || ''}`.trim());
    });
  };

  const submitContribution = (event) => {
    event.preventDefault();
    void withBusy(async () => {
      const employee = Number(contributionDraft.expectedEmployeeAmountMinor);
      const employer = Number(contributionDraft.expectedEmployerAmountMinor);
      if (!contributionDraft.caseId) throw new Error(text('contributionCaseRequired'));
      if (!Number.isSafeInteger(employee) || employee < 0 || !Number.isSafeInteger(employer) || employer < 0) throw new Error(text('amountInvalid'));
      const response = await post(`${API}/contributions`, {
        caseId: contributionDraft.caseId,
        contributionPeriod: contributionDraft.contributionPeriod,
        employerReference: contributionDraft.employerReference.trim(),
        currency: contributionDraft.currency,
        expectedEmployeeAmountMinor: employee,
        expectedEmployerAmountMinor: employer,
      });
      const saved = responseData(response);
      setNotice(`${text('contributionCreated')} ${saved?.contributionPeriod || contributionDraft.contributionPeriod}`);
      setContributionDraft({ caseId: '', contributionPeriod: periodDefault(), employerReference: '', currency: 'UGX', expectedEmployeeAmountMinor: '', expectedEmployerAmountMinor: '' });
    });
  };

  const reconcileContribution = (event, record) => {
    event.preventDefault();
    const id = recordId(record);
    const draft = reconcileDrafts[id] || {};
    void withBusy(async () => {
      const employee = Number(draft.employee ?? record.expectedEmployeeAmountMinor);
      const employer = Number(draft.employer ?? record.expectedEmployerAmountMinor);
      if (!Number.isSafeInteger(employee) || employee < 0 || !Number.isSafeInteger(employer) || employer < 0) throw new Error(text('amountInvalid'));
      const response = await post(`${API}/contributions/${encodeURIComponent(id)}/reconcile`, {
        reportedEmployeeAmountMinor: employee,
        reportedEmployerAmountMinor: employer,
        remittanceSourceReference: draft.sourceReference || '',
      });
      const result = responseData(response);
      setNotice(`${text('contributionReconciled')} ${result?.matchingStatus || ''}`.trim());
    });
  };

  const recordSchemeCredit = (event, record) => {
    event.preventDefault();
    const id = recordId(record);
    const draft = schemeCreditDrafts[id] || {};
    void withBusy(async () => {
      const response = await post(`${API}/contributions/${encodeURIComponent(id)}/scheme-credit`, {
        decision: draft.decision || 'NOT_CONFIRMED',
        sourceName: draft.sourceName || '',
        sourceReference: draft.sourceReference || '',
      });
      const result = responseData(response);
      setNotice(`${text('schemeCreditRecorded')} ${statusLabel(result?.schemeCreditStatus)}`.trim());
    });
  };

  const recordProviderOutcome = (event, record) => {
    event.preventDefault();
    const id = recordId(record);
    const draft = providerOutcomeDrafts[id] || {};
    void withBusy(async () => {
      const response = await post(`${API}/financial-support/${encodeURIComponent(id)}/provider-outcome`, {
        decision: draft.decision || 'NEEDS_MORE_INFORMATION',
        decisionSource: draft.decisionSource || '',
        externalDecisionReference: draft.externalDecisionReference || '',
        providerReference: draft.providerReference || '',
      });
      const result = responseData(response);
      setNotice(`${text('providerOutcomeRecorded')} ${result?.applicationReference || ''}`.trim());
    });
  };

  return (
    <main className="titech-retirement-page" dir={direction}>
      <header className="titech-retirement-header">
        <div>
          <p className="titech-retirement-eyebrow">TITech Capital LTD · TITech Community Capital</p>
          <h1>{text('Title')}</h1>
          <p className="titech-retirement-subtitle">{text('Subtitle')}</p>
        </div>
        <button className="titech-retirement-button titech-retirement-button--secondary" type="button" onClick={() => void loadData()} disabled={busy}>{text('Refresh')}</button>
      </header>

      {readiness ? (
        <section className={`titech-retirement-readiness ${enabled ? 'is-enabled' : 'is-disabled'}`} aria-live="polite">
          <strong>{enabled ? text('CapabilityEnabled') : text('CapabilityDisabled')}</strong>
          <span>{text('AuthorityBoundary')}</span>
          <small>{text('LastRefresh')}: {localDate(lastRefresh, locale)}</small>
        </section>
      ) : null}

      {notice ? <div className="titech-retirement-message is-success" role="status">{notice}</div> : null}
      {error ? <div className="titech-retirement-message is-error" role="alert">{error}</div> : null}

      <section className="titech-retirement-privacy-notice" aria-labelledby="retirement-privacy-heading" role="note">
        <strong id="retirement-privacy-heading">{text('PrivacyNoticeHeading')} · {noticeVersion || text('NotConfigured')}</strong>
        <p>{text('PrivacyNoticeBody')}</p>
        <label className="titech-retirement-acknowledgement">
          <input type="checkbox" checked={privacyAcknowledged} onChange={(event) => setPrivacyAcknowledged(event.target.checked)} disabled={!enabled || busy} aria-describedby="retirement-privacy-explanation" />
          <span>{text('PrivacyNoticeAcknowledge')}</span>
        </label>
        {!readiness?.privacyConfigured ? <small id="retirement-privacy-explanation">{text('PrivacyPolicyNotConfigured')}</small> : <small id="retirement-privacy-explanation">{text('NoticeAcknowledgementScope')}</small>}
      </section>

      <section className="titech-retirement-grid">
        <article className="titech-retirement-card">
          <h2>{text('NewCase')}</h2>
          <p>{text('NewCaseHelp')}</p>
          <form onSubmit={submitCase} className="titech-retirement-form">
            <label><span>{text('Scheme')}</span><select value={schemeType} onChange={(event) => setSchemeType(event.target.value)} required>{SCHEME_OPTIONS.map(([value, key]) => <option key={value} value={value}>{text(key)}</option>)}</select></label>
            <label><span>{text('CaseType')}</span><select value={caseType} onChange={(event) => setCaseType(event.target.value)} required>{CASE_OPTIONS.map(([value, key]) => <option key={value} value={value}>{text(key)}</option>)}</select></label>
            <label><span>{text('EmployerReference')}</span><input value={employerReference} maxLength={128} onChange={(event) => setEmployerReference(event.target.value)} autoComplete="organization" /></label>
            <label><span>{text('SchemeReference')}</span><input value={schemeReference} maxLength={128} onChange={(event) => setSchemeReference(event.target.value)} autoComplete="off" /></label>
            <small>{text('SchemeReferenceHelp')}</small>
            <label><span>{text('Evidence')}</span><input id="retirement-evidence-file" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setEvidenceFile(event.target.files?.[0] || null)} required /><small>{text('EvidenceHelp')}</small></label>
            <button className="titech-retirement-button" type="submit" disabled={busy || !enabled || !privacyAcknowledged}>{busy ? text('Working') : text('SubmitCase')}</button>
          </form>
        </article>

        <article className="titech-retirement-card">
          <h2>{text('FinancialSupport')}</h2>
          <p>{text('FinancialSupportHelp')}</p>
          <form onSubmit={submitSupportApplication} className="titech-retirement-form">
            <label><span>{text('SupportType')}</span><select value={supportType} onChange={(event) => setSupportType(event.target.value)} required>{SUPPORT_OPTIONS.map(([value, key]) => <option key={value} value={value}>{text(key)}</option>)}</select></label>
            <label><span>{text('RequestedAmount')}</span><input type="number" min="0" step="1" value={requestedAmount} onChange={(event) => setRequestedAmount(event.target.value)} inputMode="numeric" /></label>
            <label><span>{text('Currency')}</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="UGX">UGX</option><option value="KES">KES</option><option value="TZS">TZS</option><option value="USD">USD</option></select></label>
            <p className="titech-retirement-note">{text('NoApprovalPromise')}</p>
            <button className="titech-retirement-button" type="submit" disabled={busy || !enabled || !privacyAcknowledged}>{busy ? text('Working') : text('SubmitSupport')}</button>
          </form>
        </article>
      </section>

      <section className="titech-retirement-card">
        <div className="titech-retirement-section-heading"><h2>{text('MyCases')}</h2><span>{cases.length}</span></div>
        {cases.length ? <div className="titech-retirement-record-list">{cases.map((item) => <article className="titech-retirement-record" key={recordId(item)}>
          <div><strong>{item.caseReference || recordId(item)}</strong><p>{text(item.schemeType === 'NSSF_UGANDA' ? 'NssfUganda' : item.schemeType === 'UG_GOVERNMENT_PENSION' ? 'GovernmentPension' : item.schemeType === 'EMPLOYER_SPONSORED' ? 'EmployerSponsored' : 'OtherScheme')} · {text('Updated')}: {localDate(item.updatedAt, locale)}</p></div>
          <div className="titech-retirement-status"><span>{text('CaseStatus')}</span><strong>{statusLabel(item.status)}</strong><small>{text('SchemeCheck')}: {statusLabel(item.schemeVerificationStatus || 'NOT_REQUESTED')}</small></div>
        </article>)}</div> : <p className="titech-retirement-empty">{text('NoCases')}</p>}
      </section>

      {capabilities?.canReadCaseQueue ? (
        <section className="titech-retirement-card">
          <div className="titech-retirement-section-heading"><h2>{text('StaffCaseQueue')}</h2><span>{queueCases.length}</span></div>
          <p>{text('StaffCaseQueueHelp')}</p>
          {queueCases.length ? <div className="titech-retirement-record-list">{queueCases.map((item) => {
            const id = recordId(item);
            const actions = REVIEW_ACTIONS[item.status] || [];
            const draft = verificationDrafts[id] || {};
            return <article className="titech-retirement-staff-record" key={id}>
              <div className="titech-retirement-record-heading"><div><strong>{item.caseReference}</strong><p>{statusLabel(item.status)} · {text(item.schemeType === 'NSSF_UGANDA' ? 'NssfUganda' : item.schemeType === 'UG_GOVERNMENT_PENSION' ? 'GovernmentPension' : item.schemeType === 'EMPLOYER_SPONSORED' ? 'EmployerSponsored' : 'OtherScheme')}</p></div><small>{localDate(item.updatedAt, locale)}</small></div>
              {capabilities.canReviewCases && actions.length ? <div className="titech-retirement-action-row">{actions.map((target) => <button key={target} type="button" className="titech-retirement-button titech-retirement-button--secondary" disabled={busy || !enabled} onClick={() => transitionCase(item, target)}>{text('MoveTo')} {statusLabel(target)}</button>)}</div> : null}
              {capabilities.canRecordSchemeVerification && VERIFICATION_STATES.has(item.status) ? <form className="titech-retirement-form titech-retirement-review-form" onSubmit={(event) => recordVerification(event, item)}>
                <h3>{text('RecordSchemeResult')}</h3>
                <label><span>{text('Decision')}</span><select value={draft.decision || 'INCONCLUSIVE'} onChange={(event) => updateKeyedDraft(setVerificationDrafts, id, 'decision', event.target.value)}><option value="CONFIRMED">{statusLabel('CONFIRMED')}</option><option value="INCONCLUSIVE">{statusLabel('INCONCLUSIVE')}</option><option value="NOT_FOUND">{statusLabel('NOT_FOUND')}</option></select></label>
                <label><span>{text('VerificationSourceType')}</span><select value={draft.sourceType || 'AUTHORIZED_INSTITUTION_REVIEW'} onChange={(event) => updateKeyedDraft(setVerificationDrafts, id, 'sourceType', event.target.value)}><option value="AUTHORIZED_INSTITUTION_REVIEW">{text('AuthorizedInstitutionReview')}</option><option value="AUTHORIZED_PROVIDER">{text('AuthorizedProvider')}</option></select></label>
                <label><span>{text('VerificationSourceName')}</span><input value={draft.sourceName || ''} maxLength={200} required onChange={(event) => updateKeyedDraft(setVerificationDrafts, id, 'sourceName', event.target.value)} /></label>
                <label><span>{text('VerificationSourceReference')}</span><input value={draft.sourceReference || ''} maxLength={200} required onChange={(event) => updateKeyedDraft(setVerificationDrafts, id, 'sourceReference', event.target.value)} /></label>
                <label><span>{text('ReviewerNote')}</span><textarea value={draft.note || ''} maxLength={1000} rows={2} onChange={(event) => updateKeyedDraft(setVerificationDrafts, id, 'note', event.target.value)} /></label>
                <button className="titech-retirement-button" type="submit" disabled={busy || !enabled}>{text('RecordVerification')}</button>
              </form> : null}
            </article>;
          })}</div> : <p className="titech-retirement-empty">{text('NoQueueCases')}</p>}
        </section>
      ) : null}

      {capabilities?.canCreateContributions ? (
        <section className="titech-retirement-card">
          <h2>{text('RecordExpectedContribution')}</h2>
          <p>{text('ContributionSetupHelp')}</p>
          <form className="titech-retirement-form titech-retirement-form--columns" onSubmit={submitContribution}>
            <label><span>{text('RelatedCase')}</span><select value={contributionDraft.caseId} required onChange={(event) => setContributionDraft({ ...contributionDraft, caseId: event.target.value })}><option value="">{text('SelectCase')}</option>{queueCases.map((item) => <option key={recordId(item)} value={recordId(item)}>{item.caseReference} · {statusLabel(item.status)}</option>)}</select></label>
            <label><span>{text('ContributionPeriod')}</span><input type="month" value={contributionDraft.contributionPeriod} required onChange={(event) => setContributionDraft({ ...contributionDraft, contributionPeriod: event.target.value })} /></label>
            <label><span>{text('EmployerReference')}</span><input value={contributionDraft.employerReference} maxLength={128} required onChange={(event) => setContributionDraft({ ...contributionDraft, employerReference: event.target.value })} /></label>
            <label><span>{text('Currency')}</span><select value={contributionDraft.currency} onChange={(event) => setContributionDraft({ ...contributionDraft, currency: event.target.value })}><option value="UGX">UGX</option><option value="KES">KES</option><option value="TZS">TZS</option><option value="USD">USD</option></select></label>
            <label><span>{text('ExpectedEmployeeContribution')}</span><input type="number" min="0" step="1" required value={contributionDraft.expectedEmployeeAmountMinor} onChange={(event) => setContributionDraft({ ...contributionDraft, expectedEmployeeAmountMinor: event.target.value })} /></label>
            <label><span>{text('ExpectedEmployerContribution')}</span><input type="number" min="0" step="1" required value={contributionDraft.expectedEmployerAmountMinor} onChange={(event) => setContributionDraft({ ...contributionDraft, expectedEmployerAmountMinor: event.target.value })} /></label>
            <button className="titech-retirement-button" type="submit" disabled={busy || !enabled}>{text('RecordContribution')}</button>
          </form>
        </section>
      ) : null}

      <section className="titech-retirement-card">
        <div className="titech-retirement-section-heading"><h2>{text('ContributionEvidence')}</h2><span>{contributions.length}</span></div>
        {contributions.length ? <div className="titech-retirement-record-list">{contributions.map((item) => {
          const id = recordId(item);
          const reconcile = reconcileDrafts[id] || {};
          const credit = schemeCreditDrafts[id] || {};
          return <article className="titech-retirement-staff-record" key={id}>
            <div className="titech-retirement-record-heading"><div><strong>{item.contributionPeriod} · {item.currency}</strong><p>{text('EmployerReference')}: {item.employerReference || '—'}</p></div><div className="titech-retirement-status"><span>{text('MatchingStatus')}</span><strong>{statusLabel(item.matchingStatus)}</strong><small>{text('SchemeCredit')}: {statusLabel(item.schemeCreditStatus || 'UNKNOWN')}</small></div></div>
            <p>{text('ExpectedEmployeeContribution')}: {item.expectedEmployeeAmountMinor} · {text('ExpectedEmployerContribution')}: {item.expectedEmployerAmountMinor}</p>
            {capabilities?.canReconcileContributions ? <form className="titech-retirement-form titech-retirement-review-form" onSubmit={(event) => reconcileContribution(event, item)}>
              <h3>{text('ReconcileRemittance')}</h3>
              <label><span>{text('ReportedEmployeeContribution')}</span><input type="number" min="0" step="1" required value={reconcile.employee ?? item.expectedEmployeeAmountMinor} onChange={(event) => updateKeyedDraft(setReconcileDrafts, id, 'employee', event.target.value)} /></label>
              <label><span>{text('ReportedEmployerContribution')}</span><input type="number" min="0" step="1" required value={reconcile.employer ?? item.expectedEmployerAmountMinor} onChange={(event) => updateKeyedDraft(setReconcileDrafts, id, 'employer', event.target.value)} /></label>
              <label><span>{text('RemittanceSourceReference')}</span><input required maxLength={200} value={reconcile.sourceReference || ''} onChange={(event) => updateKeyedDraft(setReconcileDrafts, id, 'sourceReference', event.target.value)} /></label>
              <button className="titech-retirement-button" type="submit" disabled={busy || !enabled}>{text('ReconcileContribution')}</button>
            </form> : null}
            {capabilities?.canRecordSchemeCredit ? <form className="titech-retirement-form titech-retirement-review-form" onSubmit={(event) => recordSchemeCredit(event, item)}>
              <h3>{text('RecordOfficialSchemeCredit')}</h3>
              <label><span>{text('Decision')}</span><select value={credit.decision || 'NOT_CONFIRMED'} onChange={(event) => updateKeyedDraft(setSchemeCreditDrafts, id, 'decision', event.target.value)}><option value="CONFIRMED">{statusLabel('CONFIRMED')}</option><option value="NOT_CONFIRMED">{statusLabel('NOT_CONFIRMED')}</option></select></label>
              <label><span>{text('VerificationSourceName')}</span><input required maxLength={200} value={credit.sourceName || ''} onChange={(event) => updateKeyedDraft(setSchemeCreditDrafts, id, 'sourceName', event.target.value)} /></label>
              <label><span>{text('VerificationSourceReference')}</span><input required maxLength={200} value={credit.sourceReference || ''} onChange={(event) => updateKeyedDraft(setSchemeCreditDrafts, id, 'sourceReference', event.target.value)} /></label>
              <button className="titech-retirement-button" type="submit" disabled={busy || !enabled}>{text('RecordSchemeCredit')}</button>
            </form> : null}
          </article>;
        })}</div> : <p className="titech-retirement-empty">{text('NoContributions')}</p>}
        <p className="titech-retirement-note">{text('ContributionBoundary')}</p>
      </section>

      <section className="titech-retirement-grid">
        <article className="titech-retirement-card">
          <div className="titech-retirement-section-heading"><h2>{text('MySupportApplications')}</h2><span>{applications.length}</span></div>
          {applications.length ? <div className="titech-retirement-record-list">{applications.map((item) => <article className="titech-retirement-record" key={recordId(item)}>
            <div><strong>{item.applicationReference || recordId(item)}</strong><p>{text('SupportType')}: {text(SUPPORT_OPTIONS.find(([value]) => value === item.supportType)?.[1] || 'FinancialCounselling')}</p></div>
            <div className="titech-retirement-status"><span>{text('ApplicationStatus')}</span><strong>{statusLabel(item.status)}</strong></div>
          </article>)}</div> : <p className="titech-retirement-empty">{text('NoApplications')}</p>}
          <p className="titech-retirement-note">{text('NoMoneyMovement')}</p>
        </article>
        {capabilities?.canReadSupportQueue ? <article className="titech-retirement-card">
          <div className="titech-retirement-section-heading"><h2>{text('FinancialSupportQueue')}</h2><span>{supportQueue.length}</span></div>
          {supportQueue.length ? <div className="titech-retirement-record-list">{supportQueue.map((item) => {
            const id = recordId(item);
            const draft = providerOutcomeDrafts[id] || {};
            return <article className="titech-retirement-staff-record" key={id}>
              <div className="titech-retirement-record-heading"><div><strong>{item.applicationReference}</strong><p>{text('SupportType')}: {text(SUPPORT_OPTIONS.find(([value]) => value === item.supportType)?.[1] || 'FinancialCounselling')}</p></div><span>{statusLabel(item.status)}</span></div>
              {capabilities.canRecordProviderOutcome ? <form className="titech-retirement-form titech-retirement-review-form" onSubmit={(event) => recordProviderOutcome(event, item)}>
                <h3>{text('RecordProviderOutcome')}</h3>
                <label><span>{text('Decision')}</span><select value={draft.decision || 'NEEDS_MORE_INFORMATION'} onChange={(event) => updateKeyedDraft(setProviderOutcomeDrafts, id, 'decision', event.target.value)}><option value="PROVIDER_APPROVED">{statusLabel('PROVIDER_APPROVED')}</option><option value="PROVIDER_REJECTED">{statusLabel('PROVIDER_REJECTED')}</option><option value="NEEDS_MORE_INFORMATION">{statusLabel('NEEDS_MORE_INFORMATION')}</option></select></label>
                <label><span>{text('ProviderName')}</span><input required maxLength={200} value={draft.decisionSource || ''} onChange={(event) => updateKeyedDraft(setProviderOutcomeDrafts, id, 'decisionSource', event.target.value)} /></label>
                <label><span>{text('ProviderReference')}</span><input required maxLength={128} value={draft.providerReference || ''} onChange={(event) => updateKeyedDraft(setProviderOutcomeDrafts, id, 'providerReference', event.target.value)} /></label>
                <label><span>{text('ExternalDecisionReference')}</span><input required maxLength={200} value={draft.externalDecisionReference || ''} onChange={(event) => updateKeyedDraft(setProviderOutcomeDrafts, id, 'externalDecisionReference', event.target.value)} /></label>
                <button className="titech-retirement-button" type="submit" disabled={busy || !enabled}>{text('RecordProviderOutcome')}</button>
              </form> : null}
            </article>;
          })}</div> : <p className="titech-retirement-empty">{text('NoQueueSupport')}</p>}
          <p className="titech-retirement-note">{text('NoMoneyMovement')}</p>
        </article> : null}
      </section>
    </main>
  );
}
