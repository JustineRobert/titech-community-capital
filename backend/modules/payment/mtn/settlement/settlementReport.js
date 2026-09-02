'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Settlement Report Generator
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Generate Settlement Reports (JSON, CSV, Summary)
 * ✅ Include Variance & Reconciliation Results
 * ✅ Configurable Output Directory
 * ✅ Error Handling & Logging
 * ✅ Audit-Ready Format
 * ✅ Jest/Vitest Compatible
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../../../common/logger');

class SettlementReport {
  constructor(config = {}) {
    this.config = {
      outputDir: config.outputDir || process.env.SETTLEMENT_REPORT_DIR || '/var/mtn/reports',
      includeVariance: config.includeVariance !== undefined ? config.includeVariance : true,
      includeSummary: config.includeSummary !== undefined ? config.includeSummary : true,
    };

    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }

    logger.info('[SettlementReport] Initialized with config:', this.config);
  }

  /**
   * Generate JSON report
   * @param {Array} results - Settlement results
   * @param {String} fileName
   */
  async generateJSON(results, fileName = 'settlement-report.json') {
    try {
      const filePath = path.resolve(this.config.outputDir, fileName);
      fs.writeFileSync(filePath, JSON.stringify(results, null, 2), 'utf-8');
      logger.info(`[SettlementReport] JSON report generated: ${filePath}`);
      return filePath;
    } catch (err) {
      logger.error('[SettlementReport] Error generating JSON report:', err);
      throw err;
    }
  }

  /**
   * Generate CSV report
   * @param {Array} results - Settlement results
   * @param {String} fileName
   */
  async generateCSV(results, fileName = 'settlement-report.csv') {
    try {
      const headers = ['SettlementID', 'ReferenceID', 'AccountNumber', 'Amount', 'Currency', 'Status', 'SettlementDate'];
      const rows = results.map(r => [
        r.settlement?.id || '',
        r.settlement?.reference_id || '',
        r.settlement?.account_number || '',
        r.settlement?.amount || '',
        r.settlement?.currency || '',
        r.status || '',
        r.settlement?.settlement_date || '',
      ]);

      const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
      const filePath = path.resolve(this.config.outputDir, fileName);
      fs.writeFileSync(filePath, csvContent, 'utf-8');
      logger.info(`[SettlementReport] CSV report generated: ${filePath}`);
      return filePath;
    } catch (err) {
      logger.error('[SettlementReport] Error generating CSV report:', err);
      throw err;
    }
  }

  /**
   * Generate summary report
   * @param {Array} results - Settlement results
   */
  generateSummary(results) {
    const summary = {
      total: results.length,
      matched: results.filter(r => r.status === 'MATCHED').length,
      mismatched: results.filter(r => r.status === 'MISMATCH').length,
      unmatched: results.filter(r => r.status === 'UNMATCHED').length,
      variance: results.filter(r => r.status === 'VARIANCE').length,
      errors: results.filter(r => r.status === 'ERROR').length,
    };

    logger.info('[SettlementReport] Summary generated:', summary);
    return summary;
  }

  /**
   * Generate full report (JSON + CSV + Summary)
   * @param {Array} results
   */
  async generateFullReport(results) {
    const reportFiles = {};

    if (this.config.includeSummary) {
      reportFiles.summary = this.generateSummary(results);
    }

    reportFiles.json = await this.generateJSON(results);
    reportFiles.csv = await this.generateCSV(results);

    logger.info('[SettlementReport] Full report generated successfully');
    return reportFiles;
  }
}

module.exports = SettlementReport;
