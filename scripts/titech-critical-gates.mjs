#!/usr/bin/env node
/**
 * Validates the TITech P0/P1 release-gate contract and evidence ordering.
 * This contract checker never promotes live/external evidence and never grants approval.
 * Use --strict to fail while any blocking gate is not VERIFIED; then the protected
 * production approval gate must still pass independently.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_PATH = 'docs/evidence/critical-gates-2026-10-28.json';
const EXPECTED_GATES = [
  ['P0_RUNTIME_INSTALL', 'P0'],
  ['P0_BOOTSTRAP_HEALTH', 'P0'],
  ['P0_LEDGER_REPLAY', 'P0'],
  ['P0_PROVIDER_FAILURES', 'P0'],
  ['P0_TENANT_PERMISSIONS', 'P0'],
  ['P1_SECURITY_RECOVERY', 'P1'],
  ['P1_REGULATORY_PARTNER', 'P1'],
  ['P1_COMMERCIAL_PILOT', 'P1'],
];
const EXPECTED_LADDER = ['Designed', 'Implemented', 'Unit', 'Integration', 'E2E', 'Operational', 'Security-Assessed', 'Externally-Approved', 'Production-Approved'];
const EXPECTED_FLOW = [
  'Institution / tenant', 'Consented member / group', 'Financial intent', 'Payment instruction',
  'Provider attempt', 'Verified outcome', 'Settlement evidence', 'Financial transaction',
  'Balanced double-entry ledger', 'Derived balance', 'Receipt', 'Outbox / audit',
  'Reconciliation', 'Exception workflow', 'Period close',
];

export function validateCriticalGateContract(root = ROOT) {
  const errors = [];
  const abs = (relativePath) => path.join(root, relativePath);
  const requiredText = (relativePath) => {
    try { return fs.readFileSync(abs(relativePath), 'utf8'); }
    catch { errors.push(`Missing required file: ${relativePath}`); return ''; }
  };
  let contract;
  try { contract = JSON.parse(requiredText(CONTRACT_PATH)); }
  catch (error) { errors.push(`Invalid critical gate JSON: ${error.message}`); }

  if (contract) {
    if (contract.product !== 'TITech Community Capital') errors.push('Product identity must remain TITech Community Capital.');
    if (contract.organization !== 'TITech Capital LTD') errors.push('Organization identity contract must remain TITech Capital LTD.');
    if (contract.productionApproved !== false) errors.push('The committed evidence baseline must keep productionApproved=false.');
    if (contract.releaseStatus !== 'NOT_READY') errors.push('The committed evidence baseline must remain NOT_READY until proof is complete.');
    if (JSON.stringify(contract.evidenceLadder) !== JSON.stringify(EXPECTED_LADDER)) errors.push('Evidence ladder is missing, reordered or changed.');
    if (JSON.stringify(contract.goldenMoneyPath) !== JSON.stringify(EXPECTED_FLOW)) errors.push('Golden Money Path stages are missing, reordered or renamed.');
    const actual = (contract.gates ?? []).map((gate) => [gate.id, gate.priority]);
    if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_GATES)) errors.push('Critical gates must remain in the declared P0 then P1 order.');
    for (const gate of contract.gates ?? []) {
      if (!gate.title || !Array.isArray(gate.minimumEvidence) || gate.minimumEvidence.length < 3 || !gate.releaseRule || !Array.isArray(gate.evidenceRefs)) {
        errors.push(`${gate.id ?? '(unknown gate)'} is missing minimum evidence, release rule or evidence references.`);
      }
      if (gate.blocking !== true) errors.push(`${gate.id} must remain release-blocking until evidence is accepted.`);
      if (!['NOT_VERIFIED', 'EXTERNAL_REQUIRED', 'VERIFIED'].includes(gate.status)) errors.push(`${gate.id} has an unsupported status ${gate.status}.`);
    }
    if (contract.executionPolicy?.timeoutState?.toUpperCase() !== 'UNKNOWN UNTIL VERIFIED THROUGH AUTHORITATIVE PROVIDER STATUS/SETTLEMENT EVIDENCE') {
      errors.push('Provider timeout policy must retain UNKNOWN until authoritative verification.');
    }
  }

  for (const relativePath of ['package.json', 'backend/package.json', 'frontend/package.json']) {
    try {
      const manifest = JSON.parse(fs.readFileSync(abs(relativePath), 'utf8'));
      if (!manifest.engines || manifest.engines.node !== '>=24.15.0' || manifest.engines.npm !== '>=11.0.0') {
        errors.push(`${relativePath} must declare Node >=24.15.0 and npm >=11.0.0.`);
      }
    } catch { errors.push(`Unable to parse ${relativePath}.`); }
  }
  if (requiredText('.nvmrc').trim() !== '24.15.0') errors.push('.nvmrc must pin Node 24.15.0.');
  for (const relativePath of ['package-lock.json', 'backend/package-lock.json', 'frontend/package-lock.json']) {
    try { if (fs.statSync(abs(relativePath)).size === 0) errors.push(`${relativePath} must not be empty.`); }
    catch { errors.push(`${relativePath} is missing.`); }
  }
  const workflow = requiredText('.github/workflows/ci.yml');
  for (const token of ['docker-compose.validation.yml', 'npm ci --include=dev', 'npm run check:runtime']) {
    if (!workflow.includes(token)) errors.push(`CI workflow is missing required contract token: ${token}`);
  }
  if (!workflow.includes("node-version-file: '.nvmrc'")) errors.push('CI must consume the canonical .nvmrc Node pin.');
  if (!fs.existsSync(abs('scripts/titech-supported-runtime-gate.mjs'))) errors.push('Supported runtime gate script is missing.');
  if (/node-version:\s*\[?\s*['\"]?22\./.test(workflow)) errors.push('Unsupported Node 22 must not be a release-candidate CI runtime.');
  const validationCompose = requiredText('docker-compose.validation.yml');
  if (!validationCompose.includes('--replSet') || !validationCompose.includes('--appendonly') || !validationCompose.includes('rs0') || !validationCompose.includes('--maxmemory-policy') || !validationCompose.includes('noeviction')) {
    errors.push('Validation services must include a MongoDB replica set and persistent, non-evicting Redis configuration.');
  }
  if (!validationCompose.includes('127.0.0.1:27017:27017') || !validationCompose.includes('127.0.0.1:6379:6379')) {
    errors.push('Validation database/cache ports must bind to loopback only.');
  }

  const deploymentWorkflow = requiredText('.github/workflows/deploy.yml');
  for (const token of [
    'npm run check:runtime',
    'npm run titech:critical-gates',
    'npm run check',
    'npm run release:gate:strict',
    'docker-compose.validation.yml',
    'npm run test:integration',
    'node scripts/production-approval-gate.mjs',
    'Production deployment cannot skip tests.',
  ]) {
    if (!deploymentWorkflow.includes(token)) errors.push(`Deployment workflow is missing release-safety requirement: ${token}`);
  }
  if (!deploymentWorkflow.includes("if: ${{ needs.deployment-policy.outputs.production_deployment == 'true' }}")) {
    errors.push('Production deployments must require the strict release gate.');
  }
  if (!deploymentWorkflow.includes("if: ${{ env.SKIP_TESTS != 'true' }}")) {
    errors.push('Deployment test steps must execute unless the policy-approved non-production bypass applies.');
  }
  if (!fs.existsSync(abs('scripts/production-approval-gate.mjs'))) errors.push('Protected production approval gate is missing.');
  return { status: errors.length ? 'BLOCKED' : 'PASS', errors, contract: contract ?? null };
}

export function summarizeReleaseStatus(contract) {
  const gates = contract?.gates ?? [];
  const open = gates.filter((gate) => gate.blocking && gate.status !== 'VERIFIED').map((gate) => gate.id);
  return {
    releaseStatus: open.length ? 'BLOCKED' : 'EVIDENCE_REVIEW_REQUIRED',
    productionApproved: false,
    openBlockingGates: open,
    note: 'This contract report never grants production approval. Evidence must be independently reviewed and the protected production-approval gate must pass.',
  };
}

function main() {
  const strict = process.argv.includes('--strict');
  const writeReport = process.argv.includes('--write-report');
  const result = validateCriticalGateContract();
  if (result.status === 'PASS') console.log('TITech critical-gate contract: PASS');
  else console.error('TITech critical-gate contract: BLOCKED');
  for (const error of result.errors) console.error(`BLOCKER: ${error}`);
  const summary = summarizeReleaseStatus(result.contract);
  console.log(`Release status: ${summary.releaseStatus}`);
  console.log(`productionApproved: ${summary.productionApproved}`);
  console.log(`Open blocking gates: ${summary.openBlockingGates.length ? summary.openBlockingGates.join(', ') : 'none; protected approval still required'}`);

  if (writeReport) {
    const target = path.join(ROOT, 'reports/evidence/titech-critical-gates-latest.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify({ generatedAt: new Date().toISOString(), contractStatus: result.status, ...summary, contractErrors: result.errors }, null, 2)}\n`);
    console.log(`Wrote report: ${path.relative(ROOT, target).replaceAll(path.sep, '/')}`);
  }
  if (result.status !== 'PASS' || (strict && summary.openBlockingGates.length > 0)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
