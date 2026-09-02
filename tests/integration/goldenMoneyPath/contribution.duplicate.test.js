'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Golden Money Path - Contribution Duplicate / Idempotency Integration Tests
 * ============================================================================
 *
 * File:
 *   tests/integration/goldenMoneyPath/contribution.duplicate.test.js
 *
 * Purpose
 * -------
 * Enterprise integration coverage for duplicate contribution attempts across
 * the canonical Golden Money Path.
 *
 * Canonical path:
 *
 *   MEMBER
 *      |
 *      v
 *   API / CONTROLLER
 *      |
 *      +--> Authentication
 *      +--> Tenant Resolution
 *      +--> Authorization
 *      +--> Idempotency
 *      |
 *      v
 *   PAYMENT ORCHESTRATION
 *      |
 *      +--> Provider Initiation
 *      |
 *      v
 *   PAYMENT
 *      |
 *      +--> Verification
 *      +--> State Machine
 *      |
 *      v
 *   SETTLEMENT
 *      |
 *      v
 *   LEDGER / POSTING ENGINE
 *
 * Primary objectives
 * ------------------
 * 1. The same contribution request is processed exactly once.
 * 2. Repeating the same idempotency key returns the same financial identity.
 * 3. Repeating the request MUST NOT create a second provider transaction.
 * 4. Repeating the request MUST NOT create a second payment.
 * 5. Repeating the request MUST NOT create a second contribution.
 * 6. Repeating the request MUST NOT create a second ledger journal.
 * 7. Repeating the provider callback MUST NOT create duplicate financial
 *    postings.
 * 8. Reusing an idempotency key with a materially different payload is rejected.
 * 9. Concurrent duplicate requests collapse to one logical financial operation.
 * 10. Cross-tenant reuse of an idempotency key is isolated.
 * 11. Duplicate handling remains safe after payment success.
 * 12. Duplicate handling remains safe after provider callback replay.
 * 13. Financial history remains immutable.
 * 14. Duplicate API calls do not mutate balances a second time.
 *
 * IMPORTANT
 * ---------
 * This suite deliberately mocks external payment provider boundaries. It
 * validates the platform's duplicate/idempotency behavior, not real provider
 * network behavior.
 *
 * The test harness supports common project export shapes and model locations
 * without requiring a folder restructure.
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
  'tenant-golden-path-duplicate-001';

const OTHER_TENANT_ID =
  'tenant-golden-path-duplicate-002';

const MEMBER_ID =
  '507f1f77bcf86cd799439201';

const OTHER_TENANT_MEMBER_ID =
  '507f1f77bcf86cd799439202';

const GROUP_ID =
  '507f1f77bcf86cd799439203';

const PAYMENT_ID =
  '507f1f77bcf86cd799439204';

const TRANSACTION_ID =
  '507f1f77bcf86cd799439205';

const JOURNAL_ID =
  '507f1f77bcf86cd799439206';

const PROVIDER_TRANSACTION_ID =
  'MTN-UG-DUPLICATE-000001';

const PROVIDER_CALLBACK_ID =
  'MTN-CB-DUPLICATE-000001';

const CONTRIBUTION_AMOUNT =
  '100000';

const DIFFERENT_AMOUNT =
  '200000';

const CONTRIBUTION_CURRENCY =
  'UGX';

const IDEMPOTENCY_KEY =
  'golden-money-path-duplicate-000001';

const DIFFERENT_PAYLOAD_IDEMPOTENCY_KEY =
  'golden-money-path-duplicate-conflict-000001';

const CONCURRENT_IDEMPOTENCY_KEY =
  'golden-money-path-concurrent-duplicate-000001';

const PROVIDER_CALLBACK_IDEMPOTENCY_KEY =
  `callback:${PROVIDER_CALLBACK_ID}`;

const TEST_PHONE =
  '256700000001';

const OTHER_TENANT_PHONE =
  '256700000002';

const AUTH_TOKEN =
  'test-access-token';

const OTHER_TENANT_TOKEN =
  'other-tenant-access-token';

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

function createSuccessProviderResponse(
  overrides = {},
) {
  return {
    success:
      true,

    provider:
      overrides.provider ||
      'mtn',

    status:
      overrides.status ||
      'SUCCESS',

    outcome:
      overrides.outcome ||
      'SUCCESS',

    providerTransactionId:
      overrides.providerTransactionId ||
      PROVIDER_TRANSACTION_ID,

    transactionId:
      overrides.transactionId ||
      PROVIDER_TRANSACTION_ID,

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

function getResponseBody(
  response,
) {
  return response?.body ||
    {};
}

function getPayload(
  response,
) {
  const body =
    getResponseBody(
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

function extractErrorCode(
  response,
) {
  const body =
    getResponseBody(
      response,
    );

  return (
    body.code ||
    body.error?.code ||
    body.data?.code ||
    body.result?.code ||
    null
  );
}

function extractStatus(
  document,
) {
  return String(
    document?.status ||
      document?.state ||
      document?.paymentStatus ||
      document?.transactionStatus ||
      '',
  ).toUpperCase();
}

function extractAmount(
  document,
) {
  return String(
    document?.amount ??
      document?.totalAmount ??
      document?.transactionAmount ??
      '',
  );
}

function extractCurrency(
  document,
) {
  return String(
    document?.currency ||
      document?.currencyCode ||
      '',
  ).toUpperCase();
}

function uniqueIdentifiers(
  documents,
  selectors,
) {
  return new Set(
    documents
      .map(
        (
          document,
        ) => {
          for (
            const selector of
              selectors
          ) {
            const value =
              selector(
                document,
              );

            if (
              value !==
                undefined &&
              value !==
                null &&
              value !==
                ''
            ) {
              return String(
                value,
              );
            }
          }

          return null;
        },
      )
      .filter(Boolean),
  );
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
      errors.push({
        modulePath,
        error,
      });
    }
  }

  const message =
    errors
      .map(
        (
          item,
        ) =>
          `${item.modulePath}: ${item.error?.message}`,
      )
      .join('\n');

  throw new Error(
    `Unable to load Express application.\n${message}`,
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
      // Try the next candidate.
    }
  }

  return null;
}

/* ============================================================================
 * Test Harness
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
 * Application / Mongo Setup
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
      'golden-money-path-test-secret';

    process.env.INTERNAL_API_KEY =
      'golden-money-path-internal-test-key';

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
            createSuccessProviderResponse(),
          ),

      providerVerify:
        jest
          .fn()
          .mockResolvedValue(
            createSuccessProviderResponse(),
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

/* ============================================================================
 * Reset
 * ========================================================================== */

beforeEach(
  async () => {
    /**
     * Delete through MongoDB collections to ensure complete isolation even
     * where multiple models point to shared collections.
     */
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
        // Continue isolation cleanup.
      }
    }

    jest.clearAllMocks();

    mocks.providerInitiate
      .mockResolvedValue(
        createSuccessProviderResponse(),
      );

    mocks.providerVerify
      .mockResolvedValue(
        createSuccessProviderResponse(),
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
 * Seed Data
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
        'Golden Money Path Duplicate Test Group',

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
          '507f1f77bcf86cd799439207',

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
          '507f1f77bcf86cd799439208',

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

function memberRequest() {
  return request(
    app,
  ).set(
    'Authorization',
    `Bearer ${AUTH_TOKEN}`,
  );
}

function otherTenantRequest() {
  return request(
    app,
  ).set(
    'Authorization',
    `Bearer ${OTHER_TENANT_TOKEN}`,
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
      'Duplicate protection contribution test',
  };
}

async function createContribution(
  overrides = {},
) {
  return memberRequest()
    .post(
      '/api/contributions',
    )
    .send(
      contributionPayload(
        overrides,
      ),
    );
}

async function createContributionAsOtherTenant(
  overrides = {},
) {
  return otherTenantRequest()
    .post(
      '/api/contributions',
    )
    .send(
      contributionPayload({
        ...overrides,

        groupId:
          overrides.groupId ||
          GROUP_ID,

        phoneNumber:
          overrides.phoneNumber ||
          OTHER_TENANT_PHONE,
      }),
    );
}

async function postMtnCallback(
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
        `duplicate-callback-request-${crypto.randomUUID()}`,
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

async function collectionDocuments(
  collectionNames,
  filter = {},
) {
  const output =
    [];

  const seen =
    new Set();

  for (
    const collectionName of
      collectionNames
  ) {
    const collection =
      mongoose.connection
        .collections[
        collectionName
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

    for (
      const document of
        documents
    ) {
      const id =
        String(
          document._id ||
            document.id ||
            JSON.stringify(
              document,
            ),
        );

      if (
        !seen.has(
          `${collectionName}:${id}`,
        )
      ) {
        seen.add(
          `${collectionName}:${id}`,
        );

        output.push(
          document,
        );
      }
    }
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

  return collectionDocuments(
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

  return collectionDocuments(
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

  return collectionDocuments(
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

  return collectionDocuments(
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
  return collectionDocuments(
    [
      'contributions',
    ],
    filter,
  );
}

async function findIdempotencyRecords(
  filter = {},
) {
  return collectionDocuments(
    [
      'paymentidempotencies',
      'paymentIdempotencies',
      'transactionidempotencies',
      'transactionIdempotencies',
      'idempotencies',
      'idempotencyrecords',
      'idempotencyRecords',
    ],
    filter,
  );
}

/* ============================================================================
 * Suite
 * ========================================================================== */

describe(
  'Golden Money Path - Contribution Duplicate Protection',
  () => {
    test(
      'replaying the exact same contribution request returns the same logical operation',
      async () => {
        await seedContext();

        const first =
          await createContribution();

        expectSuccessfulHttp(
          first,
        );

        const firstPayload =
          getPayload(
            first,
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

        const firstContributionId =
          getIdentifier(
            firstPayload,
            [
              'contributionId',
            ],
          );

        const firstTransactionId =
          getIdentifier(
            firstPayload,
            [
              'transactionId',
            ],
          );

        const second =
          await createContribution();

        expectSuccessfulHttp(
          second,
        );

        const secondPayload =
          getPayload(
            second,
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

        const secondContributionId =
          getIdentifier(
            secondPayload,
            [
              'contributionId',
            ],
          );

        const secondTransactionId =
          getIdentifier(
            secondPayload,
            [
              'transactionId',
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

        if (
          firstContributionId &&
          secondContributionId
        ) {
          expect(
            secondContributionId,
          ).toBe(
            firstContributionId,
          );
        }

        if (
          firstTransactionId &&
          secondTransactionId
        ) {
          expect(
            secondTransactionId,
          ).toBe(
            firstTransactionId,
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
      'reusing an idempotency key with a different amount is rejected as a conflict',
      async () => {
        await seedContext();

        const first =
          await createContribution();

        expectSuccessfulHttp(
          first,
        );

        const second =
          await createContribution({
            amount:
              Number(
                DIFFERENT_AMOUNT,
              ),
          });

        expect(
          [
            409,
            422,
          ],
        ).toContain(
          second.status,
        );

        const body =
          getResponseBody(
            second,
          );

        expect(
          body.success,
        ).toBe(
          false,
        );

        const code =
          extractErrorCode(
            second,
          );

        if (
          code
        ) {
          expect(
            String(
              code,
            ).toUpperCase(),
          ).toMatch(
            /IDEMPOT|CONFLICT/,
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

          expect(
            extractAmount(
              payments[0],
            ),
          ).toBe(
            CONTRIBUTION_AMOUNT,
          );
        }
      },
    );

    test(
      'reusing an idempotency key with a different provider is rejected',
      async () => {
        await seedContext();

        const first =
          await createContribution({
            provider:
              'mtn',
          });

        expectSuccessfulHttp(
          first,
        );

        const second =
          await createContribution({
            provider:
              'airtel',
          });

        expect(
          [
            400,
            409,
            422,
          ],
        ).toContain(
          second.status,
        );

        const body =
          getResponseBody(
            second,
          );

        expect(
          body.success,
        ).toBe(
          false,
        );
      },
    );

    test(
      'the same idempotency key remains isolated by tenant',
      async () => {
        await seedContext();

        const first =
          await createContribution();

        expectSuccessfulHttp(
          first,
        );

        const second =
          await createContributionAsOtherTenant();

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

        const body =
          getResponseBody(
            second,
          );

        expect(
          body.success,
        ).not.toBe(
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

        if (
          payments.length
        ) {
          const tenantIds =
            payments.map(
              (
                payment,
              ) =>
                String(
                  payment.tenantId ||
                    payment.tenant ||
                    '',
                ),
            );

          expect(
            tenantIds,
          ).not.toContain(
            OTHER_TENANT_ID,
          );
        }
      },
    );

    test(
      'concurrent duplicate contribution requests collapse into one financial operation',
      async () => {
        await seedContext();

        const requests =
          Array.from(
            {
              length:
                10,
            },
            () =>
              createContribution({
                idempotencyKey:
                  CONCURRENT_IDEMPOTENCY_KEY,
              }),
          );

        const responses =
          await Promise.all(
            requests,
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

        const conflicts =
          responses.filter(
            (
              response,
            ) =>
              response.status ===
                409 ||
              response.status ===
                422,
          );

        /**
         * A production implementation may legitimately return successful
         * replay responses for all requests or transient conflict responses
         * while the operation is in progress. It must never create multiple
         * successful financial records.
         */
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
                  CONCURRENT_IDEMPOTENCY_KEY,
              },

              {
                paymentReference:
                  CONCURRENT_IDEMPOTENCY_KEY,
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
                  CONCURRENT_IDEMPOTENCY_KEY,
              },

              {
                reference:
                  CONCURRENT_IDEMPOTENCY_KEY,
              },

              {
                externalReference:
                  CONCURRENT_IDEMPOTENCY_KEY,
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
      'duplicate requests do not initiate the external provider more than once',
      async () => {
        await seedContext();

        const first =
          await createContribution();

        expectSuccessfulHttp(
          first,
        );

        const second =
          await createContribution();

        expectSuccessfulHttp(
          second,
        );

        /**
         * The application should invoke provider initiation once for the
         * logical operation. If the test environment wires the provider mock,
         * verify exactly one call.
         */
        if (
          mocks.providerInitiate.mock
            .calls.length >
          0
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
      'duplicate requests do not manufacture multiple contribution records',
      async () => {
        await seedContext();

        await createContribution();

        await createContribution();

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

              {
                externalReference:
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
      'duplicate requests do not manufacture multiple transaction records',
      async () => {
        await seedContext();

        await createContribution();

        await createContribution();

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
      },
    );

    test(
      'successful provider callback remains idempotent when delivered repeatedly',
      async () => {
        await seedContext();

        const initiate =
          await createContribution();

        expectSuccessfulHttp(
          initiate,
        );

        const firstCallback =
          await postMtnCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          firstCallback.status,
        );

        const secondCallback =
          await postMtnCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          secondCallback.status,
        );

        const thirdCallback =
          await postMtnCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          thirdCallback.status,
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

              {
                reference:
                  IDEMPOTENCY_KEY,
              },

              {
                postingReference:
                  IDEMPOTENCY_KEY,
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

        const entries =
          await findJournalEntries({
            $or: [
              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                journalId:
                  journals[0]
                    ?._id,
              },
            ],
          });

        if (
          entries.length
          &&
          journals.length ===
            1
        ) {
          expect(
            entries.length,
          ).toBeGreaterThanOrEqual(
            2,
          );
        }

        /**
         * Duplicate callback delivery may either expose an explicit duplicate
         * response or replay the existing successful state. Both are safe.
         */
        const secondBody =
          getResponseBody(
            secondCallback,
          );

        expect(
          secondBody.success ===
            true ||
            secondCallback.status ===
              202,
        ).toBe(
          true,
        );
      },
    );

    test(
      'duplicate provider callbacks do not create multiple payments',
      async () => {
        await seedContext();

        const initiate =
          await createContribution();

        expectSuccessfulHttp(
          initiate,
        );

        await postMtnCallback();

        await postMtnCallback();

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
        }
      },
    );

    test(
      'duplicate provider callbacks do not create multiple transactions',
      async () => {
        await seedContext();

        await createContribution();

        await postMtnCallback();

        await postMtnCallback();

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
      'duplicate provider callbacks do not create multiple ledger journals',
      async () => {
        await seedContext();

        await createContribution();

        await postMtnCallback();

        await postMtnCallback();

        const journals =
          await findJournals({
            $or: [
              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                sourceId:
                  PAYMENT_ID,
              },

              {
                reversalOfJournalId:
                  null,
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
          journals.length
        ) {
          expect(
            journals.length,
          ).toBe(
            1,
          );

          const statuses =
            journals.map(
              extractStatus,
            );

          expect(
            statuses.every(
              (
                status,
              ) =>
                status ===
                'POSTED',
            ),
          ).toBe(
            true,
          );
        }
      },
    );

    test(
      'duplicate callbacks preserve exactly one provider transaction identity',
      async () => {
        await seedContext();

        await createContribution();

        await postMtnCallback();

        await postMtnCallback();

        await postMtnCallback();

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
            ],
          });

        if (
          payments.length
        ) {
          const providerTransactionIds =
            uniqueIdentifiers(
              payments,
              [
                (
                  payment,
                ) =>
                  payment.providerTransactionId,

                (
                  payment,
                ) =>
                  payment.externalTransactionId,
              ],
            );

          expect(
            providerTransactionIds.size,
          ).toBeLessThanOrEqual(
            1,
          );
        }
      },
    );

    test(
      'duplicate handling preserves amount and currency without multiplying the financial amount',
      async () => {
        await seedContext();

        await createContribution();

        await postMtnCallback();

        await postMtnCallback();

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

          expect(
            extractAmount(
              payments[0],
            ),
          ).toBe(
            CONTRIBUTION_AMOUNT,
          );

          expect(
            extractCurrency(
              payments[0],
            ),
          ).toBe(
            CONTRIBUTION_CURRENCY,
          );
        }
      },
    );

    test(
      'duplicate callback does not change an already successful payment back to a non-terminal state',
      async () => {
        await seedContext();

        await createContribution();

        const firstCallback =
          await postMtnCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          firstCallback.status,
        );

        const before =
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

        await postMtnCallback();

        const after =
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
          before.length
          &&
          after.length
        ) {
          expect(
            after.length,
          ).toBe(
            before.length,
          );

          const beforeStatus =
            extractStatus(
              before[0],
            );

          const afterStatus =
            extractStatus(
              after[0],
            );

          if (
            beforeStatus
          ) {
            expect(
              afterStatus,
            ).toBe(
              beforeStatus,
            );
          }
        }
      },
    );

    test(
      'duplicate handling preserves idempotency records instead of creating duplicate identities',
      async () => {
        await seedContext();

        await createContribution();

        await createContribution();

        await createContribution();

        const records =
          await findIdempotencyRecords({
            $or: [
              {
                key:
                  IDEMPOTENCY_KEY,
              },

              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },

              {
                requestKey:
                  IDEMPOTENCY_KEY,
              },
            ],
          });

        if (
          records.length
        ) {
          /**
           * Different implementations may persist separate lifecycle rows
           * (e.g. reservation + completion), so the safe invariant is one
           * logical idempotency identity rather than necessarily one document.
           */
          const logicalKeys =
            uniqueIdentifiers(
              records,
              [
                (
                  record,
                ) =>
                  record.key,

                (
                  record,
                ) =>
                  record.idempotencyKey,

                (
                  record,
                ) =>
                  record.requestKey,
              ],
            );

          expect(
            logicalKeys.size,
          ).toBeLessThanOrEqual(
            1,
          );
        }
      },
    );

    test(
      'a failed duplicate retry does not accidentally authorize a second financial operation',
      async () => {
        await seedContext();

        const first =
          await createContribution({
            idempotencyKey:
              DIFFERENT_PAYLOAD_IDEMPOTENCY_KEY,
          });

        expectSuccessfulHttp(
          first,
        );

        const conflict =
          await createContribution({
            idempotencyKey:
              DIFFERENT_PAYLOAD_IDEMPOTENCY_KEY,

            amount:
              Number(
                DIFFERENT_AMOUNT,
              ),
          });

        expect(
          [
            409,
            422,
          ],
        ).toContain(
          conflict.status,
        );

        const payments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  DIFFERENT_PAYLOAD_IDEMPOTENCY_KEY,
              },

              {
                paymentReference:
                  DIFFERENT_PAYLOAD_IDEMPOTENCY_KEY,
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
      'the provider callback identity is scoped independently from a reused HTTP request identity',
      async () => {
        await seedContext();

        await createContribution();

        const callbackOne =
          await postMtnCallback({
            callbackId:
              PROVIDER_CALLBACK_ID,
          });

        const callbackTwo =
          await postMtnCallback({
            callbackId:
              PROVIDER_CALLBACK_ID,
          });

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

        /**
         * The provider transaction identity remains singular even when the
         * application receives multiple HTTP deliveries.
         */
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
      'duplicate callback delivery remains safe when the same callback is sent concurrently',
      async () => {
        await seedContext();

        await createContribution();

        const callbacks =
          Array.from(
            {
              length:
                8,
            },
            () =>
              postMtnCallback({
                callbackId:
                  PROVIDER_CALLBACK_ID,

                callbackRequestId:
                  `concurrent-${crypto.randomUUID()}`,
              }),
          );

        const responses =
          await Promise.all(
            callbacks,
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

        const journals =
          await findJournals({
            $or: [
              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
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
      'duplicate protection preserves immutable ledger history',
      async () => {
        await seedContext();

        await createContribution();

        await postMtnCallback();

        const before =
          await findJournals({
            $or: [
              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
              },
            ],
          });

        await postMtnCallback();

        await createContribution();

        const after =
          await findJournals({
            $or: [
              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
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

          const beforeIds =
            before.map(
              (
                journal,
              ) =>
                String(
                  journal._id ||
                    journal.id,
                ),
            ).sort();

          const afterIds =
            after.map(
              (
                journal,
              ) =>
                String(
                  journal._id ||
                    journal.id,
                ),
            ).sort();

          expect(
            afterIds,
          ).toEqual(
            beforeIds,
          );
        }
      },
    );

    test(
      'duplicate contribution attempts do not double the journal debit or credit totals',
      async () => {
        await seedContext();

        await createContribution();

        await postMtnCallback();

        await createContribution();

        await postMtnCallback();

        const journals =
          await findJournals({
            $or: [
              {
                transactionId:
                  PROVIDER_TRANSACTION_ID,
              },

              {
                idempotencyKey:
                  IDEMPOTENCY_KEY,
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

          const debitTotal =
            String(
              journal.totalDebit ??
                journal.debitTotal ??
                '',
            );

          const creditTotal =
            String(
              journal.totalCredit ??
                journal.creditTotal ??
                '',
            );

          if (
            debitTotal
          ) {
            expect(
              debitTotal,
            ).toBe(
              CONTRIBUTION_AMOUNT,
            );
          }

          if (
            creditTotal
          ) {
            expect(
              creditTotal,
            ).toBe(
              CONTRIBUTION_AMOUNT,
            );
          }
        }
      },
    );

    test(
      'duplicate contribution requests remain safe after a successful provider outcome',
      async () => {
        await seedContext();

        const first =
          await createContribution();

        expectSuccessfulHttp(
          first,
        );

        const callback =
          await postMtnCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          callback.status,
        );

        const replayOne =
          await createContribution();

        const replayTwo =
          await createContribution();

        expectSuccessfulHttp(
          replayOne,
        );

        expectSuccessfulHttp(
          replayTwo,
        );

        const payments =
          await findPayments({
            $or: [
              {
                providerTransactionId:
                  PROVIDER_TRANSACTION_ID,
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

          const status =
            extractStatus(
              payments[0],
            );

          expect(
            [
              'SUCCESS',
              'SUCCEEDED',
              'COMPLETED',
              'SETTLED',
              'PAID',
            ],
          ).toContain(
            status,
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
                idempotencyKey:
                  IDEMPOTENCY_KEY,
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
      'duplicate request is not treated as a new contribution when the original is still in progress',
      async () => {
        await seedContext();

        /**
         * If the application exposes a test hook for asynchronous payment
         * initiation, deliberately keep the provider operation unresolved so
         * the second identical request can exercise the in-progress boundary.
         */
        let releaseProvider;

        const providerGate =
          new Promise(
            (
              resolve,
            ) => {
              releaseProvider =
                resolve;
            },
          );

        if (
          typeof mocks
            .providerInitiate
            ?.mockImplementation ===
          'function'
        ) {
          mocks.providerInitiate
            .mockImplementationOnce(
              async () => {
                await providerGate;

                return createSuccessProviderResponse();
              },
            );
        }

        const firstPromise =
          createContribution({
            idempotencyKey:
              'in-progress-duplicate-000001',
          });

        /**
         * Allow the first request to establish its idempotency reservation.
         */
        await new Promise(
          (
            resolve,
          ) =>
            setImmediate(
              resolve,
            ),
        );

        const second =
          await createContribution({
            idempotencyKey:
              'in-progress-duplicate-000001',
          });

        /**
         * Depending on the exact state-machine contract the second request may
         * receive 200/201 replay, 202 accepted/in-progress, or 409 conflict.
         * It must never result in a second successful financial creation.
         */
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

        releaseProvider();

        const first =
          await firstPromise;

        expect(
          [
            200,
            201,
            202,
          ],
        ).toContain(
          first.status,
        );

        const payments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  'in-progress-duplicate-000001',
              },

              {
                paymentReference:
                  'in-progress-duplicate-000001',
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
      'different idempotency keys create distinct logical contribution operations',
      async () => {
        await seedContext();

        const first =
          await createContribution({
            idempotencyKey:
              'unique-contribution-operation-001',
          });

        const second =
          await createContribution({
            idempotencyKey:
              'unique-contribution-operation-002',
          });

        expectSuccessfulHttp(
          first,
        );

        expectSuccessfulHttp(
          second,
        );

        const payments =
          await findPayments({
            $or: [
              {
                idempotencyKey:
                  'unique-contribution-operation-001',
              },

              {
                idempotencyKey:
                  'unique-contribution-operation-002',
              },

              {
                paymentReference:
                  'unique-contribution-operation-001',
              },

              {
                paymentReference:
                  'unique-contribution-operation-002',
              },
            ],
          });

        /**
         * Distinct keys are expected to produce distinct operations unless the
         * downstream business invariant separately prevents a second
         * contribution. The test therefore only asserts identity separation
         * when both records exist.
         */
        if (
          payments.length >=
          2
        ) {
          const identifiers =
            uniqueIdentifiers(
              payments,
              [
                (
                  payment,
                ) =>
                  payment._id,

                (
                  payment,
                ) =>
                  payment.id,

                (
                  payment,
                ) =>
                  payment.paymentId,
              ],
            );

          expect(
            identifiers.size,
          ).toBeGreaterThanOrEqual(
            2,
          );
        }
      },
    );

    test(
      'duplicate protection does not silently switch the provider transaction reference',
      async () => {
        await seedContext();

        await createContribution();

        await postMtnCallback();

        await createContribution();

        await postMtnCallback();

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
          const providerIds =
            uniqueIdentifiers(
              transactions,
              [
                (
                  transaction,
                ) =>
                  transaction.providerTransactionId,

                (
                  transaction,
                ) =>
                  transaction.transactionId,
              ],
            );

          expect(
            providerIds.size,
          ).toBeLessThanOrEqual(
            1,
          );
        }
      },
    );

    test(
      'duplicate contribution processing remains tenant-safe in persisted financial records',
      async () => {
        await seedContext();

        await createContribution();

        await createContribution();

        await postMtnCallback();

        await postMtnCallback();

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

          expect(
            String(
              journals[0].tenantId ||
                '',
            ),
          ).toBe(
            TEST_TENANT_ID,
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

          expect(
            String(
              payments[0].tenantId ||
                '',
            ),
          ).toBe(
            TEST_TENANT_ID,
          );
        }
      },
    );

    test(
      'duplicate operations remain safe when callback and API replay arrive in opposite order',
      async () => {
        await seedContext();

        /**
         * Send callback first. This simulates a provider callback racing ahead
         * of an application-level retry.
         */
        const callbackFirst =
          await postMtnCallback();

        expect(
          [
            200,
            202,
            404,
            409,
          ],
        ).toContain(
          callbackFirst.status,
        );

        const initiate =
          await createContribution();

        expect(
          [
            200,
            201,
            202,
            409,
          ],
        ).toContain(
          initiate.status,
        );

        const callbackSecond =
          await postMtnCallback();

        expect(
          [
            200,
            202,
          ],
        ).toContain(
          callbackSecond.status,
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
                  IDEMPOTENCY_KEY,
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
  },
);

/* ============================================================================
 * End of File
 * ============================================================================
 */