const DEFAULT_TIMEOUT_MS = 10_000;

function classifyNetworkFailure(error) {
  const code = error?.cause?.code || error?.code;
  if (code && /ENOTFOUND|EAI_AGAIN|EAI_FAIL/.test(code)) return 'DNS';
  if (code && /CERT|TLS|SSL|ERR_TLS/.test(code)) return 'TLS';
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'TIMEOUT';
  if (code && /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/.test(code)) return 'CONNECTION';
  return 'NETWORK';
}

export function normalizeApiOrigin(value, mode = 'production') {
  const configured = String(value || '').trim();
  if (!configured) throw new Error('API_ORIGIN_MISSING: configure the target API origin before verification.');

  let parsed;
  try { parsed = new URL(configured); } catch {
    throw new Error('API_ORIGIN_INVALID: the configured API origin is not a valid URL.');
  }

  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const permitsLocalHttp = ['local', 'integration'].includes(mode) && isLocal && parsed.protocol === 'http:';
  if (
    !['https:', 'http:'].includes(parsed.protocol)
    || (parsed.protocol !== 'https:' && !permitsLocalHttp)
    || parsed.username || parsed.password
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.search || parsed.hash
  ) {
    throw new Error('API_ORIGIN_INVALID: target must be an HTTPS origin (HTTP is allowed only for local/integration loopback).');
  }

  return parsed.origin;
}

async function requestJson({ fetchImpl, origin, pathname, method = 'GET', body, expectedStatuses, timeoutMs }) {
  const url = new URL(pathname, origin);
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      redirect: 'manual',
      headers: body === undefined ? { accept: 'application/json' } : {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const layer = classifyNetworkFailure(error);
    throw new Error(`${layer}_FAILURE: ${method} ${pathname} could not reach the API origin (${error?.cause?.code || error?.name || 'network error'}).`, { cause: error });
  }

  const contentType = response.headers.get('content-type') || '';
  const responseText = await response.text();
  if (!expectedStatuses.includes(response.status)) {
    const layer = response.status === 404 ? 'ROUTING' : response.status >= 500 ? 'UPSTREAM_OR_APPLICATION' : 'HTTP';
    throw new Error(`${layer}_FAILURE: ${method} ${pathname} returned HTTP ${response.status}; expected ${expectedStatuses.join(', ')}.`);
  }

  if (!/\bapplication\/json\b/i.test(contentType)) {
    throw new Error(`CONTENT_TYPE_FAILURE: ${method} ${pathname} returned ${contentType || 'no content type'} instead of JSON (possible SPA fallback/API misroute).`);
  }

  let payload;
  try { payload = responseText ? JSON.parse(responseText) : null; } catch {
    throw new Error(`JSON_PARSE_FAILURE: ${method} ${pathname} returned invalid JSON.`);
  }
  return { status: response.status, contentType, payload };
}

export async function verifyProductionContract({
  origin,
  mode = 'production',
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new RangeError('timeoutMs must be an integer from 100 to 60000.');
  }

  const normalizedOrigin = normalizeApiOrigin(origin, mode);
  const checks = [];
  const health = await requestJson({
    fetchImpl, origin: normalizedOrigin, pathname: '/api/v1/health',
    expectedStatuses: [200], timeoutMs,
  });
  if (health.payload?.success !== true || health.payload?.status !== 'healthy') {
    throw new Error('HEALTH_PAYLOAD_FAILURE: /api/v1/health returned HTTP 200 without the expected success=true, status=healthy contract.');
  }
  checks.push({ endpoint: '/api/v1/health', ...health });

  const readiness = await requestJson({
    fetchImpl, origin: normalizedOrigin, pathname: '/api/v1/ready',
    expectedStatuses: [200], timeoutMs,
  });
  if (readiness.payload?.success !== true || readiness.payload?.status !== 'ready') {
    throw new Error('READINESS_PAYLOAD_FAILURE: /api/v1/ready returned HTTP 200 without the expected success=true, status=ready contract.');
  }
  checks.push({ endpoint: '/api/v1/ready', ...readiness });

  checks.push({ endpoint: '/api/auth/login', ...(await requestJson({
    fetchImpl, origin: normalizedOrigin, pathname: '/api/auth/login', method: 'POST',
    body: { email: 'invalid-test@example.invalid', password: 'invalid-test' },
    expectedStatuses: [400, 401, 403, 422, 429], timeoutMs,
  })) });

  return {
    status: 'PASS',
    mode,
    origin: normalizedOrigin,
    checks,
    verifiedAt: new Date().toISOString(),
  };
}
