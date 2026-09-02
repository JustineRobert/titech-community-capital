"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * ============================================================================
 *
 * Enterprise UI Component Registry & Barrel Export
 *
 * File:
 *   frontend/src/components/ui/index.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Centralized public API for TITech enterprise UI components.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 * ✓ Centralized component exports
 * ✓ Enterprise component registry
 * ✓ Dynamic component discovery
 * ✓ Feature/permission utility exports
 * ✓ UI version metadata
 * ✓ Build metadata
 * ✓ Immutable registry definitions
 * ✓ Consistent TITech naming
 * ✓ Safe integration with React applications
 * ✓ Suitable for observability and diagnostics
 * ✓ Suitable for future design-system governance
 *
 * Architecture:
 * ----------------------------------------------------------------------------
 *
 *   Components
 *       │
 *       ▼
 *   UI Barrel
 *       │
 *       ├── Core UI
 *       ├── Layout
 *       ├── Data Display
 *       ├── Navigation
 *       ├── Feedback
 *       ├── Financial
 *       ├── Forms
 *       ├── Enterprise Widgets
 *       ├── Authorization
 *       └── React Utilities
 *              │
 *              ▼
 *       Component Registry
 *
 * Naming Standard:
 * ----------------------------------------------------------------------------
 * TITech Community Capital LTD
 *
 * Do not introduce ACFOS branding into frontend component identifiers,
 * metadata, user-facing labels, or registry names.
 *
 * ============================================================================
 */

// ============================================================================
// Core UI Components
// ============================================================================

export { default as Button } from "./Button";
export { default as Card } from "./Card";
export { default as Modal } from "./Modal";
export { default as Input } from "./Input";
export { default as Select } from "./Select";
export { default as TextArea } from "./TextArea";
export { default as Checkbox } from "./Checkbox";
export { default as Radio } from "./Radio";
export { default as Switch } from "./Switch";
export { default as Badge } from "./Badge";
export { default as Avatar } from "./Avatar";
export { default as Tooltip } from "./Tooltip";
export { default as Divider } from "./Divider";

// ============================================================================
// Layout Components
// ============================================================================

export { default as PageHeader } from "./PageHeader";
export { default as StatCard } from "./StatCard";
export { default as LoadingScreen } from "./LoadingScreen";
export { default as Skeleton } from "./Skeleton";
export { default as EmptyState } from "./EmptyState";
export { default as Drawer } from "./Drawer";
export { default as Sidebar } from "./Sidebar";
export { default as PageContainer } from "./PageContainer";
export { default as DashboardGrid } from "./DashboardGrid";

// ============================================================================
// Data Display Components
// ============================================================================

export { default as Table } from "./Table";
export { default as DataTable } from "./DataTable";
export { default as Tabs } from "./Tabs";
export { default as Accordion } from "./Accordion";
export { default as Timeline } from "./Timeline";
export { default as ProgressBar } from "./ProgressBar";
export { default as MetricCard } from "./MetricCard";
export { default as ChartCard } from "./ChartCard";

// ============================================================================
// Navigation & User Experience
// ============================================================================

export { default as NotificationBell } from "./NotificationBell";
export { default as UserMenu } from "./UserMenu";
export { default as TenantSwitcher } from "./TenantSwitcher";
export { default as SearchBox } from "./SearchBox";
export { default as Pagination } from "./Pagination";
export { default as Breadcrumbs } from "./Breadcrumbs";
export { default as CommandPalette } from "./CommandPalette";

// ============================================================================
// Feedback & Status
// ============================================================================

export { default as StatusBadge } from "./StatusBadge";
export { default as Alert } from "./Alert";
export { default as Toast } from "./Toast";
export { default as Spinner } from "./Spinner";
export { default as ConfirmDialog } from "./ConfirmDialog";

// ============================================================================
// Financial Components
// ============================================================================

export { default as CurrencyInput } from "./CurrencyInput";
export { default as CurrencyDisplay } from "./CurrencyDisplay";
export { default as MobileMoneyBadge } from "./MobileMoneyBadge";
export { default as TransactionStatus } from "./TransactionStatus";
export { default as LoanStatusBadge } from "./LoanStatusBadge";
export { default as SavingsCard } from "./SavingsCard";

// ============================================================================
// Form Components
// ============================================================================

export { default as DatePicker } from "./DatePicker";
export { default as PhoneInput } from "./PhoneInput";
export { default as OTPInput } from "./OTPInput";
export { default as FileUploader } from "./FileUploader";
export { default as Stepper } from "./Stepper";

// ============================================================================
// Enterprise Widgets
// ============================================================================

export { default as FraudAlertWidget } from "./FraudAlertWidget";
export { default as ComplianceWidget } from "./ComplianceWidget";
export { default as RegulatoryWidget } from "./RegulatoryWidget";
export { default as ExecutiveWidget } from "./ExecutiveWidget";
export { default as MobileMoneyWidget } from "./MobileMoneyWidget";
export { default as TenantCard } from "./TenantCard";
export { default as AuditLogTable } from "./AuditLogTable";

// ============================================================================
// Authorization & Feature Management
// ============================================================================

export {
  default as PermissionGate,
  usePermission,
  usePermissions,
  useRole,
} from "./PermissionGate";

export {
  default as FeatureGate,
  useFeature,
  useFeatures,
} from "./FeatureGate";

// ============================================================================
// React Utilities
// ============================================================================

export { default as ErrorBoundary } from "./ErrorBoundary";

export { default as SuspenseLoader } from "./SuspenseLoader";

// ============================================================================
// UI Component Names
// ============================================================================
//
// These names form the stable public registry identifiers used by:
//
// ✓ Dynamic rendering
// ✓ Telemetry
// ✓ Feature configuration
// ✓ UI diagnostics
// ✓ Permission-aware rendering
// ✓ Enterprise dashboards
// ✓ Future design-system tooling
//
// Keep these identifiers stable once consumed by application code.
//

export const UI_COMPONENTS = Object.freeze({
  // Core
  Button: "Button",
  Card: "Card",
  Modal: "Modal",
  Input: "Input",
  Select: "Select",
  TextArea: "TextArea",
  Checkbox: "Checkbox",
  Radio: "Radio",
  Switch: "Switch",
  Badge: "Badge",
  Avatar: "Avatar",
  Tooltip: "Tooltip",
  Divider: "Divider",

  // Layout
  PageHeader: "PageHeader",
  StatCard: "StatCard",
  LoadingScreen: "LoadingScreen",
  Skeleton: "Skeleton",
  EmptyState: "EmptyState",
  Drawer: "Drawer",
  Sidebar: "Sidebar",
  PageContainer: "PageContainer",
  DashboardGrid: "DashboardGrid",

  // Data
  Table: "Table",
  DataTable: "DataTable",
  Tabs: "Tabs",
  Accordion: "Accordion",
  Timeline: "Timeline",
  ProgressBar: "ProgressBar",
  MetricCard: "MetricCard",
  ChartCard: "ChartCard",

  // Navigation
  NotificationBell: "NotificationBell",
  UserMenu: "UserMenu",
  TenantSwitcher: "TenantSwitcher",
  SearchBox: "SearchBox",
  Pagination: "Pagination",
  Breadcrumbs: "Breadcrumbs",
  CommandPalette: "CommandPalette",

  // Feedback
  StatusBadge: "StatusBadge",
  Alert: "Alert",
  Toast: "Toast",
  Spinner: "Spinner",
  ConfirmDialog: "ConfirmDialog",

  // Financial
  CurrencyInput: "CurrencyInput",
  CurrencyDisplay: "CurrencyDisplay",
  MobileMoneyBadge: "MobileMoneyBadge",
  TransactionStatus: "TransactionStatus",
  LoanStatusBadge: "LoanStatusBadge",
  SavingsCard: "SavingsCard",

  // Forms
  DatePicker: "DatePicker",
  PhoneInput: "PhoneInput",
  OTPInput: "OTPInput",
  FileUploader: "FileUploader",
  Stepper: "Stepper",

  // Enterprise
  FraudAlertWidget: "FraudAlertWidget",
  ComplianceWidget: "ComplianceWidget",
  RegulatoryWidget: "RegulatoryWidget",
  ExecutiveWidget: "ExecutiveWidget",
  MobileMoneyWidget: "MobileMoneyWidget",
  TenantCard: "TenantCard",
  AuditLogTable: "AuditLogTable",

  // Authorization
  PermissionGate: "PermissionGate",
  FeatureGate: "FeatureGate",

  // Utilities
  ErrorBoundary: "ErrorBoundary",
  SuspenseLoader: "SuspenseLoader",
});

// ============================================================================
// Component Registry
// ============================================================================
//
// The registry currently contains stable component identifiers.
//
// Dynamic component resolution should be performed by an explicit resolver
// layer rather than evaluating arbitrary strings as JavaScript.
//

export const COMPONENT_REGISTRY = Object.freeze({
  ...UI_COMPONENTS,
});

// ============================================================================
// Component Categories
// ============================================================================
//
// Provides a machine-readable classification layer for UI governance,
// analytics, documentation, and future dynamic UI tooling.
//

export const UI_COMPONENT_CATEGORIES = Object.freeze({
  CORE: "core",
  LAYOUT: "layout",
  DATA: "data",
  NAVIGATION: "navigation",
  FEEDBACK: "feedback",
  FINANCIAL: "financial",
  FORMS: "forms",
  ENTERPRISE: "enterprise",
  AUTHORIZATION: "authorization",
  UTILITY: "utility",
});

// ============================================================================
// UI Metadata
// ============================================================================

const getEnvironmentValue = (
  key,
  fallback
) => {
  try {
    if (
      typeof process !== "undefined" &&
      process.env &&
      process.env[key]
    ) {
      return process.env[key];
    }
  } catch (_) {
    // Environment access must never break UI initialization.
  }

  return fallback;
};

export const UI_VERSION =
  getEnvironmentValue(
    "REACT_APP_UI_VERSION",
    "1.0.0"
  );

export const UI_BUILD =
  getEnvironmentValue(
    "REACT_APP_BUILD_NUMBER",
    "development"
  );

export const UI_ENVIRONMENT =
  getEnvironmentValue(
    "REACT_APP_ENV",
    getEnvironmentValue(
      "NODE_ENV",
      "development"
    )
  );

// ============================================================================
// Design System Metadata
// ============================================================================

export const UI_METADATA = Object.freeze({
  product: "TITech Community Capital",
  organization: "TITech Africa",
  system: "African Community Finance Operating System",
  namespace: "titech.ui",

  version: UI_VERSION,
  build: UI_BUILD,
  environment: UI_ENVIRONMENT,

  componentCount:
    Object.keys(
      UI_COMPONENTS
    ).length,

  registryVersion: "1.0.0",

  capabilities: Object.freeze([
    "component-registry",
    "enterprise-ui",
    "financial-ui",
    "tenant-aware-ui",
    "authorization-gates",
    "feature-gates",
    "accessibility-ready",
    "react-compatible",
  ]),
});

// ============================================================================
// Registry Utilities
// ============================================================================

/**
 * Determine whether a component is registered.
 *
 * @param {string} componentName
 * @returns {boolean}
 */
export function hasUIComponent(
  componentName
) {
  if (
    typeof componentName !==
    "string"
  ) {
    return false;
  }

  return Boolean(
    COMPONENT_REGISTRY[
      componentName
    ]
  );
}

/**
 * Return all registered component names.
 *
 * @returns {string[]}
 */
export function getUIComponentNames() {
  return Object.keys(
    COMPONENT_REGISTRY
  );
}

/**
 * Return the registered component identifier.
 *
 * @param {string} componentName
 * @returns {string|null}
 */
export function getUIComponent(
  componentName
) {
  if (
    !hasUIComponent(
      componentName
    )
  ) {
    return null;
  }

  return COMPONENT_REGISTRY[
    componentName
  ];
}

// ============================================================================
// Diagnostics
// ============================================================================

export function getUIDiagnostics() {
  return Object.freeze({
    product:
      UI_METADATA.product,

    namespace:
      UI_METADATA.namespace,

    version:
      UI_VERSION,

    build:
      UI_BUILD,

    environment:
      UI_ENVIRONMENT,

    componentCount:
      UI_METADATA.componentCount,

    registryVersion:
      UI_METADATA.registryVersion,

    timestamp:
      new Date().toISOString(),
  });
}

// ============================================================================
// Default UI Namespace
// ============================================================================

const UI = Object.freeze({
  UI_VERSION,
  UI_BUILD,
  UI_ENVIRONMENT,

  UI_COMPONENTS,
  COMPONENT_REGISTRY,

  UI_COMPONENT_CATEGORIES,
  UI_METADATA,

  hasUIComponent,
  getUIComponentNames,
  getUIComponent,
  getUIDiagnostics,
});

// ============================================================================
// Default Export
// ============================================================================

export default UI;