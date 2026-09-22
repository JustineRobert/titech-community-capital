/**
 * Enterprise tenant-scoped Consent repository.
 * Owns persistence only; domain rules remain in consentService.js.
 */

export class ConsentRepository {
  constructor({ model }) {
    if (!model) throw new TypeError('ConsentRepository requires a model.');
    this.model = model;
  }

  findActive({ tenantId, subjectType, subjectId, purpose, recipient, now = new Date() }) {
    return this.model.findOne({
      tenantId,
      subjectType,
      subjectId,
      purpose,
      recipient,
      status: 'GRANTED',
      startsAt: { $lte: now },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    });
  }

  create(payload, options = {}) {
    return this.model.create([payload], options).then(([document]) => document);
  }

  findById({ tenantId, id }) {
    return this.model.findOne({ tenantId, _id: id });
  }

  updateById({ tenantId, id, update, options = {} }) {
    return this.model.findOneAndUpdate({ tenantId, _id: id }, update, {
      new: true,
      runValidators: true,
      ...options,
    });
  }

  list({ tenantId, subjectId, status, limit = 50, cursor }) {
    const query = { tenantId };
    if (subjectId) query.subjectId = subjectId;
    if (status) query.status = status;
    if (cursor) query._id = { $lt: cursor };
    return this.model.find(query).sort({ _id: -1 }).limit(Math.min(Number(limit) || 50, 100));
  }
}
