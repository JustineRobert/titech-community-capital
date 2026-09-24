#!/usr/bin/env node
/**
 * TITech external-proof evidence gate.
 *
 * The gate intentionally reports NOT_VERIFIED when external proof artifacts are
 * absent. It never turns source-level scaffolding into a production approval.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = path.join(ROOT, 'reports', 'external-proof-gate.json');
const required = {
  runtime: ['Node 24.15.x/npm 11.x evidence'],
  realInfrastructure: ['reports/real-infrastructure-smoke.json'],
  providers: ['reports/provider-sandbox-evidence.json', 'reports/provider-sandbox-gate.json'],
  backupRestore: ['reports/backup-restore-drill.json'],
  kubernetes: ['reports/kubernetes-rollout-evidence.json'],
};

const evidence = {
  schemaVersion: '1.0.0',
  status: 'NOT_VERIFIED',
  generatedAt: new Date().toISOString(),
  required,
  checks: [],
  productionApproved: false,
};

function checkFile(file) {
  const exists = fs.existsSync(path.join(ROOT, file));
  evidence.checks.push({ name: file, status: exists ? 'PRESENT' : 'NOT_VERIFIED' });
  return exists;
}

const nodeParts = process.versions.node.split('.').map(Number);
let npmVersion = 'unknown';
try { npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(); } catch {}
const npmMajor = Number(String(npmVersion).split('.')[0]);
const runtimePass = nodeParts[0] === 24 && nodeParts[1] >= 15 && npmMajor >= 11;
evidence.checks.push({ name: 'runtime', status: runtimePass ? 'PASS' : 'NOT_VERIFIED', observedNode: process.version, observedNpm: npmVersion });

for (const file of ['reports/real-infrastructure-smoke.json', 'reports/provider-sandbox-evidence.json', 'reports/provider-sandbox-gate.json', 'reports/backup-restore-drill.json', 'reports/kubernetes-rollout-evidence.json']) {
  checkFile(file);
}

function reportStatus(file, expected = 'PASS') {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    return parsed.status === expected;
  } catch {
    return false;
  }
}

evidence.checks.push({ name: 'realInfrastructure', status: reportStatus('reports/real-infrastructure-smoke.json') ? 'PASS' : 'NOT_VERIFIED' });
evidence.checks.push({ name: 'providers', status: reportStatus('reports/provider-sandbox-gate.json') ? 'PASS' : 'NOT_VERIFIED' });
evidence.checks.push({ name: 'backupRestore', status: reportStatus('reports/backup-restore-drill.json') ? 'PASS' : 'NOT_VERIFIED' });
evidence.checks.push({ name: 'kubernetes', status: reportStatus('reports/kubernetes-rollout-evidence.json') ? 'PASS' : 'NOT_VERIFIED' });

evidence.status = evidence.checks.every((check) => check.status === 'PASS') ? 'PASS' : 'NOT_VERIFIED';
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
process.exitCode = evidence.status === 'PASS' ? 0 : 1;
