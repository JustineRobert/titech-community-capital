/* eslint-disable no-restricted-globals */

'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (TITech)
 * =============================================================================
 *
 * File:
 *   frontend/public/sw.js
 *
 * Purpose:
 *   Enterprise production-grade Service Worker for the TITech web application.
 *
 * Design principles:
 *
 *   1. The backend remains the authoritative source of truth.
 *   2. The service worker NEVER becomes a financial transaction authority.
 *   3. Authentication/session/financial traffic is NEVER served from a generic
 *      service-worker runtime cache.
 *   4. Public API caching requires an explicit backend opt-in response header.
 *   5. Browser Cache Storage is NOT an offline financial ledger.
 *   6. Background Sync is a synchronization signal, not a transaction guarantee.
 *   7. Notification URLs must remain same-origin and application-controlled.
 *   8. HTTP cache-control directives are respected.
 *   9. Cache growth is bounded.
 *  10. Service-worker lifecycle updates are controlled rather than forced.
 *
 * Financial safety boundary:
 *
 *   Browser
 *      |
 *      v
 *   Service Worker
 *      |
 *      v
 *   Application/API
 *      |
 *      v
 *   Authenticated Backend
 *      |
 *      +--> Idempotency
 *      +--> Server-side validation
 *      +--> Transaction boundary
 *      +--> Authoritative ledger
 *
 * The service worker may improve availability and user experience, but it
 * cannot establish financial settlement, transaction completion, balance
 * correctness, loan state, contribution state, or ledger state.
 *
 * =============================================================================
 */

/**
 * =============================================================================
 * CONFIGURATION
 * =============================================================================
 */

const TITech = Object.freeze({
  NAME: 'TITech',
  SERVICE: 'titech-service-worker',

  /*
   * Bump this version whenever service-worker behavior or cache semantics
   * materially change.
   */
  VERSION: 'v2',

  CACHE_PREFIX: 'titech',

  STATIC_CACHE: 'titech-static-v2',
  RUNTIME_CACHE: 'titech-runtime-v2',
  IMAGE_CACHE: 'titech-images-v2',
  API_CACHE: 'titech-api-v2',
  OFFLINE_CACHE: 'titech-offline-v2',

  SYNC_QUEUE: 'titech-background-sync',

  MESSAGE_CHANNEL: 'titech-service-worker',

  MAX_RUNTIME_ENTRIES: 100,
  MAX_IMAGE_ENTRIES: 150,
  MAX_API_ENTRIES: 50,

  NETWORK_TIMEOUT_MS: 8000,

  /*
   * The backend must explicitly opt a response into public service-worker
   * caching with:
   *
   *   X-TITech-Cacheable: public
   *
   * This deliberately prevents accidental caching of newly introduced API
   * endpoints.
   */
  CACHEABLE_RESPONSE_HEADER: 'X-TITech-Cacheable',
  CACHEABLE_RESPONSE_VALUE: 'public',

  /*
   * Only public API namespaces explicitly listed here can participate in
   * service-worker API caching.
   *
   * IMPORTANT:
   * Add an endpoint here only after the backend owner has confirmed that:
   *
   *   - it contains no authenticated/user-specific data;
   *   - it contains no tenant-specific confidential data;
   *   - it is safe to serve stale while offline;
   *   - the response explicitly sends X-TITech-Cacheable: public;
   *   - the response has appropriate Cache-Control headers.
   *
   * Keeping this empty is the safest default.
   */
  PUBLIC_API_PATHS: Object.freeze([
    /*
     * Example:
     * '/api/public/config',
     * '/api/public/content',
     */
  ]),

  /*
   * Application-controlled notification routes.
   *
   * Notifications may contain a relative path, but arbitrary external URLs
   * are rejected.
   */
  ALLOWED_NOTIFICATION_PREFIXES: Object.freeze([
    '/',
  ]),

  /*
   * Sensitive query-string names. Matching is case-insensitive.
   */
  SENSITIVE_QUERY_KEYS: Object.freeze([
    'token',
    'access_token',
    'refresh_token',
    'authorization',
    'session',
    'session_id',
    'secret',
    'signature',
    'otp',
    'code',
    'password',
    'reset_token',
    'invite_token',
    'api_key',
    'apikey',
    'key',
  ]),

  /*
   * HTTP response directives that prevent service-worker storage.
   */
  FORBIDDEN_CACHE_CONTROL_DIRECTIVES: Object.freeze([
    'no-store',
    'private',
    'no-cache',
  ]),

  /*
   * Headers which may indicate that the representation is user-specific or
   * otherwise unsafe for shared Cache Storage.
   */
  FORBIDDEN_RESPONSE_HEADERS: Object.freeze([
    'set-cookie',
  ]),
});

/**
 * =============================================================================
 * APPLICATION SHELL
 * =============================================================================
 *
 * Vite generates hashed JavaScript/CSS assets dynamically.
 *
 * This worker intentionally does NOT attempt to guess generated asset names.
 * Hashed assets are cached safely on first successful retrieval by the static
 * asset strategy.
 *
 * For true first-load offline support, a build-time manifest/precache step
 * should inject generated assets into this list or generate a companion
 * precache manifest.
 *
 * Do not manually add large collections of hashed assets here.
 * =============================================================================
 */

const APP_SHELL = Object.freeze([
  '/',
  '/index.html',
]);

/**
 * =============================================================================
 * STATIC ASSETS
 * =============================================================================
 */

const STATIC_EXTENSIONS = Object.freeze([
  '.js',
  '.mjs',
  '.css',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.ico',
  '.svg',
  '.webp',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.avif',
]);

/**
 * =============================================================================
 * FINANCIAL / SECURITY-SENSITIVE PATHS
 * =============================================================================
 *
 * These endpoints are NEVER served from generic runtime Cache Storage.
 *
 * This list is intentionally defensive and can be expanded without changing
 * the service-worker architecture.
 * =============================================================================
 */

const NEVER_CACHE_PATHS = Object.freeze([
  '/api/auth',
  '/api/login',
  '/api/logout',
  '/api/register',
  '/api/signup',
  '/api/signin',
  '/api/refresh',
  '/api/token',
  '/api/session',
  '/api/user',
  '/api/account',
  '/api/accounts',
  '/api/transactions',
  '/api/payments',
  '/api/wallet',
  '/api/wallets',
  '/api/ledger',
  '/api/loans',
  '/api/savings',
  '/api/contributions',
  '/api/withdrawals',
  '/api/transfers',
  '/api/momo',
  '/api/mobile-money',
  '/api/mobilemoney',
  '/api/offline/sync',
  '/api/offline/events',
  '/api/kyc',
  '/api/aml',
  '/api/admin',
  '/api/roles',
  '/api/permissions',
  '/api/tenants',
  '/api/tenant',
  '/api/members',
  '/api/referrals',
  '/api/rewards',
  '/api/billing',
  '/api/commercial',
  '/api/revenue',
  '/api/fees',
]);

/**
 * HTTP methods which are never processed through generic cache strategies.
 *
 * The service worker deliberately allows the browser/application to send these
 * requests normally so the backend remains responsible for idempotency,
 * authorization, validation and transaction boundaries.
 */

const NON_CACHEABLE_METHODS = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

/**
 * =============================================================================
 * BASIC UTILITIES
 * =============================================================================
 */

function isHttpRequest(request) {
  return Boolean(
    request &&
      (request.url.startsWith('http://') ||
        request.url.startsWith('https://')),
  );
}

function isSameOrigin(request) {
  try {
    return new URL(request.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function isNavigationRequest(request) {
  return Boolean(
    request &&
      (request.mode === 'navigate' || request.destination === 'document'),
  );
}

function getUrl(requestOrUrl) {
  try {
    return new URL(
      typeof requestOrUrl === 'string'
        ? requestOrUrl
        : requestOrUrl.url,
      self.location.origin,
    );
  } catch {
    return null;
  }
}

function getPathname(requestOrUrl) {
  const url = getUrl(requestOrUrl);
  return url ? url.pathname : '';
}

function getSearchParams(requestOrUrl) {
  const url = getUrl(requestOrUrl);
  return url ? url.searchParams : null;
}

function isApiRequest(request) {
  return getPathname(request).startsWith('/api/');
}

function pathMatches(pathname, configuredPath) {
  return (
    pathname === configuredPath ||
    pathname.startsWith(`${configuredPath}/`)
  );
}

function isFinancialOrSensitiveRequest(request) {
  const pathname = getPathname(request);

  return NEVER_CACHE_PATHS.some((path) =>
    pathMatches(pathname, path),
  );
}

function hasAuthorizationHeader(request) {
  return Boolean(
    request &&
      request.headers &&
      request.headers.has('authorization'),
  );
}

function hasSensitiveQueryParameters(request) {
  const searchParams = getSearchParams(request);

  if (!searchParams) {
    return true;
  }

  const sensitiveKeys = new Set(
    TITech.SENSITIVE_QUERY_KEYS.map((key) => key.toLowerCase()),
  );

  for (const key of searchParams.keys()) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * =============================================================================
 * CACHE-CONTROL SAFETY
 * =============================================================================
 */

function hasForbiddenCacheControl(response) {
  if (!response || !response.headers) {
    return true;
  }

  const cacheControl = (
    response.headers.get('cache-control') || ''
  ).toLowerCase();

  if (!cacheControl) {
    /*
     * Absence of Cache-Control does not automatically make a response unsafe,
     * but public API responses still require explicit TITech opt-in.
     */
    return false;
  }

  return TITech.FORBIDDEN_CACHE_CONTROL_DIRECTIVES.some(
    (directive) => {
      const pattern = new RegExp(
        `(?:^|,)\\s*${directive}(?:\\s*=|\\s*(?:,|$))`,
        'i',
      );

      return pattern.test(cacheControl);
    },
  );
}

function hasForbiddenResponseHeaders(response) {
  if (!response || !response.headers) {
    return true;
  }

  return TITech.FORBIDDEN_RESPONSE_HEADERS.some((header) =>
    response.headers.has(header),
  );
}

function hasUnsafeVaryHeader(response) {
  if (!response || !response.headers) {
    return true;
  }

  const vary = (
    response.headers.get('vary') || ''
  ).toLowerCase();

  /*
   * Authorization-varying content must never enter shared Cache Storage.
   */
  return vary
    .split(',')
    .map((value) => value.trim())
    .includes('authorization');
}

function hasPublicCacheOptIn(response) {
  if (!response || !response.headers) {
    return false;
  }

  const value = (
    response.headers.get(
      TITech.CACHEABLE_RESPONSE_HEADER,
    ) || ''
  )
    .trim()
    .toLowerCase();

  return value === TITech.CACHEABLE_RESPONSE_VALUE;
}

/**
 * =============================================================================
 * CACHEABILITY
 * =============================================================================
 */

function isCacheableRequest(request) {
  if (!request) {
    return false;
  }

  if (request.method !== 'GET') {
    return false;
  }

  if (!isHttpRequest(request)) {
    return false;
  }

  if (!isSameOrigin(request)) {
    return false;
  }

  if (isFinancialOrSensitiveRequest(request)) {
    return false;
  }

  if (hasAuthorizationHeader(request)) {
    return false;
  }

  if (hasSensitiveQueryParameters(request)) {
    return false;
  }

  return true;
}

function isStaticAsset(request) {
  const pathname = getPathname(request).toLowerCase();

  return STATIC_EXTENSIONS.some((extension) =>
    pathname.endsWith(extension),
  );
}

function isImageRequest(request) {
  const pathname = getPathname(request);

  return (
    request.destination === 'image' ||
    /\.(png|jpg|jpeg|gif|webp|avif|svg|ico)$/i.test(pathname)
  );
}

function isExplicitlyAllowedPublicApi(request) {
  if (!request || request.method !== 'GET') {
    return false;
  }

  const pathname = getPathname(request);

  return TITech.PUBLIC_API_PATHS.some((path) =>
    pathMatches(pathname, path),
  );
}

function isSafeApiGet(request) {
  return (
    request.method === 'GET' &&
    isApiRequest(request) &&
    isExplicitlyAllowedPublicApi(request) &&
    isCacheableRequest(request)
  );
}

function isCacheableResponse(response, request) {
  if (!response || !response.ok) {
    return false;
  }

  if (!isCacheableRequest(request)) {
    return false;
  }

  if (hasForbiddenCacheControl(response)) {
    return false;
  }

  if (hasForbiddenResponseHeaders(response)) {
    return false;
  }

  if (hasUnsafeVaryHeader(response)) {
    return false;
  }

  return true;
}

function isCacheablePublicApiResponse(response, request) {
  return (
    isSafeApiGet(request) &&
    isCacheableResponse(response, request) &&
    hasPublicCacheOptIn(response)
  );
}

/**
 * =============================================================================
 * CACHE STORAGE
 * =============================================================================
 */

async function safeCachePut(
  cacheName,
  request,
  response,
  {
    requirePublicOptIn = false,
  } = {},
) {
  if (!response || !response.ok) {
    return false;
  }

  if (!isCacheableResponse(response, request)) {
    return false;
  }

  if (
    requirePublicOptIn &&
    !hasPublicCacheOptIn(response)
  ) {
    return false;
  }

  try {
    const cache = await caches.open(cacheName);

    await cache.put(
      request,
      response.clone(),
    );

    return true;
  } catch {
    /*
     * Cache failure must never break application behavior.
     */
    return false;
  }
}

async function deleteOldCaches() {
  try {
    const cacheNames = await caches.keys();

    const currentCaches = new Set([
      TITech.STATIC_CACHE,
      TITech.RUNTIME_CACHE,
      TITech.IMAGE_CACHE,
      TITech.API_CACHE,
      TITech.OFFLINE_CACHE,
    ]);

    await Promise.all(
      cacheNames.map(async (cacheName) => {
        if (
          cacheName.startsWith(`${TITech.CACHE_PREFIX}-`) &&
          !currentCaches.has(cacheName)
        ) {
          await caches.delete(cacheName);
        }
      }),
    );
  } catch {
    /*
     * Cache cleanup failure must not prevent worker activation.
     */
  }
}

/**
 * =============================================================================
 * DETERMINISTIC CACHE BOUND
 * =============================================================================
 *
 * Cache.keys() ordering is not treated as an LRU guarantee.
 *
 * We use deterministic oldest-entry eviction based on insertion ordering
 * available through Cache.keys(), while explicitly documenting that this is
 * FIFO-style bounded eviction rather than true access-time LRU.
 *
 * This avoids claiming semantics that the Cache API does not provide.
 * =============================================================================
 */

async function trimCache(cacheName, maxEntries) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    return;
  }

  try {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();

    if (requests.length <= maxEntries) {
      return;
    }

    const excess = requests.length - maxEntries;

    for (const request of requests.slice(0, excess)) {
      await cache.delete(request);
    }
  } catch {
    /*
     * Cache trimming is best-effort.
     */
  }
}

/**
 * =============================================================================
 * NETWORK TIMEOUT
 * =============================================================================
 *
 * AbortController is used when available so a timed-out request does not
 * continue consuming resources unnecessarily.
 * =============================================================================
 */

async function fetchWithTimeout(
  request,
  timeoutMs = TITech.NETWORK_TIMEOUT_MS,
) {
  if (
    typeof AbortController === 'undefined' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return fetch(request);
  }

  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    /*
     * Preserve the original request properties while replacing its signal.
     */
    const timedRequest = new Request(request, {
      signal: controller.signal,
    });

    return await fetch(timedRequest);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * =============================================================================
 * OFFLINE RESPONSE
 * =============================================================================
 *
 * Used only where returning an HTTP response is appropriate.
 *
 * Financial/authenticated API failures are deliberately NOT converted into a
 * synthetic JSON response because application code should be able to
 * distinguish a real backend response from a browser-level network failure.
 * =============================================================================
 */

function createOfflineResponse(error = null) {
  const payload = {
    success: false,
    offline: true,
    service: TITech.SERVICE,
    code: 'NETWORK_UNAVAILABLE',
    message:
      'The TITech application is currently offline.',
    timestamp: new Date().toISOString(),
  };

  /*
   * Debug information is deliberately limited to localhost.
   */
  if (
    error &&
    self.location.hostname === 'localhost'
  ) {
    payload.debug =
      typeof error.message === 'string'
        ? error.message
        : 'Network request failed.';
  }

  return new Response(
    JSON.stringify(payload),
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        'Content-Type':
          'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-TITech-Offline': 'true',
      },
    },
  );
}

/**
 * =============================================================================
 * NAVIGATION RESPONSE VALIDATION
 * =============================================================================
 */

function isSafeNavigationResponse(response) {
  if (!response || !response.ok) {
    return false;
  }

  const contentType = (
    response.headers.get('content-type') || ''
  ).toLowerCase();

  /*
   * Navigation should resolve to HTML.
   */
  return (
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml+xml')
  );
}

/**
 * =============================================================================
 * INSTALL
 * =============================================================================
 */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(
        TITech.STATIC_CACHE,
      );

      /*
       * The shell is installed best-effort.
       *
       * One unavailable optional asset must not prevent the service worker
       * from installing.
       */
      await Promise.all(
        APP_SHELL.map(async (asset) => {
          try {
            const response = await fetch(
              new Request(asset, {
                method: 'GET',
                cache: 'no-store',
              }),
            );

            if (
              response.ok &&
              isSafeNavigationResponse(response)
            ) {
              await cache.put(
                asset,
                response.clone(),
              );
            } else if (response.ok) {
              await cache.put(
                asset,
                response.clone(),
              );
            }
          } catch {
            /*
             * Best-effort precache.
             */
          }
        }),
      );

      /*
       * Do NOT automatically call skipWaiting().
       *
       * The active application can explicitly request the update after
       * presenting an update notification to the user.
       */
    })(),
  );
});

/**
 * =============================================================================
 * ACTIVATE
 * =============================================================================
 */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await deleteOldCaches();

      await self.clients.claim();

      await notifyClients({
        type: 'SERVICE_WORKER_ACTIVATED',
        service: TITech.SERVICE,
        version: TITech.VERSION,
        timestamp: new Date().toISOString(),
      });
    })(),
  );
});

/**
 * =============================================================================
 * FETCH
 * =============================================================================
 */

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (!isHttpRequest(request)) {
    return;
  }

  /*
   * Non-GET operations are NEVER routed through generic cache handling.
   *
   * This includes financial writes. The browser/application communicates
   * directly with the backend, which remains responsible for:
   *
   *   - authentication
   *   - authorization
   *   - validation
   *   - idempotency
   *   - transaction boundaries
   *   - ledger integrity
   */
  if (
    NON_CACHEABLE_METHODS.has(
      request.method.toUpperCase(),
    )
  ) {
    return;
  }

  /*
   * Only GET requests are eligible below.
   */
  if (request.method !== 'GET') {
    return;
  }

  /*
   * Financial and authenticated requests remain network-authoritative.
   */
  if (
    isFinancialOrSensitiveRequest(request) ||
    hasAuthorizationHeader(request)
  ) {
    event.respondWith(
      networkOnly(request),
    );

    return;
  }

  /*
   * Navigation requests use network-first with a safe application-shell
   * fallback.
   */
  if (isNavigationRequest(request)) {
    event.respondWith(
      navigationStrategy(request),
    );

    return;
  }

  /*
   * Static assets use cache-first.
   */
  if (isStaticAsset(request)) {
    event.respondWith(
      staticAssetStrategy(request),
    );

    return;
  }

  /*
   * Images use cache-first with bounded cache growth.
   */
  if (isImageRequest(request)) {
    event.respondWith(
      imageStrategy(request),
    );

    return;
  }

  /*
   * Public API caching is explicitly opt-in.
   */
  if (isSafeApiGet(request)) {
    event.respondWith(
      safeApiStrategy(request),
    );

    return;
  }

  /*
   * Everything else remains network-only.
   */
  event.respondWith(
    networkOnly(request),
  );
});

/**
 * =============================================================================
 * NETWORK ONLY
 * =============================================================================
 *
 * IMPORTANT:
 * Do not convert arbitrary API network failures into synthetic successful
 * application responses.
 *
 * Rejecting the fetch allows frontend code to receive a genuine network error.
 * =============================================================================
 */

async function networkOnly(request) {
  return fetch(request);
}

/**
 * =============================================================================
 * NAVIGATION STRATEGY
 * =============================================================================
 *
 * Network-first:
 *
 *   network
 *      |
 *      +--> valid HTML response
 *      |
 *      +--> cache application shell
 *
 *   network failure
 *      |
 *      +--> runtime index.html
 *      |
 *      +--> static application shell
 *      |
 *      +--> offline HTML response
 * =============================================================================
 */

async function navigationStrategy(request) {
  try {
    const response = await fetchWithTimeout(
      request,
    );

    if (
      isSafeNavigationResponse(response)
    ) {
      const cache = await caches.open(
        TITech.RUNTIME_CACHE,
      );

      try {
        await cache.put(
          '/index.html',
          response.clone(),
        );
      } catch {
        /*
         * Cache failure does not affect successful navigation.
         */
      }

      return response;
    }

    /*
     * Do not cache or silently replace unexpected non-HTML responses.
     */
    return response;
  } catch {
    try {
      const runtimeCache = await caches.open(
        TITech.RUNTIME_CACHE,
      );

      const cached = await runtimeCache.match(
        '/index.html',
      );

      if (cached) {
        return cached;
      }
    } catch {
      /*
       * Continue to static shell fallback.
       */
    }

    try {
      const shell = await caches.match(
        '/index.html',
      );

      if (shell) {
        return shell;
      }
    } catch {
      /*
       * Continue to offline response.
       */
    }

    return createOfflineNavigationResponse();
  }
}

function createOfflineNavigationResponse() {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >
  <title>TITech — Offline</title>
</head>
<body>
  <main>
    <h1>TITech is offline</h1>
    <p>
      The application cannot currently reach the TITech backend.
      Please reconnect to the network and try again.
    </p>
  </main>
</body>
</html>`,
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-TITech-Offline': 'true',
      },
    },
  );
}

/**
 * =============================================================================
 * STATIC ASSET STRATEGY
 * =============================================================================
 *
 * Cache-first:
 *
 *   cache
 *      |
 *      +--> hit
 *
 *   miss
 *      |
 *      +--> network
 *      |
 *      +--> safely cache successful response
 * =============================================================================
 */

async function staticAssetStrategy(request) {
  try {
    const cached = await caches.match(request);

    if (cached) {
      return cached;
    }
  } catch {
    /*
     * Continue to network.
     */
  }

  try {
    const response = await fetch(request);

    await safeCachePut(
      TITech.STATIC_CACHE,
      request,
      response,
    );

    await trimCache(
      TITech.STATIC_CACHE,
      TITech.MAX_RUNTIME_ENTRIES,
    );

    return response;
  } catch (error) {
    /*
     * Static resources may use a synthetic response because this function
     * is serving a browser resource rather than a financial API operation.
     */
    return createOfflineResponse(error);
  }
}

/**
 * =============================================================================
 * IMAGE STRATEGY
 * =============================================================================
 */

async function imageStrategy(request) {
  try {
    const cached = await caches.match(request);

    if (cached) {
      return cached;
    }
  } catch {
    /*
     * Continue to network.
     */
  }

  try {
    const response = await fetch(request);

    await safeCachePut(
      TITech.IMAGE_CACHE,
      request,
      response,
    );

    await trimCache(
      TITech.IMAGE_CACHE,
      TITech.MAX_IMAGE_ENTRIES,
    );

    return response;
  } catch (error) {
    return createOfflineResponse(error);
  }
}

/**
 * =============================================================================
 * PUBLIC API GET STRATEGY
 * =============================================================================
 *
 * Network-first:
 *
 *   network
 *      |
 *      +--> successful explicitly cacheable public response
 *      |
 *      +--> cache
 *
 *   network failure
 *      |
 *      +--> cached public response
 *      |
 *      +--> genuine network failure response
 *
 * This strategy is intentionally narrow.
 *
 * A GET endpoint is NOT considered safe merely because:
 *
 *   - it is a GET;
 *   - it lacks Authorization;
 *   - it is outside the financial path list.
 *
 * Both conditions are required:
 *
 *   1. endpoint path is explicitly allowlisted;
 *   2. backend response contains:
 *
 *        X-TITech-Cacheable: public
 *
 * =============================================================================
 */

async function safeApiStrategy(request) {
  try {
    const response = await fetchWithTimeout(
      request,
    );

    if (
      isCacheablePublicApiResponse(
        response,
        request,
      )
    ) {
      await safeCachePut(
        TITech.API_CACHE,
        request,
        response,
        {
          requirePublicOptIn: true,
        },
      );

      await trimCache(
        TITech.API_CACHE,
        TITech.MAX_API_ENTRIES,
      );
    }

    return response;
  } catch {
    try {
      const cached = await caches.match(
        request,
      );

      if (cached) {
        return cached;
      }
    } catch {
      /*
       * Fall through to network error.
       */
    }

    /*
     * Preserve network failure semantics.
     */
    throw new Error(
      'TITech public API request failed while offline.',
    );
  }
}

/**
 * =============================================================================
 * MESSAGE HANDLING
 * =============================================================================
 *
 * Supported commands:
 *
 *   SKIP_WAITING
 *   CLEAR_CACHES
 *   CLEAR_RUNTIME_CACHE
 *   CLEAR_IMAGE_CACHE
 *   CLEAR_API_CACHE
 *   GET_STATUS
 *   PING
 * =============================================================================
 */

self.addEventListener('message', (event) => {
  const message = event.data;

  if (
    !message ||
    typeof message !== 'object' ||
    Array.isArray(message)
  ) {
    return;
  }

  switch (message.type) {
    case 'SKIP_WAITING':
      event.waitUntil(
        self.skipWaiting(),
      );
      break;

    case 'CLEAR_CACHES':
      event.waitUntil(
        clearApplicationCaches(),
      );
      break;

    case 'CLEAR_RUNTIME_CACHE':
      event.waitUntil(
        caches.delete(
          TITech.RUNTIME_CACHE,
        ),
      );
      break;

    case 'CLEAR_IMAGE_CACHE':
      event.waitUntil(
        caches.delete(
          TITech.IMAGE_CACHE,
        ),
      );
      break;

    case 'CLEAR_API_CACHE':
      event.waitUntil(
        caches.delete(
          TITech.API_CACHE,
        ),
      );
      break;

    case 'GET_STATUS':
      event.waitUntil(
        respondWithStatus(event),
      );
      break;

    case 'PING':
      safePostMessage(
        event.source,
        {
          type: 'PONG',
          service: TITech.SERVICE,
          version: TITech.VERSION,
          timestamp: new Date().toISOString(),
        },
      );
      break;

    default:
      /*
       * Unknown commands are ignored.
       */
      break;
  }
});

/**
 * =============================================================================
 * CACHE MANAGEMENT
 * =============================================================================
 */

async function clearApplicationCaches() {
  await Promise.allSettled([
    caches.delete(TITech.STATIC_CACHE),
    caches.delete(TITech.RUNTIME_CACHE),
    caches.delete(TITech.IMAGE_CACHE),
    caches.delete(TITech.API_CACHE),
    caches.delete(TITech.OFFLINE_CACHE),
  ]);

  await notifyClients({
    type: 'SERVICE_WORKER_CACHES_CLEARED',
    service: TITech.SERVICE,
    version: TITech.VERSION,
    timestamp: new Date().toISOString(),
  });
}

async function respondWithStatus(event) {
  let cacheNames = [];

  try {
    cacheNames = await caches.keys();
  } catch {
    cacheNames = [];
  }

  /*
   * A service worker cannot reliably infer live network connectivity merely
   * from its existence. "unknown" is therefore more truthful than the
   * previous unconditional online:true response.
   *
   * The frontend should combine this with browser online/offline events and
   * its own backend health/authentication state.
   */
  safePostMessage(
    event.source,
    {
      type: 'SERVICE_WORKER_STATUS',
      service: TITech.SERVICE,
      version: TITech.VERSION,
      cacheNames,
      networkStatus: 'unknown',
      online: null,
      timestamp: new Date().toISOString(),
    },
  );
}

/**
 * =============================================================================
 * CLIENT COMMUNICATION
 * =============================================================================
 */

async function notifyClients(message) {
  try {
    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    await Promise.allSettled(
      clients.map((client) =>
        safePostMessage(
          client,
          message,
        ),
      ),
    );
  } catch {
    /*
     * Client notification is best-effort.
     */
  }
}

function safePostMessage(client, message) {
  if (!client || typeof client.postMessage !== 'function') {
    return;
  }

  try {
    client.postMessage(message);
  } catch {
    /*
     * Client may have disappeared during delivery.
     */
  }
}

/**
 * =============================================================================
 * BACKGROUND SYNC
 * =============================================================================
 *
 * This is a SIGNAL, not a financial transaction queue.
 *
 * The worker does NOT:
 *
 *   - store financial POST bodies;
 *   - replay financial writes;
 *   - invent Idempotency-Key values;
 *   - declare a transaction successful;
 *   - modify financial state.
 *
 * The application must initiate its normal authenticated synchronization flow.
 *
 * Backend controls remain authoritative:
 *
 *   Idempotency-Key
 *   Event ID
 *   Device ID
 *   Tenant ID
 *   Event hash
 *   Server validation
 *   Transaction boundary
 *   Authoritative ledger
 * =============================================================================
 */

self.addEventListener('sync', (event) => {
  if (
    event.tag !== TITech.SYNC_QUEUE
  ) {
    return;
  }

  event.waitUntil(
    notifyClients({
      type: 'OFFLINE_SYNC_REQUIRED',
      service: TITech.SERVICE,
      version: TITech.VERSION,
      timestamp: new Date().toISOString(),
    }),
  );
});

/**
 * =============================================================================
 * PUSH NOTIFICATIONS
 * =============================================================================
 *
 * Financial state must NEVER be trusted from push payloads.
 *
 * A notification may tell the user that something changed, but the application
 * must retrieve authoritative state from the backend.
 * =============================================================================
 */

self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  event.waitUntil(
    handlePushNotification(event),
  );
});

async function handlePushNotification(event) {
  let payload;

  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: 'TITech',
      body: event.data.text(),
    };
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    return;
  }

  const title = sanitizeNotificationText(
    payload.title,
    'TITech',
    120,
  );

  const body = sanitizeNotificationText(
    payload.body,
    'You have a new notification.',
    500,
  );

  const targetUrl = sanitizeNotificationUrl(
    payload.url,
  );

  const icon = sanitizeNotificationAsset(
    payload.icon,
    '/images/icon-192.png',
  );

  const badge = sanitizeNotificationAsset(
    payload.badge,
    '/images/icon-192.png',
  );

  const tag = sanitizeNotificationText(
    payload.tag,
    'titech-notification',
    100,
  );

  const notificationId =
    typeof payload.notificationId === 'string' &&
    payload.notificationId.length <= 200
      ? payload.notificationId
      : null;

  const options = {
    body,
    icon,
    badge,
    tag,
    data: {
      url: targetUrl,
      notificationId,
    },
    renotify: Boolean(payload.renotify),
    requireInteraction: Boolean(
      payload.requireInteraction,
    ),
  };

  await self.registration.showNotification(
    title,
    options,
  );
}

function sanitizeNotificationText(
  value,
  fallback,
  maxLength,
) {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    return fallback;
  }

  return value
    .trim()
    .slice(0, maxLength);
}

function sanitizeNotificationUrl(value) {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    return '/';
  }

  try {
    const candidate = new URL(
      value,
      self.location.origin,
    );

    /*
     * Only same-origin HTTPS/HTTP application URLs are accepted.
     *
     * This blocks:
     *
     *   javascript:
     *   data:
     *   blob:
     *   external domains
     *   protocol-relative external URLs
     */
    if (
      candidate.origin !== self.location.origin
    ) {
      return '/';
    }

    if (
      candidate.protocol !== 'http:' &&
      candidate.protocol !== 'https:'
    ) {
      return '/';
    }

    /*
     * Never allow sensitive query parameters to be carried by a notification
     * navigation URL.
     */
    if (
      hasSensitiveQueryParameters({
        url: candidate.toString(),
      })
    ) {
      return '/';
    }

    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return '/';
  }
}

function sanitizeNotificationAsset(
  value,
  fallback,
) {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    return fallback;
  }

  try {
    const candidate = new URL(
      value,
      self.location.origin,
    );

    if (
      candidate.origin !== self.location.origin
    ) {
      return fallback;
    }

    if (
      candidate.protocol !== 'http:' &&
      candidate.protocol !== 'https:'
    ) {
      return fallback;
    }

    if (
      hasSensitiveQueryParameters({
        url: candidate.toString(),
      })
    ) {
      return fallback;
    }

    return `${candidate.pathname}${candidate.search}`;
  } catch {
    return fallback;
  }
}

/**
 * =============================================================================
 * NOTIFICATION CLICK
 * =============================================================================
 */

self.addEventListener(
  'notificationclick',
  (event) => {
    event.notification.close();

    const rawTarget =
      event.notification.data?.url || '/';

    const targetUrl =
      sanitizeNotificationUrl(rawTarget);

    event.waitUntil(
      (async () => {
        const clients =
          await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          });

        /*
         * Prefer an existing same-origin TITech application window.
         */
        for (const client of clients) {
          if (
            !isSameOriginClient(client)
          ) {
            continue;
          }

          try {
            if ('focus' in client) {
              await client.focus();
            }

            if ('navigate' in client) {
              await client.navigate(
                targetUrl,
              );
            }

            return;
          } catch {
            /*
             * Try the next available client.
             */
          }
        }

        /*
         * No existing client was usable.
         */
        if (
          typeof self.clients.openWindow ===
          'function'
        ) {
          await self.clients.openWindow(
            targetUrl,
          );
        }
      })(),
    );
  },
);

function isSameOriginClient(client) {
  if (!client || !client.url) {
    return false;
  }

  try {
    return (
      new URL(client.url).origin ===
      self.location.origin
    );
  } catch {
    return false;
  }
}

/**
 * =============================================================================
 * ERROR HANDLING
 * =============================================================================
 *
 * Never expose request bodies, authorization tokens, cookies, financial data,
 * tenant identifiers, or response bodies through service-worker errors.
 * =============================================================================
 */

self.addEventListener('error', () => {
  notifyClients({
    type: 'SERVICE_WORKER_ERROR',
    service: TITech.SERVICE,
    version: TITech.VERSION,
    message: 'Service worker runtime error.',
    timestamp: new Date().toISOString(),
  }).catch(() => {});
});

self.addEventListener(
  'unhandledrejection',
  () => {
    notifyClients({
      type: 'SERVICE_WORKER_ERROR',
      service: TITech.SERVICE,
      version: TITech.VERSION,
      message:
        'Service worker asynchronous operation failed.',
      timestamp: new Date().toISOString(),
    }).catch(() => {});
  },
);

/**
 * =============================================================================
 * SERVICE WORKER READY MARKER
 * =============================================================================
 *
 * Intentionally retained as a lifecycle marker for future instrumentation.
 * =============================================================================
 */

self.addEventListener('activate', () => {
  /*
   * Lifecycle marker intentionally empty.
   */
});