'use strict';

/**
 * Compatibility facade for legacy callers. Settlement authority remains in
 * the canonical payment settlement modules under backend/modules/payment.
 */

const settlementProcessor = require('../modules/payment/settlement/settlementProcessor.js');

module.exports = Object.freeze({
  process: (...args) => settlementProcessor.process(...args),
  processWithRetry: (...args) => settlementProcessor.processWithRetry(...args),
  processCallback: (...args) => settlementProcessor.processCallback(...args),
  settleFromReconciliation: (...args) => settlementProcessor.settleFromReconciliation(...args),
  flagForReconciliation: (...args) => settlementProcessor.flagForReconciliation(...args),
  validateTransition: (...args) => settlementProcessor.validateTransition(...args),
});
