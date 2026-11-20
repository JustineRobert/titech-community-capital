'use strict';

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const dns = require('node:dns').promises;
const net = require('node:net');

const PayrollBatch = require('./models/PayrollBatch.cjs');
const PayrollTransaction = require('./models/PayrollTransaction.cjs');
const PayrollApproval = require('./models/PayrollApproval.cjs');
const WebhookSubscription = require('./models/WebhookSubscription.cjs');
const { parseCsv } = require('./payroll.csv.cjs');
const { PayrollError } = require('./payroll.errors.cjs');
const { PayrollProviderGateway } = require('./payroll.providerGateway.cjs');
const { PayrollFinancialGateway } = require('./payroll.financialGateway.cjs');
const {
  PAYROLL_ROLES,
  BATCH_STATUS,
  TRANSACTION_STATUS,
  FINANCIAL_POSTING_STATUS,
  WEBHOOK_EVENTS,
  AUDIT_ACTIONS,
  MAX_PAGE_SIZE,
  WEBHOOK_DELIVERY_TIMEOUT_MS,
} = require('./payroll.constants.cjs');
const {
  encryptSecret,
  decryptSecret,
  generateWebhookSecret,
  signWebhookPayload,
} = require('./payroll.crypto.cjs');

const { normalizePayrollRole } = require('./payroll.authorization.cjs');
const { assertTransition, assertRoleForTransition, assertMakerCheckerSeparation } = require('./payroll.stateMachine.cjs');

let auditServicePromise;
let auditModelPromise;

const normalizeRole = normalizePayrollRole;

function employerIdFor(req) {
  return String(req.user?.employerId || req.user?.tenantId || req.tenantId || req.tenantContext?.tenantId || '').trim();
}

function requireTenant(req) {
  const tenantId = employerIdFor(req);
  if (!tenantId) throw new PayrollError('PAYROLL_TENANT_REQUIRED', 'Authenticated employer tenant context is required.', 403);
  return tenantId;
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function serializeDecimal(value) {
  return value === null || value === undefined ? '0' : String(value);
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  const blocked = /(?:password|secret|token|authorization|cookie|pin|otp|api[_-]?key|private[_-]?key)/i;
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !blocked.test(key)).slice(0, 40),
  );
}

function toPublicTransaction(transaction) {
  return {
    transactionId: transaction.transactionId,
    batchId: transaction.batchId,
    employeeId: transaction.employeeId,
    employeeName: transaction.employeeName,
    phoneNumber: transaction.phoneNumber,
    amount: serializeDecimal(transaction.amount),
    currency: transaction.currency,
    provider: transaction.provider,
    status: transaction.status,
    financialPostingStatus: transaction.financialPostingStatus,
    providerTransactionId: transaction.providerTransactionId || null,
    providerRef: transaction.providerRef || null,
    errorCode: transaction.errorCode || null,
    message: transaction.message || null,
    attemptCount: transaction.attemptCount,
    lastProviderUpdateAt: transaction.lastProviderUpdateAt,
    reconciledAt: transaction.reconciledAt,
  };
}

function toPublicBatch(batch) {
  return {
    batchId: batch.batchId,
    employerId: batch.employerId,
    fileName: batch.fileName,
    rowCount: batch.rowCount,
    totalAmount: serializeDecimal(batch.totalAmount),
    currency: batch.currency || null,
    status: batch.status,
    submittedAt: batch.submittedAt || null,
    submittedBy: batch.submittedBy || null,
    approvedAt: batch.approvedAt || null,
    approvedBy: batch.approvedBy || null,
    approvalReason: batch.approvalReason || null,
    processedCount: batch.processedCount,
    successCount: batch.successCount,
    failedCount: batch.failedCount,
    unknownCount: batch.unknownCount,
    reconciledCount: batch.reconciledCount,
    processedAt: batch.processedAt,
    reconciledAt: batch.reconciledAt,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

async function getAuditService() {
  auditServicePromise ||= import('../../modules/audit/audit.service.js');
  return auditServicePromise;
}

async function getAuditModel() {
  auditModelPromise ||= import('../../modules/audit/audit.model.js');
  return auditModelPromise;
}

async function withPayrollTransaction(operation) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await operation(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

function sumPayrollAmounts(rows) {
  let total = 0n;
  for (const row of rows) {
    const [whole, fraction = ''] = String(row.amount).split('.');
    total += BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  }
  return `${total / 1_000_000n}.${String(total % 1_000_000n).padStart(6, '0')}`;
}

function actorRoles(req) {
  return [req.user?.role, ...(Array.isArray(req.user?.roles) ? req.user.roles : [])].map(normalizePayrollRole).filter(Boolean);
}

async function writeAudit({ tenantId, action, data, actorId, requestId, correlationId, session = null }) {
  const audit = await getAuditService();
  return audit.createAuditLog({
    tenantId,
    action,
    actorId,
    requestId,
    correlationId,
    session,
    data: {
      auditLogId: makeId('audit'),
      employerId: tenantId,
      eventType: action,
      actor: actorId || null,
      timestamp: new Date().toISOString(),
      ...sanitizeMetadata(data),
    },
  });
}

async function callbackUrlIsPublic(callbackUrl) {
  let url;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new PayrollError('PAYROLL_CALLBACK_URL_INVALID', 'Callback URL must be a valid URL.', 400);
  }

  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new PayrollError('PAYROLL_CALLBACK_URL_SCHEME_INVALID', 'Callback URL must use HTTP or HTTPS.', 400);
  }
  if (url.username || url.password) {
    throw new PayrollError('PAYROLL_CALLBACK_URL_CREDENTIALS_INVALID', 'Callback URL may not contain embedded credentials.', 400);
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new PayrollError('PAYROLL_CALLBACK_HTTPS_REQUIRED', 'Production employer callbacks must use HTTPS.', 400);
  }

  const hostname = url.hostname.toLowerCase();
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new PayrollError('PAYROLL_CALLBACK_PRIVATE_NETWORK', 'Callback URL must resolve to a public address.', 400);
    return url;
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
      throw new PayrollError('PAYROLL_CALLBACK_PRIVATE_NETWORK', 'Callback URL must resolve to a public address.', 400);
    }
  } catch (error) {
    if (error instanceof PayrollError) throw error;
    throw new PayrollError('PAYROLL_CALLBACK_DNS_FAILED', 'Callback hostname could not be safely resolved.', 400);
  }

  return url;
}

function isPrivateIp(address) {
  const normalized = String(address).toLowerCase();
  if (net.isIPv4(normalized)) {
    const octets = normalized.split('.').map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(normalized)) {
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
  }
  return true;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_DELIVERY_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timeout);
  }
}

class PayrollService {
  constructor({ serviceRegistry = null, context = null, logger = console } = {}) {
    this.serviceRegistry = serviceRegistry;
    this.context = context;
    this.logger = logger;
    this.providerGateway = new PayrollProviderGateway({ serviceRegistry, context, logger });
    this.financialGateway = new PayrollFinancialGateway({ serviceRegistry, context });
  }

  async uploadPayroll({ req, tenantId, actorId, fileName, csvText, idempotencyKey, defaultProvider }) {
    if (typeof csvText !== 'string') throw new PayrollError('PAYROLL_CSV_REQUIRED', 'CSV payroll content is required.', 400);
    const uploadFingerprint = crypto.createHash('sha256').update(csvText, 'utf8').digest('hex');
    const rows = parseCsv(csvText);
    const currencies = [...new Set(rows.map((row) => row.currency))];
    if (currencies.length !== 1) throw new PayrollError('PAYROLL_MULTI_CURRENCY_BATCH', 'A single payroll batch must use one currency.', 400);
    const currency = currencies[0];
    const totalAmount = sumPayrollAmounts(rows);
    return withPayrollTransaction(async (session) => {
      const existing = await PayrollBatch.findOne({ tenantId, uploadIdempotencyKey: idempotencyKey }).session(session).lean();
      if (existing) {
        if (existing.uploadFingerprint !== uploadFingerprint) throw new PayrollError('PAYROLL_IDEMPOTENCY_CONFLICT', 'The upload idempotency key was already used with different file content.', 409);
        return { batch: toPublicBatch(existing), replay: true };
      }
      const batchId = makeId('payroll_batch');
      const batch = (await PayrollBatch.create([{
        batchId, tenantId, employerId: tenantId, uploadedBy: actorId,
        uploadIdempotencyKey: idempotencyKey,
        uploadFingerprint,
        fileName: String(fileName || 'payroll.csv').slice(0, 255),
        rowCount: rows.length, totalAmount, currency, status: BATCH_STATUS.UPLOADED,
      }], { session }))[0];
      const documents = rows.map((row) => ({
        transactionId: makeId('payroll_tx'), tenantId, employerId: tenantId, batchId,
        employeeId: row.employeeId, employeeName: row.employeeName, phoneNumber: row.phoneNumber,
        amount: row.amount, currency: row.currency, provider: row.provider || defaultProvider || 'MTN_MOMO',
        status: TRANSACTION_STATUS.PENDING, financialPostingStatus: FINANCIAL_POSTING_STATUS.PENDING,
        attemptCount: 0, idempotencyKey: `${batchId}:${row.employeeId}`, metadata: {},
      }));
      await PayrollTransaction.insertMany(documents, { ordered: true, session });
      await writeAudit({ tenantId, actorId, requestId: req.requestId, correlationId: req.correlationId,
        action: AUDIT_ACTIONS.PAYROLL_UPLOAD,
        data: { batchId, fileName: batch.fileName, rowCount: rows.length, currency, totalAmount, uploadFingerprint }, session });
      return { batch: toPublicBatch(batch), replay: false };
    });
  }

  async submitForApproval({ req, tenantId, actorId, batchId }) {
    const roles = actorRoles(req);
    assertRoleForTransition('submit', roles);
    return withPayrollTransaction(async (session) => {
      const batch = await PayrollBatch.findOne({ tenantId, batchId }).session(session);
      if (!batch) throw new PayrollError('PAYROLL_BATCH_NOT_FOUND', 'Payroll batch was not found.', 404);
      if (batch.status === BATCH_STATUS.PENDING_APPROVAL) return { batch: toPublicBatch(batch), replay: true };
      assertTransition(batch.status, BATCH_STATUS.PENDING_APPROVAL);
      const count = await PayrollTransaction.countDocuments({ tenantId, batchId }).session(session);
      if (!count || count !== batch.rowCount) throw new PayrollError('PAYROLL_BATCH_INCOMPLETE', 'Payroll batch rows are incomplete and cannot be submitted.', 409);
      const previousState = batch.status;
      batch.status = BATCH_STATUS.PENDING_APPROVAL;
      batch.submittedBy = actorId;
      batch.submittedAt = new Date();
      await batch.save({ session });
      await PayrollApproval.create([{ approvalId: makeId('payroll_approval'), tenantId, batchId, action: 'SUBMITTED', actorId, actorRole: roles.join(',') || 'UNKNOWN', previousState, nextState: batch.status, requestId: req.requestId || null, correlationId: req.correlationId || null }], { session });
      await writeAudit({ tenantId, actorId, requestId: req.requestId, correlationId: req.correlationId, action: 'PAYROLL_BATCH_SUBMITTED_FOR_APPROVAL', data: { batchId, previousState, nextState: batch.status, rowCount: count, currency: batch.currency, totalAmount: serializeDecimal(batch.totalAmount) }, session });
      return { batch: toPublicBatch(batch), replay: false };
    });
  }

  async approveBatch({ req, tenantId, actorId, batchId }) {
    const roles = actorRoles(req);
    assertRoleForTransition('approve', roles);
    return withPayrollTransaction(async (session) => {
      const batch = await PayrollBatch.findOne({ tenantId, batchId }).session(session);
      if (!batch) throw new PayrollError('PAYROLL_BATCH_NOT_FOUND', 'Payroll batch was not found.', 404);
      assertMakerCheckerSeparation(batch.uploadedBy, actorId);
      if (batch.status === BATCH_STATUS.APPROVED && String(batch.approvedBy) === String(actorId)) return { batch: toPublicBatch(batch), replay: true };
      assertTransition(batch.status, BATCH_STATUS.APPROVED);
      if (batch.status !== BATCH_STATUS.PENDING_APPROVAL || !batch.submittedAt) throw new PayrollError('PAYROLL_BATCH_NOT_SUBMITTED', 'A submitted payroll batch is required before approval.', 409);
      const previousState = batch.status;
      batch.status = BATCH_STATUS.APPROVED; batch.approvedBy = actorId; batch.approvedAt = new Date(); batch.approvalReason = null;
      await batch.save({ session });
      await PayrollApproval.create([{ approvalId: makeId('payroll_approval'), tenantId, batchId, action: 'APPROVED', actorId, actorRole: roles.join(',') || 'UNKNOWN', previousState, nextState: batch.status, requestId: req.requestId || null, correlationId: req.correlationId || null }], { session });
      await writeAudit({ tenantId, actorId, requestId: req.requestId, correlationId: req.correlationId, action: 'PAYROLL_BATCH_APPROVED', data: { batchId, previousState, nextState: batch.status, submittedBy: batch.submittedBy, approvedBy: actorId }, session });
      return { batch: toPublicBatch(batch), replay: false };
    });
  }

  async rejectBatch({ req, tenantId, actorId, batchId, reason }) {
    const roles = actorRoles(req);
    assertRoleForTransition('reject', roles);
    const normalizedReason = String(reason || '').trim();
    if (normalizedReason.length < 5 || normalizedReason.length > 1000) throw new PayrollError('PAYROLL_REJECTION_REASON_REQUIRED', 'A rejection reason between 5 and 1000 characters is required.', 422);
    return withPayrollTransaction(async (session) => {
      const batch = await PayrollBatch.findOne({ tenantId, batchId }).session(session);
      if (!batch) throw new PayrollError('PAYROLL_BATCH_NOT_FOUND', 'Payroll batch was not found.', 404);
      assertMakerCheckerSeparation(batch.uploadedBy, actorId);
      assertTransition(batch.status, BATCH_STATUS.REJECTED);
      const previousState = batch.status;
      batch.status = BATCH_STATUS.REJECTED; batch.rejectedBy = actorId; batch.rejectedAt = new Date(); batch.approvalReason = normalizedReason;
      await batch.save({ session });
      await PayrollApproval.create([{ approvalId: makeId('payroll_approval'), tenantId, batchId, action: 'REJECTED', actorId, actorRole: roles.join(',') || 'UNKNOWN', reason: normalizedReason, previousState, nextState: batch.status, requestId: req.requestId || null, correlationId: req.correlationId || null }], { session });
      await writeAudit({ tenantId, actorId, requestId: req.requestId, correlationId: req.correlationId, action: 'PAYROLL_BATCH_REJECTED', data: { batchId, previousState, nextState: batch.status, reason: normalizedReason }, session });
      return { batch: toPublicBatch(batch), replay: false };
    });
  }

  async refreshBatchStats(tenantId, batchId) {
    const grouped = await PayrollTransaction.aggregate([
      { $match: { tenantId, batchId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const stats = Object.fromEntries(grouped.map((item) => [item._id, item.count]));
    const rowCount = await PayrollTransaction.countDocuments({ tenantId, batchId });
    const terminal = (stats.SUCCESS || 0) + (stats.FAILED || 0);
    let status = BATCH_STATUS.PROCESSING;
    if (rowCount && terminal === rowCount) {
      status = stats.SUCCESS === rowCount ? BATCH_STATUS.PROCESSED : (stats.FAILED === rowCount ? BATCH_STATUS.FAILED : BATCH_STATUS.PARTIALLY_PROCESSED);
    } else if (stats.SUCCESS || stats.FAILED) {
      status = BATCH_STATUS.PARTIALLY_PROCESSED;
    }

    const reconciledCount = await PayrollTransaction.countDocuments({ tenantId, batchId, reconciledAt: { $ne: null } });
    const finalStateCount = await PayrollTransaction.countDocuments({ tenantId, batchId, status: { $in: [TRANSACTION_STATUS.SUCCESS, TRANSACTION_STATUS.FAILED] } });
    const successCount = stats.SUCCESS || 0;
    const postedSuccessCount = await PayrollTransaction.countDocuments({
      tenantId,
      batchId,
      status: TRANSACTION_STATUS.SUCCESS,
      financialPostingStatus: FINANCIAL_POSTING_STATUS.POSTED,
    });
    const reconciled =
      finalStateCount === rowCount &&
      postedSuccessCount === successCount &&
      rowCount > 0;
    if (reconciled) status = BATCH_STATUS.RECONCILED;

    return PayrollBatch.findOneAndUpdate(
      { tenantId, batchId },
      {
        $set: {
          status,
          processedCount: terminal,
          successCount: stats.SUCCESS || 0,
          failedCount: stats.FAILED || 0,
          unknownCount: (stats.UNKNOWN || 0) + (stats.PROCESSING || 0) + (stats.PENDING || 0) + (stats.RETRYING || 0),
          reconciledCount,
          processedAt: terminal === rowCount && rowCount > 0 ? new Date() : null,
          reconciledAt: reconciled ? new Date() : null,
        },
      },
      { new: true },
    ).lean();
  }

  async finalizeFinancialPosting({ tenantId, batchId, transaction }) {
    const financial = await this.financialGateway.postPayrollDisbursement({
      tenantId,
      payrollBatchId: batchId,
      payrollTransactionId: transaction.transactionId,
      employeeId: transaction.employeeId,
      amount: serializeDecimal(transaction.amount),
      currency: transaction.currency,
      provider: transaction.provider,
      providerTransactionId: transaction.providerTransactionId || null,
      idempotencyKey: transaction.idempotencyKey,
    });

    const postingStatus =
      financial.status === 'POSTED' || financial.status === 'SUCCESS'
        ? FINANCIAL_POSTING_STATUS.POSTED
        : FINANCIAL_POSTING_STATUS.REQUIRES_REVIEW;

    await PayrollTransaction.updateOne(
      { tenantId, transactionId: transaction.transactionId },
      { $set: { financialPostingStatus: postingStatus } },
    );

    return postingStatus;
  }

  async processBatch({ req, tenantId, actorId, batchId }) {
    const batch = await PayrollBatch.findOne({ tenantId, batchId }).lean();
    if (!batch) throw new PayrollError('PAYROLL_BATCH_NOT_FOUND', 'Payroll batch was not found.', 404);
    if (batch.status === BATCH_STATUS.PROCESSING) throw new PayrollError('PAYROLL_BATCH_ALREADY_PROCESSING', 'Payroll batch is already processing.', 409);
    if (batch.status === BATCH_STATUS.RECONCILED) throw new PayrollError('PAYROLL_BATCH_FINAL', 'Reconciled payroll batches cannot be reprocessed.', 409);
    if (batch.status !== BATCH_STATUS.APPROVED || !batch.approvedAt || !batch.approvedBy) throw new PayrollError('PAYROLL_BATCH_NOT_APPROVED', 'Payroll processing requires a recorded independent approval.', 409);

    const claim = await PayrollBatch.updateOne({ tenantId, batchId, status: BATCH_STATUS.APPROVED, approvedAt: { $ne: null } }, { $set: { status: BATCH_STATUS.PROCESSING } });
    if (!claim.modifiedCount) throw new PayrollError('PAYROLL_BATCH_ALREADY_CLAIMED', 'Payroll batch was concurrently claimed or its approval is no longer valid.', 409);
    const transactions = await PayrollTransaction.find({ tenantId, batchId, status: { $in: [TRANSACTION_STATUS.PENDING, TRANSACTION_STATUS.RETRYING] } }).lean();

    for (const tx of transactions) {
      const claimed = await PayrollTransaction.findOneAndUpdate(
        { tenantId, transactionId: tx.transactionId, status: { $in: [TRANSACTION_STATUS.PENDING, TRANSACTION_STATUS.RETRYING] } },
        { $set: { status: TRANSACTION_STATUS.PROCESSING }, $inc: { attemptCount: 1 } },
        { new: true },
      ).lean();
      if (!claimed) continue;

      const providerResult = await this.providerGateway.disburse({
        provider: claimed.provider,
        tenantId,
        amount: serializeDecimal(claimed.amount),
        currency: claimed.currency,
        phoneNumber: claimed.phoneNumber,
        idempotencyKey: claimed.idempotencyKey,
        transactionId: claimed.transactionId,
        employeeId: claimed.employeeId,
        employeeName: claimed.employeeName,
        correlationId: req.correlationId,
      });

      const nextStatus = providerResult.status === 'SUCCESS' ? TRANSACTION_STATUS.SUCCESS : providerResult.status === 'FAILED' ? TRANSACTION_STATUS.FAILED : TRANSACTION_STATUS.UNKNOWN;
      await PayrollTransaction.updateOne(
        { tenantId, transactionId: claimed.transactionId },
        {
          $set: {
            status: nextStatus,
            providerTransactionId: providerResult.providerTransactionId || claimed.providerTransactionId,
            providerRef: providerResult.providerRef || claimed.providerRef,
            errorCode: providerResult.errorCode || null,
            message: providerResult.message || null,
            lastProviderUpdateAt: new Date(),
          },
        },
      );

      if (nextStatus === TRANSACTION_STATUS.SUCCESS) {
        await this.finalizeFinancialPosting({
          tenantId,
          batchId,
          transaction: {
            ...claimed,
            providerTransactionId: providerResult.providerTransactionId || claimed.providerTransactionId,
          },
        });
      }
    }

    const updatedBatch = await this.refreshBatchStats(tenantId, batchId);
    await writeAudit({
      tenantId,
      actorId,
      requestId: req.requestId,
      correlationId: req.correlationId,
      action: AUDIT_ACTIONS.PAYROLL_BATCH_PROCESSED,
      data: { batchId, status: updatedBatch.status, processedCount: updatedBatch.processedCount, successCount: updatedBatch.successCount, failedCount: updatedBatch.failedCount, unknownCount: updatedBatch.unknownCount },
    });

    if ([BATCH_STATUS.PROCESSED, BATCH_STATUS.RECONCILED, BATCH_STATUS.PARTIALLY_PROCESSED, BATCH_STATUS.FAILED].includes(updatedBatch.status)) {
      await this.dispatchEvent(tenantId, WEBHOOK_EVENTS.BATCH_PROCESSED, { batch: toPublicBatch(updatedBatch) }, req);
    }

    return { batch: toPublicBatch(updatedBatch) };
  }

  async reconcileBatch({ req, tenantId, actorId, batchId }) {
    const batch = await PayrollBatch.findOne({ tenantId, batchId }).lean();
    if (!batch) throw new PayrollError('PAYROLL_BATCH_NOT_FOUND', 'Payroll batch was not found.', 404);

    const transactions = await PayrollTransaction.find({ tenantId, batchId }).lean();
    for (const tx of transactions) {
      if (![TRANSACTION_STATUS.PROCESSING, TRANSACTION_STATUS.UNKNOWN, TRANSACTION_STATUS.PENDING].includes(tx.status)) continue;
      const reference = tx.providerTransactionId || tx.providerRef;
      if (!reference) continue;
      const result = await this.providerGateway.getStatus({ provider: tx.provider, reference });
      const status = result.status === 'SUCCESS' ? TRANSACTION_STATUS.SUCCESS : result.status === 'FAILED' ? TRANSACTION_STATUS.FAILED : TRANSACTION_STATUS.UNKNOWN;
      await PayrollTransaction.updateOne(
        { tenantId, transactionId: tx.transactionId },
        { $set: { status, providerRef: result.providerRef || tx.providerRef, lastProviderUpdateAt: new Date(), errorCode: result.errorCode || null, message: result.message || null, reconciledAt: status === TRANSACTION_STATUS.FAILED ? new Date() : null } },
      );

      if (status === TRANSACTION_STATUS.SUCCESS) {
        await this.finalizeFinancialPosting({
          tenantId,
          batchId,
          transaction: {
            ...tx,
            status,
            providerRef: result.providerRef || tx.providerRef,
          },
        });
        const posted = await PayrollTransaction.findOne({ tenantId, transactionId: tx.transactionId }).lean();
        if (posted?.financialPostingStatus === FINANCIAL_POSTING_STATUS.POSTED) {
          await PayrollTransaction.updateOne(
            { tenantId, transactionId: tx.transactionId },
            { $set: { reconciledAt: new Date() } },
          );
        }
      }
    }

    const updatedBatch = await this.refreshBatchStats(tenantId, batchId);
    await writeAudit({
      tenantId,
      actorId,
      requestId: req.requestId,
      correlationId: req.correlationId,
      action: AUDIT_ACTIONS.PAYROLL_RECONCILED,
      data: { batchId, status: updatedBatch.status, reconciledCount: updatedBatch.reconciledCount },
    });

    if (updatedBatch.status === BATCH_STATUS.RECONCILED) {
      await this.dispatchEvent(tenantId, WEBHOOK_EVENTS.RECONCILED, { batch: toPublicBatch(updatedBatch) }, req);
    }
    return { batch: toPublicBatch(updatedBatch) };
  }

  async handleProviderWebhook({ req, provider, transactionId, batchId, status, providerRef, errorCode, message }) {
    const tx = await PayrollTransaction.findOne({ provider: String(provider).toUpperCase(), providerTransactionId: transactionId }).lean()
      || await PayrollTransaction.findOne({ provider: String(provider).toUpperCase(), providerRef: transactionId }).lean();
    if (!tx) throw new PayrollError('PAYROLL_TRANSACTION_NOT_FOUND', 'Payroll transaction was not found.', 404);
    if (batchId && tx.batchId !== batchId) throw new PayrollError('PAYROLL_BATCH_MISMATCH', 'Provider callback does not match the payroll batch.', 409);

    const normalized = String(status || '').toUpperCase();
    const nextStatus = ['SUCCESS', 'COMPLETED', 'SUCCESSFUL', 'SETTLED'].includes(normalized) ? TRANSACTION_STATUS.SUCCESS : ['FAILED', 'FAILURE', 'REJECTED', 'DECLINED', 'CANCELLED'].includes(normalized) ? TRANSACTION_STATUS.FAILED : TRANSACTION_STATUS.UNKNOWN;

    const noChange = tx.status === nextStatus && (providerRef || null) === (tx.providerRef || null) && (tx.errorCode || null) === (errorCode || null);
    if (!noChange) {
      await PayrollTransaction.updateOne({ tenantId: tx.tenantId, transactionId: tx.transactionId }, { $set: { status: nextStatus, providerTransactionId: transactionId, providerRef: providerRef || tx.providerRef, errorCode: errorCode || null, message: message || null, lastProviderUpdateAt: new Date(), reconciledAt: nextStatus === TRANSACTION_STATUS.FAILED ? new Date() : null } });
    }

    if (nextStatus === TRANSACTION_STATUS.SUCCESS) {
      await this.finalizeFinancialPosting({
        tenantId: tx.tenantId,
        batchId: tx.batchId,
        transaction: {
          ...tx,
          status: nextStatus,
          providerTransactionId: transactionId,
          providerRef: providerRef || tx.providerRef,
        },
      });
      const posted = await PayrollTransaction.findOne({ tenantId: tx.tenantId, transactionId: tx.transactionId }).lean();
      if (posted?.financialPostingStatus === FINANCIAL_POSTING_STATUS.POSTED) {
        await PayrollTransaction.updateOne(
          { tenantId: tx.tenantId, transactionId: tx.transactionId },
          { $set: { reconciledAt: new Date() } },
        );
      }
    }

    const updatedBatch = await this.refreshBatchStats(tx.tenantId, tx.batchId);
    await writeAudit({
      tenantId: tx.tenantId,
      actorId: 'PROVIDER',
      requestId: req.requestId,
      correlationId: req.correlationId,
      action: AUDIT_ACTIONS.PAYROLL_PROVIDER_WEBHOOK,
      data: { provider, transactionId, batchId: tx.batchId, status: nextStatus, providerRef: providerRef || null, changed: !noChange },
    });

    if (updatedBatch.status === BATCH_STATUS.RECONCILED) {
      await this.dispatchEvent(tx.tenantId, WEBHOOK_EVENTS.RECONCILED, { batch: toPublicBatch(updatedBatch) }, req);
    }

    return { transaction: toPublicTransaction(await PayrollTransaction.findOne({ transactionId: tx.transactionId }).lean()), batch: toPublicBatch(updatedBatch), duplicate: noChange };
  }

  async retryFailed({ req, tenantId, actorId, batchId }) {
    throw new PayrollError(
      'PAYROLL_RETRY_APPROVAL_UNAVAILABLE',
      'A failed or uncertain payout cannot be retried with a new provider reference automatically. Create a reviewed replacement instruction and obtain fresh independent approval.',
      409,
      { batchId: batchId || null, retryDisabled: true },
    );
  }

  async dispatchEvent(tenantId, eventType, payload, req) {
    const subscriptions = await WebhookSubscription.find({ tenantId, active: true, events: eventType }).lean();
    const results = [];
    for (const subscription of subscriptions) {
      await callbackUrlIsPublic(subscription.callbackUrl);
      const secret = decryptSecret(subscription.encryptedSecret);
      const timestamp = new Date().toISOString();
      const body = { eventType, employerId: tenantId, timestamp, payload };
      const signature = signWebhookPayload(secret, timestamp, body);
      try {
        const response = await fetchWithTimeout(subscription.callbackUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'X-TITech-Signature': signature, 'X-TITech-Timestamp': timestamp }, body: JSON.stringify(body) });
        const ok = response.status >= 200 && response.status < 300;
        await WebhookSubscription.updateOne({ tenantId, subscriptionId: subscription.subscriptionId }, { $set: { lastDeliveryAt: new Date() }, ...(ok ? { $set: { lastDeliveryAt: new Date(), failureCount: 0 } } : { $inc: { failureCount: 1 } }) });
        await writeAudit({ tenantId, actorId: req?.user?.id || 'SYSTEM', requestId: req?.requestId || null, correlationId: req?.correlationId || null, action: AUDIT_ACTIONS.PAYROLL_WEBHOOK_DISPATCHED, data: { subscriptionId: subscription.subscriptionId, callbackUrl: subscription.callbackUrl, eventType, statusCode: response.status, success: ok } });
        results.push({ subscriptionId: subscription.subscriptionId, success: ok, statusCode: response.status });
      } catch (error) {
        await WebhookSubscription.updateOne({ tenantId, subscriptionId: subscription.subscriptionId }, { $inc: { failureCount: 1 } });
        await writeAudit({ tenantId, actorId: req?.user?.id || 'SYSTEM', requestId: req?.requestId || null, correlationId: req?.correlationId || null, action: AUDIT_ACTIONS.PAYROLL_WEBHOOK_DISPATCHED, data: { subscriptionId: subscription.subscriptionId, callbackUrl: subscription.callbackUrl, eventType, success: false, error: error.message } });
        results.push({ subscriptionId: subscription.subscriptionId, success: false, error: 'DELIVERY_FAILED' });
      }
    }
    return results;
  }

  async testWebhook({ req, tenantId, actorId, subscriptionId, eventType }) {
    const subscription = await WebhookSubscription.findOne({ tenantId, subscriptionId, active: true }).lean();
    if (!subscription) throw new PayrollError('PAYROLL_SUBSCRIPTION_NOT_FOUND', 'Active webhook subscription was not found.', 404);
    if (!Object.values(WEBHOOK_EVENTS).includes(eventType)) throw new PayrollError('PAYROLL_EVENT_INVALID', 'Unsupported simulator event.', 400);
    if (!subscription.events.includes(eventType)) throw new PayrollError('PAYROLL_EVENT_NOT_SUBSCRIBED', 'The selected subscription is not configured for this event.', 409);
    await callbackUrlIsPublic(subscription.callbackUrl);
    const secret = decryptSecret(subscription.encryptedSecret);
    const timestamp = new Date().toISOString();
    const body = { eventType, employerId: tenantId, timestamp, payload: { simulated: true, simulatorRequestId: req.requestId } };
    const signature = signWebhookPayload(secret, timestamp, body);
    let delivery;
    try {
      const response = await fetchWithTimeout(subscription.callbackUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'X-TITech-Signature': signature, 'X-TITech-Timestamp': timestamp, 'X-TITech-Simulator': 'true' }, body: JSON.stringify(body) });
      delivery = { success: response.status >= 200 && response.status < 300, statusCode: response.status };
    } catch {
      delivery = { success: false, error: 'DELIVERY_FAILED' };
    }
    await writeAudit({ tenantId, actorId, requestId: req.requestId, correlationId: req.correlationId, action: AUDIT_ACTIONS.PAYROLL_WEBHOOK_SIMULATED, data: { subscriptionId, callbackUrl: subscription.callbackUrl, eventType, delivery: delivery.success ? 'SUCCESS' : 'FAILED' } });
    return { subscriptionId, eventType, timestamp, delivery };
  }

  async simulatorAuditLogs({ tenantId, page = 1, pageSize = 20 }) {
    const audit = await getAuditModel();
    const Audit = audit.default || audit;
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSize) || 20));
    const filter = { tenantId, action: AUDIT_ACTIONS.PAYROLL_WEBHOOK_SIMULATED };
    const [items, total] = await Promise.all([
      Audit.find(filter).sort({ createdAt: -1, _id: -1 }).skip((safePage - 1) * safePageSize).limit(safePageSize).lean(),
      Audit.countDocuments(filter),
    ]);
    return {
      page: safePage,
      pageSize: safePageSize,
      total,
      items: items.map((item) => ({
        auditLogId: item.data?.auditLogId || String(item._id),
        employerId: item.data?.employerId || item.tenantId,
        eventType: item.data?.eventType || item.action,
        actor: item.data?.actor || item.actorId,
        timestamp: item.data?.timestamp || item.createdAt,
        callbackUrl: item.data?.callbackUrl || null,
        action: item.action,
      })),
    };
  }

  async listTransactions({ tenantId, batchId, status }) {
    const filter = { tenantId };
    if (batchId) filter.batchId = batchId;
    if (status) filter.status = status;
    return (await PayrollTransaction.find(filter).sort({ createdAt: -1 }).limit(MAX_PAGE_SIZE).lean()).map(toPublicTransaction);
  }
}

module.exports = {
  PayrollService,
  normalizeRole,
  requireTenant,
  toPublicBatch,
  toPublicTransaction,
  callbackUrlIsPublic,
  isPrivateIp,
  decryptSecret,
  signWebhookPayload,
  PAYROLL_ROLES,
};
