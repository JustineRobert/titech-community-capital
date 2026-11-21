# Refugee/host-community and insurance enablement boundary

The supplied repository contains identity onboarding, refugee-partner and insurance source modules. The canonical route registry mounts the partner and insurance routers behind existing authentication and tenant authorization; participant onboarding is similarly mounted behind the existing security boundary. The route-level capabilities use explicit feature gates and action permissions.

The shipped `backend/.env.example` keeps the following switches false:

- `TITECH_REFUGEE_ONBOARDING_ENABLED`
- `TITECH_REFUGEE_PARTNER_ONBOARDING_ENABLED`
- `TITECH_INSURANCE_ONBOARDING_ENABLED`
- `TITECH_INSURANCE_OPERATIONS_ENABLED`
- `TITECH_INSURANCE_LIVE_PREMIUM_PROCESSING_ENABLED`
- `TITECH_INSURANCE_LIVE_FINANCIAL_APPROVED`

The insurance policy requires both live-premium processing and financial approval configuration; the relevant unit tests also assert the payment adapter is not registered. The existence of these software modules does not establish their runtime production configuration, insurer authority, distribution permission, legal compliance, safeguarding assurance or partner readiness.

Refugee and host-community participants should be onboarded only through verified, appropriately authorised institutional partners under approved consent, purpose limitation, privacy, safeguarding, retention, complaints and data-subject procedures. Insurance decisions, underwriting, policy issuance, premiums and claims must remain under an authorised insurer and appropriately authorised intermediaries. TITech must not represent itself as an insurer, underwriter, deposit-taker, lender or licensed payment provider by virtue of software capability.

**No feature flag was enabled in this execution. No live participant, insurance, premium or claims journey is certified.** Partner/legal/regulator sign-off and operational evidence remain external release requirements.
