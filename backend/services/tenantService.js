import mongoose from 'mongoose';
import Tenant, { TENANT_STATUSES } from '../models/Tenant.js';

const ACTIVE_STATUSES = new Set(['ACTIVE']);

function normalizeTenantId(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized.length > 100 || !/^[a-z0-9][a-z0-9._:-]{0,99}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function assertTenantStatus(status) {
  if (!TENANT_STATUSES.includes(status)) throw new Error(`Unsupported tenant status: ${status}`);
}

async function findByIdOrKey({ tenantId, session = null, includeInactive = false } = {}) {
  const normalized = normalizeTenantId(tenantId);
  if (!normalized) return null;

  const filters = [{ tenantId: normalized }, { slug: normalized }];
  if (mongoose.isValidObjectId(tenantId)) filters.push({ _id: tenantId });

  const query = Tenant.findOne({ $or: filters });
  if (!includeInactive) query.where({ status: { $in: [...ACTIVE_STATUSES] } });
  if (session) query.session(session);
  return query.lean().exec();
}

async function requireActiveTenant({ tenantId, session = null } = {}) {
  const tenant = await findByIdOrKey({ tenantId, session, includeInactive: true });
  if (!tenant) {
    const error = new Error('Tenant was not found.');
    error.code = 'TENANT_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  if (!ACTIVE_STATUSES.has(tenant.status)) {
    const error = new Error('Tenant is not active.');
    error.code = 'TENANT_NOT_ACTIVE';
    error.statusCode = 403;
    throw error;
  }
  return tenant;
}

async function createTenant({ tenantId, slug, name, institutionId = null, countryCode = 'UG', defaultCurrency = 'UGX', createdBy = null, settings = {}, metadata = {} } = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId || slug);
  const normalizedSlug = normalizeTenantId(slug || tenantId);
  if (!normalizedTenantId || !normalizedSlug || !name?.trim()) {
    const error = new Error('tenantId, slug and name are required.');
    error.code = 'TENANT_VALIDATION_ERROR';
    error.statusCode = 422;
    throw error;
  }
  assertTenantStatus('ACTIVE');
  return Tenant.create({
    tenantId: normalizedTenantId,
    slug: normalizedSlug,
    name: String(name).trim(),
    institutionId: institutionId ? String(institutionId).trim() : null,
    countryCode,
    defaultCurrency,
    createdBy,
    settings,
    metadata,
    status: 'ACTIVE',
  });
}

export { normalizeTenantId, findByIdOrKey, requireActiveTenant, createTenant };
export default Object.freeze({ normalizeTenantId, findByIdOrKey, requireActiveTenant, createTenant });
