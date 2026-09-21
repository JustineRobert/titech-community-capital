#!/usr/bin/env node
/**
 * TITech Community Capital — Enterprise Completeness Gate
 *
 * Dependency-free static guard for the authoritative financial execution
 * surface. It is deliberately narrower than the repository-wide import audit:
 * legacy/duplicate areas remain visible as debt, while critical financial
 * paths fail closed when their contracts regress.
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];

const canonicalFiles = [
  'backend/models/Account.js',
  'backend/models/LedgerEntry.js',
  'backend/models/FinancialLedgerEntry.js',
  'backend/models/Loan.js',
  'backend/models/FinancialTransaction.js',
  'backend/services/financial/financialTransaction.service.js',
  'backend/services/financial/financialOperation.service.js',
  'backend/services/financial/financialRepositoryRegistry.js',
  'backend/services/idempotency/idempotency.service.js',
  'backend/middleware/idempotency.js',
  'backend/controllers/financial/financial.controller.js',
  'backend/controllers/contributionsController.js',
  'backend/routes/financial.routes.js',
  'backend/controllers/repaymentsController.js',
  'backend/repositories/financial/balance.repository.js',
  'backend/repositories/financial/financialTransaction.repository.js',
  'backend/repositories/financial/ledger.repository.js',
  'backend/repositories/financial/loan.repository.js',
];

function source(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    errors.push(`Missing authoritative file: ${relative}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

const loaded = new Map(canonicalFiles.map((relative) => [relative, source(relative)]));

const repoFiles = [
  'backend/repositories/financial/balance.repository.js',
  'backend/repositories/financial/financialTransaction.repository.js',
  'backend/repositories/financial/ledger.repository.js',
  'backend/repositories/financial/loan.repository.js',
];

for (const relative of repoFiles) {
  const text = source(relative);
  if (/\bmodule\.exports\s*=|\brequire\s*\(/.test(text)) {
    errors.push(`${relative}: CommonJS require/module.exports is forbidden on the authoritative financial repository boundary.`);
  }
}

const financialRepo = loaded.get('backend/repositories/financial/financialTransaction.repository.js') || source('backend/repositories/financial/financialTransaction.repository.js');
for (const requiredExport of ['create', 'complete', 'updateState', 'findById', 'requireById']) {
  if (!new RegExp(`\\b${requiredExport}\\b`).test(financialRepo)) {
    errors.push(`financialTransaction.repository.js: missing required contract member ${requiredExport}().`);
  }
}

if (!/FinancialTransaction from ['"]\.\.\/\.\.\/models\/FinancialTransaction\.js['"]/.test(financialRepo)) {
  errors.push('financialTransaction.repository.js: must import the canonical FinancialTransaction model.');
}

const registry = loaded.get('backend/services/financial/financialRepositoryRegistry.js');
for (const required of [
  'transactionRepository:',
  'ledgerRepository,',
  'balanceRepository,',
  'loanRepository,',
  'outboxRepository,',
]) {
  if (!registry.includes(required)) {
    errors.push(`financialRepositoryRegistry.js: missing ${required}`);
  }
}

const financialController = loaded.get('backend/controllers/financial/financial.controller.js');
if (!financialController.includes('repositories:')) {
  errors.push('financial.controller.js: executeFinancialOperation() must receive the canonical repository registry.');
}
if (!financialController.includes('financialRepositoryRegistry')) {
  errors.push('financial.controller.js: canonical repository registry import is missing.');
}

const contributions = loaded.get('backend/controllers/contributionsController.js');
if (!contributions.includes('processFinancialOperation')) {
  errors.push('contributionsController.js: contribution writes must cross processFinancialOperation().');
}
if (/LedgerEntry\.(create|insertMany|findOneAndUpdate|updateOne)/.test(contributions)) {
  errors.push('contributionsController.js: direct LedgerEntry mutation is forbidden.');
}

const repayments = loaded.get('backend/controllers/repaymentsController.js');
if (!repayments.includes('processFinancialOperation')) {
  errors.push('repaymentsController.js: repayment writes must cross processFinancialOperation().');
}
if (/LedgerEntry\.(create|insertMany|findOneAndUpdate|updateOne)|AuditLog\.(create|insertMany)/.test(repayments)) {
  errors.push('repaymentsController.js: direct financial/audit persistence is forbidden.');
}

const activeMutationRoots = [
  'backend/controllers',
  'backend/routes',
];
for (const rootRelative of activeMutationRoots) {
  const directory = path.join(root, rootRelative);
  if (!fs.existsSync(directory)) continue;
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(target);
        continue;
      }
      if (!/\.(?:js|mjs|cjs)$/.test(entry.name)) continue;
      const text = fs.readFileSync(target, 'utf8');
      const relative = path.relative(root, target).replaceAll(path.sep, '/');
      if (/LedgerEntry\.(?:create|insertMany|findOneAndUpdate|updateOne)|Account\.(?:updateOne|findOneAndUpdate)|Wallet\.(?:updateOne|findOneAndUpdate)/.test(text)) {
        errors.push(`${relative}: direct financial persistence is outside the canonical financial service boundary.`);
      }
    }
  }
}

const ledger = loaded.get('backend/models/LedgerEntry.js');
const verifyStart = ledger.indexOf('Basic journal-balance validator');
if (verifyStart >= 0) {
  const verifyBlock = ledger.slice(verifyStart, verifyStart + 5000);
  if (/\bNumber\s*\(/.test(verifyBlock)) {
    errors.push('Legacy LedgerEntry.verifyBalance(): floating-point Number() conversion is forbidden.');
  }
  if (!/BigInt\s*\(/.test(verifyBlock) || !/debitMinor\s*===\s*creditMinor/.test(verifyBlock)) {
    errors.push('Legacy LedgerEntry.verifyBalance(): exact integer comparison is required.');
  }
} else {
  warnings.push('Legacy LedgerEntry.verifyBalance() is outside the canonical repository and is not treated as production evidence.');
}

const canonicalLedgerModel = loaded.get('backend/models/FinancialLedgerEntry.js');
for (const required of ['financialTransactionId:', 'tenantId:', 'accountId:', 'amount:', 'currency:', 'direction:', 'lineNumber:']) {
  if (!canonicalLedgerModel?.includes(required)) {
    errors.push(`FinancialLedgerEntry.js: missing canonical field ${required}`);
  }
}

const financialOperation = loaded.get('backend/services/financial/financialOperation.service.js');
if (!financialOperation.includes('repositories.outboxRepository')) {
  errors.push('financialOperation.service.js: canonical financial completion must receive the outbox repository.');
}
if (!financialOperation.includes('ledgerRepository.createEntries')) {
  errors.push('financialOperation.service.js: canonical posting must use ledgerRepository.createEntries().');
}
if (/createLedgerEntry\(/.test(financialOperation)) {
  errors.push('financialOperation.service.js: direct single-line ledger helper remains in the canonical execution path.');
}

const truthPath = path.join(root, 'TITECH_PLATFORM_TRUTH.md');
if (fs.existsSync(truthPath)) {
  const truth = fs.readFileSync(truthPath, 'utf8');
  if (!/Production approval\s*\|\s*NO/i.test(truth)) {
    warnings.push('TITECH_PLATFORM_TRUTH.md does not state Production approval = NO; verify evidence before changing the status.');
  }
}

const packagePath = path.join(root, 'backend/package.json');
if (fs.existsSync(packagePath)) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (pkg.type !== 'module') {
    errors.push('backend/package.json: canonical backend must remain ESM (`type=module`).');
  }
  if (pkg.engines?.node !== '>=24.15.0') {
    errors.push('backend/package.json: Node target must remain >=24.15.0.');
  }
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  process.exit(1);
}

console.log(`Enterprise completeness gate: PASS (${canonicalFiles.length + repoFiles.length} authoritative financial files checked).`);
