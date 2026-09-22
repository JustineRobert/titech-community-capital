/**
 * ============================================================================
 * TITech Community Capital — Audit Service
 * ============================================================================
 * Role: append-only audit writer for governed control-plane actions.
 * Non-responsibilities: authorization, ledger mutation, reconciliation or data
 * sharing decisions.
 * ============================================================================
 */

import Audit from './audit.model.js';
import logger from '../../utils/logger.js';

const REDACTED_KEYS = /(?:password|secret|token|authorization|cookie|privatekey|private_key|clientsecret|accesskey|refresh)/i;

function sanitizeAuditData(value, depth = 0) {
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeAuditData(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = REDACTED_KEYS.test(key) ? '[REDACTED]' : sanitizeAuditData(entry, depth + 1);
  }
  return result;
}

function validateInput({ tenantId, action, data }) {
  if (!tenantId) throw Object.assign(new Error('TenantId is required.'), { code: 'AUDIT_TENANT_REQUIRED', statusCode: 400 });
  if (!action) throw Object.assign(new Error('Action is required.'), { code: 'AUDIT_ACTION_REQUIRED', statusCode: 400 });
  if (data === undefined || data === null) throw Object.assign(new Error('Audit data payload is required.'), { code: 'AUDIT_DATA_REQUIRED', statusCode: 400 });
}

export async function createAuditLog({ tenantId, action, data, actorId = null, requestId = null, correlationId = null }) {
  validateInput({ tenantId, action, data });
  const tenant = String(tenantId);
  const safeData = sanitizeAuditData(data);
  const previous = await Audit.findOne({ tenantId: tenant }).sort({ createdAt: -1, _id: -1 }).lean();
  const previousHash = previous?.hash || 'GENESIS';
  const hash = Audit.computeHash(previousHash, action, safeData);
  const log = await Audit.create({ tenantId: tenant, action, data: safeData, previousHash, hash, actorId, requestId, correlationId });
  logger.info?.('TITech audit record created', { tenantId: tenant, action, actorId, requestId, correlationId, auditId: String(log._id) });
  return log;
}

export async function verifyAuditChain(tenantId) {
  return Audit.verifyChain(tenantId);
}
