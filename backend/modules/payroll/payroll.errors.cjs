'use strict';

class PayrollError extends Error {
  constructor(code, message, statusCode = 400, details = undefined) {
    super(message);
    this.name = 'PayrollError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function payrollError(code, message, statusCode, details) {
  return new PayrollError(code, message, statusCode, details);
}

module.exports = { PayrollError, payrollError };
