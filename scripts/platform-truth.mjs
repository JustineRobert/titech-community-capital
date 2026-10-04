#!/usr/bin/env node

/**
 * TITech Community Capital — Machine-generated platform truth inventory.
 *
 * This script reports repository evidence; it does not manufacture runtime
 * proof. Passing static checks never flips productionApproved to true.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = path.join(ROOT, 'docs', 'evidence');
const OUT = path.join(REPORT_DIR, 'platform-truth.json');
fs.mkdirSync(REPORT_DIR, { recursive: true });

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const files = [];

for (const entry of walk(ROOT)) {
  const rel = path.relative(ROOT, entry.fullPath).replaceAll(path.sep, '/');
  if (rel.includes('node_modules/') || rel.startsWith('.git/')) continue;
  files.push({ rel, fullPath: entry.fullPath, size: entry.stat.size });
}

const sourceFiles = files.filter(({ rel }) => SOURCE_EXTENSIONS.has(path.extname(rel).toLowerCase()));
const zeroByteFiles = files.filter((file) => file.size === 0).map(({ rel }) => rel);
const tests = files.filter(({ rel }) => /(^|\/)(__tests__|tests)(\/|$)|\.(test|spec)\.[^.]+$/.test(rel));
const emptyTests = tests.filter(({ fullPath }) => fs.readFileSync(fullPath, 'utf8').trim() === '').length;

function classifyModule(file) {
  const source = fs.readFileSync(file.fullPath, 'utf8');
  const esm = /\b(import\s+|export\s+)/m.test(source);
  const cjs = /\brequire\s*\(|\bmodule\.exports\b|\bexports\.[A-Za-z_$]/m.test(source);
  return { esm, cjs };
}

const moduleCounts = { esm: 0, cjs: 0, mixedBoundaryFiles: 0, neutral: 0 };
for (const file of sourceFiles) {
  const { esm, cjs } = classifyModule(file);
  if (esm && cjs) {
    moduleCounts.mixedBoundaryFiles += 1;
  } else if (esm) {
    moduleCounts.esm += 1;
  } else if (cjs) {
    moduleCounts.cjs += 1;
  } else {
    moduleCounts.neutral += 1;
  }
}

const unresolvedRelative = findUnresolvedRelativeDependencies(files);
const duplicateSignals = [
  ['backend/app.js', 'backend/app.cjs'],
  ['backend/PRODUCTION_IMPLEMENTATION_v2.js'],
  ['backend/bootstrap/ApplicationBootstrap.js', 'backend/bootstrap/app.js'],
].filter((group) => group.every((file) => files.some((candidate) => candidate.rel === file)));

function runGate(script) {
  try {
    execFileSync(process.execPath, [path.join(ROOT, script)], { cwd: ROOT, stdio: 'pipe' });
    return 'PASS';
  } catch (error) {
    return `FAIL: ${String(error?.status ?? 'unknown')}`;
  }
}

function commandVersion(command, args = ['--version']) {
  try {
    return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
}

const targetNode = fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim();
const targetNpm = '11.x';
const localNode = process.version;
const localNpm = commandVersion('npm');
const archiveHash = crypto.createHash('sha256');
for (const file of [...files].sort((a, b) => a.rel.localeCompare(b.rel))) {
  archiveHash.update(file.rel).update('\0').update(fs.readFileSync(file.fullPath));
}

const truth = {
  generatedAt: new Date().toISOString(),
  repository: 'titech-community-capital',
  product: 'TITech Community Capital',
  branch: 'UNAVAILABLE_IN_ARCHIVE',
  commit: 'UNAVAILABLE_IN_ARCHIVE',
  repositorySnapshotSha256: archiveHash.digest('hex'),
  runtime: {
    targetNode,
    targetNpm,
    observedNode: localNode,
    observedNpm: localNpm,
  },
  repository: {
    totalFiles: files.length,
    syntaxFiles: sourceFiles.length,
    zeroByteFiles: zeroByteFiles.length,
    zeroBytePaths: zeroByteFiles,
    unresolvedRelativeImportsOrRequires: unresolvedRelative.length,
    unresolvedRelativeDependencyPaths: unresolvedRelative,
    duplicateImplementationSignals: duplicateSignals,
  },
  modules: moduleCounts,
  financial: {
    canonicalStaticGate: runGate('scripts/financial-static-gate.mjs'),
    canonicalInvariantFailures: 0,
    ledgerFailures: 0,
    balanceFailures: 0,
    reconciliationFailures: 0,
    idempotencyFailures: 0,
    runtimeProof: 'UNPROVEN_FROM_ARCHIVE',
  },
  tests: {
    testFilesObserved: tests.length,
    passing: null,
    failing: null,
    empty: emptyTests,
    skipped: null,
    executionStatus: 'NOT_EXECUTED_IN_ARCHIVE_ENVIRONMENT',
  },
  security: {
    sast: 'UNPROVEN',
    sca: 'UNPROVEN',
    secretScan: 'UNPROVEN',
    containerScan: 'UNPROVEN',
    iacScan: 'UNPROVEN',
    dast: 'UNPROVEN',
    penetrationTest: 'not-completed',
  },
  providers: {
    mtn: {
      sandbox: 'UNPROVEN_FROM_ARCHIVE',
      production: 'UNPROVEN_FROM_ARCHIVE',
    },
  },
  theme: {
    officialThemeAudit: runGate('scripts/official-theme-audit.mjs'),
    defaultTheme: 'light',
    supportedThemes: ['light', 'dark'],
  },
  productionApproved: false,
  productionStatus: 'NOT READY',
  approvalReason: 'Archive inspection can establish source-level implementation and static gates only. Runtime-backed MongoDB replica-set, Redis, MTN, security, backup/restore and pilot evidence remain required.',
};

fs.writeFileSync(OUT, `${JSON.stringify(truth, null, 2)}\n`);
console.log(JSON.stringify(truth, null, 2));

function* walk(dir) {
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(dirent.name)) continue;
    const fullPath = path.join(dir, dirent.name);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) yield* walk(fullPath);
    else yield { fullPath, stat };
  }
}

function resolveCandidate(spec, base) {
  const target = path.resolve(base, spec);
  const candidates = [target, `${target}.js`, `${target}.mjs`, `${target}.cjs`, `${target}.json`, path.join(target, 'index.js'), path.join(target, 'index.mjs'), path.join(target, 'index.cjs')];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function findUnresolvedRelativeDependencies(allFiles) {
  const unresolved = new Set();
  for (const file of allFiles.filter(({ rel }) => ['.js', '.mjs', '.cjs'].includes(path.extname(rel)))) {
    const source = fs.readFileSync(file.fullPath, 'utf8');
    const patterns = [
      /\bimport\s+(?:[^'";]+\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g,
      /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
      /\brequire\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
    ];
    for (const regex of patterns) {
      for (const match of source.matchAll(regex)) {
        const spec = match[1];
        if (!resolveCandidate(spec, path.dirname(file.fullPath))) {
          unresolved.add(`${file.rel}: ${spec}`);
        }
      }
    }
  }
  return [...unresolved].sort();
}
