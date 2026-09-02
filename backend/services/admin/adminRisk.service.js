"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Administrative Risk Management Service
 * =============================================================================
 *
 * File:
 *   backend/services/admin/adminRisk.service.js
 *
 * Purpose:
 *   Canonical application-service boundary for administrative risk,
 *   fraud-monitoring, compliance-risk, member-risk and operational-risk
 *   management within TITech Community Capital LTD.
 *
 * Responsibilities:
 *
 *   - Risk dashboard aggregation
 *   - Member risk assessment
 *   - Transaction risk aggregation
 *   - Loan risk aggregation
 *   - Fraud signal aggregation
 *   - Risk scoring
 *   - Risk classification
 *   - Risk case creation/update
 *   - Risk case assignment
 *   - Risk case resolution
 *   - Risk alerts
 *   - Risk event recording
 *   - Administrative risk decisions
 *   - Tenant isolation
 *   - Defense-in-depth authorization
 *   - Audit integration
 *   - Observability
 *
 * Architectural boundary:
 *
 *   HTTP Controller
 *          │
 *          ▼
 *   AdminRiskService
 *          │
 *          ├── Risk Domain Service
 *          ├── Loan Domain Service
 *          ├── Financial Transaction Service
 *          ├── Wallet / Ledger Services
 *          ├── KYC / Compliance Service
 *          ├── Fraud Service
 *          ├── User / Member Service
 *          ├── Audit Service
 *          └── Notification Service
 *
 * IMPORTANT:
 *
 *   This service does NOT directly mutate:
 *
 *     - wallet balances
 *     - financial ledgers
 *     - loan balances
 *     - contribution balances
 *     - payment records
 *
 *   Those operations belong to their canonical financial/domain services.
 *
 * TITech is the canonical platform identity.
 *
 * =============================================================================
 */

const SERVICE_NAME =
    "adminRisk.service";

const APPLICATION_NAME =
    "TITech Community Capital LTD";

const DOMAIN =
    "administration.risk";

/* =============================================================================
 * DEFAULTS
 * =============================================================================
 */

const DEFAULT_PAGE =
    1;

const DEFAULT_LIMIT =
    25;

const MAX_LIMIT =
    100;

const MAX_BULK_CASES =
    100;

const MAX_SEARCH_LENGTH =
    150;

/* =============================================================================
 * RISK LEVELS
 * =============================================================================
 */

const RISK_LEVEL = Object.freeze({
    LOW:
        "low",

    MEDIUM:
        "medium",

    HIGH:
        "high",

    CRITICAL:
        "critical"
});

/* =============================================================================
 * RISK STATUS
 * =============================================================================
 */

const RISK_STATUS = Object.freeze({
    OPEN:
        "open",

    MONITORING:
        "monitoring",

    REVIEW:
        "review",

    ESCALATED:
        "escalated",

    RESOLVED:
        "resolved",

    DISMISSED:
        "dismissed",

    FALSE_POSITIVE:
        "false_positive"
});

/* =============================================================================
 * RISK CASE STATUS
 * =============================================================================
 */

const CASE_STATUS = Object.freeze({
    OPEN:
        "open",

    ASSIGNED:
        "assigned",

    INVESTIGATING:
        "investigating",

    ESCALATED:
        "escalated",

    RESOLVED:
        "resolved",

    CLOSED:
        "closed",

    DISMISSED:
        "dismissed"
});

/* =============================================================================
 * RISK TYPES
 * =============================================================================
 */

const RISK_TYPE = Object.freeze({
    MEMBER:
        "member",

    TRANSACTION:
        "transaction",

    LOAN:
        "loan",

    PAYMENT:
        "payment",

    WALLET:
        "wallet",

    ACCOUNT:
        "account",

    KYC:
        "kyc",

    FRAUD:
        "fraud",

    AML:
        "aml",

    OPERATIONAL:
        "operational",

    SYSTEM:
        "system"
});

/* =============================================================================
 * OPERATIONS
 * =============================================================================
 */

const OPERATIONS = Object.freeze({
    DASHBOARD:
        "dashboard",

    SUMMARY:
        "summary",

    ASSESS_MEMBER:
        "member.assess",

    ASSESS_TRANSACTION:
        "transaction.assess",

    ASSESS_LOAN:
        "loan.assess",

    LIST_ALERTS:
        "alerts.list",

    GET_ALERT:
        "alerts.get",

    ACKNOWLEDGE_ALERT:
        "alerts.acknowledge",

    DISMISS_ALERT:
        "alerts.dismiss",

    CREATE_CASE:
        "case.create",

    GET_CASE:
        "case.get",

    LIST_CASES:
        "case.list",

    UPDATE_CASE:
        "case.update",

    ASSIGN_CASE:
        "case.assign",

    ESCALATE_CASE:
        "case.escalate",

    RESOLVE_CASE:
        "case.resolve",

    CLOSE_CASE:
        "case.close",

    DISMISS_CASE:
        "case.dismiss",

    RECORD_EVENT:
        "event.record",

    BULK:
        "bulk"
});

/* =============================================================================
 * ERROR CODES
 * =============================================================================
 */

const ERROR_CODES = Object.freeze({
    INVALID_CONTEXT:
        "ADMIN_RISK_INVALID_CONTEXT",

    TENANT_REQUIRED:
        "ADMIN_RISK_TENANT_REQUIRED",

    FORBIDDEN:
        "ADMIN_RISK_FORBIDDEN",

    INVALID_PARAMETER:
        "ADMIN_RISK_INVALID_PARAMETER",

    INVALID_IDENTIFIER:
        "ADMIN_RISK_INVALID_IDENTIFIER",

    INVALID_RISK_LEVEL:
        "ADMIN_RISK_INVALID_LEVEL",

    INVALID_RISK_TYPE:
        "ADMIN_RISK_INVALID_TYPE",

    INVALID_CASE_STATUS:
        "ADMIN_RISK_INVALID_CASE_STATUS",

    CASE_NOT_FOUND:
        "ADMIN_RISK_CASE_NOT_FOUND",

    ALERT_NOT_FOUND:
        "ADMIN_RISK_ALERT_NOT_FOUND",

    MEMBER_NOT_FOUND:
        "ADMIN_RISK_MEMBER_NOT_FOUND",

    TRANSACTION_NOT_FOUND:
        "ADMIN_RISK_TRANSACTION_NOT_FOUND",

    LOAN_NOT_FOUND:
        "ADMIN_RISK_LOAN_NOT_FOUND",

    BULK_LIMIT_EXCEEDED:
        "ADMIN_RISK_BULK_LIMIT_EXCEEDED",

    DEPENDENCY_UNAVAILABLE:
        "ADMIN_RISK_DEPENDENCY_UNAVAILABLE",

    CONFLICT:
        "ADMIN_RISK_CONFLICT",

    INTERNAL_ERROR:
        "ADMIN_RISK_INTERNAL_ERROR"
});

/* =============================================================================
 * RISK SCORE THRESHOLDS
 * =============================================================================
 *
 * Scores are normalized to 0-100.
 *
 *   0  - 24  = LOW
 *   25 - 49  = MEDIUM
 *   50 - 74  = HIGH
 *   75 - 100 = CRITICAL
 *
 * These are platform defaults. A dedicated risk policy/configuration service
 * may override them in the future.
 * =============================================================================
 */

const RISK_SCORE_THRESHOLDS = Object.freeze({
    LOW_MAX:
        24,

    MEDIUM_MAX:
        49,

    HIGH_MAX:
        74,

    CRITICAL_MAX:
        100
});

/* =============================================================================
 * ADMIN RISK PERMISSIONS
 * =============================================================================
 */

const RISK_VIEW_PERMISSIONS = Object.freeze([
    "admin.risk",
    "admin.risk.view",
    "risk.read",
    "risk.view",
    "compliance.read",
    "fraud.read",
    "admin.management.view",
    "admin.*",
    "*"
]);

const RISK_MANAGE_PERMISSIONS = Object.freeze([
    "admin.risk.manage",
    "risk.manage",
    "risk.write",
    "compliance.manage",
    "fraud.manage",
    "admin.*",
    "*"
]);

const RISK_CASE_MANAGE_PERMISSIONS = Object.freeze([
    "admin.risk.cases.manage",
    "risk.cases.manage",
    "risk.manage",
    "compliance.manage",
    "admin.*",
    "*"
]);

const RISK_ESCALATION_PERMISSIONS = Object.freeze([
    "admin.risk.escalate",
    "risk.escalate",
    "compliance.escalate",
    "fraud.escalate",
    "admin.*",
    "*"
]);

const RISK_PRIVILEGED_ROLES = Object.freeze([
    "super_admin",
    "superadmin",
    "platform_admin",
    "system_admin",
    "risk_admin",
    "risk_manager",
    "compliance_admin",
    "compliance_officer",
    "fraud_admin",
    "fraud_manager",
    "operations_admin"
]);

/* =============================================================================
 * DEPENDENCY ALIASES
 * =============================================================================
 */

const DEPENDENCY_ALIASES = Object.freeze({
    risk: [
        "riskService",
        "riskManagementService",
        "riskAssessmentService"
    ],

    fraud: [
        "fraudService",
        "fraudDetectionService",
        "fraudRiskService"
    ],

    compliance: [
        "complianceService",
        "kycService",
        "amlService",
        "complianceRiskService"
    ],

    user: [
        "userService",
        "usersService",
        "memberService",
        "membersService"
    ],

    loan: [
        "loanService",
        "loansService",
        "loanWorkflowService"
    ],

    transaction: [
        "financialTransactionService",
        "transactionService",
        "transactionsService"
    ],

    wallet: [
        "walletService",
        "walletManagementService"
    ],

    ledger: [
        "ledgerService",
        "ledgerManagementService"
    ],

    payment: [
        "paymentService",
        "paymentsService"
    ],

    alert: [
        "riskAlertService",
        "alertService",
        "alertsService"
    ],

    case: [
        "riskCaseService",
        "riskCasesService",
        "caseManagementService"
    ],

    audit: [
        "auditService",
        "auditLogService"
    ],

    notification: [
        "notificationService",
        "notificationsService"
    ],

    authorization: [
        "authorizationService",
        "permissionService",
        "rbacService",
        "accessControlService"
    ]
});

/* =============================================================================
 * METHOD ALIASES
 * =============================================================================
 */

const METHOD_ALIASES = Object.freeze({
    /* Risk ------------------------------------------------------------------ */

    getRiskDashboard: [
        "getRiskDashboard",
        "getDashboard",
        "dashboard"
    ],

    getRiskSummary: [
        "getRiskSummary",
        "getSummary",
        "summary"
    ],

    assessMemberRisk: [
        "assessMemberRisk",
        "assessUserRisk",
        "evaluateMemberRisk",
        "evaluateUserRisk"
    ],

    assessTransactionRisk: [
        "assessTransactionRisk",
        "evaluateTransactionRisk",
        "scoreTransactionRisk"
    ],

    assessLoanRisk: [
        "assessLoanRisk",
        "evaluateLoanRisk",
        "scoreLoanRisk"
    ],

    /* Fraud ----------------------------------------------------------------- */

    getFraudSignals: [
        "getFraudSignals",
        "getSignals",
        "listFraudSignals",
        "listSignals"
    ],

    assessFraudRisk: [
        "assessFraudRisk",
        "evaluateFraudRisk"
    ],

    /* Compliance ------------------------------------------------------------ */

    getComplianceRisk: [
        "getComplianceRisk",
        "getMemberComplianceRisk",
        "assessComplianceRisk"
    ],

    getKycStatus: [
        "getKycStatus",
        "getMemberKycStatus"
    ],

    /* Alerts ---------------------------------------------------------------- */

    listAlerts: [
        "listAlerts",
        "getAlerts",
        "findAlerts"
    ],

    getAlert: [
        "getAlert",
        "getAlertById",
        "findAlertById"
    ],

    acknowledgeAlert: [
        "acknowledgeAlert",
        "acknowledge"
    ],

    dismissAlert: [
        "dismissAlert",
        "dismiss"
    ],

    /* Cases ----------------------------------------------------------------- */

    createCase: [
        "createCase",
        "createRiskCase"
    ],

    getCase: [
        "getCase",
        "getCaseById",
        "getRiskCase",
        "getRiskCaseById"
    ],

    listCases: [
        "listCases",
        "getCases",
        "listRiskCases",
        "findCases"
    ],

    updateCase: [
        "updateCase",
        "updateRiskCase"
    ],

    assignCase: [
        "assignCase",
        "assignRiskCase"
    ],

    escalateCase: [
        "escalateCase",
        "escalateRiskCase"
    ],

    resolveCase: [
        "resolveCase",
        "resolveRiskCase"
    ],

    closeCase: [
        "closeCase",
        "closeRiskCase"
    ],

    dismissCase: [
        "dismissCase",
        "dismissRiskCase"
    ],

    /* Event ----------------------------------------------------------------- */

    recordRiskEvent: [
        "recordRiskEvent",
        "recordEvent",
        "createRiskEvent"
    ],

    /* Domain lookups -------------------------------------------------------- */

    getUser: [
        "getUser",
        "getUserById",
        "findUserById",
        "getMember",
        "getMemberById",
        "findMemberById"
    ],

    getLoan: [
        "getLoan",
        "getLoanById",
        "findLoanById"
    ],

    getTransaction: [
        "getTransaction",
        "getTransactionById",
        "findTransactionById",
        "getFinancialTransaction",
        "getFinancialTransactionById"
    ],

    /* Audit ----------------------------------------------------------------- */

    recordAudit: [
        "recordAudit",
        "createAuditLog",
        "writeAuditLog",
        "logAdminAction",
        "record"
    ]
});

/* =============================================================================
 * UTILITY FUNCTIONS
 * =============================================================================
 */

function normalizeString(
    value,
    fallback = null
) {
    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    try {
        const normalized =
            String(
                value
            ).trim();

        return normalized.length
            ? normalized
            : fallback;
    } catch {
        return fallback;
    }
}

function normalizeIdentifier(
    value
) {
    const identifier =
        normalizeString(
            value
        );

    if (
        !identifier
    ) {
        const error =
            new Error(
                "A valid identifier is required."
            );

        error.code =
            ERROR_CODES.INVALID_IDENTIFIER;

        throw error;
    }

    if (
        identifier.length >
        200
    ) {
        const error =
            new Error(
                "The supplied identifier is invalid."
            );

        error.code =
            ERROR_CODES.INVALID_IDENTIFIER;

        throw error;
    }

    return identifier;
}

function normalizePage(
    value
) {
    const page =
        Number(
            value
        );

    if (
        !Number.isFinite(
            page
        ) ||
        page < 1
    ) {
        return DEFAULT_PAGE;
    }

    return Math.floor(
        page
    );
}

function normalizeLimit(
    value
) {
    const limit =
        Number(
            value
        );

    if (
        !Number.isFinite(
            limit
        ) ||
        limit < 1
    ) {
        return DEFAULT_LIMIT;
    }

    return Math.min(
        Math.floor(
            limit
        ),
        MAX_LIMIT
    );
}

function normalizeSearch(
    value
) {
    const search =
        normalizeString(
            value
        );

    if (
        !search
    ) {
        return null;
    }

    return search.slice(
        0,
        MAX_SEARCH_LENGTH
    );
}

function normalizeBoolean(
    value,
    fallback = false
) {
    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    if (
        typeof value ===
        "boolean"
    ) {
        return value;
    }

    const normalized =
        String(
            value
        )
            .trim()
            .toLowerCase();

    if (
        [
            "true",
            "1",
            "yes",
            "on"
        ].includes(
            normalized
        )
    ) {
        return true;
    }

    if (
        [
            "false",
            "0",
            "no",
            "off"
        ].includes(
            normalized
        )
    ) {
        return false;
    }

    return fallback;
}

/* =============================================================================
 * CONTEXT
 * =============================================================================
 */

function normalizeContext(
    context = {}
) {
    const tenantId =
        normalizeString(
            context.tenantId
        );

    if (
        !tenantId
    ) {
        const error =
            new Error(
                "A tenant context is required for administrative risk operations."
            );

        error.code =
            ERROR_CODES.TENANT_REQUIRED;

        throw error;
    }

    return {
        tenantId,

        actorId:
            normalizeString(
                context.actorId
            ),

        requestId:
            normalizeString(
                context.requestId
            ),

        correlationId:
            normalizeString(
                context.correlationId
            ),

        deviceId:
            normalizeString(
                context.deviceId
            ),

        principal:
            context.principal ??
            context.actor ??
            null,

        session:
            context.session ??
            null,

        metadata:
            context.metadata ??
            {}
    };
}

/* =============================================================================
 * AUTHORIZATION HELPERS
 * =============================================================================
 */

function resolveRoles(
    principal
) {
    if (
        !principal
    ) {
        return [];
    }

    const roles = [];

    if (
        principal.role
    ) {
        roles.push(
            principal.role
        );
    }

    if (
        Array.isArray(
            principal.roles
        )
    ) {
        roles.push(
            ...principal.roles
        );
    }

    return [
        ...new Set(
            roles
                .filter(Boolean)
                .map(
                    role =>
                        String(
                            role
                        )
                            .trim()
                            .toLowerCase()
                )
        )
    ];
}

function resolvePermissions(
    principal
) {
    if (
        !principal
    ) {
        return [];
    }

    const permissions = [];

    if (
        Array.isArray(
            principal.permissions
        )
    ) {
        permissions.push(
            ...principal.permissions
        );
    }

    if (
        Array.isArray(
            principal.permissionCodes
        )
    ) {
        permissions.push(
            ...principal.permissionCodes
        );
    }

    return [
        ...new Set(
            permissions
                .filter(Boolean)
                .map(
                    permission =>
                        String(
                            permission
                        )
                            .trim()
                            .toLowerCase()
                )
        )
    ];
}

function hasRole(
    principal,
    roles
) {
    const principalRoles =
        resolveRoles(
            principal
        );

    return principalRoles.some(
        role =>
            roles.includes(
                role
            )
    );
}

function hasPermission(
    principal,
    permissions
) {
    const principalPermissions =
        resolvePermissions(
            principal
        );

    return principalPermissions.some(
        permission =>
            permissions.includes(
                permission
            )
    );
}

/* =============================================================================
 * RISK NORMALIZATION
 * =============================================================================
 */

function normalizeRiskLevel(
    value
) {
    const normalized =
        normalizeString(
            value
        );

    if (
        !normalized
    ) {
        return RISK_LEVEL.LOW;
    }

    const level =
        normalized.toLowerCase();

    if (
        !Object.values(
            RISK_LEVEL
        ).includes(
            level
        )
    ) {
        const error =
            new Error(
                `Unsupported risk level "${value}".`
            );

        error.code =
            ERROR_CODES.INVALID_RISK_LEVEL;

        throw error;
    }

    return level;
}

function normalizeRiskType(
    value
) {
    const normalized =
        normalizeString(
            value
        );

    if (
        !normalized
    ) {
        return RISK_TYPE.OPERATIONAL;
    }

    const type =
        normalized.toLowerCase();

    if (
        !Object.values(
            RISK_TYPE
        ).includes(
            type
        )
    ) {
        const error =
            new Error(
                `Unsupported risk type "${value}".`
            );

        error.code =
            ERROR_CODES.INVALID_RISK_TYPE;

        throw error;
    }

    return type;
}

function normalizeCaseStatus(
    value
) {
    const normalized =
        normalizeString(
            value,
            CASE_STATUS.OPEN
        )
            .toLowerCase();

    if (
        !Object.values(
            CASE_STATUS
        ).includes(
            normalized
        )
    ) {
        const error =
            new Error(
                `Unsupported risk case status "${value}".`
            );

        error.code =
            ERROR_CODES.INVALID_CASE_STATUS;

        throw error;
    }

    return normalized;
}

/* =============================================================================
 * SCORE CALCULATION
 * =============================================================================
 */

function clampRiskScore(
    score
) {
    const numeric =
        Number(
            score
        );

    if (
        !Number.isFinite(
            numeric
        )
    ) {
        return 0;
    }

    return Math.max(
        0,
        Math.min(
            100,
            Math.round(
                numeric
            )
        )
    );
}

function classifyRiskScore(
    score
) {
    const normalized =
        clampRiskScore(
            score
        );

    if (
        normalized <=
        RISK_SCORE_THRESHOLDS.LOW_MAX
    ) {
        return RISK_LEVEL.LOW;
    }

    if (
        normalized <=
        RISK_SCORE_THRESHOLDS.MEDIUM_MAX
    ) {
        return RISK_LEVEL.MEDIUM;
    }

    if (
        normalized <=
        RISK_SCORE_THRESHOLDS.HIGH_MAX
    ) {
        return RISK_LEVEL.HIGH;
    }

    return RISK_LEVEL.CRITICAL;
}

function calculateRiskScore(
    signals = {}
) {
    /*
     * The local scoring model is deliberately conservative.
     *
     * External/canonical risk services can provide a score directly. When
     * they do not, this method provides a deterministic fallback score.
     */

    let score =
        0;

    const weights = {
        fraud:
            30,

        aml:
            25,

        kyc:
            20,

        transaction:
            15,

        loan:
            15,

        account:
            10,

        velocity:
            15,

        operational:
            5
    };

    for (
        const [
            key,
            weight
        ] of
            Object.entries(
                weights
            )
    ) {
        const value =
            Number(
                signals[
                    key
                ]
            );

        if (
            Number.isFinite(
                value
            )
        ) {
            score +=
                weight *
                Math.max(
                    0,
                    Math.min(
                        1,
                        value
                    )
                );
        }
    }

    return clampRiskScore(
        score
    );
}

/* =============================================================================
 * SERVICE
 * =============================================================================
 */

class AdminRiskService {

    constructor(
        dependencies = {}
    ) {
        this.dependencies =
            dependencies;

        this.servicesContext =
            dependencies.servicesContext ??
            dependencies.serviceContext ??
            dependencies.container ??
            null;

        this.logger =
            dependencies.logger ??
            null;

        this.metrics =
            dependencies.metrics ??
            dependencies.observability ??
            null;

        this.cache =
            dependencies.cache ??
            dependencies.cacheService ??
            null;

        this.clock =
            dependencies.clock ??
            {
                now: () =>
                    new Date()
            };
    }

    /* =========================================================================
     * DEPENDENCY RESOLUTION
     * =========================================================================
     */

    resolveDependency(
        type
    ) {
        const aliases =
            DEPENDENCY_ALIASES[
                type
            ] ||
            [];

        for (
            const name of
                aliases
        ) {
            const service =
                this.tryResolveService(
                    name
                );

            if (
                service
            ) {
                return service;
            }
        }

        return null;
    }

    tryResolveService(
        name
    ) {
        const container =
            this.servicesContext;

        if (
            container
        ) {
            if (
                typeof
                    container.requireService ===
                    "function"
            ) {
                try {
                    const service =
                        container.requireService(
                            name
                        );

                    if (
                        service
                    ) {
                        return service;
                    }
                } catch {
                    // Continue resolving.
                }
            }

            if (
                typeof
                    container.service ===
                    "function"
            ) {
                try {
                    const service =
                        container.service(
                            name
                        );

                    if (
                        service
                    ) {
                        return service;
                    }
                } catch {
                    // Continue resolving.
                }
            }

            if (
                typeof
                    container.get ===
                    "function"
            ) {
                try {
                    const service =
                        container.get(
                            name
                        );

                    if (
                        service
                    ) {
                        return service;
                    }
                } catch {
                    // Continue resolving.
                }
            }

            if (
                container[
                    name
                ]
            ) {
                return container[
                    name
                ];
            }
        }

        if (
            this.dependencies[
                name
            ]
        ) {
            return this.dependencies[
                name
            ];
        }

        return null;
    }

    resolveMethod(
        service,
        operation
    ) {
        if (
            !service
        ) {
            return null;
        }

        const aliases =
            METHOD_ALIASES[
                operation
            ] ||
            [];

        for (
            const methodName of
                aliases
        ) {
            if (
                typeof
                    service[
                        methodName
                    ] ===
                    "function"
            ) {
                return service[
                    methodName
                ].bind(
                    service
                );
            }
        }

        return null;
    }

    async invoke(
        type,
        operation,
        payload,
        context,
        options = {}
    ) {
        const service =
            this.resolveDependency(
                type
            );

        if (
            !service
        ) {
            if (
                options.required
            ) {
                const error =
                    new Error(
                        `Required risk dependency "${type}" is unavailable.`
                    );

                error.code =
                    ERROR_CODES.DEPENDENCY_UNAVAILABLE;

                throw error;
            }

            return null;
        }

        const method =
            this.resolveMethod(
                service,
                operation
            );

        if (
            !method
        ) {
            if (
                options.required
            ) {
                const error =
                    new Error(
                        `Risk dependency "${type}" does not support "${operation}".`
                    );

                error.code =
                    ERROR_CODES.DEPENDENCY_UNAVAILABLE;

                throw error;
            }

            return null;
        }

        return method(
            {
                ...payload,

                tenantId:
                    context.tenantId
            },
            context
        );
    }

    /* =========================================================================
     * LOGGING
     * =========================================================================
     */

    log(
        level,
        message,
        metadata = {}
    ) {
        const payload = {
            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            domain:
                DOMAIN,

            message,

            ...metadata
        };

        if (
            this.logger &&
            typeof
                this.logger[
                    level
                ] ===
                "function"
        ) {
            try {
                this.logger[
                    level
                ](
                    payload
                );

                return;
            } catch {
                // Logging must never break risk operations.
            }
        }

        if (
            level ===
                "error" &&
            process.env.NODE_ENV !==
                "production"
        ) {
            try {
                // eslint-disable-next-line no-console
                console.error(
                    `[${SERVICE_NAME}]`,
                    payload
                );
            } catch {
                // Ignore logging errors.
            }
        }
    }

    /* =========================================================================
     * METRICS
     * =========================================================================
     */

    incrementMetric(
        name,
        value = 1,
        labels = {}
    ) {
        if (
            !this.metrics
        ) {
            return;
        }

        try {
            if (
                typeof
                    this.metrics.increment ===
                    "function"
            ) {
                this.metrics.increment(
                    name,
                    value,
                    labels
                );

                return;
            }

            if (
                typeof
                    this.metrics.counter ===
                    "function"
            ) {
                const counter =
                    this.metrics.counter(
                        name
                    );

                if (
                    counter &&
                    typeof
                        counter.inc ===
                        "function"
                ) {
                    counter.inc(
                        labels,
                        value
                    );
                }
            }
        } catch {
            // Metrics are non-critical.
        }
    }

    /* =========================================================================
     * AUTHORIZATION
     * =========================================================================
     */

    assertRiskViewAccess(
        context
    ) {
        this.assertAccess(
            context,
            RISK_VIEW_PERMISSIONS
        );
    }

    assertRiskManageAccess(
        context
    ) {
        this.assertAccess(
            context,
            RISK_MANAGE_PERMISSIONS
        );
    }

    assertCaseManageAccess(
        context
    ) {
        this.assertAccess(
            context,
            RISK_CASE_MANAGE_PERMISSIONS
        );
    }

    assertEscalationAccess(
        context
    ) {
        this.assertAccess(
            context,
            RISK_ESCALATION_PERMISSIONS
        );
    }

    assertAccess(
        context,
        permissions
    ) {
        const principal =
            context.principal;

        /*
         * Controller/router authorization is the primary boundary.
         *
         * The service additionally protects itself if called directly.
         */
        if (
            !principal
        ) {
            return true;
        }

        if (
            principal.isSuperAdmin ===
                true ||
            principal.isAdmin ===
                true ||
            hasRole(
                principal,
                RISK_PRIVILEGED_ROLES
            ) ||
            hasPermission(
                principal,
                permissions
            )
        ) {
            return true;
        }

        const error =
            new Error(
                "The authenticated principal is not authorized to perform this risk-management operation."
            );

        error.code =
            ERROR_CODES.FORBIDDEN;

        throw error;
    }

    /* =========================================================================
     * AUDIT
     * =========================================================================
     */

    async audit(
        operation,
        context,
        metadata = {}
    ) {
        const auditService =
            this.resolveDependency(
                "audit"
            );

        if (
            !auditService
        ) {
            this.log(
                "warn",
                "Risk audit service unavailable.",
                {
                    operation,
                    actorId:
                        context.actorId,
                    tenantId:
                        context.tenantId
                }
            );

            return null;
        }

        const method =
            this.resolveMethod(
                auditService,
                "recordAudit"
            );

        if (
            !method
        ) {
            return null;
        }

        try {
            return await method(
                {
                    tenantId:
                        context.tenantId,

                    actorId:
                        context.actorId,

                    action:
                        operation,

                    resource:
                        "administrative-risk",

                    requestId:
                        context.requestId,

                    correlationId:
                        context.correlationId,

                    metadata:
                        sanitizeMetadata(
                            metadata
                        )
                },
                context
            );
        } catch (error) {
            this.log(
                "error",
                "Risk audit operation failed.",
                {
                    operation,
                    tenantId:
                        context.tenantId,

                    actorId:
                        context.actorId,

                    error:
                        normalizeError(
                            error
                        )
                }
            );

            this.incrementMetric(
                "titech_admin_risk_audit_failure_total"
            );

            return null;
        }
    }

    /* =========================================================================
     * DASHBOARD
     * =========================================================================
     */

    async getRiskDashboard(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRiskViewAccess(
            normalizedContext
        );

        const startedAt =
            this.clock.now();

        this.incrementMetric(
            "titech_admin_risk_dashboard_total"
        );

        const result =
            await this.invoke(
                "risk",
                "getRiskDashboard",
                {
                    period:
                        normalizePeriod(
                            input.period
                        ),

                    from:
                        normalizeDate(
                            input.from
                        ),

                    to:
                        normalizeDate(
                            input.to
                        ),

                    includeResolved:
                        normalizeBoolean(
                            input.includeResolved,
                            false
                        )
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        if (
            result
        ) {
            return normalizeRiskDashboard(
                result
            );
        }

        const summary =
            await this.getRiskSummary(
                input,
                normalizedContext
            );

        const alerts =
            await this.listAlerts(
                {
                    page:
                        1,

                    limit:
                        normalizeLimit(
                            input.alertLimit ??
                            10
                        ),

                    status:
                        input.alertStatus
                },
                normalizedContext
            );

        const cases =
            await this.listCases(
                {
                    page:
                        1,

                    limit:
                        normalizeLimit(
                            input.caseLimit ??
                            10
                        ),

                    status:
                        input.caseStatus
                },
                normalizedContext
            );

        const duration =
            this.clock.now()
                .getTime() -
            startedAt.getTime();

        this.log(
            "info",
            "Administrative risk dashboard generated.",
            {
                tenantId:
                    normalizedContext.tenantId,

                actorId:
                    normalizedContext.actorId,

                durationMs:
                    duration
            }
        );

        return {
            summary,

            alerts,

            cases,

            generatedAt:
                this.clock.now()
                    .toISOString()
        };
    }

    /* =========================================================================
     * RISK SUMMARY
     * =========================================================================
     */

    async getRiskSummary(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRiskViewAccess(
            normalizedContext
        );

        const result =
            await this.invoke(
                "risk",
                "getRiskSummary",
                {
                    period:
                        normalizePeriod(
                            input.period
                        ),

                    from:
                        normalizeDate(
                            input.from
                        ),

                    to:
                        normalizeDate(
                            input.to
                        )
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        if (
            result
        ) {
            return normalizeRiskSummary(
                result
            );
        }

        const [
            alerts,
            cases
        ] =
            await Promise.all([
                this.listAlerts(
                    {
                        page:
                            1,

                        limit:
                            MAX_LIMIT
                    },
                    normalizedContext
                ),

                this.listCases(
                    {
                        page:
                            1,

                        limit:
                            MAX_LIMIT
                    },
                    normalizedContext
                )
            ]);

        const alertItems =
            alerts.data ??
            [];

        const caseItems =
            cases.data ??
            [];

        return buildRiskSummary(
            alertItems,
            caseItems
        );
    }

    /* =========================================================================
     * MEMBER RISK ASSESSMENT
     * =========================================================================
     */

    async assessMemberRisk(
        memberId,
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRiskViewAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                memberId
            );

        const startedAt =
            this.clock.now();

        /*
         * Prefer canonical risk engine.
         */
        const canonical =
            await this.invoke(
                "risk",
                "assessMemberRisk",
                {
                    memberId:
                        identifier,

                    userId:
                        identifier,

                    includeSignals:
                        normalizeBoolean(
                            input.includeSignals,
                            true
                        ),

                    includeHistory:
                        normalizeBoolean(
                            input.includeHistory,
                            true
                        )
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        if (
            canonical
        ) {
            const normalized =
                normalizeRiskAssessment(
                    canonical,
                    RISK_TYPE.MEMBER
                );

            this.incrementMetric(
                "titech_admin_risk_member_assessment_total",
                1,
                {
                    riskLevel:
                        normalized.riskLevel
                }
            );

            return normalized;
        }

        /*
         * Fallback aggregation from canonical domain services.
         */
        const [
            member,
            compliance,
            fraud
        ] =
            await Promise.all([
                this.invoke(
                    "user",
                    "getUser",
                    {
                        userId:
                            identifier,

                        id:
                            identifier
                    },
                    normalizedContext
                ),

                this.invoke(
                    "compliance",
                    "getComplianceRisk",
                    {
                        memberId:
                            identifier,

                        userId:
                            identifier
                    },
                    normalizedContext
                ),

                this.invoke(
                    "fraud",
                    "assessFraudRisk",
                    {
                        memberId:
                            identifier,

                        userId:
                            identifier
                    },
                    normalizedContext
                )
            ]);

        if (
            !member
        ) {
            const error =
                new Error(
                    "The requested member could not be found."
                );

            error.code =
                ERROR_CODES.MEMBER_NOT_FOUND;

            throw error;
        }

        const signals =
            extractRiskSignals(
                {
                    member,
                    compliance,
                    fraud
                }
            );

        const score =
            calculateRiskScore(
                signals
            );

        const assessment = {
            entityType:
                RISK_TYPE.MEMBER,

            entityId:
                identifier,

            riskScore:
                score,

            riskLevel:
                classifyRiskScore(
                    score
                ),

            status:
                score >= 75
                    ? RISK_STATUS.REVIEW
                    : RISK_STATUS.MONITORING,

            signals,

            assessedAt:
                this.clock.now()
                    .toISOString(),

            source:
                "titech-admin-risk-fallback"
        };

        this.incrementMetric(
            "titech_admin_risk_member_assessment_total",
            1,
            {
                riskLevel:
                    assessment.riskLevel
            }
        );

        this.log(
            "info",
            "Member risk assessment completed.",
            {
                tenantId:
                    normalizedContext.tenantId,

                memberId:
                    identifier,

                riskLevel:
                    assessment.riskLevel,

                durationMs:
                    this.clock.now()
                        .getTime() -
                    startedAt.getTime()
            }
        );

        return assessment;
    }

    /* =========================================================================
     * TRANSACTION RISK
     * =========================================================================
     */

    async assessTransactionRisk(
        transactionId,
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRiskViewAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                transactionId
            );

        const canonical =
            await this.invoke(
                "risk",
                "assessTransactionRisk",
                {
                    transactionId:
                        identifier,

                    id:
                        identifier,

                    includeSignals:
                        normalizeBoolean(
                            input.includeSignals,
                            true
                        )
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        if (
            canonical
        ) {
            return normalizeRiskAssessment(
                canonical,
                RISK_TYPE.TRANSACTION
            );
        }

        const transaction =
            await this.invoke(
                "transaction",
                "getTransaction",
                {
                    transactionId:
                        identifier,

                    id:
                        identifier
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        if (
            !transaction
        ) {
            const error =
                new Error(
                    "The requested transaction could not be found."
                );

            error.code =
                ERROR_CODES.TRANSACTION_NOT_FOUND;

            throw error;
        }

        const signals =
            extractTransactionRiskSignals(
                transaction
            );

        const score =
            calculateRiskScore(
                signals
            );

        return {
            entityType:
                RISK_TYPE.TRANSACTION,

            entityId:
                identifier,

            riskScore:
                score,

            riskLevel:
                classifyRiskScore(
                    score
                ),

            status:
                score >= 75
                    ? RISK_STATUS.REVIEW
                    : RISK_STATUS.MONITORING,

            signals,

            assessedAt:
                this.clock.now()
                    .toISOString(),

            source:
                "titech-admin-risk-fallback"
        };
    }

    /* =========================================================================
     * LOAN RISK
     * =========================================================================
     */

    async assessLoanRisk(
        loanId,
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRiskViewAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                loanId
            );

        const canonical =
            await this.invoke(
                "risk",
                "assessLoanRisk",
                {
                    loanId:
                        identifier,

                    id:
                        identifier,

                    includeSignals:
                        normalizeBoolean(
                            input.includeSignals,
                            true
                        )
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        if (
            canonical
        ) {
            return normalizeRiskAssessment(
                canonical,
                RISK_TYPE.LOAN
            );
        }

        const loan =
            await this.invoke(
                "loan",
                "getLoan",
                {
                    loanId:
                        identifier,

                    id:
                        identifier
                },
                normalizedContext,
                {
                    required:
                        false
                }
            );

        if (
            !loan
        ) {
            const error =
                new Error(
                    "The requested loan could not be found."
                );

            error.code =
                ERROR_CODES.LOAN_NOT_FOUND;

            throw error;
        }

        const signals =
            extractLoanRiskSignals(
                loan
            );

        const score =
            calculateRiskScore(
                signals
            );

        return {
            entityType:
                RISK_TYPE.LOAN,

            entityId:
                identifier,

            riskScore:
                score,

            riskLevel:
                classifyRiskScore(
                    score
                ),

            status:
                score >= 75
                    ? RISK_STATUS.REVIEW
                    : RISK_STATUS.MONITORING,

            signals,

            assessedAt:
                this.clock.now()
                    .toISOString(),

            source:
                "titech-admin-risk-fallback"
        };
    }

    /* =========================================================================
     * ALERTS
     * =========================================================================
     */

    async listAlerts(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRiskViewAccess(
            normalizedContext
        );

        const options =
            normalizeListOptions(
                input
            );

        const result =
            await this.invoke(
                "alert",
                "listAlerts",
                options,
                normalizedContext,
                {
                    required:
                        false
                }
            );

        if (
            !result
        ) {
            return emptyPaginatedResult(
                options
            );
        }

        return normalizePaginatedResult(
            result,
            options
        );
    }

    async getAlert(
        alertId,
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRiskViewAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                alertId
            );

        const result =
            await this.invoke(
                "alert",
                "getAlert",
                {
                    alertId:
                        identifier,

                    id:
                        identifier
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        if (
            !result
        ) {
            const error =
                new Error(
                    "The requested risk alert could not be found."
                );

            error.code =
                ERROR_CODES.ALERT_NOT_FOUND;

            throw error;
        }

        return normalizeRiskAlert(
            result
        );
    }

    async acknowledgeAlert(
        alertId,
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRiskManageAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                alertId
            );

        const result =
            await this.invoke(
                "alert",
                "acknowledgeAlert",
                {
                    alertId:
                        identifier,

                    id:
                        identifier,

                    reason:
                        normalizeString(
                            input.reason
                        )
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        await this.audit(
            OPERATIONS.ACKNOWLEDGE_ALERT,
            normalizedContext,
            {
                alertId:
                    identifier,

                reason:
                    normalizeString(
                        input.reason
                    )
            }
        );

        return normalizeRiskAlert(
            result
        );
    }

    async dismissAlert(
        alertId,
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRiskManageAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                alertId
            );

        const result =
            await this.invoke(
                "alert",
                "dismissAlert",
                {
                    alertId:
                        identifier,

                    id:
                        identifier,

                    reason:
                        normalizeString(
                            input.reason
                        )
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        await this.audit(
            OPERATIONS.DISMISS_ALERT,
            normalizedContext,
            {
                alertId:
                    identifier,

                reason:
                    normalizeString(
                        input.reason
                    )
            }
        );

        return normalizeRiskAlert(
            result
        );
    }

    /* =========================================================================
     * CASES
     * =========================================================================
     */

    async listCases(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRiskViewAccess(
            normalizedContext
        );

        const options =
            normalizeListOptions(
                input
            );

        const result =
            await this.invoke(
                "case",
                "listCases",
                options,
                normalizedContext,
                {
                    required:
                        false
                }
            );

        if (
            !result
        ) {
            return emptyPaginatedResult(
                options
            );
        }

        return normalizePaginatedResult(
            result,
            options
        );
    }

    async getCase(
        caseId,
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRiskViewAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                caseId
            );

        const result =
            await this.invoke(
                "case",
                "getCase",
                {
                    caseId:
                        identifier,

                    id:
                        identifier
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        if (
            !result
        ) {
            const error =
                new Error(
                    "The requested risk case could not be found."
                );

            error.code =
                ERROR_CODES.CASE_NOT_FOUND;

            throw error;
        }

        return normalizeRiskCase(
            result
        );
    }

    async createCase(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertCaseManageAccess(
            normalizedContext
        );

        const payload =
            normalizeCasePayload(
                input
            );

        const result =
            await this.invoke(
                "case",
                "createCase",
                payload,
                normalizedContext,
                {
                    required:
                        true
                }
            );

        await this.audit(
            OPERATIONS.CREATE_CASE,
            normalizedContext,
            {
                caseId:
                    extractCaseId(
                        result
                    ),

                riskType:
                    payload.riskType,

                riskLevel:
                    payload.riskLevel,

                entityId:
                    payload.entityId
            }
        );

        this.incrementMetric(
            "titech_admin_risk_cases_created_total"
        );

        return normalizeRiskCase(
            result
        );
    }

    async updateCase(
        caseId,
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertCaseManageAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                caseId
            );

        const payload =
            normalizeCaseUpdatePayload(
                input
            );

        const result =
            await this.invoke(
                "case",
                "updateCase",
                {
                    caseId:
                        identifier,

                    id:
                        identifier,

                    ...payload
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        await this.audit(
            OPERATIONS.UPDATE_CASE,
            normalizedContext,
            {
                caseId:
                    identifier,

                fields:
                    Object.keys(
                        payload
                    )
            }
        );

        return normalizeRiskCase(
            result
        );
    }

    async assignCase(
        caseId,
        assigneeId,
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertCaseManageAccess(
            normalizedContext
        );

        const caseIdentifier =
            normalizeIdentifier(
                caseId
            );

        const assigneeIdentifier =
            normalizeIdentifier(
                assigneeId
            );

        const result =
            await this.invoke(
                "case",
                "assignCase",
                {
                    caseId:
                        caseIdentifier,

                    id:
                        caseIdentifier,

                    assigneeId:
                        assigneeIdentifier
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        await this.audit(
            OPERATIONS.ASSIGN_CASE,
            normalizedContext,
            {
                caseId:
                    caseIdentifier,

                assigneeId:
                    assigneeIdentifier
            }
        );

        return normalizeRiskCase(
            result
        );
    }

    async escalateCase(
        caseId,
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertEscalationAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                caseId
            );

        const result =
            await this.invoke(
                "case",
                "escalateCase",
                {
                    caseId:
                        identifier,

                    id:
                        identifier,

                    reason:
                        normalizeString(
                            input.reason
                        ),

                    priority:
                        normalizeString(
                            input.priority,
                            "high"
                        )
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        await this.audit(
            OPERATIONS.ESCALATE_CASE,
            normalizedContext,
            {
                caseId:
                    identifier,

                reason:
                    normalizeString(
                        input.reason
                    ),

                priority:
                    normalizeString(
                        input.priority,
                        "high"
                    )
            }
        );

        this.incrementMetric(
            "titech_admin_risk_cases_escalated_total"
        );

        return normalizeRiskCase(
            result
        );
    }

    async resolveCase(
        caseId,
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertCaseManageAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                caseId
            );

        const resolution =
            normalizeString(
                input.resolution ??
                input.reason
            );

        if (
            !resolution
        ) {
            const error =
                new Error(
                    "A case resolution reason is required."
                );

            error.code =
                ERROR_CODES.INVALID_PARAMETER;

            throw error;
        }

        const result =
            await this.invoke(
                "case",
                "resolveCase",
                {
                    caseId:
                        identifier,

                    id:
                        identifier,

                    resolution
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        await this.audit(
            OPERATIONS.RESOLVE_CASE,
            normalizedContext,
            {
                caseId:
                    identifier,

                resolution
            }
        );

        this.incrementMetric(
            "titech_admin_risk_cases_resolved_total"
        );

        return normalizeRiskCase(
            result
        );
    }

    async closeCase(
        caseId,
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertCaseManageAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                caseId
            );

        const result =
            await this.invoke(
                "case",
                "closeCase",
                {
                    caseId:
                        identifier,

                    id:
                        identifier,

                    reason:
                        normalizeString(
                            input.reason
                        )
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        await this.audit(
            OPERATIONS.CLOSE_CASE,
            normalizedContext,
            {
                caseId:
                    identifier,

                reason:
                    normalizeString(
                        input.reason
                    )
            }
        );

        return normalizeRiskCase(
            result
        );
    }

    async dismissCase(
        caseId,
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertCaseManageAccess(
            normalizedContext
        );

        const identifier =
            normalizeIdentifier(
                caseId
            );

        const reason =
            normalizeString(
                input.reason
            );

        if (
            !reason
        ) {
            const error =
                new Error(
                    "A dismissal reason is required."
                );

            error.code =
                ERROR_CODES.INVALID_PARAMETER;

            throw error;
        }

        const result =
            await this.invoke(
                "case",
                "dismissCase",
                {
                    caseId:
                        identifier,

                    id:
                        identifier,

                    reason
                },
                normalizedContext,
                {
                    required:
                        true
                }
            );

        await this.audit(
            OPERATIONS.DISMISS_CASE,
            normalizedContext,
            {
                caseId:
                    identifier,

                reason
            }
        );

        return normalizeRiskCase(
            result
        );
    }

    /* =========================================================================
     * RISK EVENT
     * =========================================================================
     */

    async recordRiskEvent(
        input = {},
        context = {}
    ) {
        const normalizedContext =
            normalizeContext(
                context
            );

        this.assertRiskManageAccess(
            normalizedContext
        );

        const payload =
            normalizeRiskEventPayload(
                input
            );

        const result =
            await this.invoke(
                "risk",
                "recordRiskEvent",
                payload,
                normalizedContext,
                {
                    required:
                        true
                }
            );

        await this.audit(
            OPERATIONS.RECORD_EVENT,
            normalizedContext,
            {
                eventType:
                    payload.eventType,

                riskType:
                    payload.riskType,

                entityId:
                    payload.entityId
            }
        );

        return result;
    }

    /* =========================================================================
     * SERVICE METADATA
     * =========================================================================
     */

    getServiceMetadata() {
        return Object.freeze({
            name:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            domain:
                DOMAIN,

            multiTenant:
                true,

            auditAware:
                true,

            financialMutation:
                false,

            directLedgerMutation:
                false,

            directWalletMutation:
                false,

            directHTTPAccess:
                false,

            riskScoring:
                true,

            caseManagement:
                true,

            supportedRiskLevels:
                Object.values(
                    RISK_LEVEL
                ),

            supportedRiskTypes:
                Object.values(
                    RISK_TYPE
                ),

            supportedCaseStatuses:
                Object.values(
                    CASE_STATUS
                ),

            supportedOperations:
                Object.values(
                    OPERATIONS
                )
        });
    }
}

/* =============================================================================
 * NORMALIZATION HELPERS
 * =============================================================================
 */

function normalizeListOptions(
    input = {}
) {
    return {
        page:
            normalizePage(
                input.page
            ),

        limit:
            normalizeLimit(
                input.limit ??
                input.pageSize
            ),

        search:
            normalizeSearch(
                input.search ??
                input.q ??
                input.query
            ),

        status:
            normalizeString(
                input.status
            ),

        riskLevel:
            normalizeString(
                input.riskLevel ??
                input.level
            ),

        riskType:
            normalizeString(
                input.riskType ??
                input.type
            ),

        assigneeId:
            normalizeString(
                input.assigneeId
            ),

        entityId:
            normalizeString(
                input.entityId
            ),

        sort:
            normalizeString(
                input.sort ??
                input.sortBy,
                "createdAt"
            ),

        order:
            String(
                input.order ??
                input.sortOrder ??
                "desc"
            )
                .trim()
                .toLowerCase() ===
                "asc"
                ? "asc"
                : "desc"
    };
}

function normalizePeriod(
    value
) {
    const period =
        normalizeString(
            value,
            "30d"
        );

    if (
        [
            "24h",
            "7d",
            "30d",
            "90d",
            "1y",
            "all"
        ].includes(
            period
        )
    ) {
        return period;
    }

    return "30d";
}

function normalizeDate(
    value
) {
    if (
        !value
    ) {
        return null;
    }

    const date =
        new Date(
            value
        );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        const error =
            new Error(
                `Invalid date value "${value}".`
            );

        error.code =
            ERROR_CODES.INVALID_PARAMETER;

        throw error;
    }

    return date.toISOString();
}

function normalizePaginatedResult(
    result,
    options
) {
    const source =
        result ??
        {};

    const data =
        Array.isArray(
            source
        )
            ? source
            : Array.isArray(
                source.data
            )
                ? source.data
                : Array.isArray(
                    source.items
                )
                    ? source.items
                    : Array.isArray(
                        source.results
                    )
                        ? source.results
                        : [];

    const total =
        Number.isFinite(
            Number(
                source.total
            )
        )
            ? Number(
                source.total
            )
            : data.length;

    const page =
        Number.isFinite(
            Number(
                source.page
            )
        )
            ? Number(
                source.page
            )
            : options.page;

    const limit =
        Number.isFinite(
            Number(
                source.limit ??
                source.pageSize
            )
        )
            ? Number(
                source.limit ??
                source.pageSize
            )
            : options.limit;

    const totalPages =
        total > 0
            ? Math.ceil(
                total /
                limit
            )
            : 0;

    return {
        data,

        pagination: {
            page,

            limit,

            total,

            totalPages,

            hasNextPage:
                page <
                totalPages,

            hasPreviousPage:
                page >
                1
        }
    };
}

function emptyPaginatedResult(
    options
) {
    return {
        data: [],

        pagination: {
            page:
                options.page,

            limit:
                options.limit,

            total:
                0,

            totalPages:
                0,

            hasNextPage:
                false,

            hasPreviousPage:
                options.page >
                1
        }
    };
}

/* =============================================================================
 * RISK NORMALIZERS
 * =============================================================================
 */

function normalizeRiskAssessment(
    result,
    defaultType
) {
    const score =
        clampRiskScore(
            result.riskScore ??
            result.score ??
            result.risk?.score ??
            0
        );

    return {
        ...result,

        entityType:
            normalizeRiskType(
                result.entityType ??
                result.riskType ??
                defaultType
            ),

        entityId:
            result.entityId ??
            result.memberId ??
            result.userId ??
            result.transactionId ??
            result.loanId ??
            null,

        riskScore:
            score,

        riskLevel:
            normalizeRiskLevel(
                result.riskLevel ??
                result.level ??
                classifyRiskScore(
                    score
                )
            ),

        assessedAt:
            result.assessedAt ??
            new Date().toISOString()
    };
}

function normalizeRiskDashboard(
    result
) {
    return {
        ...result,

        generatedAt:
            result.generatedAt ??
            new Date().toISOString(),

        summary:
            normalizeRiskSummary(
                result.summary ??
                {}
            ),

        alerts:
            normalizePaginatedOrArray(
                result.alerts
            ),

        cases:
            normalizePaginatedOrArray(
                result.cases
            )
    };
}

function normalizeRiskSummary(
    result
) {
    return {
        totalRiskEvents:
            Number(
                result.totalRiskEvents
            ) || 0,

        totalAlerts:
            Number(
                result.totalAlerts
            ) || 0,

        openAlerts:
            Number(
                result.openAlerts
            ) || 0,

        criticalAlerts:
            Number(
                result.criticalAlerts
            ) || 0,

        highRiskMembers:
            Number(
                result.highRiskMembers
            ) || 0,

        criticalRiskMembers:
            Number(
                result.criticalRiskMembers
            ) || 0,

        openCases:
            Number(
                result.openCases
            ) || 0,

        escalatedCases:
            Number(
                result.escalatedCases
            ) || 0,

        resolvedCases:
            Number(
                result.resolvedCases
            ) || 0,

        ...result
    };
}

function normalizeRiskAlert(
    result
) {
    if (
        !result
    ) {
        return null;
    }

    return {
        ...result,

        riskLevel:
            result.riskLevel
                ? normalizeRiskLevel(
                    result.riskLevel
                )
                : undefined
    };
}

function normalizeRiskCase(
    result
) {
    if (
        !result
    ) {
        return null;
    }

    return {
        ...result,

        status:
            result.status
                ? normalizeCaseStatus(
                    result.status
                )
                : CASE_STATUS.OPEN,

        riskLevel:
            result.riskLevel
                ? normalizeRiskLevel(
                    result.riskLevel
                )
                : undefined
    };
}

function normalizePaginatedOrArray(
    value
) {
    if (
        !value
    ) {
        return [];
    }

    if (
        Array.isArray(
            value
        )
    ) {
        return value;
    }

    if (
        Array.isArray(
            value.data
        )
    ) {
        return value.data;
    }

    if (
        Array.isArray(
            value.items
        )
    ) {
        return value.items;
    }

    return [];
}

/* =============================================================================
 * CASE PAYLOADS
 * =============================================================================
 */

function normalizeCasePayload(
    input = {}
) {
    const entityId =
        normalizeIdentifier(
            input.entityId ??
            input.memberId ??
            input.userId ??
            input.transactionId ??
            input.loanId
        );

    const riskType =
        normalizeRiskType(
            input.riskType ??
            input.type ??
            RISK_TYPE.MEMBER
        );

    const score =
        clampRiskScore(
            input.riskScore ??
            input.score ??
            0
        );

    return {
        entityId,

        riskType,

        riskScore:
            score,

        riskLevel:
            normalizeRiskLevel(
                input.riskLevel ??
                classifyRiskScore(
                    score
                )
            ),

        title:
            normalizeString(
                input.title,
                "TITech Risk Review"
            ),

        description:
            normalizeString(
                input.description
            ),

        reason:
            normalizeString(
                input.reason
            ),

        priority:
            normalizeString(
                input.priority,
                "normal"
            ),

        status:
            normalizeCaseStatus(
                input.status ??
                CASE_STATUS.OPEN
            ),

        assignedTo:
            normalizeString(
                input.assignedTo ??
                input.assigneeId
            ),

        metadata:
            sanitizeMetadata(
                input.metadata ??
                {}
            )
    };
}

function normalizeCaseUpdatePayload(
    input = {}
) {
    const payload = {};

    if (
        input.title !==
        undefined
    ) {
        payload.title =
            normalizeString(
                input.title
            );
    }

    if (
        input.description !==
        undefined
    ) {
        payload.description =
            normalizeString(
                input.description
            );
    }

    if (
        input.reason !==
        undefined
    ) {
        payload.reason =
            normalizeString(
                input.reason
            );
    }

    if (
        input.status !==
        undefined
    ) {
        payload.status =
            normalizeCaseStatus(
                input.status
            );
    }

    if (
        input.riskLevel !==
        undefined
    ) {
        payload.riskLevel =
            normalizeRiskLevel(
                input.riskLevel
            );
    }

    if (
        input.priority !==
        undefined
    ) {
        payload.priority =
            normalizeString(
                input.priority
            );
    }

    if (
        input.assigneeId !==
        undefined ||
        input.assignedTo !==
        undefined
    ) {
        payload.assigneeId =
            normalizeIdentifier(
                input.assigneeId ??
                input.assignedTo
            );
    }

    if (
        input.metadata !==
        undefined
    ) {
        payload.metadata =
            sanitizeMetadata(
                input.metadata
            );
    }

    return payload;
}

/* =============================================================================
 * RISK EVENT
 * =============================================================================
 */

function normalizeRiskEventPayload(
    input = {}
) {
    const riskType =
        normalizeRiskType(
            input.riskType ??
            input.type ??
            RISK_TYPE.OPERATIONAL
        );

    const entityId =
        input.entityId ??
        input.memberId ??
        input.userId ??
        input.transactionId ??
        input.loanId ??
        null;

    return {
        eventType:
            normalizeString(
                input.eventType ??
                input.type ??
                "risk.signal"
            ),

        riskType,

        entityId:
            entityId
                ? normalizeIdentifier(
                    entityId
                )
                : null,

        riskScore:
            clampRiskScore(
                input.riskScore ??
                input.score ??
                0
            ),

        riskLevel:
            normalizeRiskLevel(
                input.riskLevel ??
                classifyRiskScore(
                    input.riskScore ??
                    input.score ??
                    0
                )
            ),

        source:
            normalizeString(
                input.source,
                "titech-admin"
            ),

        description:
            normalizeString(
                input.description
            ),

        metadata:
            sanitizeMetadata(
                input.metadata ??
                {}
            )
    };
}

/* =============================================================================
 * SIGNAL EXTRACTION
 * =============================================================================
 */

function extractRiskSignals(
    input = {}
) {
    const member =
        input.member ??
        {};

    const compliance =
        input.compliance ??
        {};

    const fraud =
        input.fraud ??
        {};

    return {
        fraud:
            normalizeSignal(
                fraud.score ??
                fraud.riskScore ??
                fraud.fraudRisk
            ),

        aml:
            normalizeSignal(
                compliance.amlScore ??
                compliance.amlRisk ??
                compliance.aml
            ),

        kyc:
            normalizeSignal(
                compliance.kycScore ??
                compliance.kycRisk ??
                compliance.kyc
            ),

        transaction:
            normalizeSignal(
                member.transactionRisk ??
                member.transactionRiskScore
            ),

        loan:
            normalizeSignal(
                member.loanRisk ??
                member.loanRiskScore
            ),

        account:
            normalizeSignal(
                member.accountRisk ??
                member.accountRiskScore
            ),

        velocity:
            normalizeSignal(
                fraud.velocityRisk ??
                fraud.velocityScore
            ),

        operational:
            normalizeSignal(
                member.operationalRisk ??
                member.operationalRiskScore
            )
    };
}

function extractTransactionRiskSignals(
    transaction = {}
) {
    return {
        fraud:
            normalizeSignal(
                transaction.fraudRisk ??
                transaction.fraudScore
            ),

        aml:
            normalizeSignal(
                transaction.amlRisk ??
                transaction.amlScore
            ),

        kyc:
            normalizeSignal(
                transaction.kycRisk ??
                transaction.kycScore
            ),

        transaction:
            normalizeSignal(
                transaction.riskScore ??
                transaction.transactionRisk
            ),

        velocity:
            normalizeSignal(
                transaction.velocityRisk ??
                transaction.velocityScore
            )
    };
}

function extractLoanRiskSignals(
    loan = {}
) {
    return {
        loan:
            normalizeSignal(
                loan.riskScore ??
                loan.risk
            ),

        fraud:
            normalizeSignal(
                loan.fraudRisk
            ),

        aml:
            normalizeSignal(
                loan.amlRisk
            ),

        kyc:
            normalizeSignal(
                loan.kycRisk
            ),

        account:
            normalizeSignal(
                loan.accountRisk
            ),

        operational:
            normalizeSignal(
                loan.operationalRisk
            )
    };
}

function normalizeSignal(
    value
) {
    const numeric =
        Number(
            value
        );

    if (
        !Number.isFinite(
            numeric
        )
    ) {
        return 0;
    }

    /*
     * Accept both:
     *
     *   0 - 1 normalized values
     *   0 - 100 score values
     */
    if (
        numeric > 1
    ) {
        return Math.max(
            0,
            Math.min(
                1,
                numeric /
                100
            )
        );
    }

    return Math.max(
        0,
        Math.min(
            1,
            numeric
        )
    );
}

/* =============================================================================
 * SUMMARY
 * =============================================================================
 */

function buildRiskSummary(
    alerts,
    cases
) {
    const alertItems =
        Array.isArray(
            alerts
        )
            ? alerts
            : [];

    const caseItems =
        Array.isArray(
            cases
        )
            ? cases
            : [];

    return {
        totalRiskEvents:
            alertItems.length +
            caseItems.length,

        totalAlerts:
            alertItems.length,

        openAlerts:
            alertItems.filter(
                item =>
                    [
                        "open",
                        "new",
                        "active"
                    ].includes(
                        String(
                            item.status ??
                            ""
                        ).toLowerCase()
                    )
            ).length,

        criticalAlerts:
            alertItems.filter(
                item =>
                    String(
                        item.riskLevel ??
                        ""
                    ).toLowerCase() ===
                    RISK_LEVEL.CRITICAL
            ).length,

        highRiskMembers:
            alertItems.filter(
                item =>
                    [
                        RISK_LEVEL.HIGH,
                        RISK_LEVEL.CRITICAL
                    ].includes(
                        String(
                            item.riskLevel ??
                            ""
                        ).toLowerCase()
                    ) &&
                    [
                        RISK_TYPE.MEMBER,
                        RISK_TYPE.ACCOUNT
                    ].includes(
                        String(
                            item.riskType ??
                            ""
                        ).toLowerCase()
                    )
            ).length,

        criticalRiskMembers:
            alertItems.filter(
                item =>
                    String(
                        item.riskLevel ??
                        ""
                    ).toLowerCase() ===
                    RISK_LEVEL.CRITICAL &&
                    [
                        RISK_TYPE.MEMBER,
                        RISK_TYPE.ACCOUNT
                    ].includes(
                        String(
                            item.riskType ??
                            ""
                        ).toLowerCase()
                    )
            ).length,

        openCases:
            caseItems.filter(
                item =>
                    [
                        CASE_STATUS.OPEN,
                        CASE_STATUS.ASSIGNED,
                        CASE_STATUS.INVESTIGATING
                    ].includes(
                        String(
                            item.status ??
                            ""
                        ).toLowerCase()
                    )
            ).length,

        escalatedCases:
            caseItems.filter(
                item =>
                    String(
                        item.status ??
                        ""
                    ).toLowerCase() ===
                    CASE_STATUS.ESCALATED
            ).length,

        resolvedCases:
            caseItems.filter(
                item =>
                    [
                        CASE_STATUS.RESOLVED,
                        CASE_STATUS.CLOSED
                    ].includes(
                        String(
                            item.status ??
                            ""
                        ).toLowerCase()
                    )
            ).length
    };
}

/* =============================================================================
 * METADATA SANITIZATION
 * =============================================================================
 */

const SENSITIVE_KEYS =
    Object.freeze([
        "password",
        "passwordHash",
        "token",
        "accessToken",
        "refreshToken",
        "secret",
        "otp",
        "otpCode",
        "pin",
        "pinCode",
        "mfaSecret",
        "securityAnswer"
    ]);

function sanitizeMetadata(
    metadata
) {
    if (
        !metadata ||
        typeof metadata !==
            "object"
    ) {
        return {};
    }

    try {
        return JSON.parse(
            JSON.stringify(
                metadata,
                (
                    key,
                    value
                ) => {
                    if (
                        SENSITIVE_KEYS.includes(
                            String(
                                key
                            ).toLowerCase()
                        )
                    ) {
                        return "[REDACTED]";
                    }

                    return value;
                }
            )
        );
    } catch {
        return {};
    }
}

/* =============================================================================
 * ID HELPERS
 * =============================================================================
 */

function extractCaseId(
    value
) {
    if (
        !value
    ) {
        return null;
    }

    return (
        value.id ??
        value._id ??
        value.caseId ??
        null
    );
}

function normalizeError(
    error
) {
    return {
        code:
            error?.code ??
            ERROR_CODES.INTERNAL_ERROR,

        message:
            error?.message ??
            "Risk operation failed."
    };
}

/* =============================================================================
 * FACTORY
 * =============================================================================
 */

function createAdminRiskService(
    dependencies = {}
) {
    return new AdminRiskService(
        dependencies
    );
}

/* =============================================================================
 * DEFAULT INSTANCE
 * =============================================================================
 */

const defaultService =
    createAdminRiskService();

/* =============================================================================
 * EXPORTS
 * =============================================================================
 */

module.exports =
    Object.assign(
        defaultService,
        {
            AdminRiskService,

            createAdminRiskService,

            SERVICE_NAME,

            APPLICATION_NAME,

            DOMAIN,

            RISK_LEVEL,

            RISK_STATUS,

            CASE_STATUS,

            RISK_TYPE,

            OPERATIONS,

            ERROR_CODES,

            RISK_SCORE_THRESHOLDS,

            getServiceMetadata:
                defaultService
                    .getServiceMetadata
                    .bind(
                        defaultService
                    ),

            getRiskDashboard:
                defaultService
                    .getRiskDashboard
                    .bind(
                        defaultService
                    ),

            getRiskSummary:
                defaultService
                    .getRiskSummary
                    .bind(
                        defaultService
                    ),

            assessMemberRisk:
                defaultService
                    .assessMemberRisk
                    .bind(
                        defaultService
                    ),

            assessTransactionRisk:
                defaultService
                    .assessTransactionRisk
                    .bind(
                        defaultService
                    ),

            assessLoanRisk:
                defaultService
                    .assessLoanRisk
                    .bind(
                        defaultService
                    ),

            listAlerts:
                defaultService
                    .listAlerts
                    .bind(
                        defaultService
                    ),

            getAlert:
                defaultService
                    .getAlert
                    .bind(
                        defaultService
                    ),

            acknowledgeAlert:
                defaultService
                    .acknowledgeAlert
                    .bind(
                        defaultService
                    ),

            dismissAlert:
                defaultService
                    .dismissAlert
                    .bind(
                        defaultService
                    ),

            listCases:
                defaultService
                    .listCases
                    .bind(
                        defaultService
                    ),

            getCase:
                defaultService
                    .getCase
                    .bind(
                        defaultService
                    ),

            createCase:
                defaultService
                    .createCase
                    .bind(
                        defaultService
                    ),

            updateCase:
                defaultService
                    .updateCase
                    .bind(
                        defaultService
                    ),

            assignCase:
                defaultService
                    .assignCase
                    .bind(
                        defaultService
                    ),

            escalateCase:
                defaultService
                    .escalateCase
                    .bind(
                        defaultService
                    ),

            resolveCase:
                defaultService
                    .resolveCase
                    .bind(
                        defaultService
                    ),

            closeCase:
                defaultService
                    .closeCase
                    .bind(
                        defaultService
                    ),

            dismissCase:
                defaultService
                    .dismissCase
                    .bind(
                        defaultService
                    ),

            recordRiskEvent:
                defaultService
                    .recordRiskEvent
                    .bind(
                        defaultService
                    )
        }
    );