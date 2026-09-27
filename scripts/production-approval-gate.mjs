#!/usr/bin/env node
/**
 * TITech Community Capital — Production Approval Gate
 *
 * Source code never grants production approval. The protected environment must
 * provide external evidence plus accountable approval metadata.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'external-proof-gate.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
} catch {
  console.error('Production approval gate: BLOCKED. Required external evidence has not passed.');
  process.exit(1);
}

console.log('Production approval gate: PASS.');
console.log(`Approval reference: ${process.env.TITECH_APPROVAL_REFERENCE}`);
console.log(`Approval expires: ${new Date(expiry).toISOString()}`);
