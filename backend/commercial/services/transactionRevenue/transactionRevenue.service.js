/**
 * Canonical commercial usage-metering orchestration.
 * The commercial terms resolver is a server-side policy boundary; callers may
 * not choose the payer or classification by sending a browser-controlled fee.
 */
import { createHash } from 'node:crypto';
import {
  COMMERCIAL_SERVICE_CLASSIFICATION as CLASSIFICATION,
  USAGE_EVENT_OUTCOME as OUTCOME,
  USAGE_RECORD_STATUS as STATUS,
} from '../../constants/transactionRevenue.constants.js';
import { TransactionRevenueConflictError, TransactionRevenueValidationError } from '../../errors/transactionRevenue.errors.js';

function required(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TransactionRevenueValidationError(`${field} is required.`, { field });
  return value.trim();
}

function minor(value, field) {
  const stringValue = typeof value === 'bigint' ? value.toString() : String(value ?? '').trim();
  if (!/^(0|[1-9]\d{0,29})$/.test(stringValue)) throw new TransactionRevenueValidationError(`${field} must be an integer minor-unit string.`, { field });
  return stringValue;
}

function fingerprint(value) {
  const fields = Object.keys(value).filter((key) => key !== 'eventFingerprint').sort().map((key) => `${key}:${String(value[key] ?? '')}`).join('|');
  return createHash('sha256').update(fields).digest('hex');
}

const NO_CHARGE_CLASSIFICATIONS = new Set([
  CLASSIFICATION.INCLUDED_IN_PLAN,
  CLASSIFICATION.NON_BILLABLE,
  CLASSIFICATION.FREE_TRIAL,
]);
const ASSESSABLE_CLASSIFICATIONS = new Set([
  CLASSIFICATION.BILLABLE,
  CLASSIFICATION.SPONSORED,
  CLASSIFICATION.CONTRACT_BILLED,
]);

export class TransactionRevenueService {
  constructor({ usageRepository, feeAssessmentService, resolveCommercialTerms, authorizeEmitter, clock = () => new Date() } = {}) {
    if (!usageRepository || typeof usageRepository.findByIdempotencyKey !== 'function' || typeof usageRepository.createIfAbsent !== 'function' || typeof usageRepository.markProcessed !== 'function') {
      throw new TypeError('TransactionRevenueService requires an idempotent usage repository.');
    }
    if (!feeAssessmentService || typeof feeAssessmentService.assess !== 'function') throw new TypeError('feeAssessmentService.assess is required.');
    if (typeof resolveCommercialTerms !== 'function') throw new TypeError('A server-side commercial terms resolver is required.');
    if (typeof authorizeEmitter !== 'function') throw new TypeError('A trusted source-module authorization function is required.');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function.');
    Object.assign(this, { usageRepository, feeAssessmentService, resolveCommercialTerms, authorizeEmitter, clock });
  }

  async recordUsageEvent({
    tenantId, institutionId = null, commercialAccountId = null, serviceId, eventType,
    sourceModule, sourceEventId, sourceTransactionId = null, quantity = '1', unit = 'event',
    outcome = OUTCOME.SUCCEEDED, principalMinor = null, currency = null,
    occurredAt = this.clock(), correlationId = null, session = null,
  } = {}) {
    const source = {
      tenantId: required(tenantId, 'tenantId'),
      serviceId: required(serviceId, 'serviceId'),
      eventType: required(eventType, 'eventType'),
      sourceModule: required(sourceModule, 'sourceModule'),
      sourceEventId: required(sourceEventId, 'sourceEventId'),
      quantity: minor(quantity, 'quantity'),
      unit: required(unit, 'unit'),
      outcome: required(outcome, 'outcome').toUpperCase(),
      occurredAt: occurredAt instanceof Date ? new Date(occurredAt) : new Date(occurredAt),
    };
    if (!Object.values(OUTCOME).includes(source.outcome)) throw new TransactionRevenueValidationError('Unsupported usage event outcome.');
    if (Number.isNaN(source.occurredAt.getTime())) throw new TransactionRevenueValidationError('occurredAt must be a valid date.');

    const permitted = await this.authorizeEmitter({ tenantId: source.tenantId, sourceModule: source.sourceModule, serviceId: source.serviceId });
    if (permitted !== true) throw new TransactionRevenueValidationError('The source module is not authorised to emit commercial usage events.');

    const commercialTerms = await this.resolveCommercialTerms({
      tenantId: source.tenantId,
      institutionId,
      commercialAccountId,
      serviceId: source.serviceId,
      eventType: source.eventType,
      occurredAt: source.occurredAt,
      sourceModule: source.sourceModule,
    });
    const classification = commercialTerms?.classification;
    if (!Object.values(CLASSIFICATION).includes(classification)) {
      throw new TransactionRevenueValidationError('Commercial service classification is missing or invalid; no charge was assessed.');
    }

    const recordInput = {
      ...source,
      institutionId: institutionId == null ? null : String(institutionId),
      commercialAccountId: commercialAccountId == null ? null : String(commercialAccountId),
      sourceTransactionId: sourceTransactionId == null ? null : String(sourceTransactionId),
      principalMinor: principalMinor == null ? null : minor(principalMinor, 'principalMinor'),
      currency: currency == null ? null : String(currency).toUpperCase(),
      classification,
      payerId: commercialTerms.payerId == null ? null : String(commercialTerms.payerId),
      payerType: commercialTerms.payerType ?? null,
      contractId: commercialTerms.contractId == null ? null : String(commercialTerms.contractId),
      idempotencyKey: required(`${source.sourceModule}:${source.sourceEventId}`, 'idempotencyKey'),
      eventFingerprint: '',
      occurredAt: source.occurredAt,
      correlationId: correlationId == null ? null : String(correlationId),
      status: STATUS.RECORDED,
    };
    recordInput.eventFingerprint = fingerprint(recordInput);

    const existing = await this.usageRepository.findByIdempotencyKey(source.tenantId, recordInput.idempotencyKey, { session });
    let usageRecord = existing;
    let created = false;
    if (existing && existing.eventFingerprint !== recordInput.eventFingerprint) {
      throw new TransactionRevenueConflictError('Usage-event idempotency key already belongs to a different source event.');
    }
    if (!existing) {
      const createResult = await this.usageRepository.createIfAbsent(recordInput, { session });
      usageRecord = createResult?.record ?? createResult;
      created = createResult?.created ?? true;
    }
    if (!usageRecord) throw new Error('Usage repository returned no durable usage record.');
    if (usageRecord.eventFingerprint !== recordInput.eventFingerprint) {
      throw new TransactionRevenueConflictError('Concurrent usage-event creation produced a conflicting idempotency record.');
    }
    // A prior worker may have persisted the usage event and crashed before
    // applying its commercial outcome. Re-enter only the RECORDED state; fee
    // assessment remains idempotent at its own unique tenant/key boundary.
    if (usageRecord.status !== STATUS.RECORDED) {
      return { usageRecord, feeAssessment: null, idempotent: true };
    }

    if (classification === CLASSIFICATION.DISABLED || classification === CLASSIFICATION.RESTRICTED) {
      const blocked = await this.usageRepository.markProcessed(source.tenantId, usageRecord._id, {
        status: STATUS.BLOCKED,
        reason: `Service classification ${classification} does not permit commercial processing.`,
        processedAt: this.clock(),
      }, { session });
      return { usageRecord: blocked ?? await this.usageRepository.findByIdempotencyKey(source.tenantId, recordInput.idempotencyKey, { session }) ?? usageRecord, feeAssessment: null, idempotent: !created };
    }

    if (classification === CLASSIFICATION.PENDING_COMMERCIAL_APPROVAL || classification === CLASSIFICATION.UNPRICED) {
      const blocked = await this.usageRepository.markProcessed(source.tenantId, usageRecord._id, {
        status: STATUS.BLOCKED,
        reason: `No approved commercial pricing exists (${classification}).`,
        processedAt: this.clock(),
      }, { session });
      return { usageRecord: blocked ?? await this.usageRepository.findByIdempotencyKey(source.tenantId, recordInput.idempotencyKey, { session }) ?? usageRecord, feeAssessment: null, idempotent: !created };
    }

    if (NO_CHARGE_CLASSIFICATIONS.has(classification) || (source.outcome === OUTCOME.CANCELLED)) {
      const finalStatus = classification === CLASSIFICATION.INCLUDED_IN_PLAN ? STATUS.INCLUDED : STATUS.NOT_BILLABLE;
      const processed = await this.usageRepository.markProcessed(source.tenantId, usageRecord._id, {
        status: finalStatus,
        reason: source.outcome === OUTCOME.CANCELLED ? 'Cancelled service events are not assessed by default.' : 'Explicit commercial policy classifies this service as non-chargeable.',
        processedAt: this.clock(),
      }, { session });
      return { usageRecord: processed ?? await this.usageRepository.findByIdempotencyKey(source.tenantId, recordInput.idempotencyKey, { session }) ?? usageRecord, feeAssessment: null, idempotent: !created };
    }

    if (!ASSESSABLE_CLASSIFICATIONS.has(classification)) throw new TransactionRevenueValidationError('Unsupported commercial classification.');
    if (source.outcome !== OUTCOME.SUCCEEDED && commercialTerms.billFailedOutcomes !== true) {
      const processed = await this.usageRepository.markProcessed(source.tenantId, usageRecord._id, {
        status: STATUS.NOT_BILLABLE,
        reason: 'The commercial contract does not explicitly authorise charging this unsuccessful event.',
        processedAt: this.clock(),
      }, { session });
      return { usageRecord: processed ?? await this.usageRepository.findByIdempotencyKey(source.tenantId, recordInput.idempotencyKey, { session }) ?? usageRecord, feeAssessment: null, idempotent: !created };
    }
    if (!recordInput.payerId || !recordInput.principalMinor || !recordInput.currency) {
      throw new TransactionRevenueValidationError('Billable usage requires a server-resolved payer, principalMinor and currency.');
    }

    const assessmentResult = await this.feeAssessmentService.assess({
      tenantId: source.tenantId,
      institutionId: recordInput.institutionId,
      contractId: recordInput.contractId,
      serviceId: source.serviceId,
      sourceEventId: source.sourceEventId,
      sourceModule: source.sourceModule,
      payerId: recordInput.payerId,
      payerType: recordInput.payerType,
      eventType: source.eventType,
      principalMinor: recordInput.principalMinor,
      currency: recordInput.currency,
      idempotencyKey: `fee:${recordInput.idempotencyKey}`,
      actorId: `meter:${source.sourceModule}`,
      correlationId: recordInput.correlationId,
      occurredAt: source.occurredAt,
      session,
    });
    const assessment = assessmentResult.assessment;
    const processed = await this.usageRepository.markProcessed(source.tenantId, usageRecord._id, {
      status: STATUS.ASSESSED,
      feeAssessmentId: String(assessment._id ?? assessment.id ?? ''),
      processedAt: this.clock(),
    }, { session });
    return { usageRecord: processed ?? await this.usageRepository.findByIdempotencyKey(source.tenantId, recordInput.idempotencyKey, { session }) ?? usageRecord, feeAssessment: assessment, idempotent: !created };
  }
}

export default TransactionRevenueService;
