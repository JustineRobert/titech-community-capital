import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../../services/api.js';
import { v4 as uuidv4 } from 'uuid';
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
  EDUCATION_RESOURCES_AND_MATERIALS: 'Scholastic resources and materials',
  SCHOOL_COMPUTERS_AND_DIGITAL_ACCESS: 'Computers and digital access for schools',
  SCHOOL_FURNITURE_AND_FACILITIES: 'School furniture and facilities',
  SCHOOL_CONSTRUCTION_AND_REHABILITATION: 'School construction and rehabilitation',
  SCHOLARSHIPS_AND_LEARNING_SUPPORT: 'Scholarships and learning support',
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
  const [pledgeType, setPledgeType] = useState('IN_KIND');
  const [pledgeAmount, setPledgeAmount] = useState('');
  const [pledgeCategory, setPledgeCategory] = useState('SCHOLASTIC_MATERIALS');
  const [pledgeDescription, setPledgeDescription] = useState('');
  const [pledgeQuantity, setPledgeQuantity] = useState('1');
  const [pledgeUnit, setPledgeUnit] = useState('PIECE');
  const [pledgeCondition, setPledgeCondition] = useState('NEW');
  const [pledgeBusy, setPledgeBusy] = useState(false);
  const [pledgeNotice, setPledgeNotice] = useState('');
  const [pledgeError, setPledgeError] = useState('');
  const pledgeIdempotencyRef = useRef(null);

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

  async function submitPledge(event) {
    event.preventDefault();
    if (!selected || !user || pledgeBusy) return;
    setPledgeBusy(true); setPledgeNotice(''); setPledgeError('');
    let payload;
    if (pledgeType === 'CASH') {
      const amount = Number(pledgeAmount);
      if (!Number.isSafeInteger(amount) || amount < 1) { setPledgeError('Enter a whole-number UGX amount greater than zero.'); setPledgeBusy(false); return; }
      payload = { pledgeType: 'CASH', amountMinor: amount, currency: selected.currency, anonymous: false };
    } else {
      const quantity = Number(pledgeQuantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || !pledgeDescription.trim()) { setPledgeError('Enter an item description and a positive whole-number quantity.'); setPledgeBusy(false); return; }
      payload = { pledgeType: 'IN_KIND', items: [{ category: pledgeCategory, description: pledgeDescription.trim(), quantity, unit: pledgeUnit, condition: pledgeCondition }], anonymous: false };
    }
    try {
      const payloadFingerprint = JSON.stringify({ campaignId: selected.id, payload });
      if (pledgeIdempotencyRef.current?.fingerprint !== payloadFingerprint) pledgeIdempotencyRef.current = { fingerprint: payloadFingerprint, key: uuidv4() };
      const response = await post(`/api/v1/faith-giving/public/${encodeURIComponent(selected.id)}/pledges`, payload, { headers: { 'Idempotency-Key': pledgeIdempotencyRef.current.key } });
      const pledge = response?.data?.data;
      pledgeIdempotencyRef.current = null;
      setPledgeNotice(pledge?.pledgeType === 'IN_KIND'
        ? 'Your in-kind offer has been recorded as a pledge. The institution must separately review, accept, inspect and acknowledge any delivered items.'
        : 'Your cash pledge has been recorded as a commitment only. No money has been collected and no payment has been initiated.');
      setPledgeAmount(''); setPledgeDescription('');
    } catch (caught) {
      const code = caught?.response?.data?.error?.code;
      setPledgeError(code === 'FAITH_GIVING_CAMPAIGN_NOT_FOUND'
        ? 'Pledge registration is limited to authenticated users of the campaign institution. No donation or payment was processed.'
        : caught?.response?.data?.error?.message || 'The pledge could not be recorded. No money or items have been transferred.');
    } finally { setPledgeBusy(false); }
  }

  return (
    <main className="titech-faith-page" data-brand-surface="surface">
      <header className="titech-faith-hero" data-brand-gradient="primary">
        <div className="titech-faith-hero__identity">
          <BrandLogo variant="transparent" size="lg" alt="TITech Community Capital official logo" />
          <p className="titech-faith-eyebrow">TITECH CAPITAL - SMC LTD · TITech Community Capital</p>
        </div>
        <div className="titech-faith-hero__copy">
          <span className="titech-faith-kicker">BUILD LESS. PROVE MORE.</span>
          <h1>Donations &amp; Community Giving</h1>
          <p>Support approved community priorities through transparent campaigns for scholastic materials, computers, textbooks, classroom furniture, construction and essential community needs.</p>
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
          <h2 id="faith-assurance-heading">Every donation starts with an approved campaign and accountable institution.</h2>
          <p>This page records non-binding cash commitments and in-kind offers for published campaigns. It does not collect or hold money, accept physical goods, issue receipts, disburse funds or confirm settlement. Those actions remain disabled until payment, custody, fulfilment and accounting controls are separately integrated and approved.</p>
        </div>
        <span className="titech-faith-status">Collection: not enabled</span>
      </section>

      <section className="titech-faith-capabilities" aria-label="Supported campaign categories">
        {[
          ['Church giving', 'Tithes, offerings, thanksgiving, missions and approved church projects'],
          ['Family support', 'Burial, bereavement, wedding and traditional introduction committees'],
          ['Education and school support', 'Textbooks, exercise books, stationery, computers, tablets and digital learning access'],
          ['Furniture and facilities', 'Desks, chairs, classroom furniture, libraries, sanitation and accessibility improvements'],
          ['Construction and community impact', 'Classroom construction, rehabilitation, roofing, water projects, medical and humanitarian support'],
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
          <div><p className="titech-faith-eyebrow">Published donation directory</p><h2>Approved campaigns from authorised organisations</h2></div>
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
            <section className="titech-faith-pledge-panel" aria-labelledby="donation-pledge-heading">
              <h3 id="donation-pledge-heading">Offer support to this campaign</h3>
              <p>Record a non-binding cash pledge (such as construction funds) or an in-kind offer (such as computers, books, stationery, desks or chairs). A pledge is not payment, delivery, accepted donation or tax receipt.</p>
              {pledgeNotice ? <p className="titech-faith-message titech-faith-message--success" role="status">{pledgeNotice}</p> : null}
              {pledgeError ? <p className="titech-faith-message titech-faith-message--warning" role="alert">{pledgeError}</p> : null}
              {user ? (
                <form className="titech-faith-form" onSubmit={submitPledge}>
                  <label><span>Support type *</span><select value={pledgeType} onChange={(event) => setPledgeType(event.target.value)}><option value="IN_KIND">Offer items or materials</option><option value="CASH">Pledge cash (UGX)</option></select></label>
                  {pledgeType === 'CASH' ? (
                    <label><span>Cash pledge · whole UGX *</span><input type="number" min="1" step="1" inputMode="numeric" required value={pledgeAmount} onChange={(event) => setPledgeAmount(event.target.value)} placeholder="e.g. 150000" /></label>
                  ) : (
                    <>
                      <label><span>Item category *</span><select value={pledgeCategory} onChange={(event) => setPledgeCategory(event.target.value)}><option value="SCHOLASTIC_MATERIALS">Scholastic materials</option><option value="LIBRARY_AND_TEXTBOOKS">Library and textbooks</option><option value="COMPUTERS_AND_DIGITAL_EQUIPMENT">Computers and digital equipment</option><option value="SCHOOL_FURNITURE">School furniture</option><option value="CLASSROOM_EQUIPMENT">Classroom equipment</option><option value="TEACHING_AND_LEARNING_MATERIALS">Teaching and learning materials</option><option value="ACCESSIBILITY_EQUIPMENT">Accessibility equipment</option><option value="CONSTRUCTION_MATERIALS">Construction materials</option><option value="WATER_AND_SANITATION">Water and sanitation</option><option value="OTHER_APPROVED_COST">Other approved items</option></select></label>
                      <label><span>Item description *</span><input required minLength="2" maxLength="140" value={pledgeDescription} onChange={(event) => setPledgeDescription(event.target.value)} placeholder="e.g. refurbished laptop computers" /></label>
                      <label><span>Quantity *</span><input type="number" min="1" max="100000" step="1" required value={pledgeQuantity} onChange={(event) => setPledgeQuantity(event.target.value)} /></label>
                      <label><span>Unit *</span><select value={pledgeUnit} onChange={(event) => setPledgeUnit(event.target.value)}><option value="PIECE">Piece</option><option value="SET">Set</option><option value="BOX">Box</option><option value="PACK">Pack</option><option value="BAG">Bag</option><option value="KG">Kilogram</option><option value="LITRE">Litre</option><option value="UNIT">Unit</option></select></label>
                      <label><span>Item condition *</span><select value={pledgeCondition} onChange={(event) => setPledgeCondition(event.target.value)}><option value="NEW">New</option><option value="GOOD_USED">Good used</option><option value="REFURBISHED">Refurbished</option><option value="NOT_APPLICABLE">Not applicable</option></select></label>
                    </>
                  )}
                  <div className="titech-faith-form__wide"><p className="titech-faith-muted">Pledge registration is limited to authenticated users within the campaign institution's tenant. Your identity is retained for institutional audit; the public campaign page does not expose it. External donor checkout is not enabled.</p></div>
                  <div className="titech-faith-form__wide titech-faith-form__actions"><button type="submit" className="titech-faith-button titech-faith-button--primary" disabled={pledgeBusy}>{pledgeBusy ? 'Recording pledge…' : 'Record pledge'}</button></div>
                </form>
              ) : <p className="titech-faith-message"><Link to="/login">Sign in</Link> using an account in the campaign institution to register a pledge. External/public donor checkout is not enabled.</p>}
            </section>
            <p className="titech-faith-no-payment">Collection: not enabled. No money is received, no goods are taken into custody, and no receipt or settlement is issued by this page.</p>
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

      <footer className="titech-faith-footer"><strong>BUILD LESS. PROVE MORE.</strong><span>Donations &amp; Community Giving is part of TITech Community Capital · TITECH CAPITAL - SMC LTD.</span></footer>
    </main>
  );
}
