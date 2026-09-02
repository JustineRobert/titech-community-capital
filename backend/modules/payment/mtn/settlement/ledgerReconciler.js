'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Ledger Reconciler
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Reconcile Settlement Records with Ledger Entries
 * ✅ Detect Variances (Amount, Date, Currency)
 * ✅ Update Ledger & Settlement Status
 * ✅ Batch Reconciliation
 * ✅ Audit Logging
 * ✅ Error Handling & Recovery
 * ✅ Jest/Vitest Compatible
 * ============================================================================
 */

const logger = require('../../../../common/logger');
const db = require('../../../../common/database');
const SettlementMatcher = require('./settlementMatcher');
const VarianceDetector = require('./varianceDetector');
const SettlementReport = require('./settlementReport');

class LedgerReconciler {
  constructor(config = {}) {
    this.config = {
      batchSize: config.batchSize || parseInt(process.env.RECONCILE_BATCH_SIZE, 10) || 100,
    };

    this.matcher = new SettlementMatcher(config);
    this.varianceDetector = new VarianceDetector(config);
    this.reportGenerator = new SettlementReport(config);

    logger.info('[LedgerReconciler] Initialized with config:', this.config);
  }

  /**
   * Reconcile a single settlement record
   * @param {Object} settlement
   */
  async reconcileSettlement(settlement) {
    try {
      const matchResult = await this.matcher.matchSettlement(settlement);

      if (matchResult.status === 'MATCHED') {
        await this._updateSettlementStatus(settlement.id, 'RECONCILED');
        logger.info(`[LedgerReconciler] Settlement reconciled: ${settlement.id}`);
        return { ...matchResult, reconciled: true };
      }

      if (matchResult.status === 'MISMATCH' || matchResult.status === 'UNMATCHED') {
        const varianceResult = this.varianceDetector.detectVariance(settlement, matchResult.ledgerTx || {});
        await this._updateSettlementStatus(settlement.id, 'VARIANCE');
        return { ...varianceResult, reconciled: false };
      }

      return { ...matchResult, reconciled: false };
    } catch (err) {
      logger.error('[LedgerReconciler] Error reconciling settlement:', err);
      await this._updateSettlementStatus(settlement.id, 'ERROR');
      return { status: 'ERROR', settlement, error: err.message };
    }
  }

  /**
   * Batch reconciliation
   * @param {Array} settlements
   */
  async reconcileBatch(settlements) {
    const results = [];
    for (const settlement of settlements) {
      try {
        const result = await this.reconcileSettlement(settlement);
        results.push(result);
      } catch (err) {
        results.push({ status: 'ERROR', settlement, error: err.message });
      }
    }

    // Generate reconciliation report
    await this.reportGenerator.generateFullReport(results);

    logger.info('[LedgerReconciler] Batch reconciliation completed');
    return results;
  }

  /**
   * Update settlement status in DB
   * @param {String} settlementId
   * @param {String} status
   */
  async _updateSettlementStatus(settlementId, status) {
    try {
      await db('mobile_money_settlements')
        .where({ id: settlementId })
        .update({ status, updated_at: new Date() });
      logger.info(`[LedgerReconciler] Settlement ${settlementId} status updated to ${status}`);
    } catch (err) {
      logger.error('[LedgerReconciler] Error updating settlement status:', err);
      throw err;
    }
  }
}

module.exports = LedgerReconciler;
