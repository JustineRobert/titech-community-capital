#!/usr/bin/env node
/**
 * TITech Community Capital — Dependency-light enterprise contract gate.
 * Checks that critical control-plane contracts exist and contain their required
 * invariants without claiming runtime/service/provider evidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  ['PRODUCT_POSITIONING.md', ['Community Financial Infrastructure Layer', 'NOT a consumer wallet', 'NOT a generic SACCO ERP', 'NOT a balance-sheet lender']],
  ['backend/modules/platform/domain/financialStates.js', ['REQUESTED', 'SETTLED', 'REQUIRES_REVIEW', 'LOCAL_ONLY', 'PENDING_SYNC']],
  ['backend/modules/consent/models/ConsentRecord.js', ['tenantId', 'dataCategories', 'purpose', 'recipient', 'expiresAt', 'WITHDRAWN']],
  ['backend/modules/consent/services/consentService.js', ['assertActiveConsent', 'CONSENT_REQUIRED', 'CONSENT_PURPOSE_MISMATCH']],
  ['backend/modules/capital/models/CapitalShareRequest.js', ['consentId', 'recipientPartnerId', 'APPROVED', 'REVOKED']],
  ['backend/modules/capital/services/capitalConnectivityService.js', ['assertActiveConsent', 'FOUR_EYES_REQUIRED', 'payloadHash']],
  ['backend/modules/operations/models/SupportCase.js', ['tenantId', 'linked', 'sla', 'events']],
  ['backend/modules/operations/sla/slaPolicy.js', ['SLA_POLICIES', 'computeSlaDueAt']],
  ['backend/modules/provenance/models/DataProvenance.js', ['sourceId', 'transformation', 'validationStatus', 'confidence', 'consentId']],
  ['backend/modules/audit/audit.model.js', ['previousHash', 'hash', 'immutable', 'verifyChain']],
  ['backend/middleware/platformPermissions.js', ['requirePermission', 'fail closed', 'PERMISSION_DENIED']],
];
const errors = [];
for (const [relative, markers] of required) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) { errors.push(`Missing: ${relative}`); continue; }
  const source = fs.readFileSync(file, 'utf8');
  const haystack = source.toLowerCase();
  for (const marker of markers) if (!haystack.includes(marker.toLowerCase())) errors.push(`${relative}: missing marker "${marker}"`);
}
const truth = fs.existsSync(path.join(ROOT, 'TITECH_PLATFORM_TRUTH.md')) ? fs.readFileSync(path.join(ROOT, 'TITECH_PLATFORM_TRUTH.md'), 'utf8') : '';
if (!/PRODUCTION_APPROVED\s*[:|]\s*NO/i.test(truth)) errors.push('TITECH_PLATFORM_TRUTH.md must retain PRODUCTION_APPROVED: NO until external evidence exists.');
if (errors.length) { console.error('Enterprise contract gate: FAIL'); for (const e of errors) console.error(`FAIL: ${e}`); process.exit(1); }
console.log(`Enterprise contract gate: PASS (${required.length} control-plane contracts checked).`);
