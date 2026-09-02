// services/auditLogService.js
'use strict';

const crypto = require('crypto');
const Audit = require('../models/Audit'); // assumes you already have an Audit schema

/**
 * Create a tamper‑evident audit log entry
 * @param {Object} user - User object from JWT payload
 * @param {String} action - Action performed (e.g. 'message:send')
 * @param {Object} data - Additional metadata (e.g. { messageId })
 */
async function log(user, action, data = {}) {
  if (!user || !user.id) {
    throw new Error('AuditLogService: user context required');
  }
  if (!action) {
    throw new Error('AuditLogService: action required');
  }

  try {
    // Build log payload
    const payload = {
      tenantId: user.tenantId || 'default',
      userId: user.id,
      role: user.role || 'user',
      action,
      data,
      timestamp: new Date(),
    };

    // Compute hash for tamper‑evidence
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');

    payload.hash = hash;

    // Persist to DB
    const audit = new Audit(payload);
    await audit.save();

    console.info(`[AuditLog] ${action} by user ${user.id}`, {
      tenant: payload.tenantId,
      hash,
    });

    return audit;
  } catch (err) {
    console.error('[AuditLog] Failed to log event', {
      action,
      userId: user?.id,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Verify audit chain integrity for a tenant
 * @param {String} tenantId
 * @returns {Object} result with valid flag and errors array
 */
async function verifyChain(tenantId) {
  const logs = await Audit.find({ tenantId }).sort({ timestamp: 1 });
  const errors = [];

  for (const log of logs) {
    const recomputed = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          tenantId: log.tenantId,
          userId: log.userId,
          role: log.role,
          action: log.action,
          data: log.data,
          timestamp: log.timestamp,
        })
      )
      .digest('hex');

    if (recomputed !== log.hash) {
      errors.push({
        id: log._id,
        action: log.action,
        expected: recomputed,
        actual: log.hash,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { log, verifyChain };
