# TITech Chat E2E test results — 2026-11-21

## Result

**Browser E2E: NOT RUN.** No Playwright package/browser runtime is installed in the supplied environment. Node/npm also fail the repository engine baseline. MongoDB and Redis are unavailable. No browser screenshots or successful two-user journey are claimed.

## Executed tests

`node --test scripts/chat-production-gate.test.mjs`

- 2 tests passed, 0 failed.
- These are dependency-free source/readiness gate tests only; they are not application Chat E2E tests.

`node scripts/chat-production-gate.mjs`

- Gate result: BLOCKED.
- 8 blockers: backend API unmounted, protected Chat route absent, canonical socket handlers not attached, unauthorized room join path, Redis adapter absent, tenant-scoped message persistence not established, CommonJS/ESM mismatch, multi-user browser evidence absent.

## Required future browser scenarios

Authenticated user A and user B in one institution; direct conversation creation; real server persistence; Socket.IO delivery without refresh; reply; delivered/read states; reload/history; offline retry without duplicates; authorized group chat; cross-tenant denial; member removal; attachment permissions; notification deduplication; session revocation; concurrent sends; mobile layout; all four locales.

No real financial operation may be initiated by these tests.
