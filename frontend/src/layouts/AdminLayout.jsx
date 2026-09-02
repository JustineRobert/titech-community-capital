// frontend/src/layouts/AdminLayout.jsx
// ============================================================================
// TITech Community Capital
// Enterprise Admin Layout
// File: src/layouts/AdminLayout.jsx
// Production Grade
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
  Settings,
  Menu,
  X,
  LogOut,
  Bell,
  ChevronRight,
  Building2,
} from "lucide-react";

import { toast } from "react-toastify";

import { useAuth } from "../context/AuthContext";

import "./AdminLayout.css";

// ============================================================================
// Constants
// ============================================================================

const SIDEBAR_BREAKPOINT =
  1024;

// ============================================================================
// Component
// ============================================================================

export default function AdminLayout() {
  const navigate =
    useNavigate();

  const location =
    useLocation();

  const {
    user,
    logout,
  } = useAuth();

  const [sidebarOpen, setSidebarOpen] =
    useState(
      window.innerWidth >=
        SIDEBAR_BREAKPOINT
    );

  const [
    notifications,
    setNotifications,
  ] = useState(0);

  // ===========================================================================
  // Navigation
  // ===========================================================================

  const navigation =
    useMemo(() => {
      const items = [
        {
          label:
            "Dashboard",
          icon:
            LayoutDashboard,
          path:
            "/dashboard",
        },
        {
          label:
            "Members",
          icon: Users,
          path:
            "/members",
        },
        {
          label:
            "Savings",
          icon:
            PiggyBank,
          path:
            "/savings",
        },
        {
          label:
            "Loans",
          icon:
            CreditCard,
          path:
            "/loans",
        },
        {
          label:
            "Transactions",
          icon:
            Receipt,
          path:
            "/transactions",
        },
        {
          label:
            "Reports",
          icon:
            FileText,
          path:
            "/reports",
        },
      ];

      const adminItems = [
        {
          label:
            "Settings",
          icon:
            Settings,
          path:
            "/settings",
        },
      ];

      const isAdmin =
        [
          "admin",
          "ADMIN",
          "super_admin",
        ].includes(
          user?.role
        );

      return isAdmin
        ? [
            ...items,
            ...adminItems,
          ]
        : items;
    }, [user]);

  // ===========================================================================
  // Responsive
  // ===========================================================================

  useEffect(() => {
    const handler =
      () => {
        setSidebarOpen(
          window.innerWidth >=
            SIDEBAR_BREAKPOINT
        );
      };

    window.addEventListener(
      "resize",
      handler
    );

    return () => {
      window.removeEventListener(
        "resize",
        handler
      );
    };
  }, []);

  // ===========================================================================
  // Notifications (placeholder hook)
  // ===========================================================================

  useEffect(() => {
    let cleanup;

    import(
      "../services/socket"
    )
      .then(
        ({
          default:
            socket,
        }) => {
          const handler =
            () =>
              setNotifications(
                (
                  previous
                ) =>
                  previous +
                  1
              );

          socket.on(
            "notification",
            handler
          );

          cleanup =
            () =>
              socket.off(
                "notification",
                handler
              );
        }
      )
      .catch(() => {});

    return () => {
      cleanup?.();
    };
  }, []);

  // ===========================================================================
  // Logout
  // ===========================================================================

  const handleLogout =
    useCallback(
      async () => {
        try {
          await logout();

          toast.success(
            "Logged out successfully."
          );

          navigate(
            "/login",
            {
              replace:
                true,
            }
          );
        } catch {
          toast.error(
            "Logout failed."
          );
        }
      },
      [
        logout,
        navigate,
      ]
    );

  // ===========================================================================
  // Breadcrumbs
  // ===========================================================================

  const breadcrumbs =
    useMemo(() => {
      const segments =
        location.pathname
          .split("/")
          .filter(
            Boolean
          );

      return segments.map(
        (
          segment,
          index
        ) => ({
          label:
            segment
              .charAt(
                0
              )
              .toUpperCase() +
            segment.slice(
              1
            ),
          path:
            "/" +
            segments
              .slice(
                0,
                index +
                  1
              )
              .join("/"),
        })
      );
    }, [location]);

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <div className="admin-layout">
      {/* Sidebar */}
      <aside
        className={`admin-sidebar ${
          sidebarOpen
            ? "open"
            : "closed"
        }`}
      >
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <Building2
              size={28}
            />

            <div>
              <h2>
                TITech
              </h2>

              <span>
                Community
                Capital
              </span>
            </div>
          </div>

          <button
            className="sidebar-close-btn"
            onClick={() =>
              setSidebarOpen(
                false
              )
            }
          >
            <X />
          </button>
        </div>

        <nav className="sidebar-nav">
          {navigation.map(
            (
              item
            ) => {
              const Icon =
                item.icon;

              const active =
                location.pathname.startsWith(
                  item.path
                );

              return (
                <Link
                  key={
                    item.path
                  }
                  to={
                    item.path
                  }
                  className={`sidebar-link ${
                    active
                      ? "active"
                      : ""
                  }`}
                >
                  <Icon
                    size={18}
                  />

                  <span>
                    {
                      item.label
                    }
                  </span>
                </Link>
              );
            }
          )}
        </nav>

        <div className="sidebar-footer">
          <button
            onClick={
              handleLogout
            }
          >
            <LogOut
              size={18}
            />

            Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="admin-main">
        {/* Header */}
        <header className="admin-header">
          <div className="header-left">
            <button
              className="menu-btn"
              onClick={() =>
                setSidebarOpen(
                  (
                    previous
                  ) =>
                    !previous
                )
              }
            >
              <Menu />
            </button>

            <div className="breadcrumbs">
              {breadcrumbs.map(
                (
                  item,
                  index
                ) => (
                  <React.Fragment
                    key={
                      item.path
                    }
                  >
                    {index >
                      0 && (
                      <ChevronRight
                        size={
                          14
                        }
                      />
                    )}

                    <Link
                      to={
                        item.path
                      }
                    >
                      {
                        item.label
                      }
                    </Link>
                  </React.Fragment>
                )
              )}
            </div>
          </div>

          <div className="header-right">
            <button className="notification-btn">
              <Bell
                size={20}
              />

              {notifications >
                0 && (
                <span className="notification-count">
                  {
                    notifications
                  }
                </span>
              )}
            </button>

            <div className="user-profile">
              <div className="user-avatar">
                {user?.name
                  ?.charAt(
                    0
                  )
                  ?.toUpperCase() ||
                  "U"}
              </div>

              <div className="user-meta">
                <strong>
                  {user?.name ||
                    "User"}
                </strong>

                <span>
                  {user?.role ||
                    "Member"}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}