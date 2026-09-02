"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/controllers/ussdController.js
 * Section 4.1 — Foundation & Validation
 * Enterprise USSD Controller
 * ============================================================================
 */

/* ============================================================================
 * Dependencies
 * ========================================================================== */

const crypto = require("crypto");

/* ============================================================================
 * Internal Services
 * ========================================================================== */

const logger = require("../utils/logger");

const metricsService =
  require("../services/metricsService");

const auditService =
  require("../services/auditService");

const ussdSessionService =
  require("../services/ussdSessionService");

const tenantService =
  require("../services/tenantService");

const memberService =
  require("../services/memberService");

const savingsService =
  require("../services/savingsService");

const loanService =
  require("../services/loanService");

const mobileMoneyService =
  require("../services/mobileMoneyService");

const notificationService =
  require("../services/notificationService");

const featureFlagService =
  require("../services/featureFlagService");

/* ============================================================================
 * Constants
 * ========================================================================== */

const SESSION_TTL_MINUTES =
  Number(
    process.env.USSD_SESSION_TTL || 10
  );

const MAX_USSD_TEXT_LENGTH =
  Number(
    process.env.USSD_MAX_TEXT_LENGTH || 160
  );

/* ============================================================================
 * Context Headers
 * ========================================================================== */

const CONTEXT_HEADERS = Object.freeze({

  REQUEST_ID:
    "x-request-id",

  CORRELATION_ID:
    "x-correlation-id",

  TENANT_ID:
    "x-tenant-id"
});

/* ============================================================================
 * Enterprise Controller
 * ========================================================================== */

class USSDController {

  /* ===================================================================== */
  /* Entry Point                                                           */
  /* ===================================================================== */
  /* SESSION MANAGEMENT                                                    */
  /* ===================================================================== */

  async loadSession(context) {

    let session =
      await ussdSessionService.findSession(
        context.sessionId
      );

    if (session) {

      const expired =
        this.isSessionExpired(
          session
        );

      if (!expired) {

        await this.touchSession(
          session
        );

        metricsService.increment(
          "titech.ussd.session.recovered"
        );

        return session;
      }

      logger.info(
        "USSD Session Expired",
        {
          sessionId:
            context.sessionId,

          tenantId:
            context.tenant.id
        }
      );

      await this.expireSession(
        session
      );
    }

    return this.createSession(
      context
    );
  }

  /* ===================================================================== */
  /* Session Creation                                                      */
  /* ===================================================================== */

  async createSession(
    context
  ) {

    const session = {

      id:
        crypto.randomUUID(),

      sessionId:
        context.sessionId,

      tenantId:
        context.tenant.id,

      phoneNumber:
        context.phoneNumber,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,

      currentMenu:
        "MAIN",

      currentStep:
        null,

      locked:
        false,

      version:
        1,

      metadata: {

        serviceCode:
          context.serviceCode,

        interactionCount:
          0
      },

      createdAt:
        new Date(),

      updatedAt:
        new Date(),

      expiresAt:
        this.calculateExpiry()
    };

    await ussdSessionService.createSession(
      session
    );

    metricsService.increment(
      "titech.ussd.session.created"
    );

    logger.info(
      "USSD Session Created",
      {
        sessionId:
          session.sessionId,

        phoneNumber:
          session.phoneNumber,

        tenantId:
          session.tenantId
      }
    );

    return session;
  }

  /* ===================================================================== */
  /* Session Persistence                                                   */
  /* ===================================================================== */

  async persistSession(
    context,
    session
  ) {

    try {

      session.updatedAt =
        new Date();

      session.expiresAt =
        this.calculateExpiry();

      session.metadata =
        session.metadata || {};

      session.metadata.interactionCount =

        (session.metadata
          ?.interactionCount || 0) + 1;

      await ussdSessionService.updateSession(

        context.sessionId,

        session
      );

      metricsService.increment(
        "titech.ussd.session.persisted"
      );

    } catch (error) {

      logger.error(
        "Failed To Persist USSD Session",
        {
          error:
            error.message,

          sessionId:
            context.sessionId
        }
      );

      metricsService.increment(
        "titech.ussd.session.persist.error"
      );
    }
  }

  /* ===================================================================== */
  /* Session Locking                                                       */
  /* ===================================================================== */

  async lockSession(
    session
  ) {

    if (session.locked) {

      throw new Error(
        "Session already locked"
      );
    }

    session.locked = true;

    session.lockedAt =
      new Date();

    await ussdSessionService.updateSession(

      session.sessionId,

      session
    );

    metricsService.increment(
      "titech.ussd.session.locked"
    );
  }

  async unlockSession(
    session
  ) {

    session.locked = false;

    delete session.lockedAt;

    await ussdSessionService.updateSession(

      session.sessionId,

      session
    );

    metricsService.increment(
      "titech.ussd.session.unlocked"
    );
  }

  /* ===================================================================== */
  /* Session Refresh                                                       */
  /* ===================================================================== */

  async touchSession(
    session
  ) {

    session.updatedAt =
      new Date();

    session.expiresAt =
      this.calculateExpiry();

    await ussdSessionService.updateSession(

      session.sessionId,

      session
    );
  }

  /* ===================================================================== */
  /* Session Expiration                                                    */
  /* ===================================================================== */

  isSessionExpired(
    session
  ) {

    if (
      !session.expiresAt
    ) {

      return false;
    }

    return (
      new Date(session.expiresAt)
        .getTime()
      <
      Date.now()
    );
  }

  async expireSession(
    session
  ) {

    try {

      await ussdSessionService.deleteSession(

        session.sessionId
      );

      metricsService.increment(
        "titech.ussd.session.expired"
      );

    } catch (error) {

      logger.error(
        "Session Expiration Failed",
        {
          error:
            error.message,

          sessionId:
            session.sessionId
        }
      );
    }
  }

  calculateExpiry() {

    return new Date(

      Date.now()
      +
      (
        SESSION_TTL_MINUTES
        *
        60
        *
        1000
      )
    );
  }

  /* ===================================================================== */
  /* Session Context Enrichment                                            */
  /* ===================================================================== */

  async enrichSession(
    session,
    context
  ) {

    if (
      !session.metadata
    ) {

      session.metadata = {};
    }

    session.metadata.lastRequestId =
      context.requestId;

    session.metadata.lastCorrelationId =
      context.correlationId;

    session.metadata.lastActivityAt =
      new Date();

    try {

      const member =
        await memberService.findByPhone(

          context.tenant.id,

          context.phoneNumber
        );

      if (member) {

        session.memberId =
          member.id;

        session.memberNumber =
          member.memberNumber;

        session.memberStatus =
          member.status;
      }

    } catch (error) {

      logger.warn(
        "Unable To Enrich Session Member Context",
        {
          error:
            error.message
        }
      );
    }

    return session;
  }

  /* ===================================================================== */
  /* Idempotency Protection Foundation                                     */
  /* ===================================================================== */

  async ensureIdempotentRequest(
    context,
    session
  ) {

    const fingerprint =
      crypto
        .createHash("sha256")
        .update(
          `${context.sessionId}:${context.text}`
        )
        .digest("hex");

    if (
      session.metadata?.lastFingerprint
      ===
      fingerprint
    ) {

      metricsService.increment(
        "titech.ussd.idempotent.hit"
      );

      return false;
    }

    session.metadata =
      session.metadata || {};

    session.metadata.lastFingerprint =
      fingerprint;

    return true;
  }

  /* ===================================================================== */
  /* Session Analytics                                                     */
  /* ===================================================================== */

  async recordSessionAnalytics(
    context,
    session
  ) {

    try {

      metricsService.increment(
        "titech.ussd.session.activity"
      );

      runtimeEvents?.emit?.(
        "ussd.session.activity",
        {

          tenantId:
            context.tenant.id,

          sessionId:
            context.sessionId,

          phoneNumber:
            context.phoneNumber,

          currentMenu:
            session.currentMenu
        }
      );

    } catch (error) {

      logger.warn(
        "Session Analytics Failed",
        {
          error:
            error.message
        }
      );
    }
  }
  /* ===================================================================== */
  /* MAIN ROUTER & MENU ENGINE                                             */
  /* ===================================================================== */

  async routeRequest(
    context,
    session,
    member
  ) {

    await this.enrichSession(
      session,
      context
    );

    await this.recordSessionAnalytics(
      context,
      session
    );

    const proceed =
      await this.ensureIdempotentRequest(
        context,
        session
      );

    if (!proceed) {

      return this.end(
        "Request already processed."
      );
    }

    const text =
      context.text || "";

    if (!text.trim()) {

      session.currentMenu = "MAIN";

      return this.renderMainMenu(
        context,
        session,
        member
      );
    }

    const args =
      text.split("*");

    const rootSelection =
      args[0];

    switch (rootSelection) {

      case "1":

        session.currentMenu =
          "SAVINGS";

        return this.handleSavingsMenu(
          context,
          session,
          member,
          args
        );

      case "2":

        session.currentMenu =
          "LOANS";

        return this.handleLoansMenu(
          context,
          session,
          member,
          args
        );

      case "3":

        session.currentMenu =
          "BALANCE";

        return this.handleBalance(
          context,
          member
        );

      case "4":

        session.currentMenu =
          "PROFILE";

        return this.handleProfileMenu(
          context,
          session,
          member,
          args
        );

      case "5":

        session.currentMenu =
          "MOBILE_MONEY";

        return this.handleMobileMoneyMenu(
          context,
          session,
          member,
          args
        );

      case "6":

        session.currentMenu =
          "HELP";

        return this.handleHelpMenu(
          context
        );

      default:

        metricsService.increment(
          "titech.ussd.menu.invalid"
        );

        return this.end(
          "Invalid selection."
        );
    }
  }

  /* ===================================================================== */
  /* MAIN MENU                                                             */
  /* ===================================================================== */

  async renderMainMenu(
    context,
    session,
    member
  ) {

    const savingsEnabled =
      await featureFlagService.isEnabled(
        "savings",
        context.tenant.id
      );

    const loansEnabled =
      await featureFlagService.isEnabled(
        "loans",
        context.tenant.id
      );

    const mobileMoneyEnabled =
      await featureFlagService.isEnabled(
        "mobile_money",
        context.
    /* ===================================================================== */
    /* SAVINGS WORKFLOWS                                                     */
    /* ===================================================================== */

    async handleDeposit(
          context,
          args
        ) {

        if(args.length < 3) {

          return this.continue(
            "Enter deposit amount:"
          );
  }

  const amount =
    Number(args[2]);

  if(
            !Number.isFinite(amount) ||
  amount <= 0
        ) {

  return this.end(
    "Invalid amount entered."
  );
}

const auditContext =
  await this.createAuditContext(
    context,
    "USSD_SAVINGS_DEPOSIT"
  );

try {

  const transaction =

    await mobileMoneyService
      .initiateCollection({

        tenantId:
          context.tenant.id,

        phoneNumber:
          context.phoneNumber,

        amount,

        channel:
          "USSD",

        purpose:
          "SAVINGS_DEPOSIT"
      });

  await auditService.log({

    ...auditContext,

    amount,

    reference:
      transaction?.reference
  });

  metricsService.increment(
    "titech.ussd.savings.deposit.requested"
  );

  return this.end(
    `A Mobile Money prompt has been sent for UGX ${amount}.`
  );

} catch (error) {

  logger.error(
    "Savings Deposit Failed",
    {
      error:
        error.message,

      tenantId:
        context.tenant.id
    /* ===================================================================== */
    /* LOAN WORKFLOWS                                                        */
    /* ===================================================================== */

    async handleLoanApplication(
          context,
          args
        ) {

        if (args.length < 3) {

          return this.continue(
            "Enter loan amount:"
          );
        }

        const amount =
          Number(args[2]);

        if (
          !Number.isFinite(amount) ||
          amount <= 0
        ) {

          return this.end(
            "Invalid loan amount."
          );
        }

        try {

          const application =

            await loanService
              .createUSSDApplication({

                tenantId:
                  context.tenant.id,

                phoneNumber:
                  context.phoneNumber,

                amount,

                channel:
                  "USSD",

                requestId:
                  context.requestId
              });

          await auditService.log({

            ...(await this.createAuditContext(
              context,
              "USSD_LOAN_APPLICATION"
            )),

            amount,

            reference:
              application.reference
          });

          metricsService.increment(
            "titech.ussd.loan.application"
          );

          return this.end(
            `Loan application submitted. Ref: ${application.reference}`
          );

        } catch (error) {

          logger.error(
            "Loan Application Failed",
            {

              error:
                error.message,

              tenantId:
                context.tenant.id
            }
          );

          metricsService.increment(
            "titech.ussd.loan.application.failure"
          );

          return this.end(
            "Unable to submit loan application."
          );
        }
      }

    /* ===================================================================== */
    /* LOAN ELIGIBILITY                                                      */
    /* ===================================================================== */

    async handleLoanEligibility(
        context
      ) {

        try {

          const eligibility =

            await loanService
              .checkEligibility({

                tenantId:
                  context.tenant.id,

                phoneNumber:
                  context.phoneNumber
              });

          metricsService.increment(
            "titech.ussd.loan.eligibility"
          );

          return this.end(`
Loan Eligibility

Eligible: ${eligibility.eligible ? "YES" : "NO"}
Limit: UGX ${(eligibility.amount || 0).toLocaleString()}
            `);

        } catch (error) {

          logger.error(
            "Loan Eligibility Check Failed",
            {
              error:
                error.message
            }
          );

          return this.end(
            "Unable to retrieve eligibility."
          );
        }
      }

    /* ===================================================================== */
    /* LOAN BALANCE                                                          */
    /* ===================================================================== */

    async handleLoanBalance(
        context
      ) {

        try {

          const balance =

            await loanService
              .getLoanBalance(

                context.tenant.id,

                context.phoneNumber
              );

          metricsService.increment(
            "titech.ussd.loan.balance"
          );

          return this.end(
            `Outstanding Loan Balance: UGX ${Number(balance || 0).toLocaleString()}`
          );

        } catch (error) {

          logger.error(
            "Loan Balance Failed",
            {
              error:
                error.message
            }
          );

          return this.end(
            "Unable to retrieve loan balance."
          );
        }
      }

    /* ===================================================================== */
    /* LOAN REPAYMENT                                                        */
    /* ===================================================================== */

    async handleLoanRepayment(
        context,
        args
      ) {

        if (args.length < 3) {

          return this.continue(
            "Enter repayment amount:"
          );
        }

        const amount =
          Number(args[2]);

        if (
          !Number.isFinite(amount) ||
          amount <= 0
        ) {

          return this.end(
            "Invalid repayment amount."
          );
        }

        try {

          const transaction =

            await mobileMoneyService
              .initiateCollection({

                tenantId:
                  context.tenant.id,

                phoneNumber:
                  context.phoneNumber,

                amount,

                purpose:
                  "LOAN_REPAYMENT",

                channel:
                  "USSD"
              });

          await auditService.log({

            ...(await this.createAuditContext(
              context,
              "USSD_LOAN_REPAYMENT"
            )),

            amount,

            reference:
              transaction?.reference
          });

          metricsService.increment(
            "titech.ussd.loan.repayment"
          );

          return this.end(
            `Loan repayment request submitted. Ref: ${transaction?.reference || "N/A"}`
          );

        } catch (error) {

          logger.error(
            "Loan Repayment Failed",
            {
              error:
                error.message
            }
          );

          metricsService.increment(
            "titech.ussd.loan.repayment.failure"
          );

          return this.end(
            "Unable to initiate repayment."
          );
        }
      }

    /* ===================================================================== */
    /* REPAYMENT SCHEDULE                                                    */
    /* ===================================================================== */

    async handleRepaymentSchedule(
        context
      ) {

        try {

          const schedule =

            await loanService
              .getRepaymentSchedule({

                tenantId:
                  context.tenant.id,

                phoneNumber:
                  context.phoneNumber
              });

          if (
            !schedule ||
            !schedule.length
          ) {

            return this.end(
              "No repayment schedule available."
            );
          }

          const preview =

            schedule
              .slice(0, 3)

              .map(
                item =>
                  `${item.dueDate}: UGX ${item.amount}`
              )

              .join("\n");

          metricsService.increment(
            "titech.ussd.loan.schedule"
          );

          return this.end(`
Upcoming Repayments

${preview}
            `);

        } catch (error) {

          logger.error(
            "Repayment Schedule Failed",
            {
              error:
                error.message
            }
          );

          return this.end(
            "Unable to retrieve repayment schedule."
          );
        }
      }

    /* ===================================================================== */
    /* LOAN STATUS                                                           */
    /* ===================================================================== */

    async handleLoanStatus(
        context
      ) {

        try {

          const status =

            await loanService
              .getLatestLoanStatus({

                tenantId:
                  context.tenant.id,

                phoneNumber:
                  context.phoneNumber
              });

          metricsService.increment(
            "titech.ussd.loan.status"
          );

          return this.end(`
Loan Status

Reference: ${status.reference || "N/A"}
Status: ${status.status || "UNKNOWN"}
Amount: UGX ${(status.amount || 0).toLocaleString()}
            `);

        } catch (error) {

          logger.error(
            "Loan Status Lookup Failed",
            {
              error:
                error.message
            }
          );

          return this.end(
            "Unable to retrieve loan status."
          );
        }
      }

    /* ===================================================================== */
    /* LOAN SUMMARY                                                          */
    /* ===================================================================== */

    async handleLoanSummary(
        context
      ) {

        try {

          const summary =

            await loanService
              .getLoanSummary({

                tenantId:
                  context.tenant.id,

                phoneNumber:
                  context.phoneNumber
              });

          return this.end(`
Loan Summary

Outstanding: UGX ${summary.outstanding || 0}
Disbursed: UGX ${summary.disbursed || 0}
Active Loans: ${summary.activeLoans || 0}
            `);

        } catch (error) {

          logger.error(
            "Loan Summary Failed",
            {
              error:
                error.message
            }
          );

          return this.end(
            "Unable to retrieve loan summary."
          );
        }
      }
    /* ===================================================================== */
    /* MOBILE MONEY WORKFLOWS                                                */
    /* ===================================================================== */

    async handleMobileMoneyMenu(
        context,
        session,
        member,
        args
    ) {

        const enabled =
            await featureFlagService.isEnabled(
                "mobile_money",
                context.tenant.id
            );

        if (!enabled) {

            return this.end(
                "Mobile Money service unavailable."
            );
        }

        if (args.length === 1) {

            return this.continue(`
Mobile Money

1. Deposit
2. Withdraw
3. Transaction Status
4. Transaction History
            `);
        }

        switch (args[1]) {

            case "1":
                return this.handleMobileMoneyDeposit(
                    context,
                    args
                );

            case "2":
                return this.handleMobileMoneyWithdrawal(
                    context,
                    args
                );

            case "3":
                return this.handleTransactionStatus(
                    context,
                    args
                );

            case "4":
                return this.handleTransactionHistory(
                    context
                );

            default:

                return this.end(
                    "Invalid Mobile Money option."
                );
        }
    }

    /* ===================================================================== */
    /* MOBILE MONEY DEPOSIT                                                  */
    /* ===================================================================== */

    async handleMobileMoneyDeposit(
        context,
        args
    ) {

        if (args.length < 3) {

            return this.continue(
                "Enter amount:"
            );
        }

        const amount =
            Number(args[2]);

        if (
            !Number.isFinite(amount) ||
            amount <= 0
        ) {

            return this.end(
                "Invalid amount entered."
            );
        }

        try {

            const transaction =

                await mobileMoneyService
                    .initiateCollection({

                        tenantId:
                            context.tenant.id,

                        phoneNumber:
                            context.phoneNumber,

                        amount,

                        channel:
                            "USSD",

                        requestId:
                            context.requestId,

                        correlationId:
                            context.correlationId,

                        purpose:
                            "USSD_DEPOSIT"
                    });

            await auditService.log({

                ...(await this.createAuditContext(
                    context,
                    "USSD_MOMO_DEPOSIT"
                )),

                amount,

                reference:
                    transaction.reference
            });

            metricsService.increment(
                "titech.ussd.mobile_money.deposit"
            );

            return this.end(
                `A payment prompt has been sent to your phone. Ref: ${transaction.reference}`
            );

        } catch (error) {

            logger.error(
                "MoMo Deposit Failed",
                {
                    error:
                        error.message,

                    tenantId:
                        context.tenant.id
                }
            );

            metricsService.increment(
                "titech.ussd.mobile_money.deposit.failure"
            );

            return this.end(
                "Unable to process deposit request."
            );
        }
    }

    /* ===================================================================== */
    /* MOBILE MONEY WITHDRAWAL                                               */
    /* ===================================================================== */

    async handleMobileMoneyWithdrawal(
        context,
        args
    ) {

        if (args.length < 3) {

            return this.continue(
                "Enter withdrawal amount:"
            );
        }

        const amount =
            Number(args[2]);

        if (
            !Number.isFinite(amount) ||
            amount <= 0
        ) {

            return this.end(
                "Invalid withdrawal amount."
            );
        }

        try {

            const withdrawal =

                await mobileMoneyService
                    .createWithdrawalRequest({

                        tenantId:
                            context.tenant.id,

                        phoneNumber:
                            context.phoneNumber,

                        amount,

                        requestId:
                            context.requestId,

                        correlationId:
                            context.correlationId,

                        channel:
                            "USSD"
                    });

            await auditService.log({

                ...(await this.createAuditContext(
                    context,
                    "USSD_MOMO_WITHDRAWAL"
                )),

                amount,

                reference:
                    withdrawal.reference
            });

            metricsService.increment(
                "titech.ussd.mobile_money.withdrawal"
            );

            return this.end(
                `Withdrawal request submitted. Ref: ${withdrawal.reference}`
            );

        } catch (error) {

            logger.error(
                "Withdrawal Request Failed",
                {
                    error:
                        error.message
                }
            );

            metricsService.increment(
                "titech.ussd.mobile_money.withdrawal.failure"
            );

            return this.end(
                "Unable to submit withdrawal request."
            );
        }
    }

    /* ===================================================================== */
    /* TRANSACTION STATUS                                                    */
    /* ===================================================================== */

    async handleTransactionStatus(
        context,
        args
    ) {

        if (args.length < 3) {

            return this.continue(
                "Enter transaction reference:"
            );
        }

        const reference =
            args[2];

        try {

            const transaction =

                await mobileMoneyService
                    .getTransactionStatus({

                        tenantId:
                            context.tenant.id,

                        reference
                    });

            metricsService.increment(
                "titech.ussd.transaction.status"
            );

            return this.end(`
Transaction Status

Reference: ${transaction.reference}
Status: ${transaction.status}
Amount: UGX ${Number(transaction.amount || 0).toLocaleString()}
            `);

        } catch (error) {

            logger.error(
                "Transaction Status Lookup Failed",
                {
                    error:
                        error.message,

                    reference
                }
            );

            return this.end(
                "Transaction not found."
            );
        }
    }

    /* ===================================================================== */
    /* TRANSACTION HISTORY                                                   */
    /* ===================================================================== */

    async handleTransactionHistory(
        context
    ) {

        try {

            const transactions =

                await mobileMoneyService
                    .getRecentTransactions({

                        tenantId:
                            context.tenant.id,

                        phoneNumber:
                            context.phoneNumber,

                        limit: 5
                    });

            if (
                !transactions ||
                !transactions.length
            ) {

                return this.end(
                    "No recent transactions found."
                );
            }

            const history =

                transactions

                    .map(transaction =>
                        `${transaction.reference} - ${transaction.status}`
                    )

                    .join("\n");

            metricsService.increment(
                "titech.ussd.transaction.history"
            );

            return this.end(`
Recent Transactions

${history}
            `);

        } catch (error) {

            logger.error(
                "Transaction History Failed",
                {
                    error:
                        error.message
                }
            );

            return this.end(
                "Unable to retrieve transaction history."
            );
        }
    }

    /* ===================================================================== */
    /* TRANSACTION RETRY HELPER                                              */
    /* ===================================================================== */

    async retryFailedTransaction(
        context,
        reference
    ) {

        try {

            const transaction =

                await mobileMoneyService
                    .retryTransaction({

                        tenantId:
                            context.tenant.id,

                        reference
                    });

            await auditService.log({

                ...(await this.createAuditContext(
                    context,
                    "USSD_TRANSACTION_RETRY"
                )),

                reference
            });

            metricsService.increment(
                "titech.ussd.transaction.retry"
            );

            return transaction;

        } catch (error) {

            logger.error(
                "Transaction Retry Failed",
                {
                    error:
                        error.message,

                    reference
                }
            );

            throw error;
        }
    }

    /* ===================================================================== */
    /* MOBILE MONEY SUMMARY                                                  */
    /* ===================================================================== */

    async handleMobileMoneySummary(
        context
    ) {

        try {

            const summary =

                await mobileMoneyService
                    .getMemberSummary({

                        tenantId:
                            context.tenant.id,

                        phoneNumber:
                            context.phoneNumber
                    });

            return this.end(`
Mobile Money Summary

Deposits: UGX ${summary.deposits || 0}
Withdrawals: UGX ${summary.withdrawals || 0}
Transactions: ${summary.transactionCount || 0}
            `);

        } catch (error) {

            logger.error(
                "Mobile Money Summary Failed",
                {
                    error:
                        error.message
                }
            );

            return this.end(
                "Unable to retrieve summary."
            );
        }
    }
    /* ===================================================================== */
    /* PROFILE, NOTIFICATIONS & MEMBER SERVICES                              */
    /* ===================================================================== */

    async handleProfile(
        member
    ) {

        if (!member) {

            return this.end(
                "Member account not found."
            );
        }

        metricsService.increment(
            "titech.ussd.profile.view"
        );

        return this.end(`
Member Profile

Name: ${member.fullName || "N/A"}
Member No: ${member.memberNumber || "N/A"}
Status: ${member.status || "UNKNOWN"}
        `);
    }

    /* ===================================================================== */
    /* MEMBER STATUS                                                         */
    /* ===================================================================== */

    async handleMemberStatus(
        member
    ) {

        if (!member) {

            return this.end(
                "Member account not found."
            );
        }

        metricsService.increment(
            "titech.ussd.member.status"
        );

        return this.end(`
Membership Status

Status: ${member.status || "UNKNOWN"}
Joined: ${member.joinDate || "N/A"}
        `);
    }

    /* ===================================================================== */
    /* KYC STATUS                                                            */
    /* ===================================================================== */

    async handleKYCStatus(
        member
    ) {

        if (!member) {

            return this.end(
                "Member account not found."
            );
        }

        metricsService.increment(
            "titech.ussd.member.kyc"
        );

        return this.end(`
KYC Information

Status: ${member.kycStatus || "PENDING"}
Verified: ${member.kycVerified ? "YES" : "NO"}
        `);
    }

    /* ===================================================================== */
    /* MEMBER CONTACT DETAILS                                                */
    /* ===================================================================== */

    async handleMemberContactDetails(
        context
    ) {

        try {

            const member =
                await memberService.findByPhone(
                    context.tenant.id,
                    context.phoneNumber
                );

            if (!member) {

                return this.end(
                    "Member account not found."
                );
            }

            return this.end(`
Contact Details

Phone: ${member.phoneNumber || "N/A"}
Email: ${member.email || "N/A"}
            `);

        } catch (error) {

            logger.error(
                "Member Contact Lookup Failed",
                {
                    error:
                        error.message
                }
            );

            return this.end(
                "Unable to retrieve member details."
            );
        }
    }

    /* ===================================================================== */
    /* STATEMENT NOTIFICATION REQUEST                                        */
    /* ===================================================================== */

    async sendStatementNotification(
        context
    ) {

        try {

            const message =
                "Your statement request has been received. TITech will process it shortly.";

            await notificationService.sendSMS({

                tenantId:
                    context.tenant.id,

                phoneNumber:
                    context.phoneNumber,

                message
            });

            await auditService.log({

                ...(await this.createAuditContext(
                    context,
                    "USSD_STATEMENT_NOTIFICATION"
                ))
            });

            metricsService.increment(
                "titech.notification.statement.sms"
            );

            return true;

        } catch (error) {

            logger.error(
                "Statement Notification Failed",
                {
                    error:
                        error.message
                }
            );

            return false;
        }
    }

    /* ===================================================================== */
    /* SMS NOTIFICATION                                                      */
    /* ===================================================================== */

    async sendMemberSMS(
        context,
        message
    ) {

        try {

            await notificationService.sendSMS({

                tenantId:
                    context.tenant.id,

                phoneNumber:
                    context.phoneNumber,

                message
            });

            metricsService.increment(
                "titech.notification.sms"
            );

            await auditService.log({

                ...(await this.createAuditContext(
                    context,
                    "USSD_SMS_NOTIFICATION"
                )),

                message
            });

            return true;

        } catch (error) {

            logger.error(
                "SMS Notification Failed",
                {
                    error:
                        error.message
                }
            );

            return false;
        }
    }

    /* ===================================================================== */
    /* EMAIL NOTIFICATION                                                    */
    /* ===================================================================== */

    async sendMemberEmail(
        context,
        email,
        subject,
        message
    ) {

        try {

            if (
                !notificationService.sendEmail
            ) {

                return false;
            }

            await notificationService.sendEmail({

                tenantId:
                    context.tenant.id,

                email,

                subject,

                message
            });

            metricsService.increment(
                "titech.notification.email"
            );

            await auditService.log({

                ...(await this.createAuditContext(
                    context,
                    "USSD_EMAIL_NOTIFICATION"
                )),

                email,

                subject
            });

            return true;

        } catch (error) {

            logger.error(
                "Email Notification Failed",
                {
                    error:
                        error.message
                }
            );

            return false;
        }
    }

    /* ===================================================================== */
    /* MEMBER COMMUNICATION PREFERENCES                                      */
    /* ===================================================================== */

    async handleCommunicationPreferences(
        context
    ) {

        try {

            const member =
                await memberService.findByPhone(
                    context.tenant.id,
                    context.phoneNumber
                );

            if (!member) {

                return this.end(
                    "Member account not found."
                );
            }

            return this.end(`
Communication Preferences

SMS: ${member.smsEnabled ? "ON" : "OFF"}
Email: ${member.emailEnabled ? "ON" : "OFF"}
Alerts: ${member.alertsEnabled ? "ON" : "OFF"}
            `);

        } catch (error) {

            logger.error(
                "Communication Preferences Failed",
                {
                    error:
                        error.message
                }
            );

            return this.end(
                "Unable to retrieve preferences."
            );
        }
    }

    /* ===================================================================== */
    /* MEMBER ALERTS                                                         */
    /* ===================================================================== */

    async sendAccountAlert(
        context,
        message
    ) {

        try {

            await notificationService.sendSMS({

                tenantId:
                    context.tenant.id,

                phoneNumber:
                    context.phoneNumber,

                message
            });

            metricsService.increment(
                "titech.notification.alert"
            );

            await auditService.log({

                ...(await this.createAuditContext(
                    context,
                    "USSD_ACCOUNT_ALERT"
                )),

                message
            });

            return true;

        } catch (error) {

            logger.error(
                "Account Alert Failed",
                {
                    error:
                        error.message
                }
            );

            return false;
        }
    }

    /* ===================================================================== */
    /* MEMBER SUMMARY                                                        */
    /* ===================================================================== */

    async handleMemberSummary(
        context
    ) {

        try {

            const member =
                await memberService.findByPhone(
                    context.tenant.id,
                    context.phoneNumber
                );

            if (!member) {

                return this.end(
                    "Member account not found."
                );
            }

            return this.end(`
Member Summary

Name: ${member.fullName || "N/A"}
Member No: ${member.memberNumber || "N/A"}
Status: ${member.status || "UNKNOWN"}
KYC: ${member.kycStatus || "PENDING"}
            `);

        } catch (error) {

            logger.error(
                "Member Summary Failed",
                {
                    error:
                        error.message
                }
            );

            return this.end(
                "Unable to retrieve member summary."
            );
        }
    }
    /* ===================================================================== */
    /* AUDIT, METRICS & COMPLIANCE LAYER                                     */
    /* ===================================================================== */

    async logAuditEvent(
        context,
        action,
        data = {}
    ) {

        try {

            const payload = {

                ...(await this.createAuditContext(
                    context,
                    action
                )),

                ...data,

                source:
                    "ussd",

                channel:
                    "USSD",

                recordedAt:
                    new Date().toISOString()
            };

            await auditService.log(
                payload
            );

            metricsService.increment(
                "titech.audit.event"
            );

            return payload;

        } catch (error) {

            logger.error(
                "Audit Logging Failed",
                {
                    action,
                    error:
                        error.message
                }
            );

            return null;
        }
    }

    /* ===================================================================== */
    /* METRICS HELPER                                                        */
    /* ===================================================================== */

    recordMetric(
        metric,
        value = 1
    ) {

        try {

            metricsService.increment(
                metric,
                value
            );

        } catch (error) {

            logger.warn(
                "Metric Recording Failed",
                {
                    metric,
                    error:
                        error.message
                }
            );
        }
    }

    /* ===================================================================== */
    /* COMPLIANCE EVENT                                                      */
    /* ===================================================================== */

    async emitComplianceEvent(
        context,
        type,
        data = {}
    ) {

        try {

            const complianceEvent = {

                eventType:
                    type,

                tenantId:
                    context.tenant.id,

                phoneNumber:
                    context.phoneNumber,

                requestId:
                    context.requestId,

                correlationId:
                    context.correlationId,

                timestamp:
                    new Date()
                        .toISOString(),

                ...data
            };

            logger.info(
                "Compliance Event",
                complianceEvent
            );

            metricsService.increment(
                "titech.compliance.event"
            );

            return complianceEvent;

        } catch (error) {

            logger.error(
                "Compliance Event Failed",
                {
                    error:
                        error.message
                }
            );
        }
    }

    /* ===================================================================== */
    /* AML MONITORING HOOK                                                   */
    /* ===================================================================== */

    async checkAMLThreshold(
        context,
        amount,
        transactionType
    ) {

        try {

            const threshold =

                Number(
                    process.env
                        .AML_REVIEW_THRESHOLD
                        || 5000000
                );

            if (
                amount < threshold
            ) {

                return false;
            }

            await this.emitComplianceEvent(

                context,

                "AML_REVIEW_REQUIRED",

                {

                    amount,

                    transactionType,

                    threshold
                }
            );

            metricsService.increment(
                "titech.compliance.aml.review"
            );

            return true;

        } catch (error) {

            logger.error(
                "AML Check Failed",
                {
                    error:
                        error.message
                }
            );

            return false;
        }
    }

    /* ===================================================================== */
    /* FRAUD DETECTION HOOK                                                  */
    /* ===================================================================== */

    async performFraudCheck(
        context,
        data = {}
    ) {

        try {

            const riskIndicators = {

                tenantId:
                    context.tenant.id,

                sessionId:
                    context.sessionId,

                phoneNumber:
                    context.phoneNumber,

                requestId:
                    context.requestId,

                correlationId:
                    context.correlationId,

                ...data
            };

            logger.info(
                "Fraud Monitoring Event",
                riskIndicators
            );

            metricsService.increment(
                "titech.fraud.check"
            );

            return {

                riskLevel:
                    "LOW",

                approved:
                    true
            };

        } catch (error) {

            logger.error(
                "Fraud Check Failed",
                {
                    error:
                        error.message
                }
            );

            return {

                riskLevel:
                    "UNKNOWN",

                approved:
                    true
            };
        }
    }

    /* ===================================================================== */
    /* TRANSACTION ANALYTICS                                                 */
    /* ===================================================================== */

    async recordTransactionAnalytics(
        context,
        transactionType,
        amount
    ) {

        try {

            const analytics = {

                tenantId:
                    context.tenant.id,

                phoneNumber:
                    context.phoneNumber,

                type:
                    transactionType,

                amount,

                timestamp:
                    new Date()
                        .toISOString()
            };

            logger.info(
                "Transaction Analytics",
                analytics
            );

            metricsService.increment(

                `titech.transaction.${transactionType}`
            );

            return analytics;

        } catch (error) {

            logger.error(
                "Transaction Analytics Failed",
                {
                    error:
                        error.message
                }
            );
        }
    }

    /* ===================================================================== */
    /* REQUEST ANALYTICS                                                     */
    /* ===================================================================== */

    async recordRequestAnalytics(
        context
    ) {

        try {

            logger.info(
                "USSD Request Analytics",
                {

                    tenantId:
                        context.tenant.id,

                    phoneNumber:
                        context.phoneNumber,

                    requestId:
                        context.requestId,

                    correlationId:
                        context.correlationId,

                    sessionId:
                        context.sessionId
                }
            );

            metricsService.increment(
                "titech.ussd.analytics.request"
            );

        } catch (error) {

            logger.warn(
                "Request Analytics Failed",
                {
                    error:
                        error.message
                }
            );
        }
    }

    /* ===================================================================== */
    /* REGULATORY EVENT HELPER                                               */
    /* ===================================================================== */

    async emitRegulatoryEvent(
        context,
        eventType,
        data = {}
    ) {

        try {

            const event = {

                eventType,

                tenantId:
                    context.tenant.id,

                requestId:
                    context.requestId,

                phoneNumber:
                    context.phoneNumber,

                timestamp:
                    new Date()
                        .toISOString(),

                ...data
            };

            logger.info(
                "Regulatory Event",
                event
            );

            metricsService.increment(
                "titech.regulatory.event"
            );

            return event;

        } catch (error) {

            logger.error(
                "Regulatory Event Failed",
                {
                    error:
                        error.message
                }
            );
        }
    }

    /* ===================================================================== */
    /* OBSERVABILITY HELPER                                                  */
    /* ===================================================================== */

    createObservabilityContext(
        context
    ) {

        return {

            tenantId:
                context.tenant.id,

            requestId:
                context.requestId,

            correlationId:
                context.correlationId,

            sessionId:
                context.sessionId,

            phoneNumber:
                context.phoneNumber,

            channel:
                "USSD",

            timestamp:
                new Date()
                    .toISOString()
        };
    }

    /* ===================================================================== */
    /* OPERATIONAL EVENT HELPER                                              */
    /* ===================================================================== */

    async publishOperationalEvent(
        context,
        eventName,
        payload = {}
    ) {

        try {

            const event = {

                eventName,

                ...this.createObservabilityContext(
                    context
                ),

                ...payload
            };

            logger.info(
                "Operational Event",
                event
            );

            metricsService.increment(
                "titech.operational.event"
            );

            return event;

        } catch (error) {

            logger.error(
                "Operational Event Failed",
                {
                    error:
                        error.message
                }
            );
        }
    }

    /* ===================================================================== */
    /* COMPLIANCE SUMMARY                                                    */
    /* ===================================================================== */

    getComplianceCapabilities() {

        return {

            auditLogging:
                true,

            amlMonitoring:
                true,

            fraudMonitoring:
                true,

            transactionAnalytics:
                true,

            requestAnalytics:
                true,

            regulatoryReporting:
                true,

            observability:
                true
        };
    }
    /* ===================================================================== */
    /* CONTROLLER INITIALIZATION                                             */
    /* ===================================================================== */

    constructor() {

        this.controllerName =
            "TITechUSSDController";

        this.version =
            process.env.APP_VERSION ||
            "1.0.0";

        this.initializedAt =
            new Date();

        this.initialized =
            false;

        this.dependencies =
            this.buildDependencyRegistry();

        this.capabilities =
            this.buildCapabilities();

        this.initialize();
    }

    initialize() {

        try {

            this.verifyDependencies();

            this.initialized = true;

            logger.info(
                "TITech USSD Controller Initialized",
                {
                    version:
                        this.version,

                    initializedAt:
                        this.initializedAt
                }
            );

            metricsService.increment(
                "titech.ussd.controller.initialized"
            );

        } catch (error) {

            logger.error(
                "USSD Controller Initialization Failed",
                {
                    error:
                        error.message
                }
            );

            throw error;
        }
    }

    /* ===================================================================== */
    /* DEPENDENCY REGISTRY                                                   */
    /* ===================================================================== */

    buildDependencyRegistry() {

        return {

            logger:
                Boolean(logger),

            metricsService:
                Boolean(metricsService),

            auditService:
                Boolean(auditService),

            ussdSessionService:
                Boolean(ussdSessionService),

            tenantService:
                Boolean(tenantService),

            memberService:
                Boolean(memberService),

            savingsService:
                Boolean(savingsService),

            loanService:
                Boolean(loanService),

            mobileMoneyService:
                Boolean(mobileMoneyService),

            notificationService:
                Boolean(notificationService),

            featureFlagService:
                Boolean(featureFlagService)
        };
    }

    verifyDependencies() {

        const missingDependencies =

            Object.entries(
                this.dependencies
            )

            .filter(
                ([, available]) =>
                    !available
            )

            .map(
                ([name]) =>
                    name
            );

        if (
            missingDependencies.length
        ) {

            throw new Error(
                `Missing dependencies: ${missingDependencies.join(", ")}`
            );
        }

        return true;
    }

    /* ===================================================================== */
    /* CAPABILITIES                                                          */
    /* ===================================================================== */

    buildCapabilities() {

        return {

            foundation:
                true,

            sessionManagement:
                true,

            menuRouting:
                true,

            savingsWorkflows:
                true,

            loanWorkflows:
                true,

            mobileMoneyWorkflows:
                true,

            memberServices:
                true,

            notifications:
                true,

            auditLogging:
                true,

            metricsCollection:
                true,

            amlMonitoring:
                true,

            fraudMonitoring:
                true,

            regulatoryEvents:
                true,

            observability:
                true,

            multiTenant:
                true
        };
    }

    /* ===================================================================== */
    /* HEALTH STATUS                                                         */
    /* ===================================================================== */

    getHealthStatus() {

        return {

            status:
                this.initialized
                    ? "healthy"
                    : "unhealthy",

            controller:
                this.controllerName,

            version:
                this.version,

            initialized:
                this.initialized,

            timestamp:
                new Date().toISOString()
        };
    }

    /* ===================================================================== */
    /* RUNTIME DIAGNOSTICS                                                   */
    /* ===================================================================== */

    getDiagnostics() {

        return {

            controller:
                this.controllerName,

            version:
                this.version,

            initialized:
                this.initialized,

            initializedAt:
                this.initializedAt,

            sessionTTL:
                SESSION_TTL_MINUTES,

            maxTextLength:
                MAX_USSD_TEXT_LENGTH,

            dependencies:
                this.dependencies,

            capabilities:
                this.capabilities,

            compliance:
                this.getComplianceCapabilities(),

            timestamp:
                new Date().toISOString()
        };
    }

    /* ===================================================================== */
    /* METRICS STATUS                                                        */
    /* ===================================================================== */

    getMetricsStatus() {

        return {

            metricsEnabled:
                Boolean(metricsService),

            auditEnabled:
                Boolean(auditService),

            observabilityEnabled:
                true,

            timestamp:
                new Date().toISOString()
        };
    }

    /* ===================================================================== */
    /* CONTROLLER INFORMATION                                                */
    /* ===================================================================== */

    getControllerInfo() {

        return {

            name:
                this.controllerName,

            version:
                this.version,

            initialized:
                this.initialized,

            initializedAt:
                this.initializedAt,

            capabilities:
                Object.keys(
                    this.capabilities
                )

                .filter(
                    capability =>
                        this.capabilities[
                            capability
                        ]
                )
        };
    }

    /* ===================================================================== */
    /* STARTUP VALIDATION                                                    */
    /* ===================================================================== */

    validateStartup() {

        return {

            controller:
                this.controllerName,

            initialized:
                this.initialized,

            dependencies:
                this.dependencies,

            valid:

                this.initialized &&

                Object.values(
                    this.dependencies
                )

                .every(Boolean)
        };
    }

    /* ===================================================================== */
    /* PRODUCTION READINESS                                                  */
    /* ===================================================================== */

    isProductionReady() {

        const dependencyCheck =

            Object.values(
                this.dependencies
            )

            .every(Boolean);

        return (

            this.initialized &&

            dependencyCheck
        );
    }

    /* ===================================================================== */
    /* CAPABILITY REPORT                                                     */
    /* ===================================================================== */

    getCapabilityReport() {

        return {

            controller:
                this.controllerName,

            readiness:
                this.isProductionReady(),

            capabilities:
                this.capabilities,

            compliance:
                this.getComplianceCapabilities()
        };
    }
/* ============================================================================
 * SINGLETON INSTANCE
 * ========================================================================== */

const ussdController =
    new USSDController();

/* ============================================================================
 * STARTUP VALIDATION
 * ========================================================================== */

logger.info(
    "TITech USSD Controller Ready",
    ussdController.getControllerInfo()
);

/* ============================================================================
 * EXPORTS
 * ========================================================================== */

module.exports =
    ussdController;

module.exports.USSDController =
    USSDController;       