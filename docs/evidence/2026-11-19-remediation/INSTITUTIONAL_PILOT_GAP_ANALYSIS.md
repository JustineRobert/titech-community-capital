# Institutional onboarding and community-group pilot gap analysis

This assessment distinguishes existing source files from workflows that are actually mounted, persisted and tested. A model, component or unmounted route module is not by itself an operational feature.

## Existing implementation ownership observed in the source

- The canonical frontend remains React/Vite and uses the existing application route registry.
- The canonical backend remains Express/Node with Mongoose, MongoDB, Redis, JWT/cookie authentication and the established tenant/RBAC middleware.
- The canonical Group model already recognises community group types including VSLA, SACCO, Chama, ROSCA and cooperative profiles. Existing group-management routes/controllers and frontend group screens are present.
- Existing group financial reads use authorization and fail closed rather than synthesizing a zero balance when a financial source is unavailable.
- The repository contains inclusive/refugee-host community onboarding and insurance-related modules. The presence of those modules does not prove partner authorization, insurer appointment, lawful distribution authority, or an active community pilot.
- An older `backend/modules/onboarding` SACCO implementation is CommonJS and is not mounted by the canonical route registry. The older frontend SACCO registration page is not connected in the main app route map. Its presence is not evidence of a complete institution onboarding workflow.
- `backend/models/InstitutionalLead.js` represents a lead/intake concept, not the full institution application, due-diligence, signed agreement, tenant provisioning and activation lifecycle.
- The pilot code is a read-only readiness helper. No complete persistent pilot model/CRUD API/permissions/dashboard/operational timeline was found in the source inspected for this pass.

## Functional gaps preventing the requested end-to-end claim

| Domain | Existing source position | Work still required |
|---|---|---|
| Institution registration and due diligence | Lead/onboarding artifacts exist; legacy SACCO flow is unmounted. | Canonical tenant-aware application, document review, verification history, reviewer permissions, rejection/resubmission and evidence expiry. |
| Tenant provisioning | Existing tenant and RBAC foundations exist. | Authorized, auditable provisioning workflow linked to institution approval and sponsor/parent institution policy. |
| Institution staff and invitations | Existing user/RBAC primitives exist. | End-to-end invitation, role assignment, least-privilege acceptance and revocation under institutional authorization. |
| Community group management | Canonical Group model/routes and UI support several group types. | Distinct type-specific cycle state machines, rules, schedule and closure semantics; governance approvals and immutable snapshots. |
| VSLA | Group type exists. | Savings share accounting, meeting cycles, social fund if applicable, controlled internal loans only where lawful/authorized, cycle close and share-out. |
| ROSCA / Chama | Group type exists. | Persisted payout rotation, order, obligations, arrears/missed contributions, recipient confirmation and cycle completion. |
| SACCO | Group type and institution-related code exist. | Member-number/share/account configuration and product/transaction approvals tied to verified institution authority. |
| Member onboarding | Member records and membership/identity features exist. | One connected invite/register/KYC/consent/review/approval lifecycle, safe bulk imports and verified status handling. |
| Contributions | Contribution and payment-related source exists. | Complete provider adapter execution, verified outcome, settlement evidence, canonical financial transaction, balanced ledger, receipt, reconciliation and reversal proof. |
| Pilot management | Read-only readiness helper only. | Persistent pilot records, API/RBAC, task ownership, environment/limits, training, incidents, measured metrics, activation review, suspension and closeout. |
| Refugee and host communities | Inclusive onboarding source modules exist. | Human-reviewed partner policy, alternative credential approval, purpose-limited identity data, translation/accessibility review and an evidenced partner-led pilot. |
| Insurance | Insurance-related module/source exists. | Actual insurer/authorized intermediary agreements, product and distribution authority, disclosures, consent, claims/referral boundaries and external approval evidence. |

## Financial controls that must remain fail-closed

Do not mark a contribution settled from a client request, manual record, callback without authenticity validation, provider initiation or timeout. A future implementation must follow the canonical payment and ledger path, preserve integer minor units, enforce idempotency, support UNKNOWN outcomes, write balanced double-entry journals, record reversals and reconcile against settlement evidence. Manual cash entries must be labelled as manually recorded evidence and approved/reconciled under institutional policy.

The current remediation did not create payment records, initiate MoMo/Airtel/bank transfers, alter ledger balances or claim a live provider test.

## Safest next implementation sequence

1. Upgrade the build environment to the repository's pinned Node/npm baseline and install exact lockfile dependencies.
2. Re-run startup diagnosis and confirm route imports with all actual dependencies present; reproduce the route import chain and Mongoose tests at runtime.
3. Establish the canonical institution onboarding domain model/API and permission matrix by reusing Tenant, Institution/Lead, user, identity and document services. Retire no legacy code until its data and ownership are mapped.
4. Connect authorized institution approval to tenant provisioning and staff invitations.
5. Extend existing Group model/services with separate VSLA, ROSCA/Chama and SACCO cycle workflows, each with its own unit and integration tests.
6. Connect member onboarding and consent to group activation; prove two-tenant isolation and document access restrictions.
7. Complete the contribution-to-settlement-to-ledger-to-reconciliation integration in provider sandbox, preserving UNKNOWN and reversal handling.
8. Add the persistent pilot model/API/dashboard, explicit task evidence and human approvals, measurement definitions, incidents and exit workflow.
9. Browser-test the complete flow at all specified widths and both themes; capture screenshot and accessibility evidence.
10. Obtain actual institution, data protection, provider, insurer, legal and regulatory approvals applicable to the chosen use case before activating any controlled or regulated activity.
