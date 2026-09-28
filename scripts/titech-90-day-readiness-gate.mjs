import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assessMtnProductionConfiguration } from '../backend/modules/payment/mtn/mtnProductionReadiness.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reports = path.join(root, 'reports');
fs.mkdirSync(reports, { recursive: true });
const strict = process.argv.includes('--strict');
const failures = [];
const warnings = [];

function exists(rel) { return fs.existsSync(path.join(root, rel)); }
function zero(rel) { const p=path.join(root, rel); return exists(rel) && fs.statSync(p).size===0; }
function run(cmd,args=[]) { try { execFileSync(cmd,args,{cwd:root,stdio:'pipe',encoding:'utf8'}); return true; } catch { return false; } }

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 24) warnings.push(`Local runtime ${process.versions.node} is below the repository target Node 24.15+.`);
if (!exists('.nvmrc') || fs.readFileSync(path.join(root,'.nvmrc'),'utf8').trim() !== '24.15.0') failures.push('Node runtime contract is not pinned to 24.15.0.');

const criticalZeroByte = [
  'backend/audit/audit.service.js',
  'backend/audit/audit.model.js',
  'backend/integrations/mtn/momo.service.js',
  'backend/integrations/mtn/momo.controller.js',
  'backend/integrations/mtn/momo.routes.js',
  'backend/integrations/mtn/momo.validator.js',
  'backend/integrations/mtn/momo.webhook.js',
];
for (const rel of criticalZeroByte) if (zero(rel)) failures.push(`Critical compatibility boundary remains zero-byte: ${rel}`);

const mtn = assessMtnProductionConfiguration(process.env);
if (mtn.blockers.length) warnings.push(`MTN MoMo external configuration is pending: ${mtn.blockers.map((b)=>b.code).join(', ')}`);

for (const rel of [
  'docs/90-DAY_IMPLEMENTATION_MASTER_2026-09-28.md',
  'docs/PRODUCTION_READINESS_SCORECARD_2026-09-28.md',
  'docs/pilot/PILOT_DEPLOYMENT_PACKAGE_2026-09-28.md',
  'docs/compliance/COMPLIANCE_REVIEW_PACK_2026-09-28.md',
  'docs/investor/DATA_ROOM_INDEX_2026-09-28.md',
  'branding/BRAND_MANIFEST.json',
]) if (!exists(rel)) failures.push(`Required implementation/evidence artifact missing: ${rel}`);

const staticGates = [
  ['conflict gate', 'node', ['scripts/check-conflicts.js']],
  ['financial gate', 'node', ['scripts/financial-static-gate.mjs']],
  ['enterprise contracts', 'node', ['scripts/enterprise-contract-contracts.mjs']],
];
const gateResults = {};
for (const [name,cmd,args] of staticGates) gateResults[name] = run(cmd,args);
for (const [name,ok] of Object.entries(gateResults)) if (!ok) failures.push(`${name} failed.`);

const scorecard = {
  generatedAt: new Date().toISOString(),
  repository: 'titech-community-capital',
  targetRuntime: 'Node.js 24.15.0 / npm 11.x',
  strict,
  baselineGates: gateResults,
  mtn,
  failures,
  warnings,
  productionApproved: false,
  approvalReason: 'External provider certification, live transaction evidence, security validation, legal/regulatory review, pilot sign-off, and runtime-backed operational evidence are not asserted by source inspection.',
};
fs.writeFileSync(path.join(reports,'titech-90-day-readiness.json'), JSON.stringify(scorecard,null,2));
console.log(JSON.stringify(scorecard,null,2));
if (strict && failures.length) process.exitCode = 1;
