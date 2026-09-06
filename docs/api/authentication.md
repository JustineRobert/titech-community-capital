# Authentication API Contract

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create account / sign up |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/refresh` | Rotate refresh session and issue access token |
| POST | `/api/auth/refresh-token` | Backward-compatible refresh alias |
| POST | `/api/auth/logout` | Sign out current refresh session |
| POST | `/api/auth/logout-all` | Sign out all user refresh sessions |
| POST | `/api/auth/forgot-password` | Start password recovery |
| POST | `/api/auth/reset-password` | Complete password recovery |
| GET | `/api/auth/me` | Resolve current authenticated user |
| GET | `/api/auth/sessions` | List current sessions |
| DELETE | `/api/auth/sessions/:id` | Revoke a current session |

## Response conventions

Clients must accept the existing access-token aliases (`accessToken` or `token`) while the current backend contract is normalized toward `accessToken` for future API evolution.

Authentication errors must not expose secrets, password hashes, reset tokens, refresh tokens, or infrastructure details.