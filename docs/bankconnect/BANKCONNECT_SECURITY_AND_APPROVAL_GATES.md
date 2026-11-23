# BankConnect security boundaries and release gates

## Invariants

- BankConnect bank transaction records are external source evidence, not member financial transactions.
- Statement import never posts to the canonical ledger or modifies a member/group balance.
- No parallel ledger is introduced.
- No real bank API credentials or connection status are fabricated.
- No internet banking browser automation or credential scraping is implemented.
- Full account numbers, login passwords, PINs and OTPs are neither collected nor stored.
- Account, statement, transaction and audit queries are tenant-scoped.
- Raw statement bytes are encrypted using AES-256-GCM before persistence and are excluded from default queries.
- Scanner and evidence-key absence are fail-closed conditions.
- File size, content type, parser format, dates, currency, amount precision and row counts are validated.
- All monetary values in the normalised representation are safe integer minor-unit amounts.
- Exact duplicate statement uploads are idempotent; possible transaction collisions are flags for review, not proof of duplicate payment.
- Consent creation, approval, revocation, account state and corresponding audit event are transactionally committed. Revocation suspends further use; re-authorization/reactivation requires a future governed workflow and is not exposed in this delivery.
- A maker cannot approve their own consent.
- Payment instructions remain locked, and `productionApproved=false`.

## Threat controls included

- Tenant context is sourced from authenticated middleware.
- RBAC permission checks are applied per route.
- Masked account number validation.
- Raw upload size cap and MIME/extension pairing.
- ClamAV INSTREAM scan with fail-closed timeout/error handling.
- XLSX ZIP entry count, expansion-size, compression-ratio, path traversal, symlink, encryption and formula-cell checks.
- CSV formula prefix rejection and strict parser handling.
- XML DTD/entity declaration rejection.
- AES-GCM authenticated encryption of the source document.
- MongoDB unique compound indexes for account reference, statement hash and transaction idempotency.
- Audit metadata uses the platform's canonical secret-sanitizing audit service.

## Residual risks and independent verification required

- No MongoDB or Redis integration test was possible in the execution environment. Transaction behaviour must be exercised against the production-equivalent replica-set topology.
- No dynamic web/API security scan, browser E2E, penetration test or independent review was run.
- The parser is a constrained implementation, not a formal conformance certification for all bank-specific CSV/XLSX/MT940/CAMT variants. Each actual partner sample requires schema review and golden-file tests.
- A string reference to account ownership evidence is not a verified identity document. A governed reviewer process and evidence retention controls must be established.
- No re-authorization/reactivation path exists after consent revocation; a new, reviewed lifecycle must be designed before a revoked bank account can be used again.
- The ClamAV service must be isolated, access-controlled, monitored and kept patched.
- Encryption key creation, HSM/secret-manager storage, backup, rotation and disaster recovery remain operator responsibilities.
- The audit service's hash chain is tamper-evident but not equivalent to independently administered WORM storage or cryptographic non-repudiation.
- Existing backend package module audit reports legacy unresolved CommonJS imports and mixed module boundaries elsewhere in the repository.
- Integration with the canonical finance statement processor/reconciliation engine, manual match approval and ledger posting are not implemented in this delivery.
- Legal and regulatory assessment under applicable Uganda banking, payment systems, data protection, insurance and institutional frameworks requires qualified counsel and the relevant partners/regulators.

## Release decision

**BLOCKED — NOT PRODUCTION APPROVED.** Local parser and presentation unit tests pass, but database transaction integration, browser E2E, runtime, full test suite, operational restore, external bank/insurer/provider approvals and regulatory/security assessments are not evidenced. `productionApproved=false` must remain unchanged.
