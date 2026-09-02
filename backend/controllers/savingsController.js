"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/controllers/savingsController.js
 * Enterprise Savings Controller
 * ============================================================================
 */

const logger =
    require("../utils/logger");

const savingsService =
    require("../services/savingsService");

const auditService =
    require("../services/auditService");

const metricsService =
    require("../services/metricsService");

class SavingsController {

    /* ===================================================================== */
    /* CREATE SAVINGS ACCOUNT                                                */
    /* ===================================================================== */

    async createSavingsAccount(
        req,
        res,
        next
    ) {

        try {

            const account =
                await savingsService.createSavingsAccount({

                    tenantId:
                        req.tenantId,

                    user:
                        req.user,

                    ...req.body
                });

            await this.audit(

                req,

                "SAVINGS_ACCOUNT_CREATED",

                {
                    accountId:
                        account.id
                }
            );

            return res.status(201).json({

                success: true,

                data:
                    account
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* GET ACCOUNT                                                           */
    /* ===================================================================== */

    async getSavingsAccount(
        req,
        res,
        next
    ) {

        try {

            const account =
                await savingsService.getSavingsAccount({

                    tenantId:
                        req.tenantId,

                    accountId:
                        req.params.accountId
                });

            return res.status(200).json({

                success: true,

                data:
                    account
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* BALANCE                                                               */
    /* ===================================================================== */

    async getBalance(
        req,
        res,
        next
    ) {

        try {

            const balance =
                await savingsService.getMemberBalance(

                    req.tenantId,

                    req.params.memberId
                );

            return res.status(200).json({

                success: true,

                data: {

                    balance
                }
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* DEPOSIT                                                               */
    /* ===================================================================== */

    async deposit(
        req,
        res,
        next
    ) {

        try {

            const result =
                await savingsService.deposit({

                    tenantId:
                        req.tenantId,

                    userId:
                        req.userId,

                    ...req.body
                });

            await this.audit(
                req,
                "SAVINGS_DEPOSIT",
                result
            );

            metricsService.increment(
                "titech.savings.deposit"
            );

            return res.status(200).json({

                success: true,

                data:
                    result
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* WITHDRAWAL REQUEST                                                    */
    /* ===================================================================== */

    async withdraw(
        req,
        res,
        next
    ) {

        try {

            const result =
                await savingsService.withdraw({

                    tenantId:
                        req.tenantId,

                    userId:
                        req.userId,

                    ...req.body
                });

            await this.audit(
                req,
                "SAVINGS_WITHDRAWAL",
                result
            );

            metricsService.increment(
                "titech.savings.withdrawal"
            );

            return res.status(200).json({

                success: true,

                data:
                    result
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* MINI STATEMENT                                                        */
    /* ===================================================================== */

    async miniStatement(
        req,
        res,
        next
    ) {

        try {

            const statement =
                await savingsService.getMiniStatement(

                    req.tenantId,

                    req.params.memberId,

                    {
                        limit: 10
                    }
                );

            return res.status(200).json({

                success: true,

                data:
                    statement
            });

        } catch (error) {

            next(error);
        }
    }

        /* ===================================================================== */
    /* FULL STATEMENT                                                        */
    /* ===================================================================== */

    async statement(
        req,
        res,
        next
    ) {

        try {

            const statement =
                await savingsService.getStatement({

                    tenantId:
                        req.tenantId,

                    memberId:
                        req.params.memberId,

                    accountId:
                        req.params.accountId,

                    from:
                        req.query.from,

                    to:
                        req.query.to,

                    format:
                        req.query.format || "json"
                });

            await this.audit(

                req,

                "SAVINGS_STATEMENT_VIEWED",

                {

                    memberId:
                        req.params.memberId,

                    accountId:
                        req.params.accountId
                }
            );

            metricsService.increment(
                "titech.savings.statement"
            );

            return res.status(200).json({

                success: true,

                data:
                    statement
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* INTEREST CALCULATION                                                  */
    /* ===================================================================== */

    async calculateInterest(
        req,
        res,
        next
    ) {

        try {

            const result =
                await savingsService.calculateInterest({

                    tenantId:
                        req.tenantId,

                    accountId:
                        req.params.accountId
                });

            return res.status(200).json({

                success: true,

                data:
                    result
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* SAVINGS SUMMARY                                                       */
    /* ===================================================================== */

    async summary(
        req,
        res,
        next
    ) {

        try {

            const summary =
                await savingsService.getSavingsSummary({

                    tenantId:
                        req.tenantId,

                    memberId:
                        req.params.memberId
                });

            return res.status(200).json({

                success: true,

                data:
                    summary
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* SAVINGS ACCOUNTS LIST                                                 */
    /* ===================================================================== */

    async listAccounts(
        req,
        res,
        next
    ) {

        try {

            const accounts =
                await savingsService.listAccounts({

                    tenantId:
                        req.tenantId,

                    filters:
                        req.query
                });

            return res.status(200).json({

                success: true,

                data:
                    accounts
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* ACTIVATE ACCOUNT                                                      */
    /* ===================================================================== */

    async activateAccount(
        req,
        res,
        next
    ) {

        try {

            const account =
                await savingsService.activateAccount({

                    tenantId:
                        req.tenantId,

                    accountId:
                        req.params.accountId,

                    activatedBy:
                        req.userId
                });

            await this.audit(

                req,

                "SAVINGS_ACCOUNT_ACTIVATED",

                {
                    accountId:
                        account.id
                }
            );

            return res.status(200).json({

                success: true,

                data:
                    account
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* CLOSE ACCOUNT                                                         */
    /* ===================================================================== */

    async closeAccount(
        req,
        res,
        next
    ) {

        try {

            const account =
                await savingsService.closeAccount({

                    tenantId:
                        req.tenantId,

                    accountId:
                        req.params.accountId,

                    reason:
                        req.body.reason,

                    closedBy:
                        req.userId
                });

            await this.audit(

                req,

                "SAVINGS_ACCOUNT_CLOSED",

                {
                    accountId:
                        account.id,

                    reason:
                        req.body.reason
                }
            );

            return res.status(200).json({

                success: true,

                data:
                    account
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* ADMIN PORTFOLIO REPORT                                                */
    /* ===================================================================== */

    async portfolioReport(
        req,
        res,
        next
    ) {

        try {

            const report =
                await savingsService.portfolioReport({

                    tenantId:
                        req.tenantId,

                    filters:
                        req.query
                });

            return res.status(200).json({

                success: true,

                data:
                    report
            });

        } catch (error) {

            next(error);
        }
    }

    /* ===================================================================== */
    /* AUDIT HELPER                                                          */
    /* ===================================================================== */

    async audit(
        req,
        action,
        metadata = {}
    ) {

        try {

            await auditService.log({

                tenantId:
                    req.tenantId,

                userId:
                    req.userId,

                action,

                requestId:
                    req.requestId,

                correlationId:
                    req.correlationId,

                source:
                    "SavingsController",

                metadata
            });

        } catch (error) {

            logger.error(
                "Savings Audit Failed",
                {

                    action,

                    error:
                        error.message
                }
            );
        }
    }

    /* ===================================================================== */
    /* DIAGNOSTICS                                                           */
    /* ===================================================================== */

    getDiagnostics() {

        return {

            controller:
                "SavingsController",

            version:
                "1.0.0",

            capabilities: [

                "create-account",
                "get-account",
                "balance",
                "deposit",
                "withdraw",
                "mini-statement",
                "statement",
                "interest",
                "summary",
                "activate-account",
                "close-account",
                "portfolio-report"
            ]
        };
    }
}

const savingsController =
    new SavingsController();

module.exports =
    savingsController;

module.exports.SavingsController =
    SavingsController;