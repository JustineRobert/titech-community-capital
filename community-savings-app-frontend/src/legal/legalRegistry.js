/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Legal Document Registry
 * ============================================================================
 *
 * File:
 *   frontend/src/legal/legalRegistry.js
 *
 * Version:
 *   3.0.0
 *
 * Purpose:
 *   Authoritative frontend metadata registry for TITech Community Capital
 *   legal, contractual, regulatory, privacy, financial, security and
 *   compliance documents.
 *
 * Architectural Position:
 *   This module is the LEGAL DOCUMENT METADATA REGISTRY.
 *
 *   It does NOT contain substantive legal wording.
 *
 * Legal content may be supplied by:
 *   - controlled API
 *   - CMS
 *   - versioned database
 *   - approved static content
 *   - regulatory/legal document service
 *
 * Enterprise Design Principles:
 *   ✓ Immutable business identifiers
 *   ✓ Explicit semantic versions
 *   ✓ Explicit effective dates
 *   ✓ Explicit publication lifecycle
 *   ✓ Controlled acceptance requirements
 *   ✓ Tenant-aware applicability
 *   ✓ Audience-aware applicability
 *   ✓ Jurisdiction-aware metadata
 *   ✓ Content-source metadata
 *   ✓ Publication safety
 *   ✓ Deep immutability
 *   ✓ O(1) ID and slug lookup
 *   ✓ Registry integrity validation
 *   ✓ Duplicate detection
 *   ✓ Lifecycle validation
 *   ✓ Acceptance-rule validation
 *   ✓ Future API/CMS compatibility
 *   ✓ Development-time diagnostics
 *   ✓ Production-safe exports
 *   ✓ TITech terminology consistency
 *
 * IMPORTANT LEGAL NOTICE
 * ----------------------------------------------------------------------------
 * This registry is an application configuration layer.
 *
 * It does NOT constitute:
 *   - legal advice
 *   - regulatory approval
 *   - licensing
 *   - authorization
 *   - legal representation
 *   - a determination that TITech Community Capital may conduct any
 *     regulated financial activity
 *
 * Legal, regulatory, compliance and privacy documents must be reviewed and
 * approved by appropriately qualified professionals before publication or
 * reliance.
 *
 * ============================================================================
 */

'use strict';

/* ============================================================================
 * MODULE METADATA
 * ========================================================================== */

export const LEGAL_REGISTRY_VERSION = '3.0.0';

export const LEGAL_REGISTRY_NAME =
  'TITech Community Capital Enterprise Legal Document Registry';

export const LEGAL_BRAND_NAME =
  'TITech Community Capital';

/* ============================================================================
 * Publication lifecycle
 * ========================================================================== */

export const LEGAL_STATUS = Object.freeze({
  DRAFT: 'draft',
  REVIEW: 'review',
  APPROVED: 'approved',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  SUPERSEDED: 'superseded',
  RETIRED: 'retired',
});

/* ============================================================================
 * Legal document categories
 * ========================================================================== */

export const LEGAL_CATEGORY = Object.freeze({
  CONTRACT: 'contract',
  PRIVACY: 'privacy',
  POLICY: 'policy',
  FINANCIAL: 'financial',
  PAYMENTS: 'payments',
  DATA_PROTECTION: 'data-protection',
  DISPUTE: 'dispute',
  DEVELOPER: 'developer',
  REGULATORY: 'regulatory',
  COMMUNICATIONS: 'communications',
  SECURITY: 'security',
  GOVERNANCE: 'governance',
  RISK: 'risk',
});

/* ============================================================================
 * Intended audience
 * ========================================================================== */

export const LEGAL_AUDIENCE = Object.freeze({
  PUBLIC: 'public',
  MEMBER: 'member',
  TENANT_ADMIN: 'tenant-admin',
  SACCO: 'sacco',
  VSLA: 'vsla',
  COOPERATIVE: 'cooperative',
  LENDER: 'lender',
  BORROWER: 'borrower',
  DEVELOPER: 'developer',
  PARTNER: 'partner',
  INTERNAL: 'internal',
  REGULATOR: 'regulator',
  EMPLOYEE: 'employee',
});

/* ============================================================================
 * Acceptance scopes
 * ========================================================================== */

export const LEGAL_ACCEPTANCE_SCOPE = Object.freeze({
  USER: 'user',
  TENANT: 'tenant',
  ORGANIZATION: 'organization',
  TRANSACTION: 'transaction',
});

/* ============================================================================
 * Content sources
 * ========================================================================== */

export const LEGAL_CONTENT_SOURCE = Object.freeze({
  API: 'api',
  CMS: 'cms',
  STATIC: 'static',
  DATABASE: 'database',
});

/* ============================================================================
 * Priority
 * ========================================================================== */

export const LEGAL_PRIORITY = Object.freeze({
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
});

/* ============================================================================
 * Jurisdictions
 * ========================================================================== */

export const LEGAL_JURISDICTION = Object.freeze({
  UGANDA: 'UG',
  EAST_AFRICA: 'EAC',
  AFRICA: 'AFRICA',
  INTERNATIONAL: 'INTERNATIONAL',
});

/* ============================================================================
 * Supported languages
 * ========================================================================== */

export const LEGAL_LANGUAGE = Object.freeze({
  ENGLISH: 'en',
});

/* ============================================================================
 * Immutable document identifiers
 *
 * IMPORTANT:
 * These IDs are business/API identifiers.
 *
 * Once a document enters production, its ID must not be renamed.
 * If a document is replaced, create a new version or a new document identity
 * according to the backend legal-document versioning policy.
 * ========================================================================== */

export const LEGAL_DOCUMENT_ID = Object.freeze({
  TERMS_OF_SERVICE: 'terms-of-service',

  PRIVACY_POLICY: 'privacy-policy',

  COOKIE_POLICY: 'cookie-policy',

  FINANCIAL_SERVICES_DISCLAIMER:
    'financial-services-disclaimer',

  ELECTRONIC_COMMUNICATIONS_CONSENT:
    'electronic-communications-consent',

  ACCEPTABLE_USE_POLICY:
    'acceptable-use-policy',

  COMMUNITY_SACCO_TERMS:
    'community-sacco-terms',

  LOAN_TERMS:
    'loan-terms',

  SAVINGS_TERMS:
    'savings-terms',

  PAYMENT_TERMS:
    'payment-terms',

  REFUND_REVERSAL_POLICY:
    'refund-reversal-policy',

  COMPLAINTS_DISPUTE_RESOLUTION:
    'complaints-dispute-resolution',

  DATA_RETENTION_POLICY:
    'data-retention-policy',

  DATA_PROCESSING_TERMS:
    'data-processing-terms',

  THIRD_PARTY_SERVICES_TERMS:
    'third-party-services-terms',

  API_TERMS:
    'api-terms',

  DEVELOPER_TERMS:
    'developer-terms',

  REGULATORY_DISCLOSURES:
    'regulatory-disclosures',

  INFORMATION_SECURITY_POLICY:
    'information-security-policy',

  RISK_DISCLOSURE:
    'risk-disclosure',

  BUSINESS_CONTINUITY_POLICY:
    'business-continuity-policy',
});

/* ============================================================================
 * Registry defaults
 * ========================================================================== */

const DEFAULT_DOCUMENT_METADATA = Object.freeze({
  jurisdiction: LEGAL_JURISDICTION.UGANDA,

  language: LEGAL_LANGUAGE.ENGLISH,

  contentSource: LEGAL_CONTENT_SOURCE.API,

  searchable: true,

  printable: true,

  downloadable: true,

  public: false,

  requiresAcceptance: false,

  acceptanceScope: null,

  acceptanceRequiredBeforeUse: false,

  acceptanceRequiredBeforeTransaction: false,

  acceptanceVersionLock: true,

  supersedes: null,

  supersededBy: null,

  contentHash: null,

  legalOwner: LEGAL_BRAND_NAME,

  complianceOwner: null,

  legalReviewRequired: true,

  regulatoryReviewRequired: false,

  securityReviewRequired: false,

  privacyReviewRequired: false,

  publishedAt: null,

  scheduledAt: null,

  retiredAt: null,

  route: null,

  apiPath: null,

  tags: [],
});

/* ============================================================================
 * Internal helper utilities
 * ========================================================================== */

/**
 * Normalize a potentially user/API supplied string.
 *
 * @param {*} value
 * @returns {string|null}
 */
function normalizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();

  return normalized || null;
}

/**
 * Normalize an array without mutating the source.
 *
 * @param {*} value
 * @returns {Array}
 */
function normalizeArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

/**
 * Validate ISO calendar date format.
 *
 * This intentionally validates format and calendar correctness without
 * introducing timezone-specific interpretation.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidISODate(value) {
  if (typeof value !== 'string') {
    return false;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

/**
 * Validate ISO timestamp.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidISOTimestamp(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const timestamp = Date.parse(value);

  return !Number.isNaN(timestamp);
}

/**
 * Validate semantic version.
 *
 * Supported format:
 *   MAJOR.MINOR.PATCH
 *
 * Optional prerelease/build metadata is supported.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isValidLegalVersion(value) {
  if (typeof value !== 'string') {
    return false;
  }

  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
    value.trim()
  );
}

/**
 * Deep-freeze an object.
 *
 * This protects nested arrays and objects from accidental runtime mutation.
 *
 * @param {*} value
 * @returns {*}
 */
function deepFreeze(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Reflect.ownKeys(value).forEach((key) => {
    deepFreeze(value[key]);
  });

  return Object.freeze(value);
}

/* ============================================================================
 * Enterprise legal document registry
 * ========================================================================== */

const RAW_LEGAL_DOCUMENTS = [
  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.TERMS_OF_SERVICE,

    slug: 'terms-of-service',

    title: 'Terms of Service',

    shortTitle: 'Terms',

    category: LEGAL_CATEGORY.CONTRACT,

    audience: [
      LEGAL_AUDIENCE.PUBLIC,
      LEGAL_AUDIENCE.MEMBER,
      LEGAL_AUDIENCE.TENANT_ADMIN,
    ],

    public: true,

    requiresAcceptance: true,

    acceptanceScope: LEGAL_ACCEPTANCE_SCOPE.USER,

    acceptanceRequiredBeforeUse: true,

    currentVersion: '1.0.0',

    effectiveDate: '2026-01-15',

    status: LEGAL_STATUS.PUBLISHED,

    route: '/legal/terms-of-service',

    apiPath: '/api/legal/terms-of-service',

    priority: LEGAL_PRIORITY.CRITICAL,

    tags: [
      'terms',
      'contract',
      'user-agreement',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.PRIVACY_POLICY,

    slug: 'privacy-policy',

    title: 'Privacy Policy',

    shortTitle: 'Privacy',

    category: LEGAL_CATEGORY.PRIVACY,

    audience: [
      LEGAL_AUDIENCE.PUBLIC,
      LEGAL_AUDIENCE.MEMBER,
      LEGAL_AUDIENCE.TENANT_ADMIN,
    ],

    public: true,

    requiresAcceptance: true,

    acceptanceScope: LEGAL_ACCEPTANCE_SCOPE.USER,

    acceptanceRequiredBeforeUse: true,

    privacyReviewRequired: true,

    currentVersion: '1.0.0',

    effectiveDate: '2026-01-15',

    status: LEGAL_STATUS.PUBLISHED,

    route: '/legal/privacy-policy',

    apiPath: '/api/legal/privacy-policy',

    priority: LEGAL_PRIORITY.CRITICAL,

    tags: [
      'privacy',
      'data-protection',
      'personal-data',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.COOKIE_POLICY,

    slug: 'cookie-policy',

    title: 'Cookie Policy',

    shortTitle: 'Cookies',

    category: LEGAL_CATEGORY.PRIVACY,

    audience: [
      LEGAL_AUDIENCE.PUBLIC,
      LEGAL_AUDIENCE.MEMBER,
    ],

    public: false,

    requiresAcceptance: false,

    privacyReviewRequired: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/cookie-policy',

    apiPath: '/api/legal/cookie-policy',

    priority: LEGAL_PRIORITY.HIGH,

    tags: [
      'cookies',
      'tracking',
      'privacy',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.FINANCIAL_SERVICES_DISCLAIMER,

    slug: 'financial-services-disclaimer',

    title: 'Financial Services Disclaimer',

    shortTitle: 'Financial Disclaimer',

    category: LEGAL_CATEGORY.FINANCIAL,

    audience: [
      LEGAL_AUDIENCE.PUBLIC,
      LEGAL_AUDIENCE.MEMBER,
      LEGAL_AUDIENCE.BORROWER,
    ],

    public: false,

    requiresAcceptance: false,

    regulatoryReviewRequired: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/financial-services-disclaimer',

    apiPath: '/api/legal/financial-services-disclaimer',

    priority: LEGAL_PRIORITY.CRITICAL,

    tags: [
      'financial-services',
      'disclaimer',
      'risk',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.ELECTRONIC_COMMUNICATIONS_CONSENT,

    slug: 'electronic-communications-consent',

    title: 'Electronic Communications Consent',

    shortTitle: 'Electronic Communications',

    category: LEGAL_CATEGORY.COMMUNICATIONS,

    audience: [
      LEGAL_AUDIENCE.PUBLIC,
      LEGAL_AUDIENCE.MEMBER,
    ],

    public: true,

    requiresAcceptance: true,

    acceptanceScope: LEGAL_ACCEPTANCE_SCOPE.USER,

    acceptanceRequiredBeforeUse: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/electronic-communications-consent',

    apiPath: '/api/legal/electronic-communications-consent',

    priority: LEGAL_PRIORITY.HIGH,

    tags: [
      'electronic-communications',
      'consent',
      'communications',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.ACCEPTABLE_USE_POLICY,

    slug: 'acceptable-use-policy',

    title: 'Acceptable Use Policy',

    shortTitle: 'Acceptable Use',

    category: LEGAL_CATEGORY.POLICY,

    audience: [
      LEGAL_AUDIENCE.PUBLIC,
      LEGAL_AUDIENCE.MEMBER,
      LEGAL_AUDIENCE.TENANT_ADMIN,
    ],

    public: true,

    requiresAcceptance: false,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/acceptable-use-policy',

    apiPath: '/api/legal/acceptable-use-policy',

    priority: LEGAL_PRIORITY.HIGH,

    tags: [
      'acceptable-use',
      'conduct',
      'platform',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.COMMUNITY_SACCO_TERMS,

    slug: 'community-sacco-terms',

    title: 'Community and SACCO Terms',

    shortTitle: 'Community / SACCO Terms',

    category: LEGAL_CATEGORY.CONTRACT,

    audience: [
      LEGAL_AUDIENCE.SACCO,
      LEGAL_AUDIENCE.TENANT_ADMIN,
      LEGAL_AUDIENCE.COOPERATIVE,
    ],

    public: true,

    requiresAcceptance: true,

    acceptanceScope: LEGAL_ACCEPTANCE_SCOPE.TENANT,

    acceptanceRequiredBeforeUse: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/community-sacco-terms',

    apiPath: '/api/legal/community-sacco-terms',

    priority: LEGAL_PRIORITY.CRITICAL,

    tags: [
      'sacco',
      'community',
      'tenant',
      'cooperative',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.LOAN_TERMS,

    slug: 'loan-terms',

    title: 'Loan Terms',

    shortTitle: 'Loan Terms',

    category: LEGAL_CATEGORY.FINANCIAL,

    audience: [
      LEGAL_AUDIENCE.BORROWER,
      LEGAL_AUDIENCE.MEMBER,
      LEGAL_AUDIENCE.SACCO,
    ],

    public: true,

    requiresAcceptance: true,

    acceptanceScope: LEGAL_ACCEPTANCE_SCOPE.TRANSACTION,

    acceptanceRequiredBeforeTransaction: true,

    regulatoryReviewRequired: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/loan-terms',

    apiPath: '/api/legal/loan-terms',

    priority: LEGAL_PRIORITY.CRITICAL,

    tags: [
      'loan',
      'credit',
      'borrowing',
      'financial',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.SAVINGS_TERMS,

    slug: 'savings-terms',

    title: 'Savings Terms',

    shortTitle: 'Savings Terms',

    category: LEGAL_CATEGORY.FINANCIAL,

    audience: [
      LEGAL_AUDIENCE.MEMBER,
      LEGAL_AUDIENCE.SACCO,
      LEGAL_AUDIENCE.VSLA,
    ],

    public: true,

    requiresAcceptance: true,

    acceptanceScope: LEGAL_ACCEPTANCE_SCOPE.USER,

    acceptanceRequiredBeforeUse: true,

    regulatoryReviewRequired: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/savings-terms',

    apiPath: '/api/legal/savings-terms',

    priority: LEGAL_PRIORITY.CRITICAL,

    tags: [
      'savings',
      'member',
      'sacco',
      'vsla',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.PAYMENT_TERMS,

    slug: 'payment-terms',

    title: 'Payment Terms',

    shortTitle: 'Payment Terms',

    category: LEGAL_CATEGORY.PAYMENTS,

    audience: [
      LEGAL_AUDIENCE.PUBLIC,
      LEGAL_AUDIENCE.MEMBER,
      LEGAL_AUDIENCE.SACCO,
    ],

    public: true,

    requiresAcceptance: true,

    acceptanceScope: LEGAL_ACCEPTANCE_SCOPE.TRANSACTION,

    acceptanceRequiredBeforeTransaction: true,

    regulatoryReviewRequired: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/payment-terms',

    apiPath: '/api/legal/payment-terms',

    priority: LEGAL_PRIORITY.CRITICAL,

    tags: [
      'payments',
      'transactions',
      'mobile-money',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.REFUND_REVERSAL_POLICY,

    slug: 'refund-reversal-policy',

    title: 'Refund and Reversal Policy',

    shortTitle: 'Refunds & Reversals',

    category: LEGAL_CATEGORY.PAYMENTS,

    audience: [
      LEGAL_AUDIENCE.PUBLIC,
      LEGAL_AUDIENCE.MEMBER,
      LEGAL_AUDIENCE.SACCO,
    ],

    public: true,

    requiresAcceptance: false,

    regulatoryReviewRequired: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/refund-reversal-policy',

    apiPath: '/api/legal/refund-reversal-policy',

    priority: LEGAL_PRIORITY.CRITICAL,

    tags: [
      'refund',
      'reversal',
      'payments',
      'disputes',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.COMPLAINTS_DISPUTE_RESOLUTION,

    slug: 'complaints-dispute-resolution',

    title: 'Complaints and Dispute Resolution',

    shortTitle: 'Complaints & Disputes',

    category: LEGAL_CATEGORY.DISPUTE,

    audience: [
      LEGAL_AUDIENCE.PUBLIC,
      LEGAL_AUDIENCE.MEMBER,
      LEGAL_AUDIENCE.TENANT_ADMIN,
    ],

    public: true,

    requiresAcceptance: false,

    regulatoryReviewRequired: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/complaints-dispute-resolution',

    apiPath: '/api/legal/complaints-dispute-resolution',

    priority: LEGAL_PRIORITY.CRITICAL,

    tags: [
      'complaints',
      'disputes',
      'resolution',
      'consumer-protection',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.DATA_RETENTION_POLICY,

    slug: 'data-retention-policy',

    title: 'Data Retention Policy',

    shortTitle: 'Data Retention',

    category: LEGAL_CATEGORY.DATA_PROTECTION,

    audience: [
      LEGAL_AUDIENCE.PUBLIC,
      LEGAL_AUDIENCE.MEMBER,
      LEGAL_AUDIENCE.TENANT_ADMIN,
      LEGAL_AUDIENCE.INTERNAL,
    ],

    public: true,

    requiresAcceptance: false,

    privacyReviewRequired: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/data-retention-policy',

    apiPath: '/api/legal/data-retention-policy',

    priority: LEGAL_PRIORITY.HIGH,

    tags: [
      'data-retention',
      'privacy',
      'records',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.DATA_PROCESSING_TERMS,

    slug: 'data-processing-terms',

    title: 'Data Processing / Controller-Processor Terms',

    shortTitle: 'Data Processing Terms',

    category: LEGAL_CATEGORY.DATA_PROTECTION,

    audience: [
      LEGAL_AUDIENCE.TENANT_ADMIN,
      LEGAL_AUDIENCE.PARTNER,
      LEGAL_AUDIENCE.SACCO,
      LEGAL_AUDIENCE.INTERNAL,
    ],

    public: false,

    requiresAcceptance: true,

    acceptanceScope: LEGAL_ACCEPTANCE_SCOPE.TENANT,

    acceptanceRequiredBeforeUse: true,

    privacyReviewRequired: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/data-processing-terms',

    apiPath: '/api/legal/data-processing-terms',

    priority: LEGAL_PRIORITY.CRITICAL,

    tags: [
      'data-processing',
      'controller',
      'processor',
      'privacy',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.THIRD_PARTY_SERVICES_TERMS,

    slug: 'third-party-services-terms',

    title: 'Third-Party Services Terms',

    shortTitle: 'Third-Party Services',

    category: LEGAL_CATEGORY.CONTRACT,

    audience: [
      LEGAL_AUDIENCE.PUBLIC,
      LEGAL_AUDIENCE.PARTNER,
      LEGAL_AUDIENCE.TENANT_ADMIN,
    ],

    public: true,

    requiresAcceptance: false,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/third-party-services-terms',

    apiPath: '/api/legal/third-party-services-terms',

    priority: LEGAL_PRIORITY.HIGH,

    tags: [
      'third-party',
      'providers',
      'partners',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.API_TERMS,

    slug: 'api-terms',

    title: 'API Terms',

    shortTitle: 'API Terms',

    category: LEGAL_CATEGORY.DEVELOPER,

    audience: [
      LEGAL_AUDIENCE.DEVELOPER,
      LEGAL_AUDIENCE.PARTNER,
    ],

    public: true,

    requiresAcceptance: true,

    acceptanceScope: LEGAL_ACCEPTANCE_SCOPE.ORGANIZATION,

    acceptanceRequiredBeforeUse: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/api-terms',

    apiPath: '/api/legal/api-terms',

    priority: LEGAL_PRIORITY.MEDIUM,

    tags: [
      'api',
      'developer',
      'integration',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.DEVELOPER_TERMS,

    slug: 'developer-terms',

    title: 'Developer Terms',

    shortTitle: 'Developer Terms',

    category: LEGAL_CATEGORY.DEVELOPER,

    audience: [
      LEGAL_AUDIENCE.DEVELOPER,
      LEGAL_AUDIENCE.PARTNER,
    ],

    public: true,

    requiresAcceptance: true,

    acceptanceScope: LEGAL_ACCEPTANCE_SCOPE.ORGANIZATION,

    acceptanceRequiredBeforeUse: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/developer-terms',

    apiPath: '/api/legal/developer-terms',

    priority: LEGAL_PRIORITY.MEDIUM,

    tags: [
      'developer',
      'software',
      'integration',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.REGULATORY_DISCLOSURES,

    slug: 'regulatory-disclosures',

    title: 'Regulatory Disclosures',

    shortTitle: 'Regulatory Disclosures',

    category: LEGAL_CATEGORY.REGULATORY,

    audience: [
      LEGAL_AUDIENCE.PUBLIC,
      LEGAL_AUDIENCE.MEMBER,
      LEGAL_AUDIENCE.REGULATOR,
      LEGAL_AUDIENCE.PARTNER,
    ],

    public: true,

    requiresAcceptance: false,

    regulatoryReviewRequired: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/regulatory-disclosures',

    apiPath: '/api/legal/regulatory-disclosures',

    priority: LEGAL_PRIORITY.CRITICAL,

    tags: [
      'regulatory',
      'disclosures',
      'compliance',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.INFORMATION_SECURITY_POLICY,

    slug: 'information-security-policy',

    title: 'Information Security Policy',

    shortTitle: 'Information Security',

    category: LEGAL_CATEGORY.SECURITY,

    audience: [
      LEGAL_AUDIENCE.INTERNAL,
      LEGAL_AUDIENCE.PARTNER,
      LEGAL_AUDIENCE.REGULATOR,
    ],

    public: false,

    requiresAcceptance: false,

    securityReviewRequired: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/information-security-policy',

    apiPath: '/api/legal/information-security-policy',

    priority: LEGAL_PRIORITY.CRITICAL,

    tags: [
      'security',
      'information-security',
      'cybersecurity',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.RISK_DISCLOSURE,

    slug: 'risk-disclosure',

    title: 'Risk Disclosure',

    shortTitle: 'Risk Disclosure',

    category: LEGAL_CATEGORY.RISK,

    audience: [
      LEGAL_AUDIENCE.PUBLIC,
      LEGAL_AUDIENCE.MEMBER,
      LEGAL_AUDIENCE.BORROWER,
      LEGAL_AUDIENCE.SACCO,
    ],

    public: true,

    requiresAcceptance: false,

    regulatoryReviewRequired: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/risk-disclosure',

    apiPath: '/api/legal/risk-disclosure',

    priority: LEGAL_PRIORITY.CRITICAL,

    tags: [
      'risk',
      'financial-risk',
      'consumer-disclosure',
    ],
  },

  {
    ...DEFAULT_DOCUMENT_METADATA,

    id: LEGAL_DOCUMENT_ID.BUSINESS_CONTINUITY_POLICY,

    slug: 'business-continuity-policy',

    title: 'Business Continuity Policy',

    shortTitle: 'Business Continuity',

    category: LEGAL_CATEGORY.GOVERNANCE,

    audience: [
      LEGAL_AUDIENCE.INTERNAL,
      LEGAL_AUDIENCE.PARTNER,
      LEGAL_AUDIENCE.REGULATOR,
    ],

    public: false,

    requiresAcceptance: false,

    securityReviewRequired: true,

    currentVersion: '1.0.0',

    effectiveDate: null,

    status: LEGAL_STATUS.DRAFT,

    route: '/legal/business-continuity-policy',

    apiPath: '/api/legal/business-continuity-policy',

    priority: LEGAL_PRIORITY.HIGH,

    tags: [
      'business-continuity',
      'resilience',
      'governance',
    ],
  },
];

/* ============================================================================
 * Freeze and publish registry
 * ========================================================================== */

export const LEGAL_DOCUMENTS = deepFreeze(
  RAW_LEGAL_DOCUMENTS.map((document) => ({
    ...document,
    audience: normalizeArray(document.audience),
    tags: normalizeArray(document.tags),
  }))
);

/* ============================================================================
 * Registry indexes
 * ========================================================================== */

const byId = Object.create(null);
const bySlug = Object.create(null);

for (const document of LEGAL_DOCUMENTS) {
  byId[document.id] = document;
  bySlug[document.slug] = document;
}

export const LEGAL_DOCUMENT_INDEX = Object.freeze({
  byId: Object.freeze(byId),
  bySlug: Object.freeze(bySlug),
});

/* ============================================================================
 * Lookup helpers
 * ========================================================================== */

/**
 * Get a legal document by immutable document ID.
 *
 * @param {string} id
 * @returns {object|null}
 */
export function getLegalDocumentById(id) {
  const normalizedId = normalizeString(id);

  if (!normalizedId) {
    return null;
  }

  return LEGAL_DOCUMENT_INDEX.byId[normalizedId] || null;
}

/**
 * Get a legal document by route slug.
 *
 * @param {string} slug
 * @returns {object|null}
 */
export function getLegalDocumentBySlug(slug) {
  const normalizedSlug = normalizeString(slug);

  if (!normalizedSlug) {
    return null;
  }

  return LEGAL_DOCUMENT_INDEX.bySlug[normalizedSlug] || null;
}

/**
 * Get a legal document by ID or slug.
 *
 * Useful for API/CMS adapters.
 *
 * @param {string} identifier
 * @returns {object|null}
 */
export function getLegalDocument(identifier) {
  return (
    getLegalDocumentById(identifier) ||
    getLegalDocumentBySlug(identifier)
  );
}

/* ============================================================================
 * Publication helpers
 * ========================================================================== */

/**
 * Published documents that are explicitly public.
 *
 * @returns {Array<object>}
 */
export function getPublishedLegalDocuments() {
  return LEGAL_DOCUMENTS.filter(
    (document) =>
      document.status === LEGAL_STATUS.PUBLISHED &&
      document.public === true &&
      Boolean(document.effectiveDate)
  );
}

/**
 * Publicly discoverable documents in an approved/published lifecycle state.
 *
 * Scheduled documents are intentionally included because they may be exposed
 * by administrative/legal tooling, but consumers should check scheduledAt
 * before making them publicly visible.
 *
 * @returns {Array<object>}
 */
export function getPublicLegalDocuments() {
  return LEGAL_DOCUMENTS.filter(
    (document) =>
      document.public === true &&
      [
        LEGAL_STATUS.APPROVED,
        LEGAL_STATUS.SCHEDULED,
        LEGAL_STATUS.PUBLISHED,
      ].includes(document.status)
  );
}

/**
 * Documents currently requiring acceptance.
 *
 * @returns {Array<object>}
 */
export function getAcceptanceRequiredDocuments() {
  return LEGAL_DOCUMENTS.filter(
    (document) =>
      document.requiresAcceptance === true
  );
}

/**
 * Documents requiring acceptance before normal platform use.
 *
 * @returns {Array<object>}
 */
export function getUseAcceptanceDocuments() {
  return LEGAL_DOCUMENTS.filter(
    (document) =>
      document.requiresAcceptance === true &&
      document.acceptanceRequiredBeforeUse === true
  );
}

/**
 * Documents requiring acceptance before a transaction.
 *
 * @returns {Array<object>}
 */
export function getTransactionAcceptanceDocuments() {
  return LEGAL_DOCUMENTS.filter(
    (document) =>
      document.requiresAcceptance === true &&
      document.acceptanceScope ===
        LEGAL_ACCEPTANCE_SCOPE.TRANSACTION &&
      document.acceptanceRequiredBeforeTransaction === true
  );
}

/**
 * Documents requiring tenant-level acceptance.
 *
 * @returns {Array<object>}
 */
export function getTenantAcceptanceDocuments() {
  return LEGAL_DOCUMENTS.filter(
    (document) =>
      document.requiresAcceptance === true &&
      document.acceptanceScope ===
        LEGAL_ACCEPTANCE_SCOPE.TENANT
  );
}

/**
 * Documents requiring organization-level acceptance.
 *
 * @returns {Array<object>}
 */
export function getOrganizationAcceptanceDocuments() {
  return LEGAL_DOCUMENTS.filter(
    (document) =>
      document.requiresAcceptance === true &&
      document.acceptanceScope ===
        LEGAL_ACCEPTANCE_SCOPE.ORGANIZATION
  );
}

/* ============================================================================
 * Filtering helpers
 * ========================================================================== */

/**
 * Get documents by category.
 *
 * @param {string} category
 * @returns {Array<object>}
 */
export function getLegalDocumentsByCategory(category) {
  const normalizedCategory = normalizeString(category);

  if (!normalizedCategory) {
    return [];
  }

  return LEGAL_DOCUMENTS.filter(
    (document) =>
      document.category === normalizedCategory
  );
}

/**
 * Get documents by audience.
 *
 * @param {string} audience
 * @returns {Array<object>}
 */
export function getLegalDocumentsByAudience(audience) {
  const normalizedAudience = normalizeString(audience);

  if (!normalizedAudience) {
    return [];
  }

  return LEGAL_DOCUMENTS.filter(
    (document) =>
      document.audience.includes(normalizedAudience)
  );
}

/**
 * Get documents by status.
 *
 * @param {string} status
 * @returns {Array<object>}
 */
export function getLegalDocumentsByStatus(status) {
  const normalizedStatus = normalizeString(status);

  if (!normalizedStatus) {
    return [];
  }

  return LEGAL_DOCUMENTS.filter(
    (document) =>
      document.status === normalizedStatus
  );
}

/**
 * Get documents by jurisdiction.
 *
 * @param {string} jurisdiction
 * @returns {Array<object>}
 */
export function getLegalDocumentsByJurisdiction(jurisdiction) {
  const normalizedJurisdiction =
    normalizeString(jurisdiction);

  if (!normalizedJurisdiction) {
    return [];
  }

  return LEGAL_DOCUMENTS.filter(
    (document) =>
      document.jurisdiction === normalizedJurisdiction
  );
}

/**
 * Get documents by priority.
 *
 * @param {string} priority
 * @returns {Array<object>}
 */
export function getLegalDocumentsByPriority(priority) {
  const normalizedPriority = normalizeString(priority);

  if (!normalizedPriority) {
    return [];
  }

  return LEGAL_DOCUMENTS.filter(
    (document) =>
      document.priority === normalizedPriority
  );
}

/**
 * Get documents by tag.
 *
 * @param {string} tag
 * @returns {Array<object>}
 */
export function getLegalDocumentsByTag(tag) {
  const normalizedTag = normalizeString(tag);

  if (!normalizedTag) {
    return [];
  }

  return LEGAL_DOCUMENTS.filter(
    (document) =>
      document.tags.includes(normalizedTag)
  );
}

/**
 * Get critical documents.
 *
 * @returns {Array<object>}
 */
export function getCriticalLegalDocuments() {
  return getLegalDocumentsByPriority(
    LEGAL_PRIORITY.CRITICAL
  );
}

/* ============================================================================
 * State helpers
 * ========================================================================== */

/**
 * Determine whether a legal document is published.
 *
 * @param {object} document
 * @returns {boolean}
 */
export function isLegalDocumentPublished(document) {
  return Boolean(
    document &&
    document.status === LEGAL_STATUS.PUBLISHED &&
    isValidISODate(document.effectiveDate)
  );
}

/**
 * Determine whether a document is publicly discoverable.
 *
 * @param {object} document
 * @returns {boolean}
 */
export function isLegalDocumentPublic(document) {
  return Boolean(
    document &&
    document.public === true &&
    [
      LEGAL_STATUS.APPROVED,
      LEGAL_STATUS.SCHEDULED,
      LEGAL_STATUS.PUBLISHED,
    ].includes(document.status)
  );
}

/**
 * Determine whether a document requires acceptance.
 *
 * @param {object} document
 * @returns {boolean}
 */
export function requiresLegalAcceptance(document) {
  return Boolean(
    document &&
    document.requiresAcceptance === true &&
    Object.values(LEGAL_ACCEPTANCE_SCOPE).includes(
      document.acceptanceScope
    )
  );
}

/**
 * Determine whether acceptance is required before use.
 *
 * @param {object} document
 * @returns {boolean}
 */
export function requiresAcceptanceBeforeUse(document) {
  return Boolean(
    requiresLegalAcceptance(document) &&
    document.acceptanceRequiredBeforeUse === true
  );
}

/**
 * Determine whether acceptance is required before a transaction.
 *
 * @param {object} document
 * @returns {boolean}
 */
export function requiresAcceptanceBeforeTransaction(document) {
  return Boolean(
    requiresLegalAcceptance(document) &&
    document.acceptanceRequiredBeforeTransaction === true
  );
}

/**
 * Determine whether a document is scheduled.
 *
 * @param {object} document
 * @returns {boolean}
 */
export function isLegalDocumentScheduled(document) {
  return Boolean(
    document &&
    document.status === LEGAL_STATUS.SCHEDULED &&
    isValidISOTimestamp(document.scheduledAt)
  );
}

/**
 * Determine whether a document is retired.
 *
 * @param {object} document
 * @returns {boolean}
 */
export function isLegalDocumentRetired(document) {
  return Boolean(
    document &&
    document.status === LEGAL_STATUS.RETIRED
  );
}

/**
 * Determine whether a document is superseded.
 *
 * @param {object} document
 * @returns {boolean}
 */
export function isLegalDocumentSuperseded(document) {
  return Boolean(
    document &&
    document.status === LEGAL_STATUS.SUPERSEDED
  );
}

/* ============================================================================
 * Version helpers
 * ========================================================================== */

/**
 * Compare two semantic legal-document versions.
 *
 * Returns:
 *   -1 when left < right
 *    0 when equal
 *    1 when left > right
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareLegalVersions(left, right) {
  if (
    !isValidLegalVersion(left) ||
    !isValidLegalVersion(right)
  ) {
    return 0;
  }

  const parse = (version) => {
    const core = version
      .trim()
      .split('+')[0]
      .split('-')[0]
      .split('.')
      .map(Number);

    return core;
  };

  const a = parse(left);
  const b = parse(right);

  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) {
      return 1;
    }

    if (a[index] < b[index]) {
      return -1;
    }
  }

  return 0;
}

/* ============================================================================
 * Registry integrity validation
 * ========================================================================== */

/**
 * Validate the complete legal registry.
 *
 * This function is deterministic and side-effect free.
 *
 * @returns {{
 *   valid: boolean,
 *   documentCount: number,
 *   publishedCount: number,
 *   acceptanceRequiredCount: number,
 *   errors: string[],
 *   warnings: string[]
 * }}
 */
export function validateLegalRegistry() {
  const errors = [];
  const warnings = [];

  const ids = new Set();
  const slugs = new Set();

  for (const document of LEGAL_DOCUMENTS) {
    const prefix = `[${document.id || 'unknown'}]`;

    /* ------------------------------------------------------------------------
     * Identity
     * ---------------------------------------------------------------------- */

    if (!normalizeString(document.id)) {
      errors.push(
        `${prefix} Legal document is missing id.`
      );
    }

    if (ids.has(document.id)) {
      errors.push(
        `${prefix} Duplicate legal document id: ${document.id}`
      );
    }

    ids.add(document.id);

    if (!normalizeString(document.slug)) {
      errors.push(
        `${prefix} Legal document is missing slug.`
      );
    }

    if (slugs.has(document.slug)) {
      errors.push(
        `${prefix} Duplicate legal document slug: ${document.slug}`
      );
    }

    slugs.add(document.slug);

    /* ------------------------------------------------------------------------
     * Core metadata
     * ---------------------------------------------------------------------- */

    if (!normalizeString(document.title)) {
      errors.push(
        `${prefix} Legal document is missing title.`
      );
    }

    if (!normalizeString(document.shortTitle)) {
      errors.push(
        `${prefix} Legal document is missing shortTitle.`
      );
    }

    if (
      !isValidLegalVersion(document.currentVersion)
    ) {
      errors.push(
        `${prefix} Invalid currentVersion: ${document.currentVersion}`
      );
    }

    /* ------------------------------------------------------------------------
     * Controlled vocabulary
     * ---------------------------------------------------------------------- */

    if (
      !Object.values(LEGAL_STATUS).includes(
        document.status
      )
    ) {
      errors.push(
        `${prefix} Invalid status: ${document.status}`
      );
    }

    if (
      !Object.values(LEGAL_CATEGORY).includes(
        document.category
      )
    ) {
      errors.push(
        `${prefix} Invalid category: ${document.category}`
      );
    }

    if (
      !Object.values(LEGAL_JURISDICTION).includes(
        document.jurisdiction
      )
    ) {
      errors.push(
        `${prefix} Invalid jurisdiction: ${document.jurisdiction}`
      );
    }

    if (
      !Object.values(LEGAL_CONTENT_SOURCE).includes(
        document.contentSource
      )
    ) {
      errors.push(
        `${prefix} Invalid contentSource: ${document.contentSource}`
      );
    }

    if (
      !Object.values(LEGAL_PRIORITY).includes(
        document.priority
      )
    ) {
      errors.push(
        `${prefix} Invalid priority: ${document.priority}`
      );
    }

    if (
      !Array.isArray(document.audience) ||
      document.audience.length === 0
    ) {
      errors.push(
        `${prefix} audience must contain at least one value.`
      );
    } else {
      for (const audience of document.audience) {
        if (
          !Object.values(LEGAL_AUDIENCE).includes(
            audience
          )
        ) {
          errors.push(
            `${prefix} Invalid audience: ${audience}`
          );
        }
      }
    }

    /* ------------------------------------------------------------------------
     * Acceptance rules
     * ---------------------------------------------------------------------- */

    if (
      document.requiresAcceptance === true &&
      !Object.values(LEGAL_ACCEPTANCE_SCOPE).includes(
        document.acceptanceScope
      )
    ) {
      errors.push(
        `${prefix} requires acceptance but has an invalid acceptanceScope.`
      );
    }

    if (
      document.requiresAcceptance !== true &&
      document.acceptanceScope !== null
    ) {
      warnings.push(
        `${prefix} acceptanceScope is defined although requiresAcceptance is false.`
      );
    }

    if (
      document.acceptanceRequiredBeforeTransaction === true &&
      document.acceptanceScope !==
        LEGAL_ACCEPTANCE_SCOPE.TRANSACTION
    ) {
      errors.push(
        `${prefix} transaction acceptance requires transaction acceptanceScope.`
      );
    }

    if (
      document.acceptanceRequiredBeforeUse === true &&
      document.requiresAcceptance !== true
    ) {
      errors.push(
        `${prefix} acceptanceRequiredBeforeUse requires requiresAcceptance=true.`
      );
    }

    if (
      document.acceptanceRequiredBeforeTransaction === true &&
      document.requiresAcceptance !== true
    ) {
      errors.push(
        `${prefix} acceptanceRequiredBeforeTransaction requires requiresAcceptance=true.`
      );
    }

    /* ------------------------------------------------------------------------
     * Date rules
     * ---------------------------------------------------------------------- */

    if (
      document.effectiveDate !== null &&
      !isValidISODate(document.effectiveDate)
    ) {
      errors.push(
        `${prefix} Invalid effectiveDate: ${document.effectiveDate}`
      );
    }

    if (
      document.publishedAt !== null &&
      !isValidISOTimestamp(document.publishedAt)
    ) {
      errors.push(
        `${prefix} Invalid publishedAt timestamp: ${document.publishedAt}`
      );
    }

    if (
      document.scheduledAt !== null &&
      !isValidISOTimestamp(document.scheduledAt)
    ) {
      errors.push(
        `${prefix} Invalid scheduledAt timestamp: ${document.scheduledAt}`
      );
    }

    if (
      document.retiredAt !== null &&
      !isValidISOTimestamp(document.retiredAt)
    ) {
      errors.push(
        `${prefix} Invalid retiredAt timestamp: ${document.retiredAt}`
      );
    }

    /* ------------------------------------------------------------------------
     * Publication lifecycle rules
     * ---------------------------------------------------------------------- */

    if (
      document.status === LEGAL_STATUS.PUBLISHED &&
      !isValidISODate(document.effectiveDate)
    ) {
      errors.push(
        `${prefix} Published document must have a valid effectiveDate.`
      );
    }

    if (
      document.status === LEGAL_STATUS.PUBLISHED &&
      document.publishedAt === null
    ) {
      warnings.push(
        `${prefix} Published document has no publishedAt timestamp.`
      );
    }

    if (
      document.status === LEGAL_STATUS.SCHEDULED &&
      document.scheduledAt === null
    ) {
      errors.push(
        `${prefix} Scheduled document must have scheduledAt.`
      );
    }

    if (
      document.status === LEGAL_STATUS.RETIRED &&
      document.retiredAt === null
    ) {
      warnings.push(
        `${prefix} Retired document has no retiredAt timestamp.`
      );
    }

    /* ------------------------------------------------------------------------
     * Public visibility rules
     * ---------------------------------------------------------------------- */

    if (
      document.public === true &&
      document.status === LEGAL_STATUS.DRAFT
    ) {
      warnings.push(
        `${prefix} Draft document is marked public but will not be returned by public publication helpers.`
      );
    }

    if (
      document.status === LEGAL_STATUS.PUBLISHED &&
      document.public !== true &&
      document.audience.includes(LEGAL_AUDIENCE.PUBLIC)
    ) {
      warnings.push(
        `${prefix} Published document includes public audience but public=false.`
      );
    }

    /* ------------------------------------------------------------------------
     * Routing
     * ---------------------------------------------------------------------- */

    if (
      document.route !== null &&
      !document.route.startsWith('/legal/')
    ) {
      errors.push(
        `${prefix} route must begin with /legal/.`
      );
    }

    if (
      document.apiPath !== null &&
      !document.apiPath.startsWith('/api/legal/')
    ) {
      errors.push(
        `${prefix} apiPath must begin with /api/legal/.`
      );
    }

    /* ------------------------------------------------------------------------
     * Tags
     * ---------------------------------------------------------------------- */

    if (!Array.isArray(document.tags)) {
      errors.push(
        `${prefix} tags must be an array.`
      );
    }

    /* ------------------------------------------------------------------------
     * Content integrity
     * ---------------------------------------------------------------------- */

    if (
      document.status === LEGAL_STATUS.PUBLISHED &&
      !document.contentHash
    ) {
      warnings.push(
        `${prefix} Published document has no contentHash.`
      );
    }

    /* ------------------------------------------------------------------------
     * Brand terminology safeguard
     * ---------------------------------------------------------------------- */

    const serializedDocument =
      JSON.stringify(document).toLowerCase();

    if (serializedDocument.includes('acfos')) {
      errors.push(
        `${prefix} Legacy ACFOS terminology detected. Use TITech terminology.`
      );
    }
  }

  return Object.freeze({
    valid: errors.length === 0,

    documentCount: LEGAL_DOCUMENTS.length,

    publishedCount:
      getPublishedLegalDocuments().length,

    acceptanceRequiredCount:
      getAcceptanceRequiredDocuments().length,

    errors: Object.freeze([...errors]),

    warnings: Object.freeze([...warnings]),
  });
}

/* ============================================================================
 * Development-time integrity assertion
 *
 * The registry remains available even when validation fails so that tooling
 * and diagnostics can report all problems. Production builds do not emit
 * console diagnostics from this module.
 * ========================================================================== */

if (
  typeof process !== 'undefined' &&
  process.env &&
  process.env.NODE_ENV !== 'production'
) {
  const registryValidation = validateLegalRegistry();

  if (!registryValidation.valid) {
    console.error(
      '[TITech Legal Registry] Registry validation failed:',
      registryValidation.errors
    );
  }

  if (registryValidation.warnings.length > 0) {
    console.warn(
      '[TITech Legal Registry] Registry warnings:',
      registryValidation.warnings
    );
  }
}

/* ============================================================================
 * Default export
 * ========================================================================== */

export default LEGAL_DOCUMENTS;