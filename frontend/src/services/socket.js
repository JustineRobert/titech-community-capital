// ============================================================================
// TITech Community Capital
// Enterprise Socket.IO Client Service
// File: frontend/src/services/socket.js
// Production Grade
// Multi-Tenant | JWT Auth | Reconnection | Notifications | Presence
// ============================================================================

import { io } from "socket.io-client";
import {
  getDeviceId as getApiDeviceId,
  getTenant as getApiTenant,
  getToken as getApiToken,
} from './api.js';

// ============================================================================
// Configuration
// ============================================================================

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  import.meta.env.VITE_API_URL ||
  (
    import.meta.env.PROD &&
    typeof window !== 'undefined' &&
    window.location?.origin
      ? window.location.origin
      : "http://localhost:5000"
  );

const EFFECTIVE_SOCKET_URL =
  SOCKET_URL ||
  (
    typeof window !== 'undefined' &&
    window.location?.origin
      ? window.location.origin
      : '/'
  );

const MAX_RECONNECT_ATTEMPTS =
  Number(
    import.meta.env.VITE_SOCKET_RETRIES
  ) || 10;

// ============================================================================
// Token Helpers
// ============================================================================

function getToken() {
  return getApiToken();
}

function getTenantId() {
  return getApiTenant();
}

function getDeviceIdFromApiState() {
  return getApiDeviceId();
}

function getCorrelationId() {
  return crypto.randomUUID();
}

// ============================================================================
// Socket Instance
// ============================================================================

const socket = io(
  EFFECTIVE_SOCKET_URL,
  {
    autoConnect: false,
    withCredentials: true,

    transports: [
      "websocket",
      "polling",
    ],

    reconnection: true,
    reconnectionAttempts:
      MAX_RECONNECT_ATTEMPTS,
    reconnectionDelay:
      1000,
    reconnectionDelayMax:
      10000,
    randomizationFactor:
      0.5,
    timeout: 20000,

    auth: {
      token:
        getToken(),
      tenantId:
        getTenantId(),
      deviceId:
        getDeviceIdFromApiState(),
      correlationId:
        getCorrelationId(),
    },
  }
);

// ============================================================================
// Internal State
// ============================================================================

let initialized =
  false;

let manuallyDisconnected =
  false;

// ============================================================================
// Update Auth Payload
// ============================================================================

function updateAuth() {
  socket.auth = {
    token:
      getToken(),
    tenantId:
      getTenantId(),
    deviceId:
      getDeviceIdFromApiState(),
    correlationId:
      getCorrelationId(),
  };
}

// ============================================================================
// Connect
// ============================================================================

export function connectSocket() {
  if (
    socket.connected
  ) {
    return socket;
  }

  manuallyDisconnected =
    false;

  updateAuth();

  socket.connect();

  return socket;
}

// ============================================================================
// Disconnect
// ============================================================================

export function disconnectSocket() {
  manuallyDisconnected =
    true;

  socket.removeAllListeners();

  socket.disconnect();
}

// ============================================================================
// Reconnect
// ============================================================================

export function reconnectSocket() {
  updateAuth();

  socket.disconnect();
  socket.connect();
}

// ============================================================================
// Tenant Switching
// ============================================================================

export function switchTenant(
  tenantId
) {
  localStorage.setItem(
    TENANT_KEY,
    JSON.stringify({
      id: tenantId,
    })
  );

  reconnectSocket();
}

// ============================================================================
// Authentication Updates
// ============================================================================

export function updateSocketToken(
  token
) {
  if (token) {
    localStorage.setItem(
      TOKEN_KEY,
      token
    );
  } else {
    localStorage.removeItem(
      TOKEN_KEY
    );
  }

  updateAuth();

  if (
    socket.connected
  ) {
    reconnectSocket();
  }
}

// ============================================================================
// Event Subscription Helpers
// ============================================================================

export function subscribe(
  event,
  callback
) {
  socket.on(
    event,
    callback
  );

  return () =>
    socket.off(
      event,
      callback
    );
}

export function once(
  event,
  callback
) {
  socket.once(
    event,
    callback
  );
}

export function unsubscribe(
  event,
  callback
) {
  socket.off(
    event,
    callback
  );
}

// ============================================================================
// Emit Helpers
// ============================================================================

export function emit(
  event,
  payload = {},
  ack
) {
  if (
    typeof ack ===
    "function"
  ) {
    socket.emit(
      event,
      payload,
      ack
    );

    return;
  }

  socket.emit(
    event,
    payload
  );
}

export function emitAsync(
  event,
  payload = {}
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      socket.timeout(
        10000
      ).emit(
        event,
        payload,
        (
          error,
          response
        ) => {
          if (error) {
            reject(
              error
            );
            return;
          }

          resolve(
            response
          );
        }
      );
    }
  );
}

// ============================================================================
// Presence API
// ============================================================================

export function setPresence(
  status =
    "online"
) {
  emit(
    "presence:update",
    {
      status,
      tenantId:
        getTenantId(),
    }
  );
}

// ============================================================================
// Notification Helpers
// ============================================================================

export function subscribeNotifications(
  callback
) {
  return subscribe(
    "notification",
    callback
  );
}

export function subscribeAlerts(
  callback
) {
  return subscribe(
    "alert",
    callback
  );
}

export function subscribeTransactions(
  callback
) {
  return subscribe(
    "transaction:update",
    callback
  );
}

export function subscribeLoans(
  callback
) {
  return subscribe(
    "loan:update",
    callback
  );
}

export function subscribeSavings(
  callback
) {
  return subscribe(
    "savings:update",
    callback
  );
}

// ============================================================================
// Lifecycle Initialization
// ============================================================================

export function initializeSocket() {
  if (
    initialized
  ) {
    return socket;
  }

  initialized = true;

  socket.on(
    "connect",
    () => {
      console.info(
        "[Socket] Connected",
        socket.id
      );

      setPresence(
        "online"
      );
    }
  );

  socket.on(
    "disconnect",
    reason => {
      console.info(
        "[Socket] Disconnected:",
        reason
      );
    }
  );

  socket.on(
    "connect_error",
    error => {
      console.error(
        "[Socket] Connection error:",
        error.message
      );

      if (
        error.message.includes(
          "Unauthorized"
        )
      ) {
        disconnectSocket();
      }
    }
  );

  socket.on(
    "reconnect",
    attempt => {
      console.info(
        `[Socket] Reconnected after ${attempt} attempts`
      );
    }
  );

  socket.on(
    "reconnect_attempt",
    attempt => {
      console.info(
        `[Socket] Reconnect attempt ${attempt}`
      );
    }
  );

  socket.on(
    "reconnect_failed",
    () => {
      console.error(
        "[Socket] Reconnect failed"
      );
    }
  );

  window.addEventListener(
    "online",
    () => {
      if (
        !socket.connected &&
        !manuallyDisconnected
      ) {
        connectSocket();
      }
    }
  );

  window.addEventListener(
    "offline",
    () => {
      setPresence(
        "offline"
      );
    }
  );

  return socket;
}

// ============================================================================
// Diagnostics
// ============================================================================

export function getSocketStatus() {
  return {
    connected:
      socket.connected,
    id: socket.id,
    transport:
      socket.io.engine
        ?.transport
        ?.name,
    tenantId:
      getTenantId(),
    authenticated:
      !!getToken(),
  };
}

// ============================================================================
// Export
// ============================================================================

initializeSocket();

export default socket;