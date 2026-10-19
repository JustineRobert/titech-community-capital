# TITech Capital LTD — Retirement and Pension Support Boundary

**Product:** TITech Community Capital  
**Legal-entity display configuration:** TITech Capital LTD  
**Initial jurisdiction:** Uganda  
**Status:** Source implementation and native contract tests added; live institutional and production approval not established.

## 1. Purpose and explicit limits

This module is a governed extension of TITech's existing multi-tenant application. It is a workflow, evidence-tracking and reconciliation-support capability for government pensioners, NSSF members and former members, employer contribution assistance, eligible dependants/survivors and optional provider referrals.

It is **not** a pension administrator, an NSSF member database, an authority to adjudicate benefits, a government payroll interface, an insurer, a lender, a deposit-taking wallet or an independent financial ledger. Government pension authorities, NSSF and regulated providers remain authoritative for their own records, eligibility decisions, policy issuance, approvals and settlements.

## 2. Canonical integration points

- Frontend SPA route: `/retirement-support`, lazy-loaded by `frontend/src/App.jsx`, protected by the existing `ProtectedRoute` and linked from the canonical `Navbar`.
- API namespace: `/api/v1/retirement-support`, mounted in `backend/routes/index.js` behind the existing `authenticate` and `tenantAuthorization` middleware.
- Action permissions are additions to `backend/middleware/platformPermissions.js`; feature activation uses the canonical `requireCapabilityFlag` mechanism.
- Evidence uploads use the existing private-document service at `/api/v1/documents/upload` with purpose `RETIREMENT_SUPPORT_EVIDENCE`. The document store enforces capability checks, purpose-specific permission checks, tenant scope, file limits/signature checks and private storage.
- Identity checks read the existing canonical `KYC` record. The module does not create a parallel identity store or replace refugee-inclusive KYC.
- Audit events go through the existing audit service. Financial-support referrals are application records only; contribution evidence is tracked in dedicated retirement case/contribution records and is not a second ledger.
- Styling consumes the official TITech semantic CSS tokens. The nine supplied official colors and circular logo source assets are retained; new screens do not hard-code a new palette.
- The product name remains **TITech Community Capital**. The configured legal-entity name is **TITech Capital LTD**.

## 3. Domain records

### `RetirementSupportCase`

A tenant-scoped case distinguishes scheme (`UG_GOVERNMENT_PENSION`, `NSSF_UGANDA`, `EMPLOYER_SPONSORED`, `OTHER_APPROVED_SCHEME`), case category, current case state, private evidence references, privacy-notice acknowledgement, optional keyed fingerprint of a scheme reference, and bounded review history. A raw pension/scheme reference is not persisted by this workflow. Fingerprint matching is unavailable until `TITECH_RETIREMENT_REFERENCE_HMAC_KEY` is configured using a dedicated secret.

The state machine distinguishes draft/submitted/document review, identity state, scheme-check pending/confirmed, manual review, discrepancy, referral, rejected, withdrawn, expired and completed. A generic state change cannot mark a scheme verified. The specific verification route requires action permission, a source type/name/reference and an attributable decision. Identity-verified state requires the canonical KYC status to be `VERIFIED`.

### `RetirementContributionRecord`

Stores period-scoped expected employee/employer amounts, reported remittance amounts, currency, evidence references, a comparison state and a separate official scheme-credit state. Amounts are non-negative safe integers in configured currency minor units. `MATCHED` means the reported remittance values compare equal to expected values; it does **not** mean the pension scheme credited a personal account. Official credit is separately recorded with source and reference evidence. No assumptions about statutory rates are embedded.

### `RetirementFinancialSupportApplication`

Stores an optional request/referral with provider reference, status and an attributed provider decision when one is recorded. It cannot itself create a payment or ledger entry. Provider decisions require a source and external reference and are accepted only from a non-final application state. It does not calculate guaranteed pension income, decide an NSSF benefit or disburse funds.

## 4. State and source-of-truth rules

- Document present ≠ document authentic.
- TITech identity result ≠ authoritative scheme membership.
- Scheme confirmation ≠ benefit eligibility.
- Employer remittance evidence ≠ official member-account credit.
- Case submission ≠ official claim submission or approval.
- Financial-support request ≠ provider approval, contract, payout or settlement.
- An HTTP 200 or staff-entered reference alone is not proof of a real provider integration; each institutional source still requires documented authority and review controls.

Service and schema validations prevent state changes that lack the required server-side evidence and require source attribution for scheme confirmation and provider decisions. Every sensitive workflow action is emitted through the existing audit service. Case history is deliberately bounded; operational evidence must not grow without limit inside the hot case record.

## 5. Privacy policy gate

Pension and financial-support submissions require:

1. `TITECH_RETIREMENT_SUPPORT_ENABLED=true` after the capability is approved for the target environment.
2. `TITECH_RETIREMENT_NOTICE_VERSION` set to the reviewed privacy notice version.
3. `TITECH_RETIREMENT_PROCESSING_BASIS` set after qualified privacy/legal review to one supported server-side value: `CONSENT`, `CONTRACT`, `LEGAL_OBLIGATION`, `LEGITIMATE_INTEREST`, `PUBLIC_TASK`, or `VITAL_INTEREST`.
4. The user acknowledging the currently returned notice version in their selected supported language (`en`, `sw`, `fr`, `ar`). The server validates the acknowledgement and stores the version, language, timestamp and configured processing basis on the case/request. The browser cannot choose its own legal basis.
5. For optional identifier matching, a dedicated 32-byte base64 HMAC key in `TITECH_RETIREMENT_REFERENCE_HMAC_KEY`; it must not be reused from the JWT, refresh-token, KYC or document-encryption key set.

The notice text is an implementation draft and its `sw`, `fr`, and `ar` versions are translation drafts. All must be reviewed by qualified privacy/legal stakeholders and appropriate language reviewers before real personal-data pilot use. An acknowledgement is not blanket consent to marketing or unrelated data sharing; separately authorised data sharing must use the existing purpose-specific consent and access boundaries.

Missing privacy configuration or stale notice versions fail closed for submission. Feature flags do not bypass authentication, tenant checks or action permissions.

## 6. API capabilities implemented in source

All routes sit below `/api/v1/retirement-support`:

- `GET /readiness`
- `GET /capabilities` (permission-derived UI affordances; backend routes remain the authorization authority)
- `GET /me`
- `POST /cases`
- `GET /cases` (permissioned institutional queue)
- `GET /cases/:caseId`
- `POST /cases/:caseId/transition`
- `POST /cases/:caseId/verification`
- `GET /contributions`
- `POST /contributions`
- `POST /contributions/:contributionId/reconcile`
- `POST /contributions/:contributionId/scheme-credit`
- `GET /financial-support/me`
- `POST /financial-support`
- `GET /financial-support` (restricted institutional view)
- `POST /financial-support/:applicationId/provider-outcome`

The exact live availability depends on the authenticated actor's permissions, tenant context, the retirement capability flag, current privacy-policy configuration and private-document prerequisites. The route contract tests prove source-level wiring, not a live HTTP round trip.

## 7. Configuration example (no secrets)

Configure only through the deployment's approved secret/configuration system:

```dotenv
TITECH_RETIREMENT_SUPPORT_ENABLED=false
TITECH_RETIREMENT_NOTICE_VERSION=
TITECH_RETIREMENT_PROCESSING_BASIS=
TITECH_RETIREMENT_REFERENCE_HMAC_KEY=
```

The capability remains disabled by default. The HMAC key should be generated independently as 32 cryptographically random bytes and base64 encoded. Do not paste it into source control, tickets, logs or this document.

## 8. Multilingual behavior and branding

English is the default. Existing language infrastructure is reused for Swahili, French and Arabic; the page follows the document-level locale direction, with Arabic using RTL. Date display uses `Intl.DateTimeFormat` with the selected locale. The CSS uses the existing official theme variables and component tokens. Non-English notice wording has not been certified as a legal translation.

## 9. Test status and production blockers

Native tests cover scheme separation, controlled state transitions, canonical KYC evidence, integer amount validation, contribution comparisons, provider source attribution, route/middleware wiring, privacy-policy gates, private document purpose, and absence of shadow-ledger imports.

These tests do not establish that MongoDB indexes were created, migrations ran, the backend started, the browser route rendered under the production bundle, external institution systems were connected, or real payments were reconciled. The current environment has Node 22.16.0/npm 10.9.2 while the repository declares Node >=24.15.0/npm >=11.0.0; dependency directories are absent. Thus dependency-backed builds, full frontend/backend suites, database/Redis concurrency behavior, live provider tests and E2E remain unverified.

External approval still required/not established includes government pension integration, NSSF access and data sharing, NIRA or other identity provider access, employer/payroll access, provider agreements, approved scheme-policy sources, legal/privacy review, translation review, independent security review, backup/restore and rollback drills, pilot acceptance and formal production approval. This capability must not change global `PRODUCTION_APPROVED` status by itself.
