# Enterprise Upgrades

This document summarizes the five major enhancements added to the Community Savings App
for production‑grade deployments and observability.

## 1. Docker + Nginx Production Deployment

- `Dockerfile` added to both backend and frontend projects.
- `docker-compose.yml` orchestrates services:
  - `backend` (Node.js)
  - `frontend` (React built and served by Nginx)
  - `redis` (job queue & rate limiting)
  - `redis_exporter` (Prometheus Redis metrics)
  - `prometheus` and `grafana` for monitoring
- Nginx configuration (`frontend/nginx.conf`) reverse‑proxies `/api` and `/socket.io` to the backend.
- Quick-start instructions in `QUICKSTART.md` show how to bring the stack up with `docker-compose up --build`.

## 2. Redis Queue & Rate Limiting

- Redis connection helper in `services/redis.js` (using ioredis).
- Background job queue in `services/queue.js` using Bull.
  - Example notifications queue enqueues jobs when groups are created/joined.
- Express rate limiter now uses `rate-limit-redis` store backed by Redis.
- `.env.example` contains `REDIS_URL` placeholder.

## 3. WebSocket Real-Time Notifications

- Socket.io added to backend (`socket.io` dependency).
- Server initializes `io` and exports it for other modules.
- JWT authentication for socket connections mirrors HTTP auth.
- Frontend socket client in `src/services/socket.js` with auth token support.
- AuthContext manages socket lifecycle and displays toast notifications.

## 4. CI/CD Auto-Deploy

- GitHub Actions workflow at `.github/workflows/ci-cd.yml`:
  - `build` job installs dependencies, runs tests, builds both apps, and builds Docker images.
  - `deploy` job stubs for AWS ECS and Render, using repo secrets.

## 5. Advanced Monitoring (Prometheus + Grafana)

- Prometheus metrics endpoint available at `/metrics` via `prom-client`.
- Prometheus service scraping backend and redis exporter.
- Grafana container available on port 3001; volume `grafana-data` for persistence.
- `prometheus/prometheus.yml` config included.

---

Refer to `QUICKSTART.md` and `README.md` for setup instructions.
