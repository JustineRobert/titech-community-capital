// ============================================================================
// TITech Community Capital
// Enterprise Navigation Bar
// File: frontend/src/components/Navbar.jsx
// Production Grade
// ============================================================================
//
// Purpose
// ----------------------------------------------------------------------------
// Primary application navigation for TITech Community Capital.
//
// Responsibilities
// ----------------------------------------------------------------------------
// ✓ Application branding
// ✓ Primary navigation
// ✓ Authentication-aware navigation
// ✓ Active route indication
// ✓ Responsive mobile navigation
// ✓ Accessible keyboard navigation
// ✓ Logout lifecycle handling
// ✓ Logout error resilience
// ✓ Stable test selectors
// ✓ Defensive user-data normalization
// ✓ React Router integration
// ✓ TITech branding consistency
//
// Security Boundary
// ----------------------------------------------------------------------------
// This component is presentation/navigation logic only.
//
// It MUST NOT be treated as an authorization, tenant-isolation, financial,
// KYC/AML, compliance, or security boundary.
//
// Backend/API authorization remains authoritative.
//
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
  Link,
  NavLink,
  useLocation,
  useNavigate,
} from "react-router-dom";

import {
  Menu,
  X,
  LogIn,
  LogOut,
  UserCircle,
  LayoutDashboard,
  Users,
  ChevronDown,
  AlertCircle,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";

import "./Navbar.css";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TEST_ID = "titech-navbar";

const LOGO_SRC = "/images/Designer.png";

const NAVIGATION_ITEMS = Object.freeze([
  {
    id: "dashboard",
    label: "Dashboard",
    to: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    id: "groups",
    label: "Groups",
    to: "/groups",
    icon: Users,
  },
]);

const ROUTES = Object.freeze({
  HOME: "/",
  LOGIN: "/login",
  REGISTER: "/register",
  DASHBOARD: "/dashboard",
  GROUPS: "/groups",
});

// ============================================================================
// Normalization Helpers
// ============================================================================

function normalizeString(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim();

  return normalized || fallback;
}

function getUserDisplayName(user) {
  if (!user || typeof user !== "object") {
    return "Account";
  }

  return normalizeString(
    user.name ??
      user.fullName ??
      user.displayName ??
      user.username ??
      user.email,
    "Account",
  );
}

function getUserInitials(user) {
  const displayName = getUserDisplayName(user);

  if (!displayName || displayName === "Account") {
    return "AC";
  }

  const parts = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return parts
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function isRouteActive(pathname, route) {
  if (!pathname || !route) {
    return false;
  }

  if (route === ROUTES.DASHBOARD) {
    return (
      pathname === route ||
      pathname.startsWith(`${route}/`)
    );
  }

  if (route === ROUTES.GROUPS) {
    return (
      pathname === route ||
      pathname.startsWith(`${route}/`)
    );
  }

  return pathname === route;
}

// ============================================================================
// NavLink Class Helper
// ============================================================================

function getNavLinkClassName({ isActive }) {
  return [
    "titech-navbar__nav-link",
    isActive
      ? "titech-navbar__nav-link--active"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

// ============================================================================
// Navbar
// ============================================================================

function Navbar({
  testId = DEFAULT_TEST_ID,
  showNavigation = true,
  showUserMenu = true,
}) {
  const {
    user,
    logout,
  } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();

  const [mobileOpen, setMobileOpen] =
    useState(false);

  const [userMenuOpen, setUserMenuOpen] =
    useState(false);

  const [loggingOut, setLoggingOut] =
    useState(false);

  const [logoutError, setLogoutError] =
    useState("");

  const mobileMenuRef = useRef(null);
  const userMenuRef = useRef(null);

  // ==========================================================================
  // Derived User State
  // ==========================================================================

  const isAuthenticated = Boolean(user);

  const userDisplayName = useMemo(
    () => getUserDisplayName(user),
    [user],
  );

  const userInitials = useMemo(
    () => getUserInitials(user),
    [user],
  );

  // ==========================================================================
  // Route / Navigation State
  // ==========================================================================

  const currentPath = location?.pathname || ROUTES.HOME;

  const hasActiveNavigation = useMemo(
    () =>
      NAVIGATION_ITEMS.some((item) =>
        isRouteActive(
          currentPath,
          item.to,
        ),
      ),
    [currentPath],
  );

  // ==========================================================================
  // Close Menus
  // ==========================================================================

  const closeMobileMenu = useCallback(() => {
    setMobileOpen(false);
  }, []);

  const closeUserMenu = useCallback(() => {
    setUserMenuOpen(false);
  }, []);

  const closeAllMenus = useCallback(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
  }, []);

  // ==========================================================================
  // Route Change → Close Menus
  // ==========================================================================

  useEffect(() => {
    closeAllMenus();
  }, [location.pathname, closeAllMenus]);

  // ==========================================================================
  // Escape Key Handling
  // ==========================================================================

  useEffect(() => {
    if (!mobileOpen && !userMenuOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }

      closeAllMenus();
    };

    document.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [
    mobileOpen,
    userMenuOpen,
    closeAllMenus,
  ]);

  // ==========================================================================
  // Click Outside User Menu
  // ==========================================================================

  useEffect(() => {
    if (!userMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      const menuElement =
        userMenuRef.current;

      if (
        menuElement &&
        !menuElement.contains(event.target)
      ) {
        closeUserMenu();
      }
    };

    document.addEventListener(
      "mousedown",
      handlePointerDown,
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handlePointerDown,
      );
    };
  }, [
    userMenuOpen,
    closeUserMenu,
  ]);

  // ==========================================================================
  // Mobile Menu Body Scroll Lock
  // ==========================================================================

  useEffect(() => {
    if (!mobileOpen) {
      return undefined;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, [mobileOpen]);

  // ==========================================================================
  // Logout
  // ==========================================================================

  const handleLogout = useCallback(
    async (event) => {
      event?.preventDefault?.();

      if (loggingOut) {
        return;
      }

      setLoggingOut(true);
      setLogoutError("");

      try {
        await logout();

        closeAllMenus();

        navigate(ROUTES.LOGIN, {
          replace: true,
          state: {
            from: currentPath,
            reason: "logout",
          },
        });
      } catch (error) {
        console.error(
          "[TITech Navbar] Logout failed:",
          error,
        );

        setLogoutError(
          "Unable to sign out completely. Please try again.",
        );
      } finally {
        setLoggingOut(false);
      }
    },
    [
      loggingOut,
      logout,
      closeAllMenus,
      navigate,
      currentPath,
    ],
  );

  // ==========================================================================
  // Mobile Navigation Handler
  // ==========================================================================

  const handleNavigationClick =
    useCallback(() => {
      closeMobileMenu();
      closeUserMenu();
    }, [
      closeMobileMenu,
      closeUserMenu,
    ]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <header
      className={[
        "titech-navbar",
        hasActiveNavigation
          ? "titech-navbar--has-active-route"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
      data-component="titech-navbar"
      data-authenticated={
        isAuthenticated
          ? "true"
          : "false"
      }
    >
      <nav
        className="titech-navbar__inner"
        aria-label="Primary navigation"
      >
        {/* ==================================================================
            Brand
            ================================================================== */}

        <Link
          to={ROUTES.HOME}
          className="titech-navbar__brand"
          aria-label="TITech Community Capital home"
          data-testid={`${testId}-brand`}
          onClick={handleNavigationClick}
        >
          <span className="titech-navbar__brand-mark">
            <img
              src={LOGO_SRC}
              alt=""
              className="titech-navbar__logo"
              width="40"
              height="40"
              loading="eager"
              decoding="async"
            />
          </span>

          <span className="titech-navbar__brand-copy">
            <span className="titech-navbar__brand-name">
              TITech
            </span>

            <span className="titech-navbar__brand-product">
              Community Capital
            </span>
          </span>
        </Link>

        {/* ==================================================================
            Desktop Navigation
            ================================================================== */}

        {showNavigation && (
          <div
            className="titech-navbar__navigation"
            data-testid={`${testId}-navigation`}
          >
            {NAVIGATION_ITEMS.map(
              ({
                id,
                label,
                to,
                icon: Icon,
              }) => (
                <NavLink
                  key={id}
                  to={to}
                  className={
                    getNavLinkClassName
                  }
                  aria-current={
                    isRouteActive(
                      currentPath,
                      to,
                    )
                      ? "page"
                      : undefined
                  }
                  data-testid={`${testId}-nav-${id}`}
                >
                  <Icon
                    size={17}
                    aria-hidden="true"
                    focusable="false"
                  />

                  <span>{label}</span>
                </NavLink>
              ),
            )}
          </div>
        )}

        {/* ==================================================================
            Desktop Actions
            ================================================================== */}

        <div className="titech-navbar__actions">
          {isAuthenticated ? (
            <>
              {showUserMenu ? (
                <div
                  className="titech-navbar__user-wrapper"
                  ref={userMenuRef}
                >
                  <button
                    type="button"
                    className={[
                      "titech-navbar__user-trigger",
                      userMenuOpen
                        ? "titech-navbar__user-trigger--open"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-haspopup="menu"
                    aria-expanded={
                      userMenuOpen
                    }
                    aria-label={`Open account menu for ${userDisplayName}`}
                    onClick={() =>
                      setUserMenuOpen(
                        (current) =>
                          !current,
                      )
                    }
                    data-testid={`${testId}-user-menu-button`}
                  >
                    <span
                      className="titech-navbar__avatar"
                      aria-hidden="true"
                    >
                      {userInitials}
                    </span>

                    <span className="titech-navbar__user-name">
                      {userDisplayName}
                    </span>

                    <ChevronDown
                      size={16}
                      aria-hidden="true"
                      focusable="false"
                      className={[
                        "titech-navbar__user-chevron",
                        userMenuOpen
                          ? "titech-navbar__user-chevron--open"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                  </button>

                  {userMenuOpen && (
                    <div
                      className="titech-navbar__user-menu"
                      role="menu"
                      aria-label="Account menu"
                      data-testid={`${testId}-user-menu`}
                    >
                      <div className="titech-navbar__user-menu-header">
                        <span
                          className="titech-navbar__avatar titech-navbar__avatar--large"
                          aria-hidden="true"
                        >
                          {userInitials}
                        </span>

                        <div className="titech-navbar__user-meta">
                          <strong>
                            {userDisplayName}
                          </strong>

                          {user?.email ? (
                            <span>
                              {normalizeString(
                                user.email,
                              )}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div
                        className="titech-navbar__menu-divider"
                        role="separator"
                      />

                      <Link
                        to={ROUTES.DASHBOARD}
                        className="titech-navbar__menu-item"
                        role="menuitem"
                        onClick={
                          handleNavigationClick
                        }
                      >
                        <LayoutDashboard
                          size={17}
                          aria-hidden="true"
                          focusable="false"
                        />

                        <span>
                          Dashboard
                        </span>
                      </Link>

                      <button
                        type="button"
                        className="titech-navbar__menu-item titech-navbar__menu-item--danger"
                        role="menuitem"
                        onClick={
                          handleLogout
                        }
                        disabled={loggingOut}
                        data-testid={`${testId}-logout-button`}
                      >
                        <LogOut
                          size={17}
                          aria-hidden="true"
                          focusable="false"
                        />

                        <span>
                          {loggingOut
                            ? "Signing out..."
                            : "Sign out"}
                        </span>
                      </button>

                      {logoutError ? (
                        <div
                          className="titech-navbar__logout-error"
                          role="alert"
                          aria-live="assertive"
                        >
                          <AlertCircle
                            size={15}
                            aria-hidden="true"
                            focusable="false"
                          />

                          <span>
                            {logoutError}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="titech-navbar__logout-button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  data-testid={`${testId}-logout-button`}
                >
                  <LogOut
                    size={17}
                    aria-hidden="true"
                    focusable="false"
                  />

                  <span>
                    {loggingOut
                      ? "Signing out..."
                      : "Logout"}
                  </span>
                </button>
              )}
            </>
          ) : (
            <div className="titech-navbar__auth-actions">
              <Link
                to={ROUTES.LOGIN}
                className="titech-navbar__login-link"
                data-testid={`${testId}-login-link`}
                onClick={
                  handleNavigationClick
                }
              >
                <LogIn
                  size={17}
                  aria-hidden="true"
                  focusable="false"
                />

                <span>Login</span>
              </Link>

              <Link
                to={ROUTES.REGISTER}
                className="titech-navbar__register-button"
                data-testid={`${testId}-register-link`}
                onClick={
                  handleNavigationClick
                }
              >
                Register
              </Link>
            </div>
          )}

          {/* ================================================================
              Mobile Menu Toggle
              ================================================================ */}

          <button
            type="button"
            className="titech-navbar__mobile-toggle"
            aria-label={
              mobileOpen
                ? "Close navigation menu"
                : "Open navigation menu"
            }
            aria-expanded={mobileOpen}
            aria-controls={`${testId}-mobile-menu`}
            onClick={() =>
              setMobileOpen(
                (current) =>
                  !current,
              )
            }
            data-testid={`${testId}-mobile-toggle`}
          >
            {mobileOpen ? (
              <X
                size={22}
                aria-hidden="true"
                focusable="false"
              />
            ) : (
              <Menu
                size={22}
                aria-hidden="true"
                focusable="false"
              />
            )}
          </button>
        </div>
      </nav>

      {/* ====================================================================
          Mobile Navigation
          ==================================================================== */}

      {mobileOpen && (
        <div
          id={`${testId}-mobile-menu`}
          ref={mobileMenuRef}
          className="titech-navbar__mobile-panel"
          data-testid={`${testId}-mobile-menu`}
        >
          {showNavigation && (
            <div className="titech-navbar__mobile-navigation">
              {NAVIGATION_ITEMS.map(
                ({
                  id,
                  label,
                  to,
                  icon: Icon,
                }) => (
                  <NavLink
                    key={id}
                    to={to}
                    className={
                      getNavLinkClassName
                    }
                    aria-current={
                      isRouteActive(
                        currentPath,
                        to,
                      )
                        ? "page"
                        : undefined
                    }
                    onClick={
                      handleNavigationClick
                    }
                    data-testid={`${testId}-mobile-nav-${id}`}
                  >
                    <Icon
                      size={18}
                      aria-hidden="true"
                      focusable="false"
                    />

                    <span>{label}</span>
                  </NavLink>
                ),
              )}
            </div>
          )}

          <div className="titech-navbar__mobile-divider" />

          {isAuthenticated ? (
            <div className="titech-navbar__mobile-account">
              <div className="titech-navbar__mobile-user">
                <span
                  className="titech-navbar__avatar titech-navbar__avatar--large"
                  aria-hidden="true"
                >
                  {userInitials}
                </span>

                <div className="titech-navbar__user-meta">
                  <strong>
                    {userDisplayName}
                  </strong>

                  {user?.email ? (
                    <span>
                      {normalizeString(
                        user.email,
                      )}
                    </span>
                  ) : null}
                </div>
              </div>

              <button
                type="button"
                className="titech-navbar__mobile-logout"
                onClick={handleLogout}
                disabled={loggingOut}
                data-testid={`${testId}-mobile-logout-button`}
              >
                <LogOut
                  size={18}
                  aria-hidden="true"
                  focusable="false"
                />

                <span>
                  {loggingOut
                    ? "Signing out..."
                    : "Sign out"}
                </span>
              </button>

              {logoutError ? (
                <div
                  className="titech-navbar__logout-error"
                  role="alert"
                  aria-live="assertive"
                >
                  <AlertCircle
                    size={15}
                    aria-hidden="true"
                    focusable="false"
                  />

                  <span>
                    {logoutError}
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="titech-navbar__mobile-auth">
              <Link
                to={ROUTES.LOGIN}
                className="titech-navbar__mobile-login"
                onClick={
                  handleNavigationClick
                }
              >
                <LogIn
                  size={18}
                  aria-hidden="true"
                  focusable="false"
                />

                <span>Login</span>
              </Link>

              <Link
                to={ROUTES.REGISTER}
                className="titech-navbar__mobile-register"
                onClick={
                  handleNavigationClick
                }
              >
                Register
              </Link>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

Navbar.propTypes = {
  testId: PropTypes.string,
  showNavigation: PropTypes.bool,
  showUserMenu: PropTypes.bool,
};

// ============================================================================
// Default Props
// ============================================================================

Navbar.defaultProps = {
  testId: DEFAULT_TEST_ID,
  showNavigation: true,
  showUserMenu: true,
};

// ============================================================================
// Metadata
// ============================================================================

Navbar.displayName = "TITechNavbar";

// ============================================================================
// Export
// ============================================================================

export default memo(Navbar);