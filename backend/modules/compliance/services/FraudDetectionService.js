//  backend/modules/compliance/services/FraudDetectionService.js
'use strict';

class FraudDetectionService {
  /**
   * Basic rule engine (extend to ML later)
   */
  static async checkTransaction(tx) {
    const alerts = [];

    // 🔴 Large transaction threshold
    if (tx.amount > 10000000) {
      alerts.push('HIGH_VALUE_TRANSACTION');
    }

    // 🔴 Rapid transactions
    if (tx.metadata?.rapid === true) {
      alerts.push('RAPID_ACTIVITY');
    }

    // 🔴 Suspicious reversal
    if (tx.status === 'REVERSED') {
      alerts.push('REVERSAL_FLAG');
    }

    return alerts;
  }
}

module.exports = FraudDetectionService;