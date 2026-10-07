#!/usr/bin/env node
/**
 * TITech Community Capital — Enterprise Master Readiness Gate
 *
 * Purpose:
 *   Combine repository/static proof, runtime evidence, regulatory evidence,
 *   operational recovery, provider proof, pilot proof and commercial proof
 *   without allowing source artifacts to masquerade as external evidence.
 *
 * Default mode is an evidence report. --strict is the release-blocking mode.
 * Strict mode is intentionally expected to fail until the external evidence
 * gates are actually completed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
const matrixPath = path.join(ROOT, 'docs/evidence/production-readiness-matrix.csv');
const reportsDir = path.join(ROOT, 'reports');
const evidenceDir = path.join(ROOT, 'docs/evidence');
const DATE = '2026-10-07';

const checks = [];
const failures = [];
const warnings = [];

const rel = (p) => path.relative(ROOT, p).replaceAll(path.sep, '/');
const existsNonZero = (relativePath) => {
  const full = path.join(ROOT, relativePath);
  return fs.existsSync(full) && fs.statSync(full).isFile() && fs.statSync(full).size > 0;
};
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const pass = (id, message) => checks.push({ id, status: 'PASS', message });
const warn = (id, message) => { warnings.push(message); checks.push({ id, status: 'WARN', message }); };
const fail = (id, message) => { failures.push(message); checks.push({ id, status: 'FAIL', message }); };

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (quoted && next === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const [header, ...data] = rows;
  return data.map((values) => Object.fromEntries(header.map((key, i) => [key, values[i] ?? ''])));
}

if (!fs.existsSync(matrixPath)) fail('matrix', 'production-readiness-matrix.csv is missing.');
const matrix = fs.existsSync(matrixPath) ? parseCsv(fs.readFileSync(matrixPath, 'utf8')) : [];
if (matrix.length >= 30) pass('matrix', `Readiness matrix contains ${matrix.length} controlled capability rows.`);
else fail('matrix', `Readiness matrix is incomplete: ${matrix.length} rows found; expected at least 30.`);

const requiredDocs = [
  'docs/regulatory/regulatory-boundary-memo.md',
  'docs/regulatory/regulated-vs-non-regulated-activities-matrix.md',
  'docs/regulatory/partner-responsibility-matrix.md',
  'docs/regulatory/data-processing-and-controller-processor-matrix.md',
  'docs/regulatory/consent-and-data-sharing-model.md',
  'docs/regulatory/regulatory-assumptions-and-open-questions.md',
  'docs/regulatory/regulatory-evidence-register.md',
  'docs/regulatory/regulatory-change-monitoring.md',
  'docs/regulatory/legal-review-questions.md',
  'docs/regulatory/pilot-regulatory-control-checklist.md',
  'docs/enterprise/critical-path-map.md',
  'docs/enterprise/financial-invariant-specification.md',
  'docs/enterprise/test-strategy.md',
  'docs/enterprise/e2e-strategy.md',
  'docs/enterprise/resilience-strategy.md',
  'docs/enterprise/provider-contract-mtn.md',
  'docs/enterprise/reconciliation-control-model.md',
  'docs/ops/deployment-runbook.md',
  'docs/ops/rollback-runbook.md',
  'docs/ops/backup-restore-runbook.md',
  'docs/ops/incident-response-runbook.md',
  'docs/commercial/pilot-playbook.md',
  'docs/commercial/customer-onboarding-checklist.md',
  'docs/commercial/roi-measurement-template.md',
  'docs/commercial/pricing-experiment.md',
  'docs/commercial/case-study-template.md',
  'docs/investor/kpi-definitions.md',
  'docs/investor/evidence-room-index.md',
  'docs/investor/partner-pipeline-template.md',
  'docs/investor/institution-pipeline-template.md',
  'docs/investor/use-of-funds-milestones.md',
]
const missingDocs = requiredDocs.filter((p) => !existsNonZero(p));
if (!missingDocs.length) pass('required-docs', `All ${requiredDocs.length} master-package documents are present and non-zero.`);
else fail('required-docs', `Missing/empty master-package documents: ${missingDocs.join(', ')}`);

const canonicalFinancial = [
  'backend/modules/finance/ledger/core/ledgerEngine.js',
  'backend/modules/finance/ledger/core/journalService.js',
  'backend/modules/finance/ledger/core/postingEngine.js',
  'backend/modules/finance/ledger/core/reversalService.js',
  'backend/modules/finance/ledger/core/balanceService.js',
  'backend/modules/payment/paymentStateMachine.js',
  'backend/modules/payment/goldenMoneyPathService.js',
  'backend/repositories/financial/balance.repository.js',
];
const financialMissing = canonicalFinancial.filter((p) => !existsNonZero(p));
if (!financialMissing.length) pass('canonical-financial', 'Canonical financial/payment implementation surface is present and non-zero.');
else fail('canonical-financial', `Canonical financial/payment implementation missing: ${financialMissing.join(', ')}`);

const placeholders = canonicalFinancial.flatMap((p) => {
  if (!existsNonZero(p)) return [];
  const t = read(p);
  return ['NOT_IMPLEMENTED', 'will be implemented in Milestone', 'throw new Error("Not implemented'].filter((token) => t.includes(token)).map((token) => `${p}:${token}`);
});
if (!placeholders.length) pass('financial-placeholders', 'No known placeholder markers found in the canonical financial/payment surface.');
else fail('financial-placeholders', `Placeholder markers remain in canonical financial/payment files: ${placeholders.join('; ')}`);

// Existing deterministic source gates: failures are hard failures; warnings remain visible.
const gateCommands = [
  ['financial-static', 'scripts/financial-static-gate.mjs'],
  ['enterprise-contracts', 'scripts/enterprise-contract-contracts.mjs'],
  ['runtime-imports', 'scripts/runtime-import-audit.mjs'],
  ['source-contracts', 'scripts/source-contract-smoke.mjs'],
  ['golden-proof', 'scripts/golden-money-path-proof.mjs'],
];
for (const [id, file] of gateCommands) {
  try {
    execFileSync(process.execPath, [path.join(ROOT, file)], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
    pass(`gate:${id}`, `${file} returned exit code 0.`);
  } catch (error) {
    fail(`gate:${id}`, `${file} failed. ${String(error.stdout || error.stderr || error.message).slice(-1200)}`);
  }
}

const node = process.versions.node.split('.').map(Number);
let npmVersion = 'unknown';
try { npmVersion = execFileSync('npm', ['--version'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* evidence remains visible */ }
const npmMajor = Number(String(npmVersion).split('.')[0]);
const runtimePass = node[0] > 24 || (node[0] === 24 && node[1] >= 15 && npmMajor >= 11);
if (runtimePass) pass('target-runtime', `Node ${process.version} and npm ${npmVersion} satisfy the target runtime.`);
else warn('target-runtime', `Observed Node ${process.version}/npm ${npmVersion} does not satisfy Node 24.15.x/npm 11.x; dependency-backed runtime evidence is blocked.`);

const dependencyInstalled = existsNonZero('backend/node_modules/jest/bin/jest.js') && existsNonZero('frontend/node_modules/vite/bin/vite.js');
if (dependencyInstalled) pass('dependencies-installed', 'Backend Jest and frontend Vite launchers are present.');
else warn('dependencies-installed', 'Required dependency trees are not installed in this execution environment; full Jest/Vite/E2E proof is unavailable here.');

const productionTruthFiles = [
  'TITECH_PLATFORM_TRUTH.md',
  'TITECH_ENTERPRISE_READINESS_STATUS_2026-10-07.md',
  'TITECH_ENTERPRISE_PRODUCTION_READINESS_CERTIFICATE.md',
];
const truthText = productionTruthFiles.filter((p) => existsNonZero(p)).map(read).join('\n');
const falseGreen = /PRODUCTION_APPROVED\s*:\s*(YES|true)|PRODUCTION APPROVED\s*[:=]\s*YES/i.test(truthText);
if (falseGreen) fail('no-false-green', 'Production approval appears to be asserted in source truth documents; remove the false-green claim before release.');
else pass('no-false-green', 'Source truth documents do not assert production approval.');

// External evidence must be represented as real artifacts, not templates.
const externalRows = matrix.filter((row) => row.blocking === 'YES');
const unresolvedBlocking = externalRows.filter((row) => !['PASS', 'VERIFIED', 'PRODUCTION_APPROVED'].includes(row.status));
if (!unresolvedBlocking.length) pass('external-evidence', 'No blocking readiness rows remain unresolved.');
else warn('external-evidence', `${unresolvedBlocking.length} blocking readiness rows remain outside PASS/VERIFIED state.`);

// Strict mode: fail for runtime mismatch or unresolved blocking rows.
if (strict) {
  if (!runtimePass) failures.push('Strict gate requires Node 24.15.x / npm 11.x execution.');
  if (!dependencyInstalled) failures.push('Strict gate requires installed backend/frontend dependency trees.');
  if (unresolvedBlocking.length) failures.push(`Strict gate blocked by ${unresolvedBlocking.length} unresolved blocking readiness rows.`);
}

const status = failures.length ? 'BLOCKED' : (unresolvedBlocking.length ? 'PILOT_HARDENED_WITH_EXTERNAL_GATES_OPEN' : 'PASS');
const report = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  strict,
  status,
  productionApproved: false,
  targetRuntime: 'Node 24.15.x / npm 11.x',
  observedRuntime: { node: process.version, npm: npmVersion },
  checks,
  failures,
  warnings,
  blockingRows: unresolvedBlocking.map((row) => ({
    gate: row.gate,
    capability: row.capability,
    status: row.status,
    evidenceLevel: row.evidence_level,
    evidence: row.evidence_location,
    nextRequirement: row.next_requirement,
    owner: row.owner,
  })),
};
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(path.join(reportsDir, 'titech-enterprise-master-gate.json'), JSON.stringify(report, null, 2) + '\n');
if (strict) fs.writeFileSync(path.join(reportsDir, 'titech-enterprise-master-gate.strict.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(evidenceDir, '2026-10-07-master-gate-summary.md'), `# TITech Enterprise Master Gate — ${DATE}\n\n**Mode:** ${strict ? 'STRICT RELEASE BLOCKING' : 'EVIDENCE REPORT'}\n\n**Status:** ${status}\n\n**Production approved:** NO\n\nObserved runtime: Node ${process.version} / npm ${npmVersion}.\n\nBlocking rows remain external until verified with target-runtime, infrastructure, provider, security, recovery, regulatory, pilot and commercial evidence.\n\nThe machine report is reports/titech-enterprise-master-gate.json.\n`);
console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length ? 1 : 0;
