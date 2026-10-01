'use strict';

/**
 * @openapi
 * tags:
 *   - name: Payroll
 *     description: Employer payroll disbursement, reconciliation, reporting and callback operations.
 */

import express from 'express';
import authModule from '../../middleware/auth.js';
import tenantMiddlewareModule from '../../middleware/tenantMiddleware.js';
import idempotencyModule from '../../middleware/idempotency.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PayrollService, normalizeRole, requireTenant } = require('./payroll.service.cjs');
const { WEBHOOK_EVENTS } = require('./payroll.constants.cjs');
const { verifyWebhookSignature } = require('./payroll.crypto.cjs');
const { PayrollError } = require('./payroll.errors.cjs');

const router = express.Router();
const webhookRouter = express.Router();

const authenticate = authModule.authenticate || authModule.verifyToken || authModule.default;
const tenantAuthorization = tenantMiddlewareModule.default || tenantMiddlewareModule.tenantMiddleware || tenantMiddlewareModule.requireTenant;

if (typeof authenticate !== 'function') throw new TypeError('TITech payroll authentication middleware is unavailable.');
if (typeof tenantAuthorization !== 'function') throw new TypeError('TITech payroll tenant authorization middleware is unavailable.');

function getService(req) {
  return new PayrollService({
    serviceRegistry: req.app?.locals?.services || null,
    context: req.app?.locals?.context || null,
    logger: req.app?.locals?.logger || console,
  });
}

function roleMatches(user, allowedRoles) {
  const roles = [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])]
    .map(normalizeRole)
    .filter(Boolean);
  return allowedRoles.some((role) => roles.includes(normalizeRole(role)));
}

function requirePayrollRole(...allowedRoles) {
  return (req, res, next) => {
    if (!roleMatches(req.user, allowedRoles)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PAYROLL_FORBIDDEN',
          message: 'Your role is not authorized for this payroll operation.',
        },
        requestId: req.requestId,
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    return next();
  };
}

async function completeIdempotency(req, statusCode, body) {
  if (req.idempotency?.state === 'NEW' && typeof req.idempotency.complete === 'function') {
    await req.idempotency.complete({ statusCode, body });
  }
}

async function failIdempotency(req, statusCode, body, errorCode) {
  if (req.idempotency?.state === 'NEW' && typeof req.idempotency.fail === 'function') {
    await req.idempotency.fail({ statusCode, body, errorCode });
  }
}

async function sendSuccess(req, res, statusCode, body, idempotencyBody = body) {
  await completeIdempotency(req, statusCode, idempotencyBody);
  return res.status(statusCode).json(body);
}

function withErrorHandling(handler) {
  return async (req, res, next) => {
    try {
      return await handler(req, res, next);
    } catch (error) {
      if (error instanceof PayrollError) {
        const body = {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
          requestId: req.requestId,
          correlationId: req.correlationId,
          timestamp: new Date().toISOString(),
        };
        await failIdempotency(req, error.statusCode || 400, body, error.code);
        return res.status(error.statusCode || 400).json(body);
      }

      const statusCode = Number.isInteger(error?.statusCode) && error.statusCode >= 400 ? error.statusCode : 500;
      const safeBody = {
        success: false,
        error: {
          code: String(error?.code || 'PAYROLL_INTERNAL_ERROR'),
          message: statusCode >= 500 ? 'The payroll service could not complete the request.' : String(error?.message || 'The payroll request could not be completed.'),
        },
        requestId: req.requestId,
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      };
      await failIdempotency(req, statusCode, safeBody, safeBody.error.code);
      return next(error);
    }
  };
}

function requestTenant(req) {
  const tenantId = requireTenant(req);
  req.payrollTenantId = tenantId;
  return tenantId;
}

const payrollAuth = [authenticate, tenantAuthorization];
const idempotency = idempotencyModule.idempotency || idempotencyModule.default || idempotencyModule;

/**
 * @openapi
 * /api/v1/payroll/uploadPayroll:
 *   post:
 *     summary: Upload a CSV payroll batch
 *     tags: [Payroll]
 *     security: [{ BearerAuth: [] }]
 *     description: Employer users and administrators can upload a bounded text/csv payroll file. An Idempotency-Key is mandatory.
 */
router.post('/uploadPayroll', ...payrollAuth, requirePayrollRole('ADMIN', 'EMPLOYER_USER'), express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }), idempotency({ operation: 'PAYROLL_UPLOAD', resource: 'payroll-batch', required: true }), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
  if (!idempotencyKey || idempotencyKey.length > 200) throw new PayrollError('PAYROLL_IDEMPOTENCY_REQUIRED', 'Idempotency-Key is required and must be 200 characters or fewer.', 400);
  const csvText = typeof req.body === 'string' ? req.body : req.body?.csvText;
  const result = await getService(req).uploadPayroll({ req, tenantId, actorId: String(req.user.id || req.user.userId), fileName: req.get('X-Filename') || 'payroll.csv', csvText, idempotencyKey, defaultProvider: req.get('X-Default-Provider') || 'MTN_MOMO' });
  return sendSuccess(req, res, result.replay ? 200 : 201, { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

/**
 * @openapi
 * /api/v1/payroll/employers:
 *   post:
 *     summary: Create an employer onboarding record
 *     tags: [Payroll]
 */
router.post('/employers', ...payrollAuth, requirePayrollRole('ADMIN', 'EMPLOYER_ADMIN'), express.json(), idempotency({ operation: 'PAYROLL_EMPLOYER_CREATE', resource: 'payroll-employer', required: true }), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const result = await getService(req).createEmployer({ req, tenantId, actorId: String(req.user.id || req.user.userId), input: req.body || {} });
  return sendSuccess(req, res, result.replay ? 200 : 201, { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

router.get('/employers', ...payrollAuth, requirePayrollRole('ADMIN', 'AUDITOR', 'EMPLOYER_ADMIN', 'EMPLOYER_USER'), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const employers = await getService(req).listEmployers({ tenantId });
  return res.json({ success: true, employers, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

router.post('/employees', ...payrollAuth, requirePayrollRole('ADMIN', 'EMPLOYER_ADMIN', 'EMPLOYER_USER', 'PAYROLL_MAKER'), express.json(), idempotency({ operation: 'PAYROLL_EMPLOYEE_UPSERT', resource: 'payroll-employee', required: true }), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const result = await getService(req).upsertEmployee({ req, tenantId, actorId: String(req.user.id || req.user.userId), input: req.body || {} });
  return sendSuccess(req, res, 200, { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

router.get('/employees', ...payrollAuth, requirePayrollRole('ADMIN', 'AUDITOR', 'EMPLOYER_ADMIN', 'EMPLOYER_USER', 'PAYROLL_MAKER', 'READ_ONLY_ANALYST'), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const employees = await getService(req).listEmployees({ tenantId, employerId: req.query.employerId, status: req.query.status });
  return res.json({ success: true, employees, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

/**
 * @openapi
 * /api/v1/payroll/batches/{batchId}/submit:
 *   post:
 *     summary: Submit a validated payroll batch for maker-checker approval
 *     tags: [Payroll]
 */
router.post('/batches/:batchId/submit', ...payrollAuth, requirePayrollRole('ADMIN', 'EMPLOYER_ADMIN', 'EMPLOYER_USER', 'PAYROLL_MAKER'), idempotency({ operation: 'PAYROLL_SUBMIT', resource: 'payroll-batch', required: true }), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const result = await getService(req).submitForApproval({ req, tenantId, actorId: String(req.user.id || req.user.userId), batchId: String(req.params.batchId) });
  return sendSuccess(req, res, 200, { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

router.post('/batches/:batchId/approve', ...payrollAuth, requirePayrollRole('ADMIN', 'PAYROLL_CHECKER', 'PAYROLL_APPROVER'), express.json(), idempotency({ operation: 'PAYROLL_APPROVE', resource: 'payroll-batch', required: true }), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const result = await getService(req).approveBatch({ req, tenantId, actorId: String(req.user.id || req.user.userId), batchId: String(req.params.batchId), reason: req.body?.reason || null });
  return sendSuccess(req, res, 200, { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

router.post('/batches/:batchId/reject', ...payrollAuth, requirePayrollRole('ADMIN', 'PAYROLL_CHECKER', 'PAYROLL_APPROVER'), express.json(), idempotency({ operation: 'PAYROLL_REJECT', resource: 'payroll-batch', required: true }), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const result = await getService(req).rejectBatch({ req, tenantId, actorId: String(req.user.id || req.user.userId), batchId: String(req.params.batchId), reason: req.body?.reason });
  return sendSuccess(req, res, 200, { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

router.get('/batches/:batchId/approval-history', ...payrollAuth, requirePayrollRole('ADMIN', 'AUDITOR', 'EMPLOYER_ADMIN', 'EMPLOYER_USER', 'PAYROLL_MAKER', 'PAYROLL_CHECKER', 'PAYROLL_APPROVER'), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const approvals = await getService(req).approvalHistory({ tenantId, batchId: String(req.params.batchId) });
  return res.json({ success: true, approvals, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

/**
 * @openapi
 * /api/v1/payroll/processBatch:
 *   post:
 *     summary: Process a payroll batch
 *     tags: [Payroll]
 *     security: [{ BearerAuth: [] }]
 */
router.post('/processBatch', ...payrollAuth, requirePayrollRole('ADMIN', 'PAYROLL_ADMIN'), idempotency({ operation: 'PAYROLL_PROCESS_BATCH', resource: 'payroll-batch', required: true }), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const batchId = String(req.body?.batchId || '').trim();
  if (!batchId) throw new PayrollError('PAYROLL_BATCH_REQUIRED', 'batchId is required.', 400);
  const result = await getService(req).processBatch({ req, tenantId, actorId: String(req.user.id || req.user.userId), batchId });
  return sendSuccess(req, res, 200, { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

/**
 * @openapi
 * /api/v1/payroll/reconcile:
 *   post:
 *     summary: Reconcile provider outcomes with payroll records
 *     tags: [Payroll]
 *     security: [{ BearerAuth: [] }]
 */
router.post('/reconcile', ...payrollAuth, requirePayrollRole('ADMIN', 'FINANCE_OFFICER', 'RECONCILIATION_OFFICER'), idempotency({ operation: 'PAYROLL_RECONCILE', resource: 'payroll-batch', required: true }), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const batchId = String(req.body?.batchId || '').trim();
  if (!batchId) throw new PayrollError('PAYROLL_BATCH_REQUIRED', 'batchId is required.', 400);
  const result = await getService(req).reconcileBatch({ req, tenantId, actorId: String(req.user.id || req.user.userId), batchId });
  return sendSuccess(req, res, 200, { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

/**
 * @openapi
 * /api/v1/payroll/report:
 *   get:
 *     summary: View payroll reporting data
 *     tags: [Payroll]
 *     security: [{ BearerAuth: [] }]
 */
router.get('/report', ...payrollAuth, requirePayrollRole('ADMIN', 'AUDITOR', 'EMPLOYER_USER'), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const result = await getService(req).report({ tenantId, batchId: req.query.batchId, status: req.query.status, page: req.query.page, pageSize: req.query.pageSize });
  return sendSuccess(req, res, 200, { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

/**
 * @openapi
 * /api/v1/payroll/retryFailed:
 *   post:
 *     summary: Retry explicitly failed payroll transactions
 *     tags: [Payroll]
 *     security: [{ BearerAuth: [] }]
 */
router.post('/retryFailed', ...payrollAuth, requirePayrollRole('ADMIN'), idempotency({ operation: 'PAYROLL_RETRY_FAILED', resource: 'payroll-transaction', required: true }), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const result = await getService(req).retryFailed({ req, tenantId, actorId: String(req.user.id || req.user.userId), batchId: req.body?.batchId || null });
  return sendSuccess(req, res, 200, { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

/**
 * @openapi
 * /api/v1/payroll/webhookSubscriptions:
 *   post:
 *     summary: Register an employer callback subscription
 *     tags: [Payroll]
 *     security: [{ BearerAuth: [] }]
 */
router.post('/webhookSubscriptions', ...payrollAuth, requirePayrollRole('ADMIN', 'EMPLOYER_USER'), express.json(), idempotency({ operation: 'PAYROLL_SUBSCRIPTION_CREATE', resource: 'payroll-webhook-subscription', required: true }), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const result = await getService(req).createSubscription({ req, tenantId, actorId: String(req.user.id || req.user.userId), callbackUrl: req.body?.callbackUrl, events: req.body?.events });
  const responseBody = { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() };
  const safeIdempotencyBody = { ...responseBody, secret: undefined };
  return sendSuccess(req, res, 201, responseBody, safeIdempotencyBody);
}));

router.get('/webhookSubscriptions', ...payrollAuth, requirePayrollRole('ADMIN', 'EMPLOYER_USER'), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const subscriptions = await getService(req).listSubscriptions({ tenantId });
  return res.json({ success: true, subscriptions, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

router.delete('/webhookSubscriptions/:subscriptionId', ...payrollAuth, requirePayrollRole('ADMIN', 'EMPLOYER_USER'), idempotency({ operation: 'PAYROLL_SUBSCRIPTION_DELETE', resource: 'payroll-webhook-subscription', required: true }), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const result = await getService(req).deleteSubscription({ req, tenantId, actorId: String(req.user.id || req.user.userId), subscriptionId: String(req.params.subscriptionId) });
  return sendSuccess(req, res, 200, { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

/**
 * @openapi
 * /api/v1/payroll/testWebhook:
 *   post:
 *     summary: Simulate an employer callback
 *     tags: [Payroll]
 *     security: [{ BearerAuth: [] }]
 */
router.post('/testWebhook', ...payrollAuth, requirePayrollRole('ADMIN', 'EMPLOYER_USER'), idempotency({ operation: 'PAYROLL_WEBHOOK_SIMULATE', resource: 'payroll-webhook-subscription', required: true }), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const eventType = String(req.body?.eventType || WEBHOOK_EVENTS.BATCH_PROCESSED).toUpperCase();
  const result = await getService(req).testWebhook({ req, tenantId, actorId: String(req.user.id || req.user.userId), subscriptionId: String(req.body?.subscriptionId || ''), eventType });
  return sendSuccess(req, res, 200, { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

router.get('/testWebhook/auditLogs', ...payrollAuth, requirePayrollRole('ADMIN', 'AUDITOR', 'EMPLOYER_USER'), withErrorHandling(async (req, res) => {
  const tenantId = requestTenant(req);
  const result = await getService(req).simulatorAuditLogs({ tenantId, page: req.query.page, pageSize: req.query.pageSize });
  return sendSuccess(req, res, 200, { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

/**
 * @openapi
 * /webhooks:
 *   post:
 *     summary: Receive provider payroll status callbacks
 *     tags: [Payroll]
 *     description: Public provider callback boundary protected by optional TITech provider HMAC when TITECH_PAYROLL_WEBHOOK_REQUIRE_SIGNATURE is enabled.
 */
webhookRouter.post('/', express.json({ limit: '64kb' }), withErrorHandling(async (req, res) => {
  const requireSignature = String(process.env.TITECH_PAYROLL_WEBHOOK_REQUIRE_SIGNATURE ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')).toLowerCase() === 'true';
  const secret = process.env.TITECH_PAYROLL_PROVIDER_WEBHOOK_SECRET;
  if (requireSignature) {
    if (!secret) throw new PayrollError('PAYROLL_PROVIDER_WEBHOOK_SECRET_MISSING', 'Provider webhook verification is not configured.', 503);
    const valid = verifyWebhookSignature(secret, req.get('X-TITech-Provider-Timestamp'), req.body, req.get('X-TITech-Provider-Signature'));
    if (!valid) throw new PayrollError('PAYROLL_PROVIDER_WEBHOOK_INVALID', 'Provider webhook signature or timestamp is invalid.', 401);
  }

  const provider = String(req.body?.provider || '').toUpperCase();
  const transactionId = String(req.body?.transactionId || '').trim();
  const batchId = req.body?.batchId ? String(req.body.batchId).trim() : null;
  const status = String(req.body?.status || '').toUpperCase();
  if (!provider || !transactionId || !status) throw new PayrollError('PAYROLL_PROVIDER_WEBHOOK_INVALID', 'provider, transactionId and status are required.', 400);

  const eventId = String(req.get('X-TITech-Provider-Event-Id') || req.body?.eventId || '').trim() || null;
  const payloadHash = require('node:crypto').createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
  const result = await getService(req).handleProviderWebhook({ req, provider, transactionId, batchId, status, providerRef: req.body?.providerRef || null, errorCode: req.body?.errorCode || null, message: req.body?.message || null, eventId, payloadHash });
  return sendSuccess(req, res, 200, { success: true, ...result, requestId: req.requestId, correlationId: req.correlationId, timestamp: new Date().toISOString() });
}));

export { router as payrollApiRouter, webhookRouter as payrollWebhookRouter };
export default router;
