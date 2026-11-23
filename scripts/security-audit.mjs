#!/usr/bin/env node
/** Run independent full and production-only npm audits for root/backend/frontend. */
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditBlocksRelease, summarizeAudit } from './lib/security-audit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.resolve(ROOT, 'docs/evidence/2026-11-23-enterprise-e2e-remediation/reexecution-2026-11-23-1624-UGT/security-audit-summary.json');
const PACKAGES = [
  { name: 'root', cwd: ROOT },
  { name: 'backend', cwd: path.join(ROOT, 'backend') },
  { name: 'frontend', cwd: path.join(ROOT, 'frontend') },
];

function npmCommand(args, cwd) {
  if (process.env.npm_execpath) {
    return spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, encoding: 'utf8', timeout: Number(process.env.TITECH_AUDIT_TIMEOUT_MS || 15_000), maxBuffer: 16 * 1024 * 1024 });
  }
  if (process.platform === 'win32') {
    return spawnSync('npm.cmd', args, { cwd, encoding: 'utf8', timeout: Number(process.env.TITECH_AUDIT_TIMEOUT_MS || 15_000), maxBuffer: 16 * 1024 * 1024, shell: true });
  }
  return spawnSync('npm', args, { cwd, encoding: 'utf8', timeout: Number(process.env.TITECH_AUDIT_TIMEOUT_MS || 15_000), maxBuffer: 16 * 1024 * 1024 });
}

async function main() {
  const results = {};
  let blocked = false;

  for (const pkg of PACKAGES) {
    results[pkg.name] = {};
    for (const [label, args] of [
      ['allDependencies', ['audit', '--json']],
      ['productionDependencies', ['audit', '--omit=dev', '--json']],
    ]) {
      const outcome = npmCommand(args, pkg.cwd);
      const summary = summarizeAudit(outcome.stdout, outcome.stderr, outcome.status, outcome.error);
      results[pkg.name][label] = summary;
      console.log(`${pkg.name} ${label}: ${summary.execution}${summary.counts ? ` (critical=${summary.counts.critical}, high=${summary.counts.high}, moderate=${summary.counts.moderate}, low=${summary.counts.low})` : ''}`);
      if (auditBlocksRelease(summary, { productionDependencies: label === 'productionDependencies' })) blocked = true;
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    policy: 'Production dependency tree must contain zero known critical and high vulnerabilities. Full dependency findings remain reported and are not silently suppressed.',
    status: blocked ? 'BLOCKED' : 'PASS',
    packages: results,
  };
  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Security audit summary: ${path.relative(ROOT, OUTPUT)} (${report.status})`);
  return blocked ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(`Security audit orchestration failed: ${error.message}`);
  process.exitCode = 1;
});
