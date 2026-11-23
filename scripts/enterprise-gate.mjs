#!/usr/bin/env node

/**
 * TITech Community Capital Enterprise Gate
 *
 * This script is intentionally dependency-light and deterministic. It validates
 * repository structure, syntax, canonical deployment layout, conflict markers,
 * repository identity and selected security invariants. It never claims live
 * provider, cluster, backup/restore or regulatory evidence that it cannot test.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSourceFile } from './lib/syntax-parser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const mode = [...args].find((a) => a.startsWith('--')) || '--all';

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.vite',
  '.vitest',
  '.nyc_output',
]);

const EXECUTABLE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
]);

const errors = [];
const warnings = [];

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function exists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function walk(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, output);
    else output.push(absolute);
  }
  return output;
}

function validateRuntime() {
  const nvmrc = read('.nvmrc').trim();
  if (nvmrc !== '24.15.0') {
    fail(`.nvmrc must pin Node 24.15.0; found ${nvmrc}`);
  }

  const node = process.versions.node.split('.').map(Number);
  if (node[0] !== 24 || node[1] < 15) {
    warn(`Local runtime is Node ${process.versions.node}; repository gate targets Node 24.15.x.`);
  }
}

function validateRepositoryIdentity() {
  const pkg = JSON.parse(read('package.json'));
  const expected = 'https://github.com/JustineRobert/titech-community-capital.git';
  if (pkg.repository?.url !== `git+${expected}`) {
    fail(`package.json repository must be ${expected}`);
  }
  if (!String(pkg.homepage || '').includes('JustineRobert/titech-community-capital')) {
    fail('package.json homepage must point to the TITech Community Capital repository.');
  }
}

function validateStructure() {
  const required = [
    'backend/package.json',
    'backend/package-lock.json',
    'frontend/package.json',
    'frontend/package-lock.json',
    'backend/Dockerfile',
    'frontend/Dockerfile',
    'infrastructure/kubernetes/charts/backend/Chart.yaml',
    'infrastructure/kubernetes/charts/backend/values.yaml',
    'infrastructure/kubernetes/charts/backend/templates/deployment.yaml',
    'infrastructure/kubernetes/charts/backend/templates/service.yaml',
    'infrastructure/kubernetes/charts/frontend/Chart.yaml',
    'infrastructure/kubernetes/charts/frontend/values.yaml',
    'infrastructure/kubernetes/charts/frontend/templates/deployment.yaml',
    'infrastructure/kubernetes/charts/frontend/templates/service.yaml',
    'TITECH_PLATFORM_TRUTH.md',
    'TITECH_IMPLEMENTATION_INVENTORY.md',
    'CHANGESET_TRACEABILITY.md',
  ];
  for (const file of required) {
    if (!exists(file)) fail(`Missing canonical repository artifact: ${file}`);
  }

  if (!exists('package-lock.json')) {
    fail('Root package-lock.json is missing; root npm ci is not deterministic until it is committed.');
  }

  for (const file of ['backend/Dockerfile', 'frontend/Dockerfile']) {
    if (exists(file) && fs.statSync(path.join(ROOT, file)).size === 0) {
      fail(`Canonical Dockerfile is empty: ${file}`);
    }
  }

  const staleDeployRefs = walk(path.join(ROOT, '.github', 'workflows'))
    .filter((f) => /\.(yml|yaml)$/.test(f))
    .map((f) => ({ file: rel(f), text: fs.readFileSync(f, 'utf8') }))
    .filter(({ text }) => /\bdeployment\/charts\b/.test(text));

  for (const hit of staleDeployRefs) {
    fail(`Non-canonical deployment chart path remains in ${hit.file}.`);
  }
}

function validateConflicts() {
  const files = walk(ROOT);
  for (const file of files) {
    if (!EXECUTABLE_EXTENSIONS.has(path.extname(file)) && !/\.(md|json|ya?ml|sh|bat)$/.test(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let state = null;
    for (const line of lines) {
      if (/^<<<<<<<(?: |$)/.test(line)) {
        if (state) fail(`Nested Git conflict marker found in ${rel(file)}.`);
        state = 'OURS';
        continue;
      }
      if (state === 'OURS' && /^=======$/.test(line)) {
        state = 'THEIRS';
        continue;
      }
      if (state === 'THEIRS' && /^>>>>>>>/.test(line)) {
        state = null;
      }
    }
    if (state) fail(`Unclosed Git conflict block found in ${rel(file)}.`);
  }

  const critical = [
    'backend/models/FinancialTransaction.js',
    'backend/models/LedgerEntry.js',
    'backend/services/financial/financialOperation.service.js',
    'backend/services/financial/financialTransaction.service.js',
    'backend/services/financial/financialRepositoryRegistry.js',
    'backend/repositories/financial/balance.repository.js',
    'backend/repositories/financial/financialTransaction.repository.js',
    'backend/repositories/financial/ledger.repository.js',
    'backend/repositories/financial/loan.repository.js',
    'backend/controllers/financial/financial.controller.js',
    'backend/controllers/repaymentsController.js',
    'backend/controllers/momoWebhookController.js',
  ];

  for (const file of critical) {
    if (!exists(file)) fail(`Critical canonical financial file is missing: ${file}`);
    else if (fs.statSync(path.join(ROOT, file)).size === 0) fail(`Critical canonical financial file is empty: ${file}`);
  }
}

function validateSyntax() {
  let typescript;
  try {
    const backendRequire = createRequire(path.join(ROOT, 'backend', 'package.json'));
    typescript = backendRequire('typescript');
  } catch (error) {
    fail(
      `TypeScript parser is unavailable; syntax validation cannot skip TS/JSX files. ` +
      `Run the supported clean installation (npm run install:all). Cause: ${error.message}`,
    );
    return;
  }

  if (typeof typescript?.createSourceFile !== 'function') {
    fail('The resolved TypeScript package does not expose the required compiler parser API (createSourceFile).');
    return;
  }

  const files = walk(ROOT).filter((file) => EXECUTABLE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const syntaxErrors = [];

  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch (error) {
      syntaxErrors.push(`${rel(file)}: unable to read source file: ${error.message}`);
      continue;
    }

    try {
      const sourceFile = parseSourceFile(typescript, file, source);
      for (const diagnostic of sourceFile.parseDiagnostics || []) {
        const start = diagnostic.start ?? 0;
        const location = sourceFile.getLineAndCharacterOfPosition(start);
        syntaxErrors.push(
          `${rel(file)}:${location.line + 1}:${location.character + 1} ` +
          typescript.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
        );
      }
    } catch (error) {
      syntaxErrors.push(`${rel(file)}: parser failed: ${error.message}`);
    }
  }

  if (syntaxErrors.length) {
    fail(`${syntaxErrors.length} syntax/read/parser diagnostic(s) found:\n${syntaxErrors.slice(0, 100).join('\n')}`);
  } else {
    console.log(`Syntax gate: PASS (${files.length} executable JS/TS-family files parsed).`);
  }
}

function validateDocumentationTruth() {
  const staleTerms = [];
  for (const file of walk(ROOT).filter((f) => /\.md$/i.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    if (/\bAFRICAN COMMUNITY FINANCE OPERATING SYSTEM\b|\bACFOS\b/i.test(text) && rel(file) !== 'TITECH_PLATFORM_TRUTH.md') {
      staleTerms.push(rel(file));
    }
  }
  if (staleTerms.length) {
    warn(`Legacy ACFOS terminology remains in ${staleTerms.length} documentation file(s); classify or migrate it before external release.`);
  }
}

function validateSecurityInvariants() {
  const frontend = walk(path.join(ROOT, 'frontend', 'src'));
  for (const file of frontend.filter((f) => /\.(js|jsx|mjs|cjs|ts|tsx)$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    if (/localStorage\.(setItem|getItem)\s*\(\s*['\"](?:accessToken|token|jwt)/i.test(text)) {
      fail(`Potential access-token persistence in localStorage: ${rel(file)}.`);
    }
    if (/sessionStorage\.(setItem|getItem)\s*\(\s*['\"](?:accessToken|token|jwt)/i.test(text)) {
      fail(`Potential access-token persistence in sessionStorage: ${rel(file)}.`);
    }
  }

  const productionDirs = ['backend/controllers', 'backend/routes', 'backend/middleware', 'backend/services'];
  for (const dir of productionDirs) {
    if (!exists(dir)) continue;
    for (const file of walk(path.join(ROOT, dir)).filter((f) => /\.(js|mjs|cjs)$/.test(f))) {
      const text = fs.readFileSync(file, 'utf8');
      if (/req\.body\.tenantId|req\.query\.tenantId|req\.params\.tenantId/.test(text) && /tenantId\s*[:=]\s*req\.(body|query|params)\.tenantId/.test(text)) {
        warn(`Review raw client tenantId usage in ${rel(file)}; authoritative tenant context must come from authenticated/authorized context.`);
      }
    }
  }
}

function runNodeChecks() {
  if (mode !== '--all' && mode !== '--structure') return;
  const requiredPaths = ['backend/package.json', 'frontend/package.json'];
  for (const file of requiredPaths) {
    try {
      JSON.parse(read(file));
    } catch (error) {
      fail(`${file} is not valid JSON: ${error.message}`);
    }
  }
}

function main() {
  if (args.has('--syntax') || args.has('--all')) {
    validateRuntime();
    validateRepositoryIdentity();
    validateSyntax();
  }
  if (args.has('--structure') || args.has('--all')) {
    validateStructure();
    runNodeChecks();
  }
  if (args.has('--security') || args.has('--all')) {
    validateConflicts();
    validateSecurityInvariants();
    validateDocumentationTruth();
  }

  if (warnings.length) {
    console.log('\nWarnings:');
    for (const item of warnings) console.log(`- ${item}`);
  }

  if (errors.length) {
    console.error('\nEnterprise gate: FAIL');
    for (const item of errors) console.error(`- ${item}`);
    process.exitCode = 1;
    return;
  }

  console.log('\nEnterprise gate: PASS');
}

main();
