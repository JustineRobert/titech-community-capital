// ============================================================================
// TITech Community Capital
// Enterprise Notification Slice
// File: frontend/src/features/notification/notificationSlice.js
// Production Grade
// ============================================================================

import {
    createSelector,
    createSlice,
    nanoid,
} from "@reduxjs/toolkit";

// ============================================================================
// Constants
// ============================================================================

export const NOTIFICATION_TYPES =
    Object.freeze({
        INFO:
            "info",

        SUCCESS:
            "success",

        WARNING:
            "warning",

        ERROR:
            "error",

        SYSTEM:
            "system",

        SECURITY:
            "security",

        TRANSACTION:
            "transaction",
    });

export const NOTIFICATION_CHANNELS =
    Object.freeze({
        IN_APP:
            "in_app",

        EMAIL:
            "email",

        SMS:
            "sms",

        PUSH:
            "push",
    });

export const NOTIFICATION_PRIORITIES =
    Object.freeze({
        LOW:
            "low",

        NORMAL:
            "normal",

        HIGH:
            "high",

        CRITICAL:
            "critical",
    });

export const NOTIFICATION_STATUS =
    Object.freeze({
        ACTIVE:
            "active",

        READ:
            "read",

        UNREAD:
            "unread",

        ARCHIVED:
            "archived",

        DISMISSED:
            "dismissed",
    });

const MAX_NOTIFICATIONS =
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
            .trim()
            .toLowerCase() ===
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
            .trim()
            .toLowerCase() ===
            "false"
    ) {
        return false;
    }

    return fallback;
}

function normalizeMetadata(
    metadata,
) {
    if (
        !metadata ||
        typeof metadata !==
            "object" ||
        Array.isArray(metadata)
    ) {
        return {};
    }

    return {
        ...metadata,
    };
}

function normalizeNotification(
    payload,
) {
    if (
        !payload ||
        typeof payload !==
            "object"
    ) {
        return null;
    }

    const id =
        normalizeString(
            payload.id ||
            payload._id ||
            payload.notificationId,
            null,
        ) ||
        nanoid();

    const read =
        normalizeBoolean(
            payload.read,
        );

    const archived =
        normalizeBoolean(
            payload.archived,
        );

    const type =
        payload.type &&
        Object.values(
            NOTIFICATION_TYPES,
        ).includes(
            payload.type,
        )
            ? payload.type
            : NOTIFICATION_TYPES.INFO;

    const channel =
        payload.channel &&
        Object.values(
            NOTIFICATION_CHANNELS,
        ).includes(
            payload.channel,
        )
            ? payload.channel
            : NOTIFICATION_CHANNELS.IN_APP;

    const priority =
        payload.priority &&
        Object.values(
            NOTIFICATION_PRIORITIES,
        ).includes(
            payload.priority,
        )
            ? payload.priority
            : NOTIFICATION_PRIORITIES.NORMAL;

    return {
        ...payload,

        id,

        title:
            normalizeString(
                payload.title,
                "Notification",
            ),

        message:
            normalizeString(
                payload.message,
                "",
            ),

        type,

        channel,

        read,

        archived,

        createdAt:
            payload.createdAt ||
            nowIso(),

        updatedAt:
            payload.updatedAt ||
            payload.createdAt ||
            nowIso(),

        readAt:
            payload.readAt ||
            (read
                ? nowIso()
                : null),

        archivedAt:
            payload.archivedAt ||
            (archived
                ? nowIso()
                : null),

        metadata:
            normalizeMetadata(
                payload.metadata,
            ),

        action:
            payload.action ||
            null,

        priority,

        status:
            archived
                ? NOTIFICATION_STATUS.ARCHIVED
                : read
                    ? NOTIFICATION_STATUS.READ
                    : NOTIFICATION_STATUS.UNREAD,
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
                "NOTIFICATION_ERROR",

            message:
                error,

            statusCode:
                null,

            retryable:
                false,

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
            "NOTIFICATION_ERROR",

        message:
            source?.message ||
            source?.error ||
            error?.message ||
            "Notification operation failed.",

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

function notificationIdentity(
    notification,
) {
    return (
        notification?.id ||
        notification?._id ||
        notification?.notificationId ||
        null
    );
}

function upsertNotification(
    notifications,
    notification,
) {
    const normalized =
        normalizeNotification(
            notification,
        );

    if (
        !normalized
    ) {
        return notifications;
    }

    const id =
        notificationIdentity(
            normalized,
        );

    const index =
        notifications.findIndex(
            current =>
                notificationIdentity(
                    current,
                ) === id,
        );

    if (
        index ===
            -1
    ) {
        return [
            normalized,
            ...notifications,
        ].slice(
            0,
            MAX_NOTIFICATIONS,
        );
    }

    const next =
        [
            ...notifications,
        ];

    next[index] =
        {
            ...next[index],
            ...normalized,
        };

    return next;
}

function deduplicateNotifications(
    notifications,
) {
    if (
        !Array.isArray(
            notifications,
        )
    ) {
        return [];
    }

    const map =
        new Map();

    for (
        const notification of
        notifications
    ) {
        const normalized =
            normalizeNotification(
                notification,
            );

        if (
            !normalized
        ) {
            continue;
        }

        const id =
            notificationIdentity(
                normalized,
            );

        if (
            !map.has(
                id,
            )
        ) {
            map.set(
                id,
                normalized,
            );
        }
    }

    return Array.from(
        map.values(),
    ).slice(
        0,
        MAX_NOTIFICATIONS,
    );
}

function recalculateUnread(
    state,
) {
    state.unreadCount =
        state.items.filter(
            notification =>
                !notification.read &&
                !notification.archived,
        ).length;
}

function recalculateCounts(
    state,
) {
    const visible =
        state.items;

    state.counts = {
        total:
            visible.length,

        unread:
            visible.filter(
                notification =>
                    !notification.read &&
                    !notification.archived,
            ).length,

        read:
            visible.filter(
                notification =>
                    notification.read &&
                    !notification.archived,
            ).length,

        archived:
            visible.filter(
                notification =>
                    notification.archived,
            ).length,

        security:
            visible.filter(
                notification =>
                    notification.type ===
                    NOTIFICATION_TYPES.SECURITY,
            ).length,

        transaction:
            visible.filter(
                notification =>
                    notification.type ===
                    NOTIFICATION_TYPES.TRANSACTION,
            ).length,

        critical:
            visible.filter(
                notification =>
                    notification.priority ===
                    NOTIFICATION_PRIORITIES.CRITICAL,
            ).length,
    };

    state.unreadCount =
        state.counts.unread;
}

function markStateUpdated(
    state,
) {
    state.lastUpdatedAt =
        nowIso();
}

// ============================================================================
// Initial State Factory
// ============================================================================

function createInitialState() {
    return {
        initialized:
            false,

        hydrated:
            false,

        items: [],

        unreadCount:
            0,

        counts: {
            total:
                0,

            unread:
                0,

            read:
                0,

            archived:
                0,

            security:
                0,

            transaction:
                0,

            critical:
                0,
        },

        loading:
            false,

        syncing:
            false,

        error:
            null,

        errorHistory:
            [],

        lastFetchedAt:
            null,

        lastSyncedAt:
            null,

        lastUpdatedAt:
            null,

        preferences: {
            email:
                true,

            sms:
                false,

            push:
                true,

            inApp:
                true,
        },

        metadata: {
            tenantId:
                null,

            userId:
                null,

            lastRequestId:
                null,

            source:
                "local",

            version:
                1,
        },
    };
}

const initialState =
    createInitialState();

// ============================================================================
// Slice
// ============================================================================

const notificationSlice =
    createSlice({

        name:
            "notifications",

        initialState,

        reducers: {

            // ------------------------------------------------------------------
            // Initialization
            // ------------------------------------------------------------------

            initializeNotifications(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                state.initialized =
                    true;

                state.hydrated =
                    payload.hydrated ??
                    state.hydrated;

                if (
                    payload.tenantId
                ) {
                    state.metadata.tenantId =
                        payload.tenantId;
                }

                if (
                    payload.userId
                ) {
                    state.metadata.userId =
                        payload.userId;
                }

                markStateUpdated(
                    state,
                );
            },

            hydrateNotifications(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                if (
                    Array.isArray(
                        payload.items,
                    )
                ) {
                    state.items =
                        deduplicateNotifications(
                            payload.items,
                        );
                }

                if (
                    payload.preferences
                ) {
                    state.preferences =
                        {
                            ...state.preferences,
                            ...payload.preferences,
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

                state.initialized =
                    true;

                state.hydrated =
                    true;

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Loading / synchronization
            // ------------------------------------------------------------------

            setNotificationsLoading(
                state,
                action,
            ) {
                state.loading =
                    Boolean(
                        action.payload,
                    );

                markStateUpdated(
                    state,
                );
            },

            setNotificationsSyncing(
                state,
                action,
            ) {
                state.syncing =
                    Boolean(
                        action.payload,
                    );

                markStateUpdated(
                    state,
                );
            },

            setNotificationsError(
                state,
                action,
            ) {
                addErrorHistory(
                    state,
                    action.payload,
                );

                state.loading =
                    false;

                state.syncing =
                    false;

                markStateUpdated(
                    state,
                );
            },

            clearNotificationsError(
                state,
            ) {
                state.error =
                    null;

                markStateUpdated(
                    state,
                );
            },

            clearNotificationErrors(
                state,
            ) {
                state.error =
                    null;

                state.errorHistory =
                    [];

                markStateUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Set / replace notifications
            // ------------------------------------------------------------------

            setNotifications(
                state,
                action,
            ) {
                const payload =
                    Array.isArray(
                        action.payload,
                    )
                        ? action.payload
                        : (
                            action.payload
                                ?.items ||
                            action.payload
                                ?.data ||
                            []
                        );

                state.items =
                    deduplicateNotifications(
                        payload,
                    );

                state.lastFetchedAt =
                    nowIso();

                state.initialized =
                    true;

                state.hydrated =
                    true;

                state.error =
                    null;

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            replaceNotifications(
                state,
                action,
            ) {
                const payload =
                    Array.isArray(
                        action.payload,
                    )
                        ? action.payload
                        : [];

                state.items =
                    deduplicateNotifications(
                        payload,
                    );

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Add notifications
            // ------------------------------------------------------------------

            addNotification(
                state,
                action,
            ) {
                const notification =
                    normalizeNotification(
                        action.payload,
                    );

                if (
                    !notification
                ) {
                    return;
                }

                state.items =
                    upsertNotification(
                        state.items,
                        notification,
                    );

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            addNotifications(
                state,
                action,
            ) {
                const notifications =
                    Array.isArray(
                        action.payload,
                    )
                        ? action.payload
                        : [];

                for (
                    const notification of
                    notifications
                ) {
                    state.items =
                        upsertNotification(
                            state.items,
                            notification,
                        );
                }

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Update notification
            // ------------------------------------------------------------------

            updateNotification(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const id =
                    payload.id ||
                    payload.notificationId;

                if (
                    !id
                ) {
                    return;
                }

                const index =
                    state.items.findIndex(
                        notification =>
                            notificationIdentity(
                                notification,
                            ) === id,
                    );

                if (
                    index ===
                        -1
                ) {
                    return;
                }

                const updates =
                    payload.updates ||
                    {};

                state.items[index] =
                    normalizeNotification({
                        ...state.items[index],
                        ...updates,
                        id:
                            state.items[index]
                                .id,
                        updatedAt:
                            nowIso(),
                    });

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Read state
            // ------------------------------------------------------------------

            markAsRead(
                state,
                action,
            ) {
                const id =
                    typeof action.payload ===
                        "object"
                        ? action.payload
                            ?.id ||
                          action.payload
                            ?.notificationId
                        : action.payload;

                if (
                    !id
                ) {
                    return;
                }

                const notification =
                    state.items.find(
                        current =>
                            notificationIdentity(
                                current,
                            ) === id,
                    );

                if (
                    !notification
                ) {
                    return;
                }

                notification.read =
                    true;

                notification.readAt =
                    nowIso();

                notification.status =
                    notification.archived
                        ? NOTIFICATION_STATUS
                            .ARCHIVED
                        : NOTIFICATION_STATUS
                            .READ;

                notification.updatedAt =
                    nowIso();

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            markAsUnread(
                state,
                action,
            ) {
                const id =
                    typeof action.payload ===
                        "object"
                        ? action.payload
                            ?.id ||
                          action.payload
                            ?.notificationId
                        : action.payload;

                if (
                    !id
                ) {
                    return;
                }

                const notification =
                    state.items.find(
                        current =>
                            notificationIdentity(
                                current,
                            ) === id,
                    );

                if (
                    !notification
                ) {
                    return;
                }

                notification.read =
                    false;

                notification.readAt =
                    null;

                notification.status =
                    NOTIFICATION_STATUS
                        .UNREAD;

                notification.updatedAt =
                    nowIso();

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            markAllAsRead(
                state,
            ) {
                const timestamp =
                    nowIso();

                state.items.forEach(
                    notification => {

                        if (
                            !notification.archived
                        ) {
                            notification.read =
                                true;

                            notification.readAt =
                                timestamp;

                            notification.status =
                                NOTIFICATION_STATUS
                                    .READ;

                            notification.updatedAt =
                                timestamp;
                        }
                    },
                );

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Archive
            // ------------------------------------------------------------------

            archiveNotification(
                state,
                action,
            ) {
                const id =
                    typeof action.payload ===
                        "object"
                        ? action.payload
                            ?.id ||
                          action.payload
                            ?.notificationId
                        : action.payload;

                if (
                    !id
                ) {
                    return;
                }

                const notification =
                    state.items.find(
                        current =>
                            notificationIdentity(
                                current,
                            ) === id,
                    );

                if (
                    !notification
                ) {
                    return;
                }

                notification.archived =
                    true;

                notification.archivedAt =
                    nowIso();

                notification.status =
                    NOTIFICATION_STATUS
                        .ARCHIVED;

                notification.updatedAt =
                    nowIso();

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            unarchiveNotification(
                state,
                action,
            ) {
                const id =
                    typeof action.payload ===
                        "object"
                        ? action.payload
                            ?.id ||
                          action.payload
                            ?.notificationId
                        : action.payload;

                if (
                    !id
                ) {
                    return;
                }

                const notification =
                    state.items.find(
                        current =>
                            notificationIdentity(
                                current,
                            ) === id,
                    );

                if (
                    !notification
                ) {
                    return;
                }

                notification.archived =
                    false;

                notification.archivedAt =
                    null;

                notification.status =
                    notification.read
                        ? NOTIFICATION_STATUS
                            .READ
                        : NOTIFICATION_STATUS
                            .UNREAD;

                notification.updatedAt =
                    nowIso();

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Dismissal
            // ------------------------------------------------------------------

            dismissNotification(
                state,
                action,
            ) {
                const id =
                    typeof action.payload ===
                        "object"
                        ? action.payload
                            ?.id ||
                          action.payload
                            ?.notificationId
                        : action.payload;

                if (
                    !id
                ) {
                    return;
                }

                const notification =
                    state.items.find(
                        current =>
                            notificationIdentity(
                                current,
                            ) === id,
                    );

                if (
                    !notification
                ) {
                    return;
                }

                notification.status =
                    NOTIFICATION_STATUS
                        .DISMISSED;

                notification.updatedAt =
                    nowIso();

                markStateUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Delete
            // ------------------------------------------------------------------

            removeNotification(
                state,
                action,
            ) {
                const id =
                    typeof action.payload ===
                        "object"
                        ? action.payload
                            ?.id ||
                          action.payload
                            ?.notificationId
                        : action.payload;

                if (
                    !id
                ) {
                    return;
                }

                state.items =
                    state.items.filter(
                        notification =>
                            notificationIdentity(
                                notification,
                            ) !== id,
                    );

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            clearNotifications(
                state,
            ) {
                state.items =
                    [];

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            clearArchivedNotifications(
                state,
            ) {
                state.items =
                    state.items.filter(
                        notification =>
                            !notification.archived,
                    );

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            clearDismissedNotifications(
                state,
            ) {
                state.items =
                    state.items.filter(
                        notification =>
                            notification.status !==
                            NOTIFICATION_STATUS
                                .DISMISSED,
                    );

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Realtime
            // ------------------------------------------------------------------

            markRealtimeReceived(
                state,
                action,
            ) {
                const notification =
                    action.payload;

                if (
                    notification
                ) {
                    state.items =
                        upsertNotification(
                            state.items,
                            notification,
                        );
                }

                state.realtime =
                    {
                        ...state.realtime,
                        connected:
                            true,

                        connectionState:
                            "connected",

                        lastReceived:
                            nowIso(),
                    };

                recalculateCounts(
                    state,
                );

                markStateUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Preferences
            // ------------------------------------------------------------------

            setNotificationPreferences(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                state.preferences =
                    {
                        ...state.preferences,
                        ...payload,
                    };

                markStateUpdated(
                    state,
                );
            },

            setNotificationPreference(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const channel =
                    payload.channel;

                if (
                    ![
                        "email",
                        "sms",
                        "push",
                        "inApp",
                    ].includes(
                        channel,
                    )
                ) {
                    return;
                }

                state.preferences[
                    channel
                ] =
                    Boolean(
                        payload.enabled,
                    );

                markStateUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Metadata
            // ------------------------------------------------------------------

            setNotificationMetadata(
                state,
                action,
            ) {
                state.metadata =
                    {
                        ...state.metadata,
                        ...(action.payload ||
                            {}),
                    };

                markStateUpdated(
                    state,
                );
            },

            markNotificationsSynced(
                state,
                action,
            ) {
                state.syncing =
                    false;

                state.loading =
                    false;

                state.lastSyncedAt =
                    action.payload
                        ?.timestamp ||
                    nowIso();

                state.error =
                    null;

                markStateUpdated(
                    state,
                );
            },

            // ------------------------------------------------------------------
            // Reset
            // ------------------------------------------------------------------

            resetNotificationState() {
                return createInitialState();
            },
        },
    });

// ============================================================================
// Actions
// ============================================================================

export const {
    initializeNotifications,
    hydrateNotifications,

    setNotificationsLoading,
    setNotificationsSyncing,
    setNotificationsError,
    clearNotificationsError,
    clearNotificationErrors,

    setNotifications,
    replaceNotifications,

    addNotification,
    addNotifications,

    updateNotification,

    markAsRead,
    markAsUnread,
    markAllAsRead,

    archiveNotification,
    unarchiveNotification,

    dismissNotification,

    removeNotification,
    clearNotifications,
    clearArchivedNotifications,
    clearDismissedNotifications,

    markRealtimeReceived,

    setNotificationPreferences,
    setNotificationPreference,

    setNotificationMetadata,
    markNotificationsSynced,

    resetNotificationState,
} =
    notificationSlice.actions;

// ============================================================================
// Base Selectors
// ============================================================================

export const selectNotificationState =
    state =>
        state?.notifications ||
        initialState;

export const selectNotifications =
    createSelector(
        [
            selectNotificationState,
        ],
        notifications =>
            notifications.items,
    );

export const selectUnreadCount =
    createSelector(
        [
            selectNotificationState,
        ],
        notifications =>
            notifications.unreadCount,
    );

export const selectNotificationCounts =
    createSelector(
        [
            selectNotificationState,
        ],
        notifications =>
            notifications.counts,
    );

export const selectNotificationLoading =
    createSelector(
        [
            selectNotificationState,
        ],
        notifications =>
            notifications.loading,
    );

export const selectNotificationSyncing =
    createSelector(
        [
            selectNotificationState,
        ],
        notifications =>
            notifications.syncing,
    );

export const selectNotificationError =
    createSelector(
        [
            selectNotificationState,
        ],
        notifications =>
            notifications.error,
    );

export const selectNotificationErrorHistory =
    createSelector(
        [
            selectNotificationState,
        ],
        notifications =>
            notifications.errorHistory,
    );

export const selectNotificationPreferences =
    createSelector(
        [
            selectNotificationState,
        ],
        notifications =>
            notifications.preferences,
    );

export const selectNotificationLastFetchedAt =
    createSelector(
        [
            selectNotificationState,
        ],
        notifications =>
            notifications.lastFetchedAt,
    );

export const selectNotificationLastSyncedAt =
    createSelector(
        [
            selectNotificationState,
        ],
        notifications =>
            notifications.lastSyncedAt,
    );

// ============================================================================
// Derived Selectors
// ============================================================================

export const selectUnreadNotifications =
    createSelector(
        [
            selectNotifications,
        ],
        notifications =>
            notifications.filter(
                notification =>
                    !notification.read &&
                    !notification.archived,
            ),
    );

export const selectReadNotifications =
    createSelector(
        [
            selectNotifications,
        ],
        notifications =>
            notifications.filter(
                notification =>
                    notification.read &&
                    !notification.archived,
            ),
    );

export const selectArchivedNotifications =
    createSelector(
        [
            selectNotifications,
        ],
        notifications =>
            notifications.filter(
                notification =>
                    notification.archived,
            ),
    );

export const selectDismissedNotifications =
    createSelector(
        [
            selectNotifications,
        ],
        notifications =>
            notifications.filter(
                notification =>
                    notification.status ===
                    NOTIFICATION_STATUS
                        .DISMISSED,
            ),
    );

export const selectSecurityNotifications =
    createSelector(
        [
            selectNotifications,
        ],
        notifications =>
            notifications.filter(
                notification =>
                    notification.type ===
                    NOTIFICATION_TYPES.SECURITY,
            ),
    );

export const selectTransactionNotifications =
    createSelector(
        [
            selectNotifications,
        ],
        notifications =>
            notifications.filter(
                notification =>
                    notification.type ===
                    NOTIFICATION_TYPES
                        .TRANSACTION,
            ),
    );

export const selectCriticalNotifications =
    createSelector(
        [
            selectNotifications,
        ],
        notifications =>
            notifications.filter(
                notification =>
                    notification.priority ===
                    NOTIFICATION_PRIORITIES
                        .CRITICAL ||
                    notification.type ===
                    NOTIFICATION_TYPES
                        .SECURITY &&
                    notification.priority ===
                        NOTIFICATION_PRIORITIES
                            .HIGH,
            ),
    );

export const selectErrorNotifications =
    createSelector(
        [
            selectNotifications,
        ],
        notifications =>
            notifications.filter(
                notification =>
                    notification.type ===
                    NOTIFICATION_TYPES
                        .ERROR,
            ),
    );

// ============================================================================
// Parameterized Selectors
// ============================================================================

export const makeSelectNotificationById =
    id =>
        createSelector(
            [
                selectNotifications,
            ],
            notifications =>
                notifications.find(
                    notification =>
                        notification.id ===
                        id,
                ) ||
                null,
        );

export const makeSelectNotificationsByType =
    type =>
        createSelector(
            [
                selectNotifications,
            ],
            notifications =>
                notifications.filter(
                    notification =>
                        notification.type ===
                        type,
                ),
        );

export const makeSelectNotificationsByChannel =
    channel =>
        createSelector(
            [
                selectNotifications,
            ],
            notifications =>
                notifications.filter(
                    notification =>
                        notification.channel ===
                        channel,
                ),
        );

export const makeSelectNotificationsByPriority =
    priority =>
        createSelector(
            [
                selectNotifications,
            ],
            notifications =>
                notifications.filter(
                    notification =>
                        notification.priority ===
                        priority,
                ),
        );

// ============================================================================
// Preference Selectors
// ============================================================================

export const selectEmailNotificationsEnabled =
    createSelector(
        [
            selectNotificationPreferences,
        ],
        preferences =>
            Boolean(
                preferences.email,
            ),
    );

export const selectSMSNotificationsEnabled =
    createSelector(
        [
            selectNotificationPreferences,
        ],
        preferences =>
            Boolean(
                preferences.sms,
            ),
    );

export const selectPushNotificationsEnabled =
    createSelector(
        [
            selectNotificationPreferences,
        ],
        preferences =>
            Boolean(
                preferences.push,
            ),
    );

export const selectInAppNotificationsEnabled =
    createSelector(
        [
            selectNotificationPreferences,
        ],
        preferences =>
            Boolean(
                preferences.inApp,
            ),
    );

// ============================================================================
// Operational Summary
// ============================================================================

export const selectNotificationSummary =
    createSelector(
        [
            selectNotificationState,
        ],
        notifications => ({
            initialized:
                notifications.initialized,

            hydrated:
                notifications.hydrated,

            loading:
                notifications.loading,

            syncing:
                notifications.syncing,

            total:
                notifications.counts
                    .total,

            unread:
                notifications.counts
                    .unread,

            read:
                notifications.counts
                    .read,

            archived:
                notifications.counts
                    .archived,

            security:
                notifications.counts
                    .security,

            transaction:
                notifications.counts
                    .transaction,

            critical:
                notifications.counts
                    .critical,

            hasError:
                Boolean(
                    notifications.error,
                ),

            lastFetchedAt:
                notifications.lastFetchedAt,

            lastSyncedAt:
                notifications.lastSyncedAt,

            lastUpdatedAt:
                notifications.lastUpdatedAt,
        }),
    );

// ============================================================================
// Reducer
// ============================================================================

export default
    notificationSlice.reducer;