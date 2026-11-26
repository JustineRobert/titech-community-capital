# Blockers and remaining risks — 24 November 2026

| Priority | Blocker / risk | Impact | Required next evidence/action |
|---|---|---|---|
| P1 | Local execution runtime is Node 22.16.0/npm 10.9.2 | Clean install, Jest, Vite build and npm commands cannot be validated against the repository's strict runtime | Re-run with Node 24.15.0 and npm 11.x on developer/CI machine |
| P1 | Dependencies unavailable; npm registry DNS failed | Cannot run backend Jest, frontend Vitest/lint/build, browser E2E or dependency audit | Run `npm run install:all` from clean checkout with registry access |
| P1 | No live Vercel dashboard/CLI Preview access | Node settings, project root, environment configuration, build logs and Preview smoke cannot be independently verified | Apply/verify Vercel settings in `VERCEL_CONFIGURATION.md`, deploy Preview and collect URLs/logs |
| P1 | `TITECH_API_ORIGIN` must be set server-side in Vercel | Same-origin API bridge intentionally returns 503 until configured | Configure approved HTTPS backend origin in Preview/Production environment only |
| P1 | MongoDB/Redis integration infrastructure absent | No runtime health/readiness, isolated tenant API or financial transaction replay | Provision disposable transaction-capable validation DB/Redis and run backend tests |
| P1 | Group-to-ledger account mapping unavailable for affected group | Auth may pass but wallet balance must remain 503 rather than fabricate a number | Implement/verify canonical group-account mapping through approved finance architecture and test ledger parity |
| P1 | No Daily credentials | No real room/token can be provisioned | Authorized owner configures `DAILY_API_KEY` and `DAILY_DOMAIN` in a non-production test environment |
| P1 | Full authenticated/financial browser journeys not implemented in the new E2E smoke | A single homepage smoke command is not enterprise-wide E2E proof | Add isolated test-user fixtures and Playwright/CDP journeys for auth, tenancy, group and canonical ledger workflows |
| P1 | External legal, regulatory, insurer/partner and operational approvals remain unverified | No regulated activity or production go-live can be claimed | Obtain independent applicable approvals and attach evidence |
| P2 | Deprecated/legacy transitive dependencies remain | Ongoing support/security maintenance risk | Resolve parent packages and migrate ESLint 8 to supported ESLint 9 flat config after full clean install/test |
| P2 | Original `cache-dir` warning not attributable | Could recur in Vercel if external environment contains unsupported setting | Inspect Vercel environment and global npm config; remove unsupported env key and use npm `cache` if needed |
| P2 | Official social account URLs absent | No social links can be safely presented | Supply/verify official account URLs before adding them |
| P2 | Git metadata absent from uploaded archive | No branch, commit ancestry, diff against main, commit or push evidence | Compare against actual repository checkout and apply/review patch before merge |

`productionApproved=false` must remain until all applicable legal, regulatory, financial, security, partner, operational and release evidence has been independently reviewed and approved.
