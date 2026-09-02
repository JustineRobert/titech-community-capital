// backend/modules/finance/services/loanWorkflowService.js
'use strict';

const crypto = require('crypto');
const LoanWorkflowHistory =
require('../models/LoanWorkflowHistory');

function generateHash(data) {
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex');
}

async function createWorkflowRecord({
  tenantId,
  loanId,
  memberId,
  fromStatus,
  toStatus,
  transitionType,
  actorId,
  actorRole,
  reason,
  comments,
  creditScore,
  approvedAmount,
  riskLevel,
  requestId,
  ipAddress,
  userAgent,
  metadata = {}
}) {

  const previousRecord =
    await LoanWorkflowHistory
      .findOne({ loanId })
      .sort({ createdAt: -1 });

  const previousHash =
    previousRecord?.hash || null;

  const payload = {
    tenantId,
    loanId,
    memberId,
    fromStatus,
    toStatus,
    transitionType,
    actorId,
    actorRole,
    approvedAmount,
    creditScore,
    riskLevel,
    timestamp: new Date()
  };

  const hash = generateHash(
    JSON.stringify(payload) +
    (previousHash || '')
  );

  return LoanWorkflowHistory.create({
    tenantId,
    loanId,
    memberId,
    fromStatus,
    toStatus,
    transitionType,
    actorId,
    actorRole,
    reason,
    comments,
    approvedAmount,
    creditScore,
    riskLevel,
    requestId,
    ipAddress,
    userAgent,
    previousHash,
    hash,
    metadata
  });
}

module.exports = {
  createWorkflowRecord
};