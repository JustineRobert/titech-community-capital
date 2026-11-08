# TITech Partner Portal Architecture

**Product:** TITech Community Capital  
**Organization:** TITech Capital LTD  
**Date:** 8 November 2026  
**Status:** Partially implemented; operational verification blocked by the supported runtime and missing installed dependencies.

## Canonical integration

The portal is an authenticated page in the existing React/Vite application. Its route is registered in `frontend/src/routes/AppRoutes.jsx` as `/partner-portal`, inside the existing protected `AdminLayout` route tree and guarded by the existing `PermissionRoute` using `support:case:read` or `support:case:create`. The active sidebar conditionally exposes the link based on the current permission/role context.

The page implementation is `frontend/src/pages/PartnerPortal.jsx`; its style sheet is `frontend/src/pages/PartnerPortal.css`. The seven chapter content and contextual-help registry live in `frontend/src/help/partnerGuide.js`. The client service `frontend/src/services/partnerPortalApi.js` uses the existing API client and the existing `/api/v1/operations/cases` contract.

The backend operations router is mounted by the existing API registry after canonical authentication and tenant authorization. `backend/modules/operations/operations.routes.js` exposes case list, create, detail and transition operations with existing `support:case:*` permissions. `supportCaseService.js` derives tenant and actor from request context, validates inputs with `supportCase.policy.js`, scopes every case lookup by tenant and writes canonical audit events through `backend/modules/audit/audit.service.js`.

## What is connected

- Tenant-scoped support case listing and status filtering.
- Support case creation.
- Support case detail API.
- Controlled case state transitions.
- Seven interactive guide chapters, chapter selector, previous/next controls and progress indicator.
- User guide close/reopen behaviour and per-user Help Dots preference when a stable authenticated user identifier is available.
- Contextual Help Dots for actual portal sections.
- Sanitized technical error reporting through the support-case workflow.
- Explicit capability labels for customer lookup, customer message history, customer account settings and provider-specific pathway monitoring, which are not connected in this archive snapshot.

## Integrity and scope boundaries

Support cases do not authorize payments, ledger changes, reconciliation decisions, insurance placement or any other regulated financial operation. Linked references are references only. Support access does not bypass institution membership or tenant isolation. The general application health status is not presented as telecom provider connectivity or confirmed customer message delivery.

Case events are embedded in each support-case document and canonical audit-chain entries are also requested for case creation, viewing, listing and state transition. These writes are sequential, not one MongoDB transaction; a case mutation can commit before an audit write fails. Such failure is surfaced as `SUPPORT_CASE_AUDIT_PENDING` with `committed: true` and a resource reference. Atomic case-plus-audit persistence remains an engineering follow-up and is not claimed as complete.

## Explicitly not connected

- Tenant-scoped partner customer lookup and full message history.
- Safe account-settings inspection API.
- Provider-specific messaging pathway monitor and current health observations.
- Full ticket assignment, conversation replies, internal notes, attachment pipeline, SLA breach worker and ticket escalation notifications.
- Browser-verified guide accessibility, mobile behaviour or production user acceptance.

Do not repurpose the platform-administrator member directory for partner lookup. Do not generate demo customer/message records in the live portal.
