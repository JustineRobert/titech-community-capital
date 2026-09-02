# Production Deployment Guide - Community Savings App

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Environment Configuration](#environment-configuration)
3. [Database Setup](#database-setup)
4. [Security Hardening](#security-hardening)
5. [Performance Tuning](#performance-tuning)
6. [Monitoring & Logging](#monitoring--logging)
7. [Deployment Steps](#deployment-steps)
8. [Post-Deployment Verification](#post-deployment-verification)
9. [Disaster Recovery](#disaster-recovery)

## Pre-Deployment Checklist

### Code Quality

- [ ] All tests passing (`npm run test:ci`)
- [ ] No console.log statements in production code
- [ ] Code review completed
- [ ] Dependencies audited (`npm audit`)
- [ ] Security vulnerabilities resolved
- [ ] Performance profiling completed

### Documentation

- [ ] API documentation generated (Swagger)
- [ ] Architecture documentation updated
- [ ] Deployment runbooks prepared
- [ ] Incident response plan documented
- [ ] Database migration scripts tested

### Infrastructure

- [ ] SSL/TLS certificates ready
- [ ] Backup systems configured
- [ ] Monitoring alerts set up
- [ ] Load balancer configured
- [ ] CDN enabled (if applicable)

## Environment Configuration

### Production Environment Variables

```bash
# Server
NODE_ENV=production
PORT=5000
APP_NAME=community-savings
APP_VERSION=1.0.0

# Database
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/community-savings-prod?retryWrites=true&w=majority
MONGO_REPLICA_SET=rs0
DB_POOL_SIZE=10

# Security
JWT_SECRET=<generate-strong-random-key>
JWT_EXPIRE=24h
REFRESH_TOKEN_SECRET=<generate-strong-random-key>
REFRESH_TOKEN_EXPIRE=7d
SESSION_SECRET=<generate-strong-random-key>

# CORS & CSRF
CORS_ORIGIN=https://app.community-savings.app
CSRF_PROTECTION=true

# Email (SendGrid/Nodemailer)
SENDGRID_API_KEY=<api-key>
MAIL_FROM=noreply@community-savings.app

# Mobile Money Integration
MOMO_API_KEY=<api-key>
MOMO_API_URL=https://api.mtn-momo.com
MOMO_ENVIRONMENT=production

# Monitoring
LOG_LEVEL=info
SENTRY_DSN=<sentry-dsn>
NEW_RELIC_LICENSE_KEY=<new-relic-key>

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=1000

# Feature Flags
FEATURE_CHAT_ENABLED=true
FEATURE_REFERRAL_ENABLED=true
FEATURE_MOBILE_MONEY_ENABLED=true
```

### Secrets Management

```bash
# Use environment-specific secrets
# Store in secure vault (AWS Secrets Manager, HashiCorp Vault, etc.)

# Rotate credentials every 90 days
# Document access logs
# Implement principle of least privilege
```

## Database Setup

### MongoDB Atlas Production Setup

```javascript
// 1. Create M10+ cluster (minimum for production)
// 2. Enable encryption at rest
// 3. Configure backup automated daily
// 4. Enable IP whitelist
// 5. Create dedicated database user with limited permissions

// Application startup: Initialize indexes
const { initializeIndexes } = require('./config/performanceOptimization');

async function startApp() {
  await initializeIndexes();
  // ... start server
}
```

### Database Backup Strategy

```bash
# Daily automated backups
0 2 * * * mongodump --uri="mongodb+srv://..." --out=/backups/$(date +\%Y-\%m-\%d)

# Retention: 30 days
# Test restore: Weekly

# Monitor backup completion
# Alert on backup failure
```

### Index Verification

```javascript
// Verify all indexes created successfully
db.collection.getIndexes();

// Monitor index performance
db.collection.aggregate([{ $indexStats: {} }]);
```

## Security Hardening

### SSL/TLS Configuration

```javascript
// Use HTTPS only
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('/etc/ssl/private/key.pem'),
  cert: fs.readFileSync('/etc/ssl/certs/cert.pem'),
};

https.createServer(options, app).listen(443);
```

### Security Headers

```javascript
// Helmet.js configuration (already implemented)
const helmet = require('helmet');

app.use(
  helmet({
    hsts: { maxAge: 31536000, preload: true },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
      },
    },
  })
);
```

### Rate Limiting

```javascript
// Global rate limit
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
});

app.use(limiter);
```

### Input Validation & Sanitization

```javascript
// All requests validated with express-validator
// MongoDB injection prevention: express-mongo-sanitize
// XSS prevention: xss-clean middleware

app.use(mongoSanitize());
app.use(xss());
```

## Performance Tuning

### Node.js Optimization

```bash
# Increase memory limit
NODE_OPTIONS="--max-old-space-size=4096"

# Enable clustering
npm install cluster

# Use PM2 for process management
pm2 start server.js -i max --name "community-savings"
```

### Database Query Optimization

```javascript
// Use indexes for all queries
// Implement query timeouts
// Cache frequently accessed data
// Use aggregation pipeline for analytics

// Example optimized query
await User.findById(userId).select('name email phone role').lean(); // Return plain JS object, not Mongoose document
```

### Caching Strategy

```javascript
// Redis for session store and caching
const redis = require('redis');
const client = redis.createClient();

// Cache loan eligibility assessments (30 minutes)
// Cache user profiles (1 hour)
// Cache analytics (5 minutes)
```

## Monitoring & Logging

### Centralized Logging

```javascript
// Winston logger configuration
const logger = require('./utils/logger');

// Log levels: error, warn, info, http, debug
logger.info('Loan application created', {
  userId: user._id,
  loanId: loan._id,
  amount: loan.amount,
});
```

### Application Monitoring

```javascript
// New Relic / DataDog integration
const newrelic = require('newrelic');

// Track key metrics:
// - Response times
// - Error rates
// - Database query performance
// - Cache hit rates
// - Loan approval rates
// - Payment collection rates
```

### Alerting

```yaml
# Alert thresholds:
- Error rate > 1%
- Response time > 1000ms
- Database connection pool exhaustion
- Disk space < 10%
- Memory usage > 80%
- Loan default rate > 5%
```

## Deployment Steps

### 1. Pre-deployment

```bash
# Run full test suite
npm run test:ci

# Build Docker image
docker build -t community-savings:1.0.0 .

# Run security scan
trivy image community-savings:1.0.0

# Push to registry
docker push registry.example.com/community-savings:1.0.0
```

### 2. Staging Deployment

```bash
# Deploy to staging environment
kubectl apply -f k8s/staging/ -n staging

# Run smoke tests
npm run test:smoke

# Load test
npm run test:load

# Security testing
npm run test:security
```

### 3. Production Deployment

```bash
# Create database backup
mongodump --uri="mongodb+srv://..." --out=/backups/pre-deployment

# Deploy blue-green
kubectl apply -f k8s/production/blue.yaml

# Health checks
curl https://api.community-savings.app/health

# Switch traffic
kubectl patch service community-savings -p '{"spec":{"selector":{"version":"green"}}}'

# Monitor metrics for 30 minutes
```

### 4. Rollback Plan

```bash
# If issues detected within 30 minutes
kubectl rollout undo deployment/community-savings -n production

# Verify rollback
kubectl rollout status deployment/community-savings -n production

# Investigate issues
kubectl logs -f deployment/community-savings -n production
```

## Post-Deployment Verification

### Functional Tests

```bash
# Health check endpoint
GET /api/health
Expected: { "status": "healthy", "uptime": "..." }

# Authentication
POST /api/auth/login
Expected: { "success": true, "token": "..." }

# Loan endpoints
GET /api/loans/eligibility/:groupId
Expected: { "success": true, "data": {...} }

# Admin dashboard
GET /api/admin/dashboard
Expected: { "success": true, "data": {...} }
```

### Performance Verification

```bash
# Response time targets
- API endpoints: < 200ms (p95)
- Database queries: < 100ms (p95)
- Aggregation queries: < 1000ms (p95)

# Check via monitoring dashboard
# Monitor during peak hours
# Verify cache hit rates > 70%
```

### Security Verification

```bash
# SSL/TLS test
curl https://api.community-savings.app/
# Verify: A+ rating on SSL Labs

# Security headers check
curl -I https://api.community-savings.app/
# Verify: HSTS, CSP, X-Frame-Options

# Rate limiting test
# Verify: Requests limited correctly
```

## Disaster Recovery

### Backup & Recovery Procedures

```bash
# Full database backup
mongodump --uri="..." --out=/backups/full-$(date +%Y%m%d)

# Restore from backup
mongorestore --uri="..." /backups/full-20240204

# Point-in-time recovery
# Enable MongoDB replication
# Use oplog for PITR
```

### High Availability Setup

```yaml
# MongoDB Replica Set (3+ nodes)
- Primary: handles all writes
- Secondary: async replication
- Arbiter: voting only

# Application layer
- Load balancer (HAProxy / NGINX)
- Multiple app instances (min 3)
- Session affinity disabled (stateless)
```

### Incident Response

```
1. Detection & Alerting
   ├── Automated alerts trigger
   └── On-call engineer notified

2. Initial Response (15 min)
   ├── Verify issue
   ├── Check logs & metrics
   └── Page escalation if needed

3. Mitigation (30 min)
   ├── Roll back if critical
   ├── Scale up resources
   └── Enable read-only mode if needed

4. Resolution (1-4 hours)
   ├── Identify root cause
   ├── Deploy fix
   └── Monitor for stability

5. Post-Incident (24-48 hours)
   ├── Write incident report
   ├── Identify preventive measures
   └── Update runbooks
```

### Failover Testing

```bash
# Test monthly
# Simulate primary database failure
# Verify automatic failover to secondary
# Test application reconnection
# Measure failover time (target: < 30 seconds)
```

## Monitoring Dashboard

Monitor these key metrics:

| Metric                  | Target  | Warning | Critical |
| ----------------------- | ------- | ------- | -------- |
| Error Rate              | < 0.1%  | > 0.5%  | > 1%     |
| Response Time (p95)     | < 200ms | > 500ms | > 1000ms |
| CPU Usage               | < 60%   | > 75%   | > 85%    |
| Memory Usage            | < 70%   | > 80%   | > 90%    |
| Disk Usage              | < 60%   | > 75%   | > 85%    |
| DB Connection Pool      | < 70%   | > 80%   | > 90%    |
| Loan Default Rate       | < 2%    | > 3%    | > 5%     |
| Payment Collection Rate | > 95%   | < 90%   | < 80%    |

## Support & Escalation

### Escalation Matrix

| Issue         | Owner             | Response Time | Resolution Time |
| ------------- | ----------------- | ------------- | --------------- |
| P1 (Down)     | On-call + Manager | 5 min         | 15 min          |
| P2 (Degraded) | On-call           | 15 min        | 1 hour          |
| P3 (Bug)      | Team Lead         | 1 hour        | 4 hours         |
| P4 (Feature)  | Product Owner     | 1 day         | 2 weeks         |

### Contact Information

- **On-Call**: [PagerDuty Link]
- **Slack Channel**: #community-savings-ops
- **War Room**: [Zoom Link]
- **Status Page**: https://status.community-savings.app

---

**Last Updated**: February 4, 2026
**Version**: 1.0.0
**Maintained By**: DevOps Team
