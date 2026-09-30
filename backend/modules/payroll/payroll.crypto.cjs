'use strict';

const crypto = require('node:crypto');

const {
  WEBHOOK_TIMESTAMP_TOLERANCE_MS,
} = require('./payroll.constants.cjs');
const { PayrollError } = require('./payroll.errors.cjs');

const SECRET_ALGORITHM = 'aes-256-gcm';
const SECRET_VERSION = 'v1';

function getEncryptionKey() {
  const raw = process.env.TITECH_WEBHOOK_SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new PayrollError(
      'PAYROLL_SECRET_KEY_MISSING',
      'Webhook secret encryption is not configured.',
      503,
    );
  }

  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (key.length !== 32) {
    throw new PayrollError(
      'PAYROLL_SECRET_KEY_INVALID',
      'Webhook secret encryption key must represent exactly 32 bytes.',
      503,
    );
  }

  return key;
}

function encryptSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new PayrollError(
      'PAYROLL_SECRET_INVALID',
      'Webhook secret must be a high-entropy value.',
      400,
    );
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(SECRET_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    SECRET_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function decryptSecret(payload) {
  if (typeof payload !== 'string') {
    throw new PayrollError('PAYROLL_SECRET_INVALID', 'Stored webhook secret is invalid.', 500);
  }

  const [version, ivPart, tagPart, ciphertextPart] = payload.split('.');
  if (version !== SECRET_VERSION || !ivPart || !tagPart || !ciphertextPart) {
    throw new PayrollError('PAYROLL_SECRET_INVALID', 'Stored webhook secret format is invalid.', 500);
  }

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    SECRET_ALGORITHM,
    key,
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function generateWebhookSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function signWebhookPayload(secret, timestamp, payload) {
  const body = `${timestamp}.${JSON.stringify(payload)}`;
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

function verifyWebhookSignature(secret, timestamp, payload, signature, toleranceMs = WEBHOOK_TIMESTAMP_TOLERANCE_MS) {
  if (!secret || !timestamp || !signature) return false;
  const parsedTimestamp = Date.parse(timestamp);
  if (!Number.isFinite(parsedTimestamp)) return false;
  if (Math.abs(Date.now() - parsedTimestamp) > toleranceMs) return false;

  const expected = signWebhookPayload(secret, timestamp, payload);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(String(signature), 'utf8');
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

module.exports = {
  encryptSecret,
  decryptSecret,
  generateWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
};
