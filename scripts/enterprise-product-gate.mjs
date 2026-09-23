#!/usr/bin/env node

/**
 * TITech Community Capital — End-to-End Enterprise Product Gate
 *
 * This is a dependency-light repository gate. It validates high-risk seams
 * that can be proven from source alone while explicitly leaving infrastructure
 * and regulatory evidence to their proper environments.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.vite', '.vitest']);

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else files.push(absolute);
  }
  return files;
}

function sourceFiles() {
  return walk(ROOT).filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)));
}

function resolveLocalImport(sourceFile, request) {
  if (!request.startsWith('.')) return null;

  const base = path.resolve(path.dirname(sourceFile), request);
  const candidates = [
    base,
    ...[...SOURCE_EXTENSIONS].map((ext) => `${base}${ext}`),
    path.join(base, 'index.js'),
    path.join(base, 'index.mjs'),
    path.join(base, 'index.cjs'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function importedEmptyFiles() {
  const empty = new Set(
    walk(ROOT).filter((file) => fs.statSync(file).isFile() && fs.statSync(file).size === 0),
  );
  const findings = [];
  const pattern = /(?:from\s*|import\s*\(|require\s*\()(['"])(\.{1,2}\/[^'"]+)\1/g;

  for (const sourceFile of sourceFiles()) {
    const source = fs.readFileSync(sourceFile, 'utf8');
    for (const match of source.matchAll(pattern)) {
      const target = resolveLocalImport(sourceFile, match[2]);
      if (target && empty.has(target)) {
        findings.push(`${rel(sourceFile)} imports empty ${rel(target)}`);
      }
    }
  }

  return [...new Set(findings)].sort();
}

function assertNoAccessTokenBrowserPersistence() {
  const patterns = [
    /localStorage\.(?:getItem|setItem)\(\s*['"](?:accessToken|refreshToken|jwt|token)['"]/i,
    /sessionStorage\.(?:getItem|setItem)\(\s*['"](?:accessToken|refreshToken|jwt|token)['"]/i,
    /\bREACT_APP_(?:API|SOCKET|TOKEN|TENANT)_/,
  ];

  for (const file of sourceFiles().filter((candidate) => rel(candidate).startsWith('frontend/src/'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      if (pattern.test(source)) {
        errors.push(`Frontend security contract violation in ${rel(file)}: ${pattern}`);
      }
    }
  }
}

function assertProductionFrontendFallbacks() {
  const apiClient = path.join(ROOT, 'frontend/src/services/api.js');
  const socketClient = path.join(ROOT, 'frontend/src/services/socket.js');
  const legalClient = path.join(ROOT, 'frontend/src/legal/legalApi.js');

  for (const file of [apiClient, socketClient, legalClient]) {
    if (!fs.existsSync(file)) {
      errors.push(`Missing frontend transport contract: ${rel(file)}`);
    }
  }

  const apiSource = fs.readFileSync(apiClient, 'utf8');
  if (!apiSource.includes('window.location.origin')) {
    errors.push('frontend/src/services/api.js must support same-origin production fallback.');
  }
}

function assertPackageHygiene() {
  const forbidden = [
    'backend/backend/package-lock.json',
  ];

  for (const file of forbidden) {
    if (fs.existsSync(path.join(ROOT, file))) {
      errors.push(`Duplicate/nested dependency artifact remains: ${file}`);
    }
  }
}

function assertHealthContract() {
  const packagePath = path.join(ROOT, 'backend/package.json');
  const healthScript = path.join(ROOT, 'backend/scripts/healthcheck.js');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  if (!pkg.scripts?.health) errors.push('backend/package.json must expose a health script.');
  if (!fs.existsSync(healthScript)) errors.push('backend/scripts/healthcheck.js is missing.');
}

const emptyImports = importedEmptyFiles();
if (emptyImports.length) {
  errors.push(...emptyImports.map((entry) => `Active runtime import targets empty file: ${entry}`));
}

assertNoAccessTokenBrowserPersistence();
assertProductionFrontendFallbacks();
assertPackageHygiene();
assertHealthContract();

const legacyDebt = walk(path.join(ROOT, 'backend')).filter((file) => {
  if (!SOURCE_EXTENSIONS.has(path.extname(file))) return false;
  const source = fs.readFileSync(file, 'utf8');
  return !rel(file).startsWith('backend/repositories/financial/') && /(?:require\(|module\.exports\s*=)/.test(source);
}).length;

if (legacyDebt > 0) {
  warnings.push(`${legacyDebt} legacy CommonJS-compatible backend files remain outside the canonical financial ESM surface; no blind global conversion was performed.`);
}

if (warnings.length) {
  console.log('Warnings:');
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (errors.length) {
  console.error('Enterprise product gate: BLOCKED');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Enterprise product gate: PASS');
}
