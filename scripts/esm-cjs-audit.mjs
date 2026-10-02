#!/usr/bin/env node
/**
 * TITech Community Capital — ESM/CJS architecture audit
 *
 * Standard-library-only audit used before dependency installation. It reports:
 *   - file module classification by source syntax/extension
 *   - relative internal require() boundaries
 *   - unresolved relative module specs
 *   - mixed CJS/ESM files
 *
 * It deliberately does not rewrite source files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(ROOT, 'backend');
const EXCLUDED = new Set(['node_modules', 'dist', 'coverage', 'generated']);
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const IMPORT_RE = /\bimport\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|\bexport\s+(?:default\s+)?/g;
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// This audit is source-scan based rather than AST based. Strip comments before
// classification so documentation examples such as `module.exports` or
// `require("./example")` do not become false CJS/runtime findings.
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, result);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) result.push(absolute);
  }
  return result;
}

function classify(file, source) {
  const ext = path.extname(file).toLowerCase();
  const code = codeOnly(source);
  const hasImportExport = IMPORT_RE.test(code);
  IMPORT_RE.lastIndex = 0;
  const hasRequire = REQUIRE_RE.test(code) || /\bmodule\.exports\b|\bexports\.[A-Za-z_$]/.test(code);
  REQUIRE_RE.lastIndex = 0;

  if (ext === '.cjs') return hasImportExport ? 'mixed-cjs' : 'cjs';
  if (ext === '.mjs') return hasRequire ? 'mixed-esm' : 'esm';
  if (hasImportExport && hasRequire) return 'mixed-js';
  if (hasImportExport) return 'esm';
  if (hasRequire) return 'cjs';
  return 'neutral-js';
}

function resolveRelative(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`, path.join(base, 'index.js'), path.join(base, 'index.cjs'), path.join(base, 'index.mjs')];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

const files = walk(BACKEND);
const classifications = [];
const internalBoundaries = [];
const unresolved = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const code = codeOnly(source);
  const classification = classify(file, source);
  classifications.push({
    file: path.relative(ROOT, file).replaceAll(path.sep, '/'),
    classification,
  });

  let match;
  while ((match = REQUIRE_RE.exec(code))) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue;
    const target = resolveRelative(file, spec);
    const record = {
      from: path.relative(ROOT, file).replaceAll(path.sep, '/'),
      specifier: spec,
      target: target ? path.relative(ROOT, target).replaceAll(path.sep, '/') : null,
      fromClassification: classification,
      targetClassification: target ? classifications.find((item) => item.file === path.relative(ROOT, target).replaceAll(path.sep, '/'))?.classification ?? 'unscanned' : 'unresolved',
    };
    internalBoundaries.push(record);
    if (!target) unresolved.push(record);
  }
  REQUIRE_RE.lastIndex = 0;
}

const cjsToEsm = internalBoundaries.filter((item) => item.fromClassification.startsWith('cjs') && item.targetClassification.startsWith('esm'));
const mixed = classifications.filter((item) => item.classification.startsWith('mixed'));

const output = {
  generatedAt: new Date().toISOString(),
  root: path.relative(ROOT, BACKEND).replaceAll(path.sep, '/'),
  totals: {
    files: classifications.length,
    esm: classifications.filter((x) => x.classification === 'esm').length,
    cjs: classifications.filter((x) => x.classification === 'cjs').length,
    mixed: mixed.length,
    neutral: classifications.filter((x) => x.classification === 'neutral-js').length,
    unresolvedRelativeRequires: unresolved.length,
    cjsToEsmRelativeRequires: cjsToEsm.length,
  },
  classifications,
  cjsToEsm,
  unresolved,
};

const wantsJson = process.argv.includes('--json');
if (wantsJson) {
  console.log(JSON.stringify(output, null, 2));
  process.exit(unresolved.length > 0 ? 2 : 0);
}

console.log('TITech ESM/CJS audit');
console.log(`Files scanned: ${output.totals.files}`);
console.log(`ESM: ${output.totals.esm} | CJS: ${output.totals.cjs} | Mixed: ${output.totals.mixed} | Neutral: ${output.totals.neutral}`);
console.log(`Unresolved relative require(): ${output.totals.unresolvedRelativeRequires}`);
console.log(`CJS -> ESM relative boundaries: ${output.totals.cjsToEsmRelativeRequires}`);

if (cjsToEsm.length) {
  console.log('\nCJS -> ESM internal boundaries:');
  for (const item of cjsToEsm.slice(0, 80)) console.log(`- ${item.from} -> ${item.target ?? item.specifier}`);
}

if (unresolved.length) {
  console.log('\nUnresolved relative require() specs:');
  for (const item of unresolved.slice(0, 80)) console.log(`- ${item.from}: ${item.specifier}`);
}

process.exit(unresolved.length > 0 ? 2 : 0);
