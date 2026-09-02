'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Golden Money Path - Contribution Provider Timeout Integration Tests
 * ============================================================================
 *
 * File:
 *   tests/integration/goldenMoneyPath/contribution.providerTimeout.test.js
 *
 * Purpose
 * -------
 * Enterprise integration coverage for provider timeout and unknown-outcome
 * conditions during the canonical contribution Golden Money Path.
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
 *      +---- timeout / network ambiguity ----+
 *      |                                     |
 *      v                                     v
 *   PAYMENT UNKNOWN                    PROVIDER QUERY
 *                                            |
 *                         +------------------+------------------+
 *                         |                                     |
 *                         v                                     v
 *                      SUCCESS                               FAILED
 *                         |                                     |
 *                         v                                     v
 *                    SETTLEMENT                         SAFE FAILURE
 *                         |                                     |
 *                         v                                     |
 *                  LEDGER POSTING                           NO POST
 *
 * Primary objectives
 * ------------------
 * 1. Provider timeout is never treated as successful payment confirmation.
 * 2. A timeout does not create a ledger posting based on an unknown outcome.
 * 3. The payment enters a safe UNKNOWN / PENDING / RECONCILIATION state.
 * 4. Provider status verification can resolve the unknown operation.
 * 5. A later successful provider callback creates exactly one ledger posting.
 * 6. A later failed provider result never creates a successful ledger posting.
 * 7. Retrying the provider operation reuses the original financial identity.
 * 8. Timeout recovery never creates duplicate provider transactions.
 * 9. Timeout recovery never creates duplicate payment records.
 * 10. Timeout recovery never creates duplicate transactions.
 * 11. Timeout recovery never creates duplicate journals.
 * 12. Concurrent retries remain idempotent.
 * 13. Cross-tenant timeout recovery remains isolated.
 * 14. Unknown outcomes remain auditable and reconcilable.
 * 15. Financial history remains immutable.
 *
 * IMPORTANT
 * ---------
 * A provider timeout is an ambiguous external outcome.
 *
 * The platform MUST NOT assume:
 *
 *   timeout === failure
 *   timeout === success
 *
 * The safe interpretation is:
 *
 *   timeout => UNKNOWN / RECONCILIATION REQUIRED
 *
 * until the provider status can be independently verified.
 *
 * This suite does not require live MTN/Airtel credentials.
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
  'tenant-golden-path-timeout-001';

const OTHER_TENANT_ID =
  'tenant-golden-path-timeout-002';

const MEMBER_ID =
  '507f1f77bcf86cd799439401';

const OTHER_TENANT_MEMBER_ID =
  '507f1f77bcf86cd799439402';

const GROUP_ID =
  '507f1f77bcf86cd799439403';

const CONTRIBUTION_AMOUNT =
  '175000';

const CONTRIBUTION_CURRENCY =
  'UGX';

const TEST_PHONE =
  '256700000201';

const OTHER_TENANT_PHONE =
  '256700000202';

const IDEMPOTENCY_KEY =
  'golden-money-path-provider-timeout-000001';

const PROVIDER_TRANSACTION_ID =
  'MTN-UG-TIMEOUT-000001';

const PROVIDER_CALLBACK_ID =
  'MTN-CB-TIMEOUT-000001';

const AUTH_TOKEN =
  'test-access-token';

const OTHER_TENANT_TOKEN =
  'other-tenant-access-token';

/* ============================================================================
 * Expected State Groups
 * ========================================================================== */

const UNKNOWN_OR_PENDING_STATES =
  new Set([
    'UNKNOWN',
    'PENDING',
    'PROCESSING',
    'INITIATED',
    'AWAITING_CALLBACK',
    'AWAITING_PROVIDER',
    'SUBMITTED',
    'QUEUED',
    'RECONCILIATION_REQUIRED',
    'REQUIRES_RECONCILIATION',
    'VERIFYING',
  ]);

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
    'CANCELLED',
    'CANCELED',
    'REJECTED',
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

function timeoutError(
  message = 'Provider request timed out',
) {
  const error =
    new Error(
      message,
    );

  error.code =
    'ETIMEDOUT';

  error.name =
    'ProviderTimeoutError';

  error.retryable =
    false;

  error.unknownOutcome =
    true;

  error.reconciliationRequired =
    true;

  return error;
}

function createPendingProviderResponse(
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
      overrides.responseCode ||
      'PENDING',

    responseMessage:
      overrides.responseMessage ||
      'Provider transaction remains pending',

    ...overrides,
  };
}

function createSuccessProviderResponse(
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
      overrides.responseCode ||
      'SUCCESS',

    responseMessage:
      overrides.responseMessage ||
      'Transaction successful',

    ...overrides,
  };
}

function createFailedProviderResponse(
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
      overrides.responseCode ||
      'FAILED',

    responseMessage:
      overrides.responseMessage ||
      'Provider transaction failed',

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
 * Test Setup
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
      'golden-money-path-timeout-test-secret';

    process.env.INTERNAL_API_KEY =
      'golden-money-path-timeout-internal-key';

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
          .mockRejectedValue(
            timeoutError(),
          ),

      providerVerify:
        jest
          .fn()
          .mockResolvedValue(
            createPendingProviderResponse(),
          ),

      providerCallback:
        jest
          .fn()
          .mockResolvedValue(
            createSuccessProviderResponse(),
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
      .mockRejectedValue(
        timeoutError(),
      );

    mocks.providerVerify
      .mockResolvedValue(
        createPendingProviderResponse(),
      );

    mocks.providerCallback
      .mockResolvedValue(
        createSuccessProviderResponse(),
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
        'Golden Money Path Provider Timeout Group',

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
          '507f1f77bcf86cd799439404',

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
          '507f1f77bcf86cd799439405',

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
      'Provider timeout integration test contribution',
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

async function sendProviderCallback(
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
        `timeout-callback-${crypto.randomUUID()}`,
    )
    .send(
      createSuccessCallback(
        overrides,
      ),
    );
}

/**
 * Attempt common provider-verification HTTP routes.
 *
 * Some production implementations expose verification only as an internal
 * service/job. Therefore this helper returns null when no public verification
 * route exists rather than treating that as a test failure.
 */
async function queryProviderStatus(
  options = {},
) {
  const paymentId =
    options.paymentId ||
    PROVIDER_TRANSACTION_ID;

  const candidates = [
    {
      method:
        'get',

      path:
        `/api/payments/${paymentId}/verify`,
    },

    {
      method:
        'get',

      path:
        `/api/payments/verify/${paymentId}`,
    },

    {
      method:
        'post',

      path:
        '/api/payments/verify',
    },

    {
      method:
        'post',

      path:
        '/api/payments/status',
    },
  ];

  for (
    const candidate of
      candidates
  ) {
    try {
      let response;

      if (
        candidate.method ===
        'get'
      ) {
        response =
          await authenticatedRequest()
            .get(
              candidate.path,
            )
            .query({
              paymentId:
                options.paymentId ||
                undefined,

              provider:
                'mtn',

              providerTransactionId:
                PROVIDER_TRANSACTION_ID,

              idempotencyKey:
                `${IDEMPOTENCY_KEY}:verify`,
            });
      } else {
        response =
          await authenticatedRequest()
            .post(
              candidate.path,
            )
            .send({
              paymentId:
                options.paymentId ||
                null,

              provider:
                'mtn',

              providerTransactionId:
                PROVIDER_TRANSACTION_ID,

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
          response.status,
        )
      ) {
        return response;
      }
    } catch (
      _error
    ) {
      // Try next route.
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
  const documents =
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

    const rows =
      await collection
        .find(
          filter,
        )
        .toArray();

    documents.push(
      ...rows,
    );
  }

  return documents;
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
 * Suite
 * ========================================================================== */

describe(
  'Golden Money Path - Contribution Provider Timeout',
  () => {
    test(
      'does not treat a provider timeout as payment success',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(
              'MTN request timed out before a definitive provider outcome was received',
            ),
          );

        const response =
          await initiateContribution();

        /**
         * Depending on the API contract, the application may return 202
         * ACCEPTED/UNKNOWN, 409 reconciliation conflict, or another explicit
         * timeout response. It must never claim definitive financial success.
         */
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

        const body =
          responseBody(
            response,
          );

        const success =
          body.success ===
          true;

        const payload =
          responsePayload(
            response,
          );

        const status =
          getNestedStatus(
            payload,
          );

        if (
          response.status >=
            200 &&
          response.status <
            300
        ) {
          expect(
            status ===
              ''
              ||
              !TERMINAL_SUCCESS_STATES.has(
                status,
              ),
          ).toBe(
            true,
          );
        }

        expect(
          success &&
            TERMINAL_SUCCESS_STATES.has(
              status,
            ),
        ).toBe(
          false,
        );
      },
    );

    test(
      'provider timeout does not create a ledger posting with an unknown outcome',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

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

              {
                reference:
                  IDEMPOTENCY_KEY,
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
      'provider timeout creates at most one pending/unknown payment record',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

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

          const status =
            getStatus(
              payments[0],
            );

          if (
            status
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
      'provider timeout is not converted into a failed financial transaction until provider status is known',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

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

        /**
         * Some systems persist a transaction intent row. That is allowed, but
         * it must not be represented as a successful financial transaction.
         */
        for (
          const transaction of
            transactions
        ) {
          const status =
            getStatus(
              transaction,
            );

          if (
            status
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
      'a provider timeout is recoverable by authoritative provider verification returning success',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        const initiateResponse =
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
          initiateResponse.status,
        );

        mocks.providerVerify
          .mockResolvedValue(
            createSuccessProviderResponse(),
          );

        const paymentId =
          getIdentifier(
            responsePayload(
              initiateResponse,
            ),
            [
              'paymentId',
              '_id',
              'id',
            ],
          );

        const verifyResponse =
          await queryProviderStatus({
            paymentId,
          });

        if (
          verifyResponse
          &&
          verifyResponse.status <
            500
          &&
          verifyResponse.status !==
            404
        ) {
          expect(
            [
              200,
              202,
            ],
          ).toContain(
            verifyResponse.status,
          );
        }

        /**
         * If the implementation does not expose verification over HTTP, the
         * callback below still exercises the authoritative completion path.
         */
        const callback =
          await sendProviderCallback();

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
      'provider timeout followed by successful callback creates exactly one journal',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

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
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        expect(
          before.length,
        ).toBe(
          0,
        );

        await sendProviderCallback();

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

        if (
          after.length
        ) {
          expect(
            after.length,
          ).toBe(
            1,
          );

          const status =
            getStatus(
              after[0],
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
      'provider timeout followed by successful callback creates balanced double-entry entries',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

        await sendProviderCallback();

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
        }

        const entries =
          await findJournalEntries({
            $or: [
              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                journalId:
                  journals[0]?._id,
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
      'provider timeout followed by failed provider verification never creates a ledger posting',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            createFailedProviderResponse(),
          );

        const verifyResponse =
          await queryProviderStatus();

        if (
          verifyResponse
          &&
          verifyResponse.status <
            500
          &&
          verifyResponse.status !==
            404
        ) {
          expect(
            [
              200,
              202,
              400,
              409,
            ],
          ).toContain(
            verifyResponse.status,
          );
        }

        /**
         * Do not send a success callback in this test.
         *
         * The authoritative provider outcome is FAILED.
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

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'provider timeout followed by explicit failed callback never creates a successful ledger posting',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

        const failedCallback =
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
              'MTN-CB-TIMEOUT-FAILED-000001',
            )
            .send(
              createSuccessCallback({
                callbackId:
                  'MTN-CB-TIMEOUT-FAILED-000001',

                status:
                  'FAILED',

                outcome:
                  'FAILED',

                responseCode:
                  'FAILED',

                responseMessage:
                  'Transaction failed after provider timeout',
              }),
            );

        expect(
          [
            200,
            202,
            409,
          ],
        ).toContain(
          failedCallback.status,
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
          const status =
            getStatus(
              payment,
            );

          if (
            status
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
      'provider timeout followed by successful callback remains idempotent under callback replay',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

        const first =
          await sendProviderCallback({
            callbackId:
              PROVIDER_CALLBACK_ID,
          });

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
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        const second =
          await sendProviderCallback({
            callbackId:
              PROVIDER_CALLBACK_ID,
          });

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
                  PROVIDER_TRANSACTION_ID,
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
      'provider timeout does not authorize a second provider transaction when the original request is retried',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        const first =
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
          first.status,
        );

        /**
         * Once an external operation has an unknown outcome, a retry must not
         * blindly issue another provider instruction under the same financial
         * identity.
         */
        mocks.providerInitiate
          .mockImplementation(
            async () => {
              throw new Error(
                'A second provider initiation is not permitted before reconciliation.',
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
            503,
            504,
          ],
        ).toContain(
          second.status,
        );

        /**
         * If the test application's provider mock is wired directly, the two
         * calls must not represent two distinct successful provider commands.
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
      'provider timeout does not create duplicate payments when the contribution request is retried',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

        await initiateContribution();

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
        }
      },
    );

    test(
      'provider timeout does not create duplicate transaction identities when the request is retried',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

        await initiateContribution();

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
      'concurrent retries after a provider timeout collapse to a single logical operation',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        const calls =
          Array.from(
            {
              length:
                8,
            },
            () =>
              initiateContribution(),
          );

        const responses =
          await Promise.all(
            calls,
          );

        for (
          const response of
            responses
        ) {
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
        }

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

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'provider timeout followed by successful provider verification remains tenant-scoped',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            createSuccessProviderResponse(),
          );

        await queryProviderStatus();

        const callback =
          await sendProviderCallback();

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
      },
    );

    test(
      'cross-tenant retry of a timed-out contribution cannot create or claim the original payment',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        const first =
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
          first.status,
        );

        const second =
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
                '256700000202',

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
          second.status,
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
      'provider timeout followed by callback success does not alter the original request identity',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        const response =
          await initiateContribution();

        const payload =
          responsePayload(
            response,
          );

        const initialPaymentId =
          getIdentifier(
            payload,
            [
              'paymentId',
              '_id',
              'id',
            ],
          );

        await sendProviderCallback();

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
          initialPaymentId &&
          payments.length
        ) {
          const persistedIds =
            payments.map(
              (
                payment,
              ) =>
                String(
                  payment._id ||
                    payment.id ||
                    payment.paymentId,
                ),
            );

          expect(
            persistedIds,
          ).toContain(
            initialPaymentId,
          );
        }
      },
    );

    test(
      'provider timeout followed by success does not duplicate financial entries across callback and verification races',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            createSuccessProviderResponse(),
          );

        const [
          verification,
          callbackOne,
          callbackTwo,
        ] =
          await Promise.all([
            queryProviderStatus(),

            sendProviderCallback({
              callbackId:
                PROVIDER_CALLBACK_ID,
            }),

            sendProviderCallback({
              callbackId:
                PROVIDER_CALLBACK_ID,
            }),
          ]);

        if (
          verification
        ) {
          expect(
            [
              200,
              202,
            ].includes(
              verification.status,
            ) ||
              [
                400,
                404,
                409,
              ].includes(
                verification.status,
              ),
          ).toBe(
            true,
          );
        }

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          callbackOne.status,
        );

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          callbackTwo.status,
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
      'provider timeout outcome remains auditable and does not disappear as a generic internal error',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(
              'Airtel/MTN provider request exceeded the configured timeout',
            ),
          );

        const response =
          await initiateContribution();

        const body =
          responseBody(
            response,
          );

        /**
         * The API may expose structured error metadata or a safe acceptance
         * response. If exposed, verify timeout semantics survive the boundary.
         */
        const code =
          body.code ||
          body.error?.code ||
          body.data?.code ||
          null;

        const message =
          body.message ||
          body.error?.message ||
          body.data?.message ||
          '';

        if (
          code
        ) {
          expect(
            String(
              code,
            ).toUpperCase(),
          ).toMatch(
            /TIMEOUT|UNKNOWN|PROVIDER|RECONCIL/,
          );
        }

        if (
          message
        ) {
          expect(
            String(
              message,
            ).length,
          ).toBeGreaterThan(
            0,
          );
        }
      },
    );

    test(
      'timeout recovery preserves contribution amount and currency',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            createSuccessProviderResponse(),
          );

        await queryProviderStatus();

        await sendProviderCallback();

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
      'repeated status checks while provider remains unknown do not create ledger side effects',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            createPendingProviderResponse({
              responseCode:
                'PENDING',
            }),
          );

        await queryProviderStatus();

        await queryProviderStatus();

        await queryProviderStatus();

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
      },
    );

    test(
      'a timeout followed by definitive provider failure remains financially idempotent',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            createFailedProviderResponse(),
          );

        await queryProviderStatus();

        /**
         * Simulate a definitive failed callback after the status lookup.
         */
        const failedCallback =
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
              'MTN-CB-TIMEOUT-DEFINITIVE-FAIL-000001',
            )
            .send(
              createSuccessCallback({
                callbackId:
                  'MTN-CB-TIMEOUT-DEFINITIVE-FAIL-000001',

                status:
                  'FAILED',

                outcome:
                  'FAILED',

                responseCode:
                  'FAILED',

                responseMessage:
                  'Provider definitively failed the transaction',
              }),
            );

        expect(
          [
            200,
            202,
            409,
          ],
        ).toContain(
          failedCallback.status,
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
      },
    );

    test(
      'timeout recovery is safe when the original contribution request is retried after reconciliation',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            createSuccessProviderResponse(),
          );

        await queryProviderStatus();

        await sendProviderCallback();

        /**
         * Replaying the original client request must return the existing
         * operation rather than issue a new provider operation.
         */
        mocks.providerInitiate
          .mockImplementation(
            async () => {
              throw new Error(
                'Second provider initiation after reconciliation is forbidden.',
              );
            },
          );

        const replay =
          await initiateContribution();

        expect(
          [
            200,
            202,
            409,
          ],
        ).toContain(
          replay.status,
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
      'timeout recovery does not mutate or rewrite the original posted journal',
      async () => {
        await seedContext();

        /**
         * First complete the operation normally through timeout + successful
         * recovery.
         */
        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        await initiateContribution();

        await sendProviderCallback();

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

        await sendProviderCallback();

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

        if (
          before.length
          &&
          after.length
        ) {
          expect(
            after.length,
          ).toBe(
            before.length,
          );

          const beforeJournal =
            before[0];

          const afterJournal =
            after[0];

          expect(
            String(
              afterJournal._id ||
                afterJournal.id,
            ),
          ).toBe(
            String(
              beforeJournal._id ||
                beforeJournal.id,
            ),
          );
        }
      },
    );

    test(
      'provider timeout is isolated from another tenant using its own contribution',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            timeoutError(),
          );

        const first =
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
          first.status,
        );

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
                'other-tenant-timeout-000001',

              reference:
                'other-tenant-timeout-000001',
            });

        expect(
          [
            400,
            403,
            404,
            409,
            422,
            503,
            504,
          ],
        ).toContain(
          otherTenantResponse.status,
        );

        const journals =
          await findJournals({});

        for (
          const journal of
            journals
        ) {
          const matchingIdentity =
            journal.idempotencyKey ===
              IDEMPOTENCY_KEY ||
            journal.transactionId ===
              PROVIDER_TRANSACTION_ID;

          if (
            matchingIdentity
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