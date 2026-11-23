import crypto from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import authModule from '../../middleware/auth.js';
import { createAuditLog } from '../../models/audit/audit.service.js';
import { BankAccount, BankConsent, BankStatementImport, BankTransaction } from './models/bankConnect.models.js';
import { BANK_INSTITUTIONS, getBankInstitution, getBankConnectCapabilitySummary, STATEMENT_UPLOAD_MAX_BYTES } from './bankInstitutionRegistry.mjs';
import { parseBankStatement } from './statementParser.mjs';
import { encryptBankEvidence, isBankEvidenceEncryptionConfigured } from './evidenceCrypto.mjs';
import { isDocumentMalwareScannerConfigured, scanDocumentBuffer } from '../../modules/secure-documents/documentMalwareScan.js';

const router = express.Router({ caseSensitive: false, strict: false });
const requirePermission = authModule.requirePermission;
const VIEW = 'BANKCONNECT_VIEW';
const ACCOUNT_MANAGE = 'BANKCONNECT_ACCOUNT_MANAGE';
const STATEMENT_IMPORT = 'BANKCONNECT_STATEMENT_IMPORT';
const CONSENT_REVIEW = 'BANKCONNECT_AUTHORIZATION_REVIEW';
const AUDIT_VIEW = 'BANKCONNECT_AUDIT_VIEW';

function tenantIdFor(req) {
  const value = req.tenant?.tenantId || req.tenant?.slug || req.tenantId || req.tenantKey;
  return value === undefined || value === null ? null : String(value);
}

function actorIdFor(req) {
  const value = req.user?._id || req.user?.id || req.user?.userId || req.auth?.sub || req.auth?.userId;
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null;
}

function requireTrustedContext(req, res) {
  const tenantId = tenantIdFor(req);
  const actorId = actorIdFor(req);
  if (!tenantId || !actorId) {
    res.status(403).json({ success: false, error: { code: 'BANKCONNECT_CONTEXT_INVALID', message: 'A verified institution context and user identity are required.' }, requestId: req.requestId || null });
    return null;
  }
  return { tenantId, actorId };
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function fail(res, status, code, message, req) {
  return res.status(status).json({ success: false, error: { code, message }, requestId: req.requestId || null });
}

function pagination(req) {
  const requestedPage = Number.parseInt(req.query.page, 10) || 1;
  const requestedLimit = Number.parseInt(req.query.limit, 10) || 25;
  const page = Math.min(100000, Math.max(1, requestedPage));
  const limit = Math.min(100, Math.max(1, requestedLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function accountDto(account) {
  return {
    id: String(account._id),
    institutionId: account.institutionId,
    institutionName: getBankInstitution(account.institutionId)?.name || account.institutionId,
    accountReference: account.accountReference,
    accountName: account.accountName,
    maskedAccountNumber: account.maskedAccountNumber,
    accountType: account.accountType,
    currency: account.currency,
    authorizationStatus: account.authorizationStatus,
    consentStatus: account.consentStatus,
    consentExpiresAt: account.consentExpiresAt,
    connectionStatus: account.connectionStatus,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function statementDto(item) {
  return {
    id: String(item._id), accountId: String(item.bankAccountId), filename: item.filename,
    format: item.format, sourceHash: item.sourceHash, sourceSizeBytes: item.sourceSizeBytes,
    status: item.status, transactionCount: item.transactionCount,
    insertedCount: item.insertedCount, duplicateCount: item.duplicateCount,
    potentialDuplicateCount: item.potentialDuplicateCount,
    periodStart: item.periodStart, periodEnd: item.periodEnd, importedAt: item.importedAt,
  };
}

function transactionDto(item) {
  return {
    id: String(item._id), accountId: String(item.bankAccountId), statementImportId: String(item.statementImportId),
    externalTransactionId: item.externalTransactionId,
    transactionReference: item.transactionReference,
    endToEndReference: item.endToEndReference,
    bookingDate: item.bookingDate, valueDate: item.valueDate, description: item.description,
    debitMinor: item.debitMinor, creditMinor: item.creditMinor, currency: item.currency,
    reconciliationStatus: item.reconciliationStatus, potentialDuplicate: item.potentialDuplicate,
    ledgerReference: item.ledgerReference,
  };
}

async function withMongoTransaction(operation) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await operation(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

async function writeAudit(req, { action, entityType, entityId, outcome = 'success', metadata = {}, session = undefined }) {
  const tenantObjectId = req.tenant?._id || req.tenantObjectId;
  const actorId = actorIdFor(req);
  if (!mongoose.isValidObjectId(tenantObjectId) || !actorId) {
    const error = new Error('Trusted tenant and actor identifiers are required for BankConnect audit events.');
    error.code = 'BANKCONNECT_AUDIT_CONTEXT_INVALID';
    error.statusCode = 503;
    throw error;
  }
  return createAuditLog({
    action,
    userId: actorId,
    tenantId: new mongoose.Types.ObjectId(String(tenantObjectId)),
    scope: 'tenant',
    entityType,
    entityId: mongoose.isValidObjectId(entityId) ? new mongoose.Types.ObjectId(String(entityId)) : undefined,
    outcome,
    metadata,
    requestId: req.requestId,
    correlationId: req.correlationId,
    session,
  });
}

async function getAccountWithActiveStatementConsent(tenantId, accountId) {
  if (!mongoose.isValidObjectId(accountId)) return null;
  const account = await BankAccount.findOne({ _id: accountId, tenantId }).lean();
  if (!account || account.status !== 'ACTIVE' || account.authorizationStatus !== 'EVIDENCE_REVIEWED') return null;
  const now = new Date();
  let consent = await BankConsent.findOne({
    tenantId,
    bankAccountId: account._id,
    status: 'APPROVED',
    scopes: 'STATEMENTS',
    validFrom: { $lte: now },
    validUntil: { $gt: now },
  }).sort({ approvedAt: -1 }).lean();
  if (!consent && account.consentStatus === 'APPROVED' && account.consentExpiresAt && account.consentExpiresAt <= now) {
    await BankAccount.updateOne({ _id: account._id, tenantId }, { $set: { consentStatus: 'EXPIRED' } });
  }
  return consent ? { account, consent } : null;
}

router.get('/institutions', requirePermission(VIEW), (_req, res) => res.json({
  success: true,
  data: BANK_INSTITUTIONS.map((bank) => ({ ...bank })),
}));

router.get('/overview', requirePermission(VIEW), asyncHandler(async (req, res) => {
  const context = requireTrustedContext(req, res);
  if (!context) return;
  const { tenantId } = context;
  const [registeredAccounts, authorizedAccounts, requestedConsents, statements, transactions, unmatched, potentialDuplicates, exceptions, reconciled, matchedPending, imports] = await Promise.all([
    BankAccount.countDocuments({ tenantId }),
    BankAccount.countDocuments({ tenantId, status: 'ACTIVE', authorizationStatus: 'EVIDENCE_REVIEWED', consentStatus: 'APPROVED' }),
    BankConsent.countDocuments({ tenantId, status: 'REQUESTED' }),
    BankStatementImport.countDocuments({ tenantId }),
    BankTransaction.countDocuments({ tenantId }),
    BankTransaction.countDocuments({ tenantId, reconciliationStatus: 'UNMATCHED' }),
    BankTransaction.countDocuments({ tenantId, potentialDuplicate: true }),
    BankTransaction.countDocuments({ tenantId, reconciliationStatus: 'EXCEPTION' }),
    BankTransaction.countDocuments({ tenantId, reconciliationStatus: 'RECONCILED' }),
    BankTransaction.countDocuments({ tenantId, reconciliationStatus: 'MATCHED_PENDING_APPROVAL' }),
    BankStatementImport.find({ tenantId }).sort({ importedAt: -1 }).limit(1).select('importedAt').lean(),
  ]);
  return res.json({ success: true, data: {
    registeredInstitutions: BANK_INSTITUTIONS.length,
    registeredAccounts,
    authorizedAccounts,
    activeConnections: 0,
    pendingAuthorizations: requestedConsents,
    statementsImported: statements,
    transactionsImported: transactions,
    verifiedTransactions: null,
    matchedTransactions: reconciled + matchedPending,
    unmatchedTransactions: unmatched,
    duplicateTransactions: potentialDuplicates,
    reconciliationRate: transactions ? Number(((reconciled / transactions) * 100).toFixed(2)) : null,
    outstandingExceptions: unmatched + potentialDuplicates + exceptions,
    bankReportedBalances: null,
    ledgerDifferences: null,
    lastSynchronizationAt: imports[0]?.importedAt || null,
    dataAvailability: {
      bankReportedBalances: 'NOT_AVAILABLE_UNTIL_BANK_DATA_OR_STATEMENTS_CONTAIN_VERIFIED_BALANCES',
      ledgerComparison: 'NOT_CONNECTED_TO_LEDGER_POSTING_OR_BALANCE_PROJECTION',
      reconciliationMatching: 'MATCHING_WORKFLOW_NOT_IMPLEMENTED_EVIDENCE_ONLY',
    },
    capability: getBankConnectCapabilitySummary(),
  } });
}));

router.get('/accounts', requirePermission(VIEW), asyncHandler(async (req, res) => {
  const context = requireTrustedContext(req, res);
  if (!context) return;
  const { page, limit, skip } = pagination(req);
  const filter = { tenantId: context.tenantId };
  if (req.query.institutionId) filter.institutionId = String(req.query.institutionId).toUpperCase();
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  const [items, total] = await Promise.all([
    BankAccount.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    BankAccount.countDocuments(filter),
  ]);
  return res.json({ success: true, data: { items: items.map(accountDto), total, page, limit, pages: Math.ceil(total / limit) } });
}));

router.post('/accounts', requirePermission(ACCOUNT_MANAGE), asyncHandler(async (req, res) => {
  const context = requireTrustedContext(req, res);
  if (!context) return;
  const institutionId = String(req.body?.institutionId || '').trim().toUpperCase();
  const bank = getBankInstitution(institutionId);
  const accountReference = String(req.body?.accountReference || '').trim();
  const accountName = String(req.body?.accountName || '').trim();
  const maskedAccountNumber = String(req.body?.maskedAccountNumber || '').trim();
  const currency = String(req.body?.currency || '').trim().toUpperCase();
  if (!bank || !/^[A-Za-z0-9._/-]{2,80}$/.test(accountReference) || accountName.length < 2 || accountName.length > 160 || !/^(?:\*{2,}|•{2,}|x{2,}|X{2,})[\s-]*\d{2,4}$/i.test(maskedAccountNumber) || !bank.currency.includes(currency)) {
    return fail(res, 400, 'BANK_ACCOUNT_INPUT_INVALID', 'Provide a supported bank, account reference, account name, masked account number and institution-supported currency. Full account numbers and login credentials must not be submitted.', req);
  }
  const actorId = context.actorId;
  const account = await withMongoTransaction(async (session) => {
    const [created] = await BankAccount.create([{
      tenantId: context.tenantId,
      institutionId,
      accountReference,
      accountName,
      maskedAccountNumber,
      accountType: ['CURRENT', 'SAVINGS', 'BUSINESS', 'OTHER'].includes(req.body?.accountType) ? req.body.accountType : 'OTHER',
      currency,
      authorizationStatus: 'PENDING',
      consentStatus: 'NOT_REQUESTED',
      connectionStatus: 'MANUAL_STATEMENT_IMPORT_ONLY',
      status: 'PENDING',
      ownershipEvidenceReference: String(req.body?.ownershipEvidenceReference || '').trim().slice(0, 256) || null,
      createdBy: actorId,
      updatedBy: actorId,
    }], { session });
    await writeAudit(req, { action: 'BANKCONNECT_ACCOUNT_REGISTERED', entityType: 'BANK_ACCOUNT', entityId: created._id, metadata: { institutionId, currency, status: created.status }, session });
    return created;
  });
  return res.status(201).json({ success: true, data: accountDto(account) });
}));

router.post('/accounts/:accountId/consents', requirePermission(ACCOUNT_MANAGE), asyncHandler(async (req, res) => {
  const context = requireTrustedContext(req, res);
  if (!context) return;
  if (!mongoose.isValidObjectId(req.params.accountId)) return fail(res, 400, 'BANK_ACCOUNT_ID_INVALID', 'Bank account identifier is invalid.', req);
  const accountExists = await BankAccount.exists({ _id: req.params.accountId, tenantId: context.tenantId });
  if (!accountExists) return fail(res, 404, 'BANK_ACCOUNT_NOT_FOUND', 'Bank account was not found in this institution.', req);
  const account = accountExists;
  const scopes = [...new Set(Array.isArray(req.body?.scopes) ? req.body.scopes.map((item) => String(item).toUpperCase()) : [])];
  const allowed = new Set(['STATEMENTS', 'TRANSACTIONS', 'BALANCES']);
  const validFrom = new Date(req.body?.validFrom || Date.now());
  const validUntil = new Date(req.body?.validUntil);
  const evidenceReference = String(req.body?.authorizationEvidenceReference || '').trim();
  if (!scopes.length || scopes.some((scope) => !allowed.has(scope)) || Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime()) || validUntil <= validFrom || validUntil - validFrom > 366 * 24 * 60 * 60 * 1000 || evidenceReference.length < 4 || evidenceReference.length > 256) {
    return fail(res, 400, 'BANK_CONSENT_INPUT_INVALID', 'Consent needs at least one valid scope, a maximum one-year validity period, and a reviewed evidence reference.', req);
  }
  const consent = await withMongoTransaction(async (session) => {
    const currentAccount = await BankAccount.findOne({ _id: account._id, tenantId: context.tenantId, status: { $in: ['PENDING', 'ACTIVE'] }, authorizationStatus: { $in: ['PENDING', 'EVIDENCE_REVIEWED'] } }).session(session);
    if (!currentAccount) throw Object.assign(new Error('The bank account is not in a state that accepts a new consent request.'), { code: 'BANK_ACCOUNT_STATE_INVALID', statusCode: 409 });
    const activeOrPendingConsent = await BankConsent.exists({ tenantId: context.tenantId, bankAccountId: account._id, status: { $in: ['REQUESTED', 'APPROVED'] }, validUntil: { $gt: new Date() } }).session(session);
    if (activeOrPendingConsent) throw Object.assign(new Error('An unexpired consent request or approval already exists for this account.'), { code: 'BANK_CONSENT_ALREADY_ACTIVE', statusCode: 409 });
    const [created] = await BankConsent.create([{ tenantId: context.tenantId, bankAccountId: account._id, scopes, status: 'REQUESTED', authorizationEvidenceReference: evidenceReference, validFrom, validUntil, createdBy: context.actorId }], { session });
    await BankAccount.updateOne({ _id: account._id, tenantId: context.tenantId }, { $set: { consentStatus: 'REQUESTED', updatedBy: context.actorId } }, { session });
    await writeAudit(req, { action: 'BANKCONNECT_CONSENT_REQUESTED', entityType: 'BANK_CONSENT', entityId: created._id, metadata: { bankAccountId: String(account._id), scopes, validUntil: validUntil.toISOString() }, session });
    return created;
  });
  return res.status(201).json({ success: true, data: { id: String(consent._id), status: consent.status, scopes: consent.scopes, validFrom, validUntil } });
}));

router.patch('/consents/:consentId/approve', requirePermission(CONSENT_REVIEW), asyncHandler(async (req, res) => {
  const context = requireTrustedContext(req, res);
  if (!context) return;
  if (!mongoose.isValidObjectId(req.params.consentId)) return fail(res, 400, 'BANK_CONSENT_ID_INVALID', 'Consent identifier is invalid.', req);
  const result = await withMongoTransaction(async (session) => {
    const consent = await BankConsent.findOne({ _id: req.params.consentId, tenantId: context.tenantId }).session(session);
    if (!consent) return { error: [404, 'BANK_CONSENT_NOT_FOUND', 'Consent was not found in this institution.'] };
    if (consent.status !== 'REQUESTED') return { error: [409, 'BANK_CONSENT_STATE_INVALID', 'Only a requested consent can be approved.'] };
    if (String(consent.createdBy) === String(context.actorId)) return { error: [403, 'BANK_CONSENT_MAKER_CHECKER_REQUIRED', 'The consent requester cannot approve their own request.'] };
    const now = new Date();
    if (consent.validUntil <= now || consent.validFrom > now) return { error: [409, 'BANK_CONSENT_NOT_CURRENT', 'Consent validity dates do not include the current time.'] };
    const accountBeforeApproval = await BankAccount.findOne({ _id: consent.bankAccountId, tenantId: context.tenantId }).session(session);
    if (!accountBeforeApproval) return { error: [404, 'BANK_ACCOUNT_NOT_FOUND', 'The consent account no longer exists.'] };
    if (!accountBeforeApproval.ownershipEvidenceReference) return { error: [409, 'BANK_ACCOUNT_OWNERSHIP_EVIDENCE_REQUIRED', 'Account ownership evidence must be recorded before consent approval.'] };
    consent.status = 'APPROVED'; consent.approvedBy = context.actorId; consent.approvedAt = now;
    await consent.save({ session });
    const account = await BankAccount.findOneAndUpdate(
      { _id: consent.bankAccountId, tenantId: context.tenantId, status: { $in: ['PENDING', 'ACTIVE'] }, authorizationStatus: { $in: ['PENDING', 'EVIDENCE_REVIEWED'] } },
      { $set: { consentStatus: 'APPROVED', consentExpiresAt: consent.validUntil, authorizationStatus: 'EVIDENCE_REVIEWED', status: 'ACTIVE', updatedBy: context.actorId } },
      { new: true, session },
    );
    if (!account) throw Object.assign(new Error('Bank account state changed during consent approval.'), { code: 'BANK_ACCOUNT_STATE_CONFLICT', statusCode: 409 });
    await writeAudit(req, { action: 'BANKCONNECT_CONSENT_APPROVED', entityType: 'BANK_CONSENT', entityId: consent._id, metadata: { bankAccountId: String(account._id), scopes: consent.scopes, makerChecker: true }, session });
    return { consent, account };
  });
  if (result.error) return fail(res, ...result.error, req);
  return res.json({ success: true, data: { id: String(result.consent._id), status: result.consent.status, account: accountDto(result.account) } });
}));

router.patch('/consents/:consentId/revoke', requirePermission(ACCOUNT_MANAGE), asyncHandler(async (req, res) => {
  const context = requireTrustedContext(req, res);
  if (!context) return;
  if (!mongoose.isValidObjectId(req.params.consentId)) return fail(res, 400, 'BANK_CONSENT_ID_INVALID', 'Consent identifier is invalid.', req);
  const result = await withMongoTransaction(async (session) => {
    const consent = await BankConsent.findOne({ _id: req.params.consentId, tenantId: context.tenantId }).session(session);
    if (!consent) return { error: [404, 'BANK_CONSENT_NOT_FOUND', 'Consent was not found in this institution.'] };
    if (consent.status === 'REVOKED') return { consent, alreadyRevoked: true };
    const wasApproved = consent.status === 'APPROVED';
    consent.status = 'REVOKED'; consent.revokedBy = context.actorId; consent.revokedAt = new Date();
    consent.revocationReason = String(req.body?.reason || 'Revoked by authorized institution representative').trim().slice(0, 500);
    await consent.save({ session });
    if (wasApproved) {
      await BankAccount.updateOne({ _id: consent.bankAccountId, tenantId: context.tenantId }, { $set: { consentStatus: 'REVOKED', authorizationStatus: 'REVOKED', status: 'SUSPENDED', updatedBy: context.actorId } }, { session });
    } else {
      await BankAccount.updateOne({ _id: consent.bankAccountId, tenantId: context.tenantId, consentStatus: 'REQUESTED' }, { $set: { consentStatus: 'NOT_REQUESTED', updatedBy: context.actorId } }, { session });
    }
    await writeAudit(req, { action: 'BANKCONNECT_CONSENT_REVOKED', entityType: 'BANK_CONSENT', entityId: consent._id, metadata: { bankAccountId: String(consent.bankAccountId), scopes: consent.scopes, wasApproved }, session });
    return { consent };
  });
  if (result.error) return fail(res, ...result.error, req);
  return res.json({ success: true, data: { id: String(result.consent._id), status: result.consent.status, revokedAt: result.consent.revokedAt } });
}));

router.get('/consents', requirePermission(VIEW), asyncHandler(async (req, res) => {
  const context = requireTrustedContext(req, res);
  if (!context) return;
  const { page, limit, skip } = pagination(req);
  const filter = { tenantId: context.tenantId };
  const [items, total] = await Promise.all([
    BankConsent.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    BankConsent.countDocuments(filter),
  ]);
  return res.json({ success: true, data: { items: items.map((item) => ({ id: String(item._id), accountId: String(item.bankAccountId), scopes: item.scopes, status: item.status, validFrom: item.validFrom, validUntil: item.validUntil, createdAt: item.createdAt, approvedAt: item.approvedAt })), total, page, limit } });
}));

router.post('/statements/import/:accountId', requirePermission(STATEMENT_IMPORT), express.raw({ type: () => true, limit: STATEMENT_UPLOAD_MAX_BYTES }), asyncHandler(async (req, res) => {
  const context = requireTrustedContext(req, res);
  if (!context) return;
  const authorized = await getAccountWithActiveStatementConsent(context.tenantId, req.params.accountId);
  if (!authorized) return fail(res, 403, 'BANK_ACCOUNT_CONSENT_REQUIRED', 'The account must have reviewed ownership evidence and a current approved statement-data consent before importing.', req);
  const filenameHeader = String(req.get('x-statement-filename') || '').trim();
  const filename = filenameHeader.split(/[\\/]/).pop();
  if (!filename || filename.length > 255 || /[\u0000-\u001f]/.test(filename) || !Buffer.isBuffer(req.body)) return fail(res, 400, 'BANK_STATEMENT_FILE_REQUIRED', 'Send the file as a raw request body with the X-Statement-Filename header.', req);
  if (req.body.length > STATEMENT_UPLOAD_MAX_BYTES) return fail(res, 413, 'BANK_STATEMENT_TOO_LARGE', 'Statement file exceeds the 5 MiB limit.', req);
  const mimeType = String(req.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const extension = filename.toLowerCase().split('.').pop();
  const allowedMimeByExtension = {
    csv: new Set(['text/csv', 'application/csv', 'text/plain', 'application/octet-stream']),
    xlsx: new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream']),
    mt940: new Set(['text/plain', 'application/octet-stream', 'application/mt940']),
    sta: new Set(['text/plain', 'application/octet-stream', 'application/mt940']),
    xml: new Set(['application/xml', 'text/xml', 'application/octet-stream']),
  };
  if (!allowedMimeByExtension[extension]?.has(mimeType)) return fail(res, 415, 'BANK_STATEMENT_MIME_MISMATCH', 'Statement file extension and MIME type are not a supported combination.', req);
  const sourceHash = crypto.createHash('sha256').update(req.body).digest('hex');
  const existing = await BankStatementImport.findOne({ tenantId: context.tenantId, bankAccountId: authorized.account._id, sourceHash }).lean();
  if (existing) return res.status(200).json({ success: true, data: statementDto(existing), duplicateImport: true });
  await scanDocumentBuffer(req.body);
  const parsed = await parseBankStatement({ filename, mimeType, buffer: req.body, defaultCurrency: authorized.account.currency });
  if (parsed.transactions.some((transaction) => transaction.currency !== authorized.account.currency)) return fail(res, 422, 'BANK_STATEMENT_CURRENCY_MISMATCH', 'Every imported transaction must use the currency registered for this bank account. Multi-currency accounts require separate verified account records.', req);
  const institution = getBankInstitution(authorized.account.institutionId);
  if (!institution?.statementFormats.includes(parsed.format)) return fail(res, 415, 'BANK_STATEMENT_FORMAT_NOT_ALLOWED', 'This bank profile does not list the detected statement format as a supported import capability.', req);
  const sourceEvidence = encryptBankEvidence(req.body);
  const dates = parsed.transactions.map((item) => item.bookingDate).sort((a, b) => a - b);
  const fingerprints = parsed.transactions.map((item) => crypto.createHash('sha256').update([item.bookingDate.toISOString(), item.debitMinor, item.creditMinor, item.currency, item.description.toLowerCase().replace(/\s+/g, ' ').trim()].join('|')).digest('hex'));
  const externalIds = [...new Set(parsed.transactions.map((item) => item.externalTransactionId).filter(Boolean).map((item) => String(item).toUpperCase()))];
  const duplicateEvidenceQuery = [{ fingerprintHash: { $in: [...new Set(fingerprints)] } }];
  if (externalIds.length) duplicateEvidenceQuery.push({ externalTransactionId: { $in: externalIds } });
  const existingDuplicateEvidence = await BankTransaction.find({ tenantId: context.tenantId, bankAccountId: authorized.account._id, $or: duplicateEvidenceQuery }).select('fingerprintHash externalTransactionId').lean();
  const knownFingerprints = new Set(existingDuplicateEvidence.map((item) => item.fingerprintHash));
  const knownExternalIds = new Set(existingDuplicateEvidence.map((item) => item.externalTransactionId).filter(Boolean).map((item) => String(item).toUpperCase()));
  const seenFingerprints = new Set();
  const seenExternalIds = new Set();
  const potentialFlags = parsed.transactions.map((transaction, index) => {
    const externalId = transaction.externalTransactionId ? String(transaction.externalTransactionId).toUpperCase() : null;
    const duplicate = knownFingerprints.has(fingerprints[index]) || seenFingerprints.has(fingerprints[index]) || (externalId && (knownExternalIds.has(externalId) || seenExternalIds.has(externalId)));
    seenFingerprints.add(fingerprints[index]);
    if (externalId) seenExternalIds.add(externalId);
    return Boolean(duplicate);
  });
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const [importRecord] = await BankStatementImport.create([{
        tenantId: context.tenantId, bankAccountId: authorized.account._id, filename, format: parsed.format,
        mimeType, sourceHash, sourceSizeBytes: req.body.length, sourceEvidence,
        status: 'IMPORTED', transactionCount: parsed.transactions.length, insertedCount: 0,
        duplicateCount: 0, potentialDuplicateCount: potentialFlags.filter(Boolean).length,
        periodStart: dates[0], periodEnd: dates.at(-1), uploadedBy: context.actorId,
      }], { session });
      const operations = parsed.transactions.map((transaction, index) => {
        // Only a bank-issued transaction ID is treated as a stable idempotency
        // identity. Payment references can legitimately recur; keep those rows
        // as evidence and mark ambiguous fingerprints for investigation.
        const identity = transaction.externalTransactionId
          ? `BANK_ID:${String(transaction.externalTransactionId).toUpperCase()}|${fingerprints[index]}`
          : `SOURCE:${sourceHash}:${transaction.sourceRow}`;
        const idempotencyKey = crypto.createHash('sha256').update(`${authorized.account._id}|${identity}`).digest('hex');
        return {
          updateOne: {
            filter: { tenantId: context.tenantId, bankAccountId: authorized.account._id, idempotencyKey },
            update: { $setOnInsert: {
              tenantId: context.tenantId, bankAccountId: authorized.account._id, statementImportId: importRecord._id,
              idempotencyKey, externalTransactionId: transaction.externalTransactionId,
              transactionReference: transaction.transactionReference, endToEndReference: transaction.endToEndReference,
              bookingDate: transaction.bookingDate, valueDate: transaction.valueDate, description: transaction.description,
              debitMinor: transaction.debitMinor, creditMinor: transaction.creditMinor, currency: transaction.currency,
              fingerprintHash: fingerprints[index], sourceRow: transaction.sourceRow,
              reconciliationStatus: potentialFlags[index] ? 'POTENTIAL_DUPLICATE' : 'UNMATCHED', potentialDuplicate: potentialFlags[index],
            } },
            upsert: true,
          },
        };
      });
      const bulkResult = operations.length ? await BankTransaction.bulkWrite(operations, { ordered: false, session }) : { upsertedCount: 0 };
      const insertedCount = Number(bulkResult.upsertedCount || 0);
      const duplicateCount = parsed.transactions.length - insertedCount;
      importRecord.insertedCount = insertedCount;
      importRecord.duplicateCount = duplicateCount;
      await importRecord.save({ session });
      await writeAudit(req, {
        action: 'BANKCONNECT_STATEMENT_IMPORTED', entityType: 'BANK_STATEMENT_IMPORT',
        entityId: importRecord._id, session,
        metadata: { bankAccountId: String(authorized.account._id), institutionId: authorized.account.institutionId,
          format: parsed.format, sourceHash, transactionCount: parsed.transactions.length,
          insertedCount, duplicateCount, potentialDuplicateCount: potentialFlags.filter(Boolean).length },
      });
      result = statementDto(importRecord);
    });
  } catch (error) {
    if (error?.code === 11000) {
      const duplicate = await BankStatementImport.findOne({ tenantId: context.tenantId, bankAccountId: authorized.account._id, sourceHash }).lean();
      if (duplicate) return res.status(200).json({ success: true, data: statementDto(duplicate), duplicateImport: true });
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return res.status(201).json({ success: true, data: result, duplicateImport: false, financialPosting: 'NOT_PERFORMED_STATEMENT_EVIDENCE_ONLY' });
}));

router.get('/statements', requirePermission(VIEW), asyncHandler(async (req, res) => {
  const context = requireTrustedContext(req, res);
  if (!context) return;
  const { page, limit, skip } = pagination(req);
  const filter = { tenantId: context.tenantId };
  if (req.query.accountId && mongoose.isValidObjectId(req.query.accountId)) filter.bankAccountId = req.query.accountId;
  const [items, total] = await Promise.all([
    BankStatementImport.find(filter).sort({ importedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    BankStatementImport.countDocuments(filter),
  ]);
  return res.json({ success: true, data: { items: items.map(statementDto), total, page, limit, pages: Math.ceil(total / limit) } });
}));

router.get('/transactions', requirePermission(VIEW), asyncHandler(async (req, res) => {
  const context = requireTrustedContext(req, res);
  if (!context) return;
  const { page, limit, skip } = pagination(req);
  const filter = { tenantId: context.tenantId };
  if (req.query.accountId && mongoose.isValidObjectId(req.query.accountId)) filter.bankAccountId = req.query.accountId;
  if (req.query.status) filter.reconciliationStatus = String(req.query.status).toUpperCase();
  const [items, total] = await Promise.all([
    BankTransaction.find(filter).sort({ bookingDate: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    BankTransaction.countDocuments(filter),
  ]);
  return res.json({ success: true, data: { items: items.map(transactionDto), total, page, limit, pages: Math.ceil(total / limit) } });
}));

router.get('/reconciliation', requirePermission(VIEW), asyncHandler(async (req, res) => {
  const context = requireTrustedContext(req, res);
  if (!context) return;
  const { page, limit, skip } = pagination(req);
  const filter = { tenantId: context.tenantId, reconciliationStatus: { $in: ['UNMATCHED', 'POTENTIAL_DUPLICATE', 'EXCEPTION'] } };
  const [items, total] = await Promise.all([
    BankTransaction.find(filter).sort({ bookingDate: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    BankTransaction.countDocuments(filter),
  ]);
  return res.json({ success: true, data: { items: items.map(transactionDto), total, page, limit, pages: Math.ceil(total / limit), postingEnabled: false } });
}));

router.get('/connections', requirePermission(VIEW), (_req, res) => res.json({ success: true, data: BANK_INSTITUTIONS.map((bank) => ({ institutionId: bank.id, institutionName: bank.name, connectorStatus: bank.connectorStatus, connectionStatus: bank.connectionStatus, integrationMethods: bank.integrationMethods, apiConnectivity: 'NOT_CONNECTED', productionApproved: false })) }));
router.get('/integration-health', requirePermission(VIEW), (_req, res) => res.json({ success: true, data: { status: 'DEGRADED_NO_BANK_API_CONNECTIONS', statementImport: 'LOCAL_CAPABILITY_AVAILABLE', evidenceEncryptionConfigured: isBankEvidenceEncryptionConfigured(), malwareScannerConfigured: isDocumentMalwareScannerConfigured(), bankApiConnections: 0, paymentExecutionEnabled: false, productionApproved: false, institutions: BANK_INSTITUTIONS.map((bank) => ({ id: bank.id, connectorStatus: bank.connectorStatus, connectionStatus: bank.connectionStatus, sandboxStatus: bank.sandboxStatus, partnershipStatus: bank.partnershipStatus })) } }));
router.get('/payment-instructions', requirePermission(VIEW), (_req, res) => res.json({ success: true, data: { items: [], total: 0, executionEnabled: false, reason: 'Bank payment execution is disabled pending bank authorization, regulatory assessment, production credentials, independent security review and formal TITech approval.' } }));
router.post('/payment-instructions', requirePermission(ACCOUNT_MANAGE), (req, res) => fail(res, 423, 'BANK_PAYMENT_EXECUTION_DISABLED', 'Bank payment instructions cannot be executed or transmitted. The capability remains disabled pending required external and internal approvals.', req));

router.get('/audit', requirePermission(AUDIT_VIEW), asyncHandler(async (req, res) => {
  const context = requireTrustedContext(req, res);
  if (!context) return;
  const AuditLog = (await import('../../models/AuditLog.js')).default;
  const { page, limit, skip } = pagination(req);
  const tenantObjectId = new mongoose.Types.ObjectId(String(req.tenant._id));
  const filter = { tenantId: tenantObjectId, scope: 'TENANT', action: /^BANKCONNECT_/ };
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).select('action userId entityType entityId outcome metadata createdAt requestId correlationId currentHash').lean(),
    AuditLog.countDocuments(filter),
  ]);
  return res.json({ success: true, data: { items: items.map((item) => ({ id: String(item._id), action: item.action, actorId: item.userId ? String(item.userId) : null, entityType: item.entityType, entityId: item.entityId ? String(item.entityId) : null, outcome: item.outcome, metadata: item.metadata || {}, occurredAt: item.createdAt, requestId: item.requestId, correlationId: item.correlationId, integrityHash: item.currentHash })), total, page, limit } });
}));

router.get('/reports/reconciliation', requirePermission(VIEW), asyncHandler(async (req, res) => {
  const context = requireTrustedContext(req, res);
  if (!context) return;
  const [totalTransactions, unmatched, potentialDuplicates, reconciled] = await Promise.all([
    BankTransaction.countDocuments({ tenantId: context.tenantId }),
    BankTransaction.countDocuments({ tenantId: context.tenantId, reconciliationStatus: 'UNMATCHED' }),
    BankTransaction.countDocuments({ tenantId: context.tenantId, potentialDuplicate: true }),
    BankTransaction.countDocuments({ tenantId: context.tenantId, reconciliationStatus: 'RECONCILED' }),
  ]);
  return res.json({ success: true, data: { totalTransactions, unmatched, potentialDuplicates, reconciled, matchedByBankConnect: 0, ledgerPosting: 'NOT_CONNECTED', productionApproved: false } });
}));

router.use((error, _req, res, _next) => {
  const status = Number(error?.statusCode) || (error?.type === 'entity.too.large' ? 413 : 500);
  const code = error?.code || (status === 413 ? 'BANK_STATEMENT_TOO_LARGE' : 'BANKCONNECT_REQUEST_FAILED');
  const message = status >= 500 ? 'BankConnect could not complete the request. The operation was not represented as successful.' : error?.message || 'BankConnect request is invalid.';
  return res.status(status).json({ success: false, error: { code, message }, requestId: res.getHeader('X-Request-Id') || null });
});

export default router;
