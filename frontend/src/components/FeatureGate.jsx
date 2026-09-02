'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Feature Gate
 * ============================================================================
 *
 * File:
 *   frontend/src/components/FeatureGate.jsx
 *
 * Purpose:
 *   Production-grade feature-flag / entitlement presentation boundary for
 *   TITech frontend applications.
 *
 * Capabilities
 * ----------------------------------------------------------------------------
 * ✓ Feature registry
 * ✓ Single-feature checks
 * ✓ Multi-feature checks
 * ✓ requireAll / requireAny semantics
 * ✓ Inverted gates
 * ✓ Loading state support
 * ✓ Tenant-aware context
 * ✓ Environment awareness
 * ✓ Safe normalization
 * ✓ Duplicate feature elimination
 * ✓ Declarative fallback rendering
 * ✓ Allow / deny lifecycle callbacks
 * ✓ Optional development audit diagnostics
 * ✓ Static utility helpers
 * ✓ Feature filtering
 * ✓ HOC support
 * ✓ React.memo optimization
 * ✓ Stable display names
 * ✓ PropTypes validation
 * ✓ Defensive malformed-input handling
 * ✓ Accessibility-friendly presentation hooks
 * ✓ TITech branding consistency
 *
 * SECURITY BOUNDARY
 * ----------------------------------------------------------------------------
 * FeatureGate is a UI presentation mechanism.
 *
 * It MUST NOT be used as:
 *   - an authorization boundary
 *   - a tenant-isolation boundary
 *   - a financial security control
 *   - an API security mechanism
 *   - an entitlement enforcement mechanism on the backend
 *
 * Backend APIs MUST independently validate:
 *   authentication
 *   authorization
 *   tenant isolation
 *   licensing / entitlements
 *   financial permissions
 *   regulatory permissions
 *
 * ============================================================================
 */

import React, {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import PropTypes from 'prop-types';

/* ============================================================================
 * Constants
 * ========================================================================== */

export const FEATURES = Object.freeze({
  DASHBOARD: 'dashboard',
  MEMBERS: 'members',
  SAVINGS: 'savings',
  LOANS: 'loans',
  TRANSACTIONS: 'transactions',
  REPORTS: 'reports',
  BILLING: 'billing',
  KYC: 'kyc',
  AML: 'aml',
  USSD: 'ussd',
  MOBILE_MONEY: 'mobile_money',
  TREASURY: 'treasury',
  EXECUTIVE_DASHBOARD: 'executive_dashboard',
  FRAUD_DETECTION: 'fraud_detection',
  REGULATORY_REPORTING: 'regulatory_reporting',
  TENANT_MANAGEMENT: 'tenant_management',
  API_ACCESS: 'api_access',
});

export const FEATURE_GATE_STATES = Object.freeze({
  LOADING: 'loading',
  ALLOWED: 'allowed',
  DENIED: 'denied',
});

const DEFAULT_ENVIRONMENT =
  typeof process !== 'undefined' &&
  process?.env?.NODE_ENV
    ? process.env.NODE_ENV
    : 'production';

const DEVELOPMENT_ENVIRONMENT = 'development';

const EMPTY_FEATURES = Object.freeze([]);

const DEFAULT_FEATURE_CONTEXT = Object.freeze({
  features: EMPTY_FEATURES,
  loading: false,
  tenantId: null,
  environment: DEFAULT_ENVIRONMENT,
});

/* ============================================================================
 * Utility Helpers
 * ========================================================================== */

/**
 * Safely normalize a feature identifier.
 *
 * Feature identifiers are intentionally normalized to lowercase strings so
 * that values coming from configuration, APIs, or local state remain
 * consistent.
 */
export function normalizeFeature(feature) {
  if (
    feature === null ||
    feature === undefined
  ) {
    return '';
  }

  try {
    return String(feature)
      .trim()
      .toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Convert a feature input into an array.
 */
export function toFeatureArray(features) {
  if (
    features === null ||
    features === undefined
  ) {
    return [];
  }

  if (Array.isArray(features)) {
    return features;
  }

  return [features];
}

/**
 * Normalize and deduplicate a feature collection.
 */
export function normalizeFeatures(features) {
  return Array.from(
    new Set(
      toFeatureArray(features)
        .map(normalizeFeature)
        .filter(Boolean),
    ),
  );
}

/**
 * Determine whether a feature collection contains a feature.
 */
export function hasFeature(
  feature,
  enabledFeatures = EMPTY_FEATURES,
) {
  const normalizedFeature =
    normalizeFeature(feature);

  if (!normalizedFeature) {
    return false;
  }

  return normalizeFeatures(
    enabledFeatures,
  ).includes(normalizedFeature);
}

/**
 * Determine whether a collection satisfies a feature requirement.
 */
export function hasFeatures(
  features,
  enabledFeatures = EMPTY_FEATURES,
  options = {},
) {
  const requested =
    normalizeFeatures(features);

  const available =
    normalizeFeatures(
      enabledFeatures,
    );

  const requireAll =
    options?.requireAll === true;

  /*
   * An empty requirement represents no feature restriction.
   *
   * This is useful for reusable components/HOCs where the feature condition
   * may be configured dynamically.
   */
  if (requested.length === 0) {
    return true;
  }

  if (requireAll) {
    return requested.every(
      (feature) =>
        available.includes(feature),
    );
  }

  return requested.some(
    (feature) =>
      available.includes(feature),
  );
}

/**
 * Safely obtain the current runtime environment.
 */
export function getEnvironment() {
  return DEFAULT_ENVIRONMENT;
}

/**
 * Development-only diagnostic logging.
 *
 * Production environments intentionally do not expose audit payloads through
 * console output.
 */
function developmentLog(
  ...args
) {
  if (
    getEnvironment() ===
    DEVELOPMENT_ENVIRONMENT
  ) {
    // eslint-disable-next-line no-console
    console.debug(...args);
  }
}

/* ============================================================================
 * Context
 * ========================================================================== */

export const FeatureContext =
  createContext(
    DEFAULT_FEATURE_CONTEXT,
  );

/* ============================================================================
 * Feature Provider
 * ========================================================================== */

/**
 * FeatureProvider
 *
 * Central feature configuration provider.
 *
 * Example:
 *
 * <FeatureProvider
 *   tenantId={tenant.id}
 *   features={[
 *     FEATURES.DASHBOARD,
 *     FEATURES.SAVINGS,
 *   ]}
 * >
 *   <App />
 * </FeatureProvider>
 */
export function FeatureProvider({
  children,
  features = EMPTY_FEATURES,
  tenantId = null,
  loading = false,
  environment = getEnvironment(),
}) {
  const normalizedFeatures =
    useMemo(
      () =>
        normalizeFeatures(
          features,
        ),
      [features],
    );

  const normalizedTenantId =
    useMemo(() => {
      if (
        tenantId === null ||
        tenantId === undefined
      ) {
        return null;
      }

      try {
        const value =
          String(
            tenantId,
          ).trim();

        return value || null;
      } catch {
        return null;
      }
    }, [tenantId]);

  const normalizedEnvironment =
    useMemo(() => {
      try {
        return (
          String(
            environment ||
              getEnvironment(),
          ).trim() ||
          getEnvironment()
        );
      } catch {
        return getEnvironment();
      }
    }, [environment]);

  const value =
    useMemo(
      () => ({
        features:
          normalizedFeatures,

        loading:
          Boolean(loading),

        tenantId:
          normalizedTenantId,

        environment:
          normalizedEnvironment,
      }),
      [
        normalizedFeatures,
        loading,
        normalizedTenantId,
        normalizedEnvironment,
      ],
    );

  return (
    <FeatureContext.Provider
      value={value}
    >
      {children}
    </FeatureContext.Provider>
  );
}

FeatureProvider.propTypes = {
  children:
    PropTypes.node.isRequired,

  features:
    PropTypes.oneOfType([
      PropTypes.arrayOf(
        PropTypes.string,
      ),
      PropTypes.string,
    ]),

  tenantId:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  loading:
    PropTypes.bool,

  environment:
    PropTypes.string,
};

FeatureProvider.defaultProps = {
  features:
    EMPTY_FEATURES,

  tenantId:
    null,

  loading:
    false,

  environment:
    getEnvironment(),
};

/* ============================================================================
 * Context Hook
 * ========================================================================== */

export function useFeatureContext() {
  return useContext(
    FeatureContext,
  );
}

/* ============================================================================
 * Feature Hooks
 * ========================================================================== */

/**
 * Check one feature.
 */
export function useFeature(
  feature,
  enabledFeatures,
) {
  const context =
    useFeatureContext();

  const available =
    enabledFeatures !==
    undefined
      ? enabledFeatures
      : context.features;

  return useMemo(
    () =>
      hasFeature(
        feature,
        available,
      ),
    [
      feature,
      available,
    ],
  );
}

/**
 * Check one or more features.
 *
 * By default:
 *   ANY requested feature must be enabled.
 *
 * With requireAll=true:
 *   ALL requested features must be enabled.
 */
export function useFeatures(
  features,
  enabledFeatures,
  options = {},
) {
  const context =
    useFeatureContext();

  const available =
    enabledFeatures !==
    undefined
      ? enabledFeatures
      : context.features;

  const requireAll =
    options?.requireAll === true;

  return useMemo(
    () =>
      hasFeatures(
        features,
        available,
        {
          requireAll,
        },
      ),
    [
      features,
      available,
      requireAll,
    ],
  );
}

/* ============================================================================
 * Main Feature Gate
 * ========================================================================== */

function FeatureGate({
  children,
  features,
  enabledFeatures,
  requireAll = false,
  fallback = null,
  loadingComponent = null,
  invert = false,
  onAllow,
  onDeny,
  audit = false,
  className = '',
  testId = 'titech-feature-gate',
  ...rest
}) {
  const context =
    useFeatureContext();

  const previousState =
    useRef(null);

  const availableFeatures =
    enabledFeatures !==
    undefined
      ? enabledFeatures
      : context.features;

  const allowed =
    useFeatures(
      features,
      availableFeatures,
      {
        requireAll,
      },
    );

  const finalResult =
    invert
      ? !allowed
      : allowed;

  const state =
    context.loading
      ? FEATURE_GATE_STATES.LOADING
      : finalResult
        ? FEATURE_GATE_STATES.ALLOWED
        : FEATURE_GATE_STATES.DENIED;

  const normalizedRequestedFeatures =
    useMemo(
      () =>
        normalizeFeatures(
          features,
        ),
      [features],
    );

  const invokeCallback =
    useCallback(
      async (
        callback,
      ) => {
        if (
          typeof callback !==
          'function'
        ) {
          return;
        }

        try {
          await callback({
            features:
              normalizedRequestedFeatures,

            allowed:
              finalResult,

            state,

            tenantId:
              context.tenantId,

            environment:
              context.environment,
          });
        } catch (callbackError) {
          /*
           * Feature callbacks are observability / presentation hooks.
           *
           * They must never break rendering of the gated component.
           */
          developmentLog(
            '[TITech FeatureGate] callback failed',
            callbackError,
          );
        }
      },
      [
        normalizedRequestedFeatures,
        finalResult,
        state,
        context.tenantId,
        context.environment,
      ],
    );

  /* ==========================================================================
   * Lifecycle / Audit
   * ======================================================================== */

  useEffect(() => {
    if (
      previousState.current ===
      state
    ) {
      return;
    }

    previousState.current =
      state;

    /*
     * Do not fire allow/deny callbacks while feature configuration is still
     * loading. This prevents transient deny events during application startup.
     */
    if (
      state ===
      FEATURE_GATE_STATES.LOADING
    ) {
      return;
    }

    if (finalResult) {
      void invokeCallback(
        onAllow,
      );
    } else {
      void invokeCallback(
        onDeny,
      );
    }

    if (audit) {
      developmentLog(
        '[TITech FeatureGate]',
        {
          state,
          allowed:
            finalResult,
          features:
            normalizedRequestedFeatures,
          tenantId:
            context.tenantId,
          environment:
            context.environment,
          timestamp:
            new Date().toISOString(),
        },
      );
    }
  }, [
    state,
    finalResult,
    invokeCallback,
    onAllow,
    onDeny,
    audit,
    normalizedRequestedFeatures,
    context.tenantId,
    context.environment,
  ]);

  /* ==========================================================================
   * Loading
   * ======================================================================== */

  if (
    context.loading
  ) {
    return (
      <div
        {...rest}
        className={className || undefined}
        data-testid={`${testId}-loading`}
        data-feature-state={
          FEATURE_GATE_STATES.LOADING
        }
        aria-busy="true"
        aria-live="polite"
      >
        {loadingComponent}
      </div>
    );
  }

  /* ==========================================================================
   * Denied
   * ======================================================================== */

  if (!finalResult) {
    return (
      <div
        {...rest}
        className={className || undefined}
        data-testid={`${testId}-denied`}
        data-feature-state={
          FEATURE_GATE_STATES.DENIED
        }
      >
        {fallback}
      </div>
    );
  }

  /* ==========================================================================
   * Allowed
   * ======================================================================== */

  return (
    <div
      {...rest}
      className={className || undefined}
      data-testid={testId}
      data-feature-state={
        FEATURE_GATE_STATES.ALLOWED
      }
    >
      {children}
    </div>
  );
}

FeatureGate.displayName =
  'TITechFeatureGate';

/* ============================================================================
 * Static Enterprise Utilities
 * ========================================================================== */

FeatureGate.hasFeature =
  hasFeature;

FeatureGate.hasFeatures =
  hasFeatures;

FeatureGate.normalize =
  normalizeFeature;

FeatureGate.normalizeFeatures =
  normalizeFeatures;

FeatureGate.filter =
  (
    items = [],
    featureKey = 'feature',
    enabledFeatures = EMPTY_FEATURES,
  ) => {
    if (
      !Array.isArray(items)
    ) {
      return [];
    }

    return items.filter(
      (item) => {
        if (
          !item ||
          typeof item !==
            'object'
        ) {
          return false;
        }

        const requiredFeature =
          item[
            featureKey
          ];

        /*
         * Items without a feature requirement remain visible.
         */
        if (
          requiredFeature ===
            undefined ||
          requiredFeature ===
            null ||
          requiredFeature ===
            ''
        ) {
          return true;
        }

        return hasFeature(
          requiredFeature,
          enabledFeatures,
        );
      },
    );
  };

FeatureGate.registry =
  FEATURES;

FeatureGate.states =
  FEATURE_GATE_STATES;

/* ============================================================================
 * Higher-Order Component
 * ========================================================================== */

/**
 * Wrap a component with a feature requirement.
 *
 * Example:
 *
 * export default withFeature(
 *   SavingsDashboard,
 *   {
 *     features: FEATURES.SAVINGS,
 *   },
 * );
 */
export function withFeature(
  WrappedComponent,
  options = {},
) {
  if (
    typeof WrappedComponent !==
    'function'
  ) {
    throw new TypeError(
      'withFeature requires a valid React component.',
    );
  }

  const {
    features,
    requireAll = false,
    fallback = null,
    loadingComponent = null,
    invert = false,
    enabledFeatures,
  } = options;

  function FeatureWrappedComponent(
    props,
  ) {
    return (
      <FeatureGate
        features={
          features
        }
        enabledFeatures={
          enabledFeatures
        }
        requireAll={
          requireAll
        }
        fallback={
          fallback
        }
        loadingComponent={
          loadingComponent
        }
        invert={
          invert
        }
      >
        <WrappedComponent
          {...props}
        />
      </FeatureGate>
    );
  }

  const wrappedName =
    WrappedComponent.displayName ||
    WrappedComponent.name ||
    'Component';

  FeatureWrappedComponent.displayName =
    `withFeature(${wrappedName})`;

  return memo(
    FeatureWrappedComponent,
  );
}

/* ============================================================================
 * PropTypes
 * ========================================================================== */

FeatureGate.propTypes = {
  children:
    PropTypes.node,

  features:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string,
      ),
    ]).isRequired,

  enabledFeatures:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.arrayOf(
        PropTypes.string,
      ),
    ]),

  requireAll:
    PropTypes.bool,

  fallback:
    PropTypes.node,

  loadingComponent:
    PropTypes.node,

  invert:
    PropTypes.bool,

  onAllow:
    PropTypes.func,

  onDeny:
    PropTypes.func,

  audit:
    PropTypes.bool,

  className:
    PropTypes.string,

  testId:
    PropTypes.string,
};

/* ============================================================================
 * Default Props
 * ========================================================================== */

FeatureGate.defaultProps = {
  children:
    null,

  enabledFeatures:
    undefined,

  requireAll:
    false,

  fallback:
    null,

  loadingComponent:
    null,

  invert:
    false,

  onAllow:
    undefined,

  onDeny:
    undefined,

  audit:
    false,

  className:
    '',

  testId:
    'titech-feature-gate',
};

/* ============================================================================
 * Public Exports
 * ========================================================================== */

export {
  FeatureGate,
};

/* ============================================================================
 * Default Export
 * ========================================================================== */

export default memo(
  FeatureGate,
);