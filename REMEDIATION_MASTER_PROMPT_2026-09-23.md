# TITech Community Capital — End-to-End Enterprise Remediation Master Prompt

## Purpose

Apply this prompt to the TITech Community Capital repository or an exported ZIP when the objective is to **remedy verified build/startup/module-resolution errors while preserving the existing architectural design**.

The implementation agent MUST treat the repository as an existing enterprise system, not as a greenfield project. The primary rule is: **repair the smallest verified defect at the correct architectural boundary; do not rewrite or redesign working subsystems merely to make the code look newer.**

## Authoritative inputs

1. The supplied project archive is the working source artifact for code changes.
2. The live repository is:
   `https://github.com/JustineRobert/titech-community-capital`
3. Inspect the live `main` branch before making changes so the agent can distinguish current design from stale archive state.
4. Inspect the supplied startup logs, stack traces, package metadata, scripts, routes, bootstrap code, dependency boundaries, and tests.
5. Treat `TITECH_PLATFORM_TRUTH.md`, architecture/financial/ledger/tenancy documentation, and actual implementation as evidence; do not declare functionality production-approved merely because documentation says it exists.

## Current verified failure pattern to repair

The supplied startup evidence shows:

- Node is starting the backend through `server.js` under the backend package's ESM configuration.
- The application bootstrap phases are ordered as environment → configuration → logger → observability → readiness → resilience → infrastructure → services → middleware → routes → server.
- `bootstrap/observability.js` failed because the canonical legacy CommonJS implementation was loaded as an ES module and raised `ReferenceError: module is not defined in ES module scope`.
- `bootstrap/resilience.js` failed for the same CommonJS-in-ESM reason.
- Startup then failed in the routes phase with `ROUTES_MODULE_IMPORT_FAILED`.

Do not treat the first visible error as the only error. After each repair, re-run the parser/import graph and continue until the next verified blocker is resolved.

## Architecture preservation rules

### Preserve the existing platform shape

Do not redesign these boundaries unless the evidence proves they are broken:

`server.js`
→ `ApplicationBootstrap`
→ bootstrap phases
→ middleware
→ route registry
→ controllers
→ services
→ repositories/models
→ infrastructure/providers

Preserve the existing financial boundary:

`Controller`
→ `Financial Transaction Service / Coordinator`
→ repositories / ledger / balances / outbox

Controllers must not acquire direct balance/ledger mutation authority as a shortcut.

### Preserve financial invariants

Never weaken or bypass:

- tenant isolation
- authorization
- idempotency
- financial transaction/session boundaries
- atomic balance mutations
- double-entry ledger balancing
- append-only transaction/audit expectations
- reconciliation and settlement state controls
- provider abstraction boundaries
- rollback/compensation semantics

A syntax fix must never become a financial-logic rewrite.

### Preserve module-format intent

The backend declares `type: module`.

When a legacy CommonJS module is still intentionally part of the current architecture, prefer a **narrow boundary adapter** using:

```js
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
```

Then load only the legacy module that is actually CommonJS.

Do NOT bulk-convert the repository from CommonJS to ESM or from ESM to CommonJS simply to silence module errors.

Do NOT rename `.js` files to `.cjs` when doing so would alter route/module contracts unless the repository's architecture explicitly requires that migration.

## Required inspection procedure

### Step 1 — Establish a baseline

- Record the input ZIP SHA-256.
- Record the Git branch/commit used for comparison.
- Record Node and npm versions.
- Parse backend/package.json and note `type`, engines, scripts, dependencies, and module expectations.
- Preserve a clean unmodified copy for rollback.

### Step 2 — Build a repository truth map

Inventory:

- bootstrap phase order
- route registry and dynamic route resolution
- ESM modules
- CommonJS modules
- createRequire compatibility boundaries
- controllers/services/repositories/models
- financial orchestration
- payment providers
- resilience/observability
- tests and CI scripts

Do not infer missing contracts from filenames alone. Read the actual callers and exports.

### Step 3 — Reproduce errors in order

Run the project's own checks first, then targeted checks:

```bash
npm run build
npm run check:syntax
npm run check:esm
npm run check:bootstrap
npm run diagnose:routes
```

When dependencies are unavailable, distinguish a dependency-installation failure from a source-code failure. Do not claim runtime verification that was not performed.

### Step 4 — Classify each error

Every finding must be classified as one of:

1. parser/syntax error
2. module-format mismatch
3. module-resolution/import error
4. duplicate declaration caused by merged/appended implementation blocks
5. missing dependency / install-state issue
6. test-only contamination in runtime code
7. actual architectural defect
8. external environment issue

Only items demonstrated by evidence may be changed.

## Surgical repair rules

### Rule A — ESM ↔ CommonJS boundary

When the caller is intentionally ESM and the callee is intentionally legacy CommonJS:

- keep the caller ESM;
- load the CJS module through `createRequire`;
- preserve the existing export shape;
- change no business logic.

For dynamic loader systems that already contain a CJS fallback, extend fallback detection only for Node's narrowly identifiable CJS-in-ESM errors (`module`, `exports`, or `require` not defined in ES module scope). Do not catch arbitrary runtime errors and silently fall back.

### Rule B — Duplicate declarations

When duplicate declarations occur:

- first check whether one is genuinely unused;
- if one is a redundant preliminary declaration, remove only that declaration/block;
- if two complete implementations represent layered enterprise extensions, do NOT delete one blindly;
- compose them with inheritance or explicit delegation when the existing behavior and call graph support that structure;
- preserve the public exported class/function name.

### Rule C — Appended implementation blocks

If a file contains multiple sequential implementations of the same class or service:

1. identify the earliest/base implementation;
2. identify later blocks by responsibilities and callers;
3. preserve materially distinct capabilities;
4. use a deliberate inheritance/delegation chain rather than destructive deletion;
5. ensure constructors pass the caller's configuration through the chain;
6. keep the final public export compatible.

### Rule D — Detached/orphan code

Code at module scope that references undefined variables from an otherwise unrelated method body is invalid. Remove or relocate only when the surrounding implementation proves it is an accidental detached fragment.

Never invent a new service workflow merely to make orphaned statements compile.

### Rule E — Runtime/test separation

Jest mocks, test fixtures, self-requires, and test-only bootstrapping do not belong inside runtime controllers/services. Move the runtime file back to its existing module contract while keeping test behavior under the test suite.

### Rule F — Syntax is necessary, not sufficient

A file is not considered repaired merely because `node --check` succeeds. Also inspect:

- export shape
- import shape
- route loader expectations
- dependency availability
- bootstrap order
- service/repository boundaries
- side effects and initialization
- error propagation

## Exact remediation classes already identified in this cycle

The verified remediation set includes:

- bootstrap observability CommonJS boundary
- bootstrap resilience CommonJS fallback detection
- financial repository registry outbox CommonJS boundary
- financial repositories' legacy tenant constants boundaries
- duplicate analytics factory tail
- composed layered SagaStep implementation
- StatementRepairService detached code/class-boundary repair
- composed Airtel SettlementService layers
- duplicate TenantRepository contract
- duplicate TenantResolver configuration/header resolver
- duplicate GracefulDegradation preliminary symbols/helpers/status
- duplicate compression preliminary blocks
- contaminated ComplianceController runtime/test boundary
- duplicated/legacy `listIndexes.js`
- SMTP password operator-precedence syntax
- duplicate storage default configuration
- duplicate DistributedTransactionRepository local history declaration
- ESM/CJS bridges in TransactionController, dashboard/email controllers, account model, response utility, and worker modules

Treat this list as a starting audit result, not as permission to alter similarly named files without re-verification in the current source tree.

## Validation gate

The implementation is complete only when all applicable gates pass:

### Source gates

```bash
node --check server.js
npm run check:syntax
```

And a full backend source scan must report no syntax errors for project `.js/.mjs/.cjs` files (excluding known test files that intentionally contain JSX unless their toolchain validates them separately).

### Module-graph gates

The active application graph must have no unintended static ESM → local CommonJS imports. Intentional CJS loading must use the explicit compatibility boundary.

### Runtime gates

With the project's required Node/npm versions and installed dependencies:

```bash
npm ci
npm run check:esm
npm run check:bootstrap
npm run diagnose:routes
npm test
npm run lint
npm run format:check
```

Then start the backend and verify:

- observability phase loads
- resilience phase loads
- routes phase loads
- server phase starts
- health/readiness endpoints respond
- no startup rollback is triggered

### Financial regression gates

Run the existing financial, transaction, ledger, reconciliation, payment-provider, and idempotency tests. Do not substitute a smaller green test set for a failing financial suite.

### Operational gates

Confirm that:

- no secrets were added
- no tokens/credentials are persisted client-side
- no tenant isolation was weakened
- no ledger mutation bypass was introduced
- no payment-provider contract was silently changed
- no database migration was introduced without explicit evidence

## Change traceability requirements

For every changed file, report:

- exact path
- original problem
- evidence proving the problem
- precise change
- why that change is the smallest safe repair
- public contract preserved
- tests/checks performed

Generate:

- `REMEDIATION_MASTER_PROMPT_YYYY-MM-DD.md`
- `REMEDIATION_CHANGELOG_YYYY-MM-DD.md`
- `REMEDIATION_FILE_CHANGE_MANIFEST_YYYY-MM-DD.csv`
- baseline and output SHA-256 files

Also provide a concise rollback procedure.

## Live repository safety rule

The agent may inspect the live GitHub repository, but **must not push, force-push, rewrite history, open a PR, merge a branch, or alter the live repository** unless the user explicitly requests that action.

The ZIP remediation artifact is the primary output of this workflow.

## Final reporting format

Return:

1. remediation status
2. exact changed-file list
3. step-by-step explanation of each class of repair
4. validation results
5. known limitations / environment limitations
6. output archive path
7. rollback instructions

Do not describe the system as production-approved merely because source syntax passes. Production approval requires successful dependency installation, runtime startup, tests, security checks, operational evidence, provider verification, and the repository's defined production-readiness criteria.
