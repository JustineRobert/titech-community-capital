import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('organization profile integration gate passes', () => {
  const output = execFileSync(process.execPath, ['scripts/organization-profile-gate.mjs'], { cwd: root, encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.status, 'PASS');
  assert.ok(result.checks.every((check) => check.status === 'PASS'));
});
