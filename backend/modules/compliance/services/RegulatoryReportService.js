// backend/modules/compliance/services/RegulatoryReportService.js
'use strict';

const Transaction = require('../../finance/models/Transaction');

class RegulatoryReportService {
  /**
   * Generate transaction report
   */
  static async generateTransactionReport(tenantId, startDate, endDate) {
    return Transaction.find({
      tenantId,
      createdAt: { $gte: startDate, $lte: endDate },
    }).select(
      'reference amount currency status momoTransactionId createdAt'
    );
  }

  /**
   * Suspicious transactions report
   */
  static async suspiciousTransactions(tenantId) {
    return Transaction.find({
      tenantId,
      $or: [
        { amount: { $gt: 10000000 } },
        { status: 'REVERSED' },
      ],
    });
  }
}

module.exports = RegulatoryReportService;