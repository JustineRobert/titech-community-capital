// ============================================================================
// TITech Community Capital
// Enterprise Authentication Provider
//
// File:
// frontend/src/context/AuthProvider.jsx
//
// Production Grade
// Secure JWT | HttpOnly Refresh Cookie | Multi-Tenant
// Single-Flight Refresh | Socket Lifecycle | Session Bootstrap
// Offline Awareness | Cross-Tab Session Events
// React StrictMode Safe | Session Generation Protection
// Defensive Async Cleanup | Session Recovery
//
// ============================================================================
//
// SECURITY MODEL
// ============================================================================
//
// Access Token:
//   - Memory only.
//   - Never persisted to localStorage.
//   - Never persisted to sessionStorage.
//
// Refresh Token:
//   - Managed exclusively by backend.
//   - Expected in HttpOnly + Secure + SameSite cookie.
//   - Never exposed to JavaScript.
//
// Axios:
//   - Centralized in ../services/api.
//   - This context MUST NOT create another Axios instance.
//
// AUTHORITY MODEL
// ============================================================================
//
// Backend:
//   - Authoritative for authentication.
//   - Authoritative for authorization.
//   - Authoritative for tenant access.
//   - Authoritative for session validity.
//
// Frontend:
//   - Holds short-lived access-token state in memory.
//   - Schedules proactive refresh.
//   - Hydrates the authenticated user.
//   - Synchronizes backend-confirmed tenant read-model state.
//   - Manages realtime connection lifecycle.
//   - Provides UI/session state.
//   - NEVER makes authorization decisions based solely on decoded JWT claims.
//
// ============================================================================

"use strict";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import PropTypes from "prop-types";
import AuthContext from "./AuthContext";
import { toast } from "react-toastify";

import socket, {
  connectSocket,
} from "../services/socket";

import {
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  refreshToken as apiRefreshToken,
  getToken,
  setToken,
  clearToken,
  setTenant,
  clearTenant,
  isOnline,
  onNetworkStateChange,
  get as apiGet,
} from "../services/api";

// ============================================================================
// MODULE BOUNDARY
// ============================================================================
//
// AuthProvider.jsx intentionally exports only the React provider component.
// AuthContext.jsx owns the context object, and useAuth.js owns the consumer
// hook. This keeps Fast Refresh module boundaries stable and prevents the
// provider module from mixing component and non-component exports.
//
// ============================================================================

// ============================================================================
// Configuration
// ============================================================================

const IS_DEV =
  Boolean(import.meta.env.DEV);

const TOKEN_REFRESH_BUFFER_SECONDS =
  120;

const AUTH_CHANNEL_NAME =
  "titech-auth";

const AUTH_ME_ENDPOINT =
  "/api/auth/me";

const REFRESH_RETRY_COOLDOWN_MS =
  5000;

const AUTH_BOOTSTRAP_TIMEOUT_MS =
  30000;

// ============================================================================
// JWT Helpers
// ============================================================================
//
// IMPORTANT:
// These functions are ONLY for client-side scheduling.
//
// They are NOT:
//   - authorization checks
//   - permission checks
//   - tenant-access checks
//   - security validation
//
// The backend remains authoritative.
// ============================================================================

function parseJwt(token) {
  try {
    if (
      typeof token !== "string" ||
      !token
    ) {
      return null;
    }

    const parts =
      token.split(".");

    if (
      parts.length !== 3
    ) {
      return null;
    }

    const base64 =
      parts[1]
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    const padded =
      base64.padEnd(
        Math.ceil(
          base64.length / 4
        ) * 4,
        "="
      );

    const json =
      atob(padded);

    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getTokenExpiry(token) {
  const payload =
    parseJwt(token);

  if (
    !payload ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  return payload.exp * 1000;
}

function isTokenExpired(token) {
  const expiry =
    getTokenExpiry(token);

  if (!expiry) {
    return true;
  }

  return expiry <= Date.now();
}

function getRefreshDelay(token) {
  const expiry =
    getTokenExpiry(token);

  if (!expiry) {
    return null;
  }

  const refreshAt =
    expiry -
    TOKEN_REFRESH_BUFFER_SECONDS *
      1000;

  return Math.max(
    refreshAt - Date.now(),
    0
  );
}

// ============================================================================
// Error Helpers
// ============================================================================

function getErrorStatus(error) {
  return (
    error?.response?.status ??
    error?.status ??
    error?.statusCode ??
    null
  );
}

function isAuthenticationError(error) {
  const status =
    getErrorStatus(error);

  return (
    status === 401 ||
    status === 403
  );
}

function isNetworkError(error) {
  if (!error) {
    return false;
  }

  if (
    error?.code ===
    "ERR_NETWORK"
  ) {
    return true;
  }

  if (
    error?.code ===
    "ECONNABORTED"
  ) {
    return true;
  }

  if (
    error?.message &&
    /network|offline|timeout|fetch failed/i.test(
      error.message
    )
  ) {
    return true;
  }

  return false;
}

// ============================================================================
// Response Helpers
// ============================================================================

function extractAccessToken(response) {
  return (
    response?.accessToken ||
    response?.data?.accessToken ||
    response?.data?.token ||
    response?.token ||
    null
  );
}

function normalizeUser(response) {
  if (!response) {
    return null;
  }

  return (
    response?.data?.user ||
    response?.data?.profile ||
    response?.user ||
    response?.profile ||
    response?.data ||
    response ||
    null
  );
}

function extractTenantId(
  response,
  profile
) {
  return (
    response?.data?.tenantId ||
    response?.tenantId ||
    profile?.tenantId ||
    profile?.tenant?.id ||
    profile?.tenant?._id ||
    null
  );
}

// ============================================================================
// Safe Development Logging
// ============================================================================

function devLog(
  level,
  message,
  metadata
) {
  if (!IS_DEV) {
    return;
  }

  try {
    const logger =
      console[level] ||
      console.info;

    if (
      metadata !== undefined
    ) {
      logger(
        message,
        metadata
      );
    } else {
      logger(message);
    }
  } catch {
    // Authentication must never depend on logging.
  }
}

// ============================================================================
// Safe Timeout
// ============================================================================

function withTimeout(
  promise,
  timeoutMs,
  message
) {
  let timeoutId = null;

  const timeoutPromise =
    new Promise(
      (_, reject) => {
        timeoutId =
          setTimeout(() => {
            const error =
              new Error(
                message
              );

            error.code =
              "AUTH_TIMEOUT";

            reject(error);
          }, timeoutMs);
      }
    );

  return Promise.race([
    promise,
    timeoutPromise,
  ]).finally(() => {
    if (
      timeoutId !== null
    ) {
      clearTimeout(
        timeoutId
      );
    }
  });
}

// ============================================================================
// Auth Provider
// ============================================================================

export function AuthProvider({
  children,
}) {
  // ========================================================================
  // State
  // ========================================================================

  const [user, setUser] =
    useState(null);

  /**
   * Tenant identity is session state, not authorization state.
   *
   * IMPORTANT:
   * - Do not initialize this from persisted client storage.
   * - The authenticated backend response is authoritative.
   * - A tenant is only exposed after the current backend-authenticated
   *   session establishes it.
   */
  const [tenantId, setTenantId] =
    useState(null);

  const [token, setTokenState] =
    useState(() =>
      getToken()
    );

  const [loading, setLoading] =
    useState(true);

  const [online, setOnline] =
    useState(() =>
      isOnline()
    );

  const [refreshing, setRefreshing] =
    useState(false);

  const [
    socketConnected,
    setSocketConnected,
  ] = useState(false);

  const [authError, setAuthError] =
    useState(null);

  // ========================================================================
  // Lifecycle Refs
  // ========================================================================

  const mountedRef =
    useRef(false);

  /**
   * Every authentication lifecycle receives a monotonically increasing
   * generation.
   *
   * Any async operation that started under an older generation is forbidden
   * from mutating the current authentication state.
   *
   * This protects against:
   *
   *   login -> logout -> old refresh completes
   *   logout -> old /me completes
   *   StrictMode mount -> cleanup -> remount
   *   network recovery -> manual logout
   */
  const sessionGenerationRef =
    useRef(0);

  const refreshTimerRef =
    useRef(null);

  const refreshPromiseRef =
    useRef(null);

  const logoutPromiseRef =
    useRef(null);

  const bootstrapPromiseRef =
    useRef(null);

  const bootstrapGenerationRef =
    useRef(null);

  const socketConnectedRef =
    useRef(false);

  const socketListenersAttachedRef =
    useRef(false);

  const lastRefreshFailureRef =
    useRef(0);

  const channelRef =
    useRef(null);

  const userRef =
    useRef(null);

  const loadingRef =
    useRef(true);

  const onlineRef =
    useRef(online);

  // ========================================================================
  // Keep Refs Synchronized
  // ========================================================================

  useEffect(() => {
    userRef.current =
      user;
  }, [user]);

  useEffect(() => {
    loadingRef.current =
      loading;
  }, [loading]);

  useEffect(() => {
    onlineRef.current =
      online;
  }, [online]);

  // ========================================================================
  // Mounted / Generation Helpers
  // ========================================================================

  const isSessionCurrent =
    useCallback(
      generation =>
        mountedRef.current &&
        sessionGenerationRef.current ===
          generation,
      []
    );

  const invalidateSession =
    useCallback(() => {
      sessionGenerationRef.current +=
        1;

      return sessionGenerationRef.current;
    }, []);

  // ========================================================================
  // Access Token State
  // ========================================================================

  const updateAccessToken =
    useCallback(
      (
        accessToken,
        generation = null
      ) => {
        if (
          generation !== null &&
          sessionGenerationRef.current !==
            generation
        ) {
          return false;
        }

        if (
          !accessToken
        ) {
          clearToken();

          if (
            mountedRef.current
          ) {
            setTokenState(
              null
            );
          }

          return true;
        }

        setToken(
          accessToken
        );

        if (
          mountedRef.current
        ) {
          setTokenState(
            accessToken
          );
        }

        return true;
      },
      []
    );

  // ========================================================================
  // Tenant Synchronization
  // ========================================================================

  const synchronizeTenant =
    useCallback(
      (
        response,
        profile
      ) => {
        const resolvedTenantId =
          extractTenantId(
            response,
            profile
          );

        /**
         * SECURITY:
         * Tenant access is backend-authoritative.
         *
         * Do not fall back to a previously persisted tenant here. A cached
         * tenant can belong to a different authenticated identity and must
         * never become authoritative for the current session.
         */
        if (
          typeof resolvedTenantId !== "string" ||
          !resolvedTenantId.trim()
        ) {
          clearTenant();

          if (mountedRef.current) {
            setTenantId(null);
          }

          return null;
        }

        const normalizedTenantId =
          resolvedTenantId.trim();

        setTenant(
          normalizedTenantId
        );

        if (mountedRef.current) {
          setTenantId(
            normalizedTenantId
          );
        }

        return normalizedTenantId;
      },
      []
    );

  // ========================================================================
  // Refresh Timer
  // ========================================================================

  const clearRefreshTimer =
    useCallback(() => {
      if (
        refreshTimerRef.current !== null
      ) {
        clearTimeout(
          refreshTimerRef.current
        );

        refreshTimerRef.current =
          null;
      }
    }, []);

  // ========================================================================
  // Socket State
  // ========================================================================

  const setSocketConnectionState =
    useCallback(
      connected => {
        const normalized =
          Boolean(connected);

        socketConnectedRef.current =
          normalized;

        if (
          mountedRef.current
        ) {
          setSocketConnected(
            normalized
          );
        }
      },
      []
    );

  // ========================================================================
  // Socket Event Lifecycle
  // ========================================================================

  const attachSocketListeners =
    useCallback(() => {
      if (
        !socket ||
        typeof socket.on !==
          "function" ||
        socketListenersAttachedRef.current
      ) {
        return;
      }

      const handleConnect =
        () => {
          setSocketConnectionState(
            true
          );
        };

      const handleDisconnect =
        () => {
          setSocketConnectionState(
            false
          );
        };

      const handleConnectError =
        error => {
          setSocketConnectionState(
            false
          );

          devLog(
            "warn",
            "[AUTH] Socket connection error",
            error
          );
        };

      socket.on(
        "connect",
        handleConnect
      );

      socket.on(
        "disconnect",
        handleDisconnect
      );

      socket.on(
        "connect_error",
        handleConnectError
      );

      socketListenersAttachedRef.current =
        true;
  }, [
    setSocketConnectionState,
  ]);

  const detachSocketListeners =
    useCallback(() => {
      if (
        !socket ||
        typeof socket.off !==
          "function" ||
        !socketListenersAttachedRef.current
      ) {
        return;
      }

      socket.off(
        "connect"
      );

      socket.off(
        "disconnect"
      );

      socket.off(
        "connect_error"
      );

      socketListenersAttachedRef.current =
        false;
  }, []);

  // ========================================================================
  // Socket Connection
  // ========================================================================

  const connectUserSocket =
    useCallback(() => {
      const currentToken =
        getToken();

      if (
        !currentToken ||
        isTokenExpired(
          currentToken
        )
      ) {
        setSocketConnectionState(
          false
        );

        return false;
      }

      attachSocketListeners();

      try {
        const result =
          connectSocket();

        /**
         * Do NOT optimistically mark the socket connected unless the socket
         * service explicitly tells us it is already connected.
         */
        if (
          socket?.connected === true
        ) {
          setSocketConnectionState(
            true
          );
        } else {
          setSocketConnectionState(
            false
          );
        }

        devLog(
          "info",
          "[AUTH] Socket connection requested"
        );

        return (
          result ??
          true
        );
      } catch (error) {
        setSocketConnectionState(
          false
        );

        devLog(
          "error",
          "[AUTH] Socket connection failed",
          error
        );

        return false;
      }
    }, [
      attachSocketListeners,
      setSocketConnectionState,
    ]);

  // ========================================================================
  // Socket Disconnection
  // ========================================================================

  const disconnectUserSocket =
    useCallback(() => {
      try {
        if (
          socket &&
          typeof socket.disconnect ===
            "function"
        ) {
          socket.disconnect();
        }
      } catch (error) {
        devLog(
          "warn",
          "[AUTH] Socket disconnect failed",
          error
        );
      } finally {
        setSocketConnectionState(
          false
        );
      }
    }, [
      setSocketConnectionState,
    ]);

  // ========================================================================
  // User Hydration
  // ========================================================================

  const hydrateUser =
    useCallback(
      async ({
        generation = sessionGenerationRef.current,
        suppressError = false,
      } = {}) => {
        const currentToken =
          getToken();

        if (
          !currentToken ||
          isTokenExpired(
            currentToken
          )
        ) {
          return null;
        }

        try {
          const response =
            await apiGet(
              AUTH_ME_ENDPOINT
            );

          if (
            !isSessionCurrent(
              generation
            )
          ) {
            return null;
          }

          const profile =
            normalizeUser(
              response
            );

          if (!profile) {
            throw new Error(
              "Authenticated session returned an invalid user profile."
            );
          }

          synchronizeTenant(
            response,
            profile
          );

          if (
            mountedRef.current
          ) {
            setUser(
              profile
            );
          }

          return profile;
        } catch (error) {
          if (
            !suppressError &&
            mountedRef.current &&
            isSessionCurrent(
              generation
            )
          ) {
            setAuthError(
              error
            );
          }

          throw error;
        }
      },
      [
        isSessionCurrent,
        synchronizeTenant,
      ]
    );

  // ========================================================================
  // Proactive Refresh Scheduling
  // ========================================================================

  const scheduleRefresh =
    useCallback(
      (
        accessToken,
        generation =
          sessionGenerationRef.current
      ) => {
        clearRefreshTimer();

        if (
          !accessToken ||
          !isSessionCurrent(
            generation
          )
        ) {
          return;
        }

        const delay =
          getRefreshDelay(
            accessToken
          );

        if (
          delay === null
        ) {
          return;
        }

        refreshTimerRef.current =
          setTimeout(() => {
            if (
              !isSessionCurrent(
                generation
              )
            ) {
              return;
            }

            refreshSession({
              reason:
                "scheduled",
              generation,
            }).catch(
              error => {
                devLog(
                  "warn",
                  "[AUTH] Scheduled refresh failed",
                  error
                );
              }
            );
          }, delay);
      },
      [
        clearRefreshTimer,
        isSessionCurrent,
      ]
    );

  // ========================================================================
  // Refresh Session
  // ========================================================================
  //
  // Context-level single-flight.
  //
  // services/api.js remains the HTTP-layer authority and may itself protect
  // refresh calls. This boundary protects authentication-context callers.
  //
  // IMPORTANT:
  // A refresh that started before logout is not allowed to resurrect the
  // authenticated session.
  // ========================================================================

  const refreshSession =
    useCallback(
      async ({
        reason = "manual",
        suppressErrorState = false,
        generation =
          sessionGenerationRef.current,
      } = {}) => {
        if (
          !isSessionCurrent(
            generation
          )
        ) {
          throw new Error(
            "Authentication session is no longer current."
          );
        }

        if (
          refreshPromiseRef.current
        ) {
          return refreshPromiseRef.current;
        }

        const now =
          Date.now();

        if (
          now -
            lastRefreshFailureRef.current <
          REFRESH_RETRY_COOLDOWN_MS
        ) {
          throw new Error(
            "Authentication refresh is temporarily rate limited."
          );
        }

        const operation =
          (async () => {
            if (
              mountedRef.current
            ) {
              setRefreshing(
                true
              );
            }

            try {
              const response =
                await apiRefreshToken();

              const newToken =
                extractAccessToken(
                  response
                );

              if (
                !newToken
              ) {
                throw new Error(
                  "Refresh succeeded but no access token was returned."
                );
              }

              /**
               * Critical stale-operation protection.
               */
              if (
                !isSessionCurrent(
                  generation
                )
              ) {
                return null;
              }

              updateAccessToken(
                newToken,
                generation
              );

              scheduleRefresh(
                newToken,
                generation
              );

              if (
                mountedRef.current
              ) {
                setAuthError(
                  null
                );
              }

              devLog(
                "info",
                "[AUTH] Session refreshed",
                {
                  reason,
                }
              );

              return newToken;
            } catch (error) {
              lastRefreshFailureRef.current =
                Date.now();

              clearRefreshTimer();

              /**
               * Only destroy the token when the operation still belongs to
               * the current session.
               */
              if (
                isSessionCurrent(
                  generation
                )
              ) {
                updateAccessToken(
                  null,
                  generation
                );
              }

              if (
                !suppressErrorState &&
                mountedRef.current &&
                isSessionCurrent(
                  generation
                )
              ) {
                setAuthError(
                  error
                );
              }

              throw error;
            } finally {
              if (
                mountedRef.current
              ) {
                setRefreshing(
                  false
                );
              }
            }
          })();

        refreshPromiseRef.current =
          operation;

        try {
          return await operation;
        } finally {
          if (
            refreshPromiseRef.current ===
            operation
          ) {
            refreshPromiseRef.current =
              null;
          }
        }
      },
      [
        clearRefreshTimer,
        isSessionCurrent,
        scheduleRefresh,
        updateAccessToken,
      ]
    );

  // ========================================================================
  // Broadcast Channel
  // ========================================================================

  const broadcastAuthEvent =
    useCallback(
      (
        type,
        metadata = {}
      ) => {
        try {
          const channel =
            channelRef.current;

          if (
            !channel
          ) {
            return;
          }

          channel.postMessage({
            type,
            timestamp:
              Date.now(),
            ...metadata,
          });
        } catch (error) {
          devLog(
            "warn",
            "[AUTH] BroadcastChannel event failed",
            error
          );
        }
      },
      []
    );

  // ========================================================================
  // Login
  // ========================================================================

  const login =
    useCallback(
      async (
        email,
        password,
        deviceInfo = {},
        options = {}
      ) => {
        if (
          typeof email !== "string" ||
          !email.trim()
        ) {
          throw new Error(
            "Email is required."
          );
        }

        if (
          typeof password !== "string" ||
          !password
        ) {
          throw new Error(
            "Password is required."
          );
        }

        /**
         * New authentication lifecycle.
         *
         * Any previous asynchronous authentication operation becomes stale.
         */
        const generation =
          invalidateSession();

        clearRefreshTimer();

        refreshPromiseRef.current =
          null;

        /**
         * A new login/registration lifecycle must not temporarily expose the
         * previous user's token, tenant or realtime connection.
         */
        updateAccessToken(
          null,
          generation
        );

        clearTenant();
        disconnectUserSocket();

        if (mountedRef.current) {
          setUser(null);
          setTenantId(null);
        }

        setAuthError(
          null
        );

        const response =
          await apiLogin({
            email:
              email.trim(),
            password,
            deviceInfo,
            ...options,
          });

        if (
          !mountedRef.current ||
          sessionGenerationRef.current !==
            generation
        ) {
          return null;
        }

        const accessToken =
          extractAccessToken(
            response
          );

        if (
          !accessToken
        ) {
          throw new Error(
            "Login succeeded but no access token was returned."
          );
        }

        const profile =
          normalizeUser(
            response
          );

        if (!profile) {
          throw new Error(
            "Login succeeded but no authenticated user profile was returned."
          );
        }

        updateAccessToken(
          accessToken,
          generation
        );

        setUser(
          profile
        );

        synchronizeTenant(
          response,
          profile
        );

        scheduleRefresh(
          accessToken,
          generation
        );

        connectUserSocket();

        setAuthError(
          null
        );

        broadcastAuthEvent(
          "AUTH_LOGIN"
        );

        toast.success(
          "Login successful"
        );

        devLog(
          "info",
          "[AUTH] Login successful"
        );

        return profile;
      },
      [
        broadcastAuthEvent,
        clearRefreshTimer,
        connectUserSocket,
        disconnectUserSocket,
        invalidateSession,
        scheduleRefresh,
        synchronizeTenant,
        updateAccessToken,
      ]
    );

  // ========================================================================
  // Register
  // ========================================================================

  const register =
    useCallback(
      async (
        payloadOrEmail,
        password,
        name,
        options = {}
      ) => {
        const payload =
          typeof payloadOrEmail ===
            "object" &&
          payloadOrEmail !== null &&
          !Array.isArray(
            payloadOrEmail
          )
            ? payloadOrEmail
            : {
                email:
                  payloadOrEmail,
                password,
                name,
              };

        const generation =
          invalidateSession();

        clearRefreshTimer();

        refreshPromiseRef.current =
          null;

        /**
         * A new login/registration lifecycle must not temporarily expose the
         * previous user's token, tenant or realtime connection.
         */
        updateAccessToken(
          null,
          generation
        );

        clearTenant();
        disconnectUserSocket();

        if (mountedRef.current) {
          setUser(null);
          setTenantId(null);
        }

        setAuthError(
          null
        );

        const response =
          await apiRegister(
            payload,
            options
          );

        if (
          !mountedRef.current ||
          sessionGenerationRef.current !==
            generation
        ) {
          return null;
        }

        const accessToken =
          extractAccessToken(
            response
          );

        if (
          !accessToken
        ) {
          throw new Error(
            "Registration succeeded but no access token was returned."
          );
        }

        const profile =
          normalizeUser(
            response
          );

        if (!profile) {
          throw new Error(
            "Registration succeeded but no authenticated user profile was returned."
          );
        }

        updateAccessToken(
          accessToken,
          generation
        );

        setUser(
          profile
        );

        synchronizeTenant(
          response,
          profile
        );

        scheduleRefresh(
          accessToken,
          generation
        );

        connectUserSocket();

        setAuthError(
          null
        );

        broadcastAuthEvent(
          "AUTH_LOGIN"
        );

        toast.success(
          "Registration successful"
        );

        devLog(
          "info",
          "[AUTH] Registration successful"
        );

        return profile;
      },
      [
        broadcastAuthEvent,
        clearRefreshTimer,
        connectUserSocket,
        disconnectUserSocket,
        invalidateSession,
        scheduleRefresh,
        synchronizeTenant,
        updateAccessToken,
      ]
    );

  // ========================================================================
  // Logout
  // ========================================================================

  const performLogout =
    useCallback(
      async (
        silent = false,
        notifyUser = true
      ) => {
        if (
          logoutPromiseRef.current
        ) {
          return logoutPromiseRef.current;
        }

        /**
         * Invalidate FIRST.
         *
         * This is intentionally before the backend request.
         *
         * Any refresh, hydration or recovery operation currently in flight
         * is immediately considered stale and cannot restore authentication.
         */
        const generation =
          invalidateSession();

        clearRefreshTimer();

        const operation =
          (async () => {
            try {
              try {
                await apiLogout();
              } catch (error) {
                devLog(
                  "warn",
                  "[AUTH] Logout API failed; continuing local cleanup",
                  error
                );
              }

              /**
               * Do not merely null the promise while a previous refresh is
               * executing. Generation invalidation above is what prevents
               * that operation from writing its result.
               */
              refreshPromiseRef.current =
                null;

              disconnectUserSocket();

              updateAccessToken(
                null,
                generation
              );

              clearTenant();

              if (
                mountedRef.current
              ) {
                setTenantId(
                  null
                );

                setUser(
                  null
                );

                setAuthError(
                  null
                );

                setRefreshing(
                  false
                );
              }

              broadcastAuthEvent(
                "AUTH_LOGOUT"
              );

              if (
                notifyUser &&
                !silent &&
                mountedRef.current
              ) {
                toast.info(
                  "Logged out successfully"
                );
              }

              devLog(
                "info",
                "[AUTH] Logout completed"
              );
            } finally {
              logoutPromiseRef.current =
                null;
            }
          })();

        logoutPromiseRef.current =
          operation;

        return operation;
      },
      [
        broadcastAuthEvent,
        clearRefreshTimer,
        disconnectUserSocket,
        invalidateSession,
        updateAccessToken,
      ]
    );

  // ========================================================================
  // Public Logout
  // ========================================================================

  const logout =
    useCallback(
      async silent => {
        await performLogout(
          Boolean(silent),
          true
        );
      },
      [
        performLogout,
      ]
    );

  // ========================================================================
  // Session Bootstrap
  // ========================================================================
  //
  // Bootstrap is deliberately generation-aware.
  //
  // React StrictMode can execute:
  //
  //   mount
  //   cleanup
  //   mount
  //
  // The first lifecycle is allowed to become stale without preventing the
  // second lifecycle from establishing the session.
  // ========================================================================

  const initializeAuthentication =
    useCallback(
      async () => {
        const generation =
          sessionGenerationRef.current;

        /**
         * Only reuse a bootstrap operation when it belongs to the current
         * authentication generation.
         */
        if (
          bootstrapPromiseRef.current &&
          bootstrapGenerationRef.current ===
            generation
        ) {
          return bootstrapPromiseRef.current;
        }

        const operation =
          (async () => {
            try {
              if (
                mountedRef.current
              ) {
                setAuthError(
                  null
                );
              }

              let currentToken =
                getToken();

              // ============================================================
              // Existing memory-only access token
              // ============================================================

              if (
                currentToken &&
                !isTokenExpired(
                  currentToken
                )
              ) {
                try {
                  const profile =
                    await hydrateUser({
                      generation,
                    });

                  if (
                    !isSessionCurrent(
                      generation
                    )
                  ) {
                    return;
                  }

                  if (
                    profile
                  ) {
                    setUser(
                      profile
                    );

                    scheduleRefresh(
                      currentToken,
                      generation
                    );

                    connectUserSocket();

                    return;
                  }
                } catch (error) {
                  devLog(
                    "warn",
                    "[AUTH] Existing access token could not hydrate session",
                    error
                  );

                  if (
                    isSessionCurrent(
                      generation
                    )
                  ) {
                    updateAccessToken(
                      null,
                      generation
                    );
                  }
                }
              }

              // ============================================================
              // Restore from HttpOnly refresh cookie
              // ============================================================

              if (
                !onlineRef.current
              ) {
                devLog(
                  "info",
                  "[AUTH] Bootstrap deferred because application is offline"
                );

                return;
              }

              const refreshedToken =
                await refreshSession({
                  reason:
                    "bootstrap",
                  suppressErrorState:
                    true,
                  generation,
                });

              if (
                !refreshedToken ||
                !isSessionCurrent(
                  generation
                )
              ) {
                return;
              }

              const profile =
                await hydrateUser({
                  generation,
                });

              if (
                !isSessionCurrent(
                  generation
                )
              ) {
                return;
              }

              if (!profile) {
                throw new Error(
                  "Authenticated refresh completed without a valid user profile."
                );
              }

              setUser(
                profile
              );

              scheduleRefresh(
                refreshedToken,
                generation
              );

              connectUserSocket();
            } catch (error) {
              if (
                !isSessionCurrent(
                  generation
                )
              ) {
                return;
              }

              /**
               * Network failure is not equivalent to logout.
               *
               * When offline, preserve any currently valid local session
               * state rather than destroying it.
               */
              if (
                isNetworkError(error) ||
                !onlineRef.current
              ) {
                devLog(
                  "info",
                  "[AUTH] Authentication bootstrap deferred due to network state"
                );

                return;
              }

              /**
               * 401/403 during session restoration means there is no valid
               * backend-authenticated session.
               */
              if (
                isAuthenticationError(
                  error
                ) ||
                !getToken()
              ) {
                updateAccessToken(
                  null,
                  generation
                );

                clearTenant();

                disconnectUserSocket();

                if (
                  mountedRef.current
                ) {
                  setTenantId(
                    null
                  );

                  setUser(
                    null
                  );

                  setAuthError(
                    null
                  );
                }

                return;
              }

              /**
               * Unknown bootstrap failures should be surfaced to the
               * application instead of silently pretending everything is
               * unauthenticated.
               */
              if (
                mountedRef.current
              ) {
                setAuthError(
                  error
                );
              }

              devLog(
                "error",
                "[AUTH] Authentication bootstrap failed",
                error
              );
            }
          })();

        bootstrapPromiseRef.current =
          operation;

        bootstrapGenerationRef.current =
          generation;

        try {
          await withTimeout(
            operation,
            AUTH_BOOTSTRAP_TIMEOUT_MS,
            "Authentication bootstrap timed out."
          );
        } finally {
          if (
            bootstrapPromiseRef.current ===
            operation
          ) {
            bootstrapPromiseRef.current =
              null;

            bootstrapGenerationRef.current =
              null;
          }
        }
      },
      [
        clearTenant,
        connectUserSocket,
        disconnectUserSocket,
        hydrateUser,
        isSessionCurrent,
        refreshSession,
        scheduleRefresh,
        updateAccessToken,
      ]
    );

  // ========================================================================
  // Initial Authentication Lifecycle
  // ========================================================================

  useEffect(() => {
    /**
     * Treat every provider effect lifecycle as a new authentication operation
     * boundary. This prevents async work from the previous StrictMode effect
     * pass from mutating state after the provider is remounted.
     */
    const lifecycleGeneration =
      invalidateSession();

    mountedRef.current =
      true;

    loadingRef.current =
      true;

    setLoading(
      true
    );

    initializeAuthentication()
      .catch(error => {
        if (
          mountedRef.current &&
          sessionGenerationRef.current ===
            lifecycleGeneration
        ) {
          setAuthError(
            error
          );
        }

        devLog(
          "error",
          "[AUTH] Authentication initialization failed",
          error
        );
      })
      .finally(() => {
        if (
          mountedRef.current &&
          sessionGenerationRef.current ===
            lifecycleGeneration
        ) {
          loadingRef.current =
            false;

          setLoading(
            false
          );
        }
      });

    return () => {
      mountedRef.current =
        false;

      /**
       * Invalidate every async operation associated with this provider
       * lifecycle before allowing a remount/reinitialization.
       *
       * This is intentionally separate from the business-level login/logout
       * invalidation: it protects React lifecycle boundaries as well.
       */
      sessionGenerationRef.current +=
        1;

      clearRefreshTimer();

      /**
       * Do not allow a stale refresh promise from the previous lifecycle to
       * become the single-flight promise for a newly mounted provider.
       *
       * The stale operation itself remains harmless because its generation is
       * no longer current.
       */
      refreshPromiseRef.current =
        null;

      disconnectUserSocket();
    };
  }, [
    clearRefreshTimer,
    disconnectUserSocket,
    initializeAuthentication,
    invalidateSession,
  ]);

  // ========================================================================
  // Network State
  // ========================================================================

  useEffect(() => {
    const unsubscribe =
      onNetworkStateChange(
        ({
          online:
            nextOnline,
        }) => {
          onlineRef.current =
            Boolean(
              nextOnline
            );

          if (
            mountedRef.current
          ) {
            setOnline(
              Boolean(
                nextOnline
              )
            );
          }

          devLog(
            "info",
            "[AUTH] Network state changed",
            {
              online:
                nextOnline,
            }
          );

          if (
            !nextOnline
          ) {
            return;
          }

          /**
           * If we already have an authenticated session, do not unnecessarily
           * refresh simply because the network came back.
           */
          if (
            userRef.current ||
            loadingRef.current ||
            refreshPromiseRef.current
          ) {
            return;
          }

          const generation =
            sessionGenerationRef.current;

          refreshSession({
            reason:
              "network-recovery",
            suppressErrorState:
              true,
            generation,
          })
            .then(
              async newToken => {
                if (
                  !newToken ||
                  !isSessionCurrent(
                    generation
                  )
                ) {
                  return;
                }

                const profile =
                  await hydrateUser({
                    generation,
                    suppressError:
                      true,
                  });

                if (
                  !profile ||
                  !isSessionCurrent(
                    generation
                  )
                ) {
                  return;
                }

                setUser(
                  profile
                );

                scheduleRefresh(
                  newToken,
                  generation
                );

                connectUserSocket();
              }
            )
            .catch(error => {
              devLog(
                "info",
                "[AUTH] Network recovery did not restore an authenticated session",
                {
                  error,
                }
              );
            });
        }
      );

    return () => {
      if (
        typeof unsubscribe ===
        "function"
      ) {
        unsubscribe();
      }
    };
  }, [
    connectUserSocket,
    hydrateUser,
    isSessionCurrent,
    refreshSession,
    scheduleRefresh,
  ]);

  // ========================================================================
  // Cross-Tab Authentication Channel
  // ========================================================================

  useEffect(() => {
    if (
      typeof BroadcastChannel ===
      "undefined"
    ) {
      return undefined;
    }

    let channel;

    try {
      channel =
        new BroadcastChannel(
          AUTH_CHANNEL_NAME
        );

      channelRef.current =
        channel;
    } catch (error) {
      devLog(
        "warn",
        "[AUTH] Unable to create BroadcastChannel",
        error
      );

      return undefined;
    }

    const handleMessage =
      event => {
        const type =
          event?.data?.type;

        // ================================================================
        // Cross-tab logout
        // ================================================================

        if (
          type ===
          "AUTH_LOGOUT"
        ) {
          devLog(
            "info",
            "[AUTH] Received cross-tab logout event"
          );

          invalidateSession();

          clearRefreshTimer();

          refreshPromiseRef.current =
            null;

          disconnectUserSocket();

          updateAccessToken(
            null
          );

          clearTenant();

          if (
            mountedRef.current
          ) {
            setTenantId(
              null
            );

            setUser(
              null
            );

            setAuthError(
              null
            );

            setRefreshing(
              false
            );
          }

          return;
        }

        // ================================================================
        // Cross-tab login/session establishment
        //
        // The access token is NEVER transmitted through BroadcastChannel.
        //
        // The receiving tab instead uses the backend-controlled HttpOnly
        // refresh cookie to establish its own in-memory token.
        // ================================================================

        if (
          type ===
          "AUTH_LOGIN"
        ) {
          if (
            !mountedRef.current ||
            loadingRef.current ||
            userRef.current ||
            refreshPromiseRef.current ||
            !onlineRef.current
          ) {
            return;
          }

          const generation =
            sessionGenerationRef.current;

          refreshSession({
            reason:
              "cross-tab-login",
            suppressErrorState:
              true,
            generation,
          })
            .then(
              async newToken => {
                if (
                  !newToken ||
                  !isSessionCurrent(
                    generation
                  )
                ) {
                  return;
                }

                const profile =
                  await hydrateUser({
                    generation,
                    suppressError:
                      true,
                  });

                if (
                  !profile ||
                  !isSessionCurrent(
                    generation
                  )
                ) {
                  return;
                }

                setUser(
                  profile
                );

                scheduleRefresh(
                  newToken,
                  generation
                );

                connectUserSocket();
              }
            )
            .catch(() => {
              // The other tab may not have established a session yet.
            });
        }
      };

    channel.addEventListener(
      "message",
      handleMessage
    );

    return () => {
      channel.removeEventListener(
        "message",
        handleMessage
      );

      try {
        channel.close();
      } catch {
        // Defensive cleanup.
      }

      if (
        channelRef.current ===
        channel
      ) {
        channelRef.current =
          null;
      }
    };
  }, [
    clearRefreshTimer,
    connectUserSocket,
    disconnectUserSocket,
    hydrateUser,
    invalidateSession,
    isSessionCurrent,
    refreshSession,
    scheduleRefresh,
    updateAccessToken,
  ]);

  // ========================================================================
  // Socket Listener Lifecycle
  // ========================================================================

  useEffect(() => {
    attachSocketListeners();

    return () => {
      /**
       * Do not destroy the socket merely because this effect reruns.
       *
       * Provider lifecycle owns actual socket disconnect behavior.
       */
    };
  }, [
    attachSocketListeners,
  ]);

  // ========================================================================
  // Token Synchronization
  // ========================================================================
  //
  // services/api.js remains authoritative for the actual access token.
  //
  // This provider observes the memory-only token and synchronizes its own
  // derived React state.
  // ========================================================================

  useEffect(() => {
    const currentToken =
      getToken();

    if (
      currentToken &&
      currentToken !== token
    ) {
      setTokenState(
        currentToken
      );

      if (
        !isTokenExpired(
          currentToken
        )
      ) {
        scheduleRefresh(
          currentToken
        );
      }

      return;
    }

    if (
      !currentToken &&
      token
    ) {
      clearRefreshTimer();

      clearTenant();

      if (
        mountedRef.current
      ) {
        setTokenState(
          null
        );

        setUser(
          null
        );

        setTenantId(
          null
        );
      }

      disconnectUserSocket();
    }
  }, [
    clearRefreshTimer,
    disconnectUserSocket,
    scheduleRefresh,
    token,
  ]);

  // ========================================================================
  // Provider Cleanup
  // ========================================================================

  useEffect(() => {
    return () => {
      clearRefreshTimer();

      detachSocketListeners();

      try {
        channelRef.current?.close();
      } catch {
        // Defensive cleanup.
      }

      channelRef.current =
        null;
    };
  }, [
    clearRefreshTimer,
    detachSocketListeners,
  ]);

  // ========================================================================
  // Context Value
  // ========================================================================

  const value =
    useMemo(() => {
      const authenticated =
        Boolean(
          user &&
          token &&
          !isTokenExpired(
            token
          )
        );

      return {
        // --------------------------------------------------------------
        // Identity
        // --------------------------------------------------------------

        user,

        /**
         * Compatibility:
         * The access token remains memory-only.
         *
         * Consumers should prefer getAccessToken() and should never persist
         * this value.
         */
        token,

        authenticated,

        // --------------------------------------------------------------
        // Application readiness
        // --------------------------------------------------------------

        loading,

        authReady:
          !loading,

        online,

        // --------------------------------------------------------------
        // Session state
        // --------------------------------------------------------------

        refreshing,

        authError,

        sessionActive:
          authenticated,

        // --------------------------------------------------------------
        // Authentication
        // --------------------------------------------------------------

        login,

        register,

        logout,

        refreshToken:
          refreshSession,

        // --------------------------------------------------------------
        // Tenant
        // --------------------------------------------------------------

        tenantId,

        // --------------------------------------------------------------
        // Socket
        // --------------------------------------------------------------

        socketConnected,

        connectSocket:
          connectUserSocket,

        disconnectSocket:
          disconnectUserSocket,

        // --------------------------------------------------------------
        // Token access
        // --------------------------------------------------------------

        getAccessToken:
          getToken,
      };
    }, [
      user,
      token,
      loading,
      online,
      refreshing,
      authError,
      login,
      register,
      logout,
      refreshSession,
      tenantId,
      socketConnected,
      connectUserSocket,
      disconnectUserSocket,
    ]);

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <AuthContext.Provider
      value={value}
    >
      {!loading &&
        children}
    </AuthContext.Provider>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

AuthProvider.propTypes = {
  children:
    PropTypes.node.isRequired,
};

// ============================================================================
// Export
// ============================================================================

export default AuthProvider;