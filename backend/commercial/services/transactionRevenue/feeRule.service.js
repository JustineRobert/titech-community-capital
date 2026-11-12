/** Authoritative resolution of approved, tenant-scoped commercial fee rules. */
import {
  TransactionRevenueAuthorizationError,
  TransactionRevenueConflictError,
  TransactionRevenueNotFoundError,
  TransactionRevenueValidationError,
} from '../../errors/transactionRevenue.errors.js';

function required(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TransactionRevenueValidationError(`${field} is required.`, { field });
  }
  return value.trim();
}

function asDate(value, field) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TransactionRevenueValidationError(`${field} must be a valid date.`, { field });
  return date;
}

function isEffective(rule, at) {
  if (rule.status !== 'ACTIVE' || rule.approvalStatus !== 'APPROVED') return false;
  if (rule.effectiveFrom && new Date(rule.effectiveFrom) > at) return false;
  if (rule.effectiveTo && new Date(rule.effectiveTo) < at) return false;
  return true;
}

function specificity(rule) {
  return (rule.contractId ? 32 : 0) +
    (rule.institutionId ? 16 : 0) +
    (rule.payerType ? 8 : 0) +
    (rule.eventType ? 4 : 0);
}

function scopeMatches(rule, scope, field) {
  return !rule[field] || String(rule[field]) === String(scope ?? '');
}

export class FeeRuleService {
  constructor({ repository, authorize = null, clock = () => new Date() } = {}) {
    if (!repository || typeof repository.findApplicableRules !== 'function') {
      throw new TypeError('FeeRuleService requires repository.findApplicableRules.');
    }
    if (typeof clock !== 'function') throw new TypeError('clock must be a function.');
    this.repository = repository;
    this.authorize = authorize;
    this.clock = clock;
  }

  async resolve({
    tenantId,
    serviceId,
    currency,
    institutionId = null,
    contractId = null,
    payerType = null,
    eventType = null,
    effectiveAt = this.clock(),
    session = null,
  } = {}) {
    const scope = {
      tenantId: required(tenantId, 'tenantId'),
      serviceId: required(serviceId, 'serviceId'),
      currency: required(currency, 'currency').toUpperCase(),
      institutionId,
      contractId,
      payerType,
      eventType,
      effectiveAt: asDate(effectiveAt, 'effectiveAt'),
    };

    const candidates = await this.repository.findApplicableRules(scope, { session });
    const eligible = (Array.isArray(candidates) ? candidates : [])
      .filter((rule) => String(rule.tenantId) === scope.tenantId)
      .filter((rule) => String(rule.serviceId) === scope.serviceId)
      .filter((rule) => String(rule.currency).toUpperCase() === scope.currency)
      .filter((rule) => scopeMatches(rule, scope.institutionId, 'institutionId'))
      .filter((rule) => scopeMatches(rule, scope.contractId, 'contractId'))
      .filter((rule) => scopeMatches(rule, scope.payerType, 'payerType'))
      .filter((rule) => scopeMatches(rule, scope.eventType, 'eventType'))
      .filter((rule) => isEffective(rule, scope.effectiveAt));

    if (eligible.length === 0) {
      throw new TransactionRevenueNotFoundError(
        'No approved and effective fee rule exists for this service and commercial context.',
        { tenantId: scope.tenantId, serviceId: scope.serviceId, currency: scope.currency },
      );
    }

    eligible.sort((left, right) => {
      const priorityDelta = Number(right.priority ?? 0) - Number(left.priority ?? 0);
      if (priorityDelta !== 0) return priorityDelta;
      return specificity(right) - specificity(left);
    });

    const top = eligible[0];
    const topScore = `${Number(top.priority ?? 0)}:${specificity(top)}`;
    const tied = eligible.filter((candidate) => `${Number(candidate.priority ?? 0)}:${specificity(candidate)}` === topScore);
    const uniqueIds = new Set(tied.map((candidate) => String(candidate._id ?? candidate.id ?? candidate.ruleCode ?? '')));
    if (uniqueIds.size > 1) {
      throw new TransactionRevenueConflictError(
        'Multiple fee rules have equal precedence; pricing is ambiguous and must be corrected by an authorised administrator.',
        { tenantId: scope.tenantId, serviceId: scope.serviceId, currency: scope.currency, candidateCount: tied.length },
      );
    }

    if (top.approvalStatus !== 'APPROVED' || top.status !== 'ACTIVE') {
      throw new TransactionRevenueConflictError('The selected fee rule is not approved and active.');
    }
    return top;
  }

  async approve({ tenantId, ruleId, makerId, approverId, reason, correlationId = null } = {}) {
    const tenant = required(tenantId, 'tenantId');
    const id = required(ruleId, 'ruleId');
    const maker = required(makerId, 'makerId');
    const approver = required(approverId, 'approverId');
    const approvalReason = required(reason, 'reason');
    if (maker === approver) {
      throw new TransactionRevenueConflictError('The fee-rule maker cannot approve their own rule.');
    }
    if (typeof this.authorize !== 'function') {
      throw new TransactionRevenueAuthorizationError('Fee-rule approval is disabled until an authoritative RBAC permission checker is configured.');
    }
    const permitted = await this.authorize({
      tenantId: tenant,
      actorId: approver,
      permission: 'commercial:fee-rule:approve',
      resourceId: id,
    });
    if (permitted !== true) throw new TransactionRevenueAuthorizationError();
    if (typeof this.repository.approveDraft !== 'function') {
      throw new TypeError('FeeRuleRepository must implement atomic approveDraft.');
    }
    const approved = await this.repository.approveDraft({
      tenantId: tenant,
      ruleId: id,
      makerId: maker,
      approverId: approver,
      reason: approvalReason,
      approvedAt: this.clock(),
      correlationId,
    });
    if (!approved) {
      throw new TransactionRevenueConflictError('Fee rule is missing, no longer a draft, or does not match the stated maker.');
    }
    return approved;
  }
}

export default FeeRuleService;
