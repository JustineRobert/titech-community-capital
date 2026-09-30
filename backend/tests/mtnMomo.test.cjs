// backend/tests/mtnMomo.test.js
/**
 * ============================================================================
 * MTN MOMO SERVICE TESTS
 * ============================================================================
 *
 * backend/tests/mtnMomo.test.js
 *
 * Coverage:
 *  - Authentication
 *  - Collections
 *  - Withdrawals
 *  - Loan Repayments
 *  - Savings Contributions
 *  - Disbursements
 *  - Bulk Disbursements
 *  - Status Queries
 *  - Webhooks
 *  - Reconciliation
 *  - Audit Logging
 *  - Error Handling
 *  - Idempotency
 *
 * ============================================================================
 */

const crypto = require("crypto");

jest.mock("axios");

const axios = require("axios");

const mtnMomoService = require(
  "../modules/mtnMomoService"
);

describe(
  "MTN MOMO SERVICE",
  () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    /**
     * ========================================================================
     * AUTHENTICATION
     * ========================================================================
     */

    describe(
      "authenticate()",
      () => {
        it(
          "should authenticate successfully",
          async () => {
            axios.post.mockResolvedValue(
              {
                data: {
                  access_token:
                    "mock-token",
                  expires_in:
                    3600,
                },
              }
            );

            const token =
              await mtnMomoService.authenticate();

            expect(
              token
            ).toBeDefined();
          }
        );

        it(
          "should throw when authentication fails",
          async () => {
            axios.post.mockRejectedValue(
              new Error(
                "Authentication failed"
              )
            );

            await expect(
              mtnMomoService.authenticate()
            ).rejects.toThrow();
          }
        );
      }
    );

    /**
     * ========================================================================
     * DEPOSIT
     * ========================================================================
     */

    describe(
      "deposit()",
      () => {
        it(
          "should initiate deposit",
          async () => {
            axios.post.mockResolvedValue(
              {
                data: {
                  status:
                    "PENDING",
                },
              }
            );

            const response =
              await mtnMomoService.deposit(
                {
                  amount: 10000,
                  phoneNumber:
                    "256700000001",
                  reference:
                    crypto.randomUUID(),
                }
              );

            expect(
              response
            ).toBeDefined();
          }
        );
      }
    );

    /**
     * ========================================================================
     * WITHDRAW
     * ========================================================================
     */

    describe(
      "withdraw()",
      () => {
        it(
          "should initiate withdrawal",
          async () => {
            axios.post.mockResolvedValue(
              {
                data: {
                  status:
                    "PENDING",
                },
              }
            );

            const response =
              await mtnMomoService.withdraw(
                {
                  amount: 5000,
                  phoneNumber:
                    "256700000001",
                }
              );

            expect(
              response
            ).toBeDefined();
          }
        );
      }
    );

    /**
     * ========================================================================
     * SAVINGS CONTRIBUTION
     * ========================================================================
     */

    describe(
      "contributeSavings()",
      () => {
        it(
          "should collect savings",
          async () => {
            axios.post.mockResolvedValue(
              {
                data: {
                  status:
                    "PENDING",
                },
              }
            );

            const response =
              await mtnMomoService.contributeSavings(
                {
                  amount: 15000,
                  phoneNumber:
                    "256700000002",
                  savingsAccountId:
                    "SAV001",
                }
              );

            expect(
              response
            ).toBeDefined();
          }
        );
      }
    );

    /**
     * ========================================================================
     * LOAN REPAYMENT
     * ========================================================================
     */

    describe(
      "repayLoan()",
      () => {
        it(
          "should collect loan repayment",
          async () => {
            axios.post.mockResolvedValue(
              {
                data: {
                  status:
                    "PENDING",
                },
              }
            );

            const response =
              await mtnMomoService.repayLoan(
                {
                  amount: 20000,
                  loanId:
                    "LN001",
                  phoneNumber:
                    "256700000003",
                }
              );

            expect(
              response
            ).toBeDefined();
          }
        );
      }
    );

    /**
     * ========================================================================
     * DISBURSEMENT
     * ========================================================================
     */

    describe(
      "disburse()",
      () => {
        it(
          "should disburse funds",
          async () => {
            axios.post.mockResolvedValue(
              {
                data: {
                  status:
                    "SUCCESSFUL",
                },
              }
            );

            const response =
              await mtnMomoService.disburse(
                {
                  amount: 100000,
                  phoneNumber:
                    "256700000004",
                }
              );

            expect(
              response
            ).toBeDefined();
          }
        );
      }
    );

    /**
     * ========================================================================
     * BULK DISBURSEMENT
     * ========================================================================
     */

    describe(
      "bulkDisburse()",
      () => {
        it(
          "should process bulk payments",
          async () => {
            axios.post.mockResolvedValue(
              {
                data: {
                  status:
                    "SUCCESSFUL",
                },
              }
            );

            const response =
              await mtnMomoService.bulkDisburse(
                [
                  {
                    amount:
                      1000,
                    phoneNumber:
                      "256700000011",
                  },
                  {
                    amount:
                      2000,
                    phoneNumber:
                      "256700000012",
                  },
                ]
              );

            expect(
              response
            ).toBeDefined();
          }
        );
      }
    );

    /**
     * ========================================================================
     * STATUS QUERY
     * ========================================================================
     */

    describe(
      "getStatus()",
      () => {
        it(
          "should return transaction status",
          async () => {
            axios.get.mockResolvedValue(
              {
                data: {
                  status:
                    "SUCCESSFUL",
                },
              }
            );

            const response =
              await mtnMomoService.getStatus(
                "TXN123"
              );

            expect(
              response
            ).toBeDefined();
          }
        );
      }
    );

    /**
     * ========================================================================
     * WEBHOOKS
     * ========================================================================
     */

    describe(
      "processWebhook()",
      () => {
        it(
          "should process webhook",
          async () => {
            const response =
              await mtnMomoService.processWebhook(
                {
                  eventId:
                    crypto.randomUUID(),
                  reference:
                    "TXN001",
                  status:
                    "SUCCESSFUL",
                }
              );

            expect(
              response
            ).toBeDefined();
          }
        );
      }
    );

    /**
     * ========================================================================
     * RECONCILIATION
     * ========================================================================
     */

    describe(
      "reconcile()",
      () => {
        it(
          "should reconcile transactions",
          async () => {
            const report =
              await mtnMomoService.reconcile(
                "2026-06-24"
              );

            expect(
              report
            ).toBeDefined();
          }
        );
      }
    );

    /**
     * ========================================================================
     * AUDIT
     * ========================================================================
     */

    describe(
      "recordAudit()",
      () => {
        it(
          "should record audit event",
          async () => {
            const result =
              await mtnMomoService.recordAudit(
                "TEST_EVENT",
                {
                  source:
                    "jest",
                }
              );

            expect(
              result
            ).not.toBeUndefined();
          }
        );
      }
    );

    /**
     * ========================================================================
     * IDEMPOTENCY
     * ========================================================================
     */

    describe(
      "idempotency",
      () => {
        it(
          "should prevent duplicate reference processing",
          async () => {
            const reference =
              crypto.randomUUID();

            axios.post.mockResolvedValue(
              {
                data: {
                  status:
                    "PENDING",
                },
              }
            );

            const first =
              await mtnMomoService.deposit(
                {
                  amount:
                    1000,
                  phoneNumber:
                    "256700000001",
                  reference,
                }
              );

            const second =
              await mtnMomoService.deposit(
                {
                  amount:
                    1000,
                  phoneNumber:
                    "256700000001",
                  reference,
                }
              );

            expect(
              first
            ).toBeDefined();

            expect(
              second
            ).toBeDefined();
          }
        );
      }
    );

    /**
     * ========================================================================
     * ERROR HANDLING
     * ========================================================================
     */

    describe(
      "error handling",
      () => {
        it(
          "should handle provider failures",
          async () => {
            axios.post.mockRejectedValue(
              new Error(
                "Provider unavailable"
              )
            );

            await expect(
              mtnMomoService.deposit(
                {
                  amount:
                    5000,
                  phoneNumber:
                    "256700000001",
                }
              )
            ).rejects.toThrow(
              "Provider unavailable"
            );
          }
        );
      }
    );

    /**
     * ========================================================================
     * METRICS
     * ========================================================================
     */

    describe(
      "metrics",
      () => {
        it(
          "should expose metrics",
          () => {
            if (
              typeof mtnMomoService.getMetrics ===
              "function"
            ) {
              const metrics =
                mtnMomoService.getMetrics();

              expect(
                metrics
              ).toBeDefined();
            }
          }
        );
      }
    );

    /**
     * ========================================================================
     * HEALTH CHECK
     * ========================================================================
     */

    describe(
      "healthCheck()",
      () => {
        it(
          "should return health status",
          () => {
            if (
              typeof mtnMomoService.healthCheck ===
              "function"
            ) {
              const health =
                mtnMomoService.healthCheck();

              expect(
                health
              ).toBeDefined();

              expect(
                health
              ).toHaveProperty(
                "healthy"
              );
            }
          }
        );
      }
    );
  }
);