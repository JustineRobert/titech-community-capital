# Refugee/host-community and authorised-insurer operating boundaries

## Community inclusion model

TITech Community Capital may provide secure institutional software workflows for refugee and host-community participants only through legitimate, appropriately authorised institutional partners (for example, verified refugee-serving organisations, NGOs or community institutions operating within their mandate). A participant's use of TITech does not itself establish eligibility for a service, refugee status, legal identity, entitlement to assistance or regulatory status. Assisted onboarding must preserve dignity, informed consent, data minimisation, purpose limitation, confidentiality, safeguarding, complaint/appeal routes and appropriate retention/deletion controls.

Partner onboarding must require authoritative organisational evidence and an authorized reviewer. Applicant users must not approve their own organisation. Partner identity, operating jurisdiction, mandate, data-sharing basis and programme scope must be confirmed outside the fact that the software accepts a record. No organization should be treated as approved merely because a profile is saved.

## Host-community participation

Host-community participants may be included in the same institution-led service design where the approved partner programme supports them. Eligibility rules must be explicit, fair, documented and governed by the partner's mandate. Avoid unnecessary disclosure or collection of sensitive displacement-related data. Do not make access to core community-finance records conditional on accepting unrelated insurance or data-sharing purposes.

## Insurance partner model

The platform may support insurer institution profiles, licence review, products, participant consent, enrolment evidence, claims workflow and reconciliation references. Restricted insurance activities must require a current, independently verified, non-expired authorization for the relevant jurisdiction, product and distribution role. A licence record must be checked by an authorized reviewer and must not be treated as verified based solely on a client-submitted status value.

Underwriting, policy acceptance, policy issuance, premium decisions, claims decisions and coverage commitments remain under the appropriately authorized insurer and properly authorized distribution/intermediary parties. TITech's workflow, database record or generated receipt cannot substitute for an insurer's actual policy or decision. Premium movement must not be enabled until a verified canonical payment adapter, financial posting/reconciliation path, provider contract, operational configuration and independent approvals are present.

## Current code controls observed

- Refugee partner and insurance routes are registered through the existing canonical route registry and existing authentication/tenant/permission controls.
- Feature flags in `backend/.env.example` are false for refugee onboarding, partner onboarding, insurance onboarding, insurance operations, live premium processing and live financial approval.
- Insurance operations require a verified and non-expired licence.
- The insurance policy currently returns a blocked state for live premiums because a canonical premium payment adapter is not registered.
- The selected inclusive-onboarding/insurance tests pass 27/27.

## External requirements before enabling

A jurisdiction-specific legal/compliance review, verified partner/insurer documents, mandate and licence validation, approved data-sharing agreements, safeguarding/privacy and complaint procedures, staff training, secure evidence storage and retention, provider agreements, tested claims/premium reconciliation, and production-operational support must be evidenced. Regulatory permission must be assessed by qualified counsel/regulators; source code does not confer authorization.

**Current control decision:** keep the relevant flags disabled. No insurer, NGO, refugee-serving partner, host-community programme, regulator, premium provider or live insurance workflow is certified by this source assessment.
