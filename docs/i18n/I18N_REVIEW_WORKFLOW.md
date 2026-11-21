# TITech Community Capital — translation review workflow

## Implemented in this archive

- A dependency-free review state and evidence policy engine: `shared/i18n/humanReviewWorkflow.mjs`.
- Content SHA-256 generation for exact English source and target text.
- Verified reviewer eligibility checks (active identity, verified qualification, locale scope, translation-review scope, and no-conflict declaration).
- Assignment, review-start, change-request, correction-submission, approval, independent critical approval, and hash-based invalidation transitions.
- Regression tests covering unauthorised/unqualified reviewers, exact hash mismatch, critical two-person approval, self-approval rejection, legal-domain evidence, and invalidation.
- Three CSV review queues and JSON queues, one per target language, containing 602 items each.
- An upgraded fail-closed `scripts/i18n-production-gate.mjs` that checks current content hashes, reviewer evidence, English source approval, Arabic RTL evidence, legal/domain approval, and cross-locale E2E evidence.

## Not implemented / blocked

The authenticated administrative review workbench, persistent MongoDB review aggregate, server-side reviewer-assignment API, canonical RBAC permission registration, and append-only integration with the existing production audit service are **not yet implemented**. The pure policy engine is not an authentication boundary and must not be called directly by an untrusted browser. The queues are export/import working papers only; they must not be edited to simulate approval.

This limitation is deliberate: the supplied archive has no runnable dependency environment, and a secure administrative route must be integrated with the canonical authenticated/tenant-scoped backend, permission registry, persistent evidence store, and audit service rather than creating a standalone reviewer identity system.

## Current review packet

`reports/i18n-human-review/2026-11-21-1146Z/`

- `review-queues/sw-review-queue.csv` and `.json`
- `review-queues/fr-review-queue.csv` and `.json`
- `review-queues/ar-review-queue.csv` and `.json`
- `reviewer-registry.json` (intentionally empty)
- `review-decisions.csv` and `review-decisions.jsonl` (zero decisions)
- `review-issues.csv` (header only; quality issues are not assessed until a human review happens)
- `review-progress.json`
- `rtl-acceptance.json` (PENDING)
- `e2e-evidence.json` (NOT_RUN)
- `qualified-human-review-gate.json`

## Controlled completion sequence

1. Verify each reviewer through a human administrator; store only reviewer reference and qualification evidence references in application records.
2. Assign a reviewer per locale/domain through authenticated, server-authorized workflow.
3. Reviewer reads the English source, target translation, component/screen context, placeholders and approved glossary.
4. Record notes and proposed wording; do not edit locale JSON outside the controlled correction process.
5. A qualified reviewer rechecks corrected target content against the current exact source/target hashes.
6. Obtain a second independent review for critical-domain entries and separate legal/domain approval for legal/regulated wording.
7. Export append-only decisions and content hashes into the release evidence bundle.
8. Run Arabic RTL acceptance and real cross-locale browser E2E; attach actual evidence references.
9. Run `npm run i18n:production-gate`. It must remain blocked until all evidence passes.
10. The existing root `npm run check` chain invokes `i18n:production-gate` and `chat:production-gate`, so an incomplete human-review packet blocks the normal quality/release chain.
11. Follow the separate platform production approval process; this locale gate cannot set `productionApproved=true`.

## Commands

Set a new, path-safe run identifier (for example `TITECH_I18N_RUN_ID=2026-11-22-review-01`) when opening a new review packet. Re-running the baseline command in an existing run is non-destructive: it creates missing templates only and does not overwrite existing reviewer identities, decisions, issue notes, RTL evidence, E2E evidence, review progress or exported queue work. Use a new run ID for a new source/translation baseline. The production gate reads the same run ID.

```bash
npm run i18n:human-review:baseline
npm run test:i18n:human-review
npm run test:i18n:native
npm run i18n:human-review:gate
npm run i18n:production-gate
```

### Critical-domain approval control

Every critical-domain translation requires two distinct translation reviewers. Critical financial, legal, KYC/AML, payroll and safeguarding entries additionally require a third, separately qualified domain approver with a verified identity, no-conflict declaration, qualification reference, `DOMAIN_APPROVAL` scope, and a specialisation matching the entry's domain. Domain approval must be tied to the exact content hashes; a reference string without a matching qualified domain-approver profile does not satisfy the gate.
