'use strict';

// Compatibility facade for older consumers. The full loan lifecycle remains
// owned by the canonical loan workflow service.
const LoanWorkflowService = require('./loanWorkflowService.js');

module.exports = Object.freeze({
  createLoanApplication: (...args) => LoanWorkflowService.createLoanApplication(...args),
  changeLoanStatus: (...args) => LoanWorkflowService.changeLoanStatus(...args),
  ensureRepaymentSchedule: (...args) => LoanWorkflowService.ensureRepaymentSchedule(...args),
  generateRepaymentSchedule: (...args) => LoanWorkflowService.generateRepaymentSchedule(...args),
  recordRepayment: (...args) => LoanWorkflowService.recordRepayment(...args),
  checkAndUpdateOverdueStatus: (...args) => LoanWorkflowService.checkAndUpdateOverdueStatus(...args),
  getLoanSummary: (...args) => LoanWorkflowService.getLoanSummary(...args),
});
