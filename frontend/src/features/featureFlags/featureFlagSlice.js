// ============================================================================
// TITech Community Capital
// Enterprise Feature Flags Slice
// File: frontend/src/features/featureFlags/featureFlagSlice.js
// Production Grade
// ============================================================================

import {
    createSelector,
    createSlice,
} from "@reduxjs/toolkit";

// ============================================================================
// Default Feature Flags
// ============================================================================

export const DEFAULT_FEATURE_FLAGS =
    Object.freeze({

        // ---------------------------------------------------------------------
        // Core Platform
        // ---------------------------------------------------------------------

        dashboard:
            true,

        notifications:
            true,

        reports:
            true,

        auditLogs:
            true,

        analytics:
            true,

        // ---------------------------------------------------------------------
        // Financial Services
        // ---------------------------------------------------------------------

        savings:
            true,

        loans:
            true,

        wallets:
            true,

        transactions:
            true,

        accounting:
            true,

        mobileMoney:
            true,

        // ---------------------------------------------------------------------
        // Advanced Modules
        // ---------------------------------------------------------------------

        ussd:
            true,

        fraudDetection:
            true,

        riskScoring:
            true,

        executiveDashboard:
            true,

        regulatoryReporting:
            true,

        documentStorage:
            true,

        reportExport:
            true,

        // ---------------------------------------------------------------------
        // Administration
        // ---------------------------------------------------------------------

        userManagement:
            true,

        roleManagement:
            true,

        tenantManagement:
            true,

        featureManagement:
            true,

        systemHealth:
            true,

        metrics:
            true,

        // ---------------------------------------------------------------------
        // Communication
        // ---------------------------------------------------------------------

        sms:
            true,

        email:
            true,

        pushNotifications:
            true,

        realtimeNotifications:
            true,

        // ---------------------------------------------------------------------
        // Experimental
        // ---------------------------------------------------------------------

        aiAssistant:
            false,

        predictiveAnalytics:
            false,

        chatbot:
            false,

        betaFeatures:
            false,
    });

// ============================================================================
// Flag Groups
// ============================================================================

export const FEATURE_FLAG_GROUPS =
    Object.freeze({

        CORE: [
            "dashboard",
            "notifications",
            "reports",
            "auditLogs",
            "analytics",
        ],

        FINANCIAL: [
            "savings",
            "loans",
            "wallets",
            "transactions",
            "accounting",
            "mobileMoney",
        ],

        ADVANCED: [
            "ussd",
            "fraudDetection",
            "riskScoring",
            "executiveDashboard",
            "regulatoryReporting",
            "documentStorage",
            "reportExport",
        ],

        ADMINISTRATION: [
            "userManagement",
            "roleManagement",
            "tenantManagement",
            "featureManagement",
            "systemHealth",
            "metrics",
        ],

        COMMUNICATION: [
            "sms",
            "email",
            "pushNotifications",
            "realtimeNotifications",
        ],

        EXPERIMENTAL: [
            "aiAssistant",
            "predictiveAnalytics",
            "chatbot",
            "betaFeatures",
        ],
    });

export const FEATURE_FLAG_SOURCES =
    Object.freeze({
        DEFAULT:
            "default",

        ENVIRONMENT:
            "environment",

        REMOTE:
            "remote",

        TENANT:
            "tenant",

        USER:
            "user",

        IMPORT:
            "import",

        LOCAL:
            "local",
    });

export const FEATURE_FLAG_STATUS =
    Object.freeze({
        IDLE:
            "idle",

        LOADING:
            "loading",

        READY:
            "ready",

        SYNCING:
            "syncing",

        FAILED:
            "failed",

    });

const MAX_HISTORY =
    100;

const MAX_ERROR_HISTORY =
    25;

// ============================================================================
// Runtime Environment
// ============================================================================

const RUNTIME_ENVIRONMENT =
    import.meta?.env?.MODE ||
    "development";

const APPLICATION_VERSION =
    import.meta?.env?.VITE_APP_VERSION ||
    "1.0.0";

// ============================================================================
// Helpers
// ============================================================================

function nowIso() {
    return new Date().toISOString();
}

function normalizeFeatureName(
    feature,
) {
    if (
        feature ===
            undefined ||
        feature ===
            null
    ) {
        return null;
    }

    const normalized =
        String(feature).trim();

    return normalized ||
        null;
}

function normalizeBoolean(
    value,
    fallback = false,
) {
    if (
        typeof value ===
        "boolean"
    ) {
        return value;
    }

    if (
        value ===
            1 ||
        value ===
            "1" ||
        String(value)
            .toLowerCase()
            .trim() ===
            "true"
    ) {
        return true;
    }

    if (
        value ===
            0 ||
        value ===
            "0" ||
        String(value)
            .toLowerCase()
            .trim() ===
            "false"
    ) {
        return false;
    }

    return fallback;
}

function normalizeFlags(
    flags,
) {
    if (
        !flags ||
        typeof flags !==
            "object" ||
        Array.isArray(flags)
    ) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(
            flags,
        )
            .filter(
                ([
                    feature,
                ]) =>
                    Boolean(
                        normalizeFeatureName(
                            feature,
                        ),
                    ),
            )
            .map(
                ([
                    feature,
                    enabled,
                ]) => [
                    feature,
                    normalizeBoolean(
                        enabled,
                    ),
                ],
            ),
    );
}

function normalizeError(
    error,
) {
    if (!error) {
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
                "FEATURE_FLAG_ERROR",

            message:
                error,

            timestamp:
                nowIso(),
        };
    }

    const source =
        error?.response?.data &&
        typeof error.response.data ===
            "object"
            ? error.response.data
            : error;

    return {
        name:
            source?.name ||
            error?.name ||
            "Error",

        code:
            source?.code ||
            error?.code ||
            "FEATURE_FLAG_ERROR",

        message:
            source?.message ||
            source?.error ||
            error?.message ||
            "Feature flag operation failed.",

        statusCode:
            error?.response?.status ??
            source?.statusCode ??
            null,

        retryable:
            Boolean(
                source?.retryable ??
                error?.retryable,
            ),

        timestamp:
            nowIso(),
    };
}

function trimHistory(
    history,
) {
    if (
        !Array.isArray(
            history,
        )
    ) {
        return [];
    }

    return history.slice(
        0,
        MAX_HISTORY,
    );
}

function trimErrors(
    errors,
) {
    if (
        !Array.isArray(
            errors,
        )
    ) {
        return [];
    }

    return errors.slice(
        0,
        MAX_ERROR_HISTORY,
    );
}

function addHistory(
    state,
    {
        feature,
        enabled,
        source,
        actor,
        reason,
    },
) {
    const normalizedFeature =
        normalizeFeatureName(
            feature,
        );

    if (
        !normalizedFeature
    ) {
        return;
    }

    state.history.unshift({
        id:
            `${normalizedFeature}:${Date.now()}:${Math.random()
                .toString(36)
                .slice(2, 8)}`,

        feature:
            normalizedFeature,

        enabled:
            Boolean(
                enabled,
            ),

        source:
            source ||
            FEATURE_FLAG_SOURCES.LOCAL,

        actor:
            actor ||
            null,

        reason:
            reason ||
            null,

        timestamp:
            nowIso(),
    });

    state.history =
        trimHistory(
            state.history,
        );
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

    state.errorHistory.unshift(
        normalized,
    );

    state.errorHistory =
        trimErrors(
            state.errorHistory,
        );
}

function markUpdated(
    state,
) {
    state.metadata.updatedAt =
        nowIso();
}

// ============================================================================
// Initial State
// ============================================================================

function createInitialState() {
    return {
        initialized:
            false,

        flags: {
            ...DEFAULT_FEATURE_FLAGS,
        },

        metadata: {

            environment:
                RUNTIME_ENVIRONMENT,

            version:
                APPLICATION_VERSION,

            loadedAt:
                null,

            updatedAt:
                null,

            source:
                FEATURE_FLAG_SOURCES.DEFAULT,

            revision:
                0,

            etag:
                null,

            tenantId:
                null,

            userId:
                null,

        },

        status:
            FEATURE_FLAG_STATUS.IDLE,

        loading:
            false,

        syncing:
            false,

        error:
            null,

        errorHistory:
            [],

        history:
            [],

        overrides: {

            tenant:
                {},

            user:
                {},

        },

        stale:
            false,

        lastSyncAt:
            null,

        lastSuccessfulSyncAt:
            null,
    };
}

const initialState =
    createInitialState();

// ============================================================================
// Slice
// ============================================================================

const featureFlagSlice =
    createSlice({

        name:
            "featureFlags",

        initialState,

        reducers: {

            // ------------------------------------------------------------------
            // Initialization
            // ------------------------------------------------------------------

            initializeFeatureFlags(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                state.initialized =
                    true;

                state.status =
                    FEATURE_FLAG_STATUS
                        .READY;

                state.loading =
                    false;

                state.metadata.loadedAt =
                    nowIso();

                if (
                    payload.flags
                ) {
                    state.flags =
                        {
                            ...state.flags,
                            ...normalizeFlags(
                                payload.flags,
                            ),
                        };
                } else if (
                    payload &&
                    typeof payload ===
                        "object" &&
                    !Array.isArray(
                        payload,
                    )
                ) {
                    /**
                     * Backward compatibility:
                     *
                     * initializeFeatureFlags({
                     *   dashboard: true
                     * })
                     */
                    state.flags =
                        {
                            ...state.flags,
                            ...normalizeFlags(
                                payload,
                            ),
                        };
                }

                state.metadata =
                    {
                        ...state.metadata,

                        ...(payload.metadata ||
                            {}),

                        loadedAt:
                            state.metadata
                                .loadedAt,

                        source:
                            payload.metadata
                                ?.source ||
                            FEATURE_FLAG_SOURCES
                                .LOCAL,

                    };

                markUpdated(
                    state,
                );
            },

            hydrateFeatureFlags(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                if (
                    payload.flags
                ) {
                    state.flags =
                        {
                            ...state.flags,
                            ...normalizeFlags(
                                payload.flags,
                            ),
                        };
                }

                if (
                    payload.metadata
                ) {
                    state.metadata =
                        {
                            ...state.metadata,
                            ...payload.metadata,
                        };
                }

                if (
                    payload.overrides
                ) {
                    state.overrides =
                        {
                            ...state.overrides,
                            ...payload.overrides,
                        };
                }

                state.initialized =
                    true;

                state.stale =
                    Boolean(
                        payload.stale,
                    );

                state.status =
                    FEATURE_FLAG_STATUS
                        .READY;

                state.metadata.loadedAt =
                    state.metadata
                        .loadedAt ||
                    nowIso();

                markUpdated(
                    state,
                );
            },

            resetFeatureFlags(
                state,
            ) {
                const defaults =
                    createInitialState();

                const environment =
                    state.metadata
                        .environment;

                const version =
                    state.metadata
                        .version;

                return {
                    ...defaults,

                    metadata: {
                        ...defaults.metadata,

                        environment,

                        version,

                        loadedAt:
                            nowIso(),

                        updatedAt:
                            nowIso(),

                        source:
                            FEATURE_FLAG_SOURCES
                                .DEFAULT,

                    },

                    initialized:
                        true,

                };
            },

            // ------------------------------------------------------------------
            // Loading / synchronization
            // ------------------------------------------------------------------

            setFeatureLoading(
                state,
                action,
            ) {
                state.loading =
                    Boolean(
                        action.payload,
                    );

                state.status =
                    state.loading
                        ? FEATURE_FLAG_STATUS
                            .LOADING
                        : (
                            state.syncing
                                ? FEATURE_FLAG_STATUS
                                    .SYNCING
                                : FEATURE_FLAG_STATUS
                                    .READY
                        );

                markUpdated(
                    state,
                );
            },

            setFeatureSyncing(
                state,
                action,
            ) {
                state.syncing =
                    Boolean(
                        action.payload,
                    );

                state.status =
                    state.syncing
                        ? FEATURE_FLAG_STATUS
                            .SYNCING
                        : (
                            state.error
                                ? FEATURE_FLAG_STATUS
                                    .FAILED
                                : FEATURE_FLAG_STATUS
                                    .READY
                        );

                markUpdated(
                    state,
                );
            },

            setFeatureError(
                state,
                action,
            ) {
                addError(
                    state,
                    action.payload,
                );

                state.status =
                    FEATURE_FLAG_STATUS
                        .FAILED;

                state.loading =
                    false;

                state.syncing =
                    false;

                markUpdated(
                    state,
                );
            },

            clearFeatureError(
                state,
            ) {
                state.error =
                    null;

                if (
                    state.initialized
                ) {
                    state.status =
                        FEATURE_FLAG_STATUS
                            .READY;
                }

                markUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Single feature operations
            // ------------------------------------------------------------------

            enableFeature(
                state,
                action,
            ) {
                const feature =
                    normalizeFeatureName(
                        typeof action.payload ===
                            "object"
                            ? action.payload
                                ?.feature
                            : action.payload,
                    );

                if (
                    !feature
                ) {
                    return;
                }

                state.flags[
                    feature
                ] =
                    true;

                addHistory(
                    state,
                    {
                        feature,
                        enabled:
                            true,

                        source:
                            typeof action.payload ===
                                "object"
                                ? action.payload
                                    ?.source
                                : FEATURE_FLAG_SOURCES
                                    .LOCAL,

                        actor:
                            typeof action.payload ===
                                "object"
                                ? action.payload
                                    ?.actor
                                : null,

                        reason:
                            typeof action.payload ===
                                "object"
                                ? action.payload
                                    ?.reason
                                : null,
                    },
                );

                markUpdated(
                    state,
                );
            },

            disableFeature(
                state,
                action,
            ) {
                const feature =
                    normalizeFeatureName(
                        typeof action.payload ===
                            "object"
                            ? action.payload
                                ?.feature
                            : action.payload,
                    );

                if (
                    !feature
                ) {
                    return;
                }

                state.flags[
                    feature
                ] =
                    false;

                addHistory(
                    state,
                    {
                        feature,
                        enabled:
                            false,

                        source:
                            typeof action.payload ===
                                "object"
                                ? action.payload
                                    ?.source
                                : FEATURE_FLAG_SOURCES
                                    .LOCAL,

                        actor:
                            typeof action.payload ===
                                "object"
                                ? action.payload
                                    ?.actor
                                : null,

                        reason:
                            typeof action.payload ===
                                "object"
                                ? action.payload
                                    ?.reason
                                : null,
                    },
                );

                markUpdated(
                    state,
                );
            },

            toggleFeature(
                state,
                action,
            ) {
                const feature =
                    normalizeFeatureName(
                        action.payload,
                    );

                if (
                    !feature
                ) {
                    return;
                }

                const current =
                    Boolean(
                        state.flags[
                            feature
                        ],
                    );

                const next =
                    !current;

                state.flags[
                    feature
                ] =
                    next;

                addHistory(
                    state,
                    {
                        feature,
                        enabled:
                            next,

                        source:
                            FEATURE_FLAG_SOURCES
                                .LOCAL,

                        reason:
                            "feature_toggled",
                    },
                );

                markUpdated(
                    state,
                );
            },

            setFeature(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const feature =
                    normalizeFeatureName(
                        payload.feature,
                    );

                if (
                    !feature
                ) {
                    return;
                }

                const enabled =
                    normalizeBoolean(
                        payload.enabled,
                    );

                state.flags[
                    feature
                ] =
                    enabled;

                addHistory(
                    state,
                    {
                        feature,
                        enabled,

                        source:
                            payload.source ||
                            FEATURE_FLAG_SOURCES
                                .LOCAL,

                        actor:
                            payload.actor ||
                            null,

                        reason:
                            payload.reason ||
                            null,
                    },
                );

                markUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Bulk operations
            // ------------------------------------------------------------------

            setFeatures(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const flags =
                    payload.flags ||
                    payload;

                state.flags =
                    {
                        ...state.flags,
                        ...normalizeFlags(
                            flags,
                        ),
                    };

                state.metadata.loadedAt =
                    nowIso();

                state.metadata.source =
                    payload.source ||
                    FEATURE_FLAG_SOURCES
                        .LOCAL;

                state.metadata.revision =
                    Number(
                        payload.revision ??
                        state.metadata
                            .revision +
                        1,
                    );

                markUpdated(
                    state,
                );
            },

            enableFeatures(
                state,
                action,
            ) {
                const features =
                    Array.isArray(
                        action.payload,
                    )
                        ? action.payload
                        : [];

                for (
                    const feature of
                    features
                ) {
                    const normalized =
                        normalizeFeatureName(
                            typeof feature ===
                                "object"
                                ? feature
                                    ?.feature
                                : feature,
                        );

                    if (
                        normalized
                    ) {
                        state.flags[
                            normalized
                        ] =
                            true;
                    }
                }

                markUpdated(
                    state,
                );
            },

            disableFeatures(
                state,
                action,
            ) {
                const features =
                    Array.isArray(
                        action.payload,
                    )
                        ? action.payload
                        : [];

                for (
                    const feature of
                    features
                ) {
                    const normalized =
                        normalizeFeatureName(
                            typeof feature ===
                                "object"
                                ? feature
                                    ?.feature
                                : feature,
                        );

                    if (
                        normalized
                    ) {
                        state.flags[
                            normalized
                        ] =
                            false;
                    }
                }

                markUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Environment / source
            // ------------------------------------------------------------------

            setFeatureEnvironment(
                state,
                action,
            ) {
                state.metadata.environment =
                    String(
                        action.payload ||
                        RUNTIME_ENVIRONMENT,
                    ).trim();

                markUpdated(
                    state,
                );
            },

            setFeatureSource(
                state,
                action,
            ) {
                state.metadata.source =
                    String(
                        action.payload ||
                        FEATURE_FLAG_SOURCES
                            .LOCAL,
                    ).trim();

                markUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Tenant / user overrides
            // ------------------------------------------------------------------

            setTenantFeatureOverride(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const feature =
                    normalizeFeatureName(
                        payload.feature,
                    );

                if (
                    !feature
                ) {
                    return;
                }

                state.overrides.tenant[
                    feature
                ] =
                    normalizeBoolean(
                        payload.enabled,
                    );

                markUpdated(
                    state,
                );
            },

            setUserFeatureOverride(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const feature =
                    normalizeFeatureName(
                        payload.feature,
                    );

                if (
                    !feature
                ) {
                    return;
                }

                state.overrides.user[
                    feature
                ] =
                    normalizeBoolean(
                        payload.enabled,
                    );

                markUpdated(
                    state,
                );
            },

            setTenantFeatureOverrides(
                state,
                action,
            ) {
                state.overrides.tenant =
                    {
                        ...state.overrides.tenant,
                        ...normalizeFlags(
                            action.payload,
                        ),
                    };

                markUpdated(
                    state,
                );
            },

            setUserFeatureOverrides(
                state,
                action,
            ) {
                state.overrides.user =
                    {
                        ...state.overrides.user,
                        ...normalizeFlags(
                            action.payload,
                        ),
                    };

                markUpdated(
                    state,
                );
            },

            clearTenantFeatureOverrides(
                state,
            ) {
                state.overrides.tenant =
                    {};

                markUpdated(
                    state,
                );
            },

            clearUserFeatureOverrides(
                state,
            ) {
                state.overrides.user =
                    {};

                markUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Metadata
            // ------------------------------------------------------------------

            setFeatureMetadata(
                state,
                action,
            ) {
                state.metadata =
                    {
                        ...state.metadata,
                        ...(action.payload ||
                            {}),
                    };

                markUpdated(
                    state,
                );
            },

            setFeatureStale(
                state,
                action,
            ) {
                state.stale =
                    Boolean(
                        action.payload,
                    );

                markUpdated(
                    state,
                );
            },

            markFeatureSyncSuccess(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                state.syncing =
                    false;

                state.loading =
                    false;

                state.status =
                    FEATURE_FLAG_STATUS
                        .READY;

                state.stale =
                    false;

                state.lastSyncAt =
                    nowIso();

                state.lastSuccessfulSyncAt =
                    nowIso();

                if (
                    payload.revision !==
                    undefined
                ) {
                    state.metadata.revision =
                        payload.revision;
                }

                if (
                    payload.etag
                ) {
                    state.metadata.etag =
                        payload.etag;
                }

                if (
                    payload.source
                ) {
                    state.metadata.source =
                        payload.source;
                }

                markUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Import / export
            // ------------------------------------------------------------------

            importFeatureFlags(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const flags =
                    payload.flags ||
                    payload;

                state.flags =
                    {
                        ...DEFAULT_FEATURE_FLAGS,

                        ...normalizeFlags(
                            flags,
                        ),
                    };

                state.metadata =
                    {
                        ...state.metadata,

                        source:
                            FEATURE_FLAG_SOURCES
                                .IMPORT,

                        loadedAt:
                            nowIso(),

                        revision:
                            Number(
                                payload.revision ??
                                state.metadata
                                    .revision +
                                1,
                            ),

                    };

                state.initialized =
                    true;

                state.status =
                    FEATURE_FLAG_STATUS
                        .READY;

                markUpdated(
                    state,
                );
            },

            restoreDefaults(
                state,
            ) {
                state.flags =
                    {
                        ...DEFAULT_FEATURE_FLAGS,
                    };

                state.metadata.source =
                    FEATURE_FLAG_SOURCES
                        .DEFAULT;

                state.metadata.revision +=
                    1;

                state.metadata.loadedAt =
                    nowIso();

                state.stale =
                    false;

                state.error =
                    null;

                state.status =
                    FEATURE_FLAG_STATUS
                        .READY;

                markUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // History
            // ------------------------------------------------------------------

            clearFeatureHistory(
                state,
            ) {
                state.history =
                    [];

                markUpdated(
                    state,
                );
            },

        },
    });

// ============================================================================
// Actions
// ============================================================================

export const {
    initializeFeatureFlags,
    hydrateFeatureFlags,
    resetFeatureFlags,

    setFeatureLoading,
    setFeatureSyncing,
    setFeatureError,
    clearFeatureError,

    enableFeature,
    disableFeature,
    toggleFeature,
    setFeature,

    setFeatures,
    enableFeatures,
    disableFeatures,

    setFeatureEnvironment,
    setFeatureSource,

    setTenantFeatureOverride,
    setUserFeatureOverride,
    setTenantFeatureOverrides,
    setUserFeatureOverrides,
    clearTenantFeatureOverrides,
    clearUserFeatureOverrides,

    setFeatureMetadata,
    setFeatureStale,
    markFeatureSyncSuccess,

    importFeatureFlags,
    restoreDefaults,

    clearFeatureHistory,

} =
    featureFlagSlice.actions;

// ============================================================================
// Base Selectors
// ============================================================================

export const selectFeatureFlags =
    state =>
        state?.featureFlags ||
        createInitialState();

export const selectFlags =
    createSelector(
        [
            selectFeatureFlags,
        ],
        featureFlags =>
            featureFlags.flags,
    );

export const selectFeatureMetadata =
    createSelector(
        [
            selectFeatureFlags,
        ],
        featureFlags =>
            featureFlags.metadata,
    );

export const selectFeatureHistory =
    createSelector(
        [
            selectFeatureFlags,
        ],
        featureFlags =>
            featureFlags.history,
    );

export const selectFeatureLoading =
    createSelector(
        [
            selectFeatureFlags,
        ],
        featureFlags =>
            featureFlags.loading,
    );

export const selectFeatureSyncing =
    createSelector(
        [
            selectFeatureFlags,
        ],
        featureFlags =>
            featureFlags.syncing,
    );

export const selectFeatureError =
    createSelector(
        [
            selectFeatureFlags,
        ],
        featureFlags =>
            featureFlags.error,
    );

export const selectFeatureErrorHistory =
    createSelector(
        [
            selectFeatureFlags,
        ],
        featureFlags =>
            featureFlags.errorHistory,
    );

export const selectFeatureStatus =
    createSelector(
        [
            selectFeatureFlags,
        ],
        featureFlags =>
            featureFlags.status,
    );

export const selectFeatureInitialized =
    createSelector(
        [
            selectFeatureFlags,
        ],
        featureFlags =>
            featureFlags.initialized,
    );

export const selectFeatureStale =
    createSelector(
        [
            selectFeatureFlags,
        ],
        featureFlags =>
            featureFlags.stale,
    );

export const selectFeatureOverrides =
    createSelector(
        [
            selectFeatureFlags,
        ],
        featureFlags =>
            featureFlags.overrides,
    );

// ============================================================================
// Dynamic Feature Selector
// ============================================================================

export const makeSelectFeature =
    feature =>
        createSelector(
            [
                selectFeatureFlags,
            ],
            featureFlags => {

                const normalized =
                    normalizeFeatureName(
                        feature,
                    );

                if (
                    !normalized
                ) {
                    return false;
                }

                /**
                 * Explicit user override has highest client-side precedence,
                 * followed by tenant override, followed by the effective flag.
                 *
                 * The authoritative backend must still enforce access.
                 */
                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            featureFlags
                                .overrides
                                .user,
                            normalized,
                        )
                ) {
                    return Boolean(
                        featureFlags
                            .overrides
                            .user[
                                normalized
                            ],
                    );
                }

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            featureFlags
                                .overrides
                                .tenant,
                            normalized,
                        )
                ) {
                    return Boolean(
                        featureFlags
                            .overrides
                            .tenant[
                                normalized
                            ],
                    );
                }

                return Boolean(
                    featureFlags.flags[
                        normalized
                    ],
                );
            },
        );

// ============================================================================
// Common Feature Selectors
// ============================================================================

export const selectDashboardFeature =
    makeSelectFeature(
        "dashboard",
    );

export const selectNotificationsFeature =
    makeSelectFeature(
        "notifications",
    );

export const selectReportsFeature =
    makeSelectFeature(
        "reports",
    );

export const selectAuditLogsFeature =
    makeSelectFeature(
        "auditLogs",
    );

export const selectAnalyticsFeature =
    makeSelectFeature(
        "analytics",
    );

export const selectSavingsFeature =
    makeSelectFeature(
        "savings",
    );

export const selectLoansFeature =
    makeSelectFeature(
        "loans",
    );

export const selectWalletFeature =
    makeSelectFeature(
        "wallets",
    );

export const selectTransactionsFeature =
    makeSelectFeature(
        "transactions",
    );

export const selectAccountingFeature =
    makeSelectFeature(
        "accounting",
    );

export const selectMobileMoneyFeature =
    makeSelectFeature(
        "mobileMoney",
    );

export const selectUSSDFeature =
    makeSelectFeature(
        "ussd",
    );

export const selectFraudFeature =
    makeSelectFeature(
        "fraudDetection",
    );

export const selectRiskScoringFeature =
    makeSelectFeature(
        "riskScoring",
    );

export const selectExecutiveDashboardFeature =
    makeSelectFeature(
        "executiveDashboard",
    );

export const selectRegulatoryReportingFeature =
    makeSelectFeature(
        "regulatoryReporting",
    );

export const selectDocumentStorageFeature =
    makeSelectFeature(
        "documentStorage",
    );

export const selectReportExportFeature =
    makeSelectFeature(
        "reportExport",
    );

export const selectUserManagementFeature =
    makeSelectFeature(
        "userManagement",
    );

export const selectRoleManagementFeature =
    makeSelectFeature(
        "roleManagement",
    );

export const selectTenantManagementFeature =
    makeSelectFeature(
        "tenantManagement",
    );

export const selectFeatureManagementFeature =
    makeSelectFeature(
        "featureManagement",
    );

export const selectSystemHealthFeature =
    makeSelectFeature(
        "systemHealth",
    );

export const selectMetricsFeature =
    makeSelectFeature(
        "metrics",
    );

export const selectSMSFeature =
    makeSelectFeature(
        "sms",
    );

export const selectEmailFeature =
    makeSelectFeature(
        "email",
    );

export const selectPushNotificationsFeature =
    makeSelectFeature(
        "pushNotifications",
    );

export const selectRealtimeNotificationsFeature =
    makeSelectFeature(
        "realtimeNotifications",
    );

export const selectAIAssistantFeature =
    makeSelectFeature(
        "aiAssistant",
    );

export const selectPredictiveAnalyticsFeature =
    makeSelectFeature(
        "predictiveAnalytics",
    );

export const selectChatbotFeature =
    makeSelectFeature(
        "chatbot",
    );

export const selectBetaFeatures =
    makeSelectFeature(
        "betaFeatures",
    );

// ============================================================================
// Group Selectors
// ============================================================================

export const makeSelectFeatureGroup =
    groupName =>
        createSelector(
            [
                selectFeatureFlags,
            ],
            featureFlags => {

                const features =
                    FEATURE_FLAG_GROUPS[
                        groupName
                    ] ||
                    [];

                return Object.fromEntries(
                    features.map(
                        feature => [
                            feature,

                            Boolean(
                                featureFlags
                                    .flags[
                                    feature
                                ],
                            ),
                        ],
                    ),
                );
            },
        );

export const selectCoreFeatures =
    makeSelectFeatureGroup(
        "CORE",
    );

export const selectFinancialFeatures =
    makeSelectFeatureGroup(
        "FINANCIAL",
    );

export const selectAdvancedFeatures =
    makeSelectFeatureGroup(
        "ADVANCED",
    );

export const selectAdministrationFeatures =
    makeSelectFeatureGroup(
        "ADMINISTRATION",
    );

export const selectCommunicationFeatures =
    makeSelectFeatureGroup(
        "COMMUNICATION",
    );

export const selectExperimentalFeatures =
    makeSelectFeatureGroup(
        "EXPERIMENTAL",
    );

// ============================================================================
// Utility Helpers
// ============================================================================

export const isFeatureEnabled =
    (
        state,
        feature,
    ) =>
        makeSelectFeature(
            feature,
        )(
            state,
        );

export const getEnabledFeatures =
    state =>
        Object.entries(
            selectFlags(
                state,
            ),
        )
            .filter(
                ([
                    ,
                    enabled,
                ]) =>
                    Boolean(
                        enabled,
                    ),
            )
            .map(
                ([
                    feature,
                ]) =>
                    feature,
            );

export const getDisabledFeatures =
    state =>
        Object.entries(
            selectFlags(
                state,
            ),
        )
            .filter(
                ([
                    ,
                    enabled,
                ]) =>
                    !Boolean(
                        enabled,
                    ),
            )
            .map(
                ([
                    feature,
                ]) =>
                    feature,
            );

export const getUnknownFeatures =
    state => {

        const flags =
            selectFlags(
                state,
            );

        return Object.keys(
            flags,
        ).filter(
            feature =>
                !Object.prototype
                    .hasOwnProperty
                    .call(
                        DEFAULT_FEATURE_FLAGS,
                        feature,
                    ),
        );
    };

export const getFeatureCount =
    state =>
        Object.keys(
            selectFlags(
                state,
            ),
        ).length;

export const getEnabledFeatureCount =
    state =>
        getEnabledFeatures(
            state,
        ).length;

export const getDisabledFeatureCount =
    state =>
        getDisabledFeatures(
            state,
        ).length;

// ============================================================================
// Effective Feature State
// ============================================================================

export const selectEffectiveFlags =
    createSelector(
        [
            selectFeatureFlags,
        ],
        featureFlags => {

            const effective = {
                ...featureFlags.flags,
            };

            Object.entries(
                featureFlags
                    .overrides
                    .tenant,
            ).forEach(
                ([
                    feature,
                    enabled,
                ]) => {

                    effective[
                        feature
                    ] =
                        Boolean(
                            enabled,
                        );
                },
            );

            Object.entries(
                featureFlags
                    .overrides
                    .user,
            ).forEach(
                ([
                    feature,
                    enabled,
                ]) => {

                    effective[
                        feature
                    ] =
                        Boolean(
                            enabled,
                        );
                },
            );

            return effective;
        },
    );

export const selectFeatureSummary =
    createSelector(
        [
            selectFeatureFlags,
            selectEffectiveFlags,
        ],
        (
            featureFlags,
            effectiveFlags,
        ) => {

            const entries =
                Object.entries(
                    effectiveFlags,
                );

            return {
                initialized:
                    featureFlags
                        .initialized,

                status:
                    featureFlags
                        .status,

                loading:
                    featureFlags
                        .loading,

                syncing:
                    featureFlags
                        .syncing,

                stale:
                    featureFlags
                        .stale,

                source:
                    featureFlags
                        .metadata
                        .source,

                environment:
                    featureFlags
                        .metadata
                        .environment,

                revision:
                    featureFlags
                        .metadata
                        .revision,

                total:
                    entries.length,

                enabled:
                    entries.filter(
                        ([
                            ,
                            enabled,
                        ]) =>
                            Boolean(
                                enabled,
                            ),
                    ).length,

                disabled:
                    entries.filter(
                        ([
                            ,
                            enabled,
                        ]) =>
                            !Boolean(
                                enabled,
                            ),
                    ).length,

                tenantOverrides:
                    Object.keys(
                        featureFlags
                            .overrides
                            .tenant,
                    ).length,

                userOverrides:
                    Object.keys(
                        featureFlags
                            .overrides
                            .user,
                    ).length,

                lastSyncAt:
                    featureFlags
                        .lastSyncAt,

                lastSuccessfulSyncAt:
                    featureFlags
                        .lastSuccessfulSyncAt,

                hasError:
                    Boolean(
                        featureFlags
                            .error,
                    ),
            };
        },
    );

// ============================================================================
// Reducer
// ============================================================================

export default
    featureFlagSlice.reducer;