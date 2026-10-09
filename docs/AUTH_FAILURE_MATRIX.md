# TITech Community Capital — Authentication Failure Matrix

| Condition | Backend state | Frontend state | User outcome | Automatic login retry |
|---|---|---|---|---|
| Backend unreachable | no TCP/HTTP response | `API_UNAVAILABLE` | authentication service unavailable | No |
| Backend starting | process may answer but not ready | `CHECKING` / not-ready | service starting | Controlled probe |
| Backend ready | `/api/v1/ready` = 200 | `READY` | normal login | No |
| Invalid credentials | login rejects | credential error | credentials rejected | No |
| Auth store unavailable | login/refresh returns 503 | service unavailable | retry later | No credential loop |
| Account disabled/locked | auth rejects | authentication error | access denied | No |
| 429 | rate limit | rate-limited | try later | Policy controlled |
| Access token expired | protected request 401 | refreshing | seamless where valid | Single-flight |
| Refresh expired/revoked | refresh rejects | session expired | return to login | No loop |
| 403 | authorization denied | forbidden | access denied | No |
| Tenant mismatch | server rejects | forbidden/error | access denied | No |
| Network timeout | no usable response | unavailable/checking | service unavailable | Controlled |

The implementation must preserve the distinction between transport failure, readiness failure, authentication failure and authorization failure.
