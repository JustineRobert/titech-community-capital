/**
 * TITech Community Capital — account lock control boundary.
 *
 * This module intentionally provides an in-memory coordination primitive for
 * process-local tests and DI contracts. Production distributed locking must be
 * backed by the configured Redis/transaction infrastructure; this boundary
 * never mutates balances or ledger history.
 */

class AccountLockServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AccountLockServiceError';
    this.code = code;
    this.details = details;
  }
}

class AccountLockService {
  constructor({ clock = () => Date.now() } = {}) {
    this.clock = clock;
    this.locks = new Map();
  }

  acquire({ tenantId, accountId, ownerId, ttlMs = 30_000 } = {}) {
    if (!tenantId || !accountId || !ownerId) {
      throw new AccountLockServiceError('LOCK_CONTEXT_REQUIRED', 'tenantId, accountId and ownerId are required.');
    }
    const key = `${tenantId}:${accountId}`;
    const existing = this.locks.get(key);
    const now = this.clock();
    if (existing && existing.expiresAt > now && existing.ownerId !== ownerId) {
      throw new AccountLockServiceError('ACCOUNT_LOCKED', 'Account is already locked.', { tenantId, accountId });
    }
    const token = `${ownerId}:${now}`;
    this.locks.set(key, { ownerId, token, expiresAt: now + ttlMs });
    return { acquired: true, key, token, expiresAt: new Date(now + ttlMs).toISOString() };
  }

  release({ tenantId, accountId, token } = {}) {
    const key = `${tenantId}:${accountId}`;
    const current = this.locks.get(key);
    if (!current) return { released: false, reason: 'NOT_LOCKED' };
    if (current.token !== token) {
      throw new AccountLockServiceError('LOCK_TOKEN_MISMATCH', 'Lock token does not match the current owner.');
    }
    this.locks.delete(key);
    return { released: true, key };
  }

  diagnostics() {
    return { module: 'AccountLockService', activeLocks: this.locks.size, mode: 'DI_LOCAL_COORDINATION' };
  }
}

const createAccountLockService = (options = {}) => new AccountLockService(options);

export { AccountLockService, AccountLockServiceError, createAccountLockService };
export default AccountLockService;
