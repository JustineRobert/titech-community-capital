#!/usr/bin/env node
/**
 * TITech external-proof evidence gate.
 *
 * This gate intentionally reports NOT_VERIFIED when environment-backed proof
 * artifacts are absent. Templates, reference harnesses and static source gates
 * are not accepted as production evidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = path.join(ROOT, 'reports', 'external-proof-gate.json');
const evidence = {
  schemaVersion: '2.0.0',
  status: 'NOT_VERIFIED',
  generatedAt: new Date().toISOString(),
  productionApproved: false,
  checks: [],
  requiredExternalEvidence: [
    'reports/real-infrastructure-smoke.json',
    'reports/golden-money-path-e2e.json',
    'reports/provider-certification.json',
    'reports/security-assessment.json',
    'reports/backup-restore-drill.json',
    'reports/kubernetes-rollout-evidence.json',
    'reports/reconciliation-evidence.json',
    'reports/pilot-acceptance.json',
  ],
};

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
  } catch {
    return null;
  }
}

function requirePass(relativePath, acceptedStatuses = ['PASS']) {
  const full = path.join(ROOT, relativePath);
  if (!fs.existsSync(full)) {
    evidence.checks.push({ name: relativePath, status: 'NOT_VERIFIED', reason: 'artifact missing' });
    return false;
  }
  const parsed = readJson(relativePath);
  const status = parsed?.status;
  const pass = acceptedStatuses.includes(status);
  evidence.checks.push({ name: relativePath, status: pass ? 'PASS' : 'NOT_VERIFIED', observedStatus: status ?? null });
  return pass;
}

const nodeParts = process.versions.node.split('.').map(Number);
let npmVersion = 'unknown';
try { npmVersion = execFileSync('npm', ['--version'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch {}
const npmMajor = Number(String(npmVersion).split('.')[0]);
const runtimePass = nodeParts[0] === 24 && nodeParts[1] >= 15 && npmMajor >= 11;
evidence.checks.push({
  name: 'runtime',
  status: runtimePass ? 'PASS' : 'NOT_VERIFIED',
  observedNode: process.version,
  observedNpm: npmVersion,
  requirement: 'Node 24.15.x / npm 11.x',
});

const pathsPass = [
  requirePass('reports/real-infrastructure-smoke.json'),
  requirePass('reports/golden-money-path-e2e.json'),
  requirePass('reports/provider-certification.json'),
  requirePass('reports/security-assessment.json'),
  requirePass('reports/backup-restore-drill.json'),
  requirePass('reports/kubernetes-rollout-evidence.json'),
  requirePass('reports/reconciliation-evidence.json'),
  requirePass('reports/pilot-acceptance.json'),
];

evidence.status = runtimePass && pathsPass.every(Boolean) ? 'PASS' : 'NOT_VERIFIED';
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
process.exitCode = evidence.status === 'PASS' ? 0 : 1;
