// ============================================================================
// TITech Community Capital
// Enterprise UserMenu Component
// File: src/components/ui/UserMenu.jsx
// Production Grade
// ============================================================================

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
  User,
  Settings,
  LogOut,
  ChevronDown,
  Shield,
  Building2,
  Bell,
  CreditCard,
} from "lucide-react";

// ============================================================================
// Component
// ============================================================================

function UserMenu({
  user = {},
  tenant,
  notifications = 0,
  showTenant = true,
  showRole = true,
  showNotifications = true,
  avatar,
  menuItems = [],
  onProfile,
  onSettings,
  onBilling,
  onNotifications,
  onLogout,
  className = "",
}) {
  const [open, setOpen] =
    useState(false);

  const containerRef =
    useRef(null);

  // ===========================================================================
  // Close dropdown on outside click
  // ===========================================================================

  useEffect(() => {
    function handleOutside(
      event
    ) {
      if (
        containerRef.current &&
        !containerRef.current.contains(
          event.target
        )
      ) {
        setOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      handleOutside
    );

    return () =>
      document.removeEventListener(
        "mousedown",
        handleOutside
      );
  }, []);

  // ===========================================================================
  // User Details
  // ===========================================================================

  const initials =
    useMemo(() => {
      const name =
        user?.name ||
        user?.fullName ||
        "";

      return name
        .split(" ")
        .map(
          (part) =>
            part[0]
        )
        .join("")
        .slice(0, 2)
        .toUpperCase();
    }, [user]);

  const toggleMenu =
    useCallback(() => {
      setOpen(
        (prev) => !prev
      );
    }, []);

  const closeMenu =
    useCallback(() => {
      setOpen(false);
    }, []);

  // ===========================================================================
  // Default Menu
  // ===========================================================================

  const defaultItems =
    [
      {
        key: "profile",
        label:
          "My Profile",
        icon: User,
        action: () => {
          closeMenu();
          onProfile?.();
        },
      },

      {
        key: "settings",
        label: "Settings",
        icon: Settings,
        action: () => {
          closeMenu();
          onSettings?.();
        },
      },

      {
        key: "billing",
        label:
          "Billing",
        icon: CreditCard,
        action: () => {
          closeMenu();
          onBilling?.();
        },
      },

      ...(showNotifications
        ? [
            {
              key:
                "notifications",
              label:
                "Notifications",
              icon: Bell,
              badge:
                notifications,
              action:
                () => {
                  closeMenu();
                  onNotifications?.();
                },
            },
          ]
        : []),

      {
        key: "logout",
        label:
          "Logout",
        icon: LogOut,
        danger: true,
        action: () => {
          closeMenu();
          onLogout?.();
        },
      },
    ];

  const items =
    menuItems.length
      ? menuItems
      : defaultItems;

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <div
      ref={containerRef}
      className={`tt-user-menu ${className}`}
    >
      {/* ------------------------------------------------------------------- */}
      {/* Trigger */}
      {/* ------------------------------------------------------------------- */}

      <button
        type="button"
        className="tt-user-trigger"
        onClick={
          toggleMenu
        }
      >
        {avatar ? (
          <div className="tt-user-avatar">
            {avatar}
          </div>
        ) : (
          <div className="tt-user-avatar tt-user-initials">
            {initials ||
              "U"}
          </div>
        )}

        <div className="tt-user-meta">
          <span className="tt-user-name">
            {user?.name ||
              user?.fullName ||
              "User"}
          </span>

          {showRole &&
            user?.role && (
              <small className="tt-user-role">
                <Shield
                  size={12}
                />
                {
                  user.role
                }
              </small>
            )}
        </div>

        <ChevronDown
          size={18}
          className={
            open
              ? "tt-user-chevron-open"
              : ""
          }
        />
      </button>

      {/* ------------------------------------------------------------------- */}
      {/* Dropdown */}
      {/* ------------------------------------------------------------------- */}

      {open && (
        <div className="tt-user-dropdown">
          <div className="tt-user-header">
            <div className="tt-user-dropdown-name">
              {user?.name ||
                user?.fullName}
            </div>

            {user?.email && (
              <small>
                {
                  user.email
                }
              </small>
            )}

            {showTenant &&
              tenant && (
                <div className="tt-user-tenant">
                  <Building2
                    size={14}
                  />

                  <span>
                    {tenant.name ||
                      tenant}
                  </span>
                </div>
              )}
          </div>

          <div className="tt-user-menu-items">
            {items.map(
              (
                item
              ) => {
                const Icon =
                  item.icon;

                return (
                  <button
                    key={
                      item.key
                    }
                    type="button"
                    className={`tt-user-menu-item ${
                      item.danger
                        ? "danger"
                        : ""
                    }`}
                    onClick={
                      item.action
                    }
                  >
                    <div className="tt-user-menu-left">
                      {Icon && (
                        <Icon
                          size={
                            16
                          }
                        />
                      )}

                      <span>
                        {
                          item.label
                        }
                      </span>
                    </div>

                    {item.badge >
                      0 && (
                      <span className="tt-user-badge">
                        {
                          item.badge
                        }
                      </span>
                    )}
                  </button>
                );
              }
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

UserMenu.propTypes = {
  user:
    PropTypes.object,

  tenant:
    PropTypes.oneOfType(
      [
        PropTypes.string,
        PropTypes.object,
      ]
    ),

  notifications:
    PropTypes.number,

  showTenant:
    PropTypes.bool,

  showRole:
    PropTypes.bool,

  showNotifications:
    PropTypes.bool,

  avatar:
    PropTypes.node,

  menuItems:
    PropTypes.array,

  onProfile:
    PropTypes.func,

  onSettings:
    PropTypes.func,

  onBilling:
    PropTypes.func,

  onNotifications:
    PropTypes.func,

  onLogout:
    PropTypes.func,

  className:
    PropTypes.string,
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  UserMenu
);