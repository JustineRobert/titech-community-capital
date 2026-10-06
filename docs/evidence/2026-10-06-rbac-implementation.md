# TITech Community Capital — RBAC Implementation Evidence

Date: 2026-10-06

## Scope

This change set integrates canonical role/policy enforcement into the existing authentication, tenant and group architecture. It does not introduce a second identity provider, tenant model or financial mutation path.

## Canonical role set

`platform_admin`, `tenant_admin`, `group_admin`, `member`, `guest`.
Legacy values remain recognized as compatibility aliases but are normalized to canonical policy roles at authorization boundaries.

## Security controls implemented

- Backend authorization policy centralizes role hierarchy and permission evaluation.
- Authenticated requests reload the authoritative User record when MongoDB is available; client-supplied role/permission/tenant claims are not treated as authoritative for protected requests.
- Disabled/deleted users are rejected.
- Group membership visibility requires an active/reinstated membership or an authorized administrator.
- Join requests enter `pending`; acceptance is an administrative transition.
- Membership transitions are explicit and auditable.
- Role changes increment security/session versions and revoke refresh tokens.
- Group administration and role endpoints are permission-gated.
- Frontend admin routes use canonical role names and a dedicated access-governance screen; backend authorization remains authoritative.
- The official TITech nine-color palette is exposed via stable semantic aliases in the central official theme CSS.

## Verification state

| Capability | State |
|---|---|
| Static syntax | Verified on local Node runtime; repository parser gate passed |
| Theme contract | Verified by existing theme audit |
| RBAC source gate | Verified by `npm run check:rbac` |
| Full Jest/integration/E2E suite | **Not verified in this environment** because repository dependencies could not be installed completely; local Node 22/npm 10 differs from target Node 24.15/npm 11 |
| Production deployment approval | **External evidence required** |
| External IdP/payment-provider/institution pilot evidence | **External evidence required** |

## Important limitation

The archive is a source snapshot rather than a Git checkout. No commit history or remote branch state is modified by this package.
