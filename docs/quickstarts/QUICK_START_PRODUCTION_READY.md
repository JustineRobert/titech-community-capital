# Production-Ready Implementation - Quick Start Guide

## Installation & Setup

### 1. Install Dependencies

```bash
# Install root dependencies
npm install

# Install backend dependencies
npm --prefix community-savings-app-backend install

# Install frontend dependencies
npm --prefix community-savings-app-frontend install
```

### 2. Environment Configuration

Create `.env` file in `community-savings-app-backend/`:

```env
# Server
NODE_ENV=production
PORT=5000

# Database
MONGO_URI=mongodb://localhost:27017/community-savings-prod
MONGO_TEST_URI=mongodb://localhost:27017/community-savings-test

# JWT
JWT_SECRET=your_very_secure_secret_key_change_this_in_production
ACCESS_TOKEN_EXP=15m
REFRESH_TOKEN_DAYS=30

# Email (Gmail example)
EMAIL_PROVIDER=gmail
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
EMAIL_FROM=noreply@communitysavings.com

# Redis
REDIS_URL=redis://localhost:6379

# Frontend
FRONTEND_URL=http://localhost:3000

# Referral System
REFERRAL_BONUS_REFERRER=500
REFERRAL_BONUS_REFEREE=250
```

### 3. Database Setup

```bash
# Start MongoDB (if using Docker)
docker run -d \
  --name mongodb \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=password \
  -p 27017:27017 \
  mongo:latest

# Run migrations
npm --prefix community-savings-app-backend run migrate
```

### 4. Redis Setup

```bash
# Start Redis (if using Docker)
docker run -d \
  --name redis \
  -p 6379:6379 \
  redis:latest
```

---

## Running the Application

### Development Mode

```bash
# Run both frontend and backend concurrently
npm start

# Or run separately in different terminals:
# Terminal 1: Backend
npm run backend

# Terminal 2: Frontend
npm run frontend
```

### Production Mode

```bash
# Build frontend
npm run build

# Start backend
npm --prefix community-savings-app-backend start
```

---

## Testing All Features

### Run All Tests

```bash
# Run complete test suite with coverage
npm run test:ci

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run tests in watch mode (development)
npm run test:watch
```

### Test Coverage Report

After running tests:

```bash
open coverage/lcov-report/index.html  # Open coverage report in browser
```

Target coverage:

- Statements: > 80%
- Branches: > 75%
- Functions: > 80%
- Lines: > 80%

---

## Feature Testing Checklist

### ✅ Payment Processing

```bash
# POST /api/payments/initiate
curl -X POST http://localhost:5000/api/payments/initiate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": "group_id_here",
    "amount": 1000,
    "currency": "KES",
    "method": "mobile_money",
    "type": "contribution",
    "description": "Group contribution"
  }'

# GET /api/payments/:paymentId
curl -X GET http://localhost:5000/api/payments/payment_id_here \
  -H "Authorization: Bearer YOUR_TOKEN"

# GET /api/payments/history
curl -X GET "http://localhost:5000/api/payments/history?page=1&limit=20&status=completed" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### ✅ Email Verification

```bash
# POST /api/email/send-verification
curl -X POST http://localhost:5000/api/email/send-verification \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"

# POST /api/email/verify
curl -X POST http://localhost:5000/api/email/verify \
  -H "Content-Type: application/json" \
  -d '{"token": "token_from_email"}'

# POST /api/email/resend-verification
curl -X POST http://localhost:5000/api/email/resend-verification \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### ✅ Password Reset

```bash
# POST /api/email/send-password-reset
curl -X POST http://localhost:5000/api/email/send-password-reset \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'

# POST /api/email/reset-password
curl -X POST http://localhost:5000/api/email/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "reset_token_from_email",
    "newPassword": "NewSecurePassword123!@#"
  }'
```

### ✅ Loan Management

```bash
# POST /api/loans/apply
curl -X POST http://localhost:5000/api/loans/apply \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": "group_id_here",
    "amount": 10000,
    "term": 12,
    "purpose": "business",
    "description": "Loan for business expansion"
  }'

# GET /api/loans/:loanId
curl -X GET http://localhost:5000/api/loans/loan_id_here \
  -H "Authorization: Bearer YOUR_TOKEN"

# GET /api/loans/:loanId/schedule
curl -X GET http://localhost:5000/api/loans/loan_id_here/schedule \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### ✅ Chat Functionality

```bash
# Create conversation
curl -X POST http://localhost:5000/api/chat/conversations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "participants": ["user_id_1", "user_id_2"],
    "type": "dm"
  }'

# Send message
curl -X POST http://localhost:5000/api/chat/messages \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "conversation_id_here",
    "content": "Hello, how are you?"
  }'

# WebSocket connection for real-time messages
# Client JavaScript example:
# const socket = io('http://localhost:5000');
# socket.emit('send_message', { conversationId, content, sender });
# socket.on('receive_message', (message) => { /* handle */ });
```

### ✅ Referral System

```bash
# Generate referral code
curl -X POST http://localhost:5000/api/referrals/generate-code \
  -H "Authorization: Bearer YOUR_TOKEN"

# Redeem referral code
curl -X POST http://localhost:5000/api/referrals/redeem \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code": "ABC123DEF"}'

# Get referral statistics
curl -X GET http://localhost:5000/api/referrals/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### ✅ API Rate Limiting

Test rate limiting (should get 429 after limit):

```bash
# Repeated requests to trigger rate limit
for i in {1..6}; do
  curl -X POST http://localhost:5000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email": "test@example.com", "password": "password"}'
  echo "\nRequest $i"
done

# Response with 429 Too Many Requests:
# {
#   "error": "Rate limit exceeded",
#   "retryAfter": 45,
#   "limitType": "user"
# }
```

### ✅ Analytics

```bash
# Get payment metrics
curl -X GET "http://localhost:5000/api/analytics/payments?from=2024-03-01&to=2024-03-10" \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Get user metrics
curl -X GET "http://localhost:5000/api/analytics/users?days=30" \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Get loan metrics
curl -X GET http://localhost:5000/api/analytics/loans \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Get dashboard
curl -X GET http://localhost:5000/api/analytics/dashboard \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Get referral metrics
curl -X GET http://localhost:5000/api/analytics/referrals \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

---

## Database Migrations

### Run Migrations

```bash
# Run pending migrations
npm --prefix community-savings-app-backend run migrate

# Check migration status
npm --prefix community-savings-app-backend run migrate:status

# List all migrations
npm --prefix community-savings-app-backend run migrate:list

# Rollback migrations
npm --prefix community-savings-app-backend run migrate:down

# Verify migrations
npm --prefix community-savings-app-backend run migrate:verify
```

---

## Docker Deployment

### Build Docker Image

```bash
# Build backend image
docker build -t community-savings-backend:latest ./community-savings-app-backend

# Build frontend image
docker build -t community-savings-frontend:latest ./community-savings-app-frontend
```

### Run with Docker Compose

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f backend

# Stop services
docker-compose down
```

---

## Monitoring & Debugging

### View Logs

```bash
# Backend logs
tail -f community-savings-app-backend/logs/application.log

# Watch logs in real-time
pm2 logs
```

### Health Check

```bash
# Check API health
curl http://localhost:5000/api/health

# Check database connection
curl http://localhost:5000/api/health/db

# Check Redis connection
curl http://localhost:5000/api/health/redis
```

### Performance Metrics

Access Prometheus metrics:

```
http://localhost:5000/metrics
```

View in Grafana dashboard (if configured):

```
http://localhost:3001
```

---

## Production Deployment Checklist

- [ ] All environment variables configured
- [ ] MongoDB replicated and backed up
- [ ] Redis configured with persistence
- [ ] SSL/TLS certificates installed
- [ ] Rate limiting tested and configured
- [ ] Email service configured
- [ ] Payment provider API keys configured
- [ ] Logging and monitoring set up
- [ ] All tests passing (npm run test:ci)
- [ ] Database migrations verified
- [ ] Backups scheduled
- [ ] Monitoring and alerting configured
- [ ] Documentation updated
- [ ] Security audit completed

---

## Troubleshooting

### MongoDB Connection Error

```bash
# Check MongoDB is running
mongo --version

# Restart MongoDB
docker restart mongodb

# Check connection string in .env
echo $MONGO_URI
```

### Redis Connection Error

```bash
# Check Redis is running
redis-cli ping

# Restart Redis
docker restart redis

# Test connection
redis-cli -u $REDIS_URL ping
```

### Rate Limiting Not Working

- Check Redis connection
- Verify rate limit middleware is applied to routes
- Check rate limit configuration in environment

### Email Not Sending

- Check email configuration in .env
- Verify email service credentials
- Check logs for SMTP errors
- Test with `npm run test:unit -- emailService`

### Payment Processing Issues

- Check payment provider configuration
- Verify payment credentials
- Check transaction logs
- Review payment service test results

---

## API Documentation

Full API documentation available at:

```
http://localhost:5000/api/docs
```

Or in:

- `API_DOCUMENTATION.md`
- `API_REFERENCE_QUICK_START.md`

---

## Support & Issues

For issues or questions:

1. Check logs in `community-savings-app-backend/logs/`
2. Review test results: `npm run test:coverage`
3. Check documentation in root directory
4. Open GitHub issue with logs and error details

---

**Last Updated**: March 10, 2026
**Status**: ✅ PRODUCTION READY
By Igune Justine Robert, TITech Africa, +256782397907
