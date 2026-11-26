# Reproducibility guide — supported developer environment

## Windows PowerShell

```powershell
Set-Location "D:\TITech Projects\titech-community-capital-main"
nvm use 24.15.0
node --version
npm --version

# Install every independently locked package (root, backend, frontend).
npm run install:all

# Source/static contract checks.
npm run check:runtime
npm run test:runtime-contract
npm run audit:organization
npm run audit:theme
npm run check:financial
npm run rbac:gate

# Selected tests.
node --test backend/tests/unit/education/educationCampaign.route-contract.test.mjs
node --test backend/tests/unit/education/educationCampaign.policy.test.mjs
node --test backend/tests/unit/education/educationCampaign.transaction-contract.test.mjs
node --test backend/tests/unit/groups/group-wallet-policy.test.mjs
node --test backend/modules/meetings/providers/dailyProvider.test.js
node --test backend/modules/meetings/meeting.policy.test.js

# Full project gates after dependencies and validation services are ready.
npm run test:ci
npm run test:e2e
npm run build
npm run security:audit
```

## Linux/macOS

```bash
nvm install 24.15.0
nvm use 24.15.0
node --version
npm --version
npm run install:all
npm run test:ci
npm run test:e2e
npm run build
```

## E2E browser setup

Install Chromium/Chrome and set `TITECH_CHROMIUM_PATH` to the executable if it is not found on PATH. The E2E suite starts the Vite dev server by default. For an approved Preview/test environment only, set `TITECH_E2E_BASE_URL` to the base URL. Never point test-data mutation suites at Production.

## Environment safety

- Do not commit `.env` files or secrets.
- Set the backend's MongoDB/Redis test endpoints to isolated disposable services.
- Use distinct preview and production credentials; do not point automated provider tests at live payment systems.
- Daily video test credentials, if used, must be sandbox/non-production credentials stored server-side.
- Do not generate fake financial settlement or ledger evidence.
