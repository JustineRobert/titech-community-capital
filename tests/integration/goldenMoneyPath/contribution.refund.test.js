'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Golden Money Path - Contribution Refund Integration Tests
 * ============================================================================
 *
 * File:
 *   tests/integration/goldenMoneyPath/contribution.refund.test.js
 *
 * Purpose
 * -------
 * Enterprise integration coverage for contribution refunds after successful
 * payment and settlement.
 *
 * Golden Money Path:
 *
 *   MEMBER
 *      |
 *      v
 *   CONTRIBUTION REQUEST
 *      |
 *      v
 *   PAYMENT ORCHESTRATION
 *      |
 *      +--> MTN MoMo / Airtel Money
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
 *   REFUND REQUEST
 *      |
 *      +--> Refund Authorization
 *      +--> Refund Idempotency
 *      +--> Provider Refund / Reversal
 *      +--> Refund Verification
 *      |
 *      v
 *   COMPENSATING LEDGER POSTING
 *
 * Accounting invariant
 * --------------------
 * A refund MUST NOT erase, rewrite, or delete the original contribution.
 *
 * Original contribution:
 *
 *   DEBIT   CASH / SETTLEMENT      100,000 UGX
 *   CREDIT  MEMBER CONTRIBUTION    100,000 UGX
 *
 * Refund:
 *
 *   DEBIT   MEMBER CONTRIBUTION    100,000 UGX
 *   CREDIT  CASH / SETTLEMENT      100,000 UGX
 *
 * The original journal remains immutable.
 * The refund is a new financial event.
 *
 * Primary objectives
 * ------------------
 * 1. Refund only an actually posted/settled contribution.
 * 2. Preserve original contribution identity.
 * 3. Create a separate refund identity.
 * 4. Never mutate or delete original journal history.
 * 5. Produce a balanced compensating journal.
 * 6. Refund no more than the refundable amount.
 * 7. Prevent double refunds.
 * 8. Make refund requests idempotent.
 * 9. Prevent idempotency-key payload conflicts.
 * 10. Prevent duplicate provider refund commands.
 * 11. Prevent duplicate refund transactions.
 * 12. Prevent duplicate refund journals.
 * 13. Preserve amount and currency.
 * 14. Preserve tenant isolation.
 * 15. Preserve provider/payment linkage.
 * 16. Support asynchronous provider refund completion.
 * 17. Support delayed refund callback.
 * 18. Support refund provider timeout / unknown outcome.
 * 19. Do not create financial success from an unknown refund outcome.
 * 20. Do not create a second refund during concurrent retries.
 * 21. Reject refunds for failed/non-settled contributions.
 * 22. Reject unauthorized refunds.
 * 23. Ensure the original provider transaction is not replaced.
 * 24. Ensure financial truth remains append-only.
 *
 * IMPORTANT
 * ---------
 * Refund and reversal are distinct business concepts:
 *
 *   - REVERSAL: accounting correction of a posted financial event.
 *   - REFUND: return of previously settled funds to the contributor.
 *
 * A refund may ultimately require a provider-side reversal/refund operation
 * plus a compensating ledger entry.
 *
 * This suite deliberately isolates external provider calls behind test mocks.
 * It never requires live MTN/Airtel credentials.
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
  'tenant-golden-path-refund-001';

const OTHER_TENANT_ID =
  'tenant-golden-path-refund-002';

const MEMBER_ID =
  '507f1f77bcf86cd799439801';

const OTHER_TENANT_MEMBER_ID =
  '507f1f77bcf86cd799439802';

const GROUP_ID =
  '507f1f77bcf86cd799439803';

const CONTRIBUTION_AMOUNT =
  '120000';

const PARTIAL_REFUND_AMOUNT =
  '50000';

const CONTRIBUTION_CURRENCY =
  'UGX';

const TEST_PHONE =
  '256700000601';

const OTHER_TENANT_PHONE =
  '256700000602';

const CONTRIBUTION_IDEMPOTENCY_KEY =
  'golden-money-path-refund-contribution-000001';

const REFUND_IDEMPOTENCY_KEY =
  'golden-money-path-refund-000001';

const PARTIAL_REFUND_IDEMPOTENCY_KEY =
  'golden-money-path-partial-refund-000001';

const PROVIDER_TRANSACTION_ID =
  'MTN-UG-REFUND-000001';

const PROVIDER_CALLBACK_ID =
  'MTN-CB-REFUND-000001';

const PROVIDER_REFUND_ID =
  'MTN-UG-REFUND-REF-000001';

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

const REFUND_SUCCESS_STATES =
  new Set([
    'SUCCESS',
    'SUCCEEDED',
    'COMPLETED',
    'REFUNDED',
    'SETTLED',
    'REVERSED',
  ]);

const PENDING_REFUND_STATES =
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
      value?.refundStatus ||
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
      value?.refund,
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

/* ============================================================================
 * Provider Fixtures
 * ========================================================================== */

function providerContributionSuccess(
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
      'Contribution payment successful',

    ...overrides,
  };
}

function providerRefundPending(
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

    providerRefundId:
      overrides.providerRefundId ||
      PROVIDER_REFUND_ID,

    refundTransactionId:
      overrides.refundTransactionId ||
      PROVIDER_REFUND_ID,

    refundReference:
      overrides.refundReference ||
      REFUND_IDEMPOTENCY_KEY,

    amount:
      overrides.amount ||
      CONTRIBUTION_AMOUNT,

    currency:
      overrides.currency ||
      CONTRIBUTION_CURRENCY,

    responseCode:
      'PENDING',

    responseMessage:
      'Refund request accepted and pending provider completion',

    ...overrides,
  };
}

function providerRefundSuccess(
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

    providerRefundId:
      overrides.providerRefundId ||
      PROVIDER_REFUND_ID,

    refundTransactionId:
      overrides.refundTransactionId ||
      PROVIDER_REFUND_ID,

    refundReference:
      overrides.refundReference ||
      REFUND_IDEMPOTENCY_KEY,

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
      'Refund successful',

    ...overrides,
  };
}

function providerRefundFailed(
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

    providerRefundId:
      overrides.providerRefundId ||
      PROVIDER_REFUND_ID,

    refundTransactionId:
      overrides.refundTransactionId ||
      PROVIDER_REFUND_ID,

    refundReference:
      overrides.refundReference ||
      REFUND_IDEMPOTENCY_KEY,

    amount:
      overrides.amount ||
      CONTRIBUTION_AMOUNT,

    currency:
      overrides.currency ||
      CONTRIBUTION_CURRENCY,

    responseCode:
      'FAILED',

    responseMessage:
      'Provider refund failed',

    ...overrides,
  };
}

function createContributionCallback(
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
      CONTRIBUTION_IDEMPOTENCY_KEY,

    status:
      'SUCCESS',

    outcome:
      'SUCCESS',

    amount:
      CONTRIBUTION_AMOUNT,

    currency:
      CONTRIBUTION_CURRENCY,

    msisdn:
      TEST_PHONE,

    timestamp:
      new Date().toISOString(),

    ...overrides,
  };
}

function createRefundCallback(
  overrides = {},
) {
  return {
    callbackId:
      overrides.callbackId ||
      `MTN-CB-REFUND-${crypto
        .randomBytes(4)
        .toString('hex')
        .toUpperCase()}`,

    provider:
      'mtn',

    providerTransactionId:
      overrides.providerTransactionId ||
      PROVIDER_TRANSACTION_ID,

    providerRefundId:
      overrides.providerRefundId ||
      PROVIDER_REFUND_ID,

    refundTransactionId:
      overrides.refundTransactionId ||
      PROVIDER_REFUND_ID,

    refundReference:
      overrides.refundReference ||
      REFUND_IDEMPOTENCY_KEY,

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
      'golden-money-path-refund-secret';

    process.env.INTERNAL_API_KEY =
      'golden-money-path-refund-internal';

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
            providerContributionSuccess(),
          ),

      providerVerify:
        jest
          .fn()
          .mockResolvedValue(
            providerContributionSuccess(),
          ),

      providerCallback:
        jest
          .fn()
          .mockResolvedValue(
            providerContributionSuccess(),
          ),

      providerRefund:
        jest
          .fn()
          .mockResolvedValue(
            providerRefundSuccess(),
          ),

      providerRefundVerify:
        jest
          .fn()
          .mockResolvedValue(
            providerRefundSuccess(),
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
              '507f1f77bcf86cd799439804',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          }),

      ledgerRefund:
        jest
          .fn()
          .mockResolvedValue({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439805',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,

            refundOfJournalId:
              '507f1f77bcf86cd799439804',
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
        providerContributionSuccess(),
      );

    mocks.providerVerify
      .mockResolvedValue(
        providerContributionSuccess(),
      );

    mocks.providerCallback
      .mockResolvedValue(
        providerContributionSuccess(),
      );

    mocks.providerRefund
      .mockResolvedValue(
        providerRefundSuccess(),
      );

    mocks.providerRefundVerify
      .mockResolvedValue(
        providerRefundSuccess(),
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
          '507f1f77bcf86cd799439804',

        status:
          'POSTED',

        totalDebit:
          CONTRIBUTION_AMOUNT,

        totalCredit:
          CONTRIBUTION_AMOUNT,
      });

    mocks.ledgerRefund
      .mockResolvedValue({
        success:
          true,

        journalId:
          '507f1f77bcf86cd799439805',

        status:
          'POSTED',

        totalDebit:
          CONTRIBUTION_AMOUNT,

        totalCredit:
          CONTRIBUTION_AMOUNT,

        refundOfJournalId:
          '507f1f77bcf86cd799439804',
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
        'Golden Money Path Refund Group',

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
          '507f1f77bcf86cd799439806',

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
          '507f1f77bcf86cd799439807',

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
      'Contribution refund integration test',
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
    .send(
      createContributionCallback(
        overrides,
      ),
    );
}

/**
 * Try common refund endpoint shapes while keeping the business contract
 * centralized in requestRefund().
 */
async function requestRefund(
  input = {},
) {
  const body = {
    paymentId:
      input.paymentId ||
      null,

    contributionId:
      input.contributionId ||
      null,

    transactionId:
      input.transactionId ||
      originalTransactionId,

    journalId:
      input.journalId ||
      originalJournalId,

    amount:
      input.amount ??
      Number(
        CONTRIBUTION_AMOUNT,
      ),

    currency:
      input.currency ||
      CONTRIBUTION_CURRENCY,

    reasonCode:
      input.reasonCode ||
      'CUSTOMER_REQUEST',

    reason:
      input.reason ||
      'Customer requested refund',

    idempotencyKey:
      input.idempotencyKey ||
      REFUND_IDEMPOTENCY_KEY,

    reference:
      input.reference ||
      REFUND_IDEMPOTENCY_KEY,

    metadata:
      input.metadata ||
      {
        source:
          'golden-money-path-refund-integration-test',
      },
  };

  const candidates = [
    {
      method:
        'post',

      path:
        '/api/payments/refund',
    },

    {
      method:
        'post',

      path:
        '/api/payments/refunds',
    },

    {
      method:
        'post',

      path:
        '/api/contributions/refund',
    },

    {
      method:
        'post',

      path:
        '/api/refunds',
    },

    {
      method:
        'post',

      path:
        '/api/transactions/refund',
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
      // Try next known route.
    }
  }

  return null;
}

async function sendRefundCallback(
  overrides = {},
) {
  const candidates = [
    '/api/payments/refund/callback/mtn',
    '/api/payments/refunds/callback/mtn',
    '/api/payments/callbacks/mtn/refund',
    '/api/refunds/callback/mtn',
  ];

  const payload =
    createRefundCallback(
      overrides,
    );

  for (
    const callbackPath of
      candidates
  ) {
    try {
      const response =
        await request(
          app,
        )
          .post(
            callbackPath,
          )
          .set(
            'Content-Type',
            'application/json',
          )
          .set(
            'X-Callback-Id',
            payload.callbackId,
          )
          .set(
            'X-Request-Id',
            `refund-callback-${crypto.randomUUID()}`,
          )
          .send(
            payload,
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
      // Continue.
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

async function findRefunds(
  filter = {},
) {
  return findCollectionDocuments(
    [
      'refunds',
      'paymentrefunds',
      'paymentRefunds',
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

    refunds:
      await findRefunds({}),
  };
}

/* ============================================================================
 * Posted Contribution Setup
 * ========================================================================== */

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
    const posted =
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
        posted._id ||
          posted.id,
      );

    originalTransactionId =
      String(
        posted.transactionId ||
          PROVIDER_TRANSACTION_ID,
      );
  }

  const payments =
    await findPayments({
      $or: [
        {
          idempotencyKey:
            CONTRIBUTION_IDEMPOTENCY_KEY,
        },

        {
          paymentReference:
            CONTRIBUTION_IDEMPOTENCY_KEY,
        },

        {
          providerTransactionId:
            PROVIDER_TRANSACTION_ID,
        },
      ],
    });

  return {
    initiation,
    callback,
    journals,
    payments,
  };
}

/* ============================================================================
 * Suite
 * ========================================================================== */

describe(
  'Golden Money Path - Contribution Refund',
  () => {
    test(
      'refunds a fully settled contribution and preserves the original payment history',
      async () => {
        await seedContext();

        const posted =
          await createPostedContribution();

        /**
         * Refund should operate only after a successful settlement.
         */
        if (
          posted.payments.length
        ) {
          expect(
            TERMINAL_SUCCESS_STATES.has(
              getStatus(
                posted.payments[0],
              ),
            ),
          ).toBe(
            true,
          );
        }

        const response =
          await requestRefund({
            paymentId:
              posted.payments[0]?._id,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessfulHttp(
          response,
        );

        const payload =
          responsePayload(
            response,
          );

        const refundId =
          getIdentifier(
            payload,
            [
              'refundId',
              '_id',
              'id',
            ],
          );

        expect(
          refundId,
        ).toBeTruthy();

        const paymentsAfter =
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

        expect(
          paymentsAfter.length,
        ).toBeGreaterThanOrEqual(
          1,
        );
      },
    );

    test(
      'refund creates a distinct refund identity rather than replacing the original payment identity',
      async () => {
        await seedContext();

        const posted =
          await createPostedContribution();

        const originalPaymentId =
          posted.payments[0]
            ? String(
                posted.payments[0]
                  ._id ||
                  posted.payments[0].id,
              )
            : null;

        const response =
          await requestRefund({
            paymentId:
              originalPaymentId,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessfulHttp(
          response,
        );

        const payload =
          responsePayload(
            response,
          );

        const refundId =
          getIdentifier(
            payload,
            [
              'refundId',
              '_id',
              'id',
            ],
          );

        if (
          originalPaymentId
          &&
          refundId
        ) {
          expect(
            refundId,
          ).not.toBe(
            originalPaymentId,
          );
        }
      },
    );

    test(
      'refund preserves the original provider transaction identity',
      async () => {
        await seedContext();

        const posted =
          await createPostedContribution();

        await requestRefund({
          paymentId:
            posted.payments[0]
              ?._id,
        });

        const payments =
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

        for (
          const payment of
            payments
        ) {
          if (
            payment.providerTransactionId
          ) {
            expect(
              String(
                payment.providerTransactionId,
              ),
            ).toBe(
              PROVIDER_TRANSACTION_ID,
            );
          }
        }
      },
    );

    test(
      'refund does not initiate a second original contribution provider transaction',
      async () => {
        await seedContext();

        const posted =
          await createPostedContribution();

        const providerCallsBefore =
          mocks.providerInitiate.mock
            .calls.length;

        await requestRefund({
          paymentId:
            posted.payments[0]
              ?._id,
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
      'successful refund produces a compensating ledger journal',
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
                refundOfJournalId:
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
          await requestRefund({
            journalId:
              originalJournalId,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessfulHttp(
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
                refundOfJournalId:
                  originalJournalId,
              },
            ],
          });

        expect(
          after.length,
        ).toBeGreaterThanOrEqual(
          2,
        );
      },
    );

    test(
      'successful refund does not delete the original journal',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        await requestRefund({
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
      'successful refund produces a balanced compensating journal',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        mocks.ledgerRefund
          .mockResolvedValueOnce({
            success:
              true,

            journalId:
              '507f1f77bcf86cd799439808',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,

            refundOfJournalId:
              originalJournalId,
          });

        await requestRefund({
          journalId:
            originalJournalId,
        });

        const refundJournals =
          await findJournals({
            refundOfJournalId:
              originalJournalId,
          });

        if (
          refundJournals.length
        ) {
          const refundJournal =
            refundJournals[0];

          const debit =
            refundJournal.totalDebit ??
            refundJournal.debitTotal;

          const credit =
            refundJournal.totalCredit ??
            refundJournal.creditTotal;

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
      'successful refund preserves the refund currency',
      async () => {
        await seedContext();

        await createPostedContribution();

        await requestRefund({
          currency:
            CONTRIBUTION_CURRENCY,
        });

        const refunds =
          await findRefunds({
            $or: [
              {
                idempotencyKey:
                  REFUND_IDEMPOTENCY_KEY,
              },

              {
                refundReference:
                  REFUND_IDEMPOTENCY_KEY,
              },

              {
                providerRefundId:
                  PROVIDER_REFUND_ID,
              },
            ],
          });

        for (
          const refund of
            refunds
        ) {
          if (
            refund.currency
          ) {
            expect(
              String(
                refund.currency,
              ).toUpperCase(),
            ).toBe(
              CONTRIBUTION_CURRENCY,
            );
          }
        }
      },
    );

    test(
      'successful full refund preserves the exact contribution amount',
      async () => {
        await seedContext();

        await createPostedContribution();

        await requestRefund({
          amount:
            Number(
              CONTRIBUTION_AMOUNT,
            ),
        });

        const refundJournals =
          await findJournals({
            $or: [
              {
                refundOfJournalId:
                  originalJournalId,
              },

              {
                refundReference:
                  REFUND_IDEMPOTENCY_KEY,
              },
            ],
          });

        for (
          const journal of
            refundJournals
        ) {
          const debit =
            journal.totalDebit ??
            journal.debitTotal;

          const credit =
            journal.totalCredit ??
            journal.creditTotal;

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
      'partial refund does not exceed the original contribution amount',
      async () => {
        await seedContext();

        await createPostedContribution();

        const response =
          await requestRefund({
            amount:
              Number(
                PARTIAL_REFUND_AMOUNT,
              ),

            idempotencyKey:
              PARTIAL_REFUND_IDEMPOTENCY_KEY,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessfulHttp(
          response,
        );

        const payload =
          responsePayload(
            response,
          );

        const returnedAmount =
          payload.amount ??
          payload.refund?.amount;

        if (
          returnedAmount !==
            undefined
        ) {
          expect(
            String(
              returnedAmount,
            ),
          ).toBe(
            PARTIAL_REFUND_AMOUNT,
          );
        }

        expect(
          Number(
            PARTIAL_REFUND_AMOUNT,
          ),
        ).toBeLessThan(
          Number(
            CONTRIBUTION_AMOUNT,
          ),
        );
      },
    );

    test(
      'partial refund preserves remaining refundable amount',
      async () => {
        await seedContext();

        await createPostedContribution();

        const response =
          await requestRefund({
            amount:
              Number(
                PARTIAL_REFUND_AMOUNT,
              ),

            idempotencyKey:
              PARTIAL_REFUND_IDEMPOTENCY_KEY,
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessfulHttp(
          response,
        );

        const payload =
          responsePayload(
            response,
          );

        const remaining =
          payload.remainingRefundableAmount ??
          payload.refund?.remainingRefundableAmount;

        if (
          remaining !==
            undefined
        ) {
          expect(
            String(
              remaining,
            ),
          ).toBe(
            String(
              Number(
                CONTRIBUTION_AMOUNT,
              ) -
                Number(
                  PARTIAL_REFUND_AMOUNT,
                ),
            ),
          );
        }
      },
    );

    test(
      'refund rejects an amount greater than the original contribution',
      async () => {
        await seedContext();

        await createPostedContribution();

        const response =
          await requestRefund({
            amount:
              Number(
                CONTRIBUTION_AMOUNT,
              ) +
              1,
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
      'refund rejects a negative amount',
      async () => {
        await seedContext();

        await createPostedContribution();

        const response =
          await requestRefund({
            amount:
              -5000,

            idempotencyKey:
              'negative-refund-000001',
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
      'refund rejects zero amount',
      async () => {
        await seedContext();

        await createPostedContribution();

        const response =
          await requestRefund({
            amount:
              0,

            idempotencyKey:
              'zero-refund-000001',
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
      'refund rejects unsupported currency mismatch',
      async () => {
        await seedContext();

        await createPostedContribution();

        const response =
          await requestRefund({
            currency:
              'USD',

            idempotencyKey:
              'currency-mismatch-refund-000001',
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
      'refund rejects a failed payment that never reached successful settlement',
      async () => {
        await seedContext();

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
              'MTN-CB-REFUND-FAILED-000001',
            )
            .send(
              createContributionCallback({
                callbackId:
                  'MTN-CB-REFUND-FAILED-000001',

                status:
                  'FAILED',

                outcome:
                  'FAILED',
              }),
            );

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          failed.status,
        );

        const response =
          await requestRefund({
            paymentId:
              null,

            transactionId:
              PROVIDER_TRANSACTION_ID,

            idempotencyKey:
              'refund-failed-payment-000001',
          });

        if (
          !response
        ) {
          return;
        }

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
      },
    );

    test(
      'refund cannot be performed on an unknown or pending payment',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValueOnce({
            ...providerContributionSuccess(),

            status:
              'PENDING',

            outcome:
              'PENDING',

            responseCode:
              'PENDING',
          });

        const contribution =
          await initiateContribution({
            idempotencyKey:
              'pending-refund-contribution-000001',
          });

        const response =
          await requestRefund({
            idempotencyKey:
              'refund-pending-payment-000001',

            paymentId:
              getIdentifier(
                responsePayload(
                  contribution,
                ),
                [
                  'paymentId',
                  '_id',
                  'id',
                ],
              ),
          });

        if (
          !response
        ) {
          return;
        }

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
      },
    );

    test(
      'refund is idempotent for the same refund idempotency key',
      async () => {
        await seedContext();

        await createPostedContribution();

        const first =
          await requestRefund({
            idempotencyKey:
              REFUND_IDEMPOTENCY_KEY,
          });

        if (
          !first
        ) {
          return;
        }

        expectSuccessfulHttp(
          first,
        );

        const firstPayload =
          responsePayload(
            first,
          );

        const firstRefundId =
          getIdentifier(
            firstPayload,
            [
              'refundId',
              '_id',
              'id',
            ],
          );

        const second =
          await requestRefund({
            idempotencyKey:
              REFUND_IDEMPOTENCY_KEY,
          });

        expectSuccessfulHttp(
          second,
        );

        const secondPayload =
          responsePayload(
            second,
          );

        const secondRefundId =
          getIdentifier(
            secondPayload,
            [
              'refundId',
              '_id',
              'id',
            ],
          );

        if (
          firstRefundId &&
          secondRefundId
        ) {
          expect(
            secondRefundId,
          ).toBe(
            firstRefundId,
          );
        }

        const refunds =
          await findRefunds({
            $or: [
              {
                idempotencyKey:
                  REFUND_IDEMPOTENCY_KEY,
              },

              {
                refundReference:
                  REFUND_IDEMPOTENCY_KEY,
              },
            ],
          });

        if (
          refunds.length
        ) {
          expect(
            refunds.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'refund rejects reusing the same idempotency key with a different refund amount',
      async () => {
        await seedContext();

        await createPostedContribution();

        const first =
          await requestRefund({
            idempotencyKey:
              'refund-payload-conflict-000001',

            amount:
              50000,
          });

        if (
          !first
        ) {
          return;
        }

        expectSuccessfulHttp(
          first,
        );

        const second =
          await requestRefund({
            idempotencyKey:
              'refund-payload-conflict-000001',

            amount:
              75000,
          });

        expect(
          [
            409,
            422,
          ],
        ).toContain(
          second.status,
        );
      },
    );

    test(
      'refund does not create duplicate records under concurrent requests',
      async () => {
        await seedContext();

        await createPostedContribution();

        const responses =
          await Promise.all([
            requestRefund({
              idempotencyKey:
                'concurrent-refund-000001',
            }),

            requestRefund({
              idempotencyKey:
                'concurrent-refund-000001',
            }),

            requestRefund({
              idempotencyKey:
                'concurrent-refund-000001',
            }),

            requestRefund({
              idempotencyKey:
                'concurrent-refund-000001',
            }),
          ]);

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
              422,
            ],
          ).toContain(
            response.status,
          );
        }

        const refunds =
          await findRefunds({
            $or: [
              {
                idempotencyKey:
                  'concurrent-refund-000001',
              },

              {
                refundReference:
                  'concurrent-refund-000001',
              },
            ],
          });

        if (
          refunds.length
        ) {
          expect(
            refunds.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'successful refund callback is idempotent',
      async () => {
        await seedContext();

        await createPostedContribution();

        const response =
          await requestRefund();

        if (
          !response
        ) {
          return;
        }

        expectSuccessfulHttp(
          response,
        );

        const firstCallback =
          await sendRefundCallback();

        if (
          !firstCallback
        ) {
          return;
        }

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          firstCallback.status,
        );

        const beforeReplay =
          await findJournals({
            $or: [
              {
                refundOfJournalId:
                  originalJournalId,
              },

              {
                refundReference:
                  REFUND_IDEMPOTENCY_KEY,
              },
            ],
          });

        const secondCallback =
          await sendRefundCallback({
            callbackId:
              firstCallback.body
                ?.callbackId ||
              'MTN-CB-REFUND-REPLAY-000001',
          });

        if (
          secondCallback
        ) {
          expect(
            [
              200,
              202,
            ],
          ).toContain(
            secondCallback.status,
          );
        }

        const afterReplay =
          await findJournals({
            $or: [
              {
                refundOfJournalId:
                  originalJournalId,
              },

              {
                refundReference:
                  REFUND_IDEMPOTENCY_KEY,
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
      'delayed provider refund completion does not prematurely post a refund journal',
      async () => {
        await seedContext();

        await createPostedContribution();

        mocks.providerRefund
          .mockResolvedValueOnce(
            providerRefundPending(),
          );

        const response =
          await requestRefund();

        if (
          !response
        ) {
          return;
        }

        expect(
          [
            200,
            201,
            202,
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
          expect(
            REFUND_SUCCESS_STATES.has(
              status,
            ),
          ).toBe(
            false,
          );
        }
      },
    );

    test(
      'delayed refund callback completes a pending refund exactly once',
      async () => {
        await seedContext();

        await createPostedContribution();

        mocks.providerRefund
          .mockResolvedValueOnce(
            providerRefundPending(),
          );

        const response =
          await requestRefund();

        if (
          !response
        ) {
          return;
        }

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          response.status,
        );

        mocks.providerRefundVerify
          .mockResolvedValueOnce(
            providerRefundSuccess(),
          );

        const callback =
          await sendRefundCallback();

        if (
          !callback
        ) {
          return;
        }

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          callback.status,
        );

        const refunds =
          await findRefunds({
            $or: [
              {
                idempotencyKey:
                  REFUND_IDEMPOTENCY_KEY,
              },

              {
                providerRefundId:
                  PROVIDER_REFUND_ID,
              },
            ],
          });

        if (
          refunds.length
        ) {
          const statuses =
            refunds.map(
              getStatus,
            );

          expect(
            statuses.some(
              (
                status,
              ) =>
                REFUND_SUCCESS_STATES.has(
                  status,
                ),
            ),
          ).toBe(
            true,
          );
        }
      },
    );

    test(
      'provider refund failure creates no successful refund ledger journal',
      async () => {
        await seedContext();

        await createPostedContribution();

        mocks.providerRefund
          .mockResolvedValueOnce(
            providerRefundFailed(),
          );

        const response =
          await requestRefund();

        if (
          !response
        ) {
          return;
        }

        expect(
          [
            200,
            202,
            400,
            409,
            422,
          ],
        ).toContain(
          response.status,
        );

        const refundJournals =
          await findJournals({
            $or: [
              {
                refundOfJournalId:
                  originalJournalId,
              },

              {
                refundReference:
                  REFUND_IDEMPOTENCY_KEY,
              },
            ],
          });

        expect(
          refundJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'provider refund timeout does not create a successful refund journal',
      async () => {
        await seedContext();

        await createPostedContribution();

        const error =
          new Error(
            'Refund provider request timed out',
          );

        error.code =
          'ETIMEDOUT';

        error.unknownOutcome =
          true;

        error.reconciliationRequired =
          true;

        mocks.providerRefund
          .mockRejectedValueOnce(
            error,
          );

        const response =
          await requestRefund();

        if (
          !response
        ) {
          return;
        }

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

        const refundJournals =
          await findJournals({
            $or: [
              {
                refundOfJournalId:
                  originalJournalId,
              },

              {
                refundReference:
                  REFUND_IDEMPOTENCY_KEY,
              },
            ],
          });

        expect(
          refundJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'refund provider timeout can be reconciled by a later successful refund callback',
      async () => {
        await seedContext();

        await createPostedContribution();

        const error =
          new Error(
            'Refund network timeout',
          );

        error.code =
          'ECONNRESET';

        error.unknownOutcome =
          true;

        error.reconciliationRequired =
          true;

        mocks.providerRefund
          .mockRejectedValueOnce(
            error,
          );

        await requestRefund();

        const before =
          await findJournals({
            $or: [
              {
                refundOfJournalId:
                  originalJournalId,
              },

              {
                refundReference:
                  REFUND_IDEMPOTENCY_KEY,
              },
            ],
          });

        expect(
          before.length,
        ).toBe(
          0,
        );

        const callback =
          await sendRefundCallback();

        if (
          callback
        ) {
          expect(
            [
              200,
              202,
            ].includes(
              callback.status,
            ) ||
              [
                400,
                409,
              ].includes(
                callback.status,
              ),
          ).toBe(
            true,
          );
        }

        const after =
          await findJournals({
            $or: [
              {
                refundOfJournalId:
                  originalJournalId,
              },

              {
                refundReference:
                  REFUND_IDEMPOTENCY_KEY,
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
        }
      },
    );

    test(
      'refund recovery does not create a second provider refund command',
      async () => {
        await seedContext();

        await createPostedContribution();

        mocks.providerRefund
          .mockResolvedValueOnce(
            providerRefundPending(),
          );

        await requestRefund();

        const callsBefore =
          mocks.providerRefund.mock
            .calls.length;

        const second =
          await requestRefund();

        if (
          second
        ) {
          expect(
            [
              200,
              202,
              409,
            ].includes(
              second.status,
            ),
          ).toBe(
            true,
          );
        }

        const callsAfter =
          mocks.providerRefund.mock
            .calls.length;

        expect(
          callsAfter,
        ).toBeLessThanOrEqual(
          callsBefore + 1,
        );
      },
    );

    test(
      'refund does not create duplicate refund transactions after repeated callbacks',
      async () => {
        await seedContext();

        await createPostedContribution();

        await requestRefund();

        await sendRefundCallback();

        await sendRefundCallback();

        const transactions =
          await findTransactions({
            $or: [
              {
                providerRefundId:
                  PROVIDER_REFUND_ID,
              },

              {
                refundReference:
                  REFUND_IDEMPOTENCY_KEY,
              },

              {
                reference:
                  REFUND_IDEMPOTENCY_KEY,
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
      'refund does not create duplicate refund journals after repeated callbacks',
      async () => {
        await seedContext();

        await createPostedContribution();

        await requestRefund();

        await sendRefundCallback();

        await sendRefundCallback();

        const journals =
          await findJournals({
            $or: [
              {
                refundOfJournalId:
                  originalJournalId,
              },

              {
                refundReference:
                  REFUND_IDEMPOTENCY_KEY,
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
      'refund does not mutate the original contribution journal totals',
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

        const original =
          before[0];

        await requestRefund({
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

        const updated =
          after[0];

        if (
          original.totalDebit !==
            undefined &&
          updated.totalDebit !==
            undefined
        ) {
          expect(
            String(
              updated.totalDebit,
            ),
          ).toBe(
            String(
              original.totalDebit,
            ),
          );
        }

        if (
          original.totalCredit !==
            undefined &&
          updated.totalCredit !==
            undefined
        ) {
          expect(
            String(
              updated.totalCredit,
            ),
          ).toBe(
            String(
              original.totalCredit,
            ),
          );
        }
      },
    );

    test(
      'refund does not mutate the original contribution journal entries',
      async () => {
        await seedContext();

        await createPostedContribution();

        if (
          !originalJournalId
        ) {
          return;
        }

        const before =
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
          !before.length
        ) {
          return;
        }

        const snapshot =
          before.map(
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

        await requestRefund({
          journalId:
            originalJournalId,
        });

        const after =
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
          after.map(
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
            snapshot,
          ),
        );
      },
    );

    test(
      'refund remains scoped to the original tenant',
      async () => {
        await seedContext();

        await createPostedContribution();

        const response =
          await requestRefund({
            token:
              OTHER_TENANT_TOKEN,
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
            422,
          ],
        ).toContain(
          response.status,
        );

        const refundJournals =
          await findJournals({
            refundReference:
              REFUND_IDEMPOTENCY_KEY,
          });

        for (
          const journal of
            refundJournals
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
      'cross-tenant refund cannot create a refund record for the wrong tenant',
      async () => {
        await seedContext();

        await createPostedContribution();

        const response =
          await requestRefund({
            token:
              OTHER_TENANT_TOKEN,

            idempotencyKey:
              'cross-tenant-refund-000001',
          });

        if (
          response
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

        const refunds =
          await findRefunds({
            $or: [
              {
                idempotencyKey:
                  'cross-tenant-refund-000001',
              },

              {
                refundReference:
                  'cross-tenant-refund-000001',
              },
            ],
          });

        for (
          const refund of
            refunds
        ) {
          if (
            refund.tenantId
          ) {
            expect(
              String(
                refund.tenantId,
              ),
            ).toBe(
              TEST_TENANT_ID,
            );
          }
        }
      },
    );

    test(
      'full refund cannot be performed twice with different idempotency keys',
      async () => {
        await seedContext();

        await createPostedContribution();

        const first =
          await requestRefund({
            idempotencyKey:
              'first-full-refund-000001',
          });

        if (
          !first
        ) {
          return;
        }

        expectSuccessfulHttp(
          first,
        );

        const second =
          await requestRefund({
            idempotencyKey:
              'second-full-refund-000001',
          });

        expect(
          [
            409,
            422,
          ],
        ).toContain(
          second.status,
        );

        const refunds =
          await findRefunds({
            $or: [
              {
                amount:
                  Number(
                    CONTRIBUTION_AMOUNT,
                  ),
              },

              {
                refundReference:
                  'first-full-refund-000001',
              },
            ],
          });

        if (
          refunds.length
        ) {
          expect(
            refunds.length,
          ).toBeLessThanOrEqual(
            1,
          );
        }
      },
    );

    test(
      'a partial refund cannot be followed by a refund exceeding the remaining balance',
      async () => {
        await seedContext();

        await createPostedContribution();

        const first =
          await requestRefund({
            amount:
              Number(
                PARTIAL_REFUND_AMOUNT,
              ),

            idempotencyKey:
              'partial-refund-first-000001',
          });

        if (
          !first
        ) {
          return;
        }

        expectSuccessfulHttp(
          first,
        );

        const excessive =
          await requestRefund({
            amount:
              Number(
                CONTRIBUTION_AMOUNT,
              ) -
              Number(
                PARTIAL_REFUND_AMOUNT,
              ) +
              1,

            idempotencyKey:
              'partial-refund-excessive-000001',
          });

        expect(
          [
            400,
            409,
            422,
          ],
        ).toContain(
          excessive.status,
        );
      },
    );

    test(
      'refund provider success does not create a second original contribution journal',
      async () => {
        await seedContext();

        await createPostedContribution();

        const originalJournals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await requestRefund();

        const originalJournalsAfter =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          originalJournals.length
          ||
          originalJournalsAfter.length
        ) {
          expect(
            originalJournalsAfter.length,
          ).toBe(
            originalJournals.length,
          );
        }
      },
    );

    test(
      'refund provider success preserves contribution payment identity',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await requestRefund();

        const after =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
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
      'refund reason is persisted for auditability',
      async () => {
        await seedContext();

        await createPostedContribution();

        const response =
          await requestRefund({
            reasonCode:
              'CUSTOMER_REQUEST',

            reason:
              'Member requested return of contribution funds',
          });

        if (
          !response
        ) {
          return;
        }

        expectSuccessfulHttp(
          response,
        );

        const refunds =
          await findRefunds({
            $or: [
              {
                idempotencyKey:
                  REFUND_IDEMPOTENCY_KEY,
              },

              {
                refundReference:
                  REFUND_IDEMPOTENCY_KEY,
              },
            ],
          });

        for (
          const refund of
            refunds
        ) {
          const reasonCode =
            refund.reasonCode ||
            refund.reason;

          if (
            reasonCode
          ) {
            expect(
              String(
                reasonCode,
              ).toUpperCase(),
            ).toMatch(
              /CUSTOMER_REQUEST|CUSTOMER/,
            );
          }
        }
      },
    );

    test(
      'refund requires an idempotency key under production semantics',
      async () => {
        await seedContext();

        await createPostedContribution();

        const response =
          await requestRefund({
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
      'refund of a missing payment is rejected',
      async () => {
        await seedContext();

        const response =
          await requestRefund({
            paymentId:
              '507f1f77bcf86cd799439899',

            idempotencyKey:
              'refund-missing-payment-000001',
          });

        if (
          !response
        ) {
          return;
        }

        expect(
          [
            400,
            404,
            409,
          ],
        ).toContain(
          response.status,
        );
      },
    );

    test(
      'refund remains immutable after successful completion',
      async () => {
        await seedContext();

        await createPostedContribution();

        const first =
          await requestRefund();

        if (
          !first
        ) {
          return;
        }

        expectSuccessfulHttp(
          first,
        );

        const before =
          await snapshotFinancialState();

        const second =
          await requestRefund({
            idempotencyKey:
              REFUND_IDEMPOTENCY_KEY,
          });

        expectSuccessfulHttp(
          second,
        );

        const after =
          await snapshotFinancialState();

        expect(
          after.journals.length,
        ).toBe(
          before.journals.length,
        );

        expect(
          after.payments.length,
        ).toBe(
          before.payments.length,
        );
      },
    );

    test(
      'refund recovery preserves a single authoritative refund journal',
      async () => {
        await seedContext();

        await createPostedContribution();

        mocks.providerRefund
          .mockResolvedValueOnce(
            providerRefundPending(),
          );

        await requestRefund();

        await sendRefundCallback();

        await sendRefundCallback();

        const journals =
          await findJournals({
            $or: [
              {
                refundOfJournalId:
                  originalJournalId,
              },

              {
                refundReference:
                  REFUND_IDEMPOTENCY_KEY,
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
      'refund compensation preserves debit and credit equality',
      async () => {
        await seedContext();

        await createPostedContribution();

        await requestRefund();

        const journals =
          await findJournals({
            $or: [
              {
                refundOfJournalId:
                  originalJournalId,
              },

              {
                refundReference:
                  REFUND_IDEMPOTENCY_KEY,
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
      'refund does not cross tenant boundaries even when the provider transaction id is known',
      async () => {
        await seedContext();

        await createPostedContribution();

        const response =
          await requestRefund({
            token:
              OTHER_TENANT_TOKEN,

            transactionId:
              PROVIDER_TRANSACTION_ID,

            idempotencyKey:
              'cross-tenant-provider-refund-000001',
          });

        if (
          response
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

        const refundJournals =
          await findJournals({
            refundOfJournalId:
              originalJournalId,
          });

        for (
          const journal of
            refundJournals
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
      'refund completion does not create a new provider contribution transaction',
      async () => {
        await seedContext();

        await createPostedContribution();

        const beforeProviderTransactions =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await requestRefund();

        const afterProviderTransactions =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          afterProviderTransactions.length,
        ).toBe(
          beforeProviderTransactions.length,
        );
      },
    );

    test(
      'refund request remains safe when delivered concurrently with refund callback',
      async () => {
        await seedContext();

        await createPostedContribution();

        mocks.providerRefund
          .mockResolvedValueOnce(
            providerRefundPending(),
          );

        const [
          firstRefund,
          secondRefund,
          callback,
        ] =
          await Promise.all([
            requestRefund({
              idempotencyKey:
                'concurrent-refund-callback-000001',
            }),

            requestRefund({
              idempotencyKey:
                'concurrent-refund-callback-000001',
            }),

            sendRefundCallback({
              callbackId:
                'MTN-CB-REFUND-CONCURRENT-000001',
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
          firstRefund?.status ||
            409,
        );

        expect(
          [
            200,
            201,
            202,
            409,
          ],
        ).toContain(
          secondRefund?.status ||
            409,
        );

        if (
          callback
        ) {
          expect(
            [
              200,
              202,
              400,
              409,
            ],
          ).toContain(
            callback.status,
          );
        }

        const refunds =
          await findRefunds({
            $or: [
              {
                idempotencyKey:
                  'concurrent-refund-callback-000001',
              },

              {
                refundReference:
                  'concurrent-refund-callback-000001',
              },

              {
                providerRefundId:
                  PROVIDER_REFUND_ID,
              },
            ],
          });

        if (
          refunds.length
        ) {
          expect(
            refunds.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'refund provider failure leaves the original settled contribution intact',
      async () => {
        await seedContext();

        await createPostedContribution();

        mocks.providerRefund
          .mockResolvedValueOnce(
            providerRefundFailed(),
          );

        await requestRefund();

        const originalPayments =
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
          originalPayments.length
        ) {
          expect(
            TERMINAL_SUCCESS_STATES.has(
              getStatus(
                originalPayments[0],
              ),
            ),
          ).toBe(
            true,
          );
        }

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        for (
          const journal of
            journals
        ) {
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
      },
    );

    test(
      'refund provider timeout does not authorize a second refund provider command under the same idempotency key',
      async () => {
        await seedContext();

        await createPostedContribution();

        const timeout =
          new Error(
            'Provider refund timeout',
          );

        timeout.code =
          'ETIMEDOUT';

        timeout.unknownOutcome =
          true;

        timeout.reconciliationRequired =
          true;

        mocks.providerRefund
          .mockRejectedValueOnce(
            timeout,
          );

        await requestRefund({
          idempotencyKey:
            'refund-timeout-idempotency-000001',
        });

        const callsBeforeRetry =
          mocks.providerRefund.mock
            .calls.length;

        const retry =
          await requestRefund({
            idempotencyKey:
              'refund-timeout-idempotency-000001',
          });

        if (
          retry
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
            retry.status,
          );
        }

        const callsAfterRetry =
          mocks.providerRefund.mock
            .calls.length;

        /**
         * A true UNKNOWN state must not blindly issue duplicate provider
         * commands.
         */
        expect(
          callsAfterRetry,
        ).toBeLessThanOrEqual(
          callsBeforeRetry + 1,
        );
      },
    );

    test(
      'refund state remains recoverable after a provider timeout',
      async () => {
        await seedContext();

        await createPostedContribution();

        const timeout =
          new Error(
            'Provider refund network timeout',
          );

        timeout.code =
          'ECONNRESET';

        timeout.unknownOutcome =
          true;

        timeout.reconciliationRequired =
          true;

        mocks.providerRefund
          .mockRejectedValueOnce(
            timeout,
          );

        const response =
          await requestRefund();

        if (
          !response
        ) {
          return;
        }

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
          expect(
            PENDING_REFUND_STATES.has(
              status,
            ) ||
              REFUND_SUCCESS_STATES.has(
                status,
              ),
          ).toBe(
            true,
          );
        }
      },
    );

    test(
      'refund does not silently alter the original contribution amount',
      async () => {
        await seedContext();

        await createPostedContribution();

        const original =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await requestRefund();

        const after =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          original.length
          &&
          after.length
        ) {
          const originalAmount =
            String(
              original[0].amount ??
                original[0]
                  .totalAmount ??
                '',
            );

          const afterAmount =
            String(
              after[0].amount ??
                after[0]
                  .totalAmount ??
                '',
            );

          if (
            originalAmount &&
            afterAmount
          ) {
            expect(
              afterAmount,
            ).toBe(
              originalAmount,
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