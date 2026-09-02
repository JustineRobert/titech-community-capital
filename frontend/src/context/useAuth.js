"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Authentication Consumer Hooks
 * ============================================================================
 *
 * File:
 *   frontend/src/context/useAuth.js
 *
 * Purpose:
 *   Production-grade React authentication consumer boundary for TITech.
 *
 * Architecture:
 *
 *   AuthProvider.jsx
 *        │
 *        ▼
 *   AuthContext.jsx
 *        │
 *        ▼
 *   useAuth.js
 *        │
 *        ├── useAuth()
 *        └── useAuthSelector()
 *
 * Responsibilities:
 *   - Safely consume TITech AuthContext.
 *   - Enforce provider placement.
 *   - Provide a stable developer-facing error boundary.
 *   - Provide optional selective context consumption.
 *   - Prevent accidental direct access to authentication implementation details.
 *
 * Non-responsibilities:
 *   - Login implementation
 *   - Registration implementation
 *   - Logout implementation
 *   - Token persistence
 *   - Token refresh
 *   - JWT verification
 *   - Tenant authorization
 *   - Permission enforcement
 *   - API requests
 *   - Socket lifecycle management
 *
 * ============================================================================
 * SECURITY / AUTHORITY MODEL
 * ============================================================================
 *
 * The backend remains authoritative for:
 *
 *   - Authentication
 *   - Authorization
 *   - Tenant isolation
 *   - Session validity
 *   - Role enforcement
 *   - Permission enforcement
 *   - Financial authorization
 *
 * This hook is a frontend state-consumption boundary only.
 *
 * Never use this hook as a security boundary.
 *
 * ============================================================================
 * TOKEN SECURITY
 * ============================================================================
 *
 * This module MUST NOT:
 *
 *   - Read refresh tokens.
 *   - Write refresh tokens.
 *   - Persist access tokens.
 *   - Decode JWTs for authorization.
 *   - Create authentication headers.
 *   - Make authentication API calls.
 *
 * Access-token lifecycle remains owned by AuthProvider/API infrastructure.
 *
 * ============================================================================
 * TENANT SECURITY
 * ============================================================================
 *
 * tenantId exposed by AuthContext is a frontend read-model value.
 *
 * It MUST NOT be treated as proof of tenant authorization.
 *
 * The TITech backend MUST independently validate:
 *
 *   - authenticated principal
 *   - tenant membership
 *   - tenant status
 *   - tenant permissions
 *   - resource ownership
 *   - financial authorization
 *
 * ============================================================================
 * REACT / FAST REFRESH BOUNDARY
 * ============================================================================
 *
 * This module intentionally exports hooks rather than React components.
 *
 * AuthProvider.jsx remains responsible for provider behavior.
 * AuthContext.jsx remains responsible for the context object.
 *
 * This separation provides a clean module boundary for:
 *
 *   - React Fast Refresh
 *   - Testing
 *   - Dependency isolation
 *   - Tree-shaking
 *   - Long-term maintainability
 *
 * ============================================================================
 */

import {
  useContext,
  useDebugValue,
} from "react";

import AuthContext from "./AuthContext";

/* ============================================================================
 * Constants
 * ========================================================================== */

const MODULE_NAME =
  "TITech Authentication Context";

const PROVIDER_ERROR_CODE =
  "TITECH_AUTH_PROVIDER_REQUIRED";

const INVALID_CONTEXT_ERROR_CODE =
  "TITECH_AUTH_CONTEXT_INVALID";

/* ============================================================================
 * Error Factory
 * ========================================================================== */

/**
 * Creates the canonical provider-boundary error.
 *
 * Keeping this in one place prevents slightly different authentication
 * errors from being produced by different consumer hooks.
 *
 * @returns {Error}
 */
function createProviderError() {
  const error = new Error(
    "useAuth must be used within <AuthProvider>. " +
      "Ensure the component is rendered inside the TITech AuthProvider."
  );

  error.name =
    "TITechAuthProviderError";

  error.code =
    PROVIDER_ERROR_CODE;

  error.module =
    MODULE_NAME;

  return error;
}

/**
 * Creates an error for an invalid context implementation.
 *
 * This protects against accidental replacement of AuthContext with an
 * incompatible provider value.
 *
 * @returns {Error}
 */
function createInvalidContextError() {
  const error = new Error(
    "TITech AuthContext is invalid. " +
      "Ensure AuthProvider and useAuth import the same AuthContext instance."
  );

  error.name =
    "TITechAuthContextError";

  error.code =
    INVALID_CONTEXT_ERROR_CODE;

  error.module =
    MODULE_NAME;

  return error;
}

/* ============================================================================
 * Context Validation
 * ========================================================================== */

/**
 * Validates that the consumer received the expected context object.
 *
 * We deliberately validate only the core authentication contract rather than
 * requiring every optional property. This preserves forward compatibility when
 * AuthContext gains new capabilities.
 *
 * @param {unknown} context
 * @returns {object}
 */
function requireAuthContext(context) {
  if (
    context === null ||
    context === undefined
  ) {
    throw createProviderError();
  }

  if (
    typeof context !== "object"
  ) {
    throw createInvalidContextError();
  }

  /*
   * The context must expose the primary authentication state.
   *
   * We intentionally do not require every method here because applications may
   * evolve the context contract incrementally.
   */
  if (
    !Object.prototype.hasOwnProperty.call(
      context,
      "authenticated"
    ) &&
    !Object.prototype.hasOwnProperty.call(
      context,
      "user"
    )
  ) {
    throw createInvalidContextError();
  }

  return context;
}

/* ============================================================================
 * Authentication Status Debugging
 * ========================================================================== */

/**
 * Produces a safe React DevTools debug value.
 *
 * IMPORTANT:
 * Never expose:
 *
 *   - access tokens
 *   - refresh tokens
 *   - passwords
 *   - authorization headers
 *   - financial information
 *   - tenant secrets
 *
 * through useDebugValue().
 *
 * @param {object|null} context
 */
function getDebugValue(context) {
  if (
    !context ||
    typeof context !== "object"
  ) {
    return "unavailable";
  }

  if (
    context.loading === true
  ) {
    return "loading";
  }

  if (
    context.refreshing === true
  ) {
    return context.authenticated
      ? "authenticated / refreshing"
      : "refreshing";
  }

  if (
    context.authenticated === true
  ) {
    return "authenticated";
  }

  if (
    context.online === false
  ) {
    return "unauthenticated / offline";
  }

  return "unauthenticated";
}

/* ============================================================================
 * Primary Authentication Hook
 * ========================================================================== */

/**
 * Consume the TITech authentication context.
 *
 * Example:
 *
 *   const {
 *     user,
 *     authenticated,
 *     login,
 *     logout,
 *     tenantId,
 *   } = useAuth();
 *
 * This hook intentionally contains no authentication business logic.
 *
 * @returns {object}
 *
 * @throws {Error}
 *   When used outside AuthProvider.
 */
export function useAuth() {
  const context =
    useContext(AuthContext);

  const authContext =
    requireAuthContext(context);

  /*
   * React DevTools receives only a non-sensitive authentication status.
   */
  useDebugValue(
    getDebugValue(authContext)
  );

  return authContext;
}

/* ============================================================================
 * Selective Authentication Hook
 * ========================================================================== */

/**
 * Selectively consume a value from the TITech authentication context.
 *
 * This is useful for components that only need one authentication property and
 * should avoid coupling themselves to the complete context object.
 *
 * Example:
 *
 *   const authenticated = useAuthSelector(
 *     auth => auth.authenticated
 *   );
 *
 * Another example:
 *
 *   const tenantId = useAuthSelector(
 *     auth => auth.tenantId
 *   );
 *
 * IMPORTANT:
 * The selector is a convenience/readability boundary. It does not turn
 * frontend state into an authorization boundary.
 *
 * @template T
 *
 * @param {(auth: object) => T} selector
 * @returns {T}
 *
 * @throws {TypeError}
 *   When selector is not a function.
 *
 * @throws {Error}
 *   When used outside AuthProvider.
 */
export function useAuthSelector(
  selector
) {
  if (
    typeof selector !==
    "function"
  ) {
    throw new TypeError(
      "useAuthSelector requires a selector function."
    );
  }

  const context =
    useContext(AuthContext);

  const authContext =
    requireAuthContext(context);

  useDebugValue(
    getDebugValue(authContext)
  );

  return selector(
    authContext
  );
}

/* ============================================================================
 * Specialized Authentication Hooks
 * ========================================================================== */

/**
 * Read only whether authentication initialization has completed.
 *
 * @returns {boolean}
 */
export function useAuthReady() {
  return useAuthSelector(
    auth =>
      auth.authReady === true ||
      auth.loading === false
  );
}

/**
 * Read only the current authenticated user.
 *
 * @returns {object|null}
 */
export function useCurrentUser() {
  return useAuthSelector(
    auth =>
      auth.user ?? null
  );
}

/**
 * Read only the current authentication state.
 *
 * @returns {boolean}
 */
export function useIsAuthenticated() {
  return useAuthSelector(
    auth =>
      auth.authenticated === true
  );
}

/**
 * Read only the active tenant identifier.
 *
 * IMPORTANT:
 * This value is a frontend read-model value.
 * It is NOT proof of tenant authorization.
 *
 * @returns {string|null}
 */
export function useTenantId() {
  return useAuthSelector(
    auth =>
      auth.tenantId ??
      null
  );
}

/**
 * Read only network/session availability.
 *
 * @returns {object}
 */
export function useAuthStatus() {
  return useAuthSelector(
    auth => ({
      loading:
        auth.loading === true,

      authReady:
        auth.authReady === true,

      authenticated:
        auth.authenticated === true,

      refreshing:
        auth.refreshing === true,

      online:
        auth.online !== false,

      sessionActive:
        auth.sessionActive === true,

      socketConnected:
        auth.socketConnected === true,

      authError:
        auth.authError ?? null,
    })
  );
}

/* ============================================================================
 * Default Export
 * ========================================================================== */

/**
 * Default export remains the primary authentication hook for compatibility
 * with consumers that prefer:
 *
 *   import useAuth from "./useAuth";
 */
export default useAuth;

/* ============================================================================
 * Public Error Codes
 * ========================================================================== */

export const AUTH_HOOK_ERROR_CODES =
  Object.freeze({
    PROVIDER_REQUIRED:
      PROVIDER_ERROR_CODE,

    INVALID_CONTEXT:
      INVALID_CONTEXT_ERROR_CODE,
  });