# Production Deployment Guide

## Community Savings App - Production Ready Implementation

This guide covers deploying the enhanced Community Savings App to production with all security, scalability, and reliability best practices implemented.

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Infrastructure Setup](#infrastructure-setup)
3. [Backend Deployment](#backend-deployment)
4. [Frontend Deployment](#frontend-deployment)
5. [Mobile Money Configuration](#mobile-money-configuration)
6. [Security Hardening](#security-hardening)
7. [Monitoring & Logging](#monitoring--logging)
8. [Backup & Recovery](#backup--recovery)
9. [Performance Optimization](#performance-optimization)
10. [Troubleshooting](#troubleshooting)

---

## Pre-Deployment Checklist

### Code Quality

- [ ] All linting errors resolved
- [ ] Unit tests passing (>80% coverage)
- [ ] Integration tests passing
- [ ] Security scan completed (no critical vulnerabilities)
- [ ] Code review completed
- [ ] Dependencies updated to latest secure versions
- [ ] No console.log statements in production code
- [ ] Error messages don't expose sensitive information

### Database

- [ ] MongoDB Atlas cluster created
- [ ] Backup enabled and tested
- [ ] Indexes created for all queries
- [ ] Connection pooling configured
- [ ] Database user credentials secured
- [ ] Network access whitelist configured

### Environment Variables

- [ ] `.env.production` created with all required variables
- [ ] API keys rotated from development
- [ ] JWT secrets generated securely
- [ ] Payment provider credentials validated
- [ ] Database URI points to production cluster
- [ ] CORS origins configured for production domain

### Certificates & Keys

- [ ] SSL/TLS certificates obtained (Let's Encrypt recommended)
- [ ] Private keys secured and backed up
- [ ] Certificate renewal automation configured
- [ ] Certificate pinning implemented (optional but recommended)

### Domain & DNS

- [ ] Custom domain purchased
- [ ] DNS records configured (A, CNAME, MX)
- [ ] SSL certificate matches domain
- [ ] Email records (SPF, DKIM, DMARC) configured
- [ ] CDN configured for static assets

---

## Infrastructure Setup

### Recommended Stack

```
Frontend:
- Hosting: Vercel, Netlify, or AWS CloudFront + S3
- CDN: CloudFlare or AWS CloudFront
- Storage: AWS S3 or Google Cloud Storage

Backend:
- Hosting: Heroku, DigitalOcean, AWS EC2, or Google Cloud Run
- Database: MongoDB Atlas (recommended)
- Cache: Redis for session storage
- Message Queue: RabbitMQ or AWS SQS (for async tasks)

Monitoring:
- Application: New Relic, Datadog, or Sentry
- Infrastructure: AWS CloudWatch or Google Cloud Monitoring
- Logs: ELK Stack, CloudWatch Logs, or Stackdriver
```

### AWS EC2 Setup (Example)

```bash
# Launch EC2 instance
aws ec2 run-instances \
  --image-id ami-0c02fb55956c7d316 \
  --instance-type t3.medium \
  --security-groups web-app-sg \
  --key-name production-key

# Install Node.js
curl -sL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 (process manager)
sudo npm install -g pm2

# Install Nginx (reverse proxy)
sudo apt-get install -y nginx

# Configure firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### MongoDB Atlas Setup

1. **Create Cluster**
   - Provider: AWS (matches your region)
   - Tier: M10 or higher for production
   - Backup: Enable continuous backups

2. **Configure Network**
   - Add IP whitelist
   - Enable VPC peering if using VPC
   - Create database user with strong password

3. **Create Database**

   ```javascript
   Database: community_savings_prod
   Collections: users, groups, payments, loans, etc.
   ```

4. **Enable Monitoring**
   - Real-time performance monitoring
   - Alert on slow queries
   - Monitor replication lag

---

## Backend Deployment

### 1. Prepare Backend

```bash
# Clone repository
git clone https://github.com/yourusername/community-savings-app.git
cd community-savings-app/community-savings-app-backend

# Install dependencies
npm install --only=production

# Build application (if using TypeScript)
npm run build
```

### 2. Nginx Configuration

```nginx
# /etc/nginx/sites-available/community-savings

upstream backend {
    server 127.0.0.1:5000;
    keepalive 64;
}

server {
    listen 80;
    server_name api.your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location / {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check endpoint
    location /healthz {
        proxy_pass http://backend;
        access_log off;
    }
}
```

### 3. PM2 Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'community-savings-api',
      script: './server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
    },
  ],
};
```

### 4. Start Backend

```bash
# Setup PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
pm2 logs

# Enable Nginx
sudo ln -s /etc/nginx/sites-available/community-savings /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## Frontend Deployment

### Option 1: Vercel (Recommended for React)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod

# Configure environment variables in Vercel dashboard
REACT_APP_API_URL=https://api.your-domain.com
```

### Option 2: AWS S3 + CloudFront

```bash
# Build React app
npm run build

# Deploy to S3
aws s3 sync build/ s3://your-bucket-name --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id XXXXX --paths "/*"
```

### Option 3: Netlify

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod --dir=build
```

### Frontend Environment Configuration

Create `.env.production`:

```env
REACT_APP_API_URL=https://api.your-domain.com
REACT_APP_ENV=production
```

---

## Mobile Money Configuration

### MTN Mobile Money Production Setup

1. **Switch from Sandbox to Production**

   ```env
   MTN_MOMO_BASE_URL=https://api.mtn.cm/mocserver/3.0.0
   MTN_TARGET_ENV=production
   ```

2. **Update Credentials**
   - Get production API key from MTN
   - Update MTN_MOMO_API_KEY
   - Update MTN_MOMO_PRIMARY_KEY

3. **Test Production**
   ```bash
   # Test with real phone numbers
   # Verify transactions in MTN dashboard
   ```

### Airtel Money Production Setup

1. **Switch URLs**

   ```env
   AIRTEL_MONEY_BASE_URL=https://openapi.airtel.africa/merchant/v1
   ```

2. **Update Credentials**
   - Production Client ID
   - Production Client Secret
   - Verify Business Code

3. **Enable Features**
   - Request production access
   - Configure settlement accounts
   - Test transactions

### Payment Processing Best Practices

```javascript
// Queue payment processing for reliability
const paymentQueue = new Queue('payments', {
  redis: { host: 'localhost', port: 6379 },
});

// Retry failed payments
paymentQueue.process(async (job) => {
  const { transactionId } = job.data;

  // Retry with exponential backoff
  try {
    await processPayment(transactionId);
  } catch (error) {
    if (job.attemptsMade < job.opts.attempts) {
      throw error; // Retry
    }
    // Log failure after all retries
    await Payment.findOneAndUpdate({ transactionId }, { status: 'FAILED', error: error.message });
  }
});
```

---

## Security Hardening

### 1. Secrets Management

```bash
# Use AWS Secrets Manager or similar
aws secretsmanager create-secret \
  --name community-savings/prod \
  --secret-string file://secrets.json
```

### 2. Database Security

```javascript
// Enable MongoDB encryption at rest
// Configure IP whitelist
// Implement field-level encryption for sensitive data

const encryptedSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    encrypt: true, // Requires mongoose-field-encryption
  },
  // ... other fields
});
```

### 3. API Security

```javascript
// Implement rate limiting per user
const userLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rate-limit:',
  }),
  keyGenerator: (req) => req.user._id, // Per user
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // requests per window
});

app.use('/api/', userLimiter);
```

### 4. JWT Security

```javascript
// Use short-lived access tokens
ACCESS_TOKEN_EXP = '15m';

// Long-lived refresh tokens stored securely in httpOnly cookies
REFRESH_TOKEN_DAYS = 30;
COOKIE_SECURE = true;
COOKIE_HTTP_ONLY = true;
COOKIE_SAME_SITE = 'Strict';
```

### 5. CORS Configuration

```javascript
const corsOptions = {
  origin: ['https://app.your-domain.com', 'https://www.your-domain.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
```

---

## Monitoring & Logging

### Application Monitoring

```javascript
// New Relic integration
require('newrelic');

// Sentry error tracking
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());
```

### Logging Strategy

```javascript
// Structured logging
logger.info('Payment processed', {
  transactionId: txn.id,
  amount: txn.amount,
  provider: txn.provider,
  duration: Date.now() - start,
  userId: req.user._id,
});

// Log levels
logger.error('Critical error:', { error, context });
logger.warn('Warning condition:', { warning, context });
logger.info('Info message:', { message, context });
logger.debug('Debug info:', { debug, context });
```

### Alerts Configuration

```javascript
// Alert on critical issues
alertManager.onError({
  rule: 'payment_failure_rate > 5%',
  severity: 'critical',
  notification: ['slack', 'email', 'sms'],
});

alertManager.onError({
  rule: 'api_response_time > 2000ms',
  severity: 'warning',
  notification: ['slack', 'email'],
});
```

---

## Backup & Recovery

### Database Backups

```bash
# MongoDB Atlas automatic backups
# Enable continuous backups with 7-day retention

# Manual backup
mongodump --uri="mongodb+srv://user:pass@cluster.mongodb.net/community_savings" \
  --out=/backup/$(date +%Y%m%d)

# Automated backup script
0 2 * * * /usr/local/bin/backup-mongodb.sh >> /var/log/backups.log 2>&1
```

### Disaster Recovery Plan

1. **RTO (Recovery Time Objective)**: 1 hour
2. **RPO (Recovery Point Objective)**: 15 minutes

```bash
# Restore from backup
mongorestore --uri="mongodb+srv://..." /path/to/backup

# Verify data integrity
db.adminCommand({replSetGetStatus: 1})
```

---

## Performance Optimization

### Caching Strategy

```javascript
// Redis caching
const redis = require('redis');
const client = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
});

// Cache frequently accessed data
app.get('/api/groups/:id', async (req, res) => {
  const cacheKey = `group:${req.params.id}`;

  // Check cache
  const cached = await client.get(cacheKey);
  if (cached) return res.json(JSON.parse(cached));

  // Get from DB
  const group = await Group.findById(req.params.id);

  // Cache for 1 hour
  await client.setex(cacheKey, 3600, JSON.stringify(group));

  res.json(group);
});
```

### Query Optimization

```javascript
// Use indexes
userSchema.index({ email: 1 });
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });

// Optimize queries
const user = await User.findById(id)
  .select('name email role') // Only needed fields
  .lean(); // Don't track changes

// Use aggregation for complex queries
const stats = await Payment.aggregate([
  { $match: { status: 'COMPLETED' } },
  { $group: { _id: '$provider', total: { $sum: '$amount' } } },
]);
```

### Frontend Optimization

```javascript
// Code splitting
const Dashboard = React.lazy(() => import('./pages/Dashboard'));

// Image optimization
<img src="image.webp" alt="..." loading="lazy" />;

// Service worker for offline support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
```

---

## Troubleshooting

### Common Issues

| Issue            | Cause                 | Solution                                 |
| ---------------- | --------------------- | ---------------------------------------- |
| High API latency | Slow database queries | Optimize indexes, use caching            |
| Payment failures | Provider connectivity | Implement retry logic, check credentials |
| 502 Bad Gateway  | Backend down          | Check PM2, review logs, restart service  |
| Memory leaks     | Unclosed connections  | Review code, update dependencies         |
| CORS errors      | Origin mismatch       | Update CORS_ORIGINS, check domain        |

### Debug Commands

```bash
# Check backend status
pm2 logs community-savings-api

# Check Nginx
sudo nginx -t
sudo systemctl status nginx

# Check database connection
mongosh "mongodb+srv://user:pass@cluster.mongodb.net/community_savings"

# Check payment queue
redis-cli
> LLEN "payments:pending"

# Monitor system resources
top
df -h
```

---

## Post-Deployment Verification

```bash
# Health checks
curl https://api.your-domain.com/healthz
curl https://api.your-domain.com/readyz

# API functionality
curl -X POST https://api.your-domain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test@123"}'

# Payment processing
# Test with sandbox credentials
```

---

## Maintenance Schedule

- **Daily**: Monitor logs, check alerts
- **Weekly**: Review performance metrics, user feedback
- **Monthly**: Security audit, dependency updates
- **Quarterly**: Database optimization, capacity planning
- **Annually**: Disaster recovery drill, security assessment

---

## Support & Resources

- [Community Savings Documentation](./README.md)
- [Mobile Money Integration](./MOBILE_MONEY_INTEGRATION.md)
- [Security Best Practices](./SECURITY.md)
- [API Documentation](./API_DOCUMENTATION.md)

---

**Last Updated**: February 2, 2026  
**Version**: 1.0.0
