#!/usr/bin/env node

/**
 * Repository truth / architectural debt audit.
 *
 * This audit is intentionally non-destructive. It classifies debt instead of
 * manufacturing missing implementations. CI may run it in report mode; the
 * strict release gate can be enabled separately when the repository is ready.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const excludedDirs = new Set(['node_modules', '.git', 'coverage', 'dist', 'build']);
const files = [];
const zeroByte = [];
const cjs = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excludedDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(full);
  }
}

walk(root);
for (const file of files) {
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  const source = fs.readFileSync(file, 'utf8');
  if (!source.trim()) zeroByte.push(relative);
  if (/\bmodule\.exports\b|\brequire\s*\(/.test(source) && /(^|\/)backend\//.test(relative)) cjs.push(relative);
}

const debtScript = path.join(root, 'scripts', 'runtime-import-audit.mjs');
const result = spawnSync(process.execPath, [debtScript], { cwd: root, encoding: 'utf8' });
const reportFile = path.join(root, 'reports', 'runtime-import-audit.json');
let runtimeAudit = null;
if (fs.existsSync(reportFile)) {
  runtimeAudit = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
}

const canonicalFinancialSurface = new Set([
  'backend/services/financial/financialTransaction.service.js',
  'backend/services/financial/financialOperation.service.js',
  'backend/services/idempotency/idempotency.service.js',
  'backend/services/idempotency/idempotency.store.js',
  'backend/controllers/financial/financial.controller.js',
  'backend/controllers/contributionsController.js',
  'backend/middleware/idempotency.js',
  'backend/repositories/financial/ledger.repository.js',
  'backend/models/FinancialLedgerEntry.js',
  'backend/models/Payment.js',
  'backend/models/PaymentIntent.js',
  'backend/modules/payment/goldenMoneyPathService.js',
  'backend/modules/payment/paymentProcessingService.js',
  'backend/modules/payment/paymentStateMachine.js',
  'backend/modules/payment/providerInterface.js',
  'backend/modules/payment/settlement/ledgerPostingService.js',
  'backend/modules/payment/settlement/settlementStateMachine.js',
  'backend/modules/transactions/TransactionStateMachine.js',
  'backend/modules/finance/ledger/core/ledgerEngine.js',
  'backend/modules/finance/balance/balanceEngine.js',
  'backend/src/modules/payments/reconciliation/reconciliation.service.js',
]);

const criticalZeroByte = zeroByte.filter((file) => canonicalFinancialSurface.has(file));

const output = {
  generatedAt: new Date().toISOString(),
  sourceFilesScanned: files.length,
  zeroByteFiles: zeroByte.map((file) => ({
    file,
    classification: criticalZeroByte.includes(file) ? 'CRITICAL_FINANCIAL_SURFACE' : 'REVIEW_REQUIRED',
  })),
  zeroByteSummary: {
    total: zeroByte.length,
    criticalFinancialSurface: criticalZeroByte.length,
  },
  moduleSystemDebt: {
    backendCommonJsCandidates: cjs.length,
    note: 'CommonJS is classified, not globally rewritten. Existing compatibility boundaries remain until individually verified.',
  },
  runtimeImportAudit: {
    exitCode: result.status,
    missingLocalImports: runtimeAudit?.missingLocalImports?.length ?? null,
    criticalMissing: runtimeAudit?.criticalMissing?.length ?? null,
    mixedCanonicalFinancialModules: runtimeAudit?.mixedCanonicalFinancialModules?.length ?? null,
  },
  releaseInterpretation: {
    status: criticalZeroByte.length === 0 && (runtimeAudit?.criticalMissing?.length ?? 0) === 0 ? 'PASS' : 'WARN',
    productionApproval: 'NOT_GRANTED_BY_SOURCE_AUDIT',
  },
};

const outDir = path.join(root, 'reports');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'architecture-debt-audit.json');
fs.writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`);

console.log(`Architecture debt audit: ${output.releaseInterpretation.status}`);
console.log(`Source files: ${output.sourceFilesScanned}`);
console.log(`Zero-byte files: ${output.zeroByteSummary.total}`);
console.log(`Critical financial zero-byte files: ${output.zeroByteSummary.criticalFinancialSurface}`);
console.log(`Missing local imports: ${output.runtimeImportAudit.missingLocalImports}`);
console.log(`Report: ${path.relative(root, outFile)}`);

if (process.argv.includes('--strict') && output.releaseInterpretation.status !== 'PASS') process.exit(1);
