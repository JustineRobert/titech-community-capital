// ============================================================================
// TITech Community Capital
// Enterprise Authentication Slice
// File: frontend/src/features/auth/authSlice.js
// Production Grade
// ============================================================================

import {
    createSelector,
    createSlice,
} from "@reduxjs/toolkit";

/**
 * =============================================================================
 * Purpose
 * =============================================================================
 *
 * Enterprise authentication/session state for the TITech frontend.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * ✓ Authentication lifecycle state
 * ✓ Session restoration
 * ✓ Access-token metadata
 * ✓ Refresh-token metadata
 * ✓ Tenant context
 * ✓ User/role/permission/feature state
 * ✓ Session activity tracking
 * ✓ Session-expiry handling
 * ✓ Authentication error normalization
 * ✓ Safe browser-storage access
 * ✓ Cross-tab logout/session events
 * ✓ Serializable Redux state
 * ✓ Memoized authorization selectors
 *
 * IMPORTANT SECURITY BOUNDARY
 * -----------------------------------------------------------------------------
 *
 * The Redux slice is NOT the authoritative authentication system.
 *
 * The backend remains authoritative for:
 *
 *   - identity
 *   - authentication
 *   - authorization
 *   - tenant membership
 *   - permissions
 *   - roles
 *   - session validity
 *   - token revocation
 *
 * The frontend must treat all locally stored authentication state as
 * untrusted/cacheable client state and revalidate it with the backend.
 *
 * NOTE
 * -----------------------------------------------------------------------------
 *
 * Tokens are retained in browser storage here for compatibility with the
 * existing application architecture. For the strongest web security model,
 * prefer Secure + HttpOnly + SameSite cookies for refresh/session credentials
 * and keep access-token exposure as narrow as possible.
 * =============================================================================
 */

/* =============================================================================
 * Storage Keys
 * =============================================================================
 */

export const AUTH_STORAGE_KEYS = Object.freeze({
    TOKEN:
        "accessToken",

    REFRESH_TOKEN:
        "refreshToken",

    USER:
        "user",

    TENANT:
        "tenantId",

    SESSION:
        "titech.auth.session.version",
});

/* =============================================================================
 * Authentication Constants
 * =============================================================================
 */

export const AUTH_STATUS = Object.freeze({
    IDLE:
        "idle",

    INITIALIZING:
        "initializing",

    AUTHENTICATED:
        "authenticated",

    UNAUTHENTICATED:
        "unauthenticated",

    REFRESHING:
        "refreshing",

    FAILED:
        "failed",

    EXPIRED:
        "expired",

    LOGGING_OUT:
        "logging_out",
});

export const LOGIN_METHODS = Object.freeze({
    JWT:
        "jwt",

    PASSWORD:
        "password",

    OTP:
        "otp",

    SSO:
        "sso",

    OAUTH:
        "oauth",

    PASSKEY:
        "passkey",

    UNKNOWN:
        "unknown",
});

const MAX_ERROR_HISTORY =
    25;

const MAX_PERMISSIONS =
    500;

const MAX_ROLES =
    100;

const MAX_FEATURES =
    500;

/* =============================================================================
 * Safe browser storage helpers
 * =============================================================================
 */

function getStorage() {
    try {
        if (
            typeof window ===
                "undefined" ||
            !window.localStorage
        ) {
            return null;
        }

        return window.localStorage;
    } catch {
        return null;
    }
}

function safeStorageGet(
    key,
) {
    try {
        const storage =
            getStorage();

        return storage
            ? storage.getItem(key)
            : null;
    } catch {
        return null;
    }
}

function safeStorageSet(
    key,
    value,
) {
    try {
        const storage =
            getStorage();

        if (
            !storage
        ) {
            return false;
        }

        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            storage.removeItem(
                key,
            );

            return true;
        }

        if (
            typeof value ===
            "object"
        ) {
            storage.setItem(
                key,
                JSON.stringify(
                    value,
                ),
            );

            return true;
        }

        storage.setItem(
            key,
            String(value),
        );

        return true;
    } catch {
        return false;
    }
}

function safeStorageRemove(
    key,
) {
    try {
        const storage =
            getStorage();

        if (
            storage
        ) {
            storage.removeItem(
                key,
            );
        }

        return true;
    } catch {
        return false;
    }
}

function parseStoredJson(
    key,
) {
    try {
        const raw =
            safeStorageGet(
                key,
            );

        if (
            !raw
        ) {
            return null;
        }

        return JSON.parse(
            raw,
        );
    } catch {
        safeStorageRemove(
            key,
        );

        return null;
    }
}

/* =============================================================================
 * Normalization helpers
 * =============================================================================
 */

function now() {
    return Date.now();
}

function nowIso() {
    return new Date().toISOString();
}

function normalizeString(
    value,
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return null;
    }

    const normalized =
        String(value).trim();

    return normalized ||
        null;
}

function normalizeCollection(
    value,
    maximum,
) {
    if (
        !Array.isArray(
            value,
        )
    ) {
        return [];
    }

    return [
        ...new Set(
            value
                .map(
                    normalizeString,
                )
                .filter(
                    Boolean,
                ),
        ),
    ].slice(
        0,
        maximum,
    );
}

function normalizeError(
    error,
) {
    if (
        !error
    ) {
        return null;
    }

    if (
        typeof error ===
        "string"
    ) {
        return {
            name:
                "Error",

            code:
                "AUTHENTICATION_ERROR",

            message:
                error,

            statusCode:
                null,

            retryable:
                false,

            classification:
                null,

            requestId:
                null,

            timestamp:
                nowIso(),
        };
    }

    const responseData =
        error?.response?.data;

    const source =
        responseData &&
        typeof responseData ===
            "object"
            ? responseData
            : error;

    return {
        name:
            source?.name ||
            error?.name ||
            "Error",

        code:
            source?.code ||
            error?.code ||
            "AUTHENTICATION_ERROR",

        message:
            source?.message ||
            source?.error ||
            error?.message ||
            "Authentication operation failed.",

        statusCode:
            error?.response?.status ??
            source?.statusCode ??
            null,

        retryable:
            Boolean(
                source?.retryable ??
                error?.retryable,
            ),

        classification:
            source?.classification ||
            error?.classification ||
            null,

        requestId:
            source?.requestId ||
            error?.requestId ||
            null,

        timestamp:
            nowIso(),
    };
}

function addError(
    state,
    error,
) {
    const normalized =
        normalizeError(
            error,
        );

    if (
        !normalized
    ) {
        return;
    }

    state.error =
        normalized;

    state.errors =
        [
            ...state.errors,
            normalized,
        ].slice(
            -MAX_ERROR_HISTORY,
        );
}

/* =============================================================================
 * Token helpers
 * =============================================================================
 *
 * This slice intentionally does not attempt to decode or trust JWT claims.
 * Authorization decisions must remain server-authoritative.
 * =============================================================================
 */

function persistSession(
    {
        token,
        refreshToken,
        user,
        tenantId,
    },
) {
    safeStorageSet(
        AUTH_STORAGE_KEYS.TOKEN,
        token,
    );

    safeStorageSet(
        AUTH_STORAGE_KEYS.REFRESH_TOKEN,
        refreshToken,
    );

    safeStorageSet(
        AUTH_STORAGE_KEYS.USER,
        user,
    );

    safeStorageSet(
        AUTH_STORAGE_KEYS.TENANT,
        tenantId,
    );

    /**
     * Bump a storage version so other browser contexts can detect session
     * changes through the native `storage` event.
     */
    safeStorageSet(
        AUTH_STORAGE_KEYS.SESSION,
        String(
            now(),
        ),
    );
}

function clearPersistedSession() {
    safeStorageRemove(
        AUTH_STORAGE_KEYS.TOKEN,
    );

    safeStorageRemove(
        AUTH_STORAGE_KEYS.REFRESH_TOKEN,
    );

    safeStorageRemove(
        AUTH_STORAGE_KEYS.USER,
    );

    safeStorageRemove(
        AUTH_STORAGE_KEYS.TENANT,
    );

    safeStorageSet(
        AUTH_STORAGE_KEYS.SESSION,
        String(
            now(),
        ),
    );
}

function readStoredSession() {
    const token =
        safeStorageGet(
            AUTH_STORAGE_KEYS.TOKEN,
        );

    const refreshToken =
        safeStorageGet(
            AUTH_STORAGE_KEYS.REFRESH_TOKEN,
        );

    const user =
        parseStoredJson(
            AUTH_STORAGE_KEYS.USER,
        );

    const tenantId =
        safeStorageGet(
            AUTH_STORAGE_KEYS.TENANT,
        );

    return {
        token:
            token || null,

        refreshToken:
            refreshToken || null,

        user,

        tenantId:
            tenantId || null,
    };
}

function deriveAuthorizationState(
    user,
) {
    return {
        permissions:
            normalizeCollection(
                user?.permissions,
                MAX_PERMISSIONS,
            ),

        roles:
            normalizeCollection(
                user?.roles ||
                (
                    user?.role
                        ? [
                            user.role,
                        ]
                        : []
                ),
                MAX_ROLES,
            ),

        features:
            normalizeCollection(
                user?.features,
                MAX_FEATURES,
            ),
    };
}

/* =============================================================================
 * Initial State Factory
 * =============================================================================
 */

function createInitialState() {
    const stored =
        readStoredSession();

    const authorization =
        deriveAuthorizationState(
            stored.user,
        );

    const authenticated =
        Boolean(
            stored.token,
        );

    return {
        user:
            stored.user,

        token:
            stored.token,

        refreshToken:
            stored.refreshToken,

        tenantId:
            stored.tenantId ||
            stored.user?.tenantId ||
            null,

        authenticated,

        status:
            authenticated
                ? AUTH_STATUS.AUTHENTICATED
                : AUTH_STATUS.UNAUTHENTICATED,

        loading:
            false,

        initialized:
            false,

        sessionExpired:
            false,

        permissions:
            authorization.permissions,

        roles:
            authorization.roles,

        features:
            authorization.features,

        loginMethod:
            null,

        lastLoginAt:
            null,

        lastActivityAt:
            now(),

        lastAuthenticatedAt:
            authenticated
                ? nowIso()
                : null,

        lastLogoutAt:
            null,

        refreshInProgress:
            false,

        error:
            null,

        errors: [],

        storageAvailable:
            Boolean(
                getStorage(),
            ),

        lastStorageSyncAt:
            null,

        sessionVersion:
            safeStorageGet(
                AUTH_STORAGE_KEYS.SESSION,
            ),

        /**
         * Public/non-secret session metadata only.
         */
        metadata: {
            userId:
                stored.user?.id ||
                stored.user?._id ||
                null,

            email:
                stored.user?.email ||
                null,

            lastKnownTenantId:
                stored.tenantId ||
                stored.user?.tenantId ||
                null,
        },
    };
}

const initialState =
    createInitialState();

/* =============================================================================
 * Redux Slice
 * =============================================================================
 */

const authSlice =
    createSlice({

        name:
            "auth",

        initialState,

        reducers: {

            /* -----------------------------------------------------------------
             * Initialize authentication state
             * -----------------------------------------------------------------
             */

            initializeAuth(
                state,
            ) {
                const stored =
                    readStoredSession();

                const authorization =
                    deriveAuthorizationState(
                        stored.user,
                    );

                state.user =
                    stored.user;

                state.token =
                    stored.token;

                state.refreshToken =
                    stored.refreshToken;

                state.tenantId =
                    stored.tenantId ||
                    stored.user?.tenantId ||
                    null;

                state.authenticated =
                    Boolean(
                        stored.token,
                    );

                state.status =
                    state.authenticated
                        ? AUTH_STATUS.AUTHENTICATED
                        : AUTH_STATUS.UNAUTHENTICATED;

                state.initialized =
                    true;

                state.sessionExpired =
                    false;

                state.loading =
                    false;

                state.refreshInProgress =
                    false;

                state.permissions =
                    authorization.permissions;

                state.roles =
                    authorization.roles;

                state.features =
                    authorization.features;

                state.metadata.userId =
                    stored.user?.id ||
                    stored.user?._id ||
                    null;

                state.metadata.email =
                    stored.user?.email ||
                    null;

                state.metadata.lastKnownTenantId =
                    state.tenantId;

                state.storageAvailable =
                    Boolean(
                        getStorage(),
                    );

                state.sessionVersion =
                    safeStorageGet(
                        AUTH_STORAGE_KEYS.SESSION,
                    );

                state.lastStorageSyncAt =
                    nowIso();

                state.error =
                    null;
            },

            /* -----------------------------------------------------------------
             * Loading
             * -----------------------------------------------------------------
             */

            setAuthLoading(
                state,
                action,
            ) {
                state.loading =
                    Boolean(
                        action.payload,
                    );

                if (
                    state.loading
                ) {
                    state.status =
                        AUTH_STATUS
                            .INITIALIZING;
                }
            },

            /* -----------------------------------------------------------------
             * Login start
             * -----------------------------------------------------------------
             */

            loginStart(
                state,
            ) {
                state.loading =
                    true;

                state.status =
                    AUTH_STATUS
                        .INITIALIZING;

                state.error =
                    null;

                state.sessionExpired =
                    false;
            },

            /* -----------------------------------------------------------------
             * Login success
             * -----------------------------------------------------------------
             */

            loginSuccess(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const user =
                    payload.user ||
                    payload.data?.user ||
                    null;

                const token =
                    payload.token ||
                    payload.accessToken ||
                    payload.data?.token ||
                    payload.data?.accessToken ||
                    null;

                const refreshToken =
                    payload.refreshToken ||
                    payload.data?.refreshToken ||
                    null;

                const tenantId =
                    payload.tenantId ||
                    user?.tenantId ||
                    payload.data?.tenantId ||
                    null;

                const authorization =
                    deriveAuthorizationState(
                        user,
                    );

                state.loading =
                    false;

                state.status =
                    AUTH_STATUS
                        .AUTHENTICATED;

                state.user =
                    user;

                state.token =
                    token;

                state.refreshToken =
                    refreshToken;

                state.tenantId =
                    tenantId;

                state.authenticated =
                    Boolean(
                        token,
                    );

                state.initialized =
                    true;

                state.error =
                    null;

                state.sessionExpired =
                    false;

                state.refreshInProgress =
                    false;

                state.loginMethod =
                    normalizeString(
                        payload.loginMethod ||
                        payload.method ||
                        (
                            token
                                ? LOGIN_METHODS.JWT
                                : LOGIN_METHODS.UNKNOWN
                        ),
                    );

                state.lastLoginAt =
                    nowIso();

                state.lastAuthenticatedAt =
                    state.lastLoginAt;

                state.lastActivityAt =
                    now();

                state.permissions =
                    authorization.permissions;

                state.roles =
                    authorization.roles;

                state.features =
                    authorization.features;

                state.metadata.userId =
                    user?.id ||
                    user?._id ||
                    null;

                state.metadata.email =
                    user?.email ||
                    null;

                state.metadata.lastKnownTenantId =
                    tenantId;

                persistSession({
                    token,
                    refreshToken,
                    user,
                    tenantId,
                });

                state.sessionVersion =
                    safeStorageGet(
                        AUTH_STORAGE_KEYS.SESSION,
                    );

                state.lastStorageSyncAt =
                    nowIso();
            },

            /* -----------------------------------------------------------------
             * Login failure
             * -----------------------------------------------------------------
             */

            loginFailure(
                state,
                action,
            ) {
                const error =
                    normalizeError(
                        action.payload ||
                        action.error,
                    );

                state.loading =
                    false;

                state.status =
                    AUTH_STATUS.FAILED;

                state.authenticated =
                    false;

                state.refreshInProgress =
                    false;

                addError(
                    state,
                    error,
                );
            },

            /* -----------------------------------------------------------------
             * Refresh start
             * -----------------------------------------------------------------
             */

            refreshTokenStart(
                state,
            ) {
                state.refreshInProgress =
                    true;

                state.loading =
                    true;

                state.status =
                    AUTH_STATUS.REFRESHING;

                state.error =
                    null;
            },

            /* -----------------------------------------------------------------
             * Refresh success
             * -----------------------------------------------------------------
             */

            refreshTokenSuccess(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const nextToken =
                    payload.token ||
                    payload.accessToken ||
                    null;

                const nextRefreshToken =
                    payload.refreshToken ??
                    state.refreshToken;

                if (
                    nextToken
                ) {
                    state.token =
                        nextToken;
                }

                state.refreshToken =
                    nextRefreshToken;

                state.refreshInProgress =
                    false;

                state.loading =
                    false;

                state.status =
                    state.token
                        ? AUTH_STATUS
                            .AUTHENTICATED
                        : AUTH_STATUS
                            .UNAUTHENTICATED;

                state.authenticated =
                    Boolean(
                        state.token,
                    );

                state.sessionExpired =
                    false;

                state.lastActivityAt =
                    now();

                state.lastAuthenticatedAt =
                    nowIso();

                if (
                    payload.user
                ) {
                    state.user =
                        payload.user;

                    const authorization =
                        deriveAuthorizationState(
                            payload.user,
                        );

                    state.permissions =
                        authorization.permissions;

                    state.roles =
                        authorization.roles;

                    state.features =
                        authorization.features;

                    state.metadata.userId =
                        payload.user?.id ||
                        payload.user?._id ||
                        null;

                    state.metadata.email =
                        payload.user?.email ||
                        null;
                }

                state.tenantId =
                    payload.tenantId ||
                    state.tenantId ||
                    state.user?.tenantId ||
                    null;

                safeStorageSet(
                    AUTH_STORAGE_KEYS.TOKEN,
                    state.token,
                );

                safeStorageSet(
                    AUTH_STORAGE_KEYS.REFRESH_TOKEN,
                    state.refreshToken,
                );

                safeStorageSet(
                    AUTH_STORAGE_KEYS.USER,
                    state.user,
                );

                safeStorageSet(
                    AUTH_STORAGE_KEYS.TENANT,
                    state.tenantId,
                );

                state.sessionVersion =
                    safeStorageGet(
                        AUTH_STORAGE_KEYS.SESSION,
                    );

                state.lastStorageSyncAt =
                    nowIso();

                state.error =
                    null;
            },

            /* -----------------------------------------------------------------
             * Refresh failure
             * -----------------------------------------------------------------
             */

            refreshTokenFailure(
                state,
                action,
            ) {
                const error =
                    normalizeError(
                        action.payload ||
                        action.error,
                    );

                state.refreshInProgress =
                    false;

                state.loading =
                    false;

                state.status =
                    AUTH_STATUS.FAILED;

                state.error =
                    error;

                addError(
                    state,
                    error,
                );
            },

            /* -----------------------------------------------------------------
             * Update user
             * -----------------------------------------------------------------
             */

            updateUser(
                state,
                action,
            ) {
                const nextUser =
                    action.payload || {};

                state.user =
                    {
                        ...(state.user || {}),
                        ...nextUser,
                    };

                const authorization =
                    deriveAuthorizationState(
                        state.user,
                    );

                state.permissions =
                    authorization.permissions;

                state.roles =
                    authorization.roles;

                state.features =
                    authorization.features;

                state.tenantId =
                    state.user?.tenantId ||
                    state.tenantId ||
                    null;

                state.metadata.userId =
                    state.user?.id ||
                    state.user?._id ||
                    null;

                state.metadata.email =
                    state.user?.email ||
                    null;

                state.metadata.lastKnownTenantId =
                    state.tenantId;

                safeStorageSet(
                    AUTH_STORAGE_KEYS.USER,
                    state.user,
                );

                safeStorageSet(
                    AUTH_STORAGE_KEYS.TENANT,
                    state.tenantId,
                );

                state.lastActivityAt =
                    now();

                state.lastStorageSyncAt =
                    nowIso();
            },

            /* -----------------------------------------------------------------
             * Permissions / roles / features
             * -----------------------------------------------------------------
             */

            setPermissions(
                state,
                action,
            ) {
                state.permissions =
                    normalizeCollection(
                        action.payload,
                        MAX_PERMISSIONS,
                    );

                safeStorageSet(
                    AUTH_STORAGE_KEYS.USER,
                    {
                        ...(state.user || {}),
                        permissions:
                            state.permissions,
                    },
                );

                state.lastActivityAt =
                    now();
            },

            setRoles(
                state,
                action,
            ) {
                state.roles =
                    normalizeCollection(
                        action.payload,
                        MAX_ROLES,
                    );

                safeStorageSet(
                    AUTH_STORAGE_KEYS.USER,
                    {
                        ...(state.user || {}),
                        roles:
                            state.roles,
                    },
                );

                state.lastActivityAt =
                    now();
            },

            setFeatures(
                state,
                action,
            ) {
                state.features =
                    normalizeCollection(
                        action.payload,
                        MAX_FEATURES,
                    );

                safeStorageSet(
                    AUTH_STORAGE_KEYS.USER,
                    {
                        ...(state.user || {}),
                        features:
                            state.features,
                    },
                );

                state.lastActivityAt =
                    now();
            },

            /* -----------------------------------------------------------------
             * Tenant
             * -----------------------------------------------------------------
             */

            setTenant(
                state,
                action,
            ) {
                const tenantId =
                    normalizeString(
                        action.payload,
                    );

                state.tenantId =
                    tenantId;

                state.metadata.lastKnownTenantId =
                    tenantId;

                safeStorageSet(
                    AUTH_STORAGE_KEYS.TENANT,
                    tenantId,
                );

                state.lastActivityAt =
                    now();
            },

            /* -----------------------------------------------------------------
             * Activity
             * -----------------------------------------------------------------
             */

            touchSession(
                state,
            ) {
                state.lastActivityAt =
                    now();
            },

            /* -----------------------------------------------------------------
             * Session expiration
             * -----------------------------------------------------------------
             */

            markSessionExpired(
                state,
                action,
            ) {
                state.sessionExpired =
                    true;

                state.authenticated =
                    false;

                state.status =
                    AUTH_STATUS.EXPIRED;

                state.loading =
                    false;

                state.refreshInProgress =
                    false;

                if (
                    action.payload
                ) {
                    addError(
                        state,
                        action.payload,
                    );
                }
            },

            /**
             * Backward-compatible action name.
             */
            sessionExpired(
                state,
                action,
            ) {
                state.sessionExpired =
                    true;

                state.authenticated =
                    false;

                state.status =
                    AUTH_STATUS.EXPIRED;

                state.loading =
                    false;

                state.refreshInProgress =
                    false;

                if (
                    action?.payload
                ) {
                    addError(
                        state,
                        action.payload,
                    );
                }
            },

            /* -----------------------------------------------------------------
             * Clear errors
             * -----------------------------------------------------------------
             */

            clearAuthError(
                state,
            ) {
                state.error =
                    null;
            },

            clearAuthErrors(
                state,
            ) {
                state.error =
                    null;

                state.errors =
                    [];
            },

            /* -----------------------------------------------------------------
             * Storage/session synchronization
             * -----------------------------------------------------------------
             */

            synchronizeStoredSession(
                state,
                action,
            ) {
                const session =
                    action.payload ||
                    readStoredSession();

                const authorization =
                    deriveAuthorizationState(
                        session.user,
                    );

                state.user =
                    session.user;

                state.token =
                    session.token;

                state.refreshToken =
                    session.refreshToken;

                state.tenantId =
                    session.tenantId ||
                    session.user?.tenantId ||
                    null;

                state.authenticated =
                    Boolean(
                        session.token,
                    );

                state.status =
                    state.authenticated
                        ? AUTH_STATUS
                            .AUTHENTICATED
                        : AUTH_STATUS
                            .UNAUTHENTICATED;

                state.permissions =
                    authorization.permissions;

                state.roles =
                    authorization.roles;

                state.features =
                    authorization.features;

                state.metadata.userId =
                    session.user?.id ||
                    session.user?._id ||
                    null;

                state.metadata.email =
                    session.user?.email ||
                    null;

                state.metadata.lastKnownTenantId =
                    state.tenantId;

                state.sessionVersion =
                    safeStorageGet(
                        AUTH_STORAGE_KEYS.SESSION,
                    );

                state.lastStorageSyncAt =
                    nowIso();
            },

            /* -----------------------------------------------------------------
             * Logout
             * -----------------------------------------------------------------
             */

            logout(
                state,
            ) {
                state.user =
                    null;

                state.token =
                    null;

                state.refreshToken =
                    null;

                state.tenantId =
                    null;

                state.authenticated =
                    false;

                state.status =
                    AUTH_STATUS.LOGGING_OUT;

                state.loading =
                    false;

                state.refreshInProgress =
                    false;

                state.permissions =
                    [];

                state.roles =
                    [];

                state.features =
                    [];

                state.sessionExpired =
                    false;

                state.loginMethod =
                    null;

                state.lastLogoutAt =
                    nowIso();

                state.lastActivityAt =
                    now();

                state.error =
                    null;

                state.metadata.userId =
                    null;

                state.metadata.email =
                    null;

                state.metadata.lastKnownTenantId =
                    null;

                clearPersistedSession();

                state.sessionVersion =
                    safeStorageGet(
                        AUTH_STORAGE_KEYS.SESSION,
                    );

                state.lastStorageSyncAt =
                    nowIso();

                state.status =
                    AUTH_STATUS
                        .UNAUTHENTICATED;
            },

        },
    });

/* =============================================================================
 * Actions
 * =============================================================================
 */

export const {
    initializeAuth,

    setAuthLoading,

    loginStart,
    loginSuccess,
    loginFailure,

    refreshTokenStart,
    refreshTokenSuccess,
    refreshTokenFailure,

    updateUser,

    setPermissions,
    setRoles,
    setFeatures,

    setTenant,

    touchSession,

    markSessionExpired,
    sessionExpired,

    clearAuthError,
    clearAuthErrors,

    synchronizeStoredSession,

    logout,

} =
    authSlice.actions;

/* =============================================================================
 * Selectors
 * =============================================================================
 */

export const selectAuth =
    state =>
        state?.auth ||
        initialState;

export const selectUser =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            auth.user,
    );

export const selectToken =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            auth.token,
    );

export const selectRefreshToken =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            auth.refreshToken,
    );

export const selectTenant =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            auth.tenantId,
    );

export const selectFeatures =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            auth.features,
    );

export const selectPermissions =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            auth.permissions,
    );

export const selectRoles =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            auth.roles,
    );

export const selectAuthenticated =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            Boolean(
                auth.authenticated,
            ),
    );

export const selectAuthLoading =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            Boolean(
                auth.loading,
            ),
    );

export const selectAuthStatus =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            auth.status,
    );

export const selectAuthInitialized =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            Boolean(
                auth.initialized,
            ),
    );

export const selectSessionExpired =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            Boolean(
                auth.sessionExpired,
            ),
    );

export const selectRefreshInProgress =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            Boolean(
                auth.refreshInProgress,
            ),
    );

export const selectAuthError =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            auth.error,
    );

export const selectAuthErrors =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            auth.errors,
    );

export const selectLoginMethod =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            auth.loginMethod,
    );

export const selectLastLoginAt =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            auth.lastLoginAt,
    );

export const selectLastActivityAt =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            auth.lastActivityAt,
    );

export const selectStorageAvailable =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            Boolean(
                auth.storageAvailable,
            ),
    );

/* =============================================================================
 * Authorization Selectors
 * =============================================================================
 */

export const selectHasPermission =
    createSelector(
        [
            selectPermissions,
            (
                _state,
                permission,
            ) =>
                permission,
        ],
        (
            permissions,
            permission,
        ) =>
            Boolean(
                permission &&
                permissions.includes(
                    permission,
                ),
            ),
    );

export const selectHasAnyPermission =
    createSelector(
        [
            selectPermissions,
            (
                _state,
                permissions,
            ) =>
                permissions,
        ],
        (
            userPermissions,
            requiredPermissions,
        ) => {

            if (
                !Array.isArray(
                    requiredPermissions,
                )
            ) {
                return false;
            }

            return requiredPermissions.some(
                permission =>
                    userPermissions.includes(
                        permission,
                    ),
            );
        },
    );

export const selectHasAllPermissions =
    createSelector(
        [
            selectPermissions,
            (
                _state,
                permissions,
            ) =>
                permissions,
        ],
        (
            userPermissions,
            requiredPermissions,
        ) => {

            if (
                !Array.isArray(
                    requiredPermissions,
                )
            ) {
                return false;
            }

            return requiredPermissions.every(
                permission =>
                    userPermissions.includes(
                        permission,
                    ),
            );
        },
    );

export const selectHasFeature =
    createSelector(
        [
            selectFeatures,
            (
                _state,
                feature,
            ) =>
                feature,
        ],
        (
            features,
            feature,
        ) =>
            Boolean(
                feature &&
                features.includes(
                    feature,
                ),
            ),
    );

export const selectHasAnyFeature =
    createSelector(
        [
            selectFeatures,
            (
                _state,
                features,
            ) =>
                features,
        ],
        (
            userFeatures,
            requiredFeatures,
        ) => {

            if (
                !Array.isArray(
                    requiredFeatures,
                )
            ) {
                return false;
            }

            return requiredFeatures.some(
                feature =>
                    userFeatures.includes(
                        feature,
                    ),
            );
        },
    );

export const selectHasRole =
    createSelector(
        [
            selectRoles,
            (
                _state,
                role,
            ) =>
                role,
        ],
        (
            roles,
            role,
        ) =>
            Boolean(
                role &&
                roles.includes(
                    role,
                ),
            ),
    );

export const selectHasAnyRole =
    createSelector(
        [
            selectRoles,
            (
                _state,
                roles,
            ) =>
                roles,
        ],
        (
            userRoles,
            requiredRoles,
        ) => {

            if (
                !Array.isArray(
                    requiredRoles,
                )
            ) {
                return false;
            }

            return requiredRoles.some(
                role =>
                    userRoles.includes(
                        role,
                    ),
            );
        },
    );

export const selectIsTenantMember =
    createSelector(
        [
            selectTenant,
        ],
        tenantId =>
            Boolean(
                tenantId,
            ),
    );

/* =============================================================================
 * Session Readiness Selectors
 * =============================================================================
 */

export const selectSessionReady =
    createSelector(
        [
            selectAuthenticated,
            selectAuthInitialized,
            selectSessionExpired,
            selectUser,
        ],
        (
            authenticated,
            initialized,
            expired,
            user,
        ) =>
            Boolean(
                initialized &&
                authenticated &&
                !expired &&
                user,
            ),
    );

export const selectCanAuthenticate =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            !auth.loading &&
            !auth.refreshInProgress &&
            !auth.authenticated,
    );

export const selectSessionActive =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            auth.authenticated &&
            !auth.sessionExpired &&
            auth.status ===
                AUTH_STATUS
                    .AUTHENTICATED,
    );

/* =============================================================================
 * User identity selectors
 * =============================================================================
 */

export const selectUserId =
    createSelector(
        [
            selectUser,
        ],
        user =>
            user?.id ||
            user?._id ||
            null,
    );

export const selectUsername =
    createSelector(
        [
            selectUser,
        ],
        user =>
            user?.username ||
            user?.name ||
            null,
    );

export const selectUserEmail =
    createSelector(
        [
            selectUser,
        ],
        user =>
            user?.email ||
            null,
    );

/* =============================================================================
 * Combined authorization context
 * =============================================================================
 */

export const selectAuthorizationContext =
    createSelector(
        [
            selectUser,
            selectTenant,
            selectRoles,
            selectPermissions,
            selectFeatures,
            selectAuthenticated,
        ],
        (
            user,
            tenantId,
            roles,
            permissions,
            features,
            authenticated,
        ) =>
            ({
                authenticated,

                userId:
                    user?.id ||
                    user?._id ||
                    null,

                tenantId,

                roles: [
                    ...roles,
                ],

                permissions: [
                    ...permissions,
                ],

                features: [
                    ...features,
                ],
            }),
    );

/* =============================================================================
 * Security-oriented selectors
 * =============================================================================
 */

export const selectNeedsReauthentication =
    createSelector(
        [
            selectSessionExpired,
            selectAuthenticated,
            selectAuthStatus,
        ],
        (
            expired,
            authenticated,
            status,
        ) =>
            expired ||
            (
                !authenticated &&
                [
                    AUTH_STATUS.EXPIRED,
                    AUTH_STATUS.FAILED,
                ].includes(
                    status,
                )
            ),
    );

export const selectAuthSummary =
    createSelector(
        [
            selectAuth,
        ],
        auth =>
            ({
                initialized:
                    auth.initialized,

                authenticated:
                    auth.authenticated,

                status:
                    auth.status,

                loading:
                    auth.loading,

                refreshInProgress:
                    auth.refreshInProgress,

                sessionExpired:
                    auth.sessionExpired,

                tenantId:
                    auth.tenantId,

                userId:
                    auth.metadata
                        .userId,

                loginMethod:
                    auth.loginMethod,

                rolesCount:
                    auth.roles.length,

                permissionsCount:
                    auth.permissions.length,

                featuresCount:
                    auth.features.length,

                storageAvailable:
                    auth.storageAvailable,

                lastLoginAt:
                    auth.lastLoginAt,

                lastActivityAt:
                    auth.lastActivityAt,

                lastStorageSyncAt:
                    auth.lastStorageSyncAt,

                hasError:
                    Boolean(
                        auth.error,
                    ),
            }),
    );

/* =============================================================================
 * Reducer
 * =============================================================================
 */

export default
    authSlice.reducer;