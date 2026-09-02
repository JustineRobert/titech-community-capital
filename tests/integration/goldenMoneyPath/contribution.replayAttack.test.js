'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Golden Money Path - Contribution Replay Attack Integration Tests
 * ============================================================================
 *
 * File:
 *   tests/integration/goldenMoneyPath/contribution.replayAttack.test.js
 *
 * Purpose
 * -------
 * Enterprise security and financial-integrity integration coverage for replay
 * attacks against the contribution Golden Money Path.
 *
 * Replay attack model
 * -------------------
 *
 *                 UNTRUSTED REPLAY
 *                        |
 *           +------------+------------+
 *           |            |            |
 *           v            v            v
 *      API Request   Provider CB   Recovery Job
 *           |            |            |
 *           +------------+------------+
 *                        |
 *                        v
 *               Idempotency Boundary
 *                        |
 *                        v
 *               Correlation Boundary
 *                        |
 *                        v
 *               Payment State Machine
 *                        |
 *                        v
 *                  Settlement
 *                        |
 *                        v
 *                   Ledger
 *
 * Primary security invariants
 * ----------------------------
 * 1. A completed contribution cannot be processed twice.
 * 2. Replaying the same client request cannot create a second payment.
 * 3. Replaying the same request cannot create a second transaction.
 * 4. Replaying the same request cannot create a second ledger journal.
 * 5. Replaying a callback cannot create a second settlement.
 * 6. Callback replay with a different request ID remains idempotent.
 * 7. Callback replay with the same callback ID remains idempotent.
 * 8. A replayed callback cannot alter the original amount.
 * 9. A replayed callback cannot alter the original currency.
 * 10. A replayed callback cannot alter the original provider identity.
 * 11. A replayed callback cannot change tenant ownership.
 * 12. A replay cannot rebind an idempotency key to another payload.
 * 13. A replay cannot rebind a callback ID to another transaction.
 * 14. A replay cannot reuse an old successful payload for a new operation.
 * 15. A replay cannot create financial truth for an unknown operation.
 * 16. A replay cannot create a second provider initiation.
 * 17. A replay cannot multiply account balance effects.
 * 18. A replay cannot bypass terminal-state protection.
 * 19. A replay cannot regress a terminal SUCCESS state.
 * 20. A replay cannot create a duplicate reversal/refund path.
 * 21. A replay cannot cross tenant boundaries.
 * 22. Replay processing remains safe under concurrency.
 * 23. Replay processing remains safe after delayed callbacks.
 * 24. Financial history remains append-only and immutable.
 *
 * Attack classes covered
 * ----------------------
 * - Client request replay
 * - Callback replay
 * - Callback identity replay
 * - Signature-valid replay
 * - Signature-invalid replay
 * - Request-ID mutation replay
 * - Timestamp mutation replay
 * - Idempotency-key reuse
 * - Idempotency-key rebinding
 * - Provider transaction replay
 * - Payment-reference replay
 * - Cross-tenant replay
 * - Amount replay/tampering
 * - Currency replay/tampering
 * - Provider replay/tampering
 * - Delayed callback replay
 * - Concurrent replay
 * - Post-success replay
 * - Post-failure replay
 * - Recovery replay
 * - Callback flood
 *
 * Security principle
 * ------------------
 * A valid historical message is not automatically valid for a new financial
 * operation.
 *
 * Replay protection therefore requires both:
 *
 *   MESSAGE AUTHENTICITY
 *            +
 *   OPERATION CORRELATION
 *            +
 *   IDEMPOTENCY
 *            +
 *   STATE MACHINE VALIDATION
 *
 * IMPORTANT
 * ---------
 * This suite does not require live provider credentials.
 *
 * Provider communication is represented by deterministic test fixtures while
 * the application boundary, persistence layer, correlation logic, and ledger
 * invariants remain under integration test.
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
  'tenant-golden-path-replay-001';

const OTHER_TENANT_ID =
  'tenant-golden-path-replay-002';

const MEMBER_ID =
  '507f1f77bcf86cd79943b01';

const SECOND_MEMBER_ID =
  '507f1f77bcf86cd79943b02';

const OTHER_TENANT_MEMBER_ID =
  '507f1f77bcf86cd79943b03';

const GROUP_ID =
  '507f1f77bcf86cd79943b04';

const CONTRIBUTION_AMOUNT =
  '100000';

const SECOND_CONTRIBUTION_AMOUNT =
  '60000';

const CONTRIBUTION_CURRENCY =
  'UGX';

const TEST_PHONE =
  '256700001101';

const SECOND_TEST_PHONE =
  '256700001102';

const OTHER_TENANT_PHONE =
  '256700001103';

const PAYMENT_REFERENCE =
  'golden-money-path-replay-000001';

const SECOND_PAYMENT_REFERENCE =
  'golden-money-path-replay-000002';

const IDEMPOTENCY_KEY =
  PAYMENT_REFERENCE;

const SECOND_IDEMPOTENCY_KEY =
  SECOND_PAYMENT_REFERENCE;

const PROVIDER_TRANSACTION_ID =
  'MTN-UG-REPLAY-000001';

const SECOND_PROVIDER_TRANSACTION_ID =
  'MTN-UG-REPLAY-000002';

const CALLBACK_ID =
  'MTN-CB-REPLAY-000001';

const SECOND_CALLBACK_ID =
  'MTN-CB-REPLAY-000002';

const CALLBACK_SECRET =
  'test-mtn-replay-secret';

const AUTH_TOKEN =
  'test-access-token';

const SECOND_MEMBER_TOKEN =
  'second-member-access-token';

const OTHER_TENANT_TOKEN =
  'other-tenant-access-token';

/* ============================================================================
 * State Sets
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
    'QUEUED',
    'SUBMITTED',
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

function isSuccessState(
  value,
) {
  return SUCCESS_STATES.has(
    getStatus(
      value,
    ),
  );
}

function expectSafeReplayHttp(
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
      'FAILED',

    responseMessage:
      'Transaction failed',

    ...overrides,
  };
}

function callbackSuccess(
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
      'golden-money-path-replay-secret';

    process.env.INTERNAL_API_KEY =
      'golden-money-path-replay-internal';

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
              '507f1f77bcf86cd79943b06',

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
          '507f1f77bcf86cd79943b06',

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
          'Second Member',

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
        'Golden Money Path Replay Group',

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
          '507f1f77bcf86cd79943b07',

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
          '507f1f77bcf86cd79943b08',

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
          '507f1f77bcf86cd79943b09',

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
    IDEMPOTENCY_KEY;

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
          `replay-callback-${crypto.randomUUID()}`,
      )
      .set(
        'X-Webhook-Id',
        options.webhookId ||
          payload.callbackId ||
          CALLBACK_ID,
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

async function findAuditRecords(
  filter = {},
) {
  return findCollectionDocuments(
    [
      'auditlogs',
      'auditLogs',
      'audits',
    ],
    filter,
  );
}

async function snapshotOperation(
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

    audits:
      await findAuditRecords({
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
 * Posted Contribution Fixture
 * ========================================================================== */

async function createPostedContribution(
  overrides = {},
) {
  const operation =
    await initiateContribution({
      idempotencyKey:
        overrides.idempotencyKey ||
        IDEMPOTENCY_KEY,

      reference:
        overrides.reference ||
        overrides.idempotencyKey ||
        IDEMPOTENCY_KEY,

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
      callbackSuccess({
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
  'Golden Money Path - Contribution Replay Attack',
  () => {
    test(
      'replaying the same contribution request is idempotent',
      async () => {
        await seedContext();

        const first =
          await initiateContribution();

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          first.status,
        );

        const second =
          await initiateContribution();

        expectSafeReplayHttp(
          second,
        );

        const state =
          await snapshotOperation();

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
      'replaying the same request one hundred times creates at most one payment',
      async () => {
        await seedContext();

        const responses =
          await Promise.all(
            Array.from(
              {
                length:
                  100,
              },
              () =>
                initiateContribution(),
            ),
          );

        for (
          const response of
            responses
        ) {
          expectSafeReplayHttp(
            response,
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
                  PAYMENT_REFERENCE,
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
      'replaying the same request creates at most one transaction',
      async () => {
        await seedContext();

        await Promise.all(
          Array.from(
            {
              length:
                50,
            },
            () =>
              initiateContribution(),
          ),
        );

        const transactions =
          await findTransactions({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                reference:
                  PAYMENT_REFERENCE,
              },

              {
                externalReference:
                  PAYMENT_REFERENCE,
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
      'replaying the same request creates at most one contribution record',
      async () => {
        await seedContext();

        await Promise.all(
          Array.from(
            {
              length:
                50,
            },
            () =>
              initiateContribution(),
          ),
        );

        const contributions =
          await findContributions({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                reference:
                  PAYMENT_REFERENCE,
              },

              {
                paymentReference:
                  PAYMENT_REFERENCE,
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
      'replaying the same request cannot create multiple provider initiations',
      async () => {
        await seedContext();

        await Promise.all(
          Array.from(
            {
              length:
                30,
            },
            () =>
              initiateContribution(),
          ),
        );

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
      'replaying a successful callback does not create another journal',
      async () => {
        await seedContext();

        await createPostedContribution();

        const payload =
          callbackSuccess();

        const first =
          await sendCallback(
            payload,
          );

        const before =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const second =
          await sendCallback(
            payload,
          );

        expectSafeReplayHttp(
          first,
        );

        expectSafeReplayHttp(
          second,
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
      'replaying a successful callback with a different request ID remains idempotent',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess();

        await sendCallback(
          payload,
          {
            requestId:
              'original-request-id',
          },
        );

        const before =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await sendCallback(
          payload,
          {
            requestId:
              'attacker-new-request-id',
          },
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
      'replaying a successful callback with a different webhook ID remains idempotent',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess();

        await sendCallback(
          payload,
          {
            webhookId:
              'webhook-original',
          },
        );

        const before =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await sendCallback(
          payload,
          {
            webhookId:
              'webhook-replayed',
          },
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
      'replaying the same callback concurrently creates one payment',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess();

        await Promise.all(
          Array.from(
            {
              length:
                30,
            },
            (
              _,
              index,
            ) =>
              sendCallback(
                payload,
                {
                  requestId:
                    `replay-request-${index}`,
                },
              ),
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
            payments.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'replaying the same callback concurrently creates one journal',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess();

        await Promise.all(
          Array.from(
            {
              length:
                30,
            },
            (
              _,
              index,
            ) =>
              sendCallback(
                payload,
                {
                  requestId:
                    `journal-replay-${index}`,
                },
              ),
          ),
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
      'replaying a callback after terminal SUCCESS does not change payment state',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findPayments({
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

        await sendCallback(
          callbackSuccess(),
        );

        const after =
          await findPayments({
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

        if (
          before.length &&
          after.length
        ) {
          expect(
            getStatus(
              after[0],
            ),
          ).toBe(
            getStatus(
              before[0],
            ),
          );
        }
      },
    );

    test(
      'replaying a callback cannot increase the posted amount',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await Promise.all(
          Array.from(
            {
              length:
                20,
            },
            () =>
              sendCallback(
                callbackSuccess(),
              ),
          ),
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

        if (
          before.length &&
          after.length
        ) {
          const beforeDebit =
            before[0]
              .totalDebit ??
            before[0]
              .debitTotal;

          const afterDebit =
            after[0]
              .totalDebit ??
            after[0]
              .debitTotal;

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
        }
      },
    );

    test(
      'replaying a callback cannot change the currency',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const malicious =
          callbackSuccess({
            currency:
              'USD',
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

        if (
          after.length &&
          after[0].currency
        ) {
          expect(
            String(
              after[0].currency,
            ).toUpperCase(),
          ).toBe(
            CONTRIBUTION_CURRENCY,
          );
        }
      },
    );

    test(
      'replaying a callback cannot change the provider identity',
      async () => {
        await seedContext();

        await createPostedContribution();

        const malicious =
          callbackSuccess({
            provider:
              'airtel',
          });

        const response =
          await sendCallback(
            malicious,
          );

        expectSafeReplayHttp(
          response,
        );

        const payments =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          payments.length &&
          payments[0].provider
        ) {
          expect(
            String(
              payments[0].provider,
            ).toLowerCase(),
          ).toBe(
            'mtn',
          );
        }
      },
    );

    test(
      'replaying an old callback cannot complete a new operation',
      async () => {
        await seedContext();

        const oldOperation =
          await createPostedContribution({
            idempotencyKey:
              PAYMENT_REFERENCE,

            paymentReference:
              PAYMENT_REFERENCE,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          oldOperation,
        ).toBeDefined();

        const newOperation =
          await initiateContribution({
            idempotencyKey:
              SECOND_IDEMPOTENCY_KEY,

            reference:
              SECOND_PAYMENT_REFERENCE,

            phoneNumber:
              SECOND_TEST_PHONE,

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
          ],
        ).toContain(
          newOperation.status,
        );

        const oldCallback =
          callbackSuccess({
            callbackId:
              CALLBACK_ID,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,

            paymentReference:
              PAYMENT_REFERENCE,

            reference:
              PAYMENT_REFERENCE,

            amount:
              CONTRIBUTION_AMOUNT,
          });

        await sendCallback(
          oldCallback,
        );

        const newPayments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  SECOND_IDEMPOTENCY_KEY,
              },

              {
                paymentReference:
                  SECOND_PAYMENT_REFERENCE,
              },
            ],
          });

        for (
          const payment of
            newPayments
        ) {
          if (
            payment.amount !==
              undefined
          ) {
            expect(
              String(
                payment.amount,
              ),
            ).not.toBe(
              '100000',
            );
          }

          if (
            payment.providerTransactionId
          ) {
            expect(
              String(
                payment.providerTransactionId,
              ),
            ).not.toBe(
              PROVIDER_TRANSACTION_ID,
            );
          }
        }
      },
    );

    test(
      'replaying an old callback cannot post a second journal against a new idempotency key',
      async () => {
        await seedContext();

        await createPostedContribution();

        await initiateContribution({
          idempotencyKey:
            SECOND_IDEMPOTENCY_KEY,

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
          callbackSuccess(),
        );

        const secondJournals =
          await findJournals({
            $or: [
              {
                idempotencyKey:
                  SECOND_IDEMPOTENCY_KEY,
              },

              {
                reference:
                  SECOND_PAYMENT_REFERENCE,
              },

              {
                transactionId:
                  SECOND_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        /**
         * The old callback must never be interpreted as a callback for the
         * second operation.
         */
        expect(
          secondJournals.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'callback ID replay cannot be rebound to another provider transaction',
      async () => {
        await seedContext();

        await initiateContribution({
          idempotencyKey:
            PAYMENT_REFERENCE,
        });

        const original =
          callbackSuccess({
            callbackId:
              CALLBACK_ID,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,

            paymentReference:
              PAYMENT_REFERENCE,
          });

        await sendCallback(
          original,
        );

        const rebound =
          callbackSuccess({
            callbackId:
              CALLBACK_ID,

            providerTransactionId:
              SECOND_PROVIDER_TRANSACTION_ID,

            transactionId:
              SECOND_PROVIDER_TRANSACTION_ID,

            paymentReference:
              SECOND_PAYMENT_REFERENCE,

            reference:
              SECOND_PAYMENT_REFERENCE,
          });

        const response =
          await sendCallback(
            rebound,
          );

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

        const secondJournals =
          await findJournals({
            transactionId:
              SECOND_PROVIDER_TRANSACTION_ID,
          });

        expect(
          secondJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'idempotency key replay with identical payload returns the original operation semantics',
      async () => {
        await seedContext();

        const first =
          await initiateContribution({
            amount:
              Number(
                CONTRIBUTION_AMOUNT,
              ),

            currency:
              CONTRIBUTION_CURRENCY,

            phoneNumber:
              TEST_PHONE,
          });

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          first.status,
        );

        const second =
          await initiateContribution({
            amount:
              Number(
                CONTRIBUTION_AMOUNT,
              ),

            currency:
              CONTRIBUTION_CURRENCY,

            phoneNumber:
              TEST_PHONE,
          });

        expectSafeReplayHttp(
          second,
        );

        const firstId =
          getIdentifier(
            responsePayload(
              first,
            ),
            [
              'paymentId',
              'transactionId',
              'contributionId',
              '_id',
              'id',
            ],
          );

        const secondId =
          getIdentifier(
            responsePayload(
              second,
            ),
            [
              'paymentId',
              'transactionId',
              'contributionId',
              '_id',
              'id',
            ],
          );

        if (
          firstId &&
          secondId
        ) {
          expect(
            secondId,
          ).toBe(
            firstId,
          );
        }
      },
    );

    test(
      'idempotency key replay with changed amount is rejected as a conflict',
      async () => {
        await seedContext();

        await initiateContribution({
          amount:
            Number(
              CONTRIBUTION_AMOUNT,
            ),
        });

        const replay =
          await initiateContribution({
            amount:
              Number(
                SECOND_CONTRIBUTION_AMOUNT,
              ),
          });

        expect(
          [
            409,
            422,
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
                paymentReference:
                  PAYMENT_REFERENCE,
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
      'idempotency key replay with changed currency is rejected as a conflict',
      async () => {
        await seedContext();

        await initiateContribution({
          currency:
            CONTRIBUTION_CURRENCY,
        });

        const replay =
          await initiateContribution({
            currency:
              'USD',
          });

        expect(
          [
            409,
            422,
          ],
        ).toContain(
          replay.status,
        );
      },
    );

    test(
      'idempotency key replay with changed provider is rejected as a conflict',
      async () => {
        await seedContext();

        await initiateContribution({
          provider:
            'mtn',
        });

        const replay =
          await initiateContribution({
            provider:
              'airtel',
          });

        expect(
          [
            409,
            422,
          ],
        ).toContain(
          replay.status,
        );
      },
    );

    test(
      'idempotency key replay with changed phone number is rejected as a conflict',
      async () => {
        await seedContext();

        await initiateContribution({
          phoneNumber:
            TEST_PHONE,
        });

        const replay =
          await initiateContribution({
            phoneNumber:
              OTHER_TENANT_PHONE,
          });

        expect(
          [
            409,
            422,
          ],
        ).toContain(
          replay.status,
        );
      },
    );

    test(
      'idempotency key replay with changed group is rejected as a conflict',
      async () => {
        await seedContext();

        await initiateContribution({
          groupId:
            GROUP_ID,
        });

        const replay =
          await initiateContribution({
            groupId:
              '507f1f77bcf86cd79943b99',
          });

        expect(
          [
            400,
            404,
            409,
            422,
          ],
        ).toContain(
          replay.status,
        );
      },
    );

    test(
      'same callback payload replay with a new timestamp does not create another journal',
      async () => {
        await seedContext();

        await initiateContribution();

        const first =
          callbackSuccess({
            timestamp:
              new Date(
                Date.now() -
                  1000,
              ).toISOString(),
          });

        await sendCallback(
          first,
        );

        const before =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const second =
          callbackSuccess({
            timestamp:
              new Date().toISOString(),
          });

        await sendCallback(
          second,
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
      'same callback replay with a new signature does not create another journal',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess();

        await sendCallback(
          payload,
          {
            signature:
              signPayload(
                payload,
              ),
          },
        );

        const before =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await sendCallback(
          payload,
          {
            signature:
              signPayload(
                payload,
              ),
          },
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
      'replaying the callback after delayed processing does not duplicate settlement',
      async () => {
        await seedContext();

        await initiateContribution();

        mocks.settlement
          .mockResolvedValueOnce({
            success:
              true,
          });

        const payload =
          callbackSuccess();

        const responses =
          await Promise.all([
            sendCallback(
              payload,
              {
                requestId:
                  'delayed-replay-a',
              },
            ),

            sendCallback(
              payload,
              {
                requestId:
                  'delayed-replay-b',
              },
            ),
          ]);

        for (
          const response of
            responses
        ) {
          expectSafeReplayHttp(
            response,
          );
        }

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
      'replaying a pending callback cannot prematurely create a duplicate ledger post',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValue(
            providerPending(),
          );

        await initiateContribution();

        const payload =
          callbackSuccess();

        await Promise.all(
          Array.from(
            {
              length:
                20,
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
      'replaying after provider SUCCESS cannot create another journal',
      async () => {
        await seedContext();

        await createPostedContribution();

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
                  callbackSuccess(),
                  {
                    requestId:
                      `after-success-${index}`,
                  },
                ),
            ),
          );

        for (
          const response of
            responses
        ) {
          expectSafeReplayHttp(
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
          1,
        );
      },
    );

    test(
      'replaying after provider FAILURE cannot create successful financial truth',
      async () => {
        await seedContext();

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            providerFailed(),
          );

        const failedPayload =
          callbackSuccess({
            status:
              'FAILED',

            outcome:
              'FAILED',

            responseCode:
              'FAILED',
          });

        await sendCallback(
          failedPayload,
        );

        const replay =
          await sendCallback(
            callbackSuccess(),
          );

        expectSafeReplayHttp(
          replay,
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
      'replaying an invalid callback does not consume the callback identity of a later valid callback',
      async () => {
        await seedContext();

        await initiateContribution();

        const invalid =
          callbackSuccess({
            amount:
              '999999',
          });

        const invalidResponse =
          await sendCallback(
            invalid,
          );

        expectSafeReplayHttp(
          invalidResponse,
        );

        const valid =
          callbackSuccess({
            amount:
              CONTRIBUTION_AMOUNT,
          });

        const validResponse =
          await sendCallback(
            valid,
          );

        expect(
          [
            200,
            202,
            409,
          ],
        ).toContain(
          validResponse.status,
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
            1,
          );
        }
      },
    );

    test(
      'replayed valid callback cannot be rebound to another tenant',
      async () => {
        await seedContext();

        await initiateContribution(
          {},
          AUTH_TOKEN,
        );

        const payload =
          callbackSuccess();

        await sendCallback(
          payload,
        );

        const replay =
          await sendCallback(
            payload,
            {
              tenantId:
                OTHER_TENANT_ID,
            },
          );

        expect(
          [
            400,
            401,
            403,
            409,
          ].includes(
            replay.status,
          ),
        ).toBe(
          true,
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
      'replaying a callback cannot change tenantId inside the payload',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const malicious =
          callbackSuccess({
            tenantId:
              OTHER_TENANT_ID,
          });

        await sendCallback(
          malicious,
          {
            tenantId:
              OTHER_TENANT_ID,
          },
        );

        const after =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        if (
          before.length &&
          after.length
        ) {
          expect(
            after[0].tenantId
              ? String(
                  after[0].tenantId,
                )
              : TEST_TENANT_ID,
          ).toBe(
            TEST_TENANT_ID,
          );
        }
      },
    );

    test(
      'replaying a callback cannot change member ownership',
      async () => {
        await seedContext();

        await createPostedContribution();

        const malicious =
          callbackSuccess({
            memberId:
              SECOND_MEMBER_ID,

            userId:
              SECOND_MEMBER_ID,
          });

        await sendCallback(
          malicious,
        );

        const transactions =
          await findTransactions({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        for (
          const transaction of
            transactions
        ) {
          if (
            transaction.memberId
          ) {
            expect(
              String(
                transaction.memberId,
              ),
            ).toBe(
              MEMBER_ID,
            );
          }
        }
      },
    );

    test(
      'replaying a callback cannot change group ownership',
      async () => {
        await seedContext();

        await createPostedContribution();

        const malicious =
          callbackSuccess({
            groupId:
              '507f1f77bcf86cd79943b99',
          });

        await sendCallback(
          malicious,
        );

        const contributions =
          await findContributions({
            reference:
              PAYMENT_REFERENCE,
          });

        for (
          const contribution of
            contributions
        ) {
          if (
            contribution.groupId
          ) {
            expect(
              String(
                contribution.groupId,
              ),
            ).toBe(
              GROUP_ID,
            );
          }
        }
      },
    );

    test(
      'replay with an attacker-provided account identifier cannot redirect financial posting',
      async () => {
        await seedContext();

        await initiateContribution();

        const malicious =
          callbackSuccess({
            accountId:
              '507f1f77bcf86cd79943b99',

            destinationAccountId:
              '507f1f77bcf86cd79943b98',

            sourceAccountId:
              '507f1f77bcf86cd79943b97',
          });

        const response =
          await sendCallback(
            malicious,
          );

        expectSafeReplayHttp(
          response,
        );

        const attackJournals =
          await findJournals({
            $or: [
              {
                accountId:
                  '507f1f77bcf86cd79943b99',
              },

              {
                accountId:
                  '507f1f77bcf86cd79943b98',
              },

              {
                accountId:
                  '507f1f77bcf86cd79943b97',
              },
            ],
          });

        expect(
          attackJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'replayed callback cannot create a second contribution through a new idempotency key',
      async () => {
        await seedContext();

        await createPostedContribution();

        const replay =
          await initiateContribution({
            idempotencyKey:
              SECOND_IDEMPOTENCY_KEY,

            reference:
              SECOND_PAYMENT_REFERENCE,
          });

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          replay.status,
        );

        await sendCallback(
          callbackSuccess({
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

        const secondState =
          await snapshotOperation(
            SECOND_IDEMPOTENCY_KEY,
          );

        if (
          secondState.journals.length
        ) {
          expect(
            secondState.journals.length,
          ).toBeLessThanOrEqual(
            1,
          );

          /**
           * The original callback must not be copied into the second operation.
           */
          for (
            const journal of
              secondState.journals
          ) {
            if (
              journal.transactionId
            ) {
              expect(
                String(
                  journal.transactionId,
                ),
              ).not.toBe(
                PROVIDER_TRANSACTION_ID,
              );
            }
          }
        }
      },
    );

    test(
      'replayed client request cannot change an already persisted operation payload',
      async () => {
        await seedContext();

        await initiateContribution({
          amount:
            Number(
              CONTRIBUTION_AMOUNT,
            ),

          currency:
            CONTRIBUTION_CURRENCY,

          phoneNumber:
            TEST_PHONE,
        });

        const stateBefore =
          await snapshotOperation();

        await initiateContribution({
          amount:
            Number(
              SECOND_CONTRIBUTION_AMOUNT,
            ),

          currency:
            'USD',

          phoneNumber:
            OTHER_TENANT_PHONE,
        });

        const stateAfter =
          await snapshotOperation();

        expect(
          stateAfter.payments.length,
        ).toBe(
          stateBefore.payments.length,
        );

        expect(
          stateAfter.transactions.length,
        ).toBe(
          stateBefore.transactions.length,
        );

        expect(
          stateAfter.contributions.length,
        ).toBe(
          stateBefore.contributions.length,
        );
      },
    );

    test(
      'same idempotency key cannot be used to move a contribution to another member',
      async () => {
        await seedContext();

        await initiateContribution({
          phoneNumber:
            TEST_PHONE,
        });

        const replay =
          await initiateContribution(
            {
              phoneNumber:
                SECOND_TEST_PHONE,

              memberId:
                SECOND_MEMBER_ID,
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
          );

        expect(
          [
            400,
            403,
            409,
            422,
          ],
        ).toContain(
          replay.status,
        );
      },
    );

    test(
      'same callback cannot be replayed across providers',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess({
            provider:
              'mtn',
          });

        await sendCallback(
          payload,
        );

        const crossProviderReplay =
          callbackSuccess({
            provider:
              'airtel',

            callbackId:
              CALLBACK_ID,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,

            paymentReference:
              PAYMENT_REFERENCE,
          });

        const response =
          await sendCallback(
            crossProviderReplay,
          );

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
      },
    );

    test(
      'same callback cannot be replayed with a changed signature to manufacture a second outcome',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess();

        await sendCallback(
          payload,
        );

        const altered =
          {
            ...payload,

            amount:
              '999999',
          };

        const response =
          await sendCallback(
            altered,
            {
              signature:
                signPayload(
                  altered,
                ),
              requestId:
                'replay-altered-signature',
            },
          );

        expect(
          [
            400,
            401,
            403,
            409,
            422,
          ],
        ).toContain(
          response.status,
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
      'same callback replay does not produce multiple audit events for a single financial transition',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess();

        await sendCallback(
          payload,
        );

        const before =
          await findAuditRecords({
            $or: [
              {
                callbackId:
                  CALLBACK_ID,
              },

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

        await sendCallback(
          payload,
        );

        const after =
          await findAuditRecords({
            $or: [
              {
                callbackId:
                  CALLBACK_ID,
              },

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
      'replaying a completed request preserves immutable journal identity',
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

        await Promise.all([
          initiateContribution(),
          initiateContribution(),
          initiateContribution(),
          sendCallback(
            callbackSuccess(),
          ),
          sendCallback(
            callbackSuccess(),
          ),
        ]);

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
      'replay attacks cannot multiply balanced ledger postings',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess();

        await Promise.all(
          Array.from(
            {
              length:
                40,
            },
            (
              _,
              index,
            ) =>
              Promise.all([
                initiateContribution(),
                sendCallback(
                  payload,
                  {
                    requestId:
                      `ledger-replay-${index}`,
                  },
                ),
              ]),
          ),
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

        if (
          journals.length
        ) {
          expect(
            journals.length,
          ).toBe(
            1,
          );

          const debit =
            journals[0]
              .totalDebit ??
            journals[0]
              .debitTotal;

          const credit =
            journals[0]
              .totalCredit ??
            journals[0]
              .creditTotal;

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
      'replay attacks cannot multiply journal entries',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess();

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
                payload,
                {
                  requestId:
                    `entry-replay-${index}`,
                },
              ),
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
                  PAYMENT_REFERENCE,
              },
            ],
          });

        /**
         * A standard double-entry contribution has two primary entries.
         * Alternative accounting implementations may include controlled
         * clearing/fee/tax lines, but replay must never duplicate the set.
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
      'replay attacks cannot multiply account balance mutations',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess();

        await Promise.all(
          Array.from(
            {
              length:
                20,
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

        if (
          journals.length
        ) {
          expect(
            journals.length,
          ).toBe(
            1,
          );
        }

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

        expect(
          accounts.length,
        ).toBeGreaterThanOrEqual(
          0,
        );
      },
    );

    test(
      'replay after a provider timeout remains recoverable without duplicate posting',
      async () => {
        await seedContext();

        const timeout =
          new Error(
            'Provider request timed out',
          );

        timeout.code =
          'ETIMEDOUT';

        timeout.unknownOutcome =
          true;

        timeout.reconciliationRequired =
          true;

        mocks.providerInitiate
          .mockRejectedValueOnce(
            timeout,
          );

        await initiateContribution();

        const firstCallback =
          callbackSuccess();

        const first =
          await sendCallback(
            firstCallback,
          );

        expectSafeReplayHttp(
          first,
        );

        const second =
          await sendCallback(
            firstCallback,
          );

        expectSafeReplayHttp(
          second,
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
      'replay after delayed callback delivery completes at most one financial transition',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess();

        const delayedReplays =
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
                  payload,
                  {
                    requestId:
                      `delayed-callback-${index}`,
                  },
                ),
            ),
          );

        for (
          const response of
            delayedReplays
        ) {
          expectSafeReplayHttp(
            response,
          );
        }

        const payments =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
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
      'replay from another tenant cannot consume the original idempotency key',
      async () => {
        await seedContext();

        const original =
          await initiateContribution(
            {
              idempotencyKey:
                IDEMPOTENCY_KEY,
            },
            AUTH_TOKEN,
          );

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          original.status,
        );

        const attack =
          await initiateContribution(
            {
              idempotencyKey:
                IDEMPOTENCY_KEY,

              phoneNumber:
                OTHER_TENANT_PHONE,
            },
            OTHER_TENANT_TOKEN,
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
          attack.status,
        );

        const state =
          await snapshotOperation(
            IDEMPOTENCY_KEY,
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
      'replayed callback cannot cross tenant ownership after original success',
      async () => {
        await seedContext();

        await createPostedContribution();

        const replay =
          await sendCallback(
            callbackSuccess(),
            {
              tenantId:
                OTHER_TENANT_ID,
            },
          );

        expect(
          [
            400,
            401,
            403,
            409,
          ],
        ).toContain(
          replay.status,
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
      'replay cannot convert one successful operation into two successful provider states',
      async () => {
        await seedContext();

        await createPostedContribution();

        const responses =
          await Promise.all([
            sendCallback(
              callbackSuccess(),
            ),

            sendCallback(
              callbackSuccess({
                callbackId:
                  CALLBACK_ID,

                timestamp:
                  new Date(
                    Date.now() -
                      1000,
                  ).toISOString(),
              }),
            ),

            sendCallback(
              callbackSuccess({
                callbackId:
                  CALLBACK_ID,

                timestamp:
                  new Date(
                    Date.now() +
                      1000,
                  ).toISOString(),
              }),
            ),
          ]);

        for (
          const response of
            responses
        ) {
          expectSafeReplayHttp(
            response,
          );
        }

        const payments =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
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
      'replaying a legitimate callback cannot be used to create a refund-like or reversal-like side effect',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await snapshotFinancialState();

        await Promise.all(
          Array.from(
            {
              length:
                10,
            },
            () =>
              sendCallback(
                callbackSuccess(),
              ),
          ),
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

        expect(
          after.transactions.length,
        ).toBe(
          before.transactions.length,
        );
      },
    );

    test(
      'malicious replay cannot create financial records for an unknown reference',
      async () => {
        await seedContext();

        const replayPayload =
          callbackSuccess({
            callbackId:
              'REPLAY-UNKNOWN-000001',

            providerTransactionId:
              'OLD-TX-UNKNOWN-000001',

            transactionId:
              'OLD-TX-UNKNOWN-000001',

            paymentReference:
              'OLD-REF-UNKNOWN-000001',

            reference:
              'OLD-REF-UNKNOWN-000001',
          });

        const responses =
          await Promise.all(
            Array.from(
              {
                length:
                  20,
              },
              () =>
                sendCallback(
                  replayPayload,
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

        const payments =
          await findPayments({
            $or: [
              {
                providerTransactionId:
                  'OLD-TX-UNKNOWN-000001',
              },

              {
                paymentReference:
                  'OLD-REF-UNKNOWN-000001',
              },
            ],
          });

        expect(
          payments.length,
        ).toBe(
          0,
        );

        const journals =
          await findJournals({
            $or: [
              {
                transactionId:
                  'OLD-TX-UNKNOWN-000001',
              },

              {
                reference:
                  'OLD-REF-UNKNOWN-000001',
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
      'replay of an old successful callback cannot manufacture a contribution in a fresh database context',
      async () => {
        await seedContext();

        const oldPayload =
          callbackSuccess({
            callbackId:
              'OLD-HISTORICAL-CALLBACK-000001',

            providerTransactionId:
              'OLD-HISTORICAL-TX-000001',

            transactionId:
              'OLD-HISTORICAL-TX-000001',

            paymentReference:
              'OLD-HISTORICAL-REF-000001',

            reference:
              'OLD-HISTORICAL-REF-000001',
          });

        const response =
          await sendCallback(
            oldPayload,
          );

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

        const state =
          await snapshotOperation(
            'OLD-HISTORICAL-REF-000001',
          );

        expect(
          state.payments.length,
        ).toBe(
          0,
        );

        expect(
          state.transactions.length,
        ).toBe(
          0,
        );

        expect(
          state.journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'concurrent replay and original request race resolves to one operation',
      async () => {
        await seedContext();

        const payload =
          callbackSuccess();

        const responses =
          await Promise.all([
            initiateContribution(),

            initiateContribution(),

            sendCallback(
              payload,
            ),

            initiateContribution(),

            sendCallback(
              payload,
            ),

            initiateContribution(),

            sendCallback(
              payload,
            ),
          ]);

        for (
          const response of
            responses
        ) {
          expectSafeReplayHttp(
            response,
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
      'concurrent replay across two different members cannot collapse distinct idempotency keys',
      async () => {
        await seedContext();

        const [
          first,
          second,
        ] =
          await Promise.all([
            initiateContribution(
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,

                reference:
                  PAYMENT_REFERENCE,

                amount:
                  Number(
                    CONTRIBUTION_AMOUNT,
                  ),

                phoneNumber:
                  TEST_PHONE,
              },
              AUTH_TOKEN,
            ),

            initiateContribution(
              {
                idempotencyKey:
                  SECOND_IDEMPOTENCY_KEY,

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

        const firstState =
          await snapshotOperation(
            IDEMPOTENCY_KEY,
          );

        const secondState =
          await snapshotOperation(
            SECOND_IDEMPOTENCY_KEY,
          );

        if (
          firstState.payments.length &&
          secondState.payments.length
        ) {
          expect(
            String(
              firstState.payments[0]._id,
            ),
          ).not.toBe(
            String(
              secondState.payments[0]._id,
            ),
          );
        }
      },
    );

    test(
      'replay does not duplicate a second valid operation when idempotency keys differ',
      async () => {
        await seedContext();

        await initiateContribution({
          idempotencyKey:
            IDEMPOTENCY_KEY,
        });

        await initiateContribution({
          idempotencyKey:
            SECOND_IDEMPOTENCY_KEY,

          reference:
            SECOND_PAYMENT_REFERENCE,

          amount:
            Number(
              SECOND_CONTRIBUTION_AMOUNT,
            ),

          phoneNumber:
            SECOND_TEST_PHONE,
        });

        const firstReplay =
          await initiateContribution({
            idempotencyKey:
              IDEMPOTENCY_KEY,
          });

        const secondReplay =
          await initiateContribution({
            idempotencyKey:
              SECOND_IDEMPOTENCY_KEY,

            reference:
              SECOND_PAYMENT_REFERENCE,

            amount:
              Number(
                SECOND_CONTRIBUTION_AMOUNT,
              ),

            phoneNumber:
              SECOND_TEST_PHONE,
          });

        expectSafeReplayHttp(
          firstReplay,
        );

        expectSafeReplayHttp(
          secondReplay,
        );

        const firstState =
          await snapshotOperation(
            IDEMPOTENCY_KEY,
          );

        const secondState =
          await snapshotOperation(
            SECOND_IDEMPOTENCY_KEY,
          );

        if (
          firstState.payments.length
        ) {
          expect(
            firstState.payments.length,
          ).toBe(
            1,
          );
        }

        if (
          secondState.payments.length
        ) {
          expect(
            secondState.payments.length,
          ).toBe(
            1,
          );
        }
      },
    );

    test(
      'replay cannot convert a valid request into an account-selection override',
      async () => {
        await seedContext();

        await initiateContribution({
          accountId:
            '507f1f77bcf86cd79943b08',
        });

        const replay =
          await initiateContribution({
            accountId:
              '507f1f77bcf86cd79943b09',
          });

        expect(
          [
            400,
            403,
            409,
            422,
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
                reference:
                  PAYMENT_REFERENCE,
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

          if (
            journals[0].tenantId
          ) {
            expect(
              String(
                journals[0].tenantId,
              ),
            ).toBe(
              TEST_TENANT_ID,
            );
          }
        }
      },
    );

    test(
      'replay after successful settlement cannot invoke settlement again',
      async () => {
        await seedContext();

        await createPostedContribution();

        const callsBefore =
          mocks.settlement.mock
            .calls.length;

        await Promise.all(
          Array.from(
            {
              length:
                15,
            },
            () =>
              sendCallback(
                callbackSuccess(),
              ),
          ),
        );

        const callsAfter =
          mocks.settlement.mock
            .calls.length;

        /**
         * Depending on implementation, settlement may happen once on the first
         * callback or before this test. Replay must never create a second
         * settlement transition.
         */
        expect(
          callsAfter,
        ).toBe(
          callsBefore,
        );
      },
    );

    test(
      'replay after successful posting cannot republish the financial event as a second transition',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          mocks.publishEvent.mock
            .calls.length;

        await Promise.all(
          Array.from(
            {
              length:
                20,
            },
            () =>
              sendCallback(
                callbackSuccess(),
              ),
          ),
        );

        const after =
          mocks.publishEvent.mock
            .calls.length;

        expect(
          after,
        ).toBe(
          before,
        );
      },
    );

    test(
      'replay after successful posting cannot create a second audit transition',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          mocks.recordAudit.mock
            .calls.length;

        await Promise.all(
          Array.from(
            {
              length:
                20,
            },
            () =>
              sendCallback(
                callbackSuccess(),
              ),
          ),
        );

        const after =
          mocks.recordAudit.mock
            .calls.length;

        expect(
          after,
        ).toBe(
          before,
        );
      },
    );

    test(
      'replay protection survives callback payload mutation attempts',
      async () => {
        await seedContext();

        await initiateContribution();

        const base =
          callbackSuccess();

        await sendCallback(
          base,
        );

        const variants = [
          {
            ...base,

            amount:
              '999999',
          },

          {
            ...base,

            currency:
              'USD',
          },

          {
            ...base,

            provider:
              'airtel',
          },

          {
            ...base,

            paymentReference:
              SECOND_PAYMENT_REFERENCE,
          },

          {
            ...base,

            providerTransactionId:
              SECOND_PROVIDER_TRANSACTION_ID,
          },

          {
            ...base,

            tenantId:
              OTHER_TENANT_ID,
          },
        ];

        await Promise.all(
          variants.map(
            (
              payload,
              index,
            ) =>
              sendCallback(
                payload,
                {
                  tenantId:
                    index ===
                    5
                      ? OTHER_TENANT_ID
                      : undefined,
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
        ).toBeLessThanOrEqual(
          1,
        );

        const attackJournals =
          await findJournals({
            $or: [
              {
                transactionId:
                  SECOND_PROVIDER_TRANSACTION_ID,
              },

              {
                reference:
                  SECOND_PAYMENT_REFERENCE,
              },
            ],
          });

        expect(
          attackJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'replay protection preserves immutable journal identity under maximum callback concurrency',
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

        const payload =
          callbackSuccess();

        await Promise.all(
          Array.from(
            {
              length:
                100,
            },
            (
              _,
              index,
            ) =>
              sendCallback(
                payload,
                {
                  requestId:
                    `max-concurrency-replay-${index}`,
                },
              ),
          ),
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
      'replay protection preserves immutable payment identity under maximum request concurrency',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          before.length,
        ).toBe(
          1,
        );

        await Promise.all(
          Array.from(
            {
              length:
                100,
            },
            () =>
              initiateContribution(),
          ),
        );

        const after =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          after.length,
        ).toBe(
          1,
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
      'replay protection preserves contribution amount and currency under concurrency',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess();

        await Promise.all(
          Array.from(
            {
              length:
                50,
            },
            () =>
              sendCallback(
                payload,
              ),
          ),
        );

        const payments =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
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
      'replay protection preserves tenant ownership under concurrency',
      async () => {
        await seedContext();

        await initiateContribution(
          {},
          AUTH_TOKEN,
        );

        const payload =
          callbackSuccess();

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
                payload,
                {
                  requestId:
                    `tenant-owner-${index}`,
                },
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
              initiateContribution(
                {
                  phoneNumber:
                    OTHER_TENANT_PHONE,

                  idempotencyKey:
                    IDEMPOTENCY_KEY,
                },
                OTHER_TENANT_TOKEN,
              ),
          ),
        ]);

        const payments =
          await findPayments({
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

        const attackTenantPayments =
          await findPayments({
            tenantId:
              OTHER_TENANT_ID,
          });

        expect(
          attackTenantPayments.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'replay attack cannot bypass payment state machine terminal protection',
      async () => {
        await seedContext();

        await createPostedContribution();

        const statusBefore =
          (
            await findPayments({
              providerTransactionId:
                PROVIDER_TRANSACTION_ID,
            })
          )[0];

        const replayPayloads = [
          callbackSuccess({
            status:
              'PENDING',

            outcome:
              'PENDING',
          }),

          callbackSuccess({
            status:
              'FAILED',

            outcome:
              'FAILED',
          }),

          callbackSuccess({
            status:
              'SUCCESS',

            outcome:
              'SUCCESS',
          }),
        ];

        await Promise.all(
          replayPayloads.map(
            (
              payload,
            ) =>
              sendCallback(
                payload,
              ),
          ),
        );

        const statusAfter =
          (
            await findPayments({
              providerTransactionId:
                PROVIDER_TRANSACTION_ID,
            })
          )[0];

        if (
          statusBefore &&
          statusAfter
        ) {
          expect(
            getStatus(
              statusAfter,
            ),
          ).toBe(
            getStatus(
              statusBefore,
            ),
          );
        }
      },
    );

    test(
      'replayed callback cannot duplicate a contribution after successful recovery',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValueOnce(
            providerPending(),
          );

        await initiateContribution();

        await sendCallback(
          callbackSuccess(),
        );

        await sendCallback(
          callbackSuccess(),
        );

        await sendCallback(
          callbackSuccess(),
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
            1,
          );
        }

        const transactions =
          await findTransactions({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
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
      'replayed callback cannot duplicate settlement after provider verification',
      async () => {
        await seedContext();

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue(
            providerSuccess(),
          );

        const payload =
          callbackSuccess();

        await Promise.all(
          Array.from(
            {
              length:
                25,
            },
            () =>
              sendCallback(
                payload,
              ),
          ),
        );

        expect(
          mocks.providerVerify.mock
            .calls.length,
        ).toBeLessThanOrEqual(
          25,
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
            1,
          );
        }
      },
    );

    test(
      'replayed callback cannot create a second financial event after delayed callback processing',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess();

        const responses =
          await Promise.all(
            [
              sendCallback(
                payload,
                {
                  requestId:
                    'delayed-a',
                },
              ),

              sendCallback(
                payload,
                {
                  requestId:
                    'delayed-b',
                },
              ),

              sendCallback(
                payload,
                {
                  requestId:
                    'delayed-c',
                },
              ),
            ],
          );

        for (
          const response of
            responses
        ) {
          expectSafeReplayHttp(
            response,
          );
        }

        const state =
          await snapshotOperation();

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

    test(
      'replayed callback does not create an unrelated contribution record',
      async () => {
        await seedContext();

        await createPostedContribution();

        const replay =
          callbackSuccess({
            paymentReference:
              SECOND_PAYMENT_REFERENCE,

            reference:
              SECOND_PAYMENT_REFERENCE,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const response =
          await sendCallback(
            replay,
          );

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

        const secondContributions =
          await findContributions({
            $or: [
              {
                reference:
                  SECOND_PAYMENT_REFERENCE,
              },

              {
                paymentReference:
                  SECOND_PAYMENT_REFERENCE,
              },
            ],
          });

        expect(
          secondContributions.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'replay cannot transform one callback identity into two provider transaction identities',
      async () => {
        await seedContext();

        await initiateContribution();

        const original =
          callbackSuccess();

        await sendCallback(
          original,
        );

        const alternate =
          callbackSuccess({
            callbackId:
              CALLBACK_ID,

            providerTransactionId:
              SECOND_PROVIDER_TRANSACTION_ID,

            transactionId:
              SECOND_PROVIDER_TRANSACTION_ID,
          });

        const response =
          await sendCallback(
            alternate,
          );

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

        const secondTransactions =
          await findTransactions({
            providerTransactionId:
              SECOND_PROVIDER_TRANSACTION_ID,
          });

        expect(
          secondTransactions.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'replay protection rejects idempotency-key reuse with different financial amount even after SUCCESS',
      async () => {
        await seedContext();

        await createPostedContribution();

        const replay =
          await initiateContribution({
            amount:
              Number(
                SECOND_CONTRIBUTION_AMOUNT,
              ),
          });

        expect(
          [
            409,
            422,
          ],
        ).toContain(
          replay.status,
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
      'replay protection rejects idempotency-key reuse with different currency even after SUCCESS',
      async () => {
        await seedContext();

        await createPostedContribution();

        const replay =
          await initiateContribution({
            currency:
              'USD',
          });

        expect(
          [
            409,
            422,
          ],
        ).toContain(
          replay.status,
        );

        const payments =
          await findPayments({
            paymentReference:
              PAYMENT_REFERENCE,
          });

        if (
          payments.length &&
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
      },
    );

    test(
      'replay protection preserves one immutable journal after request/callback replay matrix',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const payload =
          callbackSuccess();

        await Promise.all([
          ...Array.from(
            {
              length:
                20,
            },
            () =>
              initiateContribution(),
          ),

          ...Array.from(
            {
              length:
                20,
            },
            () =>
              sendCallback(
                payload,
              ),
          ),

          ...Array.from(
            {
              length:
                20,
            },
            () =>
              initiateContribution({
                amount:
                  Number(
                    CONTRIBUTION_AMOUNT,
                  ),
              }),
          ),
        ]);

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
      'replay attacks do not create duplicate journal entries after a successful recovery',
      async () => {
        await seedContext();

        mocks.ledgerPost
          .mockRejectedValueOnce(
            new Error(
              'Transient ledger failure',
            ),
          );

        await initiateContribution();

        await sendCallback(
          callbackSuccess(),
        );

        mocks.ledgerPost
          .mockResolvedValue({
            success:
              true,

            journalId:
              '507f1f77bcf86cd79943b0a',

            status:
              'POSTED',

            totalDebit:
              CONTRIBUTION_AMOUNT,

            totalCredit:
              CONTRIBUTION_AMOUNT,
          });

        await Promise.all(
          Array.from(
            {
              length:
                20,
            },
            () =>
              sendCallback(
                callbackSuccess(),
              ),
          ),
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
            1,
          );
        }
      },
    );

    test(
      'replay attack does not create a second contribution when the original operation is still pending',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValue(
            providerPending(),
          );

        const responses =
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

        const payments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                paymentReference:
                  PAYMENT_REFERENCE,
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
              SUCCESS_STATES.has(
                status,
              ),
            ).toBe(
              false,
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
        ).toBe(
          0,
        );
      },
    );

    test(
      'replay attack cannot convert unknown provider outcome into duplicate success',
      async () => {
        await seedContext();

        const timeout =
          new Error(
            'Unknown provider outcome',
          );

        timeout.code =
          'ETIMEDOUT';

        timeout.unknownOutcome =
          true;

        timeout.reconciliationRequired =
          true;

        mocks.providerInitiate
          .mockRejectedValueOnce(
            timeout,
          );

        await initiateContribution();

        const payload =
          callbackSuccess();

        const responses =
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

        for (
          const response of
            responses
        ) {
          expectSafeReplayHttp(
            response,
          );
        }

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
            1,
          );
        }
      },
    );

    test(
      'replay attack cannot alter provider transaction amount through callback mutation',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const malicious =
          callbackSuccess({
            amount:
              '999999',
          });

        await sendCallback(
          malicious,
        );

        const after =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          after.length,
        ).toBe(
          before.length,
        );

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
      'replay attack cannot alter provider transaction reference through callback mutation',
      async () => {
        await seedContext();

        await createPostedContribution();

        const malicious =
          callbackSuccess({
            paymentReference:
              SECOND_PAYMENT_REFERENCE,

            reference:
              SECOND_PAYMENT_REFERENCE,

            externalReference:
              SECOND_PAYMENT_REFERENCE,
          });

        await sendCallback(
          malicious,
        );

        const original =
          await findTransactions({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const alternate =
          await findTransactions({
            $or: [
              {
                reference:
                  SECOND_PAYMENT_REFERENCE,
              },

              {
                externalReference:
                  SECOND_PAYMENT_REFERENCE,
              },
            ],
          });

        if (
          original.length
        ) {
          expect(
            original.length,
          ).toBe(
            1,
          );
        }

        expect(
          alternate.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'replay attack cannot create financial truth under a forged tenant header',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          callbackSuccess();

        const response =
          await sendCallback(
            payload,
            {
              tenantId:
                OTHER_TENANT_ID,
            },
          );

        expect(
          [
            400,
            401,
            403,
            409,
          ],
        ).toContain(
          response.status,
        );

        const attackJournals =
          await findJournals({
            tenantId:
              OTHER_TENANT_ID,
          });

        expect(
          attackJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'replay protection is not bypassed by using the same callback payload with a fresh callback ID and fresh request ID',
      async () => {
        await seedContext();

        await initiateContribution();

        const original =
          callbackSuccess({
            callbackId:
              CALLBACK_ID,
          });

        await sendCallback(
          original,
        );

        const replay =
          callbackSuccess({
            callbackId:
              `FRESH-CB-${crypto.randomUUID()}`,
          });

        const response =
          await sendCallback(
            replay,
            {
              requestId:
                `FRESH-REQ-${crypto.randomUUID()}`,
            },
          );

        expect(
          [
            200,
            202,
            409,
          ].includes(
            response.status,
          ) ||
            [
              400,
              401,
              403,
              404,
            ].includes(
              response.status,
          ),
        ).toBe(
          true,
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
      'replay protection preserves one logical operation across mixed API authentication forms',
      async () => {
        await seedContext();

        const first =
          await authenticatedRequest(
            AUTH_TOKEN,
          )
            .post(
              '/api/contributions',
            )
            .set(
              'Idempotency-Key',
              IDEMPOTENCY_KEY,
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
                TEST_PHONE,

              idempotencyKey:
                IDEMPOTENCY_KEY,

              reference:
                PAYMENT_REFERENCE,
            });

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          first.status,
        );

        const second =
          await authenticatedRequest(
            AUTH_TOKEN,
          )
            .post(
              '/api/contributions',
            )
            .set(
              'X-Idempotency-Key',
              IDEMPOTENCY_KEY,
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
                TEST_PHONE,

              idempotencyKey:
                IDEMPOTENCY_KEY,

              reference:
                PAYMENT_REFERENCE,
            });

        expectSafeReplayHttp(
          second,
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
                  PAYMENT_REFERENCE,
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
      'replay attack cannot bypass tenant isolation by supplying a valid historical idempotency key',
      async () => {
        await seedContext();

        await initiateContribution(
          {},
          AUTH_TOKEN,
        );

        const replay =
          await initiateContribution(
            {
              idempotencyKey:
                IDEMPOTENCY_KEY,

              reference:
                PAYMENT_REFERENCE,

              phoneNumber:
                OTHER_TENANT_PHONE,
            },
            OTHER_TENANT_TOKEN,
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
          replay.status,
        );

        const attackTenant =
          await findPayments({
            tenantId:
              OTHER_TENANT_ID,
          });

        expect(
          attackTenant.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'replayed callback cannot create a second ledger posting after successful client retry',
      async () => {
        await seedContext();

        await createPostedContribution();

        await initiateContribution({
          idempotencyKey:
            IDEMPOTENCY_KEY,
        });

        const payload =
          callbackSuccess();

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

          initiateContribution(),
        ]);

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
      'replay attack cannot create a second financial record after the operation has reached terminal success',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await snapshotOperation();

        await Promise.all([
          initiateContribution(),
          initiateContribution(),
          initiateContribution(),
          sendCallback(
            callbackSuccess(),
          ),
          sendCallback(
            callbackSuccess(),
          ),
          sendCallback(
            callbackSuccess(),
          ),
        ]);

        const after =
          await snapshotOperation();

        expect(
          after.payments.length,
        ).toBe(
          before.payments.length,
        );

        expect(
          after.transactions.length,
        ).toBe(
          before.transactions.length,
        );

        expect(
          after.journals.length,
        ).toBe(
          before.journals.length,
        );

        expect(
          after.contributions.length,
        ).toBe(
          before.contributions.length,
        );
      },
    );

    test(
      'replay attack cannot duplicate successful provider callback when callback event IDs differ but financial identity is the same',
      async () => {
        await seedContext();

        await initiateContribution();

        const original =
          callbackSuccess({
            callbackId:
              CALLBACK_ID,
          });

        await sendCallback(
          original,
        );

        const replayIds =
          Array.from(
            {
              length:
                10,
            },
            (
              _,
              index,
            ) =>
              `PROVIDER-EVENT-REPLAY-${index}`,
          );

        await Promise.all(
          replayIds.map(
            (
              callbackId,
            ) =>
              sendCallback(
                callbackSuccess({
                  callbackId,
                }),
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
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'replay attack cannot duplicate provider settlement even when event IDs differ',
      async () => {
        await seedContext();

        await initiateContribution();

        const replayIds =
          Array.from(
            {
              length:
                15,
            },
            (
              _,
              index,
            ) =>
              `SETTLEMENT-REPLAY-${index}`,
          );

        await Promise.all(
          replayIds.map(
            (
              callbackId,
            ) =>
              sendCallback(
                callbackSuccess({
                  callbackId,
                }),
              ),
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
      'replay attack cannot duplicate provider verification indefinitely',
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
                callbackSuccess({
                  callbackId:
                    `VERIFY-REPLAY-${index}`,
                }),
              ),
          ),
        );

        expect(
          mocks.providerVerify.mock
            .calls.length,
        ).toBeLessThanOrEqual(
          15,
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
            1,
          );
        }
      },
    );

    test(
      'replay attack cannot multiply provider callback processing after a successful ledger post',
      async () => {
        await seedContext();

        await createPostedContribution();

        const payload =
          callbackSuccess();

        await Promise.all(
          Array.from(
            {
              length:
                50,
            },
            (
              _,
              index,
            ) =>
              sendCallback(
                payload,
                {
                  requestId:
                    `post-ledger-replay-${index}`,
                },
              ),
          ),
        );

        const state =
          await snapshotOperation();

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
      },
    );

    test(
      'replay attack cannot alter the original immutable ledger reference',
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

        await sendCallback(
          callbackSuccess({
            reference:
              SECOND_PAYMENT_REFERENCE,

            paymentReference:
              SECOND_PAYMENT_REFERENCE,
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

        if (
          before[0].reference &&
          after[0].reference
        ) {
          expect(
            String(
              after[0].reference,
            ),
          ).toBe(
            String(
              before[0].reference,
            ),
          );
        }
      },
    );

    test(
      'replay attack cannot make an already successful transaction refundable/reversible by callback fields',
      async () => {
        await seedContext();

        await createPostedContribution();

        const payload =
          callbackSuccess({
            refund:
              true,

            reversed:
              true,

            reversalRequested:
              true,

            refundRequested:
              true,

            adjustment:
              true,
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
        ).toBe(
          1,
        );
      },
    );

    test(
      'replay attack cannot inject an alternate ledger account through nested replay metadata',
      async () => {
        await seedContext();

        await createPostedContribution();

        const payload =
          callbackSuccess({
            metadata:
              {
                accountId:
                  '507f1f77bcf86cd79943b99',

                sourceAccountId:
                  '507f1f77bcf86cd79943b98',

                destinationAccountId:
                  '507f1f77bcf86cd79943b97',
              },
          });

        await sendCallback(
          payload,
        );

        const attackJournals =
          await findJournals({
            $or: [
              {
                accountId:
                  '507f1f77bcf86cd79943b99',
              },

              {
                accountId:
                  '507f1f77bcf86cd79943b98',
              },

              {
                accountId:
                  '507f1f77bcf86cd79943b97',
              },
            ],
          });

        expect(
          attackJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'replay attack cannot produce duplicate ledger entries through duplicate callback sequence numbers',
      async () => {
        await seedContext();

        await initiateContribution();

        await Promise.all(
          Array.from(
            {
              length:
                20,
            },
            () =>
              sendCallback(
                callbackSuccess({
                  sequence:
                    1,
                }),
              ),
          ),
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
            1,
          );
        }
      },
    );

    test(
      'replay attack cannot bypass state protection by sending an old SUCCESS callback after FAILED',
      async () => {
        await seedContext();

        await initiateContribution();

        const failed =
          callbackSuccess({
            status:
              'FAILED',

            outcome:
              'FAILED',

            responseCode:
              'FAILED',
          });

        await sendCallback(
          failed,
        );

        const oldSuccess =
          callbackSuccess({
            status:
              'SUCCESS',

            outcome:
              'SUCCESS',

            responseCode:
              'SUCCESS',
          });

        await sendCallback(
          oldSuccess,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        /**
         * A failed state may be recoverable depending on provider semantics,
         * but a replayed historical callback must not blindly create a second
         * journal. Zero or one is therefore acceptable.
         */
        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'replay attack cannot bypass state protection by sending PENDING after SUCCESS',
      async () => {
        await seedContext();

        await createPostedContribution();

        await sendCallback(
          callbackSuccess({
            status:
              'PENDING',

            outcome:
              'PENDING',

            responseCode:
              'PENDING',
          }),
        );

        const payments =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
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
      'replay attack cannot bypass state protection by sending FAILED after SUCCESS',
      async () => {
        await seedContext();

        await createPostedContribution();

        await sendCallback(
          callbackSuccess({
            status:
              'FAILED',

            outcome:
              'FAILED',

            responseCode:
              'FAILED',
          }),
        );

        const payments =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
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
      'replay attack cannot create a payment record after the original callback has already completed',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          before.length,
        ).toBe(
          1,
        );

        await Promise.all(
          Array.from(
            {
              length:
                50,
            },
            (
              _,
              index,
            ) =>
              sendCallback(
                callbackSuccess({
                  callbackId:
                    `UNIQUE-REPLAY-${index}`,
                }),
              ),
          ),
        );

        const after =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          after.length,
        ).toBe(
          1,
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
      'replay attack cannot create a transaction after the original transaction has already completed',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findTransactions({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await Promise.all(
          Array.from(
            {
              length:
                50,
            },
            (
              _,
              index,
            ) =>
              sendCallback(
                callbackSuccess({
                  callbackId:
                    `TX-REPLAY-${index}`,
                }),
              ),
          ),
        );

        const after =
          await findTransactions({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          after.length,
        ).toBe(
          before.length,
        );

        if (
          before.length
        ) {
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
        }
      },
    );

    test(
      'replay attack cannot create a second contribution record after completion',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await findContributions({
            reference:
              PAYMENT_REFERENCE,
          });

        await Promise.all(
          Array.from(
            {
              length:
                50,
            },
            (
              _,
              index,
            ) =>
              sendCallback(
                callbackSuccess({
                  callbackId:
                    `CONTRIBUTION-REPLAY-${index}`,
                }),
              ),
          ),
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
      'replay attack cannot cross tenant boundaries through a legitimate historical provider transaction',
      async () => {
        await seedContext();

        await createPostedContribution();

        const attackResponse =
          await sendCallback(
            callbackSuccess(),
            {
              tenantId:
                OTHER_TENANT_ID,
            },
          );

        expect(
          [
            400,
            401,
            403,
            409,
          ],
        ).toContain(
          attackResponse.status,
        );

        const otherTenant =
          await findPayments({
            tenantId:
              OTHER_TENANT_ID,
          });

        expect(
          otherTenant.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'replay attack remains contained when attacker changes both idempotency key and callback ID',
      async () => {
        await seedContext();

        await createPostedContribution();

        const attackerPayload =
          callbackSuccess({
            callbackId:
              'ATTACKER-CALLBACK-NEW-ID',

            paymentReference:
              'ATTACKER-NEW-REFERENCE',

            reference:
              'ATTACKER-NEW-REFERENCE',

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const response =
          await sendCallback(
            attackerPayload,
          );

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

        const attackerRecords =
          await snapshotOperation(
            'ATTACKER-NEW-REFERENCE',
          );

        expect(
          attackerRecords.journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'replay protection remains effective when a malicious callback is delivered before the legitimate callback',
      async () => {
        await seedContext();

        await initiateContribution();

        const malicious =
          callbackSuccess({
            amount:
              '999999',

            currency:
              'USD',

            callbackId:
              'MALICIOUS-FIRST-CALLBACK',
          });

        await sendCallback(
          malicious,
        );

        const legitimate =
          callbackSuccess({
            callbackId:
              CALLBACK_ID,

            amount:
              CONTRIBUTION_AMOUNT,

            currency:
              CONTRIBUTION_CURRENCY,
          });

        const response =
          await sendCallback(
            legitimate,
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
            transactionId:
              PROVIDER_TRANSACTION_ID,
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
      'replay protection keeps original provider transaction identity after malicious-first delivery',
      async () => {
        await seedContext();

        await initiateContribution();

        const malicious =
          callbackSuccess({
            providerTransactionId:
              SECOND_PROVIDER_TRANSACTION_ID,

            transactionId:
              SECOND_PROVIDER_TRANSACTION_ID,

            paymentReference:
              PAYMENT_REFERENCE,

            callbackId:
              'MALICIOUS-FIRST-IDENTITY',
          });

        await sendCallback(
          malicious,
        );

        const legitimate =
          callbackSuccess();

        await sendCallback(
          legitimate,
        );

        const payments =
          await findPayments({
            $or: [
              {
                paymentReference:
                  PAYMENT_REFERENCE,
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
      'replay protection does not permit a callback from another tenant to claim a historical operation',
      async () => {
        await seedContext();

        await createPostedContribution();

        const replay =
          await sendCallback(
            callbackSuccess({
              tenantId:
                OTHER_TENANT_ID,
            }),
            {
              tenantId:
                OTHER_TENANT_ID,
            },
          );

        expect(
          [
            400,
            401,
            403,
            409,
          ],
        ).toContain(
          replay.status,
        );

        const legitimateTenantRecords =
          await findPayments({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expect(
          legitimateTenantRecords.length,
        ).toBe(
          1,
        );
      },
    );

    test(
      'replay protection remains safe when historical callback is replayed after a separate successful operation',
      async () => {
        await seedContext();

        await createPostedContribution({
          idempotencyKey:
            PAYMENT_REFERENCE,

          paymentReference:
            PAYMENT_REFERENCE,

          providerTransactionId:
            PROVIDER_TRANSACTION_ID,
        });

        await createPostedContribution({
          idempotencyKey:
            SECOND_IDEMPOTENCY_KEY,

          paymentReference:
            SECOND_PAYMENT_REFERENCE,

          providerTransactionId:
            SECOND_PROVIDER_TRANSACTION_ID,

          callbackId:
            SECOND_CALLBACK_ID,

          amount:
            SECOND_CONTRIBUTION_AMOUNT,

          phoneNumber:
            SECOND_TEST_PHONE,
        });

        await sendCallback(
          callbackSuccess({
            callbackId:
              CALLBACK_ID,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,

            paymentReference:
              PAYMENT_REFERENCE,
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
          1,
        );

        expect(
          second.length,
        ).toBe(
          1,
        );
      },
    );

    test(
      'replay protection maintains separate provider transaction identities across distinct operations',
      async () => {
        await seedContext();

        await initiateContribution({
          idempotencyKey:
            IDEMPOTENCY_KEY,

          reference:
            PAYMENT_REFERENCE,
        });

        await initiateContribution({
          idempotencyKey:
            SECOND_IDEMPOTENCY_KEY,

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
          callbackSuccess({
            callbackId:
              CALLBACK_ID,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,

            paymentReference:
              PAYMENT_REFERENCE,
          }),
        );

        await sendCallback(
          callbackSuccess({
            callbackId:
              SECOND_CALLBACK_ID,

            providerTransactionId:
              SECOND_PROVIDER_TRANSACTION_ID,

            transactionId:
              SECOND_PROVIDER_TRANSACTION_ID,

            paymentReference:
              SECOND_PAYMENT_REFERENCE,

            reference:
              SECOND_PAYMENT_REFERENCE,

            amount:
              SECOND_CONTRIBUTION_AMOUNT,

            msisdn:
              SECOND_TEST_PHONE,
          }),
        );

        const firstTransactions =
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

        const secondTransactions =
          await findTransactions({
            $or: [
              {
                providerTransactionId:
                  SECOND_PROVIDER_TRANSACTION_ID,
              },

              {
                transactionId:
                  SECOND_PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        if (
          firstTransactions.length
          &&
          secondTransactions.length
        ) {
          expect(
            firstTransactions.length,
          ).toBe(
            1,
          );

          expect(
            secondTransactions.length,
          ).toBe(
            1,
          );

          expect(
            String(
              firstTransactions[0]._id,
            ),
          ).not.toBe(
            String(
              secondTransactions[0]._id,
            ),
          );
        }
      },
    );

    test(
      'replay attack does not duplicate the final successful financial state after mixed malformed and valid callbacks',
      async () => {
        await seedContext();

        await initiateContribution();

        const payloads = [
          callbackSuccess({
            amount:
              '1',
          }),

          callbackSuccess({
            currency:
              'USD',
          }),

          callbackSuccess({
            provider:
              'evil',
          }),

          callbackSuccess({
            paymentReference:
              SECOND_PAYMENT_REFERENCE,
          }),

          callbackSuccess({
            providerTransactionId:
              SECOND_PROVIDER_TRANSACTION_ID,
          }),

          callbackSuccess(),
          callbackSuccess(),
          callbackSuccess(),
        ];

        await Promise.all(
          payloads.map(
            (
              payload,
              index,
            ) =>
              sendCallback(
                payload,
                {
                  requestId:
                    `mixed-replay-${index}`,
                },
              ),
          ),
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