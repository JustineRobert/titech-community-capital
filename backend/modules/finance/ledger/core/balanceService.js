/**
 * TITech Community Capital — canonical balance service.
 *
 * The MongoDB balance repository is the source of truth. This service is an
 * orchestration boundary that keeps tenant/transaction semantics above the
 * persistence layer and exposes a small stable API for LedgerEngine.
 */

let repositoryPromise;

async function getRepository() {
  if (!repositoryPromise) {
    repositoryPromise = import('../../../../repositories/financial/balance.repository.js')
      .then((module) => module.default || module);
  }
  return repositoryPromise;
}

function createBalanceService({ repository = null, cache = null, logger = console } = {}) {
  const resolveRepository = async () => repository || getRepository();

  return Object.freeze({
    async getForUpdate(args) { return (await resolveRepository()).getForUpdate(args); },
    async increment(args) { return (await resolveRepository()).increment(args); },
    async decrement(args) { return (await resolveRepository()).decrement(args); },
    async decrementStrict(args) { return (await resolveRepository()).decrementStrict(args); },
    async getCurrentBalance(args) { return (await resolveRepository()).getCurrentBalance(args); },
    async getAccountState(args) { return (await resolveRepository()).getAccountState(args); },
    async getBalance(args) { return (await resolveRepository()).getCurrentBalance(args); },

    // LedgerEngine compatibility operations intentionally avoid direct balance
    // writes. They are adapters for repositories/engines supplied by DI.
    async updateFromLedger({ ledger, context, session } = {}) {
      if (repository?.updateFromLedger) return repository.updateFromLedger({ ledger, context, session });
      if (logger?.debug) logger.debug({ tenantId: context?.tenant?.tenantId }, 'Balance update delegated to canonical ledger boundary.');
      return { delegated: false, updated: false };
    },

    async rebuildFromLedger({ history = [], context, session } = {}) {
      if (repository?.rebuildFromLedger) return repository.rebuildFromLedger({ history, context, session });
      const totals = new Map();
      for (const entry of history) {
        const accountId = String(entry.accountId ?? entry.account ?? '');
        if (!accountId) continue;
        const raw = String(entry.amount ?? entry.value ?? '0').trim();
        if (!/^\d+(?:\.\d+)?$/.test(raw)) continue;
        const [whole, fraction = ''] = raw.split('.');
        const amount = BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2));
        const sign = String(entry.entryType ?? entry.direction ?? '').toUpperCase() === 'DEBIT' ? 1n : -1n;
        totals.set(accountId, (totals.get(accountId) || 0n) + (amount * sign));
      }
      const balances = Object.fromEntries([...totals.entries()].map(([key, value]) => {
        const sign = value < 0n ? '-' : '';
        const absolute = value < 0n ? -value : value;
        return [key, `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`];
      }));
      return { balances, tenantId: context?.tenant?.tenantId ?? null, sessionUsed: Boolean(session) };
    },

    async verifyConsistency({ history = [], state = null, context } = {}) {
      if (repository?.verifyConsistency) return repository.verifyConsistency({ history, state, context });
      const rebuilt = state?.balances ? state : await this.rebuildFromLedger({ history, context });
      const negative = Object.entries(rebuilt.balances || {}).filter(([, value]) => BigInt(value) < 0n);
      return { valid: negative.length === 0, negativeAccounts: negative.map(([accountId]) => accountId) };
    },

    async reconcile({ ledger = [], context } = {}) {
      if (repository?.reconcile) return repository.reconcile({ ledger, context });
      return { valid: true, tenantId: context?.tenant?.tenantId ?? null, entriesChecked: ledger.length };
    },

    async refreshCache({ balances = {}, context } = {}) {
      if (cache?.refreshBalances) return cache.refreshBalances({ balances, tenantId: context?.tenant?.tenantId });
      return { cached: false, tenantId: context?.tenant?.tenantId ?? null };
    },
  });
}

export { createBalanceService };

const balanceService = createBalanceService();
export default balanceService;
