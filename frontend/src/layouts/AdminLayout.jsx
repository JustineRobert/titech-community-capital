
// ============================================================================
// TITech Community Capital
// Enterprise Admin Layout
//
// File: frontend/src/layouts/AdminLayout.jsx
//
// Responsibilities:
// - Responsive administrative application layout
// - Role-aware navigation
// - Existing authentication context integration
// - Existing navigation registry integration
// - Notification socket lifecycle management
// - Canonical logout navigation
// - Accessible navigation and responsive controls
//
// Security:
// - Frontend navigation is NOT an authorization boundary.
// - Backend RBAC and tenant isolation remain authoritative.
// - No authentication bypass or duplicate logout implementation.
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Outlet,
  Link,
  useLocation,
  useNavigate,
} from "react-router-dom";

import {
  LayoutDashboard,
  Users,
  PiggyBank,
  CreditCard,
  Receipt,
  FileText,
  Banknote,
  Settings,
  CalendarDays,
  GraduationCap,
  ShieldCheck,
  Sprout,
  Network,
  LifeBuoy,
  UserPlus,
  Menu,
  X,
  LogOut,
  Bell,
  ChevronRight,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";

import BrandLogo from "../components/BrandLogo";

import {
  getNavigationItems,
} from "../navigation/navigationRegistry";

import "./AdminLayout.css";

// ============================================================================
// Constants
// ============================================================================

const SIDEBAR_BREAKPOINT = 1024;

const DEFAULT_USER_NAME = "User";

const DEFAULT_USER_ROLE = "Member";

// These identifiers control navigation presentation only.
// Confirm them against the canonical backend RBAC role definitions.
const ADMIN_ROLE_IDENTIFIERS = new Set([
  "admin",
  "super_admin",
  "platform_admin",
  "tenant_admin",
  "institution_admin",
  "organization_admin",
]);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize role values from the existing authentication context.
 *
 * Supports string roles and common role-object representations.
 * Does not grant permissions based on arbitrary substrings.
 */
function normalizeRole(role) {
  if (typeof role === "string") {
    return role
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  }

  if (role && typeof role === "object") {
    return normalizeRole(
      role.name ??
      role.code ??
      role.key ??
      role.role
    );
  }

  return "";
}

/**
 * Extract roles without duplicating authentication state.
 */
function getUserRoles(user) {
  const roles = [
    user?.role,
    ...(Array.isArray(user?.roles) ? user.roles : []),
  ];

  return [
    ...new Set(
      roles
        .map(normalizeRole)
        .filter(Boolean)
    ),
  ];
}

/**
 * Determine administrator navigation visibility.
 *
 * This does not replace backend authorization.
 */
function isAdministrator(userRoles) {
  return userRoles.some((role) =>
    ADMIN_ROLE_IDENTIFIERS.has(role)
  );
}

/**
 * Determine whether a pathname represents an active navigation item.
 *
 * Avoids accidental matches such as:
 * /memberships matching /members
 */
function isNavigationActive(pathname, targetPath) {
  if (!pathname || !targetPath) {
    return false;
  }

  if (targetPath === "/") {
    return pathname === "/";
  }

  return (
    pathname === targetPath ||
    pathname.startsWith(`${targetPath}/`)
  );
}

/**
 * Normalize navigation items from the existing registry.
 */
function normalizeNavigationItems(items, iconMap) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter(
      (item) =>
        item &&
        typeof item.label === "string" &&
        typeof item.to === "string" &&
        item.to.startsWith("/")
    )
    .map((item) => ({
      label: item.label,
      icon: iconMap[item.icon] || ShieldCheck,
      path: item.to,
    }));
}

// ============================================================================
// Component
// ============================================================================

export default function AdminLayout() {
  // --------------------------------------------------------------------------
  // Router
  // --------------------------------------------------------------------------

  const navigate = useNavigate();

  const location = useLocation();

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  const auth = useAuth();

  const user = auth?.user ?? null;

  const userRoles = useMemo(
    () => getUserRoles(user),
    [user]
  );

  const isAdmin = useMemo(
    () => isAdministrator(userRoles),
    [userRoles]
  );

  // --------------------------------------------------------------------------
  // Responsive sidebar state
  // --------------------------------------------------------------------------

  const [sidebarOpen, setSidebarOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      window.innerWidth >= SIDEBAR_BREAKPOINT
  );

  // --------------------------------------------------------------------------
  // Notification state
  // --------------------------------------------------------------------------

  const [
    notifications,
    setNotifications,
  ] = useState(0);

  // ==========================================================================
  // Navigation
  // ==========================================================================

  const navigation = useMemo(() => {
    const iconMap = {
      LayoutDashboard,
      Users,
      UserPlus,
      CalendarDays,
      ShieldCheck,
      GraduationCap,
      Sprout,
      Network,
      LifeBuoy,
    };

    // Use the existing TITech navigation registry.
    // Do not create a second permission system here.
    const registryItems = normalizeNavigationItems(
      getNavigationItems(true, userRoles),
      iconMap
    );

    const standardItems = [
      {
        label: "Members",
        icon: Users,
        path: "/members",
      },
      {
        label: "Savings",
        icon: PiggyBank,
        path: "/savings",
      },
      {
        label: "Loans",
        icon: CreditCard,
        path: "/loans",
      },
      {
        label: "Transactions",
        icon: Receipt,
        path: "/transactions",
      },
      {
        label: "Reports",
        icon: FileText,
        path: "/reports",
      },
      {
        label: "Payroll",
        icon: Banknote,
        path: "/payroll",
      },
    ];

    const adminItems = isAdmin
      ? [
          {
            label: "Settings",
            icon: Settings,
            path: "/settings",
          },
        ]
      : [];

    // Preserve the existing navigation-registry permission decision.
    const canGovernAccess = registryItems.some(
      (item) => item.path === "/create-group"
    );

    const governanceItems = canGovernAccess
      ? [
          {
            label: "Access Governance",
            icon: Users,
            path: "/admin/access",
          },
        ]
      : [];

    const allItems = [
      ...registryItems,
      ...standardItems,
      ...adminItems,
      ...governanceItems,
    ];

    // Prevent duplicate sidebar entries.
    const uniqueItems = new Map();

    allItems.forEach((item) => {
      if (!uniqueItems.has(item.path)) {
        uniqueItems.set(item.path, item);
      }
    });

    return Array.from(uniqueItems.values());
  }, [userRoles, isAdmin]);

  // ==========================================================================
  // Responsive behavior
  // ==========================================================================

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleResize = () => {
      setSidebarOpen(
        window.innerWidth >= SIDEBAR_BREAKPOINT
      );
    };

    window.addEventListener(
      "resize",
      handleResize
    );

    return () => {
      window.removeEventListener(
        "resize",
        handleResize
      );
    };
  }, []);

  // ==========================================================================
  // Mobile navigation behavior
  // ==========================================================================

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.innerWidth < SIDEBAR_BREAKPOINT
    ) {
      setSidebarOpen(false);
    }
  }, [location.pathname]);

  // ==========================================================================
  // Notifications
  // ==========================================================================

  useEffect(() => {
    let mounted = true;

    let activeSocket = null;

    const handleNotification = () => {
      if (!mounted) {
        return;
      }

      setNotifications((previous) => previous + 1);
    };

    const subscribe = async () => {
      try {
        const socketModule = await import(
          "../services/socket"
        );

        if (!mounted) {
          return;
        }

        const socket = socketModule.default;

        if (
          !socket ||
          typeof socket.on !== "function" ||
          typeof socket.off !== "function"
        ) {
          return;
        }

        activeSocket = socket;

        activeSocket.on(
          "notification",
          handleNotification
        );
      } catch (error) {
        // Notifications are supplementary.
        // A socket failure must not crash the admin layout.
        if (import.meta.env?.DEV) {
          console.warn(
            "[AdminLayout] Notification subscription unavailable:",
            error
          );
        }
      }
    };

    subscribe();

    return () => {
      mounted = false;

      if (activeSocket) {
        activeSocket.off(
          "notification",
          handleNotification
        );

        activeSocket = null;
      }
    };
  }, []);

  // ==========================================================================
  // Logout
  // ==========================================================================

  const handleLogout = useCallback(() => {
    // Preserve the canonical logout lifecycle.
    // The Logout page owns server-side revocation and retry handling.
    navigate("/logout");
  }, [navigate]);

  // ==========================================================================
  // Breadcrumbs
  // ==========================================================================

  const breadcrumbs = useMemo(() => {
    const segments = location.pathname
      .split("/")
      .filter(Boolean);

    return segments.map((segment, index) => {
      const label = decodeURIComponent(segment)
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (character) =>
          character.toUpperCase()
        );

      return {
        label,
        path:
          "/" +
          segments
            .slice(0, index + 1)
            .join("/"),
      };
    });
  }, [location.pathname]);

  // ==========================================================================
  // User presentation
  // ==========================================================================

  const userName =
    user?.name ||
    user?.fullName ||
    DEFAULT_USER_NAME;

  const userRole =
    user?.role ||
    (userRoles.length > 0
      ? userRoles[0]
          .replace(/_/g, " ")
          .replace(/\b\w/g, (character) =>
            character.toUpperCase()
          )
      : DEFAULT_USER_ROLE);

  const userInitial = String(userName)
    .trim()
    .charAt(0)
    .toUpperCase() || "U";

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="admin-layout">

      {/* ================================================================== */}
      {/* Sidebar                                                            */}
      {/* ================================================================== */}

      <aside
        className={`admin-sidebar ${
          sidebarOpen ? "open" : "closed"
        }`}
        aria-label="Administrative sidebar"
        aria-hidden={
          typeof window !== "undefined" &&
          window.innerWidth < SIDEBAR_BREAKPOINT &&
          !sidebarOpen
        }
      >

        {/* Sidebar Header */}

        <div className="sidebar-header">

          <div className="sidebar-brand">

            <BrandLogo
              variant="transparent"
              size="sm"
              alt="TITech Community Capital"
            />

            <div>
              <h2>TITech</h2>

              <span>
                Community Capital
              </span>
            </div>

          </div>

          <button
            type="button"
            className="sidebar-close-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X aria-hidden="true" />
          </button>

        </div>

        {/* Navigation */}

        <nav
          className="sidebar-nav"
          aria-label="Main navigation"
        >

          {navigation.map((item) => {
            const Icon = item.icon;

            const active = isNavigationActive(
              location.pathname,
              item.path
            );

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`sidebar-link ${
                  active ? "active" : ""
                }`}
                aria-current={
                  active ? "page" : undefined
                }
              >

                <Icon
                  size={18}
                  aria-hidden="true"
                />

                <span>
                  {item.label}
                </span>

              </Link>
            );
          })}

        </nav>

        {/* Sidebar Footer */}

        <div className="sidebar-footer">

          <button
            type="button"
            onClick={handleLogout}
            aria-label="Log out"
          >

            <LogOut
              size={18}
              aria-hidden="true"
            />

            Logout

          </button>

        </div>

      </aside>

      {/* ================================================================== */}
      {/* Main Application Area                                               */}
      {/* ================================================================== */}

      <div className="admin-main">

        {/* Header */}

        <header className="admin-header">

          <div className="header-left">

            <button
              type="button"
              className="menu-btn"
              onClick={() =>
                setSidebarOpen((previous) => !previous)
              }
              aria-label={
                sidebarOpen
                  ? "Close navigation menu"
                  : "Open navigation menu"
              }
              aria-expanded={sidebarOpen}
              aria-controls="admin-sidebar"
            >
              <Menu aria-hidden="true" />
            </button>

            {/* Breadcrumbs */}

            <nav
              className="breadcrumbs"
              aria-label="Breadcrumb"
            >

              <Link to="/">
                Home
              </Link>

              {breadcrumbs.map((item, index) => (

                <React.Fragment key={item.path}>

                  <ChevronRight
                    size={14}
                    aria-hidden="true"
                  />

                  {index === breadcrumbs.length - 1 ? (
                    <span aria-current="page">
                      {item.label}
                    </span>
                  ) : (
                    <Link to={item.path}>
                      {item.label}
                    </Link>
                  )}

                </React.Fragment>

              ))}

            </nav>

          </div>

          {/* Header Right */}

          <div className="header-right">

            {/* Notifications */}

            <button
              type="button"
              className="notification-btn"
              aria-label={`Notifications: ${notifications} unread`}
            >

              <Bell
                size={20}
                aria-hidden="true"
              />

              {notifications > 0 && (

                <span className="notification-count">
                  {notifications > 99
                    ? "99+"
                    : notifications}
                </span>

              )}

            </button>

            {/* User Profile */}

            <div className="user-profile">

              <div
                className="user-avatar"
                aria-hidden="true"
              >
                {userInitial}
              </div>

              <div className="user-meta">

                <strong>
                  {userName}
                </strong>

                <span>
                  {userRole}
                </span>

              </div>

            </div>

          </div>

        </header>

        {/* ================================================================= */}
        {/* Page Content                                                      */}
        {/* ================================================================= */}

        <main
          className="admin-content"
          id="admin-main-content"
        >

          <Outlet />

        </main>

      </div>

    </div>
  );
}
