// ============================================================================
// TITech Community Capital LTD
// Enterprise Settings Slice
// File: frontend/src/features/settings/settingsSlice.js
// Production Grade
// ============================================================================
//
// Purpose
// ----------------------------------------------------------------------------
// Centralized, validated, serializable frontend settings state.
//
// Security boundary
// ----------------------------------------------------------------------------
// This slice contains USER / UI preferences only.
// It must NOT contain:
//   - passwords
//   - JWTs / access tokens
//   - refresh tokens
//   - private keys
//   - payment credentials
//   - Mobile Money PINs
//   - API secrets
//   - server-side authorization decisions
//
// Backend policy and authorization remain authoritative.
// ============================================================================

import {
    createSelector,
    createSlice,
} from "@reduxjs/toolkit";

// ============================================================================
// Constants
// ============================================================================

export const THEMES = Object.freeze({
    LIGHT: "light",
    DARK: "dark",
    SYSTEM: "system",
});

export const LANGUAGES = Object.freeze({
    ENGLISH: "en",
    SWAHILI: "sw",
    FRENCH: "fr",
});

export const CURRENCIES = Object.freeze({
    UGX: "UGX",
    USD: "USD",
    KES: "KES",
    TZS: "TZS",
});

export const DATE_FORMATS = Object.freeze({
    DDMMYYYY: "DD/MM/YYYY",
    MMDDYYYY: "MM/DD/YYYY",
    YYYYMMDD: "YYYY-MM-DD",
});

export const TIME_FORMATS = Object.freeze({
    H12: "12h",
    H24: "24h",
});

export const FONT_SIZES = Object.freeze({
    SMALL: "small",
    MEDIUM: "medium",
    LARGE: "large",
});

export const DENSITIES = Object.freeze({
    COMPACT: "compact",
    COMFORTABLE: "comfortable",
    SPACIOUS: "spacious",
});

export const SETTINGS_STATUS = Object.freeze({
    IDLE: "idle",
    LOADING: "loading",
    SAVING: "saving",
    READY: "ready",
    FAILED: "failed",
});

export const SETTINGS_SOURCES = Object.freeze({
    DEFAULT: "default",
    LOCAL: "local",
    REMOTE: "remote",
    IMPORT: "import",
});

const DEFAULT_TIMEZONE =
    (() => {
        try {
            return (
                Intl.DateTimeFormat()
                    .resolvedOptions()
                    .timeZone ||
                "Africa/Kampala"
            );
        } catch {
            return "Africa/Kampala";
        }
    })();

const MAX_DASHBOARD_WIDGETS = 100;
const MAX_ERROR_HISTORY = 25;

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_SETTINGS = Object.freeze({
    appearance: Object.freeze({
        theme:
            THEMES.SYSTEM,

        compactMode:
            false,

        animations:
            true,

        fontSize:
            FONT_SIZES.MEDIUM,

        density:
            DENSITIES.COMFORTABLE,
    }),

    localization: Object.freeze({
        language:
            LANGUAGES.ENGLISH,

        currency:
            CURRENCIES.UGX,

        timezone:
            DEFAULT_TIMEZONE,

        dateFormat:
            DATE_FORMATS.DDMMYYYY,

        timeFormat:
            TIME_FORMATS.H24,
    }),

    notifications: Object.freeze({
        email:
            true,

        sms:
            true,

        push:
            true,

        inApp:
            true,

        securityAlerts:
            true,

        transactionAlerts:
            true,

        marketing:
            false,
    }),

    privacy: Object.freeze({
        analytics:
            true,

        telemetry:
            true,

        rememberMe:
            true,

        autoLogout:
            true,

        autoLogoutMinutes:
            30,
    }),

    dashboard: Object.freeze({
        autoRefresh:
            true,

        refreshInterval:
            60_000,

        showBalances:
            true,

        defaultLandingPage:
            "/dashboard",

        widgets:
            [],
    }),

    accessibility: Object.freeze({
        highContrast:
            false,

        reducedMotion:
            false,

        screenReader:
            false,

        keyboardNavigation:
            true,
    }),

    integrations: Object.freeze({
        mobileMoney:
            true,

        email:
            true,

        sms:
            true,

        realtime:
            true,
    }),
});

// ============================================================================
// Helpers
// ============================================================================

function nowIso() {
    return new Date().toISOString();
}

function isPlainObject(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}

function normalizeBoolean(
    value,
    fallback = false,
) {
    if (
        typeof value === "boolean"
    ) {
        return value;
    }

    if (
        value === 1 ||
        value === "1" ||
        String(value)
            .trim()
            .toLowerCase() === "true"
    ) {
        return true;
    }

    if (
        value === 0 ||
        value === "0" ||
        String(value)
            .trim()
            .toLowerCase() === "false"
    ) {
        return false;
    }

    return fallback;
}

function normalizePositiveInteger(
    value,
    fallback,
    minimum = 1,
    maximum = Number.MAX_SAFE_INTEGER,
) {
    const numeric =
        Number(value);

    if (
        !Number.isFinite(
            numeric,
        )
    ) {
        return fallback;
    }

    return Math.max(
        minimum,
        Math.min(
            maximum,
            Math.round(
                numeric,
            ),
        ),
    );
}

function normalizeEnum(
    value,
    allowed,
    fallback,
) {
    return allowed.includes(
        value,
    )
        ? value
        : fallback;
}

function normalizeTimezone(
    value,
) {
    const timezone =
        String(
            value ||
                DEFAULT_TIMEZONE,
        ).trim();

    if (!timezone) {
        return DEFAULT_TIMEZONE;
    }

    try {
        new Intl.DateTimeFormat(
            "en-US",
            {
                timeZone:
                    timezone,
            },
        );

        return timezone;
    } catch {
        return DEFAULT_TIMEZONE;
    }
}

function normalizeLandingPage(
    value,
) {
    const page =
        String(
            value ||
                "/dashboard",
        ).trim();

    if (
        !page.startsWith("/") ||
        page.startsWith("//")
    ) {
        return "/dashboard";
    }

    return page;
}

function normalizeWidgetId(
    widget,
) {
    if (
        typeof widget ===
        "string"
    ) {
        const value =
            widget.trim();

        return value || null;
    }

    if (
        isPlainObject(
            widget,
        )
    ) {
        return (
            widget.id ||
            widget.key ||
            null
        );
    }

    return null;
}

function normalizeWidgets(
    widgets,
) {
    if (
        !Array.isArray(
            widgets,
        )
    ) {
        return [];
    }

    const seen =
        new Set();

    const normalized =
        [];

    for (
        const widget of
        widgets
    ) {
        const id =
            normalizeWidgetId(
                widget,
            );

        if (
            !id ||
            seen.has(id)
        ) {
            continue;
        }

        seen.add(id);

        normalized.push(
            widget,
        );
    }

    return normalized.slice(
        0,
        MAX_DASHBOARD_WIDGETS,
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
                "SETTINGS_ERROR",

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
        isPlainObject(
            responseData,
        )
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
            "SETTINGS_ERROR",

        message:
            source?.message ||
            source?.error ||
            error?.message ||
            "Settings operation failed.",

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

    if (!normalized) {
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

function normalizeAppearance(
    appearance = {},
) {
    return {
        ...DEFAULT_SETTINGS.appearance,

        ...appearance,

        theme:
            normalizeEnum(
                appearance.theme,
                Object.values(
                    THEMES,
                ),
                DEFAULT_SETTINGS
                    .appearance
                    .theme,
            ),

        compactMode:
            normalizeBoolean(
                appearance.compactMode,
                DEFAULT_SETTINGS
                    .appearance
                    .compactMode,
            ),

        animations:
            normalizeBoolean(
                appearance.animations,
                DEFAULT_SETTINGS
                    .appearance
                    .animations,
            ),

        fontSize:
            normalizeEnum(
                appearance.fontSize,
                Object.values(
                    FONT_SIZES,
                ),
                DEFAULT_SETTINGS
                    .appearance
                    .fontSize,
            ),

        density:
            normalizeEnum(
                appearance.density,
                Object.values(
                    DENSITIES,
                ),
                DEFAULT_SETTINGS
                    .appearance
                    .density,
            ),
    };
}

function normalizeLocalization(
    localization = {},
) {
    return {
        ...DEFAULT_SETTINGS.localization,

        ...localization,

        language:
            normalizeEnum(
                localization.language,
                Object.values(
                    LANGUAGES,
                ),
                DEFAULT_SETTINGS
                    .localization
                    .language,
            ),

        currency:
            normalizeEnum(
                localization.currency,
                Object.values(
                    CURRENCIES,
                ),
                DEFAULT_SETTINGS
                    .localization
                    .currency,
            ),

        timezone:
            normalizeTimezone(
                localization.timezone,
            ),

        dateFormat:
            normalizeEnum(
                localization.dateFormat,
                Object.values(
                    DATE_FORMATS,
                ),
                DEFAULT_SETTINGS
                    .localization
                    .dateFormat,
            ),

        timeFormat:
            normalizeEnum(
                localization.timeFormat,
                Object.values(
                    TIME_FORMATS,
                ),
                DEFAULT_SETTINGS
                    .localization
                    .timeFormat,
            ),
    };
}

function normalizeNotifications(
    notifications = {},
) {
    return {
        ...DEFAULT_SETTINGS.notifications,

        ...notifications,

        email:
            normalizeBoolean(
                notifications.email,
                DEFAULT_SETTINGS
                    .notifications
                    .email,
            ),

        sms:
            normalizeBoolean(
                notifications.sms,
                DEFAULT_SETTINGS
                    .notifications
                    .sms,
            ),

        push:
            normalizeBoolean(
                notifications.push,
                DEFAULT_SETTINGS
                    .notifications
                    .push,
            ),

        inApp:
            normalizeBoolean(
                notifications.inApp,
                DEFAULT_SETTINGS
                    .notifications
                    .inApp,
            ),

        securityAlerts:
            normalizeBoolean(
                notifications.securityAlerts,
                DEFAULT_SETTINGS
                    .notifications
                    .securityAlerts,
            ),

        transactionAlerts:
            normalizeBoolean(
                notifications
                    .transactionAlerts,
                DEFAULT_SETTINGS
                    .notifications
                    .transactionAlerts,
            ),

        marketing:
            normalizeBoolean(
                notifications.marketing,
                DEFAULT_SETTINGS
                    .notifications
                    .marketing,
            ),
    };
}

function normalizePrivacy(
    privacy = {},
) {
    return {
        ...DEFAULT_SETTINGS.privacy,

        ...privacy,

        analytics:
            normalizeBoolean(
                privacy.analytics,
                DEFAULT_SETTINGS
                    .privacy
                    .analytics,
            ),

        telemetry:
            normalizeBoolean(
                privacy.telemetry,
                DEFAULT_SETTINGS
                    .privacy
                    .telemetry,
            ),

        rememberMe:
            normalizeBoolean(
                privacy.rememberMe,
                DEFAULT_SETTINGS
                    .privacy
                    .rememberMe,
            ),

        autoLogout:
            normalizeBoolean(
                privacy.autoLogout,
                DEFAULT_SETTINGS
                    .privacy
                    .autoLogout,
            ),

        autoLogoutMinutes:
            normalizePositiveInteger(
                privacy.autoLogoutMinutes,
                DEFAULT_SETTINGS
                    .privacy
                    .autoLogoutMinutes,
                1,
                24 * 60,
            ),
    };
}

function normalizeDashboard(
    dashboard = {},
) {
    return {
        ...DEFAULT_SETTINGS.dashboard,

        ...dashboard,

        autoRefresh:
            normalizeBoolean(
                dashboard.autoRefresh,
                DEFAULT_SETTINGS
                    .dashboard
                    .autoRefresh,
            ),

        refreshInterval:
            normalizePositiveInteger(
                dashboard.refreshInterval,
                DEFAULT_SETTINGS
                    .dashboard
                    .refreshInterval,
                5_000,
                24 * 60 * 60 * 1000,
            ),

        showBalances:
            normalizeBoolean(
                dashboard.showBalances,
                DEFAULT_SETTINGS
                    .dashboard
                    .showBalances,
            ),

        defaultLandingPage:
            normalizeLandingPage(
                dashboard
                    .defaultLandingPage,
            ),

        widgets:
            normalizeWidgets(
                dashboard.widgets,
            ),
    };
}

function normalizeAccessibility(
    accessibility = {},
) {
    return {
        ...DEFAULT_SETTINGS.accessibility,

        ...accessibility,

        highContrast:
            normalizeBoolean(
                accessibility.highContrast,
                DEFAULT_SETTINGS
                    .accessibility
                    .highContrast,
            ),

        reducedMotion:
            normalizeBoolean(
                accessibility.reducedMotion,
                DEFAULT_SETTINGS
                    .accessibility
                    .reducedMotion,
            ),

        screenReader:
            normalizeBoolean(
                accessibility.screenReader,
                DEFAULT_SETTINGS
                    .accessibility
                    .screenReader,
            ),

        keyboardNavigation:
            normalizeBoolean(
                accessibility.keyboardNavigation,
                DEFAULT_SETTINGS
                    .accessibility
                    .keyboardNavigation,
            ),
    };
}

function normalizeIntegrations(
    integrations = {},
) {
    return {
        ...DEFAULT_SETTINGS.integrations,

        ...integrations,

        mobileMoney:
            normalizeBoolean(
                integrations.mobileMoney,
                DEFAULT_SETTINGS
                    .integrations
                    .mobileMoney,
            ),

        email:
            normalizeBoolean(
                integrations.email,
                DEFAULT_SETTINGS
                    .integrations
                    .email,
            ),

        sms:
            normalizeBoolean(
                integrations.sms,
                DEFAULT_SETTINGS
                    .integrations
                    .sms,
            ),

        realtime:
            normalizeBoolean(
                integrations.realtime,
                DEFAULT_SETTINGS
                    .integrations
                    .realtime,
            ),
    };
}

function normalizeSettingsPayload(
    payload = {},
) {
    return {
        appearance:
            normalizeAppearance(
                payload.appearance,
            ),

        localization:
            normalizeLocalization(
                payload.localization,
            ),

        notifications:
            normalizeNotifications(
                payload.notifications,
            ),

        privacy:
            normalizePrivacy(
                payload.privacy,
            ),

        dashboard:
            normalizeDashboard(
                payload.dashboard,
            ),

        accessibility:
            normalizeAccessibility(
                payload.accessibility,
            ),

        integrations:
            normalizeIntegrations(
                payload.integrations,
            ),
    };
}

// ============================================================================
// Initial State Factory
// ============================================================================

function createInitialState() {
    return {
        initialized:
            false,

        appearance:
            normalizeAppearance(),

        localization:
            normalizeLocalization(),

        notifications:
            normalizeNotifications(),

        privacy:
            normalizePrivacy(),

        dashboard:
            normalizeDashboard(),

        accessibility:
            normalizeAccessibility(),

        integrations:
            normalizeIntegrations(),

        loading:
            false,

        saving:
            false,

        status:
            SETTINGS_STATUS.IDLE,

        error:
            null,

        errorHistory:
            [],

        source:
            SETTINGS_SOURCES.DEFAULT,

        version:
            1,

        lastUpdated:
            null,

        lastLoaded:
            null,

        lastSaved:
            null,

        lastSyncAt:
            null,
    };
}

const initialState =
    createInitialState();

// ============================================================================
// Slice
// ============================================================================

const settingsSlice =
    createSlice({

        name:
            "settings",

        initialState,

        reducers: {

            // ------------------------------------------------------------------
            // Initialization
            // ------------------------------------------------------------------

            initializeSettings(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const normalized =
                    normalizeSettingsPayload(
                        payload.settings ||
                        payload,
                    );

                state.appearance =
                    normalized
                        .appearance;

                state.localization =
                    normalized
                        .localization;

                state.notifications =
                    normalized
                        .notifications;

                state.privacy =
                    normalized
                        .privacy;

                state.dashboard =
                    normalized
                        .dashboard;

                state.accessibility =
                    normalized
                        .accessibility;

                state.integrations =
                    normalized
                        .integrations;

                state.initialized =
                    true;

                state.status =
                    SETTINGS_STATUS
                        .READY;

                state.source =
                    payload.source ||
                    SETTINGS_SOURCES.DEFAULT;

                state.lastLoaded =
                    nowIso();

                state.error =
                    null;
            },

            hydrateSettings(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const normalized =
                    normalizeSettingsPayload(
                        payload.settings ||
                        payload,
                    );

                state.appearance =
                    normalized
                        .appearance;

                state.localization =
                    normalized
                        .localization;

                state.notifications =
                    normalized
                        .notifications;

                state.privacy =
                    normalized
                        .privacy;

                state.dashboard =
                    normalized
                        .dashboard;

                state.accessibility =
                    normalized
                        .accessibility;

                state.integrations =
                    normalized
                        .integrations;

                state.initialized =
                    true;

                state.source =
                    payload.source ||
                    SETTINGS_SOURCES.LOCAL;

                state.lastLoaded =
                    payload.loadedAt ||
                    nowIso();

                state.status =
                    SETTINGS_STATUS
                        .READY;

                state.error =
                    null;
            },

            resetSettings() {
                return createInitialState();
            },

            // ------------------------------------------------------------------
            // Loading states
            // ------------------------------------------------------------------

            setSettingsLoading(
                state,
                action,
            ) {
                state.loading =
                    Boolean(
                        action.payload,
                    );

                state.status =
                    state.loading
                        ? SETTINGS_STATUS.LOADING
                        : state.saving
                            ? SETTINGS_STATUS.SAVING
                            : SETTINGS_STATUS.READY;
            },

            setSettingsSaving(
                state,
                action,
            ) {
                state.saving =
                    Boolean(
                        action.payload,
                    );

                state.status =
                    state.saving
                        ? SETTINGS_STATUS.SAVING
                        : state.loading
                            ? SETTINGS_STATUS.LOADING
                            : SETTINGS_STATUS.READY;
            },

            setSettingsError(
                state,
                action,
            ) {
                addErrorHistory(
                    state,
                    action.payload,
                );

                state.loading =
                    false;

                state.saving =
                    false;

                state.status =
                    SETTINGS_STATUS.FAILED;
            },

            clearSettingsError(
                state,
            ) {
                state.error =
                    null;

                if (
                    state.initialized
                ) {
                    state.status =
                        SETTINGS_STATUS.READY;
                }
            },

            clearSettingsErrors(
                state,
            ) {
                state.error =
                    null;

                state.errorHistory =
                    [];

                if (
                    state.initialized
                ) {
                    state.status =
                        SETTINGS_STATUS.READY;
                }
            },

            // ------------------------------------------------------------------
            // Appearance
            // ------------------------------------------------------------------

            setTheme(
                state,
                action,
            ) {
                state.appearance.theme =
                    normalizeEnum(
                        action.payload,
                        Object.values(
                            THEMES,
                        ),
                        THEMES.SYSTEM,
                    );

                state.lastUpdated =
                    nowIso();
            },

            setCompactMode(
                state,
                action,
            ) {
                state.appearance.compactMode =
                    normalizeBoolean(
                        action.payload,
                    );

                state.lastUpdated =
                    nowIso();
            },

            setAnimations(
                state,
                action,
            ) {
                state.appearance.animations =
                    normalizeBoolean(
                        action.payload,
                    );

                state.lastUpdated =
                    nowIso();
            },

            setFontSize(
                state,
                action,
            ) {
                state.appearance.fontSize =
                    normalizeEnum(
                        action.payload,
                        Object.values(
                            FONT_SIZES,
                        ),
                        FONT_SIZES.MEDIUM,
                    );

                state.lastUpdated =
                    nowIso();
            },

            setDensity(
                state,
                action,
            ) {
                state.appearance.density =
                    normalizeEnum(
                        action.payload,
                        Object.values(
                            DENSITIES,
                        ),
                        DENSITIES.COMFORTABLE,
                    );

                state.lastUpdated =
                    nowIso();
            },

            updateAppearanceSettings(
                state,
                action,
            ) {
                state.appearance =
                    normalizeAppearance(
                        {
                            ...state.appearance,
                            ...(action.payload ||
                                {}),
                        },
                    );

                state.lastUpdated =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Localization
            // ------------------------------------------------------------------

            setLanguage(
                state,
                action,
            ) {
                state.localization.language =
                    normalizeEnum(
                        action.payload,
                        Object.values(
                            LANGUAGES,
                        ),
                        LANGUAGES.ENGLISH,
                    );

                state.lastUpdated =
                    nowIso();
            },

            setCurrency(
                state,
                action,
            ) {
                state.localization.currency =
                    normalizeEnum(
                        action.payload,
                        Object.values(
                            CURRENCIES,
                        ),
                        CURRENCIES.UGX,
                    );

                state.lastUpdated =
                    nowIso();
            },

            setTimezone(
                state,
                action,
            ) {
                state.localization.timezone =
                    normalizeTimezone(
                        action.payload,
                    );

                state.lastUpdated =
                    nowIso();
            },

            setDateFormat(
                state,
                action,
            ) {
                state.localization.dateFormat =
                    normalizeEnum(
                        action.payload,
                        Object.values(
                            DATE_FORMATS,
                        ),
                        DATE_FORMATS.DDMMYYYY,
                    );

                state.lastUpdated =
                    nowIso();
            },

            setTimeFormat(
                state,
                action,
            ) {
                state.localization.timeFormat =
                    normalizeEnum(
                        action.payload,
                        Object.values(
                            TIME_FORMATS,
                        ),
                        TIME_FORMATS.H24,
                    );

                state.lastUpdated =
                    nowIso();
            },

            updateLocalizationSettings(
                state,
                action,
            ) {
                state.localization =
                    normalizeLocalization(
                        {
                            ...state.localization,
                            ...(action.payload ||
                                {}),
                        },
                    );

                state.lastUpdated =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Notifications
            // ------------------------------------------------------------------

            updateNotificationSettings(
                state,
                action,
            ) {
                state.notifications =
                    normalizeNotifications(
                        {
                            ...state.notifications,
                            ...(action.payload ||
                                {}),
                        },
                    );

                state.lastUpdated =
                    nowIso();
            },

            setNotificationPreference(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const key =
                    payload.key ||
                    payload.channel;

                const allowed =
                    [
                        "email",
                        "sms",
                        "push",
                        "inApp",
                        "securityAlerts",
                        "transactionAlerts",
                        "marketing",
                    ];

                if (
                    !allowed.includes(
                        key,
                    )
                ) {
                    return;
                }

                state.notifications[
                    key
                ] =
                    normalizeBoolean(
                        payload.enabled,
                    );

                state.lastUpdated =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Privacy
            // ------------------------------------------------------------------

            updatePrivacySettings(
                state,
                action,
            ) {
                state.privacy =
                    normalizePrivacy(
                        {
                            ...state.privacy,
                            ...(action.payload ||
                                {}),
                        },
                    );

                state.lastUpdated =
                    nowIso();
            },

            setAutoLogout(
                state,
                action,
            ) {
                state.privacy.autoLogout =
                    normalizeBoolean(
                        action.payload,
                    );

                state.lastUpdated =
                    nowIso();
            },

            setAutoLogoutMinutes(
                state,
                action,
            ) {
                state.privacy
                    .autoLogoutMinutes =
                    normalizePositiveInteger(
                        action.payload,
                        30,
                        1,
                        24 * 60,
                    );

                state.lastUpdated =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Dashboard
            // ------------------------------------------------------------------

            updateDashboardSettings(
                state,
                action,
            ) {
                state.dashboard =
                    normalizeDashboard(
                        {
                            ...state.dashboard,
                            ...(action.payload ||
                                {}),
                        },
                    );

                state.lastUpdated =
                    nowIso();
            },

            setAutoRefresh(
                state,
                action,
            ) {
                state.dashboard.autoRefresh =
                    normalizeBoolean(
                        action.payload,
                    );

                state.lastUpdated =
                    nowIso();
            },

            setRefreshInterval(
                state,
                action,
            ) {
                state.dashboard
                    .refreshInterval =
                    normalizePositiveInteger(
                        action.payload,
                        60_000,
                        5_000,
                        24 * 60 * 60 * 1000,
                    );

                state.lastUpdated =
                    nowIso();
            },

            setDefaultLandingPage(
                state,
                action,
            ) {
                state.dashboard
                    .defaultLandingPage =
                    normalizeLandingPage(
                        action.payload,
                    );

                state.lastUpdated =
                    nowIso();
            },

            addDashboardWidget(
                state,
                action,
            ) {
                const widget =
                    action.payload;

                const id =
                    normalizeWidgetId(
                        widget,
                    );

                if (
                    !id
                ) {
                    return;
                }

                const exists =
                    state.dashboard
                        .widgets
                        .some(
                            current =>
                                normalizeWidgetId(
                                    current,
                                ) === id,
                        );

                if (
                    !exists
                ) {
                    state.dashboard
                        .widgets
                        .push(
                            widget,
                        );
                }

                state.dashboard
                    .widgets =
                    normalizeWidgets(
                        state.dashboard
                            .widgets,
                    );

                state.lastUpdated =
                    nowIso();
            },

            removeDashboardWidget(
                state,
                action,
            ) {
                const id =
                    normalizeWidgetId(
                        action.payload,
                    );

                if (
                    !id
                ) {
                    return;
                }

                state.dashboard
                    .widgets =
                    state.dashboard
                        .widgets
                        .filter(
                            widget =>
                                normalizeWidgetId(
                                    widget,
                                ) !== id,
                        );

                state.lastUpdated =
                    nowIso();
            },

            reorderDashboardWidgets(
                state,
                action,
            ) {
                const widgets =
                    Array.isArray(
                        action.payload,
                    )
                        ? action.payload
                        : [];

                state.dashboard.widgets =
                    normalizeWidgets(
                        widgets,
                    );

                state.lastUpdated =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Accessibility
            // ------------------------------------------------------------------

            updateAccessibilitySettings(
                state,
                action,
            ) {
                state.accessibility =
                    normalizeAccessibility(
                        {
                            ...state.accessibility,
                            ...(action.payload ||
                                {}),
                        },
                    );

                state.lastUpdated =
                    nowIso();
            },

            setReducedMotion(
                state,
                action,
            ) {
                state.accessibility
                    .reducedMotion =
                    normalizeBoolean(
                        action.payload,
                    );

                if (
                    state.accessibility
                        .reducedMotion
                ) {
                    state.appearance
                        .animations =
                        false;
                }

                state.lastUpdated =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Integrations
            // ------------------------------------------------------------------

            updateIntegrationSettings(
                state,
                action,
            ) {
                state.integrations =
                    normalizeIntegrations(
                        {
                            ...state.integrations,
                            ...(action.payload ||
                                {}),
                        },
                    );

                state.lastUpdated =
                    nowIso();
            },

            setIntegrationEnabled(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const integration =
                    payload.integration;

                const allowed =
                    [
                        "mobileMoney",
                        "email",
                        "sms",
                        "realtime",
                    ];

                if (
                    !allowed.includes(
                        integration,
                    )
                ) {
                    return;
                }

                state.integrations[
                    integration
                ] =
                    normalizeBoolean(
                        payload.enabled,
                    );

                state.lastUpdated =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Bulk update
            // ------------------------------------------------------------------

            updateSettings(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                if (
                    payload.appearance
                ) {
                    state.appearance =
                        normalizeAppearance(
                            {
                                ...state.appearance,
                                ...payload
                                    .appearance,
                            },
                        );
                }

                if (
                    payload.localization
                ) {
                    state.localization =
                        normalizeLocalization(
                            {
                                ...state.localization,
                                ...payload
                                    .localization,
                            },
                        );
                }

                if (
                    payload.notifications
                ) {
                    state.notifications =
                        normalizeNotifications(
                            {
                                ...state.notifications,
                                ...payload
                                    .notifications,
                            },
                        );
                }

                if (
                    payload.privacy
                ) {
                    state.privacy =
                        normalizePrivacy(
                            {
                                ...state.privacy,
                                ...payload
                                    .privacy,
                            },
                        );
                }

                if (
                    payload.dashboard
                ) {
                    state.dashboard =
                        normalizeDashboard(
                            {
                                ...state.dashboard,
                                ...payload
                                    .dashboard,
                            },
                        );
                }

                if (
                    payload.accessibility
                ) {
                    state.accessibility =
                        normalizeAccessibility(
                            {
                                ...state.accessibility,
                                ...payload
                                    .accessibility,
                            },
                        );
                }

                if (
                    payload.integrations
                ) {
                    state.integrations =
                        normalizeIntegrations(
                            {
                                ...state.integrations,
                                ...payload
                                    .integrations,
                            },
                        );
                }

                state.initialized =
                    true;

                state.source =
                    payload.source ||
                    SETTINGS_SOURCES.LOCAL;

                state.lastUpdated =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Import
            // ------------------------------------------------------------------

            importSettings(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const imported =
                    payload.settings ||
                    payload;

                const normalized =
                    normalizeSettingsPayload(
                        imported,
                    );

                state.appearance =
                    normalized.appearance;

                state.localization =
                    normalized
                        .localization;

                state.notifications =
                    normalized
                        .notifications;

                state.privacy =
                    normalized.privacy;

                state.dashboard =
                    normalized.dashboard;

                state.accessibility =
                    normalized
                        .accessibility;

                state.integrations =
                    normalized
                        .integrations;

                state.initialized =
                    true;

                state.source =
                    SETTINGS_SOURCES.IMPORT;

                state.lastLoaded =
                    nowIso();

                state.lastUpdated =
                    nowIso();

                state.error =
                    null;

                state.status =
                    SETTINGS_STATUS
                        .READY;
            },

            markSettingsSaved(
                state,
                action,
            ) {
                state.saving =
                    false;

                state.loading =
                    false;

                state.status =
                    SETTINGS_STATUS
                        .READY;

                state.lastSaved =
                    action.payload
                        ?.timestamp ||
                    nowIso();

                state.source =
                    action.payload
                        ?.source ||
                    SETTINGS_SOURCES
                        .REMOTE;

                state.error =
                    null;
            },

            markSettingsSynced(
                state,
                action,
            ) {
                state.lastSyncAt =
                    action.payload
                        ?.timestamp ||
                    nowIso();

                state.source =
                    action.payload
                        ?.source ||
                    SETTINGS_SOURCES
                        .REMOTE;

                state.error =
                    null;
            },
        },
    });

// ============================================================================
// Actions
// ============================================================================

export const {
    initializeSettings,
    hydrateSettings,
    resetSettings,

    setSettingsLoading,
    setSettingsSaving,
    setSettingsError,
    clearSettingsError,
    clearSettingsErrors,

    setTheme,
    setCompactMode,
    setAnimations,
    setFontSize,
    setDensity,
    updateAppearanceSettings,

    setLanguage,
    setCurrency,
    setTimezone,
    setDateFormat,
    setTimeFormat,
    updateLocalizationSettings,

    updateNotificationSettings,
    setNotificationPreference,

    updatePrivacySettings,
    setAutoLogout,
    setAutoLogoutMinutes,

    updateDashboardSettings,
    setAutoRefresh,
    setRefreshInterval,
    setDefaultLandingPage,
    addDashboardWidget,
    removeDashboardWidget,
    reorderDashboardWidgets,

    updateAccessibilitySettings,
    setReducedMotion,

    updateIntegrationSettings,
    setIntegrationEnabled,

    updateSettings,
    importSettings,

    markSettingsSaved,
    markSettingsSynced,
} =
    settingsSlice.actions;

// ============================================================================
// Base Selectors
// ============================================================================

export const selectSettings =
    state =>
        state?.settings ||
        initialState;

export const selectSettingsInitialized =
    createSelector(
        [
            selectSettings,
        ],
        settings =>
            settings.initialized,
    );

export const selectSettingsLoading =
    createSelector(
        [
            selectSettings,
        ],
        settings =>
            settings.loading,
    );

export const selectSettingsSaving =
    createSelector(
        [
            selectSettings,
        ],
        settings =>
            settings.saving,
    );

export const selectSettingsStatus =
    createSelector(
        [
            selectSettings,
        ],
        settings =>
            settings.status,
    );

export const selectSettingsError =
    createSelector(
        [
            selectSettings,
        ],
        settings =>
            settings.error,
    );

export const selectSettingsErrorHistory =
    createSelector(
        [
            selectSettings,
        ],
        settings =>
            settings.errorHistory,
    );

export const selectAppearance =
    createSelector(
        [
            selectSettings,
        ],
        settings =>
            settings.appearance,
    );

export const selectLocalization =
    createSelector(
        [
            selectSettings,
        ],
        settings =>
            settings.localization,
    );

export const selectNotifications =
    createSelector(
        [
            selectSettings,
        ],
        settings =>
            settings.notifications,
    );

export const selectPrivacy =
    createSelector(
        [
            selectSettings,
        ],
        settings =>
            settings.privacy,
    );

export const selectDashboardSettings =
    createSelector(
        [
            selectSettings,
        ],
        settings =>
            settings.dashboard,
    );

export const selectAccessibility =
    createSelector(
        [
            selectSettings,
        ],
        settings =>
            settings.accessibility,
    );

export const selectIntegrations =
    createSelector(
        [
            selectSettings,
        ],
        settings =>
            settings.integrations,
    );

// ============================================================================
// Appearance Selectors
// ============================================================================

export const selectTheme =
    createSelector(
        [
            selectAppearance,
        ],
        appearance =>
            appearance.theme,
    );

export const selectCompactMode =
    createSelector(
        [
            selectAppearance,
        ],
        appearance =>
            appearance.compactMode,
    );

export const selectAnimations =
    createSelector(
        [
            selectAppearance,
        ],
        appearance =>
            appearance.animations,
    );

export const selectFontSize =
    createSelector(
        [
            selectAppearance,
        ],
        appearance =>
            appearance.fontSize,
    );

export const selectDensity =
    createSelector(
        [
            selectAppearance,
        ],
        appearance =>
            appearance.density,
    );

// ============================================================================
// Localization Selectors
// ============================================================================

export const selectLanguage =
    createSelector(
        [
            selectLocalization,
        ],
        localization =>
            localization.language,
    );

export const selectCurrency =
    createSelector(
        [
            selectLocalization,
        ],
        localization =>
            localization.currency,
    );

export const selectTimezone =
    createSelector(
        [
            selectLocalization,
        ],
        localization =>
            localization.timezone,
    );

export const selectDateFormat =
    createSelector(
        [
            selectLocalization,
        ],
        localization =>
            localization.dateFormat,
    );

export const selectTimeFormat =
    createSelector(
        [
            selectLocalization,
        ],
        localization =>
            localization.timeFormat,
    );

// ============================================================================
// Notification Selectors
// ============================================================================

export const selectEmailNotifications =
    createSelector(
        [
            selectNotifications,
        ],
        notifications =>
            notifications.email,
    );

export const selectSMSNotifications =
    createSelector(
        [
            selectNotifications,
        ],
        notifications =>
            notifications.sms,
    );

export const selectPushNotifications =
    createSelector(
        [
            selectNotifications,
        ],
        notifications =>
            notifications.push,
    );

export const selectInAppNotifications =
    createSelector(
        [
            selectNotifications,
        ],
        notifications =>
            notifications.inApp,
    );

export const selectSecurityAlerts =
    createSelector(
        [
            selectNotifications,
        ],
        notifications =>
            notifications.securityAlerts,
    );

export const selectTransactionAlerts =
    createSelector(
        [
            selectNotifications,
        ],
        notifications =>
            notifications.transactionAlerts,
    );

// ============================================================================
// Privacy Selectors
// ============================================================================

export const selectAnalyticsEnabled =
    createSelector(
        [
            selectPrivacy,
        ],
        privacy =>
            privacy.analytics,
    );

export const selectTelemetryEnabled =
    createSelector(
        [
            selectPrivacy,
        ],
        privacy =>
            privacy.telemetry,
    );

export const selectRememberMe =
    createSelector(
        [
            selectPrivacy,
        ],
        privacy =>
            privacy.rememberMe,
    );

export const selectAutoLogout =
    createSelector(
        [
            selectPrivacy,
        ],
        privacy =>
            privacy.autoLogout,
    );

export const selectAutoLogoutMinutes =
    createSelector(
        [
            selectPrivacy,
        ],
        privacy =>
            privacy.autoLogoutMinutes,
    );

// ============================================================================
// Dashboard Selectors
// ============================================================================

export const selectDashboardWidgets =
    createSelector(
        [
            selectDashboardSettings,
        ],
        dashboard =>
            dashboard.widgets,
    );

export const selectAutoRefresh =
    createSelector(
        [
            selectDashboardSettings,
        ],
        dashboard =>
            dashboard.autoRefresh,
    );

export const selectRefreshInterval =
    createSelector(
        [
            selectDashboardSettings,
        ],
        dashboard =>
            dashboard.refreshInterval,
    );

export const selectShowBalances =
    createSelector(
        [
            selectDashboardSettings,
        ],
        dashboard =>
            dashboard.showBalances,
    );

export const selectDefaultLandingPage =
    createSelector(
        [
            selectDashboardSettings,
        ],
        dashboard =>
            dashboard.defaultLandingPage,
    );

// ============================================================================
// Accessibility Selectors
// ============================================================================

export const selectHighContrast =
    createSelector(
        [
            selectAccessibility,
        ],
        accessibility =>
            accessibility.highContrast,
    );

export const selectReducedMotion =
    createSelector(
        [
            selectAccessibility,
        ],
        accessibility =>
            accessibility.reducedMotion,
    );

export const selectScreenReader =
    createSelector(
        [
            selectAccessibility,
        ],
        accessibility =>
            accessibility.screenReader,
    );

export const selectKeyboardNavigation =
    createSelector(
        [
            selectAccessibility,
        ],
        accessibility =>
            accessibility.keyboardNavigation,
    );

// ============================================================================
// Integration Selectors
// ============================================================================

export const selectMobileMoneyIntegration =
    createSelector(
        [
            selectIntegrations,
        ],
        integrations =>
            integrations.mobileMoney,
    );

export const selectEmailIntegration =
    createSelector(
        [
            selectIntegrations,
        ],
        integrations =>
            integrations.email,
    );

export const selectSMSIntegration =
    createSelector(
        [
            selectIntegrations,
        ],
        integrations =>
            integrations.sms,
    );

export const selectRealtimeIntegration =
    createSelector(
        [
            selectIntegrations,
        ],
        integrations =>
            integrations.realtime,
    );

// ============================================================================
// Operational Summary
// ============================================================================

export const selectSettingsSummary =
    createSelector(
        [
            selectSettings,
        ],
        settings => ({
            initialized:
                settings.initialized,

            loading:
                settings.loading,

            saving:
                settings.saving,

            status:
                settings.status,

            source:
                settings.source,

            version:
                settings.version,

            lastLoaded:
                settings.lastLoaded,

            lastSaved:
                settings.lastSaved,

            lastUpdated:
                settings.lastUpdated,

            lastSyncAt:
                settings.lastSyncAt,

            hasError:
                Boolean(
                    settings.error,
                ),
        }),
    );

// ============================================================================
// Reducer
// ============================================================================

export default
    settingsSlice.reducer;