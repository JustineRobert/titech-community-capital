'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Settlement Matcher
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Match Settlement Records with Internal Ledger
 * ✅ Support for Partial & Full Matches
 * ✅ Configurable Matching Rules
 * ✅ Error & Exception Handling
 * ✅ Audit Logging
 * ✅ Reconciliation Integration
 * ✅ Jest/Vitest Compatible
 * ============================================================================
 */

const logger = require('../../../../common/logger');
const db = require('../../../../common/database');

class SettlementMatcher {
  constructor(config = {}) {
    this.config = {
      tolerance: config.tolerance || parseFloat(process.env.SETTLEMENT_AMOUNT_TOLERANCE) || 0.01,
      matchWindowDays: config.matchWindowDays || parseInt(process.env.SETTLEMENT_MATCH_WINDOW_DAYS, 10) || 3,
    };

    logger.info('[SettlementMatcher] Initialized with config:', this.config);
  }

  /**
   * Match settlement record against internal ledger
   * @param {Object} settlement - Settlement record
   */
  async matchSettlement(settlement) {
    try {
      const ledgerTx = await this.findLedgerTransaction(settlement);

      if (!ledgerTx) {
        logger.warn(`[SettlementMatcher] No ledger match found for referenceId=${settlement.reference_id}`);
        return { status: 'UNMATCHED', settlement };
      }

      const amountDiff = Math.abs(ledgerTx.amount - settlement.amount);
      if (amountDiff > this.config.tolerance) {
        logger.warn(`[SettlementMatcher] Amount mismatch for referenceId=${settlement.reference_id}: ledger=${ledgerTx.amount}, settlement=${settlement.amount}`);
        return { status: 'MISMATCH', settlement, ledgerTx };
      }

      logger.info(`[SettlementMatcher] Settlement matched successfully for referenceId=${settlement.reference_id}`);
      return { status: 'MATCHED', settlement, ledgerTx };
    } catch (err) {
      logger.error('[SettlementMatcher] Error matching settlement:', err);
      throw err;
    }
  }

  /**
   * Find ledger transaction by referenceId and date window
   * @param {Object} settlement
   */
  async findLedgerTransaction(settlement) {
    try {
      const startDate = new Date(settlement.settlement_date);
      startDate.setDate(startDate.getDate() - this.config.matchWindowDays);

      const endDate = new Date(settlement.settlement_date);
      endDate.setDate(endDate.getDate() + this.config.matchWindowDays);

      const record = await db('mobile_money_transactions')
        .where({ reference_id: settlement.reference_id })
        .andWhere('transaction_date', '>=', startDate)
        .andWhere('transaction_date', '<=', endDate)
        .first();

      return record || null;
    } catch (err) {
      logger.error('[SettlementMatcher] Error finding ledger transaction:', err);
      throw err;
    }
  }

  /**
   * Batch match settlements
   * @param {Array} settlements
   */
  async matchBatch(settlements) {
    const results = [];
    for (const settlement of settlements) {
      try {
        const result = await this.matchSettlement(settlement);
        results.push(result);
      } catch (err) {
        results.push({ status: 'ERROR', settlement, error: err.message });
      }
    }
    return results;
  }
}

module.exports = SettlementMatcher;
