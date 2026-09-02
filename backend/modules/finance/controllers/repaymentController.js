// ============================================================================
// TITech Community Capital – Repayment Controller
// File: backend/modules/finance/controllers/repaymentController.js
// Production-grade
// ============================================================================

'use strict';

const Joi = require('joi');
const logger = require('../../../../utils/logger');
const { processRepayment } = require('../services/repaymentService');

const ApiError = require('../../../../errors/ApiError');
const NotFoundError = require('../../../../errors/NotFoundError');
const ConflictError = require('../../../../errors/ConflictError');
const PaymentRequiredError = require('../../../../errors/PaymentRequiredError');
const BadRequestError = require('../../../../errors/BadRequestError');

/**
 * Request validation schema
 */
const repaySchema = Joi.object({
  loanId: Joi.string().required(),
  walletId: Joi.string().required(),
  amount: Joi.number().positive().precision(2).required(),
  currency: Joi.string().length(3).uppercase().optional(),
  debitAccountCode: Joi.string().optional(),
  creditAccountCode: Joi.string().optional(),
  description: Joi.string().max(1024).optional(),
  provider: Joi.string().optional(),
  momoTransactionId: Joi.string().optional(),
  metadata: Joi.object().optional(),
  paymentId: Joi.string().optional(),
});

/**
 * repay
 *
 * - Validates input
 * - Enforces idempotency via Idempotency-Key header or paymentId in body
 * - Ensures tenant scoping and basic authorization
 * - Calls processRepayment service and returns structured response
 */
async function repay(req, res, next) {
  try {
    const tenantId = req.tenant && req.tenant.id;
    if (!tenantId) return next(BadRequestError ? new BadRequestError('Tenant context missing') : ApiError.badRequest('Tenant context missing'));

    if (!req.user) return next(ApiError.unauthorized('Authentication required'));

    const { error, value } = repaySchema.validate(req.body, { stripUnknown: true });
    if (error) return next(new BadRequestError(error.details.map(d => d.message).join(', ')));

    // Idempotency key: prefer header, fallback to body.paymentId
    const paymentId = (req.headers['idempotency-key'] || value.paymentId || '').toString().trim();
    if (!paymentId) return next(new BadRequestError('Idempotency key required (Idempotency-Key header or paymentId in body)'));

    const opts = {
      currency: value.currency || 'UGX',
      debitAccountCode: value.debitAccountCode,
      creditAccountCode: value.creditAccountCode,
      description: value.description,
      requestId: req.headers['x-request-id'] || null,
      provider: value.provider || null,
      momoTransactionId: value.momoTransactionId || null,
      metadata: value.metadata || {},
      createdBy: req.user.id,
    };

    const result = await processRepayment({
      tenantId,
      loanId: value.loanId,
      payerWalletId: value.walletId,
      amount: value.amount,
      paymentId,
      opts,
    });

    return res.status(200).json({ success: true, result });
  } catch (err) {
    // Domain errors (ApiError and subclasses)
    if (err instanceof ApiError) {
      logger.warn('Domain error in repayment controller', { message: err.message, code: err.code, status: err.status, details: err.details, path: req.path, user: req.user?.id });
      const payload = err.toResponse({ includeDetails: false });
      return res.status(err.status).json({ success: false, ...payload, code: err.code });
    }

    // Fallback: unexpected errors
    logger.error('Unexpected error in repayment controller', { error: err?.message || err, path: req.path, user: req.user?.id });
    return next(ApiError.internal('Unexpected server error'));
  }
}

module.exports = { repay };
