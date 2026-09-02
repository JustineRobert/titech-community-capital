// ============================================================================
// TITech Community Capital
// Enterprise Tenant Slice
// File: frontend/src/features/tenant/tenantSlice.js
// Production Grade
// ============================================================================
//
// Purpose
// ----------------------------------------------------------------------------
// Centralized tenant / organization context for the TITech frontend.
//
// Responsibilities
// ----------------------------------------------------------------------------
// ✓ Current tenant context
// ✓ Available tenant list
// ✓ Tenant switching lifecycle
// ✓ Tenant plan metadata
// ✓ Tenant feature metadata
// ✓ Tenant permission metadata
// ✓ Tenant statistics
// ✓ Tenant loading/synchronization state
// ✓ Tenant error handling
// ✓ Bounded collections
// ✓ Tenant lookup / authorization convenience selectors
// ✓ Serializable Redux state
//
// Security boundary
// ----------------------------------------------------------------------------
// Tenant state is client-side context, NOT authoritative authorization.
//
// The TITech backend remains authoritative for:
//   - tenant membership
//   - tenant status
//   - tenant isolation
//   - roles and permissions
//   - feature entitlement
//   - subscription/billing state
//   - financial authorization
//
// NEVER store tenant secrets, API credentials, payment credentials, private
// keys, JWTs, or refresh tokens in this slice.
// ============================================================================

import {
    createSelector,
    createSlice,
} from "@reduxjs/toolkit";

// ============================================================================
// Constants
// ============================================================================

export const TENANT_STATUS = Object.freeze({
    ACTIVE:
        "active",

    INACTIVE:
        "inactive",

    SUSPENDED:
        "suspended",

    PENDING:
        "pending",

    TRIAL:
        "trial",

    DEACTIVATED:
        "deactivated",
});

export const TENANT_SWITCH_STATUS =
    Object.freeze({
        IDLE:
            "idle",

        SWITCHING:
            "switching",

        SUCCESS:
            "success",

        FAILED:
            "failed",
    });

export const TENANT_SOURCE =
    Object.freeze({
        DEFAULT:
            "default",

        LOCAL:
            "local",

        REMOTE:
            "remote",

        SESSION:
            "session",
    });

const MAX_TENANTS =
    500;

const MAX_FEATURES =
    500;

const MAX_PERMISSIONS =
    1000;

const MAX_ERROR_HISTORY =
    25;

// ============================================================================
// Helpers
// ============================================================================

function nowIso() {
    return new Date().toISOString();
}

function normalizeString(
    value,
    fallback = null,
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return fallback;
    }

    const normalized =
        String(value).trim();

    return normalized ||
        fallback;
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
                    item =>
                        normalizeString(
                            item,
                        ),
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

function getTenantId(
    tenant,
) {
    return (
        tenant?.id ||
        tenant?._id ||
        tenant?.tenantId ||
        null
    );
}

function normalizeTenant(
    tenant,
) {
    if (
        !tenant ||
        typeof tenant !==
            "object"
    ) {
        return null;
    }

    const tenantId =
        getTenantId(
            tenant,
        );

    return {
        ...tenant,

        id:
            tenantId,

        tenantId:

            tenant.tenantId ||
            tenantId,

        name:
            normalizeString(
                tenant.name,
                "TITech Tenant",
            ),

        slug:
            normalizeString(
                tenant.slug,
            ),

        code:
            normalizeString(
                tenant.code,
            ),

        status:
            normalizeString(
                tenant.status,
                TENANT_STATUS.ACTIVE,
            ),

        plan:
            tenant.plan ||
            null,

        features:
            normalizeCollection(
                tenant.features,
                MAX_FEATURES,
            ),

        permissions:
            normalizeCollection(
                tenant.permissions,
                MAX_PERMISSIONS,
            ),

        createdAt:
            tenant.createdAt ||
            null,

        updatedAt:
            tenant.updatedAt ||
            null,
    };
}

function deduplicateTenants(
    tenants,
) {
    if (
        !Array.isArray(
            tenants,
        )
    ) {
        return [];
    }

    const map =
        new Map();

    for (
        const rawTenant of
        tenants
    ) {
        const tenant =
            normalizeTenant(
                rawTenant,
            );

        const id =
            getTenantId(
                tenant,
            );

        if (
            !tenant ||
            !id
        ) {
            continue;
        }

        if (
            !map.has(
                id,
            )
        ) {
            map.set(
                id,
                tenant,
            );
        }
    }

    return Array.from(
        map.values(),
    ).slice(
        0,
        MAX_TENANTS,
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
                "TENANT_ERROR",

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
            "TENANT_ERROR",

        message:
            source?.message ||
            source?.error ||
            error?.message ||
            "Tenant operation failed.",

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

function addErrorHistory(
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

    state.errorHistory =
        [
            normalized,
            ...state.errorHistory,
        ].slice(
            0,
            MAX_ERROR_HISTORY,
        );
}

function createInitialState() {
    return {
        currentTenant:
            null,

        tenants:
            [],

        loading:
            false,

        switching:
            false,

        initialized:
            false,

        status:
            TENANT_STATUS.INACTIVE,

        switchStatus:
            TENANT_SWITCH_STATUS.IDLE,

        error:
            null,

        errorHistory:
            [],

        statistics:
            null,

        lastTenantId:
            null,

        selectedPlan:
            null,

        features:
            [],

        permissions:
            [],

        source:
            TENANT_SOURCE.DEFAULT,

        lastFetchedAt:
            null,

        lastSwitchedAt:
            null,

        lastUpdatedAt:
            null,

        metadata: {
            userId:
                null,

            tenantCount:
                0,

            revision:
                0,
        },
    };
}

const initialState =
    createInitialState();

// ============================================================================
// Slice
// ============================================================================

const tenantSlice =
    createSlice({

        name:
            "tenant",

        initialState,

        reducers: {

            // ------------------------------------------------------------------
            // Initialization
            // ------------------------------------------------------------------

            initializeTenantState(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                state.initialized =
                    true;

                if (
                    payload.tenant
                ) {
                    const tenant =
                        normalizeTenant(
                            payload.tenant,
                        );

                    if (
                        tenant
                    ) {
                        state.currentTenant =
                            tenant;

                        state.lastTenantId =
                            getTenantId(
                                tenant,
                            );

                        state.features =
                            tenant.features;

                        state.permissions =
                            tenant.permissions;

                        state.selectedPlan =
                            tenant.plan;

                        state.status =
                            tenant.status;
                    }
                }

                if (
                    Array.isArray(
                        payload.tenants,
                    )
                ) {
                    state.tenants =
                        deduplicateTenants(
                            payload.tenants,
                        );

                    state.metadata
                        .tenantCount =
                        state.tenants.length;
                }

                state.source =
                    payload.source ||
                    TENANT_SOURCE.LOCAL;

                state.error =
                    null;
            },

            hydrateTenantState(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                if (
                    Array.isArray(
                        payload.tenants,
                    )
                ) {
                    state.tenants =
                        deduplicateTenants(
                            payload.tenants,
                        );
                }

                if (
                    payload.currentTenant
                ) {
                    const tenant =
                        normalizeTenant(
                            payload.currentTenant,
                        );

                    if (
                        tenant
                    ) {
                        state.currentTenant =
                            tenant;

                        state.lastTenantId =
                            getTenantId(
                                tenant,
                            );

                        state.selectedPlan =
                            tenant.plan;

                        state.features =
                            tenant.features;

                        state.permissions =
                            tenant.permissions;

                        state.status =
                            tenant.status;
                    }
                }

                if (
                    payload.statistics !==
                    undefined
                ) {
                    state.statistics =
                        payload.statistics;
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

                state.initialized =
                    true;

                state.source =
                    payload.source ||
                    TENANT_SOURCE.SESSION;

                state.lastFetchedAt =
                    payload.loadedAt ||
                    state.lastFetchedAt;

                state.metadata
                    .tenantCount =
                    state.tenants.length;
            },

            // ------------------------------------------------------------------
            // Loading
            // ------------------------------------------------------------------

            setTenantLoading(
                state,
                action,
            ) {
                state.loading =
                    Boolean(
                        action.payload,
                    );
            },

            setTenantSwitching(
                state,
                action,
            ) {
                state.switching =
                    Boolean(
                        action.payload,
                    );

                state.switchStatus =
                    state.switching
                        ? TENANT_SWITCH_STATUS
                            .SWITCHING
                        : state.switchStatus;
            },

            setTenantError(
                state,
                action,
            ) {
                addErrorHistory(
                    state,
                    action.payload,
                );

                state.loading =
                    false;

                state.switching =
                    false;

                state.switchStatus =
                    TENANT_SWITCH_STATUS
                        .FAILED;
            },

            clearTenantError(
                state,
            ) {
                state.error =
                    null;

                if (
                    state.switchStatus ===
                    TENANT_SWITCH_STATUS
                        .FAILED
                ) {
                    state.switchStatus =
                        TENANT_SWITCH_STATUS
                            .IDLE;
                }
            },

            clearTenantErrors(
                state,
            ) {
                state.error =
                    null;

                state.errorHistory =
                    [];

                if (
                    state.switchStatus ===
                    TENANT_SWITCH_STATUS
                        .FAILED
                ) {
                    state.switchStatus =
                        TENANT_SWITCH_STATUS
                            .IDLE;
                }
            },

            // ------------------------------------------------------------------
            // Current Tenant
            // ------------------------------------------------------------------

            setTenant(
                state,
                action,
            ) {
                const tenant =
                    normalizeTenant(
                        action.payload,
                    );

                if (
                    !tenant
                ) {
                    return;
                }

                state.currentTenant =
                    tenant;

                state.lastTenantId =
                    getTenantId(
                        tenant,
                    );

                state.features =
                    tenant.features;

                state.permissions =
                    tenant.permissions;

                state.selectedPlan =
                    tenant.plan;

                state.status =
                    tenant.status ||
                    TENANT_STATUS.ACTIVE;

                state.source =
                    TENANT_SOURCE.LOCAL;

                state.lastSwitchedAt =
                    nowIso();

                state.lastUpdatedAt =
                    nowIso();

                state.switchStatus =
                    TENANT_SWITCH_STATUS
                        .SUCCESS;

                state.switching =
                    false;

                state.error =
                    null;

                const existingIndex =
                    state.tenants.findIndex(
                        candidate =>
                            getTenantId(
                                candidate,
                            ) ===
                            getTenantId(
                                tenant,
                            ),
                    );

                if (
                    existingIndex ===
                    -1
                ) {
                    state.tenants =
                        [
                            tenant,
                            ...state.tenants,
                        ].slice(
                            0,
                            MAX_TENANTS,
                        );
                } else {
                    state.tenants[
                        existingIndex
                    ] =
                        {
                            ...state
                                .tenants[
                                existingIndex
                            ],
                            ...tenant,
                        };
                }

                state.metadata
                    .tenantCount =
                    state.tenants.length;
            },

            clearTenant(
                state,
            ) {
                state.currentTenant =
                    null;

                state.features =
                    [];

                state.permissions =
                    [];

                state.selectedPlan =
                    null;

                state.lastTenantId =
                    null;

                state.status =
                    TENANT_STATUS.INACTIVE;

                state.switchStatus =
                    TENANT_SWITCH_STATUS.IDLE;

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Tenant switching
            // ------------------------------------------------------------------

            beginTenantSwitch(
                state,
                action,
            ) {
                const tenantId =
                    typeof action.payload ===
                        "object"
                        ? (
                            action.payload
                                ?.tenantId ||
                            action.payload
                                ?.id
                        )
                        : action.payload;

                state.switching =
                    true;

                state.switchStatus =
                    TENANT_SWITCH_STATUS
                        .SWITCHING;

                state.error =
                    null;

                state.lastUpdatedAt =
                    nowIso();

                if (
                    tenantId
                ) {
                    state.lastTenantId =
                        normalizeString(
                            tenantId,
                        );
                }
            },

            completeTenantSwitch(
                state,
                action,
            ) {
                const tenant =
                    normalizeTenant(
                        action.payload,
                    );

                if (
                    !tenant
                ) {
                    return;
                }

                state.currentTenant =
                    tenant;

                state.lastTenantId =
                    getTenantId(
                        tenant,
                    );

                state.features =
                    tenant.features;

                state.permissions =
                    tenant.permissions;

                state.selectedPlan =
                    tenant.plan;

                state.status =
                    tenant.status ||
                    TENANT_STATUS.ACTIVE;

                state.switching =
                    false;

                state.switchStatus =
                    TENANT_SWITCH_STATUS
                        .SUCCESS;

                state.lastSwitchedAt =
                    nowIso();

                state.lastUpdatedAt =
                    nowIso();

                state.error =
                    null;
            },

            failTenantSwitch(
                state,
                action,
            ) {
                addErrorHistory(
                    state,
                    action.payload,
                );

                state.switching =
                    false;

                state.switchStatus =
                    TENANT_SWITCH_STATUS
                        .FAILED;
            },

            // ------------------------------------------------------------------
            // Tenant List
            // ------------------------------------------------------------------

            setTenants(
                state,
                action,
            ) {
                state.tenants =
                    deduplicateTenants(
                        action.payload ||
                        [],
                    );

                state.metadata
                    .tenantCount =
                    state.tenants.length;

                state.lastFetchedAt =
                    nowIso();

                state.loading =
                    false;

                state.initialized =
                    true;

                state.error =
                    null;

                state.lastUpdatedAt =
                    nowIso();
            },

            addTenant(
                state,
                action,
            ) {
                const tenant =
                    normalizeTenant(
                        action.payload,
                    );

                if (
                    !tenant
                ) {
                    return;
                }

                const id =
                    getTenantId(
                        tenant,
                    );

                const index =
                    state.tenants.findIndex(
                        candidate =>
                            getTenantId(
                                candidate,
                            ) === id,
                    );

                if (
                    index ===
                    -1
                ) {
                    state.tenants =
                        [
                            tenant,
                            ...state.tenants,
                        ].slice(
                            0,
                            MAX_TENANTS,
                        );
                } else {
                    state.tenants[
                        index
                    ] =
                        {
                            ...state
                                .tenants[
                                index
                            ],
                            ...tenant,
                        };
                }

                state.metadata
                    .tenantCount =
                    state.tenants.length;

                state.lastUpdatedAt =
                    nowIso();
            },

            updateTenant(
                state,
                action,
            ) {
                const tenant =
                    normalizeTenant(
                        action.payload,
                    );

                if (
                    !tenant
                ) {
                    return;
                }

                const tenantId =
                    getTenantId(
                        tenant,
                    );

                const index =
                    state.tenants.findIndex(
                        candidate =>
                            getTenantId(
                                candidate,
                            ) ===
                            tenantId,
                    );

                if (
                    index !==
                    -1
                ) {
                    state.tenants[
                        index
                    ] =
                        {
                            ...state
                                .tenants[
                                index
                            ],
                            ...tenant,
                        };
                } else {
                    state.tenants =
                        [
                            tenant,
                            ...state.tenants,
                        ].slice(
                            0,
                            MAX_TENANTS,
                        );
                }

                if (
                    state.currentTenant &&
                    getTenantId(
                        state.currentTenant,
                    ) ===
                    tenantId
                ) {
                    state.currentTenant =
                        {
                            ...state
                                .currentTenant,
                            ...tenant,
                        };

                    state.features =
                        tenant.features;

                    state.permissions =
                        tenant.permissions;

                    state.selectedPlan =
                        tenant.plan;

                    state.status =
                        tenant.status ||
                        state.status;
                }

                state.metadata
                    .tenantCount =
                    state.tenants.length;

                state.lastUpdatedAt =
                    nowIso();
            },

            removeTenant(
                state,
                action,
            ) {
                const tenantId =
                    typeof action.payload ===
                        "object"
                        ? (
                            action.payload
                                ?.tenantId ||
                            action.payload
                                ?.id ||
                            action.payload
                                ?._id
                        )
                        : action.payload;

                if (
                    !tenantId
                ) {
                    return;
                }

                state.tenants =
                    state.tenants.filter(
                        tenant =>
                            getTenantId(
                                tenant,
                            ) !==
                            tenantId,
                    );

                if (
                    state.currentTenant &&
                    getTenantId(
                        state.currentTenant,
                    ) ===
                    tenantId
                ) {
                    state.currentTenant =
                        null;

                    state.features =
                        [];

                    state.permissions =
                        [];

                    state.selectedPlan =
                        null;

                    state.status =
                        TENANT_STATUS
                            .INACTIVE;
                }

                state.metadata
                    .tenantCount =
                    state.tenants.length;

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Features
            // ------------------------------------------------------------------

            setTenantFeatures(
                state,
                action,
            ) {
                const features =
                    normalizeCollection(
                        action.payload,
                        MAX_FEATURES,
                    );

                state.features =
                    features;

                if (
                    state.currentTenant
                ) {
                    state.currentTenant
                        .features =
                        [
                            ...features,
                        ];
                }

                state.lastUpdatedAt =
                    nowIso();
            },

            addTenantFeature(
                state,
                action,
            ) {
                const feature =
                    normalizeString(
                        action.payload,
                    );

                if (
                    !feature
                ) {
                    return;
                }

                if (
                    !state.features.includes(
                        feature,
                    )
                ) {
                    state.features.push(
                        feature,
                    );
                }

                state.features =
                    state.features.slice(
                        0,
                        MAX_FEATURES,
                    );

                if (
                    state.currentTenant
                ) {
                    state.currentTenant
                        .features =
                        [
                            ...state.features,
                        ];
                }

                state.lastUpdatedAt =
                    nowIso();
            },

            removeTenantFeature(
                state,
                action,
            ) {
                const feature =
                    normalizeString(
                        action.payload,
                    );

                if (
                    !feature
                ) {
                    return;
                }

                state.features =
                    state.features.filter(
                        current =>
                            current !==
                            feature,
                    );

                if (
                    state.currentTenant
                ) {
                    state.currentTenant
                        .features =
                        [
                            ...state.features,
                        ];
                }

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Permissions
            // ------------------------------------------------------------------

            setTenantPermissions(
                state,
                action,
            ) {
                const permissions =
                    normalizeCollection(
                        action.payload,
                        MAX_PERMISSIONS,
                    );

                state.permissions =
                    permissions;

                if (
                    state.currentTenant
                ) {
                    state.currentTenant
                        .permissions =
                        [
                            ...permissions,
                        ];
                }

                state.lastUpdatedAt =
                    nowIso();
            },

            addTenantPermission(
                state,
                action,
            ) {
                const permission =
                    normalizeString(
                        action.payload,
                    );

                if (
                    !permission
                ) {
                    return;
                }

                if (
                    !state.permissions.includes(
                        permission,
                    )
                ) {
                    state.permissions.push(
                        permission,
                    );
                }

                state.permissions =
                    state.permissions.slice(
                        0,
                        MAX_PERMISSIONS,
                    );

                if (
                    state.currentTenant
                ) {
                    state.currentTenant
                        .permissions =
                        [
                            ...state.permissions,
                        ];
                }

                state.lastUpdatedAt =
                    nowIso();
            },

            removeTenantPermission(
                state,
                action,
            ) {
                const permission =
                    normalizeString(
                        action.payload,
                    );

                if (
                    !permission
                ) {
                    return;
                }

                state.permissions =
                    state.permissions.filter(
                        current =>
                            current !==
                            permission,
                    );

                if (
                    state.currentTenant
                ) {
                    state.currentTenant
                        .permissions =
                        [
                            ...state.permissions,
                        ];
                }

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Plan Management
            // ------------------------------------------------------------------

            setTenantPlan(
                state,
                action,
            ) {
                state.selectedPlan =
                    action.payload ||
                    null;

                if (
                    state.currentTenant
                ) {
                    state.currentTenant
                        .plan =
                        action.payload ||
                        null;
                }

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Tenant status
            // ------------------------------------------------------------------

            setTenantStatus(
                state,
                action,
            ) {
                const status =
                    Object.values(
                        TENANT_STATUS,
                    ).includes(
                        action.payload,
                    )
                        ? action.payload
                        : state.status;

                state.status =
                    status;

                if (
                    state.currentTenant
                ) {
                    state.currentTenant
                        .status =
                        status;
                }

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Statistics
            // ------------------------------------------------------------------

            setTenantStatistics(
                state,
                action,
            ) {
                state.statistics =
                    action.payload ??
                    null;

                state.lastUpdatedAt =
                    nowIso();
            },

            clearTenantStatistics(
                state,
            ) {
                state.statistics =
                    null;

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Metadata
            // ------------------------------------------------------------------

            setTenantMetadata(
                state,
                action,
            ) {
                state.metadata =
                    {
                        ...state.metadata,
                        ...(action.payload ||
                            {}),
                    };

                state.lastUpdatedAt =
                    nowIso();
            },

            markTenantSynced(
                state,
                action,
            ) {
                state.lastSyncedAt =
                    action.payload
                        ?.timestamp ||
                    nowIso();

                state.source =
                    action.payload
                        ?.source ||
                    TENANT_SOURCE.REMOTE;

                state.error =
                    null;
            },

            // ------------------------------------------------------------------
            // Reset
            // ------------------------------------------------------------------

            resetTenantState() {
                return createInitialState();
            },
        },
    });

// ============================================================================
// Actions
// ============================================================================

export const {
    initializeTenantState,
    hydrateTenantState,

    setTenantLoading,
    setTenantSwitching,
    setTenantError,
    clearTenantError,
    clearTenantErrors,

    setTenant,
    clearTenant,

    beginTenantSwitch,
    completeTenantSwitch,
    failTenantSwitch,

    setTenants,
    addTenant,
    updateTenant,
    removeTenant,

    setTenantFeatures,
    addTenantFeature,
    removeTenantFeature,

    setTenantPermissions,
    addTenantPermission,
    removeTenantPermission,

    setTenantPlan,

    setTenantStatus,

    setTenantStatistics,
    clearTenantStatistics,

    setTenantMetadata,
    markTenantSynced,

    resetTenantState,
} = tenantSlice.actions;

// ============================================================================
// Base Selectors
// ============================================================================

export const selectTenantState =
    state =>
        state?.tenant ||
        initialState;

export const selectCurrentTenant =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.currentTenant,
    );

export const selectTenantId =
    createSelector(
        [
            selectCurrentTenant,
        ],
        tenant =>
            getTenantId(
                tenant,
            ),
    );

export const selectTenantName =
    createSelector(
        [
            selectCurrentTenant,
        ],
        tenant =>
            tenant?.name ||
            "",
    );

export const selectTenantSlug =
    createSelector(
        [
            selectCurrentTenant,
        ],
        tenant =>
            tenant?.slug ||
            null,
    );

export const selectTenantStatus =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.status,
    );

export const selectTenantPlan =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.selectedPlan,
    );

export const selectTenantFeatures =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.features,
    );

export const selectTenantPermissions =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.permissions,
    );

export const selectTenants =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.tenants,
    );

export const selectTenantLoading =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.loading,
    );

export const selectTenantSwitching =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.switching,
    );

export const selectTenantSwitchStatus =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.switchStatus,
    );

export const selectTenantError =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.error,
    );

export const selectTenantErrorHistory =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.errorHistory,
    );

export const selectTenantStatistics =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.statistics,
    );

export const selectLastTenantId =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.lastTenantId,
    );

export const selectTenantInitialized =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.initialized,
    );

export const selectTenantSource =
    createSelector(
        [
            selectTenantState,
        ],
        tenant =>
            tenant.source,
    );

// ============================================================================
// Tenant Lookup Selectors
// ============================================================================

export const makeSelectTenantById =
    tenantId =>
        createSelector(
            [
                selectTenants,
            ],
            tenants =>
                tenants.find(
                    tenant =>
                        getTenantId(
                            tenant,
                        ) ===
                        tenantId,
                ) ||
                null,
        );

export const makeSelectTenantHasFeature =
    feature =>
        createSelector(
            [
                selectTenantFeatures,
            ],
            features =>
                features.includes(
                    feature,
                ),
        );

export const makeSelectTenantHasPermission =
    permission =>
        createSelector(
            [
                selectTenantPermissions,
            ],
            permissions =>
                permissions.includes(
                    permission,
                ),
        );

// ============================================================================
// Convenience Helpers
// ============================================================================

export const hasTenantFeature =
    feature =>
        state =>
            selectTenantFeatures(
                state,
            ).includes(
                feature,
            );

export const hasTenantPermission =
    permission =>
        state =>
            selectTenantPermissions(
                state,
            ).includes(
                permission,
            );

// ============================================================================
// Tenant State Selectors
// ============================================================================

export const selectTenantActive =
    createSelector(
        [
            selectTenantStatus,
        ],
        status =>
            status ===
            TENANT_STATUS.ACTIVE ||
            status ===
            TENANT_STATUS.TRIAL,
    );

export const selectTenantSuspended =
    createSelector(
        [
            selectTenantStatus,
        ],
        status =>
            status ===
                TENANT_STATUS.SUSPENDED ||
            status ===
                TENANT_STATUS.DEACTIVATED,
    );

export const selectTenantReady =
    createSelector(
        [
            selectTenantInitialized,
            selectCurrentTenant,
            selectTenantActive,
            selectTenantSwitching,
        ],
        (
            initialized,
            tenant,
            active,
            switching,
        ) =>
            Boolean(
                initialized &&
                tenant &&
                active &&
                !switching,
            ),
    );

export const selectTenantSummary =
    createSelector(
        [
            selectTenantState,
        ],
        tenant => ({
            initialized:
                tenant.initialized,

            loading:
                tenant.loading,

            switching:
                tenant.switching,

            switchStatus:
                tenant.switchStatus,

            tenantId:
                getTenantId(
                    tenant.currentTenant,
                ),

            tenantName:
                tenant.currentTenant
                    ?.name ||
                null,

            status:
                tenant.status,

            plan:
                tenant.selectedPlan,

            featureCount:
                tenant.features.length,

            permissionCount:
                tenant.permissions.length,

            availableTenantCount:
                tenant.tenants.length,

            hasStatistics:
                Boolean(
                    tenant.statistics,
                ),

            hasError:
                Boolean(
                    tenant.error,
                ),

            source:
                tenant.source,

            lastFetchedAt:
                tenant.lastFetchedAt,

            lastSwitchedAt:
                tenant.lastSwitchedAt,

            lastUpdatedAt:
                tenant.lastUpdatedAt,

            lastSyncedAt:
                tenant.lastSyncedAt,
        }),
    );

// ============================================================================
// Reducer
// ============================================================================

export default
    tenantSlice.reducer;