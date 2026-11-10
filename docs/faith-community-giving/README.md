# TITech Faith & Community Giving

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Product division:** TITech Faith & Community Giving  
**Tagline:** One Platform. Every Contribution. Full Accountability.  
**Engineering principle:** BUILD LESS. PROVE MORE.

## Purpose

This module adds a shared, tenant-scoped campaign governance foundation for churches and religious institutions, burial and bereavement committees, wedding and traditional introduction committees, family/community associations, NGOs and charitable organisations. It is an additive capability within TITech Community Capital; it is not a separate fundraising product or a separate ledger.

Initial campaign categories include church tithes and offerings, thanksgiving and donations, church projects, missions and ministry, burial/bereavement support, weddings and traditional introductions, community functions, emergency/medical assistance, education and school fees, humanitarian work, community development and welfare.

## Current implemented slice

| Capability | Current state |
|---|---|
| Campaign policy and validation | Implemented; pure policy tests included |
| Campaign records | Implemented with strict Mongoose schema, immutable tenant ownership and optimistic concurrency |
| Campaign lifecycle | Draft → submitted → independent review → approved/rejected → publish; pause and close controls |
| Tenant access | Existing authentication and tenant middleware; every protected domain query is tenant-scoped |
| Action permissions | Existing platform permission middleware with dedicated Faith Giving roles |
| Audit | Mutations write the existing audit service in the same MongoDB transaction session |
| Public campaign directory | Read-only allow-listed public DTO; excludes tenant/destination/partner evidence references and private budget reservation values |
| Refugee/host scope | Submission/public display requires an existing verified partner profile and an approved humanitarian/community programme scope; individual campaign authorisation evidence and reviewer safeguarding attestation are also required |
| Pledge records | Tenant-scoped, idempotency-key-protected commitments; a pledge is not money received or revenue |
| Expense requests | Evidence-referenced requests with independent review; pending and approved requests reserve budget-line headroom transactionally; rejection releases the reservation |
| Brand | Reuses central official theme tokens and the established circular TITech mark; all nine official colour roles are represented in the module |
| Feature flag | `TITECH_FAITH_GIVING_ENABLED=false` by default |

## Deliberately not enabled / not implemented in this slice

- No MTN MoMo, Airtel Money, bank transfer or card payment initiation.
- No provider callback signature processing, provider outcome verification or settlement evidence.
- No financial transaction creation, ledger posting, balance mutation, receipt issuance, refund, real disbursement or reconciliation is implemented here.
- No automatic recurring payment mandate, QR/USSD collection or guest payment checkout.
- No fulfilment or payment conversion endpoint for pledges. Pledges remain separately classified commitment records.
- An approved expense request is not a payment or an accounting expense posting. No payable settlement, proof-of-payment or vendor payment flow exists in this module.
- There is no campaign closing financial statement. Closing a campaign changes its lifecycle state only; a verifiable closing statement needs the canonical financial event, ledger, settlement and reconciliation pipeline.
- The present management UI covers campaign drafting, submission, review and lifecycle controls. Pledge and expense REST endpoints exist, but complete contributor/committee user journeys and reporting UI remain incomplete.
- Organisation onboarding, registry verification, branch/diocese hierarchy, member directory, committee invitation/access-revocation, receipts/statements, notification delivery, complaints, public QR links, exports, subscriptions and AI intelligence are not claimed as implemented by this slice.
- KES, TZS, RWF, USD and other currencies are not enabled. UGX integer minor units are the only enabled amount currency in this release.

These boundaries are intentional. A successful campaign write, pledge, review, or public listing must not be described as a successful collection, a verified donation or proof that funds have settled.

## Routes

All routes use the existing `/api/v1` router. Both public and authenticated routes are fail-closed behind `TITECH_FAITH_GIVING_ENABLED`.

### Public (read-only)

- `GET /api/v1/faith-giving/public`
- `GET /api/v1/faith-giving/public/:publicReference`

Public responses are mapped through `toFaithGivingPublicDTO`. No tenant ID, private destination reference, organizer document reference, partner authorization reference or donor/beneficiary identity is returned. `collectionStatus` is always `NOT_ENABLED` in this implementation.

### Authenticated and tenant-scoped

- `GET /api/v1/faith-giving`
- `POST /api/v1/faith-giving`
- `PATCH /api/v1/faith-giving/:campaignId`
- `POST /api/v1/faith-giving/:campaignId/submit`
- `POST /api/v1/faith-giving/:campaignId/review`
- `POST /api/v1/faith-giving/:campaignId/publish`
- `POST /api/v1/faith-giving/:campaignId/pause`
- `POST /api/v1/faith-giving/:campaignId/close`
- `GET /api/v1/faith-giving/:campaignId/pledges`
- `POST /api/v1/faith-giving/:campaignId/pledges` (requires `Idempotency-Key`)
- `POST /api/v1/faith-giving/:campaignId/pledges/:pledgeId/cancel`
- `GET /api/v1/faith-giving/:campaignId/expenses`
- `POST /api/v1/faith-giving/:campaignId/expenses`
- `POST /api/v1/faith-giving/:campaignId/expenses/:expenseId/review`

### Campaign lifecycle

`DRAFT → SUBMITTED → APPROVED → PUBLISHED → PAUSED → PUBLISHED/CLOSED`

A rejected campaign may return to `DRAFT`. Changes to campaign content reset approval and require a fresh review. Campaign creators cannot review their own campaign. Editing a paused/published campaign is blocked to preserve review and existing budget reservations.

### Role model

The module uses existing `authenticate`, `tenantAuthorization` and `requirePermission` middleware. Dedicated action roles are `FAITH_GIVING_ADMIN`, `FAITH_GIVING_REVIEWER`, `FAITH_GIVING_TREASURER` and `FAITH_GIVING_COMMITTEE_MEMBER`; platform roles include `PLATFORM_ADMIN`, `TENANT_ADMIN`, `COMPLIANCE_OFFICER` and `AUDITOR`. The management route is also hidden behind a frontend role check, but the backend action permission is authoritative. No frontend visibility check is a security boundary.

## Refugee and host-community safeguard

Campaigns marked `REFUGEE_AND_HOST_COMMUNITIES` are blocked at submission and public display unless the campaign tenant has a current `VERIFIED` `RefugeeServingOrganisationProfile` with one of the community/humanitarian scopes defined in `FAITH_GIVING_PARTNER_SCOPES`. The campaign also requires a campaign-specific partner authorization evidence reference and independent partner safeguarding attestation before approval/publication. If partner verification is no longer active, the campaign is omitted from the public directory and its public detail read is denied.

This does not certify an organisation, establish refugee status, replace case-by-case consent, determine eligibility for support, or prove statutory authority. The profile and campaign evidence must be independently reviewed by authorised staff and supported by lawful partner arrangements. Do not place individual refugee or beneficiary names, identity numbers, case details, telephone numbers or private documents in public campaign fields.

## Insurance boundary

The module does not onboard insurers, sell/issue insurance, arrange distribution, assess risk, underwrite, collect premiums or adjudicate claims. Existing insurance-domain functionality and feature flags remain separate. Insurance-related offerings or campaigns may proceed only through authorised insurers and properly authorised intermediaries with applicable Uganda and destination-market approvals. TITech software capability alone creates no insurer, underwriting, distribution, payment or trustee authority.

## Data and money rules

- All campaign, pledge and expense records are tenant-scoped. `tenantId` is immutable in the campaign models.
- MongoDB transactions are used for state changes and same-session audit writes; the deployed MongoDB topology must support transactions (normally a replica set or a compatible sharded deployment).
- Amounts use JavaScript safe integers and the configured UGX integer precision. Floating-point money is not used.
- Budget request headroom is recorded on the campaign's budget line. New pending requests reserve headroom; rejected requests release their reservation; approved requests remain reserved. Updating campaign budgets is disabled after publication/pause so existing reservations cannot be silently rewritten.
- The reservation is a governance limit only. It is not an accounting journal, disbursement, payable, cash balance or proof of money movement.
- Pledge amounts are not counted as collections. There is no contribution/receipt/financial transaction model introduced by this module.

## Configuration and index creation

Set `TITECH_FAITH_GIVING_ENABLED=false` in the backend environment by default. Do not enable it in production merely to expose the pages. Enabling public reads requires a reviewed tenant setup, approved partner evidence, privacy/safeguarding controls, and release approval. Actual payment features require a separately reviewed integration to the established canonical payment, financial transaction, double-entry ledger, receipt, outbox and reconciliation services.

Create indexes only against the intended database after backup/review:

```bash
npm --prefix backend run index:create:faith-giving
```

The index script requires `MONGODB_URI` or `MONGO_URI`. It does not migrate historical transactions or alter existing ledger balances.

## Testing

Pure domain policy tests:

```bash
node --test backend/modules/faith-community-giving/faithGiving.policy.test.js
```

Static integration contract:

```bash
node scripts/faith-giving-contract-gate.mjs
```

The above do not replace Mongoose/replica-set integration, HTTP/API, provider, payment, ledger, reconciliation, tenant penetration or browser E2E testing. See `docs/evidence/enterprise-readiness/FAITH-COMMUNITY-GIVING-IMPLEMENTATION-2026-11-10.md` for the current execution record and blockers.
