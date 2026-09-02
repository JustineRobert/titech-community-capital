// ============================================================================
// TITech Community Capital
// Enterprise UI Slice
// File: frontend/src/features/ui/uiSlice.js
// Production Grade
// ============================================================================
//
// Purpose
// ----------------------------------------------------------------------------
// Centralized, serializable frontend UI/runtime presentation state.
//
// Responsibilities
// ----------------------------------------------------------------------------
// ✓ Theme and layout state
// ✓ Responsive sidebar state
// ✓ Page metadata
// ✓ Global/page loading indicators
// ✓ Modal and drawer registry
// ✓ Notification/search/command-palette visibility
// ✓ Fullscreen state
// ✓ Maintenance presentation state
// ✓ Network presentation state
// ✓ Accessibility/UI preferences
// ✓ Safe state normalization
// ✓ Bounded UI registries
// ✓ Production-grade selectors
//
// Security boundary
// ----------------------------------------------------------------------------
// This slice contains presentation state only.
//
// NEVER store here:
//   - access tokens
//   - refresh tokens
//   - passwords
//   - payment credentials
//   - Mobile Money PINs
//   - private keys
//   - API secrets
//   - authoritative authorization decisions
//
// Backend and dedicated security/authentication slices remain authoritative.
// ============================================================================

import {
    createSelector,
    createSlice,
} from "@reduxjs/toolkit";

// ============================================================================
// Constants
// ============================================================================

export const THEMES = Object.freeze({
    LIGHT:
        "light",

    DARK:
        "dark",

    SYSTEM:
        "system",
});

export const SIDEBAR_STATES =
    Object.freeze({
        EXPANDED:
            "expanded",

        COLLAPSED:
            "collapsed",
    });

export const LAYOUTS =
    Object.freeze({
        DEFAULT:
            "default",

        COMPACT:
            "compact",

        EXECUTIVE:
            "executive",
    });

export const UI_DENSITIES =
    Object.freeze({
        COMPACT:
            "compact",

        COMFORTABLE:
            "comfortable",

        SPACIOUS:
            "spacious",
    });

export const UI_FONT_SIZES =
    Object.freeze({
        SMALL:
            "small",

        MEDIUM:
            "medium",

        LARGE:
            "large",
    });

export const NETWORK_STATES =
    Object.freeze({
        ONLINE:
            "online",

        OFFLINE:
            "offline",

        UNKNOWN:
            "unknown",

        DEGRADED:
            "degraded",
    });

const MAX_BREADCRUMBS =
    50;

const MAX_MODAL_REGISTRY =
    100;

const MAX_DRAWER_REGISTRY =
    100;

const MAX_SEARCH_QUERY_LENGTH =
    500;

const MAX_PAGE_TITLE_LENGTH =
    200;

const MAX_PAGE_SUBTITLE_LENGTH =
    500;

// ============================================================================
// Helpers
// ============================================================================

function nowIso() {
    return new Date().toISOString();
}

function normalizeString(
    value,
    fallback = "",
    maxLength = Number.MAX_SAFE_INTEGER,
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return fallback;
    }

    return String(
        value,
    )
        .trim()
        .slice(
            0,
            maxLength,
        );
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
        value === 1 ||
        value === "1" ||
        String(value)
            .trim()
            .toLowerCase() ===
            "true"
    ) {
        return true;
    }

    if (
        value === 0 ||
        value === "0" ||
        String(value)
            .trim()
            .toLowerCase() ===
            "false"
    ) {
        return false;
    }

    return fallback;
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

function normalizeBreadcrumb(
    breadcrumb,
) {
    if (
        typeof breadcrumb ===
        "string"
    ) {
        const label =
            normalizeString(
                breadcrumb,
                "",
                MAX_PAGE_SUBTITLE_LENGTH,
            );

        if (!label) {
            return null;
        }

        return {
            label,
            path:
                null,
            active:
                false,
        };
    }

    if (
        !breadcrumb ||
        typeof breadcrumb !==
            "object"
    ) {
        return null;
    }

    return {
        ...breadcrumb,

        label:
            normalizeString(
                breadcrumb.label ||
                    breadcrumb.title,
                "Breadcrumb",
                MAX_PAGE_SUBTITLE_LENGTH,
            ),

        path:
            normalizeString(
                breadcrumb.path ||
                    breadcrumb.href,
                null,
                1_000,
            ),

        active:
            Boolean(
                breadcrumb.active,
            ),
    };
}

function normalizeBreadcrumbs(
    breadcrumbs,
) {
    if (
        !Array.isArray(
            breadcrumbs,
        )
    ) {
        return [];
    }

    return breadcrumbs
        .map(
            normalizeBreadcrumb,
        )
        .filter(
            Boolean,
        )
        .slice(
            0,
            MAX_BREADCRUMBS,
        );
}

function normalizeRegistryEntry(
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
            payload.id,
            "",
            200,
        );

    if (!id) {
        return null;
    }

    return {
        id,

        open:
            payload.open !==
                false,

        props:
            payload.props &&
            typeof payload.props ===
                "object"
                ? payload.props
                : {},

        openedAt:
            payload.openedAt ||
            nowIso(),

        updatedAt:
            nowIso(),
    };
}

function normalizeRegistry(
    registry,
    maximum,
) {
    if (
        !registry ||
        typeof registry !==
            "object" ||
        Array.isArray(registry)
    ) {
        return {};
    }

    const entries =
        Object.entries(
            registry,
        )
            .slice(
                0,
                maximum,
            );

    const normalized =
        {};

    for (
        const [
            id,
            value,
        ] of entries
    ) {
        const safeId =
            normalizeString(
                id,
                "",
                200,
            );

        if (!safeId) {
            continue;
        }

        const entry =
            normalizeRegistryEntry({
                id:
                    safeId,
                ...(value || {}),
            });

        if (entry) {
            normalized[
                safeId
            ] =
                entry;
        }
    }

    return normalized;
}

function detectInitialNetworkState() {
    try {
        if (
            typeof navigator ===
            "undefined"
        ) {
            return NETWORK_STATES.UNKNOWN;
        }

        if (
            navigator.onLine ===
            true
        ) {
            return NETWORK_STATES.ONLINE;
        }

        if (
            navigator.onLine ===
            false
        ) {
            return NETWORK_STATES.OFFLINE;
        }

        return NETWORK_STATES.UNKNOWN;
    } catch {
        return NETWORK_STATES.UNKNOWN;
    }
}

function createInitialState() {
    return {
        initialized:
            false,

        version:
            1,

        lastUpdatedAt:
            null,

        theme:
            THEMES.SYSTEM,

        layout:
            LAYOUTS.DEFAULT,

        sidebar: {
            state:
                SIDEBAR_STATES.EXPANDED,

            mobileOpen:
                false,
        },

        page: {
            title:
                "TITech Community Capital",

            subtitle:
                "",

            breadcrumbs:
                [],
        },

        loading: {
            global:
                false,

            page:
                false,
        },

        modals:
            {},

        drawers:
            {},

        notificationsPanel:
            false,

        search: {
            open:
                false,

            query:
                "",
        },

        fullscreen:
            false,

        commandPalette:
            false,

        maintenanceMode:
            false,

        network: {
            online:
                detectInitialNetworkState() ===
                NETWORK_STATES.ONLINE,

            state:
                detectInitialNetworkState(),

            lastChangedAt:
                null,

            source:
                "browser",
        },

        preferences: {
            compactTables:
                false,

            animations:
                true,

            reducedMotion:
                false,

            density:
                UI_DENSITIES.COMFORTABLE,

            fontSize:
                UI_FONT_SIZES.MEDIUM,
        },

        accessibility: {
            keyboardNavigation:
                true,

            highContrast:
                false,

            focusVisible:
                true,
        },
    };
}

const initialState =
    createInitialState();

// ============================================================================
// Slice
// ============================================================================

const uiSlice =
    createSlice({

        name:
            "ui",

        initialState,

        reducers: {

            // ------------------------------------------------------------------
            // Initialization
            // ------------------------------------------------------------------

            initializeUI(
                state,
            ) {
                state.initialized =
                    true;

                state.lastUpdatedAt =
                    nowIso();
            },

            hydrateUI(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                if (
                    payload.theme
                ) {
                    state.theme =
                        normalizeEnum(
                            payload.theme,
                            Object.values(
                                THEMES,
                            ),
                            state.theme,
                        );
                }

                if (
                    payload.layout
                ) {
                    state.layout =
                        normalizeEnum(
                            payload.layout,
                            Object.values(
                                LAYOUTS,
                            ),
                            state.layout,
                        );
                }

                if (
                    payload.sidebar
                ) {
                    state.sidebar =
                        {
                            ...state.sidebar,
                            ...payload.sidebar,
                            state:
                                normalizeEnum(
                                    payload.sidebar
                                        .state,
                                    Object.values(
                                        SIDEBAR_STATES,
                                    ),
                                    state.sidebar
                                        .state,
                                ),
                        };
                }

                if (
                    payload.page
                ) {
                    state.page =
                        {
                            ...state.page,
                            ...payload.page,
                            title:
                                normalizeString(
                                    payload.page
                                        .title,
                                    state.page
                                        .title,
                                    MAX_PAGE_TITLE_LENGTH,
                                ),
                            subtitle:
                                normalizeString(
                                    payload.page
                                        .subtitle,
                                    "",
                                    MAX_PAGE_SUBTITLE_LENGTH,
                                ),
                            breadcrumbs:
                                normalizeBreadcrumbs(
                                    payload.page
                                        .breadcrumbs,
                                ),
                        };
                }

                if (
                    payload.preferences
                ) {
                    state.preferences =
                        {
                            ...state.preferences,
                            ...payload.preferences,
                            density:
                                normalizeEnum(
                                    payload
                                        .preferences
                                        .density,
                                    Object.values(
                                        UI_DENSITIES,
                                    ),
                                    state.preferences
                                        .density,
                                ),
                            fontSize:
                                normalizeEnum(
                                    payload
                                        .preferences
                                        .fontSize,
                                    Object.values(
                                        UI_FONT_SIZES,
                                    ),
                                    state.preferences
                                        .fontSize,
                                ),
                        };
                }

                if (
                    payload.accessibility
                ) {
                    state.accessibility =
                        {
                            ...state.accessibility,
                            ...payload.accessibility,
                        };
                }

                state.initialized =
                    true;

                state.lastUpdatedAt =
                    nowIso();
            },

            resetUIState() {
                return createInitialState();
            },

            // ------------------------------------------------------------------
            // Theme
            // ------------------------------------------------------------------

            setTheme(
                state,
                action,
            ) {
                state.theme =
                    normalizeEnum(
                        action.payload,
                        Object.values(
                            THEMES,
                        ),
                        THEMES.SYSTEM,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            toggleTheme(
                state,
            ) {
                switch (
                    state.theme
                ) {
                    case THEMES.DARK:
                        state.theme =
                            THEMES.LIGHT;
                        break;

                    case THEMES.LIGHT:
                    case THEMES.SYSTEM:
                    default:
                        state.theme =
                            THEMES.DARK;
                        break;
                }

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Layout
            // ------------------------------------------------------------------

            setLayout(
                state,
                action,
            ) {
                state.layout =
                    normalizeEnum(
                        action.payload,
                        Object.values(
                            LAYOUTS,
                        ),
                        LAYOUTS.DEFAULT,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Sidebar
            // ------------------------------------------------------------------

            toggleSidebar(
                state,
            ) {
                state.sidebar.state =
                    state.sidebar.state ===
                        SIDEBAR_STATES
                            .EXPANDED
                        ? SIDEBAR_STATES
                            .COLLAPSED
                        : SIDEBAR_STATES
                            .EXPANDED;

                state.lastUpdatedAt =
                    nowIso();
            },

            setSidebarState(
                state,
                action,
            ) {
                state.sidebar.state =
                    normalizeEnum(
                        action.payload,
                        Object.values(
                            SIDEBAR_STATES,
                        ),
                        SIDEBAR_STATES
                            .EXPANDED,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            openMobileSidebar(
                state,
            ) {
                state.sidebar.mobileOpen =
                    true;

                state.lastUpdatedAt =
                    nowIso();
            },

            closeMobileSidebar(
                state,
            ) {
                state.sidebar.mobileOpen =
                    false;

                state.lastUpdatedAt =
                    nowIso();
            },

            toggleMobileSidebar(
                state,
            ) {
                state.sidebar.mobileOpen =
                    !state.sidebar
                        .mobileOpen;

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Page metadata
            // ------------------------------------------------------------------

            setPageTitle(
                state,
                action,
            ) {
                state.page.title =
                    normalizeString(
                        action.payload,
                        "TITech Community Capital",
                        MAX_PAGE_TITLE_LENGTH,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            setPageSubtitle(
                state,
                action,
            ) {
                state.page.subtitle =
                    normalizeString(
                        action.payload,
                        "",
                        MAX_PAGE_SUBTITLE_LENGTH,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            setBreadcrumbs(
                state,
                action,
            ) {
                state.page.breadcrumbs =
                    normalizeBreadcrumbs(
                        action.payload,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            addBreadcrumb(
                state,
                action,
            ) {
                const breadcrumb =
                    normalizeBreadcrumb(
                        action.payload,
                    );

                if (
                    !breadcrumb
                ) {
                    return;
                }

                state.page.breadcrumbs =
                    [
                        ...state.page
                            .breadcrumbs,
                        breadcrumb,
                    ].slice(
                        0,
                        MAX_BREADCRUMBS,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            removeLastBreadcrumb(
                state,
            ) {
                state.page.breadcrumbs.pop();

                state.lastUpdatedAt =
                    nowIso();
            },

            clearPageMetadata(
                state,
            ) {
                state.page =
                    {
                        title:
                            "TITech Community Capital",

                        subtitle:
                            "",

                        breadcrumbs:
                            [],
                    };

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Loading
            // ------------------------------------------------------------------

            setGlobalLoading(
                state,
                action,
            ) {
                state.loading.global =
                    normalizeBoolean(
                        action.payload,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            setPageLoading(
                state,
                action,
            ) {
                state.loading.page =
                    normalizeBoolean(
                        action.payload,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            setLoadingState(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                if (
                    payload.global !==
                    undefined
                ) {
                    state.loading.global =
                        normalizeBoolean(
                            payload.global,
                        );
                }

                if (
                    payload.page !==
                    undefined
                ) {
                    state.loading.page =
                        normalizeBoolean(
                            payload.page,
                        );
                }

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Modals
            // ------------------------------------------------------------------

            openModal(
                state,
                action,
            ) {
                const entry =
                    normalizeRegistryEntry(
                        action.payload,
                    );

                if (
                    !entry
                ) {
                    return;
                }

                state.modals[
                    entry.id
                ] =
                    entry;

                state.modals =
                    normalizeRegistry(
                        state.modals,
                        MAX_MODAL_REGISTRY,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            updateModal(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const id =
                    normalizeString(
                        payload.id,
                        "",
                        200,
                    );

                if (
                    !id ||
                    !state.modals[id]
                ) {
                    return;
                }

                state.modals[id] =
                    {
                        ...state.modals[id],

                        ...(payload.updates ||
                            {}),

                        id,

                        updatedAt:
                            nowIso(),
                    };

                state.lastUpdatedAt =
                    nowIso();
            },

            closeModal(
                state,
                action,
            ) {
                const id =
                    normalizeString(
                        action.payload,
                        "",
                        200,
                    );

                if (
                    !id
                ) {
                    return;
                }

                delete state.modals[
                    id
                ];

                state.lastUpdatedAt =
                    nowIso();
            },

            closeAllModals(
                state,
            ) {
                state.modals =
                    {};

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Drawers
            // ------------------------------------------------------------------

            openDrawer(
                state,
                action,
            ) {
                const entry =
                    normalizeRegistryEntry(
                        action.payload,
                    );

                if (
                    !entry
                ) {
                    return;
                }

                state.drawers[
                    entry.id
                ] =
                    entry;

                state.drawers =
                    normalizeRegistry(
                        state.drawers,
                        MAX_DRAWER_REGISTRY,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            updateDrawer(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const id =
                    normalizeString(
                        payload.id,
                        "",
                        200,
                    );

                if (
                    !id ||
                    !state.drawers[id]
                ) {
                    return;
                }

                state.drawers[id] =
                    {
                        ...state.drawers[id],

                        ...(payload.updates ||
                            {}),

                        id,

                        updatedAt:
                            nowIso(),
                    };

                state.lastUpdatedAt =
                    nowIso();
            },

            closeDrawer(
                state,
                action,
            ) {
                const id =
                    normalizeString(
                        action.payload,
                        "",
                        200,
                    );

                if (
                    !id
                ) {
                    return;
                }

                delete state.drawers[
                    id
                ];

                state.lastUpdatedAt =
                    nowIso();
            },

            closeAllDrawers(
                state,
            ) {
                state.drawers =
                    {};

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Notifications panel
            // ------------------------------------------------------------------

            openNotificationsPanel(
                state,
            ) {
                state.notificationsPanel =
                    true;

                state.lastUpdatedAt =
                    nowIso();
            },

            closeNotificationsPanel(
                state,
            ) {
                state.notificationsPanel =
                    false;

                state.lastUpdatedAt =
                    nowIso();
            },

            toggleNotificationsPanel(
                state,
            ) {
                state.notificationsPanel =
                    !state
                        .notificationsPanel;

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Search
            // ------------------------------------------------------------------

            openSearch(
                state,
            ) {
                state.search.open =
                    true;

                state.lastUpdatedAt =
                    nowIso();
            },

            closeSearch(
                state,
            ) {
                state.search.open =
                    false;

                state.search.query =
                    "";

                state.lastUpdatedAt =
                    nowIso();
            },

            setSearchQuery(
                state,
                action,
            ) {
                state.search.query =
                    normalizeString(
                        action.payload,
                        "",
                        MAX_SEARCH_QUERY_LENGTH,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Command palette
            // ------------------------------------------------------------------

            openCommandPalette(
                state,
            ) {
                state.commandPalette =
                    true;

                state.lastUpdatedAt =
                    nowIso();
            },

            closeCommandPalette(
                state,
            ) {
                state.commandPalette =
                    false;

                state.lastUpdatedAt =
                    nowIso();
            },

            toggleCommandPalette(
                state,
            ) {
                state.commandPalette =
                    !state.commandPalette;

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Fullscreen
            // ------------------------------------------------------------------

            setFullscreen(
                state,
                action,
            ) {
                state.fullscreen =
                    normalizeBoolean(
                        action.payload,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            toggleFullscreen(
                state,
            ) {
                state.fullscreen =
                    !state.fullscreen;

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Maintenance
            // ------------------------------------------------------------------

            setMaintenanceMode(
                state,
                action,
            ) {
                if (
                    typeof action.payload ===
                    "object"
                ) {
                    state.maintenanceMode =
                        Boolean(
                            action.payload
                                .enabled,
                        );
                } else {
                    state.maintenanceMode =
                        Boolean(
                            action.payload,
                        );
                }

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Network
            // ------------------------------------------------------------------

            setNetworkStatus(
                state,
                action,
            ) {
                const payload =
                    action.payload;

                if (
                    typeof payload ===
                    "object"
                ) {
                    const nextState =
                        normalizeEnum(
                            payload.state,
                            Object.values(
                                NETWORK_STATES,
                            ),
                            NETWORK_STATES
                                .UNKNOWN,
                        );

                    state.network.state =
                        nextState;

                    state.network.online =
                        nextState ===
                        NETWORK_STATES
                            .ONLINE;

                    state.network.source =
                        payload.source ||
                        state.network.source;

                    state.network
                        .lastChangedAt =
                        nowIso();

                    return;
                }

                const online =
                    Boolean(
                        payload,
                    );

                state.network.online =
                    online;

                state.network.state =
                    online
                        ? NETWORK_STATES
                            .ONLINE
                        : NETWORK_STATES
                            .OFFLINE;

                state.network.source =
                    "application";

                state.network
                    .lastChangedAt =
                    nowIso();

                state.lastUpdatedAt =
                    nowIso();
            },

            setNetworkState(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                const networkState =
                    normalizeEnum(
                        payload.state,
                        Object.values(
                            NETWORK_STATES,
                        ),
                        NETWORK_STATES
                            .UNKNOWN,
                    );

                state.network.state =
                    networkState;

                state.network.online =
                    networkState ===
                    NETWORK_STATES
                        .ONLINE;

                state.network.source =
                    payload.source ||
                    state.network.source;

                state.network
                    .lastChangedAt =
                    payload.timestamp ||
                    nowIso();

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Preferences
            // ------------------------------------------------------------------

            setUIPreferences(
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

                state.preferences.density =
                    normalizeEnum(
                        state.preferences
                            .density,
                        Object.values(
                            UI_DENSITIES,
                        ),
                        UI_DENSITIES
                            .COMFORTABLE,
                    );

                state.preferences.fontSize =
                    normalizeEnum(
                        state.preferences
                            .fontSize,
                        Object.values(
                            UI_FONT_SIZES,
                        ),
                        UI_FONT_SIZES
                            .MEDIUM,
                    );

                state.preferences
                    .animations =
                    normalizeBoolean(
                        state.preferences
                            .animations,
                        true,
                    );

                state.preferences
                    .reducedMotion =
                    normalizeBoolean(
                        state.preferences
                            .reducedMotion,
                        false,
                    );

                state.preferences
                    .compactTables =
                    normalizeBoolean(
                        state.preferences
                            .compactTables,
                        false,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            setCompactTables(
                state,
                action,
            ) {
                state.preferences
                    .compactTables =
                    normalizeBoolean(
                        action.payload,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            setAnimations(
                state,
                action,
            ) {
                state.preferences
                    .animations =
                    normalizeBoolean(
                        action.payload,
                    );

                if (
                    state.preferences
                        .animations
                ) {
                    state.preferences
                        .reducedMotion =
                        false;
                }

                state.lastUpdatedAt =
                    nowIso();
            },

            setReducedMotion(
                state,
                action,
            ) {
                state.preferences
                    .reducedMotion =
                    normalizeBoolean(
                        action.payload,
                    );

                if (
                    state.preferences
                        .reducedMotion
                ) {
                    state.preferences
                        .animations =
                        false;
                }

                state.lastUpdatedAt =
                    nowIso();
            },

            setDensity(
                state,
                action,
            ) {
                state.preferences.density =
                    normalizeEnum(
                        action.payload,
                        Object.values(
                            UI_DENSITIES,
                        ),
                        UI_DENSITIES
                            .COMFORTABLE,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            setFontSize(
                state,
                action,
            ) {
                state.preferences.fontSize =
                    normalizeEnum(
                        action.payload,
                        Object.values(
                            UI_FONT_SIZES,
                        ),
                        UI_FONT_SIZES
                            .MEDIUM,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },

            // ------------------------------------------------------------------
            // Accessibility
            // ------------------------------------------------------------------

            setAccessibilityPreferences(
                state,
                action,
            ) {
                const payload =
                    action.payload ||
                    {};

                state.accessibility =
                    {
                        ...state.accessibility,
                        ...payload,
                    };

                state.accessibility
                    .keyboardNavigation =
                    normalizeBoolean(
                        state.accessibility
                            .keyboardNavigation,
                        true,
                    );

                state.accessibility
                    .highContrast =
                    normalizeBoolean(
                        state.accessibility
                            .highContrast,
                        false,
                    );

                state.accessibility
                    .focusVisible =
                    normalizeBoolean(
                        state.accessibility
                            .focusVisible,
                        true,
                    );

                state.lastUpdatedAt =
                    nowIso();
            },
        },
    });

// ============================================================================
// Actions
// ============================================================================

export const {
    initializeUI,
    hydrateUI,
    resetUIState,

    setTheme,
    toggleTheme,

    setLayout,

    toggleSidebar,
    setSidebarState,
    openMobileSidebar,
    closeMobileSidebar,
    toggleMobileSidebar,

    setPageTitle,
    setPageSubtitle,
    setBreadcrumbs,
    addBreadcrumb,
    removeLastBreadcrumb,
    clearPageMetadata,

    setGlobalLoading,
    setPageLoading,
    setLoadingState,

    openModal,
    updateModal,
    closeModal,
    closeAllModals,

    openDrawer,
    updateDrawer,
    closeDrawer,
    closeAllDrawers,

    openNotificationsPanel,
    closeNotificationsPanel,
    toggleNotificationsPanel,

    openSearch,
    closeSearch,
    setSearchQuery,

    openCommandPalette,
    closeCommandPalette,
    toggleCommandPalette,

    setFullscreen,
    toggleFullscreen,

    setMaintenanceMode,

    setNetworkStatus,
    setNetworkState,

    setUIPreferences,
    setCompactTables,
    setAnimations,
    setReducedMotion,
    setDensity,
    setFontSize,

    setAccessibilityPreferences,
} =
    uiSlice.actions;

// ============================================================================
// Base Selectors
// ============================================================================

export const selectUI =
    state =>
        state?.ui ||
        initialState;

export const selectUIInitialized =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.initialized,
    );

export const selectTheme =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.theme,
    );

export const selectLayout =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.layout,
    );

export const selectSidebar =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.sidebar,
    );

export const selectPage =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.page,
    );

export const selectLoading =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.loading,
    );

export const selectGlobalLoading =
    createSelector(
        [
            selectLoading,
        ],
        loading =>
            loading.global,
    );

export const selectPageLoading =
    createSelector(
        [
            selectLoading,
        ],
        loading =>
            loading.page,
    );

export const selectModals =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.modals,
    );

export const selectDrawers =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.drawers,
    );

export const selectSearch =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.search,
    );

export const selectPreferences =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.preferences,
    );

export const selectAccessibility =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.accessibility,
    );

export const selectNotificationsPanel =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.notificationsPanel,
    );

export const selectFullscreen =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.fullscreen,
    );

export const selectCommandPalette =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.commandPalette,
    );

export const selectMaintenanceMode =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.maintenanceMode,
    );

export const selectNetwork =
    createSelector(
        [
            selectUI,
        ],
        ui =>
            ui.network,
    );

export const selectNetworkOnline =
    createSelector(
        [
            selectNetwork,
        ],
        network =>
            network.online,
    );

export const selectNetworkState =
    createSelector(
        [
            selectNetwork,
        ],
        network =>
            network.state,
    );

// ============================================================================
// Sidebar Selectors
// ============================================================================

export const selectSidebarState =
    createSelector(
        [
            selectSidebar,
        ],
        sidebar =>
            sidebar.state,
    );

export const selectIsMobileSidebarOpen =
    createSelector(
        [
            selectSidebar,
        ],
        sidebar =>
            sidebar.mobileOpen,
    );

export const selectSidebarCollapsed =
    createSelector(
        [
            selectSidebar,
        ],
        sidebar =>
            sidebar.state ===
            SIDEBAR_STATES
                .COLLAPSED,
    );

export const selectSidebarExpanded =
    createSelector(
        [
            selectSidebar,
        ],
        sidebar =>
            sidebar.state ===
            SIDEBAR_STATES
                .EXPANDED,
    );

// ============================================================================
// Search Selectors
// ============================================================================

export const selectSearchOpen =
    createSelector(
        [
            selectSearch,
        ],
        search =>
            search.open,
    );

export const selectSearchQuery =
    createSelector(
        [
            selectSearch,
        ],
        search =>
            search.query,
    );

// ============================================================================
// Page Selectors
// ============================================================================

export const selectPageTitle =
    createSelector(
        [
            selectPage,
        ],
        page =>
            page.title,
    );

export const selectPageSubtitle =
    createSelector(
        [
            selectPage,
        ],
        page =>
            page.subtitle,
    );

export const selectBreadcrumbs =
    createSelector(
        [
            selectPage,
        ],
        page =>
            page.breadcrumbs,
    );

// ============================================================================
// Preference Selectors
// ============================================================================

export const selectCompactTables =
    createSelector(
        [
            selectPreferences,
        ],
        preferences =>
            preferences.compactTables,
    );

export const selectAnimations =
    createSelector(
        [
            selectPreferences,
        ],
        preferences =>
            preferences.animations,
    );

export const selectReducedMotion =
    createSelector(
        [
            selectPreferences,
        ],
        preferences =>
            preferences.reducedMotion,
    );

export const selectDensity =
    createSelector(
        [
            selectPreferences,
        ],
        preferences =>
            preferences.density,
    );

export const selectFontSize =
    createSelector(
        [
            selectPreferences,
        ],
        preferences =>
            preferences.fontSize,
    );

// ============================================================================
// Registry Selectors
// ============================================================================

export const makeSelectModal =
    id =>
        createSelector(
            [
                selectModals,
            ],
            modals =>
                modals?.[id] ||
                null,
        );

export const makeSelectModalOpen =
    id =>
        createSelector(
            [
                selectModals,
            ],
            modals =>
                Boolean(
                    modals?.[id]?.open,
                ),
        );

export const makeSelectDrawer =
    id =>
        createSelector(
            [
                selectDrawers,
            ],
            drawers =>
                drawers?.[id] ||
                null,
        );

export const makeSelectDrawerOpen =
    id =>
        createSelector(
            [
                selectDrawers,
            ],
            drawers =>
                Boolean(
                    drawers?.[id]?.open,
                ),
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

export const selectKeyboardNavigation =
    createSelector(
        [
            selectAccessibility,
        ],
        accessibility =>
            accessibility.keyboardNavigation,
    );

export const selectFocusVisible =
    createSelector(
        [
            selectAccessibility,
        ],
        accessibility =>
            accessibility.focusVisible,
    );

// ============================================================================
// Composite Selectors
// ============================================================================

export const selectUIReadiness =
    createSelector(
        [
            selectUIInitialized,
            selectMaintenanceMode,
        ],
        (
            initialized,
            maintenanceMode,
        ) => ({
            initialized,
            maintenanceMode,
            ready:
                initialized &&
                !maintenanceMode,
        }),
    );

export const selectUIInteractionState =
    createSelector(
        [
            selectSearchOpen,
            selectCommandPalette,
            selectNotificationsPanel,
            selectIsMobileSidebarOpen,
            selectFullscreen,
        ],
        (
            searchOpen,
            commandPalette,
            notificationsPanel,
            mobileSidebarOpen,
            fullscreen,
        ) => ({
            searchOpen,
            commandPalette,
            notificationsPanel,
            mobileSidebarOpen,
            fullscreen,

            hasOverlay:
                Boolean(
                    searchOpen ||
                    commandPalette ||
                    notificationsPanel ||
                    mobileSidebarOpen,
                ),
        }),
    );

export const selectUISummary =
    createSelector(
        [
            selectUI,
        ],
        ui => ({
            initialized:
                ui.initialized,

            theme:
                ui.theme,

            layout:
                ui.layout,

            sidebar:
                ui.sidebar.state,

            mobileSidebarOpen:
                ui.sidebar.mobileOpen,

            globalLoading:
                ui.loading.global,

            pageLoading:
                ui.loading.page,

            openModals:
                Object.keys(
                    ui.modals,
                ).length,

            openDrawers:
                Object.keys(
                    ui.drawers,
                ).length,

            notificationsPanel:
                ui.notificationsPanel,

            searchOpen:
                ui.search.open,

            commandPalette:
                ui.commandPalette,

            fullscreen:
                ui.fullscreen,

            maintenanceMode:
                ui.maintenanceMode,

            networkState:
                ui.network.state,

            networkOnline:
                ui.network.online,

            density:
                ui.preferences.density,

            reducedMotion:
                ui.preferences.reducedMotion,

            lastUpdatedAt:
                ui.lastUpdatedAt,
        }),
    );

// ============================================================================
// Reducer
// ============================================================================

export default
    uiSlice.reducer;