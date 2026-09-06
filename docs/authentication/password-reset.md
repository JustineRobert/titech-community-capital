# Password Reset

## Endpoint

`POST /api/auth/reset-password`

## Request

Canonical:

```json
{
  "token": "opaque-reset-token",
  "password": "NewStrongPassword123!",
  "confirmPassword": "NewStrongPassword123!"
}
```

`newPassword` remains accepted by the compatibility controller for older clients. New clients should use `password`.

## Security sequence

```text
Validate token
  -> identify reset record/account
  -> validate password policy
  -> atomically consume token
  -> update password
  -> revoke other reset tokens
  -> revoke active refresh sessions
```

A reset token is single-use and expires server-side. The browser does not submit a trusted `userId`.

## Post-reset guarantees

- Old password is rejected.
- New password is accepted.
- Used reset token is rejected.
- Existing refresh sessions are revoked.
- Reset events remain observable without logging secrets.