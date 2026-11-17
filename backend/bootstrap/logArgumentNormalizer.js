/**
 * Small, dependency-free safety layer for Pino-compatible log calls.
 * Supports both the historical message-first call form and Pino's canonical
 * object-first form without allowing context metadata to shift arguments.
 */

const SECRET_KEYS = new Set([
  'password', 'passwd', 'passcode', 'pin', 'otp', 'secret', 'accesssecret',
  'refreshsecret', 'sessionsecret', 'jwtsecret', 'token', 'accesstoken',
  'refreshtoken', 'idtoken', 'authorization', 'cookie', 'setcookie',
  'apikey', 'clientsecret', 'encryptionkey', 'privatekey', 'credentials',
  'databaseuri', 'databaseurl', 'mongouri', 'mongodburi', 'redisurl',
  'connectionstring', 'cardnumber', 'cvv', 'cvc', 'accountpassword',
]);

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSensitiveKey(key, sensitiveKeys) {
  const normalized = normalizeKey(key);
  return sensitiveKeys.has(normalized) ||
    /(?:password|passwd|passcode|secret|token|authorization|cookie|apikey|privatekey|encryptionkey|credentials|connectionstring|databaseuri|databaseurl|mongouri|mongodburi|redisurl)$/.test(normalized);
}

function redactString(value, depth = 0) {
  let output = String(value);

  // Remove user-info from common database/cache URLs before anything is logged.
  output = output.replace(
    /\b((?:mongodb(?:\+srv)?|rediss?|postgres(?:ql)?|mysql):\/\/)[^\s/@]+@/gi,
    '$1[REDACTED]@',
  );

  // Protect credentials embedded in connection-string query parameters.
  output = output.replace(
    /([?&](?:password|passwd|secret|token|access_token|refresh_token|api[_-]?key|client[_-]?secret|authorization)=)[^&#\s]*/gi,
    `$1${REDACTED}`,
  );
  output = output.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, `Bearer ${REDACTED}`);
  output = output.replace(
    /(^|[\s,{;])(["']?)([A-Z0-9_]*(?:PASSWORD|PASSWD|PASSCODE|PIN|OTP|SECRET|TOKEN|AUTHORIZATION|COOKIE|API[_-]?KEY|CLIENT[_-]?SECRET|ENCRYPTION[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIALS|(?:MONGO(?:DB)?|REDIS|DATABASE)[_-]?(?:URI|URL)|CONNECTION[_-]?STRING)[A-Z0-9_]*)(?:\2)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
    (_match, prefix, quote, key) => `${prefix}${quote}${key}${quote}=${REDACTED}`,
  );

  // Configuration objects are sometimes stringified before they reach a logger.
  // Parse only JSON-looking strings and recursively redact their fields.
  if (depth < 2) {
    const trimmed = output.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(redactSensitiveLogValue(parsed, { depth: depth + 1 }));
      } catch {
        // Keep ordinary text; URI/token redaction above still applies.
      }
    }
  }

  return output;
}

/** Convert arbitrary values into bounded, JSON-safe data with secret redaction. */
export function redactSensitiveLogValue(value, options = {}) {
  const seen = options.seen instanceof WeakSet ? options.seen : new WeakSet();
  const depth = Number.isInteger(options.depth) ? options.depth : 0;
  const sensitiveKeys = options.sensitiveKeys instanceof Set
    ? options.sensitiveKeys
    : SECRET_KEYS;

  const visit = (current, level) => {
    if (current === null || current === undefined) return current;
    if (typeof current === 'string') return redactString(current, level);
    if (typeof current === 'number' || typeof current === 'boolean') return current;
    if (typeof current === 'bigint') return current.toString();
    if (typeof current === 'function') return '[function]';
    if (typeof current === 'symbol') return '[symbol]';
    if (level >= MAX_DEPTH) return '[max-depth]';

    if (current instanceof Error) {
      if (seen.has(current)) return '[circular]';
      seen.add(current);
      return {
        type: current.constructor?.name || 'Error',
        name: redactString(current.name || 'Error', level + 1),
        message: redactString(current.message || '', level + 1),
        ...(current.code !== undefined ? { code: visit(current.code, level + 1) } : {}),
        ...(current.statusCode !== undefined ? { statusCode: current.statusCode } : {}),
        ...(current.phase !== undefined ? { phase: visit(current.phase, level + 1) } : {}),
        ...(current.component !== undefined ? { component: visit(current.component, level + 1) } : {}),
        ...(current.stack ? { stack: redactString(current.stack, level + 1) } : {}),
        ...(current.cause ? { cause: visit(current.cause, level + 1) } : {}),
      };
    }

    if (Array.isArray(current)) {
      if (seen.has(current)) return '[circular]';
      seen.add(current);
      return current.map((entry) => visit(entry, level + 1));
    }

    if (typeof current === 'object') {
      if (seen.has(current)) return '[circular]';
      seen.add(current);
      const result = {};
      for (const [key, child] of Object.entries(current)) {
        if (isSensitiveKey(key, sensitiveKeys)) {
          result[key] = REDACTED;
        } else {
          try {
            result[key] = visit(child, level + 1);
          } catch {
            result[key] = '[unserializable]';
          }
        }
      }
      return result;
    }

    return '[unserializable]';
  };

  return visit(value, depth);
}

/**
 * Normalize logger arguments to Pino's (object, message, ...args) convention.
 * Both logger.info('message', metadata) and logger.info(metadata, 'message')
 * are supported. An Error is emitted under the conventional `err` property.
 */
export function normalizePinoArguments(args = [], context = {}) {
  const input = Array.isArray(args) ? [...args] : [args];
  const safeContext = isPlainObject(redactSensitiveLogValue(context))
    ? redactSensitiveLogValue(context)
    : {};

  const mergeMetadata = (...sources) => {
    const merged = Object.assign({}, safeContext, ...sources.filter(isPlainObject));
    return redactSensitiveLogValue(merged);
  };
  const sanitizeExtra = (value) => redactSensitiveLogValue(value);

  if (input.length === 0) {
    return Object.keys(safeContext).length ? [safeContext] : [];
  }

  const [first, second, ...remaining] = input;

  if (first instanceof Error) {
    const metadata = mergeMetadata({ err: first });
    if (typeof second === 'string') {
      return [metadata, sanitizeExtra(second), ...remaining.map(sanitizeExtra)];
    }
    return [metadata, ...(second === undefined ? [] : [sanitizeExtra(second)]), ...remaining.map(sanitizeExtra)];
  }

  if (isPlainObject(first)) {
    const metadata = mergeMetadata(first);
    if (typeof second === 'string') {
      return [metadata, sanitizeExtra(second), ...remaining.map(sanitizeExtra)];
    }
    return [metadata, ...(second === undefined ? [] : [sanitizeExtra(second)]), ...remaining.map(sanitizeExtra)];
  }

  if (typeof first === 'string') {
    if (isPlainObject(second)) {
      return [mergeMetadata(second), sanitizeExtra(first), ...remaining.map(sanitizeExtra)];
    }
    if (second instanceof Error) {
      return [mergeMetadata({ err: second }), sanitizeExtra(first), ...remaining.map(sanitizeExtra)];
    }
    if (Object.keys(safeContext).length) {
      return [safeContext, sanitizeExtra(first), ...(second === undefined ? [] : [sanitizeExtra(second)]), ...remaining.map(sanitizeExtra)];
    }
    return [sanitizeExtra(first), ...(second === undefined ? [] : [sanitizeExtra(second)]), ...remaining.map(sanitizeExtra)];
  }

  if (first === undefined || first === null) {
    return Object.keys(safeContext).length
      ? [safeContext, ...(second === undefined ? [] : [sanitizeExtra(second)]), ...remaining.map(sanitizeExtra)]
      : (second === undefined ? [] : [sanitizeExtra(second), ...remaining.map(sanitizeExtra)]);
  }

  // Preserve primitive Pino interpolation and keep context in a separate
  // first argument rather than coercing values into object properties.
  if (Object.keys(safeContext).length) {
    return [safeContext, sanitizeExtra(first), ...(second === undefined ? [] : [sanitizeExtra(second)]), ...remaining.map(sanitizeExtra)];
  }
  return [sanitizeExtra(first), ...(second === undefined ? [] : [sanitizeExtra(second)]), ...remaining.map(sanitizeExtra)];
}

export default Object.freeze({ normalizePinoArguments, redactSensitiveLogValue });
