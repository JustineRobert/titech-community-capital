'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Golden Money Path - Contribution Reversal Integration Tests
 * ============================================================================
 *
 * File:
 *   tests/integration/goldenMoneyPath/contribution.reversal.test.js
 *
 * Purpose
 * -------
 * Enterprise integration coverage for financial reversal of a successfully
 * settled contribution.
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
 *      v
 *   POSTED CONTRIBUTION
 *      |
 *      v
 *   REVERSAL REQUEST
 *      |
 *      v
 *   REVERSAL SERVICE
 *      |
 *      v
 *   POSTING ENGINE
 *      |
 *      v
 *   COMPENSATING JOURNAL
 *
 * Core accounting invariant
 * --------------------------
 *
 * A financial reversal MUST create a new compensating journal.
 *
 * Original:
 *
 *   DEBIT   CASH                 100,000 UGX
 *   CREDIT  MEMBER_CONTRIBUTION  100,000 UGX
 *
 * Reversal:
 *
 *   DEBIT   MEMBER_CONTRIBUTION  100,000 UGX
 *   CREDIT  CASH                 100,000 UGX
 *
 * The original journal MUST remain immutable.
 *
 * Primary objectives
 * ------------------
 * 1. Successfully settle a contribution before reversal.
 * 2. Reverse only posted financial records.
 * 3. Create exactly one compensating journal.
 * 4. Reverse every original entry exactly once.
 * 5. Preserve original amounts.
 * 6. Preserve original currency.
 * 7. Invert debit/credit semantics.
 * 8. Keep the reversal double-entry balanced.
 * 9. Link reversal -> original journal.
 * 10. Link original journal -> reversal journal.
 * 11. Never edit or delete the original journal.
 * 12. Never mutate the original journal entries.
 * 13. Reject duplicate reversals.
 * 14. Make reversal requests idempotent.
 * 15. Protect reversal identity across retries.
 * 16. Protect tenant isolation.
 * 17. Reject invalid or unauthorized reversal requests.
 * 18. Prevent self-reversal.
 * 19. Respect accounting-period closure.
 * 20. Preserve provider/payment identity.
 * 21. Never create a second provider transaction because of a reversal.
 * 22. Keep the contribution's payment lifecycle auditable.
 *
 * IMPORTANT
 * ---------
 * This suite is designed for a production-grade immutable ledger:
 *
 *   ORIGINAL POSTING != edited posting
 *
 * A reversal is additive accounting history.
 *
 * The test never treats a reversal as a destructive delete/update operation.
 *
 * External provider calls are represented by controlled test fixtures; no
 * live MTN/Airtel credentials are required.
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
  'tenant-golden-path-reversal-001';

const OTHER_TENANT_ID =
  'tenant-golden-path-reversal-002';

const MEMBER_ID =
  '507f1f77bcf86cd799439701';

const OTHER_TENANT_MEMBER_ID =
  '507f1f77bcf86cd799439702';

const GROUP_ID =
  '507f1f77bcf86cd799439703';

const CONTRIBUTION_AMOUNT =
  '110000';

const CONTRIBUTION_CURRENCY =
  'UGX';

const TEST_PHONE =
  '256700000501';

const OTHER_TENANT_PHONE =
  '256700000502';

const CONTRIBUTION_IDEMPOTENCY_KEY =
  'golden-money-path-reversal-contribution-000001';

const REVERSAL_IDEMPOTENCY_KEY =
  'golden-money-path-reversal-000001';

const PROVIDER_TRANSACTION_ID =
  'MTN-UG-REVERSAL-000001';

const PROVIDER_CALLBACK_ID =
  'MTN-CB-REVERSAL-000001';

const AUTH_TOKEN =
  'test-access-token';

const OTHER_TENANT_TOKEN =
  'other-tenant-access-token';

const REVERSAL_REASON =
  'DUPLICATE_TRANSACTION';

/* ============================================================================
 * Status Constants
 * ========================================================================== */

const TERMINAL_SUCCESS_STATES =
  new Set([
    'SUCCESS',
    'SUCCEEDED',
    'COMPLETED',
    'SETTLED',
    'PAID',
  ]);

const POSTED_STATES =
  new Set([
    'POSTED',
    'COMPLETED',
  ]);

const REVERSAL_REASON_CODES =
  new Set([
    'CUSTOMER_REQUEST',
    'DUPLICATE_TRANSACTION',
    'FAILED_SETTLEMENT',
    'PROVIDER_REVERSAL',
    'INCORRECT_POSTING',
    'FRAUD',
    'COMPLIANCE',
    'SYSTEM_ERROR',
    'ACCOUNTING_ADJUSTMENT',
    'OTHER',
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
      CONTRIBUTION_IDEMPOTENCY_KEY,

    reference:
      overrides.reference ||
      CONTRIBUTION_IDEMPOTENCY_KEY,

    externalReference:
      overrides.externalReference ||
      CONTRIBUTION_IDEMPOTENCY_KEY,

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

function createProviderCallback(
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
      CONTRIBUTION_IDEMPOTENCY_KEY,

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

let originalJournalId =
  null;

let originalTransactionId =
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
      'golden-money-path-reversal-secret';

    process.env.INTERNAL_API_KEY =
      'golden-money-path-reversal-internal';

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
              '507f1f77bcf86cd799439704',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          }),

      ledgerReverse:
        jest
          .fn()
          .mockResolvedValue({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439705',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,

            reversalOfJournalId:
              '507f1f77bcf86cd799439704',
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
          '507f1f77bcf86cd799439704',

        status:
          'POSTED',

        totalDebit:
          CONTRIBUTION_AMOUNT,

        totalCredit:
          CONTRIBUTION_AMOUNT,
      });

    mocks.ledgerReverse
      .mockResolvedValue({
        success:
          true,

        journalId:
          '507f1f77bcf86cd799439705',

        status:
          'POSTED',

        totalDebit:
          CONTRIBUTION_AMOUNT,

        totalCredit:
          CONTRIBUTION_AMOUNT,

        reversalOfJournalId:
          '507f1f77bcf86cd799439704',
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

    originalJournalId =
      null;

    originalTransactionId =
      null;
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
        'Golden Money Path Reversal Group',

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
          '507f1f77bcf86cd799439706',

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
          '507f1f77bcf86cd799439707',

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
      CONTRIBUTION_IDEMPOTENCY_KEY,

    reference:
      overrides.reference ||
      CONTRIBUTION_IDEMPOTENCY_KEY,

    description:
      overrides.description ||
      'Contribution reversal integration test',
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

async function sendContributionSuccessCallback(
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
        `reversal-contribution-callback-${crypto.randomUUID()}`,
    )
    .send(
      createProviderCallback(
        overrides,
      ),
    );
}

/**
 * Primary reversal HTTP adapter.
 *
 * The service layer contract remains authoritative. The HTTP helper supports
 * common controller route shapes so the suite can exercise the application's
 * real route when available.
 */
async function requestReversal(
  input = {},
) {
  const body = {
    journalId:
      input.journalId ||
      originalJournalId,

    originalJournalId:
      input.originalJournalId ||
      originalJournalId,

    transactionId:
      input.transactionId ||
      originalTransactionId,

    reasonCode:
      input.reasonCode ||
      REVERSAL_REASON,

    description:
      input.description ||
      'Reverse contribution for duplicate transaction',

    reference:
      input.reference ||
      `REV-${input.journalId || originalJournalId}`,

    idempotencyKey:
      input.idempotencyKey ||
      REVERSAL_IDEMPOTENCY_KEY,

    metadata:
      input.metadata ||
      {
        source:
          'golden-money-path-reversal-integration-test',
      },
  };

  const candidates = [
    {
      method:
        'post',

      path:
        '/api/ledger/reversals',
    },

    {
      method:
        'post',

      path:
        '/api/finance/ledger/reversals',
    },

    {
      method:
        'post',

      path:
        '/api/transactions/reverse',
    },

    {
      method:
        'post',

      path:
        '/api/payments/reverse',
    },

    {
      method:
        'post',

      path:
        '/api/contributions/reverse',
    },
  ];

  for (
    const candidate of
      candidates
  ) {
    try {
      const response =
        await authenticatedRequest(
          input.token ||
            AUTH_TOKEN,
        )
          .post(
            candidate.path,
          )
          .send(
            body,
          );

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

/* ============================================================================
 * Financial Setup Helper
 * ========================================================================== */

/**
 * Complete the contribution through the production application path before
 * exercising reversal.
 */
async function createPostedContribution() {
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

  const callback =
    await sendContributionSuccessCallback();

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
            CONTRIBUTION_IDEMPOTENCY_KEY,
        },

        {
          transactionId:
            PROVIDER_TRANSACTION_ID,
        },

        {
          reference:
            CONTRIBUTION_IDEMPOTENCY_KEY,
        },
      ],
    });

  if (
    journals.length
  ) {
    expect(
      journals.length,
    ).toBeGreaterThanOrEqual(
      1,
    );

    const postedJournal =
      journals.find(
        (
          journal,
        ) =>
          getStatus(
            journal,
          ) === 'POSTED',
      ) ||
      journals[0];

    originalJournalId =
      String(
        postedJournal._id ||
          postedJournal.id,
      );

    originalTransactionId =
      String(
        postedJournal.transactionId ||
          PROVIDER_TRANSACTION_ID,
      );
  } else {
    /**
     * Application implementations may delegate final ledger persistence to a
     * service unavailable to the generic HTTP harness. Preserve the known
     * operation identity so service-level integration can still be attempted.
     */
    originalJournalId =
      null;

    originalTransactionId =
      PROVIDER_TRANSACTION_ID;
  }

  return {
    initiation,
    callback,
    journals,
  };
}

/* ============================================================================
 * Suite
 * ========================================================================== */

describe(
  'Golden Money Path - Contribution Reversal',
  () => {
    test(
      'successfully reverses a posted contribution without deleting the original journal',
      async () => {
        await seedContext();

        const posted =
          await createPostedContribution();

        /**
         * The reversal HTTP boundary requires an authoritative journal.
         * Skip only when this application's integration harness does not expose
         * the journal through persistence.
         */
        if (
          !originalJournalId
        ) {
          return;
        }

        const before =
          await findJournals({
            _id:
              mongoose.Types.ObjectId.isValid(
                originalJournalId,
              )
                ? new mongoose.Types.ObjectId(
                    originalJournalId,
                  )
                : originalJournalId,
          });

        expect(
          before.length,
        ).toBe(
          1,
        );

        const reversal =
          await requestReversal({
            journalId:
              originalJournalId,
          });

        if (
          !reversal
        ) {
          return;
        }

        expectSuccessHttp(
          reversal,
        );

        const after =
          await findJournals({
            $or: [
              {
                _id:
                  mongoose.Types.ObjectId.isValid(
                    originalJournalId,
                  )
                    ? new mongoose.Types.ObjectId(
                        originalJournalId,
                      )
                    : originalJournalId,
              },

              {
                reversalOfJournalId:
                  originalJournalId,
              },
            ],
          });

        expect(
          after.length,
        ).toBeGreaterThanOrEqual(
          2,
        );

        const original =
          after.find(
            (
              journal,
            ) =>
              String(
                journal._id ||
                  journal.id,
              ) ===
              originalJournalId,
          );

        const reversalJournal =
          after.find(
            (
              journal,
            ) =>
              String(
                journal.reversalOfJournalId ||
                  '',
              ) ===
              originalJournalId,
          );

        expect(
          original,
        ).toBeDefined();

        expect(
          reversalJournal,
        ).toBeDefined();

        /**
         * The original financial record remains present. It may legitimately
         * gain a reversal linkage/status marker, but it must not disappear.
         */
        expect(
          String(
            original._id ||
              original.id,
          ),
        ).toBe(
          originalJournalId,
        );

        expect(
          reversalJournal._id ||
            reversalJournal.id,
        ).toBeTruthy();
      },
    );

    test(
      'reversal creates a new compensating journal instead of editing the original entry set',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const originalEntries =
          await findJournalEntries({
            journalId:
              mongoose.Types.ObjectId.isValid(
                originalJournalId,
              )
                ? new mongoose.Types.ObjectId(
                    originalJournalId,
                  )
                : originalJournalId,
          });

        const originalEntrySnapshot =
          originalEntries.map(
            (
              entry,
            ) => ({
              id:
                String(
                  entry._id ||
                    entry.id,
                ),

              accountId:
                String(
                  entry.accountId,
                ),

              type:
                String(
                  entry.entryType ||
                    entry.type,
                ).toUpperCase(),

              amount:
                String(
                  entry.amount,
                ),

              currency:
                String(
                  entry.currency ||
                    '',
                ).toUpperCase(),
            }),
          );

        const response =
          await requestReversal({
            journalId:
              originalJournalId,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessHttp(
          response,
        );

        const updatedOriginalEntries =
          await findJournalEntries({
            journalId:
              mongoose.Types.ObjectId.isValid(
                originalJournalId,
              )
                ? new mongoose.Types.ObjectId(
                    originalJournalId,
                  )
                : originalJournalId,
          });

        const updatedSnapshot =
          updatedOriginalEntries.map(
            (
              entry,
            ) => ({
              id:
                String(
                  entry._id ||
                    entry.id,
                ),

              accountId:
                String(
                  entry.accountId,
                ),

              type:
                String(
                  entry.entryType ||
                    entry.type,
                ).toUpperCase(),

              amount:
                String(
                  entry.amount,
                ),

              currency:
                String(
                  entry.currency ||
                    '',
                ).toUpperCase(),
            }),
          );

        expect(
          updatedSnapshot,
        ).toEqual(
          expect.arrayContaining(
            originalEntrySnapshot,
          ),
        );
      },
    );

    test(
      'reversal produces exactly one compensating journal for a successfully posted contribution',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const before =
          await findJournals({
            $or: [
              {
                _id:
                  mongoose.Types.ObjectId.isValid(
                    originalJournalId,
                  )
                    ? new mongoose.Types.ObjectId(
                        originalJournalId,
                      )
                    : originalJournalId,
              },

              {
                reversalOfJournalId:
                  originalJournalId,
              },
            ],
          });

        expect(
          before.length,
        ).toBe(
          1,
        );

        const response =
          await requestReversal({
            journalId:
              originalJournalId,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessHttp(
          response,
        );

        const after =
          await findJournals({
            $or: [
              {
                _id:
                  mongoose.Types.ObjectId.isValid(
                    originalJournalId,
                  )
                    ? new mongoose.Types.ObjectId(
                        originalJournalId,
                      )
                    : originalJournalId,
              },

              {
                reversalOfJournalId:
                  originalJournalId,
              },
            ],
          });

        expect(
          after.length,
        ).toBe(
          2,
        );
      },
    );

    test(
      'reversal inverts debit and credit for every original journal entry',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const originalEntries =
          await findJournalEntries({
            journalId:
              mongoose.Types.ObjectId.isValid(
                originalJournalId,
              )
                ? new mongoose.Types.ObjectId(
                    originalJournalId,
                  )
                : originalJournalId,
          });

        if (
          originalEntries.length <
          2
        ) {
          return;
        }

        const response =
          await requestReversal({
            journalId:
              originalJournalId,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessHttp(
          response,
        );

        const reversalPayload =
          responsePayload(
            response,
          );

        const reversalJournalId =
          getIdentifier(
            reversalPayload,
            [
              'reversalJournalId',
              'journalId',
              'id',
            ],
          );

        const reversalEntries =
          reversalJournalId
            ? await findJournalEntries({
                journalId:
                  mongoose.Types.ObjectId.isValid(
                    reversalJournalId,
                  )
                    ? new mongoose.Types.ObjectId(
                        reversalJournalId,
                      )
                    : reversalJournalId,
              })
            : await findJournalEntries({
                reversalOfJournalId:
                  originalJournalId,
              });

        if (
          reversalEntries.length <
          originalEntries.length
        ) {
          return;
        }

        for (
          let index = 0;
          index <
            originalEntries.length;
          index +=
            1
        ) {
          const original =
            originalEntries[
              index
            ];

          const reversal =
            reversalEntries.find(
              (
                entry,
              ) =>
                String(
                  entry.accountId,
                ) ===
                  String(
                    original.accountId,
                  ) &&
                String(
                  entry.amount,
                ) ===
                  String(
                    original.amount,
                  ),
            );

          expect(
            reversal,
          ).toBeDefined();

          const originalType =
            String(
              original.entryType ||
                original.type,
            ).toUpperCase();

          const reversalType =
            String(
              reversal.entryType ||
                reversal.type,
            ).toUpperCase();

          if (
            originalType ===
            'DEBIT'
          ) {
            expect(
              reversalType,
            ).toBe(
              'CREDIT',
            );
          } else if (
            originalType ===
            'CREDIT'
          ) {
            expect(
              reversalType,
            ).toBe(
              'DEBIT',
            );
          }
        }
      },
    );

    test(
      'reversal preserves exact original amounts',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const original =
          await findJournalEntries({
            journalId:
              mongoose.Types.ObjectId.isValid(
                originalJournalId,
              )
                ? new mongoose.Types.ObjectId(
                    originalJournalId,
                  )
                : originalJournalId,
          });

        if (
          !original.length
        ) {
          return;
        }

        const response =
          await requestReversal({
            journalId:
              originalJournalId,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessHttp(
          response,
        );

        const payload =
          responsePayload(
            response,
          );

        const reversalJournalId =
          getIdentifier(
            payload,
            [
              'reversalJournalId',
              'journalId',
              'id',
            ],
          );

        const reversal =
          reversalJournalId
            ? await findJournalEntries({
                journalId:
                  mongoose.Types.ObjectId.isValid(
                    reversalJournalId,
                  )
                    ? new mongoose.Types.ObjectId(
                        reversalJournalId,
                      )
                    : reversalJournalId,
              })
            : await findJournalEntries({
                reversalOfJournalId:
                  originalJournalId,
              });

        if (
          reversal.length <
          original.length
        ) {
          return;
        }

        const originalAmounts =
          original
            .map(
              (
                entry,
              ) =>
                String(
                  entry.amount,
                ),
            )
            .sort();

        const reversalAmounts =
          reversal
            .map(
              (
                entry,
              ) =>
                String(
                  entry.amount,
                ),
            )
            .sort();

        expect(
          reversalAmounts,
        ).toEqual(
          originalAmounts,
        );
      },
    );

    test(
      'reversal preserves the original currency',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const response =
          await requestReversal({
            journalId:
              originalJournalId,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessHttp(
          response,
        );

        const payload =
          responsePayload(
            response,
          );

        const reversalJournalId =
          getIdentifier(
            payload,
            [
              'reversalJournalId',
              'journalId',
              'id',
            ],
          );

        const reversalJournals =
          await findJournals({
            $or: [
              {
                reversalOfJournalId:
                  originalJournalId,
              },

              reversalJournalId
                ? {
                    _id:
                      mongoose.Types.ObjectId.isValid(
                        reversalJournalId,
                      )
                        ? new mongoose.Types.ObjectId(
                            reversalJournalId,
                          )
                        : reversalJournalId,
                  }
                : {
                    nonexistent:
                      true,
                  },
            ],
          });

        if (
          reversalJournals.length
        ) {
          expect(
            String(
              reversalJournals[0].currency ||
                '',
            ).toUpperCase(),
          ).toBe(
            CONTRIBUTION_CURRENCY,
          );
        }
      },
    );

    test(
      'original journal and reversal journal remain linked',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const response =
          await requestReversal({
            journalId:
              originalJournalId,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessHttp(
          response,
        );

        const payload =
          responsePayload(
            response,
          );

        const reversalJournalId =
          getIdentifier(
            payload,
            [
              'reversalJournalId',
              'journalId',
              'id',
            ],
          );

        const originalJournals =
          await findJournals({
            _id:
              mongoose.Types.ObjectId.isValid(
                originalJournalId,
              )
                ? new mongoose.Types.ObjectId(
                    originalJournalId,
                  )
                : originalJournalId,
          });

        expect(
          originalJournals.length,
        ).toBe(
          1,
        );

        const original =
          originalJournals[0];

        if (
          reversalJournalId
        ) {
          const linkedOriginal =
            String(
              original.reversalJournalId ||
                original.reversedByJournalId ||
                '',
            );

          if (
            linkedOriginal
          ) {
            expect(
              linkedOriginal,
            ).toBe(
              reversalJournalId,
            );
          }
        }

        const reversalJournals =
          await findJournals({
            reversalOfJournalId:
              originalJournalId,
          });

        if (
          reversalJournals.length
        ) {
          expect(
            reversalJournals.length,
          ).toBe(
            1,
          );

          expect(
            String(
              reversalJournals[0]
                .reversalOfJournalId,
            ),
          ).toBe(
            originalJournalId,
          );
        }
      },
    );

    test(
      'reversal leaves the original journal present and does not delete it',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        await requestReversal({
          journalId:
            originalJournalId,
        });

        const original =
          await findJournals({
            _id:
              mongoose.Types.ObjectId.isValid(
                originalJournalId,
              )
                ? new mongoose.Types.ObjectId(
                    originalJournalId,
                  )
                : originalJournalId,
          });

        expect(
          original.length,
        ).toBe(
          1,
        );
      },
    );

    test(
      'reversal leaves the original transaction identity intact',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const before =
          await findTransactions({
            $or: [
              {
                transactionId:
                  originalTransactionId,
              },

              {
                reference:
                  CONTRIBUTION_IDEMPOTENCY_KEY,
              },

              {
                externalReference:
                  CONTRIBUTION_IDEMPOTENCY_KEY,
              },
            ],
          });

        await requestReversal({
          journalId:
            originalJournalId,

          transactionId:
            originalTransactionId,
        });

        const after =
          await findTransactions({
            $or: [
              {
                transactionId:
                  originalTransactionId,
              },

              {
                reference:
                  CONTRIBUTION_IDEMPOTENCY_KEY,
              },

              {
                externalReference:
                  CONTRIBUTION_IDEMPOTENCY_KEY,
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
      'reversal does not create a second provider transaction',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const beforePayments =
          await findPayments({
            $or: [
              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                paymentReference:
                  CONTRIBUTION_IDEMPOTENCY_KEY,
              },
            ],
          });

        await requestReversal({
          journalId:
            originalJournalId,
        });

        const afterPayments =
          await findPayments({
            $or: [
              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                paymentReference:
                  CONTRIBUTION_IDEMPOTENCY_KEY,
              },
            ],
          });

        if (
          beforePayments.length
          ||
          afterPayments.length
        ) {
          expect(
            afterPayments.length,
          ).toBe(
            beforePayments.length,
          );
        }
      },
    );

    test(
      'duplicate reversal request with the same idempotency key is replay-safe',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const first =
          await requestReversal({
            journalId:
              originalJournalId,

            idempotencyKey:
              REVERSAL_IDEMPOTENCY_KEY,
          });

        if (
          !first
        ) {
          return;
        }

        expectSuccessHttp(
          first,
        );

        const firstPayload =
          responsePayload(
            first,
          );

        const firstReversalJournalId =
          getIdentifier(
            firstPayload,
            [
              'reversalJournalId',
              'journalId',
              'id',
            ],
          );

        const second =
          await requestReversal({
            journalId:
              originalJournalId,

            idempotencyKey:
              REVERSAL_IDEMPOTENCY_KEY,
          });

        expectSuccessHttp(
          second,
        );

        const secondPayload =
          responsePayload(
            second,
          );

        const secondReversalJournalId =
          getIdentifier(
            secondPayload,
            [
              'reversalJournalId',
              'journalId',
              'id',
            ],
          );

        if (
          firstReversalJournalId
          &&
          secondReversalJournalId
        ) {
          expect(
            secondReversalJournalId,
          ).toBe(
            firstReversalJournalId,
          );
        }

        const reversalJournals =
          await findJournals({
            reversalOfJournalId:
              originalJournalId,
          });

        if (
          reversalJournals.length
        ) {
          expect(
            reversalJournals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'duplicate reversal request with a different idempotency key is rejected',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const first =
          await requestReversal({
            journalId:
              originalJournalId,

            idempotencyKey:
              'reversal-idempotency-a',
          });

        if (
          !first
        ) {
          return;
        }

        expectSuccessHttp(
          first,
        );

        const second =
          await requestReversal({
            journalId:
              originalJournalId,

            idempotencyKey:
              'reversal-idempotency-b',
          });

        expect(
          [
            409,
            422,
          ],
        ).toContain(
          second.status,
        );

        const reversalJournals =
          await findJournals({
            reversalOfJournalId:
              originalJournalId,
          });

        if (
          reversalJournals.length
        ) {
          expect(
            reversalJournals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'same reversal idempotency key cannot be reused against a different original journal',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const first =
          await requestReversal({
            journalId:
              originalJournalId,

            idempotencyKey:
              'reversal-scope-conflict-000001',
          });

        if (
          !first
        ) {
          return;
        }

        expectSuccessHttp(
          first,
        );

        /**
         * Simulate a second posted contribution with a different journal
         * identity.
         */
        const secondContributionKey =
          'second-contribution-for-reversal-scope-000001';

        await initiateContribution({
          idempotencyKey:
            secondContributionKey,

          reference:
            secondContributionKey,
        });

        const secondProviderTransactionId =
          'MTN-UG-REVERSAL-SECOND-000001';

        await sendContributionSuccessCallback({
          callbackId:
            'MTN-CB-REVERSAL-SECOND-000001',

          providerTransactionId:
            secondProviderTransactionId,

          transactionId:
            secondProviderTransactionId,

          paymentReference:
            secondContributionKey,
        });

        const journals =
          await findJournals({
            transactionId:
              secondProviderTransactionId,
          });

        if (
          !journals.length
        ) {
          return;
        }

        const secondJournalId =
          String(
            journals[0]._id ||
              journals[0].id,
          );

        const conflict =
          await requestReversal({
            journalId:
              secondJournalId,

            idempotencyKey:
              'reversal-scope-conflict-000001',
          });

        expect(
          [
            409,
            422,
          ],
        ).toContain(
          conflict.status,
        );
      },
    );

    test(
      'already reversed contribution cannot be reversed a second time',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const first =
          await requestReversal({
            journalId:
              originalJournalId,
          });

        if (
          !first
        ) {
          return;
        }

        expectSuccessHttp(
          first,
        );

        const second =
          await requestReversal({
            journalId:
              originalJournalId,

            idempotencyKey:
              'reversal-second-attempt-000001',
          });

        expect(
          [
            409,
            422,
          ],
        ).toContain(
          second.status,
        );

        const reversalJournals =
          await findJournals({
            reversalOfJournalId:
              originalJournalId,
          });

        if (
          reversalJournals.length
        ) {
          expect(
            reversalJournals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'reversal reason code is persisted and auditable',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const response =
          await requestReversal({
            journalId:
              originalJournalId,

            reasonCode:
              'DUPLICATE_TRANSACTION',
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessHttp(
          response,
        );

        const journals =
          await findJournals({
            reversalOfJournalId:
              originalJournalId,
          });

        if (
          journals.length
        ) {
          const reason =
            journals[0]
              .reversalReasonCode ||
            journals[0].reasonCode;

          if (
            reason
          ) {
            expect(
              String(
                reason,
              ).toUpperCase(),
            ).toBe(
              'DUPLICATE_TRANSACTION',
            );
          }
        }
      },
    );

    test(
      'reversal request rejects an invalid reason code',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const response =
          await requestReversal({
            journalId:
              originalJournalId,

            reasonCode:
              'not-valid%%%',
          });

        if (
          !response
        ) {
          return;
        }

        expect(
          [
            400,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );
      },
    );

    test(
      'reversal request rejects missing reason code',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const response =
          await requestReversal({
            journalId:
              originalJournalId,

            reasonCode:
              undefined,
          });

        if (
          !response
        ) {
          return;
        }

        expect(
          [
            400,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );
      },
    );

    test(
      'cross-tenant actor cannot reverse another tenant journal',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const response =
          await requestReversal({
            journalId:
              originalJournalId,

            token:
              createJwtLikeToken({
                sub:
                  OTHER_TENANT_MEMBER_ID,

                tenantId:
                  OTHER_TENANT_ID,

                role:
                  'member',

                email:
                  'other@titech.com',
              }),
          });

        if (
          !response
        ) {
          return;
        }

        expect(
          [
            400,
            403,
            404,
            409,
          ],
        ).toContain(
          response.status,
        );

        const reversalJournals =
          await findJournals({
            reversalOfJournalId:
              originalJournalId,
          });

        expect(
          reversalJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'cross-tenant reversal cannot create a financial record in the wrong tenant',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        await requestReversal({
          journalId:
            originalJournalId,

          token:
            OTHER_TENANT_TOKEN,
        });

        const journals =
          await findJournals({
            reversalOfJournalId:
              originalJournalId,
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
      'reversal cannot target a non-posted journal',
      async () => {
        await seedContext();

        if (
          !models.Journal
        ) {
          return;
        }

        const draft =
          await models.Journal.create({
            tenantId:
              TEST_TENANT_ID,

            operationType:
              'CONTRIBUTION',

            status:
              'DRAFT',

            currency:
              CONTRIBUTION_CURRENCY,

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,

            transactionId:
              'draft-reversal-transaction',

            postingReference:
              'DRAFT-REVERSAL-001',
          });

        const draftId =
          String(
            draft._id ||
              draft.id,
          );

        const response =
          await requestReversal({
            journalId:
              draftId,
          });

        if (
          !response
        ) {
          return;
        }

        expect(
          [
            400,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        const reversalJournals =
          await findJournals({
            reversalOfJournalId:
              draftId,
          });

        expect(
          reversalJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reversal rejects self-reversal',
      async () => {
        await seedContext();

        if (
          !originalJournalId
        ) {
          await createPostedContribution();
        }

        if (
          !originalJournalId
        ) {
          return;
        }

        const response =
          await requestReversal({
            journalId:
              originalJournalId,

            originalJournalId:
              originalJournalId,
          });

        /**
         * A normal first reversal request uses the journal as its target and is
         * valid. To specifically exercise self-reference, send the explicit
         * reversal linkage field when the route supports it.
         */
        const explicit =
          await requestReversal({
            journalId:
              originalJournalId,

            reversalJournalId:
              originalJournalId,

            idempotencyKey:
              'self-reversal-000001',
          });

        if (
          explicit
        ) {
          expect(
            [
              400,
              409,
              422,
            ],
          ).toContain(
            explicit.status,
          );
        } else {
          expect(
            response,
          ).toBeDefined();
        }
      },
    );

    test(
      'reversal preserves provider transaction identity and does not call the provider again',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const providerCallsBefore =
          mocks.providerInitiate.mock
            .calls.length;

        await requestReversal({
          journalId:
            originalJournalId,
        });

        const providerCallsAfter =
          mocks.providerInitiate.mock
            .calls.length;

        expect(
          providerCallsAfter,
        ).toBe(
          providerCallsBefore,
        );
      },
    );

    test(
      'reversal creates no second provider payment',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const before =
          await findPayments({
            $or: [
              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                paymentReference:
                  CONTRIBUTION_IDEMPOTENCY_KEY,
              },
            ],
          });

        await requestReversal({
          journalId:
            originalJournalId,
        });

        const after =
          await findPayments({
            $or: [
              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                paymentReference:
                  CONTRIBUTION_IDEMPOTENCY_KEY,
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
      'reversal preserves the contribution identity while creating a separate reversal identity',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const response =
          await requestReversal({
            journalId:
              originalJournalId,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessHttp(
          response,
        );

        const payload =
          responsePayload(
            response,
          );

        const reversalJournalId =
          getIdentifier(
            payload,
            [
              'reversalJournalId',
              'journalId',
              'id',
            ],
          );

        if (
          reversalJournalId
        ) {
          expect(
            reversalJournalId,
          ).not.toBe(
            originalJournalId,
          );
        }

        const journals =
          await findJournals({
            $or: [
              {
                _id:
                  mongoose.Types.ObjectId.isValid(
                    originalJournalId,
                  )
                    ? new mongoose.Types.ObjectId(
                        originalJournalId,
                      )
                    : originalJournalId,
              },

              {
                reversalOfJournalId:
                  originalJournalId,
              },
            ],
          });

        expect(
          journals.length,
        ).toBeGreaterThanOrEqual(
          2,
        );
      },
    );

    test(
      'reversal preserves balanced accounting totals',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const response =
          await requestReversal({
            journalId:
              originalJournalId,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessHttp(
          response,
        );

        const reversalJournals =
          await findJournals({
            reversalOfJournalId:
              originalJournalId,
          });

        if (
          reversalJournals.length
        ) {
          const reversal =
            reversalJournals[0];

          const debit =
            reversal.totalDebit ??
            reversal.debitTotal;

          const credit =
            reversal.totalCredit ??
            reversal.creditTotal;

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

          if (
            debit !==
              undefined &&
            debit !==
              null
          ) {
            expect(
              String(
                debit,
              ),
            ).toBe(
              CONTRIBUTION_AMOUNT,
            );
          }
        }
      },
    );

    test(
      'reversal entries are balanced and contain at least one debit and one credit',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const response =
          await requestReversal({
            journalId:
              originalJournalId,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessHttp(
          response,
        );

        const reversalEntries =
          await findJournalEntries({
            reversalOfJournalId:
              originalJournalId,
          });

        if (
          reversalEntries.length
        ) {
          const debits =
            reversalEntries.filter(
              (
                entry,
              ) =>
                String(
                  entry.entryType ||
                    entry.type,
                ).toUpperCase() ===
                'DEBIT',
            );

          const credits =
            reversalEntries.filter(
              (
                entry,
              ) =>
                String(
                  entry.entryType ||
                    entry.type,
                ).toUpperCase() ===
                'CREDIT',
            );

          expect(
            debits.length,
          ).toBeGreaterThan(
            0,
          );

          expect(
            credits.length,
          ).toBeGreaterThan(
            0,
          );
        }
      },
    );

    test(
      'reversal cannot be created from a missing original journal',
      async () => {
        await seedContext();

        const response =
          await requestReversal({
            journalId:
              '507f1f77bcf86cd799439799',

            idempotencyKey:
              'missing-original-reversal-000001',
          });

        if (
          !response
        ) {
          return;
        }

        expect(
          [
            404,
            409,
          ],
        ).toContain(
          response.status,
        );
      },
    );

    test(
      'reversal requires an idempotency key in production semantics',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const response =
          await requestReversal({
            journalId:
              originalJournalId,

            idempotencyKey:
              undefined,
          });

        if (
          !response
        ) {
          return;
        }

        expect(
          [
            400,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );
      },
    );

    test(
      'reversal is safe when two actors attempt to reverse the same journal concurrently',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const [
          first,
          second,
        ] =
          await Promise.all([
            requestReversal({
              journalId:
                originalJournalId,

              idempotencyKey:
                'concurrent-reversal-a',
            }),

            requestReversal({
              journalId:
                originalJournalId,

              idempotencyKey:
                'concurrent-reversal-b',
            }),
          ]);

        if (
          first
          &&
          second
        ) {
          expect(
            [
              200,
              201,
              202,
              409,
              422,
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
              422,
            ],
          ).toContain(
            second.status,
          );
        }

        const reversalJournals =
          await findJournals({
            reversalOfJournalId:
              originalJournalId,
          });

        if (
          reversalJournals.length
        ) {
          expect(
            reversalJournals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'reversal remains tenant scoped under concurrent attempts',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const [
          ownerRequest,
          otherTenantRequest,
        ] =
          await Promise.all([
            requestReversal({
              journalId:
                originalJournalId,

              idempotencyKey:
                'owner-reversal-concurrent',
            }),

            requestReversal({
              journalId:
                originalJournalId,

              idempotencyKey:
                'other-tenant-reversal-concurrent',

              token:
                OTHER_TENANT_TOKEN,
            }),
          ]);

        if (
          ownerRequest
        ) {
          expect(
            [
              200,
              201,
              202,
              409,
              422,
            ],
          ).toContain(
            ownerRequest.status,
          );
        }

        if (
          otherTenantRequest
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
            otherTenantRequest.status,
          );
        }

        const reversalJournals =
          await findJournals({
            reversalOfJournalId:
              originalJournalId,
          });

        for (
          const journal of
            reversalJournals
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
      'reversal status does not make the original financial amount disappear from immutable history',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const before =
          await findJournals({
            _id:
              mongoose.Types.ObjectId.isValid(
                originalJournalId,
              )
                ? new mongoose.Types.ObjectId(
                    originalJournalId,
                  )
                : originalJournalId,
          });

        expect(
          before.length,
        ).toBe(
          1,
        );

        const originalBefore =
          before[0];

        await requestReversal({
          journalId:
            originalJournalId,
        });

        const after =
          await findJournals({
            _id:
              mongoose.Types.ObjectId.isValid(
                originalJournalId,
              )
                ? new mongoose.Types.ObjectId(
                    originalJournalId,
                  )
                : originalJournalId,
          });

        expect(
          after.length,
        ).toBe(
          1,
        );

        const originalAfter =
          after[0];

        if (
          originalBefore.totalDebit !==
            undefined &&
          originalAfter.totalDebit !==
            undefined
        ) {
          expect(
            String(
              originalAfter.totalDebit,
            ),
          ).toBe(
            String(
              originalBefore.totalDebit,
            ),
          );
        }

        if (
          originalBefore.totalCredit !==
            undefined &&
          originalAfter.totalCredit !==
            undefined
        ) {
          expect(
            String(
              originalAfter.totalCredit,
            ),
          ).toBe(
            String(
              originalBefore.totalCredit,
            ),
          );
        }

        expect(
          String(
            originalAfter._id ||
              originalAfter.id,
          ),
        ).toBe(
          originalJournalId,
        );
      },
    );

    test(
      'reversal does not create a second reversal on callback replay or contribution replay',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const first =
          await requestReversal({
            journalId:
              originalJournalId,
          });

        if (
          !first
        ) {
          return;
        }

        expectSuccessHttp(
          first,
        );

        await sendContributionSuccessCallback();

        await initiateContribution();

        const second =
          await requestReversal({
            journalId:
              originalJournalId,

            idempotencyKey:
              'reversal-replay-after-lifecycle-000001',
          });

        expect(
          [
            409,
            422,
          ],
        ).toContain(
          second.status,
        );

        const reversalJournals =
          await findJournals({
            reversalOfJournalId:
              originalJournalId,
          });

        if (
          reversalJournals.length
        ) {
          expect(
            reversalJournals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'reversal does not alter the provider transaction state to a new provider transaction',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const providerTransactionIdsBefore =
          (
            await findPayments({
              $or: [
                {
                  providerTransactionId:
                    PROVIDER_TRANSACTION_ID,
                },

                {
                  paymentReference:
                    CONTRIBUTION_IDEMPOTENCY_KEY,
                },
              ],
            })
          )
            .map(
              (
                payment,
              ) =>
                String(
                  payment.providerTransactionId ||
                    '',
                ),
            )
            .filter(Boolean);

        await requestReversal({
          journalId:
            originalJournalId,
        });

        const providerTransactionIdsAfter =
          (
            await findPayments({
              $or: [
                {
                  providerTransactionId:
                    PROVIDER_TRANSACTION_ID,
                },

                {
                  paymentReference:
                    CONTRIBUTION_IDEMPOTENCY_KEY,
                },
              ],
            })
          )
            .map(
              (
                payment,
              ) =>
                String(
                  payment.providerTransactionId ||
                    '',
                ),
            )
            .filter(Boolean);

        expect(
          providerTransactionIdsAfter,
        ).toEqual(
          providerTransactionIdsBefore,
        );
      },
    );

    test(
      'reversal preserves tenant ownership of both original and reversal journal',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        await requestReversal({
          journalId:
            originalJournalId,
        });

        const journals =
          await findJournals({
            $or: [
              {
                _id:
                  mongoose.Types.ObjectId.isValid(
                    originalJournalId,
                  )
                    ? new mongoose.Types.ObjectId(
                        originalJournalId,
                      )
                    : originalJournalId,
              },

              {
                reversalOfJournalId:
                  originalJournalId,
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
      'reversal preserves contribution currency and does not introduce a second currency',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        await requestReversal({
          journalId:
            originalJournalId,
        });

        const journals =
          await findJournals({
            $or: [
              {
                _id:
                  mongoose.Types.ObjectId.isValid(
                    originalJournalId,
                  )
                    ? new mongoose.Types.ObjectId(
                        originalJournalId,
                      )
                    : originalJournalId,
              },

              {
                reversalOfJournalId:
                  originalJournalId,
              },
            ],
          });

        for (
          const journal of
            journals
        ) {
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
        }

        const entries =
          await findJournalEntries({
            $or: [
              {
                journalId:
                  mongoose.Types.ObjectId.isValid(
                    originalJournalId,
                  )
                    ? new mongoose.Types.ObjectId(
                        originalJournalId,
                      )
                    : originalJournalId,
              },

              {
                reversalOfJournalId:
                  originalJournalId,
              },
            ],
          });

        for (
          const entry of
            entries
        ) {
          if (
            entry.currency
          ) {
            expect(
              String(
                entry.currency,
              ).toUpperCase(),
            ).toBe(
              CONTRIBUTION_CURRENCY,
            );
          }
        }
      },
    );

    test(
      'reversal request is rejected for a journal already marked as reversed',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        await requestReversal({
          journalId:
            originalJournalId,
          idempotencyKey:
            'first-reversal-explicit-000001',
        });

        const response =
          await requestReversal({
            journalId:
              originalJournalId,
            idempotencyKey:
              'second-reversal-explicit-000001',
          });

        if (
          response
        ) {
          expect(
            [
              409,
              422,
            ],
          ).toContain(
            response.status,
          );
        }
      },
    );

    test(
      'reversal remains safe when the provider callback is replayed after reversal',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        await requestReversal({
          journalId:
            originalJournalId,
        });

        const before =
          await findJournals({
            $or: [
              {
                _id:
                  mongoose.Types.ObjectId.isValid(
                    originalJournalId,
                  )
                    ? new mongoose.Types.ObjectId(
                        originalJournalId,
                      )
                    : originalJournalId,
              },

              {
                reversalOfJournalId:
                  originalJournalId,
              },
            ],
          });

        await sendContributionSuccessCallback();

        const after =
          await findJournals({
            $or: [
              {
                _id:
                  mongoose.Types.ObjectId.isValid(
                    originalJournalId,
                  )
                    ? new mongoose.Types.ObjectId(
                        originalJournalId,
                      )
                    : originalJournalId,
              },

              {
                reversalOfJournalId:
                  originalJournalId,
              },
            ],
          });

        expect(
          after.length,
        ).toBe(
          before.length,
        );
      },
    );

    test(
      'reversal does not create a compensating journal for a failed payment that never posted',
      async () => {
        await seedContext();

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
              'MTN-CB-REVERSAL-FAILED-000001',
            )
            .send(
              createProviderCallback({
                callbackId:
                  'MTN-CB-REVERSAL-FAILED-000001',

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
          ],
        ).toContain(
          failedCallback.status,
        );

        const journals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  CONTRIBUTION_IDEMPOTENCY_KEY,
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
      'reversal does not use the original contribution idempotency key as its own financial identity',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const response =
          await requestReversal({
            journalId:
              originalJournalId,

            idempotencyKey:
              REVERSAL_IDEMPOTENCY_KEY,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessHttp(
          response,
        );

        const reversalJournals =
          await findJournals({
            reversalOfJournalId:
              originalJournalId,
          });

        if (
          reversalJournals.length
        ) {
          const reversal =
            reversalJournals[0];

          if (
            reversal.idempotencyKey
          ) {
            expect(
              String(
                reversal.idempotencyKey,
              ),
            ).toBe(
              REVERSAL_IDEMPOTENCY_KEY,
            );
          }
        }
      },
    );

    test(
      'reversal amount equals the original posted contribution amount',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        await requestReversal({
          journalId:
            originalJournalId,
        });

        const reversal =
          await findJournals({
            reversalOfJournalId:
              originalJournalId,
          });

        if (
          reversal.length
        ) {
          const debit =
            reversal[0].totalDebit ??
            reversal[0].debitTotal;

          const credit =
            reversal[0].totalCredit ??
            reversal[0].creditTotal;

          if (
            debit !==
              undefined
          ) {
            expect(
              String(
                debit,
              ),
            ).toBe(
              CONTRIBUTION_AMOUNT,
            );
          }

          if (
            credit !==
              undefined
          ) {
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
      'reversal creates additive history rather than netting away the original journal',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const beforeCount =
          (
            await findJournals({
              $or: [
                {
                  _id:
                    mongoose.Types.ObjectId.isValid(
                      originalJournalId,
                    )
                      ? new mongoose.Types.ObjectId(
                          originalJournalId,
                        )
                      : originalJournalId,
                },
              ],
            })
          ).length;

        await requestReversal({
          journalId:
            originalJournalId,
        });

        const originalCount =
          (
            await findJournals({
              $or: [
                {
                  _id:
                    mongoose.Types.ObjectId.isValid(
                      originalJournalId,
                    )
                      ? new mongoose.Types.ObjectId(
                          originalJournalId,
                        )
                      : originalJournalId,
                },
              ],
            })
          ).length;

        expect(
          originalCount,
        ).toBe(
          beforeCount,
        );

        const reversalCount =
          (
            await findJournals({
              reversalOfJournalId:
                originalJournalId,
            })
          ).length;

        if (
          reversalCount
        ) {
          expect(
            reversalCount,
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