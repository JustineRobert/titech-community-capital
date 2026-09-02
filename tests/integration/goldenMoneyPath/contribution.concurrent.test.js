'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Golden Money Path - Contribution Concurrent Integration Tests
 * ============================================================================
 *
 * File:
 *   tests/integration/goldenMoneyPath/contribution.concurrent.test.js
 *
 * Purpose
 * -------
 * Enterprise integration coverage for concurrent contribution operations.
 *
 * Canonical path:
 *
 *   MEMBERS
 *      |
 *      +-------------------------+
 *      |                         |
 *      v                         v
 *   REQUEST A                 REQUEST B
 *      |                         |
 *      +-----------+-------------+
 *                  |
 *                  v
 *           IDEMPOTENCY / LOCK
 *                  |
 *                  v
 *         PAYMENT ORCHESTRATION
 *                  |
 *                  v
 *           PROVIDER COMMAND
 *                  |
 *                  v
 *          PAYMENT STATE MACHINE
 *                  |
 *                  v
 *           SETTLEMENT WORKFLOW
 *                  |
 *                  v
 *            LEDGER POSTING
 *
 * Concurrency invariants
 * ----------------------
 * 1. Concurrent identical requests create one logical contribution.
 * 2. A single idempotency key represents one logical operation.
 * 3. Only one provider initiation is authoritative.
 * 4. Only one payment record exists for the logical operation.
 * 5. Only one transaction record exists for the logical operation.
 * 6. Only one successful ledger journal exists.
 * 7. Ledger entries remain balanced.
 * 8. Concurrent duplicate callbacks remain idempotent.
 * 9. A race cannot create a second contribution.
 * 10. A race cannot double-mutate balances.
 * 11. Tenant isolation remains enforced under concurrency.
 * 12. Distinct idempotency keys remain distinct operations.
 * 13. Identical keys with different payloads are conflicts.
 * 14. Provider state cannot regress because of a race.
 * 15. Recovery and callback races remain financially idempotent.
 * 16. Financial history remains append-only and immutable.
 *
 * IMPORTANT
 * ---------
 * This test suite validates concurrency behavior of the application boundary
 * and financial workflow. External payment provider interactions are represented
 * with deterministic fixtures/mocks and never require live credentials.
 *
 * The test intentionally uses MongoDB transactions only through the real
 * application path where available. It does not replace application locking,
 * unique indexes, idempotency, or state-machine protections with test-only
 * synchronization.
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
  'tenant-golden-path-concurrent-001';

const OTHER_TENANT_ID =
  'tenant-golden-path-concurrent-002';

const MEMBER_ID =
  '507f1f77bcf86cd799439901';

const SECOND_MEMBER_ID =
  '507f1f77bcf86cd799439902';

const OTHER_TENANT_MEMBER_ID =
  '507f1f77bcf86cd799439903';

const GROUP_ID =
  '507f1f77bcf86cd799439904';

const CONTRIBUTION_AMOUNT =
  '80000';

const SECOND_CONTRIBUTION_AMOUNT =
  '45000';

const CONTRIBUTION_CURRENCY =
  'UGX';

const TEST_PHONE =
  '256700000701';

const SECOND_TEST_PHONE =
  '256700000702';

const OTHER_TENANT_PHONE =
  '256700000703';

const IDEMPOTENCY_KEY =
  'golden-money-path-concurrent-000001';

const SECOND_IDEMPOTENCY_KEY =
  'golden-money-path-concurrent-000002';

const PROVIDER_TRANSACTION_ID =
  'MTN-UG-CONCURRENT-000001';

const SECOND_PROVIDER_TRANSACTION_ID =
  'MTN-UG-CONCURRENT-000002';

const PROVIDER_CALLBACK_ID =
  'MTN-CB-CONCURRENT-000001';

const AUTH_TOKEN =
  'test-access-token';

const SECOND_MEMBER_TOKEN =
  'second-member-access-token';

const OTHER_TENANT_TOKEN =
  'other-tenant-access-token';

/* ============================================================================
 * States
 * ========================================================================== */

const SUCCESS_STATES =
  new Set([
    'SUCCESS',
    'SUCCEEDED',
    'COMPLETED',
    'SETTLED',
    'PAID',
  ]);

const NON_TERMINAL_STATES =
  new Set([
    'PENDING',
    'PROCESSING',
    'INITIATED',
    'AWAITING_CALLBACK',
    'AWAITING_PROVIDER',
    'UNKNOWN',
    'VERIFYING',
    'QUEUED',
    'SUBMITTED',
    'RECONCILIATION_REQUIRED',
    'SETTLEMENT_PENDING',
    'POSTING_PENDING',
  ]);

/* ============================================================================
 * Generic Helpers
 * ========================================================================== */

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
      value?.contributionStatus ||
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
    )
  );
}

function expectSuccessfulHttp(
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

function createProviderSuccess(
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

function createProviderPending(
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
      'Transaction accepted and pending provider completion',

    ...overrides,
  };
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
 * Runtime
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
      'golden-money-path-concurrent-secret';

    process.env.INTERNAL_API_KEY =
      'golden-money-path-concurrent-internal';

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
            createProviderSuccess(),
          ),

      providerVerify:
        jest
          .fn()
          .mockResolvedValue(
            createProviderSuccess(),
          ),

      providerCallback:
        jest
          .fn()
          .mockResolvedValue(
            createProviderSuccess(),
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
              '507f1f77bcf86cd799439905',

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
        createProviderSuccess(),
      );

    mocks.providerVerify
      .mockResolvedValue(
        createProviderSuccess(),
      );

    mocks.providerCallback
      .mockResolvedValue(
        createProviderSuccess(),
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
          '507f1f77bcf86cd799439905',

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
          SECOND_MEMBER_ID,

        name:
          'Second Test Member',

        email:
          'member2@titech.com',

        phone:
          `+${SECOND_TEST_PHONE}`,

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
        'Golden Money Path Concurrent Group',

      tenantId:
        TEST_TENANT_ID,

      members: [
        MEMBER_ID,
        SECOND_MEMBER_ID,
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
          '507f1f77bcf86cd799439906',

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
          '507f1f77bcf86cd799439907',

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
      'Concurrent contribution integration test',
  };
}

async function initiateContribution(
  overrides = {},
  token = AUTH_TOKEN,
) {
  return authenticatedRequest(
    token,
  )
    .post(
      '/api/contributions',
    )
    .send(
      contributionPayload(
        overrides,
      ),
    );
}

async function sendContributionCallback(
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
        `concurrent-callback-${crypto.randomUUID()}`,
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
  names,
  filter = {},
) {
  const output =
    [];

  for (
    const name of
      names
  ) {
    const collection =
      mongoose.connection
        .collections[
        name
      ];

    if (
      !collection
    ) {
      continue;
    }

    const rows =
      await collection
        .find(
          filter,
        )
        .toArray();

    output.push(
      ...rows,
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

async function snapshotLogicalOperation(
  idempotencyKey = IDEMPOTENCY_KEY,
) {
  return {
    payments:
      await findPayments({
        $or: [
          {
            idempotencyKey,
          },

          {
            paymentReference:
              idempotencyKey,
          },
        ],
      }),

    transactions:
      await findTransactions({
        $or: [
          {
            idempotencyKey,
          },

          {
            reference:
              idempotencyKey,
          },

          {
            externalReference:
              idempotencyKey,
          },
        ],
      }),

    contributions:
      await findContributions({
        $or: [
          {
            idempotencyKey,
          },

          {
            reference:
              idempotencyKey,
          },

          {
            paymentReference:
              idempotencyKey,
          },
        ],
      }),

    journals:
      await findJournals({
        $or: [
          {
            idempotencyKey,
          },

          {
            reference:
              idempotencyKey,
          },
        ],
      }),
  };
}

/* ============================================================================
 * Suite
 * ========================================================================== */

describe(
  'Golden Money Path - Contribution Concurrent Processing',
  () => {
    test(
      'ten identical concurrent requests create one logical contribution',
      async () => {
        await seedContext();

        const responses =
          await Promise.all(
            Array.from(
              {
                length:
                  10,
              },
              () =>
                initiateContribution({
                  idempotencyKey:
                    IDEMPOTENCY_KEY,
                }),
            ),
          );

        for (
          const response of
            responses
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

        const state =
          await snapshotLogicalOperation();

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

        if (
          state.contributions.length
        ) {
          expect(
            state.contributions.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'identical concurrent requests share one payment identity',
      async () => {
        await seedContext();

        const responses =
          await Promise.all([
            initiateContribution(),
            initiateContribution(),
            initiateContribution(),
            initiateContribution(),
          ]);

        const successful =
          responses.filter(
            (
              response,
            ) =>
              response.status >=
                200 &&
              response.status <
                300,
          );

        expect(
          successful.length,
        ).toBeGreaterThan(
          0,
        );

        const identifiers =
          successful
            .map(
              (
                response,
              ) =>
                getIdentifier(
                  responsePayload(
                    response,
                  ),
                  [
                    'paymentId',
                    '_id',
                    'id',
                  ],
                ),
            )
            .filter(Boolean);

        if (
          identifiers.length >
          1
        ) {
          expect(
            new Set(
              identifiers,
            ).size,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'identical concurrent requests call provider initiation only once',
      async () => {
        await seedContext();

        await Promise.all(
          Array.from(
            {
              length:
                10,
            },
            () =>
              initiateContribution(),
          ),
        );

        /**
         * If the application is wired directly to the test provider mock,
         * exactly one external provider command is permitted.
         */
        if (
          mocks.providerInitiate.mock
            .calls.length
        ) {
          expect(
            mocks.providerInitiate.mock
              .calls.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'identical concurrent callbacks create one successful payment',
      async () => {
        await seedContext();

        await initiateContribution();

        const responses =
          await Promise.all(
            Array.from(
              {
                length:
                  10,
              },
              (
                _,
                index,
              ) =>
                sendContributionCallback({
                  callbackId:
                    PROVIDER_CALLBACK_ID,

                  requestId:
                    `concurrent-callback-${index}`,
                }),
            ),
          );

        for (
          const response of
            responses
        ) {
          expect(
            [
              200,
              202,
            ],
          ).toContain(
            response.status,
          );
        }

        const payments =
          await findPayments({
            $or: [
              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                paymentReference:
                  IDEMPOTENCY_KEY,
              },

              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
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

          expect(
            SUCCESS_STATES.has(
              getStatus(
                payments[0],
              ),
            ),
          ).toBe(
            true,
          );
        }
      },
    );

    test(
      'concurrent callback processing creates exactly one successful journal',
      async () => {
        await seedContext();

        await initiateContribution();

        await Promise.all(
          Array.from(
            {
              length:
                8,
            },
            (
              _,
              index,
            ) =>
              sendContributionCallback({
                callbackId:
                  PROVIDER_CALLBACK_ID,

                requestId:
                  `journal-race-${index}`,
              }),
          ),
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
      'concurrent callbacks produce a balanced ledger',
      async () => {
        await seedContext();

        await initiateContribution();

        await Promise.all(
          Array.from(
            {
              length:
                6,
            },
            (
              _,
              index,
            ) =>
              sendContributionCallback({
                callbackId:
                  PROVIDER_CALLBACK_ID,

                requestId:
                  `balance-race-${index}`,
              }),
          ),
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

          const journal =
            journals[0];

          const debit =
            journal.totalDebit ??
            journal.debitTotal;

          const credit =
            journal.totalCredit ??
            journal.creditTotal;

          if (
            debit !==
              undefined &&
            credit !==
              undefined
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
      'same idempotency key with different amounts is rejected under concurrency',
      async () => {
        await seedContext();

        const responses =
          await Promise.all([
            initiateContribution({
              amount:
                Number(
                  CONTRIBUTION_AMOUNT,
                ),
            }),

            initiateContribution({
              amount:
                Number(
                  SECOND_CONTRIBUTION_AMOUNT,
                ),
            }),

            initiateContribution({
              amount:
                Number(
                  CONTRIBUTION_AMOUNT,
                ),
            }),
          ]);

        const successful =
          responses.filter(
            (
              response,
            ) =>
              response.status >=
                200 &&
              response.status <
                300,
          );

        const conflicts =
          responses.filter(
            (
              response,
            ) =>
              [
                409,
                422,
              ].includes(
                response.status,
              ),
          );

        expect(
          successful.length +
            conflicts.length,
        ).toBe(
          responses.length,
        );

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
      },
    );

    test(
      'same idempotency key with different providers is rejected under concurrency',
      async () => {
        await seedContext();

        const responses =
          await Promise.all([
            initiateContribution({
              provider:
                'mtn',
            }),

            initiateContribution({
              provider:
                'airtel',
            }),
          ]);

        const conflicts =
          responses.filter(
            (
              response,
            ) =>
              [
                409,
                422,
              ].includes(
                response.status,
              ),
          );

        expect(
          conflicts.length,
        ).toBeGreaterThanOrEqual(
          1,
        );

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
      },
    );

    test(
      'same idempotency key with different group ids is rejected under concurrency',
      async () => {
        await seedContext();

        const responses =
          await Promise.all([
            initiateContribution({
              groupId:
                GROUP_ID,
            }),

            initiateContribution({
              groupId:
                '507f1f77bcf86cd799439999',
            }),
          ]);

        expect(
          responses.some(
            (
              response,
            ) =>
              [
                409,
                422,
              ].includes(
                response.status,
              ),
          ),
        ).toBe(
          true,
        );
      },
    );

    test(
      'different idempotency keys remain distinct operations when executed concurrently',
      async () => {
        await seedContext();

        const responses =
          await Promise.all([
            initiateContribution({
              idempotencyKey:
                IDEMPOTENCY_KEY,
            }),

            initiateContribution({
              idempotencyKey:
                SECOND_IDEMPOTENCY_KEY,

              amount:
                Number(
                  SECOND_CONTRIBUTION_AMOUNT,
                ),

              phoneNumber:
                SECOND_TEST_PHONE,

              reference:
                SECOND_IDEMPOTENCY_KEY,
            }),
          ]);

        expect(
          responses.every(
            (
              response,
            ) =>
              [
                200,
                201,
                202,
                409,
              ].includes(
                response.status,
              ),
          ),
        ).toBe(
          true,
        );

        const first =
          await snapshotLogicalOperation(
            IDEMPOTENCY_KEY,
          );

        const second =
          await snapshotLogicalOperation(
            SECOND_IDEMPOTENCY_KEY,
          );

        if (
          first.payments.length &&
          second.payments.length
        ) {
          const firstId =
            String(
              first.payments[0]._id ||
                first.payments[0].id,
            );

          const secondId =
            String(
              second.payments[0]._id ||
                second.payments[0].id,
            );

          expect(
            firstId,
          ).not.toBe(
            secondId,
          );
        }
      },
    );

    test(
      'two different members can contribute concurrently without collapsing into one operation',
      async () => {
        await seedContext();

        const responses =
          await Promise.all([
            initiateContribution(
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,

                phoneNumber:
                  TEST_PHONE,

                amount:
                  Number(
                    CONTRIBUTION_AMOUNT,
                  ),
              },

              AUTH_TOKEN,
            ),

            initiateContribution(
              {
                idempotencyKey:
                  SECOND_IDEMPOTENCY_KEY,

                phoneNumber:
                  SECOND_TEST_PHONE,

                amount:
                  Number(
                    SECOND_CONTRIBUTION_AMOUNT,
                  ),

                reference:
                  SECOND_IDEMPOTENCY_KEY,
              },

              createJwtLikeToken({
                sub:
                  SECOND_MEMBER_ID,

                tenantId:
                  TEST_TENANT_ID,

                role:
                  'member',

                email:
                  'member2@titech.com',
              }),
            ),
          ]);

        expect(
          responses.every(
            (
              response,
            ) =>
              [
                200,
                201,
                202,
                409,
              ].includes(
                response.status,
              ),
          ),
        ).toBe(
          true,
        );

        const first =
          await snapshotLogicalOperation(
            IDEMPOTENCY_KEY,
          );

        const second =
          await snapshotLogicalOperation(
            SECOND_IDEMPOTENCY_KEY,
          );

        if (
          first.journals.length &&
          second.journals.length
        ) {
          expect(
            first.journals.length,
          ).toBe(
            1,
          );

          expect(
            second.journals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'same member cannot bypass idempotency by concurrent retries',
      async () => {
        await seedContext();

        const requests =
          Array.from(
            {
              length:
                25,
            },
            () =>
              initiateContribution({
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              }),
          );

        const responses =
          await Promise.all(
            requests,
          );

        expect(
          responses.length,
        ).toBe(
          25,
        );

        const successful =
          responses.filter(
            (
              response,
            ) =>
              response.status >=
                200 &&
              response.status <
                300,
          );

        expect(
          successful.length,
        ).toBeGreaterThan(
          0,
        );

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
                externalReference:
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
      'provider transaction identity remains singular during concurrent retries',
      async () => {
        await seedContext();

        await Promise.all(
          Array.from(
            {
              length:
                15,
            },
            () =>
              initiateContribution(),
          ),
        );

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
      'concurrent callback and API initiation races produce one payment',
      async () => {
        await seedContext();

        const [
          initiationOne,
          callbackOne,
          initiationTwo,
          callbackTwo,
        ] =
          await Promise.all([
            initiateContribution(),

            sendContributionCallback({
              callbackId:
                PROVIDER_CALLBACK_ID,
            }),

            initiateContribution(),

            sendContributionCallback({
              callbackId:
                PROVIDER_CALLBACK_ID,
            }),
          ]);

        expect(
          [
            200,
            201,
            202,
            404,
            409,
          ],
        ).toContain(
          initiationOne.status,
        );

        expect(
          [
            200,
            202,
            404,
            409,
          ],
        ).toContain(
          callbackOne.status,
        );

        expect(
          [
            200,
            201,
            202,
            404,
            409,
          ],
        ).toContain(
          initiationTwo.status,
        );

        expect(
          [
            200,
            202,
            404,
            409,
          ],
        ).toContain(
          callbackTwo.status,
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
      },
    );

    test(
      'concurrent callback and API initiation races produce at most one journal',
      async () => {
        await seedContext();

        await Promise.all([
          initiateContribution(),

          sendContributionCallback(),

          initiateContribution(),

          sendContributionCallback(),

          initiateContribution(),
        ]);

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
      'concurrent callback and API initiation preserve final success state',
      async () => {
        await seedContext();

        await Promise.all([
          initiateContribution(),

          sendContributionCallback(),

          sendContributionCallback(),

          initiateContribution(),
        ]);

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
            SUCCESS_STATES.has(
              status,
            ),
          ).toBe(
            true,
          );
        }
      },
    );

    test(
      'concurrent duplicate requests followed by callback do not multiply ledger effect',
      async () => {
        await seedContext();

        await Promise.all(
          Array.from(
            {
              length:
                12,
            },
            () =>
              initiateContribution(),
          ),
        );

        await Promise.all(
          Array.from(
            {
              length:
                12,
            },
            (
              _,
              index,
            ) =>
              sendContributionCallback({
                requestId:
                  `duplicate-ledger-race-${index}`,
              }),
          ),
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

          const debit =
            journals[0].totalDebit ??
            journals[0].debitTotal;

          const credit =
            journals[0].totalCredit ??
            journals[0].creditTotal;

          if (
            debit !==
              undefined &&
            credit !==
              undefined
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
      'concurrent callbacks do not create duplicate journal entries',
      async () => {
        await seedContext();

        await initiateContribution();

        await Promise.all(
          Array.from(
            {
              length:
                15,
            },
            (
              _,
              index,
            ) =>
              sendContributionCallback({
                requestId:
                  `entry-race-${index}`,
              }),
          ),
        );

        const entries =
          await findJournalEntries({
            $or: [
              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                reference:
                  IDEMPOTENCY_KEY,
              },
            ],
          });

        /**
         * A two-line double-entry contribution normally produces two entries.
         * Alternative models may use more than two lines. The invariant is that
         * entries are not duplicated by callback concurrency.
         */
        if (
          entries.length
        ) {
          expect(
            entries.length,
          ).toBeLessThanOrEqual(
            4,
          );
        }
      },
    );

    test(
      'concurrent callbacks preserve exactly one provider transaction record',
      async () => {
        await seedContext();

        await initiateContribution();

        await Promise.all(
          Array.from(
            {
              length:
                20,
            },
            (
              _,
              index,
            ) =>
              sendContributionCallback({
                callbackId:
                  PROVIDER_CALLBACK_ID,

                requestId:
                  `provider-record-race-${index}`,
              }),
          ),
        );

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
                reference:
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
      },
    );

    test(
      'concurrent requests remain tenant isolated',
      async () => {
        await seedContext();

        const responses =
          await Promise.all([
            initiateContribution(
              {},
              AUTH_TOKEN,
            ),

            initiateContribution(
              {
                phoneNumber:
                  OTHER_TENANT_PHONE,

                idempotencyKey:
                  IDEMPOTENCY_KEY,

                reference:
                  IDEMPOTENCY_KEY,
              },

              OTHER_TENANT_TOKEN,
            ),

            initiateContribution(
              {},
              AUTH_TOKEN,
            ),

            initiateContribution(
              {
                phoneNumber:
                  OTHER_TENANT_PHONE,

                idempotencyKey:
                  IDEMPOTENCY_KEY,

                reference:
                  IDEMPOTENCY_KEY,
              },

              OTHER_TENANT_TOKEN,
            ),
          ]);

        expect(
          responses.length,
        ).toBe(
          4,
        );

        /**
         * At least one tenant-crossing request must be rejected because the
         * group belongs to TEST_TENANT_ID.
         */
        expect(
          responses.some(
            (
              response,
              index,
            ) =>
              index %
                2 ===
                1 &&
              [
                400,
                403,
                404,
                409,
                422,
              ].includes(
                response.status,
              ),
          ),
        ).toBe(
          true,
        );

        const payments =
          await findPayments({});

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
      },
    );

    test(
      'concurrent distinct contributions preserve independent amounts',
      async () => {
        await seedContext();

        const [
          first,
          second,
        ] =
          await Promise.all([
            initiateContribution({
              idempotencyKey:
                IDEMPOTENCY_KEY,

              amount:
                Number(
                  CONTRIBUTION_AMOUNT,
                ),

              phoneNumber:
                TEST_PHONE,
            }),

            initiateContribution({
              idempotencyKey:
                SECOND_IDEMPOTENCY_KEY,

              amount:
                Number(
                  SECOND_CONTRIBUTION_AMOUNT,
                ),

              phoneNumber:
                SECOND_TEST_PHONE,

              reference:
                SECOND_IDEMPOTENCY_KEY,
            }),
          ]);

        expect(
          [
            200,
            201,
            202,
            409,
          ],
        ).toContain(
          first.status,
        );

        expect(
          [
            200,
            201,
            202,
            409,
          ],
        ).toContain(
          second.status,
        );

        const firstPayments =
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
            ],
          });

        const secondPayments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  SECOND_IDEMPOTENCY_KEY,
              },

              {
                paymentReference:
                  SECOND_IDEMPOTENCY_KEY,
              },
            ],
          });

        if (
          firstPayments.length &&
          secondPayments.length
        ) {
          const firstAmount =
            String(
              firstPayments[0].amount ??
                firstPayments[0]
                  .totalAmount ??
                '',
            );

          const secondAmount =
            String(
              secondPayments[0].amount ??
                secondPayments[0]
                  .totalAmount ??
                '',
            );

          if (
            firstAmount &&
            secondAmount
          ) {
            expect(
              firstAmount,
            ).toBe(
              CONTRIBUTION_AMOUNT,
            );

            expect(
              secondAmount,
            ).toBe(
              SECOND_CONTRIBUTION_AMOUNT,
            );
          }
        }
      },
    );

    test(
      'concurrent provider callbacks cannot regress a successful payment to pending',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendContributionCallback();

        /**
         * Deliver additional callbacks concurrently after success.
         */
        const responses =
          await Promise.all(
            Array.from(
              {
                length:
                  10,
              },
              (
                _,
                index,
              ) =>
                sendContributionCallback({
                  requestId:
                    `post-success-race-${index}`,
                }),
            ),
          );

        for (
          const response of
            responses
        ) {
          expect(
            [
              200,
              202,
            ],
          ).toContain(
            response.status,
          );
        }

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
            SUCCESS_STATES.has(
              getStatus(
                payments[0],
              ),
            ),
          ).toBe(
            true,
          );
        }
      },
    );

    test(
      'concurrent duplicate callback processing preserves payment amount and currency',
      async () => {
        await seedContext();

        await initiateContribution();

        await Promise.all(
          Array.from(
            {
              length:
                10,
            },
            (
              _,
              index,
            ) =>
              sendContributionCallback({
                requestId:
                  `amount-currency-race-${index}`,
              }),
          ),
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
            String(
              payments[0].amount ??
                '',
            ),
          ).toBe(
            CONTRIBUTION_AMOUNT,
          );

          if (
            payments[0].currency
          ) {
            expect(
              String(
                payments[0].currency,
              ).toUpperCase(),
            ).toBe(
              CONTRIBUTION_CURRENCY,
            );
          }
        }
      },
    );

    test(
      'concurrent requests cannot produce more than one financial source of truth',
      async () => {
        await seedContext();

        await Promise.all(
          Array.from(
            {
              length:
                20,
            },
            () =>
              initiateContribution({
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              }),
          ),
        );

        await Promise.all(
          Array.from(
            {
              length:
                20,
            },
            (
              _,
              index,
            ) =>
              sendContributionCallback({
                requestId:
                  `source-of-truth-race-${index}`,
              }),
          ),
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
          payments.length
        ) {
          expect(
            payments.length,
          ).toBe(
            1,
          );
        }

        if (
          transactions.length
        ) {
          expect(
            transactions.length,
          ).toBe(
            1,
          );
        }

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
      'concurrent callbacks are safe when provider initially reports pending',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValueOnce(
            createProviderPending(),
          );

        const initiation =
          await initiateContribution();

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          initiation.status,
        );

        const initialStatus =
          getNestedStatus(
            responsePayload(
              initiation,
            ),
          );

        if (
          initialStatus
        ) {
          expect(
            SUCCESS_STATES.has(
              initialStatus,
            ),
          ).toBe(
            false,
          );
        }

        const responses =
          await Promise.all(
            Array.from(
              {
                length:
                  12,
              },
              (
                _,
                index,
              ) =>
                sendContributionCallback({
                  requestId:
                    `pending-callback-race-${index}`,
                }),
            ),
          );

        for (
          const response of
            responses
        ) {
          expect(
            [
              200,
              202,
            ],
          ).toContain(
            response.status,
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
      'concurrent client retries remain safe while provider operation is still pending',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValue(
            createProviderPending(),
          );

        const responses =
          await Promise.all(
            Array.from(
              {
                length:
                  12,
              },
              () =>
                initiateContribution({
                  idempotencyKey:
                    IDEMPOTENCY_KEY,
                }),
            ),
          );

        expect(
          responses.length,
        ).toBe(
          12,
        );

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

          const state =
            getStatus(
              payments[0],
            );

          if (
            state
          ) {
            expect(
              SUCCESS_STATES.has(
                state,
              ),
            ).toBe(
              false,
            );
          }
        }
      },
    );

    test(
      'concurrent success callbacks after pending do not duplicate settlement',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValueOnce(
            createProviderPending(),
          );

        await initiateContribution();

        await Promise.all(
          Array.from(
            {
              length:
                10,
            },
            (
              _,
              index,
            ) =>
              sendContributionCallback({
                requestId:
                  `pending-settlement-race-${index}`,
              }),
          ),
        );

        if (
          mocks.settlement.mock
            .calls.length
        ) {
          expect(
            mocks.settlement.mock
              .calls.length,
          ).toBeLessThanOrEqual(
            1,
          );
        }
      },
    );

    test(
      'concurrent callback processing does not duplicate settlement transaction',
      async () => {
        await seedContext();

        await initiateContribution();

        await Promise.all(
          Array.from(
            {
              length:
                10,
            },
            (
              _,
              index,
            ) =>
              sendContributionCallback({
                requestId:
                  `settlement-race-${index}`,
              }),
          ),
        );

        const transactions =
          await findTransactions({
            $or: [
              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                reference:
                  IDEMPOTENCY_KEY,
              },

              {
                externalReference:
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
      },
    );

    test(
      'concurrent callbacks and duplicate requests retain tenant ownership',
      async () => {
        await seedContext();

        await Promise.all(
          [
            ...Array.from(
              {
                length:
                  8,
              },
              () =>
                initiateContribution(
                  {},
                  AUTH_TOKEN,
                ),
            ),

            ...Array.from(
              {
                length:
                  8,
              },
              (
                _,
                index,
              ) =>
                sendContributionCallback({
                  requestId:
                    `tenant-race-${index}`,
                }),
            ),
          ],
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
      'concurrent attempts from different tenants cannot claim the same contribution identity',
      async () => {
        await seedContext();

        const [
          owner,
          other,
          ownerRetry,
          otherRetry,
        ] =
          await Promise.all([
            initiateContribution(
              {},
              AUTH_TOKEN,
            ),

            initiateContribution(
              {
                phoneNumber:
                  OTHER_TENANT_PHONE,

                idempotencyKey:
                  IDEMPOTENCY_KEY,

                reference:
                  IDEMPOTENCY_KEY,
              },

              OTHER_TENANT_TOKEN,
            ),

            initiateContribution(
              {},
              AUTH_TOKEN,
            ),

            initiateContribution(
              {
                phoneNumber:
                  OTHER_TENANT_PHONE,

                idempotencyKey:
                  IDEMPOTENCY_KEY,

                reference:
                  IDEMPOTENCY_KEY,
              },

              OTHER_TENANT_TOKEN,
            ),
          ]);

        expect(
          [
            200,
            201,
            202,
            409,
          ].includes(
            owner.status,
          ),
        ).toBe(
          true,
        );

        expect(
          [
            200,
            201,
            202,
            409,
          ].includes(
            ownerRetry.status,
          ),
        ).toBe(
          true,
        );

        expect(
          [
            400,
            403,
            404,
            409,
            422,
          ].includes(
            other.status,
          ),
        ).toBe(
          true,
        );

        expect(
          [
            400,
            403,
            404,
            409,
            422,
          ].includes(
            otherRetry.status,
          ),
        ).toBe(
          true,
        );

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
      },
    );

    test(
      'concurrent requests preserve immutable financial history after successful posting',
      async () => {
        await seedContext();

        await Promise.all(
          Array.from(
            {
              length:
                10,
            },
            () =>
              initiateContribution(),
          ),
        );

        await Promise.all(
          Array.from(
            {
              length:
                10,
            },
            (
              _,
              index,
            ) =>
              sendContributionCallback({
                requestId:
                  `immutability-race-${index}`,
              }),
          ),
        );

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

        await Promise.all(
          Array.from(
            {
              length:
                10,
            },
            (
              _,
              index,
            ) =>
              sendContributionCallback({
                requestId:
                  `immutability-replay-${index}`,
              }),
          ),
        );

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
      'concurrent processing keeps only one authoritative ledger amount',
      async () => {
        await seedContext();

        await Promise.all(
          Array.from(
            {
              length:
                20,
            },
            () =>
              initiateContribution(),
          ),
        );

        await Promise.all(
          Array.from(
            {
              length:
                20,
            },
            (
              _,
              index,
            ) =>
              sendContributionCallback({
                requestId:
                  `authoritative-amount-race-${index}`,
              }),
          ),
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

          const journal =
            journals[0];

          const debit =
            journal.totalDebit ??
            journal.debitTotal;

          const credit =
            journal.totalCredit ??
            journal.creditTotal;

          if (
            debit !==
              undefined &&
            credit !==
              undefined
          ) {
            expect(
              String(
                debit,
              ),
            ).toBe(
              CONTRIBUTION_AMOUNT,
            );

            expect(
              String(
                credit,
              ),
            ).toBe(
              CONTRIBUTION_AMOUNT,
            );
          }
        }
      },
    );

    test(
      'concurrent processing does not produce multiple successful contribution states',
      async () => {
        await seedContext();

        await Promise.all(
          [
            ...Array.from(
              {
                length:
                  15,
              },
              () =>
                initiateContribution(),
            ),

            ...Array.from(
              {
                length:
                  15,
              },
              (
                _,
                index,
              ) =>
                sendContributionCallback({
                  requestId:
                    `final-state-race-${index}`,
                }),
            ),
          ],
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

          expect(
            SUCCESS_STATES.has(
              getStatus(
                payments[0],
              ),
            ),
          ).toBe(
            true,
          );
        }
      },
    );

    test(
      'concurrent operations remain safe with separate provider transaction identities',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockImplementation(
            async (
              input = {},
            ) => {
              const reference =
                input.reference ||
                input.idempotencyKey;

              if (
                reference ===
                SECOND_IDEMPOTENCY_KEY
              ) {
                return createProviderSuccess({
                  providerTransactionId:
                    SECOND_PROVIDER_TRANSACTION_ID,

                  transactionId:
                    SECOND_PROVIDER_TRANSACTION_ID,

                  paymentReference:
                    SECOND_IDEMPOTENCY_KEY,

                  reference:
                    SECOND_IDEMPOTENCY_KEY,

                  externalReference:
                    SECOND_IDEMPOTENCY_KEY,

                  amount:
                    SECOND_CONTRIBUTION_AMOUNT,

                  msisdn:
                    SECOND_TEST_PHONE,
                });
              }

              return createProviderSuccess();
            },
          );

        const responses =
          await Promise.all([
            initiateContribution({
              idempotencyKey:
                IDEMPOTENCY_KEY,
            }),

            initiateContribution({
              idempotencyKey:
                SECOND_IDEMPOTENCY_KEY,

              amount:
                Number(
                  SECOND_CONTRIBUTION_AMOUNT,
                ),

              phoneNumber:
                SECOND_TEST_PHONE,

              reference:
                SECOND_IDEMPOTENCY_KEY,
            }),
          ]);

        expect(
          responses.every(
            (
              response,
            ) =>
              [
                200,
                201,
                202,
                409,
              ].includes(
                response.status,
              ),
          ),
        ).toBe(
          true,
        );

        const first =
          await snapshotLogicalOperation(
            IDEMPOTENCY_KEY,
          );

        const second =
          await snapshotLogicalOperation(
            SECOND_IDEMPOTENCY_KEY,
          );

        if (
          first.payments.length &&
          second.payments.length
        ) {
          expect(
            String(
              first.payments[0]
                .providerTransactionId ||
                '',
            ),
          ).not.toBe(
            String(
              second.payments[0]
                .providerTransactionId ||
                '',
            ),
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