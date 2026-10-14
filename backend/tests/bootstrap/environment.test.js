
import { test } from '@jest/globals';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const environmentFile = new URL(
  '../../bootstrap/environment.js',
  import.meta.url,
);

async function readEnvironmentSource() {
  return readFile(environmentFile, 'utf8');
}

function assertSourceMatches(source, pattern, message) {
  assert.match(source, pattern, message);
}

function assertSourceDoesNotMatch(source, pattern, message) {
  assert.doesNotMatch(source, pattern, message);
}

test('environment bootstrap declares the canonical runtime environments', async () => {
  const source = await readEnvironmentSource();

  assertSourceMatches(
    source,
    /const\s+NODE_ENVIRONMENTS\s*=\s*Object\.freeze\s*\(\s*\[[\s\S]*?'development'[\s\S]*?'test'[\s\S]*?'staging'[\s\S]*?'production'[\s\S]*?\]\s*\)/,
    'NODE_ENVIRONMENTS must define development, test, staging, and production',
  );

  assertSourceMatches(
    source,
    /const\s+NODE_ENV_ALIASES\s*=\s*Object\.freeze\s*\(\s*\{[\s\S]*?\bdev\s*:\s*['"]development['"][\s\S]*?\bstage\s*:\s*['"]staging['"][\s\S]*?\bprod\s*:\s*['"]production['"][\s\S]*?\}\s*\)/,
    'NODE_ENV_ALIASES must define the canonical dev, stage, and prod aliases',
  );
});

test('environment bootstrap preserves required default runtime settings', async () => {
  const source = await readEnvironmentSource();

  assertSourceMatches(
    source,
    /\bNODE_ENV\s*:\s*['"]development['"]/,
    'The declared development default must remain explicit',
  );

  assertSourceMatches(
    source,
    /\bPORT\s*:\s*5000\b/,
    'The backend default port must remain 5000',
  );

  assertSourceMatches(
    source,
    /\bSERVICE_NAME\s*:\s*['"]titech-community-capital-backend['"]/,
    'The service name must identify the TITech backend',
  );
});

test('environment bootstrap does not start infrastructure connections', async () => {
  const source = await readEnvironmentSource();

  assertSourceDoesNotMatch(
    source,
    /\bmongoose\s*\.\s*connect\s*\(/i,
    'Environment initialization must not connect to MongoDB',
  );

  assertSourceDoesNotMatch(
    source,
    /\bmongoose\s*\.\s*createConnection\s*\(/i,
    'Environment initialization must not create MongoDB connections',
  );

  assertSourceDoesNotMatch(
    source,
    /\bredisClient\s*\.\s*connect\s*\(/i,
    'Environment initialization must not connect a Redis client',
  );

  assertSourceDoesNotMatch(
    source,
    /\bcreateClient\s*\(/i,
    'Environment initialization must not construct infrastructure clients',
  );

  assertSourceDoesNotMatch(
    source,
    /\bcreateServer\s*\(/,
    'Environment initialization must not create an HTTP server',
  );
});

test('environment bootstrap documents its process-environment responsibilities', async () => {
  const source = await readEnvironmentSource();

  assertSourceMatches(
    source,
    /Load environment variables exactly once per process/i,
    'The environment bootstrap contract must document single-load behavior',
  );

  assertSourceMatches(
    source,
    /MUST NOT:[\s\S]*?connect to MongoDB/i,
    'The contract must explicitly prohibit MongoDB startup in this phase',
  );
});

test('environment bootstrap exposes explicit validation contracts', async () => {
  const source = await readEnvironmentSource();

  assertSourceMatches(
    source,
    /\bfunction\s+validateEnvironment\s*\(/,
    'validateEnvironment must be declared as a function',
  );

  assertSourceMatches(
    source,
    /\bfunction\s+assertProductionSafe\s*\(/,
    'assertProductionSafe must be declared as a function',
  );

  assertSourceMatches(
    source,
    /export\s*\{[\s\S]*?\bvalidateEnvironment\b[\s\S]*?\bassertProductionSafe\b[\s\S]*?\}\s*;?/,
    'Both validation functions must be exported from the environment module',
  );
});
