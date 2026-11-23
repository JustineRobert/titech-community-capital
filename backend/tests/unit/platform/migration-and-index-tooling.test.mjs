import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadMigrationModule } from '../../../utils/migrationModuleLoader.js';
import { ensureIndex, validateIndexDefinition } from '../../../utils/indexCreation.js';
import { importBackendDependency } from '../../../utils/backendDependencyLoader.js';

test('legacy CommonJS migration source loads without changing its .js identity', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'titech-migration-cjs-'));
  try {
    const filename = path.join(directory, '20261123_000000_test.js');
    await writeFile(filename, "module.exports = { up: async ({ marker }) => marker, down: async () => 'down' };\n");
    const migration = await loadMigrationModule(filename);
    assert.equal(await migration.up({ marker: 'up-ok' }), 'up-ok');
    assert.equal(await migration.down(), 'down');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('native ESM migration source loads through the ESM loader', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'titech-migration-esm-'));
  try {
    await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
    const filename = path.join(directory, '20261123_000001_test.js');
    await writeFile(filename, 'export async function up() { return "esm-ok"; }\n');
    const migration = await loadMigrationModule(filename);
    assert.equal(await migration.up(), 'esm-ok');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('empty migration source is rejected', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'titech-migration-empty-'));
  try {
    const filename = path.join(directory, 'empty.js');
    await writeFile(filename, '  \n');
    await assert.rejects(loadMigrationModule(filename), /Migration file is empty/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('index definitions reject empty keys and unsupported directions', () => {
  assert.throws(() => validateIndexDefinition({}), /non-empty object/);
  assert.throws(() => validateIndexDefinition({ tenantId: 0 }), /Unsupported index direction/);
  assert.throws(() => validateIndexDefinition({ '$**': 'wildcard' }), /Unsupported index direction/);
  assert.throws(() => validateIndexDefinition({ tenantId: 1 }, { name: '  ' }), /non-empty string/);
  assert.equal(validateIndexDefinition({ tenantId: 1, createdAt: -1 }), true);
});

test('index creation succeeds idempotently when MongoDB accepts the same definition', async () => {
  const calls = [];
  const collection = {
    collectionName: 'test_accounts',
    async createIndex(keys, options) {
      calls.push({ keys, options });
      return options.name || 'tenantId_1';
    },
  };
  assert.equal(await ensureIndex(collection, { tenantId: 1 }, { name: 'tenant_scope' }), 'tenant_scope');
  assert.equal(calls.length, 1);
});

test('index creation propagates incompatible-index failures with the original cause', async () => {
  const cause = Object.assign(new Error('IndexOptionsConflict'), { code: 85 });
  const collection = {
    collectionName: 'financial_transactions',
    async createIndex() { throw cause; },
  };
  await assert.rejects(
    ensureIndex(collection, { tenantId: 1 }, { unique: true }),
    (error) => error.code === 85 && error.cause === cause && /financial_transactions/.test(error.message),
  );
});

test('migration and index entry points remain native ESM and do not use CommonJS globals', async () => {
  const { readFile } = await import('node:fs/promises');
  const files = [
    new URL('../../../scripts/migrate.js', import.meta.url),
    new URL('../../../scripts/createIndexes.js', import.meta.url),
    new URL('../../../utils/migrationRunner.js', import.meta.url),
  ];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.match(source, /^import\s/m, `${file.pathname} must use ESM imports`);
    assert.doesNotMatch(source, /\brequire\s*\(|\bmodule\.exports\b/, `${file.pathname} must not use CommonJS globals`);
  }
});

test('migration runner is wired to lease, checksum and controlled document lifecycle operations', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../../utils/migrationRunner.js', import.meta.url), 'utf8');
  assert.match(source, /Migration\.claimMigration/);
  assert.match(source, /Migration\.renewMigrationLease/);
  assert.match(source, /batch,/);
  assert.match(source, /Migration\.completeMigration/);
  assert.match(source, /Migration\.failMigration/);
  assert.match(source, /checksum drift/i);
  assert.match(source, /Migration\.find\(\{ environment: this\.environment, isDeleted: false \}\)/);
  assert.doesNotMatch(source, /findByIdAndUpdate|findOneAndUpdate/);
});

test('migration state transitions persist checksum and duration atomically', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../../models/Migration.js', import.meta.url), 'utf8');
  assert.match(source, /completeMigration\(\{[\s\S]*?startedAt = null/);
  assert.match(source, /update\.\$set\.durationMs = calculateDurationMs\(startedAt, now\)/);
  assert.match(source, /failMigration\(\{[\s\S]*?startedAt = null/);
  assert.match(source, /durationMs: calculateDurationMs\(startedAt, failedAt\)/);
  assert.match(source, /allowMigrationMutation: true/);
  assert.match(source, /batch !== undefined && \(!Number\.isSafeInteger\(batch\) \|\| batch < 0\)/);
  assert.match(source, /claimMigration =\s*async function claimMigration\(\{[\s\S]*?batch = undefined/);
});


test('missing backend dependencies produce a direct install instruction and preserve the cause', async () => {
  const missing = Object.assign(new Error("Cannot find package 'dotenv' imported from backend/server.js"), { code: 'ERR_MODULE_NOT_FOUND' });
  await assert.rejects(
    importBackendDependency('dotenv', async () => { throw missing; }),
    (error) => error.cause === missing && /dotenv/.test(error.message) && /npm --prefix backend ci/.test(error.message),
  );
});

test('non-module-resolution failures are not disguised as installation errors', async () => {
  const original = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  await assert.rejects(
    importBackendDependency('mongoose', async () => { throw original; }),
    (error) => error === original,
  );
});


test('missing application source files are not misdiagnosed as missing npm dependencies', async () => {
  const missing = Object.assign(new Error("Cannot find module '../models/Loan.js'"), { code: 'ERR_MODULE_NOT_FOUND' });
  await assert.rejects(
    importBackendDependency('../models/Loan.js', async () => { throw missing; }),
    (error) => error.cause === missing && /Verify that the source module exists/.test(error.message) && !/npm --prefix backend ci/.test(error.message),
  );
});
