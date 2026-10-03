/**
 * TITech Community Capital — deterministic financial snapshot service.
 * Snapshot persistence is injected; this module never mutates ledger history.
 */
import crypto from 'node:crypto';

class SnapshotService {
  constructor({ repository = null, clock = () => new Date() } = {}) {
    this.repository = repository;
    this.clock = clock;
  }

  async create({ type = 'DAILY', period = null, balances = {}, history = [], context = {}, session = null } = {}) {
    const tenantId = String(context?.tenant?.tenantId ?? context?.tenantId ?? '').trim();
    if (!tenantId) throw Object.assign(new Error('Snapshot tenant is required.'), { code: 'SNAPSHOT_TENANT_REQUIRED', statusCode: 400 });
    const payload = {
      tenantId,
      type: String(type).toUpperCase(),
      periodId: period?.id ?? period?._id ?? null,
      asOf: this.clock().toISOString(),
      balances,
      ledgerEntries: Array.isArray(history) ? history.length : 0,
    };
    const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const snapshot = { ...payload, hash, id: `SNP-${hash.slice(0, 20)}` };
    if (this.repository?.create) return this.repository.create({ snapshot, session });
    return snapshot;
  }

  async rebuild({ history = [], balances = {}, context = {}, session = null } = {}) {
    return this.create({ type: 'REBUILD', history, balances, context, session });
  }

  diagnostics() { return { module: 'SnapshotService', repositoryConfigured: Boolean(this.repository) }; }
}

function createSnapshotService(options = {}) { return new SnapshotService(options); }

export { SnapshotService, createSnapshotService };
export default SnapshotService;
