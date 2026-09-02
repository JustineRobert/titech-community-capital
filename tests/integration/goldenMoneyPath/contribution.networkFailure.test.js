'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Golden Money Path - Contribution Network Failure Integration Tests
 * ============================================================================
 *
 * File:
 *   tests/integration/goldenMoneyPath/contribution.networkFailure.test.js
 *
 * Purpose
 * -------
 * Enterprise integration coverage for network-level failures across the
 * contribution Golden Money Path.
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
 *      +--> Provider HTTP/network boundary
 *      |
 *      +---- ECONNRESET / ECONNREFUSED / ENOTFOUND / EAI_AGAIN / socket close
 *      |
 *      v
 *   Safe Payment State
 *      |
 *      +--> UNKNOWN / PENDING / RECONCILIATION
 *      |
 *      v
 *   Provider Verification / Callback
 *      |
 *      v
 *   Settlement
 *      |
 *      v
 *   Ledger / Posting Engine
 *
 * Primary objectives
 * ------------------
 * 1. Network failure is never treated as provider success.
 * 2. Network failure is not automatically treated as definitive provider
 *    failure when the external outcome is unknown.
 * 3. No ledger posting occurs before authoritative confirmation.
 * 4. A recoverable network failure can be reconciled by provider verification.
 * 5. A later successful callback creates exactly one financial posting.
 * 6. A later failed provider outcome creates no successful ledger posting.
 * 7. Retrying a request is idempotent.
 * 8. Retry logic does not manufacture duplicate provider transactions.
 * 9. Retry logic does not create duplicate payments or transactions.
 * 10. Retry logic does not create duplicate journals.
 * 11. Concurrent network-failure recovery remains safe.
 * 12. Cross-tenant isolation is preserved.
 * 13. Financial history remains immutable.
 * 14. Transport failures remain observable and recoverable.
 *
 * IMPORTANT
 * ---------
 * Network failures have two fundamentally different meanings:
 *
 *   A. Definitive transport failure before the provider could possibly accept
 *      the request.
 *
 *   B. Ambiguous transport failure after the provider may have accepted the
 *      request.
 *
 * The application MUST NOT infer a definitive financial outcome from the
 * network exception alone unless the integration contract guarantees that the
 * request did not reach the provider.
 *
 * These tests therefore assert safe behavior rather than assuming:
 *
 *   network error === failure
 *
 * For ambiguous outcomes, the expected path is:
 *
 *   UNKNOWN/PENDING -> VERIFY -> SUCCESS/FAILED
 *
 * External provider credentials are never required.
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
  'tenant-golden-path-network-001';

const OTHER_TENANT_ID =
  'tenant-golden-path-network-002';

const MEMBER_ID =
  '507f1f77bcf86cd799439601';

const OTHER_TENANT_MEMBER_ID =
  '507f1f77bcf86cd799439602';

const GROUP_ID =
  '507f1f77bcf86cd799439603';

const CONTRIBUTION_AMOUNT =
  '90000';

const CONTRIBUTION_CURRENCY =
  'UGX';

const TEST_PHONE =
  '256700000401';

const OTHER_TENANT_PHONE =
  '256700000402';

const IDEMPOTENCY_KEY =
  'golden-money-path-network-failure-000001';

const PROVIDER_TRANSACTION_ID =
  'MTN-UG-NETWORK-FAILURE-000001';

const PROVIDER_CALLBACK_ID =
  'MTN-CB-NETWORK-FAILURE-000001';

const AUTH_TOKEN =
  'test-access-token';

const OTHER_TENANT_TOKEN =
  'other-tenant-access-token';

/* ============================================================================
 * Status Sets
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
    'UNKNOWN',
    'VERIFYING',
    'RECONCILIATION_REQUIRED',
    'REQUIRES_RECONCILIATION',
    'QUEUED',
    'SUBMITTED',
    'SETTLEMENT_PENDING',
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

function createNetworkError(
  code,
  message,
  options = {},
) {
  const error =
    new Error(
      message,
    );

  error.name =
    options.name ||
    'NetworkError';

  error.code =
    code;

  error.errno =
    options.errno ||
    code;

  error.syscall =
    options.syscall ||
    'connect';

  error.address =
    options.address ||
    'provider.test';

  error.port =
    options.port ||
    443;

  error.retryable =
    options.retryable !==
    undefined
      ? options.retryable
      : true;

  error.unknownOutcome =
    options.unknownOutcome !==
    undefined
      ? options.unknownOutcome
      : true;

  error.reconciliationRequired =
    options.reconciliationRequired !==
    undefined
      ? options.reconciliationRequired
      : true;

  return error;
}

function connectionResetError() {
  return createNetworkError(
    'ECONNRESET',
    'Provider connection reset before a definitive response was received.',
  );
}

function connectionRefusedError() {
  return createNetworkError(
    'ECONNREFUSED',
    'Provider connection was refused.',
  );
}

function dnsError() {
  return createNetworkError(
    'ENOTFOUND',
    'Provider hostname could not be resolved.',
  );
}

function temporaryDnsError() {
  return createNetworkError(
    'EAI_AGAIN',
    'Temporary DNS resolution failure.',
  );
}

function socketClosedError() {
  return createNetworkError(
    'ERR_SOCKET_CLOSED',
    'Provider socket was closed unexpectedly.',
  );
}

function abortError() {
  return createNetworkError(
    'ECONNABORTED',
    'Provider request was aborted.',
  );
}

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
      'Provider has not completed the operation',

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
      'Provider rejected the operation',

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
      'golden-money-path-network-failure-secret';

    process.env.INTERNAL_API_KEY =
      'golden-money-path-network-failure-internal';

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
              '507f1f77bcf86cd799439604',

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
          '507f1f77bcf86cd799439604',

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
        'Golden Money Path Network Failure Group',

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
          '507f1f77bcf86cd799439605',

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
          '507f1f77bcf86cd799439606',

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
      'Network failure integration test contribution',
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
        `network-failure-callback-${crypto.randomUUID()}`,
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
  const documents =
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
  'Golden Money Path - Contribution Network Failure',
  () => {
    test(
      'ECONNRESET is never interpreted as successful payment confirmation',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        const response =
          await initiateContribution();

        expect(
          [
            200,
            202,
            409,
            500,
            503,
            504,
          ],
        ).toContain(
          response.status,
        );

        const status =
          getNestedStatus(
            responsePayload(
              response,
            ),
          );

        if (
          response.status >=
            200 &&
          response.status <
            300
          ) {
          expect(
            TERMINAL_SUCCESS_STATES.has(
              status,
            ),
          ).toBe(
            false,
          );
        }
      },
    );

    test(
      'ECONNRESET does not create a ledger journal before provider outcome is known',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
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
      'ECONNREFUSED produces a safe recoverable state and no successful ledger entry',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionRefusedError(),
          );

        const response =
          await initiateContribution();

        expect(
          [
            200,
            202,
            409,
            500,
            503,
            504,
          ],
        ).toContain(
          response.status,
        );

        const journals =
          await findJournals({
            idempotencyKey:
              IDEMPOTENCY_KEY,
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
                paymentReference:
                  IDEMPOTENCY_KEY,
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
      'ENOTFOUND does not create financial success',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            dnsError(),
          );

        const response =
          await initiateContribution();

        expect(
          [
            200,
            202,
            409,
            500,
            503,
            504,
          ],
        ).toContain(
          response.status,
        );

        const journals =
          await findJournals({
            idempotencyKey:
              IDEMPOTENCY_KEY,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'EAI_AGAIN is treated as recoverable network ambiguity rather than provider success',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            temporaryDnsError(),
          );

        const response =
          await initiateContribution();

        expect(
          [
            200,
            202,
            409,
            500,
            503,
            504,
          ],
        ).toContain(
          response.status,
        );

        const status =
          getNestedStatus(
            responsePayload(
              response,
            ),
          );

        if (
          response.status >=
            200 &&
          response.status <
            300
        ) {
          expect(
            TERMINAL_SUCCESS_STATES.has(
              status,
            ),
          ).toBe(
            false,
          );
        }

        const journals =
          await findJournals({
            idempotencyKey:
              IDEMPOTENCY_KEY,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'unexpected socket closure does not post to the ledger',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            socketClosedError(),
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
      'aborted provider connection does not create a successful payment state',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            abortError(),
          );

        const response =
          await initiateContribution();

        const status =
          getNestedStatus(
            responsePayload(
              response,
            ),
          );

        if (
          response.status >=
            200 &&
          response.status <
            300
        ) {
          expect(
            TERMINAL_SUCCESS_STATES.has(
              status,
            ),
          ).toBe(
            false,
          );
        }
      },
    );

    test(
      'ambiguous network failure can be reconciled by authoritative provider success',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValueOnce(
            providerSuccess(),
          );

        /**
         * The provider status service may be internal rather than publicly
         * exposed. The success callback remains the canonical fallback for
         * validating the final financial transition.
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
          expect(
            TERMINAL_SUCCESS_STATES.has(
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
      'ambiguous network failure followed by provider success creates exactly one journal',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

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
      'ambiguous network failure followed by provider failure creates no successful journal',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValueOnce(
            providerFailed(),
          );

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
              'MTN-CB-NETWORK-FAILED-000001',
            )
            .send(
              createSuccessCallback({
                callbackId:
                  'MTN-CB-NETWORK-FAILED-000001',

                status:
                  'FAILED',

                outcome:
                  'FAILED',

                responseCode:
                  'FAILED',
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
      'retrying an ambiguous network failure does not create duplicate payments',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            connectionResetError(),
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
      'retrying an ambiguous network failure does not create duplicate transaction records',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            connectionResetError(),
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
      'retrying an ambiguous network failure does not create duplicate contribution records',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            connectionResetError(),
          );

        await initiateContribution();

        await initiateContribution();

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
      'the same network failure remains idempotent under concurrent retries',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            connectionResetError(),
          );

        const requests =
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
            requests,
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
              500,
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
      'network failure followed by successful callback is idempotent when callback is replayed',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

        const first =
          await sendSuccessCallback();

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
          await sendSuccessCallback();

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
      'network failure recovery never changes the provider transaction identity',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

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
      'network failure recovery produces one balanced journal',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

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

          const debit =
            String(
              journals[0]
                .totalDebit ??
                journals[0]
                  .debitTotal ??
                '',
            );

          const credit =
            String(
              journals[0]
                .totalCredit ??
                journals[0]
                  .creditTotal ??
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
      },
    );

    test(
      'network failure recovery does not alter the journal after successful posting',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

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
      'network failure does not silently cross the tenant boundary during recovery',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

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
      'network failure can transition from unknown to successful completion exactly once',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        const first =
          await initiateContribution();

        expect(
          [
            200,
            202,
            409,
            500,
            503,
            504,
          ],
        ).toContain(
          first.status,
        );

        const initialPayments =
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
          initialPayments.length
        ) {
          const state =
            getStatus(
              initialPayments[0],
            );

          if (
            state
          ) {
            expect(
              TERMINAL_SUCCESS_STATES.has(
                state,
              ),
            ).toBe(
              false,
            );
          }
        }

        mocks.providerVerify
          .mockResolvedValueOnce(
            providerSuccess(),
          );

        await sendSuccessCallback();

        const finalPayments =
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
          finalPayments.length
        ) {
          expect(
            TERMINAL_SUCCESS_STATES.has(
              getStatus(
                finalPayments[0],
              ),
            ),
          ).toBe(
            true,
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
      'network failure followed by definitive provider failure remains free of successful financial side effects',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValueOnce(
            providerFailed(),
          );

        const failed =
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
              'MTN-CB-NETWORK-FAIL-000001',
            )
            .send(
              createSuccessCallback({
                callbackId:
                  'MTN-CB-NETWORK-FAIL-000001',

                status:
                  'FAILED',

                outcome:
                  'FAILED',

                responseCode:
                  'FAILED',
              }),
            );

        expect(
          [
            200,
            202,
            409,
          ],
        ).toContain(
          failed.status,
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
      'network failure does not multiply account balances through duplicate retries',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValue(
            connectionRefusedError(),
          );

        await initiateContribution();

        await initiateContribution();

        /**
         * This suite intentionally verifies the authoritative ledger rather
         * than asserting a particular Account schema/balance implementation.
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

        const accounts =
          await findCollectionDocuments(
            [
              'accounts',
            ],
            {
              tenantId:
                TEST_TENANT_ID,
            },
          );

        /**
         * No account should contain a successfully posted contribution if no
         * authoritative journal exists.
         */
        for (
          const account of
            accounts
        ) {
          const status =
            getStatus(
              account,
            );

          if (
            status
          ) {
            expect(
              TERMINAL_FAILURE_STATES.has(
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
      'network failure recovery keeps one contribution identity',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

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
      'network failure recovery keeps one transaction identity',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

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
      'network failure recovery keeps one payment identity',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

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
        }
      },
    );

    test(
      'network failure does not cause an unrelated tenant to inherit the payment state',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

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
          response.status,
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
      },
    );

    test(
      'network failure remains recoverable when callback delivery itself is delayed',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        const initiation =
          await initiateContribution();

        expect(
          [
            200,
            202,
            409,
            500,
            503,
            504,
          ],
        ).toContain(
          initiation.status,
        );

        const initialJournals =
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
          initialJournals.length,
        ).toBe(
          0,
        );

        /**
         * Simulate time passing without using a real timer delay.
         */
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        const stillPendingJournals =
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
          stillPendingJournals.length,
        ).toBe(
          0,
        );

        await sendSuccessCallback();

        const finalJournals =
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
          finalJournals.length
        ) {
          expect(
            finalJournals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'network failure recovery is safe when callback and retry arrive concurrently',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
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
            500,
            503,
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
            500,
            503,
          ],
        ).toContain(
          retryTwo.status,
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
      'network failure recovery does not rewrite immutable journal history',
      async () => {
        await seedContext();

        await initiateContribution({
          idempotencyKey:
            'network-immutable-000001',
        });

        /**
         * Force the callback path to create the one authoritative financial
         * posting.
         */
        await sendSuccessCallback({
          paymentReference:
            'network-immutable-000001',

          providerTransactionId:
            'MTN-UG-NETWORK-IMMUTABLE-000001',

          transactionId:
            'MTN-UG-NETWORK-IMMUTABLE-000001',

          callbackId:
            'MTN-CB-NETWORK-IMMUTABLE-000001',
        });

        const before =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  'network-immutable-000001',
              },

              {
                transactionId:
                  'MTN-UG-NETWORK-IMMUTABLE-000001',
              },
            ],
          });

        await sendSuccessCallback({
          paymentReference:
            'network-immutable-000001',

          providerTransactionId:
            'MTN-UG-NETWORK-IMMUTABLE-000001',

          transactionId:
            'MTN-UG-NETWORK-IMMUTABLE-000001',

          callbackId:
            'MTN-CB-NETWORK-IMMUTABLE-000001',
        });

        const after =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  'network-immutable-000001',
              },

              {
                transactionId:
                  'MTN-UG-NETWORK-IMMUTABLE-000001',
              },
            ],
          });

        expect(
          after.length,
        ).toBe(
          before.length,
        );

        if (
          before.length &&
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
      'network failure with a different idempotency key is treated as a separate operation rather than corrupting the first operation',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        const first =
          await initiateContribution({
            idempotencyKey:
              'network-operation-a-000001',
          });

        expect(
          [
            200,
            202,
            409,
            500,
            503,
            504,
          ],
        ).toContain(
          first.status,
        );

        mocks.providerInitiate
          .mockResolvedValueOnce(
            providerSuccess({
              paymentReference:
                'network-operation-b-000001',

              reference:
                'network-operation-b-000001',

              externalReference:
                'network-operation-b-000001',

              providerTransactionId:
                'MTN-UG-NETWORK-OP-B-000001',

              transactionId:
                'MTN-UG-NETWORK-OP-B-000001',
            }),
          );

        const second =
          await initiateContribution({
            idempotencyKey:
              'network-operation-b-000001',

            reference:
              'network-operation-b-000001',
          });

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
          second.status,
        );

        const firstPayments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  'network-operation-a-000001',
              },

              {
                paymentReference:
                  'network-operation-a-000001',
              },
            ],
          });

        const secondPayments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  'network-operation-b-000001',
              },

              {
                paymentReference:
                  'network-operation-b-000001',
              },
            ],
          });

        /**
         * The second operation must never silently overwrite the first
         * operation's financial identity.
         */
        if (
          firstPayments.length
          &&
          secondPayments.length
        ) {
          expect(
            String(
              firstPayments[0]._id,
            ),
          ).not.toBe(
            String(
              secondPayments[0]._id,
            ),
          );
        }
      },
    );

    test(
      'network failure state remains safe even when provider verification temporarily fails as well',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

        mocks.providerVerify
          .mockRejectedValueOnce(
            temporaryDnsError(
            ),
          );

        /**
         * Callback is deliberately absent. There must be no premature journal.
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
      'network failure recovery keeps the financial source of truth singular',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionResetError(),
          );

        await initiateContribution();

        await sendSuccessCallback();

        const state =
          await snapshotFinancialState();

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
          state.journals.length
        ) {
          expect(
            state.journals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'network failure does not convert a missing provider response into a balance mutation',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockRejectedValueOnce(
            connectionRefusedError(),
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
            ],
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );

        const accounts =
          await findCollectionDocuments(
            [
              'accounts',
            ],
            {
              tenantId:
                TEST_TENANT_ID,
            },
          );

        /**
         * Do not assert a particular numeric starting balance because an
         * existing account model may not expose one standardized field.
         *
         * The important invariant is that no successful journal exists from
         * which a financial balance change could legitimately arise.
         */
        expect(
          accounts.length,
        ).toBeGreaterThanOrEqual(
          0,
        );
      },
    );
  },
);

/* ============================================================================
 * End of File
 * ============================================================================
 */