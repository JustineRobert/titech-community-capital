'use strict';

/**
 * TITech Community Capital
 * Explicit interest-accrual service boundary.
 *
 * This module replaces a previously empty runtime import with a fail-closed
 * contract. Interest accrual is financial accounting logic and must not be
 * simulated by returning zero or mutating balances directly.
 *
 * A future implementation must be injected/configured through this boundary
 * and settle through the canonical financial transaction/ledger services.
 */

const ERROR_CODE = 'INTEREST_ACCRUAL_ENGINE_NOT_CONFIGURED';

let engine = null;

function configureInterestAccrualEngine(nextEngine) {
  if (!nextEngine || typeof nextEngine !== 'object') {
    throw new TypeError('A valid interest accrual engine is required.');
  }

  if (
    typeof nextEngine.accrueSavingsInterest !== 'function' ||
    typeof nextEngine.accrueLoanInterest !== 'function'
  ) {
    throw new TypeError(
      'Interest accrual engine must implement accrueSavingsInterest and accrueLoanInterest.',
    );
  }

  engine = nextEngine;
  return engine;
}

function requireEngine() {
  if (!engine) {
    const error = new Error(
      'Interest accrual is intentionally fail-closed until a canonical accounting engine is configured.',
    );
    error.code = ERROR_CODE;
    error.statusCode = 503;
    throw error;
  }

  return engine;
}

async function accrueSavingsInterest(options = {}) {
  return requireEngine().accrueSavingsInterest(options);
}

async function accrueLoanInterest(options = {}) {
  return requireEngine().accrueLoanInterest(options);
}

module.exports = Object.freeze({
  configureInterestAccrualEngine,
  accrueSavingsInterest,
  accrueLoanInterest,
  ERROR_CODE,
});
