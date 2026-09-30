'use strict';

const crypto = require('node:crypto');
const {
  encryptSecret,
  decryptSecret,
  generateWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
} = require('../../../modules/payroll/payroll.crypto.cjs');

describe('TITech payroll webhook crypto', () => {
  beforeEach(() => {
    process.env.TITECH_WEBHOOK_SECRET_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  });

  afterAll(() => {
    delete process.env.TITECH_WEBHOOK_SECRET_ENCRYPTION_KEY;
  });

  test('encrypts and decrypts employer secrets without exposing plaintext storage', () => {
    const secret = generateWebhookSecret();
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  test('signs and verifies timestamp-bound webhook payloads', () => {
    const secret = generateWebhookSecret();
    const timestamp = new Date().toISOString();
    const payload = { eventType: 'BATCH_PROCESSED', employerId: 'tenant-1' };
    const signature = signWebhookPayload(secret, timestamp, payload);
    expect(verifyWebhookSignature(secret, timestamp, payload, signature)).toBe(true);
    expect(verifyWebhookSignature(secret, timestamp, { ...payload, employerId: 'tenant-2' }, signature)).toBe(false);
  });
});
