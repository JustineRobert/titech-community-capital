import { createHash } from 'node:crypto';

export const REVIEW_STATUS = Object.freeze({
  PENDING: 'PENDING_HUMAN_REVIEW',
  ASSIGNED: 'ASSIGNED_TO_REVIEWER',
  IN_REVIEW: 'IN_REVIEW',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  CORRECTED_PENDING: 'CORRECTED_PENDING_REVIEW',
  APPROVED: 'APPROVED_HUMAN',
  REOPENED: 'REOPENED',
  BLOCKED: 'BLOCKED',
});

export const CRITICAL_DOMAINS = Object.freeze([
  'FINANCIAL',
  'LEGAL',
  'PRIVACY',
  'KYC_AML',
  'SAFETY',
  'PAYROLL',
]);

const REVIEWER_REQUIRED_FIELDS = Object.freeze([
  'reviewerRef',
  'qualificationVerificationRef',
]);

export function sha256Text(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function createReviewEntry({
  locale,
  namespace,
  key,
  sourceText,
  targetText,
  criticalDomain = null,
}) {
  if (!['sw', 'fr', 'ar'].includes(locale)) {
    throw new TypeError(`Unsupported target locale: ${locale}`);
  }
  if (!namespace || !key || typeof sourceText !== 'string' || typeof targetText !== 'string') {
    throw new TypeError('A review entry requires namespace, key, sourceText and targetText.');
  }
  if (criticalDomain && !CRITICAL_DOMAINS.includes(criticalDomain)) {
    throw new TypeError(`Unsupported critical domain: ${criticalDomain}`);
  }
  return {
    locale,
    namespace,
    key,
    sourceText,
    targetText,
    sourceHash: sha256Text(sourceText),
    targetHash: sha256Text(targetText),
    criticalDomain,
    status: REVIEW_STATUS.PENDING,
    assignedReviewerRef: null,
    correctionAuthorReviewerRef: null,
    approvals: [],
    history: [],
  };
}

export function validateReviewer(reviewer, locale) {
  if (!reviewer || typeof reviewer !== 'object') {
    throw new TypeError('A verified reviewer profile is required.');
  }
  for (const field of REVIEWER_REQUIRED_FIELDS) {
    if (typeof reviewer[field] !== 'string' || !reviewer[field].trim()) {
      throw new TypeError(`Reviewer profile is missing ${field}.`);
    }
  }
  if (reviewer.active !== true || reviewer.identityVerified !== true || reviewer.qualificationVerified !== true) {
    throw new Error('Reviewer identity and qualification must be human-verified and active.');
  }
  if (!Array.isArray(reviewer.languages) || !reviewer.languages.includes(locale)) {
    throw new Error(`Reviewer is not qualified for locale ${locale}.`);
  }
  if (reviewer.independenceDeclaration !== 'NO_CONFLICT') {
    throw new Error('A current no-conflict independence declaration is required.');
  }
  if (!Array.isArray(reviewer.scopes) || !reviewer.scopes.includes('TRANSLATION_REVIEW')) {
    throw new Error('Reviewer is not approved for translation review.');
  }
  return reviewer;
}

function appendHistory(entry, action, reviewerRef, note, timestamp, evidenceRef = null) {
  return {
    ...entry,
    history: [
      ...entry.history,
      {
        action,
        reviewerRef,
        note: note || null,
        evidenceRef: evidenceRef || null,
        timestamp: new Date(timestamp).toISOString(),
        sourceHash: entry.sourceHash,
        targetHash: entry.targetHash,
      },
    ],
  };
}

export function assignReview(entry, reviewer, { timestamp = new Date(), assignmentRef } = {}) {
  validateReviewer(reviewer, entry.locale);
  if (![REVIEW_STATUS.PENDING, REVIEW_STATUS.REOPENED, REVIEW_STATUS.BLOCKED].includes(entry.status)) {
    throw new Error(`Cannot assign an entry from state ${entry.status}.`);
  }
  if (!assignmentRef || typeof assignmentRef !== 'string') {
    throw new TypeError('An accountable assignment reference is required.');
  }
  const updated = { ...entry, assignedReviewerRef: reviewer.reviewerRef, status: REVIEW_STATUS.ASSIGNED };
  return appendHistory(updated, 'ASSIGNED', reviewer.reviewerRef, 'Assigned for qualified human linguistic review.', timestamp, assignmentRef);
}

export function startReview(entry, reviewer, { timestamp = new Date() } = {}) {
  validateReviewer(reviewer, entry.locale);
  if (entry.status !== REVIEW_STATUS.ASSIGNED || entry.assignedReviewerRef !== reviewer.reviewerRef) {
    throw new Error('Only the assigned, qualified reviewer may start this review.');
  }
  return appendHistory({ ...entry, status: REVIEW_STATUS.IN_REVIEW }, 'REVIEW_STARTED', reviewer.reviewerRef, null, timestamp);
}

export function requestChanges(entry, reviewer, { note, timestamp = new Date() } = {}) {
  validateReviewer(reviewer, entry.locale);
  if (entry.status !== REVIEW_STATUS.IN_REVIEW || entry.assignedReviewerRef !== reviewer.reviewerRef) {
    throw new Error('Only the assigned reviewer may request changes during an active review.');
  }
  if (typeof note !== 'string' || note.trim().length < 8) {
    throw new TypeError('A substantive correction rationale is required.');
  }
  return appendHistory({ ...entry, status: REVIEW_STATUS.CHANGES_REQUESTED }, 'CHANGES_REQUESTED', reviewer.reviewerRef, note.trim(), timestamp);
}

export function submitCorrection(entry, reviewer, { correctedText, rationale, timestamp = new Date() } = {}) {
  validateReviewer(reviewer, entry.locale);
  if (entry.status !== REVIEW_STATUS.CHANGES_REQUESTED || entry.assignedReviewerRef !== reviewer.reviewerRef) {
    throw new Error('A correction can only be submitted by the assigned reviewer after changes were requested.');
  }
  if (typeof correctedText !== 'string' || !correctedText.trim()) {
    throw new TypeError('A non-empty corrected translation is required.');
  }
  if (typeof rationale !== 'string' || rationale.trim().length < 8) {
    throw new TypeError('A correction rationale is required.');
  }
  const updated = {
    ...entry,
    targetText: correctedText,
    targetHash: sha256Text(correctedText),
    status: REVIEW_STATUS.CORRECTED_PENDING,
    correctionAuthorReviewerRef: reviewer.reviewerRef,
    approvals: [],
  };
  return appendHistory(updated, 'CORRECTION_SUBMITTED', reviewer.reviewerRef, rationale.trim(), timestamp);
}

export function approveReview(entry, reviewer, {
  sourceHash = entry.sourceHash,
  targetHash = entry.targetHash,
  evidenceRef,
  domainApprovalRef = null,
  domainApprover = null,
  timestamp = new Date(),
} = {}) {
  validateReviewer(reviewer, entry.locale);
  if (![REVIEW_STATUS.IN_REVIEW, REVIEW_STATUS.CORRECTED_PENDING].includes(entry.status)) {
    throw new Error(`Cannot approve an entry from state ${entry.status}.`);
  }
  if (entry.status === REVIEW_STATUS.IN_REVIEW && entry.approvals.length === 0 && entry.assignedReviewerRef !== reviewer.reviewerRef) {
    throw new Error('Only the assigned reviewer may record the first approval for an unchanged entry.');
  }
  if (entry.approvals.some((approval) => approval.reviewerRef === reviewer.reviewerRef)) {
    throw new Error('A reviewer may record only one approval for a translation version.');
  }
  if (sourceHash !== entry.sourceHash || targetHash !== entry.targetHash) {
    throw new Error('Approval evidence does not match the exact source and target content hashes.');
  }
  if (entry.correctionAuthorReviewerRef && entry.correctionAuthorReviewerRef === reviewer.reviewerRef) {
    throw new Error('A reviewer cannot approve their own corrected translation.');
  }
  if (!evidenceRef || typeof evidenceRef !== 'string') {
    throw new TypeError('A human review evidence reference is required.');
  }
  const requiresDomainApproval = ['LEGAL', 'FINANCIAL', 'KYC_AML', 'PAYROLL', 'SAFETY'].includes(entry.criticalDomain);
  if (requiresDomainApproval) {
    if (!domainApprovalRef || !domainApprover) {
      throw new Error('Critical wording requires separate qualified domain approval evidence.');
    }
    if (typeof domainApprover.reviewerRef !== 'string' || !domainApprover.reviewerRef.trim()) {
      throw new Error('A separate domain approver reference is required.');
    }
    if (domainApprover.reviewerRef === reviewer.reviewerRef || entry.approvals.some((approval) => approval.reviewerRef === domainApprover.reviewerRef)) {
      throw new Error('The domain approver must be independent of the translation reviewers.');
    }
    if (domainApprover.active !== true || domainApprover.identityVerified !== true || domainApprover.qualificationVerified !== true
      || domainApprover.independenceDeclaration !== 'NO_CONFLICT'
      || !domainApprover.scopes?.includes('DOMAIN_APPROVAL')
      || !domainApprover.specialisations?.includes(entry.criticalDomain)
      || !domainApprover.qualificationVerificationRef) {
      throw new Error(`A verified ${entry.criticalDomain} domain approver is required.`);
    }
  }
  const approvals = [...entry.approvals, {
    reviewerRef: reviewer.reviewerRef,
    qualificationVerificationRef: reviewer.qualificationVerificationRef,
    evidenceRef,
    domainApprovalRef,
    domainApproverRef: domainApprover?.reviewerRef || null,
    sourceHash,
    targetHash,
    timestamp: new Date(timestamp).toISOString(),
  }];
  const distinctReviewerRefs = new Set(approvals.map((approval) => approval.reviewerRef));
  const requiredApprovals = entry.criticalDomain ? 2 : 1;
  const approved = distinctReviewerRefs.size >= requiredApprovals;
  const updated = {
    ...entry,
    approvals,
    status: approved ? REVIEW_STATUS.APPROVED : entry.status,
  };
  return appendHistory(
    updated,
    approved ? 'APPROVED_HUMAN' : 'INDEPENDENT_APPROVAL_RECORDED',
    reviewer.reviewerRef,
    approved ? 'Human approval recorded for the exact reviewed content.' : 'First critical-domain approval recorded; independent approval remains outstanding.',
    timestamp,
    evidenceRef,
  );
}

export function invalidateReviewIfChanged(entry, { sourceText = entry.sourceText, targetText = entry.targetText, timestamp = new Date() } = {}) {
  const nextSourceHash = sha256Text(sourceText);
  const nextTargetHash = sha256Text(targetText);
  if (nextSourceHash === entry.sourceHash && nextTargetHash === entry.targetHash) return entry;
  const updated = {
    ...entry,
    sourceText,
    targetText,
    sourceHash: nextSourceHash,
    targetHash: nextTargetHash,
    status: entry.status === REVIEW_STATUS.APPROVED ? REVIEW_STATUS.REOPENED : REVIEW_STATUS.PENDING,
    assignedReviewerRef: null,
    correctionAuthorReviewerRef: null,
    approvals: [],
  };
  return appendHistory(updated, 'APPROVAL_INVALIDATED_CONTENT_CHANGED', 'SYSTEM_CONTENT_HASH_GUARD', 'The source or target content changed; prior approval evidence no longer applies.', timestamp);
}
