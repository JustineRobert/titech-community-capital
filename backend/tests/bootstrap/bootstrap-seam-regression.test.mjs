import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const backendRoot = new URL('../../', import.meta.url);

async function readBackendFile(relativePath) {
  const url = new URL(relativePath, backendRoot);
  return readFile(url, 'utf8');
}

function indexOrThrow(source, needle, file) {
  const index = source.indexOf(needle);
  assert.notEqual(
    index,
    -1,
    `${file} must contain: ${needle}`,
  );
  return index;
}

test('observability initializes createRequire before its compatibility require calls', async () => {
  const file = 'bootstrap/observability.js';
  const source = await readBackendFile(file);
  const createRequireIndex = indexOrThrow(
    source,
    'const require = createRequire(import.meta.url);',
    file,
  );

  const requireCall = 'require(';
  const startupErrorsSpecifier = './startupErrors.js';
  const canonicalObservabilitySpecifier = '../observability.js';
  const startupErrorsRequireIndex = indexOrThrow(
    source,
    `${requireCall}'${startupErrorsSpecifier}')`,
    file,
  );
  const canonicalRequireIndex = indexOrThrow(
    source,
    `${requireCall}'${canonicalObservabilitySpecifier}')`,
    file,
  );

  assert.ok(
    createRequireIndex < startupErrorsRequireIndex,
    `${file} evaluates startupErrors before require is initialized`,
  );
  assert.ok(
    createRequireIndex < canonicalRequireIndex,
    `${file} evaluates canonical observability before require is initialized`,
  );
});

test('resilience initializes createRequire before its CommonJS fallback path', async () => {
  const file = 'bootstrap/resilience.js';
  const source = await readBackendFile(file);
  const createRequireIndex = indexOrThrow(
    source,
    'const require = createRequire(import.meta.url);',
    file,
  );
  const resolveIndex = indexOrThrow(
    source,
    'require.resolve(',
    file,
  );
  const requireIndex = indexOrThrow(
    source,
    'require(\n        resolvedPath,',
    file,
  );

  assert.ok(
    createRequireIndex < resolveIndex,
    `${file} reaches require.resolve before require is initialized`,
  );
  assert.ok(
    createRequireIndex < requireIndex,
    `${file} reaches require() before require is initialized`,
  );
});

test('routes bootstrap preserves nested import errors instead of hiding them', async () => {
  const file = 'bootstrap/routes.js';
  const source = await readBackendFile(file);

  assert.match(
    source,
    /code:\s*['"]ROUTES_MODULE_IMPORT_FAILED['"][\s\S]{0,500}?cause:\s*error/,
  );
  assert.match(
    source,
    /code:\s*['"]ROUTES_MODULE_LOAD_FAILED['"][\s\S]{0,700}?cause:\s*requireError/,
  );
});
