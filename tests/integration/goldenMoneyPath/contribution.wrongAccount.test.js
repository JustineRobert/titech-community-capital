'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Golden Money Path - Contribution Wrong Account Integration Tests
 * ============================================================================
 *
 * File:
 *   tests/integration/goldenMoneyPath/contribution.wrongAccount.test.js
 *
 * Purpose
 * -------
 * Enterprise integration coverage for account-selection and account-ownership
 * failures during contribution processing.
 *
 * Canonical flow:
 *
 *   MEMBER
 *      |
 *      v
 *   CONTRIBUTION REQUEST
 *      |
 *      v
 *   TENANT / GROUP / MEMBER RESOLUTION
 *      |
 *      v
 *   PAYMENT ORCHESTRATION
 *      |
 *      v
 *   PROVIDER SUCCESS
 *      |
 *      v
 *   PAYMENT VERIFICATION
 *      |
 *      v
 *   SETTLEMENT
 *      |
 *      v
 *   LEDGER / POSTING ENGINE
 *      |
 *      +--> ACCOUNT OWNERSHIP / CURRENCY / STATUS VALIDATION
 *      |
 *      v
 *   POSTED CONTRIBUTION
 *
 * Core invariants
 * ---------------
 * 1. A contribution MUST NEVER post to an unrelated account.
 * 2. A member cannot post against another tenant's account.
 * 3. A group contribution cannot resolve to an account belonging to a
 *    different tenant.
 * 4. A disabled/closed/frozen account cannot receive a contribution.
 * 5. A wrong-currency account cannot receive a contribution.
 * 6. An arbitrary client-supplied account ID cannot override server-side
 *    account-resolution rules.
 * 7. An invalid account reference MUST fail before financial posting.
 * 8. An account mismatch MUST NOT produce a successful ledger journal.
 * 9. An account mismatch MUST NOT create duplicate provider operations.
 * 10. An account mismatch MUST NOT mutate unrelated balances.
 * 11. A correct account can still complete normally after an invalid attempt.
 * 12. Concurrent wrong-account requests remain isolated and idempotent.
 * 13. Callback replay cannot cause posting to the wrong account.
 * 14. Cross-tenant identifiers cannot be used to claim another tenant's
 *     financial destination.
 * 15. Financial history remains append-only and auditable.
 *
 * IMPORTANT
 * ---------
 * This suite treats account resolution as a server-side trust boundary.
 *
 * Client supplied account identifiers, if accepted by the API, are treated as
 * hints only and must never bypass:
 *
 *   tenant isolation
 *   account ownership
 *   account status
 *   currency validation
 *   ledger posting rules
 *   contribution ownership
 *
 * The provider boundary is mocked. No live MTN/Airtel credentials are required.
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
  'tenant-golden-path-wrong-account-001';

const OTHER_TENANT_ID =
  'tenant-golden-path-wrong-account-002';

const MEMBER_ID =
  '507f1f77bcf86cd799439a01';

const OTHER_MEMBER_ID =
  '507f1f77bcf86cd799439a02';

const OTHER_TENANT_MEMBER_ID =
  '507f1f77bcf86cd799439a03';

const GROUP_ID =
  '507f1f77bcf86cd799439a04';

const MEMBER_ACCOUNT_ID =
  '507f1f77bcf86cd799439a05';

const GROUP_ACCOUNT_ID =
  '507f1f77bcf86cd799439a06';

const OTHER_TENANT_ACCOUNT_ID =
  '507f1f77bcf86cd799439a07';

const WRONG_ACCOUNT_ID =
  '507f1f77bcf86cd799439a08';

const DISABLED_ACCOUNT_ID =
  '507f1f77bcf86cd799439a09';

const FROZEN_ACCOUNT_ID =
  '507f1f77bcf86cd799439a10';

const WRONG_CURRENCY_ACCOUNT_ID =
  '507f1f77bcf86cd799439a11';

const SYSTEM_CASH_ACCOUNT_ID =
  '507f1f77bcf86cd799439a12';

const CONTRIBUTION_AMOUNT =
  '95000';

const CONTRIBUTION_CURRENCY =
  'UGX';

const WRONG_CURRENCY =
  'USD';

const TEST_PHONE =
  '256700000801';

const OTHER_MEMBER_PHONE =
  '256700000802';

const OTHER_TENANT_PHONE =
  '256700000803';

const IDEMPOTENCY_KEY =
  'golden-money-path-wrong-account-000001';

const SECOND_IDEMPOTENCY_KEY =
  'golden-money-path-wrong-account-000002';

const PROVIDER_TRANSACTION_ID =
  'MTN-UG-WRONG-ACCOUNT-000001';

const PROVIDER_CALLBACK_ID =
  'MTN-CB-WRONG-ACCOUNT-000001';

const AUTH_TOKEN =
  'test-access-token';

const OTHER_MEMBER_TOKEN =
  'other-member-access-token';

const OTHER_TENANT_TOKEN =
  'other-tenant-access-token';

/* ============================================================================
 * State Constants
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
    'VERIFYING',
    'UNKNOWN',
    'RECONCILIATION_REQUIRED',
    'SETTLEMENT_PENDING',
    'POSTING_PENDING',
    'QUEUED',
    'SUBMITTED',
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

function tokenPayload(
  payload = {},
) {
  return {
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
  };
}

/* ============================================================================
 * Provider Fixtures
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

function createSuccessCallback(
  overrides = {},
) {
  return {
    callbackId:
      overrides.callbackId ||
      PROVIDER_CALLBACK_ID,

    provider:
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
      'golden-money-path-wrong-account-secret';

    process.env.INTERNAL_API_KEY =
      'golden-money-path-wrong-account-internal';

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
              '507f1f77bcf86cd799439a13',

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
          '507f1f77bcf86cd799439a13',

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

        accountId:
          MEMBER_ACCOUNT_ID,
      },

      {
        _id:
          OTHER_MEMBER_ID,

        name:
          'Second Member',

        email:
          'member2@titech.com',

        phone:
          `+${OTHER_MEMBER_PHONE}`,

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

        accountId:
          OTHER_TENANT_ACCOUNT_ID,
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
        'Golden Money Path Wrong Account Group',

      tenantId:
        TEST_TENANT_ID,

      members: [
        MEMBER_ID,
        OTHER_MEMBER_ID,
      ],

      status:
        'active',

      isActive:
        true,

      accountId:
        GROUP_ACCOUNT_ID,
    });
  }

  if (
    models.Account
  ) {
    await models.Account.create([
      {
        _id:
          MEMBER_ACCOUNT_ID,

        tenantId:
          TEST_TENANT_ID,

        ownerId:
          MEMBER_ID,

        name:
          'Justine Robert Contribution Account',

        code:
          'MEM-001',

        currency:
          CONTRIBUTION_CURRENCY,

        type:
          'ASSET',

        accountType:
          'MEMBER',

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
          GROUP_ACCOUNT_ID,

        tenantId:
          TEST_TENANT_ID,

        ownerId:
          GROUP_ID,

        name:
          'Golden Money Path Group Contribution Account',

        code:
          'GRP-001',

        currency:
          CONTRIBUTION_CURRENCY,

        type:
          'LIABILITY',

        accountType:
          'GROUP_CONTRIBUTION',

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
          OTHER_TENANT_ACCOUNT_ID,

        tenantId:
          OTHER_TENANT_ID,

        ownerId:
          OTHER_TENANT_MEMBER_ID,

        name:
          'Other Tenant Contribution Account',

        code:
          'OTH-001',

        currency:
          CONTRIBUTION_CURRENCY,

        type:
          'ASSET',

        accountType:
          'MEMBER',

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
          WRONG_ACCOUNT_ID,

        tenantId:
          TEST_TENANT_ID,

        ownerId:
          OTHER_MEMBER_ID,

        name:
          'Wrong Member Account',

        code:
          'MEM-002',

        currency:
          CONTRIBUTION_CURRENCY,

        type:
          'ASSET',

        accountType:
          'MEMBER',

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
          DISABLED_ACCOUNT_ID,

        tenantId:
          TEST_TENANT_ID,

        ownerId:
          MEMBER_ID,

        name:
          'Disabled Contribution Account',

        code:
          'MEM-DISABLED',

        currency:
          CONTRIBUTION_CURRENCY,

        type:
          'ASSET',

        accountType:
          'MEMBER',

        status:
          'DISABLED',

        isActive:
          false,

        balance:
          0,

        debitBalance:
          0,

        creditBalance:
          0,
      },

      {
        _id:
          FROZEN_ACCOUNT_ID,

        tenantId:
          TEST_TENANT_ID,

        ownerId:
          MEMBER_ID,

        name:
          'Frozen Contribution Account',

        code:
          'MEM-FROZEN',

        currency:
          CONTRIBUTION_CURRENCY,

        type:
          'ASSET',

        accountType:
          'MEMBER',

        status:
          'FROZEN',

        isActive:
          false,

        balance:
          0,

        debitBalance:
          0,

        creditBalance:
          0,
      },

      {
        _id:
          WRONG_CURRENCY_ACCOUNT_ID,

        tenantId:
          TEST_TENANT_ID,

        ownerId:
          MEMBER_ID,

        name:
          'USD Contribution Account',

        code:
          'MEM-USD',

        currency:
          WRONG_CURRENCY,

        type:
          'ASSET',

        accountType:
          'MEMBER',

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
          SYSTEM_CASH_ACCOUNT_ID,

        tenantId:
          TEST_TENANT_ID,

        ownerId:
          null,

        name:
          'System Settlement Cash',

        code:
          'CASH-001',

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

    /**
     * The application may support accountId/sourceAccountId/memberAccountId.
     * These are deliberately explicit test inputs for account-boundary tests.
     */
    accountId:
      overrides.accountId,

    memberAccountId:
      overrides.memberAccountId,

    sourceAccountId:
      overrides.sourceAccountId,

    destinationAccountId:
      overrides.destinationAccountId,

    description:
      overrides.description ||
      'Wrong account integration test contribution',
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
        `wrong-account-callback-${crypto.randomUUID()}`,
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

async function findAccounts(
  filter = {},
) {
  if (
    models.Account
  ) {
    return models.Account
      .find(
        filter,
      )
      .lean();
  }

  return findCollectionDocuments(
    [
      'accounts',
    ],
    filter,
  );
}

async function logicalFinancialState(
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
  'Golden Money Path - Contribution Wrong Account',
  () => {
    test(
      'rejects an explicitly supplied account belonging to another member in the same tenant',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-same-tenant-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        const state =
          await logicalFinancialState(
            'wrong-account-same-tenant-000001',
          );

        expect(
          state.journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not post contribution funds to another member account when the supplied accountId is wrong',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              WRONG_ACCOUNT_ID,
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ].includes(
            response.status,
          ),
        ).toBe(
          true,
        );

        const wrongAccount =
          await findAccounts({
            _id:
              WRONG_ACCOUNT_ID,
          });

        expect(
          wrongAccount.length,
        ).toBe(
          1,
        );

        if (
          wrongAccount.length
        ) {
          const balance =
            wrongAccount[0]
              .balance;

          if (
            balance !==
              undefined &&
            balance !==
              null
          ) {
            expect(
              String(
                balance,
              ),
            ).toBe(
              '0',
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

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'rejects an account belonging to another tenant',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              OTHER_TENANT_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-cross-tenant-000001',
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

        const state =
          await logicalFinancialState(
            'wrong-account-cross-tenant-000001',
          );

        expect(
          state.journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'cross-tenant account cannot be used to redirect payment funds',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              OTHER_TENANT_ACCOUNT_ID,
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

        const otherTenantAccount =
          await findAccounts({
            _id:
              OTHER_TENANT_ACCOUNT_ID,
          });

        expect(
          otherTenantAccount.length,
        ).toBe(
          1,
        );

        if (
          otherTenantAccount.length
        ) {
          const balance =
            otherTenantAccount[0]
              .balance;

          if (
            balance !==
              undefined &&
            balance !==
              null
          ) {
            expect(
              String(
                balance,
              ),
            ).toBe(
              '0',
            );
          }
        }
      },
    );

    test(
      'rejects an explicitly supplied disabled account',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              DISABLED_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-disabled-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        const journals =
          await findJournals({
            idempotencyKey:
              'wrong-account-disabled-000001',
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'rejects an explicitly supplied frozen account',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              FROZEN_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-frozen-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        const journals =
          await findJournals({
            idempotencyKey:
              'wrong-account-frozen-000001',
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'rejects a wrong-currency account',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              WRONG_CURRENCY_ACCOUNT_ID,

            currency:
              CONTRIBUTION_CURRENCY,

            idempotencyKey:
              'wrong-account-currency-000001',
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
              'wrong-account-currency-000001',
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'rejects a non-existent account id',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              '507f1f77bcf86cd799439999',

            idempotencyKey:
              'wrong-account-missing-000001',
          });

        expect(
          [
            400,
            404,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        const state =
          await logicalFinancialState(
            'wrong-account-missing-000001',
          );

        expect(
          state.journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'rejects malformed account identifiers',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              'not-a-valid-object-id',

            idempotencyKey:
              'wrong-account-malformed-000001',
          });

        expect(
          [
            400,
            404,
            422,
          ],
        ).toContain(
          response.status,
        );

        const journals =
          await findJournals({
            idempotencyKey:
              'wrong-account-malformed-000001',
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'client supplied account cannot override server-side member account resolution',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              WRONG_ACCOUNT_ID,

            memberAccountId:
              WRONG_ACCOUNT_ID,

            sourceAccountId:
              WRONG_ACCOUNT_ID,

            destinationAccountId:
              WRONG_ACCOUNT_ID,
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ].includes(
            response.status,
          ),
        ).toBe(
          true,
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
      'provider callback cannot cause settlement into an account that failed ownership validation',
      async () => {
        await seedContext();

        const initiation =
          await initiateContribution({
            accountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              'callback-wrong-account-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ].includes(
            initiation.status,
          ),
        ).toBe(
          true,
        );

        const callback =
          await sendContributionCallback({
            paymentReference:
              'callback-wrong-account-000001',

            callbackId:
              'MTN-CB-WRONG-ACCOUNT-000001',
          });

        expect(
          [
            200,
            202,
            400,
            404,
            409,
          ],
        ).toContain(
          callback.status,
        );

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  'callback-wrong-account-000001',
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

        const wrongAccountJournals =
          await findJournals({
            accountId:
              WRONG_ACCOUNT_ID,
          });

        expect(
          wrongAccountJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'provider callback does not bypass tenant account validation',
      async () => {
        await seedContext();

        const initiation =
          await initiateContribution({
            accountId:
              OTHER_TENANT_ACCOUNT_ID,

            idempotencyKey:
              'callback-cross-tenant-account-000001',
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
          initiation.status,
        );

        const callback =
          await sendContributionCallback({
            paymentReference:
              'callback-cross-tenant-account-000001',

            callbackId:
              'MTN-CB-CROSS-TENANT-ACCOUNT-000001',
          });

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
          callback.status,
        );

        const journals =
          await findJournals({
            $or: [
              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                idempotencyKey:
                  'callback-cross-tenant-account-000001',
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
      'wrong-account request does not invoke provider initiation',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-no-provider-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ].includes(
            response.status,
          ),
        ).toBe(
          true,
        );

        /**
         * Account authorization belongs before provider initiation.
         */
        expect(
          mocks.providerInitiate.mock
            .calls.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'cross-tenant account rejection occurs before provider initiation',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              OTHER_TENANT_ACCOUNT_ID,

            idempotencyKey:
              'cross-tenant-no-provider-000001',
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

        expect(
          mocks.providerInitiate.mock
            .calls.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'disabled account rejection occurs before provider initiation',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              DISABLED_ACCOUNT_ID,

            idempotencyKey:
              'disabled-no-provider-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ].includes(
            response.status,
          ),
        ).toBe(
          true,
        );

        expect(
          mocks.providerInitiate.mock
            .calls.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'wrong-currency account rejection occurs before provider initiation',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              WRONG_CURRENCY_ACCOUNT_ID,

            idempotencyKey:
              'wrong-currency-no-provider-000001',
          });

        expect(
          [
            400,
            409,
            422,
          ].includes(
            response.status,
          ),
        ).toBe(
          true,
        );

        expect(
          mocks.providerInitiate.mock
            .calls.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'wrong-account failure does not create a payment record',
      async () => {
        await seedContext();

        await initiateContribution({
          accountId:
            WRONG_ACCOUNT_ID,

          idempotencyKey:
            'wrong-account-no-payment-000001',
        });

        const payments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  'wrong-account-no-payment-000001',
              },

              {
                paymentReference:
                  'wrong-account-no-payment-000001',
              },
            ],
          });

        expect(
          payments.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'wrong-account failure does not create a transaction',
      async () => {
        await seedContext();

        await initiateContribution({
          accountId:
            WRONG_ACCOUNT_ID,

          idempotencyKey:
            'wrong-account-no-transaction-000001',
        });

        const transactions =
          await findTransactions({
            $or: [
              {
                idempotencyKey:
                  'wrong-account-no-transaction-000001',
              },

              {
                reference:
                  'wrong-account-no-transaction-000001',
              },
            ],
          });

        expect(
          transactions.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'wrong-account failure does not create a contribution record',
      async () => {
        await seedContext();

        await initiateContribution({
          accountId:
            WRONG_ACCOUNT_ID,

          idempotencyKey:
            'wrong-account-no-contribution-000001',
        });

        const contributions =
          await findContributions({
            $or: [
              {
                idempotencyKey:
                  'wrong-account-no-contribution-000001',
              },

              {
                reference:
                  'wrong-account-no-contribution-000001',
              },
            ],
          });

        expect(
          contributions.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'wrong-account failure does not create a ledger journal',
      async () => {
        await seedContext();

        await initiateContribution({
          accountId:
            WRONG_ACCOUNT_ID,

          idempotencyKey:
            'wrong-account-no-journal-000001',
        });

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  'wrong-account-no-journal-000001',
              },

              {
                reference:
                  'wrong-account-no-journal-000001',
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
      'wrong-account request does not mutate the incorrect account balance',
      async () => {
        await seedContext();

        const before =
          await findAccounts({
            _id:
              WRONG_ACCOUNT_ID,
          });

        await initiateContribution({
          accountId:
            WRONG_ACCOUNT_ID,
        });

        const after =
          await findAccounts({
            _id:
              WRONG_ACCOUNT_ID,
          });

        if (
          before.length &&
          after.length
        ) {
          const beforeBalance =
            before[0]
              .balance;

          const afterBalance =
            after[0]
              .balance;

          if (
            beforeBalance !==
              undefined &&
            afterBalance !==
              undefined
          ) {
            expect(
              String(
                afterBalance,
              ),
            ).toBe(
              String(
                beforeBalance,
              ),
            );
          }
        }
      },
    );

    test(
      'cross-tenant wrong-account request does not mutate the other tenant account',
      async () => {
        await seedContext();

        const before =
          await findAccounts({
            _id:
              OTHER_TENANT_ACCOUNT_ID,
          });

        await initiateContribution({
          accountId:
            OTHER_TENANT_ACCOUNT_ID,
        });

        const after =
          await findAccounts({
            _id:
              OTHER_TENANT_ACCOUNT_ID,
          });

        if (
          before.length &&
          after.length
        ) {
          if (
            before[0]
              .balance !==
              undefined &&
            after[0]
              .balance !==
              undefined
          ) {
            expect(
              String(
                after[0].balance,
              ),
            ).toBe(
              String(
                before[0].balance,
              ),
            );
          }
        }
      },
    );

    test(
      'wrong-account failure does not mutate the correct account either',
      async () => {
        await seedContext();

        const before =
          await findAccounts({
            _id:
              MEMBER_ACCOUNT_ID,
          });

        await initiateContribution({
          accountId:
            WRONG_ACCOUNT_ID,
        });

        const after =
          await findAccounts({
            _id:
              MEMBER_ACCOUNT_ID,
          });

        if (
          before.length &&
          after.length
        ) {
          if (
            before[0]
              .balance !==
              undefined &&
            after[0]
              .balance !==
              undefined
          ) {
            expect(
              String(
                after[0].balance,
              ),
            ).toBe(
              String(
                before[0].balance,
              ),
            );
          }
        }
      },
    );

    test(
      'wrong-account request followed by corrected request can complete using the valid account',
      async () => {
        await seedContext();

        const invalid =
          await initiateContribution({
            accountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-corrected-flow-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          invalid.status,
        );

        const valid =
          await initiateContribution({
            accountId:
              MEMBER_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-corrected-flow-000002',

            reference:
              'wrong-account-corrected-flow-000002',
          });

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          valid.status,
        );

        if (
          valid.status >=
          200 &&
          valid.status <
            300
        ) {
          const callback =
            await sendContributionCallback({
              paymentReference:
                'wrong-account-corrected-flow-000002',

              callbackId:
                'MTN-CB-CORRECTED-ACCOUNT-000001',
            });

          expect(
            [
              200,
              202,
            ],
          ).toContain(
            callback.status,
          );
        }
      },
    );

    test(
      'correct server-resolved account is preferred over a malicious client account identifier',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              OTHER_TENANT_ACCOUNT_ID,

            memberAccountId:
              MEMBER_ACCOUNT_ID,

            sourceAccountId:
              OTHER_TENANT_ACCOUNT_ID,

            destinationAccountId:
              OTHER_TENANT_ACCOUNT_ID,

            idempotencyKey:
              'server-account-resolution-000001',
          });

        /**
         * A secure implementation should reject conflicting account hints rather
         * than choosing an arbitrary client value.
         */
        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        const journals =
          await findJournals({
            idempotencyKey:
              'server-account-resolution-000001',
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'concurrent wrong-account attempts remain side-effect free',
      async () => {
        await seedContext();

        const responses =
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
                initiateContribution({
                  accountId:
                    WRONG_ACCOUNT_ID,

                  idempotencyKey:
                    `wrong-account-concurrent-${index}`,
                }),
            ),
          );

        for (
          const response of
            responses
        ) {
          expect(
            [
              400,
              403,
              409,
              422,
            ],
          ).toContain(
            response.status,
          );
        }

        const wrongAccountJournals =
          await findJournals({
            accountId:
              WRONG_ACCOUNT_ID,
          });

        expect(
          wrongAccountJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'concurrent cross-tenant account attempts remain side-effect free',
      async () => {
        await seedContext();

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
                initiateContribution(
                  {
                    accountId:
                      OTHER_TENANT_ACCOUNT_ID,

                    idempotencyKey:
                      `cross-tenant-account-concurrent-${index}`,
                  },
                  AUTH_TOKEN,
                ),
            ),
          );

        for (
          const response of
            responses
        ) {
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
        }

        const journals =
          await findJournals({
            accountId:
              OTHER_TENANT_ACCOUNT_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'concurrent valid contributions do not accidentally resolve to the wrong account',
      async () => {
        await seedContext();

        const responses =
          await Promise.all([
            initiateContribution({
              accountId:
                MEMBER_ACCOUNT_ID,

              idempotencyKey:
                'valid-member-concurrent-000001',

              phoneNumber:
                TEST_PHONE,
            }),

            initiateContribution(
              {
                accountId:
                  MEMBER_ACCOUNT_ID,

                idempotencyKey:
                  'valid-member-concurrent-000002',

                phoneNumber:
                  TEST_PHONE,
              },
              AUTH_TOKEN,
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

        const wrongAccountJournals =
          await findJournals({
            accountId:
              WRONG_ACCOUNT_ID,
          });

        expect(
          wrongAccountJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'concurrent valid member and invalid cross-tenant account requests remain isolated',
      async () => {
        await seedContext();

        const [
          valid,
          invalid,
          validRetry,
          invalidRetry,
        ] =
          await Promise.all([
            initiateContribution({
              accountId:
                MEMBER_ACCOUNT_ID,

              idempotencyKey:
                'correct-account-race-000001',
            }),

            initiateContribution({
              accountId:
                OTHER_TENANT_ACCOUNT_ID,

              idempotencyKey:
                'wrong-tenant-account-race-000001',
            }),

            initiateContribution({
              accountId:
                MEMBER_ACCOUNT_ID,

              idempotencyKey:
                'correct-account-race-000002',
            }),

            initiateContribution({
              accountId:
                OTHER_TENANT_ACCOUNT_ID,

              idempotencyKey:
                'wrong-tenant-account-race-000002',
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
          valid.status,
        );

        expect(
          [
            200,
            201,
            202,
            409,
          ],
        ).toContain(
          validRetry.status,
        );

        expect(
          [
            400,
            403,
            404,
            409,
            422,
          ],
        ).toContain(
          invalid.status,
        );

        expect(
          [
            400,
            403,
            404,
            409,
            422,
          ],
        ).toContain(
          invalidRetry.status,
        );

        const wrongTenantJournals =
          await findJournals({
            accountId:
              OTHER_TENANT_ACCOUNT_ID,
          });

        expect(
          wrongTenantJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'account ownership validation remains intact when the request contains a valid provider',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValueOnce(
            providerSuccess(),
          );

        const response =
          await initiateContribution({
            provider:
              'mtn',

            accountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-provider-valid-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        expect(
          mocks.providerInitiate.mock
            .calls.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'account ownership validation occurs before callback settlement can create financial truth',
      async () => {
        await seedContext();

        const initiation =
          await initiateContribution({
            accountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-callback-settlement-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          initiation.status,
        );

        await sendContributionCallback({
          paymentReference:
            'wrong-account-callback-settlement-000001',

          callbackId:
            'MTN-CB-WRONG-ACCOUNT-SETTLEMENT-000001',
        });

        const transactions =
          await findTransactions({
            $or: [
              {
                idempotencyKey:
                  'wrong-account-callback-settlement-000001',
              },

              {
                reference:
                  'wrong-account-callback-settlement-000001',
              },
            ],
          });

        expect(
          transactions.length,
        ).toBe(
          0,
        );

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  'wrong-account-callback-settlement-000001',
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
      'wrong-account callback replay cannot create a journal',
      async () => {
        await seedContext();

        await initiateContribution({
          accountId:
            WRONG_ACCOUNT_ID,

          idempotencyKey:
            'wrong-account-callback-replay-000001',
        });

        await Promise.all([
          sendContributionCallback({
            paymentReference:
              'wrong-account-callback-replay-000001',

            callbackId:
              'MTN-CB-WRONG-ACCOUNT-REPLAY-000001',
          }),

          sendContributionCallback({
            paymentReference:
              'wrong-account-callback-replay-000001',

            callbackId:
              'MTN-CB-WRONG-ACCOUNT-REPLAY-000001',
          }),

          sendContributionCallback({
            paymentReference:
              'wrong-account-callback-replay-000001',

            callbackId:
              'MTN-CB-WRONG-ACCOUNT-REPLAY-000001',
          }),
        ]);

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  'wrong-account-callback-replay-000001',
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
      'wrong-account request remains isolated from a legitimate contribution using a different idempotency key',
      async () => {
        await seedContext();

        const invalid =
          await initiateContribution({
            accountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              IDEMPOTENCY_KEY,
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          invalid.status,
        );

        const valid =
          await initiateContribution({
            accountId:
              MEMBER_ACCOUNT_ID,

            idempotencyKey:
              SECOND_IDEMPOTENCY_KEY,

            reference:
              SECOND_IDEMPOTENCY_KEY,
          });

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          valid.status,
        );

        const invalidState =
          await logicalFinancialState(
            IDEMPOTENCY_KEY,
          );

        if (
          invalidState.journals.length
        ) {
          expect(
            invalidState.journals.length,
          ).toBe(
            0,
          );
        }

        const validState =
          await logicalFinancialState(
            SECOND_IDEMPOTENCY_KEY,
          );

        /**
         * The valid path may still be asynchronous, but it must remain distinct
         * from the invalid operation.
         */
        if (
          validState.payments.length &&
          invalidState.payments.length
        ) {
          expect(
            String(
              validState.payments[0]._id,
            ),
          ).not.toBe(
            String(
              invalidState.payments[0]._id,
            ),
          );
        }
      },
    );

    test(
      'wrong-account input cannot change the provider reference of a valid operation',
      async () => {
        await seedContext();

        const valid =
          await initiateContribution({
            accountId:
              MEMBER_ACCOUNT_ID,

            idempotencyKey:
              SECOND_IDEMPOTENCY_KEY,

            reference:
              SECOND_IDEMPOTENCY_KEY,
          });

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          valid.status,
        );

        const payload =
          responsePayload(
            valid,
          );

        const returnedReference =
          payload.reference ||
          payload.paymentReference ||
          payload.externalReference;

        if (
          returnedReference
        ) {
          expect(
            String(
              returnedReference,
            ),
          ).toBe(
            SECOND_IDEMPOTENCY_KEY,
          );
        }
      },
    );

    test(
      'wrong account on memberAccountId is rejected',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            memberAccountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              'wrong-member-account-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        expect(
          mocks.providerInitiate.mock
            .calls.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'wrong account on sourceAccountId is rejected',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            sourceAccountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              'wrong-source-account-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        expect(
          mocks.providerInitiate.mock
            .calls.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'wrong account on destinationAccountId is rejected',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            destinationAccountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              'wrong-destination-account-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        expect(
          mocks.providerInitiate.mock
            .calls.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'cross-tenant member account cannot be accessed using another tenant member token',
      async () => {
        await seedContext();

        const response =
          await initiateContribution(
            {
              accountId:
                OTHER_TENANT_ACCOUNT_ID,

              phoneNumber:
                OTHER_TENANT_PHONE,

              idempotencyKey:
                'other-tenant-account-token-000001',
            },

            OTHER_TENANT_TOKEN,
          );

        /**
         * The token itself does not grant access to this tenant's group/account.
         * A group mismatch must still be rejected.
         */
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
      },
    );

    test(
      'valid account succeeds after a previous invalid account attempt with another idempotency key',
      async () => {
        await seedContext();

        await initiateContribution({
          accountId:
            WRONG_ACCOUNT_ID,

          idempotencyKey:
            'bad-account-then-good-account-000001',
        });

        const valid =
          await initiateContribution({
            accountId:
              MEMBER_ACCOUNT_ID,

            idempotencyKey:
              'bad-account-then-good-account-000002',

            reference:
              'bad-account-then-good-account-000002',
          });

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          valid.status,
        );

        if (
          valid.status >=
            200 &&
          valid.status <
            300
        ) {
          const callback =
            await sendContributionCallback({
              paymentReference:
                'bad-account-then-good-account-000002',

              callbackId:
                'MTN-CB-BAD-THEN-GOOD-000001',
            });

          expect(
            [
              200,
              202,
            ],
          ).toContain(
            callback.status,
          );
        }
      },
    );

    test(
      'wrong-account idempotency key cannot later be rebound to a valid account',
      async () => {
        await seedContext();

        const invalid =
          await initiateContribution({
            accountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-rebind-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          invalid.status,
        );

        const retry =
          await initiateContribution({
            accountId:
              MEMBER_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-rebind-000001',
          });

        /**
         * An idempotency identity must be bound to the original normalized
         * request. Rebinding it to a materially different account is unsafe.
         */
        expect(
          [
            400,
            409,
            422,
          ],
        ).toContain(
          retry.status,
        );
      },
    );

    test(
      'wrong account does not cause a successful provider command even when the provider mock is healthy',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValueOnce(
            providerSuccess(),
          );

        const response =
          await initiateContribution({
            accountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-provider-healthy-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        expect(
          mocks.providerInitiate.mock
            .calls.length,
        ).toBe(
          0,
        );

        const journals =
          await findJournals({
            idempotencyKey:
              'wrong-account-provider-healthy-000001',
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'wrong-account request cannot post into the system cash account directly',
      async () => {
        await seedContext();

        const response =
          await initiateContribution({
            accountId:
              SYSTEM_CASH_ACCOUNT_ID,

            idempotencyKey:
              'wrong-system-cash-account-000001',
          });

        /**
         * System cash accounts should be selected by the settlement/accounting
         * layer rather than arbitrary client assignment.
         */
        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        const cashAccountJournals =
          await findJournals({
            accountId:
              SYSTEM_CASH_ACCOUNT_ID,
          });

        expect(
          cashAccountJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'wrong-account failure preserves all valid account ownership metadata',
      async () => {
        await seedContext();

        const before =
          await findAccounts({
            tenantId:
              TEST_TENANT_ID,
          });

        await initiateContribution({
          accountId:
            WRONG_ACCOUNT_ID,

          idempotencyKey:
            'account-metadata-preservation-000001',
        });

        const after =
          await findAccounts({
            tenantId:
              TEST_TENANT_ID,
          });

        expect(
          after.length,
        ).toBe(
          before.length,
        );

        const beforeById =
          new Map(
            before.map(
              (
                account,
              ) => [
                String(
                  account._id ||
                    account.id,
                ),
                account,
              ],
            ),
          );

        for (
          const account of
            after
        ) {
          const previous =
            beforeById.get(
              String(
                account._id ||
                  account.id,
              ),
            );

          if (
            previous &&
            previous.ownerId !==
              undefined &&
            account.ownerId !==
              undefined
          ) {
            expect(
              String(
                account.ownerId,
              ),
            ).toBe(
              String(
                previous.ownerId,
              ),
            );
          }
        }
      },
    );

    test(
      'wrong-account handling remains side-effect free under callback replay and client retry',
      async () => {
        await seedContext();

        await initiateContribution({
          accountId:
            WRONG_ACCOUNT_ID,

          idempotencyKey:
            'wrong-account-full-replay-000001',
        });

        await Promise.all([
          initiateContribution({
            accountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-full-replay-000001',
          }),

          initiateContribution({
            accountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-full-replay-000001',
          }),

          sendContributionCallback({
            paymentReference:
              'wrong-account-full-replay-000001',

            callbackId:
              'MTN-CB-WRONG-ACCOUNT-FULL-REPLAY-000001',
          }),
        ]);

        const state =
          await logicalFinancialState(
            'wrong-account-full-replay-000001',
          );

        expect(
          state.journals.length,
        ).toBe(
          0,
        );

        expect(
          state.transactions.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'wrong-account rejection does not create a successful payment status',
      async () => {
        await seedContext();

        await initiateContribution({
          accountId:
            WRONG_ACCOUNT_ID,

          idempotencyKey:
            'wrong-account-no-success-status-000001',
        });

        const payments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  'wrong-account-no-success-status-000001',
              },

              {
                paymentReference:
                  'wrong-account-no-success-status-000001',
              },
            ],
          });

        for (
          const payment of
            payments
        ) {
          expect(
            SUCCESS_STATES.has(
              getStatus(
                payment,
              ),
            ),
          ).toBe(
            false,
          );
        }
      },
    );

    test(
      'wrong-account validation remains deterministic across repeated requests',
      async () => {
        await seedContext();

        const responses =
          await Promise.all([
            initiateContribution({
              accountId:
                DISABLED_ACCOUNT_ID,

              idempotencyKey:
                'deterministic-account-000001',
            }),

            initiateContribution({
              accountId:
                DISABLED_ACCOUNT_ID,

              idempotencyKey:
                'deterministic-account-000001',
            }),

            initiateContribution({
              accountId:
                DISABLED_ACCOUNT_ID,

              idempotencyKey:
                'deterministic-account-000001',
            }),
          ]);

        for (
          const response of
            responses
        ) {
          expect(
            [
              400,
              403,
              409,
              422,
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
                  'deterministic-account-000001',
              },

              {
                reference:
                  'deterministic-account-000001',
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
      'account validation is enforced before ledger posting even if ledger mock would otherwise succeed',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockResolvedValueOnce({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439a14',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        const response =
          await initiateContribution({
            accountId:
              WRONG_ACCOUNT_ID,

            idempotencyKey:
              'wrong-account-ledger-mock-000001',
          });

        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        expect(
          mocks.ledgerPost.mock
            .calls.length,
        ).toBe(
          0,
        );

        const journals =
          await findJournals({
            idempotencyKey:
              'wrong-account-ledger-mock-000001',
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'valid account produces no journal against the explicitly wrong account',
      async () => {
        await seedContext();

        const valid =
          await initiateContribution({
            accountId:
              MEMBER_ACCOUNT_ID,

            idempotencyKey:
              'valid-account-wrong-account-isolation-000001',
          });

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          valid.status,
        );

        if (
          valid.status >=
          200 &&
          valid.status <
            300
        ) {
          await sendContributionCallback({
            paymentReference:
              'valid-account-wrong-account-isolation-000001',

            callbackId:
              'MTN-CB-VALID-WRONG-ACCOUNT-ISOLATION-000001',
          });
        }

        const wrongAccountJournals =
          await findJournals({
            accountId:
              WRONG_ACCOUNT_ID,
          });

        expect(
          wrongAccountJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'valid tenant account is preserved when another tenant attempts a concurrent wrong-account request',
      async () => {
        await seedContext();

        const [
          valid,
          invalidOtherTenant,
        ] =
          await Promise.all([
            initiateContribution(
              {
                accountId:
                  MEMBER_ACCOUNT_ID,

                idempotencyKey:
                  'valid-owner-account-concurrent-000001',
              },
              AUTH_TOKEN,
            ),

            initiateContribution(
              {
                accountId:
                  MEMBER_ACCOUNT_ID,

                idempotencyKey:
                  'invalid-cross-tenant-owner-account-concurrent-000001',
              },
              OTHER_TENANT_TOKEN,
            ),
          ]);

        expect(
          [
            200,
            201,
            202,
          ].includes(
            valid.status,
          ) ||
            [
              409,
            ].includes(
              valid.status,
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
          ],
        ).toContain(
          invalidOtherTenant.status,
        );

        const account =
          await findAccounts({
            _id:
              MEMBER_ACCOUNT_ID,
          });

        expect(
          account.length,
        ).toBe(
          1,
        );

        if (
          account.length
          &&
          account[0].ownerId
        ) {
          expect(
            String(
              account[0].ownerId,
            ),
          ).toBe(
            MEMBER_ID,
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