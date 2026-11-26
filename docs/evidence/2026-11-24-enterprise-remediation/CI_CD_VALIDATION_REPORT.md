# CI/CD validation report — 24 November 2026

- Existing CI still uses `.nvmrc`, npm 11.12.1, lockfile-aware caching, and separate root/backend/frontend `npm ci` install stages. Existing quality, backend/frontend test, build and security jobs were not removed.
- Added a `browser-e2e` job that provisions Chrome, installs the frontend package from its lockfile, runs the frontend's browser smoke script and uploads `frontend/test-reports` when produced.
- Root `test:ci` now starts with a runtime-contract unit test. Runtime checks continue to fail closed when the actual machine is not Node 24/npm 11.
- Root `build` now validates the backend entry/route graph, then the frontend production build.
- Local full CI was not executed. Node/npm are below the supported engine; dependencies are absent and npm registry DNS was unavailable. GitHub Actions was not triggered or observed. CI configuration was source-reviewed only.
