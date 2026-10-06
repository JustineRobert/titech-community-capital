// ============================================================================
// TITech Community Capital — Runtime connectivity state
// ============================================================================
// Single shared browser/API connectivity state machine.
// It deliberately contains no Axios, React or authentication logic.
// ============================================================================

'use strict';

export const API_CONNECTIVITY_STATUS = Object.freeze({
  CHECKING: 'CHECKING',
  READY: 'READY',
  API_REACHABLE: 'API_REACHABLE',
  API_DEGRADED: 'API_DEGRADED',
  API_UNAVAILABLE: 'API_UNAVAILABLE',
  OFFLINE: 'OFFLINE',
  // Backward-compatible alias for existing consumers.
  DEGRADED: 'API_DEGRADED',
});

const listeners = new Set();

let state = Object.freeze({
  status:
    typeof navigator !== 'undefined' && navigator.onLine === false
      ? API_CONNECTIVITY_STATUS.OFFLINE
      : API_CONNECTIVITY_STATUS.CHECKING,
  browserOnline:
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  apiReachable: false,
  ready: false,
  lastCheckedAt: null,
  lastLatencyMs: null,
  lastHttpStatus: null,
  lastErrorCode: null,
  lastErrorMessage: null,
});

let probePromise = null;
let lastProbeStartedAt = 0;

function emit(nextState) {
  state = Object.freeze({ ...state, ...nextState });

  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      // A subscriber must never break the connectivity state machine.
    }
  }

  return state;
}

export function getApiConnectivityState() {
  return state;
}

export function onApiConnectivityChange(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  listeners.add(listener);

  try {
    listener(state);
  } catch {
    // Initial notification failures are isolated.
  }

  return () => listeners.delete(listener);
}

export function setBrowserConnectivity(online) {
  const browserOnline = Boolean(online);

  if (!browserOnline) {
    return emit({
      browserOnline: false,
      apiReachable: false,
      ready: false,
      status: API_CONNECTIVITY_STATUS.OFFLINE,
      lastErrorCode: 'CLIENT_OFFLINE',
      lastErrorMessage: 'The browser reports that the device is offline.',
      lastHttpStatus: null,
    });
  }

  return emit({
    browserOnline: true,
    status: API_CONNECTIVITY_STATUS.CHECKING,
    ready: false,
    lastErrorCode: null,
    lastErrorMessage: null,
  });
}

export function setApiConnectivityReady(metadata = {}) {
  return emit({
    browserOnline: true,
    apiReachable: true,
    status: API_CONNECTIVITY_STATUS.READY,
    ready: true,
    lastCheckedAt: metadata.checkedAt || new Date().toISOString(),
    lastLatencyMs: Number.isFinite(metadata.latencyMs) ? metadata.latencyMs : null,
    lastHttpStatus: Number.isFinite(metadata.status) ? metadata.status : null,
    lastErrorCode: null,
    lastErrorMessage: null,
  });
}

export function setApiConnectivityReachable(metadata = {}) {
  return emit({
    browserOnline:
      metadata.browserOnline !== undefined
        ? Boolean(metadata.browserOnline)
        : typeof navigator === 'undefined' || navigator.onLine !== false,
    apiReachable: true,
    status: API_CONNECTIVITY_STATUS.API_REACHABLE,
    ready: false,
    lastCheckedAt: metadata.checkedAt || new Date().toISOString(),
    lastLatencyMs: Number.isFinite(metadata.latencyMs) ? metadata.latencyMs : null,
    lastHttpStatus: Number.isFinite(metadata.status) ? metadata.status : null,
    lastErrorCode: metadata.code || null,
    lastErrorMessage: metadata.message || null,
  });
}

export function setApiConnectivityDegraded(metadata = {}) {
  const offline = metadata.offline === true;

  return emit({
    browserOnline:
      metadata.browserOnline !== undefined
        ? Boolean(metadata.browserOnline)
        : typeof navigator === 'undefined' || navigator.onLine !== false,
    apiReachable: !offline,
    status: offline
      ? API_CONNECTIVITY_STATUS.OFFLINE
      : API_CONNECTIVITY_STATUS.API_DEGRADED,
    ready: false,
    lastCheckedAt: metadata.checkedAt || new Date().toISOString(),
    lastLatencyMs: Number.isFinite(metadata.latencyMs) ? metadata.latencyMs : null,
    lastHttpStatus: Number.isFinite(metadata.status) ? metadata.status : null,
    lastErrorCode: metadata.code || (offline ? 'CLIENT_OFFLINE' : 'API_NOT_READY'),
    lastErrorMessage:
      metadata.message || (offline ? 'The browser reports that the device is offline.' : 'TITech API is degraded.'),
  });
}

export function setApiConnectivityUnavailable(metadata = {}) {
  return emit({
    browserOnline: true,
    apiReachable: false,
    status: API_CONNECTIVITY_STATUS.API_UNAVAILABLE,
    ready: false,
    lastCheckedAt: metadata.checkedAt || new Date().toISOString(),
    lastLatencyMs: Number.isFinite(metadata.latencyMs) ? metadata.latencyMs : null,
    lastHttpStatus: Number.isFinite(metadata.status) ? metadata.status : null,
    lastErrorCode: metadata.code || 'TITECH_API_UNAVAILABLE',
    lastErrorMessage: metadata.message || 'TITech API is unavailable.',
  });
}

/**
 * Execute one shared API availability/readiness probe.
 * Multiple callers receive the same in-flight promise and cooldown semantics.
 */
export async function probeApiConnectivity(
  probe,
  { force = false, minIntervalMs = 5000 } = {},
) {
  if (typeof probe !== 'function') {
    throw new TypeError('A connectivity probe function is required.');
  }

  if (state.status === API_CONNECTIVITY_STATUS.OFFLINE) {
    return state;
  }

  if (probePromise) {
    return probePromise;
  }

  const now = Date.now();

  if (!force && now - lastProbeStartedAt < minIntervalMs) {
    return state;
  }

  lastProbeStartedAt = now;
  emit({
    status: API_CONNECTIVITY_STATUS.CHECKING,
    ready: false,
    lastErrorCode: null,
    lastErrorMessage: null,
  });

  probePromise = (async () => {
    try {
      const result = await probe();

      if (result?.healthy === true) {
        return setApiConnectivityReady({
          status: result.status,
          latencyMs: result.latency,
          checkedAt: new Date().toISOString(),
        });
      }

      if (result?.reachable === true) {
        return setApiConnectivityReachable({
          status: result.status,
          latencyMs: result.latency,
          code: result.code,
          message: result.message,
          checkedAt: new Date().toISOString(),
        });
      }

      if (result?.offline === true) {
        return setApiConnectivityDegraded({
          ...result,
          offline: true,
          checkedAt: new Date().toISOString(),
        });
      }

      if (result?.unavailable === true) {
        return setApiConnectivityUnavailable({
          ...result,
          checkedAt: new Date().toISOString(),
        });
      }

      return setApiConnectivityDegraded({
        ...result,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      const isOffline = error?.isOffline === true;
      const responseStatus = error?.response?.status;

      if (isOffline) {
        return setApiConnectivityDegraded({
          status: responseStatus,
          code: error?.code || 'CLIENT_OFFLINE',
          message: error?.message || 'The browser reports that the device is offline.',
          offline: true,
          checkedAt: new Date().toISOString(),
        });
      }

      return setApiConnectivityUnavailable({
        status: responseStatus,
        code: error?.code || 'TITECH_API_UNAVAILABLE',
        message: error?.message || 'TITech API is unavailable.',
        checkedAt: new Date().toISOString(),
      });
    } finally {
      probePromise = null;
    }
  })();

  return probePromise;
}

function handleOnline() {
  setBrowserConnectivity(true);
}

function handleOffline() {
  setBrowserConnectivity(false);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
}
