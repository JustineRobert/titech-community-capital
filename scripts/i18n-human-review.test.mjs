import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeIfMissing } from './i18n-human-review.mjs';
import {
  REVIEW_STATUS,
  assignReview,
  startReview,
  requestChanges,
  submitCorrection,
  approveReview,
  createReviewEntry,
  invalidateReviewIfChanged,
  validateReviewer,
} from '../shared/i18n/humanReviewWorkflow.mjs';

const swReviewer = (reviewerRef) => ({
  reviewerRef,
  qualificationVerificationRef: `QUAL-${reviewerRef}`,
  active: true,
  identityVerified: true,
  qualificationVerified: true,
  languages: ['sw'],
  scopes: ['TRANSLATION_REVIEW'],
  independenceDeclaration: 'NO_CONFLICT',
});
const domainApprover = (domain, reviewerRef = `${domain.toLowerCase()}-domain-reviewer`) => ({
  reviewerRef,
  qualificationVerificationRef: `QUAL-${reviewerRef}`,
  active: true,
  identityVerified: true,
  qualificationVerified: true,
  independenceDeclaration: 'NO_CONFLICT',
  scopes: ['DOMAIN_APPROVAL'],
  specialisations: [domain],
});

function assignedEntry({ criticalDomain = null } = {}) {
  const initial = createReviewEntry({
    locale: 'sw', namespace: 'financial', key: 'payment.pending',
    sourceText: 'Payment pending', targetText: 'Malipo yanasubiri', criticalDomain,
  });
  const assigned = assignReview(initial, swReviewer('reviewer-a'), { assignmentRef: 'ASSIGN-1' });
  return { entry: startReview(assigned, swReviewer('reviewer-a')), reviewerA: swReviewer('reviewer-a') };
}

test('review entries start pending and require a verified locale-qualified reviewer', () => {
  const entry = createReviewEntry({ locale: 'sw', namespace: 'common', key: 'save', sourceText: 'Save', targetText: 'Hifadhi' });
  assert.equal(entry.status, REVIEW_STATUS.PENDING);
  assert.throws(() => validateReviewer({ reviewerRef: 'x' }, 'sw'), /missing qualificationVerificationRef/);
  assert.throws(() => validateReviewer({ ...swReviewer('x'), qualificationVerified: false }, 'sw'), /human-verified/);
  assert.throws(() => validateReviewer({ ...swReviewer('x'), languages: ['fr'] }, 'sw'), /not qualified/);
});

test('non-critical human approval records a reviewer and exact content hashes', () => {
  const { entry, reviewerA } = assignedEntry();
  const approved = approveReview(entry, reviewerA, { evidenceRef: 'HUMAN-REVIEW-001' });
  assert.equal(approved.status, REVIEW_STATUS.APPROVED);
  assert.equal(approved.approvals.length, 1);
  assert.equal(approved.approvals[0].targetHash, entry.targetHash);
  assert.equal(approved.history.at(-1).action, 'APPROVED_HUMAN');
});

test('approval is rejected when a source or target hash differs from reviewed content', () => {
  const { entry, reviewerA } = assignedEntry();
  assert.throws(() => approveReview(entry, reviewerA, { targetHash: '0'.repeat(64), evidenceRef: 'EVIDENCE-1' }), /exact source and target content hashes/);
});

test('critical translation requires two distinct reviewers and legal-domain evidence', () => {
  const { entry, reviewerA } = assignedEntry({ criticalDomain: 'FINANCIAL' });
  const financialApprover = domainApprover('FINANCIAL');
  const first = approveReview(entry, reviewerA, {
    evidenceRef: 'FIN-REVIEW-1',
    domainApprovalRef: 'FIN-DOMAIN-1',
    domainApprover: financialApprover,
  });
  assert.equal(first.status, REVIEW_STATUS.IN_REVIEW);
  const second = approveReview(first, swReviewer('reviewer-b'), {
    evidenceRef: 'FIN-REVIEW-2',
    domainApprovalRef: 'FIN-DOMAIN-2',
    domainApprover: financialApprover,
  });
  assert.equal(second.status, REVIEW_STATUS.APPROVED);
  assert.equal(new Set(second.approvals.map((item) => item.reviewerRef)).size, 2);
  const legal = assignedEntry({ criticalDomain: 'LEGAL' });
  assert.throws(() => approveReview(legal.entry, legal.reviewerA, { evidenceRef: 'LEGAL-1' }), /domain approval evidence/);
  const legalApprover = domainApprover('LEGAL', 'legal-domain-reviewer');
  const legalApprovedFirst = approveReview(legal.entry, legal.reviewerA, {
    evidenceRef: 'LEGAL-TRANSLATION-1',
    domainApprovalRef: 'LEGAL-DOMAIN-EVIDENCE-1',
    domainApprover: legalApprover,
  });
  assert.equal(legalApprovedFirst.approvals[0].domainApproverRef, 'legal-domain-reviewer');
});

test('a reviewer cannot approve their own corrected translation', () => {
  const { entry, reviewerA } = assignedEntry();
  const changes = requestChanges(entry, reviewerA, { note: 'Please use the approved institutional terminology.' });
  const corrected = submitCorrection(changes, reviewerA, { correctedText: 'Malipo yako bado yanasubiri', rationale: 'The original wording was ambiguous in this product context.' });
  assert.equal(corrected.status, REVIEW_STATUS.CORRECTED_PENDING);
  assert.throws(() => approveReview(corrected, reviewerA, { evidenceRef: 'SELF-APPROVAL' }), /cannot approve their own/);
  const approvedByIndependent = approveReview(corrected, swReviewer('reviewer-b'), { evidenceRef: 'INDEPENDENT-REVIEW' });
  assert.equal(approvedByIndependent.status, REVIEW_STATUS.APPROVED);
});

test('editing a previously approved source or translation reopens review and invalidates approval hashes', () => {
  const { entry, reviewerA } = assignedEntry();
  const approved = approveReview(entry, reviewerA, { evidenceRef: 'HUMAN-REVIEW-001' });
  const reopened = invalidateReviewIfChanged(approved, { targetText: 'Malipo bado yanasubiri' });
  assert.equal(reopened.status, REVIEW_STATUS.REOPENED);
  assert.equal(reopened.approvals.length, 0);
  assert.notEqual(reopened.targetHash, approved.targetHash);
  assert.equal(reopened.history.at(-1).action, 'APPROVAL_INVALIDATED_CONTENT_CHANGED');
});

test('unchanged reviewed content preserves the current review state', () => {
  const { entry } = assignedEntry();
  assert.equal(invalidateReviewIfChanged(entry), entry);
});


test('baseline generation never overwrites existing human reviewer evidence', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'titech-review-evidence-'));
  const evidencePath = path.join(temporaryDirectory, 'review-decisions.jsonl');
  try {
    fs.writeFileSync(evidencePath, '{\"reviewerRef\":\"human-reviewer-1\"}\n');
    const created = writeIfMissing(evidencePath, '');
    assert.equal(created, false);
    assert.match(fs.readFileSync(evidencePath, 'utf8'), /human-reviewer-1/);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
