/**
 * Canonical operational SLA policy definitions. These are application defaults;
 * contractual SLA values remain tenant/provider configuration and legal/commercial evidence.
 */
export const SLA_POLICIES = Object.freeze({
  PAYMENT_CRITICAL: Object.freeze({ priority: 'CRITICAL', firstResponseMinutes: 15, targetResolutionMinutes: 60 }),
  PAYMENT_HIGH: Object.freeze({ priority: 'HIGH', firstResponseMinutes: 30, targetResolutionMinutes: 240 }),
  PAYMENT_MEDIUM: Object.freeze({ priority: 'MEDIUM', firstResponseMinutes: 120, targetResolutionMinutes: 1440 }),
  SUPPORT_HIGH: Object.freeze({ priority: 'HIGH', firstResponseMinutes: 60, targetResolutionMinutes: 480 }),
  SUPPORT_MEDIUM: Object.freeze({ priority: 'MEDIUM', firstResponseMinutes: 240, targetResolutionMinutes: 2880 }),
});

export function resolveSlaPolicy({ type = 'SUPPORT', priority = 'MEDIUM' } = {}) {
  const key = `${String(type).toUpperCase()}_${String(priority).toUpperCase()}`;
  return SLA_POLICIES[key] || SLA_POLICIES.SUPPORT_MEDIUM;
}

export function computeSlaDueAt({ createdAt = new Date(), type, priority } = {}) {
  const policy = resolveSlaPolicy({ type, priority });
  return new Date(new Date(createdAt).getTime() + policy.targetResolutionMinutes * 60_000);
}
