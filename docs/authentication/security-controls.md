# Authentication Security Controls

## Credential protection

- bcrypt password hashing
- password history support in User model
- enterprise password policy for password reset
- no plaintext password logging

## Token protection

- opaque refresh tokens
- SHA-256 token digests at rest
- HttpOnly refresh cookies
- expiration
- rotation
- revocation
- reuse detection
- one-time password-reset tokens

## Abuse protection

- login rate limiting
- registration rate limiting
- password-reset rate limiting
- refresh rate limiting
- logout rate limiting

## Information disclosure

Forgot-password responses remain generic. Reset credentials and refresh credentials are never included in normal logs or API responses.

## Tenant/RBAC

Authentication remains server authoritative for user identity, tenant context, roles, and permissions. Client-side JWT decoding is used only for scheduling purposes by AuthProvider.