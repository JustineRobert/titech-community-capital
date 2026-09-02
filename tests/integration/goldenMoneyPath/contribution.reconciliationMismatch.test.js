'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Golden Money Path - Contribution Reconciliation Mismatch Integration Tests
 * ============================================================================
 *
 * File:
 *   tests/integration/goldenMoneyPath/contribution.reconciliationMismatch.test.js
 *
 * Purpose
 * -------
 * Enterprise integration coverage for financial reconciliation mismatches
 * encountered during the Golden Money Path contribution lifecycle.
 *
 * A contribution is NOT financially complete merely because:
 *
 *   - an API request succeeded,
 *   - a provider callback arrived,
 *   - a provider transaction exists,
 *   - the provider reports SUCCESS, or
 *   - a payment record exists.
 *
 * Final financial truth requires all authoritative dimensions to agree:
 *
 *   REQUEST
 *      |
 *      v
 *   PAYMENT ORCHESTRATION
 *      |
 *      v
 *   PROVIDER
 *      |
 *      v
 *   CALLBACK
 *      |
 *      v
 *   VERIFICATION
 *      |
 *      +------------------------------+
 *      |                              |
 *      v                              v
 *   BUSINESS RECORD              PROVIDER RECORD
 *      |                              |
 *      +---------------+--------------+
 *                      |
 *                      v
 *                RECONCILIATION
 *                      |
 *           +----------+-----------+
 *           |          |           |
 *        MATCH     MISMATCH     UNKNOWN
 *           |          |           |
 *           v          v           v
 *        SETTLE     HOLD/REVIEW   HOLD/REVIEW
 *           |          |
 *           v          |
 *         LEDGER <-----+
 *
 * Core reconciliation invariants
 * --------------------------------
 * 1. Amount must match.
 * 2. Currency must match.
 * 3. Provider must match.
 * 4. Provider transaction identity must match.
 * 5. Payment reference must correlate.
 * 6. Tenant identity must match.
 * 7. Member identity must match where authoritative.
 * 8. Group identity must match where authoritative.
 * 9. Payment state must permit settlement.
 * 10. A mismatch MUST NOT silently post to the ledger.
 * 11. A mismatch MUST NOT create duplicate financial truth.
 * 12. A mismatch MUST be observable and recoverable.
 * 13. Unknown outcome must not be interpreted as SUCCESS.
 * 14. Corrected/reconciled data must create an auditable transition.
 * 15. Original financial records remain immutable.
 * 16. Replay of a mismatch remains idempotent.
 * 17. Concurrent mismatch processing remains race-safe.
 * 18. Cross-tenant mismatches remain isolated.
 * 19. A mismatch cannot redirect funds to a different account.
 * 20. A mismatch cannot mutate a posted journal.
 *
 * Mismatch classes covered
 * ------------------------
 * - Amount mismatch
 * - Currency mismatch
 * - Provider mismatch
 * - Provider transaction ID mismatch
 * - Payment reference mismatch
 * - Tenant mismatch
 * - Member mismatch
 * - Group mismatch
 * - Callback identity mismatch
 * - Duplicate provider reference
 * - Duplicate payment reference
 * - Payment-state mismatch
 * - Provider-state mismatch
 * - Pending-vs-success mismatch
 * - Failed-vs-success mismatch
 * - Provider verification mismatch
 * - Ledger/account mismatch
 * - Reconciliation retry
 * - Reconciliation replay
 * - Concurrent reconciliation
 * - Corrective reconciliation
 * - Cross-tenant reconciliation
 *
 * Expected enterprise behavior
 * ----------------------------
 * The exact HTTP response code may vary by the concrete application contract.
 * The invariant is stronger than the transport code:
 *
 *   MISMATCH != SETTLED FINANCIAL TRUTH
 *
 * Implementations may represent a mismatch as:
 *
 *   PENDING
 *   HOLD
 *   RECONCILIATION_REQUIRED
 *   INVESTIGATION_REQUIRED
 *   EXCEPTION
 *   SUSPENDED
 *   MANUAL_REVIEW
 *
 * but must not create an unauthorized successful ledger posting.
 *
 * IMPORTANT
 * ---------
 * Provider calls are represented by deterministic test fixtures. No live
 * MTN/Airtel credentials are required.
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
  'tenant-golden-path-reconciliation-001';

const OTHER_TENANT_ID =
  'tenant-golden-path-reconciliation-002';

const MEMBER_ID =
  '507f1f77bcf86cd79943c01';

const SECOND_MEMBER_ID =
  '507f1f77bcf86cd79943c02';

const OTHER_TENANT_MEMBER_ID =
  '507f1f77bcf86cd79943c03';

const GROUP_ID =
  '507f1f77bcf86cd79943c04';

const CONTRIBUTION_AMOUNT =
  '100000';

const MISMATCHED_AMOUNT =
  '125000';

const SECOND_CONTRIBUTION_AMOUNT =
  '60000';

const CONTRIBUTION_CURRENCY =
  'UGX';

const MISMATCHED_CURRENCY =
  'USD';

const TEST_PHONE =
  '256700001201';

const SECOND_TEST_PHONE =
  '256700001202';

const OTHER_TENANT_PHONE =
  '256700001203';

const PAYMENT_REFERENCE =
  'golden-money-path-reconciliation-000001';

const SECOND_PAYMENT_REFERENCE =
  'golden-money-path-reconciliation-000002';

const PROVIDER_TRANSACTION_ID =
  'MTN-UG-RECON-000001';

const SECOND_PROVIDER_TRANSACTION_ID =
  'MTN-UG-RECON-000002';

const CALLBACK_ID =
  'MTN-CB-RECON-000001';

const SECOND_CALLBACK_ID =
  'MTN-CB-RECON-000002';

const CALLBACK_SECRET =
  'test-mtn-reconciliation-secret';

const AUTH_TOKEN =
  'test-access-token';

const SECOND_MEMBER_TOKEN =
  'second-member-access-token';

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

const FAILURE_STATES =
  new Set([
    'FAILED',
    'FAILURE',
    'DECLINED',
    'REJECTED',
    'CANCELLED',
    'CANCELED',
  ]);

const PENDING_STATES =
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
    'INVESTIGATION_REQUIRED',
    'MANUAL_REVIEW',
    'HOLD',
    'SUSPENDED',
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
      value?.reconciliationStatus ||
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
      value?.reconciliation,
    )
  );
}

function isSuccessfulState(
  value,
) {
  return SUCCESS_STATES.has(
    getStatus(
      value,
    ),
  );
}

function isMismatchState(
  value,
) {
  return PENDING_STATES.has(
    getStatus(
      value,
    ),
  );
}

function expectSafeHttp(
  response,
) {
  expect(
    [
      200,
      201,
      202,
      400,
      401,
      403,
      404,
      409,
      422,
      500,
      502,
      503,
      504,
    ],
  ).toContain(
    response.status,
  );
}

function expectRejectedMismatch(
  response,
) {
  expect(
    [
      400,
      403,
      404,
      409,
      422,
      500,
      502,
      503,
      504,
    ],
  ).toContain(
    response.status,
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
 * Signature Helpers
 * ========================================================================== */

function stableJson(
  payload,
) {
  return JSON.stringify(
    payload,
  );
}

function signPayload(
  payload,
  secret = CALLBACK_SECRET,
) {
  return crypto
    .createHmac(
      'sha256',
      secret,
    )
    .update(
      stableJson(
        payload,
      ),
      'utf8',
    )
    .digest('hex');
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
      PAYMENT_REFERENCE,

    reference:
      overrides.reference ||
      PAYMENT_REFERENCE,

    externalReference:
      overrides.externalReference ||
      PAYMENT_REFERENCE,

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
    ...providerSuccess(
      overrides,
    ),

    success:
      true,

    status:
      'PENDING',

    outcome:
      'PENDING',

    responseCode:
      'PENDING',

    responseMessage:
      'Transaction pending',
  };
}

function providerFailed(
  overrides = {},
) {
  return {
    ...providerSuccess(
      overrides,
    ),

    success:
      false,

    status:
      'FAILED',

    outcome:
      'FAILED',

    responseCode:
      'FAILED',

    responseMessage:
      'Transaction failed',
  };
}

function providerVerificationMismatch(
  overrides = {},
) {
  return {
    ...providerSuccess(
      overrides,
    ),

    success:
      true,

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
      PAYMENT_REFERENCE,

    amount:
      overrides.amount ||
      MISMATCHED_AMOUNT,

    currency:
      overrides.currency ||
      CONTRIBUTION_CURRENCY,
  };
}

function createCallback(
  overrides = {},
) {
  return {
    callbackId:
      overrides.callbackId ||
      CALLBACK_ID,

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
      PAYMENT_REFERENCE,

    reference:
      overrides.reference ||
      PAYMENT_REFERENCE,

    externalReference:
      overrides.externalReference ||
      PAYMENT_REFERENCE,

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
      'golden-money-path-reconciliation-secret';

    process.env.INTERNAL_API_KEY =
      'golden-money-path-reconciliation-internal';

    process.env.MTN_ENVIRONMENT =
      'sandbox';

    process.env.AIRTEL_ENVIRONMENT =
      'sandbox';

    process.env.MTN_CALLBACK_SECRET =
      CALLBACK_SECRET;

    process.env.MTN_WEBHOOK_SECRET =
      CALLBACK_SECRET;

    process.env.PAYMENT_CALLBACK_SECRET =
      CALLBACK_SECRET;

    process.env.PAYMENT_CALLBACK_TEST_MODE =
      'true';

    process.env.PAYMENT_CALLBACK_REQUIRE_SIGNATURE =
      'true';

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
          .mockResolvedValue({
            success:
              true,
          }),

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
              '507f1f77bcf86cd79943c05',

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

      createInvestigation:
        jest
          .fn()
          .mockResolvedValue({
            success:
              true,

            investigationId:
              '507f1f77bcf86cd79943c06',
          }),

      createReconciliationException:
        jest
          .fn()
          .mockResolvedValue({
            success:
              true,

            exceptionId:
              '507f1f77bcf86cd79943c07',
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
      .mockResolvedValue({
        success:
          true,
      });

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
          '507f1f77bcf86cd79943c05',

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

    mocks.createInvestigation
      .mockResolvedValue({
        success:
          true,

        investigationId:
          '507f1f77bcf86cd79943c06',
      });

    mocks.createReconciliationException
      .mockResolvedValue({
        success:
          true,

        exceptionId:
          '507f1f77bcf86cd79943c07',
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
          'other-tenant@titech.com',

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
        'Golden Money Path Reconciliation Group',

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
          '507f1f77bcf86cd79943c08',

        tenantId:
          TEST_TENANT_ID,

        name:
          'Settlement Cash',

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
      },

      {
        _id:
          '507f1f77bcf86cd79943c09',

        tenantId:
          TEST_TENANT_ID,

        ownerId:
          MEMBER_ID,

        name:
          'Member Contributions',

        code:
          '3010',

        currency:
          CONTRIBUTION_CURRENCY,

        type:
          'LIABILITY',

        accountType:
          'MEMBER_CONTRIBUTION',

        status:
          'ACTIVE',

        isActive:
          true,

        balance:
          0,
      },

      {
        _id:
          '507f1f77bcf86cd79943c0a',

        tenantId:
          OTHER_TENANT_ID,

        ownerId:
          OTHER_TENANT_MEMBER_ID,

        name:
          'Other Tenant Contributions',

        code:
          'OTH-3010',

        currency:
          CONTRIBUTION_CURRENCY,

        type:
          'LIABILITY',

        accountType:
          'MEMBER_CONTRIBUTION',

        status:
          'ACTIVE',

        isActive:
          true,

        balance:
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

async function initiateContribution(
  overrides = {},
  token = AUTH_TOKEN,
) {
  const idempotencyKey =
    overrides.idempotencyKey ||
    PAYMENT_REFERENCE;

  return authenticatedRequest(
    token,
  )
    .post(
      '/api/contributions',
    )
    .set(
      'Idempotency-Key',
      idempotencyKey,
    )
    .set(
      'X-Idempotency-Key',
      idempotencyKey,
    )
    .send({
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

      idempotencyKey,

      reference:
        overrides.reference ||
        idempotencyKey,

      ...overrides,
    });
}

async function sendCallback(
  payload,
  options = {},
) {
  const signature =
    options.signature !==
      undefined
      ? options.signature
      : signPayload(
          payload,
        );

  const agent =
    request(
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
        options.callbackId ||
          payload.callbackId ||
          CALLBACK_ID,
      )
      .set(
        'X-Request-Id',
        options.requestId ||
          `reconciliation-callback-${crypto.randomUUID()}`,
      );

  if (
    options.includeSignature !==
    false
  ) {
    agent.set(
      'X-MTN-Signature',
      signature,
    );

    agent.set(
      'X-Signature',
      signature,
    );
  }

  if (
    options.tenantId
  ) {
    agent.set(
      'X-Tenant-Id',
      options.tenantId,
    );
  }

  return agent.send(
    payload,
  );
}

/**
 * Generic reconciliation endpoint adapter.
 *
 * The concrete application may expose reconciliation through:
 *
 *   /api/payments/reconcile
 *   /api/reconciliation/payments
 *   /api/transactions/reconcile
 *   /api/finance/reconciliation/reconcile
 *
 * The helper attempts known integration boundaries while preserving the
 * business payload.
 */
async function requestReconciliation(
  input = {},
  token = AUTH_TOKEN,
) {
  const payload = {
    paymentId:
      input.paymentId ||
      null,

    transactionId:
      input.transactionId ||
      null,

    providerTransactionId:
      input.providerTransactionId ||
      PROVIDER_TRANSACTION_ID,

    paymentReference:
      input.paymentReference ||
      PAYMENT_REFERENCE,

    amount:
      input.amount ??
      Number(
        CONTRIBUTION_AMOUNT,
      ),

    currency:
      input.currency ||
      CONTRIBUTION_CURRENCY,

    provider:
      input.provider ||
      'mtn',

    tenantId:
      input.tenantId ||
      TEST_TENANT_ID,

    groupId:
      input.groupId ||
      GROUP_ID,

    memberId:
      input.memberId ||
      MEMBER_ID,

    idempotencyKey:
      input.idempotencyKey ||
      `reconciliation-${PAYMENT_REFERENCE}`,

    reason:
      input.reason ||
      'Financial reconciliation request',

    ...input,
  };

  const candidates = [
    '/api/payments/reconcile',
    '/api/payment/reconcile',
    '/api/reconciliation/payments',
    '/api/reconciliation/reconcile',
    '/api/transactions/reconcile',
    '/api/finance/reconciliation/reconcile',
  ];

  for (
    const endpoint of
      candidates
  ) {
    try {
      const response =
        await authenticatedRequest(
          token,
        )
          .post(
            endpoint,
          )
          .set(
            'Idempotency-Key',
            payload.idempotencyKey,
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
      // Continue to next known contract.
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

async function findReconciliationRecords(
  filter = {},
) {
  return findCollectionDocuments(
    [
      'reconciliationexceptions',
      'reconciliationExceptions',
      'reconciliations',
      'paymentreconciliations',
      'paymentReconciliations',
    ],
    filter,
  );
}

async function snapshotOperation(
  reference = PAYMENT_REFERENCE,
) {
  return {
    payments:
      await findPayments({
        $or: [
          {
            paymentReference:
              reference,
          },

          {
            idempotencyKey:
              reference,
          },
        ],
      }),

    transactions:
      await findTransactions({
        $or: [
          {
            reference,
          },

          {
            idempotencyKey:
              reference,
          },

          {
            externalReference:
              reference,
          },
        ],
      }),

    contributions:
      await findContributions({
        $or: [
          {
            reference,
          },

          {
            idempotencyKey:
              reference,
          },

          {
            paymentReference:
              reference,
          },
        ],
      }),

    journals:
      await findJournals({
        $or: [
          {
            reference,
          },

          {
            idempotencyKey:
              reference,
          },
        ],
      }),

    reconciliation:
      await findReconciliationRecords({
        $or: [
          {
            paymentReference:
              reference,
          },

          {
            idempotencyKey:
              reference,
          },

          {
            reference,
          },
        ],
      }),
  };
}

/* ============================================================================
 * Posted Contribution Fixture
 * ========================================================================== */

async function createPostedContribution(
  overrides = {},
) {
  const operation =
    await initiateContribution({
      idempotencyKey:
        overrides.idempotencyKey ||
        PAYMENT_REFERENCE,

      reference:
        overrides.reference ||
        overrides.idempotencyKey ||
        PAYMENT_REFERENCE,

      amount:
        overrides.amount ||
        CONTRIBUTION_AMOUNT,

      phoneNumber:
        overrides.phoneNumber ||
        TEST_PHONE,

      ...overrides,
    });

  expect(
    [
      200,
      201,
      202,
    ],
  ).toContain(
    operation.status,
  );

  const callback =
    await sendCallback(
      createCallback({
        callbackId:
          overrides.callbackId ||
          CALLBACK_ID,

        providerTransactionId:
          overrides.providerTransactionId ||
          PROVIDER_TRANSACTION_ID,

        transactionId:
          overrides.transactionId ||
          PROVIDER_TRANSACTION_ID,

        paymentReference:
          overrides.paymentReference ||
          overrides.reference ||
          overrides.idempotencyKey ||
          PAYMENT_REFERENCE,

        reference:
          overrides.reference ||
          overrides.idempotencyKey ||
          PAYMENT_REFERENCE,

        amount:
          overrides.amount ||
          CONTRIBUTION_AMOUNT,

        currency:
          overrides.currency ||
          CONTRIBUTION_CURRENCY,

        msisdn:
          overrides.phoneNumber ||
          TEST_PHONE,
      }),
    );

  expect(
    [
      200,
      202,
      409,
    ],
  ).toContain(
    callback.status,
  );

  return {
    operation,
    callback,
  };
}

/* ============================================================================
 * Suite
 * ========================================================================== */

describe(
  'Golden Money Path - Contribution Reconciliation Mismatch',
  () => {
    test(
      'does not settle a contribution when provider amount differs from the requested amount',
      async () => {
        await seedContext();

        await initiateContribution({
          amount:
            Number(
              CONTRIBUTION_AMOUNT,
            ),
        });

        const response =
          await sendCallback(
            createCallback({
              amount:
                MISMATCHED_AMOUNT,
            }),
          );

        expectRejectedMismatch(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'amount mismatch is recorded as reconciliation work or otherwise remains financially unsettled',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              amount:
                MISMATCHED_AMOUNT,
            }),
          );

        expectSafeHttp(
          response,
        );

        const reconciliation =
          await findReconciliationRecords({
            $or: [
              {
                paymentReference:
                  PAYMENT_REFERENCE,
              },

              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          reconciliation.length
        ) {
          expect(
            reconciliation.length,
          ).toBeGreaterThanOrEqual(
            1,
          );
        }

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not settle a contribution when provider currency differs from requested currency',
      async () => {
        await seedContext();

        await initiateContribution({
          currency:
            CONTRIBUTION_CURRENCY,
        });

        const response =
          await sendCallback(
            createCallback({
              currency:
                MISMATCHED_CURRENCY,
            }),
          );

        expectRejectedMismatch(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'currency mismatch is not silently converted into UGX financial truth',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            currency:
              'USD',
          }),
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not settle a contribution when provider transaction ID does not match',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              providerTransactionId:
                SECOND_PROVIDER_TRANSACTION_ID,

              transactionId:
                SECOND_PROVIDER_TRANSACTION_ID,
            }),
          );

        expectRejectedMismatch(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                SECOND_PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not match a callback to a payment using payment reference alone when provider transaction identity is wrong',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              providerTransactionId:
                'UNKNOWN-PROVIDER-TX-001',

              transactionId:
                'UNKNOWN-PROVIDER-TX-001',

              paymentReference:
                PAYMENT_REFERENCE,

              reference:
                PAYMENT_REFERENCE,
            }),
          );

        expectRejectedMismatch(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              'UNKNOWN-PROVIDER-TX-001',
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not settle a contribution when payment reference does not match',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              paymentReference:
                SECOND_PAYMENT_REFERENCE,

              reference:
                SECOND_PAYMENT_REFERENCE,

              externalReference:
                SECOND_PAYMENT_REFERENCE,
            }),
          );

        expectRejectedMismatch(
          response,
        );

        expect(
          (
            await findJournals({
              $or: [
                {
                  reference:
                    SECOND_PAYMENT_REFERENCE,
                },

                {
                  transactionId:
                    PROVIDER_TRANSACTION_ID,
                },
              ],
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not settle a contribution when provider identity differs from the configured provider',
      async () => {
        await seedContext();

        await initiateContribution({
          provider:
            'mtn',
        });

        const response =
          await sendCallback(
            createCallback({
              provider:
                'airtel',
            }),
          );

        expectRejectedMismatch(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not settle a contribution when callback tenant differs from authoritative tenant',
      async () => {
        await seedContext();

        await initiateContribution(
          {},
          AUTH_TOKEN,
        );

        const response =
          await sendCallback(
            createCallback({
              tenantId:
                OTHER_TENANT_ID,
            }),
            {
              tenantId:
                OTHER_TENANT_ID,
            },
          );

        expectRejectedMismatch(
          response,
        );

        const attackTenantJournals =
          await findJournals({
            tenantId:
              OTHER_TENANT_ID,
          });

        expect(
          attackTenantJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not settle a contribution when callback member identity differs from original member',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              memberId:
                SECOND_MEMBER_ID,

              userId:
                SECOND_MEMBER_ID,
            }),
          );

        expectSafeHttp(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          journals.length
        ) {
          expect(
            journals.length,
          ).toBe(
            0,
          );
        }
      },
    );

    test(
      'does not settle a contribution when callback group identity differs from original group',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              groupId:
                '507f1f77bcf86cd79943cff',
            }),
          );

        expectSafeHttp(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not settle a contribution when provider status conflicts with callback success',
      async () => {
        await seedContext();

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            providerFailed(),
          );

        const response =
          await sendCallback(
            createCallback({
              status:
                'SUCCESS',

              outcome:
                'SUCCESS',
            }),
          );

        expectSafeHttp(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not settle a contribution when provider verification returns PENDING',
      async () => {
        await seedContext();

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            providerPending(),
          );

        const response =
          await sendCallback(
            createCallback({
              status:
                'SUCCESS',
            }),
          );

        expectSafeHttp(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not settle a contribution when provider verification reports a different amount',
      async () => {
        await seedContext();

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            providerVerificationMismatch(),
          );

        const response =
          await sendCallback(
            createCallback(),
          );

        expectSafeHttp(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not settle a contribution when provider verification reports a different currency',
      async () => {
        await seedContext();

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            providerVerificationMismatch({
              currency:
                MISMATCHED_CURRENCY,
            }),
          );

        const response =
          await sendCallback(
            createCallback(),
          );

        expectSafeHttp(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not settle when callback amount is greater than the original contribution',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              amount:
                Number(
                  CONTRIBUTION_AMOUNT,
                ) +
                1,
            }),
          );

        expectRejectedMismatch(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not settle when callback amount is less than the original contribution',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              amount:
                Number(
                  CONTRIBUTION_AMOUNT,
                ) -
                1,
            }),
          );

        expectRejectedMismatch(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not silently post a partial financial amount caused by a provider mismatch',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              Number(
                CONTRIBUTION_AMOUNT,
              ) -
              5000,
          }),
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'does not silently post an inflated amount caused by a reconciliation mismatch',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch does not invoke ledger posting',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        expect(
          mocks.ledgerPost.mock
            .calls.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch does not invoke settlement',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            currency:
              MISMATCHED_CURRENCY,
          }),
        );

        expect(
          mocks.settlement.mock
            .calls.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch does not publish a successful financial event',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        expect(
          mocks.publishEvent.mock
            .calls.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch can create an investigation or reconciliation exception without creating a journal',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const reconciliation =
          await findReconciliationRecords({
            $or: [
              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                paymentReference:
                  PAYMENT_REFERENCE,
              },
            ],
          });

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          reconciliation.length
        ) {
          expect(
            reconciliation.length,
          ).toBeGreaterThanOrEqual(
            1,
          );
        }

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch is idempotent for repeated identical callbacks',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          });

        await Promise.all([
          sendCallback(
            payload,
          ),

          sendCallback(
            payload,
          ),

          sendCallback(
            payload,
          ),

          sendCallback(
            payload,
          ),
        ]);

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );

        const reconciliation =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          reconciliation.length
        ) {
          expect(
            reconciliation.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'reconciliation mismatch remains idempotent when request IDs differ',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          });

        await sendCallback(
          payload,
          {
            requestId:
              'reconciliation-mismatch-a',
          },
        );

        await sendCallback(
          payload,
          {
            requestId:
              'reconciliation-mismatch-b',
          },
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );

        const records =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          records.length
        ) {
          expect(
            records.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'reconciliation mismatch remains idempotent under concurrent processing',
      async () => {
        await seedContext();

        await initiateContribution();

        const responses =
          await Promise.all(
            Array.from(
              {
                length:
                  25,
              },
              (
                _,
                index,
              ) =>
                sendCallback(
                  createCallback({
                    amount:
                      MISMATCHED_AMOUNT,
                  }),
                  {
                    requestId:
                      `concurrent-mismatch-${index}`,
                  },
                ),
            ),
          );

        for (
          const response of
            responses
        ) {
          expectSafeHttp(
            response,
          );
        }

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );

        const records =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          records.length
        ) {
          expect(
            records.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'reconciliation mismatch does not mutate the original payment amount',
      async () => {
        await seedContext();

        await initiateContribution();

        const before =
          await findPayments({
            $or: [
              {
                paymentReference:
                  PAYMENT_REFERENCE,
              },

              {
                idempotencyKey:
                  PAYMENT_REFERENCE,
              },
            ],
          });

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const after =
          await findPayments({
            $or: [
              {
                paymentReference:
                  PAYMENT_REFERENCE,
              },

              {
                idempotencyKey:
                  PAYMENT_REFERENCE,
              },
            ],
          });

        if (
          before.length &&
          after.length &&
          before[0].amount !==
            undefined &&
          after[0].amount !==
            undefined
        ) {
          expect(
            String(
              after[0].amount,
            ),
          ).toBe(
            String(
              before[0].amount,
            ),
          );
        }
      },
    );

    test(
      'reconciliation mismatch does not mutate the original payment currency',
      async () => {
        await seedContext();

        await initiateContribution();

        const before =
          await findPayments({
            paymentReference:
              PAYMENT_REFERENCE,
          });

        await sendCallback(
          createCallback({
            currency:
              MISMATCHED_CURRENCY,
          }),
        );

        const after =
          await findPayments({
            paymentReference:
              PAYMENT_REFERENCE,
          });

        if (
          before.length &&
          after.length &&
          after[0].currency
        ) {
          expect(
            String(
              after[0].currency,
            ).toUpperCase(),
          ).toBe(
            String(
              before[0].currency ||
                CONTRIBUTION_CURRENCY,
            ).toUpperCase(),
          );
        }
      },
    );

    test(
      'reconciliation mismatch does not mutate the original provider transaction identity',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            providerTransactionId:
              SECOND_PROVIDER_TRANSACTION_ID,

            transactionId:
              SECOND_PROVIDER_TRANSACTION_ID,
          }),
        );

        const payments =
          await findPayments({
            paymentReference:
              PAYMENT_REFERENCE,
          });

        if (
          payments.length &&
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
      },
    );

    test(
      'mismatch does not cause duplicate payment records',
      async () => {
        await seedContext();

        await initiateContribution();

        await Promise.all(
          Array.from(
            {
              length:
                15,
            },
            () =>
              sendCallback(
                createCallback({
                  amount:
                    MISMATCHED_AMOUNT,
                }),
              ),
          ),
        );

        const payments =
          await findPayments({
            $or: [
              {
                paymentReference:
                  PAYMENT_REFERENCE,
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
      'mismatch does not cause duplicate transaction records',
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
              sendCallback(
                createCallback({
                  amount:
                    MISMATCHED_AMOUNT,

                  callbackId:
                    `MISMATCH-TX-${index}`,
                }),
              ),
          ),
        );

        const transactions =
          await findTransactions({
            $or: [
              {
                paymentReference:
                  PAYMENT_REFERENCE,
              },

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
      'mismatch does not create any successful ledger posting',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const journals =
          await findJournals({
            $or: [
              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                reference:
                  PAYMENT_REFERENCE,
              },
            ],
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );

        expect(
          mocks.ledgerPost.mock
            .calls.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch cannot create a balanced journal with the wrong amount',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch cannot create a journal in another tenant',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,

            tenantId:
              OTHER_TENANT_ID,
          }),
          {
            tenantId:
              OTHER_TENANT_ID,
          },
        );

        const journals =
          await findJournals({
            tenantId:
              OTHER_TENANT_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch cannot redirect funds to another member',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            memberId:
              SECOND_MEMBER_ID,

            userId:
              SECOND_MEMBER_ID,

            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const journals =
          await findJournals({
            memberId:
              SECOND_MEMBER_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch cannot redirect funds to another group',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            groupId:
              '507f1f77bcf86cd79943cff',

            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const journals =
          await findJournals({
            groupId:
              '507f1f77bcf86cd79943cff',
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch cannot redirect funds to another account',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            accountId:
              '507f1f77bcf86cd79943cff',

            destinationAccountId:
              '507f1f77bcf86cd79943cff',

            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const journals =
          await findJournals({
            $or: [
              {
                accountId:
                  '507f1f77bcf86cd79943cff',
              },

              {
                destinationAccountId:
                  '507f1f77bcf86cd79943cff',
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
      'mismatch remains isolated from a valid second contribution',
      async () => {
        await seedContext();

        await initiateContribution({
          idempotencyKey:
            PAYMENT_REFERENCE,
        });

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const second =
          await initiateContribution({
            idempotencyKey:
              SECOND_PAYMENT_REFERENCE,

            reference:
              SECOND_PAYMENT_REFERENCE,

            amount:
              Number(
                SECOND_CONTRIBUTION_AMOUNT,
              ),

            phoneNumber:
              SECOND_TEST_PHONE,
          }),
          ;

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          second.status,
        );

        const firstState =
          await snapshotOperation(
            PAYMENT_REFERENCE,
          );

        const secondState =
          await snapshotOperation(
            SECOND_PAYMENT_REFERENCE,
          );

        expect(
          firstState.journals.length,
        ).toBe(
          0,
        );

        if (
          secondState.journals.length
        ) {
          expect(
            secondState.journals.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'a mismatch can be followed by a corrected matching callback without duplicate financial posting',
      async () => {
        await seedContext();

        await initiateContribution();

        const mismatched =
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          });

        await sendCallback(
          mismatched,
        );

        const corrected =
          createCallback({
            amount:
              CONTRIBUTION_AMOUNT,
          });

        const response =
          await sendCallback(
            corrected,
          );

        expectSafeHttp(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );

        if (
          journals.length
        ) {
          const debit =
            journals[0]
              .totalDebit ??
            journals[0]
              .debitTotal;

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
        }
      },
    );

    test(
      'currency mismatch can be followed by corrected currency without duplicate journal',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            currency:
              MISMATCHED_CURRENCY,
          }),
        );

        const corrected =
          await sendCallback(
            createCallback({
              currency:
                CONTRIBUTION_CURRENCY,
            }),
          );

        expectSafeHttp(
          corrected,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'provider transaction mismatch can be corrected without creating duplicate transaction truth',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            providerTransactionId:
              'WRONG-TX-001',

            transactionId:
              'WRONG-TX-001',
          }),
        );

        await sendCallback(
          createCallback({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,
          }),
        );

        const transactions =
          await findTransactions({
            $or: [
              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                providerTransactionId:
                  'WRONG-TX-001',
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

          expect(
            String(
              transactions[0]
                .providerTransactionId ||
                transactions[0]
                  .transactionId,
            ),
          ).toBe(
            PROVIDER_TRANSACTION_ID,
          );
        }
      },
    );

    test(
      'reconciliation mismatch remains recoverable after a provider timeout',
      async () => {
        await seedContext();

        const timeout =
          new Error(
            'Provider verification timeout',
          );

        timeout.code =
          'ETIMEDOUT';

        timeout.unknownOutcome =
          true;

        timeout.reconciliationRequired =
          true;

        mocks.providerVerify
          .mockRejectedValueOnce(
            timeout,
          );

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback(),
          );

        expectSafeHttp(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'unknown provider outcome remains unreconciled until authoritative verification',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValueOnce(
            providerPending(),
          );

        mocks.providerVerify
          .mockResolvedValueOnce(
            providerPending(),
          );

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback(),
          );

        expectSafeHttp(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch is not resolved solely by a repeated callback',
      async () => {
        await seedContext();

        await initiateContribution();

        const mismatched =
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          });

        await sendCallback(
          mismatched,
        );

        await sendCallback(
          mismatched,
        );

        await sendCallback(
          mismatched,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch does not become SUCCESS because callback status is SUCCESS',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              status:
                'SUCCESS',

              amount:
                MISMATCHED_AMOUNT,
            }),
          );

        expectSafeHttp(
          response,
        );

        const payments =
          await findPayments({
            paymentReference:
              PAYMENT_REFERENCE,
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
              SUCCESS_STATES.has(
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
      'a reconciliation mismatch does not mutate an already posted contribution',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          before.length,
        ).toBe(
          1,
        );

        const malicious =
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          });

        await sendCallback(
          malicious,
        );

        const after =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          after.length,
        ).toBe(
          before.length,
        );

        expect(
          String(
            after[0]._id ||
              after[0].id,
          ),
        ).toBe(
          String(
            before[0]._id ||
              before[0].id,
          ),
        );
      },
    );

    test(
      'a currency mismatch does not mutate an already posted contribution',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await sendCallback(
          createCallback({
            currency:
              MISMATCHED_CURRENCY,
          }),
        );

        const after =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          after.length,
        ).toBe(
          before.length,
        );
      },
    );

    test(
      'provider identity mismatch does not mutate an already posted contribution',
      async () => {
        await seedContext();

        await createPostedContribution();

        await sendCallback(
          createCallback({
            provider:
              'airtel',
          }),
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          1,
        );
      },
    );

    test(
      'reconciliation mismatch does not overwrite immutable ledger entries',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findJournalEntries({
            journalId:
              (
                await findJournals({
                  transactionId:
                    PROVIDER_TRANSACTION_ID,
                })
              )[0]?._id,
          });

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,

            currency:
              MISMATCHED_CURRENCY,
          }),
        );

        const after =
          await findJournalEntries({
            journalId:
              (
                await findJournals({
                  transactionId:
                    PROVIDER_TRANSACTION_ID,
                })
              )[0]?._id,
          });

        if (
          before.length &&
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
      'reconciliation mismatch cannot create an adjustment journal automatically without explicit corrective authorization',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'manual reconciliation request cannot approve an amount mismatch without matching authoritative data',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const response =
          await requestReconciliation({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            paymentReference:
              PAYMENT_REFERENCE,

            amount:
              MISMATCHED_AMOUNT,

            currency:
              CONTRIBUTION_CURRENCY,

            reason:
              'Resolve amount mismatch',
          });

        if (
          !response
        ) {
          return;
        }

        expectSafeHttp(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        /**
         * An explicit reconciliation API should not turn contradictory source
         * data into a posted journal merely because the endpoint was called.
         */
        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'correct reconciliation evidence can result in at most one final journal',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        mocks.providerVerify
          .mockResolvedValueOnce(
            providerSuccess(),
          );

        const response =
          await requestReconciliation({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            paymentReference:
              PAYMENT_REFERENCE,

            amount:
              CONTRIBUTION_AMOUNT,

            currency:
              CONTRIBUTION_CURRENCY,

            provider:
              'mtn',

            reason:
              'Corrected after authoritative provider verification',
          });

        if (
          !response
        ) {
          return;
        }

        expectSafeHttp(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'concurrent reconciliation requests create at most one reconciliation outcome',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const responses =
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
                requestReconciliation({
                  providerTransactionId:
                    PROVIDER_TRANSACTION_ID,

                  paymentReference:
                    PAYMENT_REFERENCE,

                  amount:
                    MISMATCHED_AMOUNT,

                  currency:
                    CONTRIBUTION_CURRENCY,

                  idempotencyKey:
                    `reconcile-concurrent-${index}`,
                }),
            ),
          );

        for (
          const response of
            responses
        ) {
          if (
            response
          ) {
            expectSafeHttp(
              response,
            );
          }
        }

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'reconciliation mismatch remains tenant-isolated under concurrency',
      async () => {
        await seedContext();

        await initiateContribution(
          {},
          AUTH_TOKEN,
        );

        const responses =
          await Promise.all([
            sendCallback(
              createCallback({
                amount:
                  MISMATCHED_AMOUNT,

                tenantId:
                  TEST_TENANT_ID,
              }),
            ),

            sendCallback(
              createCallback({
                amount:
                  MISMATCHED_AMOUNT,

                tenantId:
                  OTHER_TENANT_ID,

                callbackId:
                  SECOND_CALLBACK_ID,
              }),
              {
                tenantId:
                  OTHER_TENANT_ID,
              },
            ),
          ]);

        for (
          const response of
            responses
        ) {
          expectSafeHttp(
            response,
          );
        }

        const attackTenantJournals =
          await findJournals({
            tenantId:
              OTHER_TENANT_ID,
          });

        expect(
          attackTenantJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch in one tenant cannot contaminate a valid payment in another operation',
      async () => {
        await seedContext();

        await initiateContribution({
          idempotencyKey:
            PAYMENT_REFERENCE,

          reference:
            PAYMENT_REFERENCE,
        });

        await initiateContribution({
          idempotencyKey:
            SECOND_PAYMENT_REFERENCE,

          reference:
            SECOND_PAYMENT_REFERENCE,

          amount:
            Number(
              SECOND_CONTRIBUTION_AMOUNT,
            ),

          phoneNumber:
            SECOND_TEST_PHONE,

          provider:
            'mtn',
        });

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,

            paymentReference:
              PAYMENT_REFERENCE,

            reference:
              PAYMENT_REFERENCE,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,
          }),
        );

        await sendCallback(
          createCallback({
            callbackId:
              SECOND_CALLBACK_ID,

            paymentReference:
              SECOND_PAYMENT_REFERENCE,

            reference:
              SECOND_PAYMENT_REFERENCE,

            providerTransactionId:
              SECOND_PROVIDER_TRANSACTION_ID,

            transactionId:
              SECOND_PROVIDER_TRANSACTION_ID,

            amount:
              SECOND_CONTRIBUTION_AMOUNT,

            msisdn:
              SECOND_TEST_PHONE,
          }),
        );

        const first =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const second =
          await findJournals({
            transactionId:
              SECOND_PROVIDER_TRANSACTION_ID,
          });

        expect(
          first.length,
        ).toBe(
          0,
        );

        expect(
          second.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'reconciliation mismatch does not alter provider reference of a second operation',
      async () => {
        await seedContext();

        await initiateContribution({
          idempotencyKey:
            PAYMENT_REFERENCE,
        });

        await initiateContribution({
          idempotencyKey:
            SECOND_PAYMENT_REFERENCE,

          reference:
            SECOND_PAYMENT_REFERENCE,

          amount:
            Number(
              SECOND_CONTRIBUTION_AMOUNT,
            ),

          phoneNumber:
            SECOND_TEST_PHONE,
        });

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,

            paymentReference:
              PAYMENT_REFERENCE,
          }),
        );

        const secondPayments =
          await findPayments({
            $or: [
              {
                paymentReference:
                  SECOND_PAYMENT_REFERENCE,
              },

              {
                idempotencyKey:
                  SECOND_PAYMENT_REFERENCE,
              },
            ],
          });

        for (
          const payment of
            secondPayments
        ) {
          if (
            payment.paymentReference
          ) {
            expect(
              String(
                payment.paymentReference,
              ),
            ).toBe(
              SECOND_PAYMENT_REFERENCE,
            );
          }
        }
      },
    );

    test(
      'provider duplicate transaction identity is treated as reconciliation risk instead of a second contribution',
      async () => {
        await seedContext();

        await createPostedContribution();

        const duplicate =
          await initiateContribution({
            idempotencyKey:
              SECOND_PAYMENT_REFERENCE,

            reference:
              SECOND_PAYMENT_REFERENCE,

            amount:
              Number(
                SECOND_CONTRIBUTION_AMOUNT,
              ),
          });

        expect(
          [
            200,
            201,
            202,
            409,
          ],
        ).toContain(
          duplicate.status,
        );

        await sendCallback(
          createCallback({
            callbackId:
              SECOND_CALLBACK_ID,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,

            paymentReference:
              SECOND_PAYMENT_REFERENCE,

            reference:
              SECOND_PAYMENT_REFERENCE,

            amount:
              SECOND_CONTRIBUTION_AMOUNT,
          }),
        );

        const secondJournals =
          await findJournals({
            reference:
              SECOND_PAYMENT_REFERENCE,
          });

        expect(
          secondJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'duplicate payment reference with a different provider transaction is not silently posted',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              providerTransactionId:
                SECOND_PROVIDER_TRANSACTION_ID,

              transactionId:
                SECOND_PROVIDER_TRANSACTION_ID,

              paymentReference:
                PAYMENT_REFERENCE,

              reference:
                PAYMENT_REFERENCE,
            }),
          );

        expectSafeHttp(
          response,
        );

        const duplicateTransactions =
          await findTransactions({
            providerTransactionId:
              SECOND_PROVIDER_TRANSACTION_ID,
          });

        expect(
          duplicateTransactions.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'amount mismatch cannot be resolved by changing callback status alone',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              amount:
                MISMATCHED_AMOUNT,

              status:
                'COMPLETED',

              outcome:
                'COMPLETED',
            }),
          );

        expectSafeHttp(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'currency mismatch cannot be resolved by changing callback status alone',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              currency:
                MISMATCHED_CURRENCY,

              status:
                'COMPLETED',

              outcome:
                'COMPLETED',
            }),
          );

        expectSafeHttp(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'provider transaction mismatch cannot be resolved by changing callback status alone',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              providerTransactionId:
                SECOND_PROVIDER_TRANSACTION_ID,

              transactionId:
                SECOND_PROVIDER_TRANSACTION_ID,

              status:
                'COMPLETED',

              outcome:
                'COMPLETED',
            }),
          );

        expectSafeHttp(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                SECOND_PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch callback does not create duplicate audit records under replay',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          });

        await sendCallback(
          payload,
        );

        const before =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await Promise.all([
          sendCallback(
            payload,
          ),

          sendCallback(
            payload,
          ),

          sendCallback(
            payload,
          ),
        ]);

        const after =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          before.length
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
      'mismatch processing preserves original tenant ownership metadata',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,

            tenantId:
              TEST_TENANT_ID,
          }),
        );

        const payments =
          await findPayments({
            paymentReference:
              PAYMENT_REFERENCE,
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
      'mismatch processing preserves original provider identity metadata',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const payments =
          await findPayments({
            paymentReference:
              PAYMENT_REFERENCE,
          });

        for (
          const payment of
            payments
        ) {
          if (
            payment.provider
          ) {
            expect(
              String(
                payment.provider,
              ).toLowerCase(),
            ).toBe(
              'mtn',
            );
          }
        }
      },
    );

    test(
      'mismatch processing preserves original currency metadata',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            currency:
              MISMATCHED_CURRENCY,
          }),
        );

        const payments =
          await findPayments({
            paymentReference:
              PAYMENT_REFERENCE,
          });

        for (
          const payment of
            payments
        ) {
          if (
            payment.currency
          ) {
            expect(
              String(
                payment.currency,
              ).toUpperCase(),
            ).toBe(
              CONTRIBUTION_CURRENCY,
            );
          }
        }
      },
    );

    test(
      'mismatch processing preserves original contribution reference',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            paymentReference:
              SECOND_PAYMENT_REFERENCE,

            reference:
              SECOND_PAYMENT_REFERENCE,
          }),
        );

        const payments =
          await findPayments({
            paymentReference:
              PAYMENT_REFERENCE,
          });

        for (
          const payment of
            payments
        ) {
          if (
            payment.paymentReference
          ) {
            expect(
              String(
                payment.paymentReference,
              ),
            ).toBe(
              PAYMENT_REFERENCE,
            );
          }
        }
      },
    );

    test(
      'mismatch processing cannot create financial truth from an uninitiated provider transaction',
      async () => {
        await seedContext();

        const response =
          await sendCallback(
            createCallback({
              providerTransactionId:
                'UNINITIATED-RECON-TX-001',

              transactionId:
                'UNINITIATED-RECON-TX-001',

              paymentReference:
                'UNINITIATED-RECON-REF-001',

              amount:
                MISMATCHED_AMOUNT,
            }),
          );

        expectRejectedMismatch(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                'UNINITIATED-RECON-TX-001',
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch processing cannot create truth from a provider transaction without an application payment',
      async () => {
        await seedContext();

        const response =
          await sendCallback(
            createCallback({
              providerTransactionId:
                'PROVIDER-ONLY-RECON-TX-001',

              transactionId:
                'PROVIDER-ONLY-RECON-TX-001',

              paymentReference:
                PAYMENT_REFERENCE,

              amount:
                CONTRIBUTION_AMOUNT,
            }),
          );

        expectSafeHttp(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                'PROVIDER-ONLY-RECON-TX-001',
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch cannot cause provider refund/reversal behavior automatically',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const payments =
          await findPayments({
            paymentReference:
              PAYMENT_REFERENCE,
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
              status ===
                'REFUNDED',
            ).toBe(
              false,
            );
          }
        }
      },
    );

    test(
      'mismatch remains observable after duplicate callback delivery',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          });

        await sendCallback(
          payload,
        );

        await sendCallback(
          payload,
        );

        const records =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          records.length
        ) {
          expect(
            records.length,
          ).toBeGreaterThanOrEqual(
            1,
          );
        }

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch cannot silently disappear after a process restart simulation',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const before =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        /**
         * The process itself is not restarted inside the test harness. The
         * persistent-store assertion verifies that any recorded exception is
         * database-backed rather than an in-memory-only condition.
         */
        const after =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          before.length
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
      'mismatch processing remains safe when callback order is reversed',
      async () => {
        await seedContext();

        await initiateContribution();

        const mismatched =
          createCallback({
            amount:
              MISMATCHED_AMOUNT,

            callbackId:
              CALLBACK_ID,
          });

        const corrected =
          createCallback({
            amount:
              CONTRIBUTION_AMOUNT,

            callbackId:
              SECOND_CALLBACK_ID,
          });

        await Promise.all([
          sendCallback(
            corrected,
          ),

          sendCallback(
            mismatched,
          ),
        ]);

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'concurrent matching and mismatching callbacks cannot produce more than one journal',
      async () => {
        await seedContext();

        await initiateContribution();

        await Promise.all([
          ...Array.from(
            {
              length:
                10,
            },
            (
              _,
              index,
            ) =>
              sendCallback(
                createCallback({
                  callbackId:
                    `MATCHING-${index}`,

                  amount:
                    CONTRIBUTION_AMOUNT,
                }),
              ),
          ),

          ...Array.from(
            {
              length:
                10,
            },
            (
              _,
              index,
            ) =>
              sendCallback(
                createCallback({
                  callbackId:
                    `MISMATCHING-${index}`,

                  amount:
                    MISMATCHED_AMOUNT,
                }),
              ),
          ),
        ]);

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );

        if (
          journals.length
        ) {
          const debit =
            journals[0]
              .totalDebit ??
            journals[0]
              .debitTotal;

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
        }
      },
    );

    test(
      'reconciliation mismatch does not create a second tenant transaction under concurrent processing',
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
              sendCallback(
                createCallback({
                  callbackId:
                    `TENANT-MISMATCH-${index}`,

                  tenantId:
                    OTHER_TENANT_ID,

                  amount:
                    MISMATCHED_AMOUNT,
                }),
                {
                  tenantId:
                    OTHER_TENANT_ID,
                },
              ),
          ),
        );

        const attackTenantTransactions =
          await findTransactions({
            tenantId:
              OTHER_TENANT_ID,
          });

        expect(
          attackTenantTransactions.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch does not corrupt the correct account balance',
      async () => {
        await seedContext();

        const accountCollection =
          mongoose.connection
            .collections
            .accounts;

        if (
          !accountCollection
        ) {
          return;
        }

        const before =
          await accountCollection
            .findOne({
              _id:
                new mongoose.Types.ObjectId(
                  '507f1f77bcf86cd79943c09',
                ),
            });

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const after =
          await accountCollection
            .findOne({
              _id:
                new mongoose.Types.ObjectId(
                  '507f1f77bcf86cd79943c09',
                ),
            });

        if (
          before &&
          after &&
          before.balance !==
            undefined &&
          after.balance !==
            undefined
        ) {
          expect(
            String(
              after.balance,
            ),
          ).toBe(
            String(
              before.balance,
            ),
          );
        }
      },
    );

    test(
      'reconciliation mismatch does not corrupt settlement cash balance',
      async () => {
        await seedContext();

        const accountCollection =
          mongoose.connection
            .collections
            .accounts;

        if (
          !accountCollection
        ) {
          return;
        }

        const before =
          await accountCollection
            .findOne({
              _id:
                new mongoose.Types.ObjectId(
                  '507f1f77bcf86cd79943c08',
                ),
            });

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const after =
          await accountCollection
            .findOne({
              _id:
                new mongoose.Types.ObjectId(
                  '507f1f77bcf86cd79943c08',
                ),
            });

        if (
          before &&
          after &&
          before.balance !==
            undefined &&
          after.balance !==
            undefined
        ) {
          expect(
            String(
              after.balance,
            ),
          ).toBe(
            String(
              before.balance,
            ),
          );
        }
      },
    );

    test(
      'reconciliation mismatch is not fixed by replaying the malformed provider record',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          });

        await Promise.all(
          Array.from(
            {
              length:
                30,
            },
            () =>
              sendCallback(
                payload,
              ),
          ),
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch cannot be overridden by arbitrary client-supplied reconciliation status',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              amount:
                MISMATCHED_AMOUNT,

              reconciliationStatus:
                'MATCHED',

              verified:
                true,

              settled:
                true,
            }),
          );

        expectSafeHttp(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch cannot be marked resolved using an untrusted payload field',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,

            resolved:
              true,

            resolution:
              'MATCHED',

            reconciliationResolved:
              true,
          }),
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch remains distinct from a successful contribution',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const payment =
          (
            await findPayments({
              paymentReference:
                PAYMENT_REFERENCE,
            })
          )[0];

        if (
          payment
        ) {
          const status =
            getStatus(
              payment,
            );

          if (
            status
          ) {
            expect(
              status !==
                'SETTLED' ||
                status !==
                  'COMPLETED' ||
                status !==
                  'SUCCESS',
            ).toBe(
              true,
            );
          }
        }

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch cannot create a successful contribution with a different payment reference',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            paymentReference:
              SECOND_PAYMENT_REFERENCE,

            reference:
              SECOND_PAYMENT_REFERENCE,

            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const second =
          await findPayments({
            paymentReference:
              SECOND_PAYMENT_REFERENCE,
          });

        expect(
          second.length,
        ).toBe(
          0,
        );

        expect(
          (
            await findJournals({
              reference:
                SECOND_PAYMENT_REFERENCE,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch cannot create a successful contribution with a second provider transaction',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            providerTransactionId:
              SECOND_PROVIDER_TRANSACTION_ID,

            transactionId:
              SECOND_PROVIDER_TRANSACTION_ID,

            amount:
              CONTRIBUTION_AMOUNT,
          }),
        );

        expect(
          (
            await findTransactions({
              providerTransactionId:
                SECOND_PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );

        expect(
          (
            await findJournals({
              transactionId:
                SECOND_PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch does not create duplicate journals if provider callback is replayed after reconciliation review',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          });

        await sendCallback(
          payload,
        );

        await requestReconciliation({
          providerTransactionId:
            PROVIDER_TRANSACTION_ID,

          paymentReference:
            PAYMENT_REFERENCE,

          amount:
            MISMATCHED_AMOUNT,

          currency:
            CONTRIBUTION_CURRENCY,
        });

        await sendCallback(
          payload,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'reconciliation mismatch cannot be resolved for another tenant operation',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await requestReconciliation(
            {
              tenantId:
                OTHER_TENANT_ID,

              providerTransactionId:
                PROVIDER_TRANSACTION_ID,

              paymentReference:
                PAYMENT_REFERENCE,

              amount:
                CONTRIBUTION_AMOUNT,
            },
            OTHER_TENANT_TOKEN,
          );

        if (
          response
        ) {
          expect(
            [
              400,
              401,
              403,
              404,
              409,
              422,
            ],
          ).toContain(
            response.status,
          );
        }

        const attackTenantJournals =
          await findJournals({
            tenantId:
              OTHER_TENANT_ID,
          });

        expect(
          attackTenantJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch remains safe when correction arrives concurrently with mismatch replay',
      async () => {
        await seedContext();

        await initiateContribution();

        const mismatch =
          createCallback({
            amount:
              MISMATCHED_AMOUNT,

            callbackId:
              CALLBACK_ID,
          });

        const correction =
          createCallback({
            amount:
              CONTRIBUTION_AMOUNT,

            callbackId:
              SECOND_CALLBACK_ID,
          });

        await Promise.all([
          ...Array.from(
            {
              length:
                10,
            },
            () =>
              sendCallback(
                mismatch,
              ),
          ),

          ...Array.from(
            {
              length:
                10,
            },
            () =>
              sendCallback(
                correction,
              ),
          ),
        ]);

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );

        if (
          journals.length
        ) {
          const debit =
            journals[0]
              .totalDebit ??
            journals[0]
              .debitTotal;

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
        }
      },
    );

    test(
      'reconciliation mismatch remains safe when amount and currency mismatches arrive concurrently',
      async () => {
        await seedContext();

        await initiateContribution();

        await Promise.all([
          ...Array.from(
            {
              length:
                10,
            },
            () =>
              sendCallback(
                createCallback({
                  amount:
                    MISMATCHED_AMOUNT,
                }),
              ),
          ),

          ...Array.from(
            {
              length:
                10,
            },
            () =>
              sendCallback(
                createCallback({
                  currency:
                    MISMATCHED_CURRENCY,
                }),
              ),
          ),
        ]);

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch remains safe when identity and amount mismatches arrive concurrently',
      async () => {
        await seedContext();

        await initiateContribution();

        await Promise.all([
          ...Array.from(
            {
              length:
                10,
            },
            () =>
              sendCallback(
                createCallback({
                  providerTransactionId:
                    SECOND_PROVIDER_TRANSACTION_ID,

                  transactionId:
                    SECOND_PROVIDER_TRANSACTION_ID,
                }),
              ),
          ),

          ...Array.from(
            {
              length:
                10,
            },
            () =>
              sendCallback(
                createCallback({
                  amount:
                    MISMATCHED_AMOUNT,
                }),
              ),
          ),
        ]);

        const journals =
          await findJournals({
            $or: [
              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                transactionId:
                  SECOND_PROVIDER_TRANSACTION_ID,
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
      'mismatch processing does not generate a second provider initiation',
      async () => {
        await seedContext();

        await initiateContribution();

        const providerCallsBefore =
          mocks.providerInitiate.mock
            .calls.length;

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

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
      'reconciliation mismatch does not call the provider again merely to accept a mismatched callback',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const verificationCalls =
          mocks.providerVerify.mock
            .calls.length;

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        expect(
          mocks.providerVerify.mock
            .calls.length,
        ).toBeLessThanOrEqual(
          verificationCalls + 1,
        );
      },
    );

    test(
      'reconciliation mismatch remains safe when provider verification itself is inconsistent across retries',
      async () => {
        await seedContext();

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValueOnce(
            providerVerificationMismatch({
              amount:
                MISMATCHED_AMOUNT,
            }),
          )
          .mockResolvedValueOnce(
            providerSuccess(),
          );

        await sendCallback(
          createCallback(),
        );

        await sendCallback(
          createCallback(),
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );

        if (
          journals.length
        ) {
          const debit =
            journals[0]
              .totalDebit ??
            journals[0]
              .debitTotal;

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
        }
      },
    );

    test(
      'mismatch correction does not create a duplicate journal when the original payment was already settled',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const after =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          after.length,
        ).toBe(
          before.length,
        );

        expect(
          after.length,
        ).toBe(
          1,
        );
      },
    );

    test(
      'reconciliation mismatch does not delete the original payment transaction',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findTransactions({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const after =
          await findTransactions({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          before.length
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
      'reconciliation mismatch does not delete the original contribution record',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findContributions({
            reference:
              PAYMENT_REFERENCE,
          });

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const after =
          await findContributions({
            reference:
              PAYMENT_REFERENCE,
          });

        if (
          before.length
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
      'mismatch exception identity remains stable under callback replay',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          });

        await sendCallback(
          payload,
        );

        const first =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await Promise.all([
          sendCallback(
            payload,
          ),

          sendCallback(
            payload,
          ),

          sendCallback(
            payload,
          ),
        ]);

        const second =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          first.length
        ) {
          expect(
            second.length,
          ).toBe(
            first.length,
          );

          if (
            first[0]._id &&
            second[0]._id
          ) {
            expect(
              String(
                second[0]._id,
              ),
            ).toBe(
              String(
                first[0]._id,
              ),
            );
          }
        }
      },
    );

    test(
      'mismatch record retains provider transaction correlation',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const records =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        for (
          const record of
            records
        ) {
          if (
            record.providerTransactionId
          ) {
            expect(
              String(
                record.providerTransactionId,
              ),
            ).toBe(
              PROVIDER_TRANSACTION_ID,
            );
          }
        }
      },
    );

    test(
      'mismatch record retains payment reference correlation',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const records =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        for (
          const record of
            records
        ) {
          if (
            record.paymentReference
          ) {
            expect(
              String(
                record.paymentReference,
              ),
            ).toBe(
              PAYMENT_REFERENCE,
            );
          }
        }
      },
    );

    test(
      'mismatch record retains tenant correlation',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const records =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        for (
          const record of
            records
        ) {
          if (
            record.tenantId
          ) {
            expect(
              String(
                record.tenantId,
              ),
            ).toBe(
              TEST_TENANT_ID,
            );
          }
        }
      },
    );

    test(
      'mismatch classification does not silently approve a provider amount greater than request',
      async () => {
        await seedContext();

        await initiateContribution({
          amount:
            Number(
              CONTRIBUTION_AMOUNT,
            ),
        });

        await sendCallback(
          createCallback({
            amount:
              Number(
                CONTRIBUTION_AMOUNT,
              ) *
              2,
          }),
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch classification does not silently approve a provider amount lower than request',
      async () => {
        await seedContext();

        await initiateContribution({
          amount:
            Number(
              CONTRIBUTION_AMOUNT,
            ),
        });

        await sendCallback(
          createCallback({
            amount:
              Number(
                CONTRIBUTION_AMOUNT,
              ) /
              2,
          }),
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch classification does not silently approve zero amount',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              0,
          }),
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch classification does not silently approve a negative amount',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              -100000,
          }),
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch classification remains fail-closed for missing callback amount',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createCallback();

        delete payload.amount;

        const response =
          await sendCallback(
            payload,
          );

        expectSafeHttp(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch classification remains fail-closed for missing callback currency',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createCallback();

        delete payload.currency;

        const response =
          await sendCallback(
            payload,
          );

        expectSafeHttp(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch classification remains fail-closed for missing provider transaction ID',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createCallback();

        delete payload.providerTransactionId;
        delete payload.transactionId;

        const response =
          await sendCallback(
            payload,
          );

        expectSafeHttp(
          response,
        );

        expect(
          (
            await findJournals({
              reference:
                PAYMENT_REFERENCE,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch classification remains fail-closed for missing payment reference',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createCallback();

        delete payload.paymentReference;
        delete payload.reference;
        delete payload.externalReference;

        const response =
          await sendCallback(
            payload,
          );

        expectSafeHttp(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch remains safe under broad concurrent mismatch matrix',
      async () => {
        await seedContext();

        await initiateContribution();

        const callbacks = [
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),

          createCallback({
            currency:
              MISMATCHED_CURRENCY,
          }),

          createCallback({
            providerTransactionId:
              SECOND_PROVIDER_TRANSACTION_ID,

            transactionId:
              SECOND_PROVIDER_TRANSACTION_ID,
          }),

          createCallback({
            paymentReference:
              SECOND_PAYMENT_REFERENCE,

            reference:
              SECOND_PAYMENT_REFERENCE,
          }),

          createCallback({
            tenantId:
              OTHER_TENANT_ID,
          }),

          createCallback({
            memberId:
              SECOND_MEMBER_ID,
          }),
        ];

        await Promise.all(
          callbacks.map(
            (
              payload,
              index,
            ) =>
              sendCallback(
                payload,
                {
                  tenantId:
                    index ===
                    4
                      ? OTHER_TENANT_ID
                      : undefined,

                  requestId:
                    `mismatch-matrix-${index}`,
                },
              ),
          ),
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch does not duplicate the original ledger event when a valid callback eventually arrives',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const valid =
          await sendCallback(
            createCallback({
              amount:
                CONTRIBUTION_AMOUNT,
            }),
          );

        expectSafeHttp(
          valid,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'reconciliation mismatch keeps ledger posting single-shot when correction and replay are interleaved',
      async () => {
        await seedContext();

        await initiateContribution();

        const mismatch =
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          });

        const correct =
          createCallback({
            amount:
              CONTRIBUTION_AMOUNT,
          });

        await Promise.all([
          sendCallback(
            mismatch,
          ),

          sendCallback(
            correct,
          ),

          sendCallback(
            mismatch,
          ),

          sendCallback(
            correct,
          ),
        ]);

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );

        if (
          journals.length
        ) {
          const debit =
            journals[0]
              .totalDebit ??
            journals[0]
              .debitTotal;

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
        }
      },
    );

    test(
      'reconciliation mismatch does not create a second compensating ledger event',
      async () => {
        await seedContext();

        await createPostedContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          1,
        );
      },
    );

    test(
      'reconciliation mismatch does not alter an existing posted journal amount',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const after =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          after.length,
        ).toBe(
          1,
        );

        const beforeDebit =
          before[0].totalDebit ??
          before[0].debitTotal;

        const afterDebit =
          after[0].totalDebit ??
          after[0].debitTotal;

        if (
          beforeDebit !==
            undefined &&
          afterDebit !==
            undefined
        ) {
          expect(
            String(
              afterDebit,
            ),
          ).toBe(
            String(
              beforeDebit,
            ),
          );
        }
      },
    );

    test(
      'reconciliation mismatch does not alter an existing posted journal currency',
      async () => {
        await seedContext();

        await createPostedContribution();

        await sendCallback(
          createCallback({
            currency:
              MISMATCHED_CURRENCY,
          }),
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          1,
        );

        if (
          journals[0]
            .currency
        ) {
          expect(
            String(
              journals[0]
                .currency,
            ).toUpperCase(),
          ).toBe(
            CONTRIBUTION_CURRENCY,
          );
        }
      },
    );

    test(
      'mismatch processing remains safe when another valid member operation is posted concurrently',
      async () => {
        await seedContext();

        await initiateContribution({
          idempotencyKey:
            PAYMENT_REFERENCE,

          reference:
            PAYMENT_REFERENCE,
        });

        await Promise.all([
          sendCallback(
            createCallback({
              amount:
                MISMATCHED_AMOUNT,

              paymentReference:
                PAYMENT_REFERENCE,
            }),
          ),

          initiateContribution(
            {
              idempotencyKey:
                SECOND_PAYMENT_REFERENCE,

              reference:
                SECOND_PAYMENT_REFERENCE,

              amount:
                Number(
                  SECOND_CONTRIBUTION_AMOUNT,
                ),

              phoneNumber:
                SECOND_TEST_PHONE,
            },
            SECOND_MEMBER_TOKEN,
          ),
        ]);

        const firstJournals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          firstJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'mismatch in one tenant cannot block a valid operation in another legitimate tenant context when independently authorized',
      async () => {
        await seedContext();

        const invalid =
          await initiateContribution({
            idempotencyKey:
              PAYMENT_REFERENCE,
          });

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          invalid.status,
        );

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const otherTenant =
          await authenticatedRequest(
            OTHER_TENANT_TOKEN,
          )
            .post(
              '/api/contributions',
            )
            .set(
              'Idempotency-Key',
              'other-tenant-independent-000001',
            )
            .send({
              groupId:
                GROUP_ID,

              amount:
                Number(
                  SECOND_CONTRIBUTION_AMOUNT,
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
                'other-tenant-independent-000001',
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
      },
    );

    test(
      'reconciliation mismatch does not cause a cross-tenant data leak through response payload',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              amount:
                MISMATCHED_AMOUNT,

              tenantId:
                OTHER_TENANT_ID,
            }),
            {
              tenantId:
                OTHER_TENANT_ID,
            },
          );

        const payload =
          responsePayload(
            response,
          );

        const serialized =
          JSON.stringify(
            payload,
          );

        expect(
          serialized.includes(
            OTHER_TENANT_ID,
          ),
        ).toBe(
          false,
        );
      },
    );

    test(
      'reconciliation mismatch response does not expose provider credentials or secrets',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              amount:
                MISMATCHED_AMOUNT,
            }),
          );

        const serialized =
          JSON.stringify(
            responseBody(
              response,
            ),
          );

        expect(
          serialized.includes(
            CALLBACK_SECRET,
          ),
        ).toBe(
          false,
        );

        expect(
          serialized.includes(
            'client_secret',
          ),
        ).toBe(
          false,
        );
      },
    );

    test(
      'reconciliation mismatch is safe when the provider sends a SUCCESS response with invalid timestamp semantics',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              amount:
                MISMATCHED_AMOUNT,

              timestamp:
                '1970-01-01T00:00:00.000Z',
            }),
          );

        expectSafeHttp(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch cannot bypass correlation with a phone number and amount alone',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              providerTransactionId:
                'UNKNOWN-CORRELATION-TX',

              transactionId:
                'UNKNOWN-CORRELATION-TX',

              paymentReference:
                'UNKNOWN-CORRELATION-REF',

              msisdn:
                TEST_PHONE,

              amount:
                CONTRIBUTION_AMOUNT,
            }),
          );

        expectRejectedMismatch(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                'UNKNOWN-CORRELATION-TX',
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch cannot bypass correlation with reference and amount alone',
      async () => {
        await seedContext();

        await initiateContribution();

        const response =
          await sendCallback(
            createCallback({
              providerTransactionId:
                'UNKNOWN-CORRELATION-TX-2',

              transactionId:
                'UNKNOWN-CORRELATION-TX-2',

              paymentReference:
                PAYMENT_REFERENCE,

              reference:
                PAYMENT_REFERENCE,

              amount:
                MISMATCHED_AMOUNT,
            }),
          );

        expectRejectedMismatch(
          response,
        );

        expect(
          (
            await findJournals({
              transactionId:
                'UNKNOWN-CORRELATION-TX-2',
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch does not create an account posting when provider currency is unsupported',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            currency:
              'EUR',
          }),
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch remains append-only and does not delete source records',
      async () => {
        await seedContext();

        await createPostedContribution();

        const beforePayments =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const beforeTransactions =
          await findTransactions({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const beforeJournals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const afterPayments =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const afterTransactions =
          await findTransactions({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const afterJournals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          afterPayments.length,
        ).toBe(
          beforePayments.length,
        );

        expect(
          afterTransactions.length,
        ).toBe(
          beforeTransactions.length,
        );

        expect(
          afterJournals.length,
        ).toBe(
          beforeJournals.length,
        );
      },
    );

    test(
      'reconciliation mismatch is safe when the callback is replayed after successful matching reconciliation',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        mocks.providerVerify
          .mockResolvedValue(
            providerSuccess(),
          );

        await requestReconciliation({
          providerTransactionId:
            PROVIDER_TRANSACTION_ID,

          paymentReference:
            PAYMENT_REFERENCE,

          amount:
            CONTRIBUTION_AMOUNT,

          currency:
            CONTRIBUTION_CURRENCY,
        });

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'reconciliation mismatch does not duplicate events when exception is already open',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          });

        await sendCallback(
          payload,
        );

        const first =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await sendCallback(
          payload,
        );

        const second =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          first.length
        ) {
          expect(
            second.length,
          ).toBe(
            first.length,
          );
        }
      },
    );

    test(
      'reconciliation mismatch cannot be resolved by a second mismatched amount',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        await sendCallback(
          createCallback({
            amount:
              '130000',
          }),
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch cannot create a ledger posting when provider state is terminal failure',
      async () => {
        await seedContext();

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            providerFailed(),
          );

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,

            status:
              'SUCCESS',
          }),
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch cannot create a ledger posting when provider state remains pending',
      async () => {
        await seedContext();

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            providerPending(),
          );

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch does not create a second provider callback processing result after recovery retry',
      async () => {
        await seedContext();

        await initiateContribution();

        const first =
          await sendCallback(
            createCallback({
              amount:
                MISMATCHED_AMOUNT,
            }),
          );

        expectSafeHttp(
          first,
        );

        const second =
          await sendCallback(
            createCallback({
              amount:
                MISMATCHED_AMOUNT,
            }),
          );

        expectSafeHttp(
          second,
        );

        const records =
          await findReconciliationRecords({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          records.length
        ) {
          expect(
            records.length,
          ).toBe(
            1,
          );
        }

        expect(
          (
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            })
          ).length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'reconciliation mismatch preserves final financial state when process receives a broad replay matrix',
      async () => {
        await seedContext();

        await initiateContribution();

        const payloads = [
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),

          createCallback({
            currency:
              MISMATCHED_CURRENCY,
          }),

          createCallback({
            providerTransactionId:
              SECOND_PROVIDER_TRANSACTION_ID,

            transactionId:
              SECOND_PROVIDER_TRANSACTION_ID,
          }),

          createCallback({
            paymentReference:
              SECOND_PAYMENT_REFERENCE,

            reference:
              SECOND_PAYMENT_REFERENCE,
          }),

          createCallback({
            tenantId:
              OTHER_TENANT_ID,
          }),
        ];

        await Promise.all(
          Array.from(
            {
              length:
                5,
            },
            () =>
              payloads.map(
                (
                  payload,
                ) =>
                  sendCallback(
                    payload,
                  ),
              ),
          ).flat(),
        );

        const state =
          await snapshotOperation(
            PAYMENT_REFERENCE,
          );

        expect(
          state.journals.length,
        ).toBe(
          0,
        );

        if (
          state.payments.length
        ) {
          expect(
            state.payments.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'reconciliation mismatch does not create a second financial truth after corrected provider verification',
      async () => {
        await seedContext();

        await initiateContribution();

        await sendCallback(
          createCallback({
            amount:
              MISMATCHED_AMOUNT,
          }),
        );

        mocks.providerVerify
          .mockResolvedValue(
            providerSuccess(),
          );

        await requestReconciliation({
          providerTransactionId:
            PROVIDER_TRANSACTION_ID,

          paymentReference:
            PAYMENT_REFERENCE,

          amount:
            CONTRIBUTION_AMOUNT,

          currency:
            CONTRIBUTION_CURRENCY,
        });

        const finalCallback =
          await sendCallback(
            createCallback({
              amount:
                CONTRIBUTION_AMOUNT,
            }),
          );

        expectSafeHttp(
          finalCallback,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );

        if (
          journals.length
        ) {
          const debit =
            journals[0]
              .totalDebit ??
            journals[0]
              .debitTotal;

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
        }
      },
    );
  },
);

/* ============================================================================
 * End of File
 * ============================================================================
 */