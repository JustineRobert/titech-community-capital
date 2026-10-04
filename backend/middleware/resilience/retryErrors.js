'use strict';

class RetryPolicyError extends Error {
  constructor(message, code = 'RETRY_POLICY_ERROR', details = null) {
    super(message);
    this.name = 'RetryPolicyError';
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, RetryPolicyError);
  }
}

module.exports = Object.freeze({ RetryPolicyError });
