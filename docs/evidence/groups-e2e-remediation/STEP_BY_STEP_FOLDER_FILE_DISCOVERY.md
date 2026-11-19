# Step-by-Step Folder and File Change Discovery

This document describes how to identify and review every file changed in this archive-local delivery. The downloadable ZIP is based on the uploaded archive, not a remote branch checkout.

## 1. Open the correct repository root

```text
titech-community-capital-main/
```

The source archive did not contain `.git`, so it cannot prove GitHub branch state, prior commits, or remote modifications. The exact file-by-file comparison is recorded in `CHANGED_FILES.csv`; paths are relative to this root.

## 2. Review application changes

| Folder / file | What changed | Why it matters |
|---|---|---|
| `frontend/src/pages/GroupList.css` | Added the missing active Group List selectors; independent flex action groups, button/link hit areas, visual gaps, keyboard focus, mobile wrapping, semantic theme colors, and card/list states | Corrects the source-level cause of actions appearing concatenated (for example, “View detailsOpen group”). |
| `frontend/src/pages/GroupList.jsx` | Adds the current “Community Finance. Stronger Together.” identity line to the Groups directory header | Consistent active product identity in this surface. |
| `scripts/tests/group-list-style-contract.test.mjs` | Three native tests check action selectors/gap, responsive rules/focus and official token use | Prevents regression in the exact UI defect identified. |
| `backend/tests/unit/education/educationCampaign.featureFlag.test.mjs` | Three native tests exercise default-off behavior, explicit 503/handler blocking, and route-chain delegation only when enabled | Preserves the intentional security/release gate while testing its HTTP contract. |
| `package.json` | Adds the new Group List style contract to `test:navigation-groups` | Makes the new guard part of the normal group/navigation test command. |
| `README.md` | Marks the 7 November slogan reference as a historical snapshot and points to the current canonical identity | Prevents old dated text from being read as the active tagline. |

## 3. Review the evidence folder

Open `docs/evidence/groups-e2e-remediation/` in this sequence:

1. `BASELINE_AUDIT.md` — confirmed source architecture, environment and root causes.
2. `EXISTING_IMPLEMENTATION_INVENTORY.csv` — classification of the requested capabilities and their canonical source paths.
3. `E2E_GAP_ANALYSIS.md` — journey-by-journey implemented and blocked areas.
4. `GROUP_API_INTEGRATION_MAP.md` — frontend/API/controller/service/persistence map, source-inspected rather than live traced.
5. `INVITATION_LIFECYCLE.md` and `GROUP_MEMBERSHIP_LIFECYCLE.md` — current lifecycle behavior and missing states.
6. `CONTRIBUTION_FINANCIAL_FLOW.md` and `FINANCIAL_INTEGRITY_REPORT.md` — why the group contribution flow remains disabled and how the financial controls must be closed.
7. `SECURITY_AND_TENANT_ISOLATION.md` — source-level boundaries and live security tests still needed.
8. `UI_UX_REMEDIATION_REPORT.md` and `VISUAL_REGRESSION_REPORT.md` — exact CSS changes and viewport evidence limits.
9. `TEST_EXECUTION_REPORT.md`, `VALIDATION_RESULTS.md`, and `TEST_SUMMARY.json` — commands, actual test counts, gate outcomes and blockers.
10. `CHANGED_FILES.csv` — exhaustive archive comparison with ADDED/MODIFIED/DELETED status and SHA-256 values where applicable.
11. `IMPLEMENTATION_REPORT.md` and `RELEASE_READINESS.md` — outcome and final readiness decision.

## 4. Repeat the checks locally

From the repository root, with the supported Node/npm versions installed and dependencies restored from each lockfile:

```bash
npm run test:navigation-groups
npm run test:education-campaigns
node scripts/official-theme-audit.mjs
node scripts/organization-profile-gate.mjs
node scripts/financial-static-gate.mjs
node scripts/rbac-security-gate.mjs
node scripts/enterprise-gate.mjs --syntax
```

The two native Node test commands and five source gates above were executed successfully in this delivery, except the supported-runtime check: it is blocked by the current Node/npm version. Dependency-backed build, browser, database, Redis, provider, reconciliation and external approval tests were not run and must be performed in the correct environment.

## 5. Preserve operational safety

Do not enable `TITECH_EDUCATION_CAMPAIGNS_ENABLED` just to clear the 503, and do not enable Group contribution initiation without a canonical group account mapping and complete verified provider/ledger flow. Keep `productionApproved=false`.
