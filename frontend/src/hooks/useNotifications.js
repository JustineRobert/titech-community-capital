'use strict';

/**
 * ============================================================================
 * TITech COMMUNITY CAPITAL LTD
 * ENTERPRISE NOTIFICATIONS HOOK
 * ============================================================================
 *
 * File:
 *   frontend/src/hooks/useNotifications.js
 *
 * Purpose:
 *   Centralized notification orchestration for the TITech frontend.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 *   - Load notifications from the backend.
 *   - Maintain normalized notification state.
 *   - Support unread/read state.
 *   - Support mark-as-read operations.
 *   - Support mark-all-as-read operations.
 *   - Support notification deletion.
 *   - Support realtime Socket.IO notifications.
 *   - Prevent duplicate realtime notifications.
 *   - Support pagination/cursor loading.
 *   - Support manual refresh.
 *   - Support bounded retry/recovery.
 *   - Support request cancellation.
 *   - Support browser offline/online awareness.
 *   - Prevent state updates after unmount.
 *   - Preserve notifications during transient API failures.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *                  TITech Backend
 *                       │
 *             ┌─────────┴─────────┐
 *             │                   │
 *             ▼                   ▼
 *          REST API            Socket.IO
 *             │                   │
 *             └─────────┬─────────┘
 *                       ▼
 *             useNotifications()
 *                       │
 *          ┌────────────┼────────────┐
 *          ▼            ▼            ▼
 *       State        Actions       Derived
 *                                    data
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * Notifications are informational/application events.
 *
 * They must NOT be treated as authoritative financial state.
 *
 * Financial truth remains in:
 *   - TITech ledger
 *   - transaction services
 *   - account services
 *   - loan services
 *   - savings services
 *   - backend domain services
 *
 * ============================================================================
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import api from '../services/api';
import socket from '../services/socket';

/**
 * ============================================================================
 * Configuration
 * ============================================================================
 */

const DEFAULT_ENDPOINT =
  '/api/notifications';

const DEFAULT_REFRESH_INTERVAL =
  60 * 1000;

const MIN_REFRESH_INTERVAL =
  10 * 1000;

const MAX_REFRESH_INTERVAL =
  24 * 60 * 60 * 1000;

const DEFAULT_PAGE_SIZE =
  25;

const MAX_PAGE_SIZE =
  100;

const MAX_NOTIFICATIONS =
  500;

const MAX_RETRIES =
  3;

const BASE_RETRY_DELAY =
  2000;

const MAX_RETRY_DELAY =
  30 * 1000;

/**
 * ============================================================================
 * Default State
 * ============================================================================
 */

const DEFAULT_STATE = Object.freeze({
  items: [],
  unreadCount: 0,
  total: 0,
  nextCursor: null,
  hasMore: false,
});

/**
 * ============================================================================
 * Notification Types
 * ============================================================================
 */

export const NOTIFICATION_TYPES =
  Object.freeze({
    INFO: 'info',
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error',
    SECURITY: 'security',
    FINANCIAL: 'financial',
    SYSTEM: 'system',
  });

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

/**
 * Determine whether a value is a plain object.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isObject(
  value,
) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

/**
 * Normalize an array.
 *
 * @param {unknown} value
 * @returns {Array}
 */
function normalizeArray(
  value,
) {
  return Array.isArray(value)
    ? value
    : [];
}

/**
 * Normalize a page size.
 *
 * @param {unknown} value
 * @returns {number}
 */
function normalizePageSize(
  value,
) {
  const size =
    Number(value);

  if (
    !Number.isFinite(
      size,
    )
  ) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      Math.floor(size),
    ),
  );
}

/**
 * Normalize refresh interval.
 *
 * @param {unknown} value
 * @returns {number}
 */
function normalizeRefreshInterval(
  value,
) {
  const interval =
    Number(value);

  if (
    !Number.isFinite(
      interval,
    )
  ) {
    return DEFAULT_REFRESH_INTERVAL;
  }

  return Math.min(
    MAX_REFRESH_INTERVAL,
    Math.max(
      MIN_REFRESH_INTERVAL,
      interval,
    ),
  );
}

/**
 * Safely extract an identifier.
 *
 * @param {Object} notification
 * @returns {string|null}
 */
function getNotificationId(
  notification,
) {
  if (
    !notification ||
    typeof notification !==
      'object'
  ) {
    return null;
  }

  const id =
    notification._id ??
    notification.id ??
    notification.notificationId ??
    notification.eventId;

  if (
    id === null ||
    id === undefined
  ) {
    return null;
  }

  return String(id);
}

/**
 * Extract a useful error message.
 *
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(
  error,
) {
  if (
    typeof error?.response
      ?.data?.message ===
      'string'
  ) {
    return error.response.data.message;
  }

  if (
    typeof error?.message ===
      'string' &&
    error.message.trim()
  ) {
    return error.message;
  }

  return 'Failed to load notifications.';
}

/**
 * Determine whether an error is a cancellation.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isCancellationError(
  error,
) {
  return (
    error?.name ===
      'CanceledError' ||
    error?.name ===
      'AbortError' ||
    error?.code ===
      'ERR_CANCELED' ||
    error?.message ===
      'canceled'
  );
}

/**
 * Extract API payload.
 *
 * Supports common response shapes:
 *
 *   response.data
 *   response.data.notifications
 *   response.data.items
 *   response.notifications
 *   response.items
 *
 * @param {unknown} response
 * @returns {Object}
 */
function extractPayload(
  response,
) {
  const root =
    response?.data ??
    response ??
    {};

  if (
    Array.isArray(root)
  ) {
    return {
      items: root,
      total: root.length,
    };
  }

  if (
    !isObject(root)
  ) {
    return {
      ...DEFAULT_STATE,
    };
  }

  const nested =
    isObject(root.data)
      ? root.data
      : root;

  return {
    items:
      normalizeArray(
        nested.notifications ??
          nested.items ??
          nested.results,
      ),

    unreadCount:
      Number.isFinite(
        Number(
          nested.unreadCount,
        ),
      )
        ? Number(
            nested.unreadCount,
          )
        : undefined,

    total:
      Number.isFinite(
        Number(
          nested.total,
        ),
      )
        ? Number(
            nested.total,
          )
        : undefined,

    nextCursor:
      nested.nextCursor ??
      nested.next ??
      nested.pagination
        ?.nextCursor ??
      null,

    hasMore:
      Boolean(
        nested.hasMore ??
          nested.pagination
            ?.hasMore,
      ),
  };
}

/**
 * Normalize a notification object.
 *
 * @param {Object} notification
 * @returns {Object|null}
 */
function normalizeNotification(
  notification,
) {
  if (
    !isObject(
      notification,
    )
  ) {
    return null;
  }

  const id =
    getNotificationId(
      notification,
    );

  if (!id) {
    return null;
  }

  return {
    ...notification,

    id,

    _id:
      notification._id ??
      id,

    title:
      typeof notification.title ===
      'string'
        ? notification.title
        : 'Notification',

    message:
      typeof notification.message ===
      'string'
        ? notification.message
        : typeof notification.body ===
          'string'
          ? notification.body
          : '',

    type:
      notification.type ??
      NOTIFICATION_TYPES.INFO,

    read:
      Boolean(
        notification.read ??
          notification.isRead,
      ),

    createdAt:
      notification.createdAt ??
      notification.created_at ??
      new Date().toISOString(),
  };
}

/**
 * Normalize notification list.
 *
 * @param {Array} notifications
 * @returns {Array}
 */
function normalizeNotifications(
  notifications,
) {
  const seen =
    new Set();

  const normalized =
    [];

  for (
    const item of normalizeArray(
      notifications,
    )
  ) {
    const notification =
      normalizeNotification(
        item,
      );

    if (
      !notification
    ) {
      continue;
    }

    if (
      seen.has(
        notification.id,
      )
    ) {
      continue;
    }

    seen.add(
      notification.id,
    );

    normalized.push(
      notification,
    );
  }

  return normalized.slice(
    0,
    MAX_NOTIFICATIONS,
  );
}

/**
 * Merge notifications while preserving uniqueness.
 *
 * Newer notifications are placed first.
 *
 * @param {Array} primary
 * @param {Array} secondary
 * @returns {Array}
 */
function mergeNotifications(
  primary,
  secondary,
) {
  const merged = [
    ...normalizeArray(
      primary,
    ),
    ...normalizeArray(
      secondary,
    ),
  ];

  const seen =
    new Set();

  const result =
    [];

  for (
    const item of merged
  ) {
    const notification =
      normalizeNotification(
        item,
      );

    if (
      !notification ||
      seen.has(
        notification.id,
      )
    ) {
      continue;
    }

    seen.add(
      notification.id,
    );

    result.push(
      notification,
    );
  }

  return result.slice(
    0,
    MAX_NOTIFICATIONS,
  );
}

/**
 * Calculate unread notifications.
 *
 * @param {Array} notifications
 * @returns {number}
 */
function calculateUnreadCount(
  notifications,
) {
  return normalizeArray(
    notifications,
  ).reduce(
    (count, notification) =>
      count +
      (notification?.read
        ? 0
        : 1),
    0,
  );
}

/**
 * ============================================================================
 * Hook
 * ============================================================================
 */

/**
 * useNotifications
 *
 * @param {Object} options
 * @param {boolean} options.autoRefresh
 * @param {boolean} options.realtime
 * @param {number} options.refreshInterval
 * @param {number} options.pageSize
 * @param {string} options.endpoint
 *
 * @returns {Object}
 */
export default function useNotifications(
  options = {},
) {
  const {
    autoRefresh = true,

    realtime = true,

    refreshInterval:
      requestedRefreshInterval =
        DEFAULT_REFRESH_INTERVAL,

    pageSize:
      requestedPageSize =
        DEFAULT_PAGE_SIZE,

    endpoint =
      DEFAULT_ENDPOINT,
  } = options;

  /**
   * ==========================================================================
   * Configuration
   * ==========================================================================
   */

  const normalizedRefreshInterval =
    useMemo(
      () =>
        normalizeRefreshInterval(
          requestedRefreshInterval,
        ),
      [requestedRefreshInterval],
    );

  const normalizedPageSize =
    useMemo(
      () =>
        normalizePageSize(
          requestedPageSize,
        ),
      [requestedPageSize],
    );

  /**
   * ==========================================================================
   * State
   * ==========================================================================
   */

  const [
    notifications,
    setNotifications,
  ] = useState([]);

  const [
    unreadCount,
    setUnreadCount,
  ] = useState(0);

  const [
    total,
    setTotal,
  ] = useState(0);

  const [
    nextCursor,
    setNextCursor,
  ] = useState(null);

  const [
    hasMore,
    setHasMore,
  ] = useState(false);

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
  ] = useState(null);

  const [
    online,
    setOnline,
  ] = useState(
    typeof navigator ===
      'undefined'
      ? true
      : navigator.onLine,
  );

  const [
    realtimeConnected,
    setRealtimeConnected,
  ] = useState(false);

  /**
   * ==========================================================================
   * Refs
   * ==========================================================================
   */

  const mountedRef =
    useRef(false);

  const refreshTimerRef =
    useRef(null);

  const retryTimerRef =
    useRef(null);

  const abortRef =
    useRef(null);

  const requestGenerationRef =
    useRef(0);

  const requestInFlightRef =
    useRef(false);

  const loadMoreInFlightRef =
    useRef(false);

  const retryCountRef =
    useRef(0);

  /**
   * ==========================================================================
   * Cancel Retry
   * ==========================================================================
   */

  const cancelRetry =
    useCallback(() => {
      if (
        retryTimerRef.current
      ) {
        clearTimeout(
          retryTimerRef.current,
        );

        retryTimerRef.current =
          null;
      }
    }, []);

  /**
   * ==========================================================================
   * Cancel Request
   * ==========================================================================
   */

  const cancelRequest =
    useCallback(() => {
      if (
        abortRef.current
      ) {
        abortRef.current.abort();

        abortRef.current =
          null;
      }
    }, []);

  /**
   * ==========================================================================
   * Apply Notification Snapshot
   * ==========================================================================
   */

  const applySnapshot =
    useCallback(
      (
        payload,
        mode = 'replace',
      ) => {
        const normalized =
          normalizeNotifications(
            payload.items,
          );

        setNotifications(
          (previous) =>
            mode === 'append'
              ? mergeNotifications(
                  previous,
                  normalized,
                )
              : normalized,
        );

        const calculatedUnread =
          calculateUnreadCount(
            normalized,
          );

        setUnreadCount(
          Number.isFinite(
            payload.unreadCount,
          )
            ? Math.max(
                0,
                Number(
                  payload.unreadCount,
                ),
              )
            : calculatedUnread,
        );

        if (
          Number.isFinite(
            payload.total,
          )
        ) {
          setTotal(
            Math.max(
              0,
              Number(
                payload.total,
              ),
            ),
          );
        }

        setNextCursor(
          payload.nextCursor ??
            null,
        );

        setHasMore(
          Boolean(
            payload.hasMore,
          ),
        );
      },
      [],
    );

  /**
   * ==========================================================================
   * Load Notifications
   * ==========================================================================
   */

  const loadNotifications =
    useCallback(
      async (
        silent = false,
      ) => {
        if (
          !mountedRef.current
        ) {
          return false;
        }

        if (
          requestInFlightRef.current
        ) {
          return false;
        }

        if (
          typeof navigator !==
            'undefined' &&
          navigator.onLine ===
            false
        ) {
          setOnline(false);

          if (!silent) {
            setLoading(false);
            setRefreshing(false);
          }

          return false;
        }

        requestInFlightRef.current =
          true;

        const generation =
          ++requestGenerationRef.current;

        cancelRequest();

        const controller =
          new AbortController();

        abortRef.current =
          controller;

        if (!silent) {
          setRefreshing(true);
        }

        setError(null);

        try {
          const response =
            await api.get(
              endpoint,
              {
                params: {
                  limit:
                    normalizedPageSize,
                },

                signal:
                  controller.signal,
              },
            );

          if (
            !mountedRef.current ||
            generation !==
              requestGenerationRef.current
          ) {
            return false;
          }

          const payload =
            extractPayload(
              response,
            );

          applySnapshot(
            payload,
            'replace',
          );

          retryCountRef.current =
            0;

          setOnline(true);

          return true;
        } catch (err) {
          if (
            isCancellationError(
              err,
            )
          ) {
            return false;
          }

          if (
            !mountedRef.current ||
            generation !==
              requestGenerationRef.current
          ) {
            return false;
          }

          const message =
            getErrorMessage(
              err,
            );

          setError({
            type:
              'NOTIFICATION_LOAD_ERROR',

            message,

            retryCount:
              retryCountRef.current,

            timestamp:
              new Date().toISOString(),

            cause: err,
          });

          if (
            retryCountRef.current <
            MAX_RETRIES
          ) {
            retryCountRef.current +=
              1;

            const delay =
              Math.min(
                MAX_RETRY_DELAY,
                BASE_RETRY_DELAY *
                  2 **
                    (retryCountRef.current -
                      1),
              );

            cancelRetry();

            retryTimerRef.current =
              setTimeout(
                () => {
                  retryTimerRef.current =
                    null;

                  if (
                    !mountedRef.current
                  ) {
                    return;
                  }

                  loadNotifications(
                    true,
                  ).catch(
                    () => {},
                  );
                },
                delay,
              );
          }

          return false;
        } finally {
          if (
            abortRef.current ===
            controller
          ) {
            abortRef.current =
              null;
          }

          requestInFlightRef.current =
            false;

          if (
            mountedRef.current
          ) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      },
      [
        endpoint,
        normalizedPageSize,
        applySnapshot,
        cancelRequest,
        cancelRetry,
      ],
    );

  /**
   * ==========================================================================
   * Load More Notifications
   * ==========================================================================
   */

  const loadMore =
    useCallback(async () => {
      if (
        !mountedRef.current ||
        loadMoreInFlightRef.current ||
        !hasMore ||
        !nextCursor
      ) {
        return false;
      }

      if (
        typeof navigator !==
          'undefined' &&
        navigator.onLine ===
          false
      ) {
        setOnline(false);

        return false;
      }

      loadMoreInFlightRef.current =
        true;

      const controller =
        new AbortController();

      const previousController =
        abortRef.current;

      abortRef.current =
        controller;

      setLoadingMore(true);

      try {
        const response =
          await api.get(
            endpoint,
            {
              params: {
                limit:
                  normalizedPageSize,

                cursor:
                  nextCursor,
              },

              signal:
                controller.signal,
            },
          );

        if (
          !mountedRef.current
        ) {
          return false;
        }

        const payload =
          extractPayload(
            response,
          );

        const additional =
          normalizeNotifications(
            payload.items,
          );

        setNotifications(
          (previous) =>
            mergeNotifications(
              previous,
              additional,
            ),
        );

        setUnreadCount(
          (previous) =>
            Math.max(
              previous,
              calculateUnreadCount(
                additional,
              ),
            ),
        );

        if (
          Number.isFinite(
            payload.total,
          )
        ) {
          setTotal(
            Math.max(
              0,
              Number(
                payload.total,
              ),
            ),
          );
        }

        setNextCursor(
          payload.nextCursor ??
            null,
        );

        setHasMore(
          Boolean(
            payload.hasMore,
          ),
        );

        return true;
      } catch (err) {
        if (
          isCancellationError(
            err,
          )
        ) {
          return false;
        }

        if (
          mountedRef.current
        ) {
          setError({
            type:
              'NOTIFICATION_LOAD_MORE_ERROR',

            message:
              getErrorMessage(
                err,
              ),

            timestamp:
              new Date().toISOString(),

            cause: err,
          });
        }

        return false;
      } finally {
        if (
          abortRef.current ===
          controller
        ) {
          abortRef.current =
            previousController ??
            null;
        }

        loadMoreInFlightRef.current =
          false;

        if (
          mountedRef.current
        ) {
          setLoadingMore(
            false,
          );
        }
      }
    }, [
      endpoint,
      normalizedPageSize,
      hasMore,
      nextCursor,
    ]);

  /**
   * ==========================================================================
   * Refresh
   * ==========================================================================
   */

  const refresh =
    useCallback(() => {
      retryCountRef.current =
        0;

      cancelRetry();

      return loadNotifications(
        false,
      );
    }, [
      loadNotifications,
      cancelRetry,
    ]);

  /**
   * ==========================================================================
   * Mark Notification Read
   * ==========================================================================
   */

  const markAsRead =
    useCallback(
      async (
        notificationId,
      ) => {
        const id =
          notificationId ===
          null
            ? null
            : String(
                notificationId,
              );

        if (!id) {
          return false;
        }

        /**
         * Optimistic UI update.
         */
        let wasUnread =
          false;

        setNotifications(
          (previous) =>
            previous.map(
              (notification) => {
                if (
                  notification.id !==
                  id
                ) {
                  return notification;
                }

                if (
                  notification.read
                ) {
                  return notification;
                }

                wasUnread = true;

                return {
                  ...notification,
                  read: true,
                  isRead: true,
                  readAt:
                    new Date().toISOString(),
                };
              },
            ),
        );

        if (wasUnread) {
          setUnreadCount(
            (previous) =>
              Math.max(
                0,
                previous - 1,
              ),
          );
        }

        try {
          await api.patch(
            `${endpoint}/${encodeURIComponent(
              id,
            )}/read`,
          );

          return true;
        } catch (err) {
          /**
           * Reconcile authoritative state after a failed optimistic update.
           */
          await loadNotifications(
            true,
          ).catch(
            () => {},
          );

          if (
            mountedRef.current
          ) {
            setError({
              type:
                'NOTIFICATION_READ_ERROR',

              message:
                getErrorMessage(
                  err,
                ),

              timestamp:
                new Date().toISOString(),

              cause: err,
            });
          }

          return false;
        }
      },
      [
        endpoint,
        loadNotifications,
      ],
    );

  /**
   * ==========================================================================
   * Mark All Notifications Read
   * ==========================================================================
   */

  const markAllAsRead =
    useCallback(async () => {
      const previous =
        notifications;

      const previousUnread =
        unreadCount;

      /**
       * Optimistic update.
       */
      setNotifications(
        (current) =>
          current.map(
            (notification) => ({
              ...notification,
              read: true,
              isRead: true,
              readAt:
                notification.readAt ??
                new Date().toISOString(),
            }),
          ),
      );

      setUnreadCount(0);

      try {
        await api.patch(
          `${endpoint}/read-all`,
        );

        return true;
      } catch (err) {
        /**
         * Restore the previous state before authoritative reconciliation.
         */
        setNotifications(
          previous,
        );

        setUnreadCount(
          previousUnread,
        );

        await loadNotifications(
          true,
        ).catch(
          () => {},
        );

        if (
          mountedRef.current
        ) {
          setError({
            type:
              'NOTIFICATION_READ_ALL_ERROR',

            message:
              getErrorMessage(
                err,
              ),

            timestamp:
              new Date().toISOString(),

            cause: err,
          });
        }

        return false;
      }
    }, [
      endpoint,
      notifications,
      unreadCount,
      loadNotifications,
    ]);

  /**
   * ==========================================================================
   * Delete Notification
   * ==========================================================================
   */

  const removeNotification =
    useCallback(
      async (
        notificationId,
      ) => {
        const id =
          notificationId ===
          null
            ? null
            : String(
                notificationId,
              );

        if (!id) {
          return false;
        }

        let removed = null;

        setNotifications(
          (previous) => {
            removed =
              previous.find(
                (item) =>
                  item.id ===
                  id,
              ) ?? null;

            return previous.filter(
              (item) =>
                item.id !==
                id,
            );
          },
        );

        if (
          removed &&
          !removed.read
        ) {
          setUnreadCount(
            (previous) =>
              Math.max(
                0,
                previous - 1,
              ),
          );
        }

        setTotal(
          (previous) =>
            Math.max(
              0,
              previous - 1,
            ),
        );

        try {
          await api.delete(
            `${endpoint}/${encodeURIComponent(
              id,
            )}`,
          );

          return true;
        } catch (err) {
          /**
           * Reinsert the item if the backend deletion failed.
           */
          if (removed) {
            setNotifications(
              (previous) =>
                mergeNotifications(
                  [removed],
                  previous,
                ),
            );

            if (
              !removed.read
            ) {
              setUnreadCount(
                (previous) =>
                  previous + 1,
              );
            }

            setTotal(
              (previous) =>
                previous + 1,
            );
          }

          if (
            mountedRef.current
          ) {
            setError({
              type:
                'NOTIFICATION_DELETE_ERROR',

              message:
                getErrorMessage(
                  err,
                ),

              timestamp:
                new Date().toISOString(),

              cause: err,
            });
          }

          return false;
        }
      },
      [endpoint],
    );

  /**
   * ==========================================================================
   * Clear Local Notifications
   * ==========================================================================
   *
   * This clears the local UI state only.
   *
   * It does NOT imply deletion from the backend.
   * ==========================================================================
   */

  const clearLocal =
    useCallback(() => {
      setNotifications([]);
      setUnreadCount(0);
      setTotal(0);
      setNextCursor(null);
      setHasMore(false);
    }, []);

  /**
   * ==========================================================================
   * Realtime Socket Integration
   * ==========================================================================
   */

  useEffect(() => {
    if (!realtime) {
      setRealtimeConnected(
        false,
      );

      return undefined;
    }

    /**
     * ------------------------------------------------------------------------
     * New Notification
     * ------------------------------------------------------------------------
     */

    const handleNotification =
      (payload) => {
        if (
          !mountedRef.current ||
          !payload
        ) {
          return;
        }

        /**
         * Some backends emit:
         *
         * {
         *   notification: {...}
         * }
         *
         * while others emit the notification directly.
         */
        const candidate =
          payload.notification ??
          payload;

        const notification =
          normalizeNotification(
            candidate,
          );

        if (
          !notification
        ) {
          return;
        }

        setNotifications(
          (previous) => {
            const id =
              notification.id;

            const existing =
              previous.find(
                (item) =>
                  item.id ===
                  id,
              );

            /**
             * Ignore duplicate realtime events.
             */
            if (
              existing
            ) {
              return previous;
            }

            return [
              notification,
              ...previous,
            ].slice(
              0,
              MAX_NOTIFICATIONS,
            );
          },
        );

        /**
         * A newly received notification is unread unless explicitly marked
         * otherwise by the backend.
         */
        if (
          !notification.read
        ) {
          setUnreadCount(
            (previous) =>
              previous + 1,
          );
        }

        setTotal(
          (previous) =>
            previous + 1,
        );
      };

    /**
     * ------------------------------------------------------------------------
     * Notification Updated
     * ------------------------------------------------------------------------
     */

    const handleNotificationUpdate =
      (payload) => {
        const candidate =
          payload.notification ??
          payload;

        const notification =
          normalizeNotification(
            candidate,
          );

        if (
          !notification
        ) {
          return;
        }

        setNotifications(
          (previous) =>
            previous.map(
              (item) =>
                item.id ===
                notification.id
                  ? {
                      ...item,
                      ...notification,
                    }
                  : item,
            ),
        );

        setUnreadCount(
          calculateUnreadCount(
            notifications,
          ),
        );
      };

    /**
     * ------------------------------------------------------------------------
     * Notification Read Event
     * ------------------------------------------------------------------------
     */

    const handleNotificationRead =
      (payload) => {
        const id =
          getNotificationId(
            payload?.notification ??
              payload,
          );

        if (!id) {
          return;
        }

        setNotifications(
          (previous) =>
            previous.map(
              (notification) =>
                notification.id ===
                id
                  ? {
                      ...notification,
                      read: true,
                      isRead: true,
                      readAt:
                        notification.readAt ??
                        new Date().toISOString(),
                    }
                  : notification,
            ),
        );

        setUnreadCount(
          (previous) =>
            Math.max(
              0,
              previous - 1,
            ),
        );
      };

    /**
     * ------------------------------------------------------------------------
     * Socket Connection
     * ------------------------------------------------------------------------
     */

    const handleConnect =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setRealtimeConnected(
          true,
        );

        /**
         * Reconcile after reconnect to recover missed events.
         */
        loadNotifications(
          true,
        ).catch(
          () => {},
        );
      };

    const handleReconnect =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setRealtimeConnected(
          true,
        );

        loadNotifications(
          true,
        ).catch(
          () => {},
        );
      };

    const handleDisconnect =
      () => {
        if (
          mountedRef.current
        ) {
          setRealtimeConnected(
            false,
          );
        }
      };

    const handleConnectError =
      () => {
        if (
          mountedRef.current
        ) {
          setRealtimeConnected(
            false,
          );
        }
      };

    /**
     * ------------------------------------------------------------------------
     * Register Socket Events
     * ------------------------------------------------------------------------
     */

    socket.on(
      'notification',
      handleNotification,
    );

    socket.on(
      'notification:new',
      handleNotification,
    );

    socket.on(
      'notification:update',
      handleNotificationUpdate,
    );

    socket.on(
      'notification:read',
      handleNotificationRead,
    );

    socket.on(
      'connect',
      handleConnect,
    );

    socket.on(
      'reconnect',
      handleReconnect,
    );

    socket.on(
      'disconnect',
      handleDisconnect,
    );

    socket.on(
      'connect_error',
      handleConnectError,
    );

    /**
     * ------------------------------------------------------------------------
     * Cleanup
     * ------------------------------------------------------------------------
     */

    return () => {
      socket.off(
        'notification',
        handleNotification,
      );

      socket.off(
        'notification:new',
        handleNotification,
      );

      socket.off(
        'notification:update',
        handleNotificationUpdate,
      );

      socket.off(
        'notification:read',
        handleNotificationRead,
      );

      socket.off(
        'connect',
        handleConnect,
      );

      socket.off(
        'reconnect',
        handleReconnect,
      );

      socket.off(
        'disconnect',
        handleDisconnect,
      );

      socket.off(
        'connect_error',
        handleConnectError,
      );
    };
  }, [
    realtime,
    loadNotifications,
  ]);

  /**
   * ==========================================================================
   * Browser Connectivity
   * ==========================================================================
   */

  useEffect(() => {
    const handleOnline =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setOnline(true);

        retryCountRef.current =
          0;

        loadNotifications(
          true,
        ).catch(
          () => {},
        );
      };

    const handleOffline =
      () => {
        if (
          mountedRef.current
        ) {
          setOnline(false);
        }
      };

    window.addEventListener(
      'online',
      handleOnline,
    );

    window.addEventListener(
      'offline',
      handleOffline,
    );

    return () => {
      window.removeEventListener(
        'online',
        handleOnline,
      );

      window.removeEventListener(
        'offline',
        handleOffline,
      );
    };
  }, [
    loadNotifications,
  ]);

  /**
   * ==========================================================================
   * Initial Load / Unmount
   * ==========================================================================
   */

  useEffect(() => {
    mountedRef.current =
      true;

    retryCountRef.current =
      0;

    loadNotifications(
      false,
    ).catch(
      () => {},
    );

    return () => {
      mountedRef.current =
        false;

      ++requestGenerationRef.current;

      cancelRequest();

      cancelRetry();

      if (
        refreshTimerRef.current
      ) {
        clearTimeout(
          refreshTimerRef.current,
        );

        refreshTimerRef.current =
          null;
      }

      requestInFlightRef.current =
        false;

      loadMoreInFlightRef.current =
        false;
    };
  }, [
    loadNotifications,
    cancelRequest,
    cancelRetry,
  ]);

  /**
   * ==========================================================================
   * Automatic Refresh
   * ==========================================================================
   *
   * Recursive setTimeout prevents overlapping refresh requests.
   * ==========================================================================
   */

  useEffect(() => {
    if (
      refreshTimerRef.current
    ) {
      clearTimeout(
        refreshTimerRef.current,
      );

      refreshTimerRef.current =
        null;
    }

    if (
      !autoRefresh ||
      !mountedRef.current
    ) {
      return undefined;
    }

    const schedule =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        refreshTimerRef.current =
          setTimeout(
            async () => {
              refreshTimerRef.current =
                null;

              if (
                !mountedRef.current
              ) {
                return;
              }

              await loadNotifications(
                true,
              );

              schedule();
            },
            normalizedRefreshInterval,
          );
      };

    schedule();

    return () => {
      if (
        refreshTimerRef.current
      ) {
        clearTimeout(
          refreshTimerRef.current,
        );

        refreshTimerRef.current =
          null;
      }
    };
  }, [
    autoRefresh,
    normalizedRefreshInterval,
    loadNotifications,
  ]);

  /**
   * ==========================================================================
   * Derived State
   * ==========================================================================
   */

  const unreadNotifications =
    useMemo(
      () =>
        notifications.filter(
          (notification) =>
            !notification.read,
        ),
      [notifications],
    );

  const readNotifications =
    useMemo(
      () =>
        notifications.filter(
          (notification) =>
            notification.read,
        ),
      [notifications],
    );

  const hasUnread =
    unreadCount > 0;

  /**
   * ==========================================================================
   * Return
   * ==========================================================================
   */

  return {
    /**
     * Notification collection.
     */
    notifications,

    /**
     * Alias useful for components expecting items.
     */
    items:
      notifications,

    /**
     * Unread notification collection.
     */
    unreadNotifications,

    /**
     * Read notification collection.
     */
    readNotifications,

    /**
     * Number of unread notifications.
     */
    unreadCount,

    /**
     * Total number of notifications represented by the API.
     */
    total,

    /**
     * Pagination state.
     */
    nextCursor,

    hasMore,

    /**
     * Loading state.
     */
    loading,

    /**
     * Pagination loading state.
     */
    loadingMore,

    /**
     * Manual/background refresh state.
     */
    refreshing,

    /**
     * Structured error.
     */
    error,

    /**
     * Browser connectivity.
     */
    online,

    /**
     * Socket.IO connectivity.
     */
    realtimeConnected,

    /**
     * Convenience boolean.
     */
    hasUnread,

    /**
     * Initial/authoritative load.
     */
    loadNotifications,

    /**
     * Load the next notification page.
     */
    loadMore,

    /**
     * Manual refresh.
     */
    refresh,

    /**
     * Mark one notification as read.
     */
    markAsRead,

    /**
     * Mark all currently known notifications as read.
     */
    markAllAsRead,

    /**
     * Delete a notification from the backend.
     */
    removeNotification,

    /**
     * Clear local UI state only.
     */
    clearLocal,

    /**
     * Low-level state setter for advanced consumers.
     */
    setNotifications,

    /**
     * Low-level unread counter setter for advanced consumers.
     */
    setUnreadCount,
  };
}