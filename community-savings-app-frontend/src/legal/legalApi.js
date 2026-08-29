/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Legal API Client
 * ============================================================================
 *
 * File:
 *   frontend/src/legal/legalApi.js
 *
 * Version:
 *   2.0.0
 *
 * Purpose:
 *   Production-grade API client for the TITech Community Capital legal
 *   document subsystem.
 *
 * Responsibilities:
 *   - Retrieve legal documents from the backend API.
 *   - Retrieve legal-document metadata.
 *   - Retrieve legal-document sections.
 *   - Normalize backend responses.
 *   - Validate legal document payloads.
 *   - Provide consistent API errors.
 *   - Support request cancellation/timeouts.
 *   - Support safe retries for idempotent requests.
 *   - Provide lightweight in-memory caching.
 *   - Prevent duplicate in-flight requests.
 *   - Support conditional API availability.
 *   - Keep frontend legal pages decoupled from transport details.
 *
 * Security Principles:
 *   - Never store secrets in this file.
 *   - Never expose server credentials.
 *   - Never trust API responses blindly.
 *   - Validate and normalize external data.
 *   - Only retry safe/idempotent operations.
 *   - Do not mutate server-side legal records from the frontend unless a
 *     dedicated authenticated administrative API is introduced.
 *
 * Branding:
 *   TITech Community Capital
 *
 * ============================================================================
 */

'use strict';

import {
  LEGAL_DOCUMENT_IDS,
  LEGAL_DOCUMENT_SLUGS,
  LEGAL_DOCUMENT_STATUS,
  getLegalDocument,
  getLegalDocumentById,
  getLegalDocumentBySlug,
} from './legalConfig';

import {
  REQUIRED_LEGAL_DOCUMENT_FIELDS,
  normalizeLegalDocument,
  validateLegalDocument,
} from './legalTypes';

/* ============================================================================
 * API CONFIGURATION
 * ========================================================================== */

const DEFAULT_API_BASE_URL = 'http://localhost:5000/api';

const DEFAULT_LEGAL_API_PREFIX = '/legal';

const DEFAULT_TIMEOUT_MS = 15_000;

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

const DEFAULT_MAX_RETRIES = 2;

const DEFAULT_RETRY_DELAY_MS = 350;

/**
 * Vite exposes frontend environment variables through import.meta.env.
 *
 * Supported:
 *   VITE_API_URL
 *   VITE_LEGAL_API_PREFIX
 *   VITE_LEGAL_API_TIMEOUT
 *   VITE_LEGAL_CACHE_TTL
 *   VITE_LEGAL_MAX_RETRIES
 */
const ENV =
  typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env
    : {};

const API_BASE_URL = normalizeBaseUrl(
  ENV.VITE_API_URL || DEFAULT_API_BASE_URL,
);

const LEGAL_API_PREFIX = normalizeApiPath(
  ENV.VITE_LEGAL_API_PREFIX || DEFAULT_LEGAL_API_PREFIX,
);

const REQUEST_TIMEOUT_MS = parsePositiveInteger(
  ENV.VITE_LEGAL_API_TIMEOUT,
  DEFAULT_TIMEOUT_MS,
);

const CACHE_TTL_MS = parsePositiveInteger(
  ENV.VITE_LEGAL_CACHE_TTL,
  DEFAULT_CACHE_TTL_MS,
);

const MAX_RETRIES = parseNonNegativeInteger(
  ENV.VITE_LEGAL_MAX_RETRIES,
  DEFAULT_MAX_RETRIES,
);

/* ============================================================================
 * API ENDPOINTS
 * ========================================================================== */

export const LEGAL_API_ENDPOINTS = Object.freeze({
  documents: LEGAL_API_PREFIX,

  documentById: (id) =>
    `${LEGAL_API_PREFIX}/${encodeURIComponent(id)}`,

  documentBySlug: (slug) =>
    `${LEGAL_API_PREFIX}/slug/${encodeURIComponent(slug)}`,

  sections: (identifier) =>
    `${LEGAL_API_PREFIX}/${encodeURIComponent(identifier)}/sections`,

  section: (identifier, sectionId) =>
    `${LEGAL_API_PREFIX}/${encodeURIComponent(identifier)}/sections/${encodeURIComponent(
      sectionId,
    )}`,

  metadata: (identifier) =>
    `${LEGAL_API_PREFIX}/${encodeURIComponent(identifier)}/metadata`,

  health: `${LEGAL_API_PREFIX}/health`,
});

/* ============================================================================
 * INTERNAL STATE
 * ========================================================================== */

/**
 * Lightweight in-memory cache.
 *
 * This cache intentionally does not use localStorage because legal documents
 * may change independently of application deployments and should not become
 * permanently stale through browser persistence.
 */
const responseCache = new Map();

/**
 * Prevent duplicate concurrent GET requests.
 */
const inFlightRequests = new Map();

/* ============================================================================
 * ERROR TYPES
 * ========================================================================== */

export class LegalApiError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'LegalApiError';

    this.code = options.code || 'LEGAL_API_ERROR';

    this.status = Number.isFinite(options.status)
      ? options.status
      : null;

    this.endpoint = options.endpoint || null;

    this.method = options.method || 'GET';

    this.details = options.details || null;

    this.retryable = Boolean(options.retryable);

    this.cause = options.cause || null;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LegalApiError);
    }
  }
}

/* ============================================================================
 * PUBLIC CONSTANTS
 * ========================================================================== */

export const LEGAL_API_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',

  INVALID_RESPONSE: 'INVALID_RESPONSE',

  VALIDATION_FAILED: 'VALIDATION_FAILED',

  NETWORK_ERROR: 'NETWORK_ERROR',

  TIMEOUT: 'TIMEOUT',

  ABORTED: 'ABORTED',

  HTTP_ERROR: 'HTTP_ERROR',

  NOT_FOUND: 'NOT_FOUND',

  UNAUTHORIZED: 'UNAUTHORIZED',

  FORBIDDEN: 'FORBIDDEN',

  RATE_LIMITED: 'RATE_LIMITED',

  SERVER_ERROR: 'SERVER_ERROR',

  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',

  UNKNOWN: 'UNKNOWN',
});

/* ============================================================================
 * UTILITY FUNCTIONS
 * ========================================================================== */

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return DEFAULT_API_BASE_URL;
  }

  return value.trim().replace(/\/+$/, '');
}

function normalizeApiPath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return DEFAULT_LEGAL_API_PREFIX;
  }

  const normalized = value.trim();

  return normalized.startsWith('/')
    ? `/${normalized.replace(/^\/+/, '').replace(/\/+$/, '')}`
    : `/${normalized.replace(/\/+$/, '')}`;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function normalizeIdentifier(identifier, name = 'identifier') {
  if (typeof identifier !== 'string' || !identifier.trim()) {
    throw new LegalApiError(
      `Legal document ${name} is required.`,
      {
        code: LEGAL_API_ERROR_CODES.INVALID_ARGUMENT,
      },
    );
  }

  return identifier.trim();
}

function getCacheKey(endpoint, options = {}) {
  const query = options.query || {};

  const queryString = Object.keys(query)
    .sort()
    .map((key) => {
      const value = query[key];

      if (
        value === undefined ||
        value === null ||
        value === ''
      ) {
        return null;
      }

      return `${encodeURIComponent(key)}=${encodeURIComponent(
        String(value),
      )}`;
    })
    .filter(Boolean)
    .join('&');

  return queryString ? `${endpoint}?${queryString}` : endpoint;
}

function buildQueryString(query = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (
      value === undefined ||
      value === null ||
      value === ''
    ) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => {
        searchParams.append(key, String(item));
      });

      return;
    }

    searchParams.set(key, String(value));
  });

  const queryString = searchParams.toString();

  return queryString ? `?${queryString}` : '';
}

function buildApiUrl(endpoint, query = {}) {
  const normalizedEndpoint = endpoint.startsWith('/')
    ? endpoint
    : `/${endpoint}`;

  return `${API_BASE_URL}${normalizedEndpoint}${buildQueryString(
    query,
  )}`;
}

function isAbortError(error) {
  return (
    error?.name === 'AbortError' ||
    error?.code === 'ABORT_ERR'
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/* ============================================================================
 * RETRY POLICY
 * ========================================================================== */

function isRetryableStatus(status) {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function calculateRetryDelay(attempt, retryAfter) {
  if (retryAfter) {
    const retryAfterSeconds = Number(retryAfter);

    if (
      Number.isFinite(retryAfterSeconds) &&
      retryAfterSeconds >= 0
    ) {
      return Math.min(
        retryAfterSeconds * 1000,
        10_000,
      );
    }
  }

  const exponentialDelay =
    DEFAULT_RETRY_DELAY_MS * 2 ** attempt;

  const jitter = Math.floor(Math.random() * 150);

  return Math.min(exponentialDelay + jitter, 5_000);
}

/* ============================================================================
 * RESPONSE PARSING
 * ========================================================================== */

async function parseResponseBody(response) {
  const contentType =
    response.headers.get('content-type') || '';

  if (
    contentType.includes('application/json') ||
    contentType.includes('+json')
  ) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      message: text,
    };
  }
}

function extractApiPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  /**
   * Supports common enterprise API envelope formats:
   *
   * {
   *   data: ...
   * }
   *
   * {
   *   success: true,
   *   data: ...
   * }
   *
   * {
   *   result: ...
   * }
   */
  if (
    Object.prototype.hasOwnProperty.call(payload, 'data')
  ) {
    return payload.data;
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, 'result')
  ) {
    return payload.result;
  }

  return payload;
}

function extractApiErrorMessage(payload, fallback) {
  if (!payload) {
    return fallback;
  }

  if (typeof payload === 'string') {
    return payload;
  }

  if (typeof payload.message === 'string') {
    return payload.message;
  }

  if (typeof payload.error === 'string') {
    return payload.error;
  }

  if (
    payload.error &&
    typeof payload.error.message === 'string'
  ) {
    return payload.error.message;
  }

  if (Array.isArray(payload.errors)) {
    const messages = payload.errors
      .map((error) => {
        if (typeof error === 'string') {
          return error;
        }

        return error?.message;
      })
      .filter(Boolean);

    if (messages.length > 0) {
      return messages.join('; ');
    }
  }

  return fallback;
}

/* ============================================================================
 * HTTP ERROR NORMALIZATION
 * ========================================================================== */

function createHttpError(response, payload, endpoint) {
  const status = response.status;

  let code = LEGAL_API_ERROR_CODES.HTTP_ERROR;

  if (status === 401) {
    code = LEGAL_API_ERROR_CODES.UNAUTHORIZED;
  } else if (status === 403) {
    code = LEGAL_API_ERROR_CODES.FORBIDDEN;
  } else if (status === 404) {
    code = LEGAL_API_ERROR_CODES.NOT_FOUND;
  } else if (status === 429) {
    code = LEGAL_API_ERROR_CODES.RATE_LIMITED;
  } else if (status >= 500) {
    code = LEGAL_API_ERROR_CODES.SERVER_ERROR;
  }

  return new LegalApiError(
    extractApiErrorMessage(
      payload,
      `Legal API request failed with HTTP ${status}.`,
    ),
    {
      code,
      status,
      endpoint,
      method: 'GET',
      retryable: isRetryableStatus(status),
      details: payload,
    },
  );
}

/* ============================================================================
 * CORE REQUEST ENGINE
 * ========================================================================== */

/**
 * Performs a GET request against the legal API.
 *
 * Only GET is exposed through this module by default because public legal
 * documents should be read-only from the normal application frontend.
 */
async function requestJson(
  endpoint,
  {
    query = {},
    signal,
    timeoutMs = REQUEST_TIMEOUT_MS,
    retries = MAX_RETRIES,
    cache = true,
    cacheTtlMs = CACHE_TTL_MS,
    forceRefresh = false,
    headers = {},
  } = {},
) {
  const url = buildApiUrl(endpoint, query);

  const cacheKey = getCacheKey(endpoint, {
    query,
  });

  if (cache && !forceRefresh) {
    const cached = responseCache.get(cacheKey);

    if (
      cached &&
      cached.expiresAt > Date.now()
    ) {
      return cached.data;
    }

    if (cached) {
      responseCache.delete(cacheKey);
    }
  }

  if (inFlightRequests.has(cacheKey) && !forceRefresh) {
    return inFlightRequests.get(cacheKey);
  }

  const requestPromise = executeRequest({
    url,
    endpoint,
    signal,
    timeoutMs,
    retries,
    headers,
  })
    .then((data) => {
      if (cache) {
        responseCache.set(cacheKey, {
          data,
          expiresAt: Date.now() + cacheTtlMs,
        });
      }

      return data;
    })
    .finally(() => {
      inFlightRequests.delete(cacheKey);
    });

  inFlightRequests.set(cacheKey, requestPromise);

  return requestPromise;
}

async function executeRequest({
  url,
  endpoint,
  signal,
  timeoutMs,
  retries,
  headers,
}) {
  let attempt = 0;

  while (true) {
    try {
      return await executeSingleRequest({
        url,
        endpoint,
        signal,
        timeoutMs,
        headers,
      });
    } catch (error) {
      const shouldRetry =
        error instanceof LegalApiError &&
        error.retryable &&
        attempt < retries;

      if (!shouldRetry) {
        throw error;
      }

      const delay = calculateRetryDelay(
        attempt,
        error.details?.retryAfter,
      );

      attempt += 1;

      await sleep(delay);
    }
  }
}

async function executeSingleRequest({
  url,
  endpoint,
  signal,
  timeoutMs,
  headers,
}) {
  const controller = new AbortController();

  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const abortHandler = () => {
    controller.abort();
  };

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);

      throw new LegalApiError(
        'The legal API request was aborted.',
        {
          code: LEGAL_API_ERROR_CODES.ABORTED,
          endpoint,
          retryable: false,
        },
      );
    }

    signal.addEventListener(
      'abort',
      abortHandler,
      { once: true },
    );
  }

  try {
    const response = await fetch(url, {
      method: 'GET',

      credentials: 'include',

      headers: {
        Accept: 'application/json',
        'X-Client': 'TITech-Community-Capital-Web',
        'X-Legal-API-Version': '2',
        ...headers,
      },

      signal: controller.signal,
    });

    const payload = await parseResponseBody(response);

    if (!response.ok) {
      const error = createHttpError(
        response,
        payload,
        endpoint,
      );

      error.details = {
        ...(error.details &&
        typeof error.details === 'object'
          ? error.details
          : {}),
        retryAfter:
          response.headers.get('retry-after') || null,
      };

      throw error;
    }

    return payload;
  } catch (error) {
    if (error instanceof LegalApiError) {
      throw error;
    }

    if (timedOut) {
      throw new LegalApiError(
        'The legal API request timed out.',
        {
          code: LEGAL_API_ERROR_CODES.TIMEOUT,
          endpoint,
          retryable: true,
          cause: error,
        },
      );
    }

    if (isAbortError(error)) {
      throw new LegalApiError(
        'The legal API request was aborted.',
        {
          code: LEGAL_API_ERROR_CODES.ABORTED,
          endpoint,
          retryable: false,
          cause: error,
        },
      );
    }

    throw new LegalApiError(
      'Unable to connect to the TITech Community Capital legal service.',
      {
        code: LEGAL_API_ERROR_CODES.NETWORK_ERROR,
        endpoint,
        retryable: true,
        cause: error,
      },
    );
  } finally {
    clearTimeout(timeoutId);

    if (signal) {
      signal.removeEventListener(
        'abort',
        abortHandler,
      );
    }
  }
}

/* ============================================================================
 * LEGAL DOCUMENT NORMALIZATION
 * ========================================================================== */

function normalizeApiLegalDocument(payload) {
  const rawDocument = extractApiPayload(payload);

  if (
    !rawDocument ||
    typeof rawDocument !== 'object'
  ) {
    throw new LegalApiError(
      'The legal API returned an invalid document payload.',
      {
        code: LEGAL_API_ERROR_CODES.INVALID_RESPONSE,
        retryable: false,
      },
    );
  }

  let normalizedDocument;

  try {
    normalizedDocument = normalizeLegalDocument(
      rawDocument,
    );
  } catch (error) {
    throw new LegalApiError(
      'The legal API returned a document that could not be normalized.',
      {
        code: LEGAL_API_ERROR_CODES.VALIDATION_FAILED,
        retryable: false,
        details: {
          cause: error?.message || String(error),
        },
        cause: error,
      },
    );
  }

  const validation = validateLegalDocument(
    normalizedDocument,
  );

  if (!validation.valid) {
    throw new LegalApiError(
      'The legal API returned an invalid legal document.',
      {
        code: LEGAL_API_ERROR_CODES.VALIDATION_FAILED,
        retryable: false,
        details: validation,
      },
    );
  }

  return normalizedDocument;
}

/* ============================================================================
 * PUBLIC DOCUMENT API
 * ========================================================================== */

/**
 * Fetch all active legal documents.
 *
 * @param {object} options
 * @returns {Promise<Array>}
 */
export async function fetchLegalDocuments(options = {}) {
  const payload = await requestJson(
    LEGAL_API_ENDPOINTS.documents,
    {
      ...options,
      query: {
        status: LEGAL_DOCUMENT_STATUS.ACTIVE,
        visibility: 'public',
        ...(options.query || {}),
      },
    },
  );

  const extracted = extractApiPayload(payload);

  const documents = Array.isArray(extracted)
    ? extracted
    : Array.isArray(extracted?.documents)
      ? extracted.documents
      : [];

  return documents.map(normalizeApiLegalDocument);
}

/**
 * Fetch a legal document by ID.
 *
 * @param {string} id
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function fetchLegalDocumentById(
  id,
  options = {},
) {
  const normalizedId = normalizeIdentifier(
    id,
    'ID',
  );

  const payload = await requestJson(
    LEGAL_API_ENDPOINTS.documentById(
      normalizedId,
    ),
    options,
  );

  return normalizeApiLegalDocument(payload);
}

/**
 * Fetch a legal document by slug.
 *
 * @param {string} slug
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function fetchLegalDocumentBySlug(
  slug,
  options = {},
) {
  const normalizedSlug = normalizeIdentifier(
    slug,
    'slug',
  );

  const payload = await requestJson(
    LEGAL_API_ENDPOINTS.documentBySlug(
      normalizedSlug,
    ),
    options,
  );

  return normalizeApiLegalDocument(payload);
}

/**
 * Resolve a legal document.
 *
 * Strategy:
 *   1. Attempt backend lookup.
 *   2. Fall back to local legalConfig metadata when configured.
 *
 * The fallback allows the legal UI to remain operational during temporary
 * backend/API outages while clearly distinguishing local metadata from
 * server-provided legal content.
 *
 * @param {string} identifier
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function resolveLegalDocument(
  identifier,
  options = {},
) {
  const normalizedIdentifier =
    normalizeIdentifier(
      identifier,
      'identifier',
    );

  try {
    return await fetchLegalDocumentBySlug(
      normalizedIdentifier,
      options,
    );
  } catch (error) {
    if (
      error?.code === LEGAL_API_ERROR_CODES.NOT_FOUND ||
      error?.code ===
        LEGAL_API_ERROR_CODES.NETWORK_ERROR ||
      error?.code ===
        LEGAL_API_ERROR_CODES.TIMEOUT
    ) {
      const localDocument =
        getLegalDocument(normalizedIdentifier);

      if (localDocument) {
        return localDocument;
      }
    }

    throw error;
  }
}

/* ============================================================================
 * SECTION API
 * ========================================================================== */

/**
 * Fetch all sections for a legal document.
 *
 * @param {string} identifier
 * @param {object} options
 * @returns {Promise<Array>}
 */
export async function fetchLegalSections(
  identifier,
  options = {},
) {
  const normalizedIdentifier =
    normalizeIdentifier(
      identifier,
      'identifier',
    );

  const payload = await requestJson(
    LEGAL_API_ENDPOINTS.sections(
      normalizedIdentifier,
    ),
    options,
  );

  const extracted = extractApiPayload(payload);

  if (Array.isArray(extracted)) {
    return extracted;
  }

  if (Array.isArray(extracted?.sections)) {
    return extracted.sections;
  }

  return [];
}

/**
 * Fetch a single legal section.
 *
 * @param {string} identifier
 * @param {string} sectionId
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function fetchLegalSection(
  identifier,
  sectionId,
  options = {},
) {
  const normalizedIdentifier =
    normalizeIdentifier(
      identifier,
      'identifier',
    );

  const normalizedSectionId =
    normalizeIdentifier(
      sectionId,
      'section ID',
    );

  const payload = await requestJson(
    LEGAL_API_ENDPOINTS.section(
      normalizedIdentifier,
      normalizedSectionId,
    ),
    options,
  );

  return extractApiPayload(payload);
}

/* ============================================================================
 * METADATA API
 * ========================================================================== */

/**
 * Fetch legal-document metadata without necessarily retrieving the full
 * document body.
 *
 * @param {string} identifier
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function fetchLegalMetadata(
  identifier,
  options = {},
) {
  const normalizedIdentifier =
    normalizeIdentifier(
      identifier,
      'identifier',
    );

  const payload = await requestJson(
    LEGAL_API_ENDPOINTS.metadata(
      normalizedIdentifier,
    ),
    options,
  );

  return extractApiPayload(payload);
}

/* ============================================================================
 * LOCAL CONFIGURATION HELPERS
 * ========================================================================== */

/**
 * Get local legal metadata without making a network request.
 *
 * Useful for:
 *   - navigation
 *   - breadcrumbs
 *   - initial page metadata
 *   - offline rendering
 *   - skeleton states
 *
 * @param {string} identifier
 * @returns {object|null}
 */
export function getLocalLegalDocument(
  identifier,
) {
  if (
    typeof identifier !== 'string' ||
    !identifier.trim()
  ) {
    return null;
  }

  return getLegalDocument(identifier.trim());
}

export function getLocalLegalDocumentById(id) {
  return getLegalDocumentById(id);
}

export function getLocalLegalDocumentBySlug(slug) {
  return getLegalDocumentBySlug(slug);
}

/* ============================================================================
 * CACHE MANAGEMENT
 * ========================================================================== */

/**
 * Clear all legal API cache entries.
 */
export function clearLegalApiCache() {
  responseCache.clear();
}

/**
 * Clear a specific legal-document cache entry.
 *
 * @param {string} identifier
 */
export function invalidateLegalDocumentCache(
  identifier,
) {
  if (
    typeof identifier !== 'string' ||
    !identifier.trim()
  ) {
    return;
  }

  const normalizedIdentifier =
    identifier.trim();

  const candidates = [
    LEGAL_API_ENDPOINTS.documentById(
      normalizedIdentifier,
    ),
    LEGAL_API_ENDPOINTS.documentBySlug(
      normalizedIdentifier,
    ),
    LEGAL_API_ENDPOINTS.metadata(
      normalizedIdentifier,
    ),
    LEGAL_API_ENDPOINTS.sections(
      normalizedIdentifier,
    ),
  ];

  candidates.forEach((endpoint) => {
    for (const key of responseCache.keys()) {
      if (
        key === endpoint ||
        key.startsWith(`${endpoint}?`)
      ) {
        responseCache.delete(key);
      }
    }
  });
}

/**
 * Return cache statistics.
 *
 * @returns {{
 *   entries: number,
 *   inFlightRequests: number
 * }}
 */
export function getLegalApiCacheStats() {
  return {
    entries: responseCache.size,
    inFlightRequests: inFlightRequests.size,
  };
}

/* ============================================================================
 * API HEALTH
 * ========================================================================== */

/**
 * Check whether the legal API is reachable.
 *
 * Returns a normalized health object instead of throwing for normal service
 * failures.
 *
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function checkLegalApiHealth(
  options = {},
) {
  try {
    const payload = await requestJson(
      LEGAL_API_ENDPOINTS.health,
      {
        ...options,
        cache: false,
        retries: 0,
      },
    );

    return {
      available: true,
      data: extractApiPayload(payload),
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      data: null,
      error: {
        code:
          error?.code ||
          LEGAL_API_ERROR_CODES.UNKNOWN,

        message:
          error?.message ||
          'Legal API unavailable.',

        status: error?.status || null,
      },
    };
  }
}

/* ============================================================================
 * CONFIGURATION / DIAGNOSTICS
 * ========================================================================== */

export function getLegalApiConfig() {
  return Object.freeze({
    baseUrl: API_BASE_URL,
    legalApiPrefix: LEGAL_API_PREFIX,
    timeoutMs: REQUEST_TIMEOUT_MS,
    cacheTtlMs: CACHE_TTL_MS,
    maxRetries: MAX_RETRIES,
  });
}

/**
 * Returns whether the frontend legal API client is configured.
 *
 * @returns {boolean}
 */
export function isLegalApiConfigured() {
  return Boolean(
    API_BASE_URL &&
      LEGAL_API_PREFIX &&
      typeof fetch === 'function',
  );
}

/* ============================================================================
 * BACKWARD-COMPATIBLE ALIASES
 * ========================================================================== */

export const getLegalDocuments =
  fetchLegalDocuments;

export const getLegalDocumentByIdApi =
  fetchLegalDocumentById;

export const getLegalDocumentBySlugApi =
  fetchLegalDocumentBySlug;

export const getLegalSections =
  fetchLegalSections;

export const getLegalSection =
  fetchLegalSection;

export const getLegalMetadata =
  fetchLegalMetadata;

/* ============================================================================
 * DEFAULT API OBJECT
 * ========================================================================== */

const legalApi = Object.freeze({
  endpoints: LEGAL_API_ENDPOINTS,

  errors: LEGAL_API_ERROR_CODES,

  config: getLegalApiConfig,

  configured: isLegalApiConfigured,

  fetchDocuments: fetchLegalDocuments,

  fetchDocumentById: fetchLegalDocumentById,

  fetchDocumentBySlug: fetchLegalDocumentBySlug,

  resolveDocument: resolveLegalDocument,

  fetchSections: fetchLegalSections,

  fetchSection: fetchLegalSection,

  fetchMetadata: fetchLegalMetadata,

  getLocalDocument: getLocalLegalDocument,

  getLocalDocumentById:
    getLocalLegalDocumentById,

  getLocalDocumentBySlug:
    getLocalLegalDocumentBySlug,

  checkHealth: checkLegalApiHealth,

  clearCache: clearLegalApiCache,

  invalidateDocumentCache:
    invalidateLegalDocumentCache,

  cacheStats: getLegalApiCacheStats,
});

export default legalApi;