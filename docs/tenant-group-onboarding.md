# Tenant onboarding and community groups

## Tenant invitation onboarding

Tenant administrators issue an invitation with an authenticated request:

```http
POST /api/auth/tenant-invitations
Authorization: Bearer <tenant-admin-access-token>
Content-Type: application/json

{
  "maxUses": 1,
  "expiresInHours": 72
}
```

`maxUses` is limited to 1–1,000 and `expiresInHours` to 1–720. The response
contains a high-entropy invitation code; store or share it securely because it
is shown only when created. The database stores only its SHA-256 digest. Codes
are bound to the issuing administrator's authenticated tenant, expire, and are
consumed atomically during registration. A tenant ID supplied by a client
header or request body does not establish tenant membership.

Registration requires the invitation code:

```json
{
  "name": "Community Member",
  "email": "member@example.test",
  "password": "<strong-password>",
  "tenantInviteCode": "<tenant-admin-invitation-code>"
}
```

## Group API

Group routes require a valid access token for an account that joined a tenant
through its invitation. The tenant identity is read from the signed token and
is applied to every group query.

| Operation | Development/compatibility path | Versioned path |
|---|---|---|
| List groups in the current tenant | `GET /api/groups` or `GET /groups` | `GET /api/v1/groups` |
| Create a group | `POST /api/groups` or `POST /groups` | `POST /api/v1/groups` |
| Join a group | `POST /api/groups/join/:id` | `POST /api/v1/groups/join/:id` |
| View a group (members only) | `GET /api/groups/:id` | `GET /api/v1/groups/:id` |

The group creator is automatically added as an accepted member. Invited
accounts must already be active members of the same tenant; invitations are
recorded as pending membership and become accepted when the member joins.
Cross-tenant group access is returned as not found. A repeated join returns
HTTP 409.

The frontend uses relative `/groups` API paths. This resolves to the `/groups`
development mount and to `/api/v1/groups` when the production API base is
versioned.
