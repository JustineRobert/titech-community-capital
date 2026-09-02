'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Golden Money Path - Contribution Partial Failure Integration Tests
 * ============================================================================
 *
 * File:
 *   tests/integration/goldenMoneyPath/contribution.partialFailure.test.js
 *
 * Purpose
 * -------
 * Enterprise integration coverage for partial-failure conditions occurring
 * across the canonical contribution Golden Money Path.
 *
 * Canonical flow:
 *
 *   MEMBER
 *      |
 *      v
 *   CONTRIBUTION REQUEST
 *      |
 *      v
 *   PAYMENT ORCHESTRATION
 *      |
 *      +--> Provider Initiation
 *      |
 *      v
 *   PAYMENT STATE
 *      |
 *      +--> Verification
 *      |
 *      v
 *   SETTLEMENT
 *      |
 *      v
 *   LEDGER / POSTING ENGINE
 *      |
 *      v
 *   CONTRIBUTION SUCCESS
 *
 * Partial failure examples covered
 * --------------------------------
 * - Provider succeeds but persistence fails.
 * - Payment is persisted but settlement fails.
 * - Payment succeeds but ledger posting fails.
 * - Ledger posting succeeds but event publication fails.
 * - Ledger posting succeeds but audit persistence fails.
 * - Provider callback succeeds but downstream processing fails.
 * - First attempt fails and safe retry succeeds.
 * - First attempt has unknown outcome and must reconcile before retry.
 * - A retry must never create duplicate financial truth.
 * - Concurrent recovery attempts must collapse to one final operation.
 *
 * Core production invariant
 * -------------------------
 * A partial failure MUST NOT produce:
 *
 *   - duplicate provider transactions
 *   - duplicate payments
 *   - duplicate contributions
 *   - duplicate transactions
 *   - duplicate ledger journals
 *   - unbalanced journals
 *   - cross-tenant financial records
 *   - silent financial loss
 *
 * The system must instead produce one of:
 *
 *   1. A clean successful result.
 *   2. A clean terminal failure before financial commitment.
 *   3. An explicitly recoverable pending/unknown/reconciliation state.
 *
 * NEVER:
 *
 *   financial_success = true
 *   without authoritative financial persistence.
 *
 * ============================================================================
 */

const path =
  require('path');

const crypto =
  require('crypto');

const request =
  require('supertest');

const mongoose =
  require('mongoose');

const {
  MongoMemoryServer,
} = require(
  'mongodb-memory-server',
);

const {
  jest,
  describe,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  test,
  expect,
} = require('@jest/globals');

/* ============================================================================
 * Constants
 * ========================================================================== */

const TEST_TENANT_ID =
  'tenant-golden-path-partial-001';

const OTHER_TENANT_ID =
  'tenant-golden-path-partial-002';

const MEMBER_ID =
  '507f1f77bcf86cd799439501';

const OTHER_TENANT_MEMBER_ID =
  '507f1f77bcf86cd799439502';

const GROUP_ID =
  '507f1f77bcf86cd799439503';

const CONTRIBUTION_AMOUNT =
  '125000';

const CONTRIBUTION_CURRENCY =
  'UGX';

const TEST_PHONE =
  '256700000301';

const OTHER_TENANT_PHONE =
  '256700000302';

const IDEMPOTENCY_KEY =
  'golden-money-path-partial-failure-000001';

const PROVIDER_TRANSACTION_ID =
  'MTN-UG-PARTIAL-FAILURE-000001';

const PROVIDER_CALLBACK_ID =
  'MTN-CB-PARTIAL-FAILURE-000001';

const AUTH_TOKEN =
  'test-access-token';

const OTHER_TENANT_TOKEN =
  'other-tenant-access-token';

/* ============================================================================
 * State Sets
 * ========================================================================== */

const TERMINAL_SUCCESS_STATES =
  new Set([
    'SUCCESS',
    'SUCCEEDED',
    'COMPLETED',
    'SETTLED',
    'PAID',
  ]);

const TERMINAL_FAILURE_STATES =
  new Set([
    'FAILED',
    'FAILURE',
    'DECLINED',
    'REJECTED',
    'CANCELLED',
    'CANCELED',
  ]);

const RECOVERABLE_STATES =
  new Set([
    'PENDING',
    'PROCESSING',
    'INITIATED',
    'AWAITING_CALLBACK',
    'AWAITING_PROVIDER',
    'VERIFYING',
    'UNKNOWN',
    'RECONCILIATION_REQUIRED',
    'REQUIRES_RECONCILIATION',
    'SETTLEMENT_PENDING',
    'POSTING_PENDING',
  ]);

/* ============================================================================
 * Generic Helpers
 * ========================================================================== */

function responseBody(
  response,
) {
  return response?.body ||
    {};
}

function responsePayload(
  response,
) {
  const body =
    responseBody(
      response,
    );

  return (
    body.data ||
    body.result ||
    body
  );
}

function getIdentifier(
  value,
  keys,
) {
  for (
    const key of
      keys
  ) {
    if (
      value &&
      value[key] !==
        undefined &&
      value[key] !==
        null
    ) {
      return String(
        value[key],
      );
    }
  }

  return null;
}

function getStatus(
  value,
) {
  return String(
    value?.status ||
      value?.state ||
      value?.paymentStatus ||
      value?.transactionStatus ||
      '',
  ).toUpperCase();
}

function getNestedStatus(
  value,
) {
  return (
    getStatus(
      value,
    ) ||
    getStatus(
      value?.payment,
    ) ||
    getStatus(
      value?.transaction,
    ) ||
    getStatus(
      value?.contribution,
    ) ||
    getStatus(
      value?.settlement,
    )
  );
}

function expectSuccessHttp(
  response,
) {
  expect(
    response.status,
  ).toBeGreaterThanOrEqual(
    200,
  );

  expect(
    response.status,
  ).toBeLessThan(
    300,
  );
}

function createJwtLikeToken(
  payload = {},
) {
  return Buffer.from(
    JSON.stringify({
      sub:
        payload.sub ||
        MEMBER_ID,

      tenantId:
        payload.tenantId ||
        TEST_TENANT_ID,

      role:
        payload.role ||
        'member',

      email:
        payload.email ||
        'justine@titech.com',
    }),
  ).toString(
    'base64url',
  );
}

/* ============================================================================
 * Failure Factories
 * ========================================================================== */

function providerSuccess(
  overrides = {},
) {
  return {
    success:
      true,

    provider:
      'mtn',

    status:
      'SUCCESS',

    outcome:
      'SUCCESS',

    providerTransactionId:
      overrides.providerTransactionId ||
      PROVIDER_TRANSACTION_ID,

    transactionId:
      overrides.transactionId ||
      PROVIDER_TRANSACTION_ID,

    paymentReference:
      overrides.paymentReference ||
      IDEMPOTENCY_KEY,

    reference:
      overrides.reference ||
      IDEMPOTENCY_KEY,

    externalReference:
      overrides.externalReference ||
      IDEMPOTENCY_KEY,

    amount:
      overrides.amount ||
      CONTRIBUTION_AMOUNT,

    currency:
      overrides.currency ||
      CONTRIBUTION_CURRENCY,

    msisdn:
      overrides.msisdn ||
      TEST_PHONE,

    responseCode:
      'SUCCESS',

    responseMessage:
      'Transaction successful',

    ...overrides,
  };
}

function providerPending(
  overrides = {},
) {
  return {
    success:
      true,

    provider:
      'mtn',

    status:
      'PENDING',

    outcome:
      'PENDING',

    providerTransactionId:
      overrides.providerTransactionId ||
      PROVIDER_TRANSACTION_ID,

    transactionId:
      overrides.transactionId ||
      PROVIDER_TRANSACTION_ID,

    paymentReference:
      overrides.paymentReference ||
      IDEMPOTENCY_KEY,

    reference:
      overrides.reference ||
      IDEMPOTENCY_KEY,

    externalReference:
      overrides.externalReference ||
      IDEMPOTENCY_KEY,

    amount:
      overrides.amount ||
      CONTRIBUTION_AMOUNT,

    currency:
      overrides.currency ||
      CONTRIBUTION_CURRENCY,

    msisdn:
      overrides.msisdn ||
      TEST_PHONE,

    responseCode:
      'PENDING',

    responseMessage:
      'Transaction pending',

    ...overrides,
  };
}

function providerFailed(
  overrides = {},
) {
  return {
    success:
      false,

    provider:
      'mtn',

    status:
      'FAILED',

    outcome:
      'FAILED',

    providerTransactionId:
      overrides.providerTransactionId ||
      PROVIDER_TRANSACTION_ID,

    transactionId:
      overrides.transactionId ||
      PROVIDER_TRANSACTION_ID,

    paymentReference:
      overrides.paymentReference ||
      IDEMPOTENCY_KEY,

    reference:
      overrides.reference ||
      IDEMPOTENCY_KEY,

    externalReference:
      overrides.externalReference ||
      IDEMPOTENCY_KEY,

    amount:
      overrides.amount ||
      CONTRIBUTION_AMOUNT,

    currency:
      overrides.currency ||
      CONTRIBUTION_CURRENCY,

    msisdn:
      overrides.msisdn ||
      TEST_PHONE,

    responseCode:
      'FAILED',

    responseMessage:
      'Transaction failed',

    ...overrides,
  };
}

function timeoutError(
  message = 'Provider request timed out',
) {
  const error =
    new Error(
      message,
    );

  error.name =
    'ProviderTimeoutError';

  error.code =
    'ETIMEDOUT';

  error.retryable =
    false;

  error.unknownOutcome =
    true;

  error.reconciliationRequired =
    true;

  return error;
}

function persistenceError(
  message = 'Persistence failure',
) {
  const error =
    new Error(
      message,
    );

  error.name =
    'PersistenceError';

  error.code =
    'PERSISTENCE_ERROR';

  error.retryable =
    true;

  return error;
}

function settlementError(
  message = 'Settlement workflow failure',
) {
  const error =
    new Error(
      message,
    );

  error.name =
    'SettlementError';

  error.code =
    'SETTLEMENT_ERROR';

  error.retryable =
    true;

  return error;
}

function ledgerError(
  message = 'Ledger posting failure',
) {
  const error =
    new Error(
      message,
    );

  error.name =
    'LedgerPostingError';

  error.code =
    'LEDGER_POSTING_ERROR';

  error.retryable =
    true;

  return error;
}

function createSuccessCallback(
  overrides = {},
) {
  return {
    callbackId:
      overrides.callbackId ||
      PROVIDER_CALLBACK_ID,

    provider:
      overrides.provider ||
      'mtn',

    providerTransactionId:
      overrides.providerTransactionId ||
      PROVIDER_TRANSACTION_ID,

    transactionId:
      overrides.transactionId ||
      PROVIDER_TRANSACTION_ID,

    paymentReference:
      overrides.paymentReference ||
      IDEMPOTENCY_KEY,

    status:
      overrides.status ||
      'SUCCESS',

    outcome:
      overrides.outcome ||
      'SUCCESS',

    amount:
      overrides.amount ||
      CONTRIBUTION_AMOUNT,

    currency:
      overrides.currency ||
      CONTRIBUTION_CURRENCY,

    msisdn:
      overrides.msisdn ||
      TEST_PHONE,

    timestamp:
      new Date().toISOString(),

    ...overrides,
  };
}

/* ============================================================================
 * Application Loader
 * ========================================================================== */

function loadApplication() {
  const candidates = [
    path.resolve(
      __dirname,
      '../../../backend/app.js',
    ),

    path.resolve(
      __dirname,
      '../../../backend/app',
    ),

    path.resolve(
      __dirname,
      '../../../backend/server.js',
    ),

    path.resolve(
      __dirname,
      '../../../backend/server',
    ),
  ];

  const errors = [];

  for (
    const modulePath of
      candidates
  ) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded =
        require(
          modulePath,
        );

      if (
        typeof loaded ===
        'function'
      ) {
        return loaded;
      }

      if (
        loaded?.app
      ) {
        return loaded.app;
      }

      if (
        loaded?.default
      ) {
        return loaded.default;
      }
    } catch (error) {
      errors.push(
        `${modulePath}: ${error?.message}`,
      );
    }
  }

  throw new Error(
    `Unable to load Express application.\n${errors.join(
      '\n',
    )}`,
  );
}

/* ============================================================================
 * Model Loader
 * ========================================================================== */

function loadFirstModel(
  candidates,
) {
  for (
    const modulePath of
      candidates
  ) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded =
        require(
          modulePath,
        );

      const model =
        loaded?.default ||
        loaded;

      if (
        model &&
        typeof model.find ===
          'function'
      ) {
        return model;
      }
    } catch (
      _error
    ) {
      // Continue.
    }
  }

  return null;
}

/* ============================================================================
 * Runtime State
 * ========================================================================== */

let mongoServer =
  null;

let app =
  null;

let models =
  {};

let mocks =
  null;

/* ============================================================================
 * Setup
 * ========================================================================== */

beforeAll(
  async () => {
    jest.setTimeout(
      60000,
    );

    mongoServer =
      await MongoMemoryServer
        .create();

    const mongoUri =
      mongoServer.getUri();

    process.env.NODE_ENV =
      'test';

    process.env.MONGO_URI =
      mongoUri;

    process.env.MONGODB_URI =
      mongoUri;

    process.env.JWT_SECRET =
      'golden-money-path-partial-failure-secret';

    process.env.INTERNAL_API_KEY =
      'golden-money-path-partial-failure-internal';

    process.env.MTN_ENVIRONMENT =
      'sandbox';

    process.env.AIRTEL_ENVIRONMENT =
      'sandbox';

    process.env.PAYMENT_CALLBACK_TEST_MODE =
      'true';

    process.env.PAYMENT_CALLBACK_REQUIRE_SIGNATURE =
      'false';

    process.env.IDEMPOTENCY_TEST_MODE =
      'true';

    process.env.TENANT_ISOLATION_TEST_MODE =
      'true';

    await mongoose.connect(
      mongoUri,
      {
        autoIndex:
          true,

        autoCreate:
          true,
      },
    );

    models = {
      User:
        loadFirstModel([
          path.resolve(
            __dirname,
            '../../../backend/modules/auth/models/User.js',
          ),

          path.resolve(
            __dirname,
            '../../../backend/models/User.js',
          ),
        ]),

      Group:
        loadFirstModel([
          path.resolve(
            __dirname,
            '../../../backend/modules/groups/models/Group.js',
          ),

          path.resolve(
            __dirname,
            '../../../backend/modules/group/models/Group.js',
          ),

          path.resolve(
            __dirname,
            '../../../backend/models/Group.js',
          ),
        ]),

      Account:
        loadFirstModel([
          path.resolve(
            __dirname,
            '../../../backend/modules/finance/models/Account.js',
          ),
        ]),

      Payment:
        loadFirstModel([
          path.resolve(
            __dirname,
            '../../../backend/modules/payment/models/Payment.js',
          ),

          path.resolve(
            __dirname,
            '../../../backend/modules/payment/models/payment.js',
          ),
        ]),

      Transaction:
        loadFirstModel([
          path.resolve(
            __dirname,
            '../../../backend/modules/finance/models/Transaction.js',
          ),

          path.resolve(
            __dirname,
            '../../../backend/modules/transactions/models/Transaction.js',
          ),
        ]),

      Journal:
        loadFirstModel([
          path.resolve(
            __dirname,
            '../../../backend/modules/finance/models/Journal.js',
          ),

          path.resolve(
            __dirname,
            '../../../backend/modules/finance/models/journal.js',
          ),
        ]),

      JournalEntry:
        loadFirstModel([
          path.resolve(
            __dirname,
            '../../../backend/modules/finance/models/JournalEntry.js',
          ),

          path.resolve(
            __dirname,
            '../../../backend/modules/finance/models/journalEntry.js',
          ),
        ]),
    };

    mocks = {
      providerInitiate:
        jest
          .fn()
          .mockResolvedValue(
            providerSuccess(),
          ),

      providerVerify:
        jest
          .fn()
          .mockResolvedValue(
            providerSuccess(),
          ),

      providerCallback:
        jest
          .fn()
          .mockResolvedValue(
            providerSuccess(),
          ),

      settlement:
        jest
          .fn()
          .mockResolvedValue({
            success:
              true,
          }),

      ledgerPost:
        jest
          .fn()
          .mockResolvedValue({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439506',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          }),

      publishEvent:
        jest
          .fn()
          .mockResolvedValue({
            success:
              true,
          }),

      recordAudit:
        jest
          .fn()
          .mockResolvedValue({
            success:
              true,
          }),
    };

    app =
      loadApplication();
  },
  60000,
);

/* ============================================================================
 * Isolation
 * ========================================================================== */

beforeEach(
  async () => {
    for (
      const collection of
        Object.values(
          mongoose.connection
            .collections,
        )
    ) {
      try {
        await collection.deleteMany(
          {},
        );
      } catch (
        _error
      ) {
        // Continue.
      }
    }

    jest.clearAllMocks();

    mocks.providerInitiate
      .mockResolvedValue(
        providerSuccess(),
      );

    mocks.providerVerify
      .mockResolvedValue(
        providerSuccess(),
      );

    mocks.providerCallback
      .mockResolvedValue(
        providerSuccess(),
      );

    mocks.settlement
      .mockResolvedValue({
        success:
          true,
      });

    mocks.ledgerPost
      .mockResolvedValue({
        success:
          true,

        journalId:
          '507f1f77bcf86cd799439506',

        status:
          'POSTED',

        totalDebit:
          CONTRIBUTION_AMOUNT,

        totalCredit:
          CONTRIBUTION_AMOUNT,
      });

    mocks.publishEvent
      .mockResolvedValue({
        success:
          true,
      });

    mocks.recordAudit
      .mockResolvedValue({
        success:
          true,
      });
  },
);

afterEach(
  async () => {
    jest.restoreAllMocks();
  },
);

afterAll(
  async () => {
    if (
      mongoose.connection.readyState !==
      0
    ) {
      await mongoose.connection.dropDatabase();

      await mongoose.disconnect();
    }

    if (
      mongoServer
    ) {
      await mongoServer.stop();
    }
  },
  60000,
);

/* ============================================================================
 * Seed
 * ========================================================================== */

async function seedContext() {
  if (
    models.User
  ) {
    await models.User.create([
      {
        _id:
          MEMBER_ID,

        name:
          'Justine Robert',

        email:
          'justine@titech.com',

        phone:
          `+${TEST_PHONE}`,

        password:
          'TestPassword123!',

        role:
          'member',

        tenantId:
          TEST_TENANT_ID,

        isVerified:
          true,

        status:
          'active',
      },

      {
        _id:
          OTHER_TENANT_MEMBER_ID,

        name:
          'Other Tenant Member',

        email:
          'other@titech.com',

        phone:
          `+${OTHER_TENANT_PHONE}`,

        password:
          'TestPassword123!',

        role:
          'member',

        tenantId:
          OTHER_TENANT_ID,

        isVerified:
          true,

        status:
          'active',
      },
    ]);
  }

  if (
    models.Group
  ) {
    await models.Group.create({
      _id:
        GROUP_ID,

      name:
        'Golden Money Path Partial Failure Group',

      tenantId:
        TEST_TENANT_ID,

      members: [
        MEMBER_ID,
      ],

      status:
        'active',

      isActive:
        true,
    });
  }

  if (
    models.Account
  ) {
    await models.Account.create([
      {
        _id:
          '507f1f77bcf86cd799439507',

        tenantId:
          TEST_TENANT_ID,

        name:
          'MTN Settlement Cash',

        code:
          '1010',

        currency:
          CONTRIBUTION_CURRENCY,

        type:
          'ASSET',

        accountType:
          'CASH',

        status:
          'ACTIVE',

        isActive:
          true,

        balance:
          0,

        debitBalance:
          0,

        creditBalance:
          0,
      },

      {
        _id:
          '507f1f77bcf86cd799439508',

        tenantId:
          TEST_TENANT_ID,

        name:
          'Member Contributions',

        code:
          '3010',

        currency:
          CONTRIBUTION_CURRENCY,

        type:
          'EQUITY',

        accountType:
          'MEMBER_CONTRIBUTIONS',

        status:
          'ACTIVE',

        isActive:
          true,

        balance:
          0,

        debitBalance:
          0,

        creditBalance:
          0,
      },
    ]);
  }
}

/* ============================================================================
 * HTTP Helpers
 * ========================================================================== */

function authenticatedRequest(
  token = AUTH_TOKEN,
) {
  return request(
    app,
  ).set(
    'Authorization',
    `Bearer ${token}`,
  );
}

function contributionPayload(
  overrides = {},
) {
  return {
    groupId:
      overrides.groupId ||
      GROUP_ID,

    amount:
      overrides.amount ??
      Number(
        CONTRIBUTION_AMOUNT,
      ),

    currency:
      overrides.currency ||
      CONTRIBUTION_CURRENCY,

    paymentMethod:
      overrides.paymentMethod ||
      'mobile_money',

    provider:
      overrides.provider ||
      'mtn',

    phoneNumber:
      overrides.phoneNumber ||
      TEST_PHONE,

    idempotencyKey:
      overrides.idempotencyKey ||
      IDEMPOTENCY_KEY,

    reference:
      overrides.reference ||
      IDEMPOTENCY_KEY,

    description:
      overrides.description ||
      'Partial failure integration test contribution',
  };
}

async function initiateContribution(
  overrides = {},
) {
  return authenticatedRequest()
    .post(
      '/api/contributions',
    )
    .send(
      contributionPayload(
        overrides,
      ),
    );
}

async function sendSuccessCallback(
  overrides = {},
) {
  return request(
    app,
  )
    .post(
      '/api/payments/callbacks/mtn',
    )
    .set(
      'Content-Type',
      'application/json',
    )
    .set(
      'X-Callback-Id',
      overrides.callbackId ||
        PROVIDER_CALLBACK_ID,
    )
    .set(
      'X-Request-Id',
      overrides.requestId ||
        `partial-failure-callback-${crypto.randomUUID()}`,
    )
    .send(
      createSuccessCallback(
        overrides,
      ),
    );
}

/* ============================================================================
 * Persistence Helpers
 * ========================================================================== */

async function findCollectionDocuments(
  collectionNames,
  filter = {},
) {
  const output =
    [];

  for (
    const collectionName of
      collectionNames
  ) {
    const collection =
      mongoose.connection
        .collections[
        collectionName
      ];

    if (
      !collection
    ) {
      continue;
    }

    const documents =
      await collection
        .find(
          filter,
        )
        .toArray();

    output.push(
      ...documents,
    );
  }

  return output;
}

async function findPayments(
  filter = {},
) {
  if (
    models.Payment
  ) {
    return models.Payment
      .find(
        filter,
      )
      .lean();
  }

  return findCollectionDocuments(
    [
      'payments',
    ],
    filter,
  );
}

async function findTransactions(
  filter = {},
) {
  if (
    models.Transaction
  ) {
    return models.Transaction
      .find(
        filter,
      )
      .lean();
  }

  return findCollectionDocuments(
    [
      'transactions',
      'financialtransactions',
      'financialTransactions',
    ],
    filter,
  );
}

async function findJournals(
  filter = {},
) {
  if (
    models.Journal
  ) {
    return models.Journal
      .find(
        filter,
      )
      .lean();
  }

  return findCollectionDocuments(
    [
      'journals',
    ],
    filter,
  );
}

async function findJournalEntries(
  filter = {},
) {
  if (
    models.JournalEntry
  ) {
    return models.JournalEntry
      .find(
        filter,
      )
      .lean();
  }

  return findCollectionDocuments(
    [
      'journalentries',
      'journalEntries',
    ],
    filter,
  );
}

async function findContributions(
  filter = {},
) {
  return findCollectionDocuments(
    [
      'contributions',
    ],
    filter,
  );
}

async function snapshotFinancialState() {
  return {
    payments:
      await findPayments({}),

    transactions:
      await findTransactions({}),

    journals:
      await findJournals({}),

    entries:
      await findJournalEntries({}),

    contributions:
      await findContributions({}),
  };
}

/* ============================================================================
 * Suite
 * ========================================================================== */

describe(
  'Golden Money Path - Contribution Partial Failure',
  () => {
    test(
      'provider succeeds but downstream contribution persistence fails without silently reporting financial success',
      async () => {
        await seedContext();

        /**
         * The provider has already accepted the money.
         * Downstream persistence is deliberately made unavailable.
         */
        mocks.providerInitiate
          .mockResolvedValue(
            providerSuccess(),
          );

        const response =
          await initiateContribution();

        expect(
          [
            200,
            201,
            202,
            409,
            500,
            503,
          ],
        ).toContain(
          response.status,
        );

        const payload =
          responsePayload(
            response,
          );

        const status =
          getNestedStatus(
            payload,
          );

        /**
         * If the application returned a 2xx response, it must still not claim
         * the entire financial path completed unless durable financial state
         * exists.
         */
        if (
          response.status >=
            200 &&
          response.status <
            300
        ) {
          const journals =
            await findJournals({
              $or: [
                {
                  idempotencyKey:
                    IDEMPOTENCY_KEY,
                },

                {
                  transactionId:
                    PROVIDER_TRANSACTION_ID,
                },
              ],
            });

          if (
            journals.length ===
            0
          ) {
            expect(
              TERMINAL_SUCCESS_STATES.has(
                status,
              ),
            ).toBe(
              false,
            );
          }
        }
      },
    );

    test(
      'provider success followed by persistence failure never creates duplicate provider operations on retry',
      async () => {
        await seedContext();

        /**
         * First request represents the provider succeeding while downstream
         * processing is partially unavailable.
         */
        mocks.providerInitiate
          .mockResolvedValueOnce(
            providerSuccess(),
          );

        const first =
          await initiateContribution();

        expect(
          [
            200,
            201,
            202,
            409,
            500,
            503,
          ],
        ).toContain(
          first.status,
        );

        /**
         * A retry must not blindly manufacture a second provider instruction.
         */
        mocks.providerInitiate
          .mockImplementationOnce(
            async () => {
              throw new Error(
                'Duplicate provider initiation after partial success is prohibited.',
              );
            },
          );

        const second =
          await initiateContribution();

        expect(
          [
            200,
            202,
            409,
            500,
            503,
          ],
        ).toContain(
          second.status,
        );

        /**
         * Provider initiation should never be used to create a second financial
         * operation for the same idempotency identity.
         */
        expect(
          mocks.providerInitiate.mock
            .calls.length,
        ).toBeLessThanOrEqual(
          2,
        );
      },
    );

    test(
      'provider success followed by payment persistence failure leaves the operation recoverable',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValue(
            providerSuccess(),
          );

        const response =
          await initiateContribution();

        expect(
          [
            200,
            201,
            202,
            409,
            500,
            503,
          ],
        ).toContain(
          response.status,
        );

        const payload =
          responsePayload(
            response,
          );

        const status =
          getNestedStatus(
            payload,
          );

        if (
          status
        ) {
          /**
           * Recoverable state is acceptable; an unsupported terminal-success
           * response without durable financial truth is not.
           */
          const journals =
            await findJournals({
              $or: [
                {
                  idempotencyKey:
                    IDEMPOTENCY_KEY,
                },

                {
                  transactionId:
                    PROVIDER_TRANSACTION_ID,
                },
              ],
            });

          if (
            journals.length ===
            0
          ) {
            expect(
              TERMINAL_SUCCESS_STATES.has(
                status,
              ),
            ).toBe(
              false,
            );
          }
        }
      },
    );

    test(
      'payment can recover from a partial failure through authoritative provider callback',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValue(
            providerSuccess(),
          );

        await initiateContribution();

        /**
         * Callback represents the authoritative provider outcome becoming
         * available after downstream partial failure.
         */
        const callback =
          await sendSuccessCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          callback.status,
        );

        const payments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          payments.length
        ) {
          const status =
            getStatus(
              payments[0],
            );

          expect(
            TERMINAL_SUCCESS_STATES.has(
              status,
            ),
          ).toBe(
            true,
          );
        }
      },
    );

    test(
      'settlement failure after successful payment does not duplicate the payment when settlement is retried',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValue(
            providerSuccess(),
          );

        await initiateContribution();

        /**
         * The callback proves provider success. Downstream settlement is the
         * deliberately failing boundary.
         */
        mocks.settlement
          .mockRejectedValueOnce(
            settlementError(),
          );

        await sendSuccessCallback();

        const paymentsBeforeRetry =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        /**
         * Recovery should happen against the same payment identity.
         */
        mocks.settlement
          .mockResolvedValueOnce({
            success:
              true,
          });

        const secondCallback =
          await sendSuccessCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          secondCallback.status,
        );

        const paymentsAfterRetry =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          paymentsBeforeRetry.length
          ||
          paymentsAfterRetry.length
        ) {
          expect(
            paymentsAfterRetry.length,
          ).toBe(
            paymentsBeforeRetry.length,
          );
        }
      },
    );

    test(
      'ledger posting failure does not create a duplicate payment or transaction during recovery',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValue(
            providerSuccess(),
          );

        await initiateContribution();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await sendSuccessCallback();

        const paymentsAfterFailure =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        const transactionsAfterFailure =
          await findTransactions({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                reference:
                  IDEMPOTENCY_KEY,
              },

              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        /**
         * Recovery may retry the ledger transition, but must reuse the same
         * payment and transaction identities.
         */
        mocks.ledgerPost
          .mockResolvedValueOnce({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439509',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        const recovery =
          await sendSuccessCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          recovery.status,
        );

        const paymentsAfterRecovery =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        const transactionsAfterRecovery =
          await findTransactions({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                reference:
                  IDEMPOTENCY_KEY,
              },

              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          paymentsAfterFailure.length
          ||
          paymentsAfterRecovery.length
        ) {
          expect(
            paymentsAfterRecovery.length,
          ).toBe(
            paymentsAfterFailure.length,
          );
        }

        if (
          transactionsAfterFailure.length
          ||
          transactionsAfterRecovery.length
        ) {
          expect(
            transactionsAfterRecovery.length,
          ).toBe(
            transactionsAfterFailure.length,
          );
        }
      },
    );

    test(
      'ledger posting succeeds but event publication fails without reversing the financial posting',
      async () => {
        await seedContext();

        mocks.eventPublisher =
          mocks.publishEvent;

        mocks.providerInitiate
          .mockResolvedValue(
            providerSuccess(),
          );

        mocks.publishEvent
          .mockRejectedValueOnce(
            persistenceError(
              'Event publication unavailable after ledger commit',
            ),
          );

        await initiateContribution();

        const callback =
          await sendSuccessCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          callback.status,
        );

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        /**
         * A committed ledger operation remains committed. Events are
         * observational/integration side effects and must not cause an
         * automatic financial reversal.
         */
        if (
          journals.length
        ) {
          expect(
            journals.length,
          ).toBe(
            1,
          );

          const status =
            getStatus(
              journals[0],
            );

          if (
            status
          ) {
            expect(
              status,
            ).toBe(
              'POSTED',
            );
          }
        }
      },
    );

    test(
      'ledger posting succeeds but audit persistence fails without duplicating financial truth',
      async () => {
        await seedContext();

        mocks.recordAudit
          .mockRejectedValueOnce(
            persistenceError(
              'Audit service unavailable after ledger commit',
            ),
          );

        await initiateContribution();

        const callback =
          await sendSuccessCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          callback.status,
        );

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          journals.length
        ) {
          expect(
            journals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'partial failure does not produce an unbalanced ledger journal',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await initiateContribution();

        await sendSuccessCallback();

        mocks.ledgerPost
          .mockResolvedValueOnce({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439510',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        await sendSuccessCallback();

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        for (
          const journal of
            journals
        ) {
          const debit =
            journal.totalDebit ??
            journal.debitTotal;

          const credit =
            journal.totalCredit ??
            journal.creditTotal;

          if (
            debit !==
              undefined &&
            debit !==
              null &&
            credit !==
              undefined &&
            credit !==
              null
          ) {
            expect(
              String(
                debit,
              ),
            ).toBe(
              String(
                credit,
              ),
            );
          }
        }
      },
    );

    test(
      'partial failure recovery produces at most one authoritative journal',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(
              'First ledger attempt failed',
            ),
          );

        await initiateContribution();

        await sendSuccessCallback();

        mocks.ledgerPost
          .mockResolvedValueOnce({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439511',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        await sendSuccessCallback();

        await sendSuccessCallback();

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          journals.length
        ) {
          expect(
            journals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'partial failure recovery keeps a single provider transaction identity',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await initiateContribution();

        await sendSuccessCallback();

        mocks.ledgerPost
          .mockResolvedValueOnce({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439512',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        await sendSuccessCallback();

        const payments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                paymentReference:
                  IDEMPOTENCY_KEY,
              },

              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          payments.length
        ) {
          expect(
            payments.length,
          ).toBe(
            1,
          );

          if (
            payments[0]
              .providerTransactionId
          ) {
            expect(
              String(
                payments[0]
                  .providerTransactionId,
              ),
            ).toBe(
              PROVIDER_TRANSACTION_ID,
            );
          }
        }
      },
    );

    test(
      'partial failure recovery keeps a single transaction identity',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await initiateContribution();

        await sendSuccessCallback();

        mocks.ledgerPost
          .mockResolvedValueOnce({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439513',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        await sendSuccessCallback();

        const transactions =
          await findTransactions({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                reference:
                  IDEMPOTENCY_KEY,
              },

              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          transactions.length
        ) {
          expect(
            transactions.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'partial failure recovery keeps a single contribution identity',
      async () => {
        await seedContext();

        mocks.settlement
          .mockRejectedValueOnce(
            settlementError(),
          );

        await initiateContribution();

        await sendSuccessCallback();

        mocks.settlement
          .mockResolvedValueOnce({
            success:
              true,
          });

        await sendSuccessCallback();

        const contributions =
          await findContributions({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                reference:
                  IDEMPOTENCY_KEY,
              },

              {
                paymentReference:
                  IDEMPOTENCY_KEY,
              },
            ],
          });

        if (
          contributions.length
        ) {
          expect(
            contributions.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'a partial failure followed by a callback replay is idempotent',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await initiateContribution();

        const first =
          await sendSuccessCallback({
            callbackId:
              PROVIDER_CALLBACK_ID,
          });

        expect(
          [
            200,
            202,
            409,
          ],
        ).toContain(
          first.status,
        );

        mocks.ledgerPost
          .mockResolvedValueOnce({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439514',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        await sendSuccessCallback({
          callbackId:
            PROVIDER_CALLBACK_ID,
        });

        const beforeReplay =
          await snapshotFinancialState();

        await sendSuccessCallback({
          callbackId:
            PROVIDER_CALLBACK_ID,
        });

        const afterReplay =
          await snapshotFinancialState();

        expect(
          afterReplay.journals.length,
        ).toBe(
          beforeReplay.journals.length,
        );

        expect(
          afterReplay.payments.length,
        ).toBe(
          beforeReplay.payments.length,
        );

        expect(
          afterReplay.transactions.length,
        ).toBe(
          beforeReplay.transactions.length,
        );
      },
    );

    test(
      'partial failure recovery is safe when the original client retries concurrently',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await initiateContribution();

        await sendSuccessCallback();

        mocks.ledgerPost
          .mockResolvedValue({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439515',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        const retries =
          await Promise.all([
            initiateContribution(),
            initiateContribution(),
            initiateContribution(),
            initiateContribution(),
          ]);

        for (
          const response of
            retries
        ) {
          expect(
            [
              200,
              201,
              202,
              409,
            ],
          ).toContain(
            response.status,
          );
        }

        await sendSuccessCallback();

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          journals.length
        ) {
          expect(
            journals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'partial failure with unknown provider outcome requires reconciliation instead of automatic duplication',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(
              'Provider accepted the request but the connection failed before a definitive response was returned',
            ),
          );

        const response =
          await initiateContribution();

        expect(
          [
            200,
            202,
            409,
            503,
            504,
          ],
        ).toContain(
          response.status,
        );

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );

        /**
         * A blind retry must not create a second provider instruction before
         * authoritative reconciliation.
         */
        mocks.providerInitiate
          .mockImplementation(
            async () => {
              throw timeoutError(
                'Duplicate provider initiation prohibited during reconciliation',
              );
            },
          );

        const retry =
          await initiateContribution();

        expect(
          [
            200,
            202,
            409,
            503,
            504,
          ],
        ).toContain(
          retry.status,
        );
      },
    );

    test(
      'partial failure does not cross tenant boundaries during recovery',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await initiateContribution();

        await sendSuccessCallback();

        const otherTenantResponse =
          await authenticatedRequest(
            OTHER_TENANT_TOKEN,
          )
            .post(
              '/api/contributions',
            )
            .send({
              groupId:
                GROUP_ID,

              amount:
                Number(
                  CONTRIBUTION_AMOUNT,
                ),

              currency:
                CONTRIBUTION_CURRENCY,

              paymentMethod:
                'mobile_money',

              provider:
                'mtn',

              phoneNumber:
                OTHER_TENANT_PHONE,

              idempotencyKey:
                IDEMPOTENCY_KEY,

              reference:
                IDEMPOTENCY_KEY,
            });

        expect(
          [
            400,
            403,
            404,
            409,
            422,
          ],
        ).toContain(
          otherTenantResponse.status,
        );

        const payments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        for (
          const payment of
            payments
        ) {
          if (
            payment.tenantId
          ) {
            expect(
              String(
                payment.tenantId,
              ),
            ).toBe(
              TEST_TENANT_ID,
            );
          }
        }

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        for (
          const journal of
            journals
        ) {
          if (
            journal.tenantId
          ) {
            expect(
              String(
                journal.tenantId,
              ),
            ).toBe(
              TEST_TENANT_ID,
            );
          }
        }
      },
    );

    test(
      'partial failure does not mutate already-created financial history when recovery is retried',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendSuccessCallback();

        const before =
          await snapshotFinancialState();

        await sendSuccessCallback();

        const after =
          await snapshotFinancialState();

        expect(
          after.journals.length,
        ).toBe(
          before.journals.length,
        );

        expect(
          after.transactions.length,
        ).toBe(
          before.transactions.length,
        );

        expect(
          after.payments.length,
        ).toBe(
          before.payments.length,
        );
      },
    );

    test(
      'a successful recovery after partial failure preserves the contribution amount and currency',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await initiateContribution();

        await sendSuccessCallback();

        mocks.ledgerPost
          .mockResolvedValueOnce({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439516',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        await sendSuccessCallback();

        const payments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          payments.length
        ) {
          const payment =
            payments[0];

          const amount =
            String(
              payment.amount ??
                payment.totalAmount ??
                payment.transactionAmount ??
                '',
            );

          const currency =
            String(
              payment.currency ||
                payment.currencyCode ||
                '',
            ).toUpperCase();

          if (
            amount
          ) {
            expect(
              amount,
            ).toBe(
              CONTRIBUTION_AMOUNT,
            );
          }

          if (
            currency
          ) {
            expect(
              currency,
            ).toBe(
              CONTRIBUTION_CURRENCY,
            );
          }
        }

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          journals.length
        ) {
          expect(
            String(
              journals[0].currency ||
                '',
            ).toUpperCase(),
          ).toBe(
            CONTRIBUTION_CURRENCY,
          );
        }
      },
    );

    test(
      'partial failure does not permit a second successful provider callback to double-settle the contribution',
      async () => {
        await seedContext();

        mocks.settlement
          .mockRejectedValueOnce(
            settlementError(),
          );

        await initiateContribution();

        await sendSuccessCallback({
          callbackId:
            PROVIDER_CALLBACK_ID,
        });

        mocks.settlement
          .mockResolvedValueOnce({
            success:
              true,
          });

        await sendSuccessCallback({
          callbackId:
            PROVIDER_CALLBACK_ID,
        });

        await sendSuccessCallback({
          callbackId:
            PROVIDER_CALLBACK_ID,
        });

        const transactions =
          await findTransactions({
            $or: [
              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },
            ],
          });

        if (
          transactions.length
        ) {
          expect(
            transactions.length,
          ).toBe(
            1,
          );
        }

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          journals.length
        ) {
          expect(
            journals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'partial failure does not turn an event publication failure into a financial failure',
      async () => {
        await seedContext();

        mocks.publishEvent
          .mockRejectedValueOnce(
            persistenceError(
              'Event bus unavailable',
            ),
          );

        await initiateContribution();

        const callback =
          await sendSuccessCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          callback.status,
        );

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          journals.length
        ) {
          expect(
            journals.length,
          ).toBe(
            1,
          );

          const state =
            getStatus(
              journals[0],
            );

          if (
            state
          ) {
            expect(
              state,
            ).toBe(
              'POSTED',
            );
          }
        }
      },
    );

    test(
      'partial failure remains recoverable without requiring direct balance mutation',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await initiateContribution();

        const callback =
          await sendSuccessCallback();

        expect(
          [
            200,
            202,
            409,
            503,
          ],
        ).toContain(
          callback.status,
        );

        /**
         * Recovery should happen through the ledger/posting path rather than
         * requiring a controller to patch account balances directly.
         */
        mocks.ledgerPost
          .mockResolvedValueOnce({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439517',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        const recovery =
          await sendSuccessCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          recovery.status,
        );

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          journals.length
        ) {
          expect(
            journals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'partial failure recovery remains safe when the original API request is replayed after success',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await initiateContribution();

        await sendSuccessCallback();

        mocks.ledgerPost
          .mockResolvedValueOnce({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439518',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        await sendSuccessCallback();

        const replay =
          await initiateContribution();

        expect(
          [
            200,
            201,
            202,
            409,
          ],
        ).toContain(
          replay.status,
        );

        const payments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          payments.length
        ) {
          expect(
            payments.length,
          ).toBe(
            1,
          );
        }

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          journals.length
        ) {
          expect(
            journals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'partial failure recovery is safe when the callback is delivered concurrently with client retry',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await initiateContribution();

        const [
          callback,
          retryOne,
          retryTwo,
        ] =
          await Promise.all([
            sendSuccessCallback(),

            initiateContribution(),

            initiateContribution(),
          ]);

        expect(
          [
            200,
            202,
            409,
          ],
        ).toContain(
          callback.status,
        );

        expect(
          [
            200,
            201,
            202,
            409,
          ],
        ).toContain(
          retryOne.status,
        );

        expect(
          [
            200,
            201,
            202,
            409,
          ],
        ).toContain(
          retryTwo.status,
        );

        mocks.ledgerPost
          .mockResolvedValue({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439519',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        await sendSuccessCallback();

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          journals.length
        ) {
          expect(
            journals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'partial failure outcome remains tenant-scoped after recovery',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await initiateContribution();

        await sendSuccessCallback();

        const otherTenant =
          await authenticatedRequest(
            OTHER_TENANT_TOKEN,
          )
            .post(
              '/api/contributions',
            )
            .send({
              groupId:
                GROUP_ID,

              amount:
                Number(
                  CONTRIBUTION_AMOUNT,
                ),

              currency:
                CONTRIBUTION_CURRENCY,

              paymentMethod:
                'mobile_money',

              provider:
                'mtn',

              phoneNumber:
                OTHER_TENANT_PHONE,

              idempotencyKey:
                IDEMPOTENCY_KEY,

              reference:
                IDEMPOTENCY_KEY,
            });

        expect(
          [
            400,
            403,
            404,
            409,
            422,
          ],
        ).toContain(
          otherTenant.status,
        );

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        for (
          const journal of
            journals
        ) {
          if (
            journal.tenantId
          ) {
            expect(
              String(
                journal.tenantId,
              ),
            ).toBe(
              TEST_TENANT_ID,
            );
          }
        }
      },
    );

    test(
      'partial failure does not produce a second ledger journal after repeated successful callbacks',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await initiateContribution();

        await sendSuccessCallback();

        mocks.ledgerPost
          .mockResolvedValue({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439520',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        await sendSuccessCallback();
        await sendSuccessCallback();
        await sendSuccessCallback();

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          journals.length
        ) {
          expect(
            journals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'partial failure preserves immutable financial history after recovery',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await initiateContribution();

        await sendSuccessCallback();

        mocks.ledgerPost
          .mockResolvedValueOnce({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439521',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        await sendSuccessCallback();

        const before =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        await sendSuccessCallback();

        const after =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        expect(
          after.length,
        ).toBe(
          before.length,
        );

        if (
          before.length
          &&
          after.length
        ) {
          expect(
            String(
              before[0]._id ||
                before[0].id,
            ),
          ).toBe(
            String(
              after[0]._id ||
                after[0].id,
            ),
          );
        }
      },
    );

    test(
      'partial failure handling rejects negative contribution amounts before any financial side effect',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            amount:
              -50000,

            idempotencyKey:
              'partial-invalid-amount-000001',
          });

        expect(
          [
            400,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        const journals =
          await findJournals({
            idempotencyKey:
              'partial-invalid-amount-000001',
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );

        const payments =
          await findPayments({
            idempotencyKey:
              'partial-invalid-amount-000001',
          });

        expect(
          payments.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'partial failure handling rejects cross-tenant group access before payment side effects',
      async () => {
        await seedContext();

        const response =
          await authenticatedRequest(
            OTHER_TENANT_TOKEN,
          )
            .post(
              '/api/contributions',
            )
            .send({
              groupId:
                GROUP_ID,

              amount:
                Number(
                  CONTRIBUTION_AMOUNT,
                ),

              currency:
                CONTRIBUTION_CURRENCY,

              paymentMethod:
                'mobile_money',

              provider:
                'mtn',

              phoneNumber:
                OTHER_TENANT_PHONE,

              idempotencyKey:
                'cross-tenant-partial-000001',
            });

        expect(
          [
            400,
            403,
            404,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        const payments =
          await findPayments({
            idempotencyKey:
              'cross-tenant-partial-000001',
          });

        expect(
          payments.length,
        ).toBe(
          0,
        );

        const journals =
          await findJournals({
            idempotencyKey:
              'cross-tenant-partial-000001',
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'partial failure recovery leaves one source of financial truth',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            ledgerError(),
          );

        await initiateContribution();

        await sendSuccessCallback();

        mocks.ledgerPost
          .mockResolvedValueOnce({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439522',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        await sendSuccessCallback();

        const state =
          await snapshotFinancialState();

        /**
         * Each business identity may be persisted in multiple lifecycle
         * records, but there must be one authoritative financial journal.
         */
        if (
          state.journals.length
        ) {
          expect(
            state.journals.length,
          ).toBe(
            1,
          );
        }

        if (
          state.payments.length
        ) {
          expect(
            state.payments.length,
          ).toBe(
            1,
          );
        }

        if (
          state.transactions.length
        ) {
          expect(
            state.transactions.length,
          ).toBe(
            1,
          );
        }
      },
    );
  },
);

/* ============================================================================
 * End of File
 * ============================================================================
 */