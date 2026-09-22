#!/usr/bin/env node

/**
 * TITech Community Capital — deterministic repository truth inventory.
 *
 * This report intentionally distinguishes executable evidence from documentation
 * assertions. It does not declare production approval.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATE = new Date().toISOString().slice(0, 10);
const EXCLUDED = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.vite', '.vitest', '.nyc_output']);
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);

function walk(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, result);
    else result.push(absolute);
  }
  return result;
}

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

const files = walk(ROOT);
const sourceFiles = files.filter((f) => SOURCE_EXTENSIONS.has(path.extname(f)));
const zeroByteFiles = files.filter((f) => fs.statSync(f).size === 0).map(rel).sort();

const conflicts = [];
for (const file of files) {
  const text = (() => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } })();
  const lines = text.split(/\r?\n/);
  let state = null;
  for (const line of lines) {
    if (/^<<<<<<<(?: |$)/.test(line)) state = state ? 'NESTED' : 'OURS';
    else if (state === 'OURS' && /^=======$/.test(line)) state = 'THEIRS';
    else if (state === 'THEIRS' && /^>>>>>>>/.test(line)) state = null;
  }
  if (state) conflicts.push(rel(file));
}

const staleProductionDocs = files
  .filter((f) => /\.md$/i.test(f) && rel(f) !== 'TITECH_PLATFORM_TRUTH.md')
  .filter((f) => /\bPRODUCTION[- ]READY\b|\bPRODUCTION READY\b|\bPRODUCTION-APPROVED\b|\bPRODUCTION APPROVED\b/i.test(fs.readFileSync(f, 'utf8')))
  .map(rel)
  .sort();

const legacyAcfosDocs = files
  .filter((f) => /\.md$/i.test(f) && rel(f) !== 'TITECH_PLATFORM_TRUTH.md')
  .filter((f) => rel(f) !== 'docs/REPOSITORY_TRUTH_INVENTORY_2026-09-21.md')
  .filter((f) => /\bACFOS\b|AFRICAN COMMUNITY FINANCE OPERATING SYSTEM/i.test(fs.readFileSync(f, 'utf8')))
  .map(rel)
  .sort();

const directFinancialMutations = [];
const financialBoundaryDirs = ['backend/controllers', 'backend/routes', 'backend/middleware'];
for (const dir of financialBoundaryDirs) {
  const absoluteDir = path.join(ROOT, dir);
  if (!fs.existsSync(absoluteDir)) continue;
  for (const file of walk(absoluteDir).filter((f) => ['.js', '.mjs', '.cjs'].includes(path.extname(f)))) {
    const source = fs.readFileSync(file, 'utf8');
    if (/LedgerEntry\.(create|insertMany|findOneAndUpdate|updateOne|deleteOne)|FinancialLedgerEntry\.(create|insertMany|findOneAndUpdate|updateOne|deleteOne)|Account\.(findOneAndUpdate|updateOne|updateMany)|FinancialTransaction\.(create|findOneAndUpdate|updateOne)/.test(source)) {
      directFinancialMutations.push(rel(file));
    }
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

let runtimeImportAudit = null;
const auditPath = path.join(ROOT, 'reports', 'runtime-import-audit.json');
if (fs.existsSync(auditPath)) {
  try { runtimeImportAudit = JSON.parse(fs.readFileSync(auditPath, 'utf8')); } catch { runtimeImportAudit = null; }
}

const requiredPromptArtifacts = [
  'TITECH_PLATFORM_TRUTH.md',
  'TITECH_IMPLEMENTATION_INVENTORY.md',
  'TITECH_DOCUMENTATION_STATUS.md',
  'FINANCIAL_ARCHITECTURE.md',
  'LEDGER.md',
  'PAYMENTS.md',
  'RECONCILIATION.md',
  'OFFLINE_SYNC.md',
  'TENANCY.md',
  'SECURITY.md',
  'TESTING.md',
  'OPERATIONS.md',
  'DISASTER_RECOVERY.md',
  'COMPLIANCE.md',
  'DEPLOYMENT.md',
  'API.md',
  'backend/models/FinancialTransaction.js',
  'backend/models/FinancialLedgerEntry.js',
  'backend/services/financial/financialTransaction.service.js',
  'backend/services/financial/financialOperation.service.js',
  'backend/services/financial/financialRepositoryRegistry.js',
  'backend/repositories/financial/financialTransaction.repository.js',
  'backend/repositories/financial/ledger.repository.js',
  'backend/repositories/financial/balance.repository.js',
  'backend/repositories/financial/loan.repository.js',
  'backend/controllers/financial/financial.controller.js',
  'backend/controllers/repaymentsController.js',
  'backend/controllers/momoWebhookController.js',
  'scripts/enterprise-completeness-gate.mjs',
  'scripts/enterprise-gate.mjs',
  'RC-CERTIFICATION.md',
];

const missingPromptArtifacts = requiredPromptArtifacts.filter((file) => !fs.existsSync(path.join(ROOT, file)));

const hash = crypto.createHash('sha256');
for (const file of files.sort()) {
  hash.update(rel(file));
  hash.update('\0');
  hash.update(fs.readFileSync(file));
  hash.update('\0');
}

const inventory = {
  generatedAt: `${DATE}T00:00:00Z`,
  repository: 'https://github.com/JustineRobert/titech-community-capital',
  sourceOfTruth: 'uploaded archive titech-community-capital-main(9).zip',
  liveRepositoryVerification: 'NOT VERIFIED — GitHub network access was unavailable in this execution environment',
  gitMetadataPresent: fs.existsSync(path.join(ROOT, '.git')),
  runtime: {
    localNode: process.versions.node,
    repositoryNode: read('.nvmrc').trim(),
    localMatchesRepositoryTarget: process.versions.node.startsWith('24.') && Number(process.versions.node.split('.')[1]) >= 15,
  },
  counts: {
    totalFiles: files.length,
    sourceFiles: sourceFiles.length,
    zeroByteFiles: zeroByteFiles.length,
    actualConflictFiles: conflicts.length,
    staleProductionDocs: staleProductionDocs.length,
    legacyAfcOSDocs: legacyAcfosDocs.length,
    directFinancialMutationBoundaries: directFinancialMutations.length,
  },
  zeroByteFiles,
  actualConflictFiles: conflicts,
  staleProductionDocs,
  legacyAfcOSDocs: legacyAcfosDocs,
  directFinancialMutationBoundaries: directFinancialMutations,
  runtimeImportAudit,
  missingPromptArtifacts,
  repositoryDigest: hash.digest('hex'),
};

fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports', `repository-truth-inventory-${DATE}.json`), `${JSON.stringify(inventory, null, 2)}\n`);

const md = `# TITech Community Capital — Repository Truth Inventory (${DATE})\n\n> Source of truth: uploaded \`titech-community-capital-main(7).zip\`. Live GitHub verification was not available in this execution environment.\n\n## Executive evidence\n\n| Measure | Result | Interpretation |\n|---|---:|---|\n| Total repository files | ${inventory.counts.totalFiles} | Inventory scope excluding build/dependency output directories |\n| Source files | ${inventory.counts.sourceFiles} | JS/MJS/CJS/JSX/TS/TSX |\n| Zero-byte files | ${inventory.counts.zeroByteFiles} | Requires classification; not automatically safe to delete/restore |\n| Actual Git conflict files | ${inventory.counts.actualConflictFiles} | Stateful marker scan |\n| Stale production-readiness docs | ${inventory.counts.staleProductionDocs} | Must be treated as historical/superseded by platform truth |\n| Legacy terminology docs | ${inventory.counts.legacyAfcOSDocs} | Requires vocabulary cleanup where externally visible |\n| Direct financial mutation boundaries | ${inventory.counts.directFinancialMutationBoundaries} | Review hits; canonical controllers must remain thin |\n\n## Runtime evidence\n\n- Local Node: \`${inventory.runtime.localNode}\`.\n- Repository target: \`${inventory.runtime.repositoryNode}\`.\n- Full Node-version compatibility: **NOT VERIFIED** in this environment.\n- Git metadata in archive: **${inventory.gitMetadataPresent ? 'present' : 'absent'}**.\n\n## Canonical financial import evidence\n\n${runtimeImportAudit ? `- Backend source scan: **${runtimeImportAudit.summary?.filesScanned ?? 'recorded in report'}**.\n- Missing local imports: **${runtimeImportAudit.summary?.missingImports ?? 'recorded in report'}**.\n- Canonical financial surface missing imports: **${runtimeImportAudit.summary?.canonicalFinancialMissingImports ?? 0}**.\n` : '- Existing runtime-import audit report was not parseable at generation time.'}\n\n## Production truth\n\nThe authoritative production status remains controlled by \`TITECH_PLATFORM_TRUTH.md\`. The implementation package is **not automatically production-approved** by the existence of this inventory.\n\n## Required evidence still outside this static inventory\n\nDependency installation on Node 24.15.x, complete Jest/Vitest suites, live MongoDB/Redis runtime, provider sandbox/pilot verification, security scanning, container scanning, backup/restore, disaster-recovery exercise, load testing, deployment/rollback testing and jurisdictional/legal/regulatory approvals require their respective environments and evidence artifacts.\n\n## Repository digest\n\n\`${inventory.repositoryDigest}\`\n`;
fs.writeFileSync(path.join(ROOT, 'docs', `REPOSITORY_TRUTH_INVENTORY_${DATE}.md`), md);
console.log(`Repository truth inventory written for ${inventory.counts.totalFiles} files.`);
