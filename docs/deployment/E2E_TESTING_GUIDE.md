# TITech browser E2E smoke testing

**Updated:** 24 November 2026

## Browser E2E command

The frontend now exposes `npm run test:e2e`; the root `npm run test:e2e` forwards to it. The suite uses Node's test runner and the Chromium DevTools Protocol, avoiding an additional browser-driver dependency. It is a real browser smoke test, not a fake script that aliases unit tests.

Requirements:

- Supported TITech Node/npm runtime (Node `24.15.0`, npm `11+`).
- Frontend dependencies installed using `npm ci --prefix frontend --include=dev`.
- Chromium or Google Chrome available on PATH, or `TITECH_CHROMIUM_PATH` set to its executable.

Run from repository root:

```powershell
npm run install:all
npm run test:e2e
```

Run from frontend:

```powershell
npm ci --include=dev
$env:TITECH_CHROMIUM_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:e2e
```

To target an already running Preview/test deployment, set `TITECH_E2E_BASE_URL` to its URL. Use only an approved non-production Preview/test environment. The default command starts the Vite development server, starts a headless Chromium instance, checks the public homepage identity and links, checks missing image assets and browser errors, tests mobile-width overflow and direct `/contact-us` navigation, and saves screenshots/summary JSON under `frontend/test-reports/`.

The `browser-e2e` GitHub Actions job installs Chrome, installs the frontend lockfile, runs this suite and uploads evidence. The root E2E script now resolves to a real test command.

## Scope boundary

The current Chromium suite proves public homepage/contact rendering and a direct public route only. It does **not** claim full user-authentication journeys, tenant attack tests, group create/join/approval, wallet balance access, ledger posting/reversal/reconciliation, payroll disbursement, provider callbacks, or visual testing of every dashboard. Those require the isolated MongoDB/Redis test infrastructure, test accounts and complete browser/fixture coverage. The current source execution could not run the Chromium suite because Vite is not installed in this runtime.
