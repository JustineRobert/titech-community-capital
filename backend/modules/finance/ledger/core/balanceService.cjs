// backend/modules/finance/ledger/core/balanceService.cjs

/**
 * TITech Community Capital — canonical balance-service compatibility bridge.
 *
 * The authoritative persistence implementation lives in
 * `backend/repositories/financial/balance.repository.js`. This CommonJS
 * boundary exists because the legacy finance/ledger engine is still loaded by
 * CommonJS modules. It deliberately delegates every operation to the
 * repository and never owns balance truth itself.
 *
 * Non-responsibilities:
 * - starting/committing/aborting MongoDB transactions;
 * - creating ledger entries;
 * - authorization/tenant selection;
 * - storing an independent cached balance.
 */

let repositoryPromise;

function getRepository() {
  if (!repositoryPromise) {
    repositoryPromise = import(
      '../../../../repositories/financial/balance.repository.js'
    ).then((module) => module.default || module);
  }

  return repositoryPromise;
}

async function getForUpdate(args) {
  return (await getRepository()).getForUpdate(args);
}

async function increment(args) {
  return (await getRepository()).increment(args);
}

async function decrement(args) {
  return (await getRepository()).decrement(args);
}

async function decrementStrict(args) {
  return (await getRepository()).decrementStrict(args);
}

async function getCurrentBalance(args) {
  return (await getRepository()).getCurrentBalance(args);
}

async function getAccountState(args) {
  return (await getRepository()).getAccountState(args);
}

const balanceService = Object.freeze({
  getForUpdate,
  increment,
  decrement,
  decrementStrict,
  getCurrentBalance,
  getAccountState,
  getBalance: getCurrentBalance,
});

module.exports = balanceService;
module.exports.default = balanceService;
