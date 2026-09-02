"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Local Storage Test Helper
 * ============================================================================
 *
 * Enterprise Testing Utility
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ localStorage Mock
 * ✅ sessionStorage Mock
 * ✅ Auth Session Helpers
 * ✅ Tenant Helpers
 * ✅ Permission Helpers
 * ✅ Theme Helpers
 * ✅ Loan Draft Helpers
 * ✅ Savings Draft Helpers
 * ✅ Member Draft Helpers
 * ✅ Onboarding Helpers
 * ✅ Reset Utilities
 * ✅ Jest Compatible
 * ✅ Vitest Compatible
 * ✅ Browser Compatible
 * ✅ Frontend Integration Test Ready
 * ============================================================================
 */

const STORAGE_KEYS = Object.freeze({

    ACCESS_TOKEN:
        "accessToken",

    REFRESH_TOKEN:
        "refreshToken",

    USER:
        "user",

    TENANT:
        "tenant",

    PERMISSIONS:
        "permissions",

    THEME:
        "theme",

    AUTH_STATE:
        "authState",

    LOAN_DRAFT:
        "loanDraft",

    MEMBER_DRAFT:
        "memberDraft",

    SAVINGS_DRAFT:
        "savingsDraft",

    ONBOARDING_PROGRESS:
        "onboardingProgress"
});

/* ============================================================================
   STORAGE FACTORY
============================================================================ */

function createStorageMock() {

    let store = {};

    return {

        getItem(key) {

            return Object.prototype
                .hasOwnProperty.call(
                    store,
                    key
                )
                ? store[key]
                : null;
        },

        setItem(
            key,
            value
        ) {

            store[key] =
                String(value);
        },

        removeItem(key) {

            delete store[key];
        },

        clear() {

            store = {};
        },

        key(index) {

            return Object.keys(
                store
            )[index] || null;
        },

        get length() {

            return Object.keys(
                store
            ).length;
        },

        dump() {

            return {
                ...store
            };
        }
    };
}

/* ============================================================================
   MOCK INSTANCES
============================================================================ */

const localStorageMock =
    createStorageMock();

const sessionStorageMock =
    createStorageMock();

/* ============================================================================
   INSTALL HELPERS
============================================================================ */

function installStorageMocks() {

    Object.defineProperty(
        global,
        "localStorage",
        {
            value:
                localStorageMock,
            writable: true
        }
    );

    Object.defineProperty(
        global,
        "sessionStorage",
        {
            value:
                sessionStorageMock,
            writable: true
        }
    );
}

function uninstallStorageMocks() {

    delete global.localStorage;
    delete global.sessionStorage;
}

/* ============================================================================
   RESET HELPERS
============================================================================ */

function resetStorage() {

    localStorageMock.clear();

    sessionStorageMock.clear();
}

//* ============================================================================
   AUTH HELPERS
============================================================================ */

/**
 * Store authenticated user session
 */
function setAuthSession({

    accessToken,

    refreshToken,

    user

}) {

    localStorage.setItem(
        STORAGE_KEYS.ACCESS_TOKEN,
        accessToken
    );

    localStorage.setItem(
        STORAGE_KEYS.REFRESH_TOKEN,
        refreshToken
    );

    setStorageValue(
        STORAGE_KEYS.USER,
        user
    );
}

/**
 * Retrieve authenticated session
 */
function getAuthSession() {

    return {

        accessToken:
            localStorage.getItem(
                STORAGE_KEYS.ACCESS_TOKEN
            ),

        refreshToken:
            localStorage.getItem(
                STORAGE_KEYS.REFRESH_TOKEN
            ),

        user:
            getStorageValue(
                STORAGE_KEYS.USER
            )
    };
}

/**
 * Determine whether a user is authenticated
 */
function isAuthenticated() {

    return Boolean(
        localStorage.getItem(
            STORAGE_KEYS.ACCESS_TOKEN
        )
    );
}

/**
 * Clear authentication state
 */
function clearAuthSession() {

    removeStorageValue(
        STORAGE_KEYS.USER
    );

    localStorage.removeItem(
        STORAGE_KEYS.ACCESS_TOKEN
    );

    localStorage.removeItem(
        STORAGE_KEYS.REFRESH_TOKEN
    );
}

/**
 * Verify auth-related storage exists
 */
function hasAuthSession() {

    return (
        storageHasKey(
            STORAGE_KEYS.ACCESS_TOKEN
        ) &&
        storageHasKey(
            STORAGE_KEYS.USER
        )
    );
}
/* ============================================================================
   TENANT HELPERS
============================================================================ */

/**
 * Store active tenant
 */
function setTenant(
    tenant
) {

    setStorageValue(
        STORAGE_KEYS.TENANT,
        tenant
    );
}

/**
 * Retrieve active tenant
 */
function getTenant() {

    return getStorageValue(
        STORAGE_KEYS.TENANT
    );
}

/**
 * Remove active tenant
 */
function clearTenant() {

    removeStorageValue(
        STORAGE_KEYS.TENANT
    );
}

/**
 * Check whether tenant exists
 */
function hasTenant() {

    return storageHasKey(
        STORAGE_KEYS.TENANT
    );
}

/* ============================================================================
   PERMISSION HELPERS
============================================================================ */

/**
 * Store user permissions
 */
function setPermissions(
    permissions = []
) {

    setStorageValue(
        STORAGE_KEYS.PERMISSIONS,
        permissions
    );
}

/**
 * Get user permissions
 */
function getPermissions() {

    return (
        getStorageValue(
            STORAGE_KEYS.PERMISSIONS
        ) || []
    );
}

/**
 * Clear all permissions
 */
function clearPermissions() {

    removeStorageValue(
        STORAGE_KEYS.PERMISSIONS
    );
}

/**
 * Check whether permissions exist
 */
function hasPermissions() {

    return storageHasKey(
        STORAGE_KEYS.PERMISSIONS
    );
}

/**
 * Check if user has a specific permission
 */
function hasPermission(
    permission
) {

    return getPermissions()
        .includes(permission);
}

/**
 * Check if user has all specified permissions
 */
function hasAllPermissions(
    permissions = []
) {

    const userPermissions =
        getPermissions();

    return permissions.every(
        permission =>
            userPermissions.includes(
                permission
            )
    );
}

/**
 * Check if user has at least one permission
 */
function hasAnyPermission(
    permissions = []
) {

    const userPermissions =
        getPermissions();

    return permissions.some(
        permission =>
            userPermissions.includes(
                permission
            )
    );
}
/* ============================================================================
   THEME HELPERS
============================================================================ */

/**
 * Supported application themes
 */
const SUPPORTED_THEMES = Object.freeze([
    "light",
    "dark",
    "system"
]);

/**
 * Store active theme
 */
function setTheme(
    theme = "light"
) {

    if (
        !SUPPORTED_THEMES.includes(
            theme
        )
    ) {

        throw new Error(
            `Unsupported theme: ${theme}`
        );
    }

    localStorage.setItem(
        STORAGE_KEYS.THEME,
        theme
    );
}

/**
 * Get active theme
 */
function getTheme() {

    return (
        localStorage.getItem(
            STORAGE_KEYS.THEME
        ) || "light"
    );
}

/**
 * Clear theme preference
 */
function clearTheme() {

    localStorage.removeItem(
        STORAGE_KEYS.THEME
    );
}

/**
 * Check whether theme preference exists
 */
function hasTheme() {

    return storageHasKey(
        STORAGE_KEYS.THEME
    );
}

/**
 * Toggle between light and dark themes
 */
function toggleTheme() {

    const currentTheme =
        getTheme();

    const nextTheme =
        currentTheme === "dark"
            ? "light"
            : "dark";

    setTheme(
        nextTheme
    );

    return nextTheme;
}

/* ============================================================================
   SAFE JSON UTILITIES
============================================================================ */

/**
 * Safely parse JSON without crashing tests
 *
 * @param {*} value
 * @param {*} fallback
 * @returns {*}
 */
function safeParse(
    value,
    fallback = null
) {

    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {

        return fallback;
    }

    /**
     * Value already parsed
     */
    if (
        typeof value === "object"
    ) {

        return value;
    }

    /**
     * Non-string primitive
     */
    if (
        typeof value !== "string"
    ) {

        return fallback;
    }

    try {

        return JSON.parse(
            value
        );

    } catch (error) {

        /**
         * Optional debug mode
         */
        if (
            process.env.NODE_ENV === "test" &&
            process.env.DEBUG_STORAGE === "true"
        ) {

            console.warn(
                "[mockLocalStorage] Failed to parse JSON",
                {
                    value,
                    error:
                        error.message
                }
            );
        }

        return fallback;
    }
}
/* ============================================================================
   GENERIC LOCAL STORAGE HELPERS
============================================================================ */

/**
 * Store value safely in localStorage
 */
function setStorageValue(
    key,
    value
) {

    try {

        localStorage.setItem(
            key,
            safeStringify(
                value,
                "null"
            )
        );

        return true;

    } catch (error) {

        if (
            process.env.NODE_ENV === "test" &&
            process.env.DEBUG_STORAGE === "true"
        ) {

            console.error(
                "[mockLocalStorage] Failed to store value",
                {
                    key,
                    error:
                        error.message
                }
            );
        }

        return false;
    }
}

/**
 * Retrieve value safely from localStorage
 */
function getStorageValue(
    key,
    fallback = null
) {

    try {

        return safeParse(
            localStorage.getItem(key),
            fallback
        );

    } catch {

        return fallback;
    }
}

/**
 * Remove value from localStorage
 */
function removeStorageValue(
    key
) {

    localStorage.removeItem(
        key
    );

    return true;
}

/**
 * Check if key exists
 */
function storageHasKey(
    key
) {

    return (
        localStorage.getItem(key)
        !== null
    );
}

/**
 * Get all storage keys
 */
function getStorageKeys() {

    const keys = [];

    for (
        let i = 0;
        i < localStorage.length;
        i++
    ) {

        const key =
            localStorage.key(i);

        if (key) {

            keys.push(key);
        }
    }

    return keys;
}

/**
 * Count items in storage
 */
function getStorageSize() {

    return localStorage.length;
}

/**
 * Clear only known application keys
 */
function clearApplicationStorage() {

    Object.values(
        STORAGE_KEYS
    ).forEach(key => {

        localStorage.removeItem(
            key
        );

    });
}

/**
 * Export entire storage snapshot
 * Useful for Jest assertions
 */
function exportStorage() {

    const snapshot = {};

    getStorageKeys()
        .forEach(key => {

            snapshot[key] =
                localStorage.getItem(
                    key
                );

        });

    return snapshot;
}

/* ============================================================================
   LOAN DRAFT HELPERS
============================================================================ */

/**
 * Save loan draft
 */
function saveLoanDraft(
    draft
) {

    setStorageValue(
        STORAGE_KEYS.LOAN_DRAFT,
        {
            ...draft,

            _metadata: {

                version: 1,

                savedAt:
                    new Date().toISOString()
            }
        }
    );

    return true;
}

/**
 * Retrieve loan draft
 */
function getLoanDraft() {

    return getStorageValue(
        STORAGE_KEYS.LOAN_DRAFT,
        null
    );
}

/**
 * Remove loan draft
 */
function clearLoanDraft() {

    removeStorageValue(
        STORAGE_KEYS.LOAN_DRAFT
    );

    return true;
}

/**
 * Check if draft exists
 */
function hasLoanDraft() {

    return storageHasKey(
        STORAGE_KEYS.LOAN_DRAFT
    );
}

/**
 * Get draft save timestamp
 */
function getLoanDraftTimestamp() {

    const draft =
        getLoanDraft();

    return draft?._metadata?.savedAt || null;
}

/**
 * Check whether loan draft is expired
 *
 * Default:
 * 7 days
 */
function isLoanDraftExpired(
    maxAgeHours = 168
) {

    const timestamp =
        getLoanDraftTimestamp();

    if (!timestamp) {
        return true;
    }

    const draftTime =
        new Date(timestamp);

    const now =
        new Date();

    const diffHours =
        (
            now.getTime() -
            draftTime.getTime()
        ) /
        (1000 * 60 * 60);

    return diffHours >
        maxAgeHours;
}

/**
 * Update existing draft
 */
function updateLoanDraft(
    updates = {}
) {

    const existing =
        getLoanDraft() || {};

    saveLoanDraft({

        ...existing,

        ...updates
    });

    return getLoanDraft();
}

/* ============================================================================
   MEMBER DRAFT HELPERS
============================================================================ */

/**
 * Save member onboarding draft
 */
function saveMemberDraft(
    draft
) {

    setStorageValue(
        STORAGE_KEYS.MEMBER_DRAFT,
        {
            ...draft,

            _metadata: {

                version: 1,

                savedAt:
                    new Date().toISOString(),

                draftType:
                    "MEMBER"
            }
        }
    );

    return true;
}

/**
 * Get member draft
 */
function getMemberDraft() {

    return getStorageValue(
        STORAGE_KEYS.MEMBER_DRAFT,
        null
    );
}

/**
 * Remove member draft
 */
function clearMemberDraft() {

    removeStorageValue(
        STORAGE_KEYS.MEMBER_DRAFT
    );

    return true;
}

/**
 * Check if member draft exists
 */
function hasMemberDraft() {

    return storageHasKey(
        STORAGE_KEYS.MEMBER_DRAFT
    );
}

/**
 * Update member draft
 */
function updateMemberDraft(
    updates = {}
) {

    const existing =
        getMemberDraft() || {};

    saveMemberDraft({

        ...existing,

        ...updates
    });

    return getMemberDraft();
}

/**
 * Get draft timestamp
 */
function getMemberDraftTimestamp() {

    const draft =
        getMemberDraft();

    return draft?._metadata?.savedAt || null;
}

/**
 * Check whether draft has expired
 *
 * Default retention:
 * 7 days (168 hours)
 */
function isMemberDraftExpired(
    maxAgeHours = 168
) {

    const timestamp =
        getMemberDraftTimestamp();

    if (!timestamp) {

        return true;
    }

    const savedDate =
        new Date(timestamp);

    const now =
        new Date();

    const ageHours =
        (
            now.getTime() -
            savedDate.getTime()
        ) /
        (1000 * 60 * 60);

    return ageHours >
        maxAgeHours;
}

/* ============================================================================
   SAVINGS DRAFT HELPERS
============================================================================ */

/**
 * Save savings transaction / account draft
 */
function saveSavingsDraft(
    draft
) {

    setStorageValue(
        STORAGE_KEYS.SAVINGS_DRAFT,
        {
            ...draft,

            _metadata: {

                version: 1,

                savedAt:
                    new Date().toISOString(),

                draftType:
                    "SAVINGS"
            }
        }
    );

    return true;
}

/**
 * Get savings draft
 */
function getSavingsDraft() {

    return getStorageValue(
        STORAGE_KEYS.SAVINGS_DRAFT,
        null
    );
}

/**
 * Remove savings draft
 */
function clearSavingsDraft() {

    removeStorageValue(
        STORAGE_KEYS.SAVINGS_DRAFT
    );

    return true;
}

/**
 * Check whether a savings draft exists
 */
function hasSavingsDraft() {

    return storageHasKey(
        STORAGE_KEYS.SAVINGS_DRAFT
    );
}

/**
 * Update existing savings draft
 */
function updateSavingsDraft(
    updates = {}
) {

    const existing =
        getSavingsDraft() || {};

    saveSavingsDraft({

        ...existing,

        ...updates
    });

    return getSavingsDraft();
}

/**
 * Get draft timestamp
 */
function getSavingsDraftTimestamp() {

    const draft =
        getSavingsDraft();

    return (
        draft?._metadata?.savedAt ||
        null
    );
}

/**
 * Determine whether draft is expired
 *
 * Default retention:
 * 7 days = 168 hours
 */
function isSavingsDraftExpired(
    maxAgeHours = 168
) {

    const timestamp =
        getSavingsDraftTimestamp();

    if (!timestamp) {

        return true;
    }

    const savedDate =
        new Date(timestamp);

    const now =
        new Date();

    const ageHours =
        (
            now.getTime() -
            savedDate.getTime()
        ) /
        (1000 * 60 * 60);

    return ageHours >
        maxAgeHours;
}

/* ============================================================================
   ONBOARDING HELPERS
============================================================================ */

/**
 * Save onboarding progress
 */
function setOnboardingProgress(
    progress
) {

    setStorageValue(
        STORAGE_KEYS.ONBOARDING_PROGRESS,
        {
            ...progress,

            _metadata: {

                version: 1,

                savedAt:
                    new Date().toISOString(),

                progressType:
                    "ONBOARDING"
            }
        }
    );

    return true;
}

/**
 * Get onboarding progress
 */
function getOnboardingProgress() {

    return getStorageValue(
        STORAGE_KEYS.ONBOARDING_PROGRESS,
        null
    );
}

/**
 * Update onboarding progress
 */
function updateOnboardingProgress(
    updates = {}
) {

    const existing =
        getOnboardingProgress() || {};

    setOnboardingProgress({

        ...existing,

        ...updates
    });

    return getOnboardingProgress();
}

/**
 * Clear onboarding progress
 */
function clearOnboardingProgress() {

    removeStorageValue(
        STORAGE_KEYS.ONBOARDING_PROGRESS
    );

    return true;
}

/**
 * Check if onboarding progress exists
 */
function hasOnboardingProgress() {

    return storageHasKey(
        STORAGE_KEYS.ONBOARDING_PROGRESS
    );
}

/**
 * Get onboarding timestamp
 */
function getOnboardingTimestamp() {

    const progress =
        getOnboardingProgress();

    return (
        progress?._metadata?.savedAt ||
        null
    );
}

/**
 * Determine if onboarding progress is stale
 *
 * Default retention:
 * 30 days
 */
function isOnboardingProgressExpired(
    maxAgeHours = 720
) {

    const timestamp =
        getOnboardingTimestamp();

    if (!timestamp) {

        return true;
    }

    const savedDate =
        new Date(timestamp);

    const now =
        new Date();

    const ageHours =
        (
            now.getTime() -
            savedDate.getTime()
        ) /
        (1000 * 60 * 60);

    return ageHours >
        maxAgeHours;
}

/**
 * Calculate onboarding completion percentage
 */
function getOnboardingCompletionPercentage() {

    const progress =
        getOnboardingProgress();

    if (
        !progress ||
        !Array.isArray(
            progress.completedSteps
        )
    ) {

        return 0;
    }

    const totalSteps =
        progress.totalSteps || 1;

    return Math.round(
        (
            progress.completedSteps.length /
            totalSteps
        ) * 100
    );
}

/* ============================================================================
   TEST UTILITIES
============================================================================ */

/**
 * Create mock authenticated user
 */
function createMockUser(
    overrides = {}
) {

    return {

        id:
            "test-user-id",

        tenantId:
            "tenant-001",

        firstName:
            "Justine",

        lastName:
            "Igune",

        email:
            "test@titech.co.ug",

        phone:
            "+256772123456",

        role:
            "MEMBER",

        permissions: [],

        isActive:
            true,

        createdAt:
            new Date().toISOString(),

        ...overrides
    };
}

/**
 * Create mock SACCO tenant
 */
function createMockTenant(
    overrides = {}
) {

    return {

        id:
            "tenant-001",

        code:
            "TITECH001",

        name:
            "TITech Demo SACCO",

        country:
            "UG",

        currency:
            "UGX",

        isActive:
            true,

        createdAt:
            new Date().toISOString(),

        ...overrides
    };
}

/**
 * Create mock admin
 */
function createMockAdmin(
    overrides = {}
) {

    return createMockUser({

        role:
            "ADMIN",

        permissions: [
            "LOAN_APPROVE",
            "LOAN_REJECT",
            "MEMBER_CREATE",
            "MEMBER_UPDATE",
            "TENANT_MANAGE"
        ],

        ...overrides
    });
}

/**
 * Create mock loan officer
 */
function createMockLoanOfficer(
    overrides = {}
) {

    return createMockUser({

        role:
            "LOAN_OFFICER",

        permissions: [
            "LOAN_CREATE",
            "LOAN_APPROVE",
            "LOAN_VIEW"
        ],

        ...overrides
    });
}

/**
 * Create mock treasurer
 */
function createMockTreasurer(
    overrides = {}
) {

    return createMockUser({

        role:
            "TREASURER",

        permissions: [
            "SAVINGS_CREATE",
            "SAVINGS_APPROVE",
            "REPORT_VIEW"
        ],

        ...overrides
    });
}

/**
 * Create mock loan draft
 */
function createMockLoanDraft(
    overrides = {}
) {

    return {

        amount:
            500000,

        interestRate:
            12,

        repaymentPeriod:
            12,

        loanType:
            "PERSONAL",

        ...overrides
    };
}

/**
 * Create mock member draft
 */
function createMockMemberDraft(
    overrides = {}
) {

    return {

        firstName:
            "John",

        lastName:
            "Doe",

        email:
            "john@example.com",

        phone:
            "+256700000000",

        ...overrides
    };
}

/**
 * Create mock savings draft
 */
function createMockSavingsDraft(
    overrides = {}
) {

    return {

        amount:
            100000,

        frequency:
            "MONTHLY",

        accountType:
            "SAVINGS",

        ...overrides
    };
}

/**
 * Create onboarding progress
 */
function createMockOnboardingProgress(
    overrides = {}
) {

    return {

        currentStep:
            2,

        totalSteps:
            5,

        completedSteps: [
            1,
            2
        ],

        ...overrides
    };
}

/* ============================================================================
   EXPORTS
============================================================================ */

module.exports = {

    /**
     * Storage Constants
     */
    STORAGE_KEYS,

    /**
     * Storage Mocks
     */
    localStorageMock,
    sessionStorageMock,

    /**
     * Mock Installation
     */
    installStorageMocks,
    uninstallStorageMocks,
    resetStorage,

    /**
     * Safe Utilities
     */
    safeParse,
    safeStringify,

    /**
     * Generic Storage Helpers
     */
    setStorageValue,
    getStorageValue,
    removeStorageValue,

    storageHasKey,
    getStorageKeys,
    getStorageSize,

    clearApplicationStorage,
    exportStorage,

    /**
     * Session Storage Helpers
     */
    setSessionValue,
    getSessionValue,
    removeSessionValue,

    /**
     * Authentication Helpers
     */
    setAuthSession,
    getAuthSession,
    clearAuthSession,

    isAuthenticated,
    hasAuthSession,

    /**
     * Tenant Helpers
     */
    setTenant,
    getTenant,

    clearTenant,
    hasTenant,

    /**
     * Permission Helpers
     */
    setPermissions,
    getPermissions,

    clearPermissions,
    hasPermissions,

    hasPermission,
    hasAllPermissions,
    hasAnyPermission,

    /**
     * Theme Helpers
     */
    SUPPORTED_THEMES,

    setTheme,
    getTheme,

    clearTheme,

    hasTheme,

    toggleTheme,

    /**
     * Loan Draft Helpers
     */
    saveLoanDraft,
    getLoanDraft,

    clearLoanDraft,
    hasLoanDraft,

    updateLoanDraft,

    getLoanDraftTimestamp,

    isLoanDraftExpired,

    /**
     * Member Draft Helpers
     */
    saveMemberDraft,
    getMemberDraft,

    clearMemberDraft,
    hasMemberDraft,

    updateMemberDraft,

    getMemberDraftTimestamp,

    isMemberDraftExpired,

    /**
     * Savings Draft Helpers
     */
    saveSavingsDraft,
    getSavingsDraft,

    clearSavingsDraft,
    hasSavingsDraft,

    updateSavingsDraft,

    getSavingsDraftTimestamp,

    isSavingsDraftExpired,

    /**
     * Onboarding Helpers
     */
    setOnboardingProgress,
    getOnboardingProgress,

    updateOnboardingProgress,

    clearOnboardingProgress,

    hasOnboardingProgress,

    getOnboardingTimestamp,

    isOnboardingProgressExpired,

    getOnboardingCompletionPercentage,

    /**
     * Test Factories
     */
    createMockUser,
    createMockTenant,

    createMockAdmin,
    createMockLoanOfficer,
    createMockTreasurer,

    createMockLoanDraft,
    createMockMemberDraft,
    createMockSavingsDraft,

    createMockOnboardingProgress
};