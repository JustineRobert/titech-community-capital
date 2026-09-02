#!/usr/bin/env node
// Root-level CLI wrapper to seed a group into the backend DB.
// Usage examples:
//   node scripts/seed-groups-cli.js --admin admin@example.com --name "Staff SACCO" --description "Investment group" --type investment
//   node scripts/seed-groups-cli.js --admin admin@example.com --name "Staff SACCO" --description "Investment group" --mongo mongodb+srv://...

const path = require('path');
const backendRoot = path.join(__dirname, '..', 'community-savings-app-backend');
const mongoose = require(require.resolve('mongoose', { paths: [backendRoot] }));

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function maskCredentials(uri) {
  return uri.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1****$2');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(uri, source, maxAttempts = 10) {
  const maskedUri = maskCredentials(uri);
  const initialDelayMs = 2000;
  const maxDelayMs = 30000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`🔌 Connecting to MongoDB (${source}) - attempt ${attempt}/${maxAttempts}`);
    console.log(`   URI (masked): ${maskedUri}`);

    try {
      await mongoose.connect(uri, {
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        autoIndex: process.env.NODE_ENV !== 'production',
      });
      console.log(`✅ MongoDB connection established (${source})`);
      return;
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      console.error(`❌ MongoDB connection error (${source}) - attempt ${attempt}/${maxAttempts}`);
      console.error(`   ${message}`);

      if (attempt === maxAttempts) {
        throw new Error(message);
      }

      const delayMs = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitter = Math.floor(Math.random() * 500);
      const retryDelay = delayMs + jitter;

      console.warn(`🔄 MongoDB unavailable, retrying in ${Math.round(retryDelay / 1000)}s...`);
      await wait(retryDelay);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    console.log(
      'Usage: node scripts/seed-groups-cli.js --admin <email> --name <groupName> --description <desc> [--type <groupType>] [--mongo <mongoUri>]'
    );
    process.exit(0);
  }

  if (args.admin) process.env.GROUP_ADMIN_EMAIL = args.admin;
  if (args.name) process.env.GROUP_NAME = args.name;
  if (args.description) process.env.GROUP_DESCRIPTION = args.description;
  if (args.type) process.env.GROUP_TYPE = args.type.toLowerCase(); // normalize casing
  if (args.mongo) process.env.MONGO_URI = args.mongo;

  try {
    require('dotenv').config();
  } catch (e) {}

  const atlasUri = process.env.MONGO_URI;
  let fallbackUri = process.env.MONGO_URI_FALLBACK;
  let selectedUri;
  let source;

  if (atlasUri) {
    selectedUri = atlasUri;
    source = 'MONGO_URI';
  } else if (fallbackUri) {
    selectedUri = fallbackUri;
    source = 'MONGO_URI_FALLBACK';
  } else {
    selectedUri = 'mongodb://127.0.0.1:27017/community_savings';
    source = 'default local fallback';
    fallbackUri = selectedUri;
    process.env.MONGO_URI_FALLBACK = selectedUri;
    console.warn('⚠️ No MONGO_URI or MONGO_URI_FALLBACK provided. Using default local fallback.');
  }

  console.log(`Using MongoDB URI source: ${source}`);
  console.log(`   URI (masked): ${maskCredentials(selectedUri)}`);

  try {
    await connectWithRetry(selectedUri, source, 10);
  } catch (err) {
    console.error('🛑 MongoDB connection failed after retries.');
    process.exit(1);
  }

  const seedPath = path.join(
    __dirname,
    '..',
    'community-savings-app-backend',
    'scripts',
    'seed-group.js'
  );
  let runSeed;
  try {
    runSeed = require(seedPath);
  } catch (err) {
    console.error('Failed to load backend group seed script:', err);
    process.exit(1);
  }

  if (typeof runSeed !== 'function') {
    console.error('Backend group seed script did not export a runner function.');
    process.exit(1);
  }

  try {
    await runSeed({ skipConnect: true });
    console.log(
      `✅ Group "${process.env.GROUP_NAME}" seeded successfully for Admin ${process.env.GROUP_ADMIN_EMAIL}`
    );
  } catch (err) {
    console.error('Failed to execute group seed script:', err);
    process.exit(1);
  }
}

main();
