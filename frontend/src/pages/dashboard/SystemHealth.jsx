// ============================================================================
// TITech Community Capital
// System Health Dashboard
// File: frontend/src/pages/dashboard/SystemHealth.jsx
// Enterprise Production Grade
//
// Platform Observability
// Infrastructure Monitoring
// Dependency Health
// Service Availability
// Automatic Refresh
// Abort-Safe Requests
// Resilient API Handling
// Accessibility Ready
// Multi-Tenant Aware
// Defensive Data Normalization
// ============================================================================

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  HardDrive,
  Network,
  RefreshCw,
  Server,
  Shield,
  WifiOff,
} from "lucide-react";

import api from "../services/api";

import {
  Card,
  Button,
  LoadingScreen,
  StatusBadge,
  PageHeader,
} from "../ui";

import "./SystemHealth.css";

// ============================================================================
// Constants
// ============================================================================

const HEALTH_ENDPOINT = "/api/system/health";

const AUTO_REFRESH_INTERVAL = 30_000;

const MAX_PERCENTAGE = 100;

const DEFAULT_HEALTH = Object.freeze({
  status: "unknown",
  uptime: 0,

  memory: {
    used: 0,
    total: 0,
    percentage: 0,
  },

  cpu: {
    usage: 0,
  },

  database: {
    status: "unknown",
    latency: 0,
  },

  redis: {
    status: "unknown",
    latency: 0,
  },

  services: [],

  metrics: {
    requestsPerMinute: 0,
    activeUsers: 0,
    errorRate: 0,
  },
});

// ============================================================================
// Helpers
// ============================================================================

function isFiniteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

function toSafeNumber(
  value,
  fallback = 0
) {
  if (isFiniteNumber(value)) {
    return value;
  }

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  const numericValue = Number(value);

  return Number.isFinite(numericValue)
    ? numericValue
    : fallback;
}

function clampPercentage(value) {
  return Math.min(
    Math.max(
      toSafeNumber(value),
      0
    ),
    MAX_PERCENTAGE
  );
}

function normalizeStatus(
  status,
  fallback = "unknown"
) {
  if (
    typeof status !==
    "string"
  ) {
    return fallback;
  }

  const normalized = status
    .trim()
    .toLowerCase();

  return normalized || fallback;
}

function formatBytes(bytes) {
  const value = Math.max(
    toSafeNumber(bytes),
    0
  );

  if (value <= 0) {
    return "0 MB";
  }

  const units = [
    "Bytes",
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  const index = Math.min(
    Math.floor(
      Math.log(value) /
        Math.log(1024)
    ),
    units.length - 1
  );

  return `${(
    value /
    Math.pow(1024, index)
  ).toFixed(
    index === 0 ? 0 : 2
  )} ${units[index]}`;
}

function formatUptime(seconds) {
  const value = Math.max(
    toSafeNumber(seconds),
    0
  );

  if (value < 60) {
    return `${Math.floor(value)}s`;
  }

  const days = Math.floor(
    value / 86400
  );

  const hours = Math.floor(
    (value % 86400) / 3600
  );

  const minutes = Math.floor(
    (value % 3600) / 60
  );

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function formatNumber(value) {
  return new Intl.NumberFormat(
    "en-UG"
  ).format(
    Math.max(
      toSafeNumber(value),
      0
    )
  );
}

function formatPercentage(value) {
  return `${clampPercentage(
    value
  ).toFixed(1)}%`;
}

function formatLatency(value) {
  return `${Math.round(
    Math.max(
      toSafeNumber(value),
      0
    )
  )} ms`;
}

function formatLastUpdated(value) {
  if (!value) {
    return "Not available";
  }

  try {
    const date = new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "Not available";
    }

    return new Intl.DateTimeFormat(
      "en-UG",
      {
        dateStyle: "medium",
        timeStyle: "short",
      }
    ).format(date);
  } catch {
    return "Not available";
  }
}

function getStatusVariant(status) {
  switch (
    normalizeStatus(status)
  ) {
    case "healthy":
    case "operational":
    case "online":
    case "ok":
      return "success";

    case "warning":
    case "degraded":
    case "partial":
      return "warning";

    case "critical":
    case "offline":
    case "failed":
    case "unhealthy":
      return "danger";

    case "unknown":
    default:
      return "secondary";
  }
}

function getStatusLabel(status) {
  const normalized =
    normalizeStatus(status);

  if (
    !normalized ||
    normalized === "unknown"
  ) {
    return "Unknown";
  }

  return normalized
    .replace(
      /[_-]+/g,
      " "
    )
    .replace(
      /\b\w/g,
      (character) =>
        character.toUpperCase()
    );
}

function isAbortError(error) {
  return (
    error?.name ===
      "CanceledError" ||
    error?.name ===
      "AbortError" ||
    error?.code ===
      "ERR_CANCELED"
  );
}

function extractHealthPayload(
  response
) {
  const responseData =
    response?.data;

  if (
    responseData?.data &&
    typeof responseData.data ===
      "object" &&
    !Array.isArray(
      responseData.data
    )
  ) {
    return responseData.data;
  }

  return responseData;
}

// ============================================================================
// Health Normalization
// ============================================================================

function normalizeHealth(payload) {
  const source =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload)
      ? payload
      : {};

  const memory =
    source.memory &&
    typeof source.memory === "object"
      ? source.memory
      : {};

  const cpu =
    source.cpu &&
    typeof source.cpu === "object"
      ? source.cpu
      : {};

  const database =
    source.database &&
    typeof source.database === "object"
      ? source.database
      : {};

  const redis =
    source.redis &&
    typeof source.redis === "object"
      ? source.redis
      : {};

  const metrics =
    source.metrics &&
    typeof source.metrics === "object"
      ? source.metrics
      : {};

  const services = Array.isArray(
    source.services
  )
    ? source.services
    : [];

  return {
    status: normalizeStatus(
      source.status,
      DEFAULT_HEALTH.status
    ),

    uptime: Math.max(
      toSafeNumber(
        source.uptime
      ),
      0
    ),

    memory: {
      used: Math.max(
        toSafeNumber(
          memory.used
        ),
        0
      ),

      total: Math.max(
        toSafeNumber(
          memory.total
        ),
        0
      ),

      percentage:
        clampPercentage(
          memory.percentage
        ),
    },

    cpu: {
      usage:
        clampPercentage(
          cpu.usage
        ),
    },

    database: {
      status:
        normalizeStatus(
          database.status
        ),

      latency: Math.max(
        toSafeNumber(
          database.latency
        ),
        0
      ),
    },

    redis: {
      status:
        normalizeStatus(
          redis.status
        ),

      latency: Math.max(
        toSafeNumber(
          redis.latency
        ),
        0
      ),
    },

    metrics: {
      requestsPerMinute:
        Math.max(
          toSafeNumber(
            metrics.requestsPerMinute
          ),
          0
        ),

      activeUsers: Math.max(
        toSafeNumber(
          metrics.activeUsers
        ),
        0
      ),

      errorRate:
        clampPercentage(
          metrics.errorRate
        ),
    },

    services: services
      .filter(
        (service) =>
          service &&
          typeof service ===
            "object"
      )
      .map(
        (
          service,
          index
        ) => ({
          id:
            service.id ??
            service._id ??
            null,

          name:
            typeof service.name ===
              "string" &&
            service.name.trim()
              ? service.name.trim()
              : `Service ${
                  index + 1
                }`,

          status:
            normalizeStatus(
              service.status
            ),

          latency: Math.max(
            toSafeNumber(
              service.latency
            ),
            0
          ),
        })
      ),
  };
}

// ============================================================================
// Progress Bar
// ============================================================================

const ProgressBar = memo(
  ({
    value = 0,
    color = "#2563eb",
    label = "System utilization",
  }) => {
    const percentage =
      clampPercentage(value);

    return (
      <div
        className="health-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={
          MAX_PERCENTAGE
        }
        aria-valuenow={
          percentage
        }
        aria-label={label}
      >
        <div
          className="health-progress-fill"
          style={{
            width: `${percentage}%`,
            background: color,
          }}
        />
      </div>
    );
  }
);

ProgressBar.displayName =
  "ProgressBar";

ProgressBar.propTypes = {
  value: Number,
  color: String,
  label: String,
};

// ============================================================================
// Metric Card
// ============================================================================

const HealthMetricCard = memo(
  ({
    icon: Icon,
    title,
    value,
    children,
  }) => (
    <Card className="metric-card">
      <div
        className="metric-card-icon"
        aria-hidden="true"
      >
        <Icon size={28} />
      </div>

      <h3>{title}</h3>

      <h2>{value}</h2>

      {children}
    </Card>
  )
);

HealthMetricCard.displayName =
  "HealthMetricCard";

HealthMetricCard.propTypes = {
  icon: Function,
  title: String,
  value: String,
  children: React.node,
};

// ============================================================================
// Dependency Card
// ============================================================================

const DependencyCard = memo(
  ({
    icon: Icon,
    title,
    status,
    latency,
  }) => (
    <Card className="dependency-card">
      <Icon
        aria-hidden="true"
      />

      <div>
        <h3>{title}</h3>

        <p>
          Latency:{" "}
          {formatLatency(
            latency
          )}
        </p>
      </div>

      <StatusBadge
        status={getStatusVariant(
          status
        )}
      >
        {getStatusLabel(
          status
        )}
      </StatusBadge>
    </Card>
  )
);

DependencyCard.displayName =
  "DependencyCard";

DependencyCard.propTypes = {
  icon: Function,
  title: String,
  status: String,
  latency: Number,
};

// ============================================================================
// System Health Page
// ============================================================================

function SystemHealth() {
  const mountedRef =
    useRef(false);

  const controllerRef =
    useRef(null);

  const requestInFlightRef =
    useRef(false);

  const [
    health,
    setHealth,
  ] = useState(
    DEFAULT_HEALTH
  );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const [
    lastUpdated,
    setLastUpdated,
  ] = useState(null);

  // ========================================================================
  // Fetch Health
  // ========================================================================

  const loadHealth =
    useCallback(
      async (
        silent = false
      ) => {
        if (
          requestInFlightRef.current
        ) {
          return;
        }

        requestInFlightRef.current =
          true;

        if (!silent) {
          setRefreshing(true);
        }

        controllerRef.current?.abort();

        const controller =
          new AbortController();

        controllerRef.current =
          controller;

        try {
          const response =
            await api.get(
              HEALTH_ENDPOINT,
              {
                signal:
                  controller.signal,
              }
            );

          if (
            controller.signal
              .aborted ||
            !mountedRef.current
          ) {
            return;
          }

          const payload =
            extractHealthPayload(
              response
            );

          setHealth(
            normalizeHealth(
              payload
            )
          );

          setLastUpdated(
            new Date()
          );

          setError("");
        } catch (
          requestError
        ) {
          if (
            isAbortError(
              requestError
            ) ||
            controller.signal
              .aborted
          ) {
            return;
          }

          if (
            !mountedRef.current
          ) {
            return;
          }

          setError(
            requestError
              ?.response
              ?.data
              ?.message ||
              requestError
                ?.message ||
              "Failed to load system health."
          );
        } finally {
          if (
            mountedRef.current
          ) {
            setLoading(false);
            setRefreshing(false);
          }

          if (
            controllerRef.current ===
            controller
          ) {
            controllerRef.current =
              null;
          }

          requestInFlightRef.current =
            false;
        }
      },
      []
    );

  // ========================================================================
  // Lifecycle
  // ========================================================================

  useEffect(() => {
    mountedRef.current =
      true;

    loadHealth();

    const timer =
      window.setInterval(
        () =>
          loadHealth(
            true
          ),
        AUTO_REFRESH_INTERVAL
      );

    return () => {
      mountedRef.current =
        false;

      window.clearInterval(
        timer
      );

      controllerRef.current?.abort();

      controllerRef.current =
        null;

      requestInFlightRef.current =
        false;
    };
  }, [loadHealth]);

  // ========================================================================
  // Derived State
  // ========================================================================

  const systemHealthy =
    useMemo(
      () =>
        [
          "healthy",
          "operational",
          "ok",
        ].includes(
          health.status
        ),
      [health.status]
    );

  const overallStatusLabel =
    useMemo(
      () =>
        getStatusLabel(
          health.status
        ),
      [health.status]
    );

  // ========================================================================
  // Initial Loading
  // ========================================================================

  if (loading) {
    return (
      <LoadingScreen />
    );
  }

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <main
      className="system-health-page"
      aria-labelledby="system-health-title"
    >
      <PageHeader
        title="System Health"
        subtitle="Monitor infrastructure, services and platform availability."
        actions={
          <Button
            onClick={() =>
              loadHealth(false)
            }
            disabled={refreshing}
            aria-label="Refresh system health"
            aria-busy={refreshing}
          >
            <RefreshCw
              size={18}
              className={
                refreshing
                  ? "health-refreshing"
                  : undefined
              }
              aria-hidden="true"
            />

            {refreshing
              ? "Refreshing..."
              : "Refresh"}
          </Button>
        }
      />

      <h1
        id="system-health-title"
        className="sr-only"
      >
        TITech Community Capital
        System Health
      </h1>

      {/* ================================================================== */}
      {/* Metadata */}
      {/* ================================================================== */}

      <div
        className="system-health-meta"
        aria-live="polite"
      >
        <Clock
          size={15}
          aria-hidden="true"
        />

        <span>
          Last updated:{" "}
          {formatLastUpdated(
            lastUpdated
          )}
        </span>

        <span aria-hidden="true">
          •
        </span>

        <span>
          Auto-refreshes every{" "}
          {AUTO_REFRESH_INTERVAL /
            1000}
          s
        </span>
      </div>

      {/* ================================================================== */}
      {/* Overall Status */}
      {/* ================================================================== */}

      <Card className="system-status-card">
        <div className="system-status-header">
          <div>
            <h2>
              Platform Status
            </h2>

            <p>
              Current TITech
              Community Capital
              operational health.
            </p>
          </div>

          <StatusBadge
            status={getStatusVariant(
              health.status
            )}
          >
            {overallStatusLabel}
          </StatusBadge>
        </div>

        <div className="system-status-body">
          {systemHealthy ? (
            <CheckCircle2
              size={60}
              className="status-icon healthy"
              aria-hidden="true"
            />
          ) : (
            <AlertTriangle
              size={60}
              className="status-icon unhealthy"
              aria-hidden="true"
            />
          )}

          <div>
            <h3>
              {systemHealthy
                ? "All Systems Operational"
                : "Attention Required"}
            </h3>

            <p>
              Uptime:{" "}
              {formatUptime(
                health.uptime
              )}
            </p>
          </div>
        </div>
      </Card>

      {/* ================================================================== */}
      {/* Error */}
      {/* ================================================================== */}

      {error && (
        <Card
          className="system-error-card"
          role="alert"
          aria-live="assertive"
        >
          <WifiOff
            size={20}
            aria-hidden="true"
          />

          <span>{error}</span>

          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              loadHealth(false)
            }
            disabled={refreshing}
          >
            Retry
          </Button>
        </Card>
      )}

      {/* ================================================================== */}
      {/* Infrastructure Metrics */}
      {/* ================================================================== */}

      <section
        className="health-grid"
        aria-label="Infrastructure metrics"
      >
        <HealthMetricCard
          icon={Cpu}
          title="CPU Usage"
          value={formatPercentage(
            health.cpu?.usage
          )}
        >
          <ProgressBar
            value={
              health.cpu?.usage
            }
            color="#2563eb"
            label="CPU usage"
          />
        </HealthMetricCard>

        <HealthMetricCard
          icon={HardDrive}
          title="Memory Usage"
          value={formatPercentage(
            health.memory
              ?.percentage
          )}
        >
          <ProgressBar
            value={
              health.memory
                ?.percentage
            }
            color="#10b981"
            label="Memory usage"
          />

          <small>
            {formatBytes(
              health.memory?.used
            )}
            {" / "}
            {formatBytes(
              health.memory?.total
            )}
          </small>
        </HealthMetricCard>

        <HealthMetricCard
          icon={Activity}
          title="Requests / Min"
          value={formatNumber(
            health.metrics
              ?.requestsPerMinute
          )}
        />

        <HealthMetricCard
          icon={Shield}
          title="Error Rate"
          value={formatPercentage(
            health.metrics
              ?.errorRate
          )}
        />

        <HealthMetricCard
          icon={Clock}
          title="Active Users"
          value={formatNumber(
            health.metrics
              ?.activeUsers
          )}
        />
      </section>

      {/* ================================================================== */}
      {/* Core Dependencies */}
      {/* ================================================================== */}

      <section
        className="dependency-grid"
        aria-label="Core platform dependencies"
      >
        <DependencyCard
          icon={Database}
          title="Database"
          status={
            health.database
              ?.status
          }
          latency={
            health.database
              ?.latency
          }
        />

        <DependencyCard
          icon={Network}
          title="Redis Cache"
          status={
            health.redis?.status
          }
          latency={
            health.redis?.latency
          }
        />
      </section>

      {/* ================================================================== */}
      {/* Microservices */}
      {/* ================================================================== */}

      <Card className="system-services-card">
        <div className="services-header">
          <Server
            aria-hidden="true"
          />

          <div>
            <h2>
              Microservices
            </h2>

            <p>
              Current availability
              and response health of
              registered platform
              services.
            </p>
          </div>
        </div>

        <div
          className="services-list"
          role="list"
        >
          {health.services.length >
          0 ? (
            health.services.map(
              (
                service,
                index
              ) => {
                const serviceKey =
                  service.id ||
                  service.name ||
                  `service-${index}`;

                return (
                  <div
                    key={
                      serviceKey
                    }
                    className="service-item"
                    role="listitem"
                  >
                    <div className="service-info">
                      <h4>
                        {
                          service.name
                        }
                      </h4>

                      <p>
                        Latency:{" "}
                        {formatLatency(
                          service.latency
                        )}
                      </p>
                    </div>

                    <StatusBadge
                      status={getStatusVariant(
                        service.status
                      )}
                    >
                      {getStatusLabel(
                        service.status
                      )}
                    </StatusBadge>
                  </div>
                );
              }
            )
          ) : (
            <div
              className="empty-services"
              role="status"
            >
              No registered
              services.
            </div>
          )}
        </div>
      </Card>
    </main>
  );
}

// ============================================================================
// Memoized Export
// ============================================================================

export default memo(
  SystemHealth
);