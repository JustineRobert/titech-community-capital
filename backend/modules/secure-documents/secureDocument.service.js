import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, rename, rm, writeFile, chmod } from 'node:fs/promises';
import SecureDocument, { SECURE_DOCUMENT_PURPOSES } from './secureDocument.model.js';
import { createAuditLog } from '../audit/audit.service.js';
import { isDocumentMalwareScannerConfigured, scanDocumentBuffer } from './documentMalwareScan.js';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAGIC = Buffer.from('TITDOC1', 'ascii');
const ENCRYPTION_VERSION = 'AES-256-GCM-v1';

function serviceError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function tenantDirectoryName(tenantId) {
  return crypto.createHash('sha256').update(String(tenantId)).digest('hex');
}

function resolveConfiguration() {
  const configuredKey = String(process.env.TITECH_DOCUMENT_ENCRYPTION_KEY || '').trim();
  const key = configuredKey ? Buffer.from(configuredKey, 'base64') : Buffer.alloc(0);
  if (key.length !== 32) {
    throw serviceError('Private document storage is unavailable until a valid 32-byte base64 encryption key is configured.', 'DOCUMENT_STORAGE_NOT_CONFIGURED', 503);
  }

  const configuredRoot = String(process.env.TITECH_PRIVATE_DOCUMENT_STORAGE_PATH || '').trim();
  if (process.env.NODE_ENV === 'production' && !configuredRoot) {
    throw serviceError('Production must configure TITECH_PRIVATE_DOCUMENT_STORAGE_PATH outside the application web root.', 'DOCUMENT_STORAGE_NOT_CONFIGURED', 503);
  }
  const root = path.resolve(configuredRoot || path.join(os.tmpdir(), 'titech-capital-private-documents'));
  const normalizedRoot = root.toLowerCase().split(path.sep).join('/');
  if (normalizedRoot.includes('/public/') || normalizedRoot.endsWith('/public') || normalizedRoot.includes('/uploads/')) {
    throw serviceError('Private document storage cannot be inside a public or uploads directory.', 'DOCUMENT_STORAGE_PATH_UNSAFE', 503);
  }
  if (process.env.NODE_ENV === 'production' && (root === process.cwd() || root.startsWith(`${path.resolve(process.cwd())}${path.sep}`))) {
    throw serviceError('Production private document storage must be outside the application checkout.', 'DOCUMENT_STORAGE_PATH_UNSAFE', 503);
  }
  return { key, root };
}

function validateUpload({ tenantId, subjectId, actorId, purpose, mimeType, buffer }) {
  if (!tenantId || !subjectId || !actorId) throw serviceError('Trusted tenant, subject and actor context are required.', 'DOCUMENT_CONTEXT_REQUIRED', 401);
  const normalizedPurpose = String(purpose || '').trim().toUpperCase();
  if (!SECURE_DOCUMENT_PURPOSES.includes(normalizedPurpose)) throw serviceError('Unsupported document purpose.', 'DOCUMENT_PURPOSE_UNSUPPORTED', 400);
  const normalizedMime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(normalizedMime)) throw serviceError('Only PDF, JPEG and PNG evidence is accepted.', 'DOCUMENT_MIME_TYPE_UNSUPPORTED', 415);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw serviceError('A non-empty document body is required.', 'DOCUMENT_BODY_REQUIRED', 400);
  if (buffer.length > MAX_DOCUMENT_BYTES) throw serviceError('Document exceeds the 10 MiB upload limit.', 'DOCUMENT_TOO_LARGE', 413);
  const isPdf = buffer.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii'));
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const signatureMatches = (normalizedMime === 'application/pdf' && isPdf)
    || (normalizedMime === 'image/png' && isPng)
    || (normalizedMime === 'image/jpeg' && isJpeg);
  if (!signatureMatches) throw serviceError('The document content does not match its declared PDF, JPEG or PNG type.', 'DOCUMENT_CONTENT_TYPE_MISMATCH', 415);
  return { purpose: normalizedPurpose, mimeType: normalizedMime };
}

function encrypt(buffer, key, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

function decrypt(encrypted, key, aad) {
  const headerSize = MAGIC.length + 12 + 16;
  if (encrypted.length < headerSize || !encrypted.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw serviceError('Stored document envelope is invalid.', 'DOCUMENT_ENVELOPE_INVALID', 500);
  }
  const iv = encrypted.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = encrypted.subarray(MAGIC.length + 12, headerSize);
  const ciphertext = encrypted.subarray(headerSize);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw serviceError('Stored document could not be authenticated.', 'DOCUMENT_AUTHENTICATION_FAILED', 500);
  }
}

function aadFor({ tenantId, documentReference, purpose }) {
  return `${tenantId}:${documentReference}:${purpose}`;
}

async function appendAudit({ tenantId, actorId, action, documentReference, purpose, requestId, correlationId }) {
  try {
    await createAuditLog({
      tenantId,
      action,
      actorId,
      requestId: requestId || null,
      correlationId: correlationId || requestId || null,
      data: { documentReference, purpose, operationBoundary: 'private-document-service' },
    });
  } catch (error) {
    // Fail the operation closed if an audit record cannot be written. For an
    // upload, caller compensation removes the encrypted file and metadata.
    throw serviceError('Required audit evidence could not be written.', 'DOCUMENT_AUDIT_UNAVAILABLE', 503);
  }
}

export async function storePrivateDocument({ tenantId, subjectId, actorId, purpose, mimeType, buffer, requestId, correlationId }) {
  const normalized = validateUpload({ tenantId, subjectId, actorId, purpose, mimeType, buffer });
  // Screen untrusted identity/licence/claim evidence before encryption or disk writes.
  // Scanner failure or an absent scanner prevents both file and metadata creation.
  await scanDocumentBuffer(buffer);
  const { key, root } = resolveConfiguration();
  const documentReference = `doc_${crypto.randomUUID()}`;
  const tenantDir = path.join(root, tenantDirectoryName(tenantId));
  const storageKey = `${crypto.randomUUID()}.enc`;
  const finalPath = path.join(tenantDir, storageKey);
  const temporaryPath = `${finalPath}.tmp`;
  const encrypted = encrypt(buffer, key, aadFor({ tenantId, documentReference, purpose: normalized.purpose }));
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  await mkdir(tenantDir, { recursive: true, mode: 0o700 });
  await chmod(tenantDir, 0o700).catch(() => {});
  await writeFile(temporaryPath, encrypted, { flag: 'wx', mode: 0o600 });
  await rename(temporaryPath, finalPath);

  let record;
  try {
    record = await SecureDocument.create({
      tenantId: String(tenantId),
      documentReference,
      subjectId: String(subjectId),
      createdBy: String(actorId),
      purpose: normalized.purpose,
      mimeType: normalized.mimeType,
      sizeBytes: buffer.length,
      sha256,
      storageKey,
      encryptionVersion: ENCRYPTION_VERSION,
      uploadedAt: new Date(),
    });
    await appendAudit({ tenantId, actorId, action: 'PRIVATE_DOCUMENT.UPLOADED', documentReference, purpose: normalized.purpose, requestId, correlationId });
  } catch (error) {
    if (record?._id) await SecureDocument.deleteOne({ _id: record._id, tenantId: String(tenantId) }).catch(() => {});
    await rm(finalPath, { force: true }).catch(() => {});
    throw error;
  }

  return Object.freeze({
    documentReference,
    purpose: normalized.purpose,
    mimeType: normalized.mimeType,
    sizeBytes: buffer.length,
    uploadedAt: record.uploadedAt,
  });
}

export async function findPrivateDocument({ tenantId, documentReference, subjectId, purpose }) {
  if (!tenantId || !documentReference) throw serviceError('Trusted tenant and document reference are required.', 'DOCUMENT_CONTEXT_REQUIRED', 400);
  const filter = { tenantId: String(tenantId), documentReference: String(documentReference), deletedAt: null };
  if (subjectId) filter.subjectId = String(subjectId);
  if (purpose) filter.purpose = String(purpose).trim().toUpperCase();
  const record = await SecureDocument.findOne(filter).select('+storageKey +sha256').lean();
  return record || null;
}

export async function readPrivateDocument({ tenantId, documentReference, actorId, subjectId, allowedPurposes, requestId, correlationId }) {
  const record = await findPrivateDocument({ tenantId, documentReference });
  if (!record) throw serviceError('Document was not found within this tenant.', 'DOCUMENT_NOT_FOUND', 404);
  const actorIsSubject = String(record.subjectId) === String(subjectId || actorId);
  const allowed = Array.isArray(allowedPurposes) && allowedPurposes.includes(record.purpose);
  if (!actorIsSubject && !allowed) throw serviceError('Document access is not authorized.', 'DOCUMENT_ACCESS_DENIED', 403);
  const { key, root } = resolveConfiguration();
  const filename = path.resolve(root, tenantDirectoryName(tenantId), record.storageKey);
  const expectedParent = path.resolve(root, tenantDirectoryName(tenantId));
  if (!filename.startsWith(`${expectedParent}${path.sep}`)) throw serviceError('Document storage reference is invalid.', 'DOCUMENT_PATH_INVALID', 500);
  let encrypted;
  try {
    encrypted = await readFile(filename);
  } catch {
    throw serviceError('Document content is unavailable.', 'DOCUMENT_CONTENT_UNAVAILABLE', 404);
  }
  const buffer = decrypt(encrypted, key, aadFor({ tenantId, documentReference: record.documentReference, purpose: record.purpose }));
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (sha256 !== record.sha256) throw serviceError('Document integrity check failed.', 'DOCUMENT_INTEGRITY_FAILURE', 500);
  await appendAudit({ tenantId, actorId, action: 'PRIVATE_DOCUMENT.READ', documentReference: record.documentReference, purpose: record.purpose, requestId, correlationId });
  return Object.freeze({ buffer, mimeType: record.mimeType, sizeBytes: record.sizeBytes, documentReference: record.documentReference, purpose: record.purpose });
}

export function isPrivateDocumentStorageConfigured() {
  try { resolveConfiguration(); return true; } catch { return false; }
}

export function isPrivateDocumentMalwareScannerConfigured() {
  return isDocumentMalwareScannerConfigured();
}

export const PRIVATE_DOCUMENT_LIMITS = Object.freeze({ maxBytes: MAX_DOCUMENT_BYTES, supportedMimeTypes: Object.freeze([...ALLOWED_MIME_TYPES]), encryptionVersion: ENCRYPTION_VERSION });
