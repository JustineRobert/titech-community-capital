/**
 * TITech Community Capital — adjustment command boundary.
 *
 * Adjustments are commands only. Actual posting remains owned by LedgerEngine.
 */

class AdjustmentServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdjustmentServiceError';
    this.code = code;
  }
}

class AdjustmentService {
  constructor({ idGenerator = () => cryptoRandomId() } = {}) {
    this.idGenerator = idGenerator;
  }

  buildCommand({ tenantId, actorId, reason, entries, approvalId = null, reference = null } = {}) {
    if (!tenantId) throw new AdjustmentServiceError('TENANT_REQUIRED', 'tenantId is required.');
    if (!actorId) throw new AdjustmentServiceError('ACTOR_REQUIRED', 'actorId is required.');
    if (!String(reason ?? '').trim()) throw new AdjustmentServiceError('REASON_REQUIRED', 'An explicit adjustment reason is required.');
    if (!Array.isArray(entries) || entries.length < 2) throw new AdjustmentServiceError('ENTRIES_REQUIRED', 'At least two adjustment entries are required.');
    return Object.freeze({
      adjustmentId: `ADJ-${this.idGenerator()}`,
      operationType: 'FINANCIAL_ADJUSTMENT',
      tenantId: String(tenantId),
      actorId: String(actorId),
      reason: String(reason).trim(),
      approvalId: approvalId ? String(approvalId) : null,
      reference: reference ? String(reference) : null,
      entries: entries.map((entry, index) => Object.freeze({ ...entry, sequence: index + 1 })),
      delegatedTo: 'LedgerEngine',
    });
  }

  diagnostics() {
    return { module: 'AdjustmentService', status: 'IMPLEMENTED', postingAuthority: 'LedgerEngine' };
  }
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function createAdjustmentService(options = {}) {
  return new AdjustmentService(options);
}

export { AdjustmentService, AdjustmentServiceError, createAdjustmentService };
export default AdjustmentService;
