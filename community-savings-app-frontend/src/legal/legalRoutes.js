/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Legal Route Registry
 * ============================================================================
 *
 * File:
 *   frontend/src/legal/legalRoutes.js
 *
 * Version:
 *   2.0.0
 *
 * Purpose:
 *   Centralized, validated and immutable route registry for all TITech
 *   Community Capital legal documents and legal-system pages.
 *
 * Responsibilities:
 *   - Define canonical legal routes.
 *   - Provide stable route identifiers.
 *   - Resolve documents to canonical URLs.
 *   - Generate section/hash URLs safely.
 *   - Support route aliases and legacy migration.
 *   - Prevent malformed legal URLs.
 *   - Provide navigation metadata.
 *   - Support breadcrumbs and SEO canonical URLs.
 *   - Support React Router integration without coupling this module to a
 *     specific router implementation.
 *
 * Design Principles:
 *   - Single source of truth for legal URLs.
 *   - Canonical URLs are preferred over aliases.
 *   - Route generation is deterministic.
 *   - Route definitions are immutable.
 *   - No business logic is embedded in route definitions.
 *   - No authentication state is stored here.
 *   - No secrets or credentials are stored here.
 *   - URL fragments are encoded safely.
 *   - Legacy routes can redirect to canonical routes.
 *
 * Branding:
 *   TITech Community Capital
 *
 * ============================================================================
 */

'use strict';

import {
  LEGAL_ROUTES,
  LEGAL_SYSTEM,
  LEGAL_URL,
  LEGAL_DOCUMENT_TYPES,
  LEGAL_DOCUMENT_STATUS,
  LEGAL_DOCUMENT_VISIBILITY,
} from './legalConstants';

import {
  getLegalDocument,
  getLegalDocumentById,
  getLegalDocumentBySlug,
} from './legalConfig';

/* ============================================================================
 * ROUTE IDENTIFIERS
 * ========================================================================== */

export const LEGAL_ROUTE_IDS = Object.freeze({
  INDEX:
    'legal.index',

  TERMS_OF_SERVICE:
    'legal.terms_of_service',

  PRIVACY_POLICY:
    'legal.privacy_policy',

  DISCLAIMER:
    'legal.disclaimer',

  COOKIE_POLICY:
    'legal.cookie_policy',

  ACCEPTABLE_USE_POLICY:
    'legal.acceptable_use_policy',

  DATA_PROCESSING_AGREEMENT:
    'legal.data_processing_agreement',

  COMMUNITY_GUIDELINES:
    'legal.community_guidelines',

  ELECTRONIC_COMMUNICATIONS:
    'legal.electronic_communications',

  FINANCIAL_SERVICES_DISCLOSURE:
    'legal.financial_services_disclosure',

  RISK_DISCLOSURE:
    'legal.risk_disclosure',

  LEGAL_ACCEPTANCE:
    'legal.acceptance',

  LEGAL_PREFERENCES:
    'legal.preferences',
});

/* ============================================================================
 * ROUTE PARAMETER NAMES
 * ========================================================================== */

export const LEGAL_ROUTE_PARAMS = Object.freeze({
  DOCUMENT:
    'document',

  SLUG:
    'slug',

  SECTION:
    'section',

  VERSION:
    'version',

  TAB:
    'tab',
});

/* ============================================================================
 * ROUTE PATH NORMALIZATION
 * ========================================================================== */

function normalizePath(path) {
  if (
    typeof path !== 'string' ||
    !path.trim()
  ) {
    return LEGAL_ROUTES.BASE;
  }

  let normalized = path.trim();

  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  normalized = normalized.replace(
    /\/{2,}/g,
    '/',
  );

  if (
    LEGAL_URL.TRAILING_SLASH === false &&
    normalized.length > 1
  ) {
    normalized = normalized.replace(
      /\/+$/,
      '',
    );
  }

  return normalized;
}

function normalizeSegment(segment) {
  if (
    segment === undefined ||
    segment === null
  ) {
    return '';
  }

  return encodeURIComponent(
    String(segment).trim(),
  );
}

function normalizeHash(sectionId) {
  if (
    sectionId === undefined ||
    sectionId === null ||
    !String(sectionId).trim()
  ) {
    return '';
  }

  const normalized =
    String(sectionId)
      .trim()
      .replace(/^#+/, '');

  if (!normalized) {
    return '';
  }

  const encoded =
    LEGAL_URL.ENCODE_SECTION_IDS
      ? encodeURIComponent(normalized)
      : normalized;

  return `${LEGAL_URL.HASH_PREFIX}${encoded}`;
}

/* ============================================================================
 * CANONICAL BASE ROUTE
 * ========================================================================== */

export const LEGAL_BASE_ROUTE =
  normalizePath(
    LEGAL_ROUTES.BASE,
  );

/* ============================================================================
 * STATIC ROUTE DEFINITIONS
 * ========================================================================== */

const ROUTE_DEFINITIONS = [
  {
    id:
      LEGAL_ROUTE_IDS.INDEX,

    path:
      LEGAL_BASE_ROUTE,

    title:
      'Legal',

    shortTitle:
      'Legal',

    description:
      'Legal information and policies for TITech Community Capital.',

    documentType:
      null,

    visibility:
      LEGAL_DOCUMENT_VISIBILITY.PUBLIC,

    requiresAcceptance:
      false,

    indexable:
      true,

    canonical:
      true,
  },

  {
    id:
      LEGAL_ROUTE_IDS.TERMS_OF_SERVICE,

    path:
      normalizePath(
        LEGAL_ROUTES.TERMS,
      ),

    title:
      'Terms of Service',

    shortTitle:
      'Terms',

    description:
      'Terms and conditions governing use of TITech Community Capital services.',

    documentType:
      LEGAL_DOCUMENT_TYPES.TERMS_OF_SERVICE,

    visibility:
      LEGAL_DOCUMENT_VISIBILITY.PUBLIC,

    requiresAcceptance:
      true,

    indexable:
      true,

    canonical:
      true,
  },

  {
    id:
      LEGAL_ROUTE_IDS.PRIVACY_POLICY,

    path:
      normalizePath(
        LEGAL_ROUTES.PRIVACY,
      ),

    title:
      'Privacy Policy',

    shortTitle:
      'Privacy',

    description:
      'How TITech Community Capital collects, uses, protects and manages personal data.',

    documentType:
      LEGAL_DOCUMENT_TYPES.PRIVACY_POLICY,

    visibility:
      LEGAL_DOCUMENT_VISIBILITY.PUBLIC,

    requiresAcceptance:
      true,

    indexable:
      true,

    canonical:
      true,
  },

  {
    id:
      LEGAL_ROUTE_IDS.DISCLAIMER,

    path:
      normalizePath(
        LEGAL_ROUTES.DISCLAIMER,
      ),

    title:
      'Disclaimer',

    shortTitle:
      'Disclaimer',

    description:
      'Important disclosures and limitations relating to TITech Community Capital services.',

    documentType:
      LEGAL_DOCUMENT_TYPES.DISCLAIMER,

    visibility:
      LEGAL_DOCUMENT_VISIBILITY.PUBLIC,

    requiresAcceptance:
      false,

    indexable:
      true,

    canonical:
      true,
  },

  {
    id:
      LEGAL_ROUTE_IDS.COOKIE_POLICY,

    path:
      normalizePath(
        LEGAL_ROUTES.COOKIE_POLICY,
      ),

    title:
      'Cookie Policy',

    shortTitle:
      'Cookies',

    description:
      'Information about cookies and similar technologies used by TITech Community Capital.',

    documentType:
      LEGAL_DOCUMENT_TYPES.COOKIE_POLICY,

    visibility:
      LEGAL_DOCUMENT_VISIBILITY.PUBLIC,

    requiresAcceptance:
      false,

    indexable:
      true,

    canonical:
      true,
  },

  {
    id:
      LEGAL_ROUTE_IDS.ACCEPTABLE_USE_POLICY,

    path:
      normalizePath(
        LEGAL_ROUTES.ACCEPTABLE_USE,
      ),

    title:
      'Acceptable Use Policy',

    shortTitle:
      'Acceptable Use',

    description:
      'Rules governing acceptable use of TITech Community Capital services.',

    documentType:
      LEGAL_DOCUMENT_TYPES.ACCEPTABLE_USE_POLICY,

    visibility:
      LEGAL_DOCUMENT_VISIBILITY.PUBLIC,

    requiresAcceptance:
      false,

    indexable:
      true,

    canonical:
      true,
  },

  {
    id:
      LEGAL_ROUTE_IDS.FINANCIAL_SERVICES_DISCLOSURE,

    path:
      normalizePath(
        LEGAL_ROUTES.FINANCIAL_DISCLOSURE,
      ),

    title:
      'Financial Services Disclosure',

    shortTitle:
      'Financial Disclosure',

    description:
      'Financial-service disclosures and important information relating to TITech Community Capital.',

    documentType:
      LEGAL_DOCUMENT_TYPES.FINANCIAL_SERVICES_DISCLOSURE,

    visibility:
      LEGAL_DOCUMENT_VISIBILITY.PUBLIC,

    requiresAcceptance:
      false,

    indexable:
      true,

    canonical:
      true,
  },

  {
    id:
      LEGAL_ROUTE_IDS.RISK_DISCLOSURE,

    path:
      normalizePath(
        LEGAL_ROUTES.RISK_DISCLOSURE,
      ),

    title:
      'Risk Disclosure',

    shortTitle:
      'Risk Disclosure',

    description:
      'Important risk information relating to TITech Community Capital services.',

    documentType:
      LEGAL_DOCUMENT_TYPES.RISK_DISCLOSURE,

    visibility:
      LEGAL_DOCUMENT_VISIBILITY.PUBLIC,

    requiresAcceptance:
      false,

    indexable:
      true,

    canonical:
      true,
  },
];

/* ============================================================================
 * ROUTE REGISTRY
 * ========================================================================== */

const ROUTE_REGISTRY =
  Object.freeze(
    ROUTE_DEFINITIONS.map(
      (route) =>
        Object.freeze({
          ...route,
          path:
            normalizePath(
              route.path,
            ),
        }),
    ),
  );

/* ============================================================================
 * ROUTE LOOKUP MAPS
 * ========================================================================== */

const ROUTES_BY_ID =
  new Map(
    ROUTE_REGISTRY.map(
      (route) => [
        route.id,
        route,
      ],
    ),
  );

const ROUTES_BY_PATH =
  new Map(
    ROUTE_REGISTRY.map(
      (route) => [
        route.path,
        route,
      ],
    ),
  );

/* ============================================================================
 * ROUTE ALIASES
 * ========================================================================== */

/**
 * Legacy aliases should redirect to canonical routes.
 *
 * These aliases are intentionally kept separate from canonical routes so
 * analytics, SEO and navigation always use the canonical URL.
 */
export const LEGAL_ROUTE_ALIASES =
  Object.freeze({
    '/legal/terms':
      LEGAL_ROUTES.TERMS,

    '/legal/privacy':
      LEGAL_ROUTES.PRIVACY,

    '/legal/privacy-policy':
      LEGAL_ROUTES.PRIVACY,

    '/legal/tos':
      LEGAL_ROUTES.TERMS,

    '/legal/disclosures':
      LEGAL_ROUTES.DISCLAIMER,

    '/legal/cookies':
      LEGAL_ROUTES.COOKIE_POLICY,
  });

/* ============================================================================
 * ROUTE VALIDATION
 * ========================================================================== */

/**
 * Validate an individual route definition.
 *
 * @param {object} route
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateLegalRoute(
  route,
) {
  const errors = [];

  if (
    !route ||
    typeof route !== 'object'
  ) {
    return {
      valid: false,
      errors: [
        'Legal route must be an object.',
      ],
    };
  }

  if (
    typeof route.id !== 'string' ||
    !route.id.trim()
  ) {
    errors.push(
      'Legal route ID is required.',
    );
  }

  if (
    typeof route.path !== 'string' ||
    !route.path.startsWith('/')
  ) {
    errors.push(
      'Legal route path must begin with "/".',
    );
  }

  if (
    typeof route.title !== 'string' ||
    !route.title.trim()
  ) {
    errors.push(
      'Legal route title is required.',
    );
  }

  if (
    route.documentType !== null &&
    route.documentType !== undefined &&
    typeof route.documentType !== 'string'
  ) {
    errors.push(
      'Legal route documentType must be a string or null.',
    );
  }

  if (
    typeof route.requiresAcceptance !==
      'boolean'
  ) {
    errors.push(
      'Legal route requiresAcceptance must be boolean.',
    );
  }

  if (
    typeof route.indexable !== 'boolean'
  ) {
    errors.push(
      'Legal route indexable must be boolean.',
    );
  }

  if (
    typeof route.canonical !== 'boolean'
  ) {
    errors.push(
      'Legal route canonical must be boolean.',
    );
  }

  return {
    valid:
      errors.length === 0,

    errors,
  };
}

/**
 * Validate the complete route registry.
 *
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateLegalRouteRegistry() {
  const errors = [];

  const ids =
    new Set();

  const paths =
    new Set();

  ROUTE_REGISTRY.forEach(
    (route) => {
      const validation =
        validateLegalRoute(route);

      if (!validation.valid) {
        errors.push(
          ...validation.errors.map(
            (error) =>
              `${route.id || 'unknown'}: ${error}`,
          ),
        );
      }

      if (ids.has(route.id)) {
        errors.push(
          `Duplicate legal route ID: ${route.id}`,
        );
      }

      if (paths.has(route.path)) {
        errors.push(
          `Duplicate legal route path: ${route.path}`,
        );
      }

      ids.add(route.id);
      paths.add(route.path);
    },
  );

  return {
    valid:
      errors.length === 0,

    errors,
  };
}

/* ============================================================================
 * ROUTE LOOKUPS
 * ========================================================================== */

/**
 * Get a route by route ID.
 *
 * @param {string} routeId
 * @returns {object|null}
 */
export function getLegalRoute(
  routeId,
) {
  if (
    typeof routeId !== 'string'
  ) {
    return null;
  }

  return (
    ROUTES_BY_ID.get(
      routeId.trim(),
    ) || null
  );
}

/**
 * Get a route by canonical path.
 *
 * @param {string} path
 * @returns {object|null}
 */
export function getLegalRouteByPath(
  path,
) {
  const normalized =
    normalizePath(path);

  return (
    ROUTES_BY_PATH.get(
      normalized,
    ) || null
  );
}

/**
 * Resolve an alias to its canonical route.
 *
 * @param {string} path
 * @returns {object}
 */
export function resolveLegalRoute(
  path,
) {
  const normalized =
    normalizePath(path);

  const canonicalPath =
    LEGAL_ROUTE_ALIASES[
      normalized
    ] || normalized;

  const route =
    getLegalRouteByPath(
      canonicalPath,
    );

  if (route) {
    return Object.freeze({
      ...route,

      requestedPath:
        normalized,

      canonicalPath:
        route.path,

      isAlias:
        normalized !==
        route.path,
    });
  }

  return null;
}

/* ============================================================================
 * DOCUMENT ROUTE RESOLUTION
 * ========================================================================== */

/**
 * Find a legal route associated with a document.
 *
 * @param {object|string} documentOrIdentifier
 * @returns {object|null}
 */
export function getRouteForLegalDocument(
  documentOrIdentifier,
) {
  let document =
    documentOrIdentifier;

  if (
    typeof documentOrIdentifier ===
    'string'
  ) {
    document =
      getLegalDocument(
        documentOrIdentifier,
      );

    if (!document) {
      document =
        getLegalDocumentById(
          documentOrIdentifier,
        );
    }

    if (!document) {
      document =
        getLegalDocumentBySlug(
          documentOrIdentifier,
        );
    }
  }

  if (
    !document ||
    typeof document !== 'object'
  ) {
    return null;
  }

  const matchingRoute =
    ROUTE_REGISTRY.find(
      (route) =>
        route.documentType ===
          document.type ||
        route.documentType ===
          document.documentType ||
        route.id ===
          document.routeId,
    );

  return matchingRoute || null;
}

/* ============================================================================
 * ROUTE GENERATORS
 * ========================================================================== */

/**
 * Generate a canonical route.
 *
 * @param {string} routeId
 * @returns {string}
 */
export function buildLegalRoute(
  routeId,
) {
  const route =
    getLegalRoute(routeId);

  if (!route) {
    return LEGAL_BASE_ROUTE;
  }

  return route.path;
}

/**
 * Build a legal document route with optional section.
 *
 * @param {string} routeId
 * @param {string|null} sectionId
 * @returns {string}
 */
export function buildLegalDocumentRoute(
  routeId,
  sectionId = null,
) {
  const route =
    getLegalRoute(routeId);

  if (!route) {
    return LEGAL_BASE_ROUTE;
  }

  return `${route.path}${normalizeHash(
    sectionId,
  )}`;
}

/**
 * Build a route directly from a document identifier.
 *
 * @param {string} identifier
 * @param {string|null} sectionId
 * @returns {string}
 */
export function buildLegalDocumentUrl(
  identifier,
  sectionId = null,
) {
  const route =
    getRouteForLegalDocument(
      identifier,
    );

  if (!route) {
    return LEGAL_BASE_ROUTE;
  }

  return `${route.path}${normalizeHash(
    sectionId,
  )}`;
}

/* ============================================================================
 * SECTION URL HELPERS
 * ========================================================================== */

/**
 * Add a section fragment to an existing legal URL.
 *
 * @param {string} path
 * @param {string} sectionId
 * @returns {string}
 */
export function buildLegalSectionUrl(
  path,
  sectionId,
) {
  const normalized =
    normalizePath(path);

  return `${normalized}${normalizeHash(
    sectionId,
  )}`;
}

/**
 * Extract a section identifier from a URL.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function getLegalSectionFromUrl(
  url,
) {
  if (
    typeof url !== 'string'
  ) {
    return null;
  }

  const hashIndex =
    url.indexOf('#');

  if (hashIndex === -1) {
    return null;
  }

  const hash =
    url.slice(
      hashIndex + 1,
    );

  if (!hash) {
    return null;
  }

  try {
    return decodeURIComponent(
      hash,
    );
  } catch {
    return hash;
  }
}

/* ============================================================================
 * QUERY PARAMETER HELPERS
 * ========================================================================== */

/**
 * Build a legal route with query parameters.
 *
 * @param {string} path
 * @param {object} params
 * @returns {string}
 */
export function buildLegalRouteWithParams(
  path,
  params = {},
) {
  const normalized =
    normalizePath(path);

  if (
    !params ||
    typeof params !== 'object'
  ) {
    return normalized;
  }

  const query =
    new URLSearchParams();

  Object.entries(params).forEach(
    ([key, value]) => {
      if (
        value === undefined ||
        value === null ||
        value === ''
      ) {
        return;
      }

      query.set(
        key,
        String(value),
      );
    },
  );

  const queryString =
    query.toString();

  return queryString
    ? `${normalized}?${queryString}`
    : normalized;
}

/* ============================================================================
 * CANONICAL URL
 * ========================================================================== */

/**
 * Build an absolute canonical URL when an origin is provided.
 *
 * @param {string} path
 * @param {string|null} origin
 * @returns {string}
 */
export function buildLegalCanonicalUrl(
  path,
  origin = null,
) {
  const normalized =
    normalizePath(path);

  const safeOrigin =
    typeof origin === 'string' &&
    origin.trim()
      ? origin
          .trim()
          .replace(/\/+$/, '')
      : null;

  if (!safeOrigin) {
    return normalized;
  }

  return `${safeOrigin}${normalized}`;
}

/* ============================================================================
 * NAVIGATION
 * ========================================================================== */

/**
 * Return routes suitable for public legal navigation.
 *
 * @returns {Array}
 */
export function getPublicLegalRoutes() {
  return ROUTE_REGISTRY
    .filter(
      (route) =>
        route.visibility ===
        LEGAL_DOCUMENT_VISIBILITY.PUBLIC,
    )
    .map(
      (route) =>
        Object.freeze({
          ...route,
        }),
    );
}

/**
 * Return routes requiring acceptance.
 *
 * @returns {Array}
 */
export function getAcceptanceRequiredRoutes() {
  return ROUTE_REGISTRY.filter(
    (route) =>
      route.requiresAcceptance === true,
  );
}

/**
 * Return indexable canonical routes.
 *
 * @returns {Array}
 */
export function getIndexableLegalRoutes() {
  return ROUTE_REGISTRY.filter(
    (route) =>
      route.indexable === true &&
      route.canonical === true,
  );
}

/* ============================================================================
 * BREADCRUMBS
 * ========================================================================== */

/**
 * Build breadcrumb metadata for a legal route.
 *
 * @param {string} routeId
 * @returns {Array}
 */
export function getLegalBreadcrumbs(
  routeId,
) {
  const route =
    getLegalRoute(routeId);

  if (!route) {
    return [];
  }

  const breadcrumbs = [
    {
      id:
        LEGAL_ROUTE_IDS.INDEX,

      label:
        'Legal',

      path:
        LEGAL_BASE_ROUTE,

      current:
        route.id ===
        LEGAL_ROUTE_IDS.INDEX,
    },
  ];

  if (
    route.id !==
    LEGAL_ROUTE_IDS.INDEX
  ) {
    breadcrumbs.push({
      id:
        route.id,

      label:
        route.title,

      path:
        route.path,

      current:
        true,
    });
  }

  return Object.freeze(
    breadcrumbs.map(
      (breadcrumb) =>
        Object.freeze(
          breadcrumb,
        ),
    ),
  );
}

/* ============================================================================
 * REDIRECT HANDLING
 * ========================================================================== */

/**
 * Determine whether a route is a legacy alias.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isLegacyLegalRoute(
  path,
) {
  const normalized =
    normalizePath(path);

  return Object.prototype.hasOwnProperty.call(
    LEGAL_ROUTE_ALIASES,
    normalized,
  );
}

/**
 * Get the canonical target for a legacy route.
 *
 * @param {string} path
 * @returns {string|null}
 */
export function getLegalRedirectTarget(
  path,
) {
  const normalized =
    normalizePath(path);

  return (
    LEGAL_ROUTE_ALIASES[
      normalized
    ] || null
  );
}

/* ============================================================================
 * ROUTE MATCHING
 * ========================================================================== */

/**
 * Match a browser pathname against the legal route registry.
 *
 * @param {string} pathname
 * @returns {object|null}
 */
export function matchLegalRoute(
  pathname,
) {
  if (
    typeof pathname !== 'string'
  ) {
    return null;
  }

  const normalized =
    normalizePath(pathname);

  const exact =
    resolveLegalRoute(
      normalized,
    );

  if (exact) {
    return exact;
  }

  /*
   * Handle section URLs where the section is represented by a hash.
   * Hashes normally do not appear in pathname, but this helper remains
   * intentionally tolerant of callers passing a complete URL fragment.
   */
  const basePath =
    normalized.split('#')[0];

  return resolveLegalRoute(
    basePath,
  );
}

/* ============================================================================
 * DOCUMENT STATUS HELPERS
 * ========================================================================== */

/**
 * Determine whether a document is routable.
 *
 * @param {object} document
 * @returns {boolean}
 */
export function isLegalDocumentRoutable(
  document,
) {
  if (
    !document ||
    typeof document !== 'object'
  ) {
    return false;
  }

  if (
    document.status ===
      LEGAL_DOCUMENT_STATUS.ARCHIVED ||
    document.status ===
      LEGAL_DOCUMENT_STATUS.REJECTED ||
    document.status ===
      LEGAL_DOCUMENT_STATUS.DEPRECATED
  ) {
    return false;
  }

  return Boolean(
    getRouteForLegalDocument(
      document,
    ),
  );
}

/* ============================================================================
 * ROUTE REGISTRY ACCESS
 * ========================================================================== */

/**
 * Return an immutable copy of the route registry.
 *
 * @returns {Array}
 */
export function getLegalRouteRegistry() {
  return Object.freeze([
    ...ROUTE_REGISTRY,
  ]);
}

/**
 * Return all route definitions.
 *
 * @returns {Array}
 */
export function getAllLegalRoutes() {
  return getLegalRouteRegistry();
}

/* ============================================================================
 * ROUTER-FRIENDLY CONFIGURATION
 * ========================================================================== */

/**
 * Return React Router-compatible route metadata.
 *
 * This module deliberately does not import React Router. Components can map
 * the resulting definitions to <Route> declarations or use them with
 * createBrowserRouter.
 *
 * @returns {Array}
 */
export function getLegalRouterConfig() {
  return ROUTE_REGISTRY.map(
    (route) =>
      Object.freeze({
        id:
          route.id,

        path:
          route.path,

        handle:
          Object.freeze({
            legal:
              true,

            title:
              route.title,

            shortTitle:
              route.shortTitle,

            description:
              route.description,

            documentType:
              route.documentType,

            requiresAcceptance:
              route.requiresAcceptance,

            indexable:
              route.indexable,

            canonical:
              route.canonical,
          }),
      }),
  );
}

/* ============================================================================
 * SEO METADATA
 * ========================================================================== */

/**
 * Build basic SEO metadata for a legal route.
 *
 * @param {string} routeId
 * @returns {object}
 */
export function getLegalRouteSeo(
  routeId,
) {
  const route =
    getLegalRoute(routeId);

  if (!route) {
    return null;
  }

  return Object.freeze({
    title:
      `${route.title} | ${LEGAL_SYSTEM.BRAND}`,

    description:
      route.description,

    robots:
      route.indexable
        ? 'index,follow'
        : 'noindex,nofollow',

    canonical:
      route.path,

    locale:
      LEGAL_SYSTEM.DEFAULT_LOCALE,

    siteName:
      LEGAL_SYSTEM.BRAND,
  });
}

/* ============================================================================
 * STARTUP VALIDATION
 * ========================================================================== */

const ROUTE_REGISTRY_VALIDATION =
  validateLegalRouteRegistry();

/**
 * The application may call this during startup/tests to detect accidental
 * route duplication or malformed route definitions.
 *
 * @returns {object}
 */
export function getLegalRouteRegistryValidation() {
  return Object.freeze({
    valid:
      ROUTE_REGISTRY_VALIDATION.valid,

    errors:
      Object.freeze([
        ...ROUTE_REGISTRY_VALIDATION.errors,
      ]),
  });
}

/* ============================================================================
 * DEFAULT EXPORT
 * ========================================================================== */

const legalRoutes = Object.freeze({
  ids:
    LEGAL_ROUTE_IDS,

  params:
    LEGAL_ROUTE_PARAMS,

  base:
    LEGAL_BASE_ROUTE,

  aliases:
    LEGAL_ROUTE_ALIASES,

  registry:
    getLegalRouteRegistry(),

  get:
    getLegalRoute,

  getByPath:
    getLegalRouteByPath,

  resolve:
    resolveLegalRoute,

  getForDocument:
    getRouteForLegalDocument,

  build:
    buildLegalRoute,

  buildDocument:
    buildLegalDocumentRoute,

  buildDocumentUrl:
    buildLegalDocumentUrl,

  buildSection:
    buildLegalSectionUrl,

  buildWithParams:
    buildLegalRouteWithParams,

  canonical:
    buildLegalCanonicalUrl,

  match:
    matchLegalRoute,

  sectionFromUrl:
    getLegalSectionFromUrl,

  public:
    getPublicLegalRoutes,

  acceptanceRequired:
    getAcceptanceRequiredRoutes,

  indexable:
    getIndexableLegalRoutes,

  breadcrumbs:
    getLegalBreadcrumbs,

  routerConfig:
    getLegalRouterConfig,

  seo:
    getLegalRouteSeo,

  isLegacy:
    isLegacyLegalRoute,

  redirectTarget:
    getLegalRedirectTarget,

  isRoutable:
    isLegalDocumentRoutable,

  validate:
    validateLegalRoute,

  validateRegistry:
    getLegalRouteRegistryValidation,
});

export default legalRoutes;