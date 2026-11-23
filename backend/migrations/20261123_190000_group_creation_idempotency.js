/**
 * TITech Community Capital — canonical group uniqueness and request idempotency.
 * Additive-only: creates the model-declared unique indexes after duplicate preflight.
 * No collection, group or membership documents are modified or deleted.
 */
export async function up({ mongoose }) {
  if (!mongoose?.connection?.db) throw new Error('An active MongoDB connection is required.');
  const groups = mongoose.connection.db.collection('groups');

  const duplicateActiveName = await groups.aggregate([
    { $match: { deletedAt: null, tenantId: { $exists: true }, name: { $type: 'string' } } },
    { $group: { _id: { tenantId: '$tenantId', name: '$name' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]).toArray();
  if (duplicateActiveName.length) {
    throw new Error('Cannot create the tenant/name unique index: duplicate active group names exist. Resolve duplicates through an approved data-governance process; this migration will not modify records.');
  }

  const duplicateIdempotencyKey = await groups.aggregate([
    { $match: { creationRequestId: { $type: 'string' }, tenantId: { $exists: true }, createdBy: { $exists: true } } },
    { $group: { _id: { tenantId: '$tenantId', createdBy: '$createdBy', creationRequestId: '$creationRequestId' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]).toArray();
  if (duplicateIdempotencyKey.length) {
    throw new Error('Cannot create the group idempotency index: duplicate request keys exist. Review records before retrying; this migration will not modify data.');
  }

  await groups.createIndex(
    { tenantId: 1, name: 1 },
    { unique: true, partialFilterExpression: { deletedAt: null }, name: 'uq_group_tenant_active_name' },
  );
  await groups.createIndex(
    { tenantId: 1, createdBy: 1, creationRequestId: 1 },
    { unique: true, partialFilterExpression: { creationRequestId: { $type: 'string' } }, name: 'uq_group_creation_idempotency_key' },
  );
}

export async function down() {
  throw new Error('Automatic rollback is intentionally blocked: dropping the group uniqueness/idempotency indexes would remove active integrity controls. A separately approved forward migration is required.');
}
