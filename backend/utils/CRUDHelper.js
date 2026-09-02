// Utility: Common CRUD hooks for idempotent operations on models
class CRUDHelper {
  static async findOrCreate(Model, filter, data) {
    const existing = await Model.findOne(filter);
    if (existing) return { doc: existing, created: false };
    const doc = await Model.create({ ...filter, ...data });
    return { doc, created: true };
  }

  static async updateOrCreate(Model, filter, updateData) {
    const existing = await Model.findOne(filter);
    if (existing) {
      await Model.updateOne(filter, updateData);
      return { doc: await Model.findOne(filter), created: false };
    }
    const doc = await Model.create({ ...filter, ...updateData });
    return { doc, created: true };
  }

  static async softDelete(Model, id) {
    return Model.updateOne({ _id: id }, { deletedAt: new Date() });
  }

  static async paginate(Model, query = {}, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      Model.find(query).skip(skip).limit(limit),
      Model.countDocuments(query),
    ]);
    return {
      docs,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    };
  }

  static async bulkUpdate(Model, ids, updateData) {
    return Model.updateMany({ _id: { $in: ids } }, updateData);
  }

  static async bulkDelete(Model, ids) {
    return Model.deleteMany({ _id: { $in: ids } });
  }
}

module.exports = CRUDHelper;
