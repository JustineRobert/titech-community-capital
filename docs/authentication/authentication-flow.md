# Authentication Flow

## Register / Create Account

1. Frontend validates form input.
2. `POST /api/auth/register` is sent through the central API client.
3. Server-side validation normalizes the email and enforces the password policy.
4. User uniqueness is checked.
5. User is created through the existing User model.
6. Password hashing is performed by the model lifecycle.
7. Existing tenant/RBAC/account initialization remains authoritative.
8. Access token is returned and stored in frontend memory.
9. Refresh token is issued and delivered as an HttpOnly cookie.

## Sign In / Login

1. Credentials are submitted to `POST /api/auth/login`.
2. Email is normalized.
3. Account state and password are verified.
4. Access token is issued.
5. Opaque refresh token is persisted hashed and returned only as a cookie.
6. Frontend stores only the access token in memory.
7. AuthProvider loads/synchronizes the authenticated profile.

## Refresh

`POST /api/auth/refresh` reads the HttpOnly refresh cookie, validates it, rejects expired/revoked credentials, rotates the refresh token, and issues a new short-lived access token.

## Sign Out / Logout

`POST /api/auth/logout` revokes the presented refresh session and clears the refresh cookie. The frontend simultaneously clears memory state, tenant session state, timers, sockets, and local authentication state.

## Forgot Password

`POST /api/auth/forgot-password` always returns an account-enumeration-safe response. A matching account receives a secure reset link through the existing email service.

## Password Reset

`POST /api/auth/reset-password` accepts the opaque reset token and new password. The reset token itself identifies the account. The endpoint does not require a trusted user ID from the browser.

After success:

- reset token is consumed;
- active reset tokens are revoked;
- password is replaced with a bcrypt hash;
- active refresh sessions are revoked;
- old password must fail;
- new password must succeed;
- used reset token must fail.