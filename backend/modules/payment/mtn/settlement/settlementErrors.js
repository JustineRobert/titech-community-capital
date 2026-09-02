'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Settlement Errors
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Centralized Custom Error Classes
 * ✅ Standardized Error Codes
 * ✅ Consistent Error Messaging
 * ✅ Extensible for New Error Types
 * ✅ Audit-Ready
 * ============================================================================
 */

const { ErrorCodes } = require('./settlementConstants');

/**
 * Base Settlement Error
 */
class SettlementError extends Error {
  constructor(message, code = ErrorCodes.DB_ERROR, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * File Not Found Error
 */
class FileNotFoundError extends SettlementError {
  constructor(filePath, details = {}) {
    super(`Settlement file not found: ${filePath}`, ErrorCodes.FILE_NOT_FOUND, details);
  }
}

/**
 * Parse Error
 */
class ParseError extends SettlementError {
  constructor(fileName, details = {}) {
    super(`Failed to parse settlement file: ${fileName}`, ErrorCodes.PARSE_ERROR, details);
  }
}

/**
 * Database Error
 */
class DatabaseError extends SettlementError {
  constructor(operation, details = {}) {
    super(`Database operation failed: ${operation}`, ErrorCodes.DB_ERROR, details);
  }
}

/**
 * Validation Error
 */
class ValidationError extends SettlementError {
  constructor(referenceId, details = {}) {
    super(`Validation failed for settlement referenceId=${referenceId}`, ErrorCodes.VALIDATION_ERROR, details);
  }
}

/**
 * Duplicate Reference Error
 */
class DuplicateReferenceError extends SettlementError {
  constructor(referenceId, details = {}) {
    super(`Duplicate settlement detected for referenceId=${referenceId}`, ErrorCodes.DUPLICATE_REFERENCE, details);
  }
}

/**
 * Reconciliation Error
 */
class ReconciliationError extends SettlementError {
  constructor(referenceId, details = {}) {
    super(`Reconciliation failed for settlement referenceId=${referenceId}`, ErrorCodes.RECONCILIATION_FAILED, details);
  }
}

module.exports = {
  SettlementError,
  FileNotFoundError,
  ParseError,
  DatabaseError,
  ValidationError,
  DuplicateReferenceError,
  ReconciliationError,
};
