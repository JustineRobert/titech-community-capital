#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptDirectory, '..', 'backend');
const backendRequire = createRequire(path.join(backendRoot, 'package.json'));

function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith('--') ? next : true;
    if (result[key] !== true) index += 1;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    console.log([
      'Usage: node scripts/seed-admin-cli.js [--email <email>] [--name <first last>] [--tenant-id <id>] [--phone <E.164>]',
      'Required environment: MONGODB_URI or MONGO_URI, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD.',
      'The role is fixed to platform_admin. Do not pass passwords or database credentials as command-line arguments.',
    ].join('\n'));
    return;
  }

  if (Object.hasOwn(args, 'pass') || Object.hasOwn(args, 'password') || Object.hasOwn(args, 'mongo')) {
    throw new Error('Passwords and MongoDB credentials are not accepted as command-line arguments. Supply them through a protected environment/secret manager.');
  }

  const allowed = new Set(['email', 'name', 'tenant-id', 'phone']);
  const unsupported = Object.keys(args).filter((key) => !allowed.has(key));
  if (unsupported.length) throw new Error(`Unsupported argument(s): ${unsupported.join(', ')}`);

  backendRequire('dotenv').config({ path: path.join(backendRoot, '.env'), override: false });

  if (args.email) process.env.SEED_ADMIN_EMAIL = String(args.email);
  if (args['tenant-id']) process.env.SEED_ADMIN_TENANT_ID = String(args['tenant-id']);
  if (args.phone) process.env.SEED_ADMIN_PHONE = String(args.phone);
  if (args.name) {
    const parts = String(args.name).trim().split(/\s+/);
    process.env.SEED_ADMIN_FIRSTNAME = parts.shift() || 'Platform';
    process.env.SEED_ADMIN_LASTNAME = parts.join(' ') || 'Administrator';
  }
  process.env.SEED_ADMIN_ROLE = 'platform_admin';

  const seedPath = path.join(backendRoot, 'scripts', 'seedAdmin.js');
  const { run } = await import(pathToFileURL(seedPath).href);
  await run();
}

main().catch((error) => {
  console.error('TITech administrator bootstrap failed:', error?.message || String(error));
  process.exitCode = 1;
});
