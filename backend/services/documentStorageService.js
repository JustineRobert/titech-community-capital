// ============================================================================
// File: backend/services/documentStorageService.js
// Description: Enterprise Document Storage Service
// ============================================================================

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const logger = require("../utils/logger");

let S3Client;
let PutObjectCommand;
let GetObjectCommand;

try {
  const awsSdk = require("@aws-sdk/client-s3");

  S3Client = awsSdk.S3Client;
  PutObjectCommand = awsSdk.PutObjectCommand;
  GetObjectCommand = awsSdk.GetObjectCommand;
} catch (_) {}

// ============================================================================
// Configuration
// ============================================================================

const STORAGE_PROVIDERS = {
  LOCAL: "LOCAL",
  S3: "S3",
  MINIO: "MINIO",
  AZURE: "AZURE"
};

const DOCUMENT_TYPES = {
  NATIONAL_ID: "NATIONAL_ID",
  PASSPORT: "PASSPORT",
  DRIVING_LICENSE: "DRIVING_LICENSE",

  KYC_DOCUMENT: "KYC_DOCUMENT",
  AML_EVIDENCE: "AML_EVIDENCE",

  LOAN_APPLICATION: "LOAN_APPLICATION",
  LOAN_AGREEMENT: "LOAN_AGREEMENT",

  SAVINGS_DOCUMENT: "SAVINGS_DOCUMENT",

  FRAUD_EVIDENCE: "FRAUD_EVIDENCE",

  TENANT_DOCUMENT: "TENANT_DOCUMENT",

  OTHER: "OTHER"
};

const STORAGE_PROVIDER =
  process.env.DOCUMENT_STORAGE_PROVIDER ||
  STORAGE_PROVIDERS.LOCAL;

const STORAGE_ROOT =
  process.env.DOCUMENT_STORAGE_PATH ||
  path.join(process.cwd(), "uploads");

// ============================================================================
// Error Class
// ============================================================================

class DocumentStorageError extends Error {
  constructor(
    message,
    code = "DOCUMENT_STORAGE_ERROR",
    status = 500,
    metadata = {}
  ) {
    super(message);

    this.name = "DocumentStorageError";
    this.code = code;
    this.status = status;
    this.metadata = metadata;
  }
}

// ============================================================================
// AWS S3 Client
// ============================================================================

let s3Client = null;

function getS3Client() {
  if (s3Client) {
    return s3Client;
  }

  if (!S3Client) {
    throw new Error(
      "AWS SDK not installed"
    );
  }

  s3Client = new S3Client({
    region:
      process.env.AWS_REGION ||
      "us-east-1",

    credentials: {
      accessKeyId:
        process.env.AWS_ACCESS_KEY_ID,

      secretAccessKey:
        process.env.AWS_SECRET_ACCESS_KEY
    }
  });

  return s3Client;
}

// ============================================================================
// Helpers
// ============================================================================

function generateDocumentId() {
  return `doc_${crypto.randomUUID()}`;
}

function generateHash(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

function ensureDirectoryExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {
      recursive: true
    });
  }
}

function buildTenantPath(
  tenantId,
  documentType
) {
  return path.join(
    STORAGE_ROOT,
    String(tenantId || "system"),
    String(documentType || "general")
  );
}

// ============================================================================
// Local Storage Provider
// ============================================================================

async function saveLocal({
  tenantId,
  documentType,
  originalName,
  buffer
}) {
  const documentId =
    generateDocumentId();

  const extension =
    path.extname(originalName);

  const directory =
    buildTenantPath(
      tenantId,
      documentType
    );

  ensureDirectoryExists(directory);

  const filename =
    `${documentId}${extension}`;

  const fullPath =
    path.join(
      directory,
      filename
    );

  await fs.promises.writeFile(
    fullPath,
    buffer
  );

  return {
    provider:
      STORAGE_PROVIDERS.LOCAL,

    documentId,

    path: fullPath,

    filename
  };
}

// ============================================================================
// AWS S3 Storage Provider
// ============================================================================

async function saveS3({
  tenantId,
  documentType,
  originalName,
  buffer
}) {
  const documentId =
    generateDocumentId();

  const key =
    `${tenantId}/${documentType}/${documentId}-${originalName}`;

  const bucket =
    process.env.S3_BUCKET;

  const client =
    getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer
    })
  );

  return {
    provider:
      STORAGE_PROVIDERS.S3,

    documentId,

    bucket,

    key
  };
}

// ============================================================================
// Store Document
// ============================================================================

async function storeDocument({
  tenantId,
  userId,
  documentType,
  originalName,
  mimeType,
  buffer,
  metadata = {}
}) {
  try {
    if (!buffer) {
      throw new DocumentStorageError(
        "Document buffer required",
        "BUFFER_REQUIRED",
        400
      );
    }

    const fileHash =
      generateHash(buffer);

    let storageResult;

    switch (
      STORAGE_PROVIDER
    ) {
      case STORAGE_PROVIDERS.S3:
        storageResult =
          await saveS3({
            tenantId,
            documentType,
            originalName,
            buffer
          });
        break;

      case STORAGE_PROVIDERS.LOCAL:
      default:
        storageResult =
          await saveLocal({
            tenantId,
            documentType,
            originalName,
            buffer
          });
        break;
    }

    const documentRecord = {
      ...storageResult,

      tenantId,
      userId,

      documentType,

      originalName,

      mimeType,

      size:
        buffer.length,

      hash:
        fileHash,

      version: 1,

      uploadedAt:
        new Date(),

      metadata
    };

    logger.info(
      "Document stored successfully",
      {
        documentId:
          storageResult.documentId,

        tenantId,
        userId,
        documentType
      }
    );

    return documentRecord;
  } catch (error) {
    logger.error(
      "Document storage failed",
      {
        error:
          error.message
      }
    );

    throw new DocumentStorageError(
      error.message,
      "DOCUMENT_STORE_FAILED"
    );
  }
}

// ============================================================================
// Verify Integrity
// ============================================================================

async function verifyIntegrity(
  buffer,
  expectedHash
) {
  const actualHash =
    generateHash(buffer);

  return (
    actualHash ===
    expectedHash
  );
}

// ============================================================================
// Soft Delete
// ============================================================================

async function softDeleteDocument(
  document
) {
  return {
    ...document,
    deleted: true,
    deletedAt:
      new Date()
  };
}

// ============================================================================
// Generate Signed URL
// ============================================================================

async function generateSignedUrl(
  document
) {
  if (
    STORAGE_PROVIDER !==
    STORAGE_PROVIDERS.S3
  ) {
    return null;
  }

  return {
    url: `s3://${document.bucket}/${document.key}`,
    expiresIn: 3600
  };
}

// ============================================================================
// KYC Helper
// ============================================================================

async function storeKycDocument(
  payload
) {
  return storeDocument({
    ...payload,
    documentType:
      DOCUMENT_TYPES.KYC_DOCUMENT
  });
}

// ============================================================================
// Loan Helper
// ============================================================================

async function storeLoanDocument(
  payload
) {
  return storeDocument({
    ...payload,
    documentType:
      DOCUMENT_TYPES.LOAN_APPLICATION
  });
}

// ============================================================================
// Fraud Evidence Helper
// ============================================================================

async function storeFraudEvidence(
  payload
) {
  return storeDocument({
    ...payload,
    documentType:
      DOCUMENT_TYPES.FRAUD_EVIDENCE
  });
}

// ============================================================================
// Health Check
// ============================================================================

async function healthCheck() {
  return {
    service:
      "document-storage-service",

    provider:
      STORAGE_PROVIDER,

    status: "UP",

    timestamp:
      new Date().toISOString()
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  STORAGE_PROVIDERS,
  DOCUMENT_TYPES,

  DocumentStorageError,

  storeDocument,

  storeKycDocument,
  storeLoanDocument,
  storeFraudEvidence,

  verifyIntegrity,

  generateSignedUrl,

  softDeleteDocument,

  healthCheck
};