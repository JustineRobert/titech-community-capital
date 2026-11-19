# Change discovery — file-by-file inventory

## Discovery method

1. The supplied source archive was extracted into a working copy.
2. The repository's root/backend/frontend manifests, brand files, theme entrypoints, Navbar, Language selector, Footer, backend route registry, Mongoose models, logging normalizer, pilot helper and existing tests were inspected.
3. The original archive was used as the baseline. File SHA-256 values were compared between the archive and working copy; filenames containing U+202F were restored exactly to avoid archive-extraction normalization.
4. Each modified/new source file is listed below. No original source file was intentionally deleted.

## Baseline delta

SHA-256 comparison against the uploaded source ZIP found **3,854 baseline files**, **3,865 current files**, **24 modified files**, **11 new files** and **0 removed original files**.

## Modified files

| Path | Change |
|---|---|
| `backend/models/Chat.js` | Corrected Mongoose `versionKey` to `'__v'`. |
| `backend/models/Transaction.js` | Corrected Mongoose `versionKey` to `'__v'`. |
| `backend/modules/loan/models/LoanAudit.js` | Corrected Mongoose `versionKey` to `'__v'`. |
| `backend/services/forumService.js` | Corrected all three invalid Mongoose `versionKey: true` schema options to `'__v'`. |
| `backend/modules/pilot/pilotReadiness.js` | Hardened evidence requirements, partner/data-protection/provider/regulatory/insurance approval gates, activation evidence, and suspended/closed handling. Remains a read-only helper. |
| `backend/tests/unit/platform/titech90dayContracts.node.test.js` | Added pilot evidence, external approval, activation, status downgrade/hold and regulated-activity gate tests. |
| `backend/package.json` | Added `test:version-key` native regression-test command. |
| `frontend/src/components/Navbar.jsx` | Added viewport measurement/repositioning for Products, Services and More panels; added positioning style to More; removed inappropriate `aria-haspopup` usage on disclosure regions. |
| `frontend/src/components/Navbar.css` | Uses the shared header/dropdown z-index tokens and constrained, internally scrollable fixed-position panels. |
| `frontend/src/components/Footer.jsx` | Resolves support and legal email links through the canonical organization profile email. |
| `frontend/src/components/HelpCenter.jsx` | Replaces the obsolete support email with the official company email. |
| `frontend/src/pages/Legal.jsx` | Aligns the legal-page contact email. |
| `frontend/src/pages/LegalPages.jsx` | Aligns the public institutional/legal page contact email. |
| `frontend/src/legal/legalConfig.js` | Aligns shared privacy/legal contact configuration. |
| `frontend/src/legal/PrivacyPolicy.jsx` | Aligns the privacy-policy contact email. |
| `frontend/src/legal/TermsOfService.jsx` | Aligns the terms-of-service contact email. |
| `frontend/src/legal/Disclaimer.jsx` | Aligns the disclaimer contact email. |
| `frontend/src/legal/documents/PrivacyPolicy.jsx` | Aligns the published privacy document contact email. |
| `frontend/src/legal/documents/TermsOfService.jsx` | Aligns the published terms document contact email. |
| `frontend/src/legal/documents/FinancialDisclaimer.jsx` | Aligns the financial disclaimer contact email. |
| `frontend/src/legal/documents/GeneralDisclaimer.jsx` | Aligns the general disclaimer contact email. |
| `backend/models/Setting.js` | Changes the default support email to the official company email. |
| `frontend/src/i18n/language-selector.css` | Constrains selector width to available viewport width. |
| `package.json` | Added regression-test scripts and included them in the configured CI/check orchestration. |

## New files

| Path | Purpose |
|---|---|
| `backend/tests/unit/platform/mongoose-version-key-contract.test.mjs` | Scans backend source for invalid direct boolean `versionKey` declarations and confirms intentional schemas retain `'__v'`. |
| `frontend/src/components/navigationMenuPlacement.js` | Pure viewport-safe menu-placement calculation. |
| `scripts/tests/navigation-menu-placement.test.mjs` | Native tests for left/right clamping, vertical flipping, bounded height and invalid geometry. |
| `reports/official-theme-audit.json` | Generated result from the official theme audit. |
| `reports/rbac-security-gate.json` | Generated result from the RBAC static gate. |
| `docs/evidence/2026-11-19-remediation/README.md` | Index of this evidence package. |
| `docs/evidence/2026-11-19-remediation/IMPLEMENTATION_REPORT.md` | Implementation summary and limitations. |
| `docs/evidence/2026-11-19-remediation/CHANGE_DISCOVERY.md` | This exact file-change inventory. |
| `docs/evidence/2026-11-19-remediation/TEST_EVIDENCE.md` | Command and result register. |
| `docs/evidence/2026-11-19-remediation/INSTITUTIONAL_PILOT_GAP_ANALYSIS.md` | Current workflow gaps and canonical ownership findings. |
| `docs/evidence/2026-11-19-remediation/RELEASE_DECISION.md` | Go/no-go decision and approval requirements. |

## Preserved areas

No new auth system, tenant authority, database, ledger, payment processor, design system or alternate application shell was created. The original nine-colour theme files, circular TITech logo, light/dark theme runtime, established route registry, JWT/refresh-cookie model, RBAC and financial-control boundaries were not intentionally replaced.

## Removed files

None. The original archive contained an image name with a narrow no-break space (U+202F); the exact original file was restored and the normalized extraction artifact removed so the source archive's filename was preserved.

## Local runtime and Git limitations

The ZIP has no `.git` metadata. A source archive does not support truthful branch, commit or remote-status reporting. The runtime and dependency blockers are detailed in `TEST_EVIDENCE.md`.
