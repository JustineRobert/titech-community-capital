#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'backend/routes');
const strict = process.argv.includes('--strict');
const runtime = process.argv.includes('--runtime') || process.argv.includes('--runtime-if-available');

const rel = (p) => path.relative(ROOT, p).replaceAll('\\', '/');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target, out);
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) out.push(target);
  }
  return out;
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function refs(text) {
  const clean = stripComments(text);
  const values = [];
  const patterns = [
    /\bimport\s+(?:[^'\"]+from\s+)?['\"]([^'\"]+)['\"]/g,
    /\bimport\(\s*['\"]([^'\"]+)['\"]\s*\)/g,
    /\brequire\(\s*['\"]([^'\"]+)['\"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of clean.matchAll(pattern)) values.push(match[1]);
  }
  return [...new Set(values)];
}

function resolve(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, 'index.js'),
    path.join(base, 'index.mjs'),
    path.join(base, 'index.cjs'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function safe(error, depth = 0) {
  if (!error || depth > 4) return null;
  return {
    name: error.name || 'Error',
    code: error.code || null,
    message: error.message || String(error),
    modulePath: error.modulePath || error.path || null,
    dependency: error.dependency || null,
    stack: typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 20).join('\n') : null,
    cause: error.cause && error.cause !== error ? safe(error.cause, depth + 1) : null,
  };
}

const files = walk(DIR);
const sourceFiles = files.map((file) => ({ file, text: stripComments(fs.readFileSync(file, 'utf8')) }));

function inboundRouteReferences(routeFile) {
  const stem = path.basename(routeFile, path.extname(routeFile));
  const variants = [
    `./${stem}`,
    `./${stem}.js`,
    `../routes/${stem}`,
    `../routes/${stem}.js`,
    `routes/${stem}`,
    `routes/${stem}.js`,
  ];
  const results = [];
  for (const source of sourceFiles) {
    if (source.file === routeFile) continue;
    if (variants.some((variant) => source.text.includes(variant))) results.push(rel(source.file));
  }
  return results;
}

const matrix = files.map((file) => {
  const source = fs.readFileSync(file, 'utf8');
  const local = refs(source).filter((value) => value.startsWith('.'));
  const edges = local.map((spec) => {
    const resolved = resolve(file, spec);
    return { spec, resolved: resolved ? rel(resolved) : null };
  });
  const missingImports = edges.filter((edge) => !edge.resolved);
  const inboundReferences = inboundRouteReferences(file);

  let status = 'STATIC_PASS';
  if (missingImports.length) {
    status = inboundReferences.length ? 'BLOCKED' : 'UNREFERENCED_LEGACY_BLOCKED';
  }

  return {
    route: rel(file),
    inboundReferences,
    localImports: edges,
    missingImports,
    status,
    note: status === 'UNREFERENCED_LEGACY_BLOCKED'
      ? 'No source reference to this route file was found outside the route itself; unresolved imports are retained as legacy/dead-code debt and are not treated as the active bootstrap route graph.'
      : null,
  };
});

const canRuntime = runtime && fs.existsSync(path.join(ROOT, 'backend', 'node_modules'));
const runtimeResults = [];
if (canRuntime) {
  for (const item of matrix) {
    try {
      const mod = await import(pathToFileURL(path.join(ROOT, item.route)).href + `?forensics=${Date.now()}`);
      runtimeResults.push({ route: item.route, status: 'PASS', exportKeys: Object.keys(mod) });
    } catch (error) {
      runtimeResults.push({ route: item.route, status: 'FAIL', error: safe(error) });
    }
  }
}

const staticPass = matrix.filter((item) => item.status === 'STATIC_PASS').length;
const staticBlocked = matrix.filter((item) => item.status === 'BLOCKED').length;
const legacyBlocked = matrix.filter((item) => item.status === 'UNREFERENCED_LEGACY_BLOCKED').length;

const result = {
  generatedAt: new Date().toISOString(),
  routeCount: files.length,
  canonicalEntry: 'backend/routes/index.js',
  static: {
    pass: staticPass,
    blocked: staticBlocked,
    unreferencedLegacyBlocked: legacyBlocked,
    matrix,
  },
  runtime: canRuntime
    ? {
        attempted: runtimeResults.length,
        pass: runtimeResults.filter((item) => item.status === 'PASS').length,
        fail: runtimeResults.filter((item) => item.status === 'FAIL').length,
        results: runtimeResults,
      }
    : {
        attempted: 0,
        note: 'Runtime import skipped because backend/node_modules is not installed in this validation environment.',
      },
  policy: {
    strict,
    activeBootstrapRouteGraph: 'backend/routes/index.js',
    unreferencedLegacyRoutesAreFindings: true,
  },
};

fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports/route-import-matrix.json'), JSON.stringify(result, null, 2) + '\n');

console.log(`route-count=${result.routeCount}`);
console.log(`static-pass=${staticPass}`);
console.log(`static-blocked=${staticBlocked}`);
console.log(`unreferenced-legacy-blocked=${legacyBlocked}`);
if (runtime) console.log(`runtime-pass=${result.runtime.pass} runtime-fail=${result.runtime.fail}`);

if (strict && (staticBlocked || legacyBlocked)) process.exitCode = 1;
if (canRuntime && result.runtime.fail) process.exitCode = 1;
