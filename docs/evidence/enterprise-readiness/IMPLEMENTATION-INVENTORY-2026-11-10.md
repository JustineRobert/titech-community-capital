# TITech Community Capital — Implementation Inventory, 10 November 2026

**Current organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Inventory basis:** Supplied archive source inspection plus 10 November selected verification. This is not a source-code certification.

## 1. Classification key

- **Existing and verified:** Source implementation and a relevant test/static contract were inspected and executed. A static or unit pass is explicitly not treated as live operational proof.
- **Existing but incomplete:** A foundation or workflow exists, but integration, runtime proof, full business lifecycle or external approvals are missing.
- **Missing / not evidenced:** No canonical implementation was found for the described capability in the inspected source scope, or the evidence needed to establish it was not available.

## 2. Platform foundations

| Capability | Classification | Evidence / remaining work |
|---|---|---|
| React/Vite frontend and React Router | Existing but incomplete | Source and frontend runtime contract exist. Production bundle is absent; `vite`/`vitest` unavailable. |
| Express ES-module backend and canonical bootstrap | Existing but incomplete | `titech-implementation-gate` and syntax gate pass. Actual process start/stop and dependency-backed health/readiness not run. |
| MongoDB/Mongoose | Existing but incomplete | Models/repositories and transaction wrappers exist. `mongod` absent; replica-set transaction, recovery and full integration not tested. |
| Redis (`titech:` namespace) | Existing but incomplete | Existing configuration/modules retained; Redis daemon unavailable; availability/recovery integration not tested. |
| JWT and HttpOnly refresh-cookie model | Existing but incomplete | Existing authentication, session and refresh-token architecture retained. Concurrency, rotation, replay and cross-tab runtime tests were not executed in this environment. |
| Canonical RBAC and tenant policy | Existing and statically verified | RBAC static gate passes; payroll roles/permissions added. Comprehensive runtime object/document/export/background-job tenant isolation remains open. |
| Official branding/theme | Existing and verified by theme gate | Nine-colour contract, circular logo reference checksum, light/dark modes and 69 non-brand CSS files pass. No built-bundle visual test was possible. |
| Financial transaction and ledger architecture | Existing but incomplete | Canonical financial static gate passes 12 files; no full golden-money-path database replay or actual balance proof executed. |
| Audit and reconciliation | Existing but incomplete | Canonical audit/reconciliation code retained; selected insurer transaction contract tests pass. Broad financial reconciliation, duplicate/replay and period-close integration remain unproven. |

## 3. Critical business capabilities

| Capability | Classification | Evidence / remaining work |
|---|---|---|
| Refugee and host-community inclusive onboarding | Existing but incomplete | Identity credential, KYC state and partner-scope unit/contract tests pass. Real partner authorization, deployment, legal/privacy approval and field E2E remain unproven. |
| Insurer onboarding/licence/product/enrolment/claim foundation | Existing but incomplete | Existing module and policy tests pass; this execution added MongoDB-session propagation to state writes, related reads and audit writes. Replica-set transaction, claims/premium settlement, authorized distribution and insurer approval remain open. |
| Education support campaigns | Existing but incomplete | Feature-gated campaign management, institution/partner verification, public read-only DTO/routes and lifecycle policy/tests exist. This is not a completed donation collection, donor payments, ledger allocation or disbursement engine. |
| EduFinance | Existing but incomplete | Application-intake model, service and routes are tenant/applicant scoped with submission audit contract. Unit tests verify no independent loan/payment/ledger records are created. Lender underwriting, offer acceptance, booked financing, authorized school disbursement, repayments/collections and partner approval are not complete/evidenced. |
| Scholarships | Missing / not evidenced as a dedicated domain module | No dedicated scholarship module, routes, service or models were found under `backend/modules`. Complete scholarship administration and payment lifecycle remain future implementation. |
| Payroll reporting and webhook audit reads | Existing; source-level remediation delivered | Report and audit-log routes exist; canonical permission checks added; eight backend tests pass. Real HTTP/DB report and audit retrieval still needs an integration environment. |
| Payroll upload/webhook subscription | Existing but incomplete | Existing service and controls; payroll officer has bounded upload/subscription capability. End-to-end execution and employer delivery not verified. |
| Payroll process/reconcile/retry | Existing but incomplete and restricted | Processing/reconcile/retry remain admin-only. No actual provider or database-backed payroll execution/settlement proof. |
| UbuntuFloat | Existing but incomplete | Existing capability model retained. Live agent liquidity/provider/partner/regulatory execution not established by this run. |
| USSD multi-telco | Implemented contract only | Static callback/provider/menu contract passes; provider/network verification false; flags remain off and no shortcode/live financial action is claimed. |

## 4. Current organization and official visual system

The current configured company name is **TITech Capital SMC LTD**, and product name is **TITech Community Capital**. The canonical profile makes external documentary verification pending; repository metadata is not proof of legal registration or authority.

Official palette values retained from `branding/BRAND_MANIFEST.json` and `branding/TITECH_OFFICIAL_THEME.json`:

`#0030A0`, `#0058D8`, `#0066E8`, `#00B8F8`, `#008000`, `#A8F000`, `#F8D800`, `#082B67`, `#FFFFFF`.

The theme gate passes: 69 non-brand frontend CSS files, zero hard-coded official palette literals, central semantic tokens, light/dark modes and logo/reference-image checksum. The platform-wide theme contract is present; this execution did not replace the palette.

## 5. Current critical gates

All eight remain open/blocking: `P0_RUNTIME_INSTALL`, `P0_BOOTSTRAP_HEALTH`, `P0_LEDGER_REPLAY`, `P0_PROVIDER_FAILURES`, `P0_TENANT_PERMISSIONS`, `P1_SECURITY_RECOVERY`, `P1_REGULATORY_PARTNER`, `P1_COMMERCIAL_PILOT`.

`PRODUCTION_APPROVED: NO`; `productionApproved=false`.
