import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, patch } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { hasTitechRole, TITECH_ROLES } from '../../security/rbacPolicy.js';
import './faith-community-giving.css';

const API = '/api/v1/faith-giving';
const CATEGORIES = [
  ['CHURCH_TITHES_OFFERINGS', 'Church tithes and offerings'], ['THANKSGIVING_DONATIONS', 'Thanksgiving and donations'],
  ['CHURCH_PROJECTS', 'Church projects'], ['MISSIONS_AND_MINISTRY', 'Missions and ministry'],
  ['BURIAL_BEREAVEMENT_SUPPORT', 'Burial and bereavement support'], ['WEDDING_AND_TRADITIONAL_INTRODUCTION', 'Wedding and traditional introduction'],
  ['COMMUNITY_FUNCTIONS', 'Community functions'], ['EMERGENCY_MEDICAL_ASSISTANCE', 'Emergency and medical assistance'],
  ['EDUCATION_AND_SCHOOL_FEES', 'Education and school fees'], ['EDUCATION_RESOURCES_AND_MATERIALS', 'Scholastic resources and materials'],
  ['SCHOOL_COMPUTERS_AND_DIGITAL_ACCESS', 'School computers and digital access'], ['SCHOOL_FURNITURE_AND_FACILITIES', 'School furniture and facilities'],
  ['SCHOOL_CONSTRUCTION_AND_REHABILITATION', 'School construction and rehabilitation'], ['SCHOLARSHIPS_AND_LEARNING_SUPPORT', 'Scholarships and learning support'], ['CHARITY_AND_HUMANITARIAN', 'Charity and humanitarian'],
  ['COMMUNITY_DEVELOPMENT', 'Community development'], ['COMMUNITY_WELFARE', 'Community welfare'],
  ['OTHER_APPROVED_PURPOSE', 'Other approved purpose'],
];
const ORGANISATION_TYPES = ['CHURCH', 'DIOCESE', 'PARISH', 'CONGREGATION', 'MOSQUE', 'RELIGIOUS_INSTITUTION', 'BURIAL_ASSOCIATION', 'FUNERAL_SUPPORT_ASSOCIATION', 'WEDDING_COMMITTEE', 'FAMILY_ASSOCIATION', 'CLAN_ASSOCIATION', 'COMMUNITY_GROUP', 'NGO', 'CHARITY', 'COMMUNITY_DEVELOPMENT_ORGANISATION', 'OTHER_APPROVED_ORGANISATION'];
const BUDGET_CATEGORIES = ['CHURCH_CONSTRUCTION', 'LAND_AND_FACILITIES', 'MISSIONS', 'MINISTRY', 'BENEVOLENCE', 'FUNERAL_TRANSPORT', 'FUNERAL_SERVICES', 'FOOD_AND_REFRESHMENTS', 'VENUE', 'CATERING', 'PHOTOGRAPHY', 'DECORATION', 'TRANSPORT', 'ACCOMMODATION', 'MEDICAL_AND_HOSPITAL', 'EDUCATION_AND_FEES', 'WATER_AND_SANITATION', 'COMMUNITY_INFRASTRUCTURE', 'ADMINISTRATION', 'SCHOLASTIC_MATERIALS', 'COMPUTERS_AND_DIGITAL_EQUIPMENT', 'SCHOOL_FURNITURE', 'LIBRARY_AND_TEXTBOOKS', 'CLASSROOM_EQUIPMENT', 'TEACHING_AND_LEARNING_MATERIALS', 'ACCESSIBILITY_EQUIPMENT', 'CONSTRUCTION_MATERIALS', 'SCHOOL_REHABILITATION', 'OTHER_APPROVED_COST'];
const EMPTY_FORM = () => ({
  title: '', organisationName: '', organisationType: 'CHURCH', category: 'CHURCH_TITHES_OFFERINGS', communityScope: 'COMMUNITY_WIDE',
  publicDescription: '', beneficiarySummary: '', targetAmountMinor: '', currency: 'UGX',
  budgetCategory: 'OTHER_APPROVED_COST', budgetDescription: '', budgetAmountMinor: '',
  startAt: new Date().toISOString().slice(0, 10), endAt: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  visibility: 'PUBLIC', receivingDestinationReference: '', organiserVerificationReference: '', partnerAuthorizationReference: '',
  feeDisclosure: 'No payment collection or platform fees are processed through this module in the current release.',
  refundPolicy: 'Refund requests require documented review and an approved institutional payment process.',
  surplusPolicy: 'DONOR_CONSENT_REQUIRED_REALLOCATION',
});
function dataOf(response) { return response?.data?.data ?? null; }
function formatMoney(amountMinor) { return new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX', maximumFractionDigits: 0 }).format(Number(amountMinor || 0)); }
function friendlyError(error) {
  const body = error?.response?.data?.error;
  if (body?.code === 'CAPABILITY_DISABLED') return 'Faith & Community Giving is disabled by the server until configuration and external readiness approvals are complete.';
  return body?.message || 'The operation could not be completed. Review permissions, campaign state and required evidence.';
}

export default function FaithGivingManagerPage() {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  const [reason, setReason] = useState('');
  const [reviewId, setReviewId] = useState(null);
  const [attestations, setAttestations] = useState({ organiserAuthorityReviewed: false, privacyAndSafeguardingReviewed: false, budgetAndTermsReviewed: false, partnerSafeguardingReviewed: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const userRoles = useMemo(() => [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])].filter(Boolean), [user]);
  const hasPermissionHint = userRoles.join(', ');
  const canCreateCampaign = hasTitechRole(userRoles, [TITECH_ROLES.PLATFORM_ADMIN, TITECH_ROLES.TENANT_ADMIN, 'FAITH_GIVING_ADMIN']);
  const canReviewCampaign = hasTitechRole(userRoles, [TITECH_ROLES.PLATFORM_ADMIN, 'COMPLIANCE_OFFICER', 'FAITH_GIVING_REVIEWER']);
  const canManageCampaign = hasTitechRole(userRoles, [TITECH_ROLES.PLATFORM_ADMIN, TITECH_ROLES.TENANT_ADMIN, 'FAITH_GIVING_ADMIN', 'FAITH_GIVING_REVIEWER']);

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const response = await get(API);
      setCampaigns(Array.isArray(dataOf(response)) ? dataOf(response) : []);
    } catch (caught) {
      setError(friendlyError(caught)); setCampaigns([]);
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function update(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  function startEdit(campaign) {
    setEditing(campaign);
    setForm({
      title: campaign.title, organisationName: campaign.organisationName, organisationType: campaign.organisationType,
      category: campaign.category, communityScope: campaign.communityScope, publicDescription: campaign.publicDescription,
      beneficiarySummary: campaign.beneficiarySummary, targetAmountMinor: String(campaign.targetAmountMinor), currency: campaign.currency,
      budgetCategory: campaign.budgetLines?.[0]?.category || 'OTHER_APPROVED_COST', budgetDescription: campaign.budgetLines?.[0]?.description || '',
      budgetAmountMinor: String(campaign.budgetLines?.[0]?.amountMinor || ''), startAt: campaign.startAt?.slice(0, 10) || '', endAt: campaign.endAt?.slice(0, 10) || '',
      visibility: campaign.visibility, receivingDestinationReference: campaign.receivingDestinationReference || '',
      organiserVerificationReference: campaign.organiserVerificationReference || '', partnerAuthorizationReference: campaign.partnerAuthorizationReference || '',
      feeDisclosure: campaign.feeDisclosure, refundPolicy: campaign.refundPolicy, surplusPolicy: campaign.surplusPolicy,
    });
  }

  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const payload = {
      title: form.title, organisationName: form.organisationName, organisationType: form.organisationType, category: form.category,
      communityScope: form.communityScope, publicDescription: form.publicDescription, beneficiarySummary: form.beneficiarySummary,
      targetAmountMinor: Number(form.targetAmountMinor), currency: 'UGX',
      budgetLines: [{ category: form.budgetCategory, description: form.budgetDescription, amountMinor: Number(form.budgetAmountMinor) }],
      startAt: new Date(`${form.startAt}T00:00:00.000Z`).toISOString(), endAt: new Date(`${form.endAt}T23:59:59.999Z`).toISOString(),
      visibility: form.visibility, receivingDestinationReference: form.receivingDestinationReference || null,
      organiserVerificationReference: form.organiserVerificationReference || null, partnerAuthorizationReference: form.partnerAuthorizationReference || null,
      feeDisclosure: form.feeDisclosure, refundPolicy: form.refundPolicy, surplusPolicy: form.surplusPolicy,
    };
    try {
      if (editing) await patch(`${API}/${editing.id}`, { ...payload, expectedVersion: editing.version });
      else await post(API, payload);
      setForm(EMPTY_FORM()); setEditing(null); setNotice('Campaign draft saved. It is not public until independently reviewed and published.'); await load();
    } catch (caught) { setError(friendlyError(caught)); }
    finally { setBusy(false); }
  }

  async function campaignAction(campaign, action, payload = {}) {
    setBusy(true); setError(''); setNotice('');
    try {
      await post(`${API}/${campaign.id}/${action}`, payload);
      setNotice(`Campaign ${action} request completed.`); setReviewId(null); await load();
    } catch (caught) { setError(friendlyError(caught)); }
    finally { setBusy(false); }
  }

  async function review(campaign, decision) {
    await campaignAction(campaign, 'review', {
      decision, reason: reason.trim(), ...attestations,
    });
  }

  return (
    <main className="titech-faith-page titech-faith-manager">
      <header className="titech-faith-hero titech-faith-hero--compact" data-brand-gradient="primary">
        <div><p className="titech-faith-eyebrow">TITech Community Capital · Institution workspace</p><h1>Campaign governance</h1><p>Create, submit and govern campaign records. Collection and disbursement remain disabled until their canonical financial integrations are approved.</p></div>
        <Link className="titech-faith-button titech-faith-button--outline" to="/faith-community-giving">Public directory</Link>
      </header>

      <div className="titech-faith-assurance titech-faith-assurance--compact"><div><strong>Signed in role context:</strong> {hasPermissionHint || 'Not available'}. Server-side permissions remain authoritative.</div><span className="titech-faith-status">Payments disabled</span></div>
      {error ? <p className="titech-faith-message titech-faith-message--warning" role="alert">{error}</p> : null}
      {notice ? <p className="titech-faith-message titech-faith-message--success" role="status">{notice}</p> : null}

      {canCreateCampaign ? <section className="titech-faith-form-panel" data-brand-surface="card">
        <div className="titech-faith-section-heading"><div><p className="titech-faith-eyebrow">Campaign setup</p><h2>{editing ? 'Update campaign draft' : 'Create a campaign draft'}</h2></div></div>
        <form className="titech-faith-form" onSubmit={save}>
          <label><span>Campaign title *</span><input required minLength={5} maxLength={120} value={form.title} onChange={(event) => update('title', event.target.value)} /></label>
          <label><span>Organisation display name *</span><input required minLength={2} maxLength={140} value={form.organisationName} onChange={(event) => update('organisationName', event.target.value)} /></label>
          <label><span>Organisation type *</span><select value={form.organisationType} onChange={(event) => update('organisationType', event.target.value)}>{ORGANISATION_TYPES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>
          <label><span>Campaign category *</span><select value={form.category} onChange={(event) => update('category', event.target.value)}>{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>Community scope</span><select value={form.communityScope} onChange={(event) => update('communityScope', event.target.value)}><option value="COMMUNITY_WIDE">Community-wide</option><option value="REFUGEE_AND_HOST_COMMUNITIES">Refugee and host communities</option></select></label>
          <label><span>Visibility</span><select value={form.visibility} onChange={(event) => update('visibility', event.target.value)}><option value="PUBLIC">Public after approval</option><option value="PRIVATE">Private to authorised tenant users</option></select></label>
          <label className="titech-faith-form__wide"><span>Public campaign description *</span><textarea required minLength={30} maxLength={2400} rows={4} value={form.publicDescription} onChange={(event) => update('publicDescription', event.target.value)} /></label>
          <label className="titech-faith-form__wide"><span>Beneficiary summary (no personal identity details) *</span><textarea required minLength={10} maxLength={600} rows={2} value={form.beneficiarySummary} onChange={(event) => update('beneficiarySummary', event.target.value)} /></label>
          <label><span>Target amount (UGX whole shillings) *</span><input required type="number" min="1" step="1" inputMode="numeric" value={form.targetAmountMinor} onChange={(event) => update('targetAmountMinor', event.target.value)} /></label>
          <label><span>Budget category *</span><select value={form.budgetCategory} onChange={(event) => update('budgetCategory', event.target.value)}>{BUDGET_CATEGORIES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>
          <label><span>Budget line description *</span><input required minLength={2} maxLength={180} value={form.budgetDescription} onChange={(event) => update('budgetDescription', event.target.value)} /></label>
          <label><span>Budget line amount (UGX) *</span><input required type="number" min="1" step="1" inputMode="numeric" value={form.budgetAmountMinor} onChange={(event) => update('budgetAmountMinor', event.target.value)} /></label>
          <label><span>Start date *</span><input type="date" required value={form.startAt} onChange={(event) => update('startAt', event.target.value)} /></label>
          <label><span>End date *</span><input type="date" required min={form.startAt} value={form.endAt} onChange={(event) => update('endAt', event.target.value)} /></label>
          <label><span>Receiving destination evidence reference *</span><input required maxLength={128} value={form.receivingDestinationReference} onChange={(event) => update('receivingDestinationReference', event.target.value)} placeholder="Approved institution-controlled destination ref" /></label>
          <label><span>Organiser verification evidence reference *</span><input required maxLength={128} value={form.organiserVerificationReference} onChange={(event) => update('organiserVerificationReference', event.target.value)} placeholder="Reviewed organiser evidence ref" /></label>
          {form.communityScope === 'REFUGEE_AND_HOST_COMMUNITIES' ? <label className="titech-faith-form__wide"><span>Authorised partner reference *</span><input required maxLength={128} value={form.partnerAuthorizationReference} onChange={(event) => update('partnerAuthorizationReference', event.target.value)} /></label> : null}
          <label className="titech-faith-form__wide"><span>Fee disclosure *</span><textarea required minLength={5} maxLength={600} rows={2} value={form.feeDisclosure} onChange={(event) => update('feeDisclosure', event.target.value)} /></label>
          <label className="titech-faith-form__wide"><span>Refund policy *</span><textarea required minLength={10} maxLength={1200} rows={3} value={form.refundPolicy} onChange={(event) => update('refundPolicy', event.target.value)} /></label>
          <label><span>Unused funds policy *</span><select value={form.surplusPolicy} onChange={(event) => update('surplusPolicy', event.target.value)}><option value="REFUND_OR_RETURN">Refund or return</option><option value="DONOR_CONSENT_REQUIRED_REALLOCATION">Donor consent required for reallocation</option><option value="PARTNER_TERMS_REVIEW_REQUIRED">Partner terms review required</option></select></label>
          <div className="titech-faith-form__wide titech-faith-form__actions"><button className="titech-faith-button titech-faith-button--primary" type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save updated draft' : 'Create draft'}</button>{editing ? <button className="titech-faith-button titech-faith-button--secondary" type="button" onClick={() => { setEditing(null); setForm(EMPTY_FORM()); }}>Cancel edit</button> : null}</div>
        </form>
      </section> : <p className="titech-faith-message">Your current role is read-only for campaign creation. The server enforces every action permission.</p>}

      <section className="titech-faith-managed-list">
        <div className="titech-faith-section-heading"><div><p className="titech-faith-eyebrow">Tenant-scoped records</p><h2>Campaigns</h2></div><button className="titech-faith-button titech-faith-button--secondary" type="button" onClick={() => void load()} disabled={busy}>Refresh</button></div>
        {campaigns.length ? campaigns.map((campaign) => (
          <article className="titech-faith-campaign titech-faith-managed-card" data-brand-surface="card" key={campaign.id}>
            <div className="titech-faith-card-top"><div><h3>{campaign.title}</h3><p>{campaign.organisationName} · {formatMoney(campaign.targetAmountMinor)} · v{campaign.version}</p></div><span className="titech-faith-pill">{campaign.status}</span></div>
            <p>{campaign.publicDescription}</p>
            <p className="titech-faith-muted">{campaign.category.replaceAll('_', ' ')} · Ends {new Date(campaign.endAt).toLocaleDateString('en-UG')}</p>
            <p className="titech-faith-muted">Budget reserved by pending/approved requests: {formatMoney((campaign.budgetLines || []).reduce((sum, line) => sum + Number(line.committedAmountMinor || 0), 0))}. This is not a disbursement.</p>
            <div className="titech-faith-actions titech-faith-actions--wrap">
              {canCreateCampaign && ['DRAFT', 'REJECTED', 'APPROVED'].includes(campaign.status) ? <button className="titech-faith-button titech-faith-button--secondary" type="button" onClick={() => startEdit(campaign)}>Edit</button> : null}
              {canCreateCampaign && ['DRAFT'].includes(campaign.status) ? <button className="titech-faith-button titech-faith-button--primary" type="button" disabled={busy} onClick={() => void campaignAction(campaign, 'submit')}>Submit for review</button> : null}
              {canReviewCampaign && campaign.status === 'SUBMITTED' ? <button className="titech-faith-button titech-faith-button--secondary" type="button" onClick={() => { setReviewId(reviewId === campaign.id ? null : campaign.id); setAttestations({ organiserAuthorityReviewed: false, privacyAndSafeguardingReviewed: false, budgetAndTermsReviewed: false, partnerSafeguardingReviewed: false }); }}>Review</button> : null}
              {canReviewCampaign && ['APPROVED', 'PAUSED'].includes(campaign.status) ? <button className="titech-faith-button titech-faith-button--primary" type="button" disabled={busy} onClick={() => void campaignAction(campaign, 'publish')}>{campaign.status === 'PAUSED' ? 'Republish' : 'Publish'}</button> : null}
              {canManageCampaign && campaign.status === 'PUBLISHED' ? <button className="titech-faith-button titech-faith-button--secondary" type="button" disabled={busy || !reason.trim()} onClick={() => void campaignAction(campaign, 'pause', { reason })}>Pause</button> : null}
              {canManageCampaign && campaign.status === 'PAUSED' ? <button className="titech-faith-button titech-faith-button--secondary" type="button" disabled={busy || !reason.trim()} onClick={() => void campaignAction(campaign, 'close', { reason })}>Close</button> : null}
            </div>
            {canReviewCampaign && reviewId === campaign.id ? <div className="titech-faith-review-panel"><h4>Independent review attestations</h4>
              {[
                ['organiserAuthorityReviewed', 'Organizer identity and authority evidence reviewed'],
                ['privacyAndSafeguardingReviewed', 'Privacy and safeguarding reviewed'],
                ['budgetAndTermsReviewed', 'Budget, fee, refund and surplus terms reviewed'],
                ...(campaign.communityScope === 'REFUGEE_AND_HOST_COMMUNITIES' ? [['partnerSafeguardingReviewed', 'Partner authorization and refugee/host safeguarding reviewed']] : []),
              ].map(([key, label]) => <label className="titech-faith-check" key={key}><input type="checkbox" checked={attestations[key]} onChange={(event) => setAttestations((current) => ({ ...current, [key]: event.target.checked }))} /><span>{label}</span></label>)}
              <div className="titech-faith-actions"><button type="button" className="titech-faith-button titech-faith-button--primary" disabled={busy || Object.entries(attestations).some(([key, value]) => (key !== 'partnerSafeguardingReviewed' || campaign.communityScope === 'REFUGEE_AND_HOST_COMMUNITIES') && !value)} onClick={() => void review(campaign, 'APPROVED')}>Approve</button><button type="button" className="titech-faith-button titech-faith-button--danger" disabled={busy || !reason.trim()} onClick={() => void review(campaign, 'REJECTED')}>Reject</button></div>
            </div> : null}
          </article>
        )) : !error ? <div className="titech-faith-empty">{busy ? 'Loading tenant campaigns…' : 'No campaign records exist in this tenant.'}</div> : null}
        <label className="titech-faith-reason"><span>Reason for rejection, pause or closure</span><textarea rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      </section>
      <footer className="titech-faith-footer"><strong>BUILD LESS. PROVE MORE.</strong><span>Approvals and budget reservations do not prove money was received, settled or disbursed.</span></footer>
    </main>
  );
}
