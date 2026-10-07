#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const warnings = [];
const checks = [];

const rel = (p) => path.relative(ROOT, p).replaceAll(path.sep, '/');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const size = (p) => {
  const abs = path.join(ROOT, p);
  return fs.existsSync(abs) ? fs.statSync(abs).size : 0;
};
const pass = (id, message) => checks.push({ id, status: 'PASS', message });
const warn = (id, message) => { warnings.push(message); checks.push({ id, status: 'WARN', message }); };
const fail = (id, message) => { failures.push(message); checks.push({ id, status: 'FAIL', message }); };

// Runtime target check is evidence, not an assumption.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major > 24 || (major === 24 && minor >= 15)) pass('node-runtime', `Node ${process.versions.node} satisfies the >=24.15 target.`);
else warn('node-runtime', `Local Node ${process.versions.node} is below the repository target >=24.15; runtime tests are not production evidence.`);

// Required production contracts.
for (const file of [
  'backend/.env.production.example',
  'frontend/.env.production.example',
  'backend/server.js',
  'backend/bootstrap/ApplicationBootstrap.js',
  'backend/modules/finance/ledger/core/journalService.js',
  'backend/modules/finance/ledger/core/postingEngine.js',
  'backend/modules/finance/ledger/core/reversalService.js',
  'backend/modules/finance/ledger/core/balanceService.js',
  'backend/modules/payment/goldenMoneyPathService.js',
  'backend/modules/payment/paymentStateMachine.js',
]) {
  if (size(file) === 0) fail(`required:${file}`, `${file} is missing or zero-byte.`);
}
if (!failures.some((x) => x.includes('production.example'))) pass('production-env-contracts', 'Production environment templates are present and non-zero.');

// Canonical entry point / duplicate root implementation checks.
if (!fs.existsSync(path.join(ROOT, 'backend/server.js'))) fail('entrypoint', 'Canonical backend/server.js is missing.');
if (fs.existsSync(path.join(ROOT, 'backend/PRODUCTION_IMPLEMENTATION_v2.js'))) fail('duplicate-v2', 'Legacy PRODUCTION_IMPLEMENTATION_v2.js remains in the active backend root.');
else pass('duplicate-v2', 'Legacy PRODUCTION_IMPLEMENTATION_v2.js is archived outside the active backend runtime.');
if (fs.existsSync(path.join(ROOT, 'backend/app.cjs'))) fail('duplicate-app-cjs', 'Legacy backend/app.cjs remains in the active backend root.');
else pass('duplicate-app-cjs', 'Legacy backend/app.cjs is archived outside the active backend runtime.');

// Canonical financial surface must contain no zero-byte implementation modules.
const canonicalImplementationFiles = [
  'backend/modules/finance/ledger/core/ledgerEngine.js',
  'backend/modules/finance/ledger/core/journalService.js',
  'backend/modules/finance/ledger/core/postingEngine.js',
  'backend/modules/finance/ledger/core/reversalService.js',
  'backend/modules/finance/ledger/core/balanceService.js',
  'backend/modules/finance/ledger/core/accountLockService.js',
  'backend/modules/finance/ledger/core/adjustmentService.js',
  'backend/modules/finance/ledger/core/fiscalCalendarService.js',
  'backend/modules/payment/paymentStateMachine.js',
  'backend/modules/payment/goldenMoneyPathService.js',
  'backend/repositories/financial/balance.repository.js',
];
const zeroCanonical = canonicalImplementationFiles.filter((file) => size(file) === 0);
if (zeroCanonical.length) fail('canonical-zero-byte', `Authoritative financial/payment implementation files remain zero-byte: ${zeroCanonical.join(', ')}`);
else pass('canonical-zero-byte', 'Authoritative financial/payment implementation files are all non-zero. Dormant future-facing scaffolding remains separately classified as non-canonical debt.');

const zeroByteFiles = [];
function collectZeroBytes(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectZeroBytes(full);
    else if (entry.isFile() && fs.statSync(full).size === 0) zeroByteFiles.push(rel(full));
  }
}
collectZeroBytes(path.join(ROOT, 'backend'));
if (zeroByteFiles.length) warn('zero-byte-debt', `${zeroByteFiles.length} zero-byte backend files remain in dormant/future-facing scaffolding. They are not treated as implemented production capabilities.`);

// Financial placeholder scan on authoritative files.
const authoritative = [
  'backend/modules/finance/ledger/core/ledgerEngine.js',
  'backend/modules/finance/ledger/core/journalService.js',
  'backend/modules/finance/ledger/core/postingEngine.js',
  'backend/modules/finance/ledger/core/reversalService.js',
  'backend/modules/finance/ledger/core/balanceService.js',
  'backend/modules/payment/paymentStateMachine.js',
  'backend/modules/payment/goldenMoneyPathService.js',
];
let placeholderHits = [];
for (const file of authoritative) {
  const text = read(file);
  for (const token of ['throw new Error("Not implemented', "NOT_IMPLEMENTED", 'will be implemented in Milestone']) {
    if (text.includes(token)) placeholderHits.push(`${file}:${token}`);
  }
}
if (placeholderHits.length) fail('financial-placeholders', `Authoritative financial files still contain placeholder implementation markers: ${placeholderHits.join('; ')}`);
else pass('financial-placeholders', 'Authoritative financial surface has no placeholder implementation markers.');

// Merge conflict markers.
let conflicts = '';
try { conflicts = execFileSync('git', ['grep', '-nE', '<<<<<<<|=======|>>>>>>>'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* no git metadata or no matches */ }
if (conflicts.trim()) fail('merge-conflicts', 'Merge conflict markers were found in tracked content.');
else pass('merge-conflicts', 'No merge-conflict markers were detected by the local gate.');

// Official theme gate, when available.
const theme = path.join(ROOT, 'branding/BRAND_MANIFEST.json');
if (fs.existsSync(theme) && size('branding/BRAND_MANIFEST.json') > 0) pass('theme-contract', 'Official TITech brand manifest exists and is non-zero.');
else fail('theme-contract', 'Official TITech brand manifest is missing or zero-byte.');

// Evidence boundary: source proof cannot become external production proof.
const externalEvidence = [
  'docs/evidence/10-mtn-sandbox-proof.md',
  'docs/evidence/11-mtn-production-proof.md',
  'docs/evidence/18-backup-restore-drill.md',
  'docs/evidence/20-kubernetes-deployment-proof.md',
  'docs/evidence/24-uganda-legal-regulatory-review.md',
  'docs/evidence/25-pilot-01-evidence.md',
  'docs/evidence/26-pilot-02-evidence.md',
  'docs/evidence/27-pilot-03-evidence.md',
  'docs/evidence/28-first-paying-customer.md',
];
const evidenceMissing = externalEvidence.filter((file) => size(file) === 0);
if (evidenceMissing.length) warn('external-evidence-files', `Evidence placeholders are empty for ${evidenceMissing.length} external gate(s); production approval remains blocked.`);
else warn('external-evidence-files', 'Evidence files exist, but their claims still require independent/external verification; this source gate does not upgrade them to verified operational evidence.');

const status = failures.length ? 'BLOCKED' : (warnings.length ? 'PASS_WITH_WARNINGS' : 'PASS');
const report = {
  generatedAt: new Date().toISOString(),
  status,
  localRuntime: process.versions.node,
  targetRuntime: '>=24.15.0 / npm >=11.0.0',
  failures,
  warnings,
  checks,
};
const outDir = path.join(ROOT, 'reports');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'titech-enterprise-remediation-gate.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length ? 1 : 0;
