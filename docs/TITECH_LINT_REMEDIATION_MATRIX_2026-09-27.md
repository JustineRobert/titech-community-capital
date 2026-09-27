# TITech Community Capital — Lint Remediation Matrix — 2026-09-27

| Error family | Remediation approach | Evidence state |
|---|---|---|
| `no-undef` shared helpers | Restored canonical/local helpers and runtime/test globals | Source-remediated; full ESLint not rerun |
| `no-control-regex` | Preserved control-character filtering via safe `RegExp` construction | Source scan PASS |
| `no-empty` | Removed empty blocks / documented intentional best-effort catches | Source scan PASS |
| `no-useless-catch` | Removed targeted transparent rethrow wrappers | Source-remediated; full ESLint not rerun |
| `no-constant-condition` | Replaced unconditional worker loop with bounded termination | Source-remediated |
| `no-dupe-keys` | Removed duplicate environment object property | Source-remediated |
| duplicate declaration / parser errors | Repaired known concatenated source files | Node syntax PASS on modified files |
| `import/no-unresolved` (`bullmq`) | Added direct backend dependency declaration | Lockfile refresh BLOCKED |
| test globals | Scoped server/test globals in ESLint config and helpers | Source-remediated; full test run not verified |
| CommonJS/ESM | Added explicit visibility in lint/evidence; remaining runtime seams retained as a release blocker | Runtime validation pending |
| unused-variable warnings | Not blanket-suppressed; remaining warning backlog requires full dependency-backed ESLint run | Pending |
