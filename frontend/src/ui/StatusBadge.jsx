// ============================================================================
// TITech Community Capital
// Enterprise StatusBadge Component
// File: src/components/ui/StatusBadge.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";

import {
  CheckCircle2,
  Clock3,
  AlertTriangle,
  XCircle,
  Shield,
  Loader2,
  PauseCircle,
  Ban,
  Circle,
} from "lucide-react";

// ============================================================================
// Status Configuration
// ============================================================================

const STATUS_CONFIG = {
  active: {
    color: "success",
    icon: CheckCircle2,
    label: "Active",
  },

  approved: {
    color: "success",
    icon: CheckCircle2,
    label: "Approved",
  },

  completed: {
    color: "success",
    icon: CheckCircle2,
    label: "Completed",
  },

  paid: {
    color: "success",
    icon: CheckCircle2,
    label: "Paid",
  },

  pending: {
    color: "warning",
    icon: Clock3,
    label: "Pending",
  },

  processing: {
    color: "info",
    icon: Loader2,
    label: "Processing",
  },

  inactive: {
    color: "secondary",
    icon: PauseCircle,
    label: "Inactive",
  },

  suspended: {
    color: "danger",
    icon: Ban,
    label: "Suspended",
  },

  rejected: {
    color: "danger",
    icon: XCircle,
    label: "Rejected",
  },

  failed: {
    color: "danger",
    icon: XCircle,
    label: "Failed",
  },

  overdue: {
    color: "danger",
    icon: AlertTriangle,
    label: "Overdue",
  },

  flagged: {
    color: "danger",
    icon: Shield,
    label: "Flagged",
  },

  draft: {
    color: "secondary",
    icon: Circle,
    label: "Draft",
  },
};

// ============================================================================
// Helpers
// ============================================================================

function normalizeStatus(
  status
) {
  return String(
    status || "unknown"
  )
    .trim()
    .toLowerCase();
}

function humanize(
  value
) {
  return String(
    value || ""
  )
    .replace(
      /[_-]/g,
      " "
    )
    .replace(
      /\b\w/g,
      (letter) =>
        letter.toUpperCase()
    );
}

// ============================================================================
// Component
// ============================================================================

function StatusBadge({
  status,
  label,
  size = "md",
  variant = "soft",
  showIcon = true,
  pulse = false,
  rounded = true,
  className = "",
}) {
  const normalized =
    normalizeStatus(
      status
    );

  const config =
    useMemo(
      () =>
        STATUS_CONFIG[
          normalized
        ] || {
          color:
            "secondary",
          icon: Circle,
          label:
            humanize(
              normalized
            ),
        },
      [normalized]
    );

  const Icon =
    config.icon;

  const displayLabel =
    label ||
    config.label;

  const classes = [
    "tt-status-badge",
    `tt-status-${config.color}`,
    `tt-status-${size}`,
    `tt-status-${variant}`,
    rounded
      ? "tt-status-rounded"
      : "",
    pulse
      ? "tt-status-pulse"
      : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={
        classes
      }
      role="status"
      aria-label={
        displayLabel
      }
    >
      {showIcon && (
        <Icon
          size={
            size === "sm"
              ? 12
              : size === "lg"
              ? 18
              : 14
          }
          className={
            normalized ===
            "processing"
              ? "tt-status-spin"
              : ""
          }
        />
      )}

      <span>
        {displayLabel}
      </span>
    </span>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

StatusBadge.propTypes =
  {
    status:
      PropTypes.string
        .isRequired,

    label:
      PropTypes.node,

    size:
      PropTypes.oneOf([
        "sm",
        "md",
        "lg",
      ]),

    variant:
      PropTypes.oneOf([
        "soft",
        "solid",
        "outline",
      ]),

    showIcon:
      PropTypes.bool,

    pulse:
      PropTypes.bool,

    rounded:
      PropTypes.bool,

    className:
      PropTypes.string,
  };

// ============================================================================
// Export
// ============================================================================

export default memo(
  StatusBadge
);