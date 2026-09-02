'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Settlement Constants
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Centralized Constants & Enums
 * ✅ Standardized Status Codes
 * ✅ Default Configurations
 * ✅ Error Codes & Messages
 * ✅ Audit-Ready Definitions
 * ============================================================================
 */

const SettlementStatus = Object.freeze({
  PENDING: 'PENDING',
  MATCHED: 'MATCHED',
  MISMATCH: 'MISMATCH',
  UNMATCHED: 'UNMATCHED',
  VARIANCE: 'VARIANCE',
  ESCALATE: 'ESCALATE',
  RECONCILED: 'RECONCILED',
  RECOVERED: 'RECOVERED',
  FAILED: 'FAILED',
  ERROR: 'ERROR',
});

const ReportFormat = Object.freeze({
  JSON: 'JSON',
  CSV: 'CSV',
  PDF: 'PDF',
});

const Currency = Object.freeze({
  UGX: 'UGX',
  USD: 'USD',
  EUR: 'EUR',
});

const ErrorCodes = Object.freeze({
  FILE_NOT_FOUND: 'ERR_FILE_NOT_FOUND',
  PARSE_ERROR: 'ERR_PARSE_ERROR',
  DB_ERROR: 'ERR_DB_ERROR',
  VALIDATION_ERROR: 'ERR_VALIDATION_ERROR',
  DUPLICATE_REFERENCE: 'ERR_DUPLICATE_REFERENCE',
  RECONCILIATION_FAILED: 'ERR_RECONCILIATION_FAILED',
});

const DefaultConfig = Object.freeze({
  BATCH_SIZE: parseInt(process.env.SETTLEMENT_BATCH_SIZE, 10) || 100,
  RETRY_LIMIT: parseInt(process.env.SETTLEMENT_RETRY_LIMIT, 10) || 3,
  AMOUNT_TOLERANCE: parseFloat(process.env.SETTLEMENT_AMOUNT_TOLERANCE) || 0.01,
  DATE_TOLERANCE_DAYS: parseInt(process.env.SETTLEMENT_DATE_TOLERANCE_DAYS, 10) || 2,
  ALLOWED_CURRENCIES: (process.env.SETTLEMENT_ALLOWED_CURRENCIES || 'UGX').split(','),
  REPORT_DIR: process.env.SETTLEMENT_REPORT_DIR || '/var/mtn/reports',
  AUDIT_DIR: process.env.RECONCILE_AUDIT_DIR || '/var/mtn/audit',
});

module.exports = {
  SettlementStatus,
  ReportFormat,
  Currency,
  ErrorCodes,
  DefaultConfig,
};
