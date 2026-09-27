// backend/utils/webhookSecurity.cjs

const crypto = require('crypto');

const DEFAULT_REPLAY_WINDOW_MS = 5 * 60 * 1000;

function timingSafeHexCompare(expectedHex, suppliedSignature) {
  if (typeof suppliedSignature !== 'string') return false;

  const normalized = suppliedSignature.trim().replace(/^sha256=/i, '');
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return false;

  const expected = Buffer.from(expectedHex, 'hex');
  const supplied = Buffer.from(normalized, 'hex');

  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

class WebhookSecurity {
  static validateSignature(payload, signature, secret, rawBody = undefined) {
    if (!secret || !signature) return false;

    const body = rawBody !== undefined && rawBody !== null
      ? (Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'))
      : Buffer.from(JSON.stringify(payload ?? {}), 'utf8');

    const hash = crypto.createHmac('sha256', String(secret)).update(body).digest('hex');
    return timingSafeHexCompare(hash, signature);
  }

  static preventReplayAttack(timestamp, windowMs = DEFAULT_REPLAY_WINDOW_MS) {
    const numeric = Number(timestamp);
    if (!Number.isFinite(numeric) || numeric <= 0) return false;

    const timestampMs = numeric < 1e11 ? numeric * 1000 : numeric;
    return Math.abs(Date.now() - timestampMs) <= windowMs;
  }
}

module.exports = WebhookSecurity;
