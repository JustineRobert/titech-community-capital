'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Realtime Dashboard Hook
 * File: frontend/src/hooks/useRealtimeDashboard.js
 * ============================================================================
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Central React orchestration layer for TITech realtime dashboard data.
 *
 * ARCHITECTURE
 * ----------------------------------------------------------------------------
 *
 *   React Dashboard
 *        │
 *        ▼
 *   useRealtimeDashboard
 *        │
 *        ├── Socket Service
 *        │      └── Socket.IO connection lifecycle
 *        │
 *        ├── Dashboard State
 *        │      ├── Transactions
 *        │      ├── Savings
 *        │      ├── Loans
 *        │      ├── Fraud
 *        │      ├── Notifications
 *        │      └── System Health
 *        │
 *        └── Realtime Events
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This hook is an orchestration layer only.
 *
 * It MUST NOT contain:
 * - financial business rules
 * - authorization decisions
 * - ledger mutation logic
 * - loan approval logic
 * - fraud decisions
 * - regulatory calculations
 *
 * Those responsibilities belong to the backend/domain services.
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✓ Socket.IO integration
 * ✓ Automatic connection
 * ✓ Explicit connect/disconnect/reconnect
 * ✓ Feature-level event subscriptions
 * ✓ Strict Mode safe listener lifecycle
 * ✓ Duplicate listener protection
 * ✓ Bounded realtime collections
 * ✓ Notification management
 * ✓ Alert management
 * ✓ Transaction stream
 * ✓ Savings stream
 * ✓ Loan stream
 * ✓ Fraud stream
 * ✓ Executive updates
 * ✓ Regulatory updates
 * ✓ Mobile-money updates
 * ✓ Presence updates
 * ✓ System-health updates
 * ✓ Connection diagnostics
 * ✓ Safe payload handling
 * ✓ Last-event tracking
 * ✓ Realtime health state
 * ✓ React 18 compatible
 * ✓ Multi-tenant ready
 * ✓ Production lifecycle safety
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

import socket, {
  connectSocket,
  disconnectSocket,
  subscribe,
  unsubscribe,
  getSocketStatus,
} from '../services/socket';

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const MAX_ITEMS = 100;

const MAX_NOTIFICATIONS = 100;

const MAX_ALERTS = 100;

const DEFAULT_RECONNECT_DELAY = 2000;

/*
|--------------------------------------------------------------------------
| Default State
|--------------------------------------------------------------------------
*/

const DEFAULT_STATE = Object.freeze({
  connected: false,

  connecting: false,

  reconnecting: false,

  notifications: [],

  alerts: [],

  transactions: [],

  savings: [],

  loans: [],

  fraud: [],

  executive: {},

  regulatory: {},

  mobileMoney: {},

  systemHealth: {},

  presence: {},

  lastMessage: null,

  lastEvent: null,

  lastEventName: null,

  lastUpdated: null,

  connectionError: null,
});

/*
|--------------------------------------------------------------------------
| Event Names
|--------------------------------------------------------------------------
*/

export const REALTIME_EVENTS =
  Object.freeze({
    CONNECT: 'connect',

    DISCONNECT: 'disconnect',

    CONNECT_ERROR:
      'connect_error',

    NOTIFICATION:
      'notification',

    NOTIFICATION_NEW:
      'notification:new',

    ALERT: 'alert',

    ALERT_NEW:
      'alert:new',

    TRANSACTION_UPDATE:
      'transaction:update',

    TRANSACTION_CREATED:
      'transaction:created',

    SAVINGS_UPDATE:
      'savings:update',

    LOAN_UPDATE:
      'loan:update',

    FRAUD_UPDATE:
      'fraud:update',

    EXECUTIVE_UPDATE:
      'executive:update',

    REGULATORY_UPDATE:
      'regulatory:update',

    MOBILE_MONEY_UPDATE:
      'mobile_money:update',

    PRESENCE_UPDATE:
      'presence:update',

    SYSTEM_HEALTH:
      'system:health',

    DASHBOARD_UPDATE:
      'dashboard:update',
  });

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

/**
 * Normalize an incoming realtime payload.
 *
 * Realtime events may occasionally contain null/undefined values.
 * The hook should never allow malformed payloads to break rendering.
 */
function normalizePayload(payload) {
  if (
    payload === null ||
    payload === undefined
  ) {
    return null;
  }

  return payload;
}

/**
 * Append an item while enforcing a hard memory boundary.
 */
function appendLimited(
  previous,
  item,
  limit = MAX_ITEMS
) {
  const current =
    Array.isArray(previous)
      ? previous
      : [];

  return [
    item,
    ...current,
  ].slice(0, limit);
}

/**
 * Safely return an object.
 */
function normalizeObject(value) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    return value;
  }

  return {};
}

/**
 * Determine whether the socket is currently connected.
 */
function readSocketConnectionState() {
  try {
    return Boolean(
      socket?.connected
    );
  } catch (_) {
    return false;
  }
}

/**
 * Safely read socket status.
 */
function readSocketStatus() {
  try {
    return getSocketStatus();
  } catch (_) {
    return {
      connected:
        readSocketConnectionState(),
    };
  }
}

/*
|--------------------------------------------------------------------------
| Hook
|--------------------------------------------------------------------------
*/

export default function useRealtimeDashboard(
  options = {}
) {
  const {
    autoConnect = true,

    enableNotifications = true,

    enableTransactions = true,

    enableSavings = true,

    enableLoans = true,

    enableFraud = true,

    enableExecutive = true,

    enableRegulatory = true,

    enableMobileMoney = true,

    enablePresence = true,

    enableSystemHealth = true,

    maxItems = MAX_ITEMS,

    disconnectOnUnmount = false,

    onNotification,

    onAlert,

    onTransaction,

    onSavings,

    onLoan,

    onFraud,

    onExecutive,

    onRegulatory,

    onMobileMoney,

    onPresence,

    onSystemHealth,

    onConnectionChange,
  } = options;

  /*
  |--------------------------------------------------------------------------
  | State
  |--------------------------------------------------------------------------
  */

  const [
    state,
    setState,
  ] = useState(() => ({
    ...DEFAULT_STATE,

    connected:
      readSocketConnectionState(),
  }));

  /*
  |--------------------------------------------------------------------------
  | Lifecycle Refs
  |--------------------------------------------------------------------------
  */

  const mountedRef =
    useRef(false);

  const listenersRef =
    useRef(
      new Map()
    );

  const reconnectTimerRef =
    useRef(null);

  const maxItemsRef =
    useRef(maxItems);

  /*
  |--------------------------------------------------------------------------
  | Keep Configuration Refs Current
  |--------------------------------------------------------------------------
  |
  | Prevent realtime handlers from unnecessarily being torn down when a
  | consumer passes callback functions whose identity changes on render.
  |
  */

  const callbacksRef =
    useRef({});

  callbacksRef.current = {
    onNotification,

    onAlert,

    onTransaction,

    onSavings,

    onLoan,

    onFraud,

    onExecutive,

    onRegulatory,

    onMobileMoney,

    onPresence,

    onSystemHealth,

    onConnectionChange,
  };

  maxItemsRef.current =
    Math.max(
      1,
      Number(maxItems) ||
        MAX_ITEMS
    );

  /*
  |--------------------------------------------------------------------------
  | Safe State Update
  |--------------------------------------------------------------------------
  */

  const updateState =
    useCallback(
      (
        key,
        payload,
        {
          append = false,
          eventName = null,
          limit,
        } = {}
      ) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        const normalized =
          normalizePayload(
            payload
          );

        setState(
          (previous) => {
            const nextValue =
              append
                ? appendLimited(
                    previous[key],
                    normalized,
                    limit ||
                      maxItemsRef.current
                  )
                : normalized;

            return {
              ...previous,

              [key]:
                nextValue,

              lastMessage:
                normalized,

              lastEvent:
                normalized,

              lastEventName:
                eventName,

              lastUpdated:
                new Date(),

              connected:
                readSocketConnectionState(),
            };
          }
        );
      },
      []
    );

  /*
  |--------------------------------------------------------------------------
  | Generic Event Handler Factory
  |--------------------------------------------------------------------------
  */

  const createEventHandler =
    useCallback(
      (
        key,
        eventName,
        {
          append = false,
          limit,
          callbackKey,
        } = {}
      ) =>
      (payload) => {
        updateState(
          key,
          payload,
          {
            append,
            eventName,
            limit,
          }
        );

        const callback =
          callbacksRef
            .current[
              callbackKey
            ];

        if (
          typeof callback ===
          'function'
        ) {
          try {
            callback(
              payload
            );
          } catch (error) {
            console.error(
              `[TITech Realtime] ${eventName} callback failed:`,
              error
            );
          }
        }
      },
      [updateState]
    );

  /*
  |--------------------------------------------------------------------------
  | Listener Registration
  |--------------------------------------------------------------------------
  */

  const register =
    useCallback(
      (
        event,
        handler
      ) => {
        if (
          !event ||
          typeof handler !==
            'function'
        ) {
          return () => {};
        }

        /*
        |--------------------------------------------------------------------------
        | Prevent duplicate registration
        |--------------------------------------------------------------------------
        */

        const existing =
          listenersRef.current.get(
            event
          );

        if (
          existing &&
          existing.has(handler)
        ) {
          return () => {};
        }

        if (!existing) {
          listenersRef.current.set(
            event,
            new Set()
          );
        }

        listenersRef.current
          .get(event)
          .add(handler);

        subscribe(
          event,
          handler
        );

        return () => {
          unregister(
            event,
            handler
          );
        };
      },
      []
    );

  /*
  |--------------------------------------------------------------------------
  | Listener Unregistration
  |--------------------------------------------------------------------------
  */

  const unregister =
    useCallback(
      (
        event,
        handler
      ) => {
        const handlers =
          listenersRef.current.get(
            event
          );

        if (!handlers) {
          return;
        }

        if (
          handlers.has(handler)
        ) {
          unsubscribe(
            event,
            handler
          );

          handlers.delete(
            handler
          );
        }

        if (
          handlers.size === 0
        ) {
          listenersRef.current.delete(
            event
          );
        }
      },
      []
    );

  /*
  |--------------------------------------------------------------------------
  | Remove All Registered Listeners
  |--------------------------------------------------------------------------
  */

  const unregisterAll =
    useCallback(() => {
      listenersRef.current.forEach(
        (
          handlers,
          event
        ) => {
          handlers.forEach(
            (handler) => {
              try {
                unsubscribe(
                  event,
                  handler
                );
              } catch (
                error
              ) {
                console.warn(
                  `[TITech Realtime] Failed to unsubscribe from ${event}:`,
                  error
                );
              }
            }
          );
        }
      );

      listenersRef.current.clear();
    }, []);

  /*
  |--------------------------------------------------------------------------
  | Connection Management
  |--------------------------------------------------------------------------
  */

  const connect =
    useCallback(() => {
      try {
        connectSocket();

        if (
          mountedRef.current
        ) {
          setState(
            (previous) => ({
              ...previous,

              connecting:
                !readSocketConnectionState(),

              connected:
                readSocketConnectionState(),

              connectionError:
                null,
            })
          );
        }
      } catch (error) {
        if (
          mountedRef.current
        ) {
          setState(
            (previous) => ({
              ...previous,

              connected: false,

              connecting: false,

              connectionError:
                error,
            })
          );
        }

        throw error;
      }
    }, []);

  const disconnect =
    useCallback(() => {
      clearTimeout(
        reconnectTimerRef.current
      );

      try {
        disconnectSocket();
      } finally {
        if (
          mountedRef.current
        ) {
          setState(
            (previous) => ({
              ...previous,

              connected: false,

              connecting: false,

              reconnecting: false,
            })
          );
        }
      }
    }, []);

  const reconnect =
    useCallback(() => {
      clearTimeout(
        reconnectTimerRef.current
      );

      if (
        mountedRef.current
      ) {
        setState(
          (previous) => ({
            ...previous,

            reconnecting: true,

            connectionError:
              null,
          })
        );
      }

      try {
        disconnectSocket();
        connectSocket();
      } catch (error) {
        if (
          mountedRef.current
        ) {
          setState(
            (previous) => ({
              ...previous,

              connected: false,

              connecting: false,

              reconnecting: false,

              connectionError:
                error,
            })
          );
        }

        throw error;
      }

      /*
      |--------------------------------------------------------------------------
      | Safety fallback
      |--------------------------------------------------------------------------
      */

      reconnectTimerRef.current =
        setTimeout(() => {
          if (
            mountedRef.current &&
            readSocketConnectionState()
          ) {
            setState(
              (previous) => ({
                ...previous,

                reconnecting: false,

                connected: true,
              })
            );
          }
        }, DEFAULT_RECONNECT_DELAY);
    }, []);

  /*
  |--------------------------------------------------------------------------
  | Clear Notifications
  |--------------------------------------------------------------------------
  */

  const clearNotifications =
    useCallback(() => {
      setState(
        (previous) => ({
          ...previous,

          notifications: [],
        })
      );
    }, []);

  /*
  |--------------------------------------------------------------------------
  | Clear Alerts
  |--------------------------------------------------------------------------
  */

  const clearAlerts =
    useCallback(() => {
      setState(
        (previous) => ({
          ...previous,

          alerts: [],
        })
      );
    }, []);

  /*
  |--------------------------------------------------------------------------
  | Clear Transactions
  |--------------------------------------------------------------------------
  */

  const clearTransactions =
    useCallback(() => {
      setState(
        (previous) => ({
          ...previous,

          transactions: [],
        })
      );
    }, []);

  /*
  |--------------------------------------------------------------------------
  | Clear All Streams
  |--------------------------------------------------------------------------
  */

  const clearStreams =
    useCallback(() => {
      setState(
        (previous) => ({
          ...previous,

          notifications: [],

          alerts: [],

          transactions: [],

          savings: [],

          loans: [],

          fraud: [],
        })
      );
    }, []);

  /*
  |--------------------------------------------------------------------------
  | Connection Events
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !mountedRef.current &&
      !autoConnect
    ) {
      return undefined;
    }

    const handleConnect =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setState(
          (previous) => ({
            ...previous,

            connected: true,

            connecting: false,

            reconnecting: false,

            connectionError:
              null,

            lastUpdated:
              new Date(),
          })
        );

        const callback =
          callbacksRef
            .current
            .onConnectionChange;

        if (
          typeof callback ===
          'function'
        ) {
          callback(true);
        }
      };

    const handleDisconnect =
      (reason) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setState(
          (previous) => ({
            ...previous,

            connected: false,

            connecting: false,

            lastMessage:
              reason || null,

            lastEventName:
              REALTIME_EVENTS.DISCONNECT,

            lastUpdated:
              new Date(),
          })
        );

        const callback =
          callbacksRef
            .current
            .onConnectionChange;

        if (
          typeof callback ===
          'function'
        ) {
          callback(
            false,
            reason
          );
        }
      };

    const handleConnectError =
      (error) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setState(
          (previous) => ({
            ...previous,

            connected: false,

            connecting: false,

            connectionError:
              error,

            lastMessage:
              error,

            lastEventName:
              REALTIME_EVENTS.CONNECT_ERROR,

            lastUpdated:
              new Date(),
          })
        );
      };

    const cleanups = [
      register(
        REALTIME_EVENTS.CONNECT,
        handleConnect
      ),

      register(
        REALTIME_EVENTS.DISCONNECT,
        handleDisconnect
      ),

      register(
        REALTIME_EVENTS.CONNECT_ERROR,
        handleConnectError
      ),
    ];

    return () => {
      cleanups.forEach(
        (cleanup) =>
          cleanup()
      );
    };
  }, [
    autoConnect,
    register,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Notifications
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !enableNotifications
    ) {
      return undefined;
    }

    const handleNotification =
      createEventHandler(
        'notifications',
        REALTIME_EVENTS.NOTIFICATION,
        {
          append: true,
          limit:
            MAX_NOTIFICATIONS,
          callbackKey:
            'onNotification',
        }
      );

    const handleNotificationNew =
      createEventHandler(
        'notifications',
        REALTIME_EVENTS.NOTIFICATION_NEW,
        {
          append: true,
          limit:
            MAX_NOTIFICATIONS,
          callbackKey:
            'onNotification',
        }
      );

    const handleAlert =
      createEventHandler(
        'alerts',
        REALTIME_EVENTS.ALERT,
        {
          append: true,
          limit: MAX_ALERTS,
          callbackKey:
            'onAlert',
        }
      );

    const handleAlertNew =
      createEventHandler(
        'alerts',
        REALTIME_EVENTS.ALERT_NEW,
        {
          append: true,
          limit: MAX_ALERTS,
          callbackKey:
            'onAlert',
        }
      );

    const cleanups = [
      register(
        REALTIME_EVENTS.NOTIFICATION,
        handleNotification
      ),

      register(
        REALTIME_EVENTS.NOTIFICATION_NEW,
        handleNotificationNew
      ),

      register(
        REALTIME_EVENTS.ALERT,
        handleAlert
      ),

      register(
        REALTIME_EVENTS.ALERT_NEW,
        handleAlertNew
      ),
    ];

    return () => {
      cleanups.forEach(
        (cleanup) =>
          cleanup()
      );
    };
  }, [
    enableNotifications,
    register,
    createEventHandler,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Transactions
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !enableTransactions
    ) {
      return undefined;
    }

    const handleTransaction =
      createEventHandler(
        'transactions',
        REALTIME_EVENTS.TRANSACTION_UPDATE,
        {
          append: true,
          callbackKey:
            'onTransaction',
        }
      );

    const handleTransactionCreated =
      createEventHandler(
        'transactions',
        REALTIME_EVENTS.TRANSACTION_CREATED,
        {
          append: true,
          callbackKey:
            'onTransaction',
        }
      );

    const cleanups = [
      register(
        REALTIME_EVENTS.TRANSACTION_UPDATE,
        handleTransaction
      ),

      register(
        REALTIME_EVENTS.TRANSACTION_CREATED,
        handleTransactionCreated
      ),
    ];

    return () => {
      cleanups.forEach(
        (cleanup) =>
          cleanup()
      );
    };
  }, [
    enableTransactions,
    register,
    createEventHandler,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Savings
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !enableSavings
    ) {
      return undefined;
    }

    const handler =
      createEventHandler(
        'savings',
        REALTIME_EVENTS.SAVINGS_UPDATE,
        {
          append: true,
          callbackKey:
            'onSavings',
        }
      );

    return register(
      REALTIME_EVENTS.SAVINGS_UPDATE,
      handler
    );
  }, [
    enableSavings,
    register,
    createEventHandler,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Loans
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !enableLoans
    ) {
      return undefined;
    }

    const handler =
      createEventHandler(
        'loans',
        REALTIME_EVENTS.LOAN_UPDATE,
        {
          append: true,
          callbackKey:
            'onLoan',
        }
      );

    return register(
      REALTIME_EVENTS.LOAN_UPDATE,
      handler
    );
  }, [
    enableLoans,
    register,
    createEventHandler,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Fraud
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !enableFraud
    ) {
      return undefined;
    }

    const handler =
      createEventHandler(
        'fraud',
        REALTIME_EVENTS.FRAUD_UPDATE,
        {
          append: true,
          callbackKey:
            'onFraud',
        }
      );

    return register(
      REALTIME_EVENTS.FRAUD_UPDATE,
      handler
    );
  }, [
    enableFraud,
    register,
    createEventHandler,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Executive
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !enableExecutive
    ) {
      return undefined;
    }

    const handler =
      createEventHandler(
        'executive',
        REALTIME_EVENTS.EXECUTIVE_UPDATE,
        {
          callbackKey:
            'onExecutive',
        }
      );

    return register(
      REALTIME_EVENTS.EXECUTIVE_UPDATE,
      handler
    );
  }, [
    enableExecutive,
    register,
    createEventHandler,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Regulatory
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !enableRegulatory
    ) {
      return undefined;
    }

    const handler =
      createEventHandler(
        'regulatory',
        REALTIME_EVENTS.REGULATORY_UPDATE,
        {
          callbackKey:
            'onRegulatory',
        }
      );

    return register(
      REALTIME_EVENTS.REGULATORY_UPDATE,
      handler
    );
  }, [
    enableRegulatory,
    register,
    createEventHandler,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Mobile Money
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !enableMobileMoney
    ) {
      return undefined;
    }

    const handler =
      createEventHandler(
        'mobileMoney',
        REALTIME_EVENTS.MOBILE_MONEY_UPDATE,
        {
          callbackKey:
            'onMobileMoney',
        }
      );

    return register(
      REALTIME_EVENTS.MOBILE_MONEY_UPDATE,
      handler
    );
  }, [
    enableMobileMoney,
    register,
    createEventHandler,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Presence
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !enablePresence
    ) {
      return undefined;
    }

    const handler =
      createEventHandler(
        'presence',
        REALTIME_EVENTS.PRESENCE_UPDATE,
        {
          callbackKey:
            'onPresence',
        }
      );

    return register(
      REALTIME_EVENTS.PRESENCE_UPDATE,
      handler
    );
  }, [
    enablePresence,
    register,
    createEventHandler,
  ]);

  /*
  |--------------------------------------------------------------------------
  | System Health
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !enableSystemHealth
    ) {
      return undefined;
    }

    const handler =
      createEventHandler(
        'systemHealth',
        REALTIME_EVENTS.SYSTEM_HEALTH,
        {
          callbackKey:
            'onSystemHealth',
        }
      );

    return register(
      REALTIME_EVENTS.SYSTEM_HEALTH,
      handler
    );
  }, [
    enableSystemHealth,
    register,
    createEventHandler,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Generic Dashboard Update
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    const handleDashboardUpdate =
      (payload = {}) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        const normalized =
          normalizeObject(
            payload
          );

        setState(
          (previous) => ({
            ...previous,

            ...(normalized.notifications
              ? {
                  notifications:
                    appendLimited(
                      previous.notifications,
                      normalized.notifications,
                      MAX_NOTIFICATIONS
                    ),
                }
              : {}),

            ...(normalized.alerts
              ? {
                  alerts:
                    appendLimited(
                      previous.alerts,
                      normalized.alerts,
                      MAX_ALERTS
                    ),
                }
              : {}),

            ...(normalized.executive
              ? {
                  executive:
                    normalized.executive,
                }
              : {}),

            ...(normalized.regulatory
              ? {
                  regulatory:
                    normalized.regulatory,
                }
              : {}),

            ...(normalized.mobileMoney
              ? {
                  mobileMoney:
                    normalized.mobileMoney,
                }
              : {}),

            ...(normalized.systemHealth
              ? {
                  systemHealth:
                    normalized.systemHealth,
                }
              : {}),

            lastMessage:
              payload,

            lastEvent:
              payload,

            lastEventName:
              REALTIME_EVENTS.DASHBOARD_UPDATE,

            lastUpdated:
              new Date(),

            connected:
              readSocketConnectionState(),
          })
        );
      };

    return register(
      REALTIME_EVENTS.DASHBOARD_UPDATE,
      handleDashboardUpdate
    );
  }, [register]);

  /*
  |--------------------------------------------------------------------------
  | Initialization
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    mountedRef.current =
      true;

    if (
      autoConnect
    ) {
      try {
        connectSocket();
      } catch (error) {
        if (
          mountedRef.current
        ) {
          setState(
            (previous) => ({
              ...previous,

              connected: false,

              connecting: false,

              connectionError:
                error,
            })
          );
        }
      }
    }

    setState(
      (previous) => ({
        ...previous,

        connected:
          readSocketConnectionState(),

        lastUpdated:
          new Date(),
      })
    );

    return () => {
      mountedRef.current =
        false;

      clearTimeout(
        reconnectTimerRef.current
      );

      unregisterAll();

      if (
        disconnectOnUnmount
      ) {
        try {
          disconnectSocket();
        } catch (_) {
          // Ignore shutdown errors.
        }
      }
    };
  }, [
    autoConnect,
    disconnectOnUnmount,
    unregisterAll,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Diagnostics
  |--------------------------------------------------------------------------
  */

  const diagnostics =
    useMemo(() => {
      const socketStatus =
        readSocketStatus();

      return {
        socket:
          socketStatus,

        connected:
          state.connected,

        connecting:
          state.connecting,

        reconnecting:
          state.reconnecting,

        listenerCount:
          Array.from(
            listenersRef.current.values()
          ).reduce(
            (
              total,
              handlers
            ) =>
              total +
              handlers.size,
            0
          ),

        notifications:
          state.notifications
            .length,

        alerts:
          state.alerts
            .length,

        transactions:
          state.transactions
            .length,

        savings:
          state.savings
            .length,

        loans:
          state.loans
            .length,

        fraud:
          state.fraud
            .length,

        lastEventName:
          state.lastEventName,

        lastUpdated:
          state.lastUpdated,

        connectionError:
          state.connectionError,
      };
    }, [state]);

  /*
  |--------------------------------------------------------------------------
  | Realtime Health
  |--------------------------------------------------------------------------
  */

  const healthy =
    useMemo(
      () =>
        Boolean(
          state.connected &&
            !state.connectionError
        ),
      [
        state.connected,
        state.connectionError,
      ]
    );

  /*
  |--------------------------------------------------------------------------
  | Return
  |--------------------------------------------------------------------------
  */

  return {
    /*
    |----------------------------------------------------------------------
    | Connection
    |----------------------------------------------------------------------
    */

    connected:
      state.connected,

    connecting:
      state.connecting,

    reconnecting:
      state.reconnecting,

    healthy,

    connectionError:
      state.connectionError,

    /*
    |----------------------------------------------------------------------
    | Dashboard Streams
    |----------------------------------------------------------------------
    */

    notifications:
      state.notifications,

    alerts:
      state.alerts,

    transactions:
      state.transactions,

    savings:
      state.savings,

    loans:
      state.loans,

    fraud:
      state.fraud,

    executive:
      state.executive,

    regulatory:
      state.regulatory,

    mobileMoney:
      state.mobileMoney,

    presence:
      state.presence,

    systemHealth:
      state.systemHealth,

    /*
    |----------------------------------------------------------------------
    | Event Metadata
    |----------------------------------------------------------------------
    */

    lastMessage:
      state.lastMessage,

    lastEvent:
      state.lastEvent,

    lastEventName:
      state.lastEventName,

    lastUpdated:
      state.lastUpdated,

    /*
    |----------------------------------------------------------------------
    | Connection Controls
    |----------------------------------------------------------------------
    */

    connect,

    disconnect,

    reconnect,

    /*
    |----------------------------------------------------------------------
    | Stream Controls
    |----------------------------------------------------------------------
    */

    clearNotifications,

    clearAlerts,

    clearTransactions,

    clearStreams,

    /*
    |----------------------------------------------------------------------
    | Diagnostics
    |----------------------------------------------------------------------
    */

    diagnostics,

    /*
    |----------------------------------------------------------------------
    | Constants
    |----------------------------------------------------------------------
    */

    events:
      REALTIME_EVENTS,
  };
}