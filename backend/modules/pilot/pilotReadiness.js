/** TITech Community Capital — SACCO pilot readiness contract. */
export const REQUIRED_PILOT_EVIDENCE = Object.freeze([
  'pilotAgreement', 'tenantProvisioned', 'authorizedUsers', 'rbacVerified',
  'sampleMembersOnboarded', 'financialFlowCompleted', 'reconciliationCompleted',
  'auditTrailVisible', 'supportProcessDemonstrated',
]);

export const PILOT_STATUS = Object.freeze([
  'PROSPECT', 'QUALIFIED', 'AGREEMENT_PENDING', 'ONBOARDING', 'CONTROLLED_GO_LIVE',
  'OPERATIONAL_PILOT', 'EXPANSION_REVIEW', 'CLOSED',
]);

export function assessPilotReadiness(record = {}) {
  const evidence = REQUIRED_PILOT_EVIDENCE.filter((key) => Boolean(record[key]));
  const missing = REQUIRED_PILOT_EVIDENCE.filter((key) => !record[key]);
  const ready = missing.length === 0;
  return Object.freeze({
    ready,
    status: ready ? 'OPERATIONAL_PILOT' : String(record.status || 'ONBOARDING'),
    evidenceCount: evidence.length,
    evidence,
    missing,
    transactionLimit: record.transactionLimit ?? null,
    owner: record.owner ?? null,
  });
}
