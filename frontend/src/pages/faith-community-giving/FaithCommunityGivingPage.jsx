import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { hasTitechRole, TITECH_ROLES } from '../../security/rbacPolicy.js';
import BrandLogo from '../../components/BrandLogo.jsx';
import './faith-community-giving.css';

const PUBLIC_API = '/api/v1/faith-giving/public';

const CATEGORY_LABELS = Object.freeze({
  CHURCH_TITHES_OFFERINGS: 'Church tithes and offerings',
  THANKSGIVING_DONATIONS: 'Thanksgiving and donations',
  CHURCH_PROJECTS: 'Church projects and development',
  MISSIONS_AND_MINISTRY: 'Missions and ministry',
  BURIAL_BEREAVEMENT_SUPPORT: 'Burial and bereavement support',
  WEDDING_AND_TRADITIONAL_INTRODUCTION: 'Wedding and traditional introduction',
  COMMUNITY_FUNCTIONS: 'Community functions',
  EMERGENCY_MEDICAL_ASSISTANCE: 'Emergency and medical assistance',
  EDUCATION_AND_SCHOOL_FEES: 'Education and school fees',
  CHARITY_AND_HUMANITARIAN: 'Charity and humanitarian support',
  COMMUNITY_DEVELOPMENT: 'Community development',
  COMMUNITY_WELFARE: 'Community welfare',
  OTHER_APPROVED_PURPOSE: 'Other approved purpose',
});

function campaignData(response) { return response?.data?.data ?? null; }
function errorMessage(error) {
  const code = error?.response?.data?.error?.code;
  if (code === 'CAPABILITY_DISABLED') return 'The campaign directory is currently disabled pending partner, financial and release approvals.';
  return 'Campaign information could not be loaded. No contribution or payment has been initiated.';
}
function money(amountMinor, currency = 'UGX') {
  if (!Number.isSafeInteger(Number(amountMinor))) return 'Not available';
  return new Intl.NumberFormat('en-UG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amountMinor));
}
function date(value) {
  if (!value) return 'Not scheduled';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not scheduled' : new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium' }).format(parsed);
}

export default function FaithCommunityGivingPage() {
  const { user } = useAuth();
  const roles = [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])].filter(Boolean);
  const canManage = hasTitechRole(roles, [TITECH_ROLES.PLATFORM_ADMIN, TITECH_ROLES.TENANT_ADMIN, 'FAITH_GIVING_ADMIN', 'FAITH_GIVING_REVIEWER', 'COMPLIANCE_OFFICER', 'AUDITOR']);
  const [campaigns, setCampaigns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadCampaigns = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const response = await get(PUBLIC_API);
      const data = campaignData(response);
      setCampaigns(Array.isArray(data) ? data : []);
    } catch (caught) {
      setCampaigns([]);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);

  return (
    <main className="titech-faith-page" data-brand-surface="surface">
      <header className="titech-faith-hero" data-brand-gradient="primary">
        <div className="titech-faith-hero__identity">
          <BrandLogo variant="transparent" size="lg" alt="TITech Community Capital official logo" />
          <p className="titech-faith-eyebrow">TITech Capital SMC LTD · TITech Community Capital</p>
        </div>
        <div className="titech-faith-hero__copy">
          <span className="titech-faith-kicker">One Platform. Every Contribution. Full Accountability.</span>
          <h1>Faith &amp; Community Giving</h1>
          <p>Governed campaign information, transparent budgets, accountable committees and auditable financial workflows for churches, families and community organisations.</p>
          <div className="titech-faith-actions">
            <a className="titech-faith-button titech-faith-button--light" href="#campaign-directory">Explore campaigns</a>
            {canManage ? <Link className="titech-faith-button titech-faith-button--outline" to="/faith-community-giving/manage">Manage campaigns</Link> : <Link className="titech-faith-button titech-faith-button--outline" to="/login">Institution sign in</Link>}
          </div>
        </div>
        <div className="titech-faith-palette" aria-label="Official TITech colour roles">
          <span title="Deep blue" className="titech-faith-swatch titech-faith-swatch--deep" />
          <span title="Electric blue" className="titech-faith-swatch titech-faith-swatch--electric" />
          <span title="Bright blue" className="titech-faith-swatch titech-faith-swatch--bright" />
          <span title="Cyan" className="titech-faith-swatch titech-faith-swatch--cyan" />
          <span title="Africa green" className="titech-faith-swatch titech-faith-swatch--green" />
          <span title="Lime green" className="titech-faith-swatch titech-faith-swatch--lime" />
          <span title="Gold yellow" className="titech-faith-swatch titech-faith-swatch--gold" />
          <span title="Navy ink" className="titech-faith-swatch titech-faith-swatch--navy" />
          <span title="White" className="titech-faith-swatch titech-faith-swatch--white" />
        </div>
      </header>

      <section className="titech-faith-assurance" aria-labelledby="faith-assurance-heading">
        <div>
          <p className="titech-faith-eyebrow">Financial correctness before convenience</p>
          <h2 id="faith-assurance-heading">A campaign page is not a payment confirmation.</h2>
          <p>Campaign publication and pledge records do not collect, hold, settle or account for money. Payment initiation, provider verification, ledger posting, receipts and reconciliation remain disabled in this release until the canonical payment and financial pipeline is connected and independently verified.</p>
        </div>
        <span className="titech-faith-status">Collection: not enabled</span>
      </section>

      <section className="titech-faith-capabilities" aria-label="Supported campaign categories">
        {[
          ['Church giving', 'Tithes, offerings, thanksgiving, missions and approved church projects'],
          ['Family support', 'Burial, bereavement, wedding and traditional introduction committees'],
          ['Community impact', 'Medical, education, humanitarian and community development campaigns'],
        ].map(([title, description]) => (
          <article className="titech-faith-capability" key={title} data-brand-surface="card">
            <span className="titech-faith-capability__mark" aria-hidden="true" />
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <section id="campaign-directory" className="titech-faith-directory">
        <div className="titech-faith-section-heading">
          <div><p className="titech-faith-eyebrow">Published campaign directory</p><h2>Campaigns shared by authorised organisations</h2></div>
          <button type="button" className="titech-faith-button titech-faith-button--secondary" onClick={() => void loadCampaigns()} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        {error ? <p className="titech-faith-message titech-faith-message--warning" role="alert">{error}</p> : null}
        {busy && !campaigns.length ? <p className="titech-faith-message" role="status">Loading published campaign information…</p> : null}
        {selected ? (
          <article className="titech-faith-campaign titech-faith-detail">
            <button className="titech-faith-text-button" type="button" onClick={() => setSelected(null)}>← Back to campaigns</button>
            <span className="titech-faith-pill">{CATEGORY_LABELS[selected.category] || selected.category}</span>
            <h2>{selected.title}</h2>
            <p className="titech-faith-detail__organisation">{selected.organisationName} · {selected.organisationType?.replaceAll('_', ' ')}</p>
            <p>{selected.description}</p>
            <p><strong>Beneficiary summary:</strong> {selected.beneficiarySummary}</p>
            <dl className="titech-faith-facts">
              <div><dt>Target</dt><dd>{money(selected.targetAmountMinor, selected.currency)}</dd></div>
              <div><dt>Closes</dt><dd>{date(selected.endAt)}</dd></div>
              <div><dt>Community scope</dt><dd>{selected.communityScope === 'REFUGEE_AND_HOST_COMMUNITIES' ? 'Refugee and host communities' : 'Community-wide'}</dd></div>
              <div><dt>Collection status</dt><dd>{selected.collectionStatus === 'NOT_ENABLED' ? 'Not enabled' : 'Not confirmed'}</dd></div>
            </dl>
            <h3>Published budget</h3>
            <ul className="titech-faith-budget-list">{(selected.budgetLines || []).map((line, index) => <li key={`${line.category}-${index}`}><span>{line.description}</span><strong>{money(line.amountMinor, selected.currency)}</strong></li>)}</ul>
            <p><strong>Fee disclosure:</strong> {selected.feeDisclosure}</p>
            <p><strong>Refund policy:</strong> {selected.refundPolicy}</p>
            <p className="titech-faith-message">{selected.verificationNotice}</p>
            <p className="titech-faith-no-payment">No contribution or payment can be initiated from this campaign page in the current release.</p>
          </article>
        ) : campaigns.length ? (
          <div className="titech-faith-grid">
            {campaigns.map((campaign) => (
              <article className="titech-faith-campaign" key={campaign.id} data-brand-surface="card">
                <div className="titech-faith-card-top"><span className="titech-faith-pill">{CATEGORY_LABELS[campaign.category] || campaign.category}</span><span className="titech-faith-scope">{campaign.communityScope === 'REFUGEE_AND_HOST_COMMUNITIES' ? 'Refugee + host communities' : 'Community-wide'}</span></div>
                <h3>{campaign.title}</h3>
                <p className="titech-faith-detail__organisation">{campaign.organisationName}</p>
                <p>{campaign.description}</p>
                <div className="titech-faith-card-facts"><span>Target</span><strong>{money(campaign.targetAmountMinor, campaign.currency)}</strong><span>End date</span><strong>{date(campaign.endAt)}</strong></div>
                <button type="button" className="titech-faith-button titech-faith-button--primary" onClick={() => setSelected(campaign)}>View campaign information</button>
              </article>
            ))}
          </div>
        ) : !error && !busy ? <div className="titech-faith-empty"><h3>No public campaigns are available</h3><p>Approved organisations can prepare campaigns after the capability is enabled and their organiser, safeguarding and receiving-destination evidence has been reviewed.</p></div> : null}
      </section>

      <footer className="titech-faith-footer"><strong>BUILD LESS. PROVE MORE.</strong><span>Faith &amp; Community Giving is a product division of TITech Community Capital.</span></footer>
    </main>
  );
}
