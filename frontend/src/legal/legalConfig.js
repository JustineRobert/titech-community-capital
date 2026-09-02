/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Legal Document Configuration
 * ============================================================================
 *
 * File:
 *   frontend/src/legal/legalConfig.js
 *
 * Version:
 *   2.0.0
 *
 * Purpose:
 *   Centralized, production-grade configuration for the TITech Community
 *   Capital legal-document system.
 *
 * Responsibilities:
 *   - Define supported legal documents.
 *   - Provide canonical document IDs and slugs.
 *   - Define legal-document metadata.
 *   - Provide navigation and section configuration.
 *   - Centralize organization/contact information.
 *   - Centralize legal versioning and effective dates.
 *   - Provide SEO/accessibility metadata.
 *   - Provide document-status configuration.
 *   - Prevent configuration mutation.
 *
 * Design Principles:
 *   - Single source of truth.
 *   - Immutable configuration.
 *   - Explicit contracts.
 *   - Stable IDs/slugs.
 *   - Backward-compatible document routing.
 *   - Frontend-safe configuration.
 *   - No secrets or credentials.
 *   - Enterprise-ready extensibility.
 *
 * IMPORTANT:
 *   Never place API keys, JWT secrets, database credentials, private keys,
 *   passwords, or other sensitive credentials in this file.
 *
 * Branding:
 *   TITech Community Capital
 *
 * ============================================================================
 */

'use strict';

/* ============================================================================
 * BRAND CONFIGURATION
 * ========================================================================== */

export const LEGAL_BRAND = Object.freeze({
  name: 'TITech Community Capital',
  legalName: 'TITech Community Capital Ltd',
  shortName: 'TITech',
  platformName: 'TITech Community Capital',
  tagline: 'Community Finance Operating System',
  country: 'Uganda',
  jurisdiction: 'Uganda',
  city: 'Kampala',
  address: 'Kampala, Uganda',
  website: 'https://titechcommunity.app',
});

/* ============================================================================
 * LEGAL VERSIONING
 * ========================================================================== */

export const LEGAL_VERSION = '1.0';

export const LEGAL_LAST_UPDATED = 'January 15, 2026';

export const LEGAL_EFFECTIVE_DATE = 'January 15, 2026';

/**
 * Machine-readable dates.
 *
 * Keep these in ISO-8601 format for application logic, auditing and future
 * automated document-version management.
 */
export const LEGAL_DATES = Object.freeze({
  lastUpdated: '2026-01-15',
  effectiveDate: '2026-01-15',
});

/* ============================================================================
 * CONTACT CONFIGURATION
 * ========================================================================== */

export const LEGAL_CONTACTS = Object.freeze({
  legal: Object.freeze({
    email: 'legal@titechcommunity.app',
    phoneDisplay: '+256 782 397907',
    phoneHref: '+256782397907',
  }),

  privacy: Object.freeze({
    email: 'privacy@communitysavings.app',
    phoneDisplay: '+256 (394) 324760',
    phoneHref: '+256394324760',
  }),

  dataProtection: Object.freeze({
    email: 'dpo@communitysavings.app',
    phoneDisplay: '+256 (394) 324760',
    phoneHref: '+256394324760',
  }),

  general: Object.freeze({
    email: 'legal@titechcommunity.app',
    phoneDisplay: '+256 782 397907',
    phoneHref: '+256782397907',
  }),
});

/**
 * Canonical organization address.
 */
export const LEGAL_ADDRESS = Object.freeze({
  organization: 'TITech Community Capital Ltd',
  street: 'Plot 69-71 Jinja Road',
  city: 'Kampala',
  country: 'Uganda',
  full: 'TITech Community Capital Ltd, Plot 69-71 Jinja Road, Kampala, Uganda',
});

/* ============================================================================
 * LEGAL DOCUMENT TYPES
 * ========================================================================== */

export const LEGAL_DOCUMENT_TYPES = Object.freeze({
  TERMS_OF_SERVICE: 'terms-of-service',
  PRIVACY_POLICY: 'privacy-policy',
  DISCLAIMER: 'disclaimer',
});

/* ============================================================================
 * CANONICAL DOCUMENT IDS
 * ========================================================================== */

export const LEGAL_DOCUMENT_IDS = Object.freeze({
  TERMS_OF_SERVICE: 'terms-of-service',
  PRIVACY_POLICY: 'privacy-policy',
  DISCLAIMER: 'disclaimer',
});

/* ============================================================================
 * CANONICAL DOCUMENT SLUGS
 * ========================================================================== */

export const LEGAL_DOCUMENT_SLUGS = Object.freeze({
  TERMS_OF_SERVICE: 'terms-of-service',
  PRIVACY_POLICY: 'privacy-policy',
  DISCLAIMER: 'disclaimer',
});

/* ============================================================================
 * DOCUMENT STATUS
 * ========================================================================== */

export const LEGAL_DOCUMENT_STATUS = Object.freeze({
  ACTIVE: 'active',
  DRAFT: 'draft',
  ARCHIVED: 'archived',
  DEPRECATED: 'deprecated',
});

/* ============================================================================
 * DOCUMENT VISIBILITY
 * ========================================================================== */

export const LEGAL_DOCUMENT_VISIBILITY = Object.freeze({
  PUBLIC: 'public',
  AUTHENTICATED: 'authenticated',
  INTERNAL: 'internal',
});

/* ============================================================================
 * SECTION IDENTIFIERS
 * ========================================================================== */

/**
 * Stable section IDs are intentionally explicit.
 *
 * Do not casually rename existing section IDs because they may be referenced
 * by:
 *   - URL fragments
 *   - internal navigation
 *   - bookmarks
 *   - analytics
 *   - accessibility controls
 *   - external legal references
 */
export const LEGAL_SECTION_IDS = Object.freeze({
  TERMS_OF_SERVICE: Object.freeze([
    'tos-1',
    'tos-2',
    'tos-3',
    'tos-4',
    'tos-5',
    'tos-6',
  ]),

  PRIVACY_POLICY: Object.freeze([
    'pp-1',
    'pp-2',
    'pp-3',
    'pp-4',
    'pp-5',
    'pp-6',
  ]),

  DISCLAIMER: Object.freeze([
    'disclaimer-1',
    'disclaimer-2',
    'disclaimer-3',
    'disclaimer-4',
    'disclaimer-5',
  ]),
});

/* ============================================================================
 * DOCUMENT SECTION NAVIGATION
 * ========================================================================== */

export const LEGAL_SECTION_NAVIGATION = Object.freeze({
  'terms-of-service': Object.freeze([
    Object.freeze({
      id: 'tos-1',
      label: 'Introduction',
      shortLabel: 'Introduction',
    }),

    Object.freeze({
      id: 'tos-2',
      label: 'Eligibility and Account Responsibilities',
      shortLabel: 'Eligibility',
    }),

    Object.freeze({
      id: 'tos-3',
      label: 'Use of the Platform',
      shortLabel: 'Platform Use',
    }),

    Object.freeze({
      id: 'tos-4',
      label: 'Financial Services and Transactions',
      shortLabel: 'Financial Services',
    }),

    Object.freeze({
      id: 'tos-5',
      label: 'Liability, Suspension and Termination',
      shortLabel: 'Liability',
    }),

    Object.freeze({
      id: 'tos-6',
      label: 'General Terms',
      shortLabel: 'General',
    }),
  ]),

  'privacy-policy': Object.freeze([
    Object.freeze({
      id: 'pp-1',
      label: 'Introduction',
      shortLabel: 'Introduction',
    }),

    Object.freeze({
      id: 'pp-2',
      label: 'Information We Collect',
      shortLabel: 'Information',
    }),

    Object.freeze({
      id: 'pp-3',
      label: 'How We Use Your Data',
      shortLabel: 'Data Use',
    }),

    Object.freeze({
      id: 'pp-4',
      label: 'Data Security and Sharing',
      shortLabel: 'Security & Sharing',
    }),

    Object.freeze({
      id: 'pp-5',
      label: 'Your Rights and Data Retention',
      shortLabel: 'Your Rights',
    }),

    Object.freeze({
      id: 'pp-6',
      label: 'Cookies, Children and Policy Changes',
      shortLabel: 'Additional Information',
    }),
  ]),

  disclaimer: Object.freeze([
    Object.freeze({
      id: 'disclaimer-1',
      label: 'General Disclaimer',
      shortLabel: 'General',
    }),

    Object.freeze({
      id: 'disclaimer-2',
      label: 'Financial Information',
      shortLabel: 'Financial',
    }),

    Object.freeze({
      id: 'disclaimer-3',
      label: 'Third-Party Services',
      shortLabel: 'Third Parties',
    }),

    Object.freeze({
      id: 'disclaimer-4',
      label: 'No Professional Advice',
      shortLabel: 'Professional Advice',
    }),

    Object.freeze({
      id: 'disclaimer-5',
      label: 'Limitation of Responsibility',
      shortLabel: 'Responsibility',
    }),
  ]),
});

/* ============================================================================
 * DOCUMENT DEFINITIONS
 * ========================================================================== */

/**
 * Canonical legal-document registry.
 *
 * This is the primary configuration consumed by legal routes, legal pages,
 * navigation components, SEO components and document metadata.
 */
export const LEGAL_DOCUMENTS = Object.freeze([
  Object.freeze({
    id: LEGAL_DOCUMENT_IDS.TERMS_OF_SERVICE,
    type: LEGAL_DOCUMENT_TYPES.TERMS_OF_SERVICE,
    slug: LEGAL_DOCUMENT_SLUGS.TERMS_OF_SERVICE,

    title: 'Terms of Service',
    shortTitle: 'Terms',
    description:
      'The terms and conditions governing access to and use of TITech Community Capital services.',

    status: LEGAL_DOCUMENT_STATUS.ACTIVE,
    visibility: LEGAL_DOCUMENT_VISIBILITY.PUBLIC,

    version: LEGAL_VERSION,
    lastUpdated: LEGAL_LAST_UPDATED,
    effectiveDate: LEGAL_EFFECTIVE_DATE,

    route: '/legal/terms-of-service',
    canonicalPath: '/legal/terms-of-service',

    sectionIds: LEGAL_SECTION_IDS.TERMS_OF_SERVICE,
    navigation: LEGAL_SECTION_NAVIGATION['terms-of-service'],

    contact: Object.freeze({
      email: LEGAL_CONTACTS.legal.email,
      phone: LEGAL_CONTACTS.legal.phoneDisplay,
    }),

    seo: Object.freeze({
      title: 'Terms of Service | TITech Community Capital',
      description:
        'Read the Terms of Service governing use of TITech Community Capital and its community finance services.',
      robots: 'index,follow',
    }),

    accessibility: Object.freeze({
      ariaLabel: 'TITech Community Capital Terms of Service',
      navigationLabel: 'Terms of Service sections',
    }),
  }),

  Object.freeze({
    id: LEGAL_DOCUMENT_IDS.PRIVACY_POLICY,
    type: LEGAL_DOCUMENT_TYPES.PRIVACY_POLICY,
    slug: LEGAL_DOCUMENT_SLUGS.PRIVACY_POLICY,

    title: 'Privacy Policy',
    shortTitle: 'Privacy',
    description:
      'How TITech Community Capital collects, uses, protects, shares and retains personal information.',

    status: LEGAL_DOCUMENT_STATUS.ACTIVE,
    visibility: LEGAL_DOCUMENT_VISIBILITY.PUBLIC,

    version: LEGAL_VERSION,
    lastUpdated: LEGAL_LAST_UPDATED,
    effectiveDate: LEGAL_EFFECTIVE_DATE,

    route: '/legal/privacy-policy',
    canonicalPath: '/legal/privacy-policy',

    sectionIds: LEGAL_SECTION_IDS.PRIVACY_POLICY,
    navigation: LEGAL_SECTION_NAVIGATION['privacy-policy'],

    contact: Object.freeze({
      email: LEGAL_CONTACTS.privacy.email,
      dataProtectionEmail: LEGAL_CONTACTS.dataProtection.email,
      phone: LEGAL_CONTACTS.privacy.phoneDisplay,
    }),

    seo: Object.freeze({
      title: 'Privacy Policy | TITech Community Capital',
      description:
        'Learn how TITech Community Capital collects, uses, protects and manages personal information.',
      robots: 'index,follow',
    }),

    accessibility: Object.freeze({
      ariaLabel: 'TITech Community Capital Privacy Policy',
      navigationLabel: 'Privacy Policy sections',
    }),
  }),

  Object.freeze({
    id: LEGAL_DOCUMENT_IDS.DISCLAIMER,
    type: LEGAL_DOCUMENT_TYPES.DISCLAIMER,
    slug: LEGAL_DOCUMENT_SLUGS.DISCLAIMER,

    title: 'Disclaimer',
    shortTitle: 'Disclaimer',
    description:
      'Important information concerning the use of TITech Community Capital services, financial information and third-party services.',

    status: LEGAL_DOCUMENT_STATUS.ACTIVE,
    visibility: LEGAL_DOCUMENT_VISIBILITY.PUBLIC,

    version: LEGAL_VERSION,
    lastUpdated: LEGAL_LAST_UPDATED,
    effectiveDate: LEGAL_EFFECTIVE_DATE,

    route: '/legal/disclaimer',
    canonicalPath: '/legal/disclaimer',

    sectionIds: LEGAL_SECTION_IDS.DISCLAIMER,
    navigation: LEGAL_SECTION_NAVIGATION.disclaimer,

    contact: Object.freeze({
      email: LEGAL_CONTACTS.legal.email,
      phone: LEGAL_CONTACTS.legal.phoneDisplay,
    }),

    seo: Object.freeze({
      title: 'Disclaimer | TITech Community Capital',
      description:
        'Read important disclaimers concerning TITech Community Capital services and information.',
      robots: 'index,follow',
    }),

    accessibility: Object.freeze({
      ariaLabel: 'TITech Community Capital Disclaimer',
      navigationLabel: 'Disclaimer sections',
    }),
  }),
]);

/* ============================================================================
 * DOCUMENT LOOKUP MAPS
 * ========================================================================== */

/**
 * O(1) lookup maps.
 *
 * These are frozen so consuming components cannot mutate the registry.
 */
export const LEGAL_DOCUMENT_BY_ID = Object.freeze(
  LEGAL_DOCUMENTS.reduce((accumulator, document) => {
    accumulator[document.id] = document;
    return accumulator;
  }, {}),
);

export const LEGAL_DOCUMENT_BY_SLUG = Object.freeze(
  LEGAL_DOCUMENTS.reduce((accumulator, document) => {
    accumulator[document.slug] = document;
    return accumulator;
  }, {}),
);

/* ============================================================================
 * PUBLIC LEGAL NAVIGATION
 * ========================================================================== */

export const LEGAL_NAVIGATION = Object.freeze([
  Object.freeze({
    id: LEGAL_DOCUMENT_IDS.TERMS_OF_SERVICE,
    label: 'Terms of Service',
    shortLabel: 'Terms',
    slug: LEGAL_DOCUMENT_SLUGS.TERMS_OF_SERVICE,
    route: '/legal/terms-of-service',
  }),

  Object.freeze({
    id: LEGAL_DOCUMENT_IDS.PRIVACY_POLICY,
    label: 'Privacy Policy',
    shortLabel: 'Privacy',
    slug: LEGAL_DOCUMENT_SLUGS.PRIVACY_POLICY,
    route: '/legal/privacy-policy',
  }),

  Object.freeze({
    id: LEGAL_DOCUMENT_IDS.DISCLAIMER,
    label: 'Disclaimer',
    shortLabel: 'Disclaimer',
    slug: LEGAL_DOCUMENT_SLUGS.DISCLAIMER,
    route: '/legal/disclaimer',
  }),
]);

/* ============================================================================
 * LEGAL ROUTES
 * ========================================================================== */

export const LEGAL_ROUTES = Object.freeze({
  base: '/legal',

  terms: '/legal/terms-of-service',

  privacy: '/legal/privacy-policy',

  disclaimer: '/legal/disclaimer',
});

/* ============================================================================
 * FOOTER CONFIGURATION
 * ========================================================================== */

export const LEGAL_FOOTER_LINKS = Object.freeze([
  Object.freeze({
    id: 'footer-terms',
    label: 'Terms of Service',
    href: LEGAL_ROUTES.terms,
    documentId: LEGAL_DOCUMENT_IDS.TERMS_OF_SERVICE,
  }),

  Object.freeze({
    id: 'footer-privacy',
    label: 'Privacy Policy',
    href: LEGAL_ROUTES.privacy,
    documentId: LEGAL_DOCUMENT_IDS.PRIVACY_POLICY,
  }),

  Object.freeze({
    id: 'footer-disclaimer',
    label: 'Disclaimer',
    href: LEGAL_ROUTES.disclaimer,
    documentId: LEGAL_DOCUMENT_IDS.DISCLAIMER,
  }),
]);

/* ============================================================================
 * LEGAL PAGE UI CONFIGURATION
 * ========================================================================== */

export const LEGAL_PAGE_CONFIG = Object.freeze({
  showLastUpdated: true,
  showVersion: true,
  showEffectiveDate: true,

  showTableOfContents: true,
  stickyTableOfContents: true,

  enableSectionAnchors: true,
  enableBackToTop: true,

  enablePrint: true,
  enableCopyLink: true,

  showContactInformation: true,

  showLegalNavigation: true,
  showFooterNavigation: true,

  preserveScrollPosition: true,

  externalLinksNewTab: true,

  defaultScrollOffset: 96,

  printTitle: LEGAL_BRAND.name,
});

/* ============================================================================
 * SEO DEFAULTS
 * ========================================================================== */

export const LEGAL_SEO_DEFAULTS = Object.freeze({
  siteName: LEGAL_BRAND.name,

  titleSuffix: ` | ${LEGAL_BRAND.name}`,

  defaultRobots: 'index,follow',

  locale: 'en_UG',

  type: 'website',

  publisher: LEGAL_BRAND.legalName,

  canonicalBasePath: '/legal',
});

/* ============================================================================
 * DOCUMENT RETRIEVAL HELPERS
 * ========================================================================== */

/**
 * Returns a legal document by ID.
 *
 * @param {string} id
 * @returns {object|null}
 */
export function getLegalDocumentById(id) {
  if (typeof id !== 'string' || !id.trim()) {
    return null;
  }

  return LEGAL_DOCUMENT_BY_ID[id.trim()] || null;
}

/**
 * Returns a legal document by slug.
 *
 * @param {string} slug
 * @returns {object|null}
 */
export function getLegalDocumentBySlug(slug) {
  if (typeof slug !== 'string' || !slug.trim()) {
    return null;
  }

  return LEGAL_DOCUMENT_BY_SLUG[slug.trim()] || null;
}

/**
 * Returns a legal document by either ID or slug.
 *
 * @param {string} identifier
 * @returns {object|null}
 */
export function getLegalDocument(identifier) {
  if (typeof identifier !== 'string' || !identifier.trim()) {
    return null;
  }

  const normalizedIdentifier = identifier.trim();

  return (
    getLegalDocumentById(normalizedIdentifier) ||
    getLegalDocumentBySlug(normalizedIdentifier)
  );
}

/**
 * Returns whether a legal document exists.
 *
 * @param {string} identifier
 * @returns {boolean}
 */
export function hasLegalDocument(identifier) {
  return Boolean(getLegalDocument(identifier));
}

/**
 * Returns all active public legal documents.
 *
 * @returns {Array<object>}
 */
export function getActiveLegalDocuments() {
  return LEGAL_DOCUMENTS.filter(
    (document) =>
      document.status === LEGAL_DOCUMENT_STATUS.ACTIVE &&
      document.visibility === LEGAL_DOCUMENT_VISIBILITY.PUBLIC,
  );
}

/**
 * Returns navigation configuration for a legal document.
 *
 * @param {string} identifier
 * @returns {Array<object>}
 */
export function getLegalSectionNavigation(identifier) {
  const document = getLegalDocument(identifier);

  return document?.navigation || [];
}

/* ============================================================================
 * URL HELPERS
 * ========================================================================== */

/**
 * Generates a stable legal-section URL.
 *
 * @param {string} documentIdentifier
 * @param {string} sectionId
 * @returns {string|null}
 */
export function getLegalSectionUrl(documentIdentifier, sectionId) {
  const document = getLegalDocument(documentIdentifier);

  if (!document || typeof sectionId !== 'string' || !sectionId.trim()) {
    return null;
  }

  const normalizedSectionId = sectionId.trim();

  const sectionExists = document.sectionIds.includes(normalizedSectionId);

  if (!sectionExists) {
    return null;
  }

  return `${document.route}#${normalizedSectionId}`;
}

/**
 * Normalizes a legal-document route.
 *
 * @param {string} pathname
 * @returns {object|null}
 */
export function resolveLegalRoute(pathname) {
  if (typeof pathname !== 'string' || !pathname.trim()) {
    return null;
  }

  const normalizedPath = pathname
    .trim()
    .replace(/\/+$/, '') || '/';

  return (
    LEGAL_DOCUMENTS.find(
      (document) => document.canonicalPath === normalizedPath,
    ) || null
  );
}

/* ============================================================================
 * VALIDATION
 * ========================================================================== */

/**
 * Required document fields.
 *
 * This complements legalTypes.js and provides configuration-level validation.
 */
export const REQUIRED_LEGAL_CONFIG_FIELDS = Object.freeze([
  'id',
  'type',
  'slug',
  'title',
  'shortTitle',
  'description',
  'status',
  'visibility',
  'version',
  'lastUpdated',
  'effectiveDate',
  'route',
  'canonicalPath',
  'sectionIds',
  'navigation',
  'contact',
  'seo',
  'accessibility',
]);

/**
 * Validate a legal-document configuration object.
 *
 * @param {unknown} document
 * @returns {{
 *   valid: boolean,
 *   errors: string[]
 * }}
 */
export function validateLegalDocumentConfig(document) {
  const errors = [];

  if (!document || typeof document !== 'object') {
    return {
      valid: false,
      errors: ['Legal document configuration must be an object.'],
    };
  }

  REQUIRED_LEGAL_CONFIG_FIELDS.forEach((field) => {
    if (
      !Object.prototype.hasOwnProperty.call(document, field) ||
      document[field] === null ||
      document[field] === undefined
    ) {
      errors.push(`Missing required legal document field: ${field}`);
    }
  });

  if (
    document.id &&
    typeof document.id !== 'string'
  ) {
    errors.push('Legal document "id" must be a string.');
  }

  if (
    document.slug &&
    typeof document.slug !== 'string'
  ) {
    errors.push('Legal document "slug" must be a string.');
  }

  if (
    document.route &&
    !document.route.startsWith('/')
  ) {
    errors.push('Legal document "route" must start with "/".');
  }

  if (
    document.canonicalPath &&
    !document.canonicalPath.startsWith('/')
  ) {
    errors.push('Legal document "canonicalPath" must start with "/".');
  }

  if (
    document.sectionIds &&
    !Array.isArray(document.sectionIds)
  ) {
    errors.push('Legal document "sectionIds" must be an array.');
  }

  if (
    document.navigation &&
    !Array.isArray(document.navigation)
  ) {
    errors.push('Legal document "navigation" must be an array.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate the complete legal registry.
 *
 * @returns {{
 *   valid: boolean,
 *   errors: string[]
 * }}
 */
export function validateLegalRegistry() {
  const errors = [];

  if (!Array.isArray(LEGAL_DOCUMENTS)) {
    return {
      valid: false,
      errors: ['LEGAL_DOCUMENTS must be an array.'],
    };
  }

  const ids = new Set();
  const slugs = new Set();
  const routes = new Set();

  LEGAL_DOCUMENTS.forEach((document, index) => {
    const validation = validateLegalDocumentConfig(document);

    validation.errors.forEach((error) => {
      errors.push(`Document ${index + 1}: ${error}`);
    });

    if (document.id) {
      if (ids.has(document.id)) {
        errors.push(`Duplicate legal document ID: ${document.id}`);
      }

      ids.add(document.id);
    }

    if (document.slug) {
      if (slugs.has(document.slug)) {
        errors.push(`Duplicate legal document slug: ${document.slug}`);
      }

      slugs.add(document.slug);
    }

    if (document.route) {
      if (routes.has(document.route)) {
        errors.push(`Duplicate legal document route: ${document.route}`);
      }

      routes.add(document.route);
    }

    if (
      Array.isArray(document.sectionIds) &&
      Array.isArray(document.navigation)
    ) {
      document.navigation.forEach((section) => {
        if (!document.sectionIds.includes(section.id)) {
          errors.push(
            `Document ${document.id}: navigation section "${section.id}" ` +
              'is not present in sectionIds.',
          );
        }
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/* ============================================================================
 * DEVELOPMENT DIAGNOSTICS
 * ========================================================================== */

/**
 * Development-only configuration assertion.
 *
 * This deliberately does nothing in production.
 *
 * Usage:
 *   assertLegalRegistry();
 */
export function assertLegalRegistry() {
  const isDevelopment =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.DEV === true;

  if (!isDevelopment) {
    return true;
  }

  const result = validateLegalRegistry();

  if (!result.valid) {
    // eslint-disable-next-line no-console
    console.error(
      '[TITech Legal Registry] Invalid legal configuration:',
      result.errors,
    );

    return false;
  }

  return true;
}

/* ============================================================================
 * DEFAULT EXPORT
 * ========================================================================== */

const legalConfig = Object.freeze({
  brand: LEGAL_BRAND,

  version: LEGAL_VERSION,

  lastUpdated: LEGAL_LAST_UPDATED,

  effectiveDate: LEGAL_EFFECTIVE_DATE,

  dates: LEGAL_DATES,

  contacts: LEGAL_CONTACTS,

  address: LEGAL_ADDRESS,

  documentTypes: LEGAL_DOCUMENT_TYPES,

  documentIds: LEGAL_DOCUMENT_IDS,

  documentSlugs: LEGAL_DOCUMENT_SLUGS,

  documentStatus: LEGAL_DOCUMENT_STATUS,

  documentVisibility: LEGAL_DOCUMENT_VISIBILITY,

  sectionIds: LEGAL_SECTION_IDS,

  sectionNavigation: LEGAL_SECTION_NAVIGATION,

  documents: LEGAL_DOCUMENTS,

  documentsById: LEGAL_DOCUMENT_BY_ID,

  documentsBySlug: LEGAL_DOCUMENT_BY_SLUG,

  navigation: LEGAL_NAVIGATION,

  routes: LEGAL_ROUTES,

  footerLinks: LEGAL_FOOTER_LINKS,

  page: LEGAL_PAGE_CONFIG,

  seo: LEGAL_SEO_DEFAULTS,
});

export default legalConfig;