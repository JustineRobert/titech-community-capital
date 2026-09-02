# Blue-Green Production Deployment Guide

## Overview

Blue-Green deployment is a zero-downtime deployment strategy that:

- Maintains two identical production environments (Blue and Green)
- Deploys new version to inactive environment
- Tests new version thoroughly
- Switches traffic when ready
- Keeps old version running for quick rollback

## Architecture

```
                    ┌─────────────────────────┐
                    │    Load Balancer        │
                    │   (Nginx/HAProxy)       │
                    └────────────┬────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
            ┌───────▼────────┐     ┌─────────▼──────┐
            │   Blue (5001)  │     │  Green (5002)  │
            │   Environment  │     │  Environment   │
            │   (Active)     │     │   (Inactive)   │
            └────────────────┘     └────────────────┘
                    │                         │
            ┌───────┴──────┐         ┌────────┴──────┐
            │              │         │               │
        ┌───▼───┐      ┌───▼──┐  ┌──▼──┐        ┌──▼──┐
        │Backend│      │Cache │  │ DB  │        │ Logs│
        └───────┘      └──────┘  └─────┘        └─────┘
```

## Prerequisites

- Two independent Docker Compose environments
- Load balancer (Nginx/HAProxy with hot-reload capability)
- Database replication/synchronization
- Redis Sentinel for cache failover
- Comprehensive test suites
- Monitoring and alerting

## Setup

### 1. Create Environment-Specific Docker Compose Files

#### Blue Environment (docker-compose.blue.yml)

```yaml
version: '3.9'
services:
  backend:
    build: ./community-savings-app-backend
    ports:
      - '5001:5000'
    environment:
      ENVIRONMENT: production-blue
    # ... rest of configuration
```

#### Green Environment (docker-compose.green.yml)

```yaml
version: '3.9'
services:
  backend:
    build: ./community-savings-app-backend
    ports:
      - '5002:5000'
    environment:
      ENVIRONMENT: production-green
    # ... rest of configuration
```

### 2. Configure Load Balancer

Create `nginx/production-blue-green.conf`:

```nginx
upstream backend_blue {
  server localhost:5001;
}

upstream backend_green {
  server localhost:5002;
}

# Default to blue (can be switched dynamically)
map $active_backend $backend_pool {
  default backend_blue;
}

server {
  listen 80;
  server_name api.example.com;

  location / {
    proxy_pass http://$backend_pool;
  }
}
```

### 3. Environment Files

Create `.env.blue` and `.env.green`:

```bash
# .env.blue
NODE_ENV=production
ENVIRONMENT=production-blue
PORT=5001
INSTANCE_NAME=blue

# .env.green
NODE_ENV=production
ENVIRONMENT=production-green
PORT=5002
INSTANCE_NAME=green
```

## Deployment Workflow

### Phase 1: Pre-Deployment (5 minutes)

```bash
# 1. Verify active environment is healthy
curl https://api.example.com/healthz

# 2. Take backup of current database
mongodump --uri "mongodb://..." --out ./backup-before-deploy

# 3. Prepare release notes
cat > RELEASE_NOTES.md << EOF
# Release v1.2.0
## Features
- New feature X
## Bug Fixes
- Fixed issue Y
EOF
```

### Phase 2: Build & Deploy (10 minutes)

```bash
# 1. Start deployment script
./scripts/deploy-blue-green.sh

# Script automatically:
# - Identifies inactive environment
# - Builds new version
# - Starts on inactive environment
# - Runs test suite
# - Validates performance
```

### Phase 3: automated Testing (15 minutes)

Tests run automatically on inactive environment:

1. **Smoke Tests** (2 min)
   - API connectivity
   - Database connection
   - Cache availability

2. **Integration Tests** (8 min)
   - Authentication flows
   - Payment processing
   - Loan workflows
   - Data consistency

3. **Performance Tests** (5 min)
   - Response time < 500ms
   - Throughput > 1000 RPS
   - Memory stable
   - CPU usage normal

### Phase 4: Traffic Switch (2 min)

```bash
# Load balancer switches:
# Old: Blue (active, port 5001)
# New: Green (inactive, port 5002)
#
# After switch:
# Green becomes active (port 5002)
# Blue becomes inactive (port 5001)
```

### Phase 5: Post-Deployment (5 minutes)

```bash
# 1. Monitor error rates
# 2. Check performance metrics
# 3. Verify database consistency
# 4. Confirm all features working
```

## Detailed Steps

### Step-by-Step Manual Deployment

#### Step 1: Identify Active Environment

```bash
source scripts/get-active-environment.sh
echo "Active: $ACTIVE_ENV (port $ACTIVE_PORT)"
echo "Inactive: $INACTIVE_ENV (port $INACTIVE_PORT)"
```

#### Step 2: Build New Version

```bash
cd $PROJECT_ROOT
docker-compose -f docker-compose.$INACTIVE_ENV.yml build --no-cache
```

#### Step 3: Start New Environment

```bash
docker-compose -f docker-compose.$INACTIVE_ENV.yml up -d

# Wait for services
sleep 30
```

#### Step 4: Run Comprehensive Tests

```bash
# Connection checks
curl -f http://localhost:$INACTIVE_PORT/healthz
curl -f http://localhost:$INACTIVE_PORT/readyz

# Authentication test
curl -X POST http://localhost:$INACTIVE_PORT/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test"}'

# Full test suite
npm run test:smoke -- --target http://localhost:$INACTIVE_PORT
npm run test:integration -- --target http://localhost:$INACTIVE_PORT
npm run test:performance -- --target http://localhost:$INACTIVE_PORT
```

#### Step 5: Stress Test

```bash
# Run 100 concurrent requests
artillery run artillery-config.js \
  --target http://localhost:$INACTIVE_PORT \
  -p loadtest-100.yml
```

#### Step 6: Verify Database Consistency

```bash
# Check replication lag
mongo -- eval "db.getReplicationInfo()"

# Check collection counts
mongo -- eval "
  db.users.count();
  db.groups.count();
  db.contributions.count();
  db.loans.count();
"
```

#### Step 7: Update Load Balancer

```bash
# Test switch with 1% traffic
# Monitor for 2 minutes
# If stable, switch 10%
# Monitor for 2 minutes
# If stable, switch 50%
# Monitor for 2 minutes
# If stable, switch 100%
```

#### Step 8: Monitor New Active Environment

```bash
# Watch real-time metrics
watch -n 1 'curl -s http://localhost:$INACTIVE_PORT/metrics | tail -20'

# Check error rates
docker-compose -f docker-compose.$INACTIVE_ENV.yml logs -f | grep ERROR

# Monitor database
mongostat --uri "mongodb://..."
```

## Rollback Procedure

### Automatic Rollback

The deployment script automatically rolls back if:

- Build fails
- Tests fail
- Performance checks fail
- Health checks fail

### Manual Rollback

```bash
# 1. Switch traffic back to blue
echo "blue" > $PRODUCTION_DIR/.env-active

# 2. Restart blue environment
docker-compose -f docker-compose.blue.yml restart

# 3. Verify
curl https://api.example.com/healthz

# 4. Investigate issue
docker-compose -f docker-compose.green.yml logs > issue-report.log
```

### Database Rollback (if needed)

```bash
# 1. Stop all services
docker-compose -f docker-compose.blue.yml down
docker-compose -f docker-compose.green.yml down

# 2. Restore from backup
mongorestore --uri "mongodb://..." ./backup-before-deploy

# 3. Restart services
docker-compose -f docker-compose.blue.yml up -d
```

## Monitoring During Deployment

### Key Metrics to Watch

| Metric               | Target | Alert Threshold |
| -------------------- | ------ | --------------- |
| Error Rate           | < 0.1% | > 1%            |
| P99 Latency          | < 1s   | > 2s            |
| CPU Usage            | < 70%  | > 85%           |
| Memory Usage         | < 80%  | > 90%           |
| Database Connections | < 100  | > 150           |
| Queue Depth          | < 10   | > 50            |

### Monitoring Commands

```bash
# Watch error rate
watch -n 1 'curl -s http://api.example.com/metrics | grep error_total'

# Watch latency
watch -n 1 'curl -s http://api.example.com/metrics | grep duration_seconds_bucket'

# Watch throughput
watch -n 1 'curl -s http://api.example.com/metrics | grep requests_total'
```

## Health Checks

### Endpoint Health Checks

```bash
# Liveness check
curl http://localhost/healthz
# Response: 200 with uptime

# Readiness check
curl http://localhost/readyz
# Response: 200 when ready to receive traffic

# Metrics endpoint
curl http://localhost/metrics
# Response: Prometheus metrics
```

### Application Health

```bash
# Authentication
curl -X POST http://localhost/api/auth/login \
  -d '{"email":"user@example.com","password":"password"}'

# Groups
curl -H "Authorization: Bearer $TOKEN" http://localhost/api/groups

# Contributions
curl -H "Authorization: Bearer $TOKEN" http://localhost/api/contributions

# Payments (read-only)
curl -H "Authorization: Bearer $TOKEN" http://localhost/api/payments/history
```

## Post-Deployment Validation

### 1. Check Metrics

```bash
# Navigate to Grafana dashboard
http://monitoring.example.com/

# Verify metrics over past 5 minutes
```

### 2. Verify Data Consistency

```bash
# Compare blue and green database state
mongosh << EOF
  db1 = db.getSiblingDB("production"); // Blue
  db2 = db.getSiblingDB("production"); // Green

  print("Collections:");
  print("Users:", db1.users.count());
  print("Groups:", db1.groups.count());
  print("Contributions:", db1.contributions.count());
  print("Loans:", db1.loans.count());
EOF
```

### 3. Run User Acceptance Tests

```bash
npm run test:uat -- --url https://api.example.com
```

### 4. Check Third-Party Integrations

```bash
# Test payment provider connectivity
curl -X POST http://api.example.com/api/payments/health-check

# Test email service
curl -X POST http://api.example.com/api/email/health-check

# Test SMS service
curl -X POST http://api.example.com/api/sms/health-check
```

## Troubleshooting

### Deployment Fails During Build

```bash
# Check Docker space
docker system df

# Clean up unused images
docker system prune -a

# Retry build with verbose output
docker-compose -f docker-compose.$INACTIVE_ENV.yml build --verbose --no-cache
```

### New Environment Won't Start

```bash
# Check resource availability
docker stats

# Check environment variables
docker-compose -f docker-compose.$INACTIVE_ENV.yml config | grep -E "^[A-Z]"

# Check logs
docker-compose -f docker-compose.$INACTIVE_ENV.yml logs
```

### Performance Degradation After Switch

```bash
# Check active queries
mongostat --uri "mongodb://..."

# Monitor Redis
redis-cli --stat

# Check load:
load1=$(cat /proc/loadavg | awk '{print $1}')
cpus=$(nproc)
echo "Load per CPU: $(bc -l <<< "scale=2; $load1 / $cpus")"
```

### Traffic Not Switching

```bash
# Verify load balancer config reloaded
docker-compose exec nginx nginx -s reload

# Check connection to both backends
curl -I http://localhost:5001
curl -I http://localhost:5002

# Verify DNS resolution
nslookup api.example.com
```

## Automation

### CI/CD Integration

```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production

on:
  push:
    tags:
      - 'v*'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Deploy Blue-Green
        run: |
          chmod +x scripts/deploy-blue-green.sh
          ./scripts/deploy-blue-green.sh
```

### Scheduled Deployments

```bash
# Deploy at 2 AM UTC (low-traffic window)
2 * * * * /path/to/scripts/deploy-blue-green.sh
```

## Best Practices

1. **Always test thoroughly** before switching traffic
2. **Monitor closely** for at least 15 minutes after switch
3. **Keep rollback window open** for at least 1 hour
4. **Backup database** before every deployment
5. **Use canary deployments** for major changes
6. **Document deployments** for audit trails
7. **Communicate with users** about deployment windows
8. **Have runbook** for common issues

## References

- [Blue-Green Deployment Pattern](https://martinfowler.com/bliki/BlueGreenDeployment.html)
- [Nginx Dynamic Configuration](https://nginx.org/en/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Kubernetes Rolling Updates](https://kubernetes.io/docs/tutorials/kubernetes-basics/update/update-intro/)
