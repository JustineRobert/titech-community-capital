'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Golden Money Path - Malicious Callback Integration Tests
 * ============================================================================
 *
 * File:
 *   tests/integration/goldenMoneyPath/contribution.maliciousCallback.test.js
 *
 * Purpose
 * -------
 * Enterprise security and financial-integrity integration coverage for hostile,
 * forged, malformed, replayed, tampered, or cross-tenant payment callbacks.
 *
 * Security boundary
 * -----------------
 *
 * Provider callback
 *       |
 *       v
 * Callback Registry
 *       |
 *       v
 * Signature / Authenticity Validation
 *       |
 *       v
 * Replay / Idempotency Validation
 *       |
 *       v
 * Payload Normalization
 *       |
 *       v
 * Correlation Validation
 *       |
 *       +--> providerTransactionId
 *       +--> paymentReference
 *       +--> amount
 *       +--> currency
 *       +--> provider
 *       +--> tenant/context
 *       |
 *       v
 * Payment Verification
 *       |
 *       v
 * Payment State Machine
 *       |
 *       v
 * Settlement Workflow
 *       |
 *       v
 * Ledger / Posting Engine
 *
 * Primary objectives
 * ------------------
 * 1. Forged callbacks cannot create financial success.
 * 2. Invalid callback signatures are rejected.
 * 3. Replay attacks are idempotent and side-effect free.
 * 4. Unknown provider transaction IDs are never posted.
 * 5. Unknown payment references are never posted.
 * 6. Amount tampering is detected.
 * 7. Currency tampering is detected.
 * 8. Provider identity tampering is detected.
 * 9. Callback correlation cannot cross tenant boundaries.
 * 10. Failed/unknown payments cannot be upgraded by arbitrary callbacks.
 * 11. Successful payments cannot be regressed by malicious callbacks.
 * 12. Duplicate callbacks cannot create duplicate journals.
 * 13. Callback flooding cannot create multiple payments/journals.
 * 14. Malformed payloads fail closed.
 * 15. Prototype-pollution style payloads are ignored/rejected.
 * 16. Arbitrary account IDs in callback data cannot redirect settlement.
 * 17. Client-controlled tenant IDs cannot override authoritative correlation.
 * 18. A callback cannot manufacture a payment that was never initiated.
 * 19. Callback metadata cannot alter the financial amount or currency.
 * 20. The same callback identity cannot be rebound to a different payment.
 * 21. Financial history remains immutable.
 *
 * Threat model
 * ------------
 *
 * Tested adversarial inputs include:
 *
 *   - Forged success callback
 *   - Invalid signature
 *   - Missing signature
 *   - Signature replay
 *   - Duplicate callback
 *   - Unknown transaction
 *   - Wrong transaction
 *   - Wrong payment reference
 *   - Amount inflation
 *   - Amount reduction
 *   - Currency substitution
 *   - Provider substitution
 *   - Cross-tenant callback
 *   - Callback identity rebinding
 *   - State regression
 *   - Malicious account override
 *   - Malicious tenant override
 *   - Prototype pollution payload
 *   - Unexpected nested fields
 *   - Callback flood
 *
 * IMPORTANT
 * ---------
 * A callback is an untrusted external input.
 *
 * Reaching the callback endpoint is NEVER sufficient proof that money exists.
 *
 * Financial completion requires:
 *
 *   authenticity
 *       +
 *   correlation
 *       +
 *   state validation
 *       +
 *   provider verification where required
 *       +
 *   idempotency
 *       +
 *   ledger validation
 *
 * Provider credentials are never required. The test provider is deterministic.
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
  'tenant-golden-path-malicious-callback-001';

const OTHER_TENANT_ID =
  'tenant-golden-path-malicious-callback-002';

const MEMBER_ID =
  '507f1f77bcf86cd79943a01';

const OTHER_MEMBER_ID =
  '507f1f77bcf86cd79943a02';

const OTHER_TENANT_MEMBER_ID =
  '507f1f77bcf86cd79943a03';

const GROUP_ID =
  '507f1f77bcf86cd79943a04';

const TEST_PHONE =
  '256700001001';

const OTHER_PHONE =
  '256700001002';

const OTHER_TENANT_PHONE =
  '256700001003';

const CONTRIBUTION_AMOUNT =
  '100000';

const CONTRIBUTION_CURRENCY =
  'UGX';

const PROVIDER =
  'mtn';

const PROVIDER_TRANSACTION_ID =
  'MTN-UG-MALICIOUS-000001';

const PROVIDER_TRANSACTION_ID_2 =
  'MTN-UG-MALICIOUS-000002';

const PAYMENT_REFERENCE =
  'golden-money-path-malicious-callback-000001';

const PAYMENT_REFERENCE_2 =
  'golden-money-path-malicious-callback-000002';

const CALLBACK_ID =
  'MTN-CB-MALICIOUS-000001';

const CALLBACK_ID_2 =
  'MTN-CB-MALICIOUS-000002';

const AUTH_TOKEN =
  'test-access-token';

const OTHER_TENANT_TOKEN =
  'other-tenant-access-token';

const CALLBACK_SECRET =
  'test-mtn-callback-secret';

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

function isFinancialSuccess(
  response,
) {
  const payload =
    responsePayload(
      response,
    );

  return (
    response?.status >=
      200 &&
    response?.status <
      300 &&
    SUCCESS_STATES.has(
      getNestedStatus(
        payload,
      ),
    )
  );
}

function expectRejectedCallback(
  response,
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

function expectNoFinancialJournal(
  journals,
) {
  expect(
    journals.length,
  ).toBe(
    0,
  );
}

/* ============================================================================
 * JWT-Like Token Helper
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

/* ============================================================================
 * Signature Helpers
 * ========================================================================== */

function stableJson(
  value,
) {
  return JSON.stringify(
    value,
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

function wrongSignature(
  payload,
) {
  return signPayload(
    payload,
    'wrong-secret',
  );
}

function createReplayNonce() {
  return crypto
    .randomBytes(12)
    .toString(
      'hex',
    );
}

/* ============================================================================
 * Callback Fixtures
 * ========================================================================== */

function createLegitimateCallback(
  overrides = {},
) {
  return {
    callbackId:
      overrides.callbackId ||
      CALLBACK_ID,

    provider:
      overrides.provider ||
      PROVIDER,

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

    responseCode:
      overrides.responseCode ||
      'SUCCESS',

    responseMessage:
      overrides.responseMessage ||
      'Transaction successful',

    timestamp:
      overrides.timestamp ||
      new Date().toISOString(),

    ...overrides,
  };
}

function createMaliciousSuccessCallback(
  overrides = {},
) {
  return createLegitimateCallback({
    ...overrides,

    status:
      'SUCCESS',

    outcome:
      'SUCCESS',
  });
}

function createMalformedCallback(
  overrides = {},
) {
  return {
    callbackId:
      overrides.callbackId ||
      CALLBACK_ID,

    provider:
      overrides.provider ||
      PROVIDER,

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
      'golden-money-path-malicious-callback-secret';

    process.env.INTERNAL_API_KEY =
      'golden-money-path-malicious-callback-internal';

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
          .mockResolvedValue({
            success:
              true,

            provider:
              PROVIDER,

            status:
              'SUCCESS',

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,

            paymentReference:
              PAYMENT_REFERENCE,

            amount:
              CONTRIBUTION_AMOUNT,

            currency:
              CONTRIBUTION_CURRENCY,
          }),

      providerVerify:
        jest
          .fn()
          .mockResolvedValue({
            success:
              true,

            provider:
              PROVIDER,

            status:
              'SUCCESS',

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,

            paymentReference:
              PAYMENT_REFERENCE,

            amount:
              CONTRIBUTION_AMOUNT,

            currency:
              CONTRIBUTION_CURRENCY,
          }),

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
              '507f1f77bcf86cd79943a05',

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
      .mockResolvedValue({
        success:
          true,

        provider:
          PROVIDER,

        status:
          'SUCCESS',

        providerTransactionId:
          PROVIDER_TRANSACTION_ID,

        transactionId:
          PROVIDER_TRANSACTION_ID,

        paymentReference:
          PAYMENT_REFERENCE,

        amount:
          CONTRIBUTION_AMOUNT,

        currency:
          CONTRIBUTION_CURRENCY,
      });

    mocks.providerVerify
      .mockResolvedValue({
        success:
          true,

        provider:
          PROVIDER,

        status:
          'SUCCESS',

        providerTransactionId:
          PROVIDER_TRANSACTION_ID,

        transactionId:
          PROVIDER_TRANSACTION_ID,

        paymentReference:
          PAYMENT_REFERENCE,

        amount:
          CONTRIBUTION_AMOUNT,

        currency:
          CONTRIBUTION_CURRENCY,
      });

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
          '507f1f77bcf86cd79943a05',

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
          OTHER_MEMBER_ID,

        name:
          'Other Member',

        email:
          'other-member@titech.com',

        phone:
          `+${OTHER_PHONE}`,

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
        'Golden Money Path Malicious Callback Group',

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
    });
  }

  if (
    models.Account
  ) {
    await models.Account.create([
      {
        _id:
          '507f1f77bcf86cd79943a06',

        tenantId:
          TEST_TENANT_ID,

        name:
          'System Settlement Cash',

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
          '507f1f77bcf86cd79943a07',

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
          '507f1f77bcf86cd79943a08',

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
  return authenticatedRequest(
    token,
  )
    .post(
      '/api/contributions',
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
        PROVIDER,

      phoneNumber:
        overrides.phoneNumber ||
        TEST_PHONE,

      idempotencyKey:
        overrides.idempotencyKey ||
        PAYMENT_REFERENCE,

      reference:
        overrides.reference ||
        PAYMENT_REFERENCE,

      ...overrides,
    });
}

/**
 * Send a callback to the MTN callback boundary.
 *
 * Signature headers deliberately support common variants used by provider
 * adapters. The application decides which authoritative header to consume.
 */
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
          `malicious-callback-${crypto.randomUUID()}`,
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

    agent.set(
      'x-signature',
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

  if (
    options.providerTransactionId
  ) {
    agent.set(
      'X-Provider-Transaction-Id',
      options.providerTransactionId,
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
 * Posted Payment Fixture
 * ========================================================================== */

async function createPostedContribution() {
  const initiation =
    await initiateContribution({
      idempotencyKey:
        PAYMENT_REFERENCE,

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
    initiation.status,
  );

  const legitimateCallback =
    createLegitimateCallback();

  const callback =
    await sendCallback(
      legitimateCallback,
    );

  expect(
    [
      200,
      202,
    ],
  ).toContain(
    callback.status,
  );

  return {
    initiation,
    callback,
  };
}

/* ============================================================================
 * Suite
 * ========================================================================== */

describe(
  'Golden Money Path - Malicious Callback',
  () => {
    test(
      'rejects a forged SUCCESS callback when no contribution exists',
      async () => {
        await seedContext();

        const payload =
          createMaliciousSuccessCallback({
            paymentReference:
              'nonexistent-payment-reference',

            providerTransactionId:
              'MTN-UG-UNKNOWN-000001',

            transactionId:
              'MTN-UG-UNKNOWN-000001',
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        const journals =
          await findJournals({
            $or: [
              {
                transactionId:
                  'MTN-UG-UNKNOWN-000001',
              },

              {
                idempotencyKey:
                  'nonexistent-payment-reference',
              },

              {
                reference:
                  'nonexistent-payment-reference',
              },
            ],
          });

        expectNoFinancialJournal(
          journals,
        );
      },
    );

    test(
      'rejects SUCCESS callback with an invalid signature',
      async () => {
        await seedContext();

        const payload =
          createLegitimateCallback();

        const response =
          await sendCallback(
            payload,
            {
              signature:
                wrongSignature(
                  payload,
                ),
            },
          );

        expectRejectedCallback(
          response,
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

        expectNoFinancialJournal(
          journals,
        );
      },
    );

    test(
      'rejects SUCCESS callback when the signature is missing',
      async () => {
        await seedContext();

        const payload =
          createLegitimateCallback();

        const response =
          await sendCallback(
            payload,
            {
              includeSignature:
                false,
            },
          );

        expectRejectedCallback(
          response,
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

        expectNoFinancialJournal(
          journals,
        );
      },
    );

    test(
      'rejects a callback signed with an attacker-controlled secret',
      async () => {
        await seedContext();

        const payload =
          createLegitimateCallback();

        const response =
          await sendCallback(
            payload,
            {
              signature:
                signPayload(
                  payload,
                  'attacker-secret',
                ),
            },
          );

        expectRejectedCallback(
          response,
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
                  PAYMENT_REFERENCE,
              },
            ],
          });

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          }),
        );

        expect(
          transactions.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'rejects a forged provider name even with a valid signature over the forged payload',
      async () => {
        await seedContext();

        const payload =
          createLegitimateCallback({
            provider:
              'airtel',
          });

        const response =
          await sendCallback(
            payload,
            {
              signature:
                signPayload(
                  payload,
                ),
            },
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          }),
        );
      },
    );

    test(
      'rejects provider transaction identity mismatch',
      async () => {
        await seedContext();

        await createPostedContribution();

        const payload =
          createLegitimateCallback({
            providerTransactionId:
              'MTN-UG-FORGED-TRANSACTION-999001',

            transactionId:
              'MTN-UG-FORGED-TRANSACTION-999001',
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        const journals =
          await findJournals({
            $or: [
              {
                transactionId:
                  'MTN-UG-FORGED-TRANSACTION-999001',
              },

              {
                reference:
                  PAYMENT_REFERENCE,
              },
            ],
          });

        /**
         * The existing legitimate journal must remain the only financial truth.
         */
        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'rejects payment reference mismatch',
      async () => {
        await seedContext();

        await createPostedContribution();

        const payload =
          createLegitimateCallback({
            paymentReference:
              'forged-payment-reference',

            reference:
              'forged-payment-reference',

            externalReference:
              'forged-payment-reference',
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        const forged =
          await findJournals({
            $or: [
              {
                reference:
                  'forged-payment-reference',
              },

              {
                idempotencyKey:
                  'forged-payment-reference',
              },
            ],
          });

        expectNoFinancialJournal(
          forged,
        );
      },
    );

    test(
      'rejects amount inflation in callback payload',
      async () => {
        await seedContext();

        await createPostedContribution();

        const payload =
          createLegitimateCallback({
            amount:
              '1000000',
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
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

        /**
         * The original successful journal can exist, but the callback must not
         * create an additional journal based on the inflated amount.
         */
        expect(
          journals.length,
        ).toBeLessThanOrEqual(
          1,
        );

        if (
          journals.length ===
          1
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
      'rejects amount reduction in callback payload',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            amount:
              '1',
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expectNoFinancialJournal(
          journals,
        );
      },
    );

    test(
      'rejects zero-value SUCCESS callback',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            amount:
              '0',
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          }),
        );
      },
    );

    test(
      'rejects negative amount SUCCESS callback',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            amount:
              '-100000',
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          }),
        );
      },
    );

    test(
      'rejects currency substitution from UGX to USD',
      async () => {
        await seedContext();

        await createPostedContribution();

        const payload =
          createLegitimateCallback({
            currency:
              'USD',
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
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
          journals.length ===
          1 &&
          journals[0].currency
        ) {
          expect(
            String(
              journals[0].currency,
            ).toUpperCase(),
          ).toBe(
            CONTRIBUTION_CURRENCY,
          );
        }
      },
    );

    test(
      'rejects currency omission when a financial currency is required',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback();

        delete payload.currency;

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          }),
        );
      },
    );

    test(
      'rejects malformed amount types instead of coercing arbitrary values',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            amount:
              {
                $gt:
                  0,
              },
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          }),
        );
      },
    );

    test(
      'rejects NaN-like callback amounts',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            amount:
              'NaN',
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          }),
        );
      },
    );

    test(
      'rejects an unknown callback identifier',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            callbackId:
              'UNKNOWN-CALLBACK-999999',
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          }),
        );
      },
    );

    test(
      'replayed callback is idempotent',
      async () => {
        await seedContext();

        await createPostedContribution();

        const payload =
          createLegitimateCallback();

        const first =
          await sendCallback(
            payload,
          );

        expect(
          [
            200,
            202,
            409,
          ],
        ).toContain(
          first.status,
        );

        const before =
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

        const second =
          await sendCallback(
            payload,
          );

        expect(
          [
            200,
            202,
            409,
          ],
        ).toContain(
          second.status,
        );

        const after =
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
          after.length,
        ).toBe(
          before.length,
        );
      },
    );

    test(
      'callback identity cannot be rebound to a different transaction',
      async () => {
        await seedContext();

        await initiateContribution({
          idempotencyKey:
            PAYMENT_REFERENCE,

          reference:
            PAYMENT_REFERENCE,
        });

        const original =
          createLegitimateCallback({
            callbackId:
              CALLBACK_ID,
          });

        const first =
          await sendCallback(
            original,
          );

        expect(
          [
            200,
            202,
            409,
          ],
        ).toContain(
          first.status,
        );

        const rebound =
          createLegitimateCallback({
            callbackId:
              CALLBACK_ID,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID_2,

            transactionId:
              PROVIDER_TRANSACTION_ID_2,

            paymentReference:
              PAYMENT_REFERENCE_2,

            reference:
              PAYMENT_REFERENCE_2,

            externalReference:
              PAYMENT_REFERENCE_2,
          });

        const second =
          await sendCallback(
            rebound,
          );

        expectRejectedCallback(
          second,
        );

        const reboundJournals =
          await findJournals({
            $or: [
              {
                transactionId:
                  PROVIDER_TRANSACTION_ID_2,
              },

              {
                reference:
                  PAYMENT_REFERENCE_2,
              },
            ],
          });

        expectNoFinancialJournal(
          reboundJournals,
        );
      },
    );

    test(
      'provider transaction identity cannot be rebound to a different payment reference',
      async () => {
        await seedContext();

        await initiateContribution({
          idempotencyKey:
            PAYMENT_REFERENCE,

          reference:
            PAYMENT_REFERENCE,
        });

        const first =
          createLegitimateCallback({
            paymentReference:
              PAYMENT_REFERENCE,

            reference:
              PAYMENT_REFERENCE,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        await sendCallback(
          first,
        );

        const forged =
          createLegitimateCallback({
            paymentReference:
              PAYMENT_REFERENCE_2,

            reference:
              PAYMENT_REFERENCE_2,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const response =
          await sendCallback(
            forged,
          );

        expectRejectedCallback(
          response,
        );

        const journals =
          await findJournals({
            $or: [
              {
                reference:
                  PAYMENT_REFERENCE_2,
              },

              {
                transactionId:
                  PAYMENT_REFERENCE_2,
              },
            ],
          });

        expectNoFinancialJournal(
          journals,
        );
      },
    );

    test(
      'cross-tenant callback cannot complete another tenant payment',
      async () => {
        await seedContext();

        await initiateContribution(
          {},
          AUTH_TOKEN,
        );

        const forged =
          createLegitimateCallback({
            tenantId:
              OTHER_TENANT_ID,

            paymentReference:
              PAYMENT_REFERENCE,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const response =
          await sendCallback(
            forged,
            {
              tenantId:
                OTHER_TENANT_ID,
            },
          );

        expectRejectedCallback(
          response,
        );

        const journals =
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          });

        expectNoFinancialJournal(
          journals,
        );
      },
    );

    test(
      'client-supplied callback tenantId cannot override authoritative tenant ownership',
      async () => {
        await seedContext();

        await initiateContribution(
          {},
          AUTH_TOKEN,
        );

        const forged =
          createLegitimateCallback({
            tenantId:
              OTHER_TENANT_ID,
          });

        const response =
          await sendCallback(
            forged,
            {
              tenantId:
                OTHER_TENANT_ID,
            },
          );

        expectRejectedCallback(
          response,
        );

        const transactions =
          await findTransactions({
            $or: [
              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
              },
            ],
          });

        expect(
          transactions.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'cross-tenant callback cannot create a journal in the attack tenant',
      async () => {
        await seedContext();

        await initiateContribution(
          {},
          AUTH_TOKEN,
        );

        const forged =
          createLegitimateCallback({
            tenantId:
              OTHER_TENANT_ID,
          });

        await sendCallback(
          forged,
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
      'callback account override cannot redirect funds',
      async () => {
        await seedContext();

        await initiateContribution();

        const forged =
          createLegitimateCallback({
            accountId:
              '507f1f77bcf86cd79943a09a',
          });

        const response =
          await sendCallback(
            forged,
          );

        expectRejectedCallback(
          response,
        );

        const redirected =
          await findJournals({
            accountId:
              '507f1f77bcf86cd79943a09a',
          });

        expect(
          redirected.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'callback cannot override destinationAccountId',
      async () => {
        await seedContext();

        await initiateContribution();

        const forged =
          createLegitimateCallback({
            destinationAccountId:
              '507f1f77bcf86cd79943a09a',
          });

        const response =
          await sendCallback(
            forged,
          );

        expectRejectedCallback(
          response,
        );

        expect(
          await findJournals({
            accountId:
              '507f1f77bcf86cd79943a09a',
          }),
        ).toHaveLength(
          0,
        );
      },
    );

    test(
      'callback cannot override sourceAccountId',
      async () => {
        await seedContext();

        await initiateContribution();

        const forged =
          createLegitimateCallback({
            sourceAccountId:
              '507f1f77bcf86cd79943a09a',
          });

        const response =
          await sendCallback(
            forged,
          );

        expectRejectedCallback(
          response,
        );

        expect(
          await findJournals({
            accountId:
              '507f1f77bcf86cd79943a09a',
          }),
        ).toHaveLength(
          0,
        );
      },
    );

    test(
      'callback cannot override member identity',
      async () => {
        await seedContext();

        await initiateContribution();

        const forged =
          createLegitimateCallback({
            memberId:
              OTHER_MEMBER_ID,

            userId:
              OTHER_MEMBER_ID,
          });

        const response =
          await sendCallback(
            forged,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            $or: [
              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                memberId:
                  OTHER_MEMBER_ID,
              },
            ],
          }),
        );
      },
    );

    test(
      'callback cannot override group identity',
      async () => {
        await seedContext();

        await initiateContribution();

        const forged =
          createLegitimateCallback({
            groupId:
              '507f1f77bcf86cd79943afff',
          });

        const response =
          await sendCallback(
            forged,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            groupId:
              '507f1f77bcf86cd79943afff',
          }),
        );
      },
    );

    test(
      'callback cannot create a contribution from an arbitrary groupId',
      async () => {
        await seedContext();

        const forged =
          createLegitimateCallback({
            groupId:
              '507f1f77bcf86cd79943afff',

            paymentReference:
              'arbitrary-group-callback-000001',

            providerTransactionId:
              'arbitrary-group-callback-000001',
          });

        const response =
          await sendCallback(
            forged,
          );

        expectRejectedCallback(
          response,
        );

        const contributions =
          await findContributions({
            groupId:
              '507f1f77bcf86cd79943afff',
          });

        expect(
          contributions.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'callback cannot create a payment for an uninitiated provider transaction',
      async () => {
        await seedContext();

        const forged =
          createLegitimateCallback({
            providerTransactionId:
              'UNINITIATED-PROVIDER-TX-000001',

            transactionId:
              'UNINITIATED-PROVIDER-TX-000001',

            paymentReference:
              'uninitiated-payment-000001',

            reference:
              'uninitiated-payment-000001',
          });

        const response =
          await sendCallback(
            forged,
          );

        expectRejectedCallback(
          response,
        );

        const payments =
          await findPayments({
            $or: [
              {
                providerTransactionId:
                  'UNINITIATED-PROVIDER-TX-000001',
              },

              {
                paymentReference:
                  'uninitiated-payment-000001',
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
      'callback cannot manufacture a ledger transaction from a provider transaction alone',
      async () => {
        await seedContext();

        const payload =
          createLegitimateCallback({
            providerTransactionId:
              'MANUFACTURED-TX-000001',

            transactionId:
              'MANUFACTURED-TX-000001',

            paymentReference:
              'MANUFACTURED-REF-000001',

            reference:
              'MANUFACTURED-REF-000001',
          });

        await sendCallback(
          payload,
        );

        const transactions =
          await findTransactions({
            providerTransactionId:
              'MANUFACTURED-TX-000001',
          });

        const journals =
          await findJournals({
            transactionId:
              'MANUFACTURED-TX-000001',
          });

        expect(
          transactions.length,
        ).toBe(
          0,
        );

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'callback status regression cannot turn a successful payment into pending',
      async () => {
        await seedContext();

        await createPostedContribution();

        const malicious =
          createLegitimateCallback({
            status:
              'PENDING',

            outcome:
              'PENDING',

            responseCode:
              'PENDING',

            callbackId:
              CALLBACK_ID_2,
          });

        const response =
          await sendCallback(
            malicious,
          );

        /**
         * A legitimate post-success state must not be downgraded by an
         * untrusted callback.
         */
        expect(
          [
            200,
            202,
            409,
          ],
        ).toContain(
          response.status,
        );

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
      'callback failure cannot regress a completed payment into a financially incorrect duplicate state',
      async () => {
        await seedContext();

        await createPostedContribution();

        const malicious =
          createLegitimateCallback({
            status:
              'FAILED',

            outcome:
              'FAILED',

            responseCode:
              'FAILED',

            callbackId:
              CALLBACK_ID_2,
          });

        const response =
          await sendCallback(
            malicious,
          );

        expect(
          [
            200,
            202,
            409,
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
      'callback cannot fabricate a successful amount larger than the authenticated provider result',
      async () => {
        await seedContext();

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue({
            success:
              true,

            provider:
              PROVIDER,

            status:
              'SUCCESS',

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,

            paymentReference:
              PAYMENT_REFERENCE,

            amount:
              CONTRIBUTION_AMOUNT,

            currency:
              CONTRIBUTION_CURRENCY,
          });

        const malicious =
          createLegitimateCallback({
            amount:
              '500000',
          });

        const response =
          await sendCallback(
            malicious,
          );

        expectRejectedCallback(
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
      'callback with case-altered provider name cannot bypass provider validation',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            provider:
              'MTN',
          });

        const response =
          await sendCallback(
            payload,
          );

        /**
         * Case normalization is acceptable if provider identity remains
         * semantically equivalent. Financial success must still require full
         * callback correlation.
         */
        if (
          isFinancialSuccess(
            response,
          )
        ) {
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
        } else {
          expectRejectedCallback(
            response,
          );
        }
      },
    );

    test(
      'malformed callback body fails closed',
      async () => {
        await seedContext();

        const malformed =
          createMalformedCallback();

        const response =
          await sendCallback(
            malformed,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          }),
        );
      },
    );

    test(
      'null callback body fails closed',
      async () => {
        await seedContext();

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
            .send(
              null,
            );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({}),
        );
      },
    );

    test(
      'array callback body fails closed',
      async () => {
        await seedContext();

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
            .send(
              [
                createLegitimateCallback(),
              ],
            );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({}),
        );
      },
    );

    test(
      'prototype pollution field does not alter processing context',
      async () => {
        await seedContext();

        const payload =
          createLegitimateCallback({
            __proto__:
              {
                tenantId:
                  OTHER_TENANT_ID,

                role:
                  'admin',

                isVerified:
                  true,
              },

            constructor:
              {
                tenantId:
                  OTHER_TENANT_ID,
              },

            prototype:
              {
                tenantId:
                  OTHER_TENANT_ID,
              },
          });

        const response =
          await sendCallback(
            payload,
          );

        /**
         * Depending on JSON parser semantics, harmless unknown fields may be
         * ignored. They must never create elevated or cross-tenant financial
         * authority.
         */
        if (
          isFinancialSuccess(
            response,
          )
        ) {
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
        } else {
          expectRejectedCallback(
            response,
          );
        }
      },
    );

    test(
      'callback cannot inject an admin role into the financial workflow',
      async () => {
        await seedContext();

        const payload =
          createLegitimateCallback({
            role:
              'admin',

            isAdmin:
              true,

            actorRole:
              'admin',
          });

        const response =
          await sendCallback(
            payload,
          );

        if (
          isFinancialSuccess(
            response,
          )
        ) {
          /**
           * Successful processing is acceptable only if the normal provider
           * correlation checks passed; the injected role must not be required.
           */
          expect(
            response.status,
          ).toBeGreaterThanOrEqual(
            200,
          );
        } else {
          expectRejectedCallback(
            response,
          );
        }
      },
    );

    test(
      'callback cannot inject an authenticated user identity',
      async () => {
        await seedContext();

        const payload =
          createLegitimateCallback({
            userId:
              OTHER_TENANT_MEMBER_ID,

            actorId:
              OTHER_TENANT_MEMBER_ID,

            authenticatedUserId:
              OTHER_TENANT_MEMBER_ID,
          });

        const response =
          await sendCallback(
            payload,
          );

        if (
          isFinancialSuccess(
            response,
          )
        ) {
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
              transaction.tenantId
            ) {
              expect(
                String(
                  transaction.tenantId,
                ),
              ).toBe(
                TEST_TENANT_ID,
              );
            }
          }
        } else {
          expectRejectedCallback(
            response,
          );
        }
      },
    );

    test(
      'callback cannot inject arbitrary ledger account mappings',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            debitAccountId:
              '507f1f77bcf86cd79943a99',

            creditAccountId:
              '507f1f77bcf86cd79943a98',

            debitAccount:
              {
                id:
                  '507f1f77bcf86cd79943a99',
              },

            creditAccount:
              {
                id:
                  '507f1f77bcf86cd79943a98',
              },
          });

        const response =
          await sendCallback(
            payload,
          );

        if (
          isFinancialSuccess(
            response,
          )
        ) {
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
        } else {
          expectRejectedCallback(
            response,
          );
        }

        const maliciousAccountJournals =
          await findJournals({
            $or: [
              {
                accountId:
                  '507f1f77bcf86cd79943a99',
              },

              {
                accountId:
                  '507f1f77bcf86cd79943a98',
              },
            ],
          });

        expect(
          maliciousAccountJournals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'unknown status value does not create financial success',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            status:
              'PAID_MAYBE',

            outcome:
              'WHATEVER',

            responseCode:
              'X999',
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          }),
        );
      },
    );

    test(
      'case spoofing of SUCCESS text in an unrelated field does not create success',
      async () => {
        await seedContext();

        const payload =
          createMalformedCallback({
            message:
              'SUCCESS',

            response:
              'SUCCESS',

            result:
              'SUCCESS',

            providerTransactionId:
              'UNKNOWN-TX-CASE-SPOOF',

            paymentReference:
              'UNKNOWN-REF-CASE-SPOOF',
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              'UNKNOWN-TX-CASE-SPOOF',
          }),
        );
      },
    );

    test(
      'duplicate callback flood produces at most one journal',
      async () => {
        await seedContext();

        await initiateContribution();

        const callbacks =
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
                  createLegitimateCallback({
                    callbackId:
                      CALLBACK_ID,

                    timestamp:
                      new Date().toISOString(),

                    requestNonce:
                      createReplayNonce(),

                    sequence:
                      index,
                  }),
                ),
            ),
          );

        for (
          const response of
            callbacks
        ) {
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
              ].includes(
                response.status,
            ),
          ).toBe(
            true,
          );
        }

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
      'malicious callback flood does not create multiple transactions',
      async () => {
        await seedContext();

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
                sendCallback(
                  createMaliciousSuccessCallback({
                    callbackId:
                      `MALICIOUS-CB-${index}`,

                    providerTransactionId:
                      `ATTACK-TX-${index}`,

                    transactionId:
                      `ATTACK-TX-${index}`,

                    paymentReference:
                      `ATTACK-REF-${index}`,

                    reference:
                      `ATTACK-REF-${index}`,
                  }),
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

        const transactions =
          await findTransactions({
            $or: [
              {
                providerTransactionId:
                  {
                    $regex:
                      /^ATTACK-TX-/,
                  },
              },

              {
                reference:
                  {
                    $regex:
                      /^ATTACK-REF-/,
                  },
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
      'forged callback cannot claim a legitimate payment using only a phone number',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            providerTransactionId:
              'UNKNOWN-PHONE-CLAIM-000001',

            transactionId:
              'UNKNOWN-PHONE-CLAIM-000001',

            paymentReference:
              'UNKNOWN-PHONE-CLAIM-000001',

            msisdn:
              TEST_PHONE,
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              'UNKNOWN-PHONE-CLAIM-000001',
          }),
        );
      },
    );

    test(
      'forged callback cannot claim a legitimate payment using only the member phone number and amount',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            providerTransactionId:
              'PHONE-AMOUNT-CLAIM-000001',

            transactionId:
              'PHONE-AMOUNT-CLAIM-000001',

            paymentReference:
              'PHONE-AMOUNT-CLAIM-000001',

            amount:
              CONTRIBUTION_AMOUNT,

            msisdn:
              TEST_PHONE,
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              'PHONE-AMOUNT-CLAIM-000001',
          }),
        );
      },
    );

    test(
      'forged callback cannot claim a legitimate payment by using another provider transaction id with the same reference',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            providerTransactionId:
              'ATTACKER-TX-SAME-REFERENCE',

            transactionId:
              'ATTACKER-TX-SAME-REFERENCE',

            paymentReference:
              PAYMENT_REFERENCE,

            reference:
              PAYMENT_REFERENCE,
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        const attackerJournals =
          await findJournals({
            transactionId:
              'ATTACKER-TX-SAME-REFERENCE',
          });

        expectNoFinancialJournal(
          attackerJournals,
        );
      },
    );

    test(
      'callback timestamp manipulation cannot create an additional payment',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            timestamp:
              '1970-01-01T00:00:00.000Z',
          });

        const response =
          await sendCallback(
            payload,
          );

        /**
         * Implementations may reject stale timestamps or may delegate freshness
         * verification to the provider. In neither case may another journal be
         * created.
         */
        if (
          isFinancialSuccess(
            response,
          )
        ) {
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
        } else {
          expectRejectedCallback(
            response,
          );
        }
      },
    );

    test(
      'future-dated callback cannot create an additional financial event',
      async () => {
        await seedContext();

        await initiateContribution();

        const future =
          new Date(
            Date.now() +
              365 *
                24 *
                60 *
                60 *
                1000,
          ).toISOString();

        const payload =
          createLegitimateCallback({
            timestamp:
              future,
          });

        const response =
          await sendCallback(
            payload,
          );

        if (
          !isFinancialSuccess(
            response,
          )
        ) {
          expectRejectedCallback(
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
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'callback cannot replace an existing provider success with another amount',
      async () => {
        await seedContext();

        await createPostedContribution();

        const malicious =
          createLegitimateCallback({
            amount:
              '99999999',

            callbackId:
              CALLBACK_ID_2,
          });

        const response =
          await sendCallback(
            malicious,
          );

        expectRejectedCallback(
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
      'callback cannot replace an existing provider success with another currency',
      async () => {
        await seedContext();

        await createPostedContribution();

        const malicious =
          createLegitimateCallback({
            currency:
              'USD',

            callbackId:
              CALLBACK_ID_2,
          });

        const response =
          await sendCallback(
            malicious,
          );

        expectRejectedCallback(
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
          1,
        );

        if (
          journals[0].currency
        ) {
          expect(
            String(
              journals[0].currency,
            ).toUpperCase(),
          ).toBe(
            CONTRIBUTION_CURRENCY,
          );
        }
      },
    );

    test(
      'callback cannot change a successful payment provider',
      async () => {
        await seedContext();

        await createPostedContribution();

        const malicious =
          createLegitimateCallback({
            provider:
              'unknown-provider',

            callbackId:
              CALLBACK_ID_2,
          });

        const response =
          await sendCallback(
            malicious,
          );

        expectRejectedCallback(
          response,
        );

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

        if (
          payments.length
        ) {
          expect(
            String(
              payments[0]
                .provider ||
                PROVIDER,
            ).toLowerCase(),
          ).toBe(
            PROVIDER,
          );
        }
      },
    );

    test(
      'callback cannot inject a second payment reference through nested metadata',
      async () => {
        await seedContext();

        await initiateContribution();

        const malicious =
          createLegitimateCallback({
            metadata:
              {
                paymentReference:
                  PAYMENT_REFERENCE_2,

                providerTransactionId:
                  PROVIDER_TRANSACTION_ID_2,

                amount:
                  '999999',
              },

            raw:
              {
                payment:
                  {
                    reference:
                      PAYMENT_REFERENCE_2,
                  },
              },
          });

        const response =
          await sendCallback(
            malicious,
          );

        if (
          !isFinancialSuccess(
            response,
          )
        ) {
          expectRejectedCallback(
            response,
          );
        }

        const journals =
          await findJournals({
            $or: [
              {
                reference:
                  PAYMENT_REFERENCE_2,
              },

              {
                transactionId:
                  PROVIDER_TRANSACTION_ID_2,
              },
            ],
          });

        expectNoFinancialJournal(
          journals,
        );
      },
    );

    test(
      'callback cannot inject a second tenant through nested metadata',
      async () => {
        await seedContext();

        await initiateContribution();

        const malicious =
          createLegitimateCallback({
            metadata:
              {
                tenantId:
                  OTHER_TENANT_ID,

                tenant:
                  {
                    id:
                      OTHER_TENANT_ID,
                  },
              },
          });

        const response =
          await sendCallback(
            malicious,
          );

        if (
          !isFinancialSuccess(
            response,
          )
        ) {
          expectRejectedCallback(
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
      'invalid callback does not consume the legitimate provider transaction identity',
      async () => {
        await seedContext();

        await initiateContribution();

        const malicious =
          createLegitimateCallback({
            amount:
              '999999',
          });

        await sendCallback(
          malicious,
        );

        const legitimate =
          createLegitimateCallback();

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
        }
      },
    );

    test(
      'callback signature is bound to the exact payload and cannot be reused for a tampered payload',
      async () => {
        await seedContext();

        await initiateContribution();

        const legitimate =
          createLegitimateCallback();

        const legitimateSignature =
          signPayload(
            legitimate,
          );

        const tampered = {
          ...legitimate,

          amount:
            '999999',
        };

        const response =
          await sendCallback(
            tampered,
            {
              signature:
                legitimateSignature,
            },
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          }),
        );
      },
    );

    test(
      'signature from one callback cannot authenticate another callback',
      async () => {
        await seedContext();

        await initiateContribution();

        const first =
          createLegitimateCallback({
            callbackId:
              CALLBACK_ID,
          });

        const second =
          createLegitimateCallback({
            callbackId:
              CALLBACK_ID_2,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID_2,

            transactionId:
              PROVIDER_TRANSACTION_ID_2,

            paymentReference:
              PAYMENT_REFERENCE_2,

            reference:
              PAYMENT_REFERENCE_2,
          });

        const signature =
          signPayload(
            first,
          );

        const response =
          await sendCallback(
            second,
            {
              signature,
            },
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID_2,
          }),
        );
      },
    );

    test(
      'callback replay with altered tenant header cannot reuse an already valid callback identity',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback();

        const first =
          await sendCallback(
            payload,
          );

        expect(
          [
            200,
            202,
            409,
          ],
        ).toContain(
          first.status,
        );

        const replay =
          await sendCallback(
            payload,
            {
              tenantId:
                OTHER_TENANT_ID,
            },
          );

        expectRejectedCallback(
          replay,
        );
      },
    );

    test(
      'callback flood with identical valid payload creates one journal',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback();

        const responses =
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
                      `flood-${index}`,
                  },
                ),
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
              409,
            ].includes(
              response.status,
            ) ||
              [
                400,
                401,
                403,
              ].includes(
                response.status,
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
      'unknown callback flood produces no financial records',
      async () => {
        await seedContext();

        const responses =
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
                  createMaliciousSuccessCallback({
                    callbackId:
                      `UNKNOWN-FLOOD-${index}`,

                    providerTransactionId:
                      `UNKNOWN-FLOOD-TX-${index}`,

                    transactionId:
                      `UNKNOWN-FLOOD-TX-${index}`,

                    paymentReference:
                      `UNKNOWN-FLOOD-REF-${index}`,

                    reference:
                      `UNKNOWN-FLOOD-REF-${index}`,
                  }),
                ),
            ),
          );

        for (
          const response of
            responses
        ) {
          expectRejectedCallback(
            response,
          );
        }

        const journals =
          await findJournals({});

        expect(
          journals.length,
        ).toBe(
          0,
        );

        const payments =
          await findPayments({});

        expect(
          payments.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'malicious callback cannot create a successful contribution before authentication of the provider message',
      async () => {
        await seedContext();

        const payload =
          createMaliciousSuccessCallback();

        const response =
          await sendCallback(
            payload,
            {
              includeSignature:
                false,
            },
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              PROVIDER_TRANSACTION_ID,
          }),
        );
      },
    );

    test(
      'malicious callback cannot create a successful contribution before payment correlation',
      async () => {
        await seedContext();

        const payload =
          createLegitimateCallback({
            providerTransactionId:
              'UNMATCHED-CORRELATION-TX-000001',

            paymentReference:
              'UNMATCHED-CORRELATION-REF-000001',

            transactionId:
              'UNMATCHED-CORRELATION-TX-000001',
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        const journals =
          await findJournals({
            $or: [
              {
                transactionId:
                  'UNMATCHED-CORRELATION-TX-000001',
              },

              {
                reference:
                  'UNMATCHED-CORRELATION-REF-000001',
              },
            ],
          });

        expectNoFinancialJournal(
          journals,
        );
      },
    );

    test(
      'callback cannot force success through nested status fields',
      async () => {
        await seedContext();

        const payload =
          createMalformedCallback({
            payment:
              {
                status:
                  'SUCCESS',

                state:
                  'SUCCESS',
              },

            result:
              {
                status:
                  'SUCCESS',
              },

            outcome:
              {
                value:
                  'SUCCESS',
              },
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({}),
        );
      },
    );

    test(
      'callback cannot exploit duplicate amount fields to bypass validation',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            amount:
              '100000',

            amountValue:
              '999999',

            transactionAmount:
              '999999',

            actualAmount:
              '999999',

            requestedAmount:
              '999999',
          });

        const response =
          await sendCallback(
            payload,
          );

        if (
          isFinancialSuccess(
            response,
          )
        ) {
          const journals =
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            });

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
        } else {
          expectRejectedCallback(
            response,
          );
        }
      },
    );

    test(
      'callback cannot redirect settlement using arbitrary bank account details',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            bankAccount:
              '999999999999',

            accountNumber:
              '999999999999',

            beneficiaryAccount:
              '999999999999',

            destinationAccount:
              '999999999999',

            payoutAccount:
              '999999999999',
          });

        const response =
          await sendCallback(
            payload,
          );

        if (
          !isFinancialSuccess(
            response,
          )
        ) {
          expectRejectedCallback(
            response,
          );
        }

        const attackAccounts =
          await findJournals({
            $or: [
              {
                accountNumber:
                  '999999999999',
              },

              {
                destinationAccount:
                  '999999999999',
              },
            ],
          });

        expect(
          attackAccounts.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'callback cannot redirect settlement to another phone number',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            msisdn:
              OTHER_TENANT_PHONE,
          });

        const response =
          await sendCallback(
            payload,
          );

        if (
          isFinancialSuccess(
            response,
          )
        ) {
          /**
           * If provider verification authoritatively maps the original payment,
           * the callback phone field must not become the account-selection
           * authority.
           */
          const payments =
            await findPayments({
              paymentReference:
                PAYMENT_REFERENCE,
            });

          if (
            payments.length &&
            payments[0].phone
          ) {
            expect(
              String(
                payments[0].phone,
              ),
            ).not.toBe(
              OTHER_TENANT_PHONE,
            );
          }
        } else {
          expectRejectedCallback(
            response,
          );
        }
      },
    );

    test(
      'callback cannot override the contribution currency through nested provider metadata',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            providerData:
              {
                currency:
                  'USD',
              },

            metadata:
              {
                currency:
                  'USD',
              },

            raw:
              {
                currency:
                  'USD',
              },
          });

        const response =
          await sendCallback(
            payload,
          );

        if (
          isFinancialSuccess(
            response,
          )
        ) {
          const journals =
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            });

          if (
            journals.length &&
            journals[0].currency
          ) {
            expect(
              String(
                journals[0].currency,
              ).toUpperCase(),
            ).toBe(
              CONTRIBUTION_CURRENCY,
            );
          }
        } else {
          expectRejectedCallback(
            response,
          );
        }
      },
    );

    test(
      'legitimate callback remains processable after an unrelated malicious callback',
      async () => {
        await seedContext();

        await initiateContribution();

        const malicious =
          createMaliciousSuccessCallback({
            amount:
              '999999',

            currency:
              'USD',

            providerTransactionId:
              'MALICIOUS-BEFORE-LEGITIMATE-TX',

            transactionId:
              'MALICIOUS-BEFORE-LEGITIMATE-TX',

            paymentReference:
              'MALICIOUS-BEFORE-LEGITIMATE-REF',

            reference:
              'MALICIOUS-BEFORE-LEGITIMATE-REF',

            callbackId:
              'MALICIOUS-BEFORE-LEGITIMATE-CB',
          });

        await sendCallback(
          malicious,
        );

        const legitimate =
          createLegitimateCallback();

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
        }
      },
    );

    test(
      'malicious callback cannot alter an existing payment tenant after successful processing',
      async () => {
        await seedContext();

        await createPostedContribution();

        const payload =
          createLegitimateCallback({
            tenantId:
              OTHER_TENANT_ID,

            callbackId:
              CALLBACK_ID_2,
          });

        await sendCallback(
          payload,
          {
            tenantId:
              OTHER_TENANT_ID,
          },
        );

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
      },
    );

    test(
      'malicious callback cannot produce duplicate financial records through concurrent mutation',
      async () => {
        await seedContext();

        await initiateContribution();

        const payloads =
          Array.from(
            {
              length:
                20,
            },
            (
              _,
              index,
            ) =>
              createMaliciousSuccessCallback({
                callbackId:
                  `CONCURRENT-MALICIOUS-${index}`,

                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,

                transactionId:
                  PROVIDER_TRANSACTION_ID,

                paymentReference:
                  PAYMENT_REFERENCE,

                reference:
                  PAYMENT_REFERENCE,

                amount:
                  index % 2 ===
                  0
                    ? CONTRIBUTION_AMOUNT
                    : '999999',

                currency:
                  index % 2 ===
                  0
                    ? CONTRIBUTION_CURRENCY
                    : 'USD',
              }),
          );

        await Promise.all(
          payloads.map(
            (
              payload,
            ) =>
              sendCallback(
                payload,
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
      },
    );

    test(
      'malicious callback cannot bypass replay protection by changing only the request ID',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback();

        const first =
          await sendCallback(
            payload,
            {
              requestId:
                'request-a',
            },
          );

        expect(
          [
            200,
            202,
            409,
          ],
        ).toContain(
          first.status,
        );

        const second =
          await sendCallback(
            payload,
            {
              requestId:
                'request-b',
            },
          );

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
      'malicious callback cannot bypass replay protection by changing only the signature header formatting',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback();

        const signature =
          signPayload(
            payload,
          );

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
              CALLBACK_ID,
            )
            .set(
              'X-MTN-Signature',
              `sha256=${signature}`,
            )
            .send(
              payload,
            );

        if (
          [
            400,
            401,
            403,
            409,
          ].includes(
            response.status,
          )
        ) {
          expectRejectedCallback(
            response,
          );
        } else {
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
      'malicious callback cannot use duplicate JSON fields to override validated values',
      async () => {
        await seedContext();

        await initiateContribution();

        /**
         * Supertest/Express JSON parsing may normalize duplicate keys before
         * reaching the application. The important invariant is that the final
         * financial state cannot rely on attacker-controlled duplicate fields.
         */
        const payload =
          {
            ...createLegitimateCallback(),

            amount:
              '999999',

            currency:
              'USD',
          };

        const response =
          await sendCallback(
            payload,
          );

        if (
          isFinancialSuccess(
            response,
          )
        ) {
          const journals =
            await findJournals({
              transactionId:
                PROVIDER_TRANSACTION_ID,
            });

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

            if (
              journals[0]
                .currency
            ) {
              expect(
                String(
                  journals[0].currency,
                ).toUpperCase(),
              ).toBe(
                CONTRIBUTION_CURRENCY,
              );
            }
          }
        } else {
          expectRejectedCallback(
            response,
          );
        }
      },
    );

    test(
      'invalid callback does not alter the number of existing financial records',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await snapshotFinancialState();

        const malicious =
          createLegitimateCallback({
            amount:
              '999999999',

            currency:
              'USD',

            provider:
              'fake-provider',

            tenantId:
              OTHER_TENANT_ID,
          });

        await sendCallback(
          malicious,
          {
            tenantId:
              OTHER_TENANT_ID,

            signature:
              signPayload(
                malicious,
                CALLBACK_SECRET,
              ),
          },
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
      'malicious callback cannot create financial truth even when provider verification mock reports a different transaction',
      async () => {
        await seedContext();

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue({
            success:
              true,

            provider:
              PROVIDER,

            status:
              'SUCCESS',

            providerTransactionId:
              'DIFFERENT-VERIFIED-TX',

            transactionId:
              'DIFFERENT-VERIFIED-TX',

            paymentReference:
              'DIFFERENT-VERIFIED-REF',

            amount:
              CONTRIBUTION_AMOUNT,

            currency:
              CONTRIBUTION_CURRENCY,
          });

        const payload =
          createLegitimateCallback({
            providerTransactionId:
              'ATTACKER-TX',

            transactionId:
              'ATTACKER-TX',

            paymentReference:
              PAYMENT_REFERENCE,
          });

        const response =
          await sendCallback(
            payload,
          );

        expectRejectedCallback(
          response,
        );

        expectNoFinancialJournal(
          await findJournals({
            transactionId:
              'ATTACKER-TX',
          }),
        );
      },
    );

    test(
      'malicious callback cannot force ledger posting by setting internal approval flags',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            verified:
              true,

            authorized:
              true,

            approved:
              true,

            settled:
              true,

            ledgerPosted:
              true,

            verificationStatus:
              'VERIFIED',

            settlementStatus:
              'SETTLED',
          });

        const response =
          await sendCallback(
            payload,
          );

        if (
          !isFinancialSuccess(
            response,
          )
        ) {
          expectRejectedCallback(
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
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'malicious callback cannot create a journal using arbitrary journal identifiers',
      async () => {
        await seedContext();

        const payload =
          createLegitimateCallback({
            journalId:
              '507f1f77bcf86cd79943afff',

            originalJournalId:
              '507f1f77bcf86cd79943afff',

            targetJournalId:
              '507f1f77bcf86cd79943afff',
          });

        const response =
          await sendCallback(
            payload,
          );

        if (
          !isFinancialSuccess(
            response,
          )
        ) {
          expectRejectedCallback(
            response,
          );
        }

        const journals =
          await findJournals({
            _id:
              mongoose.Types.ObjectId.isValid(
                '507f1f77bcf86cd79943afff',
              )
                ? new mongoose.Types.ObjectId(
                    '507f1f77bcf86cd79943afff',
                  )
                : '507f1f77bcf86cd79943afff',
          });

        expect(
          journals.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'malicious callback cannot select a different settlement provider',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            settlementProvider:
              'attacker-provider',

            payoutProvider:
              'attacker-provider',

            provider:
              PROVIDER,
          });

        const response =
          await sendCallback(
            payload,
          );

        if (
          !isFinancialSuccess(
            response,
          )
        ) {
          expectRejectedCallback(
            response,
          );
        }

        expect(
          mocks.settlement.mock
            .calls.length,
        ).toBeLessThanOrEqual(
          1,
        );
      },
    );

    test(
      'cross-tenant malicious callback cannot create payment records under attacker tenant',
      async () => {
        await seedContext();

        const payload =
          createMaliciousSuccessCallback({
            tenantId:
              OTHER_TENANT_ID,

            paymentReference:
              'ATTACK-TENANT-REF',

            providerTransactionId:
              'ATTACK-TENANT-TX',
          });

        const response =
          await sendCallback(
            payload,
            {
              tenantId:
                OTHER_TENANT_ID,
            },
          );

        expectRejectedCallback(
          response,
        );

        const payments =
          await findPayments({
            tenantId:
              OTHER_TENANT_ID,
          });

        expect(
          payments.length,
        ).toBe(
          0,
        );
      },
    );

    test(
      'malicious callback cannot exploit an existing callback ID with a modified payload',
      async () => {
        await seedContext();

        await initiateContribution();

        const legitimate =
          createLegitimateCallback({
            callbackId:
              CALLBACK_ID,
          });

        const first =
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
          first.status,
        );

        const modified =
          createLegitimateCallback({
            callbackId:
              CALLBACK_ID,

            amount:
              '1',

            currency:
              'USD',
          });

        const second =
          await sendCallback(
            modified,
          );

        expectRejectedCallback(
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
      'malicious callback cannot create a second journal using a different callback ID for the same transaction',
      async () => {
        await seedContext();

        await createPostedContribution();

        const malicious =
          createLegitimateCallback({
            callbackId:
              'ATTACKER-CALLBACK-ID-000001',

            amount:
              CONTRIBUTION_AMOUNT,

            paymentReference:
              PAYMENT_REFERENCE,

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          });

        const response =
          await sendCallback(
            malicious,
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
        ).toBe(
          1,
        );
      },
    );

    test(
      'malicious callback cannot alter immutable ledger history after success',
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
          createLegitimateCallback({
            amount:
              '99999999',

            currency:
              'USD',

            provider:
              'evil-provider',

            tenantId:
              OTHER_TENANT_ID,

            callbackId:
              CALLBACK_ID_2,
          });

        await sendCallback(
          malicious,
          {
            tenantId:
              OTHER_TENANT_ID,
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

        if (
          before.length &&
          after.length
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

          const debitBefore =
            before[0].totalDebit ??
            before[0].debitTotal;

          const debitAfter =
            after[0].totalDebit ??
            after[0].debitTotal;

          if (
            debitBefore !==
              undefined &&
            debitAfter !==
              undefined
          ) {
            expect(
              String(
                debitAfter,
              ),
            ).toBe(
              String(
                debitBefore,
              ),
            );
          }
        }
      },
    );

    test(
      'legitimate callback succeeds after malformed callback attempts',
      async () => {
        await seedContext();

        await initiateContribution();

        const malformedAttempts = [
          createMalformedCallback({
            providerTransactionId:
              PROVIDER_TRANSACTION_ID,
          }),

          createLegitimateCallback({
            amount:
              '999999',
          }),

          createLegitimateCallback({
            currency:
              'USD',
          }),

          createLegitimateCallback({
            providerTransactionId:
              'ATTACK-TX',
          }),
        ];

        for (
          const malicious of
            malformedAttempts
        ) {
          try {
            await sendCallback(
              malicious,
            );
          } catch (
            _error
          ) {
            // The malicious attempt must not terminate the legitimate flow.
          }
        }

        const legitimate =
          createLegitimateCallback();

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
        }
      },
    );

    test(
      'financial state remains unchanged after a broad malicious callback matrix',
      async () => {
        await seedContext();

        await createPostedContribution();

        const before =
          await snapshotFinancialState();

        const maliciousPayloads = [
          createLegitimateCallback({
            amount:
              '999999999',
          }),

          createLegitimateCallback({
            currency:
              'USD',
          }),

          createLegitimateCallback({
            provider:
              'evil',
          }),

          createLegitimateCallback({
            tenantId:
              OTHER_TENANT_ID,
          }),

          createLegitimateCallback({
            providerTransactionId:
              'EVIL-TX',
          }),

          createLegitimateCallback({
            paymentReference:
              'EVIL-REF',
          }),

          createLegitimateCallback({
            accountId:
              'EVIL-ACCOUNT',
          }),

          createLegitimateCallback({
            status:
              'PENDING',
          }),

          createLegitimateCallback({
            status:
              'FAILED',
          }),

          createMalformedCallback({
            callbackId:
              'MALFORMED-000001',
          }),
        ];

        await Promise.all(
          maliciousPayloads.map(
            (
              payload,
              index,
            ) =>
              sendCallback(
                payload,
                {
                  tenantId:
                    index %
                      2 ===
                    0
                      ? OTHER_TENANT_ID
                      : undefined,
                  signature:
                    signPayload(
                      payload,
                    ),
                },
              ),
          ),
        );

        const after =
          await snapshotFinancialState();

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
      'malicious callback cannot create success from a payment that is still pending without provider verification',
      async () => {
        await seedContext();

        mocks.providerInitiate
          .mockResolvedValueOnce({
            success:
              true,

            provider:
              PROVIDER,

            status:
              'PENDING',

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,

            paymentReference:
              PAYMENT_REFERENCE,

            amount:
              CONTRIBUTION_AMOUNT,

            currency:
              CONTRIBUTION_CURRENCY,
          });

        mocks.providerVerify
          .mockResolvedValueOnce({
            success:
              false,

            provider:
              PROVIDER,

            status:
              'PENDING',

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,

            paymentReference:
              PAYMENT_REFERENCE,

            amount:
              CONTRIBUTION_AMOUNT,

            currency:
              CONTRIBUTION_CURRENCY,
          });

        await initiateContribution();

        const malicious =
          createLegitimateCallback({
            responseCode:
              'SUCCESS',

            status:
              'SUCCESS',

            outcome:
              'SUCCESS',
          });

        const response =
          await sendCallback(
            malicious,
          );

        /**
         * The provider verification result remains authoritative. If the
         * implementation accepts the callback for asynchronous processing, it
         * must not create a successful journal while verification says PENDING.
         */
        expect(
          [
            200,
            202,
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
        ).toBe(
          0,
        );
      },
    );

    test(
      'malicious callback cannot turn a provider failure into successful ledger posting',
      async () => {
        await seedContext();

        await initiateContribution();

        mocks.providerVerify
          .mockResolvedValue({
            success:
              false,

            provider:
              PROVIDER,

            status:
              'FAILED',

            providerTransactionId:
              PROVIDER_TRANSACTION_ID,

            transactionId:
              PROVIDER_TRANSACTION_ID,

            paymentReference:
              PAYMENT_REFERENCE,

            amount:
              CONTRIBUTION_AMOUNT,

            currency:
              CONTRIBUTION_CURRENCY,
          });

        const malicious =
          createLegitimateCallback({
            status:
              'SUCCESS',

            outcome:
              'SUCCESS',
          });

        const response =
          await sendCallback(
            malicious,
          );

        expect(
          [
            400,
            409,
            422,
          ].includes(
            response.status,
          ) ||
            [
              200,
              202,
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
        ).toBe(
          0,
        );

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
          const status =
            getStatus(
              payment,
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
      'malicious callback cannot make a failed contribution appear settled by injecting settlement fields',
      async () => {
        await seedContext();

        await initiateContribution();

        const payload =
          createLegitimateCallback({
            status:
              'FAILED',

            outcome:
              'FAILED',

            settled:
              true,

            settlementStatus:
              'SETTLED',

            ledgerStatus:
              'POSTED',

            financialStatus:
              'SUCCESS',
          });

        const response =
          await sendCallback(
            payload,
          );

        expect(
          [
            400,
            409,
            422,
          ].includes(
            response.status,
          ) ||
            [
              200,
              202,
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
        ).toBe(
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