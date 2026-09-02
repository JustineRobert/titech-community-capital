import React, {
  useEffect,
  useState
} from "react";

import {
  getMetrics,
  getSaccos
} from "./OnboardingAPI";

const STATUS_COLORS = {
  DRAFT: "#6b7280",
  VERIFICATION: "#3b82f6",
  KYC_PENDING: "#f59e0b",
  KYC_APPROVED: "#10b981",
  SUBSCRIPTION: "#8b5cf6",
  GO_LIVE_REVIEW: "#06b6d4",
  LIVE: "#22c55e",
  REJECTED: "#ef4444",
  SUSPENDED: "#dc2626"
};

const DashboardCard = ({
  title,
  value,
  color
}) => (
  <div
    style={{
      padding: "20px",
      borderRadius: "12px",
      background: "#ffffff",
      border: "1px solid #e5e7eb",
      borderLeft: `5px solid ${color}`,
      minHeight: "120px"
    }}
  >
    <h4
      style={{
        marginBottom: "10px",
        color: "#64748b"
      }}
    >
      {title}
    </h4>

    <h2
      style={{
        margin: 0
      }}
    >
      {value}
    </h2>
  </div>
);

const OnboardingDashboard = () => {
  const [loading, setLoading] =
    useState(true);

  const [metrics, setMetrics] =
    useState(null);

  const [saccos, setSaccos] =
    useState([]);

  const [error, setError] =
    useState("");

  const [filters, setFilters] =
    useState({
      search: "",
      status: ""
    });

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard =
    async () => {
      try {
        setLoading(true);

        const [
          metricsResult,
          saccoResult
        ] = await Promise.all([
          getMetrics(),
          getSaccos()
        ]);

        setMetrics(
          metricsResult?.data ||
            metricsResult
        );

        setSaccos(
          saccoResult?.data?.items ||
            saccoResult?.items ||
            []
        );

      } catch (err) {
        setError(
          "Failed to load onboarding dashboard."
        );
      } finally {
        setLoading(false);
      }
    };

  const filteredSaccos =
    saccos.filter((sacco) => {

      const searchMatch =
        !filters.search ||
        sacco.saccoName
          ?.toLowerCase()
          .includes(
            filters.search.toLowerCase()
          );

      const statusMatch =
        !filters.status ||
        sacco.status ===
          filters.status;

      return (
        searchMatch &&
        statusMatch
      );
    });

  if (loading) {
    return (
      <div
        style={{
          padding: "40px"
        }}
      >
        Loading Dashboard...
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: "1400px",
        margin: "0 auto",
        padding: "30px"
      }}
    >
      {/* ===================================== */}
      {/* HEADER */}
      {/* ===================================== */}

      <div
        style={{
          marginBottom: "30px"
        }}
      >
        <h1>
          TITech Community Capital
        </h1>

        <h2>
          SACCO Onboarding Dashboard
        </h2>

        <p>
          Executive onboarding,
          compliance, and
          go-live monitoring.
        </p>
      </div>

      {/* ===================================== */}
      {/* ERROR */}
      {/* ===================================== */}

      {error && (
        <div
          style={{
            background: "#fee2e2",
            color: "#991b1b",
            padding: "15px",
            borderRadius: "8px",
            marginBottom: "20px"
          }}
        >
          {error}
        </div>
      )}

      {/* ===================================== */}
      {/* KPI CARDS */}
      {/* ===================================== */}

      <div
        style={{
          display: "grid",
          gap: "20px",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(220px,1fr))",
          marginBottom: "40px"
        }}
      >
        <DashboardCard
          title="Total SACCOs"
          value={
            metrics?.totalSaccos || 0
          }
          color="#2563eb"
        />

        <DashboardCard
          title="Draft"
          value={
            metrics?.draft || 0
          }
          color="#6b7280"
        />

        <DashboardCard
          title="KYC Approved"
          value={
            metrics?.kycApproved ||
            0
          }
          color="#10b981"
        />

        <DashboardCard
          title="Subscription"
          value={
            metrics?.subscription ||
            0
          }
          color="#8b5cf6"
        />

        <DashboardCard
          title="Go Live Review"
          value={
            metrics?.goLiveReview ||
            0
          }
          color="#06b6d4"
        />

        <DashboardCard
          title="LIVE"
          value={
            metrics?.live || 0
          }
          color="#22c55e"
        />
      </div>

      {/* ===================================== */}
      {/* WORKFLOW PIPELINE */}
      {/* ===================================== */}

      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: "12px",
          padding: "20px",
          marginBottom: "30px"
        }}
      >
        <h2>
          Workflow Pipeline
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(7,1fr)",
            gap: "10px",
            marginTop: "15px"
          }}
        >
          {[
            "DRAFT",
            "VERIFICATION",
            "KYC_PENDING",
            "KYC_APPROVED",
            "SUBSCRIPTION",
            "GO_LIVE_REVIEW",
            "LIVE"
          ].map((status) => (
            <div
              key={status}
              style={{
                background:
                  STATUS_COLORS[
                    status
                  ],
                color: "#ffffff",
                padding: "15px",
                textAlign:
                  "center",
                borderRadius:
                  "10px"
              }}
            >
              {status}
            </div>
          ))}
        </div>
      </div>

      {/* ===================================== */}
      {/* FILTERS */}
      {/* ===================================== */}

      <div
        style={{
          display: "flex",
          gap: "15px",
          marginBottom: "20px"
        }}
      >
        <input
          placeholder="Search SACCO..."
          value={
            filters.search
          }
          onChange={(e) =>
            setFilters(
              (prev) => ({
                ...prev,
                search:
                  e.target.value
              })
            )
          }
        />

        <select
          value={
            filters.status
          }
          onChange={(e) =>
            setFilters(
              (prev) => ({
                ...prev,
                status:
                  e.target.value
              })
            )
          }
        >
          <option value="">
            All Statuses
          </option>

          {Object.keys(
            STATUS_COLORS
          ).map((status) => (
            <option
              key={status}
              value={status}
            >
              {status}
            </option>
          ))}
        </select>
      </div>

      {/* ===================================== */}
      {/* SACCO TABLE */}
      {/* ===================================== */}

      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: "12px",
          overflow: "hidden"
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse:
              "collapse"
          }}
        >
          <thead>
            <tr
              style={{
                background:
                  "#f8fafc"
              }}
            >
              <th>SACCO</th>
              <th>Status</th>
              <th>District</th>
              <th>Members</th>
              <th>Subscription</th>
              <th>MTN</th>
              <th>Airtel</th>
            </tr>
          </thead>

          <tbody>
            {filteredSaccos.map(
              (sacco) => (
                <tr
                  key={
                    sacco._id
                  }
                >
                  <td>
                    {
                      sacco.saccoName
                    }
                  </td>

                  <td>
                    <span
                      style={{
                        background:
                          STATUS_COLORS[
                            sacco
                              .status
                          ],
                        color:
                          "#fff",
                        padding:
                          "4px 10px",
                        borderRadius:
                          "20px"
                      }}
                    >
                      {
                        sacco.status
                      }
                    </span>
                  </td>

                  <td>
                    {
                      sacco.district
                    }
                  </td>

                  <td>
                    {
                      sacco.currentMembers
                    }
                  </td>

                  <td>
                    {
                      sacco
                        .subscription
                        ?.plan
                    }
                  </td>

                  <td>
                    {sacco.mtnMomoEnabled
                      ? "✅"
                      : "❌"}
                  </td>

                  <td>
                    {sacco.airtelMoneyEnabled
                      ? "✅"
                      : "❌"}
                  </td>
                </tr>
              )
            )}

            {filteredSaccos.length ===
              0 && (
              <tr>
                <td
                  colSpan="7"
                  style={{
                    textAlign:
                      "center",
                    padding:
                      "25px"
                  }}
                >
                  No SACCOs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ===================================== */}
      {/* EXECUTIVE SUMMARY */}
      {/* ===================================== */}

      <div
        style={{
          background:
            "#eff6ff",
          borderRadius:
            "12px",
          padding: "20px",
          marginTop: "30px"
        }}
      >
        <h3>
          Executive Summary
        </h3>

        <ul>
          <li>
            Monitor SACCO
            onboarding funnel
          </li>

          <li>
            Track KYC &
            compliance readiness
          </li>

          <li>
            Review
            GO_LIVE_REVIEW queue
          </li>

          <li>
            Track MTN MoMo &
            Airtel readiness
          </li>

          <li>
            Measure onboarding
            conversion rate
          </li>

          <li>
            Support investor and
            board reporting
          </li>
        </ul>
      </div>
    </div>
  );
};

export default OnboardingDashboard;