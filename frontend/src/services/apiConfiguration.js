// ============================================================================
// TITech Community Capital — API origin configuration contract
// ============================================================================

const DEFAULT_DEV_API_ORIGIN = 'http://localhost:5000';
const API_PREFIXES = new Set(['/api', '/api/v1']);

function trimTrailingSlashes(value) {
  return String(value).replace(/\/+$/, '');
}

export function isRelativeApiProxy(value) {
  const candidate = String(value || '').trim();
  return candidate.startsWith('/') && !candidate.startsWith('//');
}

export function normalizeConfiguredApiBaseUrl(value) {
  const candidate = String(value || '').trim();

  if (!candidate) {
    return '';
  }

  if (isRelativeApiProxy(candidate)) {
    let path = trimTrailingSlashes(candidate) || '/';

    // The application routes already carry /api and /api/v1. A relative
    // proxy prefix therefore maps to the browser origin, not Axios baseURL.
    if (API_PREFIXES.has(path)) {
      return '';
    }

    return path === '/' ? '' : path;
  }

  try {
    const url = new URL(candidate);

    if (API_PREFIXES.has(url.pathname)) {
      url.pathname = '';
      url.search = '';
      url.hash = '';
    }

    return trimTrailingSlashes(url.toString());
  } catch {
    throw Object.assign(
      new Error('VITE_API_URL must be a valid absolute API origin or an explicit same-origin proxy path such as /api/v1.'),
      { code: 'TITECH_API_ORIGIN_INVALID' },
    );
  }
}

export function resolveApiBaseUrl(
  env = {},
  { production = false, allowDevelopmentFallback = true } = {},
) {
  const configured =
    env.VITE_API_URL || env.VITE_API_BASE_URL || '';

  if (configured) {
    return normalizeConfiguredApiBaseUrl(configured);
  }

  if (production) {
    throw Object.assign(
      new Error('Production frontend build requires VITE_API_URL or VITE_API_BASE_URL.'),
      { code: 'TITECH_API_ORIGIN_MISSING' },
    );
  }

  if (allowDevelopmentFallback) {
    return DEFAULT_DEV_API_ORIGIN;
  }

  return '';
}

export function getApiConfigurationDiagnostics(env = {}) {
  const configured =
    env.VITE_API_URL || env.VITE_API_BASE_URL || '';
  const sameOriginProxy = isRelativeApiProxy(configured);

  return {
    configured: Boolean(configured),
    sameOriginProxy,
    source: env.VITE_API_URL
      ? 'VITE_API_URL'
      : env.VITE_API_BASE_URL
        ? 'VITE_API_BASE_URL'
        : 'missing',
    normalizedBaseUrl: configured
      ? normalizeConfiguredApiBaseUrl(configured)
      : '',
  };
}

export { DEFAULT_DEV_API_ORIGIN };
