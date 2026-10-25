# Legal Pages — Safe Integration Guide

**Target product:** TITech Community Capital  
**Organization identity:** TITech Capital LTD  
**Status:** Frontend overlay supplied; not connected to the live route tree or registration API in this patch bundle.

This bundle deliberately adds legal-page components without replacing the existing authentication, React Router, tenancy, RBAC, refresh-token, audit or financial architecture. The repository's current `frontend/src/main.jsx` imports the canonical route module at `./routes/AppRoutes`; inspect that real module and existing auth components before integrating.

## 1. Add the routes to the canonical router

Import the components from `../legal/LegalDocuments.jsx` using the relative path appropriate to the existing route module:

```jsx
import {
  LegalIndexPage,
  LegalInformationPage,
  TermsOfServicePage,
  PrivacyPolicyPage,
} from '../legal/LegalDocuments.jsx';
```

Register the public routes in the existing React Router configuration, inside the canonical route tree and outside authentication-only guards. `/legal` is the user-requested Legal Information page; `/legal/index` is an optional document hub:

```jsx
<Route path="/legal" element={<LegalInformationPage />} />
<Route path="/legal/index" element={<LegalIndexPage />} />
<Route path="/terms" element={<TermsOfServicePage />} />
<Route path="/privacy" element={<PrivacyPolicyPage />} />
```

If the existing route contract uses route objects rather than `<Routes>`/`<Route>`, add the equivalent entries there; do not introduce a second router. Confirm direct navigation and refresh at all four paths, including the production deployment's SPA fallback/rewrite rules.

The components rely on the already documented official asset `/brand/titech-community-capital-transparent.png` and CSS design tokens supplied by `frontend/src/branding/brand.css`. If the repository's canonical `BrandLogo` component should be used by the established convention, import that existing component instead of making a second logo implementation. Preserve the existing circular logo and all nine official palette roles.

## 2. Add links to login and registration pages

In the existing login landing page, add the public policy links below the auth form or beside its existing footer. This must be display-only and must not change login, session, JWT, refresh-token or redirect behavior:

```jsx
import { LegalDocumentLinks } from '../legal/LegalDocuments.jsx';
// Place alongside the current login footer:
<LegalDocumentLinks className="auth-legal-links" />
```

In the existing account-creation page, add the required consent/acknowledgement fragment to the *existing* registration form. Wire its state into the canonical registration service and preserve any current CAPTCHA, email/phone verification, tenant invitation, RBAC, anti-abuse and audit behavior:

```jsx
import { useState } from 'react';
import { LegalDocumentLinks } from '../legal/LegalDocuments.jsx';
import { LegalConsentFields, isLegalAcceptanceComplete } from '../legal/LegalConsentFields.jsx';

const [acceptedTerms, setAcceptedTerms] = useState(false);
const [acknowledgedPrivacy, setAcknowledgedPrivacy] = useState(false);
// Render inside the existing form, before its submit control:
<LegalConsentFields
  termsAccepted={acceptedTerms}
  onTermsAcceptedChange={setAcceptedTerms}
  privacyAcknowledged={acknowledgedPrivacy}
  onPrivacyAcknowledgedChange={setAcknowledgedPrivacy}
/>
<LegalDocumentLinks />
// Add to the current submit handler (do not bypass existing validation):
if (!isLegalAcceptanceComplete({ termsAccepted: acceptedTerms, privacyAcknowledged })) {
  setFormError('Review and accept the Terms of Service and acknowledge the Privacy Policy to continue.');
  return;
}
```

Use the existing form's actual error-state API rather than adding `setFormError` if it does not exist. This is a documented insertion pattern—not a claim the current auth component has already been modified.

## 3. Required backend contract before production

The browser checkboxes are UX only. Server-side validation is mandatory. Inspect the canonical registration controller/service/model and implement the following within the existing authentication pathway (no `AuthV2`, duplicate user model or alternate registration endpoint):

- Reject registration if required acceptance is missing or false.
- Resolve the terms/privacy version from a server-approved policy registry; do not trust a client-supplied document body or acceptance timestamp.
- Write server-authoritative timestamps and accepted version IDs to the canonical user/consent record or the existing append-only audit/consent subsystem.
- Record a traceable audit event with actor/account correlation, policy versions, time and safe request metadata; do not log credentials or sensitive documents.
- Keep privacy acknowledgement distinct from purpose-specific consent. If a service uses consent as its legal basis, capture the exact purpose, recipients, categories, legal notice version, validity and withdrawal state through the existing consent architecture.
- Make revocation and account correction follow the established access-control and audit path; do not delete regulated financial/audit records to simulate privacy deletion.
- Enforce the invariant in the API independently of client-side state. Test direct API calls with omitted/false acceptance.

Do not make the consent fields production-enforcing until the legal documents have been approved and are the documents actually displayed in the form. Until then, the pages intentionally show a draft warning.

## 4. Legal release checklist

1. Confirm legal registration name, registration number, registered office, contracting entity, addresses and monitored contacts.
2. Map actual frontend, backend, database, Redis, logging, storage, provider, analytics and support data flows. Remove content that does not match deployed behavior and add any material data practices omitted from the draft.
3. Confirm controller/processor/joint-controller roles per institution and purpose; list subprocessors, recipients and data locations.
4. Finalise purpose-specific legal bases, consent flows, retention periods, children/assisted-onboarding safeguards, cross-border transfers, rights-request process, security incident response and complaint escalation.
5. Confirm current Uganda legislation and amendments with qualified counsel; assess whether each activity requires registration, notification, a data-protection officer, regulated financial licence, insurer/provider authorization or specific contracts.
6. Finalise fees, refund rules, fundraising rules, governing law, disputes, non-waivable rights, liability and institution-specific disclosures.
7. Have the authorized company representative and qualified Uganda counsel approve exact document versions and effective dates.
8. Mark the legal-content status as approved only after the above evidence has been stored in the release records. Run all gates; no source-code flag alone can equal approval.
9. Test direct URLs and refresh on deployed hosting, desktop/mobile breakpoints, keyboard navigation, screen reader names, contrast and reduced-motion behavior.
10. Capture browser E2E evidence: login links work; registration checkboxes are initially unchecked; invalid form/API submission is rejected; accepted policy version/time is recorded by the server; and legal links remain public without signing in.
