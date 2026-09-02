'use strict';

/**
 * ============================================================================
 * TITech COMMUNITY CAPITAL LTD
 * ENTERPRISE DASHBOARD METRICS HOOK
 * ============================================================================
 *
 * File:
 *   frontend/src/hooks/useDashboardMetrics.js
 *
 * Purpose:
 *   Centralized, production-grade dashboard KPI orchestration for the TITech
 *   Community Capital frontend.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 *   - Retrieve authoritative dashboard metrics from the TITech API.
 *   - Maintain normalized financial and operational KPIs.
 *   - Support automatic background refresh.
 *   - Support manual refresh.
 *   - Support request cancellation.
 *   - Prevent stale asynchronous responses.
 *   - Provide bounded retry/recovery.
 *   - Integrate realtime Socket.IO metric updates.
 *   - Reconcile after reconnect/network recovery.
 *   - Preserve dashboard state during transient failures.
 *   - Provide derived financial/system health indicators.
 *   - Provide Uganda-friendly currency/number formatting.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *                    TITech Dashboard
 *                           │
 *             ┌─────────────┴─────────────┐
 *             │                           │
 *             ▼                           ▼
 *         REST API                    Socket.IO
 *             │                           │
 *       Authoritative                 Realtime
 *         snapshot                     events
 *             │                           │
 *             └─────────────┬─────────────┘
 *                           ▼
 *                useDashboardMetrics()
 *                           │
 *             ┌─────────────┴─────────────┐
 *             ▼                           ▼
 *        KPI State                  Derived KPIs
 *             │                           │
 *             └─────────────┬─────────────┘
 *                           ▼
 *                       Dashboard UI
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * Dashboard metrics are presentation data.
 *
 * The backend remains authoritative for:
 *   - balances
 *   - ledger totals
 *   - loan state
 *   - transaction state
 *   - settlement state
 *   - fraud decisions
 *   - regulatory status
 *   - treasury state
 *
 * The frontend must never be treated as the financial system of record.
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Dependencies
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

const MAX_RETRIES = 3;

const BASE_RETRY_DELAY =
  2000;

const MAX_RETRY_DELAY =
  30 * 1000;

const MAX_NOTIFICATIONS =
  50;

/**
 * ============================================================================
 * Default Metrics
 * ============================================================================
 */

const DEFAULT_METRICS =
  Object.freeze({
    members: {
      total: 0,
      active: 0,
      inactive: 0,
      growth: 0,
    },

    savings: {
      total: 0,
      monthly: 0,
      growth: 0,
    },

    loans: {
      active: 0,
      disbursed: 0,
      overdue: 0,
      repaid: 0,
      growth: 0,
    },

    transactions: {
      total: 0,
      today: 0,
      volume: 0,
    },

    groups: {
      total: 0,
      active: 0,
    },

    mobileMoney: {
      collections: 0,
      settlements: 0,
    },

    treasury: {
      balance: 0,
      liquidityRatio: 0,
    },

    fraud: {
      flagged: 0,
      riskScore: 0,
    },

    system: {
      activeUsers: 0,
      onlineUsers: 0,
    },

    charts: {
      savings: [],
      loans: [],
      members: [],
      transactions: [],
    },

    lastUpdated: null,
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
 * Safely normalize an object.
 *
 * @param {unknown} value
 * @returns {Object}
 */
function normalizeObject(
  value,
) {
  return isObject(value)
    ? value
    : {};
}

/**
 * Safely normalize an array.
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
 * Convert a potentially unsafe numeric value to a finite number.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function toNumber(
  value,
  fallback = 0,
) {
  const number =
    Number(value);

  return Number.isFinite(
    number,
  )
    ? number
    : fallback;
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
 * Determine whether an error is caused by request cancellation.
 *
 * Supports Axios cancellation as well as AbortController DOM exceptions.
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
 * Extract a useful API error message.
 *
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(
  error,
) {
  if (
    typeof error ===
      'string' &&
    error.trim()
  ) {
    return error;
  }

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

  return (
    'Failed to load dashboard metrics.'
  );
}

/**
 * Extract API payload.
 *
 * Supports:
 *
 *   response.data
 *
 * and:
 *
 *   response
 *
 * @param {unknown} response
 * @returns {Object}
 */
function extractPayload(
  response,
) {
  const data =
    response?.data ??
    response ??
    {};

  /**
   * Some API clients return:
   *
   * {
   *   data: {
   *     metrics: {...}
   *   }
   * }
   *
   * while others return the metric object directly.
   */
  if (
    isObject(data?.metrics)
  ) {
    return normalizeObject(
      data.metrics,
    );
  }

  return normalizeObject(
    data,
  );
}

/**
 * Safely merge nested dashboard metrics.
 *
 * This avoids the original implementation's shallow merge problem where:
 *
 *   members.total
 *
 * could unintentionally replace:
 *
 *   members.active / inactive / growth
 *
 * when a realtime event contains only one nested property.
 *
 * @param {Object} previous
 * @param {Object} incoming
 * @returns {Object}
 */
function mergeMetrics(
  previous,
  incoming,
) {
  const source =
    normalizeObject(
      incoming,
    );

  return {
    ...DEFAULT_METRICS,

    ...previous,

    ...source,

    members: {
      ...DEFAULT_METRICS.members,
      ...previous?.members,
      ...source.members,
    },

    savings: {
      ...DEFAULT_METRICS.savings,
      ...previous?.savings,
      ...source.savings,
    },

    loans: {
      ...DEFAULT_METRICS.loans,
      ...previous?.loans,
      ...source.loans,
    },

    transactions: {
      ...DEFAULT_METRICS.transactions,
      ...previous?.transactions,
      ...source.transactions,
    },

    groups: {
      ...DEFAULT_METRICS.groups,
      ...previous?.groups,
      ...source.groups,
    },

    mobileMoney: {
      ...DEFAULT_METRICS.mobileMoney,
      ...previous?.mobileMoney,
      ...source.mobileMoney,
    },

    treasury: {
      ...DEFAULT_METRICS.treasury,
      ...previous?.treasury,
      ...source.treasury,
    },

    fraud: {
      ...DEFAULT_METRICS.fraud,
      ...previous?.fraud,
      ...source.fraud,
    },

    system: {
      ...DEFAULT_METRICS.system,
      ...previous?.system,
      ...source.system,
    },

    charts: {
      ...DEFAULT_METRICS.charts,
      ...previous?.charts,
      ...source.charts,

      savings:
        source.charts?.savings ??
        previous?.charts?.savings ??
        [],

      loans:
        source.charts?.loans ??
        previous?.charts?.loans ??
        [],

      members:
        source.charts?.members ??
        previous?.charts?.members ??
        [],

      transactions:
        source.charts?.transactions ??
        previous?.charts?.transactions ??
        [],
    },
  };
}

/**
 * ============================================================================
 * Currency Formatter
 * ============================================================================
 */

/**
 * Format monetary values.
 *
 * Defaults to UGX because TITech Community Capital is Uganda-focused.
 *
 * @param {number|string} amount
 * @param {string} currency
 * @returns {string}
 */
export function formatCurrency(
  amount,
  currency = 'UGX',
) {
  const safeCurrency =
    typeof currency ===
      'string' &&
    currency.trim()
      ? currency
      : 'UGX';

  try {
    return new Intl.NumberFormat(
      'en-UG',
      {
        style: 'currency',
        currency:
          safeCurrency,
        maximumFractionDigits: 0,
      },
    ).format(
      toNumber(amount),
    );
  } catch {
    return `${safeCurrency} ${toNumber(
      amount,
    ).toLocaleString(
      'en-UG',
    )}`;
  }
}

/**
 * ============================================================================
 * Number Formatter
 * ============================================================================
 */

/**
 * Format numbers using the Uganda locale.
 *
 * @param {number|string} value
 * @returns {string}
 */
export function formatNumber(
  value,
) {
  try {
    return new Intl.NumberFormat(
      'en-UG',
    ).format(
      toNumber(value),
    );
  } catch {
    return String(
      toNumber(value),
    );
  }
}

/**
 * ============================================================================
 * Hook
 * ============================================================================
 */

/**
 * useDashboardMetrics
 *
 * @param {Object} options
 * @param {number} options.refreshInterval
 * @param {boolean} options.autoRefresh
 * @param {boolean} options.realtime
 * @param {string} options.endpoint
 *
 * @returns {Object}
 */
export default function useDashboardMetrics(
  options = {},
) {
  const {
    refreshInterval:
      requestedRefreshInterval =
        DEFAULT_REFRESH_INTERVAL,

    autoRefresh = true,

    realtime = true,

    endpoint =
      '/api/dashboard/metrics',
  } = options;

  /**
   * ==========================================================================
   * Normalized Configuration
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

  /**
   * ==========================================================================
   * State
   * ==========================================================================
   */

  const [
    metrics,
    setMetrics,
  ] = useState(() => ({
    ...DEFAULT_METRICS,
  }));

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

  const timerRef =
    useRef(null);

  const retryTimerRef =
    useRef(null);

  const abortRef =
    useRef(null);

  /**
   * Monotonically increasing request generation.
   *
   * Prevents older responses from replacing newer state.
   */
  const requestGenerationRef =
    useRef(0);

  const requestInFlightRef =
    useRef(false);

  const retryCountRef =
    useRef(0);

  /**
   * ==========================================================================
   * Cancel Pending Retry
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
   * Cancel Active Request
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
   * Fetch Metrics
   * ==========================================================================
   */

  const fetchMetrics =
    useCallback(
      async (
        silent = false,
        internalRetry = false,
      ) => {
        if (
          !mountedRef.current
        ) {
          return false;
        }

        /**
         * Avoid overlapping requests.
         *
         * A manual refresh cannot corrupt an existing request, and the
         * automatic refresh loop cannot create request storms.
         */
        if (
          requestInFlightRef.current
        ) {
          return false;
        }

        /**
         * Do not deliberately hit the network while offline.
         */
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

        /**
         * A new request invalidates any older cancellation controller.
         */
        cancelRequest();

        const controller =
          new AbortController();

        abortRef.current =
          controller;

        if (!silent) {
          setRefreshing(true);
        }

        if (!internalRetry) {
          setError(null);
        }

        try {
          const response =
            await api.get(
              endpoint,
              {
                signal:
                  controller.signal,
              },
            );

          /**
           * Ignore stale responses.
           */
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

          setMetrics(
            (previous) =>
              mergeMetrics(
                previous,
                {
                  ...payload,

                  lastUpdated:
                    new Date().toISOString(),
                },
              ),
          );

          retryCountRef.current =
            0;

          setError(null);

          setOnline(true);

          return true;
        } catch (err) {
          /**
           * Cancellation is not a user-facing dashboard error.
           */
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
              'DASHBOARD_METRICS_ERROR',

            message,

            retryCount:
              retryCountRef.current,

            timestamp:
              new Date().toISOString(),

            cause: err,
          });

          /**
           * --------------------------------------------------------------------
           * Bounded exponential retry
           * --------------------------------------------------------------------
           *
           * 2s
           * 4s
           * 8s
           *
           * capped by MAX_RETRY_DELAY.
           */
          if (
            retryCountRef.current <
            MAX_RETRIES
          ) {
            retryCountRef.current +=
              1;

            const retryDelay =
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

                  fetchMetrics(
                    true,
                    true,
                  ).catch(
                    () => {},
                  );
                },
                retryDelay,
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
        cancelRequest,
        cancelRetry,
      ],
    );

  /**
   * ==========================================================================
   * Manual Refresh
   * ==========================================================================
   */

  const refresh =
    useCallback(() => {
      /**
       * Manual refresh starts a fresh retry cycle.
       */
      retryCountRef.current =
        0;

      cancelRetry();

      return fetchMetrics(
        false,
        false,
      );
    }, [
      fetchMetrics,
      cancelRetry,
    ]);

  /**
   * ==========================================================================
   * Update Metric
   * ==========================================================================
   */

  const updateMetric =
    useCallback(
      (
        key,
        value,
      ) => {
        if (
          typeof key !==
            'string' ||
          !key.trim()
        ) {
          return;
        }

        setMetrics(
          (previous) => {
            const previousValue =
              previous[key];

            const nextValue =
              typeof value ===
              'function'
                ? value(
                    previousValue,
                  )
                : value;

            /**
             * Nested metric objects are merged rather than replaced.
             */
            if (
              isObject(
                previousValue,
              ) &&
              isObject(
                nextValue,
              )
            ) {
              return {
                ...previous,

                [key]: {
                  ...previousValue,
                  ...nextValue,
                },
              };
            }

            return {
              ...previous,

              [key]:
                nextValue,
            };
          },
        );
      },
      [],
    );

  /**
   * ==========================================================================
   * Realtime Metrics
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
     * Generic Metrics Update
     * ------------------------------------------------------------------------
     */

    const handleMetrics =
      (payload) => {
        if (
          !mountedRef.current ||
          !payload
        ) {
          return;
        }

        const normalized =
          extractPayload(
            payload,
          );

        setMetrics(
          (previous) =>
            mergeMetrics(
              previous,
              {
                ...normalized,

                lastUpdated:
                  new Date().toISOString(),
              },
            ),
        );
      };

    /**
     * ------------------------------------------------------------------------
     * Transaction Created
     * ------------------------------------------------------------------------
     *
     * IMPORTANT:
     * Realtime transaction events are useful for responsiveness, but the
     * backend remains authoritative. The next REST reconciliation refresh
     * corrects any missed/duplicated transport event.
     */
    const handleTransaction =
      (transaction) => {
        if (
          !mountedRef.current ||
          !transaction
        ) {
          return;
        }

        const amount =
          toNumber(
            transaction.amount,
          );

        setMetrics(
          (previous) => ({
            ...previous,

            transactions: {
              ...previous.transactions,

              today:
                toNumber(
                  previous
                    .transactions
                    ?.today,
                ) + 1,

              total:
                toNumber(
                  previous
                    .transactions
                    ?.total,
                ) + 1,

              volume:
                toNumber(
                  previous
                    .transactions
                    ?.volume,
                ) + amount,
            },

            lastUpdated:
              new Date().toISOString(),
          }),
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
         * Reconcile because events may have been missed during disconnect.
         */
        fetchMetrics(
          true,
          false,
        ).catch(
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

        fetchMetrics(
          true,
          false,
        ).catch(
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
     * Register Events
     * ------------------------------------------------------------------------
     */

    socket.on(
      'dashboard:metrics',
      handleMetrics,
    );

    socket.on(
      'dashboard:update',
      handleMetrics,
    );

    socket.on(
      'transaction:created',
      handleTransaction,
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
        'dashboard:metrics',
        handleMetrics,
      );

      socket.off(
        'dashboard:update',
        handleMetrics,
      );

      socket.off(
        'transaction:created',
        handleTransaction,
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
    fetchMetrics,
  ]);

  /**
   * ==========================================================================
   * Browser Connectivity
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
         * Reconcile dashboard state after network recovery.
         */
        retryCountRef.current =
          0;

        fetchMetrics(
          true,
          false,
        ).catch(
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
  }, [fetchMetrics]);

  /**
   * ==========================================================================
   * Initial Load / Unmount
   * ==========================================================================
   */

  useEffect(() => {
    mountedRef.current = true;

    retryCountRef.current =
      0;

    fetchMetrics(
      false,
      false,
    ).catch(
      () => {},
    );

    return () => {
      mountedRef.current =
        false;

      /**
       * Invalidate all in-flight responses.
       */
      ++requestGenerationRef.current;

      /**
       * Cancel active HTTP request.
       */
      cancelRequest();

      /**
       * Cancel pending retry.
       */
      cancelRetry();

      /**
       * Cancel refresh timer.
       */
      if (
        timerRef.current
      ) {
        clearTimeout(
          timerRef.current,
        );

        timerRef.current =
          null;
      }

      requestInFlightRef.current =
        false;
    };
  }, [
    fetchMetrics,
    cancelRequest,
    cancelRetry,
  ]);

  /**
   * ==========================================================================
   * Auto Refresh
   * ==========================================================================
   *
   * Recursive setTimeout is intentionally used instead of setInterval.
   *
   * This ensures:
   *
   *   request
   *      ↓
   *   completion
   *      ↓
   *   next timer
   *      ↓
   *   request
   *
   * rather than allowing multiple dashboard requests to overlap.
   * ==========================================================================
   */

  useEffect(() => {
    if (
      timerRef.current
    ) {
      clearTimeout(
        timerRef.current,
      );

      timerRef.current =
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

        timerRef.current =
          setTimeout(
            async () => {
              timerRef.current =
                null;

              if (
                !mountedRef.current
              ) {
                return;
              }

              /**
               * Background refresh.
               */
              await fetchMetrics(
                true,
                false,
              );

              /**
               * Schedule only after the previous operation completes.
               */
              schedule();
            },
            normalizedRefreshInterval,
          );
      };

    schedule();

    return () => {
      if (
        timerRef.current
      ) {
        clearTimeout(
          timerRef.current,
        );

        timerRef.current =
          null;
      }
    };
  }, [
    autoRefresh,
    normalizedRefreshInterval,
    fetchMetrics,
  ]);

  /**
   * ==========================================================================
   * Derived Health Metrics
   * ==========================================================================
   */

  const health =
    useMemo(() => {
      const overdue =
        toNumber(
          metrics.loans
            ?.overdue,
        );

      const activeLoans =
        toNumber(
          metrics.loans
            ?.active,
        );

      const riskScore =
        Math.min(
          100,
          Math.max(
            0,
            toNumber(
              metrics.fraud
                ?.riskScore,
            ),
          ),
        );

      /**
       * If there are no active loans, there is no overdue-loan exposure.
       *
       * Treating the ratio as zero is preferable to dividing by 1 and
       * reporting a misleading 100% health value.
       */
      const overdueRatio =
        activeLoans > 0
          ? Math.min(
              100,
              (overdue /
                activeLoans) *
                100,
            )
          : 0;

      const loanHealth =
        Math.max(
          0,
          100 -
            overdueRatio,
        );

      const fraudHealth =
        Math.max(
          0,
          100 -
            riskScore,
        );

      const onlineUsers =
        toNumber(
          metrics.system
            ?.onlineUsers,
        );

      const activeUsers =
        toNumber(
          metrics.system
            ?.activeUsers,
        );

      const systemHealth =
        activeUsers > 0
          ? Math.min(
              100,
              Math.max(
                0,
                (onlineUsers /
                  activeUsers) *
                  100,
              ),
            )
          : onlineUsers > 0
            ? 100
            : 0;

      /**
       * Overall dashboard health is intentionally simple.
       *
       * It is an operational indicator, NOT a financial risk decision.
       */
      const overallHealth =
        (loanHealth +
          fraudHealth +
          systemHealth) /
        3;

      return {
        loanHealth,

        fraudHealth,

        systemHealth,

        overallHealth,
      };
    }, [
      metrics.loans,
      metrics.fraud,
      metrics.system,
    ]);

  /**
   * ==========================================================================
   * Derived Financial Totals
   * ==========================================================================
   *
   * These values are dashboard presentation metrics.
   *
   * They must NOT be used as ledger/accounting truth.
   * ==========================================================================
   */

  const totals =
    useMemo(() => {
      const savingsTotal =
        toNumber(
          metrics.savings
            ?.total,
        );

      const disbursedLoans =
        toNumber(
          metrics.loans
            ?.disbursed,
        );

      const activeLoans =
        toNumber(
          metrics.loans
            ?.active,
        );

      const treasuryBalance =
        toNumber(
          metrics.treasury
            ?.balance,
        );

      const mobileMoneyCollections =
        toNumber(
          metrics.mobileMoney
            ?.collections,
        );

      const mobileMoneySettlements =
        toNumber(
          metrics.mobileMoney
            ?.settlements,
        );

      return {
        /**
         * Dashboard-level asset indicator.
         */
        assets:
          savingsTotal +
          disbursedLoans,

        /**
         * Dashboard-level liability/exposure indicator.
         */
        liabilities:
          activeLoans,

        /**
         * Dashboard-level net position indicator.
         */
        netPosition:
          savingsTotal -
          activeLoans,

        /**
         * Treasury snapshot.
         */
        treasuryBalance,

        /**
         * Mobile money collection snapshot.
         */
        mobileMoneyCollections,

        /**
         * Mobile money settlement snapshot.
         */
        mobileMoneySettlements,
      };
    }, [
      metrics.savings,
      metrics.loans,
      metrics.treasury,
      metrics.mobileMoney,
    ]);

  /**
   * ==========================================================================
   * Return
   * ==========================================================================
   */

  return {
    /**
     * Complete normalized metrics tree.
     */
    metrics,

    /**
     * Initial/foreground loading state.
     */
    loading,

    /**
     * Background/manual refresh state.
     */
    refreshing,

    /**
     * Structured error information.
     */
    error,

    /**
     * Browser network status.
     */
    online,

    /**
     * Socket.IO connection status.
     */
    realtimeConnected,

    /**
     * Derived operational health indicators.
     */
    health,

    /**
     * Derived dashboard financial indicators.
     */
    totals,

    /**
     * Manual refresh.
     */
    refresh,

    /**
     * Backwards-compatible direct fetch method.
     */
    fetchMetrics,

    /**
     * Controlled metric mutation helper.
     */
    updateMetric,

    /**
     * Currency formatter.
     */
    formatCurrency,

    /**
     * Number formatter.
     */
    formatNumber,
  };
}