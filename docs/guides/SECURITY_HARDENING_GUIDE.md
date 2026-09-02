# Security Hardening Guide

## Overview

This document outlines security considerations and hardening procedures for the 10 core features of the Community Savings App.

---

## 1. Payment Processing Security

### OWASP Compliance

- **PCI DSS Level 1 Requirements**
  - Never store raw credit card numbers; use provider tokenization
  - All payment data encrypted at rest and in transit (TLS 1.3+)
  - Quarterly security scans and audits
  - Prevent SQL/NoSQL injection via parameterized queries (Mongoose)

### Specific Controls

- **Webhook Signature Verification**
  - Verify HMAC signature on all incoming webhooks
  - Use constant-time comparison to prevent timing attacks
  - Discard requests with invalid signatures (return 403)

- **Idempotency Key Validation**
  - Enforce unique idempotency keys per user
  - Store idempotencyKey in PaymentIntent, check DB before creating duplicate
  - TTL idempotency keys: 24 hours (regenerate stale keys)

- **Audit Logging**
  - Log every payment state transition: user, timestamp, before/after, reason
  - Never log full card PAN or full token; log last 4 digits only
  - Store logs immutably (append-only collection)

- **Rate Limiting**
  - Max 10 payment intents per user per minute
  - Max 50 payment intents per IP per minute
  - Return 429 with Retry-After header

- **Encryption**
  - Encrypt sensitive payment metadata at rest: `clientSecret`, `providerToken`
  - Use Node `crypto` with AES-256-GCM, store key in vault (HashiCorp Vault or AWS Secrets Manager)

### Testing

```bash
# Verify webhook signature validation
curl -X POST http://localhost:5000/api/payments/webhook/stripe \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: invalid" \
  -d '{"type":"payment_intent.succeeded"}'
# Expected: 403 Forbidden

# Test idempotency
curl -X POST http://localhost:5000/api/payments/intents \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"amount": 5000, "idempotencyKey": "key123"}'
# First call: creates intent
# Second call (same key): returns same intent
```

---

## 2. Email Verification Security

### Controls

- **Token Security**
  - Generate token: `crypto.randomBytes(32).toString('hex')` → 64-char hex string
  - Hash token before storage: `SHA256(token)` → store hash only
  - Single-use enforcement: mark `used: true` after verification
  - Expiry: 24 hours (configurable)

- **Rate Limiting**
  - Max 3 verification requests per user per hour
  - Max 10 verification requests per IP per hour
  - Throttle resend endpoint to prevent email spam

- **Email Template Security**
  - No sensitive data in email body
  - Include "suspicious activity" notice if verification request from new IP
  - HTTPS-only links (no HTTP fallback)
  - Discourage sharing verification links

- **IP Tracking**
  - Log request IP in EmailVerificationToken
  - Alert user if verification from unfamiliar location

### Testing

```bash
# Test token expiry
# Create token, modify expiresAt to past date
db.emailverificationtokens.updateOne({_id:...}, {expiresAt: ISODate("2020-01-01")})
# Try to verify
curl http://localhost:5000/api/auth/verify-email?token=...&id=...
# Expected: 400 Token expired

# Test single-use
# Verify once
curl http://localhost:5000/api/auth/verify-email?token=T1&id=U1
# Verify again with same token
curl http://localhost:5000/api/auth/verify-email?token=T1&id=U1
# Expected: 400 Invalid token
```

---

## 3. Password Reset Security

### Controls

- **Token Handling**
  - Generate: `crypto.randomBytes(32).toString('hex')` → 64-char hex
  - Hash before storage: `SHA256(token)`
  - Single-use: mark `used: true`
  - Expiry: 1 hour

- **Password Strength Validation**
  - Minimum: 12 characters
  - Required: uppercase, lowercase, digit, symbol
  - Reject common patterns (password123, qwerty, etc.)
  - Use `zxcvbn` scoring: min score 3/4
  - Prevent password reuse: check against last 5 passwords

- **Token Invalidation**
  - After reset, revoke all active sessions: `RefreshToken.deleteMany({user: userId})`
  - Force re-login on all devices
  - Send notification email: "Your password was reset. If this wasn't you, contact support."

- **Rate Limiting**
  - Max 5 password reset requests per user per hour
  - Max 20 password reset requests per IP per hour
  - Enforce exponential backoff after failures

- **Audit Logging**
  - Log all reset attempts (success/failure)
  - Log IP, timestamp, user agent
  - Alert if multiple failed attempts from same IP

### Testing

```bash
# Test weak password rejection
curl -X POST http://localhost:5000/api/auth/reset-password \
  -d '{"id": "userId", "token": "tok123", "newPassword": "weak"}'
# Expected: 400 Password too weak

# Test token invalidation
# Reset password
curl -X POST http://localhost:5000/api/auth/reset-password ...
# Verify all refresh tokens deleted
db.refreshtokens.count({user: ObjectId("...")})
# Expected: 0

# Test rate limiting
for i in {1..6}; do
  curl -X POST http://localhost:5000/api/auth/request-password-reset \
    -d '{"email":"user@test.com"}'
done
# 6th request: Expected 429
```

---

## 4. Loan Management Security

### Controls

- **Status Transition Guards**
  - Enforce strict state machine: validate allowed transitions
  - Reject unauthorized status changes (log event)
  - Require admin approval for approve/reject/disburse

- **RBAC (Role-Based Access Control)**
  - User can only view their own loans
  - Group members can view group loans (read-only)
  - Only group_admin/admin can approve/reject/disburse
  - Only user can request loan; only admin can mark repaid

- **Amount Validation**
  - Validate against group policy: `amountRequested ≤ 2.5 × user.totalContributed`
  - Reject amounts with invalid currency (whitelist KES, USD, etc.)
  - Check integer amount (no fractional cents); validate range: [100, 1000000]

- **Audit Trail**
  - All status changes logged in LoanAudit
  - Store actor, timestamp, before/after, reason
  - Create separate LoanAudit records for payment reconciliation

- **Overdue & Default Handling**
  - Daily cron job detects overdue (past dueDate)
  - Mark overdue, apply penalty (e.g., +2% per month)
  - After 30 days overdue → mark defaulted
  - Notify user and admin

### Testing

```bash
# Test RBAC: user cannot approve their own loan
curl -X PATCH http://localhost:5000/api/loans/L123/approve \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"amountApproved": 5000}'
# Expected: 403 Forbidden

# Test amount validation
curl -X POST http://localhost:5000/api/loans/request \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"groupId": "G123", "amount": 999999999}'
# Expected: 400 Amount exceeds policy limit

# Verify audit trail
db.loanaudits.find({loan: ObjectId("L123")}).pretty()
# Should show all status transitions with timestamps
```

---

## 5. Chat Security

### Controls

- **Authentication**
  - Socket.IO auth via JWT token in handshake
  - Revoke tokens on logout: add to token blacklist (Redis TTL)
  - Validate token signature and expiry

- **Authorization**
  - User can only access conversations they're a participant of
  - DM: validate 1:1 between 2 users
  - Group: validate user is group member
  - Admin channels: require admin role

- **Moderation**
  - On message:send, pass through moderation check (profanity, spam detection)
  - Flag or reject offensive messages
  - Log moderated messages with reason
  - Support admin override to delete/restore messages

- **Rate Limiting**
  - Max 30 messages per user per minute
  - Max 100 messages per conversation per minute
  - Return 429 if exceeded

- **Data Sanitization**
  - Sanitize message content via `xss-clean` to prevent XSS
  - Store only plain text or pre-approved HTML
  - Escape user-supplied content in responses

- **Encryption**
  - Encrypt message content at rest (optional, for sensitive conversations)
  - Use TLS for all Socket.IO connections

### Testing

```bash
# Test socket auth failure
const io = require('socket.io-client');
const socket = io('http://localhost:5000', {auth: {token: 'invalid'}});
socket.on('error', (err) => console.log(err)); // Expected: Unauthorized

# Test authorization: user2 tries to access user1's DM
socket.emit('join:conversation', 'conv:user1-admin-only');
// Expected: socket refused or message dropped

# Test rate limiting: rapid messages
for(let i=0; i<31; i++) {
  socket.emit('message:send', {conversationId, content: 'msg'});
}
// 31st message: Expected `rate_limited` event or socket disconnect
```

---

## 6. Referral Security

### Controls

- **Self-Referral Prevention**
  - Check `referrer !== referredUser`
  - Second check: same email domain + phone number overlap → flag as suspicious

- **Fraud Detection**
  - IP reputation: reject if IP has high abuse score (e.g., VPN, proxy detected)
  - Email domain whitelist: allow only organic domains (gmail, yahoo, corporate)
  - Temporal limits: max N redemptions per unique IP per day (e.g., 5/day)
  - CAPTCHA for suspicious patterns

- **Code Security**
  - Generate unique alphanumeric codes: collision detection
  - Store codes hashed (optional, for paranoia)
  - Enforce code expiry: max 1 year from creation

- **Analytics Privacy**
  - Hash/anonymize user IDs in referral reports (SHA256)
  - No PII in analytics exports
  - Restrict report access to admin role only

### Testing

```bash
# Test self-referral rejection
curl -X POST http://localhost:5000/api/referrals/redeem \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"code": "USER_OWN_CODE"}'
# Expected: 400 Self-referral not allowed

# Test fraud detection
# Attempt 6 redemptions from same IP in 1 day
curl ... -d '{"code": "CODE1"}' # from IP 192.168.1.1
curl ... -d '{"code": "CODE2"}' # from IP 192.168.1.1
# ... (6 total)
# Expected: 6th request blocked or flagged for admin review

# Verify code uniqueness
const codes = new Set();
for(let i=0; i<1000; i++) {
  const resp = await request.post('/api/referrals/generate');
  codes.add(resp.body.code);
}
// Expected: codes.size === 1000 (no duplicates)
```

---

## 7. Database Migration Security

### Controls

- **Version Control**
  - Migrations tracked in Git
  - Every migration: review and approval before merge
  - Signed commits recommended (GPG)

- **Testing**
  - Run migrations on staging before production
  - Test rollback: apply, verify data, rollback, verify state
  - Backup DB before running migrations

- **Audit Trail**
  - Migrations collection records: name, appliedAt, description, appliedBy
  - Log all index creations and schema changes
  - Track rollback events

- **Zero-Downtime**
  - Ensure migrations are backward-compatible
  - Add fields with defaults, don't delete
  - Use blue-green deployment alongside migrations

### Testing

```bash
# Test migration in staging
mongo mongodb://staging/community-savings
> db.migrations.find()

# Apply migration
npm run migrate

# Verify data integrity
db.paymentintents.count()
db.paymentintents.aggregate([...])  // spot checks

# Rollback
npm run migrate:down

# Verify rollback
db.collections()
```

---

## 8. Testing Security

### Controls

- **Test Isolation**
  - Use separate test DB (memory-server or test instance)
  - Cleanup after tests: delete all test data
  - Prevent cross-test pollution via BeforeEach/AfterEach

- **Mock Security**
  - Mock external services (email, payments) → no real data sent
  - Verify mocks are called with sanitized data
  - Never persist test secrets in repo

- **coverage enforcement**
  - Critical paths (auth, payments, loans) ≥ 90% line coverage
  - Enforce via CI: fail build if threshold not met

### Testing

```bash
npm run test:ci
# Output should include:
# -----------|----------|----------|----------|----------|
# File      | % Stmts  | % Branch | % Funcs  | % Lines  |
# -----------|----------|----------|----------|----------|
# ... services/payment/ | 95.5 | 92.1 | 96.3 | 95.1 |
```

---

## 9. Rate Limiting Security

### Controls

- **Per-User & Per-IP Limits**
  - Per-user: 100 requests/minute (adjustable by role)
  - Per-IP: 500 requests/minute
  - Admin: 2× multiplier

- **Redis Persistence**
  - Store rate limit buckets in Redis (atomic ops via Lua scripts)
  - TTL buckets: auto-expire after 1 hour inactivity

- **Response Headers**
  - Return `X-RateLimit-Remaining-User`, `X-RateLimit-Remaining-IP`
  - Return `Retry-After` header on 429 response

- **Bypass & Allowlisting**
  - Optional: whitelist internal IPs (healthcheck servers)
  - No bypass for user-facing endpoints

### Testing

```bash
# Simulate burst and verify 429
for i in {1..101}; do
  curl http://localhost:5000/api/loans -H "Authorization: Bearer $TOKEN"
done
# After 100: Expected 429

# Verify headers
curl -i http://localhost:5000/api/loans
# Expected headers:
# X-RateLimit-Remaining-User: 99
# X-RateLimit-Remaining-IP: 499
```

---

## 10. Analytics Security

### Controls

- **Data Privacy**
  - Never log PII (emails, phone numbers, full names)
  - Hash/anonymize user IDs: use `hash(userId + salt)` for reports
  - Exclude sensitive fields from event data

- **Access Control**
  - Analytics endpoints: admin role only
  - Export reports: create audit log (who, when, data requested)

- **Data Retention**
  - Delete raw events after N days (e.g., 90 days)
  - Keep monthly/daily aggregations indefinitely
  - Support user data deletion (GDPR): cascade delete all events

- **Export Security**
  - Rate-limit export endpoints: 1 export per minute per user
  - Require additional authentication for sensitive reports
  - Log all exports with user, IP, timestamp, data scope

### Testing

```bash
# Test admin-only access
curl http://localhost:5000/api/admin/analytics/payments \
  -H "Authorization: Bearer $USER_TOKEN"
# Expected: 403 Forbidden

curl http://localhost:5000/api/admin/analytics/payments \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# Expected: 200 OK with data

# Verify PII not in events
db.analyticsevents.findOne()
# Should NOT contain: email, phone, fullName, ssn, credit_card
# Should contain: hashedUserId, event type, timestamp, anonymousMetadata
```

---

## Additional Hardening

### Global Security Headers (Helmet.js)

```js
const helmet = require('helmet');
app.use(helmet()); // Enables:
// - Strict-Transport-Security (HSTS)
// - X-Content-Type-Options: nosniff
// - X-Frame-Options: deny
// - X-XSS-Protection: 1; mode=block
// - CSP strict policy
```

### CORS Configuration

```js
const cors = require('cors');
app.use(
  cors({
    origin: process.env.FRONTEND_URL, // explicit whitelist
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
```

### Input Validation & Sanitization

```js
const { body, validationResult } = require('express-validator');
const mongoSanitize = require('express-mongo-sanitize');
app.use(mongoSanitize()); // removes NoSQL injection
router.post(
  '/api/loans/request',
  [
    body('amount').isInt({ min: 100, max: 1000000 }),
    body('groupId').isMongoId(),
    body('termMonths').isInt({ min: 1, max: 60 }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors });
  }
);
```

### Dependency Security

```bash
npm audit  # Regular audit of dependencies
npm update # Keep dependencies patched
```

### Secrets Management

- Use `.env.example` (no secrets)
- Store secrets in vault (HashiCorp, AWS Secrets Manager, etc.)
- No secrets in Git commits
- Rotate secrets regularly

### Logging & Monitoring

```js
const logger = require('./middleware/logging');
logger.error('Payment failed', { paymentIntentId, error, userId, ip });
// Structured logging: grep, alerting, dashboards
```

---

## Security Audit Checklist

- [ ] OWASP Top 10 review (A01-A10)
- [ ] OWASP ASVS Level 2 compliance review
- [ ] Dependency vulnerability scan (`npm audit`)
- [ ] SAST (Static Application Security Testing): `SonarQube` or `Checkmarx`
- [ ] DAST (Dynamic testing): `OWASP ZAP` or `Burp Suite`
- [ ] Penetration testing (external consultancy)
- [ ] SSL/TLS certificate validation
- [ ] Rate limiting & brute-force protection
- [ ] SQL/NoSQL injection prevention
- [ ] CSRF & CORS configurations
- [ ] Secrets rotation audit
- [ ] Log & audit trail review
- [ ] Incident response plan
- [ ] Disaster recovery plan

---

## Incident Response

1. **Alert**: Monitoring detects anomaly (excessive failed logins, rate limit spikes, etc.)
2. **Investigation**: Check logs, identify root cause
3. **Containment**: Rate-limit affected user, revoke tokens if needed
4. **Eradication**: Patch vulnerability, deploy fix
5. **Recovery**: Restore normal service, communicate with users
6. **Post-Mortem**: Document lessons learned, improve preventive controls

---

End of Security Hardening Guide
