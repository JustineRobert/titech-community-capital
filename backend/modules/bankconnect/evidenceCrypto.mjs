import crypto from 'node:crypto';

function getEvidenceKey(environment = process.env) {
  const configured = String(environment.TITECH_BANKCONNECT_EVIDENCE_ENCRYPTION_KEY || '').trim();
  if (!configured) return null;
  let key;
  if (/^[0-9a-f]{64}$/i.test(configured)) key = Buffer.from(configured, 'hex');
  else key = Buffer.from(configured, 'base64');
  return key.length === 32 ? key : null;
}

export function isBankEvidenceEncryptionConfigured(environment = process.env) {
  return Boolean(getEvidenceKey(environment));
}

export function encryptBankEvidence(plainBuffer, environment = process.env) {
  const key = getEvidenceKey(environment);
  if (!key) {
    const error = new Error('Bank statement evidence encryption is not configured with a valid 32-byte AES key.');
    error.code = 'BANKCONNECT_EVIDENCE_ENCRYPTION_UNAVAILABLE';
    error.statusCode = 503;
    throw error;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  return {
    algorithm: 'AES-256-GCM',
    keyVersion: String(environment.TITECH_BANKCONNECT_EVIDENCE_KEY_VERSION || 'v1').slice(0, 64),
    iv,
    authTag: cipher.getAuthTag(),
    ciphertext,
  };
}

export function decryptBankEvidence(evidence, environment = process.env) {
  const key = getEvidenceKey(environment);
  if (!key) throw new Error('Bank statement evidence decryption key is not available.');
  if (evidence?.algorithm !== 'AES-256-GCM') throw new Error('Unsupported encrypted evidence algorithm.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, evidence.iv);
  decipher.setAuthTag(evidence.authTag);
  return Buffer.concat([decipher.update(evidence.ciphertext), decipher.final()]);
}
