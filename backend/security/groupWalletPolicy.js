import { resolveCanonicalTenantObjectId } from './tenantObjectIdContext.js';

/** Group routes use a distinct error code for missing canonical tenant scope. */
export function resolveCanonicalGroupTenantId(req) {
  return resolveCanonicalTenantObjectId(req, { code: 'GROUP_TENANT_CONTEXT_INVALID' });
}

export const GROUP_WALLET_POLICY = Object.freeze({
  tenantField: 'Group.tenantId',
  tenantIdentifier: 'Tenant._id',
  rejectTenantSlugAsObjectId: true,
});
