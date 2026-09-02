# Server Refactoring - Quick Reference

## 🚀 Quick Start

### Local Development

```bash
npm start  # Uses MongoDB and Redis defaults
```

### With Custom Services

```bash
# MongoDB on Docker, Redis local
MONGO_URI="mongodb://mongo-container:27017/community_savings" npm start

# Custom MongoDB Atlas, custom Redis
MONGO_URI="mongodb+srv://user:pass@cluster.mongodb.net/db" \
REDIS_URI="redis://redis-host:6379" \
npm start
```

## 📍 Default Connection URIs

| Service | Environment Variable | Default                                       |
| ------- | -------------------- | --------------------------------------------- |
| MongoDB | `MONGO_URI`          | `mongodb://127.0.0.1:27017/community_savings` |
| Redis   | `REDIS_URI`          | `redis://127.0.0.1:6379`                      |

## 🔄 Retry Behavior

### MongoDB

- **Strategy**: Exponential backoff (2s → 4s → 8s → 16s)
- **Max Retries**: 5
- **On Failure**: Exit with descriptive error
- **Config Errors**: Fail immediately

### Redis

- **Strategy**: Exponential backoff (1s → 1.5s → 2.25s ...)
- **Max Retries**: 10
- **On Failure**: Fall back to memory store (app continues)
- **Log**: Every 30s (prod) or 5s (dev)

## 📊 Health Endpoints

```bash
# Health check (always available)
curl http://localhost:5000/healthz
# Response: { "status": "ok", "uptime": 123, "timestamp": "..." }

# Readiness check (requires MongoDB)
curl http://localhost:5000/readyz
# Response: { "status": "ready" } (or 503 if not ready)

# Metrics (Prometheus)
curl http://localhost:5000/metrics
```

## 🐛 Troubleshooting

### MongoDB Connection Issues

```
❌ MongoDB connection error: connect ECONNREFUSED

Solution:
1. Check MongoDB is running: mongod --version
2. Check URI format: mongodb://host:port/dbname
3. Check network connectivity: telnet localhost 27017
4. Check credentials if using Atlas
```

### Redis Connection Issues

```
⚠️ Redis is not available - using memory store

This is OK! Rate limiting will use in-memory storage.
To use Redis:
1. Start Redis: redis-server
2. Verify connectivity: redis-cli ping
3. Check REDIS_URI environment variable
```

### Both Services Down

```
MongoDB will exit the server (critical)
Redis will degrade gracefully (non-critical)
```

## 🔍 Checking Connection Status

### Via API

```bash
# Check if app is ready (all systems go)
curl http://localhost:5000/readyz

# If response is 200: App is ready
# If response is 503: Waiting for MongoDB
```

### Via Logs

```bash
# Watch for these log messages:
✅ MongoDB connected successfully     # DB is up
✅ Redis connected                    # Cache is up
⚠️ Redis is not available            # Using memory (OK)
❌ MongoDB failed after maximum retries # CRITICAL
```

## 🚨 Critical Scenarios

### Scenario 1: MongoDB Down

```
Server will: Exit immediately with error message
Action Required: Start MongoDB or update MONGO_URI
```

### Scenario 2: Redis Down

```
Server will: Continue running with memory-based rate limiting
Action Required: Start Redis to restore distributed caching
Performance: Rate limiting will not work across multiple nodes
```

### Scenario 3: Both Down

```
Server will: Exit immediately (MongoDB critical)
Action Required: Start MongoDB first
```

## 📋 Environment Setup Examples

### Docker

```bash
MONGO_URI="mongodb://mongo:27017/community_savings" \
REDIS_URI="redis://redis:6379" \
docker run -p 5000:5000 backend:latest
```

### Kubernetes

```yaml
env:
  - name: MONGO_URI
    valueFrom:
      secretKeyRef:
        name: db-secrets
        key: mongo-uri
  - name: REDIS_URI
    valueFrom:
      secretKeyRef:
        name: cache-secrets
        key: redis-uri
```

### .env File

```env
# .env file in project root
MONGO_URI=mongodb://127.0.0.1:27017/community_savings
REDIS_URI=redis://127.0.0.1:6379
NODE_ENV=development
PORT=5000
JWT_SECRET=your-secret-key-here
```

## 💡 Best Practices

1. **Always set environment variables in production**

   ```bash
   MONGO_URI="..." REDIS_URI="..." npm start
   ```

2. **Use Docker Compose for local multi-service setup**

   ```bash
   docker-compose up  # Starts MongoDB, Redis, and app
   ```

3. **Monitor health endpoints in production**

   ```bash
   # Kubernetes liveness probe
   GET /healthz

   # Kubernetes readiness probe
   GET /readyz
   ```

4. **Watch logs during startup**
   ```bash
   npm start | grep -E "✅|❌|🔄"
   ```

## 🎯 Connection Flow

```
1. Server starts
2. Reads MONGO_URI and REDIS_URI from environment
3. Logs connection details (without passwords)
4. Attempts MongoDB connection (with retries)
5. MongoDB fails? Exit with error
6. MongoDB succeeds? Mark as ready
7. Attempts Redis connection (with retries)
8. Redis fails? Use memory store (log warning)
9. Redis succeeds? Use Redis
10. Server listens on PORT
11. Ready to accept requests
```

## 🔧 Debugging Commands

```bash
# Test MongoDB connectivity
mongo "mongodb://127.0.0.1:27017/community_savings" --eval "db.adminCommand('ping')"

# Test Redis connectivity
redis-cli ping

# Check what services server found
grep -E "MongoDB|Redis|available" server.log

# Monitor retry attempts
grep "Retrying\|attempt" server.log | head -20
```

---

For detailed information, see [SERVER_REFACTORING_DOCUMENTATION.md](./SERVER_REFACTORING_DOCUMENTATION.md)
