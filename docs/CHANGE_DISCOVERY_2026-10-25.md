# TITech Community Capital — Change Discovery (Patch Bundle)

**Product:** TITech Community Capital  
**Required organization identity:** TITech Capital LTD  
**Principle:** BUILD LESS. PROVE MORE. FINANCIAL CORRECTNESS BEFORE CONVENIENCE.

## Important distinction

This is an **overlay/patch bundle**, not a full repository clone. The remote repository could not be cloned in the current execution environment because GitHub DNS/network access failed. No original repository files were overwritten and no GitHub branch was committed or pushed. The additions below were generated in an isolated output folder and validated as a bundle; they must be applied and tested against a verified local checkout.

## Bundle additions

| Path in bundle | Purpose | Apply status |
|---|---|---|
| `frontend/src/legal/legalContent.js` | Central legal content for `/legal`, `/terms`, `/privacy`, all visibly draft-gated | Added to overlay; not routed in current application |
| `frontend/src/legal/LegalDocuments.jsx` | Accessible, reusable public legal pages/index and shared legal links | Added to overlay; not integrated into current route tree |
| `frontend/src/legal/LegalDocuments.css` | Responsive styles using official TITech semantic palette variables and established brand asset path | Added to overlay; depends on imported shared brand CSS and verified asset |
| `frontend/src/legal/LegalConsentFields.jsx` | Separate Terms acceptance and Privacy Policy acknowledgement fragment for the existing registration form | Added to overlay; not wired to canonical registration service |
| `frontend/src/legal/__tests__/LegalDocuments.test.jsx` | Vitest/RTL regression tests for public legal pages/content/draft status | Added to overlay; not executed against repository dependencies |
| `frontend/src/legal/__tests__/LegalConsentFields.test.jsx` | Tests for distinct required acceptance state | Added to overlay; not executed against repository dependencies |
| `scripts/apply-titech-legal-brand-patches.mjs` | Safe dry-run-first, exact-field update for organization name in current theme/brand/package metadata | Added to overlay; not run against checkout |
| `scripts/verify-titech-legal-branding.mjs` | Post-apply verification of theme palette and canonical organization strings | Added to overlay; requires actual repository root |
| `docs/legal/LEGAL_INFORMATION_DRAFT_2026-10-25.md` | Product/legal boundary information | Draft; approval required |
| `docs/legal/TERMS_OF_SERVICE_DRAFT_2026-10-25.md` | Terms draft that avoids unverified fees, licences, addresses and dispute clauses | Draft; approval required |
| `docs/legal/PRIVACY_POLICY_DRAFT_2026-10-25.md` | Privacy draft with explicit unknowns for actual practices/contacts/retention | Draft; approval required |
| `docs/legal/IMPLEMENTATION_INTEGRATION_GUIDE.md` | Exact route/auth/API integration requirements without creating parallel architecture | Instructions only, not proof of integration |
| `docs/legal/LEGAL_RELEASE_CHECKLIST.md` | Legal and technical release gate | Blocking checklist |
| `docs/remediation/REPOSITORY_GROUNDED_EXECUTION_NOTES_2026-10-25.md` | Actual publicly verified repository architecture and explicit execution limitations | Review/evidence note |
| `inputs/REFINED_TEST_FAILURE_REMEDIATION_MASTER_PROMPT_2026-10-25.txt` | Supplied test failure master prompt preserved for implementation | Input preserved |

## Exact upstream identity mismatches found

1. `branding/TITECH_OFFICIAL_THEME.json`: `organization` field currently says `TITech Africa`; expected `TITech Capital LTD`.
2. `frontend/src/branding/brand.js`: `TITECH_BRAND.legalName` currently says `TITech Community Capital LTD`; expected `TITech Capital LTD`.
3. Root and backend `package.json` author metadata include the stale `TITech Community Capital LTD` suffix. The safe patch script also updates the package-lock author metadata only if present and only if the existing JSON can be parsed.

No colors are rebranded. The nine official values are retained unchanged.

## Steps to discover every actual changed file after applying

Run PowerShell from the verified repository root:

```powershell
git status --short
git diff --stat
git diff --name-status
git diff --check
Get-ChildItem -Recurse frontend/src/legal,docs/legal,docs/remediation,scripts | Select-Object FullName
node scripts/apply-titech-legal-brand-patches.mjs
# Review the proposed files first, then:
node scripts/apply-titech-legal-brand-patches.mjs --apply
node scripts/verify-titech-legal-branding.mjs
git diff -- branding/TITECH_OFFICIAL_THEME.json frontend/src/branding/brand.js package.json backend/package.json package-lock.json backend/package-lock.json
```

After the patch script runs, inspect the repository's actual route and authentication files; the current route entry is imported by `frontend/src/main.jsx` from `./routes/AppRoutes`. Add routes and links only to the canonical files and inspect every resulting diff. Do not run `git clean`, reset the tree, or commit/push until the owner reviews the change.

## Test evidence status

- Bundle packaging/sanity validation: see final response for locally run checks.
- Frontend production build and Vitest: **NOT RUN** — repository dependencies unavailable in this environment.
- Backend Jest 30 regression suite and integrations: **NOT RUN** — repository could not be cloned and target Node/npm absent.
- Live login/registration E2E and `/legal`, `/terms`, `/privacy` in the deployed browser: **NOT VERIFIED**.
- Server-side acceptance, audit and consent version persistence: **NOT IMPLEMENTED/VERIFIED against canonical backend in this bundle**.
- Legal approval, regulatory assessment, provider and production approval: **NOT APPROVED**.
