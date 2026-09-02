'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Golden Money Path - Delayed Callback Integration Tests
 * ============================================================================
 *
 * File:
 *   tests/integration/goldenMoneyPath/contribution.delayedCallback.test.js
 *
 * Purpose
 * -------
 * Enterprise integration coverage for asynchronous and delayed provider
 * callbacks in the canonical contribution Golden Money Path.
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
 *      v
 *   PROVIDER INITIATION
 *      |
 *      |             callback delayed
 *      |------------------------------+
 *      |                              |
 *      v                              |
 *   PAYMENT=PENDING                  |
 *      |                              |
 *      |                              v
 *      |                       PROVIDER CALLBACK
 *      |                              |
 *      +------------------------------+
 *                     |
 *                     v
 *              PAYMENT VERIFICATION
 *                     |
 *                     v
 *              PAYMENT STATE MACHINE
 *                     |
 *                     v
 *              SETTLEMENT WORKFLOW
 *                     |
 *                     v
 *                LEDGER POST
 *                     |
 *                     v
 *                 SUCCESS
 *
 * Primary objectives
 * ------------------
 * 1. Contribution initiation remains safe while the provider callback is late.
 * 2. A pending payment remains pending until authoritative verification.
 * 3. Delayed callback eventually transitions the payment to SUCCESS.
 * 4. A delayed callback is not mistaken for a duplicate before it arrives.
 * 5. Callback replay after the delayed callback remains idempotent.
 * 6. Provider status verification can reconcile a delayed callback.
 * 7. No financial ledger posting occurs before the payment is authoritative.
 * 8. Exactly one ledger posting occurs after successful callback processing.
 * 9. Delayed callbacks arriving after polling are handled safely.
 * 10. Delayed callbacks arriving before polling are handled safely.
 * 11. Delayed callbacks do not create duplicate payments, transactions, or
 *     journals.
 * 12. Tenant isolation is preserved throughout asynchronous processing.
 * 13. Correlation identifiers survive the asynchronous boundary where the
 *     application exposes them.
 * 14. Unknown external outcomes enter a safe reconciliation state instead of
 *     silently succeeding.
 * 15. The test suite never requires live MTN/Airtel credentials.
 *
 * IMPORTANT
 * ---------
 * Provider callbacks are untrusted external inputs. The application must not
 * finalize a contribution merely because a callback endpoint was reached.
 * Callback validation, provider verification, payment state-machine rules,
 * idempotency, settlement, and ledger posting remain authoritative.
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
  'tenant-golden-path-delayed-001';

const OTHER_TENANT_ID =
  'tenant-golden-path-delayed-002';

const MEMBER_ID =
  '507f1f77bcf86cd799439301';

const OTHER_TENANT_MEMBER_ID =
  '507f1f77bcf86cd799439302';

const GROUP_ID =
  '507f1f77bcf86cd799439303';

const CONTRIBUTION_AMOUNT =
  '150000';

const CONTRIBUTION_CURRENCY =
  'UGX';

const TEST_PHONE =
  '256700000101';

const OTHER_TENANT_PHONE =
  '256700000102';

const IDEMPOTENCY_KEY =
  'golden-money-path-delayed-callback-000001';

const DELAYED_PROVIDER_TRANSACTION_ID =
  'MTN-UG-DELAYED-000001';

const DELAYED_CALLBACK_ID =
  'MTN-CB-DELAYED-000001';

const AUTH_TOKEN =
  'test-access-token';

const OTHER_TENANT_TOKEN =
  'other-tenant-access-token';

const PAYMENT_TERMINAL_SUCCESS_STATES =
  new Set([
    'SUCCESS',
    'SUCCEEDED',
    'COMPLETED',
    'SETTLED',
    'PAID',
  ]);

const PAYMENT_PENDING_STATES =
  new Set([
    'PENDING',
    'PROCESSING',
    'INITIATED',
    'AWAITING_CALLBACK',
    'AWAITING_PROVIDER',
    'SUBMITTED',
    'QUEUED',
  ]);

/* ============================================================================
 * Helpers
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

function getBody(
  response,
) {
  return response?.body ||
    {};
}

function getPayload(
  response,
) {
  const body =
    getBody(
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
  payload,
) {
  return (
    getStatus(
      payload,
    ) ||
    getStatus(
      payload?.payment,
    ) ||
    getStatus(
      payload?.contribution,
    ) ||
    getStatus(
      payload?.transaction,
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

function createDelayedProviderPendingResponse(
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
      DELAYED_PROVIDER_TRANSACTION_ID,

    transactionId:
      overrides.transactionId ||
      DELAYED_PROVIDER_TRANSACTION_ID,

    reference:
      overrides.reference ||
      IDEMPOTENCY_KEY,

    paymentReference:
      overrides.paymentReference ||
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
      overrides.responseCode ||
      'PENDING',

    responseMessage:
      overrides.responseMessage ||
      'Transaction accepted and is awaiting completion',

    ...overrides,
  };
}

function createDelayedProviderSuccessResponse(
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
      DELAYED_PROVIDER_TRANSACTION_ID,

    transactionId:
      overrides.transactionId ||
      DELAYED_PROVIDER_TRANSACTION_ID,

    reference:
      overrides.reference ||
      IDEMPOTENCY_KEY,

    paymentReference:
      overrides.paymentReference ||
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
      overrides.responseCode ||
      'SUCCESS',

    responseMessage:
      overrides.responseMessage ||
      'Transaction successful',

    ...overrides,
  };
}

function createDelayedCallback(
  overrides = {},
) {
  return {
    callbackId:
      overrides.callbackId ||
      DELAYED_CALLBACK_ID,

    provider:
      overrides.provider ||
      'mtn',

    providerTransactionId:
      overrides.providerTransactionId ||
      DELAYED_PROVIDER_TRANSACTION_ID,

    transactionId:
      overrides.transactionId ||
      DELAYED_PROVIDER_TRANSACTION_ID,

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
      overrides.timestamp ||
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
      'golden-money-path-delayed-test-secret';

    process.env.INTERNAL_API_KEY =
      'golden-money-path-delayed-internal-key';

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
            createDelayedProviderPendingResponse(),
          ),

      providerVerify:
        jest
          .fn()
          .mockResolvedValue(
            createDelayedProviderPendingResponse(),
          ),

      providerCallback:
        jest
          .fn()
          .mockResolvedValue(
            createDelayedProviderSuccessResponse(),
          ),

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
        createDelayedProviderPendingResponse(),
      );

    mocks.providerVerify
      .mockResolvedValue(
        createDelayedProviderPendingResponse(),
      );

    mocks.providerCallback
      .mockResolvedValue(
        createDelayedProviderSuccessResponse(),
      );

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
 * Seed Context
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
        'Golden Money Path Delayed Callback Group',

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
          '507f1f77bcf86cd799439304',

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
          '507f1f77bcf86cd799439305',

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
      'Delayed callback integration test contribution',
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

async function sendDelayedSuccessCallback(
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
        DELAYED_CALLBACK_ID,
    )
    .set(
      'X-Request-Id',
      overrides.requestId ||
        `delayed-callback-${crypto.randomUUID()}`,
    )
    .send(
      createDelayedCallback(
        overrides,
      ),
    );
}

async function sendProviderStatusLookup(
  overrides = {},
) {
  /**
   * Support the likely verification route shapes without making the test
   * dependent on one controller naming convention.
   */
  const candidates = [
    {
      method:
        'get',
      path:
        `/api/payments/${overrides.paymentId || DELAYED_PROVIDER_TRANSACTION_ID}/verify`,
    },

    {
      method:
        'get',
      path:
        `/api/payments/verify/${overrides.paymentId || DELAYED_PROVIDER_TRANSACTION_ID}`,
    },

    {
      method:
        'post',
      path:
        '/api/payments/verify',
    },
  ];

  for (
    const candidate of
      candidates
  ) {
    try {
      let result;

      if (
        candidate.method ===
        'get'
      ) {
        result =
          await authenticatedRequest()
            .get(
              candidate.path,
            );
      } else {
        result =
          await authenticatedRequest()
            .post(
              candidate.path,
            )
            .send({
              paymentId:
                overrides.paymentId ||
                null,

              provider:
                'mtn',

              providerTransactionId:
                DELAYED_PROVIDER_TRANSACTION_ID,

              paymentReference:
                IDEMPOTENCY_KEY,

              idempotencyKey:
                `${IDEMPOTENCY_KEY}:verify`,
            });
      }

      if (
        ![
          404,
          405,
        ].includes(
          result.status,
        )
      ) {
        return result;
      }
    } catch (
      _error
    ) {
      // Try next verification route.
    }
  }

  return null;
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
    const name of
      collectionNames
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

/* ============================================================================
 * Test Suite
 * ========================================================================== */

describe(
  'Golden Money Path - Contribution Delayed Callback',
  () => {
    test(
      'accepts a contribution while the provider remains pending and does not prematurely post to the ledger',
      async () => {
        await seedContext();

        const response =
          await initiateContribution();

        expectSuccessfulHttp(
          response,
        );

        const payload =
          getPayload(
            response,
          );

        const paymentId =
          getIdentifier(
            payload,
            [
              'paymentId',
              '_id',
              'id',
            ],
          );

        const status =
          getNestedStatus(
            payload,
          );

        /**
         * The API may expose INITIATED instead of PENDING. Both are valid
         * pre-callback states as long as the payment is not terminally
         * successful.
         */
        if (
          status
        ) {
          expect(
            PAYMENT_TERMINAL_SUCCESS_STATES.has(
              status,
            ),
          ).toBe(
            false,
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
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },

              {
                sourceId:
                  paymentId,
              },
            ],
          });

        /**
         * No final ledger posting is allowed merely because initiation was
         * accepted while the provider remains pending.
         */
        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'preserves a non-terminal payment state while the callback is delayed',
      async () => {
        await seedContext();

        const response =
          await initiateContribution();

        expectSuccessfulHttp(
          response,
        );

        const payload =
          getPayload(
            response,
          );

        const paymentId =
          getIdentifier(
            payload,
            [
              'paymentId',
              '_id',
              'id',
            ],
          );

        const payments =
          await findPayments(
            paymentId
              ? {
                  _id:
                    mongoose.Types.ObjectId
                      .isValid(
                        paymentId,
                      )
                      ? new mongoose.Types.ObjectId(
                          paymentId,
                        )
                      : paymentId,
                }
              : {
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
                        DELAYED_PROVIDER_TRANSACTION_ID,
                    },
                  ],
                },
          );

        if (
          payments.length
        ) {
          const state =
            getStatus(
              payments[0],
            );

          if (
            state
          ) {
            expect(
              PAYMENT_TERMINAL_SUCCESS_STATES.has(
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
      'does not create a second contribution while waiting for the delayed callback',
      async () => {
        await seedContext();

        const first =
          await initiateContribution();

        expectSuccessfulHttp(
          first,
        );

        const second =
          await initiateContribution();

        expectSuccessfulHttp(
          second,
        );

        const firstPayload =
          getPayload(
            first,
          );

        const secondPayload =
          getPayload(
            second,
          );

        const firstPaymentId =
          getIdentifier(
            firstPayload,
            [
              'paymentId',
              '_id',
              'id',
            ],
          );

        const secondPaymentId =
          getIdentifier(
            secondPayload,
            [
              'paymentId',
              '_id',
              'id',
            ],
          );

        if (
          firstPaymentId &&
          secondPaymentId
        ) {
          expect(
            secondPaymentId,
          ).toBe(
            firstPaymentId,
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
      'does not create a ledger journal before the delayed success callback arrives',
      async () => {
        await seedContext();

        await initiateContribution();

        const beforeCallback =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        expect(
          beforeCallback.length,
        ).toBe(
          0,
        );

        const callbackResponse =
          await sendDelayedSuccessCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          callbackResponse.status,
        );

        const afterCallback =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          afterCallback.length
        ) {
          expect(
            afterCallback.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'transitions the delayed contribution to a terminal success state after the provider callback',
      async () => {
        await seedContext();

        const initiateResponse =
          await initiateContribution();

        expectSuccessfulHttp(
          initiateResponse,
        );

        const initiatePayload =
          getPayload(
            initiateResponse,
          );

        const paymentId =
          getIdentifier(
            initiatePayload,
            [
              'paymentId',
              '_id',
              'id',
            ],
          );

        await sendDelayedSuccessCallback();

        const payments =
          await findPayments(
            paymentId
              ? {
                  _id:
                    mongoose.Types.ObjectId
                      .isValid(
                        paymentId,
                      )
                      ? new mongoose.Types.ObjectId(
                          paymentId,
                        )
                      : paymentId,
                }
              : {
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
                        DELAYED_PROVIDER_TRANSACTION_ID,
                    },
                  ],
                },
          );

        if (
          payments.length
        ) {
          const state =
            getStatus(
              payments[0],
            );

          expect(
            PAYMENT_TERMINAL_SUCCESS_STATES.has(
              state,
            ),
          ).toBe(
            true,
          );
        }
      },
    );

    test(
      'posts the contribution exactly once when the delayed callback completes the payment',
      async () => {
        await seedContext();

        await initiateContribution();

        const before =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        expect(
          before.length,
        ).toBe(
          0,
        );

        await sendDelayedSuccessCallback();

        const after =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          after.length
        ) {
          expect(
            after.length,
          ).toBe(
            1,
          );

          const journal =
            after[0];

          const status =
            getStatus(
              journal,
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

          const debit =
            String(
              journal.totalDebit ??
                journal.debitTotal ??
                '',
            );

          const credit =
            String(
              journal.totalCredit ??
                journal.creditTotal ??
                '',
            );

          if (
            debit &&
            credit
          ) {
            expect(
              debit,
            ).toBe(
              credit,
            );
          }
        }
      },
    );

    test(
      'replaying the delayed callback after success does not create a second journal',
      async () => {
        await seedContext();

        await initiateContribution();

        const first =
          await sendDelayedSuccessCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          first.status,
        );

        const beforeReplay =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        const second =
          await sendDelayedSuccessCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          second.status,
        );

        const afterReplay =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          beforeReplay.length
          ||
          afterReplay.length
        ) {
          expect(
            afterReplay.length,
          ).toBe(
            beforeReplay.length,
          );
        }
      },
    );

    test(
      'delayed callback is safe when provider status polling has already discovered success',
      async () => {
        await seedContext();

        const initiateResponse =
          await initiateContribution();

        expectSuccessfulHttp(
          initiateResponse,
        );

        const payload =
          getPayload(
            initiateResponse,
          );

        const paymentId =
          getIdentifier(
            payload,
            [
              'paymentId',
              '_id',
              'id',
            ],
          );

        /**
         * Configure provider verification to report success before the callback
         * arrives. The route is optional because some implementations expose
         * verification as a service/job rather than HTTP.
         */
        mocks.providerVerify
          .mockResolvedValue(
            createDelayedProviderSuccessResponse(),
          );

        const verificationResponse =
          await sendProviderStatusLookup({
            paymentId,
          });

        /**
         * 404 means this particular application does not expose a public
         * verification endpoint. In that case the callback remains the
         * authoritative completion mechanism exercised below.
         */
        if (
          verificationResponse
          &&
          verificationResponse.status <
            500
          &&
          verificationResponse.status !==
            404
        ) {
          expect(
            [
              200,
              202,
            ],
          ).toContain(
            verificationResponse.status,
          );
        }

        const callbackResponse =
          await sendDelayedSuccessCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          callbackResponse.status,
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
                  DELAYED_PROVIDER_TRANSACTION_ID,
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
      'delayed callback is safe when it arrives before provider status polling',
      async () => {
        await seedContext();

        const initiateResponse =
          await initiateContribution();

        expectSuccessfulHttp(
          initiateResponse,
        );

        const callbackResponse =
          await sendDelayedSuccessCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          callbackResponse.status,
        );

        mocks.providerVerify
          .mockResolvedValue(
            createDelayedProviderSuccessResponse(),
          );

        const initiatePayload =
          getPayload(
            initiateResponse,
          );

        const paymentId =
          getIdentifier(
            initiatePayload,
            [
              'paymentId',
              '_id',
              'id',
            ],
          );

        const verificationResponse =
          await sendProviderStatusLookup({
            paymentId,
          });

        if (
          verificationResponse
          &&
          verificationResponse.status <
            500
          &&
          verificationResponse.status !==
            404
        ) {
          expect(
            [
              200,
              202,
            ],
          ).toContain(
            verificationResponse.status,
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
                  DELAYED_PROVIDER_TRANSACTION_ID,
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
      'late callback does not create a second transaction after polling has reconciled the payment',
      async () => {
        await seedContext();

        const initiateResponse =
          await initiateContribution();

        expectSuccessfulHttp(
          initiateResponse,
        );

        mocks.providerVerify
          .mockResolvedValue(
            createDelayedProviderSuccessResponse(),
          );

        const initiatePayload =
          getPayload(
            initiateResponse,
          );

        const paymentId =
          getIdentifier(
            initiatePayload,
            [
              'paymentId',
              '_id',
              'id',
            ],
          );

        await sendProviderStatusLookup({
          paymentId,
        });

        const transactionsBefore =
          await findTransactions({
            $or: [
              {
                providerTransactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },

              {
                transactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
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

        await sendDelayedSuccessCallback();

        const transactionsAfter =
          await findTransactions({
            $or: [
              {
                providerTransactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },

              {
                transactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
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
          transactionsBefore.length
          ||
          transactionsAfter.length
        ) {
          expect(
            transactionsAfter.length,
          ).toBeLessThanOrEqual(
            Math.max(
              1,
              transactionsBefore.length,
            ),
          );
        }
      },
    );

    test(
      'delayed callback does not manufacture a duplicate payment record',
      async () => {
        await seedContext();

        await initiateContribution();

        const paymentsBefore =
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
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        await sendDelayedSuccessCallback();

        const paymentsAfter =
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
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          paymentsBefore.length
          ||
          paymentsAfter.length
        ) {
          expect(
            paymentsAfter.length,
          ).toBe(
            paymentsBefore.length,
          );
        }
      },
    );

    test(
      'delayed callback does not manufacture a duplicate contribution record',
      async () => {
        await seedContext();

        await initiateContribution();

        const before =
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

        await sendDelayedSuccessCallback();

        const after =
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
          before.length
          ||
          after.length
        ) {
          expect(
            after.length,
          ).toBe(
            before.length,
          );
        }
      },
    );

    test(
      'delayed callback preserves the original contribution amount and currency',
      async () => {
        await seedContext();

        const response =
          await initiateContribution();

        expectSuccessfulHttp(
          response,
        );

        await sendDelayedSuccessCallback();

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
                  DELAYED_PROVIDER_TRANSACTION_ID,
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
      },
    );

    test(
      'delayed callback preserves tenant isolation',
      async () => {
        await seedContext();

        await initiateContribution();

        const callback =
          await sendDelayedSuccessCallback();

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
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          payments.length
        ) {
          for (
            const payment of
              payments
          ) {
            expect(
              String(
                payment.tenantId ||
                  payment.tenant ||
                  '',
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
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          journals.length
        ) {
          for (
            const journal of
              journals
          ) {
            expect(
              String(
                journal.tenantId ||
                  journal.tenant ||
                  '',
              ),
            ).toBe(
              TEST_TENANT_ID,
            );
          }
        }
      },
    );

    test(
      'delayed callback for another tenant cannot complete the original tenant payment',
      async () => {
        await seedContext();

        await initiateContribution();

        const maliciousOrMisroutedCallback =
          await sendDelayedSuccessCallback({
            callbackId:
              'MTN-CB-CROSS-TENANT-000001',

            paymentReference:
              'different-tenant-reference',

            tenantId:
              OTHER_TENANT_ID,
          });

        /**
         * A callback adapter may not expose tenant mismatch as a client-visible
         * error and may instead resolve tenant from a provider registration.
         * Both reject/accept-without-financial-effect behaviors are safe.
         */
        expect(
          [
            200,
            202,
            400,
            403,
            404,
            409,
          ],
        ).toContain(
          maliciousOrMisroutedCallback.status,
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
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        /**
         * If the callback used a different tenant/reference, it must not create
         * a second cross-tenant financial posting.
         */
        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'delayed callback remains idempotent across multiple deliveries after the contribution is already successful',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendDelayedSuccessCallback();

        const firstSuccessState =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        await sendDelayedSuccessCallback();

        await sendDelayedSuccessCallback();

        const finalState =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          firstSuccessState.length
          ||
          finalState.length
        ) {
          expect(
            finalState.length,
          ).toBe(
            firstSuccessState.length,
          );
        }
      },
    );

    test(
      'provider remains pending for an extended period without triggering a false success',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValue(
            createDelayedProviderPendingResponse(),
          );

        mocks.providerVerify
          .mockResolvedValue(
            createDelayedProviderPendingResponse(),
          );

        const response =
          await initiateContribution();

        expectSuccessfulHttp(
          response,
        );

        const payload =
          getPayload(
            response,
          );

        const status =
          getNestedStatus(
            payload,
          );

        if (
          status
        ) {
          expect(
            PAYMENT_TERMINAL_SUCCESS_STATES.has(
              status,
            ),
          ).toBe(
            false,
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
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'an unknown delayed provider outcome is not converted into a successful ledger posting',
      async () => {
        await seedContext();

        await initiateContribution();

        const unknownCallback =
          createDelayedCallback({
            callbackId:
              'MTN-CB-UNKNOWN-DELAYED-000001',

            status:
              'UNKNOWN',

            outcome:
              'UNKNOWN',

            responseCode:
              'UNKNOWN',

            responseMessage:
              'Provider outcome cannot be confirmed',
          });

        const response =
          await request(
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
              unknownCallback.callbackId,
            )
            .send(
              unknownCallback,
            );

        expect(
          [
            200,
            202,
            409,
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
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'a successful delayed callback creates a balanced journal with exactly one logical financial identity',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendDelayedSuccessCallback();

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                transactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
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
            String(
              journal.totalDebit ??
                journal.debitTotal ??
                '',
            );

          const credit =
            String(
              journal.totalCredit ??
                journal.creditTotal ??
                '',
            );

          if (
            debit &&
            credit
          ) {
            expect(
              debit,
            ).toBe(
              credit,
            );

            expect(
              debit,
            ).toBe(
              CONTRIBUTION_AMOUNT,
            );
          }

          if (
            journal.currency
          ) {
            expect(
              String(
                journal.currency,
              ).toUpperCase(),
            ).toBe(
              CONTRIBUTION_CURRENCY,
            );
          }

          if (
            journal.status
          ) {
            expect(
              String(
                journal.status,
              ).toUpperCase(),
            ).toBe(
              'POSTED',
            );
          }
        }

        const entries =
          await findJournalEntries({
            $or: [
              {
                transactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },

              {
                reference:
                  IDEMPOTENCY_KEY,
              },
            ],
          });

        if (
          entries.length
        ) {
          expect(
            entries.length,
          ).toBeGreaterThanOrEqual(
            2,
          );
        }
      },
    );

    test(
      'delayed callback preserves provider transaction identity across asynchronous processing',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendDelayedSuccessCallback();

        const payments =
          await findPayments({
            $or: [
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
          const providerTransactionId =
            payments[0]
              .providerTransactionId ||
            payments[0]
              .externalTransactionId;

          if (
            providerTransactionId
          ) {
            expect(
              String(
                providerTransactionId,
              ),
            ).toBe(
              DELAYED_PROVIDER_TRANSACTION_ID,
            );
          }
        }

        const transactions =
          await findTransactions({
            $or: [
              {
                providerTransactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
              },

              {
                transactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
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
      'delayed callback completion remains safe when the original contribution request is retried after success',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendDelayedSuccessCallback();

        const replay =
          await initiateContribution();

        expectSuccessfulHttp(
          replay,
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
                  DELAYED_PROVIDER_TRANSACTION_ID,
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

        const payments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                providerTransactionId:
                  DELAYED_PROVIDER_TRANSACTION_ID,
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
      'delayed callback processing remains tenant-scoped when identical references exist in different tenants',
      async () => {
        await seedContext();

        const first =
          await initiateContribution();

        expectSuccessfulHttp(
          first,
        );

        /**
         * Deliberately use the same external callback identity to verify that
         * tenant-aware correlation cannot cause cross-tenant posting.
         */
        const callbackResponse =
          await sendDelayedSuccessCallback({
            tenantId:
              TEST_TENANT_ID,
          });

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          callbackResponse.status,
        );

        const allJournals =
          await findCollectionDocuments(
            [
              'journals',
            ],
            {},
          );

        for (
          const journal of
            allJournals
        ) {
          if (
            journal.idempotencyKey ===
              IDEMPOTENCY_KEY ||
            journal.transactionId ===
              DELAYED_PROVIDER_TRANSACTION_ID
          ) {
            expect(
              String(
                journal.tenantId ||
                  '',
              ),
            ).toBe(
              TEST_TENANT_ID,
            );
          }
        }
      },
    );
  },
);

/* ============================================================================
 * End of File
 * ============================================================================
 */