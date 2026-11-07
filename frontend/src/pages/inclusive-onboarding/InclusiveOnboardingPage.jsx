import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { get, post } from '../../services/api.js';
import { useI18n } from '../../i18n/I18nProvider.jsx';
import './InclusiveOnboardingPage.css';

const API = '/api/v1';
const CREDENTIAL_TYPES = [
  ['NATIONAL_ID', 'nationalId'],
  ['REFUGEE_ID', 'refugeeId'],
  ['ASYLUM_SEEKER_CERTIFICATE', 'asylumCertificate'],
  ['PASSPORT', 'passport'],
  ['DRIVING_LICENCE', 'drivingLicence'],
  ['VOTER_ID', 'voterId'],
  ['OTHER_APPROVED_DOCUMENT', 'otherApproved'],
];

function responseData(response) {
  return response?.data?.data ?? null;
}
function apiError(error, fallback) {
  return error?.response?.data?.error?.message || fallback;
}
function Input({ label, value, onChange, required = false, type = 'text', placeholder, dir }) {
  return (
    <label className="titech-inclusive-field">
      <span>{label}{required ? ' *' : ''}</span>
      <input dir={dir || 'auto'} type={type} value={value} required={required} placeholder={placeholder || ''} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
function Select({ label, value, onChange, children, required = false }) {
  return (
    <label className="titech-inclusive-field">
      <span>{label}{required ? ' *' : ''}</span>
      <select value={value} required={required} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </label>
  );
}
function Upload({ label, file, onChange, required = false }) {
  return (
    <label className="titech-inclusive-field">
      <span>{label}{required ? ' *' : ''}</span>
      <input type="file" required={required} accept="application/pdf,image/jpeg,image/png" onChange={(event) => onChange(event.target.files?.[0] || null)} />
      {file ? <small>{file.name} · {Math.ceil(file.size / 1024)} KiB</small> : null}
    </label>
  );
}
function StatusLine({ label, value }) {
  return <div className="titech-inclusive-status-row"><span>{label}</span><strong>{value || '—'}</strong></div>;
}

export default function InclusiveOnboardingPage() {
  const { t, locale, direction } = useI18n();
  const [activeSection, setActiveSection] = useState('participant');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [identityStatus, setIdentityStatus] = useState(null);
  const [partnerStatus, setPartnerStatus] = useState(null);
  const [insuranceProfile, setInsuranceProfile] = useState(null);
  const [consentRecipientTenantId, setConsentRecipientTenantId] = useState('');
  const [consentRecipient, setConsentRecipient] = useState(null);
  const [insuranceConsent, setInsuranceConsent] = useState(null);
  const [consentAffirmed, setConsentAffirmed] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const [products, setProducts] = useState([]);
  const [enrolments, setEnrolments] = useState([]);
  const [premiums, setPremiums] = useState([]);
  const [claims, setClaims] = useState([]);
  const [lastLoadErrors, setLastLoadErrors] = useState(0);

  const [credential, setCredential] = useState({
    credentialType: 'REFUGEE_ID', fullName: '', issuingAuthority: '', issuingCountry: 'UG',
    issuedAt: '', expiresAt: '', credentialIdentifier: '', approvedDocumentPolicyReference: '',
    assistedParticipantReference: '', file: null,
  });
  const [partner, setPartner] = useState({
    organisationType: 'REFUGEE_SERVING_ORGANISATION', legalName: '', registrationReference: '',
    jurisdiction: 'UG', competentAuthority: '', programmeScopes: '', dataSharingAgreementReference: '', file: null,
  });
  const [insurer, setInsurer] = useState({
    organisationType: 'INSURER', legalName: '', tradingName: '', registrationReference: '', jurisdiction: 'UG',
    competentAuthority: '', licenceReference: '', registeredContactEmail: '', registeredContactPhone: '',
    licenceActivities: '', approvedTerritories: 'UG', licenceIssuedAt: '', licenceExpiresAt: '',
    agreementReference: '', dataProcessingAgreementReference: '', file: null,
  });
  const [product, setProduct] = useState({
    productReference: '', productName: '', productVersion: '1.0', sourceSystemReference: '',
    termsAndConditionsVersion: '1.0', currency: 'UGX', coverageReference: '', coverageName: '', coverageTermsVersion: '1.0', coverageSourceReference: '',
  });
  const [enrolment, setEnrolment] = useState({
    productId: '', coverageReference: '', participantTenantReference: '', participantReference: '',
    participantVerificationReference: '', consentReference: '', termsAndConditionsVersion: '', groupReference: '',
  });
  const [premium, setPremium] = useState({ enrolmentId: '', premiumReference: '', expectedAmountMinor: '', currency: 'UGX', idempotencyKey: '', dueAt: '' });
  const [claim, setClaim] = useState({ enrolmentId: '', policyReference: '', claimantReference: '', claimReference: '', claimCategory: '', file: null });
  const [enrolmentDecision, setEnrolmentDecision] = useState({ enrolmentId: '', status: 'ELIGIBLE', decisionSource: '', decisionReference: '', policyReference: '', coverageStartsAt: '', coverageEndsAt: '', reason: '' });
  const [claimDecision, setClaimDecision] = useState({ claimId: '', decision: 'APPROVED', sourceSystem: '', externalDecisionReference: '', reasonReference: '', additionalInformationRequest: '' });
  const [activationFiles, setActivationFiles] = useState({});
  const [identityReview, setIdentityReview] = useState({ participantUserId: '', decision: 'VERIFIED', reasonCode: 'DOCUMENT_UNREADABLE', reviewNotes: '' });
  const [appealReason, setAppealReason] = useState('');
  const [partnerReview, setPartnerReview] = useState({ decision: 'VERIFIED', verificationSource: '', reason: '' });
  const [licenceReview, setLicenceReview] = useState({ decision: 'VERIFIED', verificationSource: '', reason: '' });

  const text = useCallback((key) => t(`inclusive.${key}`) || key, [t]);
  const chosenProduct = useMemo(() => products.find((item) => String(item._id || item.id) === enrolment.productId), [products, enrolment.productId]);
  const availableCoverage = useMemo(() => chosenProduct?.coverageReferences || [], [chosenProduct]);

  const uploadFile = useCallback(async (file, purpose, subjectReference) => {
    if (!file) throw new Error(text('noEvidence'));
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowed.includes(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error(text('noEvidence'));
    const headers = {
      'Content-Type': file.type,
      'X-TITech-Document-Purpose': purpose,
    };
    if (subjectReference) headers['X-TITech-Document-Subject'] = subjectReference;
    const response = await post(`${API}/documents/upload`, file, { headers, transformRequest: [(value) => value] });
    const result = responseData(response);
    if (!result?.documentReference) throw new Error(text('failed'));
    return result.documentReference;
  }, [text]);

  const loadSummary = useCallback(async () => {
    const requests = activeSection === 'participant'
      ? [['identity', () => get(`${API}/participant-onboarding/me`)]]
      : activeSection === 'organisation'
        ? [['partner', () => get(`${API}/refugee-partners/me`)]]
        : activeSection === 'insurer'
          ? [['insuranceProfile', () => get(`${API}/insurance/institution`)], ['readiness', () => get(`${API}/insurance/readiness`)]]
          : [];
    if (requests.length === 0) return;
    const outcomes = await Promise.allSettled(requests.map(([, request]) => request()));
    let failures = 0;
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'rejected') { failures += 1; return; }
      const data = responseData(outcome.value);
      const name = requests[index][0];
      if (name === 'identity') setIdentityStatus(data);
      if (name === 'partner') setPartnerStatus(data);
      if (name === 'insuranceProfile') setInsuranceProfile(data);
      if (name === 'readiness') setReadiness(data);
    });
    setLastLoadErrors(failures);
  }, [activeSection]);

  const resolveConsentRecipient = async () => {
    const recipientTenantId = consentRecipientTenantId.trim();
    if (!recipientTenantId) throw new Error(text('recipientTenantRequired'));
    const response = await get(`${API}/participant-onboarding/insurance-recipients/${encodeURIComponent(recipientTenantId)}?language=${encodeURIComponent(locale)}`);
    const recipient = responseData(response);
    if (!recipient?.tenantId || !recipient.noticeVersion || !recipient.noticeText) throw new Error(text('failed'));
    setConsentRecipient(recipient);
    setConsentAffirmed(false);
    const consentResponse = await get(`${API}/participant-onboarding/insurance-consent?recipientTenantId=${encodeURIComponent(recipient.tenantId)}`);
    setInsuranceConsent(responseData(consentResponse));
    return recipient;
  };

  const resolveConsentRecipientAction = () => {
    void runAction(async () => resolveConsentRecipient());
  };

  const submitInsuranceConsent = (event) => {
    event.preventDefault();
    void runAction(async () => {
      if (!consentRecipient || consentRecipient.tenantId !== consentRecipientTenantId.trim().toLowerCase()) {
        throw new Error(text('checkRecipientFirst'));
      }
      if (!consentAffirmed) throw new Error(text('consentRequired'));
      const response = await post(`${API}/participant-onboarding/insurance-consent`, {
        recipientTenantId: consentRecipient.tenantId,
        noticeVersion: consentRecipient.noticeVersion,
        noticeLanguage: locale,
        affirmed: true,
      });
      const recordedConsent = responseData(response);
      setInsuranceConsent(recordedConsent);
      if (recordedConsent?.consentId) updateObject(setEnrolment, 'consentReference', recordedConsent.consentId);
      setConsentAffirmed(false);
      return response;
    });
  };

  const withdrawInsuranceConsent = () => {
    if (!insuranceConsent?.consentId) return;
    void runAction(async () => {
      const response = await post(`${API}/participant-onboarding/insurance-consent/${encodeURIComponent(insuranceConsent.consentId)}/withdraw`, {});
      setInsuranceConsent(responseData(response));
      setConsentAffirmed(false);
      return response;
    });
  };

  const loadOperations = useCallback(async () => {
    setError('');
    const paths = [
      ['products', `${API}/insurance/products`],
      ['enrolments', `${API}/insurance/enrolments`],
      ['premiums', `${API}/insurance/premiums`],
      ['claims', `${API}/insurance/claims`],
    ];
    const outcomes = await Promise.allSettled(paths.map(([, path]) => get(path)));
    const setters = { products: setProducts, enrolments: setEnrolments, premiums: setPremiums, claims: setClaims };
    let failed = 0;
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') setters[paths[index][0]](Array.isArray(responseData(outcome.value)) ? responseData(outcome.value) : []);
      else failed += 1;
    });
    setLastLoadErrors(failed);
    if (failed) setError(text('errorLoad'));
  }, [text]);

  useEffect(() => { void loadSummary(); if (activeSection === 'operations') void loadOperations(); }, [activeSection, loadSummary, loadOperations]);

  const runAction = async (action) => {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const result = await action();
      setNotice(text('success'));
      await loadSummary();
      return result;
    } catch (failure) {
      setError(apiError(failure, failure?.message || text('failed')));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const submitCredential = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const userReference = credential.assistedParticipantReference.trim();
      const documentReference = await uploadFile(credential.file, 'IDENTITY_CREDENTIAL', userReference || undefined);
      const payload = {
        credentialType: credential.credentialType,
        fullName: credential.fullName,
        issuingAuthority: credential.issuingAuthority,
        issuingCountry: credential.issuingCountry,
        documentReference,
        ...(credential.issuedAt ? { issuedAt: credential.issuedAt } : {}),
        ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {}),
        ...(credential.credentialIdentifier ? { credentialIdentifier: credential.credentialIdentifier } : {}),
        ...(credential.credentialType === 'OTHER_APPROVED_DOCUMENT' ? { approvedDocumentPolicyReference: credential.approvedDocumentPolicyReference } : {}),
        ...(userReference ? { userId: userReference } : {}),
      };
      const response = await post(`${API}/participant-onboarding/credentials`, payload);
      setIdentityStatus(responseData(response));
      return response;
    });
  };

  const submitPartner = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const evidenceReference = await uploadFile(partner.file, 'OTHER_COMPLIANCE_EVIDENCE');
      const response = await post(`${API}/refugee-partners`, {
        organisationType: partner.organisationType,
        legalName: partner.legalName,
        registrationReference: partner.registrationReference,
        jurisdiction: partner.jurisdiction,
        competentAuthority: partner.competentAuthority,
        programmeScopes: partner.programmeScopes.split(',').map((item) => item.trim()).filter(Boolean),
        dataSharingAgreementReference: partner.dataSharingAgreementReference || undefined,
        evidenceReference,
      });
      setPartnerStatus(responseData(response));
      return response;
    });
  };

  const submitIdentityReview = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const response = await post(`${API}/participant-onboarding/${encodeURIComponent(identityReview.participantUserId.trim())}/review`, {
        decision: identityReview.decision,
        ...(identityReview.decision === 'REJECTED' ? { reasonCode: identityReview.reasonCode } : {}),
        ...(identityReview.reviewNotes.trim() ? { reviewNotes: identityReview.reviewNotes.trim() } : {}),
      });
      return response;
    });
  };

  const submitIdentityAppeal = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const response = await post(`${API}/participant-onboarding/appeals`, { reason: appealReason.trim() });
      setIdentityStatus(responseData(response));
      setAppealReason('');
      return response;
    });
  };

  const submitPartnerReview = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const response = await post(`${API}/refugee-partners/review`, {
        decision: partnerReview.decision,
        verificationSource: partnerReview.verificationSource.trim(),
        ...(partnerReview.reason.trim() ? { reason: partnerReview.reason.trim() } : {}),
      });
      setPartnerStatus(responseData(response));
      return response;
    });
  };

  const submitLicenceReview = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const response = await post(`${API}/insurance/licence/review`, {
        decision: licenceReview.decision,
        verificationSource: licenceReview.verificationSource.trim(),
        ...(licenceReview.reason.trim() ? { reason: licenceReview.reason.trim() } : {}),
      });
      setInsuranceProfile(responseData(response));
      return response;
    });
  };

  const submitInsurer = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const licenceEvidenceReference = await uploadFile(insurer.file, 'INSURANCE_LICENCE');
      const response = await post(`${API}/insurance/institution`, {
        organisationType: insurer.organisationType,
        legalName: insurer.legalName,
        tradingName: insurer.tradingName || undefined,
        registrationReference: insurer.registrationReference,
        jurisdiction: insurer.jurisdiction,
        competentAuthority: insurer.competentAuthority,
        licenceReference: insurer.licenceReference,
        registeredContactEmail: insurer.registeredContactEmail || undefined,
        registeredContactPhone: insurer.registeredContactPhone || undefined,
        licenceActivities: insurer.licenceActivities.split(',').map((item) => item.trim()).filter(Boolean),
        approvedTerritories: insurer.approvedTerritories.split(',').map((item) => item.trim()).filter(Boolean),
        ...(insurer.licenceIssuedAt ? { licenceIssuedAt: insurer.licenceIssuedAt } : {}),
        ...(insurer.licenceExpiresAt ? { licenceExpiresAt: insurer.licenceExpiresAt } : {}),
        agreementReference: insurer.agreementReference || undefined,
        dataProcessingAgreementReference: insurer.dataProcessingAgreementReference || undefined,
        licenceEvidenceReference,
      });
      setInsuranceProfile(responseData(response));
      return response;
    });
  };

  const createProduct = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const response = await post(`${API}/insurance/products`, {
        productReference: product.productReference,
        productName: product.productName,
        productVersion: product.productVersion,
        sourceSystemReference: product.sourceSystemReference,
        termsAndConditionsVersion: product.termsAndConditionsVersion,
        currency: product.currency,
        coverageReferences: [{
          coverageReference: product.coverageReference,
          coverageName: product.coverageName,
          termsVersion: product.coverageTermsVersion,
          sourceSystemReference: product.coverageSourceReference,
        }],
      });
      await loadOperations();
      return response;
    });
  };

  const createEnrolment = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const response = await post(`${API}/insurance/enrolments`, {
        ...enrolment,
        groupReference: enrolment.groupReference || undefined,
      });
      await loadOperations();
      return response;
    });
  };

  const recordEnrolmentDecision = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const response = await post(`${API}/insurance/enrolments/${encodeURIComponent(enrolmentDecision.enrolmentId)}/decision`, {
        status: enrolmentDecision.status,
        decisionSource: enrolmentDecision.decisionSource,
        decisionReference: enrolmentDecision.decisionReference,
        ...(enrolmentDecision.policyReference ? { policyReference: enrolmentDecision.policyReference } : {}),
        ...(enrolmentDecision.coverageStartsAt ? { coverageStartsAt: enrolmentDecision.coverageStartsAt } : {}),
        ...(enrolmentDecision.coverageEndsAt ? { coverageEndsAt: enrolmentDecision.coverageEndsAt } : {}),
        ...(enrolmentDecision.reason ? { reason: enrolmentDecision.reason } : {}),
      });
      await loadOperations();
      return response;
    });
  };

  const recordClaimDecision = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const response = await post(`${API}/insurance/claims/${encodeURIComponent(claimDecision.claimId)}/decision-reference`, {
        decision: claimDecision.decision,
        sourceSystem: claimDecision.sourceSystem,
        externalDecisionReference: claimDecision.externalDecisionReference,
        reasonReference: claimDecision.reasonReference || undefined,
        additionalInformationRequest: claimDecision.additionalInformationRequest || undefined,
      });
      await loadOperations();
      return response;
    });
  };

  const activateProduct = (event, item) => {
    event.preventDefault();
    void runAction(async () => {
      const evidenceFile = activationFiles[String(item._id || item.id)];
      const activationEvidenceReference = await uploadFile(evidenceFile, 'OTHER_COMPLIANCE_EVIDENCE');
      const response = await post(`${API}/insurance/products/${encodeURIComponent(String(item._id || item.id))}/activate`, { activationEvidenceReference });
      await loadOperations();
      return response;
    });
  };

  const createPremium = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const amount = Number(premium.expectedAmountMinor);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer in currency minor units.');
      const response = await post(`${API}/insurance/premiums`, {
        ...premium,
        expectedAmountMinor: amount,
        dueAt: premium.dueAt || undefined,
      });
      await loadOperations();
      return response;
    });
  };

  const createClaim = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const evidenceReference = await uploadFile(claim.file, 'INSURANCE_CLAIM');
      const response = await post(`${API}/insurance/claims`, {
        enrolmentId: claim.enrolmentId,
        policyReference: claim.policyReference,
        claimantReference: claim.claimantReference,
        claimReference: claim.claimReference,
        claimCategory: claim.claimCategory,
        evidenceReferences: [evidenceReference],
      });
      await loadOperations();
      return response;
    });
  };

  const updateObject = (setter, key, value) => setter((current) => ({ ...current, [key]: value }));
  const sections = [
    ['participant', text('participant')],
    ['organisation', text('organisation')],
    ['insurer', text('insurer')],
    ['operations', text('operations')],
  ];

  return (
    <main className="titech-inclusive-page" dir={direction} lang={locale}>
      <header className="titech-inclusive-hero">
        <div className="titech-inclusive-eyebrow">TITech Capital LTD · TITech Community Capital</div>
        <h1>{text('title')}</h1>
        <p>{text('subtitle')}</p>
      </header>

      <nav className="titech-inclusive-tabs" aria-label={text('title')}>
        {sections.map(([id, label]) => (
          <button key={id} type="button" className={activeSection === id ? 'active' : ''} aria-pressed={activeSection === id} onClick={() => { setActiveSection(id); setNotice(''); setError(''); }}>{label}</button>
        ))}
      </nav>

      {error ? <div className="titech-inclusive-alert error" role="alert">{error}</div> : null}
      {notice ? <div className="titech-inclusive-alert success" role="status">{notice}</div> : null}
      <p className="titech-inclusive-privacy">{text('privacy')}</p>

      {activeSection === 'participant' ? (
        <>
        <section className="titech-inclusive-card">
          <h2>{text('participant')}</h2>
          <p className="titech-inclusive-help">{text('assistedNote')}</p>
          <form onSubmit={submitCredential}>
            <div className="titech-inclusive-grid">
              <Input label={text('fullName')} value={credential.fullName} required onChange={(value) => updateObject(setCredential, 'fullName', value)} />
              <Select label={text('credentialType')} value={credential.credentialType} required onChange={(value) => updateObject(setCredential, 'credentialType', value)}>
                {CREDENTIAL_TYPES.map(([value, key]) => <option key={value} value={value}>{text(key)}</option>)}
              </Select>
              <Input label={text('issuingAuthority')} value={credential.issuingAuthority} required onChange={(value) => updateObject(setCredential, 'issuingAuthority', value)} />
              <Input label={text('issuingCountry')} value={credential.issuingCountry} required onChange={(value) => updateObject(setCredential, 'issuingCountry', value)} />
              <Input label={text('issuedAt')} value={credential.issuedAt} type="date" onChange={(value) => updateObject(setCredential, 'issuedAt', value)} />
              <Input label={text('expiresAt')} value={credential.expiresAt} type="date" onChange={(value) => updateObject(setCredential, 'expiresAt', value)} />
              <Input label={text('credentialIdentifier')} value={credential.credentialIdentifier} onChange={(value) => updateObject(setCredential, 'credentialIdentifier', value)} />
              {credential.credentialType === 'OTHER_APPROVED_DOCUMENT' ? <Input label={text('policyReference')} value={credential.approvedDocumentPolicyReference} required onChange={(value) => updateObject(setCredential, 'approvedDocumentPolicyReference', value)} /> : null}
              <Input label={text('participantRef')} value={credential.assistedParticipantReference} onChange={(value) => updateObject(setCredential, 'assistedParticipantReference', value)} />
              <Upload label={text('evidenceFile')} file={credential.file} required onChange={(value) => updateObject(setCredential, 'file', value)} />
            </div>
            <div className="titech-inclusive-actions"><button className="titech-inclusive-primary" disabled={busy} type="submit">{busy ? text('working') : text('submitCredential')}</button><button type="button" onClick={() => void loadSummary()}>{text('refresh')}</button></div>
          </form>
          {identityStatus ? <div className="titech-inclusive-status"><StatusLine label={text('status')} value={identityStatus.status} /><StatusLine label={text('credentialType')} value={identityStatus.primaryCredentialType} /><StatusLine label={text('issuingAuthority')} value={identityStatus.documents?.[0]?.issuingAuthority} /></div> : null}
          <details className="titech-inclusive-review-panel">
            <summary>{text('reviewIdentityTitle')}</summary>
            <p className="titech-inclusive-help">{text('reviewerSecurityNote')}</p>
            <form onSubmit={submitIdentityReview}>
              <div className="titech-inclusive-grid">
                <Input label={text('participantUserId')} value={identityReview.participantUserId} required onChange={(value) => updateObject(setIdentityReview, 'participantUserId', value)} />
                <Select label={text('reviewDecision')} value={identityReview.decision} required onChange={(value) => updateObject(setIdentityReview, 'decision', value)}><option value="VERIFIED">{text('verifyDecision')}</option><option value="NEEDS_MORE_INFORMATION">{text('requestInformationDecision')}</option><option value="REJECTED">{text('rejectDecision')}</option></Select>
                {identityReview.decision === 'REJECTED' ? <Select label={text('rejectionReasonCode')} value={identityReview.reasonCode} required onChange={(value) => updateObject(setIdentityReview, 'reasonCode', value)}>{['DOCUMENT_INVALID', 'DOCUMENT_EXPIRED', 'DOCUMENT_UNREADABLE', 'IDENTITY_MISMATCH', 'DUPLICATE_IDENTITY', 'INSUFFICIENT_DOCUMENTATION', 'FRAUD_SUSPECTED', 'OTHER'].map((value) => <option key={value} value={value}>{value}</option>)}</Select> : null}
                <Input label={text('participantFacingReviewNote')} value={identityReview.reviewNotes} onChange={(value) => updateObject(setIdentityReview, 'reviewNotes', value)} />
              </div>
              <button className="titech-inclusive-primary" type="submit" disabled={busy || !identityReview.participantUserId.trim()}>{busy ? text('working') : text('recordIdentityDecision')}</button>
            </form>
          </details>
          {identityStatus?.status === 'REJECTED' ? <details className="titech-inclusive-review-panel"><summary>{text('reconsiderationRequest')}</summary><form onSubmit={submitIdentityAppeal}><Input label={text('appealReason')} value={appealReason} required onChange={setAppealReason} /><button type="submit" disabled={busy || !appealReason.trim()}>{busy ? text('working') : text('submitAppeal')}</button></form></details> : null}
        </section>
        <section className="titech-inclusive-card">
          <h2>{text('insuranceConsent')}</h2>
          <p className="titech-inclusive-help">{text('insuranceConsentExplain')}</p>
          <form onSubmit={submitInsuranceConsent}>
            <div className="titech-inclusive-grid">
              <Input label={text('recipientTenantId')} value={consentRecipientTenantId} required onChange={(value) => { setConsentRecipientTenantId(value); setConsentRecipient(null); setInsuranceConsent(null); setConsentAffirmed(false); }} />
            </div>
            <div className="titech-inclusive-actions">
              <button type="button" disabled={busy} onClick={resolveConsentRecipientAction}>{busy ? text('working') : text('checkRecipient')}</button>
            </div>
            {consentRecipient ? <div className="titech-inclusive-status">
              <StatusLine label={text('legalName')} value={consentRecipient.legalName} />
              <StatusLine label={text('licenceReference')} value={consentRecipient.licenceReference} />
              <StatusLine label={text('licenceStatus')} value={consentRecipient.licenceStatus} />
              <p className="titech-inclusive-consent-text" lang={consentRecipient.noticeLanguage} dir={consentRecipient.noticeLanguage === 'ar' ? 'rtl' : 'auto'}>{consentRecipient.noticeText}</p>
              <label className="titech-inclusive-consent-check">
                <input type="checkbox" checked={consentAffirmed} onChange={(event) => setConsentAffirmed(event.target.checked)} required />
                <span>{text('consentAffirmation')}</span>
              </label>
              <button className="titech-inclusive-primary" type="submit" disabled={busy || !consentAffirmed || Boolean(insuranceConsent?.status === 'GRANTED')}>{busy ? text('working') : text('grantConsent')}</button>
            </div> : null}
          </form>
          {insuranceConsent ? <div className="titech-inclusive-status">
            <StatusLine label={text('consentStatus')} value={insuranceConsent.status} />
            <StatusLine label={text('consentVersion')} value={insuranceConsent.noticeVersion} />
            {insuranceConsent.status === 'GRANTED' ? <button type="button" disabled={busy} onClick={withdrawInsuranceConsent}>{text('withdrawConsent')}</button> : null}
          </div> : null}
        </section>
        </>
      ) : null}

      {activeSection === 'organisation' ? (
        <section className="titech-inclusive-card">
          <h2>{text('organisation')}</h2>
          <form onSubmit={submitPartner}>
            <div className="titech-inclusive-grid">
              <Input label={text('legalName')} value={partner.legalName} required onChange={(value) => updateObject(setPartner, 'legalName', value)} />
              <Select label={text('partnerType')} value={partner.organisationType} required onChange={(value) => updateObject(setPartner, 'organisationType', value)}>
                <option value="REFUGEE_SERVING_ORGANISATION">Refugee-serving organisation</option><option value="COMMUNITY_SUPPORT_ORGANISATION">Community support organisation</option><option value="HUMANITARIAN_PARTNER">Humanitarian partner</option><option value="OTHER_APPROVED_PARTNER">Other approved partner</option>
              </Select>
              <Input label={text('registrationReference')} value={partner.registrationReference} required onChange={(value) => updateObject(setPartner, 'registrationReference', value)} />
              <Input label={text('jurisdiction')} value={partner.jurisdiction} required onChange={(value) => updateObject(setPartner, 'jurisdiction', value)} />
              <Input label={text('authority')} value={partner.competentAuthority} required onChange={(value) => updateObject(setPartner, 'competentAuthority', value)} />
              <Input label={text('programmeScopes')} value={partner.programmeScopes} onChange={(value) => updateObject(setPartner, 'programmeScopes', value)} />
              <Input label={text('dataAgreement')} value={partner.dataSharingAgreementReference} onChange={(value) => updateObject(setPartner, 'dataSharingAgreementReference', value)} />
              <Upload label={text('evidenceFile')} file={partner.file} required onChange={(value) => updateObject(setPartner, 'file', value)} />
            </div>
            <div className="titech-inclusive-actions"><button className="titech-inclusive-primary" disabled={busy} type="submit">{busy ? text('working') : text('submitPartner')}</button><button type="button" onClick={() => void loadSummary()}>{text('refresh')}</button></div>
          </form>
          {partnerStatus ? <div className="titech-inclusive-status"><StatusLine label={text('status')} value={partnerStatus.verificationStatus} /><StatusLine label={text('legalName')} value={partnerStatus.legalName} /></div> : null}
          <details className="titech-inclusive-review-panel"><summary>{text('reviewPartnerTitle')}</summary>
            <p className="titech-inclusive-help">{text('partnerReviewerNote')}</p>
            <form onSubmit={submitPartnerReview}><div className="titech-inclusive-grid">
              <Select label={text('reviewDecision')} value={partnerReview.decision} required onChange={(value) => updateObject(setPartnerReview, 'decision', value)}>{['VERIFIED', 'NEEDS_MORE_INFORMATION', 'REJECTED', 'SUSPENDED'].map((value) => <option key={value} value={value}>{value}</option>)}</Select>
              <Input label={text('verificationSource')} value={partnerReview.verificationSource} required onChange={(value) => updateObject(setPartnerReview, 'verificationSource', value)} />
              <Input label={text('reviewReason')} value={partnerReview.reason} onChange={(value) => updateObject(setPartnerReview, 'reason', value)} />
            </div><button type="submit" disabled={busy}>{busy ? text('working') : text('recordPartnerDecision')}</button></form>
          </details>
        </section>
      ) : null}

      {activeSection === 'insurer' ? (
        <section className="titech-inclusive-card">
          <h2>{text('insurer')}</h2>
          <p className="titech-inclusive-help">{text('licenceReviewNotice')}</p>
          <form onSubmit={submitInsurer}>
            <div className="titech-inclusive-grid">
              <Input label={text('legalName')} value={insurer.legalName} required onChange={(value) => updateObject(setInsurer, 'legalName', value)} />
              <Select label={text('organisationType')} value={insurer.organisationType} required onChange={(value) => updateObject(setInsurer, 'organisationType', value)}>
                <option value="INSURER">Insurer</option><option value="INSURANCE_BROKER">Insurance broker</option><option value="INSURANCE_AGENT">Insurance agent</option><option value="MICROINSURANCE_DISTRIBUTION_PARTNER">Microinsurance distribution partner</option><option value="THIRD_PARTY_ADMINISTRATOR">Third-party administrator</option>
              </Select>
              <Input label={text('registrationReference')} value={insurer.registrationReference} required onChange={(value) => updateObject(setInsurer, 'registrationReference', value)} />
              <Input label={text('jurisdiction')} value={insurer.jurisdiction} required onChange={(value) => updateObject(setInsurer, 'jurisdiction', value)} />
              <Input label={text('authority')} value={insurer.competentAuthority} required onChange={(value) => updateObject(setInsurer, 'competentAuthority', value)} />
              <Input label={text('licenceReference')} value={insurer.licenceReference} required onChange={(value) => updateObject(setInsurer, 'licenceReference', value)} />
              <Input label={text('licenceActivities')} value={insurer.licenceActivities} onChange={(value) => updateObject(setInsurer, 'licenceActivities', value)} />
              <Input label={text('approvedTerritories')} value={insurer.approvedTerritories} onChange={(value) => updateObject(setInsurer, 'approvedTerritories', value)} />
              <Input label={text('registeredContactEmail') } value={insurer.registeredContactEmail} type="email" onChange={(value) => updateObject(setInsurer, 'registeredContactEmail', value)} />
              <Input label={text('registeredContactPhone') } value={insurer.registeredContactPhone} onChange={(value) => updateObject(setInsurer, 'registeredContactPhone', value)} />
              <Input label={text('licenceIssuedAt') } value={insurer.licenceIssuedAt} type="date" onChange={(value) => updateObject(setInsurer, 'licenceIssuedAt', value)} />
              <Input label={text('licenceExpiresAt') } value={insurer.licenceExpiresAt} type="date" onChange={(value) => updateObject(setInsurer, 'licenceExpiresAt', value)} />
              <Input label={text('agreementReference') } value={insurer.agreementReference} onChange={(value) => updateObject(setInsurer, 'agreementReference', value)} />
              <Input label={text('dataProcessingAgreementReference') } value={insurer.dataProcessingAgreementReference} onChange={(value) => updateObject(setInsurer, 'dataProcessingAgreementReference', value)} />
              <Upload label={text('evidenceFile')} file={insurer.file} required onChange={(value) => updateObject(setInsurer, 'file', value)} />
            </div>
            <div className="titech-inclusive-actions"><button className="titech-inclusive-primary" disabled={busy} type="submit">{busy ? text('working') : text('submitInsurer')}</button><button type="button" onClick={() => void loadSummary()}>{text('refresh')}</button></div>
          </form>
          {insuranceProfile ? <div className="titech-inclusive-status"><StatusLine label={text('licenceStatus')} value={insuranceProfile.licenceStatus} /><StatusLine label={text('institutionOnboarding') } value={insuranceProfile.onboardingStatus} /><StatusLine label={text('integration') } value={insuranceProfile.integrationStatus} /></div> : null}
          <details className="titech-inclusive-review-panel"><summary>{text('reviewLicenceTitle')}</summary>
            <p className="titech-inclusive-help">{text('licenceReviewerNote')}</p>
            <form onSubmit={submitLicenceReview}><div className="titech-inclusive-grid">
              <Select label={text('licenceDecision')} value={licenceReview.decision} required onChange={(value) => updateObject(setLicenceReview, 'decision', value)}>{['VERIFIED', 'NEEDS_MORE_INFORMATION', 'REJECTED', 'SUSPENDED', 'EXPIRED'].map((value) => <option key={value} value={value}>{value}</option>)}</Select>
              <Input label={text('officialRegisterReference')} value={licenceReview.verificationSource} required onChange={(value) => updateObject(setLicenceReview, 'verificationSource', value)} />
              <Input label={text('reviewReason')} value={licenceReview.reason} onChange={(value) => updateObject(setLicenceReview, 'reason', value)} />
            </div><button type="submit" disabled={busy}>{busy ? text('working') : text('recordLicenceDecision')}</button></form>
          </details>
          {readiness ? <div className="titech-inclusive-status"><StatusLine label={text('livePremium')} value={readiness.livePremiumProcessing ? text('enabled') : text('notOperational')} /><StatusLine label={text('livePayout')} value={readiness.livePayoutProcessing ? text('enabled') : text('notOperational')} />{Array.isArray(readiness.blockingReasons) && readiness.blockingReasons.length ? <ul>{readiness.blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}</div> : null}
        </section>
      ) : null}

      {activeSection === 'operations' ? (
        <section className="titech-inclusive-operations">
          <div className="titech-inclusive-card">
            <div className="titech-inclusive-card-heading"><div><h2>{text('products')}</h2><p className="titech-inclusive-help">{text('productTermsNotice')}</p></div><button type="button" onClick={() => void loadOperations()}>{text('refreshOps')}</button></div>
            <form onSubmit={createProduct}>
              <div className="titech-inclusive-grid">
                <Input label={text('productReference')} value={product.productReference} required onChange={(value) => updateObject(setProduct, 'productReference', value)} />
                <Input label={text('productName')} value={product.productName} required onChange={(value) => updateObject(setProduct, 'productName', value)} />
                <Input label={text('productVersion')} value={product.productVersion} required onChange={(value) => updateObject(setProduct, 'productVersion', value)} />
                <Input label={text('sourceSystem')} value={product.sourceSystemReference} required onChange={(value) => updateObject(setProduct, 'sourceSystemReference', value)} />
                <Input label={text('termsVersion')} value={product.termsAndConditionsVersion} required onChange={(value) => updateObject(setProduct, 'termsAndConditionsVersion', value)} />
                <Input label={text('currency')} value={product.currency} required onChange={(value) => updateObject(setProduct, 'currency', value.toUpperCase())} />
                <Input label={text('coverageReference') } value={product.coverageReference} required onChange={(value) => updateObject(setProduct, 'coverageReference', value)} />
                <Input label={text('coverageName') } value={product.coverageName} required onChange={(value) => updateObject(setProduct, 'coverageName', value)} />
                <Input label={text('coverageTermsVersion') } value={product.coverageTermsVersion} required onChange={(value) => updateObject(setProduct, 'coverageTermsVersion', value)} />
                <Input label={text('coverageSourceReference') } value={product.coverageSourceReference} required onChange={(value) => updateObject(setProduct, 'coverageSourceReference', value)} />
              </div>
              <button className="titech-inclusive-primary" disabled={busy} type="submit">{busy ? text('working') : text('createProduct')}</button>
            </form>
            <div className="titech-inclusive-records">{products.map((item) => (
              <article key={String(item._id || item.id)}>
                <strong>{item.productName || item.productReference}</strong><span>{item.productReference} · {item.productVersion} · {item.productStatus}</span>
                {['DRAFT', 'PENDING_APPROVAL'].includes(item.productStatus) ? <form className="titech-inclusive-inline-form" onSubmit={(event) => activateProduct(event, item)}>
                  <Upload label={text('activationEvidence') } file={activationFiles[String(item._id || item.id)] || null} required onChange={(value) => setActivationFiles((current) => ({ ...current, [String(item._id || item.id)]: value }))} />
                  <button type="submit" disabled={busy}>Activate with evidence</button>
                </form> : null}
              </article>
            ))}{products.length === 0 ? <p className="titech-inclusive-help">No product references loaded. Refresh the list; access may require a specific role.</p> : null}</div>
          </div>

          <div className="titech-inclusive-card">
            <h2>{text('enrolments')}</h2>
            <p className="titech-inclusive-help">Enrolment submission is not policy issuance or active coverage. Active consent is verified against the participant's source tenant.</p>
            <form onSubmit={createEnrolment}>
              <div className="titech-inclusive-grid">
                <Select label="Active product" value={enrolment.productId} required onChange={(value) => { updateObject(setEnrolment, 'productId', value); updateObject(setEnrolment, 'coverageReference', ''); const selected = products.find((item) => String(item._id || item.id) === value); if (selected) updateObject(setEnrolment, 'termsAndConditionsVersion', selected.termsAndConditionsVersion || ''); }}>
                  <option value="">Select product</option>{products.filter((item) => item.productStatus === 'ACTIVE').map((item) => <option key={String(item._id || item.id)} value={String(item._id || item.id)}>{item.productName} — {item.productReference}</option>)}
                </Select>
                <Select label="Coverage reference" value={enrolment.coverageReference} required onChange={(value) => updateObject(setEnrolment, 'coverageReference', value)}>
                  <option value="">Select coverage</option>{availableCoverage.map((item) => <option key={item.coverageReference} value={item.coverageReference}>{item.coverageName} · {item.coverageReference}</option>)}
                </Select>
                <Input label="Participant source tenant reference" value={enrolment.participantTenantReference} required onChange={(value) => updateObject(setEnrolment, 'participantTenantReference', value)} />
                <Input label="Opaque participant reference" value={enrolment.participantReference} required onChange={(value) => updateObject(setEnrolment, 'participantReference', value)} />
                <Input label="Canonical verified KYC record ID (not document ID)" value={enrolment.participantVerificationReference} required onChange={(value) => updateObject(setEnrolment, 'participantVerificationReference', value)} />
                <Input label="Active consent record ID" value={enrolment.consentReference} required onChange={(value) => updateObject(setEnrolment, 'consentReference', value)} />
                <Input label={text('termsVersion')} value={enrolment.termsAndConditionsVersion} required onChange={(value) => updateObject(setEnrolment, 'termsAndConditionsVersion', value)} />
                <Input label="Group reference (optional)" value={enrolment.groupReference} onChange={(value) => updateObject(setEnrolment, 'groupReference', value)} />
              </div>
              <button className="titech-inclusive-primary" disabled={busy} type="submit">Create enrolment record</button>
            </form>
            <div className="titech-inclusive-records">{enrolments.map((item) => <article key={String(item._id || item.id)}><strong>{item.productReference} · {item.status}</strong><span>{item.coverageReference} · policy: {item.policyReference || 'not issued'}</span></article>)}{enrolments.length === 0 ? <p className="titech-inclusive-help">No enrolments loaded.</p> : null}</div>
            <h3>Record an insurer decision reference</h3>
            <p className="titech-inclusive-help">Use only a decision verified in the insurer’s authoritative system; this form records the reference and does not independently underwrite or issue a policy.</p>
            <form onSubmit={recordEnrolmentDecision}>
              <div className="titech-inclusive-grid">
                <Select label="Enrolment" value={enrolmentDecision.enrolmentId} required onChange={(value) => updateObject(setEnrolmentDecision, 'enrolmentId', value)}><option value="">Select enrolment</option>{enrolments.map((item) => <option key={String(item._id || item.id)} value={String(item._id || item.id)}>{item.productReference} · {item.status}</option>)}</Select>
                <Select label="Decision status" value={enrolmentDecision.status} required onChange={(value) => updateObject(setEnrolmentDecision, 'status', value)}>{['PENDING_ELIGIBILITY', 'NEEDS_MORE_INFORMATION', 'ELIGIBLE', 'INELIGIBLE', 'POLICY_ISSUED', 'COVERAGE_ACTIVE', 'COVERAGE_ENDED', 'CANCELLED'].map((value) => <option key={value} value={value}>{value}</option>)}</Select>
                <Input label="Authoritative decision source" value={enrolmentDecision.decisionSource} required onChange={(value) => updateObject(setEnrolmentDecision, 'decisionSource', value)} />
                <Input label="Decision reference" value={enrolmentDecision.decisionReference} required onChange={(value) => updateObject(setEnrolmentDecision, 'decisionReference', value)} />
                <Input label="Policy reference (for policy/coverage states)" value={enrolmentDecision.policyReference} onChange={(value) => updateObject(setEnrolmentDecision, 'policyReference', value)} />
                <Input label="Coverage start date" value={enrolmentDecision.coverageStartsAt} type="date" onChange={(value) => updateObject(setEnrolmentDecision, 'coverageStartsAt', value)} />
                <Input label="Coverage end date" value={enrolmentDecision.coverageEndsAt} type="date" onChange={(value) => updateObject(setEnrolmentDecision, 'coverageEndsAt', value)} />
                <Input label="Decision reason / additional-information reference" value={enrolmentDecision.reason} onChange={(value) => updateObject(setEnrolmentDecision, 'reason', value)} />
              </div>
              <button className="titech-inclusive-primary" disabled={busy || !enrolmentDecision.enrolmentId} type="submit">Record insurer decision reference</button>
            </form>
          </div>

          <div className="titech-inclusive-card">
            <h2>{text('premiums')}</h2>
            <p className="titech-inclusive-warning">{text('noLivePayments')}</p>
            <form onSubmit={createPremium}>
              <div className="titech-inclusive-grid">
                <Select label={text('enrolmentId')} value={premium.enrolmentId} required onChange={(value) => updateObject(setPremium, 'enrolmentId', value)}>
                  <option value="">Select policy-issued enrolment</option>{enrolments.filter((item) => ['POLICY_ISSUED', 'COVERAGE_ACTIVE'].includes(item.status)).map((item) => <option key={String(item._id || item.id)} value={String(item._id || item.id)}>{item.productReference} · {item.policyReference}</option>)}
                </Select>
                <Input label={text('premiumReference')} value={premium.premiumReference} required onChange={(value) => updateObject(setPremium, 'premiumReference', value)} />
                <Input label={text('amountMinor')} value={premium.expectedAmountMinor} required type="number" onChange={(value) => updateObject(setPremium, 'expectedAmountMinor', value)} />
                <Input label={text('currency')} value={premium.currency} required onChange={(value) => updateObject(setPremium, 'currency', value.toUpperCase())} />
                <Input label="Idempotency key" value={premium.idempotencyKey} required onChange={(value) => updateObject(setPremium, 'idempotencyKey', value)} />
                <Input label="Due date (optional)" value={premium.dueAt} type="date" onChange={(value) => updateObject(setPremium, 'dueAt', value)} />
              </div>
              <button className="titech-inclusive-primary" disabled={busy} type="submit">Create obligation record only</button>
            </form>
            <div className="titech-inclusive-records">{premiums.map((item) => <article key={String(item._id || item.id)}><strong>{item.premiumReference} · {item.status}</strong><span>{item.expectedAmountMinor} {item.currency} · reconciliation: {item.reconciliationStatus || 'not settled'}</span></article>)}{premiums.length === 0 ? <p className="titech-inclusive-help">No premium obligations loaded.</p> : null}</div>
          </div>

          <div className="titech-inclusive-card">
            <h2>{text('claims')}</h2>
            <p className="titech-inclusive-help">Claim intake records evidence and status. TITech does not adjudicate the claim or infer payout settlement from a decision.</p>
            <form onSubmit={createClaim}>
              <div className="titech-inclusive-grid">
                <Select label={text('enrolmentId')} value={claim.enrolmentId} required onChange={(value) => { updateObject(setClaim, 'enrolmentId', value); const selected = enrolments.find((item) => String(item._id || item.id) === value); if (selected) updateObject(setClaim, 'policyReference', selected.policyReference || ''); }}>
                  <option value="">Select policy reference</option>{enrolments.filter((item) => ['POLICY_ISSUED', 'COVERAGE_ACTIVE', 'COVERAGE_ENDED'].includes(item.status)).map((item) => <option key={String(item._id || item.id)} value={String(item._id || item.id)}>{item.productReference} · {item.policyReference}</option>)}
                </Select>
                <Input label="Policy reference" value={claim.policyReference} required onChange={(value) => updateObject(setClaim, 'policyReference', value)} />
                <Input label="Claim reference" value={claim.claimReference} required onChange={(value) => updateObject(setClaim, 'claimReference', value)} />
                <Input label="Claimant reference" value={claim.claimantReference} required onChange={(value) => updateObject(setClaim, 'claimantReference', value)} />
                <Input label="Claim category" value={claim.claimCategory} required onChange={(value) => updateObject(setClaim, 'claimCategory', value)} />
                <Upload label={text('evidenceFile')} file={claim.file} required onChange={(value) => updateObject(setClaim, 'file', value)} />
              </div>
              <button className="titech-inclusive-primary" disabled={busy} type="submit">Submit claim intake record</button>
            </form>
            <div className="titech-inclusive-records">{claims.map((item) => <article key={String(item._id || item.id)}><strong>{item.claimReference} · {item.status}</strong><span>{item.policyReference} · insurer decision: {item.insurerDecision?.decision || 'not recorded'} · payout: {item.payoutReference || 'not recorded'}</span></article>)}{claims.length === 0 ? <p className="titech-inclusive-help">No claims loaded.</p> : null}</div>
            <h3>Record a decision reference from the insurer</h3>
            <form onSubmit={recordClaimDecision}>
              <div className="titech-inclusive-grid">
                <Select label="Claim" value={claimDecision.claimId} required onChange={(value) => updateObject(setClaimDecision, 'claimId', value)}><option value="">Select claim</option>{claims.map((item) => <option key={String(item._id || item.id)} value={String(item._id || item.id)}>{item.claimReference} · {item.status}</option>)}</Select>
                <Select label="Decision" value={claimDecision.decision} required onChange={(value) => updateObject(setClaimDecision, 'decision', value)}><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="NEEDS_MORE_INFORMATION">Needs more information</option></Select>
                <Input label="Insurer source system" value={claimDecision.sourceSystem} required onChange={(value) => updateObject(setClaimDecision, 'sourceSystem', value)} />
                <Input label="External decision reference" value={claimDecision.externalDecisionReference} required onChange={(value) => updateObject(setClaimDecision, 'externalDecisionReference', value)} />
                <Input label="Reason reference" value={claimDecision.reasonReference} onChange={(value) => updateObject(setClaimDecision, 'reasonReference', value)} />
                <Input label="Participant-safe information request" value={claimDecision.additionalInformationRequest} onChange={(value) => updateObject(setClaimDecision, 'additionalInformationRequest', value)} />
              </div>
              <button className="titech-inclusive-primary" disabled={busy || !claimDecision.claimId} type="submit">Record claim decision reference</button>
            </form>
          </div>
        </section>
      ) : null}

      {lastLoadErrors > 0 ? <p className="titech-inclusive-help">{text('errorLoad')}</p> : null}
      <p className="titech-inclusive-translation-note">{text('translationNotice')}</p>
    </main>
  );
}
