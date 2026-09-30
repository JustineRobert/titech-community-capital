'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');

const PayrollBatch = require('./models/PayrollBatch.cjs');
const PayrollTransaction = require('./models/PayrollTransaction.cjs');
const WebhookSubscription = require('./models/WebhookSubscription.cjs');
const { parseCsv } = require('./payroll.csv.cjs');
const { PayrollError } = require('./payroll.errors.cjs');
const { PayrollProviderGateway } = require('./payroll.providerGateway.cjs');
const { PayrollFinancialGateway } = require('./payroll.financialGateway.cjs');
const {
  PAYROLL_ROLES,
  ROLE_ALIASES,
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

let auditServicePromise;
let auditModelPromise;

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  return ROLE_ALIASES[value] || value;
}

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
    status: batch.status,
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

async function writeAudit({ tenantId, action, data, actorId, requestId, correlationId }) {
  const audit = await getAuditService();
  return audit.createAuditLog({
    tenantId,
    action,
    actorId,
    requestId,
    correlationId,
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
    const existing = await PayrollBatch.findOne({ tenantId, uploadIdempotencyKey: idempotencyKey }).lean();
    if (existing) return { batch: toPublicBatch(existing), replay: true };

    const rows = parseCsv(csvText);
    const batchId = makeId('payroll_batch');
    const batch = await PayrollBatch.create({
      batchId,
      tenantId,
      employerId: tenantId,
      uploadedBy: actorId,
      uploadIdempotencyKey: idempotencyKey,
      fileName: String(fileName || 'payroll.csv').slice(0, 255),
      rowCount: rows.length,
      totalAmount: '0',
      status: BATCH_STATUS.UPLOADED,
    });

    const documents = rows.map((row) => ({
      transactionId: makeId('payroll_tx'),
      tenantId,
      employerId: tenantId,
      batchId,
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      phoneNumber: row.phoneNumber,
      amount: row.amount,
      currency: row.currency,
      provider: row.provider || defaultProvider || 'MTN_MOMO',
      status: TRANSACTION_STATUS.PENDING,
      financialPostingStatus: FINANCIAL_POSTING_STATUS.PENDING,
      attemptCount: 0,
      idempotencyKey: `${batchId}:${row.employeeId}`,
      metadata: {},
    }));

    await PayrollTransaction.insertMany(documents, { ordered: true });
    const totals = await PayrollTransaction.aggregate([
      { $match: { batchId, tenantId } },
      { $group: { _id: '$currency', totalAmount: { $sum: '$amount' } } },
    ]);
    if (totals.length === 1) {
      await PayrollBatch.updateOne({ batchId, tenantId }, { $set: { totalAmount: totals[0].totalAmount } });
    }

    await writeAudit({
      tenantId,
      actorId,
      requestId: req.requestId,
      correlationId: req.correlationId,
      action: AUDIT_ACTIONS.PAYROLL_UPLOAD,
      data: { batchId, fileName: batch.fileName, rowCount: rows.length },
    });

    const current = await PayrollBatch.findOne({ batchId, tenantId }).lean();
    return { batch: toPublicBatch(current), replay: false };
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

    await PayrollBatch.updateOne({ tenantId, batchId, status: { $in: [BATCH_STATUS.UPLOADED, BATCH_STATUS.PARTIALLY_PROCESSED, BATCH_STATUS.FAILED] } }, { $set: { status: BATCH_STATUS.PROCESSING } });
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
    const filter = { tenantId, status: TRANSACTION_STATUS.FAILED };
    if (batchId) filter.batchId = batchId;
    const transactions = await PayrollTransaction.find(filter).lean();
    const results = [];

    for (const tx of transactions) {
      const nextIdempotencyKey = `${tx.idempotencyKey}:retry:${tx.attemptCount + 1}`;
      await PayrollTransaction.updateOne({ tenantId, transactionId: tx.transactionId, status: TRANSACTION_STATUS.FAILED }, { $set: { status: TRANSACTION_STATUS.RETRYING, lastAttemptIdempotencyKey: nextIdempotencyKey, retryOf: tx.transactionId }, $inc: { attemptCount: 1 }, });
      const result = await this.providerGateway.disburse({ provider: tx.provider, tenantId, amount: serializeDecimal(tx.amount), currency: tx.currency, phoneNumber: tx.phoneNumber, idempotencyKey: nextIdempotencyKey, transactionId: tx.transactionId, employeeId: tx.employeeId, employeeName: tx.employeeName, correlationId: req.correlationId });
      const nextStatus = result.status === 'SUCCESS' ? TRANSACTION_STATUS.SUCCESS : result.status === 'FAILED' ? TRANSACTION_STATUS.FAILED : TRANSACTION_STATUS.UNKNOWN;
      await PayrollTransaction.updateOne({ tenantId, transactionId: tx.transactionId }, { $set: { status: nextStatus, providerTransactionId: result.providerTransactionId || tx.providerTransactionId, providerRef: result.providerRef || tx.providerRef, errorCode: result.errorCode || null, message: result.message || null, lastProviderUpdateAt: new Date() } });
      if (nextStatus === TRANSACTION_STATUS.SUCCESS) {
        await this.finalizeFinancialPosting({
          tenantId,
          batchId: tx.batchId,
          transaction: {
            ...tx,
            status: nextStatus,
            providerTransactionId: result.providerTransactionId || tx.providerTransactionId,
            providerRef: result.providerRef || tx.providerRef,
          },
        });
      }
      results.push({ transactionId: tx.transactionId, status: nextStatus, attemptCount: tx.attemptCount + 1 });
    }

    await writeAudit({ tenantId, actorId, requestId: req.requestId, correlationId: req.correlationId, action: AUDIT_ACTIONS.PAYROLL_RETRY_ATTEMPTED, data: { batchId: batchId || null, attempted: results.length } });
    if (results.length) await this.dispatchEvent(tenantId, WEBHOOK_EVENTS.RETRY_ATTEMPTED, { batchId: batchId || null, results }, req);
    const updated = batchId ? await this.refreshBatchStats(tenantId, batchId) : null;
    return { attempted: results.length, results, batch: updated ? toPublicBatch(updated) : null };
  }

  async report({ tenantId, batchId, status, page = 1, pageSize = 20 }) {
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSize) || 20));
    const filter = { tenantId };
    if (batchId) filter.batchId = batchId;
    if (status) filter.status = String(status).toUpperCase();
    const [transactions, total] = await Promise.all([
      PayrollTransaction.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safePageSize).limit(safePageSize).lean(),
      PayrollTransaction.countDocuments(filter),
    ]);
    const batches = await PayrollBatch.find(batchId ? { tenantId, batchId } : { tenantId }).sort({ createdAt: -1 }).limit(50).lean();
    return {
      page: safePage,
      pageSize: safePageSize,
      total,
      batches: batches.map(toPublicBatch),
      transactions: transactions.map(toPublicTransaction),
    };
  }

  async createSubscription({ req, tenantId, actorId, callbackUrl, events }) {
    await callbackUrlIsPublic(callbackUrl);
    const allowedEvents = Object.values(WEBHOOK_EVENTS);
    const normalizedEvents = [...new Set((events || []).map((event) => String(event).toUpperCase()))];
    if (!normalizedEvents.length || normalizedEvents.some((event) => !allowedEvents.includes(event))) {
      throw new PayrollError('PAYROLL_SUBSCRIPTION_EVENTS_INVALID', 'Subscription events are invalid.', 400, { allowedEvents });
    }
    const existing = await WebhookSubscription.findOne({ tenantId, callbackUrl }).lean();
    if (existing) throw new PayrollError('PAYROLL_SUBSCRIPTION_EXISTS', 'A subscription already exists for this callback URL.', 409);

    const secret = generateWebhookSecret();
    const subscription = await WebhookSubscription.create({ subscriptionId: makeId('sub'), tenantId, employerId: tenantId, callbackUrl, events: normalizedEvents, encryptedSecret: encryptSecret(secret), createdBy: actorId, active: true });
    await writeAudit({ tenantId, actorId, requestId: req.requestId, correlationId: req.correlationId, action: AUDIT_ACTIONS.PAYROLL_SUBSCRIPTION_CREATED, data: { subscriptionId: subscription.subscriptionId, callbackUrl, events: normalizedEvents } });
    return { subscription: { subscriptionId: subscription.subscriptionId, callbackUrl: subscription.callbackUrl, events: subscription.events, active: subscription.active, createdAt: subscription.createdAt }, secret };
  }

  async listSubscriptions({ tenantId }) {
    const items = await WebhookSubscription.find({ tenantId }).sort({ createdAt: -1 }).lean();
    return items.map((item) => ({ subscriptionId: item.subscriptionId, callbackUrl: item.callbackUrl, events: item.events, active: item.active, secretConfigured: Boolean(item.encryptedSecret), lastDeliveryAt: item.lastDeliveryAt, failureCount: item.failureCount, createdAt: item.createdAt }));
  }

  async deleteSubscription({ req, tenantId, actorId, subscriptionId }) {
    const subscription = await WebhookSubscription.findOne({ tenantId, subscriptionId }).lean();
    if (!subscription) throw new PayrollError('PAYROLL_SUBSCRIPTION_NOT_FOUND', 'Webhook subscription was not found.', 404);
    await WebhookSubscription.deleteOne({ tenantId, subscriptionId });
    await writeAudit({ tenantId, actorId, requestId: req.requestId, correlationId: req.correlationId, action: AUDIT_ACTIONS.PAYROLL_SUBSCRIPTION_DELETED, data: { subscriptionId } });
    return { deleted: true, subscriptionId };
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
