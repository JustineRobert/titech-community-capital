'use strict';

/**
 * ============================================================================
 * TITech COMMUNITY CAPITAL LTD
 * ENTERPRISE DASHBOARD DATA HOOK
 * ============================================================================
 *
 * File:
 *   frontend/src/hooks/useDashboardData.js
 *
 * Purpose:
 *   Centralized enterprise dashboard data orchestration for the TITech
 *   Community Capital frontend.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 *   - Load dashboard groups.
 *   - Load administrative statistics.
 *   - Load optional executive intelligence.
 *   - Load optional fraud intelligence.
 *   - Load optional regulatory intelligence.
 *   - Load optional mobile-money intelligence.
 *   - Maintain dashboard state.
 *   - Support manual refresh.
 *   - Support automatic refresh.
 *   - Support realtime dashboard events.
 *   - Support browser online/offline transitions.
 *   - Protect against stale asynchronous responses.
 *   - Prevent state updates after component unmount.
 *   - Isolate optional endpoint failures.
 *   - Expose normalized dashboard metrics.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *                    TITech Frontend
 *                           │
 *                           ▼
 *                  useDashboardData()
 *                           │
 *             ┌─────────────┴─────────────┐
 *             │                           │
 *             ▼                           ▼
 *        REST / API                    Socket
 *             │                           │
 *             ▼                           ▼
 *       Authoritative                 Realtime
 *         snapshot                    events
 *             │                           │
 *             └─────────────┬─────────────┘
 *                           ▼
 *                    Dashboard State
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * The frontend dashboard is a presentation/orchestration layer.
 *
 * Financial balances, loan totals, fraud status, regulatory state, mobile
 * money settlement state, permissions and other sensitive business values
 * remain authoritative on the TITech backend.
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

const DEFAULT_REFRESH_INTERVAL =
  60 * 1000;

const MIN_REFRESH_INTERVAL =
  5 * 1000;

const MAX_REFRESH_INTERVAL =
  24 * 60 * 60 * 1000;

const MAX_NOTIFICATIONS =
  50;

const SOCKET_EVENTS =
  Object.freeze({
    DASHBOARD_UPDATE:
      'dashboard:update',

    NOTIFICATION:
      'notification',

    SYSTEM_HEALTH:
      'system:health',

    CONNECT:
      'connect',

    RECONNECT:
      'reconnect',

    DISCONNECT:
      'disconnect',

    CONNECT_ERROR:
      'connect_error',
  });

/**
 * ============================================================================
 * Default State
 * ============================================================================
 */

const DEFAULT_STATS =
  Object.freeze({
    savings: 0,
    members: 0,
    activeLoans: 0,
    totalDisbursed: 0,

    loans: [],

    fraud: [],

    mobileMoney: {},

    executive: {},

    regulatory: {},
  });

const DEFAULT_STATE =
  Object.freeze({
    groups: [],

    stats: DEFAULT_STATS,

    notifications: [],

    systemHealth: {},
  });

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

/**
 * Normalize an arbitrary value to an array.
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
 * Normalize an arbitrary value to an object.
 *
 * @param {unknown} value
 * @returns {Object}
 */
function normalizeObject(
  value,
) {
  if (
    value &&
    typeof value ===
      'object' &&
    !Array.isArray(value)
  ) {
    return value;
  }

  return {};
}

/**
 * Extract the useful API payload.
 *
 * Supports both:
 *
 *   api.get() -> response
 *
 * and:
 *
 *   response.data
 *
 * @param {unknown} response
 * @returns {unknown}
 */
function extractData(
  response,
) {
  return (
    response?.data ??
    response ??
    null
  );
}

/**
 * Normalize an error into a safe message.
 *
 * @param {unknown} error
 * @param {string} fallback
 * @returns {string}
 */
function getErrorMessage(
  error,
  fallback = 'Dashboard request failed.',
) {
  if (!error) {
    return fallback;
  }

  if (
    typeof error ===
      'string' &&
    error.trim()
  ) {
    return error;
  }

  if (
    typeof error.message ===
      'string' &&
    error.message.trim()
  ) {
    return error.message;
  }

  if (
    typeof error.response?.data
      ?.message === 'string'
  ) {
    return (
      error.response.data.message ||
      fallback
    );
  }

  return fallback;
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
  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric,
    )
  ) {
    return DEFAULT_REFRESH_INTERVAL;
  }

  return Math.min(
    MAX_REFRESH_INTERVAL,
    Math.max(
      MIN_REFRESH_INTERVAL,
      numeric,
    ),
  );
}

/**
 * Determine whether a promise-like operation succeeded.
 *
 * @param {PromiseSettledResult<unknown>} result
 * @returns {boolean}
 */
function isFulfilled(
  result,
) {
  return (
    result?.status ===
    'fulfilled'
  );
}

/**
 * ============================================================================
 * Hook
 * ============================================================================
 */

/**
 * useDashboardData
 *
 * @param {Object} options
 * @param {boolean} options.autoRefresh
 * @param {number} options.refreshInterval
 * @param {boolean} options.realtime
 * @param {boolean} options.isAdmin
 * @param {boolean} options.enableExecutive
 * @param {boolean} options.enableFraud
 * @param {boolean} options.enableRegulatory
 * @param {boolean} options.enableMobileMoney
 *
 * @returns {Object}
 */
export default function useDashboardData(
  options = {},
) {
  /**
   * ==========================================================================
   * Options
   * ==========================================================================
   */

  const {
    autoRefresh = true,

    refreshInterval:
      requestedRefreshInterval =
        DEFAULT_REFRESH_INTERVAL,

    realtime = true,

    isAdmin = false,

    enableExecutive = false,

    enableFraud = false,

    enableRegulatory = false,

    enableMobileMoney = false,
  } = options;

  const normalizedRefreshInterval =
    useMemo(
      () =>
        normalizeRefreshInterval(
          requestedRefreshInterval,
        ),
      [requestedRefreshInterval],
    );

  /**
   * ==========================================================================
   * State
   * ==========================================================================
   */

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState(null);

  const [
    lastUpdated,
    setLastUpdated,
  ] = useState(null);

  const [
    dashboard,
    setDashboard,
  ] = useState(() => ({
    groups:
      DEFAULT_STATE.groups,

    stats:
      DEFAULT_STATE.stats,

    notifications:
      DEFAULT_STATE.notifications,

    systemHealth:
      DEFAULT_STATE.systemHealth,
  }));

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

  /**
   * Monotonically increasing request generation.
   *
   * Any response belonging to an older generation is ignored.
   */
  const requestGenerationRef =
    useRef(0);

  /**
   * Tracks the currently executing dashboard load.
   */
  const requestInFlightRef =
    useRef(false);

  /**
   * Tracks the refresh timer.
   */
  const refreshTimerRef =
    useRef(null);

  /**
   * ==========================================================================
   * Fetchers
   * ==========================================================================
   */

  const fetchGroups =
    useCallback(
      async () => {
        const response =
          await api.get(
            '/api/groups',
          );

        return normalizeArray(
          extractData(
            response,
          ),
        );
      },
      [],
    );

  const fetchStats =
    useCallback(
      async () => {
        if (!isAdmin) {
          return {};
        }

        const response =
          await api.get(
            '/api/admin/stats',
          );

        return normalizeObject(
          extractData(
            response,
          ),
        );
      },
      [isAdmin],
    );

  const fetchExecutive =
    useCallback(
      async () => {
        if (
          !enableExecutive
        ) {
          return {};
        }

        try {
          const response =
            await api.get(
              '/api/executive/dashboard',
            );

          return normalizeObject(
            extractData(
              response,
            ),
          );
        } catch {
          /**
           * Executive intelligence is optional and must not prevent the
           * core dashboard from loading.
           */
          return {};
        }
      },
      [enableExecutive],
    );

  const fetchFraud =
    useCallback(
      async () => {
        if (!enableFraud) {
          return [];
        }

        try {
          const response =
            await api.get(
              '/api/fraud/stats',
            );

          return normalizeArray(
            extractData(
              response,
            ),
          );
        } catch {
          /**
           * Fraud dashboard enrichment is isolated from core dashboard
           * availability.
           */
          return [];
        }
      },
      [enableFraud],
    );

  const fetchRegulatory =
    useCallback(
      async () => {
        if (
          !enableRegulatory
        ) {
          return {};
        }

        try {
          const response =
            await api.get(
              '/api/regulatory/dashboard',
            );

          return normalizeObject(
            extractData(
              response,
            ),
          );
        } catch {
          return {};
        }
      },
      [enableRegulatory],
    );

  const fetchMobileMoney =
    useCallback(
      async () => {
        if (
          !enableMobileMoney
        ) {
          return {};
        }

        try {
          const response =
            await api.get(
              '/api/mobile-money/dashboard',
            );

          return normalizeObject(
            extractData(
              response,
            ),
          );
        } catch {
          return {};
        }
      },
      [enableMobileMoney],
    );

  /**
   * ==========================================================================
   * Dashboard Loader
   * ==========================================================================
   */

  const loadDashboard =
    useCallback(
      async (
        silent = false,
      ) => {
        /**
         * Do not start overlapping refreshes.
         *
         * This is especially important when:
         *
         *   - auto-refresh fires
         *   - the user manually refreshes
         *   - socket reconnect triggers reconciliation
         *   - browser returns online
         */
        if (
          requestInFlightRef.current
        ) {
          return false;
        }

        if (
          !mountedRef.current
        ) {
          return false;
        }

        requestInFlightRef.current =
          true;

        const generation =
          ++requestGenerationRef.current;

        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError(null);

        try {
          /**
           * Promise.allSettled prevents optional dashboard modules from
           * taking down the entire dashboard when one endpoint fails.
           *
           * Core endpoint failures are still surfaced below.
           */
          const results =
            await Promise.allSettled(
              [
                fetchGroups(),

                fetchStats(),

                fetchExecutive(),

                fetchFraud(),

                fetchRegulatory(),

                fetchMobileMoney(),
              ],
            );

          /**
           * Ignore results from a stale request.
           */
          if (
            !mountedRef.current ||
            generation !==
              requestGenerationRef.current
          ) {
            return false;
          }

          const [
            groupsResult,
            statsResult,
            executiveResult,
            fraudResult,
            regulatoryResult,
            mobileMoneyResult,
          ] = results;

          /**
           * --------------------------------------------------------------------
           * Core endpoint validation
           * --------------------------------------------------------------------
           *
           * Groups are a core dashboard resource.
           */
          if (
            !isFulfilled(
              groupsResult,
            )
          ) {
            throw (
              groupsResult?.reason ||
              new Error(
                'Unable to load dashboard groups.',
              )
            );
          }

          /**
           * Administrative statistics are required only when the current
           * consumer has administrative dashboard access.
           */
          if (
            isAdmin &&
            !isFulfilled(
              statsResult,
            )
          ) {
            throw (
              statsResult?.reason ||
              new Error(
                'Unable to load administrative dashboard statistics.',
              )
            );
          }

          /**
           * --------------------------------------------------------------------
           * Normalize successful results
           * --------------------------------------------------------------------
           */

          const groups =
            normalizeArray(
              groupsResult.value,
            );

          const stats =
            isFulfilled(
              statsResult,
            )
              ? normalizeObject(
                  statsResult.value,
                )
              : {};

          const executive =
            isFulfilled(
              executiveResult,
            )
              ? normalizeObject(
                  executiveResult.value,
                )
              : {};

          const fraud =
            isFulfilled(
              fraudResult,
            )
              ? normalizeArray(
                  fraudResult.value,
                )
              : [];

          const regulatory =
            isFulfilled(
              regulatoryResult,
            )
              ? normalizeObject(
                  regulatoryResult.value,
                )
              : {};

          const mobileMoney =
            isFulfilled(
              mobileMoneyResult,
            )
              ? normalizeObject(
                  mobileMoneyResult.value,
                )
              : {};

          /**
           * --------------------------------------------------------------------
           * Preserve realtime state
           * --------------------------------------------------------------------
           *
           * Functional state update prevents stale closure problems.
           */
          setDashboard(
            (previous) => ({
              groups,

              stats: {
                ...DEFAULT_STATS,
                ...previous.stats,
                ...stats,

                executive,

                fraud,

                regulatory,

                mobileMoney,
              },

              /**
               * REST dashboard refresh must not destroy realtime notifications.
               */
              notifications:
                previous.notifications,

              /**
               * Do not overwrite a newer realtime health event with an older
               * REST response.
               */
              systemHealth:
                previous.systemHealth,
            }),
          );

          setLastUpdated(
            new Date(),
          );

          /**
           * Optional endpoint degradation is useful operational information,
           * but does not invalidate the dashboard.
           */
          const optionalFailures =
            [];

          if (
            enableExecutive &&
            !isFulfilled(
              executiveResult,
            )
          ) {
            optionalFailures.push(
              'executive',
            );
          }

          if (
            enableFraud &&
            !isFulfilled(
              fraudResult,
            )
          ) {
            optionalFailures.push(
              'fraud',
            );
          }

          if (
            enableRegulatory &&
            !isFulfilled(
              regulatoryResult,
            )
          ) {
            optionalFailures.push(
              'regulatory',
            );
          }

          if (
            enableMobileMoney &&
            !isFulfilled(
              mobileMoneyResult,
            )
          ) {
            optionalFailures.push(
              'mobile-money',
            );
          }

          if (
            optionalFailures.length >
            0
          ) {
            setError({
              type:
                'PARTIAL_DASHBOARD_FAILURE',

              message:
                'Some dashboard modules are temporarily unavailable.',

              modules:
                optionalFailures,
            });
          } else {
            setError(null);
          }

          return true;
        } catch (err) {
          /**
           * Ignore stale request failures.
           */
          if (
            !mountedRef.current ||
            generation !==
              requestGenerationRef.current
          ) {
            return false;
          }

          console.error(
            '[TITech Dashboard] Failed to load dashboard:',
            err,
          );

          setError({
            type:
              'DASHBOARD_LOAD_ERROR',

            message:
              getErrorMessage(
                err,
                'Failed to load dashboard data.',
              ),

            cause: err,
          });

          return false;
        } finally {
          requestInFlightRef.current =
            false;

          if (
            !mountedRef.current
          ) {
            return;
          }

          setLoading(false);
          setRefreshing(false);
        }
      },
      [
        fetchGroups,
        fetchStats,
        fetchExecutive,
        fetchFraud,
        fetchRegulatory,
        fetchMobileMoney,
        isAdmin,
        enableExecutive,
        enableFraud,
        enableRegulatory,
        enableMobileMoney,
      ],
    );

  /**
   * ==========================================================================
   * Manual Refresh
   * ==========================================================================
   */

  const refresh =
    useCallback(
      () =>
        loadDashboard(true),
      [loadDashboard],
    );

  /**
   * ==========================================================================
   * Clear Error
   * ==========================================================================
   */

  const clearError =
    useCallback(() => {
      setError(null);
    }, []);

  /**
   * ==========================================================================
   * Realtime Events
   * ==========================================================================
   */

  useEffect(() => {
    if (!realtime) {
      setRealtimeConnected(false);

      return undefined;
    }

    /**
     * ------------------------------------------------------------------------
     * Dashboard Update
     * ------------------------------------------------------------------------
     *
     * The server may publish partial statistics. Merge rather than replace.
     */
    const handleDashboardUpdate =
      (payload) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        const update =
          normalizeObject(
            payload,
          );

        setDashboard(
          (previous) => ({
            ...previous,

            stats: {
              ...previous.stats,
              ...update,
            },
          }),
        );

        setLastUpdated(
          new Date(),
        );
      };

    /**
     * ------------------------------------------------------------------------
     * Notification
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

        setDashboard(
          (previous) => {
            /**
             * Protect against duplicate realtime delivery where a transport
             * retries the same event.
             */
            const notificationId =
              payload._id ??
              payload.id ??
              payload.notificationId;

            if (
              notificationId
            ) {
              const alreadyExists =
                previous.notifications.some(
                  (
                    notification,
                  ) =>
                    String(
                      notification._id ??
                        notification.id ??
                        notification.notificationId,
                    ) ===
                    String(
                      notificationId,
                    ),
                );

              if (
                alreadyExists
              ) {
                return previous;
              }
            }

            return {
              ...previous,

              notifications: [
                payload,
                ...previous.notifications,
              ].slice(
                0,
                MAX_NOTIFICATIONS,
              ),
            };
          },
        );
      };

    /**
     * ------------------------------------------------------------------------
     * System Health
     * ------------------------------------------------------------------------
     */

    const handleSystemHealth =
      (payload) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setDashboard(
          (previous) => ({
            ...previous,

            systemHealth:
              normalizeObject(
                payload,
              ),
          }),
        );

        setLastUpdated(
          new Date(),
        );
      };

    /**
     * ------------------------------------------------------------------------
     * Socket Connected
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
         * Socket reconnection can mean that dashboard events were missed.
         * Reconcile against the authoritative REST snapshot.
         */
        loadDashboard(true).catch(
          () => {},
        );
      };

    /**
     * ------------------------------------------------------------------------
     * Socket Reconnected
     * ------------------------------------------------------------------------
     */

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

        loadDashboard(true).catch(
          () => {},
        );
      };

    /**
     * ------------------------------------------------------------------------
     * Socket Disconnected
     * ------------------------------------------------------------------------
     */

    const handleDisconnect =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setRealtimeConnected(
          false,
        );
      };

    /**
     * ------------------------------------------------------------------------
     * Socket Connection Error
     * ------------------------------------------------------------------------
     */

    const handleConnectError =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setRealtimeConnected(
          false,
        );
      };

    /**
     * ------------------------------------------------------------------------
     * Register
     * ------------------------------------------------------------------------
     */

    socket.on(
      SOCKET_EVENTS.DASHBOARD_UPDATE,
      handleDashboardUpdate,
    );

    socket.on(
      SOCKET_EVENTS.NOTIFICATION,
      handleNotification,
    );

    socket.on(
      SOCKET_EVENTS.SYSTEM_HEALTH,
      handleSystemHealth,
    );

    socket.on(
      SOCKET_EVENTS.CONNECT,
      handleConnect,
    );

    socket.on(
      SOCKET_EVENTS.RECONNECT,
      handleReconnect,
    );

    socket.on(
      SOCKET_EVENTS.DISCONNECT,
      handleDisconnect,
    );

    socket.on(
      SOCKET_EVENTS.CONNECT_ERROR,
      handleConnectError,
    );

    /**
     * ------------------------------------------------------------------------
     * Cleanup
     * ------------------------------------------------------------------------
     */

    return () => {
      socket.off(
        SOCKET_EVENTS.DASHBOARD_UPDATE,
        handleDashboardUpdate,
      );

      socket.off(
        SOCKET_EVENTS.NOTIFICATION,
        handleNotification,
      );

      socket.off(
        SOCKET_EVENTS.SYSTEM_HEALTH,
        handleSystemHealth,
      );

      socket.off(
        SOCKET_EVENTS.CONNECT,
        handleConnect,
      );

      socket.off(
        SOCKET_EVENTS.RECONNECT,
        handleReconnect,
      );

      socket.off(
        SOCKET_EVENTS.DISCONNECT,
        handleDisconnect,
      );

      socket.off(
        SOCKET_EVENTS.CONNECT_ERROR,
        handleConnectError,
      );
    };
  }, [
    realtime,
    loadDashboard,
  ]);

  /**
   * ==========================================================================
   * Browser Online / Offline Lifecycle
   * ==========================================================================
   */

  useEffect(() => {
    mountedRef.current = true;

    const handleOnline =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setOnline(true);

        /**
         * Reconcile after connectivity recovery.
         */
        loadDashboard(true).catch(
          () => {},
        );
      };

    const handleOffline =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setOnline(false);
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
  }, [loadDashboard]);

  /**
   * ==========================================================================
   * Initial Load
   * ==========================================================================
   */

  useEffect(() => {
    mountedRef.current = true;

    loadDashboard(false).catch(
      () => {},
    );

    return () => {
      mountedRef.current = false;

      /**
       * Invalidate all outstanding asynchronous work.
       */
      ++requestGenerationRef.current;

      /**
       * Clear automatic refresh timer.
       */
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
  }, [loadDashboard]);

  /**
   * ==========================================================================
   * Auto Refresh
   * ==========================================================================
   *
   * setTimeout is deliberately preferred over setInterval.
   *
   * This prevents multiple refresh cycles from stacking when an API request
   * takes longer than the configured interval.
   * ==========================================================================
   */

  useEffect(() => {
    /**
     * Always clear an existing timer before configuring a new one.
     */
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

    const scheduleNextRefresh =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        refreshTimerRef.current =
          setTimeout(
            async () => {
              if (
                !mountedRef.current
              ) {
                return;
              }

              await loadDashboard(
                true,
              );

              /**
               * Schedule the next refresh only after the current refresh has
               * completed.
               */
              scheduleNextRefresh();
            },
            normalizedRefreshInterval,
          );
      };

    scheduleNextRefresh();

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
    loadDashboard,
  ]);

  /**
   * ==========================================================================
   * Derived Metrics
   * ==========================================================================
   */

  const metrics =
    useMemo(() => {
      const savings =
        Number(
          dashboard.stats
            ?.savings,
        ) || 0;

      const members =
        Number(
          dashboard.stats
            ?.members,
        ) || 0;

      const activeLoans =
        Number(
          dashboard.stats
            ?.activeLoans,
        ) || 0;

      const totalDisbursed =
        Number(
          dashboard.stats
            ?.totalDisbursed,
        ) || 0;

      return {
        totalGroups:
          dashboard.groups
            .length,

        totalMembers:
          members,

        totalSavings:
          savings,

        activeLoans:
          activeLoans,

        totalDisbursed:
          totalDisbursed,
      };
    }, [
      dashboard.groups,
      dashboard.stats,
    ]);

  /**
   * ==========================================================================
   * Return
   * ==========================================================================
   */

  return {
    /**
     * Initial dashboard loading state.
     */
    loading,

    /**
     * Background/manual refresh state.
     */
    refreshing,

    /**
     * Dashboard error.
     */
    error,

    /**
     * Last successful authoritative/realtime update.
     */
    lastUpdated,

    /**
     * Browser connectivity state.
     */
    online,

    /**
     * Socket realtime connectivity.
     */
    realtimeConnected,

    /**
     * Dashboard group collection.
     */
    groups:
      dashboard.groups,

    /**
     * Dashboard statistics.
     */
    stats:
      dashboard.stats,

    /**
     * Realtime notifications.
     */
    notifications:
      dashboard.notifications,

    /**
     * Current system health snapshot.
     */
    systemHealth:
      dashboard.systemHealth,

    /**
     * Derived high-level metrics.
     */
    metrics,

    /**
     * Manual refresh.
     */
    refresh,

    /**
     * Backwards-compatible reload alias.
     */
    reload:
      loadDashboard,

    /**
     * Clear dashboard error.
     */
    clearError,
  };
}