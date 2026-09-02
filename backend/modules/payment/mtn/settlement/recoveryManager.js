'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Settlement Recovery Manager
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Detect Failed or Incomplete Settlements
 * ✅ Retry Failed Transactions with Configurable Limits
 * ✅ Escalate Irrecoverable Failures
 * ✅ Audit Logging & Error Tracking
 * ✅ Batch Recovery Processing
 * ✅ Integration with Repository & Reconciler
 * ✅ Jest/Vitest Compatible
 * ============================================================================
 */

const logger = require('../../../../common/logger');
const db = require('../../../../common/database');
const SettlementRepository = require('./settlementRepository');
const LedgerReconciler = require('./ledgerReconciler');

class RecoveryManager {
  constructor(config = {}) {
    this.config = {
      retryLimit: config.retryLimit || parseInt(process.env.RECOVERY_RETRY_LIMIT, 10) || 3,
      batchSize: config.batchSize || parseInt(process.env.RECOVERY_BATCH_SIZE, 10) || 50,
    };

    this.repository = new SettlementRepository(db);
    this.reconciler = new LedgerReconciler(config);

    logger.info('[RecoveryManager] Initialized with config:', this.config);
  }

  /**
   * Attempt recovery for a single settlement
   * @param {Object} settlement
   */
  async recoverSettlement(settlement) {
    try {
      if (!settlement) {
        throw new Error('Invalid settlement record');
      }

      const retries = settlement.retry_count || 0;
      if (retries >= this.config.retryLimit) {
        logger.warn(`[RecoveryManager] Settlement ${settlement.id} exceeded retry limit`);
        await this._markAsFailed(settlement.id);
        return { status: 'FAILED', settlement };
      }

      // Attempt reconciliation again
      const result = await this.reconciler.reconcileSettlement(settlement);

      if (result.status === 'MATCHED') {
        logger.info(`[RecoveryManager] Settlement ${settlement.id} successfully recovered`);
        return { status: 'RECOVERED', settlement };
      }

      // Increment retry count
      await this._incrementRetry(settlement.id, retries + 1);
      logger.warn(`[RecoveryManager] Settlement ${settlement.id} recovery attempt failed`);
      return { status: 'RETRY', settlement, retries: retries + 1 };
    } catch (err) {
      logger.error('[RecoveryManager] Error recovering settlement:', err);
      await this._markAsFailed(settlement.id);
      return { status: 'ERROR', settlement, error: err.message };
    }
  }

  /**
   * Batch recovery for unsettled/failed transactions
   */
  async recoverBatch() {
    try {
      const unsettled = await this.repository.fetchUnsettled(this.config.batchSize);
      const results = [];

      for (const settlement of unsettled) {
        const result = await this.recoverSettlement(settlement);
        results.push(result);
      }

      logger.info('[RecoveryManager] Batch recovery completed');
      return results;
    } catch (err) {
      logger.error('[RecoveryManager] Error during batch recovery:', err);
      throw err;
    }
  }

  /**
   * Mark settlement as permanently failed
   */
  async _markAsFailed(settlementId) {
    try {
      await db('mobile_money_settlements')
        .where({ id: settlementId })
        .update({ status: 'FAILED', updated_at: new Date() });
      logger.info(`[RecoveryManager] Settlement ${settlementId} marked as FAILED`);
    } catch (err) {
      logger.error('[RecoveryManager] Error marking settlement as FAILED:', err);
    }
  }

  /**
   * Increment retry count
   */
  async _incrementRetry(settlementId, count) {
    try {
      await db('mobile_money_settlements')
        .where({ id: settlementId })
        .update({ retry_count: count, updated_at: new Date() });
      logger.info(`[RecoveryManager] Settlement ${settlementId} retry count updated to ${count}`);
    } catch (err) {
      logger.error('[RecoveryManager] Error incrementing retry count:', err);
    }
  }
}

module.exports = RecoveryManager;
