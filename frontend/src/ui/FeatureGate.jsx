// ============================================================================
// TITech Community Capital
// Enterprise FeatureGate Component
// File: src/components/ui/FeatureGate.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";

// ============================================================================
// Feature Helpers
// ============================================================================

function normalizeArray(
  value
) {
  if (!value) {
    return [];
  }

  return Array.isArray(
    value
  )
    ? value
    : [value];
}

function hasFeature(
  enabledFeatures,
  feature
) {
  return enabledFeatures.includes(
    feature
  );
}

function hasAnyFeature(
  enabledFeatures,
  required
) {
  if (!required.length) {
    return true;
  }

  return required.some(
    (feature) =>
      hasFeature(
        enabledFeatures,
        feature
      )
  );
}

function hasAllFeatures(
  enabledFeatures,
  required
) {
  if (!required.length) {
    return true;
  }

  return required.every(
    (feature) =>
      hasFeature(
        enabledFeatures,
        feature
      )
  );
}

// ============================================================================
// Component
// ============================================================================

function FeatureGate({
  features,
  enabledFeatures = [],
  requireAll = false,
  fallback = null,
  loading = false,
  loadingComponent = null,
  children,
}) {
  const requiredFeatures =
    useMemo(
      () =>
        normalizeArray(
          features
        ),
      [features]
    );

  const featureEnabled =
    useMemo(() => {
      if (
        requireAll
      ) {
        return hasAllFeatures(
          enabledFeatures,
          requiredFeatures
        );
      }

      return hasAnyFeature(
        enabledFeatures,
        requiredFeatures
      );
    }, [
      enabledFeatures,
      requiredFeatures,
      requireAll,
    ]);

  // ===========================================================================
  // Loading State
  // ===========================================================================

  if (loading) {
    return (
      loadingComponent
    );
  }

  // ===========================================================================
  // Feature Disabled
  // ===========================================================================

  if (!featureEnabled) {
    return fallback;
  }

  // ===========================================================================
  // Render
  // ===========================================================================

  return children;
}

// ============================================================================
// Hook
// ============================================================================

export function useFeature(
  feature,
  enabledFeatures = []
) {
  return hasFeature(
    enabledFeatures,
    feature
  );
}

export function useFeatures(
  features = [],
  enabledFeatures = [],
  options = {}
) {
  const {
    requireAll =
      false,
  } = options;

  const required =
    normalizeArray(
      features
    );

  return requireAll
    ? hasAllFeatures(
        enabledFeatures,
        required
      )
    : hasAnyFeature(
        enabledFeatures,
        required
      );
}

// ============================================================================
// PropTypes
// ============================================================================

FeatureGate.propTypes =
  {
    features:
      PropTypes.oneOfType(
        [
          PropTypes.string,
          PropTypes.arrayOf(
            PropTypes.string
          ),
        ]
      )
        .isRequired,

    enabledFeatures:
      PropTypes.arrayOf(
        PropTypes.string
      ),

    requireAll:
      PropTypes.bool,

    fallback:
      PropTypes.node,

    loading:
      PropTypes.bool,

    loadingComponent:
      PropTypes.node,

    children:
      PropTypes.node
        .isRequired,
  };

// ============================================================================
// Export
// ============================================================================

export default memo(
  FeatureGate
);