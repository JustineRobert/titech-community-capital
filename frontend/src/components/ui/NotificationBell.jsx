// ============================================================================
// TITech Community Capital
// Enterprise Notification Bell
// File: frontend/src/components/ui/NotificationBell.jsx
// Production Grade
// ============================================================================

"use strict";

import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import PropTypes from "prop-types";

import {
  Bell,
  BellRing,
  CheckCheck,
  ChevronRight,
  Loader2,
  MoreVertical,
  X,
} from "lucide-react";

import useNotifications from "../../hooks/useNotifications";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_VISIBLE = 8;

const DEFAULT_TITLE =
  "Notifications";

const DEFAULT_EMPTY_MESSAGE =
  "You're all caught up.";

const NOTIFICATION_PRIORITY = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ============================================================================
// Helpers
// ============================================================================

function normalizeNotification(
  notification
) {
  if (
    !notification ||
    typeof notification !==
      "object"
  ) {
    return null;
  }

  return {
    ...notification,

    id:
      notification._id ||
      notification.id,

    title:
      notification.title ||
      "Notification",

    message:
      notification.message ||
      notification.body ||
      "",

    type:
      notification.type ||
      "system",

    priority:
      notification.priority ||
      "low",

    read:
      Boolean(
        notification.read
      ),

    createdAt:
      notification.createdAt ||
      notification.timestamp ||
      notification.created_at ||
      null,
  };
}

function getNotificationTimestamp(
  notification
) {
  const value =
    notification?.createdAt;

  if (!value) {
    return 0;
  }

  const timestamp =
    new Date(value).getTime();

  return Number.isFinite(
    timestamp
  )
    ? timestamp
    : 0;
}

function formatRelativeTime(
  value
) {
  if (!value) {
    return "";
  }

  const timestamp =
    new Date(value).getTime();

  if (
    !Number.isFinite(timestamp)
  ) {
    return "";
  }

  const difference =
    Date.now() - timestamp;

  if (difference < 0) {
    return "just now";
  }

  const seconds = Math.floor(
    difference / 1000
  );

  if (seconds < 10) {
    return "just now";
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(
    seconds / 60
  );

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(
    minutes / 60
  );

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(
    hours / 24
  );

  if (days < 7) {
    return `${days}d ago`;
  }

  return new Intl.DateTimeFormat(
    "en-UG",
    {
      day: "2-digit",
      month: "short",
      year:
        timestamp <
        new Date().getFullYear() -
          1
          ? "numeric"
          : undefined,
    }
  ).format(
    new Date(timestamp)
  );
}

function getPriorityRank(
  priority
) {
  return (
    NOTIFICATION_PRIORITY[
      priority
    ] || 0
  );
}

// ============================================================================
// Notification Item
// ============================================================================

const NotificationItem = memo(
  function NotificationItem({
    notification,
    onClick,
    onMarkAsRead,
    compact,
  }) {
    const item =
      normalizeNotification(
        notification
      );

    if (!item) {
      return null;
    }

    const unread =
      !item.read;

    const priorityClass = [
      "tt-notification-item",
      unread
        ? "tt-notification-unread"
        : "",
      item.priority
        ? `tt-notification-priority-${item.priority}`
        : "",
      compact
        ? "tt-notification-item-compact"
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    const handleClick =
      (event) => {
        if (
          typeof onClick ===
          "function"
        ) {
          onClick(
            item,
            event
          );
        }

        if (
          unread &&
          typeof onMarkAsRead ===
            "function" &&
          item.id
        ) {
          onMarkAsRead(
            item.id
          );
        }
      };

    return (
      <button
        type="button"
        className={
          priorityClass
        }
        onClick={
          handleClick
        }
        aria-label={`${item.title}${
          unread
            ? ", unread"
            : ""
        }`}
      >
        <span
          className="tt-notification-item-indicator"
          aria-hidden="true"
        />

        <span className="tt-notification-item-content">
          <span className="tt-notification-item-header">
            <strong className="tt-notification-item-title">
              {item.title}
            </strong>

            {item.priority ===
              "critical" && (
              <span className="tt-notification-critical">
                Critical
              </span>
            )}
          </span>

          {item.message && (
            <span className="tt-notification-item-message">
              {item.message}
            </span>
          )}

          <span className="tt-notification-item-meta">
            {item.type}

            {item.createdAt && (
              <>
                <span aria-hidden="true">
                  {" "}
                  ·{" "}
                </span>

                {formatRelativeTime(
                  item.createdAt
                )}
              </>
            )}
          </span>
        </span>

        {unread && (
          <span
            className="tt-notification-unread-dot"
            aria-label="Unread"
          />
        )}
      </button>
    );
  }
);

NotificationItem.displayName =
  "NotificationItem";

// ============================================================================
// Main Component
// ============================================================================

const NotificationBell =
  forwardRef(
    (
      {
        notifications: externalNotifications,
        unreadCount:
          externalUnreadCount,
        onMarkAsRead:
          externalMarkAsRead,
        onMarkAllAsRead:
          externalMarkAllAsRead,
        onNotificationClick,
        onViewAll,
        maxVisible =
          DEFAULT_MAX_VISIBLE,
        title =
          DEFAULT_TITLE,
        emptyMessage =
          DEFAULT_EMPTY_MESSAGE,
        disabled = false,
        loading: externalLoading,
        error: externalError,
        realtime = true,
        autoRefresh = true,
        enableBrowserNotifications = false,
        position = "right",
        size = "md",
        showViewAll = true,
        showMarkAll = true,
        showHeader = true,
        closeOnItemClick = false,
        className = "",
        badgeClassName = "",
        panelClassName = "",
        buttonClassName = "",
        "aria-label":
          ariaLabel =
            "Open notifications",
        ...props
      },
      forwardedRef
    ) => {
      // ======================================================================
      // IDs / Refs
      // ======================================================================

      const generatedId =
        useId();

      const panelId = `tt-notification-panel-${generatedId}`;

      const rootRef =
        useRef(null);

      const firstItemRef =
        useRef(null);

      // ======================================================================
      // Internal Notification State
      // ======================================================================

      const notificationHook =
        useNotifications({
          realtime,
          autoRefresh,
          enableBrowserNotifications,
        });

      const {
        notifications:
          hookNotifications = [],
        unreadCount:
          hookUnreadCount = 0,
        loading:
          hookLoading = false,
        error:
          hookError = null,
        markAsRead:
          hookMarkAsRead,
        markAllAsRead:
          hookMarkAllAsRead,
        refresh:
          hookRefresh,
      } =
        notificationHook || {};

      const notifications =
        Array.isArray(
          externalNotifications
        )
          ? externalNotifications
          : hookNotifications;

      const unreadCount =
        Number.isFinite(
          externalUnreadCount
        )
          ? externalUnreadCount
          : hookUnreadCount;

      const loading =
        typeof externalLoading ===
        "boolean"
          ? externalLoading
          : hookLoading;

      const error =
        externalError ||
        hookError;

      const markAsRead =
        externalMarkAsRead ||
        hookMarkAsRead;

      const markAllAsRead =
        externalMarkAllAsRead ||
        hookMarkAllAsRead;

      // ======================================================================
      // UI State
      // ======================================================================

      const [
        open,
        setOpen,
      ] = useState(false);

      const [
        actionLoading,
        setActionLoading,
      ] = useState(false);

      // ======================================================================
      // Normalized / Sorted Notifications
      // ======================================================================

      const normalizedNotifications =
        useMemo(() => {
          return notifications
            .map(
              normalizeNotification
            )
            .filter(Boolean)
            .sort(
              (
                a,
                b
              ) => {
                const priorityDifference =
                  getPriorityRank(
                    b.priority
                  ) -
                  getPriorityRank(
                    a.priority
                  );

                if (
                  priorityDifference !==
                  0
                ) {
                  return priorityDifference;
                }

                return (
                  getNotificationTimestamp(
                    b
                  ) -
                  getNotificationTimestamp(
                    a
                  )
                );
              }
            );
        }, [notifications]);

      const visibleNotifications =
        useMemo(
          () =>
            normalizedNotifications.slice(
              0,
              Math.max(
                0,
                maxVisible
              )
            ),
          [
            normalizedNotifications,
            maxVisible,
          ]
        );

      const hasNotifications =
        visibleNotifications.length >
        0;

      // ======================================================================
      // Close Handler
      // ======================================================================

      const close =
        useCallback(() => {
          setOpen(false);
        }, []);

      const toggle =
        useCallback(() => {
          if (disabled) {
            return;
          }

          setOpen(
            (previous) =>
              !previous
          );
        }, [disabled]);

      // ======================================================================
      // Outside Click
      // ======================================================================

      useEffect(() => {
        if (!open) {
          return undefined;
        }

        const handlePointerDown =
          (event) => {
            if (
              rootRef.current &&
              !rootRef.current.contains(
                event.target
              )
            ) {
              close();
            }
          };

        document.addEventListener(
          "mousedown",
          handlePointerDown
        );

        return () => {
          document.removeEventListener(
            "mousedown",
            handlePointerDown
          );
        };
      }, [open, close]);

      // ======================================================================
      // Keyboard Navigation
      // ======================================================================

      useEffect(() => {
        if (!open) {
          return undefined;
        }

        const handleKeyDown =
          (event) => {
            if (
              event.key ===
              "Escape"
            ) {
              event.preventDefault();
              close();
              return;
            }

            if (
              event.key ===
              "ArrowDown"
            ) {
              event.preventDefault();

              const panel =
                document.getElementById(
                  panelId
                );

              if (!panel) {
                return;
              }

              const items =
                panel.querySelectorAll(
                  ".tt-notification-item"
                );

              if (
                items.length ===
                0
              ) {
                return;
              }

              const current =
                document.activeElement;

              const currentIndex =
                Array.from(
                  items
                ).indexOf(
                  current
                );

              const nextIndex =
                currentIndex < 0
                  ? 0
                  : Math.min(
                      currentIndex +
                        1,
                      items.length -
                        1
                    );

              items[
                nextIndex
              ].focus();
            }

            if (
              event.key ===
              "ArrowUp"
            ) {
              event.preventDefault();

              const panel =
                document.getElementById(
                  panelId
                );

              if (!panel) {
                return;
              }

              const items =
                panel.querySelectorAll(
                  ".tt-notification-item"
                );

              if (
                items.length ===
                0
              ) {
                return;
              }

              const current =
                document.activeElement;

              const currentIndex =
                Array.from(
                  items
                ).indexOf(
                  current
                );

              const previousIndex =
                currentIndex <=
                0
                  ? 0
                  : currentIndex -
                    1;

              items[
                previousIndex
              ].focus();
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
      }, [
        open,
        close,
        panelId,
      ]);

      // ======================================================================
      // Focus First Notification
      // ======================================================================

      useEffect(() => {
        if (
          open &&
          firstItemRef.current
        ) {
          const timer =
            window.setTimeout(
              () => {
                firstItemRef.current?.focus();
              },
              0
            );

          return () =>
            window.clearTimeout(
              timer
            );
        }

        return undefined;
      }, [open]);

      // ======================================================================
      // Mark Single Notification
      // ======================================================================

      const handleMarkAsRead =
        useCallback(
          async (
            notificationId
          ) => {
            if (
              !notificationId ||
              typeof markAsRead !==
                "function"
            ) {
              return;
            }

            try {
              setActionLoading(
                true
              );

              await markAsRead(
                notificationId
              );
            } finally {
              setActionLoading(
                false
              );
            }
          },
          [markAsRead]
        );

      // ======================================================================
      // Mark All Notifications
      // ======================================================================

      const handleMarkAllAsRead =
        useCallback(
          async () => {
            if (
              typeof markAllAsRead !==
              "function"
            ) {
              return;
            }

            try {
              setActionLoading(
                true
              );

              await markAllAsRead();
            } finally {
              setActionLoading(
                false
              );
            }
          },
          [markAllAsRead]
        );

      // ======================================================================
      // Notification Click
      // ======================================================================

      const handleNotificationClick =
        useCallback(
          (
            notification,
            event
          ) => {
            if (
              typeof onNotificationClick ===
              "function"
            ) {
              onNotificationClick(
                notification,
                event
              );
            }

            if (
              closeOnItemClick
            ) {
              close();
            }
          },
          [
            onNotificationClick,
            closeOnItemClick,
            close,
          ]
        );

      // ======================================================================
      // View All
      // ======================================================================

      const handleViewAll =
        useCallback(() => {
          if (
            typeof onViewAll ===
            "function"
          ) {
            onViewAll();
          } else if (
            typeof hookRefresh ===
            "function"
          ) {
            hookRefresh();
          }

          close();
        }, [
          onViewAll,
          hookRefresh,
          close,
        ]);

      // ======================================================================
      // Badge
      // ======================================================================

      const badgeValue =
        unreadCount > 99
          ? "99+"
          : unreadCount;

      const hasUnread =
        unreadCount > 0;

      const rootClasses = [
        "tt-notification-bell",
        `tt-notification-bell-${size}`,
        open
          ? "tt-notification-bell-open"
          : "",
        disabled
          ? "tt-notification-bell-disabled"
          : "",
        className,
      ]
        .filter(Boolean)
        .join(" ");

      const buttonClasses = [
        "tt-notification-bell-button",
        buttonClassName,
      ]
        .filter(Boolean)
        .join(" ");

      const panelClasses = [
        "tt-notification-panel",
        `tt-notification-panel-${position}`,
        panelClassName,
      ]
        .filter(Boolean)
        .join(" ");

      const badgeClasses = [
        "tt-notification-badge",
        hasUnread
          ? "tt-notification-badge-active"
          : "",
        badgeClassName,
      ]
        .filter(Boolean)
        .join(" ");

      // ======================================================================
      // Render
      // ======================================================================

      return (
        <div
          {...props}
          ref={rootRef}
          className={rootClasses}
        >
          <button
            type="button"
            ref={forwardedRef}
            className={
              buttonClasses
            }
            onClick={toggle}
            disabled={disabled}
            aria-label={
              ariaLabel
            }
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={
              open
                ? panelId
                : undefined
            }
          >
            {hasUnread ? (
              <BellRing
                size={
                  size === "sm"
                    ? 18
                    : 20
                }
                aria-hidden="true"
              />
            ) : (
              <Bell
                size={
                  size === "sm"
                    ? 18
                    : 20
                }
                aria-hidden="true"
              />
            )}

            {hasUnread && (
              <span
                className={
                  badgeClasses
                }
                aria-label={`${unreadCount} unread notifications`}
              >
                {badgeValue}
              </span>
            )}
          </button>

          {open && (
            <section
              id={panelId}
              className={
                panelClasses
              }
              role="dialog"
              aria-label={
                title
              }
              aria-modal="false"
            >
              {showHeader && (
                <header className="tt-notification-panel-header">
                  <div>
                    <h2 className="tt-notification-panel-title">
                      {title}
                    </h2>

                    {hasUnread && (
                      <span className="tt-notification-panel-count">
                        {unreadCount} unread
                      </span>
                    )}
                  </div>

                  <div className="tt-notification-panel-actions">
                    {showMarkAll &&
                      hasUnread && (
                        <button
                          type="button"
                          className="tt-notification-action"
                          onClick={
                            handleMarkAllAsRead
                          }
                          disabled={
                            actionLoading
                          }
                          title="Mark all as read"
                          aria-label="Mark all notifications as read"
                        >
                          {actionLoading ? (
                            <Loader2
                              size={
                                16
                              }
                              className="tt-notification-spinner"
                              aria-hidden="true"
                            />
                          ) : (
                            <CheckCheck
                              size={
                                16
                              }
                              aria-hidden="true"
                            />
                          )}

                          <span>
                            Mark all read
                          </span>
                        </button>
                      )}

                    <button
                      type="button"
                      className="tt-notification-close"
                      onClick={
                        close
                      }
                      aria-label="Close notifications"
                      title="Close notifications"
                    >
                      <X
                        size={18}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </header>
              )}

              <div
                className="tt-notification-panel-body"
                aria-live="polite"
                aria-busy={loading}
              >
                {loading &&
                  !hasNotifications && (
                    <div className="tt-notification-state">
                      <Loader2
                        size={24}
                        className="tt-notification-spinner"
                        aria-hidden="true"
                      />

                      <span>
                        Loading notifications...
                      </span>
                    </div>
                  )}

                {!loading &&
                  error &&
                  !hasNotifications && (
                    <div
                      className="tt-notification-state tt-notification-error"
                      role="alert"
                    >
                      <span>
                        {typeof error ===
                        "string"
                          ? error
                          : "Unable to load notifications."}
                      </span>

                      {typeof hookRefresh ===
                        "function" && (
                        <button
                          type="button"
                          className="tt-notification-retry"
                          onClick={
                            hookRefresh
                          }
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}

                {!loading &&
                  !error &&
                  !hasNotifications && (
                    <div className="tt-notification-state tt-notification-empty">
                      <Bell
                        size={28}
                        aria-hidden="true"
                      />

                      <span>
                        {
                          emptyMessage
                        }
                      </span>
                    </div>
                  )}

                {hasNotifications && (
                  <div
                    className="tt-notification-list"
                    role="list"
                  >
                    {visibleNotifications.map(
                      (
                        notification,
                        index
                      ) => (
                        <div
                          key={
                            notification.id ||
                            `${notification.createdAt}-${index}`
                          }
                          role="listitem"
                        >
                          <NotificationItem
                            notification={
                              notification
                            }
                            onClick={
                              handleNotificationClick
                            }
                            onMarkAsRead={
                              handleMarkAsRead
                            }
                            compact={
                              size ===
                              "sm"
                            }
                            ref={
                              index ===
                              0
                                ? firstItemRef
                                : undefined
                            }
                          />
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>

              {showViewAll &&
                hasNotifications && (
                  <footer className="tt-notification-panel-footer">
                    <button
                      type="button"
                      className="tt-notification-view-all"
                      onClick={
                        handleViewAll
                      }
                    >
                      <span>
                        View all notifications
                      </span>

                      <ChevronRight
                        size={16}
                        aria-hidden="true"
                      />
                    </button>
                  </footer>
                )}
            </section>
          )}
        </div>
      );
    }
  );

NotificationBell.displayName =
  "NotificationBell";

// ============================================================================
// Prop Types
// ============================================================================

NotificationBell.propTypes = {
  notifications:
    PropTypes.arrayOf(
      PropTypes.object
    ),

  unreadCount:
    PropTypes.number,

  onMarkAsRead:
    PropTypes.func,

  onMarkAllAsRead:
    PropTypes.func,

  onNotificationClick:
    PropTypes.func,

  onViewAll:
    PropTypes.func,

  maxVisible:
    PropTypes.number,

  title:
    PropTypes.string,

  emptyMessage:
    PropTypes.string,

  disabled:
    PropTypes.bool,

  loading:
    PropTypes.bool,

  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  realtime:
    PropTypes.bool,

  autoRefresh:
    PropTypes.bool,

  enableBrowserNotifications:
    PropTypes.bool,

  position:
    PropTypes.oneOf([
      "left",
      "right",
    ]),

  size:
    PropTypes.oneOf([
      "sm",
      "md",
      "lg",
    ]),

  showViewAll:
    PropTypes.bool,

  showMarkAll:
    PropTypes.bool,

  showHeader:
    PropTypes.bool,

  closeOnItemClick:
    PropTypes.bool,

  className:
    PropTypes.string,

  badgeClassName:
    PropTypes.string,

  panelClassName:
    PropTypes.string,

  buttonClassName:
    PropTypes.string,

  "aria-label":
    PropTypes.string,
};

// ============================================================================
// Export
// ============================================================================

export {
  NotificationItem,
  formatRelativeTime,
  normalizeNotification,
};

export default memo(
  NotificationBell
);