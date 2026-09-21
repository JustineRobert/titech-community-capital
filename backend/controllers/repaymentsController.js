// ============================================================================
// backend/controllers/repaymentsController.js
// ============================================================================
// Canonical HTTP controller for loan repayments.
// No direct ledger/balance/loan mutation is performed here.
// ============================================================================

import {
  FINANCIAL_OPERATION,
  executeFinancialOperation,
} from '../services/financial/financialOperation.service.js';
import {
  processFinancialOperation,
} from '../services/financial/financialTransaction.service.js';
import financialRepositoryRegistry from '../services/financial/financialRepositoryRegistry.js';

function textId(value, field) {
  const normalized = value == null ? '' : String(value).trim();
  if (!normalized || normalized.length > 128) {
    const error = new Error(`${field} is required.`);
    error.code = 'REPAYMENT_INPUT_INVALID';
    error.statusCode = 422;
    throw error;
  }
  return normalized;
}

function resolveTenantId(req) {
  return textId(
    req?.tenantId ||
      req?.tenant?.id ||
      req?.tenant?._id ||
      req?.auth?.tenantId ||
      req?.user?.tenantId ||
      req?.user?.tenant?.id,
    'tenantId',
  );
}

function resolvePrincipalId(req, fallback) {
  return textId(
    req?.user?.id ||
      req?.user?._id ||
      req?.auth?.userId ||
      req?.auth?.principalId ||
      fallback,
    'principalId',
  );
}

function resolveRequestTransactionId(req) {
  const value =
    req?.transactionId ||
    req?.headers?.['x-transaction-id'] ||
    null;
  return value ? textId(value, 'transactionId') : null;
}

function safeAmount(value) {
  const text = value == null ? '' : String(value).trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) || /^0+(?:\.0+)?$/.test(text)) {
    const error = new Error('amount must be a positive decimal amount.');
    error.code = 'REPAYMENT_AMOUNT_INVALID';
    error.statusCode = 422;
    throw error;
  }
  return text;
}

function resolveCurrency(value) {
  const currency = String(value || 'UGX').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    const error = new Error('currency must be a valid three-letter code.');
    error.code = 'REPAYMENT_CURRENCY_INVALID';
    error.statusCode = 422;
    throw error;
  }
  return currency;
}

export async function createRepayment(req, res, next) {
  try {
    const body = req?.body || {};
    const tenantId = resolveTenantId(req);
    const loanAccountId = textId(body.loanAccountId || body.loanId || body.id, 'loanAccountId');
    const sourceAccountId = textId(
      body.sourceAccountId ||
        body.accountId ||
        body.payerAccountId ||
        req?.financialAccountId ||
        req?.accountId,
      'sourceAccountId',
    );
    const amount = safeAmount(body.amount);
    const currency = resolveCurrency(body.currency);
    const principalId = resolvePrincipalId(req, body.memberId);
    const idempotency = req?.idempotency;

    if (!idempotency || idempotency.state !== 'NEW' || !idempotency.recordId) {
      const error = new Error('Financial idempotency context is required.');
      error.code = 'FINANCIAL_IDEMPOTENCY_REQUIRED';
      error.statusCode = 503;
      throw error;
    }

    const result = await processFinancialOperation({
      tenantId,
      principalId,
      operation: FINANCIAL_OPERATION.LOAN_REPAYMENT,
      resource: 'repayments',
      transactionId: resolveRequestTransactionId(req),
      idempotency,
      execute: ({ session, transactionId }) =>
        executeFinancialOperation({
          operation: FINANCIAL_OPERATION.LOAN_REPAYMENT,
          session,
          context: {
            tenantId,
            principalId,
            transactionId,
            correlationId:
              req?.correlationId ||
              req?.headers?.['x-correlation-id'] ||
              req?.headers?.['x-request-id'] ||
              null,
            idempotencyKey: idempotency.key,
          },
          repositories: financialRepositoryRegistry,
          payload: {
            amount,
            currency,
            loanAccountId,
            sourceAccountId,
            metadata: {
              source: 'repayments-controller',
              memberId: body.memberId || null,
              paymentReference: body.paymentReference || null,
              provider: body.provider || null,
            },
          },
        }),
    });

    if (result.transactionId) {
      res.setHeader('X-Transaction-Id', result.transactionId);
    }
    if (result.idempotencyRecordId) {
      res.setHeader('X-Idempotency-Record-Id', String(result.idempotencyRecordId));
    }
    res.setHeader('X-Financial-Operation', 'committed');

    return res
      .status(result.httpStatus || 200)
      .json(result.responseBody || { success: true, transactionId: result.transactionId });
  } catch (error) {
    if (typeof next === 'function' && error?.delegateToErrorHandler === true) {
      return next(error);
    }

    const status = Number(error?.statusCode || error?.status || 500);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      code: error?.code || 'REPAYMENT_PROCESSING_ERROR',
      message: status >= 500 ? 'Repayment processing could not be completed.' : error?.message,
      correlationId:
        req?.correlationId ||
        req?.headers?.['x-correlation-id'] ||
        req?.headers?.['x-request-id'] ||
        null,
    });
  }
}

const repaymentsControllerModule = Object.freeze({
  createRepayment,
});

export default repaymentsControllerModule;
