// ============================================================================
// TITech Community Capital
// Enterprise Notification Bell Component
// File: src/components/ui/NotificationBell.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import PropTypes from "prop-types";

import {
  Bell,
  Check,
  CheckCheck,
  Info,
  AlertTriangle,
  ShieldAlert,
  Wallet,
  CreditCard,
  X,
} from "lucide-react";

// ============================================================================
// Helpers
// ============================================================================

function formatTime(
  value
) {
  if (!value) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(
      "en-UG",
      {
        dateStyle: "medium",
        timeStyle: "short",
      }
    ).format(
      new Date(value)
    );
  } catch {
    return "";
  }
}

function getIcon(
  type
) {
  switch (
    String(
      type
    ).toLowerCase()
  ) {
    case "loan":
      return (
        <CreditCard
          size={18}
        />
      );

    case "wallet":
    case "payment":
      return (
        <Wallet
          size={18}
        />
      );

    case "fraud":
    case "security":
      return (
        <ShieldAlert
          size={18}
        />
      );

    case "warning":
      return (
        <AlertTriangle
          size={18}
        />
      );

    default:
      return (
        <Info
          size={18}
        />
      );
  }
}

// ============================================================================
// Component
// ============================================================================

function NotificationBell({
  notifications = [],
  loading = false,
  maxHeight = 420,
  onOpen,
  onRead,
  onReadAll,
  onDelete,
  onNotificationClick,
  className = "",
}) {
  const [
    open,
    setOpen,
  ] = useState(false);

  const wrapperRef =
    useRef(null);

  // ===========================================================================
  // Derived State
  // ===========================================================================

  const unreadCount =
    useMemo(
      () =>
        notifications.filter(
          (
            notification
          ) =>
            !notification.read
        ).length,
      [notifications]
    );

  // ===========================================================================
  // Outside Click
  // ===========================================================================

  useEffect(() => {
    const handler = (
      event
    ) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(
          event.target
        )
      ) {
        setOpen(false);
      }
    };

    document.addEventListener(
      "mousedown",
      handler
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handler
      );
    };
  }, []);

  // ===========================================================================
  // Actions
  // ===========================================================================

  const toggle =
    () => {
      const next =
        !open;

      setOpen(next);

      if (next) {
        onOpen?.();
      }
    };

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <div
      ref={wrapperRef}
      className={`tt-notification ${className}`}
    >
      <button
        type="button"
        className="tt-notification-trigger"
        onClick={toggle}
        aria-label="Notifications"
      >
        <Bell
          size={20}
        />

        {unreadCount >
          0 && (
          <span className="tt-notification-badge">
            {unreadCount >
            99
              ? "99+"
              : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="tt-notification-dropdown">
          <div className="tt-notification-header">
            <div>
              <h4>
                Notifications
              </h4>

              <small>
                {
                  unreadCount
                }{" "}
                unread
              </small>
            </div>

            {unreadCount >
              0 &&
              onReadAll && (
                <button
                  type="button"
                  className="tt-notification-action"
                  onClick={
                    onReadAll
                  }
                >
                  <CheckCheck
                    size={16}
                  />
                  Mark all
                </button>
              )}
          </div>

          <div
            className="tt-notification-list"
            style={{
              maxHeight,
            }}
          >
            {loading && (
              <div className="tt-notification-empty">
                Loading...
              </div>
            )}

            {!loading &&
              notifications.length ===
                0 && (
                <div className="tt-notification-empty">
                  No notifications
                </div>
              )}

            {!loading &&
              notifications.map(
                (
                  notification
                ) => (
                  <div
                    key={
                      notification.id ||
                      notification._id
                    }
                    className={`tt-notification-item ${
                      notification.read
                        ? ""
                        : "unread"
                    }`}
                    onClick={() =>
                      onNotificationClick?.(
                        notification
                      )
                    }
                  >
                    <div className="tt-notification-icon">
                      {getIcon(
                        notification.type
                      )}
                    </div>

                    <div className="tt-notification-content">
                      <div className="tt-notification-title">
                        {notification.title}
                      </div>

                      <div className="tt-notification-message">
                        {
                          notification.message
                        }
                      </div>

                      <div className="tt-notification-time">
                        {formatTime(
                          notification.createdAt
                        )}
                      </div>
                    </div>

                    <div className="tt-notification-actions">
                      {!notification.read &&
                        onRead && (
                          <button
                            type="button"
                            className="tt-notification-icon-btn"
                            onClick={(
                              e
                            ) => {
                              e.stopPropagation();
                              onRead(
                                notification
                              );
                            }}
                          >
                            <Check
                              size={
                                14
                              }
                            />
                          </button>
                        )}

                      {onDelete && (
                        <button
                          type="button"
                          className="tt-notification-icon-btn danger"
                          onClick={(
                            e
                          ) => {
                            e.stopPropagation();
                            onDelete(
                              notification
                            );
                          }}
                        >
                          <X
                            size={
                              14
                            }
                          />
                        </button>
                      )}
                    </div>
                  </div>
                )
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

NotificationBell.propTypes =
  {
    notifications:
      PropTypes.arrayOf(
        PropTypes.shape({
          id:
            PropTypes.oneOfType(
              [
                PropTypes.string,
                PropTypes.number,
              ]
            ),

          title:
            PropTypes.string,

          message:
            PropTypes.string,

          type:
            PropTypes.string,

          read:
            PropTypes.bool,

          createdAt:
            PropTypes.oneOfType(
              [
                PropTypes.string,
                PropTypes.instanceOf(
                  Date
                ),
              ]
            ),
        })
      ),

    loading:
      PropTypes.bool,

    maxHeight:
      PropTypes.number,

    onOpen:
      PropTypes.func,

    onRead:
      PropTypes.func,

    onReadAll:
      PropTypes.func,

    onDelete:
      PropTypes.func,

    onNotificationClick:
      PropTypes.func,

    className:
      PropTypes.string,
  };

// ============================================================================
// Export
// ============================================================================

export default memo(
  NotificationBell
);