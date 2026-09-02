# Staging Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying the Community Savings App to the staging environment.

## Prerequisites

- Docker & Docker Compose installed
- Staging environment configuration (`.env.staging`)
- SSL certificates (for HTTPS)
- Sufficient server resources:
  - CPU: 4 cores minimum
  - RAM: 8GB minimum
  - Storage: 50GB minimum

## Environment Setup

### 1. Prepare Environment File

Create `.env.staging` in the project root:

```bash
# Core Configuration
NODE_ENV=staging
LOG_LEVEL=info

# Database
MONGO_URI=mongodb://admin:staging-password@mongodb:27017/community-savings-staging
MONGO_USERNAME=admin
MONGO_PASSWORD=staging-password

# Redis
REDIS_URL=redis://redis:6379

# JWT Secrets (Change these!)
JWT_SECRET=your-super-secret-staging-jwt-key-change-this
ACCESS_TOKEN_SECRET=your-super-secret-staging-access-token-change-this
REFRESH_TOKEN_SECRET=your-super-secret-staging-refresh-token-change-this

# Email Configuration
SMTP_HOST=smtp.staging.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-app-password
MAIL_FROM=noreply@staging.example.com

# Payment Providers (Sandbox/Test Keys)
STRIPE_SECRET_KEY=sk_test_your_test_key
STRIPE_PUBLISHABLE_KEY=pk_test_your_test_key
MPESA_CONSUMER_KEY=your_test_key
MPESA_CONSUMER_SECRET=your_test_secret
MPESA_BUSINESS_SHORT_CODE=174379
MTN_API_KEY=your_test_key
AIRTEL_API_KEY=your_test_key

# CORS
CORS_ORIGINS=http://localhost:3000,https://staging.example.com
CLIENT_ORIGIN=https://staging.example.com

# Monitoring
GRAFANA_USER=admin
GRAFANA_PASSWORD=your-staging-password
```

### 2. Prepare SSL Certificates

```bash
mkdir -p nginx/ssl

# For self-signed certificates (testing only):
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/staging.key \
  -out nginx/ssl/staging.crt

# For production, use Let's Encrypt:
certbot certonly --standalone -d staging.example.com
```

### 3. Configure DNS

Point your domain to the staging server:

```
staging.example.com A <your-server-ip>
```

## Deployment Steps

### Automated Deployment

```bash
chmod +x scripts/deploy-staging.sh
./scripts/deploy-staging.sh
```

### Manual Deployment

#### Step 1: Build Images

```bash
docker-compose -f docker-compose.staging.yml build
```

#### Step 2: Start Services

```bash
docker-compose -f docker-compose.staging.yml up -d
```

#### Step 3: Check Status

```bash
docker-compose -f docker-compose.staging.yml ps
```

#### Step 4: View Logs

```bash
docker-compose -f docker-compose.staging.yml logs -f backend
```

#### Step 5: Run Migrations

```bash
docker-compose -f docker-compose.staging.yml exec backend npm run migrate:staging
```

### Verification

#### Service Health

```bash
curl http://localhost:5000/healthz
curl http://localhost:5000/readyz
```

#### Database Connection

```bash
docker-compose -f docker-compose.staging.yml exec mongodb \
  mongosh admin -u admin -p staging-password --eval "db.adminCommand('ping')"
```

#### Redis Connection

```bash
docker-compose -f docker-compose.staging.yml exec redis redis-cli ping
```

## Post-Deployment

### 1. Access Services

| Service      | URL                           | Credentials      |
| ------------ | ----------------------------- | ---------------- |
| Backend API  | http://localhost:5000         | -                |
| Frontend     | http://localhost:3000         | -                |
| Prometheus   | http://localhost:9090         | -                |
| Grafana      | http://localhost:3001         | admin / password |
| Nginx Status | http://localhost/nginx_status | -                |

### 2. Run Tests

```bash
# Smoke tests
npm run test:smoke

# Integration tests
npm run test:integration

# Load tests
npm run test:load

# Security tests
npm run test:security
```

### 3. Configure Monitoring

#### Grafana Setup

1. Access Grafana at `http://localhost:3001`
2. Login with default credentials
3. Add Prometheus data source:
   - URL: `http://prometheus:9090`
4. Import dashboards (available in `grafana/dashboards/`)

#### Create Dashboards

- Application Health
- Performance Metrics
- Error Rates
- Request Latency

### 4. Set Up Logging

```bash
# View application logs
docker-compose -f docker-compose.staging.yml logs -f backend

# View Nginx logs
docker-compose -f docker-compose.staging.yml logs -f nginx

# Save logs to file
docker-compose -f docker-compose.staging.yml logs > staging-logs.txt
```

### 5. Backup Configuration

```bash
# Create configuration backup
tar -czf backup-staging-$(date +%Y%m%d).tar.gz \
  .env.staging \
  nginx/ssl/ \
  prometheus/ \
  grafana/

# Upload to secure location
```

## Scaling

### Add More Backend Instances

Update `docker-compose.staging.yml`:

```yaml
backend-1:
  build: ./community-savings-app-backend
  # ... configuration ...

backend-2:
  build: ./community-savings-app-backend
  # ... configuration ...
```

Update `nginx/staging.conf`:

```nginx
upstream backend {
  server backend-1:5000;
  server backend-2:5000;
}
```

Restart services:

```bash
docker-compose -f docker-compose.staging.yml up -d
```

## Troubleshooting

### Service Won't Start

```bash
# Check logs
docker-compose -f docker-compose.staging.yml logs backend

# Restart single service
docker-compose -f docker-compose.staging.yml restart backend

# Full restart
docker-compose -f docker-compose.staging.yml down
docker-compose -f docker-compose.staging.yml up -d
```

### High CPU/Memory Usage

```bash
# Check resource usage
docker stats

# Increase resource limits in docker-compose.staging.yml
deploy:
  resources:
    limits:
      cpus: '4'
      memory: 4G
```

### Database Connection Issues

```bash
# Test MongoDB connection
docker-compose -f docker-compose.staging.yml exec backend \
  node -e "const m = require('mongoose'); m.connect(process.env.MONGO_URI).then(() => console.log('Connected')).catch(e => console.error(e))"
```

### SSL Certificate Issues

```bash
# Check certificate validity
openssl x509 -in nginx/ssl/staging.crt -text -noout

# Renew certificate
certbot renew --force-renewal
```

## Maintenance

### Regular Backups

```bash
# Create full backup
docker-compose -f docker-compose.staging.yml exec mongodb \
  mongodump --out /backup/$(date +%Y%m%d)

# List backups
ls -la /backup/
```

### Database Maintenance

```bash
# Run database cleanup
docker-compose -f docker-compose.staging.yml exec mongodb \
  mongo log-cleanup.js
```

### Log Rotation

```bash
# Configure logrotate
sudo tee /etc/logrotate.d/staging-app > /dev/null <<EOF
/path/to/logs/*.log {
  daily
  rotate 7
  compress
  delaycompress
  notifempty
  create 0640 nobody nobody
  sharedscripts
}
EOF
```

## Performance Tuning

### Database Optimization

```javascript
// Create indexes
db.contributions.createIndex({ groupId: 1, createdAt: -1 });
db.loans.createIndex({ status: 1, createdAt: -1 });
```

### Nginx Tuning

```nginx
# Increase worker connections
worker_connections 4096;

# Enable caching
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=cache:10m;
proxy_cache cache;
```

### Redis Optimization

```bash
# Analyze memory usage
redis-cli --stat

# Clear expired keys
redis-cli DEBUG OBJECT key_name
```

## Disaster Recovery

### Restore from Backup

```bash
# Extract backup
tar -xzf backup-staging-20240115.tar.gz

# Restore environment
cp backup/.env.staging .env.staging

# Rebuild and restart
docker-compose -f docker-compose.staging.yml down --volumes
docker-compose -f docker-compose.staging.yml up -d
```

## Rollback Procedure

### Rollback to Previous Version

```bash
# Stop services
docker-compose -f docker-compose.staging.yml down

# Rollback images
docker-compose -f docker-compose.staging.yml build --build-arg VERSION=previous

# Start services
docker-compose -f docker-compose.staging.yml up -d
```

## Security Checklist

- [ ] SSL certificates installed and valid
- [ ] Environment variables secured (not in version control)
- [ ] Firewall configured to allow only necessary ports
- [ ] Rate limiting enabled on API
- [ ] CORS properly configured
- [ ] Database credentials changed from defaults
- [ ] JWT secrets changed from defaults
- [ ] Monitoring alerts configured
- [ ] Backup strategy in place
- [ ] Log aggregation configured

## Contacts & Support

- DevOps Team: devops@example.com
- On-Call: +1-XXX-XXX-XXXX
- Incident Hotline: https://statuspage.example.com
