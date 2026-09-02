// ============================================================================
// TITech Community Capital
// Enterprise Skeleton Component
// File: src/components/ui/Skeleton.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
} from "react";

import PropTypes from "prop-types";

// ============================================================================
// Component
// ============================================================================

function Skeleton({
  width = "100%",
  height = "1rem",
  variant = "rectangular",
  animation = true,
  borderRadius,
  count = 1,
  className = "",
  style = {},
}) {
  const computedRadius =
    borderRadius ??
    (variant === "circular"
      ? "50%"
      : variant === "rounded"
      ? "12px"
      : "4px");

  const items = Array.from(
    {
      length: count,
    },
    (_, index) => (
      <span
        key={index}
        className={[
          "tt-skeleton",
          animation
            ? "tt-skeleton-animated"
            : "",
          `tt-skeleton-${variant}`,
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          width,
          height,
          borderRadius:
            computedRadius,
          ...style,
        }}
        aria-hidden="true"
      />
    )
  );

  return (
    <div className="tt-skeleton-wrapper">
      {items}
    </div>
  );
}

// ============================================================================
// Convenience Components
// ============================================================================

export function SkeletonText({
  lines = 3,
}) {
  return (
    <div className="tt-skeleton-text">
      {Array.from(
        {
          length: lines,
        },
        (_, index) => (
          <Skeleton
            key={index}
            height="12px"
            width={
              index ===
              lines - 1
                ? "70%"
                : "100%"
            }
            className="tt-skeleton-line"
          />
        )
      )}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="tt-skeleton-card">
      <Skeleton
        width="40%"
        height="20px"
      />

      <SkeletonText
        lines={3}
      />

      <Skeleton
        width="30%"
        height="36px"
      />
    </div>
  );
}

export function SkeletonAvatar({
  size = 48,
}) {
  return (
    <Skeleton
      width={`${size}px`}
      height={`${size}px`}
      variant="circular"
    />
  );
}

// ============================================================================
// PropTypes
// ============================================================================

Skeleton.propTypes = {
  width:
    PropTypes.oneOfType(
      [
        PropTypes.number,
        PropTypes.string,
      ]
    ),

  height:
    PropTypes.oneOfType(
      [
        PropTypes.number,
        PropTypes.string,
      ]
    ),

  variant:
    PropTypes.oneOf([
      "rectangular",
      "rounded",
      "circular",
    ]),

  animation:
    PropTypes.bool,

  borderRadius:
    PropTypes.oneOfType(
      [
        PropTypes.number,
        PropTypes.string,
      ]
    ),

  count:
    PropTypes.number,

  className:
    PropTypes.string,

  style:
    PropTypes.object,
};

SkeletonText.propTypes =
  {
    lines:
      PropTypes.number,
  };

SkeletonAvatar.propTypes =
  {
    size:
      PropTypes.number,
  };

// ============================================================================
// Export
// ============================================================================

export default memo(
  Skeleton
);