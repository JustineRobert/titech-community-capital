/** Tenant-scoped idempotent usage-event persistence. */
import UsageRecord from '../models/usageRecord.model.js';

export class UsageRecordRepository {
  constructor({ model = UsageRecord } = {}) {
    if (!model || typeof model.findOne !== 'function' || typeof model.create !== 'function') {
      throw new TypeError('UsageRecordRepository requires a Mongoose model.');
    }
    this.model = model;
  }

  findByIdempotencyKey(tenantId, idempotencyKey, { session = null } = {}) {
    let query = this.model.findOne({ tenantId: String(tenantId), idempotencyKey: String(idempotencyKey) }).lean();
    if (session) query = query.session(session);
    return query;
  }

  async createIfAbsent(record, { session = null } = {}) {
    try {
      const [created] = await this.model.create([record], session ? { session } : {});
      return { record: created.toObject ? created.toObject() : created, created: true };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const existing = await this.findByIdempotencyKey(record.tenantId, record.idempotencyKey, { session });
      if (!existing) throw error;
      return { record: existing, created: false };
    }
  }

  async markProcessed(tenantId, recordId, { status, feeAssessmentId = null, reason = null, processedAt = new Date() } = {}, { session = null } = {}) {
    if (!['ASSESSED', 'INCLUDED', 'NOT_BILLABLE', 'BLOCKED'].includes(status)) {
      throw new TypeError('Invalid usage processing status.');
    }
    const query = this.model.findOneAndUpdate(
      { _id: recordId, tenantId: String(tenantId), status: 'RECORDED' },
      { $set: { status, feeAssessmentId, processingReason: reason, processedAt } },
      { new: true, runValidators: true },
    );
    if (session) query.session(session);
    return query.lean();
  }
}

export default UsageRecordRepository;
