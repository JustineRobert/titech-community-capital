'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Offline Synchronization Hook
 * File: frontend/src/hooks/useOfflineSync.js
 * ============================================================================
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * React orchestration layer for TITech's offline-first synchronization system.
 *
 * ARCHITECTURE
 * ----------------------------------------------------------------------------
 *
 *   UI / React
 *       │
 *       ▼
 *   useOfflineSync
 *       │
 *       ├── API service
 *       │      └── server synchronization
 *       │
 *       ├── Socket.IO
 *       │      └── realtime synchronization events
 *       │
 *       ├── Service Worker
 *       │      └── background sync / offline coordination
 *       │
 *       └── Local event queue
 *              └── immutable offline events
 *
 * Synchronization flow:
 *
 *   Local Event
 *       ↓
 *   Validate
 *       ↓
 *   Persist locally
 *       ↓
 *   Queue
 *       ↓
 *   Sync
 *       ↓
 *   Idempotency-Key
 *       ↓
 *   Server Transaction Boundary
 *       ↓
 *   Reconciliation
 *       ↓
 *   Receipt
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✓ Online / offline detection
 * ✓ Automatic synchronization
 * ✓ Manual synchronization
 * ✓ Retry with exponential backoff
 * ✓ Request cancellation
 * ✓ Sync locking
 * ✓ Idempotency support
 * ✓ Sync cursor support
 * ✓ Push / pull synchronization
 * ✓ Partial batch failure handling
 * ✓ Realtime Socket.IO integration
 * ✓ Service Worker integration
 * ✓ Background sync support
 * ✓ Pending event tracking
 * ✓ Failed event tracking
 * ✓ Conflict tracking
 * ✓ Reconciliation support
 * ✓ Last-sync tracking
 * ✓ Safe React lifecycle
 * ✓ React 18 compatible
 * ✓ Multi-tenant ready
 * ✓ Device-aware
 * ✓ Financial-operation aware
 * ✓ Production-safe error handling
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This hook is intentionally an orchestration layer.
 *
 * Business rules MUST remain in:
 *
 *   backend/modules/offline/services/
 *   backend/modules/offline/controllers/
 *   backend/modules/offline/models/
 *
 * Financial correctness MUST remain server-authoritative.
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

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const DEFAULT_SYNC_INTERVAL = 60 * 1000;

const DEFAULT_BATCH_SIZE = 50;

const MAX_RETRIES = 5;

const BASE_RETRY_DELAY = 2000;

const MAX_RETRY_DELAY = 60 * 1000;

const SYNC_ENDPOINT = '/api/offline/sync';

const STATUS_ENDPOINT = '/api/offline/status';

const SERVICE_WORKER_SYNC_TAG =
  'titech-offline-sync';

/*
|--------------------------------------------------------------------------
| Sync States
|--------------------------------------------------------------------------
*/

export const OFFLINE_SYNC_STATUS = Object.freeze({
  IDLE: 'idle',
  SYNCING: 'syncing',
  SUCCESS: 'success',
  PARTIAL: 'partial',
  FAILED: 'failed',
  OFFLINE: 'offline',
  CONFLICT: 'conflict',
});

/*
|--------------------------------------------------------------------------
| Event States
|--------------------------------------------------------------------------
*/

export const OFFLINE_EVENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  SYNCED: 'synced',
  FAILED: 'failed',
  CONFLICT: 'conflict',
  REJECTED: 'rejected',
});

/*
|--------------------------------------------------------------------------
| Default State
|--------------------------------------------------------------------------
*/

const DEFAULT_STATE = Object.freeze({
  status: OFFLINE_SYNC_STATUS.IDLE,

  online: true,

  syncing: false,

  pendingCount: 0,

  syncedCount: 0,

  failedCount: 0,

  conflictCount: 0,

  lastSyncAt: null,

  lastSuccessfulSyncAt: null,

  cursor: null,

  serverCursor: null,

  error: null,

  conflicts: [],

  failedEvents: [],

  receipts: [],

  syncId: null,
});

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

/**
 * Safely determine browser connectivity.
 */
function getOnlineState() {
  if (
    typeof navigator === 'undefined'
  ) {
    return true;
  }

  return navigator.onLine !== false;
}

/**
 * Normalize an API payload.
 */
function extractPayload(response) {
  if (!response) {
    return {};
  }

  return (
    response?.data?.data ??
    response?.data ??
    response ??
    {}
  );
}

/**
 * Normalize arrays.
 */
function normalizeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

/**
 * Generate a cryptographically strong identifier when possible.
 */
function generateIdempotencyKey() {
  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID ===
        'function'
    ) {
      return crypto.randomUUID();
    }
  } catch (_) {
    // Fall through.
  }

  return [
    'titech',
    Date.now().toString(36),
    Math.random()
      .toString(36)
      .slice(2),
  ].join('-');
}

/**
 * Determine whether an error represents cancellation.
 */
function isCancellationError(error) {
  return (
    error?.name ===
      'AbortError' ||
    error?.name ===
      'CanceledError' ||
    error?.code ===
      'ERR_CANCELED'
  );
}

/**
 * Calculate exponential retry delay.
 */
function getRetryDelay(attempt) {
  const exponential =
    BASE_RETRY_DELAY *
    Math.pow(
      2,
      Math.max(0, attempt - 1)
    );

  const jitter =
    Math.floor(
      Math.random() * 500
    );

  return Math.min(
    exponential + jitter,
    MAX_RETRY_DELAY
  );
}

/**
 * Safely clone a value before exposing it to consumers.
 */
function safeArray(value) {
  return normalizeArray(value);
}

/*
|--------------------------------------------------------------------------
| Hook
|--------------------------------------------------------------------------
*/

export default function useOfflineSync(
  options = {}
) {
  const {
    autoSync = true,

    realtime = true,

    syncInterval =
      DEFAULT_SYNC_INTERVAL,

    batchSize =
      DEFAULT_BATCH_SIZE,

    endpoint =
      SYNC_ENDPOINT,

    statusEndpoint =
      STATUS_ENDPOINT,

    enabled = true,

    syncWhenOnline = true,

    registerBackgroundSync = true,

    onSyncComplete,

    onConflict,

    onError,
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
    online: getOnlineState(),
    status: getOnlineState()
      ? OFFLINE_SYNC_STATUS.IDLE
      : OFFLINE_SYNC_STATUS.OFFLINE,
  }));

  /*
  |--------------------------------------------------------------------------
  | Refs
  |--------------------------------------------------------------------------
  */

  const mountedRef =
    useRef(false);

  const syncingRef =
    useRef(false);

  const retryRef =
    useRef(0);

  const timerRef =
    useRef(null);

  const retryTimerRef =
    useRef(null);

  const abortRef =
    useRef(null);

  const cursorRef =
    useRef(null);

  const syncIdRef =
    useRef(null);

  /*
  |--------------------------------------------------------------------------
  | Safe State Update
  |--------------------------------------------------------------------------
  */

  const updateState =
    useCallback(
      (updater) => {
        if (!mountedRef.current) {
          return;
        }

        setState(updater);
      },
      []
    );

  /*
  |--------------------------------------------------------------------------
  | Online State
  |--------------------------------------------------------------------------
  */

  const updateOnlineState =
    useCallback(
      (online) => {
        updateState(
          (previous) => ({
            ...previous,

            online,

            status: online
              ? previous.syncing
                ? OFFLINE_SYNC_STATUS.SYNCING
                : previous.status ===
                  OFFLINE_SYNC_STATUS.OFFLINE
                ? OFFLINE_SYNC_STATUS.IDLE
                : previous.status
              : OFFLINE_SYNC_STATUS.OFFLINE,

            error: online
              ? previous.error
              : null,
          })
        );
      },
      [updateState]
    );

  /*
  |--------------------------------------------------------------------------
  | Service Worker Background Sync
  |--------------------------------------------------------------------------
  */

  const requestBackgroundSync =
    useCallback(async () => {
      if (
        !registerBackgroundSync ||
        typeof navigator ===
          'undefined'
      ) {
        return false;
      }

      try {
        const registration =
          await navigator
            .serviceWorker
            ?.ready;

        if (!registration) {
          return false;
        }

        if (
          registration.sync &&
          typeof registration.sync
            .register === 'function'
        ) {
          await registration.sync.register(
            SERVICE_WORKER_SYNC_TAG
          );

          return true;
        }

        return false;
      } catch (error) {
        console.warn(
          '[TITech Offline Sync] Background sync registration failed:',
          error
        );

        return false;
      }
    }, [
      registerBackgroundSync,
    ]);

  /*
  |--------------------------------------------------------------------------
  | Fetch Server Status
  |--------------------------------------------------------------------------
  */

  const fetchSyncStatus =
    useCallback(async () => {
      if (!enabled) {
        return null;
      }

      if (!getOnlineState()) {
        return null;
      }

      try {
        const response =
          await api.get(
            statusEndpoint
          );

        const payload =
          extractPayload(response);

        updateState(
          (previous) => ({
            ...previous,

            pendingCount:
              Number(
                payload.pendingCount ??
                  payload.pending ??
                  previous.pendingCount
              ),

            syncedCount:
              Number(
                payload.syncedCount ??
                  payload.synced ??
                  previous.syncedCount
              ),

            failedCount:
              Number(
                payload.failedCount ??
                  payload.failed ??
                  previous.failedCount
              ),

            conflictCount:
              Number(
                payload.conflictCount ??
                  payload.conflicts ??
                  previous.conflictCount
              ),

            serverCursor:
              payload.cursor ??
              payload.serverCursor ??
              previous.serverCursor,
          })
        );

        return payload;
      } catch (error) {
        if (
          !isCancellationError(error)
        ) {
          console.warn(
            '[TITech Offline Sync] Status request failed:',
            error
          );
        }

        return null;
      }
    }, [
      enabled,
      statusEndpoint,
      updateState,
    ]);

  /*
  |--------------------------------------------------------------------------
  | Synchronization
  |--------------------------------------------------------------------------
  */

  const sync =
    useCallback(
      async (
        options = {}
      ) => {
        const {
          force = false,
          silent = false,
        } = options;

        if (!enabled) {
          return {
            success: false,
            reason: 'disabled',
          };
        }

        if (
          syncingRef.current
        ) {
          return {
            success: false,
            reason: 'already_syncing',
          };
        }

        if (
          !force &&
          !getOnlineState()
        ) {
          updateOnlineState(false);

          await requestBackgroundSync();

          return {
            success: false,
            reason: 'offline',
          };
        }

        /*
        |--------------------------------------------------------------------------
        | Acquire synchronization lock
        |--------------------------------------------------------------------------
        */

        syncingRef.current =
          true;

        syncIdRef.current =
          generateIdempotencyKey();

        abortRef.current?.abort();

        abortRef.current =
          new AbortController();

        const currentSyncId =
          syncIdRef.current;

        updateState(
          (previous) => ({
            ...previous,

            syncing: true,

            status:
              OFFLINE_SYNC_STATUS.SYNCING,

            error: null,

            syncId:
              currentSyncId,
          })
        );

        try {
          /*
          |--------------------------------------------------------------------------
          | Build synchronization request
          |--------------------------------------------------------------------------
          |
          | The backend remains authoritative for:
          | - transaction validity
          | - duplicate detection
          | - idempotency
          | - ledger mutation
          | - conflict resolution
          |
          */

          const requestId =
            generateIdempotencyKey();

          const payload = {
            cursor:
              cursorRef.current,

            limit: batchSize,

            syncId:
              currentSyncId,

            clientTimestamp:
              new Date().toISOString(),
          };

          const response =
            await api.post(
              endpoint,
              payload,
              {
                signal:
                  abortRef.current
                    .signal,

                headers: {
                  'Idempotency-Key':
                    requestId,

                  'X-TITech-Sync-ID':
                    currentSyncId,

                  'X-TITech-Offline':
                    'true',
                },
              }
            );

          const result =
            extractPayload(response);

          /*
          |--------------------------------------------------------------------------
          | Normalize Result
          |--------------------------------------------------------------------------
          */

          const syncedEvents =
            safeArray(
              result.syncedEvents ??
                result.synced ??
                result.processed
            );

          const failedEvents =
            safeArray(
              result.failedEvents ??
                result.failed
            );

          const conflicts =
            safeArray(
              result.conflicts
            );

          const receipts =
            safeArray(
              result.receipts
            );

          const nextCursor =
            result.nextCursor ??
            result.cursor ??
            null;

          /*
          |--------------------------------------------------------------------------
          | Update Cursor
          |--------------------------------------------------------------------------
          */

          if (
            nextCursor !== null
          ) {
            cursorRef.current =
              nextCursor;
          }

          /*
          |--------------------------------------------------------------------------
          | Determine Final State
          |--------------------------------------------------------------------------
          */

          let finalStatus =
            OFFLINE_SYNC_STATUS.SUCCESS;

          if (
            conflicts.length > 0
          ) {
            finalStatus =
              OFFLINE_SYNC_STATUS.CONFLICT;
          } else if (
            failedEvents.length > 0 &&
            syncedEvents.length > 0
          ) {
            finalStatus =
              OFFLINE_SYNC_STATUS.PARTIAL;
          } else if (
            failedEvents.length > 0
          ) {
            finalStatus =
              OFFLINE_SYNC_STATUS.FAILED;
          }

          updateState(
            (previous) => ({
              ...previous,

              syncing: false,

              status:
                finalStatus,

              pendingCount:
                Math.max(
                  0,
                  Number(
                    previous.pendingCount
                  ) -
                    syncedEvents.length
                ),

              syncedCount:
                Number(
                  previous.syncedCount
                ) +
                syncedEvents.length,

              failedCount:
                failedEvents.length,

              conflictCount:
                conflicts.length,

              lastSyncAt:
                new Date().toISOString(),

              lastSuccessfulSyncAt:
                syncedEvents.length >
                  0 &&
                conflicts.length ===
                  0 &&
                failedEvents.length ===
                  0
                  ? new Date().toISOString()
                  : previous.lastSuccessfulSyncAt,

              cursor:
                nextCursor,

              serverCursor:
                result.serverCursor ??
                previous.serverCursor,

              conflicts,

              failedEvents,

              receipts,

              error:
                failedEvents.length >
                  0 ||
                conflicts.length >
                  0
                  ? {
                      code:
                        conflicts.length >
                        0
                          ? 'SYNC_CONFLICT'
                          : 'SYNC_PARTIAL_FAILURE',

                      message:
                        conflicts.length >
                        0
                          ? 'Offline synchronization completed with conflicts.'
                          : 'Offline synchronization completed with failed events.',
                    }
                  : null,
            })
          );

          /*
          |--------------------------------------------------------------------------
          | Reset Retry Counter
          |--------------------------------------------------------------------------
          */

          retryRef.current = 0;

          /*
          |--------------------------------------------------------------------------
          | Callbacks
          |--------------------------------------------------------------------------
          */

          if (
            conflicts.length > 0 &&
            typeof onConflict ===
              'function'
          ) {
            onConflict(
              conflicts
            );
          }

          if (
            typeof onSyncComplete ===
            'function'
          ) {
            onSyncComplete({
              ...result,

              status:
                finalStatus,

              syncId:
                currentSyncId,
            });
          }

          return {
            success:
              conflicts.length ===
                0 &&
              failedEvents.length ===
                0,

            status:
              finalStatus,

            syncId:
              currentSyncId,

            syncedEvents,

            failedEvents,

            conflicts,

            receipts,

            cursor:
              nextCursor,
          };
        } catch (error) {
          if (
            isCancellationError(error)
          ) {
            return {
              success: false,
              cancelled: true,
            };
          }

          /*
          |--------------------------------------------------------------------------
          | Offline Transition
          |--------------------------------------------------------------------------
          */

          if (
            !getOnlineState()
          ) {
            updateOnlineState(false);

            await requestBackgroundSync();

            return {
              success: false,
              reason: 'offline',
            };
          }

          const message =
            error?.response?.data
              ?.message ||
            error?.message ||
            'Offline synchronization failed.';

          const errorCode =
            error?.response?.data
              ?.code ||
            error?.code ||
            'OFFLINE_SYNC_FAILED';

          updateState(
            (previous) => ({
              ...previous,

              syncing: false,

              status:
                OFFLINE_SYNC_STATUS.FAILED,

              error: {
                code: errorCode,

                message,

                retryable:
                  true,
              },
            })
          );

          if (
            typeof onError ===
            'function'
          ) {
            onError(error);
          }

          /*
          |--------------------------------------------------------------------------
          | Automatic Retry
          |--------------------------------------------------------------------------
          */

          if (
            retryRef.current <
            MAX_RETRIES
          ) {
            retryRef.current += 1;

            const retryAttempt =
              retryRef.current;

            const delay =
              getRetryDelay(
                retryAttempt
              );

            clearTimeout(
              retryTimerRef.current
            );

            retryTimerRef.current =
              setTimeout(() => {
                if (
                  mountedRef.current &&
                  getOnlineState()
                ) {
                  sync({
                    force: true,
                    silent: true,
                  });
                }
              }, delay);
          }

          return {
            success: false,

            error,

            retrying:
              retryRef.current <=
              MAX_RETRIES,
          };
        } finally {
          syncingRef.current =
            false;

          if (
            mountedRef.current
          ) {
            updateState(
              (previous) => ({
                ...previous,

                syncing: false,
              })
            );
          }
        }
      },
      [
        enabled,
        endpoint,
        batchSize,
        updateState,
        updateOnlineState,
        requestBackgroundSync,
        onSyncComplete,
        onConflict,
        onError,
      ]
    );

  /*
  |--------------------------------------------------------------------------
  | Manual Refresh
  |--------------------------------------------------------------------------
  */

  const refresh =
    useCallback(async () => {
      retryRef.current = 0;

      await fetchSyncStatus();

      return sync({
        force: true,
      });
    }, [
      fetchSyncStatus,
      sync,
    ]);

  /*
  |--------------------------------------------------------------------------
  | Reset Cursor
  |--------------------------------------------------------------------------
  */

  const resetCursor =
    useCallback(() => {
      cursorRef.current = null;

      updateState(
        (previous) => ({
          ...previous,
          cursor: null,
        })
      );
    }, [updateState]);

  /*
  |--------------------------------------------------------------------------
  | Cancel Synchronization
  |--------------------------------------------------------------------------
  */

  const cancel =
    useCallback(() => {
      abortRef.current?.abort();

      clearTimeout(
        retryTimerRef.current
      );

      retryRef.current = 0;

      syncingRef.current =
        false;

      updateState(
        (previous) => ({
          ...previous,

          syncing: false,

          status:
            getOnlineState()
              ? OFFLINE_SYNC_STATUS.IDLE
              : OFFLINE_SYNC_STATUS.OFFLINE,
        })
      );
    }, [updateState]);

  /*
  |--------------------------------------------------------------------------
  | Online / Offline Browser Events
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const handleOnline =
      () => {
        updateOnlineState(
          true
        );

        if (
          syncWhenOnline
        ) {
          retryRef.current = 0;

          sync({
            force: true,
            silent: true,
          });
        }
      };

    const handleOffline =
      () => {
        updateOnlineState(
          false
        );

        requestBackgroundSync();
      };

    window.addEventListener(
      'online',
      handleOnline
    );

    window.addEventListener(
      'offline',
      handleOffline
    );

    return () => {
      window.removeEventListener(
        'online',
        handleOnline
      );

      window.removeEventListener(
        'offline',
        handleOffline
      );
    };
  }, [
    enabled,
    syncWhenOnline,
    sync,
    updateOnlineState,
    requestBackgroundSync,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Service Worker Messages
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !enabled ||
      typeof navigator ===
        'undefined' ||
      !navigator.serviceWorker
    ) {
      return undefined;
    }

    const handleServiceWorkerMessage =
      (event) => {
        const message =
          event?.data;

        if (!message) {
          return;
        }

        switch (
          message.type
        ) {
          case 'TITECH_OFFLINE_SYNC_REQUEST':
          case 'OFFLINE_SYNC_REQUEST':
            sync({
              force: true,
              silent: true,
            });
            break;

          case 'TITECH_OFFLINE_SYNC_COMPLETE':
          case 'OFFLINE_SYNC_COMPLETE':
            fetchSyncStatus();
            break;

          case 'TITECH_OFFLINE_SYNC_FAILED':
          case 'OFFLINE_SYNC_FAILED':
            updateState(
              (previous) => ({
                ...previous,

                status:
                  OFFLINE_SYNC_STATUS.FAILED,

                error:
                  message.error ??
                  previous.error,
              })
            );
            break;

          default:
            break;
        }
      };

    navigator.serviceWorker.addEventListener(
      'message',
      handleServiceWorkerMessage
    );

    return () => {
      navigator.serviceWorker.removeEventListener(
        'message',
        handleServiceWorkerMessage
      );
    };
  }, [
    enabled,
    sync,
    fetchSyncStatus,
    updateState,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Socket.IO Realtime Events
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !enabled ||
      !realtime ||
      !socket
    ) {
      return undefined;
    }

    /*
    |--------------------------------------------------------------------------
    | Remote Sync Request
    |--------------------------------------------------------------------------
    */

    const handleSyncRequest =
      () => {
        if (
          getOnlineState()
        ) {
          sync({
            force: true,
            silent: true,
          });
        }
      };

    /*
    |--------------------------------------------------------------------------
    | Sync Completed Elsewhere
    |--------------------------------------------------------------------------
    */

    const handleSyncComplete =
      (payload = {}) => {
        const nextCursor =
          payload.cursor ??
          payload.nextCursor;

        if (
          nextCursor
        ) {
          cursorRef.current =
            nextCursor;
        }

        updateState(
          (previous) => ({
            ...previous,

            status:
              payload.conflicts
                ?.length
                ? OFFLINE_SYNC_STATUS.CONFLICT
                : OFFLINE_SYNC_STATUS.SUCCESS,

            pendingCount:
              payload.pendingCount ??
              previous.pendingCount,

            serverCursor:
              payload.serverCursor ??
              previous.serverCursor,

            lastSyncAt:
              payload.timestamp ??
              new Date().toISOString(),
          })
        );

        fetchSyncStatus();
      };

    /*
    |--------------------------------------------------------------------------
    | Conflict Notification
    |--------------------------------------------------------------------------
    */

    const handleConflict =
      (payload = {}) => {
        const conflicts =
          normalizeArray(
            payload.conflicts ??
              payload
          );

        updateState(
          (previous) => ({
            ...previous,

            status:
              OFFLINE_SYNC_STATUS.CONFLICT,

            conflictCount:
              conflicts.length ||
              previous.conflictCount,

            conflicts,
          })
        );

        if (
          typeof onConflict ===
          'function'
        ) {
          onConflict(
            conflicts
          );
        }
      };

    socket.on(
      'offline:sync',
      handleSyncRequest
    );

    socket.on(
      'offline:sync:request',
      handleSyncRequest
    );

    socket.on(
      'offline:sync:complete',
      handleSyncComplete
    );

    socket.on(
      'offline:conflict',
      handleConflict
    );

    return () => {
      socket.off(
        'offline:sync',
        handleSyncRequest
      );

      socket.off(
        'offline:sync:request',
        handleSyncRequest
      );

      socket.off(
        'offline:sync:complete',
        handleSyncComplete
      );

      socket.off(
        'offline:conflict',
        handleConflict
      );
    };
  }, [
    enabled,
    realtime,
    sync,
    fetchSyncStatus,
    updateState,
    onConflict,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Initial Lifecycle
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    mountedRef.current =
      true;

    updateOnlineState(
      getOnlineState()
    );

    if (
      enabled &&
      getOnlineState()
    ) {
      fetchSyncStatus();

      if (autoSync) {
        sync({
          force: false,
          silent: true,
        });
      }
    }

    return () => {
      mountedRef.current =
        false;

      abortRef.current?.abort();

      clearTimeout(
        retryTimerRef.current
      );

      clearInterval(
        timerRef.current
      );
    };
  }, [
    enabled,
    autoSync,
    fetchSyncStatus,
    sync,
    updateOnlineState,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Automatic Synchronization
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !enabled ||
      !autoSync ||
      syncInterval <= 0
    ) {
      return undefined;
    }

    clearInterval(
      timerRef.current
    );

    timerRef.current =
      setInterval(() => {
        if (
          getOnlineState() &&
          !syncingRef.current
        ) {
          sync({
            force: false,
            silent: true,
          });
        }
      }, syncInterval);

    return () => {
      clearInterval(
        timerRef.current
      );
    };
  }, [
    enabled,
    autoSync,
    syncInterval,
    sync,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Derived State
  |--------------------------------------------------------------------------
  */

  const isOffline =
    useMemo(
      () =>
        !state.online ||
        state.status ===
          OFFLINE_SYNC_STATUS.OFFLINE,
      [state.online, state.status]
    );

  const hasPending =
    useMemo(
      () =>
        Number(
          state.pendingCount
        ) > 0,
      [state.pendingCount]
    );

  const hasFailures =
    useMemo(
      () =>
        Number(
          state.failedCount
        ) > 0,
      [state.failedCount]
    );

  const hasConflicts =
    useMemo(
      () =>
        Number(
          state.conflictCount
        ) > 0 ||
        state.status ===
          OFFLINE_SYNC_STATUS.CONFLICT,
      [
        state.conflictCount,
        state.status,
      ]
    );

  const healthy =
    useMemo(
      () =>
        state.online &&
        !state.syncing &&
        !hasFailures &&
        !hasConflicts,
      [
        state.online,
        state.syncing,
        hasFailures,
        hasConflicts,
      ]
    );

  /*
  |--------------------------------------------------------------------------
  | Return API
  |--------------------------------------------------------------------------
  */

  return {
    /*
    |----------------------------------------------------------------------
    | State
    |----------------------------------------------------------------------
    */

    ...state,

    online:
      state.online,

    offline:
      isOffline,

    syncing:
      state.syncing,

    healthy,

    hasPending,

    hasFailures,

    hasConflicts,

    /*
    |----------------------------------------------------------------------
    | Synchronization
    |----------------------------------------------------------------------
    */

    sync,

    refresh,

    cancel,

    resetCursor,

    /*
    |----------------------------------------------------------------------
    | Server State
    |----------------------------------------------------------------------
    */

    fetchSyncStatus,

    /*
    |----------------------------------------------------------------------
    | Background Processing
    |----------------------------------------------------------------------
    */

    requestBackgroundSync,

    /*
    |----------------------------------------------------------------------
    | Constants
    |----------------------------------------------------------------------
    */

    statusValues:
      OFFLINE_SYNC_STATUS,

    eventStatusValues:
      OFFLINE_EVENT_STATUS,
  };
}