# Troubleshooting TITech Login

| Symptom | Correct interpretation | First action |
| --- | --- | --- |
| `ERR_CONNECTION_REFUSED` | Backend process/port unavailable | Check port 5000 and backend startup logs. |
| Health `200`, readiness `503` | API process is reachable but dependencies/readiness are degraded | Inspect readiness dependency diagnostics; do not change credentials. |
| Login `401` | Backend reached and rejected credentials | Check email/password and account credential policy. |
| Login `403` | Backend reached; account is not authorized | Check account status/authorization. |
| Login `423` | Backend reached; account is locked/suspended | Check account security state. |
| Login `429` | Rate limit active | Respect `Retry-After` and wait. |
| Login `500` | Backend reached but authentication failed internally | Use correlation/request ID to inspect sanitized backend diagnostics. |

## Browser state meanings

`CLIENT_OFFLINE` means the browser reports no network. `API_UNAVAILABLE` means the browser is online but TITech could not be reached. `API_DEGRADED` means TITech answered but readiness is not established. `READY` means readiness was explicitly confirmed.

The Login screen intentionally does not call any of these states “invalid credentials”.

## Never do this

Do not disable readiness guards, weaken CORS, change `/api/auth/login` to a different path, persist access/refresh tokens in browser storage, or suppress connection errors to make the Login UI appear green.
