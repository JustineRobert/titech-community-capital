import React, { useCallback, useEffect, useState } from 'react';
import { get, patch, post } from '../../services/api.js';
import { useI18n } from '../../i18n/I18nProvider.jsx';
import './education-support.css';

const API = '/api/v1/education/campaigns';
function responseData(response) { return response?.data?.data ?? null; }
function errorCode(error) { return error?.response?.data?.error?.code || ''; }
function dateValue(value) { return value ? new Date(value).toISOString().slice(0, 10) : ''; }

const CATEGORIES = [
  ['SCHOOL_FEES', 'categorySchoolFees'], ['EXAMINATION_FEES', 'categoryExaminationFees'], ['SCHOLASTIC_MATERIALS', 'categoryScholasticMaterials'],
  ['MEALS_AND_TRANSPORT', 'categoryMealsTransport'], ['VOCATIONAL_TRAINING', 'categoryVocational'], ['UNIVERSITY_SCHOLARSHIP', 'categoryUniversity'],
  ['COMMUNITY_EDUCATION_PROJECT', 'categoryCommunityProject'],
];
const BUDGET_CATEGORIES = [
  ['TUITION_AND_FEES', 'budgetTuition'], ['EXAMINATIONS', 'budgetExams'], ['BOOKS_AND_STATIONERY', 'budgetBooks'], ['LEARNING_DEVICES', 'budgetDevices'],
  ['UNIFORMS', 'budgetUniforms'], ['MEALS', 'budgetMeals'], ['TRANSPORT', 'budgetTransport'], ['VOCATIONAL_TRAINING', 'budgetVocational'],
  ['SCHOOL_SUPPLIES', 'budgetSupplies'], ['ACCESSIBILITY_SUPPORT', 'budgetAccessibility'], ['OTHER_APPROVED_EDUCATION_COST', 'budgetOther'],
];
const EMPTY_FORM = () => {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 60);
  return {
    title: '', publicDescription: '', category: 'SCHOOL_FEES', communityScope: 'REFUGEE_AND_HOST_COMMUNITIES',
    eligibilitySummary: '', selectionMethod: '', targetAmountMinor: '', currency: 'UGX',
    budgetLines: [{ category: 'TUITION_AND_FEES', description: '', amountMinor: '' }],
    startAt: start.toISOString().slice(0, 10), endAt: end.toISOString().slice(0, 10),
    feeDisclosure: 'No platform contribution or payment is accepted through this release.',
    refundPolicy: 'No funds are collected by this campaign workflow. Partner must publish a reviewed policy before fundraising.',
    surplusPolicy: 'PARTNER_TERMS_REVIEW_REQUIRED',
  };
};

export default function EducationCampaignManagerPage() {
  const { t, formatCurrency, formatDate, direction } = useI18n();
  const text = useCallback((key) => t(`education.${key}`), [t]);
  const [campaigns, setCampaigns] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewingId, setReviewingId] = useState(null);
  const [privacyReviewed, setPrivacyReviewed] = useState(false);
  const [budgetReviewed, setBudgetReviewed] = useState(false);
  const [reason, setReason] = useState('');

  const loadCampaigns = useCallback(async () => {
    try {
      const response = await get(API);
      setCampaigns(Array.isArray(responseData(response)) ? responseData(response) : []);
      setError('');
    } catch (caught) {
      setCampaigns([]);
      setError(errorCode(caught) === 'CAPABILITY_DISABLED' ? text('featureDisabled') : text('loadFailed'));
    }
  }, [text]);

  useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);

  const run = async (operation, successKey) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await operation();
      setNotice(text(successKey));
      await loadCampaigns();
    } catch (caught) {
      const message = caught?.response?.data?.error?.message;
      setError(errorCode(caught) === 'CAPABILITY_DISABLED' ? text('featureDisabled') : (message || text('operationFailed')));
    } finally { setBusy(false); }
  };

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateBudgetLine = (index, key, value) => setForm((current) => ({ ...current, budgetLines: current.budgetLines.map((line, currentIndex) => currentIndex === index ? { ...line, [key]: value } : line) }));
  const addBudgetLine = () => setForm((current) => current.budgetLines.length >= 20 ? current : ({ ...current, budgetLines: [...current.budgetLines, { category: 'OTHER_APPROVED_EDUCATION_COST', description: '', amountMinor: '' }] }));
  const removeBudgetLine = (index) => setForm((current) => current.budgetLines.length <= 1 ? current : ({ ...current, budgetLines: current.budgetLines.filter((_, currentIndex) => currentIndex !== index) }));

  const save = (event) => {
    event.preventDefault();
    const payload = {
      ...form,
      targetAmountMinor: Number(form.targetAmountMinor),
      budgetLines: form.budgetLines.map((line) => ({ ...line, amountMinor: Number(line.amountMinor) })),
      startAt: `${form.startAt}T00:00:00.000Z`,
      endAt: `${form.endAt}T23:59:59.999Z`,
      ...(editing ? { expectedVersion: editing.version } : {}),
    };
    void run(async () => {
      if (editing) await patch(`${API}/${encodeURIComponent(editing.id)}`, payload);
      else await post(API, payload);
      setForm(EMPTY_FORM()); setEditing(null);
    }, 'saved');
  };

  const startEdit = (campaign) => {
    setEditing(campaign);
    setForm({
      title: campaign.title, publicDescription: campaign.publicDescription, category: campaign.category, communityScope: campaign.communityScope,
      eligibilitySummary: campaign.eligibilitySummary, selectionMethod: campaign.selectionMethod, targetAmountMinor: String(campaign.targetAmountMinor), currency: campaign.currency,
      budgetLines: (campaign.budgetLines || []).map((line) => ({ ...line, amountMinor: String(line.amountMinor) })),
      startAt: dateValue(campaign.startAt), endAt: dateValue(campaign.endAt), feeDisclosure: campaign.feeDisclosure, refundPolicy: campaign.refundPolicy, surplusPolicy: campaign.surplusPolicy,
    });
  };

  const simpleAction = (campaign, endpoint, successKey, payload = {}) => run(() => post(`${API}/${encodeURIComponent(campaign.id)}/${endpoint}`, payload), successKey);
  const openReview = (campaign) => { setReviewingId(campaign.id); setPrivacyReviewed(false); setBudgetReviewed(false); setReason(''); };
  const review = (campaign, decision) => {
    if (decision === 'APPROVED' && (!privacyReviewed || !budgetReviewed)) { setError(text('attestationsRequired')); return; }
    if (decision === 'REJECTED' && !reason.trim()) { setError(text('reasonRequired')); return; }
    void run(() => post(`${API}/${encodeURIComponent(campaign.id)}/review`, {
      decision,
      reason: reason.trim() || undefined,
      privacyAndSafeguardingReviewed: decision === 'APPROVED' && privacyReviewed,
      budgetAndTermsReviewed: decision === 'APPROVED' && budgetReviewed,
    }), decision === 'APPROVED' ? 'approved' : 'rejected');
    setReviewingId(null);
  };

  const money = (amount, currency) => formatCurrency(Number(amount || 0) / (currency === 'USD' ? 100 : 1), currency);
  const categoriesLabel = (category) => text(CATEGORIES.find(([value]) => value === category)?.[1] || 'categoryCommunityProject');
  const statusClass = (status) => `titech-education-status titech-education-status--${String(status || '').toLowerCase()}`;

  return (
    <main className="titech-education-page" dir={direction}>
      <header className="titech-education-hero">
        <p className="titech-education-eyebrow">TITech Capital LTD · TITech Community Capital</p>
        <h1>{text('title')}</h1>
        <p>{text('subtitle')}</p>
        <p className="titech-education-safety-copy">{text('applicationNote')}</p>
      </header>

      {error ? <div className="titech-education-message titech-education-message--error" role="alert">{error}</div> : null}
      {notice ? <div className="titech-education-message titech-education-message--success" role="status" aria-live="polite">{notice}</div> : null}

      <section className="titech-education-card titech-education-form-card">
        <h2>{text('createHeading')}</h2>
        <p className="titech-education-note">{text('privacySafeNotice')}<br />{text('minorUnitHelp')}</p>
        <form onSubmit={save} className="titech-education-form">
          <label><span>{text('formTitle')} *</span><input required minLength={5} maxLength={120} value={form.title} onChange={(event) => updateForm('title', event.target.value)} /></label>
          <label className="titech-education-form__wide"><span>{text('formDescription')} *</span><textarea required minLength={30} maxLength={2400} rows={3} value={form.publicDescription} onChange={(event) => updateForm('publicDescription', event.target.value)} /></label>
          <label><span>{text('category')} *</span><select value={form.category} onChange={(event) => updateForm('category', event.target.value)}>{CATEGORIES.map(([value, key]) => <option key={value} value={value}>{text(key)}</option>)}</select></label>
          <label><span>{text('communityScope')}</span><select value={form.communityScope} onChange={(event) => updateForm('communityScope', event.target.value)}><option value="COMMUNITY_WIDE">{text('scopeCommunityWide')}</option><option value="REFUGEE_AND_HOST_COMMUNITIES">{text('scopeRefugeeHost')}</option></select></label>
          <label><span>{text('eligibilitySummary')} *</span><textarea required minLength={10} maxLength={1200} rows={3} value={form.eligibilitySummary} onChange={(event) => updateForm('eligibilitySummary', event.target.value)} /></label>
          <label><span>{text('selectionMethod')} *</span><textarea required minLength={10} maxLength={1200} rows={3} value={form.selectionMethod} onChange={(event) => updateForm('selectionMethod', event.target.value)} /></label>
          <label><span>{text('targetAmount')} *</span><input required type="number" min="1" step="1" inputMode="numeric" value={form.targetAmountMinor} onChange={(event) => updateForm('targetAmountMinor', event.target.value)} /></label>
          <label><span>{text('currency')} *</span><select value={form.currency} onChange={(event) => updateForm('currency', event.target.value)}><option value="UGX">UGX</option><option value="USD">USD</option></select></label>
          <div className="titech-education-form__wide"><h3>{text('budgetHeading')}</h3>
            {form.budgetLines.map((line, index) => <div className="titech-education-budget-editor" key={`budget-${index}`}>
              <label><span>{text('budgetCategory')}</span><select value={line.category} onChange={(event) => updateBudgetLine(index, 'category', event.target.value)}>{BUDGET_CATEGORIES.map(([value, key]) => <option key={value} value={value}>{text(key)}</option>)}</select></label>
              <label><span>{text('budgetDescription')}</span><input required maxLength={180} value={line.description} onChange={(event) => updateBudgetLine(index, 'description', event.target.value)} /></label>
              <label><span>{text('budgetAmount')}</span><input required type="number" min="1" step="1" inputMode="numeric" value={line.amountMinor} onChange={(event) => updateBudgetLine(index, 'amountMinor', event.target.value)} /></label>
              <button className="titech-education-button titech-education-button--secondary" type="button" onClick={() => removeBudgetLine(index)} disabled={form.budgetLines.length <= 1}>{text('removeBudgetLine')}</button>
            </div>)}
            <button className="titech-education-button titech-education-button--secondary" type="button" onClick={addBudgetLine} disabled={form.budgetLines.length >= 20}>{text('addBudgetLine')}</button>
          </div>
          <label><span>{text('startAt')} *</span><input type="date" required value={form.startAt} onChange={(event) => updateForm('startAt', event.target.value)} /></label>
          <label><span>{text('endAt')} *</span><input type="date" required min={form.startAt} value={form.endAt} onChange={(event) => updateForm('endAt', event.target.value)} /></label>
          <label><span>{text('feeDisclosure')} *</span><textarea required minLength={5} maxLength={600} rows={2} value={form.feeDisclosure} onChange={(event) => updateForm('feeDisclosure', event.target.value)} /></label>
          <label><span>{text('refundPolicy')} *</span><textarea required minLength={10} maxLength={1200} rows={3} value={form.refundPolicy} onChange={(event) => updateForm('refundPolicy', event.target.value)} /></label>
          <label><span>{text('surplusPolicy')} *</span><select value={form.surplusPolicy} onChange={(event) => updateForm('surplusPolicy', event.target.value)}><option value="REFUND_OR_RETURN">{text('surplusRefund')}</option><option value="DONOR_CONSENT_REQUIRED_REALLOCATION">{text('surplusConsent')}</option><option value="PARTNER_TERMS_REVIEW_REQUIRED">{text('surplusReview')}</option></select></label>
          <div className="titech-education-form__actions"><button type="submit" className="titech-education-button titech-education-button--primary" disabled={busy}>{busy ? text('saving') : text('saveDraft')}</button>{editing ? <button type="button" className="titech-education-button titech-education-button--secondary" onClick={() => { setEditing(null); setForm(EMPTY_FORM()); }}>{text('cancelEdit')}</button> : null}</div>
        </form>
      </section>

      <section className="titech-education-campaigns">
        <div className="titech-education-section-heading"><h2>{text('campaignList')}</h2><button type="button" className="titech-education-button titech-education-button--secondary" onClick={() => void loadCampaigns()} disabled={busy}>{text('refresh')}</button></div>
        <label className="titech-education-reason-field"><span>{text('reason')}</span><textarea rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        {campaigns.length ? campaigns.map((campaign) => <article className="titech-education-card titech-education-managed-card" key={campaign.id}>
          <div className="titech-education-managed-card__heading"><div><h3>{campaign.title}</h3><p>{categoriesLabel(campaign.category)} · {money(campaign.targetAmountMinor, campaign.currency)} · v{campaign.version}</p></div><span className={statusClass(campaign.status)}>{campaign.status}</span></div>
          <p>{campaign.publicDescription}</p>
          <div className="titech-education-managed-card__dates"><span>{text('startAt')}: {formatDate(campaign.startAt)}</span><span>{text('endAt')}: {formatDate(campaign.endAt)}</span></div>
          <div className="titech-education-actions">
            {['DRAFT', 'REJECTED', 'APPROVED', 'PAUSED'].includes(campaign.status) ? <button type="button" className="titech-education-button titech-education-button--secondary" onClick={() => startEdit(campaign)}>{text('edit')}</button> : null}
            {['DRAFT', 'REJECTED'].includes(campaign.status) ? <button type="button" className="titech-education-button titech-education-button--primary" disabled={busy} onClick={() => void simpleAction(campaign, 'submit', 'submitted')}>{text('submitReview')}</button> : null}
            {campaign.status === 'SUBMITTED' ? <button type="button" className="titech-education-button titech-education-button--secondary" onClick={() => openReview(campaign)}>{text('reviewCampaign')}</button> : null}
            {campaign.status === 'APPROVED' || campaign.status === 'PAUSED' ? <button type="button" className="titech-education-button titech-education-button--primary" disabled={busy} onClick={() => void simpleAction(campaign, 'publish', 'published')}>{text('publish')}</button> : null}
            {campaign.status === 'PUBLISHED' ? <button type="button" className="titech-education-button titech-education-button--secondary" disabled={busy} onClick={() => { if (!reason.trim()) { setError(text('reasonRequired')); return; } void simpleAction(campaign, 'pause', 'paused', { reason: reason.trim() }); }}>{text('pause')}</button> : null}
            {campaign.status === 'PAUSED' ? <button type="button" className="titech-education-button titech-education-button--secondary" disabled={busy} onClick={() => { if (!reason.trim()) { setError(text('reasonRequired')); return; } void simpleAction(campaign, 'close', 'closed', { reason: reason.trim() }); }}>{text('close')}</button> : null}
          </div>
          {reviewingId === campaign.id ? <div className="titech-education-review-panel">
            <h4>{text('reviewCampaign')}</h4>
            <label className="titech-education-check"><input type="checkbox" checked={privacyReviewed} onChange={(event) => setPrivacyReviewed(event.target.checked)} /><span>{text('privacyReview')}</span></label>
            <label className="titech-education-check"><input type="checkbox" checked={budgetReviewed} onChange={(event) => setBudgetReviewed(event.target.checked)} /><span>{text('budgetReview')}</span></label>
            <div className="titech-education-actions"><button type="button" className="titech-education-button titech-education-button--primary" disabled={busy || !privacyReviewed || !budgetReviewed} onClick={() => review(campaign, 'APPROVED')}>{text('approve')}</button><button type="button" className="titech-education-button titech-education-button--danger" disabled={busy || !reason.trim()} onClick={() => review(campaign, 'REJECTED')}>{text('reject')}</button><button type="button" className="titech-education-button titech-education-button--secondary" onClick={() => setReviewingId(null)}>{text('cancelEdit')}</button></div>
          </div> : null}
        </article>) : <div className="titech-education-empty">{text('empty')}</div>}
      </section>
    </main>
  );
}
