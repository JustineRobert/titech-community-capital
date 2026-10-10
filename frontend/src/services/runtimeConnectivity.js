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
  HTTP_SERVER_ERROR: 'HTTP_SERVER_ERROR',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  REQUEST_CANCELLED: 'REQUEST_CANCELLED',
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
let probeController = null;
let probeGeneration = 0;
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

function checkedAt(metadata) {
  return metadata.checkedAt || new Date().toISOString();
}

function latency(metadata) {
  return Number.isFinite(metadata.latencyMs) ? metadata.latencyMs : null;
}

function statusCode(metadata) {
  return Number.isFinite(metadata.status) ? metadata.status : null;
}

function invalidateActiveProbe() {
  probeGeneration += 1;
  if (probeController) {
    try {
      probeController.abort();
    } catch {
      // A cancellation failure must not block state transition.
    }
  }
  probeController = null;
  probePromise = null;
  lastProbeStartedAt = 0;
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

  // Online/offline events invalidate any old result so a probe started for a
  // previous network epoch cannot overwrite a newer OFFLINE/CHECKING state.
  invalidateActiveProbe();

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
    apiReachable: false,
    status: API_CONNECTIVITY_STATUS.CHECKING,
    ready: false,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastHttpStatus: null,
  });
}

export function setApiConnectivityReady(metadata = {}) {
  return emit({
    browserOnline: true,
    apiReachable: true,
    status: API_CONNECTIVITY_STATUS.READY,
    ready: true,
    lastCheckedAt: checkedAt(metadata),
    lastLatencyMs: latency(metadata),
    lastHttpStatus: statusCode(metadata),
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
    lastCheckedAt: checkedAt(metadata),
    lastLatencyMs: latency(metadata),
    lastHttpStatus: statusCode(metadata),
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
    lastCheckedAt: checkedAt(metadata),
    lastLatencyMs: latency(metadata),
    lastHttpStatus: statusCode(metadata),
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
    lastCheckedAt: checkedAt(metadata),
    lastLatencyMs: latency(metadata),
    lastHttpStatus: statusCode(metadata),
    lastErrorCode: metadata.code || 'TITECH_API_UNAVAILABLE',
    lastErrorMessage: metadata.message || 'TITech API is unavailable.',
  });
}

export function setApiConnectivityServerError(metadata = {}) {
  return emit({
    browserOnline: true,
    // A received 5xx response proves the HTTP service was reached, but not
    // that the application is ready to serve authentication or domain work.
    apiReachable: Number.isFinite(metadata.status),
    status: API_CONNECTIVITY_STATUS.HTTP_SERVER_ERROR,
    ready: false,
    lastCheckedAt: checkedAt(metadata),
    lastLatencyMs: latency(metadata),
    lastHttpStatus: statusCode(metadata),
    lastErrorCode: metadata.code || 'HTTP_SERVER_ERROR',
    lastErrorMessage: metadata.message || 'TITech API returned a server error.',
  });
}

export function setApiConnectivityTimeout(metadata = {}) {
  return emit({
    browserOnline: true,
    apiReachable: Number.isFinite(metadata.status),
    status: API_CONNECTIVITY_STATUS.REQUEST_TIMEOUT,
    ready: false,
    lastCheckedAt: checkedAt(metadata),
    lastLatencyMs: latency(metadata),
    lastHttpStatus: statusCode(metadata),
    lastErrorCode: metadata.code || 'REQUEST_TIMEOUT',
    lastErrorMessage: metadata.message || 'TITech API readiness check timed out.',
  });
}

export function setApiConnectivityCancelled(metadata = {}) {
  return emit({
    browserOnline:
      metadata.browserOnline !== undefined
        ? Boolean(metadata.browserOnline)
        : typeof navigator === 'undefined' || navigator.onLine !== false,
    apiReachable: metadata.reachable === true,
    status: API_CONNECTIVITY_STATUS.REQUEST_CANCELLED,
    ready: false,
    lastCheckedAt: checkedAt(metadata),
    lastLatencyMs: latency(metadata),
    lastHttpStatus: statusCode(metadata),
    lastErrorCode: metadata.code || 'REQUEST_CANCELLED',
    lastErrorMessage: metadata.message || 'TITech API readiness check was cancelled.',
  });
}

function isCancellation(error) {
  return error?.code === 'ERR_CANCELED' ||
    error?.name === 'CanceledError' ||
    error?.name === 'AbortError';
}

function isTimeout(error) {
  return ['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'AUTH_TIMEOUT'].includes(
    String(error?.code || '').toUpperCase(),
  ) || /timeout|timed out/i.test(String(error?.message || ''));
}

/**
 * Execute one shared API availability/readiness probe. Multiple callers share
 * one in-flight request. Offline/online transitions cancel and invalidate the
 * prior probe, preventing late responses from restoring stale readiness.
 */
export function probeApiConnectivity(
  probe,
  { force = false, minIntervalMs = 5000 } = {},
) {
  if (typeof probe !== 'function') {
    throw new TypeError('A connectivity probe function is required.');
  }

  if (state.status === API_CONNECTIVITY_STATUS.OFFLINE) {
    return Promise.resolve(state);
  }

  if (probePromise) {
    return probePromise;
  }

  const now = Date.now();
  if (!force && now - lastProbeStartedAt < minIntervalMs) {
    return Promise.resolve(state);
  }

  lastProbeStartedAt = now;
  const generation = ++probeGeneration;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  probeController = controller;

  emit({
    status: API_CONNECTIVITY_STATUS.CHECKING,
    ready: false,
    lastErrorCode: null,
    lastErrorMessage: null,
  });

  // Defer invoking the probe to ensure probePromise is assigned before any
  // user-supplied probe can synchronously throw.
  probePromise = Promise.resolve()
    .then(() => probe(controller?.signal))
    .then((result) => {
      if (generation !== probeGeneration || state.status === API_CONNECTIVITY_STATUS.OFFLINE) {
        return state;
      }

      if (result?.cancelled === true) {
        return setApiConnectivityCancelled({
          ...result,
          checkedAt: new Date().toISOString(),
        });
      }
      if (result?.timeout === true) {
        return setApiConnectivityTimeout({
          ...result,
          checkedAt: new Date().toISOString(),
        });
      }
      if (result?.serverError === true) {
        return setApiConnectivityServerError({
          ...result,
          checkedAt: new Date().toISOString(),
        });
      }
      if (result?.degraded === true) {
        return setApiConnectivityDegraded({
          ...result,
          checkedAt: new Date().toISOString(),
        });
      }
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
    })
    .catch((error) => {
      if (generation !== probeGeneration || state.status === API_CONNECTIVITY_STATUS.OFFLINE) {
        return state;
      }

      const metadata = {
        status: error?.response?.status,
        code: error?.code,
        message: error?.message,
        checkedAt: new Date().toISOString(),
      };

      if (isCancellation(error)) return setApiConnectivityCancelled(metadata);
      if (isTimeout(error)) return setApiConnectivityTimeout(metadata);
      if (Number.isFinite(metadata.status) && metadata.status >= 500) {
        return setApiConnectivityServerError(metadata);
      }
      if (Number.isFinite(metadata.status)) return setApiConnectivityDegraded(metadata);
      return setApiConnectivityUnavailable(metadata);
    })
    .finally(() => {
      if (generation === probeGeneration) {
        probePromise = null;
        probeController = null;
      }
    });

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
