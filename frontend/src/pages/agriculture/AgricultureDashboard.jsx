import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import './AgricultureDashboard.css';

const RESOURCES = Object.freeze([
  ['producers', 'Producers', 'primary'],
  ['productionCycles', 'Production cycles', 'interactive'],
  ['buyers', 'Buyers', 'bright'],
  ['deliveries', 'Deliveries', 'information'],
  ['settlements', 'Settlements', 'community'],
]);

function Metric({ count, label, tone }) {
  return (
    <article className={`agri-metric agri-metric--${tone}`} data-brand-surface="card">
      <div className="agri-metric__accent" aria-hidden="true" />
      <strong>{count}</strong>
      <span>{label}</span>
    </article>
  );
}

export default function AgricultureDashboard() {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const responses = await Promise.allSettled(
        RESOURCES.map(([resource]) => api.get(`/api/v1/agriculture/${resource}`, { params: { limit: 50 } }))
      );
      const next = {};
      responses.forEach((result, index) => {
        const resource = RESOURCES[index][0];
        if (result.status === 'fulfilled') next[resource] = Array.isArray(result.value?.data?.data) ? result.value.data.data : [];
        else next[resource] = [];
      });
      const failed = responses.some((result) => result.status === 'rejected');
      setData(next);
      if (failed) setError('Some agriculture data could not be loaded. The backend remains authoritative and unavailable data is not replaced with fabricated values.');
    } catch (err) {
      setError(err?.response?.data?.error?.message || err?.message || 'Agriculture data could not be loaded.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const metrics = useMemo(() => RESOURCES.map(([resource, label, tone]) => ({ count: data[resource]?.length ?? 0, label, tone })), [data]);

  return (
    <main className="agriculture-page" data-brand-surface="surface">
      <header className="agriculture-hero" data-brand-gradient="primary">
        <div>
          <span className="agriculture-eyebrow">TITech Community Capital</span>
          <h1>Agricultural economic infrastructure</h1>
          <p>Connect producers, groups, production, buyers, delivery and settlement history through the same tenant-aware financial core.</p>
        </div>
        <div className="agriculture-status" role="status" aria-live="polite">
          <span className={online ? 'agri-dot agri-dot--online' : 'agri-dot'} />
          {online ? 'Online' : 'Offline — local actions must sync before financial finality'}
        </div>
      </header>

      {error && <div className="agriculture-alert" role="alert">{error}</div>}

      <section className="agriculture-metrics" aria-label="Agriculture overview">
        {metrics.map((item) => <Metric key={item.label} {...item} />)}
      </section>

      <section className="agriculture-grid">
        <article className="agriculture-card" data-brand-surface="card">
          <div className="agriculture-card__heading">
            <div><span className="agri-kicker">Verified architecture</span><h2>End-to-end economic chain</h2></div>
            <button type="button" className="agri-refresh" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          </div>
          <div className="agri-flow">
            {['Producer', 'Group', 'Production', 'Buyer', 'Delivery', 'Payment', 'Ledger', 'Allocation', 'Cash-flow'].map((step, index) => (
              <React.Fragment key={step}>
                <div className={`agri-flow__step agri-flow__step--${index % 4}`}><span>{index + 1}</span>{step}</div>
                {index < 8 && <span className="agri-flow__arrow" aria-hidden="true">→</span>}
              </React.Fragment>
            ))}
          </div>
        </article>

        <article className="agriculture-card agriculture-card--accent" data-brand-surface="card">
          <span className="agri-kicker agri-kicker--growth">Financial safety boundary</span>
          <h2>Settlement is never implied</h2>
          <p>Reported production and deliveries remain operational evidence until verification and an explicitly confirmed settlement enter the canonical financial transaction boundary.</p>
          <div className="agri-legend">
            <span><i className="legend-swatch legend-swatch--cyan" />reported</span>
            <span><i className="legend-swatch legend-swatch--lime" />verified</span>
            <span><i className="legend-swatch legend-swatch--gold" />settlement</span>
            <span><i className="legend-swatch legend-swatch--green" />reconciled</span>
          </div>
        </article>
      </section>
    </main>
  );
}
