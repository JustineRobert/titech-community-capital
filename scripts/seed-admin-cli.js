#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..', 'backend');
const require = createRequire(import.meta.url);
const mongoose = require(require.resolve('mongoose', { paths: [backendRoot] }));

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

function maskCredentials(uri) {
  return String(uri).replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)[^@]+(@)/i, '$1****$2');
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectWithRetry(uri, source, maxAttempts = 10) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`Connecting to MongoDB (${source}) attempt ${attempt}/${maxAttempts}`);
    console.log(`URI (masked): ${maskCredentials(uri)}`);
    try {
      await mongoose.connect(uri, {
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        autoIndex: process.env.NODE_ENV !== 'production',
      });
      return;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      const delay = Math.min(2000 * 2 ** (attempt - 1), 30000) + Math.floor(Math.random() * 500);
      await wait(delay);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    console.log('Usage: node scripts/seed-admin-cli.js --email <email> --pass <password> [--name <name>] [--force] [--mongo <mongoUri>]');
    return;
  }

  if (args.email) process.env.ADMIN_EMAIL = args.email;
  if (args.pass) process.env.ADMIN_PASS = args.pass;
  if (args.name) process.env.ADMIN_NAME = args.name;
  if (args.force) process.env.ADMIN_FORCE = 'true';
  if (args.mongo) process.env.MONGO_URI = args.mongo;

  try { require('dotenv').config({ path: path.join(backendRoot, '.env') }); } catch {}

  const uri = process.env.MONGO_URI || process.env.MONGO_URI_FALLBACK || 'mongodb://127.0.0.1:27017/community_savings';
  const source = process.env.MONGO_URI ? 'MONGO_URI' : process.env.MONGO_URI_FALLBACK ? 'MONGO_URI_FALLBACK' : 'default local fallback';

  await connectWithRetry(uri, source);

  const seedPath = path.join(backendRoot, 'scripts', 'seedAdmin.js');
  const seedModule = await import(seedPath);
  const runSeed = seedModule.run;
  if (typeof runSeed !== 'function') throw new Error('Backend seed script did not export a runner function.');
  await runSeed();
}

main().catch((error) => {
  console.error('Admin seed failed:', error?.message || String(error));
  process.exitCode = 1;
});
