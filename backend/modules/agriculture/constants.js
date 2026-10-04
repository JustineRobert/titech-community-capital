/**
 * TITech Community Capital — Agriculture domain constants.
 * One bounded context; all monetary effects still belong to canonical finance.
 */

export const AGRICULTURE_MODULE = 'agriculture';
export const AGRICULTURE_SCHEMA_VERSION = 1;

export const PRODUCER_TYPES = Object.freeze([
  'INDIVIDUAL_FARMER', 'HOUSEHOLD', 'FARMER_GROUP', 'COOPERATIVE_MEMBER',
  'COMMERCIAL_PRODUCER', 'YOUTH_ENTERPRISE', 'WOMEN_LED_ENTERPRISE', 'OTHER',
]);

export const VERIFICATION_STATUSES = Object.freeze(['PENDING', 'VALIDATED', 'VERIFIED', 'REJECTED']);
export const RECORD_STATUSES = Object.freeze(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED']);

export const PRODUCTION_STATUSES = Object.freeze([
  'PLANNED', 'INPUT_FINANCED', 'PLANTED', 'GROWING', 'HARVESTING',
  'HARVESTED', 'SOLD', 'SETTLED', 'CANCELLED',
]);

export const BUYER_TYPES = Object.freeze([
  'AGGREGATOR', 'PROCESSOR', 'EXPORTER', 'COOPERATIVE', 'WHOLESALER',
  'RETAILER', 'CORPORATE', 'GOVERNMENT', 'NGO', 'DFI_PROGRAM', 'OTHER',
]);

export const PRICING_METHODS = Object.freeze([
  'FIXED_PRICE', 'REFERENCE_PRICE', 'FORMULA', 'AUCTION', 'NEGOTIATED', 'VARIABLE',
]);

export const CONTRACT_STATUSES = Object.freeze([
  'DRAFT', 'ACTIVE', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED', 'EXPIRED',
]);

export const DELIVERY_STATUSES = Object.freeze([
  'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'SETTLED', 'CANCELLED',
]);

export const SETTLEMENT_STATUSES = Object.freeze([
  'PENDING_PAYMENT', 'CONFIRMED', 'RECONCILIATION_REQUIRED', 'REVERSED',
]);

export const RECONCILIATION_STATUSES = Object.freeze([
  'UNMATCHED', 'MATCHED', 'MISMATCH', 'REVERSED',
]);

export const OFFLINE_SYNC_STATUSES = Object.freeze([
  'LOCAL_ONLY', 'PENDING_SYNC', 'SYNCING', 'SERVER_ACCEPTED',
  'SERVER_REJECTED', 'CONFLICT', 'REQUIRES_REVIEW', 'CONFIRMED',
]);

export const ALLOCATION_RULES = Object.freeze([
  'EXPLICIT', 'EQUAL', 'WEIGHTED',
]);

export const ALLOCATION_PURPOSES = Object.freeze([
  'PRODUCER', 'GROUP', 'SUPPLIER', 'LOAN', 'INPUT_FINANCE', 'FEES', 'TAX', 'TRANSPORT', 'OTHER',
]);

export const AGRICULTURE_PERMISSIONS = Object.freeze({
  READ: 'agriculture:read',
  WRITE: 'agriculture:write',
  MANAGE: 'agriculture:manage',
  VERIFY: 'agriculture:verify',
  SETTLE: 'agriculture:settle',
  FINANCE: 'agriculture:finance',
  RISK_READ: 'agriculture:risk:read',
  AUDIT_READ: 'agriculture:audit:read',
});

export const GROUP_AGRICULTURE_CAPABILITIES = Object.freeze([
  'savings', 'lending', 'agriculture', 'procurement', 'collectiveSale',
  'inputFinancing', 'collectiveInvestment',
]);

export const AGRICULTURE_EVENT_TYPES = Object.freeze({
  PRODUCER_REGISTERED: 'agriculture.producer.registered',
  PRODUCTION_CYCLE_CREATED: 'agriculture.production_cycle.created',
  DELIVERY_VERIFIED: 'agriculture.delivery.verified',
  SETTLEMENT_CONFIRMED: 'agriculture.settlement.confirmed',
});
