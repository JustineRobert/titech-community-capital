"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/src/infrastructure/logging/auditLogger.js
 * Enterprise Audit Logger
 * ============================================================================
 *
 * Audit Categories
 * ----------------------------------------------------------------------------
 * ✓ Authentication
 * ✓ Authorization
 * ✓ Savings
 * ✓ Loans
 * ✓ Billing
 * ✓ Mobile Money
 * ✓ Ledger
 * ✓ User Management
 * ✓ Configuration Changes
 * ✓ AML
 * ✓ Fraud
 * ✓ Security
 * ============================================================================
 */

const crypto = require("crypto");

const logger =
    require("./logger");

let prometheusService;

try {

    prometheusService =
        require(
            "../monitoring/prometheus.service"
        );

} catch (_) {

    prometheusService =
        null;
}

/* ============================================================================
 * Audit Event Types
 * ========================================================================== */

const AUDIT_EVENTS = Object.freeze({

    /* Authentication */

    LOGIN:
        "LOGIN",

    LOGOUT:
        "LOGOUT",

    PASSWORD_RESET:
        "PASSWORD_RESET",

    MFA_VERIFIED:
        "MFA_VERIFIED",

    /* Savings */

    SAVINGS_CREATED:
        "SAVINGS_CREATED",

    SAVINGS_DEPOSIT:
        "SAVINGS_DEPOSIT",

    SAVINGS_WITHDRAWAL:
        "SAVINGS_WITHDRAWAL",

    SAVINGS_ACCOUNT_CLOSED:
        "SAVINGS_ACCOUNT_CLOSED",

    /* Loans */

    LOAN_CREATED:
        "LOAN_CREATED",

    LOAN_APPROVED:
        "LOAN_APPROVED",

    LOAN_REJECTED:
        "LOAN_REJECTED",

    LOAN_DISBURSED:
        "LOAN_DISBURSED",

    LOAN_REPAYMENT:
        "LOAN_REPAYMENT",

    /* Billing */

    BILLING_INVOICE_CREATED:
        "BILLING_INVOICE_CREATED",

    BILLING_INVOICE_CANCELLED:
        "BILLING_INVOICE_CANCELLED",

    BILLING_FEE_APPLIED:
        "BILLING_FEE_APPLIED",

    /* Ledger */

    LEDGER_ENTRY_CREATED:
        "LEDGER_ENTRY_CREATED",

    /* Compliance */

    AML_ALERT:
        "AML_ALERT",

    FRAUD_ALERT:
        "FRAUD_ALERT",

    /* Security */

    UNAUTHORIZED_ACCESS:
        "UNAUTHORIZED_ACCESS",

    PERMISSION_DENIED:
        "PERMISSION_DENIED"
});

/* ============================================================================
 * Audit Logger
 * ========================================================================== */

class AuditLogger {

    constructor() {

        this.serviceName =
            "audit-logger";

        this.version =
            process.env.APP_VERSION ||
            "1.0.0";
    }

    /* ===================================================================== */
    /* GENERATE AUDIT ID                                                      */
    /* ===================================================================== */

    generateAuditId() {

        return crypto.randomUUID();
    }

    /* ===================================================================== */
    /* BUILD EVENT                                                            */
    /* ===================================================================== */

    buildEvent(
        payload
    ) {

        return {

            auditId:
                this.generateAuditId(),

            timestamp:
                new Date().toISOString(),

            service:
                this.serviceName,

            version:
                this.version,

            tenantId:
                payload.tenantId,

            userId:
                payload.userId,

            requestId:
                payload.requestId,

            correlationId:
                payload.correlationId,

            action:
                payload.action,

            category:
                payload.category,

            entityType:
                payload.entityType,

            entityId:
                payload.entityId,

            status:
                payload.status || "SUCCESS",

            ipAddress:
                payload.ipAddress,

            userAgent:
                payload.userAgent,

            before:
                payload.before || null,

            after:
                payload.after || null,

            metadata:
                payload.metadata || {}
        };
    }

    /* ===================================================================== */
    /* CORE AUDIT LOG                                                         */
    /* ===================================================================== */

    async log(
        payload = {}
    ) {

        const auditEvent =
            this.buildEvent(
                payload
            );

        logger.audit(

            auditEvent.action,

            auditEvent
        );

        try {

            prometheusService
                ?.incrementAudit?.(

                    auditEvent.action
                );

        } catch (_) {}

        return auditEvent;
    }

    /* ===================================================================== */
    /* ENTITY CHANGE                                                          */
    /* ===================================================================== */

    async trackChange(
        payload
    ) {

        return this.log({

            ...payload,

            metadata: {

                ...(payload.metadata || {}),

                changeDetected:
                    true
            }
        });
    }

    /* ===================================================================== */
    /* SECURITY EVENTS                                                        */
    /* ===================================================================== */

    async security(
        payload
    ) {

        return this.log({

            ...payload,

            category:
                "SECURITY"
        });
    }

    /* ===================================================================== */
    /* AML EVENTS                                                             */
    /* ===================================================================== */

    async aml(
        payload
    ) {

        return this.log({

            ...payload,

            category:
                "AML"
        });
    }

    /* ===================================================================== */
    /* FRAUD EVENTS                                                           */
    /* ===================================================================== */

    async fraud(
        payload
    ) {

        return this.log({

            ...payload,

            category:
                "FRAUD"
        });
    }

    /* ===================================================================== */
    /* BILLING EVENTS                                                         */
    /* ===================================================================== */

    async billing(
        payload
    ) {

        return this.log({

            ...payload,

            category:
                "BILLING"
        });
    }

    /* ===================================================================== */
    /* SAVINGS EVENTS                                                         */
    /* ===================================================================== */

    async savings(
        payload
    ) {

        return this.log({

            ...payload,

            category:
                "SAVINGS"
        });
    }

    /* ===================================================================== */
    /* LOAN EVENTS                                                            */
    /* ===================================================================== */

    async loan(
        payload
    ) {

        return this.log({

            ...payload,

            category:
                "LOANS"
        });
    }

    /* ===================================================================== */
    /* REQUEST CONTEXT                                                        */
    /* ===================================================================== */

    async fromRequest(
        req,
        action,
        metadata = {}
    ) {

        return this.log({

            tenantId:
                req.tenantId,

            userId:
                req.userId,

            requestId:
                req.requestId,

            correlationId:
                req.correlationId,

            ipAddress:
                req.ip,

            userAgent:
                req.headers[
                    "user-agent"
                ],

            action,

            metadata
        });
    }

    /* ===================================================================== */
    /* DIAGNOSTICS                                                            */
    /* ===================================================================== */

    diagnostics() {

        return {

            service:
                this.serviceName,

            version:
                this.version,

            supportedEvents:
                Object.keys(
                    AUDIT_EVENTS
                ),

            timestamp:
                new Date()
                    .toISOString()
        };
    }
}

/* ============================================================================
 * EXPORTS
 * ========================================================================== */

const auditLogger =
    new AuditLogger();

module.exports =
    auditLogger;

module.exports.AuditLogger =
    AuditLogger;

module.exports.AUDIT_EVENTS =
    AUDIT_EVENTS;