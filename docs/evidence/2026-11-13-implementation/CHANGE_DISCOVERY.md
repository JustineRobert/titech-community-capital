# Step-by-step folder and file change discovery — 13 November 2026

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Source:** supplied ZIP snapshot; no `.git` metadata, no remote push.

## 1. What to inspect first

1. `docs/evidence/2026-11-12-commercial-billing-remediation/EXECUTION_REPORT.md` — prior billing truth, 22 empty commercial paths and unverified financial-core wiring.
2. `docs/evidence/enterprise-readiness/NAVIGATION-GROUPS-REMEDIATION-2026-11-10.md` — prior group creation/join remediation and its evidence limits.
3. `docs/faith-community-giving/README.md` — existing campaign governance and new donation/pledge boundary.
4. `backend/modules/faith-community-giving/` — canonical campaign, pledge, policy, service, controller and router.
5. `frontend/src/pages/faith-community-giving/` — public donations page and manager.
6. `frontend/src/routes/AppRoutes.jsx` and `frontend/src/navigation/navigationRegistry.js` — mounted page route and navigation source.
7. `frontend/src/branding/` — official nine-colour/light-dark token authority; do not re-key theme colours here.
8. `scripts/tests/` and package root scripts — focused reproducible tests.

## 2. Files changed or added in this update

Bytewise inventory against the supplied ZIP baseline: **19 modified, 7 added, 0 deleted**.

| Path | Folder / responsibility | What changed | Verification |
|---|---|---|---|
| `backend/modules/faith-community-giving/faithGiving.policy.js` | Backend domain policy | Added education campaign categories, in-kind item categories/units/conditions and cash-vs-in-kind input validation | `test:faith-giving` |
| `backend/modules/faith-community-giving/models/FaithGivingPledge.js` | Backend persistence model | Added `pledgeType`, in-kind item subdocument, nullable monetary fields for in-kind, model validation; legacy pledge defaults to CASH | Donations contract test; syntax gate |
| `backend/modules/faith-community-giving/faithGiving.service.js` | Backend service | Pledge DTO, idempotency fingerprint, partner check, same-tenant public campaign reference resolution, auditable pledge creation | Donations contract test; `test:faith-giving` |
| `backend/modules/faith-community-giving/faithGiving.controller.js` | Backend controller | Added `createPublicPledge` controller action using existing response/error boundary | Syntax/route contract |
| `backend/modules/faith-community-giving/faithGiving.routes.js` | Backend API router | Added protected idempotent public-reference pledge route; existing capability flag and action permission retained | Donations contract test; `check:faith-giving` previously available |
| `backend/middleware/platformPermissions.js` | Backend RBAC | Added only `faith-giving:pledge:create` for MEMBER, PARTICIPANT and GROUP_MEMBER; no pledge read/admin permission added | `rbac:gate`; donations contract |
| `frontend/src/pages/faith-community-giving/FaithCommunityGivingPage.jsx` | Frontend donations directory | Renamed presentation to Donations; supports cash pledges and in-kind offers; same-tenant signed-in write limitation; explicit no-collection/no-custody notices; stable retry idempotency | Donations contract test |
| `frontend/src/pages/faith-community-giving/FaithGivingManagerPage.jsx` | Frontend campaign manager | Added school/computer/furniture/construction classifications and budget categories | Syntax gate; policy test |
| `frontend/src/pages/faith-community-giving/faith-community-giving.css` | Giving styles | Added pledge panel styling using existing semantic tokens | Theme audit |
| `frontend/src/routes/AppRoutes.jsx` | Mounted React Router | Added `/donations`, legacy `/faith-community-giving` redirects to new route | `test:navigation-groups` |
| `frontend/src/navigation/navigationRegistry.js` | Central navigation | Replaced public label/path with Donations at `/donations` | `test:navigation-groups` |
| `frontend/src/components/ui/Spinner.css` | Shared UI style | Replaced hard-coded electric-blue literals with central official palette CSS variables | `audit:theme` |
| `frontend/src/pages/GroupList.css` | Group list style | Replaced hard-coded official blue values with official theme tokens | `audit:theme` |
| `docs/faith-community-giving/README.md` | Giving module documentation | Updated donation routes, categories, pledges and limits | Manual review; report consistency |
| `backend/modules/faith-community-giving/faithGiving.policy.test.js` | Backend unit tests | Added education campaign/budget and in-kind pledge input tests; updated cash result contract | `test:faith-giving` |
| `scripts/tests/faith-giving-donations-contract.test.mjs` **(new)** | Contract tests | Added 4 source/contract assertions for UI, RBAC, tenant scoping, model distinctions and no-custody wording | `test:faith-giving-donations` |
| `scripts/tests/navigation-registry-contract.test.mjs` | Navigation tests | Added `/donations` destination expectation | `test:navigation-groups` |
| `scripts/tests/navigation-routes-contract.test.mjs` | Route tests | Added donations route and backward-compatible redirect expectation | `test:navigation-groups` |
| `scripts/tests/group-management-ui-contract.test.mjs` | Group UI test | Corrected stale expected join callback from `onJoin(groupId)` to actual `onJoin(normalizedId)` | `test:navigation-groups` |
| `package.json` | Root scripts | Added `test:faith-giving-donations` and included it in `test:ci` | command executes, 4/4 |
| `reports/official-theme-audit.json` **(new)** | Generated audit evidence | Captures the final 9-colour CSS token audit | `audit:theme` PASS |
| `reports/runtime-import-audit.json` **(new)** | Generated audit evidence | Captures source import analysis and 208 non-critical warnings | `check:runtime-imports` PASS for canonical finance |
| `reports/rbac-security-gate.json` **(new)** | Generated audit evidence | Captures existing static RBAC gate result | `rbac:gate` PASS |
| `docs/evidence/2026-11-13-implementation/EXECUTION_REPORT.md` **(new)** | Evidence report | Summarises work, evidence levels, blockers and release decision | Reproducible commands recorded |
| `docs/evidence/2026-11-13-implementation/CHANGE_DISCOVERY.md` **(new)** | Change inventory | Provides step-by-step folder/file map and exact 22 empty billing list | Bytewise inventory |
| `docs/evidence/2026-11-13-implementation/RUNBOOK.md` **(new)** | Operational handoff | States current runnable commands, flags and infrastructure prerequisites | Manual review |

## 3. Group folders — what was already implemented before this update

The user-supplied archive already includes the 10 November group remediation. Inspect these files to follow the canonical flow (do not create a duplicate Group domain):

- `frontend/src/pages/Dashboard.jsx` — admin create navigation.
- `frontend/src/pages/GroupList.jsx` — group discovery, stable group ID join request and refetch from backend.
- `frontend/src/pages/CreateGroupV2.jsx` — optional invitee flow; creator-only group creation.
- `frontend/src/components/GroupCard.jsx` — stable identifier callback.
- `frontend/src/pages/GroupDetails.jsx` / `GroupDetails.css` — group details and membership request moderation surface.
- `backend/models/Group.js` — canonical group/membership aggregate and audit event allowlist.
- `backend/controllers/groupController.js` — tenant-scoped group controller and pending membership request listing.
- `backend/routes/groups.js` — mounted group endpoints.
- `backend/services/rbacService.js` — canonical membership transitions/audit behavior.
- `backend/tests/unit/groups/group-membership-requests-contract.test.mjs` — group membership source contracts.

The group-management work in that archive is **contract tested only**. No group source service or model was replaced in the present donations update. Live two-user browser, MongoDB replica-set, cross-tenant API attack, capacity-race and restart E2E remain required.

## 4. Commercial billing files still empty — exact list of 22

These files are not implemented by this update. Their presence and empty state are a material commercial billing blocker:

1. `backend/commercial/bridges/canonicalBillingRepository.bridge.js`
2. `backend/commercial/config/billingCutover.config.js`
3. `backend/commercial/config/billingRuntime.js`
4. `backend/commercial/models/RevenueEntry.js`
5. `backend/commercial/models/RevenueSettlement.js`
6. `backend/commercial/models/billingPlan.model.js`
7. `backend/commercial/models/entitlement.model.js`
8. `backend/commercial/models/invoice.model.js`
9. `backend/commercial/models/invoiceItem.model.js`
10. `backend/commercial/models/subscription.model.js`
11. `backend/commercial/models/subscriptionItem.model.js`
12. `backend/commercial/repositories/billingRepository.js`
13. `backend/commercial/repositories/revenueEntry.repository.js`
14. `backend/commercial/repositories/revenueSettlement.repository.js`
15. `backend/commercial/services/billing/billingInvoice.service.js`
16. `backend/commercial/services/billing/saasBilling.service.js`
17. `backend/commercial/services/saas/billingPlan.service.js`
18. `backend/commercial/services/saas/index.js`
19. `backend/commercial/services/saas/subscription.service.js`
20. `backend/commercial/services/transactionRevenue/revenueEntry.service.js`
21. `backend/commercial/services/transactionRevenue/revenueReversal.service.js`
22. `backend/commercial/services/transactionRevenue/settlement.service.js`

Also investigate `backend/commercial/services/billing/billingPayment.service.js`: the source contains substantial implementation, but this archive does not prove live composition-root registration/consumption through the canonical repository, actual provider verification and canonical ledger. Do not mark it operational from file presence.

## 5. How to reproduce

```bash
npm run test:faith-giving
npm run test:faith-giving-donations
npm run test:navigation-groups
npm run test:commercial:core
npm run check:financial
npm run check:enterprise-contracts
npm run check:commercial-core
npm run check:runtime-imports
npm run audit:theme
npm run audit:organization
npm run rbac:gate
npm run test:critical-gates
npm run check:runtime
```

The last command fails under this container's Node 22.16.0/npm 10.9.2. Provision Node >=24.15.0/npm >=11 before dependency installation/full validation. MongoDB replica set and Redis/Docker services are not available in this execution environment.

## 6. How to continue safely

1. Create a real Git clone of the canonical remote; compare its commit and working tree to this ZIP source before applying the archive-local diff.
2. Preserve existing user changes and verify the current remote main before cherry-picking/copying any files.
3. Provision the required runtime and install the original lockfiles exactly.
4. Complete the 22 commercial billing files only after tracing the canonical finance/payment repository contract and service registry.
5. Execute the institution adoption → usage → fee assessment → invoice → verified collection → canonical ledger → settlement/reconciliation workflow in replica-set/Redis integration and browser E2E environments.
6. Complete donations external-donor consent/identity, payment provider collection, recipient bank account controls, in-kind acceptance/custody/inventory, fulfilment, receipt and accountability reporting as separately authorised domains.
7. Run independent security, privacy, legal, regulatory, partner, tax/accounting, provider and operational approvals. Keep all release flags disabled until formal approvals.
