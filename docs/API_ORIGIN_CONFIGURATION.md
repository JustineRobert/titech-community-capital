# TITech API Origin Configuration

## Development

`frontend/.env.development` is the deterministic local contract:

```dotenv
VITE_API_URL=http://localhost:5000
VITE_API_HEALTH_PATH=/api/v1/health
VITE_API_READINESS_PATH=/api/v1/ready
VITE_SOCKET_URL=http://localhost:5000
```

## Production / Vercel

A separately deployed frontend must set `VITE_API_URL` (or `VITE_API_BASE_URL`) to the actual backend origin before the Vite build. Example shape:

```text
VITE_API_URL=https://<actual-titech-backend-domain>
```

The frontend no longer silently falls back to `window.location.origin` in a production build.

An explicit relative `/api` or `/api/v1` value is supported only as an intentional same-origin proxy contract. The repository's Docker/Nginx configuration implements that contract.

After changing a Vercel environment variable, trigger a new production build because Vite `VITE_*` variables are build-time values.

## Anti-patterns

Do not use a frontend-only deployment hostname as the API origin. Do not append `/api/v1` to an absolute API origin when the application endpoints already contain their own route prefixes. Do not hard-code secrets or production hostnames into source files.
