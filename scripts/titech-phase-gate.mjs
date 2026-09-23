#!/usr/bin/env node
/**
 * TITech Community Capital — P0/P1/P2 evidence gate.
 *
 * Architectural role:
 *   Release-control layer. It checks that implementation artifacts and external
 *   evidence exist before a phase can be declared complete.
 *
 * Non-responsibility boundaries:
 *   - Does not manufacture certification evidence.
 *   - Does not replace provider tests, security assessments, DR drills or pilot sign-off.
 *   - Does not alter application runtime behavior.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const phase = process.argv.find((arg) => arg.startsWith('--phase='))?.split('=')[1] ?? 'p0';
const strict = process.argv.includes('--strict');

const required = {
  p0: [
    'docs/finance/GOLDEN_MONEY_PATH.md',
    'docs/evidence/provider/PROVIDER_CERTIFICATION_TEMPLATE.md',
    'docs/evidence/security/SECURITY_ASSESSMENT_TEMPLATE.md',
    'docs/evidence/operations/OPERATIONAL_DRILL_TEMPLATE.md',
    'docs/evidence/pilot/PILOT_ACCEPTANCE_TEMPLATE.md',
    'scripts/release-readiness-gate.mjs',
  ],
  p1: [
    'docs/evidence/capital/CAPITAL_PARTNER_VALIDATION_TEMPLATE.md',
  ],
  p2: [
    'docs/program/TITECH_P0_P2_EXECUTION_MASTER_PLAN.md',
  ],
};

const missing = (required[phase] ?? []).filter((file) => !fs.existsSync(path.join(ROOT, file)));
const blockers = [];
const warnings = [];

if (!required[phase]) blockers.push(`Unknown phase: ${phase}`);
if (missing.length) blockers.push(`Missing required implementation artifacts: ${missing.join(', ')}`);

// External certification is intentionally represented as an explicit evidence requirement.
// Templates are not accepted as completed evidence.
const evidenceChecks = {
  p0: [
    ['provider-certification', 'docs/evidence/provider', ['PASS', 'SIGNED']],
    ['security-assessment', 'docs/evidence/security', ['PASS', 'SIGNED']],
    ['operational-drill', 'docs/evidence/operations', ['PASS', 'SIGNED']],
    ['pilot-acceptance', 'docs/evidence/pilot', ['PASS', 'SIGNED']],
  ],
  p1: [['capital-validation', 'docs/evidence/capital', ['PASS', 'SIGNED']]],
  p2: [],
};

for (const [id, directory, tokens] of evidenceChecks[phase] ?? []) {
  const files = fs.existsSync(path.join(ROOT, directory))
    ? fs.readdirSync(path.join(ROOT, directory)).filter((name) => name !== 'README.md')
    : [];
  if (!files.length) {
    blockers.push(`${id}: no evidence record exists.`);
    continue;
  }
  const contents = files.map((name) => fs.readFileSync(path.join(ROOT, directory, name), 'utf8')).join('\n');
  if (contents.includes('NOT_EXECUTED') || contents.includes('TBD')) {
    warnings.push(`${id}: available records still contain NOT_EXECUTED/TBD markers.`);
  }
  if (!tokens.some((token) => contents.includes(token))) {
    blockers.push(`${id}: no explicit PASS/SIGNED evidence marker found.`);
  }
}

const status = blockers.length ? 'BLOCKED' : (warnings.length ? 'CONDITIONAL' : 'PASS');
const report = {
  generatedAt: new Date().toISOString(),
  phase,
  mode: strict ? 'strict' : 'audit',
  status,
  blockers,
  warnings,
  repository: 'https://github.com/JustineRobert/titech-community-capital',
};

fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, `reports/titech-${phase}-phase-gate.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(`TITech ${phase.toUpperCase()} phase gate: ${status}`);
for (const item of blockers) console.log(`BLOCKER: ${item}`);
for (const item of warnings) console.log(`WARNING: ${item}`);
if (strict && blockers.length) process.exitCode = 1;
