# TITech Community Capital — Installation and startup remediation

**Last verified:** 23 November 2026

## Supported environment

- Windows 11 / Git Bash or PowerShell
- Node.js `>=24.15.0` (the root `.nvmrc` is `24.15.0`)
- npm `>=11.0.0`
- Backend API default: `5000`
- Frontend default: `3000`
- Metrics default: `9090`
- MongoDB: `27017`; Redis: `6379`

The current execution container supplied Node `22.16.0` and npm `10.9.2`; the runtime gate rejected this environment. Do not bypass or lower the engine gate. No `npm ci` command was executed by the safe installer in this run.

## Safe installation

From the repository root after switching to the supported Node/npm pair:

```bash
node --version
npm --version
make install
```

The guarded workflow performs root → backend → frontend `npm ci` sequentially. It uses the existing lockfiles and stops at the first failure. Before installation it checks listeners on ports 3000, 5000 and 9090. It identifies process IDs and command lines, classifies likely TITech / unknown Node / unrelated listeners and **never terminates processes automatically**. If a TITech or ambiguous Node server is found, stop it from its owning terminal using `Ctrl+C`, confirm the ports are released, then rerun installation. Do not delete `node_modules` while an application process is running.

Package-only installation:

```bash
make install-backend
make install-frontend
```

Equivalent npm scripts:

```bash
npm run install:all
npm run install:backend
npm run install:frontend
```

Each performs the same supported-runtime and process checks before the relevant `npm ci`.

## Startup and verification

Use separate Git Bash terminals for backend and frontend:

```bash
npm run dev:backend
npm run dev:frontend
```

Or use the repository's existing combined development command:

```bash
npm run dev
```

Stop the owning foreground process with `Ctrl+C`; do not kill every Node process. Inspect ports before diagnosing `EADDRINUSE`:

```powershell
Get-NetTCPConnection -LocalPort 5000,3000,9090 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.OwningProcess)"
    [pscustomobject]@{ Port=$_.LocalPort; PID=$_.OwningProcess; Name=$owner.Name; CommandLine=$owner.CommandLine }
  }
```

After dependencies and required infrastructure exist:

```bash
npm run check
npm run test:ci
npm run build
npm run ci
```

The new `make verify` target delegates to `npm run ci`. It is not a replacement for the production approval gate.

## Missing dependency diagnostics

Migration and index CLI entrypoints load dotenv and runtime dependencies only after the CLI has parsed its arguments. A missing package gives the backend install instruction (`npm --prefix backend ci`). A missing relative application source path is reported as a source-path defect, not misdiagnosed as an npm dependency problem.

`dotenv` is already declared directly in `backend/package.json`; `moment` is present transitively in the current backend lockfile. This execution had no installed node_modules, so successful package resolution could not be demonstrated. `bcrypt@6.0.0` is declared, but Windows x64 native loading and hash/verify were not tested because installation was blocked.

## Infrastructure and operational gates

The application must use a dedicated test DB such as `community_savings_test` and an isolated Redis namespace for destructive/integration tests. Do not run migration/index tests against the developer's production `community_savings` database. A transaction-capable MongoDB replica set is required for financial integration and replay evidence. Keep provider live flags off and `productionApproved=false` until the actual release process authorizes them.

See `docs/evidence/2026-11-23-enterprise-e2e-remediation/reexecution-2026-11-23-1624-UGT/` for the run's test outcomes and blockers.
