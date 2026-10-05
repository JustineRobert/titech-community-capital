# TITech Community Capital — Runtime/Auth/Browser Remediation Evidence

**Execution date:** 5 October 2026
**Source baseline:** uploaded `titech-community-capital-main.zip`
**Final working tree:** updated enterprise runtime/auth/browser remediation tree

## Final status

**Production status: NOT READY**

The source-level remediation gates pass. The strict release gate remains blocked only because the current execution container provides Node **v22.16.0 / npm 10.9.2**, while the repository enterprise pin is Node **24.15.0+ / npm 11.x**. External operational/provider/security/regulatory evidence remains unproven.

## 1. Root-cause remediation

| Area | Root cause / gap | Implemented change | Source evidence |
|---|---|---|---|
| Application authentication | Duplicate `AuthProvider` boundary in `App.jsx` could create competing authentication state | Removed the nested provider; `frontend/src/app/providers.jsx` is the sole canonical mount | Runtime audit PASS |
| Socket authentication | Socket service contained its own browser token persistence/read path | Socket now consumes the canonical memory-only token authority and reconnects with current in-memory credentials | Runtime audit PASS |
| API connectivity | Auth/notifications could independently discover a dead backend and retry | Added shared connectivity state + de-duplicated readiness probe + 15s monitor | Runtime audit PASS |
| API origin | Production/base-url composition could duplicate `/api` paths | API base normalization now strips `/api` or `/api/v1` suffixes and uses same-origin production fallback | Runtime audit PASS |
| Readiness | Frontend did not have one canonical API readiness contract | Frontend probes `/api/v1/ready` | Runtime audit PASS |
| Refresh failures | Network/server outages could be treated as invalid sessions | Refresh now clears/redirects only for definitive 401/403; transient failures preserve the session boundary | Runtime audit PASS |
| Notification bootstrap | Lifecycle remounts and API outages could cause repeated loads/retries | Readiness gating, identity de-duplication, page ref, cancellation and bounded retry policy | Runtime audit PASS |
| Notification API | Frontend called `/api/notifications` without a matching canonical backend boundary | Added tenant/user-scoped model, repository and protected router mount | Runtime audit PASS |
| Production configuration | Hosting gate lacked non-empty production env templates | Added secret-safe backend/frontend production templates | Hosting gate PASS |
| Browser warning | AdobeClean font warning came from a Chrome extension | No TITech source references the external extension; warning remains correctly classified as external | Runtime audit PASS |
| Diagnostics | Startup log could imply whole application readiness | Startup message now explicitly distinguishes frontend bootstrap from API/auth readiness | Source review PASS |
| Official TITech theme | Theme contract needed to remain centralized while runtime changes were made | Preserved canonical official nine-color palette, light/dark contract, namespaced persistence and supplied logo source | Official theme audit PASS |

## 2. Exact changed-file inventory vs uploaded baseline

- Added: **31**
- Modified: **74**
- Deleted: **3**
- Total changed: **108**

Top-level changed-file distribution:

- `frontend/`: 62
- `backend/`: 16
- `reports/`: 14
- `docs/`: 10
- `scripts/`: 5
- `package.json/`: 1

The complete SHA-256 indexed inventory is:

`docs/evidence/2026-10-05-runtime-auth-file-change-index.csv`

## 3. Primary changed source paths

### Frontend runtime/auth/network

- `frontend/src/services/runtimeConnectivity.js` — shared connectivity state machine.
- `frontend/src/services/runtimeConnectivity.test.js` — connectivity regression tests.
- `frontend/src/services/api.js` — API origin/readiness/retry/auth-refresh handling.
- `frontend/src/services/apiPolicy.test.js` — API policy regression tests.
- `frontend/src/services/socket.js` — memory-only token synchronization.
- `frontend/src/context/AuthContext.jsx` — transient refresh handling and readiness recovery.
- `frontend/src/context/AuthProvider.jsx` — deleted duplicate provider.
- `frontend/src/app/providers.jsx` — sole AuthProvider boundary and readiness monitor.
- `frontend/src/App.jsx` — removed nested authentication boundary.
- `frontend/src/components/ui/NotificationProvider.jsx` — de-duplicated readiness-aware notification bootstrap.
- `frontend/src/main.jsx` — corrected bootstrap/readiness diagnostic wording.
- `frontend/.env.example` — explicit development API/socket/readiness contract.
- `frontend/.env.production.example` — secret-free production deployment contract.

### Backend notification API

- `backend/models/Notification.js`
- `backend/repositories/notification.repository.js`
- `backend/routes/notifications.js`
- `backend/routes/index.js`
- `backend/.env.production.example`

The notification boundary is tenant/user scoped and protected by the existing authentication + tenant authorization middleware. It does not create a second financial core.

### Automation/evidence

- `scripts/runtime-auth-browser-audit.mjs`
- root `package.json` — `audit:runtime`
- `reports/runtime-auth-browser-audit.json`
- `docs/evidence/2026-10-05-runtime-auth-file-change-index.csv`
- this remediation report

## 4. Official TITech theme

The final tree retains the official supplied palette:

`#0030A0 #0058D8 #0066E8 #00B8F8 #008000 #A8F000 #F8D800 #082B67 #FFFFFF`

Verification currently reports **0 hard-coded official palette occurrences in 56 non-brand CSS files**, with the official logo/reference image present and verified. Existing canvas/chart export fallbacks are tracked as advisory inline-script values because those libraries may require concrete colors rather than CSS custom properties.

Canonical brand source remains:

`branding/official/TITech_Community_Capital_Official.jpeg`

## 5. Verification performed

### Source-level PASS

- Enterprise syntax gate: **2317 executable JS/TS-family files parsed**.
- Runtime/auth/browser audit: **12/12 source contracts PASS**.
- Official theme audit: **PASS**.
- Hosting gate: **PASS** after adding production env templates.
- TITech implementation gate: **PASS**.
- Canonical financial static gate: **PASS**.
- Canonical financial missing imports: **0 critical**.
- Test discovery: **PASS**, 26 legacy/non-blocking empty tests remain tracked.
- Runtime connectivity direct smoke: **PASS**.
- Changed JavaScript syntax checks: **PASS**.

### Dependency-backed limitation

The available runtime is Node **v22.16.0** and npm **10.9.2**. The repository pins Node **24.15.0+** and npm **11.x**. A frontend `npm ci` attempt exceeded the execution window and left the install incomplete, so Vitest/Jest/build execution could not be honestly marked as passed.

The following remain **UNPROVEN** in this environment:

- complete frontend test suite
- complete backend Jest suite
- production frontend build
- full backend runtime startup under target Node
- MongoDB replica-set transaction execution
- Redis runtime/resilience execution
- real MTN sandbox/live proof
- external reconciliation run
- SAST/SCA/secret/container/IaC/DAST campaign execution
- independent penetration test
- backup/restore drill
- disaster-recovery drill
- regulatory/legal approval
- three real institution pilot execution
- paying-customer evidence

## 6. Strict release gate

The strict gate passes structural/financial/security-static requirements but is blocked by the target-runtime mismatch:

`Observed Node 22.16.0 != required Node 24.15.0`

Repository-wide legacy/runtime import debt remains tracked as a warning (**214** unresolved local import edges in the platform-truth scope) rather than being mislabeled as complete.

## 7. Final evidence posture

**Production approved: false**

**Production status: NOT READY**

The repository is materially stronger at the source/contract level and now has the correct architecture for the browser/runtime failure class supplied in the console evidence. The next honest gate is target-runtime execution plus real infrastructure/provider/customer evidence.
