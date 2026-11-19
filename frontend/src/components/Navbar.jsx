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

import PropTypes from "prop-types";

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
  LayoutDashboard,
  CalendarDays,
  Users,
  ShieldCheck,
  ChevronDown,
  AlertCircle,
  GraduationCap,
  Sprout,
  Network,
  LifeBuoy,
  UserPlus,
  HeartHandshake,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import BrandLogo from "./BrandLogo";
import LanguageSelector from "../i18n/LanguageSelector";
import { useI18n } from "../i18n/I18nProvider";
import { getNavigationItems, PUBLIC_PRODUCT_DISCOVERY } from "../navigation/navigationRegistry";

import { computeDiscoveryMenuPlacement } from "./navigationMenuPlacement";
import "./Navbar.css";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TEST_ID = "titech-navbar";

const NAVIGATION_ICONS = Object.freeze({
  LayoutDashboard,
  Users,
  UserPlus,
  HeartHandshake,
  CalendarDays,
  ShieldCheck,
  GraduationCap,
  Sprout,
  Network,
  LifeBuoy,
});

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
  const { t } = useI18n();

  const [mobileOpen, setMobileOpen] =
    useState(false);

  const [userMenuOpen, setUserMenuOpen] =
    useState(false);

  const [openDiscoveryMenu, setOpenDiscoveryMenu] =
    useState(null);

  const [discoveryMenuPlacement, setDiscoveryMenuPlacement] =
    useState(null);

  const [mobileProductsOpen, setMobileProductsOpen] =
    useState(false);

  const [mobileServicesOpen, setMobileServicesOpen] =
    useState(false);

  const [loggingOut, setLoggingOut] =
    useState(false);

  const [logoutError, setLogoutError] =
    useState("");

  const navbarRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const mobileToggleRef = useRef(null);
  const userMenuRef = useRef(null);
  const discoveryTriggerRefs = useRef({});

  // ==========================================================================
  // Derived User State
  // ==========================================================================

  const isAuthenticated = Boolean(user);
  const navigationItems = useMemo(
    () => getNavigationItems(isAuthenticated, [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])]),
    [isAuthenticated, user?.role, user?.roles],
  );

  // Products and Services are views over the existing canonical registry.
  // No duplicate catalogue or synthetic destination is introduced here.
  const productItems = useMemo(
    () => PUBLIC_PRODUCT_DISCOVERY.filter((item) => item.discoveryType === "product"),
    [],
  );
  const serviceItems = useMemo(
    () => PUBLIC_PRODUCT_DISCOVERY.filter((item) => item.discoveryType === "service"),
    [],
  );
  const primaryItems = useMemo(
    () => navigationItems.filter((item) => ["dashboard", "meetings"].includes(item.id)),
    [navigationItems],
  );
  const moreItems = useMemo(
    () => navigationItems.filter((item) => !item.discovery && !["dashboard", "meetings"].includes(item.id)),
    [navigationItems],
  );

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
      navigationItems.some((item) =>
        isRouteActive(
          currentPath,
          item.to,
        ),
      ),
    [currentPath, navigationItems],
  );

  // ==========================================================================
  // Close Menus
  // ==========================================================================

  const closeAllMenus = useCallback(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
    setOpenDiscoveryMenu(null);
    setDiscoveryMenuPlacement(null);
    setMobileProductsOpen(false);
    setMobileServicesOpen(false);
  }, []);

  const toggleDiscoveryMenu = useCallback((menu) => {
    setUserMenuOpen(false);
    setOpenDiscoveryMenu((current) => current === menu ? null : menu);
  }, []);

  const toggleMobileDiscovery = useCallback((menu) => {
    if (menu === "products") {
      setMobileProductsOpen((current) => !current);
      setMobileServicesOpen(false);
    } else {
      setMobileServicesOpen((current) => !current);
      setMobileProductsOpen(false);
    }
  }, []);

  const renderDiscoveryLink = (item, context = "desktop") => {
    const Icon = NAVIGATION_ICONS[item.icon] || ShieldCheck;
    const requiresLogin = item.requiresAuthentication && !isAuthenticated;
    const destination = requiresLogin ? ROUTES.LOGIN : item.to;
    const className = context === "mobile"
      ? "titech-navbar__mobile-discovery-link"
      : "titech-navbar__discovery-link";
    const translationKey = `common.nav.${item.id}`;
    const translatedLabel = t(translationKey);
    return (
      <Link
        key={`${context}-${item.id}`}
        to={destination}
        state={requiresLogin ? { from: { pathname: item.to } } : undefined}
        className={className}
        aria-current={isRouteActive(currentPath, item.to) && !requiresLogin ? "page" : undefined}
        onClick={handleNavigationClick}
        data-testid={`${testId}-${context}-discovery-${item.id}`}
      >
        <span className="titech-navbar__discovery-icon" aria-hidden="true">
          <Icon size={18} focusable="false" />
        </span>
        <span className="titech-navbar__discovery-copy">
          <strong>{translatedLabel === translationKey ? item.label : translatedLabel}</strong>
          <span>{item.description}</span>
          <small>{item.accessLabel}</small>
        </span>
      </Link>
    );
  };

  // ==========================================================================
  // Route Change → Close Menus
  // ==========================================================================

  useEffect(() => {
    closeAllMenus();
  }, [location.pathname, closeAllMenus]);

  // ==========================================================================
  // Viewport-aware Products / Services menu positioning.
  // The panel is measured after render and re-positioned on scroll/resize so it
  // cannot spill beyond a device viewport or be clipped by the header layout.
  // ==========================================================================

  useEffect(() => {
    if (!openDiscoveryMenu) {
      setDiscoveryMenuPlacement(null);
      return undefined;
    }

    const trigger = discoveryTriggerRefs.current[openDiscoveryMenu];
    const panel = document.getElementById(`${testId}-${openDiscoveryMenu}-menu`);
    if (!trigger || !panel) return undefined;

    const updatePlacement = () => {
      // The desktop disclosure is replaced by the mobile accordion at this
      // breakpoint. Close it instead of leaving a detached fixed panel open.
      if (window.innerWidth <= 1120) {
        setOpenDiscoveryMenu(null);
        setDiscoveryMenuPlacement(null);
        return;
      }

      const triggerRect = trigger.getBoundingClientRect();
      const placement = computeDiscoveryMenuPlacement({
        triggerRect,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        contentHeight: panel.scrollHeight,
        maxWidth: openDiscoveryMenu === "more" ? 304 : 688,
      });
      setDiscoveryMenuPlacement(placement);
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [openDiscoveryMenu, testId]);

  // ==========================================================================
  // Escape Key Handling
  // ==========================================================================

  useEffect(() => {
    if (!mobileOpen && !userMenuOpen && !openDiscoveryMenu) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      const trigger = openDiscoveryMenu
        ? discoveryTriggerRefs.current[openDiscoveryMenu]
        : userMenuOpen
          ? userMenuRef.current?.querySelector("button")
          : mobileOpen
            ? mobileToggleRef.current
            : null;
      closeAllMenus();
      trigger?.focus?.();
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
    openDiscoveryMenu,
    closeAllMenus,
  ]);

  // ==========================================================================
  // Click/tap outside the header dismisses all open navigation surfaces.
  // ==========================================================================

  useEffect(() => {
    if (!mobileOpen && !userMenuOpen && !openDiscoveryMenu) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (navbarRef.current && !navbarRef.current.contains(event.target)) {
        closeAllMenus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [mobileOpen, userMenuOpen, openDiscoveryMenu, closeAllMenus]);

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
          t("common.errors.logoutFailed"),
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
      t,
    ],
  );

  // ==========================================================================
  // Mobile Navigation Handler
  // ==========================================================================

  const handleNavigationClick = useCallback(() => {
    closeAllMenus();
  }, [closeAllMenus]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <header
      ref={navbarRef}
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
        aria-label={t("common.nav.primary")}
      >
        {/* ==================================================================
            Brand
            ================================================================== */}

        <Link
          to={ROUTES.HOME}
          className="titech-navbar__brand"
          aria-label={t("common.brand.home")}
          data-testid={`${testId}-brand`}
          onClick={handleNavigationClick}
        >
          <span className="titech-navbar__brand-mark">
            <BrandLogo
              variant="transparent"
              size="sm"
              alt="TITech Community Capital"
              loading="eager"
              fetchPriority="high"
              className="titech-navbar__logo"
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
            {primaryItems.map(({ id, label, to, icon }) => {
              const Icon = NAVIGATION_ICONS[icon] || ShieldCheck;
              const translationKey = `common.nav.${id}`;
              const translatedLabel = t(translationKey);
              return (
                <NavLink
                  key={id}
                  to={to}
                  className={getNavLinkClassName}
                  aria-current={isRouteActive(currentPath, to) ? "page" : undefined}
                  data-testid={`${testId}-nav-${id}`}
                >
                  <Icon size={17} aria-hidden="true" focusable="false" />
                  <span>{translatedLabel === translationKey ? label : translatedLabel}</span>
                </NavLink>
              );
            })}

            {[
              { id: "products", label: "Products", items: productItems, description: "Explore TITech products" },
              { id: "services", label: "Services", items: serviceItems, description: "Explore TITech services" },
            ].map((menu) => {
              const isOpen = openDiscoveryMenu === menu.id;
              const isActive = menu.items.some((item) => isRouteActive(currentPath, item.to));
              const MenuIcon = menu.id === "products" ? GraduationCap : HeartHandshake;
              return (
                <div className="titech-navbar__menu-group" key={menu.id}>
                  <button
                    ref={(element) => { discoveryTriggerRefs.current[menu.id] = element; }}
                    type="button"
                    className={[
                      "titech-navbar__nav-link",
                      "titech-navbar__menu-trigger",
                      isActive ? "titech-navbar__nav-link--active" : "",
                      isOpen ? "titech-navbar__menu-trigger--open" : "",
                    ].filter(Boolean).join(" ")}
                    aria-expanded={isOpen}
                    aria-controls={`${testId}-${menu.id}-menu`}
                    onClick={() => toggleDiscoveryMenu(menu.id)}
                    data-testid={`${testId}-${menu.id}-trigger`}
                  >
                    <MenuIcon size={17} aria-hidden="true" focusable="false" />
                    <span>{menu.label}</span>
                    <ChevronDown size={15} aria-hidden="true" focusable="false" />
                  </button>
                  {isOpen && (
                    <div
                      id={`${testId}-${menu.id}-menu`}
                      className="titech-navbar__discovery-panel"
                      role="region"
                      aria-labelledby={`${testId}-${menu.id}-heading`}
                      style={discoveryMenuPlacement ? {
                        left: `${discoveryMenuPlacement.left}px`,
                        top: `${discoveryMenuPlacement.top}px`,
                        width: `${discoveryMenuPlacement.width}px`,
                        maxHeight: `${discoveryMenuPlacement.maxHeight}px`,
                        visibility: "visible",
                      } : { visibility: "hidden" }}
                      data-testid={`${testId}-${menu.id}-menu`}
                    >
                      <div className="titech-navbar__discovery-heading">
                        <strong id={`${testId}-${menu.id}-heading`}>{menu.label}</strong>
                        <span>{menu.description}</span>
                      </div>
                      <div className="titech-navbar__discovery-grid">
                        {menu.items.map((item) => renderDiscoveryLink(item))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {moreItems.length > 0 && (
              <div className="titech-navbar__menu-group" key="more">
                <button
                  ref={(element) => { discoveryTriggerRefs.current.more = element; }}
                  type="button"
                  className={[
                    "titech-navbar__nav-link",
                    "titech-navbar__menu-trigger",
                    moreItems.some((item) => isRouteActive(currentPath, item.to)) ? "titech-navbar__nav-link--active" : "",
                    openDiscoveryMenu === "more" ? "titech-navbar__menu-trigger--open" : "",
                  ].filter(Boolean).join(" ")}
                  aria-expanded={openDiscoveryMenu === "more"}
                  aria-controls={`${testId}-more-menu`}
                  onClick={() => toggleDiscoveryMenu("more")}
                  data-testid={`${testId}-more-trigger`}
                >
                  <span>More</span>
                  <ChevronDown size={15} aria-hidden="true" focusable="false" />
                </button>
                {openDiscoveryMenu === "more" && (
                  <div
                    id={`${testId}-more-menu`}
                    className="titech-navbar__more-panel"
                    role="region"
                    aria-label="More workspace links"
                    style={discoveryMenuPlacement ? {
                      left: `${discoveryMenuPlacement.left}px`,
                      top: `${discoveryMenuPlacement.top}px`,
                      width: `${discoveryMenuPlacement.width}px`,
                      maxHeight: `${discoveryMenuPlacement.maxHeight}px`,
                    } : { visibility: "hidden" }}
                  >
                    {moreItems.map(({ id, label, to, icon }) => {
                      const Icon = NAVIGATION_ICONS[icon] || ShieldCheck;
                      const translationKey = `common.nav.${id}`;
                      const translatedLabel = t(translationKey);
                      return (
                        <NavLink
                          key={id}
                          to={to}
                          className="titech-navbar__menu-item"
                          aria-current={isRouteActive(currentPath, to) ? "page" : undefined}
                          onClick={handleNavigationClick}
                          data-testid={`${testId}-nav-${id}`}
                        >
                          <Icon size={17} aria-hidden="true" focusable="false" />
                          <span>{translatedLabel === translationKey ? label : translatedLabel}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ==================================================================
            Desktop Actions
            ================================================================== */}

        <div className="titech-navbar__actions">
          {!isAuthenticated ? (
            <div className="titech-navbar__public-ctas" aria-label="Institutional enquiries">
              <Link className="titech-navbar__public-link" to="/contact-us">Contact Us</Link>
              <Link className="titech-navbar__public-button" to="/book-a-demo">Book a Demo</Link>
            </div>
          ) : null}
          <LanguageSelector className="titech-language-selector--desktop" />
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
                    aria-label={t("common.nav.openAccountMenu", { name: userDisplayName })}
                    onClick={() => {
                      setOpenDiscoveryMenu(null);
                      setUserMenuOpen((current) => !current);
                    }}
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
                          {t("common.nav.dashboard")}
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
                            ? t("common.nav.signingOut")
                            : t("common.nav.signOut")}
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
                      ? t("common.nav.signingOut")
                      : t("common.nav.logout")}
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

                <span>{t("common.nav.login")}</span>
              </Link>

              <Link
                to={ROUTES.REGISTER}
                className="titech-navbar__register-button"
                data-testid={`${testId}-register-link`}
                onClick={
                  handleNavigationClick
                }
              >
                {t("common.nav.register")}
              </Link>
            </div>
          )}

          {/* ================================================================
              Mobile Menu Toggle
              ================================================================ */}

          <button
            ref={mobileToggleRef}
            type="button"
            className="titech-navbar__mobile-toggle"
            aria-label={
              mobileOpen
                ? t("common.nav.closeMenu")
                : t("common.nav.openMenu")
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
              <section className="titech-navbar__mobile-discovery" aria-label="Product and service discovery">
                <button
                  type="button"
                  className="titech-navbar__mobile-section-trigger"
                  aria-expanded={mobileProductsOpen}
                  aria-controls={`${testId}-mobile-products`}
                  onClick={() => toggleMobileDiscovery("products")}
                >
                  <span><GraduationCap size={18} aria-hidden="true" /> Products</span>
                  <ChevronDown size={17} aria-hidden="true" />
                </button>
                {mobileProductsOpen && (
                  <div id={`${testId}-mobile-products`} className="titech-navbar__mobile-discovery-list">
                    {productItems.map((item) => renderDiscoveryLink(item, "mobile"))}
                  </div>
                )}
                <button
                  type="button"
                  className="titech-navbar__mobile-section-trigger"
                  aria-expanded={mobileServicesOpen}
                  aria-controls={`${testId}-mobile-services`}
                  onClick={() => toggleMobileDiscovery("services")}
                >
                  <span><HeartHandshake size={18} aria-hidden="true" /> Services</span>
                  <ChevronDown size={17} aria-hidden="true" />
                </button>
                {mobileServicesOpen && (
                  <div id={`${testId}-mobile-services`} className="titech-navbar__mobile-discovery-list">
                    {serviceItems.map((item) => renderDiscoveryLink(item, "mobile"))}
                  </div>
                )}
              </section>

              {navigationItems.filter((item) => !item.discovery).map(({ id, label, to, icon }) => {
                const Icon = NAVIGATION_ICONS[icon] || ShieldCheck;
                const translationKey = `common.nav.${id}`;
                const translatedLabel = t(translationKey);
                return (
                  <NavLink
                    key={id}
                    to={to}
                    className={getNavLinkClassName}
                    aria-current={isRouteActive(currentPath, to) ? "page" : undefined}
                    onClick={handleNavigationClick}
                    data-testid={`${testId}-mobile-nav-${id}`}
                  >
                    <Icon size={18} aria-hidden="true" focusable="false" />
                    <span>{translatedLabel === translationKey ? label : translatedLabel}</span>
                  </NavLink>
                );
              })}
            </div>
          )}

          <div className="titech-navbar__mobile-divider" />
          {!isAuthenticated ? (
            <div className="titech-navbar__mobile-public-ctas" aria-label="Institutional enquiries">
              <Link to="/book-a-demo" onClick={handleNavigationClick}>Book a Demo</Link>
              <Link to="/contact-us" onClick={handleNavigationClick}>Contact Us</Link>
              <Link to="/chat-with-titech" onClick={handleNavigationClick}>Chat with TITech</Link>
            </div>
          ) : null}
          <LanguageSelector className="titech-language-selector--mobile" />

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

                <span>{t("common.nav.login")}</span>
              </Link>

              <Link
                to={ROUTES.REGISTER}
                className="titech-navbar__mobile-register"
                onClick={
                  handleNavigationClick
                }
              >
                {t("common.nav.register")}
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