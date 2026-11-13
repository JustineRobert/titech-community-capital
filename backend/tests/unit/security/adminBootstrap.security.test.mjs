import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const seedEntry = fs.readFileSync(new URL('../../../scripts/seed.js', import.meta.url), 'utf8');
const seedAdmin = fs.readFileSync(new URL('../../../scripts/seedAdmin.js', import.meta.url), 'utf8');
const rootCli = fs.readFileSync(new URL('../../../../scripts/seed-admin-cli.js', import.meta.url), 'utf8');

test('legacy seed entry delegates safely and cannot delete group data', () => {
  assert.match(seedEntry, /import \{ run \} from '\.\/seedAdmin\.js'/);
  assert.doesNotMatch(seedEntry, /deleteMany|insertMany|password\s*:/i);
  assert.doesNotMatch(seedEntry, /titechaafrica@/i);
});

test('platform administrator bootstrap requires explicit identity and secret', () => {
  assert.match(seedAdmin, /SEED_ADMIN_EMAIL is required/);
  assert.match(seedAdmin, /SEED_ADMIN_PASSWORD is required/);
  assert.match(seedAdmin, /PLATFORM_ADMIN_ROLE = "platform_admin"/);
  assert.match(seedAdmin, /SEED_ADMIN_ROLE must be/);
  assert.match(seedAdmin, /special characters/);
  assert.match(seedAdmin, /SEED_ADMIN_ALLOW_PASSWORD_ROTATION/);
  assert.match(seedAdmin, /existing administrator account is not active/);
  assert.match(seedAdmin, /SEED_ADMIN_TENANT_ID must be a valid tenant ObjectId/);
  assert.doesNotMatch(seedAdmin, /admin@titechcapital\.com/);
  assert.doesNotMatch(seedAdmin, /\+256700000000/);
});

test('administrator CLI refuses password and database credentials on command line', () => {
  assert.match(rootCli, /Object\.hasOwn\(args, 'pass'\)/);
  assert.match(rootCli, /Object\.hasOwn\(args, 'password'\)/);
  assert.match(rootCli, /Object\.hasOwn\(args, 'mongo'\)/);
  assert.match(rootCli, /protected environment\/secret manager/);
  assert.match(rootCli, /SEED_ADMIN_ROLE = 'platform_admin'/);
  assert.doesNotMatch(rootCli, /ADMIN_PASS\s*=/);
});

const legacyBackendCli = fs.readFileSync(new URL('../../../scripts/seed-admin.js', import.meta.url), 'utf8');
const legacyRootCli = fs.readFileSync(new URL('../../../../scripts/seed-admin-cli.cjs', import.meta.url), 'utf8');
const localSeed = fs.readFileSync(new URL('../../../scripts/seed-local.js', import.meta.url), 'utf8');

test('legacy administrator bootstrap aliases delegate to the canonical platform-admin flow', () => {
  assert.match(legacyBackendCli, /import \{ run \} from '\.\/seedAdmin\.js'/);
  assert.match(legacyRootCli, /seed-admin-cli\.js/);
  assert.doesNotMatch(legacyBackendCli, /ADMIN_PASS|generatePassword|role:\s*['"]admin['"]/);
  assert.doesNotMatch(legacyRootCli, /password\s*=\s*getArg/);
});

test('synthetic local seeder cannot fabricate users, loans or successful payment history', () => {
  assert.match(localSeed, /intentionally disabled/);
  assert.match(localSeed, /synthetic loans and successful payment records are not permitted/);
  assert.doesNotMatch(localSeed, /new Transaction|status:\s*['"]success['"]|password:\s*['"]/);
});
