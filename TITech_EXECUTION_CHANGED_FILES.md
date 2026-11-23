# TITech Community Capital — changed-file discovery

> **Additional 23 November 2026 re-execution:** This document's earlier BankConnect/dashboard change discovery is preserved as a historical snapshot. A subsequent run added/changed migration/index ESM tools, syntax/transport verification, safe installation, tests and evidence. The exact latest archive-to-worktree delta is separately recorded in [`docs/evidence/2026-11-23-enterprise-e2e-remediation/reexecution-2026-11-23-1624-UGT/CHANGED_FILES.md`](docs/evidence/2026-11-23-enterprise-e2e-remediation/reexecution-2026-11-23-1624-UGT/CHANGED_FILES.md). The latest focused suite passed 29/29; runtime/install/audit/live database/E2E/deployment/approval remain blocked as detailed there.

Compared the unpacked working tree against the uploaded ZIP file contents. The exact delta at report generation is listed below. No unrelated existing financial engine or auth subsystem was deleted.

## New files

### Backend — BankConnect

- `backend/modules/bankconnect/bankInstitutionRegistry.mjs` — five bank metadata profiles and explicit non-approved connector capability states.
- `backend/modules/bankconnect/statementParser.mjs` — constrained CSV/XLSX/MT940/CAMT parsers, amount/date/currency validation and archive/XML protections.
- `backend/modules/bankconnect/evidenceCrypto.mjs` — fail-closed AES-256-GCM evidence encryption/decryption and configuration check.
- `backend/modules/bankconnect/models/bankConnect.models.js` — tenant-scoped account, consent, import and bank-transaction evidence models/indexes.
- `backend/modules/bankconnect/bankConnect.routes.js` — protected bank metadata/account/consent/import/evidence/audit/report API routes; payment instruction endpoint remains locked.
- `backend/modules/bankconnect/tests/statementParser.test.mjs` — parser, currency, file-security, encryption and bank-approval-state unit tests.

### Frontend

- `frontend/src/pages/bankconnect/BankConnectPage.jsx` — integrated BankConnect workspace (overview, institutions, accounts, consent, imports, bank transactions, evidence queue, health).
- `frontend/src/pages/bankconnect/BankConnectPage.css` — responsive styling using the official TITech semantic theme tokens.
- `frontend/src/pages/groupDashboardPresentation.mjs` — group membership/type/schedule presentation helpers.
- `frontend/src/pages/groupDashboardPresentation.test.mjs` — focused tests for group-card values and unavailable states.

### Documentation and audit output

- `docs/bankconnect/BANKCONNECT_IMPLEMENTATION_STATUS.md` — what is and is not implemented.
- `docs/bankconnect/BANKCONNECT_API_AND_OPERATIONS.md` — routes, permissions, upload and deployment configuration.
- `docs/bankconnect/BANKCONNECT_SECURITY_AND_APPROVAL_GATES.md` — security controls, residual risks and approval requirements.
- `TITech_EXECUTION_REPORT.md` — execution evidence and readiness decision.
- `TITech_EXECUTION_CHANGED_FILES.md` — this change discovery register.
- `reports/official-theme-audit.json` — latest official-theme gate output.
- `reports/rbac-security-gate.json` — latest RBAC gate output.
- `reports/test-discovery-audit.json` — latest test-discovery gate output.

## Modified files

- `backend/.env.example` — documented BankConnect AES evidence encryption key/version placeholders.
- `backend/.env.production.example` — documented production secret-manager placeholders for evidence encryption.
- `backend/routes/index.js` — mounted BankConnect router inside the existing authentication and tenant-authorization middleware chain.
- `backend/security/rbacPolicy.js` — added explicit BankConnect view/account/import/authorization-review/reconciliation/beneficiary/payment/audit/connector permission identifiers and tenant-admin baseline permissions.
- `frontend/src/navigation/navigationRegistry.js` — added BankConnect authenticated institutional navigation entry.
- `frontend/src/components/Navbar.jsx` — mapped BankConnect navigation to an existing Landmark icon.
- `frontend/src/routes/AppRoutes.jsx` — registered the lazy BankConnect page route.
- `frontend/src/pages/Dashboard.jsx` — applied source-aware group presentation helpers to group cards; no hard-coded production statistics were added.
- `package.json` — added `test:bankconnect` and `test:group-presentation` and inserted them into the root dependency-free CI test chain.
- `scripts/tests/navigation-routes-contract.test.mjs` — extended the existing mounted-route contract to verify the BankConnect React route is registered.
- `scripts/tests/navbar-discovery-contract.test.mjs` — extended the existing authenticated service-discovery contract to verify the BankConnect navigation entry.
- `TITECH_PLATFORM_TRUTH.md` — added the current BankConnect scope, source findings, test evidence and outstanding release blockers.

## Deleted or renamed files

- **No intentional application source file deletion.** The archive contained `frontend/public/images/independent Circular Seal.png` (narrow no-break space U+202F). The extraction layer initially materialised the filename with a `#U202f` escape. The path was restored to the exact original Unicode filename in the working tree; the image bytes were preserved.

## Discovery procedure

The changed-file register was generated by reading the uploaded ZIP central directory and byte-comparing each entry against the working tree. The archive has no `.git` metadata, so a Git diff, branch/commit identity and working-tree status cannot be asserted.
