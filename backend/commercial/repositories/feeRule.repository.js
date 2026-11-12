/** Tenant-scoped read repository for published fee rules. */
import FeeRule from '../models/FeeRule.js';

function scopeClause(field, value) {
  return value == null || value === ''
    ? { $or: [{ [field]: null }, { [field]: { $exists: false } }] }
    : { $or: [{ [field]: String(value) }, { [field]: null }, { [field]: { $exists: false } }] };
}

export class FeeRuleRepository {
  constructor({ model = FeeRule } = {}) {
    if (!model || typeof model.find !== 'function') throw new TypeError('FeeRuleRepository requires a Mongoose model.');
    this.model = model;
  }

  async findApplicableRules(criteria, { session = null } = {}) {
    const { tenantId, serviceId, currency, institutionId, contractId, payerType, eventType, effectiveAt } = criteria ?? {};
    if (!tenantId || !serviceId || !currency || !(effectiveAt instanceof Date) || Number.isNaN(effectiveAt.getTime())) {
      throw new TypeError('Tenant, service, currency and effectiveAt are required for fee-rule lookup.');
    }

    const query = {
      tenantId: String(tenantId),
      serviceId: String(serviceId),
      currency: String(currency).toUpperCase(),
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      effectiveFrom: { $lte: effectiveAt },
      $and: [
        { $or: [{ effectiveTo: null }, { effectiveTo: { $gte: effectiveAt } }, { effectiveTo: { $exists: false } }] },
        scopeClause('institutionId', institutionId),
        scopeClause('contractId', contractId),
        scopeClause('payerType', payerType),
        scopeClause('eventType', eventType),
      ],
    };
    let cursor = this.model.find(query).sort({ priority: -1, effectiveFrom: -1 });
    if (session) cursor = cursor.session(session);
    return cursor.lean();
  }

  async approveDraft({ tenantId, ruleId, makerId, approverId, reason, approvedAt }) {
    if (!tenantId || !ruleId || !makerId || !approverId || !reason || !(approvedAt instanceof Date)) {
      throw new TypeError('Complete maker-checker approval context is required.');
    }
    return this.model.findOneAndUpdate(
      {
        _id: ruleId,
        tenantId: String(tenantId),
        createdBy: String(makerId),
        status: 'DRAFT',
        approvalStatus: { $in: ['PENDING', 'REJECTED'] },
        approvedBy: { $ne: String(approverId) },
      },
      {
        $set: {
          status: 'ACTIVE',
          approvalStatus: 'APPROVED',
          approvedBy: String(approverId),
          approvedAt,
          approvalReason: String(reason).trim(),
        },
      },
      { new: true, runValidators: true },
    ).lean();
  }
}

export default FeeRuleRepository;
