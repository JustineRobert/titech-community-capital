# TITech Community Capital Ltd — Payment Callback Security Specification

> **System:** Community Savings Platform
> **Document:** `docs/security/PAYMENT_CALLBACK_SECURITY.md`
> **Status:** Enterprise Production Security Architecture Standard
> **Version:** 2.0
> **Last Updated:** August 16, 2026
> **Domain:** Payment Security / Webhooks / Provider Callbacks / Financial Integrity
> **Primary Providers:** MTN MoMo, Airtel Money, Bank/Settlement Providers
> **Security Principle:** A provider callback is untrusted external input until cryptographically authenticated, structurally validated, authorized, deduplicated, and reconciled against authoritative internal state.

---

# 1. Purpose

This document defines the production-grade security architecture for inbound payment callbacks, webhooks, notifications, and provider status messages received by the TITech Community Capital Ltd Community Savings Platform.

Payment callbacks are security-critical because they may influence:

```text
Payment status
Loan repayment status
Loan disbursement state
Contribution state
Settlement state
Financial transaction state
Ledger posting
Reconciliation
Customer notifications
```

A compromised, forged, replayed, duplicated, malformed, delayed, or out-of-order callback must never be allowed to create an unauthorized financial effect.

---

# 2. Non-Negotiable Security Rules

```text
1. Never trust callback payloads by default.
2. Authenticate the provider before processing the callback.
3. Verify the provider signature exactly as specified by the provider contract.
4. Verify timestamps/nonces where supported.
5. Reject stale or replayed callbacks according to the provider protocol.
6. Deduplicate callbacks using stable provider event identifiers and payload fingerprints.
7. Never post directly to the ledger from an HTTP callback controller.
8. Normalize provider payloads before domain processing.
9. Match the callback to an existing internal payment/operation.
10. Validate amount and currency before any financial posting.
11. Validate payment state transition before applying the callback.
12. Treat provider status as external evidence, not unquestioned internal truth.
13. Persist the callback evidence needed for audit and replay investigations.
14. Minimize sensitive data in logs and stored payloads.
15. Apply tenant isolation to all internal lookups.
16. Make callback processing idempotent.
17. Keep external HTTP handling separate from financial posting.
18. Return safe, deterministic HTTP responses.
19. Do not reveal internal validation details to hostile callers.
20. Financial effects occur only after all applicable security and business controls pass.
```

---

# 3. Threat Model

The callback subsystem must defend against:

```text
Forgery
Replay attacks
Duplicate delivery
Payload tampering
Signature bypass
Timestamp manipulation
Event ID reuse
Provider impersonation
Man-in-the-middle attacks
Credential leakage
Endpoint enumeration
Denial of service
Payload flooding
Malformed JSON
Oversized payloads
Out-of-order delivery
Delayed delivery
Unknown transaction references
Amount manipulation
Currency manipulation
Status manipulation
Cross-tenant correlation attacks
Privilege escalation through callback fields
```

---

# 4. Trust Boundary

The callback architecture is:

```text
                 EXTERNAL / UNTRUSTED
+-----------------------------------------------+
| MTN MoMo / Airtel Money / Bank / Provider    |
+------------------------+----------------------+
                         |
                         v
                +------------------+
                | TLS / HTTPS      |
                +--------+---------+
                         |
                         v
                +------------------+
                | Callback Gateway |
                | / Route          |
                +--------+---------+
                         |
                         v
                +------------------+
                | Signature        |
                | Verification     |
                +--------+---------+
                         |
                         v
                +------------------+
                | Schema / Header  |
                | Validation       |
                +--------+---------+
                         |
                         v
                +------------------+
                | Replay /         |
                | Deduplication    |
                +--------+---------+
                         |
                         v
                +------------------+
                | Normalization    |
                +--------+---------+
                         |
                         v
                +------------------+
                | Payment Lookup   |
                | + State Check    |
                +--------+---------+
                         |
                         v
                +------------------+
                | Financial Domain |
                | Service          |
                +--------+---------+
                         |
                         v
                +------------------+
                | Ledger / Finance |
                +------------------+
```

The ledger must never be directly exposed as a provider callback target.

---

# 5. Callback Processing Layers

The preferred implementation uses the following logical components:

```text
Callback Registry
Callback Authentication
Callback Signature Verifier
Callback Timestamp Validator
Callback Replay Guard
Callback Deduplication
Callback Normalizer
Callback Schema Validator
Callback Business Validator
Callback Processing Engine
Payment State Manager
Financial Posting Service
Audit Service
Event Publisher
```

Recommended conceptual flow:

```text
Provider
  |
  v
Callback Registry
  |
  v
Provider Authentication
  |
  v
Signature Verification
  |
  v
Timestamp / Replay Validation
  |
  v
Schema Validation
  |
  v
Deduplication
  |
  v
Normalization
  |
  v
Payment Correlation
  |
  v
Business State Validation
  |
  v
Financial Processing
  |
  v
Audit + Event
```

---

# 6. HTTPS Requirements

All production callback endpoints must use HTTPS.

Required:

```text
TLS 1.2+
Valid server certificate
Strong cipher configuration
Certificate-chain validation
HSTS for public API infrastructure where applicable
```

Plain HTTP callback endpoints must not be accepted in production.

Development-only HTTP support must be explicitly isolated from production configuration.

---

# 7. Reverse Proxy / Load Balancer Security

When deployed behind a proxy/load balancer:

```text
Client
  |
  v
Load Balancer / WAF
  |
  v
API Gateway
  |
  v
Application
```

The application must correctly configure trusted proxies.

Do not trust arbitrary forwarded headers from the public internet.

In particular:

```text
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
```

must be interpreted only from trusted proxy infrastructure.

---

# 8. Callback Endpoint Design

Provider-specific callback endpoints should remain explicit.

Examples:

```text
POST /api/callbacks/mtn
POST /api/callbacks/airtel
POST /api/callbacks/bank
```

or, where the repository uses provider-specific routes:

```text
POST /api/webhooks/mtn
POST /api/webhooks/airtel
```

Each provider should have an isolated authentication/normalization adapter.

Do not implement one generic signature verification rule and assume that all providers follow the same protocol.

---

# 9. Provider Adapter Boundary

The provider-specific adapter owns:

```text
Provider headers
Provider signature format
Provider timestamp format
Provider event ID extraction
Provider status mapping
Provider reference extraction
Provider amount/currency extraction
Provider payload normalization
```

The financial core receives only the normalized internal representation.

---

# 10. Normalized Callback Contract

All provider callbacks should be normalized into a common internal structure.

Example:

```json
{
  "provider": "mtn_momo",
  "providerEventId": "provider-event-123",
  "providerTransactionId": "provider-tx-456",
  "reference": "PAY-001",
  "status": "successful",
  "amount": "5500.00",
  "currency": "UGX",
  "occurredAt": "2026-08-16T00:00:00.000Z",
  "receivedAt": "2026-08-16T00:00:05.000Z"
}
```

The normalized payload must not automatically inherit trust from the provider.

It remains subject to internal validation.

---

# 11. Signature Verification

The provider signature must be verified before business processing.

Signature verification must use:

```text
provider-specific signing algorithm
provider-issued secret/key
exact signing input
exact encoding rules
constant-time comparison
```

Do not use a regular string equality comparison for security-sensitive signatures.

Preferred:

```text
crypto.timingSafeEqual(...)
```

where supported and correctly applied.

---

# 12. Raw Payload Integrity

When a provider signs the raw request body, signature verification must occur against the exact bytes received from the provider.

Do not:

```text
parse JSON
reorder fields
reformat JSON
change whitespace
convert encoding
```

before signature verification if the provider specification signs the raw body.

Recommended processing:

```text
Raw Body
   |
   v
Signature Verification
   |
   v
JSON Parsing
   |
   v
Schema Validation
```

---

# 13. Raw-Body Capture

Where signature verification requires the raw payload, the framework must preserve it safely.

The implementation should provide the callback handler with both:

```text
rawBody
parsedBody
```

without corrupting the original bytes.

The raw body should not be permanently persisted unless required for:

```text
audit
forensics
provider dispute resolution
replay investigation
```

If stored, it must follow appropriate retention and access controls.

---

# 14. Signature Input Construction

Provider-specific signature input may involve:

```text
HTTP method
URL/path
timestamp
nonce
client ID
request body
provider event ID
selected headers
```

The exact input must be implemented according to the provider's official contract.

Do not invent or approximate a signature formula.

---

# 15. HMAC Verification

For HMAC-based providers:

```text
signature = HMAC(
    providerSecret,
    canonicalSigningInput
)
```

The expected digest must be compared securely.

The implementation should explicitly validate:

```text
algorithm
encoding
signature length
signature format
timestamp
canonicalization
```

---

# 16. Asymmetric Signature Verification

If a provider uses an asymmetric signature:

```text
Provider Private Key
      |
      v
Signature
      |
      v
Platform Public Key
      |
      v
Verification
```

Public keys must be:

```text
trusted
versioned
rotatable
validated
retrieved through secure configuration
```

Do not accept arbitrary public keys supplied by the callback itself.

---

# 17. Secret Management

Provider signing secrets must never be hard-coded.

Do not:

```javascript
const secret = "my-provider-secret";
```

Use approved configuration/secret management.

Example conceptual configuration:

```text
MTN_CALLBACK_SECRET
AIRTEL_CALLBACK_SECRET
BANK_CALLBACK_PUBLIC_KEY
```

Secrets must be provided through secure runtime configuration.

---

# 18. Secret Rotation

Provider callback secrets must support rotation where the provider supports it.

Preferred model:

```text
current secret
+
previous secret during transition
```

Verification process:

```text
Try current secret
      |
      +---- success
      |
      v
Try previous secret if rotation window permits
      |
      +---- success
      |
      v
Reject
```

Successful validation using the old secret should be observable so the rotation can be completed before its retirement deadline.

---

# 19. Timestamp Validation

If the provider supplies a signed timestamp, validate freshness.

Example policy:

```text
received timestamp
        |
        v
compare with trusted current time
        |
        v
within allowed tolerance?
```

Recommended baseline:

```text
5 minutes
```

The exact window must be provider-specific.

Large clock skew should be treated as suspicious.

---

# 20. Clock Management

Callback timestamp validation depends on synchronized system time.

Production hosts should use a trusted time synchronization mechanism.

Do not disable replay protections because of avoidable server clock drift.

---

# 21. Nonce Validation

Where provider protocols include a nonce:

```text
nonce
```

must be:

```text
validated
unique within the replay window
associated with the event
```

A nonce must not be accepted repeatedly where the provider contract intends one-time use.

---

# 22. Replay Attack Protection

A callback may be legitimate but maliciously replayed.

Replay defenses should include:

```text
providerEventId
providerTransactionId
timestamp
nonce where supported
payloadHash
callbackId
processing record
```

Replay detection should occur before financial side effects.

---

# 23. Callback Deduplication

Preferred deduplication keys:

```text
provider
+
providerEventId
```

Secondary safeguards:

```text
provider
+
providerTransactionId
+
eventType
```

Additional payload fingerprint:

```text
payloadHash
```

should be used where helpful.

---

# 24. Duplicate Callback Handling

When a callback has already been processed:

```http
200 OK
```

may be appropriate where the provider expects successful acknowledgement for known duplicates.

Example response:

```json
{
  "success": true,
  "message": "Callback already processed"
}
```

The system must not execute the financial side effect again.

---

# 25. Unknown Callback Handling

If a callback references no known internal transaction:

```text
Do not create a financial transaction automatically.
```

Instead:

```text
persist callback evidence
mark for investigation/reconciliation
return safe provider-compatible acknowledgement
```

where the provider protocol permits acknowledgement.

---

# 26. Amount Verification

Never trust callback amount without comparing it to the internal operation.

Example:

```text
Internal Payment
Amount = 5,500 UGX

Provider Callback
Amount = 5,500 UGX
```

Valid.

If:

```text
Internal Payment
Amount = 5,500 UGX

Provider Callback
Amount = 50,500 UGX
```

the callback must not be posted as-is.

It should produce an exception:

```text
CALLBACK_AMOUNT_MISMATCH
```

---

# 27. Currency Verification

The callback currency must match the expected operation where currency is fixed.

Example:

```text
Expected = UGX
Received = USD
```

Reject/hold for reconciliation.

Do not silently convert currencies.

---

# 28. Provider Reference Verification

Match callback references against internal state:

```text
providerTransactionId
externalReference
merchantReference
paymentReference
```

The implementation must prevent an attacker from supplying an unrelated valid provider reference to attach money to the wrong internal transaction.

---

# 29. Customer / Account Verification

Where provider callbacks expose account or customer identifiers, validate them against the internal payment context.

Example:

```text
Internal Payment:
  userId = user_001

Callback:
  customerReference = user_999
```

Do not process automatically.

---

# 30. Tenant Verification

Provider callbacks generally may not contain a trustworthy tenant identifier.

Tenant scope should therefore be derived from the matched internal payment/operation.

Example:

```text
providerTransactionId
        |
        v
Internal Payment
        |
        v
tenantId
```

Do not allow the callback to override tenant ownership.

---

# 31. State Transition Security

Provider callbacks may propose transitions such as:

```text
pending -> successful
pending -> failed
processing -> successful
```

The internal state machine decides whether that transition is permitted.

Invalid example:

```text
reversed -> successful
```

should not be accepted.

---

# 32. Out-of-Order Callback Protection

Providers may send callbacks out of order.

Example:

```text
PaymentSuccessful
PaymentPending
```

If the payment is already completed, a later `pending` callback must not downgrade the payment state.

The state machine must enforce monotonic or explicitly permitted transitions.

---

# 33. Callback Status Mapping

Provider statuses must be mapped through a controlled adapter.

Example:

```text
Provider SUCCESS
      |
      v
INTERNAL SUCCESSFUL

Provider PENDING
      |
      v
INTERNAL PENDING

Provider FAILED
      |
      v
INTERNAL FAILED
```

Do not directly assign arbitrary provider strings to internal status fields.

---

# 34. Financial Posting Rule

A callback controller must never do:

```javascript
payment.status = "successful";
account.balance += payment.amount;
```

The correct flow is:

```text
Callback
  |
  v
Callback Security
  |
  v
Callback Processing Engine
  |
  v
Payment State Service
  |
  v
Financial Transaction
  |
  v
Posting Engine
  |
  v
Ledger
```

---

# 35. Callback Processing Transaction Boundary

A callback may perform:

```text
callback record
payment state update
idempotency state
financial operation reference
outbox event
```

within a suitable atomic transaction.

External provider calls must not be held open inside an unnecessary database transaction.

---

# 36. Callback Processing Status

Recommended callback lifecycle:

```text
RECEIVED
   |
   v
AUTHENTICATED
   |
   v
VALIDATED
   |
   v
DEDUPLICATED
   |
   v
NORMALIZED
   |
   v
PROCESSING
   |
   +------> FAILED
   |
   v
PROCESSED
```

Duplicate:

```text
RECEIVED
   |
   v
DUPLICATE
```

Dead-letter:

```text
FAILED
   |
   v
DEAD_LETTER
```

---

# 37. Callback Record

Recommended persistent record:

```text
callbackId
provider
providerEventId
providerTransactionId
payloadHash
signatureStatus
timestampStatus
schemaStatus
processingStatus
matchedPaymentId
receivedAt
processedAt
attemptCount
lastErrorCode
lastErrorMessage
createdAt
updatedAt
```

Do not store provider secrets.

---

# 38. Callback Payload Storage

Store only what is operationally required.

Preferred:

```text
normalized payload
provider references
payload hash
selected security headers
```

Store full raw payload only if required for:

```text
audit
dispute handling
regulatory evidence
provider troubleshooting
```

If stored:

```text
encrypt if required
restrict access
apply retention
redact secrets
```

---

# 39. Payload Hashing

A cryptographic hash may be retained for integrity evidence.

Example:

```text
SHA-256(rawPayload)
```

This allows later verification that the stored payload has not been altered.

Hashing does not replace signature verification.

---

# 40. Request Size Limits

Callback endpoints must have strict body-size limits.

Example:

```text
128 KB
```

or a provider-specific limit with a safe margin.

Do not accept arbitrarily large webhook payloads.

Oversized requests should be rejected before expensive processing.

---

# 41. JSON Parsing Security

Use bounded body parsers.

Reject:

```text
malformed JSON
unexpected content type
unexpected encoding
excessively deep structures
unexpected large arrays
```

Do not enable unsafe parser behavior merely for provider convenience.

---

# 42. Content Type Validation

Expected:

```http
Content-Type: application/json
```

where the provider contract specifies JSON.

If a provider sends another media type, configure an explicit provider adapter rather than globally accepting arbitrary body types.

---

# 43. Header Validation

Validate expected provider headers:

```text
signature
timestamp
event-id
request-id
provider-version
```

Unknown headers should not automatically be treated as malicious, but security-critical headers must be validated.

Never trust:

```text
X-Forwarded-For
```

as provider identity.

---

# 44. Provider IP Allowlisting

IP allowlisting may be used as a defense-in-depth control where the provider publishes stable source ranges.

However:

> IP allowlisting must not replace cryptographic signature verification.

IP ranges may change, and network origin alone is insufficient proof of message authenticity.

---

# 45. mTLS

Where supported by the provider, mutual TLS may provide an additional authentication layer:

```text
Provider Certificate
      |
      v
TLS Handshake
      |
      v
Trusted Client Certificate
```

mTLS still does not eliminate the need for payload/state validation.

---

# 46. WAF / Gateway Protection

Production callback endpoints should ideally be protected by an API gateway/WAF capable of:

```text
DDoS protection
request size limits
rate limiting
TLS enforcement
bot filtering where applicable
IP reputation controls
basic anomaly detection
```

Provider callbacks must not be blocked by generic bot protections that were not designed for machine-to-machine traffic.

---

# 47. Callback Rate Limiting

Rate limiting should be provider-aware.

Recommended dimensions:

```text
provider
endpoint
source network
provider account
event type
```

Do not apply such an aggressive generic user-IP rate limit that legitimate provider retries are rejected indefinitely.

---

# 48. Provider Retry Compatibility

Providers may retry callbacks when they do not receive their expected acknowledgement.

The callback endpoint should therefore:

```text
authenticate
deduplicate
process safely
acknowledge appropriately
```

A duplicate provider retry must not result in duplicate financial posting.

---

# 49. HTTP Acknowledgement Strategy

Provider-specific acknowledgement requirements are authoritative.

A typical pattern is:

### Accepted/Processed

```http
200 OK
```

### Accepted for Asynchronous Processing

```http
202 Accepted
```

### Invalid/Rejected

```http
400
401
403
```

only when the provider contract expects such responses and retries are understood.

For some providers, returning `4xx` may trigger repeated retries. Configure intentionally.

---

# 50. Safe Error Responses

Do not reveal:

```text
signature secret
internal account identifiers
database details
stack traces
payment-provider credentials
internal class names
```

Example:

```json
{
  "success": false,
  "error": {
    "code": "CALLBACK_VALIDATION_FAILED",
    "message": "Callback could not be processed."
  }
}
```

Detailed diagnostics remain in controlled internal logs.

---

# 51. Signature Failure Handling

On invalid signatures:

```text
1. Do not process business state.
2. Do not post to the ledger.
3. Record security telemetry.
4. Increment authentication-failure metrics.
5. Log a redacted security event.
6. Apply provider-specific HTTP acknowledgement policy.
```

Repeated signature failures may trigger security alerts.

---

# 52. Replay Failure Handling

On detected replay:

```text
Do not process the financial side effect.
```

If the event was legitimately processed earlier, acknowledge according to the provider contract.

Metrics:

```text
callback_replay_detected_total
```

---

# 53. Amount Mismatch Handling

On mismatch:

```text
Do not post.
Do not overwrite internal amount.
Do not automatically trust provider amount.
```

Create a reconciliation exception.

Example:

```text
CALLBACK_AMOUNT_MISMATCH
```

---

# 54. Currency Mismatch Handling

On mismatch:

```text
CALLBACK_CURRENCY_MISMATCH
```

Place the payment into a safe investigation state.

Do not perform implicit FX conversion.

---

# 55. Unknown Transaction Handling

If the callback cannot be correlated:

```text
CALLBACK_TRANSACTION_NOT_FOUND
```

Create:

```text
reconciliation investigation
```

rather than creating a new payment automatically.

---

# 56. Provider Reference Collision

If two internal records claim the same provider transaction ID:

```text
PROVIDER_REFERENCE_COLLISION
```

This is a high-priority financial integrity incident.

No new posting should occur until the collision is investigated.

---

# 57. Callback Security and Idempotency

The following should be treated as distinct controls:

```text
Signature verification
    !=
Replay prevention
    !=
Idempotency
    !=
State validation
```

All may be required.

A valid signature proves the provider signed the message.

It does not prove:

```text
the callback is new
the callback belongs to this payment
the amount is expected
the state transition is valid
```

---

# 58. Callback Correlation

Preferred correlation chain:

```text
providerEventId
      |
      v
providerTransactionId
      |
      v
internalPaymentId
      |
      v
financialTransactionId
      |
      v
journalId
      |
      v
tenantId
```

If any mapping is ambiguous, stop automatic processing.

---

# 59. Callback-to-Ledger Safety

The callback should never provide ledger account IDs directly.

Incorrect:

```json
{
  "debitAccountId": "..."
}
```

Correct:

```json
{
  "paymentId": "payment_01J...",
  "amount": "5500.00",
  "currency": "UGX",
  "status": "successful"
}
```

The financial domain determines the accounting mapping.

---

# 60. Callback-to-Loan Safety

A callback should identify the internal payment/operation.

The loan linkage must be retrieved internally:

```text
provider transaction
      |
      v
payment
      |
      v
loan
```

Do not trust:

```text
loanId
```

from an untrusted callback unless it is independently validated against the payment correlation.

---

# 61. Callback-to-Contribution Safety

Same rule:

```text
provider callback
      |
      v
payment
      |
      v
contribution
```

The callback itself must not be permitted to invent a new contribution.

---

# 62. Callback Processing Service

Recommended responsibilities:

```text
authenticateCallback()
verifySignature()
validateTimestamp()
detectReplay()
deduplicate()
normalizePayload()
validateSchema()
correlatePayment()
validateAmount()
validateCurrency()
validateStateTransition()
processPayment()
publishEvents()
recordAudit()
```

The service must not contain provider-specific signing logic for every provider in one monolithic method.

---

# 63. Provider-Specific Security Adapters

Recommended architecture:

```text
PaymentCallbackSecurity
        |
        +---- MtnCallbackSecurity
        |
        +---- AirtelCallbackSecurity
        |
        +---- BankCallbackSecurity
```

Each adapter exposes a normalized security result:

```json
{
  "authenticated": true,
  "provider": "mtn_momo",
  "providerEventId": "evt-123",
  "timestampValid": true,
  "signatureValid": true
}
```

---

# 64. Callback Registry

The callback registry should define:

```text
provider
endpoint
security adapter
signature strategy
timestamp strategy
normalizer
status mapper
rate-limit policy
payload-size policy
enabled state
```

Example conceptual configuration:

```json
{
  "provider": "mtn_momo",
  "enabled": true,
  "securityStrategy": "hmac",
  "replayWindowSeconds": 300,
  "maxBodyBytes": 131072
}
```

Actual provider-specific values must come from the provider contract.

---

# 65. Provider Configuration

Provider configuration should be separated from code.

Do not embed:

```text
client secret
callback secret
API key
private key
```

in source.

Configuration should support:

```text
environment
tenant/provider account
secret reference
enabled flag
callback policy
```

---

# 66. Secret Rotation Audit

Record security events when callback secrets are:

```text
created
rotated
disabled
expired
```

Example:

```text
PAYMENT_CALLBACK_SECRET_ROTATED
```

Never record the secret itself.

---

# 67. Callback Access Logging

Log only safe metadata:

```text
provider
route
status
requestId
providerEventId
payloadHash
signatureStatus
processingStatus
latencyMs
```

Avoid logging the full payload by default.

---

# 68. Security Logging

Create dedicated security audit events for:

```text
invalid_signature
expired_timestamp
replay_detected
duplicate_callback
unknown_provider_event
provider_reference_collision
amount_mismatch
currency_mismatch
invalid_state_transition
malformed_payload
oversized_payload
```

---

# 69. Security Metrics

Minimum metrics:

```text
payment_callbacks_received_total
payment_callbacks_authenticated_total
payment_callbacks_signature_failed_total
payment_callbacks_replay_detected_total
payment_callbacks_duplicate_total
payment_callbacks_validation_failed_total
payment_callbacks_unknown_transaction_total
payment_callbacks_amount_mismatch_total
payment_callbacks_currency_mismatch_total
payment_callbacks_processed_total
payment_callbacks_failed_total
payment_callbacks_dead_lettered_total
```

---

# 70. Security Alerts

Alert on:

```text
spike in signature failures
spike in replay attempts
provider reference collisions
large number of unknown transactions
large amount mismatch rate
abnormal callback volume
repeated invalid timestamps
suspicious source-network changes
dead-letter accumulation
```

Severity should be based on potential financial impact.

---

# 71. Callback Tracing

Trace:

```text
callback.receive
callback.authenticate
callback.verify_signature
callback.validate
callback.deduplicate
callback.normalize
callback.correlate
payment.process
finance.post
outbox.publish
reconciliation.create
```

Safe attributes:

```text
provider
providerEventId
internalPaymentId
tenantId
requestId
correlationId
status
```

Do not attach secrets.

---

# 72. Callback Database Model

Recommended callback record:

```text
PaymentCallback
-------------------------------
id
tenantId
provider
providerEventId
providerTransactionId
eventType
payloadHash
signatureStatus
timestampStatus
validationStatus
processingStatus
matchedPaymentId
financialTransactionId
receivedAt
processedAt
attemptCount
lastErrorCode
lastErrorMessage
createdAt
updatedAt
```

---

# 73. Callback Uniqueness

Recommended uniqueness:

```text
(provider, providerEventId)
```

Where provider event IDs are not guaranteed unique, use a provider-specific compound key such as:

```text
(provider, providerTransactionId, eventType)
```

or another documented deterministic fingerprint.

---

# 74. Callback Payload Fingerprint

For providers without stable event IDs:

```text
SHA-256(
  canonicalProvider
  +
  canonicalTransactionReference
  +
  canonicalStatus
  +
  canonicalAmount
  +
  canonicalTimestamp
)
```

The exact fingerprint algorithm should be provider-specific and documented.

Do not assume the payload hash alone is sufficient for deduplication when benign retries can vary timestamps or metadata.

---

# 75. Canonicalization

Canonicalization should be implemented only where required.

Do not invent canonicalization rules for cryptographic verification.

For internal fingerprinting, define:

```text
field order
field normalization
whitespace behavior
case normalization
timestamp normalization
numeric normalization
```

and test with real provider fixtures.

---

# 76. Callback Fixture Testing

Maintain sanitized test fixtures for:

```text
successful callback
failed callback
pending callback
duplicate callback
replay callback
invalid signature
invalid timestamp
amount mismatch
currency mismatch
unknown transaction
malformed payload
out-of-order callback
```

Never commit production secrets into fixtures.

---

# 77. Security Unit Tests

Test:

```text
valid signature
invalid signature
wrong secret
wrong algorithm
altered body
expired timestamp
future timestamp
replayed event
duplicate event
invalid provider ID
```

---

# 78. Security Integration Tests

Test:

```text
callback -> security middleware
callback -> processing engine
callback -> payment state
callback -> ledger posting
callback -> outbox
callback -> audit
```

Verify that invalid callbacks produce zero financial side effects.

---

# 79. Negative Security Test

Given:

```text
Valid providerTransactionId
Valid callback structure
Invalid signature
```

Expected:

```text
HTTP acknowledgement according to provider policy
NO payment state mutation
NO financial transaction
NO ledger posting
NO success event
Security audit/metric recorded
```

---

# 80. Replay Test

Send the exact same callback twice.

Expected:

```text
First:
  processed

Second:
  duplicate/replay detected
  no second financial effect
```

---

# 81. Amount Tampering Test

Original payment:

```text
5500 UGX
```

Callback altered to:

```text
550000 UGX
```

Expected:

```text
callback rejected/held
no ledger posting
reconciliation exception
security telemetry
```

---

# 82. Currency Tampering Test

Original:

```text
UGX
```

Callback:

```text
USD
```

Expected:

```text
callback rejected/held
no ledger posting
reconciliation exception
```

---

# 83. Status Tampering Test

If an internal payment is:

```text
reversed
```

and callback states:

```text
successful
```

Expected:

```text
invalid state transition
no downgrade
manual/reconciliation investigation
```

---

# 84. Tenant Isolation Test

A malicious callback must not be able to provide:

```text
tenantId
```

and redirect the operation to another tenant.

Expected:

```text
tenant derived from matched payment
```

not:

```text
tenant derived from callback body
```

---

# 85. Provider Credential Compromise Scenario

If callback signing credentials are suspected compromised:

```text
1. Disable affected callback credentials if provider supports it.
2. Rotate secrets.
3. Enable temporary additional verification.
4. Review recent callback traffic.
5. Review successful callback financial effects.
6. Reconcile affected transactions.
7. Search for replay/forgery patterns.
8. Record security incident.
9. Restore normal processing after validation.
```

---

# 86. Callback Endpoint Availability

Callback endpoints should be highly available because providers may retry failed deliveries.

However:

> Availability must never override authentication and financial integrity controls.

It is better to reject a forged callback than to accept it merely to return `200 OK`.

---

# 87. Callback Backpressure

When downstream services are unavailable:

```text
Provider
   |
   v
Callback Endpoint
   |
   v
Authenticate
   |
   v
Persist Durable Callback
   |
   v
Return provider-compatible acknowledgement
   |
   v
Asynchronous Processing
```

This can reduce provider timeout pressure while preserving the callback for processing.

The exact acknowledgement behavior must comply with provider requirements.

---

# 88. Durable Callback Ingestion

Where callback processing may be asynchronous, persist a durable callback record after security validation and before returning success when the provider protocol permits.

State:

```text
RECEIVED
```

Then process asynchronously:

```text
RECEIVED
  |
  v
VALIDATED
  |
  v
PROCESSING
  |
  v
PROCESSED
```

---

# 89. Callback Queue Security

If callbacks are queued:

```text
callback endpoint
      |
      v
durable queue
      |
      v
callback worker
```

Queue messages must carry:

```text
callbackId
provider
eventId
processing metadata
```

Do not rely on the queue as the only security layer.

The callback must already be authenticated before becoming an accepted business-processing message.

---

# 90. Callback Worker Idempotency

Workers must re-check:

```text
processing status
event ID
payment state
financial transaction state
```

before applying side effects.

A worker crash after posting but before acknowledging must not cause another posting.

---

# 91. Financial Transaction Linkage

A successful callback should eventually resolve to:

```text
Provider Callback
      |
      v
Payment
      |
      v
Financial Transaction
      |
      v
Journal
      |
      v
Ledger
```

Missing linkage at any stage should generate an operational alert.

---

# 92. Payment Callback to Ledger Rule

The final authorization to post must remain with the financial subsystem.

The callback security layer says:

```text
"Is this callback authentic and valid enough to consider?"
```

The financial layer says:

```text
"Does this callback cause a legitimate financial transition?"
```

These are separate responsibilities.

---

# 93. Callback Failure Isolation

A callback failure must not corrupt:

```text
another payment
another tenant
another financial transaction
another provider
```

Failures must remain scoped to the callback operation.

---

# 94. Provider-Specific Failure Isolation

A failure in:

```text
MTN callback processing
```

must not automatically disable:

```text
Airtel callback processing
```

unless an explicit global financial safety control has been activated.

Provider adapters should be independently observable.

---

# 95. Circuit Breaker Considerations

For provider status lookups triggered by callbacks, use bounded timeouts and circuit breakers where appropriate.

The callback processor should not create unbounded dependency chains.

Example:

```text
Callback
  |
  +--> Signature verification
  |
  +--> Payment lookup
  |
  +--> Provider status lookup where necessary
```

All external calls must have strict timeouts.

---

# 96. Timeout Policy

Every provider-dependent operation should define:

```text
connect timeout
request timeout
retry policy
maximum attempts
```

A timeout must move processing into a recoverable state.

---

# 97. Callback Retry Policy

Retries should be limited and classified:

```text
Transient:
network timeout
temporary database failure
temporary queue failure

Permanent:
invalid signature
malformed payload
unknown provider
invalid schema
```

Permanent security failures should not be retried indefinitely.

---

# 98. Dead-Letter Policy

Callbacks that repeatedly fail processing should be moved to:

```text
DEAD_LETTER
```

A dead-letter callback must preserve:

```text
callbackId
provider
providerEventId
paymentId where known
failure reason
attempt count
timestamps
```

Manual or automated recovery must be controlled.

---

# 99. Dead-Letter Recovery

Recovery must:

```text
inspect failure
determine root cause
fix underlying issue
reprocess with same logical callback identity
preserve idempotency
audit recovery
```

Do not create a new provider transaction solely to compensate for an internal callback processing failure.

---

# 100. Callback Security and Reconciliation

Every callback processing pipeline must converge on reconciliation.

Example:

```text
Provider Says SUCCESS
       |
       v
Internal Payment = PROCESSING
       |
       v
Security passes
       |
       v
Financial Posting
       |
       v
Payment = SUCCESSFUL
       |
       v
Reconciliation Match
```

If internal state cannot safely converge, create an exception.

---

# 101. Callback Integrity Exception Catalogue

Recommended exceptions:

```text
CALLBACK_SIGNATURE_INVALID
CALLBACK_TIMESTAMP_INVALID
CALLBACK_REPLAY_DETECTED
CALLBACK_DUPLICATE
CALLBACK_SCHEMA_INVALID
CALLBACK_TRANSACTION_NOT_FOUND
CALLBACK_REFERENCE_MISMATCH
CALLBACK_AMOUNT_MISMATCH
CALLBACK_CURRENCY_MISMATCH
CALLBACK_STATE_TRANSITION_INVALID
CALLBACK_PROVIDER_UNKNOWN
CALLBACK_PROVIDER_REFERENCE_COLLISION
CALLBACK_FINANCIAL_POSTING_FAILED
CALLBACK_RECONCILIATION_REQUIRED
```

---

# 102. Security Response Matrix

| Failure                  | Financial Effect    | Action                    |
| ------------------------ | ------------------- | ------------------------- |
| Invalid signature        | None                | Reject + security alert   |
| Expired timestamp        | None                | Reject/hold               |
| Replay                   | None                | Deduplicate               |
| Duplicate valid callback | None additional     | Acknowledge safely        |
| Unknown transaction      | None                | Reconciliation            |
| Amount mismatch          | None                | Hold + investigate        |
| Currency mismatch        | None                | Hold + investigate        |
| Invalid state transition | None                | Reject/hold               |
| Ledger posting failure   | None or pending     | Retry controlled workflow |
| Consumer failure         | No duplicate effect | Retry                     |
| Dead-letter              | No automatic effect | Controlled recovery       |

---

# 103. Provider Callback Security Headers

The exact headers are provider-specific.

Document each provider's expected headers separately:

```text
Provider
Signature Header
Timestamp Header
Event ID Header
Request ID Header
Content Type
Authentication Scheme
Canonicalization Rules
Replay Window
```

Never infer a header's security meaning merely from its name.

---

# 104. MTN MoMo Security Boundary

The MTN adapter must own the provider-specific implementation for:

```text
authentication/signature verification
callback headers
provider event ID extraction
provider transaction reference extraction
status mapping
timestamp handling
payload normalization
```

The normalized output is passed into the shared callback processing engine.

Provider credentials must remain in secure configuration.

---

# 105. Airtel Money Security Boundary

The Airtel adapter must own:

```text
Airtel-specific authentication
signature verification
headers
event identification
provider reference extraction
status normalization
timestamp handling
payload mapping
```

Do not duplicate Airtel security logic inside the generic payment service.

---

# 106. Shared Callback Security Service

A shared abstraction may expose:

```text
authenticate()
verifySignature()
validateTimestamp()
checkReplay()
deduplicate()
normalize()
validateBusinessContext()
```

Provider-specific cryptography must remain encapsulated by the corresponding provider adapter.

---

# 107. Callback Security Configuration

Recommended configuration structure:

```text
callbackSecurity:
  enabled
  maxBodySize
  replayWindow
  timestampTolerance
  requireSignature
  requireTimestamp
  rateLimit
  duplicatePolicy
  rawBodyRequired
```

Provider overrides:

```text
providers:
  mtn:
    securityProfile: ...
  airtel:
    securityProfile: ...
```

Secrets should be referenced, not embedded.

---

# 108. Secret Configuration Example

Safe conceptual example:

```text
MTN_CALLBACK_SECRET_REF=secret/payment/mtn/callback
AIRTEL_CALLBACK_SECRET_REF=secret/payment/airtel/callback
```

Do not document actual secret values.

---

# 109. Production Security Checklist

## Transport

* [ ] HTTPS enforced.
* [ ] TLS configuration reviewed.
* [ ] Trusted proxy configuration correct.
* [ ] WAF/gateway protection configured where appropriate.

## Authentication

* [ ] Provider signature verification implemented.
* [ ] Signature comparison uses constant-time behavior.
* [ ] Provider credentials stored securely.
* [ ] Secret rotation supported.

## Replay Protection

* [ ] Timestamp validation implemented where supported.
* [ ] Nonce validation implemented where supported.
* [ ] Provider event IDs deduplicated.
* [ ] Callback fingerprints available where needed.

## Validation

* [ ] Content type validated.
* [ ] Payload size limited.
* [ ] Schema validation implemented.
* [ ] Amount validated.
* [ ] Currency validated.
* [ ] Provider reference validated.
* [ ] State transition validated.
* [ ] Tenant derived internally.

## Financial Safety

* [ ] Callback cannot directly mutate balances.
* [ ] Callback cannot directly create arbitrary ledger entries.
* [ ] Payment lookup required.
* [ ] Financial posting goes through Posting Engine.
* [ ] Ledger posting is idempotent.
* [ ] Reversals use controlled financial operations.

## Observability

* [ ] Security metrics implemented.
* [ ] Callback metrics implemented.
* [ ] Request IDs propagated.
* [ ] Distributed tracing supported.
* [ ] Security audit events implemented.
* [ ] Sensitive payloads redacted.

## Reliability

* [ ] Durable callback ingestion available where appropriate.
* [ ] Retry policy implemented.
* [ ] Dead-letter processing implemented.
* [ ] Provider retry behavior understood.
* [ ] Unknown outcome handling implemented.
* [ ] Reconciliation integrated.

---

# 110. Security Test Checklist

* [ ] Invalid signature rejected.
* [ ] Altered payload rejected.
* [ ] Wrong secret rejected.
* [ ] Expired callback rejected.
* [ ] Replay rejected.
* [ ] Duplicate callback does not duplicate posting.
* [ ] Amount tampering detected.
* [ ] Currency tampering detected.
* [ ] Reference mismatch detected.
* [ ] Cross-tenant callback blocked.
* [ ] Invalid state transition blocked.
* [ ] Unknown transaction held.
* [ ] Oversized payload rejected.
* [ ] Malformed JSON rejected.
* [ ] Queue replay remains idempotent.
* [ ] Dead-letter recovery remains idempotent.
* [ ] Financial ledger remains balanced.
* [ ] No sensitive secret appears in logs.

---

# 111. Incident Response Procedure

For suspected forged callbacks:

```text
1. Activate callback security incident.
2. Preserve callback metadata and hashes.
3. Determine affected provider.
4. Review signature failures.
5. Review replay attempts.
6. Review successful callbacks during the suspected window.
7. Reconcile affected payments.
8. Verify ledger effects.
9. Rotate credentials if compromise is suspected.
10. Enable additional protective controls.
11. Investigate all anomalous financial postings.
12. Produce incident audit record.
13. Restore normal processing after validation.
14. Implement preventive control changes.
```

---

# 112. Security Incident Evidence

Preserve:

```text
callbackId
provider
providerEventId
providerTransactionId
payloadHash
receivedAt
signatureStatus
timestampStatus
source network information where appropriate
requestId
processing result
financialTransactionId
journalId
audit event ID
```

Do not preserve secrets as incident evidence.

---

# 113. Production Callback Readiness Standard

A provider callback integration is production-ready only when:

```text
Provider contract verified
Security scheme verified
Signature verification tested
Timestamp/replay protection tested
Provider credentials securely stored
Secret rotation procedure defined
Payload schema validated
Deduplication implemented
Internal payment correlation implemented
Amount/currency validation implemented
State transition validation implemented
Tenant derivation verified
Financial posting isolated
Ledger idempotency verified
Audit logging verified
Metrics verified
Tracing verified
Retry policy verified
Dead-letter recovery verified
Reconciliation verified
Security incident procedure documented
```

---

# 114. Golden Callback Security Path

The complete secure callback path is:

```text
              PROVIDER
                  |
                  v
           HTTPS / TLS
                  |
                  v
          Callback Endpoint
                  |
                  v
        Raw Request Capture
                  |
                  v
      Signature Verification
                  |
          +-------+-------+
          |               |
        FAIL             PASS
          |               |
          v               v
       Reject       Timestamp Check
                          |
                    +-----+-----+
                    |           |
                  FAIL         PASS
                    |           |
                    v           v
                 Reject      Replay Check
                                |
                          +-----+-----+
                          |           |
                        REPLAY       NEW
                          |           |
                          v           v
                       Ignore     Schema Check
                                      |
                                      v
                                Deduplication
                                      |
                                      v
                                  Normalize
                                      |
                                      v
                             Internal Correlation
                                      |
                                      v
                            Amount / Currency
                                  Validation
                                      |
                                      v
                             State Validation
                                      |
                                      v
                              Payment Service
                                      |
                                      v
                             Posting Engine
                                      |
                                      v
                                   Ledger
                                      |
                           +----------+----------+
                           |                     |
                           v                     v
                         Audit                Outbox
                                                 |
                                                 v
                                              Events
                                                 |
                                                 v
                                           Reconciliation
```

---

# 115. Final Security Principle

> **A payment callback is an external assertion, not an instruction to change the ledger.**

The platform may rely on a callback only after it has:

```text
authenticated the provider
+
verified integrity
+
checked freshness/replay
+
deduplicated
+
validated structure
+
correlated the payment
+
validated amount/currency
+
validated state transition
+
applied internal financial controls
+
committed the authoritative ledger effect
```

The payment callback security subsystem must therefore remain separate from, but tightly integrated with, the payment and financial domains.

---

# 116. Non-Negotiable Financial Security Rule

> **No callback — regardless of provider, signature validity, status, amount, or apparent success — may directly mutate a customer balance, loan balance, journal, journal entry, or authoritative ledger state. Every callback must pass through the secure callback processing pipeline and the approved financial posting architecture.**

---

# 117. Related Documentation

This specification should remain synchronized with:

```text
docs/finance/FINANCIAL_LEDGER_SPECIFICATION.md
docs/finance/GOLDEN_MONEY_PATH.md
docs/events/EVENT_CATALOGUE.md
docs/data/DATA_MODEL_CATALOGUE.md
docs/api/API_CATALOGUE.md
docs/api/BACKEND_API_SPECIFICATION.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/DEPENDENCY_MAP.md
```

Provider-specific implementation documentation should additionally cover:

```text
MTN MoMo callback contract
Airtel Money callback contract
Bank settlement/webhook contract
```

---

# 118. Document Metadata

**Document:** `docs/security/PAYMENT_CALLBACK_SECURITY.md`
**Organization:** TITech Community Capital Ltd
**Platform:** Community Savings Platform
**Domain:** Payment Callback Security
**Version:** `2.0`
**Status:** Enterprise Production Security Architecture Standard
**Last Updated:** August 16, 2026

**Primary Example User**

```text
Name: Justine Robert
Email: justine@titech.com
```

## Maintenance Requirement

> Any change to provider callback authentication, signatures, callback routes, payload schemas, replay protection, idempotency, provider adapters, payment state transitions, settlement handling, or financial callback processing must update this document together with the applicable payment, finance, event, API, service, and security documentation.

## Final Authority

> **External callbacks provide evidence of provider activity. The TITech financial system remains authoritative for internal financial state. Callback processing must always terminate in a controlled, validated, idempotent, auditable financial outcome rather than directly altering financial records.**