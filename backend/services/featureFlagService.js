'use strict';

/**
 * Compatibility facade for the canonical provider/featureFlags implementation.
 * Feature evaluation remains fail-closed at the provider layer.
 */

const provider = require('../config/provider/featureFlags.js');

async function isEnabled(key, tenantId = null, fallback = false) {
  try {
    const context = {
      tenantId,
      environment: process.env.NODE_ENV || 'development',
    };
    const value = provider.isEnabled(key, context);
    return value === undefined || value === null ? fallback : Boolean(value);
  } catch {
    return Boolean(fallback);
  }
}

async function isTenantActive(tenantId) {
  if (!tenantId) return false;

  try {
    const Tenant = require('../models/Tenant.js');
    const tenant = await Tenant.findById(tenantId).select('status isSuspended isDeleted deletedAt').lean();
    if (!tenant) return false;
    if (tenant.deletedAt || tenant.isDeleted || tenant.isSuspended) return false;
    return !['inactive', 'suspended', 'disabled', 'deleted'].includes(String(tenant.status || '').toLowerCase());
  } catch {
    return false;
  }
}

module.exports = Object.freeze({
  isEnabled,
  isTenantActive,
  evaluate: provider.evaluate,
  getBoolean: provider.getBoolean,
  getString: provider.getString,
  getNumber: provider.getNumber,
  getJson: provider.getJson,
  snapshot: provider.snapshot,
  health: provider.health,
  readiness: provider.readiness,
});
