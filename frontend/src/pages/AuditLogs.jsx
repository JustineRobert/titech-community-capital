// ============================================================================
// TITech Community Capital
// Enterprise Audit Logs
//
// File:
// frontend/src/pages/AuditLogs.jsx
//
// Production Grade
// -----------------------------------------------------------------------------
// Features
// - Defensive audit-log normalization
// - Search across event, actor, resource, IP, request ID and metadata
// - Severity/status filtering
// - Stable client-side sorting
// - Accessible sortable table
// - Keyboard-accessible rows
// - Responsive layout
// - Pagination with configurable page sizes
// - Safe metadata rendering
// - JSON metadata inspection
// - Optional row selection callback
// - Loading / error / empty states
// - Refresh support
// - No mutation of caller-owned data
// - No unsafe HTML rendering
// - TITech naming consistency
// ============================================================================

"use strict";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import PropTypes from "prop-types";

import {
  Activity,
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  User,
  X,
} from "lucide-react";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50];

const DEFAULT_PAGE_SIZE = 10;

const MAX_SEARCH_LENGTH = 200;

const MAX_DETAILS_LENGTH = 500;

const SORT_DIRECTIONS = Object.freeze({
  ASC: "asc",
  DESC: "desc",
});

const SEVERITY_VALUES = Object.freeze([
  "all",
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);

const STATUS_VALUES = Object.freeze([
  "all",
  "success",
  "failed",
  "warning",
]);

// ============================================================================
// Utility Functions
// ============================================================================

function safeString(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  return fallback;
}

function getRecordId(record, index) {
  const candidates = [
    record?.id,
    record?._id,
    record?.auditId,
    record?.eventId,
    record?.requestId,
  ];

  const value = candidates.find(
    (candidate) =>
      candidate !== null &&
      candidate !== undefined &&
      String(candidate).trim() !== ""
  );

  return value !== undefined
    ? String(value)
    : `audit-log-${index}`;
}

function formatTimestamp(timestamp) {
  if (
    timestamp === null ||
    timestamp === undefined ||
    timestamp === ""
  ) {
    return {
      primary: "-",
      relative: "",
      value: 0,
      valid: false,
    };
  }

  const date =
    timestamp instanceof Date
      ? timestamp
      : new Date(timestamp);

  const time = date.getTime();

  if (Number.isNaN(time)) {
    return {
      primary: safeString(timestamp, "-"),
      relative: "",
      value: 0,
      valid: false,
    };
  }

  return {
    primary: new Intl.DateTimeFormat(
      undefined,
      {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }
    ).format(date),

    relative: getRelativeTime(date),

    value: time,

    valid: true,
  };
}

function getRelativeTime(date) {
  const diff =
    Date.now() - date.getTime();

  const seconds =
    Math.round(Math.abs(diff) / 1000);

  if (seconds < 60) {
    return "just now";
  }

  const minutes =
    Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days =
    Math.round(hours / 24);

  if (days < 30) {
    return `${days}d ago`;
  }

  const months =
    Math.round(days / 30);

  if (months < 12) {
    return `${months}mo ago`;
  }

  const years =
    Math.round(days / 365);

  return `${years}y ago`;
}

function normalizeSeverity(value) {
  const normalized =
    safeString(value)
      .trim()
      .toLowerCase();

  if (
    [
      "critical",
      "fatal",
      "emergency",
    ].includes(normalized)
  ) {
    return "critical";
  }

  if (
    [
      "high",
      "error",
      "danger",
    ].includes(normalized)
  ) {
    return "high";
  }

  if (
    [
      "medium",
      "warn",
      "warning",
    ].includes(normalized)
  ) {
    return "medium";
  }

  if (
    [
      "low",
    ].includes(normalized)
  ) {
    return "low";
  }

  return "info";
}

function normalizeStatus(value) {
  const normalized =
    safeString(value)
      .trim()
      .toLowerCase();

  if (
    [
      "success",
      "successful",
      "succeeded",
      "ok",
      "completed",
    ].includes(normalized)
  ) {
    return "success";
  }

  if (
    [
      "failed",
      "failure",
      "error",
      "denied",
      "rejected",
    ].includes(normalized)
  ) {
    return "failed";
  }

  if (
    [
      "warning",
      "warn",
      "pending",
    ].includes(normalized)
  ) {
    return "warning";
  }

  return normalized || "success";
}

function serializeDetails(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(
      value,
      null,
      2
    );
  } catch {
    return "[Unserializable metadata]";
  }
}

function truncateText(
  value,
  maxLength = MAX_DETAILS_LENGTH
) {
  const text = safeString(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(
    0,
    maxLength
  )}…`;
}

function getActorName(record) {
  return (
    record?.user?.name ||
    record?.actor?.name ||
    record?.userName ||
    record?.actorName ||
    record?.user?.email ||
    record?.actor?.email ||
    record?.userId ||
    record?.actorId ||
    record?.createdBy ||
    "System"
  );
}

function getResource(record) {
  return (
    record?.resource ||
    record?.resourceType ||
    record?.entity ||
    record?.entityType ||
    record?.targetType ||
    "-"
  );
}

function getIpAddress(record) {
  return (
    record?.ipAddress ||
    record?.ip ||
    record?.clientIp ||
    record?.metadata?.ip ||
    "-"
  );
}

function getRequestId(record) {
  return (
    record?.requestId ||
    record?.correlationId ||
    record?.traceId ||
    "-"
  );
}

// ============================================================================
// Normalization
// ============================================================================

function normalizeLog(record, index) {
  const timestamp =
    record?.timestamp ??
    record?.createdAt ??
    record?.time ??
    record?.occurredAt ??
    null;

  const timestampInfo =
    formatTimestamp(timestamp);

  const details =
    record?.details ??
    record?.meta ??
    record?.metadata ??
    record?.payload ??
    record?.context ??
    null;

  const severity =
    normalizeSeverity(
      record?.severity ??
        record?.riskLevel ??
        record?.level
    );

  const status =
    normalizeStatus(
      record?.status ??
        record?.result ??
        record?.outcome
    );

  const event =
    record?.event ??
    record?.action ??
    record?.type ??
    record?.eventType ??
    "Unknown Event";

  const actor =
    getActorName(record);

  const resource =
    getResource(record);

  const ipAddress =
    getIpAddress(record);

  const requestId =
    getRequestId(record);

  const detailsText =
    serializeDetails(details);

  return {
    id: getRecordId(
      record,
      index
    ),

    event: safeString(
      event,
      "Unknown Event"
    ),

    actor: safeString(
      actor,
      "System"
    ),

    actorId: safeString(
      record?.userId ||
        record?.actorId
    ),

    resource: safeString(
      resource,
      "-"
    ),

    status,

    severity,

    timestamp,

    timestampValue:
      timestampInfo.value,

    timestampLabel:
      timestampInfo.primary,

    relativeTime:
      timestampInfo.relative,

    ipAddress:
      safeString(
        ipAddress,
        "-"
      ),

    requestId:
      safeString(
        requestId,
        "-"
      ),

    details: detailsText,

    raw: record,
  };
}

// ============================================================================
// Visual Helpers
// ============================================================================

function SeverityBadge({
  severity,
}) {
  const config = {
    info: {
      label: "Info",
      className:
        "audit-badge audit-badge-info",
      icon: Activity,
    },

    low: {
      label: "Low",
      className:
        "audit-badge audit-badge-low",
      icon: ShieldCheck,
    },

    medium: {
      label: "Medium",
      className:
        "audit-badge audit-badge-medium",
      icon: AlertCircle,
    },

    high: {
      label: "High",
      className:
        "audit-badge audit-badge-high",
      icon: ShieldAlert,
    },

    critical: {
      label: "Critical",
      className:
        "audit-badge audit-badge-critical",
      icon: ShieldAlert,
    },
  };

  const current =
    config[severity] ||
    config.info;

  const Icon =
    current.icon;

  return (
    <span
      className={current.className}
      aria-label={`Severity: ${current.label}`}
    >
      <Icon
        size={13}
        aria-hidden="true"
      />

      {current.label}
    </span>
  );
}

function StatusBadge({
  status,
}) {
  const labels = {
    success: "Success",
    failed: "Failed",
    warning: "Warning",
  };

  const label =
    labels[status] ||
    status ||
    "Unknown";

  return (
    <span
      className={`audit-status audit-status-${status}`}
    >
      {label}
    </span>
  );
}

// ============================================================================
// Sort Indicator
// ============================================================================

function SortIndicator({
  active,
  direction,
}) {
  if (!active) {
    return (
      <ChevronDown
        size={14}
        aria-hidden="true"
        className="audit-sort-icon inactive"
      />
    );
  }

  return (
    <ChevronDown
      size={14}
      aria-hidden="true"
      className={`audit-sort-icon ${
        direction === SORT_DIRECTIONS.ASC
          ? "ascending"
          : "descending"
      }`}
    />
  );
}

// ============================================================================
// Component
// ============================================================================

export default function AuditLogs({
  logs = [],
  pageSizeOptions =
    DEFAULT_PAGE_SIZE_OPTIONS,
  initialPageSize =
    DEFAULT_PAGE_SIZE,
  onRowClick = null,
  onRefresh = null,
  loading = false,
  error = "",
  title = "Audit Logs",
  description =
    "Security, compliance and platform activity",
}) {
  const normalizedPageSizes =
    useMemo(() => {
      const values = Array.isArray(
        pageSizeOptions
      )
        ? pageSizeOptions
            .map(Number)
            .filter(
              (value) =>
                Number.isFinite(value) &&
                value > 0
            )
        : [];

      const unique =
        [...new Set(values)];

      return unique.length > 0
        ? unique
        : DEFAULT_PAGE_SIZE_OPTIONS;
    }, [pageSizeOptions]);

  const safeInitialPageSize =
    normalizedPageSizes.includes(
      Number(initialPageSize)
    )
      ? Number(initialPageSize)
      : normalizedPageSizes[0];

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const [query, setQuery] =
    useState("");

  const [severityFilter, setSeverityFilter] =
    useState("all");

  const [statusFilter, setStatusFilter] =
    useState("all");

  const [sortKey, setSortKey] =
    useState("timestamp");

  const [sortDir, setSortDir] =
    useState(
      SORT_DIRECTIONS.DESC
    );

  const [pageSize, setPageSize] =
    useState(
      safeInitialPageSize
    );

  const [page, setPage] =
    useState(1);

  const [selectedLog, setSelectedLog] =
    useState(null);

  // --------------------------------------------------------------------------
  // Normalized data
  // --------------------------------------------------------------------------

  const normalizedLogs =
    useMemo(
      () =>
        Array.isArray(logs)
          ? logs.map(
              normalizeLog
            )
          : [],
      [logs]
    );

  // --------------------------------------------------------------------------
  // Search
  // --------------------------------------------------------------------------

  const filteredLogs =
    useMemo(() => {
      const normalizedQuery =
        String(query || "")
          .slice(
            0,
            MAX_SEARCH_LENGTH
          )
          .trim()
          .toLowerCase();

      return normalizedLogs.filter(
        (row) => {
          const matchesSearch =
            !normalizedQuery ||
            [
              row.id,
              row.event,
              row.actor,
              row.actorId,
              row.resource,
              row.status,
              row.severity,
              row.ipAddress,
              row.requestId,
              row.details,
            ].some((value) =>
              String(value || "")
                .toLowerCase()
                .includes(
                  normalizedQuery
                )
            );

          const matchesSeverity =
            severityFilter ===
              "all" ||
            row.severity ===
              severityFilter;

          const matchesStatus =
            statusFilter === "all" ||
            row.status ===
              statusFilter;

          return (
            matchesSearch &&
            matchesSeverity &&
            matchesStatus
          );
        }
      );
    }, [
      normalizedLogs,
      query,
      severityFilter,
      statusFilter,
    ]);

  // --------------------------------------------------------------------------
  // Sorting
  // --------------------------------------------------------------------------

  const sortedLogs =
    useMemo(() => {
      const copy =
        [...filteredLogs];

      copy.sort(
        (a, b) => {
          let comparison =
            0;

          if (
            sortKey ===
            "timestamp"
          ) {
            comparison =
              a.timestampValue -
              b.timestampValue;
          } else {
            const av =
              String(
                a[sortKey] ??
                  ""
              ).toLowerCase();

            const bv =
              String(
                b[sortKey] ??
                  ""
              ).toLowerCase();

            if (av < bv) {
              comparison = -1;
            } else if (
              av > bv
            ) {
              comparison = 1;
            }
          }

          if (
            comparison === 0
          ) {
            comparison =
              String(a.id).localeCompare(
                String(b.id)
              );
          }

          return sortDir ===
            SORT_DIRECTIONS.ASC
            ? comparison
            : -comparison;
        }
      );

      return copy;
    }, [
      filteredLogs,
      sortKey,
      sortDir,
    ]);

  // --------------------------------------------------------------------------
  // Pagination
  // --------------------------------------------------------------------------

  const total =
    sortedLogs.length;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        total / pageSize
      )
    );

  const pageSafe =
    Math.min(
      Math.max(1, page),
      totalPages
    );

  const pageRows =
    useMemo(() => {
      const start =
        (pageSafe - 1) *
        pageSize;

      return sortedLogs.slice(
        start,
        start + pageSize
      );
    }, [
      sortedLogs,
      pageSafe,
      pageSize,
    ]);

  // --------------------------------------------------------------------------
  // Keep page valid after filtering/deletion.
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [
    page,
    totalPages,
  ]);

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------

  const toggleSort =
    useCallback(
      (key) => {
        if (
          sortKey === key
        ) {
          setSortDir(
            (current) =>
              current ===
              SORT_DIRECTIONS.ASC
                ? SORT_DIRECTIONS.DESC
                : SORT_DIRECTIONS.ASC
          );
        } else {
          setSortKey(key);
          setSortDir(
            SORT_DIRECTIONS.DESC
          );
        }

        setPage(1);
      },
      [sortKey]
    );

  const clearFilters =
    useCallback(() => {
      setQuery("");
      setSeverityFilter(
        "all"
      );
      setStatusFilter(
        "all"
      );
      setPage(1);
    }, []);

  const handleRowClick =
    useCallback(
      (row) => {
        setSelectedLog(row);

        if (onRowClick) {
          onRowClick(row);
        }
      },
      [onRowClick]
    );

  const handleRefresh =
    useCallback(async () => {
      if (
        typeof onRefresh !==
        "function"
      ) {
        return;
      }

      try {
        await onRefresh();
      } catch {
        // Parent component owns refresh error handling.
      }
    }, [onRefresh]);

  const hasActiveFilters =
    Boolean(
      query.trim() ||
        severityFilter !==
          "all" ||
        statusFilter !==
          "all"
    );

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <section
      className="audit-logs-page"
      aria-labelledby="audit-logs-heading"
    >
      {/* ====================================================================
          Header
      ==================================================================== */}

      <header className="audit-logs-header">
        <div className="audit-logs-heading-group">
          <div className="audit-logs-title-icon">
            <ShieldCheck
              size={22}
              aria-hidden="true"
            />
          </div>

          <div>
            <h1 id="audit-logs-heading">
              {title}
            </h1>

            <p>
              {description}
            </p>
          </div>
        </div>

        {onRefresh && (
          <button
            type="button"
            className="audit-refresh-button"
            onClick={
              handleRefresh
            }
            disabled={loading}
            aria-label="Refresh audit logs"
          >
            <RefreshCw
              size={17}
              aria-hidden="true"
              className={
                loading
                  ? "audit-spin"
                  : ""
              }
            />

            <span>
              {loading
                ? "Refreshing..."
                : "Refresh"}
            </span>
          </button>
        )}
      </header>

      {/* ====================================================================
          Error
      ==================================================================== */}

      {error && (
        <div
          className="audit-error"
          role="alert"
        >
          <AlertCircle
            size={18}
            aria-hidden="true"
          />

          <div>
            <strong>
              Unable to load audit logs
            </strong>

            <p>
              {String(error)}
            </p>
          </div>
        </div>
      )}

      {/* ====================================================================
          Toolbar
      ==================================================================== */}

      <div className="audit-toolbar">
        <div className="audit-search-wrapper">
          <Search
            size={17}
            aria-hidden="true"
          />

          <label
            htmlFor="audit-search"
            className="sr-only"
          >
            Search audit logs
          </label>

          <input
            id="audit-search"
            type="search"
            value={query}
            maxLength={
              MAX_SEARCH_LENGTH
            }
            onChange={(event) => {
              setQuery(
                event.target.value
              );
              setPage(1);
            }}
            placeholder="Search event, user, resource, IP, request ID..."
            autoComplete="off"
            spellCheck="false"
            aria-label="Search audit logs"
          />

          {query && (
            <button
              type="button"
              className="audit-search-clear"
              onClick={() => {
                setQuery("");
                setPage(1);
              }}
              aria-label="Clear audit log search"
            >
              <X
                size={15}
                aria-hidden="true"
              />
            </button>
          )}
        </div>

        <div className="audit-filter">
          <Filter
            size={16}
            aria-hidden="true"
          />

          <label
            htmlFor="audit-severity"
            className="sr-only"
          >
            Filter by severity
          </label>

          <select
            id="audit-severity"
            value={
              severityFilter
            }
            onChange={(event) => {
              setSeverityFilter(
                event.target.value
              );
              setPage(1);
            }}
          >
            {SEVERITY_VALUES.map(
              (value) => (
                <option
                  key={value}
                  value={value}
                >
                  {value === "all"
                    ? "All severities"
                    : value
                        .charAt(0)
                        .toUpperCase() +
                      value.slice(
                        1
                      )}
                </option>
              )
            )}
          </select>
        </div>

        <div className="audit-filter">
          <Activity
            size={16}
            aria-hidden="true"
          />

          <label
            htmlFor="audit-status"
            className="sr-only"
          >
            Filter by status
          </label>

          <select
            id="audit-status"
            value={
              statusFilter
            }
            onChange={(event) => {
              setStatusFilter(
                event.target.value
              );
              setPage(1);
            }}
          >
            {STATUS_VALUES.map(
              (value) => (
                <option
                  key={value}
                  value={value}
                >
                  {value === "all"
                    ? "All statuses"
                    : value
                        .charAt(0)
                        .toUpperCase() +
                      value.slice(
                        1
                      )}
                </option>
              )
            )}
          </select>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            className="audit-clear-filters"
            onClick={
              clearFilters
            }
          >
            <X
              size={15}
              aria-hidden="true"
            />

            Clear filters
          </button>
        )}
      </div>

      {/* ====================================================================
          Summary
      ==================================================================== */}

      <div className="audit-summary-bar">
        <div>
          <strong>
            {total.toLocaleString()}
          </strong>{" "}
          matching{" "}
          {total === 1
            ? "event"
            : "events"}
        </div>

        <div className="audit-summary-status">
          <Clock3
            size={15}
            aria-hidden="true"
          />

          <span>
            Sorted by{" "}
            <strong>
              {sortKey}
            </strong>
          </span>
        </div>
      </div>

      {/* ====================================================================
          Table
      ==================================================================== */}

      <div className="audit-table-container">
        <table
          className="audit-table"
          aria-describedby="audit-logs-heading"
        >
          <caption className="sr-only">
            TITech Community Capital
            audit log entries
          </caption>

          <thead>
            <tr>
              <th
                scope="col"
                aria-sort={
                  sortKey === "event"
                    ? sortDir ===
                      SORT_DIRECTIONS.ASC
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  type="button"
                  className="audit-sort-button"
                  onClick={() =>
                    toggleSort(
                      "event"
                    )
                  }
                >
                  Event

                  <SortIndicator
                    active={
                      sortKey ===
                      "event"
                    }
                    direction={
                      sortDir
                    }
                  />
                </button>
              </th>

              <th
                scope="col"
                aria-sort={
                  sortKey === "actor"
                    ? sortDir ===
                      SORT_DIRECTIONS.ASC
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  type="button"
                  className="audit-sort-button"
                  onClick={() =>
                    toggleSort(
                      "actor"
                    )
                  }
                >
                  Actor

                  <SortIndicator
                    active={
                      sortKey ===
                      "actor"
                    }
                    direction={
                      sortDir
                    }
                  />
                </button>
              </th>

              <th
                scope="col"
                aria-sort={
                  sortKey ===
                  "resource"
                    ? sortDir ===
                      SORT_DIRECTIONS.ASC
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  type="button"
                  className="audit-sort-button"
                  onClick={() =>
                    toggleSort(
                      "resource"
                    )
                  }
                >
                  Resource

                  <SortIndicator
                    active={
                      sortKey ===
                      "resource"
                    }
                    direction={
                      sortDir
                    }
                  />
                </button>
              </th>

              <th scope="col">
                Severity
              </th>

              <th scope="col">
                Status
              </th>

              <th
                scope="col"
                aria-sort={
                  sortKey ===
                  "timestamp"
                    ? sortDir ===
                      SORT_DIRECTIONS.ASC
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  type="button"
                  className="audit-sort-button"
                  onClick={() =>
                    toggleSort(
                      "timestamp"
                    )
                  }
                >
                  Time

                  <SortIndicator
                    active={
                      sortKey ===
                      "timestamp"
                    }
                    direction={
                      sortDir
                    }
                  />
                </button>
              </th>

              <th scope="col">
                Details
              </th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              [...Array(6)].map(
                (_, index) => (
                  <tr
                    key={`loading-${index}`}
                    aria-hidden="true"
                  >
                    <td colSpan="7">
                      <div className="audit-skeleton-row">
                        <span />
                        <span />
                        <span />
                        <span />
                      </div>
                    </td>
                  </tr>
                )
              )
            ) : pageRows.length ===
              0 ? (
              <tr>
                <td
                  colSpan="7"
                  className="audit-empty-cell"
                >
                  <div className="audit-empty-state">
                    <ShieldCheck
                      size={30}
                      aria-hidden="true"
                    />

                    <h3>
                      No audit logs found
                    </h3>

                    <p>
                      {hasActiveFilters
                        ? "Try adjusting your search or filters."
                        : "There are no audit events available."}
                    </p>

                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={
                          clearFilters
                        }
                        className="audit-empty-action"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              pageRows.map(
                (row) => (
                  <tr
                    key={row.id}
                    tabIndex={
                      onRowClick
                        ? 0
                        : undefined
                    }
                    className={
                      onRowClick
                        ? "audit-row clickable"
                        : "audit-row"
                    }
                    onClick={() =>
                      handleRowClick(
                        row
                      )
                    }
                    onKeyDown={(
                      event
                    ) => {
                      if (
                        !onRowClick
                      ) {
                        return;
                      }

                      if (
                        event.key ===
                          "Enter" ||
                        event.key ===
                          " "
                      ) {
                        event.preventDefault();

                        handleRowClick(
                          row
                        );
                      }
                    }}
                    aria-label={
                      onRowClick
                        ? `View audit event ${row.event}`
                        : undefined
                    }
                  >
                    <td>
                      <div className="audit-event-cell">
                        <strong>
                          {row.event}
                        </strong>

                        <span>
                          ID:{" "}
                          {row.id}
                        </span>
                      </div>
                    </td>

                    <td>
                      <div className="audit-actor-cell">
                        <div className="audit-avatar">
                          <User
                            size={15}
                            aria-hidden="true"
                          />
                        </div>

                        <div>
                          <strong>
                            {row.actor}
                          </strong>

                          {row.actorId && (
                            <span>
                              {row.actorId}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td>
                      <span className="audit-resource">
                        {row.resource}
                      </span>
                    </td>

                    <td>
                      <SeverityBadge
                        severity={
                          row.severity
                        }
                      />
                    </td>

                    <td>
                      <StatusBadge
                        status={
                          row.status
                        }
                      />
                    </td>

                    <td>
                      <div className="audit-time-cell">
                        <time
                          dateTime={
                            row.timestamp
                              ? new Date(
                                  row.timestamp
                                ).toISOString()
                              : undefined
                          }
                        >
                          {
                            row.timestampLabel
                          }
                        </time>

                        {row.relativeTime && (
                          <span>
                            {
                              row.relativeTime
                            }
                          </span>
                        )}
                      </div>
                    </td>

                    <td>
                      <div
                        className="audit-details-cell"
                        title={
                          row.details
                        }
                      >
                        {row.details
                          ? truncateText(
                              row.details
                            )
                          : "-"}
                      </div>
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>

      {/* ====================================================================
          Pagination
      ==================================================================== */}

      <footer className="audit-pagination">
        <div className="audit-pagination-info">
          Showing{" "}
          <strong>
            {total === 0
              ? 0
              : (pageSafe - 1) *
                  pageSize +
                1}
          </strong>{" "}
          to{" "}
          <strong>
            {Math.min(
              pageSafe *
                pageSize,
              total
            )}
          </strong>{" "}
          of{" "}
          <strong>
            {total}
          </strong>
        </div>

        <div className="audit-page-size">
          <label htmlFor="audit-page-size">
            Rows
          </label>

          <select
            id="audit-page-size"
            value={pageSize}
            onChange={(
              event
            ) => {
              setPageSize(
                Number(
                  event.target
                    .value
                )
              );
              setPage(1);
            }}
          >
            {normalizedPageSizes.map(
              (size) => (
                <option
                  key={size}
                  value={size}
                >
                  {size}
                </option>
              )
            )}
          </select>
        </div>

        <div
          className="audit-pagination-controls"
          aria-label="Audit log pagination"
        >
          <button
            type="button"
            onClick={() =>
              setPage(1)
            }
            disabled={
              pageSafe === 1
            }
            aria-label="First page"
          >
            <ChevronsLeft
              size={16}
            />
          </button>

          <button
            type="button"
            onClick={() =>
              setPage(
                (current) =>
                  Math.max(
                    1,
                    current - 1
                  )
              )
            }
            disabled={
              pageSafe === 1
            }
            aria-label="Previous page"
          >
            <ChevronLeft
              size={17}
            />
          </button>

          <span
            className="audit-page-indicator"
            aria-live="polite"
          >
            Page{" "}
            <strong>
              {pageSafe}
            </strong>{" "}
            of{" "}
            <strong>
              {totalPages}
            </strong>
          </span>

          <button
            type="button"
            onClick={() =>
              setPage(
                (current) =>
                  Math.min(
                    totalPages,
                    current + 1
                  )
              )
            }
            disabled={
              pageSafe ===
              totalPages
            }
            aria-label="Next page"
          >
            <ChevronRight
              size={17}
            />
          </button>

          <button
            type="button"
            onClick={() =>
              setPage(
                totalPages
              )
            }
            disabled={
              pageSafe ===
              totalPages
            }
            aria-label="Last page"
          >
            <ChevronsRight
              size={16}
            />
          </button>
        </div>
      </footer>

      {/* ====================================================================
          Selected Log Detail
      ==================================================================== */}

      {selectedLog && (
        <div
          className="audit-detail-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-detail-heading"
        >
          <div className="audit-detail-header">
            <div>
              <span>
                Audit Event
              </span>

              <h2 id="audit-detail-heading">
                {
                  selectedLog.event
                }
              </h2>
            </div>

            <button
              type="button"
              className="audit-detail-close"
              onClick={() =>
                setSelectedLog(
                  null
                )
              }
              aria-label="Close audit event details"
            >
              <X
                size={19}
              />
            </button>
          </div>

          <div className="audit-detail-grid">
            <div>
              <span>
                Event ID
              </span>

              <strong>
                {selectedLog.id}
              </strong>
            </div>

            <div>
              <span>
                Actor
              </span>

              <strong>
                {
                  selectedLog.actor
                }
              </strong>
            </div>

            <div>
              <span>
                Resource
              </span>

              <strong>
                {
                  selectedLog.resource
                }
              </strong>
            </div>

            <div>
              <span>
                Severity
              </span>

              <SeverityBadge
                severity={
                  selectedLog.severity
                }
              />
            </div>

            <div>
              <span>
                Status
              </span>

              <StatusBadge
                status={
                  selectedLog.status
                }
              />
            </div>

            <div>
              <span>
                IP Address
              </span>

              <strong>
                {
                  selectedLog.ipAddress
                }
              </strong>
            </div>

            <div>
              <span>
                Request ID
              </span>

              <strong>
                {
                  selectedLog.requestId
                }
              </strong>
            </div>

            <div>
              <span>
                Timestamp
              </span>

              <strong>
                {
                  selectedLog.timestampLabel
                }
              </strong>
            </div>
          </div>

          <div className="audit-detail-metadata">
            <h3>
              Event Details
            </h3>

            {selectedLog.details ? (
              <pre>
                {
                  selectedLog.details
                }
              </pre>
            ) : (
              <p>
                No additional
                metadata was
                recorded for this
                event.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

AuditLogs.propTypes = {
  logs:
    PropTypes.arrayOf(
      PropTypes.object
    ),

  pageSizeOptions:
    PropTypes.arrayOf(
      PropTypes.number
    ),

  initialPageSize:
    PropTypes.number,

  onRowClick:
    PropTypes.func,

  onRefresh:
    PropTypes.func,

  loading:
    PropTypes.bool,

  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  title:
    PropTypes.string,

  description:
    PropTypes.string,
};