'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Golden Money Path - Enterprise Integration Test Fixtures
 * ============================================================================
 *
 * File:
 *   tests/integration/goldenMoneyPath/goldenMoneyPath.fixtures.js
 *
 * Purpose
 * -------
 * Centralized, deterministic fixtures and builders for the Golden Money Path
 * integration-test suite.
 *
 * This module is intentionally free of Jest test cases. It provides shared
 * primitives for:
 *
 *   - tenants
 *   - users / members
 *   - groups
 *   - financial accounts
 *   - contribution requests
 *   - idempotency keys
 *   - provider transactions
 *   - provider callbacks
 *   - verification responses
 *   - settlement responses
 *   - ledger posting responses
 *   - failure scenarios
 *   - reconciliation mismatches
 *   - malicious payloads
 *   - JWT-like test tokens
 *   - signatures
 *   - deterministic identifiers
 *
 * Design goals
 * ------------
 * 1. Deterministic
 * 2. Side-effect free
 * 3. No network calls
 * 4. No database dependency
 * 5. No Jest dependency
 * 6. Safe for parallel test execution
 * 7. Easy to override
 * 8. Financially explicit
 * 9. Tenant-aware
 * 10. Provider-aware
 * 11. Idempotency-aware
 * 12. State-machine-aware
 *
 * Monetary representation
 * -----------------------
 * Financial amounts are represented as integers in the fixture layer.
 * Production code should continue to use the project's authoritative monetary
 * representation and avoid floating-point arithmetic for financial postings.
 *
 * Canonical contribution
 * ----------------------
 *
 * MEMBER
 *   |
 *   v
 * CONTRIBUTION REQUEST
 *   |
 *   v
 * IDEMPOTENCY
 *   |
 *   v
 * PAYMENT ORCHESTRATION
 *   |
 *   v
 * PROVIDER
 *   |
 *   v
 * CALLBACK
 *   |
 *   v
 * VERIFICATION
 *   |
 *   v
 * RECONCILIATION
 *   |
 *   v
 * SETTLEMENT
 *   |
 *   v
 * DOUBLE-ENTRY LEDGER
 *
 * ============================================================================
 */

/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULTS = Object.freeze({
  tenantId:
    'tenant-golden-money-path-test-001',

  secondaryTenantId:
    'tenant-golden-money-path-test-002',

  memberId:
    '507f1f77bcf86cd799440001',

  secondaryMemberId:
    '507f1f77bcf86cd799440002',

  adminId:
    '507f1f77bcf86cd799440003',

  moderatorId:
    '507f1f77bcf86cd799440004',

  externalMemberId:
    '507f1f77bcf86cd799440005',

  groupId:
    '507f1f77bcf86cd799440006',

  secondaryGroupId:
    '507f1f77bcf86cd799440007',

  memberAccountId:
    '507f1f77bcf86cd799440008',

  groupAccountId:
    '507f1f77bcf86cd799440009',

  cashAccountId:
    '507f1f77bcf86cd79944000a',

  contributionsAccountId:
    '507f1f77bcf86cd79944000b',

  otherTenantAccountId:
    '507f1f77bcf86cd79944000c',

  wrongAccountId:
    '507f1f77bcf86cd79944000d',

  disabledAccountId:
    '507f1f77bcf86cd79944000e',

  frozenAccountId:
    '507f1f77bcf86cd79944000f',

  wrongCurrencyAccountId:
    '507f1f77bcf86cd799440010',

  providerTransactionId:
    'MTN-UG-GMP-000001',

  secondaryProviderTransactionId:
    'MTN-UG-GMP-000002',

  callbackId:
    'MTN-CB-GMP-000001',

  secondaryCallbackId:
    'MTN-CB-GMP-000002',

  paymentReference:
    'GMP-CONTRIBUTION-000001',

  secondaryPaymentReference:
    'GMP-CONTRIBUTION-000002',

  idempotencyKey:
    'GMP-IDEMPOTENCY-000001',

  secondaryIdempotencyKey:
    'GMP-IDEMPOTENCY-000002',

  reconciliationId:
    'GMP-RECON-000001',

  settlementId:
    'GMP-SETTLEMENT-000001',

  journalId:
    '507f1f77bcf86cd799440011',

  transactionId:
    '507f1f77bcf86cd799440012',

  paymentId:
    '507f1f77bcf86cd799440013',

  contributionId:
    '507f1f77bcf86cd799440014',

  currency:
    'UGX',

  wrongCurrency:
    'USD',

  amount:
    100000,

  secondaryAmount:
    60000,

  mismatchAmount:
    125000,

  lowAmount:
    1,

  phone:
    '256700001401',

  secondaryPhone:
    '256700001402',

  externalPhone:
    '256700001403',

  callbackSecret:
    'golden-money-path-test-callback-secret',

  jwtSecret:
    'golden-money-path-test-jwt-secret',

  provider:
    'mtn',

  secondaryProvider:
    'airtel',

  environment:
    'sandbox',
});

const STATES = Object.freeze({
  payment: Object.freeze({
    CREATED:
      'CREATED',

    INITIATED:
      'INITIATED',

    PENDING:
      'PENDING',

    PROCESSING:
      'PROCESSING',

    AWAITING_CALLBACK:
      'AWAITING_CALLBACK',

    VERIFYING:
      'VERIFYING',

    VERIFIED:
      'VERIFIED',

    RECONCILIATION_REQUIRED:
      'RECONCILIATION_REQUIRED',

    SETTLEMENT_PENDING:
      'SETTLEMENT_PENDING',

    SETTLED:
      'SETTLED',

    SUCCESS:
      'SUCCESS',

    FAILED:
      'FAILED',

    CANCELLED:
      'CANCELLED',

    REFUNDED:
      'REFUNDED',

    REVERSED:
      'REVERSED',
  }),

  transaction: Object.freeze({
    CREATED:
      'CREATED',

    PENDING:
      'PENDING',

    PROCESSING:
      'PROCESSING',

    SUCCESS:
      'SUCCESS',

    FAILED:
      'FAILED',

    REVERSED:
      'REVERSED',

    REFUNDED:
      'REFUNDED',

    CANCELLED:
      'CANCELLED',
  }),

  ledger: Object.freeze({
    DRAFT:
      'DRAFT',

    VALIDATING:
      'VALIDATING',

    POSTING:
      'POSTING',

    POSTED:
      'POSTED',

    REVERSED:
      'REVERSED',

    FAILED:
      'FAILED',
  }),

  reconciliation: Object.freeze({
    MATCHED:
      'MATCHED',

    MISMATCH:
      'MISMATCH',

    PENDING:
      'PENDING',

    INVESTIGATION_REQUIRED:
      'INVESTIGATION_REQUIRED',

    MANUAL_REVIEW:
      'MANUAL_REVIEW',

    RESOLVED:
      'RESOLVED',

    DISMISSED:
      'DISMISSED',
  }),
});

const ROLES = Object.freeze({
  MEMBER:
    'member',

  ADMIN:
    'admin',

  MODERATOR:
    'moderator',

  SYSTEM:
    'system',

  SERVICE:
    'service',
});

const ACCOUNT_TYPES = Object.freeze({
  ASSET:
    'ASSET',

  LIABILITY:
    'LIABILITY',

  EQUITY:
    'EQUITY',

  REVENUE:
    'REVENUE',

  EXPENSE:
    'EXPENSE',
});

const ACCOUNT_STATUSES = Object.freeze({
  ACTIVE:
    'ACTIVE',

  DISABLED:
    'DISABLED',

  FROZEN:
    'FROZEN',

  CLOSED:
    'CLOSED',
});

const PAYMENT_METHODS = Object.freeze({
  MOBILE_MONEY:
    'mobile_money',

  BANK_TRANSFER:
    'bank_transfer',

  CASH:
    'cash',
});

const CALLBACK_OUTCOMES = Object.freeze({
  SUCCESS:
    'SUCCESS',

  PENDING:
    'PENDING',

  FAILED:
    'FAILED',

  UNKNOWN:
    'UNKNOWN',
});

/* ============================================================================
 * Utility Functions
 * ========================================================================== */

function clone(
  value,
) {
  if (
    value ===
      null ||
    value ===
      undefined
  ) {
    return value;
  }

  if (
    typeof structuredClone ===
    'function'
  ) {
    return structuredClone(
      value,
    );
  }

  return JSON.parse(
    JSON.stringify(
      value,
    ),
  );
}

function merge(
  base,
  overrides = {},
) {
  return {
    ...clone(
      base,
    ),
    ...clone(
      overrides,
    ),
  };
}

function deepMerge(
  base,
  overrides = {},
) {
  const result =
    clone(
      base,
    );

  for (
    const [
      key,
      value,
    ] of Object.entries(
      overrides,
    )
  ) {
    if (
      value &&
      typeof value ===
        'object' &&
      !Array.isArray(
        value,
      ) &&
      result[key] &&
      typeof result[key] ===
        'object' &&
      !Array.isArray(
        result[key],
      )
    ) {
      result[key] =
        deepMerge(
          result[key],
          value,
        );
    } else {
      result[key] =
        clone(
          value,
        );
    }
  }

  return result;
}

function randomHex(
  length = 16,
) {
  return require('crypto')
    .randomBytes(
      Math.ceil(
        length / 2,
      ),
    )
    .toString(
      'hex',
    )
    .slice(
      0,
      length,
    );
}

function randomId(
  prefix = 'GMP',
  sequence = randomHex(
    12,
  ),
) {
  return `${prefix}-${sequence}`;
}

function deterministicObjectId(
  suffix,
) {
  const normalized =
    String(
      suffix,
    )
      .replace(
        /[^a-fA-F0-9]/g,
        '0',
      )
      .padEnd(
        24,
        '0',
      )
      .slice(
        0,
        24,
      );

  return normalized;
}

function isoNow() {
  return new Date()
    .toISOString();
}

function isoPast(
  milliseconds = 60000,
) {
  return new Date(
    Date.now() -
      milliseconds,
  ).toISOString();
}

function isoFuture(
  milliseconds = 60000,
) {
  return new Date(
    Date.now() +
      milliseconds,
  ).toISOString();
}

function numericAmount(
  amount,
) {
  if (
    amount ===
      null ||
    amount ===
      undefined
  ) {
    return DEFAULTS.amount;
  }

  const number =
    Number(
      amount,
    );

  if (
    !Number.isFinite(
      number,
    )
  ) {
    throw new TypeError(
      `Invalid financial amount: ${amount}`,
    );
  }

  if (
    number <
    0
  ) {
    throw new RangeError(
      `Financial amount cannot be negative: ${amount}`,
    );
  }

  return number;
}

function stringAmount(
  amount,
) {
  return String(
    numericAmount(
      amount,
    ),
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

function signHmacSha256(
  payload,
  secret = DEFAULTS.callbackSecret,
) {
  return require('crypto')
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
    .digest(
      'hex',
    );
}

function buildSignatureHeaders(
  payload,
  options = {},
) {
  const signature =
    options.signature !==
      undefined
      ? options.signature
      : signHmacSha256(
          payload,
          options.secret ||
            DEFAULTS.callbackSecret,
        );

  return {
    'x-mtn-signature':
      signature,

    'x-signature':
      signature,

    'x-callback-id':
      options.callbackId ||
      payload.callbackId ||
      DEFAULTS.callbackId,

    'x-request-id':
      options.requestId ||
      randomId(
        'GMP-REQUEST',
      ),

    'x-webhook-id':
      options.webhookId ||
      payload.callbackId ||
      DEFAULTS.callbackId,
  };
}

/* ============================================================================
 * Token Fixtures
 * ========================================================================== */

function createTokenPayload(
  overrides = {},
) {
  return {
    sub:
      overrides.sub ||
      DEFAULTS.memberId,

    tenantId:
      overrides.tenantId ||
      DEFAULTS.tenantId,

    role:
      overrides.role ||
      ROLES.MEMBER,

    email:
      overrides.email ||
      'justine@titech.com',

    isVerified:
      overrides.isVerified !==
      undefined
        ? overrides.isVerified
        : true,

    status:
      overrides.status ||
      'active',

    iat:
      overrides.iat ||
      Math.floor(
        Date.now() /
          1000,
      ),

    exp:
      overrides.exp ||
      Math.floor(
        Date.now() /
          1000,
      ) +
        3600,

    ...overrides,
  };
}

function createJwtLikeToken(
  overrides = {},
) {
  return Buffer.from(
    JSON.stringify(
      createTokenPayload(
        overrides,
      ),
    ),
  ).toString(
    'base64url',
  );
}

function createAuthorizationHeader(
  overrides = {},
) {
  return `Bearer ${createJwtLikeToken(
    overrides,
  )}`;
}

function memberToken(
  overrides = {},
) {
  return createJwtLikeToken({
    sub:
      DEFAULTS.memberId,

    tenantId:
      DEFAULTS.tenantId,

    role:
      ROLES.MEMBER,

    email:
      'justine@titech.com',

    ...overrides,
  });
}

function secondMemberToken(
  overrides = {},
) {
  return createJwtLikeToken({
    sub:
      DEFAULTS.secondaryMemberId,

    tenantId:
      DEFAULTS.tenantId,

    role:
      ROLES.MEMBER,

    email:
      'member2@titech.com',

    ...overrides,
  });
}

function adminToken(
  overrides = {},
) {
  return createJwtLikeToken({
    sub:
      DEFAULTS.adminId,

    tenantId:
      DEFAULTS.tenantId,

    role:
      ROLES.ADMIN,

    email:
      'admin@titech.com',

    ...overrides,
  });
}

function moderatorToken(
  overrides = {},
) {
  return createJwtLikeToken({
    sub:
      DEFAULTS.moderatorId,

    tenantId:
      DEFAULTS.tenantId,

    role:
      ROLES.MODERATOR,

    email:
      'moderator@titech.com',

    ...overrides,
  });
}

function otherTenantToken(
  overrides = {},
) {
  return createJwtLikeToken({
    sub:
      DEFAULTS.externalMemberId,

    tenantId:
      DEFAULTS.secondaryTenantId,

    role:
      ROLES.MEMBER,

    email:
      'other-tenant@titech.com',

    ...overrides,
  });
}

function serviceToken(
  overrides = {},
) {
  return createJwtLikeToken({
    sub:
      '507f1f77bcf86cd799440099',

    tenantId:
      DEFAULTS.tenantId,

    role:
      ROLES.SERVICE,

    email:
      'service@titech.com',

    ...overrides,
  });
}

/* ============================================================================
 * Tenant Fixtures
 * ========================================================================== */

function tenant(
  overrides = {},
) {
  return deepMerge(
    {
      _id:
        DEFAULTS.tenantId,

      id:
        DEFAULTS.tenantId,

      name:
        'TITech Community Capital Ltd - Test Tenant',

      slug:
        'titech-golden-money-path-test',

      status:
        'active',

      isActive:
        true,

      currency:
        DEFAULTS.currency,

      country:
        'UG',

      timezone:
        'Africa/Kampala',

      environment:
        DEFAULTS.environment,

      settings:
        {
          currency:
            DEFAULTS.currency,

          paymentProviders:
            [
              DEFAULTS.provider,
              DEFAULTS.secondaryProvider,
            ],

          idempotencyRequired:
            true,

          reconciliationRequired:
            true,
        },

      createdAt:
        isoPast(
          86400000,
        ),

      updatedAt:
        isoNow(),
    },
    overrides,
  );
}

function secondaryTenant(
  overrides = {},
) {
  return tenant({
    _id:
      DEFAULTS.secondaryTenantId,

    id:
      DEFAULTS.secondaryTenantId,

    name:
      'TITech Community Capital Ltd - Secondary Test Tenant',

    slug:
      'titech-golden-money-path-test-secondary',

    ...overrides,
  });
}

/* ============================================================================
 * User / Member Fixtures
 * ========================================================================== */

function member(
  overrides = {},
) {
  return deepMerge(
    {
      _id:
        DEFAULTS.memberId,

      id:
        DEFAULTS.memberId,

      tenantId:
        DEFAULTS.tenantId,

      name:
        'Justine Robert',

      email:
        'justine@titech.com',

      phone:
        `+${DEFAULTS.phone}`,

      role:
        ROLES.MEMBER,

      status:
        'active',

      isActive:
        true,

      isVerified:
        true,

      kycStatus:
        'verified',

      accountId:
        DEFAULTS.memberAccountId,

      groups:
        [
          DEFAULTS.groupId,
        ],

      createdAt:
        isoPast(
          86400000,
        ),

      updatedAt:
        isoNow(),
    },
    overrides,
  );
}

function secondaryMember(
  overrides = {},
) {
  return deepMerge(
    {
      _id:
        DEFAULTS.secondaryMemberId,

      id:
        DEFAULTS.secondaryMemberId,

      tenantId:
        DEFAULTS.tenantId,

      name:
        'Second Test Member',

      email:
        'member2@titech.com',

      phone:
        `+${DEFAULTS.secondaryPhone}`,

      role:
        ROLES.MEMBER,

      status:
        'active',

      isActive:
        true,

      isVerified:
        true,

      kycStatus:
        'verified',

      groups:
        [
          DEFAULTS.groupId,
        ],

      createdAt:
        isoPast(
          86400000,
        ),

      updatedAt:
        isoNow(),
    },
    overrides,
  );
}

function admin(
  overrides = {},
) {
  return deepMerge(
    {
      _id:
        DEFAULTS.adminId,

      id:
        DEFAULTS.adminId,

      tenantId:
        DEFAULTS.tenantId,

      name:
        'TITech Test Administrator',

      email:
        'admin@titech.com',

      phone:
        '+256700001499',

      role:
        ROLES.ADMIN,

      status:
        'active',

      isActive:
        true,

      isVerified:
        true,

      kycStatus:
        'verified',

      createdAt:
        isoPast(
          86400000,
        ),

      updatedAt:
        isoNow(),
    },
    overrides,
  );
}

function otherTenantMember(
  overrides = {},
) {
  return deepMerge(
    {
      _id:
        DEFAULTS.externalMemberId,

      id:
        DEFAULTS.externalMemberId,

      tenantId:
        DEFAULTS.secondaryTenantId,

      name:
        'Other Tenant Member',

      email:
        'other-tenant@titech.com',

      phone:
        `+${DEFAULTS.externalPhone}`,

      role:
        ROLES.MEMBER,

      status:
        'active',

      isActive:
        true,

      isVerified:
        true,

      kycStatus:
        'verified',

      accountId:
        DEFAULTS.otherTenantAccountId,

      createdAt:
        isoPast(
          86400000,
        ),

      updatedAt:
        isoNow(),
    },
    overrides,
  );
}

/* ============================================================================
 * Group Fixtures
 * ========================================================================== */

function group(
  overrides = {},
) {
  return deepMerge(
    {
      _id:
        DEFAULTS.groupId,

      id:
        DEFAULTS.groupId,

      tenantId:
        DEFAULTS.tenantId,

      name:
        'Golden Money Path Test Group',

      code:
        'GMP-TEST-001',

      status:
        'active',

      isActive:
        true,

      currency:
        DEFAULTS.currency,

      members:
        [
          DEFAULTS.memberId,
          DEFAULTS.secondaryMemberId,
        ],

      ownerId:
        DEFAULTS.memberId,

      contributionFrequency:
        'monthly',

      minimumContribution:
        10000,

      maximumContribution:
        5000000,

      accountId:
        DEFAULTS.groupAccountId,

      createdAt:
        isoPast(
          86400000,
        ),

      updatedAt:
        isoNow(),
    },
    overrides,
  );
}

function secondaryGroup(
  overrides = {},
) {
  return group({
    _id:
      DEFAULTS.secondaryGroupId,

    id:
      DEFAULTS.secondaryGroupId,

    name:
      'Golden Money Path Secondary Group',

    code:
      'GMP-TEST-002',

    members:
      [
        DEFAULTS.secondaryMemberId,
      ],

    ...overrides,
  });
}

/* ============================================================================
 * Account Fixtures
 * ========================================================================== */

function account(
  overrides = {},
) {
  return deepMerge(
    {
      _id:
        DEFAULTS.memberAccountId,

      id:
        DEFAULTS.memberAccountId,

      tenantId:
        DEFAULTS.tenantId,

      ownerId:
        DEFAULTS.memberId,

      name:
        'Justine Robert Contribution Account',

      code:
        'MEM-001',

      currency:
        DEFAULTS.currency,

      type:
        ACCOUNT_TYPES.LIABILITY,

      accountType:
        'MEMBER_CONTRIBUTION',

      status:
        ACCOUNT_STATUSES.ACTIVE,

      isActive:
        true,

      isPostable:
        true,

      balance:
        0,

      debitBalance:
        0,

      creditBalance:
        0,

      availableBalance:
        0,

      ledgerBalance:
        0,

      pendingBalance:
        0,

      reservedBalance:
        0,

      createdAt:
        isoPast(
          86400000,
        ),

      updatedAt:
        isoNow(),
    },
    overrides,
  );
}

function memberAccount(
  overrides = {},
) {
  return account(
    {
      ...overrides,
      _id:
        overrides._id ||
        DEFAULTS.memberAccountId,

      id:
        overrides.id ||
        DEFAULTS.memberAccountId,

      ownerId:
        overrides.ownerId ||
        DEFAULTS.memberId,

      accountType:
        overrides.accountType ||
        'MEMBER_CONTRIBUTION',
    },
  );
}

function groupAccount(
  overrides = {},
) {
  return account({
    _id:
      overrides._id ||
      DEFAULTS.groupAccountId,

    id:
      overrides.id ||
      DEFAULTS.groupAccountId,

    ownerId:
      overrides.ownerId ||
      DEFAULTS.groupId,

    name:
      overrides.name ||
      'Golden Money Path Group Account',

    code:
      overrides.code ||
      'GRP-001',

    accountType:
      overrides.accountType ||
      'GROUP_CONTRIBUTION',

    type:
      overrides.type ||
      ACCOUNT_TYPES.LIABILITY,

    ...overrides,
  });
}

function cashAccount(
  overrides = {},
) {
  return account({
    _id:
      overrides._id ||
      DEFAULTS.cashAccountId,

    id:
      overrides.id ||
      DEFAULTS.cashAccountId,

    ownerId:
      overrides.ownerId ||
      null,

    name:
      overrides.name ||
      'Provider Settlement Cash',

    code:
      overrides.code ||
      '1010',

    accountType:
      overrides.accountType ||
      'CASH',

    type:
      overrides.type ||
      ACCOUNT_TYPES.ASSET,

    ...overrides,
  });
}

function otherTenantAccount(
  overrides = {},
) {
  return account({
    _id:
      overrides._id ||
      DEFAULTS.otherTenantAccountId,

    id:
      overrides.id ||
      DEFAULTS.otherTenantAccountId,

    tenantId:
      overrides.tenantId ||
      DEFAULTS.secondaryTenantId,

    ownerId:
      overrides.ownerId ||
      DEFAULTS.externalMemberId,

    name:
      overrides.name ||
      'Other Tenant Contribution Account',

    code:
      overrides.code ||
      'OTH-001',

    ...overrides,
  });
}

function wrongAccount(
  overrides = {},
) {
  return account({
    _id:
      overrides._id ||
      DEFAULTS.wrongAccountId,

    id:
      overrides.id ||
      DEFAULTS.wrongAccountId,

    ownerId:
      overrides.ownerId ||
      DEFAULTS.secondaryMemberId,

    name:
      overrides.name ||
      'Wrong Member Account',

    code:
      overrides.code ||
      'MEM-WRONG',

    ...overrides,
  });
}

function disabledAccount(
  overrides = {},
) {
  return account({
    _id:
      overrides._id ||
      DEFAULTS.disabledAccountId,

    id:
      overrides.id ||
      DEFAULTS.disabledAccountId,

    ownerId:
      overrides.ownerId ||
      DEFAULTS.memberId,

    status:
      ACCOUNT_STATUSES.DISABLED,

    isActive:
      false,

    isPostable:
      false,

    name:
      overrides.name ||
      'Disabled Member Account',

    ...overrides,
  });
}

function frozenAccount(
  overrides = {},
) {
  return account({
    _id:
      overrides._id ||
      DEFAULTS.frozenAccountId,

    id:
      overrides.id ||
      DEFAULTS.frozenAccountId,

    ownerId:
      overrides.ownerId ||
      DEFAULTS.memberId,

    status:
      ACCOUNT_STATUSES.FROZEN,

    isActive:
      false,

    isPostable:
      false,

    name:
      overrides.name ||
      'Frozen Member Account',

    ...overrides,
  });
}

function wrongCurrencyAccount(
  overrides = {},
) {
  return account({
    _id:
      overrides._id ||
      DEFAULTS.wrongCurrencyAccountId,

    id:
      overrides.id ||
      DEFAULTS.wrongCurrencyAccountId,

    ownerId:
      overrides.ownerId ||
      DEFAULTS.memberId,

    currency:
      overrides.currency ||
      DEFAULTS.wrongCurrency,

    name:
      overrides.name ||
      'Wrong Currency Account',

    ...overrides,
  });
}

/* ============================================================================
 * Contribution Request Fixtures
 * ========================================================================== */

function contributionRequest(
  overrides = {},
) {
  const idempotencyKey =
    overrides.idempotencyKey ||
    DEFAULTS.idempotencyKey;

  const reference =
    overrides.reference ||
    DEFAULTS.paymentReference;

  return deepMerge(
    {
      groupId:
        DEFAULTS.groupId,

      tenantId:
        DEFAULTS.tenantId,

      memberId:
        DEFAULTS.memberId,

      userId:
        DEFAULTS.memberId,

      amount:
        DEFAULTS.amount,

      currency:
        DEFAULTS.currency,

      paymentMethod:
        PAYMENT_METHODS.MOBILE_MONEY,

      provider:
        DEFAULTS.provider,

      phoneNumber:
        DEFAULTS.phone,

      idempotencyKey,

      reference,

      paymentReference:
        reference,

      description:
        'Golden Money Path test contribution',

      metadata:
        {
          source:
            'integration-test',

          testSuite:
            'goldenMoneyPath',
        },

      requestedAt:
        isoNow(),
    },
    overrides,
  );
}

function secondaryContributionRequest(
  overrides = {},
) {
  return contributionRequest({
    groupId:
      DEFAULTS.groupId,

    tenantId:
      DEFAULTS.tenantId,

    memberId:
      DEFAULTS.secondaryMemberId,

    userId:
      DEFAULTS.secondaryMemberId,

    amount:
      DEFAULTS.secondaryAmount,

    phoneNumber:
      DEFAULTS.secondaryPhone,

    idempotencyKey:
      DEFAULTS.secondaryIdempotencyKey,

    reference:
      DEFAULTS.secondaryPaymentReference,

    paymentReference:
      DEFAULTS.secondaryPaymentReference,

    ...overrides,
  });
}

function malformedContributionRequest(
  overrides = {},
) {
  return {
    groupId:
      overrides.groupId ||
      DEFAULTS.groupId,

    amount:
      overrides.amount,

    currency:
      overrides.currency,

    paymentMethod:
      overrides.paymentMethod,

    provider:
      overrides.provider,

    phoneNumber:
      overrides.phoneNumber,

    ...overrides,
  };
}

/* ============================================================================
 * Idempotency Fixtures
 * ========================================================================== */

function idempotencyRecord(
  overrides = {},
) {
  return deepMerge(
    {
      _id:
        deterministicObjectId(
          '000000000000000000000101',
        ),

      key:
        DEFAULTS.idempotencyKey,

      idempotencyKey:
        DEFAULTS.idempotencyKey,

      tenantId:
        DEFAULTS.tenantId,

      memberId:
        DEFAULTS.memberId,

      requestHash:
        'test-request-hash',

      resourceType:
        'contribution',

      resourceId:
        DEFAULTS.paymentId,

      status:
        'COMPLETED',

      responseStatus:
        201,

      responseBody:
        {
          success:
            true,
        },

      expiresAt:
        isoFuture(
          86400000,
        ),

      createdAt:
        isoPast(
          60000,
        ),

      updatedAt:
        isoNow(),
    },
    overrides,
  );
}

function idempotencyConflict(
  overrides = {},
) {
  return idempotencyRecord({
    status:
      'CONFLICT',

    responseStatus:
      409,

    conflictReason:
      'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',

    ...overrides,
  });
}

function idempotencyPending(
  overrides = {},
) {
  return idempotencyRecord({
    status:
      'PROCESSING',

    responseStatus:
      202,

    responseBody:
      {
        success:
          true,

        status:
          'processing',
      },

    ...overrides,
  });
}

/* ============================================================================
 * Payment Fixtures
 * ========================================================================== */

function payment(
  overrides = {},
) {
  return deepMerge(
    {
      _id:
        DEFAULTS.paymentId,

      id:
        DEFAULTS.paymentId,

      tenantId:
        DEFAULTS.tenantId,

      memberId:
        DEFAULTS.memberId,

      userId:
        DEFAULTS.memberId,

      groupId:
        DEFAULTS.groupId,

      provider:
        DEFAULTS.provider,

      providerTransactionId:
        DEFAULTS.providerTransactionId,

      transactionId:
        DEFAULTS.transactionId,

      paymentReference:
        DEFAULTS.paymentReference,

      reference:
        DEFAULTS.paymentReference,

      externalReference:
        DEFAULTS.paymentReference,

      idempotencyKey:
        DEFAULTS.idempotencyKey,

      amount:
        DEFAULTS.amount,

      currency:
        DEFAULTS.currency,

      paymentMethod:
        PAYMENT_METHODS.MOBILE_MONEY,

      phoneNumber:
        DEFAULTS.phone,

      status:
        STATES.payment.SUCCESS,

      providerStatus:
        STATES.payment.SUCCESS,

      reconciliationStatus:
        STATES.reconciliation.MATCHED,

      verificationStatus:
        'VERIFIED',

      settlementStatus:
        'SETTLED',

      ledgerStatus:
        STATES.ledger.POSTED,

      isFinal:
        true,

      createdAt:
        isoPast(
          60000,
        ),

      updatedAt:
        isoNow(),

      completedAt:
        isoNow(),
    },
    overrides,
  );
}

function pendingPayment(
  overrides = {},
) {
  return payment({
    status:
      STATES.payment.PENDING,

    providerStatus:
      STATES.payment.PENDING,

    reconciliationStatus:
      STATES.reconciliation.PENDING,

    verificationStatus:
      'PENDING',

    settlementStatus:
      'PENDING',

    ledgerStatus:
      STATES.ledger.DRAFT,

    isFinal:
      false,

    completedAt:
      null,

    ...overrides,
  });
}

function processingPayment(
  overrides = {},
) {
  return payment({
    status:
      STATES.payment.PROCESSING,

    providerStatus:
      STATES.payment.PROCESSING,

    reconciliationStatus:
      STATES.reconciliation.PENDING,

    verificationStatus:
      'PENDING',

    settlementStatus:
      'PENDING',

    ledgerStatus:
      STATES.ledger.VALIDATING,

    isFinal:
      false,

    completedAt:
      null,

    ...overrides,
  });
}

function failedPayment(
  overrides = {},
) {
  return payment({
    status:
      STATES.payment.FAILED,

    providerStatus:
      STATES.payment.FAILED,

    reconciliationStatus:
      STATES.reconciliation.MATCHED,

    verificationStatus:
      'FAILED',

    settlementStatus:
      'FAILED',

    ledgerStatus:
      STATES.ledger.FAILED,

    isFinal:
      true,

    completedAt:
      null,

    failureCode:
      overrides.failureCode ||
      'PROVIDER_DECLINED',

    failureReason:
      overrides.failureReason ||
      'Provider reported transaction failure',

    ...overrides,
  });
}

function reconciliationHoldPayment(
  overrides = {},
) {
  return payment({
    status:
      STATES.payment.RECONCILIATION_REQUIRED,

    providerStatus:
      STATES.payment.SUCCESS,

    reconciliationStatus:
      STATES.reconciliation.INVESTIGATION_REQUIRED,

    verificationStatus:
      'MISMATCH',

    settlementStatus:
      'HELD',

    ledgerStatus:
      STATES.ledger.VALIDATING,

    isFinal:
      false,

    completedAt:
      null,

    ...overrides,
  });
}

/* ============================================================================
 * Transaction Fixtures
 * ========================================================================== */

function transaction(
  overrides = {},
) {
  return deepMerge(
    {
      _id:
        DEFAULTS.transactionId,

      id:
        DEFAULTS.transactionId,

      tenantId:
        DEFAULTS.tenantId,

      memberId:
        DEFAULTS.memberId,

      groupId:
        DEFAULTS.groupId,

      type:
        'CONTRIBUTION',

      source:
        'MOBILE_MONEY',

      provider:
        DEFAULTS.provider,

      providerTransactionId:
        DEFAULTS.providerTransactionId,

      paymentReference:
        DEFAULTS.paymentReference,

      reference:
        DEFAULTS.paymentReference,

      externalReference:
        DEFAULTS.paymentReference,

      idempotencyKey:
        DEFAULTS.idempotencyKey,

      amount:
        DEFAULTS.amount,

      currency:
        DEFAULTS.currency,

      status:
        STATES.transaction.SUCCESS,

      state:
        STATES.transaction.SUCCESS,

      accountId:
        DEFAULTS.memberAccountId,

      debitAccountId:
        DEFAULTS.cashAccountId,

      creditAccountId:
        DEFAULTS.memberAccountId,

      isFinancial:
        true,

      isImmutable:
        true,

      createdAt:
        isoPast(
          60000,
        ),

      updatedAt:
        isoNow(),

      completedAt:
        isoNow(),
    },
    overrides,
  );
}

function pendingTransaction(
  overrides = {},
) {
  return transaction({
    status:
      STATES.transaction.PENDING,

    state:
      STATES.transaction.PENDING,

    isFinancial:
      false,

    completedAt:
      null,

    ...overrides,
  });
}

function failedTransaction(
  overrides = {},
) {
  return transaction({
    status:
      STATES.transaction.FAILED,

    state:
      STATES.transaction.FAILED,

    failureCode:
      overrides.failureCode ||
      'PROVIDER_FAILED',

    failureReason:
      overrides.failureReason ||
      'Provider reported failure',

    isFinancial:
      false,

    completedAt:
      null,

    ...overrides,
  });
}

/* ============================================================================
 * Provider Transaction Fixtures
 * ========================================================================== */

function providerTransaction(
  overrides = {},
) {
  return deepMerge(
    {
      provider:
        DEFAULTS.provider,

      providerTransactionId:
        DEFAULTS.providerTransactionId,

      externalReference:
        DEFAULTS.paymentReference,

      reference:
        DEFAULTS.paymentReference,

      paymentReference:
        DEFAULTS.paymentReference,

      amount:
        DEFAULTS.amount,

      currency:
        DEFAULTS.currency,

      msisdn:
        DEFAULTS.phone,

      status:
        'SUCCESS',

      responseCode:
        'SUCCESS',

      responseMessage:
        'Transaction successful',

      providerTimestamp:
        isoNow(),

      rawProviderStatus:
        'SUCCESS',

      verified:
        true,
    },
    overrides,
  );
}

function pendingProviderTransaction(
  overrides = {},
) {
  return providerTransaction({
    status:
      'PENDING',

    responseCode:
      'PENDING',

    responseMessage:
      'Transaction pending',

    verified:
      false,

    ...overrides,
  });
}

function failedProviderTransaction(
  overrides = {},
) {
  return providerTransaction({
    status:
      'FAILED',

    responseCode:
      'FAILED',

    responseMessage:
      'Transaction failed',

    verified:
      false,

    ...overrides,
  });
}

function amountMismatchProviderTransaction(
  overrides = {},
) {
  return providerTransaction({
    amount:
      DEFAULTS.mismatchAmount,

    status:
      'SUCCESS',

    responseCode:
      'SUCCESS',

    ...overrides,
  });
}

function currencyMismatchProviderTransaction(
  overrides = {},
) {
  return providerTransaction({
    currency:
      DEFAULTS.wrongCurrency,

    status:
      'SUCCESS',

    responseCode:
      'SUCCESS',

    ...overrides,
  });
}

function identityMismatchProviderTransaction(
  overrides = {},
) {
  return providerTransaction({
    providerTransactionId:
      DEFAULTS.secondaryProviderTransactionId,

    reference:
      DEFAULTS.secondaryPaymentReference,

    paymentReference:
      DEFAULTS.secondaryPaymentReference,

    externalReference:
      DEFAULTS.secondaryPaymentReference,

    status:
      'SUCCESS',

    responseCode:
      'SUCCESS',

    ...overrides,
  });
}

/* ============================================================================
 * Callback Fixtures
 * ========================================================================== */

function providerCallback(
  overrides = {},
) {
  const payload =
    deepMerge(
      {
        callbackId:
          DEFAULTS.callbackId,

        provider:
          DEFAULTS.provider,

        providerTransactionId:
          DEFAULTS.providerTransactionId,

        transactionId:
          DEFAULTS.providerTransactionId,

        paymentReference:
          DEFAULTS.paymentReference,

        reference:
          DEFAULTS.paymentReference,

        externalReference:
          DEFAULTS.paymentReference,

        status:
          'SUCCESS',

        state:
          'SUCCESS',

        outcome:
          CALLBACK_OUTCOMES.SUCCESS,

        amount:
          DEFAULTS.amount,

        currency:
          DEFAULTS.currency,

        msisdn:
          DEFAULTS.phone,

        responseCode:
          'SUCCESS',

        responseMessage:
          'Transaction successful',

        timestamp:
          isoNow(),

        metadata:
          {
            source:
              'mtn',

            environment:
              DEFAULTS.environment,
          },
      },
      overrides,
    );

  return {
    ...payload,

    signature:
      overrides.signature ||
      signHmacSha256(
        payload,
      ),
  };
}

function pendingCallback(
  overrides = {},
) {
  return providerCallback({
    status:
      'PENDING',

    state:
      'PENDING',

    outcome:
      CALLBACK_OUTCOMES.PENDING,

    responseCode:
      'PENDING',

    responseMessage:
      'Transaction pending',

    ...overrides,
  });
}

function failedCallback(
  overrides = {},
) {
  return providerCallback({
    status:
      'FAILED',

    state:
      'FAILED',

    outcome:
      CALLBACK_OUTCOMES.FAILED,

    responseCode:
      'FAILED',

    responseMessage:
      'Transaction failed',

    ...overrides,
  });
}

function malformedCallback(
  overrides = {},
) {
  return {
    callbackId:
      overrides.callbackId ||
      DEFAULTS.callbackId,

    provider:
      overrides.provider ||
      DEFAULTS.provider,

    ...overrides,
  };
}

function unknownCallback(
  overrides = {},
) {
  return providerCallback({
    callbackId:
      overrides.callbackId ||
      randomId(
        'UNKNOWN-CB',
      ),

    providerTransactionId:
      overrides.providerTransactionId ||
      randomId(
        'UNKNOWN-TX',
      ),

    transactionId:
      overrides.transactionId ||
      overrides.providerTransactionId ||
      randomId(
        'UNKNOWN-TX',
      ),

    paymentReference:
      overrides.paymentReference ||
      randomId(
        'UNKNOWN-REF',
      ),

    reference:
      overrides.reference ||
      overrides.paymentReference ||
      randomId(
        'UNKNOWN-REF',
      ),

    ...overrides,
  });
}

function maliciousCallback(
  overrides = {},
) {
  return providerCallback({
    amount:
      overrides.amount ||
      DEFAULTS.mismatchAmount,

    metadata:
      {
        ...overrides.metadata,

        tenantId:
          overrides.metadata?.tenantId ||
          DEFAULTS.secondaryTenantId,

        accountId:
          overrides.metadata?.accountId ||
          DEFAULTS.wrongAccountId,
      },

    ...overrides,
  });
}

function crossTenantCallback(
  overrides = {},
) {
  return providerCallback({
    tenantId:
      DEFAULTS.secondaryTenantId,

    memberId:
      DEFAULTS.externalMemberId,

    userId:
      DEFAULTS.externalMemberId,

    ...overrides,
  });
}

function replayCallback(
  overrides = {},
) {
  return providerCallback({
    callbackId:
      DEFAULTS.callbackId,

    ...overrides,
  });
}

function invalidSignatureCallback(
  overrides = {},
) {
  const payload =
    providerCallback(
      overrides,
    );

  return {
    ...payload,

    signature:
      signHmacSha256(
        payload,
        'incorrect-secret',
      ),
  };
}

/* ============================================================================
 * Verification Fixtures
 * ========================================================================== */

function verificationSuccess(
  overrides = {},
) {
  return deepMerge(
    {
      success:
        true,

      verified:
        true,

      status:
        'SUCCESS',

      provider:
        DEFAULTS.provider,

      providerTransactionId:
        DEFAULTS.providerTransactionId,

      transactionId:
        DEFAULTS.providerTransactionId,

      paymentReference:
        DEFAULTS.paymentReference,

      amount:
        DEFAULTS.amount,

      currency:
        DEFAULTS.currency,

      msisdn:
        DEFAULTS.phone,

      verifiedAt:
        isoNow(),

      responseCode:
        'SUCCESS',

      responseMessage:
        'Provider verification successful',
    },
    overrides,
  );
}

function verificationPending(
  overrides = {},
) {
  return verificationSuccess({
    success:
      true,

    verified:
      false,

    status:
      'PENDING',

    responseCode:
      'PENDING',

    responseMessage:
      'Provider verification remains pending',

    ...overrides,
  });
}

function verificationFailed(
  overrides = {},
) {
  return verificationSuccess({
    success:
      false,

    verified:
      false,

    status:
      'FAILED',

    responseCode:
      'FAILED',

    responseMessage:
      'Provider verification failed',

    ...overrides,
  });
}

function verificationAmountMismatch(
  overrides = {},
) {
  return verificationSuccess({
    amount:
      DEFAULTS.mismatchAmount,

    status:
      'SUCCESS',

    verified:
      false,

    mismatchType:
      'AMOUNT_MISMATCH',

    ...overrides,
  });
}

function verificationCurrencyMismatch(
  overrides = {},
) {
  return verificationSuccess({
    currency:
      DEFAULTS.wrongCurrency,

    status:
      'SUCCESS',

    verified:
      false,

    mismatchType:
      'CURRENCY_MISMATCH',

    ...overrides,
  });
}

function verificationIdentityMismatch(
  overrides = {},
) {
  return verificationSuccess({
    providerTransactionId:
      DEFAULTS.secondaryProviderTransactionId,

    transactionId:
      DEFAULTS.secondaryProviderTransactionId,

    verified:
      false,

    mismatchType:
      'IDENTITY_MISMATCH',

    ...overrides,
  });
}

/* ============================================================================
 * Reconciliation Fixtures
 * ========================================================================== */

function reconciliationMatch(
  overrides = {},
) {
  return deepMerge(
    {
      reconciliationId:
        DEFAULTS.reconciliationId,

      tenantId:
        DEFAULTS.tenantId,

      paymentId:
        DEFAULTS.paymentId,

      transactionId:
        DEFAULTS.transactionId,

      providerTransactionId:
        DEFAULTS.providerTransactionId,

      paymentReference:
        DEFAULTS.paymentReference,

      status:
        STATES.reconciliation.MATCHED,

      match:
        true,

      amount:
        DEFAULTS.amount,

      currency:
        DEFAULTS.currency,

      provider:
        DEFAULTS.provider,

      checkedAt:
        isoNow(),

      resolvedAt:
        isoNow(),

      createdAt:
        isoNow(),

      updatedAt:
        isoNow(),
    },
    overrides,
  );
}

function reconciliationMismatch(
  overrides = {},
) {
  return deepMerge(
    {
      reconciliationId:
        DEFAULTS.reconciliationId,

      tenantId:
        DEFAULTS.tenantId,

      paymentId:
        DEFAULTS.paymentId,

      transactionId:
        DEFAULTS.transactionId,

      providerTransactionId:
        DEFAULTS.providerTransactionId,

      paymentReference:
        DEFAULTS.paymentReference,

      status:
        STATES.reconciliation.MISMATCH,

      match:
        false,

      mismatchType:
        'AMOUNT_MISMATCH',

      expectedAmount:
        DEFAULTS.amount,

      actualAmount:
        DEFAULTS.mismatchAmount,

      expectedCurrency:
        DEFAULTS.currency,

      actualCurrency:
        DEFAULTS.currency,

      provider:
        DEFAULTS.provider,

      resolutionRequired:
        true,

      investigationRequired:
        true,

      immutable:
        true,

      createdAt:
        isoNow(),

      updatedAt:
        isoNow(),
    },
    overrides,
  );
}

function reconciliationPending(
  overrides = {},
) {
  return reconciliationMismatch({
    status:
      STATES.reconciliation.PENDING,

    match:
      false,

    resolutionRequired:
      false,

    investigationRequired:
      false,

    ...overrides,
  });
}

function reconciliationInvestigation(
  overrides = {},
) {
  return reconciliationMismatch({
    status:
      STATES.reconciliation.INVESTIGATION_REQUIRED,

    match:
      false,

    resolutionRequired:
      true,

    investigationRequired:
      true,

    ...overrides,
  });
}

function reconciliationResolved(
  overrides = {},
) {
  return reconciliationMismatch({
    status:
      STATES.reconciliation.RESOLVED,

    match:
      true,

    resolutionRequired:
      false,

    investigationRequired:
      false,

    resolvedAt:
      isoNow(),

    ...overrides,
  });
}

/* ============================================================================
 * Settlement Fixtures
 * ========================================================================== */

function settlement(
  overrides = {},
) {
  return deepMerge(
    {
      settlementId:
        DEFAULTS.settlementId,

      tenantId:
        DEFAULTS.tenantId,

      paymentId:
        DEFAULTS.paymentId,

      transactionId:
        DEFAULTS.transactionId,

      provider:
        DEFAULTS.provider,

      providerTransactionId:
        DEFAULTS.providerTransactionId,

      amount:
        DEFAULTS.amount,

      currency:
        DEFAULTS.currency,

      status:
        'SETTLED',

      settlementReference:
        `SETTLEMENT-${DEFAULTS.paymentReference}`,

      settledAt:
        isoNow(),

      createdAt:
        isoNow(),

      updatedAt:
        isoNow(),
    },
    overrides,
  );
}

function pendingSettlement(
  overrides = {},
) {
  return settlement({
    status:
      'PENDING',

    settledAt:
      null,

    ...overrides,
  });
}

function failedSettlement(
  overrides = {},
) {
  return settlement({
    status:
      'FAILED',

    settledAt:
      null,

    failureCode:
      overrides.failureCode ||
      'SETTLEMENT_FAILED',

    failureReason:
      overrides.failureReason ||
      'Settlement provider rejected the operation',

    ...overrides,
  });
}

/* ============================================================================
 * Ledger Fixtures
 * ========================================================================== */

function ledgerJournal(
  overrides = {},
) {
  const amount =
    overrides.amount !==
      undefined
      ? numericAmount(
          overrides.amount,
        )
      : DEFAULTS.amount;

  return deepMerge(
    {
      _id:
        DEFAULTS.journalId,

      id:
        DEFAULTS.journalId,

      tenantId:
        DEFAULTS.tenantId,

      transactionId:
        DEFAULTS.transactionId,

      paymentId:
        DEFAULTS.paymentId,

      contributionId:
        DEFAULTS.contributionId,

      reference:
        DEFAULTS.paymentReference,

      idempotencyKey:
        DEFAULTS.idempotencyKey,

      type:
        'CONTRIBUTION',

      currency:
        DEFAULTS.currency,

      status:
        STATES.ledger.POSTED,

      immutable:
        true,

      totalDebit:
        amount,

      totalCredit:
        amount,

      postedAt:
        isoNow(),

      createdAt:
        isoNow(),

      updatedAt:
        isoNow(),

      entries:
        [
          {
            entryId:
              deterministicObjectId(
                '000000000000000000000201',
              ),

            accountId:
              DEFAULTS.cashAccountId,

            direction:
              'DEBIT',

            amount,

            currency:
              DEFAULTS.currency,
          },

          {
            entryId:
              deterministicObjectId(
                '000000000000000000000202',
              ),

            accountId:
              DEFAULTS.memberAccountId,

            direction:
              'CREDIT',

            amount,

            currency:
              DEFAULTS.currency,
          },
        ],
    },
    overrides,
  );
}

function draftLedgerJournal(
  overrides = {},
) {
  return ledgerJournal({
    status:
      STATES.ledger.DRAFT,

    immutable:
      false,

    postedAt:
      null,

    ...overrides,
  });
}

function reversedLedgerJournal(
  overrides = {},
) {
  return ledgerJournal({
    status:
      STATES.ledger.REVERSED,

    reversedAt:
      isoNow(),

    reversalJournalId:
      overrides.reversalJournalId ||
      deterministicObjectId(
        '000000000000000000000203',
      ),

    ...overrides,
  });
}

function ledgerEntries(
  amount =
    DEFAULTS.amount,
  overrides = {},
) {
  const numeric =
    numericAmount(
      amount,
    );

  return [
    {
      entryId:
        deterministicObjectId(
          '000000000000000000000211',
        ),

      accountId:
        DEFAULTS.cashAccountId,

      direction:
        'DEBIT',

      amount:
        numeric,

      currency:
        DEFAULTS.currency,

      ...overrides.debit,
    },

    {
      entryId:
        deterministicObjectId(
          '000000000000000000000212',
        ),

      accountId:
        DEFAULTS.memberAccountId,

      direction:
        'CREDIT',

      amount:
        numeric,

      currency:
        DEFAULTS.currency,

      ...overrides.credit,
    },
  ];
}

/* ============================================================================
 * Contribution Result Fixtures
 * ========================================================================== */

function contributionSuccessResult(
  overrides = {},
) {
  return deepMerge(
    {
      success:
        true,

      message:
        'Contribution processed successfully',

      status:
        STATES.payment.SUCCESS,

      data:
        {
          contributionId:
            DEFAULTS.contributionId,

          paymentId:
            DEFAULTS.paymentId,

          transactionId:
            DEFAULTS.transactionId,

          tenantId:
            DEFAULTS.tenantId,

          groupId:
            DEFAULTS.groupId,

          memberId:
            DEFAULTS.memberId,

          amount:
            DEFAULTS.amount,

          currency:
            DEFAULTS.currency,

          provider:
            DEFAULTS.provider,

          providerTransactionId:
            DEFAULTS.providerTransactionId,

          paymentReference:
            DEFAULTS.paymentReference,

          idempotencyKey:
            DEFAULTS.idempotencyKey,

          status:
            STATES.payment.SUCCESS,

          reconciliationStatus:
            STATES.reconciliation.MATCHED,

          ledgerStatus:
            STATES.ledger.POSTED,
        },
    },
    overrides,
  );
}

function contributionPendingResult(
  overrides = {},
) {
  return contributionSuccessResult({
    success:
      true,

    message:
      'Contribution accepted and pending provider confirmation',

    status:
      STATES.payment.PENDING,

    data:
      {
        status:
          STATES.payment.PENDING,

        reconciliationStatus:
          STATES.reconciliation.PENDING,

        ledgerStatus:
          STATES.ledger.DRAFT,

        ...overrides.data,
      },

    ...overrides,
  });
}

function contributionFailedResult(
  overrides = {},
) {
  return contributionSuccessResult({
    success:
      false,

    message:
      'Contribution failed',

    status:
      STATES.payment.FAILED,

    data:
      {
        status:
          STATES.payment.FAILED,

        ...overrides.data,
      },

    ...overrides,
  });
}

function contributionMismatchResult(
  overrides = {},
) {
  return contributionSuccessResult({
    success:
      true,

    message:
      'Contribution requires reconciliation',

    status:
      STATES.payment.RECONCILIATION_REQUIRED,

    data:
      {
        status:
          STATES.payment.RECONCILIATION_REQUIRED,

        reconciliationStatus:
          STATES.reconciliation.INVESTIGATION_REQUIRED,

        ledgerStatus:
          STATES.ledger.VALIDATING,

        ...overrides.data,
      },

    ...overrides,
  });
}

/* ============================================================================
 * Error Fixtures
 * ========================================================================== */

function apiError(
  overrides = {},
) {
  return deepMerge(
    {
      success:
        false,

      error:
        {
          code:
            'VALIDATION_ERROR',

          message:
            'Request validation failed',

          details:
            {},
        },

      message:
        'Request validation failed',

      timestamp:
        isoNow(),

      requestId:
        randomId(
          'GMP-ERROR',
        ),
    },
    overrides,
  );
}

function unauthorizedError(
  overrides = {},
) {
  return apiError({
    error:
      {
        code:
          'UNAUTHORIZED',

        message:
          'Authentication required',

        details:
          {},
      },

    message:
      'Authentication required',

    ...overrides,
  });
}

function forbiddenError(
  overrides = {},
) {
  return apiError({
    error:
      {
        code:
          'FORBIDDEN',

        message:
          'Insufficient permissions',

        details:
          {},
      },

    message:
      'Insufficient permissions',

    ...overrides,
  });
}

function conflictError(
  overrides = {},
) {
  return apiError({
    error:
      {
        code:
          'CONFLICT',

        message:
          'The request conflicts with the current resource state',

        details:
          {},
      },

    message:
      'The request conflicts with the current resource state',

    ...overrides,
  });
}

function idempotencyConflictError(
  overrides = {},
) {
  return apiError({
    error:
      {
        code:
          'IDEMPOTENCY_CONFLICT',

        message:
          'Idempotency key has already been used with a different request',

        details:
          {},
      },

    message:
      'Idempotency key has already been used with a different request',

    ...overrides,
  });
}

function reconciliationMismatchError(
  overrides = {},
) {
  return apiError({
    error:
      {
        code:
          'RECONCILIATION_MISMATCH',

        message:
          'Provider and platform financial records do not match',

        details:
          {
            expectedAmount:
              DEFAULTS.amount,

            actualAmount:
              DEFAULTS.mismatchAmount,

            currency:
              DEFAULTS.currency,

            provider:
              DEFAULTS.provider,
          },
      },

    message:
      'Payment requires reconciliation',

    ...overrides,
  });
}

/* ============================================================================
 * Failure Scenario Fixtures
 * ========================================================================== */

function providerTimeoutError(
  overrides = {},
) {
  return Object.assign(
    new Error(
      'Payment provider request timed out',
    ),
    {
      code:
        'ETIMEDOUT',

      statusCode:
        504,

      retryable:
        true,

      unknownOutcome:
        true,

      reconciliationRequired:
        true,

      provider:
        DEFAULTS.provider,

      ...overrides,
    },
  );
}

function providerNetworkError(
  overrides = {},
) {
  return Object.assign(
    new Error(
      'Unable to reach payment provider',
    ),
    {
      code:
        'ECONNRESET',

      statusCode:
        503,

      retryable:
        true,

      unknownOutcome:
        true,

      provider:
        DEFAULTS.provider,

      ...overrides,
    },
  );
}

function providerUnavailableError(
  overrides = {},
) {
  return Object.assign(
    new Error(
      'Payment provider temporarily unavailable',
    ),
    {
      code:
        'PROVIDER_UNAVAILABLE',

      statusCode:
        503,

      retryable:
        true,

      provider:
        DEFAULTS.provider,

      ...overrides,
    },
  );
}

function invalidProviderResponseError(
  overrides = {},
) {
  return Object.assign(
    new Error(
      'Provider returned an invalid response',
    ),
    {
      code:
        'INVALID_PROVIDER_RESPONSE',

      statusCode:
        502,

      retryable:
        false,

      provider:
        DEFAULTS.provider,

      ...overrides,
    },
  );
}

function ledgerPostingError(
  overrides = {},
) {
  return Object.assign(
    new Error(
      'Ledger posting failed',
    ),
    {
      code:
        'LEDGER_POSTING_FAILED',

      retryable:
        true,

      statusCode:
        500,

      ...overrides,
    },
  );
}

function reconciliationRequiredError(
  overrides = {},
) {
  return Object.assign(
    new Error(
      'Payment requires reconciliation',
    ),
    {
      code:
        'RECONCILIATION_REQUIRED',

      statusCode:
        409,

      retryable:
        false,

      reconciliationRequired:
        true,

      ...overrides,
    },
  );
}

/* ============================================================================
 * Malicious / Security Fixtures
 * ========================================================================== */

function forgedCallback(
  overrides = {},
) {
  const payload =
    callbackSuccessForFixture(
      overrides,
    );

  return {
    ...payload,

    signature:
      signHmacSha256(
        payload,
        'attacker-secret',
      ),
  };
}

function callbackSuccessForFixture(
  overrides = {},
) {
  return providerCallback(
    {
      status:
        'SUCCESS',

      state:
        'SUCCESS',

      outcome:
        CALLBACK_OUTCOMES.SUCCESS,

      ...overrides,
    },
  );
}

function callbackAmountTampered(
  overrides = {},
) {
  return callbackSuccessForFixture({
    amount:
      DEFAULTS.mismatchAmount,

    ...overrides,
  });
}

function callbackCurrencyTampered(
  overrides = {},
) {
  return callbackSuccessForFixture({
    currency:
      DEFAULTS.wrongCurrency,

    ...overrides,
  });
}

function callbackTenantTampered(
  overrides = {},
) {
  return callbackSuccessForFixture({
    tenantId:
      DEFAULTS.secondaryTenantId,

    ...overrides,
  });
}

function callbackAccountTampered(
  overrides = {},
) {
  return callbackSuccessForFixture({
    accountId:
      DEFAULTS.wrongAccountId,

    sourceAccountId:
      DEFAULTS.wrongAccountId,

    destinationAccountId:
      DEFAULTS.wrongAccountId,

    ...overrides,
  });
}

function callbackIdentityTampered(
  overrides = {},
) {
  return callbackSuccessForFixture({
    providerTransactionId:
      DEFAULTS.secondaryProviderTransactionId,

    transactionId:
      DEFAULTS.secondaryProviderTransactionId,

    paymentReference:
      DEFAULTS.secondaryPaymentReference,

    reference:
      DEFAULTS.secondaryPaymentReference,

    ...overrides,
  });
}

function callbackStateRegression(
  overrides = {},
) {
  return providerCallback({
    status:
      STATES.payment.PENDING,

    state:
      STATES.payment.PENDING,

    outcome:
      CALLBACK_OUTCOMES.PENDING,

    ...overrides,
  });
}

function callbackFailureReplay(
  overrides = {},
) {
  return providerCallback({
    status:
      STATES.payment.FAILED,

    state:
      STATES.payment.FAILED,

    outcome:
      CALLBACK_OUTCOMES.FAILED,

    ...overrides,
  });
}

function prototypePollutionCallback(
  overrides = {},
) {
  return providerCallback({
    __proto__:
      {
        tenantId:
          DEFAULTS.secondaryTenantId,

        role:
          ROLES.ADMIN,
      },

    constructor:
      {
        tenantId:
          DEFAULTS.secondaryTenantId,
      },

    prototype:
      {
        tenantId:
          DEFAULTS.secondaryTenantId,
      },

    ...overrides,
  });
}

function callbackWithInternalFlags(
  overrides = {},
) {
  return providerCallback({
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

    reconciliationStatus:
      STATES.reconciliation.MATCHED,

    ledgerStatus:
      STATES.ledger.POSTED,

    ...overrides,
  });
}

/* ============================================================================
 * Scenario Bundles
 * ========================================================================== */

/**
 * Fully valid Golden Money Path scenario.
 *
 * This bundle is useful for success, duplicate, concurrency, callback,
 * reconciliation, and ledger tests.
 */
function validScenario(
  overrides = {},
) {
  const request =
    contributionRequest(
      overrides.request,
    );

  const provider =
    providerSuccess(
      {
        providerTransactionId:
          request.providerTransactionId ||
          DEFAULTS.providerTransactionId,

        paymentReference:
          request.paymentReference ||
          DEFAULTS.paymentReference,

        reference:
          request.reference ||
          DEFAULTS.paymentReference,

        amount:
          request.amount,

        currency:
          request.currency,

        msisdn:
          request.phoneNumber,
      },
    );

  const callback =
    providerCallback({
      providerTransactionId:
        provider.providerTransactionId,

      transactionId:
        provider.providerTransactionId,

      paymentReference:
        request.paymentReference,

      reference:
        request.reference,

      amount:
        provider.amount,

      currency:
        provider.currency,

      msisdn:
        provider.msisdn,

      ...overrides.callback,
    });

  const verification =
    verificationSuccess({
      providerTransactionId:
        provider.providerTransactionId,

      paymentReference:
        request.paymentReference,

      amount:
        request.amount,

      currency:
        request.currency,

      ...overrides.verification,
    });

  const reconciliation =
    reconciliationMatch({
      amount:
        request.amount,

      currency:
        request.currency,

      providerTransactionId:
        provider.providerTransactionId,

      paymentReference:
        request.paymentReference,

      ...overrides.reconciliation,
    });

  const settlementResult =
    settlement({
      amount:
        request.amount,

      currency:
        request.currency,

      providerTransactionId:
        provider.providerTransactionId,

      ...overrides.settlement,
    });

  const transactionResult =
    transaction({
      amount:
        request.amount,

      currency:
        request.currency,

      providerTransactionId:
        provider.providerTransactionId,

      paymentReference:
        request.paymentReference,

      ...overrides.transaction,
    });

  const paymentResult =
    payment({
      amount:
        request.amount,

      currency:
        request.currency,

      providerTransactionId:
        provider.providerTransactionId,

      paymentReference:
        request.paymentReference,

      idempotencyKey:
        request.idempotencyKey,

      ...overrides.payment,
    });

  const journalResult =
    ledgerJournal({
      amount:
        request.amount,

      currency:
        request.currency,

      reference:
        request.reference,

      idempotencyKey:
        request.idempotencyKey,

      transactionId:
        transactionResult._id ||
        transactionResult.id ||
        DEFAULTS.transactionId,

      paymentId:
        paymentResult._id ||
        paymentResult.id ||
        DEFAULTS.paymentId,

      ...overrides.journal,
    });

  return {
    tenant:
      tenant(
        overrides.tenant,
      ),

    member:
      member(
        overrides.member,
      ),

    group:
      group(
        overrides.group,
      ),

    account:
      memberAccount(
        overrides.account,
      ),

    request,

    provider,

    callback,

    verification,

    reconciliation,

    settlement:
      settlementResult,

    transaction:
      transactionResult,

    payment:
      paymentResult,

    journal:
      journalResult,
  };
}

/**
 * Amount mismatch scenario.
 */
function amountMismatchScenario(
  overrides = {},
) {
  const scenario =
    validScenario(
      overrides,
    );

  scenario.provider =
    providerSuccess({
      providerTransactionId:
        DEFAULTS.providerTransactionId,

      paymentReference:
        scenario.request.paymentReference,

      amount:
        DEFAULTS.mismatchAmount,

      currency:
        scenario.request.currency,

      msisdn:
        scenario.request.phoneNumber,

      ...overrides.provider,
    });

  scenario.callback =
    providerCallback({
      providerTransactionId:
        scenario.provider.providerTransactionId,

      transactionId:
        scenario.provider.providerTransactionId,

      paymentReference:
        scenario.request.paymentReference,

      reference:
        scenario.request.reference,

      amount:
        DEFAULTS.mismatchAmount,

      currency:
        scenario.request.currency,

      ...overrides.callback,
    });

  scenario.verification =
    verificationAmountMismatch({
      expectedAmount:
        scenario.request.amount,

      amount:
        DEFAULTS.mismatchAmount,

      ...overrides.verification,
    });

  scenario.reconciliation =
    reconciliationMismatch({
      mismatchType:
        'AMOUNT_MISMATCH',

      expectedAmount:
        scenario.request.amount,

      actualAmount:
        DEFAULTS.mismatchAmount,

      ...overrides.reconciliation,
    });

  scenario.payment =
    reconciliationHoldPayment({
      amount:
        scenario.request.amount,

      ...overrides.payment,
    });

  return scenario;
}

/**
 * Currency mismatch scenario.
 */
function currencyMismatchScenario(
  overrides = {},
) {
  const scenario =
    validScenario(
      overrides,
    );

  scenario.provider =
    providerSuccess({
      providerTransactionId:
        DEFAULTS.providerTransactionId,

      paymentReference:
        scenario.request.paymentReference,

      amount:
        scenario.request.amount,

      currency:
        DEFAULTS.wrongCurrency,

      msisdn:
        scenario.request.phoneNumber,

      ...overrides.provider,
    });

  scenario.callback =
    providerCallback({
      providerTransactionId:
        scenario.provider.providerTransactionId,

      transactionId:
        scenario.provider.providerTransactionId,

      paymentReference:
        scenario.request.paymentReference,

      reference:
        scenario.request.reference,

      amount:
        scenario.request.amount,

      currency:
        DEFAULTS.wrongCurrency,

      ...overrides.callback,
    });

  scenario.verification =
    verificationCurrencyMismatch({
      expectedCurrency:
        scenario.request.currency,

      currency:
        DEFAULTS.wrongCurrency,

      ...overrides.verification,
    });

  scenario.reconciliation =
    reconciliationMismatch({
      mismatchType:
        'CURRENCY_MISMATCH',

      expectedCurrency:
        scenario.request.currency,

      actualCurrency:
        DEFAULTS.wrongCurrency,

      ...overrides.reconciliation,
    });

  scenario.payment =
    reconciliationHoldPayment({
      ...overrides.payment,
    });

  return scenario;
}

/**
 * Provider identity mismatch scenario.
 */
function identityMismatchScenario(
  overrides = {},
) {
  const scenario =
    validScenario(
      overrides,
    );

  scenario.provider =
    identityMismatchProviderTransaction(
      {
        ...overrides.provider,
      },
    );

  scenario.callback =
    providerCallback({
      providerTransactionId:
        DEFAULTS.secondaryProviderTransactionId,

      transactionId:
        DEFAULTS.secondaryProviderTransactionId,

      paymentReference:
        scenario.request.paymentReference,

      reference:
        scenario.request.reference,

      amount:
        scenario.request.amount,

      currency:
        scenario.request.currency,

      ...overrides.callback,
    });

  scenario.verification =
    verificationIdentityMismatch(
      overrides.verification,
    );

  scenario.reconciliation =
    reconciliationMismatch({
      mismatchType:
        'PROVIDER_TRANSACTION_MISMATCH',

      expectedProviderTransactionId:
        DEFAULTS.providerTransactionId,

      actualProviderTransactionId:
        DEFAULTS.secondaryProviderTransactionId,

      ...overrides.reconciliation,
    });

  scenario.payment =
    reconciliationHoldPayment({
      ...overrides.payment,
    });

  return scenario;
}

/**
 * Provider timeout / unknown outcome scenario.
 */
function providerTimeoutScenario(
  overrides = {},
) {
  const scenario =
    validScenario(
      overrides,
    );

  scenario.providerError =
    providerTimeoutError(
      overrides.providerError,
    );

  scenario.provider =
    pendingProviderTransaction(
      overrides.provider,
    );

  scenario.callback =
    pendingCallback(
      overrides.callback,
    );

  scenario.verification =
    verificationPending(
      overrides.verification,
    );

  scenario.reconciliation =
    reconciliationPending(
      overrides.reconciliation,
    );

  scenario.payment =
    pendingPayment(
      overrides.payment,
    );

  scenario.transaction =
    pendingTransaction(
      overrides.transaction,
    );

  scenario.settlement =
    pendingSettlement(
      overrides.settlement,
    );

  return scenario;
}

/**
 * Network failure scenario.
 */
function networkFailureScenario(
  overrides = {},
) {
  const scenario =
    validScenario(
      overrides,
    );

  scenario.providerError =
    providerNetworkError(
      overrides.providerError,
    );

  scenario.provider =
    pendingProviderTransaction(
      overrides.provider,
    );

  scenario.payment =
    pendingPayment(
      overrides.payment,
    );

  scenario.transaction =
    pendingTransaction(
      overrides.transaction,
    );

  return scenario;
}

/**
 * Wrong-account scenario.
 */
function wrongAccountScenario(
  overrides = {},
) {
  const scenario =
    validScenario(
      overrides,
    );

  scenario.request =
    contributionRequest({
      accountId:
        DEFAULTS.wrongAccountId,

      memberAccountId:
        DEFAULTS.wrongAccountId,

      sourceAccountId:
        DEFAULTS.wrongAccountId,

      destinationAccountId:
        DEFAULTS.wrongAccountId,

      ...overrides.request,
    });

  scenario.account =
    wrongAccount(
      overrides.account,
    );

  scenario.payment =
    pendingPayment({
      status:
        STATES.payment.PENDING,

      reconciliationStatus:
        STATES.reconciliation.PENDING,

      ...overrides.payment,
    });

  scenario.reconciliation =
    reconciliationMismatch({
      mismatchType:
        'ACCOUNT_OWNERSHIP_MISMATCH',

      expectedAccountId:
        DEFAULTS.memberAccountId,

      actualAccountId:
        DEFAULTS.wrongAccountId,

      ...overrides.reconciliation,
    });

  return scenario;
}

/**
 * Malicious callback scenario.
 */
function maliciousCallbackScenario(
  overrides = {},
) {
  const scenario =
    validScenario(
      overrides,
    );

  scenario.callback =
    maliciousCallback({
      providerTransactionId:
        scenario.provider.providerTransactionId,

      transactionId:
        scenario.provider.providerTransactionId,

      paymentReference:
        scenario.request.paymentReference,

      reference:
        scenario.request.reference,

      ...overrides.callback,
    });

  scenario.payment =
    reconciliationHoldPayment({
      ...overrides.payment,
    });

  scenario.reconciliation =
    reconciliationInvestigation({
      mismatchType:
        overrides.mismatchType ||
        'UNTRUSTED_CALLBACK',

      ...overrides.reconciliation,
    });

  return scenario;
}

/**
 * Replay scenario.
 */
function replayScenario(
  overrides = {},
) {
  const scenario =
    validScenario(
      overrides,
    );

  scenario.originalCallback =
    providerCallback({
      ...overrides.originalCallback,
    });

  scenario.replayedCallback =
    replayCallback({
      ...scenario.originalCallback,

      ...overrides.replayedCallback,
    });

  scenario.originalRequest =
    contributionRequest({
      ...overrides.originalRequest,
    });

  scenario.replayedRequest =
    contributionRequest({
      ...scenario.originalRequest,

      ...overrides.replayedRequest,
    });

  return scenario;
}

/* ============================================================================
 * Batch / Concurrency Fixture Generators
 * ========================================================================== */

function repeated(
  factory,
  count = 2,
  overrides = {},
) {
  if (
    typeof factory !==
    'function'
  ) {
    throw new TypeError(
      'repeated() requires a factory function',
    );
  }

  return Array.from(
    {
      length:
        count,
    },
    (
      _,
      index,
    ) =>
      factory(
        {
          ...overrides,

          sequence:
            index,
        },
      ),
  );
}

function repeatedCallbacks(
  count = 10,
  overrides = {},
) {
  return repeated(
    (
      item = {},
    ) =>
      providerCallback({
        callbackId:
          item.callbackId ||
          `GMP-CB-${String(
            item.sequence,
          ).padStart(
            4,
            '0',
          )}`,

        ...overrides,

        ...item,
      }),
    count,
  );
}

function repeatedContributionRequests(
  count = 10,
  overrides = {},
) {
  return repeated(
    (
      item = {},
    ) =>
      contributionRequest({
        idempotencyKey:
          item.idempotencyKey ||
          `GMP-IDEMPOTENCY-${String(
            item.sequence,
          ).padStart(
            4,
            '0',
          )}`,

        reference:
          item.reference ||
          `GMP-CONTRIBUTION-${String(
            item.sequence,
          ).padStart(
            4,
            '0',
          )}`,

        ...overrides,

        ...item,
      }),
    count,
  );
}

function concurrentScenario(
  count = 10,
  overrides = {},
) {
  const base =
    contributionRequest(
      overrides,
    );

  return {
    count,

    sameIdempotencyKey:
      base.idempotencyKey,

    samePaymentReference:
      base.paymentReference,

    requests:
      Array.from(
        {
          length:
            count,
        },
        (
          _,
          index,
        ) =>
          contributionRequest({
            ...base,

            sequence:
              index,

            idempotencyKey:
              base.idempotencyKey,

            reference:
              base.reference,

            paymentReference:
              base.paymentReference,
          }),
      ),

    callbacks:
      Array.from(
        {
          length:
            count,
        },
        (
          _,
          index,
        ) =>
          providerCallback({
            callbackId:
              base.callbackId ||
              DEFAULTS.callbackId,

            providerTransactionId:
              DEFAULTS.providerTransactionId,

            transactionId:
              DEFAULTS.providerTransactionId,

            paymentReference:
              base.paymentReference,

            reference:
              base.reference,

            sequence:
              index,
          }),
      ),
  };
}

/* ============================================================================
 * Assertion Support Fixtures
 * ========================================================================== */

function financialIdentity(
  value = {},
) {
  return {
    tenantId:
      value.tenantId ||
      DEFAULTS.tenantId,

    memberId:
      value.memberId ||
      DEFAULTS.memberId,

    groupId:
      value.groupId ||
      DEFAULTS.groupId,

    provider:
      value.provider ||
      DEFAULTS.provider,

    providerTransactionId:
      value.providerTransactionId ||
      DEFAULTS.providerTransactionId,

    paymentReference:
      value.paymentReference ||
      DEFAULTS.paymentReference,

    idempotencyKey:
      value.idempotencyKey ||
      DEFAULTS.idempotencyKey,

    amount:
      value.amount !==
        undefined
        ? numericAmount(
            value.amount,
          )
        : DEFAULTS.amount,

    currency:
      value.currency ||
      DEFAULTS.currency,
  };
}

function balancedLedger(
  amount =
    DEFAULTS.amount,
  currency =
    DEFAULTS.currency,
) {
  const numeric =
    numericAmount(
      amount,
    );

  return {
    totalDebit:
      numeric,

    totalCredit:
      numeric,

    currency,

    balanced:
      numeric ===
      numeric,
  };
}

function expectedSuccessState(
  overrides = {},
) {
  return {
    payment:
      STATES.payment.SUCCESS,

    transaction:
      STATES.transaction.SUCCESS,

    reconciliation:
      STATES.reconciliation.MATCHED,

    ledger:
      STATES.ledger.POSTED,

    ...overrides,
  };
}

function expectedPendingState(
  overrides = {},
) {
  return {
    payment:
      STATES.payment.PENDING,

    transaction:
      STATES.transaction.PENDING,

    reconciliation:
      STATES.reconciliation.PENDING,

    ledger:
      STATES.ledger.DRAFT,

    ...overrides,
  };
}

function expectedMismatchState(
  overrides = {},
) {
  return {
    payment:
      STATES.payment.RECONCILIATION_REQUIRED,

    reconciliation:
      STATES.reconciliation.INVESTIGATION_REQUIRED,

    ledger:
      STATES.ledger.VALIDATING,

    ...overrides,
  };
}

/* ============================================================================
 * Test Database Seed Bundle
 * ========================================================================== */

function seedBundle(
  overrides = {},
) {
  const base =
    validScenario(
      overrides,
    );

  return {
    tenants:
      [
        base.tenant,

        secondaryTenant(
          overrides.secondaryTenant,
        ),
      ],

    users:
      [
        base.member,

        secondaryMember(
          overrides.secondaryMember,
        ),

        admin(
          overrides.admin,
        ),

        otherTenantMember(
          overrides.otherTenantMember,
        ),
      ],

    groups:
      [
        base.group,

        secondaryGroup(
          overrides.secondaryGroup,
        ),
      ],

    accounts:
      [
        base.account,

        groupAccount(
          overrides.groupAccount,
        ),

        cashAccount(
          overrides.cashAccount,
        ),

        otherTenantAccount(
          overrides.otherTenantAccount,
        ),

        wrongAccount(
          overrides.wrongAccount,
        ),

        disabledAccount(
          overrides.disabledAccount,
        ),

        frozenAccount(
          overrides.frozenAccount,
        ),

        wrongCurrencyAccount(
          overrides.wrongCurrencyAccount,
        ),
      ],
  };
}

/* ============================================================================
 * Environment Fixture
 * ========================================================================== */

function testEnvironment(
  overrides = {},
) {
  return {
    NODE_ENV:
      'test',

    PORT:
      '0',

    MONGO_URI:
      'mongodb://127.0.0.1:27017/titech-golden-money-path-test',

    MONGODB_URI:
      'mongodb://127.0.0.1:27017/titech-golden-money-path-test',

    JWT_SECRET:
      DEFAULTS.jwtSecret,

    INTERNAL_API_KEY:
      'golden-money-path-test-internal-key',

    MTN_ENVIRONMENT:
      DEFAULTS.environment,

    MTN_CALLBACK_SECRET:
      DEFAULTS.callbackSecret,

    MTN_WEBHOOK_SECRET:
      DEFAULTS.callbackSecret,

    PAYMENT_CALLBACK_SECRET:
      DEFAULTS.callbackSecret,

    PAYMENT_CALLBACK_TEST_MODE:
      'true',

    PAYMENT_CALLBACK_REQUIRE_SIGNATURE:
      'true',

    IDEMPOTENCY_TEST_MODE:
      'true',

    TENANT_ISOLATION_TEST_MODE:
      'true',

    ...overrides,
  };
}

/* ============================================================================
 * Export Contract
 * ========================================================================== */

module.exports = Object.freeze({
  /* Constants */
  DEFAULTS,
  STATES,
  ROLES,
  ACCOUNT_TYPES,
  ACCOUNT_STATUSES,
  PAYMENT_METHODS,
  CALLBACK_OUTCOMES,

  /* Utilities */
  clone,
  merge,
  deepMerge,
  randomHex,
  randomId,
  deterministicObjectId,
  isoNow,
  isoPast,
  isoFuture,
  numericAmount,
  stringAmount,

  /* Security / signatures */
  stableJson,
  signHmacSha256,
  buildSignatureHeaders,

  /* Authentication */
  createTokenPayload,
  createJwtLikeToken,
  createAuthorizationHeader,
  memberToken,
  secondMemberToken,
  adminToken,
  moderatorToken,
  otherTenantToken,
  serviceToken,

  /* Tenants */
  tenant,
  secondaryTenant,

  /* Users */
  member,
  secondaryMember,
  admin,
  otherTenantMember,

  /* Groups */
  group,
  secondaryGroup,

  /* Accounts */
  account,
  memberAccount,
  groupAccount,
  cashAccount,
  otherTenantAccount,
  wrongAccount,
  disabledAccount,
  frozenAccount,
  wrongCurrencyAccount,

  /* Contribution requests */
  contributionRequest,
  secondaryContributionRequest,
  malformedContributionRequest,

  /* Idempotency */
  idempotencyRecord,
  idempotencyConflict,
  idempotencyPending,

  /* Payments */
  payment,
  pendingPayment,
  processingPayment,
  failedPayment,
  reconciliationHoldPayment,

  /* Transactions */
  transaction,
  pendingTransaction,
  failedTransaction,

  /* Provider transactions */
  providerTransaction,
  pendingProviderTransaction,
  failedProviderTransaction,
  amountMismatchProviderTransaction,
  currencyMismatchProviderTransaction,
  identityMismatchProviderTransaction,

  /* Callbacks */
  providerCallback,
  pendingCallback,
  failedCallback,
  malformedCallback,
  unknownCallback,
  maliciousCallback,
  crossTenantCallback,
  replayCallback,
  invalidSignatureCallback,
  callbackSuccessForFixture,
  callbackAmountTampered,
  callbackCurrencyTampered,
  callbackTenantTampered,
  callbackAccountTampered,
  callbackIdentityTampered,
  callbackStateRegression,
  callbackFailureReplay,
  prototypePollutionCallback,
  callbackWithInternalFlags,
  forgedCallback,

  /* Verification */
  verificationSuccess,
  verificationPending,
  verificationFailed,
  verificationAmountMismatch,
  verificationCurrencyMismatch,
  verificationIdentityMismatch,

  /* Reconciliation */
  reconciliationMatch,
  reconciliationMismatch,
  reconciliationPending,
  reconciliationInvestigation,
  reconciliationResolved,

  /* Settlement */
  settlement,
  pendingSettlement,
  failedSettlement,

  /* Ledger */
  ledgerJournal,
  draftLedgerJournal,
  reversedLedgerJournal,
  ledgerEntries,

  /* Results */
  contributionSuccessResult,
  contributionPendingResult,
  contributionFailedResult,
  contributionMismatchResult,

  /* Errors */
  apiError,
  unauthorizedError,
  forbiddenError,
  conflictError,
  idempotencyConflictError,
  reconciliationMismatchError,
  providerTimeoutError,
  providerNetworkError,
  providerUnavailableError,
  invalidProviderResponseError,
  ledgerPostingError,
  reconciliationRequiredError,

  /* Scenario bundles */
  validScenario,
  amountMismatchScenario,
  currencyMismatchScenario,
  identityMismatchScenario,
  providerTimeoutScenario,
  networkFailureScenario,
  wrongAccountScenario,
  maliciousCallbackScenario,
  replayScenario,

  /* Concurrency */
  repeated,
  repeatedCallbacks,
  repeatedContributionRequests,
  concurrentScenario,

  /* Assertions / identity */
  financialIdentity,
  balancedLedger,
  expectedSuccessState,
  expectedPendingState,
  expectedMismatchState,

  /* Seed / environment */
  seedBundle,
  testEnvironment,
});

/* ============================================================================
 * End of File
 * ============================================================================
 */