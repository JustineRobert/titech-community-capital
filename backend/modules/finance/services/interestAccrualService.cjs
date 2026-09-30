/**
 * ============================================================================
 * TITech Community Capital — Interest Accrual Service
 * ============================================================================
 *
 * This service is the canonical boundary used by the scheduled interest job.
 *
 * Important financial safety rule:
 *   The service will not invent an interest-rate policy or mutate a balance
 *   without an explicit, caller-supplied accrual amount. Until the repository's
 *   authoritative batch-calculation policy is wired to a reviewed product and
 *   accounting configuration, the tenant-wide job returns NOT_CONFIGURED.
 *
 * This is intentionally safer than a silent no-op or guessed monetary formula.
 * The existing ledger/accounting services remain the only posting authority.
 * ============================================================================
 */
'use strict';

const ZERO = '0.00';
const SUPPORTED_MODES = Object.freeze([
  'NOT_CONFIGURED',
  'PRECALCULATED',
]);

function normalizeAmount(value) {
  if (value === null || value === undefined || value === '') {
    return ZERO;
  }

  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new TypeError('Interest amount must be a non-negative decimal with up to 2 fractional digits.');
  }

  const [whole, fraction = ''] = raw.split('.');
  return `${whole.replace(/^0+(?=\d)/, '') || '0'}.${fraction.padEnd(2, '0')}`;
}

function buildDeferredResult({ kind, tenantId, reason = 'INTEREST_ACCRUAL_POLICY_NOT_CONFIGURED' }) {
  return Object.freeze({
    success: true,
    status: 'NOT_CONFIGURED',
    mode: 'NOT_CONFIGURED',
    kind,
    tenantId,
    processed: 0,
    totalInterest: ZERO,
    reason,
  });
}

function buildPrecalculatedResult({
  kind,
  tenantId,
  processed = 0,
  totalInterest = ZERO,
}) {
  const normalizedProcessed = Number(processed);
  if (!Number.isSafeInteger(normalizedProcessed) || normalizedProcessed < 0) {
    throw new TypeError('processed must be a non-negative safe integer.');
  }

  return Object.freeze({
    success: true,
    status: 'PRECALCULATED',
    mode: 'PRECALCULATED',
    kind,
    tenantId,
    processed: normalizedProcessed,
    totalInterest: normalizeAmount(totalInterest),
  });
}

function resolveMode(options = {}) {
  const requested = String(
    options.mode || process.env.TITECH_INTEREST_ACCRUAL_MODE || 'NOT_CONFIGURED',
  ).trim().toUpperCase();

  if (!SUPPORTED_MODES.includes(requested)) {
    throw new TypeError(`Unsupported interest accrual mode: ${requested}`);
  }

  return requested;
}

async function accrueSavingsInterest({ tenantId, ...options } = {}) {
  if (!tenantId) {
    throw new TypeError('tenantId is required for savings interest accrual.');
  }

  const mode = resolveMode(options);
  if (mode === 'PRECALCULATED') {
    return buildPrecalculatedResult({
      kind: 'SAVINGS',
      tenantId,
      processed: options.processed,
      totalInterest: options.totalInterest,
    });
  }

  return buildDeferredResult({
    kind: 'SAVINGS',
    tenantId,
  });
}

async function accrueLoanInterest({ tenantId, ...options } = {}) {
  if (!tenantId) {
    throw new TypeError('tenantId is required for loan interest accrual.');
  }

  const mode = resolveMode(options);
  if (mode === 'PRECALCULATED') {
    return buildPrecalculatedResult({
      kind: 'LOAN',
      tenantId,
      processed: options.processed,
      totalInterest: options.totalInterest,
    });
  }

  return buildDeferredResult({
    kind: 'LOAN',
    tenantId,
  });
}

module.exports = Object.freeze({
  ZERO,
  SUPPORTED_MODES,
  normalizeAmount,
  accrueSavingsInterest,
  accrueLoanInterest,
});
