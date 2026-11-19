# Groups / Education Campaigns Baseline Audit

**Execution date:** 19 November 2026  
**Source:** uploaded `titech-community-capital-main.zip` snapshot  
**Uploaded ZIP SHA-256:** `41a4b7a84ddceb30f1bb9cead4ba28f50738859d1b2d0256b307b172a36bb3da`  
**ZIP comment field:** `d5bb0624fac7b7b9f242963a8c764781bffccfab` (not independently verified as a Git commit or against GitHub)  
**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD.  
**Tagline:** Community Finance. Stronger Together.

## Environment and source limitations

- The ZIP does not contain `.git` metadata, so no branch, remote URL, Git diff, commit, push or deployment can be verified from this workspace.
- The declared project engines are Node `>=24.15.0` and npm `>=11.0.0`; the execution environment supplies Node `v22.16.0` and npm `10.9.2`.
- Root, backend and frontend `node_modules` are absent. Dependency-backed Jest/Vitest, lint, Vite build, runtime startup and browser automation cannot be claimed.
- No live MongoDB, Redis, SMTP/SMS provider, MTN/Airtel sandbox, insurer, institutional partner or regulator connection was supplied.
- The repository has three package manifests and three lockfiles. Runtime installation must use the declared engine and each package's lockfile; the lockfiles were not changed.

## Source inventory findings

| Capability | Source finding | Baseline classification |
|---|---|---|
| Groups list | Canonical `frontend/src/pages/GroupList.jsx`; server API uses `/api/groups`; client reconciles after join | Implemented; browser unverified |
| Group creation | Active route uses `CreateGroupV2`; creator-only creation is supported; optional in-app invitees are allowed | Implemented; source contracts present |
| Group details | `frontend/src/pages/GroupDetails.jsx`; group read, membership requests, status, ledger balance read and disabled contribution panel | Partially integrated |
| Invitation | Existing-user, same-tenant in-app invitations persisted in Group membership aggregate | Partial; no external delivery / secure new-user token workflow evidenced |
| Join request | Tenant-scoped membership request with optimistic concurrency and duplicate-state handling | Implemented at source-contract level |
| Membership decisions | Group-scoped approval/rejection/suspension/removal/role action policy through `transitionMembership` | Implemented at source-contract level |
| Group edit/archive/suspend API | No corresponding update/archive/suspend route was found in `backend/routes/groups.js` | Not implemented in this router |
| Contributions | Canonical financial operation infrastructure exists, but Group Details explicitly says group-scoped initiation is not enabled | Blocked by missing group-scoped account/payment integration |
| Group balance | Group wallet controller intentionally returns `GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED`; Group has no canonical account mapping | Fail-closed; not a balance failure to paper over |
| Education public campaigns | Public router and safe read-only DTO exist, behind capability flag | Implemented but deliberately disabled |
| Education management | Authenticated + tenant authorization + action permission routes exist, behind capability flag | Implemented but deliberately disabled |
| Dashboard theme | Official nine-colour and light/dark theme are loaded from `main.jsx`; dashboard token bridge exists | Implemented; official theme audit passed |

## Confirmed Education API 503 cause

Both campaign route modules call `requireCapabilityFlag('TITECH_EDUCATION_CAMPAIGNS_ENABLED')`. The middleware returns HTTP 503 with `error.code = CAPABILITY_DISABLED` when that variable is not exactly the string `true` (case-insensitive). Both `backend/.env.example` and `backend/.env.production.example` explicitly set it to `false`.

This is an intentional fail-closed capability gate, not evidence of a MongoDB outage, broken route registration, authentication failure, or general application-not-ready condition. The campaign implementation note dated 21 October says the flag remains off until target-runtime/database/transactional audit tests, safeguarding/privacy/legal review, partner verification and release approval exist. Therefore the remediation retains this control; switching it on or changing a gated 503 to a fabricated 200 would be unsafe.

## Confirmed Groups UI root cause

`GroupList.jsx` renders `.group-list-header-actions`, `.group-list-card__actions`, `.group-list-card__details-button`, `.group-list-card__join-button`, `.group-list-refresh-button` and `.group-list-create-button`. The active stylesheet `GroupList.css` did not define these selectors; only a generic `.group-list-actions` rule existed. This left the active adjacent links/buttons without a reliable flex/grid gap, display type, independent button geometry or responsive wrapping. A dedicated token-based stylesheet and regression contract were added.

## Scope decision

This archive-local pass fixes the confirmed Groups action styling defect and adds executable fail-closed Education flag tests. Existing invitation, member and finance controls are preserved. The pass does not claim that missing group edit/archive APIs, external invitation delivery, new-user invitation tokens, group-scoped contributions, live payment verification, browser E2E or production approvals have been delivered.
