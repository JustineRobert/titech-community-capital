/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/index.js
 *
 * Purpose:
 *   Canonical public API / barrel for the TITech charting subsystem.
 *
 * Architectural principles:
 *   - Presentation layer only.
 *   - Chart components MUST NOT mutate authoritative financial state.
 *   - Chart calculations are presentation analytics unless explicitly supplied
 *     as authoritative backend values.
 *   - Financial balances, ledger state, settlements, reconciliations and
 *     transaction state remain backend/domain responsibilities.
 *   - No authentication, authorization, tenancy or persistence side effects.
 *   - Prefer named imports from this file.
 *   - Secondary/module-specific APIs remain available through namespaces.
 *
 * Branding:
 *   - TITech is the canonical product identity.
 *   - Legacy TITech terminology MUST NOT be introduced here.
 *
 * Design goals:
 *   - Stable frontend import contract.
 *   - Explicit public API.
 *   - Collision-resistant namespace exports.
 *   - Immutable component registry and metadata.
 *   - No development-time console side effects.
 *   - Easy automated contract testing.
 * ============================================================================
 */

/* ============================================================================
 * Chart module imports
 * ========================================================================== */

import {
  ChartContainer,
  ChartEmptyState,
  ChartErrorState,
  ChartLoadingState,
  ChartStatusBadge,
} from './ChartContainer.jsx';

import {
  ChartExportButton,
  buildCsv,
  buildJson,
  escapeCsvCell,
  normalizeRows,
  sanitizeFilename,
  withExtension,
} from './ChartExportButton.jsx';

import ChartFilters from './ChartFilters.jsx';

import {
  ChartLegend,
  LegendItem,
  LegendSeriesIcon,
  LegendStatus,
} from './ChartLegend.jsx';

import ChartLoadingSkeleton from './ChartLoadingSkeleton.jsx';
import ChartTooltip from './ChartTooltip.jsx';

import CollectionPerformanceChart from './CollectionPerformanceChart.jsx';
import DonutChartCard from './DonutChartCard.jsx';
import ExecutiveKPIChart from './ExecutiveKPIChart.jsx';
import FinancialTrendChart from './FinancialTrendChart.jsx';
import FraudAnalyticsChart from './FraudAnalyticsChart.jsx';

/* ============================================================================
 * Canonical named exports
 *
 * Keep this section explicit. It defines the supported public API and avoids
 * accidentally exposing implementation details from individual modules.
 * ========================================================================== */

export {
  ChartContainer,
  ChartEmptyState,
  ChartErrorState,
  ChartLoadingState,
  ChartStatusBadge,
};

export {
  ChartExportButton,
  buildCsv,
  buildJson,
  escapeCsvCell,
  normalizeRows,
  sanitizeFilename,
  withExtension,
};

export { ChartFilters };

export {
  ChartLegend,
  LegendItem,
  LegendSeriesIcon,
  LegendStatus,
};

export {
  ChartLoadingSkeleton,
  ChartTooltip,
};

export {
  CollectionPerformanceChart,
  DonutChartCard,
  ExecutiveKPIChart,
  FinancialTrendChart,
  FraudAnalyticsChart,
};

/* ============================================================================
 * Collision-safe module namespaces
 *
 * Namespace exports provide advanced access to module-specific APIs without
 * flattening every helper into this barrel's top-level namespace.
 * ========================================================================== */

export * as ChartContainerModule from './ChartContainer.jsx';

export * as ChartExportModule from './ChartExportButton.jsx';

export * as ChartFiltersModule from './ChartFilters.jsx';

export * as ChartLegendModule from './ChartLegend.jsx';

export * as ChartLoadingSkeletonModule from './ChartLoadingSkeleton.jsx';

export * as ChartTooltipModule from './ChartTooltip.jsx';

export * as CollectionPerformanceModule from './CollectionPerformanceChart.jsx';

export * as DonutChartModule from './DonutChartCard.jsx';

export * as ExecutiveKPIModule from './ExecutiveKPIChart.jsx';

export * as FinancialTrendModule from './FinancialTrendChart.jsx';

export * as FraudAnalyticsModule from './FraudAnalyticsChart.jsx';

/* ============================================================================
 * Internal normalization helper
 * ========================================================================== */

/**
 * Normalize a public chart name.
 *
 * @param {unknown} name
 * @returns {string}
 */
function normalizeChartName(name) {
  return typeof name === 'string' ? name.trim() : '';
}

/**
 * Determine whether an object has an own property without depending on
 * potentially shadowed object methods.
 *
 * @param {object} object
 * @param {string} property
 * @returns {boolean}
 */
function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

/* ============================================================================
 * Public chart registry
 *
 * The registry contains only primary presentation components. Supporting
 * helpers and implementation details are intentionally excluded.
 *
 * Object.freeze prevents accidental runtime mutation of the registry.
 * ========================================================================== */

export const CHART_COMPONENTS = Object.freeze({
  ChartContainer,
  ChartExportButton,
  ChartFilters,
  ChartLegend,
  ChartLoadingSkeleton,
  ChartTooltip,
  CollectionPerformanceChart,
  DonutChartCard,
  ExecutiveKPIChart,
  FinancialTrendChart,
  FraudAnalyticsChart,
});

export const CHART_COMPONENT_NAMES = Object.freeze(
  Object.keys(CHART_COMPONENTS),
);

/* ============================================================================
 * Public chart categories
 * ========================================================================== */

export const CHART_CATEGORIES = Object.freeze({
  CORE: 'core',
  REPORTING: 'reporting',
  OPERATIONS: 'operations',
  FINANCIAL: 'financial',
  RISK: 'risk',
});

/* ============================================================================
 * Public chart metadata
 *
 * Metadata is descriptive only. It does not define:
 *   - accounting authority,
 *   - financial balances,
 *   - fraud decisions,
 *   - transaction status,
 *   - reconciliation state,
 *   - authorization,
 *   - tenancy,
 *   - persistence behavior.
 * ========================================================================== */

export const CHART_DEFINITIONS = Object.freeze({
  ChartContainer: Object.freeze({
    category: CHART_CATEGORIES.CORE,
    purpose: 'Canonical chart presentation shell.',
  }),

  ChartExportButton: Object.freeze({
    category: CHART_CATEGORIES.REPORTING,
    purpose: 'Controlled chart data and visual export actions.',
  }),

  ChartFilters: Object.freeze({
    category: CHART_CATEGORIES.REPORTING,
    purpose: 'Shared reporting and chart filtering controls.',
  }),

  ChartLegend: Object.freeze({
    category: CHART_CATEGORIES.CORE,
    purpose: 'Accessible and interactive chart legend.',
  }),

  ChartLoadingSkeleton: Object.freeze({
    category: CHART_CATEGORIES.CORE,
    purpose: 'Consistent loading presentation for chart surfaces.',
  }),

  ChartTooltip: Object.freeze({
    category: CHART_CATEGORIES.CORE,
    purpose: 'Consistent financial and analytical chart tooltips.',
  }),

  CollectionPerformanceChart: Object.freeze({
    category: CHART_CATEGORIES.OPERATIONS,
    purpose: 'Collection target and performance analytics.',
  }),

  DonutChartCard: Object.freeze({
    category: CHART_CATEGORIES.REPORTING,
    purpose: 'Category and composition distribution analytics.',
  }),

  ExecutiveKPIChart: Object.freeze({
    category: CHART_CATEGORIES.REPORTING,
    purpose: 'Executive KPI and trend presentation.',
  }),

  FinancialTrendChart: Object.freeze({
    category: CHART_CATEGORIES.FINANCIAL,
    purpose: 'Financial trend and time-series presentation.',
  }),

  FraudAnalyticsChart: Object.freeze({
    category: CHART_CATEGORIES.RISK,
    purpose:
      'Presentation of fraud-related signals and confirmed outcomes supplied by authoritative systems.',
  }),
});

/* ============================================================================
 * Public chart API contract
 * ========================================================================== */

/**
 * Determine whether a value can be used as a chart component.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isChartComponent(value) {
  return typeof value === 'function';
}

/**
 * Determine whether a chart name is publicly registered.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export function isChartComponentName(name) {
  const normalizedName = normalizeChartName(name);

  return (
    normalizedName.length > 0 &&
    hasOwn(CHART_COMPONENTS, normalizedName)
  );
}

/**
 * Return a registered chart component by canonical name.
 *
 * Unknown, empty or invalid names return null.
 *
 * @param {unknown} name
 * @returns {import('react').ComponentType|null}
 */
export function getChartComponent(name) {
  const normalizedName = normalizeChartName(name);

  if (!normalizedName || !hasOwn(CHART_COMPONENTS, normalizedName)) {
    return null;
  }

  return CHART_COMPONENTS[normalizedName] ?? null;
}

/**
 * Test whether a chart component is registered.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export function hasChartComponent(name) {
  return isChartComponentName(name);
}

/**
 * Return immutable metadata for a registered chart.
 *
 * @param {unknown} name
 * @returns {{category: string, purpose: string}|null}
 */
export function getChartDefinition(name) {
  const normalizedName = normalizeChartName(name);

  if (!normalizedName || !hasOwn(CHART_DEFINITIONS, normalizedName)) {
    return null;
  }

  return CHART_DEFINITIONS[normalizedName] ?? null;
}

/**
 * Return the canonical names of all publicly registered chart components.
 *
 * A fresh array is returned so callers cannot mutate the exported registry.
 *
 * @returns {string[]}
 */
export function listChartComponents() {
  return [...CHART_COMPONENT_NAMES];
}

/**
 * Return all registered chart definitions.
 *
 * A fresh object is returned to prevent consumers from mutating the exported
 * metadata object.
 *
 * @returns {Record<string, {category: string, purpose: string}>}
 */
export function listChartDefinitions() {
  return Object.fromEntries(
    CHART_COMPONENT_NAMES
      .map((name) => [name, CHART_DEFINITIONS[name]])
      .filter(([, definition]) => definition != null),
  );
}

/**
 * Get the public category assigned to a registered chart.
 *
 * @param {unknown} name
 * @returns {string|null}
 */
export function getChartCategory(name) {
  return getChartDefinition(name)?.category ?? null;
}

/* ============================================================================
 * Public registry contract validation
 *
 * Validation is explicit and side-effect free. This can be consumed by unit
 * tests, diagnostics, health checks or development tooling without producing
 * browser console noise during normal application startup.
 * ========================================================================== */

/**
 * Validate that every registered chart:
 *   1. is a callable component,
 *   2. has metadata,
 *   3. uses a recognized category,
 *   4. has a non-empty purpose.
 *
 * @returns {{
 *   valid: boolean,
 *   invalidComponents: string[],
 *   missingDefinitions: string[],
 *   invalidCategories: string[],
 *   invalidPurposes: string[],
 * }}
 */
export function validateChartRegistry() {
  const invalidComponents = CHART_COMPONENT_NAMES.filter(
    (name) => !isChartComponent(CHART_COMPONENTS[name]),
  );

  const missingDefinitions = CHART_COMPONENT_NAMES.filter(
    (name) => !hasOwn(CHART_DEFINITIONS, name),
  );

  const validCategories = new Set(Object.values(CHART_CATEGORIES));

  const invalidCategories = CHART_COMPONENT_NAMES.filter((name) => {
    const definition = CHART_DEFINITIONS[name];

    return (
      definition != null &&
      !validCategories.has(definition.category)
    );
  });

  const invalidPurposes = CHART_COMPONENT_NAMES.filter((name) => {
    const definition = CHART_DEFINITIONS[name];

    return (
      definition != null &&
      (typeof definition.purpose !== 'string' ||
        definition.purpose.trim().length === 0)
    );
  });

  const valid =
    invalidComponents.length === 0 &&
    missingDefinitions.length === 0 &&
    invalidCategories.length === 0 &&
    invalidPurposes.length === 0;

  return Object.freeze({
    valid,
    invalidComponents: Object.freeze([...invalidComponents]),
    missingDefinitions: Object.freeze([...missingDefinitions]),
    invalidCategories: Object.freeze([...invalidCategories]),
    invalidPurposes: Object.freeze([...invalidPurposes]),
  });
}

/**
 * Snapshot of the registry contract at module load time.
 *
 * This is intentionally data-only and has no console or runtime side effects.
 */
export const CHART_REGISTRY_VALIDATION = validateChartRegistry();

/**
 * Fail-fast contract assertion for automated tests or controlled development
 * tooling.
 *
 * This function does not run automatically during application startup.
 *
 * @returns {true}
 * @throws {Error} when the public chart registry is invalid.
 */
export function assertValidChartRegistry() {
  if (CHART_REGISTRY_VALIDATION.valid) {
    return true;
  }

  const details = [
    ...CHART_REGISTRY_VALIDATION.invalidComponents.map(
      (name) => `invalid component: ${name}`,
    ),
    ...CHART_REGISTRY_VALIDATION.missingDefinitions.map(
      (name) => `missing definition: ${name}`,
    ),
    ...CHART_REGISTRY_VALIDATION.invalidCategories.map(
      (name) => `invalid category: ${name}`,
    ),
    ...CHART_REGISTRY_VALIDATION.invalidPurposes.map(
      (name) => `invalid purpose: ${name}`,
    ),
  ];

  throw new Error(
    `[TITech Charts] Invalid public chart registry contract.\n${details.join(
      '\n',
    )}`,
  );
}

/* ============================================================================
 * Public constants
 * ========================================================================== */

export const TITech_CHARTS_NAMESPACE = 'TITechCharts';
export const TITech_CHARTS_API_VERSION = '1.0.0';