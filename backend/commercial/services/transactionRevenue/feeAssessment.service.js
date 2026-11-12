/**
 * Persist an immutable, idempotent assessment from a verified billable event.
 * This service deliberately does not invoice, collect, post revenue or settle.
 */
import { createHash } from 'node:crypto';
import { TransactionRevenueConflictError, TransactionRevenueValidationError } from '../../errors/transactionRevenue.errors.js';
import { calculateFee, normalizeCurrency, normalizeMinorAmount } from './feeCalculation.service.js';
import { FEE_ASSESSMENT_STATUS } from '../../constants/transactionRevenue.constants.js';

function required(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TransactionRevenueValidationError(`${field} is required.`, { field });
  }
  return value.trim();
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(input) {
  const material = {
    tenantId: input.tenantId,
    serviceId: input.serviceId,
    sourceEventId: input.sourceEventId,
    payerId: input.payerId,
    currency: input.currency,
    principalMinor: input.principalMinor,
    eventType: input.eventType ?? null,
    sourceModule: input.sourceModule,
    institutionId: input.institutionId ?? null,
    contractId: input.contractId ?? null,
    beneficiaryId: input.beneficiaryId ?? null,
    payerType: input.payerType ?? null,
    occurredAt: input.occurredAt.toISOString(),
  };
  return createHash('sha256').update(stable(material)).digest('hex');
}

function snapshotRule(rule) {
  const calculation = rule.calculation && typeof rule.calculation === 'object' ? rule.calculation : {
    type: rule.type,
    fixedMinor: rule.fixedMinor ?? rule.amountMinor,
    rateBps: rule.rateBps,
    minimumFeeMinor: rule.minimumFeeMinor,
    maximumFeeMinor: rule.maximumFeeMinor,
    rounding: rule.rounding,
    tierMode: rule.tierMode,
    tiers: rule.tiers,
  };
  return Object.freeze({
    id: String(rule._id ?? rule.id ?? rule.ruleCode ?? ''),
    ruleCode: rule.ruleCode ?? null,
    version: rule.version ?? null,
    serviceId: String(rule.serviceId),
    currency: String(rule.currency).toUpperCase(),
    type: String(rule.type ?? calculation.type).toUpperCase(),
    calculation,
    effectiveFrom: rule.effectiveFrom ?? null,
    effectiveTo: rule.effectiveTo ?? null,
    contractId: rule.contractId ?? null,
    institutionId: rule.institutionId ?? null,
    payerType: rule.payerType ?? null,
    priority: rule.priority ?? 0,
    approvedBy: rule.approvedBy ?? null,
    approvedAt: rule.approvedAt ?? null,
    approvalReason: rule.approvalReason ?? null,
    changeReason: rule.changeReason ?? null,
  });
}

export class FeeAssessmentService {
  constructor({ repository, feeRuleService, clock = () => new Date() } = {}) {
    if (!repository || typeof repository.findByIdempotencyKey !== 'function' || typeof repository.createIfAbsent !== 'function') {
      throw new TypeError('FeeAssessmentService requires an atomic fee-assessment repository.');
    }
    if (!feeRuleService || typeof feeRuleService.resolve !== 'function') {
      throw new TypeError('FeeAssessmentService requires feeRuleService.resolve.');
    }
    if (typeof clock !== 'function') throw new TypeError('clock must be a function.');
    this.repository = repository;
    this.feeRuleService = feeRuleService;
    this.clock = clock;
  }

  async assess({
    tenantId,
    serviceId,
    sourceEventId,
    sourceModule,
    payerId,
    beneficiaryId = null,
    payerType = null,
    eventType = null,
    institutionId = null,
    contractId = null,
    principalMinor,
    currency,
    idempotencyKey,
    actorId,
    correlationId = null,
    occurredAt = this.clock(),
    session = null,
  } = {}) {
    const input = {
      tenantId: required(tenantId, 'tenantId'),
      serviceId: required(serviceId, 'serviceId'),
      sourceEventId: required(sourceEventId, 'sourceEventId'),
      sourceModule: required(sourceModule, 'sourceModule'),
      payerId: required(payerId, 'payerId'),
      payerType,
      eventType,
      institutionId: institutionId == null ? null : String(institutionId),
      contractId: contractId == null ? null : String(contractId),
      beneficiaryId: beneficiaryId == null ? null : String(beneficiaryId),
      principalMinor: normalizeMinorAmount(principalMinor, 'principalMinor'),
      currency: normalizeCurrency(currency),
      idempotencyKey: required(idempotencyKey, 'idempotencyKey'),
      actorId: required(actorId, 'actorId'),
      occurredAt: occurredAt instanceof Date ? new Date(occurredAt) : new Date(occurredAt),
      correlationId: correlationId == null ? null : String(correlationId),
    };
    input.institutionId = institutionId == null ? null : String(institutionId);
    input.contractId = contractId == null ? null : String(contractId);
    input.beneficiaryId = beneficiaryId == null ? null : String(beneficiaryId);
    if (Number.isNaN(input.occurredAt.getTime())) throw new TransactionRevenueValidationError('occurredAt must be a valid date.');

    const eventFingerprint = fingerprint(input);
    const existing = await this.repository.findByIdempotencyKey(input.tenantId, input.idempotencyKey, { session });
    if (existing) {
      if (existing.eventFingerprint !== eventFingerprint) {
        throw new TransactionRevenueConflictError('Idempotency key was already used for a different billable event.', {
          tenantId: input.tenantId,
          idempotencyKey: input.idempotencyKey,
        });
      }
      return { assessment: existing, idempotent: true };
    }

    const rule = await this.feeRuleService.resolve({
      tenantId: input.tenantId,
      serviceId: input.serviceId,
      currency: input.currency,
      institutionId: input.institutionId,
      contractId: input.contractId,
      payerType,
      eventType,
      effectiveAt: input.occurredAt,
      session,
    });
    const quote = calculateFee({ rule, principalMinor: input.principalMinor, currency: input.currency, effectiveAt: input.occurredAt });
    const now = this.clock();
    const assessment = {
      tenantId: input.tenantId,
      serviceId: input.serviceId,
      sourceEventId: input.sourceEventId,
      sourceModule: input.sourceModule,
      payerId: input.payerId,
      beneficiaryId: input.beneficiaryId,
      payerType,
      eventType,
      institutionId: input.institutionId,
      contractId: input.contractId,
      principalMinor: quote.principalMinor,
      feeMinor: quote.feeMinor,
      currency: quote.currency,
      feeRuleId: quote.feeRuleId,
      feeRuleVersion: quote.feeRuleVersion,
      pricingSnapshot: snapshotRule(rule),
      eventFingerprint,
      idempotencyKey: input.idempotencyKey,
      status: FEE_ASSESSMENT_STATUS.ASSESSED,
      assessedAt: now,
      occurredAt: input.occurredAt,
      correlationId: input.correlationId,
      audit: {
        eventType: 'COMMERCIAL_FEE_ASSESSED',
        actorId: input.actorId,
        occurredAt: now,
        sourceModule: input.sourceModule,
        correlationId: input.correlationId,
      },
    };

    // Repository contract: unique (tenantId,idempotencyKey) index and atomic
    // create-or-read. It must never update a previously stored assessment.
    const result = await this.repository.createIfAbsent(assessment, { session });
    const saved = result?.assessment ?? result;
    const created = result?.created ?? !result?.idempotent;
    if (!saved) throw new Error('Fee assessment repository returned no persisted assessment.');
    if (saved.eventFingerprint !== eventFingerprint) {
      throw new TransactionRevenueConflictError('A concurrent request used this idempotency key for a different event.');
    }
    return { assessment: saved, idempotent: !created };
  }
}

export default FeeAssessmentService;
