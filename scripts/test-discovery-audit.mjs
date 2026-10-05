#!/usr/bin/env node
/**
 * TITech Community Capital — deterministic test discovery audit.
 * Standard-library-only; safe to run before npm install.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_ROOT = path.join(ROOT, 'backend');
const EXCLUDED = new Set(['node_modules', 'dist', 'coverage']);

function walk(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, result);
    else if (/\.(test|spec)\.(js|cjs|mjs)$/i.test(entry.name)) result.push(absolute);
  }
  return result;
}


function walkAll(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walkAll(absolute, result);
    else result.push(absolute);
  }
  return result;
}

const tests = walk(BACKEND_ROOT);
const plannedTestSpecs = [];
for (const file of walkAll(BACKEND_ROOT)) {
  if (file.endsWith('.planned.md')) plannedTestSpecs.push(file);
}
const empty = tests.filter((file) => fs.statSync(file).size === 0);
const blockingPathMatchers = [
  /^backend\/tests\/bootstrap\//,
  /^backend\/tests\/(?:unit\/financial|integration\/financial|providers|payment|reconciliation)(?:\/|\.)/,
  /^backend\/tests\/(?:unit\/platform|integration\/auth|integration\/security)(?:\/|\.)/,
];
const isBlockingEmpty = (file) => {
  const relative = path.relative(ROOT, file).replaceAll(path.sep, '/');
  return blockingPathMatchers.some((pattern) => pattern.test(relative));
};
const blockingEmpty = empty.filter(isBlockingEmpty);
const nonBlockingEmpty = empty.filter((file) => !isBlockingEmpty(file));
const byCanonical = new Map();
for (const file of tests) {
  const relative = path.relative(BACKEND_ROOT, file).replaceAll(path.sep, '/');
  const canonical = relative.toLowerCase();
  const list = byCanonical.get(canonical) ?? [];
  list.push(relative);
  byCanonical.set(canonical, list);
}
const caseInsensitiveDuplicates = [...byCanonical.values()].filter((items) => items.length > 1);

const mixed = [];
for (const file of tests) {
  let source = fs.readFileSync(file, 'utf8');
  source = source.replace(/\/\*.*?\*\//gs, '').replace(/(^|\n)\s*\/\/.*$/gm, '$1');
  const extension = path.extname(file).toLowerCase();
  const hasRequire = /\brequire\s*\(/.test(source) || /\bmodule\.exports\b|\bexports\.[A-Za-z_$]/.test(source);
  const hasEsm = /(^|\n)\s*(?:import\b|export\b)/.test(source);
  const structuralMixed = hasRequire && hasEsm;
  if (extension === '.js' && structuralMixed) mixed.push(path.relative(ROOT, file).replaceAll(path.sep, '/'));
}

const report = {
  generatedAt: new Date().toISOString(),
  totals: {
    testFiles: tests.length,
    emptyTestFiles: empty.length,
    blockingEmptyTestFiles: blockingEmpty.length,
    nonBlockingEmptyTestFiles: nonBlockingEmpty.length,
    caseInsensitiveDuplicateGroups: caseInsensitiveDuplicates.length,
    mixedModuleTestFiles: mixed.length,
    plannedTestSpecs: plannedTestSpecs.length,
  },
  emptyTestFiles: empty.map((file) => path.relative(ROOT, file).replaceAll(path.sep, '/')),
  blockingEmptyTestFiles: blockingEmpty.map((file) => path.relative(ROOT, file).replaceAll(path.sep, '/')),
  nonBlockingEmptyTestFiles: nonBlockingEmpty.map((file) => path.relative(ROOT, file).replaceAll(path.sep, '/')),
  caseInsensitiveDuplicates,
  mixedModuleTestFiles: mixed,
};

const reportPath = path.join(ROOT, 'reports', 'test-discovery-audit.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const wantsJson = process.argv.includes('--json');
if (wantsJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log('TITech test discovery audit');
  console.log(`Test files: ${report.totals.testFiles}`);
  console.log(`Empty test files: ${report.totals.emptyTestFiles}`);
  console.log(`Case-insensitive duplicate groups: ${report.totals.caseInsensitiveDuplicateGroups}`);
  console.log(`Mixed CJS/ESM test files: ${report.totals.mixedModuleTestFiles}`);
  console.log(`Planned non-executable test specs: ${report.totals.plannedTestSpecs}`);
  if (blockingEmpty.length) console.log(`\nBlocking empty test files:\n${report.blockingEmptyTestFiles.map((x) => `- ${x}`).join('\n')}`);
  if (nonBlockingEmpty.length) console.log(`\nNon-blocking test debt (tracked, not a release blocker): ${nonBlockingEmpty.length}`);
  if (caseInsensitiveDuplicates.length) console.log(`\nCase-insensitive duplicates:\n${caseInsensitiveDuplicates.map((x) => `- ${x.join(' | ')}`).join('\n')}`);
  if (mixed.length) console.log(`\nMixed module tests:\n${mixed.map((x) => `- ${x}`).join('\n')}`);
}

process.exit(blockingEmpty.length || caseInsensitiveDuplicates.length || mixed.length ? 2 : 0);
