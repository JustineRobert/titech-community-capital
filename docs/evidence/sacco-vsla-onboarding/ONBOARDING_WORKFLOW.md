# Institutional and Group Onboarding Workflow — Actual State

## Existing implemented slices

### Public institutional lead intake

- `InstitutionalLead` persists consented public demo/contact requests, a source, a submission key, a payload fingerprint, status history and assignment references.
- The public institutional-lead API is mounted under `/api/v1/public/institutional-leads`.
- This is lead management only. It must not be promoted to a legal institution application, due-diligence result, tenant or institution approval.

### Legacy SACCO onboarding package

- `backend/modules/onboarding/onboarding.constants.js` defines `DRAFT`, `VERIFICATION`, `KYC_PENDING`, `KYC_APPROVED`, `SUBSCRIPTION`, `GO_LIVE_REVIEW`, `LIVE`, `SUSPENDED` and `REJECTED`.
- The module includes validation, controller, service, model and route files.
- Its route module is CommonJS and has optional/fail-closed enterprise middleware integration logic.
- The inspected `backend/routes/index.js` does not mount this router. The active frontend `AppRoutes.jsx` does not register `SaccoRegistration.jsx`.
- Therefore, this implementation is not proven as a reachable active institutional onboarding flow in the current app.

### Refugee / host-community and insurer capabilities

- `identity-onboarding` is mounted under `/api/v1/participant-onboarding`; credential, appeal and insurance-consent mutation routes are feature-flagged and permission-checked.
- `refugee-partners` is mounted under `/api/v1/refugee-partners`; submission and review are feature-flagged and permission-checked.
- `insurance` is mounted under `/api/v1/insurance`; `InsuranceInstitutionProfile` tracks organization type, jurisdiction, competent authority, licence state, verification source/actor/time, agreement references, integration readiness and approval history.
- These are separate bounded capability slices, not proof of one unified institution onboarding workflow or external legal authorization.

## Recommended canonical lifecycle boundary

The desired stage model from the master engineering brief should be adopted by extending and mapping the existing onboarding model, not by creating an `InstitutionV2`/`OnboardingV2` system:

`LEAD → APPLICATION → QUALIFICATION → DUE_DILIGENCE → AGREEMENT_PENDING → VERIFIED → CONFIGURATION → STAFF_SETUP → GROUP_ONBOARDING → MEMBER_ONBOARDING → PILOT_REVIEW → PILOT_READY → PILOT_ACTIVE → PILOT_REVIEW/CLOSED`.

The legacy statuses above should be mapped explicitly with migration tests if and when the unmounted onboarding module is reactivated. Legal status, regulatory licence status, technical verification, partner contract status and operational activity must remain separate fields and separate gates. A selected `sacco` group type is only a classification.

## Required evidence and reviewer controls before activation

For an actual institution application, persist:

- Organization identity and legal form; jurisdiction; registration reference; operating address and contacts.
- Authorized representative and governing body references.
- Document type, private document reference, upload/checksum metadata, version, expiry and evidence state.
- Reviewer assignment, comments, immutable decision history, decision reason, actor and timestamps.
- Partner contract/DPA references and explicitly approved activities, geography, transaction limits and expiry.
- Separate legal verification and any required competent-authority/licence verification result.
- Tenant-provisioning decision and safe relationship to existing tenant model.

Uploaded evidence must begin as submitted/pending and never auto-verify. The source files inspected do not establish that this unified evidence workflow is currently mounted and complete.

## Tenant provisioning principles

- Use existing `Tenant`, trusted authenticated tenant context, `tenantAuthorization` and the canonical RBAC policy.
- A request body's tenant ID must never override authenticated server-side tenant context.
- A community group may be associated with an approved sponsor tenant where the legal/operating arrangement permits it.
- A community group should not automatically become a newly licensed/independent tenant.
- Tenant creation, role assignment and invitation should be separate audited actions.
- `productionApproved` and regulated activity flags remain false/disabled until the relevant evidence is independently validated.

## Current user journey gaps

| Journey | Current repository position |
|---|---|
| Register a public institutional lead | Mounted public intake exists |
| Submit a legal institution application with document evidence | Legacy SACCO UI/API exists in unmounted/unclear path; not end-to-end verified |
| Review/verify an institution | Legacy and insurer-specific pieces exist; no unified active flow verified |
| Provision tenant from approved institution | No integrated flow proven in current route registry |
| Configure approved staff roles | Existing tenant/RBAC/invitation primitives; institution-specific wizard not proven |
| Create groups and invite members | Active group route and UI exist |
| Participant identity/consent/refugee partner evidence | Feature-specific mounted modules exist; feature flags and partner policies apply |
| Start and operate pilot | Readiness helper exists; persisted pilot module/routes and end-to-end UI are not present in inspected active registry |

## Privacy notes for refugee and host-community use

Identity and alternative credential workflows must remain purpose-limited, permission-gated, reviewed, and subject to consent/legal basis. No personal identity information may be repurposed for credit, insurance or other eligibility without a separate lawful and consented basis. No full identity document data should be copied into logs, dashboards, analytics or group membership lists. The current execution did not run privacy-impact or legal review.
