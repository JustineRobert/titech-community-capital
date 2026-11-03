# TITech Capital LTD — UbuntuFloat Core Implementation & File Change Discovery

**Date:** 23 October 2026  
**Product:** TITech Community Capital  
**Organization:** TITech Capital LTD  
**Repository reference:** https://github.com/JustineRobert/titech-community-capital  
**Principle:** BUILD LESS. PROVE MORE.  
**Current release decision:** NOT READY — `productionApproved: false`.

## 1. Executive outcome

I applied a bounded implementation and evidence refresh to the supplied `titech-community-capital-main.zip`. The update adds an agent-network registry and unverified provider-specific position-observation path as an internal, disabled-by-default TITech capability. It also adds production environment templates, a controlled database-index setup command, native policy/route tests, safer evidence gating, refreshed static-gate reports and a corrected deterministic Golden Money Path reference proof.

The archive-local source comparison shows **12 existing files modified and 25 files added** after including this change-discovery report and its companion CSV index. **No original archive files were deleted.** The supplied archive had no `.git` metadata, so its branch/commit could not be verified; the update has not been pushed to GitHub.

This is not a claim of complete enterprise production readiness. The master gate currently reports `PILOT_HARDENED_WITH_EXTERNAL_GATES_OPEN`; there are **23 unresolved blocking readiness rows** and the production approval gate remains blocked.

## 2. Identity, brand and architecture decisions

- Product identity stays **TITech Community Capital**; organization identity is **TITech Capital LTD**.
- UbuntuFloat is implemented as a capability under the existing application; it does not replace TITech Community Capital or become a separate app/ledger/auth service.
- Existing authentication, tenant authorization, action-level RBAC, audit logging, secure private-document handling, payment/ledger authority and reconciliation boundaries are reused.
- Existing refugee/host-community and insurance modules were kept; neither is rewritten as a parallel onboarding flow. Their existing capability flags, partner/consent/identity conditions and insurer licence checks remain authoritative.
- The official TITech palette and circular logo are retained. The nine canonical colors, central theme tokens, light/dark contract and mobile tokens pass `node scripts/official-theme-audit.mjs`; this update does not substitute a new palette.
- UbuntuFloat Core, Advance, Swap and live-money flags are false in the provided templates. Only the bounded Core source slice is implemented. No advance/loan disbursement, agent-to-agent money transfer, savings deduction, external provider balance verification or ledger posting is activated by this change.

## 3. Step-by-step folder/file discovery

### Step 1 — Canonical route and permissions

**Modified** `backend/routes/index.js`: imports and mounts `ubuntuFloatRoutes` beneath the existing versioned API prefix with existing `authenticate` and `tenantAuthorization` middleware.  
**Modified** `backend/middleware/platformPermissions.js`: introduces discrete permission sets for `AGENT_NETWORK_ADMIN`, `AGENT_NETWORK_REVIEWER`, `FLOAT_OPERATIONS_OFFICER`, and `FLOAT_AUDITOR`; read, submit, review and attestation are distinct actions.  
**Purpose:** keep the feature in the existing identity, tenant and authorization model. UI visibility alone is not treated as authorization.

### Step 2 — UbuntuFloat domain module

New files:

- `backend/modules/ubuntu-float/ubuntuFloat.policy.js` — hierarchy relationships, allowed lifecycle transitions, agent-code validation, provider allowlist, currency/amount validation and “manual is not provider-verified” normalization.
- `backend/modules/ubuntu-float/models/UbuntuFloatAgentProfile.js` — tenant-scoped agent record, hierarchy link, unique tenant/agent code, state/reviewer/evidence requirements and history.
- `backend/modules/ubuntu-float/models/UbuntuFloatPositionObservation.js` — immutable, tenant-scoped, provider-specific observations with a strict `UNVERIFIED_MANUAL_ATTESTATION` status.
- `backend/modules/ubuntu-float/ubuntuFloat.service.js` — agent creation/listing/review and observation workflows; tenant filtering; audit events; active-parent check; self-review denial; activation evidence validation against the private-document store.
- `backend/modules/ubuntu-float/ubuntuFloat.controller.js` — validates request context and returns normalized API error envelopes.
- `backend/modules/ubuntu-float/ubuntuFloat.routes.js` — routes are disabled by `TITECH_UBUNTFLOAT_CORE_ENABLED` unless explicitly configured and each route has an action-level permission requirement.

**Important boundary:** the position endpoint is a manual observation record, not a live account-balance API. It has no money-movement, loan, saving-deduction or ledger write path.

### Step 3 — Evidence upload and activation proof

**Modified** `backend/modules/secure-documents/secureDocument.controller.js`: permits `OTHER_COMPLIANCE_EVIDENCE` upload for the UbuntuFloat evidence-submit permission only when the UbuntuFloat Core capability is enabled; subject scoping is enforced for agent-specific uploads.  
**Service/model behavior:** activating an agent requires a `SecureDocument` row with the same tenant, the agent profile ID as subject, the required evidence purpose, and a document reference already stored in the private-document mechanism. A user-provided free-text reference alone cannot activate an agent. The existing private storage and malware scanner controls remain required.

### Step 4 — Feature flags, production environment templates and indexes

- **Modified** `backend/.env.example`: declares UbuntuFloat Core, Advance, Swap and live-money movement flags with safe false defaults.
- **Added** `backend/.env.production.example`: uses placeholder-only secrets, secure cookie/audit defaults, external TLS endpoint placeholders and explicitly disabled regulated/high-risk capabilities.
- **Added** `frontend/.env.production.example`: uses the existing same-origin `/api/v1` path; no credentials are included.
- **Modified** `scripts/titech-hosting-gate.mjs`: validates both refugee-onboarding flags, insurance boundaries and all UbuntuFloat flags default to disabled.
- **Added** `backend/scripts/createUbuntuFloatIndexes.js`: explicit MongoDB index-creation command, requiring a configured connection and logging no credentials.
- **Modified** `backend/package.json` and root `package.json`: adds the index script and UbuntuFloat native tests; adds UbuntuFloat and inclusive-onboarding tests to the root CI test chain.

Production example files are templates, not provisioned secrets, production infrastructure, proof of TLS certificate validity, or a deployed environment.

### Step 5 — Golden Money Path reference-proof correction

- **Modified** `backend/testing/goldenMoneyPath/goldenMoneyPathHarness.cjs`: when an external attempt is in `UNKNOWN` or remains pending with a provider reference, another create-payment request is blocked pending status resolution.
- **Modified** `backend/testing/goldenMoneyPath/referenceProviderSimulator.cjs`: records provider create requests so the harness can verify whether the primary payment was re-initiated.
- **Modified** `scripts/golden-money-path-proof.mjs`: evidence class/result derives from the actual guarantees and the command exits non-zero if any guarantee fails.
- **Added/refreshed** `reports/evidence/golden-money-path-proof.json`: all listed guarantees now pass for the primary reference scenario and metrics distinguish primary-payment counts from totals across auxiliary cases.

This is an in-memory reference harness. It is not an MTN/Airtel transaction, a real MongoDB/Redis restart proof, a settlement statement or a production financial certification.

### Step 6 — Tests, generated evidence and documentation

- `backend/tests/unit/ubuntu-float/ubuntuFloat.policy.test.mjs` — policy/state/provider/manual-attestation validations.
- `backend/tests/unit/ubuntu-float/route-contract.test.mjs` — route mount, auth/tenant/RBAC/flag, evidence linkage and no-live-money-path contracts.
- `docs/ubuntu-float/UBUNTFLOAT_CORE_IMPLEMENTATION_2026-10-23.md` — technical scope, routes, safety boundaries and rollout prerequisites.
- `docs/evidence/implementation-handoff-2026-10-23.md` — test results, remaining blockers and release-owner runbook.
- `TITECH_PLATFORM_TRUTH.md` and `README.md` — current release status and links updated; no “production approved” claim added.
- `docs/evidence/2026-10-23-master-gate-summary.md` and machine-readable files under `reports/` — evidence generated during gate execution.
- `docs/evidence/file-change-index-2026-10-23.csv` — exact archive comparison with SHA-256 for modified/added files where applicable.
- `TITech_Capital_LTD_UbuntuFloat_Change_Discovery_2026-10-23.md` — this guide.

The official theme, existing refugee/host-community and insurance source folders were not reimplemented or removed. Their presence and existing contracts are preserved, not re-certified for live production.

## 4. Exact changed-file list

### Modified existing files (12)

1. `README.md`
2. `TITECH_PLATFORM_TRUTH.md`
3. `backend/.env.example`
4. `backend/middleware/platformPermissions.js`
5. `backend/modules/secure-documents/secureDocument.controller.js`
6. `backend/package.json`
7. `backend/routes/index.js`
8. `backend/testing/goldenMoneyPath/goldenMoneyPathHarness.cjs`
9. `backend/testing/goldenMoneyPath/referenceProviderSimulator.cjs`
10. `package.json`
11. `scripts/golden-money-path-proof.mjs`
12. `scripts/titech-hosting-gate.mjs`

### Added files (25)

1. `TITech_Capital_LTD_UbuntuFloat_Change_Discovery_2026-10-23.md`
2. `backend/.env.production.example`
3. `backend/modules/ubuntu-float/models/UbuntuFloatAgentProfile.js`
4. `backend/modules/ubuntu-float/models/UbuntuFloatPositionObservation.js`
5. `backend/modules/ubuntu-float/ubuntuFloat.controller.js`
6. `backend/modules/ubuntu-float/ubuntuFloat.policy.js`
7. `backend/modules/ubuntu-float/ubuntuFloat.routes.js`
8. `backend/modules/ubuntu-float/ubuntuFloat.service.js`
9. `backend/scripts/createUbuntuFloatIndexes.js`
10. `backend/tests/unit/ubuntu-float/route-contract.test.mjs`
11. `backend/tests/unit/ubuntu-float/ubuntuFloat.policy.test.mjs`
12. `docs/evidence/2026-10-23-master-gate-summary.md`
13. `docs/evidence/file-change-index-2026-10-23.csv`
14. `docs/evidence/implementation-handoff-2026-10-23.md`
15. `docs/ubuntu-float/UBUNTFLOAT_CORE_IMPLEMENTATION_2026-10-23.md`
16. `frontend/.env.production.example`
17. `reports/evidence/golden-money-path-proof.json`
18. `reports/frontend-runtime-audit.json`
19. `reports/i18n-coverage-2026-10-17.json`
20. `reports/official-theme-audit.json`
21. `reports/rbac-security-gate.json`
22. `reports/runtime-import-audit.json`
23. `reports/titech-enterprise-master-gate.json`
24. `reports/titech-hosting-gate.json`
25. `reports/titech-implementation-gate-2026-10-02.json`

No file was removed from the original upload. The companion CSV provides the computed SHA-256 before/after for source files and after-hashes for added files; its own hash column is intentionally blank because a file cannot contain a stable self-hash.

## 5. Test and gate summary

- **104/104 selected dependency-free native tests passed** across ten suites: UbuntuFloat (12), inclusive onboarding (24), retirement support (16), education campaigns (10), malware scanner protocol (4), performance contract (8), i18n (9), frontend runtime contract (2), financial product rules (5), and platform control plane (14).
- Golden Money Path reference proof: PASS; source-contract smoke: PASS.
- Official theme, hosting, implementation, financial-static, enterprise-contract, RBAC and syntax gates: PASS.
- Runtime import audit: zero missing imports on the canonical financial surface and zero mixed-module violations there; 209 broader legacy/non-critical missing local imports remain.
- Master gate: `PILOT_HARDENED_WITH_EXTERNAL_GATES_OPEN`; `productionApproved: false`; 23 unresolved blockers.
- Production approval: BLOCKED due missing `TITECH_PRODUCTION_APPROVAL`, `TITECH_APPROVAL_REFERENCE` and `TITECH_APPROVAL_EXPIRES_AT` evidence.
- Full Jest/Vitest/lint/frontend build cannot currently run because dependencies are absent; observed Node/npm are below repository requirements. These failures are not suppressed or marked as passing.

## 6. What to do immediately next

1. Apply the archive changes to the authoritative clone after examining its own `git status` and latest commit; this upload had no `.git` metadata, and nothing has been pushed to GitHub.
2. Switch to Node 24.15.x and npm 11.x, perform a clean install and run all lint, backend, frontend build/test and browser-E2E gates. Resolve failures rather than changing tests to force green.
3. Exercise feature-gated routes against transaction-capable test MongoDB/Redis with cross-tenant, concurrency, reviewer separation, duplicate document and disabled-capability tests; run the index command only in a controlled environment.
4. Provision and verify encrypted durable document storage and malware scanning; run backup/restore and rollback exercises.
5. Obtain applicable institutional partner, provider, qualified Uganda legal/privacy and regulatory approval for each specific production flow. Keep flags false until written approval and reproducible environment evidence exist.
6. Prove any future actual provider position retrieval, payment, settlement, reversal or reconciliation with provider-specific sandbox evidence first; do not infer any such capability from the manual observation workflow.
7. Complete pilot, independent security, recovery and commercial gates and rerun the production approval gate. Never hand-edit readiness reports to claim approval.

## 7. Official theme values verified

The palette remains sourced from `branding/TITECH_OFFICIAL_THEME.json` / `branding/BRAND_MANIFEST.json` and the centralized frontend theme layer: deep blue `#0030A0`, electric blue `#0058D8`, bright blue `#0066E8`, cyan `#00B8F8`, Africa green `#008000`, lime green `#A8F000`, gold yellow `#F8D800`, navy ink `#082B67`, and white `#FFFFFF`. The audit reports all nine colors, explicit light/dark modes, matching mobile theme tokens and the supplied reference asset checksum. No palette change was needed.

**Final release decision: NOT READY. BUILD LESS. PROVE MORE.**
