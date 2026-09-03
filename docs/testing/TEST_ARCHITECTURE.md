# Test Architecture

Backend Jest tests use the Node environment from `backend/jest.config.cjs`. Frontend tests use Vitest and browser APIs must remain isolated to the frontend test environment. MongoDB and Redis integration tests must initialize and clean their own state; mocks, timers, sessions, and application listeners must be restored in teardown.

Required financial tests include idempotency, atomic rollback, insufficient balance, concurrent operations, authorization, tenant isolation, and ledger/balance consistency. The current repository baseline does not yet provide evidence that every item passes.