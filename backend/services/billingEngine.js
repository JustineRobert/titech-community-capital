/**
 * TITech Community Capital — legacy billing compatibility boundary.
 *
 * Organization: TITech Capital SMC LTD
 *
 * This module intentionally contains NO tariffs, tax rates, monetary arithmetic,
 * invoice state, collections or ledger posting. Those concerns belong to the
 * authoritative commercial pricing and existing financial-core services.
 *
 * Older callers may retain the BillingEngine method names during migration,
 * but every operation must be delegated to an explicitly injected canonical
 * commercial runtime. An absent integration is an availability error, never a
 * zero-fee or successful-payment fallback.
 */

const NOT_CONFIGURED = 'TITECH_COMMERCIAL_BILLING_NOT_CONFIGURED';
const INVALID_CONTEXT = 'TITECH_COMMERCIAL_BILLING_CONTEXT_REQUIRED';

function configurationError(operation, detail = null) {
  const error = new Error(
    `TITech commercial billing cannot ${operation}: the authoritative billing integration is not configured.`,
  );
  error.code = NOT_CONFIGURED;
  error.statusCode = 503;
  if (detail) error.details = detail;
  return error;
}

function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    const error = new Error(`${field} is required for authoritative commercial billing.`);
    error.code = INVALID_CONTEXT;
    error.statusCode = 400;
    throw error;
  }
  return value.trim();
}

function requireRuntimeFunction(runtime, name, operation) {
  if (!runtime || typeof runtime[name] !== 'function') {
    throw configurationError(operation, { missingCapability: name });
  }
  return runtime[name].bind(runtime);
}

export class BillingEngine {
  constructor({ runtime = null } = {}) {
    this.runtime = runtime;
  }

  /**
   * Inject the application-composed commercial runtime during server
   * bootstrap. The runtime must be built from the existing approved pricing,
   * usage-metering, invoice/payment and financial-core services.
   */
  configure(runtime) {
    if (!runtime || typeof runtime !== 'object') {
      throw new TypeError('A canonical commercial billing runtime is required.');
    }
    this.runtime = runtime;
    return this;
  }

  isConfigured() {
    return Boolean(this.runtime && typeof this.runtime === 'object');
  }

  /** Resolve a rule only through the central approved fee-rule service. */
  async getPricingRule(criteria = {}) {
    const resolve = requireRuntimeFunction(
      this.runtime,
      'resolveFeeRule',
      'resolve a commercial pricing rule',
    );
    return resolve(criteria);
  }

  /** Calculate only through the central deterministic pricing service. */
  async calculateFee(input = {}) {
    const quote = requireRuntimeFunction(
      this.runtime,
      'quoteFee',
      'quote an authorised commercial fee',
    );
    return quote(input);
  }

  /** Tax calculation is jurisdiction- and service-specific; no default rate. */
  async calculateVAT(input = {}) {
    const calculateTax = requireRuntimeFunction(
      this.runtime,
      'calculateTax',
      'calculate an approved tax treatment',
    );
    return calculateTax(input);
  }

  /** Raw caller-supplied tariff objects are not an approval mechanism. */
  async calculateWithCustomPricing(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('A pricing request object is required.');
    }
    if (input.pricing || input.rate || input.fee || input.amount) {
      const error = new Error(
        'Caller-supplied prices are not authoritative. Submit a service context to the approved pricing engine.',
      );
      error.code = 'TITECH_UNTRUSTED_PRICING_INPUT';
      error.statusCode = 400;
      throw error;
    }
    return this.calculateFee(input);
  }

  /**
   * Meter a completed provider-related service event. A tenant and amount alone
   * are insufficient: trusted payer, event, service, currency and idempotency
   * context must be supplied by the authenticated server-side caller.
   */
  async applyMobileMoneyFee(input = {}) {
    const requiredFields = [
      'tenantId',
      'serviceId',
      'sourceEventId',
      'sourceModule',
      'payerId',
      'currency',
      'principalMinor',
      'idempotencyKey',
    ];
    const context = {};
    for (const field of requiredFields) context[field] = requireText(String(input[field] ?? ''), field);
    if (input.outcome !== 'SUCCEEDED') {
      const error = new Error('Only a verified successful service outcome may enter the default billable-event path.');
      error.code = 'TITECH_BILLABLE_OUTCOME_NOT_VERIFIED';
      error.statusCode = 409;
      throw error;
    }

    const recordUsageEvent = requireRuntimeFunction(
      this.runtime,
      'recordUsageEvent',
      'record provider usage through the central metering service',
    );
    return recordUsageEvent({
      ...context,
      eventType: input.eventType,
      sourceTransactionId: input.sourceTransactionId ?? null,
      quantity: input.quantity ?? '1',
      unit: input.unit ?? 'event',
      outcome: input.outcome,
      occurredAt: input.occurredAt,
      correlationId: input.correlationId ?? null,
    });
  }

  async computeFee(input = {}) {
    const calculate = requireRuntimeFunction(
      this.runtime,
      'calculateFee',
      'calculate a fee through the central pricing service',
    );
    return calculate(input);
  }

  async recordBillingEvent(input = {}) {
    const record = requireRuntimeFunction(
      this.runtime,
      'recordAuditEvent',
      'write a commercial billing audit event',
    );
    return record(input);
  }

  getDiagnostics() {
    return Object.freeze({
      service: 'TITech Commercial Billing Compatibility Boundary',
      organization: 'TITech Capital SMC LTD',
      product: 'TITech Community Capital',
      configured: this.isConfigured(),
      pricingAuthority: 'CENTRAL_COMMERCIAL_ENGINE_ONLY',
      directTariffCalculation: false,
      defaultTaxRate: false,
      unknownPriceFallback: false,
      ledgerAuthority: 'EXISTING_CANONICAL_FINANCIAL_CORE',
      productionApproved: false,
    });
  }
}

const billingEngine = new BillingEngine();

export function configureBillingEngine(runtime) {
  return billingEngine.configure(runtime);
}

export { billingEngine, NOT_CONFIGURED as BILLING_ENGINE_NOT_CONFIGURED };
export default billingEngine;
