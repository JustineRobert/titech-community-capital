#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(ROOT, 'backend');
const args = new Set(process.argv.slice(2));
const strict = args.has('--strict') || args.has('--all');
const full = args.has('--full');
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const EXCLUDED = new Set(['node_modules', 'coverage', 'dist', 'build', '.git', 'logs', 'tmp', 'backup']);

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}
function read(file) { return fs.readFileSync(file, 'utf8'); }

const files = walk(BACKEND);
const changedManifest = path.join(ROOT, 'docs', 'TITECH_CHANGED_FILES_2026-09-27.md');
let changedFiles = [];
if (fs.existsSync(changedManifest)) {
  const text = read(changedManifest);
  changedFiles = [...text.matchAll(/\| (?:MODIFIED|ADDED) \| `([^`]+\.(?:js|mjs|cjs))` \|/g)]
    .map((m) => path.join(ROOT, m[1]))
    .filter((f) => fs.existsSync(f));
}
const nodeCheckFiles = full
  ? files.filter((file) => !file.endsWith('backend/tests/helpers/renderWithProviders.js'))
  : (changedFiles.length ? changedFiles : files).filter((file) => !file.endsWith('backend/tests/helpers/renderWithProviders.js'));

const results = [];
const pass = (id, message, details = []) => results.push({ id, status: 'PASS', message, details });
const warn = (id, message, details = []) => results.push({ id, status: 'WARN', message, details });
const fail = (id, message, details = []) => results.push({ id, status: 'FAIL', message, details });

const emptyCatch = [];
const controlRegex = [];
for (const file of files) {
  const source = read(file);
  if (/catch\s*\([^)]*\)\s*\{\s*\}/m.test(source)) emptyCatch.push(rel(file));
  source.split(/\r?\n/).forEach((line, index) => {
    if (/\/[^/\n]*(?:\\u0000|\\u0001|\\u0008|\\u000B|\\u000C|\\u000E|\\u001F|\\u007F)[^/]*\/[dgimsuvy]*/.test(line)) {
      controlRegex.push(`${rel(file)}:${index + 1}`);
    }
  });
}
emptyCatch.length ? fail('NO_EMPTY_CATCH', 'Empty catch blocks remain.', emptyCatch) : pass('NO_EMPTY_CATCH', 'No empty catch blocks detected.');
controlRegex.length ? fail('NO_CONTROL_REGEX_LITERAL', 'Control-character regex literals remain.', controlRegex) : pass('NO_CONTROL_REGEX_LITERAL', 'No control-character regex literals detected.');

const parserFailures = [];
const concurrency = 16;
for (let i = 0; i < nodeCheckFiles.length; i += concurrency) {
  const batch = nodeCheckFiles.slice(i, i + concurrency);
  const settled = await Promise.all(batch.map(async (file) => {
    try {
      await execFileAsync(process.execPath, ['--check', file], { maxBuffer: 2 * 1024 * 1024 });
      return null;
    } catch (error) {
      return { file: rel(file), stderr: String(error.stderr || error.message).trim().slice(0, 1200) };
    }
  }));
  for (const item of settled) if (item) parserFailures.push(item);
}
parserFailures.length
  ? fail('NODE_SYNTAX', 'Node syntax validation failed.', parserFailures)
  : pass('NODE_SYNTAX', `Node syntax validation passed for ${nodeCheckFiles.length} Node-parseable files.`, [full ? 'Scope: full backend source.' : 'Scope: changed JS/MJS/CJS files from the remediation manifest.', 'JSX helper excluded from node --check.']);

const cjsSeams = [];
for (const file of files) {
  if (path.extname(file) !== '.js') continue;
  if (/\bmodule\.exports\b|\bexports\.[A-Za-z_$]/.test(read(file))) cjsSeams.push(rel(file));
}
cjsSeams.length ? warn('ESM_CJS_SEAMS', 'CommonJS export seams remain inside .js files under an ESM package boundary.', cjsSeams) : pass('ESM_CJS_SEAMS', 'No CommonJS export seams detected in .js files.');

try {
  const pkg = JSON.parse(read(path.join(BACKEND, 'package.json')));
  const lock = JSON.parse(read(path.join(BACKEND, 'package-lock.json')));
  const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const rootLock = { ...(lock.packages?.['']?.dependencies || {}), ...(lock.packages?.['']?.devDependencies || {}) };
  const missing = Object.keys(declared).filter((name) => !rootLock[name]);
  const mismatched = Object.keys(declared).filter((name) => rootLock[name] && rootLock[name] !== declared[name]);
  if (missing.length || mismatched.length) {
    warn('LOCKFILE_ALIGNMENT', 'package.json and package-lock.json are not fully aligned.', [`Missing from lock root: ${missing.join(', ') || 'none'}`, `Different specifiers: ${mismatched.join(', ') || 'none'}`]);
  } else pass('LOCKFILE_ALIGNMENT', 'Declared backend dependencies are represented in the lockfile root.');
} catch (error) {
  fail('LOCKFILE_ALIGNMENT', `Unable to inspect dependency metadata: ${error.message}`);
}

const forbiddenDirectories = ['node_modules', 'coverage'].filter((name) => fs.existsSync(path.join(ROOT, name)));
forbiddenDirectories.length ? warn('PACKAGE_CLEANLINESS', 'Generated dependency/test directories exist in the release tree.', forbiddenDirectories) : pass('PACKAGE_CLEANLINESS', 'No root node_modules/coverage directories present in the release tree.');

const blockers = strict ? results.filter((r) => r.status !== 'PASS') : results.filter((r) => r.status === 'FAIL');
const output = {
  generatedAt: new Date().toISOString(),
  repository: 'https://github.com/JustineRobert/titech-community-capital',
  mode: strict ? 'strict' : 'source',
  scope: full ? 'full-backend' : 'changed-source',
  checks: results,
  summary: {
    pass: results.filter((r) => r.status === 'PASS').length,
    warn: results.filter((r) => r.status === 'WARN').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
  },
};
console.log(JSON.stringify(output, null, 2));
process.exitCode = blockers.length ? 1 : 0;
