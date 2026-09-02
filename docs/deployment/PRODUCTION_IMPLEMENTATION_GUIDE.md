// PRODUCTION_IMPLEMENTATION_GUIDE.md

# Production Implementation Guide

## Overview

This document provides a comprehensive guide to the production-ready features implemented in the Community Savings App backend. All features follow industry best practices for security, scalability, reliability, and observability.

---

## Table of Contents

1. [Email Verification & Password Reset](#email-verification--password-reset)
2. [Database Migrations](#database-migrations)
3. [Testing Framework](#testing-framework)
4. [Resilience Patterns](#resilience-patterns)
5. [Monitoring & Analytics](#monitoring--analytics)
6. [Advanced Features (Loan, Chat, Referral)](#advanced-features)
7. [Deployment Checklist](#deployment-checklist)
8. [Troubleshooting](#troubleshooting)

---

## Email Verification & Password Reset

### Features Implemented

- **Email Verification**: Secure token-based email verification flow
- **Password Reset**: 15-minute expiring reset links with rate limiting
- **Password Change**: Authenticated password changes with current password verification
- **Multiple Email Providers**: SendGrid, AWS SES, Mailgun, SMTP, or console logging
- **Audit Logging**: All email events are logged for compliance and debugging
- **Rate Limiting**: Prevents abuse with per-email and per-IP rate limits

### Configuration

Set environment variables in `.env`:

```bash
# Email Provider (sendgrid, ses, mailgun, smtp, console)
EMAIL_PROVIDER=sendgrid
FROM_EMAIL=noreply@community-savings.app
FROM_NAME="Community Savings"

# SendGrid
SENDGRID_API_KEY=your_sendgrid_key

# AWS SES
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# Mailgun
MAILGUN_API_KEY=your_mailgun_key
MAILGUN_DOMAIN=mg.example.com

# SMTP (Generic)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# Frontend URL for email links
FRONTEND_URL=https://app.community-savings.com
```

### API Endpoints

```bash
# Send verification email
POST /api/email/send-verification
{
  "email": "user@example.com"
}

# Verify email with token
POST /api/email/verify
{
  "token": "..."
}

# Request password reset
POST /api/email/request-password-reset
{
  "email": "user@example.com"
}

# Reset password
POST /api/email/reset-password
{
  "token": "...",
  "password": "NewPassword123!",
  "confirmPassword": "NewPassword123!"
}

# Change password (authenticated)
POST /api/email/change-password
Headers: Authorization: Bearer <token>
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword456!",
  "confirmPassword": "NewPassword456!"
}
```

### Security Features

- Tokens are hashed in database (never stored plaintext)
- Tokens expire after 15 minutes (reset) or 24 hours (verification)
- Rate limiting: 3 verification requests per hour per email
- Rate limiting: 5 password reset requests per hour per email
- Audit trail for all email operations
- User existence not leaked (consistent response message)

---

## Database Migrations

### Features Implemented

- **Versioned Migrations**: Timestamped migration files with semantic names
- **Reversible**: Every migration has an `up()` and `down()` function for rollback
- **Atomic Batches**: Migrations grouped by batch for coordinated execution
- **Audit Trail**: Migration history tracked in MongoDB
- **Dry-run Mode**: Test migrations without applying changes
- **Environment-aware**: Different migrations for dev/staging/production

### Creating New Migrations

```bash
# Migration filename format: YYYYMMDD_HHmmss_description.js

# Example:
cat > migrations/20240201_143022_add_loan_penalties.js << 'EOF'
const migration = {
  async up() {
    const db = mongoose.connection;

    // Add penalties field to loans
    await db.collection('loans').updateMany(
      {},
      { $set: { penalties: 0 } }
    );
  },

  async down() {
    const db = mongoose.connection;

    // Remove penalties field
    await db.collection('loans').updateMany(
      {},
      { $unset: { penalties: 1 } }
    );
  }
};

module.exports = migration;
EOF
```

### Running Migrations

```bash
# Run pending migrations
npm run migrate

# Check migration status
npm run migrate:status

# List all migrations
npm run migrate:list

# Rollback last batch
npm run migrate:down

# Rollback specific batch
npm run migrate:down -- --batch 1

# Dry-run (test without applying)
npm run migrate -- --dry-run

# Verify migration health
npm run migrate:verify
```

### Migration Best Practices

1. **Make migrations reversible**: Always implement `down()` function
2. **One concern per migration**: Keep migrations focused and testable
3. **Test in staging first**: Never apply untested migrations to production
4. **Backup before production**: Always backup database before migrations
5. **Monitor during execution**: Watch logs and metrics during migration
6. **Document changes**: Add comments explaining what the migration does

---

## Testing Framework

### Features Implemented

- **Jest Configuration**: Unit and integration test setup
- **Database Test Helpers**: Easy test database setup/teardown
- **Auth Helpers**: Create test users and tokens
- **High Coverage Threshold**: 70% minimum coverage globally
- **Test Reports**: HTML, LCOV, and JUnit XML reports
- **CI-Ready**: Configured for GitHub Actions/GitLab CI

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Generate coverage report
npm run test:coverage

# CI mode (with reports)
npm run test:ci
```

### Writing Tests

```javascript
// tests/unit/models/User.test.js
describe('User Model', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await disconnectDB();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  test('should create user with valid data', async () => {
    const user = new User({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'SecurePassword123!',
    });

    await user.save();

    expect(user._id).toBeDefined();
    expect(user.email).toBe('john@example.com');
  });
});
```

### Test Coverage Goals

- Models: 85%+ coverage
- Controllers: 80%+ coverage
- Middleware: 75%+ coverage
- Services: 80%+ coverage
- Utilities: 75%+ coverage

---

## Resilience Patterns

### Features Implemented

- **Retry Policy**: Exponential backoff with jitter
- **Circuit Breaker**: Prevents cascading failures
- **Idempotency**: Safe retry without side effects
- **Bulkhead**: Concurrency limits
- **Timeouts**: Prevent hanging requests

### Using Resilience Patterns

```javascript
const { ResilientClient } = require('./utils/resilience');

// Create resilient client for external API
const apiClient = new ResilientClient({
  name: 'PaymentService',
  retry: {
    maxRetries: 3,
    initialDelayMs: 100,
    maxDelayMs: 5000,
  },
  circuitBreaker: {
    failureThreshold: 5,
    timeoutMs: 60000,
  },
  maxConcurrent: 10,
  timeoutMs: 30000,
});

// Execute with all protections
const result = await apiClient.execute(
  async () => {
    return await paymentAPI.process(payment);
  },
  {
    idempotencyKey: `payment-${payment.id}`,
  }
);
```

### Idempotency Middleware

```javascript
// Automatically prevents duplicate processing
app.use(idempotencyMiddleware);

// Clients send Idempotency-Key header
POST /api/payments
Headers: Idempotency-Key: payment-abc123
Body: { ... }
```

---

## Monitoring & Analytics

### Features Implemented

- **Metrics Collection**: Counters, gauges, histograms
- **Performance Tracking**: Request/operation latency
- **Alert System**: Anomaly detection with configurable rules
- **Health Checks**: Endpoint for service health
- **Prometheus Export**: Metrics in Prometheus format
- **Audit Logging**: All important events logged

### Viewing Metrics

```bash
# Health check
curl http://localhost:5000/api/health

# Prometheus metrics
curl http://localhost:5000/api/metrics
```

### Default Alerts

- High error rate (>10%)
- Database connection errors
- High API latency (p95 > 1s)

### Adding Custom Alerts

```javascript
const { getMonitoring } = require('./services/monitoringService');

const { alerts } = getMonitoring();

alerts.addRule({
  name: 'high_loan_default_rate',
  severity: 'warning',
  message: 'Loan default rate is unusually high',
  condition: (metrics) => {
    const defaultRate = metrics.getStats('loan_defaults_total')?.value || 0;
    const totalLoans = metrics.getStats('loan_created_total')?.value || 0;
    return defaultRate / totalLoans > 0.05; // >5% default rate
  },
});
```

### Tracking Business Events

```javascript
// In controllers
req.trackEvent('loan_created', {
  userId: user.id,
  amount: loan.amount,
  groupId: group.id,
});

// Track payments
trackPayment('success', 10000, {
  userId: user.id,
  method: 'mobile_money',
});

// Track loans
trackLoan('approved', {
  loanId: loan.id,
  userId: user.id,
  amount: loan.amount,
});
```

---

## Advanced Features (Loan, Chat, Referral)

### Loan Management System

**Features to Implement**:

- Eligibility scoring based on contribution history
- Repayment schedules with installments
- Interest calculation with compounding
- Penalties for late payments
- Lifecycle tracking (pending → approved → disbursed → repaid)

**Example Implementation**:

```javascript
// Calculate eligibility score
function calculateEligibilityScore(user, group) {
  let score = 0;

  // Contribution history: max 40 points
  const contributionMonths = calculateMonthsActive(user, group);
  score += Math.min(contributionMonths * 4, 40);

  // Payment history: max 30 points
  const paymentHistory = calculatePaymentHistory(user, group);
  score += paymentHistory * 30; // 0-1 score

  // Contribution amount: max 30 points
  const totalContributed = calculateTotalContributed(user, group);
  score += Math.min((totalContributed / group.maxLoan) * 30, 30);

  return Math.round(score);
}

// Calculate repayment schedule
function generateRepaymentSchedule(principal, rate, months) {
  const monthlyRate = rate / 12 / 100;
  const monthlyPayment =
    (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) /
    (Math.pow(1 + monthlyRate, months) - 1);

  const schedule = [];
  let balance = principal;

  for (let month = 1; month <= months; month++) {
    const interestPayment = balance * monthlyRate;
    const principalPayment = monthlyPayment - interestPayment;
    balance -= principalPayment;

    schedule.push({
      month,
      amount: Math.round(monthlyPayment),
      dueDate: new Date(Date.now() + month * 30 * 24 * 60 * 60 * 1000),
      paid: false,
    });
  }

  return schedule;
}
```

### Chat Functionality

**Features to Implement**:

- Real-time messaging with WebSockets
- Message moderation and filtering
- Persistence with pagination
- User presence tracking
- Notification system

### Referral System

**Features to Implement**:

- Unique referral codes per user
- Tracking referrer and referee
- Rewards calculation
- Anti-fraud checks (same device, location, etc.)
- Analytics dashboard

---

## Deployment Checklist

### Pre-Deployment

- [ ] All tests passing with >70% coverage
- [ ] Environment variables configured
- [ ] Database migrations tested in staging
- [ ] Backup strategy in place
- [ ] Monitoring and alerts configured
- [ ] SSL/TLS certificates ready
- [ ] Rate limiting configured
- [ ] Email provider tested

### Deployment Steps

```bash
# 1. Connect to production database
export MONGO_URI="mongodb+srv://user:pass@cluster.mongodb.net/prod-db"

# 2. Run migrations
npm run migrate

# 3. Verify migration success
npm run migrate:status

# 4. Start application
npm start

# 5. Verify health
curl https://api.example.com/api/health

# 6. Check logs
tail -f logs/application.log
```

### Post-Deployment

- [ ] Monitor error rates
- [ ] Check database performance
- [ ] Verify email sending
- [ ] Test critical user flows
- [ ] Monitor alert system
- [ ] Check backup completion

---

## Troubleshooting

### Email Not Sending

```bash
# Check email configuration
echo $EMAIL_PROVIDER
echo $SENDGRID_API_KEY

# Check audit logs
db.email_audits.find({ status: 'failed' }).limit(10)

# Test email sending
node -e "
const emailService = require('./services/emailService');
emailService.sendVerificationEmail('test@example.com', 'Test', 'http://test')
  .then(() => console.log('Sent!'))
  .catch(e => console.error(e));
"
```

### Migration Failures

```bash
# Check migration status
npm run migrate:status

# Check error details
db.migrations.find({ status: 'failed' })

# Rollback if needed
npm run migrate:down

# Fix issue and retry
npm run migrate
```

### High Error Rates

```bash
# Check alerts
curl http://localhost:5000/api/health

# View recent errors
db.email_audits.find({ status: 'failed' }).sort({ timestamp: -1 }).limit(20)

# Check application logs
tail -100 logs/application.log
```

---

## Support & Maintenance

### Regular Maintenance Tasks

- **Weekly**: Review error logs and alerts
- **Monthly**: Analyze metrics trends
- **Quarterly**: Update dependencies
- **Quarterly**: Run security audit
- **Annually**: Capacity planning review

### Emergency Procedures

**Database corruption**:

1. Stop application
2. Restore from backup
3. Apply migrations from backup point forward
4. Restart application

**Email provider outage**:

1. Switch to alternative provider
2. Update `EMAIL_PROVIDER` environment variable
3. Restart application
4. Queue failed emails for retry

**High traffic/load**:

1. Monitor circuit breaker status
2. Check bulkhead concurrency limits
3. Enable caching
4. Scale horizontally if needed

---

## Additional Resources

- [Express Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [MongoDB Best Practices](https://docs.mongodb.com/manual/core/security/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)

---

**Version**: 2.0.0  
**Last Updated**: February 2026  
**Author**: TITech Africa
