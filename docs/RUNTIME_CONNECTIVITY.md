# TITech Runtime Connectivity

## Runtime contract

The browser-facing runtime has one canonical connectivity state source in `frontend/src/services/runtimeConnectivity.js`.

The semantic states are:

| State | Meaning |
| --- | --- |
| `CHECKING` | A probe is in progress or the current API state is not yet known. |
| `READY` | `/api/v1/ready` returned `200` and reported `ready`. |
| `API_REACHABLE` | A TITech endpoint answered, but overall readiness has not been established. |
| `API_DEGRADED` | The API answered, normally `503 /api/v1/ready`, so the process is reachable but not ready. |
| `API_UNAVAILABLE` | The browser could not reach the API transport. |
| `OFFLINE` | The browser reports that the device is offline. |

`navigator.onLine` is never treated as proof that TITech is reachable.

## Endpoints

- Liveness: `GET /healthz` for container/process health.
- API health: `GET /api/v1/health`.
- API readiness: `GET /api/v1/ready`.
- Authentication: `POST /api/auth/login`, `/register`, `/refresh`, `/logout`.

The public authentication contract remains `/api/auth/*`; it is not rewritten to `/api/v1/auth/*`.

## Local failure diagnosis

On Windows:

```powershell
Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue
netstat -ano | findstr :5000
curl.exe -i http://localhost:5000/api/v1/health
curl.exe -i http://localhost:5000/api/v1/ready
curl.exe -i -X POST http://localhost:5000/api/auth/login `
  -H "Content-Type: application/json" `
  -d "{\"email\":\"invalid-test@example.invalid\",\"password\":\"invalid-test\"}"
```

`ERR_CONNECTION_REFUSED` means the HTTP server was not reached. It is not a credential error, CORS error, route error, or RBAC error.

## Developer startup

Use `npm run dev` from the repository root. The orchestration preflight verifies the supported Node runtime and prints frontend/backend/dependency port state before child processes are started.

The target runtime is Node.js `24.15.0+` and npm `11.x+`.

For Docker development, use `docker compose -f docker/docker-compose.dev.yml up --build`. The frontend is explicitly configured with `/api/v1` as a same-origin proxy contract; Axios normalizes that to the browser origin while preserving `/api/auth/*` and `/api/v1/*` request paths.
