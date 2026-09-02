'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Reconciliation Policy
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Centralized Policy Definitions
 * ✅ Configurable Matching & Variance Rules
 * ✅ Escalation & Exception Handling
 * ✅ Policy Evaluation Engine
 * ✅ Audit Logging
 * ✅ Jest/Vitest Compatible
 * ============================================================================
 */

const logger = require('../../../../common/logger');

class ReconciliationPolicy {
  constructor(config = {}) {
    this.config = {
      amountTolerance: config.amountTolerance || parseFloat(process.env.RECONCILE_AMOUNT_TOLERANCE) || 0.01,
      dateToleranceDays: config.dateToleranceDays || parseInt(process.env.RECONCILE_DATE_TOLERANCE_DAYS, 10) || 2,
      allowedCurrencies: config.allowedCurrencies || (process.env.RECONCILE_ALLOWED_CURRENCIES || 'UGX').split(','),
      escalateOnMismatch: config.escalateOnMismatch !== undefined ? config.escalateOnMismatch : true,
      autoReconcileOnMatch: config.autoReconcileOnMatch !== undefined ? config.autoReconcileOnMatch : true,
    };

    logger.info('[ReconciliationPolicy] Initialized with config:', this.config);
  }

  /**
   * Evaluate reconciliation policy for a settlement vs ledger transaction
   * @param {Object} settlement
   * @param {Object} ledgerTx
   */
  evaluate(settlement, ledgerTx) {
    const variances = [];

    // Amount check
    const amountDiff = Math.abs((ledgerTx.amount || 0) - (settlement.amount || 0));
    if (amountDiff > this.config.amountTolerance) {
      variances.push({
        type: 'AMOUNT',
        expected: ledgerTx.amount,
        actual: settlement.amount,
        difference: amountDiff,
      });
    }

    // Date check
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

    // Currency check
    if (!this.config.allowedCurrencies.includes(settlement.currency)) {
      variances.push({
        type: 'CURRENCY',
        expected: ledgerTx.currency,
        actual: settlement.currency,
      });
    }

    // Decision logic
    if (variances.length === 0) {
      if (this.config.autoReconcileOnMatch) {
        logger.info(`[ReconciliationPolicy] Auto-reconcile approved for referenceId=${settlement.reference_id}`);
        return { status: 'AUTO_RECONCILE', settlement, ledgerTx };
      }
      return { status: 'MATCHED', settlement, ledgerTx };
    }

    if (this.config.escalateOnMismatch) {
      logger.warn(`[ReconciliationPolicy] Escalation required for referenceId=${settlement.reference_id}`, variances);
      return { status: 'ESCALATE', settlement, ledgerTx, variances };
    }

    logger.warn(`[ReconciliationPolicy] Variances detected for referenceId=${settlement.reference_id}`, variances);
    return { status: 'VARIANCE', settlement, ledgerTx, variances };
  }

  /**
   * Batch evaluation
   * @param {Array} matches - Array of {settlement, ledgerTx}
   */
  evaluateBatch(matches) {
    const results = [];
    for (const match of matches) {
      try {
        const result = this.evaluate(match.settlement, match.ledgerTx);
        results.push(result);
      } catch (err) {
        results.push({ status: 'ERROR', settlement: match.settlement, error: err.message });
      }
    }
    return results;
  }
}

module.exports = ReconciliationPolicy;
