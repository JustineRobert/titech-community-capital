// ============================================================================
// TITech Community Capital
// Notifications Panel
// File: frontend/src/pages/NotificationsPanel.jsx
// Enterprise Production Grade
//
// Features:
// - Multi-Tenant Ready
// - Real-Time Socket.IO Notifications
// - Safe Pagination
// - Duplicate Protection
// - Optimistic Read/Delete Actions
// - Request Concurrency Protection
// - Unmount Safety
// - Accessibility
// - Refresh / Retry Support
// - Defensive API Normalization
// - Financial / Security Notification Ready
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
  AlertCircle,
  Bell,
  Building2,
  Check,
  CheckCircle2,
  CreditCard,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";

import api from "../services/api";
import socket from "../services/socket";

import {
  Button,
  Card,
  EmptyState,
  LoadingScreen,
  StatusBadge,
} from "../ui";

import "./NotificationsPanel.css";

// ============================================================================
// Constants
// ============================================================================

const PAGE_SIZE = 20;

const API_ENDPOINT = "/api/notifications";

const SOCKET_EVENT = "notification";

const DEFAULT_ERROR_MESSAGE =
  "Failed to load notifications. Please try again.";

const ACTION_ERROR_MESSAGE =
  "The notification action could not be completed. Please try again.";

const NOTIFICATION_ICONS = Object.freeze({
  payment: CreditCard,
  savings: Wallet,
  fraud: ShieldAlert,
  member: Users,
  tenant: Building2,
  success: CheckCircle2,
  warning: AlertCircle,
  default: Bell,
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Safely resolves a notification identifier.
 *
 * Supports both Mongo-style `_id` and conventional `id`.
 */
function getNotificationId(
  notification
) {
  if (!notification) {
    return null;
  }

  return (
    notification._id ??
    notification.id ??
    null
  );
}

/**
 * Safely resolves the notification type.
 */
function getNotificationType(
  notification
) {
  return String(
    notification?.type ||
      "default"
  )
    .trim()
    .toLowerCase();
}

/**
 * Returns the appropriate notification icon.
 */
function getNotificationIcon(
  type
) {
  return (
    NOTIFICATION_ICONS[
      String(type || "")
        .trim()
        .toLowerCase()
    ] ||
    NOTIFICATION_ICONS.default
  );
}

/**
 * Safely normalizes API notification data.
 */
function normalizeNotifications(
  payload
) {
  if (
    Array.isArray(
      payload
    )
  ) {
    return payload;
  }

  if (
    Array.isArray(
      payload?.notifications
    )
  ) {
    return payload.notifications;
  }

  if (
    Array.isArray(
      payload?.data
    )
  ) {
    return payload.data;
  }

  if (
    Array.isArray(
      payload?.data?.notifications
    )
  ) {
    return payload.data
      .notifications;
  }

  return [];
}

/**
 * Removes duplicate notifications while
 * preserving the first occurrence.
 */
function deduplicateNotifications(
  items
) {
  const seen =
    new Set();

  return items.filter(
    (item) => {
      const id =
        getNotificationId(
          item
        );

      // Notifications without IDs are retained.
      if (!id) {
        return true;
      }

      const normalizedId =
        String(id);

      if (
        seen.has(
          normalizedId
        )
      ) {
        return false;
      }

      seen.add(
        normalizedId
      );

      return true;
    }
  );
}

/**
 * Safely formats a notification timestamp.
 */
function formatDate(
  value
) {
  if (!value) {
    return "Unknown";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "Unknown";
  }

  try {
    return new Intl.DateTimeFormat(
      "en-UG",
      {
        dateStyle:
          "medium",
        timeStyle:
          "short",
      }
    ).format(date);
  } catch {
    return date.toLocaleString(
      "en-UG"
    );
  }
}

/**
 * Extracts a safe API error message.
 */
function getErrorMessage(
  error,
  fallback = DEFAULT_ERROR_MESSAGE
) {
  return (
    error?.response
      ?.data?.message ||
    error?.response
      ?.data?.error ||
    error?.message ||
    fallback
  );
}

/**
 * Normalizes an incoming realtime notification.
 */
function normalizeRealtimeNotification(
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
    read:
      Boolean(
        notification.read
      ),
  };
}

// ============================================================================
// Notification Item
// ============================================================================

const NotificationItem =
  memo(
    function NotificationItem({
      notification,
      onRead,
      onDelete,
      processing,
    }) {
      const id =
        getNotificationId(
          notification
        );

      const type =
        getNotificationType(
          notification
        );

      const Icon =
        getNotificationIcon(
          type
        );

      const isRead =
        Boolean(
          notification?.read
        );

      const isProcessing =
        processing?.has(
          String(id)
        );

      const title =
        notification?.title ||
        "Notification";

      const message =
        notification?.message ||
        notification?.description ||
        "No notification details available.";

      return (
        <Card
          className={`notification-card ${
            isRead
              ? ""
              : "unread"
          } ${
            isProcessing
              ? "processing"
              : ""
          }`}
          aria-busy={
            isProcessing
          }
        >
          <div
            className="notification-icon"
            aria-hidden="true"
          >
            <Icon
              size={22}
            />
          </div>

          <div className="notification-content">
            <div className="notification-header">
              <h4>
                {title}
              </h4>

              {!isRead && (
                <StatusBadge status="info">
                  New
                </StatusBadge>
              )}
            </div>

            <p>
              {message}
            </p>

            <small>
              {formatDate(
                notification?.createdAt ||
                  notification?.timestamp
              )}
            </small>
          </div>

          <div
            className="notification-actions"
            aria-label={`Actions for ${title}`}
          >
            {!isRead && (
              <button
                type="button"
                title="Mark as read"
                aria-label={`Mark ${title} as read`}
                onClick={() =>
                  onRead(
                    notification
                  )
                }
                disabled={
                  isProcessing ||
                  !id
                }
              >
                <Check
                  size={18}
                  aria-hidden="true"
                />
              </button>
            )}

            <button
              type="button"
              title="Delete notification"
              aria-label={`Delete ${title}`}
              onClick={() =>
                onDelete(
                  notification
                )
              }
              disabled={
                isProcessing ||
                !id
              }
            >
              <Trash2
                size={18}
                aria-hidden="true"
              />
            </button>
          </div>
        </Card>
      );
    }
  );

NotificationItem.displayName =
  "NotificationItem";

NotificationItem.propTypes =
  {
    notification:
      PropTypes.shape({
        _id:
          PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
          ]),
        id:
          PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
          ]),
        type:
          PropTypes.string,
        title:
          PropTypes.string,
        message:
          PropTypes.string,
        description:
          PropTypes.string,
        read:
          PropTypes.bool,
        createdAt:
          PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
            PropTypes.instanceOf(
              Date
            ),
          ]),
        timestamp:
          PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
            PropTypes.instanceOf(
              Date
            ),
          ]),
      }).isRequired,
    onRead:
      PropTypes.func.isRequired,
    onDelete:
      PropTypes.func.isRequired,
    processing:
      PropTypes.instanceOf(
        Set
      ).isRequired,
  };

// ============================================================================
// Main Component
// ============================================================================

function NotificationsPanel({
  open = true,
  onClose,
}) {
  // --------------------------------------------------------------------------
  // Lifecycle / request guards
  // --------------------------------------------------------------------------

  const mountedRef =
    useRef(false);

  const requestSequenceRef =
    useRef(0);

  const loadingRequestRef =
    useRef(false);

  const actionRequestRef =
    useRef(new Set());

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const [
    notifications,
    setNotifications,
  ] = useState([]);

  const [
    page,
    setPage,
  ] = useState(1);

  const [
    hasMore,
    setHasMore,
  ] = useState(true);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    loadingMore,
    setLoadingMore,
  ] = useState(false);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const [
    actionError,
    setActionError,
  ] = useState("");

  const [
    processingIds,
    setProcessingIds,
  ] = useState(
    () => new Set()
  );

  // --------------------------------------------------------------------------
  // Mounted-state helper
  // --------------------------------------------------------------------------

  const isMounted =
    useCallback(
      () =>
        mountedRef.current,
      []
    );

  // ==========================================================================
  // Notification State Helpers
  // ==========================================================================

  const mergeNotifications =
    useCallback(
      (
        existing,
        incoming
      ) => {
        const merged =
          [
            ...incoming,
            ...existing,
          ];

        return deduplicateNotifications(
          merged
        );
      },
      []
    );

  // ==========================================================================
  // Load Notifications
  // ==========================================================================

  const loadNotifications =
    useCallback(
      async (
        reset = false
      ) => {
        if (
          !isMounted()
        ) {
          return;
        }

        // Prevent overlapping pagination requests.
        if (
          loadingRequestRef.current
        ) {
          return;
        }

        if (
          !reset &&
          !hasMore
        ) {
          return;
        }

        loadingRequestRef.current =
          true;

        const requestId =
          ++requestSequenceRef.current;

        const currentPage =
          reset
            ? 1
            : page;

        try {
          setError(
            ""
          );

          if (
            reset
          ) {
            setRefreshing(
              true
            );
          } else {
            setLoadingMore(
              true
            );
          }

          const response =
            await api.get(
              API_ENDPOINT,
              {
                params: {
                  page:
                    currentPage,
                  limit:
                    PAGE_SIZE,
                },
              }
            );

          if (
            !isMounted() ||
            requestId !==
              requestSequenceRef.current
          ) {
            return;
          }

          const payload =
            response?.data ??
            {};

          const items =
            deduplicateNotifications(
              normalizeNotifications(
                payload
              )
            );

          if (
            reset
          ) {
            setNotifications(
              items
            );

            setPage(
              2
            );
          } else {
            setNotifications(
              (
                previous
              ) =>
                mergeNotifications(
                  previous,
                  items
                )
            );

            setPage(
              (
                previous
              ) =>
                previous + 1
            );
          }

          // Prefer an explicit backend pagination flag
          // when available.
          const explicitHasMore =
            payload?.hasMore ??
            payload?.pagination
              ?.hasMore ??
            payload?.meta
              ?.hasMore;

          if (
            typeof explicitHasMore ===
            "boolean"
          ) {
            setHasMore(
              explicitHasMore
            );
          } else {
            setHasMore(
              items.length >=
                PAGE_SIZE
            );
          }
        } catch (
          requestError
        ) {
          if (
            !isMounted() ||
            requestId !==
              requestSequenceRef.current
          ) {
            return;
          }

          setError(
            getErrorMessage(
              requestError
            )
          );
        } finally {
          if (
            requestId ===
            requestSequenceRef.current
          ) {
            loadingRequestRef.current =
              false;
          }

          if (
            !isMounted()
          ) {
            return;
          }

          setLoading(
            false
          );
          setRefreshing(
            false
          );
          setLoadingMore(
            false
          );
        }
      },
      [
        hasMore,
        isMounted,
        mergeNotifications,
        page,
      ]
    );

  // ==========================================================================
  // Initial Load
  // ==========================================================================

  useEffect(() => {
    mountedRef.current =
      true;

    loadNotifications(
      true
    );

    return () => {
      mountedRef.current =
        false;

      requestSequenceRef.current +=
        1;

      loadingRequestRef.current =
        false;
    };
  }, [
    loadNotifications,
  ]);

  // ==========================================================================
  // Realtime Notifications
  // ==========================================================================

  useEffect(() => {
    if (
      !open
    ) {
      return undefined;
    }

    const handleNotification =
      (
        incoming
      ) => {
        const notification =
          normalizeRealtimeNotification(
            incoming
          );

        if (
          !notification
        ) {
          return;
        }

        if (
          !mountedRef.current
        ) {
          return;
        }

        setNotifications(
          (
            previous
          ) => {
            const id =
              getNotificationId(
                notification
              );

            if (
              id &&
              previous.some(
                (
                  item
                ) =>
                  String(
                    getNotificationId(
                      item
                    )
                  ) ===
                  String(id)
              )
            ) {
              return previous;
            }

            return [
              notification,
              ...previous,
            ];
          }
        );
      };

    socket.on(
      SOCKET_EVENT,
      handleNotification
    );

    return () => {
      socket.off(
        SOCKET_EVENT,
        handleNotification
      );
    };
  }, [
    open,
  ]);

  // ==========================================================================
  // Processing ID Helpers
  // ==========================================================================

  const setProcessing =
    useCallback(
      (
        id,
        value
      ) => {
        if (!id) {
          return;
        }

        const normalizedId =
          String(id);

        setProcessingIds(
          (
            previous
          ) => {
            const next =
              new Set(
                previous
              );

            if (
              value
            ) {
              next.add(
                normalizedId
              );
            } else {
              next.delete(
                normalizedId
              );
            }

            return next;
          }
        );
      },
      []
    );

  // ==========================================================================
  // Mark As Read
  // ==========================================================================

  const markAsRead =
    useCallback(
      async (
        notification
      ) => {
        const id =
          getNotificationId(
            notification
          );

        if (
          !id ||
          actionRequestRef.current.has(
            String(id)
          )
        ) {
          return;
        }

        if (
          notification.read
        ) {
          return;
        }

        const normalizedId =
          String(id);

        actionRequestRef.current.add(
          normalizedId
        );

        setProcessing(
          normalizedId,
          true
        );

        setActionError(
          ""
        );

        // Optimistic update.
        setNotifications(
          (
            previous
          ) =>
            previous.map(
              (
                item
              ) =>
                String(
                  getNotificationId(
                    item
                  )
                ) ===
                normalizedId
                  ? {
                      ...item,
                      read: true,
                    }
                  : item
            )
        );

        try {
          await api.patch(
            `${API_ENDPOINT}/${encodeURIComponent(
              normalizedId
            )}/read`
          );
        } catch (
          actionErrorResponse
        ) {
          if (
            isMounted()
          ) {
            // Roll back optimistic update.
            setNotifications(
              (
                previous
              ) =>
                previous.map(
                  (
                    item
                  ) =>
                    String(
                      getNotificationId(
                        item
                      )
                    ) ===
                    normalizedId
                      ? {
                          ...item,
                          read: false,
                        }
                      : item
                )
            );

            setActionError(
              getErrorMessage(
                actionErrorResponse,
                ACTION_ERROR_MESSAGE
              )
            );
          }
        } finally {
          actionRequestRef.current.delete(
            normalizedId
          );

          if (
            isMounted()
          ) {
            setProcessing(
              normalizedId,
              false
            );
          }
        }
      },
      [
        isMounted,
        setProcessing,
      ]
    );

  // ==========================================================================
  // Delete Notification
  // ==========================================================================

  const deleteNotification =
    useCallback(
      async (
        notification
      ) => {
        const id =
          getNotificationId(
            notification
          );

        if (
          !id ||
          actionRequestRef.current.has(
            String(id)
          )
        ) {
          return;
        }

        const normalizedId =
          String(id);

        actionRequestRef.current.add(
          normalizedId
        );

        setProcessing(
          normalizedId,
          true
        );

        setActionError(
          ""
        );

        let removedNotification =
          null;

        // Optimistic removal.
        setNotifications(
          (
            previous
          ) => {
            removedNotification =
              previous.find(
                (
                  item
                ) =>
                  String(
                    getNotificationId(
                      item
                    )
                  ) ===
                  normalizedId
              );

            return previous.filter(
              (
                item
              ) =>
                String(
                  getNotificationId(
                    item
                  )
                ) !==
                normalizedId
            );
          }
        );

        try {
          await api.delete(
            `${API_ENDPOINT}/${encodeURIComponent(
              normalizedId
            )}`
          );
        } catch (
          actionErrorResponse
        ) {
          if (
            isMounted() &&
            removedNotification
          ) {
            // Roll back optimistic removal.
            setNotifications(
              (
                previous
              ) =>
                mergeNotifications(
                  previous,
                  [
                    removedNotification,
                  ]
                )
            );

            setActionError(
              getErrorMessage(
                actionErrorResponse,
                ACTION_ERROR_MESSAGE
              )
            );
          }
        } finally {
          actionRequestRef.current.delete(
            normalizedId
          );

          if (
            isMounted()
          ) {
            setProcessing(
              normalizedId,
              false
            );
          }
        }
      },
      [
        isMounted,
        mergeNotifications,
        setProcessing,
      ]
    );

  // ==========================================================================
  // Refresh
  // ==========================================================================

  const handleRefresh =
    useCallback(
      () => {
        if (
          refreshing ||
          loadingRequestRef.current
        ) {
          return;
        }

        setPage(
          1
        );

        setHasMore(
          true
        );

        loadNotifications(
          true
        );
      },
      [
        loadNotifications,
        refreshing,
      ]
    );

  // ==========================================================================
  // Retry
  // ==========================================================================

  const handleRetry =
    useCallback(
      () => {
        setError(
          ""
        );

        setPage(
          1
        );

        setHasMore(
          true
        );

        loadNotifications(
          true
        );
      },
      [
        loadNotifications,
      ]
    );

  // ==========================================================================
  // Derived State
  // ==========================================================================

  const unreadCount =
    useMemo(
      () =>
        notifications.reduce(
          (
            count,
            notification
          ) =>
            count +
            (
              notification?.read
                ? 0
                : 1
            ),
          0
        ),
      [
        notifications,
      ]
    );

  const notificationCount =
    notifications.length;

  // ==========================================================================
  // Closed
  // ==========================================================================

  if (!open) {
    return null;
  }

  // ==========================================================================
  // Initial Loading
  // ==========================================================================

  if (
    loading &&
    !notifications.length
  ) {
    return (
      <aside
        className="notifications-panel"
        aria-label="Notifications"
        aria-busy="true"
      >
        <LoadingScreen />
      </aside>
    );
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <aside
      className="notifications-panel"
      aria-label="Notifications panel"
    >
      {/* ================================================================== */}
      {/* Header */}
      {/* ================================================================== */}

      <header className="notifications-header">
        <div>
          <h2>
            Notifications
          </h2>

          <small
            aria-live="polite"
          >
            {unreadCount}{" "}
            unread
            {notificationCount >
              0 && (
              <>
                {" "}
                ·{" "}
                {notificationCount}{" "}
                total
              </>
            )}
          </small>
        </div>

        <div className="notifications-header-actions">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={
              handleRefresh
            }
            disabled={
              refreshing ||
              loadingRequestRef.current
            }
            aria-label="Refresh notifications"
            title="Refresh notifications"
          >
            <RefreshCw
              size={16}
              aria-hidden="true"
              className={
                refreshing
                  ? "notifications-refreshing"
                  : undefined
              }
            />
          </Button>

          {onClose && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={
                onClose
              }
              aria-label="Close notifications"
              title="Close notifications"
            >
              <X
                size={16}
                aria-hidden="true"
              />
            </Button>
          )}
        </div>
      </header>

      {/* ================================================================== */}
      {/* Load Error */}
      {/* ================================================================== */}

      {error && (
        <div
          className="notifications-error"
          role="alert"
        >
          <AlertCircle
            size={18}
            aria-hidden="true"
          />

          <span>
            {error}
          </span>

          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={
              handleRetry
            }
          >
            Retry
          </Button>
        </div>
      )}

      {/* ================================================================== */}
      {/* Action Error */}
      {/* ================================================================== */}

      {actionError && (
        <div
          className="notifications-error notifications-action-error"
          role="alert"
        >
          <AlertCircle
            size={18}
            aria-hidden="true"
          />

          <span>
            {actionError}
          </span>

          <button
            type="button"
            aria-label="Dismiss notification error"
            title="Dismiss"
            onClick={() =>
              setActionError(
                ""
              )
            }
          >
            <X
              size={16}
              aria-hidden="true"
            />
          </button>
        </div>
      )}

      {/* ================================================================== */}
      {/* Empty State */}
      {/* ================================================================== */}

      {!notifications.length ? (
        <EmptyState
          title={
            error
              ? "Notifications Unavailable"
              : "No Notifications"
          }
          description={
            error
              ? "We couldn't retrieve your notifications."
              : "You're all caught up."
          }
        />
      ) : (
        <>
          {/* ================================================================ */}
          {/* Notification List */}
          {/* ================================================================ */}

          <div
            className="notifications-list"
            role="list"
            aria-live="polite"
          >
            {notifications.map(
              (
                notification,
                index
              ) => {
                const id =
                  getNotificationId(
                    notification
                  );

                /*
                 * IDs should normally always exist.
                 * The index fallback prevents React key
                 * warnings for malformed legacy payloads.
                 */
                const key =
                  id
                    ? String(id)
                    : `notification-${index}`;

                return (
                  <div
                    role="listitem"
                    key={key}
                  >
                    <NotificationItem
                      notification={
                        notification
                      }
                      onRead={
                        markAsRead
                      }
                      onDelete={
                        deleteNotification
                      }
                      processing={
                        processingIds
                      }
                    />
                  </div>
                );
              }
            )}
          </div>

          {/* ================================================================ */}
          {/* Pagination */}
          {/* ================================================================ */}

          {hasMore && (
            <div className="notifications-footer">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  loadNotifications(
                    false
                  )
                }
                disabled={
                  loadingMore ||
                  refreshing
                }
                aria-busy={
                  loadingMore
                }
              >
                {loadingMore ? (
                  <>
                    <RefreshCw
                      size={16}
                      aria-hidden="true"
                      className="notifications-refreshing"
                    />
                    Loading...
                  </>
                ) : (
                  "Load More"
                )}
              </Button>
            </div>
          )}

          {/* ================================================================ */}
          {/* End State */}
          {/* ================================================================ */}

          {!hasMore &&
            notifications.length >
              0 && (
              <div
                className="notifications-end"
                aria-live="polite"
              >
                <CheckCircle2
                  size={16}
                  aria-hidden="true"
                />
                <span>
                  You're all caught up.
                </span>
              </div>
            )}
        </>
      )}
    </aside>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

NotificationsPanel.propTypes =
  {
    open:
      PropTypes.bool,
    onClose:
      PropTypes.func,
  };

// ============================================================================
// Export
// ============================================================================

export default memo(
  NotificationsPanel
);