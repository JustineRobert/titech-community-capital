#!/usr/bin/env node
/**
 * TITech Community Capital — Production Approval Gate
 *
 * This gate is intentionally external-evidence driven. Source code alone never
 * becomes production-approved.
 *
 * Required environment variables in the protected production environment:
 *   TITECH_PRODUCTION_APPROVAL=YES
 *   TITECH_APPROVAL_REFERENCE=<change-control / CAB / accountable approval id>
 *   TITECH_APPROVAL_EXPIRES_AT=<ISO-8601 UTC timestamp>
 *
 * The deploy workflow remains protected by GitHub's production environment rules.
 */

const required = [
  'TITECH_PRODUCTION_APPROVAL',
  'TITECH_APPROVAL_REFERENCE',
  'TITECH_APPROVAL_EXPIRES_AT',
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Production approval gate: BLOCKED. Missing protected evidence: ${missing.join(', ')}`);
  process.exit(1);
}

if (process.env.TITECH_PRODUCTION_APPROVAL !== 'YES') {
  console.error('Production approval gate: BLOCKED. TITECH_PRODUCTION_APPROVAL must equal YES.');
  process.exit(1);
}

const expiry = Date.parse(process.env.TITECH_APPROVAL_EXPIRES_AT);
if (!Number.isFinite(expiry)) {
  console.error('Production approval gate: BLOCKED. TITECH_APPROVAL_EXPIRES_AT must be a valid ISO-8601 timestamp.');
  process.exit(1);
}

if (expiry <= Date.now()) {
  console.error('Production approval gate: BLOCKED. Production approval evidence has expired.');
  process.exit(1);
}

console.log('Production approval gate: PASS.');
console.log(`Approval reference: ${process.env.TITECH_APPROVAL_REFERENCE}`);
console.log(`Approval expires: ${new Date(expiry).toISOString()}`);
