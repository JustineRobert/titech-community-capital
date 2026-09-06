# Forgot Password

## Endpoint

`POST /api/auth/forgot-password`

## Request

```json
{
  "email": "member@example.com"
}
```

## Security behavior

The endpoint uses the existing password-reset service and rate limiter. It returns the same safe response whether the email is registered or not.

Delivery failures are recorded for operational investigation but are not returned as an account-existence signal to the caller.

## Token lifecycle

1. Existing active reset tokens for the account are revoked.
2. A cryptographically secure random token is generated.
3. Only its cryptographic hash is persisted.
4. The token receives an expiration time and one-time-use state.
5. The raw token is sent only through the configured email delivery path.
6. The reset URL contains the opaque token and no trusted client-supplied user identifier.