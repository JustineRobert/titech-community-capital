# Group API Integration Map

The following map reflects source inspection, not a live HTTP trace.

| Operation | Frontend source | API / backend source | Authorization / tenant boundary | Persistence / caveat |
|---|---|---|---|---|
| Group listing | `frontend/src/pages/GroupList.jsx` | `GET /api/groups` in `backend/routes/groups.js` → `groupController.getGroups` | `authenticate`, `requireTenantContext`, `GROUP_VIEW`; tenant derived from authenticated context | `Group.findTenantGroups` with limit/skip |
| Group creation | `frontend/src/pages/CreateGroupV2.jsx` | `POST /api/groups` → `groupController.createGroup` | `GROUP_CREATE`; controller restricts to tenant/platform administrator and validates tenant ObjectIds | Group saved with creator `group_admin`; duplicate names map to 409 |
| Group detail | `frontend/src/pages/GroupDetails.jsx` | `GET /api/groups/:id` → `getGroupById` | Authenticated tenant context and `canViewGroup` | `Group.findTenantGroup`; unauthorized/non-member access denied |
| Membership request | Group List join handler | `POST /api/groups/join/:id` (legacy alias `POST /api/groups/join/:id` / route contract) → `requestJoinGroup` | `MEMBERSHIP_REQUEST`, tenant and active group | Pending membership persisted in Group aggregate; optimistic concurrency conflict maps to 409 |
| Invitation acceptance | Group Details / invitee page path | `POST /api/groups/:id/accept-invitation` → `acceptInvitation` | Authenticated tenant; pending invited membership must match current user | Accepts an already-existing membership invitation; no arbitrary account provisioning |
| Batch invitations | `CreateGroupV2` / Group Details integration | `POST /api/groups/:groupId/send-invitations` → `sendBatchInvitations` | `getAuthorizedGroup`, tenant-scoped active existing users | In-app pending membership entries; no external email/SMS delivery in this controller |
| Membership request listing | Group Details | `GET /api/groups/:groupId/membership-requests` → `getMembershipRequests` | `MEMBERSHIP_VIEW` plus `canManageGroup` resource scope | Queries only active same-tenant user records for pending requests |
| Membership moderation | Group Details | `PATCH /api/groups/:groupId/members/:memberUserId` → `moderateMembership` | Action-to-permission map, then `transitionMembership` resource checks | Approve/reject/suspend/remove/reinstate/role actions; audited in Group aggregate |
| Leave group | Group Details | `DELETE /api/groups/:id/leave` → `leaveGroup` | Authenticated tenant; creator cannot leave via this route | Removes membership; does not erase referenced financial records |
| Group balance | Group Details | `/api/v1/group-wallets/:id/balance` → `groupWalletController.getBalance` | Tenant + `canViewGroup` | Fails closed with `GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED` because Group has no canonical ledger account mapping |
| Group contribution | Explicit unavailable panel | No group-scoped route mounted in this Groups router | Must reuse canonical financial operation and payment authorization | Initiation remains disabled; generic contribution API is not assumed to be a group payment flow |
| Education public campaigns | `EducationSupportPage.jsx` | `GET /api/v1/education/campaigns/public` | Public read-only route; capability flag | 503 `CAPABILITY_DISABLED` while flag is false; published/date/partner filters when enabled |
| Education management | `EducationCampaignManagerPage.jsx` | `/api/v1/education/campaigns` routes | `authenticate`, `tenantAuthorization`, action RBAC, capability flag | Tenant-scoped campaign model and audit path; flag intentionally false |

## Unimplemented / unverified route surfaces

No active `PATCH /api/groups/:id`, `DELETE /api/groups/:id`, `POST /api/groups/:id/archive`, `POST /api/groups/:id/suspend`, or dedicated member profile CRUD route was found in `backend/routes/groups.js`. Do not display or advertise those operations as complete until canonical service/controller/API integration and tests exist.
