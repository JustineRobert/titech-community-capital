/**

* ============================================================================
* TITech Community Capital Ltd
* Enterprise Legal Module — Public API
* ============================================================================
*
* File:
* frontend/src/legal/index.js
*
* Version:
* 2.0.0
*
* Purpose:
* Centralized public API / barrel export for the TITech Community Capital
* legal-document module.
*
* Architecture:
*
* legal/
* ├── index.js                    ← Public API / barrel
* ├── legalRegistry.js            ← Document registry
* ├── legalTypes.js               ← Runtime types / validation
* ├── legalConfig.js              ← Central legal configuration
* ├── legalConstants.js           ← Shared legal constants
* ├── legalApi.js                 ← Legal API integration
* ├── legalAcceptance.js          ← Acceptance / consent state
* ├── legalRoutes.js              ← Legal route definitions
* ├── legalUtils.js               ← Pure legal utilities
* ├── LegalPages.jsx              ← Legal page shell
* ├── PrivacyPolicy.jsx            ← Public privacy page
* ├── TermsOfService.jsx           ← Public terms page
* ├── Disclaimer.jsx               ← Public disclaimer page
* └── documents/
* ```
    ├── PrivacyPolicy.jsx
  ```
* ```
    ├── TermsOfService.jsx
  ```
* ```
    ├── GeneralDisclaimer.jsx
  ```
* ```
    └── FinancialDisclaimer.jsx
  ```
*
* Design Principles:
* ✓ Single public import surface
* ✓ Explicit named exports
* ✓ No wildcard exports
* ✓ No substantive legal content in this module
* ✓ Backward-compatible registry exports
* ✓ Centralized legal configuration
* ✓ Runtime validation support
* ✓ Version-aware document handling
* ✓ Publication-state helpers
* ✓ Acceptance-state helpers
* ✓ Legal-date formatting helpers
* ✓ API integration support
* ✓ Route integration support
* ✓ Suitable for CMS/API migration
* ✓ Suitable for automated compliance validation
* ✓ Suitable for enterprise testing
* ✓ TITech terminology consistency
* ✓ No ACFOS terminology
*
* Important:
* This module is intentionally an API boundary.
*
* It should expose stable, application-facing contracts while keeping
* implementation details inside their respective modules.
*
* This module does NOT determine whether TITech Community Capital Ltd is
* licensed, authorized, regulated, or legally permitted to perform any
* regulated financial activity.
*
* Legal documents must be reviewed and approved by appropriately qualified
* legal counsel before production publication.
*
* ============================================================================
  */

'use strict';

/**

* ============================================================================
* LEGAL REGISTRY
* ============================================================================
*
* The registry represents the application's authoritative catalogue of legal
* documents.
*
* Substantive legal wording must remain outside this barrel module.
  */
  export {
  default as LEGAL_DOCUMENTS,

// --------------------------------------------------------------------------
// Document lifecycle/status
// --------------------------------------------------------------------------
LEGAL_STATUS,

// --------------------------------------------------------------------------
// Document classification
// --------------------------------------------------------------------------
LEGAL_CATEGORY,

// --------------------------------------------------------------------------
// Intended audience
// --------------------------------------------------------------------------
LEGAL_AUDIENCE,

// --------------------------------------------------------------------------
// Registry lookup helpers
// --------------------------------------------------------------------------
getLegalDocumentById,
getLegalDocumentBySlug,

// --------------------------------------------------------------------------
// Publication helpers
// --------------------------------------------------------------------------
getPublishedLegalDocuments,
getPublicLegalDocuments,

// --------------------------------------------------------------------------
// Acceptance/compliance helpers
// --------------------------------------------------------------------------
getAcceptanceRequiredDocuments,

// --------------------------------------------------------------------------
// Filtering helpers
// --------------------------------------------------------------------------
getLegalDocumentsByCategory,
getLegalDocumentsByAudience,
} from './legalRegistry';

/**

* ============================================================================
* LEGAL DOCUMENT TYPES & VALIDATION
* ============================================================================
*
* Runtime validation protects the application from malformed legal-document
* metadata and registry configuration.
*
* These helpers are appropriate for:
*
* * development validation
* * unit/integration tests
* * startup validation
* * CI/CD checks
* * publishing workflows
* * CMS/API adapters
* * administrative tooling
    */
    export {
    REQUIRED_LEGAL_DOCUMENT_FIELDS,
    isValidLegalDocument,
    assertLegalDocument,
    validateLegalRegistry,
    } from './legalTypes';

/**

* ============================================================================
* LEGAL CONFIGURATION
* ============================================================================
*
* Central configuration for the legal subsystem.
*
* Keep organization identity, legal contact information, versioning defaults,
* route configuration and other application-level legal settings centralized.
*
* Do NOT place substantive legal wording in legalConfig.js.
  */
  export {
  LEGAL_CONFIG,
  LEGAL_CONTACT,
  LEGAL_ORGANIZATION,
  LEGAL_DEFAULTS,
  } from './legalConfig';

/**

* ============================================================================
* LEGAL CONSTANTS
* ============================================================================
*
* Shared constants used across the legal subsystem.
*
* Export only stable application-level constants intended for consumers.
  */
  export {
  LEGAL_MODULE_VERSION,
  LEGAL_DOCUMENT_TYPES,
  LEGAL_DOCUMENT_IDS,
  LEGAL_DOCUMENT_SLUGS,
  LEGAL_DOCUMENT_ROUTES,
  LEGAL_ACCEPTANCE_TYPES,
  LEGAL_ACCEPTANCE_STATUS,
  } from './legalConstants';

/**

* ============================================================================
* LEGAL UTILITIES
* ============================================================================
*
* Pure helpers for normalization, validation, state evaluation and legal-date
* formatting.
  */
  export {
  validateLegalConfiguration,
  normalizeLegalVersion,
  isPublishedDocument,
  isAcceptanceRequired,
  formatLegalDate,
  } from './legalUtils';

/**

* ============================================================================
* LEGAL ACCEPTANCE
* ============================================================================
*
* Acceptance helpers provide the presentation/application layer with a
* consistent interface for determining and recording legal acceptance state.
*
* These helpers must not be treated as a substitute for backend audit
* persistence or legally required consent records.
  */
  export {
  getLegalAcceptanceState,
  hasAcceptedLegalDocument,
  requiresLegalAcceptance,
  createLegalAcceptancePayload,
  normalizeLegalAcceptance,
  } from './legalAcceptance';

/**

* ============================================================================
* LEGAL API
* ============================================================================
*
* API helpers provide a controlled integration boundary between the frontend
* legal module and future/current backend legal-document services.
*
* The frontend must never treat API responses as trusted merely because they
* originated from the application backend. Responses should be validated
* before use.
  */
  export {
  fetchLegalDocument,
  fetchLegalDocuments,
  fetchPublishedLegalDocuments,
  fetchLegalDocumentBySlug,
  submitLegalAcceptance,
  } from './legalApi';

/**

* ============================================================================
* LEGAL ROUTES
* ============================================================================
*
* Route definitions are exposed centrally so the application router does not
* need to depend directly on implementation files.
  */
  export {
  LEGAL_ROUTES,
  getLegalRoute,
  getLegalRouteBySlug,
  isLegalRoute,
  } from './legalRoutes';

/**

* ============================================================================
* PUBLIC MODULE CONTRACT
* ============================================================================
*
* Preferred application usage:
*
* import {
* 
  LEGAL_DOCUMENTS,
  
* 
  LEGAL_STATUS,
  
* 
  LEGAL_CATEGORY,
  
* 
  LEGAL_AUDIENCE,
  
* 
  LEGAL_CONFIG,
  
* 
  LEGAL_CONTACT,
  
*
  LEGAL_ORGANIZATION,
  
* 
  LEGAL_DEFAULTS,
  
* 
  LEGAL_MODULE_VERSION,
  
* 
  LEGAL_DOCUMENT_TYPES,
  
* 
  LEGAL_DOCUMENT_IDS,
  
* 
  LEGAL_DOCUMENT_SLUGS,
  
* 
  LEGAL_DOCUMENT_ROUTES,
  
* 
  LEGAL_ACCEPTANCE_TYPES,
  
* 
  LEGAL_ACCEPTANCE_STATUS,
  
* 
  getLegalDocumentById,
  
* 
  getLegalDocumentBySlug,
  
* 
  getPublishedLegalDocuments,
  
* 
  getPublicLegalDocuments,
  
* 
  getAcceptanceRequiredDocuments,
  
* 
  getLegalDocumentsByCategory,
  
* 
  getLegalDocumentsByAudience,
  
* 
  REQUIRED_LEGAL_DOCUMENT_FIELDS,

* 
  isValidLegalDocument,
  
* 
  assertLegalDocument,
  
* 
  validateLegalRegistry,
  
* 
  validateLegalConfiguration,
  
* 
  normalizeLegalVersion,
  
* 
  isPublishedDocument,
  
* 
  isAcceptanceRequired,
  
* 
  formatLegalDate,
  
* 
  getLegalAcceptanceState,
  
* 
  hasAcceptedLegalDocument,
  
* 
  requiresLegalAcceptance,
  
* 
  createLegalAcceptancePayload,
  
*
  normalizeLegalAcceptance,
  
* 
  fetchLegalDocument,
  
* 
  fetchLegalDocuments,
  
* 
  fetchPublishedLegalDocuments,
  
* 
  fetchLegalDocumentBySlug,
  
* 
  submitLegalAcceptance,
  
* 
  LEGAL_ROUTES,
  
* 
  getLegalRoute,
  
* 
  getLegalRouteBySlug,
  
* 
  isLegalRoute,
  
* } from '../legal';
*
* ============================================================================
* ARCHITECTURAL RULES
* ============================================================================
*
* 1. Prefer importing from:
*
* 
   import { ... } from '../legal';
  
*
* rather than importing implementation files directly.
*
*
* 2. Do not add substantive legal wording here.
*
* Legal content belongs in:
*
*
   legal/documents/
  
*
*
* 3. Do not add React page implementations here.
*
* Presentation belongs in:
*
* ```
   PrivacyPolicy.jsx
  ```
* ```
   TermsOfService.jsx
  ```
* ```
   Disclaimer.jsx
  ```
* ```
   LegalPages.jsx
  ```
*
*
* 4. Do not expose internal implementation helpers unless they are part of
* the deliberate public module contract.
*
*
* 5. Do not use wildcard exports:
*
* ```
   export * from './module';
  ```
*
* Explicit exports make breaking changes easier to detect and prevent
* accidental leakage of internal implementation details.
*
*
* 6. Do not duplicate legal metadata unnecessarily.
*
* The centralized configuration/registry should remain authoritative.
*
*
* 7. Acceptance state must not be treated as legal proof solely because a
* frontend helper returns true.
*
* Production acceptance records should ultimately be persisted and
* validated by the backend with appropriate audit information.
*
*
* 8. Frontend legal content should never contain secrets, credentials,
* private API keys or privileged configuration.
*
*
* 9. Legacy ACFOS terminology must not be introduced.
*
* The canonical platform identity is:
*
* 
   TITech Community Capital
  
*
*
* 10. Changes to exported names are API changes.
*
* 
  Update dependent consumers and tests before removing or renaming an
  
* 
  existing public export.
  
*
* ============================================================================
* COMPATIBILITY CONTRACT
* ============================================================================
*
* Existing consumers using the original public exports remain supported:
*
* LEGAL_DOCUMENTS
* LEGAL_STATUS
* LEGAL_CATEGORY
* LEGAL_AUDIENCE
* getLegalDocumentById
* getLegalDocumentBySlug
* getPublishedLegalDocuments
* getPublicLegalDocuments
* getAcceptanceRequiredDocuments
* getLegalDocumentsByCategory
* getLegalDocumentsByAudience
* REQUIRED_LEGAL_DOCUMENT_FIELDS
* isValidLegalDocument
* assertLegalDocument
* validateLegalRegistry
* validateLegalConfiguration
* normalizeLegalVersion
* isPublishedDocument
* isAcceptanceRequired
* formatLegalDate
*
* New exports extend the public API without replacing those existing
* contracts.
*
* ============================================================================
* ENTERPRISE VALIDATION EXPECTATIONS
* ============================================================================
*
* CI/CD should validate that:
*
* ✓ Every registry document has required metadata.
* ✓ Every public document has a valid slug.
* ✓ Every public route resolves to a known document.
* ✓ Published documents have valid versions.
* ✓ Acceptance-required documents are explicitly marked.
* ✓ Legal routes do not expose unpublished documents.
* ✓ No duplicate document IDs exist.
* ✓ No duplicate document slugs exist.
* ✓ No duplicate public routes exist.
* ✓ Legal configuration is internally consistent.
* ✓ Legacy ACFOS references are absent from production legal metadata.
* ✓ Contact information matches the approved legal configuration.
*
* ============================================================================
* END OF FILE
* ============================================================================
  */
