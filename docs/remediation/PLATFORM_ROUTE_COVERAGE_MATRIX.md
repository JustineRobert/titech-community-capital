# TITech Community Capital — Route Coverage Matrix

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Review date:** 11 November 2026

## Active routing authority

The active browser entry is `frontend/src/main.jsx`, which mounts `frontend/src/routes/AppRoutes.jsx` through `Providers` and its existing `BrowserRouter`. `frontend/src/App.jsx` is not mounted by this entrypoint and was retained pending a safe legacy-consumer audit.

All 38 lazy import statements in `AppRoutes.jsx` were checked for a corresponding source file. No direct lazy-import target was missing. Browser render and transitive Vite module resolution remain unverified because dependencies and the required runtime were unavailable.

## Route inventory

| Route | Page/module | Access boundary | Source/import result | Current evidence |
|---|---|---|---|---|
| `/` | `pages/public/InstitutionalPublicPages.jsx` → `HomePage` | Public site layout | Target exists; named export mapped | Static route contract PASS; browser NOT RUN |
| `/book-a-demo` | `InstitutionalPublicPages.jsx` → `BookDemoPage` | Public site layout | Target exists; named export mapped | Static route target PASS; browser NOT RUN |
| `/contact-us` | `InstitutionalPublicPages.jsx` → `ContactUsPage` | Public site layout | Target exists; named export mapped | Static route target PASS; browser NOT RUN |
| `/chat-with-titech` | `InstitutionalPublicPages.jsx` → `GuidedChatPage` | Public site layout | Target exists; named export mapped | Static route target PASS; browser NOT RUN |
| `/education-support` | `EducationSupportPage.jsx` | Public site layout | Target exists | Route target PASS; browser NOT RUN |
| `/edufinance` | `EduFinancePage.jsx` | Public site layout; application actions use server policy | Target exists | EduFinance domain tests PASS; browser NOT RUN |
| `/faith-community-giving` | `FaithCommunityGivingPage.jsx` | Public site layout | Target exists | Faith domain tests PASS; route-contract test PASS |
| `/login` | `Login.jsx` | Public-auth route | Target exists | Auth integration/browser NOT RUN |
| `/logout` | `Logout.jsx` | Public sign-out route | Target exists | Session E2E NOT RUN |
| `/register` | `Register.jsx` | Public-auth route | Target exists | Registration E2E NOT RUN |
| `/forgot-password` | `ForgotPassword.jsx` | Public-auth route | Target exists | Password recovery E2E NOT RUN |
| `/reset-password` | `ResetPassword.jsx` | Public-auth route | Target exists | Password reset E2E NOT RUN |
| `/verify-email` | `VerifyEmail.jsx` | Public-auth route | Target exists | Verification E2E NOT RUN |
| `/legal` | `LegalDocuments.jsx` | Public | Target exists | Static only |
| `/terms` | `LegalDocuments.jsx` | Public | Target exists | Static only |
| `/privacy` | `LegalDocuments.jsx` | Public | Target exists | Static only |
| `/dashboard` | `Dashboard.jsx` | Protected + protected layout | Target exists | Static target PASS; browser/API NOT RUN |
| `/admin` | `admin/AdminDashboard.jsx` | Protected + admin role | Target exists | RBAC static gate PASS; browser NOT RUN |
| `/members` | `Members.jsx` | Protected + protected layout | Target exists | Static target PASS; browser/API NOT RUN |
| `/savings` | `Savings.jsx` | Protected + protected layout | Target exists | Static target PASS; browser/API NOT RUN |
| `/loans` | `Loans.jsx` | Protected + protected layout | Target exists | Static target PASS; browser/API NOT RUN |
| `/transactions` | `Transactions.jsx` | Protected + protected layout | Target exists | Static target PASS; browser/API NOT RUN |
| `/reports` | `Reports.jsx` | Protected + protected layout | Target exists | Static target PASS; browser/API NOT RUN |
| `/payroll` | `Payroll.jsx` | Protected + protected layout | Target exists | Static target PASS; browser/API NOT RUN |
| `/groups` | `GroupList.jsx` | Protected + protected layout | Target exists | Navigation/group contract tests PASS; live persistence NOT RUN |
| `/groups/:groupId` | `GroupDetails.jsx` | Protected + protected layout + ownership/role-aware page behaviour | Target exists | Group UI contract tests PASS; live persistence NOT RUN |
| `/create-group` | `CreateGroupV2.jsx` | Protected + protected layout | Target exists | Group form/route contract tests PASS; live persistence NOT RUN |
| `/groups/create` | Redirect to `/create-group` | Protected + protected layout | Route declaration exists | Legacy alias contract PASS |
| `/meetings` | `meetings/Meetings.jsx` | Protected + protected layout | Target exists | Static target PASS; provider/API/browser NOT RUN |
| `/inclusive-onboarding` | `inclusive-onboarding/InclusiveOnboardingPage.jsx` | Protected + protected layout | Target exists | 27 inclusive/insurance/offline domain tests PASS; browser NOT RUN |
| `/retirement-support` | `retirement-support/RetirementSupportPage.jsx` | Protected + protected layout | Target exists | 16 retirement tests PASS; browser NOT RUN |
| `/agriculture` | `agriculture/AgricultureDashboard.jsx` | Protected + protected layout | Target exists | Static target PASS; browser/API NOT RUN |
| `/ubuntu-float` | `ubuntu-float/UbuntuFloatPage.jsx` | Protected + protected layout; server capability/RBAC gates apply | Target exists | 13 UbuntuFloat tests PASS; live API NOT RUN |
| `/partner-support` | `PartnerPortal.jsx` | Protected + protected layout | Target exists | Static target PASS; browser/API NOT RUN |
| `/education-support/manage` | `EducationCampaignManagerPage.jsx` | Protected + protected layout; server feature/permission gates | Target exists | 12 education campaign tests PASS; browser NOT RUN |
| `/faith-community-giving/manage` | `FaithGivingManagerPage.jsx` | Protected + `FaithGivingManagerRoute` role allow-list | Target exists | Role/policy/static tests PASS; browser negative tests NOT RUN |
| `/settings` | `Settings.jsx` | Protected + admin role | Target exists | RBAC static gate PASS; browser NOT RUN |
| `/admin/access` | `AccessGovernance.jsx` | Protected + admin role | Target exists | RBAC static gate PASS; browser NOT RUN |
| `*` | `NotFound.jsx` | Global fallback | Target exists | Static target PASS; browser NOT RUN |

## Shared route dependencies

| Dependency | Active source | Finding | Status |
|---|---|---|---|
| Browser entry | `frontend/src/main.jsx` | Imports global CSS/brand tokens, providers, i18n and `AppRoutes` | Static verified |
| Provider tree | `frontend/src/app/providers.jsx` | Redux/PersistGate, BrowserRouter, AuthProvider, notifications, bootstrap, root error boundary | Static verified; runtime NOT RUN |
| Auth state | `frontend/src/context/AuthContext.jsx` | Canonical auth provider | Preserved; session E2E NOT RUN |
| API client | `frontend/src/services/api.js` | Canonical API service imported by page/service modules | Static references exist; HTTP calls NOT RUN |
| Route guard | `AppRoutes.jsx` | Auth, admin and Faith Giving management guards | Static verified; browser negative tests NOT RUN |
| Route error boundary | `routes/RouteErrorBoundary.jsx` | Previously existed but was not mounted; now wraps active route tree/Suspense | Implemented; injected runtime failure NOT RUN |
| Theme entry | `main.jsx`, `branding/brand.css`, `branding/official-theme.css`, `branding/theme.js` | Theme initialized before app render | Theme audit PASS |

## Required browser verification still pending

Test all routes directly on a clean browser profile under Node `>=24.15.0`/npm `>=11`, with the backend and required MongoDB/Redis services online. For each route record: actual HTTP/API responses, auth state, tenant, role, component render, console/network errors, loading/empty/error states, refresh and back/forward behaviour. No route is marked browser-PASS by this source-level matrix.
