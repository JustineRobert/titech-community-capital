'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise SACCO Onboarding Constants
 * ============================================================================
 *
 * Purpose:
 * Centralized, immutable constants for the SACCO onboarding lifecycle.
 *
 * Design Principles:
 * - No magic strings across onboarding services.
 * - Backward-compatible exports.
 * - Multi-tenant SaaS ready.
 * - Safe for production use.
 * - Constants are immutable.
 * - Suitable for validation, workflow engines, RBAC, audit logging,
 *   reporting, API validation, and onboarding state machines.
 * ============================================================================
 */

/**
 * ============================================================================
 * ONBOARDING STATUS
 * ============================================================================
 */
const STATUS = Object.freeze({
    DRAFT: 'DRAFT',

    VERIFICATION: 'VERIFICATION',

    KYC_PENDING: 'KYC_PENDING',

    KYC_APPROVED: 'KYC_APPROVED',

    SUBSCRIPTION: 'SUBSCRIPTION',

    GO_LIVE_REVIEW: 'GO_LIVE_REVIEW',

    LIVE: 'LIVE',

    SUSPENDED: 'SUSPENDED',

    REJECTED: 'REJECTED'
});

/**
 * ============================================================================
 * SUBSCRIPTION PLANS
 * ============================================================================
 */
const SUBSCRIPTION_PLANS = Object.freeze({
    STARTER: 'STARTER',

    GROWTH: 'GROWTH',

    ENTERPRISE: 'ENTERPRISE',

    CUSTOM: 'CUSTOM'
});

/**
 * ============================================================================
 * BILLING CYCLES
 * ============================================================================
 */
const BILLING_CYCLES = Object.freeze({
    MONTHLY: 'MONTHLY',

    QUARTERLY: 'QUARTERLY',

    ANNUAL: 'ANNUAL'
});

/**
 * ============================================================================
 * SUPPORTED CURRENCIES
 * ============================================================================
 */
const CURRENCIES = Object.freeze({
    UGX: 'UGX',

    USD: 'USD',

    KES: 'KES',

    TZS: 'TZS',

    RWF: 'RWF'
});

/**
 * ============================================================================
 * COMPLIANCE STATUS
 * ============================================================================
 */
const COMPLIANCE_STATUS = Object.freeze({
    PENDING: 'PENDING',

    UNDER_REVIEW: 'UNDER_REVIEW',

    COMPLIANT: 'COMPLIANT',

    NON_COMPLIANT: 'NON_COMPLIANT'
});

/**
 * ============================================================================
 * MOBILE MONEY PROVIDERS
 * ============================================================================
 */
const MOBILE_MONEY_PROVIDERS = Object.freeze({
    MTN: 'MTN',

    AIRTEL: 'AIRTEL'
});

/**
 * ============================================================================
 * DOCUMENT TYPES
 * ============================================================================
 */
const DOCUMENT_TYPES = Object.freeze({
    REGISTRATION_CERTIFICATE: 'REGISTRATION_CERTIFICATE',

    TIN_CERTIFICATE: 'TIN_CERTIFICATE',

    BOARD_RESOLUTION: 'BOARD_RESOLUTION',

    MEMORANDUM: 'MEMORANDUM',

    PROOF_OF_ADDRESS: 'PROOF_OF_ADDRESS',

    KYC_DOCUMENT: 'KYC_DOCUMENT',

    AML_DOCUMENT: 'AML_DOCUMENT',

    OTHER: 'OTHER'
});

/**
 * ============================================================================
 * AUDIT EVENTS
 * ============================================================================
 */
const AUDIT_EVENTS = Object.freeze({
    SACCO_REGISTERED: 'SACCO_REGISTERED',

    SACCO_UPDATED: 'SACCO_UPDATED',

    KYC_SUBMITTED: 'KYC_SUBMITTED',

    KYC_APPROVED: 'KYC_APPROVED',

    SUBSCRIPTION_CREATED: 'SUBSCRIPTION_CREATED',

    SUBSCRIPTION_UPDATED: 'SUBSCRIPTION_UPDATED',

    GO_LIVE_REVIEW_STARTED: 'GO_LIVE_REVIEW_STARTED',

    GO_LIVE_APPROVED: 'GO_LIVE_APPROVED',

    SACCO_LIVE: 'SACCO_LIVE',

    SACCO_SUSPENDED: 'SACCO_SUSPENDED',

    SACCO_REJECTED: 'SACCO_REJECTED',

    DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED'
});

/**
 * ============================================================================
 * RBAC PERMISSIONS
 * ============================================================================
 */
const PERMISSIONS = Object.freeze({
    SACCO_CREATE: 'SACCO_CREATE',

    SACCO_VIEW: 'SACCO_VIEW',

    SACCO_UPDATE: 'SACCO_UPDATE',

    SACCO_DELETE: 'SACCO_DELETE',

    SACCO_KYC_APPROVE: 'SACCO_KYC_APPROVE',

    SACCO_SUBSCRIPTION: 'SACCO_SUBSCRIPTION',

    SACCO_GO_LIVE: 'SACCO_GO_LIVE',

    SACCO_GO_LIVE_REVIEW: 'SACCO_GO_LIVE_REVIEW',

    SACCO_REJECT: 'SACCO_REJECT',

    SACCO_ANALYTICS: 'SACCO_ANALYTICS'
});

/**
 * ============================================================================
 * ONBOARDING CHECKLIST
 * ============================================================================
 */
const CHECKLIST_ITEMS = Object.freeze({
    REGISTRATION_COMPLETED: 'registrationCompleted',

    KYC_COMPLETED: 'kycCompleted',

    SUBSCRIPTION_COMPLETED: 'subscriptionCompleted',

    TENANT_CREATED: 'tenantSetupCompleted',

    ADMIN_CREATED: 'adminCreated',

    MOBILE_MONEY_CONFIGURED: 'mobileMoneyConfigured',

    TRAINING_COMPLETED: 'trainingCompleted',

    GO_LIVE_APPROVED: 'goLiveApproved'
});

/**
 * ============================================================================
 * DASHBOARD COLORS
 * ============================================================================
 *
 * Presentation metadata only.
 * Business logic must never depend on these values.
 * ============================================================================
 */
const STATUS_COLORS = Object.freeze({
    DRAFT: '#6B7280',

    VERIFICATION: '#2563EB',

    KYC_PENDING: '#F59E0B',

    KYC_APPROVED: '#10B981',

    SUBSCRIPTION: '#8B5CF6',

    GO_LIVE_REVIEW: '#06B6D4',

    LIVE: '#22C55E',

    SUSPENDED: '#EF4444',

    REJECTED: '#7F1D1D'
});

/**
 * ============================================================================
 * TENANT DEFAULTS
 * ============================================================================
 */
const TENANT_DEFAULTS = Object.freeze({
    COUNTRY: 'Uganda',

    TIMEZONE: 'Africa/Kampala',

    DEFAULT_CURRENCY: CURRENCIES.UGX
});

/**
 * ============================================================================
 * API LIMITS
 * ============================================================================
 */
const LIMITS = Object.freeze({
    MAX_DOCUMENTS: 20,

    MAX_FILE_SIZE_MB: 25,

    DEFAULT_PAGE_SIZE: 20,

    MAX_PAGE_SIZE: 100
});

/**
 * ============================================================================
 * ONBOARDING STATUS ORDER
 * ============================================================================
 *
 * Used by:
 * - Progress indicators
 * - Workflow engines
 * - Reporting
 * - SLA calculations
 * - Onboarding dashboards
 * ============================================================================
 */
const STATUS_ORDER = Object.freeze([
    STATUS.DRAFT,

    STATUS.VERIFICATION,

    STATUS.KYC_PENDING,

    STATUS.KYC_APPROVED,

    STATUS.SUBSCRIPTION,

    STATUS.GO_LIVE_REVIEW,

    STATUS.LIVE
]);

/**
 * ============================================================================
 * TERMINAL ONBOARDING STATES
 * ============================================================================
 */
const TERMINAL_STATUSES = Object.freeze([
    STATUS.LIVE,

    STATUS.REJECTED
]);

/**
 * ============================================================================
 * NON-OPERATIONAL / BLOCKED STATES
 * ============================================================================
 */
const BLOCKED_STATUSES = Object.freeze([
    STATUS.SUSPENDED,

    STATUS.REJECTED
]);

/**
 * ============================================================================
 * ACTIVE ONBOARDING STATES
 * ============================================================================
 */
const ACTIVE_ONBOARDING_STATUSES = Object.freeze([
    STATUS.DRAFT,

    STATUS.VERIFICATION,

    STATUS.KYC_PENDING,

    STATUS.KYC_APPROVED,

    STATUS.SUBSCRIPTION,

    STATUS.GO_LIVE_REVIEW
]);

/**
 * ============================================================================
 * STATUS TRANSITIONS
 * ============================================================================
 *
 * Defines the allowed onboarding state machine transitions.
 *
 * This should be enforced by the onboarding workflow/service layer.
 * ============================================================================
 */
const STATUS_TRANSITIONS = Object.freeze({
    [STATUS.DRAFT]: Object.freeze([
        STATUS.VERIFICATION,

        STATUS.REJECTED
    ]),

    [STATUS.VERIFICATION]: Object.freeze([
        STATUS.KYC_PENDING,

        STATUS.REJECTED
    ]),

    [STATUS.KYC_PENDING]: Object.freeze([
        STATUS.KYC_APPROVED,

        STATUS.REJECTED
    ]),

    [STATUS.KYC_APPROVED]: Object.freeze([
        STATUS.SUBSCRIPTION,

        STATUS.REJECTED
    ]),

    [STATUS.SUBSCRIPTION]: Object.freeze([
        STATUS.GO_LIVE_REVIEW,

        STATUS.REJECTED
    ]),

    [STATUS.GO_LIVE_REVIEW]: Object.freeze([
        STATUS.LIVE,

        STATUS.REJECTED,

        STATUS.SUSPENDED
    ]),

    [STATUS.LIVE]: Object.freeze([
        STATUS.SUSPENDED
    ]),

    [STATUS.SUSPENDED]: Object.freeze([
        STATUS.LIVE,

        STATUS.REJECTED
    ]),

    [STATUS.REJECTED]: Object.freeze([])
});

/**
 * ============================================================================
 * STATUS HELPERS
 * ============================================================================
 *
 * Lightweight pure helpers keep workflow logic consistent without introducing
 * another dependency.
 * ============================================================================
 */
const STATUS_HELPERS = Object.freeze({

    isValid(status) {
        return Object.values(STATUS).includes(status);
    },

    isTerminal(status) {
        return TERMINAL_STATUSES.includes(status);
    },

    isBlocked(status) {
        return BLOCKED_STATUSES.includes(status);
    },

    isActive(status) {
        return ACTIVE_ONBOARDING_STATUSES.includes(status);
    },

    canTransition(fromStatus, toStatus) {
        if (!this.isValid(fromStatus) || !this.isValid(toStatus)) {
            return false;
        }

        return (
            STATUS_TRANSITIONS[fromStatus] || []
        ).includes(toStatus);
    },

    getNextStatuses(status) {
        if (!this.isValid(status)) {
            return [];
        }

        return [
            ...(STATUS_TRANSITIONS[status] || [])
        ];
    }
});

/**
 * ============================================================================
 * CHECKLIST REQUIRED ITEMS
 * ============================================================================
 *
 * Minimum operational checklist before SACCO go-live.
 * ============================================================================
 */
const REQUIRED_CHECKLIST_ITEMS = Object.freeze([
    CHECKLIST_ITEMS.REGISTRATION_COMPLETED,

    CHECKLIST_ITEMS.KYC_COMPLETED,

    CHECKLIST_ITEMS.SUBSCRIPTION_COMPLETED,

    CHECKLIST_ITEMS.TENANT_CREATED,

    CHECKLIST_ITEMS.ADMIN_CREATED,

    CHECKLIST_ITEMS.MOBILE_MONEY_CONFIGURED,

    CHECKLIST_ITEMS.GO_LIVE_APPROVED
]);

/**
 * ============================================================================
 * DOCUMENT VALIDATION LIMITS
 * ============================================================================
 */
const DOCUMENT_LIMITS = Object.freeze({
    MAX_DOCUMENTS: LIMITS.MAX_DOCUMENTS,

    MAX_FILE_SIZE_MB: LIMITS.MAX_FILE_SIZE_MB,

    ALLOWED_FILE_EXTENSIONS: Object.freeze([
        'pdf',

        'jpg',

        'jpeg',

        'png'
    ]),

    ALLOWED_MIME_TYPES: Object.freeze([
        'application/pdf',

        'image/jpeg',

        'image/png'
    ])
});

/**
 * ============================================================================
 * PAGINATION DEFAULTS
 * ============================================================================
 */
const PAGINATION = Object.freeze({
    DEFAULT_PAGE: 1,

    DEFAULT_PAGE_SIZE: LIMITS.DEFAULT_PAGE_SIZE,

    MAX_PAGE_SIZE: LIMITS.MAX_PAGE_SIZE
});

/**
 * ============================================================================
 * SUPPORTED COUNTRY CONFIGURATION
 * ============================================================================
 *
 * Uganda remains the default operating market while the constants module
 * remains extensible for regional expansion.
 * ============================================================================
 */
const COUNTRY_DEFAULTS = Object.freeze({
    UG: Object.freeze({
        COUNTRY: 'Uganda',

        COUNTRY_CODE: 'UG',

        ISO_CURRENCY: CURRENCIES.UGX,

        TIMEZONE: 'Africa/Kampala'
    }),

    KE: Object.freeze({
        COUNTRY: 'Kenya',

        COUNTRY_CODE: 'KE',

        ISO_CURRENCY: CURRENCIES.KES,

        TIMEZONE: 'Africa/Nairobi'
    }),

    TZ: Object.freeze({
        COUNTRY: 'Tanzania',

        COUNTRY_CODE: 'TZ',

        ISO_CURRENCY: CURRENCIES.TZS,

        TIMEZONE: 'Africa/Dar_es_Salaam'
    }),

    RW: Object.freeze({
        COUNTRY: 'Rwanda',

        COUNTRY_CODE: 'RW',

        ISO_CURRENCY: CURRENCIES.RWF,

        TIMEZONE: 'Africa/Kigali'
    })
});

/**
 * ============================================================================
 * CONSTANT VALIDATION
 * ============================================================================
 *
 * Fails fast during application startup if critical configuration becomes
 * internally inconsistent.
 * ============================================================================
 */
function validateConstants() {
    const statusValues = Object.values(STATUS);

    if (statusValues.length === 0) {
        throw new Error(
            'Onboarding STATUS constants cannot be empty'
        );
    }

    for (const status of statusValues) {
        if (!STATUS_TRANSITIONS[status]) {
            throw new Error(
                `Missing status transition configuration for: ${status}`
            );
        }

        if (!STATUS_COLORS[status]) {
            throw new Error(
                `Missing dashboard color for onboarding status: ${status}`
            );
        }
    }

    const currencyValues =
        Object.values(CURRENCIES);

    if (!currencyValues.includes(
        TENANT_DEFAULTS.DEFAULT_CURRENCY
    )) {
        throw new Error(
            'TENANT_DEFAULTS.DEFAULT_CURRENCY must be a supported currency'
        );
    }

    if (
        LIMITS.DEFAULT_PAGE_SIZE <= 0 ||
        LIMITS.MAX_PAGE_SIZE < LIMITS.DEFAULT_PAGE_SIZE
    ) {
        throw new Error(
            'Invalid pagination limits configuration'
        );
    }

    if (
        LIMITS.MAX_DOCUMENTS <= 0 ||
        LIMITS.MAX_FILE_SIZE_MB <= 0
    ) {
        throw new Error(
            'Invalid document limits configuration'
        );
    }

    return true;
}

/**
 * ============================================================================
 * FREEZE HELPER
 * ============================================================================
 *
 * Kept local to this module so callers receive immutable exported structures.
 * ============================================================================
 */
function freezeExports(exportsObject) {
    return Object.freeze(exportsObject);
}

/**
 * ============================================================================
 * STARTUP VALIDATION
 * ============================================================================
 */
validateConstants();

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 *
 * Existing exports are preserved for backward compatibility.
 * Additional enterprise constants/helpers are additive.
 * ============================================================================
 */
module.exports = freezeExports({

    STATUS,

    SUBSCRIPTION_PLANS,

    BILLING_CYCLES,

    CURRENCIES,

    COMPLIANCE_STATUS,

    MOBILE_MONEY_PROVIDERS,

    DOCUMENT_TYPES,

    AUDIT_EVENTS,

    PERMISSIONS,

    CHECKLIST_ITEMS,

    STATUS_COLORS,

    TENANT_DEFAULTS,

    LIMITS,

    // Enterprise workflow metadata
    STATUS_ORDER,

    TERMINAL_STATUSES,

    BLOCKED_STATUSES,

    ACTIVE_ONBOARDING_STATUSES,

    STATUS_TRANSITIONS,

    STATUS_HELPERS,

    REQUIRED_CHECKLIST_ITEMS,

    DOCUMENT_LIMITS,

    PAGINATION,

    COUNTRY_DEFAULTS,

    // Explicit validation hook for tests/startup diagnostics
    validateConstants
});