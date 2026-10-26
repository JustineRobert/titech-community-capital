/**
 * Canonical legal-content facade for the frontend.
 *
 * The public legal pages consume shared/legal/legalDocuments.json. The backend
 * reads its release metadata to fail closed, but canonical legal-acceptance
 * persistence is not yet integrated; production registration stays disabled.
 * Keep status as "draft" until corporate details, actual data practices,
 * technical controls and legal approvals are evidenced in the release gate.
 */
import canonicalLegalContent from '../../../shared/legal/legalDocuments.json';

export const LEGAL_DOCUMENT_VERSION = canonicalLegalContent.version;
export const LEGAL_PUBLICATION_STATUS = canonicalLegalContent.status;
export const LEGAL_LAST_REVIEWED = canonicalLegalContent.lastReviewed;
export const LEGAL_DOCUMENTS = Object.freeze(canonicalLegalContent.documents);
