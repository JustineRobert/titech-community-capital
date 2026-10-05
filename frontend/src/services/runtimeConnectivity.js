// ============================================================================
// TITech Community Capital
// Runtime connectivity state
//
// Purpose:
//   Single, framework-agnostic source of truth for browser/network and
//   TITech API readiness state. It intentionally contains no Axios, React,
//   authentication, or business-domain logic so it can be consumed by the
//   API client, authentication boundary, notification boundary, and app shell
//   without circular dependencies.
// ============================================================================

"use strict";

export const API_CONNECTIVITY_STATUS = Object.freeze({
  CHECKING: "CHECKING",
  READY: "READY",
  DEGRADED: "DEGRADED",
  OFFLINE: "OFFLINE",
});

const listeners = new Set();

let state = Object.freeze({
  status:
    typeof navigator !== "undefined" && navigator.onLine === false
      ? API_CONNECTIVITY_STATUS.OFFLINE
      : API_CONNECTIVITY_STATUS.CHECKING,
  browserOnline:
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
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
  state = Object.freeze({
    ...state,
    ...nextState,
  });

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
  if (typeof listener !== "function") {
    return () => {};
  }

  listeners.add(listener);

  try {
    listener(state);
  } catch {
    // Initial notification failure is isolated from the state machine.
  }

  return () => {
    listeners.delete(listener);
  };
}

export function setBrowserConnectivity(online) {
  const browserOnline = Boolean(online);

  return emit({
    browserOnline,
    status: browserOnline
      ? API_CONNECTIVITY_STATUS.CHECKING
      : API_CONNECTIVITY_STATUS.OFFLINE,
    ready: false,
    lastErrorCode: browserOnline ? null : "CLIENT_OFFLINE",
    lastErrorMessage: browserOnline
      ? null
      : "The browser reports that the device is offline.",
  });
}

export function setApiConnectivityReady(metadata = {}) {
  return emit({
    browserOnline: true,
    status: API_CONNECTIVITY_STATUS.READY,
    ready: true,
    lastCheckedAt: metadata.checkedAt || new Date().toISOString(),
    lastLatencyMs:
      Number.isFinite(metadata.latencyMs) ? metadata.latencyMs : null,
    lastHttpStatus:
      Number.isFinite(metadata.status) ? metadata.status : null,
    lastErrorCode: null,
    lastErrorMessage: null,
  });
}

export function setApiConnectivityDegraded(metadata = {}) {
  return emit({
    browserOnline:
      metadata.browserOnline !== undefined
        ? Boolean(metadata.browserOnline)
        : typeof navigator === "undefined" || navigator.onLine !== false,
    status:
      metadata.offline === true
        ? API_CONNECTIVITY_STATUS.OFFLINE
        : API_CONNECTIVITY_STATUS.DEGRADED,
    ready: false,
    lastCheckedAt: metadata.checkedAt || new Date().toISOString(),
    lastLatencyMs:
      Number.isFinite(metadata.latencyMs) ? metadata.latencyMs : null,
    lastHttpStatus:
      Number.isFinite(metadata.status) ? metadata.status : null,
    lastErrorCode: metadata.code || null,
    lastErrorMessage: metadata.message || "TITech API is unavailable.",
  });
}

/**
 * Execute one shared API readiness probe.
 *
 * Multiple callers receive the same in-flight promise. Calls made within the
 * cooldown window reuse the latest state instead of hammering the API.
 */
export async function probeApiConnectivity(
  probe,
  {
    force = false,
    minIntervalMs = 5000,
  } = {},
) {
  if (typeof probe !== "function") {
    throw new TypeError("A readiness probe function is required.");
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
  });

  probePromise = (async () => {
    try {
      const result = await probe();
      const healthy = Boolean(result?.healthy);

      if (healthy) {
        return setApiConnectivityReady({
          status: result?.status,
          latencyMs: result?.latency,
          checkedAt: new Date().toISOString(),
        });
      }

      return setApiConnectivityDegraded({
        status: result?.status,
        latencyMs: result?.latency,
        code: result?.code || null,
        message: result?.message,
        offline: result?.offline === true,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      return setApiConnectivityDegraded({
        status: error?.response?.status,
        latencyMs: null,
        code: error?.code || "API_PROBE_FAILED",
        message: error?.message || "TITech API readiness probe failed.",
        offline: error?.isOffline === true,
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

if (typeof window !== "undefined") {
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
}
