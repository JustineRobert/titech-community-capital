"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/services/savingsService.js
 * Enterprise Savings Service
 * ============================================================================
 */

const logger =
    require("../utils/logger");

const auditService =
    require("./auditService");

const metricsService =
    require("./metricsService");

const savingsRepository =
    require("../repositories/savingsRepository");

/*
|--------------------------------------------------------------------------
| Optional Enterprise Services
|--------------------------------------------------------------------------
*/

let fraudService;
let amlService;
let notificationService;

try {
    fraudService =
        require("./fraudService");
} catch (_) {}

try {
    amlService =
        require("./amlService");
} catch (_) {}

try {
    notificationService =
        require("./notificationService");
} catch (_) {}

/* ============================================================================
 * Savings Service
 * ========================================================================== */

class SavingsService {

    /* ===================================================================== */
    /* CREATE SAVINGS ACCOUNT                                                */
    /* ===================================================================== */

    async createSavingsAccount(
        payload
    ) {

        const {

            tenantId,

            user,

            memberId,

            accountType,

            openingBalance = 0,

            requestId,

            correlationId

        } = payload;

        try {

            const existingAccount =

                await savingsRepository
                    .findActiveByMember(

                        tenantId,

                        memberId,

                        accountType
                    );

            if (existingAccount) {

                throw new Error(
                    "Savings account already exists."
                );
            }

            const account =

                await savingsRepository
                    .create({

                        tenantId,

                        memberId,

                        accountType,

                        openingBalance,

                        status:
                            "ACTIVE",

                        createdBy:
                            user?.id
                    });

            await auditService.log({

                tenantId,

                action:
                    "SAVINGS_ACCOUNT_CREATED",

                accountId:
                    account.id,

                memberId,

                requestId,

                correlationId,

                performedBy:
                    user?.id
            });

            metricsService.increment(
                "titech.savings.account.created"
            );

            logger.info(
                "Savings account created",
                {
                    tenantId,
                    accountId: account.id,
                    memberId
                }
            );

            return account;

        } catch (error) {

            logger.error(
                "Create savings account failed",
                {
                    tenantId,
                    memberId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }

    /* ===================================================================== */
    /* WITHDRAW                                                              */
    /* ===================================================================== */

    async withdraw(
        payload
    ) {

        const {

            tenantId,

            userId,

            memberId,

            accountId,

            amount,

            reason,

            requestId,

            correlationId

        } = payload;

        try {

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {

                throw new Error(
                    "Invalid withdrawal amount."
                );
            }

            const account =

                await savingsRepository
                    .findById(

                        tenantId,

                        accountId
                    );

            if (!account) {

                throw new Error(
                    "Savings account not found."
                );
            }

            if (
                account.balance <
                amount
            ) {

                throw new Error(
                    "Insufficient funds."
                );
            }

            /*
             * Fraud Monitoring Hook
             */

            if (
                fraudService?.checkWithdrawalRisk
            ) {

                await fraudService
                    .checkWithdrawalRisk({

                        tenantId,

                        memberId,

                        amount,

                        accountId
                    });
            }

            /*
             * AML Monitoring Hook
             */

            if (
                amlService?.evaluateTransaction
            ) {

                await amlService
                    .evaluateTransaction({

                        tenantId,

                        memberId,

                        amount,

                        transactionType:
                            "WITHDRAWAL"
                    });
            }

            const transaction =

                await savingsRepository
                    .withdraw({

                        tenantId,

                        accountId,

                        amount,

                        reason,

                        performedBy:
                            userId
                    });

            await auditService.log({

                tenantId,

                userId,

                action:
                    "SAVINGS_WITHDRAWAL",

                accountId,

                memberId,

                amount,

                reason,

                requestId,

                correlationId,

                transactionId:
                    transaction.id
            });

            metricsService.increment(
                "titech.savings.withdrawal"
            );

            /*
             * Notifications
             */

            if (
                notificationService
                    ?.sendSavingsWithdrawalAlert
            ) {

                await notificationService
                    .sendSavingsWithdrawalAlert({

                        tenantId,

                        memberId,

                        amount,

                        accountId
                    });
            }

            logger.info(
                "Savings withdrawal processed",
                {

                    tenantId,

                    accountId,

                    amount,

                    transactionId:
                        transaction.id
                }
            );

            return transaction;

        } catch (error) {

            metricsService.increment(
                "titech.savings.withdrawal.failure"
            );

            logger.error(
                "Savings withdrawal failed",
                {

                    tenantId,

                    accountId,

                    amount,

                    error:
                        error.message
                }
            );

            throw error;
        }
    }

    /* ===================================================================== */
    /* BALANCE                                                               */
    /* ===================================================================== */

    async getMemberBalance(
        tenantId,
        memberId
    ) {

        return savingsRepository
            .getMemberBalance(
                tenantId,
                memberId
            );
    }

    /* ===================================================================== */
    /* MINI STATEMENT                                                        */
    /* ===================================================================== */

    async getMiniStatement(
        tenantId,
        memberId,
        options = {}
    ) {

        return savingsRepository
            .getMiniStatement(

                tenantId,

                memberId,

                options
            );
    }

    /* ===================================================================== */
    /* FULL STATEMENT                                                        */
    /* ===================================================================== */

    async getStatement(
        filters
    ) {

        return savingsRepository
            .getStatement(
                filters
            );
    }

    /* ===================================================================== */
    /* SUMMARY                                                               */
    /* ===================================================================== */

    async getSavingsSummary(
        filters
    ) {

        return savingsRepository
            .getSavingsSummary(
                filters
            );
    }
}

/* ============================================================================
 * Export Singleton
 * ========================================================================== */

const savingsService =
    new SavingsService();

module.exports =
    savingsService;

module.exports.SavingsService =
    SavingsService;