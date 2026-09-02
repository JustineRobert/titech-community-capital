'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Reconciliation Metrics
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Compute Key Reconciliation Metrics
 * ✅ Track Match/Mismatch/Variance/Error Counts
 * ✅ Calculate Recovery & Success Rates
 * ✅ Provide Aggregated KPIs
 * ✅ Export Metrics for Monitoring Systems
 * ✅ Audit Logging
 * ✅ Jest/Vitest Compatible
 * ============================================================================
 */

const logger = require('../../../../common/logger');

class ReconciliationMetrics {
  constructor(config = {}) {
    this.config = {
      enableLogging: config.enableLogging !== undefined ? config.enableLogging : true,
    };

    logger.info('[ReconciliationMetrics] Initialized with config:', this.config);
  }

  /**
   * Compute metrics from reconciliation results
   * @param {Array} results - Array of reconciliation outcomes
   */
  compute(results) {
    const metrics = {
      total: results.length,
      matched: results.filter(r => r.status === 'MATCHED' || r.status === 'AUTO_RECONCILE').length,
      mismatched: results.filter(r => r.status === 'MISMATCH').length,
      variances: results.filter(r => r.status === 'VARIANCE').length,
      escalated: results.filter(r => r.status === 'ESCALATE').length,
      unmatched: results.filter(r => r.status === 'UNMATCHED').length,
      recovered: results.filter(r => r.status === 'RECOVERED').length,
      failed: results.filter(r => r.status === 'FAILED').length,
      errors: results.filter(r => r.status === 'ERROR').length,
    };

    metrics.successRate = metrics.total > 0 ? (metrics.matched + metrics.recovered) / metrics.total : 0;
    metrics.failureRate = metrics.total > 0 ? (metrics.failed + metrics.errors) / metrics.total : 0;
    metrics.varianceRate = metrics.total > 0 ? metrics.variances / metrics.total : 0;

    if (this.config.enableLogging) {
      logger.info('[ReconciliationMetrics] Computed metrics:', metrics);
    }

    return metrics;
  }

  /**
   * Export metrics in JSON format
   * @param {Object} metrics
   */
  exportJSON(metrics) {
    try {
      const json = JSON.stringify(metrics, null, 2);
      if (this.config.enableLogging) {
        logger.info('[ReconciliationMetrics] Exported metrics JSON');
      }
      return json;
    } catch (err) {
      logger.error('[ReconciliationMetrics] Error exporting metrics JSON:', err);
      throw err;
    }
  }

  /**
   * Export metrics in Prometheus format
   * @param {Object} metrics
   */
  exportPrometheus(metrics) {
    try {
      const lines = Object.entries(metrics)
        .map(([key, value]) => `reconciliation_${key} ${value}`);
      const prometheusFormat = lines.join('\n');

      if (this.config.enableLogging) {
        logger.info('[ReconciliationMetrics] Exported metrics Prometheus format');
      }

      return prometheusFormat;
    } catch (err) {
      logger.error('[ReconciliationMetrics] Error exporting metrics Prometheus:', err);
      throw err;
    }
  }
}

module.exports = ReconciliationMetrics;
