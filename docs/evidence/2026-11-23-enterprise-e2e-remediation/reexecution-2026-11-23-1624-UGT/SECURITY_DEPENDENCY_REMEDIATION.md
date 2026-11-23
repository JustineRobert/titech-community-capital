# Dependency security report

## Result: BLOCKED — current vulnerability counts unavailable

Independent `npm audit --json` attempts were made for root, backend and frontend, both with all dependencies and with `--omit=dev`. The root npm registry request returned DNS `EAI_AGAIN registry.npmjs.org`; backend and frontend audit requests timed out before producing valid npm audit metadata. An npm error object without `metadata.vulnerabilities` is not a vulnerability report and is not a clean audit.

| Package tree | Full dependency audit | Production-only audit | Current counts |
|---|---|---|---|
| Root | BLOCKED — registry DNS/network | BLOCKED — registry DNS/network | Unknown |
| Backend | BLOCKED — request timeout | BLOCKED — request timeout | Unknown |
| Frontend | BLOCKED — request timeout | BLOCKED — request timeout | Unknown |

The machine-readable `security-audit-summary.json` records all six attempts as BLOCKED and retains null counts. The corrected orchestrator in `scripts/security-audit.mjs` independently audits the six scopes and requires `metadata.vulnerabilities` with all six numeric counters before classifying an audit result.

## Historic figures (not reconfirmed)

Earlier supplied logs reported 68 backend vulnerabilities (1 low, 48 moderate, 17 high, 2 critical) and 28 frontend vulnerabilities (23 moderate, 5 high). These are historical user-supplied results, not current counts from this execution. No claim is made that they were remediated.

## Package graph findings

- `dotenv@16.6.1` is a direct backend dependency in the current manifest/lockfile.
- `bcrypt@6.0.0` is declared; no native Windows x64 binary could be installed or loaded in this execution.
- `moment@2.30.1` exists transitively in the backend lockfile under the file-stream rotation dependency graph; the missing module error is consistent with absent `node_modules`, not an absent manifest entry in this snapshot.
- No new package dependency or override was added. All three lockfiles remain unmodified.

## Release policy

No production dependency security status can be cleared until fresh successful audits of all three package trees return valid results. Production deployment remains blocked until critical/high production dependency findings are proven resolved and all remaining findings have an approved disposition. Do not use `npm audit fix --force` to force a green result.
