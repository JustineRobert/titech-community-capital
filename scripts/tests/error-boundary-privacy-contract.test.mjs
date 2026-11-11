import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../../frontend/src/components/ui/ErrorBoundary.jsx', import.meta.url),
  'utf8',
);

test('persisted error context excludes URL query strings and fragments', () => {
  assert.match(source, /function getSafePageLocation\(\)/);
  assert.match(source, /return `\$\{current\.origin\}\$\{current\.pathname\}`;/);
  assert.match(source, /url: getSafePageLocation\(\)/);
  assert.doesNotMatch(source, /window\.location\.href\s*[,;]/);
});
