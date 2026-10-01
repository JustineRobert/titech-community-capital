'use strict';

const { PayrollError } = require('./payroll.errors.cjs');

const BATCH_STATES = Object.freeze([
  'DRAFT',
  'UPLOADED',
  'VALIDATING',
  'VALIDATED',
  'PENDING_APPROVAL',
  'APPROVED',
  'PROCESSING',
  'PARTIALLY_PROCESSED',
  'SUBMITTED',
  'SETTLEMENT_PENDING',
  'SETTLED',
  'RECONCILING',
  'RECONCILED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
]);

const TRANSITIONS = Object.freeze({
  DRAFT: ['VALIDATING', 'CANCELLED', 'EXPIRED'],
  UPLOADED: ['VALIDATING', 'PENDING_APPROVAL', 'CANCELLED', 'EXPIRED'],
  VALIDATING: ['VALIDATED', 'FAILED', 'CANCELLED'],
  VALIDATED: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'CANCELLED', 'EXPIRED'],
  APPROVED: ['PROCESSING', 'CANCELLED', 'EXPIRED'],
  PROCESSING: ['PARTIALLY_PROCESSED', 'SUBMITTED', 'SETTLEMENT_PENDING', 'FAILED'],
  PARTIALLY_PROCESSED: ['PROCESSING', 'SUBMITTED', 'FAILED', 'CANCELLED'],
  SUBMITTED: ['SETTLEMENT_PENDING', 'RECONCILING', 'FAILED'],
  SETTLEMENT_PENDING: ['SETTLED', 'RECONCILING', 'FAILED'],
  SETTLED: ['RECONCILING'],
  RECONCILING: ['RECONCILED', 'FAILED'],
  RECONCILED: ['COMPLETED'],
  COMPLETED: [],
  FAILED: ['VALIDATING', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'CANCELLED'],
  CANCELLED: [],
  EXPIRED: [],
});

const ROLE_TRANSITIONS = Object.freeze({
  submit: ['PAYROLL_MAKER', 'PAYROLL_ADMIN', 'ADMIN', 'EMPLOYER_ADMIN'],
  approve: ['PAYROLL_CHECKER', 'PAYROLL_APPROVER', 'PAYROLL_ADMIN', 'ADMIN'],
  reject: ['PAYROLL_CHECKER', 'PAYROLL_APPROVER', 'PAYROLL_ADMIN', 'ADMIN'],
  process: ['PAYROLL_ADMIN', 'ADMIN'],
  reconcile: ['RECONCILIATION_OFFICER', 'FINANCE_OFFICER', 'PAYROLL_ADMIN', 'ADMIN'],
});

function normalizeRole(role) {
  return String(role || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
}

function canTransition(from, to) {
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

function assertTransition(from, to) {
  if (!BATCH_STATES.includes(from) || !BATCH_STATES.includes(to)) {
    throw new PayrollError('PAYROLL_STATE_INVALID', `Unsupported payroll state transition ${from} -> ${to}.`, 409, { from, to });
  }
  if (!canTransition(from, to)) {
    throw new PayrollError('PAYROLL_INVALID_STATE_TRANSITION', `Payroll batch cannot transition from ${from} to ${to}.`, 409, { from, to, allowed: TRANSITIONS[from] || [] });
  }
}

function assertRoleForTransition(action, roles) {
  const normalized = (Array.isArray(roles) ? roles : [roles]).map(normalizeRole).filter(Boolean);
  const allowed = ROLE_TRANSITIONS[action] || [];
  if (!normalized.some((role) => allowed.includes(role))) {
    throw new PayrollError('PAYROLL_FORBIDDEN', `Role is not authorized to ${action} a payroll batch.`, 403, { action, allowedRoles: allowed });
  }
}

function assertMakerCheckerSeparation(makerId, checkerId) {
  if (makerId && checkerId && String(makerId) === String(checkerId)) {
    throw new PayrollError('PAYROLL_SOD_VIOLATION', 'The payroll creator cannot approve the same payroll batch.', 403);
  }
}

module.exports = {
  BATCH_STATES,
  TRANSITIONS,
  ROLE_TRANSITIONS,
  canTransition,
  assertTransition,
  assertRoleForTransition,
  assertMakerCheckerSeparation,
};
