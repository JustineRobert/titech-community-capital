// backend/modules/finance/ledger/core/balanceService.js

/**
 * ESM facade for legacy consumers under the repository's `type: module`
 * boundary. The compatibility implementation is intentionally isolated in
 * `.cjs` so that CommonJS semantics remain explicit and executable.
 */
import balanceService from './balanceService.cjs';

export const {
  getForUpdate,
  increment,
  decrement,
  decrementStrict,
  getCurrentBalance,
  getAccountState,
  getBalance,
} = balanceService;

export default balanceService;
