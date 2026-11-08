# TITech EduFinance — implementation and evidence boundary

**Organization:** TITech Capital LTD  
**Parent product:** TITech Community Capital  
**Service:** TITech EduFinance — School Fees Financing Infrastructure Platform  
**Tagline:** Verified school fees. Responsible financing. Complete reconciliation.  
**Platform tagline:** BUILD LESS. PROVE MORE.  
**Original implementation snapshot:** 7 November 2026
**Frontend intake increment:** 8 November 2026

## What this archive now implements

This increment introduces a guarded school-fees application-intake foundation inside the existing TITech Community Capital architecture. It does not create a second loan engine, payment engine, balance service, ledger, reconciliation engine, authentication stack or tenant system.

- A strict Mongoose `EduFinanceApplication` record stores a parent's/guardian's intake request, verified-school and invoice references supplied for later partner verification, academic-period references, amounts and immutable submission metadata.
- The student is modelled as a pseudonymous beneficiary reference; the applicant is the authenticated parent/guardian. The policy rejects student-as-borrower submissions and unnecessary student identity fields.
- Only UGX is enabled in this initial intake boundary. Amounts are represented as safe integer currency units; requests cannot exceed the declared invoice outstanding amount.
- Unique idempotency and duplicate-invoice/beneficiary fingerprints protect application submission against repeat requests. The backend derives tenant and actor identity from authenticated request context, not client-supplied identity fields.
- The service uses the existing audit service and provides applicant-only list access scoped by tenant and authenticated user.
- The API mounts at `/api/v1/edufinance` through the canonical authenticated and tenant-authorized route registry. The application endpoints require explicit permissions and `TITECH_EDUFINANCE_APPLICATIONS_ENABLED=true`.
- The UI exposes `/edufinance`, adds the service to the existing navigation, and uses the existing translation namespace and semantic official-brand tokens.
- The 8 November increment connects a guarded parent/guardian intake form and applicant-only request history to the canonical `/api/v1/edufinance/applications` endpoints through the existing shared API client. The browser-facing `VITE_TITECH_EDUFINANCE_APPLICATIONS_ENABLED` switch defaults to `false`; it only controls presentation and cannot override the server-side `TITECH_EDUFINANCE_APPLICATIONS_ENABLED` gate.
- The intake UI accepts school-issued references and UGX whole-shilling declarations only, excludes student names/identity details from the submitted payload, checks the requested amount against declared invoice outstanding before submission, and sends an `Idempotency-Key`. These checks are convenience controls; the backend remains authoritative.
- An index-creation command is provided: `npm run db:indexes:edufinance` (requires the approved MongoDB URI and an appropriately prepared database).

## 8 November 2026 frontend integration increment

The public EduFinance information route now conditionally exposes a signed-in applicant intake workspace only when the frontend presentation flag is enabled. The workspace submits to the canonical authenticated tenant API and loads only the current applicant's requests. It displays school, invoice and guardian verification states returned by the server rather than claiming that a submitted reference is verified. A retry of an unchanged payload reuses the same in-memory idempotency key; changing the payload causes a new key to be issued. No credentials or identity tokens are stored by the new feature.

The new pure form-policy helper is covered by five Node built-in tests. The JSX bundle, authenticated browser flow, API deployment, persistence, concurrency behaviour, and server flag combination still require execution under the supported frontend/runtime environment.

## What this implementation explicitly does not establish

The current slice does **not** implement or prove the complete lifecycle in the business master prompt. In particular it does not yet provide:

- an authoritative school registry, legal-school verification, or beneficiary-account validation;
- integration to authoritative student information, school billing or invoice systems;
- independent verification that the submitted invoice is genuine, current, outstanding or not already financed elsewhere;
- guardian authority adjudication or a completed child-data consent workflow—the request captures evidence references for subsequent review only;
- KYC/AML provider integration or completed identity verification;
- lender facility setup, approved credit policy, affordability/underwriting, or a credit decision;
- loan offer, regulated disclosure, contract generation, signature or agreement acceptance;
- lender approval, disbursement, payment-provider calls, school receipt, settlement evidence or a booked loan;
- repayment schedule, collection, repayment allocation, loan servicing, restructuring, write-off, refund or loan closure;
- lender-specific accounting mappings, journal posting, or financial reconciliation for an EduFinance loan.

The existing canonical TITech loan, payment, financial-transaction, ledger and reconciliation services remain the only permitted future execution path. Before a school disbursement or repayment feature is added, the implementation must map and prove that journey against those canonical services and the responsible lender's accounting policy.

## Role and safeguarding boundary

The parent or legally authorized guardian is the applicant/borrower candidate. The student is the education beneficiary, not automatically a borrower. Student identifiers are minimized and the beneficiary reference is excluded from ordinary model selection and response DTOs. Schools must not receive the parent's wider financial circumstances. Refugee and host-community participants can only be onboarded through lawful, appropriately authorized partner processes, accepted identity evidence and purpose-specific consent; no special exemption from KYC, child safeguarding or data-protection duties is implied.

## Relationship to existing education support and insurance

Education-support campaigns are a separate community-support / fundraising workflow. They are not fee-financing loans and must not be booked as loan proceeds or repayments. Inclusive-insurance institution, licence, product, enrolment, premium-obligation and claims references are also a separate regulated-partner workflow. Insurer onboarding or a product record does not establish insurer authorization, policy issuance or live premium collection. Insurance must remain under the existing partner/licence/capability controls.

## Feature flags and operating posture

The `.env.example` switches for application intake, live disbursement, live repayments, automated credit decisioning, lender approval, regulatory approval and production approval are all `false`. Intake is also checked server-side and cannot be activated by a frontend flag. The existence of configuration flags does not confer regulatory authority, partner permission, access to capital or payment-provider credentials.

The organization display/configuration is updated to **TITech Capital LTD** at the user's direction. `identityStatus` remains `PENDING_EXTERNAL_DOCUMENTARY_VERIFICATION`; postal data remains user-supplied and unverified. Qualified counsel must determine TITech's legal classification, data-controller/processor roles and any licensing obligations for the actual operating model. The relevant lender, provider, school and insurer remain responsible for activities reserved to them by law and contract.

## Verification completed for this archive

- EduFinance policy and route-contract tests: 15/15 passed on Node 22.16.0.
- Existing education campaign tests: baseline run 10/10 passed before this incremental change.
- Existing inclusive-onboarding tests: baseline run 24/24 passed before this incremental change.
- Official theme audit: PASS; no hard-coded official palette colors remain in non-brand CSS.
- Organization profile gate: PASS.
- Legal branding verifier: PASS after correcting its check to accept the centralized canonical organization-profile reference.
- Backend EduFinance modules and canonical router passed `node --check` syntax checks.

These are source/unit/static checks only. The runtime gate is BLOCKED because this execution environment provides Node 22.16.0/npm 10.9.2 while the repository requires Node >=24.15.0/npm >=11. Dependencies are not installed in this environment. MongoDB, Redis, database indexes, API startup, React/Vite builds, full integration, browser E2E, provider sandbox and external approvals were not run or proven.

## Safe next implementation sequence

1. Run the project under the declared Node/npm runtime and install from lockfiles without dependency overrides.
2. Verify MongoDB replica-set requirements and install indexes in a non-production database after backup.
3. Connect this intake model to verified existing institution/school, guardian consent, secure-document and KYC records (do not accept caller-asserted verification as proof).
4. Complete school invoice verification and cross-product duplicate-financing controls.
5. Map lender-specific facility, credit policy, maker-checker and agreement evidence to the existing canonical loan service.
6. Design school disbursement and repayment adapters against existing payment orchestration and settlement; retain UNKNOWN on indeterminate provider outcomes.
7. Map lender-specific booking and repayment accounting into the canonical financial transaction and double-entry ledger, then prove reconciliation and closure.
8. Add MongoDB/Redis integration tests, full E2E, cross-tenant security, failure/concurrency tests, restore drills and external partner/legal evidence.
9. Keep live-money flags disabled and `productionApproved=false` until independent technical, operational, lender, provider, legal, security and customer acceptance has been documented.
