# Refugee/host-community partner and insurance evidence — 22 November 2026

## Current status

Existing inclusive identity/onboarding, institutional partner and insurance modules remain in the repository and their route contracts are present in the canonical authenticated API registry. This execution made no policy/feature-flag changes.

## Test evidence

`node --test backend/tests/unit/inclusive-onboarding/*.test.mjs` passed **27/27** selected tests. The suite covers partner/insurer lifecycle policy, explicit identity/authorization separation, expiry/revocation behavior, consent withdrawal and cross-tenant consent handling, private evidence access and malware scanning fail-closed behavior, and premium capability boundaries.

## Feature flags

The shipped backend templates keep these capabilities disabled:

- `TITECH_REFUGEE_ONBOARDING_ENABLED=false`
- `TITECH_REFUGEE_PARTNER_ONBOARDING_ENABLED=false`
- `TITECH_INSURANCE_ONBOARDING_ENABLED=false`
- `TITECH_INSURANCE_OPERATIONS_ENABLED=false`
- `TITECH_INSURANCE_LIVE_PREMIUM_PROCESSING_ENABLED=false`
- `TITECH_INSURANCE_LIVE_FINANCIAL_APPROVED=false`

No environment flag was enabled in this run.

## Authorization and operating boundaries

- A partner registration submission is not proof of verified legal status or programme authorization.
- Refugee/host-community participant onboarding must be conducted only through verified, scoped, appropriately authorized institutional partners with explicit purpose-specific consent and safeguarding controls.
- Consent withdrawal must be respected; no tenant may read another tenant's participant records.
- A submitted insurer profile/licence document is not independent authorization. Actual source, territory, licence activity, validity and expiry must be reviewed and recorded by a separate authorized reviewer.
- Insurance decisions, underwriting, policy issuance, claims adjudication and regulated distribution remain under appropriately authorized insurers/partners.
- TITech is not made an insurer, lender, deposit-taker or payment service provider by implementing software.

## Premium collection

Live premium processing remains disabled because no canonical insurance-specific payment adapter is registered and verified. The tests assert that even enabled-looking feature switches cannot activate live premium processing in the absence of the adapter. A UI request, payment-initiation acknowledgement or unverified callback must not be treated as settlement.

## Not evidenced

No real partner KYC/authorization file, active insurer licence, distribution permission, programme safeguarding sign-off, regulatory approval, policy issuance, real premium collection, provider settlement or claims payout was independently verified. No live participant data or documents were accessed.

## Release boundary

Keep all flags false until independent partner/insurer/legal/regulatory authorization, privacy and safeguarding review, real canonical payment/settlement integration, audit and reconciliation E2E are complete.
