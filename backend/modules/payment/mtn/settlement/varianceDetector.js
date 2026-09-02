'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Settlement Variance Detector
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Detect Amount Variances
 * ✅ Detect Date Variances
 * ✅ Detect Currency Variances
 * ✅ Configurable Tolerance Rules
 * ✅ Batch Variance Analysis
 * ✅ Audit Logging
 * ✅ Reconciliation Integration
 * ✅ Jest/Vitest Compatible
 * ============================================================================
 */

const logger = require('../../../../common/logger');

class VarianceDetector {
  constructor(config = {}) {
    this.config = {
      amountTolerance: config.amountTolerance || parseFloat(process.env.VARIANCE_AMOUNT_TOLERANCE) || 0.01,
      dateToleranceDays: config.dateToleranceDays || parseInt(process.env.VARIANCE_DATE_TOLERANCE_DAYS, 10) || 1,
      currency: config.currency || process.env.DEFAULT_CURRENCY || 'UGX',
    };

    logger.info('[VarianceDetector] Initialized with config:', this.config);
  }

  /**
   * Detect variance between settlement and ledger transaction
   * @param {Object} settlement
   * @param {Object} ledgerTx
   */
  detectVariance(settlement, ledgerTx) {
    const variances = [];

    // Amount variance
    const amountDiff = Math.abs((ledgerTx.amount || 0) - (settlement.amount || 0));
    if (amountDiff > this.config.amountTolerance) {
      variances.push({
        type: 'AMOUNT',
        expected: ledgerTx.amount,
        actual: settlement.amount,
        difference: amountDiff,
      });
    }

    // Date variance
    const settlementDate = new Date(settlement.settlement_date);
    const ledgerDate = new Date(ledgerTx.transaction_date);
    const dateDiffDays = Math.abs((settlementDate - ledgerDate) / (1000 * 60 * 60 * 24));
    if (dateDiffDays > this.config.dateToleranceDays) {
      variances.push({
        type: 'DATE',
        expected: ledgerDate,
        actual: settlementDate,
        differenceDays: dateDiffDays,
      });
    }

    // Currency variance
    if ((settlement.currency || this.config.currency) !== (ledgerTx.currency || this.config.currency)) {
      variances.push({
        type: 'CURRENCY',
        expected: ledgerTx.currency || this.config.currency,
        actual: settlement.currency || this.config.currency,
      });
    }

    if (variances.length === 0) {
      logger.info(`[VarianceDetector] No variance detected for referenceId=${settlement.reference_id}`);
      return { status: 'NO_VARIANCE', settlement, ledgerTx };
    }

    logger.warn(`[VarianceDetector] Variances detected for referenceId=${settlement.reference_id}`, variances);
    return { status: 'VARIANCE', settlement, ledgerTx, variances };
  }

  /**
   * Batch variance detection
   * @param {Array} matches - Array of {settlement, ledgerTx}
   */
  detectBatch(matches) {
    const results = [];
    for (const match of matches) {
      try {
        const result = this.detectVariance(match.settlement, match.ledgerTx);
        results.push(result);
      } catch (err) {
        results.push({ status: 'ERROR', settlement: match.settlement, error: err.message });
      }
    }
    return results;
  }
}

module.exports = VarianceDetector;
