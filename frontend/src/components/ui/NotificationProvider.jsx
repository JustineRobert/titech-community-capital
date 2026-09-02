// ============================================================================
// TITech Community Capital
// Enterprise Notification Provider
// File: frontend/src/components/ui/NotificationProvider.jsx
// Production Grade
// ============================================================================

"use strict";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import PropTypes from "prop-types";
import { toast } from "react-toastify";

import api from "../../services/api";
import socket from "../../services/socket";

// ============================================================================
// Configuration
// ============================================================================

const NOTIFICATION_ENDPOINT =
  "/api/notifications";

const DEFAULT_PAGE_SIZE = 20;

const MAX_NOTIFICATIONS = 100;

const MAX_RETRIES = 3;

const RETRY_BASE_DELAY = 2000;

const DEFAULT_TOAST_DURATION = 5000;

const STORAGE_KEY =
  "titech.notifications.preferences";

const NOTIFICATION_TYPES = Object.freeze({
  SYSTEM: "system",
  MEMBER: "member",
  PAYMENT: "payment",
  SAVINGS: "savings",
  LOAN: "loan",
  FRAUD: "fraud",
  KYC: "kyc",
  AML: "aml",
  USSD: "ussd",
  MOBILE_MONEY: "mobile_money",
  EXECUTIVE: "executive",
  REGULATORY: "regulatory",
  REPORT: "report",
});

// ============================================================================
// Context
// ============================================================================

const NotificationContext =
  createContext(null);

// ============================================================================
// Default State
// ============================================================================

const DEFAULT_PREFERENCES =
  Object.freeze({
    browser: true,
    toast: true,
    sound: false,
  });

const DEFAULT_STATE = {
  notifications: [],
  unreadCount: 0,
  loading: false,
  refreshing: false,
  error: null,
  initialized: false,
  hasMore: true,
  page: 1,
  lastUpdated: null,
  connected: false,
};

// ============================================================================
// Helpers
// ============================================================================

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function normalizeNotification(
  notification
) {
  if (!isObject(notification)) {
    return null;
  }

  const id =
    notification._id ||
    notification.id ||
    notification.notificationId;

  if (!id) {
    return null;
  }

  return {
    ...notification,

    _id: String(id),

    title:
      notification.title ||
      "TITech Notification",

    message:
      notification.message ||
      notification.body ||
      "",

    type:
      notification.type ||
      NOTIFICATION_TYPES.SYSTEM,

    read:
      Boolean(
        notification.read ||
          notification.readAt
      ),

    createdAt:
      notification.createdAt ||
      new Date().toISOString(),
  };
}

function normalizeNotifications(
  value
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeNotification)
    .filter(Boolean);
}

function deduplicateNotifications(
  notifications
) {
  const seen =
    new Set();

  return notifications.filter(
    (notification) => {
      const id =
        notification?._id;

      if (!id) {
        return false;
      }

      if (seen.has(id)) {
        return false;
      }

      seen.add(id);

      return true;
    }
  );
}

function limitNotifications(
  notifications
) {
  return notifications.slice(
    0,
    MAX_NOTIFICATIONS
  );
}

function calculateUnreadCount(
  notifications
) {
  return notifications.reduce(
    (count, notification) =>
      notification?.read
        ? count
        : count + 1,
    0
  );
}

function extractNotificationPayload(
  response
) {
  const payload =
    response?.data ??
    response ??
    {};

  if (
    Array.isArray(payload)
  ) {
    return {
      notifications:
        normalizeNotifications(
          payload
        ),
      hasMore:
        payload.length >=
        DEFAULT_PAGE_SIZE,
    };
  }

  return {
    notifications:
      normalizeNotifications(
        payload.notifications ||
          payload.data ||
          []
      ),

    hasMore:
      typeof payload.hasMore ===
      "boolean"
        ? payload.hasMore
        : normalizeNotifications(
              payload.notifications ||
                payload.data ||
                []
            ).length >=
          DEFAULT_PAGE_SIZE,
  };
}

function getErrorMessage(
  error,
  fallback
) {
  return (
    error?.response?.data
      ?.message ||
    error?.message ||
    fallback
  );
}

function isCancellationError(
  error
) {
  return (
    error?.name ===
      "CanceledError" ||
    error?.name ===
      "AbortError" ||
    error?.code ===
      "ERR_CANCELED"
  );
}

function loadPreferences() {
  if (
    typeof window ===
    "undefined"
  ) {
    return DEFAULT_PREFERENCES;
  }

  try {
    const stored =
      window.localStorage.getItem(
        STORAGE_KEY
      );

    if (!stored) {
      return DEFAULT_PREFERENCES;
    }

    const parsed =
      JSON.parse(stored);

    return {
      ...DEFAULT_PREFERENCES,
      ...(isObject(parsed)
        ? parsed
        : {}),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function persistPreferences(
  preferences
) {
  if (
    typeof window ===
    "undefined"
  ) {
    return;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        preferences
      )
    );
  } catch {
    // Storage failures must never
    // break the notification system.
  }
}

// ============================================================================
// Browser Notification Support
// ============================================================================

function browserNotificationsSupported() {
  return (
    typeof window !==
      "undefined" &&
    typeof window.Notification !==
      "undefined"
  );
}

// ============================================================================
// Provider
// ============================================================================

export function NotificationProvider({
  children,
  autoLoad = true,
  realtime = true,
  enableBrowserNotifications = true,
  enableToastNotifications = true,
  pageSize = DEFAULT_PAGE_SIZE,
  maxNotifications = MAX_NOTIFICATIONS,
}) {
  // ==========================================================================
  // State
  // ==========================================================================

  const [
    state,
    setState,
  ] = useState(
    DEFAULT_STATE
  );

  const [
    preferences,
    setPreferencesState,
  ] = useState(
    () => loadPreferences()
  );

  // ==========================================================================
  // Refs
  // ==========================================================================

  const mountedRef =
    useRef(false);

  const abortRef =
    useRef(null);

  const retryRef =
    useRef(0);

  const retryTimerRef =
    useRef(null);

  const refreshTimerRef =
    useRef(null);

  const requestSequenceRef =
    useRef(0);

  // ==========================================================================
  // State Helpers
  // ==========================================================================

  const updateNotifications =
    useCallback(
      (
        updater,
        options = {}
      ) => {
        setState(
          (previous) => {
            const current =
              previous.notifications;

            const next =
              typeof updater ===
              "function"
                ? updater(current)
                : updater;

            const normalized =
              normalizeNotifications(
                next
              );

            const deduplicated =
              deduplicateNotifications(
                normalized
              );

            const limited =
              deduplicated.slice(
                0,
                Math.max(
                  1,
                  maxNotifications
                )
              );

            return {
              ...previous,

              notifications:
                limited,

              unreadCount:
                calculateUnreadCount(
                  limited
                ),

              lastUpdated:
                options.updateTimestamp ===
                false
                  ? previous.lastUpdated
                  : new Date().toISOString(),
            };
          }
        );
      },
      [maxNotifications]
    );

  // ==========================================================================
  // Browser Notification
  // ==========================================================================

  const showBrowserNotification =
    useCallback(
      (notification) => {
        if (
          !enableBrowserNotifications ||
          !preferences.browser
        ) {
          return;
        }

        if (
          !browserNotificationsSupported()
        ) {
          return;
        }

        if (
          window.Notification
            .permission !==
          "granted"
        ) {
          return;
        }

        const normalized =
          normalizeNotification(
            notification
          );

        if (!normalized) {
          return;
        }

        try {
          const browserNotification =
            new window.Notification(
              normalized.title,
              {
                body:
                  normalized.message,

                icon:
                  normalized.icon ||
                  "/favicon.ico",

                tag:
                  normalized._id,

                silent:
                  !preferences.sound,
              }
            );

          browserNotification.onclick =
            () => {
              try {
                window.focus();
              } catch {
                // Ignore browser focus
                // restrictions.
              }
            };
        } catch {
          // Browser notification
          // failures must not break
          // application notifications.
        }
      },
      [
        enableBrowserNotifications,
        preferences.browser,
        preferences.sound,
      ]
    );

  // ==========================================================================
  // Toast Notification
  // ==========================================================================

  const showToastNotification =
    useCallback(
      (notification) => {
        if (
          !enableToastNotifications ||
          !preferences.toast
        ) {
          return;
        }

        const normalized =
          normalizeNotification(
            notification
          );

        if (!normalized) {
          return;
        }

        if (
          normalized.toast ===
          false
        ) {
          return;
        }

        const message =
          normalized.title &&
          normalized.message
            ? `${normalized.title}: ${normalized.message}`
            : normalized.title ||
              normalized.message;

        const toastOptions = {
          autoClose:
            Number.isFinite(
              normalized.toastDuration
            )
              ? normalized.toastDuration
              : DEFAULT_TOAST_DURATION,
        };

        switch (
          normalized.severity
        ) {
          case "success":
            toast.success(
              message,
              toastOptions
            );
            break;

          case "warning":
            toast.warning(
              message,
              toastOptions
            );
            break;

          case "error":
          case "critical":
            toast.error(
              message,
              toastOptions
            );
            break;

          default:
            toast.info(
              message,
              toastOptions
            );
            break;
        }
      },
      [
        enableToastNotifications,
        preferences.toast,
      ]
    );

  // ==========================================================================
  // Add Notification
  // ==========================================================================

  const addNotification =
    useCallback(
      (
        notification,
        options = {}
      ) => {
        const normalized =
          normalizeNotification(
            notification
          );

        if (!normalized) {
          return null;
        }

        updateNotifications(
          (previous) => [
            normalized,
            ...previous.filter(
              (item) =>
                item._id !==
                normalized._id
            ),
          ],
          {
            updateTimestamp:
              options.updateTimestamp !==
              false,
          }
        );

        if (
          options.browser !==
          false
        ) {
          showBrowserNotification(
            normalized
          );
        }

        if (
          options.toast !==
          false
        ) {
          showToastNotification(
            normalized
          );
        }

        return normalized;
      },
      [
        updateNotifications,
        showBrowserNotification,
        showToastNotification,
      ]
    );

  // ==========================================================================
  // Fetch Notifications
  // ==========================================================================

  const fetchNotifications =
    useCallback(
      async ({
        reset = true,
        silent = false,
      } = {}) => {
        const requestId =
          ++requestSequenceRef.current;

        try {
          if (!silent) {
            setState(
              (previous) => ({
                ...previous,
                loading:
                  reset
                    ? true
                    : previous.loading,
                refreshing:
                  !reset,
                error: null,
              })
            );
          } else {
            setState(
              (previous) => ({
                ...previous,
                error: null,
              })
            );
          }

          abortRef.current?.abort();

          const controller =
            new AbortController();

          abortRef.current =
            controller;

          const requestedPage =
            reset
              ? 1
              : state.page;

          const response =
            await api.get(
              NOTIFICATION_ENDPOINT,
              {
                params: {
                  page:
                    requestedPage,
                  limit:
                    pageSize,
                },

                signal:
                  controller.signal,
              }
            );

          if (
            !mountedRef.current ||
            requestId !==
              requestSequenceRef.current
          ) {
            return [];
          }

          const {
            notifications:
              fetchedNotifications,
            hasMore:
              fetchedHasMore,
          } =
            extractNotificationPayload(
              response
            );

          setState(
            (previous) => {
              const combined =
                reset
                  ? fetchedNotifications
                  : [
                      ...previous.notifications,
                      ...fetchedNotifications,
                    ];

              const deduplicated =
                deduplicateNotifications(
                  combined
                );

              const limited =
                deduplicated.slice(
                  0,
                  Math.max(
                    1,
                    maxNotifications
                  )
                );

              return {
                ...previous,

                notifications:
                  limited,

                unreadCount:
                  calculateUnreadCount(
                    limited
                  ),

                page:
                  reset
                    ? 2
                    : previous.page +
                      1,

                hasMore:
                  fetchedHasMore,

                lastUpdated:
                  new Date().toISOString(),

                error: null,

                initialized:
                  true,
              };
            }
          );

          retryRef.current = 0;

          return fetchedNotifications;
        } catch (error) {
          if (
            isCancellationError(
              error
            )
          ) {
            return [];
          }

          if (
            mountedRef.current
          ) {
            setState(
              (previous) => ({
                ...previous,

                error:
                  getErrorMessage(
                    error,
                    "Failed to load notifications."
                  ),

                initialized:
                  previous.initialized,
              })
            );
          }

          throw error;
        } finally {
          if (
            mountedRef.current &&
            requestId ===
              requestSequenceRef.current
          ) {
            setState(
              (previous) => ({
                ...previous,
                loading: false,
                refreshing: false,
              })
            );
          }
        }
      },
      [
        pageSize,
        maxNotifications,
        state.page,
      ]
    );

  // ==========================================================================
  // Retry
  // ==========================================================================

  const retry =
    useCallback(() => {
      if (
        retryTimerRef.current
      ) {
        clearTimeout(
          retryTimerRef.current
        );
      }

      retryRef.current += 1;

      if (
        retryRef.current >
        MAX_RETRIES
      ) {
        retryRef.current = 0;

        return fetchNotifications({
          reset: true,
        });
      }

      const delay =
        RETRY_BASE_DELAY *
        retryRef.current;

      return new Promise(
        (resolve, reject) => {
          retryTimerRef.current =
            setTimeout(
              async () => {
                try {
                  const result =
                    await fetchNotifications(
                      {
                        reset: true,
                      }
                    );

                  retryRef.current = 0;

                  resolve(
                    result
                  );
                } catch (
                  error
                ) {
                  reject(
                    error
                  );
                }
              },
              delay
            );
        }
      );
    }, [fetchNotifications]);

  // ==========================================================================
  // Refresh
  // ==========================================================================

  const refresh =
    useCallback(
      () =>
        fetchNotifications({
          reset: true,
          silent: false,
        }),
      [fetchNotifications]
    );

  // ==========================================================================
  // Load More
  // ==========================================================================

  const loadMore =
    useCallback(async () => {
      if (
        state.loading ||
        state.refreshing ||
        !state.hasMore
      ) {
        return [];
      }

      try {
        return await fetchNotifications(
          {
            reset: false,
            silent: false,
          }
        );
      } catch {
        return [];
      }
    }, [
      state.loading,
      state.refreshing,
      state.hasMore,
      fetchNotifications,
    ]);

  // ==========================================================================
  // Mark As Read
  // ==========================================================================

  const markAsRead =
    useCallback(
      async (notificationId) => {
        if (!notificationId) {
          return false;
        }

        const id =
          String(
            notificationId
          );

        const previous =
          state.notifications.find(
            (notification) =>
              notification._id === id
          );

        if (
          !previous ||
          previous.read
        ) {
          return true;
        }

        try {
          await api.patch(
            `${NOTIFICATION_ENDPOINT}/${encodeURIComponent(
              id
            )}/read`
          );

          if (
            mountedRef.current
          ) {
            updateNotifications(
              (notifications) =>
                notifications.map(
                  (notification) =>
                    notification._id ===
                    id
                      ? {
                          ...notification,
                          read: true,
                          readAt:
                            new Date().toISOString(),
                        }
                      : notification
                )
            );
          }

          return true;
        } catch (error) {
          const message =
            getErrorMessage(
              error,
              "Unable to mark notification as read."
            );

          setState(
            (previousState) => ({
              ...previousState,
              error: message,
            })
          );

          return false;
        }
      },
      [
        state.notifications,
        updateNotifications,
      ]
    );

  // ==========================================================================
  // Mark All As Read
  // ==========================================================================

  const markAllAsRead =
    useCallback(async () => {
      try {
        await api.patch(
          `${NOTIFICATION_ENDPOINT}/read-all`
        );

        const readAt =
          new Date().toISOString();

        updateNotifications(
          (notifications) =>
            notifications.map(
              (notification) => ({
                ...notification,
                read: true,
                readAt,
              })
            )
        );

        return true;
      } catch (error) {
        const message =
          getErrorMessage(
            error,
            "Failed to mark all notifications as read."
          );

        setState(
          (previous) => ({
            ...previous,
            error: message,
          })
        );

        return false;
      }
    }, [updateNotifications]);

  // ==========================================================================
  // Delete Notification
  // ==========================================================================

  const deleteNotification =
    useCallback(
      async (notificationId) => {
        if (!notificationId) {
          return false;
        }

        const id =
          String(
            notificationId
          );

        try {
          await api.delete(
            `${NOTIFICATION_ENDPOINT}/${encodeURIComponent(
              id
            )}`
          );

          updateNotifications(
            (notifications) =>
              notifications.filter(
                (notification) =>
                  notification._id !== id
              )
          );

          return true;
        } catch (error) {
          const message =
            getErrorMessage(
              error,
              "Unable to delete notification."
            );

          setState(
            (previous) => ({
              ...previous,
              error: message,
            })
          );

          return false;
        }
      },
      [updateNotifications]
    );

  // ==========================================================================
  // Clear Notifications
  // ==========================================================================

  const clearNotifications =
    useCallback(async () => {
      try {
        await api.delete(
          NOTIFICATION_ENDPOINT
        );

        setState(
          (previous) => ({
            ...previous,
            notifications: [],
            unreadCount: 0,
            page: 1,
            hasMore: false,
            lastUpdated:
              new Date().toISOString(),
          })
        );

        return true;
      } catch (error) {
        const message =
          getErrorMessage(
            error,
            "Failed to clear notifications."
          );

        setState(
          (previous) => ({
            ...previous,
            error: message,
          })
        );

        return false;
      }
    }, []);

  // ==========================================================================
  // Clear Local Notifications
  // ==========================================================================

  const clearLocalNotifications =
    useCallback(() => {
      setState(
        (previous) => ({
          ...previous,
          notifications: [],
          unreadCount: 0,
          page: 1,
          hasMore: true,
          lastUpdated:
            new Date().toISOString(),
        })
      );
    }, []);

  // ==========================================================================
  // Preferences
  // ==========================================================================

  const updatePreferences =
    useCallback(
      (updates) => {
        setPreferencesState(
          (previous) => {
            const next = {
              ...previous,
              ...(typeof updates ===
              "function"
                ? updates(
                    previous
                  )
                : updates),
            };

            persistPreferences(
              next
            );

            return next;
          }
        );
      },
      []
    );

  const requestBrowserPermission =
    useCallback(async () => {
      if (
        !browserNotificationsSupported()
      ) {
        return "unsupported";
      }

      try {
        const permission =
          await window.Notification.requestPermission();

        if (
          permission ===
          "granted"
        ) {
          updatePreferences({
            browser: true,
          });
        }

        return permission;
      } catch {
        return "denied";
      }
    }, [updatePreferences]);

  // ==========================================================================
  // Realtime Notification Handlers
  // ==========================================================================

  useEffect(() => {
    if (!realtime) {
      return undefined;
    }

    const handleNotification =
      (payload) => {
        addNotification(
          payload
        );
      };

    const handleNotificationRead =
      (payload) => {
        const id =
          typeof payload ===
          "string"
            ? payload
            : payload?._id ||
              payload?.id ||
              payload?.notificationId;

        if (!id) {
          return;
        }

        updateNotifications(
          (notifications) =>
            notifications.map(
              (notification) =>
                notification._id ===
                String(id)
                  ? {
                      ...notification,
                      read: true,
                      readAt:
                        new Date().toISOString(),
                    }
                  : notification
            )
        );
      };

    const handleNotificationDeleted =
      (payload) => {
        const id =
          typeof payload ===
          "string"
            ? payload
            : payload?._id ||
              payload?.id ||
              payload?.notificationId;

        if (!id) {
          return;
        }

        updateNotifications(
          (notifications) =>
            notifications.filter(
              (notification) =>
                notification._id !==
                String(id)
            )
        );
      };

    const handleConnect =
      () => {
        if (
          mountedRef.current
        ) {
          setState(
            (previous) => ({
              ...previous,
              connected: true,
            })
          );
        }
      };

    const handleDisconnect =
      () => {
        if (
          mountedRef.current
        ) {
          setState(
            (previous) => ({
              ...previous,
              connected: false,
            })
          );
        }
      };

    socket.on(
      "notification",
      handleNotification
    );

    socket.on(
      "notification:new",
      handleNotification
    );

    socket.on(
      "notification:read",
      handleNotificationRead
    );

    socket.on(
      "notification:deleted",
      handleNotificationDeleted
    );

    socket.on(
      "connect",
      handleConnect
    );

    socket.on(
      "disconnect",
      handleDisconnect
    );

    return () => {
      socket.off(
        "notification",
        handleNotification
      );

      socket.off(
        "notification:new",
        handleNotification
      );

      socket.off(
        "notification:read",
        handleNotificationRead
      );

      socket.off(
        "notification:deleted",
        handleNotificationDeleted
      );

      socket.off(
        "connect",
        handleConnect
      );

      socket.off(
        "disconnect",
        handleDisconnect
      );
    };
  }, [
    realtime,
    addNotification,
    updateNotifications,
  ]);

  // ==========================================================================
  // Browser Permission Initialization
  // ==========================================================================

  useEffect(() => {
    if (
      !enableBrowserNotifications ||
      !preferences.browser ||
      !browserNotificationsSupported()
    ) {
      return;
    }

    if (
      window.Notification
        .permission !==
      "default"
    ) {
      return;
    }

    // Do not force a permission prompt
    // during application bootstrap.
    // The UI can explicitly call
    // requestBrowserPermission().
  }, [
    enableBrowserNotifications,
    preferences.browser,
  ]);

  // ==========================================================================
  // Initialization
  // ==========================================================================

  useEffect(() => {
    mountedRef.current =
      true;

    if (autoLoad) {
      fetchNotifications({
        reset: true,
        silent: true,
      }).catch(() => {
        // Error is already reflected
        // in provider state.
      });
    } else {
      setState(
        (previous) => ({
          ...previous,
          initialized: true,
          loading: false,
        })
      );
    }

    return () => {
      mountedRef.current =
        false;

      abortRef.current?.abort();

      if (
        retryTimerRef.current
      ) {
        clearTimeout(
          retryTimerRef.current
        );
      }

      if (
        refreshTimerRef.current
      ) {
        clearInterval(
          refreshTimerRef.current
        );
      }
    };
  }, [
    autoLoad,
    fetchNotifications,
  ]);

  // ==========================================================================
  // Automatic Refresh
  // ==========================================================================

  useEffect(() => {
    if (
      !autoLoad ||
      !realtime
    ) {
      return undefined;
    }

    return undefined;
  }, [autoLoad, realtime]);

  // ==========================================================================
  // Computed Values
  // ==========================================================================

  const groupedNotifications =
    useMemo(
      () =>
        state.notifications.reduce(
          (groups, notification) => {
            const type =
              notification.type ||
              NOTIFICATION_TYPES.SYSTEM;

            if (!groups[type]) {
              groups[type] = [];
            }

            groups[type].push(
              notification
            );

            return groups;
          },
          {}
        ),
      [state.notifications]
    );

  const unreadNotifications =
    useMemo(
      () =>
        state.notifications.filter(
          (notification) =>
            !notification.read
        ),
      [state.notifications]
    );

  const latestNotification =
    state.notifications[0] ||
    null;

  const diagnostics =
    useMemo(
      () => ({
        initialized:
          state.initialized,

        connected:
          state.connected,

        loading:
          state.loading,

        refreshing:
          state.refreshing,

        total:
          state.notifications
            .length,

        unread:
          state.unreadCount,

        hasMore:
          state.hasMore,

        page:
          state.page,

        lastUpdated:
          state.lastUpdated,

        browserNotifications:
          browserNotificationsSupported(),

        browserPermission:
          browserNotificationsSupported()
            ? window.Notification
                .permission
            : "unsupported",
      }),
      [state]
    );

  // ==========================================================================
  // Context Value
  // ==========================================================================

  const value =
    useMemo(
      () => ({
        // State
        notifications:
          state.notifications,

        unreadNotifications,

        unreadCount:
          state.unreadCount,

        groupedNotifications,

        latestNotification,

        loading:
          state.loading,

        refreshing:
          state.refreshing,

        error:
          state.error,

        initialized:
          state.initialized,

        hasMore:
          state.hasMore,

        page:
          state.page,

        connected:
          state.connected,

        lastUpdated:
          state.lastUpdated,

        // Operations
        addNotification,

        refresh,

        retry,

        loadMore,

        fetchNotifications,

        markAsRead,

        markAllAsRead,

        deleteNotification,

        clearNotifications,

        clearLocalNotifications,

        // Preferences
        preferences,

        updatePreferences,

        requestBrowserPermission,

        // Diagnostics
        diagnostics,

        // Constants
        notificationTypes:
          NOTIFICATION_TYPES,
      }),
      [
        state,
        unreadNotifications,
        groupedNotifications,
        latestNotification,
        addNotification,
        refresh,
        retry,
        loadMore,
        fetchNotifications,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        clearNotifications,
        clearLocalNotifications,
        preferences,
        updatePreferences,
        requestBrowserPermission,
        diagnostics,
      ]
    );

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <NotificationContext.Provider
      value={value}
    >
      {children}
    </NotificationContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useNotificationContext() {
  const context =
    useContext(
      NotificationContext
    );

  if (!context) {
    throw new Error(
      "useNotificationContext must be used within a NotificationProvider."
    );
  }

  return context;
}

// ============================================================================
// Backward-Compatible Alias
// ============================================================================

export const useNotifications =
  useNotificationContext;

// ============================================================================
// PropTypes
// ============================================================================

NotificationProvider.propTypes = {
  children:
    PropTypes.node.isRequired,

  autoLoad:
    PropTypes.bool,

  realtime:
    PropTypes.bool,

  enableBrowserNotifications:
    PropTypes.bool,

  enableToastNotifications:
    PropTypes.bool,

  pageSize:
    PropTypes.number,

  maxNotifications:
    PropTypes.number,
};

// ============================================================================
// Defaults
// ============================================================================

NotificationProvider.defaultProps = {
  autoLoad: true,
  realtime: true,
  enableBrowserNotifications: true,
  enableToastNotifications: true,
  pageSize: DEFAULT_PAGE_SIZE,
  maxNotifications: MAX_NOTIFICATIONS,
};

// ============================================================================
// Exports
// ============================================================================

export {
  NOTIFICATION_TYPES,
  DEFAULT_PREFERENCES,
  DEFAULT_STATE,
};

export default NotificationProvider;