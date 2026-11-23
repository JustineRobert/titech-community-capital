# TITech execution changed files

The byte-level file list is [`CHANGED_FILES.md`](CHANGED_FILES.md), with SHA-256 details in [`changed-files.json`](changed-files.json). The parent `TITech_EXECUTION_CHANGED_FILES.md` is the user-facing discovery index. See the source-file summary and how-to steps below.

## Step-by-step discovery

1. Extract `TITech_Community_Capital_enterprise_remediation_2026-11-23.zip`.
2. Open `TITECH_PLATFORM_TRUTH.md` for the dated platform status and current release decision.
3. Open `docs/evidence/2026-11-23-enterprise-e2e-remediation/CHANGED_FILES.md` for added/modified/deleted folders and files.
4. Open `changed-files.json` for each path, baseline/current SHA-256 and exact status. It is a byte-level comparison against the original uploaded ZIP because the archive did not include Git metadata.
5. Review `IMPLEMENTATION_REPORT.md` for why each code group changed; inspect the source files listed below.
6. Review `execution-logs/` and `machine-results/` before treating any gate as verified.
7. Review `ENVIRONMENT_BLOCKERS.md` and `RELEASE_READINESS_ASSESSMENT.md` before deployment decisions.

## Main source changes

- `frontend/src/components/ui/`: shared profile avatar UI and styles.
- `frontend/src/utils/`: safe user-avatar data resolution.
- `frontend/src/components/Navbar.jsx` and `.css`: signed-in desktop/mobile avatar surfaces.
- `frontend/src/pages/Settings.jsx` and `.css`: authenticated account avatar.
- `frontend/src/pages/dashboard/`: missing header stylesheet, avatar integration, dashboard identity/style enhancements.
- `frontend/src/pages/AdminRiskDashboard.jsx` and `.css`: brand lockup.
- `frontend/src/branding/dashboard-theme.css`: official semantic dashboard theme bridge.
- `scripts/tests/` and root `package.json`: avatar and dashboard regression coverage / CI wiring.
- `README.md` and `TITECH_PLATFORM_TRUTH.md`: current progress, evidence and release status.

No backend authentication, tenant authorization, payment, ledger or reconciliation implementation was changed. No source files were deleted.
