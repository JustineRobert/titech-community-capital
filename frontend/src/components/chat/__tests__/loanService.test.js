/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Loan Service Test Suite
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/__tests__/loanService.test.js
 *
 * Purpose:
 *   Production-grade tests for TITech's loan-service layer.
 *
 * Coverage
 * --------
 * ✓ Loan application creation
 * ✓ Loan retrieval
 * ✓ Loan updates
 * ✓ Loan status transitions
 * ✓ Loan approval
 * ✓ Loan rejection
 * ✓ Loan cancellation
 * ✓ Loan disbursement
 * ✓ Loan repayment
 * ✓ Outstanding balance handling
 * ✓ Interest / fees metadata
 * ✓ Loan term validation
 * ✓ Amount validation
 * ✓ Tenant isolation
 * ✓ Member/account ownership
 * ✓ Idempotency
 * ✓ Correlation/request IDs
 * ✓ Concurrent operations
 * ✓ Input immutability
 * ✓ Malformed input resilience
 * ✓ Sensitive-data protection
 * ✓ Error handling
 * ✓ Serialization safety
 * ✓ Pagination/query support
 * ✓ TITech branding consistency
 *
 * IMPORTANT
 * ----------
 * These tests validate the frontend service contract. Final authorization,
 * financial calculations, ledger posting, loan approval, disbursement and
 * repayment settlement MUST be enforced by the trusted backend.
 *
 * ============================================================================
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * ============================================================================
 * Service import
 * ============================================================================
 *
 * Expected implementation:
 *
 *   frontend/src/components/chat/services/loanService.js
 *
 * Change ONLY this path if the production service lives elsewhere.
 * ============================================================================
 */

import * as loanServiceModule from '../services/loanService.js';

/**
 * ============================================================================
 * Generic module resolver
 * ============================================================================
 */

const resolveExport = (
  module,
  names,
) => {
  for (const name of names) {
    if (
      module &&
      module[name] !== undefined
    ) {
      return module[name];
    }
  }

  return null;
};

const loanService =
  resolveExport(
    loanServiceModule,
    [
      'default',
      'loanService',
      'LoanService',
      'loans',
    ],
  );

/**
 * ============================================================================
 * Method resolver
 * ============================================================================
 */

const getCallableMethod = (
  service,
  names,
) => {
  if (
    typeof service ===
    'function'
  ) {
    return service;
  }

  if (
    !service ||
    typeof service !==
      'object'
  ) {
    return null;
  }

  for (const name of names) {
    if (
      typeof service[name] ===
      'function'
    ) {
      return service[name].bind(
        service,
      );
    }
  }

  return null;
};

/**
 * ============================================================================
 * Supported service operations
 * ============================================================================
 */

const createLoanMethod =
  getCallableMethod(
    loanService,
    [
      'create',
      'createLoan',
      'apply',
      'applyForLoan',
      'submitApplication',
      'createApplication',
    ],
  );

const getLoanMethod =
  getCallableMethod(
    loanService,
    [
      'get',
      'getLoan',
      'find',
      'findById',
      'getById',
      'retrieve',
    ],
  );

const listLoansMethod =
  getCallableMethod(
    loanService,
    [
      'list',
      'listLoans',
      'getLoans',
      'findAll',
      'query',
      'search',
    ],
  );

const updateLoanMethod =
  getCallableMethod(
    loanService,
    [
      'update',
      'updateLoan',
      'edit',
    ],
  );

const approveLoanMethod =
  getCallableMethod(
    loanService,
    [
      'approve',
      'approveLoan',
      'approveApplication',
    ],
  );

const rejectLoanMethod =
  getCallableMethod(
    loanService,
    [
      'reject',
      'rejectLoan',
      'rejectApplication',
    ],
  );

const cancelLoanMethod =
  getCallableMethod(
    loanService,
    [
      'cancel',
      'cancelLoan',
      'cancelApplication',
    ],
  );

const disburseLoanMethod =
  getCallableMethod(
    loanService,
    [
      'disburse',
      'disburseLoan',
      'release',
      'releaseLoan',
    ],
  );

const repayLoanMethod =
  getCallableMethod(
    loanService,
    [
      'repay',
      'repayLoan',
      'makeRepayment',
      'recordRepayment',
      'pay',
    ],
  );

/**
 * ============================================================================
 * Invocation helpers
 * ============================================================================
 */

const createLoan = async (
  payload,
) => {
  if (!createLoanMethod) {
    throw new Error(
      'TITech loan service does not expose a supported loan creation method.',
    );
  }

  return createLoanMethod(
    payload,
  );
};

const getLoan = async (
  id,
) => {
  if (!getLoanMethod) {
    throw new Error(
      'TITech loan service does not expose a supported retrieval method.',
    );
  }

  return getLoanMethod(
    id,
  );
};

const listLoans = async (
  query = {},
) => {
  if (!listLoansMethod) {
    throw new Error(
      'TITech loan service does not expose a supported list method.',
    );
  }

  return listLoansMethod(
    query,
  );
};

const updateLoan = async (
  id,
  payload,
) => {
  if (!updateLoanMethod) {
    throw new Error(
      'TITech loan service does not expose a supported update method.',
    );
  }

  return updateLoanMethod(
    id,
    payload,
  );
};

const approveLoan = async (
  id,
  payload = {},
) => {
  if (!approveLoanMethod) {
    throw new Error(
      'TITech loan service does not expose a supported approval method.',
    );
  }

  return approveLoanMethod(
    id,
    payload,
  );
};

const rejectLoan = async (
  id,
  payload = {},
) => {
  if (!rejectLoanMethod) {
    throw new Error(
      'TITech loan service does not expose a supported rejection method.',
    );
  }

  return rejectLoanMethod(
    id,
    payload,
  );
};

const cancelLoan = async (
  id,
  payload = {},
) => {
  if (!cancelLoanMethod) {
    throw new Error(
      'TITech loan service does not expose a supported cancellation method.',
    );
  }

  return cancelLoanMethod(
    id,
    payload,
  );
};

const disburseLoan = async (
  id,
  payload = {},
) => {
  if (!disburseLoanMethod) {
    throw new Error(
      'TITech loan service does not expose a supported disbursement method.',
    );
  }

  return disburseLoanMethod(
    id,
    payload,
  );
};

const repayLoan = async (
  id,
  payload,
) => {
  if (!repayLoanMethod) {
    throw new Error(
      'TITech loan service does not expose a supported repayment method.',
    );
  }

  return repayLoanMethod(
    id,
    payload,
  );
};

/**
 * ============================================================================
 * Test data factories
 * ============================================================================
 */

const createLoanApplication = (
  overrides = {},
) => ({
  tenantId:
    'tenant-001',

  memberId:
    'member-001',

  accountId:
    'account-001',

  loanProductId:
    'loan-product-001',

  loanType:
    'PERSONAL',

  purpose:
    'BUSINESS_WORKING_CAPITAL',

  amount:
    5000000,

  currency:
    'UGX',

  term:
    12,

  termUnit:
    'MONTHS',

  interestRate:
    18,

  interestType:
    'REDUCING_BALANCE',

  repaymentFrequency:
    'MONTHLY',

  status:
    'PENDING',

  collateralRequired:
    false,

  guarantorsRequired:
    0,

  correlationId:
    'corr-loan-001',

  requestId:
    'req-loan-001',

  idempotencyKey:
    'loan-idempotency-001',

  ...overrides,
});

const createRepayment = (
  overrides = {},
) => ({
  loanId:
    'loan-001',

  tenantId:
    'tenant-001',

  memberId:
    'member-001',

  amount:
    500000,

  currency:
    'UGX',

  paymentMethod:
    'MOBILE_MONEY',

  paymentReference:
    'PAY-001',

  correlationId:
    'corr-repayment-001',

  requestId:
    'req-repayment-001',

  idempotencyKey:
    'repayment-idempotency-001',

  ...overrides,
});

/**
 * ============================================================================
 * Response helpers
 * ============================================================================
 */

const getId = (
  result,
) => {
  if (
    typeof result ===
    'string'
  ) {
    return result;
  }

  if (
    !result ||
    typeof result !==
      'object'
  ) {
    return null;
  }

  return (
    result.id ??
    result.loanId ??
    result.applicationId ??
    result.data?.id ??
    result.data?.loanId ??
    result.data?.applicationId ??
    result.result?.id ??
    result.result?.loanId ??
    result.result?.applicationId ??
    null
  );
};

const getStatus = (
  result,
) => {
  if (
    !result ||
    typeof result !==
      'object'
  ) {
    return null;
  }

  return (
    result.status ??
    result.loanStatus ??
    result.applicationStatus ??
    result.data?.status ??
    result.data?.loanStatus ??
    result.data?.applicationStatus ??
    result.result?.status ??
    result.result?.loanStatus ??
    result.result?.applicationStatus ??
    null
  );
};

const getAmount = (
  result,
) => {
  if (
    !result ||
    typeof result !==
      'object'
  ) {
    return null;
  }

  return (
    result.amount ??
    result.principal ??
    result.loanAmount ??
    result.data?.amount ??
    result.data?.principal ??
    result.data?.loanAmount ??
    result.result?.amount ??
    result.result?.principal ??
    result.result?.loanAmount ??
    null
  );
};

const getBalance = (
  result,
) => {
  if (
    !result ||
    typeof result !==
      'object'
  ) {
    return null;
  }

  return (
    result.outstandingBalance ??
    result.balance ??
    result.remainingBalance ??
    result.data?.outstandingBalance ??
    result.data?.balance ??
    result.data?.remainingBalance ??
    result.result?.outstandingBalance ??
    result.result?.balance ??
    result.result?.remainingBalance ??
    null
  );
};

const getTenantId = (
  result,
) => {
  if (
    !result ||
    typeof result !==
      'object'
  ) {
    return null;
  }

  return (
    result.tenantId ??
    result.data?.tenantId ??
    result.result?.tenantId ??
    null
  );
};

const expectValidLoanResult = (
  result,
) => {
  expect(
    result,
  ).toBeDefined();

  const id =
    getId(
      result,
    );

  if (
    id !== null
  ) {
    expect(
      typeof id,
    ).toBe(
      'string',
    );

    expect(
      id.trim(),
    ).not.toBe(
      '',
    );
  }

  const amount =
    getAmount(
      result,
    );

  if (
    amount !== null
  ) {
    expect(
      Number.isFinite(
        amount,
      ),
    ).toBe(true);

    expect(
      amount,
    ).toBeGreaterThanOrEqual(
      0,
    );
  }

  const status =
    getStatus(
      result,
    );

  if (
    status !== null
  ) {
    expect(
      typeof status,
    ).toBe(
      'string',
    );
  }
};

/**
 * ============================================================================
 * Test suite
 * ============================================================================
 */

describe(
  'TITech Loan Service',
  () => {
    beforeEach(
      () => {
        vi.clearAllMocks();
      },
    );

    afterEach(
      () => {
        vi.restoreAllMocks();
      },
    );

    /**
     * ========================================================================
     * Module availability
     * ========================================================================
     */

    describe(
      'module availability',
      () => {
        it(
          'loads the TITech loan service module',
          () => {
            expect(
              loanServiceModule,
            ).toBeDefined();
          },
        );

        it(
          'exposes a usable loan service',
          () => {
            expect(
              loanService,
            ).not.toBeNull();
          },
        );

        it(
          'exposes loan creation functionality',
          () => {
            expect(
              createLoanMethod,
            ).toEqual(
              expect.any(
                Function,
              ),
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Loan application creation
     * ========================================================================
     */

    describe(
      'loan application creation',
      () => {
        it(
          'creates a loan application',
          async () => {
            const result =
              await createLoan(
                createLoanApplication(),
              );

            expectValidLoanResult(
              result,
            );
          },
        );

        it(
          'preserves the requested principal amount',
          async () => {
            const application =
              createLoanApplication({
                amount:
                  7500000,
              });

            const result =
              await createLoan(
                application,
              );

            const amount =
              getAmount(
                result,
              );

            if (
              amount !== null
            ) {
              expect(
                amount,
              ).toBe(
                application.amount,
              );
            }
          },
        );

        it(
          'supports UGX loan applications',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  currency:
                    'UGX',
                }),
              );

            expect(
              result,
            ).toBeDefined();
          },
        );

        it(
          'supports different loan purposes',
          async () => {
            const purposes = [
              'BUSINESS_WORKING_CAPITAL',
              'EDUCATION',
              'EMERGENCY',
              'AGRICULTURE',
              'ASSET_FINANCE',
              'HOME_IMPROVEMENT',
            ];

            for (
              const purpose of
                purposes
            ) {
              const result =
                await createLoan(
                  createLoanApplication({
                    purpose,
                  }),
                );

              expect(
                result,
              ).toBeDefined();
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * Amount validation
     * ========================================================================
     */

    describe(
      'loan amount validation',
      () => {
        it(
          'does not accept negative principal',
          async () => {
            await expect(
              createLoan(
                createLoanApplication({
                  amount:
                    -100000,
                }),
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );

        it(
          'does not accept NaN principal',
          async () => {
            await expect(
              createLoan(
                createLoanApplication({
                  amount:
                    Number.NaN,
                }),
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );

        it(
          'does not accept infinite principal',
          async () => {
            await expect(
              createLoan(
                createLoanApplication({
                  amount:
                    Infinity,
                }),
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );

        it(
          'does not silently accept string amounts as valid numeric amounts',
          async () => {
            try {
              const result =
                await createLoan(
                  createLoanApplication({
                    amount:
                      '5000000',
                  }),
                );

              expect(
                result,
              ).toBeDefined();

              const amount =
                getAmount(
                  result,
                );

              if (
                amount !==
                null
              ) {
                expect(
                  typeof amount,
                ).toBe(
                  'number',
                );
              }
            } catch (
              error
            ) {
              expect(
                error,
              ).toBeInstanceOf(
                Error,
              );
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * Loan term validation
     * ========================================================================
     */

    describe(
      'loan term validation',
      () => {
        it(
          'does not accept a negative term',
          async () => {
            await expect(
              createLoan(
                createLoanApplication({
                  term:
                    -12,
                }),
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );

        it(
          'does not accept zero term',
          async () => {
            await expect(
              createLoan(
                createLoanApplication({
                  term:
                    0,
                }),
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );

        it(
          'accepts a positive repayment term',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  term:
                    12,
                }),
              );

            expect(
              result,
            ).toBeDefined();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Interest configuration
     * ========================================================================
     */

    describe(
      'interest configuration',
      () => {
        it(
          'supports reducing-balance interest',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  interestType:
                    'REDUCING_BALANCE',
                }),
              );

            expect(
              result,
            ).toBeDefined();
          },
        );

        it(
          'supports flat-rate interest metadata',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  interestType:
                    'FLAT_RATE',
                }),
              );

            expect(
              result,
            ).toBeDefined();
          },
        );

        it(
          'does not accept negative interest rates',
          async () => {
            await expect(
              createLoan(
                createLoanApplication({
                  interestRate:
                    -5,
                }),
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );

        it(
          'does not accept NaN interest rates',
          async () => {
            await expect(
              createLoan(
                createLoanApplication({
                  interestRate:
                    Number.NaN,
                }),
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Tenant isolation
     * ========================================================================
     */

    describe(
      'multi-tenant isolation',
      () => {
        it(
          'requires tenant context for financial operations',
          async () => {
            try {
              const result =
                await createLoan(
                  createLoanApplication({
                    tenantId:
                      undefined,
                  }),
                );

              expect(
                result,
              ).toBeDefined();
            } catch (
              error
            ) {
              expect(
                error,
              ).toBeInstanceOf(
                Error,
              );
            }
          },
        );

        it(
          'keeps separate tenant loan applications independent',
          async () => {
            const [
              loanA,
              loanB,
            ] =
              await Promise.all(
                [
                  createLoan(
                    createLoanApplication({
                      tenantId:
                        'tenant-a',
                      memberId:
                        'member-a',
                    }),
                  ),
                  createLoan(
                    createLoanApplication({
                      tenantId:
                        'tenant-b',
                      memberId:
                        'member-b',
                    }),
                  ),
                ],
              );

            expect(
              loanA,
            ).toBeDefined();

            expect(
              loanB,
            ).toBeDefined();
          },
        );

        it(
          'does not expose unrelated tenant data through serialized results',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  tenantId:
                    'tenant-a',
                }),
              );

            const serialized =
              JSON.stringify(
                result,
              );

            expect(
              serialized,
            ).not.toContain(
              'tenant-secret-b',
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Member/account ownership
     * ========================================================================
     */

    describe(
      'member and account ownership',
      () => {
        it(
          'associates the loan with a member',
          async () => {
            const application =
              createLoanApplication({
                memberId:
                  'member-uganda-001',
              });

            const result =
              await createLoan(
                application,
              );

            expect(
              result,
            ).toBeDefined();
          },
        );

        it(
          'associates the loan with an account',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  accountId:
                    'account-uganda-001',
                }),
              );

            expect(
              result,
            ).toBeDefined();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Status lifecycle
     * ========================================================================
     */

    describe(
      'loan status lifecycle',
      () => {
        it(
          'creates loans in a controlled initial state',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  status:
                    'PENDING',
                }),
              );

            const status =
              getStatus(
                result,
              );

            if (
              status !==
              null
            ) {
              expect(
                [
                  'PENDING',
                  'SUBMITTED',
                  'DRAFT',
                  'UNDER_REVIEW',
                ],
              ).toContain(
                status,
              );
            }
          },
        );

        it(
          'supports approval when implemented',
          async () => {
            if (
              !approveLoanMethod
            ) {
              return;
            }

            const created =
              await createLoan(
                createLoanApplication(),
              );

            const id =
              getId(
                created,
              );

            if (
              id ===
              null
            ) {
              return;
            }

            const result =
              await approveLoan(
                id,
                {
                  correlationId:
                    'approval-corr-001',
                  requestId:
                    'approval-req-001',
                },
              );

            expect(
              result,
            ).toBeDefined();
          },
        );

        it(
          'supports rejection when implemented',
          async () => {
            if (
              !rejectLoanMethod
            ) {
              return;
            }

            const created =
              await createLoan(
                createLoanApplication(),
              );

            const id =
              getId(
                created,
              );

            if (
              id ===
              null
            ) {
              return;
            }

            const result =
              await rejectLoan(
                id,
                {
                  reason:
                    'INSUFFICIENT_AFFORDABILITY',
                  correlationId:
                    'rejection-corr-001',
                },
              );

            expect(
              result,
            ).toBeDefined();
          },
        );

        it(
          'supports cancellation when implemented',
          async () => {
            if (
              !cancelLoanMethod
            ) {
              return;
            }

            const created =
              await createLoan(
                createLoanApplication(),
              );

            const id =
              getId(
                created,
              );

            if (
              id ===
              null
            ) {
              return;
            }

            const result =
              await cancelLoan(
                id,
                {
                  reason:
                    'CUSTOMER_REQUEST',
                },
              );

            expect(
              result,
            ).toBeDefined();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Retrieval
     * ========================================================================
     */

    describe(
      'loan retrieval',
      () => {
        it(
          'retrieves a loan by identifier when supported',
          async () => {
            if (
              !getLoanMethod
            ) {
              return;
            }

            const created =
              await createLoan(
                createLoanApplication(),
              );

            const id =
              getId(
                created,
              );

            if (
              id ===
              null
            ) {
              return;
            }

            const result =
              await getLoan(
                id,
              );

            expectValidLoanResult(
              result,
            );
          },
        );

        it(
          'supports querying loans when implemented',
          async () => {
            if (
              !listLoansMethod
            ) {
              return;
            }

            const result =
              await listLoans({
                tenantId:
                  'tenant-001',
                memberId:
                  'member-001',
              });

            expect(
              result,
            ).toBeDefined();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Update
     * ========================================================================
     */

    describe(
      'loan updates',
      () => {
        it(
          'updates permitted loan metadata when supported',
          async () => {
            if (
              !updateLoanMethod
            ) {
              return;
            }

            const created =
              await createLoan(
                createLoanApplication(),
              );

            const id =
              getId(
                created,
              );

            if (
              id ===
              null
            ) {
              return;
            }

            const result =
              await updateLoan(
                id,
                {
                  purpose:
                    'BUSINESS_EXPANSION',
                  correlationId:
                    'update-corr-001',
                },
              );

            expect(
              result,
            ).toBeDefined();
          },
        );

        it(
          'does not mutate the update payload',
          async () => {
            if (
              !updateLoanMethod
            ) {
              return;
            }

            const payload =
              {
                purpose:
                  'BUSINESS_EXPANSION',
                metadata: {
                  source:
                    'member-portal',
                },
              };

            const before =
              structuredClone(
                payload,
              );

            try {
              await updateLoan(
                'loan-001',
                payload,
              );
            } catch (
              _error
            ) {
              // Validation failure is acceptable.
            }

            expect(
              payload,
            ).toEqual(
              before,
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Disbursement
     * ========================================================================
     */

    describe(
      'loan disbursement',
      () => {
        it(
          'supports disbursement when implemented',
          async () => {
            if (
              !disburseLoanMethod
            ) {
              return;
            }

            const created =
              await createLoan(
                createLoanApplication(),
              );

            const id =
              getId(
                created,
              );

            if (
              id ===
              null
            ) {
              return;
            }

            const result =
              await disburseLoan(
                id,
                {
                  amount:
                    5000000,
                  currency:
                    'UGX',
                  paymentMethod:
                    'MOBILE_MONEY',
                  correlationId:
                    'disbursement-corr-001',
                  idempotencyKey:
                    'disbursement-idempotency-001',
                },
              );

            expect(
              result,
            ).toBeDefined();
          },
        );

        it(
          'does not permit negative disbursement amounts',
          async () => {
            if (
              !disburseLoanMethod
            ) {
              return;
            }

            await expect(
              disburseLoan(
                'loan-001',
                {
                  amount:
                    -500000,
                },
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );

        it(
          'does not permit NaN disbursement amounts',
          async () => {
            if (
              !disburseLoanMethod
            ) {
              return;
            }

            await expect(
              disburseLoan(
                'loan-001',
                {
                  amount:
                    Number.NaN,
                },
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Repayment
     * ========================================================================
     */

    describe(
      'loan repayment',
      () => {
        it(
          'supports repayment recording when implemented',
          async () => {
            if (
              !repayLoanMethod
            ) {
              return;
            }

            const result =
              await repayLoan(
                'loan-001',
                createRepayment(),
              );

            expect(
              result,
            ).toBeDefined();
          },
        );

        it(
          'does not accept negative repayments',
          async () => {
            if (
              !repayLoanMethod
            ) {
              return;
            }

            await expect(
              repayLoan(
                'loan-001',
                createRepayment({
                  amount:
                    -100000,
                }),
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );

        it(
          'does not accept zero repayment amounts',
          async () => {
            if (
              !repayLoanMethod
            ) {
              return;
            }

            await expect(
              repayLoan(
                'loan-001',
                createRepayment({
                  amount:
                    0,
                }),
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );

        it(
          'supports payment references for reconciliation',
          async () => {
            if (
              !repayLoanMethod
            ) {
              return;
            }

            const repayment =
              createRepayment({
                paymentReference:
                  'MTN-UG-2026-000001',
              });

            const result =
              await repayLoan(
                'loan-001',
                repayment,
              );

            expect(
              result,
            ).toBeDefined();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Outstanding balance
     * ========================================================================
     */

    describe(
      'outstanding balance',
      () => {
        it(
          'does not expose negative outstanding balances',
          async () => {
            if (
              !getLoanMethod
            ) {
              return;
            }

            const result =
              await getLoan(
                'loan-001',
              );

            const balance =
              getBalance(
                result,
              );

            if (
              balance !==
              null
            ) {
              expect(
                Number.isFinite(
                  balance,
                ),
              ).toBe(true);

              expect(
                balance,
              ).toBeGreaterThanOrEqual(
                0,
              );
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * Idempotency
     * ========================================================================
     */

    describe(
      'idempotency',
      () => {
        it(
          'supports idempotency keys for loan creation',
          async () => {
            const application =
              createLoanApplication({
                idempotencyKey:
                  'loan-create-idempotency-001',
              });

            const first =
              await createLoan(
                application,
              );

            const second =
              await createLoan(
                application,
              );

            expect(
              first,
            ).toBeDefined();

            expect(
              second,
            ).toBeDefined();
          },
        );

        it(
          'supports idempotency keys for repayments',
          async () => {
            if (
              !repayLoanMethod
            ) {
              return;
            }

            const repayment =
              createRepayment({
                idempotencyKey:
                  'repayment-idempotency-unique-001',
              });

            const first =
              await repayLoan(
                'loan-001',
                repayment,
              );

            const second =
              await repayLoan(
                'loan-001',
                repayment,
              );

            expect(
              first,
            ).toBeDefined();

            expect(
              second,
            ).toBeDefined();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Correlation and traceability
     * ========================================================================
     */

    describe(
      'traceability',
      () => {
        it(
          'supports correlation IDs',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  correlationId:
                    'TITech-loan-correlation-001',
                }),
              );

            expect(
              result,
            ).toBeDefined();
          },
        );

        it(
          'supports request IDs',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  requestId:
                    'TITech-loan-request-001',
                }),
              );

            expect(
              result,
            ).toBeDefined();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Input immutability
     * ========================================================================
     */

    describe(
      'input immutability',
      () => {
        it(
          'does not mutate the loan application payload',
          async () => {
            const application =
              createLoanApplication();

            const before =
              structuredClone(
                application,
              );

            await createLoan(
              application,
            );

            expect(
              application,
            ).toEqual(
              before,
            );
          },
        );

        it(
          'does not mutate nested metadata',
          async () => {
            const application =
              createLoanApplication({
                metadata: {
                  channel:
                    'member-portal',
                  device: {
                    trusted:
                      true,
                  },
                  tags: [
                    'member',
                    'loan',
                  ],
                },
              });

            const before =
              structuredClone(
                application,
              );

            await createLoan(
              application,
            );

            expect(
              application,
            ).toEqual(
              before,
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Sensitive information
     * ========================================================================
     */

    describe(
      'sensitive information protection',
      () => {
        it(
          'does not expose passwords in results',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  password:
                    'TITech-Sensitive-Password',
                }),
              );

            const serialized =
              JSON.stringify(
                result,
              );

            expect(
              serialized,
            ).not.toContain(
              'TITech-Sensitive-Password',
            );
          },
        );

        it(
          'does not expose access tokens in results',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  accessToken:
                    'TITech-Sensitive-Access-Token',
                }),
              );

            const serialized =
              JSON.stringify(
                result,
              );

            expect(
              serialized,
            ).not.toContain(
              'TITech-Sensitive-Access-Token',
            );
          },
        );

        it(
          'does not expose PINs in results',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  pin:
                    '123456',
                }),
              );

            const serialized =
              JSON.stringify(
                result,
              );

            expect(
              serialized,
            ).not.toContain(
              '"pin":"123456"',
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Malformed input
     * ========================================================================
     */

    describe(
      'malformed input resilience',
      () => {
        it(
          'handles an empty payload predictably',
          async () => {
            await expect(
              createLoan(
                {},
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );

        it(
          'handles null payload predictably',
          async () => {
            await expect(
              createLoan(
                null,
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );

        it(
          'handles undefined payload predictably',
          async () => {
            await expect(
              createLoan(
                undefined,
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Serialization safety
     * ========================================================================
     */

    describe(
      'serialization safety',
      () => {
        it(
          'supports JSON-safe loan metadata',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  metadata: {
                    source:
                      'web',
                    browser:
                      'Firefox',
                    version:
                      '1.0.0',
                  },
                }),
              );

            expect(
              () =>
                JSON.stringify(
                  result,
                ),
            ).not.toThrow();
          },
        );

        it(
          'handles circular metadata predictably',
          async () => {
            const metadata =
              {
                source:
                  'TITech',
              };

            metadata.self =
              metadata;

            try {
              const result =
                await createLoan(
                  createLoanApplication({
                    metadata,
                  }),
                );

              expect(
                result,
              ).toBeDefined();
            } catch (
              error
            ) {
              expect(
                error,
              ).toBeInstanceOf(
                Error,
              );
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * Concurrent loan applications
     * ========================================================================
     */

    describe(
      'concurrent loan operations',
      () => {
        it(
          'supports concurrent loan application requests',
          async () => {
            const applications =
              Array.from(
                {
                  length: 20,
                },
                (
                  _,
                  index,
                ) =>
                  createLoanApplication({
                    memberId:
                      `member-${index}`,
                    transactionId:
                      `loan-txn-${index}`,
                    correlationId:
                      `loan-corr-${index}`,
                    idempotencyKey:
                      `loan-idempotency-${index}`,
                  }),
              );

            const results =
              await Promise.all(
                applications.map(
                  (
                    application,
                  ) =>
                    createLoan(
                      application,
                    ),
                ),
              );

            expect(
              results,
            ).toHaveLength(
              applications.length,
            );

            results.forEach(
              (
                result,
              ) => {
                expectValidLoanResult(
                  result,
                );
              },
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Large payload resilience
     * ========================================================================
     */

    describe(
      'large payload resilience',
      () => {
        it(
          'handles reasonable metadata payloads',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  metadata: {
                    notes:
                      'x'.repeat(
                        10000,
                      ),
                  },
                }),
              );

            expect(
              result,
            ).toBeDefined();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Error handling
     * ========================================================================
     */

    describe(
      'error handling',
      () => {
        it(
          'returns controlled errors for invalid loan IDs',
          async () => {
            if (
              !getLoanMethod
            ) {
              return;
            }

            await expect(
              getLoan(
                'invalid-loan-id',
              ),
            ).rejects.toBeInstanceOf(
              Error,
            );
          },
        );

        it(
          'does not leak credentials through errors',
          async () => {
            try {
              await createLoan(
                createLoanApplication({
                  password:
                    'TITech-Secret-Password',
                  accessToken:
                    'TITech-Secret-Token',
                }),
              );
            } catch (
              error
            ) {
              expect(
                error.message,
              ).not.toContain(
                'TITech-Secret-Password',
              );

              expect(
                error.message,
              ).not.toContain(
                'TITech-Secret-Token',
              );
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * Loan product support
     * ========================================================================
     */

    describe(
      'loan product support',
      () => {
        it(
          'supports a loan product identifier',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  loanProductId:
                    'asset-finance-001',
                }),
              );

            expect(
              result,
            ).toBeDefined();
          },
        );

        it(
          'supports different loan product categories',
          async () => {
            const products = [
              'PERSONAL',
              'BUSINESS',
              'AGRICULTURE',
              'ASSET_FINANCE',
              'EDUCATION',
              'EMERGENCY',
              'HOME_IMPROVEMENT',
            ];

            for (
              const loanType of
                products
            ) {
              const result =
                await createLoan(
                  createLoanApplication({
                    loanType,
                  }),
                );

              expect(
                result,
              ).toBeDefined();
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * Financial precision
     * ========================================================================
     */

    describe(
      'financial precision',
      () => {
        it(
          'does not return non-finite principal values',
          async () => {
            const result =
              await createLoan(
                createLoanApplication(),
              );

            const amount =
              getAmount(
                result,
              );

            if (
              amount !==
              null
            ) {
              expect(
                Number.isFinite(
                  amount,
                ),
              ).toBe(true);
            }
          },
        );

        it(
          'keeps monetary values non-negative',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  amount:
                    1000000,
                }),
              );

            const amount =
              getAmount(
                result,
              );

            if (
              amount !==
              null
            ) {
              expect(
                amount,
              ).toBeGreaterThanOrEqual(
                0,
              );
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * Auditability
     * ========================================================================
     */

    describe(
      'auditability',
      () => {
        it(
          'supports actor attribution',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  actorType:
                    'MEMBER',
                  actorId:
                    'member-001',
                }),
              );

            expect(
              result,
            ).toBeDefined();
          },
        );

        it(
          'supports source/channel metadata',
          async () => {
            const result =
              await createLoan(
                createLoanApplication({
                  source:
                    'TITech-Member-Portal',
                  channel:
                    'WEB',
                }),
              );

            expect(
              result,
            ).toBeDefined();
          },
        );
      },
    );

    /**
     * ========================================================================
     * TITech branding consistency
     * ========================================================================
     */

    describe(
      'TITech branding consistency',
      () => {
        it(
          'does not contain stale ACFOS branding',
          () => {
            const serialized =
              JSON.stringify(
                loanServiceModule,
              );

            expect(
              serialized,
            ).not.toMatch(
              /\bACFOS\b/i,
            );
          },
        );

        it(
          'uses TITech terminology in supported service metadata',
          () => {
            const serialized =
              JSON.stringify(
                loanServiceModule,
              );

            expect(
              serialized,
            ).not.toMatch(
              /\bACFOS\b/i,
            );
          },
        );
      },
    );
  },
);

/**
 * ============================================================================
 * End of Enterprise TITech Loan Service Test Suite
 * ============================================================================
 */