# Local CI Contract

From the repository root:

```text
npm ci
npm ci --prefix backend
npm ci --prefix frontend
npm run check
npm run test:ci
npm run build
```

For service-backed tests, start MongoDB 7 and Redis 7 with `docker compose -f docker-compose.dev.yml up -d mongodb redis`, then verify `mongosh` ping and `redis-cli ping`. Use `MONGO_URI=mongodb://127.0.0.1:27017/titech_test`, `MONGODB_URI` with the same value, `REDIS_URL=redis://127.0.0.1:6379`, and `NODE_ENV=test`.

The local command is a contract, not evidence of a passing repository: backend lint currently reports pre-existing errors and must be repaired by root cause.