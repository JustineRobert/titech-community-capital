/**
 * TITech BankConnect institution metadata.
 * Registry entries describe institution discovery and supported local evidence
 * formats only. They are not evidence of an API, partnership, sandbox or
 * production approval.
 */
export const BANK_INSTITUTIONS = Object.freeze([
  Object.freeze({
    id: 'CENTENARY_UG', name: 'Centenary Bank', country: 'UG', currency: ['UGX', 'USD'],
    integrationPriority: 1, integrationMethods: ['MANUAL_STATEMENT_UPLOAD', 'BANK_APPROVED_API_PENDING'],
    statementFormats: ['CSV', 'XLSX', 'MT940', 'CAMT.052', 'CAMT.053', 'CAMT.054'],
    bankPublishedStatementFormats: [],
    connectorStatus: 'DESIGNED', connectionStatus: 'NOT_CONNECTED', sandboxStatus: 'NOT_VERIFIED',
    partnershipStatus: 'NOT_APPROVED', productionCredentialsStatus: 'NOT_APPROVED', productionApproved: false,
  }),
  Object.freeze({
    id: 'STANBIC_UG', name: 'Stanbic Bank Uganda', country: 'UG', currency: ['UGX', 'USD'],
    integrationPriority: 2, integrationMethods: ['MANUAL_STATEMENT_UPLOAD', 'BANK_APPROVED_API_PENDING'],
    statementFormats: ['CSV', 'XLSX', 'MT940', 'CAMT.052', 'CAMT.053', 'CAMT.054'],
    bankPublishedStatementFormats: [],
    connectorStatus: 'DESIGNED', connectionStatus: 'NOT_CONNECTED', sandboxStatus: 'NOT_VERIFIED',
    partnershipStatus: 'NOT_APPROVED', productionCredentialsStatus: 'NOT_APPROVED', productionApproved: false,
  }),
  Object.freeze({
    id: 'DFCU_UG', name: 'dfcu Bank', country: 'UG', currency: ['UGX', 'USD'],
    integrationPriority: 3, integrationMethods: ['MANUAL_STATEMENT_UPLOAD', 'BANK_APPROVED_API_PENDING'],
    statementFormats: ['CSV', 'XLSX', 'MT940', 'CAMT.052', 'CAMT.053', 'CAMT.054'],
    bankPublishedStatementFormats: [],
    connectorStatus: 'DESIGNED', connectionStatus: 'NOT_CONNECTED', sandboxStatus: 'NOT_VERIFIED',
    partnershipStatus: 'NOT_APPROVED', productionCredentialsStatus: 'NOT_APPROVED', productionApproved: false,
  }),
  Object.freeze({
    id: 'ABSA_UG', name: 'Absa Bank Uganda', country: 'UG', currency: ['UGX', 'USD'],
    integrationPriority: 4, integrationMethods: ['MANUAL_STATEMENT_UPLOAD', 'BANK_APPROVED_API_PENDING'],
    statementFormats: ['CSV', 'XLSX', 'MT940', 'CAMT.052', 'CAMT.053', 'CAMT.054'],
    bankPublishedStatementFormats: [],
    connectorStatus: 'DESIGNED', connectionStatus: 'NOT_CONNECTED', sandboxStatus: 'NOT_VERIFIED',
    partnershipStatus: 'NOT_APPROVED', productionCredentialsStatus: 'NOT_APPROVED', productionApproved: false,
  }),
  Object.freeze({
    id: 'EQUITY_UG', name: 'Equity Bank Uganda', country: 'UG', currency: ['UGX', 'USD'],
    integrationPriority: 5, integrationMethods: ['MANUAL_STATEMENT_UPLOAD', 'BANK_APPROVED_API_PENDING'],
    statementFormats: ['CSV', 'XLSX', 'MT940', 'CAMT.052', 'CAMT.053', 'CAMT.054'],
    bankPublishedStatementFormats: [],
    connectorStatus: 'DESIGNED', connectionStatus: 'NOT_CONNECTED', sandboxStatus: 'NOT_VERIFIED',
    partnershipStatus: 'NOT_APPROVED', productionCredentialsStatus: 'NOT_APPROVED', productionApproved: false,
  }),
]);

export const BANK_INSTITUTION_BY_ID = new Map(BANK_INSTITUTIONS.map((item) => [item.id, item]));
export const STATEMENT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const STATEMENT_TRANSACTION_MAX_ROWS = 10_000;

export function getBankInstitution(id) {
  return BANK_INSTITUTION_BY_ID.get(String(id || '').trim().toUpperCase()) || null;
}

export function getBankConnectCapabilitySummary() {
  return Object.freeze({
    statementImport: 'IMPLEMENTED_LOCAL_UPLOAD_PATH',
    bankApiConnectivity: 'NOT_CONNECTED',
    paymentExecution: 'DISABLED_PENDING_EXTERNAL_APPROVAL',
    productionApproved: false,
  });
}
