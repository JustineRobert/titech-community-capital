// ============================================================================
// TITech Community Capital
// Enterprise Audit Slice
// File: frontend/src/features/audit/auditSlice.js
// Production Grade
// ============================================================================

import {
    createAsyncThunk,
    createSelector,
    createSlice,
} from "@reduxjs/toolkit";

import api from "../../services/api";

// ============================================================================
// Constants
// ============================================================================

export const AUDIT_SEVERITY = Object.freeze({
    INFO: "info",
    WARNING: "warning",
    ERROR: "error",
    CRITICAL: "critical",
});

export const AUDIT_ACTIONS = Object.freeze({
    LOGIN: "LOGIN",
    LOGOUT: "LOGOUT",
    CREATE: "CREATE",
    UPDATE: "UPDATE",
    DELETE: "DELETE",
    VIEW: "VIEW",
    EXPORT: "EXPORT",
    APPROVE: "APPROVE",
    REJECT: "REJECT",
    TRANSFER: "TRANSFER",
    DISBURSE: "DISBURSE",
    WITHDRAW: "WITHDRAW",
    DEPOSIT: "DEPOSIT",
    SETTINGS_CHANGE: "SETTINGS_CHANGE",
    FEATURE_CHANGE: "FEATURE_CHANGE",
});

export const AUDIT_STATUS = Object.freeze({
    IDLE: "idle",
    LOADING: "loading",
    SUCCESS: "success",
    FAILED: "failed",
    EXPORTING: "exporting",
    CREATING: "creating",
});

export const AUDIT_SORT_DIRECTIONS = Object.freeze({
    ASC: "asc",
    DESC: "desc",
});

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_ENTRIES = 1000;
const MAX_ERROR_HISTORY = 25;

const DEFAULT_FILTERS = Object.freeze({
    search: "",
    userId: null,
    tenantId: null,
    action: null,
    severity: null,
    startDate: null,
    endDate: null,
    resourceType: null,
    resourceId: null,
    correlationId: null,
    ipAddress: null,
});

const DEFAULT_PAGINATION = Object.freeze({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 0,
});

const DEFAULT_REALTIME = Object.freeze({
    enabled: true,
    connected: false,
    lastReceived: null,
    connectionState: "disconnected",
});

const DEFAULT_STATS = Object.freeze({
    totalLogs: 0,
    critical: 0,
    errors: 0,
    warnings: 0,
    info: 0,
    today: 0,
});

// ============================================================================
// Helpers
// ============================================================================

function nowIso() {
    return new Date().toISOString();
}

function normalizePageSize(value) {
    const numeric = Number(value);

    if (!Number.isInteger(numeric)) {
        return PAGE_SIZE;
    }

    return Math.max(
        1,
        Math.min(
            MAX_PAGE_SIZE,
            numeric,
        ),
    );
}

function normalizePage(value) {
    const numeric = Number(value);

    if (!Number.isInteger(numeric)) {
        return 1;
    }

    return Math.max(1, numeric);
}

function normalizeError(error) {
    if (!error) {
        return null;
    }

    if (typeof error === "string") {
        return {
            name: "Error",
            code: "AUDIT_ERROR",
            message: error,
            statusCode: null,
            retryable: false,
            classification: null,
            requestId: null,
            timestamp: nowIso(),
        };
    }

    const responseData =
        error?.response?.data;

    const source =
        responseData &&
        typeof responseData === "object"
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
            "AUDIT_ERROR",

        message:
            source?.message ||
            source?.error ||
            error?.message ||
            "Audit operation failed.",

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
        normalizeError(error);

    if (!normalized) {
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

function normalizeAuditEntry(
    entry,
) {
    if (
        !entry ||
        typeof entry !== "object"
    ) {
        return null;
    }

    return {
        ...entry,

        id:
            entry.id ||
            entry._id ||
            entry.auditId ||
            null,

        severity:
            entry.severity ||
            AUDIT_SEVERITY.INFO,

        action:
            entry.action ||
            null,

        timestamp:
            entry.timestamp ||
            entry.createdAt ||
            nowIso(),
    };
}

function upsertEntry(
    entries,
    entry,
) {
    const normalized =
        normalizeAuditEntry(entry);

    if (!normalized) {
        return entries;
    }

    if (!normalized.id) {
        return [
            normalized,
            ...entries,
        ].slice(
            0,
            MAX_ENTRIES,
        );
    }

    const index =
        entries.findIndex(
            current =>
                current?.id ===
                normalized.id,
        );

    if (index === -1) {
        return [
            normalized,
            ...entries,
        ].slice(
            0,
            MAX_ENTRIES,
        );
    }

    const next =
        [
            ...entries,
        ];

    next[index] = {
        ...next[index],
        ...normalized,
    };

    return next;
}

function removeEntryById(
    entries,
    id,
) {
    return entries.filter(
        entry =>
            entry?.id !== id,
    );
}

function normalizeEntries(
    value,
) {
    if (!Array.isArray(value)) {
        return [];
    }

    const unique =
        new Map();

    for (const rawEntry of value) {
        const entry =
            normalizeAuditEntry(
                rawEntry,
            );

        if (!entry) {
            continue;
        }

        const key =
            entry.id ||
            `${entry.timestamp}:${entry.action}:${entry.userId || ""}`;

        if (!unique.has(key)) {
            unique.set(
                key,
                entry,
            );
        }
    }

    return Array.from(
        unique.values(),
    ).slice(
        0,
        MAX_ENTRIES,
    );
}

function calculateTodayCount(
    entries,
) {
    const today =
        new Date();

    const year =
        today.getUTCFullYear();

    const month =
        today.getUTCMonth();

    const date =
        today.getUTCDate();

    return entries.filter(
        entry => {
            const timestamp =
                new Date(
                    entry.timestamp,
                );

            return (
                timestamp.getUTCFullYear() ===
                    year &&
                timestamp.getUTCMonth() ===
                    month &&
                timestamp.getUTCDate() ===
                    date
            );
        },
    ).length;
}

function calculateVisibleStats(
    entries,
    existingStats = DEFAULT_STATS,
) {
    let critical = 0;
    let errors = 0;
    let warnings = 0;
    let info = 0;

    for (const entry of entries) {
        switch (entry.severity) {
            case AUDIT_SEVERITY.CRITICAL:
                critical += 1;
                break;

            case AUDIT_SEVERITY.ERROR:
                errors += 1;
                break;

            case AUDIT_SEVERITY.WARNING:
                warnings += 1;
                break;

            default:
                info += 1;
                break;
        }
    }

    return {
        ...existingStats,
        critical,
        errors,
        warnings,
        info,
        today:
            calculateTodayCount(
                entries,
            ),
    };
}

function mergePagination(
    current,
    incoming,
) {
    if (
        !incoming ||
        typeof incoming !== "object"
    ) {
        return current;
    }

    const limit =
        normalizePageSize(
            incoming.limit ??
            current.limit,
        );

    const page =
        normalizePage(
            incoming.page ??
            current.page,
        );

    const total =
        Number.isFinite(
            Number(
                incoming.total,
            ),
        )
            ? Number(
                incoming.total,
            )
            : current.total;

    const totalPages =
        Number.isFinite(
            Number(
                incoming.totalPages,
            ),
        )
            ? Number(
                incoming.totalPages,
            )
            : (
                total > 0
                    ? Math.ceil(
                        total /
                        limit,
                    )
                    : 0
            );

    return {
        ...current,
        ...incoming,
        page,
        limit,
        total,
        totalPages,
    };
}

function mergeFilters(
    current,
    incoming,
) {
    if (
        !incoming ||
        typeof incoming !== "object"
    ) {
        return current;
    }

    return {
        ...current,
        ...incoming,
    };
}

// ============================================================================
// Async Thunks
// ============================================================================

export const fetchAuditLogs =
    createAsyncThunk(
        "audit/fetchAuditLogs",

        async (
            params = {},
            {
                rejectWithValue,
                signal,
            },
        ) => {
            try {
                const response =
                    await api.get(
                        "/api/audit",
                        {
                            params: {
                                page:
                                    normalizePage(
                                        params.page ||
                                        1,
                                    ),

                                limit:
                                    normalizePageSize(
                                        params.limit ||
                                        PAGE_SIZE,
                                    ),

                                ...params,
                            },

                            signal,
                        },
                    );

                return (
                    response?.data ??
                    response ??
                    {}
                );
            } catch (error) {
                return rejectWithValue(
                    normalizeError(
                        error,
                    ),
                );
            }
        },
    );

export const exportAuditLogs =
    createAsyncThunk(
        "audit/exportAuditLogs",

        async (
            params = {},
            {
                rejectWithValue,
                signal,
            },
        ) => {
            try {
                const response =
                    await api.get(
                        "/api/audit/export",
                        {
                            params,

                            responseType:
                                "blob",

                            signal,
                        },
                    );

                return {
                    data:
                        response?.data ??
                        response,

                    filename:
                        extractFilename(
                            response,
                        ),

                    contentType:
                        response?.headers
                            ?.["content-type"] ||
                        null,
                };
            } catch (error) {
                return rejectWithValue(
                    normalizeError(
                        error,
                    ),
                );
            }
        },
    );

export const createAuditEntry =
    createAsyncThunk(
        "audit/createAuditEntry",

        async (
            payload,
            {
                rejectWithValue,
                signal,
            },
        ) => {
            try {
                const response =
                    await api.post(
                        "/api/audit",
                        payload,
                        {
                            signal,
                        },
                    );

                return (
                    response?.data ??
                    response ??
                    null
                );
            } catch (error) {
                return rejectWithValue(
                    normalizeError(
                        error,
                    ),
                );
            }
        },
    );

// ============================================================================
// Filename Helper
// ============================================================================

function extractFilename(
    response,
) {
    const disposition =
        response?.headers
            ?.["content-disposition"];

    if (!disposition) {
        return null;
    }

    const match =
        disposition.match(
            /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i,
        );

    return match?.[1] ||
        null;
}

// ============================================================================
// Initial State
// ============================================================================

function createInitialState() {
    return {
        entries: [],

        selectedEntry:
            null,

        pagination: {
            ...DEFAULT_PAGINATION,
        },

        filters: {
            ...DEFAULT_FILTERS,
        },

        sort: {
            field:
                "timestamp",

            direction:
                AUDIT_SORT_DIRECTIONS
                    .DESC,
        },

        realtime: {
            ...DEFAULT_REALTIME,
        },

        loading:
            false,

        exporting:
            false,

        creating:
            false,

        error:
            null,

        errors: [],

        initialized:
            false,

        hydrated:
            false,

        lastFetchedAt:
            null,

        lastCreatedAt:
            null,

        lastExportedAt:
            null,

        stats: {
            ...DEFAULT_STATS,
        },

        metadata: {
            lastRequestId:
                null,

            lastExportRequestId:
                null,

            lastCreateRequestId:
                null,
        },
    };
}

const initialState =
    createInitialState();

// ============================================================================
// Slice
// ============================================================================

const auditSlice =
    createSlice({

        name:
            "audit",

        initialState,

        reducers: {

            // ------------------------------------------------------------------
            // Initialization
            // ------------------------------------------------------------------

            initializeAudit(
                state,
                action,
            ) {
                state.initialized =
                    true;

                state.hydrated =
                    action.payload
                        ?.hydrated ??
                    state.hydrated;
            },

            hydrateAudit(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                if (
                    Array.isArray(
                        payload.entries,
                    )
                ) {
                    state.entries =
                        normalizeEntries(
                            payload.entries,
                        );
                }

                if (
                    payload.pagination
                ) {
                    state.pagination =
                        mergePagination(
                            state.pagination,
                            payload.pagination,
                        );
                }

                if (
                    payload.filters
                ) {
                    state.filters =
                        mergeFilters(
                            state.filters,
                            payload.filters,
                        );
                }

                if (
                    payload.realtime
                ) {
                    state.realtime =
                        {
                            ...state.realtime,
                            ...payload.realtime,
                        };
                }

                if (
                    payload.stats
                ) {
                    state.stats =
                        {
                            ...state.stats,
                            ...payload.stats,
                        };
                } else {
                    state.stats =
                        calculateVisibleStats(
                            state.entries,
                            state.stats,
                        );
                }

                state.hydrated =
                    true;

                state.initialized =
                    true;
            },

            // ------------------------------------------------------------------
            // Entry management
            // ------------------------------------------------------------------

            clearAudit(
                state,
            ) {
                state.entries =
                    [];

                state.selectedEntry =
                    null;

                state.pagination =
                    {
                        ...DEFAULT_PAGINATION,
                    };

                state.error =
                    null;

                state.stats =
                    {
                        ...DEFAULT_STATS,
                    };
            },

            replaceAuditEntries(
                state,
                action,
            ) {
                state.entries =
                    normalizeEntries(
                        action.payload,
                    );

                state.stats =
                    calculateVisibleStats(
                        state.entries,
                        state.stats,
                    );
            },

            setSelectedAuditEntry(
                state,
                action,
            ) {
                state.selectedEntry =
                    action.payload ||
                    null;
            },

            clearSelectedAuditEntry(
                state,
            ) {
                state.selectedEntry =
                    null;
            },

            addAuditEntry(
                state,
                action,
            ) {
                state.entries =
                    upsertEntry(
                        state.entries,
                        action.payload,
                    );

                state.stats =
                    calculateVisibleStats(
                        state.entries,
                        state.stats,
                    );
            },

            addRealtimeAuditEntry(
                state,
                action,
            ) {
                const entry =
                    normalizeAuditEntry(
                        action.payload,
                    );

                if (!entry) {
                    return;
                }

                state.entries =
                    upsertEntry(
                        state.entries,
                        entry,
                    );

                state.realtime
                    .lastReceived =
                    nowIso();

                state.realtime
                    .connectionState =
                    "connected";

                state.stats =
                    calculateVisibleStats(
                        state.entries,
                        {
                            ...state.stats,
                            totalLogs:
                                Math.max(
                                    state.stats
                                        .totalLogs +
                                    1,
                                    state.stats
                                        .totalLogs,
                                ),
                        },
                    );
            },

            removeAuditEntry(
                state,
                action,
            ) {
                const id =
                    typeof action.payload ===
                        "object"
                        ? (
                            action.payload
                                ?.id ||
                            action.payload
                                ?._id ||
                            action.payload
                                ?.auditId
                        )
                        : action.payload;

                if (!id) {
                    return;
                }

                state.entries =
                    removeEntryById(
                        state.entries,
                        id,
                    );

                if (
                    state.selectedEntry?.id ===
                    id
                ) {
                    state.selectedEntry =
                        null;
                }

                state.stats =
                    calculateVisibleStats(
                        state.entries,
                        {
                            ...state.stats,
                            totalLogs:
                                Math.max(
                                    0,
                                    state.stats
                                        .totalLogs -
                                    1,
                                ),
                        },
                    );
            },

            // ------------------------------------------------------------------
            // Filters
            // ------------------------------------------------------------------

            setAuditFilters(
                state,
                action,
            ) {
                state.filters =
                    mergeFilters(
                        state.filters,
                        action.payload,
                    );

                /**
                 * Filter changes should normally reset pagination to page 1.
                 */
                state.pagination.page =
                    1;
            },

            resetAuditFilters(
                state,
            ) {
                state.filters =
                    {
                        ...DEFAULT_FILTERS,
                    };

                state.pagination.page =
                    1;
            },

            // ------------------------------------------------------------------
            // Sorting
            // ------------------------------------------------------------------

            setAuditSort(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                state.sort = {
                    field:
                        payload.field ||
                        state.sort.field,

                    direction:
                        [
                            AUDIT_SORT_DIRECTIONS
                                .ASC,
                            AUDIT_SORT_DIRECTIONS
                                .DESC,
                        ].includes(
                            payload.direction,
                        )
                            ? payload.direction
                            : state.sort
                                .direction,
                };
            },

            toggleAuditSort(
                state,
                action,
            ) {
                const field =
                    action.payload ||
                    state.sort.field;

                if (
                    state.sort.field ===
                    field
                ) {
                    state.sort.direction =
                        state.sort.direction ===
                            AUDIT_SORT_DIRECTIONS
                                .ASC
                            ? AUDIT_SORT_DIRECTIONS
                                .DESC
                            : AUDIT_SORT_DIRECTIONS
                                .ASC;
                } else {
                    state.sort.field =
                        field;

                    state.sort.direction =
                        AUDIT_SORT_DIRECTIONS
                            .DESC;
                }
            },

            // ------------------------------------------------------------------
            // Pagination
            // ------------------------------------------------------------------

            setAuditPagination(
                state,
                action,
            ) {
                state.pagination =
                    mergePagination(
                        state.pagination,
                        action.payload,
                    );
            },

            setAuditPage(
                state,
                action,
            ) {
                state.pagination.page =
                    normalizePage(
                        action.payload,
                    );
            },

            setAuditPageSize(
                state,
                action,
            ) {
                state.pagination.limit =
                    normalizePageSize(
                        action.payload,
                    );

                state.pagination.page =
                    1;
            },

            // ------------------------------------------------------------------
            // Realtime
            // ------------------------------------------------------------------

            setRealtimeEnabled(
                state,
                action,
            ) {
                state.realtime.enabled =
                    Boolean(
                        action.payload,
                    );
            },

            setRealtimeConnected(
                state,
                action,
            ) {
                const connected =
                    Boolean(
                        typeof action.payload ===
                            "object"
                            ? action.payload
                                ?.connected
                            : action.payload,
                    );

                state.realtime.connected =
                    connected;

                state.realtime
                    .connectionState =
                    connected
                        ? "connected"
                        : "disconnected";

                if (
                    typeof action.payload ===
                    "object" &&
                    action.payload
                        ?.lastReceived
                ) {
                    state.realtime
                        .lastReceived =
                        action.payload
                            .lastReceived;
                }
            },

            setRealtimeConnectionState(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                state.realtime =
                    {
                        ...state.realtime,
                        ...payload,
                    };

                state.realtime.connected =
                    payload.connected ??
                    (
                        payload
                            .connectionState ===
                        "connected"
                    );
            },

            // ------------------------------------------------------------------
            // Statistics
            // ------------------------------------------------------------------

            updateAuditStats(
                state,
                action,
            ) {
                state.stats =
                    {
                        ...state.stats,
                        ...(action.payload ||
                            {}),
                    };
            },

            // ------------------------------------------------------------------
            // Error handling
            // ------------------------------------------------------------------

            clearAuditError(
                state,
            ) {
                state.error =
                    null;
            },

            clearAuditErrors(
                state,
            ) {
                state.error =
                    null;

                state.errors =
                    [];
            },

            // ------------------------------------------------------------------
            // Reset
            // ------------------------------------------------------------------

            resetAuditState() {
                return createInitialState();
            },
        },

        extraReducers:
            builder => {

                // ==============================================================
                // Fetch logs
                // ==============================================================

                builder
                    .addCase(
                        fetchAuditLogs.pending,
                        (
                            state,
                            action,
                        ) => {
                            state.loading =
                                true;

                            state.error =
                                null;

                            state.metadata
                                .lastRequestId =
                                action.meta
                                    ?.requestId;
                        },
                    )

                    .addCase(
                        fetchAuditLogs.fulfilled,
                        (
                            state,
                            action,
                        ) => {

                            state.loading =
                                false;

                            const payload =
                                action.payload ||
                                {};

                            const entries =
                                payload.data ||
                                payload.entries ||
                                payload.results ||
                                [];

                            state.entries =
                                normalizeEntries(
                                    entries,
                                );

                            if (
                                payload.pagination
                            ) {
                                state.pagination =
                                    mergePagination(
                                        state.pagination,
                                        payload.pagination,
                                    );
                            }

                            if (
                                payload.stats
                            ) {
                                state.stats =
                                    {
                                        ...state.stats,
                                        ...payload.stats,
                                    };
                            } else {
                                state.stats =
                                    calculateVisibleStats(
                                        state.entries,
                                        state.stats,
                                    );
                            }

                            state.initialized =
                                true;

                            state.hydrated =
                                true;

                            state.lastFetchedAt =
                                nowIso();

                            state.error =
                                null;
                        },
                    )

                    .addCase(
                        fetchAuditLogs.rejected,
                        (
                            state,
                            action,
                        ) => {

                            state.loading =
                                false;

                            const error =
                                normalizeError(
                                    action.payload ||
                                    action.error,
                                );

                            addErrorHistory(
                                state,
                                error,
                            );
                        },
                    );

                // ==============================================================
                // Export
                // ==============================================================

                builder
                    .addCase(
                        exportAuditLogs.pending,
                        (
                            state,
                            action,
                        ) => {

                            state.exporting =
                                true;

                            state.error =
                                null;

                            state.metadata
                                .lastExportRequestId =
                                action.meta
                                    ?.requestId;
                        },
                    )

                    .addCase(
                        exportAuditLogs.fulfilled,
                        (
                            state,
                        ) => {

                            state.exporting =
                                false;

                            state.lastExportedAt =
                                nowIso();

                            state.error =
                                null;
                        },
                    )

                    .addCase(
                        exportAuditLogs.rejected,
                        (
                            state,
                            action,
                        ) => {

                            state.exporting =
                                false;

                            const error =
                                normalizeError(
                                    action.payload ||
                                    action.error,
                                );

                            addErrorHistory(
                                state,
                                error,
                            );
                        },
                    );

                // ==============================================================
                // Create audit entry
                // ==============================================================

                builder
                    .addCase(
                        createAuditEntry.pending,
                        (
                            state,
                            action,
                        ) => {

                            state.creating =
                                true;

                            state.error =
                                null;

                            state.metadata
                                .lastCreateRequestId =
                                action.meta
                                    ?.requestId;
                        },
                    )

                    .addCase(
                        createAuditEntry.fulfilled,
                        (
                            state,
                            action,
                        ) => {

                            state.creating =
                                false;

                            const entry =
                                normalizeAuditEntry(
                                    action.payload,
                                );

                            if (
                                entry
                            ) {
                                state.entries =
                                    upsertEntry(
                                        state.entries,
                                        entry,
                                    );
                            }

                            state.lastCreatedAt =
                                nowIso();

                            state.stats =
                                calculateVisibleStats(
                                    state.entries,
                                    {
                                        ...state.stats,
                                        totalLogs:
                                            Math.max(
                                                state
                                                    .stats
                                                    .totalLogs +
                                                1,
                                                state
                                                    .stats
                                                    .totalLogs,
                                            ),
                                    },
                                );

                            state.error =
                                null;
                        },
                    )

                    .addCase(
                        createAuditEntry.rejected,
                        (
                            state,
                            action,
                        ) => {

                            state.creating =
                                false;

                            const error =
                                normalizeError(
                                    action.payload ||
                                    action.error,
                                );

                            addErrorHistory(
                                state,
                                error,
                            );
                        },
                    );
            },
    });

// ============================================================================
// Actions
// ============================================================================

export const {
    initializeAudit,
    hydrateAudit,

    clearAudit,
    replaceAuditEntries,

    setSelectedAuditEntry,
    clearSelectedAuditEntry,

    addAuditEntry,
    addRealtimeAuditEntry,
    removeAuditEntry,

    setAuditFilters,
    resetAuditFilters,

    setAuditSort,
    toggleAuditSort,

    setAuditPagination,
    setAuditPage,
    setAuditPageSize,

    setRealtimeEnabled,
    setRealtimeConnected,
    setRealtimeConnectionState,

    updateAuditStats,

    clearAuditError,
    clearAuditErrors,

    resetAuditState,
} =
    auditSlice.actions;

// ============================================================================
// Base Selectors
// ============================================================================

export const selectAudit =
    state =>
        state?.audit || createInitialState();

export const selectAuditEntries =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.entries,
    );

export const selectAuditLoading =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.loading,
    );

export const selectAuditExporting =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.exporting,
    );

export const selectAuditCreating =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.creating,
    );

export const selectAuditError =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.error,
    );

export const selectAuditErrors =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.errors,
    );

export const selectAuditStats =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.stats,
    );

export const selectAuditFilters =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.filters,
    );

export const selectAuditPagination =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.pagination,
    );

export const selectAuditSort =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.sort,
    );

export const selectSelectedAuditEntry =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.selectedEntry,
    );

export const selectAuditRealtime =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.realtime,
    );

export const selectAuditInitialized =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.initialized,
    );

export const selectAuditHydrated =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.hydrated,
    );

export const selectAuditLastFetchedAt =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.lastFetchedAt,
    );

export const selectAuditLastCreatedAt =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.lastCreatedAt,
    );

export const selectAuditLastExportedAt =
    createSelector(
        [
            selectAudit,
        ],
        audit =>
            audit.lastExportedAt,
    );

// ============================================================================
// Filtered / Derived Selectors
// ============================================================================

export const selectCriticalLogs =
    createSelector(
        [
            selectAuditEntries,
        ],
        entries =>
            entries.filter(
                entry =>
                    entry.severity ===
                    AUDIT_SEVERITY.CRITICAL,
            ),
    );

export const selectErrorLogs =
    createSelector(
        [
            selectAuditEntries,
        ],
        entries =>
            entries.filter(
                entry =>
                    entry.severity ===
                    AUDIT_SEVERITY.ERROR,
            ),
    );

export const selectWarningLogs =
    createSelector(
        [
            selectAuditEntries,
        ],
        entries =>
            entries.filter(
                entry =>
                    entry.severity ===
                    AUDIT_SEVERITY.WARNING,
            ),
    );

export const selectInfoLogs =
    createSelector(
        [
            selectAuditEntries,
        ],
        entries =>
            entries.filter(
                entry =>
                    entry.severity ===
                    AUDIT_SEVERITY.INFO,
            ),
    );

export const selectAuditByUser =
    userId =>
        createSelector(
            [
                selectAuditEntries,
            ],
            entries =>
                entries.filter(
                    entry =>
                        entry.userId ===
                        userId,
                ),
        );

export const selectAuditByAction =
    action =>
        createSelector(
            [
                selectAuditEntries,
            ],
            entries =>
                entries.filter(
                    entry =>
                        entry.action ===
                        action,
                ),
        );

export const selectAuditBySeverity =
    severity =>
        createSelector(
            [
                selectAuditEntries,
            ],
            entries =>
                entries.filter(
                    entry =>
                        entry.severity ===
                        severity,
                ),
        );

export const selectAuditByTenant =
    tenantId =>
        createSelector(
            [
                selectAuditEntries,
            ],
            entries =>
                entries.filter(
                    entry =>
                        entry.tenantId ===
                        tenantId,
                ),
        );

export const selectAuditByResource =
    (
        resourceType,
        resourceId,
    ) =>
        createSelector(
            [
                selectAuditEntries,
            ],
            entries =>
                entries.filter(
                    entry =>
                        (
                            !resourceType ||
                            entry.resourceType ===
                                resourceType
                        ) &&
                        (
                            !resourceId ||
                            entry.resourceId ===
                                resourceId
                        ),
                ),
        );

export const selectAuditEntryById =
    id =>
        createSelector(
            [
                selectAuditEntries,
            ],
            entries =>
                entries.find(
                    entry =>
                        entry.id ===
                        id,
                ) || null,
        );

// ============================================================================
// Audit Summary
// ============================================================================

export const selectAuditSummary =
    createSelector(
        [
            selectAudit,
            selectAuditStats,
            selectAuditPagination,
        ],
        (
            audit,
            stats,
            pagination,
        ) => ({
            initialized:
                audit.initialized,

            hydrated:
                audit.hydrated,

            loading:
                audit.loading,

            exporting:
                audit.exporting,

            creating:
                audit.creating,

            entryCount:
                audit.entries.length,

            totalLogs:
                stats.totalLogs,

            critical:
                stats.critical,

            errors:
                stats.errors,

            warnings:
                stats.warnings,

            info:
                stats.info,

            today:
                stats.today,

            currentPage:
                pagination.page,

            totalPages:
                pagination.totalPages,

            realtimeConnected:
                audit.realtime.connected,

            realtimeEnabled:
                audit.realtime.enabled,

            hasError:
                Boolean(
                    audit.error,
                ),

            lastFetchedAt:
                audit.lastFetchedAt,

            lastCreatedAt:
                audit.lastCreatedAt,

            lastExportedAt:
                audit.lastExportedAt,
        }),
    );

// ============================================================================
// Reducer
// ============================================================================

export default auditSlice.reducer;