#!/usr/bin/env node
/**
 * TITech Community Capital — Financial Static Gate
 *
 * This gate is intentionally conservative. It does not prove runtime financial
 * correctness; it detects common regressions in the canonical financial
 * boundary and verifies that the exact-money utility is present and tested.
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const canonicalFiles = [
  'backend/services/financial/financialTransaction.service.js',
  'backend/services/financial/financialOperation.service.js',
  'backend/services/financial/money.js',
  'backend/services/idempotency/idempotency.service.js',
  'backend/services/idempotency/idempotency.store.js',
  'backend/controllers/financial/financial.controller.js',
  'backend/controllers/contributionsController.js',
  'backend/middleware/idempotency.js',
];

const errors = [];
const warnings = [];

for (const relative of canonicalFiles) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    errors.push(`Missing canonical financial file: ${relative}`);
    continue;
  }

  const source = fs.readFileSync(file, 'utf8');

  if (/module\.exports\s*=/.test(source)) {
    errors.push(`${relative}: CommonJS module.exports is forbidden on the canonical ESM financial surface.`);
  }

  if (/createRequire\([^)]*\)/.test(source) && !relative.endsWith('idempotency.store.js')) {
    errors.push(`${relative}: createRequire() is forbidden on the canonical financial ESM surface.`);
  }

  if (/\brequire\s*\(/.test(source)) {
    errors.push(`${relative}: require() is forbidden on the canonical financial ESM surface.`);
  }
}


if (/Promise\.resolve\(\s*mongoose\.startSession/.test(fs.readFileSync(
  path.join(root, 'backend/services/financial/financialTransaction.service.js'),
  'utf8',
))) {
  errors.push('financialTransaction.service.js contains the invalid pre-session startSession function assertion.');
}

const moneySource = fs.readFileSync(
  path.join(root, 'backend/services/financial/money.js'),
  'utf8',
);

for (const forbidden of [
  /parseFloat\s*\(/,
  /parseInt\s*\(/,
  /Number\s*\(/,
  /Math\.(round|floor|ceil)\s*\(/,
]) {
  if (forbidden.test(moneySource)) {
    errors.push(`money.js contains forbidden floating-point conversion/arithmetic: ${forbidden}`);
  }
}

if (!/BigInt\s*\(/.test(moneySource)) {
  errors.push('money.js must use BigInt for exact fixed-point arithmetic.');
}

const testFile = path.join(root, 'backend/tests/unit/financial/money.test.js');
if (!fs.existsSync(testFile)) {
  errors.push('Missing executable exact-money unit test.');
}

const financialTruth = path.join(root, 'TITECH_PLATFORM_TRUTH.md');
if (fs.existsSync(financialTruth)) {
  const truth = fs.readFileSync(financialTruth, 'utf8');
  if (!/Production approval\s*\|\s*NO/i.test(truth)) {
    warnings.push('TITECH_PLATFORM_TRUTH.md does not currently state Production approval = NO. Verify evidence before changing this.');
  }
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  process.exit(1);
}

console.log(`Financial static gate: PASS (${canonicalFiles.length} canonical files checked).`);
