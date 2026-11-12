/** ESM-native errors for the canonical commercial transaction-revenue services. */
export class TransactionRevenueError extends Error {
  constructor(message, { code = 'TITECH_TRANSACTION_REVENUE_ERROR', statusCode = 500, details = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'TransactionRevenueError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class TransactionRevenueValidationError extends TransactionRevenueError {
  constructor(message, details = null) {
    super(message, { code: 'TITECH_TRANSACTION_REVENUE_VALIDATION', statusCode: 400, details });
    this.name = 'TransactionRevenueValidationError';
  }
}

export class TransactionRevenueNotFoundError extends TransactionRevenueError {
  constructor(message, details = null) {
    super(message, { code: 'TITECH_TRANSACTION_REVENUE_NOT_FOUND', statusCode: 404, details });
    this.name = 'TransactionRevenueNotFoundError';
  }
}

export class TransactionRevenueConflictError extends TransactionRevenueError {
  constructor(message, details = null) {
    super(message, { code: 'TITECH_TRANSACTION_REVENUE_CONFLICT', statusCode: 409, details });
    this.name = 'TransactionRevenueConflictError';
  }
}

export class TransactionRevenueAuthorizationError extends TransactionRevenueError {
  constructor(message = 'You are not authorised to approve this fee rule.', details = null) {
    super(message, { code: 'TITECH_TRANSACTION_REVENUE_FORBIDDEN', statusCode: 403, details });
    this.name = 'TransactionRevenueAuthorizationError';
  }
}
