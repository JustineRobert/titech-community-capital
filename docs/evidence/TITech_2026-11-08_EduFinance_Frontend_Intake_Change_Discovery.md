# TITech execution change discovery — EduFinance frontend intake increment

**Execution date:** 8 November 2026 (Africa/Kampala)  
**Product:** TITech Community Capital  
**Organization:** TITech Capital LTD  
**Service:** TITech EduFinance — School Fees Financing Infrastructure Platform  
**Source archive:** `titech-community-capital-main.zip`  
**Uploaded source archive SHA-256:** `234ff179cfe05c15fea65da7228bd2836f4c328e03ef47d9766ce3f3012510b3`  
**Git metadata:** Not present in the ZIP; branch, commit and working-tree cleanliness cannot be established. A read-only `git ls-remote` attempt failed because this execution environment could not resolve `github.com`; remote parity is unverified and no push was attempted.  
**Production approval:** `productionApproved=false` (unchanged)

## 1. Execution scope

The supplied ZIP was extracted and used as the code source. The previous repository evidence was reviewed before making changes. This was an incremental implementation, not a claim that the broad EduFinance, Partner Portal, Offline, Meetings or TITechChats programme is complete.

## 2. Baseline confirmed from the archive

- Existing React/Vite/React Router frontend and Express ESM/Mongoose backend retained.
- Existing canonical authentication, memory-only access-token lifecycle, HttpOnly refresh-cookie/refresh-token rotation, RBAC, tenant authorization, Redis, audit, payment, financial transaction, ledger and reconciliation surfaces were not replaced.
- Existing EduFinance backend supports only gated applicant intake and applicant-scoped history. It does not provide school verification, lender underwriting/approval, agreement, disbursement, servicing or loan closure.
- Existing EduFinance route is registered behind canonical authentication/tenant middleware and requires applicant-specific permissions plus the backend feature flag.
- Existing official theme manifest contains all nine official colors and both light/dark themes. The original circular logo and semantic theme system were retained.
- Existing Partner Portal is restricted to the supported tenant-scoped support-case workspace; other unsupported capabilities remain visibly disconnected.
- Meetings has frontend and backend source, but live browser execution was not verified.
- Offline device and event modules exist, but the complete browser trust/enrolment/synchronization lifecycle remains gated.
- TITechChats assets exist, but canonical full-stack execution/realtime integration remains disconnected and was not mounted as a shortcut.

## 3. Changes made in this increment

| File | Action | Reason |
|---|---|---|
| `frontend/src/services/eduFinanceApi.js` | Added | Connects the page to the existing applicant list and submission APIs using the canonical shared API client; submits `Idempotency-Key`. |
| `frontend/src/pages/edufinance/eduFinanceFormPolicy.mjs` | Added | Pure mapping/validation for UGX whole-shilling declarations, references, guardian relationship and request-versus-outstanding amount. |
| `frontend/src/pages/edufinance/__tests__/eduFinanceFormPolicy.test.mjs` | Added | Five dependency-free tests for payload mapping, amount limits, precision, relationship/version validation and student-data minimization. |
| `frontend/src/pages/edufinance/EduFinancePage.jsx` | Modified | Adds gated authenticated guardian intake and applicant-only request history; displays server verification states; retains informational content. |
| `frontend/src/pages/edufinance/edufinance.css` | Modified | Adds responsive, accessible form/history styles using existing TITech semantic theme variables only. |
| `frontend/.env.example` | Modified | Documents public presentation flag defaulting to false. |
| `frontend/.env.production.example` | Modified | Documents production presentation flag defaulting to false. |
| `docs/edufinance/EDUFINANCE_IMPLEMENTATION_AND_GATES_2026-11-07.md` | Modified | Adds the 8 November frontend integration scope and evidence boundary. |
| `docs/edufinance/EDUFINANCE_GUARDIAN_INTAKE_USER_GUIDE.md` | Added | Documents safe enablement, use, and the distinction between request submission and verification/approval. |
| `TITECH_PLATFORM_TRUTH.md` | Modified | Records the 8 November increment and current evidence/limitations. |
| `docs/evidence/TITech_2026-11-08_EduFinance_Frontend_Intake_Change_Discovery.md` | Added | This execution record. |

Gate scripts also refresh generated audit reports under `reports/`; the packaged file manifest identifies all source-versus-output differences.

## 4. Safety and architecture controls retained

- The product and organization names remain exactly `TITech Community Capital` and `TITech Capital LTD`.
- The official palette remains Deep Blue `#0030A0`, Electric Blue `#0058D8`, Bright Blue `#0066E8`, Cyan `#00B8F8`, Africa Green `#008000`, Lime Green `#A8F000`, Gold Yellow `#F8D800`, Navy Ink `#082B67` and White `#FFFFFF`.
- The new EduFinance CSS uses centralized semantic tokens rather than a competing palette.
- No separate authentication/token store, loan balance, payment engine or ledger was introduced.
- No child name, national ID, date of birth or child contact field is included in the new intake payload.
- The backend remains authoritative for feature activation, authentication, tenant resolution, permissions, validation and persisted status.
- The frontend feature flag is only a presentation switch. Both frontend and backend environment templates default to disabled.
- A submitted request is still pending partner verification and is not a loan approval or financial transaction.
- Refugee/host-community onboarding remains partner-led; insurance activity remains subject to appropriately authorized insurance partners and applicable approvals.
- `productionApproved=false` remains unchanged.

## 5. Commands and results

Environment observed:

```text
node v22.16.0
npm 10.9.2
root node_modules: absent
backend/node_modules: absent
frontend/node_modules: absent
```

The repository requires Node `>=24.15.0` and npm `>=11`. Dependency-backed frontend build, startup, database/Redis operations and browser automation could not be completed because the supported runtime and installed dependencies were unavailable. The root `npm run check` exited at the supported-runtime gate; `npm run build:frontend` exited because `vite` is not installed. `npm run build:backend` exited successfully, but the backend package script is an informational no-compilation validation command and is not build or startup evidence.

Dependency-free repository checks executed:

| Command | Result |
|---|---|
| `node scripts/official-theme-audit.mjs` | PASS |
| `node scripts/verify-titech-legal-branding.mjs` | PASS |
| `node scripts/financial-static-gate.mjs` | PASS — 12 canonical financial files |
| `node scripts/enterprise-gate.mjs --syntax` | PASS — 2,506 executable JS/TS-family files parsed; Node target warning recorded |
| `node scripts/titech-implementation-gate.mjs` | PASS |
| `node scripts/runtime-import-audit.mjs` | PASS for canonical financial surface; 208 legacy/non-critical missing import candidates remain reported |
| `node scripts/rbac-security-gate.mjs` | PASS |
| `npm run check` | BLOCKED at `check:runtime`; Node/npm below required versions |
| `npm run build:frontend` | BLOCKED; `vite: not found` because `node_modules` is absent |
| `npm run build:backend` | EXIT 0; package script prints a no-compilation validation message only, not an artifact build |

Targeted dependency-free tests executed:

| Test file | Passed | Failed |
|---|---:|---:|
| `frontend/src/pages/edufinance/__tests__/eduFinanceFormPolicy.test.mjs` | 5 | 0 |
| `frontend/src/pages/edufinance/__tests__/eduFinanceIntakeContract.test.mjs` | 4 | 0 |
| `backend/tests/unit/edufinance/eduFinance.policy.test.mjs` | 10 | 0 |
| `backend/tests/unit/edufinance/eduFinance.route-contract.test.mjs` | 5 | 0 |
| `tests/partner-portal/partner-guide.test.mjs` | 3 | 0 |
| `backend/modules/operations/supportCase.policy.test.mjs` | 5 | 0 |
| `frontend/src/security/__tests__/rbacPolicy.partnerPortal.test.mjs` | 2 | 0 |
| `backend/modules/meetings/meeting.policy.test.js` | 4 | 0 |
| `backend/modules/meetings/providers/dailyProvider.test.js` | 5 | 0 |
| `backend/tests/unit/inclusive-onboarding/offline-contract.test.mjs` | 6 | 0 |
| **Total** | **49** | **0** |

The Node direct `--check` command does not parse `.jsx` files and returned `ERR_UNKNOWN_FILE_EXTENSION`; the repository's own syntax gate did parse the JSX/TS family source successfully using its configured parser. This is not reported as a JSX syntax failure. Full execution outputs are packaged in `docs/evidence/execution-2026-11-08-edufinance-intake/`.

## 6. Workstream status after this increment

| Workstream | Actual status | Remaining evidence/gap |
|---|---|---|
| Official identity and nine-color theme | Implemented; source audits passed | External statutory identity documents not independently verified. |
| EduFinance application intake API | Implemented; unit/route-contract tests passed | Live MongoDB persistence, index deployment and API integration not run. |
| EduFinance guardian intake UI | Implemented; pure form policy 5/5 passed; repository syntax gate passed | Vite production build and browser E2E not run. UI only appears when both front presentation and backend feature flags are correctly configured. |
| EduFinance school/invoice verification | Not implemented as an authoritative workflow | Requires school registry, evidence review, maker-checker and external school/SIS integration. |
| EduFinance KYC/affordability/underwriting | Not implemented | Requires approved lender policy, verified inputs, authorized services and lender decision authority. |
| EduFinance agreement/disbursement/repayment/accounting/reconciliation/closure | Not implemented | Requires partner contracts, provider sandbox/live proof and canonical loan/payment/ledger/reconciliation integration. |
| Partner Portal support cases | Implemented in limited scope; policy/guide/RBAC tests passed | Case API live persistence and frontend browser E2E not run; audit write transactionality and advanced case workflow remain gaps. |
| Seven-chapter guide and Help Dots | Implemented; guide contract tests passed | Browser interaction/accessibility verification outstanding. |
| Partner customer lookup/message history | Not connected | Requires partner-scoped API and purpose-limited access model. |
| Partner account settings | Not connected | Requires canonical safe settings contracts and field-level permissions. |
| Provider-specific messaging monitoring | Not connected | Requires actual provider telemetry and verified delivery evidence. |
| Meetings | Route/source and policy/provider tests present | API/browser E2E, provider credentials, attendance evidence and live operation not verified. |
| Offline | Device/event contracts and fail-closed tests present | Complete browser credential lifecycle, device enrollment, sync execution and recovery E2E not verified; do not globally activate. |
| TITechChats | Existing source assets/tests present | Canonical frontend/backend/realtime route execution remains incomplete; do not mount disconnected legacy components. |
| Shared security | Source/RBAC/contract checks passed selectively | Live cross-tenant attack tests, penetration test and independent security assessment not performed. |
| Runtime/operations | Not operationally verified | Node/npm target, dependency install, builds, backend startup, MongoDB/Redis, health/readiness and backup restore remain unverified. |

## 7. Production-readiness decision

**NOT READY.** This increment adds a useful guarded applicant-facing surface but does not turn the platform into an end-to-end regulated lending service or prove live financial correctness. Application intake remains disabled in the committed environment templates. Live disbursement, live repayment, automated credit decisioning, lender approval, regulatory approval and production approval remain disabled. The repository cannot be labelled enterprise production ready from this archive-local evidence.

## 8. Step-by-step changed-file discovery

From the repository root:

1. Open `docs/evidence/TITech_2026-11-08_EduFinance_Frontend_Intake_Change_Discovery.md` for scope and actual verification results.
2. Open `docs/evidence/TITech_2026-11-08_User_Update_File_Change_Manifest.json` for the structured change manifest, or the matching `.csv` for a spreadsheet-friendly file list and checksums.
3. Open `frontend/src/pages/edufinance/EduFinancePage.jsx` to inspect the user interface and guarded feature-flag/authentication behaviour.
4. Open `frontend/src/pages/edufinance/eduFinanceFormPolicy.mjs` to inspect input-to-API mapping and client-side validation.
5. Open `frontend/src/services/eduFinanceApi.js` to inspect the canonical API endpoints and idempotency header.
6. Open `frontend/src/pages/edufinance/__tests__/eduFinanceFormPolicy.test.mjs` and execute the test command below.
7. Open `docs/edufinance/EDUFINANCE_GUARDIAN_INTAKE_USER_GUIDE.md` for the user-level instructions and operating boundaries.
8. Compare `TITECH_PLATFORM_TRUTH.md` and `docs/edufinance/EDUFINANCE_IMPLEMENTATION_AND_GATES_2026-11-07.md` for the updated platform truth and scope.

Focused test command:

```bash
node --test frontend/src/pages/edufinance/__tests__/eduFinanceFormPolicy.test.mjs
```

Repository checks should be rerun under Node >=24.15.0/npm >=11 using the exact lockfiles before any deployment or partner pilot.
