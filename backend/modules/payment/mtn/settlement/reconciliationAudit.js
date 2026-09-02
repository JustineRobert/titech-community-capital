'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Reconciliation Audit
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Record Reconciliation Events
 * ✅ Track Variances, Escalations, and Errors
 * ✅ Maintain Immutable Audit Trail
 * ✅ Batch Audit Logging
 * ✅ Export Audit Records (JSON/CSV)
 * ✅ Audit-Ready for Compliance
 * ✅ Jest/Vitest Compatible
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../../../common/logger');
const db = require('../../../../common/database');

class ReconciliationAudit {
  constructor(config = {}) {
    this.config = {
      auditDir: config.auditDir || process.env.RECONCILE_AUDIT_DIR || '/var/mtn/audit',
    };

    if (!fs.existsSync(this.config.auditDir)) {
      fs.mkdirSync(this.config.auditDir, { recursive: true });
    }

    logger.info('[ReconciliationAudit] Initialized with config:', this.config);
  }

  /**
   * Record a single reconciliation event in DB
   * @param {Object} event - { settlement, ledgerTx, status, variances, error }
   */
  async recordEvent(event) {
    try {
      const now = new Date();
      const record = {
        settlement_id: event.settlement?.id || null,
        reference_id: event.settlement?.reference_id || null,
        ledger_id: event.ledgerTx?.id || null,
        status: event.status,
        variances: JSON.stringify(event.variances || []),
        error_message: event.error || null,
        created_at: now,
      };

      await db('reconciliation_audit').insert(record);
      logger.info(`[ReconciliationAudit] Event recorded for referenceId=${record.reference_id}`);
      return record;
    } catch (err) {
      logger.error('[ReconciliationAudit] Error recording event:', err);
      throw err;
    }
  }

  /**
   * Record multiple reconciliation events
   * @param {Array} events
   */
  async recordBatch(events) {
    const results = [];
    for (const event of events) {
      try {
        const result = await this.recordEvent(event);
        results.push(result);
      } catch (err) {
        results.push({ status: 'ERROR', error: err.message, event });
      }
    }
    logger.info('[ReconciliationAudit] Batch recording completed');
    return results;
  }

  /**
   * Export audit records to JSON file
   * @param {Array} events
   * @param {String} fileName
   */
  exportJSON(events, fileName = 'reconciliation-audit.json') {
    try {
      const filePath = path.resolve(this.config.auditDir, fileName);
      fs.writeFileSync(filePath, JSON.stringify(events, null, 2), 'utf-8');
      logger.info(`[ReconciliationAudit] JSON audit exported: ${filePath}`);
      return filePath;
    } catch (err) {
      logger.error('[ReconciliationAudit] Error exporting JSON audit:', err);
      throw err;
    }
  }

  /**
   * Export audit records to CSV file
   * @param {Array} events
   * @param {String} fileName
   */
  exportCSV(events, fileName = 'reconciliation-audit.csv') {
    try {
      const headers = ['SettlementID', 'ReferenceID', 'LedgerID', 'Status', 'Variances', 'ErrorMessage', 'CreatedAt'];
      const rows = events.map(e => [
        e.settlement_id || '',
        e.reference_id || '',
        e.ledger_id || '',
        e.status || '',
        e.variances || '',
        e.error_message || '',
        e.created_at || '',
      ]);

      const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
      const filePath = path.resolve(this.config.auditDir, fileName);
      fs.writeFileSync(filePath, csvContent, 'utf-8');
      logger.info(`[ReconciliationAudit] CSV audit exported: ${filePath}`);
      return filePath;
    } catch (err) {
      logger.error('[ReconciliationAudit] Error exporting CSV audit:', err);
      throw err;
    }
  }
}

module.exports = ReconciliationAudit;
