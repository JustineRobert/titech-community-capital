import React, { useCallback, useEffect, useState } from "react";
import TITECH_BRAND from "../../branding/brand";
import BrandLogo from "../../components/BrandLogo";
import { getMetrics, getSaccos } from "./OnboardingAPI";
import "./OnboardingDashboard.css";

const STATUS_COLORS = {
  DRAFT: "var(--titech-color-text-subtle)",
  VERIFICATION: "var(--titech-official-bright-blue)",
  KYC_PENDING: "var(--titech-state-warning)",
  KYC_APPROVED: "var(--titech-state-success)",
  SUBSCRIPTION: "var(--titech-official-electric-blue)",
  GO_LIVE_REVIEW: "var(--titech-official-cyan)",
  LIVE: "var(--titech-state-success)",
  REJECTED: "var(--titech-state-danger)",
  SUSPENDED: "var(--titech-state-danger)",
};

const WORKFLOW_STAGES = [
  "DRAFT",
  "VERIFICATION",
  "KYC_PENDING",
  "KYC_APPROVED",
  "SUBSCRIPTION",
  "GO_LIVE_REVIEW",
  "LIVE",
];

const DashboardCard = ({ title, value, color }) => (
  <article
    className="onboarding-dashboard__metric-card"
    style={{ "--onboarding-metric-accent": color }}
  >
    <h3>{title}</h3>
    <p className="onboarding-dashboard__metric-value">{value}</p>
  </article>
);

const OnboardingDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState(null);
  const [saccos, setSaccos] = useState([]);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ search: "", status: "" });

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const [metricsResult, saccoResult] = await Promise.all([
        getMetrics(),
        getSaccos(),
      ]);

      setMetrics(metricsResult?.data || metricsResult);
      setSaccos(saccoResult?.data?.items || saccoResult?.items || []);
    } catch {
      setError("Failed to load onboarding dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const filteredSaccos = saccos.filter((sacco) => {
    const searchMatch =
      !filters.search ||
      sacco.saccoName?.toLowerCase().includes(filters.search.toLowerCase());
    const statusMatch = !filters.status || sacco.status === filters.status;
    return searchMatch && statusMatch;
  });

  if (loading) {
    return (
      <main className="onboarding-dashboard onboarding-dashboard--state" aria-live="polite">
        <div className="onboarding-dashboard__state-card">
          <span className="onboarding-dashboard__loader" aria-hidden="true" />
          <p>Loading onboarding dashboard…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="onboarding-dashboard">
      <header className="onboarding-dashboard__header">
        <div className="onboarding-dashboard__brand">
          <BrandLogo
            variant="transparent"
            size="sm"
            alt="TITech Community Capital"
            loading="eager"
            fetchPriority="high"
          />
          <div className="onboarding-dashboard__heading-copy">
            <p className="onboarding-dashboard__identity">
              {TITECH_BRAND.organizationName} · {TITECH_BRAND.fullName} · {TITECH_BRAND.tagline}
            </p>
            <h1>SACCO Onboarding Dashboard</h1>
            <p className="onboarding-dashboard__description">
              Executive onboarding, compliance and go-live monitoring.
            </p>
          </div>
        </div>
        <button
          className="onboarding-dashboard__refresh"
          type="button"
          onClick={loadDashboard}
        >
          Refresh data
        </button>
      </header>

      {error && (
        <div className="onboarding-dashboard__alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={loadDashboard}>
            Retry
          </button>
        </div>
      )}

      <section className="onboarding-dashboard__metrics" aria-label="Onboarding metrics">
        <DashboardCard
          title="Total SACCOs"
          value={metrics?.totalSaccos || 0}
          color="var(--titech-official-electric-blue)"
        />
        <DashboardCard
          title="Draft"
          value={metrics?.draft || 0}
          color="var(--titech-color-text-subtle)"
        />
        <DashboardCard
          title="KYC approved"
          value={metrics?.kycApproved || 0}
          color="var(--titech-state-success)"
        />
        <DashboardCard
          title="Subscription"
          value={metrics?.subscription || 0}
          color="var(--titech-official-bright-blue)"
        />
        <DashboardCard
          title="Go-live review"
          value={metrics?.goLiveReview || 0}
          color="var(--titech-official-cyan)"
        />
        <DashboardCard
          title="Live"
          value={metrics?.live || 0}
          color="var(--titech-state-success)"
        />
      </section>

      <section className="onboarding-dashboard__panel" aria-labelledby="onboarding-pipeline-title">
        <div className="onboarding-dashboard__section-heading">
          <div>
            <p className="onboarding-dashboard__section-eyebrow">Institution lifecycle</p>
            <h2 id="onboarding-pipeline-title">Workflow pipeline</h2>
          </div>
          <span className="onboarding-dashboard__section-count">
            {saccos.length} institutions
          </span>
        </div>
        <ol className="onboarding-dashboard__pipeline">
          {WORKFLOW_STAGES.map((status, index) => (
            <li
              className="onboarding-dashboard__pipeline-stage"
              key={status}
              style={{ "--onboarding-status-color": STATUS_COLORS[status] }}
            >
              <span className="onboarding-dashboard__pipeline-index">{index + 1}</span>
              <span>{status.replaceAll("_", " ")}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="onboarding-dashboard__panel" aria-labelledby="onboarding-institutions-title">
        <div className="onboarding-dashboard__section-heading">
          <div>
            <p className="onboarding-dashboard__section-eyebrow">Institution directory</p>
            <h2 id="onboarding-institutions-title">SACCO onboarding records</h2>
          </div>
          <span className="onboarding-dashboard__section-count">
            {filteredSaccos.length} of {saccos.length} shown
          </span>
        </div>

        <div className="onboarding-dashboard__filters">
          <label>
            <span>Search institutions</span>
            <input
              type="search"
              placeholder="Search SACCO name"
              value={filters.search}
              onChange={(event) =>
                setFilters((previous) => ({ ...previous, search: event.target.value }))
              }
            />
          </label>
          <label>
            <span>Filter by status</span>
            <select
              value={filters.status}
              onChange={(event) =>
                setFilters((previous) => ({ ...previous, status: event.target.value }))
              }
            >
              <option value="">All statuses</option>
              {Object.keys(STATUS_COLORS).map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="onboarding-dashboard__table-wrap">
          <table className="onboarding-dashboard__table">
            <thead>
              <tr>
                <th scope="col">SACCO</th>
                <th scope="col">Status</th>
                <th scope="col">District</th>
                <th scope="col">Members</th>
                <th scope="col">Subscription</th>
                <th scope="col">MTN</th>
                <th scope="col">Airtel</th>
              </tr>
            </thead>
            <tbody>
              {filteredSaccos.map((sacco) => (
                <tr key={sacco._id}>
                  <th scope="row">{sacco.saccoName}</th>
                  <td>
                    <span
                      className="onboarding-dashboard__status"
                      style={{ "--onboarding-status-color": STATUS_COLORS[sacco.status] || "var(--titech-color-text-subtle)" }}
                    >
                      {sacco.status?.replaceAll("_", " ") || "Unknown"}
                    </span>
                  </td>
                  <td>{sacco.district || "—"}</td>
                  <td>{sacco.currentMembers ?? "—"}</td>
                  <td>{sacco.subscription?.plan || "—"}</td>
                  <td>
                    <span className={sacco.mtnMomoEnabled ? "onboarding-dashboard__provider onboarding-dashboard__provider--enabled" : "onboarding-dashboard__provider"}>
                      {sacco.mtnMomoEnabled ? "Enabled" : "Not enabled"}
                    </span>
                  </td>
                  <td>
                    <span className={sacco.airtelMoneyEnabled ? "onboarding-dashboard__provider onboarding-dashboard__provider--enabled" : "onboarding-dashboard__provider"}>
                      {sacco.airtelMoneyEnabled ? "Enabled" : "Not enabled"}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredSaccos.length === 0 && (
                <tr>
                  <td className="onboarding-dashboard__empty" colSpan={7}>
                    No SACCO onboarding records match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="onboarding-dashboard__summary" aria-labelledby="onboarding-summary-title">
        <div>
          <p className="onboarding-dashboard__section-eyebrow">Management overview</p>
          <h2 id="onboarding-summary-title">Executive summary</h2>
        </div>
        <ul>
          <li>Monitor the SACCO onboarding funnel.</li>
          <li>Track KYC and compliance readiness.</li>
          <li>Review institutions awaiting go-live assessment.</li>
          <li>Track MTN MoMo and Airtel integration readiness.</li>
          <li>Measure onboarding conversion using verified workflow data.</li>
          <li>Support management and board reporting.</li>
        </ul>
      </aside>
    </main>
  );
};

export default OnboardingDashboard;
