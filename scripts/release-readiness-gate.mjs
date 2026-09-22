#!/usr/bin/env node
/**
 * TITech Community Capital — Enterprise Release Readiness Gate
 *
 * Architectural role
 *   Repository-level gate that distinguishes engineering completeness from
 *   production evidence. It is dependency-free so it can run before npm ci.
 *
 * Non-responsibility boundaries
 *   - Does not certify regulatory approval.
 *   - Does not prove live provider connectivity.
 *   - Does not prove MongoDB transaction/concurrency correctness.
 *   - Does not replace SAST/DAST/container/IaC scanners.
 *
 * Modes
 *   --audit   Report release blockers but exit 0 (default; suitable for CI
 *             visibility while the legacy surface is being consolidated).
 *   --strict  Exit 1 when any release blocker is detected.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const auditOnly = !strict;

const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'coverage',
  'dist',
  'build',
  '.vite',
  '.vitest',
  '.nyc_output',
  'tmp',
  'logs',
]);

const executableExtensions = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);

const blockers = [];
const warnings = [];
const checks = [];

const rel = (file) => path.relative(ROOT, file).replaceAll(path.sep, '/');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function addCheck(id, status, message, details = []) {
  checks.push({ id, status, message, details });
}

function walk(dir, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, output);
    else output.push(absolute);
  }
  return output;
}

function resolveLocalImport(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.js'),
    path.join(base, 'index.mjs'),
    path.join(base, 'index.cjs'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function checkRequiredArtifacts() {
  const required = [
    'package.json',
    'package-lock.json',
    '.nvmrc',
    'backend/package.json',
    'backend/package-lock.json',
    'frontend/package.json',
    'frontend/package-lock.json',
    'backend/Dockerfile',
    'frontend/Dockerfile',
    'infrastructure/kubernetes/charts/backend/Chart.yaml',
    'infrastructure/kubernetes/charts/frontend/Chart.yaml',
    'PRODUCT_POSITIONING.md',
    'TITECH_PLATFORM_TRUTH.md',
    'TITECH_IMPLEMENTATION_INVENTORY.md',
    'CHANGESET_TRACEABILITY.md',
  ];

  const missing = required.filter((item) => !exists(item));
  if (missing.length) {
    blockers.push(`Missing required release artifacts: ${missing.join(', ')}`);
    addCheck('required-artifacts', 'BLOCKED', 'Required canonical artifacts are missing.', missing);
  } else {
    addCheck('required-artifacts', 'PASS', 'Canonical release artifacts are present.');
  }
}

function checkRuntimePin() {
  const expected = read('.nvmrc').trim();
  if (expected !== '24.15.0') {
    blockers.push(`.nvmrc must pin Node 24.15.0; found ${expected || '(empty)'}.`);
    addCheck('runtime-pin', 'BLOCKED', 'Repository runtime pin is not the enterprise baseline.');
  } else {
    addCheck('runtime-pin', 'PASS', 'Node 24.15.0 is pinned.');
  }
}

function checkConflictMarkers() {
  const hits = [];
  for (const file of walk(ROOT)) {
    const extension = path.extname(file).toLowerCase();
    if (!executableExtensions.has(extension) && !/\.(md|json|ya?ml|sh|bat|conf)$/i.test(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let inConflict = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trimStart();
      if (/^<<<<<<<(?:\s|$)/.test(line)) {
        hits.push(`${rel(file)}:${index + 1}`);
        inConflict = true;
        continue;
      }
      if (inConflict && /^=======(?:\s|$)/.test(line)) continue;
      if (inConflict && /^>>>>>>>(?:\s|$)/.test(line)) inConflict = false;
    }
    if (inConflict) hits.push(`${rel(file)}:unclosed`);
  }

  if (hits.length) {
    blockers.push(`Git conflict markers detected (${hits.length}).`);
    addCheck('conflict-markers', 'BLOCKED', 'Merge conflict markers remain.', hits.slice(0, 50));
  } else {
    addCheck('conflict-markers', 'PASS', 'No Git conflict markers detected.');
  }
}

function checkCanonicalFinancialSurface() {
  const critical = [
    'backend/services/financial/financialTransaction.service.js',
    'backend/services/financial/financialOperation.service.js',
    'backend/repositories/financial/ledger.repository.js',
    'backend/models/FinancialLedgerEntry.js',
    'backend/services/idempotency/idempotency.service.js',
    'backend/services/idempotency/idempotency.store.js',
    'backend/controllers/financial/financial.controller.js',
    'backend/controllers/contributionsController.js',
    'backend/routes/financial.routes.js',
    'backend/middleware/idempotency.js',
    'backend/services/financial/money.js',
  ];

  const missing = critical.filter((file) => !exists(file));
  const empty = critical.filter((file) => exists(file) && fs.statSync(path.join(ROOT, file)).size === 0);
  const mixed = [];

  for (const file of critical) {
    if (!exists(file)) continue;
    const source = read(file);
    if (/\bmodule\.exports\s*=/.test(source) || /\brequire\s*\(/.test(source) || /createRequire\s*\(/.test(source)) {
      if (!file.endsWith('idempotency.store.js')) mixed.push(file);
    }
  }

  if (missing.length || empty.length || mixed.length) {
    blockers.push(`Canonical financial surface is incomplete: missing=${missing.length}, empty=${empty.length}, mixedModule=${mixed.length}.`);
    addCheck('financial-surface', 'BLOCKED', 'Canonical financial files must exist, be non-empty, and remain native ESM.', {
      missing, empty, mixed,
    });
  } else {
    addCheck('financial-surface', 'PASS', 'Canonical financial surface is structurally complete and ESM-only.');
  }
}

function checkFinancialStaticGate() {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/financial-static-gate.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    blockers.push('Financial static gate failed.');
    addCheck('financial-static-gate', 'BLOCKED', 'Canonical financial static invariants failed.', [result.stdout, result.stderr].filter(Boolean).join('\n'));
  } else {
    addCheck('financial-static-gate', 'PASS', 'Canonical financial static gate passed.');
  }
}

function checkRuntimeImports() {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/runtime-import-audit.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (!exists('reports/runtime-import-audit.json')) {
    blockers.push('Runtime import audit did not produce its report.');
    addCheck('runtime-imports', 'BLOCKED', 'Runtime import audit report is missing.');
    return;
  }

  let report;
  try {
    report = JSON.parse(read('reports/runtime-import-audit.json'));
  } catch (error) {
    blockers.push(`Runtime import audit report is invalid JSON: ${error.message}`);
    addCheck('runtime-imports', 'BLOCKED', 'Runtime import audit report could not be parsed.');
    return;
  }

  const missing = report.missingLocalImports?.length ?? 0;
  const criticalMissing = report.criticalMissing?.length ?? 0;
  const mixed = report.mixedCanonicalFinancialModules?.length ?? 0;

  if (criticalMissing || mixed) {
    blockers.push(`Canonical runtime import audit failed: criticalMissing=${criticalMissing}, mixed=${mixed}.`);
    addCheck('runtime-imports', 'BLOCKED', 'Canonical financial runtime imports are not clean.', {
      criticalMissing: report.criticalMissing ?? [],
      mixed: report.mixedCanonicalFinancialModules ?? [],
    });
    return;
  }

  if (missing > 0) {
    const message = `Repository-wide runtime import debt remains: ${missing} missing local imports.`;
    warnings.push(message);
    addCheck('runtime-imports', strict ? 'BLOCKED' : 'WARN', message, [
      'The canonical financial surface is clean.',
      'Strict release certification requires repository-wide missing local imports = 0.',
    ]);
    if (strict) blockers.push(message);
    return;
  }

  addCheck('runtime-imports', 'PASS', 'No missing local imports detected.');
}

function checkCredentialFiles() {
  const suspicious = [];
  for (const file of walk(ROOT)) {
    const relative = rel(file);
    const base = path.basename(file);
    if (/^(?:\.env|\.env\.[^.]*)$/i.test(base) && base !== '.env.example') {
      suspicious.push(relative);
      continue;
    }
    if (/\.(pem|key|p12|pfx|jks)$/i.test(base)) suspicious.push(relative);
  }

  if (suspicious.length) {
    blockers.push(`Potential credential/private-key files are present: ${suspicious.join(', ')}`);
    addCheck('credential-files', 'BLOCKED', 'Repository contains files that must be externalized from source control.', suspicious);
  } else {
    addCheck('credential-files', 'PASS', 'No committed .env/private-key artifacts detected in the archive.');
  }
}

function checkDocumentationPositioning() {
  const positioning = read('PRODUCT_POSITIONING.md');
  const requiredTerms = [
    'Community Financial Infrastructure Layer',
    'NOT a wallet',
    'NOT a generic SACCO ERP',
    'NOT a lender',
    'provider-neutral',
    'offline-first',
    'multi-tenant',
  ];
  const missing = requiredTerms.filter((term) => !positioning.toLowerCase().includes(term.toLowerCase()));

  if (missing.length) {
    blockers.push(`PRODUCT_POSITIONING.md is missing required boundary statements: ${missing.join(', ')}`);
    addCheck('product-positioning', 'BLOCKED', 'Product architecture/positioning boundary is incomplete.', missing);
  } else {
    addCheck('product-positioning', 'PASS', 'Product positioning captures the infrastructure-layer boundaries.');
  }

  const publicDocs = ['README.md', 'ARCHITECTURE.md', 'PRODUCT_POSITIONING.md', 'FINANCIAL_ARCHITECTURE.md'];
  const stale = [];
  for (const file of publicDocs) {
    if (!exists(file)) continue;
    if (/\bACFOS\b|AFRICAN COMMUNITY FINANCE OPERATING SYSTEM/i.test(read(file))) stale.push(file);
  }

  if (stale.length) {
    blockers.push(`Legacy ACFOS branding remains in public-facing documents: ${stale.join(', ')}`);
    addCheck('legacy-branding', 'BLOCKED', 'Public-facing product material must use TITech Community Capital terminology.', stale);
  } else {
    addCheck('legacy-branding', 'PASS', 'Public-facing positioning contains no legacy ACFOS branding.');
  }
}

function checkPackageMetadata() {
  const pkg = JSON.parse(read('package.json'));
  const requiredScripts = ['check', 'enterprise:gate', 'check:financial', 'check:runtime-imports', 'release:gate', 'release:gate:strict'];
  const missing = requiredScripts.filter((name) => !pkg.scripts?.[name]);
  if (missing.length) {
    blockers.push(`Root package scripts missing: ${missing.join(', ')}`);
    addCheck('package-scripts', 'BLOCKED', 'Required enterprise/release scripts are missing.', missing);
  } else {
    addCheck('package-scripts', 'PASS', 'Required enterprise/release scripts are registered.');
  }
}

function main() {
  checkRequiredArtifacts();
  checkRuntimePin();
  checkConflictMarkers();
  checkCanonicalFinancialSurface();
  checkFinancialStaticGate();
  checkRuntimeImports();
  checkCredentialFiles();
  checkDocumentationPositioning();
  checkPackageMetadata();

  const status = blockers.length ? (strict ? 'BLOCKED' : 'AUDIT_BLOCKED') : 'PASS';
  const payload = {
    generatedAt: new Date().toISOString(),
    mode: strict ? 'strict' : 'audit',
    status,
    blockers,
    warnings,
    checks,
    repository: 'https://github.com/JustineRobert/titech-community-capital',
  };

  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'reports/release-readiness.json'),
    JSON.stringify(payload, null, 2) + '\n',
  );

  console.log(`Enterprise release readiness: ${status}`);
  for (const check of checks) {
    console.log(`[${check.status}] ${check.id}: ${check.message}`);
  }

  if (warnings.length) {
    console.log('\nWarnings:');
    for (const warning of warnings) console.log(`- ${warning}`);
  }

  if (blockers.length) {
    console.log('\nRelease blockers:');
    for (const blocker of blockers) console.log(`- ${blocker}`);
  }

  if (strict && blockers.length) process.exitCode = 1;
}

main();
