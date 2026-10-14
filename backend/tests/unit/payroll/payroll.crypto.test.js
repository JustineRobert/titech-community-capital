'use strict';

// ============================================================================
// TITech Community Capital
// backend/tests/unit/payroll/payroll.crypto.test.js
//
// Payroll Cryptography Security Tests
// ============================================================================
// Coverage:
// - Secure webhook-secret generation
// - Secret encryption and decryption
// - Randomized ciphertext for identical plaintext
// - Encryption-key validation and missing-key behavior
// - Wrong-key rejection
// - Tampered and malformed ciphertext rejection
// - Webhook HMAC signing and signature verification
// - Payload and timestamp integrity
// - Wrong-secret and malformed-signature rejection
// - Environment-variable cleanup
//
// SECURITY CONTRACT:
// - Employer webhook secrets must not be stored as plaintext.
// - Encryption must fail closed when its key is unavailable.
// - Ciphertext tampering and incorrect encryption keys must be rejected.
// - Webhook verification must reject modified payloads, timestamps,
//   signing secrets, and malformed signatures.
//
// These tests exercise the real production module. They do not mock or
// replace its cryptographic implementation.
// ============================================================================

const crypto = require('node:crypto');

const ENCRYPTION_KEY_ENV =
  'TITECH_WEBHOOK_SECRET_ENCRYPTION_KEY';

// Preserve the caller's original environment instead of unconditionally
// deleting a potentially pre-existing configuration value.
const ORIGINAL_ENCRYPTION_KEY = process.env[ENCRYPTION_KEY_ENV];

const {
  encryptSecret,
  decryptSecret,
  generateWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
} = require('../../../modules/payroll/payroll.crypto.cjs');

// ============================================================================
// TEST HELPERS
// ============================================================================

function setTestEncryptionKey() {
  // 32 bytes encoded as 64 hexadecimal characters.
  // Use a new key for each test to avoid shared test-key assumptions.
  process.env[ENCRYPTION_KEY_ENV] =
    crypto.randomBytes(32).toString('hex');
}

function createWebhookPayload(overrides = {}) {
  return {
    eventType: 'BATCH_PROCESSED',
    employerId: 'tenant-1',
    batchId: 'payroll-batch-001',
    currency: 'UGX',
    ...overrides,
  };
}

function alterString(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(
      'Expected a non-empty string to alter during a tampering test.'
    );
  }

  const index = Math.floor(value.length / 2);
  const replacement = value[index] === 'a' ? 'b' : 'a';

  return (
    value.slice(0, index) +
    replacement +
    value.slice(index + 1)
  );
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('TITech payroll webhook cryptography', () => {
  beforeEach(() => {
    setTestEncryptionKey();
  });

  afterAll(() => {
    if (ORIGINAL_ENCRYPTION_KEY === undefined) {
      delete process.env[ENCRYPTION_KEY_ENV];
    } else {
      process.env[ENCRYPTION_KEY_ENV] = ORIGINAL_ENCRYPTION_KEY;
    }
  });

  // ==========================================================================
  // WEBHOOK SECRET GENERATION
  // ==========================================================================

  describe('generateWebhookSecret()', () => {
    test('generates a non-empty secret string', () => {
      const secret = generateWebhookSecret();

      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThan(0);
    });

    test('generates secrets that differ across successive calls', () => {
      const firstSecret = generateWebhookSecret();
      const secondSecret = generateWebhookSecret();

      expect(firstSecret).not.toBe(secondSecret);
    });

    test('generates a sufficiently long webhook secret', () => {
      const secret = generateWebhookSecret();

      // A minimum length check catches obviously weak or truncated values.
      // It does not by itself prove cryptographic entropy.
      expect(secret.length).toBeGreaterThanOrEqual(32);
    });
  });

  // ==========================================================================
  // SECRET ENCRYPTION AND DECRYPTION
  // ==========================================================================

  describe('encryptSecret() and decryptSecret()', () => {
    test('encrypts and decrypts an employer webhook secret', () => {
      const secret = generateWebhookSecret();

      const encrypted = encryptSecret(secret);

      expect(encrypted).not.toBe(secret);
      expect(encrypted).not.toContain(secret);

      expect(decryptSecret(encrypted)).toBe(secret);
    });

    test('does not produce identical ciphertext for repeated encryption', () => {
      const secret = generateWebhookSecret();

      const firstEncryption = encryptSecret(secret);
      const secondEncryption = encryptSecret(secret);

      // Authenticated encryption should ordinarily use a fresh nonce or IV.
      // Identical ciphertext can expose repeated values to an observer.
      expect(firstEncryption).not.toEqual(secondEncryption);

      expect(decryptSecret(firstEncryption)).toBe(secret);
      expect(decryptSecret(secondEncryption)).toBe(secret);
    });

    test('rejects ciphertext encrypted with a different key', () => {
      const secret = generateWebhookSecret();

      const encrypted = encryptSecret(secret);

      const originalTestKey = process.env[ENCRYPTION_KEY_ENV];

      try {
        process.env[ENCRYPTION_KEY_ENV] =
          crypto.randomBytes(32).toString('hex');

        expect(() => decryptSecret(encrypted)).toThrow();
      } finally {
        process.env[ENCRYPTION_KEY_ENV] = originalTestKey;
      }
    });

    test('rejects tampered ciphertext', () => {
      const secret = generateWebhookSecret();

      const encrypted = encryptSecret(secret);

      expect(typeof encrypted).toBe('string');

      const tamperedCiphertext = alterString(encrypted);

      expect(() => decryptSecret(tamperedCiphertext)).toThrow();
    });

    test.each([
      ['empty input', ''],
      ['malformed ciphertext', 'not-a-valid-encrypted-payload'],
    ])('rejects %s during decryption', (_description, ciphertext) => {
      expect(() => decryptSecret(ciphertext)).toThrow();
    });

    test('fails closed when the encryption key is missing', () => {
      delete process.env[ENCRYPTION_KEY_ENV];

      expect(() => encryptSecret('employer-webhook-secret')).toThrow();
    });
  });

  // ==========================================================================
  // WEBHOOK SIGNING AND VERIFICATION
  // ==========================================================================

  describe('signWebhookPayload() and verifyWebhookSignature()', () => {
    test('signs and verifies an unchanged timestamp-bound payload', () => {
      const secret = generateWebhookSecret();
      const timestamp = new Date().toISOString();
      const payload = createWebhookPayload();

      const signature = signWebhookPayload(
        secret,
        timestamp,
        payload
      );

      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);

      expect(
        verifyWebhookSignature(
          secret,
          timestamp,
          payload,
          signature
        )
      ).toBe(true);
    });

    test('rejects a payload whose contents have changed', () => {
      const secret = generateWebhookSecret();
      const timestamp = new Date().toISOString();
      const payload = createWebhookPayload();

      const signature = signWebhookPayload(
        secret,
        timestamp,
        payload
      );

      const modifiedPayload = {
        ...payload,
        employerId: 'tenant-2',
      };

      expect(
        verifyWebhookSignature(
          secret,
          timestamp,
          modifiedPayload,
          signature
        )
      ).toBe(false);
    });

    test('rejects a signature verified against a different timestamp', () => {
      const secret = generateWebhookSecret();
      const timestamp = new Date().toISOString();
      const payload = createWebhookPayload();

      const signature = signWebhookPayload(
        secret,
        timestamp,
        payload
      );

      const modifiedTimestamp = new Date(
        Date.parse(timestamp) + 1000
      ).toISOString();

      expect(modifiedTimestamp).not.toBe(timestamp);

      expect(
        verifyWebhookSignature(
          secret,
          modifiedTimestamp,
          payload,
          signature
        )
      ).toBe(false);
    });

    test('rejects a signature generated with a different secret', () => {
      const secret = generateWebhookSecret();
      const incorrectSecret = generateWebhookSecret();

      const timestamp = new Date().toISOString();
      const payload = createWebhookPayload();

      const signature = signWebhookPayload(
        secret,
        timestamp,
        payload
      );

      expect(
        verifyWebhookSignature(
          incorrectSecret,
          timestamp,
          payload,
          signature
        )
      ).toBe(false);
    });

    test('rejects a modified signature', () => {
      const secret = generateWebhookSecret();
      const timestamp = new Date().toISOString();
      const payload = createWebhookPayload();

      const signature = signWebhookPayload(
        secret,
        timestamp,
        payload
      );

      const modifiedSignature = alterString(signature);

      expect(
        verifyWebhookSignature(
          secret,
          timestamp,
          payload,
          modifiedSignature
        )
      ).toBe(false);
    });

    test.each([
      ['empty signature', ''],
      ['arbitrary text', 'not-a-valid-signature'],
    ])('rejects %s', (_description, signature) => {
      const secret = generateWebhookSecret();
      const timestamp = new Date().toISOString();
      const payload = createWebhookPayload();

      expect(
        verifyWebhookSignature(
          secret,
          timestamp,
          payload,
          signature
        )
      ).toBe(false);
    });

    test('rejects a payload modified after signing', () => {
      const secret = generateWebhookSecret();
      const timestamp = new Date().toISOString();
      const payload = createWebhookPayload();

      const signature = signWebhookPayload(
        secret,
        timestamp,
        payload
      );

      // Create a new payload without mutating the original object.
      const modifiedPayload = {
        ...payload,
        batchId: 'payroll-batch-tampered',
      };

      expect(
        verifyWebhookSignature(
          secret,
          timestamp,
          modifiedPayload,
          signature
        )
      ).toBe(false);

      // The untouched original should still verify.
      expect(
        verifyWebhookSignature(
          secret,
          timestamp,
          payload,
          signature
        )
      ).toBe(true);
    });
  });
});