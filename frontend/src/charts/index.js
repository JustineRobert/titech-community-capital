// ============================================================================
// TITech Community Capital
// Charts Module Exports
// File: src/components/charts/index.js
// Production Grade
// ============================================================================

export { default as ChartCard } from "./ChartCard";
export { default as BarChartCard } from "./BarChartCard";
export { default as PieChartCard } from "./PieChartCard";
export { default as LineChartCard } from "./LineChartCard";

// ============================================================================
// Named Export Bundle
// ============================================================================

import ChartCard from "./ChartCard";
import BarChartCard from "./BarChartCard";
import PieChartCard from "./PieChartCard";
import LineChartCard from "./LineChartCard";

export const Charts = {
  ChartCard,
  BarChartCard,
  PieChartCard,
  LineChartCard,
};

// ============================================================================
// Analytics Registry
// Useful for dynamic dashboard rendering, widget builders,
// executive dashboards, and plugin-based analytics modules.
// ============================================================================

export const CHART_COMPONENTS = {
  chart: ChartCard,
  bar: BarChartCard,
  pie: PieChartCard,
  line: LineChartCard,
};

// ============================================================================
// Chart Types
// ============================================================================

export const CHART_TYPES = Object.freeze({
  CHART: "chart",
  BAR: "bar",
  PIE: "pie",
  LINE: "line",
});

// ============================================================================
// Dashboard Chart Definitions
// Can be consumed by Executive Dashboard,
// Reporting Engine, and Widget Framework.
// ============================================================================

export const DASHBOARD_CHARTS = Object.freeze({
  SAVINGS_GROWTH: {
    key: "savingsGrowth",
    title: "Savings Growth",
    type: CHART_TYPES.LINE,
  },

  LOAN_PORTFOLIO: {
    key: "loanPortfolio",
    title: "Loan Portfolio",
    type: CHART_TYPES.BAR,
  },

  FRAUD_MONITORING: {
    key: "fraudMonitoring",
    title: "Fraud Monitoring",
    type: CHART_TYPES.PIE,
  },

  MEMBER_GROWTH: {
    key: "memberGrowth",
    title: "Member Growth",
    type: CHART_TYPES.LINE,
  },

  TRANSACTION_VOLUME: {
    key: "transactionVolume",
    title: "Transaction Volume",
    type: CHART_TYPES.BAR,
  },

  CASH_FLOW: {
    key: "cashFlow",
    title: "Cash Flow",
    type: CHART_TYPES.LINE,
  },

  SAVINGS_DISTRIBUTION: {
    key: "savingsDistribution",
    title: "Savings Distribution",
    type: CHART_TYPES.PIE,
  },

  EXECUTIVE_KPI: {
    key: "executiveKpi",
    title: "Executive KPI",
    type: CHART_TYPES.BAR,
  },
});

// ============================================================================
// Dynamic Resolver
// ============================================================================

export function getChartComponent(
  type
) {
  return (
    CHART_COMPONENTS[type] ||
    ChartCard
  );
}

// ============================================================================
// Default Export
// ============================================================================

export default Charts;