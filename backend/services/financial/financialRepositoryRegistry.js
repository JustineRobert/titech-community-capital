// ============================================================================
// backend/services/financial/financialRepositoryRegistry.js
// ============================================================================
// One dependency-injection point for the authoritative financial operation
// service. Controllers never instantiate repositories ad hoc.
// ============================================================================

import { createRequire } from 'node:module';

import balanceRepository from '../../repositories/financial/balance.repository.js';
import financialTransactionRepository from '../../repositories/financial/financialTransaction.repository.js';
import ledgerRepository from '../../repositories/financial/ledger.repository.js';
import loanRepository from '../../repositories/financial/loan.repository.js';
const require = createRequire(import.meta.url);

const TransactionOutboxRepositoryModule =
  require('../../modules/transactions/repositories/TransactionOutboxRepository.js');

const outboxRepository =
  new TransactionOutboxRepositoryModule.TransactionOutboxRepository();

const financialRepositoryRegistry = Object.freeze({
  transactionRepository: financialTransactionRepository,
  ledgerRepository,
  balanceRepository,
  loanRepository,
  outboxRepository,
});

export default financialRepositoryRegistry;
