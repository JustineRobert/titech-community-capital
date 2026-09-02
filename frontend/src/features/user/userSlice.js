// ============================================================================
// TITech Community Capital LTD
// Enterprise User Slice
// File: frontend/src/features/user/userSlice.js
// Production Grade
// ============================================================================
//
// Purpose
// ----------------------------------------------------------------------------
// Centralized frontend user/profile state for the TITech Community Capital
// platform.
//
// Responsibilities
// ----------------------------------------------------------------------------
// ✓ User profile state
// ✓ User account lifecycle state
// ✓ Profile loading/updating state
// ✓ Tenant context metadata
// ✓ Role / permission / feature metadata
// ✓ Verification state
// ✓ Account status state
// ✓ Session-safe user synchronization
// ✓ Error normalization
// ✓ Bounded activity/error history
// ✓ Serializable Redux state
// ✓ Production-grade selectors
//
// Security boundary
// ----------------------------------------------------------------------------
// This slice is NOT the authoritative authorization system.
//
// The TITech backend remains authoritative for:
//   - identity
//   - roles
//   - permissions
//   - tenant membership
//   - KYC / compliance state
//   - account status
//   - financial authorization
//
// NEVER store in this slice:
//   - passwords
//   - PINs
//   - access tokens
//   - refresh tokens
//   - private keys
//   - Mobile Money secrets
//   - payment credentials
//   - API secrets
//
// Authentication/session credentials belong to the dedicated auth boundary.
// ============================================================================

import {
    createSelector,
    createSlice,
} from "@reduxjs/toolkit";

// ============================================================================
// Constants
// ============================================================================

export const USER_STATUS = Object.freeze({
    ACTIVE:
        "active",

    INACTIVE:
        "inactive",

    PENDING:
        "pending",

    SUSPENDED:
        "suspended",

    LOCKED:
        "locked",

    DEACTIVATED:
        "deactivated",

    DELETED:
        "deleted",
});

export const USER_VERIFICATION_STATUS =
    Object.freeze({
        UNVERIFIED:
            "unverified",

        PENDING:
            "pending",

        VERIFIED:
            "verified",

        REJECTED:
            "rejected",

        EXPIRED:
            "expired",
    });

export const USER_OPERATION_STATUS =
    Object.freeze({
        IDLE:
            "idle",

        LOADING:
            "loading",

        SUCCESS:
            "success",

        FAILED:
            "failed",

        UPDATING:
            "updating",

        DELETING:
            "deleting",
    });

export const USER_ACTIVITY_TYPES =
    Object.freeze({
        PROFILE_UPDATED:
            "profile_updated",

        PROFILE_LOADED:
            "profile_loaded",

        VERIFICATION_CHANGED:
            "verification_changed",

        STATUS_CHANGED:
            "status_changed",

        TENANT_CHANGED:
            "tenant_changed",

        ROLE_CHANGED:
            "role_changed",

        PERMISSION_CHANGED:
            "permission_changed",
    });

const MAX_ROLES =
    100;

const MAX_PERMISSIONS =
    500;

const MAX_FEATURES =
    500;

const MAX_ACTIVITY_HISTORY =
    100;

const MAX_ERROR_HISTORY =
    25;

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_PROFILE =
    Object.freeze({
        id:
            null,

        userId:
            null,

        _id:
            null,

        firstName:
            null,

        lastName:
            null,

        name:
            null,

        username:
            null,

        email:
            null,

        phone:
            null,

        avatar:
            null,

        profileImage:
            null,

        gender:
            null,

        dateOfBirth:
            null,

        address:
            null,

        city:
            null,

        district:
            null,

        country:
            null,

        timezone:
            "Africa/Kampala",

        bio:
            null,
    });

const DEFAULT_METADATA =
    Object.freeze({
        tenantId:
            null,

        organizationId:
            null,

        memberId:
            null,

        lastLoadedAt:
            null,

        lastUpdatedAt:
            null,

        source:
            "local",

        version:
            1,
    });

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

function normalizeStatus(
    value,
    fallback,
) {
    return Object.values(
        USER_STATUS,
    ).includes(
        value,
    )
        ? value
        : fallback;
}

function normalizeVerificationStatus(
    value,
    fallback,
) {
    return Object.values(
        USER_VERIFICATION_STATUS,
    ).includes(
        value,
    )
        ? value
        : fallback;
}

function normalizeProfile(
    profile = {},
) {
    if (
        !profile ||
        typeof profile !==
            "object"
    ) {
        return {
            ...DEFAULT_PROFILE,
        };
    }

    return {
        ...DEFAULT_PROFILE,

        ...profile,

        id:
            profile.id ||
            profile.userId ||
            profile._id ||
            null,

        userId:
            profile.userId ||
            profile.id ||
            profile._id ||
            null,

        _id:
            profile._id ||
            profile.id ||
            profile.userId ||
            null,

        firstName:
            normalizeString(
                profile.firstName,
            ),

        lastName:
            normalizeString(
                profile.lastName,
            ),

        name:
            normalizeString(
                profile.name ||
                (
                    [
                        profile.firstName,
                        profile.lastName,
                    ]
                        .filter(
                            Boolean,
                        )
                        .join(
                            " ",
                        ) ||
                    null
                ),
            ),

        username:
            normalizeString(
                profile.username,
            ),

        email:
            normalizeString(
                profile.email,
            ),

        phone:
            normalizeString(
                profile.phone,
            ),

        avatar:
            normalizeString(
                profile.avatar ||
                profile.profileImage,
            ),

        profileImage:
            normalizeString(
                profile.profileImage ||
                profile.avatar,
            ),

        timezone:
            normalizeString(
                profile.timezone,
                "Africa/Kampala",
            ),

        bio:
            normalizeString(
                profile.bio,
            ),
    };
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
                "USER_ERROR",

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
            "USER_ERROR",

        message:
            source?.message ||
            source?.error ||
            error?.message ||
            "User operation failed.",

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

function addActivity(
    state,
    activity,
) {
    if (
        !activity ||
        typeof activity !==
            "object"
    ) {
        return;
    }

    state.activityHistory =
        [
            {
                id:
                    activity.id ||
                    `${Date.now()}-${Math.random()
                        .toString(36)
                        .slice(2, 8)}`,

                type:
                    activity.type ||
                    "unknown",

                message:
                    activity.message ||
                    null,

                timestamp:
                    activity.timestamp ||
                    nowIso(),

                metadata:
                    activity.metadata ||
                    null,
            },

            ...state.activityHistory,
        ].slice(
            0,
            MAX_ACTIVITY_HISTORY,
        );
}

function extractUserId(
    user,
) {
    return (
        user?.id ||
        user?._id ||
        user?.userId ||
        null
    );
}

function extractTenantId(
    user,
) {
    return (
        user?.tenantId ||
        user?.tenant?.id ||
        user?.tenant?._id ||
        user?.organizationId ||
        null
    );
}

function deriveRoles(
    user,
) {
    return normalizeCollection(
        user?.roles ||
        (
            user?.role
                ? [
                    user.role,
                ]
                : []
        ),
        MAX_ROLES,
    );
}

function derivePermissions(
    user,
) {
    return normalizeCollection(
        user?.permissions,
        MAX_PERMISSIONS,
    );
}

function deriveFeatures(
    user,
) {
    return normalizeCollection(
        user?.features,
        MAX_FEATURES,
    );
}

function createInitialState() {
    return {
        initialized:
            false,

        exists:
            false,

        profile:
            {
                ...DEFAULT_PROFILE,
            },

        status:
            USER_STATUS.PENDING,

        verificationStatus:
            USER_VERIFICATION_STATUS
                .UNVERIFIED,

        isVerified:
            false,

        roles:
            [],

        permissions:
            [],

        features:
            [],

        metadata:
            {
                ...DEFAULT_METADATA,
            },

        loading:
            false,

        updating:
            false,

        deleting:
            false,

        statusUpdating:
            false,

        error:
            null,

        errorHistory:
            [],

        activityHistory:
            [],

        lastFetchedAt:
            null,

        lastUpdatedAt:
            null,

        lastSyncedAt:
            null,
    };
}

const initialState =
    createInitialState();

// ============================================================================
// Slice
// ============================================================================

const userSlice =
    createSlice({

        name:
            "user",

        initialState,

        reducers: {

            // ------------------------------------------------------------------
            // Initialization
            // ------------------------------------------------------------------

            initializeUser(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const user =
                    payload.user ||
                    payload.profile ||
                    payload;

                const normalized =
                    normalizeProfile(
                        user,
                    );

                const userId =
                    extractUserId(
                        user,
                    );

                const tenantId =
                    payload.tenantId ||
                    extractTenantId(
                        user,
                    );

                state.profile =
                    normalized;

                state.exists =
                    Boolean(
                        userId,
                    );

                state.initialized =
                    true;

                state.status =
                    normalizeStatus(
                        user?.status,
                        USER_STATUS.ACTIVE,
                    );

                state.verificationStatus =
                    normalizeVerificationStatus(
                        user?.verificationStatus ||
                        user?.kycStatus,
                        user?.isVerified
                            ? USER_VERIFICATION_STATUS
                                .VERIFIED
                            : USER_VERIFICATION_STATUS
                                .UNVERIFIED,
                    );

                state.isVerified =
                    Boolean(
                        user?.isVerified ||
                        state.verificationStatus ===
                        USER_VERIFICATION_STATUS
                            .VERIFIED,
                    );

                state.roles =
                    deriveRoles(
                        user,
                    );

                state.permissions =
                    derivePermissions(
                        user,
                    );

                state.features =
                    deriveFeatures(
                        user,
                    );

                state.metadata =
                    {
                        ...state.metadata,

                        ...payload.metadata,

                        tenantId,

                        organizationId:
                            user?.organizationId ||
                            payload.organizationId ||
                            null,

                        memberId:
                            user?.memberId ||
                            payload.memberId ||
                            null,

                        lastLoadedAt:
                            nowIso(),

                        source:
                            payload.source ||
                            "local",
                    };

                state.loading =
                    false;

                state.updating =
                    false;

                state.error =
                    null;

                addActivity(
                    state,
                    {
                        type:
                            USER_ACTIVITY_TYPES
                                .PROFILE_LOADED,

                        message:
                            "TITech user profile initialized.",

                        metadata: {
                            userId,
                            tenantId,
                        },
                    },
                );
            },

            hydrateUser(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const user =
                    payload.user ||
                    payload.profile ||
                    payload;

                const normalized =
                    normalizeProfile(
                        user,
                    );

                const userId =
                    extractUserId(
                        user,
                    );

                const tenantId =
                    payload.tenantId ||
                    extractTenantId(
                        user,
                    ) ||
                    state.metadata
                        .tenantId;

                state.profile =
                    normalized;

                state.exists =
                    Boolean(
                        userId,
                    );

                state.initialized =
                    true;

                state.status =
                    normalizeStatus(
                        user?.status,
                        state.status ||
                        USER_STATUS.ACTIVE,
                    );

                state.verificationStatus =
                    normalizeVerificationStatus(
                        user?.verificationStatus ||
                        user?.kycStatus,
                        user?.isVerified
                            ? USER_VERIFICATION_STATUS
                                .VERIFIED
                            : state
                                .verificationStatus ||
                              USER_VERIFICATION_STATUS
                                .UNVERIFIED,
                    );

                state.isVerified =
                    Boolean(
                        user?.isVerified ??
                        (
                            state
                                .verificationStatus ===
                            USER_VERIFICATION_STATUS
                                .VERIFIED
                        ),
                    );

                state.roles =
                    deriveRoles(
                        user,
                    );

                state.permissions =
                    derivePermissions(
                        user,
                    );

                state.features =
                    deriveFeatures(
                        user,
                    );

                state.metadata =
                    {
                        ...state.metadata,

                        ...(payload.metadata ||
                            {}),

                        tenantId,

                        lastLoadedAt:
                            payload.loadedAt ||
                            nowIso(),

                        source:
                            payload.source ||
                            "local",
                    };

                state.loading =
                    false;

                state.error =
                    null;

                state.lastFetchedAt =
                    payload.loadedAt ||
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Loading
            // ------------------------------------------------------------------

            setUserLoading(
                state,
                action,
            ) {
                state.loading =
                    Boolean(
                        action.payload,
                    );
            },

            setUserUpdating(
                state,
                action,
            ) {
                state.updating =
                    Boolean(
                        action.payload,
                    );
            },

            setUserDeleting(
                state,
                action,
            ) {
                state.deleting =
                    Boolean(
                        action.payload,
                    );
            },

            setUserStatusUpdating(
                state,
                action,
            ) {
                state.statusUpdating =
                    Boolean(
                        action.payload,
                    );
            },

            // ------------------------------------------------------------------
            // Profile
            // ------------------------------------------------------------------

            setUser(
                state,
                action,
            ) {
                const user =
                    action.payload ||
                    {};

                const normalized =
                    normalizeProfile(
                        user,
                    );

                state.profile =
                    normalized;

                state.exists =
                    Boolean(
                        extractUserId(
                            user,
                        ),
                    );

                state.status =
                    normalizeStatus(
                        user.status,
                        state.status ||
                        USER_STATUS.ACTIVE,
                    );

                state.verificationStatus =
                    normalizeVerificationStatus(
                        user.verificationStatus ||
                        user.kycStatus,
                        state.isVerified
                            ? USER_VERIFICATION_STATUS
                                .VERIFIED
                            : USER_VERIFICATION_STATUS
                                .UNVERIFIED,
                    );

                state.isVerified =
                    Boolean(
                        user.isVerified ??
                        (
                            state
                                .verificationStatus ===
                            USER_VERIFICATION_STATUS
                                .VERIFIED
                        ),
                    );

                state.roles =
                    deriveRoles(
                        user,
                    );

                state.permissions =
                    derivePermissions(
                        user,
                    );

                state.features =
                    deriveFeatures(
                        user,
                    );

                state.metadata.tenantId =
                    extractTenantId(
                        user,
                    ) ||
                    state.metadata
                        .tenantId;

                state.lastUpdatedAt =
                    nowIso();

                addActivity(
                    state,
                    {
                        type:
                            USER_ACTIVITY_TYPES
                                .PROFILE_UPDATED,

                        message:
                            "TITech user profile replaced.",
                    },
                );
            },

            updateUser(
                state,
                action,
            ) {
                const updates =
                    action.payload ||
                    {};

                state.profile =
                    normalizeProfile(
                        {
                            ...state.profile,
                            ...updates,
                        },
                    );

                if (
                    updates.status
                ) {
                    state.status =
                        normalizeStatus(
                            updates.status,
                            state.status,
                        );
                }

                if (
                    updates.verificationStatus ||
                    updates.kycStatus
                ) {
                    state.verificationStatus =
                        normalizeVerificationStatus(
                            updates.verificationStatus ||
                            updates.kycStatus,
                            state
                                .verificationStatus,
                        );
                }

                if (
                    updates.isVerified !==
                    undefined
                ) {
                    state.isVerified =
                        Boolean(
                            updates.isVerified,
                        );
                }

                if (
                    updates.roles ||
                    updates.role
                ) {
                    state.roles =
                        deriveRoles(
                            {
                                ...state.profile,
                                ...updates,
                            },
                        );
                }

                if (
                    updates.permissions
                ) {
                    state.permissions =
                        derivePermissions(
                            updates,
                        );
                }

                if (
                    updates.features
                ) {
                    state.features =
                        deriveFeatures(
                            updates,
                        );
                }

                state.metadata.tenantId =
                    updates.tenantId ||
                    extractTenantId(
                        updates,
                    ) ||
                    state.metadata
                        .tenantId;

                state.lastUpdatedAt =
                    nowIso();

                addActivity(
                    state,
                    {
                        type:
                            USER_ACTIVITY_TYPES
                                .PROFILE_UPDATED,

                        message:
                            "TITech user profile updated.",

                        metadata: {
                            fields:
                                Object.keys(
                                    updates,
                                ),
                        },
                    },
                );
            },

            clearUser(
                state,
            ) {
                state.exists =
                    false;

                state.profile =
                    {
                        ...DEFAULT_PROFILE,
                    };

                state.status =
                    USER_STATUS
                        .INACTIVE;

                state.verificationStatus =
                    USER_VERIFICATION_STATUS
                        .UNVERIFIED;

                state.isVerified =
                    false;

                state.roles =
                    [];

                state.permissions =
                    [];

                state.features =
                    [];

                state.metadata =
                    {
                        ...DEFAULT_METADATA,
                    };

                state.loading =
                    false;

                state.updating =
                    false;

                state.deleting =
                    false;

                state.statusUpdating =
                    false;

                state.error =
                    null;

                state.lastUpdatedAt =
                    nowIso();

                addActivity(
                    state,
                    {
                        type:
                            USER_ACTIVITY_TYPES
                                .PROFILE_UPDATED,

                        message:
                            "TITech user profile cleared.",
                    },
                );
            },

            // ------------------------------------------------------------------
            // Roles / permissions / features
            // ------------------------------------------------------------------

            setRoles(
                state,
                action,
            ) {
                state.roles =
                    normalizeCollection(
                        action.payload,
                        MAX_ROLES,
                    );

                addActivity(
                    state,
                    {
                        type:
                            USER_ACTIVITY_TYPES
                                .ROLE_CHANGED,

                        message:
                            "TITech user roles updated.",
                    },
                );
            },

            addRole(
                state,
                action,
            ) {
                const role =
                    normalizeString(
                        action.payload,
                    );

                if (
                    !role
                ) {
                    return;
                }

                if (
                    !state.roles.includes(
                        role,
                    )
                ) {
                    state.roles.push(
                        role,
                    );
                }

                state.roles =
                    state.roles.slice(
                        0,
                        MAX_ROLES,
                    );

                addActivity(
                    state,
                    {
                        type:
                            USER_ACTIVITY_TYPES
                                .ROLE_CHANGED,

                        message:
                            `TITech user role "${role}" added.`,
                    },
                );
            },

            removeRole(
                state,
                action,
            ) {
                const role =
                    normalizeString(
                        action.payload,
                    );

                if (
                    !role
                ) {
                    return;
                }

                state.roles =
                    state.roles.filter(
                        item =>
                            item !==
                            role,
                    );

                addActivity(
                    state,
                    {
                        type:
                            USER_ACTIVITY_TYPES
                                .ROLE_CHANGED,

                        message:
                            `TITech user role "${role}" removed.`,
                    },
                );
            },

            setPermissions(
                state,
                action,
            ) {
                state.permissions =
                    normalizeCollection(
                        action.payload,
                        MAX_PERMISSIONS,
                    );

                addActivity(
                    state,
                    {
                        type:
                            USER_ACTIVITY_TYPES
                                .PERMISSION_CHANGED,

                        message:
                            "TITech user permissions updated.",
                    },
                );
            },

            addPermission(
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

                addActivity(
                    state,
                    {
                        type:
                            USER_ACTIVITY_TYPES
                                .PERMISSION_CHANGED,

                        message:
                            `TITech user permission "${permission}" added.`,
                    },
                );
            },

            removePermission(
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
                        item =>
                            item !==
                            permission,
                    );

                addActivity(
                    state,
                    {
                        type:
                            USER_ACTIVITY_TYPES
                                .PERMISSION_CHANGED,

                        message:
                            `TITech user permission "${permission}" removed.`,
                    },
                );
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
            },

            // ------------------------------------------------------------------
            // Tenant context
            // ------------------------------------------------------------------

            setTenant(
                state,
                action,
            ) {
                const tenantId =
                    normalizeString(
                        action.payload,
                    );

                state.metadata.tenantId =
                    tenantId;

                addActivity(
                    state,
                    {
                        type:
                            USER_ACTIVITY_TYPES
                                .TENANT_CHANGED,

                        message:
                            "TITech user tenant context updated.",

                        metadata: {
                            tenantId,
                        },
                    },
                );
            },

            setUserMetadata(
                state,
                action,
            ) {
                state.metadata =
                    {
                        ...state.metadata,
                        ...(action.payload ||
                            {}),
                    };
            },

            // ------------------------------------------------------------------
            // Verification
            // ------------------------------------------------------------------

            setVerificationStatus(
                state,
                action,
            ) {
                const status =
                    normalizeVerificationStatus(
                        action.payload,
                        state
                            .verificationStatus,
                    );

                state.verificationStatus =
                    status;

                state.isVerified =
                    status ===
                    USER_VERIFICATION_STATUS
                        .VERIFIED;

                addActivity(
                    state,
                    {
                        type:
                            USER_ACTIVITY_TYPES
                                .VERIFICATION_CHANGED,

                        message:
                            "TITech user verification status updated.",

                        metadata: {
                            status,
                        },
                    },
                );
            },

            setVerified(
                state,
                action,
            ) {
                const verified =
                    Boolean(
                        action.payload,
                    );

                state.isVerified =
                    verified;

                state.verificationStatus =
                    verified
                        ? USER_VERIFICATION_STATUS
                            .VERIFIED
                        : USER_VERIFICATION_STATUS
                            .UNVERIFIED;

                addActivity(
                    state,
                    {
                        type:
                            USER_ACTIVITY_TYPES
                                .VERIFICATION_CHANGED,

                        message:
                            verified
                                ? "TITech user verified."
                                : "TITech user verification cleared.",
                    },
                );
            },

            // ------------------------------------------------------------------
            // Account status
            // ------------------------------------------------------------------

            setUserStatus(
                state,
                action,
            ) {
                const status =
                    normalizeStatus(
                        action.payload,
                        state.status,
                    );

                state.status =
                    status;

                addActivity(
                    state,
                    {
                        type:
                            USER_ACTIVITY_TYPES
                                .STATUS_CHANGED,

                        message:
                            `TITech user status changed to "${status}".`,
                    },
                );
            },

            // ------------------------------------------------------------------
            // Errors
            // ------------------------------------------------------------------

            setUserError(
                state,
                action,
            ) {
                addErrorHistory(
                    state,
                    action.payload,
                );

                state.loading =
                    false;

                state.updating =
                    false;

                state.statusUpdating =
                    false;
            },

            clearUserError(
                state,
            ) {
                state.error =
                    null;
            },

            clearUserErrors(
                state,
            ) {
                state.error =
                    null;

                state.errorHistory =
                    [];
            },

            // ------------------------------------------------------------------
            // Synchronization
            // ------------------------------------------------------------------

            markUserSynced(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                state.lastSyncedAt =
                    payload.timestamp ||
                    nowIso();

                state.metadata.source =
                    payload.source ||
                    "remote";

                state.error =
                    null;
            },

            // ------------------------------------------------------------------
            // Reset
            // ------------------------------------------------------------------

            resetUserState() {
                return createInitialState();
            },
        },
    });

// ============================================================================
// Actions
// ============================================================================

export const {
    initializeUser,
    hydrateUser,

    setUserLoading,
    setUserUpdating,
    setUserDeleting,
    setUserStatusUpdating,

    setUser,
    updateUser,
    clearUser,

    setRoles,
    addRole,
    removeRole,

    setPermissions,
    addPermission,
    removePermission,

    setFeatures,

    setTenant,
    setUserMetadata,

    setVerificationStatus,
    setVerified,

    setUserStatus,

    setUserError,
    clearUserError,
    clearUserErrors,

    markUserSynced,

    resetUserState,
} =
    userSlice.actions;

// ============================================================================
// Base Selectors
// ============================================================================

export const selectUserState =
    state =>
        state?.user ||
        initialState;

export const selectUserProfile =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.profile,
    );

export const selectUser =
    selectUserProfile;

export const selectUserId =
    createSelector(
        [
            selectUserProfile,
        ],
        profile =>
            profile?.id ||
            profile?.userId ||
            profile?._id ||
            null,
    );

export const selectUserName =
    createSelector(
        [
            selectUserProfile,
        ],
        profile =>
            profile?.name ||
            (
                [
                    profile?.firstName,
                    profile?.lastName,
                ]
                    .filter(
                        Boolean,
                    )
                    .join(
                        " ",
                    )
            ) ||
            null,
    );

export const selectUserEmail =
    createSelector(
        [
            selectUserProfile,
        ],
        profile =>
            profile?.email ||
            null,
    );

export const selectUserPhone =
    createSelector(
        [
            selectUserProfile,
        ],
        profile =>
            profile?.phone ||
            null,
    );

export const selectUserAvatar =
    createSelector(
        [
            selectUserProfile,
        ],
        profile =>
            profile?.avatar ||
            profile?.profileImage ||
            null,
    );

export const selectUserRoles =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.roles,
    );

export const selectUserPermissions =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.permissions,
    );

export const selectUserFeatures =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.features,
    );

export const selectUserStatus =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.status,
    );

export const selectUserVerificationStatus =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.verificationStatus,
    );

export const selectUserIsVerified =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            Boolean(
                user.isVerified,
            ),
    );

export const selectUserTenantId =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.metadata
                .tenantId ||
            null,
    );

export const selectUserMetadata =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.metadata,
    );

// ============================================================================
// Lifecycle Selectors
// ============================================================================

export const selectUserInitialized =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.initialized,
    );

export const selectUserExists =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.exists,
    );

export const selectUserLoading =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.loading,
    );

export const selectUserUpdating =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.updating,
    );

export const selectUserDeleting =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.deleting,
    );

export const selectUserStatusUpdating =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.statusUpdating,
    );

export const selectUserError =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.error,
    );

export const selectUserErrorHistory =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.errorHistory,
    );

export const selectUserActivityHistory =
    createSelector(
        [
            selectUserState,
        ],
        user =>
            user.activityHistory,
    );

// ============================================================================
// Authorization Convenience Selectors
// ============================================================================
//
// These are frontend convenience checks only. The TITech backend MUST
// independently enforce authorization.
// ============================================================================

export const selectHasRole =
    createSelector(
        [
            selectUserRoles,
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
            selectUserRoles,
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

export const selectHasPermission =
    createSelector(
        [
            selectUserPermissions,
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
            selectUserPermissions,
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
            selectUserPermissions,
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
            selectUserFeatures,
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

// ============================================================================
// Account State Selectors
// ============================================================================

export const selectUserActive =
    createSelector(
        [
            selectUserStatus,
        ],
        status =>
            status ===
            USER_STATUS.ACTIVE,
    );

export const selectUserSuspended =
    createSelector(
        [
            selectUserStatus,
        ],
        status =>
            [
                USER_STATUS.SUSPENDED,
                USER_STATUS.LOCKED,
            ].includes(
                status,
            ),
    );

export const selectUserCanOperate =
    createSelector(
        [
            selectUserExists,
            selectUserActive,
            selectUserIsVerified,
        ],
        (
            exists,
            active,
            verified,
        ) =>
            Boolean(
                exists &&
                active &&
                verified,
            ),
    );

export const selectUserNeedsVerification =
    createSelector(
        [
            selectUserVerificationStatus,
        ],
        status =>
            [
                USER_VERIFICATION_STATUS.UNVERIFIED,
                USER_VERIFICATION_STATUS.PENDING,
                USER_VERIFICATION_STATUS.REJECTED,
                USER_VERIFICATION_STATUS.EXPIRED,
            ].includes(
                status,
            ),
    );

// ============================================================================
// Combined User Context
// ============================================================================

export const selectUserContext =
    createSelector(
        [
            selectUserProfile,
            selectUserId,
            selectUserTenantId,
            selectUserStatus,
            selectUserVerificationStatus,
            selectUserIsVerified,
            selectUserRoles,
            selectUserPermissions,
            selectUserFeatures,
        ],
        (
            profile,
            userId,
            tenantId,
            status,
            verificationStatus,
            isVerified,
            roles,
            permissions,
            features,
        ) => ({
            profile,
            userId,
            tenantId,

            status,

            verificationStatus,

            isVerified,

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

// ============================================================================
// Operational Summary
// ============================================================================

export const selectUserSummary =
    createSelector(
        [
            selectUserState,
        ],
        user => ({
            initialized:
                user.initialized,

            exists:
                user.exists,

            status:
                user.status,

            verificationStatus:
                user.verificationStatus,

            isVerified:
                user.isVerified,

            loading:
                user.loading,

            updating:
                user.updating,

            deleting:
                user.deleting,

            statusUpdating:
                user.statusUpdating,

            tenantId:
                user.metadata
                    .tenantId,

            userId:
                user.profile?.id ||
                user.profile?._id ||
                user.profile?.userId ||
                null,

            rolesCount:
                user.roles.length,

            permissionsCount:
                user.permissions.length,

            featuresCount:
                user.features.length,

            activityCount:
                user.activityHistory
                    .length,

            hasError:
                Boolean(
                    user.error,
                ),

            lastFetchedAt:
                user.lastFetchedAt,

            lastUpdatedAt:
                user.lastUpdatedAt,

            lastSyncedAt:
                user.lastSyncedAt,
        }),
    );

// ============================================================================
// Reducer
// ============================================================================

export default
    userSlice.reducer;