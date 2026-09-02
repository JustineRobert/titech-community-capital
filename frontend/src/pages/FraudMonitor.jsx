// ============================================================================
// TITech Community Capital
// Enterprise Fraud Monitoring
// File: frontend/src/pages/FraudMonitor.jsx
// Production Grade
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import PropTypes from "prop-types";

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import api from "../services/api";
import logger from "../utils/logger";

import Spinner from "../components/ui/Spinner";

import "./FraudMonitor.css";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_POLL_INTERVAL = 30_000;

const MIN_POLL_INTERVAL = 10_000;

const MAX_POLL_INTERVAL = 300_000;

const MAX_ALERTS = 200;

const REQUEST_TIMEOUT = 20_000;

const SEVERITIES = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info",
});

const SEVERITY_ORDER = Object.freeze({
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
});

const DEFAULT_SEVERITY = SEVERITIES.INFO;

// ============================================================================
// Helpers
// ============================================================================

function clampPollInterval(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_POLL_INTERVAL;
  }

  return Math.min(
    Math.max(numericValue, MIN_POLL_INTERVAL),
    MAX_POLL_INTERVAL
  );
}

function normalizeSeverity(value) {
  const severity = String(value || "")
    .trim()
    .toLowerCase();

  if (
    Object.values(SEVERITIES).includes(severity)
  ) {
    return severity;
  }

  return DEFAULT_SEVERITY;
}

function getAlertId(alert, index) {
  return (
    alert?.id ||
    alert?._id ||
    alert?.alertId ||
    `fraud-alert-${alert?.timestamp || "unknown"}-${index}`
  );
}

function normalizeAlert(alert, index) {
  if (!alert || typeof alert !== "object") {
    return {
      id: getAlertId({}, index),
      message: "Unrecognized fraud monitoring event.",
      severity: DEFAULT_SEVERITY,
      timestamp: null,
      metadata: {},
    };
  }

  return {
    ...alert,

    id: getAlertId(alert, index),

    message:
      typeof alert.message === "string" &&
      alert.message.trim()
        ? alert.message.trim()
        : "Fraud monitoring event detected.",

    severity: normalizeSeverity(
      alert.severity
    ),

    timestamp:
      alert.timestamp ||
      alert.createdAt ||
      alert.detectedAt ||
      null,

    metadata:
      alert.metadata &&
      typeof alert.metadata === "object"
        ? alert.metadata
        : {},
  };
}

function extractAlerts(response) {
  const payload =
    response?.data ?? response ?? [];

  if (Array.isArray(payload)) {
    return payload;
  }

  if (
    Array.isArray(payload?.alerts)
  ) {
    return payload.alerts;
  }

  if (
    Array.isArray(payload?.data)
  ) {
    return payload.data;
  }

  if (
    Array.isArray(payload?.results)
  ) {
    return payload.results;
  }

  return [];
}

function getErrorMessage(error) {
  if (
    error?.response?.data?.message
  ) {
    return String(
      error.response.data.message
    );
  }

  if (
    error?.response?.data?.error
  ) {
    return String(
      error.response.data.error
    );
  }

  if (error?.message) {
    return String(error.message);
  }

  return "Unable to load fraud monitoring alerts.";
}

function isAbortError(error) {
  return (
    error?.name === "AbortError" ||
    error?.code === "ERR_CANCELED" ||
    error?.code === "ECONNABORTED"
  );
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "Time unavailable";
  }

  const date = new Date(timestamp);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "Time unavailable";
  }

  try {
    return new Intl.DateTimeFormat(
      "en-UG",
      {
        dateStyle: "medium",
        timeStyle: "short",
      }
    ).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function getRelativeTimestamp(timestamp) {
  if (!timestamp) {
    return "";
  }

  const date = new Date(timestamp);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  const difference =
    Date.now() - date.getTime();

  const absoluteDifference =
    Math.abs(difference);

  const minute =
    60 * 1000;

  const hour =
    60 * minute;

  const day =
    24 * hour;

  if (
    absoluteDifference < minute
  ) {
    return "Just now";
  }

  if (
    absoluteDifference < hour
  ) {
    const minutes = Math.round(
      absoluteDifference / minute
    );

    return `${minutes} min ago`;
  }

  if (
    absoluteDifference < day
  ) {
    const hours = Math.round(
      absoluteDifference / hour
    );

    return `${hours} hr ago`;
  }

  const days = Math.round(
    absoluteDifference / day
  );

  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// ============================================================================
// Severity Configuration
// ============================================================================

const SEVERITY_CONFIG = Object.freeze({
  high: {
    label: "High",
    icon: ShieldAlert,
    className: "severity-high",
  },

  medium: {
    label: "Medium",
    icon: TriangleAlert,
    className: "severity-medium",
  },

  low: {
    label: "Low",
    icon: AlertCircle,
    className: "severity-low",
  },

  info: {
    label: "Information",
    icon: CheckCircle2,
    className: "severity-info",
  },
});

// ============================================================================
// Fraud Alert Card
// ============================================================================

function FraudAlertCard({
  alert,
}) {
  const severity =
    normalizeSeverity(
      alert?.severity
    );

  const config =
    SEVERITY_CONFIG[
      severity
    ] ||
    SEVERITY_CONFIG.info;

  const SeverityIcon =
    config.icon;

  return (
    <article
      className={`fraud-alert-card ${config.className}`}
      aria-label={`${config.label} fraud alert`}
    >
      <div className="fraud-alert-icon">
        <SeverityIcon
          size={20}
          aria-hidden="true"
        />
      </div>

      <div className="fraud-alert-content">
        <div className="fraud-alert-header">
          <span className="fraud-alert-severity">
            {config.label}
          </span>

          <span
            className="fraud-alert-status"
            aria-label={
              alert?.resolved
                ? "Resolved"
                : "Active"
            }
          >
            {alert?.resolved
              ? "Resolved"
              : "Active"}
          </span>
        </div>

        <p className="fraud-alert-message">
          {alert?.message}
        </p>

        <div className="fraud-alert-time">
          <Clock3
            size={14}
            aria-hidden="true"
          />

          <time
            dateTime={
              alert?.timestamp || undefined
            }
            title={formatTimestamp(
              alert?.timestamp
            )}
          >
            {getRelativeTimestamp(
              alert?.timestamp
            ) ||
              formatTimestamp(
                alert?.timestamp
              )}
          </time>
        </div>
      </div>
    </article>
  );
}

FraudAlertCard.propTypes = {
  alert: PropTypes.shape({
    id: PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),
    message: PropTypes.string,
    severity: PropTypes.string,
    timestamp: PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),
    resolved: PropTypes.bool,
  }).isRequired,
};

// ============================================================================
// Loading State
// ============================================================================

function FraudMonitorLoading() {
  return (
    <div
      className="fraud-monitor-loading"
      role="status"
      aria-live="polite"
      aria-label="Loading fraud alerts"
    >
      <Spinner label="Loading fraud alerts…" />

      <span>
        Retrieving security events…
      </span>
    </div>
  );
}

// ============================================================================
// Empty State
// ============================================================================

function FraudMonitorEmpty() {
  return (
    <div
      className="fraud-monitor-empty"
      role="status"
    >
      <div className="fraud-empty-icon">
        <ShieldCheck
          size={30}
          aria-hidden="true"
        />
      </div>

      <h3>
        No active fraud alerts
      </h3>

      <p>
        TITech fraud monitoring has
        not detected any alerts at
        this time.
      </p>
    </div>
  );
}

// ============================================================================
// Error State
// ============================================================================

function FraudMonitorError({
  message,
  onRetry,
  retrying,
}) {
  return (
    <div
      className="fraud-monitor-error"
      role="alert"
    >
      <div className="fraud-error-icon">
        <AlertCircle
          size={22}
          aria-hidden="true"
        />
      </div>

      <div className="fraud-error-content">
        <h3>
          Unable to load fraud alerts
        </h3>

        <p>{message}</p>

        <button
          type="button"
          className="fraud-monitor-retry"
          onClick={onRetry}
          disabled={retrying}
        >
          <RefreshCw
            size={16}
            className={
              retrying
                ? "is-spinning"
                : ""
            }
            aria-hidden="true"
          />

          {retrying
            ? "Retrying…"
            : "Try again"}
        </button>
      </div>
    </div>
  );
}

FraudMonitorError.propTypes = {
  message: PropTypes.string.isRequired,
  onRetry: PropTypes.func.isRequired,
  retrying: PropTypes.bool.isRequired,
};

// ============================================================================
// Main Component
// ============================================================================

export default function FraudMonitor({
  pollIntervalMs = DEFAULT_POLL_INTERVAL,
}) {
  const [alerts, setAlerts] =
    useState([]);

  const [loading, setLoading] =
    useState(false);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState("");

  const [
    lastUpdated,
    setLastUpdated,
  ] = useState(null);

  const [
    consecutiveFailures,
    setConsecutiveFailures,
  ] = useState(0);

  const mountedRef =
    useRef(false);

  const abortRef =
    useRef(null);

  const intervalRef =
    useRef(null);

  const requestInFlightRef =
    useRef(false);

  // ========================================================================
  // Polling Configuration
  // ========================================================================

  const effectivePollInterval =
    useMemo(
      () =>
        clampPollInterval(
          pollIntervalMs
        ),
      [pollIntervalMs]
    );

  // ========================================================================
  // Abort Existing Request
  // ========================================================================

  const abortCurrentRequest =
    useCallback(() => {
      if (!abortRef.current) {
        return;
      }

      try {
        abortRef.current.abort();
      } catch {
        // Abort is intentionally
        // best-effort.
      }

      abortRef.current = null;
    }, []);

  // ========================================================================
  // Fetch Alerts
  // ========================================================================

  const fetchAlerts =
    useCallback(
      async ({
        manual = false,
      } = {}) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        /*
         * Prevent overlapping polling
         * requests. This is especially
         * important when a slow backend
         * request exceeds the polling
         * interval.
         */
        if (
          requestInFlightRef.current
        ) {
          return;
        }

        requestInFlightRef.current =
          true;

        if (manual) {
          setRefreshing(true);
        } else if (
          alerts.length === 0
        ) {
          setLoading(true);
        }

        setError("");

        abortCurrentRequest();

        const controller =
          new AbortController();

        abortRef.current =
          controller;

        try {
          const response =
            await api.get(
              "/api/fraud/alerts",
              {
                signal:
                  controller.signal,

                timeout:
                  REQUEST_TIMEOUT,
              }
            );

          if (
            !mountedRef.current ||
            controller.signal.aborted
          ) {
            return;
          }

          const rawAlerts =
            extractAlerts(
              response
            );

          const normalizedAlerts =
            rawAlerts
              .map(
                normalizeAlert
              )
              .sort(
                (a, b) => {
                  const severityDifference =
                    (SEVERITY_ORDER[
                      a.severity
                    ] ?? 99) -
                    (SEVERITY_ORDER[
                      b.severity
                    ] ?? 99);

                  if (
                    severityDifference !==
                    0
                  ) {
                    return severityDifference;
                  }

                  const aTime =
                    new Date(
                      a.timestamp || 0
                    ).getTime();

                  const bTime =
                    new Date(
                      b.timestamp || 0
                    ).getTime();

                  return bTime - aTime;
                }
              )
              .slice(
                0,
                MAX_ALERTS
              );

          setAlerts(
            normalizedAlerts
          );

          setLastUpdated(
            new Date()
          );

          setConsecutiveFailures(
            0
          );
        } catch (err) {
          if (
            isAbortError(err) ||
            controller.signal.aborted
          ) {
            return;
          }

          const message =
            getErrorMessage(err);

          if (
            !mountedRef.current
          ) {
            return;
          }

          setError(message);

          setConsecutiveFailures(
            (previous) =>
              previous + 1
          );

          try {
            logger?.warn?.(
              "TITech FraudMonitor fetch failed",
              {
                error: message,
                status:
                  err?.response
                    ?.status,
              }
            );
          } catch {
            // Logging must never
            // break monitoring.
          }
        } finally {
          if (
            mountedRef.current
          ) {
            setLoading(false);
            setRefreshing(false);
          }

          requestInFlightRef.current =
            false;

          if (
            abortRef.current ===
            controller
          ) {
            abortRef.current =
              null;
          }
        }
      },
      [
        abortCurrentRequest,
        alerts.length,
      ]
    );

  // ========================================================================
  // Initial Load + Polling
  // ========================================================================

  useEffect(() => {
    mountedRef.current = true;

    fetchAlerts();

    intervalRef.current =
      window.setInterval(
        () => {
          fetchAlerts();
        },
        effectivePollInterval
      );

    return () => {
      mountedRef.current = false;

      if (
        intervalRef.current
      ) {
        window.clearInterval(
          intervalRef.current
        );

        intervalRef.current =
          null;
      }

      abortCurrentRequest();

      requestInFlightRef.current =
        false;
    };
  }, [
    effectivePollInterval,
    fetchAlerts,
    abortCurrentRequest,
  ]);

  // ========================================================================
  // Manual Refresh
  // ========================================================================

  const handleRefresh =
    useCallback(() => {
      if (
        refreshing ||
        loading
      ) {
        return;
      }

      fetchAlerts({
        manual: true,
      });
    }, [
      fetchAlerts,
      refreshing,
      loading,
    ]);

  // ========================================================================
  // Retry
  // ========================================================================

  const handleRetry =
    useCallback(() => {
      fetchAlerts({
        manual: true,
      });
    }, [fetchAlerts]);

  // ========================================================================
  // Derived Metrics
  // ========================================================================

  const alertMetrics =
    useMemo(() => {
      const metrics = {
        total: alerts.length,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      };

      alerts.forEach(
        (alert) => {
          const severity =
            normalizeSeverity(
              alert?.severity
            );

          if (
            Object.prototype.hasOwnProperty.call(
              metrics,
              severity
            )
          ) {
            metrics[severity] += 1;
          }
        }
      );

      return metrics;
    }, [alerts]);

  const hasAlerts =
    alerts.length > 0;

  const lastUpdatedLabel =
    lastUpdated
      ? formatTimestamp(
          lastUpdated
        )
      : "Not updated yet";

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <section
      className="fraud-monitor"
      aria-labelledby="fraud-monitor-heading"
      aria-describedby="fraud-monitor-description"
    >
      {/* ====================================================================
          Header
          ==================================================================== */}

      <header className="fraud-monitor-header">
        <div className="fraud-monitor-heading-group">
          <div className="fraud-monitor-title-icon">
            <ShieldAlert
              size={22}
              aria-hidden="true"
            />
          </div>

          <div>
            <h2 id="fraud-monitor-heading">
              Fraud Monitoring
            </h2>

            <p id="fraud-monitor-description">
              Real-time security alerts
              and transaction risk
              monitoring.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="fraud-monitor-refresh"
          onClick={
            handleRefresh
          }
          disabled={
            loading ||
            refreshing
          }
          aria-label="Refresh fraud alerts"
          title="Refresh fraud alerts"
        >
          <RefreshCw
            size={17}
            className={
              refreshing
                ? "is-spinning"
                : ""
            }
            aria-hidden="true"
          />

          <span>
            {refreshing
              ? "Refreshing…"
              : "Refresh"}
          </span>
        </button>
      </header>

      {/* ====================================================================
          Monitoring Status
          ==================================================================== */}

      <div
        className="fraud-monitor-status"
        role="status"
        aria-live="polite"
      >
        <span className="fraud-live-indicator">
          <span
            className="fraud-live-dot"
            aria-hidden="true"
          />

          Monitoring active
        </span>

        <span className="fraud-last-updated">
          Last updated:{" "}
          {lastUpdatedLabel}
        </span>
      </div>

      {/* ====================================================================
          Metrics
          ==================================================================== */}

      <div
        className="fraud-monitor-metrics"
        aria-label="Fraud alert summary"
      >
        <div className="fraud-metric">
          <span>Total</span>
          <strong>
            {alertMetrics.total}
          </strong>
        </div>

        <div className="fraud-metric fraud-metric-high">
          <span>High</span>
          <strong>
            {alertMetrics.high}
          </strong>
        </div>

        <div className="fraud-metric fraud-metric-medium">
          <span>Medium</span>
          <strong>
            {alertMetrics.medium}
          </strong>
        </div>

        <div className="fraud-metric fraud-metric-low">
          <span>Low</span>
          <strong>
            {alertMetrics.low}
          </strong>
        </div>
      </div>

      {/* ====================================================================
          Error
          ==================================================================== */}

      {error && (
        <FraudMonitorError
          message={error}
          onRetry={
            handleRetry
          }
          retrying={refreshing}
        />
      )}

      {/* ====================================================================
          Initial Loading
          ==================================================================== */}

      {loading &&
        !hasAlerts && (
          <FraudMonitorLoading />
        )}

      {/* ====================================================================
          Alert List
          ==================================================================== */}

      {!loading &&
        !error &&
        !hasAlerts && (
          <FraudMonitorEmpty />
        )}

      {hasAlerts && (
        <div
          className="fraud-alert-list"
          role="list"
          aria-label="Fraud alerts"
          aria-busy={
            loading ||
            refreshing
          }
        >
          {alerts.map(
            (alert, index) => (
              <div
                key={getAlertId(
                  alert,
                  index
                )}
                role="listitem"
              >
                <FraudAlertCard
                  alert={alert}
                />
              </div>
            )
          )}
        </div>
      )}

      {/* ====================================================================
          Footer
          ==================================================================== */}

      <footer className="fraud-monitor-footer">
        <div>
          <span>
            Showing up to{" "}
            {MAX_ALERTS} alerts
          </span>

          {consecutiveFailures >
            0 && (
            <span className="fraud-monitor-warning">
              Monitoring request
              failures:{" "}
              {consecutiveFailures}
            </span>
          )}
        </div>

        <span>
          Auto-refresh:{" "}
          {Math.round(
            effectivePollInterval /
              1000
          )}
          s
        </span>
      </footer>
    </section>
  );
}

FraudMonitor.propTypes = {
  pollIntervalMs:
    PropTypes.number,
};