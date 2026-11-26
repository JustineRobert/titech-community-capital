# 24 November 2026 — TITech archive-local enterprise remediation

This evidence package records the source changes and the checks actually run against the supplied `titech-community-capital-main(5).zip` snapshot.

## Read in this order

1. [`EXECUTION_REPORT.md`](EXECUTION_REPORT.md) — executive summary, root-cause register, test results and readiness decision.
2. [`ROOT_CAUSE_ANALYSIS.md`](ROOT_CAUSE_ANALYSIS.md) — why the reported failures occurred and what changed.
3. [`CHANGED_FILES.md`](CHANGED_FILES.md) — step-by-step folder/file discovery and file-level changes.
4. [`TEST_MATRIX.md`](TEST_MATRIX.md) — PASS / FAIL / BLOCKED / NOT RUN evidence table.
5. [`DEPENDENCY_INSTALLATION_REPORT.md`](DEPENDENCY_INSTALLATION_REPORT.md) — runtime, lockfiles, missing local dependencies, npm warnings and install model.
6. [`E2E_TEST_REPORT.md`](E2E_TEST_REPORT.md) — actual browser automation scope and remaining E2E coverage.
7. [`BLOCKERS_AND_REMAINING_RISKS.md`](BLOCKERS_AND_REMAINING_RISKS.md) — what still blocks Vercel Preview and production approval.
8. [`REPRODUCIBILITY_GUIDE.md`](REPRODUCIBILITY_GUIDE.md) — copy/paste developer commands for the supported runtime.

Related setup references: [`docs/deployment/VERCEL_CONFIGURATION.md`](../../deployment/VERCEL_CONFIGURATION.md), [`VERCEL_BUILD_REMEDIATION.md`](../../deployment/VERCEL_BUILD_REMEDIATION.md), [`E2E_TESTING_GUIDE.md`](../../deployment/E2E_TESTING_GUIDE.md).

**Important:** This archive has no `.git` directory. No commit, push, live deployment, production API request, real payment or live provider transaction is claimed. `productionApproved=false` remains the required state.
