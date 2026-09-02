Feature Implementation Plan — Community Savings App
Date: 2026-03-02
Author: Development Team

## Purpose

This document analyses, designs and provides implementation-ready guidance (schemas, endpoints, controllers, services, middleware, tests, security, and deployment notes) to implement the 10 feature groups requested by the product team. The file is intended to be directly actionable and used as a blueprint for development.

## Scope & Assumptions

- Existing backend uses Node.js + Express + Mongoose (MongoDB). Continue same stack.
- JWT-based auth already exists; continue using that for socket auth and APIs.
- Use Redis for caches, rate limiting, token blacklists, and token-bucket implementations when available.
- External payment providers supported: Mobile Money (MPesa-like) and card processors (Stripe-compatible interface). Implement PaymentService abstraction so providers can be plugged in.
- Production-grade concerns (idempotency, retries, webhooks, signed requests, logging) are required for payments and email flows.

## Plan (High-level)

Each feature below has:

- architecture overview
- data models (Mongoose schema snippets)
- API contract (routes + payloads)
- controller/service/middleware responsibilities
- key code snippets (production-ready patterns)
- testing strategy
- security considerations
- deployment & scaling notes

1. Payment Processing

---

Architecture

- `PaymentService` interface with provider adapters: `MobileMoneyProvider`, `CardProvider`.
- Payment intents created on request: reserved intent record in DB with idempotency key.
- Use queue (BullMQ) for retries and background verification.
- Webhook receiver endpoint with signature verification.
- Transaction ledger collection for immutable audit.

Data Models

- `PaymentIntent`:
  - \_id (ObjectId)
  - intentId (string) // provider id
  - user (ObjectId)
  - amount (number, cents)
  - currency (string)
  - status (enum: pending, processing, succeeded, failed, canceled)
  - provider (string)
  - metadata (object)
  - idempotencyKey (string)
  - attempts (number)
  - createdAt, updatedAt

- `Transaction`:
  - \_id, user, amount, currency, type (credit/debit), reference (string), source (payment_intent|refund), status, metadata, createdAt

- `PaymentWebhookLog` for raw webhook payloads and verification result

API Endpoints

- POST /api/payments/intents
  - Body: { amount, currency, paymentMethodType (mobile_money|card), metadata, idempotencyKey }
  - Response: { paymentIntentId, clientData }
- POST /api/payments/webhook/:provider
  - Raw webhook receiver (signature verification)
- GET /api/payments/:id
  - Fetch intent / status
- POST /api/payments/:id/retry
  - Admin-triggered retry

Key Service Responsibilities

- `createPaymentIntent(user, amount, currency, provider, metadata, idempotencyKey)`
  - dedupe by idempotencyKey
  - create DB PaymentIntent (status pending)
  - call provider adapter to create provider intent
  - persist provider id in DB
- `handleWebhook(provider, payload, headers)`
  - verify signature
  - map provider status -> application status
  - record Transaction and update PaymentIntent atomically
  - emit events (payment.succeeded, payment.failed)
- `retryPayment(intentId)`
  - ensure idempotency
  - schedule through queue

Key Code Snippet: PaymentService skeleton

```js
// services/payment/PaymentService.js
class PaymentService {
  constructor({ providers, queue, logger }) {
    this.providers = providers; // {stripe, mobileMoney}
    this.queue = queue; // Bull queue for retries
    this.logger = logger;
  }

  async createPaymentIntent({
    userId,
    amount,
    currency = 'KES',
    provider = 'mobileMoney',
    metadata = {},
    idempotencyKey,
  }) {
    // dedupe
    const existing = await PaymentIntent.findOne({ idempotencyKey });
    if (existing) return existing;
    const pi = await PaymentIntent.create({
      user: userId,
      amount,
      currency,
      status: 'pending',
      provider,
      metadata,
      idempotencyKey,
    });
    const adapter = this.providers[provider];
    const providerResult = await adapter.createIntent({
      amount,
      currency,
      metadata,
      idempotencyKey,
    });
    pi.intentId = providerResult.id;
    pi.clientData = providerResult.clientData;
    await pi.save();
    return pi;
  }

  async handleProviderWebhook(providerName, payload, headers) {
    const adapter = this.providers[providerName];
    const verified = adapter.verifyWebhook(payload, headers);
    if (!verified) throw new Error('Invalid webhook signature');
    const evt = adapter.parseEvent(payload);
    // map and process
    await processEvent(evt);
  }
}
module.exports = PaymentService;
```

Webhook signature verification

- Each provider has its signing secret. Verify HMAC or provider-specific signature header. Log failures.

Idempotency

- Idempotency keys stored in `PaymentIntent.idempotencyKey`.
- Provider adapters accept idempotency keys when creating intents (Stripe supports this). For mobile money, store locally and block duplicates.

Failure recovery

- All intent status transitions recorded in PaymentIntentAudit.
- Use queue with exponential backoff for retries.
- In case of partial failure (provider succeeded but DB update failed), run reconciliation cron job to query provider intent statuses and reconcile.

Testing

- Unit tests for adapters with mocked provider HTTP responses.
- Integration tests using local HTTP server to simulate webhooks and Redis-backed queue.
- Test idempotency with repeated same idempotencyKey.

Security

- Validate amounts, currencies.
- Do not log full card numbers or sensitive PII; only store masked info.
- Secure webhook endpoints with signature verification and IP allow-list optionally.
- Use TLS and require strong secrets stored in vault.

Scaling & Deployment

- Run worker processes for queue separately.
- Use Redis for queue and idempotency caches.
- Use provider rate limits handling.

2. Email Verification

---

Overview

- Token-based verification stored hashed in DB with expiry. Send email with link including token.
- Resend endpoint with throttle per user/IP.
- Middleware to block unverified users from protected routes.

Schema additions

- `User.verified` (boolean)
- `EmailVerificationToken` collection:
  - user, tokenHash, expiresAt, createdAt, used (boolean), requestIp

API Endpoints

- POST /api/auth/verify-email (query token) // token sent as query
- POST /api/auth/resend-verification { email } -> rate-limited

Controller Flow

- When signing up, create EmailVerificationToken (random token), hash token using `crypto.createHash('sha256')`, set expiry (24h), send email with link: https://app/verify?token=<raw-token>&id=<userId>
- On verify endpoint, hash token from query and find record; if found and not expired, set `user.verified = true`, mark token used, log audit.

Key Snippet: Token creation & email

```js
const token = crypto.randomBytes(32).toString('hex');
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
await EmailVerificationToken.create({
  user: userId,
  tokenHash,
  expiresAt: Date.now() + 24 * 3600 * 1000,
});
await EmailService.sendVerificationEmail(user.email, {
  name: user.name,
  link: `${FRONTEND_URL}/verify-email?token=${token}&id=${userId}`,
});
```

Resend throttling

- Use Redis to store resend counters per `userId` and per IP; limit to N per hour (e.g., 3/hour).

Middleware

- `requireVerified` checks `req.user.verified` and returns 403 if false. Use on payment endpoints and loan request endpoints.

Testing

- Unit tests: token creation, hashing, expiry behavior.
- Integration tests: signup -> email token -> verify -> protected endpoint access.

Security

- Hash tokens in DB; never persist raw token.
- Token expiry and single-use enforcement.
- Rate limiting for resend endpoint.

3. Password Reset

---

Overview

- One-time, expiring tokens hashed in DB. Email contains reset link.
- Password strength validation (zxcvbn or OWASP rules). After use, token invalidated.
- Audit reset attempts (success/failure). Use throttling for attempts.

Schema

- `PasswordResetToken`:
  - user, tokenHash, expiresAt, used, createdAt, requestIp

API

- POST /api/auth/request-password-reset { email }
- POST /api/auth/reset-password { token, userId, newPassword }

Implementation Highlights

- Generate token (crypto.randomBytes), hash store, email link with token.
- On reset: hash provided token, find record, validate expiry and not used, validate password strength, update user password (bcrypt), invalidate token and revoke refresh tokens (optional), log audit.

Key Snippet: Reset handling

```js
// hashing
const token = crypto.randomBytes(32).toString('hex');
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
await PasswordResetToken.create({
  user: userId,
  tokenHash,
  expiresAt: Date.now() + 3600 * 1000,
  requestIp,
});
// reset
const tokenHashCheck = crypto.createHash('sha256').update(token).digest('hex');
const record = await PasswordResetToken.findOne({
  user: userId,
  tokenHash: tokenHashCheck,
  used: false,
});
if (!record || record.expiresAt < Date.now()) throw new Error('Invalid or expired token');
await User.updateOne({ _id: userId }, { password: await bcrypt.hash(newPassword, 12) });
record.used = true;
await record.save();
// revoke refresh tokens (if implemented): RefreshToken.deleteMany({user:userId});
```

Security

- Hash tokens, use HTTPS in link, require strong password rules.
- Throttle request-password-reset and reset attempts per IP and per user.
- Log events for suspicious behavior.

Tests

- Unit: token creation/hashing, password strength enforcement.
- Integration: request reset -> use token -> login with new password.

4. Loan Management Workflow

---

Overview

- Implement full lifecycle with validated status transitions and events.
- Use Loan, LoanRepaymentSchedule, LoanAudit collections.
- Emit events for notifications (email/push) and analytics.

Schema (key fields)

- `Loan`:
  - user, group, amountRequested, amountApproved, interestRate, termMonths, installmentsCount, status (draft, requested, pending_approval, approved, disbursed, active, overdue, defaulted, closed, rejected), createdAt, updatedAt, metadata

- `LoanRepaymentSchedule`:
  - loan, installments: [{dueDate, amount, principal, interest, paidAmount, paidAt, status}], outstandingBalance, nextDueDate

- `LoanAudit`:
  - loan, action, actor, before, after, reason, createdAt

Endpoints

- POST /api/loans/request {groupId, amount, termMonths, idempotencyKey}
- GET /api/loans/:loanId
- PATCH /api/loans/:loanId/approve {amountApproved, interestRate, terms} (admin)
- PATCH /api/loans/:loanId/reject {reason} (admin)
- PATCH /api/loans/:loanId/disburse (admin) -> create schedule, set status disbursed/active
- POST /api/loans/:loanId/repay {amount, paymentIntentId?} -> reconcile with PaymentService -> update schedule & loan balance
- GET /api/loans/:loanId/schedule

Status Transition Guards

- Implement in service method `changeLoanStatus(loan, newStatus, actor, reason)` which validates allowed transitions and records `LoanAudit`.
- Example: requested -> pending_approval -> approved -> disbursed -> active -> closed

Repayment schedule generation

- Use amortization schedule generator for principal+interest, create installments array in `LoanRepaymentSchedule`.
- For penalty/overdue: scheduled job (daily) that marks overdues and applies penalties per policy.

Notifications

- On approve/reject/disburse/overdue: enqueue notification job to EmailService/PushService.

Key Snippet: status guard

```js
const ALLOWED = {
  requested: ['pending_approval', 'rejected'],
  pending_approval: ['approved', 'rejected'],
  approved: ['disbursed', 'rejected'],
  disbursed: ['active'],
  active: ['overdue', 'closed', 'defaulted'],
  overdue: ['defaulted', 'active'],
};
async function changeLoanStatus(loan, newStatus, actor, reason) {
  if (!ALLOWED[loan.status] || !ALLOWED[loan.status].includes(newStatus))
    throw new Error('Invalid transition');
  const before = { ...loan.toObject() };
  loan.status = newStatus;
  await loan.save();
  await LoanAudit.create({
    loan: loan._id,
    action: `status:${newStatus}`,
    actor,
    before,
    after: loan,
    reason,
  });
}
```

Testing

- Unit tests for schedule generation, status transitions, penalty calculations.
- Integration tests covering lifecycle including payment reconciliation.

Security

- RBAC: require `group_admin` or `admin` for approval/disbursement endpoints.
- Validate loan amounts against group policy (max multiplier of contributions).

Scaling

- Use aggregation indices for querying overdue loans; schedule workers to process overdue detection in batches.

5. Chat Functionality

---

Overview

- Socket.IO based real-time layer, with token-based auth handshake.
- Message persistence in `ChatMessage` collection.
- Conversations collection to hold participants and metadata.
- Read receipts & timestamps, threading via `replyTo` field.
- Rate limiter per user for messages.

Schema

- `Conversation`:
  - \_id, participants: [userId], type (dm|group|admin), lastMessageAt, metadata
- `ChatMessage`:
  - conversation, sender, content (string or structured), attachments, createdAt, updatedAt, readBy: [userId], replyTo (messageId), moderated (boolean), status

API & Socket Events

- REST: GET /api/chats/conversations (list), GET /api/chats/conversations/:id/messages?limit&before
- Socket events: `connect` (with token), `join:conversation`, `message:send` {conversationId, content, replyTo}, `message:ack` (read receipts)

Moderation hooks

- On message create, pass through `moderationService.check(content)` which flags or emits moderation event. Support admin `deleteMessage` or `flagMessage`.

Rate limiting

- Use Redis token bucket per user: e.g., 30 messages/minute. Socket server checks before accepting message.

Key Snippet: server setup

```js
const io = new Server(httpServer, { cors: { origin: FRONTEND } });
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    socket.user = await authService.verifySocketToken(token);
    next();
  } catch (err) {
    next(new Error('Unauthorized'));
  }
});
io.on('connection', (socket) => {
  socket.on('message:send', async (payload) => {
    if (!(await rateLimiter.allow(socket.user.id))) return socket.emit('rate_limited');
    const msg = await ChatMessage.create({
      conversation: payload.conversationId,
      sender: socket.user.id,
      content: payload.content,
      replyTo: payload.replyTo,
    });
    io.to(payload.conversationId).emit('message:new', msg);
  });
});
```

Testing

- Unit: storage, moderation hooks, rate limiter.
- Integration: socket tests via Socket.IO-client and mock auth.

6. Referral System

---

Overview

- Generate unique referral codes per user. Track referrals, attribution and reward rules.
- Prevent self-referral and duplicates.

Schema

- `Referral`:
  - code (string), referrer (user), referredUser (user|null), createdAt, used (boolean), source (inviteLink|code), metadata
- `ReferralReward` config stored in `ReferralConfig` or environment (e.g., rewardPoints, eligibility criteria)

Endpoints

- POST /api/referrals/generate (protected) -> returns unique code
- POST /api/referrals/redeem {code} (during signup or in account) -> validates, attributes, issues reward
- GET /api/referrals/analytics -> aggregation endpoints for conversion & rewards

Fraud prevention

- Prevent self-referral by checking IP + phone/email overlaps with existing users.
- Limit code usage per IP or per email domain when suspicious.

Testing

- Unit: code generation and validation logic.
- Integration: redeem flow, duplicate attempts, analytics aggregation.

7. Database Migrations

---

Approach

- Use a lightweight migration runner (custom or existing library such as `migrate-mongo` or `umzug` style) that writes to a `migrations` collection.
- Each migration file exports `up` and `down` async functions.
- CLI runner `node scripts/migrate.js up` / `node scripts/migrate.js down <name>`.

Key Snippet: simple runner

```js
// scripts/migrate.js
const migrationsDir = path.join(__dirname, '..', 'migrations');
async function run() {
  const applied = await Migration.find().select('name');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    if (applied.includes(file)) continue;
    const migration = require(path.join(migrationsDir, file));
    await migration.up({ db, mongoose });
    await Migration.create({ name: file, appliedAt: new Date() });
  }
}
```

Testing & Safety

- Staging run before production, inspect `migrations` collection.
- Support dry-run and rollback.

8. Unit Tests & CI

---

Strategy

- `jest` for unit/integration tests, `supertest` for API.
- Use `mongodb-memory-server` for fast DB tests or a test Mongo instance.
- Mock external services (email, payments) using `nock` or provider test helpers.

Coverage

- Enforce thresholds in CI (`coverageThreshold` in jest config) — e.g., 80% project-wide, 90% for critical services (payments, auth, loans).

CI

- `npm run test:ci` runs linting, unit tests, and coverage. Fail build on threshold.

9. API Rate Limiting (Per-User)

---

Design

- Implement per-user & per-IP limits using Redis.
- Token-bucket sliding window implemented in Redis (Lua script for atomic ops) or use `rate-limiter-flexible` with Redis backend.
- Role-based limits: admins get higher limits.

Middleware snippet

```js
async function rateLimitMiddleware(req, res, next) {
  const key = req.user ? `rl:user:${req.user.id}` : `rl:ip:${req.ip}`;
  const allowed = await rateLimiter.consume(key, 1);
  if (!allowed) return res.status(429).json({ error: 'Too many requests' });
  next();
}
```

Testing

- Simulate bursts and validate 429 responses.

10. Analytics

---

Approach

- Event-driven model: central `EventEmitter` or external message broker (Kafka) for high scale.
- Track events: user.login, payment.succeeded, loan.requested, referral.redeemed.
- Aggregation endpoints for admin reporting use MongoDB aggregations or pre-aggregated counters (daily rollups) stored in `Analytics` collection.

Privacy

- Do not store PII in analytics; store hashed userId or anonymized IDs for non-admin metrics.

Admin endpoints

- GET /api/admin/analytics/payments?from&to -> aggregation pipeline summarizing amount, count, failed
- GET /api/admin/analytics/referrals -> conversion rate, top referrers

## Implementation Notes and Considerations

- Use environment variables for secrets and provider configs. Consider Vault for production.
- Use consistent audit logging across features (LoanAudit, PaymentAudit, AuthAudit). Each audit record must include actor, action, before/after, reason, ip.
- Modularize features into folders: `services/*`, `controllers/*`, `routes/*`, `models/*`, `jobs/*`, `workers/*`.
- For background jobs, run separate worker processes and ensure idempotent job handlers.
- Observability: integrate structured logging (winston) with correlation IDs, trace IDs across requests & jobs.

## Developer Checklist & Commands

- Install dependencies: `npm ci`
- Start dev server: `npm run dev`
- Run tests: `npm run test`
- Run migrations: `node scripts/migrate.js up`
- Initialize indexes: `node -e "require('./config/performanceOptimization').initializeIndexes()"`

## Next Steps (Immediate)

- I will scaffold service + model + route skeleton files for `PaymentService`, `EmailVerification`, `PasswordReset`, `Loan lifecycle` and the migration runner in the repository so developers can begin implementing/adapting. (Confirm to proceed.)

## Appendix: References

- Security: OWASP ASVS and OWASP Top 10
- Payments: PCI guidance (do not store full card data; use provider tokenization)
- Rate limiting: token bucket algorithm
- Migrations: follow `migrations` collection pattern used earlier in repository
