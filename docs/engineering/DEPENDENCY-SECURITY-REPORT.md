# TITech Community Capital — Dependency security report

**Last verified:** 23 November 2026

## Current assessment

**BLOCKED: current npm audit metadata unavailable.** The root/backend/frontend dependency trees were each targeted independently for both full dependency and production-only npm audits (six scopes). The root npm registry request failed with `EAI_AGAIN registry.npmjs.org`; backend/frontend requests timed out. None of the blocked responses contained the required `metadata.vulnerabilities` object, so their counts are unknown. Missing counts are not zero vulnerabilities.

Historical execution logs supplied with the task cited 68 backend findings (1 low, 48 moderate, 17 high, 2 critical) and 28 frontend findings (23 moderate, 5 high). These remain historic figures only; this execution did not reproduce or clear them.

## Verified manifest facts

- `dotenv@16.6.1` is already a direct backend dependency.
- `bcrypt@6.0.0` is already declared; native binary loading could not be tested.
- `moment@2.30.1` is present in the backend lockfile as a transitive dependency.
- The root/backend/frontend lockfiles were not edited and no dependency version was changed.

No broad or forced upgrade was made. `npm audit fix --force` was not used. The root audit orchestrator is designed to fail closed unless npm returns valid machine-readable metadata.

## Required next action

Restore npm registry connectivity, use the supported Node/npm runtime, then run:

```bash
npm run security:audit
```

Review full and production-only findings separately, identify direct/transitive paths, select compatible patched versions, update one dependency family at a time, run relevant regression tests, and regenerate lockfiles only for justified package changes. Production release requires zero unresolved critical/high findings in production dependencies and documented dispositions for the remaining findings.

Machine-readable current status: `docs/evidence/2026-11-23-enterprise-e2e-remediation/reexecution-2026-11-23-1624-UGT/security-audit-summary.json`.
