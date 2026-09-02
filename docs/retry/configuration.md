# Retry Configuration


Configuration is loaded through enterprise runtime configuration.


Example:


```javascript
{
 retry:{
 
   enabled:true,

   defaultPolicy:"externalApiPolicy",

   retries:5,

   timeout:60000,

   strategy:"adaptive",

   jitter:"decorrelated",

   tracing:true,

   metrics:true,

   gracefulShutdown:true

 }
}



Configuration Rules
Retries

Controls maximum retry attempts.

Example:

retries:5
Timeout

Maximum execution duration.

Example:

timeout:60000
Deadline

Retry operations must respect upstream deadlines.

Idempotency

Required for:

payments
transfers
ledger operations

---

# 17.3 — docs/retry/policies.md

```markdown
# Retry Policies


Policies define retry behavior per dependency.


## Available Policies


## databasePolicy

Used for:

- MongoDB
- Mongoose


Example:


Retries:5
Strategy:decorrelated



## redisPolicy

Used for:

- cache
- sessions
- queues


## paymentGatewayPolicy

Used for:

- MTN MoMo
- Airtel Money


Requirements:

- Idempotency key
- Transaction reference


## webhookPolicy

Used for:

- external callbacks


## notificationPolicy

Used for:

- email
- SMS
- push


## externalApiPolicy

Used for:

- third-party APIs