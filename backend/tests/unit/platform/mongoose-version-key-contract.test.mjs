import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
const knownVersionedSchemas = [
  'models/Chat.js',
  'models/Transaction.js',
  'services/forumService.js',
  'modules/loan/models/LoanAudit.js',
];

async function sourceFiles(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'coverage' || entry.name === 'dist') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await sourceFiles(fullPath));
    else if (/\.(?:js|cjs|mjs)$/.test(entry.name)) results.push(fullPath);
  }
  return results;
}

test('Mongoose schema versionKey declarations never use boolean true', async () => {
  const files = await sourceFiles(backendRoot);
  const invalid = [];
  for (const filename of files) {
    const source = await readFile(filename, 'utf8');
    const expression = /\bversionKey\s*:\s*true\b/g;
    for (const match of source.matchAll(expression)) {
      invalid.push(`${path.relative(backendRoot, filename)}:${source.slice(0, match.index).split('\n').length}`);
    }
  }
  assert.deepEqual(invalid, [], `Invalid Mongoose versionKey options found: ${invalid.join(', ')}`);
});

test('schemas that intentionally enabled versioning retain the standard __v version key', async () => {
  for (const relativePath of knownVersionedSchemas) {
    const source = await readFile(path.join(backendRoot, relativePath), 'utf8');
    assert.match(source, /versionKey\s*:\s*['"]__v['"]/u, `${relativePath} must preserve Mongoose versioning`);
  }
});
