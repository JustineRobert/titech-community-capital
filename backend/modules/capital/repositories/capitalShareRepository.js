/**
 * TITech Community Capital — Capital Share Repository
 * Role: tenant-scoped persistence boundary for permissioned capital data-share requests.
 * Non-responsibilities: consent decisions, approvals, lending or payments.
 */

export class CapitalShareRepository {
  constructor({ model }) {
    if (!model) throw new TypeError('CapitalShareRepository requires a model.');
    this.model = model;
  }

  create(payload, options = {}) {
    return this.model.create([payload], options).then(([doc]) => doc);
  }

  findById({ tenantId, id }) {
    return this.model.findOne({ tenantId, _id: id });
  }

  updateById({ tenantId, id, update }) {
    return this.model.findOneAndUpdate({ tenantId, _id: id }, update, { new: true, runValidators: true });
  }

  list({ tenantId, recipientPartnerId, status, limit = 50 }) {
    return this.model.find({ tenantId, ...(recipientPartnerId ? { recipientPartnerId } : {}), ...(status ? { status } : {}) })
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 50, 100));
  }
}
