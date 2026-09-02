'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/src/features/offline/offlineSlice.js
 *
 * Purpose:
 *   Enterprise production-grade offline state slice for the TITech application.
 *
 * Architectural responsibility
 * =============================================================================
 *
 *   This module represents OFFLINE APPLICATION STATE.
 *
 *   It does NOT:
 *
 *     - perform direct database access;
 *     - perform direct MongoDB access;
 *     - manage Redis;
 *     - execute financial transactions;
 *     - own device cryptographic keys;
 *     - perform HTTP transport directly;
 *     - decide authoritative financial state;
 *     - replace the backend offline synchronization service.
 *
 *   The slice is intentionally transport/persistence agnostic.
 *
 * =============================================================================
 *
 * State boundary
 * =============================================================================
 *
 *   UI / application
 *          ↓
 *   offlineSlice
 *          ↓
 *   offline service/thunks
 *          ↓
 *   device identity
 *   event store
 *   local database
 *   synchronization service
 *          ↓
 *   authoritative TITech backend
 *
 * =============================================================================
 *
 * Design goals
 * =============================================================================
 *
 *   ✓ Redux Toolkit compatible.
 *   ✓ Serializable state.
 *   ✓ Explicit lifecycle states.
 *   ✓ Offline connectivity tracking.
 *   ✓ Synchronization status tracking.
 *   ✓ Queue statistics.
 *   ✓ Conflict tracking.
 *   ✓ Last sync/checkpoint tracking.
 *   ✓ Idempotency metadata tracking.
 *   ✓ Device identity metadata without private keys.
 *   ✓ Error normalization.
 *   ✓ Bounded collection sizes.
 *   ✓ Deterministic reducers.
 *   ✓ Safe reset semantics.
 *   ✓ Runtime diagnostics.
 *   ✓ Backward-compatible action names where practical.
 *
 * IMPORTANT
 * =============================================================================
 *
 *   NEVER place secrets/private keys/access tokens inside this Redux state.
 *
 * =============================================================================
 */

const {
    createSlice,
} = require('@reduxjs/toolkit');

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const NAME =
    'offline';

const MAX_OPERATIONS =
    500;

const MAX_CONFLICTS =
    200;

const MAX_ERRORS =
    100;

const MAX_EVENTS =
    200;

const MAX_AUDIT_ENTRIES =
    100;

const DEFAULT_STALE_AFTER_MS =
    5 * 60 * 1000;

/**
 * =============================================================================
 * Canonical states
 * =============================================================================
 */

const CONNECTIVITY_STATES =
    Object.freeze({
        UNKNOWN:
            'unknown',

        ONLINE:
            'online',

        OFFLINE:
            'offline',

        DEGRADED:
            'degraded',

        RECONNECTING:
            'reconnecting',
    });

const SYNC_STATES =
    Object.freeze({
        IDLE:
            'idle',

        QUEUED:
            'queued',

        RUNNING:
            'running',

        PAUSED:
            'paused',

        COMPLETED:
            'completed',

        PARTIAL:
            'partial',

        FAILED:
            'failed',

        CONFLICT:
            'conflict',

        CANCELLED:
            'cancelled',
    });

const OPERATION_STATES =
    Object.freeze({
        CREATED:
            'created',

        PENDING:
            'pending',

        PROCESSING:
            'processing',

        SUCCEEDED:
            'succeeded',

        FAILED:
            'failed',

        RETRYABLE_FAILURE:
            'retryable_failure',

        DEAD_LETTER:
            'dead_letter',

        CANCELLED:
            'cancelled',

        EXPIRED:
            'expired',

        CONFLICT:
            'conflict',

        RECONCILED:
            'reconciled',
    });

const CONFLICT_SEVERITIES =
    Object.freeze({
        LOW:
            'low',

        MEDIUM:
            'medium',

        HIGH:
            'high',

        CRITICAL:
            'critical',
    });

/**
 * =============================================================================
 * Initial state
 * =============================================================================
 */

const initialState =
    Object.freeze({

        /**
         * ---------------------------------------------------------------------
         * Subsystem lifecycle
         * ---------------------------------------------------------------------
         */

        initialized:
            false,

        enabled:
            true,

        hydrated:
            false,

        version:
            1,

        lastUpdatedAt:
            null,

        /**
         * ---------------------------------------------------------------------
         * Connectivity
         * ---------------------------------------------------------------------
         */

        connectivity: {

            state:
                CONNECTIVITY_STATES.UNKNOWN,

            online:
                false,

            checkedAt:
                null,

            changedAt:
                null,

            consecutiveFailures:
                0,

            consecutiveSuccesses:
                0,

            latencyMs:
                null,

            source:
                null,

            reason:
                null,

        },

        /**
         * ---------------------------------------------------------------------
         * Synchronization
         * ---------------------------------------------------------------------
         */

        sync: {

            state:
                SYNC_STATES.IDLE,

            syncId:
                null,

            batchId:
                null,

            startedAt:
                null,

            completedAt:
                null,

            lastSuccessAt:
                null,

            lastFailureAt:
                null,

            lastCheckpoint:
                null,

            cursor:
                0,

            progress:
                0,

            direction:
                'bidirectional',

            error:
                null,

            statusMessage:
                null,

            statistics: {

                runs:
                    0,

                successfulRuns:
                    0,

                failedRuns:
                    0,

                partialRuns:
                    0,

                operationsSelected:
                    0,

                operationsSent:
                    0,

                operationsSucceeded:
                    0,

                operationsFailed:
                    0,

                operationsRetried:
                    0,

                operationsConflicted:
                    0,

                operationsSkipped:
                    0,

                eventsPulled:
                    0,

                eventsApplied:
                    0,

                eventsFailed:
                    0,

            },

        },

        /**
         * ---------------------------------------------------------------------
         * Queue
         * ---------------------------------------------------------------------
         */

        queue: {

            pending:
                0,

            processing:
                0,

            succeeded:
                0,

            failed:
                0,

            retryable:
                0,

            deadLetter:
                0,

            cancelled:
                0,

            expired:
                0,

            conflicted:
                0,

            reconciled:
                0,

            total:
                0,

            lastUpdatedAt:
                null,

        },

        /**
         * ---------------------------------------------------------------------
         * Locally tracked operations
         * ---------------------------------------------------------------------
         *
         * These are metadata records only. Payloads should preferably remain in
         * the durable offline store rather than being mirrored into Redux.
         * ---------------------------------------------------------------------
         */

        operations: [],

        /**
         * ---------------------------------------------------------------------
         * Synchronization conflicts
         * ---------------------------------------------------------------------
         */

        conflicts: [],

        /**
         * ---------------------------------------------------------------------
         * Recent offline events
         * ---------------------------------------------------------------------
         */

        events: [],

        /**
         * ---------------------------------------------------------------------
         * Device identity
         * ---------------------------------------------------------------------
         *
         * Public metadata only.
         *
         * NEVER add private keys here.
         * ---------------------------------------------------------------------
         */

        device: {

            initialized:
                false,

            deviceId:
                null,

            fingerprint:
                null,

            keyId:
                null,

            keyAlgorithm:
                null,

            status:
                null,

            platform:
                null,

            appVersion:
                null,

            registered:
                false,

            registeredAt:
                null,

            lastVerifiedAt:
                null,

        },

        /**
         * ---------------------------------------------------------------------
         * Idempotency state
         * ---------------------------------------------------------------------
         */

        idempotency: {

            enabled:
                true,

            requiredForMutations:
                true,

            requiredForFinancial:
                true,

            activeRequests:
                0,

            completedRequests:
                0,

            conflicts:
                0,

            lastKeyFingerprint:
                null,

            lastUpdatedAt:
                null,

        },

        /**
         * ---------------------------------------------------------------------
         * Error state
         * ---------------------------------------------------------------------
         */

        errors: [],

        lastError:
            null,

        /**
         * ---------------------------------------------------------------------
         * Audit/diagnostic metadata
         * ---------------------------------------------------------------------
         */

        diagnostics: {

            stale:
                false,

            staleAfterMs:
                DEFAULT_STALE_AFTER_MS,

            lastHealthCheckAt:
                null,

            lastReadinessCheckAt:
                null,

            health:
                'unknown',

            readiness:
                'not_ready',

            lastCheckpointAt:
                null,

            lastCleanupAt:
                null,

        },

        /**
         * ---------------------------------------------------------------------
         * Feature/runtime controls
         * ---------------------------------------------------------------------
         */

        configuration: {

            syncEnabled:
                true,

            backgroundSyncEnabled:
                true,

            encryptionRequired:
                true,

            financialOperationsEnabled:
                true,

            conflictResolutionEnabled:
                true,

        },

    });

/**
 * =============================================================================
 * Utility helpers
 * =============================================================================
 */

function nowIso() {

    return new Date().toISOString();

}

function normalizeError(
    error,
) {

    if (
        error === null ||
        error === undefined
    ) {

        return null;

    }

    if (
        typeof error ===
        'string'
    ) {

        return {

            name:
                'Error',

            code:
                'OFFLINE_ERROR',

            message:
                error,

            retryable:
                false,

            statusCode:
                null,

            operationId:
                null,

            eventId:
                null,

            timestamp:
                nowIso(),

        };

    }

    return {

        name:
            error.name ||
            'Error',

        code:
            error.code ||
            'OFFLINE_ERROR',

        message:
            error.message ||
            'Offline operation failed.',

        retryable:
            Boolean(
                error.retryable,
            ),

        statusCode:
            error.statusCode ??
            null,

        classification:
            error.classification ||
            null,

        operationId:
            error.operationId ||
            null,

        eventId:
            error.eventId ||
            null,

        syncId:
            error.syncId ||
            null,

        timestamp:
            error.timestamp ||
            nowIso(),

    };

}

function clampProgress(
    value,
) {

    const numeric =
        Number(
            value,
        );

    if (
        !Number.isFinite(
            numeric,
        )
    ) {

        return 0;

    }

    return Math.max(
        0,
        Math.min(
            100,
            numeric,
        ),
    );

}

function trimCollection(
    array,
    maximum,
) {

    if (
        !Array.isArray(
            array,
        )
    ) {

        return [];

    }

    if (
        array.length <=
        maximum
    ) {

        return array;

    }

    return array.slice(
        array.length -
        maximum,
    );

}

function upsertById(
    array,
    item,
    idField,
    maximum,
) {

    const identifier =
        item?.[idField];

    if (
        !identifier
    ) {

        return trimCollection(
            [
                ...array,
                item,
            ],
            maximum,
        );

    }

    const index =
        array.findIndex(
            current =>
                current?.[idField] ===
                identifier,
        );

    if (
        index ===
        -1
    ) {

        return trimCollection(
            [
                ...array,
                item,
            ],
            maximum,
        );

    }

    const next =
        [
            ...array,
        ];

    next[index] =
        {
            ...next[index],
            ...item,
        };

    return next;

}

function removeById(
    array,
    id,
    idField,
) {

    return array.filter(
        item =>
            item?.[idField] !==
            id,
    );

}

function calculateQueueTotal(
    queue,
) {

    return Object.entries(
        queue,
    )
        .filter(
            ([
                key,
            ]) =>
                ![
                    'total',
                    'lastUpdatedAt',
                ].includes(
                    key,
                ),
        )
        .reduce(
            (
                total,
                [
                    ,
                    value,
                ],
            ) =>
                total +
                (
                    Number.isFinite(
                        Number(
                            value,
                        ),
                    )
                        ? Number(
                            value,
                        )
                        : 0
                ),
            0,
        );

}

function updateQueueState(
    state,
) {

    state.queue.total =
        calculateQueueTotal(
            state.queue,
        );

    state.queue.lastUpdatedAt =
        nowIso();

}

function markUpdated(
    state,
) {

    state.lastUpdatedAt =
        nowIso();

}

function setConnectivityState(
    state,
    connectivity,
) {

    const nextState =
        connectivity.state ||
        CONNECTIVITY_STATES.UNKNOWN;

    const previous =
        state.connectivity.state;

    state.connectivity.state =
        nextState;

    state.connectivity.online =
        nextState ===
        CONNECTIVITY_STATES.ONLINE;

    state.connectivity.checkedAt =
        connectivity.checkedAt ||
        nowIso();

    if (
        previous !==
        nextState
    ) {

        state.connectivity.changedAt =
            state.connectivity
                .checkedAt;

    }

    state.connectivity.latencyMs =
        connectivity.latencyMs ??
        null;

    state.connectivity.source =
        connectivity.source ??
        state.connectivity.source;

    state.connectivity.reason =
        connectivity.reason ??
        null;

    if (
        nextState ===
        CONNECTIVITY_STATES.ONLINE
    ) {

        state.connectivity
            .consecutiveSuccesses +=
            1;

        state.connectivity
            .consecutiveFailures =
            0;

    } else if (
        [
            CONNECTIVITY_STATES.OFFLINE,
            CONNECTIVITY_STATES.DEGRADED,
        ].includes(
            nextState,
        )
    ) {

        state.connectivity
            .consecutiveFailures +=
            1;

        state.connectivity
            .consecutiveSuccesses =
            0;

    }

}

/**
 * =============================================================================
 * Slice
 * =============================================================================
 */

const offlineSlice =
    createSlice({

        name:
            NAME,

        initialState,

        reducers: {

            /**
             * ---------------------------------------------------------------
             * Initialization
             * ---------------------------------------------------------------
             */

            initialize(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.initialized =
                    true;

                state.enabled =
                    payload.enabled !==
                    false;

                state.hydrated =
                    payload.hydrated ===
                    true;

                if (
                    payload.configuration
                ) {

                    state.configuration =
                        {
                            ...state.configuration,
                            ...payload
                                .configuration,
                        };

                }

                state.sync.direction =
                    payload.direction ||
                    state.sync.direction;

                markUpdated(
                    state,
                );

            },

            markHydrated(
                state,
                action,
            ) {

                state.hydrated =
                    action.payload !==
                    false;

                markUpdated(
                    state,
                );

            },

            setEnabled(
                state,
                action,
            ) {

                state.enabled =
                    action.payload !==
                    false;

                markUpdated(
                    state,
                );

            },

            /**
             * ---------------------------------------------------------------
             * Connectivity
             * ---------------------------------------------------------------
             */

            setConnectivity(
                state,
                action,
            ) {

                setConnectivityState(
                    state,
                    action.payload ||
                    {},
                );

                markUpdated(
                    state,
                );

            },

            setOnline(
                state,
                action,
            ) {

                setConnectivityState(
                    state,
                    {
                        state:
                            action.payload
                                ?.state ||
                            CONNECTIVITY_STATES
                                .ONLINE,

                        latencyMs:
                            action.payload
                                ?.latencyMs,

                        source:
                            action.payload
                                ?.source ||

                            'application',

                        checkedAt:
                            action.payload
                                ?.checkedAt,

                        reason:
                            action.payload
                                ?.reason,
                    },
                );

                markUpdated(
                    state,
                );

            },

            setOffline(
                state,
                action,
            ) {

                setConnectivityState(
                    state,
                    {
                        state:
                            CONNECTIVITY_STATES
                                .OFFLINE,

                        source:
                            action.payload
                                ?.source ||

                            'application',

                        reason:
                            action.payload
                                ?.reason,

                        checkedAt:
                            action.payload
                                ?.checkedAt,
                    },
                );

                markUpdated(
                    state,
                );

            },

            setReconnecting(
                state,
                action,
            ) {

                setConnectivityState(
                    state,
                    {
                        state:
                            CONNECTIVITY_STATES
                                .RECONNECTING,

                        source:
                            action.payload
                                ?.source ||

                            'application',

                        reason:
                            action.payload
                                ?.reason,

                    },
                );

                markUpdated(
                    state,
                );

            },

            /**
             * ---------------------------------------------------------------
             * Synchronization lifecycle
             * ---------------------------------------------------------------
             */

            syncStarted(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.sync.state =
                    SYNC_STATES.RUNNING;

                state.sync.syncId =
                    payload.syncId ||
                    null;

                state.sync.batchId =
                    null;

                state.sync.startedAt =
                    payload.startedAt ||
                    nowIso();

                state.sync.completedAt =
                    null;

                state.sync.error =
                    null;

                state.sync.statusMessage =
                    payload.message ||
                    'Synchronization started.';

                state.sync.progress =
                    0;

                state.sync.statistics.runs +=
                    1;

                markUpdated(
                    state,
                );

            },

            syncQueued(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.sync.state =
                    SYNC_STATES.QUEUED;

                state.sync.syncId =
                    payload.syncId ||
                    state.sync.syncId;

                state.sync.statusMessage =
                    payload.message ||
                    'Synchronization queued.';

                markUpdated(
                    state,
                );

            },

            syncProgress(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.sync.state =
                    SYNC_STATES.RUNNING;

                state.sync.progress =
                    clampProgress(
                        payload.progress,
                    );

                state.sync.batchId =
                    payload.batchId ??
                    state.sync.batchId;

                state.sync.statusMessage =
                    payload.message ??
                    state.sync.statusMessage;

                if (
                    Number.isFinite(
                        payload.operationsSelected,
                    )
                ) {

                    state.sync.statistics
                        .operationsSelected =
                        payload.operationsSelected;

                }

                if (
                    Number.isFinite(
                        payload.operationsSent,
                    )
                ) {

                    state.sync.statistics
                        .operationsSent =
                        payload.operationsSent;

                }

                if (
                    Number.isFinite(
                        payload.operationsSucceeded,
                    )
                ) {

                    state.sync.statistics
                        .operationsSucceeded =
                        payload
                            .operationsSucceeded;

                }

                if (
                    Number.isFinite(
                        payload.operationsFailed,
                    )
                ) {

                    state.sync.statistics
                        .operationsFailed =
                        payload
                            .operationsFailed;

                }

                if (
                    Number.isFinite(
                        payload.operationsRetried,
                    )
                ) {

                    state.sync.statistics
                        .operationsRetried =
                        payload
                            .operationsRetried;

                }

                if (
                    Number.isFinite(
                        payload.operationsConflicted,
                    )
                ) {

                    state.sync.statistics
                        .operationsConflicted =
                        payload
                            .operationsConflicted;

                }

                if (
                    Number.isFinite(
                        payload.eventsPulled,
                    )
                ) {

                    state.sync.statistics
                        .eventsPulled =
                        payload
                            .eventsPulled;

                }

                if (
                    Number.isFinite(
                        payload.eventsApplied,
                    )
                ) {

                    state.sync.statistics
                        .eventsApplied =
                        payload
                            .eventsApplied;

                }

                if (
                    Number.isFinite(
                        payload.eventsFailed,
                    )
                ) {

                    state.sync.statistics
                        .eventsFailed =
                        payload
                            .eventsFailed;

                }

                markUpdated(
                    state,
                );

            },

            syncCompleted(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.sync.state =
                    payload.partial
                        ? SYNC_STATES.PARTIAL
                        : SYNC_STATES.COMPLETED;

                state.sync.completedAt =
                    payload.completedAt ||
                    nowIso();

                state.sync.lastSuccessAt =
                    state.sync.completedAt;

                state.sync.error =
                    null;

                state.sync.progress =
                    100;

                state.sync.statusMessage =
                    payload.message ||
                    (
                        payload.partial
                            ? 'Synchronization completed with partial results.'
                            : 'Synchronization completed successfully.'
                    );

                state.sync.statistics
                    .successfulRuns +=
                    payload.partial
                        ? 0
                        : 1;

                state.sync.statistics
                    .partialRuns +=
                    payload.partial
                        ? 1
                        : 0;

                if (
                    Number.isFinite(
                        payload.cursor,
                    )
                ) {

                    state.sync.cursor =
                        payload.cursor;

                }

                if (
                    payload.checkpoint !==
                    undefined
                ) {

                    state.sync.lastCheckpoint =
                        payload.checkpoint;

                    state.diagnostics
                        .lastCheckpointAt =
                        payload.completedAt ||
                        nowIso();

                }

                markUpdated(
                    state,
                );

            },

            syncFailed(
                state,
                action,
            ) {

                const error =
                    normalizeError(
                        action.payload,
                    );

                state.sync.state =
                    SYNC_STATES.FAILED;

                state.sync.completedAt =
                    null;

                state.sync.lastFailureAt =
                    nowIso();

                state.sync.error =
                    error;

                state.sync.statusMessage =
                    error?.message ||
                    'Synchronization failed.';

                state.sync.statistics
                    .failedRuns +=
                    1;

                state.lastError =
                    error;

                state.errors =
                    trimCollection(
                        [
                            ...state.errors,
                            error,
                        ],
                        MAX_ERRORS,
                    );

                markUpdated(
                    state,
                );

            },

            syncPaused(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.sync.state =
                    SYNC_STATES.PAUSED;

                state.sync.statusMessage =
                    payload.reason ||
                    'Synchronization paused.';

                markUpdated(
                    state,
                );

            },

            syncCancelled(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.sync.state =
                    SYNC_STATES.CANCELLED;

                state.sync.statusMessage =
                    payload.reason ||
                    'Synchronization cancelled.';

                markUpdated(
                    state,
                );

            },

            setSyncCursor(
                state,
                action,
            ) {

                const payload =
                    action.payload;

                if (
                    typeof payload ===
                    'object'
                ) {

                    state.sync.cursor =
                        Number(
                            payload.cursor ??
                            state.sync.cursor,
                        );

                    state.sync.lastCheckpoint =
                        payload.checkpoint ??
                        state.sync.lastCheckpoint;

                } else {

                    state.sync.cursor =
                        Number(
                            payload,
                        ) ||
                        0;

                }

                state.diagnostics
                    .lastCheckpointAt =
                    nowIso();

                markUpdated(
                    state,
                );

            },

            /**
             * ---------------------------------------------------------------
             * Queue
             * ---------------------------------------------------------------
             */

            setQueueStatistics(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.queue =
                    {
                        ...state.queue,
                        ...payload,
                    };

                updateQueueState(
                    state,
                );

                markUpdated(
                    state,
                );

            },

            incrementQueue(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                const status =
                    payload.status ||
                    'pending';

                const amount =
                    Number(
                        payload.amount,
                    ) || 1;

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            state.queue,
                            status,
                        )
                ) {

                    state.queue[status] +=
                        amount;

                }

                updateQueueState(
                    state,
                );

                markUpdated(
                    state,
                );

            },

            decrementQueue(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                const status =
                    payload.status ||
                    'pending';

                const amount =
                    Number(
                        payload.amount,
                    ) || 1;

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            state.queue,
                            status,
                        )
                ) {

                    state.queue[status] =
                        Math.max(
                            0,
                            state.queue[status] -
                            amount,
                        );

                }

                updateQueueState(
                    state,
                );

                markUpdated(
                    state,
                );

            },

            /**
             * ---------------------------------------------------------------
             * Operations
             * ---------------------------------------------------------------
             */

            operationAdded(
                state,
                action,
            ) {

                const operation =
                    action.payload ||
                    {};

                state.operations =
                    upsertById(
                        state.operations,
                        operation,
                        'operationId',
                        MAX_OPERATIONS,
                    );

                markUpdated(
                    state,
                );

            },

            operationUpdated(
                state,
                action,
            ) {

                const operation =
                    action.payload ||
                    {};

                state.operations =
                    upsertById(
                        state.operations,
                        operation,
                        'operationId',
                        MAX_OPERATIONS,
                    );

                markUpdated(
                    state,
                );

            },

            operationStateChanged(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                const operationId =
                    payload.operationId;

                if (
                    !operationId
                ) {

                    return;
                }

                state.operations =
                    upsertById(
                        state.operations,
                        {
                            operationId,

                            state:
                                payload.state,

                            status:
                                payload.status ??
                                payload.state,

                            updatedAt:
                                payload.updatedAt ||
                                nowIso(),

                            error:
                                payload.error
                                    ? normalizeError(
                                        payload.error,
                                    )
                                    : null,
                        },
                        'operationId',
                        MAX_OPERATIONS,
                    );

                markUpdated(
                    state,
                );

            },

            operationRemoved(
                state,
                action,
            ) {

                const operationId =
                    typeof action.payload ===
                        'object'
                        ? action.payload
                            ?.operationId
                        : action.payload;

                if (
                    operationId
                ) {

                    state.operations =
                        removeById(
                            state.operations,
                            operationId,
                            'operationId',
                        );

                }

                markUpdated(
                    state,
                );

            },

            clearOperations(
                state,
            ) {

                state.operations =
                    [];

                markUpdated(
                    state,
                );

            },

            replaceOperations(
                state,
                action,
            ) {

                state.operations =
                    trimCollection(
                        Array.isArray(
                            action.payload,
                        )
                            ? action.payload
                            : [],
                        MAX_OPERATIONS,
                    );

                markUpdated(
                    state,
                );

            },

            /**
             * ---------------------------------------------------------------
             * Conflicts
             * ---------------------------------------------------------------
             */

            conflictDetected(
                state,
                action,
            ) {

                const conflict =
                    action.payload ||
                    {};

                const normalized =
                    {
                        ...conflict,

                        detectedAt:
                            conflict.detectedAt ||
                            nowIso(),

                        financial:
                            Boolean(
                                conflict.financial,
                            ),

                        status:
                            conflict.status ||
                            'open',
                    };

                state.conflicts =
                    upsertById(
                        state.conflicts,
                        normalized,
                        'conflictId',
                        MAX_CONFLICTS,
                    );

                state.sync.state =
                    SYNC_STATES.CONFLICT;

                state.sync.statistics
                    .operationsConflicted +=
                    1;

                markUpdated(
                    state,
                );

            },

            conflictResolved(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                const conflictId =
                    payload.conflictId;

                if (
                    !conflictId
                ) {

                    return;
                }

                state.conflicts =
                    state.conflicts.map(
                        conflict =>
                            conflict
                                .conflictId ===
                            conflictId
                                ? {
                                    ...conflict,

                                    status:
                                        'resolved',

                                    resolution:
                                        payload
                                            .resolution ||
                                        null,

                                    resolvedAt:
                                        payload
                                            .resolvedAt ||
                                        nowIso(),
                                }
                                : conflict,
                    );

                markUpdated(
                    state,
                );

            },

            conflictEscalated(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                const conflictId =
                    payload.conflictId;

                if (
                    !conflictId
                ) {

                    return;
                }

                state.conflicts =
                    state.conflicts.map(
                        conflict =>
                            conflict
                                .conflictId ===
                            conflictId
                                ? {
                                    ...conflict,

                                    status:
                                        'escalated',

                                    severity:
                                        payload
                                            .severity ||
                                        CONFLICT_SEVERITIES
                                            .CRITICAL,

                                    escalatedAt:
                                        payload
                                            .escalatedAt ||
                                        nowIso(),

                                    escalationReason:
                                        payload
                                            .reason ||
                                        null,
                                }
                                : conflict,
                    );

                markUpdated(
                    state,
                );

            },

            clearResolvedConflicts(
                state,
            ) {

                state.conflicts =
                    state.conflicts.filter(
                        conflict =>
                            ![
                                'resolved',
                                'reconciled',
                            ].includes(
                                conflict.status,
                            ),
                    );

                markUpdated(
                    state,
                );

            },

            /**
             * ---------------------------------------------------------------
             * Event tracking
             * ---------------------------------------------------------------
             */

            eventRecorded(
                state,
                action,
            ) {

                const event =
                    action.payload ||
                    {};

                state.events =
                    upsertById(
                        state.events,
                        event,
                        'eventId',
                        MAX_EVENTS,
                    );

                markUpdated(
                    state,
                );

            },

            eventReconciled(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                if (
                    !payload.eventId
                ) {

                    return;
                }

                state.events =
                    state.events.map(
                        event =>
                            event.eventId ===
                            payload.eventId
                                ? {
                                    ...event,

                                    eventState:
                                        'reconciled',

                                    reconciledAt:
                                        payload
                                            .reconciledAt ||
                                        nowIso(),
                                }
                                : event,
                    );

                markUpdated(
                    state,
                );

            },

            clearEvents(
                state,
            ) {

                state.events =
                    [];

                markUpdated(
                    state,
                );

            },

            /**
             * ---------------------------------------------------------------
             * Device identity
             * ---------------------------------------------------------------
             */

            setDeviceIdentity(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                /**
                 * Explicitly copy only public/safe identity metadata.
                 *
                 * Any privateKey/privateKeyPem/privateKeyDer fields received
                 * in a payload are intentionally ignored.
                 */

                state.device =
                    {
                        ...state.device,

                        initialized:
                            payload.initialized ??
                            true,

                        deviceId:
                            payload.deviceId ??
                            state.device.deviceId,

                        fingerprint:
                            payload.deviceFingerprint ??
                            payload.fingerprint ??
                            state.device.fingerprint,

                        keyId:
                            payload.keyId ??
                            state.device.keyId,

                        keyAlgorithm:
                            payload.keyAlgorithm ??
                            payload.algorithm ??
                            state.device.keyAlgorithm,

                        status:
                            payload.status ??
                            state.device.status,

                        platform:
                            payload.platform ??
                            state.device.platform,

                        appVersion:
                            payload.appVersion ??
                            state.device.appVersion,

                        registered:
                            payload.registered ??
                            state.device.registered,

                        registeredAt:
                            payload.registeredAt ??
                            state.device.registeredAt,

                        lastVerifiedAt:
                            payload.lastVerifiedAt ??
                            state.device.lastVerifiedAt,
                    };

                markUpdated(
                    state,
                );

            },

            deviceRegistered(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.device =
                    {
                        ...state.device,

                        initialized:
                            true,

                        registered:
                            true,

                        registeredAt:
                            payload.registeredAt ||
                            nowIso(),

                        deviceId:
                            payload.deviceId ??
                            state.device.deviceId,

                        fingerprint:
                            payload.deviceFingerprint ??
                            payload.fingerprint ??
                            state.device.fingerprint,

                        keyId:
                            payload.keyId ??
                            state.device.keyId,

                        status:
                            payload.status ||
                            'active',

                    };

                markUpdated(
                    state,
                );

            },

            deviceRevoked(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.device.status =
                    'revoked';

                state.device.registered =
                    false;

                state.device.lastVerifiedAt =
                    payload.timestamp ||
                    nowIso();

                state.sync.state =
                    SYNC_STATES.PAUSED;

                state.sync.statusMessage =
                    'Offline synchronization paused because the device identity is revoked.';

                markUpdated(
                    state,
                );

            },

            deviceVerificationUpdated(
                state,
                action,
            ) {

                state.device.lastVerifiedAt =
                    action.payload?.timestamp ||
                    nowIso();

                if (
                    action.payload?.status
                ) {

                    state.device.status =
                        action.payload.status;

                }

                markUpdated(
                    state,
                );

            },

            /**
             * ---------------------------------------------------------------
             * Idempotency
             * ---------------------------------------------------------------
             */

            setIdempotencyConfiguration(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.idempotency =
                    {
                        ...state.idempotency,
                        ...payload,
                    };

                state.idempotency
                    .lastUpdatedAt =
                    nowIso();

                markUpdated(
                    state,
                );

            },

            idempotencyStarted(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.idempotency
                    .activeRequests +=
                    1;

                state.idempotency
                    .lastKeyFingerprint =
                    payload.keyFingerprint ??
                    state.idempotency
                        .lastKeyFingerprint;

                state.idempotency
                    .lastUpdatedAt =
                    nowIso();

                markUpdated(
                    state,
                );

            },

            idempotencyCompleted(
                state,
                action,
            ) {

                state.idempotency
                    .activeRequests =
                    Math.max(
                        0,
                        state.idempotency
                            .activeRequests -
                        1,
                    );

                state.idempotency
                    .completedRequests +=
                    1;

                if (
                    action.payload
                        ?.keyFingerprint
                ) {

                    state.idempotency
                        .lastKeyFingerprint =
                        action.payload
                            .keyFingerprint;

                }

                state.idempotency
                    .lastUpdatedAt =
                    nowIso();

                markUpdated(
                    state,
                );

            },

            idempotencyConflict(
                state,
                action,
            ) {

                state.idempotency
                    .activeRequests =
                    Math.max(
                        0,
                        state.idempotency
                            .activeRequests -
                        1,
                    );

                state.idempotency
                    .conflicts +=
                    1;

                state.idempotency
                    .lastKeyFingerprint =
                    action.payload
                        ?.keyFingerprint ??
                    state.idempotency
                        .lastKeyFingerprint;

                state.idempotency
                    .lastUpdatedAt =
                    nowIso();

                markUpdated(
                    state,
                );

            },

            /**
             * ---------------------------------------------------------------
             * Errors
             * ---------------------------------------------------------------
             */

            errorRecorded(
                state,
                action,
            ) {

                const error =
                    normalizeError(
                        action.payload,
                    );

                if (
                    !error
                ) {

                    return;
                }

                state.lastError =
                    error;

                state.errors =
                    trimCollection(
                        [
                            ...state.errors,
                            error,
                        ],
                        MAX_ERRORS,
                    );

                markUpdated(
                    state,
                );

            },

            clearLastError(
                state,
            ) {

                state.lastError =
                    null;

                markUpdated(
                    state,
                );

            },

            clearErrors(
                state,
            ) {

                state.errors =
                    [];

                state.lastError =
                    null;

                markUpdated(
                    state,
                );

            },

            /**
             * ---------------------------------------------------------------
             * Diagnostics
             * ---------------------------------------------------------------
             */

            setHealth(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.diagnostics.health =
                    payload.health ||
                    (
                        payload.healthy
                            ? 'healthy'
                            : 'unhealthy'
                    );

                state.diagnostics
                    .lastHealthCheckAt =
                    payload.checkedAt ||
                    nowIso();

                state.diagnostics.stale =
                    Boolean(
                        payload.stale,
                    );

                markUpdated(
                    state,
                );

            },

            setReadiness(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.diagnostics.readiness =
                    payload.readiness ||
                    (
                        payload.ready
                            ? 'ready'
                            : 'not_ready'
                    );

                state.diagnostics
                    .lastReadinessCheckAt =
                    payload.checkedAt ||
                    nowIso();

                markUpdated(
                    state,
                );

            },

            setStale(
                state,
                action,
            ) {

                state.diagnostics.stale =
                    Boolean(
                        action.payload,
                    );

                markUpdated(
                    state,
                );

            },

            setCheckpoint(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.sync.lastCheckpoint =
                    payload.checkpoint ??
                    payload.cursor ??
                    state.sync
                        .lastCheckpoint;

                if (
                    payload.cursor !==
                    undefined
                ) {

                    state.sync.cursor =
                        Number(
                            payload.cursor,
                        ) ||
                        0;

                }

                state.diagnostics
                    .lastCheckpointAt =
                    payload.timestamp ||
                    nowIso();

                markUpdated(
                    state,
                );

            },

            /**
             * ---------------------------------------------------------------
             * Runtime configuration
             * ---------------------------------------------------------------
             */

            setConfiguration(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                state.configuration =
                    {
                        ...state.configuration,
                        ...payload,
                    };

                markUpdated(
                    state,
                );

            },

            /**
             * ---------------------------------------------------------------
             * Complete state replacement from persistence hydration.
             * ---------------------------------------------------------------
             *
             * Only approved fields are restored. This prevents persistence
             * middleware accidentally introducing arbitrary state.
             * ---------------------------------------------------------------
             */

            hydrate(
                state,
                action,
            ) {

                const payload =
                    action.payload ||
                    {};

                if (
                    payload.connectivity
                ) {

                    state.connectivity =
                        {
                            ...state.connectivity,
                            ...payload
                                .connectivity,
                        };

                }

                if (
                    payload.sync
                ) {

                    state.sync =
                        {
                            ...state.sync,
                            ...payload.sync,

                            statistics:
                                {
                                    ...state.sync
                                        .statistics,
                                    ...(
                                        payload
                                            .sync
                                            .statistics ||
                                        {}
                                    ),
                                },
                        };

                }

                if (
                    payload.queue
                ) {

                    state.queue =
                        {
                            ...state.queue,
                            ...payload.queue,
                        };

                }

                if (
                    Array.isArray(
                        payload.operations,
                    )
                ) {

                    state.operations =
                        trimCollection(
                            payload.operations,
                            MAX_OPERATIONS,
                        );

                }

                if (
                    Array.isArray(
                        payload.conflicts,
                    )
                ) {

                    state.conflicts =
                        trimCollection(
                            payload.conflicts,
                            MAX_CONFLICTS,
                        );

                }

                if (
                    Array.isArray(
                        payload.events,
                    )
                ) {

                    state.events =
                        trimCollection(
                            payload.events,
                            MAX_EVENTS,
                        );

                }

                if (
                    payload.device
                ) {

                    state.device =
                        {
                            ...state.device,
                            ...payload.device,
                        };

                }

                if (
                    payload.idempotency
                ) {

                    state.idempotency =
                        {
                            ...state.idempotency,
                            ...payload
                                .idempotency,
                        };

                }

                if (
                    payload.diagnostics
                ) {

                    state.diagnostics =
                        {
                            ...state.diagnostics,
                            ...payload
                                .diagnostics,
                        };

                }

                if (
                    payload.configuration
                ) {

                    state.configuration =
                        {
                            ...state.configuration,
                            ...payload
                                .configuration,
                        };

                }

                state.hydrated =
                    true;

                updateQueueState(
                    state,
                );

                markUpdated(
                    state,
                );

            },

            /**
             * ---------------------------------------------------------------
             * Reset
             * ---------------------------------------------------------------
             */

            reset(
                state,
                action,
            ) {

                const preserveDevice =
                    action.payload
                        ?.preserveDevice !==
                    false;

                const preserveConfiguration =
                    action.payload
                        ?.preserveConfiguration !==
                    false;

                const device =
                    preserveDevice
                        ? {
                            ...state.device,
                        }
                        : initialState
                            .device;

                const configuration =
                    preserveConfiguration
                        ? {
                            ...state.configuration,
                        }
                        : initialState
                            .configuration;

                return {

                    ...initialState,

                    device,

                    configuration,

                    lastUpdatedAt:
                        nowIso(),

                };

            },

        },

    });

/**
 * =============================================================================
 * Actions
 * =============================================================================
 */

const {
    initialize,
    markHydrated,
    setEnabled,

    setConnectivity,
    setOnline,
    setOffline,
    setReconnecting,

    syncStarted,
    syncQueued,
    syncProgress,
    syncCompleted,
    syncFailed,
    syncPaused,
    syncCancelled,
    setSyncCursor,

    setQueueStatistics,
    incrementQueue,
    decrementQueue,

    operationAdded,
    operationUpdated,
    operationStateChanged,
    operationRemoved,
    clearOperations,
    replaceOperations,

    conflictDetected,
    conflictResolved,
    conflictEscalated,
    clearResolvedConflicts,

    eventRecorded,
    eventReconciled,
    clearEvents,

    setDeviceIdentity,
    deviceRegistered,
    deviceRevoked,
    deviceVerificationUpdated,

    setIdempotencyConfiguration,
    idempotencyStarted,
    idempotencyCompleted,
    idempotencyConflict,

    errorRecorded,
    clearLastError,
    clearErrors,

    setHealth,
    setReadiness,
    setStale,
    setCheckpoint,

    setConfiguration,
    hydrate,

    reset,

} =
    offlineSlice.actions;

/**
 * =============================================================================
 * Selectors
 * =============================================================================
 */

const selectOffline =
    state =>
        state?.offline ||
        initialState;

const selectInitialized =
    state =>
        Boolean(
            selectOffline(
                state,
            ).initialized,
        );

const selectHydrated =
    state =>
        Boolean(
            selectOffline(
                state,
            ).hydrated,
        );

const selectEnabled =
    state =>
        Boolean(
            selectOffline(
                state,
            ).enabled,
        );

const selectConnectivity =
    state =>
        selectOffline(
            state,
        ).connectivity;

const selectIsOnline =
    state =>
        selectConnectivity(
            state,
        ).online ===
        true;

const selectConnectivityState =
    state =>
        selectConnectivity(
            state,
        ).state;

const selectSync =
    state =>
        selectOffline(
            state,
        ).sync;

const selectSyncState =
    state =>
        selectSync(
            state,
        ).state;

const selectSyncRunning =
    state =>
        selectSyncState(
            state,
        ) ===
        SYNC_STATES.RUNNING;

const selectSyncProgress =
    state =>
        selectSync(
            state,
        ).progress;

const selectQueue =
    state =>
        selectOffline(
            state,
        ).queue;

const selectQueueTotal =
    state =>
        selectQueue(
            state,
        ).total;

const selectPendingCount =
    state =>
        selectQueue(
            state,
        ).pending;

const selectProcessingCount =
    state =>
        selectQueue(
            state,
        ).processing;

const selectRetryableCount =
    state =>
        selectQueue(
            state,
        ).retryable;

const selectConflictCount =
    state =>
        selectQueue(
            state,
        ).conflicted;

const selectOperations =
    state =>
        selectOffline(
            state,
        ).operations;

const selectOperationById =
    (
        state,
        operationId,
    ) =>
        selectOperations(
            state,
        ).find(
            operation =>
                operation.operationId ===
                operationId,
        ) ||
        null;

const selectConflicts =
    state =>
        selectOffline(
            state,
        ).conflicts;

const selectOpenConflicts =
    state =>
        selectConflicts(
            state,
        ).filter(
            conflict =>
                ![
                    'resolved',
                    'reconciled',
                ].includes(
                    conflict.status,
                ),
        );

const selectFinancialConflicts =
    state =>
        selectOpenConflicts(
            state,
        ).filter(
            conflict =>
                conflict.financial ===
                true ||
                String(
                    conflict.severity ||
                    '',
                ).toLowerCase() ===
                CONFLICT_SEVERITIES.CRITICAL,
        );

const selectEvents =
    state =>
        selectOffline(
            state,
        ).events;

const selectDevice =
    state =>
        selectOffline(
            state,
        ).device;

const selectDeviceId =
    state =>
        selectDevice(
            state,
        ).deviceId;

const selectDeviceFingerprint =
    state =>
        selectDevice(
            state,
        ).fingerprint;

const selectDeviceReady =
    state =>
        Boolean(
            selectDevice(
                state,
            ).initialized &&
            selectDevice(
                state,
            ).deviceId &&
            selectDevice(
                state,
            ).fingerprint &&
            selectDevice(
                state,
            ).status !==
            'revoked',
        );

const selectIdempotency =
    state =>
        selectOffline(
            state,
        ).idempotency;

const selectLastError =
    state =>
        selectOffline(
            state,
        ).lastError;

const selectErrors =
    state =>
        selectOffline(
            state,
        ).errors;

const selectHealth =
    state =>
        selectOffline(
            state,
        ).diagnostics.health;

const selectReadiness =
    state =>
        selectOffline(
            state,
        ).diagnostics.readiness;

const selectIsStale =
    state =>
        Boolean(
            selectOffline(
                state,
            ).diagnostics.stale,
        );

const selectCheckpoint =
    state =>
        selectSync(
            state,
        ).lastCheckpoint;

const selectCursor =
    state =>
        selectSync(
            state,
        ).cursor;

const selectConfiguration =
    state =>
        selectOffline(
            state,
        ).configuration;

/**
 * =============================================================================
 * Derived selectors
 * =============================================================================
 */

const selectCanSync =
    state => {

        const offline =
            selectOffline(
                state,
            );

        return Boolean(

            offline.initialized &&

            offline.enabled &&

            offline.hydrated &&

            offline.configuration
                .syncEnabled &&

            offline.connectivity.online &&

            offline.diagnostics.readiness ===
                'ready' &&

            offline.device.status !==
                'revoked'

        );

    };

const selectHasPendingWork =
    state =>
        selectQueueTotal(
            state,
        ) >
        0;

const selectHasBlockingConflicts =
    state =>
        selectFinancialConflicts(
            state,
        ).length >
        0;

const selectNeedsReconciliation =
    state =>
        selectOperations(
            state,
        ).some(
            operation =>
                operation
                    .requiresReconciliation ===
                true &&
                ![
                    OPERATION_STATES
                        .RECONCILED,
                    OPERATION_STATES
                        .SUCCEEDED,
                ].includes(
                    operation.state,
                ),
        );

/**
 * =============================================================================
 * Operational summary selector
 * =============================================================================
 */

const selectOfflineSummary =
    state => {

        const offline =
            selectOffline(
                state,
            );

        const conflicts =
            selectOpenConflicts(
                state,
            );

        return {

            enabled:
                offline.enabled,

            initialized:
                offline.initialized,

            hydrated:
                offline.hydrated,

            online:
                offline
                    .connectivity
                    .online,

            connectivity:
                offline
                    .connectivity
                    .state,

            syncState:
                offline
                    .sync
                    .state,

            syncProgress:
                offline
                    .sync
                    .progress,

            queueTotal:
                offline
                    .queue
                    .total,

            pending:
                offline
                    .queue
                    .pending,

            processing:
                offline
                    .queue
                    .processing,

            retryable:
                offline
                    .queue
                    .retryable,

            conflicts:
                conflicts.length,

            financialConflicts:
                conflicts.filter(
                    conflict =>
                        conflict.financial ===
                        true,
                ).length,

            canSync:
                selectCanSync(
                    state,
                ),

            hasPendingWork:
                selectHasPendingWork(
                    state,
                ),

            requiresReconciliation:
                selectNeedsReconciliation(
                    state,
                ),

            deviceReady:
                selectDeviceReady(
                    state,
                ),

            healthy:
                offline
                    .diagnostics
                    .health ===
                'healthy',

            ready:
                offline
                    .diagnostics
                    .readiness ===
                'ready',

            stale:
                offline
                    .diagnostics
                    .stale,

            lastSuccessAt:
                offline
                    .sync
                    .lastSuccessAt,

            lastFailureAt:
                offline
                    .sync
                    .lastFailureAt,

            lastCheckpoint:
                offline
                    .sync
                    .lastCheckpoint,

            lastUpdatedAt:
                offline
                    .lastUpdatedAt,

        };

    };

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports = {

    /**
     * Slice.
     */
    offlineSlice,

    reducer:
        offlineSlice.reducer,

    actions: {

        initialize,
        markHydrated,
        setEnabled,

        setConnectivity,
        setOnline,
        setOffline,
        setReconnecting,

        syncStarted,
        syncQueued,
        syncProgress,
        syncCompleted,
        syncFailed,
        syncPaused,
        syncCancelled,
        setSyncCursor,

        setQueueStatistics,
        incrementQueue,
        decrementQueue,

        operationAdded,
        operationUpdated,
        operationStateChanged,
        operationRemoved,
        clearOperations,
        replaceOperations,

        conflictDetected,
        conflictResolved,
        conflictEscalated,
        clearResolvedConflicts,

        eventRecorded,
        eventReconciled,
        clearEvents,

        setDeviceIdentity,
        deviceRegistered,
        deviceRevoked,
        deviceVerificationUpdated,

        setIdempotencyConfiguration,
        idempotencyStarted,
        idempotencyCompleted,
        idempotencyConflict,

        errorRecorded,
        clearLastError,
        clearErrors,

        setHealth,
        setReadiness,
        setStale,
        setCheckpoint,

        setConfiguration,
        hydrate,

        reset,

    },

    selectors: {

        selectOffline,

        selectInitialized,
        selectHydrated,
        selectEnabled,

        selectConnectivity,
        selectConnectivityState,
        selectIsOnline,

        selectSync,
        selectSyncState,
        selectSyncRunning,
        selectSyncProgress,

        selectQueue,
        selectQueueTotal,
        selectPendingCount,
        selectProcessingCount,
        selectRetryableCount,
        selectConflictCount,

        selectOperations,
        selectOperationById,

        selectConflicts,
        selectOpenConflicts,
        selectFinancialConflicts,

        selectEvents,

        selectDevice,
        selectDeviceId,
        selectDeviceFingerprint,
        selectDeviceReady,

        selectIdempotency,

        selectLastError,
        selectErrors,

        selectHealth,
        selectReadiness,
        selectIsStale,

        selectCheckpoint,
        selectCursor,

        selectConfiguration,

        selectCanSync,
        selectHasPendingWork,
        selectHasBlockingConflicts,
        selectNeedsReconciliation,

        selectOfflineSummary,

    },

    constants: {

        NAME,

        CONNECTIVITY_STATES,

        SYNC_STATES,

        OPERATION_STATES,

        CONFLICT_SEVERITIES,

        MAX_OPERATIONS,

        MAX_CONFLICTS,

        MAX_ERRORS,

        MAX_EVENTS,

        MAX_AUDIT_ENTRIES,

        DEFAULT_STALE_AFTER_MS,

    },

    initialState,

};