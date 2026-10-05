import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const environmentFile = new URL('../../bootstrap/environment.js', import.meta.url);

async function readEnvironmentSource() {
  return readFile(environmentFile, 'utf8');
}

test('environment bootstrap declares the canonical deterministic runtime contract', async () => {
  const source = await readEnvironmentSource();

  assert.match(source, /const NODE_ENVIRONMENTS\s*=\s*Object\.freeze\(\[\s*'development',\s*'test',\s*'staging',\s*'production'/s);
  assert.match(source, /const NODE_ENV_ALIASES\s*=\s*Object\.freeze\(\{[\s\S]*?dev:\s*'development',[\s\S]*?stage:\s*'staging',[\s\S]*?prod:\s*'production'/);
  assert.match(source, /NODE_ENV:\s*'development'/);
  assert.match(source, /PORT:\s*5000/);
  assert.match(source, /SERVICE_NAME:\s*'titech-community-capital-backend'/);
});

test('environment bootstrap keeps process-environment loading isolated from infrastructure startup', async () => {
  const source = await readEnvironmentSource();

  assert.doesNotMatch(source, /mongoose\.connect\s*\(/);
  assert.doesNotMatch(source, /redis(?:Client|\.createClient)?\s*\(/i);
  assert.doesNotMatch(source, /createServer\s*\(/);
  assert.match(source, /Load environment variables exactly once per process/);
  assert.match(source, /MUST NOT:[\s\S]*connect to MongoDB/);
});

test('environment bootstrap exposes explicit production-safety validation', async () => {
  const source = await readEnvironmentSource();

  assert.match(source, /function assertProductionSafe\s*\(/);
  assert.match(source, /function validateEnvironment\s*\(/);
  assert.match(source, /export \{[\s\S]*validateEnvironment,[\s\S]*assertProductionSafe,[\s\S]*\};/);
});
