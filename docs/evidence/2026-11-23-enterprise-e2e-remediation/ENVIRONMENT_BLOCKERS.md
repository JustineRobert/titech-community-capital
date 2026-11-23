# Environment and external blockers

1. Node 22.16.0 and npm 10.9.2 violate the repository minimums (Node >=24.15.0, npm >=11.0.0).
2. Root/backend/frontend `node_modules` are absent; no network/DNS access to fetch dependencies. Backend Jest executable missing; frontend Vite/Vitest build/test stack unavailable.
3. No MongoDB/mongosh, Redis server or Docker executable. Real database/Redis integration and transactional testing unavailable.
4. Chromium exists, but no Playwright/test-browser installation or built frontend; browser E2E unavailable.
5. Git metadata is absent in the supplied ZIP; remote GitHub DNS resolution failed. No branch/commit/clean-tree verification, commit, push or deployment is claimed.
6. Module audit unresolved relative imports and ESM/CJS boundary debt; 26 zero-byte test suites and 33 planned specs remain.
7. Production approval gate lacks protected `TITECH_PRODUCTION_APPROVAL`, `TITECH_APPROVAL_REFERENCE`, `TITECH_APPROVAL_EXPIRES_AT` evidence. External partner/regulatory/legal/insurer authorization is not evidenced by this source archive.
8. No provider sandbox credentials/authorization, settlement source files or external approval evidence were supplied.

These blockers are not replaced with mock evidence or claims of readiness.
