/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   frontend/src/features/onboarding/onboardingSlice.js
 *
 * Purpose:
 *   Enterprise production-grade Redux Toolkit state management for the TITech
 *   SACCO / community-finance onboarding lifecycle.
 *
 * Responsibilities
 * =============================================================================
 *
 *   ✓ Manage onboarding draft state.
 *   ✓ Manage registration lifecycle.
 *   ✓ Manage KYC lifecycle.
 *   ✓ Manage subscription lifecycle.
 *   ✓ Manage payment initialization lifecycle.
 *   ✓ Manage go-live lifecycle.
 *   ✓ Track uploaded onboarding documents.
 *   ✓ Track current/completed onboarding steps.
 *   ✓ Calculate bounded onboarding progress.
 *   ✓ Normalize API/thunk errors.
 *   ✓ Prevent duplicate document entries.
 *   ✓ Prevent invalid step transitions.
 *   ✓ Preserve retry-safe status information.
 *   ✓ Expose production-ready selectors.
 *   ✓ Remain serializable Redux state.
 *
 * IMPORTANT
 * =============================================================================
 *
 *   This slice does NOT:
 *
 *     - perform HTTP requests directly;
 *     - persist secrets;
 *     - store payment credentials;
 *     - store JWT/private keys;
 *     - perform KYC verification itself;
 *     - authorize financial transactions;
 *     - commit subscription payments;
 *     - activate a SACCO outside the authoritative backend;
 *
 *   API/network responsibilities belong to:
 *
 *       frontend/src/services/onboardingService
 *
 *   The backend remains authoritative for:
 *
 *       registration
 *       KYC
 *       subscription
 *       payment
 *       go-live activation
 *
 * =============================================================================
 */

import {
    createAsyncThunk,
    createSlice,
} from "@reduxjs/toolkit";

import OnboardingAPI from "../../services/onboardingService";

/* =============================================================================
 * Constants
 * =============================================================================
 */

export const ONBOARDING_STEPS = Object.freeze({
    REGISTRATION: 1,
    KYC: 2,
    SUBSCRIPTION: 3,
    PAYMENT: 4,
    VERIFICATION: 5,
    GO_LIVE: 6,
});

export const ONBOARDING_TOTAL_STEPS = 6;

export const ONBOARDING_STATUS = Object.freeze({
    IDLE: "idle",
    LOADING: "loading",
    SUCCESS: "success",
    FAILED: "failed",
    PENDING: "pending",
    BLOCKED: "blocked",
});

const MAX_UPLOADED_FILES = 100;

const MAX_COMPLETED_STEPS =
    ONBOARDING_TOTAL_STEPS;

const MAX_ERROR_HISTORY = 25;

/* =============================================================================
 * Initial State Factories
 * =============================================================================
 *
 * Factories prevent accidental shared references when resetting the slice.
 * =============================================================================
 */

function createOperationState() {
    return {
        data: null,
        status: ONBOARDING_STATUS.IDLE,
        loading: false,
        error: null,
        success: null,
        requestId: null,
        startedAt: null,
        completedAt: null,
        lastAttemptAt: null,
    };
}

function createPaymentState() {
    return {
        data: null,
        provider: null,
        status: ONBOARDING_STATUS.IDLE,
        loading: false,
        error: null,
        success: null,
        requestId: null,
        startedAt: null,
        completedAt: null,
        lastAttemptAt: null,
    };
}

function createGoLiveState() {
    return {
        data: null,
        status: ONBOARDING_STATUS.IDLE,
        loading: false,
        error: null,
        success: null,
        requestId: null,
        startedAt: null,
        completedAt: null,
        lastAttemptAt: null,
    };
}

function createInitialState() {
    return {
        initialized: false,

        draft: null,

        registration:
            createOperationState(),

        kyc:
            createOperationState(),

        subscription:
            createOperationState(),

        payment:
            createPaymentState(),

        goLive:
            createGoLiveState(),

        uploadedFiles: [],

        onboardingProgress: 0,

        currentStep:
            ONBOARDING_STEPS.REGISTRATION,

        completedSteps: [],

        errors: [],

        lastError: null,

        lastUpdatedAt: null,

        metadata: {
            saccoId: null,
            onboardingId: null,
            tenantId: null,
            userId: null,
            createdAt: null,
            updatedAt: null,
        },
    };
}

const initialState =
    createInitialState();

/* =============================================================================
 * Utility Functions
 * =============================================================================
 */

function nowIso() {
    return new Date().toISOString();
}

function normalizeError(error) {
    if (!error) {
        return null;
    }

    if (
        typeof error ===
        "string"
    ) {
        return {
            name: "Error",
            code: "ONBOARDING_ERROR",
            message: error,
            statusCode: null,
            retryable: false,
            details: null,
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
            error?.name ||
            "Error",

        code:
            source?.code ||
            error?.code ||
            "ONBOARDING_ERROR",

        message:
            source?.message ||
            source?.error ||
            error?.message ||
            "Onboarding operation failed.",

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

        details:
            source?.details ||
            source?.errors ||
            null,

        timestamp:
            nowIso(),
    };
}

function normalizeRejectedPayload(
    error,
) {
    return normalizeError(
        error,
    );
}

function markUpdated(
    state,
) {
    state.lastUpdatedAt =
        nowIso();
}

function markOperationPending(
    operation,
    requestId,
) {
    operation.loading = true;
    operation.status =
        ONBOARDING_STATUS.LOADING;
    operation.error = null;
    operation.success = null;
    operation.requestId =
        requestId ||
        null;
    operation.startedAt =
        nowIso();
    operation.lastAttemptAt =
        operation.startedAt;
}

function markOperationSuccess(
    operation,
    data,
    message,
    requestId,
) {
    operation.loading = false;
    operation.status =
        ONBOARDING_STATUS.SUCCESS;
    operation.data =
        data;
    operation.error = null;
    operation.success =
        message ||
        null;
    operation.requestId =
        requestId ||
        operation.requestId;
    operation.completedAt =
        nowIso();
}

function markOperationFailure(
    operation,
    error,
    requestId,
) {
    const normalized =
        normalizeError(
            error,
        );

    operation.loading = false;
    operation.status =
        ONBOARDING_STATUS.FAILED;
    operation.error =
        normalized;
    operation.success = null;
    operation.requestId =
        requestId ||
        operation.requestId;
}

function calculateProgress(
    completedSteps,
) {
    const uniqueSteps =
        [
            ...new Set(
                completedSteps
                    .filter(
                        Number.isInteger,
                    )
                    .filter(
                        step =>
                            step >= 1 &&
                            step <=
                                ONBOARDING_TOTAL_STEPS,
                    ),
            ),
        ];

    return Math.round(
        (
            uniqueSteps.length /
            ONBOARDING_TOTAL_STEPS
        ) *
        100,
    );
}

function normalizeStep(
    step,
) {
    const numeric =
        Number(step);

    if (
        !Number.isInteger(
            numeric,
        )
    ) {
        return null;
    }

    if (
        numeric < 1 ||
        numeric >
            ONBOARDING_TOTAL_STEPS
    ) {
        return null;
    }

    return numeric;
}

function addCompletedStep(
    state,
    step,
) {
    const normalized =
        normalizeStep(
            step,
        );

    if (
        normalized === null
    ) {
        return;
    }

    if (
        !state.completedSteps.includes(
            normalized,
        )
    ) {
        state.completedSteps.push(
            normalized,
        );
    }

    state.completedSteps =
        state.completedSteps
            .sort(
                (a, b) =>
                    a - b,
            )
            .slice(
                0,
                MAX_COMPLETED_STEPS,
            );

    state.onboardingProgress =
        calculateProgress(
            state.completedSteps,
        );
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

    state.lastError =
        normalized;

    state.errors =
        [
            ...state.errors,
            normalized,
        ].slice(
            -MAX_ERROR_HISTORY,
        );
}

function normalizeUploadedFile(
    file,
) {
    if (
        !file ||
        typeof file !==
            "object"
    ) {
        return null;
    }

    return {
        id:
            file.id ||
            file.fileId ||
            null,

        name:
            file.name ||
            file.filename ||
            null,

        originalName:
            file.originalName ||
            file.originalname ||
            file.name ||
            null,

        size:
            Number.isFinite(
                Number(
                    file.size,
                ),
            )
                ? Number(
                    file.size,
                )
                : null,

        mimeType:
            file.mimeType ||
            file.mimetype ||
            null,

        url:
            file.url ||
            null,

        status:
            file.status ||
            "uploaded",

        uploadedAt:
            file.uploadedAt ||
            nowIso(),

        checksum:
            file.checksum ||
            null,
    };
}

function upsertUploadedFile(
    files,
    file,
) {
    const normalized =
        normalizeUploadedFile(
            file,
        );

    if (
        !normalized
    ) {
        return files;
    }

    if (
        !normalized.id
    ) {
        return [
            ...files,
            normalized,
        ].slice(
            -MAX_UPLOADED_FILES,
        );
    }

    const index =
        files.findIndex(
            current =>
                current?.id ===
                normalized.id,
        );

    if (
        index === -1
    ) {
        return [
            ...files,
            normalized,
        ].slice(
            -MAX_UPLOADED_FILES,
        );
    }

    const next =
        [
            ...files,
        ];

    next[index] =
        {
            ...next[index],
            ...normalized,
        };

    return next;
}

function normalizeSaccoId(
    payload,
) {
    return (
        payload?.saccoId ||
        payload?.sacco?._id ||
        payload?.sacco?.id ||
        payload?.data?.saccoId ||
        payload?.data?.sacco?._id ||
        payload?.data?.sacco?.id ||
        null
    );
}

function extractEntityData(
    response,
) {
    if (
        response?.data !==
        undefined
    ) {
        return response.data;
    }

    return response;
}

/**
 * =============================================================================
 * Thunks
 * =============================================================================
 */

export const registerSacco =
    createAsyncThunk(
        "onboarding/registerSacco",

        async (
            formData,
            thunkAPI,
        ) => {
            try {
                const response =
                    await OnboardingAPI
                        .registerSacco(
                            formData,
                        );

                return {
                    data:
                        extractEntityData(
                            response,
                        ),

                    raw:
                        response,

                    saccoId:
                        normalizeSaccoId(
                            response,
                        ),
                };
            } catch (
                error
            ) {
                return thunkAPI
                    .rejectWithValue(
                        normalizeRejectedPayload(
                            error,
                        ),
                    );
            }
        },
    );

export const verifyKYC =
    createAsyncThunk(
        "onboarding/verifyKYC",

        async (
            {
                saccoId,
                payload,
            } = {},
            thunkAPI,
        ) => {
            if (
                !saccoId
            ) {
                return thunkAPI
                    .rejectWithValue(
                        normalizeError(
                            "SACCO ID is required for KYC verification.",
                        ),
                    );
            }

            try {
                const response =
                    await OnboardingAPI
                        .verifyKYC(
                            saccoId,
                            payload,
                        );

                return {
                    data:
                        extractEntityData(
                            response,
                        ),

                    raw:
                        response,

                    saccoId,
                };
            } catch (
                error
            ) {
                return thunkAPI
                    .rejectWithValue(
                        normalizeRejectedPayload(
                            error,
                        ),
                    );
            }
        },
    );

export const setupSubscription =
    createAsyncThunk(
        "onboarding/setupSubscription",

        async (
            {
                saccoId,
                payload,
            } = {},
            thunkAPI,
        ) => {
            if (
                !saccoId
            ) {
                return thunkAPI
                    .rejectWithValue(
                        normalizeError(
                            "SACCO ID is required for subscription setup.",
                        ),
                    );
            }

            try {
                const response =
                    await OnboardingAPI
                        .setupSubscription(
                            saccoId,
                            payload,
                        );

                return {
                    data:
                        extractEntityData(
                            response,
                        ),

                    raw:
                        response,

                    saccoId,
                };
            } catch (
                error
            ) {
                return thunkAPI
                    .rejectWithValue(
                        normalizeRejectedPayload(
                            error,
                        ),
                    );
            }
        },
    );

export const initializePayment =
    createAsyncThunk(
        "onboarding/initializePayment",

        async (
            payload,
            thunkAPI,
        ) => {
            if (
                !payload ||
                typeof payload !==
                    "object"
            ) {
                return thunkAPI
                    .rejectWithValue(
                        normalizeError(
                            "Payment initialization payload is required.",
                        ),
                    );
            }

            try {
                const response =
                    await OnboardingAPI
                        .initializePayment(
                            payload,
                        );

                return {
                    data:
                        extractEntityData(
                            response,
                        ),

                    raw:
                        response,

                    provider:
                        payload.provider ||
                        null,

                    saccoId:
                        payload.saccoId ||
                        null,
                };
            } catch (
                error
            ) {
                return thunkAPI
                    .rejectWithValue(
                        normalizeRejectedPayload(
                            error,
                        ),
                    );
            }
        },
    );

export const activateGoLive =
    createAsyncThunk(
        "onboarding/activateGoLive",

        async (
            saccoId,
            thunkAPI,
        ) => {
            if (
                !saccoId
            ) {
                return thunkAPI
                    .rejectWithValue(
                        normalizeError(
                            "SACCO ID is required before go-live activation.",
                        ),
                    );
            }

            try {
                const response =
                    await OnboardingAPI
                        .goLive(
                            saccoId,
                        );

                return {
                    data:
                        extractEntityData(
                            response,
                        ),

                    raw:
                        response,

                    saccoId,
                };
            } catch (
                error
            ) {
                return thunkAPI
                    .rejectWithValue(
                        normalizeRejectedPayload(
                            error,
                        ),
                    );
            }
        },
    );

/**
 * =============================================================================
 * Slice
 * =============================================================================
 */

const onboardingSlice =
    createSlice({

        name:
            "onboarding",

        initialState,

        reducers: {

            /* -----------------------------------------------------------------
             * Lifecycle
             * -----------------------------------------------------------------
             */

            initializeOnboarding(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                state.initialized =
                    true;

                state.metadata = {
                    ...state.metadata,
                    ...payload,
                };

                markUpdated(
                    state,
                );
            },

            /* -----------------------------------------------------------------
             * Draft
             * -----------------------------------------------------------------
             */

            saveDraft(
                state,
                action,
            ) {
                state.draft =
                    action.payload;

                state.metadata.updatedAt =
                    nowIso();

                markUpdated(
                    state,
                );
            },

            clearDraft(
                state,
            ) {
                state.draft =
                    null;

                state.metadata.updatedAt =
                    nowIso();

                markUpdated(
                    state,
                );
            },

            restoreDraft(
                state,
                action,
            ) {
                state.draft =
                    action.payload;

                state.metadata.updatedAt =
                    nowIso();

                markUpdated(
                    state,
                );
            },

            /* -----------------------------------------------------------------
             * SACCO / tenant metadata
             * -----------------------------------------------------------------
             */

            setSacco(
                state,
                action,
            ) {
                state.metadata.saccoId =
                    action.payload ||
                    null;

                markUpdated(
                    state,
                );
            },

            setOnboardingMetadata(
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

            /* -----------------------------------------------------------------
             * Steps
             * -----------------------------------------------------------------
             */

            setCurrentStep(
                state,
                action,
            ) {
                const step =
                    normalizeStep(
                        action.payload,
                    );

                if (
                    step === null
                ) {
                    return;
                }

                state.currentStep =
                    step;

                markUpdated(
                    state,
                );
            },

            nextStep(
                state,
            ) {
                state.currentStep =
                    Math.min(
                        ONBOARDING_TOTAL_STEPS,
                        state.currentStep +
                            1,
                    );

                markUpdated(
                    state,
                );
            },

            previousStep(
                state,
            ) {
                state.currentStep =
                    Math.max(
                        ONBOARDING_STEPS
                            .REGISTRATION,
                        state.currentStep -
                            1,
                    );

                markUpdated(
                    state,
                );
            },

            completeStep(
                state,
                action,
            ) {
                addCompletedStep(
                    state,
                    action.payload,
                );

                const step =
                    normalizeStep(
                        action.payload,
                    );

                if (
                    step !== null &&
                    step >=
                        state.currentStep
                ) {
                    state.currentStep =
                        Math.min(
                            ONBOARDING_TOTAL_STEPS,
                            step + 1,
                        );
                }

                markUpdated(
                    state,
                );
            },

            setCompletedSteps(
                state,
                action,
            ) {
                const steps =
                    Array.isArray(
                        action.payload,
                    )
                        ? action.payload
                        : [];

                state.completedSteps =
                    [
                        ...new Set(
                            steps
                                .map(
                                    normalizeStep,
                                )
                                .filter(
                                    Boolean,
                                ),
                        ),
                    ]
                        .sort(
                            (a, b) =>
                                a - b,
                        )
                        .slice(
                            0,
                            MAX_COMPLETED_STEPS,
                        );

                state.onboardingProgress =
                    calculateProgress(
                        state.completedSteps,
                    );

                markUpdated(
                    state,
                );
            },

            setProgress(
                state,
                action,
            ) {
                const numeric =
                    Number(
                        action.payload,
                    );

                if (
                    !Number.isFinite(
                        numeric,
                    )
                ) {
                    return;
                }

                state.onboardingProgress =
                    Math.max(
                        0,
                        Math.min(
                            100,
                            Math.round(
                                numeric,
                            ),
                        ),
                    );

                markUpdated(
                    state,
                );
            },

            /* -----------------------------------------------------------------
             * Uploaded files
             * -----------------------------------------------------------------
             */

            uploadFileSuccess(
                state,
                action,
            ) {
                state.uploadedFiles =
                    upsertUploadedFile(
                        state.uploadedFiles,
                        action.payload,
                    );

                markUpdated(
                    state,
                );
            },

            upsertUploadedFile(
                state,
                action,
            ) {
                state.uploadedFiles =
                    upsertUploadedFile(
                        state.uploadedFiles,
                        action.payload,
                    );

                markUpdated(
                    state,
                );
            },

            removeUploadedFile(
                state,
                action,
            ) {
                const fileId =
                    typeof action.payload ===
                        "object"
                        ? action.payload?.id ||
                          action.payload?.fileId
                        : action.payload;

                if (
                    !fileId
                ) {
                    return;
                }

                state.uploadedFiles =
                    state.uploadedFiles
                        .filter(
                            file =>
                                file.id !==
                                fileId,
                        );

                markUpdated(
                    state,
                );
            },

            clearUploadedFiles(
                state,
            ) {
                state.uploadedFiles =
                    [];

                markUpdated(
                    state,
                );
            },

            /* -----------------------------------------------------------------
             * Generic errors
             * -----------------------------------------------------------------
             */

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

            /* -----------------------------------------------------------------
             * Reset
             * -----------------------------------------------------------------
             */

            resetOnboarding() {
                return createInitialState();
            },

        },

        extraReducers:
            builder => {

                /* =============================================================
                 * Registration
                 * ============================================================= */

                builder

                    .addCase(
                        registerSacco.pending,
                        (
                            state,
                            action,
                        ) => {

                            markOperationPending(
                                state.registration,
                                action.meta
                                    ?.requestId,
                            );

                            markUpdated(
                                state,
                            );

                        },
                    )

                    .addCase(
                        registerSacco.fulfilled,
                        (
                            state,
                            action,
                        ) => {

                            const payload =
                                action.payload ||
                                {};

                            markOperationSuccess(
                                state.registration,
                                payload.data,
                                "TITech SACCO registered successfully.",
                                action.meta
                                    ?.requestId,
                            );

                            const saccoId =
                                payload.saccoId ||
                                normalizeSaccoId(
                                    payload.data,
                                );

                            if (
                                saccoId
                            ) {
                                state.metadata
                                    .saccoId =
                                    saccoId;

                            }

                            state.metadata
                                .onboardingId =
                                payload.data
                                    ?.onboardingId ||
                                payload.data
                                    ?.id ||
                                state.metadata
                                    .onboardingId;

                            addCompletedStep(
                                state,
                                ONBOARDING_STEPS
                                    .REGISTRATION,
                            );

                            markUpdated(
                                state,
                            );

                        },
                    )

                    .addCase(
                        registerSacco.rejected,
                        (
                            state,
                            action,
                        ) => {

                            const error =
                                normalizeError(
                                    action.payload ||
                                    action.error,
                                );

                            markOperationFailure(
                                state.registration,
                                error,
                                action.meta
                                    ?.requestId,
                            );

                            addErrorHistory(
                                state,
                                error,
                            );

                            markUpdated(
                                state,
                            );

                        },
                    );

                /* =============================================================
                 * KYC
                 * ============================================================= */

                builder

                    .addCase(
                        verifyKYC.pending,
                        (
                            state,
                            action,
                        ) => {

                            markOperationPending(
                                state.kyc,
                                action.meta
                                    ?.requestId,
                            );

                            markUpdated(
                                state,
                            );

                        },
                    )

                    .addCase(
                        verifyKYC.fulfilled,
                        (
                            state,
                            action,
                        ) => {

                            const payload =
                                action.payload ||
                                {};

                            markOperationSuccess(
                                state.kyc,
                                payload.data,
                                "KYC verification completed successfully.",
                                action.meta
                                    ?.requestId,
                            );

                            if (
                                payload.saccoId &&
                                !state.metadata
                                    .saccoId
                            ) {
                                state.metadata
                                    .saccoId =
                                    payload.saccoId;
                            }

                            const approved =
                                Boolean(
                                    payload.data
                                        ?.approved ??
                                    payload.data
                                        ?.verified ??
                                    payload.data
                                        ?.status ===
                                        "approved" ??
                                    payload.data
                                        ?.status ===
                                        "verified",
                                );

                            if (
                                approved
                            ) {
                                addCompletedStep(
                                    state,
                                    ONBOARDING_STEPS
                                        .KYC,
                                );
                            }

                            markUpdated(
                                state,
                            );

                        },
                    )

                    .addCase(
                        verifyKYC.rejected,
                        (
                            state,
                            action,
                        ) => {

                            const error =
                                normalizeError(
                                    action.payload ||
                                    action.error,
                                );

                            markOperationFailure(
                                state.kyc,
                                error,
                                action.meta
                                    ?.requestId,
                            );

                            addErrorHistory(
                                state,
                                error,
                            );

                            markUpdated(
                                state,
                            );

                        },
                    );

                /* =============================================================
                 * Subscription
                 * ============================================================= */

                builder

                    .addCase(
                        setupSubscription.pending,
                        (
                            state,
                            action,
                        ) => {

                            markOperationPending(
                                state.subscription,
                                action.meta
                                    ?.requestId,
                            );

                            markUpdated(
                                state,
                            );

                        },
                    )

                    .addCase(
                        setupSubscription.fulfilled,
                        (
                            state,
                            action,
                        ) => {

                            const payload =
                                action.payload ||
                                {};

                            markOperationSuccess(
                                state.subscription,
                                payload.data,
                                "TITech subscription configured successfully.",
                                action.meta
                                    ?.requestId,
                            );

                            if (
                                payload.saccoId &&
                                !state.metadata
                                    .saccoId
                            ) {
                                state.metadata
                                    .saccoId =
                                    payload.saccoId;
                            }

                            addCompletedStep(
                                state,
                                ONBOARDING_STEPS
                                    .SUBSCRIPTION,
                            );

                            markUpdated(
                                state,
                            );

                        },
                    )

                    .addCase(
                        setupSubscription.rejected,
                        (
                            state,
                            action,
                        ) => {

                            const error =
                                normalizeError(
                                    action.payload ||
                                    action.error,
                                );

                            markOperationFailure(
                                state.subscription,
                                error,
                                action.meta
                                    ?.requestId,
                            );

                            addErrorHistory(
                                state,
                                error,
                            );

                            markUpdated(
                                state,
                            );

                        },
                    );

                /* =============================================================
                 * Payment
                 * ============================================================= */

                builder

                    .addCase(
                        initializePayment.pending,
                        (
                            state,
                            action,
                        ) => {

                            markOperationPending(
                                state.payment,
                                action.meta
                                    ?.requestId,
                            );

                            state.payment.provider =
                                action.meta
                                    ?.arg?.provider ||
                                state.payment
                                    .provider ||
                                null;

                            markUpdated(
                                state,
                            );

                        },
                    )

                    .addCase(
                        initializePayment.fulfilled,
                        (
                            state,
                            action,
                        ) => {

                            const payload =
                                action.payload ||
                                {};

                            markOperationSuccess(
                                state.payment,
                                payload.data,
                                "TITech payment initialization completed successfully.",
                                action.meta
                                    ?.requestId,
                            );

                            state.payment.provider =
                                payload.provider ||
                                action.meta
                                    ?.arg?.provider ||
                                state.payment
                                    .provider ||
                                null;

                            if (
                                payload.saccoId &&
                                !state.metadata
                                    .saccoId
                            ) {
                                state.metadata
                                    .saccoId =
                                    payload.saccoId;
                            }

                            addCompletedStep(
                                state,
                                ONBOARDING_STEPS
                                    .PAYMENT,
                            );

                            markUpdated(
                                state,
                            );

                        },
                    )

                    .addCase(
                        initializePayment.rejected,
                        (
                            state,
                            action,
                        ) => {

                            const error =
                                normalizeError(
                                    action.payload ||
                                    action.error,
                                );

                            markOperationFailure(
                                state.payment,
                                error,
                                action.meta
                                    ?.requestId,
                            );

                            addErrorHistory(
                                state,
                                error,
                            );

                            markUpdated(
                                state,
                            );

                        },
                    );

                /* =============================================================
                 * Go Live
                 * ============================================================= */

                builder

                    .addCase(
                        activateGoLive.pending,
                        (
                            state,
                            action,
                        ) => {

                            markOperationPending(
                                state.goLive,
                                action.meta
                                    ?.requestId,
                            );

                            markUpdated(
                                state,
                            );

                        },
                    )

                    .addCase(
                        activateGoLive.fulfilled,
                        (
                            state,
                            action,
                        ) => {

                            const payload =
                                action.payload ||
                                {};

                            markOperationSuccess(
                                state.goLive,
                                payload.data,
                                "TITech SACCO is now LIVE.",
                                action.meta
                                    ?.requestId,
                            );

                            if (
                                payload.saccoId &&
                                !state.metadata
                                    .saccoId
                            ) {
                                state.metadata
                                    .saccoId =
                                    payload.saccoId;
                            }

                            addCompletedStep(
                                state,
                                ONBOARDING_STEPS
                                    .GO_LIVE,
                            );

                            state.currentStep =
                                ONBOARDING_TOTAL_STEPS;

                            state.onboardingProgress =
                                100;

                            markUpdated(
                                state,
                            );

                        },
                    )

                    .addCase(
                        activateGoLive.rejected,
                        (
                            state,
                            action,
                        ) => {

                            const error =
                                normalizeError(
                                    action.payload ||
                                    action.error,
                                );

                            markOperationFailure(
                                state.goLive,
                                error,
                                action.meta
                                    ?.requestId,
                            );

                            addErrorHistory(
                                state,
                                error,
                            );

                            markUpdated(
                                state,
                            );

                        },
                    );

            },
    });

/**
 * =============================================================================
 * Actions
 * =============================================================================
 */

export const {
    initializeOnboarding,

    saveDraft,
    clearDraft,
    restoreDraft,

    setSacco,
    setOnboardingMetadata,

    setCurrentStep,
    nextStep,
    previousStep,
    completeStep,
    setCompletedSteps,
    setProgress,

    uploadFileSuccess,
    upsertUploadedFile,
    removeUploadedFile,
    clearUploadedFiles,

    clearLastError,
    clearErrors,

    resetOnboarding,
} =
    onboardingSlice.actions;

/**
 * =============================================================================
 * Selectors
 * =============================================================================
 */

const selectOnboardingRoot =
    state =>
        state?.onboarding ||
        initialState;

export const selectOnboarding =
    state =>
        selectOnboardingRoot(
            state,
        );

export const selectDraft =
    state =>
        selectOnboardingRoot(
            state,
        ).draft;

export const selectRegistration =
    state =>
        selectOnboardingRoot(
            state,
        ).registration;

export const selectKYC =
    state =>
        selectOnboardingRoot(
            state,
        ).kyc;

export const selectSubscription =
    state =>
        selectOnboardingRoot(
            state,
        ).subscription;

export const selectPayment =
    state =>
        selectOnboardingRoot(
            state,
        ).payment;

export const selectGoLive =
    state =>
        selectOnboardingRoot(
            state,
        ).goLive;

export const selectCurrentStep =
    state =>
        selectOnboardingRoot(
            state,
        ).currentStep;

export const selectProgress =
    state =>
        selectOnboardingRoot(
            state,
        ).onboardingProgress;

export const selectCompletedSteps =
    state =>
        selectOnboardingRoot(
            state,
        ).completedSteps;

export const selectUploadedFiles =
    state =>
        selectOnboardingRoot(
            state,
        ).uploadedFiles;

export const selectOnboardingErrors =
    state =>
        selectOnboardingRoot(
            state,
        ).errors;

export const selectLastError =
    state =>
        selectOnboardingRoot(
            state,
        ).lastError;

export const selectOnboardingMetadata =
    state =>
        selectOnboardingRoot(
            state,
        ).metadata;

export const selectSaccoId =
    state =>
        selectOnboardingRoot(
            state,
        ).metadata.saccoId;

export const selectOnboardingId =
    state =>
        selectOnboardingRoot(
            state,
        ).metadata.onboardingId;

/**
 * =============================================================================
 * Loading/selectors
 * =============================================================================
 */

export const selectRegistrationLoading =
    state =>
        Boolean(
            selectRegistration(
                state,
            ).loading,
        );

export const selectKYCLoading =
    state =>
        Boolean(
            selectKYC(
                state,
            ).loading,
        );

export const selectSubscriptionLoading =
    state =>
        Boolean(
            selectSubscription(
                state,
            ).loading,
        );

export const selectPaymentLoading =
    state =>
        Boolean(
            selectPayment(
                state,
            ).loading,
        );

export const selectGoLiveLoading =
    state =>
        Boolean(
            selectGoLive(
                state,
            ).loading,
        );

export const selectOnboardingLoading =
    state => {

        const onboarding =
            selectOnboardingRoot(
                state,
            );

        return Boolean(

            onboarding.registration
                .loading ||

            onboarding.kyc
                .loading ||

            onboarding.subscription
                .loading ||

            onboarding.payment
                .loading ||

            onboarding.goLive
                .loading

        );
    };

/**
 * =============================================================================
 * Status selectors
 * =============================================================================
 */

export const selectRegistrationStatus =
    state =>
        selectRegistration(
            state,
        ).status;

export const selectKYCStatus =
    state =>
        selectKYC(
            state,
        ).status;

export const selectSubscriptionStatus =
    state =>
        selectSubscription(
            state,
        ).status;

export const selectPaymentStatus =
    state =>
        selectPayment(
            state,
        ).status;

export const selectGoLiveStatus =
    state =>
        selectGoLive(
            state,
        ).status;

/**
 * =============================================================================
 * Readiness / completion selectors
 * =============================================================================
 */

export const selectRegistrationComplete =
    state =>
        selectCompletedSteps(
            state,
        ).includes(
            ONBOARDING_STEPS.REGISTRATION,
        );

export const selectKYCComplete =
    state =>
        selectCompletedSteps(
            state,
        ).includes(
            ONBOARDING_STEPS.KYC,
        );

export const selectSubscriptionComplete =
    state =>
        selectCompletedSteps(
            state,
        ).includes(
            ONBOARDING_STEPS.SUBSCRIPTION,
        );

export const selectPaymentComplete =
    state =>
        selectCompletedSteps(
            state,
        ).includes(
            ONBOARDING_STEPS.PAYMENT,
        );

export const selectGoLiveComplete =
    state =>
        selectCompletedSteps(
            state,
        ).includes(
            ONBOARDING_STEPS.GO_LIVE,
        );

export const selectOnboardingComplete =
    state =>
        selectCompletedSteps(
            state,
        ).length >=
        ONBOARDING_TOTAL_STEPS;

/**
 * =============================================================================
 * Go-live readiness
 * =============================================================================
 */

export const selectCanGoLive =
    state => {

        const onboarding =
            selectOnboardingRoot(
                state,
            );

        const completed =
            onboarding
                .completedSteps;

        return Boolean(

            onboarding
                .metadata
                .saccoId &&

            completed.includes(
                ONBOARDING_STEPS.REGISTRATION,
            ) &&

            completed.includes(
                ONBOARDING_STEPS.KYC,
            ) &&

            completed.includes(
                ONBOARDING_STEPS.SUBSCRIPTION,
            ) &&

            completed.includes(
                ONBOARDING_STEPS.PAYMENT,
            ) &&

            !onboarding
                .goLive
                .loading

        );
    };

/**
 * =============================================================================
 * Pending/failed selectors
 * =============================================================================
 */

export const selectHasErrors =
    state =>
        Boolean(
            selectOnboardingRoot(
                state,
            ).lastError,
        );

export const selectHasBlockingError =
    state => {

        const error =
            selectLastError(
                state,
            );

        if (
            !error
        ) {
            return false;
        }

        return (
            Number(
                error.statusCode,
            ) ===
                401 ||
            Number(
                error.statusCode,
            ) ===
                403 ||
            String(
                error.code ||
                "",
            ).includes(
                "KYC",
            ) ||
            String(
                error.code ||
                "",
            ).includes(
                "COMPLIANCE",
            )
        );
    };

/**
 * =============================================================================
 * Aggregate onboarding summary
 * =============================================================================
 */

export const selectOnboardingSummary =
    state => {

        const onboarding =
            selectOnboardingRoot(
                state,
            );

        return {

            currentStep:
                onboarding.currentStep,

            totalSteps:
                ONBOARDING_TOTAL_STEPS,

            progress:
                onboarding
                    .onboardingProgress,

            completedSteps:
                onboarding
                    .completedSteps,

            complete:
                onboarding
                    .completedSteps
                    .length >=
                ONBOARDING_TOTAL_STEPS,

            loading:
                selectOnboardingLoading(
                    state,
                ),

            hasErrors:
                Boolean(
                    onboarding
                        .lastError,
                ),

            canGoLive:
                selectCanGoLive(
                    state,
                ),

            saccoId:
                onboarding
                    .metadata
                    .saccoId,

            onboardingId:
                onboarding
                    .metadata
                    .onboardingId,

            uploadedFiles:
                onboarding
                    .uploadedFiles
                    .length,

        };
    };

/**
 * =============================================================================
 * Initial state export
 * =============================================================================
 */

export {
    initialState,
};

/**
 * =============================================================================
 * Reducer
 * =============================================================================
 */

export default
    onboardingSlice.reducer;