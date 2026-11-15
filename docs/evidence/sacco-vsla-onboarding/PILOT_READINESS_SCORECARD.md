# Pilot Readiness Scorecard — 15 November 2026

**Decision:** NOT READY / do not activate a financial pilot.  
**Production flag:** `productionApproved=false` (unchanged).

| Control | Current evidence | Status |
|---|---|---|
| Product and organization identity | Shared frontend/backend brand contracts and official theme updated; entity details are user-supplied and not independently verified | IMPLEMENTED / documentary verification pending |
| Supported group classifications | Twelve model enums, active form list and controller now share one list; test source check passes | IMPLEMENTED / SOURCE TESTED |
| Institution onboarding application | Legacy SACCO lifecycle implementation exists but router and registration page are not in active route registry | BLOCKED / INCOMPLETE |
| Institution due diligence | Partial legacy/insurer profile structures; no unified active review/evidence workflow proven | BLOCKED |
| Tenant provisioning | Existing tenant/auth context primitives; no institution onboarding provisioning flow proven | BLOCKED |
| Staff/RBAC setup | Existing canonical roles, permissions and tenant invitations; pilot onboarding orchestration not proven | PARTIAL |
| Group create/list/details | Active UI/API routes exist; type set reconciled; duplicate conflict exists | PARTIAL / API E2E not run |
| Durable group creation idempotency | UI submit guard and tenant-scoped unique-name conflict; no proven server Idempotency-Key/lost-response resolver | BLOCKED |
| Join requests and approvals | Existing state transitions and permissions in source; integration test updated but unexecuted | IMPLEMENTED IN SOURCE / NOT INTEGRATION TESTED |
| KYC and consent | Member/KYC, consent and identity onboarding slices exist; full joined journey not proven | PARTIAL |
| Refugee-serving partner path | Partner and participant identity modules are mounted and feature-gated | IMPLEMENTED IN PARTS / EXTERNAL REVIEW PENDING |
| Insurer onboarding | Institution profile/licence workflow and routes present | IMPLEMENTED IN PARTS / AUTHORITY AND CONTRACT EVIDENCE PENDING |
| VSLA/ROSCA/Chama financial semantics | Classifications exist; separate contribution-cycle, share-out and payout-rotation engines not proven | BLOCKED |
| Group financial account mapping | Mongoose Group has no account reference; legacy Sequelize GroupWallet not proven connected | BLOCKED |
| Contribution UI and provider journey | Unsupported GroupDetails route removed; canonical contribution API exists but no provider call in controller | BLOCKED |
| Provider verification/settlement | No sandbox/live provider evidence available | BLOCKED_EXTERNAL_CONFIGURATION |
| Ledger balance | Controller now fails closed pending account mapping | BLOCKED |
| Reconciliation/receipt end-to-end | Existing financial components present, but group workflow not run | NOT VERIFIED |
| Tenant isolation | Group-wallet read guard implemented and integration assertions added; tests unexecuted | IMPLEMENTED / NOT SECURITY ASSESSED |
| Dashboard official theme | Theme audit PASS; dashboard bridge added | SOURCE VERIFIED / VISUAL CHECK PENDING |
| Mobile and accessibility | CSS has responsive and focus support; browser evidence not available | NOT VERIFIED |
| Persisted pilot management | Only pure readiness helper found; no full persisted pilot API/UI | BLOCKED |
| Operations/backup/recovery | Source configs/runbooks exist; no operational drill run | NOT VERIFIED |
| Supported runtime | Environment is Node 22.16/npm 10.9; repo expects Node 24.15/npm 11 | BLOCKED |
| Build and full suites | Not executed | NOT VERIFIED |
| Partner/legal/regulatory/privacy approval | Not supplied or independently verified in this run | EXTERNAL APPROVAL PENDING |

## Quantitative policy

No readiness percentage is calculated from weighted or assumed values. Missing metrics remain unknown. No pilot activity, group, member, transaction, value or reconciliation figures have been invented.

## Minimum exit criteria

The pilot cannot progress to financial activity until the supported runtime and test services are available, the institutional route and approval model is made operational, tenant isolation passes, group-to-account mapping is canonical, idempotent contribution/unknown-outcome recovery works, authorized provider sandbox tests pass, journal/statement/receipt/reconciliation agree, and required partner/legal/privacy/security approvals are evidenced.
