# TITech Partner Portal — User Guide

**Product:** TITech Community Capital  
**Organization:** TITech Capital LTD  
**Tagline:** BUILD LESS. PROVE MORE.

## Opening the workspace

Sign in with an authorized TITech account and open **Partner Portal** from the authenticated navigation or `/partner-portal`. Access is limited by the existing `support:case:read` and `support:case:create` permissions. A route being visible does not replace server-side authorization.

## Seven interactive chapters

The guide is a React presentation configured in `frontend/src/help/partnerGuide.js` and rendered by `frontend/src/pages/PartnerPortal.jsx`.

1. **Welcome to the Partner Portal** — purpose, all-in-one workspace, privacy and truthful statuses.
2. **Understanding Your Dashboard** — support workspace and its actual connected functions.
3. **Find Customers and Review Their Messages** — states clearly that partner-safe customer search and message history are not connected in this source snapshot; use an approved support case instead.
4. **Understanding Customer Account Settings** — explains that partner-scoped account inspection is unavailable and lists restricted secrets.
5. **Create and Manage Support Tickets** — explains the connected tenant-scoped support-case API.
6. **Understanding Messaging and System Health** — distinguishes application health, provider connectivity, provider acceptance and customer delivery.
7. **Protecting Customers and Using the Portal Responsibly** — credentials, tenant boundaries, data minimization and incident reporting.

Use the chapter selector or Previous/Next. The progress indicator shows the active chapter out of seven. Help Dots can be switched on or off. The guide can be dismissed and reopened from the User Guide control. Keyboard navigation supports left/right arrows and Escape; focus is directed into the dialog and Tab navigation is contained within it.

## Creating a support case

Choose a category and priority, enter a subject and a factual description, and optionally add an approved member reference. For technical errors the browser sends only allowlisted diagnostic metadata: application version, module, route path and timestamp. Do not paste passwords, OTPs, PINs, cookies, tokens, provider secrets or unnecessary customer data.

The server supplies the authenticated actor and tenant identity. A submitted tenant ID, actor ID, assignment target or arbitrary linked field is not trusted. A successful create response confirms persistence; if audit persistence fails after the case was committed, the API reports the committed case reference and asks the user to refresh before retrying.

## Ticket lifecycle

The connected workflow supports `OPEN`, `IN_PROGRESS`, `PENDING_EXTERNAL`, `RESOLVED` and `CLOSED`, subject to server permission and transition rules. The portal shows the current recorded case events. Full agent assignment, internal-only notes, attachment upload, ticket discussion and SLA escalation are not yet delivered through this page.

## Financial and regulatory boundary

A support case, message or meeting discussion is not a financial instruction or approval. The portal does not authorize or execute payment, ledger, insurance, underwriting, deposit-taking, lending or reconciliation actions.
