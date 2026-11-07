import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../services/api.js';
import { useI18n } from '../../i18n/I18nProvider.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import './education-support.css';

const API = '/api/v1/education/campaigns/public';
function responseData(response) { return response?.data?.data ?? null; }
function errorCode(error) { return error?.response?.data?.error?.code || ''; }

const CATEGORY_KEYS = Object.freeze({
  SCHOOL_FEES: 'categorySchoolFees', EXAMINATION_FEES: 'categoryExaminationFees',
  SCHOLASTIC_MATERIALS: 'categoryScholasticMaterials', MEALS_AND_TRANSPORT: 'categoryMealsTransport',
  VOCATIONAL_TRAINING: 'categoryVocational', UNIVERSITY_SCHOLARSHIP: 'categoryUniversity',
  COMMUNITY_EDUCATION_PROJECT: 'categoryCommunityProject',
});

export default function EducationSupportPage() {
  const { t, formatCurrency, formatDate, direction } = useI18n();
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const text = useCallback((key) => t(`education.${key}`), [t]);
  const loadCampaigns = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const response = await get(API);
      setCampaigns(Array.isArray(responseData(response)) ? responseData(response) : []);
    } catch (caught) {
      setCampaigns([]);
      setError(errorCode(caught) === 'CAPABILITY_DISABLED' ? text('featureDisabled') : text('loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [text]);

  useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);
  const money = (amountMinor, currency) => formatCurrency(Number(amountMinor || 0) / (currency === 'USD' ? 100 : 1), currency);

  return (
    <main className="titech-education-page" dir={direction}>
      <header className="titech-education-hero">
        <p className="titech-education-eyebrow">TITech Capital LTD · TITech Community Capital</p>
        <h1>{selected ? selected.title : text('publicPageTitle')}</h1>
        <p>{selected ? text('applicationNote') : text('publicPageDescription')}</p>
        <div className="titech-education-hero__actions">
          {selected ? <button type="button" className="titech-education-button titech-education-button--secondary" onClick={() => setSelected(null)}>{text('backToDirectory')}</button> : null}
          <button type="button" className="titech-education-button titech-education-button--secondary" onClick={() => void loadCampaigns()} disabled={busy}>{text('refresh')}</button>
          {user ? <Link className="titech-education-button titech-education-button--primary" to="/education-support/manage">{text('managerLink')}</Link> : null}
        </div>
      </header>

      <div className="titech-education-note" role="note">
        <strong>{text('privacySafeNotice')}</strong>
        <p>{text('pendingNoPayment')}</p>
      </div>

      {error ? <div className="titech-education-message titech-education-message--error" role="alert">{error}</div> : null}
      {busy && !campaigns.length ? <p className="titech-education-message" role="status" aria-live="polite">{text('saving')}</p> : null}

      {selected ? (
        <article className="titech-education-card titech-education-detail">
          <p className="titech-education-eyebrow">{text('partner')}: {selected.verifiedPartnerName}</p>
          <p>{selected.description}</p>
          <dl className="titech-education-detail__grid">
            <div><dt>{text('category')}</dt><dd>{text(CATEGORY_KEYS[selected.category] || 'categoryCommunityProject')}</dd></div>
            <div><dt>{text('target')}</dt><dd>{money(selected.targetAmountMinor, selected.currency)}</dd></div>
            <div><dt>{text('startAt')}</dt><dd>{formatDate(selected.startAt)}</dd></div>
            <div><dt>{text('endAt')}</dt><dd>{formatDate(selected.endAt)}</dd></div>
            <div><dt>{text('eligibilitySummary')}</dt><dd>{selected.eligibilitySummary}</dd></div>
            <div><dt>{text('selectionMethod')}</dt><dd>{selected.selectionMethod}</dd></div>
            <div><dt>{text('feeDisclosure')}</dt><dd>{selected.feeDisclosure}</dd></div>
            <div><dt>{text('refundPolicy')}</dt><dd>{selected.refundPolicy}</dd></div>
          </dl>
          <h2>{text('budgetHeading')}</h2>
          <ul className="titech-education-budget-list">
            {(selected.budgetLines || []).map((line, index) => <li key={`${line.category}-${index}`}><span>{line.description}</span><strong>{money(line.amountMinor, selected.currency)}</strong></li>)}
          </ul>
          <p className="titech-education-no-payment">{text('noContributionButton')}</p>
        </article>
      ) : campaigns.length ? (
        <section className="titech-education-grid" aria-label={text('publicPageTitle')}>
          {campaigns.map((campaign) => (
            <article className="titech-education-card" key={campaign.id}>
              <div className="titech-education-card__top"><span className="titech-education-pill">{text(CATEGORY_KEYS[campaign.category] || 'categoryCommunityProject')}</span><span className="titech-education-community">{text(campaign.communityScope === 'REFUGEE_AND_HOST_COMMUNITIES' ? 'scopeRefugeeHost' : 'scopeCommunityWide')}</span></div>
              <h2>{campaign.title}</h2>
              <p>{campaign.description}</p>
              <p className="titech-education-partner">{text('partner')}: <strong>{campaign.verifiedPartnerName}</strong></p>
              <div className="titech-education-card__facts">
                <span>{text('target')}</span><strong>{money(campaign.targetAmountMinor, campaign.currency)}</strong>
                <span>{text('endAt')}</span><strong>{formatDate(campaign.endAt)}</strong>
              </div>
              <button type="button" className="titech-education-button titech-education-button--primary" onClick={() => setSelected(campaign)}>{text('viewCampaign')}</button>
            </article>
          ))}
        </section>
      ) : !error && !busy ? <div className="titech-education-empty">{text('publicEmpty')}</div> : null}
    </main>
  );
}
