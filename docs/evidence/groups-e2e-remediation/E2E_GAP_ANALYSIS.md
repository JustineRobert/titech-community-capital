# E2E Gap Analysis — Groups and Education Campaigns

| Journey / capability | Current source evidence | Remaining gap | Status |
|---|---|---|---|
| Discover groups | `GET /api/groups`, tenant-scoped Group model query, list UI | Browser/server journey not executed in this runtime | Source present; E2E blocked |
| Create group without invitees | `createGroup` accepts an empty `members` array; creator is added as `group_admin`; contract test covers creator-only path | Live database and browser persistence not tested | Source-contract verified |
| Create group with invitees | Invitees must already be active users in the same tenant; pending membership is recorded in the Group aggregate | Does not send email/SMS; no new-user account/token flow | Partial |
| Accept invitation | Authenticated user accepts an existing pending same-tenant membership entry | No high-entropy recipient-bound invitation token / expiry / replay lifecycle | Partial |
| Join group | Request path rejects already-member, pending, suspended and rejected states; persists pending request with optimistic concurrency | Live concurrency/database test not run here | Source-contract verified |
| Approve/reject membership | Permission-by-action middleware and `transitionMembership` service | Real user roles and cross-tenant HTTP tests not run | Source-contract verified |
| Member directory | Group Details uses group model membership data | Complete CRUD/profile editing/transfer UI and endpoints not evidenced | Partial |
| Group update | No update route in the active `backend/routes/groups.js` | Edit service/API/UI absent from this route surface | Not implemented in active Groups router |
| Group suspend/archive | Model lifecycle states/audit actions exist; no matching active group lifecycle route found | Authorized HTTP workflow, confirmation UI and browser proof absent | Partial / not integrated |
| External invitations | Email templates exist | `sendBatchInvitations` persists in-app invitations only; mail/SMS delivery not invoked by this controller | Blocked / not implemented in this flow |
| Contribution UI | Group Details clearly disables contribution initiation | No mounted group-scoped contribution instruction route or verified group account mapping | Safely disabled |
| Group balance | Controller blocks absent mapping | Authorized group-to-financial-account provisioning and ledger-backed integration needed | Safely blocked |
| Education campaign public list | Read-only public route, published/date-window filter, verified partner re-check, public DTO | Capability flag intentionally false; live DB/API/browser tests unavailable | Implemented but disabled |
| Education campaign manager | Authenticated tenant boundary and campaign action permissions | Capability flag intentionally false; partner/safeguarding/legal approvals and full external workflow absent | Implemented but disabled |
| Visual group list actions | CSS selectors were absent; new CSS + static regression tests added | Browser screenshots and 360–1440px rendered verification blocked | Source-level fix verified |

## Critical boundary

The 503 response for Education Campaigns is currently the documented feature-gate behavior. This pass intentionally does not bypass it. The correct next release step is to close the documented evidence and approval gates and only then set the deployment-level flag to `true` through the approved configuration process.
