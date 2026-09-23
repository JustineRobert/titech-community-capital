// ============================================================================
// TITech Community Capital LTD
// Enterprise API Client
//
// File: frontend/src/services/api.js
//
// Production Grade
// Multi-Tenant | JWT | Refresh | Retry | Observability
// Idempotency | Offline Awareness | Financial Safety | Request Correlation
//
// Security model:
// - Access token is held in memory only.
// - Refresh token is stored by the backend in an HttpOnly cookie.
// - JavaScript must NOT persist or read refresh tokens.
// - Tenant headers are context hints only.
// - Backend authorization remains authoritative.
// - Financial mutations preserve idempotency across retries.
// - Authentication refresh is single-flight.
// - Offline state is explicitly classified.
// - Request diagnostics never expose credentials or financial payloads.
//
// IMPORTANT:
// This client is an orchestration/transport layer.
// Financial authorization, ledger integrity, transaction validation,
// duplicate detection, limits, and final consistency MUST remain
// authoritative on the backend.
// ============================================================================

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Configuration
// ============================================================================

const API_BASE =
  import.meta.env.VITE_API_URL ||
  'http://localhost:5000';

const REQUEST_TIMEOUT =
  Number(import.meta.env.VITE_REQUEST_TIMEOUT) || 30000;

const HEALTH_TIMEOUT =
  Number(import.meta.env.VITE_API_HEALTH_TIMEOUT) || 5000;

const MAX_RETRIES = Math.max(
  0,
  Number(import.meta.env.VITE_API_RETRIES) || 3
);

const RETRY_DELAY = Math.max(
  100,
  Number(import.meta.env.VITE_API_RETRY_DELAY) || 1000
);

const TENANT_KEY =
  import.meta.env.VITE_TENANT_KEY || 'tenantId';

const DEVICE_KEY =
  import.meta.env.VITE_DEVICE_KEY || 'deviceId';

const APP_VERSION =
  import.meta.env.VITE_APP_VERSION || '1.0.0';

const IS_DEV =
  Boolean(import.meta.env.DEV);

const REFRESH_ENDPOINT =
  '/api/auth/refresh';

const LOGIN_ENDPOINT =
  '/api/auth/login';

const REGISTER_ENDPOINT =
  '/api/auth/register';

const LOGOUT_ENDPOINT =
  '/api/auth/logout';

// ============================================================================
// Security / HTTP Constants
// ============================================================================

const SAFE_METHODS = new Set([
  'get',
  'head',
  'options',
]);

const MUTATION_METHODS = new Set([
  'post',
  'put',
  'patch',
  'delete',
]);

const FINANCIAL_PATHS = Object.freeze([
  '/transactions',
  '/payments',
  '/wallet',
  '/ledger',
  '/loans',
  '/savings',
  '/momo',
  '/contributions',
  '/withdrawals',
]);

const RETRYABLE_STATUS_CODES = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504,
]);

const AUTH_EXCLUDED_ENDPOINTS = new Set([
  REFRESH_ENDPOINT,
  LOGIN_ENDPOINT,
  REGISTER_ENDPOINT,
  LOGOUT_ENDPOINT,
]);

// ============================================================================
// Access Token State
// ============================================================================
//
// SECURITY REQUIREMENT:
//
// The access token intentionally exists only in memory.
//
// NEVER persist it in:
// - localStorage
// - sessionStorage
// - IndexedDB
// - browser-readable cookies
//
// After a reload, bootstrapAuthentication() attempts to obtain a fresh
// access token through the backend's HttpOnly refresh cookie.
// ============================================================================

let accessToken = null;

// ============================================================================
// Safe Storage
// ============================================================================
//
// Tenant and device identifiers are contextual values.
// They are NOT authentication credentials.
//
// The backend MUST independently validate:
// - authenticated user
// - tenant membership
// - tenant permissions
// - role
// - resource ownership
// - device trust where applicable
// ============================================================================

const storage = {
  get(key) {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      return (
        window.localStorage.getItem(key) ||
        window.sessionStorage.getItem(key)
      );
    } catch {
      return null;
    }
  },

  set(key, value) {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      if (
        value === undefined ||
        value === null
      ) {
        this.remove(key);
        return;
      }

      window.localStorage.setItem(
        key,
        String(value)
      );
    } catch {
      // Browser storage may be unavailable because of privacy settings.
    }
  },

  remove(key) {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
  },
};

// ============================================================================
// Token Helpers
// ============================================================================

export function getToken() {
  return accessToken;
}

export function setToken(token) {
  if (
    typeof token !== 'string' ||
    !token.trim()
  ) {
    accessToken = null;
    return;
  }

  accessToken = token.trim();
}

export function clearToken() {
  accessToken = null;
}

// ============================================================================
// Refresh Token Helpers
// ============================================================================
//
// These functions intentionally do nothing.
//
// The refresh token belongs to the backend/browser cookie security boundary.
//
// Recommended backend cookie:
//
// Set-Cookie:
// refreshToken=<opaque-token>;
// HttpOnly;
// Secure;
// SameSite=Lax;
// Path=/api/auth;
//
// JavaScript must never read the refresh token.
// ============================================================================

export function getRefreshToken() {
  return null;
}

export function setRefreshToken() {
  // Intentionally ignored.
}

export function clearRefreshToken() {
  // Backend logout must clear the HttpOnly cookie.
}

// ============================================================================
// Tenant Helpers
// ============================================================================

export function getTenant() {
  return storage.get(TENANT_KEY);
}

export function setTenant(tenantId) {
  if (
    tenantId === undefined ||
    tenantId === null ||
    tenantId === ''
  ) {
    clearTenant();
    return;
  }

  const normalizedTenantId = String(
    tenantId
  ).trim();

  if (!normalizedTenantId) {
    clearTenant();
    return;
  }

  storage.set(
    TENANT_KEY,
    normalizedTenantId
  );

  api.defaults.headers.common[
    'x-tenant-id'
  ] = normalizedTenantId;
}

export function clearTenant() {
  storage.remove(TENANT_KEY);

  delete api.defaults.headers.common[
    'x-tenant-id'
  ];
}

// ============================================================================
// Device Identity
// ============================================================================

function generateDeviceId() {
  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to uuidv4().
  }

  return uuidv4();
}

export function getDeviceId() {
  let deviceId = storage.get(
    DEVICE_KEY
  );

  if (!deviceId) {
    deviceId = generateDeviceId();

    storage.set(
      DEVICE_KEY,
      deviceId
    );
  }

  return deviceId;
}

// ============================================================================
// Axios Instances
// ============================================================================
//
// api:
//   Authenticated application API.
//
// authApi:
//   Authentication API.
//
// authApi deliberately does NOT receive the authenticated API response
// interceptor. This prevents refresh loops.
// ============================================================================

const defaultHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

const api = axios.create({
  baseURL: API_BASE,
  timeout: REQUEST_TIMEOUT,
  withCredentials: true,
  headers: {
    ...defaultHeaders,
  },
});

const authApi = axios.create({
  baseURL: API_BASE,
  timeout: REQUEST_TIMEOUT,
  withCredentials: true,
  headers: {
    ...defaultHeaders,
  },
});

// ============================================================================
// Request Tracking
// ============================================================================

const pendingRequests = new Map();
const requestControllers = new Map();

// ============================================================================
// Refresh State
// ============================================================================
//
// Single-flight refresh:
//
// Request A -> 401 -> refresh
// Request B -> 401 -> waits
// Request C -> 401 -> waits
//
// Only ONE refresh request reaches the backend.
// ============================================================================

let refreshPromise = null;

// ============================================================================
// Request Utilities
// ============================================================================

function normalizeMethod(method) {
  return (
    method ||
    'get'
  ).toLowerCase();
}

function isSafeMethod(method) {
  return SAFE_METHODS.has(
    normalizeMethod(method)
  );
}

function isMutationMethod(method) {
  return MUTATION_METHODS.has(
    normalizeMethod(method)
  );
}

// ============================================================================
// URL Normalization
// ============================================================================

function normalizeUrl(url = '') {
  return String(url)
    .split('?')[0]
    .split('#')[0]
    .replace(/\/+$/, '')
    .toLowerCase();
}

function normalizePath(url = '') {
  const normalized = normalizeUrl(url);

  if (!normalized) {
    return '';
  }

  try {
    const parsed = new URL(
      normalized,
      API_BASE
    );

    return (
      parsed.pathname
        .replace(/\/+/g, '/')
        .replace(/\/+$/, '')
        .toLowerCase() || '/'
    );
  } catch {
    return normalized;
  }
}

// ============================================================================
// Financial Request Detection
// ============================================================================
//
// Supports both:
//
// /payments
// /payments/123
// /api/payments
// /api/payments/123
//
// Query strings are intentionally excluded.
// ============================================================================

function isFinancialRequest(config) {
  const path = normalizePath(
    config?.url
  );

  if (!path) {
    return false;
  }

  const candidates = [
    path,
    path.replace(/^\/api(?=\/|$)/, ''),
  ];

  return FINANCIAL_PATHS.some(
    financialPath => {
      const normalizedFinancialPath =
        financialPath.toLowerCase();

      return candidates.some(
        candidate =>
          candidate ===
            normalizedFinancialPath ||
          candidate.startsWith(
            `${normalizedFinancialPath}/`
          )
      );
    }
  );
}

function getHeaderValue(
  headers,
  name
) {
  if (!headers) {
    return undefined;
  }

  const lowerName =
    name.toLowerCase();

  if (
    headers[name] !== undefined
  ) {
    return headers[name];
  }

  if (
    headers[lowerName] !== undefined
  ) {
    return headers[lowerName];
  }

  const matchingKey =
    Object.keys(headers).find(
      key =>
        key.toLowerCase() ===
        lowerName
    );

  return matchingKey
    ? headers[matchingKey]
    : undefined;
}

function hasIdempotencyKey(config) {
  return Boolean(
    getHeaderValue(
      config?.headers,
      'Idempotency-Key'
    )
  );
}

// ============================================================================
// Stable Serialization
// ============================================================================

function stableSerialize(value) {
  if (value === undefined) {
    return '';
  }

  if (
    value === null ||
    typeof value !== 'object'
  ) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  if (
    typeof FormData !== 'undefined' &&
    value instanceof FormData
  ) {
    return '[FormData]';
  }

  if (
    typeof Blob !== 'undefined' &&
    value instanceof Blob
  ) {
    return `[Blob:${value.type || 'unknown'}]`;
  }

  if (
    typeof ArrayBuffer !== 'undefined' &&
    value instanceof ArrayBuffer
  ) {
    return '[ArrayBuffer]';
  }

  if (Array.isArray(value)) {
    return JSON.stringify(
      value.map(item =>
        stableSerialize(item)
      )
    );
  }

  const sortedKeys =
    Object.keys(value).sort();

  return JSON.stringify(
    sortedKeys.reduce(
      (result, key) => {
        result[key] =
          stableSerialize(
            value[key]
          );

        return result;
      },
      {}
    )
  );
}

// ============================================================================
// Request Key
// ============================================================================

function requestKey(config) {
  return [
    normalizeMethod(
      config?.method
    ),
    config?.baseURL || '',
    config?.url || '',
    stableSerialize(
      config?.params
    ),
    stableSerialize(
      config?.data
    ),
    getTenant() || '',
  ].join('|');
}

// ============================================================================
// Header Utilities
// ============================================================================

function ensureHeader(
  config,
  name,
  value
) {
  if (!config.headers) {
    config.headers = {};
  }

  const existing =
    getHeaderValue(
      config.headers,
      name
    );

  if (
    existing === undefined ||
    existing === null ||
    existing === ''
  ) {
    config.headers[name] = value;
  }
}

// ============================================================================
// Financial Idempotency
// ============================================================================
//
// Financial mutation identifiers MUST survive retries.
//
// Initial request:
//
// Idempotency-Key = ABC
//
// Retry:
//
// Idempotency-Key = ABC
//
// This allows the backend to recognize duplicate delivery attempts.
// ============================================================================

function ensureFinancialHeaders(
  config
) {
  const method =
    normalizeMethod(
      config?.method
    );

  if (
    !isFinancialRequest(config) ||
    !isMutationMethod(method)
  ) {
    return;
  }

  ensureHeader(
    config,
    'Idempotency-Key',
    uuidv4()
  );

  ensureHeader(
    config,
    'x-transaction-id',
    uuidv4()
  );
}

// ============================================================================
// Retry Helpers
// ============================================================================

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

function getRetryAfterDelay(
  error
) {
  const retryAfter =
    getHeaderValue(
      error?.response?.headers,
      'retry-after'
    );

  if (!retryAfter) {
    return null;
  }

  const seconds = Number(
    retryAfter
  );

  if (
    Number.isFinite(seconds) &&
    seconds >= 0
  ) {
    return Math.min(
      seconds * 1000,
      30000
    );
  }

  const retryDate = Date.parse(
    retryAfter
  );

  if (!Number.isNaN(retryDate)) {
    return Math.max(
      0,
      Math.min(
        retryDate - Date.now(),
        30000
      )
    );
  }

  return null;
}

function calculateRetryDelay(
  attempt,
  error
) {
  const serverDelay =
    getRetryAfterDelay(error);

  if (serverDelay !== null) {
    return serverDelay;
  }

  const exponential =
    RETRY_DELAY *
    Math.pow(
      2,
      Math.max(
        0,
        attempt - 1
      )
    );

  const jitter =
    Math.random() * 500;

  return Math.min(
    exponential + jitter,
    30000
  );
}

// ============================================================================
// Retry Classification
// ============================================================================

function isNetworkError(error) {
  return (
    Boolean(error) &&
    !error?.response
  );
}

function isRetryableStatus(
  status
) {
  return RETRYABLE_STATUS_CODES.has(
    status
  );
}

// ============================================================================
// Retry Policy
// ============================================================================
//
// SAFE:
//
// GET / HEAD / OPTIONS
//
// may retry automatically.
//
// MUTATIONS:
//
// POST / PUT / PATCH / DELETE
//
// may only retry automatically when an idempotency key exists.
//
// This protects:
//
// - savings
// - contributions
// - withdrawals
// - payments
// - Mobile Money
// - wallets
// - loans
// - ledger operations
// ============================================================================

function shouldRetryRequest(
  config,
  error
) {
  if (!config) {
    return false;
  }

  const method =
    normalizeMethod(
      config.method
    );

  const status =
    error?.response?.status;

  const retryableNetwork =
    isNetworkError(error);

  const retryableStatus =
    isRetryableStatus(status);

  if (
    !retryableNetwork &&
    !retryableStatus
  ) {
    return false;
  }

  if (isSafeMethod(method)) {
    return true;
  }

  if (
    isMutationMethod(method)
  ) {
    return hasIdempotencyKey(
      config
    );
  }

  return false;
}

// ============================================================================
// Retry Counter
// ============================================================================

function getRetryCount(config) {
  return Number(
    config?._retryCount || 0
  );
}

function incrementRetryCount(
  config
) {
  config._retryCount =
    getRetryCount(config) + 1;
}

// ============================================================================
// Pending Request Tracking
// ============================================================================
//
// Financial mutations are NEVER automatically cancelled.
//
// Safe duplicate GET requests may supersede older identical requests.
//
// IMPORTANT:
// A request may provide its own AbortSignal. In that case we do not replace
// it with an internal signal because doing so would break caller cancellation.
// ============================================================================

function registerPendingRequest(
  config
) {
  const key =
    requestKey(config);

  const method =
    normalizeMethod(
      config.method
    );

  if (
    isSafeMethod(method) &&
    requestControllers.has(key)
  ) {
    const previousController =
      requestControllers.get(key);

    try {
      previousController.abort();
    } catch {
      // Ignore abort failures.
    }
  }

  let controller = null;

  if (!config.signal) {
    controller =
      new AbortController();

    config.signal =
      controller.signal;

    requestControllers.set(
      key,
      controller
    );
  }

  pendingRequests.set(
    key,
    {
      method,
      url: config.url,
      startedAt: Date.now(),
      financial:
        isFinancialRequest(
          config
        ),
      idempotencyKey:
        getHeaderValue(
          config.headers,
          'Idempotency-Key'
        ) || null,
      externallyControlled:
        !controller,
    }
  );

  return key;
}

function cleanupPendingRequest(
  config
) {
  if (!config) {
    return;
  }

  const key =
    requestKey(config);

  pendingRequests.delete(
    key
  );

  requestControllers.delete(
    key
  );
}

// ============================================================================
// Offline State
// ============================================================================

function isBrowserOffline() {
  return (
    typeof navigator !==
      'undefined' &&
    navigator.onLine === false
  );
}

function createOfflineError(
  originalError
) {
  const error =
    new Error(
      'The device is offline. The request could not be completed.'
    );

  error.code =
    'CLIENT_OFFLINE';

  error.isOffline = true;

  error.originalError =
    originalError;

  return error;
}

// ============================================================================
// Cancellation
// ============================================================================

function isAbortError(error) {
  return (
    error?.code ===
      'ERR_CANCELED' ||
    error?.name ===
      'CanceledError' ||
    error?.name ===
      'AbortError' ||
    error?.message ===
      'canceled'
  );
}

// ============================================================================
// Authentication Endpoint Detection
// ============================================================================

function isAuthenticationEndpoint(
  url
) {
  if (!url) {
    return false;
  }

  const normalized =
    normalizePath(url);

  return Array.from(
    AUTH_EXCLUDED_ENDPOINTS
  ).some(endpoint => {
    const normalizedEndpoint =
      normalizePath(endpoint);

    return (
      normalized ===
        normalizedEndpoint ||
      normalized.startsWith(
        `${normalizedEndpoint}/`
      )
    );
  });
}

// ============================================================================
// Refresh Token Flow
// ============================================================================

async function refreshAccessToken() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise =
    authApi
      .post(
        REFRESH_ENDPOINT
      )
      .then(response => {
        const token =
          response.data
            ?.accessToken ||
          response.data
            ?.token;

        if (!token) {
          throw new Error(
            'Invalid TITech refresh response: access token missing.'
          );
        }

        setToken(token);

        const tenantId =
          response.data
            ?.tenantId ||
          response.data
            ?.user?.tenantId;

        if (
          tenantId !== undefined &&
          tenantId !== null
        ) {
          setTenant(
            tenantId
          );
        }

        api.defaults.headers.common.Authorization =
          `Bearer ${token}`;

        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });

  return refreshPromise;
}

// ============================================================================
// Authentication Cleanup
// ============================================================================

function clearAuthenticationState() {
  clearToken();

  // HttpOnly refresh cookie must be cleared by backend logout.
  clearRefreshToken();

  clearTenant();

  delete api.defaults.headers.common
    .Authorization;
}

// ============================================================================
// Redirect To Login
// ============================================================================

function redirectToLogin() {
  if (
    typeof window ===
    'undefined'
  ) {
    return;
  }

  if (
    window.location.pathname ===
    '/login'
  ) {
    return;
  }

  const currentPath =
    `${window.location.pathname}${window.location.search}`;

  const loginUrl =
    `/login?redirect=${encodeURIComponent(
      currentPath
    )}`;

  window.location.assign(
    loginUrl
  );
}

// ============================================================================
// Request Interceptor
// ============================================================================

api.interceptors.request.use(
  config => {
    config.metadata = {
      ...(config.metadata || {}),
      startedAt: Date.now(),
    };

    if (!config.headers) {
      config.headers = {};
    }

    // ------------------------------------------------------------------------
    // Access Token
    // ------------------------------------------------------------------------

    const token =
      getToken();

    if (token) {
      config.headers.Authorization =
        `Bearer ${token}`;
    }

    // ------------------------------------------------------------------------
    // Tenant Context
    // ------------------------------------------------------------------------

    const tenantId =
      getTenant();

    if (tenantId) {
      config.headers[
        'x-tenant-id'
      ] = tenantId;
    }

    // ------------------------------------------------------------------------
    // Request Identity
    // ------------------------------------------------------------------------

    ensureHeader(
      config,
      'x-request-id',
      uuidv4()
    );

    ensureHeader(
      config,
      'x-correlation-id',
      uuidv4()
    );

    ensureHeader(
      config,
      'x-device-id',
      getDeviceId()
    );

    ensureHeader(
      config,
      'x-client-version',
      APP_VERSION
    );

    ensureHeader(
      config,
      'x-client-platform',
      'web'
    );

    // ------------------------------------------------------------------------
    // Financial Safety
    // ------------------------------------------------------------------------

    ensureFinancialHeaders(
      config
    );

    // ------------------------------------------------------------------------
    // Pending Request Tracking
    // ------------------------------------------------------------------------

    registerPendingRequest(
      config
    );

    // ------------------------------------------------------------------------
    // Development Logging
    // ------------------------------------------------------------------------

    if (IS_DEV) {
      console.info(
        '[TITech API REQUEST]',
        {
          method:
            normalizeMethod(
              config.method
            ).toUpperCase(),

          url:
            config.url,

          correlationId:
            getHeaderValue(
              config.headers,
              'x-correlation-id'
            ),

          requestId:
            getHeaderValue(
              config.headers,
              'x-request-id'
            ),

          tenantId:
            getHeaderValue(
              config.headers,
              'x-tenant-id'
            ) || null,

          financial:
            isFinancialRequest(
              config
            ),

          idempotencyKey:
            getHeaderValue(
              config.headers,
              'Idempotency-Key'
            ) || null,
        }
      );
    }

    return config;
  },

  error =>
    Promise.reject(error)
);

// ============================================================================
// Response Interceptor
// ============================================================================

api.interceptors.response.use(
  response => {
    cleanupPendingRequest(
      response.config
    );

    if (
      response.config?.metadata
    ) {
      const duration =
        Date.now() -
        response.config.metadata
          .startedAt;

      if (IS_DEV) {
        console.info(
          '[TITech API RESPONSE]',
          {
            method:
              normalizeMethod(
                response.config
                  .method
              ).toUpperCase(),

            url:
              response.config
                .url,

            duration:
              `${duration}ms`,

            status:
              response.status,

            correlationId:
              getHeaderValue(
                response.config
                  .headers,
                'x-correlation-id'
              ),
          }
        );
      }
    }

    return response;
  },

  async error => {
    const request =
      error?.config || {};

    cleanupPendingRequest(
      request
    );

    const status =
      error?.response?.status;

    // ========================================================================
    // Cancellation
    // ========================================================================

    if (
      isAbortError(error)
    ) {
      return Promise.reject(
        error
      );
    }

    // ========================================================================
    // Offline
    // ========================================================================

    if (
      isBrowserOffline()
    ) {
      return Promise.reject(
        createOfflineError(
          error
        )
      );
    }

    // ========================================================================
    // Authentication Refresh
    // ========================================================================

    if (
      status === 401 &&
      !request._authRetry &&
      !isAuthenticationEndpoint(
        request.url
      )
    ) {
      request._authRetry = true;

      try {
        const token =
          await refreshAccessToken();

        request.headers =
          request.headers || {};

        request.headers.Authorization =
          `Bearer ${token}`;

        return api(
          request
        );
      } catch (
        refreshError
      ) {
        clearAuthenticationState();

        redirectToLogin();

        return Promise.reject(
          refreshError
        );
      }
    }

    // ========================================================================
    // Generic Retry
    // ========================================================================

    if (
      shouldRetryRequest(
        request,
        error
      ) &&
      getRetryCount(request) <
        MAX_RETRIES
    ) {
      incrementRetryCount(
        request
      );

      const attempt =
        getRetryCount(
          request
        );

      const delay =
        calculateRetryDelay(
          attempt,
          error
        );

      if (IS_DEV) {
        console.warn(
          '[TITech API RETRY]',
          {
            attempt,
            maxRetries:
              MAX_RETRIES,

            method:
              normalizeMethod(
                request.method
              ).toUpperCase(),

            url:
              request.url,

            status,

            delay,

            financial:
              isFinancialRequest(
                request
              ),

            idempotencyKey:
              getHeaderValue(
                request.headers,
                'Idempotency-Key'
              ) || null,
          }
        );
      }

      await sleep(delay);

      if (
        isBrowserOffline()
      ) {
        return Promise.reject(
          createOfflineError(
            error
          )
        );
      }

      return api(
        request
      );
    }

    // ========================================================================
    // Development Error Logging
    // ========================================================================

    if (IS_DEV) {
      console.error(
        '[TITech API ERROR]',
        {
          url:
            request.url,

          method:
            normalizeMethod(
              request.method
            ).toUpperCase(),

          status,

          code:
            error?.code,

          message:
            error?.message,

          correlationId:
            getHeaderValue(
              request.headers,
              'x-correlation-id'
            ),

          requestId:
            getHeaderValue(
              request.headers,
              'x-request-id'
            ),

          financial:
            isFinancialRequest(
              request
            ),
        }
      );
    }

    return Promise.reject(
      error
    );
  }
);

// ============================================================================
// Authentication APIs
// ============================================================================

export async function login(
  payload
) {
  const response =
    await authApi.post(
      LOGIN_ENDPOINT,
      payload
    );

  const token =
    response.data
      ?.accessToken ||
    response.data
      ?.token;

  if (token) {
    setToken(token);

    api.defaults.headers.common.Authorization =
      `Bearer ${token}`;
  }

  const tenantId =
    response.data
      ?.tenantId ||
    response.data
      ?.user?.tenantId;

  if (
    tenantId !== undefined &&
    tenantId !== null
  ) {
    setTenant(
      tenantId
    );
  }

  // Refresh token is expected to be delivered by the backend
  // through an HttpOnly Secure cookie.

  return response;
}

export async function register(
  payload
) {
  const response =
    await authApi.post(
      REGISTER_ENDPOINT,
      payload
    );

  const token =
    response.data
      ?.accessToken ||
    response.data
      ?.token;

  if (token) {
    setToken(token);

    api.defaults.headers.common.Authorization =
      `Bearer ${token}`;
  }

  const tenantId =
    response.data
      ?.tenantId ||
    response.data
      ?.user?.tenantId;

  if (
    tenantId !== undefined &&
    tenantId !== null
  ) {
    setTenant(
      tenantId
    );
  }

  return response;
}

export async function logout() {
  try {
    return await authApi.post(
      LOGOUT_ENDPOINT
    );
  } finally {
    clearAuthenticationState();
  }
}

export async function refreshToken() {
  const token =
    await refreshAccessToken();

  return {
    accessToken: token,
  };
}

// ============================================================================
// Authentication Bootstrap
// ============================================================================
//
// Recommended during application startup:
//
// await bootstrapAuthentication();
//
// This allows TITech to recover a session after a browser reload without
// persisting the access token in browser storage.
// ============================================================================

export async function bootstrapAuthentication() {
  try {
    const token =
      await refreshAccessToken();

    return {
      authenticated: true,
      accessToken: token,
    };
  } catch {
    clearAuthenticationState();

    return {
      authenticated: false,
      accessToken: null,
    };
  }
}

// ============================================================================
// Upload Helpers
// ============================================================================

export function uploadFile(
  url,
  file,
  extra = {},
  config = {}
) {
  const form =
    new FormData();

  form.append(
    'file',
    file
  );

  Object.entries(extra)
    .forEach(
      ([key, value]) => {
        if (
          value === undefined ||
          value === null
        ) {
          return;
        }

        if (
          typeof Blob !==
            'undefined' &&
          value instanceof Blob
        ) {
          form.append(
            key,
            value
          );
        } else {
          form.append(
            key,
            String(value)
          );
        }
      }
    );

  return api.post(
    url,
    form,
    {
      ...config,

      headers: {
        ...config.headers,

        // DO NOT manually set Content-Type.
        //
        // The browser must generate:
        //
        // multipart/form-data; boundary=...
      },
    }
  );
}

// ============================================================================
// Download Helpers
// ============================================================================

export function downloadFile(
  url,
  config = {}
) {
  return api.get(
    url,
    {
      ...config,
      responseType: 'blob',
    }
  );
}

// ============================================================================
// Generic HTTP Methods
// ============================================================================

export function get(
  url,
  config
) {
  return api.get(
    url,
    config
  );
}

export function post(
  url,
  data,
  config
) {
  return api.post(
    url,
    data,
    config
  );
}

export function put(
  url,
  data,
  config
) {
  return api.put(
    url,
    data,
    config
  );
}

export function patch(
  url,
  data,
  config
) {
  return api.patch(
    url,
    data,
    config
  );
}

export function del(
  url,
  config
) {
  return api.delete(
    url,
    config
  );
}

export function request(
  config
) {
  return api.request(
    config
  );
}

// ============================================================================
// Financial Request Helper
// ============================================================================
//
// Use this helper when the application needs to create the idempotency key
// BEFORE the request.
//
// Example:
//
// const idempotencyKey = generateIdempotencyKey();
//
// createFinancialRequest(
//   'POST',
//   '/api/savings/deposit',
//   payload,
//   {
//     headers: {
//       'Idempotency-Key': idempotencyKey,
//     },
//   }
// );
//
// The same key can be persisted alongside an offline event.
//
// IMPORTANT:
// The backend remains authoritative for duplicate detection.
// ============================================================================

export function createFinancialRequest(
  method,
  url,
  data,
  config = {}
) {
  const existingHeaders =
    config.headers || {};

  const existingIdempotencyKey =
    getHeaderValue(
      existingHeaders,
      'Idempotency-Key'
    );

  const existingTransactionId =
    getHeaderValue(
      existingHeaders,
      'x-transaction-id'
    );

  const headers = {
    ...existingHeaders,

    'Idempotency-Key':
      existingIdempotencyKey ||
      uuidv4(),

    'x-transaction-id':
      existingTransactionId ||
      uuidv4(),
  };

  return api.request({
    ...config,
    method,
    url,
    data,
    headers,
  });
}

// ============================================================================
// Request Cancellation
// ============================================================================

export function cancelRequest(
  config
) {
  if (!config) {
    return false;
  }

  const key =
    requestKey(config);

  const controller =
    requestControllers.get(
      key
    );

  if (!controller) {
    return false;
  }

  try {
    controller.abort();
  } finally {
    requestControllers.delete(
      key
    );

    pendingRequests.delete(
      key
    );
  }

  return true;
}

// ============================================================================
// Cancel All Safe Requests
// ============================================================================
//
// Financial mutations are deliberately NOT cancelled by this helper.
// ============================================================================

export function cancelSafeRequests() {
  let cancelled = 0;

  for (
    const [
      key,
      controller,
    ] of requestControllers.entries()
  ) {
    const pending =
      pendingRequests.get(
        key
      );

    if (
      pending &&
      isSafeMethod(
        pending.method
      )
    ) {
      try {
        controller.abort();
        cancelled += 1;
      } catch {
        // Ignore cancellation failures.
      }

      requestControllers.delete(
        key
      );

      pendingRequests.delete(
        key
      );
    }
  }

  return cancelled;
}

// ============================================================================
// Diagnostics
// ============================================================================
//
// Diagnostics deliberately expose only operational metadata.
//
// NEVER expose:
// - access tokens
// - refresh tokens
// - passwords
// - secrets
// - authorization headers
// - financial payloads
// - payment credentials
// ============================================================================

export function getApiDiagnostics() {
  const diagnostics = {
    apiBase:
      API_BASE,

    authenticated:
      Boolean(
        getToken()
      ),

    tenantId:
      getTenant(),

    deviceId:
      getDeviceId(),

    online:
      typeof navigator !==
      'undefined'
        ? navigator.onLine
        : true,

    refreshInProgress:
      Boolean(
        refreshPromise
      ),

    pendingRequests:
      pendingRequests.size,

    environment:
      IS_DEV
        ? 'development'
        : 'production',

    appVersion:
      APP_VERSION,
  };

  if (IS_DEV) {
    diagnostics.pendingRequestDetails =
      Array.from(
        pendingRequests.entries()
      ).map(
        ([key, value]) => ({
          key,
          ...value,
        })
      );
  }

  return diagnostics;
}

// ============================================================================
// API Health Check
// ============================================================================
//
// navigator.onLine only tells us whether the browser believes it has network
// connectivity.
//
// This function actually tests TITech API reachability.
// ============================================================================

export async function checkApiHealth() {
  const startedAt =
    Date.now();

  try {
    const response =
      await authApi.get(
        '/health',
        {
          timeout:
            HEALTH_TIMEOUT,
        }
      );

    return {
      healthy: true,

      status:
        response.status,

      latency:
        Date.now() -
        startedAt,
    };
  } catch (error) {
    return {
      healthy: false,

      status:
        error?.response
          ?.status ||
        null,

      latency:
        Date.now() -
        startedAt,

      message:
        error?.message ||
        'TITech API unavailable',
    };
  }
}

// ============================================================================
// Network State Helpers
// ============================================================================

export function isOnline() {
  return !isBrowserOffline();
}

export function isOffline() {
  return isBrowserOffline();
}

// ============================================================================
// Network State Events
// ============================================================================
//
// The offline queue/synchronization engine should remain outside this API
// client.
//
// This client only reports network state.
// ============================================================================

export function onNetworkStateChange(
  callback
) {
  if (
    typeof window ===
      'undefined' ||
    typeof callback !==
      'function'
  ) {
    return () => {};
  }

  const handleOnline =
    () => {
      callback({
        online: true,
      });
    };

  const handleOffline =
    () => {
      callback({
        online: false,
      });
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
}

// ============================================================================
// Financial Safety Utilities
// ============================================================================

export function generateIdempotencyKey() {
  return uuidv4();
}

export function generateTransactionId() {
  return uuidv4();
}

// ============================================================================
// Authentication State Utilities
// ============================================================================

export function isAuthenticated() {
  return Boolean(
    getToken()
  );
}

export function clearAuth() {
  clearAuthenticationState();
}

// ============================================================================
// Export
// ============================================================================

export default api;