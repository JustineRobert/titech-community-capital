 /**
  * ============================================================================
  * TITech Community Capital Ltd
  * Enterprise Legal Acceptance & Consent Module
  * ============================================================================
  *
  * File:
  *   frontend/src/legal/legalAcceptance.js
  *
  * Version:
  *   2.0.0
  *
  * Purpose:
  *   Production-grade legal acceptance and consent-management utilities for
  *   the TITech Community Capital frontend.
  *
  * Responsibilities:
  *   - Record acceptance of legal documents.
  *   - Track document IDs, slugs and versions.
  *   - Generate auditable acceptance records.
  *   - Prevent acceptance of unknown documents.
  *   - Prevent acceptance of invalid/stale legal versions.
  *   - Provide idempotency keys for acceptance requests.
  *   - Support server-side acceptance persistence.
  *   - Provide safe local fallback state for UX continuity.
  *   - Manage acceptance history.
  *   - Determine whether a user must re-accept updated documents.
  *   - Support acceptance/revocation status checks.
  *   - Normalize and validate acceptance responses.
  *
  * Security Principles:
  *   - Never store passwords, JWT secrets, API keys or sensitive credentials.
  *   - Never trust client-side acceptance records as the authoritative legal
  *     audit trail.
  *   - The backend must remain the authoritative source of legal acceptance.
  *   - LocalStorage is used only as a UX/cache mechanism.
  *   - Server timestamps should be preferred over browser timestamps.
  *   - Acceptance events should be immutable on the server.
  *   - Idempotency must be enforced server-side.
  *
  * Branding:
  *   TITech Community Capital
  *
  * ============================================================================
  */

'use strict';

import {
  LEGAL_BRAND,
  LEGAL_DOCUMENT_IDS,
  LEGAL_DOCUMENT_STATUS,
  LEGAL_VERSION,
  getLegalDocument,
  getLegalDocumentById,
  getLegalDocumentBySlug,
} from './legalConfig';

import {
  normalizeLegalDocument,
  validateLegalDocument,
} from './legalTypes';

/* ============================================================================
 * CONFIGURATION
 * ========================================================================== */

const STORAGE_KEY =
  'titech:legal:acceptance:v2';

const ACCEPTANCE_API_BASE =
  '/legal/acceptance';

const ACCEPTANCE_API_VERSION = '2';

const LOCAL_RECORD_TTL_MS =
  180 * 24 * 60 * 60 * 1000;

const MAX_HISTORY_ENTRIES = 100;

const IDEMPOTENCY_PREFIX =
  'titech-legal-acceptance';

/* ============================================================================
 * ACCEPTANCE TYPES
 * ========================================================================== */

export const LEGAL_ACCEPTANCE_TYPES = Object.freeze({
  INITIAL: 'initial',
  UPDATED_TERMS: 'updated-terms',
  UPDATED_PRIVACY: 'updated-privacy',
  UPDATED_DISCLAIMER: 'updated-disclaimer',
  RE_ACCEPTANCE: 're-acceptance',
});

/* ============================================================================
 * ACCEPTANCE STATUS
 * ========================================================================== */

export const LEGAL_ACCEPTANCE_STATUS = Object.freeze({
  ACCEPTED: 'accepted',
  PENDING: 'pending',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
  REQUIRES_REACCEPTANCE: 'requires_reacceptance',
});

/* ============================================================================
 * CONSENT SCOPE
 * ========================================================================== */

export const LEGAL_CONSENT_SCOPE = Object.freeze({
  TERMS_OF_SERVICE: 'terms_of_service',
  PRIVACY_POLICY: 'privacy_policy',
  DISCLAIMER: 'disclaimer',
  ALL_REQUIRED: 'all_required',
});

/* ============================================================================
 * ERROR CODES
 * ========================================================================== */

export const LEGAL_ACCEPTANCE_ERROR_CODES =
  Object.freeze({
    INVALID_DOCUMENT:
      'INVALID_DOCUMENT',

    INVALID_VERSION:
      'INVALID_VERSION',

    INVALID_ACCEPTANCE:
      'INVALID_ACCEPTANCE',

    REQUIRED_CONSENT_MISSING:
      'REQUIRED_CONSENT_MISSING',

    STORAGE_UNAVAILABLE:
      'STORAGE_UNAVAILABLE',

    API_UNAVAILABLE:
      'API_UNAVAILABLE',

    API_ERROR:
      'API_ERROR',

    REQUEST_ABORTED:
      'REQUEST_ABORTED',

    REQUEST_TIMEOUT:
      'REQUEST_TIMEOUT',

    INVALID_RESPONSE:
      'INVALID_RESPONSE',

    UNKNOWN:
      'UNKNOWN',
  });

/* ============================================================================
 * ERROR CLASS
 * ========================================================================== */

export class LegalAcceptanceError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'LegalAcceptanceError';

    this.code =
      options.code ||
      LEGAL_ACCEPTANCE_ERROR_CODES.UNKNOWN;

    this.status =
      Number.isFinite(options.status)
        ? options.status
        : null;

    this.details =
      options.details || null;

    this.cause =
      options.cause || null;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(
        this,
        LegalAcceptanceError,
      );
    }
  }
}

/* ============================================================================
 * UTILITY FUNCTIONS
 * ========================================================================== */

function isBrowser() {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined'
  );
}

function getStorage() {
  if (!isBrowser()) {
    return null;
  }

  try {
    if (!window.localStorage) {
      return null;
    }

    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeIdentifier(
  identifier,
  fieldName = 'identifier',
) {
  if (
    typeof identifier !== 'string' ||
    !identifier.trim()
  ) {
    throw new LegalAcceptanceError(
      `Legal ${fieldName} is required.`,
      {
        code:
          LEGAL_ACCEPTANCE_ERROR_CODES.INVALID_DOCUMENT,
      },
    );
  }

  return identifier.trim();
}

function normalizeBoolean(value) {
  return value === true;
}

function generateRandomId() {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return [
    Date.now().toString(36),
    Math.random()
      .toString(36)
      .slice(2),
    Math.random()
      .toString(36)
      .slice(2),
  ].join('-');
}

function generateIdempotencyKey({
  documentId,
  version,
  userId,
}) {
  const safeUserId =
    typeof userId === 'string' &&
    userId.trim()
      ? userId.trim()
      : 'anonymous';

  return [
    IDEMPOTENCY_PREFIX,
    documentId,
    version,
    safeUserId,
    generateRandomId(),
  ]
    .join('-')
    .replace(/[^a-zA-Z0-9_-]/g, '');
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/* ============================================================================
 * DEVICE / CLIENT METADATA
 * ========================================================================== */

/**
 * This metadata is intentionally limited.
 *
 * Do not collect invasive fingerprinting information from the browser.
 * The backend should determine authoritative IP address, server timestamp,
 * authentication identity and security context.
 */
function getClientMetadata() {
  if (!isBrowser()) {
    return {
      platform: 'unknown',
      language: null,
      timezone: null,
    };
  }

  let timezone = null;

  try {
    timezone =
      Intl.DateTimeFormat().resolvedOptions()
        .timeZone || null;
  } catch {
    timezone = null;
  }

  return {
    platform:
      typeof navigator !== 'undefined'
        ? navigator.platform || null
        : null,

    language:
      typeof navigator !== 'undefined'
        ? navigator.language || null
        : null,

    timezone,

    userAgent:
      typeof navigator !== 'undefined'
        ? navigator.userAgent || null
        : null,
  };
}

/* ============================================================================
 * DOCUMENT RESOLUTION
 * ========================================================================== */

/**
 * Resolve a legal document using:
 *   1. ID
 *   2. slug
 *   3. configured legal registry
 *
 * @param {string} identifier
 * @returns {object}
 */
export function resolveAcceptanceDocument(
  identifier,
) {
  const normalizedIdentifier =
    normalizeIdentifier(
      identifier,
      'document identifier',
    );

  const document =
    getLegalDocument(normalizedIdentifier);

  if (!document) {
    throw new LegalAcceptanceError(
      `Unknown legal document: ${normalizedIdentifier}`,
      {
        code:
          LEGAL_ACCEPTANCE_ERROR_CODES.INVALID_DOCUMENT,
      },
    );
  }

  return document;
}

/* ============================================================================
 * ACCEPTANCE RECORD VALIDATION
 * ========================================================================== */

const REQUIRED_ACCEPTANCE_FIELDS =
  Object.freeze([
    'id',
    'documentId',
    'documentSlug',
    'documentVersion',
    'status',
    'acceptedAt',
    'acceptanceType',
    'consentScope',
    'source',
  ]);

/**
 * Validate a legal acceptance record.
 *
 * @param {unknown} record
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateAcceptanceRecord(
  record,
) {
  const errors = [];

  if (
    !record ||
    typeof record !== 'object'
  ) {
    return {
      valid: false,
      errors: [
        'Acceptance record must be an object.',
      ],
    };
  }

  REQUIRED_ACCEPTANCE_FIELDS.forEach(
    (field) => {
      if (
        record[field] === undefined ||
        record[field] === null ||
        record[field] === ''
      ) {
        errors.push(
          `Missing required acceptance field: ${field}`,
        );
      }
    },
  );

  if (
    record.id &&
    typeof record.id !== 'string'
  ) {
    errors.push(
      'Acceptance record ID must be a string.',
    );
  }

  if (
    record.documentId &&
    typeof record.documentId !== 'string'
  ) {
    errors.push(
      'Acceptance document ID must be a string.',
    );
  }

  if (
    record.documentVersion &&
    typeof record.documentVersion !== 'string'
  ) {
    errors.push(
      'Acceptance document version must be a string.',
    );
  }

  if (
    record.status &&
    !Object.values(
      LEGAL_ACCEPTANCE_STATUS,
    ).includes(record.status)
  ) {
    errors.push(
      `Invalid acceptance status: ${record.status}`,
    );
  }

  if (
    record.acceptedAt &&
    Number.isNaN(
      Date.parse(record.acceptedAt),
    )
  ) {
    errors.push(
      'Acceptance acceptedAt must be a valid ISO date.',
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/* ============================================================================
 * ACCEPTANCE RECORD NORMALIZATION
 * ========================================================================== */

/**
 * Normalize an acceptance record received from the backend.
 *
 * @param {unknown} payload
 * @returns {object}
 */
export function normalizeAcceptanceRecord(
  payload,
) {
  const source =
    payload?.data ||
    payload?.result ||
    payload;

  if (
    !source ||
    typeof source !== 'object'
  ) {
    throw new LegalAcceptanceError(
      'Invalid legal acceptance response.',
      {
        code:
          LEGAL_ACCEPTANCE_ERROR_CODES.INVALID_RESPONSE,
      },
    );
  }

  const record = {
    id:
      source.id ||
      source.acceptanceId ||
      generateRandomId(),

    documentId:
      source.documentId ||
      source.legalDocumentId ||
      null,

    documentSlug:
      source.documentSlug ||
      source.slug ||
      null,

    documentVersion:
      source.documentVersion ||
      source.version ||
      null,

    status:
      source.status ||
      LEGAL_ACCEPTANCE_STATUS.ACCEPTED,

    acceptedAt:
      source.acceptedAt ||
      source.createdAt ||
      null,

    acceptanceType:
      source.acceptanceType ||
      LEGAL_ACCEPTANCE_TYPES.INITIAL,

    consentScope:
      source.consentScope ||
      LEGAL_CONSENT_SCOPE.ALL_REQUIRED,

    source:
      source.source ||
      'titech-web',

    userId:
      source.userId ||
      null,

    tenantId:
      source.tenantId ||
      null,

    idempotencyKey:
      source.idempotencyKey ||
      null,

    serverTimestamp:
      source.serverTimestamp ||
      source.createdAt ||
      null,

    metadata:
      source.metadata &&
      typeof source.metadata === 'object'
        ? source.metadata
        : {},
  };

  const validation =
    validateAcceptanceRecord(record);

  if (!validation.valid) {
    throw new LegalAcceptanceError(
      'Invalid legal acceptance record.',
      {
        code:
          LEGAL_ACCEPTANCE_ERROR_CODES.INVALID_RESPONSE,

        details: validation.errors,
      },
    );
  }

  return Object.freeze(record);
}

/* ============================================================================
 * ACCEPTANCE RECORD CREATION
 * ========================================================================== */

/**
 * Create a client-side acceptance record.
 *
 * This does NOT constitute authoritative legal acceptance until persisted and
 * acknowledged by the backend.
 *
 * @param {object} options
 * @returns {object}
 */
export function createAcceptanceRecord({
  document,
  acceptanceType =
    LEGAL_ACCEPTANCE_TYPES.INITIAL,
  consentScope =
    LEGAL_CONSENT_SCOPE.ALL_REQUIRED,
  userId = null,
  tenantId = null,
  metadata = {},
} = {}) {
  if (
    !document ||
    typeof document !== 'object'
  ) {
    throw new LegalAcceptanceError(
      'A legal document is required.',
      {
        code:
          LEGAL_ACCEPTANCE_ERROR_CODES.INVALID_DOCUMENT,
      },
    );
  }

  const normalizedDocument =
    normalizeLegalDocument(document);

  const validation =
    validateLegalDocument(
      normalizedDocument,
    );

  if (!validation.valid) {
    throw new LegalAcceptanceError(
      'The legal document is invalid and cannot be accepted.',
      {
        code:
          LEGAL_ACCEPTANCE_ERROR_CODES.INVALID_DOCUMENT,
        details: validation.errors,
      },
    );
  }

  if (
    normalizedDocument.status !==
    LEGAL_DOCUMENT_STATUS.ACTIVE
  ) {
    throw new LegalAcceptanceError(
      'Only active legal documents can be accepted.',
      {
        code:
          LEGAL_ACCEPTANCE_ERROR_CODES.INVALID_DOCUMENT,
      },
    );
  }

  const acceptedAt =
    new Date().toISOString();

  const record = {
    id: generateRandomId(),

    documentId:
      normalizedDocument.id,

    documentSlug:
      normalizedDocument.slug,

    documentVersion:
      normalizedDocument.version,

    status:
      LEGAL_ACCEPTANCE_STATUS.ACCEPTED,

    acceptedAt,

    acceptanceType,

    consentScope,

    source: 'titech-web',

    userId,

    tenantId,

    idempotencyKey:
      generateIdempotencyKey({
        documentId:
          normalizedDocument.id,
        version:
          normalizedDocument.version,
        userId,
      }),

    serverTimestamp: null,

    metadata: {
      ...getClientMetadata(),
      ...metadata,
    },
  };

  const recordValidation =
    validateAcceptanceRecord(record);

  if (!recordValidation.valid) {
    throw new LegalAcceptanceError(
      'Unable to create a valid legal acceptance record.',
      {
        code:
          LEGAL_ACCEPTANCE_ERROR_CODES.INVALID_ACCEPTANCE,
        details:
          recordValidation.errors,
      },
    );
  }

  return Object.freeze(record);
}

/* ============================================================================
 * REQUIRED DOCUMENT ACCEPTANCE
 * ========================================================================== */

/**
 * Default legal documents that normally require acceptance.
 *
 * Business/legal policy may later make this tenant- or jurisdiction-specific.
 */
export const REQUIRED_LEGAL_DOCUMENTS =
  Object.freeze([
    LEGAL_DOCUMENT_IDS.TERMS_OF_SERVICE,
    LEGAL_DOCUMENT_IDS.PRIVACY_POLICY,
  ]);

/**
 * Check whether a set of acceptance records contains all required legal
 * documents at their current configured versions.
 *
 * @param {Array} acceptanceRecords
 * @param {Array} requiredDocumentIds
 * @returns {{accepted: boolean, missing: Array, stale: Array}}
 */
export function evaluateRequiredAcceptances(
  acceptanceRecords = [],
  requiredDocumentIds =
    REQUIRED_LEGAL_DOCUMENTS,
) {
  if (!Array.isArray(acceptanceRecords)) {
    acceptanceRecords = [];
  }

  const missing = [];
  const stale = [];
  const accepted = [];

  requiredDocumentIds.forEach(
    (documentId) => {
      const document =
        getLegalDocumentById(
          documentId,
        );

      if (!document) {
        return;
      }

      const matchingRecords =
        acceptanceRecords.filter(
          (record) =>
            record &&
            record.documentId ===
              document.id &&
            record.status ===
              LEGAL_ACCEPTANCE_STATUS.ACCEPTED,
        );

      if (matchingRecords.length === 0) {
        missing.push(document.id);
        return;
      }

      const currentVersionAccepted =
        matchingRecords.some(
          (record) =>
            record.documentVersion ===
            document.version,
        );

      if (!currentVersionAccepted) {
        stale.push({
          documentId: document.id,
          currentVersion:
            document.version,
          acceptedVersions:
            matchingRecords.map(
              (record) =>
                record.documentVersion,
            ),
        });

        return;
      }

      accepted.push(document.id);
    },
  );

  return {
    accepted:
      missing.length === 0 &&
      stale.length === 0,

    missing,

    stale,

    acceptedDocuments: accepted,
  };
}

/**
 * Determine whether a specific document requires re-acceptance.
 *
 * @param {string} identifier
 * @param {Array} acceptanceRecords
 * @returns {boolean}
 */
export function requiresReacceptance(
  identifier,
  acceptanceRecords = [],
) {
  const document =
    resolveAcceptanceDocument(
      identifier,
    );

  const result =
    evaluateRequiredAcceptances(
      acceptanceRecords,
      [document.id],
    );

  return !result.accepted;
}

/* ============================================================================
 * LOCAL STORAGE
 * ========================================================================== */

function readLocalAcceptanceState() {
  const storage = getStorage();

  if (!storage) {
    return [];
  }

  try {
    const raw =
      storage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed =
      safeJsonParse(raw, []);

    if (!Array.isArray(parsed)) {
      return [];
    }

    const now = Date.now();

    return parsed.filter((record) => {
      if (
        !record ||
        typeof record !== 'object'
      ) {
        return false;
      }

      if (!record.acceptedAt) {
        return false;
      }

      const timestamp =
        Date.parse(record.acceptedAt);

      if (Number.isNaN(timestamp)) {
        return false;
      }

      return (
        now - timestamp <=
        LOCAL_RECORD_TTL_MS
      );
    });
  } catch {
    return [];
  }
}

function writeLocalAcceptanceState(
  records,
) {
  const storage = getStorage();

  if (!storage) {
    return false;
  }

  try {
    const normalizedRecords =
      records
        .filter(Boolean)
        .slice(-MAX_HISTORY_ENTRIES);

    const serialized =
      safeJsonStringify(
        normalizedRecords,
      );

    if (!serialized) {
      return false;
    }

    storage.setItem(
      STORAGE_KEY,
      serialized,
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * Save an acceptance record locally for UX continuity.
 *
 * IMPORTANT:
 * This is not the authoritative legal record.
 *
 * @param {object} record
 * @returns {boolean}
 */
export function saveLocalAcceptance(
  record,
) {
  const validation =
    validateAcceptanceRecord(record);

  if (!validation.valid) {
    throw new LegalAcceptanceError(
      'Cannot store invalid legal acceptance record.',
      {
        code:
          LEGAL_ACCEPTANCE_ERROR_CODES.INVALID_ACCEPTANCE,
        details:
          validation.errors,
      },
    );
  }

  const records =
    readLocalAcceptanceState();

  const filtered =
    records.filter(
      (existing) =>
        !(
          existing.documentId ===
            record.documentId &&
          existing.documentVersion ===
            record.documentVersion
        ),
    );

  filtered.push(record);

  return writeLocalAcceptanceState(
    filtered,
  );
}

/**
 * Read local acceptance history.
 *
 * @returns {Array}
 */
export function getLocalAcceptanceHistory() {
  return readLocalAcceptanceState();
}

/**
 * Clear local acceptance records.
 *
 * This does not revoke server-side consent.
 */
export function clearLocalAcceptanceHistory() {
  const storage = getStorage();

  if (!storage) {
    return false;
  }

  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/* ============================================================================
 * LOCAL ACCEPTANCE LOOKUPS
 * ========================================================================== */

/**
 * Get the most recent acceptance for a document.
 *
 * @param {string} identifier
 * @returns {object|null}
 */
export function getLocalAcceptance(
  identifier,
) {
  const document =
    resolveAcceptanceDocument(
      identifier,
    );

  const records =
    getLocalAcceptanceHistory();

  const matching =
    records
      .filter(
        (record) =>
          record.documentId ===
          document.id,
      )
      .sort(
        (a, b) =>
          Date.parse(b.acceptedAt) -
          Date.parse(a.acceptedAt),
      );

  return matching[0] || null;
}

/**
 * Determine whether the current configured version of a document has been
 * accepted locally.
 *
 * @param {string} identifier
 * @returns {boolean}
 */
export function hasLocallyAcceptedCurrentVersion(
  identifier,
) {
  const document =
    resolveAcceptanceDocument(
      identifier,
    );

  const acceptance =
    getLocalAcceptance(
      document.id,
    );

  return Boolean(
    acceptance &&
      acceptance.status ===
        LEGAL_ACCEPTANCE_STATUS.ACCEPTED &&
      acceptance.documentVersion ===
        document.version,
  );
}

/* ============================================================================
 * SERVER API
 * ========================================================================== */

function getApiBaseUrl() {
  const env =
    typeof import.meta !== 'undefined' &&
    import.meta.env
      ? import.meta.env
      : {};

  const baseUrl =
    env.VITE_API_URL ||
    'http://localhost:5000/api';

  return baseUrl.replace(/\/+$/, '');
}

function buildAcceptanceApiUrl(
  path = '',
) {
  const baseUrl =
    getApiBaseUrl();

  const normalizedPath =
    path.startsWith('/')
      ? path
      : `/${path}`;

  return `${baseUrl}${ACCEPTANCE_API_BASE}${normalizedPath}`;
}

/**
 * Parse an API response.
 */
async function parseApiResponse(
  response,
) {
  const contentType =
    response.headers.get(
      'content-type',
    ) || '';

  if (
    contentType.includes(
      'application/json',
    )
  ) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const text =
    await response.text();

  if (!text) {
    return null;
  }

  return safeJsonParse(text, {
    message: text,
  });
}

/**
 * Persist an acceptance record to the backend.
 *
 * @param {object} record
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function submitLegalAcceptance(
  record,
  {
    signal,
    timeoutMs = 15_000,
  } = {},
) {
  const validation =
    validateAcceptanceRecord(record);

  if (!validation.valid) {
    throw new LegalAcceptanceError(
      'Invalid legal acceptance record.',
      {
        code:
          LEGAL_ACCEPTANCE_ERROR_CODES.INVALID_ACCEPTANCE,
        details:
          validation.errors,
      },
    );
  }

  const controller =
    new AbortController();

  let timedOut = false;

  const timeoutId =
    setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

  const abortHandler = () => {
    controller.abort();
  };

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);

      throw new LegalAcceptanceError(
        'Legal acceptance request was aborted.',
        {
          code:
            LEGAL_ACCEPTANCE_ERROR_CODES.REQUEST_ABORTED,
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
    const response =
      await fetch(
        buildAcceptanceApiUrl(),
        {
          method: 'POST',

          credentials: 'include',

          headers: {
            Accept:
              'application/json',

            'Content-Type':
              'application/json',

            'X-Client':
              'TITech-Community-Capital-Web',

            'X-Legal-API-Version':
              ACCEPTANCE_API_VERSION,

            'Idempotency-Key':
              record.idempotencyKey,
          },

          body: JSON.stringify({
            documentId:
              record.documentId,

            documentSlug:
              record.documentSlug,

            documentVersion:
              record.documentVersion,

            acceptanceType:
              record.acceptanceType,

            consentScope:
              record.consentScope,

            acceptedAt:
              record.acceptedAt,

            metadata:
              record.metadata,
          }),

          signal:
            controller.signal,
        },
      );

    const payload =
      await parseApiResponse(
        response,
      );

    if (!response.ok) {
      throw new LegalAcceptanceError(
        payload?.message ||
          payload?.error?.message ||
          'Unable to persist legal acceptance.',
        {
          code:
            LEGAL_ACCEPTANCE_ERROR_CODES.API_ERROR,

          status:
            response.status,

          details: payload,
        },
      );
    }

    return normalizeAcceptanceRecord(
      payload,
    );
  } catch (error) {
    if (
      error instanceof LegalAcceptanceError
    ) {
      throw error;
    }

    if (timedOut) {
      throw new LegalAcceptanceError(
        'Legal acceptance request timed out.',
        {
          code:
            LEGAL_ACCEPTANCE_ERROR_CODES.REQUEST_TIMEOUT,
          cause: error,
        },
      );
    }

    if (
      error?.name === 'AbortError'
    ) {
      throw new LegalAcceptanceError(
        'Legal acceptance request was aborted.',
        {
          code:
            LEGAL_ACCEPTANCE_ERROR_CODES.REQUEST_ABORTED,
          cause: error,
        },
      );
    }

    throw new LegalAcceptanceError(
      'Unable to connect to the TITech Community Capital legal acceptance service.',
      {
        code:
          LEGAL_ACCEPTANCE_ERROR_CODES.API_UNAVAILABLE,
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
 * HIGH-LEVEL ACCEPTANCE FLOW
 * ========================================================================== */

/**
 * Accept a legal document.
 *
 * Flow:
 *   1. Resolve configured document.
 *   2. Validate current document version.
 *   3. Create auditable client acceptance record.
 *   4. Persist to backend.
 *   5. Save confirmed record locally.
 *
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function acceptLegalDocument({
  identifier,
  acceptanceType =
    LEGAL_ACCEPTANCE_TYPES.INITIAL,
  consentScope =
    LEGAL_CONSENT_SCOPE.ALL_REQUIRED,
  userId = null,
  tenantId = null,
  metadata = {},
  signal,
  timeoutMs,
} = {}) {
  const document =
    resolveAcceptanceDocument(
      identifier,
    );

  if (
    document.status !==
    LEGAL_DOCUMENT_STATUS.ACTIVE
  ) {
    throw new LegalAcceptanceError(
      'This legal document is not currently active.',
      {
        code:
          LEGAL_ACCEPTANCE_ERROR_CODES.INVALID_DOCUMENT,
      },
    );
  }

  const record =
    createAcceptanceRecord({
      document,
      acceptanceType,
      consentScope,
      userId,
      tenantId,
      metadata,
    });

  const confirmedRecord =
    await submitLegalAcceptance(
      record,
      {
        signal,
        timeoutMs,
      },
    );

  saveLocalAcceptance(
    confirmedRecord,
  );

  return confirmedRecord;
}

/* ============================================================================
 * ACCEPT ALL REQUIRED DOCUMENTS
 * ========================================================================== */

/**
 * Accept all required current legal documents.
 *
 * Sequential submission is intentional:
 *   - Easier auditing.
 *   - Easier partial-failure recovery.
 *   - Avoids unnecessary concurrent legal writes.
 *
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function acceptAllRequiredLegalDocuments({
  userId = null,
  tenantId = null,
  metadata = {},
  signal,
  timeoutMs,
} = {}) {
  const results = [];
  const failures = [];

  for (
    const documentId of
    REQUIRED_LEGAL_DOCUMENTS
  ) {
    try {
      const result =
        await acceptLegalDocument({
          identifier:
            documentId,

          acceptanceType:
            LEGAL_ACCEPTANCE_TYPES.INITIAL,

          consentScope:
            LEGAL_CONSENT_SCOPE.ALL_REQUIRED,

          userId,
          tenantId,
          metadata,

          signal,
          timeoutMs,
        });

      results.push(result);
    } catch (error) {
      failures.push({
        documentId,
        error,
      });

      break;
    }
  }

  return Object.freeze({
    success:
      failures.length === 0,

    accepted:
      results,

    failures,

    partial:
      results.length > 0 &&
      failures.length > 0,
  });
}

/* ============================================================================
 * ACCEPTANCE HISTORY API
 * ========================================================================== */

/**
 * Fetch acceptance history from the backend.
 *
 * @param {object} options
 * @returns {Promise<Array>}
 */
export async function fetchLegalAcceptanceHistory({
  signal,
  timeoutMs = 15_000,
} = {}) {
  const controller =
    new AbortController();

  let timedOut = false;

  const timeoutId =
    setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

  const abortHandler = () => {
    controller.abort();
  };

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);

      throw new LegalAcceptanceError(
        'Acceptance history request was aborted.',
        {
          code:
            LEGAL_ACCEPTANCE_ERROR_CODES.REQUEST_ABORTED,
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
    const response =
      await fetch(
        buildAcceptanceApiUrl(
          '/history',
        ),
        {
          method: 'GET',

          credentials: 'include',

          headers: {
            Accept:
              'application/json',

            'X-Client':
              'TITech-Community-Capital-Web',

            'X-Legal-API-Version':
              ACCEPTANCE_API_VERSION,
          },

          signal:
            controller.signal,
        },
      );

    const payload =
      await parseApiResponse(
        response,
      );

    if (!response.ok) {
      throw new LegalAcceptanceError(
        payload?.message ||
          'Unable to retrieve legal acceptance history.',
        {
          code:
            LEGAL_ACCEPTANCE_ERROR_CODES.API_ERROR,

          status:
            response.status,

          details: payload,
        },
      );
    }

    const data =
      payload?.data ||
      payload?.result ||
      payload;

    if (!Array.isArray(data)) {
      throw new LegalAcceptanceError(
        'Legal acceptance history response is invalid.',
        {
          code:
            LEGAL_ACCEPTANCE_ERROR_CODES.INVALID_RESPONSE,
        },
      );
    }

    return data.map(
      normalizeAcceptanceRecord,
    );
  } catch (error) {
    if (
      error instanceof LegalAcceptanceError
    ) {
      throw error;
    }

    if (timedOut) {
      throw new LegalAcceptanceError(
        'Acceptance history request timed out.',
        {
          code:
            LEGAL_ACCEPTANCE_ERROR_CODES.REQUEST_TIMEOUT,
          cause: error,
        },
      );
    }

    if (
      error?.name === 'AbortError'
    ) {
      throw new LegalAcceptanceError(
        'Acceptance history request was aborted.',
        {
          code:
            LEGAL_ACCEPTANCE_ERROR_CODES.REQUEST_ABORTED,
          cause: error,
        },
      );
    }

    throw new LegalAcceptanceError(
      'Unable to retrieve TITech Community Capital legal acceptance history.',
      {
        code:
          LEGAL_ACCEPTANCE_ERROR_CODES.API_UNAVAILABLE,
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
 * ACCEPTANCE STATUS
 * ========================================================================== */

/**
 * Evaluate acceptance status against the current legal configuration.
 *
 * @param {Array} acceptanceRecords
 * @returns {object}
 */
export function getLegalAcceptanceStatus(
  acceptanceRecords = [],
) {
  const evaluation =
    evaluateRequiredAcceptances(
      acceptanceRecords,
      REQUIRED_LEGAL_DOCUMENTS,
    );

  return Object.freeze({
    ...evaluation,

    requiresAcceptance:
      !evaluation.accepted,

    currentLegalVersion:
      LEGAL_VERSION,

    organization:
      LEGAL_BRAND.legalName,
  });
}

/**
 * Evaluate locally stored acceptance state.
 *
 * @returns {object}
 */
export function getLocalLegalAcceptanceStatus() {
  return getLegalAcceptanceStatus(
    getLocalAcceptanceHistory(),
  );
}

/* ============================================================================
 * REVOKE / WITHDRAWAL
 * ========================================================================== */

/**
 * Mark local acceptance as revoked.
 *
 * IMPORTANT:
 * This does not revoke server-side consent.
 * A server-side withdrawal/revocation workflow should be implemented through
 * an authenticated backend endpoint when legally required.
 *
 * @param {string} identifier
 * @returns {boolean}
 */
export function markLocalAcceptanceRevoked(
  identifier,
) {
  const document =
    resolveAcceptanceDocument(
      identifier,
    );

  const records =
    getLocalAcceptanceHistory();

  let changed = false;

  const updated =
    records.map((record) => {
      if (
        record.documentId !==
        document.id
      ) {
        return record;
      }

      changed = true;

      return {
        ...record,

        status:
          LEGAL_ACCEPTANCE_STATUS.REVOKED,

        revokedAt:
          new Date().toISOString(),
      };
    });

  if (!changed) {
    return false;
  }

  return writeLocalAcceptanceState(
    updated,
  );
}

/* ============================================================================
 * PRIVACY-SAFE ACCEPTANCE HELPERS
 * ========================================================================== */

/**
 * Return a sanitized acceptance record suitable for analytics/event
 * instrumentation.
 *
 * Never send the complete acceptance record to analytics providers.
 */
export function toSafeAcceptanceAnalyticsPayload(
  record,
) {
  const validation =
    validateAcceptanceRecord(record);

  if (!validation.valid) {
    throw new LegalAcceptanceError(
      'Cannot generate analytics payload from an invalid acceptance record.',
      {
        code:
          LEGAL_ACCEPTANCE_ERROR_CODES.INVALID_ACCEPTANCE,
        details:
          validation.errors,
      },
    );
  }

  return Object.freeze({
    event: 'legal_document_accepted',

    documentId:
      record.documentId,

    documentVersion:
      record.documentVersion,

    acceptanceType:
      record.acceptanceType,

    consentScope:
      record.consentScope,

    source:
      record.source,
  });
}

/* ============================================================================
 * CONFIGURATION
 * ========================================================================== */

export function getLegalAcceptanceConfig() {
  return Object.freeze({
    storageKey:
      STORAGE_KEY,

    apiBase:
      buildAcceptanceApiUrl(),

    apiVersion:
      ACCEPTANCE_API_VERSION,

    localRecordTtlMs:
      LOCAL_RECORD_TTL_MS,

    maxHistoryEntries:
      MAX_HISTORY_ENTRIES,

    requiredDocuments:
      REQUIRED_LEGAL_DOCUMENTS,

    currentLegalVersion:
      LEGAL_VERSION,
  });
}

/* ============================================================================
 * DEFAULT EXPORT
 * ========================================================================== */

const legalAcceptance = Object.freeze({
  types:
    LEGAL_ACCEPTANCE_TYPES,

  status:
    LEGAL_ACCEPTANCE_STATUS,

  scopes:
    LEGAL_CONSENT_SCOPE,

  errors:
    LEGAL_ACCEPTANCE_ERROR_CODES,

  requiredDocuments:
    REQUIRED_LEGAL_DOCUMENTS,

  resolveDocument:
    resolveAcceptanceDocument,

  createRecord:
    createAcceptanceRecord,

  validateRecord:
    validateAcceptanceRecord,

  normalizeRecord:
    normalizeAcceptanceRecord,

  evaluate:
    evaluateRequiredAcceptances,

  requiresReacceptance,

  accept:
    acceptLegalDocument,

  acceptAllRequired:
    acceptAllRequiredLegalDocuments,

  submit:
    submitLegalAcceptance,

  fetchHistory:
    fetchLegalAcceptanceHistory,

  getStatus:
    getLegalAcceptanceStatus,

  getLocalStatus:
    getLocalLegalAcceptanceStatus,

  getLocalAcceptance,

  getLocalHistory:
    getLocalAcceptanceHistory,

  hasCurrentVersion:
    hasLocallyAcceptedCurrentVersion,

  saveLocal:
    saveLocalAcceptance,

  clearLocal:
    clearLocalAcceptanceHistory,

  revokeLocal:
    markLocalAcceptanceRevoked,

  analyticsPayload:
    toSafeAcceptanceAnalyticsPayload,

  config:
    getLegalAcceptanceConfig,
});

export default legalAcceptance;