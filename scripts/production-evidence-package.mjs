#!/usr/bin/env node
/**
 * Build an auditable production-readiness evidence package without inventing
 * external verification.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = path.join(ROOT, 'reports');
const EVIDENCE = path.join(ROOT, 'docs', 'production', 'evidence');
fs.mkdirSync(REPORTS, { recursive: true });
fs.mkdirSync(EVIDENCE, { recursive: true });

function run(script) {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', script)], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
    return 'PASS';
  } catch {
    return 'FAIL';
  }
}

const staticSecurity = run('security-static-gate.mjs');
const authority = run('authority-map-audit.mjs');
const golden = run('golden-money-path-proof.mjs');
const container = run('container-context-contract.mjs');
const nodeMajor = Number(process.versions.node.split('.')[0]);
let npmVersion = 'unknown';
try { npmVersion = execFileSync('npm', ['--version'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch {}

const reports = {
  'production-readiness.json': {
    status: 'NOT_PRODUCTION_APPROVED',
    implementation: {
      repositoryTruthInventory: 'IMPLEMENTED',
      canonicalAuthorityMap: authority,
      sourceSecurityContracts: staticSecurity,
      containerContextContract: container,
      goldenMoneyReferenceProof: golden,
    },
    targetRuntime: 'Node 24.15.x / npm 11.x',
    observedRuntime: `Node ${process.version} / npm ${npmVersion}`,
    externalGates: {
      realMongoRedis: 'UNVERIFIED',
      providerCertification: 'UNVERIFIED',
      securityScans: 'UNVERIFIED',
      backupRestore: 'UNVERIFIED',
      kubernetesRolloutRollback: 'UNVERIFIED',
      realInstitutionPilot: 'UNVERIFIED',
      regulatoryApproval: 'UNVERIFIED',
      productionApproval: 'BLOCKED',
    },
  },
  'test-results.json': {
    status: 'PARTIAL_SOURCE_LEVEL_ONLY',
    dependencyFree: {
      syntax: 'SEE enterprise-gate output',
      financialStatic: 'SEE financial-static-gate output',
      enterpriseContracts: 'SEE enterprise-contract-contracts output',
      securityStaticGate: staticSecurity,
      goldenMoneyPathReference: golden,
    },
    runtimeBacked: 'UNVERIFIED_IN_CURRENT_SANDBOX',
  },
  'security-results.json': {
    status: staticSecurity === 'PASS' ? 'SOURCE_CONTRACTS_PASS_EXTERNAL_SCANS_PENDING' : 'FAIL',
    sourceContracts: staticSecurity,
    requiredExternalEvidence: ['SAST', 'DAST', 'dependency scan', 'secret scan', 'container scan', 'IaC scan', 'tenant-isolation test', 'webhook replay test'],
  },
  'provider-certification.json': {
    status: 'NOT_VERIFIED',
    targetProviders: ['MTN', 'Airtel', 'one additional commercially relevant rail'],
    requiredEvidence: ['initiate', 'authenticate', 'submit', 'provider reference', 'callback verification', 'status', 'settlement', 'reconciliation', 'retry', 'duplicate rejection', 'outage recovery'],
  },
  'reconciliation-results.json': {
    status: 'REFERENCE_IMPLEMENTATION_PRESENT_EXTERNAL_EVIDENCE_PENDING',
    targetMetric: '>99% operational match-rate target',
    requiredEvidence: ['provider/internal/settlement/ledger comparison', 'exception queue', 'maker-checker resolution', 'measured batch result'],
  },
  'dr-restore-results.json': {
    status: 'NOT_VERIFIED',
    requiredEvidence: ['backup artifact', 'checksum validation', 'restore execution', 'post-restore validation', 'measured RPO', 'measured RTO'],
  },
};

for (const [name, payload] of Object.entries(reports)) {
  fs.writeFileSync(path.join(REPORTS, name), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...payload }, null, 2)}\n`);
}

const index = {
  generatedAt: new Date().toISOString(),
  repository: 'https://github.com/JustineRobert/titech-community-capital',
  observedRuntime: { node: process.version, npm: npmVersion },
  targetRuntime: 'Node 24.15.x / npm 11.x',
  files: Object.keys(reports).map((name) => `reports/${name}`),
  approval: 'BLOCKED_UNTIL_EXTERNAL_EVIDENCE',
};
fs.writeFileSync(path.join(REPORTS, 'production-evidence-index.json'), `${JSON.stringify(index, null, 2)}\n`);
fs.writeFileSync(path.join(EVIDENCE, 'production-evidence-index.json'), `${JSON.stringify(index, null, 2)}\n`);

console.log(JSON.stringify(index, null, 2));
