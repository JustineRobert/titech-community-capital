const transactionService = require('./transaction.service');
const kycService = require('./kycService');
const auditService = require('./auditService');
const amlService = require('./amlService');
const logger = require('../utils/logger') || console;

async function createDeposit(data) {
  // KYC/AML checks
  const user = data.user || {};
  try {
    kycService.validateTransaction(user, data.amount, {});
  } catch (err) {
    logger.warn('KYC validation failed', { err: err.message, userId: user.id });
    throw err;
  }

  // AML checks
  if (amlService && typeof amlService.scoreTransaction === 'function') {
    const score = await amlService.scoreTransaction(user, data.amount, { tenantId: data.tenantId });
    if (score.flagged) {
      logger.warn('AML flagged transaction', { score });
      throw new Error('AML flagged transaction');
    }
  }

  const tx = await transactionService.createDeposit(data);
  await auditService.logAction({ action: 'transaction:create_deposit', userId: user.id, tenantId: data.tenantId, entityType: 'Transaction', entityId: tx._id, metadata: { amount: data.amount, reference: tx.reference } });
  return tx;
}

async function createWithdraw(data) {
  const user = data.user || {};
  try {
    kycService.validateTransaction(user, data.amount, {});
  } catch (err) {
    logger.warn('KYC validation failed', { err: err.message, userId: user.id });
    throw err;
  }

  if (amlService && typeof amlService.scoreTransaction === 'function') {
    const score = await amlService.scoreTransaction(user, data.amount, { tenantId: data.tenantId });
    if (score.flagged) {
      logger.warn('AML flagged transaction', { score });
      throw new Error('AML flagged transaction');
    }
  }

  const tx = await transactionService.createWithdraw(data);
  await auditService.logAction({ action: 'transaction:create_withdraw', userId: user.id, tenantId: data.tenantId, entityType: 'Transaction', entityId: tx._id, metadata: { amount: data.amount, reference: tx.reference } });
  return tx;
}

async function processSuccessfulTransaction(transaction) {
  const tx = await transactionService.processSuccessfulTransaction(transaction);
  try {
    await auditService.logAction({ action: 'transaction:process_success', userId: tx.user, tenantId: tx.tenantId, entityType: 'Transaction', entityId: tx._id, metadata: { amount: tx.amount, reference: tx.reference } });
  } catch (err) {
    logger.error('Failed to write audit log for transaction', { err: err.message, transactionId: tx._id });
  }
  return tx;
}

module.exports = { createDeposit, createWithdraw, processSuccessfulTransaction };
