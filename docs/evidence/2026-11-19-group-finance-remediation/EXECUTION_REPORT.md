# TITech Community Capital — Group Finance & Platform Remediation

**Execution date:** 19 November 2026  
**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD.  
**Official tagline:** Community Finance. Stronger Together.  
**Source:** User-supplied repository ZIP and incident/work-order text  
**Release decision:** **NOT READY — `productionApproved=false`**

## 1. Executive summary

This is an archive-local source remediation, not a deployment or production certification. The supplied ZIP did not contain `.git` metadata, and the execution environment did not meet the repository's declared Node/npm baseline. Dependencies, MongoDB, Redis, a provider sandbox and live institutional credentials were not available in this execution environment. Consequently, no live API replay, database-backed integration suite, browser E2E, full backend/frontend build, deployment or production transaction was claimed.

The work nevertheless made and checked concrete source changes:

- Repaired the group-wallet tenant identifier resolution path so a tenant slug is not mistaken for the canonical MongoDB `Tenant._id` used by `Group.tenantId` queries.
- Separated financial visibility from ordinary group visibility. An active group member does not gain access to group financial records solely by being a member.
- Made group wallet balance and ledger endpoints fail closed with an explicit `GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED` state because the canonical Group schema does not currently provide a verified group-to-financial-account mapping. Removed the unsafe group-tagged ledger-line read that could include balancing/counterparty lines.
- Changed invitation batches to preserve eligible invitations while returning a structured outcome per invitee; normalized email matching; classified duplicate input, existing membership/invitation and onboarding-required outcomes; and added active same-tenant account checks at invitation acceptance.
- Added a backend contribution capability read endpoint and a group-scoped instruction endpoint. Both preserve the safe-off position: no production instruction can be created until group-account mapping, provider verification, settlement capability and authorization are genuinely integrated. Provider environment values alone do not prove connectivity, certification or settlement.
- Corrected Agriculture's tenant context use so ObjectId-scoped services receive a canonical tenant ObjectId rather than a middleware-provided tenant slug.
- Updated platform readiness composition to include the canonical dependency readiness registry while retaining explicit database checks and avoiding optional modules unnecessarily taking down core readiness.
- Updated group invitation UI to show per-member outcomes and retry only eligible failed invitees; updated Group Details to consume server capability state rather than relying on a hardcoded claim that no route exists.
- Added group policy tests and integration-test cases, plus static audit artifacts and implementation evidence documents.

The Faith Giving and Education public endpoints are intentionally feature-gated. Their observed `503` responses are consistent with the current fail-closed module configuration; they were not enabled simply to obtain `200` responses. Agriculture and Retirement Support source paths were inspected, but actual production/test database response bodies were not available to verify their live data.

## 2. Root-cause findings and actions

### A. Group-wallet lookup inconsistency

**Source-level cause identified:** the global tenant middleware can set `req.tenantId` to the stable tenant slug, while `Group.tenantId` is an ObjectId relationship and `Group.findTenantGroup(tenantId, groupId)` needs the canonical `Tenant._id`. The old wallet lookup treated its tenant context as though it were already an ObjectId, allowing a real group to be misclassified as not found.

**Correction:** added `backend/security/tenantObjectIdContext.js` and `backend/security/groupWalletPolicy.js`; the wallet controller resolves the canonical tenant ObjectId only from trusted authentication/populated tenant context and rejects slug-only context. It then uses the canonical Group model query. Unit tests cover authenticated ObjectId precedence, hydrated `Tenant._id`, slug rejection and missing context.

**Financial follow-on:** the canonical Group model does not establish a group-owned ledger account mapping. A group record is not proof that a wallet/account exists. The controller therefore now returns a deliberate `503 GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED` for authorized callers instead of returning a false group-not-found or inventing a zero balance. The ledger endpoint also fails closed rather than exposing group-tagged journal lines without an account-specific posting rule.

**Authorization:** `canViewGroupFinancials` requires same-tenant scope plus tenant-administrator authority, explicit `GROUP_FINANCIAL_VIEW`, or an active group membership role of group administrator/treasurer. Ordinary group membership and broad platform-support role are not enough. Unauthorized financial access is denied before financial output.

**Evidence level:** source inspected; policy tests passed; live MongoDB/API replay and financial-account mapping remain unverified/blocked.

### B. Group invitation partial failure

**Source-level cause identified:** the previous batch handler treated member lookup as an all-or-nothing gate. A batch containing some addresses that did not map to active same-tenant users could reject eligible invitees together with ineligible invitees, while the UI did not provide actionable per-member recovery.

**Correction:** the existing group aggregate invitation flow now processes each normalized invitee independently after shared authorization. It returns a per-invitee `success`, `status`, stable `code`, `retryable`, and next-action/message where relevant. Successful records are retained when another invitee is ineligible. Duplicate addresses in one submission are identified; pre-existing active membership and invitations are not duplicated; unsupported or inactive records are not silently made active. The existing group optimistic concurrency/version key remains in use, with a conflict response on concurrent update.

**Acceptance:** an invitation can only be accepted by the authenticated active user in the same tenant, against an active group and a valid outstanding invitation. No user or institution membership is fabricated. The existing in-app invitation process is not represented as external email delivery.

**Limitation:** no separate InstitutionMembership model was found in the inspected repository path; the implementation uses the existing User tenant/status fields and existing Group embedded membership aggregate. A full organization onboarding lifecycle remains dependent on the institution's canonical onboarding capability.

### C. Group contribution availability

**Source-level cause identified:** Group Details displayed a hardcoded unavailable message stating that no mounted group-scoped contribution route existed. The canonical contribution/ledger path is not, by itself, proof of a payment-provider collection and settlement workflow, and the current canonical Group has no verified financial-account reference.

**Correction:** added mounted group-scoped capability and instruction route handlers to the existing groups router. Capability is determined server-side. The instruction handler returns `503 GROUP_CONTRIBUTION_NOT_CONFIGURED` with `noInstructionCreated: true` until the complete authorized provider/settlement/ledger service exists. A contribution request does not create a transaction, journal, receipt or wallet balance.

**Provider boundary:** MTN configuration presence is not treated as live connectivity, certification or settlement approval. Production initiation remains disabled. No live or sandbox payment was initiated.

### D. Faith Giving public API

The public route is guarded by `TITECH_FAITH_GIVING_ENABLED`; the environment example defaults it off, and module documentation describes partner/privacy/safeguarding/legal/release gates. The observed `503` is therefore consistent with intentional feature restriction, not evidence that an empty public campaign list should be returned. The feature was not enabled without approvals. Its policy test suite passed.

### E. Education public campaigns

The public campaign route is guarded by `TITECH_EDUCATION_CAMPAIGNS_ENABLED` and defaults to off. Existing education policy enforces verified institutions, publication state, read-only public DTOs and transactional campaign/audit updates. The public API was not enabled without the required institutional authorization. The education policy suite passed.

### F. Agriculture

A mismatch was identified between tenant middleware's runtime tenant context and service/controller code expecting an ObjectId. The controller now resolves canonical tenant ObjectId scope before calling ObjectId-scoped services. The Agriculture domain unit tests passed. The five logged 200 responses with equal byte sizes are not, by themselves, proof of placeholder data. Without a live isolated database and response-body replay, persistence, pagination and real tenant-scoped records remain unverified.

### G. Retirement Support

The inspected module uses tenant-scoped user/case queries, permission/capability gates, private-document purpose scoping and does not add a shadow ledger. It distinguishes contribution remittance comparison from official scheme credit. The observed repeated 132-byte responses cannot, by themselves, establish placeholder behaviour; live user-scoped query bodies were not available. Existing retirement-support unit/policy tests passed. No Retirement Support production or pension-fund authorization is implied.

### H. Global readiness

The previous composition explicitly inspected the application lifecycle and database contract but did not fully include the canonical registered dependency readiness evaluation in the response calculation. The readiness closure now re-evaluates that registry, combines required dependency blockers with bootstrap and explicit database state, and does not let optional modules automatically take down the platform. Runtime verification against actual MongoDB/Redis remains blocked.

## 3. API verification matrix

The “after” column below is the behavior established by source changes or current feature policy. It is **not** a claim that these routes were replayed against a live server.

| Endpoint / area | Reported result | Source-level result after change | Verification |
|---|---:|---|---|
| `GET /api/groups/:groupId` | 200 | Existing canonical group path retained | Not replayed; database unavailable |
| `GET /api/groups/:groupId/membership-requests` | 200 | Existing tenant-scoped request list retained; group-level admin policy now accounts for embedded group-admin role | Policy tests pass; API not replayed |
| `GET /api/v1/group-wallets/:groupId/balance` | 404 | Canonical tenant ObjectId resolution; authorized group without verified account mapping receives `503 GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED`; unauthorized caller receives 403 | Unit policy tests pass; live API not replayed |
| Group-wallet ledger route | Not supplied | Fails closed with `GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED` until account mapping exists; no ambiguous group-tagged journal lines returned | Source syntax checked; integration test added but not executed |
| `GET /api/v1/groups/:groupId/contributions/capabilities` | Not mounted/used by UI | Mounted capability route; currently reports unavailable/not configured based on actual gates | Unit policy tests pass; live API not replayed |
| `POST /api/v1/groups/:groupId/contributions/instructions` | Not mounted/used by UI | Mounted safe-off route; returns `503 GROUP_CONTRIBUTION_NOT_CONFIGURED`; `noInstructionCreated: true` | Route/source checked; no live provider test |
| `GET /api/v1/faith-giving/public` | 503 | Remains 503 while the intentionally disabled feature flag is off | Faith Giving policy tests pass; no live route replay |
| `GET /api/v1/education/campaigns/public` | 503 | Remains 503 while the intentionally disabled feature flag is off | Education policy tests pass; no live route replay |
| Agriculture producers | 200 | Tenant scope now resolves to canonical ObjectId for ObjectId-based service | Domain tests pass; live body unverified |
| Agriculture production cycles | 200 | Same tenant resolver correction | Domain tests pass; live body unverified |
| Agriculture deliveries | 200 | Same tenant resolver correction | Domain tests pass; live body unverified |
| Agriculture settlements | 200 | Same tenant resolver correction | Domain tests pass; live body unverified |
| Agriculture buyers | 200 | Same tenant resolver correction | Domain tests pass; live body unverified |
| Retirement capabilities/readiness/contributions/profile/cases/financial support | 200 | Existing capability, permission and tenant-scoped service boundaries retained; no evidence supports changing success status solely due to repeated response sizes | Unit/policy tests pass; live payloads unverified |
| `GET /api/v1/ready` | 200 | Source readiness includes registered required dependency state, bootstrap and database; optional modules do not become global critical dependencies by default | Syntax gate passes; live DB/Redis readiness not verified |

## 4. Security and financial controls

- Group-wallet tenant lookup now treats the tenant slug and canonical Tenant ObjectId as different identifiers.
- Group financial access is separate from ordinary group access and remains tenant-scoped.
- A user from another institution cannot satisfy the financial permission policy through a group identifier alone.
- Group-level administrator/treasurer roles are resolved from active group membership, not inferred solely from global role.
- No wallet is provisioned as a side effect of a GET request.
- No fabricated zero balance is returned when the canonical account mapping is missing.
- No ledger lines are returned without a group-owned account mapping.
- Contribution capability discovery has no persistence/payment side effects.
- Contribution instructions remain disabled; no instruction, provider attempt, transaction, ledger journal or receipt is manufactured.
- Invitation processing uses same-tenant active user records; no synthetic member is inserted.
- Successful invitations are preserved in a partial batch; duplicate input and existing memberships are distinguished.
- Public Faith Giving/Education routes remain behind explicit capability flags.
- Readiness includes critical dependency reporting without turning optional module restrictions into global application failures.

**Not demonstrated:** live cross-tenant requests, actual database roles/records, full authentication session behavior, MongoDB transaction semantics, Redis outage behavior, provider webhook authentication, ledger posting, reconciliation, concurrency under multiple server processes or production audit persistence.

## 5. Brand and organization profile

The archive already wired the official shared theme from the frontend entrypoint. The source audit confirms the current palette contract:

| Token | Official value |
|---|---|
| Deep blue | `#0030A0` |
| Electric blue (primary focus) | `#0058D8` |
| Bright blue | `#0066E8` |
| Cyan | `#00B8F8` |
| Africa green | `#008000` |
| Lime green | `#A8F000` |
| Gold yellow | `#F8D800` |
| Navy ink | `#082B67` |
| White | `#FFFFFF` |

The official CSS/JS theme layer and explicit light/dark themes remain the source of truth. The audit found 77 non-brand frontend CSS files using the centralized token layer with zero hard-coded official palette hex literals. The group creation invitation result UI uses existing semantic theme tokens. This is a token-wiring/source audit, not a screenshot-based visual certification of every dashboard at every viewport.

The organization profile gate passed for the owner-provided profile values:

- Product: TITech Community Capital
- Organization: TITECH CAPITAL - SMC LTD.
- ERN: 80049233029029
- Postal address: P.O. Box 601200
- Email: titechcapital@gmail.com
- Telephone: +256782397907
- WhatsApp: +256772123546
- Tagline: Community Finance. Stronger Together.

The supplied profile is not independent legal verification of the registration certificate, contacts or regulatory authorization. `productionApproved=false` remains enforced.

## 6. Test and quality evidence

### Executed dependency-free automated tests

| Command | Result |
|---|---:|
| `node --test backend/tests/unit/groups/*.test.mjs` | 22 passed, 0 failed |
| `node --test backend/tests/unit/education/*.test.mjs` | 15 passed, 0 failed |
| `node --test backend/tests/unit/retirement/*.test.mjs` | 16 passed, 0 failed |
| `node --test backend/tests/unit/agriculture/agriculture.domain.test.js` | 9 passed, 0 failed |
| Group/dashboard/navigation/brand contract suite (`scripts/tests/...`) | 26 passed, 0 failed |
| `node --test scripts/tests/faith-giving-donations-contract.test.mjs` | 4 passed, 0 failed |
| `node --test scripts/tests/error-boundary-privacy-contract.test.mjs` | 1 passed, 0 failed |
| `node --test backend/modules/faith-community-giving/faithGiving.policy.test.js` | 18 passed, 0 failed |
| **Total** | **111 passed, 0 failed** |

All of the above were executed with Node's built-in test runner. They are unit/policy/source-contract tests; they are not live API integration or browser E2E tests.

### Executed static gates and syntax validation

| Command | Result |
|---|---|
| `node scripts/official-theme-audit.mjs` | PASS; 77 non-brand CSS files covered by official theme tokens |
| `node scripts/organization-profile-gate.mjs` | PASS |
| `node scripts/financial-static-gate.mjs` | PASS; 12 canonical files checked |
| `node scripts/rbac-security-gate.mjs` | PASS |
| `node scripts/frontend-runtime-audit.mjs` | PASS_WITH_WARNINGS; 11 pass, 1 warning (`frontend/dist` absent) |
| `node scripts/enterprise-gate.mjs --syntax` | PASS; 2,577 JS/TS-family files parsed |
| `node --check` on changed backend JS/MJS and integration test files | PASS |
| JSON parse on root and backend package manifests | PASS |
| `node scripts/titech-supported-runtime-gate.mjs` | BLOCKED; Node/npm below declared requirement |

### Not executed / blocked

- Backend Jest unit/integration/CI suite: blocked because dependencies are not installed and the required Node/npm runtime is absent.
- Group journey integration test changes: syntax-checked but not run against Express/Supertest/MongoDB.
- Frontend Vite build and type checks: not run; frontend dependencies not installed, `frontend/dist` absent.
- Full repository lint and Prettier checks: not run because installed toolchain/dependencies are absent.
- Browser E2E and responsive screenshots: not run; no browser automation environment/dependencies available.
- Live MongoDB/Redis startup and `/ready` replay: not run; no reachable application infrastructure was provided.
- Original incident endpoint response bodies: not captured in this container; provided logs were treated as initial evidence only.
- MTN sandbox or production request/callback/settlement: not run; no verified provider credentials, institutional authorization or certification supplied.

## 7. File change summary

The exact file-by-file inventory and discovery commands are in [`FILE_CHANGE_DISCOVERY.md`](./FILE_CHANGE_DISCOVERY.md). The validation log and reproducible commands are in [`VALIDATION_RESULTS.md`](./VALIDATION_RESULTS.md).

No database migration or data repair was executed. No collection was dropped, database reset, historical record modified, credential added or live money movement initiated.

## 8. Acceptance matrix

| Capability | Status | Reason |
|---|---|---|
| Canonical group tenant ID resolution in wallet controller | **PARTIAL** | Source change and unit tests pass; actual database/API incident replay unavailable |
| Wallet financial permission separation | **PARTIAL** | Policy tests pass; actual identities/tenant records not exercised through live middleware |
| Wallet provisioned balance | **BLOCKED** | No canonical group-to-account mapping is established in current Group domain; must integrate through approved accounting source |
| Unprovisioned wallet state | **PARTIAL** | Explicit fail-closed `503 GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED` is implemented; live API not replayed |
| Batch invitation partial success | **PARTIAL** | Handler/UI and tests updated; integration test not executed |
| Invitation acceptance eligibility | **PARTIAL** | Source and policy checks updated; live authentication/tenant data unavailable |
| Institution onboarding | **BLOCKED** | No full institution membership onboarding domain was confirmed in this repository path; must not be simulated |
| Group contribution capability | **PARTIAL** | Server capability gate and mounted routes added; intentionally disabled for production |
| Production contribution/payment/settlement | **BLOCKED** | Canonical group account mapping, provider verification, settlement integration and approvals missing |
| Faith Giving public endpoint | **PARTIAL** | Safe feature gate and policy are tested; public feature remains intentionally disabled pending approvals |
| Education public campaigns | **PARTIAL** | Safe feature gate and policy are tested; public feature remains intentionally disabled pending approvals |
| Agriculture tenant context | **PARTIAL** | Source correction and domain tests pass; live response/data persistence not replayed |
| Retirement Support | **PARTIAL** | Existing policy/data boundaries tested; live personal record payloads not replayed |
| Platform readiness dependency evaluation | **PARTIAL** | Source change and syntax checks pass; runtime DB/Redis check not exercised |
| Official branding and nine-colour theme | **PASS (source gate)** | Theme and organization profile gates pass; no visual E2E screenshot certification |
| Financial static guard | **PASS (static gate)** | 12 canonical files checked; not live accounting verification |
| Full frontend/backend build | **BLOCKED** | Runtime baseline/dependencies unavailable |
| Full integration and browser E2E | **BLOCKED** | Required dependencies, database and browser test runtime unavailable |

## 9. Deployment and production readiness

**Release classification: NOT READY. `productionApproved=false`.**

The working tree has completed targeted source remediation and dependency-free tests, but is not enterprise-production-certified. The next release gate requires, at minimum:

1. Run with Node `>=24.15.0` and npm `>=11.0.0`.
2. Install dependencies using the repository's lockfiles and clean-install process.
3. Start an isolated MongoDB test replica set and Redis test service using approved non-production settings.
4. Run the full backend Jest and frontend CI suites; run the new group integration journey through real middleware and MongoDB transactions.
5. Run frontend/backend builds, lint, format, dependency/security audit and supported runtime gates.
6. Reproduce and capture sanitized live response bodies for every original incident endpoint.
7. Verify group and tenant identifiers against real test fixtures; resolve the canonical financial account mapping through the existing approved account/ledger architecture.
8. Complete contribution instruction → provider attempt → verified callback/status inquiry → settlement evidence → canonical financial transaction → balanced ledger → reconciliation in an approved provider sandbox.
9. Obtain written institutional/provider/legal approval and complete external certification/security assessment before enabling production contribution initiation or any regulated feature.
10. Execute browser E2E and role/cross-tenant security tests for refugee and host-community participants, partner institution users and authorized insurers. The application must not imply eligibility or regulatory approval solely from software onboarding.
11. Confirm deployment secrets, observability, backup/restore, incident response and operational ownership.

No Git commit, push, release tag, deployment or live production approval is claimed because this source archive did not include Git metadata or deployment access.
