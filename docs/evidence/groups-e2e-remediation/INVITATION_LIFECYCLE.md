# Invitation Lifecycle — Current Implementation Boundary

The active Groups invitation implementation is an **in-app membership record for an existing, active user in the same tenant**.

1. Group creation or `POST /api/groups/:groupId/send-invitations` validates invitee email and permitted group-member role.
2. The controller queries active, non-deleted `User` records scoped to the authenticated tenant.
3. It records a pending membership with origin `invited` on the canonical Group aggregate and appends the group audit event.
4. The authenticated intended user accepts through the group invitation endpoint; the controller checks that the pending invited membership belongs to the current user.
5. The Group aggregate is saved and membership becomes active.

## Not implemented in the active invitation controller

- Mail/SMS provider dispatch.
- Delivery receipt/status lifecycle.
- High-entropy single-use external invitation token hashes.
- New-user onboarding by invitation.
- Recipient-bound email/phone challenge.
- Explicit expiry/revocation/reminder endpoint lifecycle.

Email templates in `backend/templates/emails/groupInvitation.*` do not establish that an email was sent. Do not display a delivery-success message based on template presence or an in-app pending invitation record. Keep the distinction between `invitation recorded` and `external message delivered`.
