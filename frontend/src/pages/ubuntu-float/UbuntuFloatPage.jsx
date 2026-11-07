import React, { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowLeftRight, BadgeCheck, CircleDollarSign, Globe2, Network, RefreshCw, ShieldAlert } from 'lucide-react';
import { get } from '../../services/api.js';
import './UbuntuFloatPage.css';

const API = '/api/v1/ubuntu-float';

const CAPABILITY_CARDS = [
  {
    key: 'coreAgentManagement',
    title: 'UbuntuFloat Core',
    description: 'Agent network records and controlled float-position observations.',
    icon: Network,
  },
  {
    key: 'advanceApplications',
    title: 'UbuntuFloat Advance',
    description: 'Partner-governed advance application intake; no credit decision or disbursement.',
    icon: CircleDollarSign,
  },
  {
    key: 'swapLiveTransfers',
    title: 'UbuntuFloat Swap',
    description: 'Agent-to-agent exchange remains gated pending legal funds-flow and settlement validation.',
    icon: ArrowLeftRight,
  },
  {
    key: 'gridCrossProviderOrchestration',
    title: 'UbuntuFloat Grid',
    description: 'Provider- and country-neutral foundations without a claim of universal interoperability.',
    icon: Globe2,
  },
];

function readPayload(response) {
  return response?.data?.data ?? null;
}

function CapabilityStatus({ enabled }) {
  return (
    <span className={`ubuntu-float-status ${enabled ? 'is-enabled' : 'is-disabled'}`}>
      <span aria-hidden="true" />
      {enabled ? 'Enabled for configured scope' : 'Disabled / approval gate open'}
    </span>
  );
}

export default function UbuntuFloatPage() {
  const [capabilities, setCapabilities] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshedAt, setRefreshedAt] = useState(null);

  const loadCapabilities = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await get(`${API}/capabilities`);
      setCapabilities(readPayload(response));
      setRefreshedAt(new Date());
    } catch (requestError) {
      const status = requestError?.response?.status;
      setError(status === 401 || status === 403
        ? 'Your signed-in account does not currently have permission to view UbuntuFloat capability status.'
        : 'UbuntuFloat status could not be loaded. No balance or transaction status has been inferred.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadCapabilities(); }, [loadCapabilities]);

  const statuses = capabilities?.capabilities ?? {};
  const liveMoneyMovingEnabled = Boolean(
    statuses.liveDisbursement?.enabled
    || statuses.repaymentCollection?.enabled
    || statuses.swapLiveTransfers?.enabled,
  );

  return (
    <main className="ubuntu-float-page" aria-labelledby="ubuntu-float-title">
      <header className="ubuntu-float-header">
        <div className="ubuntu-float-header-mark" aria-hidden="true"><Network size={28} /></div>
        <div className="ubuntu-float-heading">
          <p className="ubuntu-float-eyebrow">TITech Community Capital · New product capability</p>
          <h1 id="ubuntu-float-title">UbuntuFloat</h1>
          <p className="ubuntu-float-subtitle">{capabilities?.tagline || "Community-informed liquidity infrastructure for Africa's agent networks."}</p>
          <p className="ubuntu-float-identity">{capabilities?.umbrella || 'TITech Community Capital — Powered by the UbuntuFloat Protocol'}</p>
        </div>
        <button className="ubuntu-float-refresh" type="button" onClick={() => void loadCapabilities()} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {loading ? 'Refreshing…' : 'Refresh status'}
        </button>
      </header>

      {error ? <div className="ubuntu-float-message is-error" role="alert">{error}</div> : null}
      {loading && !capabilities ? <div className="ubuntu-float-message" role="status">Loading server-reported capability status…</div> : null}

      {capabilities ? (
        <>
          <section className={`ubuntu-float-readiness ${liveMoneyMovingEnabled ? 'is-enabled' : 'is-gated'}`} aria-labelledby="ubuntu-float-readiness-title">
            <div className="ubuntu-float-readiness-icon" aria-hidden="true">
              {liveMoneyMovingEnabled ? <BadgeCheck size={22} /> : <ShieldAlert size={22} />}
            </div>
            <div>
              <h2 id="ubuntu-float-readiness-title">{liveMoneyMovingEnabled ? 'Live capability state reported by server' : 'Controlled foundation — live money movement is disabled'}</h2>
              <p>Provider balances, credit approvals and settlement are not inferred from interface state. Manual position observations remain unverified and cannot be used as evidence of available funds.</p>
            </div>
            <small>{capabilities.status?.replaceAll('_', ' ') || 'STATUS UNKNOWN'}</small>
          </section>

          <section className="ubuntu-float-capability-grid" aria-label="UbuntuFloat product capability status">
            {CAPABILITY_CARDS.map((card) => {
              const Icon = card.icon;
              const item = statuses[card.key] || {};
              return (
                <article className="ubuntu-float-card" key={card.key}>
                  <div className="ubuntu-float-card-heading">
                    <span className="ubuntu-float-card-icon" aria-hidden="true"><Icon size={21} /></span>
                    <CapabilityStatus enabled={Boolean(item.enabled)} />
                  </div>
                  <h2>{card.title}</h2>
                  <p>{card.description}</p>
                  {item.reason ? <p className="ubuntu-float-reason">{item.reason}</p> : null}
                  {item.verification ? <p className="ubuntu-float-meta">Position status: {item.verification.replaceAll('_', ' ')}</p> : null}
                </article>
              );
            })}
          </section>

          <section className="ubuntu-float-card ubuntu-float-providers" aria-labelledby="ubuntu-float-provider-title">
            <div className="ubuntu-float-section-heading">
              <div>
                <p className="ubuntu-float-eyebrow">Provider boundaries</p>
                <h2 id="ubuntu-float-provider-title">Country and product-specific verification</h2>
              </div>
              <Activity size={22} aria-hidden="true" />
            </div>
            <div className="ubuntu-float-provider-list">
              {[
                ['MTN Uganda agent e-float read', statuses.mtnAgentEFloatRead],
                ['MTN Uganda agent e-float top-up', statuses.mtnAgentEFloatTopUp],
                ['Airtel Uganda agent e-float read', statuses.airtelAgentEFloatRead],
                ['Airtel Uganda agent e-float top-up', statuses.airtelAgentEFloatTopUp],
              ].map(([label, item]) => (
                <div className="ubuntu-float-provider-row" key={label}>
                  <span>{label}</span>
                  <strong>{item?.enabled ? 'Verified capability enabled' : 'Not enabled'}</strong>
                  <small>{item?.reason || 'Requires provider product/account permissions and settlement evidence.'}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="ubuntu-float-guardrails" aria-labelledby="ubuntu-float-guardrails-title">
            <h2 id="ubuntu-float-guardrails-title">Release guardrails</h2>
            <p>UbuntuFloat does not replace TITech authentication, tenancy, role-based permissions, the canonical ledger, payment orchestration or reconciliation. It does not automatically access, pledge or deduct community savings.</p>
            <ul>
              {(capabilities.approvalsRequired || []).map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <footer className="ubuntu-float-footer">
            <span>Organization: {capabilities.organization || 'TITech Capital LTD'}</span>
            <span>Country scope: {capabilities.defaultCountry || 'UG'} · Currency default: {capabilities.defaultCurrency || 'UGX'}</span>
            <span>{refreshedAt ? `Status refreshed ${refreshedAt.toLocaleTimeString()}` : 'Status not yet refreshed'}</span>
          </footer>
        </>
      ) : null}
    </main>
  );
}
