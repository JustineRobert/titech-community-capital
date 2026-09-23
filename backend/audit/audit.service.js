'use strict';

/**
 * Compatibility adapter for legacy CommonJS onboarding code.
 *
 * The authoritative audit implementation remains:
 *   backend/models/AuditLog.js
 *
 * This adapter keeps the existing CommonJS `AuditService.log(...)` contract
 * without introducing a second audit model or chain implementation.
 */

const mongoose = require('mongoose');

function getAuditModel() {
  const model = mongoose.models.AuditLog;

  if (!model || typeof model.appendTenant !== 'function') {
    const error = new Error(
      'Canonical AuditLog model is not initialized. Audit writes fail closed.',
    );
    error.code = 'AUDIT_MODEL_NOT_INITIALIZED';
    error.statusCode = 503;
    throw error;
  }

  return model;
}

async function log(context = {}) {
  const model = getAuditModel();

  const {
    tenantId,
    userId = null,
    action,
    entity,
    entityId = null,
    metadata,
    requestId = null,
    correlationId = null,
  } = context;

  return model.appendTenant({
    tenantId,
    userId,
    action,
    entityType: entity || 'UNKNOWN',
    entityId,
    outcome: 'SUCCESS',
    metadata,
    requestId,
    correlationId,
  });
}

module.exports = Object.freeze({
  log,
  createAuditLog: log,
});
