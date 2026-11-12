/** Tenant-scoped atomic persistence for immutable fee assessments. */
import FeeAssessment from '../models/FeeAssessment.js';

export class FeeAssessmentRepository {
  constructor({ model = FeeAssessment } = {}) {
    if (!model || typeof model.findOne !== 'function' || typeof model.create !== 'function') {
      throw new TypeError('FeeAssessmentRepository requires a Mongoose model.');
    }
    this.model = model;
  }

  findByIdempotencyKey(tenantId, idempotencyKey, { session = null } = {}) {
    if (!tenantId || !idempotencyKey) throw new TypeError('tenantId and idempotencyKey are required.');
    let query = this.model.findOne({ tenantId: String(tenantId), idempotencyKey: String(idempotencyKey) }).lean();
    if (session) query = query.session(session);
    return query;
  }

  async createIfAbsent(assessment, { session = null } = {}) {
    if (!assessment?.tenantId || !assessment?.idempotencyKey || !assessment?.eventFingerprint) {
      throw new TypeError('A complete fee assessment is required.');
    }
    try {
      const options = session ? { session } : {};
      const [created] = await this.model.create([assessment], options);
      return { assessment: created.toObject ? created.toObject() : created, created: true };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const existing = await this.findByIdempotencyKey(assessment.tenantId, assessment.idempotencyKey, { session });
      if (!existing) throw error;
      return { assessment: existing, created: false };
    }
  }
}

export default FeeAssessmentRepository;
