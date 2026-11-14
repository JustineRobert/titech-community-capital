/**
 * TITech Community Capital — same-origin Vercel API bridge.
 *
 * The backend origin is server-only (`TITECH_API_ORIGIN`). Never accept an
 * upstream host from a browser request. This function intentionally proxies
 * only /api/* paths and preserves the existing backend API contracts.
 */

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 25_000;

const ALLOWED_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

const REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'cookie',
  'idempotency-key',
  'if-match',
  'if-none-match',
  'origin',
  'x-correlation-id',
  'x-csrf-token',
  'x-device-id',
  'x-idempotency-key',
  'x-client-platform',
  'x-client-version',
  'x-request-id',
  'x-tenant-id',
];

const RESPONSE_HEADERS = [
  'content-type',
  'content-language',
  'cache-control',
  'etag',
  'last-modified',
  'retry-after',
  'vary',
  'www-authenticate',
  'x-correlation-id',
  'x-idempotent-replay',
  'x-request-id',
  'x-transaction-id',
];

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ success: false, code, message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function configuredBackendOrigin() {
  const configured = String(process.env.TITECH_API_ORIGIN || '').trim();
  if (!configured) {
    const error = new Error('TITECH_API_ORIGIN is not configured.');
    error.code = 'API_PROXY_NOT_CONFIGURED';
    throw error;
  }

  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    const error = new Error('TITECH_API_ORIGIN is not a valid URL.');
    error.code = 'API_PROXY_CONFIGURATION_INVALID';
    throw error;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const isLocalDevelopment =
    !isProduction &&
    parsed.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);

  if (
    !['https:', 'http:'].includes(parsed.protocol) ||
    (parsed.protocol !== 'https:' && !isLocalDevelopment) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    const error = new Error('TITECH_API_ORIGIN must be an HTTPS origin.');
    error.code = 'API_PROXY_CONFIGURATION_INVALID';
    throw error;
  }

  return parsed.origin;
}

function forwardedRequestHeaders(source) {
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function forwardedResponseHeaders(source) {
  const headers = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = source.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  // The refresh cookie must be scoped to the browser-facing TITech frontend
  // host. Remove an upstream Domain attribute, but preserve Path, Secure,
  // HttpOnly, SameSite, expiry and other cookie attributes.
  const cookies = typeof source.headers.getSetCookie === 'function'
    ? source.headers.getSetCookie()
    : (source.headers.get('set-cookie') ? [source.headers.get('set-cookie')] : []);

  for (const cookie of cookies) {
    headers.append(
      'set-cookie',
      cookie.replace(/;\s*domain=[^;]+/gi, ''),
    );
  }

  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return headers;
}

export async function proxyTitechApi(request) {
  const url = new URL(request.url);
  const method = String(request.method || 'GET').toUpperCase();

  if (!url.pathname.startsWith('/api/')) {
    return jsonError(404, 'API_PROXY_PATH_NOT_FOUND', 'API route not found.');
  }

  if (!ALLOWED_METHODS.has(method)) {
    return jsonError(405, 'API_PROXY_METHOD_NOT_ALLOWED', 'HTTP method not allowed.');
  }

  let backendOrigin;
  try {
    backendOrigin = configuredBackendOrigin();
  } catch (error) {
    const isMissing = error?.code === 'API_PROXY_NOT_CONFIGURED';
    return jsonError(
      503,
      isMissing ? 'API_PROXY_NOT_CONFIGURED' : 'API_PROXY_CONFIGURATION_INVALID',
      isMissing
        ? 'The TITech API connection has not been configured.'
        : 'The TITech API connection is not configured correctly.',
    );
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return jsonError(413, 'API_PROXY_REQUEST_TOO_LARGE', 'Request body exceeds the permitted size.');
  }

  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > MAX_REQUEST_BYTES) {
        return jsonError(413, 'API_PROXY_REQUEST_TOO_LARGE', 'Request body exceeds the permitted size.');
      }
      body = bytes.byteLength ? bytes : undefined;
    } catch {
      return jsonError(400, 'API_PROXY_REQUEST_INVALID', 'The request body could not be read.');
    }
  }

  const upstreamUrl = new URL(`${url.pathname}${url.search}`, backendOrigin);

  try {
    const upstream = await fetch(upstreamUrl, {
      method,
      headers: forwardedRequestHeaders(request.headers),
      ...(body ? { body } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const responseBody = method === 'HEAD' || upstream.status === 204 || upstream.status === 304
      ? null
      : await upstream.arrayBuffer();
    return new Response(responseBody, {
      status: upstream.status,
      headers: forwardedResponseHeaders(upstream),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return jsonError(
      timedOut ? 504 : 502,
      timedOut ? 'API_UPSTREAM_TIMEOUT' : 'API_UPSTREAM_UNAVAILABLE',
      timedOut
        ? 'The TITech API did not respond in time. Check the operation status before retrying.'
        : 'The TITech API is temporarily unavailable. Please try again later.',
    );
  }
}

export function GET(request) { return proxyTitechApi(request); }
export function HEAD(request) { return proxyTitechApi(request); }
export function POST(request) { return proxyTitechApi(request); }
export function PUT(request) { return proxyTitechApi(request); }
export function PATCH(request) { return proxyTitechApi(request); }
export function DELETE(request) { return proxyTitechApi(request); }
export function OPTIONS(request) { return proxyTitechApi(request); }
