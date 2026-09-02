'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Offline Status Banner
 * File: frontend/src/components/offline/OfflineStatusBanner.jsx
 * Production Grade
 * ============================================================================
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Provides a resilient user-facing indication of:
 *
 *   • Online / offline connectivity
 *   • Pending offline operations
 *   • Synchronization progress
 *   • Synchronization failures
 *   • Last successful synchronization
 *   • Retry / manual synchronization
 *
 * ARCHITECTURE
 * ----------------------------------------------------------------------------
 *
 *   Browser Connectivity
 *          │
 *          ▼
 *   Offline Sync Layer
 *          │
 *          ▼
 *   OfflineStatusBanner
 *          │
 *          ▼
 *       React UI
 *
 * PRINCIPLES
 * ----------------------------------------------------------------------------
 * ✓ Offline-first
 * ✓ Financial-operation aware
 * ✓ Non-blocking UI
 * ✓ Accessible
 * ✓ React 18 compatible
 * ✓ Strict Mode compatible
 * ✓ Defensive against incomplete sync state
 * ✓ No direct database access
 * ✓ No business logic
 * ✓ No mutation of sync state
 * ✓ Graceful service degradation
 * ✓ TITech naming consistency
 *
 * ============================================================================
 */

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import PropTypes from 'prop-types';

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const DEFAULT_RECONNECT_DELAY = 5000;

const DEFAULT_DISMISS_DURATION = 10000;

const DEFAULT_MAX_VISIBLE_PENDING = 999;

/*
|--------------------------------------------------------------------------
| Status Constants
|--------------------------------------------------------------------------
*/

const STATUS = Object.freeze({
  ONLINE: 'online',
  OFFLINE: 'offline',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  ERROR: 'error',
});

/*
|--------------------------------------------------------------------------
| Safe Helpers
|--------------------------------------------------------------------------
*/

function normalizeNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? Math.max(0, number)
    : 0;
}

function formatPendingCount(value) {
  const count = normalizeNumber(value);

  if (
    count >
    DEFAULT_MAX_VISIBLE_PENDING
  ) {
    return `${DEFAULT_MAX_VISIBLE_PENDING}+`;
  }

  return String(count);
}

function formatRelativeTime(value) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  const diff =
    Date.now() -
    date.getTime();

  if (diff < 0) {
    return 'just now';
  }

  const seconds =
    Math.floor(diff / 1000);

  if (seconds < 10) {
    return 'just now';
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes =
    Math.floor(
      seconds / 60
    );

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days =
    Math.floor(
      hours / 24
    );

  return `${days}d ago`;
}

/*
|--------------------------------------------------------------------------
| Connectivity Hook
|--------------------------------------------------------------------------
*/

function useBrowserConnectivity() {
  const [
    online,
    setOnline,
  ] = useState(
    () =>
      typeof navigator ===
        'undefined'
        ? true
        : navigator.onLine
  );

  useEffect(() => {
    const handleOnline =
      () => setOnline(true);

    const handleOffline =
      () => setOnline(false);

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
  }, []);

  return online;
}

/*
|--------------------------------------------------------------------------
| Component
|--------------------------------------------------------------------------
*/

/**
 * Offline status banner.
 *
 * The component accepts a generic sync object rather than tightly coupling
 * itself to a specific implementation of useOfflineSync().
 *
 * Supported sync fields include:
 *
 *   isOnline
 *   online
 *   syncing
 *   pendingCount
 *   queuedCount
 *   failedCount
 *   error
 *   lastSyncedAt
 *   lastSyncAt
 *   sync
 *   synchronize
 *   retry
 */
function OfflineStatusBanner({
  sync,
  showWhenOnline = false,
  showPendingWhenOnline = true,
  position = 'top',
  className = '',
  reconnectDelay =
    DEFAULT_RECONNECT_DELAY,
  dismissDuration =
    DEFAULT_DISMISS_DURATION,
  onStatusChange,
}) {
  /*
  |--------------------------------------------------------------------------
  | Browser Connectivity
  |--------------------------------------------------------------------------
  */

  const browserOnline =
    useBrowserConnectivity();

  /*
  |--------------------------------------------------------------------------
  | Defensive Sync State
  |--------------------------------------------------------------------------
  */

  const syncState =
    sync || {};

  const isOnline =
    typeof syncState.isOnline ===
      'boolean'
      ? syncState.isOnline
      : typeof syncState.online ===
          'boolean'
        ? syncState.online
        : browserOnline;

  const syncing =
    Boolean(
      syncState.syncing ??
        syncState.isSyncing ??
        false
    );

  const pendingCount =
    normalizeNumber(
      syncState.pendingCount ??
        syncState.queuedCount ??
        syncState.pending ??
        syncState.queueLength ??
        0
    );

  const failedCount =
    normalizeNumber(
      syncState.failedCount ??
        syncState.failed ??
        0
    );

  const syncError =
    syncState.error ||
    syncState.syncError ||
    null;

  const lastSyncedAt =
    syncState.lastSyncedAt ??
    syncState.lastSyncAt ??
    null;

  /*
  |--------------------------------------------------------------------------
  | Local State
  |--------------------------------------------------------------------------
  */

  const [
    dismissed,
    setDismissed,
  ] = useState(false);

  const [
    retrying,
    setRetrying,
  ] = useState(false);

  const [
    reconnecting,
    setReconnecting,
  ] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Determine Status
  |--------------------------------------------------------------------------
  */

  const status =
    useMemo(() => {
      if (!isOnline) {
        return STATUS.OFFLINE;
      }

      if (syncError) {
        return STATUS.ERROR;
      }

      if (syncing) {
        return STATUS.SYNCING;
      }

      if (
        pendingCount === 0
      ) {
        return STATUS.SYNCED;
      }

      return STATUS.ONLINE;
    }, [
      isOnline,
      syncError,
      syncing,
      pendingCount,
    ]);

  /*
  |--------------------------------------------------------------------------
  | Status Change Notification
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      typeof onStatusChange !==
      'function'
    ) {
      return;
    }

    onStatusChange(status);
  }, [
    onStatusChange,
    status,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Reset Dismissed State on Important Changes
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      status ===
        STATUS.OFFLINE ||
      status ===
        STATUS.SYNCING ||
      status ===
        STATUS.ERROR
    ) {
      setDismissed(false);
    }
  }, [status]);

  /*
  |--------------------------------------------------------------------------
  | Auto Dismiss Successful State
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !dismissDuration ||
      dismissDuration <= 0
    ) {
      return undefined;
    }

    if (
      status !==
      STATUS.SYNCED
    ) {
      return undefined;
    }

    if (
      !showWhenOnline
    ) {
      return undefined;
    }

    const timer =
      setTimeout(() => {
        setDismissed(true);
      }, dismissDuration);

    return () => {
      clearTimeout(timer);
    };
  }, [
    dismissDuration,
    showWhenOnline,
    status,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Synchronization Action
  |--------------------------------------------------------------------------
  */

  const executeSync =
    useCallback(async () => {
      const syncFunction =
        syncState.sync ||
        syncState.synchronize ||
        syncState.syncNow ||
        syncState.retry;

      if (
        typeof syncFunction !==
        'function'
      ) {
        return;
      }

      try {
        setRetrying(true);

        await syncFunction();
      } catch (_) {
        /*
         * The underlying synchronization service owns the actual error state.
         * The banner deliberately avoids duplicating business/error handling.
         */
      } finally {
        setRetrying(false);
      }
    }, [syncState]);

  /*
  |--------------------------------------------------------------------------
  | Reconnect Action
  |--------------------------------------------------------------------------
  */

  const handleReconnect =
    useCallback(() => {
      if (isOnline) {
        executeSync();
        return;
      }

      setReconnecting(true);

      const timer =
        setTimeout(() => {
          setReconnecting(false);

          if (
            typeof window !==
              'undefined' &&
            window.navigator.onLine
          ) {
            executeSync();
          }
        }, reconnectDelay);

      return () => {
        clearTimeout(timer);
      };
    }, [
      executeSync,
      isOnline,
      reconnectDelay,
    ]);

  /*
  |--------------------------------------------------------------------------
  | Visibility
  |--------------------------------------------------------------------------
  */

  const shouldShow =
    useMemo(() => {
      if (dismissed) {
        return false;
      }

      if (
        status ===
        STATUS.OFFLINE
      ) {
        return true;
      }

      if (
        status ===
        STATUS.ERROR
      ) {
        return true;
      }

      if (
        status ===
        STATUS.SYNCING
      ) {
        return true;
      }

      if (
        pendingCount > 0 &&
        showPendingWhenOnline
      ) {
        return true;
      }

      if (
        status ===
          STATUS.SYNCED &&
        showWhenOnline
      ) {
        return true;
      }

      return false;
    }, [
      dismissed,
      pendingCount,
      showPendingWhenOnline,
      showWhenOnline,
      status,
    ]);

  /*
  |--------------------------------------------------------------------------
  | Status Presentation
  |--------------------------------------------------------------------------
  */

  const presentation =
    useMemo(() => {
      switch (status) {
        case STATUS.OFFLINE:
          return {
            role: 'alert',
            title:
              'You are offline',
            message:
              pendingCount > 0
                ? `${formatPendingCount(
                    pendingCount
                  )} operation${
                    pendingCount ===
                    1
                      ? ''
                      : 's'
                  } queued and will synchronize when connectivity returns.`
                : 'Changes will be stored locally and synchronized when connectivity returns.',
            icon: '⚠',
            tone: 'offline',
          };

        case STATUS.SYNCING:
          return {
            role: 'status',
            title:
              'Synchronizing',
            message:
              pendingCount > 0
                ? `Synchronizing ${formatPendingCount(
                    pendingCount
                  )} pending operation${
                    pendingCount ===
                    1
                      ? ''
                      : 's'
                  }…`
                : 'Synchronizing your latest changes…',
            icon: '↻',
            tone: 'syncing',
          };

        case STATUS.ERROR:
          return {
            role: 'alert',
            title:
              'Synchronization needs attention',
            message:
              pendingCount > 0
                ? `${formatPendingCount(
                    pendingCount
                  )} operation${
                    pendingCount ===
                    1
                      ? ''
                      : 's'
                  } remain pending.`
                : 'The latest synchronization attempt was unsuccessful.',
            icon: '!',
            tone: 'error',
          };

        case STATUS.SYNCED:
          return {
            role: 'status',
            title:
              'All changes synchronized',
            message:
              lastSyncedAt
                ? `Last synchronized ${formatRelativeTime(
                    lastSyncedAt
                  )}.`
                : 'Your latest changes are synchronized.',
            icon: '✓',
            tone: 'success',
          };

        case STATUS.ONLINE:
        default:
          return {
            role: 'status',
            title:
              'Online',
            message:
              pendingCount > 0
                ? `${formatPendingCount(
                    pendingCount
                  )} operation${
                    pendingCount ===
                    1
                      ? ''
                      : 's'
                  } waiting to synchronize.`
                : 'Connected to TITech services.',
            icon: '●',
            tone: 'online',
          };
      }
    }, [
      lastSyncedAt,
      pendingCount,
      status,
    ]);

  /*
  |--------------------------------------------------------------------------
  | Don't Render
  |--------------------------------------------------------------------------
  */

  if (!shouldShow) {
    return null;
  }

  /*
  |--------------------------------------------------------------------------
  | CSS Classes
  |--------------------------------------------------------------------------
  */

  const rootClassName = [
    'titech-offline-status-banner',
    `titech-offline-status-banner--${position}`,
    `titech-offline-status-banner--${presentation.tone}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  /*
  |--------------------------------------------------------------------------
  | Render
  |--------------------------------------------------------------------------
  */

  return (
    <div
      className={rootClassName}
      role={presentation.role}
      aria-live={
        status ===
        STATUS.ERROR
          ? 'assertive'
          : 'polite'
      }
      aria-atomic="true"
      data-status={status}
      data-online={
        isOnline
          ? 'true'
          : 'false'
      }
      data-pending-count={
        pendingCount
      }
    >
      <div className="titech-offline-status-banner__content">
        <div
          className="titech-offline-status-banner__indicator"
          aria-hidden="true"
        >
          {presentation.icon}
        </div>

        <div className="titech-offline-status-banner__text">
          <strong className="titech-offline-status-banner__title">
            {presentation.title}
          </strong>

          <span className="titech-offline-status-banner__message">
            {presentation.message}
          </span>

          {failedCount > 0 && (
            <span className="titech-offline-status-banner__failed">
              {formatPendingCount(
                failedCount
              )}{' '}
              operation
              {failedCount ===
              1
                ? ''
                : 's'}{' '}
              need attention.
            </span>
          )}

          {syncError &&
            typeof syncError ===
              'string' && (
              <span className="titech-offline-status-banner__error">
                {syncError}
              </span>
            )}
        </div>

        <div className="titech-offline-status-banner__actions">
          {(status ===
            STATUS.OFFLINE ||
            status ===
              STATUS.ERROR ||
            pendingCount >
              0) && (
            <button
              type="button"
              className="titech-offline-status-banner__action"
              onClick={
                handleReconnect
              }
              disabled={
                retrying ||
                reconnecting
              }
              aria-label={
                status ===
                STATUS.OFFLINE
                  ? 'Check connection and synchronize'
                  : 'Synchronize pending operations'
              }
            >
              {retrying
                ? 'Syncing…'
                : reconnecting
                  ? 'Checking…'
                  : 'Sync now'}
            </button>
          )}

          {showWhenOnline && (
            <button
              type="button"
              className="titech-offline-status-banner__dismiss"
              onClick={() =>
                setDismissed(
                  true
                )
              }
              aria-label="Dismiss offline status"
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/*
|--------------------------------------------------------------------------
| PropTypes
|--------------------------------------------------------------------------
*/

OfflineStatusBanner.propTypes = {
  sync: PropTypes.shape({
    isOnline:
      PropTypes.bool,
    online:
      PropTypes.bool,
    syncing:
      PropTypes.bool,
    isSyncing:
      PropTypes.bool,

    pendingCount:
      PropTypes.number,
    queuedCount:
      PropTypes.number,
    pending:
      PropTypes.number,
    queueLength:
      PropTypes.number,

    failedCount:
      PropTypes.number,
    failed:
      PropTypes.number,

    error:
      PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.object,
      ]),

    syncError:
      PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.object,
      ]),

    lastSyncedAt:
      PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.instanceOf(
          Date
        ),
      ]),

    lastSyncAt:
      PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.instanceOf(
          Date
        ),
      ]),

    sync:
      PropTypes.func,
    synchronize:
      PropTypes.func,
    syncNow:
      PropTypes.func,
    retry:
      PropTypes.func,
  }),

  showWhenOnline:
    PropTypes.bool,

  showPendingWhenOnline:
    PropTypes.bool,

  position:
    PropTypes.oneOf([
      'top',
      'bottom',
    ]),

  className:
    PropTypes.string,

  reconnectDelay:
    PropTypes.number,

  dismissDuration:
    PropTypes.number,

  onStatusChange:
    PropTypes.func,
};

/*
|--------------------------------------------------------------------------
| Defaults
|--------------------------------------------------------------------------
*/

OfflineStatusBanner.defaultProps = {
  sync: null,
  showWhenOnline: false,
  showPendingWhenOnline: true,
  position: 'top',
  className: '',
  reconnectDelay:
    DEFAULT_RECONNECT_DELAY,
  dismissDuration:
    DEFAULT_DISMISS_DURATION,
  onStatusChange: undefined,
};

/*
|--------------------------------------------------------------------------
| Export
|--------------------------------------------------------------------------
*/

export default memo(
  OfflineStatusBanner
);