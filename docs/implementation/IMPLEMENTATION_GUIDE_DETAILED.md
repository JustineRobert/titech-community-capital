# Implementation Guide — 10 Core Features

## Overview

This guide explains how to complete the implementation of 10 production-ready features for the Community Savings App backend. All skeleton files, models, services, and test stubs are provided; developers extend them with business logic.

---

## 1. Payment Processing

### Status: 70% (Models & Service Skeleton Complete)

### Remaining: Provider integrations, webhook handling, retry logic

**Files Created:**

- Models: `PaymentIntent.js`, `Transaction.js`
- Services: `PaymentService.js`, `mobileMoneyProvider.js`
- Routes: `routes/payments.js` (skeleton)

**What to Implement:**

1. **Provider Adapters** (in `services/payment/providers/`)
   - Implement `createIntent()`, `verifyWebhook()`, `parseEvent()` for each provider (Stripe, MPesa, etc.)
   - Each adapter returns normalized event format

2. **Webhook Handler** in PaymentService
   - Verify provider signature (HMAC or provider-specific)
   - Parse event, update PaymentIntent status
   - Record Transaction atomically
   - Emit events for notifications

3. **Retry Logic**
   - Use Bull job queue (`paymentRetryQueue` in `jobs/queueSetup.js`)
   - Exponential backoff: 1s, 2s, 4s... (max 3 retries)
   - Reconciliation cron job for provider→DB sync

4. **Controller**
   - POST /api/payments/intents: create intent with idempotency check
   - POST /api/payments/webhook/:provider: receive & process webhooks
   - GET /api/payments/:id: fetch intent status
   - POST /api/payments/:id/retry: admin manual retry

**Testing:**

- Unit: PaymentService.createPaymentIntent() with mocked adapter
- Integration: webhook → PaymentIntent update → Transaction creation
- Mock external HTTP responses using `nock`

**Security Checklist:**

- Verify webhook signatures before processing
- No PII in logs (mask amounts to K.KK format)
- Idempotency key validation
- Rate limit webhook endpoints
- HTTPS + TLS only

---

## 2. Email Verification

### Status: 90% (Service Complete, Routes Need Registration)

### Remaining: Route middleware, throttling, email templates

**Files Created:**

- Model: `EmailVerificationToken.js`
- Service: `emailVerificationService.js` (complete)
- Routes: `routes/auth.js` (includes email verification endpoints)

**What to Implement:**

1. **Route Registration** in `server.js`

   ```js
   app.use('/api/auth', require('./routes/auth'));
   ```

2. **Email Template**
   - Create `templates/emailVerification.html` with token link
   - Text fallback in `templates/emailVerification.txt`
   - Use `EmailService.sendVerificationEmail()` (already called from service)

3. **Rate Limiting for Resend**
   - Use Redis token bucket in rateLimiter.js: max 3 resends/hour
   - Apply to POST /api/auth/resend-verification

4. **Middleware: requireVerified**
   - Apply to protected endpoints (payments, loans, etc.)
   - Check `user.verified === true`, return 403 if false

5. **On User Signup**
   - Create User with `verified: false`
   - Call `EmailVerificationService.generateTokenAndSend(user)`

**Testing:**

- Integration: signup → receive token → verify endpoint → user.verified = true
- Edge: expired token rejection, double-use prevention, resend throttling

---

## 3. Password Reset

### Status: 90% (Service Complete, Routes Need Registration)

### Remaining: Route middleware, password strength validation, email templates

**Files Created:**

- Model: `PasswordResetToken.js`
- Service: `passwordResetService.js` (complete)
- Routes: `routes/auth.js` (includes reset endpoints)

**What to Implement:**

1. **Password Strength Validation**
   - Extend in PasswordResetService.resetPassword()
   - Use library: `zxcvbn` scoring or OWASP rules
   - Minimum: 12 chars, mix of upper/lower/digits/symbols, no word matches

2. **Email Templates**
   - `templates/passwordReset.html` with reset link
   - Include expiry (1 hour) and security notice

3. **Token Invalidation**
   - After reset, set `used: true`
   - Optional: revoke all refresh tokens (`RefreshToken.deleteMany({user: userId})`)

4. **Audit Logging**
   - Log success and failed attempts
   - Track IP, timestamp, user

5. **Route Registration** in `server.js`
   ```js
   app.use('/api/auth', require('./routes/auth'));
   ```

**Testing:**

- Integration: request reset → email token → reset password → login with new password
- Edge: invalid token, expired token, weak password, token reuse

---

## 4. Loan Management Workflow

### Status: 60% (Models & Service Skeleton Complete)

### Remaining: Status guards, schedule generation, notifications, reconciliation

**Files Created:**

- Services: `loanWorkflowService.js` (status change + audit)
- Tests: `tests/integration/loan.workflow.test.js`

**What to Implement:**

1. **Status Transition Guards**
   - In `loanWorkflowService.changeLoanStatus()`, validate allowed transitions:
     - requested → [pending_approval, rejected]
     - pending_approval → [approved, rejected]
     - approved → [disbursed, rejected]
     - disbursed → [active]
     - active → [overdue, closed, defaulted]
     - overdue → [active, defaulted]

2. **Repayment Schedule Generation**
   - In `loanWorkflowService.generateRepaymentSchedule()`:
   - Use amortization formula: installment = P \* [r(1+r)^n] / [(1+r)^n - 1]
   - Generate installment array with dueDate, principal, interest
   - Example: 5000 KES, 12% annual, 12 months → 12 installments ~433 KES/month

3. **Overdue & Penalty Detection**
   - Daily cron (via `overdueLoanQueue` in `jobs/queueSetup.js`)
   - Query: `Loan.find({status: 'active', nextDueDate < now})`
   - Mark overdue, apply penalty (e.g., +2% per month)
   - Emit notification event

4. **Loan Closure**
   - When outstandingBalance === 0, mark `status: 'closed'`
   - Record final audit entry

5. **Notifications**
   - On approve/reject/overdue/default: emit event → queue notification
   - Use `notificationQueue` to email user

**Testing:**

- Integration: request → eligibility check → approve → disburse → active → repay → closed
- Edge: invalid transitions, overdue handling, default scenarios

---

## 5. Chat Functionality

### Status: 50% (Services & Models Complete, Socket.IO Setup Pending)

### Remaining: Socket.IO server integration, moderation hooks, logging

**Files Created:**

- Models: `Conversation.js`, `ChatMessage.js`
- Services: `chatService.js`
- Routes: `routes/chat.js` (REST queries)
- Socket setup: `middleware/socketIO.js` (skeleton)
- Tests: `tests/integration/chat.test.js`

**What to Implement:**

1. **Socket.IO Integration in server.js**

   ```js
   const http = require('http').createServer(app);
   const socketIO = require('./middleware/socketIO');
   const io = socketIO(http, logger);
   http.listen(5000);
   ```

2. **Socket Events** (in `socketIO.js`)
   - `message:send` → create ChatMessage, emit to all participants
   - `message:read` → update readBy array
   - `join:conversation` → add user to room
   - `typing` → broadcast typing indicator (optional)

3. **Moderation Hooks**
   - On `message:send`, call `moderationService.check(content)`
   - Flag or reject offensive/spam messages
   - Store `moderated: true` in ChatMessage if flagged

4. **Rate Limiting for Messages**
   - Per user: 30 messages/minute via token bucket
   - Return 429 if exceeded

5. **Read Receipts**
   - On `message:read`, update `ChatMessage.readBy` array
   - Broadcast to conversation participants

6. **Message History REST API**
   - GET /api/chats/conversations/:id/messages (paginated, supports `before` cursor)

**Testing:**

- Integration: socket connects → join conversation → send message → broadcast
- Edge: rate limiting, moderation, read receipts, offline handling

---

## 6. Referral System

### Status: 90% (Service Complete)

### Remaining: Reward payout hooks, fraud detection rules, admin endpoints

**Files Created:**

- Model: `Referral.js`
- Service: `referralService.js`
- Tests: `tests/integration/referrals.test.js`

**What to Implement:**

1. **Unique Code Generation**
   - Extend `referralService.generateCode()` with collision detection
   - Return 8-char alphanumeric unique to referrer

2. **Redemption Flow**
   - User clicks referral link with code → redemption page
   - POST /api/referrals/redeem {code}
   - Call `referralService.redeemCode(code, userId)`
   - Link user to referrer

3. **Fraud Prevention**
   - IP reputation check (reject if heavily abused)
   - Email domain whitelist (e.g., block free email farms)
   - Temporal limits: max N redemptions per IP per day
   - Self-referral check (already implemented)

4. **Reward Payout**
   - Define reward rules in config/referralConfig.js (e.g., 5% of user contribution)
   - On user contribution milestone, trigger payout to referrer
   - Record in Transaction ledger with `source: 'referral_reward'`

5. **Analytics Endpoints** (in `routes/referrals.js`)
   - GET /api/referrals/analytics → top referrers, conversion rate, reward totals
   - Aggregation via `referralService`

**Testing:**

- Unit: code generation uniqueness, self-referral prevention
- Integration: redeem → user linked → reward on contribution
- Edge: fraud patterns, double redemption attempts

---

## 7. Database Migrations

### Status: 90% (Runner & Sample Migration Complete)

### Remaining: Index creation migrationss, rollback testing

**Files Created:**

- Script: `scripts/migrateRunner.js`
- Model: `Migration.js` (already exists)
- Sample: `migrations/20260303_000000_sample_migration.js`
- Index migration: `migrations/20260303_100000_add_payment_chat_auth_collections.js`

**What to Implement:**

1. **Run Migrations**

   ```bash
   npm run migrate
   # or
   node scripts/migrateRunner.js
   ```

2. **Create Index Migrations**
   - File: `migrations/20260304_*.js`
   - Pattern: define up() with index creation, down() with drop
   - Example:

   ```js
   module.exports = {
     up: async ({ mongoose }) => {
       await Loan.collection.createIndex({ user: 1, createdAt: -1 });
     },
     down: async ({ mongoose }) => {
       await Loan.collection.dropIndex('user_1_createdAt_-1');
     },
   };
   ```

3. **Rollback Testing**
   - Run migration, verify indexes created
   - Roll back: `npm run migrate:down <name>`
   - Verify indexes dropped

4. **Safe Schema Evolution**
   - Always make migrations backward-compatible
   - Add field with default: `{newField: {default: null}}`
   - Use conditional logic to handle both old/new schema

**CLI Commands:**

```bash
npm run migrate          # Apply pending migrations
npm run migrate:down     # Rollback last migration
npm run migrate:list     # List all migrations
npm run migrate:status   # Show applied migrations
npm run migrate:verify   # Verify integrity
```

---

## 8. Unit & Integration Tests

### Status: 70% (Stubs & Framework Complete)

### Remaining: Test implementations, mocks, CI configuration

**Files Created:**

- Test stubs: `tests/unit/payment.service.test.js`, `tests/unit/auth.service.test.js`
- Integration tests: `auth.verification.test.js`, `chat.test.js`, `referrals.test.js`, `loan.workflow.test.js`
- Configuration: `jest.config.js` (with thresholds)

**What to Implement:**

1. **Run Tests**

   ```bash
   npm test               # All tests
   npm run test:unit      # Unit only
   npm run test:integration # Integration only
   npm run test:coverage  # With coverage report
   npm run test:ci        # CI mode: strict, coverage enforced
   ```

2. **Test Database**
   - Use `mongodb-memory-server` for fast in-memory tests
   - Or use separate test MongoDB instance
   - Set `MONGODB_URI=mongodb://localhost/community-savings-test` in `.env.test`

3. **Mock External Services**
   - Email: mock `EmailService.send()` with Jest mock
   - Payments: mock provider adapters with `nock` (HTTP stubs)
   - Redis: mock with `redis-mock` library
   - Socket.IO: use `@vue/test-utils` or custom test client

4. **Coverage Thresholds**
   - Global: 80% lines, 70% branches
   - Services (payments, auth): 95%+ lines, 90%+ branches
   - Enforce in CI: fail build if below threshold

5. **CI Configuration** (`.github/workflows/test.yml` or equivalent)
   ```yaml
   - npm run lint
   - npm run test:ci
   - Upload coverage to Codecov
   ```

**Key Test Patterns:**

- Setup: create fixtures (users, loans, etc.)
- Action: call function/endpoint
- Assert: verify state change + side effects
- Teardown: clean DB

---

## 9. API Rate Limiting (Per-User)

### Status: 90% (Token Bucket Implementation Complete)

### Remaining: Middleware registration, per-endpoint limits, Redis integration

**Files Created:**

- Utility: `utils/rateLimiter.js` (TokenBucketLimiter class)
- Middleware: `middleware/rateLimitMiddleware.js`

**What to Implement:**

1. **Register Rate Limit Middleware** in `server.js`

   ```js
   const redisClient = require('redis').createClient();
   const createRateLimitMW = require('./middleware/rateLimitMiddleware');
   const rl = createRateLimitMW(redisClient, { tokens: 100, refillIntervalSec: 60 });
   app.use(rl);
   ```

2. **Per-Endpoint Limits** (stricter limits for expensive operations)

   ```js
   // In routes
   const strictRL = createRateLimitMW(redis, { tokens: 10, refillIntervalSec: 60 });
   router.post('/loans/request', strictRL, controller.requestLoan);
   router.post('/payments/intents', strictRL, controller.createPaymentIntent);
   ```

3. **Redis Integration**
   - TokenBucketLimiter currently stores in Redis
   - Verify `redis.get()` and `redis.setex()` work with provided client

4. **HTTP Response Headers**
   - `X-RateLimit-Remaining-User: <count>`
   - `X-RateLimit-Remaining-IP: <count>`
   - Response 429 with `Retry-After: <seconds>`

5. **Testing**
   ```js
   test('Rate limit exceeded returns 429', async () => {
     for (let i = 0; i < 11; i++) {
       const res = await request(app).get('/api/loans');
       if (i < 10) expect(res.status).toBe(200);
       else expect(res.status).toBe(429);
     }
   });
   ```

---

## 10. Analytics & Metrics

### Status: 80% (Service & Routes Complete)

### Remaining: Event hook integration, custom aggregations, dashboard UI

**Files Created:**

- Service: `analyticsService.js` (EventEmitter + aggregation methods)
- Routes: `routes/analytics.js` (admin endpoints)
- Jobs: `jobs/queueSetup.js` (background processors)

**What to Implement:**

1. **Event Tracking** Integration

   ```js
   // In controllers, after successful operation:
   const AnalyticsService = require('../services/analyticsService');
   AnalyticsService.trackEvent('loan.requested', req.user.id, { loanId });
   AnalyticsService.trackEvent('payment.succeeded', userId, { amount, provider });
   AnalyticsService.trackEvent('referral.redeemed', referrerId, { referredUser });
   ```

2. **Event Types to Track**
   - `user.signup`, `user.verified`, `user.login`
   - `loan.requested`, `loan.approved`, `loan.disbursed`, `loan.repaid`, `loan.defaulted`
   - `payment.succeeded`, `payment.failed`, `payment.refunded`
   - `referral.generated`, `referral.redeemed`
   - `chat.message_sent`

3. **Custom Aggregations**
   - Add methods to AnalyticsService for domain-specific reports:
     ```js
     async getLoanDefaultRate(days) {...}
     async getPaymentCollectionTrend(interval) {...}
     async getTopReferrers(limit) {...}
     ```

4. **Admin Dashboard Endpoints** (in `routes/analytics.js`)
   - Already implemented: `/admin/analytics/payments`, `/users`, `/loans`, `/referrals`, `/dashboard`
   - Register in `server.js`: `app.use('/api/admin', require('./routes/analytics'));`

5. **Cron Aggregation** (optional)
   - Daily job: pre-aggregate events into summary collection
   - Improves dashboard response time (millions of events → daily rollups)
   - Use Bull's scheduled jobs

6. **Privacy**
   - Analytics logs hashed user IDs (never raw emails/phones)
   - Exclude PII from event data
   - Sanitize any user-supplied fields in events

---

## Integration & Deployment Checklist

### 1. Hook Everything Together in `server.js`

```js
const express = require('express');
const http = require('http');
const app = express();
const logger = require('./middleware/logging');

// Redis setup
const redis = require('redis').createClient(process.env.REDIS_URL);

// Socket.IO
const socketIO = require('./middleware/socketIO');
const io = socketIO(http.createServer(app), logger);

// Payment service setup
const PaymentService = require('./services/payment/PaymentService');
const mobileMoneyProvider = require('./services/payment/providers/mobileMoneyProvider');
const paymentService = new PaymentService({ providers: { mobileMoney: mobileMoneyProvider } });
app.locals.paymentService = paymentService;

// Rate limiting
const createRateLimitMW = require('./middleware/rateLimitMiddleware');
app.use(createRateLimitMW(redis));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/chats', require('./routes/chat'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/admin/analytics', require('./routes/analytics'));

// Start
const server = http.createServer(app);
server.listen(process.env.PORT || 5000);
```

### 2. Environment Variables (.env.example)

```
MONGODB_URI=mongodb://localhost/community-savings
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
FRONTEND_URL=http://localhost:3000
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
EMAIL_FROM=noreply@communitysavings.com
NODEMAILER_USER=...
NODEMAILER_PASS=...
MPESA_API_KEY=...
MPESA_WEBHOOK_SECRET=...
```

### 3. Pre-Deployment

```bash
npm ci                           # Install dependencies
npm run migrate                  # Run migrations
npm run test:ci                  # Run full test suite
npm run lint                     # Linting
```

### 4. Production Deployment

```bash
# Build/optimize
npm run build

# Start worker processes
pm2 start server.js -i max
pm2 start jobs/worker.js  # Queue worker process

# Verify health
curl http://localhost:5000/api/health
curl http://localhost:5000/api/admin/analytics/dashboard
```

---

## File Checklist

✅ Models created:

- PaymentIntent.js
- Transaction.js
- EmailVerificationToken.js
- PasswordResetToken.js
- Conversation.js
- ChatMessage.js
- Referral.js
- Migration.js

✅ Services created:

- PaymentService.js (+ mobileMoneyProvider.js)
- emailVerificationService.js
- passwordResetService.js
- chatService.js
- referralService.js
- loanWorkflowService.js
- analyticsService.js

✅ Middleware created:

- socketIO.js
- rateLimitMiddleware.js

✅ Routes created:

- payments.js (skeleton)
- auth.js (with email verification + password reset)
- chat.js (skeleton)
- referrals.js (skeleton)
- analytics.js (complete)

✅ Utilities created:

- rateLimiter.js (TokenBucketLimiter)
- CRUDHelper.js

✅ Jobs created:

- queueSetup.js (Bull queue processors)

✅ Migrations created:

- 20260303_000000_sample_migration.js
- 20260303_100000_add_payment_chat_auth_collections.js

✅ Tests created:

- tests/integration/auth.verification.test.js
- tests/integration/chat.test.js
- tests/integration/referrals.test.js
- tests/integration/loan.workflow.test.js
- tests/unit/payment.service.test.js

✅ Config updated:

- package.json (added socket.io, redis, bull, rate-limiter-flexible)
- jest.config.js (coverage thresholds)

---

## Next Steps

1. **Implement Provider Adapters** for payments (Stripe, MPesa, Airtel)
2. **Email Service Integration** with Nodemailer templates
3. **Socket.IO Server** in main server.js
4. **Run Migrations** for new collections
5. **Write Integration Test Mocks** with `nock` and Jest
6. **Deploy to Staging** and verify end-to-end flows
7. **Load Testing** with Artillery or K6
8. **Security Audit** (penetration test, OWASP checklist)

---

End of Implementation Guide
