// ============================================================================
// TITech Community Capital — Runtime connectivity state
// ============================================================================
// Single shared browser/API connectivity state machine. It deliberately
// contains no Axios, React or authentication logic. One probe is active at a
// time; connectivity transitions abort and invalidate older probes.
// ============================================================================

'use strict';

export const API_CONNECTIVITY_STATUS = Object.freeze({
  CHECKING: 'CHECKING',
  READY: 'READY',
  API_REACHABLE: 'API_REACHABLE',
  API_DEGRADED: 'API_DEGRADED',
  API_UNAVAILABLE: 'API_UNAVAILABLE',
  HTTP_SERVER_ERROR: 'HTTP_SERVER_ERROR',
  // The API answered, but the configured readiness endpoint is not present.
  API_ENDPOINT_ERROR: 'API_ENDPOINT_ERROR',
  // The API answered with an unexpected 4xx; this is not a transport outage.
  API_HTTP_ERROR: 'API_HTTP_ERROR',
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
let lastProbeStartedAt = 0;
let stateRevision = 0;
let browserConnectivityGeneration = 0;
let probeGeneration = 0;

function emit(nextState) {
  stateRevision += 1;
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

function invalidateActiveProbe() {
  probeGeneration += 1;
  if (probeController && !probeController.signal.aborted) {
    try {
      probeController.abort();
    } catch {
      // Aborting is best-effort; generation invalidation remains authoritative.
    }
  }
  probeController = null;
  probePromise = null;
  lastProbeStartedAt = 0;
}

function validMetrics(metadata = {}) {
  return {
    lastCheckedAt: metadata.checkedAt || new Date().toISOString(),
    lastLatencyMs: Number.isFinite(metadata.latencyMs) ? metadata.latencyMs : null,
    lastHttpStatus: Number.isFinite(metadata.status) ? metadata.status : null,
  };
}

export function getApiConnectivityState() {
  return state;
}

export function onApiConnectivityChange(listener) {
  if (typeof listener !== 'function') return () => {};

  listeners.add(listener);
  try {
    listener(state);
  } catch {
    // Initial notification failures are isolated.
  }

  return () => listeners.delete(listener);
}

export function setBrowserConnectivity(online) {
  // Invalidate on every browser connectivity notification, including an
  // 'online' event while already online. A prior probe must never win later.
  invalidateActiveProbe();
  browserConnectivityGeneration += 1;

  if (!online) {
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
  });
}

export function setApiConnectivityReady(metadata = {}) {
  return emit({
    browserOnline: true,
    apiReachable: true,
    status: API_CONNECTIVITY_STATUS.READY,
    ready: true,
    ...validMetrics(metadata),
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
    ...validMetrics(metadata),
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
    ...validMetrics(metadata),
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
    ...validMetrics(metadata),
    lastErrorCode: metadata.code || 'TITECH_API_UNAVAILABLE',
    lastErrorMessage: metadata.message || 'TITech API is unavailable.',
  });
}

export function setApiConnectivityServerError(metadata = {}) {
  return emit({
    browserOnline: true,
    apiReachable: true,
    status: API_CONNECTIVITY_STATUS.HTTP_SERVER_ERROR,
    ready: false,
    ...validMetrics(metadata),
    lastErrorCode: metadata.code || 'HTTP_SERVER_ERROR',
    lastErrorMessage: metadata.message || 'TITech API returned a server error.',
  });
}

export function setApiConnectivityEndpointError(metadata = {}) {
  return emit({
    browserOnline: true,
    apiReachable: true,
    status: API_CONNECTIVITY_STATUS.API_ENDPOINT_ERROR,
    ready: false,
    ...validMetrics(metadata),
    lastErrorCode: metadata.code || 'API_ENDPOINT_MISCONFIGURED',
    lastErrorMessage: metadata.message || 'TITech readiness endpoint was not found.',
  });
}

export function setApiConnectivityHttpError(metadata = {}) {
  return emit({
    browserOnline: true,
    apiReachable: true,
    status: API_CONNECTIVITY_STATUS.API_HTTP_ERROR,
    ready: false,
    ...validMetrics(metadata),
    lastErrorCode: metadata.code || 'API_READINESS_HTTP_ERROR',
    lastErrorMessage: metadata.message || 'TITech readiness endpoint returned an unexpected HTTP error.',
  });
}

export function setApiConnectivityTimeout(metadata = {}) {
  return emit({
    browserOnline: true,
    apiReachable: false,
    status: API_CONNECTIVITY_STATUS.REQUEST_TIMEOUT,
    ready: false,
    ...validMetrics(metadata),
    lastErrorCode: metadata.code || 'REQUEST_TIMEOUT',
    lastErrorMessage: metadata.message || 'The TITech API request timed out.',
  });
}

export function setApiConnectivityCancelled(metadata = {}) {
  return emit({
    status: API_CONNECTIVITY_STATUS.REQUEST_CANCELLED,
    ready: false,
    ...validMetrics(metadata),
    lastErrorCode: metadata.code || 'REQUEST_CANCELLED',
    lastErrorMessage: metadata.message || 'The TITech API request was cancelled.',
  });
}

/**
 * Execute one shared API availability/readiness probe.
 * The probe receives (AbortSignal | undefined, { isCurrent }). The promise is
 * assigned before the probe executes, so synchronous throws and rapid callers
 * are both safely single-flight.
 */
export function probeApiConnectivity(probe, { force = false, minIntervalMs = 5000 } = {}) {
  if (typeof probe !== 'function') {
    throw new TypeError('A connectivity probe function is required.');
  }

  if (state.status === API_CONNECTIVITY_STATUS.OFFLINE || state.browserOnline === false) {
    return Promise.resolve(state);
  }
  if (probePromise) return probePromise;

  const now = Date.now();
  if (!force && now - lastProbeStartedAt < minIntervalMs) {
    return Promise.resolve(state);
  }

  lastProbeStartedAt = now;
  const thisGeneration = ++probeGeneration;
  const thisBrowserGeneration = browserConnectivityGeneration;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  probeController = controller;

  emit({
    status: API_CONNECTIVITY_STATUS.CHECKING,
    ready: false,
    lastErrorCode: null,
    lastErrorMessage: null,
  });

  const thisRevision = stateRevision;
  const isCurrent = () =>
    thisGeneration === probeGeneration &&
    thisBrowserGeneration === browserConnectivityGeneration &&
    thisRevision === stateRevision &&
    state.browserOnline !== false &&
    !controller?.signal.aborted;

  const activePromise = Promise.resolve()
    .then(() => probe(controller?.signal, { isCurrent }))
    .then((result) => {
      if (!isCurrent() || result?.stale === true) return state;
      const checkedAt = new Date().toISOString();
      const details = {
        status: result?.status,
        latencyMs: result?.latency,
        code: result?.code,
        message: result?.message,
        checkedAt,
      };

      if (result?.healthy === true) return setApiConnectivityReady(details);
      if (result?.offline === true) return setApiConnectivityDegraded({ ...details, offline: true });
      if (result?.cancelled === true) return setApiConnectivityCancelled(details);
      if (result?.timeout === true) return setApiConnectivityTimeout(details);
      if (result?.serverError === true) return setApiConnectivityServerError(details);
      if (result?.endpointError === true) return setApiConnectivityEndpointError(details);
      if (result?.httpError === true) return setApiConnectivityHttpError(details);
      if (result?.degraded === true || result?.status === 503 || result?.notReady === true) {
        return setApiConnectivityDegraded(details);
      }
      if (result?.reachable === true) return setApiConnectivityReachable(details);
      if (result?.unavailable === true) return setApiConnectivityUnavailable(details);
      return setApiConnectivityDegraded(details);
    })
    .catch((error) => {
      if (!isCurrent()) return state;
      const latency = Date.now() - now;
      const status = error?.response?.status;
      const code = String(error?.code || '');
      const cancelled = error?.name === 'AbortError' || code === 'ERR_CANCELED';
      const timeout = code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(error?.message || '');
      const offline = error?.isOffline === true || (typeof navigator !== 'undefined' && navigator.onLine === false);
      const details = { status, latencyMs: latency, code: error?.code, message: error?.message };

      if (cancelled) return setApiConnectivityCancelled(details);
      if (timeout) return setApiConnectivityTimeout(details);
      if (offline) return setApiConnectivityDegraded({ ...details, offline: true });
      if (status === 503) return setApiConnectivityDegraded({ ...details, code: 'API_NOT_READY' });
      if (Number.isFinite(status) && status >= 500) return setApiConnectivityServerError(details);
      if (status === 404) return setApiConnectivityEndpointError({ ...details, code: 'API_ENDPOINT_MISCONFIGURED' });
      if (Number.isFinite(status) && status >= 400) return setApiConnectivityHttpError({ ...details, code: 'API_READINESS_HTTP_ERROR' });
      return setApiConnectivityUnavailable(details);
    });

  probePromise = activePromise.finally(() => {
    // An old promise must not clear a newer probe after recovery/retry.
    if (thisGeneration === probeGeneration) {
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
