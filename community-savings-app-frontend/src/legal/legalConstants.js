/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Legal System Constants
 * ============================================================================
 *
 * File:
 *   frontend/src/legal/legalConstants.js
 *
 * Version:
 *   2.0.0
 *
 * Purpose:
 *   Centralized immutable constants for the TITech Community Capital legal
 *   document, consent, compliance, audit and presentation subsystems.
 *
 * Architecture:
 *
 *   legalConstants.js
 *          │
 *          ├── Stable enums
 *          ├── Storage keys
 *          ├── API conventions
 *          ├── Event names
 *          ├── UI constants
 *          ├── Compliance constants
 *          └── Validation limits
 *                    │
 *                    ▼
 *   legalConfig.js
 *          │
 *          └── Document registry / metadata
 *                    │
 *                    ▼
 *   legalTypes.js
 *          │
 *          └── Runtime contracts / validation
 *                    │
 *                    ▼
 *   legalApi.js
 *          │
 *          └── API transport
 *                    │
 *                    ▼
 *   legalAcceptance.js
 *          │
 *          └── Consent / acceptance lifecycle
 *
 * Design Principles:
 *   - Single source of truth for stable legal-system constants.
 *   - Immutable exported values.
 *   - No secrets.
 *   - No user credentials.
 *   - No environment-specific secrets.
 *   - Browser-safe.
 *   - API-safe.
 *   - Enterprise extensibility.
 *   - Accessibility-aware.
 *   - Audit-friendly.
 *   - Backward-compatible naming where practical.
 *
 * IMPORTANT:
 *   This file contains configuration constants, NOT legal advice.
 *
 * Branding:
 *   TITech Community Capital
 *
 * ============================================================================
 */

'use strict';

/* ============================================================================
 * SYSTEM IDENTITY
 * ========================================================================== */

export const LEGAL_SYSTEM = Object.freeze({
  NAME: 'TITech Community Capital Legal System',

  SHORT_NAME: 'TITech Legal',

  VERSION: '2.0.0',

  ORGANIZATION:
    'TITech Community Capital Ltd',

  BRAND:
    'TITech Community Capital',

  PLATFORM:
    'TITech Community Capital',

  JURISDICTION:
    'Uganda',

  COUNTRY_CODE:
    'UG',

  DEFAULT_LOCALE:
    'en-UG',

  DEFAULT_LANGUAGE:
    'en',

  TIMEZONE:
    'Africa/Kampala',
});

/* ============================================================================
 * APPLICATION ENVIRONMENTS
 * ========================================================================== */

export const LEGAL_ENVIRONMENTS =
  Object.freeze({
    DEVELOPMENT: 'development',

    TEST: 'test',

    STAGING: 'staging',

    PRODUCTION: 'production',
  });

/* ============================================================================
 * DOCUMENT TYPES
 * ========================================================================== */

export const LEGAL_DOCUMENT_TYPES =
  Object.freeze({
    TERMS_OF_SERVICE:
      'terms-of-service',

    PRIVACY_POLICY:
      'privacy-policy',

    DISCLAIMER:
      'disclaimer',

    COOKIE_POLICY:
      'cookie-policy',

    DATA_PROCESSING_AGREEMENT:
      'data-processing-agreement',

    COMMUNITY_GUIDELINES:
      'community-guidelines',

    ACCEPTABLE_USE_POLICY:
      'acceptable-use-policy',

    ELECTRONIC_COMMUNICATIONS:
      'electronic-communications',

    THIRD_PARTY_TERMS:
      'third-party-terms',

    FINANCIAL_SERVICES_DISCLOSURE:
      'financial-services-disclosure',

    RISK_DISCLOSURE:
      'risk-disclosure',
  });

/* ============================================================================
 * DOCUMENT LIFECYCLE STATUS
 * ========================================================================== */

export const LEGAL_DOCUMENT_STATUS =
  Object.freeze({
    DRAFT: 'draft',

    REVIEW:
      'review',

    PENDING_APPROVAL:
      'pending_approval',

    APPROVED:
      'approved',

    ACTIVE:
      'active',

    SUPERSEDED:
      'superseded',

    ARCHIVED:
      'archived',

    DEPRECATED:
      'deprecated',

    REJECTED:
      'rejected',
  });

/* ============================================================================
 * DOCUMENT VISIBILITY
 * ========================================================================== */

export const LEGAL_DOCUMENT_VISIBILITY =
  Object.freeze({
    PUBLIC:
      'public',

    AUTHENTICATED:
      'authenticated',

    TENANT:
      'tenant',

    ADMIN:
      'admin',

    INTERNAL:
      'internal',
  });

/* ============================================================================
 * DOCUMENT CLASSIFICATION
 * ========================================================================== */

export const LEGAL_DOCUMENT_CLASSIFICATION =
  Object.freeze({
    MANDATORY:
      'mandatory',

    REQUIRED:
      'required',

    OPTIONAL:
      'optional',

    INFORMATIONAL:
      'informational',

    REGULATORY:
      'regulatory',

    CONTRACTUAL:
      'contractual',

    PRIVACY:
      'privacy',

    SECURITY:
      'security',

    FINANCIAL:
      'financial',
  });

/* ============================================================================
 * LEGAL VERSIONING
 * ========================================================================== */

export const LEGAL_VERSIONING =
  Object.freeze({
    CURRENT_VERSION:
      '1.0',

    VERSION_SEPARATOR:
      '.',

    VERSION_PATTERN:
      /^\d+\.\d+(?:\.\d+)?$/,

    DATE_FORMAT:
      'YYYY-MM-DD',

    DISPLAY_DATE_FORMAT:
      'MMMM D, YYYY',

    ISO_DATE_FORMAT:
      'YYYY-MM-DD',

    ISO_DATETIME_FORMAT:
      'YYYY-MM-DDTHH:mm:ss.sssZ',
  });

/* ============================================================================
 * LEGAL ACCEPTANCE TYPES
 * ========================================================================== */

export const LEGAL_ACCEPTANCE_TYPES =
  Object.freeze({
    INITIAL:
      'initial',

    UPDATED_TERMS:
      'updated-terms',

    UPDATED_PRIVACY:
      'updated-privacy',

    UPDATED_DISCLAIMER:
      'updated-disclaimer',

    UPDATED_POLICY:
      'updated-policy',

    RE_ACCEPTANCE:
      're-acceptance',

    EXPLICIT_CONSENT:
      'explicit-consent',

    CONTINUED_USE:
      'continued-use',

    ADMINISTRATIVE:
      'administrative',
  });

/* ============================================================================
 * ACCEPTANCE STATUS
 * ========================================================================== */

export const LEGAL_ACCEPTANCE_STATUS =
  Object.freeze({
    ACCEPTED:
      'accepted',

    PENDING:
      'pending',

    REQUIRES_REACCEPTANCE:
      'requires_reacceptance',

    REVOKED:
      'revoked',

    EXPIRED:
      'expired',

    SUPERSEDED:
      'superseded',

    REJECTED:
      'rejected',

    FAILED:
      'failed',
  });

/* ============================================================================
 * CONSENT STATUS
 * ========================================================================== */

export const LEGAL_CONSENT_STATUS =
  Object.freeze({
    GRANTED:
      'granted',

    DENIED:
      'denied',

    WITHDRAWN:
      'withdrawn',

    PENDING:
      'pending',

    NOT_REQUIRED:
      'not_required',

    UNKNOWN:
      'unknown',
  });

/* ============================================================================
 * CONSENT SCOPE
 * ========================================================================== */

export const LEGAL_CONSENT_SCOPE =
  Object.freeze({
    TERMS_OF_SERVICE:
      'terms_of_service',

    PRIVACY_POLICY:
      'privacy_policy',

    DISCLAIMER:
      'disclaimer',

    COOKIE_POLICY:
      'cookie_policy',

    MARKETING:
      'marketing',

    ANALYTICS:
      'analytics',

    COMMUNICATIONS:
      'communications',

    DATA_PROCESSING:
      'data_processing',

    ALL_REQUIRED:
      'all_required',
  });

/* ============================================================================
 * CONSENT CATEGORIES
 * ========================================================================== */

export const LEGAL_CONSENT_CATEGORIES =
  Object.freeze({
    STRICTLY_NECESSARY:
      'strictly_necessary',

    FUNCTIONAL:
      'functional',

    ANALYTICS:
      'analytics',

    MARKETING:
      'marketing',

    PERSONALIZATION:
      'personalization',

    DATA_PROCESSING:
      'data_processing',
  });

/* ============================================================================
 * LEGAL AUDIT EVENTS
 * ========================================================================== */

export const LEGAL_AUDIT_EVENTS =
  Object.freeze({
    DOCUMENT_VIEWED:
      'legal.document.viewed',

    DOCUMENT_OPENED:
      'legal.document.opened',

    DOCUMENT_DOWNLOADED:
      'legal.document.downloaded',

    DOCUMENT_PRINTED:
      'legal.document.printed',

    DOCUMENT_LINK_COPIED:
      'legal.document.link_copied',

    ACCEPTANCE_STARTED:
      'legal.acceptance.started',

    ACCEPTANCE_SUBMITTED:
      'legal.acceptance.submitted',

    ACCEPTANCE_CONFIRMED:
      'legal.acceptance.confirmed',

    ACCEPTANCE_FAILED:
      'legal.acceptance.failed',

    ACCEPTANCE_REQUIRES_REACCEPTANCE:
      'legal.acceptance.requires_reacceptance',

    CONSENT_GRANTED:
      'legal.consent.granted',

    CONSENT_DENIED:
      'legal.consent.denied',

    CONSENT_WITHDRAWN:
      'legal.consent.withdrawn',

    VERSION_CHANGED:
      'legal.document.version_changed',

    DOCUMENT_SUPERSEDED:
      'legal.document.superseded',
  });

/* ============================================================================
 * LEGAL AUDIT SOURCES
 * ========================================================================== */

export const LEGAL_AUDIT_SOURCES =
  Object.freeze({
    WEB:
      'titech-web',

    MOBILE:
      'titech-mobile',

    API:
      'titech-api',

    ADMIN:
      'titech-admin',

    SYSTEM:
      'titech-system',

    IMPORT:
      'titech-import',

    MIGRATION:
      'titech-migration',
  });

/* ============================================================================
 * API CONFIGURATION
 * ========================================================================== */

export const LEGAL_API =
  Object.freeze({
    VERSION:
      '2',

    PREFIX:
      '/legal',

    DOCUMENTS_PATH:
      '/legal',

    ACCEPTANCE_PATH:
      '/legal/acceptance',

    ACCEPTANCE_HISTORY_PATH:
      '/legal/acceptance/history',

    HEALTH_PATH:
      '/legal/health',

    METADATA_PATH:
      '/metadata',

    SECTIONS_PATH:
      '/sections',

    DEFAULT_TIMEOUT_MS:
      15_000,

    DEFAULT_RETRY_COUNT:
      2,

    DEFAULT_RETRY_DELAY_MS:
      350,

    CACHE_TTL_MS:
      5 * 60 * 1000,

    MAX_RESPONSE_SIZE:
      5 * 1024 * 1024,
  });

/* ============================================================================
 * HTTP METHODS
 * ========================================================================== */

export const LEGAL_HTTP_METHODS =
  Object.freeze({
    GET:
      'GET',

    POST:
      'POST',

    PUT:
      'PUT',

    PATCH:
      'PATCH',

    DELETE:
      'DELETE',
  });

/* ============================================================================
 * HTTP STATUS CATEGORIES
 * ========================================================================== */

export const LEGAL_HTTP_STATUS =
  Object.freeze({
    OK:
      200,

    CREATED:
      201,

    ACCEPTED:
      202,

    NO_CONTENT:
      204,

    BAD_REQUEST:
      400,

    UNAUTHORIZED:
      401,

    FORBIDDEN:
      403,

    NOT_FOUND:
      404,

    CONFLICT:
      409,

    UNPROCESSABLE_ENTITY:
      422,

    TOO_MANY_REQUESTS:
      429,

    INTERNAL_SERVER_ERROR:
      500,

    BAD_GATEWAY:
      502,

    SERVICE_UNAVAILABLE:
      503,

    GATEWAY_TIMEOUT:
      504,
  });

/* ============================================================================
 * API ERROR CODES
 * ========================================================================== */

export const LEGAL_API_ERROR_CODES =
  Object.freeze({
    INVALID_ARGUMENT:
      'INVALID_ARGUMENT',

    INVALID_DOCUMENT:
      'INVALID_DOCUMENT',

    INVALID_RESPONSE:
      'INVALID_RESPONSE',

    VALIDATION_FAILED:
      'VALIDATION_FAILED',

    NETWORK_ERROR:
      'NETWORK_ERROR',

    TIMEOUT:
      'TIMEOUT',

    ABORTED:
      'ABORTED',

    HTTP_ERROR:
      'HTTP_ERROR',

    NOT_FOUND:
      'NOT_FOUND',

    UNAUTHORIZED:
      'UNAUTHORIZED',

    FORBIDDEN:
      'FORBIDDEN',

    RATE_LIMITED:
      'RATE_LIMITED',

    SERVER_ERROR:
      'SERVER_ERROR',

    CONFLICT:
      'CONFLICT',

    CONFIGURATION_ERROR:
      'CONFIGURATION_ERROR',

    UNKNOWN:
      'UNKNOWN',
  });

/* ============================================================================
 * ACCEPTANCE ERROR CODES
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
 * STORAGE KEYS
 * ========================================================================== */

export const LEGAL_STORAGE_KEYS =
  Object.freeze({
    ACCEPTANCE:
      'titech:legal:acceptance:v2',

    CONSENT:
      'titech:legal:consent:v2',

    PREFERENCES:
      'titech:legal:preferences:v2',

    LAST_VIEWED:
      'titech:legal:last-viewed:v2',

    DISMISSED_NOTICE:
      'titech:legal:dismissed-notice:v2',

    VERSION_CACHE:
      'titech:legal:version-cache:v2',
  });

/* ============================================================================
 * STORAGE POLICIES
 * ========================================================================== */

export const LEGAL_STORAGE_POLICY =
  Object.freeze({
    ACCEPTANCE_TTL_MS:
      180 * 24 * 60 * 60 * 1000,

    CONSENT_TTL_MS:
      365 * 24 * 60 * 60 * 1000,

    MAX_ACCEPTANCE_HISTORY:
      100,

    MAX_VIEW_HISTORY:
      50,

    MAX_STORAGE_RECORD_SIZE:
      512 * 1024,

    USE_LOCAL_STORAGE:
      true,

    USE_SESSION_STORAGE:
      false,

    AUTHORITATIVE_STORAGE:
      'server',
  });

/* ============================================================================
 * IDEMPOTENCY
 * ========================================================================== */

export const LEGAL_IDEMPOTENCY =
  Object.freeze({
    HEADER:
      'Idempotency-Key',

    PREFIX:
      'titech-legal',

    MAX_LENGTH:
      255,

    REQUIRED_FOR_ACCEPTANCE:
      true,
  });

/* ============================================================================
 * SECURITY HEADERS
 * ========================================================================== */

export const LEGAL_SECURITY_HEADERS =
  Object.freeze({
    CLIENT:
      'TITech-Community-Capital-Web',

    API_VERSION:
      'X-Legal-API-Version',

    REQUEST_ID:
      'X-Request-ID',

    CLIENT_HEADER:
      'X-Client',

    IDEMPOTENCY:
      'Idempotency-Key',

    ACCEPT:
      'Accept',

    CONTENT_TYPE:
      'Content-Type',
  });

/* ============================================================================
 * CONTENT TYPES
 * ========================================================================== */

export const LEGAL_CONTENT_TYPES =
  Object.freeze({
    JSON:
      'application/json',

    HTML:
      'text/html',

    TEXT:
      'text/plain',

    PDF:
      'application/pdf',

    PDF_DOCUMENT:
      'application/pdf; charset=utf-8',
  });

/* ============================================================================
 * CACHE POLICIES
 * ========================================================================== */

export const LEGAL_CACHE_POLICIES =
  Object.freeze({
    NO_CACHE:
      'no-cache',

    CACHE_FIRST:
      'cache-first',

    NETWORK_FIRST:
      'network-first',

    STALE_WHILE_REVALIDATE:
      'stale-while-revalidate',

    NETWORK_ONLY:
      'network-only',
  });

/* ============================================================================
 * DEFAULT CACHE CONTROL
 * ========================================================================== */

export const LEGAL_CACHE_CONTROL =
  Object.freeze({
    DEFAULT:
      LEGAL_CACHE_POLICIES
        .STALE_WHILE_REVALIDATE,

    DOCUMENTS:
      LEGAL_CACHE_POLICIES
        .NETWORK_FIRST,

    METADATA:
      LEGAL_CACHE_POLICIES
        .STALE_WHILE_REVALIDATE,

    ACCEPTANCE:
      LEGAL_CACHE_POLICIES
        .NETWORK_ONLY,
  });

/* ============================================================================
 * UI CONSTANTS
 * ========================================================================== */

export const LEGAL_UI =
  Object.freeze({
    DEFAULT_SCROLL_OFFSET:
      96,

    HEADER_OFFSET:
      96,

    TOC_BREAKPOINT_PX:
      1024,

    MOBILE_BREAKPOINT_PX:
      768,

    TABLET_BREAKPOINT_PX:
      1024,

    MAX_CONTENT_WIDTH_PX:
      1200,

    MAX_TEXT_WIDTH_PX:
      900,

    TOC_MAX_WIDTH_PX:
      320,

    BACK_TO_TOP_THRESHOLD_PX:
      500,

    SCROLL_BEHAVIOR:
      'smooth',

    DEFAULT_PAGE_SIZE:
      20,

    MAX_PAGE_SIZE:
      100,

    SHOW_TABLE_OF_CONTENTS:
      true,

    SHOW_LAST_UPDATED:
      true,

    SHOW_VERSION:
      true,

    SHOW_EFFECTIVE_DATE:
      true,

    SHOW_PRINT_BUTTON:
      true,

    SHOW_COPY_LINK:
      true,

    SHOW_BACK_TO_TOP:
      true,
  });

/* ============================================================================
 * ACCESSIBILITY
 * ========================================================================== */

export const LEGAL_ACCESSIBILITY =
  Object.freeze({
    DEFAULT_LANGUAGE:
      'en',

    NAVIGATION_ROLE:
      'navigation',

    MAIN_ROLE:
      'main',

    COMPLEMENTARY_ROLE:
      'complementary',

    CONTENT_ROLE:
      'article',

    LIVE_REGION_ROLE:
      'status',

    DEFAULT_ARIA_LIVE:
      'polite',

    ERROR_ARIA_LIVE:
      'assertive',

    FOCUS_SECTION_ON_HASH:
      true,

    PRESERVE_FOCUS_ON_NAVIGATION:
      true,

    REDUCED_MOTION_RESPECTED:
      true,

    MINIMUM_TOUCH_TARGET_PX:
      44,
  });

/* ============================================================================
 * SEO
 * ========================================================================== */

export const LEGAL_SEO =
  Object.freeze({
    ROBOTS:
      'index,follow',

    TYPE:
      'website',

    LOCALE:
      'en_UG',

    SITE_NAME:
      'TITech Community Capital',

    TITLE_SUFFIX:
      ' | TITech Community Capital',

    CANONICAL_PREFIX:
      '/legal',

    DEFAULT_DESCRIPTION:
      'Legal information, terms, privacy policies and disclosures for TITech Community Capital.',
  });

/* ============================================================================
 * CONTACT TYPES
 * ========================================================================== */

export const LEGAL_CONTACT_TYPES =
  Object.freeze({
    LEGAL:
      'legal',

    PRIVACY:
      'privacy',

    DATA_PROTECTION:
      'data-protection',

    GENERAL:
      'general',

    SECURITY:
      'security',

    COMPLIANCE:
      'compliance',
  });

/* ============================================================================
 * JURISDICTION
 * ========================================================================== */

export const LEGAL_JURISDICTION =
  Object.freeze({
    COUNTRY:
      'Uganda',

    COUNTRY_CODE:
      'UG',

    LOCALE:
      'en-UG',

    TIMEZONE:
      'Africa/Kampala',

    DEFAULT_CURRENCY:
      'UGX',

    DEFAULT_LANGUAGE:
      'English',
  });

/* ============================================================================
 * COMPLIANCE CATEGORIES
 * ========================================================================== */

export const LEGAL_COMPLIANCE =
  Object.freeze({
    DATA_PROTECTION:
      'data-protection',

    PRIVACY:
      'privacy',

    CONSUMER_PROTECTION:
      'consumer-protection',

    ELECTRONIC_TRANSACTIONS:
      'electronic-transactions',

    CYBER_SECURITY:
      'cyber-security',

    FINANCIAL_SERVICES:
      'financial-services',

    AML:
      'anti-money-laundering',

    KYC:
      'know-your-customer',

    RECORD_RETENTION:
      'record-retention',

    AUDIT:
      'audit',

    GOVERNANCE:
      'governance',
  });

/* ============================================================================
 * RISK CLASSIFICATION
 * ========================================================================== */

export const LEGAL_RISK_LEVELS =
  Object.freeze({
    LOW:
      'low',

    MEDIUM:
      'medium',

    HIGH:
      'high',

    CRITICAL:
      'critical',
  });

/* ============================================================================
 * DOCUMENT RISK
 * ========================================================================== */

export const LEGAL_DOCUMENT_RISK =
  Object.freeze({
    TERMS:
      LEGAL_RISK_LEVELS.HIGH,

    PRIVACY:
      LEGAL_RISK_LEVELS.HIGH,

    DISCLAIMER:
      LEGAL_RISK_LEVELS.MEDIUM,

    COOKIE_POLICY:
      LEGAL_RISK_LEVELS.MEDIUM,

    FINANCIAL_DISCLOSURE:
      LEGAL_RISK_LEVELS.CRITICAL,

    REGULATORY:
      LEGAL_RISK_LEVELS.CRITICAL,
  });

/* ============================================================================
 * VALIDATION LIMITS
 * ========================================================================== */

export const LEGAL_VALIDATION_LIMITS =
  Object.freeze({
    MIN_VERSION_LENGTH:
      1,

    MAX_VERSION_LENGTH:
      32,

    MAX_TITLE_LENGTH:
      200,

    MAX_SHORT_TITLE_LENGTH:
      80,

    MAX_DESCRIPTION_LENGTH:
      2_000,

    MAX_SLUG_LENGTH:
      160,

    MAX_SECTION_ID_LENGTH:
      100,

    MAX_SECTION_TITLE_LENGTH:
      200,

    MAX_EMAIL_LENGTH:
      254,

    MAX_PHONE_LENGTH:
      32,

    MAX_DOCUMENT_BODY_LENGTH:
      10_000_000,

    MAX_METADATA_KEYS:
      100,
  });

/* ============================================================================
 * VERSIONING RULES
 * ========================================================================== */

export const LEGAL_VERSIONING_RULES =
  Object.freeze({
    REQUIRE_VERSION:
      true,

    REQUIRE_EFFECTIVE_DATE:
      true,

    REQUIRE_LAST_UPDATED:
      true,

    REQUIRE_DOCUMENT_ID:
      true,

    REQUIRE_DOCUMENT_SLUG:
      true,

    REQUIRE_CONTENT_HASH:
      false,

    REQUIRE_APPROVAL_RECORD:
      true,

    ALLOW_DOWNGRADE:
      false,

    ALLOW_EMPTY_VERSION:
      false,
  });

/* ============================================================================
 * DOCUMENT INTEGRITY
 * ========================================================================== */

export const LEGAL_INTEGRITY =
  Object.freeze({
    HASH_ALGORITHM:
      'SHA-256',

    HASH_ENCODING:
      'hex',

    REQUIRE_HASH_FOR_AUDIT:
      false,

    IMMUTABLE_SERVER_RECORD:
      true,

    CLIENT_RECORD_AUTHORITATIVE:
      false,

    SERVER_TIMESTAMP_AUTHORITATIVE:
      true,
  });

/* ============================================================================
 * REQUIRED DOCUMENTS
 * ========================================================================== */

export const REQUIRED_LEGAL_DOCUMENT_IDS =
  Object.freeze([
    'terms-of-service',
    'privacy-policy',
  ]);

/* ============================================================================
 * ROUTE CONSTANTS
 * ========================================================================== */

export const LEGAL_ROUTES =
  Object.freeze({
    BASE:
      '/legal',

    TERMS:
      '/legal/terms-of-service',

    PRIVACY:
      '/legal/privacy-policy',

    DISCLAIMER:
      '/legal/disclaimer',

    COOKIE_POLICY:
      '/legal/cookie-policy',

    ACCEPTABLE_USE:
      '/legal/acceptable-use',

    FINANCIAL_DISCLOSURE:
      '/legal/financial-services-disclosure',

    RISK_DISCLOSURE:
      '/legal/risk-disclosure',
  });

/* ============================================================================
 * URL FRAGMENT CONFIGURATION
 * ========================================================================== */

export const LEGAL_URL =
  Object.freeze({
    HASH_PREFIX:
      '#',

    SECTION_SEPARATOR:
      '#',

    TRAILING_SLASH:
      false,

    ENCODE_SECTION_IDS:
      true,
  });

/* ============================================================================
 * PRINTING
 * ========================================================================== */

export const LEGAL_PRINT =
  Object.freeze({
    ENABLED:
      true,

    TITLE:
      'TITech Community Capital Legal Document',

    INCLUDE_VERSION:
      true,

    INCLUDE_LAST_UPDATED:
      true,

    INCLUDE_EFFECTIVE_DATE:
      true,

    INCLUDE_CONTACT:
      true,

    INCLUDE_URL:
      true,
  });

/* ============================================================================
 * DOWNLOAD / EXPORT
 * ========================================================================== */

export const LEGAL_EXPORT =
  Object.freeze({
    ENABLED:
      true,

    PDF_ENABLED:
      true,

    PRINT_ENABLED:
      true,

    MAX_EXPORT_SIZE_BYTES:
      10 * 1024 * 1024,

    DEFAULT_FILENAME_PREFIX:
      'titech-community-capital',
  });

/* ============================================================================
 * NOTIFICATION TYPES
 * ========================================================================== */

export const LEGAL_NOTIFICATION_TYPES =
  Object.freeze({
    UPDATED_DOCUMENT:
      'updated_document',

    RE_ACCEPTANCE_REQUIRED:
      're_acceptance_required',

    ACCEPTANCE_CONFIRMED:
      'acceptance_confirmed',

    ACCEPTANCE_FAILED:
      'acceptance_failed',

    CONSENT_UPDATED:
      'consent_updated',

    POLICY_CHANGE:
      'policy_change',
  });

/* ============================================================================
 * FEATURE FLAGS
 * ========================================================================== */

export const LEGAL_FEATURE_FLAGS =
  Object.freeze({
    ENABLE_ACCEPTANCE:
      true,

    ENABLE_ACCEPTANCE_HISTORY:
      true,

    ENABLE_CONSENT_MANAGEMENT:
      true,

    ENABLE_DOCUMENT_DOWNLOAD:
      true,

    ENABLE_PRINT:
      true,

    ENABLE_COPY_LINK:
      true,

    ENABLE_SECTION_NAVIGATION:
      true,

    ENABLE_DOCUMENT_VERSIONING:
      true,

    ENABLE_LOCAL_CACHE:
      true,

    ENABLE_ANALYTICS:
      true,

    ENABLE_DEBUG_LOGGING:
      false,

    ENABLE_DOCUMENT_HASHING:
      false,

    ENABLE_MULTI_JURISDICTION:
      false,

    ENABLE_TENANT_SPECIFIC_POLICIES:
      false,
  });

/* ============================================================================
 * LOGGING
 * ========================================================================== */

export const LEGAL_LOG_LEVELS =
  Object.freeze({
    DEBUG:
      'debug',

    INFO:
      'info',

    WARN:
      'warn',

    ERROR:
      'error',

    AUDIT:
      'audit',
  });

export const LEGAL_LOGGING =
  Object.freeze({
    DEFAULT_LEVEL:
      LEGAL_LOG_LEVELS.INFO,

    ENABLE_DEBUG:
      false,

    INCLUDE_DOCUMENT_ID:
      true,

    INCLUDE_DOCUMENT_VERSION:
      true,

    INCLUDE_USER_ID:
      false,

    INCLUDE_SENSITIVE_DATA:
      false,

    INCLUDE_ACCEPTANCE_CONTENT:
      false,
  });

/* ============================================================================
 * PRIVACY / DATA MINIMIZATION
 * ========================================================================== */

export const LEGAL_PRIVACY =
  Object.freeze({
    DATA_MINIMIZATION:
      true,

    CLIENT_FINGERPRINTING:
      false,

    STORE_RAW_USER_AGENT:
      false,

    STORE_IP_ADDRESS_CLIENT_SIDE:
      false,

    STORE_AUTH_TOKENS:
      false,

    STORE_ACCESS_TOKENS:
      false,

    STORE_REFRESH_TOKENS:
      false,

    STORE_SENSITIVE_DOCUMENT_CONTENT:
      false,

    SEND_ANALYTICS_ACCEPTANCE_CONTENT:
      false,
  });

/* ============================================================================
 * BROWSER SUPPORT
 * ========================================================================== */

export const LEGAL_BROWSER =
  Object.freeze({
    REQUIRE_FETCH:
      true,

    REQUIRE_PROMISE:
      true,

    REQUIRE_ABORT_CONTROLLER:
      false,

    REQUIRE_LOCAL_STORAGE:
      false,

    REQUIRE_CRYPTO_UUID:
      false,

    REQUIRE_URL:
      true,
  });

/* ============================================================================
 * NETWORK POLICY
 * ========================================================================== */

export const LEGAL_NETWORK_POLICY =
  Object.freeze({
    DEFAULT_CREDENTIALS:
      'include',

    ACCEPT:
      'application/json',

    RETRY_GET:
      true,

    RETRY_POST:
      false,

    RETRY_PUT:
      false,

    RETRY_PATCH:
      false,

    RETRY_DELETE:
      false,

    RETRY_ON_429:
      true,

    RETRY_ON_500:
      true,

    RETRY_ON_502:
      true,

    RETRY_ON_503:
      true,

    RETRY_ON_504:
      true,
  });

/* ============================================================================
 * ACCESSIBILITY ANNOUNCEMENTS
 * ========================================================================== */

export const LEGAL_ACCESSIBILITY_MESSAGES =
  Object.freeze({
    DOCUMENT_LOADED:
      'Legal document loaded.',

    SECTION_LOADED:
      'Legal section loaded.',

    ACCEPTANCE_SUBMITTED:
      'Legal acceptance submitted.',

    ACCEPTANCE_CONFIRMED:
      'Legal acceptance confirmed.',

    REACCEPTANCE_REQUIRED:
      'Updated legal terms require your acceptance.',

    ERROR:
      'Unable to load the requested legal information.',
  });

/* ============================================================================
 * DEFAULT EMPTY VALUES
 * ========================================================================== */

export const LEGAL_EMPTY_VALUES =
  Object.freeze({
    DOCUMENT:
      null,

    ACCEPTANCE:
      null,

    ACCEPTANCE_HISTORY:
      Object.freeze([]),

    SECTIONS:
      Object.freeze([]),

    METADATA:
      Object.freeze({}),

    ERRORS:
      Object.freeze([]),
  });

/* ============================================================================
 * LEGAL MODULE IDENTIFIERS
 * ========================================================================== */

export const LEGAL_MODULE_IDS =
  Object.freeze({
    CONFIG:
      'legal-config',

    TYPES:
      'legal-types',

    API:
      'legal-api',

    ACCEPTANCE:
      'legal-acceptance',

    PAGES:
      'legal-pages',

    CONSTANTS:
      'legal-constants',
  });

/* ============================================================================
 * DEPRECATION POLICY
 * ========================================================================== */

export const LEGAL_DEPRECATION =
  Object.freeze({
    WARN_ON_DEPRECATED_DOCUMENT:
      true,

    ALLOW_LEGACY_SLUG_REDIRECT:
      true,

    ALLOW_LEGACY_ID_LOOKUP:
      true,

    LEGACY_CONFIG_VERSION:
      '1.x',

    MIGRATION_NOTICE:
      'This legal document reference has been superseded.',
  });

/* ============================================================================
 * COMPATIBILITY ALIASES
 * ========================================================================== */

/**
 * These aliases make migration easier for components that may have been
 * written against earlier versions of the legal subsystem.
 *
 * Keep aliases only while existing consumers still depend on them.
 */

export const LEGAL_CURRENT_VERSION =
  LEGAL_VERSIONING.CURRENT_VERSION;

export const LEGAL_DEFAULT_LOCALE =
  LEGAL_SYSTEM.DEFAULT_LOCALE;

export const LEGAL_DEFAULT_LANGUAGE =
  LEGAL_SYSTEM.DEFAULT_LANGUAGE;

export const LEGAL_DEFAULT_TIMEZONE =
  LEGAL_SYSTEM.TIMEZONE;

export const LEGAL_API_VERSION =
  LEGAL_API.VERSION;

export const LEGAL_STORAGE_KEY =
  LEGAL_STORAGE_KEYS.ACCEPTANCE;

export const LEGAL_ACCEPTANCE_STORAGE_KEY =
  LEGAL_STORAGE_KEYS.ACCEPTANCE;

export const LEGAL_ACCEPTANCE_TTL_MS =
  LEGAL_STORAGE_POLICY.ACCEPTANCE_TTL_MS;

export const LEGAL_MAX_ACCEPTANCE_HISTORY =
  LEGAL_STORAGE_POLICY.MAX_ACCEPTANCE_HISTORY;

/* ============================================================================
 * FROZEN CONFIGURATION SNAPSHOT
 * ========================================================================== */

const legalConstants = Object.freeze({
  system:
    LEGAL_SYSTEM,

  environments:
    LEGAL_ENVIRONMENTS,

  documentTypes:
    LEGAL_DOCUMENT_TYPES,

  documentStatus:
    LEGAL_DOCUMENT_STATUS,

  documentVisibility:
    LEGAL_DOCUMENT_VISIBILITY,

  documentClassification:
    LEGAL_DOCUMENT_CLASSIFICATION,

  versioning:
    LEGAL_VERSIONING,

  acceptanceTypes:
    LEGAL_ACCEPTANCE_TYPES,

  acceptanceStatus:
    LEGAL_ACCEPTANCE_STATUS,

  consentStatus:
    LEGAL_CONSENT_STATUS,

  consentScope:
    LEGAL_CONSENT_SCOPE,

  consentCategories:
    LEGAL_CONSENT_CATEGORIES,

  auditEvents:
    LEGAL_AUDIT_EVENTS,

  auditSources:
    LEGAL_AUDIT_SOURCES,

  api:
    LEGAL_API,

  httpMethods:
    LEGAL_HTTP_METHODS,

  httpStatus:
    LEGAL_HTTP_STATUS,

  apiErrorCodes:
    LEGAL_API_ERROR_CODES,

  acceptanceErrorCodes:
    LEGAL_ACCEPTANCE_ERROR_CODES,

  storageKeys:
    LEGAL_STORAGE_KEYS,

  storagePolicy:
    LEGAL_STORAGE_POLICY,

  idempotency:
    LEGAL_IDEMPOTENCY,

  securityHeaders:
    LEGAL_SECURITY_HEADERS,

  contentTypes:
    LEGAL_CONTENT_TYPES,

  cachePolicies:
    LEGAL_CACHE_POLICIES,

  cacheControl:
    LEGAL_CACHE_CONTROL,

  ui:
    LEGAL_UI,

  accessibility:
    LEGAL_ACCESSIBILITY,

  seo:
    LEGAL_SEO,

  contactTypes:
    LEGAL_CONTACT_TYPES,

  jurisdiction:
    LEGAL_JURISDICTION,

  compliance:
    LEGAL_COMPLIANCE,

  riskLevels:
    LEGAL_RISK_LEVELS,

  documentRisk:
    LEGAL_DOCUMENT_RISK,

  validationLimits:
    LEGAL_VALIDATION_LIMITS,

  versioningRules:
    LEGAL_VERSIONING_RULES,

  integrity:
    LEGAL_INTEGRITY,

  requiredDocuments:
    REQUIRED_LEGAL_DOCUMENT_IDS,

  routes:
    LEGAL_ROUTES,

  url:
    LEGAL_URL,

  print:
    LEGAL_PRINT,

  export:
    LEGAL_EXPORT,

  notificationTypes:
    LEGAL_NOTIFICATION_TYPES,

  featureFlags:
    LEGAL_FEATURE_FLAGS,

  logLevels:
    LEGAL_LOG_LEVELS,

  logging:
    LEGAL_LOGGING,

  privacy:
    LEGAL_PRIVACY,

  browser:
    LEGAL_BROWSER,

  networkPolicy:
    LEGAL_NETWORK_POLICY,

  accessibilityMessages:
    LEGAL_ACCESSIBILITY_MESSAGES,

  emptyValues:
    LEGAL_EMPTY_VALUES,

  moduleIds:
    LEGAL_MODULE_IDS,

  deprecation:
    LEGAL_DEPRECATION,
});

export default legalConstants;