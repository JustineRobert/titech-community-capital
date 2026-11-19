# Implementation report

**Date:** 19 November 2026  
**Application:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD.  
**Tagline:** Community Finance. Stronger Together.  
**ERN (owner-supplied):** 80049233029029  
**Release state:** NO-GO for production; `productionApproved=false` remains enforced.

## 1. Executive summary

A bounded remediation was applied to the supplied repository archive. It addresses the directly identified Mongoose `versionKey` startup defect, adds a native regression test, improves viewport-aware header menu placement, hardens pilot readiness evidence gates, and aligns footer email links with the organization profile already held in the repository.

The repository's existing official nine-colour palette, light/dark theme contract, brand manifest, organization profile, React/Vite + Express architecture, cookie/JWT authentication, tenant/RBAC model, and financial boundaries were preserved. No alternative application, authentication, tenant, ledger or payment implementation was introduced.

This is **not** a claim that the complete institutional onboarding and pilot platform is now production-ready. The full institution-to-pilot lifecycle remains incomplete in the source, and runtime/build/browser verification was blocked by the available environment.

## 2. Identity and visual system

The existing brand sources already record:

- Product: `TITech Community Capital`
- Organization: `TITECH CAPITAL - SMC LTD.`
- Tagline: `Community Finance. Stronger Together.`
- ERN: `80049233029029` (owner-supplied; this task did not independently authenticate the registration record)
- Email: `titechcapital@gmail.com`
- Phone: `+256782397907`
- WhatsApp: `+256772123546`
- Postal address: `P.O. Box 601200`

The official palette in the repository remains Deep Blue `#0030A0`, Electric Blue `#0058D8`, Bright Blue `#0066E8`, Cyan `#00B8F8`, Africa Green `#008000`, Lime Green `#A8F000`, Gold Yellow `#F8D800`, Navy Ink `#082B67`, and White `#FFFFFF`.

The theme audit scanned 77 CSS files and found no hard-coded official palette values in the non-brand CSS files. This verifies use of the shared token contract at source level; it is not a screenshot-based visual audit of every dashboard. Footer, Help Center, legal, privacy and terms email contacts now use the supplied official email address; the backend default support contact was aligned as well.

## 3. Backend defect remediation

Six invalid Mongoose settings were changed from `versionKey: true` to `versionKey: '__v'`:

- `backend/models/Chat.js`
- `backend/models/Transaction.js`
- `backend/services/forumService.js` (three schema declarations)
- `backend/modules/loan/models/LoanAudit.js`

This preserves a named version key rather than disabling versioning. The new test scans backend JavaScript-family source for direct `versionKey: true` declarations and asserts the affected schemas retain `__v`.

**Verification boundary:** because backend dependencies are not installed, affected Mongoose models were not instantiated against the installed Mongoose runtime, and the full route registry was not successfully imported. The route import attempt stopped at the missing `express` package before the application could load its complete import graph.

## 4. Structured logging

The repository's existing `logArgumentNormalizer` was not replaced. Its native tests were executed and passed for message-first calls, object-first calls, error causes, secret redaction and circular data. The existing structured logging contract is preserved. A full process log-stream test is not claimed.

## 5. Navigation and responsive layout

The shared Products/Services discovery panel now uses a small pure placement helper that clamps its horizontal placement to viewport bounds, constrains height, and flips above the trigger where there is insufficient room below. The Navbar measures the rendered panel and recalculates on resize and scroll. The compact More panel uses its own narrow width and the same viewport positioning. The header and dropdowns use existing TITech z-index tokens. The Language selector width is constrained to the viewport.

The menus continue to use the application's existing React navigation and disclosure behavior. The implementation was tested at the geometry-helper level only. No browser engine, full viewport matrix, touch test, keyboard session, axe/WCAG audit or screenshot comparison was available in the environment.

## 6. Pilot readiness gate

`backend/modules/pilot/pilotReadiness.js` remains a read-only readiness assessment. The revised contract requires referenced, reviewer-attributed and timestamped evidence for technical checklist items; partner agreement and data-protection review approvals require approval references, approvers and timestamps. Additional approval evidence is required when the record declares regulated activity, live-provider use or insurance distribution.

A separate activation record with approver, approval timestamp, activating actor and activation timestamp is required before the helper returns `OPERATIONAL_PILOT`. Stale `OPERATIONAL_PILOT` input cannot bypass missing evidence; suspended and closed records remain held.

This helper is not a persistent pilot-management module, a legal review, a partner approval service, an insurer authorization, or permission to activate regulated financial activity.

## 7. What was not implemented in this pass

The following remain incomplete and are release blockers for the original full mandate:

- A mounted and complete institution application, due-diligence, review, approval and tenant-provisioning workflow.
- A persistent pilot model, API, permissions, dashboard and audit lifecycle.
- Complete distinct VSLA share-out, ROSCA rotation/payout and Chama cycle engines.
- Complete member onboarding and institution-staff provisioning integrated end to end with approvals.
- Provider-verified contribution flow from payment initiation through settlement, canonical financial transaction, ledger, receipt and reconciliation.
- Full insurance partner onboarding and authorization evidence for any actual insurance distribution.
- Refugee/host-community operational pilot evidence and authorized partner review.
- Full light/dark dashboard visual inspection and responsive browser testing.

See [Institutional and pilot gap analysis](INSTITUTIONAL_PILOT_GAP_ANALYSIS.md).

## 8. Delivery

The modified source has been packaged separately as an updated ZIP. Since the supplied archive contains no `.git` directory, no branch, commit, remote state or clean Git status is claimed. Exact source-file delta is listed in [Change discovery](CHANGE_DISCOVERY.md).
