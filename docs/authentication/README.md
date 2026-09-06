# TITech Community Capital Authentication

This directory is the canonical technical documentation for the TITech Community Capital authentication lifecycle.

## Supported lifecycle

- Register / Create Account
- Sign In / Login
- Access-token lifecycle
- Refresh-token rotation
- Sign Out / Logout
- Logout all sessions
- Forgot Password
- Password Reset
- Session management
- Password change
- Authentication bootstrap and protected routes

## Architecture

```text
React Frontend
      |
      v
Central API client (Axios)
      |
      v
Express route registry
      |
      +--> /api/auth/*
      |
      +--> /api/email/* (email-domain compatibility routes)
      |
      v
Validation + rate limiting
      |
      v
Controllers
      |
      v
Authentication / password-reset services
      |
      +--> MongoDB
      +--> Redis where configured
      +--> Email infrastructure
      +--> Audit / observability
```

The existing architecture remains authoritative. This documentation does not introduce a second authentication stack.

## Canonical HTTP operations

| Operation | Endpoint | Authentication |
|---|---|---|
| Register | `POST /api/auth/register` | Public |
| Sign in | `POST /api/auth/login` | Public |
| Refresh | `POST /api/auth/refresh` | Refresh cookie / compatible body credential |
| Sign out | `POST /api/auth/logout` | Public, revokes supplied refresh state |
| Sign out all | `POST /api/auth/logout-all` | Authenticated |
| Forgot password | `POST /api/auth/forgot-password` | Public |
| Reset password | `POST /api/auth/reset-password` | Public, reset token required |
| Current user | `GET /api/auth/me` | Authenticated |

`POST /api/auth/refresh-token` remains available as the existing backward-compatible refresh alias.

`/api/email/request-password-reset` and `/api/email/reset-password` remain compatibility/domain routes. New frontend authentication flows use `/api/auth/forgot-password` and `/api/auth/reset-password`.

## Security model

- Passwords are bcrypt-hashed by the existing User model lifecycle.
- Access tokens are short-lived JWTs and are held in frontend memory.
- Refresh tokens are opaque credentials stored hashed in the existing RefreshToken model and delivered through an HttpOnly cookie.
- Refresh-token rotation and reuse detection remain server-side responsibilities.
- Password-reset tokens are cryptographically random, hashed at rest, expiring, and single-use.
- Reset identity is derived from the reset token record; the browser does not need to submit a trusted `userId`.
- Password reset invalidates active refresh sessions through the existing session mechanism.
- Authentication endpoints use the existing rate-limiting and request metadata infrastructure.
- Tenant and RBAC enforcement remain server authoritative.

## Frontend rules

The frontend must not persist access tokens in localStorage or sessionStorage. The AuthProvider remains responsible for in-memory authentication state, bootstrap, refresh scheduling, logout cleanup, protected-route state, and cross-tab/session coordination.