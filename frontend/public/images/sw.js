/* eslint-disable no-restricted-globals */

'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (TITech)
 * =============================================================================
 *
 * File:
 *   frontend/public/images/sw.js
 *
 * Purpose:
 *   Enterprise production-grade Service Worker for the TITech web application.
 *
 * Responsibilities:
 *
 *   - Application-shell caching
 *   - Static asset caching
 *   - Offline navigation support
 *   - Safe runtime caching
 *   - Cache versioning
 *   - Stale-cache cleanup
 *   - Network failure fallback
 *   - Offline awareness
 *   - Background synchronization hooks
 *   - Controlled service-worker lifecycle
 *   - Protection of authenticated / financial API traffic
 *
 * IMPORTANT FINANCIAL SAFETY RULE
 * --------------------------------
 *
 * This service worker MUST NOT treat browser caching or Background Sync as a
 * financial transaction guarantee.
 *
 * Financial operations MUST be protected by the TITech backend using:
 *
 *   Idempotency
 *        +
 *   Transaction Boundary
 *        +
 *   Authoritative Ledger
 *        +
 *   Server-side Validation
 *
 * The service worker may help queue/retry a request, but the backend remains
 * the source of truth.
 *
 * =============================================================================
 *
 * Service-worker lifecycle:
 *
 *   Browser
 *      │
 *      ▼
 *   install
 *      │
 *      ▼
 *   Pre-cache application shell
 *      │
 *      ▼
 *   activate
 *      │
 *      ├── remove obsolete caches
 *      └── claim eligible clients
 *      │
 *      ▼
 *   fetch
 *      │
 *      ├── navigation ───────────────► network / app shell
 *      │
 *      ├── static asset ─────────────► cache-first
 *      │
 *      ├── safe GET API ─────────────► network-first
 *      │
 *      └── financial/authenticated ► network only
 *
 * =============================================================================
 */

const TITech = Object.freeze({
  NAME: 'TITech',

  SERVICE: 'titech-service-worker',

  VERSION: 'v1',

  CACHE_PREFIX: 'titech',

  STATIC_CACHE: 'titech-static-v1',

  RUNTIME_CACHE: 'titech-runtime-v1',

  IMAGE_CACHE: 'titech-images-v1',

  API_CACHE: 'titech-api-v1',

  OFFLINE_CACHE: 'titech-offline-v1',

  SYNC_QUEUE: 'titech-background-sync',

  MESSAGE_CHANNEL:
    'titech-service-worker',

  MAX_RUNTIME_ENTRIES: 100,

  MAX_IMAGE_ENTRIES: 150,

  MAX_API_ENTRIES: 50,

  NETWORK_TIMEOUT_MS: 8000,
});

/**
 * =============================================================================
 * Application Shell
 * =============================================================================
 *
 * Keep this list intentionally small.
 *
 * Create-react-app / Vite / other frontend build systems normally inject
 * hashed JavaScript and CSS assets into the generated application.
 *
 * Hashed assets should preferably be discovered from the generated build
 * rather than manually maintaining a large list here.
 *
 * =============================================================================
 */

const APP_SHELL = Object.freeze([
  '/',
  '/index.html',
]);

/**
 * Static extensions safe to cache.
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
 * Financial / Security-Sensitive Paths
 * =============================================================================
 *
 * These are deliberately NEVER served from a generic runtime cache.
 *
 * The backend remains authoritative.
 * =============================================================================
 */

const NEVER_CACHE_PATHS = Object.freeze([
  '/api/auth',
  '/api/login',
  '/api/logout',
  '/api/register',
  '/api/refresh',
  '/api/token',
  '/api/session',
  '/api/user',

  '/api/transactions',
  '/api/payments',
  '/api/wallet',
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
]);

/**
 * HTTP methods that must never be handled as cacheable resources.
 */
const NON_CACHEABLE_METHODS = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

/**
 * =============================================================================
 * Utility Functions
 * =============================================================================
 */

function isHttpRequest(request) {
  return (
    request &&
    (request.url.startsWith('http://') ||
      request.url.startsWith('https://'))
  );
}

function isSameOrigin(request) {
  try {
    return (
      new URL(request.url).origin ===
      self.location.origin
    );
  } catch {
    return false;
  }
}

function isNavigationRequest(request) {
  return (
    request.mode === 'navigate' ||
    request.destination === 'document'
  );
}

function getPathname(request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return '';
  }
}

function isApiRequest(request) {
  return getPathname(request).startsWith('/api/');
}

function isFinancialOrSensitiveRequest(request) {
  const pathname =
    getPathname(request);

  return NEVER_CACHE_PATHS.some(
    (path) =>
      pathname === path ||
      pathname.startsWith(`${path}/`),
  );
}

function hasAuthorizationHeader(request) {
  return request.headers.has(
    'authorization',
  );
}

function hasSensitiveQueryParameters(request) {
  try {
    const url =
      new URL(request.url);

    const sensitiveKeys = [
      'token',
      'access_token',
      'refresh_token',
      'authorization',
      'session',
      'secret',
      'signature',
      'otp',
    ];

    return sensitiveKeys.some(
      (key) =>
        url.searchParams.has(key),
    );
  } catch {
    return true;
  }
}

function isCacheableRequest(request) {
  if (!request) {
    return false;
  }

  if (
    request.method !== 'GET'
  ) {
    return false;
  }

  if (!isHttpRequest(request)) {
    return false;
  }

  if (!isSameOrigin(request)) {
    return false;
  }

  if (
    isFinancialOrSensitiveRequest(
      request,
    )
  ) {
    return false;
  }

  if (
    hasAuthorizationHeader(
      request,
    )
  ) {
    return false;
  }

  if (
    hasSensitiveQueryParameters(
      request,
    )
  ) {
    return false;
  }

  return true;
}

function isStaticAsset(request) {
  const pathname =
    getPathname(request).toLowerCase();

  return STATIC_EXTENSIONS.some(
    (extension) =>
      pathname.endsWith(extension),
  );
}

function isImageRequest(request) {
  return (
    request.destination === 'image' ||
    /\.(png|jpg|jpeg|gif|webp|avif|svg|ico)$/i.test(
      getPathname(request),
    )
  );
}

function isSafeApiGet(request) {
  return (
    request.method === 'GET' &&
    isApiRequest(request) &&
    !isFinancialOrSensitiveRequest(
      request,
    ) &&
    !hasAuthorizationHeader(
      request,
    ) &&
    !hasSensitiveQueryParameters(
      request,
    )
  );
}

async function safeCachePut(
  cacheName,
  request,
  response,
) {
  if (
    !response ||
    !response.ok
  ) {
    return;
  }

  if (
    !isCacheableRequest(
      request,
    )
  ) {
    return;
  }

  const cache =
    await caches.open(
      cacheName,
    );

  await cache.put(
    request,
    response.clone(),
  );
}

async function deleteOldCaches() {
  const cacheNames =
    await caches.keys();

  const currentCaches =
    new Set([
      TITech.STATIC_CACHE,
      TITech.RUNTIME_CACHE,
      TITech.IMAGE_CACHE,
      TITech.API_CACHE,
      TITech.OFFLINE_CACHE,
    ]);

  await Promise.all(
    cacheNames.map(
      async (cacheName) => {
        if (
          cacheName.startsWith(
            `${TITech.CACHE_PREFIX}-`,
          ) &&
          !currentCaches.has(
            cacheName,
          )
        ) {
          await caches.delete(
            cacheName,
          );
        }
      },
    ),
  );
}

/**
 * =============================================================================
 * Cache Size Management
 * =============================================================================
 */

async function trimCache(
  cacheName,
  maxEntries,
) {
  const cache =
    await caches.open(
      cacheName,
    );

  const requests =
    await cache.keys();

  if (
    requests.length <=
    maxEntries
  ) {
    return;
  }

  const excess =
    requests.length -
    maxEntries;

  await Promise.all(
    requests
      .slice(0, excess)
      .map((request) =>
        cache.delete(
          request,
        ),
      ),
  );
}

/**
 * =============================================================================
 * Network Timeout
 * =============================================================================
 */

function fetchWithTimeout(
  request,
  timeoutMs =
    TITech.NETWORK_TIMEOUT_MS,
) {
  return new Promise(
    (resolve, reject) => {
      const timer =
        setTimeout(
          () => {
            reject(
              new Error(
                'Network request timeout.',
              ),
            );
          },
          timeoutMs,
        );

      fetch(request)
        .then(
          (response) => {
            clearTimeout(
              timer,
            );

            resolve(
              response,
            );
          },
        )
        .catch(
          (error) => {
            clearTimeout(
              timer,
            );

            reject(
              error,
            );
          },
        );
    },
  );
}

/**
 * =============================================================================
 * INSTALL
 * =============================================================================
 */

self.addEventListener(
  'install',
  (event) => {
    event.waitUntil(
      (async () => {
        const cache =
          await caches.open(
            TITech.STATIC_CACHE,
          );

        /*
         * Do not fail the entire service-worker installation merely because
         * one optional asset is unavailable.
         */
        await Promise.all(
          APP_SHELL.map(
            async (asset) => {
              try {
                await cache.add(
                  asset,
                );
              } catch {
                /*
                 * The asset can be retrieved during the next activation/fetch.
                 */
              }
            },
          ),
        );

        /*
         * We deliberately do NOT call skipWaiting() automatically.
         *
         * This prevents an updated service worker from taking control in the
         * middle of an active user session.
         *
         * The application can explicitly send:
         *
         *   { type: 'SKIP_WAITING' }
         *
         * after showing an update notification.
         */
      })(),
    );
  },
);

/**
 * =============================================================================
 * ACTIVATE
 * =============================================================================
 */

self.addEventListener(
  'activate',
  (event) => {
    event.waitUntil(
      (async () => {
        await deleteOldCaches();

        /*
         * Claim clients after activation so the current application can
         * immediately communicate with the active worker.
         */
        await self.clients.claim();

        await notifyClients({
          type:
            'SERVICE_WORKER_ACTIVATED',

          service:
            TITech.SERVICE,

          version:
            TITech.VERSION,
        });
      })(),
    );
  },
);

/**
 * =============================================================================
 * FETCH
 * =============================================================================
 */

self.addEventListener(
  'fetch',
  (event) => {
    const {
      request,
    } = event;

    if (
      !isHttpRequest(
        request,
      )
    ) {
      return;
    }

    /*
     * Never intercept non-GET requests through generic caching.
     *
     * Financial writes are handled by the application/API layer and backend
     * idempotency boundary.
     */
    if (
      NON_CACHEABLE_METHODS.has(
        request.method,
      )
    ) {
      return;
    }

    /*
     * Financial and authenticated APIs remain network authoritative.
     */
    if (
      isFinancialOrSensitiveRequest(
        request,
      ) ||
      hasAuthorizationHeader(
        request,
      )
    ) {
      event.respondWith(
        networkOnly(
          request,
        ),
      );

      return;
    }

    /*
     * Navigation requests use network-first with an application-shell
     * fallback.
     */
    if (
      isNavigationRequest(
        request,
      )
    ) {
      event.respondWith(
        navigationStrategy(
          request,
        ),
      );

      return;
    }

    /*
     * Static application assets use cache-first.
     */
    if (
      isStaticAsset(
        request,
      )
    ) {
      event.respondWith(
        staticAssetStrategy(
          request,
        ),
      );

      return;
    }

    /*
     * Images use cache-first with bounded cache growth.
     */
    if (
      isImageRequest(
        request,
      )
    ) {
      event.respondWith(
        imageStrategy(
          request,
        ),
      );

      return;
    }

    /*
     * Only explicitly safe unauthenticated GET APIs can use runtime caching.
     */
    if (
      isSafeApiGet(
        request,
      )
    ) {
      event.respondWith(
        safeApiStrategy(
          request,
        ),
      );

      return;
    }

    /*
     * Everything else uses the network.
     */
    event.respondWith(
      networkOnly(
        request,
      ),
    );
  },
);

/**
 * =============================================================================
 * NETWORK ONLY
 * =============================================================================
 */

async function networkOnly(
  request,
) {
  try {
    return await fetch(
      request,
    );
  } catch (error) {
    return createOfflineResponse(
      error,
    );
  }
}

/**
 * =============================================================================
 * NAVIGATION STRATEGY
 * =============================================================================
 *
 * Network first:
 *
 *   network
 *      ↓ failure
 *   cached index.html
 *      ↓ missing
 *   offline response
 *
 * =============================================================================
 */

async function navigationStrategy(
  request,
) {
  try {
    const response =
      await fetchWithTimeout(
        request,
      );

    if (
      response &&
      response.ok
    ) {
      const cache =
        await caches.open(
          TITech.RUNTIME_CACHE,
        );

      await cache.put(
        '/index.html',
        response.clone(),
      );
    }

    return response;
  } catch {
    const cache =
      await caches.open(
        TITech.RUNTIME_CACHE,
      );

    const cached =
      await cache.match(
        '/index.html',
      );

    if (cached) {
      return cached;
    }

    const shell =
      await caches.match(
        '/index.html',
      );

    if (shell) {
      return shell;
    }

    return createOfflineResponse();
  }
}

/**
 * =============================================================================
 * STATIC ASSET STRATEGY
 * =============================================================================
 *
 * Cache first:
 *
 *   cache
 *      ↓ miss
 *   network
 *      ↓
 *   cache
 *
 * =============================================================================
 */

async function staticAssetStrategy(
  request,
) {
  const cached =
    await caches.match(
      request,
    );

  if (cached) {
    return cached;
  }

  try {
    const response =
      await fetch(
        request,
      );

    await safeCachePut(
      TITech.STATIC_CACHE,
      request,
      response,
    );

    return response;
  } catch (error) {
    return createOfflineResponse(
      error,
    );
  }
}

/**
 * =============================================================================
 * IMAGE STRATEGY
 * =============================================================================
 */

async function imageStrategy(
  request,
) {
  const cached =
    await caches.match(
      request,
    );

  if (cached) {
    return cached;
  }

  try {
    const response =
      await fetch(
        request,
      );

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
    return createOfflineResponse(
      error,
    );
  }
}

/**
 * =============================================================================
 * SAFE API GET STRATEGY
 * =============================================================================
 *
 * Network first:
 *
 *   network
 *      ↓ failure
 *   safe cached GET
 *      ↓ missing
 *   offline response
 *
 * IMPORTANT:
 *
 * This strategy intentionally excludes:
 *
 *   - authentication
 *   - user-specific authenticated APIs
 *   - financial APIs
 *   - offline synchronization
 *   - KYC / AML
 *   - administration
 *
 * =============================================================================
 */

async function safeApiStrategy(
  request,
) {
  try {
    const response =
      await fetchWithTimeout(
        request,
      );

    if (
      response &&
      response.ok
    ) {
      await safeCachePut(
        TITech.API_CACHE,
        request,
        response,
      );

      await trimCache(
        TITech.API_CACHE,
        TITech.MAX_API_ENTRIES,
      );
    }

    return response;
  } catch {
    const cached =
      await caches.match(
        request,
      );

    if (cached) {
      return cached;
    }

    return createOfflineResponse();
  }
}

/**
 * =============================================================================
 * OFFLINE RESPONSE
 * =============================================================================
 */

function createOfflineResponse(
  error = null,
) {
  const payload = {
    success: false,

    offline: true,

    service:
      TITech.SERVICE,

    code:
      'NETWORK_UNAVAILABLE',

    message:
      'The TITech application is currently offline.',

    timestamp:
      new Date().toISOString(),
  };

  if (
    error &&
    self.location.hostname ===
      'localhost'
  ) {
    payload.debug =
      error.message;
  }

  return new Response(
    JSON.stringify(
      payload,
    ),
    {
      status:
        503,

      statusText:
        'Service Unavailable',

      headers: {
        'Content-Type':
          'application/json; charset=utf-8',

        'Cache-Control':
          'no-store',

        'X-TITech-Offline':
          'true',
      },
    },
  );
}

/**
 * =============================================================================
 * MESSAGE HANDLING
 * =============================================================================
 *
 * The frontend may communicate with the service worker using:
 *
 *   navigator.serviceWorker.controller.postMessage({
 *     type: 'SKIP_WAITING'
 *   });
 *
 * =============================================================================
 */

self.addEventListener(
  'message',
  (event) => {
    const message =
      event.data;

    if (
      !message ||
      typeof message !==
        'object'
    ) {
      return;
    }

    switch (
      message.type
    ) {
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
          respondWithStatus(
            event,
          ),
        );
        break;

      case 'PING':
        event.source?.postMessage({
          type:
            'PONG',

          service:
            TITech.SERVICE,

          version:
            TITech.VERSION,
        });
        break;

      default:
        break;
    }
  },
);

/**
 * =============================================================================
 * CACHE MANAGEMENT
 * =============================================================================
 */

async function clearApplicationCaches() {
  await Promise.all([
    caches.delete(
      TITech.STATIC_CACHE,
    ),

    caches.delete(
      TITech.RUNTIME_CACHE,
    ),

    caches.delete(
      TITech.IMAGE_CACHE,
    ),

    caches.delete(
      TITech.API_CACHE,
    ),

    caches.delete(
      TITech.OFFLINE_CACHE,
    ),
  ]);
}

async function respondWithStatus(
  event,
) {
  const cacheNames =
    await caches.keys();

  event.source?.postMessage({
    type:
      'SERVICE_WORKER_STATUS',

    service:
      TITech.SERVICE,

    version:
      TITech.VERSION,

    cacheNames,

    online:
      true,
  });
}

async function notifyClients(
  message,
) {
  const clients =
    await self.clients.matchAll({
      type: 'window',

      includeUncontrolled:
        true,
    });

  await Promise.all(
    clients.map(
      (client) =>
        client.postMessage(
          message,
        ),
    ),
  );
}

/**
 * =============================================================================
 * BACKGROUND SYNC
 * =============================================================================
 *
 * This is a hook, not the financial transaction boundary.
 *
 * The application can register a sync tag:
 *
 *   registration.sync.register(
 *     'titech-offline-sync'
 *   );
 *
 * When the browser provides Background Sync, this worker notifies the
 * application to initiate its normal authenticated synchronization flow.
 *
 * The application/backend must continue to enforce:
 *
 *   Idempotency-Key
 *   Event ID
 *   Device ID
 *   Tenant ID
 *   Event hash
 *   Transaction boundary
 *
 * =============================================================================
 */

self.addEventListener(
  'sync',
  (event) => {
    if (
      event.tag !==
      TITech.SYNC_QUEUE
    ) {
      return;
    }

    event.waitUntil(
      notifyClients({
        type:
          'OFFLINE_SYNC_REQUIRED',

        service:
          TITech.SERVICE,

        version:
          TITech.VERSION,

        timestamp:
          new Date().toISOString(),
      }),
    );
  },
);

/**
 * =============================================================================
 * PUSH NOTIFICATIONS
 * =============================================================================
 *
 * Push handling is intentionally minimal.
 *
 * Financial state should NEVER be trusted from push payloads. The client
 * should retrieve authoritative state from the TITech backend.
 * =============================================================================
 */

self.addEventListener(
  'push',
  (event) => {
    if (!event.data) {
      return;
    }

    let payload;

    try {
      payload =
        event.data.json();
    } catch {
      payload = {
        title:
          'TITech',

        body:
          event.data.text(),
      };
    }

    const title =
      payload.title ||
      'TITech';

    const options = {
      body:
        payload.body ||
        'You have a new notification.',

      icon:
        payload.icon ||
        '/images/icon-192.png',

      badge:
        payload.badge ||
        '/images/icon-192.png',

      tag:
        payload.tag ||
        'titech-notification',

      data: {
        url:
          payload.url ||
          '/',

        notificationId:
          payload.notificationId ||
          null,
      },

      renotify:
        Boolean(
          payload.renotify,
        ),

      requireInteraction:
        Boolean(
          payload.requireInteraction,
        ),
    };

    event.waitUntil(
      self.registration.showNotification(
        title,
        options,
      ),
    );
  },
);

/**
 * =============================================================================
 * NOTIFICATION CLICK
 * =============================================================================
 */

self.addEventListener(
  'notificationclick',
  (event) => {
    event.notification.close();

    const targetUrl =
      event.notification.data
        ?.url || '/';

    event.waitUntil(
      (async () => {
        const clients =
          await self.clients.matchAll({
            type: 'window',

            includeUncontrolled:
              true,
          });

        /*
         * Prefer an already-open TITech application window.
         */
        for (
          const client of clients
        ) {
          if (
            'focus' in client
          ) {
            await client.focus();

            if (
              'navigate' in client
            ) {
              await client.navigate(
                targetUrl,
              );
            }

            return;
          }
        }

        /*
         * Open a new window when no TITech client is available.
         */
        if (
          self.clients.openWindow
        ) {
          await self.clients.openWindow(
            targetUrl,
          );
        }
      })(),
    );
  },
);

/**
 * =============================================================================
 * ERROR HANDLING
 * =============================================================================
 */

self.addEventListener(
  'error',
  (event) => {
    /*
     * Do not expose sensitive request/response information.
     */
    notifyClients({
      type:
        'SERVICE_WORKER_ERROR',

      service:
        TITech.SERVICE,

      message:
        'Service worker runtime error.',
    }).catch(() => {});
  },
);

self.addEventListener(
  'unhandledrejection',
  (event) => {
    notifyClients({
      type:
        'SERVICE_WORKER_ERROR',

      service:
        TITech.SERVICE,

      message:
        'Service worker asynchronous operation failed.',
    }).catch(() => {});
  },
);

/**
 * =============================================================================
 * SERVICE WORKER READY MARKER
 * =============================================================================
 */

self.addEventListener(
  'activate',
  () => {
    /*
     * Deliberately empty.
     *
     * Kept as an explicit lifecycle marker for future instrumentation.
     */
  },
);