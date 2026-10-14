'use strict';

// ============================================================================
// TITech Community Capital
// backend/modules/finance/__tests__/repayment.int.test.js
//
// Repayment Integration Tests
// ============================================================================
// Coverage:
// - Real Express repayment endpoint against in-memory MongoDB
// - Valid repayment and persisted financial effects
// - Exact monetary assertions using integer minor units
// - Journal creation and repayment amount verification
// - Idempotency-key duplicate protection
// - Idempotency-key reuse with a different payload
// - Insufficient-funds rejection and no unintended writes
// - Zero and negative repayment validation
// - Database and environment cleanup
//
// IMPORTANT:
// - Use the actual production Express application, models, middleware,
//   repayment service, and ledger/journal implementation.
// - Do not mock the financial service or bypass production validation.
// - Configure TITECH_TEST_AUTH_TOKEN with a valid locally issued test token
//   if the app requires a real JWT.
// - Update MODULE_PATHS if the repository uses different canonical paths.
// - These tests do not prove production readiness or external payment-provider
//   settlement; they test the local repayment API and its persisted effects.
// ============================================================================

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const pathToFileURL = require('node:url').pathToFileURL;

// ============================================================================
// CONFIGURATION
// ============================================================================

const MODULE_PATHS = {
  Loan: '../../models/Loan',
  Wallet: '../../models/Wallet',
  Journal: '../../models/Journal',

  // This preserves the path from the original test. Change it to the actual
  // Express application module if your repository exports it elsewhere.
  app:
    process.env.TITECH_TEST_APP_MODULE || '../../../../app',
};

const ENV_KEYS_TO_RESTORE = [
  'NODE_ENV',
  'MONGODB_URI',
  'MONGO_URI',
  'MONGO_URL',
];

const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS_TO_RESTORE.map((key) => [
    key,
    process.env[key],
  ])
);

const TEST_AUTH_TOKEN =
  process.env.TITECH_TEST_AUTH_TOKEN || 'test-token';

// ============================================================================
// TEST STATE
// ============================================================================

let mongod;
let app;
let Loan;
let Wallet;
let Journal;

jest.setTimeout(60000);

// ============================================================================
// MODULE LOADING
// ============================================================================

/**
 * Loads the actual repository module.
 *
 * Supports CommonJS modules and falls back to dynamic import for ES modules.
 * This does not replace or mock the production implementation.
 */
async function loadActualModule(moduleSpecifier) {
  const resolvedPath = require.resolve(moduleSpecifier);

  try {
    return require(resolvedPath);
  } catch (error) {
    const isEsmLoadingError =
      error?.code === 'ERR_REQUIRE_ESM' ||
      /Must use import to load ES Module/i.test(error?.message || '') ||
      /require\(\) of ES Module/i.test(error?.message || '');

    if (!isEsmLoadingError) {
      throw error;
    }

    return import(pathToFileURL(resolvedPath).href);
  }
}

function unwrapModel(moduleValue, exportName) {
  const candidates = [
    moduleValue?.[exportName],
    moduleValue?.default?.[exportName],
    moduleValue?.default,
    moduleValue,
  ];

  return candidates.find(
    (candidate) =>
      typeof candidate === 'function' &&
      typeof candidate.findById === 'function' &&
      typeof candidate.countDocuments === 'function'
  );
}

function unwrapExpressApp(moduleValue) {
  const candidates = [
    moduleValue?.app,
    moduleValue?.default?.app,
    moduleValue?.default,
    moduleValue,
  ];

  return candidates.find(
    (candidate) =>
      typeof candidate === 'function' &&
      (typeof candidate.use === 'function' ||
        typeof candidate.handle === 'function')
  );
}

// ============================================================================
// FINANCIAL TEST HELPERS
// ============================================================================

function decimal128(amount) {
  return mongoose.Types.Decimal128.fromString(String(amount));
}

/**
 * Converts a decimal monetary value to integer minor units.
 *
 * This avoids floating-point comparisons for the two-decimal amounts used
 * by these integration tests. Values with meaningful precision beyond two
 * decimal places are rejected rather than silently truncated.
 */
function toMinorUnits(value) {
  if (value === null || value === undefined) {
    throw new TypeError('Cannot convert an empty monetary value.');
  }

  const text =
    typeof value === 'number'
      ? value.toFixed(2)
      : value.toString();

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);

  if (!match) {
    throw new TypeError(
      `Unsupported monetary representation: ${text}`
    );
  }

  const negative = match[1] === '-';
  const whole = BigInt(match[2]);
  const fraction = match[3] || '';

  if (
    fraction.length > 2 &&
    /[1-9]/.test(fraction.slice(2))
  ) {
    throw new RangeError(
      `Unexpected precision beyond two decimal places: ${text}`
    );
  }

  const minorPart = BigInt(
    fraction.slice(0, 2).padEnd(2, '0') || '0'
  );

  const absoluteValue = whole * 100n + minorPart;

  return negative ? -absoluteValue : absoluteValue;
}

function createRepaymentPayload(loan, wallet, amount) {
  return {
    loanId: loan._id.toString(),
    walletId: wallet._id.toString(),
    amount,
  };
}

function repaymentRequest(idempotencyKey, payload) {
  return request(app)
    .post('/api/finance/repay')
    .set('Idempotency-Key', idempotencyKey)
    .set('Authorization', `Bearer ${TEST_AUTH_TOKEN}`)
    .send(payload);
}

async function createRepaymentFixture({
  walletBalance = '1000.00',
  loanBalance = '500.00',
  loanStatus = 'ACTIVE',
} = {}) {
  const tenantId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const wallet = await Wallet.create({
    tenantId,
    ownerId: userId,
    balance: decimal128(walletBalance),
  });

  const loan = await Loan.create({
    tenantId,
    memberId: userId,
    principal: decimal128('500.00'),
    interestRate: 0,
    termMonths: 12,
    balance: decimal128(loanBalance),
    status: loanStatus,
  });

  return {
    tenantId,
    userId,
    wallet,
    loan,
  };
}

async function expectPersistedBalances({
  walletId,
  loanId,
  expectedWalletBalance,
  expectedLoanBalance,
}) {
  const [wallet, loan] = await Promise.all([
    Wallet.findById(walletId),
    Loan.findById(loanId),
  ]);

  expect(wallet).not.toBeNull();
  expect(loan).not.toBeNull();

  expect(toMinorUnits(wallet.balance)).toBe(
    toMinorUnits(expectedWalletBalance)
  );

  expect(toMinorUnits(loan.balance)).toBe(
    toMinorUnits(expectedLoanBalance)
  );
}

async function clearDatabase() {
  const collections = Object.values(
    mongoose.connection.collections
  );

  for (const collection of collections) {
    await collection.deleteMany({});
  }

  // Ensure model indexes, including any unique indexes declared in schemas,
  // are ready before requests are issued.
  await Promise.all(
    [Loan, Wallet, Journal].map((model) =>
      model.createIndexes()
    )
  );
}

function restoreEnvironment() {
  for (const key of ENV_KEYS_TO_RESTORE) {
    const originalValue = ORIGINAL_ENV[key];

    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
}

// ============================================================================
// SETUP AND TEARDOWN
// ============================================================================

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();

  const mongoUri = mongod.getUri();

  // Set the most common MongoDB environment variables before loading the app.
  // The application may use only one of these; preserve their original values
  // and restore them during teardown.
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = mongoUri;
  process.env.MONGO_URI = mongoUri;
  process.env.MONGO_URL = mongoUri;

  await mongoose.connect(mongoUri);

  // Load models and application after the isolated database is configured.
  const [loanModule, walletModule, journalModule, appModule] =
    await Promise.all([
      loadActualModule(MODULE_PATHS.Loan),
      loadActualModule(MODULE_PATHS.Wallet),
      loadActualModule(MODULE_PATHS.Journal),
      loadActualModule(MODULE_PATHS.app),
    ]);

  Loan = unwrapModel(loanModule, 'Loan');
  Wallet = unwrapModel(walletModule, 'Wallet');
  Journal = unwrapModel(journalModule, 'Journal');
  app = unwrapExpressApp(appModule);

  if (!Loan || !Wallet || !Journal) {
    throw new TypeError(
      'Could not resolve the actual Loan, Wallet, or Journal model. ' +
        'Check MODULE_PATHS and the model exports.'
    );
  }

  if (!app) {
    throw new TypeError(
      'Could not resolve the Express application export. ' +
        'TITECH_TEST_APP_MODULE must identify a module exporting an ' +
        'Express app, not only a server or startup function.'
    );
  }

  await Promise.all(
    [Loan, Wallet, Journal].map((model) =>
      model.createIndexes()
    )
  );
});

afterAll(async () => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  } finally {
    try {
      if (mongod) {
        await mongod.stop();
      }
    } finally {
      restoreEnvironment();
    }
  }
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) {
    throw new Error(
      'Repayment integration test requires an active MongoDB connection.'
    );
  }

  await clearDatabase();
});

// ============================================================================
// REPAYMENT INTEGRATION TESTS
// ============================================================================

describe('POST /api/finance/repay', () => {
  test('processes a repayment and persists the expected financial effects', async () => {
    const { wallet, loan } = await createRepaymentFixture();

    const idempotencyKey = 'repayment-success-001';
    const payload = createRepaymentPayload(loan, wallet, 200);

    const response = await repaymentRequest(
      idempotencyKey,
      payload
    ).expect(200);

    expect(response.body.success).toBe(true);

    const journalId = response.body?.result?.journalId;

    expect(journalId).toBeDefined();

    const journal = await Journal.findById(journalId);

    expect(journal).not.toBeNull();
    expect(toMinorUnits(journal.amount)).toBe(20000n);

    // Wallet: UGX 1,000.00 - UGX 200.00 = UGX 800.00
    // Loan:   UGX   500.00 - UGX 200.00 = UGX 300.00
    await expectPersistedBalances({
      walletId: wallet._id,
      loanId: loan._id,
      expectedWalletBalance: '800.00',
      expectedLoanBalance: '300.00',
    });

    expect(await Journal.countDocuments({})).toBe(1);
  });

  test('rejects a duplicate idempotency key without applying a second repayment', async () => {
    const { wallet, loan } = await createRepaymentFixture();

    const idempotencyKey = 'repayment-duplicate-001';
    const payload = createRepaymentPayload(loan, wallet, 100);

    await repaymentRequest(
      idempotencyKey,
      payload
    ).expect(200);

    expect(await Journal.countDocuments({})).toBe(1);

    // This test preserves the existing API contract supplied in the original
    // test: duplicate use of the same key returns HTTP 409 / CONFLICT.
    const duplicateResponse = await repaymentRequest(
      idempotencyKey,
      payload
    ).expect(409);

    expect(duplicateResponse.body.success).toBe(false);
    expect(duplicateResponse.body.code).toBe('CONFLICT');

    // Verify that a retry did not debit the wallet or loan twice.
    await expectPersistedBalances({
      walletId: wallet._id,
      loanId: loan._id,
      expectedWalletBalance: '900.00',
      expectedLoanBalance: '400.00',
    });

    expect(await Journal.countDocuments({})).toBe(1);
  });

  test('rejects reuse of an idempotency key with a different repayment payload', async () => {
    const { wallet, loan } = await createRepaymentFixture();

    const idempotencyKey = 'repayment-payload-mismatch-001';

    const originalPayload = createRepaymentPayload(
      loan,
      wallet,
      100
    );

    await repaymentRequest(
      idempotencyKey,
      originalPayload
    ).expect(200);

    const alteredPayload = createRepaymentPayload(
      loan,
      wallet,
      150
    );

    const alteredResponse = await repaymentRequest(
      idempotencyKey,
      alteredPayload
    );

    expect(alteredResponse.status).toBe(409);
    expect(alteredResponse.body.success).toBe(false);
    expect(alteredResponse.body.code).toBe('CONFLICT');

    // The original successful operation should remain the only financial
    // mutation associated with this key.
    await expectPersistedBalances({
      walletId: wallet._id,
      loanId: loan._id,
      expectedWalletBalance: '900.00',
      expectedLoanBalance: '400.00',
    });

    expect(await Journal.countDocuments({})).toBe(1);
  });

  test('returns insufficient-funds response without changing balances or journals', async () => {
    const { wallet, loan } = await createRepaymentFixture({
      walletBalance: '50.00',
      loanBalance: '500.00',
    });

    const payload = createRepaymentPayload(
      loan,
      wallet,
      100
    );

    const response = await repaymentRequest(
      'repayment-insufficient-funds-001',
      payload
    ).expect(402);

    expect(response.body.success).toBe(false);
    expect(response.body.code).toBe('PAYMENT_REQUIRED');

    await expectPersistedBalances({
      walletId: wallet._id,
      loanId: loan._id,
      expectedWalletBalance: '50.00',
      expectedLoanBalance: '500.00',
    });

    expect(await Journal.countDocuments({})).toBe(0);
  });

  test.each([
    ['zero amount', 0],
    ['negative amount', -1],
  ])(
    'rejects a %s without changing financial records',
    async (_description, amount) => {
      const { wallet, loan } = await createRepaymentFixture();

      const payload = createRepaymentPayload(
        loan,
        wallet,
        amount
      );

      const response = await repaymentRequest(
        `repayment-invalid-amount-${amount}`,
        payload
      );

      // APIs may standardize invalid amounts as 400 or 422. Both indicate
      // client-side validation failure; adjust to the single documented
      // response code once the actual route contract is confirmed.
      expect([400, 422]).toContain(response.status);
      expect(response.body.success).toBe(false);

      await expectPersistedBalances({
        walletId: wallet._id,
        loanId: loan._id,
        expectedWalletBalance: '1000.00',
        expectedLoanBalance: '500.00',
      });

      expect(await Journal.countDocuments({})).toBe(0);
    }
  );
});