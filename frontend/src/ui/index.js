// ============================================================================
// TITech Community Capital
// Enterprise UI Components Barrel Export
// File: src/ui/index.js
// Production Grade
// ============================================================================

"use strict";

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
// Forms
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

export {
  default as ErrorBoundary,
} from "./ErrorBoundary";

export {
  default as SuspenseLoader,
} from "./SuspenseLoader";

// ============================================================================
// Enterprise UI Registry
// ============================================================================

export const UI_COMPONENTS = Object.freeze({
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

  PageHeader: "PageHeader",
  StatCard: "StatCard",
  LoadingScreen: "LoadingScreen",
  Skeleton: "Skeleton",
  EmptyState: "EmptyState",
  Drawer: "Drawer",
  Sidebar: "Sidebar",
  DashboardGrid: "DashboardGrid",
  PageContainer: "PageContainer",

  Table: "Table",
  DataTable: "DataTable",
  Tabs: "Tabs",
  Accordion: "Accordion",
  Timeline: "Timeline",
  ProgressBar: "ProgressBar",
  MetricCard: "MetricCard",
  ChartCard: "ChartCard",

  NotificationBell: "NotificationBell",
  UserMenu: "UserMenu",
  TenantSwitcher: "TenantSwitcher",
  SearchBox: "SearchBox",
  Pagination: "Pagination",
  Breadcrumbs: "Breadcrumbs",
  CommandPalette: "CommandPalette",

  StatusBadge: "StatusBadge",
  Alert: "Alert",
  Toast: "Toast",
  Spinner: "Spinner",
  ConfirmDialog: "ConfirmDialog",

  CurrencyInput: "CurrencyInput",
  CurrencyDisplay: "CurrencyDisplay",
  MobileMoneyBadge: "MobileMoneyBadge",
  TransactionStatus: "TransactionStatus",
  LoanStatusBadge: "LoanStatusBadge",
  SavingsCard: "SavingsCard",

  DatePicker: "DatePicker",
  PhoneInput: "PhoneInput",
  OTPInput: "OTPInput",
  FileUploader: "FileUploader",
  Stepper: "Stepper",

  FraudAlertWidget: "FraudAlertWidget",
  ComplianceWidget: "ComplianceWidget",
  RegulatoryWidget: "RegulatoryWidget",
  ExecutiveWidget: "ExecutiveWidget",
  MobileMoneyWidget: "MobileMoneyWidget",
  TenantCard: "TenantCard",
  AuditLogTable: "AuditLogTable",

  PermissionGate: "PermissionGate",
  FeatureGate: "FeatureGate",
  ErrorBoundary: "ErrorBoundary",
  SuspenseLoader: "SuspenseLoader",
});

// ============================================================================
// Component Registry
// Useful for Dynamic Widget Rendering
// ============================================================================

export const COMPONENT_REGISTRY =
  Object.freeze({
    ...UI_COMPONENTS,
  });

// ============================================================================
// Version Metadata
// ============================================================================

export const UI_VERSION =
  process.env.REACT_APP_UI_VERSION ||
  "1.0.0";

export const UI_BUILD =
  process.env.REACT_APP_BUILD_NUMBER ||
  "development";

// ============================================================================
// Default Export
// ============================================================================

const UI = {
  UI_VERSION,
  UI_BUILD,
  UI_COMPONENTS,
  COMPONENT_REGISTRY,
};

export default UI;