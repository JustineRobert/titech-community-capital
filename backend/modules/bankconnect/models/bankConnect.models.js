import mongoose from 'mongoose';
import { BANK_INSTITUTIONS } from '../bankInstitutionRegistry.mjs';

const { Schema } = mongoose;
const bankIds = BANK_INSTITUTIONS.map(({ id }) => id);

const BankAccountSchema = new Schema({
  tenantId: { type: String, required: true, immutable: true, trim: true, maxlength: 128, index: true },
  institutionId: { type: String, required: true, enum: bankIds, immutable: true, index: true },
  accountReference: { type: String, required: true, trim: true, maxlength: 80, immutable: true },
  accountName: { type: String, required: true, trim: true, maxlength: 160 },
  maskedAccountNumber: { type: String, required: true, trim: true, maxlength: 32, validate: { validator: (value) => /^(?:\*{2,}|•{2,}|x{2,}|X{2,})[\s-]*\d{2,4}$/i.test(value), message: 'Only a masked account number ending in 2–4 digits may be stored.' } },
  accountType: { type: String, enum: ['CURRENT', 'SAVINGS', 'BUSINESS', 'OTHER'], default: 'OTHER' },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  authorizationStatus: { type: String, enum: ['PENDING', 'EVIDENCE_REVIEWED', 'REJECTED', 'REVOKED'], default: 'PENDING', index: true },
  consentStatus: { type: String, enum: ['NOT_REQUESTED', 'REQUESTED', 'APPROVED', 'REVOKED', 'EXPIRED'], default: 'NOT_REQUESTED', index: true },
  consentExpiresAt: { type: Date, default: null },
  connectionStatus: { type: String, enum: ['MANUAL_STATEMENT_IMPORT_ONLY', 'NOT_CONNECTED', 'SUSPENDED'], default: 'MANUAL_STATEMENT_IMPORT_ONLY' },
  status: { type: String, enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED'], default: 'PENDING', index: true },
  ownershipEvidenceReference: { type: String, trim: true, maxlength: 256, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
BankAccountSchema.index({ tenantId: 1, institutionId: 1, accountReference: 1 }, { unique: true, name: 'uniq_bank_account_reference_per_tenant' });

const BankConsentSchema = new Schema({
  tenantId: { type: String, required: true, immutable: true, index: true },
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true, immutable: true, index: true },
  scopes: { type: [{ type: String, enum: ['STATEMENTS', 'TRANSACTIONS', 'BALANCES'] }], required: true, validate: { validator: (value) => Array.isArray(value) && value.length > 0, message: 'At least one bank-data scope is required.' } },
  status: { type: String, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED'], default: 'REQUESTED', index: true },
  authorizationEvidenceReference: { type: String, required: true, trim: true, maxlength: 256 },
  validFrom: { type: Date, required: true },
  validUntil: { type: Date, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  revokedAt: { type: Date, default: null },
  revocationReason: { type: String, trim: true, maxlength: 500, default: null },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
BankConsentSchema.index({ tenantId: 1, bankAccountId: 1, status: 1, validUntil: 1 });

const EncryptedEvidenceSchema = new Schema({
  algorithm: { type: String, enum: ['AES-256-GCM'], required: true },
  keyVersion: { type: String, required: true, maxlength: 64 },
  iv: { type: Buffer, required: true, select: false },
  authTag: { type: Buffer, required: true, select: false },
  ciphertext: { type: Buffer, required: true, select: false },
}, { _id: false, strict: 'throw' });

const BankStatementImportSchema = new Schema({
  tenantId: { type: String, required: true, immutable: true, index: true },
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true, immutable: true, index: true },
  filename: { type: String, required: true, trim: true, maxlength: 255, immutable: true },
  format: { type: String, enum: ['CSV', 'XLSX', 'MT940', 'CAMT.052', 'CAMT.053', 'CAMT.054'], required: true, immutable: true },
  mimeType: { type: String, required: true, trim: true, maxlength: 128, immutable: true },
  sourceHash: { type: String, required: true, lowercase: true, minlength: 64, maxlength: 64, immutable: true },
  sourceSizeBytes: { type: Number, required: true, min: 1, max: 5 * 1024 * 1024, immutable: true },
  sourceEvidence: { type: EncryptedEvidenceSchema, required: true, select: false, immutable: true },
  status: { type: String, enum: ['IMPORTED', 'PARTIAL', 'FAILED'], required: true, default: 'IMPORTED', index: true },
  transactionCount: { type: Number, required: true, min: 0 },
  insertedCount: { type: Number, required: true, min: 0 },
  duplicateCount: { type: Number, required: true, min: 0 },
  potentialDuplicateCount: { type: Number, required: true, min: 0 },
  periodStart: { type: Date, default: null },
  periodEnd: { type: Date, default: null },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  importedAt: { type: Date, required: true, default: Date.now, immutable: true },
}, { timestamps: true, strict: 'throw' });
BankStatementImportSchema.index({ tenantId: 1, bankAccountId: 1, sourceHash: 1 }, { unique: true, name: 'uniq_statement_source_per_bank_account' });

const BankTransactionSchema = new Schema({
  tenantId: { type: String, required: true, immutable: true, index: true },
  bankAccountId: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true, immutable: true, index: true },
  statementImportId: { type: Schema.Types.ObjectId, ref: 'BankStatementImport', required: true, immutable: true, index: true },
  idempotencyKey: { type: String, required: true, immutable: true, maxlength: 128 },
  externalTransactionId: { type: String, trim: true, maxlength: 160, default: null, immutable: true },
  transactionReference: { type: String, trim: true, maxlength: 160, default: null, immutable: true },
  endToEndReference: { type: String, trim: true, maxlength: 160, default: null, immutable: true },
  bookingDate: { type: Date, required: true, immutable: true, index: true },
  valueDate: { type: Date, required: true, immutable: true },
  description: { type: String, required: true, trim: true, maxlength: 2000, immutable: true },
  debitMinor: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, immutable: true },
  creditMinor: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, immutable: true },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3, immutable: true },
  fingerprintHash: { type: String, required: true, lowercase: true, minlength: 64, maxlength: 64, immutable: true, index: true },
  sourceRow: { type: Number, required: true, min: 1, immutable: true },
  reconciliationStatus: { type: String, enum: ['UNMATCHED', 'POTENTIAL_DUPLICATE', 'MATCHED_PENDING_APPROVAL', 'RECONCILED', 'EXCEPTION', 'REVERSED'], default: 'UNMATCHED', index: true },
  potentialDuplicate: { type: Boolean, default: false, index: true },
  ledgerReference: { type: String, default: null, immutable: true },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
BankTransactionSchema.index({ tenantId: 1, bankAccountId: 1, idempotencyKey: 1 }, { unique: true, name: 'uniq_bank_transaction_idempotency' });
BankTransactionSchema.index({ tenantId: 1, bankAccountId: 1, bookingDate: -1, _id: -1 });
BankTransactionSchema.index({ tenantId: 1, reconciliationStatus: 1, bookingDate: -1 });

export const BankAccount = mongoose.models.BankAccount || mongoose.model('BankAccount', BankAccountSchema);
export const BankConsent = mongoose.models.BankConsent || mongoose.model('BankConsent', BankConsentSchema);
export const BankStatementImport = mongoose.models.BankStatementImport || mongoose.model('BankStatementImport', BankStatementImportSchema);
export const BankTransaction = mongoose.models.BankTransaction || mongoose.model('BankTransaction', BankTransactionSchema);
