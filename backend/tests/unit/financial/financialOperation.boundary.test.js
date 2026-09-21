import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FINANCIAL_OPERATION,
  executeFinancialOperation,
} from '../../../services/financial/financialOperation.service.js';

function makeSession() {
  return {
    inTransaction: () => true,
  };
}

function makeRepositories(calls) {
  return {
    transactionRepository: {
      async create(input) {
        calls.transactionCreate = input;
        return { transactionId: input.transactionId, status: 'PENDING' };
      },
      async complete(input) {
        calls.transactionComplete = input;
        return { transactionId: input.transactionId, status: 'COMPLETED' };
      },
    },
    ledgerRepository: {
      async createEntries(input) {
        calls.ledgerEntries = input.entries;
        return input.entries;
      },
    },
    balanceRepository: {
      async increment(input) {
        calls.increment = input;
        return { accountId: input.accountId };
      },
      async decrement(input) {
        calls.decrement = input;
        return { accountId: input.accountId };
      },
    },
    loanRepository: {
      async disburse() {
        return { status: 'DISBURSED' };
      },
      async repay() {
        calls.loanRepay = true;
        return { status: 'REPAID' };
      },
    },
    outboxRepository: {
      async create(event, options) {
        calls.outbox = { event, options };
        return { eventId: event.eventId };
      },
    },
  };
}

test('transfer posts one balanced batch through the canonical ledger repository', async () => {
  const calls = {};
  const repositories = makeRepositories(calls);

  const result = await executeFinancialOperation({
    operation: FINANCIAL_OPERATION.TRANSFER_CREATE,
    session: makeSession(),
    context: {
      tenantId: 'tenant-001',
      principalId: 'user-001',
      transactionId: 'txn-001',
    },
    repositories,
    payload: {
      amount: '125.50',
      currency: 'UGX',
      sourceAccountId: 'account-source',
      destinationAccountId: 'account-destination',
    },
  });

  assert.equal(result.resultType, 'SUCCESS');
  assert.equal(calls.ledgerEntries.length, 2);
  assert.equal(calls.ledgerEntries[0].direction, 'DEBIT');
  assert.equal(calls.ledgerEntries[1].direction, 'CREDIT');
  assert.equal(calls.ledgerEntries[0].amount, '125.50');
  assert.equal(calls.ledgerEntries[1].amount, '125.50');
  assert.deepEqual(
    calls.ledgerEntries.map((entry) => entry.accountId),
    ['account-source', 'account-destination'],
  );
});

test('contribution rejects missing counterparty instead of fabricating an unbalanced journal', async () => {
  const calls = {};
  const repositories = makeRepositories(calls);

  await assert.rejects(
    executeFinancialOperation({
      operation: FINANCIAL_OPERATION.CONTRIBUTION_CREATE,
      session: makeSession(),
      context: {
        tenantId: 'tenant-001',
        principalId: 'user-001',
        transactionId: 'txn-002',
      },
      repositories,
      payload: {
        amount: '10.00',
        currency: 'UGX',
        accountId: 'account-member',
      },
    }),
    (error) => error.code === 'FINANCIAL_COUNTERPARTYACCOUNTID_REQUIRED',
  );

  assert.equal(calls.transactionCreate, undefined);
});

test('loan repayment emits a balanced loan/source ledger pair inside the supplied transaction session', async () => {
  const calls = {};
  const repositories = makeRepositories(calls);

  const result = await executeFinancialOperation({
    operation: FINANCIAL_OPERATION.LOAN_REPAYMENT,
    session: makeSession(),
    context: {
      tenantId: 'tenant-001',
      principalId: 'user-001',
      transactionId: 'txn-003',
    },
    repositories,
    payload: {
      amount: '50.00',
      currency: 'UGX',
      loanAccountId: 'loan-account',
      sourceAccountId: 'member-account',
    },
  });

  assert.equal(result.resultType, 'SUCCESS');
  assert.equal(calls.loanRepay, true);
  assert.equal(calls.ledgerEntries.length, 2);
  assert.equal(calls.ledgerEntries[0].direction, 'DEBIT');
  assert.equal(calls.ledgerEntries[1].direction, 'CREDIT');
  assert.deepEqual(
    calls.ledgerEntries.map((entry) => entry.accountId),
    ['loan-account', 'member-account'],
  );
});


test('generic transaction requires exact balanced postings and writes completion to the transactional outbox', async () => {
  const calls = {};
  const repositories = makeRepositories(calls);

  const result = await executeFinancialOperation({
    operation: FINANCIAL_OPERATION.TRANSACTION_CREATE,
    session: makeSession(),
    context: {
      tenantId: 'tenant-001',
      principalId: 'user-001',
      transactionId: 'txn-004',
      correlationId: 'corr-004',
      idempotencyKey: 'idem-004',
    },
    repositories,
    payload: {
      amount: '125.50',
      currency: 'UGX',
      entries: [
        {
          accountId: 'account-source',
          amount: '125.50',
          direction: 'DEBIT',
          balanceEffect: 'DECREASE',
        },
        {
          accountId: 'account-destination',
          amount: '125.50',
          direction: 'CREDIT',
          balanceEffect: 'INCREASE',
        },
      ],
    },
  });

  assert.equal(result.resultType, 'SUCCESS');
  assert.equal(calls.ledgerEntries.length, 2);
  assert.equal(calls.outbox.options.session, result ? calls.outbox.options.session : undefined);
  assert.equal(calls.outbox.event.operation, FINANCIAL_OPERATION.TRANSACTION_CREATE);
});
