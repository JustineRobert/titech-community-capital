#!/usr/bin/env node
/**
 * Kubernetes rollout/rollback evidence gate. Read-only by default.
 *
 * Required env:
 *   TITECH_K8S_NAMESPACE
 *   TITECH_K8S_BACKEND_DEPLOYMENT
 *   TITECH_K8S_FRONTEND_DEPLOYMENT (optional)
 *   TITECH_K8S_EXPECTED_REVISION (optional)
 *
 * Set TITECH_K8S_VERIFY_ROLLBACK=YES to execute an explicit rollback proof.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const REPORT = path.join(ROOT, 'reports', 'kubernetes-rollout-evidence.json');
const report = { schemaVersion: '1.0.0', status: 'NOT_VERIFIED', startedAt: new Date().toISOString(), checks: [], errors: [] };

function kubectl(args) {
  return execFileSync('kubectl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function requireEnv(name) {
  if (!process.env[name]) throw new Error(`${name} is required`);
  return process.env[name];
}

try {
  requireEnv('TITECH_K8S_NAMESPACE');
  requireEnv('TITECH_K8S_BACKEND_DEPLOYMENT');
  kubectl(['version', '--client=true']);
  const context = kubectl(['config', 'current-context']);
  report.checks.push({ name: 'context', status: 'PASS', context });
  const ns = process.env.TITECH_K8S_NAMESPACE;
  for (const deployment of [process.env.TITECH_K8S_BACKEND_DEPLOYMENT, process.env.TITECH_K8S_FRONTEND_DEPLOYMENT].filter(Boolean)) {
    kubectl(['rollout', 'status', `deployment/${deployment}`, '-n', ns, '--timeout=180s']);
    report.checks.push({ name: `rollout:${deployment}`, status: 'PASS' });
    const revision = kubectl(['get', 'deployment', deployment, '-n', ns, '-o', 'jsonpath={.metadata.annotations.deployment.kubernetes.io/revision}']);
    report.checks.push({ name: `revision:${deployment}`, status: 'PASS', revision });
  }
  if (process.env.TITECH_K8S_EXPECTED_REVISION) {
    const observed = report.checks.find((check) => check.name === `revision:${process.env.TITECH_K8S_BACKEND_DEPLOYMENT}`)?.revision;
    report.checks.push({ name: 'expectedRevision', status: observed === process.env.TITECH_K8S_EXPECTED_REVISION ? 'PASS' : 'FAIL', expected: process.env.TITECH_K8S_EXPECTED_REVISION, observed });
  }
  if (process.env.TITECH_K8S_VERIFY_ROLLBACK === 'YES') {
    if (process.env.TITECH_K8S_ROLLBACK_APPROVAL !== 'YES') {
      throw new Error('Rollback drill requested without TITECH_K8S_ROLLBACK_APPROVAL=YES.');
    }
    const deployment = process.env.TITECH_K8S_BACKEND_DEPLOYMENT;
    const before = kubectl(['get', 'deployment', deployment, '-n', ns, '-o', 'jsonpath={.metadata.annotations.deployment.kubernetes.io/revision}']);
    kubectl(['rollout', 'undo', `deployment/${deployment}`, '-n', ns]);
    kubectl(['rollout', 'status', `deployment/${deployment}`, '-n', ns, '--timeout=180s']);
    const after = kubectl(['get', 'deployment', deployment, '-n', ns, '-o', 'jsonpath={.metadata.annotations.deployment.kubernetes.io/revision}']);
    report.checks.push({ name: 'rollback', status: before !== after ? 'PASS' : 'FAIL', beforeRevision: before, afterRevision: after });
  }
  report.status = report.checks.every((check) => check.status === 'PASS') ? 'PASS' : 'NOT_VERIFIED';
} catch (error) {
  report.errors.push(error?.message || String(error));
  report.status = 'NOT_VERIFIED';
}

report.finishedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'PASS' ? 0 : 1;
