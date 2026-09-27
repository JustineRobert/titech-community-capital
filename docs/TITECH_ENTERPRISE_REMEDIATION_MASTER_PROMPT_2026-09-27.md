# TITech Community Capital — Enterprise Production-Grade End-to-End Remediation Master Prompt

**Version:** 2026-09-27  
**Repository:** `https://github.com/JustineRobert/titech-community-capital`  
**Target platform:** TITech Community Capital  
**Target runtime:** Node.js 24.15.x, npm 11.x  
**Primary input:** the newest TITech Community Capital ZIP archive available to the execution environment  
**Objective:** remediate the supplied lint, parsing, module-boundary, dependency, test-environment, security, reliability and operational-quality defects to a defensible enterprise production-grade standard without changing TITech's intended architecture.

---

## 1. ROLE AND MANDATE

Act as the senior enterprise remediation engineer responsible for taking the existing TITech Community Capital repository from its current error/warning state to a source-valid, dependency-consistent, testable, observable and release-gated state.

Do not create a parallel application. Do not replace the architecture because the repository is large. Do not silently suppress lint rules. Do not weaken financial, tenancy, security, authentication, payment, ledger, idempotency, audit, reconciliation or operational controls merely to make tooling green.

The repository itself is the source of truth. Existing documentation, prior remediation reports, generated artifacts and historical claims are evidence only when they agree with executable code and current validation results.

The remediation must preserve existing working behavior and strengthen it incrementally.

---

## 2. NON-NEGOTIABLE ARCHITECTURAL PRESERVATION RULES

Preserve TITech Community Capital's established architecture and domain boundaries, including:

- multi-tenant isolation;
- authentication and authorization boundaries;
- RBAC and maker-checker controls;
- offline-first state handling;
- PaymentIntent / Instruction / Attempt / Settlement / Reconciliation separation;
- provider adapters for MTN MoMo, Airtel Money, M-Pesa and banks where already present;
- double-entry ledger integrity;
- Golden Money Path controls;
- idempotency and outbox patterns;
- auditability and immutable financial records;
- KYC/AML/risk/fraud controls;
- consented financial identity and tenant-aware context;
- observability, health/readiness and graceful startup/shutdown;
- low-data and USSD/mobile compatibility;
- existing controller → service → repository/domain boundaries.

Never fix a lint error by moving a financial mutation into a route/controller, bypassing a ledger, weakening tenant checks, disabling idempotency, dropping audit events, trusting a client-supplied tenant identity, accepting unsigned callbacks, or swallowing an operational error.

---

## 3. BASELINE ERROR SNAPSHOT TO REPRODUCE

The supplied report contained:

- **2,055 total problems**
- **1,037 errors**
- **1,018 warnings**
- **4 errors potentially fixable by ESLint --fix**

The reported high-value error families included:

1. `no-undef` — missing helpers and Node/test globals.
2. `no-control-regex` — control-character sanitization regex literals.
3. `no-empty` — empty catch blocks and empty blocks in provider/runtime code.
4. `no-useless-catch` — redundant try/catch wrappers.
5. `no-constant-condition` — unconditional loops.
6. `no-dupe-keys` — duplicate object properties.
7. parser failures — duplicate declarations and malformed merged files.
8. `import/no-unresolved` — `bullmq` used by workers but not declared/locked consistently.
9. CommonJS/ESM boundaries — `exports`, `module.exports`, `require`, and ESM package scope inconsistencies.
10. test-environment globals — `global`, `localStorage`, `sessionStorage`, `File`, Jest APIs.
11. validation scripts — `URL`, `console`, transaction variables and empty blocks.
12. enterprise runtime utilities — `Intl`, `structuredClone`, `setImmediate`, logger and safety helpers.
13. unused variables/imports — approximately 1,000 warnings requiring a real cleanup policy rather than blanket suppression.

Representative files include, but are not limited to:

- `backend/routes/momo.routes.js`
- `backend/routes/momoRoutes.js`
- `backend/routes/mtnRoutes.js`
- `backend/routes/payments.js`
- `backend/routes/rbac.js`
- `backend/routes/risk.js`
- `backend/routes/savings.routes.js`
- `backend/routes/testUssdTenant.routes.js`
- `backend/routes/transaction.routes.js`
- `backend/routes/transactionRoutes.js`
- `backend/routes/ussd.js`
- `backend/routes/ussd.routes.js`
- `backend/routes/webhook.js`
- `backend/runtime/clusterManager.js`
- `backend/runtime/context.js`
- `backend/runtime/httpServer.js`
- `backend/runtime/metrics.js`
- `backend/scripts/createIndexes.js`
- `backend/scripts/listIndexes.js`
- `backend/scripts/validation/*.mjs`
- `backend/services/admin/*.service.js`
- `backend/services/airtel/*.js`
- `backend/services/mtn/*.js`
- `backend/services/ledger*.js`
- `backend/services/payment*.js`
- `backend/services/riskScoringService.js`
- `backend/services/savingsService.js`
- `backend/services/systemSettingService.js`
- `backend/services/ussdService.js`
- `backend/services/wallet*.js`
- `backend/src/infrastructure/logging/*.js`
- `backend/src/modules/payments/providers/**`
- `backend/tenancy/*.js`
- `backend/tests/**`
- `backend/utils/admin/*.js`
- `backend/utils/circuitBreaker.js`
- `backend/utils/money.js`
- `backend/utils/response.js`
- `backend/utils/webhookSecurity.*`
- `backend/validators/*.js`
- `backend/workers/*.js`

Do not assume this list is exhaustive. Re-run discovery against the actual checkout.

---

## 4. PHASE 0 — ESTABLISH REPOSITORY TRUTH

1. Extract the supplied archive to a clean workspace.
2. Preserve the original archive unchanged as the baseline.
3. Record:
   - archive name;
   - archive SHA-256;
   - file count;
   - commit metadata when present;
   - Node/npm versions in the execution environment;
   - declared Node/npm versions in `package.json` files;
   - lockfile versions;
   - package managers;
   - dependency graph entry points;
   - ESM/CJS package boundaries.
4. Do not use a prior generated ZIP as the source of truth when the supplied archive is newer.
5. Do not assume the GitHub URL is reachable; distinguish repository target from verified network state.
6. Search for conflicts, duplicate files, zero-byte files, suspicious concatenations, malformed merge remnants and generated directories before coding.

Required commands:

```bash
node --version
npm --version
npm ci
npm --prefix backend ci
npm --prefix frontend ci
```

When the required runtime or dependency network is unavailable, mark the corresponding gate **BLOCKED**, never **PASS**.

---

## 5. PHASE 1 — BUILD AN ERROR/WARNING INVENTORY

Run the repository's canonical lint command before changing code:

```bash
npm --prefix backend run lint
```

Capture the complete output to a dated evidence file.

Classify every finding as one of:

- parser/syntax;
- missing symbol;
- wrong module system;
- bad import/export;
- dependency/lockfile;
- security-sensitive validation;
- control-flow defect;
- empty/no-op handling;
- dead code / unused declaration;
- environment/test-global;
- test syntax/JSX;
- operational/runtime;
- documentation/evidence.

Never solve the same root cause repeatedly in individual files when a canonical shared fix exists.

---

## 6. PHASE 2 — REPAIR SHARED SYMBOLS CORRECTLY

For every `no-undef` finding:

1. Search the repository for the canonical implementation first.
2. Determine whether the missing symbol should be:
   - imported from an existing module;
   - defined as a small local helper because the file has unique semantics;
   - exported from a canonical utility;
   - provided by the Node runtime;
   - provided by the test runtime.
3. Prefer a single shared implementation when semantics are identical.
4. Do not duplicate security-sensitive normalization logic across dozens of modules.
5. Do not add a global variable merely to silence lint unless it is genuinely a runtime global.

Required special cases:

### asyncHandler

Use one canonical async Express wrapper wherever practical. It must propagate rejected promises to Express `next` without changing response behavior.

### normalizeString / normalizeArray

Use bounded, deterministic helpers. Preserve existing semantics and length limits; do not strip characters that are meaningful to payments, references, user names or audit data unless the existing security contract requires it.

### validationChain / handleValidation

Use the repository's canonical `express-validator` result handler. Do not return successful responses for validation failures. Keep validation separate from authorization and tenant establishment.

### safeLogError

Logging must never mask the original business/request error. Logging failures must be contained while still preserving observability when available.

### Node globals

`URL`, `URLSearchParams`, `Buffer`, `Intl`, `structuredClone`, `setImmediate`, `console`, `global`, `fetch`, `TextDecoder`, `TextEncoder` and related Node globals must be configured correctly for the actual runtime instead of being disabled through blanket `no-undef` suppression.

### Test globals

Jest, browser storage mocks and browser-like `File`/storage globals must be scoped to test files. Do not make browser globals globally available to production server code.

---

## 7. PHASE 3 — CONTROL-CHARACTER REGEX AND INPUT SANITIZATION

The reported `no-control-regex` errors occur in security/input validation code. They must be fixed without weakening the security rule.

Do not simply add:

```js
/* eslint-disable no-control-regex */
```

Do not delete the sanitization.

Preferred approach:

- keep the same intended control-character set;
- use a safe `RegExp` constructor when necessary to avoid the lint parser restriction;
- or move the behavior into a tested canonical sanitizer utility;
- add unit tests for null bytes, line separators, tabs, ASCII control ranges, Unicode controls and normal legitimate text.

Verify equivalence using representative before/after fixtures.

Example acceptance behavior:

```text
normal text        -> accepted
UGX reference     -> accepted
phone number      -> accepted
newline/control   -> rejected or sanitized according to existing contract
NUL byte          -> rejected/sanitized
path traversal    -> rejected by path policy
provider payload  -> never logged raw
```

---

## 8. PHASE 4 — EMPTY CATCH/EMPTY BLOCK REMEDIATION

Every `no-empty` finding must be classified.

Allowed patterns are explicit and intentional, for example:

```js
catch (cleanupError) {
  logger?.debug?.('Best-effort cleanup failed', { cleanupError });
}
```

or a documented, genuinely harmless no-op where control flow requires it.

Do not use comments as a universal escape hatch. An empty catch is acceptable only where dropping the secondary failure is explicitly safe and the original operation/result remains correct.

Financial, security, authentication, payment, provider callback and ledger paths must generally rethrow or propagate secondary errors unless compensating behavior is explicitly designed.

---

## 9. PHASE 5 — REMOVE USELESS CATCH WRAPPERS

Replace:

```js
try {
  return await operation();
} catch (error) {
  throw error;
}
```

with direct propagation unless the catch adds logging, classification, metrics, compensation or another real behavior.

Never remove a catch that performs transaction rollback, provider error normalization, idempotency repair, audit logging or safe public error translation.

---

## 10. PHASE 6 — FIX CONTROL-FLOW AND OBJECT-MERGE DEFECTS

Fix `no-constant-condition` by introducing a real termination condition or intentionally bounded worker state machine.

Fix `no-dupe-keys` by determining which value is authoritative from business logic and tests. Do not delete one of two duplicate properties blindly.

Validate queue/worker loops for:

- graceful shutdown;
- abort signals;
- bounded retries;
- poison-message handling;
- backoff;
- idempotency;
- dead-letter/review paths.

---

## 11. PHASE 7 — ESM/CJS CONVERGENCE

The repository declares an ESM package boundary. Treat this as an architectural runtime contract.

Rules:

1. `.js` files under an ESM package must use `import`/`export` or a deliberate `createRequire` bridge.
2. CommonJS code must be explicitly `.cjs` where appropriate.
3. Do not declare `exports` or `module` merely to silence ESLint.
4. Do not leave `require()` in `.js` if Node will execute it as ESM.
5. Convert legacy modules incrementally, one dependency chain at a time.
6. Update every consumer when renaming `.js` to `.cjs`.
7. Validate both static imports and runtime dynamic imports.
8. Validate circular dependencies and bootstrap order.

Required gates:

```bash
npm --prefix backend run check:syntax
npm --prefix backend run check:esm
npm run check:runtime-imports
```

A module-system lint pass is not sufficient. The final evidence must show real Node 24 runtime import success.

---

## 12. PHASE 8 — DEPENDENCY AND LOCKFILE INTEGRITY

When a source file imports a package such as `bullmq`, the dependency must exist in the correct package manifest and lockfile.

For this repository specifically:

- identify every `bullmq` import;
- declare it in the correct backend dependency set;
- update the backend lockfile using the project's supported npm/runtime;
- verify package-lock integrity;
- install with `npm ci` in a clean environment;
- execute the queue worker smoke test.

Never manually fabricate registry integrity hashes.

Never claim dependency installation is verified when the registry is unavailable.

If dependency installation is blocked by the execution environment, record:

```text
BLOCKED — dependency/network verification unavailable
```

and include the exact command and environment in the evidence record.

---

## 13. PHASE 9 — TEST FILE AND BROWSER-LIKE TEST ENVIRONMENT REPAIR

Fix the test errors involving:

- `global`;
- `localStorage`;
- `sessionStorage`;
- `File`;
- Jest globals;
- JSX parsing;
- test-only helpers.

Rules:

- production modules must not gain browser globals merely to satisfy tests;
- test setup must intentionally create browser-like storage where required;
- JSX-containing test helpers must be parsed by the configured test/ESLint parser;
- unit tests must isolate mutable global state between tests;
- storage mocks must implement the expected Web Storage behavior sufficiently for application code.

Run:

```bash
npm --prefix backend test
npm --prefix backend run test:unit
npm --prefix backend run test:integration
npm --prefix backend run test:ci
```

Record skipped suites and environment blockers explicitly.

---

## 14. PHASE 10 — UNUSED VARIABLES/WARNINGS

The target is **zero unexplained warnings**.

For every `no-unused-vars` warning:

1. delete unused code only when it is truly dead;
2. otherwise wire the value into the intended behavior;
3. remove stale imports;
4. use `_` prefix only when the value is intentionally unused and the repository convention permits it;
5. do not disable `no-unused-vars` globally;
6. do not hide warnings with `/* eslint-disable */` without a documented architectural reason.

Scaffolding/constants that are intentionally reserved must be clearly documented and excluded through the narrowest possible lint scope.

The final report must distinguish:

- resolved warnings;
- intentionally retained warnings with reason;
- environment-blocked warnings.

There must be no unexplained warning backlog at production approval.

---

## 15. PHASE 11 — PAYMENT, LEDGER AND FINANCIAL SAFETY REGRESSION CONTROL

Every remediation touching finance/payment/provider modules must preserve:

### Idempotency

Repeated requests or callbacks must not duplicate monetary effects.

### Double-entry integrity

Every posted journal must balance:

```text
total debits == total credits
```

### State machine integrity

Do not allow transitions that bypass the defined transaction lifecycle.

### Provider callback authenticity

Signature/authentication/replay checks must remain enforced.

### Reconciliation

Do not call a transaction settled solely because a provider response was received. Preserve settlement/reconciliation semantics.

### Tenant isolation

Every tenant-scoped financial read/write must remain tenant-bound.

### Auditability

Financial mutations must retain actor, tenant, request/correlation ID, idempotency key, timestamps and outcome where the architecture requires them.

### Retry safety

Retries must be idempotent and must never create duplicate ledger postings.

### Failure semantics

Provider/network failures must not become successful financial transactions merely because an error was swallowed.

Run or add targeted tests around the Golden Money Path before declaring these areas remediated.

---

## 16. PHASE 12 — ENTERPRISE SECURITY

Run static and dependency security checks appropriate to the environment:

```bash
npm audit --prefix backend --audit-level=high
npm audit --prefix frontend --audit-level=high
```

Inspect at minimum:

- secrets in source and archives;
- JWT/access/refresh secret handling;
- CORS and CSRF policy;
- rate limits;
- provider credentials;
- callback signature verification;
- SSRF-sensitive outbound URLs;
- path traversal/file names;
- injection surfaces;
- object prototype pollution paths;
- dangerous dynamic imports;
- unsafe `eval`/Function construction;
- logs containing credentials or PII;
- tenant-bound authorization;
- permission escalation.

Do not upload real production secrets into the ZIP.

---

## 17. PHASE 13 — RUNTIME VALIDATION

Use the declared supported environment:

```text
Node.js 24.15.x+
npm 11.x+
```

Then validate:

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm run check
npm run test:ci
npm run build
npm run release:gate:strict
```

For live infrastructure where configured:

- MongoDB connection;
- Redis connection;
- application readiness;
- health endpoint;
- metrics endpoint;
- queue worker;
- payment sandbox connectivity;
- provider callback simulation;
- database transaction/session behavior;
- backup/restore drill;
- Kubernetes rollout/rollback gate.

No runtime proof may be inferred from static lint success.

---

## 18. PHASE 14 — OBSERVABILITY AND OPERATIONS

Validate:

- request/correlation IDs;
- tenant context propagation;
- structured logs;
- PII/secret redaction;
- metrics registration;
- readiness vs liveness semantics;
- graceful shutdown;
- worker startup/shutdown;
- retry/backoff metrics;
- payment provider latency/failure metrics;
- queue depth metrics;
- reconciliation exception metrics;
- audit events;
- alertability.

The system must fail closed for security and fail safely for financial operations.

---

## 19. PHASE 15 — QUALITY GATE ACCEPTANCE CRITERIA

The remediation is complete only when all applicable gates meet these conditions:

### Source quality

- 0 parser/syntax errors.
- 0 `no-undef` errors.
- 0 `no-control-regex` errors.
- 0 `no-empty` errors except narrowly documented intentional no-op scopes approved in the evidence file.
- 0 `no-useless-catch` errors.
- 0 `no-dupe-keys` errors.
- 0 `no-constant-condition` errors.
- 0 `import/no-unresolved` errors.
- 0 unexplained lint warnings.

### Dependency quality

- `package.json` and lockfiles aligned.
- Clean `npm ci` succeeds under Node 24.15+/npm 11+.
- All imported production packages are declared.

### Test quality

- unit tests pass;
- integration tests pass;
- security tests pass;
- provider tests/sandboxes pass where configured;
- Golden Money Path passes;
- concurrency/idempotency tests pass;
- backup/restore and operational tests pass where available.

### Runtime quality

- backend boot reaches ready;
- health/readiness endpoints are correct;
- no startup import failures;
- no critical unhandled rejection paths;
- workers can start and stop cleanly;
- MongoDB/Redis sessions and transactions behave as designed.

### Release quality

- no production secrets;
- no `node_modules`;
- no coverage directories;
- no runtime logs;
- no temporary files;
- archive is reproducible;
- SHA-256 is recorded;
- changed-file manifest is included;
- evidence report states exactly what was and was not verified.

---

## 20. REQUIRED TRACEABILITY

For every changed file, record:

| Field | Required |
|---|---|
| Path | Yes |
| Change type | Added / Modified / Removed |
| Error class | Yes |
| Root cause | Yes |
| Remediation | Yes |
| Behavior preserved | Yes |
| Validation | Yes |
| Runtime status | Verified / Blocked / Not run |
| Security impact | Yes |
| Financial impact | Yes where applicable |
| Evidence reference | Yes |

Also provide folder-level summaries so an engineer can discover exactly what changed without opening the full diff.

---

## 21. REQUIRED EVIDENCE FILES

Create or refresh:

```text
docs/TITECH_ENTERPRISE_REMEDIATION_MASTER_PROMPT_2026-09-27.md
docs/TITECH_REMEDIATION_STATUS_2026-09-27.md
docs/TITECH_CHANGED_FILES_2026-09-27.md
docs/TITECH_LINT_REMEDIATION_MATRIX_2026-09-27.md
scripts/enterprise-remediation-gate.mjs
TITECH_REMEDIATION_SHA256_2026-09-27.txt
```

The status report must never use "production ready" when runtime/dependency/provider evidence is unavailable.

Use explicit maturity states:

```text
Designed
Implemented
Unit Verified
Integration Verified
E2E Verified
Operationally Verified
Security Verified
Production Approved
```

A source-level lint pass may move an item only to the appropriate source-validation state. It cannot create external proof that was not executed.

---

## 22. RELEASE PACKAGING

Before packaging:

1. remove `node_modules`;
2. remove coverage/build caches unless required source artifacts;
3. remove runtime logs and temporary files;
4. scan for secrets;
5. verify ZIP contents;
6. compute SHA-256;
7. create changed-file manifest;
8. create remediation status report;
9. re-run the dependency-free remediation gate;
10. package the repository into a deterministic ZIP.

Recommended output name:

```text
titech-community-capital-main-enterprise-remediated-2026-09-27.zip
```

Recommended checksum:

```text
TITECH_REMEDIATION_SHA256_2026-09-27.txt
```

---

## 23. FINAL RESPONSE CONTRACT FOR THE ENGINEERING AGENT

At completion, provide:

1. exact output ZIP path;
2. SHA-256 checksum;
3. baseline archive used;
4. number of changed/added/removed files;
5. folder-level change discovery;
6. major root causes repaired;
7. validation commands executed;
8. validation commands blocked/not run;
9. remaining blockers;
10. explicit distinction between source remediation and production approval.

Do not claim:

- "all tests pass" unless the full test command passed;
- "ESLint is clean" unless ESLint actually ran cleanly;
- "production ready" unless runtime, security, provider, operational and external-proof gates are satisfied;
- "GitHub is updated" unless a verified write/push occurred.

When a gate cannot be executed, record the blocker and continue with every other evidence-producing step.

---

## 24. OPERATING PRINCIPLE

The goal is not to make the lint output look green.

The goal is to make the TITech Community Capital repository demonstrably safer, more deterministic, more maintainable, more observable and more deployable while preserving its intended enterprise architecture and financial controls.

**Repository:** `https://github.com/JustineRobert/titech-community-capital`

**Execution principle:** inspect → classify → repair root cause → prove behavior → record evidence → package → never overclaim.
