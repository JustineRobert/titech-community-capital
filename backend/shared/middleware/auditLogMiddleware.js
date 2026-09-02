//  backend/shared/middleware/auditLogMiddleware.js

'use strict';

const crypto = require('crypto');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

const SENSITIVE_FIELDS = [
'password',
'confirmPassword',
'pin',
'otp',
'accessToken',
'refreshToken',
'token',
'secret',
'privateKey'
];

/**

* Generate SHA256 hash
  */
  function generateHash(data) {
  return crypto
  .createHash('sha256')
  .update(data)
  .digest('hex');
  }

/**

* Recursively redact sensitive fields
  */
  function sanitizePayload(data) {
  if (!data || typeof data !== 'object') {
  return data;
  }

if (Array.isArray(data)) {
return data.map(sanitizePayload);
}

const sanitized = {};

for (const key of Object.keys(data)) {
if (SENSITIVE_FIELDS.includes(key)) {
sanitized[key] = '[REDACTED]';
continue;
}

```
sanitized[key] =
  typeof data[key] === 'object'
    ? sanitizePayload(data[key])
    : data[key];
```

}

return sanitized;
}

/**

* Audit Middleware
*
* Usage:
*
* router.post(
* '/deposit',
* auditLog('SAVINGS_DEPOSIT'),
* controller.deposit
* );
  */
  module.exports = function auditLog(action) {
  return async (req, res, next) => {
  const startTime = Date.now();

  /**

  * Run after response finishes
    */
    res.on('finish', async () => {
    try {
    const tenantId =
    req.user?.tenantId ||
    req.tenantId ||
    null;

    const userId =
    req.user?.id ||
    req.user?._id ||
    null;

    const timestamp = new Date();

    /**

    * Previous blockchain-style hash
      */
      const previousLog = await AuditLog
      .findOne()
      .sort({ createdAt: -1 })
      .select('hash');

    const previousHash =
    previousLog?.hash || null;

    const payload = {
    tenantId,
    userId,
    role: req.user?.role || null,

    action,

    method: req.method,
    path: req.originalUrl,

    ip:
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress,

    userAgent:
    req.headers['user-agent'] || null,

    query: sanitizePayload(req.query),
    params: sanitizePayload(req.params),
    body: sanitizePayload(req.body),

    statusCode: res.statusCode,

    durationMs:
    Date.now() - startTime,

    timestamp
    };

    const currentHash = generateHash(
    JSON.stringify(payload) +
    (previousHash || '')
    );

    await AuditLog.create({
    tenantId,
    userId,

    role: payload.role,
    action,

    method: payload.method,
    path: payload.path,

    ip: payload.ip,
    userAgent: payload.userAgent,

    query: payload.query,
    params: payload.params,
    body: payload.body,

    statusCode: payload.statusCode,

    durationMs: payload.durationMs,

    previousHash,
    hash: currentHash,

    timestamp
    });
    } catch (error) {
    logger.error(
    '[AUDIT_LOG_ERROR]',
    error
    );

    /**

    * Never break business flow
    * if audit logging fails.
      */
      }
      });

  next();
  };
  };
