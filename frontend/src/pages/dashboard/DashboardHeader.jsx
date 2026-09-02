// ============================================================================
// TITech Community Capital
// Enterprise Dashboard Header
//
// File:
// frontend/src/pages/dashboard/DashboardHeader.jsx
//
// Production Grade
// Multi-Tenant | Real-Time | Accessible
// Theme Persistence | Tenant Switching | Resilient Actions
// Session Safety | Responsive Navigation | Enterprise UX
// ============================================================================

"use strict";

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Bell,
  Building2,
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Search,
  Settings,
  Sun,
  User,
  Wifi,
  WifiOff,
} from "lucide-react";

import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import { useAuth } from "../../context/AuthContext";
import useRealtimeDashboard from "../../hooks/useRealtimeDashboard";

import {
  Button,
  SearchBox,
  NotificationBell,
  TenantSwitcher,
} from "../../ui";

import "./DashboardHeader.css";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TITLE = "Dashboard";

const THEME_STORAGE_KEY = "theme";

const THEME_DARK = "dark";
const THEME_LIGHT = "light";

const MAX_NOTIFICATION_BADGE = 99;

const SEARCH_PLACEHOLDER =
  "Search groups, members, loans...";

// ============================================================================
// Helpers
// ============================================================================

function formatGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Good Morning";
  }

  if (hour < 18) {
    return "Good Afternoon";
  }

  return "Good Evening";
}

function getUserDisplayName(user) {
  return (
    user?.name ||
    user?.fullName ||
    user?.displayName ||
    user?.firstName ||
    user?.email ||
    "User"
  );
}

function getInitialTheme() {
  if (
    typeof document === "undefined"
  ) {
    return THEME_LIGHT;
  }

  const root =
    document.documentElement;

  if (
    root.classList.contains(
      THEME_DARK
    )
  ) {
    return THEME_DARK;
  }

  if (
    root.classList.contains(
      THEME_LIGHT
    )
  ) {
    return THEME_LIGHT;
  }

  if (
    typeof window !== "undefined" &&
    typeof window.localStorage !==
      "undefined"
  ) {
    try {
      const storedTheme =
        window.localStorage.getItem(
          THEME_STORAGE_KEY
        );

      if (
        storedTheme === THEME_DARK ||
        storedTheme === THEME_LIGHT
      ) {
        return storedTheme;
      }
    } catch {
      // Storage may be unavailable.
    }
  }

  if (
    typeof window !== "undefined" &&
    window.matchMedia
  ) {
    try {
      return window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches
        ? THEME_DARK
        : THEME_LIGHT;
    } catch {
      // Ignore unsupported matchMedia implementations.
    }
  }

  return THEME_LIGHT;
}

function applyTheme(theme) {
  if (
    typeof document === "undefined"
  ) {
    return;
  }

  const root =
    document.documentElement;

  const isDark =
    theme === THEME_DARK;

  root.classList.toggle(
    THEME_DARK,
    isDark
  );

  root.classList.toggle(
    THEME_LIGHT,
    !isDark
  );

  root.setAttribute(
    "data-theme",
    isDark
      ? THEME_DARK
      : THEME_LIGHT
  );

  root.style.colorScheme =
    isDark ? "dark" : "light";
}

function persistTheme(theme) {
  if (
    typeof window === "undefined"
  ) {
    return;
  }

  try {
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      theme
    );
  } catch {
    // Storage may be unavailable or blocked.
  }
}

function normalizeNotificationCount(
  value
) {
  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue
    ) ||
    numericValue <= 0
  ) {
    return 0;
  }

  return Math.floor(
    numericValue
  );
}

// ============================================================================
// Dashboard Header
// ============================================================================

function DashboardHeader({
  title = DEFAULT_TITLE,
  subtitle,
  notificationCount = 0,
  loading = false,
  onRefresh,
  onSearch,
  onToggleSidebar,
  showSearch = true,
  showTenantSwitcher = true,
  showRefresh = true,
  showNotifications = true,
  showSettings = true,
  showThemeToggle = true,
  showLogout = true,
  className = "",
}) {
  const navigate =
    useNavigate();

  // ==========================================================================
  // Authentication
  // ==========================================================================

  const {
    user,
    tenant,
    logout,
    switchTenant,
  } = useAuth();

  // ==========================================================================
  // Realtime
  // ==========================================================================

  const realtime =
    useRealtimeDashboard({
      autoConnect: false,
    });

  // ==========================================================================
  // Local State
  // ==========================================================================

  const [
    theme,
    setTheme,
  ] = useState(
    getInitialTheme
  );

  const [
    userMenuOpen,
    setUserMenuOpen,
  ] = useState(false);

  const [
    refreshInProgress,
    setRefreshInProgress,
  ] = useState(false);

  const [
    tenantSwitching,
    setTenantSwitching,
  ] = useState(false);

  const userMenuRef =
    useRef(null);

  // ==========================================================================
  // Derived Values
  // ==========================================================================

  const displayName =
    useMemo(
      () =>
        getUserDisplayName(
          user
        ),
      [user]
    );

  const greeting =
    useMemo(
      () =>
        `${formatGreeting()}, ${displayName}`,
      [displayName]
    );

  const normalizedNotificationCount =
    useMemo(
      () =>
        normalizeNotificationCount(
          notificationCount
        ),
      [notificationCount]
    );

  const notificationLabel =
    normalizedNotificationCount >
    0
      ? `Notifications, ${normalizedNotificationCount} unread`
      : "Notifications";

  const displayedNotificationCount =
    normalizedNotificationCount >
    MAX_NOTIFICATION_BADGE
      ? `${MAX_NOTIFICATION_BADGE}+`
      : String(
          normalizedNotificationCount
        );

  const isDarkMode =
    theme === THEME_DARK;

  const effectiveLoading =
    loading ||
    refreshInProgress;

  // ==========================================================================
  // Theme Initialization
  // ==========================================================================

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // ==========================================================================
  // Cross-Tab Theme Synchronization
  // ==========================================================================

  useEffect(() => {
    if (
      typeof window === "undefined"
    ) {
      return undefined;
    }

    const handleStorage = event => {
      if (
        event.key !==
          THEME_STORAGE_KEY ||
        !event.newValue
      ) {
        return;
      }

      if (
        event.newValue !==
          THEME_DARK &&
        event.newValue !==
          THEME_LIGHT
      ) {
        return;
      }

      setTheme(
        event.newValue
      );
    };

    window.addEventListener(
      "storage",
      handleStorage
    );

    return () => {
      window.removeEventListener(
        "storage",
        handleStorage
      );
    };
  }, []);

  // ==========================================================================
  // User Menu Outside Click
  // ==========================================================================

  useEffect(() => {
    if (!userMenuOpen) {
      return undefined;
    }

    const handlePointerDown =
      event => {
        const menu =
          userMenuRef.current;

        if (
          menu &&
          !menu.contains(
            event.target
          )
        ) {
          setUserMenuOpen(
            false
          );
        }
      };

    document.addEventListener(
      "pointerdown",
      handlePointerDown
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        handlePointerDown
      );
    };
  }, [userMenuOpen]);

  // ==========================================================================
  // User Menu Escape Handling
  // ==========================================================================

  useEffect(() => {
    if (!userMenuOpen) {
      return undefined;
    }

    const handleKeyDown =
      event => {
        if (
          event.key === "Escape"
        ) {
          setUserMenuOpen(
            false
          );
        }
      };

    document.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [userMenuOpen]);

  // ==========================================================================
  // Search
  // ==========================================================================

  const handleSearch =
    useCallback(
      value => {
        if (
          typeof onSearch !==
          "function"
        ) {
          return;
        }

        onSearch(value);
      },
      [onSearch]
    );

  // ==========================================================================
  // Refresh
  // ==========================================================================

  const handleRefresh =
    useCallback(async () => {
      if (
        effectiveLoading
      ) {
        return;
      }

      if (
        typeof onRefresh !==
        "function"
      ) {
        return;
      }

      try {
        setRefreshInProgress(
          true
        );

        await onRefresh();

        toast.success(
          "Dashboard refreshed."
        );
      } catch (error) {
        if (
          import.meta.env?.DEV
        ) {
          console.warn(
            "[TITECH DASHBOARD HEADER] Refresh failed",
            error
          );
        }

        toast.error(
          "Unable to refresh dashboard."
        );
      } finally {
        setRefreshInProgress(
          false
        );
      }
    }, [
      effectiveLoading,
      onRefresh,
    ]);

  // ==========================================================================
  // Logout
  // ==========================================================================

  const handleLogout =
    useCallback(async () => {
      try {
        setUserMenuOpen(
          false
        );

        await logout();

        navigate(
          "/login",
          {
            replace: true,
          }
        );
      } catch (error) {
        if (
          import.meta.env?.DEV
        ) {
          console.warn(
            "[TITECH DASHBOARD HEADER] Logout failed",
            error
          );
        }

        toast.error(
          "Logout failed. Please try again."
        );
      }
    }, [
      logout,
      navigate,
    ]);

  // ==========================================================================
  // Theme
  // ==========================================================================

  const toggleTheme =
    useCallback(() => {
      const nextTheme =
        theme === THEME_DARK
          ? THEME_LIGHT
          : THEME_DARK;

      setTheme(nextTheme);

      applyTheme(
        nextTheme
      );

      persistTheme(
        nextTheme
      );
    }, [theme]);

  // ==========================================================================
  // Tenant Change
  // ==========================================================================

  const handleTenantChange =
    useCallback(
      async tenantId => {
        if (
          !tenantId ||
          tenantSwitching
        ) {
          return;
        }

        if (
          typeof switchTenant !==
          "function"
        ) {
          toast.error(
            "Tenant switching is unavailable."
          );

          return;
        }

        try {
          setTenantSwitching(
            true
          );

          await switchTenant(
            tenantId
          );

          toast.success(
            "Tenant switched successfully."
          );
        } catch (error) {
          if (
            import.meta.env?.DEV
          ) {
            console.warn(
              "[TITECH DASHBOARD HEADER] Tenant switch failed",
              error
            );
          }

          toast.error(
            "Unable to switch tenant."
          );
        } finally {
          setTenantSwitching(
            false
          );
        }
      },
      [
        switchTenant,
        tenantSwitching,
      ]
    );

  // ==========================================================================
  // Navigation
  // ==========================================================================

  const navigateTo =
    useCallback(
      path => {
        setUserMenuOpen(
          false
        );

        navigate(path);
      },
      [navigate]
    );

  // ==========================================================================
  // Sidebar
  // ==========================================================================

  const handleToggleSidebar =
    useCallback(() => {
      onToggleSidebar?.();
    }, [
      onToggleSidebar,
    ]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <header
      className={[
        "dashboard-header",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="banner"
    >
      {/* ================================================================== */}
      {/* Left */}
      {/* ================================================================== */}

      <div className="dashboard-header-left">
        {typeof onToggleSidebar ===
          "function" && (
          <Button
            type="button"
            variant="ghost"
            onClick={
              handleToggleSidebar
            }
            aria-label="Toggle navigation sidebar"
            title="Toggle navigation sidebar"
          >
            <Menu
              size={20}
              aria-hidden="true"
            />
          </Button>
        )}

        <div className="dashboard-header-title">
          <h1>
            {title}
          </h1>

          <p>
            {subtitle ||
              greeting}
          </p>
        </div>
      </div>

      {/* ================================================================== */}
      {/* Center Search */}
      {/* ================================================================== */}

      {showSearch && (
        <div
          className="dashboard-header-search"
          role="search"
          aria-label="Dashboard search"
        >
          {SearchBox ? (
            <SearchBox
              placeholder={
                SEARCH_PLACEHOLDER
              }
              onSearch={
                handleSearch
              }
              aria-label="Search dashboard"
            />
          ) : (
            <div className="dashboard-search-fallback">
              <Search
                size={18}
                aria-hidden="true"
              />

              <input
                type="search"
                placeholder="Search..."
                aria-label="Search dashboard"
                onChange={event =>
                  handleSearch(
                    event.target
                      .value
                  )
                }
              />
            </div>
          )}
        </div>
      )}

      {/* ================================================================== */}
      {/* Right Actions */}
      {/* ================================================================== */}

      <div
        className="dashboard-header-actions"
        role="toolbar"
        aria-label="Dashboard controls"
      >
        {/* ---------------------------------------------------------------- */}
        {/* Tenant */}
        {/* ---------------------------------------------------------------- */}

        {showTenantSwitcher &&
          tenant && (
            <div
              className="dashboard-tenant"
              aria-label={`Current tenant: ${
                tenant.name ||
                "Current tenant"
              }`}
            >
              {TenantSwitcher ? (
                <TenantSwitcher
                  tenant={
                    tenant
                  }
                  onChange={
                    handleTenantChange
                  }
                  disabled={
                    tenantSwitching
                  }
                />
              ) : (
                <>
                  <Building2
                    size={18}
                    aria-hidden="true"
                  />

                  <span>
                    {tenant.name ||
                      "Current tenant"}
                  </span>

                  {tenantSwitching && (
                    <RefreshCw
                      size={15}
                      aria-hidden="true"
                      className="spin"
                    />
                  )}
                </>
              )}
            </div>
          )}

        {/* ---------------------------------------------------------------- */}
        {/* Connectivity */}
        {/* ---------------------------------------------------------------- */}

        <Button
          type="button"
          variant="ghost"
          aria-label={
            realtime.connected
              ? "Realtime connection active"
              : "Realtime connection unavailable"
          }
          title={
            realtime.connected
              ? "Realtime connected"
              : "Realtime disconnected"
          }
        >
          {realtime.connected ? (
            <Wifi
              size={18}
              aria-hidden="true"
            />
          ) : (
            <WifiOff
              size={18}
              aria-hidden="true"
            />
          )}

          <span className="sr-only">
            {realtime.connected
              ? "Realtime connected"
              : "Realtime disconnected"}
          </span>
        </Button>

        {/* ---------------------------------------------------------------- */}
        {/* Refresh */}
        {/* ---------------------------------------------------------------- */}

        {showRefresh && (
          <Button
            type="button"
            variant="ghost"
            disabled={
              effectiveLoading
            }
            onClick={
              handleRefresh
            }
            aria-label={
              effectiveLoading
                ? "Refreshing dashboard"
                : "Refresh dashboard"
            }
            title={
              effectiveLoading
                ? "Refreshing dashboard"
                : "Refresh dashboard"
            }
          >
            <RefreshCw
              size={18}
              aria-hidden="true"
              className={
                effectiveLoading
                  ? "spin"
                  : undefined
              }
            />
          </Button>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Notifications */}
        {/* ---------------------------------------------------------------- */}

        {showNotifications &&
          (NotificationBell ? (
            <NotificationBell
              count={
                normalizedNotificationCount
              }
              aria-label={
                notificationLabel
              }
            />
          ) : (
            <Button
              type="button"
              variant="ghost"
              aria-label={
                notificationLabel
              }
              title="Notifications"
              onClick={() =>
                navigateTo(
                  "/notifications"
                )
              }
            >
              <Bell
                size={18}
                aria-hidden="true"
              />

              {normalizedNotificationCount >
                0 && (
                <span
                  className="notification-badge"
                  aria-hidden="true"
                >
                  {
                    displayedNotificationCount
                  }
                </span>
              )}
            </Button>
          ))}

        {/* ---------------------------------------------------------------- */}
        {/* Theme */}
        {/* ---------------------------------------------------------------- */}

        {showThemeToggle && (
          <Button
            type="button"
            variant="ghost"
            onClick={
              toggleTheme
            }
            aria-label={
              isDarkMode
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
            title={
              isDarkMode
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
          >
            {isDarkMode ? (
              <Sun
                size={18}
                aria-hidden="true"
              />
            ) : (
              <Moon
                size={18}
                aria-hidden="true"
              />
            )}
          </Button>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Settings */}
        {/* ---------------------------------------------------------------- */}

        {showSettings && (
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              navigateTo(
                "/settings"
              )
            }
            aria-label="Open settings"
            title="Settings"
          >
            <Settings
              size={18}
              aria-hidden="true"
            />
          </Button>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* User Menu */}
        {/* ---------------------------------------------------------------- */}

        <div
          ref={userMenuRef}
          className="dashboard-user-menu"
        >
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              setUserMenuOpen(
                previous =>
                  !previous
              )
            }
            aria-haspopup="menu"
            aria-expanded={
              userMenuOpen
            }
            aria-label={`User menu for ${displayName}`}
            title="Open user menu"
          >
            <User
              size={18}
              aria-hidden="true"
            />

            <span className="dashboard-user-name">
              {displayName}
            </span>

            <ChevronDown
              size={16}
              aria-hidden="true"
              className={
                userMenuOpen
                  ? "dashboard-user-menu-chevron-open"
                  : undefined
              }
            />
          </Button>

          {userMenuOpen && (
            <div
              className="dashboard-user-dropdown"
              role="menu"
              aria-label="User menu"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  navigateTo(
                    "/profile"
                  )
                }
              >
                <User
                  size={16}
                  aria-hidden="true"
                />

                <span>
                  Profile
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  navigateTo(
                    "/account"
                  )
                }
              >
                <Settings
                  size={16}
                  aria-hidden="true"
                />

                <span>
                  Account
                </span>
              </button>

              {showLogout && (
                <>
                  <div
                    className="dashboard-user-dropdown-divider"
                    role="separator"
                  />

                  <button
                    type="button"
                    role="menuitem"
                    onClick={
                      handleLogout
                    }
                  >
                    <LogOut
                      size={16}
                      aria-hidden="true"
                    />

                    <span>
                      Sign out
                    </span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default memo(
  DashboardHeader
);